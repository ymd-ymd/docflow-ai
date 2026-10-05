"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Amplify } from "aws-amplify";
import { getCurrentUser, signOut as amplifySignOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { Hub, sessionStorage } from "aws-amplify/utils";

// Cognito の User Pool ID と App Client ID は .env.local から読み込みます。
// どちらも秘密の値ではありませんが、環境ごとに変わるためソースコードには書きません
const USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const USER_POOL_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;

export const AUTH_CONFIG_MISSING_MESSAGE =
  "ログインの設定がありません。.env.local に NEXT_PUBLIC_COGNITO_USER_POOL_ID と NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID を設定し、開発サーバーを再起動してください。";

const isAuthConfigured = Boolean(USER_POOL_ID && USER_POOL_CLIENT_ID);

if (USER_POOL_ID && USER_POOL_CLIENT_ID) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: USER_POOL_ID,
        userPoolClientId: USER_POOL_CLIENT_ID,
      },
    },
  });
  // トークンの保存・更新・削除はすべて Amplify に任せます。
  // 保存先は sessionStorage（タブを閉じると消える）にし、ブラウザに長く残らないようにします
  cognitoUserPoolsTokenProvider.setKeyValueStorage(sessionStorage);
}

// Amplify が保存しているトークンから、ログイン中のユーザーを取得します。
// 有効なトークンがなければ（＝未ログイン） null を返します
const loadCurrentUser = async () => {
  try {
    const user = await getCurrentUser();
    return { email: user.signInDetails?.loginId ?? null };
  } catch {
    return null;
  }
};

// loading: ログイン状態を確認中 / signedIn: ログイン中 / signedOut: 未ログイン
type AuthStatus = "loading" | "signedIn" | "signedOut";

type AuthContextValue = {
  status: AuthStatus;
  // ログイン中のメールアドレス（画面表示用）
  email: string | null;
  isConfigured: boolean;
  // Amplify が保存しているトークンから、ログイン状態を読み直します
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    isAuthConfigured ? "loading" : "signedOut"
  );
  const [email, setEmail] = useState<string | null>(null);

  const applyUser = useCallback((user: { email: string | null } | null) => {
    setEmail(user?.email ?? null);
    setStatus(user ? "signedIn" : "signedOut");
  }, []);

  const refreshAuth = useCallback(async () => {
    if (!isAuthConfigured) return;
    applyUser(await loadCurrentUser());
  }, [applyUser]);

  const signOut = useCallback(async () => {
    try {
      // Cognito 側でリフレッシュトークンを無効化し、sessionStorage のトークンも削除します
      await amplifySignOut();
    } finally {
      // 通信に失敗しても、画面上はログアウト状態にします
      setEmail(null);
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    if (!isAuthConfigured) return;

    // 画面を開いたとき（再読み込みを含む）に、ログイン済みかどうかを確認します
    loadCurrentUser().then(applyUser);

    // ログイン・ログアウト時と、トークンの自動更新に失敗した（リフレッシュトークンの期限切れなど）ときに、状態を読み直します
    return Hub.listen("auth", ({ payload }) => {
      if (
        payload.event === "signedIn" ||
        payload.event === "signedOut" ||
        payload.event === "tokenRefresh_failure"
      ) {
        refreshAuth();
      }
    });
  }, [applyUser, refreshAuth]);

  return (
    <AuthContext.Provider
      value={{
        status,
        email,
        isConfigured: isAuthConfigured,
        refreshAuth,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth は AuthProvider の内側で使ってください。");
  }
  return context;
}
