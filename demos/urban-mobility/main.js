// Urban Mobility Twin — Closed-Loop Living Table & Vulkan HDR GPU Simulation

import { boot, $, h, statusLine, fpsMeter, frameLoop, segmented, foldPanels } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { fmtInt, fmtMs, ensureDir } from "/lib/sci-atlas/data-paths.js";
import { OrbitView } from "/lib/sci-atlas/orbit-view.js";
import { SpatialSonifier } from "/lib/sci-atlas/sonifier.js";
import { HdrSplatEngine } from "/lib/sci-atlas/splat-engine.js";
import { createLivingVitalsPanel } from "/lib/living-table/living-hud.js";
import {
    createUrbanMobilityData,
    makeRushHourBatch,
    ANALYTICS_QUERIES,
    BRUSH_PRESETS,
} from "./data.js";
import {
    MANIFOLDS,
    MOB_PACK_SHADER,
    MOB_HOME_PACK_SHADER,
    MOB_STEP_SHADER,
    MOB_EXTRACT_CHUNK_SHADER,
    MOB_SPLAT_SHADER,
    MOB_HUB_SPLAT_SHADER,
} from "./manifolds.js";
import { drawModesChart, drawDistrictsChart, drawCityOverlay, renderTopDelayedTable } from "./charts.js";

const fs = require('fs');

boot();
foldPanels(document.querySelector('.k-side'));

const status = statusLine('#status');
status.busy('creating 4 linked bro.table tables…');

// 1. Populate Legend
const legendEl = $('#mobility-legend');
const LEGEND_ITEMS = [
    ['#36e896', 'Flow > 42 km/h'],
    ['#ffbe3b', 'Slow 18–42 km/h'],
    ['#ff4842', 'Gridlock < 18 km/h'],
    ['#38c8ff', 'eVTOL Skyway (y > 0.2)'],
    ['#42f5ff', '24 Transit Hubs'],
];
for (const [col, label] of LEGEND_ITEMS) {
    legendEl.appendChild(
        h('span.sci-legend-swatch', null, h('i.sci-legend-dot', { style: { background: col } }), label)
    );
}

// 2. Build Relational Tables: vehicles (131,072), roads (256), orders (32,768), hubs (24)
const ds = createUrbanMobilityData();
let vehicles = ds.vehicles;
const { roads, orders, hubs, roadMeta, hubRows, loadMs } = ds;
let nextVid = ds.nextVid;

const q = bro.table;
function createSlaReactive(tbl) {
    return tbl.query()
        .where(q.or(q.gt('delay_min', 22.0), q.lt('battery', 0.15)))
        .reactive();
}
let slaRq = createSlaReactive(vehicles);

// 3. GPU Engine + Closed-Loop Compute Kernels
const gpuCanvas = $('#gpu-canvas');
const overlayCanvas = $('#overlay-canvas');
const splat = new HdrSplatEngine(gpuCanvas, MOB_SPLAT_SHADER, {
    shaderFile: 'urban_mobility_splat.bk',
    exposure: 0.62,
    bloomAmt: 0.20,
    radiusMode: 0,
});
$('#st-gpu').textContent = splat.gpuReady ? 'Vulkan HDR' : '2D Fallback';

let kPackMob = null;
let kPackHome = null;
let kStepMob = null;
let kExtractChunk = null;
let kSplatHubs = null;

let s0Buf = null;
let s1Buf = null;
let home4Buf = null;
let hubPosBuf = null;
let chunkSpeedKb = null;
let chunkDelayKb = null;
let chunkBattKb = null;
let gpuRowCount = 0;

