// 戦国シールド: Twilio の電話番号にかかってきた電話にAIが応対するWebサーバー
//
// Twilio 側の設定(電話番号の Voice Configuration):
//   A call comes in  → POST  <SHIELD_PUBLIC_URL>/voice/incoming
//   Call status changes → POST <SHIELD_PUBLIC_URL>/voice/status

const http = require("http");
const { isValidSignature, say, gather, twiml, escapeXml } = require("./lib/twilio");
const { score } = require("./lib/detector");
const decoy = require("./lib/decoy");
const store = require("./lib/store");
const { notifyOwner } = require("./lib/notify");
const jev = require("./lib/jev");
const { maskPhone } = require("./lib/mask");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.SHIELD_PUBLIC_URL || "").replace(/\/$/, "");
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
// ローカルで curl から試すときだけ 1 にする(本番では絶対に使わない)
const SKIP_SIGNATURE = process.env.SHIELD_SKIP_SIGNATURE === "1";

// 家族・知人など、AIを通さず転送する番号(カンマ区切り、+81形式)
const ALLOWLIST = new Set(
  (process.env.SHIELD_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean)
);
const FORWARD_TO = process.env.SHIELD_FORWARD_TO;

// 1通話あたりの上限(料金の青天井を防ぐ)
const MAX_TURNS = Number(process.env.SHIELD_MAX_TURNS || 20);
const MAX_CALL_SEC = Number(process.env.SHIELD_MAX_CALL_SEC || 600);
const MAX_SILENCE = 3;

// 冒頭アナウンス: やっていないことは言わない(虚偽告知にならないよう、事実だけを告げる)
const GREETING =
  "お電話ありがとうございます。この電話は、詐欺電話対策のため自動応答システムが応対しており、" +
  "通話内容は記録されます。ご用件をお話しください。";
const CLOSING = "お話はうかがいました。確認して、必要があればこちらからご連絡します。失礼します。";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on("error", reject);
  });
}

function sendXml(res, body) {
  res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
  res.end(twiml(body));
}

function newCall(params) {
  return {
    callSid: params.CallSid,
    from: params.From || "",
    to: params.To || "",
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationSec: null,
    turns: 0,
    silence: 0,
    history: [],
    detection: score([]),
    notified: false,
  };
}

function callerUtterances(call) {
  return call.history.filter((h) => h.role === "caller").map((h) => h.text);
}

async function handleIncoming(params, res) {
  if (ALLOWLIST.has(params.From) && FORWARD_TO) {
    return sendXml(res, `<Dial>${escapeXml(FORWARD_TO)}</Dial>`);
  }
  const call = newCall(params);
  call.history.push({ role: "shield", text: GREETING, source: "fixed" });
  store.save(call);
  console.log(`[incoming] ${call.callSid} from ${maskPhone(call.from)}`);
  sendXml(res, gather("/voice/turn", say(GREETING)) + `<Redirect method="POST">/voice/turn</Redirect>`);
}

async function handleTurn(params, res) {
  const call = store.load(params.CallSid) || newCall(params);
  const speech = (params.SpeechResult || "").trim();
  const elapsedSec = (Date.now() - new Date(call.startedAt).getTime()) / 1000;

  if (speech) {
    call.silence = 0;
    call.history.push({ role: "caller", text: speech, at: new Date().toISOString() });
    call.detection = score(callerUtterances(call));
  } else {
    call.silence += 1;
  }

  if (call.turns >= MAX_TURNS || elapsedSec >= MAX_CALL_SEC || call.silence >= MAX_SILENCE) {
    call.history.push({ role: "shield", text: CLOSING, source: "fixed" });
    store.save(call);
    return sendXml(res, say(CLOSING) + "<Hangup/>");
  }

  call.turns += 1;
  const answer = speech
    ? await decoy.reply(call.history, call.turns)
    : { text: decoy.stallPhrase(call.turns), source: "fixed(silence)" };
  call.history.push({ role: "shield", text: answer.text, source: answer.source });
  store.save(call);
  console.log(`[turn] ${call.callSid} #${call.turns} ${call.detection.label} (${answer.source})`);
  sendXml(res, gather("/voice/turn", say(answer.text)) + `<Redirect method="POST">/voice/turn</Redirect>`);
}

async function handleStatus(params, res) {
  res.writeHead(204);
  res.end();
  if (!["completed", "busy", "failed", "no-answer", "canceled"].includes(params.CallStatus)) return;
  const call = store.load(params.CallSid);
  if (!call) return;
  call.endedAt = new Date().toISOString();
  call.durationSec = Number(params.CallDuration) || null;
  call.detection = score(callerUtterances(call));
  call.jev = await jev.judgeCall(call.history);
  call.verdict = jev.combine(call.detection, call.jev);
  if (call.verdict.level === "high" && !call.notified) {
    call.notified = await notifyOwner(call).catch((err) => {
      console.error("[notify]", err.message);
      return false;
    });
  }
  store.save(call);
  console.log(`[done] ${call.callSid} ${call.durationSec}s ${call.verdict.label} (${call.verdict.by})`);
}

const ROUTES = {
  "/voice/incoming": handleIncoming,
  "/voice/turn": handleTurn,
  "/voice/status": handleStatus,
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  const handler = ROUTES[pathname];
  if (req.method !== "POST" || !handler) {
    res.writeHead(404);
    return res.end();
  }
  try {
    const params = await readBody(req);
    if (!SKIP_SIGNATURE) {
      const signature = req.headers["x-twilio-signature"];
      if (!isValidSignature(AUTH_TOKEN, signature, PUBLIC_URL + req.url, params)) {
        res.writeHead(403);
        return res.end();
      }
    }
    if (!/^[A-Za-z0-9]+$/.test(params.CallSid || "")) {
      res.writeHead(400);
      return res.end();
    }
    await handler(params, res);
  } catch (err) {
    console.error("[error]", err);
    if (!res.headersSent) sendXml(res, say(CLOSING) + "<Hangup/>");
  }
});

if (require.main === module) {
  if (!SKIP_SIGNATURE && (!AUTH_TOKEN || !PUBLIC_URL)) {
    console.error("TWILIO_AUTH_TOKEN と SHIELD_PUBLIC_URL を設定してください。");
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`戦国シールド起動: port ${PORT}(AI応答: ${process.env.ANTHROPIC_API_KEY ? "ON" : "OFF(固定文面)"} / Jev判定: ${jev.enabled() ? "ON" : "OFF"})`);
  });
}

module.exports = { server };
