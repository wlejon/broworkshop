// Headless smoke for the Supertonic binding + lab. Drives the real runtime via
// the SYNC library API (supertonic.synthesize) — headless can't pace the async
// event loop for a static app, but the windowed lab's async bro.tts.synthesize
// runs the same C++ path, so this exercises the engine capability the lab needs.
//
// Run:  bro-headless ../broworkshop/demos/supertonic-lab tests/test_smoke.js
//       (set BRO_STDATA to override the converted-model dir)

import { renderWave } from "/app/lib/render.js";
import { $ } from "/app/lib/state.js";

const DATA = (typeof process !== 'undefined' && process.env && process.env.BRO_STDATA)
  || 'D:/projects/brosoundml-data/supertonic';
const TEXT = 'Hello there. This is a test of the Supertonic pipeline.';

function finite(r) {
  let peak = 0, bad = 0;
  for (let i = 0; i < r.samples.length; i++) {
    const a = Math.abs(r.samples[i]); if (!isFinite(a)) bad++; if (a > peak) peak = a;
  }
  return { peak, bad };
}
function diff(a, b, n) {
  let d = 0; const m = Math.min(a.length, b.length, n || a.length);
  for (let i = 0; i < m; i++) d += Math.abs(a[i] - b[i]);
  return d;
}

// ── load ─────────────────────────────────────────────────────────────────────
const st = bro.tts.loadSupertonic(DATA);
assert(st && st.loaded, 'Supertonic loaded');
console.log('LOADED · sampleRate', st.sampleRate);
assert(st.sampleRate === 44100, '44.1 kHz output');

// ── voice presets ──────────────────────────────────────────────────────────
const fs = require('fs');
const names = fs.readdirSync(DATA + '/voice_styles')
  .filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
console.log('VOICES ·', names.length, '·', names.join(','));
assert(names.length >= 2, 'at least two voice presets');
const vA = st.loadVoiceStyle(DATA + '/voice_styles/' + names[0] + '.json');
const vB = st.loadVoiceStyle(DATA + '/voice_styles/' + names[names.length - 1] + '.json');
assert(vA && vA.name === names[0], 'voice handle carries its name');

// ── synthesis: finite + audible ──────────────────────────────────────────────
const r = st.synthesize(TEXT, { voice: vA, language: 'en', steps: 8, speed: 1.05, seed: 0 });
const f = finite(r);
console.log('SYNTH ·', f.peak.toFixed(3), 'peak ·',
            (r.samples.length / r.sampleRate).toFixed(2) + 's · sr', r.sampleRate);
assert(f.bad === 0 && f.peak > 0.01, 'audio finite + audible');
assert(r.samples.length > 44100 * 0.5, 'at least half a second of audio');

// ── determinism: same seed → identical; different seed → different ───────────
const r0 = st.synthesize(TEXT, { voice: vA, language: 'en', seed: 7 });
const r0b = st.synthesize(TEXT, { voice: vA, language: 'en', seed: 7 });
const r1 = st.synthesize(TEXT, { voice: vA, language: 'en', seed: 8 });
console.log('SEED · same', diff(r0.samples, r0b.samples, 40000).toFixed(4),
            '· diff', diff(r0.samples, r1.samples, 40000).toFixed(1));
assert(diff(r0.samples, r0b.samples, 40000) < 1e-3, 'same seed reproducible');
assert(diff(r0.samples, r1.samples, 40000) > 1, 'different seed → different take');

// ── voice changes the take ────────────────────────────────────────────────────
const rB = st.synthesize(TEXT, { voice: vB, language: 'en', seed: 7 });
console.log('VOICE · ' + names[0] + '↔' + names[names.length - 1] + ' Δ',
            diff(r0.samples, rB.samples, 40000).toFixed(1));
assert(diff(r0.samples, rB.samples, 40000) > 1, 'different voice → different audio');

// ── steps change the latent (audible) ────────────────────────────────────────
const rS = st.synthesize(TEXT, { voice: vA, language: 'en', seed: 7, steps: 16 });
console.log('STEPS · 8↔16 Δ', diff(r0.samples, rS.samples, 40000).toFixed(1));
assert(diff(r0.samples, rS.samples, 40000) > 0.1, 'step count affects the take');

// ── long-form: a paragraph splits + concatenates longer than one sentence ────
const PARA = 'The morning was bright. Birds sang in the trees. A gentle breeze moved through the valley.';
const rL = st.synthesize(PARA, { voice: vA, language: 'en', longForm: true, gapSeconds: 0.3 });
const fL = finite(rL);
console.log('LONGFORM ·', (rL.samples.length / rL.sampleRate).toFixed(2) + 's · peak', fL.peak.toFixed(3));
assert(fL.bad === 0 && fL.peak > 0.01, 'long-form audio finite + audible');
assert(rL.samples.length > r.samples.length, 'long-form paragraph longer than one sentence');

// ── bad voice rejected, not silently misread ─────────────────────────────────
let threw = false;
try { st.synthesize(TEXT, { language: 'en' }); } catch (e) { threw = true; }
assert(threw, 'missing voice rejected');

// ── UI: the waveform card draws into #stages ─────────────────────────────────
renderWave(r.samples, r.sampleRate);
flush();
const cards = $('#stages').children.length;
console.log('UI · #stages cards', cards);
assert(cards >= 1, 'waveform card drawn');
screenshot('_ui.png');

console.log('ALL SUPERTONIC SMOKE CHECKS PASSED');
