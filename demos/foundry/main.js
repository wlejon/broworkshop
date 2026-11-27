// demos/foundry/main.js — Foundry Application Orchestrator.
//
// UX Features:
//   - One-click Machine Hangar strip across Combat Bots, Workshop Tools & Titan Modules
//   - Default machine boots alive & running cleanly at 100% health
//   - Combat Arena ALWAYS battles YOUR current Blueprint / Dyno Bench machine vs chosen opponent!
//   - Tabbed Left Palette (Components vs Compiled Modules) + 3D Placement controls in Inspector

import { boot } from "/lib/kit/app.js";
import { $, h, clear } from "/lib/kit/dom.js";
import { segmented, fpsMeter, stats } from "/lib/kit/ui.js";
import { History } from "/lib/kit/history.js";
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";

import { PRIMITIVES, PRIMITIVE_CATEGORIES } from "/lib/foundry/primitives.js";
import { addNode, findNode } from "/lib/foundry/blueprint.js";
import { compileBlueprint } from "/lib/foundry/compiler.js";
import { auditMachineMotion } from "/lib/foundry/motion_audit.js";
import { createMachineRuntime } from "/lib/foundry/runtime.js";
import { createStarterLibrary, PRESET_GROUPS } from "/lib/foundry/presets.js";
import { createArena } from "/lib/foundry/arena.js";

import { createFoundryView3D } from "/app/view3d.js";
import { createBlueprintView } from "/app/blueprint_view.js";
import { renderSpecSheet, renderInspector, drawDynoPlot, renderLiveTelemetry } from "/app/panels.js";

const app = boot();
const history = new History({ limit: 150 });
const library = createStarterLibrary();

// --- State -------------------------------------------------------------------
let mode = 'blueprint'; // 'blueprint' | 'dyno' | 'arena'
let navStack = ['bot_shredder_safe'];
let activeId = 'bot_shredder_safe';
let lastMachineId = 'bot_shredder_safe';
let compiled = null;
let benchRuntime = null;
let benchRunning = true; // Boot alive & operating smoothly!
let dynoThrottle = 0.75;
let dynoLoadNm = 12;
let pendingShockNm = 0;

let arena = null;
let arenaRunning = true;
let arenaManual = false;
let arenaOpponent = 'bot_iron_wedge';
const keysDown = new Set();
let selectedNodeId = null;
let paletteTab = 'parts'; // 'parts' | 'modules'
let uiTimer = 0;

// --- Viewport & Views --------------------------------------------------------
const vp = sceneViewport('#stage3d', {
    orbit: { target: [0, 0.15, 0], dist: 1.8, fov: 38, near: 0.01, far: 400, rot: orbitRotation(0.62, -0.34) },
    controls: { minDist: 0.12, maxDist: 60 },
});
const view3d = createFoundryView3D(vp);

const bpView = createBlueprintView($('#bpCanvas'), {
    onSelect(node) {
        selectedNodeId = node ? node.id : null;
        view3d.setSelected(selectedNodeId);
        refreshInspector();
    },
    onDrillDown(refId) {
        if (!library[refId]) return;
        navStack.push(refId);
        openBlueprint(refId, false);
    },
    onMutate(label, opts) {
        recordSnapshot(label);
        if (!opts?.layoutOnly) recompileAll();
    },
});

// --- Undo / Redo Snapshots ---------------------------------------------------
let lastLibJson = JSON.stringify(library);
function recordSnapshot(label) {
    const before = lastLibJson;
    const after = JSON.stringify(library);
    if (before === after) return;
    lastLibJson = after;
    const applyJson = (raw) => {
        const parsed = JSON.parse(raw);
        for (const k of Object.keys(library)) delete library[k];
        Object.assign(library, parsed);
        lastLibJson = raw;
        recompileAll();
    };
    history.record(label, () => applyJson(after), () => applyJson(before));
    syncUndoButtons();
}
function syncUndoButtons() {
    $('#undo').disabled = !history.canUndo;
    $('#redo').disabled = !history.canRedo;
}
$('#undo').addEventListener('click', () => { history.undo(); syncUndoButtons(); });
$('#redo').addEventListener('click', () => { history.redo(); syncUndoButtons(); });

