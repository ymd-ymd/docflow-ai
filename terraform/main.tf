terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
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
