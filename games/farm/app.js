// app.js — Farm sim entry point.
//
// Wires the pure world model (world.js), the 3D isometric renderer
// (render3d.js, through bro's scene graph + TileWorld), a DOM HUD,
// the title/help/pause screens, and the human-controlled player avatar to the
// shared GameLoop.
//
// Three actors mutate ONE shared world through the same world.actions verbs:
//   - the rule-based orchestrator (orchestrator.js) assigning NPC tasks,
//   - the NPC task executor (tasks.js) carrying them out,
//   - the human player (player.js) pitching in via context-sensitive interact.
// Because they share state, a need the player resolves vanishes from observe()
// and the orchestrator naturally moves on — no coordination protocol needed.
//
// CONTROLS:
//   WASD / arrows  move the farmer       E / Space  interact (context-sensitive)
//   Esc / P        pause
// DEBUG KEYS (playing only):
//   1 refill feed  2 refill water  3 water crops  4 harvest+collect
//   5 plant empty  6 resupply pools  O  log world.observe()

import { GameLoop } from '/lib/loop.js';
import { Input } from '/lib/input.js';
import { SFX } from '/lib/audio.js';
import { Screens } from '/lib/screens.js';
import { createWorld } from '/app/world.js';
import { createRenderer } from '/app/render3d.js';
import {
    STAT_KEYS, STAT_LABEL, STAT_MAX_LEVEL, statXpToNext,
    staminaMaxFor, staminaDrainMul, moveSpeedMul, proficiencyMul, ROLE_COLOR,
    healthMaxFor, healthRegenMul, hydrationDrainMul, STATIONS,
    GRID, REGIONS,
} from '/app/defs.js';

// Worker station id -> display label for the HUD roster + stat sheet.
const STATION_LABEL = {};
for (const s of STATIONS) STATION_LABEL[s.id] = s.label;
const STATION_SHORT = { pasture: 'Pasture', coop: 'Coop', meadow: 'Meadow', garden: 'Garden' };
import { advanceTask } from '/app/tasks.js';
import { createOrchestrator } from '/app/orchestrator.js';
import { initPlayer, movePlayer, runInteract, buyFeed } from '/app/player.js';
import { createVoice } from '/app/voice.js';

const W_FALLBACK = 1100, H_FALLBACK = 760;

// ---------- canvas ----------
const canvas = document.getElementById('game');
const scene = canvas.getContext('scene');
const getW = () => canvas.width || W_FALLBACK;
const getH = () => canvas.height || H_FALLBACK;

// ---------- world + player + orchestrator ----------
const world = createWorld({ seed: 7 });
initPlayer(world, 22, 14);

// ---------- 3D isometric renderer (scene graph) ----------
const renderer = createRenderer(scene, world);

// ---------- navigation: workers path around the solid buildings ----------
// A nav grid spanning the board, with the four solid structures (farmhouse,
// barn, silo, well) as obstacles; the open field and animal pens stay fully
// walkable. The task executor routes every `move` step over this grid, so a
// worker crossing the yard now bends around the barn instead of clipping
// through it. findPath returns a smoothed path — a straight line when nothing
// is in the way — and an empty path when the target sits inside a structure,
// in which case the executor falls back to a direct line so movement can never
// wedge. (Picking + nav grid are the same engine seam added to TileWorld.)
const NAV_BLOCKERS = new Set(['farmhouse', 'barn', 'silo', 'well']);
const navGrid = bro.ai.game.createNavGrid({
    minX: 0, minZ: 0, maxX: GRID.cols, maxZ: GRID.rows, cellSize: 0.5,
    padding: 0.1,
    obstacles: REGIONS.filter((r) => NAV_BLOCKERS.has(r.type)).map((r) => ({
        x: (r.x0 + r.x1 + 1) / 2, z: (r.y0 + r.y1 + 1) / 2,
        hw: (r.x1 - r.x0 + 1) / 2, hd: (r.y1 - r.y0 + 1) / 2,
    })),
});
// world-tile (x,y) in, world-tile waypoints out (nav grid speaks x/z).
world.pathfind = (x0, y0, x1, y1) =>
    navGrid.findPath(x0, y0, x1, y1).map((p) => ({ x: p.x, y: p.z }));
