// Is the voice-design effect weak because we under-drive the axes, or because the
// model's style space is genuinely narrow? Four measurements:
//   A. raw-preset F0 span — how far apart are the 10 shipped voices to begin with?
//   B. masc↔fem EXTRAPOLATION (gain 0→4 from the neutral midpoint) — how big a
//      pitch swing can the axis produce, and where does it break (clip/NaN)?
//   C. PC0 extrapolation (±2…±8 σ) — same, for the top principal component.
//   D. does GUIDANCE modulate style range? push masc↔fem hard at guidance {1,3,5}.
// F0 (autocorrelation) is the pitch proxy; peak/finite gate validity.
//
// Run: bro-headless ../broworkshop/demos/supertonic-lab \
//        ../broworkshop/demos/supertonic-lab/tests/explore_range.js

const DATA = (typeof process !== 'undefined' && process.env && process.env.BRO_STDATA)
  || 'D:/projects/brosoundml-data/supertonic';
const OUT = (typeof process !== 'undefined' && process.env && process.env.BRO_STOUT)
  || 'D:/projects/bro/_explore/range';
const TEXT = 'How far can this voice be pushed before it breaks?';
const TTLN = 50 * 256, DPN = 8 * 16, D = TTLN + DPN;

const fs = require('fs');
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }
function writeWav(path, s, sr) {
  const n = s.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const ws = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { let v = Math.max(-1, Math.min(1, s[i])); dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  fs.writeFileSync(path, new Uint8Array(buf));
}
function estF0(s, sr) {
  const frame = (0.04 * sr) | 0, minLag = (sr / 350) | 0, maxLag = (sr / 75) | 0;
  let sum = 0, cnt = 0;
  for (let off = 0; off + maxLag + frame < s.length; off += frame) {
    let e = 0; for (let i = 0; i < frame; i++) e += s[off + i] * s[off + i];
    if (e < 1e-3) continue;
    let bestLag = 0, best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) { let c = 0; for (let i = 0; i < frame; i++) c += s[off + i] * s[off + i + lag]; if (c > best) { best = c; bestLag = lag; } }
    if (bestLag > 0 && best > 0.3 * e) { sum += sr / bestLag; cnt++; }
  }
  return cnt ? sum / cnt : 0;
}
function val(s) { let p = 0, bad = 0; for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (!isFinite(a)) bad++; if (a > p) p = a; } return { peak: p, bad }; }
const addv = (a, b, k) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + k * b[i]; return o; };
const mean = (arrs) => { const o = new Float32Array(arrs[0].length); for (const a of arrs) for (let i = 0; i < a.length; i++) o[i] += a[i] / arrs.length; return o; };

ensureDir(OUT);
const st = bro.tts.loadSupertonic(DATA);
assert(st && st.loaded, 'Supertonic loaded');
const names = fs.readdirSync(DATA + '/voice_styles').filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
const P = {};
for (const n of names) { const v = st.loadVoiceStyle(DATA + '/voice_styles/' + n + '.json'); P[n] = { ttl: v.ttl, dp: v.dp }; }
const synth = (ttl, dp, g) => st.synthesize(TEXT, { voice: st.createVoice(ttl, dp, 'x'), language: 'en', seed: 7, guidance: g == null ? 3 : g });

// ── A. raw-preset F0 span ────────────────────────────────────────────────────
console.log('--- A. raw presets (the palette\'s natural spread) ---');
let f0s = [];
for (const n of names) { const r = st.synthesize(TEXT, { voice: st.loadVoiceStyle(DATA + '/voice_styles/' + n + '.json'), language: 'en', seed: 7 }); const f = estF0(r.samples, r.sampleRate); f0s.push([n, f]); }
f0s.sort((a, b) => a[1] - b[1]);
console.log('   F0 by preset:', f0s.map((e) => e[0] + ' ' + e[1].toFixed(0)).join(' · '));
console.log('   raw F0 span', f0s[0][1].toFixed(0), '→', f0s[f0s.length - 1][1].toFixed(0), 'Hz (Δ' + (f0s[f0s.length - 1][1] - f0s[0][1]).toFixed(0) + ')');