// --- Compilation & Refresh ---------------------------------------------------
function activeBp() { return library[activeId]; }

/** Resolve which blueprint represents the player's combat machine for Arena battles. */
function playerArenaBpId() {
    const cur = library[activeId];
    if (cur && cur.scale === 'machine' && cur.kind === 'bot') return cur.id;
    const root = library[navStack[0]];
    if (root && root.scale === 'machine') return root.id;
    if (cur && cur.scale === 'machine') return cur.id;
    return library[lastMachineId] ? lastMachineId : 'bot_shredder_safe';
}

function recompileAll() {
    const bp = activeBp();
    if (!bp) return;
    if (bp.scale === 'machine') lastMachineId = bp.id;

    compiled = compileBlueprint(bp, library);
    compiled.motionAudit = auditMachineMotion(compiled, { samples: 12, liveSim: false });
    benchRuntime = createMachineRuntime(compiled);

    bpView.setContext(bp, library, compiled, benchRuntime);
    if (mode !== 'arena') {
        view3d.loadBlueprintView(compiled);
        view3d.setSelected(selectedNodeId);
        view3d.syncRuntime(benchRuntime, 0);
    }

    // Auto-scale brake load slider cleanly to this assembly's continuous torque envelope!
    const maxSlider = Math.max(40, Math.round(compiled.spec.primaryPeakTorqueNm * 1.35));
    const step = maxSlider > 2000 ? 100 : maxSlider > 400 ? 10 : 2;
    const loadEl = $('#dynoLoad');
    loadEl.max = String(maxSlider);
    loadEl.step = String(step);
    dynoLoadNm = Math.max(step, Math.min(maxSlider, Math.round(compiled.spec.primaryContTorqueNm * 0.28)));
    loadEl.value = String(dynoLoadNm);
    $('#dynoLoadVal').textContent = dynoLoadNm >= 1000 ? (dynoLoadNm / 1000).toFixed(1) + ' kN·m' : dynoLoadNm + ' N·m';

    $('#scaleTag').textContent = `Scale: ${compiled.scale.toUpperCase()} · ${compiled.parts.length} parts · ${compiled.asmBoxes.length} compiled modules`;
    $('#view3dTitle').textContent = mode === 'arena'
        ? 'LIVE BOX3D COMBAT ARENA — YOUR BLUEPRINT VS OPPONENT'
        : compiled.scale === 'subassembly' ? '3D PRECISION COMPONENT BENCH'
        : compiled.scale === 'titan' ? '3D TITAN SCALE GANTRY (MULTI-STOREY MODULE)'
        : '3D MACHINE CUTAWAY & COMPILED HOUSINGS';

    renderHangar();
    renderBreadcrumbs();
    renderSpecSheet($('#specSheet'), compiled, (topId) => {
        selectedNodeId = topId;
        view3d.setSelected(selectedNodeId);
        bpView.setSelected(selectedNodeId);
        refreshInspector();
    });
    refreshInspector();
    refreshPalette();
    drawDynoPlot($('#dynoPlot'), compiled, benchRuntime);
    renderLiveTelemetry($('#eventsFeed'), $('#partsTable'), $('#autopsyBox'), [benchRuntime]);
}

function openBlueprint(id, resetStack = true) {
    if (!library[id]) return;
    activeId = id;
    if (resetStack) navStack = [id];
    selectedNodeId = null;
    $('#presetSelect').value = id;
    if (mode === 'arena') {
        startArenaBattle(arenaOpponent);
    } else {
        recompileAll();
    }
}