globalThis.farmNav = navGrid;

const orchestrator = createOrchestrator();
globalThis.farmAuto = true;   // false => do-nothing baseline (NPCs idle-wander)

// Headless / inspection hooks.
globalThis.world = world;
globalThis.player = world.player;
globalThis.orchestrator = orchestrator;
globalThis.farmInteract = () => doInteract();
globalThis.farmStart = () => doAction('play');

// ---------- audio ----------
SFX.init();

// ---------- spoken NPC voices (Kokoro TTS) ----------
// Each speaker that flows through world.say() also gets a distinct synthesized
// voice, played through the SAME broaudio AudioContext as the SFX so the two
// don't fight over the device. Loads on the GPU in the background; if it can't
// load, voice.disabled is set and speak() is a silent no-op (the game keeps
// running text-only). See voice.js for the utterance-duration API the next pass
// gates NPC behaviour on (speak() returns Promise<durationSec>, voice.speaking()).
const voice = createVoice({
    getAudioCtx: () => SFX.ctx(),
    npcVoiceTag: (id) => { const n = world.npcs.find((x) => x.id === id); return n ? n.voice : null; },
    isActive: () => globalThis.screens && globalThis.screens.name() === 'playing',
});
globalThis.farmVoice = voice;

// Drive spoken audio from the model's serialized speech channel. The model
// (world.js stepSpeech) plays ONE line at a time and asks us to voice the
// active one; onStart reports the real utterance length the moment playback
// begins, which the model uses to keep the bubble + any worker waiting on the
// line in lockstep with the audio. world.say itself now just enqueues, so a
// single channel governs every spoken line — no two ever overlap.
world._emitSpeech = (id, text, onStart) => voice.speak(id, text, { onStart });
const sfx = {
    splash:  () => SFX.noise(0.16, 0.35, 170),
    feed:    () => SFX.noise(0.12, 0.30, 320),
    harvest: () => SFX.sequence([[660, 0.07, 'square', 0.4], [880, 0.10, 'square', 0.4]]),
    pickup:  () => SFX.tone(740, 0.08, 'square', 0.45),
    plant:   () => SFX.tone(420, 0.07, 'triangle', 0.4),
    nope:    () => SFX.tone(180, 0.10, 'sine', 0.25),
    menu:    () => SFX.tone(440, 0.04, 'sine', 0.3),
    select:  () => SFX.tone(660, 0.07, 'square', 0.4),
};
function playSfx(name) { const f = sfx[name]; if (f) f(); }

// ---------- input ----------
Input.init([
    { name: 'up',       label: 'Up',       defaults: ['w', 'ArrowUp'] },
    { name: 'down',     label: 'Down',     defaults: ['s', 'ArrowDown'] },
    { name: 'left',     label: 'Left',     defaults: ['a', 'ArrowLeft'] },
    { name: 'right',    label: 'Right',    defaults: ['d', 'ArrowRight'] },
    { name: 'interact', label: 'Interact', defaults: ['e', ' '] },
    { name: 'market',   label: 'Buy feed', defaults: ['m'] },
    { name: 'pause',    label: 'Pause',    defaults: ['Escape', 'p'] },
    { name: 'confirm',  label: 'Confirm',  defaults: ['Enter'] },
]);
Input.attach(window);

// Edge-triggered actions. Movement is polled (Input.down) in the tick.
Input.onAction((action, phase) => {
    if (phase !== 'down') return;
    if (screens.name() === 'playing') {
        if (action === 'interact') { doInteract(); return; }
        if (action === 'market')   { doBuyFeed(); return; }
        if (action === 'pause') {
            // Esc dismisses an open stat sheet first; only then pauses.
            if (statOpen) { playSfx('menu'); closeStatPanel(); return; }
            screens.switchTo('pause'); return;
        }
        return;
    }
    // In menus, funnel actions to the active screen as DOM key strings.
    if (action === 'up')            screens.keydown('ArrowUp');
    else if (action === 'down')     screens.keydown('ArrowDown');
    else if (action === 'left')     screens.keydown('ArrowLeft');
    else if (action === 'right')    screens.keydown('ArrowRight');
    else if (action === 'confirm' || action === 'interact') screens.keydown('Enter');
    else if (action === 'pause')    screens.keydown('Escape');
});

