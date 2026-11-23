// Planetary Thermodynamic Memory — 125 Years of Earth's Atmosphere.
// Connects bro.table mmap/AVX2/Range/SpatialIndex, bro.kernel HDR atomic splatting,
// parallel groupBy('decade') warming curves, and 3D SpatialSonifier.

import { boot, $, $$, h, bindControl, fpsMeter, frameLoop, toggleButton, readout } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";
import { HdrSplatEngine } from "/lib/sci-atlas/splat-engine.js";
import { OrbitView } from "/lib/sci-atlas/orbit-view.js";
import { SpatialSonifier } from "/lib/sci-atlas/sonifier.js";
import { createEngineProofPanel } from "/lib/sci-atlas/table-proof.js";

import { MANIFOLDS, THERMO_PACK_SHADER, THERMO_SHADER } from "/app/manifolds.js";
import {
    GPU_COLS,
    EARTH_RADIUS_KM,
    CLIMATE_HOTSPOTS,
    latLonToEarth,
    doyToLabel,
    loadThermoDataset,
} from "/app/data.js";
import {
    buildLatProfile,
    drawWarmingChart,
    drawLatChart,
    drawOverlay,
    evalObsManifold,
} from "/app/charts.js";

const app = boot();
app.status.busy('loading 125-year planetary thermodynamic archive…');

const dataset = loadThermoDataset();
const snap = dataset.snap;
const stationsSnap = dataset.stationsSnap;
const totalRows = snap.rowCount;
const tableStats = snap.stats();

const viewCanvas = $('#view');
const overlayCanvas = $('#overlay');
const warmingCanvas = $('#chart-warming');
const latCanvas = $('#chart-lat');

const view = new OrbitView(viewCanvas, Object.assign({}, MANIFOLDS[0].preset, {
    immediate: true,
    minDist: 0.45,
    maxDist: 16.0,
    fovScale: 0.92,
}));

const densScale = Math.min(1.0, Math.pow(150000 / Math.max(150000, totalRows), 0.78));

const engine = new HdrSplatEngine(viewCanvas, THERMO_SHADER, {
    shaderFile: 'thermo_manifolds.bk',
    exposure: 0.72 * densScale,
    bloomAmt: totalRows > 500000 ? 0.10 : 0.24,
    radiusMode: totalRows > 500000 ? 0 : 1,
});
engine.uploadColumns(snap, GPU_COLS);

let packedStores = null;
if (engine.gpuReady) {
    const cb = engine.colBuffers;
    const packMod = bro.kernel.compile(THERMO_PACK_SHADER, { file: 'thermo_pack.bk' });
    const kPack4 = packMod.kernel('k_pack4');
    const kPackState = packMod.kernel('k_pack_state');
    const s0 = bro.kernel.createBuffer(totalRows * 16, { residency: 'gpu' });
    const s1 = bro.kernel.createBuffer(totalRows * 16, { residency: 'gpu' });
    const packStride = Math.min(totalRows, 1048576);
    kPack4.dispatch(packStride, cb.ex, cb.ey, cb.ez, cb.anom_c, s0, totalRows, packStride);
    kPackState.dispatch(packStride, cb.year, cb.doy, cb.tmin_c, cb.tmax_c, cb.lat, s1, totalRows, packStride);
    engine.destroyColumns();
    packedStores = { s0, s1 };
}

const sonifier = new SpatialSonifier({ cooldownMs: 110 });
const fps = fpsMeter();

const state = {
    manifold: 0,
    yearLo: 1900,
    yearHi: 2025,
    centuryPlaying: false,
    centuryCursor: 1900,
    anomMin: -12.0,
    anomMax: 12.0,
    latMin: -90.0,
    latMax: 90.0,
    probePt: latLonToEarth(CLIMATE_HOTSPOTS[0].lat, CLIMATE_HOTSPOTS[0].lon),
    probeHits: null,
    baseDecadeGroups: [],
    filteredDecadeGroups: null,
    globalAgg: null,
    latProfile: buildLatProfile(snap, null, 1900, 2025),
    summaryReady: false,
    workerStats: null,
    filterBusy: false,
    lastFilterMatched: totalRows,
};

