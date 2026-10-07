// ログイン状態の保持。
// トークンは sessionStorage に置く(ブラウザのタブを閉じると消える。共用PCに残りにくいように)。
// 本当の自動ログアウトの判定はサーバー側で行い、こちらは「画面を放置したら閉じる」ための補助。
import type { UserPublic } from "./types";

const TOKEN_KEY = "medical-ai.token";
const USER_KEY = "medical-ai.user";
const IDLE_MINUTES_KEY = "medical-ai.idle-minutes";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}

export function getStoredUser(): UserPublic | null {
  const raw = storage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserPublic;
  } catch {
    return null;
  }
}

export function getIdleMinutes(): number {
  return Number(storage()?.getItem(IDLE_MINUTES_KEY)) || 30;
}

export function saveAuth(token: string, user: UserPublic, idleMinutes: number) {
  const s = storage();
  s?.setItem(TOKEN_KEY, token);
  s?.setItem(USER_KEY, JSON.stringify(user));
  s?.setItem(IDLE_MINUTES_KEY, String(idleMinutes));
  markActivity();
}

export function saveUser(user: UserPublic) {
  storage()?.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  const s = storage();
  s?.removeItem(TOKEN_KEY);
  s?.removeItem(USER_KEY);
}

// 最後に人が操作した時刻。録音中は音声が流れている間ずっと「操作中」とみなす。
let lastActivityAt = Date.now();

export function markActivity() {
  lastActivityAt = Date.now();
}

export function getLastActivityAt(): number {
  return lastActivityAt;
}

export type LogoutReason = "idle" | "expired" | "manual";

// ログイン画面へ移動する(画面に患者情報を残さないよう、ページごと読み直す)
export function goToLogin(reason: LogoutReason, message?: string) {
  clearAuth();
  if (typeof window === "undefined") return;
  const params = new URLSearchParams({ reason });
  if (message) params.set("message", message);
  if (window.location.pathname !== "/login") {
    window.location.href = `/login?${params.toString()}`;
  }
}

export const roleLabel: Record<UserPublic["role"], string> = {
  doctor: "医師",
  nurse: "看護師",
  admin: "管理者",
};
