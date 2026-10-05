# ============================================================
# 解析結果一覧API: GET /documents -> Lambda(list_documents) -> DynamoDB(GSI)
# pdf_processor Lambda がDynamoDBへ保存した要約結果を、新しい順に一覧で取得できるようにします。
# API Gateway本体（aws_apigatewayv2_api.main）とステージは api_gateway.tf の既存のものを使います。
#
# 注意: Cognito のログインは必須ですが、まだユーザーごとのデータ分離はしていません。
# ログインしたユーザーは全員分の一覧を取得できます（今後、userId で絞り込む予定です）。
# ============================================================

locals {
  # 一覧取得に使うGSIの名前（dynamodb.tf で定義）
  documents_list_index_name = "status-createdAt-index"
}

# Lambdaのソースコード（lambda/list_documents/配下）をzipファイルにまとめます
data "archive_file" "list_documents_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/list_documents"
  output_path = "${path.module}/build/list_documents.zip"
}

# --- CloudWatch Logs: Lambdaのログの保存先 ---
# 事前に作成しておくことで保存期間を指定でき、Lambdaに「ロググループを作成する権限」を与えずに済みます
resource "aws_cloudwatch_log_group" "list_documents" {
  name              = "/aws/lambda/${var.project_name}-${var.environment}-list-documents"
  retention_in_days = 14
}

# --- IAM: 解析結果一覧Lambdaが引き受けるロール ---
resource "aws_iam_role" "list_documents_lambda" {
  name = "${var.project_name}-${var.environment}-list-documents-lambda-role"

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
resource "aws_iam_role_policy" "list_documents_lambda_logs" {
  name = "${var.project_name}-${var.environment}-list-documents-logs-policy"
  role = aws_iam_role.list_documents_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.list_documents.arn}:*"
      }
    ]
  })
}

# 最小権限: 一覧用GSIへの検索（Query）だけを許可します。
# テーブル本体への読み取り・全件取得(Scan)・書き込み・削除などの権限は付与しません。
resource "aws_iam_role_policy" "list_documents_lambda_dynamodb" {
  name = "${var.project_name}-${var.environment}-list-documents-dynamodb-policy"
  role = aws_iam_role.list_documents_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "QueryDocumentsListIndex"
        Effect   = "Allow"
        Action   = "dynamodb:Query"
        Resource = "${aws_dynamodb_table.documents.arn}/index/${local.documents_list_index_name}"
      }
    ]
  })
}

# --- Lambda本体 ---
resource "aws_lambda_function" "list_documents" {
  function_name = "${var.project_name}-${var.environment}-list-documents"
  role          = aws_iam_role.list_documents_lambda.arn

  handler = "handler.lambda_handler"
  runtime = "python3.12"
  timeout = 10

  filename         = data.archive_file.list_documents_lambda.output_path
  source_code_hash = data.archive_file.list_documents_lambda.output_base64sha256

  environment {
    variables = {
      # 解析結果を読み取るDynamoDBテーブル名とGSI名（dynamodb.tf で定義）
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.documents.name
      DYNAMODB_INDEX_NAME = local.documents_list_index_name
    }
  }

  # ロググループと各権限が先に作られてから、Lambdaを作成します
  depends_on = [
    aws_cloudwatch_log_group.list_documents,
    aws_iam_role_policy.list_documents_lambda_logs,
    aws_iam_role_policy.list_documents_lambda_dynamodb,
  ]
}

# --- API Gateway: 既存のHTTP APIにルートを追加 ---

# API GatewayとLambda(list_documents)を繋ぐ「統合」設定
resource "aws_apigatewayv2_integration" "list_documents" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.list_documents.invoke_arn
  payload_format_version = "2.0"
}

# GET /documents へのリクエストをLambda統合にルーティングします。
# ?limit=20&nextToken=... のようなクエリ文字列は event["queryStringParameters"] として渡されます。
# 既存の GET /documents/{documentId} とは別のルートとして扱われます。
resource "aws_apigatewayv2_route" "list_documents" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /documents"
  target    = "integrations/${aws_apigatewayv2_integration.list_documents.id}"

  # ログイン必須: 有効なアクセストークンがないリクエストは 401 になります（api_gateway.tf の JWT Authorizer）
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# API GatewayがこのLambdaを呼び出せるように明示的に許可します。
# 「このAPIの GET /documents からの呼び出し」だけに限定しています
# （GET /documents/{documentId} からは呼び出せません）
resource "aws_lambda_permission" "allow_apigw_list_documents" {
  statement_id  = "AllowAPIGatewayInvokeListDocuments"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_documents.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/GET/documents"
}
