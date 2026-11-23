// Market Microstructure Observatory — Closed-Loop Living Table + Vulkan HDR + Worker

import { boot, $, h, statusLine, fpsMeter, frameLoop, segmented, foldPanels } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { fmtInt, fmtMs, ensureDir } from "/lib/sci-atlas/data-paths.js";
import { OrbitView } from "/lib/sci-atlas/orbit-view.js";
import { SpatialSonifier } from "/lib/sci-atlas/sonifier.js";
import { HdrSplatEngine } from "/lib/sci-atlas/splat-engine.js";
import { createLivingVitalsPanel } from "/lib/living-table/living-hud.js";
import {
    createMarketMicrostructureData,
    makeWhaleWallBatch,
    ANALYTICS_QUERIES,
    BRUSH_PRESETS,
    INSTRUMENT_DEFS,
} from "./data.js";
import {
    MANIFOLDS,
    MKT_COMPUTE_SHADER,
    MKT_SPLAT_SHADER,
    evalOrderManifold,
} from "./manifolds.js";
import {
    drawSectorDepthChart,
    drawDeskStressChart,
    drawMarketOverlay,
    renderTopWhalesTable,
    renderTopAgentsTable,
} from "./charts.js";

const fs = require('fs');

boot();
foldPanels(document.querySelector('.k-side'));

const status = statusLine('#status');
status.busy('building 4 linked bro.table tables (131,072 orders)…');

// 1. Color Legend
const legendEl = $('#market-legend');
const LEGEND_ITEMS = [
    ['#18e0d0', 'BID Wall'],
    ['#ff9824', 'ASK Wall'],
    ['#ffd84d', 'Whale / Iceberg'],
    ['#f034c8', 'Toxic Flow'],
    ['#845cff', 'OTC Dark Pool (null venue)'],
];
for (const [col, label] of LEGEND_ITEMS) {
    legendEl.appendChild(
        h('span.sci-legend-swatch', null, h('i.sci-legend-dot', { style: { background: col } }), label)
    );
}

// 2. Build 4 Linked Mutable bro.table Tables
const ds = createMarketMicrostructureData();
let orders = ds.orders;
const { agents, instruments, venues, agentLevs, loadMs } = ds;
let nextOrderId = ds.nextOrderId;

const q = bro.table;
function createMarginReactive(tbl) {
    return tbl.query()
        .where(q.or(
            q.gt('dist_mid', 44.0),
            q.ne(q.bitAnd('flags', 3), 0)
        ))
        .reactive();
}
let marginRq = createMarginReactive(orders);

// 3. Vulkan HDR Splat Engine & Closed-Loop Compute Kernels
const gpuCanvas = $('#gpu-canvas');
const overlayCanvas = $('#overlay-canvas');
const splat = new HdrSplatEngine(gpuCanvas, MKT_SPLAT_SHADER, {
    shaderFile: 'market_microstructure_splat.bk',
    exposure: 0.74,
    bloomAmt: 0.20,
    radiusMode: 0,
});
$('#st-gpu').textContent = splat.gpuReady ? 'Vulkan HDR' : '2D Fallback';

let kPackInst = null;
let kPackAgents = null;
let kPackOrdersPos = null;
let kPackOrdersMeta = null;
let kStepOrders = null;
let kExtractChunk = null;

let instMetaBuf = null;
let agentMetaBuf = null;
let s0Buf = null;
let s1Buf = null;
let rest4Buf = null;
let linkIdxBuf = null;

let chunkPriceKb = null;
let chunkNotionalKb = null;
let chunkDistKb = null;
let chunkFillKb = null;
let gpuRowCount = 0;

