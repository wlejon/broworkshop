// Pegbounce physics on the engine's Jolt, through sandbox worlds
// (Physics.createWorldHandle): the live shot and the Mirage prediction each
// get their own body space, and the live world is stepped by hand so slow-mo
// is just a scaled dt.
//
// Pegbounce thinks in canvas pixels (Y down); Jolt is Y up, so Y flips at
// the boundary and bodies sit at z = 0 with dofs "2d". Gravity is in px/s².
//
// A world is plain data: pegs[] (x, y, type, lit, removed, body tag),
// ball + extraBalls (records synced from Jolt each step), catchbar, walls,
// pulses (Pulsewave shock fronts) and scoreEvents, the queue Round drains:
//   { kind: "peg-hit", peg, fire? } | "wall-hit" | "catchbar-hit" | "ball-exit"

import { seededRandom } from "/lib/arcade/grid.js";

// Captured under its own name: this module also exports a `Physics`.
const Jolt = globalThis.Physics;
if (!Jolt || typeof Jolt.createWorldHandle !== "function") {
    throw new Error("pegbounce: engine Physics.createWorldHandle missing");
}

// ── Tunables ──────────────────────────────────────────────────────────────

const PEG = { BLUE: "blue", ORANGE: "orange", GREEN: "green", PURPLE: "purple" };
const PEG_RADIUS = 9;
const BALL_RADIUS = 9;
const GRAVITY = 1400;
const MAX_SPEED = 1800;
const LAUNCH_SPEED_CAP = 1200;
const FIRE_RADIUS = 40;

const BALL_BODY = { friction: 0.02, restitution: 0.78, linearDamping: 0 };
const PEG_BODY = { friction: 0.02, restitution: 0.78 };
const WALL_BODY = { friction: 0, restitution: 0.62 };
const CATCHBAR_BODY = { friction: 0, restitution: 0.95 };

const FIELD_W = 1024;
const FIELD_H = 768;
const FIELD_TOP = 56;
const FIELD_BOTTOM = FIELD_H;
const CATCHBAR_Y = FIELD_H - 36;
const CATCHBAR_H = 14;
const CATCHBAR_HALFW = 72;

// Left, right and top walls; the bottom is open so the ball exits. The top
// wall sits at the canvas edge, not FIELD_TOP: the muzzle is above FIELD_TOP
// for shallow angles and a ball spawned inside the wall jitters in place.
const WALLS = [
    { cx: -10, cy: FIELD_H / 2, hw: 10, hh: FIELD_H },
    { cx: FIELD_W + 10, cy: FIELD_H / 2, hw: 10, hh: FIELD_H },
    { cx: FIELD_W / 2, cy: 15, hw: FIELD_W, hh: 10 },
];

const flipY = (y) => FIELD_H - y;   // canvas <-> Jolt, its own inverse

// ── World ─────────────────────────────────────────────────────────────────

function newHandle() {
    return Jolt.createWorldHandle({ maxBodies: 1024, gravity: { x: 0, y: -GRAVITY, z: 0 } });
}

function createWorld(seed) {
    const w = {
        handle: newHandle(),
        pegs: [],
        ball: null,
        extraBalls: [],
        catchbar: null,
        walls: [],
        pulses: [],
        tagToPeg: new Map(),
        ballTags: new Set(),
        time: 0,
        slowmo: 0,
        scoreEvents: [],
        shotIndex: 0,
        caughtThisShot: false,
        feverBlasted: false,
        mirageNextShot: false,
        rng: seededRandom(seed || 1),
        pendingDestroy: [],
        destroyed: false,
    };
    for (const s of WALLS) w.walls.push(addWallBody(w.handle, s));
    addCatchbar(w);
    return w;
}

function addWallBody(handle, s) {
    return handle.createBody(Object.assign({
        shape: "box",
        static: true,
        position: { x: s.cx, y: flipY(s.cy), z: 0 },
        halfExtents: { x: s.hw, y: s.hh, z: 10 },
    }, WALL_BODY));
}