// Debug keys: a separate raw listener, active only while playing.
window.addEventListener('keydown', (e) => {
    if (screens.name() !== 'playing') return;
    const k = e.key.toLowerCase();
    const fn = debugKeys[k];
    if (fn) { fn(); updateHUD(); }
});
function eachPen(fn) { ['coop', 'meadow', 'pasture'].forEach(fn); }
const debugKeys = {
    '1': () => eachPen((p) => world.actions.refillFeedTrough(p)),
    '2': () => eachPen((p) => world.actions.refillWaterTrough(p)),
    '3': () => world.crops.forEach((c) => { if (c.stage !== 'empty') world.actions.waterCrop(c.id); }),
    '4': () => {
        world.crops.forEach((c) => { if (c.stage === 'ripe') world.actions.harvest(c.id); });
        eachPen((p) => world.actions.collectProduce(p));
    },
    '5': () => world.crops.forEach((c) => { if (c.stage === 'empty') world.actions.plant(c.plotIndex, 'wheat'); }),
    '6': () => { world.actions.drawWater(80); world.actions.loadFeed(80); },
    'o': () => { console.log(JSON.stringify(world.observe(), null, 2)); },
};

// ---------- player interact ----------
function doInteract() {
    const res = runInteract(world);
    if (res.ok) playSfx(res.sfx);
    else playSfx('nope');
    updateHUD();
    return res;
}
function doBuyFeed() {
    const res = buyFeed(world, 200);
    playSfx(res.ok ? 'pickup' : 'nope');
    updateHUD();
    return res;
}
globalThis.farmBuyFeed = () => doBuyFeed();

// ---------- HUD ----------
const hudClock  = document.getElementById('hud-clock');
const hudEnv    = document.getElementById('hud-env');
const hudRes    = document.getElementById('hud-resources');
const hudMarket = document.getElementById('hud-market');
const hudObjective = document.getElementById('hud-objective');
const hudWorkers = document.getElementById('hud-workers');
const hudAlerts = document.getElementById('hud-alerts');
const hudDialog = document.getElementById('hud-dialog');

const STATE_LABEL = { idle: 'idle', working: 'working', resting: 'resting', sleeping: 'asleep', eating: 'eating', recovering: 'recovering', waiting: 'in line', talking: 'talking', listening: 'listening' };
function workerRow(n) {
    const sCls = n.stamina < 25 ? 'low' : (n.stamina < 55 ? 'mid' : 'ok');
    const eCls = n.energy < 30 ? 'low' : (n.energy < 55 ? 'mid' : 'ok');
    const wCls = n.hydration < 22 ? 'low' : (n.hydration < 50 ? 'mid' : 'ok');
    const healthMax = n.healthMax || 100;
    const hCls = n.health < healthMax * 0.30 ? 'low' : (n.health < healthMax * 0.55 ? 'mid' : 'ok');
    // Stamina bar fills against the Endurance-driven cap (staminaMax), health
    // against the Vitality-driven cap (healthMax), so neither overflows when a
    // seasoned worker's reserve climbs past 100.
    const sPct = Math.round(100 * n.stamina / (n.staminaMax || 100));
    const hPct = Math.round(100 * n.health / healthMax);
    // At-a-glance critical flag: thirsty / hungry / exhausted / unwell.
    const crit = n.stamina < 15 || n.energy < 20 || n.hydration < 22 || n.health < 30;
    const dot = crit ? '<span class="wk-crit" title="needs care">!</span>' : '';
    const station = n.station ? (STATION_SHORT[n.station] || n.station) : '';
    return `<div class="wk-row${crit ? ' crit' : ''}">` +
        `<span class="wk-name role-${n.role}">${n.name}${dot}</span>` +
        `<span class="wk-state">${STATE_LABEL[n.state] || n.state}</span>` +
        '<span class="wk-bars">' +
            `<span class="wk-bar"><span class="wk-fill ${sCls}" style="width:${sPct}%"></span></span>` +
            `<span class="wk-bar"><span class="wk-fill en ${eCls}" style="width:${Math.round(n.energy)}%"></span></span>` +
            `<span class="wk-bar"><span class="wk-fill wa ${wCls}" style="width:${Math.round(n.hydration)}%"></span></span>` +
            `<span class="wk-bar"><span class="wk-fill hp ${hCls}" style="width:${hPct}%"></span></span>` +
        '</span>' +
        `<span class="wk-station" title="${station ? STATION_LABEL[n.station] || station : ''}">${station}</span>` +
        '</div>';
}

