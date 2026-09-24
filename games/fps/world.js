// world.js — the FPS Arena scene: arena geometry, remote players, cameras.
//
// Built once per process (scene nodes outlive a connection); remote player
// capsules come and go with the server's roster. Remotes are drawn
// INTERP_DELAY ms in the past, interpolated between the two snapshots that
// straddle that moment.

import {
    ARENA_HALF, WALL_H, WALL_THICK, PLAYER_RADIUS, EYE_HEIGHT, OBSTACLES, PLAYER_COLORS,
    forward, angleDelta,
} from "/app/arena.js";

const INTERP_DELAY = 100;       // ms behind the newest snapshot
const BODY_Y = 0.9;             // capsule centre standing
const DEAD_Y = 0.2;             // ...and lying down

let canvas = null;
let scene = null;
const bodies = new Map();       // remote id → { node, color }
let nextColor = 0;

/** The scene context on #view, the arena built into it. Idempotent. */
export function ensureWorld() {
    if (scene) return scene;
    const view = document.getElementById("view");
    const ctx = view && view.getContext("scene");
    if (!ctx) throw new Error(view ? "fps: scene context unavailable" : "fps: #view canvas missing");
    canvas = view;
    scene = ctx;
    const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    };
    window.addEventListener("resize", resize);
    resize();
    buildArena();
    return scene;
}

export function viewCanvas() {
    return canvas;
}

function box(x, y, z, hw, hh, hd, color) {
    scene.createMesh({ mesh: "box", halfW: hw, halfH: hh, halfD: hd, x, y, z, color });
}

function buildArena() {
    scene.createMesh({ mesh: "plane", halfW: ARENA_HALF, halfD: ARENA_HALF, x: 0, y: 0, z: 0, color: "#2a2a3e" });
    // Walls: the same boxes the server collides against, full height.
    for (const w of [
        { x: 0, z: -ARENA_HALF, hw: ARENA_HALF, hd: WALL_THICK },
        { x: 0, z: ARENA_HALF, hw: ARENA_HALF, hd: WALL_THICK },
        { x: -ARENA_HALF, z: 0, hw: WALL_THICK, hd: ARENA_HALF },
        { x: ARENA_HALF, z: 0, hw: WALL_THICK, hd: ARENA_HALF },
    ]) box(w.x, WALL_H / 2, w.z, w.hw, WALL_H / 2, w.hd, "#3a4a6e");
    for (const o of OBSTACLES) box(o.x, o.hh, o.z, o.hw, o.hh, o.hd, "#4a5a80");
    // Floor grid every 5 m, for a sense of speed.
    for (let i = -ARENA_HALF; i <= ARENA_HALF; i += 5) {
        box(0, 0.01, i, ARENA_HALF, 0.005, 0.02, "#3a3a5e");
        box(i, 0.01, 0, 0.02, 0.005, ARENA_HALF, "#3a3a5e");
    }
}

// ── Remote players ───────────────────────────────────────────────────────

function bodyFor(id) {
    let b = bodies.get(id);
    if (b) return b;
    const color = PLAYER_COLORS[nextColor++ % PLAYER_COLORS.length];
    const node = scene.createMesh({
        mesh: "capsule", radius: PLAYER_RADIUS, halfHeight: 0.5, x: 0, y: BODY_Y, z: 0, color,
    });
    bodies.set(id, b = { node, color });
    return b;
}

function dropBody(id) {
    const b = bodies.get(id);
    if (!b) return;
    scene.destroyNode(b.node);
    bodies.delete(id);
}

/** Remove every remote body (end of a connection). */
export function clearRemotes() {
    for (const id of Array.from(bodies.keys())) dropBody(id);
    nextColor = 0;
}

/**
 * Sync remote bodies to the session's snapshot history: create/remove to
 * match the roster, interpolate positions at now - INTERP_DELAY.
 */
export function updateRemotes(remotes, myId, now) {
    if (!scene) return;
    for (const id of Array.from(bodies.keys())) {
        if (!remotes.has(id) || id === myId) dropBody(id);
    }
    const renderTime = now - INTERP_DELAY;
    for (const [id, r] of remotes) {
        if (id === myId || !r.states.length) continue;
        const node = bodyFor(id).node;
        const s = r.states;
        let i = s.length - 2;
        while (i >= 0 && s[i].t > renderTime) i--;
        const s0 = i >= 0 ? s[i] : null, s1 = i >= 0 ? s[i + 1] : null;
        if (s0 && s1 && s1.t >= renderTime && s1.t > s0.t) {
            const a = (renderTime - s0.t) / (s1.t - s0.t);
            node.x = s0.x + (s1.x - s0.x) * a;
            node.z = s0.z + (s1.z - s0.z) * a;
            node.y = s1.alive ? BODY_Y : DEAD_Y;
            node.rotationY = -(s0.yaw + angleDelta(s0.yaw, s1.yaw) * a);
        } else {
            const last = s[s.length - 1];
            node.x = last.x;
            node.z = last.z;
            node.y = last.alive ? BODY_Y : DEAD_Y;
            node.rotationY = -last.yaw;
        }
        node.visible = true;
    }
}

/** The number of remote bodies in the scene (tests). */
export function remoteCount() {
    return bodies.size;
}

// ── Cameras ──────────────────────────────────────────────────────────────

function aspect() {
    return (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
}

/** First-person view from the local player's eye. */
export function firstPerson(me) {
    if (!scene) return;
    const f = forward(me.yaw, me.pitch);
    scene.setCamera({
        fov: 90, aspect: aspect(), near: 0.1, far: 200,
        position: [me.x, EYE_HEIGHT, me.z],
        target: [me.x + f.x, EYE_HEIGHT + f.y, me.z + f.z],
    });
}

/** A slow orbit over the arena, behind the title menu. t in ms. */
export function overview(t) {
    if (!scene) return;
    const a = t * 0.00008;
    scene.setCamera({
        fov: 55, aspect: aspect(), near: 0.1, far: 200,
        position: [Math.sin(a) * 30, 18, Math.cos(a) * 30],
        target: [0, 0, 0],
    });
}