/** A kinematic bar sliding along the bottom: land on it for a free ball. */
function addCatchbar(w) {
    const cb = { x: FIELD_W * 0.5, vx: 180, y: CATCHBAR_Y, halfW: CATCHBAR_HALFW, body: 0 };
    cb.body = w.handle.createBody(Object.assign({
        shape: "box",
        position: { x: cb.x, y: flipY(cb.y + CATCHBAR_H / 2), z: 0 },
        halfExtents: { x: cb.halfW, y: CATCHBAR_H / 2, z: 10 },
        dofs: "2d",
    }, CATCHBAR_BODY));
    w.handle.setKinematic(cb.body);
    w.catchbar = cb;
}

function destroyWorld(w) {
    if (!w || w.destroyed) return;
    w.destroyed = true;
    try { w.handle.destroy(); } catch (e) { /* already gone */ }
    w.handle = null;
    w.tagToPeg.clear();
    w.ballTags.clear();
}

// ── Pegs ──────────────────────────────────────────────────────────────────

function pegBody(w, x, y, kinematic) {
    const def = Object.assign({ shape: "sphere", position: { x, y: flipY(y), z: 0 }, radius: PEG_RADIUS }, PEG_BODY);
    if (kinematic) def.dofs = "2d";
    else def.static = true;
    const tag = w.handle.createBody(def);
    if (kinematic) w.handle.setKinematic(tag);
    return tag;
}

function addPeg(w, x, y, type) {
    const peg = { x, y, type, lit: false, removed: false, kind: "static", phase: w.rng() * Math.PI * 2, body: 0 };
    peg.body = pegBody(w, x, y, false);
    w.pegs.push(peg);
    w.tagToPeg.set(peg.body, peg);
    return peg;
}

/** mode "orbit" { radius, speed } or "oscillate" { amp, axis: "x"|"y", speed }. */
function addMovingPeg(w, x, y, type, mode, params) {
    const peg = {
        x, y, type, lit: false, removed: false,
        kind: "moving", mode, ox: x, oy: y, params,
        phase: w.rng() * Math.PI * 2, body: 0,
    };
    peg.body = pegBody(w, x, y, true);
    w.pegs.push(peg);
    w.tagToPeg.set(peg.body, peg);
    return peg;
}

function movePegs(w, dt) {
    for (const p of w.pegs) {
        if (p.kind !== "moving" || p.removed) continue;
        const t = w.time * p.params.speed + p.phase;
        if (p.mode === "orbit") {
            p.x = p.ox + Math.cos(t) * p.params.radius;
            p.y = p.oy + Math.sin(t) * p.params.radius;
        } else if (p.params.axis === "x") {
            p.x = p.ox + Math.sin(t) * p.params.amp;
        } else {
            p.y = p.oy + Math.sin(t) * p.params.amp;
        }
        w.handle.moveKinematic(p.body, p.x, flipY(p.y), 0, dt || 1 / 60);
    }
}

/** Mark every peg named in this frame's hit events as lit. */
function markLitFromEvents(w, events) {
    for (const ev of events) {
        if (ev.kind === "peg-hit" && !ev.peg.lit && !ev.peg.removed) ev.peg.lit = true;
    }
}

/** Remove lit pegs (end of shot); returns them. */
function sweepLit(w) {
    const removed = [];
    for (const p of w.pegs) {
        if (!p.lit || p.removed) continue;
        p.removed = true;
        removed.push(p);
        if (p.body) {
            w.tagToPeg.delete(p.body);
            if (!w.destroyed) w.handle.destroyBody(p.body);
            p.body = 0;
        }
    }
    return removed;
}

function countRemainingOrange(w) {
    let n = 0;
    for (const p of w.pegs) if (p.type === PEG.ORANGE && !p.removed && !p.lit) n++;
    return n;
}

// ── Balls ─────────────────────────────────────────────────────────────────

function ballBody(handle, x, y, vx, vy) {
    const tag = handle.createBody(Object.assign({
        shape: "sphere",
        position: { x, y: flipY(y), z: 0 },
        radius: BALL_RADIUS,
        // Jolt's default max linear velocity (500) would cap a px/s ball.
        maxLinearVelocity: MAX_SPEED + 200,
        dofs: "2d",
        ccd: true,
    }, BALL_BODY));
    handle.setLinearVelocity(tag, vx, -vy, 0);
    return tag;
}

function addBall(w, x, y, vx, vy, extra) {
    const rec = Object.assign({ x, y, vx, vy, active: true, radius: BALL_RADIUS, onFire: false, body: 0 }, extra);
    rec.body = ballBody(w.handle, x, y, vx, vy);
    w.ballTags.add(rec.body);
    return rec;
}

