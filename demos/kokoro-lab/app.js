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
let qwen = null;           // Qwen Base model — lazy (clone only, for embedSpeaker)
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

const ATTR_WORD = { f0_mean: 'pitch', rms: 'volume', energy: 'energy', rate: 'pace', zcr: 'brightness', f0_std: 'pitch var' };

// ═══ data source ═════════════════════════════════════════════════════════════
// One folder drives everything the lab needs: the Kokoro model dir (model +
// voice_basis + voice_bridge + voices) and the phonemizer assets (g2p lexicon,
// POS tagger, config vocab). Three layouts are recognised, auto-detected from
// the folder you point at:
//   · brosoundml-data — the published HF dataset:  <root>/{kokoro,g2p,pos_tagger}
//   · brosoundml repo — the dev sibling:           <root>/weights/kokoro  (+ ../brosoundml-data)
//   · a bare Kokoro dir — config.json sitting right inside it
// The model dir, the Qwen clone dir, and how the phonemizer assets resolve all
// follow from which layout it is, so the user only ever picks one folder.
const _fs = require('fs');
function pExists(p) { try { return _fs.existsSync(p); } catch (e) { return false; } }
function pParent(p) { return p.replace(/[\\\/]+$/, '').replace(/[\\\/][^\\\/]*$/, ''); }

const paths = {
  root: '', kind: 'data', model: '', qwen: '',
  // Point the phonemizer at this source's g2p/POS/config assets. The sibling
  // layout has its own well-known shape (setAssetRoot); the flat data layouts
  // need explicit per-file paths (setAssets).
  configureAssets() {
    if (this.kind === 'sibling') {
      bro.tts.setAssetRoot(this.root);
    } else if (this.kind === 'data') {
      bro.tts.setAssets({
        lexicon:      this.root + '/g2p/lexicon_en_us.bin',
        posTagger:    this.root + '/pos_tagger/model.bin',
        kokoroConfig: this.root + '/kokoro/config.json',
      });
    } else {                                  // a bare kokoro dir — config only
      bro.tts.setAssets({ kokoroConfig: this.model + '/config.json' });
    }
  },
};

// Recognise which layout `root` is, and where its kokoro + qwen dirs live.
// Returns null if nothing identifiable is found inside it.
function detectSource(root) {
  root = root.replace(/[\\\/]+$/, '');
  if (pExists(root + '/kokoro/config.json'))
    return { kind: 'data', root, model: root + '/kokoro', qwen: root + '/qwen-tts/0.6B-Base' };
  if (pExists(root + '/weights/kokoro/config.json'))
    return { kind: 'sibling', root, model: root + '/weights/kokoro', qwen: root + '/weights/qwen-tts/0.6B-Base' };
  if (pExists(root + '/config.json')) {                   // root itself is a kokoro dir
    const parent = pParent(root);
    if (pExists(parent + '/g2p/lexicon_en_us.bin'))       // …/<brosoundml-data>/kokoro
      return { kind: 'data', root: parent, model: root, qwen: parent + '/qwen-tts/0.6B-Base' };
    const repo = pParent(parent);
    if (pExists(repo + '/weights/kokoro/config.json'))    // …/<repo>/weights/kokoro
      return { kind: 'sibling', root: repo, model: root, qwen: repo + '/weights/qwen-tts/0.6B-Base' };
    return { kind: 'model', root, model: root, qwen: parent + '/qwen-tts/0.6B-Base' };
  }
  return null;
}

// Resolve a sensible starting data source for this machine. The HTML ships a
// Windows dev default; on first run (or after a move) we probe the usual spots
// and adopt the first that detectSource() recognises — so the app comes up
// pointed at real data without the user editing a path. A browsed/typed path is
// remembered in localStorage and wins on the next launch.
const _os = require('os');
function rememberedRoot() {
  try { return localStorage.getItem('kokoro-lab.dataRoot') || ''; } catch (e) { return ''; }
}
function rememberRoot(root) {
  try { localStorage.setItem('kokoro-lab.dataRoot', root); } catch (e) {}
}
function defaultRoot(htmlDefault) {
  let home = '';
  try { home = _os.homedir(); } catch (e) {}
  const candidates = [
    rememberedRoot(),                       // an earlier choice, if any
    htmlDefault,                            // the value baked into index.html
    home && home + '/projects/brosoundml-data',
    home && home + '/projects/brosoundml',
  ].filter(Boolean);
  for (const c of candidates) if (detectSource(c)) return c;
  return rememberedRoot() || htmlDefault;   // nothing detected — show best guess
}

// Adopt `root` as the data source: detect its layout, update the resolved paths
// and the status label. Loads nothing — see switchSource() for that.
function setSource(rootIn) {
  const root = (rootIn || '').replace(/[\\\/]+$/, '');
  const det = detectSource(root);
  const r = det || { kind: 'data', root, model: root + '/kokoro', qwen: root + '/qwen-tts/0.6B-Base' };
  paths.root = r.root; paths.kind = r.kind; paths.model = r.model; paths.qwen = r.qwen;
  const meta = $('#data-meta');
  if (meta) {
    const name = r.kind === 'sibling' ? 'brosoundml repo'
               : r.kind === 'model'   ? 'Kokoro dir' : 'brosoundml-data';
    meta.textContent = (det ? '✓ ' : '⚠ ') + name + ' · model ' + r.model;
    meta.classList.toggle('err', !det);
  }
}

function loadBasis() {
  // The basis + adapter live in the Kokoro model dir (kokoro/ in brosoundml-data,
  // weights/kokoro/ in the dev repo), so they travel with the voices they derive from.
  try {
    basis = JSON.parse(_fs.readFileSync(paths.model + '/voice_basis.json', 'utf-8'));
    coords = new Float64Array(basis.k);
  } catch (e) {
    setBadge('voice_basis.json missing from ' + paths.model + ' — run tests/_voice_basis.js', true);
  }
}

// a faint hint of which perceptual attribute this axis pushes, and which way.
// attribute axes are already named (pitch/brightness/…), so their hint just
// shows how cleanly the axis tracks that attribute; character axes show their
// strongest incidental correlate, if any.
function hintFor(k) {
  const h = basis.attrHint[k];
  if (basis.axisKind && basis.axisKind[k] === 'attr')
    return h && h.r ? 'r ' + Math.abs(h.r).toFixed(2) : '';
  if (!h || !h.attr || Math.abs(h.r) < 0.3) return '';
  return (h.r > 0 ? '↑' : '↓') + (ATTR_WORD[h.attr] || h.attr);
}

function buildSliders() {
  const root = $('#sliders'); root.textContent = '';
  sliderCells = [];
  let lastKind = null;
  for (let k = 0; k < basis.k; k++) {
    const kind = basis.axisKind ? basis.axisKind[k] : 'char';
    if (kind !== lastKind) {            // a full-width header before each bank
      root.appendChild(el('div', 'slider-group',
        kind === 'attr' ? 'perceptual — labeled, always audible' : 'character — timbre & identity'));
      lastKind = kind;
    }
    const isAttr = kind === 'attr';
    // emphasize the attribute axes and the first few character axes
    const firstChar = basis.axisKind ? basis.axisKind.indexOf('char') : 6;
    const lead = isAttr || k < firstChar + 4;
    const cell = el('div', 'pc' + (isAttr ? ' attr' : '') + (lead ? ' lead' : ''));
    const head = el('div', 'pc-head');
    head.appendChild(el('span', 'pc-name', basis.axisName ? basis.axisName[k] : ('PC' + (k + 1))));
    head.appendChild(el('span', 'pc-hint', hintFor(k)));
    const val = el('span', 'pc-val', '0.00');
    head.appendChild(val);
    cell.appendChild(head);

    const r = document.createElement('input');
    r.type = 'range';
    const [lo, hi] = basis.range[k];
    r.min = (lo * 1.15).toFixed(3); r.max = (hi * 1.15).toFixed(3); r.step = '0.01'; r.value = '0';
    // dragging updates the readout instantly; the see+hear re-render is
    // debounced so it fires once you pause, never mid-drag
    r.addEventListener('input', () => { coords[k] = +r.value; val.textContent = coords[k].toFixed(2); scheduleRender(); });
    cell.appendChild(r);
    cell._range = r; cell._val = val;
    sliderCells.push(cell);
    root.appendChild(cell);
  }
}