const regimeKv = readout('#regime-box', {
    meanAnom: 'window mean ΔT',
    arcticMean: 'Arctic (>60°N)',
    tropicsMean: 'Tropics (±23.5°)',
    ampRatio: 'Arctic/Tropics ratio',
    extremeSpan: 'min / max ΔT',
});

let hotspotIdx = 0;

// Shared O(1) COW Snapshot Worker
const rpc = workerClient('../../lib/sci-atlas/table-worker.js', { type: 'module' });

const proof = createEngineProofPanel($('#proof-panel'));
proof.setProvenance(
    dataset.isReal,
    tableStats,
    'bro-headless --grant files,net,spawn demos/planetary-thermo demos/planetary-thermo/ingest.js'
);

$('#st-rows').textContent = fmtInt(totalRows);
$('#hud-backend').textContent = engine.gpuReady ? 'Vulkan HDR' : '2D';
$('#hud-count').textContent = fmtInt(totalRows);

function fmtSigned(v, dec = 2) {
    if (v == null || !Number.isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(dec) + '°C';
}

function updateRegimeReadout() {
    const p = state.latProfile;
    const gAgg = state.globalAgg;
    const meanV = Number.isFinite(p && p.activeMeanAll) ? p.activeMeanAll : (gAgg ? gAgg.avg_anom_c : NaN);
    const arcV = p ? p.arcticMean : NaN;
    const trpV = p ? p.tropicsMean : NaN;
    const ratioStr = (Number.isFinite(arcV) && Number.isFinite(trpV) && Math.abs(trpV) > 0.05)
        ? (arcV / trpV).toFixed(2) + 'x'
        : '—';
    const minStr = gAgg && Number.isFinite(gAgg.min_anom_c) ? gAgg.min_anom_c.toFixed(1) : '—';
    const maxStr = gAgg && Number.isFinite(gAgg.max_anom_c) ? '+' + gAgg.max_anom_c.toFixed(1) : '—';

    regimeKv.set({
        meanAnom: fmtSigned(meanV, 2),
        arcticMean: fmtSigned(arcV, 2),
        tropicsMean: fmtSigned(trpV, 2),
        ampRatio: ratioStr,
        extremeSpan: `${minStr} / ${maxStr}°C`,
    });
    $('#st-mean').textContent = fmtSigned(meanV, 2);
}

function updateHudTexts() {
    const info = MANIFOLDS[state.manifold] || MANIFOLDS[0];
    const lo = Math.round(state.yearLo);
    const hi = Math.round(state.yearHi);
    const winStr = `${lo}–${hi}`;
    const meanV = state.latProfile && Number.isFinite(state.latProfile.activeMeanAll)
        ? fmtSigned(state.latProfile.activeMeanAll, 2)
        : '—';
    $('#hud-manifold').innerHTML =
        `<b>${info.short}</b> · ${winStr} · mean ΔT ${meanV}` +
        `<div class="sci-guide">${info.guide}</div>` +
        `<div class="sci-formula">${info.formula}</div>`;
    $('#st-manifold').textContent = String(state.manifold);
    $('#st-window').textContent = winStr;
}

function setManifold(idx) {
    const m = Math.max(0, Math.min(3, idx | 0));
    state.manifold = m;
    for (const btn of $$('[data-manifold]')) {
        btn.classList.toggle('active', (btn.dataset.manifold | 0) === m);
    }
    const dense = totalRows > 500000;
    const mGain = dense
        ? (m === 2 ? 0.40 : (m === 1 ? 0.56 : (m === 3 ? 0.92 : 0.72)))
        : (m === 2 ? 0.56 : (m === 1 ? 0.74 : 0.78));
    engine.exposure = mGain * densScale;
    engine.bloomAmt = dense ? 0.10 : (m === 2 ? 0.18 : 0.24);
    view.setManifold(m);
    view.setView(MANIFOLDS[m].preset);
    updateHudTexts();
}

for (const btn of $$('[data-manifold]')) {
    btn.addEventListener('click', () => setManifold(btn.dataset.manifold | 0));
}

function renderDecadeBreakdown(groups) {
    const host = $('#decade-breakdown');
    host.innerHTML = '';
    if (!groups || groups.length === 0) return;
    const sorted = groups.slice().sort((a, b) => a.decade - b.decade);
    let maxAbs = 0.5;
    for (const g of sorted) {
        if (Math.abs(g.avgVal) > maxAbs) maxAbs = Math.abs(g.avgVal);
    }
    for (const g of sorted) {
        const v = Number.isFinite(g.avgVal) ? g.avgVal : 0;
        const pct = Math.min(48, (Math.abs(v) / maxAbs) * 48);
        const left = v >= 0 ? 50 : (50 - pct);
        const col = v < 0 ? '#3ea8ff' : (v < 0.75 ? '#ffb642' : '#ff523a');
        host.appendChild(h('div.thermo-decade-row', null,
            h('span', { style: 'min-width:34px; color:var(--k-muted)' }, String(g.decade)),
            h('div.thermo-decade-bar', null,
                h('i', { style: `left:${left.toFixed(1)}%; width:${pct.toFixed(1)}%; background:${col}` })
            ),
            h('span', { style: `min-width:52px; text-align:right; color:${col}` },
                (v >= 0 ? '+' : '') + v.toFixed(2) + '°'
            ),
        ));
    }
}

function redrawAllCharts() {
    drawWarmingChart(warmingCanvas, state.baseDecadeGroups, state.filteredDecadeGroups, state);
    drawLatChart(latCanvas, state.latProfile, state);
    updateRegimeReadout();
    updateHudTexts();
}

// Spatial Probe + 3D SpatialSonifier
function playClimateChord(rows, centerPt) {
    if (!sonifier.enabled || !rows || rows.length === 0) return;
    const scale = [130.81, 146.83, 164.81, 185.00, 196.00, 220.00, 246.94,
                   261.63, 293.66, 329.63, 369.99, 392.00, 440.00, 493.88, 523.25, 659.25];
    const notes = rows.slice(0, 6).map((r) => {
        const u = Math.max(0, Math.min(1, (r.anom_c + 5.0) / 10.0));
        const freq = scale[Math.min(scale.length - 1, Math.floor(u * scale.length))];
        return {
            freq,
            waveform: r.anom_c > 3.0 ? 'triangle' : 'sine',
            gain: Math.abs(r.anom_c) > 3.5 ? 0.19 : 0.13,
            dur: 0.65,
            release: 0.75,
            pos: [
                (r.ex - centerPt[0]) * 5.0,
                (r.ey - centerPt[1]) * 5.0,
                (r.ez - centerPt[2]) * 5.0,
            ],
        };
    });
    sonifier.playChord(notes);
}

function probeEarth(pt, label = 'Globe Probe') {
    const t0 = performance.now();
    const stTbl = stationsSnap.nearest('earth3d', pt, 10);
    const stRows = stTbl.toArray();
    const spDt = performance.now() - t0;

    let obsRows = [];
    if (stRows.length > 0) {
        const s0 = stRows[0];
        const q = bro.table;
        const qRes = snap.query()
            .where(q.and(
                q.ge('lat', s0.lat - 0.6), q.le('lat', s0.lat + 0.6),
                q.ge('lon', s0.lon - 0.6), q.le('lon', s0.lon + 0.6)
            ))
            .select({
                ex: 'ex', ey: 'ey', ez: 'ez', lat: 'lat', lon: 'lon',
                year: 'year', doy: 'doy', tmin_c: 'tmin_c', tmax_c: 'tmax_c', anom_c: 'anom_c',
            })
            .limit(10)
            .run();
        obsRows = qRes.toArray();
    }

    const rows = [];
    for (let i = 0; i < 10; i++) {
        if (i < obsRows.length) {
            const o = obsRows[i];
            const dist = Math.hypot(o.ex - pt[0], o.ey - pt[1], o.ez - pt[2]);
            rows.push(Object.assign({ _distance: dist }, o));
        } else if (i < stRows.length) {
            const sr = stRows[i];
            rows.push({
                ex: sr.ex, ey: sr.ey, ez: sr.ez, lat: sr.lat, lon: sr.lon,
                year: null, doy: null, obs_count: sr.obs_count,
                tmin_c: NaN, tmax_c: NaN, anom_c: sr.mean_anom,
                _distance: sr._distance || 0,
            });
        }
    }

    state.probePt = pt.slice(0, 3);
    state.probeHits = rows;

    const r0 = stRows[0] || rows[0];
    const locStr = r0 ? `${r0.lat.toFixed(1)}°, ${r0.lon.toFixed(1)}°` : '—';
    $('#probe-box').textContent =
        `${label} · ${locStr}\n` +
        `SpatialIndex('earth3d').nearest(10): ${stRows.length} stns in ${fmtMs(spDt)}`;

    const tbody = $('#probe-list');
    tbody.innerHTML = '';
    for (const r of rows) {
        const km = Math.round((r._distance || 0) * EARTH_RADIUS_KM);
        const aCol = r.anom_c < 0 ? '#55b8ff' : (r.anom_c > 2.5 ? '#ff6142' : '#ffb84d');
        const aSign = r.anom_c >= 0 ? '+' : '';
        const whenStr = r.year != null ? `${r.year}·${doyToLabel(r.year, r.doy)}` : `${r.obs_count || 0} obs`;
        const tmStr = Number.isFinite(r.tmin_c) ? `${Math.round(r.tmin_c)}/${Math.round(r.tmax_c)}°` : 'mean';
        tbody.appendChild(h('tr', null,
            h('td', null, String(km)),
            h('td', null, `${r.lat.toFixed(0)}°,${r.lon.toFixed(0)}°`),
            h('td', null, whenStr),
            h('td', null, tmStr),
            h('td', { style: `color:${aCol}` }, `${aSign}${r.anom_c.toFixed(1)}°`),
        ));
    }

    $('#st-probe').textContent = `${rows.length} obs (${fmtMs(spDt)})`;
    redrawAllCharts();
    playClimateChord(rows, pt);
}

function findNearestObsInManifold(m, clickPt) {
    const camF = view.camVecs().F;
    let best = null;
    let bestD2 = Infinity;
    const nChunks = snap.chunkCount;
    const stride = Math.max(1, Math.floor(totalRows / 25000));
    for (let ci = 0; ci < nChunks; ci++) {
        const rc = snap.chunkRowCount(ci);
        const ex = snap.chunkColumnView(ci, 'ex');
        const ey = snap.chunkColumnView(ci, 'ey');
        const ez = snap.chunkColumnView(ci, 'ez');
        const lat = snap.chunkColumnView(ci, 'lat');
        const yr = snap.chunkColumnView(ci, 'year');
        const doy = snap.chunkColumnView(ci, 'doy');
        const tmin = snap.chunkColumnView(ci, 'tmin_c');
        const tmax = snap.chunkColumnView(ci, 'tmax_c');
        const anom = snap.chunkColumnView(ci, 'anom_c');
        for (let r = 0; r < rc; r += stride) {
            const p = evalObsManifold(m, {
                ex: ex[r], ey: ey[r], ez: ez[r], lat: lat[r],
                year: yr[r], doy: doy[r], tmin_c: tmin[r], tmax_c: tmax[r], anom_c: anom[r],
            });
            const dx = p[0] - clickPt[0];
            const dy = p[1] - clickPt[1];
            const dz = p[2] - clickPt[2];
            // Perpendicular distance to camera view ray through clickPt
            const projF = dx * camF[0] + dy * camF[1] + dz * camF[2];
            const px = dx - camF[0] * projF;
            const py = dy - camF[1] * projF;
            const pz = dz - camF[2] * projF;
            const d2 = px * px + py * py + pz * pz;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = [ex[r], ey[r], ez[r]];
            }
        }
    }
    return best || latLonToEarth(49.0, 9.0);
}

