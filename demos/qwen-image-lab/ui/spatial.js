// Spatial regions — several painted areas at once, each with its own
// settings, composited in one denoise.
//
// A region carries two different kinds of instruction and they reach the model
// by two different routes.
//
//   its gate multiplier   is a per-token mask, the model's only spatial hook.
//                         It is armed at the region's own step, over its own
//                         block band, on its own sublayer. Several masks
//                         coexist — the binding keeps a list — so N regions
//                         are N masks in ONE render and cost nothing extra.
//   its axis             is conditioning, which is global by construction: an
//                         axis is added to every token row, so "this axis, but
//                         only here" cannot be one render. The worker primes a
//                         second state from the same seed, steps it in
//                         lockstep, and blends its latent back under the
//                         region's feathered weight after every step — so the
//                         join happens inside the denoiser rather than between
//                         two finished pictures.
//
// Which is why the panel is honest about cost: a gate-only rack of regions is
// one render; each region that asks for an axis of its own adds a full second
// pass of the DiT.

import { $, retention, pixelMse } from '/app/ui/util.js';

const COLORS = ['#f0a860', '#5ac8d8', '#b58cf0', '#7fd67f', '#f07f9c', '#d8c85a'];

export function initSpatial(ctx) {
  let regions = [];
  let seq = 0;
  let selected = null;
  let grid = { wp: 0, hp: 0, width: 0, height: 0 };
  let baseFrame = null;
  let painting = false;

  const paint = $('sp-paint'), result = $('sp-result'), baseCv = $('sp-base');

  function status(text, kind) {
    const el = $('sp-status-text'); el.textContent = text; el.className = kind || '';
  }
  const sel = () => regions.filter((r) => r.id === selected)[0] || null;
  const painted = (r) => {
    let n = 0;
    if (r.coverage) for (let i = 0; i < r.coverage.length; i++) if (r.coverage[i]) n++;
    return n;
  };
  const anyActive = () => regions.some((r) => painted(r) > 0 && (r.amount !== 1 || r.axis));

  // ── region model ────────────────────────────────────────────────────────
  function addRegion(name) {
    const r = {
      id: ++seq,
      name: name || ('region ' + (regions.length + 1)),
      color: COLORS[regions.length % COLORS.length],
      coverage: grid.wp ? new Float32Array(grid.wp * grid.hp) : null,
      amount: 1.3, which: 'attn', lo: 16, hi: 32, at: 4,
      axis: null, axisAmount: 2, feather: 1,
    };
    regions.push(r);
    selected = r.id;
    renderList();
    ctx.refreshDeck();
    return r;
  }
  function dropRegion(id) {
    regions = regions.filter((r) => r.id !== id);
    if (selected === id) selected = regions.length ? regions[0].id : null;
    renderList();
    redraw();
    ctx.refreshDeck();
  }

  // ── the rail list ───────────────────────────────────────────────────────
  let regionRows = null;
  function renderList() {
    const host = $('sp-list');
    host.innerHTML = '';
    $('sp-count').textContent = regions.length
      ? regions.length + ' region' + (regions.length === 1 ? '' : 's') : 'none';
    if (!regions.length) {
      const e = document.createElement('div');
      e.className = 'deck-empty';
      e.textContent = 'add a region, then paint it on the Spatial tab';
      host.appendChild(e);
    }
    regions.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'sp-row' + (r.id === selected ? ' sel' : '');
      const sw = document.createElement('span');
      sw.className = 'sp-swatch'; sw.style.background = r.color;
      const nm = document.createElement('span');
      nm.className = 'sp-name'; nm.textContent = r.name;
      const meta = document.createElement('span');
      meta.className = 'sp-meta';
      meta.textContent = painted(r) + ' tok · ×' + r.amount.toFixed(2) +
                         (r.axis ? ' · ' + r.axis : '');
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'link mine-del'; del.textContent = '✕';
      del.addEventListener('click', (e) => { e.stopPropagation(); dropRegion(r.id); });
      row.appendChild(sw); row.appendChild(nm); row.appendChild(meta); row.appendChild(del);
      row.addEventListener('click', () => { selected = r.id; renderList(); syncActiveSelect(); });
      host.appendChild(row);
    });
    renderRegionPanel();
    syncActiveSelect();
  }

  // Pushing the selected region's numbers into the shared rows fires each
  // row's commit — that is what a control row's set() does, silent or not —
  // and a commit that re-listed would come straight back here. So the sync is
  // flagged, and a commit raised BY the sync does not re-enter.
  let syncing = false;
  function relist() { if (!syncing) renderList(); }

  function renderRegionPanel() {
    const r = sel();
    $('sp-region-panel').style.display = r ? '' : 'none';
    if (!r) return;
    $('sp-sel-name').textContent = r.name;
    const host = $('sp-region-rows');
    if (!regionRows) {
      host.innerHTML = '';
      regionRows = {
        amount: ctx.buildCtl({ label: 'smooth ↔ texture', id: 'sp-amount',
                               title: 'the gate multiplier inside this region — below 1 smooths, above 1 adds texture',
                               min: 0.4, max: 1.6, step: 0.05, neutral: 1, value: r.amount,
                               host: host,
                               commit: (v) => { const s = sel(); if (s) { s.amount = v; relist(); } } }),
        lo: ctx.buildCtl({ label: 'first block', id: 'sp-lo', min: 0, max: 31, step: 1,
                           neutral: 16, decimals: 0, value: r.lo, host: host,
                           commit: (v) => { const s = sel(); if (s) s.lo = v; } }),
        hi: ctx.buildCtl({ label: 'one past the last', id: 'sp-hi', min: 1, max: 32, step: 1,
                           neutral: 32, decimals: 0, value: r.hi, host: host,
                           commit: (v) => { const s = sel(); if (s) s.hi = v; } }),
        feather: ctx.buildCtl({ label: 'feather', id: 'sp-feather', min: 0, max: 4, step: 1,
                                neutral: 1, decimals: 0, value: r.feather, host: host,
                                title: 'how far the axis blend fades past the painted edge, in 16 px cells',
                                commit: (v) => { const s = sel(); if (s) s.feather = v; } }),
      };
      const axisHost = $('sp-axis-rows');
      axisHost.innerHTML = '';
      regionRows.axisAmount = ctx.buildCtl({
        label: 'axis strength', id: 'sp-axis-amt', min: -6, max: 6, step: 0.05,
        neutral: 0, value: r.axisAmount, host: axisHost,
        title: 'the axis weight inside this region — the composited state is primed with it',
        commit: (v) => { const s = sel(); if (s) s.axisAmount = v; },
      });
    }
    syncing = true;
    try {
      regionRows.amount.set(r.amount, { silent: true });
      regionRows.lo.set(r.lo, { silent: true });
      regionRows.hi.set(r.hi, { silent: true });
      regionRows.feather.set(r.feather, { silent: true });
      regionRows.axisAmount.set(r.axisAmount, { silent: true });
    } finally {
      syncing = false;
    }
    $('sp-which').value = r.which;
    $('sp-at').value = String(r.at);
    fillAxisSelect(r);
  }

  function fillAxisSelect(r) {
    const s = $('sp-axis');
    const names = (ctx.axisNames ? ctx.axisNames() : [])
      .concat(ctx.mintedNames ? ctx.mintedNames() : []);
    s.innerHTML = '<option value="">— none —</option>';
    names.forEach((n) => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      s.appendChild(o);
    });
    s.value = r.axis || '';
  }
  function syncActiveSelect() {
    const s = $('sp-active');
    s.innerHTML = '';
    regions.forEach((r) => {
      const o = document.createElement('option');
      o.value = String(r.id); o.textContent = r.name;
      s.appendChild(o);
    });
    if (selected) s.value = String(selected);
  }

  // ── the canvas ──────────────────────────────────────────────────────────
  function setBase(frame) {
    baseFrame = frame;
    grid = { wp: Math.floor(frame.width / 16), hp: Math.floor(frame.height / 16),
             width: frame.width, height: frame.height };
    regions.forEach((r) => { r.coverage = new Float32Array(grid.wp * grid.hp); });
    [paint, result, baseCv].forEach((c) => { c.width = frame.width; c.height = frame.height; });
    baseCv.getContext('2d').putImageData(frame, 0, 0);
    if (!regions.length) addRegion();
    redraw();
    $('sp-hint').style.display = 'none';
    $('sp-result-hint').style.display = '';
    result.getContext('2d').clearRect(0, 0, result.width, result.height);
    renderList();
  }
  function redraw() {
    if (!baseFrame) return;
    const c = paint.getContext('2d');
    c.putImageData(baseFrame, 0, 0);
    regions.forEach((r) => {
      if (!r.coverage) return;
      c.fillStyle = r.color;
      for (let y = 0; y < grid.hp; y++) {
        for (let x = 0; x < grid.wp; x++) {
          const v = r.coverage[y * grid.wp + x];
          if (!v) continue;
          c.globalAlpha = 0.35 * v * (r.id === selected ? 1 : 0.6);
          c.fillRect(x * 16, y * 16, 16, 16);
        }
      }
    });
    c.globalAlpha = 1;
  }
  function stroke(clientX, clientY) {
    const r = sel();
    if (!r || !r.coverage) return;
    const box = paint.getBoundingClientRect();
    const px = (clientX - box.x) * (paint.width / box.width);
    const py = (clientY - box.y) * (paint.height / box.height);
    const cx = Math.floor(px / 16), cy = Math.floor(py / 16);
    const rad = +$('sp-radius').value || 1;
    const erase = $('sp-erase').checked;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= grid.wp || y >= grid.hp) continue;
        if (dx * dx + dy * dy > rad * rad) continue;
        r.coverage[y * grid.wp + x] = erase ? 0 : 1;
        // A cell belongs to one region: painting into it takes it off the
        // others, or two masks would multiply on the same token.
        if (!erase) {
          regions.forEach((o) => { if (o !== r && o.coverage) o.coverage[y * grid.wp + x] = 0; });
        }
      }
    }
    redraw();
  }
  paint.addEventListener('pointerdown', (e) => {
    if (!baseFrame) return;
    painting = true;
    if (paint.setPointerCapture) { try { paint.setPointerCapture(e.pointerId); } catch (_) {} }
    stroke(e.clientX, e.clientY);
  });
  paint.addEventListener('pointermove', (e) => { if (painting) stroke(e.clientX, e.clientY); });
  function endStroke() {
    if (!painting) return;
    painting = false;
    renderList();
    ctx.persist();
    ctx.refreshDeck();
  }
  paint.addEventListener('pointerup', endStroke);
  paint.addEventListener('pointercancel', endStroke);

  // ── render ──────────────────────────────────────────────────────────────
  function buildRegions() {
    const out = [];
    regions.forEach((r) => {
      if (!r.coverage || !painted(r)) return;
      const hasAxis = !!(r.axis && r.axisAmount);
      if (r.amount === 1 && !hasAxis) return;
      const cells = new Float32Array(r.coverage.length);
      for (let i = 0; i < cells.length; i++) cells[i] = r.coverage[i] ? r.amount : 1;
      const e = { name: r.name, wp: grid.wp, hp: grid.hp,
                  cells: Array.from(cells), coverage: Array.from(r.coverage),
                  which: r.which, lo: Math.min(r.lo, r.hi - 1), hi: r.hi, at: r.at,
                  feather: r.feather };
      if (hasAxis) { e.axes = {}; e.axes[r.axis] = r.axisAmount; }
      out.push(e);
    });
    return out;
  }

  function doCapture() {
    if (!ctx.loaded) { status('load a model first', 'err'); return; }
    const msg = ctx.buildGenerateMsg();
    delete msg.regions;
    delete msg.gateMask;
    status('capturing the base render…');
    ctx.renderOffscreen(msg, (err, frame, resp, ms) => {
      if (err) { status(String(err.message || err), 'err'); return; }
      setBase(frame);
      $('sp-timing').textContent = ms + ' ms';
      status('captured · ' + grid.wp + '×' + grid.hp + ' token grid — paint a region');
    });
  }
  function doRender() {
    if (!ctx.loaded) { status('load a model first', 'err'); return; }
    if (!anyActive()) { status('no region carries a gate or an axis yet', 'err'); return; }
    const msg = ctx.buildGenerateMsg();
    const rs = buildRegions();
    msg.regions = rs;
    const variants = rs.filter((r) => r.axes).length;
    status('rendering ' + rs.length + ' region' + (rs.length === 1 ? '' : 's') +
           (variants ? ' · ' + variants + ' composited pass' + (variants === 1 ? '' : 'es') : '') + '…');
    ctx.renderOffscreen(msg, (err, frame, resp, ms) => {
      if (err) { status(String(err.message || err), 'err'); return; }
      result.width = frame.width; result.height = frame.height;
      result.getContext('2d').putImageData(frame, 0, 0);
      $('sp-result-hint').style.display = 'none';
      $('sp-timing').textContent = ms + ' ms' + (resp.variants ? ' · ' + (resp.variants + 1) + ' states' : '');
      const r = baseFrame ? retention(baseFrame, frame) : 0;
      const m = baseFrame ? pixelMse(baseFrame, frame) : 0;
      status('done · mse ' + m.toFixed(0) + ' · retention ' + r.toFixed(3), 'ok');
    });
  }

  $('btn-sp-add').addEventListener('click', () => { addRegion(); status('region added'); });
  $('btn-sp-clear').addEventListener('click', () => {
    regions = []; selected = null; renderList(); redraw(); ctx.refreshDeck();
  });
  $('btn-sp-capture').addEventListener('click', doCapture);
  $('btn-sp-render').addEventListener('click', doRender);
  $('btn-sp-wipe').addEventListener('click', () => {
    const r = sel();
    if (!r || !r.coverage) return;
    r.coverage.fill(0);
    redraw(); renderList(); ctx.refreshDeck();
  });
  $('sp-active').addEventListener('change', () => {
    selected = +$('sp-active').value || null;
    renderList(); redraw();
  });
  $('sp-which').addEventListener('change', () => { const r = sel(); if (r) { r.which = $('sp-which').value; renderList(); } });
  $('sp-at').addEventListener('change', () => { const r = sel(); if (r) { r.at = Math.max(0, +$('sp-at').value | 0); } });
  $('sp-axis').addEventListener('change', () => {
    const r = sel();
    if (!r) return;
    r.axis = $('sp-axis').value || null;
    renderList();
  });

  ctx.registerEntry({
    section: 'spatial',
    active: () => anyActive(),
    chip: () => regions.filter((r) => painted(r) > 0).length + ' region' +
                (regions.filter((r) => painted(r) > 0).length === 1 ? '' : 's'),
    chipValue: () => String(regions.reduce((a, r) => a + painted(r), 0)) + ' tok',
    zero: (opts) => {
      regions.forEach((r) => { if (r.coverage) r.coverage.fill(0); });
      redraw(); renderList();
      if ((!opts || !opts.silent) && ctx.live) ctx.schedule('full');
    },
    reveal: () => { ctx.switchTab('spatial'); ctx.switchSection('spatial'); },
  });

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-sp-capture').disabled = busyOrUnloaded;
    $('btn-sp-render').disabled = busyOrUnloaded || !baseFrame;
  });
  ctx.onGenerateMsg((msg) => {
    const rs = buildRegions();
    if (rs.length) msg.regions = rs;
  });

  // Test seams.
  ctx.spatialCapture = doCapture;
  ctx.spatialRender = doRender;
  ctx.spatialGrid = () => grid;
  ctx.spatialRegions = () => regions;
  ctx.spatialAdd = addRegion;
  ctx.spatialSelect = (id) => { selected = id; renderList(); redraw(); };
  ctx.spatialBase = () => baseFrame;
  ctx.spatialResult = () => (result.width
    ? result.getContext('2d').getImageData(0, 0, result.width, result.height) : null);
  // Paint a rectangle of cells into the selected region — the same thing a
  // stroke does, addressed in token coordinates.
  ctx.spatialPaintCells = (x0, y0, x1, y1) => {
    const r = sel();
    if (!r || !r.coverage) return 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= grid.wp || y >= grid.hp) continue;
        r.coverage[y * grid.wp + x] = 1;
        regions.forEach((o) => { if (o !== r && o.coverage) o.coverage[y * grid.wp + x] = 0; });
        n++;
      }
    }
    redraw(); renderList(); ctx.refreshDeck();
    return n;
  };

  renderList();
}
