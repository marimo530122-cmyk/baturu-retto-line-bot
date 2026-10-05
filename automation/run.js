#!/usr/bin/env node
import "dotenv/config";
import { $, fs, path } from "zx";
import { fetchLatestMemo } from "./fetch-data.js";
import { extractStructuredData } from "./gemini-extract.js";
import { validate } from "./validate.js";

$.quiet = true;

const OUTPUT_DIR = process.env.OUTPUT_DIR || "./output";
const LOG_DIR = "./logs";
const LOG_FILE = path.join(LOG_DIR, "run.log");
const STATE_FILE = path.join(OUTPUT_DIR, ".last-processed-file-id");

async function log(level, message) {
  await fs.ensureDir(LOG_DIR);
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  await fs.appendFile(LOG_FILE, line);
  if (level === "ERROR") process.stderr.write(line);
  else process.stdout.write(line);
}

function bulletList(items) {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "(なし)";
}

function taskList(items) {
  return items.length
    ? items
        .map((t) => `- [ ] ${t.task}${t.owner ? ` (担当: ${t.owner})` : ""}${t.due ? ` (期限: ${t.due})` : ""}`)
        .join("\n")
    : "(なし)";
}

function qaLog(items) {
  return items.length ? items.map((qa) => `- Q: ${qa.question}\n  A: ${qa.answer}`).join("\n") : "(なし)";
}

function toMarkdown(file, rawText, extracted) {
  const info = extracted.basic_info;
  const nextVisit = extracted.next_visit;

  return `# 通院カルテ&処方箋: ${file.name}

- source: ${file.name} (Drive id: ${file.id})
- processed_at: ${new Date().toISOString()}

## 1. 基本情報
- 受診日: ${info.visit_date || "(不明)"}
- 診療科: ${info.department || "(不明)"}
- 担当医: ${info.doctor || "(不明)"}
- 同行者: ${info.companion || "(不明)"}

## 2. 主訴
${extracted.chief_complaint}

## 3. 自宅での数値・体調の推移
${extracted.readings_trend || "(なし)"}

## 4. 診察・診断内容
${extracted.diagnosis}

## 5. 質問と医師の回答
${qaLog(extracted.qa_log)}

## 6. 処方・治療内容
${bulletList(extracted.treatment)}

## 7. 処方の変更点とその理由
${extracted.treatment_change_reason || "(なし、または前回からの変更なし)"}

## 8. 副作用・アレルギーの確認
${extracted.side_effects_and_allergies || "(なし)"}

## 9. 生活制限・NG事項
${bulletList(extracted.restrictions)}

## 10. 次回までの宿題
${taskList(extracted.homework)}

## 11. ⚠️ レッドフラッグ(こうなったらすぐ連絡/受診)
${bulletList(extracted.red_flags)}

## 12. 次回受診予定・準備・費用見積もり
- 次回受診予定日: ${nextVisit.date || "(不明)"}
- 必要な準備: ${nextVisit.preparation || "(なし)"}
- 費用の見積もり: ${nextVisit.cost_estimate || "(不明)"}

## 13. 振り返り・フリーメモ
${extracted.notes || "(なし)"}

---
### 元メモ(生データ)
${rawText}
`;
}

async function main() {
  await fs.ensureDir(OUTPUT_DIR);

  await log("INFO", "Run started");

  const { file, text } = await fetchLatestMemo();
  await log("INFO", `Fetched file: ${file.name} (${file.id}, modified ${file.modifiedTime})`);

  const lastId = (await fs.pathExists(STATE_FILE)) ? await fs.readFile(STATE_FILE, "utf8") : null;
  if (lastId === file.id) {
    await log("INFO", `File ${file.id} already processed on a previous run; skipping.`);
    return;
  }

  const extracted = await extractStructuredData(text);
  await log("INFO", "Gemini extraction complete");

  // Safety brake: throws and aborts the run on structural or Jev failure.
  await validate(text, extracted);
  await log("INFO", "Jev/structural validation passed");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(OUTPUT_DIR, `${timestamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `${timestamp}.md`);

  await fs.writeJson(jsonPath, { file, extracted }, { spaces: 2 });
  await fs.writeFile(mdPath, toMarkdown(file, text, extracted));
  await fs.writeFile(STATE_FILE, file.id);

  await log("INFO", `Wrote ${jsonPath} and ${mdPath}`);
}

main().catch(async (err) => {
  await log("ERROR", `Pipeline aborted at stage "${err.stage || "unknown"}": ${err.message}`);
  process.exitCode = 1;
});
