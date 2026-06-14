import { $, audioCtx, basis, bridge, coords, kokoro, putAudioCtx, putBridge, putCoords, putSpkEnc, spkEnc, voice } from "/app/lib/state.js";
import { _fs, paths } from "/app/lib/source.js";
import { syncSliders } from "/app/lib/designer.js";
import { setBadge } from "/app/lib/model.js";
import { run } from "/app/lib/synth.js";

// ── clone a real clip into the slider space, via the ECAPA->style bridge ─────
export function loadBridge() {
  if (bridge) return true;
  try {
    const ab = _fs.readFileSync(paths.model + '/voice_bridge.bin');
    const buf = ab instanceof ArrayBuffer ? ab : ab.buffer;
    const iv = new Int32Array(buf, 0, 2); const D = iv[0], M = iv[1];
    let off = 8;
    const xm = new Float32Array(buf, off, D); off += 4 * D;
    const ym = new Float32Array(buf, off, M); off += 4 * M;
    const B = new Float32Array(buf, off, D * M);
    putBridge({ D, M, xm, ym, B });
    return true;
  } catch (e) { setBadge('voice_bridge.bin missing from ' + paths.model + ' — run tests/_voice_basis.js', true); return false; }
}

// x(1024) -> style(256): style = ym + (x - xm)·B   (B row-major D×M)
export function bridgeApply(x) {
  const { D, M, xm, ym, B } = bridge;
  const s = new Float64Array(M);
  for (let m = 0; m < M; m++) s[m] = ym[m];
  for (let j = 0; j < D; j++) {
    const xc = x[j] - xm[j]; if (!xc) continue;
    const bj = j * M;
    for (let m = 0; m < M; m++) s[m] += xc * B[bj + m];
  }
  return s;
}

// project a 256-D style onto the slider axes (σ units)
export function coordsFromStyle(style) {
  const { dim, k, mean, comps, std } = basis;
  const c = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const v = comps[i]; let s = 0;
    for (let d = 0; d < dim; d++) s += (style[d] - mean[d]) * v[d];
    c[i] = s / (std[i] || 1);
  }
  return c;
}

export function clone() {
  if (!basis || !kokoro) return;
  if (!loadBridge()) return;
  const wav = $('#ref-wav').value.trim();
  // Clone enrolls the clip with the standalone ECAPA-TDNN speaker encoder — the
  // ~18 MB artifact in brosoundml-data (qwen-tts/speaker-encoder), lifted out of
  // the Qwen3-TTS Base checkpoint so we load 18 MB, not the whole ~2.5 GB model,
  // just for the x-vector. Build it with brosoundml_build_speaker_encoder. An
  // explicit override wins; else the spot beside the data source.
  const sdir = $('#qwen-dir').value.trim() || paths.spkenc;

  const proceed = () => {
    try {
      putAudioCtx(audioCtx || new AudioContext());
      const dec = audioCtx.decodeAudioFile(wav);
      if (!dec) { setBadge('clone: cannot decode ' + wav, true); return; }
      let mono = dec.samples;
      if (dec.channels === 2) {
        mono = new Float32Array(dec.numFrames);
        for (let i = 0; i < dec.numFrames; i++) mono[i] = 0.5 * (dec.samples[2 * i] + dec.samples[2 * i + 1]);
      }
      const nm = wav.split(/[\\\/]/).pop();
      // The ECAPA forward is a multi-GFLOP conv stack — run it off-thread so the
      // UI stays live, and apply the result when the embedding comes back.
      setBadge('clone: enrolling ' + nm + '…');
      spkEnc.embedSpeaker(mono, {
        sampleRate: dec.sampleRate,
        onDone: (x) => {
          try {
            putCoords(coordsFromStyle(bridgeApply(x)));
            for (let k = 0; k < basis.k; k++) {    // clamp into the widgets' range
              const [lo, hi] = basis.range[k];
              coords[k] = Math.max(lo * 1.15, Math.min(hi * 1.15, coords[k]));
            }
            syncSliders();
            $('#source').value = '__neutral__';
            setBadge('ready · cloned ' + nm);
            $('#voice-meta').textContent = 'clone: ' + nm;
            run();
          } catch (e) { setBadge('clone: ' + e.message, true); }
        },
        onError: (m) => setBadge('clone: enroll failed: ' + m, true),
      });
    } catch (e) { setBadge('clone: ' + e.message, true); }
  };

  if (spkEnc) { proceed(); return; }
  setBadge('clone: loading speaker encoder…');
  bro.tts.loadSpeakerEncoder(sdir, {
    onReady: (enc) => { putSpkEnc(enc); proceed(); },
    onError: (m) => setBadge('clone: speaker encoder load failed: ' + m, true),
  });
}

// save the current voice as a raw little-endian FP32 pack (loadVoice's format)
export function saveVoice() {
  if (!voice) return;
  try {
    const data = voice.data;                 // Float32Array(rows*cols)
    const u8 = new Uint8Array(data.length * 4);
    new Float32Array(u8.buffer).set(data);
    const p = paths.model + '/voices/designed.bin';
    _fs.writeFileSync(p, u8);
    $('#voice-meta').textContent = 'saved → ' + p;
  } catch (e) { setBadge('save: ' + e.message, true); }
}

