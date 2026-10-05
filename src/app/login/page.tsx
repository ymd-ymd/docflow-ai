import type { Metadata } from "next";
import LoginForm from "./_components/LoginForm";

export const metadata: Metadata = {
  title: "ログイン | DocFlow AI",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-gray-50 px-6 py-12 text-gray-900">
      <div className="w-full max-w-md">
        <p className="text-center text-2xl font-bold tracking-tight text-gray-900">
          DocFlow AI
        </p>
        <div className="mt-8 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