view.onProbe = (pt) => {
    const m = view.toManifold | 0;
    if (m === 0) {
        const camF = view.camVecs().F;
        const r2 = pt[0] * pt[0] + pt[1] * pt[1] + pt[2] * pt[2];
        let surf;
        if (r2 < 1.0) {
            const k = Math.sqrt(1.0 - r2);
            surf = [pt[0] - camF[0] * k, pt[1] - camF[1] * k, pt[2] - camF[2] * k];
        } else {
            const inv = 1.0 / Math.max(1e-5, Math.sqrt(r2));
            surf = [pt[0] * inv, pt[1] * inv, pt[2] * inv];
        }
        probeEarth(surf, 'Earth Shell Pick');
    } else {
        const earthPt = findNearestObsInManifold(m, pt);
        probeEarth(earthPt, `${MANIFOLDS[m].short} Pick`);
    }
};

$('#btn-probe').addEventListener('click', () => {
    const hs = CLIMATE_HOTSPOTS[hotspotIdx % CLIMATE_HOTSPOTS.length];
    hotspotIdx++;
    probeEarth(latLonToEarth(hs.lat, hs.lon), hs.name);
});

toggleButton('#btn-sound', {
    on: false,
    labels: ['Sonify: Off', 'Sonify: On'],
    onChange(on) {
        sonifier.setEnabled(on);
        if (on && state.probeHits) playClimateChord(state.probeHits, state.probePt);
    },
});