if (splat.gpuReady) {
    kPackMob = bro.kernel.compile(MOB_PACK_SHADER, { file: 'mob_pack.bk' }).kernel('k_pack_mob');
    kPackHome = bro.kernel.compile(MOB_HOME_PACK_SHADER, { file: 'mob_home.bk' }).kernel('k_pack_home');
    kStepMob = bro.kernel.compile(MOB_STEP_SHADER, { file: 'mob_step.bk' }).kernel('k_step_mob');
    kExtractChunk = bro.kernel.compile(MOB_EXTRACT_CHUNK_SHADER, { file: 'mob_extract.bk' }).kernel('k_extract_chunk_col');
    kSplatHubs = bro.kernel.compile(MOB_HUB_SPLAT_SHADER, { file: 'mob_hubs.bk' }).kernel('k_splat_hubs');

    const hubData = new Float32Array(hubRows.length * 4);
    for (let i = 0; i < hubRows.length; i++) {
        hubData[i * 4 + 0] = hubRows[i].x;
        hubData[i * 4 + 1] = hubRows[i].y;
        hubData[i * 4 + 2] = hubRows[i].z;
        hubData[i * 4 + 3] = hubRows[i].chargers;
    }
    hubPosBuf = bro.kernel.createBuffer(hubData, { residency: 'gpu' });
    chunkSpeedKb = bro.kernel.createBuffer(4096 * 4, { residency: 'gpu' });
    chunkDelayKb = bro.kernel.createBuffer(4096 * 4, { residency: 'gpu' });
    chunkBattKb = bro.kernel.createBuffer(4096 * 4, { residency: 'gpu' });
}

function destroySimBuffers() {
    for (const buf of [s0Buf, s1Buf, home4Buf]) {
        if (buf) { try { buf.destroy(); } catch (_) {} }
    }
    s0Buf = null;
    s1Buf = null;
    home4Buf = null;
}

function rebuildGpuFromTable() {
    const N = vehicles.rowCount;
    gpuRowCount = N;
    splat.rowCount = N;
    if (!splat.gpuReady || N <= 0) {
        destroySimBuffers();
        return;
    }
    destroySimBuffers();

    s0Buf = bro.kernel.createBuffer(N * 16, { residency: 'gpu' });
    s1Buf = bro.kernel.createBuffer(N * 16, { residency: 'gpu' });
    home4Buf = bro.kernel.createBuffer(N * 16, { residency: 'gpu' });

    const bx = vehicles.toKernelBuffer('x', { residency: 'gpu' });
    const by = vehicles.toKernelBuffer('y', { residency: 'gpu' });
    const bz = vehicles.toKernelBuffer('z', { residency: 'gpu' });
    const bSpd = vehicles.toKernelBuffer('speed', { residency: 'gpu' });
    const bVx = vehicles.toKernelBuffer('vx', { residency: 'gpu' });
    const bVz = vehicles.toKernelBuffer('vz', { residency: 'gpu' });
    const bDly = vehicles.toKernelBuffer('delay_min', { residency: 'gpu' });
    const bBat = vehicles.toKernelBuffer('battery', { residency: 'gpu' });
    const bMode = vehicles.toKernelBuffer('mode', { residency: 'gpu' });
    const bRid = vehicles.toKernelBuffer('road_id', { residency: 'gpu' });

    const stride = Math.min(N, 1048576);
    kPackMob.dispatch(
        stride,
        bx, by, bz, bSpd, bVx, bVz, bDly, bBat, bMode,
        s0Buf, s1Buf, N, stride
    );
    kPackHome.dispatch(stride, bx, bz, bRid, home4Buf, N, stride);

    for (const kb of [bx, by, bz, bSpd, bVx, bVz, bDly, bBat, bMode, bRid]) {
        try { kb.destroy(); } catch (_) {}
    }

    if (!splat.maskBuffer) {
        splat.maskBuffer = bro.kernel.createBuffer(new Uint32Array([0xFFFFFFFF]), { residency: 'gpu' });
        splat.hasMask = 0;
    }
}
rebuildGpuFromTable();

// 4. Camera, Sonifier, Vitals Panel & Shared Worker
const view = new OrbitView(gpuCanvas, {
    yaw: 0.56,
    pitch: 0.52,
    dist: 2.55,
    minDist: 0.65,
    maxDist: 10.5,
    fovScale: 0.92,
    onProbe(pt) {
        applyCanvasBrush(pt);
    },
});

const sonifier = new SpatialSonifier({ cooldownMs: 110 });
const vitals = createLivingVitalsPanel($('#vitals-panel'));
const worker = workerClient('../../lib/living-table/living-worker.js', { type: 'module' });

