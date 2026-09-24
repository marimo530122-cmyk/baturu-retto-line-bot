// 検知ルールの「自己進化」: 通話ログからAIが新しい検知ルールを提案し、人間が承認して反映する
//
//   node evolve.js propose        … 通話ログを分析して新ルールを提案(data/proposals/ に保存。反映はしない)
//   node evolve.js list           … 未承認の提案を一覧表示
//   node evolve.js approve <id>   … 提案を patterns.custom.json に反映(人間の承認)
//   node evolve.js reject <id>    … 提案を捨てる
//
// 反映後は `npm test` を通してからサーバーを再起動し、patterns.custom.json をコミットすること。

const fs = require("fs");
const path = require("path");
const store = require("./lib/store");
const { maskText } = require("./lib/mask");
const { validateProposal, builtinIds } = require("./lib/rules");
const { BUILTIN_PATTERNS, CUSTOM_PATTERNS_PATH } = require("./lib/detector");

const AI_MODEL = process.env.SHIELD_AI_MODEL || "claude-opus-5";
const PROPOSALS_PATH = path.join(store.DATA_DIR, "proposals", "pending.json");
const MAX_CALLS = 30;

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function currentRules() {
  const custom = readJson(CUSTOM_PATTERNS_PATH, []);
  return [
    ...BUILTIN_PATTERNS.map((p) => ({ id: p.id, label: p.label, source: p.regex.source })),
    ...custom.map((p) => ({ id: p.id, label: p.label, source: p.source })),
  ];
}

// 分析対象: 疑いが中以上の通話(Jevが怪しいと言ったものも含む)の、相手の発話だけ
function suspiciousTranscripts() {
  return store
    .list()
    .filter((c) => ["high", "medium"].includes((c.verdict || c.detection).level))
    .slice(0, MAX_CALLS)
    .map((c) => ({
      level: (c.verdict || c.detection).level,
      matched: c.detection.matches.map((m) => m.id),
      caller: c.history.filter((h) => h.role === "caller").map((h) => maskText(h.text)),
    }));
}

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          weight: { type: "integer" },
          source: { type: "string" },
          flags: { type: "string", enum: ["", "i"] },
          examples: { type: "array", items: { type: "string" } },
          counter_examples: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["id", "label", "weight", "source", "flags", "examples", "counter_examples", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `あなたは詐欺電話対策ツール「戦国シールド」の検知ルール担当です。
既存の検知ルール(JavaScriptの正規表現)と、疑いが中以上だった通話の文字起こし(相手側の発話のみ)を渡します。
既存ルールでは拾えていない「詐欺によくある言い回し」を見つけ、新しいルールを最大5件提案してください。

ルール:
- 提案は、文字起こしに実際に出てきた言い回しを根拠にする。根拠が無ければ提案0件でよい。
- 既存ルールと同じ意味のものは提案しない。
- 普通の用件(宅配・病院・学校・近所・仕事の連絡など)に当たらないよう、単語1つではなく言い回しで絞る。
- 声・話し方・家族を名乗っているか(オレオレ詐欺判定)に関するルールは作らない。
- 正規表現は200文字以内。入れ子の繰り返し(例: (a+)+ )や後方参照は使わない。
- id は英小文字とアンダースコア、label は日本語で30文字以内、weight は1〜4(4が最も危険)。
- examples には当たるべき例文を2〜4個、counter_examples には似ているが普通の用件で当たってはいけない例文を2個以上。
- reason には、どの通話のどの言い回しを根拠にしたかを短く書く。`;

async function propose() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY が設定されていません。");
    process.exit(1);
  }
  const transcripts = suspiciousTranscripts();
  if (!transcripts.length) {
    console.log("分析対象(疑いが中以上)の通話がまだありません。");
    return;
  }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: { type: "json_schema", schema: PROPOSAL_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({ existing_rules: currentRules(), calls: transcripts }, null, 2),
      },
    ],
  });
  if (response.stop_reason !== "end_turn") {
    console.error(`AIが最後まで答えませんでした(stop_reason: ${response.stop_reason})。`);
    process.exit(1);
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const { proposals } = JSON.parse(text);

  const pending = readJson(PROPOSALS_PATH, []);
  const takenIds = [...builtinIds(), ...readJson(CUSTOM_PATTERNS_PATH, []).map((p) => p.id), ...pending.map((p) => p.id)];
  let accepted = 0;
  for (const p of proposals) {
    const result = validateProposal(p, takenIds);
    if (!result.ok) {
      console.log(`✗ 却下(自動チェック): ${p.id} ${p.label}`);
      for (const r of result.reasons) console.log(`    - ${r}`);
      continue;
    }
    pending.push({ ...result.rule, proposedAt: new Date().toISOString() });
    takenIds.push(p.id);
    accepted += 1;
    console.log(`○ 提案: ${p.id} ${p.label}`);
  }
  writeJson(PROPOSALS_PATH, pending);
  console.log(`\n${accepted}件を提案として保存しました。\`node evolve.js list\` で確認し、承認するものだけ approve してください。`);
}

function list() {
  const pending = readJson(PROPOSALS_PATH, []);
  if (!pending.length) return console.log("未承認の提案はありません。");
  for (const p of pending) {
    console.log(`■ ${p.id}  ${p.label}  (重み${p.weight})`);
    console.log(`  正規表現: /${p.source}/${p.flags}`);
    console.log(`  当たる例: ${p.examples.join(" / ")}`);
    console.log(`  当たらない例: ${p.counter_examples.join(" / ")}`);
    console.log(`  根拠: ${p.reason}\n`);
  }
}

function approve(id) {
  const pending = readJson(PROPOSALS_PATH, []);
  const p = pending.find((x) => x.id === id);
  if (!p) {
    console.error(`提案が見つかりません: ${id}`);
    process.exit(1);
  }
  const custom = readJson(CUSTOM_PATTERNS_PATH, []);
  const result = validateProposal(p, [...builtinIds(), ...custom.map((c) => c.id)]);
  if (!result.ok) {
    console.error(`承認前の再チェックで不合格:\n${result.reasons.map((r) => `  - ${r}`).join("\n")}`);
    process.exit(1);
  }
  custom.push({ ...result.rule, approvedAt: new Date().toISOString() });
  writeJson(CUSTOM_PATTERNS_PATH, custom);
  writeJson(PROPOSALS_PATH, pending.filter((x) => x.id !== id));
  console.log(`反映しました: ${id}(${CUSTOM_PATTERNS_PATH})`);
  console.log("npm test を通してからサーバーを再起動し、patterns.custom.json をコミットしてください。");
}

function reject(id) {
  const pending = readJson(PROPOSALS_PATH, []);
  if (!pending.some((x) => x.id === id)) {
    console.error(`提案が見つかりません: ${id}`);
    process.exit(1);
  }
  writeJson(PROPOSALS_PATH, pending.filter((x) => x.id !== id));
  console.log(`捨てました: ${id}`);
}

const [cmd, arg] = process.argv.slice(2);
const commands = { propose, list, approve: () => approve(arg), reject: () => reject(arg) };
if (!commands[cmd] || (["approve", "reject"].includes(cmd) && !arg)) {
  console.error("使い方: node evolve.js propose | list | approve <id> | reject <id>");
  process.exit(1);
}
Promise.resolve(commands[cmd]()).catch((err) => {
  console.error(err);
  process.exit(1);
});
