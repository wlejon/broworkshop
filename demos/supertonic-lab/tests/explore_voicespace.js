// Exploration: is the Supertonic VoiceStyle space a usable, blendable manifold?
// The 10 presets are 5 female (F*) + 5 male (M*) style-matrix pairs (ttl 50x256,
// dp 8x16). If linear combinations of those matrices decode to valid, smoothly
// varying voices, then the preset palette yields real design axes for free:
//   • blend     — lerp two presets → a continuous voice morph
//   • masc↔fem  — centroid(M) − centroid(F): a labeled bipolar axis from the data
//   • identity  — scale a voice's deviation from the mean (caricature ↔ average)
// This probes all three through supertonic.createVoice() and checks each synthesized
// point is finite + audible, and that motion along the axis is monotone-ish (no
// collapse to silence / blow-up to noise at the interior).
//
// Run: bro-headless ../broworkshop/demos/supertonic-lab \
//        ../broworkshop/demos/supertonic-lab/tests/explore_voicespace.js

const DATA = (typeof process !== 'undefined' && process.env && process.env.BRO_STDATA)
  || 'D:/projects/brosoundml-data/supertonic';
const TEXT = 'The same words, spoken by a voice that slides from one identity to another.';
const SEED = 7;

const OUT = (typeof process !== 'undefined' && process.env && process.env.BRO_STOUT)
  || 'D:/projects/bro/_explore/voicespace';

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
// Alignment-robust identity proxies: autocorrelation F0 (Hz, the dominant
// masc/fem cue) over voiced 40 ms frames, and zero-crossing rate (brightness).
function estF0(s, sr) {
  const frame = (0.04 * sr) | 0, minLag = (sr / 350) | 0, maxLag = (sr / 75) | 0;
  let sum = 0, cnt = 0;
  for (let off = 0; off + maxLag + frame < s.length; off += frame) {
    let e = 0; for (let i = 0; i < frame; i++) e += s[off + i] * s[off + i];
    if (e < 1e-3) continue;
    let bestLag = 0, best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0; for (let i = 0; i < frame; i++) c += s[off + i] * s[off + i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    if (bestLag > 0 && best > 0.3 * e) { sum += sr / bestLag; cnt++; }  // periodicity gate
  }
  return cnt ? sum / cnt : 0;
}
function zcr(s, sr) { let z = 0; for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) z++; return z / (s.length / sr); }

ensureDir(OUT);
const st = bro.tts.loadSupertonic(DATA);
assert(st && st.loaded, 'Supertonic loaded');

// ── load all 10 presets, split F* / M* ──────────────────────────────────────
const names = fs.readdirSync(DATA + '/voice_styles')
  .filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
const presets = {};
for (const n of names) presets[n] = st.loadVoiceStyle(DATA + '/voice_styles/' + n + '.json');
const fem = names.filter((n) => /^f/i.test(n));
const masc = names.filter((n) => /^m/i.test(n));
console.log('PRESETS', names.join(','), '· fem', fem.join(','), '· masc', masc.join(','));

// matrix helpers over plain Float32Arrays
const add = (a, b, k) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + k * b[i]; return o; };
const lerp = (a, b, t) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * (1 - t) + b[i] * t; return o; };
const mean = (arrs) => { const o = new Float32Array(arrs[0].length); for (const a of arrs) for (let i = 0; i < a.length; i++) o[i] += a[i] / arrs.length; return o; };
const l1 = (a, b, n) => { const m = Math.min(a.length, b.length, n || a.length); let d = 0; for (let i = 0; i < m; i++) d += Math.abs(a[i] - b[i]); return d; };
function metrics(s) { let peak = 0, sq = 0; for (let i = 0; i < s.length; i++) { const x = Math.abs(s[i]); if (x > peak) peak = x; sq += s[i] * s[i]; } return { peak, rms: Math.sqrt(sq / s.length) }; }
function synth(voice) { return st.synthesize(TEXT, { voice, language: 'en', steps: 8, speed: 1.05, seed: SEED }); }

// readback round-trips: createVoice(ttl,dp) of a preset's own matrices == preset
const A = presets[fem[0]], B = presets[masc[masc.length - 1]];
const roundtrip = st.createVoice(A.ttl, A.dp, 'rt');
const rRt = synth(roundtrip), rA = synth(A);
console.log('ROUNDTRIP', fem[0], 'recreated · Δ vs original', l1(rRt.samples, rA.samples, 40000).toFixed(3),
            '(expect ~0)');
assert(l1(rRt.samples, rA.samples, 40000) < 1e-2, 'createVoice round-trips a preset bit-for-bit');

const allTakes = [];