// push coords[] back onto the slider widgets (after a seed / clone / random)
function syncSliders() {
  for (let k = 0; k < basis.k; k++) {
    sliderCells[k]._range.value = String(coords[k]);
    sliderCells[k]._val.textContent = coords[k].toFixed(2);
  }
}

// coords (σ units) -> 256-D style vector
function styleFromCoords() {
  const { dim, k, mean, comps, std } = basis;
  const s = new Float32Array(dim);
  for (let d = 0; d < dim; d++) s[d] = mean[d];
  for (let i = 0; i < k; i++) {
    const c = coords[i] * std[i]; if (!c) continue;
    const v = comps[i];
    for (let d = 0; d < dim; d++) s[d] += c * v[d];
  }
  return s;
}

// rebuild the Voice object from the current coords. Cheap (a style-table pack),
// no synthesis — so it's safe to call on every change. Returns success.
function rebuildVoice() {
  if (!kokoro || !basis) return false;
  try {
    voice = kokoro.createVoice(styleFromCoords(), 'designed');
    $('#btn-run').disabled = false;
    $('#btn-save').disabled = false;
    return true;
  } catch (e) { setBadge('createVoice: ' + e.message, true); return false; }
}

// Coalesce a fast slider drag into a single render shortly after it settles, so
// dragging stays smooth and the (synchronous) see+hear trace only runs once you
// pause — never on every tick, never mid-drag.
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { renderTimer = 0; run(); }, 120);
}

// seed the sliders from a named anchor (or the neutral centroid). `render`
// false on initial load (don't speak/draw until the user asks), true on picks.
function seedFrom(name, render) {
  if (!basis) return;
  if (name === '__neutral__') coords.fill(0);
  else {
    const i = basis.names.indexOf(name); if (i < 0) return;
    const a = basis.anchors[i];
    for (let k = 0; k < basis.k; k++) coords[k] = a[k];
  }
  syncSliders();
  $('#voice-meta').textContent = 'seed: ' + (name === '__neutral__' ? 'neutral centroid' : name);
  if (render) run(); else rebuildVoice();
}

// randomize within the realizable range, weighted toward the dominant axes so
// draws stay plausible (tail axes get small kicks, not full-range noise)
function randomVoice() {
  if (!basis) return;
  for (let k = 0; k < basis.k; k++) {
    const g = gauss() * (0.5 + basis.varExplained[k] * 3);
    const [lo, hi] = basis.range[k];
    coords[k] = Math.max(lo, Math.min(hi, g));
  }
  syncSliders();
  $('#source').value = '__neutral__';
  $('#voice-meta').textContent = 'random draw';
  run();
}

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ── clone a real clip into the slider space, via the ECAPA->style bridge ─────
function loadBridge() {
  if (bridge) return true;
  try {
    const ab = _fs.readFileSync(paths.model + '/voice_bridge.bin');
    const buf = ab instanceof ArrayBuffer ? ab : ab.buffer;
    const iv = new Int32Array(buf, 0, 2); const D = iv[0], M = iv[1];
    let off = 8;
    const xm = new Float32Array(buf, off, D); off += 4 * D;
    const ym = new Float32Array(buf, off, M); off += 4 * M;
    const B = new Float32Array(buf, off, D * M);
    bridge = { D, M, xm, ym, B };
    return true;
  } catch (e) { setBadge('voice_bridge.bin missing from ' + paths.model + ' — run tests/_voice_basis.js', true); return false; }
}

// x(1024) -> style(256): style = ym + (x - xm)·B   (B row-major D×M)
function bridgeApply(x) {
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
function coordsFromStyle(style) {
  const { dim, k, mean, comps, std } = basis;
  const c = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const v = comps[i]; let s = 0;
    for (let d = 0; d < dim; d++) s += (style[d] - mean[d]) * v[d];
    c[i] = s / (std[i] || 1);
  }
  return c;
}

function clone() {
  if (!basis || !kokoro) return;
  if (!loadBridge()) return;
  const wav = $('#ref-wav').value.trim();
  // Clone needs the Qwen3-TTS *Base* checkpoint (it bundles the ECAPA speaker
  // encoder). That's a separate upstream HF model — Qwen/Qwen3-TTS-12Hz-0.6B-Base,
  // Apache-2.0, fetched by brosoundml's download-qwen-tts.sh — NOT part of
  // brosoundml-data. So it has its own path: an explicit override if given, else
  // the spot beside the data source (the dev repo ships it under weights/qwen-tts).
  const qdir = $('#qwen-dir').value.trim() || paths.qwen;

  const proceed = () => {
    try {
      audioCtx = audioCtx || new AudioContext();
      const dec = audioCtx.decodeAudioFile(wav);
      if (!dec) { setBadge('clone: cannot decode ' + wav, true); return; }
      let mono = dec.samples;
      if (dec.channels === 2) {
        mono = new Float32Array(dec.numFrames);
        for (let i = 0; i < dec.numFrames; i++) mono[i] = 0.5 * (dec.samples[2 * i] + dec.samples[2 * i + 1]);
      }
      const x = qwen.embedSpeaker(mono, { sampleRate: dec.sampleRate });
      coords = coordsFromStyle(bridgeApply(x));
      for (let k = 0; k < basis.k; k++) {        // clamp into the widgets' range
        const [lo, hi] = basis.range[k];
        coords[k] = Math.max(lo * 1.15, Math.min(hi * 1.15, coords[k]));
      }
      syncSliders();
      $('#source').value = '__neutral__';
      const nm = wav.split(/[\\\/]/).pop();
      setBadge('ready · cloned ' + nm);
      $('#voice-meta').textContent = 'clone: ' + nm;
      run();
    } catch (e) { setBadge('clone: ' + e.message, true); }
  };

  if (qwen) { proceed(); return; }
  setBadge('clone: loading speaker encoder…');
  bro.tts.loadQwen(qdir, {
    onReady: (q) => { qwen = q; proceed(); },
    onError: (m) => setBadge('clone: qwen load failed: ' + m, true),
  });
}

