"""
S3にPDFがアップロードされたときに自動で起動する解析用Lambda関数。

S3のObjectCreatedイベント（.pdfファイルのみ）から呼び出され、1ファイルごとに以下を行います。
  1. イベントからバケット名とオブジェクトキーを取り出す
  2. S3からPDF本体を取得する（サイズ上限を超えるファイルは読み込まない）
  3. Amazon Bedrock Converse API の document 入力でPDFをClaudeへ渡し、日本語で3行要約させる
  4. 要約結果をCloudWatch Logsへ出力する（PDF本文そのものはログに出さない）
  5. 要約結果とメタデータをDynamoDBへ保存する（PDF本文そのものは保存しない）
"""

import json
import os
import re
import traceback
import uuid
from datetime import datetime, timezone
from urllib.parse import unquote_plus

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

# 呼び出すClaudeの推論プロファイルID（Terraformで環境変数として設定）
BEDROCK_MODEL_ID = os.environ["BEDROCK_MODEL_ID"]

# 検証用のPDFサイズ上限（バイト）。Converse APIのdocument入力上限（4.5MB）より小さい4MBを既定値にします
MAX_PDF_BYTES = int(os.environ.get("MAX_PDF_BYTES", str(4 * 1024 * 1024)))

# 要約結果を保存するDynamoDBテーブル名（Terraformで環境変数として設定）
DYNAMODB_TABLE_NAME = os.environ["DYNAMODB_TABLE_NAME"]

# Presigned URL発行Lambdaが作るオブジェクトキー uploads/<uuid4>-<ファイル名> を分解するためのパターン。
# 先頭のUUID部分を documentId、残りを元のファイル名として取り出します。
UPLOAD_KEY_PATTERN = re.compile(
    r"^uploads/"
    r"(?P<uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
    r"-(?P<file_name>.+)$"
)

# Claudeへの指示文
SUMMARY_PROMPT = "このPDFの内容を日本語で3行で要約してください。"

# Converse APIに渡すドキュメント名。
# ファイル名をそのまま使うと、使えない文字が含まれていたり、名前に紛れ込んだ指示を
# モデルが読んでしまう（プロンプトインジェクション）おそれがあるため、固定の中立的な名前にします。
DOCUMENT_NAME = "uploaded-document"

# クライアントは関数の外で1回だけ作成し、Lambdaの再利用時に使い回します。
# リージョンはLambdaが動いているリージョン（ap-northeast-1）が自動で使われます。
s3 = boto3.client("s3")

# PDFの読み込みには時間がかかるため、読み取りタイムアウトを50秒にしています。
# 最大2回試行しても Lambda本体のタイムアウト（120秒）に収まるようにしています。
bedrock_runtime = boto3.client(
    "bedrock-runtime",
    config=Config(
        connect_timeout=5,
        read_timeout=50,
        retries={"max_attempts": 2, "mode": "standard"},
    ),
)

documents_table = boto3.resource("dynamodb").Table(DYNAMODB_TABLE_NAME)


class PdfValidationError(Exception):
    """PDFのサイズや形式が今回の処理対象外であることを表すエラー。"""


def log(payload):
    # print() の出力はそのままCloudWatch Logsに記録されます
    print(json.dumps(payload, ensure_ascii=False))


def fetch_pdf(bucket_name, object_key):
    """S3からPDF本体を取得して bytes で返します。上限サイズを超える場合は読み込まずにエラーにします。"""
    response = s3.get_object(Bucket=bucket_name, Key=object_key)
    body = response["Body"]
    try:
        # get_object の時点ではまだ本文をダウンロードしていません。
        # まずファイルサイズ（ContentLength）を確認し、上限超えなら本文を読まずに終了します。
        content_length = response.get("ContentLength", 0)
        if content_length == 0:
            raise PdfValidationError("PDF is empty")
        if content_length > MAX_PDF_BYTES:
            raise PdfValidationError(
                f"PDF size {content_length} bytes exceeds limit {MAX_PDF_BYTES} bytes"
            )

        # 念のため「上限 + 1バイト」までしか読まないようにし、無制限にメモリへ読み込まないようにします
        pdf_bytes = body.read(MAX_PDF_BYTES + 1)
    finally:
        body.close()

    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise PdfValidationError(f"PDF body exceeds limit {MAX_PDF_BYTES} bytes")

    # PDFファイルは必ず "%PDF-" で始まります。拡張子だけ .pdf の別ファイルを弾きます
    if not pdf_bytes.startswith(b"%PDF-"):
        raise PdfValidationError("File does not start with the PDF signature")

    return pdf_bytes


