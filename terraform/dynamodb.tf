# ============================================================
# DynamoDB: PDF解析結果（Claudeによる要約）の保存先
# 解析用Lambda(pdf_processor) が、要約に成功したPDFごとに1件のデータを書き込みます。
# PDF本文そのものは保存せず、要約結果と必要なメタデータだけを保存します。
# ============================================================

resource "aws_dynamodb_table" "documents" {
  name = "${var.project_name}-${var.environment}-documents"

  # 使った分だけ課金されるオンデマンドモード。
  # 読み書きの量を事前に見積もる必要がなく、アクセスが少ない間はほぼ費用がかかりません。
  billing_mode = "PAY_PER_REQUEST"

  # パーティションキー（データを一意に特定するためのキー）。
  # S3オブジェクトキー uploads/<uuid>-<ファイル名> に含まれるUUIDを使います。
  hash_key = "documentId"

  # DynamoDBでは、キーとして使う属性だけを事前に定義します（summaryなどの定義は不要です）
  attribute {
    name = "documentId"
    type = "S"
  }
}

# 最小権限: 上で作成したテーブルへの1件書き込み（PutItem）だけを許可します。
# 読み取り・削除・テーブル一覧の取得などの権限は付与しません。
resource "aws_iam_role_policy" "pdf_processor_lambda_dynamodb" {
  name = "${var.project_name}-${var.environment}-pdf-processor-dynamodb-policy"
  role = aws_iam_role.pdf_processor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PutDocumentSummary"
        Effect   = "Allow"
        Action   = "dynamodb:PutItem"
        Resource = aws_dynamodb_table.documents.arn
      }
    ]
  })
}
