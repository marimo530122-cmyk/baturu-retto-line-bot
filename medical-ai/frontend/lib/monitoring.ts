/**
 * エラー監視の薄いラッパー。NEXT_PUBLIC_SENTRY_DSN が未設定でも
 * (バックエンドのOPENAI_API_KEY/SENTRY_DSN同様)アプリ自体は問題なく動くようにする。
 */
let initialized = false;

export function initMonitoring(): void {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  // 動的importにして、DSN未設定の環境では読み込みコスト自体を避ける
  import("@sentry/browser")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.NODE_ENV,
        tracesSampleRate: 0.1,
        // 個人情報(URLのクエリ文字列等)を既定で送らないようにする
        sendDefaultPii: false,
      });
      initialized = true;
    })
    .catch((e) => {
      console.error("Sentry の初期化に失敗しました", e);
    });
}

/**
 * アプリ内のcatchブロックから呼ぶ共通のエラー報告関数。
 * Sentry未設定でも必ずconsole.errorには残すので、原因特定の手がかりがゼロにはならない。
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error("[medical-ai]", error, context ?? "");
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  import("@sentry/browser")
    .then((Sentry) => {
      Sentry.captureException(error, context ? { extra: context } : undefined);
    })
    .catch(() => {
      // 監視自体の読み込み失敗でアプリを止めない
    });
}