// save the current voice as a raw little-endian FP32 pack (loadVoice's format)
function saveVoice() {
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

// ═══ load ══════════════════════════════════════════════════════════════════
function setBadge(text, err) {
  const b = $('#backend');
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

function reload() {
  kokoro = null; voice = null;
  $('#btn-run').disabled = true;
  $('#btn-play').disabled = true;
  $('#btn-save').disabled = true;
  setBadge('loading model…');
  try {
    paths.configureAssets();
    bro.tts.loadKokoro(paths.model, {
      onReady: (k) => { kokoro = k; setBadge('ready · drag a slider to hear & watch it take shape'); seedFrom($('#source').value, false); },
      onError: (m) => setBadge('model error: ' + m, true),
    });
  } catch (e) {
    setBadge('load failed: ' + e.message, true);
  }
}

// (Re)adopt a data source end-to-end: detect its layout, reload the PCA basis +
// sliders + clone adapters from it, then reload the Kokoro model. This is the
// one entry point for "the source changed" — browse, a typed path + Reload, or
// first load all route through here.
function switchSource(root) {
  setSource(root);
  if (detectSource(root)) rememberRoot(paths.root);   // a real source — remember it
  bridge = null; qwen = null;            // clone adapters are per-source
  basis = null; coords = null;
  loadBasis();
  populateSources();
  if (basis) buildSliders();
  reload();                              // configures assets + loads the model, then seeds
}

// Fill the seed dropdown from the current basis' named anchors (+ neutral).
function populateSources() {
  const src = $('#source');
  src.textContent = '';
  if (!basis) return;
  const neu = document.createElement('option');
  neu.value = '__neutral__'; neu.textContent = 'neutral (centroid)';
  src.appendChild(neu);
  for (const n of basis.names) {
    const o = document.createElement('option'); o.value = n; o.textContent = n; src.appendChild(o);
  }
  if (basis.names.indexOf('af_heart') >= 0) src.value = 'af_heart';
}

// Native dialogs, defensively gated (absent in headless / GPU-less builds).
function browseFolder(start) {
  if (typeof showOpenFolderDialog !== 'function') { setBadge('folder dialog unavailable in this build', true); return null; }
  const r = showOpenFolderDialog(start || null);
  return r && r.length ? r[0] : null;
}
function browseFile(filter) {
  if (typeof showOpenFileDialog !== 'function') { setBadge('file dialog unavailable in this build', true); return null; }
  const r = showOpenFileDialog(filter || '');
  return r && r.length ? r[0] : null;
}

// ═══ run ═══════════════════════════════════════════════════════════════════
// (Re)render the current voice. We synthesize it TWICE on the background thread:
// first audio-only so it plays as fast as possible (no trace host-copies, no
// stage drawing in the way), then again WITH the trace to draw the pipeline a
// beat later. The model runs one synth at a time, so the two passes are
// sequential; if the voice changes mid-flight we drop back to audio-first for
// the newest one (latest-wins) — hear it now, see it once it settles.
function run() {
  if (!kokoro) return;
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }
  if (!rebuildVoice()) return;            // render exactly what the sliders define now
  dirty = true;
  pump();
}

// Start the next pass if one isn't already running and the voice is dirty.
function pump() {
  if (synthBusy || !dirty || !kokoro || !voice) return;
  let ids;
  try { ids = bro.tts.phonemize($('#text').value); }
  catch (e) { setBadge('phonemize: ' + e.message, true); dirty = false; return; }
  if (!ids || !ids.length) { setBadge('no phonemes for that text', true); dirty = false; return; }
  dirty = false;
  // with a pinned edit the unedited audio is never heard (the trace pass
  // re-decodes & plays the edited version), so skip the fast audio-only pass.
  if (pinnedEdit) synthTrace(ids); else synthAudio(ids);
}

// Kick off a background synth, marking the model busy. A synchronous throw
// (e.g. the model momentarily in flight) clears the flag and re-pumps instead
// of wedging the state machine.
function safeSynth(ids, opts) {
  synthBusy = true;
  try {
    bro.tts.synthesize(kokoro, ids, voice, opts);
  } catch (e) {
    synthBusy = false;
    setBadge('synthesize: ' + e.message, true);
    if (dirty) setTimeout(pump, 0);
  }
}

// Pass 1 — fast: audio only, play it the moment it lands.
function synthAudio(ids) {
  $('#run-meta').textContent = 'synthesizing…';
  safeSynth(ids, {
    onDone: (r, info) => {
      synthBusy = false;
      if (info.error) { setBadge('synthesize: ' + info.error, true); return; }
      if (!info.cancelled) {
        setClip(r.samples, r.sampleRate);
        $('#btn-play').disabled = false;
        if (!pinnedEdit) setTimeout(play, 40);   // pinned: trace pass re-decodes & plays the edited audio
      }
      if (dirty) pump();              // a newer voice arrived — hear it next
      else synthTrace(ids);           // audio is current → now gather the trace
    },
  });
}

// Pass 2 — gather + draw the pipeline trace for the (now playing) voice.
function synthTrace(ids) {
  const t0 = performance.now();
  safeSynth(ids, {
    trace: true,
    onDone: (r, info) => {
      synthBusy = false;
      if (!info.error && !info.cancelled) {
        lastTrace = r;
        snapshotPredicted(r);          // baseline for the prosody-edit reset
        const stages = r.stages || [];
        const ms = (performance.now() - t0).toFixed(0);
        $('#run-meta').textContent =
          ids.length + ' phonemes · ' + stages.length + ' stages · ' +
          (r.samples.length / r.sampleRate).toFixed(2) + 's audio · +' + ms + ' ms trace';
        const sc = $('#stages').scrollTop;
        renderStages(stages);
        $('#stages').scrollTop = sc;   // keep your place while exploring
        // ride the retained prosody onto this fresh prediction; if the text no
        // longer fits, the pin is dropped and we present the prediction as-is.
        // (When pinned, this pass is the *only* one — see pump — so on a miss we
        // publish this pass's own audio before playing it.)
        if (pinnedEdit && !reapplyPinnedEdit()) { setClip(r.samples, r.sampleRate); play(); }
        else if (!pinnedEdit && emotionActive()) applyEmotion();   // derive emotion onto this fresh prediction
      }
      if (dirty) pump();
    },
  });
}

// ═══ render ════════════════════════════════════════════════════════════════
// hoist the editable prosody surfaces + waveform to the top (see STAGE_ORDER);
// stable for any stage the order list doesn't name (keeps emit order).
function orderStages(stages) {
  const rank = (n) => { const i = STAGE_ORDER.indexOf(n); return i < 0 ? STAGE_ORDER.length : i; };
  return stages
    .map((s, i) => [s, i])
    .sort((a, b) => (rank(a[0].name) - rank(b[0].name)) || (a[1] - b[1]))
    .map((x) => x[0]);
}

// Stages render once into persistent cards, then refresh IN PLACE on every
// re-decode — the stage tree is never torn down. The card the user is editing
// (or just edited) holds the truth they drew, so its body is left exactly as-is
// while every downstream stage regenerates from the new data.
function renderStages(stages) {
  const ordered = orderStages(stages);
  const sig = ordered.map((s) => s.name).join('|');
  if (!stageCards || sig !== stageSig) { buildStages(ordered, sig); return; }

  const protect = (activePaint && activePaint.s && activePaint.s.name) ||
                  (activeDrag && activeDrag.s && activeDrag.s.name) || protectedStage;
  flowStages = [];
  selPhoneme = -1;
  $('#sel-label').textContent = '';
  for (const s of ordered) {
    const cell = stageCards[s.name];
    if (!cell) { buildStages(ordered, sig); return; }   // unexpected stage set — full rebuild
    if (s.name === protect) { registerFlow(cell.body, cell.info); continue; }   // leave the edited canvas alone
    updateHead(cell, s);
    cell.body.textContent = '';
    paintBody(cell.body, s, cell.info);
    registerFlow(cell.body, cell.info);
  }
}

// First render (or whenever the stage set changes): build the cards fresh.
function buildStages(ordered, sig) {
  const root = $('#stages');
  root.textContent = '';
  flowStages = [];
  selPhoneme = -1;
  $('#sel-label').textContent = '';
  stageCards = {};
  stageSig = sig;
  for (const s of ordered) {
    const info = STAGE_INFO[s.name] || { kind: 'heat', desc: '' };
    const card = el('div', 'stage');
    const head = el('div', 'stage-head');
    head.appendChild(el('span', 'stage-name', s.name));
    const shapeEl = el('span', 'stage-shape', '');
    head.appendChild(shapeEl);
    head.appendChild(el('span', 'stage-desc', info.desc));
    const statsEl = el('span', 'stage-stats', '');
    head.appendChild(statsEl);
    card.appendChild(head);
    const body = el('div', 'stage-body');
    card.appendChild(body);
    root.appendChild(card);
    const cell = { card, body, info, shapeEl, statsEl };
    stageCards[s.name] = cell;
    updateHead(cell, s);
    paintBody(body, s, info);
    registerFlow(body, info);
  }
}

function updateHead(cell, s) {
  cell.shapeEl.textContent = s.h + ' x ' + s.w;
  const st = stats(s.data);
  cell.statsEl.textContent =
    'min ' + st.mn.toFixed(2) + '  max ' + st.mx.toFixed(2) + '  μ ' + st.mean.toFixed(2);
}

function paintBody(body, s, info) {
  try {
    if (info.kind === 'chips')      renderChips(body, s);
    else if (info.kind === 'align') renderAlign(body, s);
    else if (info.kind === 'curve') renderCurve(body, s, info.color || '#8ad9ff');
    else if (info.kind === 'wave')  renderWave(body, s);
    else                            renderHeat(body, s);
  } catch (e) {
    body.appendChild(el('div', 'axis-note', 'render error: ' + e.message));
  }
}

// (Re)register a stage for the data-flow highlight from its current DOM.
function registerFlow(body, info) {
  if (!info || !info.flow) return;
  if (info.flow.axis === 'chip') {
    const chips = [...body.querySelectorAll('.chip')];
    chips.forEach((c, i) => c.addEventListener('click', () => selectPhoneme(i)));
    flowStages.push({ flow: info.flow, chips });
  } else {
    const cv = body.querySelector('canvas');
    if (cv && cv._overlay) flowStages.push({ flow: info.flow, overlay: cv._overlay });
  }
}

// Trace one phoneme through the whole pipeline: highlight its territory at
// every stage. Symbol-time stages light the phoneme's column/row; frame-time
// stages light its duration span. Click the same phoneme again to clear.
function selectPhoneme(l) {
  selPhoneme = (l === selPhoneme) ? -1 : l;
  const dur = lastTrace ? lastTrace.durations : null;
  const L = dur ? dur.length : 0;
  let total = 0; for (let i = 0; i < L; i++) total += dur[i];

  for (const fs of flowStages) {
    if (fs.flow.axis === 'chip') {
      fs.chips.forEach((c, i) => c.classList.toggle('sel', i === selPhoneme));
      continue;
    }
    const ov = fs.overlay;
    if (selPhoneme < 0 || !dur || !total) { ov.style.display = 'none'; continue; }
    let p0, p1;
    if (fs.flow.time === 'sym') { p0 = selPhoneme / L; p1 = (selPhoneme + 1) / L; }
    else { let s = 0; for (let i = 0; i < selPhoneme; i++) s += dur[i]; p0 = s / total; p1 = (s + dur[selPhoneme]) / total; }
    ov.style.display = 'block';
    if (fs.flow.axis === 'y') {
      ov.style.left = '0'; ov.style.right = '0'; ov.style.width = '';
      ov.style.top = (p0 * 100) + '%'; ov.style.height = ((p1 - p0) * 100) + '%';
    } else {
      ov.style.top = '0'; ov.style.bottom = '0'; ov.style.height = '';
      ov.style.left = (p0 * 100) + '%'; ov.style.width = ((p1 - p0) * 100) + '%';
    }
  }

  const lab = $('#sel-label');
  if (selPhoneme < 0 || !lastTrace) lab.textContent = '';
  else lab.textContent = 'tracing phoneme #' + selPhoneme +
    ' · id ' + (lastTrace.stages[0].data[selPhoneme] | 0) +
    ' · ' + (dur ? dur[selPhoneme] : 0) + ' frames';

  // hear what you just lit up: play this phoneme's slice of the waveform
  if (selPhoneme >= 0 && dur && total) playPhonemeSegment(selPhoneme, dur, total);
}

// Play just one phoneme's audio. Its frame span maps proportionally onto the
// published clip (same time axis, different sample rate), so we trigger the
// existing clip and restrict playback to that sub-region — no re-upload.
function playPhonemeSegment(l, dur, total) {
  if (clipId < 0 || !audioCtx || !clipSamples) return;
  let s = 0; for (let i = 0; i < l; i++) s += dur[i];
  const a = Math.floor((s / total) * clipSamples);
  const b = Math.max(a + 1, Math.floor(((s + dur[l]) / total) * clipSamples));
  try {
    const pb = audioCtx.playClip(clipId, 1.0, false);
    audioCtx.setPlaybackRegion(pb, a, b);
  } catch (e) { setBadge('audio: ' + e.message, true); }
}

function renderChips(body, s) {
  const wrap = el('div', 'chips');
  for (let i = 0; i < s.data.length; i++)
    wrap.appendChild(el('span', 'chip', String(s.data[i] | 0)));
  body.appendChild(wrap);
}

// Alignment: each phoneme gets horizontal width proportional to its frame
// count — the literal symbol-time -> frame-time layout.
// Draw the alignment blocks from a duration array; returns the summed frames.
function drawAlign(cv, durs) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  const total = durs.reduce((a, b) => a + b, 0) || 1;
  ctx.clearRect(0, 0, W, H);
  let x = 0;
  for (let i = 0; i < durs.length; i++) {
    const w = (durs[i] / total) * W;
    ctx.fillStyle = (i % 2) ? '#1f3350' : '#284873';
    ctx.fillRect(x, 0, Math.max(1, w - 1), H);
    if (w > 16) {
      ctx.fillStyle = '#9fb6d4'; ctx.font = '10px monospace';
      ctx.fillText(String(durs[i] | 0), x + 3, 14);
    }
    x += w;
  }
  return total;
}

