// End-to-end test for the voice designer: drives lib/design.js against the real
// model + the lab's DOM controls. Confirms the designer is inactive at defaults
// (so we synth the raw preset), that each axis activates + produces a finite,
// audible, distinct voice through supertonic.createVoice(), and that reset
// returns to the preset.
//
// Run: bro-headless ../broworkshop/demos/supertonic-lab \
//        ../broworkshop/demos/supertonic-lab/tests/test_design.js

import { $ } from "/app/lib/state.js";
import { initDesign, designActive, designedMatrices, resetDesign, basisInfo, setBasis } from "/app/lib/design.js";

const DATA = (typeof process !== 'undefined' && process.env && process.env.BRO_STDATA)
  || 'D:/projects/brosoundml-data/supertonic';
const TEXT = 'A voice designed from the preset palette.';

const fs = require('fs');
function audible(s) { let p = 0, bad = 0; for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (!isFinite(a)) bad++; if (a > p) p = a; } return { peak: p, bad }; }
function l1(a, b, n) { const m = Math.min(a.length, b.length, n || a.length); let d = 0; for (let i = 0; i < m; i++) d += Math.abs(a[i] - b[i]); return d; }

const st = bro.tts.loadSupertonic(DATA);
assert(st && st.loaded, 'Supertonic loaded');

// load presets → matrices, feed the designer basis
const names = fs.readdirSync(DATA + '/voice_styles')
  .filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
const mats = {}, handles = {};
for (const n of names) { const v = st.loadVoiceStyle(DATA + '/voice_styles/' + n + '.json'); mats[n] = { ttl: v.ttl, dp: v.dp }; handles[n] = v; }
initDesign(mats, names);
const base = names.filter((n) => /^f/i.test(n))[0] || names[0];   // a female preset
const other = names.filter((n) => /^m/i.test(n)).slice(-1)[0] || names[names.length - 1];
console.log('DESIGN basis · presets', names.length, '· base', base, '· blend-target', other);

// reference: the raw preset take
const ref = st.synthesize(TEXT, { voice: handles[base], language: 'en', seed: 7 });
function designedTake() {
  const d = designedMatrices(base);
  assert(d && d.ttl.length === 12800 && d.dp.length === 128, 'designed matrices well-sized');
  const v = st.createVoice(d.ttl, d.dp, d.label);
  return { r: st.synthesize(TEXT, { voice: v, language: 'en', seed: 7 }), label: d.label };
}

// ── defaults → inactive (synth uses the raw preset) ──────────────────────────
resetDesign();
assert(!designActive(), 'designer inactive at defaults');
assert(designedMatrices(base) === null, 'no designed matrices when inactive');

// ── masc↔fem axis activates + shifts the voice ───────────────────────────────
resetDesign(); $('#d-mascfem').value = '0.8';
assert(designActive(), 'masc↔fem activates the designer');
let t = designedTake(); let f = audible(t.r.samples);
console.log('MASCFEM · ' + t.label + ' · peak', f.peak.toFixed(3), '· Δ vs preset', l1(t.r.samples, ref.samples, 40000).toFixed(1));
assert(f.bad === 0 && f.peak > 0.01, 'masc↔fem voice finite + audible');
assert(l1(t.r.samples, ref.samples, 40000) > 1, 'masc↔fem differs from the raw preset');

// ── blend toward another preset ──────────────────────────────────────────────
resetDesign(); $('#d-blend-target').value = other; $('#d-blend-amt').value = '0.5';
assert(designActive(), 'blend activates the designer');
t = designedTake(); f = audible(t.r.samples);
console.log('BLEND · ' + t.label + ' · peak', f.peak.toFixed(3), '· Δ vs preset', l1(t.r.samples, ref.samples, 40000).toFixed(1));
assert(f.bad === 0 && f.peak > 0.01, 'blended voice finite + audible');
assert(l1(t.r.samples, ref.samples, 40000) > 1, 'blend differs from the raw preset');

// ── identity strength ────────────────────────────────────────────────────────
resetDesign(); $('#d-identity').value = '1.6';
assert(designActive(), 'identity activates the designer');
t = designedTake(); f = audible(t.r.samples);
console.log('IDENTITY · ' + t.label + ' · peak', f.peak.toFixed(3), '· Δ vs preset', l1(t.r.samples, ref.samples, 40000).toFixed(1));
assert(f.bad === 0 && f.peak > 0.01, 'identity-scaled voice finite + audible');
assert(l1(t.r.samples, ref.samples, 40000) > 1, 'identity differs from the raw preset');

// ── PCA basis: a component slider activates + shifts the voice ────────────────
resetDesign(); $('#pc0').value = '0.8';
assert(designActive(), 'basis pc0 activates the designer');
t = designedTake(); f = audible(t.r.samples);
console.log('BASIS pc0 · ' + t.label + ' · peak', f.peak.toFixed(3), '· Δ vs preset', l1(t.r.samples, ref.samples, 40000).toFixed(1));
assert(f.bad === 0 && f.peak > 0.01, 'basis voice finite + audible');
assert(l1(t.r.samples, ref.samples, 40000) > 1, 'basis pc0 differs from the raw preset');

// ── voice-map plumbing: basisInfo coords + setBasis drive the same sliders ────
const info = basisInfo();
assert(info && info.ncomp >= 2 && info.coords.length === names.length, 'basisInfo exposes preset coords');
resetDesign(); setBasis(0, 1.5, 1, -1.0);   // σ-unit offsets on PC0/PC1
assert(designActive(), 'setBasis activates the designer');
t = designedTake(); f = audible(t.r.samples);
console.log('MAP setBasis · ' + t.label + ' · peak', f.peak.toFixed(3));
assert(f.bad === 0 && f.peak > 0.01, 'map-set voice finite + audible');

// ── reset returns to the preset ──────────────────────────────────────────────
resetDesign();
assert(!designActive(), 'reset clears the designer');

console.log('ALL DESIGN CHECKS PASSED');
