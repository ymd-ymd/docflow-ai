# ============================================================
# S3イベント → Lambda(pdf_processor) 自動起動
# uploadsバケットに .pdf ファイルが作成されたら、解析用Lambdaを呼び出します。
# Presigned URL発行用のLambda（lambda.tf）とは別の関数です。
# ============================================================

# Lambdaのソースコード（lambda/pdf_processor/配下）をzipファイルにまとめます
data "archive_file" "pdf_processor_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/pdf_processor"
  output_path = "${path.module}/build/pdf_processor.zip"
}

# --- CloudWatch Logs: Lambdaのログの保存先 ---
# 事前にTerraformで作成しておくことで、保存期間を指定でき、
# Lambdaに「ロググループを作成する権限」を与えずに済みます。
resource "aws_cloudwatch_log_group" "pdf_processor" {
  name              = "/aws/lambda/${var.project_name}-${var.environment}-pdf-processor"
  retention_in_days = 14
}

# --- IAM: 解析用Lambdaが引き受けるロール ---
resource "aws_iam_role" "pdf_processor_lambda" {
  name = "${var.project_name}-${var.environment}-pdf-processor-lambda-role"

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

# 最小権限: 上で作成したロググループへのログ書き込みだけを許可します。
resource "aws_iam_role_policy" "pdf_processor_lambda_logs" {
  name = "${var.project_name}-${var.environment}-pdf-processor-logs-policy"
  role = aws_iam_role.pdf_processor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.pdf_processor.arn}:*"
      }
    ]
  })
}

# 最小権限: アップロードされたPDF本体を読むための s3:GetObject だけを許可します。
# 対象は uploadsバケットの「uploads/」配下にある .pdf ファイルに限定しています
# （Presigned URL発行Lambdaは uploads/<uuid>-<ファイル名> というキーで保存します）。
# 一覧取得(ListBucket)・書き込み・削除などの権限は付与しません。
resource "aws_iam_role_policy" "pdf_processor_lambda_s3_read" {
  name = "${var.project_name}-${var.environment}-pdf-processor-s3-read-policy"
  role = aws_iam_role.pdf_processor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadUploadedPdfObjects"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.uploads.arn}/uploads/*.pdf"
      }
    ]
  })
}

# --- Lambda本体 ---
resource "aws_lambda_function" "pdf_processor" {
  function_name = "${var.project_name}-${var.environment}-pdf-processor"
  role          = aws_iam_role.pdf_processor_lambda.arn

  handler = "handler.lambda_handler"
  runtime = "python3.12"
  # ClaudeがPDFを読んで要約するまで時間がかかるため、30秒から120秒に延長しています。
  # （Bedrockの読み取りタイムアウト50秒 × 最大2回試行 + S3取得時間 に余裕を持たせた値）
  timeout = 120
  # 最大4MBのPDFをメモリに読み込むため、既定の128MBから256MBに増やしています
  memory_size = 256

  filename         = data.archive_file.pdf_processor_lambda.output_path
  source_code_hash = data.archive_file.pdf_processor_lambda.output_base64sha256

  environment {
    variables = {
      # 呼び出すClaudeの推論プロファイルID（bedrock.tf で定義）
      BEDROCK_MODEL_ID = local.bedrock_inference_profile_id
      # 検証用のPDFサイズ上限（バイト）。4MB = 4 * 1024 * 1024。
      # Bedrock Converse APIのdocument入力上限（1ファイル4.5MB）より小さくしています
      MAX_PDF_BYTES = "4194304"
    }
  }

  # ロググループとログ権限・Bedrock権限・S3読み取り権限が先に作られてから、Lambdaを作成します
  depends_on = [
    aws_cloudwatch_log_group.pdf_processor,
    aws_iam_role_policy.pdf_processor_lambda_logs,
    aws_iam_role_policy.pdf_processor_lambda_bedrock,
    aws_iam_role_policy.pdf_processor_lambda_s3_read,
  ]
}

# S3（uploadsバケット）がこのLambdaを呼び出せるように明示的に許可します。
# source_arn / source_account で「自分のアカウントのこのバケットから」の呼び出しに限定しています。
resource "aws_lambda_permission" "allow_s3_uploads" {
  statement_id   = "AllowS3InvokeFromUploadsBucket"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.pdf_processor.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.uploads.arn
  source_account = data.aws_caller_identity.current.account_id
}

# S3バケットのイベント通知設定。
# 注意: 1つのバケットに設定できる aws_s3_bucket_notification は1つだけです。
# 今後通知先を増やす場合は、このリソースの中に追記してください。
resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.pdf_processor.arn
    events              = ["s3:ObjectCreated:*"]
    # .pdf で終わるファイルだけを対象にします（大文字小文字は区別されます）
    filter_suffix = ".pdf"
  }

  # S3が通知設定を保存する時点で呼び出し許可が必要なため、Permissionを先に作成します
  depends_on = [aws_lambda_permission.allow_s3_uploads]
}
