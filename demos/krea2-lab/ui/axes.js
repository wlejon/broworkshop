// Axis bank (the 18 named conditioning-space axes from assets/axes_meta.json)
// plus the managed list of user-minted axes: per-axis use strengths, the
// spatial-tab axis dropdown, and the per-generation axisControls collection.
// Minting itself (text/image mint, inspector, sweep, gallery) lives in
// ui/mint.js; it adds axes here through ctx.addMintedAxis.

import { $, b64ToF32 } from '/app/ui/util.js';

export function initAxes(ctx) {
  // ── axis dictionary + minted axes ─────────────────────────────────────
  let axesMeta = {};          // { key: {category,label,order} } from assets/axes_meta.json
  let coreAxisEls = {};       // { key: {range, val} }
  let mintedAxes = [];        // [{name, kind:'text'|'image', pos, neg, aPath, bPath, consistency}]
  // Per-minted-axis "use" strength (what its slider sits at; 0 = off). Keyed by
  // axis name so it survives re-rendering the manager list and deleting other
  // axes. Migrated from the old 3-slot model's {name,strength} entries.
  let axisStrengths = {};
  if (ctx.prefs.axisStrengths && typeof ctx.prefs.axisStrengths === 'object') {
    axisStrengths = Object.assign({}, ctx.prefs.axisStrengths);
  } else if (Array.isArray(ctx.prefs.slots)) {
    ctx.prefs.slots.forEach((s) => { if (s && s.name) axisStrengths[s.name] = +s.strength || 0; });
  }

  // ── axis bank UI (built once from assets/axes_meta.json) ───────────────
  // Every category opens by default (the bank has a whole section to itself
  // now); a count badge on each summary flags non-zero axes hiding inside a
  // collapsed group.
  let catCounts = [];   // [{el, keys}]
  function refreshCatCounts() {
    catCounts.forEach((c) => {
      const n = c.keys.reduce((acc, k) =>
        acc + (coreAxisEls[k] && +coreAxisEls[k].range.value !== 0 ? 1 : 0), 0);
      c.el.textContent = String(n);
      c.el.classList.toggle('show', n > 0);
    });
  }
  function buildAxisBank(meta) {
    const names = Object.keys(meta).sort((a, b) => meta[a].order - meta[b].order);
    const cats = []; const byCat = {};
    names.forEach((k) => {
      const cat = meta[k].category;
      if (!byCat[cat]) { byCat[cat] = []; cats.push(cat); }
      byCat[cat].push(k);
    });
    const host = $('axis-categories');
    host.innerHTML = '';
    coreAxisEls = {};
    catCounts = [];
    cats.forEach((cat) => {
      const det = document.createElement('details');
      det.className = 'axis-cat-group';
      // details.open has no IDL reflection binding in bro's DOM — the CSS rule
      // (details:not([open]) > *:not(summary)) reads the attribute, so set that
      // directly.
      det.setAttribute('open', '');
      const sum = document.createElement('summary');
      sum.className = 'ctl-cat';
      const catName = document.createElement('span');
      catName.textContent = cat;
      const count = document.createElement('span');
      count.className = 'cat-count';
      sum.appendChild(catName); sum.appendChild(count);
      catCounts.push({ el: count, keys: byCat[cat] });
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'axis-cat-body';
      byCat[cat].forEach((k) => { body.appendChild(buildAxisRow(k, meta[k].label)); });
      det.appendChild(body);
      host.appendChild(det);
    });
    ctx.refreshDeck();
  }
  function buildAxisRow(key, label) {
    const ctl = ctx.buildCtl({
      label: label, title: key, key: key,
      min: -6, max: 6, step: 0.01,
      section: 'look',
      commit: () => {},   // collectAxisControls reads coreAxisEls directly
    });
    coreAxisEls[key] = ctl;
    return ctl.row;
  }

  // ── "your axes" — a managed list of every minted axis ──────────────────
  // Each minted axis is its own row: name (click to inspect), a use-strength
  // slider (0 = off), and a delete button. This replaces the old 3-slot picker
  // so an axis can be turned off (slider to 0) or removed entirely at a glance —
  // and there's no artificial 3-at-once cap.
  function renderAxisManager() {
    const host = $('user-slots');
    host.innerHTML = '';
    ctx.unregisterGroup('minted');   // rows are rebuilt below — drop stale entries
    if (mintedAxes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'axis-mine-empty';
      empty.textContent = 'No minted axes yet — mint one in the mint section, or from an image pair in the Image Axis tab.';
      host.appendChild(empty);
      refreshSpAxisOptions();
      ctx.refreshDeck();
      return;
    }
    mintedAxes.forEach((m) => {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'axis-mine-del';
      del.textContent = '×'; del.title = 'delete "' + m.name + '"';
      del.addEventListener('click', () => removeMintedAxis(m.name));
      ctx.buildCtl({
        label: m.name, title: 'inspect what "' + m.name + '" is made of',
        key: m.name, group: 'minted',
        min: -6, max: 6, step: 0.01,
        value: +axisStrengths[m.name] || 0,
        section: 'look', host: host,
        nameClick: () => { ctx.switchSection('mint'); ctx.showAxisInspector(m); },
        headBtns: [del],
        commit: (v) => { axisStrengths[m.name] = v; },
      });
    });
    refreshSpAxisOptions();
    ctx.refreshDeck();
  }
  // Remove a minted axis entirely: drop it from the registry + persisted state,
  // and if it was active, re-render so its effect disappears. The worker's
  // registered vector is left in place (harmless — applyAxisControls only injects
  // axes named in the per-generation control map, and we stop naming it).
  function removeMintedAxis(name) {
    const i = mintedAxes.findIndex((m) => m.name === name);
    if (i < 0) return;
    const wasActive = !!(+axisStrengths[name]);
    mintedAxes.splice(i, 1);
    delete axisStrengths[name];
    ctx.dropInspectedAxis(name);   // close the inspector if it was showing this axis
    renderAxisManager();
    ctx.refreshButtons();
    ctx.persist();
    if (wasActive && ctx.live) ctx.schedule('full');
  }
  function refreshSpAxisOptions() {
    const sel = $('sp-axis');
    const cur = sel.value;
    sel.innerHTML = '';
    const validValues = [];
    Object.keys(axesMeta).sort((a, b) => axesMeta[a].order - axesMeta[b].order).forEach((k) => {
      const o = document.createElement('option'); o.value = k; o.textContent = axesMeta[k].label + ' (' + k + ')';
      sel.appendChild(o);
      validValues.push(k);
    });
    mintedAxes.forEach((m) => {
      const o = document.createElement('option'); o.value = m.name; o.textContent = m.name + ' (yours)';
      sel.appendChild(o);
      validValues.push(m.name);
    });
    sel.value = validValues.indexOf(cur) >= 0 ? cur : (validValues[0] || '');
  }

  function collectAxisControls() {
    const out = {};
    for (const k in coreAxisEls) {
      if (!coreAxisEls.hasOwnProperty(k)) continue;
      const v = +coreAxisEls[k].range.value;
      if (v) out[k] = v;
    }
    mintedAxes.forEach((m) => {
      const v = +(axisStrengths[m.name] || 0);
      if (v) out[m.name] = (out[m.name] || 0) + v;
    });
    return out;
  }

  function addMintedAxis(def) {
    const existing = mintedAxes.findIndex((m) => m.name === def.name);
    if (existing >= 0) mintedAxes[existing] = def; else mintedAxes.push(def);
    renderAxisManager();
    ctx.persist();
  }

  // Re-register axes saved from a prior session (sequentially — the client
  // serializes requests). Each saved axis carries its minted direction, so
  // restore is a cheap registerAxis — zero encodes at load. Legacy entries
  // without a saved direction are dropped; re-mint by hand if still wanted.
  function rebuildMintedAxes() {
    const defs = Array.isArray(ctx.prefs.mintedAxes) ? ctx.prefs.mintedAxes.slice() : [];
    mintedAxes = [];
    let i = 0;
    (function next() {
      if (i >= defs.length) {
        ctx.mintProgressDone();
        renderAxisManager();   // per-axis strengths come from axisStrengths (name-keyed)
        return;
      }
      const d = defs[i++];
      if (!d || !d.name || !d.dir) { next(); return; }
      let axis;
      try { axis = b64ToF32(d.dir); }
      catch (e) { next(); return; }
      ctx.client.send({ type: 'registerAxis', name: d.name, axis: axis }, (err, resp) => {
        if (!err) addMintedAxis({ name: d.name, kind: d.kind, pos: d.pos, neg: d.neg,
                                  aPath: d.aPath, bPath: d.bPath, dir: d.dir,
                                  consistency: d.consistency,
                                  components: resp.components, residual: resp.residual });
        next();
      });
    })();
  }

  $('btn-reset-axes').addEventListener('click', () => {
    let any = false;
    for (const k in coreAxisEls) {
      if (!coreAxisEls.hasOwnProperty(k)) continue;
      if (+coreAxisEls[k].range.value !== 0) any = true;
      coreAxisEls[k].set(0, { silent: true });
    }
    if (any && ctx.live) ctx.schedule('full');
  });

  ctx.renderAxisManager = renderAxisManager;
  ctx.rebuildMintedAxes = rebuildMintedAxes;
  ctx.addMintedAxis = addMintedAxis;
  ctx.applyAxesMeta = (meta) => {
    axesMeta = meta;
    buildAxisBank(meta);
    refreshSpAxisOptions();
    // axis-bank sliders now exist — restore any persisted values
    if (ctx.prefs.axisBank) {
      for (const k in ctx.prefs.axisBank) {
        if (coreAxisEls[k]) coreAxisEls[k].set(+ctx.prefs.axisBank[k] || 0, { silent: true });
      }
    }
  };
  Object.defineProperty(ctx, 'axesMeta', { get: () => axesMeta });
  ctx.onDeckRefresh(refreshCatCounts);
  ctx.onPersist((p) => {
    const axisBank = {};
    for (const k in coreAxisEls) if (coreAxisEls.hasOwnProperty(k)) axisBank[k] = +coreAxisEls[k].range.value;
    p.axisBank = axisBank;
    p.axisStrengths = axisStrengths;
    p.mintedAxes = mintedAxes.map((m) => ({
      name: m.name, kind: m.kind, pos: m.pos, neg: m.neg, aPath: m.aPath, bPath: m.bPath,
      dir: m.dir, consistency: m.consistency,
    }));
  });
  ctx.onGenerateMsg((msg) => { msg.axisControls = collectAxisControls(); });
}
