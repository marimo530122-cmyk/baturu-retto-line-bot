/**
 * スマホのSNSアプリ内ブラウザ(TikTok, LINE, Instagram, Facebook, X/Twitter)検知。
 *
 * 各アプリが自分のWebViewに付与する固有のUAトークンだけを見て判定する
 * (例: LINEは "Line/12.5.0"、Instagramは "Instagram 123.0.0" を含む)。
 * これらのトークンは通常のChrome/Safari本体のUAには絶対に出現しないため、
 * 「検知したのに実は通常ブラウザだった」という誤検知はほぼ起こらない。
 * 逆に、アプリ側がUAを変えて非対応になる(誤検知ゼロ・見逃し発生)ことはあり得る
 * (実装後の報告を参照)。
 */

export type InAppBrowserApp = "tiktok" | "line" | "instagram" | "facebook" | "twitter";

const APP_LABELS: Record<InAppBrowserApp, string> = {
  tiktok: "TikTok",
  line: "LINE",
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X (Twitter)",
};

// Android上で intent:// によるChromeへの自動脱出が期待できるアプリ。
// TikTokとXはJSからの自動脱出をブロックしていることが分かっているため対象外。
const ANDROID_INTENT_ESCAPABLE: ReadonlySet<InAppBrowserApp> = new Set(["line", "instagram", "facebook"]);

export interface InAppBrowserInfo {
  app: InAppBrowserApp;
  label: string;
  isAndroid: boolean;
  isIOS: boolean;
  /** Android + intent:// 脱出が期待できる組み合わせか */
  canAutoEscape: boolean;
}

function detectApp(ua: string): InAppBrowserApp | null {
  if (/BytedanceWebview|musical_ly|TikTok/i.test(ua)) return "tiktok";
  if (/\bLine\//.test(ua)) return "line";
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "facebook";
  if (/Twitter for iPhone|Twitter for iPad|TwitterAndroid/i.test(ua)) return "twitter";
  return null;
}

export function detectInAppBrowser(userAgent: string): InAppBrowserInfo | null {
  const app = detectApp(userAgent);
  if (!app) return null;

  const isAndroid = /Android/.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/.test(userAgent);

  return {
    app,
    label: APP_LABELS[app],
    isAndroid,
    isIOS,
    canAutoEscape: isAndroid && ANDROID_INTENT_ESCAPABLE.has(app),
  };
}

/** 現在のURLをAndroidのChromeで開き直すための intent:// URLを組み立てる */
export function buildChromeIntentUrl(url: string): string {
  const parsed = new URL(url);
  const scheme = parsed.protocol.replace(":", "");
  const rest = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  return `intent://${rest}#Intent;scheme=${scheme};package=com.android.chrome;end`;
}