// ── B. masc↔fem extrapolation from the neutral midpoint ──────────────────────
const fem = names.filter((n) => /^f/i.test(n)), masc = names.filter((n) => /^m/i.test(n));
const femC = { ttl: mean(fem.map((n) => P[n].ttl)), dp: mean(fem.map((n) => P[n].dp)) };
const mascC = { ttl: mean(masc.map((n) => P[n].ttl)), dp: mean(masc.map((n) => P[n].dp)) };
const axis = { ttl: addv(mascC.ttl, femC.ttl, -1), dp: addv(mascC.dp, femC.dp, -1) };       // M − F
const mid = { ttl: addv(femC.ttl, axis.ttl, 0.5), dp: addv(femC.dp, axis.dp, 0.5) };          // midpoint
console.log('--- B. masc↔fem extrapolation (gain·axis from midpoint; current lab caps at ±0.5) ---');
console.log('   gain |  F0  | peak | ok');
for (const g of [-2, -1, -0.5, 0, 0.5, 1, 2, 3]) {
  const ttl = addv(mid.ttl, axis.ttl, g * 0.5), dp = addv(mid.dp, axis.dp, g * 0.5);
  const r = synth(ttl, dp); const v = val(r.samples);
  writeWav(OUT + '/mf_' + g + '.wav', r.samples, r.sampleRate);
  console.log(String(g).padStart(5), '|', estF0(r.samples, r.sampleRate).toFixed(0).padStart(4), '|', v.peak.toFixed(2), '|', v.bad === 0 && v.peak < 0.99 ? 'y' : 'CLIP/NaN');
}

// ── C. PC0 extrapolation ─────────────────────────────────────────────────────
// quick PC0 via power iteration on the centered matrix (good enough for the top dir)
const X = names.map((n) => { const r = new Float32Array(D); r.set(P[n].ttl, 0); r.set(P[n].dp, TTLN); return r; });
const mu = mean(X);
const Xc = X.map((r) => addv(r, mu, -1));
let w = new Float32Array(D); for (let j = 0; j < D; j++) w[j] = ((j * 2654435761) % 1000) / 1000 - 0.5;
for (let it = 0; it < 40; it++) { const proj = Xc.map((r) => { let s = 0; for (let j = 0; j < D; j++) s += r[j] * w[j]; return s; }); const nw = new Float32Array(D); for (let i = 0; i < Xc.length; i++) for (let j = 0; j < D; j++) nw[j] += proj[i] * Xc[i][j]; let nrm = 0; for (let j = 0; j < D; j++) nrm += nw[j] * nw[j]; nrm = Math.sqrt(nrm) || 1; for (let j = 0; j < D; j++) w[j] = nw[j] / nrm; }
const projs = Xc.map((r) => { let s = 0; for (let j = 0; j < D; j++) s += r[j] * w[j]; return s; });
const sd = Math.sqrt(projs.reduce((a, p) => a + p * p, 0) / X.length) || 1;
console.log('--- C. PC0 extrapolation from the mean (σ units; current lab caps at ±2σ) ---');
console.log('   σ   |  F0  | peak | ok');
for (const s of [-8, -6, -4, -2, 0, 2, 4, 6, 8]) {
  const ttl = new Float32Array(TTLN), dp = new Float32Array(DPN);
  for (let i = 0; i < TTLN; i++) ttl[i] = mu[i] + s * sd * w[i];
  for (let i = 0; i < DPN; i++) dp[i] = mu[TTLN + i] + s * sd * w[TTLN + i];
  const r = synth(ttl, dp); const v = val(r.samples);
  console.log(String(s).padStart(4), '|', estF0(r.samples, r.sampleRate).toFixed(0).padStart(4), '|', v.peak.toFixed(2), '|', v.bad === 0 && v.peak < 0.99 ? 'y' : 'CLIP/NaN');
}

// ── D. does guidance modulate style range? push masc↔fem hard under each w ────
console.log('--- D. masc↔fem at gain ±2 under guidance {1,3,5} (F0 fem-end → masc-end) ---');
for (const g of [1, 3, 5]) {
  const lo = synth(addv(mid.ttl, axis.ttl, -2 * 0.5), addv(mid.dp, axis.dp, -2 * 0.5), g);
  const hi = synth(addv(mid.ttl, axis.ttl, 2 * 0.5), addv(mid.dp, axis.dp, 2 * 0.5), g);
  const flo = estF0(lo.samples, lo.sampleRate), fhi = estF0(hi.samples, hi.sampleRate);
  console.log('   guidance', g, ':', flo.toFixed(0), '→', fhi.toFixed(0), 'Hz · span', (flo - fhi).toFixed(0),
              '· peaks', val(lo.samples).peak.toFixed(2), '/', val(hi.samples).peak.toFixed(2));
}
console.log('WAVs (masc↔fem extrapolation) in', OUT);
console.log('EXPLORE RANGE DONE');