const state = {
    activeBrush: 'probe',
    lastBrushPt: null,
    lastBrushKind: 'probe',
    writeCursor: 0,
    writebackTicks: 0,
    snapshotsShipped: 0,
    simTime: 0,
    lastReactive: { recomputedChunks: 0, reusedChunks: vehicles.chunkCount },
    lastWorkerPlan: null,
    lastCheckpoint: null,
    revenueRows: [],
    districtRows: [],
    topDelayedRows: [],
    delayBins: [0, 0, 0, 0],
    tensorOut: null,
    lastWorkerVersion: -1,
    workerBusy: false,
    chartsDirty: true,
    frameCounter: 0,
};

const ckptDir = ((globalThis.bro && bro.app && bro.app.dataDir) ? bro.app.dataDir : 'test-results').replace(/\\/g, '/');
const ckptPath = `${ckptDir}/living-ckpt-urban-mobility.brotable`;

// 5. Manifold Switcher & Guide
const descEl = $('#manifold-desc');
let manifoldBar = null;
const sideBtns = [];

function updateManifoldHud() {
    const m = MANIFOLDS[view.toManifold] || MANIFOLDS[0];
    descEl.textContent = m.desc;
    $('#hud-manifold').innerHTML =
        `<b>${m.name}</b> · 4 linked tables (vehicles / roads / orders / hubs)` +
        `<div class="sci-guide">${m.desc}</div>`;
}

export function setManifold(idx) {
    const id = Math.max(0, Math.min(MANIFOLDS.length - 1, idx | 0));
    view.setManifold(id);
    if (manifoldBar) manifoldBar.value = id;
    for (let i = 0; i < sideBtns.length; i++) {
        sideBtns[i].classList.toggle('active', i === id);
    }
    updateManifoldHud();
}

manifoldBar = segmented('#manifold-bar', MANIFOLDS.map((m) => [m.id, m.short]), {
    value: 0,
    onChange: (v) => setManifold(Number(v)),
});
const sideList = $('#manifold-list');
for (const m of MANIFOLDS) {
    const b = h('button.sci-manifold-btn', {
        dataset: { manifold: String(m.id) },
        onclick: () => setManifold(m.id),
    }, m.short);
    sideBtns.push(b);
    sideList.appendChild(b);
}
setManifold(0);

// 6. ReactiveQuery, Vitals & Top-Delayed Helpers
function refreshSlaReactive() {
    if (slaRq.dirty()) {
        const rr = slaRq.refresh();
        if (rr.changed) {
            state.lastReactive = {
                recomputedChunks: rr.recomputedChunks | 0,
                reusedChunks: rr.reusedChunks | 0,
            };
        }
    }
}

function updateDelayHistogram() {
    const bins = [0, 0, 0, 0];
    if (vehicles.stats().tombstoneCount > 0) {
        bins[0] = vehicles.query().where(q.lt('delay_min', 5.0)).count();
        bins[1] = vehicles.query().where(q.and(q.ge('delay_min', 5.0), q.lt('delay_min', 12.0))).count();
        bins[2] = vehicles.query().where(q.and(q.ge('delay_min', 12.0), q.lt('delay_min', 22.0))).count();
        bins[3] = vehicles.query().where(q.ge('delay_min', 22.0)).count();
    } else {
        const snap = vehicles.snapshot();
        for (let ci = 0; ci < snap.chunkCount; ci++) {
            const rc = snap.chunkRowCount(ci);
            const dv = snap.chunkColumnView(ci, 'delay_min');
            for (let r = 0; r < rc; r++) {
                const d = dv[r];
                if (d < 5.0) bins[0]++;
                else if (d < 12.0) bins[1]++;
                else if (d < 22.0) bins[2]++;
                else bins[3]++;
            }
        }
    }
    state.delayBins = bins;
    state.chartsDirty = true;
}

