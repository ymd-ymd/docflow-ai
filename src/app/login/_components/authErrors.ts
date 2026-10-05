// Amplify / Cognito のエラーを、画面に表示する日本語のメッセージに変換します。
// エラーの中身（入力したパスワードなど）を console.log に出さないため、ここで name と message だけを見ます

export const SESSION_EXPIRED_MESSAGE =
  "手続きの有効期限（約3分）が切れました。お手数ですが、最初からログインし直してください。";

export const isSessionExpiredError = (error: unknown) =>
  error instanceof Error &&
  // SignInException: 再読み込みなどで、Amplify が覚えていたログイン途中の情報が消えた
  (error.name === "SignInException" ||
    (error.name === "NotAuthorizedException" &&
      /session/i.test(error.message)));

export const getAuthErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) {
    return "予期しないエラーが発生しました。";
  }

  if (isSessionExpiredError(error)) {
    return SESSION_EXPIRED_MESSAGE;
  }

  switch (error.name) {
    case "NotAuthorizedException":
      if (/attempts exceeded/i.test(error.message)) {
        return "ログインの失敗が続いたため、一時的にロックされています。しばらく待ってから再度お試しください。";
      }
      if (/temporary password has expired/i.test(error.message)) {
        return "仮パスワードの有効期限が切れています。管理者に仮パスワードの再発行を依頼してください。";
      }
      // 存在しないユーザーの場合も同じエラーになります（登録済みかどうかを第三者に知られないため）
      return "メールアドレスまたはパスワードが違います。";
    case "UserNotFoundException":
      return "メールアドレスまたはパスワードが違います。";
    case "InvalidPasswordException":
      return "パスワードのルールを満たしていません。12文字以上で、大文字・小文字・数字・記号をすべて含めてください。";
    case "InvalidParameterException":
      return "入力内容に誤りがあります。前後の空白などを確認してください。";
    case "PasswordResetRequiredException":
      return "パスワードのリセットが必要です。管理者に連絡してください。";
    case "UserNotConfirmedException":
      return "このアカウントはまだ有効化されていません。管理者に連絡してください。";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "試行回数が多すぎます。しばらく待ってから再度お試しください。";
    case "EmptySignInUsername":
    case "EmptySignInPassword":
    case "EmptyConfirmSignInChallengeResponse":
      return "未入力の項目があります。";
    case "NetworkError":
      return "通信に失敗しました。インターネット接続を確認してください。";
    default:
      return "ログインに失敗しました。時間をおいて再度お試しください。";
  }
};
