"""
DynamoDBに保存されたPDF解析結果（要約）を新しい順に一覧で返すLambda関数。

API Gateway (HTTP API) の GET /documents から呼び出されます。
  - GSI（status-createdAt-index）を使い、status が COMPLETED のデータを createdAt の新しい順に取得します
  - ?limit=N で1回に返す件数を指定できます（初期値20、最大50）
  - 続きがある場合はレスポンスに nextToken が入ります。?nextToken=... を付けて呼ぶと続きを取得できます
  - limit や nextToken が不正な場合は 400 を返します
"""

import base64
import binascii
import json
import os
import re

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

# 解析結果が保存されているDynamoDBテーブル名と、一覧取得用GSIの名前（Terraformで環境変数として設定）
DYNAMODB_TABLE_NAME = os.environ["DYNAMODB_TABLE_NAME"]
DYNAMODB_INDEX_NAME = os.environ["DYNAMODB_INDEX_NAME"]

# 一覧の対象にするステータス（pdf_processor は要約に成功したデータを COMPLETED で保存します）
LIST_STATUS = "COMPLETED"

DEFAULT_LIMIT = 20
MAX_LIMIT = 50

# nextToken として受け付ける最大文字数。極端に長い値はデコードする前に弾きます
MAX_NEXT_TOKEN_LENGTH = 1024

# nextToken の中身（DynamoDBの LastEvaluatedKey）に含まれるキー。
# GSIでのQueryでは「テーブルのキー + GSIのキー」の3つが入ります。
NEXT_TOKEN_KEYS = {"documentId", "status", "createdAt"}

# documentId の形式（小文字のUUID）。get_document Lambda と同じ形式です
DOCUMENT_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

# createdAt の形式（pdf_processor が保存する ISO 8601 形式。例: 2026-09-27T01:23:45.678+00:00）
CREATED_AT_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$"
)

# レスポンスとして返す項目。
# S3のオブジェクトキー(s3Key)などの内部情報はブラウザへ返しません。
RESPONSE_FIELDS = ("documentId", "fileName", "status", "summary", "modelId", "createdAt")

documents_table = boto3.resource("dynamodb").Table(DYNAMODB_TABLE_NAME)


class InvalidRequestError(Exception):
    """クエリ文字列（limit / nextToken）が不正であることを表すエラー。"""


def log(payload):
    # print() の出力はそのままCloudWatch Logsに記録されます
    print(json.dumps(payload, ensure_ascii=False))


def parse_limit(raw_limit):
    """?limit= の値を検証して整数で返します。指定がなければ初期値を使います。"""
    if raw_limit is None or raw_limit == "":
        return DEFAULT_LIMIT
    # "10" のような数字だけを受け付けます（"-1" "1.5" "abc" などは不正）
    if not raw_limit.isascii() or not raw_limit.isdigit():
        raise InvalidRequestError(f"limitは1〜{MAX_LIMIT}の整数で指定してください。")
    limit = int(raw_limit)
    if not 1 <= limit <= MAX_LIMIT:
        raise InvalidRequestError(f"limitは1〜{MAX_LIMIT}の整数で指定してください。")
    return limit


def encode_next_token(last_evaluated_key):
    """DynamoDBの LastEvaluatedKey を、URLに載せやすい文字列（URL安全なBase64）に変換します。"""
    raw = json.dumps(last_evaluated_key, ensure_ascii=False, separators=(",", ":"))
    # 末尾の "=" はURLで扱いにくいため取り除きます（デコード時に補います）
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def decode_next_token(next_token):
    """nextToken を LastEvaluatedKey に戻し、想定した形かどうかを検証します。"""
    invalid = InvalidRequestError("nextTokenが正しくありません。")

    if len(next_token) > MAX_NEXT_TOKEN_LENGTH:
        raise invalid

    try:
        padded = next_token + "=" * (-len(next_token) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except (binascii.Error, UnicodeError, ValueError):
        # Base64として不正 / UTF-8として不正 / JSONとして不正 のいずれか
        raise invalid

    # 中身は必ず {"documentId": ..., "status": ..., "createdAt": ...} の3つだけのはずです。
    # 余分なキーや想定外の値が入っていれば、改ざんされたものとして扱います。
    if not isinstance(decoded, dict) or set(decoded) != NEXT_TOKEN_KEYS:
        raise invalid
    if not all(isinstance(value, str) for value in decoded.values()):
        raise invalid
    if decoded["status"] != LIST_STATUS:
        raise invalid
    if not DOCUMENT_ID_PATTERN.match(decoded["documentId"]):
        raise invalid
    if not CREATED_AT_PATTERN.match(decoded["createdAt"]):
        raise invalid

    return decoded


def lambda_handler(event, context):
    query_params = event.get("queryStringParameters") or {}

    try:
        limit = parse_limit(query_params.get("limit"))
        next_token = query_params.get("nextToken")
        exclusive_start_key = decode_next_token(next_token) if next_token else None
    except InvalidRequestError as e:
        return _response(400, {"message": str(e)})

    query_kwargs = {
        "IndexName": DYNAMODB_INDEX_NAME,
        # boto3 の Key() を使うと、予約語の "status" も自動で安全に扱われます
        "KeyConditionExpression": Key("status").eq(LIST_STATUS),
        # False にすると、ソートキー（createdAt）の降順＝新しい順になります
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if exclusive_start_key:
        # 前回の続きから取得します
        query_kwargs["ExclusiveStartKey"] = exclusive_start_key

    try:
        result = documents_table.query(**query_kwargs)
    except ClientError as e:
        error = e.response.get("Error", {})
        # nextToken の形は正しくても、DynamoDBが開始位置として受け付けない場合はここに来ます
        if exclusive_start_key and error.get("Code") == "ValidationException":
            return _response(400, {"message": "nextTokenが正しくありません。"})
        log(
            {
                "message": "DynamoDB Query failed",
                "errorCode": error.get("Code"),
                "errorMessage": error.get("Message"),
                "requestId": e.response.get("ResponseMetadata", {}).get("RequestId"),
                "table": DYNAMODB_TABLE_NAME,
                "index": DYNAMODB_INDEX_NAME,
            }
        )
        return _response(500, {"message": "解析結果一覧の取得に失敗しました。"})
    except BotoCoreError as e:
        log(
            {
                "message": "DynamoDB Query failed",
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "table": DYNAMODB_TABLE_NAME,
                "index": DYNAMODB_INDEX_NAME,
            }
        )
        return _response(500, {"message": "解析結果一覧の取得に失敗しました。"})

    items = [
        {field: item.get(field) for field in RESPONSE_FIELDS}
        for item in result.get("Items", [])
    ]
    body = {"items": items}

    # LastEvaluatedKey があれば「続きがあるかもしれない」ことを表します。
    # （ちょうど limit 件で終わった場合も入るため、次の呼び出しで items が空になることがあります）
    last_evaluated_key = result.get("LastEvaluatedKey")
    if last_evaluated_key:
        body["nextToken"] = encode_next_token(last_evaluated_key)

    return _response(200, body)


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        # 日本語の要約をそのまま読める形で返します
        "body": json.dumps(body, ensure_ascii=False),
    }