function syncVitalsUI() {
    const st = vehicles.stats();
    const slaCnt = slaRq.table ? slaRq.table.rowCount : 0;
    const wbLabel = st.tombstoneCount > 0
        ? `paused (${st.tombstoneCount} tombstones)`
        : `2 chunks/step (#${state.writeCursor}/${vehicles.chunkCount})`;

    vitals.update({
        tableStats: st,
        version: vehicles.version,
        structureVersion: vehicles.structureVersion,
        reactive: state.lastReactive,
        gpuWriteback: wbLabel,
        workerPlan: state.lastWorkerPlan,
        snapshotsShipped: state.snapshotsShipped,
        checkpoint: state.lastCheckpoint,
    });

    const rc = state.lastReactive;
    const totC = Math.max(1, rc.recomputedChunks + rc.reusedChunks);
    $('#fleet-badge').textContent = `${fmtInt(st.rowCount)} VEHICLES`;
    $('#hud-vcount').textContent = fmtInt(st.rowCount);
    $('#hud-sla').textContent = fmtInt(slaCnt);
    $('#st-vehicles').textContent = fmtInt(st.rowCount);
    $('#st-sla').textContent = fmtInt(slaCnt);
    $('#st-reactive').textContent = `${rc.reusedChunks}/${totC} reused`;
    $('#st-writeback').textContent = st.tombstoneCount > 0 ? 'paused' : `2/${vehicles.chunkCount} ch`;
    if (state.tensorOut && state.tensorOut.ok) {
        $('#hud-tensor').textContent = `${state.tensorOut.meanScore.toFixed(2)} (${state.tensorOut.backend})`;
    }
}

// 7. Closed-Loop Rotating 2-Chunk GPU -> Table Writeback
export function stepWritebackChunks(numChunks = 2) {
    if (!splat.gpuReady || gpuRowCount <= 0) return false;
    const st = vehicles.stats();
    if (st.tombstoneCount > 0 || vehicles.rowCount !== gpuRowCount) return false;
    const nc = vehicles.chunkCount;
    if (nc <= 0) return false;

    const kCount = Math.min(numChunks, nc);
    for (let k = 0; k < kCount; k++) {
        const ci = (state.writeCursor + k) % nc;
        const offset = ci * 4096;
        const rc = vehicles.chunkRowCount(ci);
        if (rc <= 0 || offset + rc > gpuRowCount) continue;
        const stride = Math.min(rc, 65536);

        kExtractChunk.dispatch(stride, s0Buf, s1Buf, chunkSpeedKb, offset, rc, stride, 0);
        kExtractChunk.dispatch(stride, s0Buf, s1Buf, chunkDelayKb, offset, rc, stride, 1);
        kExtractChunk.dispatch(stride, s0Buf, s1Buf, chunkBattKb, offset, rc, stride, 2);

        vehicles.readFromKernelBuffer(ci, 'speed', chunkSpeedKb);
        vehicles.readFromKernelBuffer(ci, 'delay_min', chunkDelayKb);
        vehicles.readFromKernelBuffer(ci, 'battery', chunkBattKb);
    }
    state.writeCursor = (state.writeCursor + kCount) % nc;
    state.writebackTicks++;
    refreshSlaReactive();
    return true;
}

// 8. Interactive Spatial Brushes & Fleet Lifecycle
const BRUSH_DESCRIPTIONS = {
    probe: 'Click city to inspect nearest vehicle via 3D SpatialIndex + joined road/order.',
    incident: 'Click city to trigger Traffic Incident (r=0.45): speed * 0.25, delay + 18m.',
    corridor: 'Click city to fire Green-Wave Override (r=0.45): speed = 68 km/h, delay = 0m.',
    cull: 'Click city to remove AABB district zone via whereInAABB().remove() (tombstones).',
};

function setBrush(kind) {
    state.activeBrush = kind;
    for (const btn of document.querySelectorAll('#brush-grid .living-brush-btn')) {
        btn.classList.toggle('active', btn.dataset.brush === kind);
    }
    $('#brush-desc').textContent = BRUSH_DESCRIPTIONS[kind] || '';
}

function playBrushAudio(kind, pt) {
    if (!sonifier.enabled) return;
    const p3 = [pt[0] * 3.0, pt[1] + 0.3, pt[2] * 3.0];
    if (kind === 'incident') {
        sonifier.playChord([
            { waveform: 'sawtooth', freq: 146.8, gain: 0.16, pos: p3, dur: 0.45 },
            { waveform: 'triangle', freq: 155.6, gain: 0.14, pos: p3, dur: 0.45 },
        ]);
    } else if (kind === 'corridor') {
        sonifier.playChord([
            { waveform: 'sine', freq: 329.6, gain: 0.14, pos: p3, dur: 0.38 },
            { waveform: 'sine', freq: 440.0, gain: 0.14, pos: p3, dur: 0.38 },
            { waveform: 'sine', freq: 659.3, gain: 0.12, pos: p3, dur: 0.42 },
        ]);
    } else {
        sonifier.playChord([
            { waveform: 'sine', freq: 293.7, gain: 0.12, pos: p3, dur: 0.30 },
            { waveform: 'triangle', freq: 440.0, gain: 0.10, pos: p3, dur: 0.30 },
        ]);
    }
}

