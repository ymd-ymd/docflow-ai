# ============================================================
# Lambda: Presigned URL発行関数
# ここでは「Lambda本体」と「Lambdaに与える権限（IAM）」を定義します
# ============================================================

# Lambdaのソースコード（lambda/presigned_url/配下）をzipファイルにまとめます。
# コードを変更するとハッシュ値が変わり、terraform apply時に自動で再デプロイされます。
data "archive_file" "presigned_url_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/presigned_url"
  output_path = "${path.module}/build/presigned_url.zip"
}

# --- IAM: Lambdaが引き受ける「役割（ロール）」 ---
# LambdaサービスだけがこのロールをAssume（引き受け）できるようにします
resource "aws_iam_role" "presigned_url_lambda" {
  name = "${var.project_name}-${var.environment}-presigned-url-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# CloudWatch Logsへの書き込み権限（Lambdaの実行ログを残すためのAWS標準ポリシー）
resource "aws_iam_role_policy_attachment" "presigned_url_lambda_logs" {
  role       = aws_iam_role.presigned_url_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# S3への書き込み（PutObject）だけを許可する最小権限ポリシー。
# 対象も既存のuploadsバケットのみに限定しています。
resource "aws_iam_role_policy" "presigned_url_lambda_s3" {
  name = "${var.project_name}-${var.environment}-presigned-url-s3-policy"
  role = aws_iam_role.presigned_url_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.uploads.arn}/*"
      }
    ]
  })
}

# --- Lambda本体 ---
resource "aws_lambda_function" "presigned_url" {
  function_name = "${var.project_name}-${var.environment}-presigned-url"
  role          = aws_iam_role.presigned_url_lambda.arn

  handler = "handler.lambda_handler"
  runtime = "python3.12"
  timeout = 10

  filename         = data.archive_file.presigned_url_lambda.output_path
  source_code_hash = data.archive_file.presigned_url_lambda.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME                  = aws_s3_bucket.uploads.id
      PRESIGNED_URL_EXPIRY_SECONDS = "600" # 10分
    }
  }
}