function dropBall(w, b) {
    if (!b.body) return;
    w.handle.destroyBody(b.body);
    w.ballTags.delete(b.body);
    b.body = 0;
}

function launchBall(w, angle, speed, x, y) {
    if (w.ball) dropBall(w, w.ball);
    for (const eb of w.extraBalls) dropBall(w, eb);
    w.extraBalls.length = 0;

    const sp = Math.min(speed, LAUNCH_SPEED_CAP);
    w.ball = addBall(w, x, y, Math.cos(angle) * sp, Math.sin(angle) * sp);
    w.pulses.length = 0;
    w.time = 0;
    w.slowmo = 0;
    w.shotIndex++;
    w.feverBlasted = false;
    w.caughtThisShot = false;
}

/** Orbital: two short-lived echoes fanned off the main ball. */
function spawnSplitBalls(w) {
    const main = w.ball;
    if (!main) return;
    const sp = Math.hypot(main.vx, main.vy);
    const base = Math.atan2(main.vy, main.vx);
    for (const side of [-1, 1]) {
        const a = base + side * 0.35;
        w.extraBalls.push(addBall(w, main.x, main.y, Math.cos(a) * sp, Math.sin(a) * sp,
            { onFire: main.onFire, split: true, life: 1.2 }));
    }
}

/** Set a ball's velocity (px/s, canvas axes). */
function nudgeBall(w, b, vx, vy) {
    if (b.body) w.handle.setLinearVelocity(b.body, vx, -vy, 0);
    b.vx = vx;
    b.vy = vy;
}

function activeBalls(w) {
    const out = [];
    if (w.ball && w.ball.active) out.push(w.ball);
    for (const eb of w.extraBalls) if (eb.active) out.push(eb);
    return out;
}

function hasActiveBall(w) {
    return activeBalls(w).length > 0;
}

// ── Step ──────────────────────────────────────────────────────────────────

function step(w, dt) {
    if (w.destroyed) return;
    if (w.slowmo > 0) {
        w.slowmo -= dt;
        dt *= 0.35;
    }
    w.time += dt;

    stepPulses(w, dt);
    movePegs(w, dt);
    stepCatchbar(w, dt);

    // Sub-step to 1/120 s so fast balls do not tunnel (CCD helps too). Each
    // step() replaces the unread contact list, so drain after every one.
    const subs = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < subs; i++) {
        w.handle.step(dt / subs);
        drainContacts(w);
    }

    for (const b of activeBalls(w)) {
        capSpeed(w, b);
        syncBall(w, b);
    }
    checkExits(w);
    ageSplits(w, dt);
    burnAround(w);

    if (w.pendingDestroy.length) {
        for (const tag of w.pendingDestroy) w.handle.destroyBody(tag);
        w.pendingDestroy.length = 0;
    }
}

/** Pulsewave fronts light pegs in distance order as the ring passes them. */
function stepPulses(w, dt) {
    for (let i = w.pulses.length - 1; i >= 0; i--) {
        const pw = w.pulses[i];
        pw.age += dt;
        const front = Math.min(1, pw.age / pw.duration) * pw.R;
        while (pw.queue.length && pw.queue[0].dist <= front) {
            const peg = pw.queue.shift().peg;
            if (!peg.removed && !peg.lit) w.scoreEvents.push({ kind: "peg-hit", peg });
        }
        if (pw.age >= pw.duration && !pw.queue.length) w.pulses.splice(i, 1);
    }
}

function stepCatchbar(w, dt) {
    const cb = w.catchbar;
    cb.x += cb.vx * dt;
    if (cb.x - cb.halfW < 0) { cb.x = cb.halfW; cb.vx = Math.abs(cb.vx); }
    if (cb.x + cb.halfW > FIELD_W) { cb.x = FIELD_W - cb.halfW; cb.vx = -Math.abs(cb.vx); }
    w.handle.moveKinematic(cb.body, cb.x, flipY(cb.y + CATCHBAR_H / 2), 0, dt || 1 / 60);
}

function capSpeed(w, b) {
    const v = w.handle.getVelocity(b.body);
    if (!v) return;
    const sp = Math.hypot(v.linear.x, v.linear.y);
    if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        w.handle.setLinearVelocity(b.body, v.linear.x * k, v.linear.y * k, 0);
    }
}

