"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { saveAuth } from "@/lib/auth";
import { homePathFor } from "@/components/AuthShell";

const reasonMessage: Record<string, string> = {
  idle: "一定時間操作がなかったため、ログアウトしました。",
  manual: "ログアウトしました。",
};

function LoginForm() {
  const params = useSearchParams();
  const reason = params.get("reason") || "";
  const notice = reasonMessage[reason] || (reason === "expired" ? params.get("message") : null);

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.login(loginId, password);
      saveAuth(result.token, result.user, result.idle_timeout_minutes);
      // ページごと移動して、前の人の画面の状態を持ち越さない
      window.location.href = homePathFor(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "サーバーにつながりませんでした。");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-12 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-xl font-bold mb-4">ログイン</h2>
      {notice && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2 mb-4">{notice}</p>
      )}
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">ログインID</span>
          <input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            className="w-full mt-1 border border-gray-300 rounded-md p-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">パスワード</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full mt-1 border border-gray-300 rounded-md p-2"
          />
        </label>
        {error && <p className="text-sm text-clinic-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-clinic-primary text-white font-medium rounded-md py-2 disabled:opacity-50"
        >
          {submitting ? "確認中..." : "ログイン"}
        </button>
      </form>
      <p className="text-xs text-gray-500 mt-4">
        IDやパスワードが分からないときは、病院の管理者に確認してください。
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
