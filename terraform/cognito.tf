# ============================================================
# Amazon Cognito: ユーザーのログイン（認証）の基盤
# User Pool  = DocFlow AI専用の「会員名簿」。メールアドレスとパスワードを安全に管理します
# App Client = Next.jsの画面からこの名簿を使ってログインするための「アプリ用の登録」
#
# 注意: STEP 1では基盤を作るだけです。API Gateway・Lambda・DynamoDB・S3とはまだ接続していません。
# 開発中は管理者（AWSコンソール/CLI）が作成したユーザーだけがログインできる設定にしています。
# ============================================================

resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-${var.environment}-user-pool"

  # メールアドレスをログインIDとして使います。
  # 注意: この設定は作成後に変更できません（変更するとUser Poolが作り直しになり、全ユーザーが消えます）
  username_attributes = ["email"]

  # ログインIDの大文字・小文字を区別しません（User@Example.com と user@example.com を同じ人として扱います）。
  # この設定も作成後に変更できません
  username_configuration {
    case_sensitive = false
  }

  # メールアドレスの確認（確認コードによる本人確認）を行います
  auto_verified_attributes = ["email"]

  # メールアドレスを変更したとき、新しいアドレスの確認が済むまでは古いアドレスを有効なままにします
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  # 開発中は誰でも登録できないようにし、管理者が作成したユーザーだけを使えるようにします。
  # 知らない人がPDFを大量にアップロードし、Bedrockの料金が増えるのを防ぐためです
  admin_create_user_config {
    allow_admin_create_user_only = true

    # 管理者がユーザーを作成したときに届く招待メール（{username} と {####} はCognitoが置き換えます）
    invite_message_template {
      email_subject = "DocFlow AI アカウントのご案内"
      email_message = "DocFlow AI のアカウントが作成されました。ユーザー名: {username} / 仮パスワード: {####} 初回ログイン時に新しいパスワードを設定してください。"
      sms_message   = "DocFlow AI ユーザー名: {username} 仮パスワード: {####}"
    }
  }

  # パスワードのルール
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # パスワードを忘れたときは、確認済みのメールアドレスでリセットします
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # 確認コード方式でメールアドレスを確認します（{####} が6桁のコードに置き換わります）
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "DocFlow AI 確認コード"
    email_message        = "DocFlow AI の確認コードは {####} です。"
  }

  # Cognitoが用意したメール送信機能を使います（開発用。1日に送れる数が少ないため、本番ではSESに切り替えます）
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # 二段階認証はSTEP 1では使いません（将来 OPTIONAL にして認証アプリのコードを使えるようにする予定です）
  mfa_configuration = "OFF"

  # 誤って terraform destroy などをしても、会員名簿が削除されないようにします。
  # 本当に削除したい場合は、先にこの値を "INACTIVE" に変更して apply する必要があります
  deletion_protection = "ACTIVE"
}

# --- App Client: Next.js（ブラウザ）から使うための登録 ---
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-${var.environment}-web-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # ブラウザで動くアプリは秘密の値を隠しておけないため、クライアントシークレットは作りません
  generate_secret = false

  # 許可するログイン方式:
  #   USER_SRP_AUTH      = パスワードそのものをネットワークに送らずにログインする方式
  #   REFRESH_TOKEN_AUTH = トークンの期限が切れたとき、再ログインせずに更新する方式
  # パスワードをそのまま送る USER_PASSWORD_AUTH は許可しません
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # 「そのユーザーは存在しません」と答えないようにし、登録済みのメールアドレスを第三者に調べられないようにします
  prevent_user_existence_errors = "ENABLED"

  # ログアウト時にリフレッシュトークンを無効化できるようにします
  enable_token_revocation = true

  # トークン（ログイン済みを示す電子チケット）の有効期限
  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 7
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # アプリから読み書きできるユーザー属性をメールアドレス関連に限定します
  read_attributes  = ["email", "email_verified"]
  write_attributes = ["email"]
}
