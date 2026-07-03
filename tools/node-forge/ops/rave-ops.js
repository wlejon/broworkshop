// Node Forge — RAVE op pack.
//
// The first real audio domain: RAVE (magenta-realtime style neural audio
// codec) as six nodes wiring together bro.rave's synchronous load/encode/
// decode surface (src/js/rave_bindings.cpp) with the generic curve-painter
// and audio-preview panel widgets.
//
//   rave-load ──────────────────────────────┬──────────────┬───────────┐
//        │ (model-handle)                    │              │           │
//        ▼                                   ▼              ▼           │
//   rave-source ──(audio-buffer)──► rave-encode ──(audio-latent-grid)──►│
//                                                                        │
//   rave-curve-edit ──(edited audio-latent-grid)──► rave-decode ◄───────┘
//                                                         │ (audio-buffer)
//                                                         ▼
//                                                   audio-preview
//
// bro.rave.loadRave(dir, opts) is SYNCHRONOUS when opts has no onReady
// callback (see rave_bindings.cpp:252) — it blocks on the file-IO + GPU
// upload and returns the Rave handle directly, so every node here fits the
// engine's existing synchronous exec(T, ins, params, node) -> outs
// contract with no async plumbing needed.
import { Shape } from "/app/lab/shape.js";
import { def, registerCategory } from "/app/lab/ops-registry.js";
import { ClipAudio } from "/lib/clip-audio.js";

  // ---- rave-load ----------------------------------------------------------
  def({
    type: 'rave-load', label: 'RAVE Load', cat: 'RAVE', color: '#34d399',
    desc: 'Load a converted RAVE model (a directory with config.json + model.safetensors).',
    ins: [], outs: [{ name: 'rave', type: 'model-handle' }],
    params: [{ key: 'dir', label: 'Model dir', type: 'text', def: '', browse: 'folder' }],
    shape(ins, p) {
      if (!p.dir) return 'set a model directory';
      return [Shape.tag('RAVE · ' + p.dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop())];
    },
    stats() { return { params: 0, flops: 0 }; },
    // cached like tensor-ops.js's weight builds: only reloads when the
    // directory param actually changes, so re-running the graph after an
    // unrelated downstream edit doesn't reload the model from disk.
    exec(T, ins, p, node) {
      if (node._raveSig !== p.dir) {
        if (!bro.rave) throw new Error('bro.rave unavailable in this build');
        node._rave = bro.rave.loadRave(p.dir, { device: 'cuda' });
        node._raveSig = p.dir;
      }
      return [node._rave];
    },
  });

  // ---- rave-source ----------------------------------------------------------
  def({
    type: 'rave-source', label: 'RAVE Source', cat: 'RAVE', color: '#34d399',
    desc: 'A synthesized tone or an audio file, resampled to the model\'s rate — the raw signal RAVE will encode.',
    ins: [{ name: 'rave', type: 'model-handle' }], outs: [{ name: 'audio', type: 'audio-buffer' }],
    params: [
      { key: 'kind', label: 'Source', type: 'select', def: 'harm', options: ['sine', 'harm', 'saw', 'sweep', 'noise', 'file'] },
      { key: 'freq', label: 'Freq (Hz)', type: 'float', def: 220, min: 20, max: 4000 },
      { key: 'secs', label: 'Duration (s)', type: 'float', def: 2.0, min: 0.1, max: 10 },
      { key: 'file', label: 'File path', type: 'text', def: '', browse: 'file', browseFilter: 'Audio|wav;mp3;flac;ogg' },
    ],
    shape(ins, p) {
      if (p.kind === 'file' && !p.file) return 'set a file path';
      return [Shape.tag((p.kind === 'file' ? 'file' : p.kind) + ' · ' + Number(p.secs).toFixed(1) + 's')];
    },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p, node) {
      const rave = ins[0];
      const sig = p.kind + '|' + p.freq + '|' + p.secs + '|' + p.file + '|' + rave.sampleRate;
      if (node._srcSig !== sig) {
        let samples;
        if (p.kind === 'file') {
          samples = ClipAudio.decodeFileToSource(p.file, rave.sampleRate);
          if (!samples) throw new Error('could not decode file: ' + p.file);
        } else {
          samples = ClipAudio.genTone(p.kind, p.freq, p.secs, rave.sampleRate);
        }
        node._src = samples;
        node._srcSig = sig;
      }
      return [{ samples: node._src, sampleRate: rave.sampleRate, channels: 1 }];
    },
  });

  // ---- rave-encode ----------------------------------------------------------
  def({
    type: 'rave-encode', label: 'RAVE Encode', cat: 'RAVE', color: '#34d399',
    desc: 'Encode audio into RAVE\'s latent time-series — one time-series per latent dimension, PCA-sorted by variance.',
    ins: [{ name: 'rave', type: 'model-handle' }, { name: 'audio', type: 'audio-buffer' }],
    outs: [{ name: 'latent', type: 'audio-latent-grid' }],
    params: [],
    shape() { return [Shape.tag('latent (encoded)')]; },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins) {
      const rave = ins[0], audio = ins[1];
      const enc = rave.encode(audio.samples);
      return [{ latent: enc.latent, nLatent: enc.nLatent, frames: enc.frames }];
    },
  });

  // ---- rave-curve-edit --------------------------------------------------------
  def({
    type: 'rave-curve-edit', label: 'RAVE Curve Edit', cat: 'RAVE', color: '#34d399',
    desc: 'Paint each latent dimension by hand before decoding — dim 0/1 are usually the biggest, most interpretable controls (loudness, pitch); later dims carry timbre.',
    ins: [{ name: 'latent', type: 'audio-latent-grid' }], outs: [{ name: 'latent', type: 'audio-latent-grid' }],
    params: [],
    panel: 'multi-curve-painter',
    panelLabel: 'Latent curves',
    panelConfig() {
      return {
        count: (n) => (n._grid ? n._grid.nLatent : 0),
        label: (n, i) => 'dim ' + i,
        get: (n, i) => n.params.curves && n.params.curves[i],
        original: (n, i) => n._original && n._original[i],
      };
    },
    shape() { return [Shape.tag('latent (edited)')]; },
    stats() { return { params: 0, flops: 0 }; },
    // Rebuilds the editable plain-array curves (and the ghost baseline) only
    // when the upstream latent's shape actually changes — an unrelated
    // downstream re-run must not discard the user's in-progress edits.
    // node.params.curves are plain number[][] (not Float32Array) per the
    // save/load contract: widget-owned params must round-trip through
    // JSON.stringify, converting to/from Float32Array only here at the exec
    // boundary.
    exec(T, ins, p, node) {
      const grid = ins[0];
      const sig = grid.nLatent + '|' + grid.frames;
      if (node._gridSig !== sig) {
        const curves = [], original = [];
        for (let c = 0; c < grid.nLatent; c++) {
          const row = grid.latent.subarray(c * grid.frames, (c + 1) * grid.frames);
          curves.push(Array.from(row));
          original.push(Array.from(row));
        }
        node.params.curves = curves;
        node._original = original;
        node._gridSig = sig;
      }
      node._grid = grid;
      const flat = new Float32Array(grid.nLatent * grid.frames);
      for (let c = 0; c < grid.nLatent; c++) {
        const row = node.params.curves[c];
        for (let t = 0; t < grid.frames; t++) flat[c * grid.frames + t] = row[t];
      }
      return [{ latent: flat, nLatent: grid.nLatent, frames: grid.frames }];
    },
  });

  // ---- rave-decode ----------------------------------------------------------
  def({
    type: 'rave-decode', label: 'RAVE Decode', cat: 'RAVE', color: '#34d399',
    desc: 'Decode the (possibly edited) latent back into audio.',
    ins: [{ name: 'rave', type: 'model-handle' }, { name: 'latent', type: 'audio-latent-grid' }],
    outs: [{ name: 'audio', type: 'audio-buffer' }],
    params: [
      { key: 'addNoise', label: 'Add noise', type: 'bool', def: false },
      { key: 'stereo', label: 'Stereo', type: 'bool', def: false },
      { key: 'width', label: 'Stereo width', type: 'float', def: 1.0, min: 0, max: 3, step: 0.1 },
    ],
    shape() { return [Shape.tag('audio (decoded)')]; },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p) {
      const rave = ins[0], grid = ins[1];
      const out = rave.decode(grid.latent, grid.frames, {
        addNoise: p.addNoise, seed: 1,
        channels: p.stereo ? 2 : 1,
        stereoWidth: p.stereo ? p.width : 0,
      });
      return [{ samples: out.samples, sampleRate: out.sampleRate, channels: out.channels }];
    },
  });

  // ---- audio-preview ----------------------------------------------------------
  // Domain-agnostic sink — shared by every audio domain pack, not RAVE-only.
  def({
    type: 'audio-preview', label: 'Audio Preview', cat: 'Audio', color: '#f59e0b',
    desc: 'Waveform + playback for an audio-buffer.',
    ins: [{ name: 'audio', type: 'audio-buffer' }], outs: [],
    params: [],
    panel: 'audio-preview',
    panelLabel: 'Preview',
    panelConfig() {
      return { getBuffer: (n) => n._buf || null };
    },
    shape() { return [Shape.tag('preview')]; },
    stats() { return { params: 0, flops: 0 }; },
    exec(T, ins, p, node) {
      node._buf = ins[0];
      return [];
    },
  });

  ['RAVE', 'Audio'].forEach(registerCategory);