export function probeAt(pt) {
    const t0 = performance.now();
    let near = vehicles.nearest('city3d', pt, 6, 0.75);
    if (near.rowCount === 0) near = vehicles.nearest('city3d', pt, 6);
    const ms = performance.now() - t0;
    state.lastBrushPt = pt.slice(0, 3);
    state.lastBrushKind = 'probe';

    if (near.rowCount > 0) {
        const v = near.row(0);
        const roadRow = roads.query().where(q.eq('road_id', v.road_id)).toArray()[0];
        const ordRow = v.order_id != null
            ? orders.query().where(q.eq('order_id', v.order_id)).toArray()[0]
            : null;
        $('#probe-box').textContent =
            `vid #${v.vid} · ${v.plate} (${v.mode}) · d=${v._distance.toFixed(3)}\n` +
            `road #${v.road_id}: ${roadRow ? `${roadRow.district} ${roadRow.lane_class} (lim ${roadRow.speed_limit})` : '—'}\n` +
            `order: ${ordRow ? `#${ordRow.order_id} ${ordRow.tier} ($${ordRow.fare_usd.toFixed(2)})` : 'NULL (idle cruiser)'}\n` +
            `speed: ${v.speed.toFixed(1)} km/h · delay: ${v.delay_min.toFixed(1)}m · batt: ${Math.round(v.battery * 100)}%`;
        playBrushAudio('probe', pt);
        status.ok(`probed vid #${v.vid} via 3D kNN (${fmtMs(ms)})`);
    }
}

export function triggerIncidentAt(pt = BRUSH_PRESETS.incident) {
    const t0 = performance.now();
    const res = vehicles.query()
        .whereInRadius('city3d', pt, 0.45)
        .update({
            speed: q.col('speed').mul(0.25),
            delay_min: q.col('delay_min').add(18.0),
        });
    const ms = performance.now() - t0;
    state.lastBrushPt = pt.slice(0, 3);
    state.lastBrushKind = 'incident';
    refreshSlaReactive();
    rebuildGpuFromTable();
    updateDelayHistogram();
    syncVitalsUI();
    playBrushAudio('incident', pt);
    status.warn(`Incident brush hit ${fmtInt(res.affectedRows)} vehicles (${fmtMs(ms)}, spatialIdx=${res.usedSpatialIndex})`);
    return res;
}

export function triggerCorridorAt(pt = BRUSH_PRESETS.corridor) {
    const t0 = performance.now();
    const res = vehicles.query()
        .whereInRadius('city3d', pt, 0.45)
        .update({
            speed: q.lit(68.0),
            delay_min: q.lit(0.0),
        });
    const ms = performance.now() - t0;
    state.lastBrushPt = pt.slice(0, 3);
    state.lastBrushKind = 'corridor';
    refreshSlaReactive();
    rebuildGpuFromTable();
    updateDelayHistogram();
    syncVitalsUI();
    playBrushAudio('corridor', pt);
    status.ok(`Green-Wave cleared ${fmtInt(res.affectedRows)} vehicles (${fmtMs(ms)})`);
    return res;
}

export function triggerCullZone(minP = BRUSH_PRESETS.cullMin, maxP = BRUSH_PRESETS.cullMax) {
    const t0 = performance.now();
    const res = vehicles.query()
        .whereInAABB('city3d', minP, maxP)
        .remove();
    const ms = performance.now() - t0;
    state.lastBrushPt = [
        (minP[0] + maxP[0]) * 0.5,
        (minP[1] + maxP[1]) * 0.5,
        (minP[2] + maxP[2]) * 0.5,
    ];
    state.lastBrushKind = 'cull';
    refreshSlaReactive();
    rebuildGpuFromTable();
    updateDelayHistogram();
    syncVitalsUI();
    status.warn(`Cull AABB removed ${fmtInt(res.affectedRows)} rows (${fmtMs(ms)}, tombstones active)`);
    return res;
}

