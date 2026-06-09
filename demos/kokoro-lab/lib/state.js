// Kokoro Lab — steer a voice through Kokoro's style space, then watch and hear
// the selected voice take shape stage by stage.
//
// "Selected voice" is no longer one of a few named packs — it's a point in
// Kokoro's 256-D style space, steered by sliders aligned to the principal axes
// of the 606 clean swept voices (voice_basis.json, beside the model; built by
// bro/tests/_voice_basis.js):
//
//   coords (σ units) ─► style = mean + Σ coordₖ·stdₖ·compₖ ─► kokoro.createVoice
//      ─► synthesizeTraced(ids, voice) ─► { samples, durations, stages[] }
//
// Each stage is a row-major (h×w) Float32Array captured inside the real Kokoro
// forward pass (brosoundml KokoroTrace), rendered in the form that reads best.
// Seeds for the sliders: any of the 28 named anchors, the neutral centroid, a
// random in-distribution draw, or a real clip cloned through the ECAPA→style
// bridge (voice_bridge.bin, beside the model). Changing the voice re-traces it,
// so the stage stream and the audio always reflect what the sliders define.

const $ = (s) => document.querySelector(s);

let kokoro = null;
let voice = null;
let lastTrace = null;     // { samples, sampleRate, durations, stages }
let audioCtx = null;
let clipId = -1;          // the published audio clip for the current synthesis
let clipSamples = 0;      // sample count of that clip (for phoneme-segment regions)

// ─── stage metadata ────────────────────────────────────────────────────────
// kind  = how to draw it.  desc = plain words.
// flow  = how a single phoneme maps onto this stage, so selecting one phoneme
//         can highlight its territory at every stage (the data-flow view):
//           axis 'x'|'y'|'chip' = which axis carries the unit
//           time 'sym'          = phoneme time (unit = column/row index / L)
//           time 'frame'        = frame time   (unit = its duration span / total)
const STAGE_INFO = {
  phonemes: { kind: 'chips', desc: 'input phoneme ids — symbol time, length L', flow: { axis: 'chip' } },
  bert_dur: { kind: 'heat',  desc: 'plBERT contextual features — L phonemes x 768 dims', flow: { axis: 'y', time: 'sym' } },
  d_en:     { kind: 'heat',  desc: 'predictor conditioning (PROSODY branch) — 512 ch x L', flow: { axis: 'x', time: 'sym' } },
  t_en:     { kind: 'heat',  desc: 'text-encoder content (CONTENT branch) — 512 ch x L', flow: { axis: 'x', time: 'sym' } },
  pred_dur: { kind: 'align', desc: 'predicted frames per phoneme — the alignment (symbol -> time)', flow: { axis: 'x', time: 'frame' } },
  F0_pred:  { kind: 'curve', desc: 'pitch contour (Hz) at frame rate', color: '#ffcf6b', flow: { axis: 'x', time: 'frame' } },
  N_pred:   { kind: 'curve', desc: 'energy contour at frame rate', color: '#7fd1a6', flow: { axis: 'x', time: 'frame' } },
  asr:      { kind: 'heat',  desc: 'duration-aligned content — 512 ch x T frames', flow: { axis: 'x', time: 'frame' } },
  gen_in:   { kind: 'heat',  desc: 'decoder-backbone output — 512 ch x 2T', flow: { axis: 'x', time: 'frame' } },
  har:      { kind: 'heat',  desc: 'harmonic-source excitation — (n_fft+2) x frames', flow: { axis: 'x', time: 'frame' } },
  audio:    { kind: 'wave',  desc: 'output waveform — 24 kHz', flow: { axis: 'x', time: 'frame' } },
};

// Display order, regardless of the order the trace emits stages in: phonemes,
// then the editable prosody surfaces (pitch / energy / timing) hoisted to the
// top so they're reachable without scrolling, then the waveform, then the rest
// of the latent pipeline in forward order.
const STAGE_ORDER = ['phonemes', 'F0_pred', 'N_pred', 'pred_dur', 'audio',
                     'bert_dur', 'd_en', 't_en', 'asr', 'gen_in', 'har'];

// flow state: overlays/chips per stage, and the currently traced phoneme.
let flowStages = [];
let selPhoneme = -1;

// ═══ voice-space designer ════════════════════════════════════════════════════
// The slider basis: principal axes of the clean swept voices, std-scaled so a
// slider unit == 1σ of real voice variation. See tests/_voice_basis.js.
let basis = null;          // voicebasis.json
let coords = null;         // Float64Array(K) — current position, in σ units
let sliderCells = [];      // the K slider widgets (skips the group-label rows)
let bridge = null;         // { D, M, xm, ym, B } — lazy (clone only)
let spkEnc = null;         // standalone ECAPA speaker encoder — lazy (clone only)
let renderTimer = 0;       // debounce slider drags before the re-render
let synthBusy = false;     // a synth (audio or trace pass) is in flight
let dirty = false;         // the voice changed; needs an audio-then-trace pass

// ── prosody editing (drag the F0 / energy curves or the alignment, re-decode
//    just the back half)
let predicted = null;      // { F0, N, dur } snapshot of the model's prediction (reset)
let curDur = null;         // the durations the current F0/N are aligned to (int[])
let edited = false;        // the user has reshaped a contour or the timing
let pinnedEdit = null;     // retained prosody delta, re-applied on every voice/slider change
                           // { durRatio:Float64[L], dF0:Float32, dN:Float32, baseDur:int[L] }
let activePaint = null;    // in-progress curve drag {cv,s,color,mn,mx,W,H,pad,lastI,lastV}
let activeDrag = null;     // in-progress alignment drag {cv,s,total,work,x0,l,base,rectW,moved}
let protectedStage = null; // stage name whose canvas to keep intact across a re-decode (the edit IS the truth)
let stageCards = null;     // name -> { card, body, info, shapeEl, statsEl }; cards persist, bodies refresh in place
let stageSig = '';         // current stage-name signature, so we only full-rebuild when the set changes
let emoTimer = 0;          // debounce for VAD emotion slider drags
let emoCells = {};         // VAD axis widgets, keyed 'v' / 'a' / 'd'

// ── Tier 1 emotion: learned timbre directions in style space (emotion_basis.json)
let emotionBasis = null;   // { emotions, resid, full, sigmaResid, defaultAlpha, ... }
let emoTimbre = {};        // per-emotion intensity α applied to resid[e]
let timbreCells = {};      // emotion slider widgets, keyed by code (ANG/SAD/…)
let timbreTimer = 0;       // debounce for timbre slider drags (full re-synth)

// ── masculine↔feminine: a bipolar vocal-quality axis in style space (masc_fem_basis.json)
let mascFemBasis = null;   // { poles:['F','M'], full:{M,F}, defaultAlpha, alphaMax, ... }
let mfAlpha = 0;           // signed intensity along full[M]: + masculine, − feminine
let mfSlider = null, mfVal = null;
let mfTimer = 0;           // debounce for the masc/fem slider drag (full re-synth)

const ATTR_WORD = { f0_mean: 'pitch', rms: 'volume', energy: 'energy', rate: 'pace', zcr: 'brightness', f0_std: 'pitch var' };

