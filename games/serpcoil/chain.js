// Serpcoil chain — the marching serpent. An ordered list of orbs
// { color, d, phase } sorted by d, the distance along the path (0 at the
// mouth). Orbs pack ORB_DIAM apart; pops split the chain into segments.
//
// Motion (Zuma-style): only the rear segment is pushed by the mouth and
// marches forward; every segment ahead of a gap retreats at pullbackRate
// until it touches the one behind and they merge. A merge that joins two
// same-coloured ends pops that run: that is the cascade.

export const ORB_DIAM = 30;
const GAP = ORB_DIAM + 0.5;       // spacing that still counts as touching

/** Colour slots 1..6 (0 unused): hex, name and pop pitch (C5..C6). */
export const COLORS = [
    null,
    { hex: "#e63946", name: "crimson", tone: 523.25 },
    { hex: "#f4a261", name: "amber", tone: 587.33 },
    { hex: "#e9c46a", name: "gold", tone: 659.25 },
    { hex: "#2a9d8f", name: "teal", tone: 783.99 },
    { hex: "#4cc9f0", name: "azure", tone: 880.0 },
    { hex: "#b56dff", name: "violet", tone: 1046.5 },
];

export class Chain {
    /** opts: { path, palette, totalToSpawn, speed (px/s), rng, pullbackRate, spawnInterval (ms) } */
    constructor(opts) {
        this.path = opts.path;
        this.rng = opts.rng || Math.random;
        this.baseSpeed = opts.speed || 35;
        this.pullbackRate = opts.pullbackRate || 260;
        this.spawnInterval = opts.spawnInterval || 380;
        this.totalToSpawn = opts.totalToSpawn || 50;
        this.orbs = [];
        this.spawned = 0;
        this.spawnTimer = 0;
        this.danger = false;
        this.slowmo = 0;             // ms left
        // The whole spawn sequence up front, so colorsRemaining() is exact.
        const palette = opts.palette || [1, 2, 3];
        this.queue = [];
        for (let i = 0; i < this.totalToSpawn; i++) this.queue.push(palette[(this.rng() * palette.length) | 0]);
    }

    get count() { return this.orbs.length; }
    get remainingToSpawn() { return this.totalToSpawn - this.spawned; }
    get headD() { return this.orbs.length ? this.orbs[this.orbs.length - 1].d : 0; }
    isComplete() { return this.spawned >= this.totalToSpawn && this.orbs.length === 0; }
    reachedGoal() { return this.orbs.length > 0 && this.headD >= this.path.length(); }

    /** Colours on the path or still queued; once gone, gone for the level. */
    colorsRemaining() {
        const seen = new Set();
        for (const o of this.orbs) seen.add(o.color);
        for (const c of this.queue) seen.add(c);
        return [...seen].sort((a, b) => a - b);
    }

    // ── Frame ────────────────────────────────────────────────────────────

    /** Spawn, march, and pop any same-colour merge through onPop(popped, positions). */
    tick(dt, onPop) {
        this.spawn(dt);
        const merges = this.advance(dt);
        this.danger = this.orbs.length > 0 && this.headD >= this.path.length() * 0.82;
        for (const o of this.orbs) o.phase += 0.05 * (dt / 16);
        // Only the rear segment moves forward, so a tick yields at most one
        // merge and its index is still valid here.
        for (const i of merges) {
            if (i > 0 && i < this.orbs.length && this.orbs[i].color === this.orbs[i - 1].color) this.popAround(i, onPop);
        }
    }

    spawn(dt) {
        if (!this.queue.length) return;
        this.spawnTimer += dt;
        if (this.spawnTimer < this.spawnInterval) return;
        this.spawnTimer -= this.spawnInterval;
        const d = this.orbs.length ? this.orbs[0].d - ORB_DIAM : 0;
        this.orbs.unshift({ color: this.queue.shift(), d, phase: this.rng() * Math.PI * 2 });
        this.spawned++;
    }

