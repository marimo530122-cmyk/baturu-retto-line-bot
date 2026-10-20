// 公開の軌道データ(CelesTrak)を取ってきて orbit-watch/data/tle.json に書き出す。
// GitHub Actions(.github/workflows/orbit-watch-pages.yml)から1日1回だけ呼ぶ。
// CelesTrak は同じデータを2時間に1回より多く取らないよう求めているので、手元で何度も回さないこと。
//
// 取れなかったときは、公開中のサイトにある前回分を使う。それも無ければ失敗で終わる
// (失敗すると公開は更新されず、前の日のページがそのまま残る)。
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'tle.json');
const BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const UA = 'orbit-watch (github.com/' + (process.env.GITHUB_REPOSITORY || 'local') + ')';

// 肉眼で見える明るい衛星(約150個)に加えて、必ず入れたい衛星
const MUST = [
  { norad: '25544', tag: 'iss' },        // 国際宇宙ステーション
  { norad: '43065', tag: 'shikisai' },   // しきさい(GCOM-C): 海面水温・海の色
  { norad: '38337', tag: 'shizuku' },    // しずく(GCOM-W): 雲の下の海面水温
  { norad: '41836', tag: 'himawari9' },  // ひまわり9号
  { norad: '40267', tag: 'himawari8' },  // ひまわり8号
];

function checksum(line) {
  let s = 0;
  for (let i = 0; i < 68; i++) {
    const c = line[i];
    if (c >= '0' && c <= '9') s += +c;
    else if (c === '-') s += 1;
  }
  return s % 10;
}
const validTle = (l1, l2) =>
  typeof l1 === 'string' && typeof l2 === 'string' && l1.length >= 69 && l2.length >= 69 &&
  l1[0] === '1' && l2[0] === '2' && checksum(l1) === +l1[68] && checksum(l2) === +l2[68] &&
  l1.slice(2, 7) === l2.slice(2, 7);

function parse(text) {
  const lines = String(text).split(/\r?\n/).map((s) => s.replace(/\s+$/, ''));
  const out = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (name && validTle(l1, l2)) {
      out.push({ name: name.trim().slice(0, 24), norad: l1.slice(2, 7).trim(), l1: l1.slice(0, 69), l2: l2.slice(0, 69) });
      i += 2;
    }
  }
  return out;
}

async function get(query) {
  const r = await fetch(`${BASE}?${query}&FORMAT=tle`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${query}: HTTP ${r.status}`);
  return parse(await r.text());
}

async function fresh() {
  const visual = await get('GROUP=visual');
  if (visual.length < 50) throw new Error(`visual が ${visual.length} 件しかない`);
  const byId = new Map(visual.map((s) => [s.norad, s]));
  for (const m of MUST) {
    let s = byId.get(m.norad);
    if (!s) {
      try { s = (await get(`CATNR=${m.norad}`))[0]; } catch (e) { console.warn(`  ${m.norad} を取れず: ${e.message}`); }
    }
    if (s) byId.set(m.norad, { ...s, tag: m.tag });
  }
  if (!byId.has('25544')) throw new Error('ISS のデータが無い');
  return { fetchedAt: new Date().toISOString(), source: 'CelesTrak', sats: [...byId.values()] };
}

async function previous() {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '/').split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY が無い');
  const url = `https://${owner.toLowerCase()}.github.io/${repo}/data/tle.json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`前回分 HTTP ${r.status}`);
  const j = await r.json();
  const sats = Array.isArray(j.sats) ? j.sats.filter((s) => validTle(s.l1, s.l2)) : [];
  if (sats.length < 50) throw new Error('前回分が壊れている');
  return { ...j, sats };
}

let data;
try {
  data = await fresh();
  console.log(`CelesTrak から ${data.sats.length} 件を取得`);
} catch (e) {
  console.warn(`CelesTrak から取れず: ${e.message} — 公開中の前回分を使う`);
  data = await previous();
  console.log(`前回分 ${data.sats.length} 件(${data.fetchedAt} 取得)を使う`);
}
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data));
