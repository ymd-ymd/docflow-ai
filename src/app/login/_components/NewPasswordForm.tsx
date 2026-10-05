"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { confirmSignIn } from "aws-amplify/auth";
import { getAuthErrorMessage, isSessionExpiredError } from "./authErrors";

const inputClassName =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50";

// terraform/cognito.tf の password_policy と同じルールです。
// 画面では目安として表示し、最終的な判定は Cognito が行います
const PASSWORD_RULES = [
  { label: "12文字以上", test: (value: string) => value.length >= 12 },
  { label: "英大文字を含む", test: (value: string) => /[A-Z]/.test(value) },
  { label: "英小文字を含む", test: (value: string) => /[a-z]/.test(value) },
  { label: "数字を含む", test: (value: string) => /[0-9]/.test(value) },
  { label: "記号を含む", test: (value: string) => /[^A-Za-z0-9\s]/.test(value) },
];

type NewPasswordFormProps = {
  // 新しいパスワードの設定とログインが完了したときに呼ばれます
  onCompleted: () => Promise<void>;
  // 最初のログイン画面に戻します（message はログイン画面に表示するメッセージ）
  onRestart: (message: string | null) => void;
};

export default function NewPasswordForm({ onCompleted, onRestart }: NewPasswordFormProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage("確認用のパスワードが一致しません。");
      return;
    }

    setIsSubmitting(true);
    try {
      // Amplify が覚えているログイン途中の情報（約3分有効）を使って、Cognito に新しいパスワードを送ります
      const { nextStep } = await confirmSignIn({ challengeResponse: newPassword });

      if (nextStep.signInStep === "DONE") {
        await onCompleted();
        return;
      }
      setErrorMessage("このアカウントには追加の認証設定が必要です。管理者に連絡してください。");
    } catch (error) {
      // 有効期限切れの場合は、仮パスワードでのログインからやり直してもらいます
      if (isSessionExpiredError(error)) {
        onRestart(getAuthErrorMessage(error));
        return;
      }
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setNewPassword("");
      setConfirmPassword("");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">新しいパスワードの設定</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          初回ログインのため、仮パスワードを新しいパスワードに変更してください。
        </p>
      </div>

      <div>
        <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
          新しいパスワード
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={isSubmitting}
          className={inputClassName}
        />
        <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
          {PASSWORD_RULES.map((rule) => {
            const passed = rule.test(newPassword);
            return (
              <li key={rule.label} className={passed ? "text-green-700" : "text-gray-500"}>
                {passed ? "✓" : "・"} {rule.label}
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
          新しいパスワード（確認用）
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
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
        {isSubmitting ? "設定中…" : "パスワードを設定してログイン"}
      </button>

      <button
        type="button"
        onClick={() => onRestart(null)}
        disabled={isSubmitting}
        className="w-full text-sm text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed"
      >
        ログイン画面に戻る
      </button>
    </form>
  );
}
