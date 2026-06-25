// app.js — Farm sim entry point.
//
// Wires the pure world model (world.js) to the renderer (render.js) and a
// DOM HUD, driven by the shared GameLoop. Pass 1: world simulates itself;
// debug keys invoke action verbs so you can watch the need->action->relief
// loop close. The AI-agent layer (Pass 2) will read world.observe() and call
// world.actions.* — exactly what the debug keys do here.
//
// DEBUG KEYS (also shown in the on-screen hint):
//   1  refill BOTH feed troughs        2  refill BOTH water troughs
//   3  water ALL crops                 4  harvest ripe + collect produce
//   5  plant ALL empty plots (wheat)   6  resupply pools (drawWater+loadFeed)
//   P  pause / resume sim              O  log world.observe() to console

import { GameLoop } from '/lib/loop.js';
import { Canvas } from '/lib/canvas.js';
import { createWorld } from '/app/world.js';
import { render } from '/app/render.js';

const W_FALLBACK = 1100, H_FALLBACK = 760;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const getW = () => Canvas.w(ctx, W_FALLBACK);
const getH = () => Canvas.h(ctx, H_FALLBACK);

const world = createWorld({ seed: 7 });
// Expose for headless inspection / future agent layer.
globalThis.world = world;

let paused = false;

// ---------- debug action keys ----------
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
    'p': () => { paused = !paused; },
    'o': () => { console.log(JSON.stringify(world.observe(), null, 2)); },
};

window.addEventListener('keydown', (e) => {
    const fn = debugKeys[e.key.toLowerCase()];
    if (fn) { fn(); updateHUD(); }
});

// ---------- HUD ----------
const hudClock = document.getElementById('hud-clock');
const hudRes   = document.getElementById('hud-resources');
const hudAlerts = document.getElementById('hud-alerts');

function chip(label, value, cls) {
    return `<div class="res-chip ${cls || ''}"><span class="res-k">${label}</span><span class="res-v">${value}</span></div>`;
}

function updateHUD() {
    const o = world.observe();
    if (hudClock) hudClock.textContent = `Day ${o.clock.day} · ${o.clock.time}`;

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
                .map((a) => `<div class="alert ${a.level}">${a.msg}</div>`)
                .join('');
        }
    }
}

// ---------- loop ----------
let hudAccum = 0;
function tick(dt) {
    if (paused) return;
    world.step(dt);
    hudAccum += dt;
    if (hudAccum >= 250) { hudAccum = 0; updateHUD(); }
}

function draw() {
    render(ctx, world, getW(), getH());
}

updateHUD();
GameLoop.create({ tick, draw }).start();
