// Mint your own axis.
//
// The 88 in the bank were minted by diff of means over 12 neutral scene stems
// x 2 phrasings a pole, with the attention-sink dimensions suppressed and a
// bank scale of 0.15 x the mean token norm. This panel runs the same recipe on
// words you type — or, with condition images loaded, on what the vision tower
// saw — and registers the result as a live control.
//
// It does NOT reload the control dictionary. loadControlDictionary is
// bank-level: it replaces the whole bank, which would drop every axis minted
// this session. setControlVector registers a RUNTIME axis beside the bank
// instead, and a runtime axis is a first-class one — it shows up in
// controlAxes(), it drives through setControl and the stack budget, and the
// control schedule takes it by name or by direction.
//
// Minted axes persist in their own localStorage blob and are re-registered on
// every model load, because what survives is the direction, not the pipeline.

import { $, f32ToB64, b64ToF32 } from '/app/ui/util.js';
import { loadMinted, saveMinted } from '/app/ui/store.js';

// lib/axesv2.js's stems, verbatim: neutral scene openings that carry no
// opinion of their own, so what is left after the pole subtraction is the pole.
const STEMS = [
  'a photograph of a harbour at dusk, ',
  'a photograph of a city street, ',
  'a photograph of a forest clearing, ',
  'a photograph of a kitchen table, ',
  'a photograph of a mountain ridge, ',
  'a photograph of a quiet room, ',
  'a portrait of a person, ',
  'a still life of fruit on a cloth, ',
  'a wide shot of a desert road, ',
  'an interior of a library, ',
  'a beach at low tide, ',
  'a field of tall grass, ',
];

