# ============================================================
# API Gateway (HTTP API): ブラウザからのリクエストを受け付ける玄関口
# POST /upload-url -> Lambda(presigned_url) を呼び出します
# GET /documents/{documentId} -> Lambda(get_document) は document_api.tf で定義しています
# GET /documents -> Lambda(list_documents) は list_documents_api.tf で定義しています
# 3つのルートはすべて、下の JWT Authorizer で Cognito のアクセストークンを確認してから Lambda を呼び出します
# ============================================================

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-${var.environment}-api"
  protocol_type = "HTTP"

  # Next.js (http://localhost:3000) からのブラウザ呼び出しを許可します
  cors_configuration {
    allow_origins = ["http://localhost:3000"]
    # GET は解析結果取得API（document_api.tf の GET /documents/{documentId}）と
    # 解析結果一覧API（list_documents_api.tf の GET /documents）用です
    allow_methods = ["GET", "POST", "OPTIONS"]
    # authorization は、Next.js が Cognito のアクセストークンを
    # 「Authorization: Bearer <トークン>」として送るために許可しています
    allow_headers = ["content-type", "authorization"]
    max_age       = 300
  }
}

# JWT Authorizer: API Gateway の入口で Cognito のトークンを確認する「入館チェック係」です。
# Authorization: Bearer <トークン> の署名・発行元(iss)・有効期限(exp)・App Client(client_id)を確認し、
# 1つでも合わなければ Lambda を呼ばずに 401 を返します（チェック用のLambdaを自分で書く必要はありません）
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  name             = "${var.project_name}-${var.environment}-cognito-jwt"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    # 発行元: DocFlow AI の User Pool（endpoint は "cognito-idp.<リージョン>.amazonaws.com/<User Pool ID>"）
    issuer = "https://${aws_cognito_user_pool.main.endpoint}"
    # 宛先: Next.js 用の App Client に発行されたトークンだけを受け付けます
    # （アクセストークンには aud がないため、client_id がこの値と照合されます）
    audience = [aws_cognito_user_pool_client.web.id]
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

  # ログイン必須: 有効なアクセストークンがないリクエストは 401 になります
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
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
