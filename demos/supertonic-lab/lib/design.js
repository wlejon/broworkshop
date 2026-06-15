// ═══ DESIGN — voice axes discovered in the preset style space ════════════════
// A Supertonic voice is two style matrices (ttl 50×256, dp 8×16). The 10 shipped
// presets are 5 female (F*) + 5 male (M*), and that palette is a linear, blendable
// manifold: combinations of the matrices decode to valid, smoothly-varying voices
// (verified — a blend glides F0 188→100 Hz, the centroid(M)−centroid(F) direction
// tracks pitch over a 77 Hz span). Real design axes fall out of the data, no
// adapter training:
//   blend     lerp the base preset toward another → a continuous voice morph.
//   masc↔fem  nudge along centroid(M) − centroid(F), the labeled gender axis.
//   identity  scale the voice's deviation from the global mean (average ↔ caricature).
//   basis     the top principal components of the palette (PCA) as nudge sliders —
//             PC0 ≈ gender/pitch (36% var), lower PCs capture subtler, sometimes
//             gender-independent timbre. The 2D voice map reads the same basis.
// Each axis is applied over the base preset's matrices; designedMatrices() returns
// the combined result, fed to supertonic.createVoice() by model.currentVoice().

import { $ } from "/app/lib/state.js";
import { scheduleLive } from "/app/lib/synth.js";

const TTLN = 50 * 256, DPN = 8 * 16, D = TTLN + DPN;   // 12800 + 128 = 12928
const NONE = '__none__';
const MF_GAIN = 0.5;           // mf=±1 → ±0.5·axis (the verified ~77 Hz span)
const PC_SIGMA = 2;            // basis slider ±1 → ±2σ along the component
const NPC = 3;                 // principal components surfaced as sliders / map

let MATS = {};                 // name -> { ttl: Float32Array, dp: Float32Array }
let NAMES = [];
let MEAN = null;               // { ttl, dp } global mean over all presets
let AXIS = null;               // { ttl, dp } centroid(M) − centroid(F), or null
let COMPS = [];                // [{ w:Float32Array(D), sd, proj:number[], lo, hi }]
let ready = false;

// ── small matrix ops over Float32Arrays ──────────────────────────────────────
const meanKey = (names, key) => {
  const o = new Float32Array(MATS[names[0]][key].length);
  for (const n of names) { const a = MATS[n][key]; for (let i = 0; i < o.length; i++) o[i] += a[i] / names.length; }
  return o;
};
const sub = (a, b) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - b[i]; return o; };
const lerpInto  = (dst, b, t) => { for (let i = 0; i < dst.length; i++) dst[i] = dst[i] * (1 - t) + b[i] * t; };
const addInto   = (dst, b, k) => { for (let i = 0; i < dst.length; i++) dst[i] += k * b[i]; };
const scaleInto = (dst, mu, k) => { for (let i = 0; i < dst.length; i++) dst[i] = mu[i] + k * (dst[i] - mu[i]); };

// Jacobi eigensolver for a small symmetric matrix (n≤16); eigenvectors as columns,
// returned sorted by descending eigenvalue.
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

// PCA over the presets' concatenated [ttl|dp] vectors via the Gram trick.
function computePCA(names) {
  const Nn = names.length;
  const X = names.map((n) => { const r = new Float32Array(D); r.set(MATS[n].ttl, 0); r.set(MATS[n].dp, TTLN); return r; });
  const mu = new Float32Array(D);
  for (const r of X) for (let j = 0; j < D; j++) mu[j] += r[j] / Nn;
  const Xc = X.map((r) => { const o = new Float32Array(D); for (let j = 0; j < D; j++) o[j] = r[j] - mu[j]; return o; });
  const G = Array.from({ length: Nn }, () => new Array(Nn).fill(0));
  for (let i = 0; i < Nn; i++) for (let k = i; k < Nn; k++) { let s = 0; for (let j = 0; j < D; j++) s += Xc[i][j] * Xc[k][j]; G[i][k] = G[k][i] = s; }
  const { val, vec } = jacobiEig(G, Nn);
  COMPS = [];
  for (let k = 0; k < Math.min(NPC, Nn - 1); k++) {
    if (val[k] <= 1e-9) break;
    const u = vec[k], w = new Float32Array(D);
    for (let i = 0; i < Nn; i++) { const ui = u[i], xi = Xc[i]; for (let j = 0; j < D; j++) w[j] += ui * xi[j]; }
    let nrm = 0; for (let j = 0; j < D; j++) nrm += w[j] * w[j]; nrm = Math.sqrt(nrm) || 1;
    for (let j = 0; j < D; j++) w[j] /= nrm;
    const proj = X.map((r) => { let s = 0; for (let j = 0; j < D; j++) s += (r[j] - mu[j]) * w[j]; return s; });
    const sd = Math.sqrt(proj.reduce((a, p) => a + p * p, 0) / Nn) || 1;
    const order = names.map((nm, i) => [nm, proj[i]]).sort((a, b) => a[1] - b[1]);
    COMPS.push({ w, sd, proj, lo: order.slice(0, 2).map((e) => e[0]).join('/'), hi: order.slice(-2).map((e) => e[0]).join('/') });
  }
}

