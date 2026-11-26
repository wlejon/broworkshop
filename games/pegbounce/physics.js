// Pegbounce physics on bro.dynamics: the live shot and the Mirage prediction
// each get their own world, and the live world is stepped by hand so slow-mo is
// just a scaled dt.
//
// Pegbounce thinks in canvas pixels (Y down); a world is in metres, Y up, so
// at the boundary lengths scale by M (100 px to the metre) and Y flips. Bodies
// sit at z = 0 and the balls are held to that plane. Gravity is in px/s².
//
// A world is plain data: pegs[] (x, y, type, lit, removed, body), ball +
// extraBalls (records synced from the bodies each step), catchbar, walls,
// pulses (Pulsewave shock fronts) and scoreEvents, the queue Round drains:
//   { kind: "peg-hit", peg, fire? } | "wall-hit" | "catchbar-hit" | "ball-exit"
// A record's `body` is null once it has none.

import { seededRandom } from "/lib/arcade/random.js";

if (!bro.dynamics || typeof bro.dynamics.createWorld !== "function") {
    throw new Error("pegbounce: bro.dynamics missing");
}

// ── Tunables ──────────────────────────────────────────────────────────────

const PEG = { BLUE: "blue", ORANGE: "orange", GREEN: "green", PURPLE: "purple" };
const PEG_RADIUS = 9;
const BALL_RADIUS = 9;
const GRAVITY = 1400;
const MAX_SPEED = 1800;
const LAUNCH_SPEED_CAP = 1200;
const FIRE_RADIUS = 40;

const BALL_BODY = { friction: 0.02, restitution: 0.78 };
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

const M = 0.01;                               // metres per pixel
const at = (x, y) => [x * M, (FIELD_H - y) * M, 0];   // canvas point -> world
const yOf = (wy) => FIELD_H - wy / M;         // world y -> canvas y

// ── World ─────────────────────────────────────────────────────────────────

function newDynamics() {
    return bro.dynamics.createWorld({ gravity: [0, -GRAVITY * M, 0] });
}