toggleButton('#btn-autorotate', {
    on: false,
    labels: ['Auto-Rotate', 'Auto-Rotate: On'],
    onChange(on) { view.autoRotate = on; },
});

// AVX2 SIMD Extremes Engine + RangeIndex('year') Filter Pipeline
let filterSeq = 0;
let filterInFlight = false;
let currentMaskBits = null;

function collectFilterPredicates() {
    const preds = [];
    const yLo = Math.round(state.yearLo);
    const yHi = Math.round(state.yearHi);
    if (yLo > 1900) preds.push({ col: 'year', op: 'ge', val: yLo });
    if (yHi < 2025) preds.push({ col: 'year', op: 'le', val: yHi });
    if (state.anomMin > -11.99) {
        preds.push({ col: 'anom_c', op: Math.abs(state.anomMin - 4.0) < 0.01 ? 'gt' : 'ge', val: state.anomMin });
    }
    if (state.anomMax < 11.99) {
        preds.push({ col: 'anom_c', op: Math.abs(state.anomMax + 4.0) < 0.01 ? 'lt' : 'le', val: state.anomMax });
    }
    if (state.latMin > -89.99) {
        preds.push({ col: 'lat', op: Math.abs(state.latMin - 60.0) < 0.01 ? 'gt' : 'ge', val: state.latMin });
    }
    if (state.latMax < 89.99) {
        preds.push({ col: 'lat', op: 'le', val: state.latMax });
    }
    return preds;
}