export function spawnRushHour(count = 512) {
    const batch = makeRushHourBatch(nextVid, count, roadMeta, hubRows, 7700 + state.frameCounter);
    nextVid += count;
    vehicles.insertMany(batch);
    refreshSlaReactive();
    rebuildGpuFromTable();
    updateDelayHistogram();
    syncVitalsUI();
    status.ok(`spawned +${count} rush-hour vehicles (total ${fmtInt(vehicles.rowCount)})`);
}

export function compactFleet() {
    const t0 = performance.now();
    vehicles.compact();
    const ms = performance.now() - t0;
    refreshSlaReactive();
    rebuildGpuFromTable();
    updateDelayHistogram();
    syncVitalsUI();
    status.ok(`compacted table in ${fmtMs(ms)} (0% tombstones, indexes rebuilt)`);
}

function applyCanvasBrush(pt) {
    if (state.activeBrush === 'incident') triggerIncidentAt(pt);
    else if (state.activeBrush === 'corridor') triggerCorridorAt(pt);
    else if (state.activeBrush === 'cull') {
        const r = 0.34;
        triggerCullZone([pt[0] - r, -0.25, pt[2] - r], [pt[0] + r, 0.90, pt[2] + r]);
    } else probeAt(pt);
}

// 9. Worker Relational Analytics & .brotable v3 Checkpoints
let pendingWorkerPromise = null;

export async function runWorkerAnalytics(forceShip = false) {
    if (state.workerBusy) {
        if (!forceShip) return null;
        if (pendingWorkerPromise) {
            try { await pendingWorkerPromise; } catch (_) {}
        }
    }
    state.workerBusy = true;
    const job = (async () => {
        try {
            await worker.ready;
            if (forceShip || vehicles.version !== state.lastWorkerVersion) {
                const payload = forceShip
                    ? {
                        vehicles: vehicles.snapshot(),
                        roads: roads.snapshot(),
                        orders: orders.snapshot(),
                        hubs: hubs.snapshot(),
                    }
                    : { vehicles: vehicles.snapshot() };
                await worker.request({ type: 'attachTables', tables: payload });
                state.snapshotsShipped++;
                state.lastWorkerVersion = vehicles.version;
            }

            const batch = await worker.request({
                type: 'runBatch',
                queries: ANALYTICS_QUERIES,
                tensor: {
                    table: 'vehicles',
                    cols: ['speed', 'delay_min', 'battery'],
                    weights: [-0.012, 0.045, -0.35],
                    bias: 0.72,
                    maxRows: 65536,
                },
            });

            const res = batch.results || {};
            if (res.revenueWithIdle && res.revenueWithIdle.ok) {
                state.revenueRows = res.revenueWithIdle.rows;
            }
            if (res.congestionByDistrict && res.congestionByDistrict.ok) {
                state.districtRows = res.congestionByDistrict.rows;
                state.lastWorkerPlan = {
                    strategy: res.congestionByDistrict.stats.strategy || 'join',
                    simdWidth: res.congestionByDistrict.stats.simdWidth || 0,
                    ms: res.congestionByDistrict.ms,
                };
            }
            if (res.topDelayed && res.topDelayed.ok) {
                state.topDelayedRows = res.topDelayed.rows;
                renderTopDelayedTable($('#top-delayed-wrap'), state.topDelayedRows);
            }
            if (batch.tensor) {
                state.tensorOut = batch.tensor;
            }
            state.chartsDirty = true;
            const revMs = res.revenueWithIdle ? res.revenueWithIdle.ms : 0;
            const dMs = res.congestionByDistrict ? res.congestionByDistrict.ms : 0;
            $('#st-worker').textContent = fmtMs(revMs + dMs);
            syncVitalsUI();
            return batch;
        } finally {
            state.workerBusy = false;
            pendingWorkerPromise = null;
        }
    })();
    pendingWorkerPromise = job;
    return job;
}

