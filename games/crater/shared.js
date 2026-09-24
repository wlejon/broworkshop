// shared.js — Crater's physics, imported by both the client (game.js) and the
// authoritative server (match.js). One copy: client and server agree on
// gravity, muzzle velocity, craters and blast damage because they run the
// same functions.

export const C = {
    WORLD_W: 100,           // world X extent
    COLS: 200,              // heightmap column count
    MAX_H: 40,              // max terrain height
    MIN_H: 0,
    GRAVITY: 40,            // units/s², pulling -y
    MAX_SPEED: 55,          // muzzle velocity at power = 1
    TURN_TIMEOUT: 30000,    // ms — forfeit a human turn past this
    BOT_DELAY: 1200,        // ms — bot "aiming" before it fires
    BLAST_RADIUS: 7,        // damage falloff radius
    CRATER_RAD: 4.8,        // terrain dig radius
    MAX_DAMAGE: 55,         // at the impact point
    TANK_W: 2.4,
    TANK_H: 1.2,
    HP_MAX: 100,
    COLORS: [
        "#e74c3c", "#3498db", "#2ecc71", "#f39c12",
        "#9b59b6", "#1abc9c", "#e67e22", "#e91e63",
    ],
};
C.COL_W = C.WORLD_W / C.COLS;

/** Mulberry32: a tiny deterministic PRNG. Returns () → [0, 1). */
export function rng(seed) {
    let a = seed | 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Layered sines from a seed: cheap, deterministic, pleasing hills, and the
 * same on every machine. Float32Array(COLS) of surface heights.
 */
export function generateHeightmap(seed) {
    const r = rng(seed);
    const octs = [];
    for (let o = 0; o < 4; o++) {
        octs.push({
            freq: (1 + o * 2) * (0.25 + r() * 0.4),
            amp: Math.pow(0.55, o) * (0.6 + r() * 0.5),
            phase: r() * Math.PI * 2,
        });
    }
    const hm = new Float32Array(C.COLS);
    for (let i = 0; i < C.COLS; i++) {
        const u = i / C.COLS;
        let h = 0;
        for (const o of octs) h += Math.sin(u * o.freq * Math.PI * 2 + o.phase) * o.amp;
        const norm = (h + 1.5) / 3.0;                        // [-1.5, 1.5] → [0, 1]
        hm[i] = Math.max(4, Math.min(C.MAX_H - 4, 10 + norm * (C.MAX_H - 16)));
    }
    return hm;
}

/** Surface height at world x (linear between columns, clamped at the edges). */
export function heightAt(hm, x) {
    const t = (x / C.WORLD_W) * (C.COLS - 1);
    if (t <= 0) return hm[0];
    if (t >= C.COLS - 1) return hm[C.COLS - 1];
    const i = Math.floor(t);
    const f = t - i;
    return hm[i] * (1 - f) + hm[i + 1] * f;
}

/** Where a shell leaves the barrel of a tank at x: { x, y }. */
export function muzzleOrigin(hm, x, angle, dir) {
    const len = C.TANK_W * 0.9;
    return {
        x: x + dir * len * Math.cos(angle),
        y: heightAt(hm, x) + C.TANK_H + len * Math.sin(angle),
    };
}

/** Launch velocity for an aim: { vx, vy }. */
export function launchVelocity(angle, power, dir) {
    const speed = power * C.MAX_SPEED;
    return { vx: dir * speed * Math.cos(angle), vy: speed * Math.sin(angle) };
}

/**
 * Integrate a shell from (x, y) at (vx, vy) against the heightmap, 10 ms
 * steps, 20 s cap. Returns { hit, x, y, flightMs, path } — hit is false when
 * it leaves the arena. `path` is a flat [x0, y0, x1, y1, ...] polyline sampled
 * every 25 ms unless opts.recordPath === false.
 */
export function simulateShot(hm, x, y, vx, vy, opts) {
    const recordPath = !opts || opts.recordPath !== false;
    const dt = 0.01, maxT = 20;
    const path = recordPath ? [x, y] : null;
    let sampleT = 0, t = 0;
    while (t < maxT) {
        x += vx * dt;
        y += vy * dt;
        vy -= C.GRAVITY * dt;
        t += dt;
        if (recordPath && (sampleT += dt) >= 0.025) {
            path.push(x, y);
            sampleT = 0;
        }
        if (x < -5 || x > C.WORLD_W + 5 || y < -20) return { hit: false, x, y, flightMs: t * 1000, path };
        if (x >= 0 && x <= C.WORLD_W && y <= heightAt(hm, x)) {
            if (recordPath) path.push(x, y);
            return { hit: true, x, y, flightMs: t * 1000, path };
        }
    }
    return { hit: false, x, y, flightMs: t * 1000, path };
}

/**
 * Carve a circular crater into the heightmap, in place. Returns [col, newH]
 * for every column that changed, which clients apply verbatim.
 */
export function carveCrater(hm, cx, cy, radius) {
    const minCol = Math.max(0, Math.floor((cx - radius) / C.COL_W));
    const maxCol = Math.min(C.COLS - 1, Math.ceil((cx + radius) / C.COL_W));
    const changes = [];
    for (let i = minCol; i <= maxCol; i++) {
        const dx = i * C.COL_W + C.COL_W * 0.5 - cx;
        const d2 = radius * radius - dx * dx;
        if (d2 <= 0) continue;
        const newH = cy - Math.sqrt(d2);                    // bottom of the arc
        if (hm[i] > newH) {
            hm[i] = Math.max(C.MIN_H, newH);
            changes.push([i, hm[i]]);
        }
    }
    return changes;
}

export function applyCraterDiff(hm, changes) {
    for (const [i, h] of changes) hm[i] = h;
}

/** Damage to a tank at (tx, ty) from a blast at (cx, cy): quadratic falloff. */
export function blastDamage(cx, cy, tx, ty) {
    const d = Math.hypot(tx - cx, ty - cy);
    if (d >= C.BLAST_RADIUS) return 0;
    const falloff = 1 - d / C.BLAST_RADIUS;
    return Math.round(C.MAX_DAMAGE * falloff * falloff);
}
