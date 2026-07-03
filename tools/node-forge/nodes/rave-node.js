// Node Forge — RAVE node: a full RAVE-lab dashboard on one card.
//
// Encode a tone/file into RAVE's per-latent-dim curves, paint them by hand,
// decode and hear it — no separate load/source/encode/curve-edit/decode
// nodes to wire up. bro.rave.loadRave/encode/decode are all synchronous
// (rave_bindings.cpp), so unlike Kokoro there's no async off-thread call to
// route the live-edit path through: recompute() below IS both the live
// path (called straight from a debounced UI handler) and exec()'s
// deterministic path (called by Run/continue()/tests) — one function, two
// callers, always in sync.
import { def, registerCategory } from "/app/lab/node-registry.js";
import { mountCurvePainter } from "/app/widgets/curve-painter.js";
import { ClipAudio } from "/lib/clip-audio.js";
import { Dialogs } from "/lib/dialogs.js";

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function seedDefaults(p) {
    if (p.dir === undefined) p.dir = '';
    if (p.kind === undefined) p.kind = 'harm';
    if (p.freq === undefined) p.freq = 220;
    if (p.secs === undefined) p.secs = 2.0;
    if (p.file === undefined) p.file = '';
    if (p.addNoise === undefined) p.addNoise = false;
    if (p.stereo === undefined) p.stereo = false;
    if (p.width === undefined) p.width = 1.0;
    if (p.autoplay === undefined) p.autoplay = true;
  }

  function ensureRave(node) {
    const p = node.params;
    if (node._raveDir !== p.dir) {
      node._rave = null; node._enc = null;
      if (p.dir) {
        if (!bro.rave) throw new Error('bro.rave unavailable in this build');
        node._rave = bro.rave.loadRave(p.dir, { device: 'cuda' });
      }
      node._raveDir = p.dir;
    }
    return node._rave;
  }

  function ensureSource(node, rave) {
    const p = node.params;
    const sig = p.kind + '|' + p.freq + '|' + p.secs + '|' + p.file + '|' + rave.sampleRate;
    if (node._srcSig !== sig) {
      let samples;
      if (p.kind === 'file') {
        if (!p.file) throw new Error('set a source file path');
        samples = ClipAudio.decodeFileToSource(p.file, rave.sampleRate);
        if (!samples) throw new Error('could not decode file: ' + p.file);
      } else {
        samples = ClipAudio.genTone(p.kind, p.freq, p.secs, rave.sampleRate);
      }
      node._src = samples;
      node._srcSig = sig;
      node._enc = null;
    }
    return node._src;
  }

  function ensureEncode(node, rave, samples) {
    if (!node._enc) {
      const enc = rave.encode(samples);
      node._enc = enc;
      const original = [];
      for (let c = 0; c < enc.nLatent; c++) {
        original.push(Array.from(enc.latent.subarray(c * enc.frames, (c + 1) * enc.frames)));
      }
      node._original = original;
      // Preserve hand-painted curves surviving a project reload (same model
      // + source, so the same shape) instead of clobbering them with a
      // fresh, un-edited encode; only reseed when the shape doesn't match.
      const existing = node.params.curves;
      const shapeOk = existing && existing.length === enc.nLatent &&
        (enc.nLatent === 0 || (existing[0] && existing[0].length === enc.frames));
      if (!shapeOk) node.params.curves = original.map((row) => row.slice());
    }
    return node._enc;
  }

  // The one recompute path — shared by the live UI and exec().
  function recompute(node) {
    const p = node.params;
    if (!p.dir) throw new Error('set a model directory');
    const rave = ensureRave(node);
    const samples = ensureSource(node, rave);
    const enc = ensureEncode(node, rave, samples);
    const flat = new Float32Array(enc.nLatent * enc.frames);
    for (let c = 0; c < enc.nLatent; c++) {
      const row = node.params.curves[c];
      for (let t = 0; t < enc.frames; t++) flat[c * enc.frames + t] = row[t];
    }
    const out = rave.decode(flat, enc.frames, {
      addNoise: p.addNoise, seed: 1,
      channels: p.stereo ? 2 : 1, stereoWidth: p.stereo ? p.width : 0,
    });
    return { samples: out.samples, sampleRate: out.sampleRate, channels: out.channels || 1 };
  }

  def({
    type: 'rave', label: 'RAVE Morph', cat: 'Audio', color: '#34d399',
    ins: [], outs: [{ name: 'audio', type: 'audio-buffer' }],

    exec(ins, params, node) { return [recompute(node)]; },

    mount(body, node, graph, api) {
      seedDefaults(node.params);

      // ---- Model & source (in the full-controls dialog — set once, rarely
      //      touched) --------------------------------------------------------
      const modelDet = el('details');
      const modelSum = el('summary', null, 'Model & source'); modelDet.appendChild(modelSum);

      const dirRow = el('div', 'form-row');
      dirRow.appendChild(el('span', 'form-label', 'Model dir'));
      const dirInput = el('input', 'form-input wide'); dirInput.type = 'text'; dirInput.value = node.params.dir;
      dirRow.appendChild(dirInput);
      const dirBrowse = el('button', 'tinybtn', '…'); dirBrowse.title = 'Browse…';
      dirBrowse.addEventListener('click', () => {
        const picked = Dialogs.browseFolder(dirInput.value);
        if (picked) { dirInput.value = picked; dirInput.dispatchEvent(new Event('change')); }
      });
      dirRow.appendChild(dirBrowse);
      modelDet.appendChild(dirRow);

      const kindRow = el('div', 'form-row');
      kindRow.appendChild(el('span', 'form-label', 'Source'));
      const kindSel = el('select', 'form-input');
      for (const k of ['sine', 'harm', 'saw', 'sweep', 'noise', 'file']) {
        const o = el('option', null, k); o.value = k; kindSel.appendChild(o);
      }
      kindSel.value = node.params.kind;
      kindRow.appendChild(kindSel);
      modelDet.appendChild(kindRow);

      const toneRow = el('div', 'form-row');
      toneRow.appendChild(el('span', 'form-label', 'Freq / secs'));
      const freqInput = el('input', 'form-input'); freqInput.type = 'number'; freqInput.value = node.params.freq;
      const secsInput = el('input', 'form-input'); secsInput.type = 'number'; secsInput.step = '0.1'; secsInput.value = node.params.secs;
      toneRow.appendChild(freqInput); toneRow.appendChild(secsInput);
      modelDet.appendChild(toneRow);

      const fileRow = el('div', 'form-row');
      fileRow.appendChild(el('span', 'form-label', 'File path'));
      const fileInput = el('input', 'form-input wide'); fileInput.type = 'text'; fileInput.value = node.params.file;
      fileRow.appendChild(fileInput);
      const fileBrowse = el('button', 'tinybtn', '…'); fileBrowse.title = 'Browse…';
      fileBrowse.addEventListener('click', () => {
        const picked = Dialogs.browseFile('Audio|wav;mp3;flac;ogg');
        if (picked) { fileInput.value = picked; fileInput.dispatchEvent(new Event('change')); }
      });
      fileRow.appendChild(fileBrowse);
      modelDet.appendChild(fileRow);

      function syncSourceVisibility() {
        const isFile = kindSel.value === 'file';
        toneRow.style.display = isFile ? 'none' : '';
        fileRow.style.display = isFile ? '' : 'none';
      }
      syncSourceVisibility();
      api.dialogBody.appendChild(modelDet);

      // ---- curve painter — the point of the node. The mini card shows one
      //      dim at a time (a picker); the dialog holds the full grid (every
      //      dim at once, for side-by-side editing) — both read/write the
      //      same node.params.curves arrays, so an edit in either place is
      //      visible in the other once it's shown again (see onDialogToggle
      //      below, which refreshes whichever one is about to appear). -----
      const dimRow = el('div', 'form-row');
      dimRow.appendChild(el('span', 'form-label', 'Latent dim'));
      const dimSel = el('select', 'form-input');
      dimRow.appendChild(dimSel);
      body.appendChild(dimRow);
      const cardCurveWrap = el('div');
      body.appendChild(cardCurveWrap);

      const dialogCurveWrap = el('div');

      // ---- Decode options (in the full-controls dialog) --------------------
      const decodeDet = el('details');
      decodeDet.appendChild(el('summary', null, 'Decode options'));
      const noiseRow = el('div', 'form-row');
      const noiseChk = el('input', 'form-check'); noiseChk.type = 'checkbox'; noiseChk.checked = node.params.addNoise;
      noiseRow.appendChild(noiseChk); noiseRow.appendChild(el('span', 'form-label', 'Add noise'));
      decodeDet.appendChild(noiseRow);
      const stereoRow = el('div', 'form-row');
      const stereoChk = el('input', 'form-check'); stereoChk.type = 'checkbox'; stereoChk.checked = node.params.stereo;
      stereoRow.appendChild(stereoChk); stereoRow.appendChild(el('span', 'form-label', 'Stereo'));
      decodeDet.appendChild(stereoRow);
      const widthRow = el('div', 'form-row');
      widthRow.appendChild(el('span', 'form-label', 'Stereo width'));
      const widthInput = el('input', 'form-input'); widthInput.type = 'range'; widthInput.min = '0'; widthInput.max = '3'; widthInput.step = '0.1'; widthInput.value = node.params.width;
      widthRow.appendChild(widthInput);
      decodeDet.appendChild(widthRow);
      function syncStereoVisibility() { widthRow.style.display = stereoChk.checked ? '' : 'none'; }
      syncStereoVisibility();
      api.dialogBody.appendChild(dialogCurveWrap);
      api.dialogBody.appendChild(decodeDet);

      // ---- output: waveform + play (always visible) ------------------------
      const outSec = el('div', 'audio-preview');
      const outCv = document.createElement('canvas'); outCv.className = 'curve-canvas';
      outSec.appendChild(outCv);
      const outControls = el('div', 'audio-preview-controls');
      const playBtn = el('button', 'tinybtn', '▶ Play'); playBtn.disabled = true;
      const autoplayLbl = el('label', null, '');
      const autoplayChk = el('input', 'form-check'); autoplayChk.type = 'checkbox'; autoplayChk.checked = node.params.autoplay;
      autoplayLbl.appendChild(autoplayChk); autoplayLbl.appendChild(document.createTextNode(' autoplay'));
      const info = el('span', 'curve-stats', 'no audio yet — set a model directory');
      outControls.appendChild(playBtn); outControls.appendChild(autoplayLbl); outControls.appendChild(info);
      outSec.appendChild(outControls);
      body.appendChild(outSec);

      playBtn.addEventListener('click', () => ClipAudio.playClipId(node._clipId != null ? node._clipId : -1));
      autoplayChk.addEventListener('change', () => { node.params.autoplay = autoplayChk.checked; });

      function publishOutput(out) {
        node._out = [out];
        node._ran = true;
        ClipAudio.drawWaveform(outCv, out.samples, out.channels, '#ffcf6b');
        const secs = (out.samples.length / out.channels / out.sampleRate).toFixed(2);
        info.textContent = secs + 's · ' + out.sampleRate + 'Hz' + (out.channels > 1 ? ' × ' + out.channels : '');
        playBtn.disabled = false;
        node._clipId = ClipAudio.publishClip(node._clipId != null ? node._clipId : -1, out.samples, out.channels, out.sampleRate);
        if (node.params.autoplay) ClipAudio.playClipId(node._clipId);
      }

      let selectedDim = 0;
      function rebuildDimPicker() {
        dimSel.textContent = '';
        const n = node._enc ? node._enc.nLatent : 0;
        for (let i = 0; i < n; i++) { const o = el('option', null, 'dim ' + i); o.value = String(i); dimSel.appendChild(o); }
        if (selectedDim >= n) selectedDim = 0;
        dimSel.value = String(selectedDim);
      }
      function rebuildCardCurve() {
        cardCurveWrap.textContent = '';
        const cfg = {
          count: (n) => (n._enc ? 1 : 0),
          label: () => 'dim ' + selectedDim,
          get: (n) => n.params.curves && n.params.curves[selectedDim],
          original: (n) => n._original && n._original[selectedDim],
        };
        cardCurveWrap.appendChild(mountCurvePainter(node, cfg, { onEdit() { scheduleLiveDecode(); } }));
      }
      function rebuildDialogCurve() {
        dialogCurveWrap.textContent = '';
        const cfg = {
          count: (n) => (n._enc ? n._enc.nLatent : 0),
          label: (n, i) => 'dim ' + i,
          get: (n, i) => n.params.curves && n.params.curves[i],
          original: (n, i) => n._original && n._original[i],
        };
        dialogCurveWrap.appendChild(mountCurvePainter(node, cfg, { onEdit() { scheduleLiveDecode(); } }));
      }
      dimSel.addEventListener('change', () => { selectedDim = parseInt(dimSel.value, 10) || 0; rebuildCardCurve(); });
      // Refresh whichever curve view is about to become visible again, so an
      // edit made in one (card or dialog) is reflected in the other — the
      // mini card and dialog are only ever interactive one at a time (the
      // dialog's backdrop blocks the card underneath while open).
      api.onDialogToggle((open) => { if (open) rebuildDialogCurve(); else rebuildCardCurve(); });

      let liveTimer = 0;
      function scheduleLiveDecode() {
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => {
          try {
            const t0 = performance.now();
            const out = recompute(node);
            api.invalidate(node, [out], performance.now() - t0);
            publishOutput(out);
            api.setBadge('ready · ' + node._enc.nLatent + ' latent', false);
          } catch (e) { api.setBadge(String(e && e.message || e), true); }
        }, 40);
      }

      // model/source/decode-option changes: recompute (may need a fresh
      // encode + fresh curve panel), then redraw output. Not debounced —
      // these are discrete 'change' events, not a continuous drag.
      function applyStructuralChange() {
        node.params.dir = dirInput.value;
        node.params.kind = kindSel.value;
        node.params.freq = parseFloat(freqInput.value) || 0;
        node.params.secs = parseFloat(secsInput.value) || 0;
        node.params.file = fileInput.value;
        node.params.addNoise = noiseChk.checked;
        node.params.stereo = stereoChk.checked;
        node.params.width = parseFloat(widthInput.value) || 0;
        syncSourceVisibility();
        syncStereoVisibility();
        if (!node.params.dir) { api.setBadge('', false); return; }
        try {
          const prevEnc = node._enc;
          api.setBadge('loading…', false);
          const t0 = performance.now();
          const out = recompute(node);
          if (node._enc !== prevEnc) { rebuildDimPicker(); rebuildCardCurve(); rebuildDialogCurve(); }   // model/source changed shape
          api.invalidate(node, [out], performance.now() - t0);
          publishOutput(out);
          api.setBadge('ready · ' + node._enc.nLatent + ' latent', false);
        } catch (e) { api.setBadge(String(e && e.message || e), true); }
        api.markDirty();
      }

      [dirInput, fileInput].forEach((i) => i.addEventListener('change', applyStructuralChange));
      [kindSel, freqInput, secsInput, noiseChk, stereoChk, widthInput].forEach((i) => i.addEventListener('change', applyStructuralChange));
      widthInput.addEventListener('input', () => { syncStereoVisibility(); });

      rebuildDimPicker(); rebuildCardCurve(); rebuildDialogCurve();
      if (node.params.dir) applyStructuralChange();   // populate on load (a saved graph reopening)
    },
  });

  registerCategory('Audio');
