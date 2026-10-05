import { fetchAuthSession } from "aws-amplify/auth";

export const AUTH_EXPIRED_MESSAGE =
  "ログインの有効期限が切れたか、ログイン情報を確認できませんでした。お手数ですが、ログインし直してください。";

// API Gateway を呼び出すときに付ける Authorization ヘッダーを返します。
// トークンは変数などに保存せず、毎回 Amplify から取り出します
// （アクセストークンの期限が切れていれば、Amplify がリフレッシュトークンで自動更新します）。
// 注意: S3 の Presigned URL への PUT には付けないでください（URL自体が許可証のため、S3がエラーにします）
export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  let accessToken: string | undefined;
  try {
    const { tokens } = await fetchAuthSession();
    accessToken = tokens?.accessToken?.toString();
  } catch {
    accessToken = undefined;
  }

  if (!accessToken) {
    throw new Error(AUTH_EXPIRED_MESSAGE);
  }
  return { Authorization: `Bearer ${accessToken}` };
};
