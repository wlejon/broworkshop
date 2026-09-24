// lab.js — NavMesh carving & links: the scene, the moving parts, the overlays
// and the frame loop. hud.js wires the DOM; tests import this directly.
//
//   level.js     the arena, obstacle boxes, link endpoints, destinations
//   nav.js       the tiled bake and setObstacle (carve / restore)
//   plan.js      routes over navmesh walks + ladder / jump / lift
//   elevator.js  the lift's request queue
//   agents.js    walkers and their link state machine
//
// The gate, bridge and barricade each animate their visual and carve or
// restore their navmesh box at the physically honest moment: a closing gate
// or retracting bridge blocks at once; an opening one only when it is clear.

import { sceneViewport, orbitRotation, localPoint } from "/lib/kit/viewport3d.js";
import { fixedStep } from "/lib/kit/ui.js";
import { walkableOverlay, ribbon, linkBeads, pickSurface } from "/lib/kit/nav3d.js";
import { buildLevel, buildLights, OBSTACLES, LINKS, SHAFT, FLOOR_Y, BRIDGE, SPAWN, TARGETS } from "/app/level.js";
import { navState, bake, setObstacle, overlayOpts, generation, AGENT_RADIUS } from "/app/nav.js";
import { polylineOf } from "/app/plan.js";
import { lift, tickLift } from "/app/elevator.js";
import { agentState, createAgentWorld, spawnSquad, spawnAgent, sendAll, tickAgents } from "/app/agents.js";

export const lab = { vp: null, scene: null, levelNodes: [], frames: 0 };

/** Toggle targets and their animation progress (1 = open / extended / present). */
export const doors = {
    gate:      { open: false, p: 0 },
    bridge:    { open: true, p: 1 },
    barricade: { open: true, p: 1 },   // "open" here = present
};

export const view = { overlay: true, paths: true, links: true, walkableSamples: 0 };

const listeners = {};
export function on(ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); }
function emit(ev, arg) { for (const fn of listeners[ev] || []) fn(arg); }

let gateNode, crateNodes = [], bridgeNode, carNode, carGlow = null, overlayNode = null, drawnGen = -1;
const footprints = {};         // obstacle name -> red plate
let beadNodes = [];
const ribbons = new Map();     // agent id -> { plan, node }

export function startLab(canvas) {
    const vp = sceneViewport(canvas, {
        orbit: { target: [0, 2.2, -0.5], dist: 27, fov: 50, near: 0.1, far: 300, rot: orbitRotation(0.5, -0.62) },
        controls: { minDist: 4 },
    });
    Object.assign(lab, { vp, scene: vp.scene });
    const scene = vp.scene;
    lab.levelNodes = buildLevel(scene);
    buildLights(scene);
    bridgeNode = lab.levelNodes.find((e) => e.slab.name === 'bridge').node;
    buildMovers(scene);
    bake();
    // Boot state: gate shut, barricade across the ramp, bridge out.
    setObstacle('gate', true);
    setObstacle('barricade', true);
    drawLinks();
    createAgentWorld(scene);
    spawnSquad(5, SPAWN);
    sendAll(TARGETS.mezz);

    vp.canvas.addEventListener('mousedown', onPick);
    const step = fixedStep(1 / 60);
    vp.onFrame((dt) => {
        step(dt, (h) => { tickLift(h); animate(h); tickAgents(h); });
        syncVisuals();
        if (++lab.frames % 15 === 0) emit('tick');
    });
    syncVisuals();
    return lab;
}

// --- moving parts ----------------------------------------------------------------------

function box(scene, name, o, color, emissive) {
    return scene.createMesh({ name, mesh: 'box', halfW: o.hx, halfH: o.hy, halfD: o.hz, x: o.x, y: o.base + o.hy, z: o.z,
        color, roughness: 0.5, emissive: emissive || 0.25, emissiveColor: color });
}

function buildMovers(scene) {
    const g = OBSTACLES.gate;
    gateNode = box(scene, 'gate', { ...g, hz: 0.18 }, g.color, 0.4);
    const b = OBSTACLES.barricade;
    for (let i = 0; i < 3; i++) {
        crateNodes.push(box(scene, `crate.${i}`, { x: b.x - b.hx + 0.5 + i * (b.hx - 0.5), base: 0, z: b.z + (i % 2 ? 0.5 : -0.5), hx: 0.5, hy: 0.5 + (i % 2) * 0.1, hz: 0.5 }, b.color, 0.2));
    }
    carNode = box(scene, 'lift.car', { x: SHAFT.x, base: -0.12, z: SHAFT.z, hx: SHAFT.half, hy: 0.06, hz: SHAFT.half }, '#5ad2f4', 0.6);
    for (const name in OBSTACLES) {
        const o = OBSTACLES[name];
        const plate = box(scene, `carve.${name}`, { x: o.x, base: o.base + 0.03, z: o.z, hx: o.hx + AGENT_RADIUS, hy: 0.015, hz: o.hz + AGENT_RADIUS }, '#ff4060', 1.4);
        plate.castsShadow = false;
        footprints[name] = plate;
    }
}