export function initMint(ctx) {
  // { name, scale, dir(b64), kind, consistency, components } — the saved set
  let mine = loadMinted();
  let rows = {};          // { name: buildCtl handle }
  let lastMinted = null;

  function status(text, kind) {
    const el = $('mint-status');
    el.textContent = text;
    el.className = 'hint' + (kind ? ' ' + kind : '');
  }
  function progressBar(show, frac) {
    const bar = $('mint-progress');
    bar.classList.toggle('show', !!show);
    bar.firstElementChild.style.width = Math.round((frac || 0) * 100) + '%';
  }

  ctx.client.onProgress((p) => {
    progressBar(true, p.done / Math.max(1, p.total));
    status('minting · ' + p.done + ' / ' + p.total + ' · ' + (p.label || ''));
  });

  // ── the list of my axes ─────────────────────────────────────────────────
  function rebuildRows() {
    const host = $('mint-rows');
    host.innerHTML = '';
    ctx.unregisterGroup('mint');
    rows = {};
    $('mint-mine-count').textContent = mine.length
      ? mine.length + ' minted' : 'none yet';
    if (!mine.length) {
      const e = document.createElement('div');
      e.className = 'deck-empty';
      e.textContent = 'nothing minted yet — a pole pair above is enough';
      host.appendChild(e);
      ctx.refreshDeck();
      return;
    }
    const saved = (ctx.prefs.mintValues && typeof ctx.prefs.mintValues === 'object')
      ? ctx.prefs.mintValues : {};
    mine.forEach((m) => {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'link mine-del';
      del.textContent = '✕';
      del.title = 'drop this axis — from the pipeline and from disk';
      del.addEventListener('click', (e) => { e.stopPropagation(); dropAxis(m.name); });
      rows[m.name] = ctx.buildCtl({
        label: m.name,
        title: m.name + ' — minted ' + m.kind + ' axis · scale ' + (+m.scale).toFixed(3) +
               (m.consistency != null ? ' · cross-scene consistency ' + m.consistency.toFixed(3) : ''),
        key: m.name, group: 'mint', lane: 'axis:' + m.name,
        min: -6, max: 6, step: 0.05,
        value: +saved[m.name] || 0,
        section: 'mint', host: host,
        chip: () => m.name,
        headBtns: [del],
        nameClick: () => showInspector(m),
        commit: () => {},
      });
    });
    ctx.refreshDeck();
  }

  function showInspector(def) {
    lastMinted = def;
    $('mint-inspect').style.display = '';
    $('mint-inspect-name').textContent = def.name;
    const bars = $('mint-inspect-bars');
    bars.innerHTML = '';
    (def.components || []).forEach((c) => {
      const row = document.createElement('div');
      row.className = 'axis-bar-row';
      const nm = document.createElement('span');
      nm.className = 'axis-bar-name'; nm.textContent = c.name; nm.title = c.name;
      const track = document.createElement('div');
      track.className = 'axis-bar-track';
      const fill = document.createElement('div');
      fill.className = 'axis-bar-fill ' + (c.cos >= 0 ? 'pos' : 'neg');
      fill.style.width = Math.min(50, Math.abs(c.cos) * 50) + '%';
      track.appendChild(fill);
      const val = document.createElement('span');
      val.className = 'axis-bar-val';
      val.textContent = (c.cos > 0 ? '+' : '') + c.cos.toFixed(2);
      row.appendChild(nm); row.appendChild(track); row.appendChild(val);
      bars.appendChild(row);
    });
    const sink = (def.sink || []).map((s) => 'dim ' + s.dim + ' (' +
                 (100 * s.share).toFixed(1) + '%)').join(' · ');
    $('mint-inspect-note').textContent =
      'cosine against every registered axis — what this direction already was. ' +
      (def.consistency != null
        ? 'Cross-scene consistency ' + def.consistency.toFixed(3) +
          (def.consistencyRaw != null ? ' (raw ' + def.consistencyRaw.toFixed(3) + ')' : '') + '. '
        : '') +
      (sink ? 'Sinks suppressed: ' + sink + '.' : 'No sink dimension crossed the 50× bar.');
  }

  // ── minting ─────────────────────────────────────────────────────────────
  function lines(id) {
    return $(id).value.split('\n').map((s) => s.trim()).filter((s) => s.length);
  }

  function doMint(kind) {
    if (!ctx.loaded) { status('load a model first', 'err'); return; }
    const name = $('mint-name').value.trim();
    if (!name) { status('a minted axis needs a name', 'err'); return; }
    let msg;
    if (kind === 'image') {
      const images = ctx.conditionImageEntries ? ctx.conditionImageEntries() : [];
      if (!images.length) {
        status('add a condition image in the scene panel first — the mint runs the vision tower ' +
               'over it and takes its rows against the prompt\'s', 'err');
        return;
      }
      // With two or more pictures the last one is the negative pole, which is
      // the cleaner axis when both poles exist as images; with one it is the
      // picture against the words.
      msg = { type: 'mintImage', name: name, prompt: $('prompt').value,
              imagesA: images.length > 1 ? images.slice(0, images.length - 1) : images,
              imagesB: images.length > 1 ? images.slice(images.length - 1) : null };
    } else {
      const pos = lines('mint-pos'), neg = lines('mint-neg');
      const suffixMode = $('mint-mode-suffix').checked;
      if (!pos.length) { status('the positive pole is empty', 'err'); return; }
      if (!suffixMode && !neg.length) { status('the negative pole is empty', 'err'); return; }
      // A "prompt + suffix list" mint is the same paired difference with the
      // bare prompt standing in for the negative pole on every phrasing, which
      // is why there is one code path and not two.
      const negList = suffixMode ? pos.map(() => (neg[0] || '')) : neg;
      const k = Math.min(pos.length, negList.length);
      msg = { type: 'mintText', name: name,
              stems: $('mint-stems').checked ? STEMS : [''],
              pos: pos.slice(0, k), neg: negList.slice(0, k) };
      $('mint-count').textContent =
        (msg.stems.length * k * 2) + ' encodes';
    }
    ctx.setBusy(true);
    progressBar(true, 0);
    status('minting ' + name + '…');
    ctx.client.send(msg, (err, resp) => {
      ctx.setBusy(false);
      progressBar(false, 0);
      if (err) { status(String(err.message || err), 'err'); return; }
      const def = {
        name: resp.name, scale: resp.scale, kind: resp.kind,
        consistency: resp.consistency, consistencyRaw: resp.consistencyRaw,
        sink: resp.sink, components: resp.components,
        dir: f32ToB64(resp.dir instanceof Float32Array ? resp.dir : Float32Array.from(resp.dir)),
      };
      mine = mine.filter((m) => m.name !== def.name);
      mine.push(def);
      saveMinted(mine);
      rebuildRows();
      showInspector(def);
      status('minted ' + def.name + ' from ' + resp.samples + ' pole difference' +
             (resp.samples === 1 ? '' : 's') + ' · scale ' + resp.scale.toFixed(3) +
             ' · consistency ' + resp.consistency.toFixed(3) + ' · ' +
             (resp.ms / 1000).toFixed(1) + ' s', 'ok');
      $('mint-count').textContent = '';
    });
  }

  function dropAxis(name) {
    mine = mine.filter((m) => m.name !== name);
    saveMinted(mine);
    if (lastMinted && lastMinted.name === name) {
      lastMinted = null;
      $('mint-inspect').style.display = 'none';
    }
    const after = () => { rebuildRows(); status('dropped ' + name); };
    if (!ctx.loaded) { after(); return; }
    ctx.setBusy(true);
    ctx.client.send({ type: 'dropAxis', name: name }, () => { ctx.setBusy(false); after(); });
  }

  $('btn-mint').addEventListener('click', () => doMint('text'));
  $('btn-mint-image').addEventListener('click', () => doMint('image'));
  $('btn-mint-clear').addEventListener('click', () => {
    let any = false;
    for (const k in rows) {
      if (!rows.hasOwnProperty(k)) continue;
      if (rows[k].value !== 0) any = true;
      rows[k].set(0, { silent: true });
    }
    if (any && ctx.live) ctx.schedule('full');
  });
  ['mint-mode-pair', 'mint-mode-suffix'].forEach((id) => {
    $(id).addEventListener('change', () => {
      const suffix = $('mint-mode-suffix').checked;
      $('mint-pos-field').firstChild.textContent = suffix ? 'suffixes ' : 'positive pole ';
      $('mint-neg-field').firstChild.textContent = suffix ? 'base prompt ' : 'negative pole ';
    });
  });

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-mint').disabled = busyOrUnloaded;
    $('btn-mint-image').disabled = busyOrUnloaded;
  });

  // The worker rebuilds every runtime axis after a load, because
  // loadControlDictionary drops them.
  ctx.onLoadMsg((msg) => {
    msg.minted = mine.map((m) => ({ name: m.name, scale: m.scale, dir: b64ToF32(m.dir) }));
  });
  ctx.onLoaded((resp) => {
    const ok = {};
    (resp.minted || []).forEach((m) => { ok[m.name] = true; });
    const dropped = mine.filter((m) => !ok[m.name]);
    if (dropped.length) {
      mine = mine.filter((m) => ok[m.name]);
      saveMinted(mine);
      status(dropped.length + ' saved axis/axes did not fit this encoder and were dropped', 'err');
    }
    rebuildRows();
  });

  ctx.onPersist((p) => {
    const v = {};
    for (const k in rows) if (rows.hasOwnProperty(k)) v[k] = rows[k].value;
    p.mintValues = v;
  });
  ctx.onGenerateMsg((msg) => {
    // Minted axes ride in the same map the bank sliders do — the engine does
    // not distinguish a runtime axis from a dictionary one, and neither should
    // the stack budget.
    msg.axes = msg.axes || {};
    for (const k in rows) {
      if (!rows.hasOwnProperty(k)) continue;
      const v = rows[k].value;
      if (v) msg.axes[k] = (msg.axes[k] || 0) + v;
    }
  });

  ctx.mintedNames = () => mine.map((m) => m.name);
  ctx.mintedDefs = () => mine.slice();
  ctx.setMintedAxis = (n, v) => { if (rows[n]) rows[n].set(v); };
  ctx.mintFrom = doMint;   // test seam

  rebuildRows();
}
