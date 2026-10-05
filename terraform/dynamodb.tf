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

  # 以下2つは、一覧取得用のGSI（下記）のキーとして使うため定義します
  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  # GSI（グローバルセカンダリインデックス）: 同じデータを「status + createdAt」で並べ直した索引です。
  # 解析結果一覧API（GET /documents）が、status = "COMPLETED" のデータを新しい順に取り出すために使います。
  # createdAt は ISO 8601 形式の文字列なので、文字列の並び順がそのまま時刻の順になります。
  # 既存のデータも、インデックス作成時にDynamoDBが自動で登録します。
  global_secondary_index {
    # 名前は list_documents_api.tf の local で定義しています（Lambdaの環境変数・IAMでも同じ名前を使うため）
    name      = local.documents_list_index_name
    hash_key  = "status"
    range_key = "createdAt"

    # インデックスにコピーする項目を、一覧APIで返すものだけに限定します
    # （documentId・status・createdAt はキーなので自動でコピーされます）。
    # S3のオブジェクトキー(s3Key)などの内部情報はインデックスに含めません。
    projection_type    = "INCLUDE"
    non_key_attributes = ["fileName", "summary", "modelId"]
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
