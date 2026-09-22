variable "aws_region" {
  description = "リソースを作成するAWSリージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "プロジェクト名。S3バケット名の一部として使われます"
  type        = string
  default     = "docflow-ai"
}

variable "environment" {
  description = "環境名（例: dev, stg, prod）。S3バケット名の一部として使われます"
  type        = string
  default     = "dev"
}
