/* =========================================================
   MAHJONG RELAX — mahjong solitaire with large tiles
   ========================================================= */
(function () {
'use strict';

// ---------- Storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('mj_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mj_' + k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem('mj_' + k); } catch (e) { } }
};
const S = {
  level: store.get('level', 1),          // next level to play
  done: store.get('done', {}),           // completed levels {n: true}
  coins: store.get('coins', 100),
  inv: store.get('inv', { hint: 3, shuffle: 3, undo: 3 }),
  daily: store.get('daily', {}),         // {'2026-11-17': true}
  set: Object.assign({ sound: true, vibe: true, dim: true, nums: true, theme: 'green' }, store.get('settings', {})),
};
const save = () => {
  store.set('level', S.level); store.set('done', S.done); store.set('coins', S.coins);
  store.set('inv', S.inv); store.set('daily', S.daily); store.set('settings', S.set);
};

const PRICE = { hint: 40, shuffle: 60, undo: 20 };
const REWARD_LEVEL = 25, REWARD_DAILY = 60;

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffleArr(a, rng = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pad2 = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
const MONTHS_SHORT = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];

// ---------- Sound ----------
const Snd = {
  ctx: null,
  init() { if (this.ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (AC) this.ctx = new AC(); },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(f, dur, type = 'sine', vol = 0.2, delay = 0, slide = null) {
    if (!S.set.sound || !this.ctx) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  click() { this.tone(1400, 0.05, 'triangle', 0.18); this.tone(700, 0.06, 'sine', 0.12, 0.005); },
  match() { this.tone(880, 0.18, 'sine', 0.22); this.tone(1320, 0.25, 'sine', 0.18, 0.07); },
  block() { this.tone(200, 0.12, 'square', 0.08); },
  hint() { this.tone(660, 0.12, 'sine', 0.15); this.tone(990, 0.18, 'sine', 0.15, 0.1); },
  shuffle() { for (let i = 0; i < 6; i++) this.tone(500 + Math.random() * 600, 0.05, 'triangle', 0.1, i * 0.05); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.2, i * 0.11)); },
  coin() { this.tone(1319, 0.08, 'square', 0.06); this.tone(1976, 0.15, 'square', 0.06, 0.06); },
};
const vibe = ms => { if (S.set.vibe) try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };

// ---------- Tile faces (SVG) ----------
// Tile kinds: d1-9 dots, b1-9 bamboo, c1-9 characters, wE wS wW wN winds,
// rR rG rW dragons, f1-4 flowers (any matches any), s1-4 seasons (any matches any)
const NORMAL_KINDS = [];
for (const s of ['d', 'b', 'c']) for (let i = 1; i <= 9; i++) NORMAL_KINDS.push(s + i);
NORMAL_KINDS.push('wE', 'wS', 'wW', 'wN', 'rR', 'rG', 'rW');
const matchKey = k => k[0] === 'f' ? 'F' : k[0] === 's' ? 'S' : k;

const BLUE = '#1f56b5', GREEN = '#17803a', RED = '#cc2b25', INK = '#1b2a4a';
const CJK = `font-family="'Noto Serif CJK SC','Noto Serif SC','Noto Sans CJK SC','Source Han Serif SC','Songti SC','SimSun',serif" font-weight="900"`;
const NUM_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function dot(x, y, r, c) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="#fff"/><circle cx="${x}" cy="${y}" r="${r * 0.36}" fill="${c}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.9}" fill="none" stroke="#fff" stroke-width="${r * 0.12}" stroke-dasharray="${r * 0.25} ${r * 0.2}"/>`;
}
const DOT_POS = {
  1: [[30, 40, 17, RED]],
  2: [[30, 22, 11, GREEN], [30, 58, 11, BLUE]],
  3: [[15, 16, 9, BLUE], [30, 40, 9, RED], [45, 64, 9, GREEN]],
  4: [[17, 22, 10, BLUE], [43, 22, 10, GREEN], [17, 58, 10, GREEN], [43, 58, 10, BLUE]],
  5: [[16, 18, 9, BLUE], [44, 18, 9, GREEN], [30, 40, 9, RED], [16, 62, 9, GREEN], [44, 62, 9, BLUE]],
  6: [[18, 16, 9, GREEN], [42, 16, 9, GREEN], [18, 42, 9, RED], [42, 42, 9, RED], [18, 64, 9, RED], [42, 64, 9, RED]],
  7: [[13, 12, 7, GREEN], [30, 20, 7, GREEN], [47, 28, 7, GREEN], [18, 48, 8, RED], [42, 48, 8, RED], [18, 67, 8, RED], [42, 67, 8, RED]],
  8: [[18, 12, 7.5, BLUE], [42, 12, 7.5, BLUE], [18, 30, 7.5, BLUE], [42, 30, 7.5, BLUE], [18, 50, 7.5, BLUE], [42, 50, 7.5, BLUE], [18, 68, 7.5, BLUE], [42, 68, 7.5, BLUE]],
  9: [[13, 16, 7.5, BLUE], [30, 16, 7.5, BLUE], [47, 16, 7.5, BLUE], [13, 40, 7.5, RED], [30, 40, 7.5, RED], [47, 40, 7.5, RED], [13, 64, 7.5, GREEN], [30, 64, 7.5, GREEN], [47, 64, 7.5, GREEN]],
};
function stick(x, y, h, c, w = 7) {
  const top = y - h / 2;
  return `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="${w / 2}" fill="${c}"/>` +
    `<rect x="${x - w / 2 - 1}" y="${y - 1.5}" width="${w + 2}" height="3" rx="1.5" fill="${c}"/>` +
    `<rect x="${x - w / 2 - 1}" y="${top}" width="${w + 2}" height="3" rx="1.5" fill="${c}"/>` +
    `<rect x="${x - w / 2 - 1}" y="${top + h - 3}" width="${w + 2}" height="3" rx="1.5" fill="${c}"/>` +
    `<rect x="${x - 1}" y="${top + 3}" width="2" height="${h - 6}" fill="rgba(255,255,255,.45)"/>`;
}
const BAM_POS = {
  2: [[30, 22, 26, GREEN], [30, 58, 26, BLUE]],
  3: [[30, 22, 26, BLUE], [18, 58, 26, GREEN], [42, 58, 26, GREEN]],
  4: [[19, 22, 26, BLUE], [41, 22, 26, GREEN], [19, 58, 26, GREEN], [41, 58, 26, BLUE]],
  5: [[16, 22, 26, GREEN], [44, 22, 26, BLUE], [30, 40, 26, RED], [16, 58, 26, BLUE], [44, 58, 26, GREEN]],
  6: [[14, 22, 26, GREEN], [30, 22, 26, GREEN], [46, 22, 26, GREEN], [14, 58, 26, BLUE], [30, 58, 26, BLUE], [46, 58, 26, BLUE]],
  7: [[30, 14, 18, RED], [14, 40, 18, GREEN], [30, 40, 18, GREEN], [46, 40, 18, GREEN], [14, 66, 18, BLUE], [30, 66, 18, BLUE], [46, 66, 18, BLUE]],
  8: [[10, 22, 26, GREEN], [23, 22, 26, GREEN], [37, 22, 26, GREEN], [50, 22, 26, GREEN], [10, 58, 26, BLUE], [23, 58, 26, BLUE], [37, 58, 26, BLUE], [50, 58, 26, BLUE]],
  9: [[14, 14, 18, GREEN], [30, 14, 18, RED], [46, 14, 18, BLUE], [14, 40, 18, GREEN], [30, 40, 18, RED], [46, 40, 18, BLUE], [14, 66, 18, GREEN], [30, 66, 18, RED], [46, 66, 18, BLUE]],
};
function bambooOne() {
  // decorative single bamboo with leaves
  return stick(30, 44, 56, GREEN, 10) +
    `<path d="M30 30 C 14 22, 10 12, 12 6 C 22 10, 28 20, 30 30Z" fill="${GREEN}"/>` +
    `<path d="M30 36 C 46 28, 50 18, 48 10 C 38 14, 32 24, 30 36Z" fill="${RED}"/>` +
    `<circle cx="30" cy="12" r="5" fill="${RED}"/>`;
}
const FLOWERS = ['🌸', '🌼', '🌺', '🌷'];
const SEASONS = ['🌱', '☀️', '🍁', '❄️'];
const WIND = { wE: ['東', 'L'], wS: ['南', 'J'], wW: ['西', 'P'], wN: ['北', 'V'] };
const faceCache = {};
function faceSVG(k) {
  const key = k + (S.set.nums ? 'n' : '');
  if (faceCache[key]) return faceCache[key];
  let body = '', corner = '';
  const t = k[0], n = +k[1];
  if (t === 'd') { body = DOT_POS[n].map(p => dot(...p)).join(''); corner = n; }
  else if (t === 'b') { body = n === 1 ? bambooOne() : BAM_POS[n].map(p => stick(p[0], p[1], p[2], p[3], n === 8 ? 6 : 7)).join(''); corner = n; }
  else if (t === 'c') {
    body = `<text x="30" y="34" text-anchor="middle" font-size="30" fill="${INK}" ${CJK}>${NUM_CN[n]}</text>` +
      `<text x="30" y="72" text-anchor="middle" font-size="32" fill="${RED}" ${CJK}>萬</text>`;
    corner = n;
  } else if (t === 'w') {
    body = `<text x="30" y="56" text-anchor="middle" font-size="44" fill="${INK}" ${CJK}>${WIND[k][0]}</text>`;
    corner = WIND[k][1];
  } else if (k === 'rR') body = `<text x="30" y="57" text-anchor="middle" font-size="48" fill="${RED}" ${CJK}>中</text>`;
  else if (k === 'rG') body = `<text x="30" y="57" text-anchor="middle" font-size="44" fill="${GREEN}" ${CJK}>發</text>`;
  else if (k === 'rW') body = `<rect x="9" y="10" width="42" height="60" rx="4" fill="none" stroke="${BLUE}" stroke-width="5"/><rect x="16" y="17" width="28" height="46" rx="2" fill="none" stroke="${BLUE}" stroke-width="2.5"/>`;
  else if (t === 'f' || t === 's') {
    const em = (t === 'f' ? FLOWERS : SEASONS)[n - 1];
    const bg = t === 'f' ? '#ffd9e6' : '#d6ecff';
    body = `<circle cx="30" cy="40" r="25" fill="${bg}"/><text x="30" y="52" text-anchor="middle" font-size="34">${em}</text>`;
  }
  if (S.set.nums && corner !== '') corner = `<text x="3" y="12" font-size="12" font-weight="800" fill="#7a6a48" font-family="system-ui,sans-serif">${corner}</text>`;
  else corner = '';
  return faceCache[key] = `<svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg">${body}${corner}</svg>`;
}

