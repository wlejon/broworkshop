// Exploration: what principal axes of voice variation does the preset palette
// contain? PCA over the 10 presets' concatenated style vectors [ttl|dp] (12928
// dims, 10 samples) via the Gram trick (10×10 eigendecomposition). For each top
// component we report variance explained, where each preset lands on it (the F*/M*
// split), and — by synthesizing the mean voice pushed ±2σ along the component —
// the F0 / brightness it controls. That tells us which discoverable axes are worth
// exposing as sliders (a Kokoro-style voice basis), beyond the hand-labeled
// masc↔fem direction.
//
// Run: bro-headless ../broworkshop/demos/supertonic-lab \
//        ../broworkshop/demos/supertonic-lab/tests/explore_pca.js

const DATA = (typeof process !== 'undefined' && process.env && process.env.BRO_STDATA)
  || 'D:/projects/brosoundml-data/supertonic';
const OUT = (typeof process !== 'undefined' && process.env && process.env.BRO_STOUT)
  || 'D:/projects/bro/_explore/pca';
const TEXT = 'A voice moved along a principal axis of the palette.';
const TTLN = 50 * 256, DPN = 8 * 16, D = TTLN + DPN;   // 12800 + 128 = 12928

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
function zcr(s, sr) { let z = 0; for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) z++; return z / (s.length / sr); }

// Jacobi eigensolver for a small symmetric matrix (n≤16). Returns {val, vec} with
// vec[k] the k-th eigenvector (columns), sorted by descending eigenvalue.
function jacobiEig(Ain, n) {
  const A = Ain.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-20) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let i = 0; i < n; i++) { const aip = A[i][p], aiq = A[i][q]; A[i][p] = c * aip - s * aiq; A[i][q] = s * aip + c * aiq; }
      for (let i = 0; i < n; i++) { const api = A[p][i], aqi = A[q][i]; A[p][i] = c * api - s * aqi; A[q][i] = s * api + c * aqi; }
      for (let i = 0; i < n; i++) { const vip = V[i][p], viq = V[i][q]; V[i][p] = c * vip - s * viq; V[i][q] = s * vip + c * viq; }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[b][b] - A[a][a]);
  return { val: idx.map((i) => A[i][i]), vec: idx.map((i) => V.map((row) => row[i])) };
}

ensureDir(OUT);
const st = bro.tts.loadSupertonic(DATA);
assert(st && st.loaded, 'Supertonic loaded');

// ── build the 10×D centered data matrix from [ttl|dp] per preset ─────────────
const names = fs.readdirSync(DATA + '/voice_styles')
  .filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
const N = names.length;
const X = [];   // N × D
for (const n of names) {
  const v = st.loadVoiceStyle(DATA + '/voice_styles/' + n + '.json');
  const row = new Float32Array(D);
  row.set(v.ttl, 0); row.set(v.dp, TTLN);
  X.push(row);
}
const mean = new Float32Array(D);
for (const r of X) for (let j = 0; j < D; j++) mean[j] += r[j] / N;
const Xc = X.map((r) => { const o = new Float32Array(D); for (let j = 0; j < D; j++) o[j] = r[j] - mean[j]; return o; });

// Gram G = Xc Xcᵀ (N×N), eigendecompose, lift to feature-space components.
const G = Array.from({ length: N }, () => new Array(N).fill(0));
for (let i = 0; i < N; i++) for (let k = i; k < N; k++) { let s = 0; for (let j = 0; j < D; j++) s += Xc[i][j] * Xc[k][j]; G[i][k] = G[k][i] = s; }
const { val, vec } = jacobiEig(G, N);
const totVar = val.reduce((a, b) => a + Math.max(0, b), 0);

// component direction w_k = Xcᵀ u_k, normalized; projections c_i = Xc_i · w_k.
function component(k) {
  const u = vec[k];
  const w = new Float32Array(D);
  for (let i = 0; i < N; i++) { const ui = u[i]; const xi = Xc[i]; for (let j = 0; j < D; j++) w[j] += ui * xi[j]; }
  let nrm = 0; for (let j = 0; j < D; j++) nrm += w[j] * w[j]; nrm = Math.sqrt(nrm) || 1;
  for (let j = 0; j < D; j++) w[j] /= nrm;
  const proj = X.map((r) => { let s = 0; for (let j = 0; j < D; j++) s += (r[j] - mean[j]) * w[j]; return s; });
  return { w, proj };
}
function synthAt(vec12928, label) {
  const ttl = vec12928.slice(0, TTLN), dp = vec12928.slice(TTLN, D);
  const v = st.createVoice(ttl, dp, label);
  return st.synthesize(TEXT, { voice: v, language: 'en', seed: 7 });
}

console.log('PCA over', N, 'presets ·', names.join(','));
console.log('   PC | var% | preset projections (sorted)            | −2σ→+2σ  F0    zcr');
const K = Math.min(5, N - 1);
for (let k = 0; k < K; k++) {
  const { w, proj } = component(k);
  const varpct = 100 * Math.max(0, val[k]) / totVar;
  const sd = Math.sqrt(proj.reduce((a, p) => a + p * p, 0) / N) || 1;
  // who's at the extremes of this axis
  const order = names.map((nm, i) => [nm, proj[i]]).sort((a, b) => a[1] - b[1]);
  const lo = order.slice(0, 2).map((e) => e[0]).join('/'), hi = order.slice(-2).map((e) => e[0]).join('/');
  // synthesize mean ± 2σ along the component, measure F0/zcr each end
  const vlo = new Float32Array(D), vhi = new Float32Array(D);
  for (let j = 0; j < D; j++) { vlo[j] = mean[j] - 2 * sd * w[j]; vhi[j] = mean[j] + 2 * sd * w[j]; }
  const rlo = synthAt(vlo, 'pc' + k + '-'), rhi = synthAt(vhi, 'pc' + k + '+');
  writeWav(OUT + '/pc' + k + '_lo.wav', rlo.samples, rlo.sampleRate);
  writeWav(OUT + '/pc' + k + '_hi.wav', rhi.samples, rhi.sampleRate);
  const f0lo = estF0(rlo.samples, rlo.sampleRate), f0hi = estF0(rhi.samples, rhi.sampleRate);
  const zlo = zcr(rlo.samples, rlo.sampleRate), zhi = zcr(rhi.samples, rhi.sampleRate);
  console.log('  PC' + k, '|', varpct.toFixed(0).padStart(3) + '%', '| −', lo.padEnd(7), '→ +', hi.padEnd(7),
              '| F0', f0lo.toFixed(0) + '→' + f0hi.toFixed(0), '· zcr', zlo.toFixed(0) + '→' + zhi.toFixed(0));
}
console.log('CUMVAR top', K, ':', (100 * val.slice(0, K).reduce((a, b) => a + Math.max(0, b), 0) / totVar).toFixed(0) + '%');
console.log('WAVs written to', OUT);
console.log('EXPLORE PCA DONE');