// --- One-Click Operational Machine Hangar Strip ------------------------------
const HANGAR_ITEMS = [
    { group: 'INDUSTRIAL & MECH', ids: [
        ['mach_excavator_crawler', 'Excavator', '#f59e0b'],
        ['mach_mech_walker', 'Strider Mech', '#38bdf8'],
        ['mach_haul_tractor', 'Haul Tractor', '#22c55e'],
        ['mach_rotary_drill', 'Drill Rig', '#f59e0b'],
        ['mach_engine_lathe', 'Engine Lathe', '#a855f7'],
        ['mach_compound_powerhouse', 'Twin-V4 Plant', '#a855f7'],
        ['machine_gantry_crane', '5t Crane', '#a855f7'],
        ['machine_shop_press', '25t Press', '#a855f7'],
        ['machine_cnc_mill', 'CNC Mill', '#a855f7'],
    ]},
    { group: 'CONTROL & RIGS', ids: [
        ['bot_atlas_forklift', 'Forklift', '#38bdf8'],
        ['bot_kodiak_grapple', 'Grapple', '#38bdf8'],
        ['bot_ballista_catapult', 'Catapult', '#38bdf8'],
        ['bot_battering_bull', 'Diesel Bull', '#38bdf8'],
        ['bot_shredder_safe', 'Shredder', '#22c55e'],
        ['bot_iron_wedge', 'Iron Wedge', '#38bdf8'],
    ]},
    { group: 'TITAN', ids: [
        ['titan_recovery_crane', '8m Crane Deck', '#f97316'],
        ['titan_hip_drive', '6m Hip', '#f97316'],
        ['titan_hydraulic_leg', '8m Leg', '#f97316'],
        ['titan_crawler_bogie', 'Siege Track', '#f97316'],
        ['titan_siege_core', 'Diesel Core', '#f97316'],
    ]},
];

function renderHangar() {
    const bar = $('#hangarBar');
    clear(bar);
    HANGAR_ITEMS.forEach((grp, gi) => {
        if (gi > 0) bar.append(h('span.f-hangar-sep'));
        bar.append(h('span.f-hangar-lbl', null, grp.group));
        for (const [id, label, dotCol] of grp.ids) {
            if (!library[id]) continue;
            const isCur = activeId === id || navStack[0] === id;
            bar.append(h('button.f-hbtn' + (isCur ? '.active' : ''), {
                title: library[id].description,
                onclick: () => openBlueprint(id, true),
            }, h('i', { style: { background: dotCol } }), label));
        }
    });
}

function renderBreadcrumbs() {
    const el = $('#breadcrumbs');
    clear(el);
    navStack.forEach((id, idx) => {
        if (idx > 0) el.append(h('span.f-sep', null, '›'));
        const cur = idx === navStack.length - 1;
        el.append(h('button.f-crumb' + (cur ? '.cur' : ''), {
            onclick: () => {
                if (cur) return;
                navStack = navStack.slice(0, idx + 1);
                openBlueprint(id, false);
            },
        }, library[id]?.name || id));
    });
}

function refreshInspector() {
    const bp = activeBp();
    const node = selectedNodeId ? findNode(bp, selectedNodeId) : null;
    renderInspector($('#inspector'), node, library, compiled,
        (label) => { recordSnapshot(label); recompileAll(); },
        (refId) => { navStack.push(refId); openBlueprint(refId, false); },
        (nodeId) => {
            bpView.setSelected(nodeId);
            bpView.deleteSelected();
        },
        benchRuntime);
}