// ---------- Layout generation ----------
// Positions use half-tile units: a tile at (x,y) covers x..x+2, y..y+2. z = layer.
function candidateLayout(rng, target) {
  const R = (a, b) => a + Math.floor(rng() * (b - a + 1));
  let cols, rows, maxZ, fill;
  if (target <= 24)      { cols = R(3, 5); rows = R(3, 5); maxZ = R(1, 2); fill = 0.6 + rng() * 0.4; }
  else if (target <= 50) { cols = R(4, 6); rows = R(4, 7); maxZ = R(1, 3); fill = 0.6 + rng() * 0.4; }
  else if (target <= 80) { cols = R(5, 7); rows = R(6, 8); maxZ = R(2, 3); fill = 0.65 + rng() * 0.35; }
  else                   { cols = R(6, 7); rows = R(7, 8); maxZ = R(3, 4); fill = 0.75 + rng() * 0.25; }
  const style = rng() < 0.5 ? 'stack' : 'pyramid';
  const stagger = rng() < 0.25;
  const mirrorX = x => 2 * (cols - 1) - x;
  const tiles = [];
  const has = new Set();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const add = (x, y, z) => { const k = key(x, y, z); if (!has.has(k)) { has.add(k); tiles.push({ x, y, z }); } };
  for (let r = 0; r < rows; r++) {
    const off = (stagger && r % 2) ? 1 : 0;
    const nc = off ? cols - 1 : cols;
    for (let c = 0; c < Math.ceil(nc / 2); c++) {
      if (rng() < fill || (r === Math.floor(rows / 2))) {
        const x = c * 2 + off;
        add(x, r * 2, 0); add(mirrorX(x), r * 2, 0);
      }
    }
  }
  for (let z = 1; z < maxZ; z++) {
    const prev = tiles.filter(t => t.z === z - 1);
    const at = (x, y) => has.has(key(x, y, z - 1));
    let cands = [];
    for (const t of prev) {
      if (style === 'stack') {
        if (at(t.x - 2, t.y) && at(t.x + 2, t.y) && at(t.x, t.y - 2) && at(t.x, t.y + 2)) cands.push([t.x, t.y]);
      } else {
        if (at(t.x + 2, t.y) && at(t.x, t.y + 2) && at(t.x + 2, t.y + 2)) cands.push([t.x + 1, t.y + 1]);
      }
    }
    if (!cands.length) break;
    const p = style === 'stack' ? 0.85 : 0.92;
    for (const [x, y] of cands) {
      const mx = mirrorX(x) - (style === 'pyramid' ? 0 : 0);
      if (x > mx) continue;
      if (rng() < p) { add(x, y, z); add(mx, y, z); }
    }
  }
  return tiles;
}
function makeLayout(seed, target) {
  const rng = mulberry32(seed * 7919 + 13);
  let best = null, bestD = 1e9;
  for (let i = 0; i < 200; i++) {
    const L = candidateLayout(rng, target);
    if (L.length < 8) continue;
    const n = L.length - (L.length % 2);
    const d = Math.abs(n - target);
    if (d < bestD) { best = L; bestD = d; if (d <= 1) break; }
  }
  if (best.length % 2) {
    // remove the topmost tile closest to the centre
    const cx = best.reduce((s, t) => s + t.x, 0) / best.length;
    best.sort((a, b) => b.z - a.z || Math.abs(a.x - cx) - Math.abs(b.x - cx));
    best.shift();
  }
  // normalise to start at 0,0
  const minX = Math.min(...best.map(t => t.x)), minY = Math.min(...best.map(t => t.y));
  return best.map(t => ({ x: t.x - minX, y: t.y - minY, z: t.z }));
}
const levelTarget = lv => Math.min(112, 16 + Math.round(lv * 1.4) + (lv % 7 === 0 ? 8 : 0));

