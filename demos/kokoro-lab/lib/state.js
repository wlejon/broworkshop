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

export const $ = (s) => document.querySelector(s);

export let kokoro = null;
export let voice = null;
export let lastTrace = null;     // { samples, sampleRate, durations, stages }
export let audioCtx = null;
export let clipId = -1;          // the published audio clip for the current synthesis
export let clipSamples = 0;      // sample count of that clip (for phoneme-segment regions)
export let wavSamples = null;    // native-rate copy of the last-heard buffer (for WAV export)
export let wavRate = 24000;      // its sample rate

// ─── stage metadata ────────────────────────────────────────────────────────
// kind  = how to draw it.  desc = plain words.
// flow  = how a single phoneme maps onto this stage, so selecting one phoneme
//         can highlight its territory at every stage (the data-flow view):
//           axis 'x'|'y'|'chip' = which axis carries the unit
//           time 'sym'          = phoneme time (unit = column/row index / L)
//           time 'frame'        = frame time   (unit = its duration span / total)
export const STAGE_INFO = {
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
export const STAGE_ORDER = ['phonemes', 'F0_pred', 'N_pred', 'pred_dur', 'audio',
                     'bert_dur', 'd_en', 't_en', 'asr', 'gen_in', 'har'];

// flow state: overlays/chips per stage, and the currently traced phoneme.
export let flowStages = [];
export let selPhoneme = -1;

// ═══ voice-space designer ════════════════════════════════════════════════════
// The slider basis: principal axes of the clean swept voices, std-scaled so a
// slider unit == 1σ of real voice variation. See tests/_voice_basis.js.
export let basis = null;          // voicebasis.json
export let coords = null;         // Float64Array(K) — current position, in σ units
export let sliderCells = [];      // the K slider widgets (skips the group-label rows)
export let bridge = null;         // { D, M, xm, ym, B } — lazy (clone only)
export let spkEnc = null;         // standalone ECAPA speaker encoder — lazy (clone only)
export let renderTimer = 0;       // debounce slider drags before the re-render
export let synthBusy = false;     // a synth (audio or trace pass) is in flight
export let dirty = false;         // the voice changed; needs an audio-then-trace pass

// ── prosody editing (drag the F0 / energy curves or the alignment, re-decode
//    just the back half)
export let predicted = null;      // { F0, N, dur } snapshot of the model's prediction (reset)
export let curDur = null;         // the durations the current F0/N are aligned to (int[])
export let edited = false;        // the user has reshaped a contour or the timing
export let pinnedEdit = null;     // retained prosody delta, re-applied on every voice/slider change
                           // { durRatio:Float64[L], dF0:Float32, dN:Float32, baseDur:int[L] }
export let activePaint = null;    // in-progress curve drag {cv,s,color,mn,mx,W,H,pad,lastI,lastV}
export let activeDrag = null;     // in-progress alignment drag {cv,s,total,work,x0,l,base,rectW,moved}
export let protectedStage = null; // stage name whose canvas to keep intact across a re-decode (the edit IS the truth)
export let stageCards = null;     // name -> { card, body, info, shapeEl, statsEl }; cards persist, bodies refresh in place
export let stageSig = '';         // current stage-name signature, so we only full-rebuild when the set changes
export let emoTimer = 0;          // debounce for VAD emotion slider drags
export let emoCells = {};         // VAD axis widgets, keyed 'v' / 'a' / 'd'

// ── Tier 1 emotion: learned timbre directions in style space (emotion_basis.json)
export let emotionBasis = null;   // { emotions, resid, full, sigmaResid, defaultAlpha, ... }
export let emoTimbre = {};        // per-emotion intensity α applied to resid[e]
export let timbreCells = {};      // emotion slider widgets, keyed by code (ANG/SAD/…)
export let timbreTimer = 0;       // debounce for timbre slider drags (full re-synth)

// ── masculine↔feminine: a bipolar vocal-quality axis in style space (masc_fem_basis.json)
export let mascFemBasis = null;   // { poles:['F','M'], full:{M,F}, defaultAlpha, alphaMax, ... }
export let mfAlpha = 0;           // signed intensity along full[M]: + masculine, − feminine
export let mfSlider = null, mfVal = null;
export let mfTimer = 0;           // debounce for the masc/fem slider drag (full re-synth)

export const ATTR_WORD = { f0_mean: 'pitch', rms: 'volume', energy: 'energy', rate: 'pace', zcr: 'brightness', f0_std: 'pitch var' };

// ─── setters ─────────────────────────────────────────────────────────────────
// ES-module bindings are read-only across module boundaries, so the files that
// reassign the mutable state above (kept central here, the "shared state" hub)
// go through these — reads still import the live `let` bindings directly.
export function putKokoro(v)        { kokoro = v;        return v; }
export function putVoice(v)         { voice = v;         return v; }
export function putLastTrace(v)     { lastTrace = v;     return v; }
export function putAudioCtx(v)      { audioCtx = v;      return v; }
export function putClipId(v)        { clipId = v;        return v; }
export function putClipSamples(v)   { clipSamples = v;   return v; }
export function putWavSamples(v)    { wavSamples = v;    return v; }
export function putWavRate(v)       { wavRate = v;       return v; }
export function putFlowStages(v)    { flowStages = v;    return v; }
export function putSelPhoneme(v)    { selPhoneme = v;    return v; }
export function putBasis(v)         { basis = v;         return v; }
export function putCoords(v)        { coords = v;        return v; }
export function putSliderCells(v)   { sliderCells = v;   return v; }
export function putBridge(v)        { bridge = v;        return v; }
export function putSpkEnc(v)        { spkEnc = v;        return v; }
export function putRenderTimer(v)   { renderTimer = v;   return v; }
export function putSynthBusy(v)     { synthBusy = v;     return v; }
export function putDirty(v)         { dirty = v;         return v; }
export function putPredicted(v)     { predicted = v;     return v; }
export function putCurDur(v)        { curDur = v;        return v; }
export function putEdited(v)        { edited = v;        return v; }
export function putPinnedEdit(v)    { pinnedEdit = v;    return v; }
export function putActivePaint(v)   { activePaint = v;   return v; }
export function putActiveDrag(v)    { activeDrag = v;    return v; }
export function putProtectedStage(v){ protectedStage = v; return v; }
export function putStageCards(v)    { stageCards = v;    return v; }
export function putStageSig(v)      { stageSig = v;      return v; }
export function putEmoTimer(v)      { emoTimer = v;      return v; }
export function putEmoCells(v)      { emoCells = v;      return v; }
export function putEmotionBasis(v)  { emotionBasis = v;  return v; }
export function putEmoTimbre(v)     { emoTimbre = v;     return v; }
export function putTimbreCells(v)   { timbreCells = v;   return v; }
export function putTimbreTimer(v)   { timbreTimer = v;   return v; }
export function putMascFemBasis(v)  { mascFemBasis = v;  return v; }
export function putMfAlpha(v)       { mfAlpha = v;       return v; }
export function putMfSlider(v)      { mfSlider = v;      return v; }
export function putMfVal(v)         { mfVal = v;         return v; }
export function putMfTimer(v)       { mfTimer = v;       return v; }

