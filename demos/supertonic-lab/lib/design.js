// ═══ DESIGN — navigate the palette's voice space ═════════════════════════════
// A Supertonic voice is two style matrices (ttl 50×256, dp 8×16). The 10 presets
// (5 female F* + 5 male M*) span a linear, blendable manifold — combinations decode
// to valid, smoothly-varying voices, and the model's usable range is WIDE: PC0
// (the top principal component ≈ gender/pitch) drives F0 cleanly from ~100 to
// ~260 Hz out to ±6σ, well past the raw presets' 119–221 Hz spread. So we navigate
// that space directly:
//   • a 2D voice map over PC0 × PC1 — drag to author a voice by position; the
//     presets are plotted as landmarks (voicemap.js).
//   • a pc2 slider for the next axis (often gender-independent timbre).
//   • identity strength — scale the voice's deviation from the global mean.
// Coordinates are ABSOLUTE σ positions: selecting a preset seats the controls on
// that preset (exact at rest, via the preserved off-axis residual); moving any
// control authors from there. designedMatrices() → supertonic.createVoice().

import { $ } from "/app/lib/state.js";
import { scheduleLive } from "/app/lib/synth.js";

const TTLN = 50 * 256, DPN = 8 * 16, D = TTLN + DPN;
const NPC = 3;                 // controlled components: pc0, pc1 (map) + pc2 (slider)
export const PC_RANGE = 6;     // σ extent of the map / pc2 slider (model stays valid past this)

let MATS = {}, NAMES = [], IDX = {};
let MEAN = null;               // { ttl, dp } global mean
let COMPS = [];                // [{ w:Float32Array(D), sd, projsd:number[] (σ per preset), lo, hi }]
let MAP = [0, 0];              // absolute σ targets for pc0/pc1 (the map drives these)
let ready = false;

// absolute σ target of a controlled component: pc0/pc1 from the map, pc2 from its slider.
function target(k) {
  if (k < 2) return MAP[k] || 0;
  const el = $('#pc' + k);
  return el ? (parseFloat(el.value) || 0) : 0;
}

// ── matrix ops ───────────────────────────────────────────────────────────────
const meanKey = (names, key) => { const o = new Float32Array(MATS[names[0]][key].length); for (const n of names) { const a = MATS[n][key]; for (let i = 0; i < o.length; i++) o[i] += a[i] / names.length; } return o; };
const scaleInto = (dst, mu, k) => { for (let i = 0; i < dst.length; i++) dst[i] = mu[i] + k * (dst[i] - mu[i]); };

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

function computePCA(names) {
  const Nn = names.length;
  const Xr = names.map((n) => { const r = new Float32Array(D); r.set(MATS[n].ttl, 0); r.set(MATS[n].dp, TTLN); return r; });
  const mu = new Float32Array(D); for (const r of Xr) for (let j = 0; j < D; j++) mu[j] += r[j] / Nn;
  const Xc = Xr.map((r) => { const o = new Float32Array(D); for (let j = 0; j < D; j++) o[j] = r[j] - mu[j]; return o; });
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
    const proj = Xc.map((r) => { let s = 0; for (let j = 0; j < D; j++) s += r[j] * w[j]; return s; });
    const sd = Math.sqrt(proj.reduce((a, p) => a + p * p, 0) / Nn) || 1;
    const order = names.map((nm, i) => [nm, proj[i]]).sort((a, b) => a[1] - b[1]);
    COMPS.push({ w, sd, projsd: proj.map((p) => p / sd), lo: order.slice(0, 2).map((e) => e[0]).join('/'), hi: order.slice(-2).map((e) => e[0]).join('/') });
  }
}

// σ baseline of a preset on each controlled component (where it sits in the space).
function baseline(name) {
  const i = IDX[name];
  return COMPS.map((c) => (i != null ? c.projsd[i] : 0));
}

export function initDesign(mats, names) {
  MATS = mats; NAMES = names.slice(); IDX = {}; names.forEach((n, i) => (IDX[n] = i));
  MEAN = { ttl: meanKey(names, 'ttl'), dp: meanKey(names, 'dp') };
  computePCA(names);
  ready = true;
  // pc2 slider visible only if a 3rd component exists; label it by its extremes
  const dial = $('#pc2-dial');
  if (dial) {
    if (COMPS.length > 2) { dial.style.display = 'inline-flex'; dial.title = 'pc2 — the palette\'s 3rd axis: ' + COMPS[2].lo + ' ↔ ' + COMPS[2].hi; }
    else dial.style.display = 'none';
  }
  selectPreset();   // seat the controls on the current voice
}