def summarize_pdf(pdf_bytes):
    """Bedrock Converse APIのdocument入力でPDFをClaudeへ渡し、3行要約を返します。"""
    response = bedrock_runtime.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "document": {
                            "format": "pdf",
                            "name": DOCUMENT_NAME,
                            # boto3（AWS SDK）を使う場合、base64エンコードせずに生のbytesを渡します
                            "source": {"bytes": pdf_bytes},
                        }
                    },
                    # document を送るときは、指示文の text ブロックも必ず一緒に送る必要があります
                    {"text": SUMMARY_PROMPT},
                ],
            }
        ],
        inferenceConfig={"maxTokens": 1000},
    )

    # 返答は output.message.content の中に、テキストのブロックとして入っています
    content_blocks = response["output"]["message"]["content"]
    summary_text = "".join(block["text"] for block in content_blocks if "text" in block)

    return {
        "summary": summary_text,
        "stopReason": response.get("stopReason"),
        "usage": response.get("usage"),
    }


def parse_document_identity(bucket_name, object_key):
    """S3オブジェクトキーから documentId と元のファイル名を取り出します。"""
    match = UPLOAD_KEY_PATTERN.match(object_key)
    if match:
        # Presigned URL発行Lambdaが付けたUUID（uuid4）をそのまま使います。
        # アップロードごとに新しく作られるため、同じファイル名でも衝突しません。
        return match.group("uuid"), match.group("file_name")

    # 想定外の形式（AWSコンソールから手動でアップロードした場合など）は、
    # バケット名+キーから決まった値になるUUID（uuid5）を作ります。
    # 同じオブジェクトなら常に同じID、別のオブジェクトなら別のIDになります。
    fallback_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"s3://{bucket_name}/{object_key}"))
    return fallback_id, object_key.rsplit("/", 1)[-1]


def save_summary(document_id, file_name, object_key, summary):
    """要約結果とメタデータをDynamoDBへ1件保存します（PDF本文は保存しません）。"""
    item = {
        "documentId": document_id,
        "fileName": file_name,
        "s3Key": object_key,
        "status": "COMPLETED",
        "summary": summary,
        "modelId": BEDROCK_MODEL_ID,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
    }
    # 同じ documentId があれば上書きします。
    # S3イベントが重複して届いた場合でも、データが二重にならないようにするためです。
    documents_table.put_item(Item=item)