// ---------- Board rules ----------
function isFree(t, tiles) {
  let left = false, right = false;
  for (const u of tiles) {
    if (u === t || u.removed) continue;
    if (u.z === t.z + 1 && Math.abs(u.x - t.x) < 2 && Math.abs(u.y - t.y) < 2) return false;
    if (u.z === t.z && Math.abs(u.y - t.y) < 2) {
      if (u.x === t.x - 2) left = true;
      else if (u.x === t.x + 2) right = true;
    }
  }
  return !(left && right);
}
// Assign kinds to positions so the deal is solvable: repeatedly remove a random pair of
// free positions and give them the same kind. The removal order is a valid solution.
function solvableAssign(positions, pairs, rng = Math.random) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const pool = positions.map(p => ({ x: p.x, y: p.y, z: p.z, removed: false, ref: p }));
    const order = shuffleArr(pairs.slice(), rng);
    let ok = true;
    for (let i = 0; i < order.length; i++) {
      const live = pool.filter(p => !p.removed);
      const free = live.filter(p => isFree(p, live));
      if (free.length < 2) { ok = false; break; }
      // prefer higher tiles first so stacks don't strand pieces
      free.sort((a, b) => (b.z - a.z) + (rng() - 0.5) * 1.5);
      const a = free[0];
      const rest = free.slice(1);
      const b = rest[Math.floor(rng() * rest.length)];
      a.removed = b.removed = true;
      a.ref._k = order[i][0]; b.ref._k = order[i][1];
    }
    if (ok) return true;
  }
  return false;
}
function buildPairs(nPairs, variety, rng) {
  // each normal kind gives up to 2 pairs (4 tiles); flowers and seasons 2 pairs each
  const kinds = shuffleArr(NORMAL_KINDS.slice(), rng);
  const flowerPairs = [['f1', 'f2'], ['f3', 'f4']], seasonPairs = [['s1', 's2'], ['s3', 's4']];
  let pairs = [];
  if (variety === 'low') {
    // fewer distinct faces: use both pairs of each kind before moving on
    const list = kinds.concat(['F', 'S']);
    for (const k of list) {
      if (pairs.length >= nPairs) break;
      const two = k === 'F' ? flowerPairs : k === 'S' ? seasonPairs : [[k, k], [k, k]];
      pairs.push(two[0]); if (pairs.length < nPairs) pairs.push(two[1]);
    }
  } else {
    let all = [];
    for (const k of kinds) all.push([k, k], [k, k]);
    all.push(...flowerPairs, ...seasonPairs);
    shuffleArr(all, rng);
    pairs = all.slice(0, nPairs);
  }
  return pairs;
}

