// sim/physics.js — the simulation itself: plain data + functions, no worker
// or DOM globals, so the worker runs it and tests can step it directly.
//
//   const sim = createSim({ width: 1280, height: 720, count: 4000, mode: 'boids', seed: 1 });
//   sim.step(1 / 60);            // advances sim.state in place
//   sim.state                    // Float32Array, STRIDE floats per entity (protocol.js)
//
// Neighbour queries go through a uniform grid rebuilt every step (a linked
// list per cell: head[cell] -> next[i] -> ...), so boids and particle
// collisions cost O(n) rather than O(n^2).

import { STRIDE, X, Y, VX, VY, MASS, HUE, FORCES, entityBuffer } from "./protocol.js";

const CELL = 40;                         // grid cell = boid visual range

/** Deterministic PRNG (mulberry32) so a seeded sim replays exactly. */
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function createSim(opts) {
    const o = Object.assign({ width: 1280, height: 720, count: 4000, mode: 'boids', seed: 0 }, opts);
    const sim = {
        width: o.width, height: o.height, count: o.count, mode: o.mode,
        speed: 1,                                  // time scale
        mouse: { x: 0, y: 0, active: false, force: FORCES.attract },
        state: null,
        random: rng(o.seed || (Math.random() * 2 ** 32)),
        grid: null,
        seed() { seed(sim); },
        resize(w, h) { sim.width = w; sim.height = h; sim.grid = makeGrid(w, h, sim.count); },
        setCount(n) { sim.count = n; seed(sim); },
        step(dt) { step(sim, dt); },
    };
    seed(sim);
    return sim;
}

function makeGrid(w, h, count) {
    const cols = Math.max(1, Math.ceil(w / CELL)), rows = Math.max(1, Math.ceil(h / CELL));
    return { cols, rows, head: new Int32Array(cols * rows), next: new Int32Array(count), near: new Int32Array(256) };
}

function seed(sim) {
    const s = sim.state = entityBuffer(sim.count);
    sim.grid = makeGrid(sim.width, sim.height, sim.count);
    const r = sim.random;
    for (let i = 0; i < sim.count; i++) {
        const o = i * STRIDE;
        const ang = r() * Math.PI * 2, sp = 40 + r() * 80;
        s[o + X] = r() * sim.width;
        s[o + Y] = r() * sim.height;
        s[o + VX] = Math.cos(ang) * sp;
        s[o + VY] = Math.sin(ang) * sp;
        s[o + MASS] = 1 + r() * 2;
        s[o + HUE] = r() * 360;
    }
}

function binGrid(sim) {
    const { cols, rows, head, next } = sim.grid;
    const s = sim.state;
    head.fill(-1);
    for (let i = 0; i < sim.count; i++) {
        const gx = Math.max(0, Math.min(cols - 1, Math.floor(s[i * STRIDE + X] / CELL)));
        const gy = Math.max(0, Math.min(rows - 1, Math.floor(s[i * STRIDE + Y] / CELL)));
        const c = gy * cols + gx;
        next[i] = head[c];
        head[c] = i;
    }
}

/**
 * Collects the entities in the 3x3 cells around (x, y) into grid.near and
 * returns how many (a plain loop over an array beats a callback per pair).
 */
function neighbours(grid, x, y) {
    const { cols, rows, head, next } = grid;
    let near = grid.near, n = 0;
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    for (let cy = gy - 1; cy <= gy + 1; cy++) {
        if (cy < 0 || cy >= rows) continue;
        for (let cx = gx - 1; cx <= gx + 1; cx++) {
            if (cx < 0 || cx >= cols) continue;
            for (let j = head[cy * cols + cx]; j !== -1; j = next[j]) {
                if (n === near.length) { const grown = new Int32Array(n * 2); grown.set(near); near = grid.near = grown; }
                near[n++] = j;
            }
        }
    }
    return n;
}

// ---- modes -----------------------------------------------------------------

const BOIDS = { range: 40, minDist: 14, maxSpeed: 160, minSpeed: 50,
                cohesion: 0.015, alignment: 0.04, separation: 0.06 };

function stepBoids(sim) {
    const s = sim.state, B = BOIDS;
    const range2 = B.range * B.range, min2 = B.minDist * B.minDist;
    for (let i = 0; i < sim.count; i++) {
        const o = i * STRIDE;
        const x = s[o + X], y = s[o + Y];
        let vx = s[o + VX], vy = s[o + VY];
        let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, n = 0;
        const m = neighbours(sim.grid, x, y), near = sim.grid.near;
        for (let k = 0; k < m; k++) {
            const j = near[k];
            if (j === i) continue;
            const p = j * STRIDE, dx = x - s[p + X], dy = y - s[p + Y];
            const d2 = dx * dx + dy * dy;
            if (d2 >= range2) continue;
            if (d2 < min2) { sx += dx; sy += dy; continue; }
            cx += s[p + X]; cy += s[p + Y];
            ax += s[p + VX]; ay += s[p + VY];
            n++;
        }
        if (n > 0) {
            vx += (cx / n - x) * B.cohesion + (ax / n - vx) * B.alignment;
            vy += (cy / n - y) * B.cohesion + (ay / n - vy) * B.alignment;
        }
        vx += sx * B.separation;
        vy += sy * B.separation;
        const sp = Math.hypot(vx, vy) || 1;
        const clamped = Math.max(B.minSpeed, Math.min(B.maxSpeed, sp));
        vx *= clamped / sp; vy *= clamped / sp;
        s[o + VX] = vx; s[o + VY] = vy;
        s[o + HUE] = (Math.atan2(vy, vx) + Math.PI) / (Math.PI * 2) * 360;   // colour = heading
    }
}