const GOOD_LABEL = { eggs: 'Eggs', milk: 'Milk', wool: 'Wool', crops: 'Crop', feed: 'Feed' };
function priceChip(good, price, level) {
    return `<div class="price-chip ${level}"><span class="price-k">${GOOD_LABEL[good] || good}</span>` +
           `<span class="price-v">${price.toFixed(1)}g</span></div>`;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
const WEATHER_LABEL = {
    clear: '☀ Clear', rain: '🌧 Rain', drought: '🔥 Drought',
    frost: '❄ Frost', storm: '⛈ Storm',
};
function weatherLabel(w) { return WEATHER_LABEL[w] || cap(w); }

function speakerName(id) {
    const n = world.npcs.find((x) => x.id === id);
    return n ? n.name : id;   // 'Foreman' and 'You' pass through unchanged
}
function speakerClass(id) {
    if (id === 'Foreman') return 'foreman';
    if (id === 'You') return 'you';
    if (id === 'Farm') return 'farm';
    return '';
}
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function chip(label, value, cls) {
    return `<div class="res-chip ${cls || ''}"><span class="res-k">${label}</span><span class="res-v">${value}</span></div>`;
}

function updateHUD() {
    const o = world.observe();
    if (hudClock) hudClock.textContent = `Day ${o.clock.day} · ${o.clock.time}`;

    if (hudEnv) {
        const e = o.env;
        hudEnv.innerHTML =
            `<span class="env-chip season-${e.season}">${cap(e.season)}</span>` +
            `<span class="env-chip wx-${e.weather}">${weatherLabel(e.weather)}</span>` +
            `<span class="env-chip temp">${e.temperature}°</span>` +
            `<span class="env-chip phase">${cap(e.dayPhase)}</span>`;
    }

    if (hudRes) {
        const r = o.resources;
        hudRes.innerHTML =
            chip('Gold', r.gold, 'gold') +
            chip('Feed', r.feed, r.feed < 40 ? 'low' : '') +
            chip('Water', r.water, r.water < 40 ? 'low' : '') +
            chip('Eggs', r.eggs) +
            chip('Milk', r.milk) +
            chip('Wool', r.wool) +
            chip('Crops', r.crops);
    }

    if (hudMarket) {
        const m = o.market;
        const order = ['eggs', 'milk', 'wool', 'crops', 'feed'];
        hudMarket.innerHTML =
            order.map((g) => priceChip(g, m.prices[g], m.level[g])).join('') +
            chip('Barn', o.barnFeed, o.barnFeed < 220 ? 'low' : '') +
            chip('Well', o.well.level);
    }

    if (hudObjective) {
        const obj = o.objective;
        const pct = Math.max(0, Math.min(100, Math.round(100 * obj.progress / obj.target)));
        hudObjective.innerHTML =
            `<div class="obj-row"><span>Reach ${obj.target}g by Day ${obj.deadlineDay}</span>` +
            `<span class="obj-num ${obj.met ? 'met' : ''}">${obj.progress} / ${obj.target}g</span></div>` +
            `<div class="obj-bar"><div class="obj-fill ${obj.met ? 'met' : ''}" style="width:${pct}%"></div></div>`;
    }

    if (hudWorkers) {
        hudWorkers.innerHTML = o.npcs.map(workerRow).join('');
    }

    if (hudAlerts) {
        if (o.alerts.length === 0) {
            hudAlerts.innerHTML = '<div class="alert ok">All calm</div>';
        } else {
            hudAlerts.innerHTML = o.alerts
                .slice(0, 9)
                .map((a) => `<div class="alert ${a.level}">${escapeHtml(a.msg)}</div>`)
                .join('');
        }
    }

    if (hudDialog) {
        if (world.dialog.length === 0) {
            hudDialog.innerHTML = '<div class="line muted">…</div>';
        } else {
            hudDialog.innerHTML = world.dialog
                .slice(0, 8)
                .map((d) => `<div class="line ${speakerClass(d.speaker)}"><span class="who">${escapeHtml(speakerName(d.speaker))}:</span> ${escapeHtml(d.text)}</div>`)
                .join('');
        }
    }

    // Keep the inspect panel live while it's open (stats/needs tick every frame).
    if (statOpen) renderStatPanel();
}

// ---------- click-to-inspect stat sheet ----------
// A click on the board hit-tests the nearest worker/Foreman and opens a live
// stat-sheet panel bound to them. The sim keeps running while it's open.
const statEl   = document.getElementById('statsheet');
const ssSwatch = document.getElementById('ss-swatch');
const ssName   = document.getElementById('ss-name');
const ssRole   = document.getElementById('ss-role');
const ssState  = document.getElementById('ss-state');
const ssStation = document.getElementById('ss-station');
const ssNeeds  = document.getElementById('ss-needs');
const ssStats  = document.getElementById('ss-stats');
let statOpen = false;

const PANEL_STATE = {
    idle: 'idle', working: 'working', walking: 'walking', resting: 'resting',
    sleeping: 'asleep', eating: 'eating', recovering: 'recovering', talking: 'talking',
    listening: 'listening', waiting: 'waiting to report', supervising: 'supervising',
};
const ROLE_DISPLAY = { rancher: 'Rancher', gardener: 'Gardener', farmhand: 'Farmhand', foreman: 'Foreman' };

// Resolve an inspect id ('npc-*' | 'Foreman') to a uniform view model.
function inspectEntity(id) {
    if (!id) return null;
    if (world.foreman && id === world.foreman.id) {
        const f = world.foreman;
        return {
            id: f.id, name: f.name, roleLabel: ROLE_DISPLAY.foreman, color: '#b5343a',
            stats: f.stats, hasVitals: false, state: 'supervising', carrying: null,
            station: null,
        };
    }
    const n = world.npcs.find((x) => x.id === id);
    if (!n) return null;
    return {
        id: n.id, name: n.name, roleLabel: ROLE_DISPLAY[n.role] || n.role,
        color: ROLE_COLOR[n.role] || '#caa', stats: n.stats, hasVitals: true,
        stamina: n.stamina, staminaMax: staminaMaxFor(n), energy: n.energy,
        hydration: n.hydration, health: n.health, healthMax: healthMaxFor(n),
        state: n.state, carrying: n.carrying, station: n.station || null,
    };
}

// Nearest inspectable person (worker or Foreman) within ~1 tile of a world tile.
// Tile-space pick — used by the headless clickTile hook.
function pickPersonAt(tileX, tileY) {
    let best = null, bestD = 1.0;
    const consider = (cid, x, y) => {
        const d = Math.hypot(x - tileX, y - tileY);
        if (d <= bestD) { best = cid; bestD = d; }
    };
    for (const n of world.npcs) consider(n.id, n.x, n.y);
    if (world.foreman) consider(world.foreman.id, world.foreman.x, world.foreman.y);
    return best;
}

// Hit-test a world tile: open/switch the panel on a person, close on empty board.
function handleTileClick(tileX, tileY) {
    const id = pickPersonAt(tileX, tileY);
    if (id) selectStatPanel(id);
    else closeStatPanel();
    return id;
}

// Distance from point P to segment A-B, all in screen pixels.
function distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * vx, cy = ay + t * vy;
    return Math.hypot(px - cx, py - cy);
}

