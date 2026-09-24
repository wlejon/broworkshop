// Spatial Audio — procedural 3D audio shaped by environment zones.
//
// Walk (fly) through three rooms joined by bridges, a sky platform and an
// underground pool. Everything you hear is a synth voice placed in the world
// (sound.js); what the WORLD does to it is this file:
//
//   zone crossfade  each room owns a bus with its own effect chain; the three
//                   bus gains follow the listener's x, blending across bridges
//   occlusion       every few frames a ray runs from the listener to each
//                   source; each distinct wall/ceiling it crosses cuts that
//                   voice's gain (1 - 0.6 per occluder, floored at 0.05)
//   footsteps       a noise burst whose filter + bus follow the floor material
//   head model      the listener's ILD / behind / cutoff model, live-tunable
//
// The listener is set by hand from the fly camera every frame
// (setListenerPosition / Orientation). demos/scene-audio is the contrast: it
// binds the listener to the camera and attaches emitters to moving nodes.
//
// main.js only imports this module; tests import it for the `lab` handle.

import { boot } from "/lib/kit/app.js";
import { h, clear } from "/lib/kit/dom.js";
import { frameLoop } from "/lib/kit/ui.js";
import { params } from "/lib/kit/params.js";
import { flyCamera } from "/lib/kit/flycam.js";
import { mixerStrips } from "/lib/kit/audio-ui.js";
import { ZONES, buildWorld } from "/app/world.js";
import { buildSound, oneShots } from "/app/sound.js";

boot();

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');
const world = buildWorld(scene);

const ctx = new AudioContext();
const snd = buildSound(ctx);
const shots = oneShots(ctx, snd);

// Start at eye height at the south edge of the forest, looking north (-Z).
const fly = flyCamera(canvas, {
    pos: [0, 1.6, 8], yaw: 0, pitch: 0, speed: 3, boost: 3, accel: 14, damping: 8,
    look: 'drag', lookButton: 0, worldUp: true, fov: 75, near: 0.1, far: 200,
});
const BOUNDS = { x: [-29, 29], y: [-3, 12], z: [-9, 9] };

// ── Zones ────────────────────────────────────────────────────────────────

/** 'cave' | 'forest' | 'metal' | 'bridge_cave_forest' | 'bridge_forest_metal'. */
export function zoneAt(x) {
    for (const k in ZONES) if (x >= ZONES[k].minX && x <= ZONES[k].maxX) return k;
    if (x > ZONES.cave.maxX && x < ZONES.forest.minX) return 'bridge_cave_forest';
    if (x > ZONES.forest.maxX && x < ZONES.metal.minX) return 'bridge_forest_metal';
    return 'forest';
}

/** Bus weights {cave, forest, metal} for x: 1 inside a room, linear across a bridge. */
export function zoneWeights(x) {
    const w = { cave: 0, forest: 0, metal: 0 };
    if (x <= -12) w.cave = 1;
    else if (x <= -8) { const t = (x + 12) / 4; w.cave = 1 - t; w.forest = t; }
    else if (x <= 8) w.forest = 1;
    else if (x <= 12) { const t = (x - 8) / 4; w.forest = 1 - t; w.metal = t; }
    else w.metal = 1;
    return w;
}

const MATERIAL = { bridge_cave_forest: 'cave', bridge_forest_metal: 'metal' };
const ZONE_TINT = { bridge_cave_forest: '#7799aa', bridge_forest_metal: '#99bbaa' };

function zoneLabel(zone) {
    return ZONES[zone] ? ZONES[zone].label
        : zone.replace('bridge_', 'Bridge: ').replace('_', ' / ');
}

// ── Occlusion ────────────────────────────────────────────────────────────

const occluderIds = new Set();
for (const n of world.occluders) occluderIds.add(n.id);

/**
 * Distinct occluders between `from` and `to`. scene.raycast returns only the
 * first hit, so walk the segment: step just past each hit and cast again,
 * counting a wall once even when the ray exits through its far face.
 */