export function saveCheckpoint() {
    ensureDir(ckptDir);
    const t0 = performance.now();
    vehicles.save(ckptPath);
    const ms = performance.now() - t0;
    const sizeBytes = fs.existsSync(ckptPath) ? fs.statSync(ckptPath).size : 0;
    const kb = (sizeBytes / (1024 * 1024)).toFixed(1);
    $('#ckpt-info').innerHTML = '';
    $('#ckpt-info').appendChild(
        h('div.living-ckpt-item', null, h('span', null, 'saved v3'), h('b', null, `${kb} MB (${fmtMs(ms)})`))
    );
    status.ok(`saved v3 checkpoint (${kb} MB in ${fmtMs(ms)})`);
    return { path: ckptPath, bytes: sizeBytes, ms };
}

export async function auditCheckpoint() {
    if (!fs.existsSync(ckptPath)) saveCheckpoint();
    await worker.ready;
    await worker.request({ type: 'attachTables', tables: { vehicles: vehicles.snapshot() } });
    state.snapshotsShipped++;
    const cmp = await worker.request({
        type: 'compareMappedCheckpoint',
        path: ckptPath,
        tableName: 'vehicles',
        col: 'delay_min',
        verify: true,
    });
    if (cmp && cmp.ok) {
        state.lastCheckpoint = cmp;
        $('#ckpt-info').innerHTML = '';
        $('#ckpt-info').append(
            h('div.living-ckpt-item', null, h('span', null, 'mmap verified'), h('b', null, `${cmp.mappedIndexes} indexes (${fmtMs(cmp.ms)})`)),
            h('div.living-ckpt-item', null, h('span', null, 'avg delay delta'), h('b', null, `${cmp.deltaAvg.toFixed(2)} min`))
        );
        syncVitalsUI();
        status.ok(`v3 mmap audited ${cmp.mappedIndexes} zero-copy indexes in ${fmtMs(cmp.ms)}`);
    } else {
        status.error(cmp ? cmp.error : 'mmap audit failed');
    }
    return cmp;
}

export function loadCheckpoint() {
    if (!fs.existsSync(ckptPath)) {
        status.warn('save a v3 snapshot first');
        return false;
    }
    const t0 = performance.now();
    const loaded = q.load(ckptPath);
    if (slaRq) slaRq.dispose();
    vehicles = loaded;
    slaRq = createSlaReactive(vehicles);
    state.lastReactive = { recomputedChunks: vehicles.chunkCount, reusedChunks: 0 };
    rebuildGpuFromTable();
    updateDelayHistogram();
    syncVitalsUI();
    runWorkerAnalytics(true);
    status.ok(`loaded v3 checkpoint (${fmtInt(vehicles.rowCount)} rows in ${fmtMs(performance.now() - t0)})`);
    return true;
}

// 10. UI Event Wiring
for (const btn of document.querySelectorAll('#brush-grid .living-brush-btn')) {
    btn.addEventListener('click', () => setBrush(btn.dataset.brush));
}
$('#btn-trigger-incident').addEventListener('click', () => triggerIncidentAt(BRUSH_PRESETS.incident));
$('#btn-trigger-corridor').addEventListener('click', () => triggerCorridorAt(BRUSH_PRESETS.corridor));
$('#btn-trigger-cull').addEventListener('click', () => triggerCullZone(BRUSH_PRESETS.cullMin, BRUSH_PRESETS.cullMax));
$('#btn-spawn').addEventListener('click', () => spawnRushHour(512));
$('#btn-compact').addEventListener('click', () => compactFleet());

$('#btn-save-ckpt').addEventListener('click', () => saveCheckpoint());
$('#btn-audit-ckpt').addEventListener('click', () => auditCheckpoint());
$('#btn-load-ckpt').addEventListener('click', () => loadCheckpoint());

$('#btn-autorotate').addEventListener('click', (e) => {
    view.autoRotate = !view.autoRotate;
    e.currentTarget.classList.toggle('active', view.autoRotate);
});
$('#btn-sonify').addEventListener('click', (e) => {
    sonifier.setEnabled(!sonifier.enabled);
    e.currentTarget.textContent = sonifier.enabled ? 'Sonify: On' : 'Sonify: Off';
    e.currentTarget.classList.toggle('active', sonifier.enabled);
});