// ---------- Game state ----------
let G = null;   // current game
let timerInt = null;

function newGame(mode, id) {
  // mode: 'level' (id = level number) or 'daily' (id = 'YYYY-MM-DD')
  let seed, target, variety;
  if (mode === 'level') { seed = id; target = levelTarget(id); variety = id < 25 ? 'low' : (id < 60 ? (id % 2 ? 'low' : 'high') : 'high'); }
  else { const [y, m, d] = id.split('-').map(Number); seed = y * 10000 + m * 100 + d + 777; target = 68 + (d % 4) * 8; variety = 'high'; }
  let layout = makeLayout(seed, target);
  let tiles = layout.map((p, i) => ({ id: i, x: p.x, y: p.y, z: p.z, k: null, removed: false }));
  const rng = Math.random;
  let ok = false;
  for (let tries = 0; tries < 5 && !ok; tries++) {
    const pairs = buildPairs(tiles.length / 2, variety, rng);
    ok = solvableAssign(tiles, pairs, rng);
    if (ok) tiles.forEach(t => { t.k = t._k; delete t._k; });
  }
  if (!ok) { // fall back to a simple layout (should never happen)
    layout = makeLayout(seed + 1, 24);
    tiles = layout.map((p, i) => ({ id: i, x: p.x, y: p.y, z: p.z, k: null, removed: false }));
    solvableAssign(tiles, buildPairs(tiles.length / 2, 'low', rng), rng);
    tiles.forEach(t => { t.k = t._k; delete t._k; });
  }
  G = { mode, id, tiles, history: [], time: 0, sel: null, used: 0, won: false };
  saveGame();
  startGameScreen();
}
function saveGame() {
  if (!G || G.won) { store.del('game'); return; }
  store.set('game', { mode: G.mode, id: G.id, time: G.time, used: G.used, history: G.history, tiles: G.tiles.map(t => [t.x, t.y, t.z, t.k, t.removed ? 1 : 0]) });
}
function loadGame(mode, id) {
  const g = store.get('game', null);
  if (!g || g.mode !== mode || g.id !== id) return false;
  G = { mode, id, time: g.time || 0, used: g.used || 0, history: g.history || [], sel: null, won: false,
    tiles: g.tiles.map((a, i) => ({ id: i, x: a[0], y: a[1], z: a[2], k: a[3], removed: !!a[4] })) };
  if (G.tiles.every(t => t.removed)) return false;
  return true;
}
function playLevel(n) { if (!loadGame('level', n)) newGame('level', n); else startGameScreen(); }
function playDaily(key) { if (!loadGame('daily', key)) newGame('daily', key); else startGameScreen(); }