// pred_dur is editable: drag a block sideways to lengthen/shorten that phoneme
// (emphasis / pacing). A click without a drag still traces the phoneme.
function renderAlign(body, s) {
  const W = 1100, H = 54;
  const cv = mkCanvas(body, W, H);
  const total = drawAlign(cv, s.data);
  const editable = (s.name === 'pred_dur');
  cv.addEventListener('mousedown', (e) => {
    if (synthBusy || !lastTrace) return;
    e.preventDefault();                              // don't start a text selection
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }   // don't let a queued slider render fire mid-edit
    const tot = s.data.reduce((a, b) => a + b, 0) || 1;   // current sum, not the value at paint time
    const rect = cv.getBoundingClientRect();
    const tgt = ((e.clientX - rect.left) / rect.width) * tot;
    let acc = 0, l = 0;
    for (; l < s.data.length; l++) { acc += s.data[l]; if (tgt < acc) break; }
    if (l >= s.data.length) l = s.data.length - 1;
    if (!editable) { selectPhoneme(l); return; }     // non-editable: plain click
    activeDrag = { cv, s, total: tot, work: Array.from(s.data, (v) => Math.round(v)),
                   x0: e.clientX, l, base: Math.round(s.data[l]), rectW: rect.width, moved: false };
  });
  const note = el('div', 'axis-note',
    (editable ? 'drag a block to re-time · ' : '') +
    'left → right = time · block width = frames · sum = ' + (total | 0) + ' frames' +
    (editable ? ' · ' : ' · click a block to trace it'));
  if (editable) {
    const reset = el('span', 'curve-reset', '↺ reset timing');
    reset.addEventListener('click', resetDurations);
    note.appendChild(reset);
  }
  body.appendChild(note);
}

// drag in progress: dx pixels -> ± frames on the grabbed block, live redraw
function dragDurAt(e) {
  const d = activeDrag; if (!d) return;
  const dx = e.clientX - d.x0;
  if (Math.abs(dx) > 3) d.moved = true;
  const dframes = Math.round((dx / d.rectW) * d.total);
  d.work[d.l] = Math.max(1, d.base + dframes);
  drawAlign(d.cv, d.work);
}
function onDurUp() {
  const d = activeDrag; activeDrag = null; if (!d) return;
  if (d.moved) {                    // keep the dragged blocks intact through the commit's re-render
    protectedStage = d.s.name;
    commitDuration(d.work);
    protectedStage = null;
  } else selectPhoneme(d.l);
}

// Draw a contour into its canvas from s.data, fixed [mn,mx] vertical range.
function drawCurve(cv, s, color, mn, mx) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 6;
  const d = s.data, n = d.length, range = (mx - mn) || 1;
  ctx.clearRect(0, 0, W, H);
  if (mn < 0 && mx > 0) {                       // zero baseline if it's in range
    const zy = H - pad - ((0 - mn) / range) * (H - 2 * pad);
    ctx.strokeStyle = '#222b38'; ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke();
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const i = Math.floor(x * n / W);
    const y = H - pad - ((d[i] - mn) / range) * (H - 2 * pad);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// F0_pred / N_pred are editable: drag to reshape the pitch / energy contour,
// then re-decode just the back half. Range is padded with upward headroom so a
// drag has somewhere to go; the drawn span is frozen for the duration of a card.
// Editable contour range: padded with upward headroom so a drag has somewhere to
// go. Recomputed from the current data on every draw / grab, so it stays correct
// even after the contour was reshaped in place.
function curveRange(s) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < s.data.length; i++) { const v = s.data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  mn = Math.min(0, mn); mx = mx * 1.35 + (mx <= 0 ? 1 : 0);
  if (mn === mx) { mn -= 1; mx += 1; }
  return [mn, mx];
}

