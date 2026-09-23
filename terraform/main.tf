terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    # Lambda関数のコードをzipファイルにまとめるために使用します
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# 現在のAWSアカウント情報を取得します。
# バケット名にアカウントIDを組み込むことで、世界で一意な名前にするために使います。
data "aws_caller_identity" "current" {}

# DocFlow AIがアップロードされたPDFやExcelファイルを保存するS3バケット
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

# パブリックアクセスをすべてブロック（誰でもインターネットから読み書きできないようにする）
resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# バージョニングを有効化（ファイルを上書き・削除しても過去バージョンを復元できるようにする）
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  versioning_configuration {
    status = "Enabled"
  }
}

# サーバーサイド暗号化を有効化（保存されるデータをAWS側で自動的に暗号化する）
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CORS設定（ブラウザからPresigned URLを使ってS3へ直接アップロードできるようにする）
# ブラウザは「別のドメイン（オリジン）」へのリクエストを安全のため通常ブロックします。
# ここで「http://localhost:3000 からの PUT だけは許可する」とS3に教えておきます。
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    # Presigned URLはContent-Typeを含めて署名されているため、このヘッダーの送信を許可します
    allowed_headers = ["Content-Type"]
    allowed_methods = ["PUT"]
    allowed_origins = ["http://localhost:3000"]
    # アップロード成功時にブラウザ側のJavaScriptからETag（ファイルの識別値）を読めるようにします
    expose_headers = ["ETag"]
    # ブラウザが事前確認（プリフライト）の結果をキャッシュする秒数
    max_age_seconds = 3000
  }
}