export function occludersBetween(from, to) {
    let dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.1) return 0;
    dx /= dist; dy /= dist; dz /= dist;
    const dir = [dx, dy, dz], seen = new Set();
    let o = from.slice(), travelled = 0;
    for (let i = 0; i < 16; i++) {
        const hit = scene.raycast(o, dir);
        if (!hit || travelled + hit.distance >= dist) break;
        if (hit.node && occluderIds.has(hit.node.id)) seen.add(hit.node.id);
        const step = hit.distance + 0.02;
        travelled += step;
        o = [o[0] + dx * step, o[1] + dy * step, o[2] + dz * step];
    }
    return seen.size;
}

const occlusion = {};   // key -> { hits, factor }
function updateOcclusion(listener) {
    for (const src of snd.sources) {
        const hits = occludersBetween(listener, src.pos);
        const factor = hits ? Math.max(0.05, 1 - hits * 0.6) : 1;
        occlusion[src.key] = { hits, factor };
        ctx.setVoiceGain(src.voice, src.baseGain * factor);
    }
}

// ── Head model panel ─────────────────────────────────────────────────────

const head = {
    enabled: true, ild: 0.85, behind: 0.45, nearFront: 18000, nearBehind: 2000,
    farRatio: 0.95, elevNear: 5000, elevFar: 2000, minCut: 200, maxCut: 20000,
};
const hz = (v) => Math.round(v) + ' Hz';
function applyHead(key) {
    const all = key == null;
    if (all || key === 'enabled') ctx.setHeadModelEnabled(head.enabled);
    if (all || key === 'ild') ctx.setHeadModelIldStrength(head.ild);
    if (all || key === 'behind') ctx.setHeadModelBehindAttenuation(head.behind);
    if (all || key === 'nearFront' || key === 'nearBehind') ctx.setHeadModelNearCutoff(head.nearFront, head.nearBehind);
    if (all || key === 'farRatio') ctx.setHeadModelFarCutoffRatio(head.farRatio);
    if (all || key === 'elevNear' || key === 'elevFar') ctx.setHeadModelElevation(head.elevNear, head.elevFar);
    if (all || key === 'minCut' || key === 'maxCut') ctx.setHeadModelCutoffRange(head.minCut, head.maxCut);
}
const headPanel = params('#headParams', head, {
    enabled:    { label: 'enabled' },
    ild:        { label: 'ILD strength', min: 0, max: 1, step: 0.01, hint: 'interaural level difference' },
    behind:     { label: 'behind atten', min: 0, max: 1, step: 0.01 },
    nearFront:  { label: 'near front', min: 500, max: 20000, step: 100, fmt: hz, hint: 'near-ear cutoff, source in front' },
    nearBehind: { label: 'near behind', min: 200, max: 10000, step: 100, fmt: hz, hint: 'near-ear cutoff, source behind' },
    farRatio:   { label: 'far shadow', min: 0, max: 1, step: 0.01, hint: 'far-ear cutoff ratio' },
    elevNear:   { label: 'elev near', min: 0, max: 10000, step: 100, fmt: hz },
    elevFar:    { label: 'elev far', min: 0, max: 10000, step: 100, fmt: hz },
    minCut:     { label: 'min cutoff', min: 50, max: 2000, step: 50, fmt: hz },
    maxCut:     { label: 'max cutoff', min: 5000, max: 22000, step: 100, fmt: hz },
}, { onChange: (key) => applyHead(key) });
applyHead();

const panel = document.getElementById('panel');
const panelToggle = document.getElementById('panelToggle');
let panelVisible = true;
function showPanel(on) {
    panelVisible = on;
    panel.style.display = on ? '' : 'none';
    panelToggle.style.display = on ? 'none' : 'block';
}
document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'h' || e.key === 'H') showPanel(!panelVisible);
});
panelToggle.addEventListener('click', () => showPanel(true));

// ── HUD: zone, position, bus mix, occlusion list ─────────────────────────

const zoneEl = document.getElementById('zoneLabel');
const posEl = document.getElementById('posLabel');
const busKeys = ['cave', 'forest', 'metal'];
const mix = { muted: {}, solo: null };
const strips = mixerStrips('#busStrips', busKeys.map((k) => ({ key: k, label: k })), {
    onMute: (k) => { mix.muted[k] = !mix.muted[k]; strips.paint(k, { muted: mix.muted[k] }); },
    onSolo: (k) => {
        mix.solo = mix.solo === k ? null : k;
        for (const b of busKeys) strips.paint(b, { solo: mix.solo === b });
    },
    level: (k) => Math.max(ctx.getBusRmsL(snd.buses[k]), ctx.getBusRmsR(snd.buses[k])),
});
const gainRow = h('div', null, h('span', null, 'gains'), h('b'));
document.getElementById('busStrips').appendChild(h('div.k-kv', null, gainRow));

