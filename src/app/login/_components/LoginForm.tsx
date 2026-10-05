"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "aws-amplify/auth";
import { AUTH_CONFIG_MISSING_MESSAGE, useAuth } from "../../_components/AuthProvider";
import NewPasswordForm from "./NewPasswordForm";
import { getAuthErrorMessage } from "./authErrors";

// signIn: メールアドレス＋パスワードの入力 / newPassword: 仮パスワードから新しいパスワードへの変更
type Step = "signIn" | "newPassword";

const inputClassName =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50";

export default function LoginForm() {
  const { status, isConfigured, refreshAuth } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>("signIn");
  const [email, setEmail] = useState("");
  // パスワードはフォーム入力中だけ保持し、ログイン処理が終わったらすぐ消します
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ログイン済みならトップ画面へ移動します（ログイン成功直後もここで移動します）
  useEffect(() => {
    if (status === "signedIn") {
      router.replace("/");
    }
  }, [status, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      // SRP方式: パスワードそのものは送らず、パスワードから計算した「証明」だけを Cognito に送ります
      const { nextStep } = await signIn({
        username: email.trim(),
        password,
        options: { authFlowType: "USER_SRP_AUTH" },
      });

      switch (nextStep.signInStep) {
        case "DONE":
          // トークンは Amplify が sessionStorage に保存済みです。状態を読み直すと、上の useEffect が / へ移動します
          await refreshAuth();
          break;
        case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
          // FORCE_CHANGE_PASSWORD（仮パスワード）のユーザーは、新しいパスワードの設定へ進みます
          setStep("newPassword");
          break;
        case "RESET_PASSWORD":
          setErrorMessage("パスワードのリセットが必要です。管理者に連絡してください。");
          break;
        default:
          setErrorMessage(
            "このアカウントには追加の認証設定が必要です。管理者に連絡してください。"
          );
      }
    } catch (error) {
      // すでにログイン済み（別タブでログインした直後など）なら、状態を読み直してトップ画面へ移動します
      if (error instanceof Error && error.name === "UserAlreadyAuthenticatedException") {
        await refreshAuth();
      } else {
        setErrorMessage(getAuthErrorMessage(error));
      }
    } finally {
      setPassword("");
      setIsSubmitting(false);
    }
  };

  const handleRestart = (message: string | null) => {
    setStep("signIn");
    setErrorMessage(message);
  };

  if (!isConfigured) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm leading-relaxed text-red-700">
        {AUTH_CONFIG_MISSING_MESSAGE}
      </p>
    );
  }

  if (status !== "signedOut") {
    return <p className="text-center text-sm text-gray-500">ログイン状態を確認しています…</p>;
  }

  if (step === "newPassword") {
    return <NewPasswordForm onCompleted={refreshAuth} onRestart={handleRestart} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h1 className="text-lg font-semibold text-gray-900">ログイン</h1>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          メールアドレス
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isSubmitting}
          className={inputClassName}
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          パスワード
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          className={inputClassName}
        />
      </div>

      {errorMessage && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "ログイン中…" : "ログイン"}
      </button>
    </form>
  );
}
