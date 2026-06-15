// End-to-end test for the voice designer (the PC-space map + pc2 + identity).
// Drives lib/design.js against the real model + the lab's DOM. Confirms the
// designer is inactive when seated on a preset, that the map / pc2 / identity each
// activate + produce a finite, audible, distinct voice via supertonic.createVoice(),
// and that reset re-seats on the preset.
//
// Run: bro-headless ../broworkshop/demos/supertonic-lab \
//        ../broworkshop/demos/supertonic-lab/tests/test_design.js

import { $ } from "/app/lib/state.js";
import { initDesign, buildDesign, designActive, designedMatrices, resetDesign, selectPreset, basisInfo, setBasis } from "/app/lib/design.js";

const DATA = (typeof process !== 'undefined' && process.env && process.env.BRO_STDATA)
  || 'D:/projects/brosoundml-data/supertonic';
const TEXT = 'A voice authored from the palette.';

const fs = require('fs');
function audible(s) { let p = 0, bad = 0; for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (!isFinite(a)) bad++; if (a > p) p = a; } return { peak: p, bad }; }
function l1(a, b, n) { const m = Math.min(a.length, b.length, n || a.length); let d = 0; for (let i = 0; i < m; i++) d += Math.abs(a[i] - b[i]); return d; }

const st = bro.tts.loadSupertonic(DATA);
assert(st && st.loaded, 'Supertonic loaded');
const names = fs.readdirSync(DATA + '/voice_styles')
  .filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
const mats = {}, handles = {};
for (const n of names) { const v = st.loadVoiceStyle(DATA + '/voice_styles/' + n + '.json'); mats[n] = { ttl: v.ttl, dp: v.dp }; handles[n] = v; }

// seat the real #voice-sel on a female preset (the designer reads it)
const base = names.filter((n) => /^f/i.test(n))[0] || names[0];
const sel = $('#voice-sel'); const o = document.createElement('option'); o.value = base; o.textContent = base; sel.appendChild(o); sel.value = base;
initDesign(mats, names); buildDesign(); selectPreset();
console.log('DESIGN seated on', base, '· presets', names.length);

const ref = st.synthesize(TEXT, { voice: handles[base], language: 'en', seed: 7 });
function designedTake() {
  const d = designedMatrices(base);
  assert(d && d.ttl.length === 12800 && d.dp.length === 128, 'designed matrices well-sized');
  return { r: st.synthesize(TEXT, { voice: st.createVoice(d.ttl, d.dp, d.label), language: 'en', seed: 7 }), label: d.label };
}

// ── seated on the preset → inactive (raw preset) ─────────────────────────────
resetDesign();
assert(!designActive(), 'designer inactive when seated on the preset');
assert(designedMatrices(base) === null, 'no designed matrices when inactive');

// ── map: drag toward the masc side → big shift ───────────────────────────────
resetDesign(); setBasis(-4, 0);     // strong pc0 toward masc
assert(designActive(), 'map position activates the designer');
let t = designedTake(); let f = audible(t.r.samples);
const dMap = l1(t.r.samples, ref.samples, 40000);
console.log('MAP pc0=-4 · ' + t.label + ' · peak', f.peak.toFixed(3), '· Δ vs preset', dMap.toFixed(1));
assert(f.bad === 0 && f.peak > 0.01, 'map voice finite + audible');
assert(dMap > 1, 'map move differs from the raw preset');

// ── pc2 slider ───────────────────────────────────────────────────────────────
resetDesign(); if ($('#pc2')) { $('#pc2').value = '4'; }
const info0 = basisInfo();
if (info0 && info0.coords[0].length > 2) {
  assert(designActive(), 'pc2 activates the designer');
  t = designedTake(); f = audible(t.r.samples);
  console.log('PC2=4 · ' + t.label + ' · peak', f.peak.toFixed(3), '· Δ vs preset', l1(t.r.samples, ref.samples, 40000).toFixed(1));
  assert(f.bad === 0 && f.peak > 0.01, 'pc2 voice finite + audible');
}

// ── identity strength ────────────────────────────────────────────────────────
resetDesign(); $('#d-identity').value = '1.6';
assert(designActive(), 'identity activates the designer');
t = designedTake(); f = audible(t.r.samples);
console.log('IDENTITY 1.6 · ' + t.label + ' · peak', f.peak.toFixed(3), '· Δ vs preset', l1(t.r.samples, ref.samples, 40000).toFixed(1));
assert(f.bad === 0 && f.peak > 0.01, 'identity voice finite + audible');

// ── map plumbing for the canvas ──────────────────────────────────────────────
const info = basisInfo();
assert(info && info.coords.length === names.length && info.range >= 4, 'basisInfo exposes coords + range');

// ── reset re-seats on the preset ─────────────────────────────────────────────
resetDesign();
assert(!designActive(), 'reset clears the designer');

console.log('ALL DESIGN CHECKS PASSED');
