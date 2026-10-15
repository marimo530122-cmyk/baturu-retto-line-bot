// 操作手順動画の画面づくり: 本物の見守り画面(/app)をスマホの大きさで動かして撮り、
// 動画の1コマ(縦 1080x1920: 見出し + スマホ画面 + 字幕)の画像にする。
//
//   node video/capture.js [ep1 ep3 ...]
//
// 出力: video/out/<話>/NN.png と scenes.json(画像とナレーションの対応)。音声と動画は render.py が作る。
// - サーバーはこのリポジトリの server.js をその場で起動する(ANTHROPIC_API_KEY は渡さず、AIの返事は固定文面)。
// - マイクと読み上げは偽物に差し替える(ヘッドレスのブラウザには無いため)。画面の動きは本物と同じ。

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { episodes, CALLER_LINES, CALLER_LINES_AFTER } = require("./episodes");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
const PORT = Number(process.env.VIDEO_PORT || 3987);
const TOKEN = "demo-token";
// 縦を短めにして、コマの見出しと字幕の間に収める(目立たせる所は画面の中ほどに寄せて撮る)
const PHONE = { width: 390, height: 640 };

// ヘッドレスのブラウザ用の、偽のマイク(音声認識)と読み上げ
function fakeSpeech() {
  class FakeRecognition {
    constructor() { window.__rec = this; }
    start() {}
    stop() {}
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  window.__callerSays = (text) => {
    const r = window.__rec;
    if (!r || !r.onresult) return false;
    const result = [{ transcript: text }];
    result.isFinal = true;
    r.onresult({ resultIndex: 0, results: [result] });
    return true;
  };
  const voices = [
    { name: "Kyoko", lang: "ja-JP" },
    { name: "Otoya", lang: "ja-JP" },
    { name: "Google 日本語", lang: "ja-JP" },
  ];
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      getVoices: () => voices,
      speak: (u) => setTimeout(() => u.onend && u.onend(), 30),
      cancel: () => {},
      onvoiceschanged: null,
    },
  });
}

const helpers = {
  async waitFor(page, selector) {
    await page.waitForSelector(selector, { state: "attached", timeout: 10000 });
    await page.waitForTimeout(300);
  },
  async callerSays(page, text) {
    const ok = await page.evaluate((t) => window.__callerSays(t), text);
    if (!ok) {
      // 聞き取りをしていないときは「文字で試す」から入れる(画面の動きは同じ)
      await page.evaluate(() => { document.getElementById("settings").open = true; });
      await page.fill("#testText", text);
      await page.click("#testBtn");
      await page.evaluate(() => { document.getElementById("settings").open = false; });
    }
    await page.waitForTimeout(400);
  },
};

// 第4話の始め: 電話の途中(怪しい話が出て、会う日時と場所まで言われた)の状態にしておく
const SETUPS = {
  async callInProgress(page) {
    await page.click("#startBtn");
    await helpers.waitFor(page, "#status.SAFE");
    for (const line of [...CALLER_LINES, ...CALLER_LINES_AFTER]) await helpers.callerSays(page, line);
    await helpers.waitFor(page, "#status.HIGH");
  },
};

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shield-video-"));
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PORT: String(PORT),
    SHIELD_APP_TOKEN: TOKEN,
    SHIELD_DATA_DIR: dataDir,
  };
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => { if (String(d).includes("起動: port")) resolve(); });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    setTimeout(() => reject(new Error("server start timeout")), 15000);
  });
  return child;
}