// --- Tabbed Left Palette (Components | Compiled Modules) ---------------------
function refreshPalette() {
    const tabs = $('#palTabs');
    clear(tabs);
    for (const [key, lbl] of [['parts', 'Parts'], ['modules', 'Modules']]) {
        tabs.append(h('button.f-pal-tab' + (paletteTab === key ? '.active' : ''), {
            onclick: () => { paletteTab = key; refreshPalette(); },
        }, lbl));
    }

    const el = $('#palette');
    clear(el);
    const bp = activeBp();

    if (paletteTab === 'parts') {
        for (const cat of PRIMITIVE_CATEGORIES) {
            const items = Object.values(PRIMITIVES).filter((p) => p.cat === cat);
            const grid = h('div.f-pal-grid');
            for (const def of items) {
                grid.append(h('button.small', {
                    title: def.note,
                    onclick: () => {
                        const offZ = (compiled?.bounds?.max?.[2] || 0.2) + 0.14;
                        const n = addNode(bp, {
                            type: def.type,
                            x: 140 + bp.nodes.length * 36,
                            y: 120 + (bp.nodes.length % 4) * 55,
                            pos3d: [0, 0.14, offZ],
                        }, library);
                        selectedNodeId = n.id;
                        recordSnapshot('Add ' + def.label);
                        recompileAll();
                        bpView.setSelected(n.id);
                        app.status.ok(`Added ${def.label} — drag port dots to wire & tune 3D placement in Inspector`);
                    },
                }, h('i', { style: { background: def.color } }), def.label));
            }
            el.append(h('div.f-pal-group', null, h('div.k-cap', null, cat), grid));
        }
    } else {
        const subs = Object.values(library).filter((b) => b.id !== activeId && b.exposedPorts && b.exposedPorts.length > 0);
        const tierGroups = [
            ['Tier 1 Sub-Assemblies (10–60 cm)', subs.filter((s) => s.scale === 'subassembly'), 'T1'],
            ['Tier 3 Titan Modules (4–10 m)', subs.filter((s) => s.scale === 'titan'), 'T3'],
        ];
        for (const [title, list, tag] of tierGroups) {
            if (!list.length) continue;
            const grid = h('div.f-pal-grid');
            for (const sub of list) {
                grid.append(h('button.small', {
                    title: sub.description,
                    onclick: () => {
                        const offZ = (compiled?.bounds?.max?.[2] || 0.25) + 0.22;
                        const n = addNode(bp, {
                            type: 'assembly',
                            ref: sub.id,
                            x: 180 + bp.nodes.length * 34,
                            y: 140,
                            pos3d: [0, 0.14, offZ],
                        }, library);
                        selectedNodeId = n.id;
                        recordSnapshot('Nest ' + sub.name);
                        recompileAll();
                        bpView.setSelected(n.id);
                        app.status.ok(`Inserted module: ${sub.name} — adjust Pos X/Y/Z in Inspector`);
                    },
                }, h('span.f-tier-pill', null, tag), sub.name));
            }
            el.append(h('div.f-pal-group', null, h('div.k-cap', null, title), grid));
        }
    }
}

// --- Modes (Blueprint + 3D | Dyno Bench | Combat Arena) ----------------------
const modeBar = segmented('#modes', [
    ['blueprint', 'Blueprint + 3D'],
    ['dyno', 'Dyno Bench'],
    ['arena', 'Combat Arena'],
], { value: mode, small: false, onChange: setMode });

function setMode(m) {
    mode = m;
    modeBar.value = m;
    const split = $('#splitPane');
    split.classList.remove('mode-blueprint', 'mode-dyno', 'mode-arena');
    split.classList.add('mode-' + m);
    $('#leftRail').hidden = (m === 'arena');
    $('#benchBar').hidden = (m === 'arena');
    $('#arenaBar').hidden = (m !== 'arena');
    $('#arenaHud').hidden = (m !== 'arena');

    if (m === 'arena') {
        startArenaBattle(arenaOpponent);
    } else {
        if (arena) { arena.destroy(); arena = null; }
        $('#btnSpin').textContent = benchRunning ? 'Pause Bench' : 'Run Bench';
        recompileAll();
        bpView.fitView();
        setTimeout(() => bpView.fitView(), 0);
    }
}