// ---------- Rendering ----------
const boardEl = $('board'), wrapEl = $('boardWrap');
let geo = null;
function layoutBoard() {
  if (!G) return;
  const live = G.tiles;
  const maxX = Math.max(...live.map(t => t.x)) + 2, maxY = Math.max(...live.map(t => t.y)) + 2;
  const maxZ = Math.max(...live.map(t => t.z));
  const W = wrapEl.clientWidth, H = wrapEl.clientHeight;
  const ASPECT = 1.3;
  const depthX = 0.09, depthY = 0.07;   // per-layer shift (fraction of tile width)
  // board width in tile-widths: maxX/2 + depth*maxZ + edge
  const tw = Math.min(
    W / (maxX / 2 + depthX * maxZ + 0.12),
    H / ((maxY / 2) * ASPECT + depthY * maxZ * 1 + 0.14),
    120);
  const th = tw * ASPECT;
  geo = { tw, th, hw: tw / 2, hh: th / 2, lx: tw * depthX, ly: tw * depthY, maxZ };
  const bw = maxX * geo.hw + maxZ * geo.lx, bh = maxY * geo.hh + maxZ * geo.ly;
  boardEl.style.width = bw + 'px'; boardEl.style.height = bh + 'px';
  boardEl.style.marginLeft = (-bw / 2 - 2) + 'px'; boardEl.style.marginTop = (-bh / 2 - 3) + 'px';
  for (const t of G.tiles) if (t.el) placeTile(t);
}
function placeTile(t) {
  const el = t.el;
  el.style.left = (t.x * geo.hw + (geo.maxZ - t.z) * geo.lx) + 'px';
  el.style.top = (t.y * geo.hh + (geo.maxZ - t.z) * geo.ly) + 'px';
  el.style.width = (geo.tw - 2) + 'px';
  el.style.height = (geo.th - 2) + 'px';
  el.style.zIndex = t.z * 10000 + t.y * 100 + t.x;
}
function renderBoard(animate) {
  boardEl.innerHTML = '';
  layoutBoard();
  for (const t of G.tiles) {
    if (t.removed) { t.el = null; continue; }
    const el = document.createElement('div');
    el.className = 'tile' + (animate ? ' appear' : '');
    if (animate) el.style.animationDelay = (t.z * 0.08 + Math.random() * 0.15) + 's';
    el.innerHTML = faceSVG(t.k);
    el.dataset.id = t.id;
    t.el = el;
    placeTile(t);
    boardEl.appendChild(el);
  }
  refreshFree();
  updateInfo();
}
function liveTiles() { return G.tiles.filter(t => !t.removed); }
function refreshFree() {
  const live = liveTiles();
  for (const t of live) {
    const f = isFree(t, live);
    t.free = f;
    t.el.classList.toggle('blocked', !f);
    t.el.classList.toggle('dim', S.set.dim);
  }
}
function updateInfo() {
  $('tilesLeft').textContent = liveTiles().length;
  const s = Math.floor(G.time);
  $('timer').textContent = Math.floor(s / 60) + ':' + pad2(s % 60);
  updateTools();
}
function updateTools() {
  for (const k of ['hint', 'shuffle', 'undo']) {
    const b = $(k + 'Count');
    if (S.inv[k] > 0) { b.textContent = S.inv[k]; b.classList.remove('buy'); }
    else { b.textContent = '🪙' + PRICE[k]; b.classList.add('buy'); }
  }
  document.querySelectorAll('.coinsVal').forEach(e => e.textContent = S.coins);
}

// ---------- Interaction ----------
function clearHints() { G.tiles.forEach(t => t.el && t.el.classList.remove('hint')); }
boardEl.addEventListener('click', e => {
  const el = e.target.closest('.tile');
  if (!el || !G || G.won) return;
  Snd.resume();
  const t = G.tiles[+el.dataset.id];
  if (t.removed) return;
  if (!t.free) {
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    Snd.block(); vibe(15);
    if (G.sel) { /* keep selection */ }
    return;
  }
  if (G.sel === t) { t.el.classList.remove('sel'); G.sel = null; Snd.click(); return; }
  if (G.sel && matchKey(G.sel.k) === matchKey(t.k)) {
    removePair(G.sel, t);
    return;
  }
  if (G.sel) G.sel.el.classList.remove('sel');
  G.sel = t; t.el.classList.add('sel');
  Snd.click(); vibe(8);
});