if (splat.gpuReady) {
    const mod = bro.kernel.compile(MKT_COMPUTE_SHADER, { file: 'mkt_compute.bk' });
    kPackInst = mod.kernel('k_pack_inst');
    kPackAgents = mod.kernel('k_pack_agents');
    kPackOrdersPos = mod.kernel('k_pack_orders_pos');
    kPackOrdersMeta = mod.kernel('k_pack_orders_meta');
    kStepOrders = mod.kernel('k_step_orders');
    kExtractChunk = mod.kernel('k_extract_chunk_col');

    instMetaBuf = bro.kernel.createBuffer(instruments.rowCount * 16, { residency: 'gpu' });
    agentMetaBuf = bro.kernel.createBuffer(agents.rowCount * 16, { residency: 'gpu' });

    const bMid = instruments.toKernelBuffer('mid_price', { residency: 'gpu' });
    const bVol = instruments.toKernelBuffer('volatility', { residency: 'gpu' });
    const bSpr = instruments.toKernelBuffer('spread_bps', { residency: 'gpu' });
    const bSec = instruments.toKernelBuffer('sector', { residency: 'gpu' });
    kPackInst.dispatch(instruments.rowCount, bMid, bVol, bSpr, bSec, instMetaBuf, instruments.rowCount);
    for (const kb of [bMid, bVol, bSpr, bSec]) { try { kb.destroy(); } catch (_) {} }

    chunkPriceKb = bro.kernel.createBuffer(4096 * 4, { residency: 'shared' });
    chunkNotionalKb = bro.kernel.createBuffer(4096 * 4, { residency: 'shared' });
    chunkDistKb = bro.kernel.createBuffer(4096 * 4, { residency: 'shared' });
    chunkFillKb = bro.kernel.createBuffer(4096 * 4, { residency: 'shared' });
}

function rebuildAgentsGpu() {
    if (!splat.gpuReady || !kPackAgents || !agentMetaBuf) return;
    const ac = agents.rowCount;
    const bLev = agents.toKernelBuffer('leverage', { residency: 'gpu' });
    const bMgn = agents.toKernelBuffer('margin_ratio', { residency: 'gpu' });
    const bEq = agents.toKernelBuffer('equity', { residency: 'gpu' });
    const bPnl = agents.toKernelBuffer('pnl', { residency: 'gpu' });
    const bRsk = agents.toKernelBuffer('risk_tier', { residency: 'gpu' });
    const stride = Math.min(ac, 65536);
    kPackAgents.dispatch(stride, bLev, bMgn, bEq, bPnl, bRsk, agentMetaBuf, ac, stride);
    for (const kb of [bLev, bMgn, bEq, bPnl, bRsk]) { try { kb.destroy(); } catch (_) {} }
}

function destroyOrderBuffers() {
    for (const buf of [s0Buf, s1Buf, rest4Buf, linkIdxBuf]) {
        if (buf) { try { buf.destroy(); } catch (_) {} }
    }
    s0Buf = null;
    s1Buf = null;
    rest4Buf = null;
    linkIdxBuf = null;
}

function rebuildOrdersGpu() {
    const N = orders.rowCount;
    gpuRowCount = N;
    splat.rowCount = N;
    if (!splat.gpuReady || N <= 0) {
        destroyOrderBuffers();
        return;
    }
    destroyOrderBuffers();

    s0Buf = bro.kernel.createBuffer(N * 16, { residency: 'gpu' });
    s1Buf = bro.kernel.createBuffer(N * 16, { residency: 'gpu' });
    rest4Buf = bro.kernel.createBuffer(N * 16, { residency: 'gpu' });
    linkIdxBuf = bro.kernel.createBuffer(N * 4, { residency: 'gpu' });

    const bx = orders.toKernelBuffer('x', { residency: 'gpu' });
    const by = orders.toKernelBuffer('y', { residency: 'gpu' });
    const bz = orders.toKernelBuffer('z', { residency: 'gpu' });
    const bPr = orders.toKernelBuffer('price', { residency: 'gpu' });
    const bQty = orders.toKernelBuffer('qty', { residency: 'gpu' });
    const bNot = orders.toKernelBuffer('notional', { residency: 'gpu' });
    const bDm = orders.toKernelBuffer('dist_mid', { residency: 'gpu' });
    const bFl = orders.toKernelBuffer('fill_ratio', { residency: 'gpu' });
    const bSym = orders.toKernelBuffer('sym_id', { residency: 'gpu' });
    const bSd = orders.toKernelBuffer('side', { residency: 'gpu' });
    const bStr = orders.toKernelBuffer('strategy', { residency: 'gpu' });
    const bFlg = orders.toKernelBuffer('flags', { residency: 'gpu' });
    const bVen = orders.toKernelBuffer('venue_id', { residency: 'gpu' });
    const bAg = orders.toKernelBuffer('agent_id', { residency: 'gpu' });

    const stride = Math.min(N, 1048576);
    kPackOrdersPos.dispatch(
        stride,
        bx, by, bz, bPr, bQty, bAg,
        s0Buf, rest4Buf, linkIdxBuf,
        N, stride, agents.rowCount
    );
    kPackOrdersMeta.dispatch(
        stride,
        bNot, bDm, bFl,
        bSym, bSd, bStr, bFlg, bVen, instMetaBuf,
        s1Buf, N, stride
    );

    for (const kb of [bx, by, bz, bPr, bQty, bNot, bDm, bFl, bSym, bSd, bStr, bFlg, bVen, bAg]) {
        try { kb.destroy(); } catch (_) {}
    }

    if (!splat.maskBuffer) {
        splat.maskBuffer = bro.kernel.createBuffer(new Uint32Array([0xFFFFFFFF]), { residency: 'gpu' });
        splat.hasMask = 0;
    }
}