// --- Combat Arena: Battles YOUR Current Blueprint Machine vs Opponent! -------
function startArenaBattle(opponentKey = arenaOpponent) {
    // Backwards-compatible alias mapping for scripts/tests
    const legacyPairs = {
        safe_vs_wedge: ['bot_shredder_safe', 'bot_iron_wedge'],
        drum_vs_fang: ['bot_mauler_drum', 'bot_fang_crusher'],
        flipper_vs_hammer: ['bot_catapult_flipper', 'bot_anvil_hammer'],
        gas_vs_safe: ['bot_ripper_gas', 'bot_shredder_safe'],
        raw_vs_wedge: ['bot_shredder_raw', 'bot_iron_wedge'],
    };

    let playerId = playerArenaBpId();
    let oppId = opponentKey || 'bot_iron_wedge';
    if (legacyPairs[opponentKey]) {
        playerId = legacyPairs[opponentKey][0];
        oppId = legacyPairs[opponentKey][1];
    } else {
        arenaOpponent = oppId;
        const selEl = $('#arenaMatch');
        if (selEl && [...selEl.options].some((o) => o.value === oppId)) selEl.value = oppId;
    }

    if (arena) { arena.destroy(); arena = null; }
    const isPillar = oppId === 'pillar_smash';
    arena = createArena({
        obstacles: true,
        pillarPositions: isPillar
            ? [{ x: 0, z: 0, w: 0.95, h: 0.95, d: 0.35 }]
            : [{ x: 0, z: -3.2, w: 0.9, h: 0.9, d: 0.35 }, { x: 0, z: 3.2, w: 0.9, h: 0.9, d: 0.35 }],
    });

    const cPlayer = compileBlueprint(library[playerId], library);
    $('#arenaYourTag').textContent = `YOUR DESIGN: ${cPlayer.name}`;

    if (isPillar) {
        arena.spawnBot(cPlayer, { position: [0, 0.22, -3.2], yaw: 0, controller: arenaManual ? 'manual' : 'pillar_ram', label: `${cPlayer.name} (Yours)` });
    } else {
        const oppBpId = oppId === 'mirror' ? playerId : (library[oppId] ? oppId : 'bot_iron_wedge');
        const cOpp = compileBlueprint(library[oppBpId], library);
        arena.spawnBot(cPlayer, { position: [-2.4, 0.22, 0], yaw: Math.PI / 2, controller: arenaManual ? 'manual' : 'duelist', label: `${cPlayer.name} (Yours)` });
        arena.spawnBot(cOpp, { position: [2.4, 0.22, 0], yaw: -Math.PI / 2, controller: 'duelist', label: cOpp.name });
    }

    renderSpecSheet($('#specSheet'), cPlayer);
    view3d.loadArenaView(arena);
    arenaRunning = true;
    $('#btnArenaRun').textContent = 'Pause';
    $('#view3dTitle').textContent = `LIVE BOX3D COMBAT ARENA — ${cPlayer.name.toUpperCase()}`;
    updateArenaHud();
    renderLiveTelemetry($('#eventsFeed'), $('#partsTable'), $('#autopsyBox'), arena.bots.map((b) => b.runtime));
    app.status.ok(`Arena live: battling your ${cPlayer.name} in Box3D!`);
}

function updateArenaHud() {
    if (!arena) return;
    const hud = $('#arenaHud');
    clear(hud);
    arena.bots.forEach((bot, idx) => {
        const aut = bot.runtime.getAutopsy();
        const wch = bot.compiled.weaponChain;
        const wcs = wch ? bot.runtime.chainState.get(wch.id) : null;
        const wRpm = wcs ? Math.abs(wcs.omegaOut * 60 / (2 * Math.PI)).toFixed(0) + ' rpm' : '—';
        const wState = wcs?.broken ? 'OFFLINE' : wcs?.slipping ? 'SLIPPING' : wcs ? wRpm : 'Wedge';
        const role = idx === 0 ? 'YOUR DESIGN' : 'OPPONENT';
        hud.append(h('div.f-bot-card', { style: { borderTop: `3px solid ${bot.color}` } },
            h('div.dim', { style: { fontSize: '9.5px', fontWeight: '700', letterSpacing: '0.06em' } }, role),
            h('b', null, bot.label.replace(' (Yours)', '')),
            h('div', null, `Weapon: `, h('b.' + (wcs?.broken ? 'err' : 'ok'), null, wState)),
            h('div', null, `Hits: ${bot.hitsDealt} dealt / ${bot.hitsTaken} taken`),
            h('div', null, `Failed: ${aut.failed.length} · Repair: $${aut.repairCost.toFixed(0)}`),
        ));
    });
}

// --- Preset Picker & Controls Wiring -----------------------------------------
const presetSel = $('#presetSelect');
PRESET_GROUPS.forEach((grp, gi) => {
    const tag = gi === 0 ? '[T1] ' : gi === 1 ? '[T2] ' : '[T3] ';
    for (const id of grp.ids) {
        if (library[id]) presetSel.append(h('option', { value: id }, tag + library[id].name));
    }
});
presetSel.value = activeId;
presetSel.addEventListener('change', () => openBlueprint(presetSel.value, true));

