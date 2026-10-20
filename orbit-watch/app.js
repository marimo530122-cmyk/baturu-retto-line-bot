/*
 * ARGUS//NULL — 軽量軌道監視エンジン
 *
 * 構成(上から順に):
 *   1. 型ガード     : 外から来た値(TLE・計算結果)は必ずここを通す。壊れた値は捨てて止まらない。
 *   2. カタログ     : CelesTrakの公開TLEを取りに行き、ダメなら合成した軌道要素からTLEを組み立てる。
 *   3. 伝搬         : satellite.js(SGP4)で位置を出す。描画とは切り離し、10Hzだけ計算する。
 *   4. JEV判定      : 決まった「質問」に choice(選択肢)と score(0-100)で答える軽い規則エンジン。
 *   5. 描画         : Canvas 2D の正射影の地球。重い3Dライブラリは使わない。
 *   6. 傍受記録/UI  : 実際に計算した値だけを流す(+少しの演出文)。
 */
(() => {
  'use strict';

  const sat = window.satellite;
  const RE = 6378.137;               // 地球赤道半径 km
  const MU = 398600.4418;            // 地心重力定数 km^3/s^2
  const DEG = Math.PI / 180;
  const SITE_NAME = 'SITE-07';
  const PROPAGATE_HZ = 10;
  const SCREEN_MS = 1000;            // 接近スクリーニング間隔(実時間)
  const WARPS = [1, 10, 60, 600];
  const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle';
  const MAX_OBJECTS = 140;

  // 陸地マスク(Natural Earth 1:50m を2°格子にしたRLE。行=北から、海→陸→海…の連長、36進)
  const LAND_RLE = '50|50|50|1f.5.b.b.2u|16.2.3.3.1.6.1.p.y.1.2.1.1.1.e.1.16|12.1.4.4.1.4.4.o.g.4.12.4.12|u.2.a.1.3.4.4.r.h.1.16.3.10|w.1.1.1.1.1.5.1.1.6.b.j.12.2.e.c.d.3.2.1.f|s.3.1.1.3.1.3.4.1.7.a.f.1.1.12.1.b.l.2.2.q|0.1.a.2.i.7.4.2.1.a.9.d.1.1.12.1.5.3.1.4.1.n.1.a.1.2.a.1|8.d.1.1.1.7.2.3.1.2.1.2.1.3.2.1.1.1.1.4.8.d.m.9.6.1.4.4.1.2.3.1f|0.3.6.14.5.4.5.a.o.e.1.1.1.c.1.1h|2.2.3.13.1.1.3.6.7.5.a.4.d.5.2.4.1.1.1.1y|8.11.9.2.1.1.7.4.p.5.2.27|7.7.1.s.8.4.b.3.p.5.2.1v.2.1.1.4.4|9.4.8.m.8.4.2.1.u.1.4.2.1.3.3.1n.9.1.9|b.1.a.1.1.l.7.7.s.2.7.2.3.1m.9.3.9|n.1.1.o.2.a.p.3.5.1.6.1m.9.3.9|p.p.1.b.n.2.1.2.3.1v.1.1.6.1.b|q.10.q.20.1.1.i|t.t.3.2.q.1z.k|s.u.5.1.p.k.1.5.1.17.2.1.i|s.s.1.2.u.7.1.8.2.1.1.5.2.16.m|s.r.u.7.3.2.2.5.6.4.2.15.3.2.i|s.p.x.4.4.1.2.2.1.4.1.a.2.12.p|s.o.x.5.8.1.2.1.1.b.3.w.4.1.6.1.j|t.n.z.2.5.2.1.1.3.1.1.c.2.y.2.2.3.2.k|u.m.z.8.7.1.3.1.1.16.3.1.2.4.k|v.j.10.a.c.16.5.2.n|w.h.10.e.1.4.1.1a.t|y.8.7.1.z.l.1.7.1.10.t|x.1.1.6.8.1.x.o.1.7.2.x.u|y.1.1.5.16.o.2.7.7.q.v|11.4.7.2.w.q.1.b.4.o.2.1.t|11.4.4.2.4.1.u.r.1.9.6.8.3.8.10|12.4.2.2.8.2.q.r.2.8.8.5.5.6.1.1.z|14.6.10.s.1.6.a.4.6.1.1.5.6.1.t|18.4.x.t.1.4.c.3.9.5.6.1.t|1a.2.y.t.1.1.e.3.9.6.5.1.t|1b.1.5.3.q.u.2.2.c.2.9.1.2.2.8.1.r|1c.1.1.1.1.8.n.w.d.1.a.1.2.1.11|1f.a.n.v.f.1.l.1.r|1f.d.l.2.6.l.o.1.1.2.5.2.v|1f.e.u.i.q.1.1.1.4.3.v|1e.f.u.h.r.3.2.5.1.1.t|1e.h.r.h.t.2.3.4.6.2.n|1e.k.p.f.v.2.2.3.1.1.4.1.1.1.1.3.j|1d.n.o.e.w.1.g.4.h|1e.n.n.e.x.4.c.5.4.1.b|1f.l.o.e.12.1.3.1.7.2.1.1.6.1.9|1f.k.q.d.1y|1g.j.p.e.4.1.14.3.3.1.i|1g.i.q.e.4.1.12.5.3.2.a.1.6|1i.g.q.d.3.3.10.c.h|1j.f.q.c.4.3.10.c.h|1j.f.r.b.4.2.y.h.7.1.7|1j.d.t.b.4.2.x.i.f|1j.b.v.a.5.2.x.j.e|1j.b.w.8.15.k.d|1i.b.x.8.15.k.d|1i.a.z.6.17.j.d|1i.a.z.5.18.4.5.9.e|1i.7.2f.1.9.7.f|1h.9.2q.5.c.1.2|1h.6.3a.2.1|1h.4.1.1.2v.2.c.2.2|1i.4.2x.1.b.2.3|1h.4.39.2.4|1h.4.3f|1g.4.1w.1.1j|1h.2.3h|1i.2.3g|50|50|50|50|50|1m.1.3d|1k.2.1k.4.f.f.3.3.1.7.i|1i.1.1.2.1c.1.3.f.4.13.c|1g.1.1.5.r.1.4.x.2.1c.6|11.3.4.2.6.1.3.4.n.14.1.1f.5|m.c.6.i.n.2i.9|f.11.m.2p.9|8.1.4.10.5.2.9.3.5.2q.9|e.16.e.1.1.2q.a|3.2.3.1.3.1b.2.35.6|0.a.2.4o|0.50|0.50';

  // ---------- 1. 型ガード ----------
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const isVec = (v) => v && typeof v === 'object' && isNum(v.x) && isNum(v.y) && isNum(v.z);

  function tleChecksum(line) {
    let s = 0;
    for (let i = 0; i < 68; i++) {
      const c = line[i];
      if (c >= '0' && c <= '9') s += c.charCodeAt(0) - 48;
      else if (c === '-') s += 1;
    }
    return s % 10;
  }
  function validTle(l1, l2) {
    return typeof l1 === 'string' && typeof l2 === 'string' &&
      l1.length >= 69 && l2.length >= 69 && l1[0] === '1' && l2[0] === '2' &&
      tleChecksum(l1) === +l1[68] && tleChecksum(l2) === +l2[68] &&
      l1.slice(2, 7) === l2.slice(2, 7);
  }

  // ---------- 小道具 ----------
  let seed = 0x5eed1234;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const hex = (n) => Array.from({ length: n }, () => '0123456789ABCDEF'[(Math.random() * 16) | 0]).join('');
  const pad = (n, w) => String(n).padStart(w, '0');
  const fx = (x, d) => (isNum(x) ? x.toFixed(d) : '---');
  const wrap180 = (d) => ((d + 540) % 360) - 180;
  const $ = (id) => document.getElementById(id);

  function utcStamp(d) {
    return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1, 2)}.${pad(d.getUTCDate(), 2)} ` +
      `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`;
  }

  // ---------- 2. カタログ ----------
  // 軌道要素 → TLE文字列(列位置は NORAD の書式どおり)
  function bstarField(b) {
    if (!b) return ' 00000-0';
    const m = Math.abs(b);
    let e = Math.ceil(Math.log10(m));
    let mant = Math.round((m / Math.pow(10, e)) * 1e5);
    if (mant >= 1e5) { mant = 1e4; e += 1; }
    return (b < 0 ? '-' : ' ') + pad(mant, 5) + (e < 0 ? '-' : '+') + Math.min(9, Math.abs(e));
  }
  function buildTle(num, el, epoch) {
    const y = epoch.getUTCFullYear();
    const doy = (epoch - Date.UTC(y, 0, 1)) / 86400000 + 1;
    const f = (x, w, d) => x.toFixed(d).padStart(w, ' ');
    let l1 = `1 ${pad(num, 5)}U 26${pad(num % 1000, 3)}A   ${pad(y % 100, 2)}${doy.toFixed(8).padStart(12, '0')} ` +
      ` .00000000  00000-0 ${bstarField(el.bstar || 0)} 0  999`;
    let l2 = `2 ${pad(num, 5)} ${f(el.i, 8, 4)} ${f(el.raan, 8, 4)} ${pad(Math.round(el.e * 1e7), 7)} ` +
      `${f(el.argp, 8, 4)} ${f(el.m, 8, 4)} ${f(el.n, 11, 8)}${'1'.padStart(5, ' ')}`;
    l1 += tleChecksum(l1);
    l2 += tleChecksum(l2);
    return [l1, l2];
  }

  // 実在の軌道の「型」を真似た合成カタログ(ネットが無い時用)
  function synthCatalog() {
    const now = new Date();
    const out = [];
    let num = 90001;
    const add = (name, cls, el) => {
      const full = { e: 0.0005, argp: rnd() * 360, m: rnd() * 360, raan: rnd() * 360, bstar: 3e-5, ...el };
      out.push({ name, cls, tle: buildTle(num++, full, now) });
    };
    add('ISS-CLASS STATION', 'CREWED', { i: 51.64, n: 15.50 });
    add('CSS-CLASS STATION', 'CREWED', { i: 41.47, n: 15.60 });
    add('HST-CLASS OPTIC', 'OPTIC', { i: 28.47, n: 15.28, bstar: 1e-5 });
    for (let k = 0; k < 4; k++) add(`SSO-IMG ${pad(k + 1, 2)}`, 'IMAGING', { i: 97.4 + rnd(), n: 14.3 + rnd() * 0.9 });
    add('POLAR-WX 19', 'WEATHER', { i: 99.1, n: 14.13, e: 0.0013 });
    for (let k = 0; k < 6; k++) add(`NAV-MEO ${pad(k + 1, 2)}`, 'NAV', { i: 55, n: 2.0056, e: 0.008, raan: k * 60, bstar: 0 });
    add('MOLNIYA-TYPE 3', 'SIGINT', { i: 63.4, n: 2.006, e: 0.72, argp: 270, bstar: 0 });
    add('MOLNIYA-TYPE 7', 'SIGINT', { i: 63.4, n: 2.006, e: 0.71, argp: 268, bstar: 0 });
    for (let k = 0; k < 5; k++) add(`GEO-RELAY ${pad(k + 1, 2)}`, 'RELAY', { i: 0.05 + rnd() * 0.1, n: 1.0027, e: 0.0002, bstar: 0 });
    for (let k = 0; k < 24; k++) add(`MEGA-SHELL ${pad(k + 1, 3)}`, 'CONSTEL', { i: 53.05, n: 15.06, raan: (k % 6) * 60, m: (k * 47) % 360, bstar: 1e-4 });
    for (let k = 0; k < 30; k++) add(`DEB ${hex(4)}`, 'DEBRIS', { i: 60 + rnd() * 45, n: 14.2 + rnd() * 1.4, e: rnd() * 0.02, bstar: 2e-4 });
    return out;
  }

  function parseTleText(text) {
    const lines = String(text).split(/\r?\n/).map((s) => s.replace(/\s+$/, ''));
    const out = [];
    for (let i = 0; i + 2 < lines.length && out.length < MAX_OBJECTS; i++) {
      const l1 = lines[i + 1], l2 = lines[i + 2];
      if (lines[i] && validTle(l1, l2)) {
        out.push({ name: lines[i].trim().slice(0, 24), cls: 'PUBLIC', tle: [l1, l2] });
        i += 2;
      }
    }
    return out;
  }

  async function fetchLive() {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(CELESTRAK, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = parseTleText(await r.text());
      if (list.length < 5) throw new Error('too few');
      return list;
    } finally {
      clearTimeout(to);
    }
  }

  // ---------- 3. 伝搬 ----------
  const S = {
    objs: [],
    sel: null,
    simAnchor: Date.now(), realAnchor: performance.now(), warp: 1,
    gmst: 0, sun: { x: 1, y: 0, z: 0 },
    site: { lat: 34.87, lon: 138.26 },     // 既定の観測地点(静岡県中部)
    view: { lon: 138, lat: 22, zoom: 1, auto: true },
    alarm: 0, sound: false, src: '…',
    lastScreen: 0, conj: [],
  };

  function simNow() {
    return new Date(S.simAnchor + (performance.now() - S.realAnchor) * S.warp);
  }
  function setWarp(w) {
    S.simAnchor = simNow().getTime();
    S.realAnchor = performance.now();
    S.warp = w;
  }

  function makeObj(entry, idx) {
    let rec;
    try { rec = sat.twoline2satrec(entry.tle[0], entry.tle[1]); } catch (_) { return null; }
    if (!rec || rec.error) return null;
    const nRadMin = rec.no;                        // rad/min
    const nRevDay = nRadMin * 1440 / (2 * Math.PI);
    const a = Math.cbrt(MU / Math.pow(nRadMin / 60, 2));
    return {
      id: idx, name: entry.name, cls: entry.cls, tle: entry.tle, rec,
      norad: entry.tle[0].slice(2, 7).trim(),
      inc: rec.inclo / DEG, ecc: rec.ecco, nRevDay, a,
      perigee: a * (1 - rec.ecco) - RE, apogee: a * (1 + rec.ecco) - RE,
      period: 1440 / nRevDay,
      ok: false, lat: 0, lon: 0, alt: 0, vel: 0,
      eci: { x: 0, y: 0, z: 0 }, ecf: { x: 0, y: 0, z: 0 },
      el: -90, az: 0, range: 0, wasUp: null,
      level: 0, score: 0, reasons: [], track: null, trackAt: 0,
      sx: 0, sy: 0, vis: false,
    };
  }

  function propagateAll(date) {
    S.gmst = sat.gstime(date);
    const siteGd = { latitude: S.site.lat * DEG, longitude: S.site.lon * DEG, height: 0.05 };
    for (const o of S.objs) {
      let pv;
      try { pv = sat.propagate(o.rec, date); } catch (_) { pv = null; }
      if (!pv || !isVec(pv.position) || !isVec(pv.velocity)) { o.ok = false; continue; }
      const gd = sat.eciToGeodetic(pv.position, S.gmst);
      if (!isNum(gd.height) || gd.height < 80) { o.ok = false; continue; }   // 再突入扱い
      o.ok = true;
      o.eci = pv.position;
      o.ecf = sat.eciToEcf(pv.position, S.gmst);
      o.lat = gd.latitude / DEG;
      o.lon = wrap180(gd.longitude / DEG);
      o.alt = gd.height;
      const v = pv.velocity;
      o.vel = Math.hypot(v.x, v.y, v.z);
      const la = sat.ecfToLookAngles(siteGd, o.ecf);
      o.az = la.azimuth / DEG;
      o.el = la.elevation / DEG;
      o.range = la.rangeSat;
    }
    S.sun = sunEcef(date, S.gmst);
  }

  // 太陽方向(低精度式・地球固定座標)
  function sunEcef(date, gmst) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const n = jd - 2451545.0;
    const L = (280.46 + 0.9856474 * n) * DEG;
    const g = (357.528 + 0.9856003 * n) * DEG;
    const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
    const eps = (23.439 - 4e-7 * n) * DEG;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const lon = ra - gmst;
    return { x: Math.cos(dec) * Math.cos(lon), y: Math.cos(dec) * Math.sin(lon), z: Math.sin(dec), dec, lon };
  }

  function groundTrack(o, date) {
    const pts = [];
    const span = Math.min(o.period, 240);
    const steps = 120;
    for (let k = -steps / 2; k <= steps / 2; k++) {
      const d = new Date(date.getTime() + (k / steps) * span * 60000);
      let pv;
      try { pv = sat.propagate(o.rec, d); } catch (_) { pv = null; }
      if (!pv || !isVec(pv.position)) { pts.push(null); continue; }
      pts.push(sat.eciToEcf(pv.position, sat.gstime(d)));
    }
    return pts;
  }

  // ---------- 4. JEV判定 ----------
  // 1つの対象に「決まった質問」をして choice / score で答える。理由も残す(説明できる判定)。
  const QUESTIONS = [
    { id: 'overhead', ask: (o) => o.el > 10 ? { choice: 'YES', score: 25 + Math.min(30, o.el / 2), why: `頭上通過 el=${fx(o.el, 1)}°` } : null },
    { id: 'conjunct', ask: (o) => {
      const c = o.conj;
      if (!c) return null;
      if (c.d < 25) return { choice: 'CRITICAL', score: 70, why: `近接 Δ=${fx(c.d, 1)}km ↔ ${c.with}` };
      if (c.d < 120) return { choice: 'CLOSE', score: 35, why: `接近 Δ=${fx(c.d, 0)}km ↔ ${c.with}` };
      return null;
    } },
    { id: 'decay', ask: (o) => o.perigee < 300 ? { choice: 'DECAYING', score: 20, why: `近地点 ${fx(o.perigee, 0)}km 大気抵抗域` } : null },
    { id: 'eccentric', ask: (o) => o.ecc > 0.5 ? { choice: 'HEO', score: 15, why: `高楕円 e=${fx(o.ecc, 3)} 長時間滞空` } : null },
    { id: 'polar', ask: (o) => o.inc > 95 && o.inc < 101 ? { choice: 'SSO', score: 8, why: '太陽同期 毎日同時刻に再訪' } : null },
  ];

  function judge(o) {
    if (!o.ok) { o.level = -1; o.score = 0; o.reasons = ['信号喪失 / 伝搬不能']; return; }
    let score = 0;
    const reasons = [];
    for (const q of QUESTIONS) {
      let a = null;
      try { a = q.ask(o); } catch (_) { a = null; }    // 1問壊れても全体は止めない
      if (a && isNum(a.score)) { score += a.score; reasons.push(a.why); }
    }
    score = Math.min(99, Math.round(score));
    // ヒステリシス: 上げるのは即時、下げるのはゆっくり(表示のちらつき防止)
    o.score = score >= o.score ? score : Math.max(score, o.score - 2);
    o.level = o.score >= 60 ? 2 : o.score >= 25 ? 1 : 0;
    o.reasons = reasons;
  }

  // 接近スクリーニング: 100km格子に入れて近所だけ比べる(全組み合わせ O(n^2) を避ける)
  function screenConjunctions() {
    const CELL = 120;
    const grid = new Map();
    const key = (i, j, k) => `${i},${j},${k}`;
    for (const o of S.objs) {
      o.conj = null;
      if (!o.ok) continue;
      const k = key(Math.floor(o.eci.x / CELL), Math.floor(o.eci.y / CELL), Math.floor(o.eci.z / CELL));
      (grid.get(k) || grid.set(k, []).get(k)).push(o);
    }
    const found = [];
    for (const o of S.objs) {
      if (!o.ok) continue;
      const ci = Math.floor(o.eci.x / CELL), cj = Math.floor(o.eci.y / CELL), ck = Math.floor(o.eci.z / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const cell = grid.get(key(ci + a, cj + b, ck + c));
        if (!cell) continue;
        for (const p of cell) {
          if (p.id <= o.id) continue;
          const d = Math.hypot(o.eci.x - p.eci.x, o.eci.y - p.eci.y, o.eci.z - p.eci.z);
          if (d < 120) {
            found.push({ a: o, b: p, d });
            if (!o.conj || d < o.conj.d) o.conj = { d, with: p.name };
            if (!p.conj || d < p.conj.d) p.conj = { d, with: o.name };
          }
        }
      }
    }
    found.sort((x, y) => x.d - y.d);
    return found;
  }

  // ---------- 5. 描画 ----------
  const cv = $('globe');
  const ctx = cv.getContext('2d', { alpha: false });
  let W = 0, H = 0, DPR = 1, R = 100, CX = 0, CY = 0;

  function resize() {
    const r = cv.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // 陸地の点(単位ベクトル)を前計算
  const LAND = (() => {
    const rows = LAND_RLE.split('|');
    const pts = [];
    rows.forEach((row, r) => {
      const lat = 89 - r * 2;
      const keep = Math.max(1, Math.round(1 / Math.max(0.15, Math.cos(lat * DEG))));
      let col = 0, land = false;
      for (const run of row.split('.')) {
        const n = parseInt(run, 36) || 0;
        if (land) for (let c = col; c < col + n; c++) {
          if (c % keep) continue;
          const lon = -179 + c * 2;
          const cl = Math.cos(lat * DEG);
          pts.push(cl * Math.cos(lon * DEG), cl * Math.sin(lon * DEG), Math.sin(lat * DEG));
        }
        col += n; land = !land;
      }
    });
    return new Float32Array(pts);
  })();

  // 地球固定座標 → 画面(正射影)。戻り値は再利用オブジェクト
  const P = { x: 0, y: 0, z: 0 };
  let cLo = 1, sLo = 0, cLa = 1, sLa = 0;
  function setView() {
    cLo = Math.cos(-S.view.lon * DEG); sLo = Math.sin(-S.view.lon * DEG);
    cLa = Math.cos(S.view.lat * DEG); sLa = Math.sin(S.view.lat * DEG);
  }
  function proj(x, y, z, r) {
    const x1 = x * cLo - y * sLo, y1 = x * sLo + y * cLo;
    const x2 = x1 * cLa + z * sLa, z2 = -x1 * sLa + z * cLa;
    P.x = CX + R * r * y1; P.y = CY - R * r * z2; P.z = x2;
    return P;
  }
  // 高度の表示用圧縮(対数)。静止軌道(約36,000km)がちょうど外側リング(1.62)に乗る
  const dispR = (altKm) => 1 + 0.13 * Math.log(1 + Math.max(0, altKm) / 300);
  function projEcf(e) {
    const r = Math.hypot(e.x, e.y, e.z);
    return proj(e.x / r, e.y / r, e.z / r, dispR(r - RE));
  }
  const occluded = (p) => p.z < 0 && Math.hypot(p.x - CX, p.y - CY) < R;

  const COL = ['#39ff8a', '#ffb000', '#ff3b3b'];
  let sweep = 0;

  function draw(t) {
    if (S.view.auto && !drag.on) S.view.lon += 0.02 * (S.warp > 1 ? 2 : 1);
    S.view.lon = wrap180(S.view.lon);
    setView();
    R = Math.min(W, H) / 2 / 1.62 * S.view.zoom;
    CX = W / 2; CY = H / 2 - 8;

    ctx.fillStyle = '#030504';
    ctx.fillRect(0, 0, W, H);

    // 外周リング・目盛り
    ctx.strokeStyle = 'rgba(57,255,138,.12)';
    ctx.lineWidth = 1;
    for (const k of [1.25, 1.62]) { ctx.beginPath(); ctx.arc(CX, CY, R * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath();
    for (let a = 0; a < 360; a += 5) {
      const len = a % 30 === 0 ? 10 : 4;
      const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
      ctx.moveTo(CX + c * R * 1.62, CY + s * R * 1.62);
      ctx.lineTo(CX + c * (R * 1.62 - len), CY + s * (R * 1.62 - len));
    }
    ctx.stroke();

    // 地球の円盤とグロー
    const g = ctx.createRadialGradient(CX, CY, R * 0.2, CX, CY, R * 1.08);
    g.addColorStop(0, '#07130d'); g.addColorStop(0.92, '#04100a'); g.addColorStop(1, 'rgba(57,255,138,.18)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, R * 1.04, 0, Math.PI * 2); ctx.fill();

    // 経緯線
    ctx.strokeStyle = 'rgba(57,255,138,.10)';
    ctx.beginPath();
    for (let lon = -180; lon < 180; lon += 30) graticule(lon, true);
    for (let lat = -60; lat <= 60; lat += 30) graticule(lat, false);
    ctx.stroke();

    // 陸地(昼=明るい / 夜=暗い)
    const sun = S.sun;
    const day = new Path2D(), night = new Path2D();
    const sz = Math.max(1.2, R / 110);
    for (let i = 0; i < LAND.length; i += 3) {
      const x = LAND[i], y = LAND[i + 1], z = LAND[i + 2];
      const p = proj(x, y, z, 1);
      if (p.z <= 0.02) continue;
      const lit = x * sun.x + y * sun.y + z * sun.z > -0.05;
      (lit ? day : night).rect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.fillStyle = 'rgba(57,255,138,.62)'; ctx.fill(day);
    ctx.fillStyle = 'rgba(57,255,138,.2)'; ctx.fill(night);

    // 太陽直下点
    const sp = proj(sun.x, sun.y, sun.z, 1);
    if (sp.z > 0) {
      ctx.strokeStyle = 'rgba(255,176,0,.6)';
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2); ctx.stroke();
    }

    // レーダー掃引
    sweep = (sweep + 0.012) % (Math.PI * 2);
    const sg = ctx.createLinearGradient(CX, CY, CX + Math.cos(sweep) * R * 1.62, CY + Math.sin(sweep) * R * 1.62);
    sg.addColorStop(0, 'rgba(57,255,138,0)'); sg.addColorStop(1, 'rgba(57,255,138,.35)');
    ctx.strokeStyle = sg;
    ctx.beginPath(); ctx.moveTo(CX, CY);
    ctx.lineTo(CX + Math.cos(sweep) * R * 1.62, CY + Math.sin(sweep) * R * 1.62); ctx.stroke();

    // 観測地点
    const sl = S.site.lat * DEG, so = S.site.lon * DEG;
    const ss = proj(Math.cos(sl) * Math.cos(so), Math.cos(sl) * Math.sin(so), Math.sin(sl), 1);
    if (ss.z > 0) {
      const pulse = 4 + ((t / 120) % 14);
      ctx.strokeStyle = 'rgba(89,216,255,.9)';
      ctx.beginPath(); ctx.arc(ss.x, ss.y, 3, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(89,216,255,${0.6 - pulse / 30})`;
      ctx.beginPath(); ctx.arc(ss.x, ss.y, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#59d8ff'; ctx.font = '10px "Share Tech Mono", monospace';
      ctx.fillText(SITE_NAME, ss.x + 7, ss.y - 6);
    }

    // 選択対象の軌道・地上軌跡・可視範囲
    const o = S.sel;
    if (o && o.ok && o.track) drawSelectedOrbit(o);

    // 衛星
    ctx.font = '9px "Share Tech Mono", monospace';
    for (const s of S.objs) {
      s.vis = false;
      if (!s.ok) continue;
      const p = projEcf(s.ecf);
      if (occluded(p)) continue;
      s.vis = true; s.sx = p.x; s.sy = p.y;
      const col = COL[Math.max(0, s.level)];
      const back = p.z < 0;
      ctx.globalAlpha = back ? 0.35 : 1;
      ctx.fillStyle = col;
      const sz2 = s.level === 2 ? 4 : s.cls === 'DEBRIS' ? 1.6 : 2.6;
      ctx.fillRect(p.x - sz2 / 2, p.y - sz2 / 2, sz2, sz2);
      if (s.level === 2) {
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 + ((t / 90) % 8), 0, Math.PI * 2); ctx.stroke();
      }
      if (s.level > 0 && s !== o && !back) { ctx.fillText(s.name.slice(0, 14), p.x + 5, p.y - 4); }
      ctx.globalAlpha = 1;
    }

    // 接近ペアを結ぶ線
    ctx.setLineDash([2, 3]);
    for (const c of S.conj.slice(0, 6)) {
      if (!c.a.vis || !c.b.vis) continue;
      ctx.strokeStyle = c.d < 25 ? '#ff3b3b' : 'rgba(255,176,0,.7)';
      ctx.beginPath(); ctx.moveTo(c.a.sx, c.a.sy); ctx.lineTo(c.b.sx, c.b.sy); ctx.stroke();
    }
    ctx.setLineDash([]);

    if (o && o.ok && o.vis) drawReticle(o, t);
  }

  function graticule(v, meridian) {
    let pen = false;
    for (let k = -90; k <= 270; k += 6) {
      if (meridian && k > 90) break;
      const lat = (meridian ? k : v) * DEG, lon = (meridian ? v : k) * DEG;
      const p = proj(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat), 1);
      if (p.z > 0) { pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; } else pen = false;
    }
  }

  function drawSelectedOrbit(o) {
    // 軌道(高度つき)
    ctx.strokeStyle = 'rgba(57,255,138,.55)';
    ctx.beginPath();
    let pen = false;
    for (const e of o.track) {
      if (!e) { pen = false; continue; }
      const p = projEcf(e);
      if (occluded(p)) { pen = false; continue; }
      pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true;
    }
    ctx.stroke();
    // 地上軌跡(地表に投影)
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(89,216,255,.45)';
    ctx.beginPath(); pen = false;
    for (const e of o.track) {
      if (!e) { pen = false; continue; }
      const r = Math.hypot(e.x, e.y, e.z);
      const p = proj(e.x / r, e.y / r, e.z / r, 1);
      if (p.z <= 0) { pen = false; continue; }
      pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // 可視範囲(地平線円): 中心角 λ = acos(Re/(Re+h))
    const lam = Math.acos(RE / (RE + o.alt));
    const la = o.lat * DEG, lo = o.lon * DEG;
    ctx.strokeStyle = 'rgba(255,176,0,.45)';
    ctx.beginPath(); pen = false;
    for (let b = 0; b <= 360; b += 6) {
      const br = b * DEG;
      const lat2 = Math.asin(Math.sin(la) * Math.cos(lam) + Math.cos(la) * Math.sin(lam) * Math.cos(br));
      const lon2 = lo + Math.atan2(Math.sin(br) * Math.sin(lam) * Math.cos(la), Math.cos(lam) - Math.sin(la) * Math.sin(lat2));
      const p = proj(Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2), 1);
      if (p.z <= 0) { pen = false; continue; }
      pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true;
    }
    ctx.stroke();
  }

  function drawReticle(o, t) {
    const x = o.sx, y = o.sy;
    const s = 12 + Math.sin(t / 180) * 2;
    const col = COL[Math.max(0, o.level)];
    ctx.strokeStyle = col; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.moveTo(x + dx * s, y + dy * (s - 5)); ctx.lineTo(x + dx * s, y + dy * s); ctx.lineTo(x + dx * (s - 5), y + dy * s);
    }
    ctx.moveTo(x - s - 8, y); ctx.lineTo(x - s - 3, y);
    ctx.moveTo(x + s + 3, y); ctx.lineTo(x + s + 8, y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = col;
    ctx.font = '10px "Share Tech Mono", monospace';
    const right = x < W - 140;
    ctx.textAlign = right ? 'left' : 'right';
    const tx = right ? x + s + 6 : x - s - 6;
    ctx.fillText(o.name, tx, y - s - 2);
    ctx.fillStyle = 'rgba(185,201,192,.85)';
    ctx.fillText(`ALT ${fx(o.alt, 0)}km  V ${fx(o.vel, 2)}km/s`, tx, y + s + 10);
    ctx.textAlign = 'left';
  }

  // ---------- 入力(ドラッグ回転・ピンチ・タップ選択) ----------
  const drag = { on: false, x: 0, y: 0, moved: 0, ptrs: new Map(), pinch: 0 };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    drag.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.on = true; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0;
    if (drag.ptrs.size === 2) {
      const [a, b] = [...drag.ptrs.values()];
      drag.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag.ptrs.has(e.pointerId)) return;
    drag.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.ptrs.size === 2) {
      const [a, b] = [...drag.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag.pinch) S.view.zoom = Math.min(3.5, Math.max(0.6, S.view.zoom * d / drag.pinch));
      drag.pinch = d; drag.moved += 99;
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    const k = 90 / R;
    S.view.lon -= dx * k;
    S.view.lat = Math.max(-85, Math.min(85, S.view.lat + dy * k));
  });
  const up = (e) => {
    drag.ptrs.delete(e.pointerId);
    if (drag.ptrs.size < 2) drag.pinch = 0;
    if (drag.ptrs.size === 0) {
      drag.on = false;
      if (drag.moved < 6 && e.type === 'pointerup') tapSelect(e);
    }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    S.view.zoom = Math.min(3.5, Math.max(0.6, S.view.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, { passive: false });

  function tapSelect(e) {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 28;
    for (const s of S.objs) {
      if (!s.vis) continue;
      const d = Math.hypot(s.sx - x, s.sy - y);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) select(best);
  }

  function select(o) {
    S.sel = o;
    o.track = null;
    log('k-aos', `[LOCK] 目標捕捉 ${o.name} (#${o.norad}) — 追尾ループ開始`);
    log('k-ghost', `[TLE] ${o.tle[0]}`);
    log('k-ghost', `[TLE] ${o.tle[1]}`);
    beep(880, 0.06);
    renderList(true);
  }

  // ---------- 6. 傍受記録 ----------
  const logEl = $('log');
  function log(cls, msg) {
    const p = document.createElement('p');
    p.className = cls;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = utcStamp(simNow()).slice(11) + ' ';
    p.append(t, document.createTextNode(msg));          // 外部由来の名前も textContent 扱い
    logEl.prepend(p);
    while (logEl.childElementCount > 140) logEl.lastElementChild.remove();
  }

  const GHOST = [
    () => `[SIGINT] ${(2200 + Math.random() * 100).toFixed(1)}MHz 帯 走査中… 応答なし`,
    () => `[CRYPTO] セッション鍵 ローテーション 0x${hex(16)}`,
    () => `[NULL] 観測者を観測している観測者 — 識別不能`,
    () => `[MESH] 中継ノード ${pick(['ODIN', 'KESTREL', 'NADIR', 'UMBRA', 'VESPER'])}-${hex(2)} ハンドオーバー完了`,
    () => `[ARCHIVE] 軌道履歴 ${(Math.random() * 900 + 100).toFixed(0)}GB 圧縮 → 0x${hex(8)}`,
    () => `[SYS] 予測誤差 σ=${(Math.random() * 2 + 0.4).toFixed(2)}km — SGP4 は時間とともに鈍る`,
    () => `[ECHO] 未登録の反射を検知 RCS=${(Math.random() * 0.05).toFixed(3)}m² — 照合中…照合失敗`,
  ];

  function streamTick() {
    const ok = S.objs.filter((o) => o.ok);
    if (!ok.length) return;
    const r = Math.random();
    if (r < 0.34) {
      const o = pick(ok);
      log('k-sgp4', `[SGP4] ${o.name} r=(${fx(o.eci.x, 0)},${fx(o.eci.y, 0)},${fx(o.eci.z, 0)})km |v|=${fx(o.vel, 3)}km/s`);
    } else if (r < 0.48) {
      const o = pick(ok);
      log('k-sgp4', `[GEO] ${o.name} φ=${fx(o.lat, 3)}° λ=${fx(o.lon, 3)}° h=${fx(o.alt, 1)}km`);
    } else if (r < 0.6) {
      log('k-sgp4', `[GMST] θg=${fx((S.gmst / DEG + 360) % 360, 5)}°  太陽直下 φ=${fx(S.sun.dec / DEG, 2)}° λ=${fx(wrap180(S.sun.lon / DEG), 2)}°`);
    } else if (r < 0.78) {
      const top = ok.slice().sort((a, b) => b.score - a.score)[0];
      const q = top.reasons[0] || '異常なし';
      log('k-jev', `[JEV] Q:脅威度? → ${['NOMINAL', 'WATCH', 'ALERT'][Math.max(0, top.level)]} score=${top.score} (${top.name}) ${q}`);
    } else {
      log('k-ghost', pick(GHOST)());
    }
  }

  // 頭上通過(AOS/LOS)の出入りを検知
  function passEvents() {
    for (const o of S.objs) {
      if (!o.ok) continue;
      const upNow = o.el > 0;
      if (o.wasUp !== null && upNow !== o.wasUp) {
        if (upNow) log('k-aos', `[AOS] ${o.name} ${SITE_NAME} 上空に出現 az=${fx(o.az, 1)}° 距離=${fx(o.range, 0)}km`);
        else log('k-sgp4', `[LOS] ${o.name} 地平線下へ消失 az=${fx(o.az, 1)}°`);
      }
      o.wasUp = upNow;
    }
  }

  // ---------- UI更新 ----------
  const listEl = $('objlist');
  let listOrder = '';
  function renderList(force) {
    const arr = S.objs.slice().sort((a, b) => (b.score - a.score) || (a.id - b.id));
    const order = arr.map((o) => `${o.id}:${o.level}:${o.score}`).join(',') + (S.sel ? S.sel.id : '');
    if (!force && order === listOrder) return;
    listOrder = order;
    const frag = document.createDocumentFragment();
    for (const o of arr) {
      const li = document.createElement('li');
      li.className = `lv-${o.level < 0 ? 'x' : o.level}` + (o === S.sel ? ' sel' : '');
      li.dataset.id = o.id;
      const lv = document.createElement('i'); lv.className = 'lv';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = o.name;
      const alt = document.createElement('span'); alt.className = 'alt'; alt.textContent = o.ok ? `${fx(o.alt, 0)}km` : 'LOST';
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = o.ok ? pad(o.score, 2) : '--';
      li.append(lv, nm, alt, sc);
      frag.append(li);
    }
    listEl.replaceChildren(frag);
    $('obj-count').textContent = S.objs.filter((o) => o.ok).length + '/' + S.objs.length;
  }
  listEl.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const o = S.objs.find((x) => x.id === +li.dataset.id);
    if (o) select(o);
  });

  function kv(pairs) {
    const frag = document.createDocumentFragment();
    for (const [k, v] of pairs) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      frag.append(dt, dd);
    }
    return frag;
  }

  function renderTarget() {
    const o = S.sel;
    if (!o) return;
    $('t-name').textContent = `${o.name}`;
    const v = $('t-verdict');
    v.className = 'verdict' + (o.level > 0 ? ` l${o.level}` : '');
    v.textContent = o.ok
      ? `JEV ▸ ${['NOMINAL 平常', 'WATCH 監視強化', 'ALERT 警戒'][o.level]} / score ${o.score}` + (o.reasons.length ? ` / ${o.reasons.join(' · ')}` : '')
      : 'SIGNAL LOST — 伝搬不能(軌道要素が古いか再突入)';
    $('t-kv').replaceChildren(kv([
      ['識別 / CLASS', `#${o.norad} / ${o.cls}`],
      ['緯度 φ', `${fx(o.lat, 4)}°`],
      ['経度 λ', `${fx(o.lon, 4)}°`],
      ['高度 h', `${fx(o.alt, 2)} km`],
      ['速度 |v|', `${fx(o.vel, 4)} km/s`],
      ['周期 T', `${fx(o.period, 2)} min`],
      ['軌道傾斜 i', `${fx(o.inc, 3)}°`],
      ['離心率 e', fx(o.ecc, 6)],
      ['近地点/遠地点', `${fx(o.perigee, 0)} / ${fx(o.apogee, 0)} km`],
      [`${SITE_NAME} 方位/仰角`, `${fx(o.az, 1)}° / ${fx(o.el, 1)}°`],
      [`${SITE_NAME} 距離`, `${fx(o.range, 1)} km`],
      ['最近接物体', o.conj ? `${o.conj.with} Δ${fx(o.conj.d, 1)}km` : '—'],
    ]));
    $('t-tle').textContent = `${o.name}\n${o.tle[0]}\n${o.tle[1]}`;
  }

  function eq(f, v, n) {
    const d = document.createElement('div'); d.className = 'eq';
    const a = document.createElement('div'); a.className = 'f'; a.textContent = f;
    const b = document.createElement('div'); b.className = 'v'; b.textContent = v;
    const c = document.createElement('div'); c.className = 'n'; c.textContent = n;
    d.append(a, b, c);
    return d;
  }

  function renderMath() {
    const o = S.sel || S.objs.find((x) => x.ok);
    if (!o) return;
    const n = (o.nRevDay * 2 * Math.PI) / 86400;                    // rad/s
    const r = Math.hypot(o.eci.x, o.eci.y, o.eci.z);
    const visViva = Math.sqrt(MU * (2 / r - 1 / o.a));
    // ケプラー方程式をニュートン法で解いてみせる(表示用)
    const M = ((o.rec.mo + o.rec.no * ((simNow() - epochOf(o)) / 60000)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    let E = M, it = 0;
    for (; it < 8; it++) { const dE = (E - o.ecc * Math.sin(E) - M) / (1 - o.ecc * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-12) break; }
    const lam = Math.acos(RE / (RE + Math.max(1, o.alt)));
    $('math').replaceChildren(
      eq('M = E − e·sin E', `M=${fx(M, 6)}  E=${fx(E, 9)}  (${it + 1}回で収束)`, 'ケプラー方程式 / ニュートン法'),
      eq('a = ∛( μ / n² )', `n=${n.toExponential(6)} rad/s → a=${fx(o.a, 3)} km`, `μ=${MU} km³/s²`),
      eq('v = √( μ (2/r − 1/a) )', `r=${fx(r, 3)} km → v=${fx(visViva, 5)} km/s`, `SGP4実測 |v|=${fx(o.vel, 5)} km/s`),
      eq('θg = GMST(t)', `${fx((S.gmst / DEG + 360) % 360, 6)}°`, 'グリニッジ恒星時 / ECI→ECEF 回転角'),
      eq('λ = acos( Rₑ / (Rₑ+h) )', `${fx(lam / DEG, 3)}° → 半径 ${fx(lam * RE, 0)} km`, '可視範囲(地平線円)'),
      eq('B* · ρ(h)', `B*=${o.rec.bstar.toExponential(4)} 1/Rₑ`, '大気抵抗項 — 低軌道ほど寿命が削られる'),
    );
  }
  const epochOf = (o) => {
    const yr = o.rec.epochyr < 57 ? 2000 + o.rec.epochyr : 1900 + o.rec.epochyr;
    return Date.UTC(yr, 0, 1) + (o.rec.epochdays - 1) * 86400000;
  };

  function renderHud(fps) {
    const d = simNow();
    $('utc').textContent = utcStamp(d) + ' UTC';
    const ok = S.objs.filter((o) => o.ok);
    const up = ok.filter((o) => o.el > 0).length;
    $('hud-tl').textContent = (`TRACK  ${ok.length}\nIN VIEW ${up}\nWARP  ×${S.warp}`);
    $('hud-tr').textContent = `GMST ${fx((S.gmst / DEG + 360) % 360, 3)}°\nVIEW ${fx(S.view.lat, 1)}°,${fx(S.view.lon, 1)}°\n${fps} FPS`;
    $('hud-bl').textContent = `${SITE_NAME}\n${fx(S.site.lat, 2)}N ${fx(S.site.lon, 2)}E`;
    $('hud-br').textContent = `SRC ${S.src}\nSGP4/SDP4 · ALT LOG`;
  }

  function renderAlert() {
    const bar = $('alert'), txt = $('alert-text');
    const top = S.conj[0];
    const crit = S.objs.filter((o) => o.level === 2);
    let cls = '', msg = '監視網 正常 — 異常軌道なし';
    if (top && top.d < 25) {
      cls = 'alert'; msg = `接近警報 CONJUNCTION — ${top.a.name} ↔ ${top.b.name}  Δ=${fx(top.d, 1)}km`;
    } else if (crit.length) {
      cls = 'alert'; msg = `警戒 ${crit.length}件 — ${crit[0].name}: ${crit[0].reasons.join(' · ')}`;
    } else if (S.objs.some((o) => o.level === 1)) {
      const w = S.objs.filter((o) => o.level === 1);
      cls = 'watch'; msg = `監視強化 ${w.length}件 — ${w[0].name}: ${w[0].reasons[0] || ''}`;
    }
    bar.className = 'alertbar' + (cls ? ' ' + cls : '');
    txt.textContent = msg;
    $('stage').classList.toggle('alarm', cls === 'alert');
    if (cls === 'alert' && S.alarm === 0) { beep(440, 0.12); setTimeout(() => beep(330, 0.12), 160); }
    S.alarm = cls === 'alert' ? 1 : 0;
  }

  // 警報音(任意。最初はオフ)
  let actx = null;
  function beep(freq, dur) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.value = 0.04;
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (_) { /* 音が出ない端末でも続行 */ }
  }

  // ---------- ボタン・タブ ----------
  $('btn-rot').addEventListener('click', (e) => {
    S.view.auto = !S.view.auto; e.currentTarget.classList.toggle('on', S.view.auto);
  });
  $('btn-warp').addEventListener('click', (e) => {
    const w = WARPS[(WARPS.indexOf(S.warp) + 1) % WARPS.length];
    setWarp(w);
    e.currentTarget.textContent = '×' + w;
    e.currentTarget.classList.toggle('on', w > 1);
    log('k-warn', `[TIME] 時間加速 ×${w} — 予測時刻 ${utcStamp(simNow())}`);
    for (const o of S.objs) o.wasUp = null;
  });
  $('btn-site').addEventListener('click', () => {
    S.site = { lat: S.view.lat, lon: wrap180(S.view.lon) };
    for (const o of S.objs) o.wasUp = null;
    log('k-aos', `[SITE] 観測地点を移設 → ${fx(S.site.lat, 2)}°, ${fx(S.site.lon, 2)}°`);
  });
  $('btn-snd').addEventListener('click', (e) => {
    S.sound = !S.sound; e.currentTarget.classList.toggle('on', S.sound);
    beep(660, 0.05);
  });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === b.dataset.tab));
  }));

  // ---------- メインループ ----------
  let lastProp = 0, lastUi = 0, lastLog = 0, frames = 0, fpsT = 0, fps = 0;
  function loop(t) {
    if (document.hidden) { requestAnimationFrame(loop); return; }
    if (t - lastProp > 1000 / PROPAGATE_HZ) {
      lastProp = t;
      const d = simNow();
      propagateAll(d);
      if (t - S.lastScreen > SCREEN_MS) {
        S.lastScreen = t;
        S.conj = screenConjunctions();
        for (const o of S.objs) judge(o);
        passEvents();
        const c = S.conj[0];
        if (c && c.d < 120 && Math.random() < 0.5) {
          log(c.d < 25 ? 'k-alert' : 'k-warn', `[CONJ] ${c.a.name} ↔ ${c.b.name} Δ=${fx(c.d, 2)}km 相対速度 推定中`);
        }
      }
      const o = S.sel;
      if (o && o.ok && (!o.track || Math.abs(d - o.trackAt) > Math.min(60000 * S.warp, o.period * 6000))) {
        o.track = groundTrack(o, d); o.trackAt = d.getTime();
      }
    }
    draw(t);
    frames++;
    if (t - fpsT > 1000) { fps = frames; frames = 0; fpsT = t; }
    if (t - lastUi > 500) {
      lastUi = t;
      renderHud(fps); renderTarget(); renderMath(); renderList(false); renderAlert();
    }
    if (t - lastLog > 420 + Math.random() * 500) { lastLog = t; streamTick(); }
    requestAnimationFrame(loop);
  }

  // ---------- 起動 ----------
  async function boot() {
    resize();
    new ResizeObserver(resize).observe(cv);
    const boot = [
      '[BOOT] ARGUS//NULL 起動シーケンス開始',
      `[BOOT] 演算核 satellite.js SGP4/SDP4 ロード … OK`,
      `[BOOT] 地表マスク ${LAND.length / 3} 点 展開 … OK`,
      '[BOOT] 外部軌道要素ストリームへ接続を試行 …',
    ];
    boot.forEach((m) => log('k-aos', m));

    let entries, live = false;
    try {
      entries = await fetchLive();
      live = true;
    } catch (err) {
      entries = synthCatalog();
      log('k-warn', `[LINK] 外部ストリーム不通(${err && err.name === 'AbortError' ? 'TIMEOUT' : 'BLOCKED'}) — 内部合成要素に切替`);
    }
    S.src = live ? 'CELESTRAK' : 'SYNTH';
    const pill = $('src-pill');
    pill.classList.add(live ? 'live' : 'synth');
    $('src-label').textContent = live ? 'LIVE · CELESTRAK' : 'SYNTH · OFFLINE';

    S.objs = entries.map(makeObj).filter(Boolean);
    S.objs.forEach((o, i) => { o.id = i; });
    log('k-aos', `[CAT] 追跡対象 ${S.objs.length} 件 登録 — 型検査を通過しなかった要素は破棄`);
    propagateAll(simNow());
    S.conj = screenConjunctions();
    S.objs.forEach(judge);
    const first = S.objs.find((o) => /ISS|ZARYA/.test(o.name)) || S.objs[0];
    if (first) select(first);
    renderList(true);
    requestAnimationFrame(loop);
  }

  if (!sat || typeof sat.propagate !== 'function') {
    document.getElementById('alert-text').textContent = '演算核のロードに失敗 — vendor/satellite.min.js を確認';
    return;
  }
  boot();
})();
