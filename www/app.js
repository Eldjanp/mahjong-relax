/* =========================================================
   MAHJONG RELAX — mahjong solitaire with large 3D tiles
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
  level: store.get('level', 1),
  done: store.get('done', {}),
  stars: store.get('stars', {}),
  coins: store.get('coins', 100),
  inv: Object.assign({ hint: 3, shuffle: 3, undo: 3, clear: 3 }, store.get('inv', {})),
  daily: store.get('daily', {}),
  set: Object.assign({ sound: true, music: true, vibe: true, dim: true, nums: true, bg: 'jade', tiles: 'jade' }, store.get('settings', {})),
};
// migrate old theme setting
if (S.set.theme && !store.get('migrated', false)) { S.set.bg = { green: 'jade', blue: 'ocean', wood: 'sunset', purple: 'lavender', sand: 'sunset' }[S.set.theme] || 'jade'; delete S.set.theme; store.set('migrated', true); }
const save = () => {
  store.set('level', S.level); store.set('done', S.done); store.set('stars', S.stars); store.set('coins', S.coins);
  store.set('inv', S.inv); store.set('daily', S.daily); store.set('settings', S.set);
};
const PRICE = { hint: 40, shuffle: 60, undo: 30, clear: 50 };

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffleArr(a, rng = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pad2 = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
const MONTHS_SHORT = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];

// ---------- Audio engine (all synthesized) ----------
const Snd = {
  ctx: null, out: null, rev: null, musicBus: null, musicTimer: null, noiseBuf: null, step: 0,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.out = c.createGain(); this.out.gain.value = 0.9; this.out.connect(c.destination);
    // small reverb for a soft, roomy feel
    const len = c.sampleRate * 2.2, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.rev = c.createConvolver(); this.rev.buffer = ir;
    const rg = c.createGain(); rg.gain.value = 0.35; this.rev.connect(rg); rg.connect(this.out);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.0; this.musicBus.connect(this.out); this.musicBus.connect(this.rev);
    const n = c.sampleRate; this.noiseBuf = c.createBuffer(1, n, n);
    const nd = this.noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) nd[i] = Math.random() * 2 - 1;
  },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); },
  tone(f, dur, { type = 'sine', vol = 0.2, delay = 0, slide = null, wet = 0.2, attack = 0.005, dest = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    this.env(g, t, attack, vol, dur); o.connect(g);
    g.connect(dest || this.out);
    if (wet && !dest) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.rev); }
    o.start(t); o.stop(t + attack + dur + 0.05);
  },
  noise(dur, { vol = 0.3, delay = 0, type = 'bandpass', freq = 3000, q = 1, attack = 0.001, wet = 0.1 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); this.env(g, t, attack, vol, dur);
    s.connect(f); f.connect(g); g.connect(this.out);
    if (wet) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.rev); }
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  },
  fx() { return S.set.sound && this.ctx; },
  // ceramic "clack" when picking a tile
  click() { if (!this.fx()) return; this.noise(0.035, { vol: 0.5, freq: 2600, q: 2.5 }); this.tone(1900, 0.05, { type: 'triangle', vol: 0.12, wet: 0.05 }); this.tone(420, 0.06, { vol: 0.15, wet: 0 }); },
  // resonant "ping" made from a noise impulse through a high-Q band-pass (sounds like a ceramic chip)
  ping(freq, delay, vol, decay) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 18 + Math.random() * 20;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(f); f.connect(g); g.connect(this.out);
    const w = c.createGain(); w.gain.value = 0.35; g.connect(w); w.connect(this.rev);
    s.start(t, Math.random() * 0.8); s.stop(t + decay + 0.05);
  },
  // realistic ceramic shatter: sharp crack, body knock, ringing, then falling shards that tinkle and bounce
  breakTiles(combo = 1) {
    if (!this.fx()) return;
    this.noise(0.012, { vol: 1.0, type: 'highpass', freq: 3500, q: 0.7, wet: 0.05 });          // transient snap
    this.noise(0.09, { vol: 0.85, freq: 2300, q: 0.9, delay: 0.004, wet: 0.2 });               // crack
    this.noise(0.25, { vol: 0.35, type: 'highpass', freq: 6000, q: 0.5, delay: 0.01, wet: 0.3 }); // crunch / grit
    this.tone(150, 0.09, { vol: 0.35, slide: 70, wet: 0 });                                     // knock
    this.tone(1760 + Math.random() * 200, 0.22, { vol: 0.07, wet: 0.4 });                       // ceramic ring (inharmonic)
    this.tone(2930 + Math.random() * 200, 0.16, { vol: 0.05, wet: 0.4 });
    // shards: dense at first, then sparse bounces
    let t = 0.02;
    for (let i = 0; i < 22; i++) {
      t += 0.004 + Math.pow(i / 22, 2) * 0.05 + Math.random() * 0.012;
      this.ping(2600 + Math.random() * 6500, t, 0.25 * (1 - i / 30) + Math.random() * 0.12, 0.03 + Math.random() * 0.09);
    }
    // a couple of bigger pieces landing
    this.noise(0.05, { vol: 0.3, freq: 1500, q: 2, delay: 0.32 + Math.random() * 0.05 });
    this.ping(3200 + Math.random() * 1500, 0.34, 0.2, 0.12);
    this.noise(0.04, { vol: 0.18, freq: 1800, q: 2, delay: 0.47 + Math.random() * 0.06 });
    // sweet reward chime, rising with combo
    const base = 880 * Math.pow(2, Math.min(combo - 1, 10) * 2 / 12);
    this.tone(base, 0.6, { vol: 0.07, delay: 0.06, wet: 0.7 });
    this.tone(base * 1.5, 0.7, { vol: 0.05, delay: 0.12, wet: 0.7 });
  },
  // a tile landing in the tray
  land() { if (!this.fx()) return; this.noise(0.03, { vol: 0.45, freq: 1900, q: 2.2 }); this.tone(300, 0.07, { vol: 0.18, wet: 0, slide: 220 }); },
  // tray full -> level lost
  fail() { if (!this.fx()) return; [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.14, delay: i * 0.16, wet: 0.4 })); this.noise(0.3, { vol: 0.25, freq: 400, q: 0.7 }); },
  warn() { if (!this.fx()) return; this.tone(660, 0.12, { type: 'triangle', vol: 0.08 }); this.tone(660, 0.12, { type: 'triangle', vol: 0.08, delay: 0.15 }); },
  // both tiles of a pair: a double ceramic clack + bright two-note chime
  pair(combo = 1) {
    if (!this.fx()) return;
    this.noise(0.035, { vol: 0.55, freq: 2600, q: 2.5 }); this.tone(420, 0.06, { vol: 0.15, wet: 0 });
    this.noise(0.035, { vol: 0.55, freq: 3000, q: 2.5, delay: 0.07 }); this.tone(480, 0.06, { vol: 0.15, wet: 0, delay: 0.07 });
    const k = Math.pow(2, Math.min(combo - 1, 8) / 12);
    this.tone(1319 * k, 0.35, { vol: 0.13, delay: 0.02, wet: 0.5 });
    this.tone(1976 * k, 0.45, { vol: 0.11, delay: 0.11, wet: 0.55 });
  },
  block() { if (!this.fx()) return; this.tone(190, 0.12, { type: 'square', vol: 0.06, wet: 0 }); this.noise(0.04, { vol: 0.3, freq: 900 }); },
  hint() { if (!this.fx()) return; [784, 1047, 1319].forEach((f, i) => this.tone(f, 0.35, { vol: 0.1, delay: i * 0.08, wet: 0.6 })); },
  shuffle() { if (!this.fx()) return; this.noise(0.5, { vol: 0.35, freq: 1200, q: 0.6, type: 'bandpass', attack: 0.15, wet: 0.3 }); for (let i = 0; i < 10; i++) this.noise(0.03, { vol: 0.3, freq: 2500, q: 2, delay: 0.25 + i * 0.04 }); },
  undo() { if (!this.fx()) return; this.tone(600, 0.15, { vol: 0.12, slide: 900, wet: 0.3 }); },
  coin() { if (!this.fx()) return; this.tone(1568, 0.08, { type: 'square', vol: 0.04 }); this.tone(2093, 0.25, { type: 'square', vol: 0.04, delay: 0.07, wet: 0.4 }); },
  star(i) { if (!this.fx()) return; this.tone(880 * Math.pow(2, i * 4 / 12), 0.5, { vol: 0.14, wet: 0.6 }); this.tone(1760 * Math.pow(2, i * 4 / 12), 0.4, { vol: 0.05, wet: 0.6 }); },
  win() { if (!this.fx()) return; [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { this.tone(f, 0.6, { vol: 0.13, delay: i * 0.09, wet: 0.6 }); this.tone(f / 2, 0.6, { type: 'triangle', vol: 0.06, delay: i * 0.09 }); }); },
  // gentle generative pentatonic music
  startMusic() {
    this.init(); if (!this.ctx || this.musicTimer) return;
    const g = this.musicBus.gain; g.cancelScheduledValues(this.ctx.currentTime); g.setTargetAtTime(S.set.music ? 0.55 : 0, this.ctx.currentTime, 0.8);
    const scale = [0, 2, 4, 7, 9];
    const chords = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]];
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running' || !S.set.music) return;
      const s = this.step++;
      if (s % 16 === 0) {
        const ch = chords[(s / 16) % chords.length];
        ch.forEach(m => this.tone(mtof(m), 4.2, { vol: 0.05, attack: 1.2, dest: this.musicBus }));
      }
      if (Math.random() < 0.55) {
        const m = 72 + scale[Math.floor(Math.random() * 5)] + (Math.random() < 0.3 ? 12 : 0);
        this.tone(mtof(m), 1.4, { vol: 0.07, attack: 0.01, dest: this.musicBus });
        this.tone(mtof(m) * 2, 0.6, { vol: 0.015, attack: 0.01, dest: this.musicBus });
      }
    }, 300);
  },
  setMusic(on) { if (!this.ctx) return; this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.5); if (on) this.startMusic(); },
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
// Half-tile units: a tile at (x,y) covers x..x+2, y..y+2. z = layer.
function candidateLayout(rng, target) {
  const R = (a, b) => a + Math.floor(rng() * (b - a + 1));
  let cols, rows, maxZ, fill;
  if (target <= 24)      { cols = R(3, 5); rows = R(3, 5); maxZ = R(2, 2); fill = 0.6 + rng() * 0.4; }
  else if (target <= 50) { cols = R(4, 6); rows = R(4, 7); maxZ = R(2, 3); fill = 0.6 + rng() * 0.4; }
  else if (target <= 80) { cols = R(5, 7); rows = R(5, 8); maxZ = R(3, 4); fill = 0.6 + rng() * 0.4; }
  else                   { cols = R(6, 7); rows = R(6, 8); maxZ = R(3, 5); fill = 0.7 + rng() * 0.3; }
  const styles = ['stack', 'pyramid', 'brick', 'tower', 'mixed'];
  const style = styles[Math.floor(rng() * styles.length)];
  const stagger = rng() < 0.2;
  const W = 2 * (cols - 1);
  const mirrorX = x => W - x;
  const tiles = [];
  const layer = [];
  const overlaps = (x, y, z) => (layer[z] || []).some(t => Math.abs(t.x - x) < 2 && Math.abs(t.y - y) < 2);
  const add = (x, y, z) => { if (overlaps(x, y, z)) return false; (layer[z] = layer[z] || []).push({ x, y, z }); tiles.push({ x, y, z }); return true; };
  for (let r = 0; r < rows; r++) {
    const off = (stagger && r % 2) ? 1 : 0;
    const nc = off ? cols - 1 : cols;
    for (let c = 0; c < Math.ceil(nc / 2); c++) {
      if (rng() < fill || r === Math.floor(rows / 2)) {
        const x = c * 2 + off;
        add(x, r * 2, 0); if (mirrorX(x) !== x) add(mirrorX(x), r * 2, 0);
      }
    }
  }
  for (let z = 1; z < maxZ; z++) {
    const prev = layer[z - 1] || [];
    const at = (x, y) => prev.some(t => t.x === x && t.y === y);
    const st = style === 'mixed' ? ['stack', 'pyramid', 'brick'][Math.floor(rng() * 3)] : style;
    let cands = [];
    for (const t of prev) {
      if (st === 'stack') { if ((at(t.x - 2, t.y) && at(t.x + 2, t.y)) || (at(t.x, t.y - 2) && at(t.x, t.y + 2))) cands.push([t.x, t.y]); }
      else if (st === 'tower') { cands.push([t.x, t.y]); }
      else if (st === 'pyramid') { if (at(t.x + 2, t.y) && at(t.x, t.y + 2) && at(t.x + 2, t.y + 2)) cands.push([t.x + 1, t.y + 1]); }
      else if (st === 'brick') { if (at(t.x + 2, t.y)) cands.push([t.x + 1, t.y]); }
    }
    if (!cands.length) break;
    // keep upper layers compact towards the centre
    const cy = (rows - 1);
    cands.sort((a, b) => (Math.abs(a[0] - W / 2) + Math.abs(a[1] - cy)) - (Math.abs(b[0] - W / 2) + Math.abs(b[1] - cy)));
    const p = st === 'tower' ? 0.45 : st === 'stack' ? 0.8 : 0.85;
    for (const [x, y] of cands) {
      const mx = mirrorX(x);
      if (x > mx) continue;
      if (rng() < p) { add(x, y, z); if (mx !== x) add(mx, y, z); }
    }
  }
  return tiles;
}
function makeLayout(seed, target) {
  const rng = mulberry32(seed * 7919 + 13);
  let best = null, bestD = 1e9;
  for (let i = 0; i < 220; i++) {
    const L = candidateLayout(rng, target);
    if (L.length < 8) continue;
    const layers = Math.max(...L.map(t => t.z)) + 1;
    const n = L.length - (L.length % 2);
    const d = Math.abs(n - target) - (layers >= 2 ? 3 : 0);   // prefer stacked boards
    if (d < bestD) { best = L; bestD = d; if (d <= -2) break; }
  }
  if (best.length % 2) {
    const cx = best.reduce((s, t) => s + t.x, 0) / best.length;
    best.sort((a, b) => b.z - a.z || Math.abs(a.x - cx) - Math.abs(b.x - cx));
    best.shift();
  }
  const minX = Math.min(...best.map(t => t.x)), minY = Math.min(...best.map(t => t.y));
  return best.map(t => ({ x: t.x - minX, y: t.y - minY, z: t.z }));
}
const levelTarget = lv => Math.min(116, 16 + Math.round(lv * 1.5) + (lv % 7 === 0 ? 8 : 0));

// ---------- Hand-drawn shaped boards ----------
const SHAPES = [
  ['Zemra',      ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...']],
  ['Flutura',    ['XX...XX', 'XXX.XXX', '.XXXXX.', '..XXX..', '.XXXXX.', 'XXX.XXX', 'XX...XX']],
  ['Diamanti',   ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...']],
  ['Kryqi',      ['..XXX..', '..XXX..', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '..XXX..', '..XXX..']],
  ['Lulja',      ['..XXX..', '.XXXXX.', 'XX.X.XX', 'XXXXXXX', 'XX.X.XX', '.XXXXX.', '..XXX..']],
  ['Breshka',    ['...X...', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '.X...X.']],
  ['Shtëpia',    ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XX.XX.', '.XX.XX.', '.XXXXX.']],
  ['Ora e rërës',['XXXXXXX', '.XXXXX.', '..XXX..', '...X...', '..XXX..', '.XXXXX.', 'XXXXXXX']],
  ['Unaza',      ['.XXXXX.', 'XX...XX', 'X.....X', 'X.....X', 'X.....X', 'XX...XX', '.XXXXX.']],
  ['Kurora',     ['X..X..X', 'XX.X.XX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '.XXXXX.']],
  ['Ylli',       ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', 'XX...XX']],
  ['Pema',       ['...X...', '..XXX..', '.XXXXX.', '..XXX..', '.XXXXX.', 'XXXXXXX', '...X...', '...X...']],
  ['Macja',      ['X.....X', 'XX...XX', 'XXXXXXX', 'XX.X.XX', 'XXXXXXX', '.XXXXX.', '..XXX..']],
  ['Shigjeta',   ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '..XXX..', '..XXX..', '..XXX..']],
  ['Iksi',       ['XX...XX', '.XX.XX.', '..XXX..', '..XXX..', '.XX.XX.', 'XX...XX']],
  ['Kalaja',     ['X.X.X.X', 'XXXXXXX', '.XXXXX.', '.XXXXX.', '.XX.XX.', 'XXXXXXX']],
  ['Hëna',       ['..XXX..', '.XX....', 'XX.....', 'XX.....', 'XX.....', '.XX....', '..XXX..']],
  ['Ura',        ['XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX']],
  ['Kupa',       ['XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...', '..XXX..']],
  ['Spiralja',   ['XXXXXXX', '......X', 'XXXXX.X', 'X...X.X', 'X.XXX.X', 'X.....X', 'XXXXXXX']],
];
const SHAPES_SMALL = [
  ['Zemra e vogël', ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..']],
  ['Diamanti i vogël', ['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..']],
  ['Kryqi i vogël', ['.XX.', 'XXXX', 'XXXX', '.XX.']],
  ['Shkallët', ['X...', 'XX..', 'XXX.', 'XXXX']],
  ['Dritarja', ['XXXX', 'X..X', 'X..X', 'XXXX']],
];
function shapeLayout(rows, rng, target) {
  const base = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') base.push({ x: c * 2, y: r * 2, z: 0 }); }));
  const W = Math.max(...base.map(t => t.x));
  let best = null, bestD = 1e9;
  for (const style of ['pyramid', 'stack', 'brick', 'tower']) for (let maxZ = 1; maxZ <= (style === 'tower' ? 3 : 5); maxZ++) for (let v = 0; v < 3; v++) {
    const tiles = base.map(t => ({ ...t })), layer = [tiles.slice()];
    const overlaps = (x, y, z) => (layer[z] || []).some(t => Math.abs(t.x - x) < 2 && Math.abs(t.y - y) < 2);
    for (let z = 1; z < maxZ; z++) {
      const prev = layer[z - 1] || [], at = (x, y) => prev.some(t => t.x === x && t.y === y);
      const cands = [];
      for (const t of prev) {
        if (style === 'stack' && at(t.x - 2, t.y) && at(t.x + 2, t.y)) cands.push([t.x, t.y]);
        else if (style === 'pyramid' && at(t.x + 2, t.y) && at(t.x, t.y + 2) && at(t.x + 2, t.y + 2)) cands.push([t.x + 1, t.y + 1]);
        else if (style === 'brick' && at(t.x + 2, t.y)) cands.push([t.x + 1, t.y]);
        else if (style === 'tower' && (z === 1 ? (t.x / 2 + t.y / 2) % 2 === 0 : true)) cands.push([t.x, t.y]);
      }
      for (const [x, y] of cands) {
        const mx = W - x; if (x > mx) continue;
        if (v > 0 && rng() < 0.25 * v) continue;
        for (const xx of mx !== x ? [x, mx] : [x]) if (!overlaps(xx, y, z)) { const nt = { x: xx, y, z }; (layer[z] = layer[z] || []).push(nt); tiles.push(nt); }
      }
    }
    const n = tiles.length - (tiles.length % 2);
    const d = Math.abs(n - target) + (maxZ === 1 ? 4 : 0);
    if (d < bestD) { best = tiles; bestD = d; }
  }
  if (best.length % 2) {
    const cx = W / 2;
    best.sort((a, b) => b.z - a.z || Math.abs(a.x - cx) - Math.abs(b.x - cx));
    best.shift();
  }
  return best;
}
// Which board does a level use?  Every 3rd level is a named shape.
function levelLayout(lv) {
  const target = levelTarget(lv);
  if (lv % 3 === 0) {
    const rng = mulberry32(lv * 31 + 5);
    const list = target < 30 ? SHAPES_SMALL : SHAPES;
    const [name, rows] = list[Math.floor(lv / 3) % list.length];
    return { name, layout: shapeLayout(rows, rng, target) };
  }
  return { name: '', layout: makeLayout(lv, target) };
}
const CHAPTERS = ['Kopshti i Qetë', 'Liqeni i Jadeit', 'Pylli i Bambusë', 'Mali me Mjegull', 'Tempulli i Artë', 'Lumi i Hënës', 'Pallati i Dragoit', 'Qyteti i Fenerëve', 'Ishulli i Luleve', 'Maja e Reve'];
const CHAPTER_LEN = 20, MAX_LEVEL = 2000;
const chapterOf = lv => Math.floor((lv - 1) / CHAPTER_LEN);
const chapterName = c => CHAPTERS[c % CHAPTERS.length] + (c >= CHAPTERS.length ? ' ' + (Math.floor(c / CHAPTERS.length) + 1) : '');

// ---------- Rules ----------
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
// Solvable deal: repeatedly remove a random pair of free positions and give them the same kind.
function solvableAssign(positions, pairs, rng = Math.random) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const pool = positions.map(p => ({ x: p.x, y: p.y, z: p.z, removed: false, ref: p }));
    const order = shuffleArr(pairs.slice(), rng);
    let ok = true;
    for (let i = 0; i < order.length; i++) {
      const live = pool.filter(p => !p.removed);
      const free = live.filter(p => isFree(p, live));
      if (free.length < 2) { ok = false; break; }
      free.sort((a, b) => (b.z - a.z) + (rng() - 0.5) * 1.5);
      const a = free[0], rest = free.slice(1);
      const b = rest[Math.floor(rng() * rest.length)];
      a.removed = b.removed = true;
      a.ref._k = order[i][0]; b.ref._k = order[i][1];
    }
    if (ok) return true;
  }
  return false;
}
function buildPairs(nPairs, variety, rng) {
  const kinds = shuffleArr(NORMAL_KINDS.slice(), rng);
  const flowerPairs = [['f1', 'f2'], ['f3', 'f4']], seasonPairs = [['s1', 's2'], ['s3', 's4']];
  let pairs = [];
  if (variety === 'low') {
    for (const k of kinds.concat(['F', 'S'])) {
      if (pairs.length >= nPairs) break;
      const two = k === 'F' ? flowerPairs : k === 'S' ? seasonPairs : [[k, k], [k, k]];
      pairs.push(two[0]); if (pairs.length < nPairs) pairs.push(two[1]);
    }
  } else {
    let all = [];
    for (const k of kinds) all.push([k, k], [k, k]);
    all.push(...flowerPairs, ...seasonPairs);
    pairs = shuffleArr(all, rng).slice(0, nPairs);
  }
  return pairs;
}

// ---------- Deal generation for the tray game ----------
// Removal order = a valid solution. "singles" are tiles whose partner already sits in the tray.
// Some pairs are taken one after another (the second may be the tile that was underneath),
// which creates stacked identical pairs that are solvable thanks to the tray.
function solvableAssignTray(positions, pairs, singles = [], rng = Math.random) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const pool = positions.map(p => ({ x: p.x, y: p.y, z: p.z, removed: false, ref: p }));
    const order = shuffleArr(pairs.slice(), rng);
    const live = () => pool.filter(p => !p.removed);
    const freeList = () => { const l = live(); return l.filter(p => isFree(p, l)); };
    const pickTop = free => { free.sort((a, b) => (b.z - a.z) + (rng() - 0.5) * 1.5); return free[0]; };
    let ok = true;
    for (const k of singles) {
      const free = freeList(); if (!free.length) { ok = false; break; }
      const a = pickTop(free); a.removed = true; a.ref._k = k;
    }
    for (let i = 0; ok && i < order.length; i++) {
      let free = freeList();
      if (!free.length) { ok = false; break; }
      const a = pickTop(free);
      let b;
      if (rng() < 0.3) {
        // sequential: take a first, then a tile that just became free (often the one below)
        a.removed = true;
        const before = new Set(free);
        const free2 = freeList();
        if (!free2.length) { ok = false; break; }
        const fresh = free2.filter(p => !before.has(p));
        b = fresh.length ? fresh[Math.floor(rng() * fresh.length)] : free2[Math.floor(rng() * free2.length)];
      } else {
        const rest = free.filter(p => p !== a);
        if (!rest.length) { ok = false; break; }
        b = rest[Math.floor(rng() * rest.length)];
        a.removed = true;
      }
      b.removed = true;
      a.ref._k = order[i][0]; b.ref._k = order[i][1];
    }
    if (ok) return true;
  }
  return false;
}

// ---------- Game state ----------
// tile.state: 0 = on board, 1 = in tray, 2 = broken
const TRAY_MAX = 4;
let G = null, timerInt = null, hintHand = null;
function newGame(mode, id) {
  let seed, target, variety;
  if (mode === 'level') { seed = id; target = levelTarget(id); variety = id < 25 ? 'low' : (id < 60 ? (id % 2 ? 'low' : 'high') : 'high'); }
  else { const [y, m, d] = id.split('-').map(Number); seed = y * 10000 + m * 100 + d + 777; target = 72 + (d % 4) * 8; variety = 'high'; }
  let tiles, ok = false, name = '';
  for (let tries = 0; tries < 6 && !ok; tries++) {
    let layout;
    if (mode === 'level' && tries < 3) { const L = levelLayout(id); layout = L.layout; name = L.name; }
    else { layout = makeLayout(seed + tries * 1000, target); name = ''; }
    tiles = layout.map((p, i) => ({ id: i, x: p.x, y: p.y, z: p.z, k: null, state: 0 }));
    ok = solvableAssignTray(tiles, buildPairs(tiles.length / 2, variety, Math.random));
  }
  tiles.forEach(t => { t.k = t._k; delete t._k; });
  assignGifts(tiles, mode === 'level' ? id : 5);
  G = { mode, id, tiles, name, tray: [], history: [], time: 0, used: 0, won: false, over: false, combo: 0, lastMatch: 0, total: tiles.length, obj: mode === 'level' ? goalForLevel(id, tiles.length) : null, fresh: true };
  saveGame();
  startGameScreen(true);
}
function saveGame() {
  if (!G || G.won) { store.del('game2'); return; }
  store.set('game2', { mode: G.mode, id: G.id, name: G.name || '', time: G.time, used: G.used, tray: G.tray, history: G.history, obj: G.obj || null, tiles: G.tiles.map(t => [t.x, t.y, t.z, t.k, t.state, t.b || 0]) });
}
function loadGame(mode, id) {
  const g = store.get('game2', null);
  if (!g || g.mode !== mode || g.id !== id) return false;
  G = { mode, id, name: g.name || '', time: g.time || 0, used: g.used || 0, tray: g.tray || [], history: g.history || [], won: false, over: false, combo: 0, lastMatch: 0,
    obj: g.obj || null, tiles: g.tiles.map((a, i) => ({ id: i, x: a[0], y: a[1], z: a[2], k: a[3], state: a[4], b: a[5] || null })) };
  G.total = G.tiles.length;
  if (G.tray.length >= TRAY_MAX) G.over = true;
  return G.tiles.some(t => t.state !== 2);
}
function playLevel(n) { if (loadGame('level', n)) startGameScreen(true); else newGame('level', n); }
function playDaily(key) { if (loadGame('daily', key)) startGameScreen(true); else newGame('daily', key); }
const boardTiles = () => G.tiles.filter(t => t.state === 0);
const liveTiles = boardTiles;

// ---------- Rendering: board ----------
const boardEl = $('board'), wrapEl = $('boardWrap'), trayEl = $('tray');
let geo = null, tgeo = null;
const trayEls = new Map();   // tile id -> element in the tray
function layoutTray() {
  const W = Math.min(innerWidth - 28, 520);
  const gap = Math.max(8, W * 0.025);
  const sw = Math.min(84, (W - 24 - gap * 3) / 4);
  const sh = sw * 1.3;
  trayEl.style.setProperty('--sw', sw + 'px'); trayEl.style.setProperty('--sh', sh + 'px'); trayEl.style.setProperty('--gap', gap + 'px');
  const tw = sw * 0.96, e = tw * 0.11;
  tgeo = { sw, sh, gap, tw, th: tw * 1.3, e, pad: 12 };
  trayEl.style.setProperty('--e', e + 'px'); trayEl.style.setProperty('--tw', tw + 'px');
}
const slotLeft = i => tgeo.pad + i * (tgeo.sw + tgeo.gap) + (tgeo.sw - tgeo.tw) / 2;
function layoutBoard() {
  if (!G) return;
  const all = G.tiles;
  const maxX = Math.max(...all.map(t => t.x)) + 2, maxY = Math.max(...all.map(t => t.y)) + 2;
  const maxZ = Math.max(...all.map(t => t.z));
  const W = wrapEl.clientWidth, H = wrapEl.clientHeight;
  const ASPECT = 1.3, EDGE = 0.11;
  const tw = Math.min(W / (maxX / 2 + EDGE * maxZ + 0.05), H / ((maxY / 2) * ASPECT + EDGE * maxZ + 0.05), 120);
  const th = tw * ASPECT, e = tw * EDGE;
  geo = { tw, th, hw: tw / 2, hh: th / 2, e, maxZ };
  const bw = maxX * geo.hw + maxZ * e, bh = maxY * geo.hh + maxZ * e;
  boardEl.style.width = bw + 'px'; boardEl.style.height = bh + 'px';
  boardEl.style.marginLeft = (-bw / 2) + 'px'; boardEl.style.marginTop = (-bh / 2) + 'px';
  boardEl.style.setProperty('--e', e.toFixed(2) + 'px');
  boardEl.style.setProperty('--tw', tw.toFixed(2) + 'px');
  for (const t of G.tiles) if (t.el) placeTile(t);
}
function placeTile(t) {
  const el = t.el;
  el.style.left = (t.x * geo.hw + (geo.maxZ - t.z) * geo.e) + 'px';
  el.style.top = (t.y * geo.hh + (geo.maxZ - t.z) * geo.e) + 'px';
  el.style.width = geo.tw + 'px'; el.style.height = geo.th + 'px';
  el.style.zIndex = t.z * 10000 + t.y * 100 + t.x;
}
function tileHTML(k) { return '<div class="side"></div><div class="face">' + faceSVG(k) + '</div>'; }
function makeTileEl(t) {
  const el = document.createElement('div');
  el.className = 'tile'; el.innerHTML = tileHTML(t.k) + giftHTML(t.b); el.dataset.id = t.id;
  t.el = el; placeTile(t); boardEl.appendChild(el);
  return el;
}
function makeTrayEl(t, i) {
  const el = document.createElement('div');
  el.className = 'tile'; el.innerHTML = tileHTML(t.k) + giftHTML(t.b); el.dataset.id = t.id;
  el.style.width = tgeo.tw + 'px'; el.style.height = tgeo.th + 'px';
  el.style.left = slotLeft(i) + 'px'; el.style.top = (tgeo.pad - 2) + 'px';
  el.style.zIndex = 10 + i;
  trayEl.appendChild(el); trayEls.set(t.id, el);
  return el;
}
function relayoutTray() {
  G.tray.forEach((id, i) => { const el = trayEls.get(id); if (el) { el.style.left = slotLeft(i) + 'px'; el.style.zIndex = 10 + i; } });
  trayEl.classList.toggle('warn', G.tray.length === TRAY_MAX - 1 && !G.over);
}
function renderBoard(intro) {
  boardEl.innerHTML = '';
  trayEl.querySelectorAll('.tile').forEach(e => e.remove()); trayEls.clear();
  trayEl.classList.remove('full', 'warn');
  removeHand();
  layoutTray();
  layoutBoard();
  const maxY = Math.max(...G.tiles.map(t => t.y)) || 1;
  for (const t of G.tiles) {
    t.el = null;
    if (t.state !== 0) continue;
    const el = makeTileEl(t);
    if (intro) { el.classList.add('drop'); el.style.animationDelay = (t.z * 0.16 + (t.y / maxY) * 0.3 + Math.random() * 0.12).toFixed(2) + 's'; }
  }
  G.tray.forEach((id, i) => makeTrayEl(G.tiles[id], i));
  relayoutTray();
  refreshFree();
  updateInfo();
  if (G.over) setTimeout(trayFull, 600);
}
function refreshFree() {
  const live = boardTiles();
  for (const t of live) {
    t.free = isFree(t, live);
    if (!t.el) continue;
    t.el.classList.toggle('blocked', !t.free);
    t.el.classList.toggle('dim', S.set.dim);
  }
}
function updateInfo() {
  const gone = G.tiles.filter(t => t.state === 2).length;
  $('progFill').style.width = (100 * gone / G.total) + '%';
  $('progText').textContent = `${gone}/${G.total}`;
  updateTools();
}
function updateTools() {
  for (const k of ['hint', 'shuffle', 'undo', 'clear']) {
    const b = $(k + 'Count'); if (!b) continue;
    if (S.inv[k] > 0) { b.textContent = S.inv[k]; b.classList.remove('buy'); }
    else { b.textContent = '🪙' + PRICE[k]; b.classList.add('buy'); }
  }
  document.querySelectorAll('.coinsVal').forEach(e => e.textContent = S.coins);
}
function bumpCoins() { document.querySelectorAll('.coins-pill').forEach(p => { p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }); }

// FLIP: animate an element from a source rectangle to where it now is
function flyFrom(el, from, dur = 180, arc = 0.2) {
  const to = el.getBoundingClientRect();
  const dx = from.left - to.left, dy = from.top - to.top, s = from.width / to.width;
  el.style.transformOrigin = '0 0';
  const midY = Math.min(dy, 0) * 0.5 - to.height * arc;
  return el.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.5 + midY}px) scale(${(s + 1.15) / 2}) rotate(${dx > 0 ? -6 : 6}deg)`, offset: 0.55 },
    { transform: 'translate(0,0) scale(1)' }
  ], { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)' });
}

// ---------- Tile images for the shatter effect ----------
const ALL_KINDS = NORMAL_KINDS.concat(['f1', 'f2', 'f3', 'f4', 's1', 's2', 's3', 's4']);
let tileImgs = {};
function cssVar(n) { return getComputedStyle(document.body).getPropertyValue(n).trim() || '#2e8b62'; }
function buildTileImages() {
  tileImgs = {};
  const side1 = cssVar('--side1'), side2 = cssVar('--side2');
  const W = 120, H = 156, e = 13, r = 17, fw = W - e, fh = H - e;
  for (const k of ALL_KINDS) {
    const inner = faceSVG(k).replace('<svg ', `<svg x="${fw * 0.06}" y="${fh * 0.05}" width="${fw * 0.88}" height="${fh * 0.9}" `);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>` +
      `<linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${side1}"/><stop offset="1" stop-color="${side2}"/></linearGradient>` +
      `<linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#fdfaf2"/><stop offset="1" stop-color="#f1e9d5"/></linearGradient></defs>` +
      `<rect x="${e}" y="${e}" width="${fw}" height="${fh}" rx="${r}" fill="url(#s)"/><rect x="${e * .45}" y="${e * .45}" width="${fw}" height="${fh}" rx="${r}" fill="#e9dcb8"/>` +
      `<rect x="0" y="0" width="${fw}" height="${fh}" rx="${r}" fill="url(#f)" stroke="rgba(160,140,90,.3)"/>${inner}</svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    tileImgs[k] = img;
  }
}

// ---------- Particles: real shattering of the tile picture ----------
const fx = $('fx'), fctx = fx.getContext('2d');
let parts = [], fxRunning = false, fxLast = 0;
function sizeFx() { const d = Math.min(window.devicePixelRatio || 1, 2); fx.width = innerWidth * d; fx.height = innerHeight * d; fctx.setTransform(d, 0, 0, d, 0, 0); }
sizeFx(); window.addEventListener('resize', sizeFx);

function shatterTile(rect, k, dir) {
  const w = rect.width, h = rect.height;
  const px = w * (0.5 + dir * 0.28), py = h * (0.42 + Math.random() * 0.16);   // impact on the colliding side
  const n = 8 + Math.floor(Math.random() * 4);
  const angs = []; for (let i = 0; i < n; i++) angs.push(i * 2 * Math.PI / n + (Math.random() - 0.5) * (2 * Math.PI / n) * 0.7);
  angs.sort((a, b) => a - b);
  const edgePt = a => { const dx = Math.cos(a), dy = Math.sin(a); let t = 1e9; if (dx > 1e-6) t = Math.min(t, (w - px) / dx); if (dx < -1e-6) t = Math.min(t, -px / dx); if (dy > 1e-6) t = Math.min(t, (h - py) / dy); if (dy < -1e-6) t = Math.min(t, -py / dy); return [px + dx * t, py + dy * t]; };
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(c => ({ c, a: Math.atan2(c[1] - py, c[0] - px) }));
  const R = Math.min(w, h) * (0.22 + Math.random() * 0.1);
  const inner = angs.map(a => { const ep = edgePt(a), d = Math.hypot(ep[0] - px, ep[1] - py); const rr = Math.min(R * (0.7 + Math.random() * 0.6), d * 0.75); return [px + Math.cos(a) * rr, py + Math.sin(a) * rr]; });
  const polys = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a0 = angs[i]; let a1 = angs[j]; if (j === 0) a1 += Math.PI * 2;
    polys.push({ pts: [[px, py], inner[i], inner[j]], outer: false });
    const cs = corners.map(c => { let ca = c.a; while (ca < a0) ca += Math.PI * 2; return { c: c.c, ca }; }).filter(c => c.ca < a1).sort((p, q) => p.ca - q.ca).map(c => c.c);
    polys.push({ pts: [inner[i], edgePt(a0), ...cs, edgePt(a1), inner[j]], outer: true });
  }
  const img = tileImgs[k];
  const now = 0;
  for (const p of polys) {
    const cx = p.pts.reduce((s, q) => s + q[0], 0) / p.pts.length, cy = p.pts.reduce((s, q) => s + q[1], 0) / p.pts.length;
    let nx = cx - px, ny = cy - py; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const sp = (p.outer ? 260 : 120) + Math.random() * 300;
    parts.push({ kind: 'frag', img, w, h, ox: cx, oy: cy, pts: p.pts.map(q => [q[0] - cx, q[1] - cy]),
      x: rect.left + cx, y: rect.top + cy, vx: nx * sp - dir * 40, vy: ny * sp - 260 - Math.random() * 160, g: 1900,
      r: 0, vr: (Math.random() - 0.5) * 14, flip: Math.random() * 10 + 4, t: now, delay: 0.07, life: 0.9 + Math.random() * 0.5, crack: true });
  }
  // small chips + dust
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6, sp = 250 + Math.random() * 450;
    parts.push({ kind: 'chip', x: rect.left + px, y: rect.top + py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 2000, s: 1.5 + Math.random() * 3, t: 0, delay: 0.07, life: 0.6 + Math.random() * 0.4, c: Math.random() < .7 ? '#fffaf0' : cssVar('--side1') });
  }
  for (let i = 0; i < 7; i++) {
    parts.push({ kind: 'dust', x: rect.left + px + (Math.random() - .5) * w * .4, y: rect.top + py + (Math.random() - .5) * h * .3, vx: (Math.random() - .5) * 80, vy: -20 - Math.random() * 50, g: 0, s: w * (0.25 + Math.random() * 0.25), t: 0, delay: 0.06, life: 0.7 + Math.random() * 0.4 });
  }
}
function impactFlash(x, y, size) {
  parts.push({ kind: 'flash', x, y, s: size, t: 0, delay: 0.05, life: 0.25 });
  parts.push({ kind: 'ring', x, y, s: size * 1.3, t: 0, delay: 0.05, life: 0.35 });
  for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 220; parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, s: 3 + Math.random() * 5, t: 0, delay: 0.06, life: 0.45 + Math.random() * 0.4, c: Math.random() < .5 ? '#fff7b0' : '#ffffff' }); }
  startFx();
}
function confettiFx() {
  const cols = ['#ffd23f', '#ff6b6b', '#4ecdc4', '#a78bfa', '#ffffff', '#5ec26a', '#ff9f43'];
  for (let i = 0; i < 140; i++) parts.push({ kind: 'conf', x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.6, vx: (Math.random() - .5) * 120, vy: 120 + Math.random() * 220, g: 60, r: Math.random() * 6, vr: (Math.random() - .5) * 10, s: 6 + Math.random() * 7, t: 0, delay: 0, life: 4 + Math.random() * 2, c: cols[i % cols.length], w: Math.random() * 6 });
  startFx();
}
function startFx() { if (fxRunning) return; fxRunning = true; fxLast = performance.now(); requestAnimationFrame(fxLoop); }
function fxLoop(now) {
  const dt = Math.min(0.04, (now - fxLast) / 1000); fxLast = now;
  const c = fctx;
  c.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => (p.t += dt) < p.life + (p.delay || 0));
  for (const p of parts) {
    const pt = p.t - (p.delay || 0), moving = pt > 0, k = Math.max(0, pt) / p.life;
    if (moving && p.vx !== undefined) { p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.vr) p.r += p.vr * dt; }
    c.save();
    if (p.kind === 'frag') {
      c.globalAlpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      c.translate(p.x, p.y); c.rotate(p.r);
      const sx = moving ? Math.max(0.25, Math.abs(Math.cos(pt * p.flip))) : 1;
      c.scale(sx * (1 - k * 0.15), 1 - k * 0.15);
      c.beginPath(); p.pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.closePath();
      c.save(); c.clip();
      if (p.img && p.img.complete && p.img.naturalWidth) c.drawImage(p.img, -p.ox, -p.oy, p.w, p.h);
      else { c.fillStyle = '#fbf6e9'; c.fill(); }
      if (moving && sx < 0.6) { c.fillStyle = `rgba(0,0,0,${(0.6 - sx) * 0.5})`; c.fill(); }   // darker when edge-on
      c.restore();
      c.lineWidth = moving ? 1 : 1.6; c.strokeStyle = moving ? 'rgba(255,255,255,.55)' : 'rgba(60,40,10,.75)'; c.stroke();
    } else if (p.kind === 'chip') {
      if (moving) { c.globalAlpha = 1 - k; c.fillStyle = p.c; c.fillRect(p.x, p.y, p.s, p.s); }
    } else if (p.kind === 'dust') {
      if (moving) { const r = p.s * (0.5 + k); const gr = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); gr.addColorStop(0, `rgba(255,250,235,${0.35 * (1 - k)})`); gr.addColorStop(1, 'rgba(255,250,235,0)'); c.fillStyle = gr; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill(); }
    } else if (p.kind === 'spark') {
      if (moving) { c.globalAlpha = 1 - k; c.translate(p.x, p.y); c.rotate(k * 3); c.fillStyle = p.c; const s = p.s * (1 - k * .5);
        c.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.35 : s, a = i * Math.PI / 4; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); }
    } else if (p.kind === 'ring') {
      if (moving) { c.globalAlpha = (1 - k) * 0.8; c.strokeStyle = '#fff6c8'; c.lineWidth = 5 * (1 - k) + 1; c.beginPath(); c.arc(p.x, p.y, p.s * (0.2 + k), 0, Math.PI * 2); c.stroke(); }
    } else if (p.kind === 'flash') {
      if (moving) { const gr = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s); gr.addColorStop(0, `rgba(255,255,235,${0.9 * (1 - k)})`); gr.addColorStop(1, 'rgba(255,240,180,0)'); c.fillStyle = gr; c.beginPath(); c.arc(p.x, p.y, p.s, 0, Math.PI * 2); c.fill(); }
    } else if (p.kind === 'conf') {
      c.globalAlpha = Math.min(1, (p.life - p.t) * 2); c.translate(p.x + Math.sin(p.t * 3 + p.w) * 12, p.y); c.rotate(p.r);
      c.scale(1, Math.abs(Math.cos(p.t * 5 + p.w))); c.fillStyle = p.c; c.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
    }
    c.restore();
  }
  if (parts.length) requestAnimationFrame(fxLoop); else { fxRunning = false; c.clearRect(0, 0, innerWidth, innerHeight); }
}

// ---------- Interaction ----------
function removeHand() { if (hintHand) { hintHand.remove(); hintHand = null; } }
function clearHints() { if (!G) return; G.tiles.forEach(t => t.el && t.el.classList.remove('hint')); removeHand(); $('clearBtn').classList.remove('glow'); $('undoBtn').classList.remove('glow'); }
boardEl.addEventListener('pointerdown', e => {
  const el = e.target.closest('.tile');
  if (!el || !G || G.won || G.busy) return;
  Snd.resume();
  const t = G.tiles[+el.dataset.id];
  if (!t || t.state !== 0 || !t.el) return;
  if (G.over) { trayFull(); return; }
  if (!t.free) {
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    Snd.block(); vibe(25);
    return;
  }
  moveToTray(t);
});

function moveToTray(t) {
  clearHints();
  const from = t.el.getBoundingClientRect();
  t.el.remove(); t.el = null;
  t.state = 1;
  G.tray.push(t.id);
  G.history.push(t.id);
  const el = makeTrayEl(t, G.tray.length - 1);
  flyFrom(el, from, 170);
  Snd.click(); vibe(10);
  setTimeout(() => Snd.land(), 140);
  refreshFree();
  // a pair in the tray?
  const mate = G.tray.find(id => id !== t.id && matchKey(G.tiles[id].k) === matchKey(t.k));
  if (mate !== undefined) {
    const a = G.tiles[mate], b = t;
    a.state = b.state = 2;
    G.tray = G.tray.filter(id => id !== a.id && id !== b.id);
    G.history = G.history.filter(id => id !== a.id && id !== b.id);
    const now = performance.now();
    G.combo = (now - G.lastMatch < 4000) ? G.combo + 1 : 1; G.lastMatch = now;
    { const combo = G.combo, tr = trayEl.getBoundingClientRect(); setTimeout(() => onPairBroken(a, b, combo, tr.left + tr.width / 2, tr.bottom + 10), 420); }
    const elA = trayEls.get(a.id), elB = trayEls.get(b.id);
    trayEls.delete(a.id); trayEls.delete(b.id);
    setTimeout(() => breakPair(elA, elB, G.combo), 170);
    setTimeout(relayoutTray, 300);
  } else if (G.tray.length >= TRAY_MAX) {
    G.over = true;
    setTimeout(trayFull, 220);
  } else {
    if (G.tray.length === TRAY_MAX - 1) { setTimeout(() => Snd.warn(), 300); goalFail('calm'); }
    relayoutTray();
  }
  updateInfo(); saveGame();
  if (G.tiles.every(x => x.state === 2)) setTimeout(win, 900);
}
function breakPair(elA, elB, combo) {
  if (!elA || !elB) return;
  elA.classList.add('matched', 'lift'); elB.classList.add('matched', 'lift');
  elA.style.zIndex = 50; elB.style.zIndex = 51;
  Snd.pair(combo); vibe(12);
  setTimeout(() => {
    const ra = elA.getBoundingClientRect(), rb = elB.getBoundingClientRect();
    const aLeft = ra.left <= rb.left;
    const mx = (ra.left + ra.right + rb.left + rb.right) / 4;
    const my = Math.min(ra.top, rb.top) + ra.height * 0.35;
    const D = 120;
    [[elA, ra, aLeft ? -1 : 1], [elB, rb, aLeft ? 1 : -1]].forEach(([el, r, side]) => {
      const tx = mx + side * r.width * 0.5 - (r.left + r.width / 2);
      el.animate([{ transform: 'translateY(-14%) scale(1.06)' }, { transform: `translate(${tx}px, -38%) scale(1.12) rotate(${-side * 8}deg)` }], { duration: D, easing: 'cubic-bezier(.55,0,.9,.5)', fill: 'forwards' });
    });
    setTimeout(() => {
      const ra2 = elA.getBoundingClientRect(), rb2 = elB.getBoundingClientRect();
      const ka = G.tiles[+elA.dataset.id].k, kb = G.tiles[+elB.dataset.id].k;
      const leftEl = ra2.left <= rb2.left;
      elA.remove(); elB.remove();
      shatterTile(ra2, ka, leftEl ? 1 : -1);
      shatterTile(rb2, kb, leftEl ? -1 : 1);
      impactFlash(mx, (ra2.top + ra2.bottom) / 2, ra2.width * 0.9);
      Snd.breakTiles(combo); vibe(combo > 1 ? [20, 25, 30] : 30);
      if (combo >= 2) showCombo(mx, ra2.top - 10, combo);
    }, D);
  }, 110);
}
function showCombo(x, y, n) {
  const el = document.createElement('div');
  el.className = 'combo';
  el.textContent = n >= 5 ? `Fantastike! x${n}` : n >= 3 ? `Shkëlqyer! x${n}` : `Kombo x${n}`;
  el.style.left = x + 'px'; el.style.top = Math.max(60, y) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
  if (n >= 3) { S.coins += 1; save(); updateTools(); bumpCoins(); }
}
// send a tray tile back to its place on the board
function returnToBoard(id) {
  const t = G.tiles[id];
  const tel = trayEls.get(id);
  const from = tel ? tel.getBoundingClientRect() : null;
  if (tel) tel.remove();
  trayEls.delete(id);
  G.tray = G.tray.filter(x => x !== id);
  G.history = G.history.filter(x => x !== id);
  t.state = 0;
  const el = makeTileEl(t);
  if (from) flyFrom(el, from, 200, 0.15); else el.classList.add('rise');
}
function afterRescue() {
  G.over = false; trayEl.classList.remove('full');
  closeModal(); relayoutTray(); refreshFree(); updateInfo(); saveGame();
}
function doUndo() { const id = G.history[G.history.length - 1]; if (id === undefined) return false; returnToBoard(id); markUsed(); Snd.undo(); afterRescue(); return true; }
function doClear() { if (!G.tray.length) return false; [...G.tray].reverse().forEach((id, i) => setTimeout(() => { if (G.tiles[id].state === 1) { returnToBoard(id); refreshFree(); } }, i * 90)); markUsed(); Snd.undo(); afterRescue(); setTimeout(() => { refreshFree(); saveGame(); }, G.tray.length * 90 + 50); return true; }

// spend an item (or coins) — returns true when paid
function pay(kind) {
  if (S.inv[kind] > 0) { S.inv[kind]--; save(); updateTools(); return true; }
  if (S.coins >= PRICE[kind]) { S.coins -= PRICE[kind]; save(); Snd.coin(); bumpCoins(); updateTools(); return true; }
  return false;
}
const ITEM = { hint: ['💡', 'Ndihmë'], shuffle: ['🔀', 'Përzierje'], undo: ['↶', 'Kthe'], clear: ['📤', 'Pastro'] };
function useItem(kind, fn) {
  if (S.inv[kind] > 0) { pay(kind); fn(); return; }
  if (S.coins >= PRICE[kind]) {
    modal(ITEM[kind][0], ITEM[kind][1], `Nuk të kanë mbetur më. Dëshiron të blesh 1 për <b>🪙 ${PRICE[kind]}</b>?`, [
      { t: `Bli për 🪙 ${PRICE[kind]}`, cls: 'primary', fn: () => { pay(kind); fn(); } },
      { t: 'Jo tani', cls: 'light' }]);
  } else modal(ITEM[kind][0], ITEM[kind][1], `Nuk ke mjaftueshëm monedha (duhen ${PRICE[kind]}). Kalo nivele dhe bëj kombo për të fituar monedha!`, [{ t: 'Në rregull', cls: 'primary' }]);
}
function findHint() {
  const free = boardTiles().filter(t => t.free);
  // 1) a free tile that matches something already in the tray
  for (const id of G.tray) { const k = matchKey(G.tiles[id].k); const m = free.find(t => matchKey(t.k) === k); if (m) return [m]; }
  // 2) two free tiles that match
  if (G.tray.length <= TRAY_MAX - 2) {
    const byKey = {};
    for (const t of free) { const k = matchKey(t.k); if (byKey[k]) return [byKey[k], t]; byKey[k] = t; }
    // 3) a free tile whose twin is right underneath it
    const live = boardTiles();
    for (const a of free) {
      const rest = live.filter(t => t !== a);
      const twin = rest.find(t => matchKey(t.k) === matchKey(a.k) && !t.free && isFree(t, rest));
      if (twin) return [a, twin];
    }
  }
  return null;
}
function showHint() {
  clearHints();
  const q = findHint();
  if (!q) { if (G.tray.length) { $('clearBtn').classList.add('glow'); toast('Provo 📤 Pastro ose 🔀 Përzie'); } else { $('shuffleBtn').classList.add('glow'); toast('Provo 🔀 Përzie'); } return false; }
  q.forEach(t => t.el && t.el.classList.add('hint'));
  const t = q[0];
  hintHand = document.createElement('div'); hintHand.className = 'hand'; hintHand.textContent = '👆';
  hintHand.style.left = (parseFloat(t.el.style.left) + geo.tw * 0.35) + 'px';
  hintHand.style.top = (parseFloat(t.el.style.top) + geo.th * 0.55) + 'px';
  boardEl.appendChild(hintHand);
  return true;
}
$('hintBtn').onclick = () => {
  if (!G || G.won || G.busy || G.over) return; Snd.resume();
  if (!findHint()) { showHint(); return; }
  useItem('hint', () => { showHint(); markUsed(); Snd.hint(); saveGame(); });
};
$('undoBtn').onclick = () => {
  if (!G || G.won || G.busy) return; Snd.resume();
  if (!G.history.length) { toast('Kutia është bosh'); return; }
  useItem('undo', doUndo);
};
$('clearBtn').onclick = () => {
  if (!G || G.won || G.busy) return; Snd.resume();
  if (!G.tray.length) { toast('Kutia është bosh'); return; }
  useItem('clear', doClear);
};
$('shuffleBtn').onclick = () => { if (!G || G.won || G.busy || G.over) return; Snd.resume(); useItem('shuffle', doShuffle); };
function doShuffle() {
  const board = boardTiles();
  const trayKeys = G.tray.map(id => matchKey(G.tiles[id].k));
  const groups = {};
  for (const t of board) (groups[matchKey(t.k)] = groups[matchKey(t.k)] || []).push(t.k);
  const pairs = [], singles = [];
  for (const key in groups) {
    const arr = groups[key].slice();
    if (trayKeys.includes(key) && arr.length % 2 === 1) singles.push(arr.pop());
    for (let i = 0; i + 1 < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
  }
  if (!solvableAssignTray(board, pairs, singles)) { toast('Nuk u përzie dot, provo sërish'); return; }
  G.busy = true; clearHints();
  const bw = parseFloat(boardEl.style.width), bh = parseFloat(boardEl.style.height);
  Snd.shuffle(); vibe(30);
  for (const t of board) {
    const dx = bw / 2 - (parseFloat(t.el.style.left) + geo.tw / 2), dy = bh / 2 - (parseFloat(t.el.style.top) + geo.th / 2);
    t.el.animate([
      { transform: 'translate(0,0) rotate(0)' },
      { transform: `translate(${dx * 0.85}px, ${dy * 0.85}px) rotate(${(Math.random() - .5) * 120}deg) scale(.8)`, offset: 0.5 },
      { transform: 'translate(0,0) rotate(0)' }
    ], { duration: 900, easing: 'ease-in-out', delay: Math.random() * 80 });
  }
  setTimeout(() => { board.forEach(t => { t.k = t._k; delete t._k; t.el.querySelector('.face').innerHTML = faceSVG(t.k); }); refreshFree(); }, 450);
  setTimeout(() => { G.busy = false; markUsed(); saveGame(); }, 1000);
}
function trayFull() {
  if (!G || G.won) return;
  trayEl.classList.remove('full'); void trayEl.offsetWidth; trayEl.classList.add('full');
  Snd.fail(); vibe([60, 40, 120]);
  const canU = S.inv.undo > 0 || S.coins >= PRICE.undo, canC = S.inv.clear > 0 || S.coins >= PRICE.clear;
  const lbl = (k, txt) => S.inv[k] > 0 ? `${txt} (${S.inv[k]})` : `${txt} · 🪙 ${PRICE[k]}`;
  setTimeout(() => modal('😮', 'Kutia u mbush!', '4 pllaka të ndryshme në kuti. Përdor një ndihmë për të vazhduar nivelin, ose fillo nga e para.', [
    { t: lbl('clear', '📤 Kthe të gjitha'), cls: 'primary', disabled: !canC, fn: () => { if (pay('clear')) doClear(); else trayFull(); } },
    { t: lbl('undo', '↶ Kthe 1 pllakë'), cls: 'primary', disabled: !canU, fn: () => { if (pay('undo')) doUndo(); else trayFull(); } },
    { t: '↺ Fillo nga e para', cls: 'danger', fn: () => newGame(G.mode, G.id) }]), 450);
}


// ---------- Rewards: star chest, gifts, missions, level goals, gift tiles ----------
const HELP_KEYS = ['hint', 'undo', 'clear', 'shuffle'];
const HELP_ICON = { hint: '💡', undo: '↶', clear: '📤', shuffle: '🔀' };
const HELP_NAME = { hint: 'Ndihmë', undo: 'Kthe', clear: 'Pastro', shuffle: 'Përzie' };
S.rw = Object.assign({ starBank: 0, chests: 0, missions: [], tier: 0 }, store.get('rw', {}));
const saveRw = () => store.set('rw', S.rw);
const CHEST_GOAL = 10;
const randHelp = () => HELP_KEYS[Math.floor(Math.random() * HELP_KEYS.length)];
function makeReward(helpers, coins) { const r = { coins }; for (let i = 0; i < helpers; i++) { const k = randHelp(); r[k] = (r[k] || 0) + 1; } return r; }
function grant(r) { for (const k of HELP_KEYS) if (r[k]) S.inv[k] += r[k]; if (r.coins) S.coins += r.coins; save(); updateTools(); }
function rewardHTML(r) {
  let h = '<div class="ritems">';
  let i = 0;
  for (const k of HELP_KEYS) if (r[k]) h += `<div class="ritem" style="animation-delay:${0.35 + 0.15 * i++}s"><span class="ri">${HELP_ICON[k]}</span><b>+${r[k]}</b><small>${HELP_NAME[k]}</small></div>`;
  if (r.coins) h += `<div class="ritem" style="animation-delay:${0.35 + 0.15 * i++}s"><span class="ri"><i class="coin big"></i></span><b>+${r.coins}</b><small>Monedha</small></div>`;
  return h + '</div>';
}
function rewardShort(r) { return HELP_KEYS.filter(k => r[k]).map(k => `${HELP_ICON[k]}${r[k] > 1 ? '×' + r[k] : ''}`).join(' ') + (r.coins ? ` 🪙${r.coins}` : ''); }
function showReward(title, icon, r, then) {
  grant(r);
  modal(icon, title, `<div class="chest">${icon}</div>` + rewardHTML(r), [{ t: 'Merr 🎉', cls: 'primary', fn: then }]);
  $('modal').classList.add('reward-modal');
  Snd.win(); vibe([20, 30, 40]); bumpCoins();
}
let rewardQueue = [];
function queueReward(title, icon, r) { rewardQueue.push({ title, icon, r }); }
function flushRewards(then) {
  const q = rewardQueue.shift();
  if (!q) { $('modal').classList.remove('reward-modal'); return then && then(); }
  showReward(q.title, q.icon, q.r, () => flushRewards(then));
}

// --- Missions (3 active challenges) ---
const MISSION_TYPES = {
  pairs:   { icon: '💥', base: 30, step: 15, text: n => `Thyej ${n} çifte pllakash` },
  levels:  { icon: '🏁', base: 3, step: 1, text: n => `Kalo ${n} nivele` },
  stars3:  { icon: '⭐', base: 2, step: 1, text: n => `Kalo ${n} nivele me 3 yje` },
  combo3:  { icon: '🔥', base: 3, step: 2, text: n => `Arri kombo x3 ${n} herë` },
  nohelp:  { icon: '🧠', base: 2, step: 1, text: n => `Kalo ${n} nivele pa përdorur ndihma` },
  flowers: { icon: '🌸', base: 3, step: 2, text: n => `Thyej ${n} çifte lulesh ose stinësh` },
  dragons: { icon: '🐉', base: 4, step: 2, text: n => `Thyej ${n} çifte dragonjsh (中 發 ▢)` },
  winds:   { icon: '🌬️', base: 4, step: 2, text: n => `Thyej ${n} çifte erërash (東 南 西 北)` },
  fast:    { icon: '⏱️', base: 2, step: 1, text: n => `Kalo ${n} nivele për më pak se 2 minuta` },
  gold:    { icon: '🎁', base: 3, step: 2, text: n => `Thyej ${n} pllaka me dhuratë` },
  goals:   { icon: '🎯', base: 1, step: 1, text: n => `Kryej ${n} sfida nivelesh 🎯` },
  daily:   { icon: '📅', base: 1, step: 1, text: n => `Fito ${n} sfidë ditore` },
};
function newMission(exclude) {
  const types = Object.keys(MISSION_TYPES).filter(t => !exclude.includes(t));
  const type = types[Math.floor(Math.random() * types.length)];
  const d = MISSION_TYPES[type], lvl = Math.min(6, Math.floor(S.rw.tier / 3));
  return { type, goal: d.base + d.step * lvl, prog: 0, reward: makeReward(1 + (Math.random() < 0.5 ? 1 : 0) + (lvl >= 2 ? 1 : 0), 20 + 10 * Math.min(lvl, 5)) };
}
function ensureMissions() {
  for (let i = 0; i < 3; i++) if (!S.rw.missions[i]) S.rw.missions[i] = newMission(S.rw.missions.filter(Boolean).map(m => m.type));
  saveRw();
}
function track(type, n = 1) {
  let changed = false;
  for (const m of S.rw.missions) if (m && m.type === type && m.prog < m.goal) {
    m.prog = Math.min(m.goal, m.prog + n); changed = true;
    if (m.prog >= m.goal) setTimeout(() => toast(`${MISSION_TYPES[type].icon} Sfida u krye! Merre shpërblimin te 🎯 Sfidat`), 600);
  }
  if (changed) { saveRw(); updateMissionBadge(); }
}
const claimable = () => S.rw.missions.filter(m => m && m.prog >= m.goal).length;
function updateMissionBadge() {
  const n = claimable();
  document.querySelectorAll('.mission-badge').forEach(b => { b.textContent = n; b.classList.toggle('hidden', !n); });
  const bar = $('homeChestFill'); if (bar) bar.style.width = (100 * S.rw.starBank / CHEST_GOAL) + '%';
  const txt = $('homeChestText'); if (txt) txt.textContent = `${S.rw.starBank}/${CHEST_GOAL}`;
}
function renderMissions() {
  ensureMissions();
  $('mChestFill').style.width = (100 * S.rw.starBank / CHEST_GOAL) + '%';
  $('mChestText').textContent = `⭐ ${S.rw.starBank}/${CHEST_GOAL}`;
  const next5 = Math.ceil(S.level / 5) * 5;
  $('mGiftText').textContent = `Niveli ${next5 < S.level ? next5 + 5 : next5}`;
  const list = $('missionList'); list.innerHTML = '';
  S.rw.missions.forEach((m, i) => {
    const d = MISSION_TYPES[m.type], done = m.prog >= m.goal;
    const el = document.createElement('div');
    el.className = 'mission' + (done ? ' done' : '');
    el.innerHTML = `<div class="m-ic">${d.icon}</div><div class="m-body"><div class="m-title">${d.text(m.goal)}</div>
      <div class="m-bar"><div style="width:${100 * m.prog / m.goal}%"></div><span>${m.prog}/${m.goal}</span></div>
      <div class="m-rew">Shpërblimi: ${rewardShort(m.reward)}</div></div>`;
    if (done) { const b = document.createElement('button'); b.className = 'btn primary m-claim'; b.textContent = 'Merr'; b.onclick = () => claimMission(i); el.appendChild(b); }
    list.appendChild(el);
  });
  updateMissionBadge();
}
function claimMission(i) {
  const m = S.rw.missions[i]; if (!m || m.prog < m.goal) return;
  S.rw.tier++;
  S.rw.missions[i] = null;
  S.rw.missions[i] = newMission(S.rw.missions.filter(Boolean).map(x => x.type).concat([m.type]));
  saveRw();
  showReward('Sfida u krye!', MISSION_TYPES[m.type].icon, m.reward, () => { $('modal').classList.remove('reward-modal'); renderMissions(); });
}
function openMissions() { closeModal(); clearInterval(timerInt); renderMissions(); showScreen('missions'); }

// --- Level goals (special challenge levels) ---
const GOALS = {
  time:   { icon: '⏱️', name: 'Kundër kohës', desc: g => `Kalo nivelin brenda <b>${fmtSec(g.goal)}</b>.` },
  nohelp: { icon: '🧠', name: 'Pa ndihma', desc: () => 'Kalo nivelin <b>pa përdorur asnjë ndihmë</b>.' },
  combo:  { icon: '🔥', name: 'Mjeshtri i kombove', desc: () => 'Arri një <b>kombo x3</b> (3 çifte shpejt njëri pas tjetrit).' },
  calm:   { icon: '🧘', name: 'Kutia e qetë', desc: () => 'Mos lejo që kutia të ketë <b>3 pllaka</b> njëherësh.' },
};
const fmtSec = s => Math.floor(s / 60) + ':' + pad2(Math.max(0, Math.floor(s % 60)));
function goalForLevel(lv, total) {
  if (lv < 6 || lv % 4 !== 2) return null;
  const type = ['time', 'combo', 'nohelp', 'calm'][Math.floor(lv / 4) % 4];
  return { type, goal: type === 'time' ? Math.ceil(total * 1.7) + 20 : type === 'combo' ? 3 : 0, prog: 0, failed: false };
}
function goalFail(type) {
  if (!G || !G.obj || G.obj.type !== type || G.obj.failed) return;
  G.obj.failed = true; updateGoalChip();
  toast('🎯 Sfida e nivelit dështoi — vazhdo të luash!');
}
function goalOK() {
  const o = G && G.obj; if (!o) return false;
  if (o.failed) return false;
  if (o.type === 'time') return G.time <= o.goal;
  if (o.type === 'combo') return o.prog >= 3;
  return true;
}
function updateGoalChip() {
  const chip = $('goalChip');
  if (!G || !G.obj) { chip.classList.add('hidden'); return; }
  const o = G.obj, d = GOALS[o.type];
  chip.classList.remove('hidden');
  let txt = d.icon + ' ';
  if (o.type === 'time') txt += o.failed ? 'Koha mbaroi' : fmtSec(o.goal - G.time);
  else if (o.type === 'combo') txt += `Kombo x3 ${o.prog >= 3 ? '✓' : ''}`;
  else txt += d.name;
  if (o.failed) txt += ' ✗';
  chip.textContent = txt;
  chip.classList.toggle('failed', o.failed);
  chip.classList.toggle('ok', !o.failed && (o.type === 'combo' ? o.prog >= 3 : false));
  chip.classList.toggle('urgent', o.type === 'time' && !o.failed && o.goal - G.time <= 15);
}
function markUsed() { G.used++; goalFail('nohelp'); }

// --- Gift tiles ---
function assignGifts(tiles, lv) {
  const n = 1 + (Math.random() < 0.5 ? 1 : 0) + (lv % 5 === 0 ? 1 : 0);
  const pool = shuffleArr(tiles.slice());
  for (let i = 0; i < n && i < pool.length; i++) pool[i].b = Math.random() < 0.55 ? 'coin' : randHelp();
}
function giftHTML(b) { return b ? `<i class="gift-badge">${b === 'coin' ? '🪙' : HELP_ICON[b]}</i>` : ''; }
function collectGift(t, x, y) {
  if (!t.b) return;
  let txt;
  if (t.b === 'coin') { S.coins += 15; txt = '+15 🪙'; }
  else { S.inv[t.b]++; txt = `+1 ${HELP_ICON[t.b]}`; }
  save(); updateTools(); bumpCoins(); track('gold');
  const el = document.createElement('div'); el.className = 'gain'; el.textContent = txt;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.appendChild(el); setTimeout(() => el.remove(), 1400);
  Snd.coin();
  t.b = null;
}

// --- Events from the game ---
function onPairBroken(a, b, combo, x, y) {
  track('pairs');
  const c = a.k[0];
  if (c === 'f' || c === 's') track('flowers');
  if (c === 'r') track('dragons');
  if (c === 'w') track('winds');
  if (combo === 3) track('combo3');
  if (G.obj && G.obj.type === 'combo') { G.obj.prog = Math.max(G.obj.prog, combo); updateGoalChip(); }
  collectGift(a, x - 30, y); collectGift(b, x + 30, y);
}
// returns HTML lines for the win dialog and queues periodic rewards
function onWinRewards(stars, prevStars, first) {
  const lines = [];
  if (G.mode === 'level') {
    track('levels');
    if (stars === 3) track('stars3');
    if (G.used === 0) track('nohelp');
    if (G.time < 120) track('fast');
    const newStars = Math.max(0, stars - prevStars);
    S.rw.starBank += newStars;
    while (S.rw.starBank >= CHEST_GOAL) { S.rw.starBank -= CHEST_GOAL; S.rw.chests++; queueReward('Sandëku me yje!', '🧰', makeReward(3, 40)); }
    if (first && G.id % 20 === 0) queueReward(`Kapitulli ${G.id / 20} u përfundua!`, '👑', { hint: 1, undo: 1, clear: 1, shuffle: 1, coins: 100 });
    else if (first && G.id % 5 === 0) queueReward(`Dhurata e nivelit ${G.id}`, '🎁', makeReward(2, 30));
    lines.push(`<div class="win-chest"><span>🧰</span><div class="wc-track"><div style="width:${100 * S.rw.starBank / CHEST_GOAL}%"></div></div><b>⭐ ${S.rw.starBank}/${CHEST_GOAL}</b></div>`);
  } else track('daily');
  if (G.obj) {
    const ok = goalOK();
    if (ok) { track('goals'); queueReward('Sfida e nivelit u krye!', GOALS[G.obj.type].icon, makeReward(2, 25)); }
    lines.push(`<div class="win-goal ${ok ? 'ok' : 'no'}">${GOALS[G.obj.type].icon} ${GOALS[G.obj.type].name}: <b>${ok ? 'U krye ✓' : 'Nuk u krye'}</b></div>`);
  }
  saveRw(); updateMissionBadge();
  return lines.join('');
}

// ---------- Win ----------
function win() {
  if (G.won) return;
  G.won = true;
  clearInterval(timerInt);
  store.del('game2');
  Snd.win(); vibe([30, 40, 60]);
  confettiFx();
  const s = Math.floor(G.time), timeTxt = Math.floor(s / 60) + ':' + pad2(s % 60);
  const stars = G.used === 0 ? 3 : G.used <= 2 ? 2 : 1;
  let reward, title, btns, extra = '';
  const prevStars = G.mode === 'level' ? (S.stars[G.id] || 0) : 0, firstWin = G.mode === 'level' ? !S.done[G.id] : !S.daily[G.id];
  if (G.mode === 'level') {
    const first = !S.done[G.id];
    reward = first ? 15 + stars * 5 : 5;
    S.done[G.id] = true; S.stars[G.id] = Math.max(S.stars[G.id] || 0, stars);
    if (G.id >= S.level) S.level = G.id + 1;
    title = `Niveli ${G.id} u kalua!`;
    btns = [{ t: `Niveli ${G.id + 1} ›`, cls: 'primary', fn: () => playLevel(G.id + 1) }, { t: 'Udhëtimi', cls: 'light', fn: openMap }];
  } else {
    const first = !S.daily[G.id]; S.daily[G.id] = true;
    reward = first ? 60 : 5;
    title = 'Trofe i ri! 🏆';
    btns = [{ t: 'Kalendari', cls: 'primary', fn: openDaily }, { t: 'Menuja kryesore', cls: 'light', fn: goHome }];
  }
  S.coins += reward; save();
  extra = onWinRewards(stars, prevStars, firstWin);
  btns = btns.map(b => ({ ...b, fn: () => flushRewards(b.fn) }));
  setTimeout(() => {
    modal(G.mode === 'level' ? '🎉' : '🏆', title, `Koha: <b>${timeTxt}</b><br><span class="reward"><i class="coin"></i>+<span id="rewardNum">0</span></span>${extra}`, btns, stars);
    let n = 0; const step = Math.max(1, Math.ceil(reward / 20));
    const iv = setInterval(() => { n = Math.min(reward, n + step); const e = $('rewardNum'); if (e) e.textContent = n; if (n % 3 === 0) Snd.coin(); if (n >= reward) { clearInterval(iv); updateTools(); bumpCoins(); } }, 50);
  }, 500);
}

// ---------- Screens ----------
const SCREENS = ['home', 'game', 'levels', 'daily', 'settings', 'missions'];
let current = 'home';
function showScreen(id) { current = id; SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id)); }
function goHome() { closeModal(); clearInterval(timerInt); if (G && !G.won) saveGame(); updateHome(); showScreen('home'); }
function fmtDate(key) { const [y, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; }
function updateHome() {
  $('playSub').textContent = 'Niveli ' + S.level;
  updateMissionBadge();
  const t = new Date(), k = dateKey(t);
  $('dailySub').textContent = S.daily[k] ? `✔ ${t.getDate()} ${MONTHS_SHORT[t.getMonth()]} u krye` : `${t.getDate()} ${MONTHS[t.getMonth()]}`;
  updateTools();
}
function startGameScreen(intro) {
  closeModal();
  showScreen('game');
  Snd.startMusic();
  $('gameTitle').textContent = G.mode === 'level' ? 'Niveli ' + G.id + (G.name ? ' · ' + G.name : '') : 'Sfida · ' + fmtDate(G.id);
  updateGoalChip();
  requestAnimationFrame(() => {
    renderBoard(intro);
    if (G.obj && G.fresh) {
      G.fresh = false;
      const d = GOALS[G.obj.type];
      setTimeout(() => modal('🎯', 'Sfida e nivelit: ' + d.name, d.desc(G.obj) + '<br><br>Nëse e kryen, fiton <b>ndihma dhe monedha</b> si bonus!', [{ t: 'Fillojmë!', cls: 'primary' }]), 900);
    }
    if (G.mode === 'level' && G.id === 1 && !store.get('tutorial', false)) {
      store.set('tutorial', true);
      setTimeout(() => modal('👋', 'Mirë se erdhe!', 'Prek një pllakë <b>të ndriçuar</b> dhe ajo shkon në <b>kutinë lart</b>. Kur dy pllaka të njëjta bashkohen atje, ato <b>thyhen</b>! Kujdes: nëse kutia mbushet me 4 pllaka të ndryshme, humbet.', [{ t: 'Fillojmë!', cls: 'primary', fn: showHint }]), 1100);
    }
  });
  clearInterval(timerInt);
  timerInt = setInterval(() => {
    if (!G || G.won || current !== 'game' || !$('modal').classList.contains('hidden') || document.hidden) return;
    G.time += 1;
    if (G.obj && G.obj.type === 'time') { if (G.time > G.obj.goal) goalFail('time'); updateGoalChip(); }
    if (G.time % 5 === 0) saveGame();
  }, 1000);
}
window.addEventListener('resize', () => { if (current === 'game' && G) { layoutTray(); layoutBoard(); trayEls.forEach((el) => { el.style.width = tgeo.tw + 'px'; el.style.height = tgeo.th + 'px'; }); relayoutTray(); } });

$('playBtn').onclick = () => { Snd.resume(); Snd.click(); playLevel(S.level); };
$('dailyBtn').onclick = () => { Snd.resume(); Snd.click(); openDaily(); };
$('levelsBtn').onclick = () => { Snd.resume(); Snd.click(); openMap(); };
$('settingsBtn').onclick = () => { Snd.resume(); Snd.click(); renderSettings(); showScreen('settings'); };
$('missionsBtn').onclick = () => { Snd.resume(); Snd.click(); openMissions(); };
$('backBtn').onclick = goHome;
document.querySelectorAll('.back').forEach(b => b.onclick = goHome);

// Level map (journey path)
function openMap() {
  closeModal(); clearInterval(timerInt);
  showScreen('levels');
  const map = $('levelMap'); map.innerHTML = '';
  const W = map.clientWidth || 360;
  const max = Math.min(MAX_LEVEL, Math.max(S.level + 30, 60));
  const gap = 118, top = 70;
  const H = top * 2 + (max - 1) * gap;
  map.style.height = H + 'px';
  const pos = i => { const y = H - top - (i - 1) * gap; const x = W / 2 + Math.sin(i * 0.85) * W * 0.3; return [x, y]; };
  let d = '';
  for (let i = 1; i <= max; i++) { const [x, y] = pos(i); d += (i === 1 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '; }
  map.innerHTML = `<svg class="path" width="${W}" height="${H}"><path d="${d}" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="6" stroke-dasharray="2 16" stroke-linecap="round"/></svg>`;
  for (let i = 1; i <= max; i++) {
    const [x, y] = pos(i);
    const b = document.createElement('button');
    const locked = i > S.level, done = !!S.done[i];
    b.className = 'node' + (locked ? ' locked' : done ? ' done' : '') + (i === S.level ? ' current' : '');
    b.style.left = x + 'px'; b.style.top = y + 'px';
    b.innerHTML = locked ? '🔒' : i;
    if (i % 5 === 0 && !done) b.innerHTML += `<span class="nmark">${i % 20 === 0 ? '👑' : '🎁'}</span>`;
    else if (i >= 6 && i % 4 === 2 && !done) b.innerHTML += '<span class="nmark">🎯</span>';
    if (done) { const st = S.stars[i] || 1; b.innerHTML += `<span class="nstars">${'★'.repeat(st)}<span class="off">${'★'.repeat(3 - st)}</span></span>`; }
    if (!locked) b.onclick = () => { Snd.resume(); Snd.click(); playLevel(i); };
    if (i % 3 === 0 && !locked) b.classList.add('shape');
    map.appendChild(b);
    if ((i - 1) % CHAPTER_LEN === 0) {
      const c = chapterOf(i), ban = document.createElement('div');
      ban.className = 'chapter' + (i > S.level ? ' locked' : '');
      ban.innerHTML = `<small>Kapitulli ${c + 1}</small>${chapterName(c)}`;
      ban.style.top = (y + gap * 0.55) + 'px';
      map.appendChild(ban);
    }
  }
  requestAnimationFrame(() => { const [, y] = pos(S.level); $('mapScroll').scrollTop = y - $('mapScroll').clientHeight / 2; });
}

// Daily calendar
let calY, calM, calSel;
function openDaily() { closeModal(); clearInterval(timerInt); const t = new Date(); calY = t.getFullYear(); calM = t.getMonth(); calSel = dateKey(t); renderCal(); showScreen('daily'); }
function renderCal() {
  const tk = dateKey(new Date());
  $('calMonth').textContent = MONTHS[calM] + ' ' + calY;
  const first = new Date(calY, calM, 1), days = new Date(calY, calM + 1, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const grid = $('calGrid'); grid.innerHTML = '';
  for (let i = 0; i < lead; i++) { const e = document.createElement('span'); e.className = 'cd empty'; grid.appendChild(e); }
  let doneCount = 0;
  for (let d = 1; d <= days; d++) {
    const k = `${calY}-${pad2(calM + 1)}-${pad2(d)}`;
    const b = document.createElement('button');
    const future = k > tk, done = !!S.daily[k]; if (done) doneCount++;
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
  pb.textContent = calSel ? (S.daily[calSel] ? `Luaj sërish · ${fmtDate(calSel)}` : `Luaj · ${fmtDate(calSel)}`) : 'Zgjidh një ditë';
  pb.disabled = !calSel;
}
$('calPrev').onclick = () => { calM--; if (calM < 0) { calM = 11; calY--; } calSel = null; renderCal(); };
$('calNext').onclick = () => { calM++; if (calM > 11) { calM = 0; calY++; } calSel = null; renderCal(); };
$('dailyPlay').onclick = () => { if (calSel) { Snd.resume(); playDaily(calSel); } };

// Settings
function renderSettings() {
  $('setMusic').checked = S.set.music; $('setSound').checked = S.set.sound; $('setVibe').checked = S.set.vibe;
  $('setDim').checked = S.set.dim; $('setNums').checked = S.set.nums;
  document.querySelectorAll('.th').forEach(b => b.classList.toggle('on', b.dataset.bg === S.set.bg));
  document.querySelectorAll('.tc').forEach(b => b.classList.toggle('on', b.dataset.tiles === S.set.tiles));
}
$('setMusic').onchange = e => { S.set.music = e.target.checked; save(); Snd.resume(); Snd.setMusic(S.set.music); };
$('setSound').onchange = e => { S.set.sound = e.target.checked; save(); Snd.resume(); Snd.click(); };
$('setVibe').onchange = e => { S.set.vibe = e.target.checked; save(); vibe(30); };
$('setDim').onchange = e => { S.set.dim = e.target.checked; save(); };
$('setNums').onchange = e => { S.set.nums = e.target.checked; save(); buildTileImages(); };
document.querySelectorAll('.th').forEach(b => b.onclick = () => { S.set.bg = b.dataset.bg; applyTheme(); save(); renderSettings(); Snd.resume(); Snd.click(); });
document.querySelectorAll('.tc').forEach(b => b.onclick = () => { S.set.tiles = b.dataset.tiles; applyTheme(); save(); renderSettings(); Snd.resume(); Snd.click(); });
function applyTheme() {
  document.body.className = 'bg-' + S.set.bg + ' tiles-' + S.set.tiles;
  buildTileImages();
  const col = { jade: '#1b6b47', ocean: '#1f5f9e', sunset: '#e2607a', lavender: '#6e55b0', night: '#1c2542' }[S.set.bg];
  document.querySelector('meta[name=theme-color]').setAttribute('content', col);
}

// Floating tiles on the home screen
function makeFloaters() {
  const box = $('floaters'); box.innerHTML = '';
  const glyphs = [['中', '#cc2b25'], ['發', '#17803a'], ['東', '#1b2a4a'], ['🌸', ''], ['北', '#1b2a4a'], ['❄️', ''], ['萬', '#cc2b25'], ['🍁', '']];
  glyphs.forEach((g, i) => {
    const f = document.createElement('div'); f.className = 'floater';
    f.textContent = g[0]; if (g[1]) f.style.color = g[1];
    f.style.left = (5 + (i * 12.5) % 90) + '%';
    f.style.animationDuration = (16 + Math.random() * 10) + 's';
    f.style.animationDelay = (-Math.random() * 20) + 's';
    f.style.setProperty('--rot', ((Math.random() - .5) * 120) + 'deg');
    box.appendChild(f);
  });
}

// Modal & toast
function modal(icon, title, text, btns, stars) {
  $('mIcon').textContent = icon; $('mTitle').textContent = title; $('mText').innerHTML = text;
  const st = $('mStars');
  if (stars) {
    st.classList.remove('hidden');
    [...st.children].forEach((s, i) => { s.className = ''; if (i < stars) setTimeout(() => { s.className = 'on'; Snd.star(i); }, 350 + i * 300); });
  } else st.classList.add('hidden');
  const box = $('mBtns'); box.innerHTML = '';
  for (const b of btns) {
    const el = document.createElement('button');
    el.className = 'btn big ' + (b.cls || 'light');
    el.textContent = b.t;
    if (b.disabled) el.disabled = true;
    el.onclick = () => { Snd.click(); closeModal(); b.fn && b.fn(); };
    box.appendChild(el);
  }
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }
let toastT;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 1500); }

// Android back button & lifecycle
const AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
if (AppPlugin) {
  AppPlugin.addListener('backButton', () => {
    if (!$('modal').classList.contains('hidden')) { if (current === 'game' && G && G.won) goHome(); else closeModal(); return; }
    if (current === 'home') AppPlugin.exitApp(); else goHome();
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (G && !G.won) saveGame(); if (Snd.ctx) Snd.ctx.suspend(); }
  else if (Snd.ctx) Snd.ctx.resume();
});
// start music on first touch anywhere (browsers require a gesture)
window.addEventListener('pointerdown', () => { Snd.resume(); Snd.startMusic(); }, { once: true });

window.__mj = { track, onWinRewards, renderMissions, get rewardQueue() { return rewardQueue; }, get G() { return G; }, S, isFree, findHint, moveToTray, makeLayout, levelTarget, newGame, solvableAssignTray, buildPairs, boardTiles, win, tileImgs: () => tileImgs };

// ---------- Start ----------
applyTheme();
makeFloaters();
ensureMissions();
updateHome();
showScreen('home');
})();