/** Flip a door. Returns the new target state. */
export function toggle(name) {
    const d = doors[name];
    d.open = !d.open;
    // Block at once when the obstruction arrives; carving is released in animate().
    if (name === 'gate' && !d.open) setObstacle('gate', true);
    if (name === 'bridge' && !d.open) setObstacle('bridge', true);
    if (name === 'barricade') { setObstacle('barricade', d.open); d.p = d.open ? 1 : 0; }
    emit('doors', name);
    return d.open;
}

export function setDoor(name, open) {
    if (doors[name].open !== !!open) toggle(name);
}

function animate(h) {
    for (const name of ['gate', 'bridge']) {
        const d = doors[name];
        const target = d.open ? 1 : 0;
        d.p += Math.sign(target - d.p) * Math.min(Math.abs(target - d.p), h * 1.6);
        // Clear: the gate fully aside, the bridge fully out.
        if (d.p === target && d.open) setObstacle(name, false);
    }
}

function syncVisuals() {
    const g = OBSTACLES.gate;
    gateNode.x = g.x - doors.gate.p * (g.hx * 2 + 0.2);
    const bp = Math.max(0.001, doors.bridge.p), len = BRIDGE.x1 - BRIDGE.x0;
    bridgeNode.scaleX = bp;
    bridgeNode.x = BRIDGE.x0 + len * bp / 2;
    for (const c of crateNodes) c.visible = doors.barricade.open;
    carNode.y = lift.y - 0.06;
    const glow = lift.door > 0.5;   // the car lights up while its doors are open
    if (glow !== carGlow) { carGlow = glow; carNode.setMaterial({ emissive: glow ? 2.2 : 0.5 }); }
    for (const name in footprints) footprints[name].visible = view.overlay && !!navState.handles[name];
    if (generation() !== drawnGen) drawOverlay();
    syncRibbons();
}

// --- overlays ---------------------------------------------------------------------------

function drawOverlay() {
    if (overlayNode) overlayNode.destroy();
    const r = walkableOverlay(lab.scene, navState.mesh, { ...overlayOpts, look: { color: [0.25, 0.8, 0.95, 1], emissiveColor: [0.12, 0.55, 0.7], emissive: 0.8 } });
    overlayNode = r.node;
    view.walkableSamples = r.samples;
    if (overlayNode) overlayNode.visible = view.overlay;
    drawnGen = generation();
    emit('surface', drawnGen);
}

function drawLinks() {
    for (const n of beadNodes) n.destroy();
    beadNodes = [];
    for (const def of LINKS) beadNodes.push(...linkBeads(lab.scene, def, { name: def.id }));
    const shaft = { kind: 'elevator', color: '#5ad2f4', start: { x: SHAFT.x, y: FLOOR_Y[0], z: SHAFT.z }, end: { x: SHAFT.x, y: FLOOR_Y[2], z: SHAFT.z } };
    beadNodes.push(...linkBeads(lab.scene, shaft, { name: 'lift', beads: 12 }));
    for (const n of beadNodes) n.visible = view.links;
}

function syncRibbons() {
    const live = new Set();
    for (const rec of agentState.agents) {
        live.add(rec.id);
        const r = ribbons.get(rec.id);
        if (r && r.plan === rec.plan && r.shown === view.paths) continue;
        if (r && r.node) r.node.destroy();
        const pts = view.paths && rec.plan ? polylineOf(rec.plan) : null;
        const node = pts ? ribbon(lab.scene, pts, { name: `route.${rec.id}`, width: 0.13, lift: 0.12, color: hexRgba(rec.color), emissive: 1.6 }) : null;
        ribbons.set(rec.id, { plan: rec.plan, node, shown: view.paths });
    }
    for (const [id, r] of ribbons) if (!live.has(id)) { if (r.node) r.node.destroy(); ribbons.delete(id); }
}

function hexRgba(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
}

export function setView(key, on) {
    view[key] = !!on;
    if (key === 'overlay' && overlayNode) overlayNode.visible = view.overlay;
    if (key === 'links') for (const n of beadNodes) n.visible = view.links;
    syncVisuals();
}

// --- picking ----------------------------------------------------------------------------

/** The walkable point under a canvas-local pixel. */
export function pickLevel(lx, ly) {
    return pickSurface(lab.vp, lx, ly, { mesh: navState.mesh, extents: { x: 1.5, y: 1.5, z: 1.5 } });
}

// Click: send everyone there. Shift-click: spawn one there.
function onPick(e) {
    if (e.button !== 0) return;
    const [lx, ly] = localPoint(lab.vp.canvas, e);
    const p = pickLevel(lx, ly);
    if (!p) return;
    if (e.shiftKey) spawnAgent(p);
    else sendAll(p);
    emit('pick', p);
}
