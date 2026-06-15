// Exploration: is the flow-matching CFG guidance scale an audibly compelling,
// well-behaved control? Sweeps guidance (the w in field = (1+w)cond - w*uncond)
// at a fixed text/voice/seed and characterizes each take — duration (should be
// ~constant; guidance shapes timbre, not length), loudness (RMS), brightness
// (zero-crossing rate, a cheap consonant-energy proxy), and how different each
// take is from the w=3 upstream default. Writes a WAV per setting so the result
// is listenable, not just numeric.
//
// Run: bro-headless ../broworkshop/demos/supertonic-lab \
//        ../broworkshop/demos/supertonic-lab/tests/explore_guidance.js

const DATA = (typeof process !== 'undefined' && process.env && process.env.BRO_STDATA)
  || 'D:/projects/brosoundml-data/supertonic';
const OUT  = (typeof process !== 'undefined' && process.env && process.env.BRO_STOUT)
  || 'D:/projects/bro/_explore/guidance';
const TEXT = 'The signal grew sharper as the guidance climbed, then softened again.';
const SEED = 7;
const GUID = [0, 1, 2, 3, 4, 6, 8, 12];

const fs = require('fs');
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }

function writeWav(path, samples, sr) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  fs.writeFileSync(path, new Uint8Array(buf));
}

// metrics: peak, rms, zero-crossing rate (per second), and L1 diff vs a reference
function metrics(s) {
  let peak = 0, sq = 0, zc = 0;
  for (let i = 0; i < s.length; i++) {
    const a = Math.abs(s[i]); if (a > peak) peak = a; sq += s[i] * s[i];
    if (i > 0 && ((s[i - 1] < 0) !== (s[i] < 0))) zc++;
  }
  return { peak, rms: Math.sqrt(sq / s.length), zc };
}
function l1(a, b, n) {
  const m = Math.min(a.length, b.length, n || a.length); let d = 0;
  for (let i = 0; i < m; i++) d += Math.abs(a[i] - b[i]);
  return d;
}

ensureDir(OUT);
const st = bro.tts.loadSupertonic(DATA);
assert(st && st.loaded, 'Supertonic loaded');
const vNames = fs.readdirSync(DATA + '/voice_styles')
  .filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
const voice = st.loadVoiceStyle(DATA + '/voice_styles/' + vNames[0] + '.json');
console.log('VOICE', vNames[0], '· text len', TEXT.length, '· seed', SEED);

const takes = {};
for (const g of GUID) {
  const r = st.synthesize(TEXT, { voice, language: 'en', steps: 8, speed: 1.05, seed: SEED, guidance: g });
  takes[g] = r.samples;
  writeWav(OUT + '/g' + String(g).padStart(2, '0') + '.wav', r.samples, r.sampleRate);
}

// reference = upstream default w=3; report everything relative to it
const ref = takes[3];
const refDur = ref.length / 44100;
console.log('---  guidance sweep (text/voice/seed fixed; ref = w3 upstream)  ---');
console.log('   w |  dur(s) | peak |   rms  | zcr/s  | Δsamples_per_s_vs_w3');
for (const g of GUID) {
  const s = takes[g], m = metrics(s), dur = s.length / 44100;
  const zcr = m.zc / dur;
  const dPerS = (g === 3) ? 0 : l1(s, ref, Math.min(s.length, ref.length)) / Math.min(dur, refDur);
  console.log(
    String(g).padStart(4), '|',
    dur.toFixed(2).padStart(6), '|',
    m.peak.toFixed(2), '|',
    m.rms.toFixed(4), '|',
    zcr.toFixed(0).padStart(6), '|',
    dPerS.toFixed(1));
}

// is the control monotone-ish & well-behaved? flag any NaN/clip or length drift.
let bad = 0, durMin = 1e9, durMax = 0;
for (const g of GUID) {
  const s = takes[g], m = metrics(s), dur = s.length / 44100;
  durMin = Math.min(durMin, dur); durMax = Math.max(durMax, dur);
  for (let i = 0; i < s.length; i++) if (!isFinite(s[i])) { bad++; break; }
  if (m.peak > 0.999) console.log('  ! w' + g + ' clips (peak ' + m.peak.toFixed(3) + ')');
}
console.log('FINITE', bad === 0 ? 'ok' : (bad + ' bad takes'),
            '· duration drift', (durMax - durMin).toFixed(3) + 's',
            '(expect ~0 — guidance shapes timbre, not length)');
console.log('WAVs written to', OUT);
console.log('EXPLORE GUIDANCE DONE');