// Screen-space person pick: a click hits whoever's drawn FIGURE it lands on,
// scored as distance to that figure's foot->head screen segment. Robust to the
// capsule standing well above its foot tile — which a flat ground-plane pick
// (used by the old tile path) fundamentally can't account for under a tilted
// camera. Capture radius scales with the figure's on-screen height so it works
// at any zoom / window size.
function pickPersonClient(clientX, clientY) {
    let best = null, bestD = Infinity;
    const consider = (id, x, y) => {
        const foot = renderer.worldToScreen(x, 0.1, y, canvas);
        const head = renderer.worldToScreen(x, 1.5, y, canvas);
        if (!foot || !head) return;
        const segLen = Math.hypot(head[0] - foot[0], head[1] - foot[1]);
        const radius = Math.max(18, segLen * 0.5);
        const d = distToSeg(clientX, clientY, foot[0], foot[1], head[0], head[1]);
        if (d <= radius && d < bestD) { best = id; bestD = d; }
    };
    for (const n of world.npcs) consider(n.id, n.x, n.y);
    if (world.foreman) consider(world.foreman.id, world.foreman.x, world.foreman.y);
    return best;
}

// A board click selects whatever figure was clicked (live stat sheet), or closes
// the panel when it lands on empty ground.
function boardClickClient(clientX, clientY) {
    const id = pickPersonClient(clientX, clientY);
    if (id) { selectStatPanel(id); return id; }
    closeStatPanel();
    return null;
}

