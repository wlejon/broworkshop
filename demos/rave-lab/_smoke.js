// Headless smoke for RAVE Lab — drives the app's own globals (the lib/ modules
// share one scope) through the full encode → edit → decode loop.
// Run (GPU) against the app dir, pointing at a converted RAVE model:
//   RAVE_DIR=/tmp/rave/out_z8  bro-headless ../broworkshop/demos/rave-lab _smoke.js
// (from the bro repo root; paths differ per platform — see CLAUDE.md)

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); }
  return pred();
}

const RAVE_DIR = (typeof process !== 'undefined' && process.env && process.env.RAVE_DIR)
  ? process.env.RAVE_DIR : '/tmp/rave/out_z8';

// ── 1. load the model ────────────────────────────────────────────────────────
$('#model-dir').value = RAVE_DIR;
loadModel(RAVE_DIR);
assert(pumpUntil(() => rave || $('#backend').classList.contains('err'), 120000), 'model load finished');
assert(!$('#backend').classList.contains('err'), 'model loaded without error: ' + $('#backend').textContent);
assert(rave && rave.loaded, 'rave handle is loaded');
console.log(`model: sr=${rave.sampleRate} nLatent=${rave.nLatent} nBand=${rave.nBand} ratio=${rave.totalRatio}`);

// ── 2. make a tone → encode → decode ─────────────────────────────────────────
$('#tone-freq').value = '220';
$('#tone-secs').value = '1.0';
$('#tone-kind').value = 'harm';
$('#autoplay').checked = false;
makeTone();
assert(pumpUntil(() => enc && lastOut, 30000), 'encode + initial decode finished');
assert(enc.nLatent === rave.nLatent, 'enc nLatent matches handle');
assert(enc.frames > 0, 'encode produced frames: ' + enc.frames);
assert(work.length === enc.nLatent * enc.frames, 'work latent grid size');
assert(curveCells.length === enc.nLatent, 'a curve cell per latent dim');
assert(lastOut.length === enc.frames * rave.totalRatio, 'decode length matches frames*ratio');
let peak0 = 0; for (let i = 0; i < lastOut.length; i++) { const a = Math.abs(lastOut[i]); if (a > peak0) peak0 = a; }
assert(peak0 > 0, 'initial decode is non-silent: peak=' + peak0);
console.log(`encode: ${enc.nLatent} x ${enc.frames}  decode peak=${peak0.toFixed(4)}`);

// ── 3. edit dim 0 (loudness) and re-decode — output must change ──────────────
const before = Float32Array.from(lastOut);
opNudge(0, 1.5);              // boost the whole loudness curve
redrawDim(0);
runDecode(false);
assert(pumpUntil(() => !busy, 30000), 'edit decode finished');
let diff = 0; for (let i = 0; i < lastOut.length; i++) diff += Math.abs(lastOut[i] - before[i]);
assert(diff > 0, 'editing a latent curve changed the output (Δ=' + diff.toFixed(2) + ')');
console.log(`morph: total abs delta=${diff.toFixed(2)}`);

// ── 4. freehand-paint dim 1 via the drag path ────────────────────────────────
const cell = curveCells[1];
const r = cell.cv.getBoundingClientRect();
activePaint = { cv: cell.cv, c: 1, mn: dimRanges[1][0], mx: dimRanges[1][1],
                W: cell.cv.width, H: cell.cv.height, pad: 6, lastI: -1, lastV: 0 };
paintAt({ clientX: r.left + r.width * 0.1, clientY: r.top + r.height * 0.2 });
paintAt({ clientX: r.left + r.width * 0.9, clientY: r.top + r.height * 0.8 });
onPaintUp();
assert(pumpUntil(() => !busy, 30000), 'paint decode finished');
console.log('paint dim 1: ok');

// ── 5. reset all restores the encoded latent ─────────────────────────────────
resetAll();
let resErr = 0; for (let i = 0; i < work.length; i++) resErr += Math.abs(work[i] - enc.latent[i]);
assert(resErr === 0, 'reset all restored the encoded latent exactly');
console.log('reset: ok');

// ── 6. noise branch: addNoise changes the output; seed makes it reproducible ──
const det = rave.decode(enc.latent, enc.frames);
const n1  = rave.decode(enc.latent, enc.frames, { addNoise: true, seed: 7 });
const n2  = rave.decode(enc.latent, enc.frames, { addNoise: true, seed: 7 });
let dNoise = 0, dSeed = 0;
for (let i = 0; i < det.samples.length; i++) {
  dNoise += Math.abs(n1.samples[i] - det.samples[i]);
  dSeed  += Math.abs(n1.samples[i] - n2.samples[i]);
}
assert(dNoise > 0, 'addNoise changes the output vs deterministic');
assert(dSeed === 0, 'same seed reproduces the same noisy output');
console.log(`noise: Δvs-det=${dNoise.toFixed(2)}  seed-repro=${dSeed === 0}`);

console.log('rave-lab smoke: PASS');
