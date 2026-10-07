"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { saveUser } from "@/lib/auth";
import { homePathFor, useCurrentUser } from "@/components/AuthShell";

export default function ChangePasswordPage() {
  const user = useCurrentUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("新しいパスワードが2回とも同じになるように入力してください。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.changePassword(current, next);
      saveUser(updated);
      window.location.href = homePathFor(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "サーバーにつながりませんでした。");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-12 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-xl font-bold mb-2">パスワードの変更</h2>
      {user.must_change_password && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2 mb-4">
          管理者から受け取った仮のパスワードです。使い始める前に、ご自身だけが知っているパスワードに変えてください。
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">今のパスワード</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full mt-1 border border-gray-300 rounded-md p-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">新しいパスワード</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
            className="w-full mt-1 border border-gray-300 rounded-md p-2"
          />
          <span className="text-xs text-gray-500">10文字以上で、英字と数字の両方を入れてください。</span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">新しいパスワード(確認のためもう一度)</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
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
          {submitting ? "変更中..." : "変更する"}
        </button>
      </form>
    </div>
  );
}