// Called by model.js once the presets' matrices are loaded.
export function initDesign(mats, names) {
  MATS = mats; NAMES = names.slice();
  MEAN = { ttl: meanKey(names, 'ttl'), dp: meanKey(names, 'dp') };
  const fem = names.filter((n) => /^f/i.test(n)), masc = names.filter((n) => /^m/i.test(n));
  AXIS = (fem.length && masc.length)
    ? { ttl: sub(meanKey(masc, 'ttl'), meanKey(fem, 'ttl')), dp: sub(meanKey(masc, 'dp'), meanKey(fem, 'dp')) }
    : null;
  computePCA(names);
  ready = true;

  const sel = $('#d-blend-target');
  sel.textContent = '';
  const none = document.createElement('option'); none.value = NONE; none.textContent = '— none —';
  sel.appendChild(none);
  for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); }
  sel.value = NONE;

  const mf = $('#d-mascfem-dial');
  if (mf) mf.style.display = AXIS ? 'inline-flex' : 'none';

  // label / show the basis sliders by their discovered preset extremes
  for (let k = 0; k < NPC; k++) {
    const dial = $('#pc' + k + '-dial');
    if (!dial) continue;
    if (k < COMPS.length) { dial.style.display = 'inline-flex'; dial.title = 'Principal component ' + k + ' of the palette: ' + COMPS[k].lo + ' ↔ ' + COMPS[k].hi + ' (±2σ at the ends)'; }
    else dial.style.display = 'none';
  }
  resetDesign();
}

export function buildDesign() {
  const dial = (id, fmt) => {
    const sl = $('#' + id), out = $('#v-' + id);
    if (!sl) return;
    const upd = () => { if (out) out.textContent = fmt(parseFloat(sl.value)); updateDesignMeta(); };
    sl.oninput = () => { upd(); scheduleLive(); };
    upd();
  };
  dial('d-mascfem',  (v) => (v === 0 ? '0' : (v > 0 ? '♂ ' : '♀ ') + Math.abs(v).toFixed(2)));
  dial('d-blend-amt', (v) => v.toFixed(2));
  dial('d-identity',  (v) => v.toFixed(2));
  for (let k = 0; k < NPC; k++) dial('pc' + k, (v) => (v === 0 ? '0' : v.toFixed(2)));
  $('#d-blend-target').onchange = () => { updateDesignMeta(); scheduleLive(); };
  $('#d-reset').onclick = () => { resetDesign(); scheduleLive(); };
  updateDesignMeta();
}

function setVal(id, v) { if ($('#' + id)) $('#' + id).value = v; if ($('#v-' + id)) $('#v-' + id).textContent = v; }

export function resetDesign() {
  setVal('d-mascfem', '0'); setVal('d-blend-amt', '0'); setVal('d-identity', '1');
  if ($('#d-blend-target')) $('#d-blend-target').value = NONE;
  if ($('#v-d-mascfem')) $('#v-d-mascfem').textContent = '0';
  if ($('#v-d-blend-amt')) $('#v-d-blend-amt').textContent = '0.00';
  if ($('#v-d-identity')) $('#v-d-identity').textContent = '1.00';
  for (let k = 0; k < NPC; k++) { setVal('pc' + k, '0'); if ($('#v-pc' + k)) $('#v-pc' + k).textContent = '0'; }
  updateDesignMeta();
}

