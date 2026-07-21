// ═══ location spine — the coarse overview map + the sample window ════════════
//
// Every probe reads ONE region: seed + the native-cell window (i, j, extent). This
// panel is where you set it. The overview is a wide coarse-elevation field —
// world.coarse() is the 2.8M net and returns in well under a millisecond, so it is
// cheap to redraw — with the current sample window drawn on it as a rectangle.
// Click to aim; the window centres on the click. Seed is the world's identity and
// is fixed at load, so changing it reloads the checkpoint.

import { $, state, luts, emit, status, on } from "/app/lib/core.js";
import { el, mkButton, drawField } from "/app/lib/helpers.js";
import { loadWorld } from "/app/lib/model.js";

const OV_CELLS = 192;          // coarse cells across the overview (~1475 km)
const OV_PX    = 288;          // overview canvas size in pixels

let base = null, overlay = null, octx = null;
let ov = null;                 // { ci0, cj0, cells, cellSize } of the drawn field
let iInput, jInput, extInput, seedInput, readout;

// Native-cell (i, j) of the window CENTRE — what the controls and the map agree on.
function centre() {
    return { ci: state.region.i + state.region.extent / 2,
             cj: state.region.j + state.region.extent / 2 };
}

// Native (30 m) cells per coarse cell — 256 on the 30 m checkpoint. coarseCellSize
// is in METRES, so divide by the native cell size to get the index ratio.
function nativePerCoarse() { return state.world.coarseCellSize / state.world.cellSize; }

// Redraw the coarse field, centred on the current window, and remember its bounds.
function drawOverview() {
    if (!state.world) return;
    const coarseCell = nativePerCoarse();
    const c = centre();
    const half = OV_CELLS / 2;
    const ci0 = Math.round(c.ci / coarseCell - half);
    const cj0 = Math.round(c.cj / coarseCell - half);
    let field;
    try {
        field = state.world.coarse(ci0, cj0, ci0 + OV_CELLS, cj0 + OV_CELLS);
    } catch (e) { status('overview: ' + e.message, true); return; }
    ov = { ci0, cj0, cells: OV_CELLS, cellSize: field.cellSize };
    drawField(base, field.data, field.width, field.height, luts().terrain);
    drawWindow();
}

// The sample window as a rectangle on the overview, in overview pixels.
function drawWindow() {
    if (!ov || !octx) return;
    octx.clearRect(0, 0, OV_PX, OV_PX);
    const coarseCell = nativePerCoarse();
    const px = (nativeJ) => ((nativeJ / coarseCell - ov.cj0) / ov.cells) * OV_PX;
    const py = (nativeI) => ((nativeI / coarseCell - ov.ci0) / ov.cells) * OV_PX;
    const x0 = px(state.region.j), y0 = py(state.region.i);
    const x1 = px(state.region.j + state.region.extent);
    const y1 = py(state.region.i + state.region.extent);
    const w = Math.max(3, x1 - x0), h = Math.max(3, y1 - y0);
    octx.strokeStyle = '#ffd24a'; octx.lineWidth = 2;
    octx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
    octx.strokeStyle = 'rgba(0,0,0,0.6)'; octx.lineWidth = 1;
    octx.strokeRect(x0 - 0.5, y0 - 0.5, w + 2, h + 2);
    // A crosshair at the centre so a tiny window is still findable.
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    octx.strokeStyle = '#ffd24a';
    octx.beginPath();
    octx.moveTo(cx - 7, cy); octx.lineTo(cx + 7, cy);
    octx.moveTo(cx, cy - 7); octx.lineTo(cx, cy + 7);
    octx.stroke();
}

function syncInputs() {
    iInput.value = state.region.i;
    jInput.value = state.region.j;
    extInput.value = state.region.extent;
    seedInput.value = state.seed;
    updateReadout();
}

// A one-glance readout of what the window actually covers on the ground — the
// numeric controls are in abstract native cells, so translate to km and metres.
function updateReadout() {
    if (!readout) return;
    const cs = state.world ? state.world.cellSize : 30;
    const km = (state.region.extent * cs / 1000);
    const span = km >= 10 ? km.toFixed(0) : km.toFixed(1);
    readout.textContent = state.region.extent + ' cells → ' + span + ' km across · '
        + cs + ' m/cell · at (' + state.region.i + ', ' + state.region.j + ')';
}