export function buildDesign() {
  const idSl = $('#d-identity'), idOut = $('#v-d-identity');
  if (idSl) { const upd = () => { if (idOut) idOut.textContent = parseFloat(idSl.value).toFixed(2); emit(); }; idSl.oninput = () => { upd(); scheduleLive(); }; upd(); }
  const pc2 = $('#pc2'), pc2Out = $('#v-pc2');
  if (pc2) { pc2.oninput = () => { if (pc2Out) pc2Out.textContent = (parseFloat(pc2.value) || 0).toFixed(1); emit(); scheduleLive(); }; }
  const rb = $('#d-reset'); if (rb) rb.onclick = () => { resetDesign(); scheduleLive(); };
  emit();
}

// Seat all controls on the selected preset's position (exact preset at rest).
export function selectPreset() {
  if (!ready) return;
  const b = baseline($('#voice-sel') ? $('#voice-sel').value : NAMES[0]);
  MAP = [b[0] || 0, b[1] || 0];
  const pc2 = $('#pc2'); if (pc2) { pc2.value = String(b[2] || 0); if ($('#v-pc2')) $('#v-pc2').textContent = (b[2] || 0).toFixed(1); }
  emit();
}

export function resetDesign() {
  if ($('#d-identity')) $('#d-identity').value = '1';
  if ($('#v-d-identity')) $('#v-d-identity').textContent = '1.00';
  selectPreset();
}

function identity() { const v = parseFloat($('#d-identity') ? $('#d-identity').value : '1'); return isFinite(v) ? v : 1; }

// Active when any control is off the selected preset's baseline.
export function designActive() {
  if (!ready) return false;
  const b = baseline($('#voice-sel') ? $('#voice-sel').value : NAMES[0]);
  if (identity() !== 1) return true;
  for (let k = 0; k < COMPS.length; k++) if (Math.abs(target(k) - (b[k] || 0)) > 1e-3) return true;
  return false;
}

// designed = preset + Σ_k (target_k − baseline_k)·sd_k·w_k  (+ identity), so the
// off-axis residual of the preset is preserved and the controlled PCs move to the
// absolute σ positions the map / pc2 slider express.
export function designedMatrices(name) {
  if (!ready || !designActive()) return null;
  const base = MATS[name]; if (!base) return null;
  const b = baseline(name);
  const ttl = base.ttl.slice(), dp = base.dp.slice();
  let label = name;
  for (let k = 0; k < COMPS.length; k++) {
    const tk = target(k), d = (tk - (b[k] || 0)) * COMPS[k].sd;
    if (Math.abs(d) < 1e-9) continue;
    const w = COMPS[k].w;
    for (let i = 0; i < TTLN; i++) ttl[i] += d * w[i];
    for (let i = 0; i < DPN; i++) dp[i] += d * w[TTLN + i];
    label += ' pc' + k + (tk >= 0 ? '+' : '') + tk.toFixed(1);
  }
  const id = identity();
  if (id !== 1 && MEAN) { scaleInto(ttl, MEAN.ttl, id); scaleInto(dp, MEAN.dp, id); label += ' id' + id.toFixed(2); }
  return { ttl, dp, label };
}

// ── voice-map interface (PC0×PC1 plane, absolute σ) ─────────────────────────
export function basisInfo() {
  if (!ready || COMPS.length < 2) return null;
  return {
    names: NAMES,
    coords: NAMES.map((nm, i) => COMPS.map((c) => c.projsd[i])),   // σ per preset per PC
    pos: [MAP[0] || 0, MAP[1] || 0],                               // current authored position
    range: PC_RANGE,
  };
}
// The map drags the PC0/PC1 absolute targets.
export function setBasis(t0, t1) {
  const cl = (v) => Math.max(-PC_RANGE, Math.min(PC_RANGE, v));
  MAP = [cl(t0), cl(t1)];
  emit();
}

function emit() {
  const meta = $('#design-meta');
  if (meta && ready) { const d = designActive() ? designedMatrices($('#voice-sel').value) : null; meta.textContent = d ? ('designed · ' + d.label) : 'preset (drag the map / move a dial)'; }
  try { document.dispatchEvent(new Event('design-update')); } catch (e) {}
}