rebuildAgentsGpu();
rebuildOrdersGpu();

// 4. Camera, Sonifier, Living Vitals HUD & Worker Client
const view = new OrbitView(gpuCanvas, Object.assign({}, MANIFOLDS[0].preset, {
    immediate: true,
    minDist: 0.55,
    maxDist: 10.5,
    fovScale: 0.92,
    onProbe(pt) {
        applyCanvasBrush(pt);
    },
}));

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
    shockPulse: 0,
    lastReactive: { recomputedChunks: 0, reusedChunks: orders.chunkCount },
    lastWorkerPlan: null,
    lastCheckpoint: null,
    sectorRows: [],
    symbolRows: [],
    deskRows: [],
    feeRows: [],
    topWhales: [],
    topAgents: [],
    tensorOut: null,
    lastOrdersVer: -1,
    lastAgentsVer: -1,
    workerBusy: false,
    chartsDirty: true,
    frameCounter: 0,
};

const ckptDir = ((globalThis.bro && bro.app && bro.app.dataDir) ? bro.app.dataDir : 'test-results').replace(/\\/g, '/');
const ckptPath = `${ckptDir}/living-ckpt-market-microstructure.brotable`;

// 5. Manifold Switcher & Guide
const descEl = $('#manifold-desc');
let manifoldBar = null;
const sideBtns = [];

function updateManifoldHud() {
    const m = MANIFOLDS[view.toManifold] || MANIFOLDS[0];
    descEl.textContent = m.desc;
    $('#hud-manifold').innerHTML =
        `<b>${m.name}</b> · 4 linked tables (orders / agents / instruments / venues)` +
        `<div class="sci-guide">${m.desc}</div>`;
}

