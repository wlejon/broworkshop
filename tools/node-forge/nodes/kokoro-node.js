// Node Forge — Kokoro node: a full kokoro-lab dashboard on one card.
//
// Consolidates kokoro-lab's whole pipeline (voice-space design, VAD prosody,
// learned timbre, masc/fem, prosody curve + duration/alignment editing with
// pinned-edit retention, the pipeline-trace probe) into one comprehensive
// card instead of a hand-wired chain of atomic nodes. All of kokoro-lab's
// module-level state (lib/state.js) becomes per-node fields (node._*) here,
// since a graph can host more than one Kokoro card at once.
//
// Sync vs async: exec() (Run/continue()/tests/save-load) uses the SYNC
// kokoro.synthesizeTraced()/decodeFrom() — deterministic, blocking is fine
// for a one-shot Run. The card's own live interaction (voice sliders, VAD/
// timbre/masc-fem drags, prosody curves, duration cells) instead calls the
// ASYNC bro.tts.synthesize()/decodeFrom() two-pass form (audio first, trace
// a beat later), exactly like kokoro-lab, so a drag never blocks the UI
// thread on Kokoro's much heavier forward pass (unlike RAVE's cheap
// encode/decode, which stayed synchronous even on the live path).
//
// Not ported: kokoro-lab's cross-stage data-flow highlight (click a phoneme,
// see its span light up at every stage + hear its audio slice) and the
// persistent-card/refresh-in-place optimization for the trace view — real
// polish, but secondary to the core interactive seams below. The trace
// section here rebuilds fresh each time a full trace lands, which is cheap
// enough at card scale.
import { def, registerCategory } from "/app/lab/node-registry.js";
import { mountCurvePainter } from "/app/widgets/curve-painter.js";
import { mountDurationCells } from "/app/widgets/duration-cells.js";
import { mountHeatmap } from "/app/widgets/heatmap.js";
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

  // ── data source (ported from kokoro-lab/lib/source.js) ------------------
  function detectSource(root) {
    root = (root || '').replace(/[\\\/]+$/, '');
    if (pExists(root + '/kokoro/config.json'))
      return { kind: 'data', root, model: root + '/kokoro', spkenc: root + '/qwen-tts/speaker-encoder' };
    if (pExists(root + '/weights/kokoro/config.json'))
      return { kind: 'sibling', root, model: root + '/weights/kokoro', spkenc: pParent(root) + '/brosoundml-data/qwen-tts/speaker-encoder' };
    if (pExists(root + '/config.json')) {
      const parent = pParent(root);
      if (pExists(parent + '/g2p/lexicon_en_us.bin'))
        return { kind: 'data', root: parent, model: root, spkenc: parent + '/qwen-tts/speaker-encoder' };
      const repo = pParent(parent);
      if (pExists(repo + '/weights/kokoro/config.json'))
        return { kind: 'sibling', root: repo, model: root, spkenc: pParent(repo) + '/brosoundml-data/qwen-tts/speaker-encoder' };
      return { kind: 'model', root, model: root, spkenc: parent + '/qwen-tts/speaker-encoder' };
    }
    return null;
  }
  function resolvePaths(root) {
    const det = detectSource(root);
    if (det) return det;
    root = (root || '').replace(/[\\\/]+$/, '');
    return { kind: 'data', root, model: root + '/kokoro', spkenc: root + '/qwen-tts/speaker-encoder' };
  }
  function configureAssets(paths) {
    if (paths.kind === 'sibling') bro.tts.setAssetRoot(paths.root);
    else if (paths.kind === 'data') bro.tts.setAssets({
      lexicon: paths.root + '/g2p/lexicon_en_us.bin',
      posTagger: paths.root + '/pos_tagger/model.bin',
      kokoroConfig: paths.root + '/kokoro/config.json',
    });
    else bro.tts.setAssets({ kokoroConfig: paths.model + '/config.json' });
  }
  function loadBridgeBin(model) {
    try {
      const ab = _fs.readFileSync(model + '/voice_bridge.bin');
      const buf = ab instanceof ArrayBuffer ? ab : ab.buffer;
      const iv = new Int32Array(buf, 0, 2); const D = iv[0], M = iv[1];
      let off = 8;
      const xm = new Float32Array(buf, off, D); off += 4 * D;
      const ym = new Float32Array(buf, off, M); off += 4 * M;
      const B = new Float32Array(buf, off, D * M);
      return { D, M, xm, ym, B };
    } catch (e) { return null; }
  }

  // ── voice-space math (kokoro-lab/lib/designer.js + clone.js) -------------
  function styleFromCoords(basis, coords) {
    const { dim, k, mean, comps, std } = basis;
    const s = new Float32Array(dim);
    for (let d = 0; d < dim; d++) s[d] = mean[d];
    for (let i = 0; i < k; i++) {
      const c = (coords[i] || 0) * std[i]; if (!c) continue;
      const v = comps[i];
      for (let d = 0; d < dim; d++) s[d] += c * v[d];
    }
    return s;
  }
  function addTimbre(style, emotionBasis, timbre) {
    if (!emotionBasis || !emotionBasis.full) return;
    for (const e of emotionBasis.emotions) {
      const a = timbre[e] || 0; if (!a) continue;
      const r = emotionBasis.full[e]; if (!r) continue;
      for (let d = 0; d < style.length; d++) style[d] += a * r[d];
    }
  }
  function addMascFem(style, mascFemBasis, mfAlpha) {
    if (!mascFemBasis || !mfAlpha) return;
    const f = mascFemBasis.full.M;
    for (let d = 0; d < style.length; d++) style[d] += mfAlpha * f[d];
  }
  function bridgeApply(bridge, x) {
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
  function coordsFromStyle(basis, style) {
    const { dim, k, mean, comps, std } = basis;
    const c = new Float64Array(k);
    for (let i = 0; i < k; i++) {
      const v = comps[i]; let s = 0;
      for (let d = 0; d < dim; d++) s += (style[d] - mean[d]) * v[d];
      c[i] = s / (std[i] || 1);
    }
    return c;
  }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // ── prosody helpers (kokoro-lab/lib/edit.js) -----------------------------
  function resampleByDur(src, srcDur, dstDur) {
    const L = srcDur.length;
    let sumD = 0; for (let l = 0; l < L; l++) sumD += dstDur[l];
    const dst = new Float32Array(2 * sumD);
    let sOff = 0, dOff = 0;
    for (let l = 0; l < L; l++) {
      const sLen = 2 * srcDur[l], dLen = 2 * dstDur[l];
      const sStart = 2 * sOff, dStart = 2 * dOff;
      for (let k = 0; k < dLen; k++) {
        if (sLen === 0) { dst[dStart + k] = 0; continue; }
        const sp = dLen <= 1 ? 0 : (k / (dLen - 1)) * (sLen - 1);
        const i0 = Math.floor(sp), i1 = Math.min(sLen - 1, i0 + 1), f = sp - i0;
        dst[dStart + k] = src[sStart + i0] * (1 - f) + src[sStart + i1] * f;
      }
      sOff += srcDur[l]; dOff += dstDur[l];
    }
    return dst;
  }
  function lengthRegulate(ten, H, L, newDur) {
    const totalP = newDur.reduce((a, b) => a + b, 0);
    const asrP = new Float32Array(H * totalP);
    let t = 0;
    for (let l = 0; l < L; l++) {
      const reps = newDur[l] | 0;
      for (let rr = 0; rr < reps; rr++) { for (let c = 0; c < H; c++) asrP[c * totalP + t] = ten[c * L + l]; t++; }
    }
    return { asrP, totalP };
  }
  const clampf = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
  const EMO_FN = {
    pitchSemis:  (v, a, d) => 2.5 * a + 1.0 * v - 1.5 * d,
    rangeScale:  (v, a, d) => clampf(1 + 0.45 * a + 0.20 * v - 0.15 * d, 0.5, 1.8),
    energyScale: (v, a, d) => clampf(1 + 0.35 * a + 0.20 * d, 0.5, 1.7),
    rateScale:   (v, a, d) => clampf(1 + 0.30 * a - 0.12 * d, 0.6, 1.7),
  };
  function emoTransformContours(F0src, Nsrc, emo) {
    const shift = Math.pow(2, EMO_FN.pitchSemis(emo.v, emo.a, emo.d) / 12);
    const rng = EMO_FN.rangeScale(emo.v, emo.a, emo.d);
    const eScale = EMO_FN.energyScale(emo.v, emo.a, emo.d);
    let sumLog = 0, nv = 0;
    for (let i = 0; i < F0src.length; i++) if (F0src[i] > 1e-3) { sumLog += Math.log(F0src[i]); nv++; }
    const meanLog = nv ? sumLog / nv : 0;
    const F0 = new Float32Array(F0src.length);
    for (let i = 0; i < F0src.length; i++) {
      const f = F0src[i];
      if (f <= 1e-3) { F0[i] = f; continue; }
      F0[i] = clampf(Math.exp(meanLog + (Math.log(f) - meanLog) * rng) * shift, 0, 1000);
    }
    const N = new Float32Array(Nsrc.length);
    for (let i = 0; i < Nsrc.length; i++) N[i] = Math.max(0, Nsrc[i] * eScale);
    return { F0, N };
  }

  function seedDefaults(p) {
    if (p.dataRoot === undefined) p.dataRoot = 'D:/projects/brosoundml-data';
    if (p.text === undefined) p.text = 'Hello there. This is a test of the pipeline.';
    if (p.coords === undefined) p.coords = [];
    if (p.emo === undefined) p.emo = { v: 0, a: 0, d: 0 };
    if (p.timbre === undefined) p.timbre = {};
    if (p.mfAlpha === undefined) p.mfAlpha = 0;
    if (p.refWav === undefined) p.refWav = '';
    if (p.spkEncDir === undefined) p.spkEncDir = '';
    if (p.autoplay === undefined) p.autoplay = true;
  }

  function emotionActive(emo) { return emo.v !== 0 || emo.a !== 0 || emo.d !== 0; }
  function timbreActive(basis, timbre) { if (!basis) return false; for (const e of basis.emotions) if (timbre[e]) return true; return false; }

  // ── the one voice-load / style / synth core, shared by exec() (sync) and
  //    the live UI (async) so both paths agree on what "the current voice" is.
  function ensureLoaded(node) {
    const p = node.params;
    const paths = resolvePaths(p.dataRoot);
    const sig = paths.model;
    if (node._modelSig !== sig) {
      configureAssets(paths);
      node._kokoro = bro.tts.loadKokoro(paths.model);
      node._basis = readJSON(paths.model + '/voice_basis.json');
      node._emotionBasis = readJSON(paths.model + '/emotion_basis.json');
      const mf = readJSON(paths.model + '/masc_fem_basis.json');
      node._mascFemBasis = (mf && mf.full && mf.full.M) ? mf : null;
      node._bridge = null; node._spkEnc = null;
      node._paths = paths;
      node._modelSig = sig;
      if (node._basis && (!p.coords || p.coords.length !== node._basis.k)) p.coords = new Array(node._basis.k).fill(0);
    }
    if (!node._kokoro) throw new Error('Kokoro model failed to load from ' + paths.model);
    if (!node._basis) throw new Error('voice_basis.json missing from ' + paths.model);
    return node._kokoro;
  }

  function currentStyle(node) {
    const p = node.params;
    const style = styleFromCoords(node._basis, p.coords);
    addTimbre(style, node._emotionBasis, p.timbre);
    addMascFem(style, node._mascFemBasis, p.mfAlpha);
    return style;
  }

  function rebuildVoice(node) {
    node._voice = node._kokoro.createVoice(currentStyle(node), 'designed');
    return node._voice;
  }

  // Sync path (exec(); also the "just landed a fresh trace" prep) — a full
  // forward pass, then Tier-0 emotion / a retained pin reapplied on top via a
  // second sync decodeFrom, if either is active. Matches how the async live
  // path composes the same two stages, just blocking.
  function synthSyncFull(node) {
    const p = node.params;
    const ids = bro.tts.phonemize(p.text);
    if (!ids || !ids.length) throw new Error('no phonemes for that text');
    let r = node._kokoro.synthesizeTraced(ids, node._voice, { trace: true });
    const get = (nm) => r.stages.find((s) => s.name === nm);
    const dur0 = get('pred_dur');
    node._predicted = {
      F0: Float32Array.from(get('F0_pred').data),
      N: Float32Array.from(get('N_pred').data),
      dur: Array.from(dur0.data, (v) => Math.round(v)),
    };
    node._curDur = node._predicted.dur.slice();
    if (node._pinnedEdit && node._pinnedEdit.durRatio.length === node._curDur.length) {
      r = applyPinSync(node, r);
    } else if (emotionActive(p.emo)) {
      r = applyEmotionSync(node, r);
    }
    return r;
  }

  function applyEmotionSync(node, r) {
    const p = node.params;
    const get = (nm) => r.stages.find((s) => s.name === nm);
    const ten = get('t_en'), ph = get('phonemes');
    const baseDur = node._predicted.dur, L = baseDur.length;
    const rate = EMO_FN.rateScale(p.emo.v, p.emo.a, p.emo.d);
    const newDur = baseDur.map((d) => Math.max(1, Math.round(d / rate)));
    const { asrP, totalP } = lengthRegulate(ten.data, node._kokoro.hiddenDim, L, newDur);
    const { F0: F0t, N: Nt } = emoTransformContours(node._predicted.F0, node._predicted.N, p.emo);
    const F0p = resampleByDur(F0t, baseDur, newDur), Np = resampleByDur(Nt, baseDur, newDur);
    const back = node._kokoro.decodeFrom(node._voice, asrP, F0p, Np, ph.w, { trace: true });
    mergeBackHalf(r, back, asrP, F0p, Np, newDur, totalP, L);
    node._curDur = newDur;
    return r;
  }

  function applyPinSync(node, r) {
    const p = node.params, pin = node._pinnedEdit;
    const get = (nm) => r.stages.find((s) => s.name === nm);
    const ten = get('t_en'), ph = get('phonemes'), pd = get('pred_dur');
    const predDur = Array.from(pd.data, (v) => Math.round(v)), L = predDur.length;
    const targetDur = predDur.map((d, l) => Math.max(1, Math.round(d * pin.durRatio[l])));
    const { asrP, totalP } = lengthRegulate(ten.data, node._kokoro.hiddenDim, L, targetDur);
    const dF0v = resampleByDur(pin.dF0, pin.baseDur, predDur), dNv = resampleByDur(pin.dN, pin.baseDur, predDur);
    const F0e = new Float32Array(get('F0_pred').data.length), Ne = new Float32Array(get('N_pred').data.length);
    for (let i = 0; i < F0e.length; i++) F0e[i] = Math.max(0, get('F0_pred').data[i] + (dF0v[i] || 0));
    for (let i = 0; i < Ne.length; i++) Ne[i] = get('N_pred').data[i] + (dNv[i] || 0);
    const F0f = resampleByDur(F0e, predDur, targetDur), Nf = resampleByDur(Ne, predDur, targetDur);
    const back = node._kokoro.decodeFrom(node._voice, asrP, F0f, Nf, ph.w, { trace: true });
    mergeBackHalf(r, back, asrP, F0f, Nf, targetDur, totalP, L);
    node._curDur = targetDur;
    return r;
  }

  function mergeBackHalf(r, back, asrP, F0p, Np, durArr, totalP, L) {
    for (const st of back.stages) { const i = r.stages.findIndex((x) => x.name === st.name); if (i >= 0) r.stages[i] = st; }
    const set = (nm, data, w) => { const s = r.stages.find((x) => x.name === nm); if (s) { s.data = data; if (w != null) s.w = w; } };
    set('asr', asrP, totalP); set('F0_pred', F0p, F0p.length); set('N_pred', Np, Np.length);
    set('pred_dur', Float32Array.from(durArr), L);
    r.samples = back.samples; r.sampleRate = back.sampleRate;
    r.durations = durArr.slice();
  }

  function capturePin(node) {
    if (!node._lastTrace || !node._predicted || !node._curDur) { node._pinnedEdit = null; return; }
    const F0 = node._lastTrace.stages.find((s) => s.name === 'F0_pred');
    const N = node._lastTrace.stages.find((s) => s.name === 'N_pred');
    const base = node._predicted.dur, L = base.length;
    if (node._curDur.length !== L) { node._pinnedEdit = null; return; }
    const durRatio = new Float64Array(L);
    for (let l = 0; l < L; l++) durRatio[l] = node._curDur[l] / (base[l] || 1);
    const f0AtPred = resampleByDur(F0.data, node._curDur, base);
    const nAtPred = resampleByDur(N.data, node._curDur, base);
    const dF0 = new Float32Array(node._predicted.F0.length), dN = new Float32Array(node._predicted.N.length);
    for (let i = 0; i < dF0.length; i++) dF0[i] = f0AtPred[i] - node._predicted.F0[i];
    for (let i = 0; i < dN.length; i++) dN[i] = nAtPred[i] - node._predicted.N[i];
    node._pinnedEdit = { durRatio, dF0, dN, baseDur: base.slice() };
  }

  def({
    type: 'kokoro', label: 'Kokoro Voice', cat: 'Audio', color: '#c084fc',
    ins: [], outs: [{ name: 'audio', type: 'audio-buffer' }],

    exec(ins, params, node) {
      ensureLoaded(node);
      rebuildVoice(node);
      const r = synthSyncFull(node);
      node._lastTrace = r;
      return [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }];
    },

    mount(body, node, graph, api) {
      seedDefaults(node.params);
      const p = node.params;

      // ══ Common: text + output (always visible, on the small card) ══════
      const textRow = el('div', 'form-row');
      const textInput = el('input', 'form-input wide'); textInput.type = 'text'; textInput.value = p.text;
      textInput.placeholder = 'Type something to speak…';
      textRow.appendChild(textInput);
      const speakBtn = el('button', 'tinybtn', '▶'); speakBtn.title = 'Speak';
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
      const info = el('span', 'curve-stats', 'no audio yet — set a data root');
      outControls.appendChild(playBtn); outControls.appendChild(wavBtn); outControls.appendChild(autoplayLbl); outControls.appendChild(info);
      outSec.appendChild(outControls);
      body.appendChild(outSec);

      // ══ Model & data source ═══════════════════════════════════════════
      const modelDet = el('details'); modelDet.appendChild(el('summary', null, 'Model & data source'));
      const rootRow = el('div', 'form-row');
      rootRow.appendChild(el('span', 'form-label', 'Data root'));
      const rootInput = el('input', 'form-input wide'); rootInput.type = 'text'; rootInput.value = p.dataRoot;
      rootRow.appendChild(rootInput);
      const rootBrowse = el('button', 'tinybtn', '…');
      rootBrowse.addEventListener('click', () => {
        const picked = Dialogs.browseFolder(rootInput.value);
        if (picked) { rootInput.value = picked; rootInput.dispatchEvent(new Event('change')); }
      });
      rootRow.appendChild(rootBrowse);
      modelDet.appendChild(rootRow);
      const modelMeta = el('div', 'axis-note', '');
      modelDet.appendChild(modelMeta);
      api.dialogBody.appendChild(modelDet);

      // ══ Voice design ══════════════════════════════════════════════════
      const voiceDet = el('details'); voiceDet.appendChild(el('summary', null, 'Voice design'));
      const seedRow = el('div', 'form-row');
      const seedSel = el('select', 'form-input wide');
      seedRow.appendChild(seedSel);
      const randomBtn = el('button', 'tinybtn', '🎲'); randomBtn.title = 'Random voice';
      const neutralBtn = el('button', 'tinybtn', '○'); neutralBtn.title = 'Neutral centroid';
      seedRow.appendChild(randomBtn); seedRow.appendChild(neutralBtn);
      voiceDet.appendChild(seedRow);
      const sliderBank = el('div', 'basis-sliders');
      voiceDet.appendChild(sliderBank);

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
      const cloneBtn = el('button', 'tinybtn', '⤓ clone');
      cloneRow.appendChild(cloneBtn);
      voiceDet.appendChild(cloneRow);

      const voiceToolsRow = el('div', 'form-row');
      const saveVoiceBtn = el('button', 'tinybtn', 'save voice pack');
      voiceToolsRow.appendChild(saveVoiceBtn);
      const voiceMeta = el('span', 'curve-stats', '');
      voiceToolsRow.appendChild(voiceMeta);
      voiceDet.appendChild(voiceToolsRow);
      api.dialogBody.appendChild(voiceDet);

      // ══ Emotion — prosody (VAD, Tier 0) ═══════════════════════════════
      const emoDet = el('details'); emoDet.appendChild(el('summary', null, 'Emotion — prosody (VAD)'));
      const emoAxes = [['v', 'valence', 'negative ↔ positive'], ['a', 'arousal', 'calm ↔ excited'], ['d', 'dominance', 'submissive ↔ assertive']];
      const emoRanges = {};
      for (const [key, name, hint] of emoAxes) {
        const cell = el('div', 'emo-axis');
        const head = el('div', 'emo-head');
        head.appendChild(el('span', 'emo-name', name));
        head.appendChild(el('span', 'emo-hint', hint));
        const val = el('span', 'emo-val', p.emo[key].toFixed(2));
        head.appendChild(val);
        cell.appendChild(head);
        const r = document.createElement('input');
        r.type = 'range'; r.min = '-1'; r.max = '1'; r.step = '0.01'; r.value = p.emo[key];
        r.addEventListener('input', () => { p.emo[key] = +r.value; val.textContent = p.emo[key].toFixed(2); scheduleEmotion(); });
        cell.appendChild(r);
        emoRanges[key] = { r, val };
        emoDet.appendChild(cell);
      }
      const emoNeutralBtn = el('button', 'tinybtn', '○ neutral'); emoDet.appendChild(emoNeutralBtn);
      api.dialogBody.appendChild(emoDet);

      // ══ Emotion — learned (timbre, Tier 1) — hidden without a basis ═══
      const timbreDet = el('details'); timbreDet.appendChild(el('summary', null, 'Emotion ✦ learned'));
      const timbreAxes = el('div'); timbreDet.appendChild(timbreAxes);
      const timbreNeutralBtn = el('button', 'tinybtn', '○ neutral'); timbreDet.appendChild(timbreNeutralBtn);
      api.dialogBody.appendChild(timbreDet);

      // ══ Masc ↔ Fem — hidden without a basis ════════════════════════════
      const mfDet = el('details'); mfDet.appendChild(el('summary', null, 'Masc ✦ Fem'));
      const mfRow = el('div', 'mf-row');
      const mfFemLbl = el('span', 'mf-pole'); const mfMascLbl = el('span', 'mf-pole');
      const mfSlider = document.createElement('input'); mfSlider.type = 'range'; mfSlider.className = 'mf-range';
      const mfVal = el('span', 'mf-val', 'neutral');
      mfRow.appendChild(mfFemLbl); mfRow.appendChild(mfSlider); mfRow.appendChild(mfMascLbl); mfRow.appendChild(mfVal);
      mfDet.appendChild(mfRow);
      const mfNeutralBtn = el('button', 'tinybtn', '○ neutral'); mfDet.appendChild(mfNeutralBtn);
      api.dialogBody.appendChild(mfDet);

      // ══ Prosody & alignment ═════════════════════════════════════════════
      const prosodyDet = el('details'); prosodyDet.appendChild(el('summary', null, 'Prosody & alignment'));
      const pinLabel = el('div', 'axis-note'); pinLabel.style.display = 'none'; prosodyDet.appendChild(pinLabel);
      const curveWrap = el('div'); prosodyDet.appendChild(curveWrap);
      const alignWrap = el('div'); prosodyDet.appendChild(alignWrap);
      api.dialogBody.appendChild(prosodyDet);

      // ══ Pipeline trace ══════════════════════════════════════════════════
      const traceDet = el('details'); traceDet.appendChild(el('summary', null, 'Pipeline trace'));
      const traceWrap = el('div'); traceDet.appendChild(traceWrap);
      api.dialogBody.appendChild(traceDet);

      autoplayChk.addEventListener('change', () => { p.autoplay = autoplayChk.checked; });
      playBtn.addEventListener('click', () => ClipAudio.playClipId(node._clipId != null ? node._clipId : -1));
      wavBtn.addEventListener('click', () => {
        if (typeof showSaveFileDialog !== 'function' || !node._wavSamples) return;
        try {
          const sp = showSaveFileDialog('WAV Files|wav', 'kokoro.wav');
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

      // ── voice sliders --------------------------------------------------
      const sliderCells = [];
      function buildSliders() {
        sliderBank.textContent = ''; sliderCells.length = 0;
        const basis = node._basis; if (!basis) return;
        for (let k = 0; k < basis.k; k++) {
          const cell = el('div', 'pc');
          const head = el('div', 'pc-head');
          head.appendChild(el('span', 'pc-name', basis.axisName ? basis.axisName[k] : ('PC' + (k + 1))));
          const val = el('span', 'pc-val', (p.coords[k] || 0).toFixed(2));
          head.appendChild(val);
          cell.appendChild(head);
          const r = document.createElement('input');
          r.type = 'range';
          const [lo, hi] = basis.range[k];
          r.min = (lo * 1.15).toFixed(3); r.max = (hi * 1.15).toFixed(3); r.step = '0.01'; r.value = p.coords[k] || 0;
          r.addEventListener('input', () => { p.coords[k] = +r.value; val.textContent = p.coords[k].toFixed(2); scheduleVoiceChange(); });
          cell.appendChild(r);
          sliderCells.push({ r, val });
          sliderBank.appendChild(cell);
        }
      }
      function syncSliders() { for (let k = 0; k < sliderCells.length; k++) { sliderCells[k].r.value = p.coords[k]; sliderCells[k].val.textContent = (p.coords[k] || 0).toFixed(2); } }
      function populateSeeds() {
        seedSel.textContent = '';
        const basis = node._basis; if (!basis) return;
        const neu = el('option', null, 'neutral (centroid)'); neu.value = '__neutral__'; seedSel.appendChild(neu);
        for (const n of basis.names) { const o = el('option', null, n); o.value = n; seedSel.appendChild(o); }
      }
      seedSel.addEventListener('change', () => {
        const basis = node._basis; if (!basis) return;
        if (seedSel.value === '__neutral__') p.coords.fill(0);
        else { const i = basis.names.indexOf(seedSel.value); if (i >= 0) for (let k = 0; k < basis.k; k++) p.coords[k] = basis.anchors[i][k]; }
        syncSliders(); voiceMeta.textContent = 'seed: ' + seedSel.value; run();
      });
      randomBtn.addEventListener('click', () => {
        const basis = node._basis; if (!basis) return;
        for (let k = 0; k < basis.k; k++) {
          const g = gauss() * (0.5 + basis.varExplained[k] * 3);
          const [lo, hi] = basis.range[k];
          p.coords[k] = Math.max(lo, Math.min(hi, g));
        }
        syncSliders(); seedSel.value = '__neutral__'; voiceMeta.textContent = 'random draw'; run();
      });
      neutralBtn.addEventListener('click', () => { p.coords.fill(0); syncSliders(); seedSel.value = '__neutral__'; voiceMeta.textContent = 'neutral centroid'; run(); });
      saveVoiceBtn.addEventListener('click', () => {
        if (!node._voice) return;
        try {
          const data = node._voice.data;
          const u8 = new Uint8Array(data.length * 4);
          new Float32Array(u8.buffer).set(data);
          const outPath = node._paths.model + '/voices/designed.bin';
          _fs.writeFileSync(outPath, u8);
          voiceMeta.textContent = 'saved → ' + outPath;
        } catch (e) { api.setBadge('save: ' + (e && e.message || e), true); }
      });
      cloneBtn.addEventListener('click', () => {
        const basis = node._basis; if (!basis || !node._kokoro) return;
        if (!node._bridge) node._bridge = loadBridgeBin(node._paths.model);
        if (!node._bridge) { api.setBadge('voice_bridge.bin missing', true); return; }
        const wav = wavInput.value.trim(); if (!wav) return;
        const proceed = () => {
          try {
            const actx = ClipAudio.ensureCtx();
            const dec = actx.decodeAudioFile(wav);
            if (!dec) { api.setBadge('clone: cannot decode ' + wav, true); return; }
            let mono = dec.samples;
            if (dec.channels === 2) { mono = new Float32Array(dec.numFrames); for (let i = 0; i < dec.numFrames; i++) mono[i] = 0.5 * (dec.samples[2 * i] + dec.samples[2 * i + 1]); }
            api.setBadge('clone: enrolling…', false);
            node._spkEnc.embedSpeaker(mono, {
              sampleRate: dec.sampleRate,
              onDone: (x) => {
                const c = coordsFromStyle(basis, bridgeApply(node._bridge, x));
                for (let k = 0; k < basis.k; k++) { const [lo, hi] = basis.range[k]; p.coords[k] = Math.max(lo * 1.15, Math.min(hi * 1.15, c[k])); }
                syncSliders(); seedSel.value = '__neutral__'; voiceMeta.textContent = 'clone: ' + wav.split(/[\\\/]/).pop();
                api.setBadge('ready', false); run();
              },
              onError: (m) => api.setBadge('clone: ' + m, true),
            });
          } catch (e) { api.setBadge('clone: ' + (e && e.message || e), true); }
        };
        if (node._spkEnc) { proceed(); return; }
        const sdir = p.spkEncDir || node._paths.spkenc;
        api.setBadge('clone: loading speaker encoder…', false);
        bro.tts.loadSpeakerEncoder(sdir, { onReady: (enc) => { node._spkEnc = enc; proceed(); }, onError: (m) => api.setBadge('clone: ' + m, true) });
      });

      // ── VAD / timbre / masc-fem neutral buttons + rebuilds --------------
      function buildTimbre() {
        timbreAxes.textContent = '';
        if (!node._emotionBasis) { timbreDet.classList.add('node-hidden-section'); timbreDet.style.display = 'none'; return; }
        timbreDet.style.display = '';
        for (const e of node._emotionBasis.emotions) {
          if (p.timbre[e] === undefined) p.timbre[e] = 0;
          const label = (node._emotionBasis.label && node._emotionBasis.label[e]) || e;
          const cell = el('div', 'emo-axis');
          const head = el('div', 'emo-head');
          const nm = el('span', 'emo-name', label); nm.style.cursor = 'pointer'; nm.title = 'click for a default amount';
          head.appendChild(nm);
          const val = el('span', 'emo-val', p.timbre[e].toFixed(2));
          head.appendChild(val);
          cell.appendChild(head);
          const r = document.createElement('input');
          r.type = 'range'; r.min = '0'; r.max = String(node._emotionBasis.alphaMax || 5); r.step = '0.05'; r.value = p.timbre[e];
          r.addEventListener('input', () => { p.timbre[e] = +r.value; val.textContent = p.timbre[e].toFixed(2); scheduleTimbre(); });
          nm.addEventListener('click', () => {
            for (const k of node._emotionBasis.emotions) p.timbre[k] = (k === e) ? (node._emotionBasis.defaultAlpha[e] || 2) : 0;
            buildTimbre(); run();
          });
          cell.appendChild(r);
          timbreAxes.appendChild(cell);
        }
      }
      timbreNeutralBtn.addEventListener('click', () => { if (node._emotionBasis) for (const e of node._emotionBasis.emotions) p.timbre[e] = 0; buildTimbre(); run(); });

      function buildMascFem() {
        if (!node._mascFemBasis) { mfDet.style.display = 'none'; return; }
        mfDet.style.display = '';
        const max = node._mascFemBasis.alphaMax || 3;
        mfFemLbl.textContent = '← ' + (node._mascFemBasis.label.F || 'feminine');
        mfMascLbl.textContent = (node._mascFemBasis.label.M || 'masculine') + ' →';
        mfFemLbl.style.cursor = mfMascLbl.style.cursor = 'pointer';
        mfFemLbl.onclick = () => { p.mfAlpha = -(node._mascFemBasis.defaultAlpha.F || 2); syncMf(); scheduleMascFem(); };
        mfMascLbl.onclick = () => { p.mfAlpha = (node._mascFemBasis.defaultAlpha.M || 2); syncMf(); scheduleMascFem(); };
        mfSlider.min = String(-max); mfSlider.max = String(max); mfSlider.step = '0.05';
        mfSlider.oninput = () => { p.mfAlpha = +mfSlider.value; syncMf(); scheduleMascFem(); };
        syncMf();
      }
      function syncMf() {
        mfSlider.value = String(p.mfAlpha);
        mfVal.textContent = p.mfAlpha === 0 ? 'neutral' : ((p.mfAlpha > 0 ? 'masc ' : 'fem ') + Math.abs(p.mfAlpha).toFixed(2));
      }
      mfNeutralBtn.addEventListener('click', () => { p.mfAlpha = 0; syncMf(); run(); });

      // ── prosody curve painter (F0 / N) + duration cells -----------------
      function rebuildProsody() {
        curveWrap.textContent = ''; alignWrap.textContent = '';
        if (!node._lastTrace) return;
        const stages = node._lastTrace.stages;
        const F0 = stages.find((s) => s.name === 'F0_pred'), N = stages.find((s) => s.name === 'N_pred'), pd = stages.find((s) => s.name === 'pred_dur');
        if (F0 && N) {
          const curveCfg = {
            count: () => 2,
            label: (n, i) => i === 0 ? 'pitch (F0_pred)' : 'energy (N_pred)',
            get: (n, i) => (i === 0 ? node._prosF0 : node._prosN),
            original: (n, i) => (i === 0 ? node._predicted && node._predicted.F0 : node._predicted && node._predicted.N),
            clamp: (n, i, v) => (i === 0 ? Math.max(0, v) : v),
          };
          node._prosF0 = Array.from(F0.data); node._prosN = Array.from(N.data);
          curveWrap.appendChild(mountCurvePainter(node, curveCfg, { onEdit() { scheduleProsodyEdit(); } }));
        }
        if (pd) {
          mountDurationCells(alignWrap, {
            count: () => pd.data.length,
            get: (i) => pd.data[i],
          }, {
            onLiveChange() {},
            onCommit(work) { requestDuration(work); },
            onReset() { if (node._predicted) requestDuration(node._predicted.dur.slice()); },
          });
        }
      }
      function rebuildTrace() {
        traceWrap.textContent = '';
        if (!node._lastTrace) return;
        const skip = { F0_pred: 1, N_pred: 1, pred_dur: 1 };
        for (const s of node._lastTrace.stages) {
          if (skip[s.name]) continue;
          const card = el('div', 'trace-card');
          const head = el('div', 'trace-head');
          head.appendChild(el('span', 'trace-name', s.name));
          head.appendChild(el('span', null, s.h + '×' + s.w));
          card.appendChild(head);
          if (s.name === 'phonemes') {
            const chips = el('div', 'chips');
            for (let i = 0; i < s.data.length; i++) chips.appendChild(el('span', 'chip', String(s.data[i] | 0)));
            card.appendChild(chips);
          } else if (s.name === 'audio') {
            const cv = document.createElement('canvas'); cv.width = 1100; cv.height = 100; cv.className = 'curve-canvas';
            card.appendChild(cv);
            ClipAudio.drawWaveform(cv, s.data, 1, '#5aa0e0');
          } else {
            const refs = {};
            const f0s = node._lastTrace.stages.find((x) => x.name === 'F0_pred');
            const ns = node._lastTrace.stages.find((x) => x.name === 'N_pred');
            if (f0s) refs['F0 corr'] = f0s.data;
            if (ns) refs['energy corr'] = ns.data;
            const holder = el('div');
            card.appendChild(holder);
            mountHeatmap(holder, s, { refs });
          }
          traceWrap.appendChild(card);
        }
      }
      function updatePinUI() {
        if (!node._pinnedEdit) { pinLabel.style.display = 'none'; return; }
        pinLabel.style.display = '';
        pinLabel.textContent = '✎ prosody pinned — rides across voice/emotion changes';
      }

      // ── run / pump (async two-pass, mirroring kokoro-lab/lib/synth.js) --
      function setLoadStatus(msg, err) { modelMeta.textContent = msg; api.setBadge(err ? 'error' : (node._kokoro ? 'ready' : ''), err); }

      function ensureLoadedLive() {
        try { ensureLoaded(node); populateSeeds(); buildSliders(); syncSliders(); buildTimbre(); buildMascFem(); setLoadStatus(node._paths.kind + ' · ' + node._paths.model, false); return true; }
        catch (e) { setLoadStatus(String(e && e.message || e), true); return false; }
      }

      function run() {
        if (!ensureLoadedLive()) return;
        rebuildVoice(node);
        node._dirty = true;
        pump();
      }
      function pump() {
        if (node._synthBusy || !node._dirty || !node._kokoro || !node._voice) return;
        let ids;
        try { ids = bro.tts.phonemize(p.text); } catch (e) { api.setBadge('phonemize: ' + e.message, true); node._dirty = false; return; }
        if (!ids || !ids.length) { api.setBadge('no phonemes for that text', true); node._dirty = false; return; }
        node._dirty = false;
        if (node._pinnedEdit) synthTrace(ids); else synthAudio(ids);
      }
      function safeSynth(ids, opts) {
        node._synthBusy = true;
        try { bro.tts.synthesize(node._kokoro, ids, node._voice, opts); }
        catch (e) { node._synthBusy = false; api.setBadge('synthesize: ' + e.message, true); if (node._dirty) setTimeout(pump, 0); }
      }
      function synthAudio(ids) {
        safeSynth(ids, {
          onDone: (r, info) => {
            node._synthBusy = false;
            if (info.error) { api.setBadge('synthesize: ' + info.error, true); return; }
            if (!info.cancelled) publishAudio(r.samples, r.sampleRate);
            if (node._dirty) pump(); else synthTrace(ids);
          },
        });
      }
      function synthTrace(ids) {
        const t0 = performance.now();
        safeSynth(ids, {
          trace: true,
          onDone: (r, info) => {
            node._synthBusy = false;
            if (!info.error && !info.cancelled) {
              node._lastTrace = r;
              const dur0 = r.stages.find((s) => s.name === 'pred_dur');
              node._predicted = {
                F0: Float32Array.from(r.stages.find((s) => s.name === 'F0_pred').data),
                N: Float32Array.from(r.stages.find((s) => s.name === 'N_pred').data),
                dur: Array.from(dur0.data, (v) => Math.round(v)),
              };
              node._curDur = node._predicted.dur.slice();
              rebuildProsody(); rebuildTrace();
              const out = [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }];
              api.invalidate(node, out, performance.now() - t0);
              if (node._pinnedEdit && !reapplyPin()) { publishAudio(r.samples, r.sampleRate); }
              else if (!node._pinnedEdit && emotionActive(p.emo)) applyEmotionLive();
            }
            if (node._dirty) pump();
          },
        });
      }
      function reapplyPin() {
        if (!node._pinnedEdit || node._synthBusy || !node._kokoro || !node._voice || !node._lastTrace) return false;
        const get = (nm) => node._lastTrace.stages.find((s) => s.name === nm);
        const ten = get('t_en'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes'), pd = get('pred_dur');
        if (!ten || !F0 || !N || !ph || !pd) return false;
        const pin = node._pinnedEdit;
        const predDur = Array.from(pd.data, (v) => Math.round(v)), L = predDur.length;
        if (pin.durRatio.length !== L) { node._pinnedEdit = null; updatePinUI(); return false; }
        const targetDur = predDur.map((d, l) => Math.max(1, Math.round(d * pin.durRatio[l])));
        const { asrP, totalP } = lengthRegulate(ten.data, node._kokoro.hiddenDim, L, targetDur);
        const dF0v = resampleByDur(pin.dF0, pin.baseDur, predDur), dNv = resampleByDur(pin.dN, pin.baseDur, predDur);
        const F0e = new Float32Array(F0.data.length), Ne = new Float32Array(N.data.length);
        for (let i = 0; i < F0e.length; i++) F0e[i] = Math.max(0, F0.data[i] + (dF0v[i] || 0));
        for (let i = 0; i < Ne.length; i++) Ne[i] = N.data[i] + (dNv[i] || 0);
        const F0f = resampleByDur(F0e, predDur, targetDur), Nf = resampleByDur(Ne, predDur, targetDur);
        node._synthBusy = true;
        bro.tts.decodeFrom(node._kokoro, node._voice, asrP, F0f, Nf, ph.w, {
          trace: true,
          onDone: (r, info) => {
            node._synthBusy = false;
            if (!info.error && !info.cancelled) {
              mergeBackHalf(node._lastTrace, r, asrP, F0f, Nf, targetDur, totalP, L);
              node._curDur = targetDur;
              publishAudio(r.samples, r.sampleRate);
              rebuildProsody(); rebuildTrace();
              api.invalidate(node, [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }], 0);
            }
          },
        });
        return true;
      }
      function applyEmotionLive() {
        if (node._synthBusy || !node._kokoro || !node._voice || !node._lastTrace || !node._predicted) return;
        if (!emotionActive(p.emo)) return;
        const get = (nm) => node._lastTrace.stages.find((s) => s.name === nm);
        const ten = get('t_en'), ph = get('phonemes');
        const baseDur = node._predicted.dur, L = baseDur.length;
        const rate = EMO_FN.rateScale(p.emo.v, p.emo.a, p.emo.d);
        const newDur = baseDur.map((d) => Math.max(1, Math.round(d / rate)));
        const { asrP, totalP } = lengthRegulate(ten.data, node._kokoro.hiddenDim, L, newDur);
        const { F0: F0t, N: Nt } = emoTransformContours(node._predicted.F0, node._predicted.N, p.emo);
        const F0p = resampleByDur(F0t, baseDur, newDur), Np = resampleByDur(Nt, baseDur, newDur);
        node._synthBusy = true;
        bro.tts.decodeFrom(node._kokoro, node._voice, asrP, F0p, Np, ph.w, {
          trace: true,
          onDone: (r, info) => {
            node._synthBusy = false;
            if (!info.error && !info.cancelled) {
              mergeBackHalf(node._lastTrace, r, asrP, F0p, Np, newDur, totalP, L);
              node._curDur = newDur;
              publishAudio(r.samples, r.sampleRate);
              rebuildProsody(); rebuildTrace();
              capturePin(node); updatePinUI();
              api.invalidate(node, [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }], 0);
            }
          },
        });
      }
      let emoTimer = 0;
      function scheduleEmotion() { clearTimeout(emoTimer); emoTimer = setTimeout(() => { if (!emotionActive(p.emo)) { node._pinnedEdit = null; updatePinUI(); run(); } else applyEmotionLive(); }, 140); }
      emoNeutralBtn.addEventListener('click', () => { p.emo.v = p.emo.a = p.emo.d = 0; for (const k in emoRanges) { emoRanges[k].r.value = '0'; emoRanges[k].val.textContent = '0.00'; } node._pinnedEdit = null; updatePinUI(); run(); });

      let timbreTimer = 0, mfTimer = 0, voiceTimer = 0;
      function scheduleTimbre() { clearTimeout(timbreTimer); timbreTimer = setTimeout(run, 140); }
      function scheduleMascFem() { clearTimeout(mfTimer); mfTimer = setTimeout(run, 140); }
      function scheduleVoiceChange() { clearTimeout(voiceTimer); voiceTimer = setTimeout(run, 120); }

      function commitProsody() {
        if (node._synthBusy || !node._kokoro || !node._voice || !node._lastTrace) return;
        const get = (nm) => node._lastTrace.stages.find((s) => s.name === nm);
        const asr = get('asr'), ph = get('phonemes');
        if (!asr || !ph) return;
        const F0d = Float32Array.from(node._prosF0), Nd = Float32Array.from(node._prosN);
        node._synthBusy = true;
        bro.tts.decodeFrom(node._kokoro, node._voice, asr.data, F0d, Nd, ph.w, {
          trace: true,
          onDone: (r, info) => {
            node._synthBusy = false;
            if (!info.error && !info.cancelled) {
              mergeBackHalf(node._lastTrace, r, asr.data, F0d, Nd, node._curDur, asr.w, node._curDur.length);
              publishAudio(r.samples, r.sampleRate);
              rebuildTrace();
              capturePin(node); updatePinUI();
              api.invalidate(node, [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }], 0);
            }
          },
        });
      }
      let prosodyTimer = 0;
      function scheduleProsodyEdit() { clearTimeout(prosodyTimer); prosodyTimer = setTimeout(commitProsody, 60); }

      let durPending = false;
      function requestDuration(work) {
        node._pendingDur = work;
        durPending = true;
        pumpDuration();
      }
      function pumpDuration() {
        if (node._synthBusy || !durPending) return;
        if (!node._kokoro || !node._voice || !node._lastTrace || !node._curDur) return;
        const get = (nm) => node._lastTrace.stages.find((s) => s.name === nm);
        const ten = get('t_en'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes');
        if (!ten || !F0 || !N || !ph) { durPending = false; return; }
        durPending = false;
        const newDur = node._pendingDur.slice();
        const { asrP, totalP } = lengthRegulate(ten.data, node._kokoro.hiddenDim, newDur.length, newDur);
        const F0p = resampleByDur(F0.data, node._curDur, newDur), Np = resampleByDur(N.data, node._curDur, newDur);
        node._synthBusy = true;
        bro.tts.decodeFrom(node._kokoro, node._voice, asrP, F0p, Np, ph.w, {
          trace: true,
          onDone: (r, info) => {
            node._synthBusy = false;
            if (!info.error && !info.cancelled) {
              mergeBackHalf(node._lastTrace, r, asrP, F0p, Np, newDur, totalP, newDur.length);
              node._curDur = newDur;
              publishAudio(r.samples, r.sampleRate);
              api.invalidate(node, [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }], 0);
            }
            if (durPending) pumpDuration();
            else { scheduleHeatRefresh(); capturePin(node); updatePinUI(); }
          },
        });
      }
      let heatTimer = 0;
      function scheduleHeatRefresh() { clearTimeout(heatTimer); heatTimer = setTimeout(() => { rebuildProsody(); rebuildTrace(); }, 350); }

      // ── wiring: discrete 'change' triggers, not per-keystroke -----------
      rootInput.addEventListener('change', () => { p.dataRoot = rootInput.value; node._modelSig = null; run(); });
      textInput.addEventListener('change', () => { p.text = textInput.value; run(); });
      speakBtn.addEventListener('click', () => { p.text = textInput.value; run(); });

      if (p.dataRoot) run();
      else info.textContent = 'no audio yet — set a data root';
    },
  });

  registerCategory('Audio');
