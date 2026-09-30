const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { build, demoPatterns } = require("../demo/build");

test("デモページは今の検知ルール・ベンチマークの数字から作られている(古くなっていない)", () => {
  const saved = fs.readFileSync(path.join(__dirname, "..", "demo", "index.html"), "utf-8");
  assert.strictEqual(saved, build(), "ルールか例文が変わっています。node demo/build.js を実行してください");
});

test("デモに埋め込んだルールは、ブラウザで同じ正規表現として読み込める", () => {
  for (const p of demoPatterns()) assert.doesNotThrow(() => new RegExp(p.source, p.flags), p.id);
});
