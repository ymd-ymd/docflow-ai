"""
DynamoDBに保存されたPDF解析結果（要約）を1件取得して返すLambda関数。

API Gateway (HTTP API) の GET /documents/{documentId} から呼び出されます。
  - documentId は pdf_processor Lambda が保存時に使ったUUIDです
  - 見つかった場合は 200 で解析結果をJSONで返します
  - 見つからない場合（存在しない・まだ解析中）は 404 を返します
"""

import json
import os
import re

import boto3
from botocore.exceptions import BotoCoreError, ClientError

# 解析結果が保存されているDynamoDBテーブル名（Terraformで環境変数として設定）
DYNAMODB_TABLE_NAME = os.environ["DYNAMODB_TABLE_NAME"]

# documentId として受け付ける形式（小文字のUUID）。
# pdf_processor はUUID（uuid4、または想定外のキーの場合はuuid5）を documentId として保存します。
# 形式が違うものはDynamoDBに問い合わせる前に弾きます。
DOCUMENT_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

# レスポンスとして返す項目。
# S3のオブジェクトキー(s3Key)などの内部情報はブラウザへ返しません。
RESPONSE_FIELDS = ("documentId", "fileName", "status", "summary", "modelId", "createdAt")

documents_table = boto3.resource("dynamodb").Table(DYNAMODB_TABLE_NAME)


def log(payload):
    # print() の出力はそのままCloudWatch Logsに記録されます
    print(json.dumps(payload, ensure_ascii=False))


def lambda_handler(event, context):
    document_id = (event.get("pathParameters") or {}).get("documentId", "")

    if not DOCUMENT_ID_PATTERN.match(document_id):
        return _response(400, {"message": "documentIdの形式が正しくありません。"})

    try:
        # documentId はテーブルのパーティションキーなので、GetItemで1件だけ直接取得します
        result = documents_table.get_item(Key={"documentId": document_id})
    except ClientError as e:
        error = e.response.get("Error", {})
        log(
            {
                "message": "DynamoDB GetItem failed",
                "errorCode": error.get("Code"),
                "errorMessage": error.get("Message"),
                "requestId": e.response.get("ResponseMetadata", {}).get("RequestId"),
                "documentId": document_id,
                "table": DYNAMODB_TABLE_NAME,
            }
        )
        return _response(500, {"message": "解析結果の取得に失敗しました。"})
    except BotoCoreError as e:
        log(
            {
                "message": "DynamoDB GetItem failed",
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "documentId": document_id,
                "table": DYNAMODB_TABLE_NAME,
            }
        )
        return _response(500, {"message": "解析結果の取得に失敗しました。"})

    item = result.get("Item")
    if item is None:
        # まだ解析中でDynamoDBに保存されていない場合も、ここに該当します
        return _response(
            404,
            {"message": "解析結果が見つかりません。解析中の場合は、しばらくしてから再度お試しください。"},
        )

    return _response(200, {field: item.get(field) for field in RESPONSE_FIELDS})


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        # 日本語の要約をそのまま読める形で返します
        "body": json.dumps(body, ensure_ascii=False),
    }