function selectStatPanel(id) {
    world.inspect = id;
    statOpen = true;
    if (statEl) statEl.style.display = 'block';
    renderStatPanel();
}
function closeStatPanel() {
    world.inspect = null;
    statOpen = false;
    if (statEl) statEl.style.display = 'none';
}

function needRow(lbl, val, max, enClass) {
    const f = Math.max(0, Math.min(1, val / max));
    const cls = val < max * 0.25 ? 'low' : (val < max * 0.55 ? 'mid' : 'ok');
    return '<div class="ss-need-row">' +
        `<span class="ss-need-k">${lbl}</span>` +
        `<span class="ss-need-bar"><span class="ss-need-fill ${enClass} ${cls}" style="width:${Math.round(f * 100)}%"></span></span>` +
        `<span class="ss-need-v">${Math.round(val)}</span></div>`;
}
function statRow(key, s) {
    const maxed = s.level >= STAT_MAX_LEVEL;
    const need = statXpToNext(s.level);
    const pct = maxed ? 100 : Math.max(0, Math.min(100, Math.round(100 * s.xp / need)));
    return `<div class="ss-stat-row ${maxed ? 'maxed' : ''}">` +
        `<span class="ss-stat-k">${STAT_LABEL[key]}</span>` +
        `<span class="ss-stat-lvl">${s.level}</span>` +
        `<span class="ss-stat-xpwrap"><span class="ss-stat-xp" style="width:${pct}%"></span></span></div>`;
}
function renderStatPanel() {
    const e = inspectEntity(world.inspect);
    if (!e) { closeStatPanel(); return; }
    if (ssSwatch) ssSwatch.style.background = e.color;
    if (ssName) ssName.textContent = e.name;
    if (ssRole) { ssRole.textContent = e.roleLabel; ssRole.style.color = e.color; }
    if (ssState) {
        let line = PANEL_STATE[e.state] || e.state || '';
        if (e.carrying) line += ` · <span class="carry">carrying ${escapeHtml(e.carrying)}</span>`;
        ssState.innerHTML = line;
    }
    if (ssStation) {
        ssStation.innerHTML = e.station
            ? `<span class="st-k">Station ·</span> ${escapeHtml(STATION_LABEL[e.station] || e.station)}`
            : (e.hasVitals ? '<span class="st-k">Station · unassigned</span>' : '');
    }
    if (ssNeeds) {
        ssNeeds.innerHTML = e.hasVitals
            ? needRow('Stamina', e.stamina, e.staminaMax, '') +
              needRow('Energy', e.energy, 100, 'en') +
              needRow('Water', e.hydration, 100, 'wa') +
              needRow('Health', e.health, e.healthMax, 'hp')
            : '<div class="ss-need-row"><span class="ss-need-k" style="width:auto;color:#9bb592">command post · always on duty</span></div>';
    }
    if (ssStats) {
        ssStats.innerHTML = e.stats ? STAT_KEYS.map((k) => statRow(k, e.stats[k])).join('') : '';
    }
}

