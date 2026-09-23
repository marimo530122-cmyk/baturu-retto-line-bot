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
