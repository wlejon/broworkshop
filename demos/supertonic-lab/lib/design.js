// ═══ DESIGN — voice axes discovered in the preset style space ════════════════
// A Supertonic voice is two style matrices (ttl 50×256, dp 8×16). The 10 shipped
// presets are 5 female (F*) + 5 male (M*), and that palette is a linear, blendable
// manifold: combinations of the matrices decode to valid, smoothly-varying voices
// (verified — a blend glides F0 188→100 Hz, the centroid(M)−centroid(F) direction
// tracks pitch over a 77 Hz span). So three real design axes fall out of the data,
// no adapter training:
//   blend     lerp the base preset toward another → a continuous voice morph.
//   masc↔fem  nudge along centroid(M) − centroid(F), the labeled gender axis.
//   identity  scale the voice's deviation from the global mean — k<1 averages it
//             toward a neutral voice, k>1 caricatures it.
// Each is applied over the base preset's matrices; designedMatrices() returns the
// combined result, and model.currentVoice() feeds it to supertonic.createVoice().

import { $ } from "/app/lib/state.js";
import { scheduleLive } from "/app/lib/synth.js";

let MATS = {};                 // name -> { ttl: Float32Array, dp: Float32Array }
let MEAN = null;               // { ttl, dp } global mean over all presets
let AXIS = null;               // { ttl, dp } centroid(M) − centroid(F), or null
let ready = false;

const NONE = '__none__';
const MF_GAIN = 0.5;           // mf=±1 → ±0.5·axis (the verified ~77 Hz span)

// ── small in-place matrix ops over Float32Arrays ─────────────────────────────
const meanOf = (names, key) => {
  const o = new Float32Array(MATS[names[0]][key].length);
  for (const n of names) { const a = MATS[n][key]; for (let i = 0; i < o.length; i++) o[i] += a[i] / names.length; }
  return o;
};
const sub = (a, b) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - b[i]; return o; };
const lerpInto  = (dst, b, t) => { for (let i = 0; i < dst.length; i++) dst[i] = dst[i] * (1 - t) + b[i] * t; };
const addInto   = (dst, b, k) => { for (let i = 0; i < dst.length; i++) dst[i] += k * b[i]; };
const scaleInto = (dst, mu, k) => { for (let i = 0; i < dst.length; i++) dst[i] = mu[i] + k * (dst[i] - mu[i]); };

// Called by model.js once the presets' matrices are loaded. Computes the basis
// and (re)populates the blend-target picker.
export function initDesign(mats, names) {
  MATS = mats;
  MEAN = { ttl: meanOf(names, 'ttl'), dp: meanOf(names, 'dp') };
  const fem = names.filter((n) => /^f/i.test(n)), masc = names.filter((n) => /^m/i.test(n));
  AXIS = (fem.length && masc.length)
    ? { ttl: sub(meanOf(masc, 'ttl'), meanOf(fem, 'ttl')), dp: sub(meanOf(masc, 'dp'), meanOf(fem, 'dp')) }
    : null;
  ready = true;

  // blend-target picker: '— none —' + every preset
  const sel = $('#d-blend-target');
  sel.textContent = '';
  const none = document.createElement('option'); none.value = NONE; none.textContent = '— none —';
  sel.appendChild(none);
  for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); }
  sel.value = NONE;

  // the masc↔fem dial only makes sense when the palette is labeled F*/M*
  const mf = $('#d-mascfem-dial');
  if (mf) mf.style.display = AXIS ? 'inline-flex' : 'none';
  updateDesignMeta();
}

export function buildDesign() {
  const dial = (id, fmt) => {
    const sl = $('#' + id), out = $('#v-' + id);
    const upd = () => { if (out) out.textContent = fmt(parseFloat(sl.value)); updateDesignMeta(); };
    sl.oninput = () => { upd(); scheduleLive(); };
    upd();
  };
  dial('d-mascfem',  (v) => (v === 0 ? '0' : (v > 0 ? '♂ ' : '♀ ') + Math.abs(v).toFixed(2)));
  dial('d-blend-amt', (v) => v.toFixed(2));
  dial('d-identity',  (v) => v.toFixed(2));
  $('#d-blend-target').onchange = () => { updateDesignMeta(); scheduleLive(); };
  $('#d-reset').onclick = () => { resetDesign(); scheduleLive(); };
  updateDesignMeta();
}

export function resetDesign() {
  if ($('#d-mascfem'))   $('#d-mascfem').value = '0';
  if ($('#d-blend-amt')) $('#d-blend-amt').value = '0';
  if ($('#d-identity'))  $('#d-identity').value = '1';
  if ($('#d-blend-target')) $('#d-blend-target').value = NONE;
  if ($('#v-d-mascfem'))  $('#v-d-mascfem').textContent = '0';
  if ($('#v-d-blend-amt')) $('#v-d-blend-amt').textContent = '0.00';
  if ($('#v-d-identity'))  $('#v-d-identity').textContent = '1.00';
  updateDesignMeta();
}

function state() {
  return {
    mf:    parseFloat($('#d-mascfem')   ? $('#d-mascfem').value   : '0') || 0,
    tgt:   $('#d-blend-target') ? $('#d-blend-target').value : NONE,
    amt:   parseFloat($('#d-blend-amt') ? $('#d-blend-amt').value : '0') || 0,
    ident: (() => { const v = parseFloat($('#d-identity') ? $('#d-identity').value : '1'); return isFinite(v) ? v : 1; })(),
  };
}

// True when any axis is off its identity default (so currentVoice authors a voice).
export function designActive() {
  if (!ready) return false;
  const s = state();
  return (AXIS && s.mf !== 0) || (s.tgt !== NONE && s.amt > 0) || s.ident !== 1;
}

// Combine the base preset's matrices through the active axes. Returns
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
  if (s.ident !== 1 && MEAN) {
    scaleInto(ttl, MEAN.ttl, s.ident); scaleInto(dp, MEAN.dp, s.ident);
    label += ' id' + s.ident.toFixed(2);
  }
  return { ttl, dp, label };
}

function updateDesignMeta() {
  const meta = $('#design-meta'); if (!meta) return;
  if (!ready) { meta.textContent = ''; return; }
  const d = designActive() ? designedMatrices($('#voice-sel').value) : null;
  meta.textContent = d ? ('designed · ' + d.label) : 'preset (design off)';
}
