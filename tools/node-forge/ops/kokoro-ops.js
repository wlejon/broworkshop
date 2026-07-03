// Node Forge — Kokoro op pack.
//
// Eight nodes wiring bro.tts's synchronous Kokoro surface
// (src/js/tts_bindings.cpp) into the graph — consolidating the seams four
// separate tts-labs each re-implemented. Deliberately scoped to the
// prosody (pitch/energy) editing seam only; per-phoneme duration/alignment
// editing and the channel-correlation heatmap probe (kokoro-lab's
// align.js/heat.js) are out of scope for this milestone.
//
//   kokoro-load ──(model-handle)──┬───────────────┬──────────────┬────┐
//                                  │               │               │    │
//   kokoro-basis ──(voice-basis)──►│               │               │    │
//                                  ▼               │               │    │
//                          kokoro-voice-design      │               │    │
//                          (basis-slider-map)        │               │    │
//                                  │ (voice-handle)  │               │    │
//   kokoro-voice ──(voice-handle)──┤(pick one path)  │               │    │
//                                                      │               │    │
//   kokoro-text ──(phoneme-ids)─────────────────────►kokoro-synthesize │    │
//                                                     │(audio)  │(trace)│    │
//                                                     ▼         ▼       │    │
//                                              audio-preview  kokoro-prosody-edit
//                                                                │(edited trace)
//                                                                ▼
//                                                          kokoro-redecode ──(audio)──► audio-preview
//
// bro.tts.loadKokoro(dir, opts) and every Kokoro instance method used here
// (loadVoice, createVoice, synthesizeTraced, decodeFrom) are synchronous
// when no onReady callback is given (docs/tts-api.js), so — like RAVE —
// every node fits the engine's existing synchronous exec() contract.
import { Shape } from "/app/lab/shape.js";
import { def, registerCategory } from "/app/lab/ops-registry.js";

  const _fs = (typeof require === 'function') ? require('fs') : null;

  function styleFromCoords(basis, coords) {
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

  // ---- kokoro-load ----------------------------------------------------------
  def({
    type: 'kokoro-load', label: 'Kokoro Load', cat: 'Kokoro', color: '#c084fc',
    desc: 'Load a Kokoro model (config.json + model.safetensors + voices/). dataRoot (optional) points the phonemizer at a brosoundml-data root for g2p/pos_tagger assets.',
    ins: [], outs: [{ name: 'kokoro', type: 'model-handle' }],
    params: [
      { key: 'dir', label: 'Model dir', type: 'text', def: '', browse: 'folder' },
      { key: 'dataRoot', label: 'Data root (g2p)', type: 'text', def: '', browse: 'folder' },
    ],
    shape(ins, p) {
      if (!p.dir) return 'set a model directory';
      return [Shape.tag('Kokoro · ' + p.dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop())];
    },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p, node) {
      const sig = p.dir + '|' + p.dataRoot;
      if (node._kokoroSig !== sig) {
        if (!bro.tts) throw new Error('bro.tts unavailable in this build');
        if (p.dataRoot) {
          bro.tts.setAssets({
            lexicon: p.dataRoot + '/g2p/lexicon_en_us.bin',
            posTagger: p.dataRoot + '/pos_tagger/model.bin',
            kokoroConfig: p.dir + '/config.json',
          });
        } else {
          bro.tts.setAssets({ kokoroConfig: p.dir + '/config.json' });
        }
        node._kokoro = bro.tts.loadKokoro(p.dir, { device: 'cuda' });
        node._kokoroSig = sig;
      }
      return [node._kokoro];
    },
  });

  // ---- kokoro-voice ----------------------------------------------------------
  def({
    type: 'kokoro-voice', label: 'Kokoro Voice', cat: 'Kokoro', color: '#c084fc',
    desc: 'Load a named voice pack (e.g. voices/af_heart.bin).',
    ins: [{ name: 'kokoro', type: 'model-handle' }], outs: [{ name: 'voice', type: 'voice-handle' }],
    params: [{ key: 'path', label: 'Voice file', type: 'text', def: '', browse: 'file', browseFilter: 'Voice|bin' }],
    shape(ins, p) {
      if (!p.path) return 'set a voice file path';
      return [Shape.tag('voice · ' + p.path.split(/[\\/]/).pop())];
    },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p, node) {
      const kokoro = ins[0];
      if (node._voiceSig !== p.path) {
        node._voice = kokoro.loadVoice(p.path);
        node._voiceSig = p.path;
      }
      return [node._voice];
    },
  });

  // ---- kokoro-basis ----------------------------------------------------------
  def({
    type: 'kokoro-basis', label: 'Kokoro Basis', cat: 'Kokoro', color: '#c084fc',
    desc: 'Load voice_basis.json — the PCA voice-design space (axes, ranges, named preset anchors) alongside the model.',
    ins: [], outs: [{ name: 'basis', type: 'voice-basis' }],
    params: [{ key: 'path', label: 'voice_basis.json', type: 'text', def: '', browse: 'file', browseFilter: 'Basis JSON|json' }],
    shape(ins, p) {
      if (!p.path) return 'set a voice_basis.json path';
      return [Shape.tag('basis (unread)')];
    },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p, node) {
      if (node._basisSig !== p.path) {
        if (!_fs) throw new Error('fs unavailable in this build');
        node._basisData = JSON.parse(_fs.readFileSync(p.path, 'utf-8'));
        node._basisSig = p.path;
      }
      return [node._basisData];
    },
  });

  // ---- kokoro-voice-design (basis-slider-map) --------------------------------
  def({
    type: 'kokoro-voice-design', label: 'Kokoro Voice Design', cat: 'Kokoro', color: '#c084fc',
    desc: 'Author a voice by position in the PCA basis — sliders per axis, a 2D map of the first two, named preset landmarks.',
    ins: [{ name: 'kokoro', type: 'model-handle' }, { name: 'basis', type: 'voice-basis' }],
    outs: [{ name: 'voice', type: 'voice-handle' }],
    params: [],
    panel: 'basis-slider-map',
    panelLabel: 'Voice design',
    panelConfig() {
      return {
        dim: (n) => (n._basis ? n._basis.k : 0),
        axisName: (n, i) => (n._basis.axisName && n._basis.axisName[i]) || ('PC' + (i + 1)),
        axisRange: (n, i) => { const r = n._basis.range[i]; return [r[0] * 1.15, r[1] * 1.15]; },
        coords: (n) => n.params.coords,
        presets: (n) => n._basis.names.map((nm, idx) => ({ name: nm, coords: Array.from(n._basis.anchors[idx]) })),
        mapAxes: () => [0, 1],
      };
    },
    shape() { return [Shape.tag('voice (designed)')]; },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p, node) {
      const kokoro = ins[0], basis = ins[1];
      if (node._basisKSig !== basis.k) {
        node.params.coords = new Array(basis.k).fill(0);
        node._basisKSig = basis.k;
      }
      node._basis = basis;
      const style = styleFromCoords(basis, node.params.coords);
      node._voice = kokoro.createVoice(style, 'designed');
      return [node._voice];
    },
  });

  // ---- kokoro-text (phonemize) ------------------------------------------------
  def({
    type: 'kokoro-text', label: 'Kokoro Text', cat: 'Kokoro', color: '#c084fc',
    desc: 'Convert text into Kokoro\'s phoneme-id sequence (needs kokoro-load\'s assets configured first).',
    ins: [{ name: 'kokoro', type: 'model-handle' }], outs: [{ name: 'ids', type: 'phoneme-ids' }],
    params: [{ key: 'text', label: 'Text', type: 'text', def: 'Hello, Bro.' }],
    shape(ins, p) {
      if (!p.text) return 'enter some text';
      return [Shape.tag('"' + (p.text.length > 24 ? p.text.slice(0, 24) + '…' : p.text) + '"')];
    },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p) {
      const ids = bro.tts.phonemize(p.text);
      return [{ ids: ids, text: p.text }];
    },
  });

  // ---- kokoro-synthesize (with trace) ----------------------------------------
  def({
    type: 'kokoro-synthesize', label: 'Kokoro Synthesize', cat: 'Kokoro', color: '#c084fc',
    desc: 'Synthesize speech and capture the pipeline trace (asr, F0/energy predictions, phonemes) for prosody editing.',
    ins: [{ name: 'kokoro', type: 'model-handle' }, { name: 'voice', type: 'voice-handle' }, { name: 'ids', type: 'phoneme-ids' }],
    outs: [{ name: 'audio', type: 'audio-buffer' }, { name: 'trace', type: 'kokoro-trace' }],
    params: [{ key: 'speed', label: 'Speed', type: 'float', def: 1.0, min: 0.5, max: 2.0, step: 0.05 }],
    shape() { return [Shape.tag('audio (synthesized)'), Shape.tag('trace')]; },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p, node) {
      const kokoro = ins[0], voice = ins[1], phon = ins[2];
      const r = kokoro.synthesizeTraced(phon.ids, voice, { speed: p.speed });
      node._kokoro = kokoro; node._voice = voice;
      return [
        { samples: r.samples, sampleRate: r.sampleRate, channels: 1 },
        { stages: r.stages, durations: r.durations, hiddenDim: kokoro.hiddenDim },
      ];
    },
  });

  // ---- kokoro-prosody-edit (multi-curve-painter, F0 + energy) ----------------
  def({
    type: 'kokoro-prosody-edit', label: 'Kokoro Prosody Edit', cat: 'Kokoro', color: '#c084fc',
    desc: 'Paint the pitch (F0) and energy contours by hand before re-decoding just the back half.',
    ins: [{ name: 'trace', type: 'kokoro-trace' }], outs: [{ name: 'trace', type: 'kokoro-trace' }],
    params: [],
    panel: 'multi-curve-painter',
    panelLabel: 'Pitch / energy',
    panelConfig() {
      return {
        count: () => 2,
        label: (n, i) => (i === 0 ? 'pitch (F0)' : 'energy (N)'),
        get: (n, i) => (i === 0 ? n.params.f0 : n.params.energy),
        original: (n, i) => (i === 0 ? n._origF0 : n._origN),
        clamp: (n, i, v) => (i === 0 ? Math.max(0, v) : v),   // pitch can't go negative
      };
    },
    shape() { return [Shape.tag('trace (edited)')]; },
    stats() { return { params: 0, flops: 0 }; },
    // Rebuilds the editable plain-array contours (and their ghost baselines)
    // only when the upstream trace's stage lengths actually change — an
    // unrelated re-run (e.g. re-synthesizing the same text) must not discard
    // in-progress edits. node.params.f0/energy are plain number[] per the
    // save/load contract; converted to Float32Array only at this boundary.
    exec(T, ins, p, node) {
      const trace = ins[0];
      const find = (nm) => trace.stages.find((s) => s.name === nm);
      const F0 = find('F0_pred'), N = find('N_pred');
      if (!F0 || !N) throw new Error('trace is missing F0_pred/N_pred stages');
      const sig = F0.data.length + '|' + N.data.length;
      if (node._traceSig !== sig) {
        node.params.f0 = Array.from(F0.data);
        node.params.energy = Array.from(N.data);
        node._origF0 = Array.from(F0.data);
        node._origN = Array.from(N.data);
        node._traceSig = sig;
      }
      const editedF0 = Float32Array.from(node.params.f0);
      const editedN = Float32Array.from(node.params.energy);
      const stages = trace.stages.map((s) => {
        if (s.name === 'F0_pred') return Object.assign({}, s, { data: editedF0 });
        if (s.name === 'N_pred') return Object.assign({}, s, { data: editedN });
        return s;
      });
      return [{ stages: stages, durations: trace.durations, hiddenDim: trace.hiddenDim }];
    },
  });

  // ---- kokoro-redecode (back-half-only decodeFrom) ---------------------------
  def({
    type: 'kokoro-redecode', label: 'Kokoro Redecode', cat: 'Kokoro', color: '#c084fc',
    desc: 'Re-run only the decoder back half from the (possibly edited) asr/F0/N grids — skips plBERT, the text encoder, and the prosody predictor entirely.',
    ins: [{ name: 'kokoro', type: 'model-handle' }, { name: 'voice', type: 'voice-handle' }, { name: 'trace', type: 'kokoro-trace' }],
    outs: [{ name: 'audio', type: 'audio-buffer' }],
    params: [],
    shape() { return [Shape.tag('audio (redecoded)')]; },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins) {
      const kokoro = ins[0], voice = ins[1], trace = ins[2];
      const find = (nm) => trace.stages.find((s) => s.name === nm);
      const asr = find('asr'), F0 = find('F0_pred'), N = find('N_pred'), ph = find('phonemes');
      if (!asr || !F0 || !N || !ph) throw new Error('trace is missing asr/F0_pred/N_pred/phonemes stages');
      const r = kokoro.decodeFrom(voice, asr.data, F0.data, N.data, ph.w, { trace: false });
      return [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }];
    },
  });

  registerCategory('Kokoro');