function renderCurve(body, s, color) {
  const W = 1100, H = 130, pad = 6;
  const cv = mkCanvas(body, W, H);
  const editable = (s.name === 'F0_pred' || s.name === 'N_pred');
  let mn, mx;
  if (editable) { [mn, mx] = curveRange(s); }
  else {
    mn = Infinity; mx = -Infinity;
    for (let i = 0; i < s.data.length; i++) { const v = s.data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mn === mx) { mn -= 1; mx += 1; }
  }
  drawCurve(cv, s, color, mn, mx);

  const note = el('div', 'axis-note',
    (editable ? 'drag to reshape · ' : '') +
    'range ' + mn.toFixed(1) + ' … ' + mx.toFixed(1) + ' over ' + s.data.length + ' frames');
  if (editable) {
    const reset = el('span', 'curve-reset', '↺ reset');
    reset.addEventListener('click', () => resetSignal(s.name));
    note.appendChild(reset);
    cv.addEventListener('mousedown', (e) => {
      if (synthBusy || !lastTrace) return;
      e.preventDefault();                            // don't start a text selection
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }   // don't let a queued slider render fire mid-edit
      const [cmn, cmx] = curveRange(s);              // fresh range for the current contour
      activePaint = { cv, s, color, mn: cmn, mx: cmx, W, H, pad, lastI: -1, lastV: 0 };
      paintAt(e);
    });
  }
  body.appendChild(note);
}

// Map a mouse position onto (frame index, value) and paint it, linearly filling
// from the last painted column so a sweep draws a continuous contour.
function paintAt(e) {
  const p = activePaint; if (!p) return;
  const rect = p.cv.getBoundingClientRect();
  const xf = Math.max(0, Math.min(0.99999, (e.clientX - rect.left) / rect.width));
  const yPix = ((e.clientY - rect.top) / rect.height) * p.H;
  const n = p.s.data.length, i = Math.floor(xf * n);
  let v = p.mn + ((p.H - p.pad - yPix) / (p.H - 2 * p.pad)) * ((p.mx - p.mn) || 1);
  if (p.s.name === 'F0_pred') v = Math.max(0, v);     // pitch can't go negative
  if (p.lastI >= 0 && p.lastI !== i) {
    const a = Math.min(p.lastI, i), b = Math.max(p.lastI, i);
    const va = (p.lastI < i) ? p.lastV : v, vb = (p.lastI < i) ? v : p.lastV;
    for (let k = a; k <= b; k++) p.s.data[k] = va + (vb - va) * ((b === a) ? 0 : (k - a) / (b - a));
  } else { p.s.data[i] = v; }
  p.lastI = i; p.lastV = v;
  drawCurve(p.cv, p.s, p.color, p.mn, p.mx);
}

// Finish a drag: re-decode from the edited contours. (Installed once in init.)
function onPaintUp() {
  if (!activePaint) return;
  const name = activePaint.s.name;
  activePaint = null;
  protectedStage = name;  // keep the contour the user drew intact through the commit's re-render
  commitEdit();
  protectedStage = null;
}

function snapshotPredicted(r) {
  const f = r.stages.find((s) => s.name === 'F0_pred');
  const n = r.stages.find((s) => s.name === 'N_pred');
  const d = r.stages.find((s) => s.name === 'pred_dur');
  const dur = d ? Array.from(d.data, (v) => Math.round(v)) : null;
  predicted = {
    F0: f ? Float32Array.from(f.data) : null,
    N:  n ? Float32Array.from(n.data) : null,
    dur: dur ? dur.slice() : null,
  };
  curDur = dur ? dur.slice() : null;     // F0/N start aligned to the prediction
  edited = false;
}

// Shared tail: a decodeFrom result `r` carries the re-decoded back-half stages
// (gen_in/har/audio). Swap them into the trace, play the new audio, and redraw
// the whole pipeline so the edit propagates visually.
function applyBackHalf(r, label) {
  for (const st of r.stages) { const i = lastTrace.stages.findIndex((x) => x.name === st.name); if (i >= 0) lastTrace.stages[i] = st; }
  setClip(r.samples, r.sampleRate);
  setTimeout(play, 30);
  edited = true;
  const sc = $('#stages').scrollTop;
  renderStages(lastTrace.stages);
  $('#stages').scrollTop = sc;
  $('#run-meta').textContent = label + ' · ' +
    (r.samples.length / r.sampleRate).toFixed(2) + 's · ↺ reset to restore';
  capturePinnedEdit();    // remember this edit as a delta, to ride onto the next voice
}