export function setManifold(idx) {
    const id = Math.max(0, Math.min(MANIFOLDS.length - 1, idx | 0));
    view.setManifold(id);
    view.setView(MANIFOLDS[id].preset);
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

// 6. ReactiveQuery & Vitals Synchronization
function refreshMarginReactive() {
    if (!marginRq) return null;
    if (marginRq.dirty()) {
        const rr = marginRq.refresh();
        if (rr.changed) {
            state.lastReactive = {
                recomputedChunks: rr.recomputedChunks | 0,
                reusedChunks: rr.reusedChunks | 0,
            };
        }
        return rr;
    }
    return null;
}

function syncVitalsUI() {
    const st = orders.stats();
    const alertCnt = marginRq.table ? marginRq.table.rowCount : 0;
    const wbLabel = st.tombstoneCount > 0
        ? `paused (${st.tombstoneCount} tombstones)`
        : `2 chunks/step (#${state.writeCursor}/${orders.chunkCount})`;

    vitals.update({
        tableStats: st,
        version: orders.version,
        structureVersion: orders.structureVersion,
        reactive: state.lastReactive,
        gpuWriteback: wbLabel,
        workerPlan: state.lastWorkerPlan,
        snapshotsShipped: state.snapshotsShipped,
        checkpoint: state.lastCheckpoint,
    });

    const rc = state.lastReactive;
    const totC = Math.max(1, rc.recomputedChunks + rc.reusedChunks);
    $('#orders-badge').textContent = `${fmtInt(st.rowCount)} ORDERS`;
    $('#hud-ocount').textContent = fmtInt(st.rowCount);
    $('#hud-alerts').textContent = fmtInt(alertCnt);
    $('#st-orders').textContent = fmtInt(st.rowCount);
    $('#st-alerts').textContent = fmtInt(alertCnt);
    $('#st-reactive').textContent = `${rc.reusedChunks}/${totC} reused`;
    $('#st-writeback').textContent = st.tombstoneCount > 0 ? 'paused' : `2/${orders.chunkCount} ch`;
    if (state.tensorOut && state.tensorOut.ok) {
        $('#hud-tensor').textContent = `${state.tensorOut.meanScore.toFixed(2)} (${state.tensorOut.backend})`;
    }
}

// 7. Closed-Loop Rotating 2-Chunk GPU -> Table Writeback
export function stepWritebackChunks(numChunks = 2) {
    if (!splat.gpuReady || gpuRowCount <= 0) return false;
    const st = orders.stats();
    if (st.tombstoneCount > 0 || orders.rowCount !== gpuRowCount) return false;
    const nc = orders.chunkCount;
    if (nc <= 0) return false;

    const kCount = Math.min(numChunks, nc);
    for (let k = 0; k < kCount; k++) {
        const ci = (state.writeCursor + k) % nc;
        const offset = ci * 4096;
        const rc = orders.chunkRowCount(ci);
        if (rc <= 0 || offset + rc > gpuRowCount) continue;
        const stride = Math.min(rc, 4096);

        kExtractChunk.dispatch(stride, s0Buf, s1Buf, chunkPriceKb, offset, rc, stride, 0);
        kExtractChunk.dispatch(stride, s0Buf, s1Buf, chunkNotionalKb, offset, rc, stride, 1);
        kExtractChunk.dispatch(stride, s0Buf, s1Buf, chunkDistKb, offset, rc, stride, 2);
        kExtractChunk.dispatch(stride, s0Buf, s1Buf, chunkFillKb, offset, rc, stride, 3);

        orders.readFromKernelBuffer(ci, 'price', chunkPriceKb);
        orders.readFromKernelBuffer(ci, 'notional', chunkNotionalKb);
        orders.readFromKernelBuffer(ci, 'dist_mid', chunkDistKb);
        orders.readFromKernelBuffer(ci, 'fill_ratio', chunkFillKb);
    }
    state.writeCursor = (state.writeCursor + kCount) % nc;
    state.writebackTicks++;
    refreshMarginReactive();
    return true;
}

// 8. Interactive Spatial Brushes & Market Stress Lifecycle
const BRUSH_DESCRIPTIONS = {
    probe: 'Click orderbook to inspect local depth via whereInRadius + HashIndex(agent_id, sym_id).',
    crash: 'Click orderbook to fire Flash Crash (r=0.42): widens dist_mid, cuts fill_ratio, flags TOXIC.',
    sweep: 'Click orderbook to cancel an AABB box of resting limit orders (creates tombstones).',
};

function setBrush(kind) {
    state.activeBrush = kind;
    for (const btn of document.querySelectorAll('#brush-grid .living-brush-btn')) {
        btn.classList.toggle('active', btn.dataset.brush === kind);
    }
    $('#brush-desc').textContent = BRUSH_DESCRIPTIONS[kind] || '';
}

function playMarketAudio(kind, pt) {
    if (!sonifier.enabled) return;
    const p3 = [pt[0] * 3.0, pt[1] + 0.3, pt[2] * 3.0];
    if (kind === 'crash') {
        sonifier.playChord([
            { waveform: 'sawtooth', freq: 138.6, gain: 0.16, pos: p3, dur: 0.45 },
            { waveform: 'triangle', freq: 146.8, gain: 0.14, pos: p3, dur: 0.45 },
            { waveform: 'sawtooth', freq: 207.7, gain: 0.12, pos: p3, dur: 0.45 },
        ]);
    } else if (kind === 'whale') {
        sonifier.playChord([
            { waveform: 'sine', freq: 261.6, gain: 0.14, pos: p3, dur: 0.42 },
            { waveform: 'sine', freq: 392.0, gain: 0.14, pos: p3, dur: 0.42 },
            { waveform: 'sine', freq: 523.3, gain: 0.12, pos: p3, dur: 0.48 },
        ]);
    } else if (kind === 'squeeze') {
        sonifier.playChord([
            { waveform: 'triangle', freq: 196.0, gain: 0.14, pos: p3, dur: 0.40 },
            { waveform: 'triangle', freq: 293.7, gain: 0.13, pos: p3, dur: 0.40 },
            { waveform: 'sine', freq: 440.0, gain: 0.12, pos: p3, dur: 0.45 },
        ]);
    } else {
        sonifier.playChord([
            { waveform: 'sine', freq: 329.6, gain: 0.12, pos: p3, dur: 0.30 },
            { waveform: 'triangle', freq: 493.9, gain: 0.10, pos: p3, dur: 0.30 },
        ]);
    }
}

export function probeAt(pt = BRUSH_PRESETS.probe) {
    const t0 = performance.now();
    const radTbl = orders.query().whereInRadius('book3d', pt, 0.40).limit(8).run();
    let near = orders.nearest('book3d', pt, 4, 0.85);
    if (near.rowCount === 0) near = orders.nearest('book3d', pt, 4);
    const ms = performance.now() - t0;

    state.lastBrushPt = pt.slice(0, 3);
    state.lastBrushKind = 'probe';

    const hitRow = near.rowCount > 0 ? near.row(0) : (radTbl.rowCount > 0 ? radTbl.row(0) : null);
    if (hitRow) {
        const agRes = agents.query().where(q.eq('agent_id', hitRow.agent_id)).runWithStats();
        const instRes = instruments.query().where(q.eq('sym_id', hitRow.sym_id)).runWithStats();
        const agRow = agRes.table.toArray()[0];
        const instRow = instRes.table.toArray()[0];
        const venRow = hitRow.venue_id != null
            ? venues.query().where(q.eq('venue_id', hitRow.venue_id)).toArray()[0]
            : null;
        const sideStr = (hitRow.side | 0) === 0 ? 'BID' : 'ASK';
        const notStr = hitRow.notional >= 1e6
            ? `$${(hitRow.notional / 1e6).toFixed(2)}M`
            : `$${Math.round(hitRow.notional / 1e3)}k`;

        $('#probe-box').textContent =
            `ord #${hitRow.order_id} · ${instRow ? instRow.symbol : '?'} ${sideStr} ${notStr} (${hitRow.strategy})\n` +
            `agent #${hitRow.agent_id}: ${agRow ? `${agRow.desk_type} ${agRow.leverage.toFixed(1)}x (mgn ${Math.round(agRow.margin_ratio * 100)}%)` : '—'}\n` +
            `venue: ${venRow ? `${venRow.venue_name} (${venRow.fee_bps.toFixed(2)}bps)` : 'OTC Dark Pool (null venue_id)'}\n` +
            `radiusHits: ${radTbl.rowCount} · distMid: ${hitRow.dist_mid.toFixed(1)}bps · idx=[${agRes.usedIndex},${instRes.usedIndex}]`;
        playMarketAudio('probe', pt);
        status.ok(`probed order #${hitRow.order_id} via SpatialIndex + HashIndex (${fmtMs(ms)})`);
    }
}

export function triggerFlashCrash(pt = BRUSH_PRESETS.crash) {
    const t0 = performance.now();
    const res = orders.query()
        .whereInRadius('book3d', pt, 0.42)
        .update({
            dist_mid: q.col('dist_mid').add(24.0),
            fill_ratio: q.col('fill_ratio').mul(0.35),
            flags: q.bitOr('flags', 1),
        });
    const agRes = agents.updateWhere(q.gt('leverage', 3.4), {
        margin_ratio: q.col('margin_ratio').add(0.14),
        pnl: q.col('pnl').sub(180000.0),
    });
    const ms = performance.now() - t0;

    state.lastBrushPt = pt.slice(0, 3);
    state.lastBrushKind = 'crash';
    state.shockPulse = 1.0;

    refreshMarginReactive();
    rebuildAgentsGpu();
    rebuildOrdersGpu();
    syncVitalsUI();
    playMarketAudio('crash', pt);
    runWorkerAnalytics(false);
    status.warn(`Flash Crash hit ${fmtInt(res.affectedRows)} orders, ${fmtInt(agRes.affectedRows)} agents (${fmtMs(ms)})`);
    return res;
}

export function triggerLiquiditySweep(minP = BRUSH_PRESETS.sweepMin, maxP = BRUSH_PRESETS.sweepMax) {
    const t0 = performance.now();
    const res = orders.query()
        .whereInAABB('book3d', minP, maxP)
        .remove();
    const ms = performance.now() - t0;

    state.lastBrushPt = [
        (minP[0] + maxP[0]) * 0.5,
        (minP[1] + maxP[1]) * 0.5,
        (minP[2] + maxP[2]) * 0.5,
    ];
    state.lastBrushKind = 'sweep';

    refreshMarginReactive();
    rebuildOrdersGpu();
    syncVitalsUI();
    runWorkerAnalytics(false);
    status.warn(`Liquidity Sweep removed ${fmtInt(res.affectedRows)} orders (${fmtMs(ms)}, tombstones active)`);
    return res;
}

export function triggerWhaleWall(count = 512) {
    const t0 = performance.now();
    const batch = makeWhaleWallBatch(nextOrderId, count, agentLevs, 8800 + state.frameCounter);
    nextOrderId += count;
    orders.insertMany(batch);
    const ms = performance.now() - t0;

    refreshMarginReactive();
    rebuildOrdersGpu();
    syncVitalsUI();
    playMarketAudio('whale', [0, 0.2, 0]);
    runWorkerAnalytics(false);
    status.ok(`Whale Wall inserted +${count} iceberg block orders (${fmtMs(ms)}, total ${fmtInt(orders.rowCount)})`);
    return count;
}

export function triggerMarginSqueeze() {
    const t0 = performance.now();
    const agRes = agents.updateWhere(q.gt('leverage', 4.0), {
        leverage: q.col('leverage').mul(0.78),
        margin_ratio: q.lit(0.94),
        risk_tier: q.lit(3),
    });
    const delRes = orders.deleteWhere(q.or(
        q.ne(q.bitAnd('flags', 2), 0),
        q.gt('dist_mid', 54.0)
    ));
    orders.compact();
    const ms = performance.now() - t0;

    refreshMarginReactive();
    rebuildAgentsGpu();
    rebuildOrdersGpu();
    syncVitalsUI();
    playMarketAudio('squeeze', [0.4, 0.1, 0.2]);
    runWorkerAnalytics(false);
    status.warn(`Margin Squeeze hit ${fmtInt(agRes.affectedRows)} agents, liquidated ${fmtInt(delRes.affectedRows)} orders & compacted (${fmtMs(ms)})`);
    return { agRes, delRes };
}

export function compactBook() {
    const t0 = performance.now();
    orders.compact();
    const ms = performance.now() - t0;
    refreshMarginReactive();
    rebuildOrdersGpu();
    syncVitalsUI();
    runWorkerAnalytics(false);
    status.ok(`compacted orders in ${fmtMs(ms)} (0% tombstones, indexes rebuilt)`);
}

function findNearestWorldPt(m, clickPt) {
    if (m === 0) return clickPt;
    let best = null;
    let bestD2 = Infinity;
    const stride = Math.max(1, Math.floor(orders.rowCount / 8000));
    const agMap = new Map();
    const agSnap = agents.snapshot();
    for (let ci = 0; ci < agSnap.chunkCount; ci++) {
        const rc = agSnap.chunkRowCount(ci);
        const ids = agSnap.chunkColumnView(ci, 'agent_id');
        const levs = agSnap.chunkColumnView(ci, 'leverage');
        const mgns = agSnap.chunkColumnView(ci, 'margin_ratio');
        const eqs = agSnap.chunkColumnView(ci, 'equity');
        const pnls = agSnap.chunkColumnView(ci, 'pnl');
        for (let r = 0; r < rc; r++) {
            agMap.set(ids[r], { leverage: levs[r], margin_ratio: mgns[r], equity: eqs[r], pnl: pnls[r] });
        }
    }

    const snap = orders.snapshot();
    for (let ci = 0; ci < snap.chunkCount; ci++) {
        const rc = snap.chunkRowCount(ci);
        const xv = snap.chunkColumnView(ci, 'x');
        const yv = snap.chunkColumnView(ci, 'y');
        const zv = snap.chunkColumnView(ci, 'z');
        const symv = snap.chunkColumnView(ci, 'sym_id');
        const sdv = snap.chunkColumnView(ci, 'side');
        const flv = snap.chunkColumnView(ci, 'flags');
        const vnv = snap.chunkColumnView(ci, 'venue_id');
        const strv = snap.chunkColumnView(ci, 'strategy');
        const ntv = snap.chunkColumnView(ci, 'notional');
        const dmv = snap.chunkColumnView(ci, 'dist_mid');
        const flrv = snap.chunkColumnView(ci, 'fill_ratio');
        const agv = snap.chunkColumnView(ci, 'agent_id');
        for (let r = 0; r < rc; r += stride) {
            const o = {
                x: xv[r], y: yv[r], z: zv[r],
                sym_id: symv[r], side: sdv[r], flags: flv[r],
                venue_id: vnv[r] === 0 ? null : vnv[r],
                strategy: strv[r], notional: ntv[r], dist_mid: dmv[r], fill_ratio: flrv[r],
            };
            const p = evalOrderManifold(m, o, agMap.get(agv[r]));
            const dx = p[0] - clickPt[0];
            const dy = p[1] - clickPt[1];
            const dz = p[2] - clickPt[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = [xv[r], yv[r], zv[r]];
            }
        }
    }
    return best || BRUSH_PRESETS.probe.slice();
}

function applyCanvasBrush(pt) {
    const worldPt = findNearestWorldPt(view.toManifold | 0, pt);
    if (state.activeBrush === 'crash') triggerFlashCrash(worldPt);
    else if (state.activeBrush === 'sweep') {
        const r = 0.34;
        triggerLiquiditySweep([worldPt[0] - r, -0.60, worldPt[2] - r], [worldPt[0] + r, 0.90, worldPt[2] + r]);
    } else probeAt(worldPt);
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
            const needOrders = forceShip || orders.version !== state.lastOrdersVer;
            const needAgents = forceShip || agents.version !== state.lastAgentsVer;
            if (needOrders || needAgents) {
                const payload = {};
                if (needOrders) payload.orders = orders.snapshot();
                if (needAgents) payload.agents = agents.snapshot();
                if (forceShip) {
                    payload.instruments = instruments.snapshot();
                    payload.venues = venues.snapshot();
                }
                await worker.request({ type: 'attachTables', tables: payload });
                state.snapshotsShipped += Object.keys(payload).length;
                state.lastOrdersVer = orders.version;
                state.lastAgentsVer = agents.version;
            }

            const batch = await worker.request({
                type: 'runBatch',
                queries: ANALYTICS_QUERIES,
                tensor: {
                    table: 'orders',
                    cols: ['dist_mid', 'fill_ratio', 'notional', 'age_ms'],
                    weights: [0.014, -0.42, 0.00000032, 0.000008],
                    bias: 0.38,
                    maxRows: 32768,
                },
            });

            const res = batch.results || {};
            if (res.sectorDepth && res.sectorDepth.ok) state.sectorRows = res.sectorDepth.rows;
            if (res.symbolDepth && res.symbolDepth.ok) state.symbolRows = res.symbolDepth.rows;
            if (res.deskStress && res.deskStress.ok) {
                state.deskRows = res.deskStress.rows;
                state.lastWorkerPlan = {
                    strategy: res.deskStress.stats.strategy || 'join',
                    simdWidth: res.deskStress.stats.simdWidth || 0,
                    ms: res.deskStress.ms,
                };
            }
            if (res.venueFeeAttribution && res.venueFeeAttribution.ok) {
                state.feeRows = res.venueFeeAttribution.rows;
            }
            if (res.topWhales && res.topWhales.ok) {
                state.topWhales = res.topWhales.rows;
                renderTopWhalesTable($('#topk-whales-wrap'), state.topWhales);
            }
            if (res.topLeveragedAgents && res.topLeveragedAgents.ok) {
                state.topAgents = res.topLeveragedAgents.rows;
                renderTopAgentsTable($('#topk-agents-wrap'), state.topAgents);
            }
            if (batch.tensor) {
                state.tensorOut = batch.tensor;
            }
            state.chartsDirty = true;
            const totMs = (res.sectorDepth ? res.sectorDepth.ms : 0) + (res.deskStress ? res.deskStress.ms : 0);
            $('#st-worker').textContent = fmtMs(totMs);
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
    orders.snapshot().save(ckptPath);
    const ms = performance.now() - t0;
    const sizeBytes = fs.existsSync(ckptPath) ? fs.statSync(ckptPath).size : 0;
    const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
    $('#ckpt-info').innerHTML = '';
    $('#ckpt-info').appendChild(
        h('div.living-ckpt-item', null, h('span', null, 'saved v3'), h('b', null, `${mb} MB (${fmtMs(ms)})`))
    );
    status.ok(`saved v3 checkpoint (${mb} MB in ${fmtMs(ms)})`);
    return { path: ckptPath, bytes: sizeBytes, ms };
}

export async function auditCheckpoint() {
    if (!fs.existsSync(ckptPath)) saveCheckpoint();
    await worker.ready;
    await worker.request({ type: 'attachTables', tables: { orders: orders.snapshot() } });
    state.snapshotsShipped++;
    const cmp = await worker.request({
        type: 'compareMappedCheckpoint',
        path: ckptPath,
        tableName: 'orders',
        col: 'notional',
        verify: false,
    });
    if (cmp && cmp.ok) {
        state.lastCheckpoint = cmp;
        $('#ckpt-info').innerHTML = '';
        $('#ckpt-info').append(
            h('div.living-ckpt-item', null, h('span', null, 'mmap zero-copy'), h('b', null, `${cmp.mappedIndexes} indexes (${fmtMs(cmp.ms)})`)),
            h('div.living-ckpt-item', null, h('span', null, 'avg notional Δ'), h('b', null, `$${Math.round(cmp.deltaAvg)}`))
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
    if (marginRq) marginRq.dispose();
    orders = loaded;
    marginRq = createMarginReactive(orders);
    state.lastReactive = { recomputedChunks: orders.chunkCount, reusedChunks: 0 };
    rebuildOrdersGpu();
    syncVitalsUI();
    runWorkerAnalytics(true);
    status.ok(`restored v3 checkpoint (${fmtInt(orders.rowCount)} orders in ${fmtMs(performance.now() - t0)})`);
    return true;
}

// 10. UI Event Wiring
for (const btn of document.querySelectorAll('#brush-grid .living-brush-btn')) {
    btn.addEventListener('click', () => setBrush(btn.dataset.brush));
}
$('#btn-flash-crash').addEventListener('click', () => triggerFlashCrash(BRUSH_PRESETS.crash));
$('#btn-liq-sweep').addEventListener('click', () => triggerLiquiditySweep(BRUSH_PRESETS.sweepMin, BRUSH_PRESETS.sweepMax));
$('#btn-whale-wall').addEventListener('click', () => triggerWhaleWall(512));
$('#btn-margin-squeeze').addEventListener('click', () => triggerMarginSqueeze());
$('#btn-compact').addEventListener('click', () => compactBook());
$('#btn-gpu-step').addEventListener('click', () => {
    if (splat.gpuReady && kStepOrders && gpuRowCount > 0) {
        const stride = Math.min(gpuRowCount, 1048576);
        kStepOrders.dispatch(stride, s0Buf, s1Buf, rest4Buf, instMetaBuf, gpuRowCount, stride, 0.025, state.simTime, state.shockPulse);
    }
    stepWritebackChunks(2);
    syncVitalsUI();
});

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
const chartSectorsEl = $('#chart-sectors');
const chartDesksEl = $('#chart-desks');
let lastChartSizeKey = '';
window.addEventListener('resize', () => {
    lastChartSizeKey = '';
});

function renderFrame() {
    splat.render(view, (cols, cam, meta) => [
        s0Buf, s1Buf, linkIdxBuf, agentMetaBuf, meta.maskBuffer,
        meta.count, meta.stride, meta.w, meta.h,
        cam.camR, cam.camU, cam.camF, cam.camT,
        meta.fromManifold, meta.toManifold, meta.morph,
        meta.hasMask, meta.radiusMode, state.simTime, state.shockPulse,
    ]);
    drawMarketOverlay(overlayCanvas, view, state);
}

let lastFpsStr = '';
frameLoop((dt) => {
    const stepDt = Math.min(0.05, Math.max(0.0005, dt));
    state.simTime += stepDt;
    state.shockPulse = Math.max(0.0, state.shockPulse - stepDt * 0.85);
    state.frameCounter++;
    view.step(dt);

    if (splat.gpuReady && kStepOrders && gpuRowCount > 0) {
        const stride = Math.min(gpuRowCount, 1048576);
        const shock = state.shockPulse + 0.12 * Math.sin(state.simTime * 0.4);
        kStepOrders.dispatch(stride, s0Buf, s1Buf, rest4Buf, instMetaBuf, gpuRowCount, stride, stepDt, state.simTime, shock);
    }

    if ((state.frameCounter % 6) === 0) {
        stepWritebackChunks(2);
        syncVitalsUI();
    }
    if ((state.frameCounter % 18) === 0) {
        runWorkerAnalytics(false);
    }

    renderFrame();

    const chartKey = `${chartSectorsEl.clientWidth}x${chartSectorsEl.clientHeight}|${chartDesksEl.clientWidth}x${chartDesksEl.clientHeight}|${window.devicePixelRatio || 1}`;
    if (chartKey !== lastChartSizeKey || state.chartsDirty) {
        lastChartSizeKey = chartKey;
        state.chartsDirty = false;
        drawSectorDepthChart(chartSectorsEl, state.sectorRows);
        drawDeskStressChart(chartDesksEl, state.deskRows, state.feeRows);
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
    syncVitalsUI();
    await runWorkerAnalytics(true);
    status.ok(`ready (${fmtInt(orders.rowCount)} orders, 4 tables in ${fmtMs(loadMs)})`);
})();

globalThis.__marketMicro = {
    get orders() { return orders; },
    agents,
    instruments,
    venues,
    get marginRq() { return marginRq; },
    view,
    splat,
    sonifier,
    worker,
    state,
    ckptPath,
    setManifold,
    setBrush,
    probeAt,
    triggerFlashCrash,
    triggerLiquiditySweep,
    triggerWhaleWall,
    triggerMarginSqueeze,
    compactBook,
    stepWritebackChunks,
    runWorkerAnalytics,
    saveCheckpoint,
    auditCheckpoint,
    loadCheckpoint,
    renderFrame,
};