    /** Move each segment; returns the indices where a segment merged. */
    advance(dt) {
        const orbs = this.orbs;
        if (!orbs.length) return [];
        let speed = this.baseSpeed;
        if (this.slowmo > 0) { speed *= 0.5; this.slowmo -= dt; }
        if (this.danger) speed *= 1.25;

        const starts = [0];
        for (let i = 1; i < orbs.length; i++) if (orbs[i].d - orbs[i - 1].d > GAP) starts.push(i);

        const s = dt / 1000;
        starts.forEach((lo, k) => {
            const hi = k + 1 < starts.length ? starts[k + 1] : orbs.length;
            const delta = k === 0 ? speed * s : -this.pullbackRate * s;
            for (let i = lo; i < hi; i++) orbs[i].d += delta;
        });

        const merges = [];
        for (let k = 1; k < starts.length; k++) {
            const i = starts[k];
            const space = orbs[i].d - orbs[i - 1].d;
            if (space <= GAP) {
                const shift = ORB_DIAM - space;
                for (let j = i; j < orbs.length; j++) orbs[j].d += shift;
                merges.push(i);
            }
        }
        return merges;
    }

    // ── Shots ────────────────────────────────────────────────────────────

    /** Insert a fired orb at d; the orbs ahead shove forward. Returns its index. */
    insertAt(d, color) {
        const orbs = this.orbs;
        const orb = { color, d, phase: this.rng() * Math.PI * 2 };
        let i = 0;
        while (i < orbs.length && orbs[i].d < d) i++;
        orbs.splice(i, 0, orb);
        if (i > 0 && orb.d < orbs[i - 1].d + ORB_DIAM) orb.d = orbs[i - 1].d + ORB_DIAM;
        this.repackFrom(i + 1);
        return i;
    }

    repackFrom(i) {
        const orbs = this.orbs;
        for (let j = Math.max(1, i); j < orbs.length; j++) {
            if (orbs[j].d < orbs[j - 1].d + ORB_DIAM) orbs[j].d = orbs[j - 1].d + ORB_DIAM;
        }
    }

    /** The same-colour run containing index i: [start, end). */
    runAt(i) {
        const orbs = this.orbs;
        const color = orbs[i].color;
        let start = i, end = i;
        while (start > 0 && orbs[start - 1].color === color) start--;
        while (end < orbs.length - 1 && orbs[end + 1].color === color) end++;
        return [start, end + 1];
    }

    /** Runs of 3+: the one containing hint, or every run when hint is null. */
    detectMatches(hint) {
        const orbs = this.orbs;
        if (orbs.length < 3) return [];
        if (hint != null) {
            const run = this.runAt(hint);
            return run[1] - run[0] >= 3 ? [run] : [];
        }
        const out = [];
        for (let i = 0; i < orbs.length;) {
            const run = this.runAt(i);
            if (run[1] - run[0] >= 3) out.push(run);
            i = run[1];
        }
        return out;
    }

    /**
     * Pop the 3+ run around hint, if any. The cascade that may follow is
     * advance()'s job, so the gap visibly closes first. Returns the popped orbs.
     */
    popAround(hint, onPop) {
        const run = this.detectMatches(hint)[0];
        if (!run) return [];
        const positions = [];
        for (let k = run[0]; k < run[1]; k++) positions.push(this.positionOf(this.orbs[k]));
        const popped = this.orbs.splice(run[0], run[1] - run[0]);
        if (onPop) onPop(popped, positions);
        return popped;
    }

    positionOf(orb) {
        const p = this.path.pointAt(orb.d);
        return { x: p.x, y: p.y, color: orb.color };
    }

    // ── Power-ups ────────────────────────────────────────────────────────

    /** Backtrack: shove everything back toward the mouth. */
    backtrack(amount) {
        for (const o of this.orbs) o.d = Math.max(0, o.d - amount);
        this.repackFrom(1);
    }

    /** Blaster: remove every orb within radius of (x, y). */
    blastAt(x, y, radius) {
        const positions = [];
        this.orbs = this.orbs.filter((o) => {
            const p = this.path.pointAt(o.d);
            if (Math.hypot(p.x - x, p.y - y) > radius) return true;
            positions.push({ x: p.x, y: p.y, color: o.color });
            return false;
        });
        return positions;
    }

    /** Colorshift: repaint the run at index i; returns how many changed. */
    colorshift(i, color) {
        if (i < 0 || i >= this.orbs.length) return 0;
        const [start, end] = this.runAt(i);
        for (let k = start; k < end; k++) this.orbs[k].color = color;
        return end - start;
    }

    setSlowmo(ms) { this.slowmo = Math.max(this.slowmo, ms); }

    /** Test / cheat: nothing left to spawn or clear. */
    forceEmpty() {
        this.orbs.length = 0;
        this.queue.length = 0;
        this.spawned = this.totalToSpawn;
    }
}