// Move the window so its CENTRE is at native cell (ci, cj), then tell the probes.
function placeCentre(ci, cj) {
    const half = state.region.extent / 2;
    state.region.i = Math.round(ci - half);
    state.region.j = Math.round(cj - half);
    syncInputs();
    // If the window has wandered near the overview edge, recut the overview so
    // there is always context around it; otherwise just move the rectangle.
    const c = centre(), coarseCell = nativePerCoarse();
    const relI = (c.ci / coarseCell - ov.ci0) / ov.cells;
    const relJ = (c.cj / coarseCell - ov.cj0) / ov.cells;
    if (relI < 0.2 || relI > 0.8 || relJ < 0.2 || relJ > 0.8) drawOverview();
    else drawWindow();
    emit('region');
}

// One labelled numeric field for the control grid — label above a full-width
// input, so four of them tile cleanly into two columns in the narrow rail.
function mkField(grid, label, value, step, onChange) {
    const f = el('label', 'loc-field');
    f.appendChild(el('span', 'loc-lbl', label));
    const input = document.createElement('input');
    input.type = 'number'; input.value = value; input.step = step || 1;
    input.addEventListener('change', () => onChange(parseFloat(input.value)));
    f.appendChild(input);
    grid.appendChild(f);
    return input;
}

export function buildRegionBar(host) {
    const panel = el('div', 'loc-panel');
    panel.appendChild(el('div', 'card-title', 'location'));

    // the overview map: a colormap base canvas with a 2D overlay for the window.
    const mapWrap = el('div', 'overview');
    mapWrap.style.width = OV_PX + 'px'; mapWrap.style.height = OV_PX + 'px';
    base = document.createElement('canvas'); base.width = OV_PX; base.height = OV_PX;
    base.className = 'ov-base';
    overlay = document.createElement('canvas'); overlay.width = OV_PX; overlay.height = OV_PX;
    overlay.className = 'ov-overlay';
    octx = overlay.getContext('2d');
    mapWrap.appendChild(base); mapWrap.appendChild(overlay);
    mapWrap.title = 'Click to aim the sample window here';
    overlay.addEventListener('click', (e) => {
        if (!ov) return;
        const r = overlay.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        const coarseCell = nativePerCoarse();
        const cj = (ov.cj0 + px * ov.cells) * coarseCell;
        const ci = (ov.ci0 + py * ov.cells) * coarseCell;
        placeCentre(ci, cj);
    });
    panel.appendChild(mapWrap);
    readout = el('div', 'loc-readout');
    panel.appendChild(readout);

    // seed / extent / i / j as a compact 2×2 grid.
    const grid = el('div', 'loc-grid');
    seedInput = mkField(grid, 'seed', state.seed, 1, (v) => {
        // seed is fixed at load — a change is a reload at the new identity.
        const s = v | 0;
        if (s === state.seed) return;
        loadWorld(state.dir, s, null);
    });
    extInput = mkField(grid, 'extent', state.region.extent, 32, (v) => {
        state.region.extent = Math.max(16, v | 0); syncInputs(); drawWindow(); emit('region');
    });
    iInput = mkField(grid, 'i (N→S)', state.region.i, 32, (v) => { state.region.i = v | 0; updateReadout(); drawWindow(); emit('region'); });
    jInput = mkField(grid, 'j (W→E)', state.region.j, 32, (v) => { state.region.j = v | 0; updateReadout(); drawWindow(); emit('region'); });
    panel.appendChild(grid);

    const actions = el('div', 'loc-actions');
    mkButton(actions, '🎲 reseed', () => loadWorld(state.dir, (state.seed + 1) | 0, null),
             'Load the next seed — a different world');
    mkButton(actions, '⟳ generate', () => emit('region'),
             'Regenerate the current probe at this region');
    panel.appendChild(actions);

    host.appendChild(panel);
    updateReadout();

    on('world', (w) => { if (w) { syncInputs(); drawOverview(); } });
}
