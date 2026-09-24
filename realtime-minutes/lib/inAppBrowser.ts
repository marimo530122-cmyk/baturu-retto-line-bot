/**
 * 代表的なSNSアプリ内ブラウザ(WebView)の判定。
 * 誤検知で通常のブラウザに案内を出さないよう、各アプリが User-Agent に付ける
 * 固有の識別子だけを見る(Chrome/Safari/Brave/Edge/Firefox 等はどれにも該当しない)。
 */
const IN_APP_BROWSERS: { name: string; pattern: RegExp }[] = [
  // TikTok: "musical_ly_xx", "BytedanceWebview", "TikTok xx.x" 等
  { name: "TikTok", pattern: /musical_ly|BytedanceWebview|\bTikTok\b/i },
  // LINE: "Line/13.x.x"(大文字小文字を区別し、"Online/" 等の部分一致を防ぐ)
  { name: "LINE", pattern: /\bLine\/\d/ },
  { name: "Instagram", pattern: /\bInstagram\b/ },
  // Facebook / Messenger: "FBAN/FBIOS", "FBAV/xxx", "FB_IAB/FB4A"
  { name: "Facebook", pattern: /\bFBAN\/|\bFBAV\/|\bFB_IAB\/|\bFBIOS\b/ },
  // Twitter/X: "Twitter for iPhone", "TwitterAndroid"
  { name: "X(Twitter)", pattern: /\bTwitter/ },
];

/** アプリ内ブラウザならアプリ名を、通常のブラウザなら null を返す */
export function detectInAppBrowser(userAgent: string): string | null {
  for (const { name, pattern } of IN_APP_BROWSERS) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

/**
 * アプリ内ブラウザから標準ブラウザへ飛ばすためのURLを作る。どのアプリでも確実に動く方法はないため、
 * 失敗した場合に備えて画面側では必ずURLコピーも併用する。
 * - LINE: 公式の `openExternalBrowser=1` パラメータで既定のブラウザが開く
 * - Android: intent:// で Chrome を指定して開く
 * - iOSはJSからの確実な自動脱出手段がないため(TikTok/Xの内部ブラウザも同様)、
 *   ここでは何もせず、呼び出し側の案内画面(番号手順+URLコピー)に任せる。
 */
export function buildExternalBrowserUrl(appName: string, href: string, userAgent: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (appName === "LINE") {
    url.searchParams.set("openExternalBrowser", "1");
    return url.toString();
  }
  if (/Android/i.test(userAgent)) {
    const rest = url.toString().replace(/^https?:\/\//, "");
    const scheme = url.protocol.replace(":", "");
    return `intent://${rest}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  }
  return null;
}
