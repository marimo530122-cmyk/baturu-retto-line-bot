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

function toMarkdown(file, rawText, extracted) {
  const decisions = extracted.decisions.length
    ? extracted.decisions.map((d) => `- ${d}`).join("\n")
    : "(なし)";
  const todos = extracted.todos.length
    ? extracted.todos
        .map((t) => `- [ ] ${t.task}${t.owner ? ` (担当: ${t.owner})` : ""}${t.due ? ` (期限: ${t.due})` : ""}`)
        .join("\n")
    : "(なし)";

  return `# 議事録自動抽出: ${file.name}

- source: ${file.name} (Drive id: ${file.id})
- processed_at: ${new Date().toISOString()}

## 要約
${extracted.summary}

## 決定事項
${decisions}

## ToDo
${todos}

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