const PARTICLE_R = 6, DAMPING = 0.99, GRAVITY = 25, PUSH = 12;

function stepParticles(sim, dt) {
    const s = sim.state, dia = PARTICLE_R * 2, dia2 = dia * dia;
    for (let i = 0; i < sim.count; i++) {
        const o = i * STRIDE;
        const x = s[o + X], y = s[o + Y];
        let vx = s[o + VX] * DAMPING, vy = s[o + VY] * DAMPING + GRAVITY * dt;
        const m = neighbours(sim.grid, x, y), near = sim.grid.near;
        for (let k = 0; k < m; k++) {
            const j = near[k];
            if (j <= i) continue;                              // each pair once
            const p = j * STRIDE, dx = x - s[p + X], dy = y - s[p + Y];
            const d2 = dx * dx + dy * dy;
            if (d2 >= dia2 || d2 < 1e-3) continue;
            const d = Math.sqrt(d2), push = 0.5 * (dia - d) * PUSH;
            const nx = dx / d, ny = dy / d;
            vx += nx * push; vy += ny * push;
            s[p + VX] -= nx * push; s[p + VY] -= ny * push;
        }
        s[o + VX] = vx; s[o + VY] = vy;
        s[o + HUE] = Math.min(360, Math.hypot(vx, vy) * 1.5);    // colour = speed
    }
}

const CENTRAL_MASS = 8000, SOFTENING = 800, G = 25;

function stepGravity(sim, dt) {
    const s = sim.state, cx = sim.width / 2, cy = sim.height / 2;
    for (let i = 0; i < sim.count; i++) {
        const o = i * STRIDE;
        const dx = cx - s[o + X], dy = cy - s[o + Y];
        const d2 = dx * dx + dy * dy + SOFTENING, d = Math.sqrt(d2);
        const f = CENTRAL_MASS / d2 * dt * G;
        const vx = s[o + VX] + dx / d * f, vy = s[o + VY] + dy / d * f;
        s[o + VX] = vx; s[o + VY] = vy;
        s[o + HUE] = 180 + Math.min(180, Math.hypot(vx, vy) * 1.8);
    }
}

const MODE_STEP = { boids: stepBoids, particles: stepParticles, gravity: stepGravity };

const MOUSE_R = 220, MOUSE_STRENGTH = 450;

function applyMouse(sim, dt) {
    const s = sim.state, m = sim.mouse, r2 = MOUSE_R * MOUSE_R;
    for (let i = 0; i < sim.count; i++) {
        const o = i * STRIDE;
        const dx = m.x - s[o + X], dy = m.y - s[o + Y];
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 || d2 <= 4) continue;
        const d = Math.sqrt(d2), k = (1 - d / MOUSE_R) * MOUSE_STRENGTH * dt;
        const nx = dx / d, ny = dy / d;
        if (m.force === FORCES.attract) { s[o + VX] += nx * k; s[o + VY] += ny * k; }
        else if (m.force === FORCES.repel) { s[o + VX] -= nx * k * 1.5; s[o + VY] -= ny * k * 1.5; }
        else { s[o + VX] -= ny * k * 1.4; s[o + VY] += nx * k * 1.4; }      // vortex
    }
}

// Boids and gravity wrap around the edges; particles bounce off the walls.
function integrate(sim, dt) {
    const s = sim.state, w = sim.width, h = sim.height, k = dt * sim.speed;
    const wrap = sim.mode !== 'particles', R = PARTICLE_R;
    for (let i = 0; i < sim.count; i++) {
        const o = i * STRIDE;
        let x = s[o + X] + s[o + VX] * k, y = s[o + Y] + s[o + VY] * k;
        if (wrap) {
            x = ((x % w) + w) % w;
            y = ((y % h) + h) % h;
        } else {
            if (x < R) { x = R; s[o + VX] *= -0.85; } else if (x > w - R) { x = w - R; s[o + VX] *= -0.85; }
            if (y < R) { y = R; s[o + VY] *= -0.85; } else if (y > h - R) { y = h - R; s[o + VY] *= -0.85; }
        }
        s[o + X] = x; s[o + Y] = y;
    }
}

function step(sim, dt) {
    binGrid(sim);
    (MODE_STEP[sim.mode] || stepBoids)(sim, dt);
    if (sim.mouse.active) applyMouse(sim, dt);
    integrate(sim, dt);
}