const occEl = document.getElementById('occList');
const occRows = {};
for (const src of snd.sources) {
    const b = h('b', null, '—');
    occRows[src.key] = { row: h('div', null, h('span', null, src.key), b), b };
    occEl.appendChild(occRows[src.key].row);
}

function paintHud(zone, pos, gains) {
    const label = zoneLabel(zone);
    if (zoneEl.textContent !== label) {
        zoneEl.textContent = label;
        zoneEl.style.color = ZONES[zone] ? ZONES[zone].tint : (ZONE_TINT[zone] || '#fff');
    }
    posEl.textContent = pos.map((v) => v.toFixed(1)).join(', ');
    gainRow.lastChild.textContent = busKeys.map((k) => gains[k].toFixed(2)).join(' / ');
    for (const key in occRows) {
        const o = occlusion[key];
        if (!o) continue;
        occRows[key].b.textContent = o.hits ? o.hits + ' wall' + (o.hits > 1 ? 's' : '') + ' ×' + o.factor.toFixed(2) : 'clear';
        occRows[key].row.classList.toggle('hit', o.hits > 0);
    }
    strips.update();
}

// ── Frame loop ───────────────────────────────────────────────────────────

const clamp = (v, r) => Math.max(r[0], Math.min(r[1], v));
const state = { frame: 0, t: 0, zone: 'forest', gains: zoneWeights(0), moving: false, autoTick: true };

function tick(dt) {
    state.frame++;
    state.t += dt;
    const t = state.t;
    const view = fly.update(dt);
    const p = fly.cam.pos;
    p[0] = clamp(p[0], BOUNDS.x); p[1] = clamp(p[1], BOUNDS.y); p[2] = clamp(p[2], BOUNDS.z);
    view.position = p.slice();   // the view was taken before the clamp
    scene.setCamera(view);

    const zone = zoneAt(p[0]);
    const w = zoneWeights(p[0]);
    for (const k of busKeys) {
        const audible = !mix.muted[k] && (!mix.solo || mix.solo === k);
        w[k] = audible ? w[k] : 0;
        ctx.setBusGain(snd.buses[k], w[k]);
    }
    state.zone = zone; state.gains = w;

    const f = fly.forward();
    ctx.setListenerPosition(p[0], p[1], p[2]);
    ctx.setListenerOrientation(f[0], f[1], f[2], 0, 1, 0);

    const v = fly.cam.vel;
    state.moving = Math.hypot(v[0], v[1], v[2]) > 0.3;
    if (state.moving) shots.footstep(MATERIAL[zone] || zone);
    shots.drip();
    shots.bubble();

    // Wind: sweep the lowpass for an organic gusting feel.
    const wp = t * 1.2;
    ctx.setVoiceFilterFrequency(snd.wind, 600 + Math.sin(wp) * 300 + Math.sin(wp * 0.3) * 200);

    if (state.frame % 3 === 0) updateOcclusion(p);

    // Pulse the emitter markers, flicker the torch, breathe the sky light,
    // wobble the water.
    const s = 0.8 + Math.sin(t * 3) * 0.2;
    for (const m of world.markers) m.setScale(s, s, s);
    world.caveTorch.intensity = 2.5 + Math.sin(t * 7.8) * 0.8 + Math.sin(t * 22.2) * 0.5;
    world.skyLight.intensity = 2.5 + Math.sin(t * 1.8) * 0.8;
    world.water.y = -2 + Math.sin(t * 1.2) * 0.05;

    if (state.frame % 5 === 0) paintHud(zone, p, w);
}

const loop = frameLoop((dt) => { if (state.autoTick) tick(dt); });

/** Test seam: the live pieces, plus a manual step for deterministic runs. */
export const lab = {
    scene, ctx, snd, shots, fly, world, state, occlusion, head, headPanel, mix, strips, loop,
    tick, updateOcclusion, get panelVisible() { return panelVisible; }, showPanel,
};