function syncBall(w, b) {
    const xf = w.handle.getTransform(b.body);
    const v = w.handle.getVelocity(b.body);
    if (xf) { b.x = xf.position.x; b.y = flipY(xf.position.y); }
    if (v) { b.vx = v.linear.x; b.vy = -v.linear.y; }
}

function drainContacts(w) {
    for (const e of w.handle.getContacts()) {
        if (e.type !== "added") continue;
        const aBall = w.ballTags.has(e.body1);
        if (!aBall && !w.ballTags.has(e.body2)) continue;
        const other = aBall ? e.body2 : e.body1;
        const peg = w.tagToPeg.get(other);
        if (peg) {
            if (!peg.removed) w.scoreEvents.push({ kind: "peg-hit", peg });
        } else if (other === w.catchbar.body) {
            w.scoreEvents.push({ kind: "catchbar-hit" });
        } else if (w.walls.includes(other)) {
            w.scoreEvents.push({ kind: "wall-hit" });
        }
    }
}

function checkExits(w) {
    for (const b of activeBalls(w)) {
        if (b.y - b.radius <= FIELD_BOTTOM) continue;
        b.active = false;
        w.scoreEvents.push({ kind: "ball-exit", ball: b });
        // Destroy after the step so no in-flight contact names a freed tag.
        w.pendingDestroy.push(b.body);
        w.ballTags.delete(b.body);
        b.body = 0;
    }
}

function ageSplits(w, dt) {
    for (let i = w.extraBalls.length - 1; i >= 0; i--) {
        const eb = w.extraBalls[i];
        eb.life -= dt;
        if (eb.life <= 0 || !eb.active) {
            dropBall(w, eb);
            w.extraBalls.splice(i, 1);
        }
    }
}

/** Terraflame: every peg inside a burning ball's aura is hit. */
function burnAround(w) {
    const rr = FIRE_RADIUS * FIRE_RADIUS;
    for (const b of activeBalls(w)) {
        if (!b.onFire) continue;
        for (const peg of w.pegs) {
            if (peg.removed || peg.lit) continue;
            const dx = peg.x - b.x, dy = peg.y - b.y;
            if (dx * dx + dy * dy < rr) w.scoreEvents.push({ kind: "peg-hit", peg, fire: true });
        }
    }
}

// ── Predict (Mirage) ──────────────────────────────────────────────────────

let predictHandle = null;

/**
 * Fly a ghost ball through a copy of the world's walls and pegs (no
 * catchbar, no scoring) and push up to ~80 {x, y} samples into `out`.
 * Uses one shared sandbox, rebuilt per call; never touches `w`.
 */
function predict(w, angle, speed, x, y, seconds, out) {
    if (!predictHandle) predictHandle = newHandle();
    const h = predictHandle;
    h.destroyAll();
    for (const s of WALLS) addWallBody(h, s);
    for (const p of w.pegs) {
        if (p.removed) continue;
        h.createBody(Object.assign({
            shape: "sphere", static: true,
            position: { x: p.x, y: flipY(p.y), z: 0 }, radius: PEG_RADIUS,
        }, PEG_BODY));
    }
    const sp = Math.min(speed, LAUNCH_SPEED_CAP);
    const ghost = ballBody(h, x, y, Math.cos(angle) * sp, Math.sin(angle) * sp);

    const dt = 1 / 120;
    const steps = Math.floor(seconds / dt);
    const stride = Math.max(1, Math.floor(steps / 80));
    for (let i = 0; i < steps; i++) {
        h.step(dt);
        if (i % stride) continue;
        const xf = h.getTransform(ghost);
        if (!xf) break;
        const py = flipY(xf.position.y);
        out.push({ x: xf.position.x, y: py });
        if (py - BALL_RADIUS > FIELD_BOTTOM) break;
    }
}

export const Physics = {
    createWorld, destroyWorld,
    addPeg, addMovingPeg,
    launchBall, spawnSplitBalls, nudgeBall,
    step, markLitFromEvents, sweepLit,
    hasActiveBall, activeBalls, countRemainingOrange,
    predict,
    PEG, PEG_RADIUS, BALL_RADIUS,
    FIELD_W, FIELD_H, FIELD_TOP, FIELD_BOTTOM,
    CATCHBAR_Y, CATCHBAR_H, CATCHBAR_HALFW,
};
