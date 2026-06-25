// app.js — Farm sim entry point.
//
// Wires the pure world model (world.js), the renderer (render.js), a DOM HUD,
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
import { Canvas } from '/lib/canvas.js';
import { Input } from '/lib/input.js';
import { SFX } from '/lib/audio.js';
import { Screens } from '/lib/screens.js';
import { createWorld } from '/app/world.js';
import { render } from '/app/render.js';
import { advanceTask } from '/app/tasks.js';
import { createOrchestrator } from '/app/orchestrator.js';
import { initPlayer, movePlayer, runInteract } from '/app/player.js';

const W_FALLBACK = 1100, H_FALLBACK = 760;

// ---------- canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const getW = () => Canvas.w(ctx, W_FALLBACK);
const getH = () => Canvas.h(ctx, H_FALLBACK);

// ---------- world + player + orchestrator ----------
const world = createWorld({ seed: 7 });
initPlayer(world, 22, 14);

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
    { name: 'pause',    label: 'Pause',    defaults: ['Escape', 'p'] },
    { name: 'confirm',  label: 'Confirm',  defaults: ['Enter'] },
]);
Input.attach(window);

// Edge-triggered actions. Movement is polled (Input.down) in the tick.
Input.onAction((action, phase) => {
    if (phase !== 'down') return;
    if (screens.name() === 'playing') {
        if (action === 'interact') { doInteract(); return; }
        if (action === 'pause')    { screens.switchTo('pause'); return; }
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
function eachPen(fn) { ['coop', 'pasture'].forEach(fn); }
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

// ---------- HUD ----------
const hudClock  = document.getElementById('hud-clock');
const hudEnv    = document.getElementById('hud-env');
const hudRes    = document.getElementById('hud-resources');
const hudAlerts = document.getElementById('hud-alerts');
const hudDialog = document.getElementById('hud-dialog');

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
            chip('Crops', r.crops);
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
}

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
    render(ctx, world, getW(), getH());
}

GameLoop.create({ tick, draw }).start();