function createWorld(seed) {
    const w = {
        dyn: newDynamics(),
        pegs: [],
        ball: null,
        extraBalls: [],
        catchbar: null,
        walls: [],
        pulses: [],
        bodyToPeg: new Map(),
        ballBodies: new Set(),
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
    for (const s of WALLS) w.walls.push(addWallBody(w.dyn, s));
    addCatchbar(w);
    return w;
}

function addWallBody(dyn, s) {
    return dyn.addBox({ mass: 0, position: at(s.cx, s.cy), half: [s.hw * M, s.hh * M, 0.1], ...WALL_BODY });
}

/** A kinematic bar sliding along the bottom: land on it for a free ball. */
function addCatchbar(w) {
    const cb = { x: FIELD_W * 0.5, vx: 180, y: CATCHBAR_Y, halfW: CATCHBAR_HALFW, body: null };
    cb.body = w.dyn.addBox({
        kinematic: true,
        position: at(cb.x, cb.y + CATCHBAR_H / 2),
        half: [cb.halfW * M, CATCHBAR_H / 2 * M, 0.1],
        ...CATCHBAR_BODY,
    });
    w.catchbar = cb;
}

function destroyWorld(w) {
    if (!w || w.destroyed) return;
    w.destroyed = true;
    w.dyn.destroy();
    w.dyn = null;
    w.bodyToPeg.clear();
    w.ballBodies.clear();
}

// ── Pegs ──────────────────────────────────────────────────────────────────

function pegBody(dyn, x, y, kinematic) {
    return dyn.addSphere({
        position: at(x, y), radius: PEG_RADIUS * M,
        mass: 0, kinematic: !!kinematic, ...PEG_BODY,
    });
}

function addPeg(w, x, y, type) {
    const peg = { x, y, type, lit: false, removed: false, kind: "static", phase: w.rng() * Math.PI * 2, body: null };
    peg.body = pegBody(w.dyn, x, y, false);
    w.pegs.push(peg);
    w.bodyToPeg.set(peg.body, peg);
    return peg;
}

/** mode "orbit" { radius, speed } or "oscillate" { amp, axis: "x"|"y", speed }. */
function addMovingPeg(w, x, y, type, mode, params) {
    const peg = {
        x, y, type, lit: false, removed: false,
        kind: "moving", mode, ox: x, oy: y, params,
        phase: w.rng() * Math.PI * 2, body: null,
    };
    peg.body = pegBody(w.dyn, x, y, true);
    w.pegs.push(peg);
    w.bodyToPeg.set(peg.body, peg);
    return peg;
}

function moveTo(dyn, body, x, y, dt) {
    const p = at(x, y);
    dyn.moveTo(body, [p[0], p[1], 0, 0, 0, 0, 1], dt || 1 / 60);
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
        moveTo(w.dyn, p.body, p.x, p.y, dt);
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
        if (p.body !== null) {
            w.bodyToPeg.delete(p.body);
            if (!w.destroyed) w.dyn.removeBody(p.body);
            p.body = null;
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

function ballBody(dyn, x, y, vx, vy) {
    return dyn.addSphere({
        position: at(x, y), radius: BALL_RADIUS * M, mass: 1,
        velocity: [vx * M, -vy * M, 0],
        planar: true, bullet: true, ...BALL_BODY,
    });
}

function addBall(w, x, y, vx, vy, extra) {
    const rec = Object.assign({ x, y, vx, vy, active: true, radius: BALL_RADIUS, onFire: false, body: null }, extra);
    rec.body = ballBody(w.dyn, x, y, vx, vy);
    w.ballBodies.add(rec.body);
    return rec;
}

function dropBall(w, b) {
    if (b.body === null) return;
    w.dyn.removeBody(b.body);
    w.ballBodies.delete(b.body);
    b.body = null;
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
    if (b.body !== null) w.dyn.setVelocity(b.body, [vx * M, -vy * M, 0]);
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

    // Sub-step to 1/120 s so fast balls do not tunnel (bullets help too).
    const subs = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < subs; i++) {
        w.dyn.step(dt / subs, 4);
        drainTouches(w);
    }

    for (const b of activeBalls(w)) {
        capSpeed(w, b);
        syncBall(w, b);
    }
    checkExits(w);
    ageSplits(w, dt);
    burnAround(w);

    if (w.pendingDestroy.length) {
        for (const body of w.pendingDestroy) w.dyn.removeBody(body);
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
    moveTo(w.dyn, cb.body, cb.x, cb.y + CATCHBAR_H / 2, dt);
}

function capSpeed(w, b) {
    const v = w.dyn.velocity(b.body);
    const sp = Math.hypot(v[0], v[1]) / M;
    if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        w.dyn.setVelocity(b.body, [v[0] * k, v[1] * k, 0], [v[3], v[4], v[5]]);
    }
}

function syncBall(w, b) {
    const p = w.dyn.pose(b.body);
    const v = w.dyn.velocity(b.body);
    b.x = p[0] / M; b.y = yOf(p[1]);
    b.vx = v[0] / M; b.vy = -v[1] / M;
}

/** The pairs that began to touch in the last step, as score events. */
function drainTouches(w) {
    const t = w.dyn.touched();
    for (let i = 0; i < t.length; i += 2) {
        const aBall = w.ballBodies.has(t[i]);
        if (!aBall && !w.ballBodies.has(t[i + 1])) continue;
        const other = aBall ? t[i + 1] : t[i];
        const peg = w.bodyToPeg.get(other);
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
        // Removed after the step's bookkeeping, with the records already cleared.
        w.pendingDestroy.push(b.body);
        w.ballBodies.delete(b.body);
        b.body = null;
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

// One shared world: its walls stay, the pegs and the ghost are remade per call.
let mirage = null;

/**
 * Fly a ghost ball through a copy of the world's walls and pegs (no
 * catchbar, no scoring) and push up to ~80 {x, y} samples into `out`.
 * Never touches `w`.
 */
function predict(w, angle, speed, x, y, seconds, out) {
    if (!mirage) {
        mirage = { dyn: newDynamics(), bodies: [] };
        for (const s of WALLS) addWallBody(mirage.dyn, s);
    }
    const dyn = mirage.dyn;
    for (const body of mirage.bodies) dyn.removeBody(body);
    mirage.bodies.length = 0;
    for (const p of w.pegs) {
        if (!p.removed) mirage.bodies.push(pegBody(dyn, p.x, p.y, false));
    }
    const sp = Math.min(speed, LAUNCH_SPEED_CAP);
    const ghost = ballBody(dyn, x, y, Math.cos(angle) * sp, Math.sin(angle) * sp);
    mirage.bodies.push(ghost);

    const dt = 1 / 120;
    const steps = Math.floor(seconds / dt);
    const stride = Math.max(1, Math.floor(steps / 80));
    for (let i = 0; i < steps; i++) {
        dyn.step(dt, 4);
        if (i % stride) continue;
        const p = dyn.pose(ghost);
        const py = yOf(p[1]);
        out.push({ x: p[0] / M, y: py });
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