function removePair(a, b) {
  clearHints();
  a.el.classList.remove('sel'); b.el.classList.remove('sel');
  a.removed = b.removed = true;
  G.sel = null;
  G.history.push([a.id, b.id]);
  for (const t of [a, b]) {
    const el = t.el; t.el = null;
    el.classList.add('gone');
    setTimeout(() => el.remove(), 300);
  }
  Snd.match(); vibe(20);
  refreshFree();
  updateInfo();
  saveGame();
  const live = liveTiles();
  if (!live.length) { setTimeout(win, 450); return; }
  if (!findPair()) setTimeout(noMoves, 500);
}
function findPair() {
  const free = liveTiles().filter(t => t.free);
  const byKey = {};
  for (const t of free) { const k = matchKey(t.k); if (byKey[k]) return [byKey[k], t]; byKey[k] = t; }
  return null;
}

function useItem(kind, fn) {
  if (S.inv[kind] > 0) { S.inv[kind]--; save(); fn(); updateTools(); return; }
  const names = { hint: 'Ndihmë', shuffle: 'Përzierje', undo: 'Kthim mbrapa' };
  const icons = { hint: '💡', shuffle: '🔀', undo: '↶' };
  if (S.coins >= PRICE[kind]) {
    modal(icons[kind], names[kind], `Nuk të kanë mbetur më. Dëshiron të blesh 1 për ${PRICE[kind]} monedha?`, [
      { t: `Bli për 🪙 ${PRICE[kind]}`, cls: 'primary', fn: () => { S.coins -= PRICE[kind]; save(); Snd.coin(); fn(); updateTools(); } },
      { t: 'Jo tani' }]);
  } else {
    modal(icons[kind], names[kind], `Nuk ke mjaftueshëm monedha (duhen ${PRICE[kind]}). Kalo nivele për të fituar monedha!`, [{ t: 'Në rregull', cls: 'primary' }]);
  }
}
$('hintBtn').onclick = () => {
  if (!G || G.won) return; Snd.resume();
  const p = findPair();
  if (!p) { noMoves(); return; }
  useItem('hint', () => {
    clearHints();
    const q = findPair();
    q.forEach(t => t.el.classList.add('hint'));
    G.used++; Snd.hint(); saveGame();
  });
};
$('undoBtn').onclick = () => {
  if (!G || G.won) return; Snd.resume();
  if (!G.history.length) { toast('Nuk ka asgjë për të kthyer'); return; }
  useItem('undo', () => {
    const [ia, ib] = G.history.pop();
    for (const id of [ia, ib]) {
      const t = G.tiles[id]; t.removed = false;
      const el = document.createElement('div');
      el.className = 'tile appear'; el.innerHTML = faceSVG(t.k); el.dataset.id = t.id;
      t.el = el; placeTile(t); boardEl.appendChild(el);
    }
    if (G.sel) { G.sel.el && G.sel.el.classList.remove('sel'); G.sel = null; }
    clearHints(); refreshFree(); updateInfo(); G.used++; saveGame(); Snd.click();
  });
};
$('shuffleBtn').onclick = () => { if (!G || G.won) return; Snd.resume(); useItem('shuffle', doShuffle); };
function doShuffle() {
  const live = liveTiles();
  // group remaining faces into pairs by match key
  const groups = {};
  for (const t of live) (groups[matchKey(t.k)] = groups[matchKey(t.k)] || []).push(t.k);
  const pairs = [];
  for (const k in groups) { const arr = groups[k]; for (let i = 0; i + 1 < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]); }
  const ok = solvableAssign(live, pairs);
  if (!ok) { toast('Nuk u përzie dot, provo sërish'); return; }
  live.forEach(t => { t.k = t._k; delete t._k; });
  if (G.sel) { G.sel = null; }
  G.history = []; G.used++;
  Snd.shuffle(); vibe(30);
  renderBoard(true);
  saveGame();
}
function noMoves() {
  if (!G || G.won) return;
  modal('🤔', 'Nuk ka më lëvizje', 'Nuk ka më çifte të lira. Përzieji pllakat që të vazhdosh — përzierja e parë këtu është falas!', [
    { t: '🔀 Përzie falas', cls: 'primary', fn: doShuffle },
    { t: '↺ Fillo nga e para', fn: () => newGame(G.mode, G.id) }]);
}

