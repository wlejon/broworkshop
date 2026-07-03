// Node Forge — Qwen-TTS node: a full qwen-tts-lab dashboard on one card.
//
// Net-new to node-forge (qwen-tts-lab was never decomposed into ops here).
// Qwen3-TTS is autoregressive over discrete RVQ codes — there is no editable
// prosody contour (Kokoro's seam); its real control seams are voice identity
// (one of three panels, following the loaded checkpoint's variant), sampling
// delivery, a codebook-0 logit-bias steer (staged straight from a click on
// the trace), and the AR trace itself (16xF code raster + per-frame
// confidence, via widgets/trace-view.js — shared with a future Kokoro trace
// upgrade, generalizing qwen-tts-lab/lib/render.js's persistent-card +
// hover-crosshair cross-highlight).
//
// Sync vs async: exec() (Run/continue()/tests/save-load) uses the SYNC
// QwenTtsModel.synthesize(text, opts) — trace:true returns stages in the
// same blocking call, no second pass needed (unlike Kokoro, whose trace
// needs a follow-up decodeFrom). The card's own live interaction uses the
// ASYNC bro.tts.synthesize(qwen, text, opts) two-pass-free form (one onDone,
// audio + trace together), debounced ~160ms per axis, matching
// qwen-tts-lab/lib/synth.js's scheduleLive.
//
// Not ported: qwen-tts-lab's gapless streaming queue (bro.tts.synthesizeStream
// + the sample-accurate chunk scheduler in lib/audio.js) and barge-in Stop.
// Real polish, and worth adding once a checkpoint is on this machine to
// verify timing against, but secondary to the identity/delivery/steer/trace
// seams below — Render (one settle-driven synth per change, autoplay) is
// the same pattern rave-node.js/kokoro-node.js already use.
import { def, registerCategory } from "/app/lab/node-registry.js";
import { mountBasisSliderMap } from "/app/widgets/basis-slider-map.js";
import { createTraceView } from "/app/widgets/trace-view.js";
import { ClipAudio } from "/lib/clip-audio.js";
import { Dialogs } from "/lib/dialogs.js";

  const _fs = require('fs');

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function pExists(p) { try { return _fs.existsSync(p); } catch (e) { return false; } }
  function pParent(p) { return p.replace(/[\\\/]+$/, '').replace(/[\\\/][^\\\/]*$/, ''); }
  function readJSON(p) { try { return JSON.parse(_fs.readFileSync(p, 'utf-8')); } catch (e) { return null; } }

  // A basis json lives beside the Base checkpoint; a CustomVoice/VoiceDesign
  // dir resolves it via its sibling 0.6B-Base or the shared parent qwen-tts dir.
  function readBasisJson(modelDir, name) {
    const parent = pParent(modelDir);
    for (const d of [modelDir, parent + '/0.6B-Base', parent]) {
      const b = readJSON(d + '/' + name);
      if (b) return b;
    }
    return null;
  }

  const VARIANT_DIRS = { cv: '0.6B-customvoice', vd: '1.7B-voicedesign', base: '0.6B-Base' };

  const INSTRUCT_PRESETS = [
    'a warm, low-pitched elderly storyteller',
    'a bright, energetic young woman, fast and upbeat',
    'a calm late-night radio host, deep and smooth',
    'a crisp British newsreader, measured and clear',
    'a breathy, soft-spoken whisper',
    'an excited sports announcer at full tilt',
  ];
  const INSTRUCT_GROUPS = [
    { name: 'character', kind: 'noun', tags: ['young woman', 'young man', 'elderly storyteller', 'narrator', 'radio host', 'newsreader', 'sports announcer', 'child'] },
    { name: 'tone', kind: 'adj', tags: ['warm', 'bright', 'dark', 'breathy', 'smooth', 'gravelly', 'nasal', 'husky'] },
    { name: 'pitch', kind: 'adj', tags: ['low-pitched', 'high-pitched', 'deep'] },
    { name: 'pace', kind: 'adj', tags: ['fast', 'measured', 'slow'] },
    { name: 'mood', kind: 'adj', tags: ['cheerful', 'calm', 'excited', 'somber', 'gentle', 'tense'] },
  ];
  const STEER_DEFAULT = -3;

  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // ── x-vector-space voice math (qwen-tts-lab/lib/designer.js + emotion.js + mascfem.js)
  function xvecFromCoords(basis, coords) {
    const { dim, k, mean, comps, std } = basis;
    const x = new Float32Array(dim);
    for (let d = 0; d < dim; d++) x[d] = mean[d];
    for (let i = 0; i < k; i++) {
      const c = (coords[i] || 0) * std[i]; if (!c) continue;
      const v = comps[i];
      for (let d = 0; d < dim; d++) x[d] += c * v[d];
    }
    return x;
  }
  function coordsFromXvec(basis, x) {
    const { dim, k, mean, comps, std } = basis;
    const c = new Float64Array(k);
    for (let i = 0; i < k; i++) {
      const v = comps[i]; let s = 0;
      for (let d = 0; d < dim; d++) s += (x[d] - mean[d]) * v[d];
      c[i] = s / (std[i] || 1);
    }
    return c;
  }
  function applyEmotion(x, node) {
    const eb = node._emotionBasis, p = node.params;
    if (!x || !eb) return x;
    let active = false; for (const e of eb.emotions) if (p.emoAlpha[e]) { active = true; break; }
    if (!active) return x;
    const out = Float32Array.from(x);
    for (const e of eb.emotions) {
      const a = p.emoAlpha[e] || 0; if (!a) continue;
      const f = eb.full[e]; if (!f) continue;
      for (let d = 0; d < out.length; d++) out[d] += a * f[d];
    }
    return out;
  }
  function applyMascFem(x, node) {
    const mb = node._mascFemBasis, p = node.params;
    if (!x || !mb || !p.mfAlpha) return x;
    const out = Float32Array.from(x); const f = mb.full.M;
    for (let d = 0; d < out.length; d++) out[d] += p.mfAlpha * f[d];
    return out;
  }
  function emotionActive(node) {
    const eb = node._emotionBasis; if (!eb) return false;
    const p = node.params;
    for (const e of eb.emotions) if (p.emoAlpha[e]) return true;
    return false;
  }
  function mascFemActive(node) { return !!(node._mascFemBasis && node.params.mfAlpha); }

  function designedXvec(node) { return node._voiceBasis ? xvecFromCoords(node._voiceBasis, node.params.coords) : null; }

  // The pure additive steer direction, sized to whichever basis is loaded —
  // for variants with no base x-vector to fold it into (CustomVoice).
  function voiceSteerVector(node) {
    if (!emotionActive(node) && !mascFemActive(node)) return null;
    const eb = node._emotionBasis, mb = node._mascFemBasis;
    let dim = (eb && eb.dim) || (mb && mb.dim) || 0;
    if (!dim && eb) for (const e of eb.emotions) { if (eb.full[e]) { dim = eb.full[e].length; break; } }
    if (!dim && mb && mb.full.M) dim = mb.full.M.length;
    if (!dim) return null;
    return applyMascFem(applyEmotion(new Float32Array(dim), node), node);
  }

  function currentVoiceOpts(node) {
    const p = node.params;
    if (node._variant === 'customvoice') {
      if (p.cvSource === 'designed') { const x = designedXvec(node); if (x) return { speakerVector: x }; }
      return { speaker: p.speaker };
    }
    if (node._variant === 'voicedesign') return { instruct: p.instruct };
    const x = designedXvec(node);
    return x ? { xvector: applyMascFem(applyEmotion(x, node), node) } : null;
  }

  function buildOpts(node) {
    const p = node.params;
    const voice = currentVoiceOpts(node);
    if (node._variant === 'base' && !voice) return null;
    const s = p.sampling;
    const opts = Object.assign({}, voice, {
      language: p.language,
      temperature: s.temperature, topK: s.topK, topP: s.topP, seed: s.seed,
      repetitionPenalty: s.repetitionPenalty, adaptive: s.adaptive,
    });
    const ids = Object.keys(p.steer);
    if (ids.length) { const lb = {}; for (const k of ids) lb[k] = p.steer[k]; opts.logitBias = lb; }
    if (node._variant === 'customvoice') { const vs = voiceSteerVector(node); if (vs) opts.voiceSteer = vs; }
    return opts;
  }

  function seedDefaults(p) {
    if (p.modelDir === undefined) p.modelDir = 'D:/projects/brosoundml/weights/qwen-tts/0.6B-customvoice';
    if (p.text === undefined) p.text = 'Hello there. This is a test of the pipeline.';
    if (p.speaker === undefined) p.speaker = '';
    if (p.language === undefined) p.language = 'english';
    if (p.instruct === undefined) p.instruct = INSTRUCT_PRESETS[0];
    if (p.coords === undefined) p.coords = [];
    if (p.cvSource === undefined) p.cvSource = 'preset';
    if (p.refWav === undefined) p.refWav = '';
    if (p.emoAlpha === undefined) p.emoAlpha = {};
    if (p.mfAlpha === undefined) p.mfAlpha = 0;
    if (p.steer === undefined) p.steer = {};
    if (p.sampling === undefined) p.sampling = { temperature: 0, topK: 0, topP: 1, seed: 0, repetitionPenalty: 1.05, adaptive: 0, seedLocked: false };
    if (p.autoplay === undefined) p.autoplay = true;
  }

  // ── checkpoint load — shared shape, two entry points (sync for exec(),
  //    async for the live UI, matching qwen-tts-lab's own choice of async
  //    load given how much heavier a Qwen checkpoint is to warm up than
  //    Kokoro/RAVE's near-instant sync loads).
  function afterLoad(node, dir) {
    const p = node.params;
    node._modelDirSig = dir;
    node._variant = node._qwen.variant;
    node._voiceBasis = null;
    const designerOn = (node._variant === 'base' || node._variant === 'customvoice');
    if (designerOn) {
      const b = readBasisJson(dir, 'qwen_voice_basis.json');
      if (b && b.comps && b.mean && b.std && b.k) {
        node._voiceBasis = b;
        if (!p.coords || p.coords.length !== b.k) p.coords = new Array(b.k).fill(0);
      }
    }
    node._emotionBasis = null;
    if (designerOn) {
      const eb = readBasisJson(dir, 'emotion_basis.json');
      if (eb && eb.full && eb.emotions && eb.emotions.length) node._emotionBasis = eb;
    }
    node._mascFemBasis = null;
    if (designerOn) {
      const mb = readBasisJson(dir, 'masc_fem_basis.json');
      if (mb && mb.full && mb.full.M) node._mascFemBasis = mb;
    }
  }
  function ensureLoadedSync(node) {
    const p = node.params;
    const dir = (p.modelDir || '').replace(/[\\\/]+$/, '');
    if (node._modelDirSig === dir && node._qwen) return node._qwen;
    if (!pExists(dir + '/config.json')) throw new Error('no config.json in ' + dir);
    node._qwen = bro.tts.loadQwen(dir);
    afterLoad(node, dir);
    return node._qwen;
  }

  def({
    type: 'qwen', label: 'Qwen TTS', cat: 'Audio', color: '#5ad1ff',
    ins: [], outs: [{ name: 'audio', type: 'audio-buffer' }],

    exec(ins, params, node) {
      ensureLoadedSync(node);
      const opts = buildOpts(node);
      if (!opts) throw new Error('design a voice first (enroll or random)');
      opts.trace = true;
      const r = node._qwen.synthesize(params.text, opts);
      node._lastTrace = r;
      return [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }];
    },

    mount(body, node, graph, api) {
      seedDefaults(node.params);
      const p = node.params;

      // ══ Model & data source ═══════════════════════════════════════════
      const modelDet = el('details'); modelDet.appendChild(el('summary', null, 'Model & checkpoint'));
      const dirRow = el('div', 'form-row');
      dirRow.appendChild(el('span', 'form-label', 'Checkpoint dir'));
      const dirInput = el('input', 'form-input wide'); dirInput.type = 'text'; dirInput.value = p.modelDir;
      dirRow.appendChild(dirInput);
      const dirBrowse = el('button', 'tinybtn', '…');
      dirBrowse.addEventListener('click', () => {
        const picked = Dialogs.browseFolder(dirInput.value);
        if (picked) { dirInput.value = picked; dirInput.dispatchEvent(new Event('change')); }
      });
      dirRow.appendChild(dirBrowse);
      modelDet.appendChild(dirRow);

      const chipRow = el('div', 'form-row');
      const chipBtns = {};
      for (const id of ['cv', 'vd', 'base']) {
        const b = el('button', 'tinybtn', id);
        b.addEventListener('click', () => { dirInput.value = chipBtns[id]._dir; dirInput.dispatchEvent(new Event('change')); });
        chipBtns[id] = b;
        chipRow.appendChild(b);
      }
      modelDet.appendChild(chipRow);
      const modelMeta = el('div', 'axis-note', '');
      modelDet.appendChild(modelMeta);
      body.appendChild(modelDet);

      function wireQuickChips(dir) {
        const root = pParent(dir);
        for (const [id, name] of Object.entries(VARIANT_DIRS)) {
          const full = root + '/' + name, ok = pExists(full + '/config.json');
          chipBtns[id].disabled = !ok;
          chipBtns[id].classList.toggle('active', ok && dir.replace(/[\\\/]+$/, '').endsWith('/' + name));
          chipBtns[id]._dir = full;
        }
      }

      // ══ Voice — one panel per variant ═══════════════════════════════════
      const voiceDet = el('details'); voiceDet.appendChild(el('summary', null, 'Voice'));
      const cvPanel = el('div');
      const speakerRow = el('div', 'form-row');
      const speakerSel = el('select', 'form-input wide');
      speakerRow.appendChild(speakerSel);
      const dialectTag = el('span', 'curve-stats', '');
      speakerRow.appendChild(dialectTag);
      cvPanel.appendChild(speakerRow);
      const cvSourceNote = el('div', 'axis-note', '');
      cvPanel.appendChild(cvSourceNote);
      voiceDet.appendChild(cvPanel);

      const vdPanel = el('div');
      const instructRow = el('div', 'form-row');
      const instructInput = el('input', 'form-input wide'); instructInput.type = 'text'; instructInput.value = p.instruct;
      instructRow.appendChild(instructInput);
      vdPanel.appendChild(instructRow);
      const instructPresets = el('div', 'form-row');
      for (const preset of INSTRUCT_PRESETS) {
        const c = el('button', 'tinybtn', preset.split(',')[0]); c.title = preset;
        c.addEventListener('click', () => { instructInput.value = preset; p.instruct = preset; run(); });
        instructPresets.appendChild(c);
      }
      vdPanel.appendChild(instructPresets);
      const tagHost = el('div');
      const instructAdj = new Set(); let instructNoun = null;
      const adjOrder = INSTRUCT_GROUPS.filter((g) => g.kind === 'adj').flatMap((g) => g.tags);
      function assembleInstruct() {
        const adjs = adjOrder.filter((a) => instructAdj.has(a));
        if (!adjs.length && !instructNoun) return '';
        return 'a ' + (adjs.length ? adjs.join(', ') + ' ' : '') + (instructNoun || 'voice');
      }
      for (const g of INSTRUCT_GROUPS) {
        const row = el('div', 'form-row');
        row.appendChild(el('span', 'form-label', g.name));
        for (const t of g.tags) {
          const c = el('button', 'tinybtn', t);
          c.addEventListener('click', () => {
            if (g.kind === 'noun') instructNoun = (instructNoun === t) ? null : t;
            else if (instructAdj.has(t)) instructAdj.delete(t); else instructAdj.add(t);
            instructInput.value = assembleInstruct();
            c.classList.toggle('active', g.kind === 'noun' ? instructNoun === t : instructAdj.has(t));
            p.instruct = instructInput.value; run();
          });
          row.appendChild(c);
        }
        tagHost.appendChild(row);
      }
      vdPanel.appendChild(tagHost);
      voiceDet.appendChild(vdPanel);

      const basePanel = el('div', 'axis-note', 'identity comes from Voice design, below — enroll a clip or go random.');
      voiceDet.appendChild(basePanel);
      body.appendChild(voiceDet);
      vdPanel.style.display = 'none';
      basePanel.style.display = 'none';

      const langRow = el('div', 'form-row');
      langRow.appendChild(el('span', 'form-label', 'Language'));
      const langSel = el('select', 'form-input');
      langRow.appendChild(langSel);
      voiceDet.insertBefore(langRow, basePanel);

      // ══ Voice design — the x-vector map (Base + CustomVoice) ═══════════════
      const designerDet = el('details'); designerDet.appendChild(el('summary', null, 'Voice design'));
      const designerBody = el('div'); designerDet.appendChild(designerBody);
      const cloneRow = el('div', 'form-row');
      cloneRow.appendChild(el('span', 'form-label', 'Clone .wav'));
      const wavInput = el('input', 'form-input wide'); wavInput.type = 'text'; wavInput.value = p.refWav;
      cloneRow.appendChild(wavInput);
      const wavBrowse = el('button', 'tinybtn', '…');
      wavBrowse.addEventListener('click', () => {
        const picked = Dialogs.browseFile('Audio|wav;mp3;flac;ogg');
        if (picked) { wavInput.value = picked; p.refWav = picked; }
      });
      cloneRow.appendChild(wavBrowse);
      const enrollBtn = el('button', 'tinybtn', '⤓ enroll');
      const randomBtn = el('button', 'tinybtn', '🎲 random');
      cloneRow.appendChild(enrollBtn); cloneRow.appendChild(randomBtn);
      designerDet.appendChild(cloneRow);
      const designerMeta = el('div', 'axis-note', '');
      designerDet.appendChild(designerMeta);
      body.appendChild(designerDet);
      designerDet.style.display = 'none';

      // ══ Emotion — learned x-vector directions (hidden without a basis) ═════
      const emoDet = el('details'); emoDet.appendChild(el('summary', null, 'Emotion ✦ learned'));
      const emoAxes = el('div'); emoDet.appendChild(emoAxes);
      const emoNeutralBtn = el('button', 'tinybtn', '○ none'); emoDet.appendChild(emoNeutralBtn);
      body.appendChild(emoDet);
      emoDet.style.display = 'none';

      // ══ Masc ↔ Fem (hidden without a basis) ═════════════════════════════
      const mfDet = el('details'); mfDet.appendChild(el('summary', null, 'Masc ✦ Fem'));
      const mfRow = el('div', 'mf-row');
      const mfFemLbl = el('span', 'mf-pole'); const mfMascLbl = el('span', 'mf-pole');
      const mfSlider = document.createElement('input'); mfSlider.type = 'range'; mfSlider.className = 'mf-range';
      const mfVal = el('span', 'mf-val', 'neutral');
      mfRow.appendChild(mfFemLbl); mfRow.appendChild(mfSlider); mfRow.appendChild(mfMascLbl); mfRow.appendChild(mfVal);
      mfDet.appendChild(mfRow);
      const mfNeutralBtn = el('button', 'tinybtn', '○ neutral'); mfDet.appendChild(mfNeutralBtn);
      body.appendChild(mfDet);
      mfDet.style.display = 'none';

      // ══ Delivery — sampling dials ═══════════════════════════════════════
      const deliveryDet = el('details'); deliveryDet.appendChild(el('summary', null, 'Delivery'));
      function dial(labelText, id, min, max, step, fmt) {
        const wrap = el('div', 'dial');
        const head = el('div', 'emo-head');
        head.appendChild(el('span', 'emo-name', labelText));
        const val = el('span', 'emo-val', '');
        head.appendChild(val);
        wrap.appendChild(head);
        const r = document.createElement('input');
        r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step);
        wrap.appendChild(r);
        deliveryDet.appendChild(wrap);
        return { r, val, fmt };
      }
      const dTemp = dial('temperature', 'temp', 0, 1.5, 0.05);
      const dTopk = dial('top-k', 'topk', 0, 200, 1);
      const dTopp = dial('top-p', 'topp', 0, 1, 0.01);
      const dRep = dial('repetition penalty', 'rep', 1, 2, 0.01);
      const dAdapt = dial('adaptive temp', 'adapt', 0, 2, 0.05);
      const seedRow = el('div', 'form-row');
      seedRow.appendChild(el('span', 'form-label', 'seed'));
      const seedInput = el('input', 'form-input'); seedInput.type = 'number';
      seedRow.appendChild(seedInput);
      const seedLockLbl = el('label', null, '');
      const seedLockChk = el('input', 'form-check'); seedLockChk.type = 'checkbox';
      seedLockLbl.appendChild(seedLockChk); seedLockLbl.appendChild(document.createTextNode(' lock'));
      seedRow.appendChild(seedLockLbl);
      const greedyBtn = el('button', 'tinybtn', '○ greedy'); seedRow.appendChild(greedyBtn);
      deliveryDet.appendChild(seedRow);
      const deliveryMeta = el('div', 'axis-note', '');
      deliveryDet.appendChild(deliveryMeta);
      body.appendChild(deliveryDet);

      // ══ Steer — codebook-0 logit bias ═══════════════════════════════════
      const steerDet = el('details'); steerDet.appendChild(el('summary', null, 'Steer'));
      const steerList = el('div', 'steer-list'); steerDet.appendChild(steerList);
      const steerRow = el('div', 'form-row');
      steerRow.appendChild(el('span', 'form-label', 'code'));
      const steerIdInput = el('input', 'form-input'); steerIdInput.type = 'number'; steerIdInput.min = '0'; steerIdInput.step = '1';
      steerRow.appendChild(steerIdInput);
      const steerAddBtn = el('button', 'tinybtn', '+ bias'); steerRow.appendChild(steerAddBtn);
      const steerClearBtn = el('button', 'tinybtn', 'clear'); steerRow.appendChild(steerClearBtn);
      steerDet.appendChild(steerRow);
      const steerMeta = el('div', 'axis-note', '');
      steerDet.appendChild(steerMeta);
      body.appendChild(steerDet);

      // ══ Pipeline trace ══════════════════════════════════════════════════
      const traceDet = el('details'); traceDet.appendChild(el('summary', null, 'Pipeline trace'));
      const traceWrap = el('div'); traceDet.appendChild(traceWrap);
      body.appendChild(traceDet);
      const traceView = createTraceView(traceWrap);

      // ══ Common: text + transport (always visible) ═══════════════════════
      const textRow = el('div', 'form-row');
      const textInput = el('input', 'form-input wide'); textInput.type = 'text'; textInput.value = p.text;
      textInput.placeholder = 'Type something to speak…';
      textRow.appendChild(textInput);
      const speakBtn = el('button', 'tinybtn', '▶'); speakBtn.title = 'Render';
      textRow.appendChild(speakBtn);
      body.appendChild(textRow);

      const outSec = el('div', 'audio-preview');
      const outCv = document.createElement('canvas'); outCv.className = 'curve-canvas';
      outSec.appendChild(outCv);
      const outControls = el('div', 'audio-preview-controls');
      const playBtn = el('button', 'tinybtn', '▶ Play'); playBtn.disabled = true;
      const wavBtn = el('button', 'tinybtn', '⤓ wav'); wavBtn.disabled = true;
      const autoplayLbl = el('label', null, '');
      const autoplayChk = el('input', 'form-check'); autoplayChk.type = 'checkbox'; autoplayChk.checked = p.autoplay;
      autoplayLbl.appendChild(autoplayChk); autoplayLbl.appendChild(document.createTextNode(' autoplay'));
      const info = el('span', 'curve-stats', 'no audio yet — set a checkpoint dir');
      outControls.appendChild(playBtn); outControls.appendChild(wavBtn); outControls.appendChild(autoplayLbl); outControls.appendChild(info);
      outSec.appendChild(outControls);
      body.appendChild(outSec);

      autoplayChk.addEventListener('change', () => { p.autoplay = autoplayChk.checked; });
      playBtn.addEventListener('click', () => ClipAudio.playClipId(node._clipId != null ? node._clipId : -1));
      wavBtn.addEventListener('click', () => {
        if (typeof showSaveFileDialog !== 'function' || !node._wavSamples) return;
        try {
          const sp = showSaveFileDialog('WAV Files|wav', 'qwen-tts.wav');
          if (sp) _fs.writeFileSync(/\.wav$/i.test(sp) ? sp : sp + '.wav', encodeWavPCM16(node._wavSamples, node._wavRate));
        } catch (e) { api.setBadge('save: ' + (e && e.message || e), true); }
      });
      function encodeWavPCM16(samples, rate) {
        const n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
        let q = 0;
        const w32 = (v) => { dv.setUint32(q, v, true); q += 4; };
        const w16 = (v) => { dv.setUint16(q, v, true); q += 2; };
        const ws = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(q++, s.charCodeAt(i)); };
        ws('RIFF'); w32(36 + n * 2); ws('WAVE'); ws('fmt '); w32(16); w16(1); w16(1); w32(rate); w32(rate * 2); w16(2); w16(16); ws('data'); w32(n * 2);
        for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); dv.setInt16(q, s < 0 ? s * 0x8000 : s * 0x7fff, true); q += 2; }
        return new Uint8Array(buf);
      }

      function publishAudio(samples, sampleRate) {
        node._wavSamples = samples; node._wavRate = sampleRate;
        node._clipId = ClipAudio.publishClip(node._clipId != null ? node._clipId : -1, samples, 1, sampleRate);
        ClipAudio.drawWaveform(outCv, samples, 1, '#ffcf6b');
        info.textContent = (samples.length / sampleRate).toFixed(2) + 's · ' + sampleRate + 'Hz';
        playBtn.disabled = false; wavBtn.disabled = false;
        if (p.autoplay) ClipAudio.playClipId(node._clipId);
      }

      // ── section visibility per variant ---------------------------------
      function syncVariantSections() {
        const v = node._variant;
        cvPanel.style.display = v === 'customvoice' ? '' : 'none';
        vdPanel.style.display = v === 'voicedesign' ? '' : 'none';
        basePanel.style.display = v === 'base' ? '' : 'none';
        langRow.style.display = v === 'voicedesign' ? 'none' : '';
        const designerOn = (v === 'base' || v === 'customvoice');
        designerDet.style.display = designerOn && node._voiceBasis ? '' : 'none';
        emoDet.style.display = designerOn && node._emotionBasis ? '' : 'none';
        mfDet.style.display = designerOn && node._mascFemBasis ? '' : 'none';
      }

      // ── voice-design map + sliders (widgets/basis-slider-map.js) --------
      let basisMapMounted = null;
      function rebuildDesigner() {
        designerBody.textContent = '';
        if (!node._voiceBasis) return;
        const basis = node._voiceBasis;
        const cfg = {
          dim: () => basis.k,
          axisName: (n, i) => (basis.axisName ? basis.axisName[i] : ('V' + (i + 1))),
          axisRange: (n, i) => [basis.range[i][0] * 1.15, basis.range[i][1] * 1.15],
          coords: () => p.coords,
          presets: () => (basis.names || []).map((nm, i) => ({ name: nm, coords: basis.anchors[i] })),
        };
        designerBody.appendChild(mountBasisSliderMap(node, cfg, {
          onEdit() { if (node._variant === 'customvoice') markDesigned(); updateDesignerMeta(); scheduleVoiceChange(); },
        }));
        updateDesignerMeta();
      }
      function updateDesignerMeta() {
        if (!node._voiceBasis) { designerMeta.textContent = ''; return; }
        const x = designedXvec(node);
        const norm = x ? Math.sqrt(x.reduce((s, v) => s + v * v, 0)) : 0;
        designerMeta.textContent = 'designed x-vector ‖' + norm.toFixed(2) + '‖';
        if (node._variant === 'customvoice') updateCvSourceNote();
      }
      function updateCvSourceNote() {
        if (node._variant !== 'customvoice') return;
        cvSourceNote.textContent = '';
        if (p.cvSource === 'designed') {
          cvSourceNote.appendChild(el('span', null, '◆ rendering the designed voice (slot override) · '));
          const back = el('span', 'tinybtn', '↺ use preset');
          back.style.cursor = 'pointer';
          back.addEventListener('click', () => { p.cvSource = 'preset'; updateCvSourceNote(); run(); });
          cvSourceNote.appendChild(back);
        } else {
          cvSourceNote.textContent = 'preset ‘' + (p.speaker || '') + '’ · or design a voice below';
        }
      }
      function markDesigned() { p.cvSource = 'designed'; updateCvSourceNote(); }

      enrollBtn.addEventListener('click', () => {
        const wav = wavInput.value.trim(); if (!wav || !node._qwen) return;
        try {
          const actx = ClipAudio.ensureCtx();
          const dec = actx.decodeAudioFile(wav);
          if (!dec) { api.setBadge('enroll: cannot decode ' + wav, true); return; }
          let mono = dec.samples;
          if (dec.channels === 2) { mono = new Float32Array(dec.numFrames); for (let i = 0; i < dec.numFrames; i++) mono[i] = 0.5 * (dec.samples[2 * i] + dec.samples[2 * i + 1]); }
          const x = node._qwen.embedSpeaker(mono, { sampleRate: dec.sampleRate });
          if (node._voiceBasis) { const c = coordsFromXvec(node._voiceBasis, x); for (let k = 0; k < node._voiceBasis.k; k++) p.coords[k] = c[k]; rebuildDesigner(); }
          if (node._variant === 'customvoice') markDesigned();
          api.setBadge('enrolled ' + wav.split(/[\\\/]/).pop(), false);
          run();
        } catch (e) { api.setBadge('enroll: ' + (e && e.message || e), true); }
      });
      randomBtn.addEventListener('click', () => {
        const basis = node._voiceBasis; if (!basis) { api.setBadge('no voice basis for this checkpoint', true); return; }
        for (let k = 0; k < basis.k; k++) {
          const g = gauss() * (0.5 + (basis.varExplained ? basis.varExplained[k] : 0.2) * 3);
          const [lo, hi] = basis.range[k];
          p.coords[k] = Math.max(lo * 1.15, Math.min(hi * 1.15, g));
        }
        rebuildDesigner();
        if (node._variant === 'customvoice') markDesigned();
        run();
      });

      // ── emotion / masc-fem panels ---------------------------------------
      function buildEmotion() {
        emoAxes.textContent = '';
        const eb = node._emotionBasis; if (!eb) return;
        for (const e of eb.emotions) {
          if (p.emoAlpha[e] === undefined) p.emoAlpha[e] = 0;
          const label = (eb.label && eb.label[e]) || e;
          const cell = el('div', 'emo-axis');
          const head = el('div', 'emo-head');
          const nm = el('span', 'emo-name', label); nm.style.cursor = 'pointer'; nm.title = 'default amount, zero the rest';
          head.appendChild(nm);
          const val = el('span', 'emo-val', p.emoAlpha[e].toFixed(2));
          head.appendChild(val);
          cell.appendChild(head);
          const r = document.createElement('input');
          r.type = 'range'; r.min = '0'; r.max = String(eb.alphaMax || 5); r.step = '0.05'; r.value = p.emoAlpha[e];
          r.addEventListener('input', () => { p.emoAlpha[e] = +r.value; val.textContent = p.emoAlpha[e].toFixed(2); scheduleDelivery(); });
          nm.addEventListener('click', () => {
            for (const k of eb.emotions) p.emoAlpha[k] = (k === e) ? (eb.defaultAlpha[e] || 2) : 0;
            buildEmotion(); run();
          });
          cell.appendChild(r);
          emoAxes.appendChild(cell);
        }
      }
      emoNeutralBtn.addEventListener('click', () => { const eb = node._emotionBasis; if (eb) for (const e of eb.emotions) p.emoAlpha[e] = 0; buildEmotion(); run(); });

      function buildMascFem() {
        const mb = node._mascFemBasis; if (!mb) return;
        const max = mb.alphaMax || 3;
        mfFemLbl.textContent = '← ' + (mb.label.F || 'feminine');
        mfMascLbl.textContent = (mb.label.M || 'masculine') + ' →';
        mfFemLbl.onclick = () => { p.mfAlpha = -(mb.defaultAlpha.F || 2); syncMf(); run(); };
        mfMascLbl.onclick = () => { p.mfAlpha = (mb.defaultAlpha.M || 2); syncMf(); run(); };
        mfSlider.min = String(-max); mfSlider.max = String(max); mfSlider.step = '0.05';
        mfSlider.oninput = () => { p.mfAlpha = +mfSlider.value; syncMf(); scheduleDelivery(); };
        syncMf();
      }
      function syncMf() {
        mfSlider.value = String(p.mfAlpha);
        mfVal.textContent = p.mfAlpha === 0 ? 'neutral' : ((p.mfAlpha > 0 ? 'masc ' : 'fem ') + Math.abs(p.mfAlpha).toFixed(2));
      }
      mfNeutralBtn.addEventListener('click', () => { p.mfAlpha = 0; syncMf(); run(); });

      // ── delivery dials ----------------------------------------------------
      function bindDial(d, key, fmt) {
        d.r.value = String(p.sampling[key]);
        d.val.textContent = fmt(p.sampling[key]);
        d.r.addEventListener('input', () => { p.sampling[key] = parseFloat(d.r.value); d.val.textContent = fmt(p.sampling[key]); updateDeliveryMeta(); scheduleDelivery(); });
      }
      bindDial(dTemp, 'temperature', (v) => v.toFixed(2));
      bindDial(dTopk, 'topK', (v) => String(v | 0));
      bindDial(dTopp, 'topP', (v) => v.toFixed(2));
      bindDial(dRep, 'repetitionPenalty', (v) => v.toFixed(2));
      bindDial(dAdapt, 'adaptive', (v) => v.toFixed(2));
      seedInput.value = String(p.sampling.seed);
      seedInput.addEventListener('input', () => { p.sampling.seed = parseInt(seedInput.value, 10) || 0; updateDeliveryMeta(); scheduleDelivery(); });
      seedLockChk.checked = p.sampling.seedLocked;
      seedLockChk.addEventListener('change', () => { p.sampling.seedLocked = seedLockChk.checked; });
      greedyBtn.addEventListener('click', () => {
        p.sampling.temperature = 0; p.sampling.topK = 0; p.sampling.topP = 1; p.sampling.adaptive = 0;
        dTemp.r.value = '0'; dTemp.val.textContent = '0.00';
        dTopk.r.value = '0'; dTopk.val.textContent = '0';
        dTopp.r.value = '1'; dTopp.val.textContent = '1.00';
        dAdapt.r.value = '0'; dAdapt.val.textContent = '0.00';
        updateDeliveryMeta(); run();
      });
      function updateDeliveryMeta() {
        const s = p.sampling;
        deliveryMeta.textContent = (s.temperature > 0 ? 'sampling · seed ' + s.seed + (s.seedLocked ? ' (locked)' : '') : 'greedy · deterministic') +
          (s.repetitionPenalty !== 1.05 ? ' · rep ' + s.repetitionPenalty.toFixed(2) : '') +
          (s.temperature > 0 && s.adaptive > 0 ? ' · adaptive ' + s.adaptive.toFixed(2) : '');
      }

      // ── steer (logit bias) -----------------------------------------------
      function renderSteer() {
        steerList.textContent = '';
        const ids = Object.keys(p.steer).map((k) => k | 0).sort((a, b) => a - b);
        if (!ids.length) {
          steerList.appendChild(el('span', 'curve-stats', 'no codes biased — click row 0 of the code raster, or add an id'));
        } else {
          for (const id of ids) {
            const row = el('div', 'steer-entry');
            row.appendChild(el('span', 'steer-id', 'code ' + id));
            const sl = document.createElement('input');
            sl.type = 'range'; sl.min = '-12'; sl.max = '12'; sl.step = '0.5'; sl.value = String(p.steer[id]);
            const val = el('span', 'steer-val', p.steer[id].toFixed(1));
            sl.addEventListener('input', () => { p.steer[id] = +sl.value; val.textContent = p.steer[id].toFixed(1); updateSteerMeta(); scheduleDelivery(); });
            row.appendChild(sl); row.appendChild(val);
            const x = el('button', 'tinybtn', '×'); x.addEventListener('click', () => { delete p.steer[id]; renderSteer(); run(); });
            row.appendChild(x);
            steerList.appendChild(row);
          }
        }
        updateSteerMeta();
      }
      function updateSteerMeta() {
        const n = Object.keys(p.steer).length;
        steerMeta.textContent = n ? n + ' code' + (n > 1 ? 's' : '') + ' biased on codebook 0' : 'favor (+) or forbid (−) specific Talker codes';
      }
      steerAddBtn.addEventListener('click', () => {
        const v = parseInt(steerIdInput.value, 10);
        if (!isFinite(v) || v < 0) { api.setBadge('enter a non-negative code id', true); return; }
        p.steer[v] = STEER_DEFAULT; steerIdInput.value = ''; renderSteer(); run();
      });
      steerClearBtn.addEventListener('click', () => { for (const k in p.steer) delete p.steer[k]; renderSteer(); run(); });
      function steerPick(frame, row, code) {
        if (row !== 0) { api.setBadge('logit bias steers codebook 0 only — click the top row', true); return; }
        p.steer[code] = STEER_DEFAULT; renderSteer();
        api.setBadge('staged code ' + code + ' (frame ' + frame + ')', false);
        run();
      }

      // ── trace rendering ---------------------------------------------------
      function rebuildTrace() {
        if (!node._lastTrace) return;
        const r = node._lastTrace;
        const codes = r.stages && r.stages.find((s) => s.name === 'codes');
        const conf = r.stages && r.stages.find((s) => s.name === 'c0_confidence');
        traceView.beginFrame();
        const present = [];
        if (codes) { traceView.renderCodes('codes', 'codes', '16 x F RVQ code stream — row 0 semantic (Talker), 1..15 acoustic', codes, { onPick: steerPick }); present.push('codes'); }
        if (conf) { traceView.renderConf('conf', 'confidence', "Talker top-1 confidence per frame — low = the model hedged", conf); present.push('conf'); }
        traceView.renderWave('audio', 'audio', 'output waveform — ' + (r.sampleRate / 1000) + ' kHz mono', r.samples, r.sampleRate, true);
        present.push('audio');
        traceView.clear(present);
      }

      // ── run / pump (async, mirroring qwen-tts-lab/lib/synth.js) ----------
      function setLoadStatus(msg, err) { modelMeta.textContent = msg; api.setBadge(err ? 'error' : (node._qwen ? 'ready' : ''), err); }

      function afterModelReady() {
        populateVoicePanel();
        rebuildDesigner();
        buildEmotion(); buildMascFem();
        syncVariantSections();
        setLoadStatus(node._variant + ' · ' + node._qwen.sampleRate / 1000 + ' kHz', false);
      }
      function populateVoicePanel() {
        speakerSel.textContent = '';
        let names = []; try { names = node._qwen.speakers() || []; } catch (e) {}
        for (const n of names) speakerSel.appendChild(el('option', null, n)).value = n;
        if (names.length && !p.speaker) p.speaker = names[0];
        speakerSel.value = p.speaker;
        try { dialectTag.textContent = node._qwen.speakerDialect(speakerSel.value) || ''; } catch (e) { dialectTag.textContent = ''; }
        p.cvSource = 'preset'; updateCvSourceNote();

        langSel.textContent = '';
        let langs = []; try { langs = node._qwen.languages() || []; } catch (e) {}
        if (!langs.length) langs = ['english'];
        for (const l of langs) langSel.appendChild(el('option', null, l)).value = l;
        langSel.value = langs.indexOf(p.language) >= 0 ? p.language : langs[0];
        p.language = langSel.value;

        instructInput.value = p.instruct;
      }
      speakerSel.addEventListener('change', () => {
        p.speaker = speakerSel.value; p.cvSource = 'preset';
        try { dialectTag.textContent = node._qwen.speakerDialect(speakerSel.value) || ''; } catch (e) {}
        updateCvSourceNote(); run();
      });
      langSel.addEventListener('change', () => { p.language = langSel.value; run(); });
      instructInput.addEventListener('change', () => { p.instruct = instructInput.value; run(); });

      let loadTimer = 0;
      function loadLive() {
        const dir = (p.modelDir || '').replace(/[\\\/]+$/, '');
        wireQuickChips(dir);
        node._qwen = null; node._lastTrace = null;
        if (!pExists(dir + '/config.json')) { setLoadStatus('no config.json in ' + dir, true); return; }
        setLoadStatus('loading checkpoint…', false);
        try {
          bro.tts.loadQwen(dir, {
            onReady: (q) => { node._qwen = q; afterLoad(node, dir); afterModelReady(); node._dirty = true; pump(); },
            onError: (m) => setLoadStatus('load failed: ' + m, true),
          });
        } catch (e) { setLoadStatus('load failed: ' + (e && e.message || e), true); }
      }

      function run() { node._dirty = true; pump(); }
      function pump() {
        if (node._synthBusy || !node._dirty || !node._qwen) return;
        const opts = buildOpts(node);
        if (!opts) { api.setBadge('design a voice first (enroll or random)', true); node._dirty = false; return; }
        node._dirty = false;
        opts.trace = true;
        const t0 = performance.now();
        node._synthBusy = true;
        try {
          bro.tts.synthesize(node._qwen, textInput.value, Object.assign(opts, {
            onDone: (r, info) => {
              node._synthBusy = false;
              if (info.error) { api.setBadge('synthesize: ' + info.error, true); if (node._dirty) pump(); return; }
              if (!info.cancelled) {
                node._lastTrace = r;
                publishAudio(r.samples, r.sampleRate);
                rebuildTrace();
                const out = [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }];
                api.invalidate(node, out, performance.now() - t0);
                api.setBadge('ready', false);
              }
              if (node._dirty) pump();
            },
          }));
        } catch (e) { node._synthBusy = false; api.setBadge('synthesize: ' + (e && e.message || e), true); }
      }
      let deliveryTimer = 0, voiceTimer = 0;
      function scheduleDelivery() { clearTimeout(deliveryTimer); deliveryTimer = setTimeout(run, 160); }
      function scheduleVoiceChange() { clearTimeout(voiceTimer); voiceTimer = setTimeout(run, 160); }

      // ── wiring: discrete 'change' triggers -------------------------------
      dirInput.addEventListener('change', () => { p.modelDir = dirInput.value; loadLive(); });
      textInput.addEventListener('change', () => { p.text = textInput.value; run(); });
      speakBtn.addEventListener('click', () => { p.text = textInput.value; run(); });

      if (p.modelDir) loadLive();
      else info.textContent = 'no audio yet — set a checkpoint dir';
    },
  });

  registerCategory('Audio');