def process_record(record):
    """S3イベントの1レコード（=1ファイル）を処理し、成功したら True を返します。"""
    bucket_name = record["s3"]["bucket"]["name"]
    # S3イベントのキーはURLエンコードされている（例: スペースが "+" になる）ため元に戻します
    object_key = unquote_plus(record["s3"]["object"]["key"])
    # ログに毎回付ける、原因調査用の情報（PDFの中身は含めません）
    context_info = {"bucket": bucket_name, "key": object_key, "modelId": BEDROCK_MODEL_ID}

    log(
        {
            "message": "PDF upload detected",
            "eventName": record.get("eventName"),
            "eventSize": record["s3"]["object"].get("size"),
            **context_info,
        }
    )

    # --- 1. S3からPDF本体を取得 ---
    try:
        pdf_bytes = fetch_pdf(bucket_name, object_key)
    except PdfValidationError as e:
        log({"message": "PDF skipped", "reason": str(e), "maxBytes": MAX_PDF_BYTES, **context_info})
        return False
    except ClientError as e:
        # 権限不足(AccessDenied)・ファイルが存在しない(NoSuchKey)など
        error = e.response.get("Error", {})
        log(
            {
                "message": "S3 GetObject failed",
                "errorCode": error.get("Code"),
                "errorMessage": error.get("Message"),
                "requestId": e.response.get("ResponseMetadata", {}).get("RequestId"),
                **context_info,
            }
        )
        return False
    except BotoCoreError as e:
        log(
            {
                "message": "S3 GetObject failed",
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                **context_info,
            }
        )
        return False

    log({"message": "PDF fetched from S3", "sizeBytes": len(pdf_bytes), **context_info})

    # --- 2. ClaudeにPDFを渡して要約 ---
    try:
        result = summarize_pdf(pdf_bytes)
    except ClientError as e:
        # AWS側が返したエラー（権限不足・入力形式エラー・スロットリングなど）。
        # エラーメッセージとスタックトレースには、送信したPDFの中身は含まれません。
        error = e.response.get("Error", {})
        log(
            {
                "message": "Bedrock invocation failed",
                "errorType": "ClientError",
                "errorCode": error.get("Code"),
                "errorMessage": error.get("Message"),
                "requestId": e.response.get("ResponseMetadata", {}).get("RequestId"),
                "pdfSizeBytes": len(pdf_bytes),
                "traceback": traceback.format_exc(),
                **context_info,
            }
        )
        return False
    except (BotoCoreError, KeyError) as e:
        # 通信タイムアウトなどのSDK側エラーや、想定外のレスポンス形式
        log(
            {
                "message": "Bedrock invocation failed",
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "pdfSizeBytes": len(pdf_bytes),
                "traceback": traceback.format_exc(),
                **context_info,
            }
        )
        return False

    # 要約（3行）のみをログに出します。PDF本文そのものは出力しません
    log(
        {
            "message": "PDF summary generated",
            "summary": result["summary"],
            "stopReason": result["stopReason"],
            "usage": result["usage"],
            **context_info,
        }
    )
    if result["stopReason"] == "max_tokens":
        log({"message": "Summary may be truncated (max_tokens reached)", **context_info})

    # --- 3. 要約結果をDynamoDBへ保存 ---
    document_id, file_name = parse_document_identity(bucket_name, object_key)
    try:
        save_summary(document_id, file_name, object_key, result["summary"])
    except ClientError as e:
        # 権限不足(AccessDenied)・テーブルが存在しない(ResourceNotFound)など
        error = e.response.get("Error", {})
        log(
            {
                "message": "DynamoDB PutItem failed",
                "errorCode": error.get("Code"),
                "errorMessage": error.get("Message"),
                "requestId": e.response.get("ResponseMetadata", {}).get("RequestId"),
                "documentId": document_id,
                "table": DYNAMODB_TABLE_NAME,
                **context_info,
            }
        )
        return False
    except BotoCoreError as e:
        log(
            {
                "message": "DynamoDB PutItem failed",
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "documentId": document_id,
                "table": DYNAMODB_TABLE_NAME,
                **context_info,
            }
        )
        return False

    log(
        {
            "message": "PDF summary saved to DynamoDB",
            "documentId": document_id,
            "table": DYNAMODB_TABLE_NAME,
            **context_info,
        }
    )

    return True


def lambda_handler(event, context):
    # 1回の呼び出しに複数のファイル（Records）が含まれる場合があるため、1件ずつ処理します
    records = event.get("Records", [])
    succeeded = 0

    for record in records:
        if process_record(record):
            succeeded += 1

    # 注意: 失敗時に例外を再送出すると、S3からの非同期呼び出しが自動で
    # 最大2回リトライされ、Bedrockも重複して呼ばれるため、ここではログ出力のみにしています。
    return {"processed": len(records), "succeeded": succeeded}
