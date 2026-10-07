"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  getIdleMinutes,
  getLastActivityAt,
  getStoredUser,
  getToken,
  goToLogin,
  markActivity,
  roleLabel,
  saveUser,
} from "@/lib/auth";
import type { UserPublic } from "@/lib/types";

// ログインしなくても開ける画面
const PUBLIC_PATHS = ["/login"];

const AuthContext = createContext<UserPublic | null>(null);

/** ログイン中の職員。AuthShell の内側でだけ使う(未ログインならそもそも中身を表示しない)。 */
export function useCurrentUser(): UserPublic {
  const user = useContext(AuthContext);
  if (!user) throw new Error("useCurrentUser は AuthShell の内側で使ってください");
  return user;
}

/** 役割ごとの最初の画面 */
export function homePathFor(user: UserPublic): string {
  if (user.must_change_password) return "/change-password";
  return user.role === "admin" ? "/admin" : "/";
}

function isAllowedPath(user: UserPublic, pathname: string): boolean {
  if (pathname === "/change-password") return true;
  if (user.must_change_password) return false;
  // 管理者は職員管理だけ(カルテは見られない)。医師・看護師は職員管理を開けない
  return user.role === "admin" ? pathname.startsWith("/admin") : !pathname.startsWith("/admin");
}

export default function AuthShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const [user, setUser] = useState<UserPublic | null>(null);

  // 画面を開いたとき: ログインしていなければログイン画面へ。していれば最新の状態をサーバーに確認する
  useEffect(() => {
    if (isPublic) return;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setUser(getStoredUser());
    api
      .me()
      .then((me) => {
        saveUser(me);
        setUser(me);
      })
      .catch(() => {
        // 401 なら api 側でログイン画面へ移動済み
      });
  }, [isPublic, pathname, router]);

  // 役割に合わない画面を開こうとしたら、その人の最初の画面へ
  useEffect(() => {
    if (user && !isPublic && !isAllowedPath(user, pathname)) router.replace(homePathFor(user));
  }, [user, pathname, isPublic, router]);

  // 自動ログアウト: 人の操作(マウス・キー・タッチ)が一定時間なければ、画面を閉じてログイン画面へ。
  // 録音中は音声が届くたびに markActivity() されるので切れない。
  useEffect(() => {
    if (isPublic || !user) return;
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, markActivity, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - getLastActivityAt() > getIdleMinutes() * 60_000) {
        api.logout().catch(() => undefined);
        goToLogin("idle");
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, markActivity));
      clearInterval(timer);
    };
  }, [isPublic, user]);

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    goToLogin("manual");
  }

  const header = (
    <header className="bg-clinic-primary text-white px-6 py-3 shadow-sm flex items-center justify-between gap-3">
      <h1 className="text-lg font-semibold tracking-wide">医療AI 診察支援システム</h1>
      {user && !isPublic && (
        <div className="flex items-center gap-3 text-sm">
          <span>
            {user.display_name}
            <span className="ml-1.5 text-xs bg-white/20 rounded px-1.5 py-0.5">{roleLabel[user.role]}</span>
          </span>
          <button onClick={handleLogout} className="text-xs border border-white/60 rounded px-2 py-1 hover:bg-white/10">
            ログアウト
          </button>
        </div>
      )}
    </header>
  );

  if (isPublic) {
    return (
      <>
        {header}
        <main className="p-4 md:p-6 max-w-6xl mx-auto">{children}</main>
      </>
    );
  }

  // ログインの確認が終わるまで、患者情報を含む中身は一切描画しない
  const ready = user && isAllowedPath(user, pathname);
  return (
    <AuthContext.Provider value={user}>
      {header}
      <main className="p-4 md:p-6 max-w-6xl mx-auto">
        {ready ? children : <p className="text-gray-500">確認中...</p>}
      </main>
    </AuthContext.Provider>
  );
}
