// 不正アクセスの見張り番(外部のパッケージなし・メモリだけで動く)
//
// - 同じ相手(IP)からの連打を止める(1分あたりの上限を超えたら 429)
// - 合言葉・署名の間違い(401/403)が続いた相手を、しばらく締め出す(総当たり対策)
// - 間違い・サーバーエラー(5xx)・アクセス全体が急に増えたら、開発者の Discord / Slack に知らせる
//
// 知らせ先は SHIELD_ALERT_WEBHOOK_URL(Discord か Slack の Incoming Webhook のURL)。
// 空なら知らせはサーバーのログ([security])に出すだけで、止める働きはそのまま動く。
// 再起動すると数え直しになる(Render の1台構成ならこれで足りる。複数台にするなら Redis などに移す)。

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const LIMITS = {
  perIpPerMin: num("SHIELD_RATE_PER_MIN", 120),
  authFailPerIp: num("SHIELD_AUTH_FAIL_LIMIT", 10),
  lockMs: num("SHIELD_LOCK_MIN", 15) * 60_000,
  // ここから下は「知らせる」しきい値(5分あたり)
  alertAuthFail: num("SHIELD_ALERT_AUTH_FAIL", 20),
  alertServerError: num("SHIELD_ALERT_5XX", 5),
  alertTotal: num("SHIELD_ALERT_TOTAL", 3000),
};
const WINDOW_MS = 5 * 60_000;
const ALERT_COOLDOWN_MS = 10 * 60_000;

const perIp = new Map(); // ip -> { minuteStart, minuteCount, failStart, failCount, lockedUntil }
let global = { start: 0, total: 0, authFail: 0, serverError: 0 };
const lastAlert = new Map(); // 種類 -> 最後に知らせた時刻(同じ知らせを連発しない)

// Render などの中継サーバーの後ろでは、本当の相手のIPは X-Forwarded-For の先頭に入る
function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (fwd || req.socket.remoteAddress || "unknown").slice(0, 64);
}

function entry(ip, now) {
  let e = perIp.get(ip);
  if (!e) {
    e = { minuteStart: now, minuteCount: 0, failStart: now, failCount: 0, lockedUntil: 0 };
    perIp.set(ip, e);
  }
  return e;
}

function sweep(now) {
  if (now - global.start >= WINDOW_MS) global = { start: now, total: 0, authFail: 0, serverError: 0 };
  if (perIp.size < 5000) return;
  for (const [ip, e] of perIp) {
    if (e.lockedUntil < now && now - e.minuteStart > WINDOW_MS && now - e.failStart > WINDOW_MS) perIp.delete(ip);
  }
}

// 処理の前に呼ぶ。止めるべきなら理由を返す(null なら通してよい)
function check(ip, now = Date.now()) {
  sweep(now);
  global.total += 1;
  if (global.total === LIMITS.alertTotal) {
    alert("flood", `5分間のアクセスが ${LIMITS.alertTotal} 回に達しました(DDoS の可能性)`);
  }
  const e = entry(ip, now);
  if (e.lockedUntil > now) return "locked";
  if (now - e.minuteStart >= 60_000) {
    e.minuteStart = now;
    e.minuteCount = 0;
  }
  e.minuteCount += 1;
  if (e.minuteCount > LIMITS.perIpPerMin) {
    if (e.minuteCount === LIMITS.perIpPerMin + 1) {
      alert(`rate:${ip}`, `${ip} から1分間に ${LIMITS.perIpPerMin} 回を超えるアクセス(連打・攻撃の可能性)。429 で止めています`);
    }
    return "rate";
  }
  return null;
}

// 応答を返した後に呼ぶ(結果の数を数えて、締め出し・知らせを決める)
function record(ip, status, pathname, now = Date.now()) {
  if (status === 401 || status === 403) {
    global.authFail += 1;
    if (global.authFail === LIMITS.alertAuthFail) {
      alert("authfail", `5分間で合言葉・署名の間違い(401/403)が ${LIMITS.alertAuthFail} 回(総当たり攻撃の可能性)。最後: ${ip} ${pathname}`);
    }
    const e = entry(ip, now);
    if (now - e.failStart > WINDOW_MS * 2) {
      e.failStart = now;
      e.failCount = 0;
    }
    e.failCount += 1;
    if (e.failCount >= LIMITS.authFailPerIp && e.lockedUntil <= now) {
      e.lockedUntil = now + LIMITS.lockMs;
      alert(`lock:${ip}`, `${ip} が合言葉・署名を ${e.failCount} 回間違えたので ${LIMITS.lockMs / 60_000} 分締め出しました`);
    }
  } else if (status >= 500) {
    global.serverError += 1;
    if (global.serverError === LIMITS.alertServerError) {
      alert("5xx", `5分間でサーバーエラー(5xx)が ${LIMITS.alertServerError} 回。最後: ${pathname}`);
    }
  }
}

function alert(kind, message, now = Date.now()) {
  if (now - (lastAlert.get(kind) || 0) < ALERT_COOLDOWN_MS) return;
  lastAlert.set(kind, now);
  const text = `【鮮刻シールド 警報】${message}`;
  console.warn(`[security] ${text}`);
  const url = process.env.SHIELD_ALERT_WEBHOOK_URL;
  if (!url) return;
  // Discord は content、Slack は text で受け取る
  const body = /discord(app)?\.com\/api\/webhooks\//.test(url) ? { content: text } : { text };
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => console.error("[security] 通知に失敗:", err.message));
}

// どの応答にも付ける、ブラウザ向けの守りの設定
function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=()");
}

function _reset() {
  perIp.clear();
  lastAlert.clear();
  global = { start: 0, total: 0, authFail: 0, serverError: 0 };
}

module.exports = { clientIp, check, record, alert, securityHeaders, LIMITS, _reset };