async function applyFilters() {
    const seq = ++filterSeq;
    const preds = collectFilterPredicates();
    const yLo = Math.round(state.yearLo);
    const yHi = Math.round(state.yearHi);

    if (preds.length === 0) {
        currentMaskBits = null;
        engine.uploadMask(null);
        state.lastFilterMatched = totalRows;
        state.filteredDecadeGroups = null;
        $('#filter-matched').textContent = `all (${fmtInt(totalRows)})`;
        $('#st-mask').textContent = 'all';
        state.latProfile = buildLatProfile(snap, null, yLo, yHi);
        redrawAllCharts();
        state.filterBusy = false;
        return;
    }

    filterInFlight = true;
    state.filterBusy = true;
    try {
        const res = await rpc.request({ type: 'filterMask', predicates: preds, ordCol: 'ord' });
        if (seq !== filterSeq) return;
        const bits = new Uint32Array(res.bitsBuffer);
        currentMaskBits = bits;
        engine.uploadMask(bits);
        state.workerStats = res.stats;
        state.lastFilterMatched = res.matched;
        proof.setQueryStats(res.ms, res.total, res.stats);
        $('#filter-matched').textContent = `${fmtInt(res.matched)} / ${fmtInt(res.total)}`;
        $('#st-mask').textContent = fmtInt(res.matched);
        state.latProfile = buildLatProfile(snap, bits, yLo, yHi);

        const sum = await rpc.request({
            type: 'querySummary',
            filters: preds,
            groupBy: 'decade',
            aggCol: 'anom_c',
            avgCols: ['anom_c'],
            minCols: ['anom_c'],
            maxCols: ['anom_c'],
        });
        if (seq !== filterSeq) return;
        if (sum && sum.ok) {
            state.filteredDecadeGroups = sum.groups || [];
            if (sum.agg) state.globalAgg = sum.agg;
        }
        redrawAllCharts();
    } finally {
        if (seq === filterSeq) {
            filterInFlight = false;
            state.filterBusy = false;
        }
    }
}