// 1コマの組み立て(見出し・スマホ画面・赤い枠・字幕)
function frameHtml({ ep, index, total, scene, shot, box }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const SCALE = 2; // スクリーンショットは deviceScaleFactor 2
  const PHONE_W = 760; // コマの中のスマホ画面の幅
  const k = PHONE_W / (PHONE.width * SCALE);
  const ring = box
    ? `<div class="ring" style="left:${(box.x * SCALE - 14) * k}px;top:${(box.y * SCALE - 14) * k}px;width:${(box.width * SCALE + 28) * k}px;height:${(box.height * SCALE + 28) * k}px"></div>`
    : "";
  const body = shot
    ? `<div class="phone"><img src="data:image/png;base64,${shot}">${ring}</div>`
    : `<div class="card">${(scene.lines || []).map((l, i) => `<p class="${i === 0 ? "lead" : ""}${/onrender|\.com/.test(l) ? " url" : ""}">${esc(l)}</p>`).join("")}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 1080px; height: 1920px; background: #f3efe6; color: #1d1d1f;
      font-family: "Noto Sans CJK JP", "Noto Sans JP", "WenQuanYi Zen Hei", sans-serif; display: flex; flex-direction: column; }
    header { background: #1f4e6b; color: #fff; padding: 44px 60px 36px; }
    header .ep { font-size: 34px; opacity: .85; letter-spacing: .06em; }
    header h1 { margin: 10px 0 0; font-size: 62px; line-height: 1.25; }
    header .step { float: right; font-size: 34px; opacity: .85; }
    main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 30px 0; min-height: 0; }
    .phone { position: relative; width: ${PHONE_W}px; border: 10px solid #222; border-radius: 48px; overflow: hidden; background: #fff;
      box-shadow: 0 24px 60px rgba(0,0,0,.25); }
    .phone img { display: block; width: 100%; }
    .ring { position: absolute; border: 10px solid #e0301e; border-radius: 26px; box-shadow: 0 0 0 6px rgba(255,255,255,.8); }
    .card { width: 920px; background: #fff; border-radius: 40px; padding: 70px 60px; box-shadow: 0 16px 40px rgba(0,0,0,.12); }
    .card p { margin: 0 0 40px; font-size: 52px; line-height: 1.5; }
    .card p:last-child { margin-bottom: 0; }
    .card p.lead { font-weight: 700; color: #1f4e6b; }
    .card p.url { font-family: monospace; font-size: 46px; background: #fff4d6; border: 4px solid #c98a00; border-radius: 20px; padding: 24px; word-break: break-all; color: #7a4b00; }
    footer { background: rgba(0,0,0,.82); color: #fff; padding: 40px 56px 64px; font-size: 50px; line-height: 1.5; font-weight: 700; min-height: 330px; }
    .brand { font-size: 28px; opacity: .7; font-weight: 400; margin-top: 14px; }
  </style></head><body>
    <header><span class="step">${index + 1} / ${total}</span><div class="ep">鮮刻シールド 使い方 ・ ${esc(ep.title)}</div><h1>${esc(scene.heading)}</h1></header>
    <main>${body}</main>
    <footer>${esc(scene.narration)}</footer>
  </body></html>`;
}

async function newAppPage(context) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/app`);
  return page;
}

async function captureEpisode(browser, ep) {
  const dir = path.join(OUT, ep.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, locale: "ja-JP", hasTouch: true, isMobile: true });
  await context.addInitScript(fakeSpeech);
  const composer = await browser.newPage({ viewport: { width: 1080, height: 1920 } });

  let page = null;
  const scenes = [];
  for (const [i, scene] of ep.scenes.entries()) {
    let shot = null;
    let box = null;
    if (scene.kind === "shot") {
      if (!page || scene.fresh || scene.setup) {
        if (page) await page.close();
        page = await newAppPage(context);
        // 合言葉は第1話で入れたことにして、2回目以降は本人の画面から始める
        if (ep.id !== "ep1" || scene.fresh) {
          await page.evaluate((t) => localStorage.setItem("shieldToken", t), TOKEN);
          await page.reload();
        }
        if (scene.setup) await SETUPS[scene.setup](page);
      }
      const selector = await scene.act(page, helpers);
      if (scene.scrollTop) await page.evaluate(() => window.scrollTo(0, 0));
      const el = selector ? page.locator(selector).first() : null;
      // 背の高いもの(110番の台本など)は上をそろえ、それ以外は真ん中に
      if (el && !scene.scrollTop) {
        await el.evaluate((n, h) => n.scrollIntoView({ block: n.offsetHeight > h * 0.7 ? "start" : "center" }), PHONE.height);
      }
      await page.waitForTimeout(250);
      box = el ? await el.boundingBox() : null;
      shot = (await page.screenshot()).toString("base64");
    }
    await composer.setContent(frameHtml({ ep, index: i, total: ep.scenes.length, scene, shot, box }));
    await composer.evaluate(() => document.fonts.ready);
    const file = `${String(i + 1).padStart(2, "0")}.png`;
    await composer.screenshot({ path: path.join(dir, file) });
    scenes.push({ image: file, heading: scene.heading, narration: scene.narration });
    console.log(`[${ep.id}] ${file} ${scene.heading}`);
  }
  fs.writeFileSync(path.join(dir, "scenes.json"), JSON.stringify({ id: ep.id, title: ep.title, scenes }, null, 2));
  await context.close();
  await composer.close();
}

async function main() {
  const wanted = process.argv.slice(2);
  const list = wanted.length ? episodes.filter((e) => wanted.includes(e.id)) : episodes;
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const ep of list) await captureEpisode(browser, ep);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
