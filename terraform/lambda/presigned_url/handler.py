"""
S3アップロード用のPresigned URLを発行するLambda関数。

API Gateway (HTTP API) の POST /upload-url から呼び出されます。
リクエストボディの例:
  { "fileName": "invoice.pdf", "contentType": "application/pdf" }
"""

import json
import os
import re
import uuid

import boto3

BUCKET_NAME = os.environ["BUCKET_NAME"]
PRESIGNED_URL_EXPIRY_SECONDS = int(os.environ.get("PRESIGNED_URL_EXPIRY_SECONDS", "600"))

# ファイル名として許可する文字（英数字・.・_・-のみ）。
# パストラバーサル（../ など）や不正な文字列がS3のキーに混入するのを防ぎます。
ALLOWED_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")

s3_client = boto3.client("s3")


def lambda_handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"message": "リクエストボディがJSONとして解析できません。"})

    file_name = body.get("fileName")
    content_type = body.get("contentType") or "application/octet-stream"

    if not file_name or not ALLOWED_FILENAME_PATTERN.match(file_name):
        return _response(
            400,
            {"message": "fileNameは必須です。使用できる文字は英数字・.・_・-のみです。"},
        )

    # 同じファイル名がアップロードされても上書きされないよう、一意なプレフィックスを付与します
    object_key = f"uploads/{uuid.uuid4()}-{file_name}"

    try:
        upload_url = s3_client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=PRESIGNED_URL_EXPIRY_SECONDS,
        )
    except Exception as error:
        print(f"Presigned URL generation failed: {error}")
        return _response(500, {"message": "Presigned URLの生成に失敗しました。"})

    return _response(
        200,
        {
            "uploadUrl": upload_url,
            "objectKey": object_key,
            "expiresIn": PRESIGNED_URL_EXPIRY_SECONDS,
        },
    )


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
