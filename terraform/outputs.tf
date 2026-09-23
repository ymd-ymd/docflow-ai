output "bucket_name" {
  description = "作成されたS3バケットの名前"
  value       = aws_s3_bucket.uploads.id
}

output "bucket_arn" {
  description = "作成されたS3バケットのARN（AWSリソースを一意に示すID）"
  value       = aws_s3_bucket.uploads.arn
}

output "api_url" {
  description = "Presigned URL発行APIのエンドポイント（この後ろに /upload-url を付けてPOSTしてください）"
  value       = aws_apigatewayv2_stage.default.invoke_url
}
