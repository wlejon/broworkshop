// Visual + plumbing check for the voice map. Sync-loads the model, feeds the
// designer basis, builds the map, drives setBasis through it, and screenshots the
// populated plane (the async windowed load can't be pumped headless, so we wire
// the basis by hand the way model.loadModel would).
//
// Run: bro-headless ../broworkshop/demos/supertonic-lab \
//        ../broworkshop/demos/supertonic-lab/tests/test_voicemap.js

import { $ } from "/app/lib/state.js";
import { initDesign, basisInfo, selectPreset } from "/app/lib/design.js";
import { buildVoiceMap, draw } from "/app/lib/voicemap.js";

const DATA = (typeof process !== 'undefined' && process.env && process.env.BRO_STDATA)
  || 'D:/projects/brosoundml-data/supertonic';
const fs = require('fs');

const st = bro.tts.loadSupertonic(DATA);
assert(st && st.loaded, 'Supertonic loaded');
const names = fs.readdirSync(DATA + '/voice_styles')
  .filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
const mats = {};
for (const n of names) { const v = st.loadVoiceStyle(DATA + '/voice_styles/' + n + '.json'); mats[n] = { ttl: v.ttl, dp: v.dp }; }
initDesign(mats, names); selectPreset();

buildVoiceMap();
const info = basisInfo();
assert(info && info.coords.length === names.length, 'basisInfo populated for the map');
console.log('MAP · presets plotted', info.coords.length, '· range ±' + info.range + 'σ · pc0 span',
  Math.min(...info.coords.map((c) => c[0])).toFixed(2), '→', Math.max(...info.coords.map((c) => c[0])).toFixed(2));

draw();
flush();
const cv = $('#voicemap');
assert(cv && cv.width === 440 && cv.height === 300, 'voicemap canvas present');
try { screenshot('D:/projects/bro/_explore/lab_voicemap.png'); } catch (e) { console.log('(screenshot skipped: ' + e.message + ')'); }
console.log('VOICEMAP RENDER OK');
