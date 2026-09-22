output "bucket_name" {
  description = "作成されたS3バケットの名前"
  value       = aws_s3_bucket.uploads.id
}

output "bucket_arn" {
  description = "作成されたS3バケットのARN（AWSリソースを一意に示すID）"
  value       = aws_s3_bucket.uploads.arn
}
