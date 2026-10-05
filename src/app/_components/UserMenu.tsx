"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

// ヘッダー右上: ログイン中のメールアドレスとログアウトボタン
export default function UserMenu() {
  const { email, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // ログアウト後は AuthGuard が /login へ移動させます
  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut();
  };

  return (
    <div className="flex min-w-0 items-center gap-3">
      {email && (
        <span className="hidden truncate text-sm text-gray-600 sm:inline">
          {email}
        </span>
      )}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="shrink-0 rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSigningOut ? "ログアウト中…" : "ログアウト"}
      </button>
    </div>
  );
}
