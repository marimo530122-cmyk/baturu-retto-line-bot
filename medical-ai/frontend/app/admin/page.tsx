"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { roleLabel } from "@/lib/auth";
import { useCurrentUser } from "@/components/AuthShell";
import type { Role, UserPublic } from "@/lib/types";

const roles: Role[] = ["doctor", "nurse", "admin"];

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "サーバーにつながりませんでした。";
}

export default function AdminPage() {
  const me = useCurrentUser();
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("doctor");
  const [tempPassword, setTempPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api
      .listUsers()
      .then(setUsers)
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(load, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createUser({
        login_id: loginId,
        display_name: displayName,
        role,
        temporary_password: tempPassword,
      });
      setNotice(
        `「${created.display_name}」さんを登録しました。ログインID「${created.login_id}」と仮パスワードを本人に直接伝えてください(最初のログインで本人が変更します)。`
      );
      setLoginId("");
      setDisplayName("");
      setTempPassword("");
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(user: UserPublic) {
    const action = user.is_active ? "停止" : "再開";
    if (!window.confirm(`「${user.display_name}」さんのアカウントを${action}しますか?`)) return;
    setError(null);
    try {
      await api.updateUser(user.id, { is_active: !user.is_active });
      setNotice(`「${user.display_name}」さんのアカウントを${action}しました。`);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function handleReset(user: UserPublic) {
    const temporary = window.prompt(
      `「${user.display_name}」さんの仮パスワードを入力してください(10文字以上・英字と数字を含む)。\n本人は次のログインで変更します。`
    );
    if (!temporary) return;
    setError(null);
    try {
      await api.resetPassword(user.id, temporary);
      setNotice(`「${user.display_name}」さんのパスワードを再発行しました。仮パスワードを本人に直接伝えてください。`);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">職員管理</h2>
      <p className="text-sm text-gray-600">
        管理者は職員のログインIDの作成・停止・パスワード再発行だけができます(カルテは見られません)。
      </p>

      {notice && (
        <p className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-md px-3 py-2">{notice}</p>
      )}
      {error && (
        <p className="text-sm bg-red-50 border border-red-200 text-clinic-danger rounded-md px-3 py-2">{error}</p>
      )}

      <form onSubmit={handleCreate} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
        <h3 className="font-semibold">職員を登録する</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-gray-700">ログインID</span>
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              className="w-full mt-1 border border-gray-300 rounded-md p-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm text-gray-700">名前(画面に表示されます)</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full mt-1 border border-gray-300 rounded-md p-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm text-gray-700">役割</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full mt-1 border border-gray-300 rounded-md p-2 text-sm"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-gray-700">仮パスワード(10文字以上・英字と数字を含む)</span>
            <input
              type="text"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              autoComplete="off"
              required
              className="w-full mt-1 border border-gray-300 rounded-md p-2 text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="bg-clinic-primary text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
        >
          {creating ? "登録中..." : "登録する"}
        </button>
      </form>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left p-2">名前</th>
              <th className="text-left p-2">ログインID</th>
              <th className="text-left p-2">役割</th>
              <th className="text-left p-2">状態</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="p-2">{u.display_name}</td>
                <td className="p-2 font-mono text-xs">{u.login_id}</td>
                <td className="p-2">{roleLabel[u.role]}</td>
                <td className="p-2">
                  {!u.is_active ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">停止中</span>
                  ) : u.must_change_password ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">仮パスワード</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">利用中</span>
                  )}
                </td>
                <td className="p-2 text-right whitespace-nowrap space-x-2">
                  <button onClick={() => handleReset(u)} className="text-xs text-clinic-accent underline">
                    パスワード再発行
                  </button>
                  {u.id !== me.id && (
                    <button onClick={() => toggleActive(u)} className="text-xs text-clinic-danger underline">
                      {u.is_active ? "停止" : "再開"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