// ---------- Win ----------
function win() {
  if (G.won) return;
  G.won = true;
  clearInterval(timerInt);
  store.del('game');
  Snd.win(); vibe([30, 40, 60]);
  confetti();
  const s = Math.floor(G.time), timeTxt = Math.floor(s / 60) + ':' + pad2(s % 60);
  if (G.mode === 'level') {
    const first = !S.done[G.id];
    const bonus = G.used === 0 ? 15 : 0;
    const reward = first ? REWARD_LEVEL + bonus : 5;
    S.done[G.id] = true; S.coins += reward;
    if (G.id >= S.level) S.level = G.id + 1;
    save();
    modal('🎉', `Niveli ${G.id} u kalua!`, `Koha: ${timeTxt}<br>Fitove <b>🪙 ${reward}</b> monedha${bonus ? ' (bonus pa ndihmë!)' : ''}`, [
      { t: `Niveli ${G.id + 1} ›`, cls: 'primary', fn: () => playLevel(G.id + 1) },
      { t: 'Menuja kryesore', fn: goHome }]);
  } else {
    const first = !S.daily[G.id];
    S.daily[G.id] = true;
    const reward = first ? REWARD_DAILY : 5;
    S.coins += reward; save();
    modal('🏆', 'Sfida u kalua!', `Fitove një trofe për ${fmtDate(G.id)}!<br>Koha: ${timeTxt} · <b>🪙 ${reward}</b>`, [
      { t: 'Kalendari', cls: 'primary', fn: () => openDaily() },
      { t: 'Menuja kryesore', fn: goHome }]);
  }
  updateTools();
}
function confetti() {
  const box = $('confetti'); box.innerHTML = '';
  const em = ['🀄', '🌸', '✨', '🎉', '⭐', '🪙'];
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('i');
    s.textContent = em[i % em.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (2 + Math.random() * 2) + 's';
    s.style.animationDelay = Math.random() * 0.8 + 's';
    box.appendChild(s);
  }
  setTimeout(() => box.innerHTML = '', 5000);
}