$('#btnSpin').addEventListener('click', () => {
    benchRunning = !benchRunning;
    $('#btnSpin').textContent = benchRunning ? 'Pause Bench' : 'Run Bench';
});
$('#btnBattleMine').addEventListener('click', () => setMode('arena'));
$('#btnBackEdit').addEventListener('click', () => setMode('blueprint'));

$('#dynoThrottle').addEventListener('input', (e) => {
    dynoThrottle = +e.target.value;
    $('#dynoThrottleVal').textContent = Math.round(dynoThrottle * 100) + '%';
});
$('#dynoLoad').addEventListener('input', (e) => {
    dynoLoadNm = +e.target.value;
    $('#dynoLoadVal').textContent = dynoLoadNm >= 1000 ? (dynoLoadNm / 1000).toFixed(1) + ' kN·m' : dynoLoadNm + ' N·m';
});
$('#btnHitMod').addEventListener('click', () => {
    benchRunning = true;
    $('#btnSpin').textContent = 'Pause Bench';
    const scale = Math.max(1, (compiled?.spec.primaryContTorqueNm || 40) / 40);
    pendingShockNm = 60 * scale;
    app.status.warn(`Injected ${pendingShockNm.toFixed(0)} N·m glancing shock!`);
});
$('#btnHitJam').addEventListener('click', () => {
    benchRunning = true;
    $('#btnSpin').textContent = 'Pause Bench';
    const scale = Math.max(1, (compiled?.spec.primaryContTorqueNm || 40) / 40);
    pendingShockNm = 150 * scale;
    app.status.warn(`Injected ${pendingShockNm.toFixed(0)} N·m CATASTROPHIC JAM!`);
});
$('#btnRepair').addEventListener('click', () => {
    benchRuntime?.repairAll();
    view3d.syncRuntime(benchRuntime, 0);
    renderLiveTelemetry($('#eventsFeed'), $('#partsTable'), $('#autopsyBox'), [benchRuntime]);
    app.status.ok('All worn & failed parts replaced');
});
$('#chkXray').addEventListener('change', (e) => view3d.setXray(e.target.checked));
$('#chkBounds').addEventListener('change', (e) => view3d.setShowBounds(e.target.checked));
$('#btnFitBp').addEventListener('click', () => bpView.fitView());

$('#arenaMatch').addEventListener('change', (e) => startArenaBattle(e.target.value));
$('#btnArenaControl').addEventListener('click', () => {
    arenaManual = !arenaManual;
    $('#btnArenaControl').textContent = arenaManual ? 'WASD Drive' : 'AI Auto';
    if (arena && arena.bots[0]) {
        arena.bots[0].controller = arenaManual ? 'manual' : (arenaOpponent === 'pillar_smash' ? 'pillar_ram' : 'duelist');
    }
    app.status.ok(arenaManual ? 'Manual WASD + Space active for YOUR DESIGN!' : 'Autonomous tactical BattleBots AI active');
});
$('#btnArenaRun').addEventListener('click', () => {
    arenaRunning = !arenaRunning;
    $('#btnArenaRun').textContent = arenaRunning ? 'Pause' : 'Resume';
});
$('#btnArenaStep').addEventListener('click', () => {
    if (!arena) return;
    for (let i = 0; i < 60; i++) arena.step(1 / 60);
    view3d.syncArena(arena, 1 / 60);
    updateArenaHud();
    renderLiveTelemetry($('#eventsFeed'), $('#partsTable'), $('#autopsyBox'), arena.bots.map((b) => b.runtime));
});
$('#btnArenaReset').addEventListener('click', () => startArenaBattle(arenaOpponent));

window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    keysDown.add(e.key.toLowerCase());
    if ((e.key === 'Delete' || e.key === 'Backspace') && mode !== 'arena') {
        bpView.deleteSelected();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault(); history.undo(); syncUndoButtons();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault(); history.redo(); syncUndoButtons();
    }
});
window.addEventListener('keyup', (e) => keysDown.delete(e.key.toLowerCase()));

// --- Main 60 Hz Loop ---------------------------------------------------------
const readouts = stats('#stats', { fps: 'fps', bodies: 'Box3D bodies', parts: 'compiled parts', sim: 'sim t' });
const fps = fpsMeter();

