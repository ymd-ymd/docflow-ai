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

output "pdf_processor_function_name" {
  description = "PDFアップロード時に自動起動する解析用Lambdaの関数名"
  value       = aws_lambda_function.pdf_processor.function_name
}

output "pdf_processor_log_group" {
  description = "解析用Lambdaのログが出力されるCloudWatch Logsのロググループ名"
  value       = aws_cloudwatch_log_group.pdf_processor.name
}