// ---------- Screens ----------
const SCREENS = ['home', 'game', 'levels', 'daily', 'settings'];
let current = 'home';
function showScreen(id) { current = id; SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id)); }
function goHome() {
  closeModal(); clearInterval(timerInt);
  if (G && !G.won) saveGame();
  updateHome(); showScreen('home');
}
function fmtDate(key) { const [y, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; }
function updateHome() {
  $('playSub').textContent = 'Niveli ' + S.level;
  const t = new Date(), k = dateKey(t);
  $('dailySub').textContent = S.daily[k] ? `✔ ${t.getDate()} ${MONTHS_SHORT[t.getMonth()]} u krye` : `${t.getDate()} ${MONTHS[t.getMonth()]}`;
  updateTools();
}
function startGameScreen() {
  closeModal();
  showScreen('game');
  $('gameTitle').textContent = G.mode === 'level' ? 'Niveli ' + G.id : 'Sfida · ' + fmtDate(G.id);
  requestAnimationFrame(() => {
    renderBoard(true);
    if (G.mode === 'level' && G.id === 1 && !store.get('tutorial', false)) {
      store.set('tutorial', true);
      setTimeout(() => modal('👋', 'Mirë se erdhe!', 'Prek dy pllaka <b>të njëjta</b> që janë <b>të ndriçuara</b> (të lira). Pllakat e errëta janë të bllokuara. Hiqi të gjitha për të fituar!', [{ t: 'Fillojmë!', cls: 'primary', fn: () => { const p = findPair(); p && p.forEach(t => t.el.classList.add('hint')); } }]), 600);
    }
    const p = findPair(); if (!p) setTimeout(noMoves, 800);
  });
  clearInterval(timerInt);
  timerInt = setInterval(() => {
    if (!G || G.won || current !== 'game' || !$('modal').classList.contains('hidden') || document.hidden) return;
    G.time += 1; updateInfo();
    if (Math.floor(G.time) % 5 === 0) saveGame();
  }, 1000);
}
window.addEventListener('resize', () => { if (current === 'game' && G) layoutBoard(); });

$('playBtn').onclick = () => { Snd.resume(); playLevel(S.level); };
$('dailyBtn').onclick = () => { Snd.resume(); openDaily(); };
$('levelsBtn').onclick = () => { renderLevels(); showScreen('levels'); };
$('settingsBtn').onclick = () => { renderSettings(); showScreen('settings'); };
$('backBtn').onclick = goHome;
document.querySelectorAll('.back').forEach(b => b.onclick = goHome);

function renderLevels() {
  const grid = $('levelGrid'); grid.innerHTML = '';
  const max = Math.max(S.level + 11, 40);
  for (let i = 1; i <= max; i++) {
    const b = document.createElement('button');
    b.className = 'lv' + (S.done[i] ? ' done' : '') + (i > S.level ? ' locked' : '');
    b.textContent = i > S.level ? '🔒' : i;
    if (i <= S.level) b.onclick = () => playLevel(i);
    grid.appendChild(b);
  }
  setTimeout(() => { const cur = grid.children[S.level - 1]; cur && cur.scrollIntoView({ block: 'center' }); }, 30);
}

// Daily calendar
let calY, calM, calSel;
function openDaily() {
  closeModal();
  const t = new Date(); calY = t.getFullYear(); calM = t.getMonth(); calSel = dateKey(t);
  renderCal(); showScreen('daily');
}
function renderCal() {
  const today = new Date(); const tk = dateKey(today);
  $('calMonth').textContent = MONTHS[calM] + ' ' + calY;
  const first = new Date(calY, calM, 1);
  const days = new Date(calY, calM + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;   // Monday first
  const grid = $('calGrid'); grid.innerHTML = '';
  for (let i = 0; i < lead; i++) { const e = document.createElement('span'); e.className = 'cd empty'; grid.appendChild(e); }
  let doneCount = 0;
  for (let d = 1; d <= days; d++) {
    const k = `${calY}-${pad2(calM + 1)}-${pad2(d)}`;
    const b = document.createElement('button');
    const future = k > tk;
    const done = !!S.daily[k]; if (done) doneCount++;
    b.className = 'cd' + (future ? ' future' : '') + (done ? ' done' : '') + (k === tk ? ' today' : '') + (k === calSel ? ' sel' : '');
    b.textContent = done ? '🏆' : d;
    if (!future) b.onclick = () => { calSel = k; renderCal(); Snd.resume(); Snd.click(); };
    grid.appendChild(b);
  }
  $('tbFill').style.width = (100 * doneCount / days) + '%';
  $('tbText').textContent = `${doneCount}/${days}`;
  const now = new Date();
  $('calNext').style.visibility = (calY < now.getFullYear() || (calY === now.getFullYear() && calM < now.getMonth())) ? 'visible' : 'hidden';
  const pb = $('dailyPlay');
  pb.innerHTML = calSel ? (S.daily[calSel] ? `Luaj sërish · ${fmtDate(calSel)}` : `Luaj · ${fmtDate(calSel)}`) : 'Zgjidh një ditë';
  pb.disabled = !calSel;
}
$('calPrev').onclick = () => { calM--; if (calM < 0) { calM = 11; calY--; } calSel = null; renderCal(); };
$('calNext').onclick = () => { calM++; if (calM > 11) { calM = 0; calY++; } calSel = null; renderCal(); };
$('dailyPlay').onclick = () => { if (calSel) playDaily(calSel); };

// Settings
function renderSettings() {
  $('setSound').checked = S.set.sound; $('setVibe').checked = S.set.vibe;
  $('setDim').checked = S.set.dim; $('setNums').checked = S.set.nums;
  document.querySelectorAll('.th').forEach(b => b.classList.toggle('on', b.dataset.theme === S.set.theme));
}
$('setSound').onchange = e => { S.set.sound = e.target.checked; save(); Snd.resume(); Snd.click(); };
$('setVibe').onchange = e => { S.set.vibe = e.target.checked; save(); vibe(30); };
$('setDim').onchange = e => { S.set.dim = e.target.checked; save(); };
$('setNums').onchange = e => { S.set.nums = e.target.checked; save(); };
document.querySelectorAll('.th').forEach(b => b.onclick = () => { S.set.theme = b.dataset.theme; applyTheme(); save(); renderSettings(); });
function applyTheme() {
  document.body.className = 'theme-' + S.set.theme;
  const col = { green: '#17603f', blue: '#1d4e80', wood: '#6e4523', purple: '#533786', sand: '#b38f58' }[S.set.theme];
  document.querySelector('meta[name=theme-color]').setAttribute('content', col);
}

// Modal & toast
function modal(icon, title, text, btns) {
  $('mIcon').textContent = icon; $('mTitle').textContent = title; $('mText').innerHTML = text;
  const box = $('mBtns'); box.innerHTML = '';
  for (const b of btns) {
    const el = document.createElement('button');
    el.className = 'btn big ' + (b.cls || '');
    el.textContent = b.t;
    el.onclick = () => { closeModal(); b.fn && b.fn(); };
    box.appendChild(el);
  }
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }
let toastT;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 1500); }

// Android back button
const AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
if (AppPlugin) {
  AppPlugin.addListener('backButton', () => {
    if (!$('modal').classList.contains('hidden')) { if (current === 'game' && G && G.won) goHome(); else closeModal(); return; }
    if (current === 'home') AppPlugin.exitApp();
    else goHome();
  });
}
document.addEventListener('visibilitychange', () => { if (document.hidden && G && !G.won) saveGame(); });

// Debug/test hook
window.__mj = { get G() { return G; }, S, isFree, findPair, removePair, makeLayout, levelTarget, newGame, solvableAssign, buildPairs, liveTiles };

// ---------- Start ----------
applyTheme();
updateHome();
showScreen('home');
})();