vp.onFrame((dt) => {
    const stepDt = Math.min(1 / 30, Math.max(1 / 240, dt));
    uiTimer += stepDt;

    if (mode === 'arena' && arena) {
        if (arenaManual && arena.bots[0]) {
            const m = arena.bots[0].manual;
            m.throttle = (keysDown.has('w') || keysDown.has('arrowup') ? 1 : 0) - (keysDown.has('s') || keysDown.has('arrowdown') ? 1 : 0);
            m.steer = (keysDown.has('d') || keysDown.has('arrowright') ? 1 : 0) - (keysDown.has('a') || keysDown.has('arrowleft') ? 1 : 0);
            m.fire = keysDown.has(' ');
        }
        if (arenaRunning) arena.step(stepDt);
        view3d.syncArena(arena, stepDt);
        const rts = arena.bots.map((b) => b.runtime);
        if (uiTimer >= 0.12) {
            uiTimer = 0;
            updateArenaHud();
            drawDynoPlot($('#dynoPlot'), arena.bots[0]?.compiled, rts[0]);
            renderLiveTelemetry($('#eventsFeed'), $('#partsTable'), $('#autopsyBox'), rts);
            readouts.set({
                bodies: arena.world.counts.bodies,
                parts: arena.bots.reduce((s, b) => s + b.compiled.parts.length, 0),
                sim: arena.time.toFixed(1) + 's',
            });
        }
    } else {
        if (benchRunning && benchRuntime) {
            benchRuntime.stepDyno(stepDt, {
                throttle: dynoThrottle,
                loadTorqueNm: dynoLoadNm,
                shockTorqueNm: pendingShockNm,
                radialShockN: pendingShockNm * 8,
            });
            pendingShockNm = 0;
        }
        view3d.syncRuntime(benchRuntime, stepDt);
        bpView.draw(stepDt);
        if (uiTimer >= 0.12) {
            uiTimer = 0;
            drawDynoPlot($('#dynoPlot'), compiled, benchRuntime);
            renderLiveTelemetry($('#eventsFeed'), $('#partsTable'), $('#autopsyBox'), benchRuntime ? [benchRuntime] : []);
            readouts.set({
                bodies: 0,
                parts: compiled ? compiled.parts.length : 0,
                sim: (benchRuntime?.time || 0).toFixed(1) + 's',
            });
        }
    }

    readouts.set('fps', fps.tick().toFixed(0));
});

// Boot alive & running cleanly on Fused Shredder Mk1!
openBlueprint('bot_shredder_safe', true);
app.status.ok('Foundry live — pick any machine in the Hangar, tune parts, or click "⚔ Battle This Machine"!');

// Clean scriptable API for headless tests & agent-driven simulation loops
globalThis.__foundry = {
    library,
    vp,
    view3d,
    bpView,
    get mode() { return mode; },
    get activeId() { return activeId; },
    get compiled() { return compiled; },
    get benchRuntime() { return benchRuntime; },
    get arena() { return arena; },
    setMode,
    openBlueprint,
    startArenaMatch: startArenaBattle,
    startArenaBattle,
    stepBench(sec, cmd) {
        const steps = Math.max(1, Math.round(sec * 60));
        for (let i = 0; i < steps; i++) benchRuntime.stepDyno(1 / 60, cmd);
        view3d.syncRuntime(benchRuntime, sec);
        bpView.draw(1 / 60);
        drawDynoPlot($('#dynoPlot'), compiled, benchRuntime);
        renderLiveTelemetry($('#eventsFeed'), $('#partsTable'), $('#autopsyBox'), [benchRuntime]);
    },
    stepArena(sec) {
        if (!arena) return;
        const steps = Math.max(1, Math.round(sec * 60));
        for (let i = 0; i < steps; i++) arena.step(1 / 60);
        view3d.syncArena(arena, 1 / 60);
        updateArenaHud();
        renderLiveTelemetry($('#eventsFeed'), $('#partsTable'), $('#autopsyBox'), arena.bots.map((b) => b.runtime));
    },
};
