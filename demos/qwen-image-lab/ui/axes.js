// The axis bank — assets/axes_qi21_v2.bcd1, 88 directions minted by diff of
// means over 12 neutral scene stems x 2 phrasings a pole (qwen-image-research
// lib/axesv2.js, scripts/60_mint_v2.js).
//
// These are the surface with authority: the best minted axis moves its readout
// 25 sigma where the best in-network dial manages 4.4. Each is a unit direction
// in the Qwen3-VL-8B row space with a baked scale — 0.15 x the panel's mean
// token norm (121.256) — so a slider of 1.0 lands about where saying the words
// in the prompt lands, and the injected vector is alpha * scale * dir added to
// every token row of the positive conditioning at prime() time.
//
// The engine holds the STACK to setControlBudget(): every axis is added to
// every row, so ten sliders at +2 push twice as hard as one at +10, and past
// the budget the injection rather than the prompt is what gets drawn. Over
// budget every active axis is scaled by ONE common factor, so the mix survives.

import { $ } from '/app/ui/util.js';

export function initAxes(ctx) {
  let rows = {};        // { axisName: buildCtl handle }
  let scales = {};      // { axisName: the bank's baked scale }
  let catCounts = [];   // [{el, keys}]

  function categoryOf(name) {
    const i = name.indexOf('.');
    return i > 0 ? name.slice(0, i) : 'other';
  }

  function refreshCatCounts() {
    catCounts.forEach((c) => {
      const n = c.keys.reduce((acc, k) => acc + (rows[k] && rows[k].value !== 0 ? 1 : 0), 0);
      c.el.textContent = String(n);
      c.el.classList.toggle('show', n > 0);
    });
  }

  // Built (or rebuilt) when a model load reports the bank it read.
  function buildAxisBank(axes) {
    const host = $('axis-categories');
    host.innerHTML = '';
    ctx.unregisterGroup('bank');
    rows = {}; scales = {}; catCounts = [];
    $('axis-count').textContent = axes.length
      ? axes.length + ' minted axes'
      : 'load a model to read the bank';
    if (!axes.length) { applyFilter(); ctx.refreshDeck(); return; }

    const byCat = {}, cats = [];
    axes.forEach((a) => {
      const cat = categoryOf(a.name);
      if (!byCat[cat]) { byCat[cat] = []; cats.push(cat); }
      byCat[cat].push(a);
      scales[a.name] = a.scale;
    });
    cats.sort();
    const saved = (ctx.prefs.axisBank && typeof ctx.prefs.axisBank === 'object')
      ? ctx.prefs.axisBank : {};
    cats.forEach((cat) => {
      const det = document.createElement('details');
      det.className = 'axis-cat-group';
      // details.open has no IDL reflection in bro's DOM — the CSS rule reads
      // the attribute, so set that directly.
      det.setAttribute('open', '');
      const sum = document.createElement('summary');
      sum.className = 'ctl-cat';
      const nm = document.createElement('span');
      nm.textContent = cat;
      const count = document.createElement('span');
      count.className = 'cat-count';
      sum.appendChild(nm); sum.appendChild(count);
      catCounts.push({ el: count, keys: byCat[cat].map((a) => a.name) });
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'axis-cat-body';
      byCat[cat].forEach((a) => {
        const h = ctx.buildCtl({
          label: a.name.slice(cat.length + 1) || a.name,
          title: a.name + ' — bank scale ' + a.scale.toFixed(3) +
                 ' (alpha 1.0 ≈ saying it in the prompt)',
          key: a.name, group: 'bank', lane: 'axis:' + a.name,
          min: -6, max: 6, step: 0.05,
          value: +saved[a.name] || 0,
          section: 'axes', host: body,
          chip: () => a.name,
          commit: () => {},
        });
        rows[a.name] = h;
      });
      det.appendChild(body);
      host.appendChild(det);
    });
    applyFilter();
    ctx.refreshDeck();
  }

  // ── search / filter ─────────────────────────────────────────────────────
  // 88 sliders is a list, not a panel, until it can be narrowed.
  function applyFilter() {
    const q = $('axis-search').value.trim().toLowerCase();
    const activeOnly = $('axis-active-only').checked;
    let shown = 0, total = 0;
    for (const name in rows) {
      if (!rows.hasOwnProperty(name)) continue;
      total++;
      const hit = (!q || name.toLowerCase().indexOf(q) >= 0) &&
                  (!activeOnly || rows[name].value !== 0);
      rows[name].row.classList.toggle('hidden', !hit);
      if (hit) shown++;
    }
    // A category whose every row is filtered out folds away with them.
    document.querySelectorAll('#axis-categories .axis-cat-group').forEach((det) => {
      const any = det.querySelectorAll('.ctl:not(.hidden)').length > 0;
      det.classList.toggle('hidden', !any);
    });
    $('axis-shown').textContent = total ? shown + ' / ' + total + ' shown' : '';
  }
  $('axis-search').addEventListener('input', applyFilter);
  $('axis-active-only').addEventListener('change', applyFilter);

  // ── the stack budget ────────────────────────────────────────────────────
  const budget = ctx.buildCtl({
    label: 'stack budget', title: 'setControlBudget — 0 leaves the stack uncapped',
    id: 'budget', min: 0, max: 60, step: 1, neutral: 0, decimals: 0,
    value: ctx.prefs.budget != null ? +ctx.prefs.budget : 0,
    host: $('budget-rows'),
    commit: () => {},
  });

  $('btn-reset-axes').addEventListener('click', () => {
    let any = false;
    for (const k in rows) {
      if (!rows.hasOwnProperty(k)) continue;
      if (rows[k].value !== 0) any = true;
      rows[k].set(0, { silent: true });
    }
    applyFilter();
    if (any && ctx.live) ctx.schedule('full');
  });

  function collect() {
    const out = {};
    for (const k in rows) {
      if (!rows.hasOwnProperty(k)) continue;
      const v = rows[k].value;
      if (v) out[k] = v;
    }
    return out;
  }

  ctx.buildAxisBank = buildAxisBank;
  ctx.axisNames = () => Object.keys(rows);
  ctx.axisScale = (n) => scales[n];
  ctx.setAxis = (n, v) => { if (rows[n]) rows[n].set(v); };
  ctx.collectAxes = collect;
  ctx.onDeckRefresh(() => { refreshCatCounts(); applyFilter(); });
  ctx.onPersist((p) => {
    const bank = {};
    for (const k in rows) if (rows.hasOwnProperty(k)) bank[k] = rows[k].value;
    p.axisBank = bank;
    p.budget = budget.value;
  });
  ctx.onGenerateMsg((msg) => {
    msg.axes = collect();
    msg.budget = budget.value;
  });
}
