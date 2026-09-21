// Prefix-cache slots — a prompt frozen below the text encoder.
//
// From step 1 onward the extracted prefix K/V *is* the conditioning: the text
// rows are not recomputed, so what the image attends to is the cache. Saving
// one and blending another towards it is therefore a prompt crossfade that
// happens below the encoder entirely — no re-encoding, no vision tower, no
// txt_in, just a lerp over cached K/V that lands on the very next step.
//
// Two sliders, because the operation the binding offers is one-sided:
//
//     blend(slot, a)   live <- (1 - a) * live + a * slot
//
// so "toward A" then "toward B" composes to (1-b)((1-a)·live + a·A) + b·B. At
// a = 1 that is exactly (1-b)·A + b·B, which is the A-to-B walk; at b = 0 it is
// a fade from THIS prompt's own prefix towards A, which is the prompt-A-cache /
// prompt-B-target experiment: prime with B, attend to A.
//
// Both caches must describe the same LAYOUT — same prefix length, same target
// grid, same layer count — which in practice means two prompts that tokenize
// to the same length. A mismatch throws rather than mis-aligning, so the panel
// prints each slot's prefix row count.

import { $, retention, pixelMse } from '/app/ui/util.js';

export function initPrefix(ctx) {
  const prefs = ctx.prefs;
  let slots = [];      // [{valid, prompt, rows, imgLen}]
  let capacity = 0;
  let walkFrames = [];

  function status(text, kind) {
    const el = $('pfx-slots-note');
    el.textContent = text;
    el.className = 'hint inline' + (kind ? ' ' + kind : '');
  }

  // ── the two blend sliders ───────────────────────────────────────────────
  const toA = ctx.buildCtl({
    label: 'toward A', id: 'pfx-a-amt', key: 'pfx.a',
    title: 'blend the live prefix towards slot A — 1.0 replaces it wholesale',
    min: 0, max: 1, step: 0.05, neutral: 0,
    value: prefs.pfxA != null ? +prefs.pfxA : 0,
    host: $('pfx-blend-rows'), section: 'prefix',
    chip: () => 'prefix → A', commit: () => {},
  });
  const toB = ctx.buildCtl({
    label: 'toward B', id: 'pfx-b-amt', key: 'pfx.b',
    title: 'then blend towards slot B — with A at 1.0 this is the A→B position',
    min: 0, max: 1, step: 0.05, neutral: 0,
    value: prefs.pfxB != null ? +prefs.pfxB : 0,
    host: $('pfx-blend-rows'), section: 'prefix',
    chip: () => 'prefix → B', commit: () => {},
  });
  const walkN = ctx.buildCtl({
    label: 'walk frames', id: 'pfx-walk-n', min: 2, max: 12, step: 1,
    neutral: 5, decimals: 0, value: prefs.pfxWalkN != null ? +prefs.pfxWalkN : 5,
    host: $('pfx-walk-rows'), commit: () => {},
  });
  const walkPx = ctx.buildCtl({
    label: 'frame size', id: 'pfx-walk-px', min: 128, max: 768, step: 32,
    neutral: 256, decimals: 0, value: prefs.pfxWalkPx != null ? +prefs.pfxWalkPx : 256,
    host: $('pfx-walk-rows'), commit: () => {},
  });

  // ── slot cards ──────────────────────────────────────────────────────────
  function renderSlots() {
    const host = $('pfx-slots');
    host.innerHTML = '';
    for (let i = 0; i < capacity; i++) {
      const s = slots[i] || { valid: false };
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pfx-slot' + (s.valid ? ' filled' : '');
      const nm = document.createElement('span');
      nm.className = 'pfx-slot-name';
      nm.textContent = 'slot ' + i;
      const sub = document.createElement('span');
      sub.textContent = s.valid
        ? (s.rows != null ? s.rows + ' prefix rows' : 'saved')
        : 'empty';
      b.title = s.valid && s.prompt ? s.prompt : 'save a prefix into this slot';
      b.appendChild(nm); b.appendChild(sub);
      b.addEventListener('click', () => {
        if (!s.valid) { $('pfx-save-slot').value = String(i); return; }
        $('pfx-a').value = String(i);
        ctx.persist();
      });
      host.appendChild(b);
    }
    ['pfx-save-slot', 'pfx-a', 'pfx-b'].forEach((id) => {
      const sel = $(id);
      const keep = sel.value;
      sel.innerHTML = '';
      for (let i = 0; i < capacity; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = 'slot ' + i + ((slots[i] && slots[i].valid) ? ' ·' : '');
        sel.appendChild(o);
      }
      if (keep !== '' && +keep < capacity) sel.value = keep;
    });
    const n = slots.filter((s) => s && s.valid).length;
    status(n + ' / ' + capacity + ' saved');
    $('btn-pfx-walk').disabled = !ctx.loaded || n < 1;
  }

  function applySlots(list, meta) {
    capacity = list.length;
    slots = list.map((v, i) => Object.assign({}, slots[i] || {}, { valid: !!v }));
    if (meta && meta.slot >= 0 && slots[meta.slot]) {
      slots[meta.slot].prompt = meta.prompt;
      slots[meta.slot].rows = meta.prefixRows;
      slots[meta.slot].imgLen = meta.imgLen;
    }
    renderSlots();
  }

  // ── saving ──────────────────────────────────────────────────────────────
  function doSave() {
    if (!ctx.loaded) { ctx.status('load a model first', 'err'); return; }
    const slot = +$('pfx-save-slot').value || 0;
    const base = ctx.buildGenerateMsg();
    ctx.setBusy(true);
    ctx.status('priming and extracting this prompt\'s prefix…');
    ctx.client.send({ type: 'savePrefix', slot: slot, prompt: base.prompt,
                      opts: base.opts, conditionImages: base.conditionImages,
                      axes: base.axes, budget: base.budget }, (err, resp) => {
      ctx.setBusy(false);
      if (err) { ctx.status(String(err.message || err), 'err'); return; }
      applySlots(resp.slots || [], resp);
      ctx.status('slot ' + resp.slot + ' holds ' + resp.prefixRows + ' prefix rows · ' +
                 (resp.ms / 1000).toFixed(1) + ' s', 'ok');
    });
  }
  function doClear() {
    if (!ctx.loaded) return;
    ctx.setBusy(true);
    ctx.client.send({ type: 'clearPrefix' }, (err, resp) => {
      ctx.setBusy(false);
      if (err) { ctx.status(String(err.message || err), 'err'); return; }
      slots = [];
      applySlots(resp.slots || []);
      ctx.status('prefix slots cleared', 'ok');
    });
  }

  // ── the walk ────────────────────────────────────────────────────────────
  // N frames from slot A to slot B, at a reduced size so the strip is a
  // glance rather than a coffee break. Every frame is the same seed and the
  // same prompt; only the cached prefix moves.
  function doWalk() {
    if (!ctx.loaded) { ctx.status('load a model first', 'err'); return; }
    const a = +$('pfx-a').value || 0, b = +$('pfx-b').value || 0;
    if (!(slots[a] && slots[a].valid)) { ctx.status('slot A is empty', 'err'); return; }
    const n = walkN.value | 0;
    const px = ctx.roundSize(walkPx.value);
    walkFrames = [];
    $('pfx-strip').innerHTML = '';
    ctx.switchSection('prefix');
    let i = 0;
    const step = () => {
      if (i >= n) {
        ctx.status('walk done · ' + n + ' frames', 'ok');
        return;
      }
      const t = n > 1 ? i / (n - 1) : 0;
      const msg = ctx.buildGenerateMsg();
      msg.opts.width = px; msg.opts.height = px;
      delete msg.opts.outputResolution;
      delete msg.gateMask;
      delete msg.regions;
      msg.prefix = { blend: [{ slot: a, alpha: 1 }] };
      if (slots[b] && slots[b].valid && b !== a) msg.prefix.blend.push({ slot: b, alpha: t });
      else msg.prefix.blend = [{ slot: a, alpha: t }];
      ctx.status('walk · frame ' + (i + 1) + ' / ' + n + ' · t = ' + t.toFixed(2));
      ctx.renderOffscreen(msg, (err, frame) => {
        if (err) { ctx.status(String(err.message || err), 'err'); return; }
        addFrame(frame, t, i);
        i++;
        step();
      });
    };
    step();
  }

  function addFrame(frame, t, i) {
    walkFrames.push({ frame: frame, t: t });
    const cell = document.createElement('div');
    cell.className = 'walk-cell';
    const cv = document.createElement('canvas');
    const BOX = 140;
    const s = Math.min(BOX / frame.width, BOX / frame.height, 1);
    cv.width = Math.round(frame.width * s); cv.height = Math.round(frame.height * s);
    const tmp = document.createElement('canvas');
    tmp.width = frame.width; tmp.height = frame.height;
    tmp.getContext('2d').putImageData(frame, 0, 0);
    cv.getContext('2d').drawImage(tmp, 0, 0, cv.width, cv.height);
    const lab = document.createElement('div');
    lab.className = 'walk-label';
    lab.textContent = 't ' + t.toFixed(2);
    const ret = document.createElement('div');
    ret.className = 'walk-ret';
    if (walkFrames.length > 1) {
      const r = retention(walkFrames[0].frame, frame);
      ret.textContent = 'ret ' + r.toFixed(3);
      ret.classList.toggle('under', r < 0.71);
      ret.title = 'against the first frame · pixel mse ' +
                  pixelMse(walkFrames[0].frame, frame).toFixed(0);
    } else {
      ret.textContent = 'A';
    }
    cell.appendChild(cv); cell.appendChild(lab); cell.appendChild(ret);
    $('pfx-strip').appendChild(cell);
  }

  $('btn-pfx-save').addEventListener('click', doSave);
  $('btn-pfx-clear').addEventListener('click', doClear);
  $('btn-pfx-walk').addEventListener('click', doWalk);
  ['pfx-a', 'pfx-b'].forEach((id) => $(id).addEventListener('change', () => {
    ctx.persist();
    if (ctx.live && (toA.value || toB.value)) ctx.schedule('full');
  }));

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-pfx-save').disabled = busyOrUnloaded;
    $('btn-pfx-walk').disabled = busyOrUnloaded || !slots.some((s) => s && s.valid);
  });
  ctx.onLoaded((resp) => {
    applySlots(resp.prefixSlots || []);
    if (prefs.pfxSelA != null) $('pfx-a').value = String(prefs.pfxSelA);
    if (prefs.pfxSelB != null) $('pfx-b').value = String(prefs.pfxSelB);
  });
  ctx.onPersist((p) => {
    p.pfxA = toA.value; p.pfxB = toB.value;
    p.pfxWalkN = walkN.value; p.pfxWalkPx = walkPx.value;
    p.pfxSelA = $('pfx-a').value; p.pfxSelB = $('pfx-b').value;
  });
  ctx.onGenerateMsg((msg) => {
    const a = +$('pfx-a').value || 0, b = +$('pfx-b').value || 0;
    const blend = [];
    if (toA.value > 0 && slots[a] && slots[a].valid) blend.push({ slot: a, alpha: toA.value });
    if (toB.value > 0 && slots[b] && slots[b].valid) blend.push({ slot: b, alpha: toB.value });
    if (blend.length) msg.prefix = { blend: blend };
  });
  ctx.onRender((frame, msg, resp) => {
    if (resp && resp.slots) applySlots(resp.slots);
  });

  // Test seams.
  ctx.prefixSlots = () => slots.slice();
  ctx.savePrefixSlot = doSave;
  ctx.prefixWalk = doWalk;
  ctx.prefixWalkFrames = () => walkFrames.slice();
  ctx.setPrefixBlend = (a, b) => { toA.set(a, { silent: true }); toB.set(b, { silent: true }); };

  renderSlots();
}