const yearLoCtrl = bindControl('#year-lo', {
    out: '#year-lo-val',
    fmt: (v) => String(Math.round(v)),
    reset: 1900,
    onChange(v) {
        state.yearLo = Math.min(v, state.yearHi);
        if (state.yearLo !== v) yearLoCtrl.value = state.yearLo;
        syncEraChipActive();
        updateHudTexts();
        applyFilters();
    },
});
const yearHiCtrl = bindControl('#year-hi', {
    out: '#year-hi-val',
    fmt: (v) => String(Math.round(v)),
    reset: 2025,
    onChange(v) {
        state.yearHi = Math.max(v, state.yearLo);
        if (state.yearHi !== v) yearHiCtrl.value = state.yearHi;
        syncEraChipActive();
        updateHudTexts();
        applyFilters();
    },
});

function syncEraChipActive() {
    const key = `${Math.round(state.yearLo)},${Math.round(state.yearHi)}`;
    for (const chip of $$('#era-chips [data-era]')) {
        chip.classList.toggle('active', chip.dataset.era === key);
    }
}

for (const chip of $$('#era-chips [data-era]')) {
    chip.addEventListener('click', () => {
        const [lo, hi] = chip.dataset.era.split(',').map((x) => parseInt(x, 10));
        state.centuryPlaying = false;
        centuryPlayBtn.on = false;
        state.yearLo = lo;
        state.yearHi = hi;
        yearLoCtrl.value = lo;
        yearHiCtrl.value = hi;
        syncEraChipActive();
        applyFilters();
    });
}

const centuryPlayBtn = toggleButton('#btn-century-play', {
    on: false,
    labels: ['Play Century', 'Pause Century'],
    onChange(on) {
        state.centuryPlaying = on;
        if (on && state.yearLo === 1900 && state.yearHi === 2025) {
            state.centuryCursor = 1900;
            state.yearLo = 1900;
            state.yearHi = 1915;
            yearLoCtrl.value = 1900;
            yearHiCtrl.value = 1915;
            syncEraChipActive();
            applyFilters();
        } else if (!on) {
            applyFilters();
        }
    },
});

$('#btn-century-reset').addEventListener('click', () => {
    state.centuryPlaying = false;
    centuryPlayBtn.on = false;
    state.yearLo = 1900;
    state.yearHi = 2025;
    yearLoCtrl.value = 1900;
    yearHiCtrl.value = 2025;
    syncEraChipActive();
    applyFilters();
});

const fmtTemp = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
const anomMinCtrl = bindControl('#anom-min', {
    out: '#anom-min-val',
    fmt: fmtTemp,
    reset: -12.0,
    onChange(v) { state.anomMin = v; syncExtremeChipActive(''); applyFilters(); },
});
const anomMaxCtrl = bindControl('#anom-max', {
    out: '#anom-max-val',
    fmt: fmtTemp,
    reset: 12.0,
    onChange(v) { state.anomMax = v; syncExtremeChipActive(''); applyFilters(); },
});
const latMinCtrl = bindControl('#lat-min', {
    out: '#lat-min-val',
    fmt: fmtTemp,
    reset: -90.0,
    onChange(v) { state.latMin = v; syncExtremeChipActive(''); applyFilters(); },
});
const latMaxCtrl = bindControl('#lat-max', {
    out: '#lat-max-val',
    fmt: fmtTemp,
    reset: 90.0,
    onChange(v) { state.latMax = v; syncExtremeChipActive(''); applyFilters(); },
});

function syncExtremeChipActive(name) {
    for (const c of $$('#extreme-chips [data-preset]')) {
        c.classList.toggle('active', c.dataset.preset === name);
    }
}

const EXTREME_PRESETS = {
    all: { aMin: -12.0, aMax: 12.0, lMin: -90.0, lMax: 90.0 },
    heat: { aMin: 4.0, aMax: 12.0, lMin: -90.0, lMax: 90.0 },
    cold: { aMin: -12.0, aMax: -4.0, lMin: -90.0, lMax: 90.0 },
    arctic: { aMin: -12.0, aMax: 12.0, lMin: 60.0, lMax: 90.0 },
    tropics: { aMin: -12.0, aMax: 12.0, lMin: -23.5, lMax: 23.5 },
};

for (const chip of $$('#extreme-chips [data-preset]')) {
    chip.addEventListener('click', () => {
        const key = chip.dataset.preset;
        const p = EXTREME_PRESETS[key] || EXTREME_PRESETS.all;
        state.anomMin = p.aMin; anomMinCtrl.value = p.aMin;
        state.anomMax = p.aMax; anomMaxCtrl.value = p.aMax;
        state.latMin = p.lMin; latMinCtrl.value = p.lMin;
        state.latMax = p.lMax; latMaxCtrl.value = p.lMax;
        syncExtremeChipActive(key);
        applyFilters();
    });
}