// Re-run only the decoder back half from the (possibly edited) asr/F0/N grids
// the trace already holds — synchronous, so guard against a background synth.
function commitEdit() {
  if (synthBusy || !kokoro || !voice || !lastTrace) return;
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const asr = get('asr'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes');
  if (!asr || !F0 || !N || !ph) { setBadge('edit: trace is missing stages', true); return; }
  let r;
  synthBusy = true;
  try { r = kokoro.decodeFrom(voice, asr.data, F0.data, N.data, ph.w, { trace: true }); }
  catch (e) { synthBusy = false; setBadge('decodeFrom: ' + e.message, true); return; }
  synthBusy = false;
  applyBackHalf(r, 'pitch/energy edited');
}

// Resample a frame-rate contour from one per-phoneme duration set to another,
// preserving each phoneme's contour SHAPE while restretching its time span.
// src is at 2× frame rate (2*sum(srcDur)); returns 2*sum(dstDur).
function resampleByDur(src, srcDur, dstDur) {
  const L = srcDur.length;
  let sumD = 0; for (let l = 0; l < L; l++) sumD += dstDur[l];
  const dst = new Float32Array(2 * sumD);
  let sOff = 0, dOff = 0;
  for (let l = 0; l < L; l++) {
    const sLen = 2 * srcDur[l], dLen = 2 * dstDur[l];
    const sStart = 2 * sOff, dStart = 2 * dOff;
    for (let k = 0; k < dLen; k++) {
      if (sLen === 0) { dst[dStart + k] = 0; continue; }    // no source samples
      const sp = dLen <= 1 ? 0 : (k / (dLen - 1)) * (sLen - 1);
      const i0 = Math.floor(sp), i1 = Math.min(sLen - 1, i0 + 1), f = sp - i0;
      dst[dStart + k] = src[sStart + i0] * (1 - f) + src[sStart + i1] * f;
    }
    sOff += srcDur[l]; dOff += dstDur[l];
  }
  return dst;
}

// Re-time: the per-phoneme frame counts changed. Rebuild asr by re-expanding the
// text-encoder features (length regulate), resample the F0/N contours from the
// old timing to the new, and re-decode. No predictor re-run.
function commitDuration(newDur) {
  if (synthBusy || !kokoro || !voice || !lastTrace || !curDur) return;
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const ten = get('t_en'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes');
  if (!ten || !F0 || !N || !ph) { setBadge('re-time: trace is missing stages', true); return; }
  const H = kokoro.hiddenDim, L = newDur.length;
  const totalP = newDur.reduce((a, b) => a + b, 0);
  if (totalP < 1) return;

  // length-regulate t_en (channel-major data[c*L + l]) into asr[c*totalP + t]
  const td = ten.data, asrP = new Float32Array(H * totalP);
  let t = 0;
  for (let l = 0; l < L; l++) {
    const reps = newDur[l] | 0;
    for (let r = 0; r < reps; r++) { for (let c = 0; c < H; c++) asrP[c * totalP + t] = td[c * L + l]; t++; }
  }
  const F0p = resampleByDur(F0.data, curDur, newDur);
  const Np  = resampleByDur(N.data,  curDur, newDur);

  let r;
  synthBusy = true;
  try { r = kokoro.decodeFrom(voice, asrP, F0p, Np, ph.w, { trace: true }); }
  catch (e) { synthBusy = false; setBadge('decodeFrom: ' + e.message, true); return; }
  synthBusy = false;

  // commit the new front-stage grids so the next edit composes correctly
  const set = (nm, data, w) => { const s = get(nm); if (s) { s.data = data; if (w != null) s.w = w; } };
  set('asr', asrP, totalP);
  set('F0_pred', F0p, F0p.length);
  set('N_pred', Np, Np.length);
  set('pred_dur', Float32Array.from(newDur), L);
  curDur = newDur.slice();
  lastTrace.durations = newDur.slice();    // selectPhoneme reads this
  applyBackHalf(r, 'timing edited');
}

// ── retained prosody ─────────────────────────────────────────────────────────
// A prosody edit is the *difference* from the model's own prediction, not an
// absolute contour — so it can ride along onto a different voice. We store it as
//   · durRatio[l]  — per-phoneme timing multiplier (phoneme count L is fixed by
//                    the text, so this maps cleanly across voices)
//   · dF0 / dN     — additive contour deltas, anchored back onto the prediction's
//                    timing (baseDur) so resampleByDur can restretch them later
// Captured after every commit (manual or re-applied), so the pin always reflects
// the current on-screen prosody relative to the current voice's prediction.
function capturePinnedEdit() {
  const F0 = lastTrace && lastTrace.stages.find((s) => s.name === 'F0_pred');
  const N  = lastTrace && lastTrace.stages.find((s) => s.name === 'N_pred');
  if (!predicted || !predicted.F0 || !predicted.N || !predicted.dur || !curDur || !F0 || !N) {
    pinnedEdit = null; updatePinUI(); return;
  }
  const base = predicted.dur, L = base.length;
  const durRatio = new Float64Array(L);
  for (let l = 0; l < L; l++) durRatio[l] = curDur[l] / (base[l] || 1);
  // map the current contours back onto the prediction's timing, then subtract
  const f0AtPred = resampleByDur(F0.data, curDur, base);
  const nAtPred  = resampleByDur(N.data,  curDur, base);
  const dF0 = new Float32Array(predicted.F0.length);
  for (let i = 0; i < dF0.length; i++) dF0[i] = f0AtPred[i] - predicted.F0[i];
  const dN = new Float32Array(predicted.N.length);
  for (let i = 0; i < dN.length; i++) dN[i] = nAtPred[i] - predicted.N[i];
  pinnedEdit = { durRatio, dF0, dN, baseDur: base.slice() };
  updatePinUI();
}

// Re-apply the retained edit onto the *fresh* prediction the trace just produced:
// scale its durations by durRatio, add the contour deltas (restretched to this
// voice's spans), and re-decode the back half. Returns false (and drops the pin)
// if the text changed so the phoneme count no longer lines up.
function reapplyPinnedEdit() {
  if (!pinnedEdit || synthBusy || !kokoro || !voice || !lastTrace) return false;
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const ten = get('t_en'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes'), pd = get('pred_dur');
  if (!ten || !F0 || !N || !ph || !pd) return false;
  const predDur = Array.from(pd.data, (v) => Math.round(v));   // this voice's predicted timing
  const L = predDur.length;
  if (pinnedEdit.durRatio.length !== L) { pinnedEdit = null; updatePinUI(); return false; }

  const targetDur = new Array(L);
  for (let l = 0; l < L; l++) targetDur[l] = Math.max(1, Math.round(predDur[l] * pinnedEdit.durRatio[l]));
  const totalP = targetDur.reduce((a, b) => a + b, 0);
  if (totalP < 1) return false;

  // contours: prediction + delta (delta restretched from baseDur onto predDur),
  // then the whole thing retimed from predDur onto the edited targetDur
  const dF0v = resampleByDur(pinnedEdit.dF0, pinnedEdit.baseDur, predDur);
  const dNv  = resampleByDur(pinnedEdit.dN,  pinnedEdit.baseDur, predDur);
  const f0Ed = new Float32Array(F0.data.length), nEd = new Float32Array(N.data.length);
  for (let i = 0; i < f0Ed.length; i++) f0Ed[i] = Math.max(0, F0.data[i] + (dF0v[i] || 0));
  for (let i = 0; i < nEd.length; i++)  nEd[i]  = N.data[i] + (dNv[i] || 0);
  const F0f = resampleByDur(f0Ed, predDur, targetDur);
  const Nf  = resampleByDur(nEd,  predDur, targetDur);

  // length-regulate t_en (channel-major data[c*L + l]) onto the edited timing
  const H = kokoro.hiddenDim, td = ten.data, asrP = new Float32Array(H * totalP);
  let t = 0;
  for (let l = 0; l < L; l++) {
    const reps = targetDur[l] | 0;
    for (let r = 0; r < reps; r++) { for (let c = 0; c < H; c++) asrP[c * totalP + t] = td[c * L + l]; t++; }
  }

  let r;
  synthBusy = true;
  try { r = kokoro.decodeFrom(voice, asrP, F0f, Nf, ph.w, { trace: true }); }
  catch (e) { synthBusy = false; setBadge('reapply: ' + e.message, true); return false; }
  synthBusy = false;

  const set = (nm, data, w) => { const s = get(nm); if (s) { s.data = data; if (w != null) s.w = w; } };
  set('asr', asrP, totalP);
  set('F0_pred', F0f, F0f.length);
  set('N_pred', Nf, Nf.length);
  set('pred_dur', Float32Array.from(targetDur), L);
  curDur = targetDur.slice();
  lastTrace.durations = targetDur.slice();
  applyBackHalf(r, 'prosody retained');
  return true;
}

// Drop the retained edit and fall back to the model's own prosody.
function clearProsody() {
  pinnedEdit = null;
  updatePinUI();
  run();
}

function updatePinUI() {
  const p = $('#pin'); if (!p) return;
  p.textContent = '';
  if (!pinnedEdit) { p.style.display = 'none'; return; }
  p.style.display = '';
  p.appendChild(el('span', null, '✎ prosody pinned'));
  const x = el('span', 'pin-clear', '✕ clear');
  x.addEventListener('click', clearProsody);
  p.appendChild(x);
}

// Restore one contour (F0 or N) to the model's prediction, then re-decode.
function resetSignal(name) {
  if (!predicted || !lastTrace) return;
  const st = lastTrace.stages.find((s) => s.name === name);
  const src = name === 'F0_pred' ? predicted.F0 : predicted.N;
  if (st && src && st.data.length === src.length) st.data.set(src);
  commitEdit();
}

// Restore the predicted timing (resamples the current contours back).
function resetDurations() {
  if (!predicted || !predicted.dur) return;
  commitDuration(predicted.dur.slice());
}

// ── Tier 0 emotion: parametric prosody from a valence/arousal/dominance point ─
// No model and no training — emotion here is the PROSODY slice only: pitch
// register/range, energy, and speaking rate, as closed-form transforms of the
// predictor's own F0/N/duration output, re-decoded through the same decodeFrom
// boundary the manual editor uses. Voice-quality/timbre emotion (the rest of
// affect) lives in the decoder and is out of scope for Tier 0.
//
// Arousal is the dominant, reliable prosodic axis; valence and dominance leave
// only a weak prosodic trace (their main signature is timbre), so their gains
// are deliberately small — this panel is the prosodic component of affect, not
// the whole of it.
const EMO = {
  v: 0, a: 0, d: 0,                                          // valence / arousal / dominance, [-1, 1]
  pitchSemis:  (v, a, d) => 2.5 * a + 1.0 * v - 1.5 * d,     // register shift, semitones
  rangeScale:  (v, a, d) => clampf(1 + 0.45 * a + 0.20 * v - 0.15 * d, 0.5, 1.8),  // pitch range about the mean
  energyScale: (v, a, d) => clampf(1 + 0.35 * a + 0.20 * d, 0.5, 1.7),             // loudness
  rateScale:   (v, a, d) => clampf(1 + 0.30 * a - 0.12 * d, 0.6, 1.7),             // >1 = faster
  AXES: [
    ['v', 'valence',   'negative ↔ positive'],
    ['a', 'arousal',   'calm ↔ excited'],
    ['d', 'dominance', 'submissive ↔ assertive'],
  ],
};
function clampf(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function emotionActive() { return EMO.v !== 0 || EMO.a !== 0 || EMO.d !== 0; }

// Shift register + expand/contract pitch range in the log (musical) domain,
// anchored on the contour's own voiced geometric mean; unvoiced frames (F0≈0)
// stay unvoiced. Energy scales multiplicatively. Returns fresh arrays the same
// length / timing as the prediction.
function emoTransformContours(F0src, Nsrc) {
  const shift = Math.pow(2, EMO.pitchSemis(EMO.v, EMO.a, EMO.d) / 12);
  const rng = EMO.rangeScale(EMO.v, EMO.a, EMO.d);
  const eScale = EMO.energyScale(EMO.v, EMO.a, EMO.d);
  let sumLog = 0, nv = 0;
  for (let i = 0; i < F0src.length; i++) if (F0src[i] > 1e-3) { sumLog += Math.log(F0src[i]); nv++; }
  const meanLog = nv ? sumLog / nv : 0;
  const F0 = new Float32Array(F0src.length);
  for (let i = 0; i < F0src.length; i++) {
    const f = F0src[i];
    if (f <= 1e-3) { F0[i] = f; continue; }                 // keep unvoiced
    F0[i] = clampf(Math.exp(meanLog + (Math.log(f) - meanLog) * rng) * shift, 0, 1000);
  }
  const N = new Float32Array(Nsrc.length);
  for (let i = 0; i < Nsrc.length; i++) N[i] = Math.max(0, Nsrc[i] * eScale);
  return { F0, N };
}

// Re-derive the whole prosody surface from the model's CLEAN prediction for the
// current VAD point and re-decode in one pass. Always anchored on `predicted`,
// so dragging a slider never compounds. Routed through applyBackHalf, so the
// result is pinned and rides onto other voices like any manual edit.
function applyEmotion() {
  if (synthBusy || !kokoro || !voice || !lastTrace || !predicted ||
      !predicted.F0 || !predicted.N || !predicted.dur) return;
  if (!emotionActive()) { clearProsody(); return; }         // neutral → model's own prosody
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const ten = get('t_en'), ph = get('phonemes');
  if (!ten || !ph) { setBadge('emotion: trace is missing stages', true); return; }

  const baseDur = predicted.dur, L = baseDur.length;
  const rate = EMO.rateScale(EMO.v, EMO.a, EMO.d);
  const newDur = new Array(L);
  for (let l = 0; l < L; l++) newDur[l] = Math.max(1, Math.round(baseDur[l] / rate));
  const totalP = newDur.reduce((a, b) => a + b, 0);
  if (totalP < 1) return;

  // length-regulate t_en (channel-major data[c*L + l]) into asr[c*totalP + t]
  const H = kokoro.hiddenDim, td = ten.data, asrP = new Float32Array(H * totalP);
  let t = 0;
  for (let l = 0; l < L; l++) {
    const reps = newDur[l] | 0;
    for (let rr = 0; rr < reps; rr++) { for (let c = 0; c < H; c++) asrP[c * totalP + t] = td[c * L + l]; t++; }
  }
  // transform in the prediction's timing, then restretch to the new timing
  const { F0: F0t, N: Nt } = emoTransformContours(predicted.F0, predicted.N);
  const F0p = resampleByDur(F0t, baseDur, newDur);
  const Np  = resampleByDur(Nt,  baseDur, newDur);

  let r;
  synthBusy = true;
  try { r = kokoro.decodeFrom(voice, asrP, F0p, Np, ph.w, { trace: true }); }
  catch (e) { synthBusy = false; setBadge('decodeFrom: ' + e.message, true); return; }
  synthBusy = false;

  const set = (nm, data, w) => { const s = get(nm); if (s) { s.data = data; if (w != null) s.w = w; } };
  set('asr', asrP, totalP);
  set('F0_pred', F0p, F0p.length);
  set('N_pred', Np, Np.length);
  set('pred_dur', Float32Array.from(newDur), L);
  curDur = newDur.slice();
  lastTrace.durations = newDur.slice();
  applyBackHalf(r, 'emotion v' + EMO.v.toFixed(2) + ' a' + EMO.a.toFixed(2) + ' d' + EMO.d.toFixed(2));
}

// Coalesce a VAD slider drag into a single re-decode once it settles.
function scheduleEmotion() {
  if (emoTimer) clearTimeout(emoTimer);
  emoTimer = setTimeout(() => { emoTimer = 0; applyEmotion(); }, 140);
}

function buildEmotion() {
  const root = $('#emotion .emo-axes'); if (!root) return;
  root.textContent = ''; emoCells = {};
  for (const [key, name, hint] of EMO.AXES) {
    const cell = el('div', 'emo-axis');
    const head = el('div', 'emo-head');
    head.appendChild(el('span', 'emo-name', name));
    head.appendChild(el('span', 'emo-hint', hint));
    const val = el('span', 'emo-val', '0.00');
    head.appendChild(val);
    cell.appendChild(head);
    const r = document.createElement('input');
    r.type = 'range'; r.min = '-1'; r.max = '1'; r.step = '0.01'; r.value = '0';
    r.addEventListener('input', () => { EMO[key] = +r.value; val.textContent = EMO[key].toFixed(2); scheduleEmotion(); });
    cell.appendChild(r);
    cell._range = r; cell._val = val;
    emoCells[key] = cell;
    root.appendChild(cell);
  }
}

// Back to neutral: zero the axes and drop the pinned emotion (the prediction).
function resetEmotion() {
  EMO.v = EMO.a = EMO.d = 0;
  for (const k of ['v', 'a', 'd']) {
    if (emoCells[k]) { emoCells[k]._range.value = '0'; emoCells[k]._val.textContent = '0.00'; }
  }
  if (emoTimer) { clearTimeout(emoTimer); emoTimer = 0; }
  clearProsody();
}

function renderWave(body, s) {
  const W = 1100, H = 120, mid = H / 2;
  const cv = mkCanvas(body, W, H);
  const ctx = cv.getContext('2d');
  const d = s.data, n = d.length, per = Math.max(1, Math.floor(n / W));
  let peak = 1e-6;
  for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  ctx.strokeStyle = '#5aa0e0';
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0;
    const s0 = x * per, s1 = Math.min(n, s0 + per);
    for (let i = s0; i < s1; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    const y0 = mid - (hi / peak) * mid, y1 = mid - (lo / peak) * mid;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1 + 0.5); ctx.stroke();
  }
}

// Diverging colormap: blue (neg) -> dark (0) -> amber (pos).
function divColor(t) {
  t = t < -1 ? -1 : t > 1 ? 1 : t;
  const base = [14, 18, 24];
  const pos = [235, 150, 70], neg = [90, 175, 255];
  const to = t >= 0 ? pos : neg, m = Math.abs(t);
  return [
    base[0] + (to[0] - base[0]) * m,
    base[1] + (to[1] - base[1]) * m,
    base[2] + (to[2] - base[2]) * m,
  ];
}

// A reference signal (F0 / energy) from the current trace, resampled to width w.
function getRef(name, w) {
  if (!lastTrace) return null;
  const s = lastTrace.stages.find((x) => x.name === name);
  if (!s) return null;
  const ref = s.data, R = ref.length, out = new Float32Array(w);
  for (let x = 0; x < w; x++) out[x] = ref[Math.floor(x * R / w)];
  return out;
}

// Channel (row) order for a heatmap. 'native' = as stored; 'variance' = most
// active channels first; 'f0'/'energy' = sorted by correlation to that contour,
// so channels that track pitch/energy cluster together. This is the first
// "derived" view: a question-driven reordering of an opaque latent.
function channelOrder(s, mode) {
  const { h, w, data } = s;
  const idx = Array.from({ length: h }, (_, i) => i);
  if (mode === 'native') return idx;

  const score = new Float64Array(h);
  if (mode === 'variance') {
    for (let c = 0; c < h; c++) {
      const base = c * w; let m = 0;
      for (let x = 0; x < w; x++) m += data[base + x]; m /= w;
      let v = 0; for (let x = 0; x < w; x++) { const dd = data[base + x] - m; v += dd * dd; }
      score[c] = v;
    }
  } else {
    const ref = getRef(mode === 'f0' ? 'F0_pred' : 'N_pred', w);
    if (!ref) return idx;
    let rm = 0; for (let x = 0; x < w; x++) rm += ref[x]; rm /= w;
    let rv = 0; for (let x = 0; x < w; x++) { const dd = ref[x] - rm; rv += dd * dd; }
    rv = Math.sqrt(rv) || 1;
    for (let c = 0; c < h; c++) {
      const base = c * w; let m = 0;
      for (let x = 0; x < w; x++) m += data[base + x]; m /= w;
      let cov = 0, sv = 0;
      for (let x = 0; x < w; x++) { const a = data[base + x] - m; cov += a * (ref[x] - rm); sv += a * a; }
      score[c] = cov / ((Math.sqrt(sv) || 1) * rv);
    }
  }
  idx.sort((a, b) => score[b] - score[a]);
  return idx;
}

function renderHeat(body, s) {
  // robust z-score scale: subtract the mean, scale by 3σ, clip — so a few
  // outliers no longer crush the bulk to black (the bert_dur / gen_in problem).
  let m = 0; for (let i = 0; i < s.data.length; i++) m += s.data[i]; m /= s.data.length;
  let v = 0; for (let i = 0; i < s.data.length; i++) { const dd = s.data[i] - m; v += dd * dd; }
  const sd = Math.sqrt(v / s.data.length) || 1;

  const dispW = Math.min(s.w, 1100);
  const dispH = Math.max(120, Math.min(s.h, 420));   // give thin stages real height

  // row-ordering control
  const ctrl = el('div', 'heat-ctrl');
  ctrl.appendChild(el('span', 'ctrl-label', 'rows:'));
  const sel = document.createElement('select');
  [['native', 'native'], ['variance', 'by variance'],
   ['f0', 'by F0 corr'], ['energy', 'by energy corr']].forEach(([val, txt]) => {
    const o = document.createElement('option'); o.value = val; o.textContent = txt; sel.appendChild(o);
  });
  ctrl.appendChild(sel);
  body.appendChild(ctrl);

  const cv = mkCanvas(body, dispW, dispH);
  const ctx = cv.getContext('2d');
  const note = el('div', 'axis-note', '');
  body.appendChild(note);

  function draw(mode) {
    const order = channelOrder(s, mode);
    const img = ctx.createImageData(dispW, dispH);
    for (let y = 0; y < dispH; y++) {
      const sc = order[Math.floor(y * s.h / dispH)], base = sc * s.w;
      for (let x = 0; x < dispW; x++) {
        const sx = Math.floor(x * s.w / dispW);
        const c = divColor((s.data[base + sx] - m) / (3 * sd));
        const o = (y * dispW + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    note.textContent = 'rows = ' + s.h + ' (channel' + (mode === 'native' ? '' : ', ' + mode + '-ordered') +
      ')  ·  cols = ' + s.w + '  ·  z-scored: blue below-avg, amber above-avg (μ ' +
      m.toFixed(2) + ' σ ' + sd.toFixed(2) + ')';
  }
  sel.addEventListener('change', () => draw(sel.value));
  draw('native');
}

// ═══ audio ═════════════════════════════════════════════════════════════════
// bro's AudioContext is clip-based (broaudio), not Web Audio createBuffer.
//
// Threading note: createClip publishes the samples to the audio thread (a
// lock-free RCU hand-off), playClip triggers playback. Doing both in the same
// tick on every press re-uploads the buffer and fires it before the transfer
// has cycled — and leaks a clip per press. So we upload ONCE per synthesis
// (setClip, in run()'s onDone) and let Play just re-trigger the already-published
// clip; the auto-play after a run is deferred a few frames so the upload lands.
function setClip(samples, inRate) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const outRate = audioCtx.sampleRate || 48000;
    let buf;
    if (Math.abs(outRate - inRate) < 1) {
      buf = samples;
    } else {
      const ratio = outRate / inRate, n = Math.floor(samples.length * ratio);
      buf = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / ratio, j = t | 0, f = t - j;
        buf[i] = samples[j] * (1 - f) + (samples[j + 1] !== undefined ? samples[j + 1] : samples[j]) * f;
      }
    }
    if (clipId >= 0) { try { audioCtx.deleteClip(clipId); } catch (e) {} }
    clipId = audioCtx.createClip(buf, 1);
    clipSamples = buf.length;
    $('#btn-play').disabled = false;
  } catch (e) { setBadge('audio: ' + e.message, true); clipId = -1; clipSamples = 0; }
}
function play() {
  if (clipId < 0 || !audioCtx) return;
  try { audioCtx.playClip(clipId, 1.0, false); }
  catch (e) { setBadge('audio: ' + e.message, true); }
}

// ═══ small helpers ═════════════════════════════════════════════════════════
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function mkCanvas(body, w, h) {
  const wrap = el('div', 'canvas-wrap');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ov = el('div', 'flow-hl');
  wrap.appendChild(cv); wrap.appendChild(ov);
  body.appendChild(wrap);
  cv._overlay = ov;   // retrieved by renderStages to drive the flow highlight
  return cv;
}
function stats(d) {
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
  return { mn, mx, mean: d.length ? sum / d.length : 0 };
}

// ═══ wire up ═══════════════════════════════════════════════════════════════
function init() {
  // data source: browse a folder, or edit the path + Reload. Both re-detect the
  // layout and reload everything derived from it. (The seed dropdown, sliders and
  // clone adapters all come from the source, so picking one rebuilds them.)
  $('#btn-browse-data').addEventListener('click', () => {
    const d = browseFolder(paths.root); if (!d) return;
    $('#data-root').value = d; switchSource(d);
  });
  $('#data-root').addEventListener('change', () => setSource($('#data-root').value.trim()));
  $('#btn-reload').addEventListener('click', () => switchSource($('#data-root').value.trim()));
  $('#btn-browse-wav').addEventListener('click', () => {
    const f = browseFile('Audio|wav;flac;mp3;ogg;opus'); if (f) $('#ref-wav').value = f;
  });
  $('#btn-browse-qwen').addEventListener('click', () => {
    const d = browseFolder($('#qwen-dir').value.trim() || paths.qwen); if (d) $('#qwen-dir').value = d;
  });

  // voice designer — handlers no-op until a basis is loaded, so wire them once.
  $('#source').addEventListener('change', () => seedFrom($('#source').value, true));
  $('#btn-random').addEventListener('click', randomVoice);
  $('#btn-neutral').addEventListener('click', () => { $('#source').value = '__neutral__'; seedFrom('__neutral__', true); });
  $('#btn-clone').addEventListener('click', clone);
  $('#btn-save').addEventListener('click', saveVoice);
  $('#btn-run').addEventListener('click', run);
  $('#btn-play').addEventListener('click', play);
  buildEmotion();
  $('#btn-emo-neutral').addEventListener('click', resetEmotion);
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  // prosody-edit drag: one global pair so re-rendered cards never leak listeners
  window.addEventListener('mousemove', (e) => { if (activePaint) paintAt(e); else if (activeDrag) dragDurAt(e); });
  window.addEventListener('mouseup', () => { if (activePaint) onPaintUp(); else if (activeDrag) onDurUp(); });

  // Point at real data on this machine before the first load: the HTML default
  // is a Windows dev path, so probe the usual spots (and any remembered choice).
  const root = defaultRoot($('#data-root').value.trim());
  $('#data-root').value = root;
  switchSource(root);
}
init();