if (statEl) {
    const closeBtn = document.getElementById('ss-close');
    if (closeBtn) closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); playSfx('menu'); closeStatPanel(); });
}
// Board click: open/switch/close the inspect panel (only while playing).
canvas.addEventListener('click', (e) => {
    if (screens.name() !== 'playing') return;
    boardClickClient(e.clientX, e.clientY);
});

// Headless / inspection hooks for the stat-sheet panel.
globalThis.farmInspect = {
    clickTile:   (tx, ty) => handleTileClick(tx, ty),
    clickClient: (cx, cy) => boardClickClient(cx, cy),
    close:       () => closeStatPanel(),
    selectedId:  () => world.inspect,
    isOpen:      () => statOpen,
    panelEl:     () => statEl,
    // Headless click-by-tile is the supported path now (clickTile); the old
    // pixel-space worldToScreen inverse belonged to the 2D board and no longer
    // applies under the 3D camera.
    worldToScreen: null,
};
globalThis.farmStats = { staminaMaxFor, staminaDrainMul, moveSpeedMul, proficiencyMul, statXpToNext,
                         healthMaxFor, healthRegenMul, hydrationDrainMul };

// ---------- screens ----------
const hudEl = document.getElementById('hud');
const overlayEl = document.getElementById('overlay');

const screens = Screens.create({
    overlay: '#overlay',
    itemsSelector: '.menu-items',
    onMenuMove: sfx.menu,
    onMenuSelect: sfx.select,
});
globalThis.screens = screens;

function doAction(action) {
    switch (action) {
        case 'play':   screens.switchTo('playing'); break;
        case 'resume': screens.switchTo('playing'); break;
        case 'howto':  screens.switchTo('howto'); break;
        case 'back':   screens.switchTo('title'); break;
        case 'quit':   screens.switchTo('title'); break;
    }
}
function showOverlay(name) {
    screens.showOverlay(name);
    hudEl.style.display = 'none';
    closeStatPanel();   // the inspect panel belongs to the playing screen only
}

screens.define('title', {
    enter: () => showOverlay('title'),
    keydown: (key) => screens.menuNav('title', key,
        (idx, el) => doAction(el.getAttribute('data-action'))),
});
screens.define('howto', {
    enter: () => showOverlay('howto'),
    keydown: (key) => screens.menuNav('howto', key,
        (idx, el) => doAction(el.getAttribute('data-action')),
        { onBack: () => doAction('back') }),
});
screens.define('playing', {
    enter: () => { overlayEl.style.display = 'none'; hudEl.style.display = 'block'; updateHUD(); },
});
screens.define('pause', {
    enter: () => showOverlay('pause'),
    keydown: (key) => screens.menuNav('pause', key,
        (idx, el) => doAction(el.getAttribute('data-action')),
        { onBack: () => doAction('resume') }),
});

screens.switchTo('title');

// ---------- loop ----------
let hudAccum = 0;
let decideAccum = 0;
const DECIDE_INTERVAL = 1000;   // run the orchestrator ~1x / sim-second

function tick(dt) {
    // Sim only advances while playing; title/help/pause cleanly freeze it.
    if (screens.name() !== 'playing') return;

    // Player movement (polled), with hint refresh every frame.
    const dx = (Input.down('right') ? 1 : 0) - (Input.down('left') ? 1 : 0);
    const dy = (Input.down('down') ? 1 : 0) - (Input.down('up') ? 1 : 0);
    movePlayer(world, dt, dx, dy);

    world.step(dt);

    for (const n of world.npcs) {
        if (n.task) advanceTask(world, n, dt);
    }

    decideAccum += dt;
    const anyIdle = world.npcs.some((n) => n.task == null);
    if (globalThis.farmAuto && (decideAccum >= DECIDE_INTERVAL || anyIdle)) {
        decideAccum = 0;
        orchestrator.decide(world);
    }

    hudAccum += dt;
    if (hudAccum >= 250) { hudAccum = 0; updateHUD(); }
}

function draw() {
    renderer.frame(world, getW(), getH());
}

GameLoop.create({ tick, draw }).start();
