# ============================================================
# 解析結果取得API: GET /documents/{documentId} -> Lambda(get_document) -> DynamoDB
# pdf_processor Lambda がDynamoDBへ保存した要約結果を、ブラウザから取得できるようにします。
# API Gateway本体（aws_apigatewayv2_api.main）とステージは api_gateway.tf の既存のものを使います。
# ============================================================

# Lambdaのソースコード（lambda/get_document/配下）をzipファイルにまとめます
data "archive_file" "get_document_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/get_document"
  output_path = "${path.module}/build/get_document.zip"
}

# --- CloudWatch Logs: Lambdaのログの保存先 ---
# 事前に作成しておくことで保存期間を指定でき、Lambdaに「ロググループを作成する権限」を与えずに済みます
resource "aws_cloudwatch_log_group" "get_document" {
  name              = "/aws/lambda/${var.project_name}-${var.environment}-get-document"
  retention_in_days = 14
}

# --- IAM: 解析結果取得Lambdaが引き受けるロール ---
resource "aws_iam_role" "get_document_lambda" {
  name = "${var.project_name}-${var.environment}-get-document-lambda-role"

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

# 最小権限: 上で作成したロググループへのログ書き込みだけを許可します
resource "aws_iam_role_policy" "get_document_lambda_logs" {
  name = "${var.project_name}-${var.environment}-get-document-logs-policy"
  role = aws_iam_role.get_document_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.get_document.arn}:*"
      }
    ]
  })
}

# 最小権限: documentsテーブルからキーを指定した1件読み取り（GetItem）だけを許可します。
# 全件取得(Scan)・検索(Query)・書き込み・削除などの権限は付与しません。
resource "aws_iam_role_policy" "get_document_lambda_dynamodb" {
  name = "${var.project_name}-${var.environment}-get-document-dynamodb-policy"
  role = aws_iam_role.get_document_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "GetDocumentSummary"
        Effect   = "Allow"
        Action   = "dynamodb:GetItem"
        Resource = aws_dynamodb_table.documents.arn
      }
    ]
  })
}

# --- Lambda本体 ---
resource "aws_lambda_function" "get_document" {
  function_name = "${var.project_name}-${var.environment}-get-document"
  role          = aws_iam_role.get_document_lambda.arn

  handler = "handler.lambda_handler"
  runtime = "python3.12"
  timeout = 10

  filename         = data.archive_file.get_document_lambda.output_path
  source_code_hash = data.archive_file.get_document_lambda.output_base64sha256

  environment {
    variables = {
      # 解析結果を読み取るDynamoDBテーブル名（dynamodb.tf で定義）
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.documents.name
    }
  }

  # ロググループと各権限が先に作られてから、Lambdaを作成します
  depends_on = [
    aws_cloudwatch_log_group.get_document,
    aws_iam_role_policy.get_document_lambda_logs,
    aws_iam_role_policy.get_document_lambda_dynamodb,
  ]
}

# --- API Gateway: 既存のHTTP APIにルートを追加 ---

# API GatewayとLambda(get_document)を繋ぐ「統合」設定
resource "aws_apigatewayv2_integration" "get_document" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_document.invoke_arn
  payload_format_version = "2.0"
}

# GET /documents/{documentId} へのリクエストをLambda統合にルーティングします。
# {documentId} の部分はLambdaに event["pathParameters"]["documentId"] として渡されます
resource "aws_apigatewayv2_route" "get_document" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /documents/{documentId}"
  target    = "integrations/${aws_apigatewayv2_integration.get_document.id}"
}

# API GatewayがこのLambdaを呼び出せるように明示的に許可します。
# 「このAPIの GET /documents/〜 からの呼び出し」だけに限定しています
resource "aws_lambda_permission" "allow_apigw_get_document" {
  statement_id  = "AllowAPIGatewayInvokeGetDocument"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_document.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/GET/documents/*"
}
