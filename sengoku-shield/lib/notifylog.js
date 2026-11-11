// 通知の記録(12/15 の家族モニター実証実験用)
//
// 詐欺の疑いに気づいた時刻から、家族・持ち主への知らせ(LINE・自動電話)が終わるまでの時間と成否を、
// data/notify-log.jsonl に1件1行で追記する。実験のあとに CSV で取り出して、届いた割合と速さを数える。
//
// 個人情報は残さない: 会話の中身・電話番号・LINE のID・口座番号は書かない。
// 見守りの回(セッション)は、同じ回の知らせをまとめて数えられるよう、元に戻せない短い印(ハッシュ)にする。
//
// 記録できなかったとき・知らせが届かなかったときは、管理者に警報を出す(lib/guard.js の alert)。
// どんな場合も例外を外に出さない(記録の失敗で、家族への知らせを止めないため)。

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./store");
const guard = require("./guard");

const LOG_PATH = path.join(DATA_DIR, "notify-log.jsonl");

const COLUMNS = [
  "ts", // 知らせが終わった時刻(サーバーの時計、UTC)
  "kind", // 知らせの種類(下の KINDS)
  "session", // 見守りの回の印(ハッシュ。元のIDには戻せない)
  "detected_at", // 詐欺の疑いに気づいた時刻(サーバーが判定した時刻)
  "latency_ms", // 気づいてから知らせが終わるまでの時間(ミリ秒)
  "targets", // 送り先の数
  "sent", // 届いた数(LINE は受け付けられた数、自動電話はかけられた数)
  "failed", // 届かなかった数
  "result", // ok(全部届いた) / partial(一部だけ) / failed(1件も届かない)
  "errors", // 届かなかった理由(LINE の応答番号など。個人情報は入れない)
];

const KINDS = {
  family_high: "家族のLINE: 見守り中に疑い「高」",
  family_handoff: "家族のLINE: 本人がAIに代わった",
  family_ended: "家族のLINE: 見守っていた電話が終わった",
  family_account: "家族のLINE: 相手が振込先の口座を言った(急ぎ)",
  family_autocall: "家族への自動音声の電話(急ぎ)",
  family_call_summary: "家族のLINE: 固定電話にAIが出た通話のまとめ",
  owner_call: "持ち主のLINE: 固定電話にAIが出た通話",
};

function sessionKey(id) {
  if (!id) return "";
  return crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 12);
}

// kind: KINDS のどれか / detectedAt: 気づいた時刻(ミリ秒)/ session: 見守りの回のID(ハッシュにして残す)
// results: 送り先ごとの結果 [{ ok: true }, { ok: false, error: "429" }, ...]
function record({ kind, detectedAt, session, results = [] }, now = Date.now()) {
  try {
    const sent = results.filter((r) => r && r.ok).length;
    const failed = results.length - sent;
    const detected = Number.isFinite(detectedAt) ? detectedAt : now;
    const row = {
      ts: new Date(now).toISOString(),
      kind: String(kind),
      session: sessionKey(session),
      detected_at: new Date(detected).toISOString(),
      latency_ms: Math.max(0, now - detected),
      targets: results.length,
      sent,
      failed,
      result: failed === 0 ? "ok" : sent > 0 ? "partial" : "failed",
      // 理由は短い記号だけ(応答番号・network など)。相手先や本文は入れない
      errors: [...new Set(results.filter((r) => r && !r.ok).map((r) => String(r.error || "unknown").slice(0, 20)))].join(" "),
    };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
    } catch (err) {
      console.error("[notifylog] 記録を書き込めませんでした:", err.code || err.message);
      guard.alert("notifylog-write", `通知の記録(notify-log.jsonl)を書き込めませんでした(${err.code || "不明"})。ディスクを確かめてください`);
    }
    if (row.result !== "ok") {
      guard.alert(
        `notify-${row.kind}`,
        `知らせが${row.result === "failed" ? "届きませんでした" : "一部しか届きませんでした"}: ` +
          `${KINDS[row.kind] || row.kind}(${row.sent}/${row.targets}件、理由: ${row.errors || "不明"})`
      );
    }
    return row;
  } catch (err) {
    console.error("[notifylog]", err.message);
    return null;
  }
}

// 記録をすべて読む(壊れた行は飛ばす)
function readAll() {
  let text = "";
  try {
    text = fs.readFileSync(LOG_PATH, "utf-8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function csvCell(value) {
  const s = value === undefined || value === null ? "" : String(value);
  // 表計算ソフトで式として動かないよう、= + - @ で始まる値は ' を付ける
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// CSV(Excel で文字化けしないよう、先頭に BOM を付ける)。種類の説明の列も足す
function toCsv(rows) {
  const header = [...COLUMNS, "kind_label"];
  const lines = rows.map((r) => [...COLUMNS.map((c) => r[c]), KINDS[r.kind] || ""].map(csvCell).join(","));
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}

module.exports = { record, readAll, toCsv, sessionKey, LOG_PATH, KINDS, COLUMNS };