function state() {
  const pcs = [];
  for (let k = 0; k < NPC; k++) pcs.push(parseFloat($('#pc' + k) ? $('#pc' + k).value : '0') || 0);
  return {
    mf:    parseFloat($('#d-mascfem')   ? $('#d-mascfem').value   : '0') || 0,
    tgt:   $('#d-blend-target') ? $('#d-blend-target').value : NONE,
    amt:   parseFloat($('#d-blend-amt') ? $('#d-blend-amt').value : '0') || 0,
    ident: (() => { const v = parseFloat($('#d-identity') ? $('#d-identity').value : '1'); return isFinite(v) ? v : 1; })(),
    pcs,
  };
}

// True when any axis is off its identity default.
export function designActive() {
  if (!ready) return false;
  const s = state();
  return (AXIS && s.mf !== 0) || (s.tgt !== NONE && s.amt > 0) || s.ident !== 1 || s.pcs.some((v) => v !== 0);
}

// Combine the base preset's matrices through every active axis. Returns
// { ttl, dp, label } for supertonic.createVoice(), or null if inactive / unknown.
export function designedMatrices(baseName) {
  if (!ready || !designActive()) return null;
  const base = MATS[baseName];
  if (!base) return null;
  const s = state();
  const ttl = base.ttl.slice(), dp = base.dp.slice();
  let label = baseName;
  if (s.tgt !== NONE && MATS[s.tgt] && s.amt > 0) {
    lerpInto(ttl, MATS[s.tgt].ttl, s.amt); lerpInto(dp, MATS[s.tgt].dp, s.amt);
    label += '+' + Math.round(s.amt * 100) + '%' + s.tgt;
  }
  if (AXIS && s.mf !== 0) {
    addInto(ttl, AXIS.ttl, s.mf * MF_GAIN); addInto(dp, AXIS.dp, s.mf * MF_GAIN);
    label += (s.mf > 0 ? ' ♂' : ' ♀') + Math.abs(s.mf).toFixed(2);
  }
  for (let k = 0; k < s.pcs.length && k < COMPS.length; k++) {
    if (s.pcs[k] === 0) continue;
    const g = s.pcs[k] * PC_SIGMA * COMPS[k].sd, w = COMPS[k].w;
    for (let i = 0; i < TTLN; i++) ttl[i] += g * w[i];
    for (let i = 0; i < DPN; i++) dp[i] += g * w[TTLN + i];
    label += ' pc' + k + (s.pcs[k] > 0 ? '+' : '') + s.pcs[k].toFixed(2);
  }
  if (s.ident !== 1 && MEAN) {
    scaleInto(ttl, MEAN.ttl, s.ident); scaleInto(dp, MEAN.dp, s.ident);
    label += ' id' + s.ident.toFixed(2);
  }
  return { ttl, dp, label };
}

// ── voice-map support (the 2D draggable plane reads PC ax/ay) ─────────────────
// Preset coordinates in σ units on a chosen pair of principal axes, for plotting.
export function basisInfo() {
  if (!ready || COMPS.length < 2) return null;
  return {
    names: NAMES,
    sd: COMPS.map((c) => c.sd),
    ncomp: COMPS.length,
    // proj[name][k] in σ units
    coords: NAMES.map((nm, i) => COMPS.map((c) => c.proj[i] / (c.sd || 1))),
  };
}

// Set the basis sliders directly (the map drags them); ax/ay are σ-unit offsets on
// components cx/cy. Other PCs are left untouched. Clamped to the slider range.
export function setBasis(cx, ax, cy, ay) {
  const clamp = (v) => Math.max(-1, Math.min(1, v / PC_SIGMA));
  if ($('#pc' + cx)) { const v = clamp(ax).toFixed(2); $('#pc' + cx).value = v; if ($('#v-pc' + cx)) $('#v-pc' + cx).textContent = (+v === 0 ? '0' : v); }
  if ($('#pc' + cy)) { const v = clamp(ay).toFixed(2); $('#pc' + cy).value = v; if ($('#v-pc' + cy)) $('#v-pc' + cy).textContent = (+v === 0 ? '0' : v); }
  updateDesignMeta();
}

function updateDesignMeta() {
  const meta = $('#design-meta');
  if (meta) {
    if (!ready) meta.textContent = '';
    else {
      const d = designActive() ? designedMatrices($('#voice-sel').value) : null;
      meta.textContent = d ? ('designed · ' + d.label) : 'preset (design off)';
    }
  }
  try { document.dispatchEvent(new Event('design-update')); } catch (e) {}   // voice map redraws
}
