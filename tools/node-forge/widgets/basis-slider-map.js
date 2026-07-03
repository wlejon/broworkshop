// Node Forge — generalized basis slider + 2D map panel widget.
//
// Generalizes kokoro-lab/lib/designer.js's PCA slider bank + supertonic-lab/
// lib/voicemap.js's 2D landmark map into one domain-agnostic widget: a
// k-dimensional "basis" (PCA-style component space) with a live authored
// position (`coords[k]`), a bank of per-axis sliders, and a 2D projection of
// two chosen axes where dragging repositions the crosshair (and, by
// extension, those two coords) among named preset landmarks.
//
// panelConfig contract — node-scoped functions matching curve-painter.js's
// style; the basis's *structure* (axis count/names/ranges/presets) is
// read-only/model-derived, only coords() is live/editable:
//   dim(node)            -> k, the number of basis axes
//   axisName(node, i)     -> string label for axis i
//   axisRange(node, i)    -> [lo, hi] slider range for axis i
//   coords(node)          -> the LIVE plain number[] of length k
//                            (typically node.params.<key>) — mutated in
//                            place by both the sliders and the map, per the
//                            save/load contract that widget-owned params
//                            must be plain arrays.
//   presets(node)         -> [{name, coords:number[k]}, ...]; [] if the
//                            basis has no named anchors.
//   mapAxes(node)         -> [i, j], which two coord indices the 2D map
//                            plots. Optional; defaults to [0, 1].
//   mapExtent(node)       -> a symmetric ± range for the two mapped axes.
//                            Optional; defaults to the larger of the two
//                            axisRange() magnitudes, or 6.
//   snapPx                -> click-to-snap radius in canvas px (a plain
//                            number, not a function). Optional; default 11.
//
// Like curve-painter, every interaction (slider drag, map drag, preset
// pick, snap-to-point) fires ctx.onEdit() only — never a full-graph
// clearRun(). mount(node, cfg, ctx) is called directly by a node type's own
// mount() — there is no generic panel-widget registry to route through.
//
// cfg.presets(node) points are drawn on the map AND are click-to-snap
// targets (within snapPx, default 11) — not just a separate <select>
// picker — matching qwen-tts-lab's voice map (click the nearest real
// speaker to jump straight to their exact coords) alongside free dragging.

  const MAP_W = 280, MAP_H = 280, MAP_PAD = 26;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function mapAxesOf(cfg, node) { return cfg.mapAxes ? cfg.mapAxes(node) : [0, 1]; }

  function mapExtentOf(cfg, node, ax) {
    if (cfg.mapExtent) return cfg.mapExtent(node);
    const [i, j] = ax;
    const ri = cfg.axisRange(node, i), rj = cfg.axisRange(node, j);
    const m = Math.max(Math.abs(ri[0]), Math.abs(ri[1]), Math.abs(rj[0]), Math.abs(rj[1]));
    return m > 0 ? m : 6;
  }

  // nearest preset point to a canvas pixel, within snapPx (or -1)
  function nearestPreset(presets, ai, aj, sigToPx, px, py, snapPx) {
    let bi = -1, bd = snapPx * snapPx;
    for (let i = 0; i < presets.length; i++) {
      const [dx, dy] = sigToPx(presets[i].coords[ai] || 0, presets[i].coords[aj] || 0);
      const d = (dx - px) * (dx - px) + (dy - py) * (dy - py);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  export function mountBasisSliderMap(node, cfg, ctx) {
    const root = el('div', 'basis-panel');
    const k = cfg.dim(node);
    const coords = cfg.coords(node);
    const [ai, aj] = mapAxesOf(cfg, node);
    let ext = mapExtentOf(cfg, node, [ai, aj]);

    // ---- 2D map ------------------------------------------------------------
    const mapSec = el('div', 'basis-map-wrap');
    const cv = document.createElement('canvas');
    cv.width = MAP_W; cv.height = MAP_H; cv.className = 'basis-map';
    mapSec.appendChild(cv);
    root.appendChild(mapSec);
    const mctx = cv.getContext('2d');

    function sigToPx(ax, ay) {
      const w = cv.width, h = cv.height;
      return [MAP_PAD + (ax + ext) / (2 * ext) * (w - 2 * MAP_PAD),
              MAP_PAD + (ext - ay) / (2 * ext) * (h - 2 * MAP_PAD)];
    }
    function pxToSig(px, py) {
      const w = cv.width, h = cv.height, cl = (v) => Math.max(-ext, Math.min(ext, v));
      return [cl((px - MAP_PAD) / (w - 2 * MAP_PAD) * (2 * ext) - ext),
              cl(ext - (py - MAP_PAD) / (h - 2 * MAP_PAD) * (2 * ext))];
    }

    function drawMap() {
      const w = cv.width, h = cv.height;
      mctx.clearRect(0, 0, w, h);
      mctx.fillStyle = '#0a0d12'; mctx.fillRect(0, 0, w, h);
      mctx.strokeStyle = '#1d2433'; mctx.lineWidth = 1; mctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      const [ox, oy] = sigToPx(0, 0);
      mctx.strokeStyle = '#232c3d';
      mctx.beginPath(); mctx.moveTo(MAP_PAD, oy); mctx.lineTo(w - MAP_PAD, oy);
      mctx.moveTo(ox, MAP_PAD); mctx.lineTo(ox, h - MAP_PAD); mctx.stroke();

      const presets = cfg.presets ? cfg.presets(node) : [];
      mctx.font = '10px sans-serif';
      for (const p of presets) {
        const [px, py] = sigToPx(p.coords[ai] || 0, p.coords[aj] || 0);
        mctx.fillStyle = '#6b8fd8';
        mctx.beginPath(); mctx.arc(px, py, 4, 0, 7); mctx.fill();
        mctx.fillStyle = '#8b97ac'; mctx.fillText(p.name, px + 6, py + 4);
      }
      const [hx, hy] = sigToPx(coords[ai] || 0, coords[aj] || 0);
      mctx.strokeStyle = '#c4b5ff'; mctx.fillStyle = 'rgba(179,157,255,0.18)'; mctx.lineWidth = 2;
      mctx.beginPath(); mctx.arc(hx, hy, 8, 0, 7); mctx.fill(); mctx.stroke();
      mctx.beginPath(); mctx.moveTo(hx - 12, hy); mctx.lineTo(hx + 12, hy);
      mctx.moveTo(hx, hy - 12); mctx.lineTo(hx, hy + 12); mctx.stroke();
    }

    function placeFromEvent(e) {
      const rect = cv.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const [ax, ay] = pxToSig(px, py);
      coords[ai] = ax; coords[aj] = ay;
      syncSliders();
      drawMap();
      ctx.onEdit();
    }
    // snap ALL coords to a plotted preset's complete position (not just the
    // two mapped axes), or free-move just the two map axes from the clicked
    // spot — matching qwen-tts-lab's voice map (click a real speaker to jump
    // to their exact identity; drag freely elsewhere).
    function snapToPreset(presets, i) {
      const p = presets[i];
      for (let d = 0; d < k; d++) coords[d] = p.coords[d] != null ? p.coords[d] : 0;
      syncSliders();
      drawMap();
      ctx.onEdit();
    }
    let dragging = false;
    const snapPx = cfg.snapPx || 11;
    cv.addEventListener('mousedown', (e) => {
      const rect = cv.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const presets = cfg.presets ? cfg.presets(node) : [];
      const i = presets.length ? nearestPreset(presets, ai, aj, sigToPx, px, py, snapPx) : -1;
      if (i >= 0) { snapToPreset(presets, i); dragging = false; }
      else { dragging = true; placeFromEvent(e); }
    });
    window.addEventListener('mousemove', (e) => { if (dragging) placeFromEvent(e); });
    window.addEventListener('mouseup', () => { dragging = false; });

    // ---- preset picker ------------------------------------------------------
    const presets = cfg.presets ? cfg.presets(node) : [];
    if (presets.length) {
      const sel = el('select', 'form-input basis-preset');
      sel.appendChild(el('option', null, 'Pick a preset…')).value = '';
      for (const p of presets) {
        const opt = el('option', null, p.name);
        opt.value = p.name;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        const p = presets.find((x) => x.name === sel.value);
        if (!p) return;
        for (let i = 0; i < k; i++) coords[i] = p.coords[i] != null ? p.coords[i] : 0;
        syncSliders();
        drawMap();
        ctx.onEdit();
      });
      mapSec.appendChild(sel);
    }

    // ---- slider bank ------------------------------------------------------
    const sliderSec = el('div', 'basis-sliders');
    root.appendChild(sliderSec);
    const cells = [];
    for (let i = 0; i < k; i++) {
      const [lo, hi] = cfg.axisRange(node, i);
      const cell = el('div', 'pc');
      const head = el('div', 'pc-head');
      head.appendChild(el('span', 'pc-name', cfg.axisName(node, i)));
      const val = el('span', 'pc-val', coords[i].toFixed(2));
      head.appendChild(val);
      cell.appendChild(head);
      const r = document.createElement('input');
      r.type = 'range'; r.min = String(lo); r.max = String(hi); r.step = '0.01'; r.value = String(coords[i]);
      r.addEventListener('input', () => {
        coords[i] = parseFloat(r.value);
        val.textContent = coords[i].toFixed(2);
        if (i === ai || i === aj) drawMap();
        ctx.onEdit();
      });
      cell.appendChild(r);
      cells.push({ range: r, val: val });
      sliderSec.appendChild(cell);
    }
    function syncSliders() {
      for (let i = 0; i < k; i++) {
        cells[i].range.value = String(coords[i]);
        cells[i].val.textContent = coords[i].toFixed(2);
      }
    }

    drawMap();
    return root;
  }