$('#opt-exposure').addEventListener('input', (e) => {
    splat.exposure = Number(e.target.value);
    $('#opt-exposure-val').textContent = splat.exposure.toFixed(2);
});
$('#opt-bloom').addEventListener('input', (e) => {
    splat.bloomAmt = Number(e.target.value);
    $('#opt-bloom-val').textContent = splat.bloomAmt.toFixed(2);
});
$('#opt-radius').addEventListener('change', (e) => {
    splat.radiusMode = Number(e.target.value) | 0;
});

// 11. Main Animation & Closed-Loop Frame Loop
const fps = fpsMeter();
const chartModesEl = $('#chart-modes');
const chartDistrictsEl = $('#chart-districts');
let lastChartSizeKey = '';
window.addEventListener('resize', () => {
    lastChartSizeKey = '';
});

function renderFrame() {
    const hubOverlayFn = (kSplatHubs && hubPosBuf)
        ? (accR, accG, accB, accC, cam, meta) => {
            kSplatHubs.dispatch(
                hubRows.length,
                accR, accG, accB, accC,
                hubPosBuf, hubRows.length, meta.w, meta.h,
                cam.camR, cam.camU, cam.camF, cam.camT,
                meta.fromManifold, meta.toManifold, meta.morph, state.simTime
            );
        }
        : null;

    splat.render(view, (cols, cam, meta) => [
        s0Buf, s1Buf, home4Buf, meta.maskBuffer,
        meta.count, meta.stride, meta.w, meta.h,
        cam.camR, cam.camU, cam.camF, cam.camT,
        meta.fromManifold, meta.toManifold, meta.morph,
        meta.hasMask, meta.radiusMode, state.simTime,
    ], hubOverlayFn);

    drawCityOverlay(overlayCanvas, view, hubRows, state);
}

let lastFpsStr = '';
frameLoop((dt) => {
    const stepDt = Math.min(0.05, Math.max(0.0005, dt));
    state.simTime += stepDt;
    state.frameCounter++;
    view.step(dt);

    if (splat.gpuReady && kStepMob && gpuRowCount > 0) {
        const stride = Math.min(gpuRowCount, 1048576);
        const rush = 1.0 + 0.15 * Math.sin(state.simTime * 0.25);
        kStepMob.dispatch(stride, s0Buf, s1Buf, home4Buf, gpuRowCount, stride, stepDt, state.simTime, rush);
    }

    if ((state.frameCounter % 3) === 0) {
        stepWritebackChunks(2);
    }
    if ((state.frameCounter % 15) === 0) {
        updateDelayHistogram();
        syncVitalsUI();
        runWorkerAnalytics(false);
    }

    renderFrame();

    const chartKey = `${chartModesEl.clientWidth}x${chartModesEl.clientHeight}|${chartDistrictsEl.clientWidth}x${chartDistrictsEl.clientHeight}|${window.devicePixelRatio || 1}`;
    if (chartKey !== lastChartSizeKey || state.chartsDirty) {
        lastChartSizeKey = chartKey;
        state.chartsDirty = false;
        drawModesChart(chartModesEl, state.revenueRows);
        drawDistrictsChart(chartDistrictsEl, state.districtRows, state.delayBins);
    }

    const curFps = fps.tick();
    const fpsStr = curFps > 0 ? String(Math.round(curFps)) : '—';
    if (fpsStr !== lastFpsStr) {
        lastFpsStr = fpsStr;
        $('#st-fps').textContent = fpsStr;
    }
});

// 12. Initial Worker Bootstrap
(async () => {
    updateDelayHistogram();
    syncVitalsUI();
    await runWorkerAnalytics(true);
    status.ok(`ready (${fmtInt(vehicles.rowCount)} vehicles, 4 tables in ${fmtMs(loadMs)})`);
})();

globalThis.__urbanMobility = {
    get vehicles() { return vehicles; },
    roads,
    orders,
    hubs,
    get slaRq() { return slaRq; },
    view,
    splat,
    sonifier,
    worker,
    state,
    ckptPath,
    setManifold,
    setBrush,
    probeAt,
    triggerIncidentAt,
    triggerCorridorAt,
    triggerCullZone,
    spawnRushHour,
    compactFleet,
    stepWritebackChunks,
    runWorkerAnalytics,
    saveCheckpoint,
    auditCheckpoint,
    loadCheckpoint,
    renderFrame,
};
