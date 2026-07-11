// Face section: the expression panel (word chips + one strength slider) and
// the baked spectrum/mouth panels (model-nominated affect + mouth-articulation
// axes over lab/spectrum.json and lab/mouth.json).

import { $ } from '/app/ui/util.js';

export function initFace(ctx) {
  const prefs = ctx.prefs;

  // ── expression field state ─────────────────────────────────────────────
  // The contextual per-token field (worker's `expression` message field):
  // splice the adjective into the live prompt, diff against a mask-aligned
  // neutral, extrapolate. One field per render (the splice fixes the
  // tokenization), so the control is EXCLUSIVE by construction — the UI is a
  // word picker (radio chips + a custom word) driving ONE strength slider.
  // alpha 1 == what saying the word does; identity drifts at the top end.
  const EXPRESSIONS = [
    { key: 'happiness', label: 'happiness', adj: 'joyfully smiling' },
    { key: 'laughter',  label: 'laughter',  adj: 'laughing' },
    { key: 'sadness',   label: 'sadness',   adj: 'sad' },
    { key: 'crying',    label: 'crying',    adj: 'crying' },
    { key: 'anger',     label: 'anger',     adj: 'furious' },
    { key: 'fear',      label: 'fear',      adj: 'terrified' },
    { key: 'surprise',  label: 'surprise',  adj: 'astonished' },
    { key: 'disgust',   label: 'disgust',   adj: 'disgusted' },
    { key: 'smirk',     label: 'smirk',     adj: 'smirking' },
    { key: 'wink',      label: 'wink',      adj: 'winking' },
  ];
  let exprSel = null;        // selected word key ('happiness'… | 'custom' | null)
  let exprCtl = null;        // the strength slider's buildCtl handle
  if (typeof prefs.exprSel === 'string' &&
      (prefs.exprSel === 'custom' || EXPRESSIONS.some((e) => e.key === prefs.exprSel))) {
    exprSel = prefs.exprSel;
  }
  let exprStrengthInit = Math.max(0, Math.min(5, +prefs.exprStrength || 0));
  // Migrate the legacy per-word map (exclusive — at most one non-zero entry).
  if (!exprSel && prefs.exprStrengths && typeof prefs.exprStrengths === 'object') {
    for (const k in prefs.exprStrengths) {
      const v = +prefs.exprStrengths[k] || 0;
      if (v > exprStrengthInit) { exprStrengthInit = Math.min(5, v); exprSel = k; }
    }
  }

  // ── spectrum state (model-nominated affect axes; worker mints per prompt) ─
  const SPECTRUM_KEYS = ['valence', 'arousal', 'hostility', 'surprise'];
  const SPEC_RANGE = 3;
  const specState = { valence: 0, arousal: 0, hostility: 0, surprise: 0 };
  if (prefs.specState && typeof prefs.specState === 'object') {
    SPECTRUM_KEYS.forEach((k) => {
      const v = +prefs.specState[k] || 0;
      specState[k] = Math.max(-SPEC_RANGE, Math.min(SPEC_RANGE, v));
    });
  }
  let specRows = {};   // valence/arousal/hostility/surprise -> {range, refresh}

  // ── mouth state (model-nominated articulation axes; baked lab/mouth.json) ─
  const MOUTH_KEYS = ['open', 'round', 'teeth'];
  const mouthState = { open: 0, round: 0, teeth: 0 };
  if (prefs.mouthState && typeof prefs.mouthState === 'object') {
    MOUTH_KEYS.forEach((k) => {
      const v = +prefs.mouthState[k] || 0;
      mouthState[k] = Math.max(-SPEC_RANGE, Math.min(SPEC_RANGE, v));
    });
  }
  let mouthRows = {};  // open/round/teeth -> {range, refresh}

  // ── expression panel: word picker + one strength slider ─────────────────
  // The field is exclusive by construction, so the honest UI is a radio:
  // chips pick THE word (or the custom text field), one slider pushes it.
  let exprChips = {};   // key -> chip button
  function exprWordLabel() {
    if (!exprSel) return 'expression';
    if (exprSel === 'custom') return $('expr-custom-adj').value.trim() || 'custom';
    const e = EXPRESSIONS.find((x) => x.key === exprSel);
    return e ? e.label : 'expression';
  }
  function refreshExprUi() {
    for (const k in exprChips) {
      if (exprChips.hasOwnProperty(k)) exprChips[k].classList.toggle('sel', k === exprSel);
    }
    $('expr-custom-adj').classList.toggle('flash-err', false);
    $('expr-custom-adj').style.borderColor = exprSel === 'custom' ? '#c9822f' : '';
    // no word picked -> the strength slider has nothing to push
    exprCtl.row.style.opacity = exprSel ? '' : '0.4';
    exprCtl.row.style.pointerEvents = exprSel ? '' : 'none';
    exprCtl.refresh();
  }
  function selectExpression(key, opts) {
    const was = exprSel;
    exprSel = key === exprSel && !(opts && opts.keep) ? null : key;
    if (exprSel && +exprCtl.range.value === 0) {
      // picking a word arms it at the "what saying the word does" strength
      exprCtl.set(1, { silent: true });
    }
    if (!exprSel) exprCtl.set(0, { silent: true });
    refreshExprUi();
    ctx.persist();
    if (ctx.live && (was !== exprSel) && (exprSel || was)) ctx.schedule('full');
  }
  function buildExpressionPanel() {
    const host = $('expr-words');
    host.innerHTML = '';
    exprChips = {};
    EXPRESSIONS.forEach((e) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'word-chip';
      chip.textContent = e.label;
      chip.title = 'field for "' + e.adj + '"';
      chip.addEventListener('click', () => selectExpression(e.key));
      exprChips[e.key] = chip;
      host.appendChild(chip);
    });
    exprCtl = ctx.buildCtl({
      label: 'strength', title: '1 ≈ the word in your prompt · higher extrapolates',
      key: 'expr-strength',
      min: 0, max: 5, step: 0.05, value: exprStrengthInit,
      host: $('expr-strength-row'),
      section: 'face',
      chip: () => '“' + exprWordLabel() + '”',
      commit: () => {},
    });
    // the registry entry buildCtl made treats value 0 as neutral — but the
    // expression is only live when a word is picked too, and zeroing it must
    // also drop the word.
    const entry = ctx.registryLast();
    entry.active = () => !!exprSel && +exprCtl.range.value > 0;
    entry.zero = (opts) => {
      exprSel = null;
      exprCtl.set(0, { silent: true });
      refreshExprUi();
      ctx.persist();
      if (!(opts && opts.silent) && ctx.live) ctx.schedule('full');
    };
    if (prefs.exprCustomAdj) $('expr-custom-adj').value = prefs.exprCustomAdj;
    // typing IS selecting: the custom word becomes the expression as you edit
    $('expr-custom-adj').addEventListener('input', () => {
      const has = !!$('expr-custom-adj').value.trim();
      if (has && exprSel !== 'custom') selectExpression('custom', { keep: true });
      else if (!has && exprSel === 'custom') selectExpression(null, { keep: true });
      else refreshExprUi();
    });
    $('expr-custom-adj').addEventListener('change', () => {
      ctx.persist();
      if (exprSel === 'custom' && +exprCtl.range.value > 0 && ctx.live) ctx.schedule('full');
    });
    $('btn-reset-expr').addEventListener('click', () => {
      const had = !!activeExpression();
      exprSel = null;
      exprCtl.set(0, { silent: true });
      refreshExprUi();
      ctx.persist();
      if (had && ctx.live) ctx.schedule('full');
    });
    refreshExprUi();
  }
  buildExpressionPanel();
  // The single active expression for a generate message.
  function activeExpression() {
    const a = +exprCtl.range.value;
    if (!exprSel || !a) return null;
    if (exprSel === 'custom') {
      const adj = $('expr-custom-adj').value.trim();
      return adj ? { adj: adj, alpha: a } : null;
    }
    const e = EXPRESSIONS.find((x) => x.key === exprSel);
    return e ? { adj: e.adj, alpha: a } : null;
  }

  // ── baked-axes panels (spectrum + mouth) — slider rows over lab/*.json ────
  // Model-nominated baked axes stack freely (each generation applies every
  // active bank to the same carrier in the worker), so unlike the expression
  // rows there is no exclusivity here. One row per axis; `label` names the
  // negative/positive poles where the key alone doesn't say them.
  function buildBakedRow(cfg, key, label) {
    cfg.rows[key] = ctx.buildCtl({
      label: label || key, title: cfg.rowTitle, key: key,
      min: -SPEC_RANGE, max: SPEC_RANGE, step: 0.05,
      value: cfg.state[key] || 0,
      host: $(cfg.rowsId),
      section: 'face',
      commit: (v) => { cfg.state[key] = v; },
    });
  }
  function buildBakedPanel(cfg) {
    cfg.keys.forEach((k) => buildBakedRow(cfg, k, cfg.labels && cfg.labels[k]));
    $(cfg.resetId).addEventListener('click', () => {
      const any = cfg.keys.some((k) => cfg.state[k] !== 0);
      cfg.keys.forEach((k) => {
        cfg.state[k] = 0;
        cfg.rows[k].set(0, { silent: true });
      });
      if (any && ctx.live) ctx.schedule('full');
    });
  }
  buildBakedPanel({
    keys: SPECTRUM_KEYS, state: specState, rows: specRows,
    rowsId: 'spec-rows', resetId: 'btn-reset-spec',
    rowTitle: 'model-nominated affect axis — stacks with the other axes and the expression word',
  });
  buildBakedPanel({
    keys: MOUTH_KEYS, state: mouthState, rows: mouthRows,
    rowsId: 'mouth-rows', resetId: 'btn-reset-mouth',
    labels: { open: 'closed ↔ open', round: 'spread ↔ pursed', teeth: 'hidden ↔ bared' },
    rowTitle: 'model-nominated mouth articulation axis — stacks with the other axes and the expression word',
  });
  // Each baked bank ships as lab/<name>.json; without it the worker rejects
  // that bank's renders, so gray the panel out instead of surfacing the error.
  function setSpectrumAvailable(ok) {
    $('spec-panel').classList.toggle('spec-disabled', !ok);
    if (!ok) $('spec-hint').textContent = 'no lab/spectrum.json — bake it with tools/mint_spectrum.js';
  }
  function setMouthAvailable(ok) {
    $('mouth-panel').classList.toggle('spec-disabled', !ok);
    if (!ok) $('mouth-hint').textContent = 'no lab/mouth.json — bake it with tools/mint_mouth.js';
  }
  function activeBakedValues(keys, state) {
    if (!keys.some((k) => state[k] !== 0)) return null;
    const out = {};
    keys.forEach((k) => { out[k] = state[k]; });
    return out;
  }
  function activeSpectrum() { return activeBakedValues(SPECTRUM_KEYS, specState); }
  function activeMouth() { return activeBakedValues(MOUTH_KEYS, mouthState); }

  ctx.setSpectrumAvailable = setSpectrumAvailable;
  ctx.setMouthAvailable = setMouthAvailable;
  ctx.onPersist((p) => {
    p.exprSel = exprSel;
    p.exprStrength = exprCtl ? +exprCtl.range.value : exprStrengthInit;
    p.exprCustomAdj = $('expr-custom-adj').value;
    p.specState = specState;
    p.mouthState = mouthState;
  });
  ctx.onGenerateMsg((msg) => {
    msg.expression = activeExpression();
    msg.spectrum = activeSpectrum();
    msg.mouth = activeMouth();
  });
}
