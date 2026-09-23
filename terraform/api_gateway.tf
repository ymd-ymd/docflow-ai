# ============================================================
# API Gateway (HTTP API): ブラウザからのリクエストを受け付ける玄関口
# POST /upload-url -> Lambda(presigned_url) を呼び出します
# GET /documents/{documentId} -> Lambda(get_document) は document_api.tf で定義しています
# ============================================================

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-${var.environment}-api"
  protocol_type = "HTTP"

  # Next.js (http://localhost:3000) からのブラウザ呼び出しを許可します
  cors_configuration {
    allow_origins = ["http://localhost:3000"]
    # GET は解析結果取得API（document_api.tf の GET /documents/{documentId}）用です
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 300
  }
}

# API GatewayとLambdaを繋ぐ「統合」設定
resource "aws_apigatewayv2_integration" "presigned_url" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.presigned_url.invoke_arn
  payload_format_version = "2.0"
}

# POST /upload-url へのリクエストをLambda統合にルーティングします
resource "aws_apigatewayv2_route" "upload_url" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /upload-url"
  target    = "integrations/${aws_apigatewayv2_integration.presigned_url.id}"
}

# デフォルトステージ（デプロイ単位）。auto_deploy = true でルート追加時に自動反映されます
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

# API GatewayがこのLambdaを呼び出せるように明示的に許可します
resource "aws_lambda_permission" "allow_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presigned_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