$('#btn-filter-reset').addEventListener('click', () => {
    const p = EXTREME_PRESETS.all;
    state.anomMin = p.aMin; anomMinCtrl.value = p.aMin;
    state.anomMax = p.aMax; anomMaxCtrl.value = p.aMax;
    state.latMin = p.lMin; latMinCtrl.value = p.lMin;
    state.latMax = p.lMax; latMaxCtrl.value = p.lMax;
    syncExtremeChipActive('all');
    applyFilters();
});

// Worker boot + initial parallel groupBy('decade') summary + initial probe
(async () => {
    await rpc.ready;
    await rpc.request({ type: 'attachSnapshot', snap });
    const summary = await rpc.request({
        type: 'querySummary',
        groupBy: 'decade',
        aggCol: 'anom_c',
        avgCols: ['anom_c', 'tmin_c', 'tmax_c'],
        minCols: ['anom_c'],
        maxCols: ['anom_c'],
    });
    state.summaryReady = true;
    state.workerStats = summary.execStats;
    state.baseDecadeGroups = summary.groups || [];
    state.globalAgg = summary.agg || null;
    proof.setQueryStats(summary.ms, summary.rowCount, summary.execStats);
    renderDecadeBreakdown(state.baseDecadeGroups);
    $('#filter-matched').textContent = `all (${fmtInt(totalRows)})`;
    probeEarth(latLonToEarth(CLIMATE_HOTSPOTS[0].lat, CLIMATE_HOTSPOTS[0].lon), CLIMATE_HOTSPOTS[0].name);
    redrawAllCharts();
    app.status.ok(`${fmtInt(totalRows)} obs · ${engine.gpuReady ? 'Vulkan HDR splat' : '2D fallback'} · ${dataset.isReal ? 'mmap' : 'synthetic'}`);
})();

redrawAllCharts();

const splatArgs = (cols, cam, meta) => [
    packedStores.s0, packedStores.s1,
    meta.maskBuffer,
    meta.count, meta.stride, meta.w, meta.h,
    cam.camR, cam.camU, cam.camF, cam.camT,
    meta.fromManifold, meta.toManifold, meta.morph,
    meta.hasMask, meta.radiusMode, state.yearLo, state.yearHi,
];

let lastScrubSyncYr = 1900;
let lastFpsStr = '';
let lastChartSizeKey = '';
window.addEventListener('resize', () => {
    lastChartSizeKey = '';
});

frameLoop((dt) => {
    if (state.centuryPlaying) {
        state.centuryCursor += dt * 11.0;
        if (state.centuryCursor > 2010) state.centuryCursor = 1900;
        const lo = Math.round(state.centuryCursor);
        const hi = Math.min(2025, lo + 15);
        state.yearLo = lo;
        state.yearHi = hi;
        yearLoCtrl.value = lo;
        yearHiCtrl.value = hi;
        syncEraChipActive();
        updateHudTexts();
        if (!filterInFlight && Math.abs(lo - lastScrubSyncYr) >= 3) {
            lastScrubSyncYr = lo;
            applyFilters();
        }
    }

    view.step(dt);
    engine.render(view, splatArgs);
    drawOverlay(overlayCanvas, view, state);

    const chartKey = `${warmingCanvas.clientWidth}x${warmingCanvas.clientHeight}|${latCanvas.clientWidth}x${latCanvas.clientHeight}|${window.devicePixelRatio || 1}`;
    if (chartKey !== lastChartSizeKey) {
        lastChartSizeKey = chartKey;
        redrawAllCharts();
    }

    const curFps = fps.tick();
    const fpsStr = curFps > 0 ? String(Math.round(curFps)) : '—';
    if (fpsStr !== lastFpsStr) {
        lastFpsStr = fpsStr;
        $('#st-fps').textContent = fpsStr;
        $('#hud-fps').textContent = fpsStr;
    }
});

globalThis.__thermoApp = {
    state,
    view,
    engine,
    dataset,
    snap,
    applyFilters,
    setManifold,
    probeEarth,
    sonifier,
    rpc,
    getMaskBits: () => currentMaskBits,
};