// ── blend A(fem) → B(masc): voice should slide; F0 should fall as we go masc ──
console.log('---  blend ' + fem[0] + ' → ' + masc[masc.length - 1] + ' (F0=Hz pitch · zcr=brightness)  ---');
console.log('   t | peak |  rms   |  F0   |  zcr');
for (const t of [0, 0.25, 0.5, 0.75, 1]) {
  const v = st.createVoice(lerp(A.ttl, B.ttl, t), lerp(A.dp, B.dp, t), 'b' + t);
  const r = synth(v), m = metrics(r.samples); allTakes.push(r.samples);
  writeWav(OUT + '/blend_t' + t.toFixed(2) + '.wav', r.samples, r.sampleRate);
  console.log(t.toFixed(2).padStart(4), '|', m.peak.toFixed(2), '|', m.rms.toFixed(4), '|',
              estF0(r.samples, r.sampleRate).toFixed(0).padStart(5), '|', zcr(r.samples, r.sampleRate).toFixed(0).padStart(5));
}

// ── masc↔fem axis: centroid(M) − centroid(F), applied to the neutral midpoint ──
const femC_ttl = mean(fem.map((n) => presets[n].ttl)), femC_dp = mean(fem.map((n) => presets[n].dp));
const mascC_ttl = mean(masc.map((n) => presets[n].ttl)), mascC_dp = mean(masc.map((n) => presets[n].dp));
const axis_ttl = add(mascC_ttl, femC_ttl, -1), axis_dp = add(mascC_dp, femC_dp, -1);  // M − F direction
const mid_ttl = lerp(femC_ttl, mascC_ttl, 0.5), mid_dp = lerp(femC_dp, mascC_dp, 0.5);
console.log('---  masc↔fem axis from neutral midpoint (a<0 → fem, a>0 → masc)  ---');
console.log('   a | peak |  rms   |  F0   |  zcr');
const f0ByA = {};
for (const a of [-1.0, -0.5, 0, 0.5, 1.0]) {
  const v = st.createVoice(add(mid_ttl, axis_ttl, a * 0.5), add(mid_dp, axis_dp, a * 0.5), 'ax' + a);
  const r = synth(v), m = metrics(r.samples); allTakes.push(r.samples);
  const f0 = estF0(r.samples, r.sampleRate); f0ByA[a] = f0;
  writeWav(OUT + '/axis_a' + a.toFixed(2) + '.wav', r.samples, r.sampleRate);
  console.log(a.toFixed(2).padStart(4), '|', m.peak.toFixed(2), '|', m.rms.toFixed(4), '|',
              f0.toFixed(0).padStart(5), '|', zcr(r.samples, r.sampleRate).toFixed(0).padStart(5));
}
// the axis should lower pitch as a goes masc (a=-1 fem-most should be > a=+1 masc-most)
console.log('AXIS F0 fem-end(a-1) ' + f0ByA[-1].toFixed(0) + ' Hz vs masc-end(a+1) ' + f0ByA[1].toFixed(0) +
            ' Hz · Δ ' + (f0ByA[-1] - f0ByA[1]).toFixed(0) + ' Hz (expect fem > masc)');

// ── identity strength: mean + k*(voice − mean). k<1 → toward the average voice,
//    k>1 → caricature. Probe a single preset's deviation scaling stays valid. ──
const meanAll_ttl = mean(names.map((n) => presets[n].ttl)), meanAll_dp = mean(names.map((n) => presets[n].dp));
const scaleAround = (v, mu, k) => { const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = mu[i] + k * (v[i] - mu[i]); return o; };
console.log('---  identity strength on ' + masc[0] + ' (k<1 average · k>1 caricature)  ---');
console.log('   k | peak |  rms   |  F0   |  zcr');
const P = presets[masc[0]];
for (const k of [0.0, 0.5, 1.0, 1.5, 2.0]) {
  const v = st.createVoice(scaleAround(P.ttl, meanAll_ttl, k), scaleAround(P.dp, meanAll_dp, k), 'id' + k);
  const r = synth(v), m = metrics(r.samples); allTakes.push(r.samples);
  writeWav(OUT + '/ident_k' + k.toFixed(1) + '.wav', r.samples, r.sampleRate);
  console.log(k.toFixed(2).padStart(4), '|', m.peak.toFixed(2), '|', m.rms.toFixed(4), '|',
              estF0(r.samples, r.sampleRate).toFixed(0).padStart(5), '|', zcr(r.samples, r.sampleRate).toFixed(0).padStart(5));
}

// validity: every authored take must be finite + audible (no interior collapse)
let bad = 0, quiet = 0;
for (const s of allTakes) {
  const m = metrics(s); if (m.peak < 0.01) quiet++;
  for (let i = 0; i < s.length; i += 64) if (!isFinite(s[i])) { bad++; break; }
}
console.log('VALIDITY · authored takes', allTakes.length, '· nonfinite', bad, '· silent', quiet);
assert(bad === 0, 'all authored voices are finite');
assert(quiet === 0, 'all authored voices are audible (no interior collapse)');
console.log('WAVs written to', OUT);
console.log('EXPLORE VOICESPACE DONE');
