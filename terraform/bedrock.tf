# ============================================================
# Amazon Bedrock: 解析用Lambda(pdf_processor) から Claude を呼び出すための設定
# S3から取得したPDF本体をConverse APIのdocument入力でClaudeへ渡し、要約させます。
# ============================================================

# 使用する推論プロファイル「JP Anthropic Claude Haiku 4.5」のID。
# `aws bedrock list-inference-profiles --region ap-northeast-1` で確認した値です。
# 推論プロファイルは、リクエストを日本国内のリージョン（東京・大阪）に振り分けてくれる仕組みです。
locals {
  bedrock_inference_profile_id = "jp.anthropic.claude-haiku-4-5-20251001-v1:0"
}

# 推論プロファイルの情報をAWSから取得します。
# 振り分け先となる基盤モデルのARN（東京・大阪の2つ）をここから取り出し、IAMポリシーで使います。
data "aws_bedrock_inference_profile" "claude_haiku_jp" {
  inference_profile_id = local.bedrock_inference_profile_id
}

# 最小権限: Claude Haiku 4.5 の呼び出し（bedrock:InvokeModel）だけを許可します。
# Converse API も内部的にはこの権限で認可されます。
resource "aws_iam_role_policy" "pdf_processor_lambda_bedrock" {
  name = "${var.project_name}-${var.environment}-pdf-processor-bedrock-policy"
  role = aws_iam_role.pdf_processor_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ① JP推論プロファイルそのものの呼び出しを許可
        Sid      = "InvokeJpInferenceProfile"
        Effect   = "Allow"
        Action   = "bedrock:InvokeModel"
        Resource = data.aws_bedrock_inference_profile.claude_haiku_jp.inference_profile_arn
      },
      {
        # ② 推論プロファイルが振り分ける先の基盤モデル（東京・大阪）の呼び出しを許可。
        # Condition により「JP推論プロファイル経由の呼び出し」に限定し、
        # 基盤モデルを直接呼び出すことはできないようにしています。
        Sid      = "InvokeFoundationModelViaJpProfile"
        Effect   = "Allow"
        Action   = "bedrock:InvokeModel"
        Resource = [for m in data.aws_bedrock_inference_profile.claude_haiku_jp.models : m.model_arn]
        Condition = {
          StringEquals = {
            "bedrock:InferenceProfileArn" = data.aws_bedrock_inference_profile.claude_haiku_jp.inference_profile_arn
          }
        }
      }
    ]
  })
}
