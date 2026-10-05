"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

// ログイン中だけ children を表示します。未ログインなら /login へ移動します。
// 確認が終わるまでは children を表示しないので、PDF画面が一瞬見えてしまうこともありません。
// 注意: これは画面を隠すだけです。API Gateway 側の認証は別途設定が必要です
export default function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status !== "signedIn") {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center bg-white">
        <p className="text-sm text-gray-500">ログイン状態を確認しています…</p>
      </div>
    );
  }

  return <>{children}</>;
}
