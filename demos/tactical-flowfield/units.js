// units.js — the swarm: flat typed arrays, formations, fixed-step steering.
//
// Every unit samples the ONE flow field for its heading, so a thousand units
// cost one wave plus a thousand bilinear reads. Near the goal each unit peels
// off to its formation slot (Box / Wedge / Circle / Flank around the goal,
// facing the approach). Separation and alignment come from a spatial hash;
// threat pushes down its gradient. Speeds are cells per second and the sim
// steps at a fixed 60 Hz, so behaviour does not depend on frame rate, and the
// scatter is a seeded RNG, so a scenario always starts the same way.

import { COLS, ROWS, TERRAIN, field, getCost } from "/app/field.js";
import { tactics } from "/app/tactics.js";

export const FORMATIONS = ['Box', 'Wedge', 'Circle', 'Flank'];
export const MAX_UNITS = 5000;

export const swarm = {
    n: 1000,
    x: new Float32Array(MAX_UNITS), y: new Float32Array(MAX_UNITS),
    vx: new Float32Array(MAX_UNITS), vy: new Float32Array(MAX_UNITS),
    slotX: new Float32Array(MAX_UNITS), slotY: new Float32Array(MAX_UNITS),
    formation: 'Box',
    facing: 0,
    spacing: 1.2,
    radius: 0.28,
    maxSpeed: 9,              // cells / s
    maxAccel: 45,             // cells / s^2
    formRange: 22,            // flow distance at which slots take over (updateSlots sizes it)
    time: 0,
};

const W = { flow: 1.0, slot: 1.2, sep: 26, align: 0.25, threat: 30 };

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Scatter every unit in a disc around (cx, cy), seeded. The disc is sized to
 * the current count at about formation density (and nudged off the map edge),
 * so a big swarm does not start packed several deep per cell.
 */
export function deploy(cx, cy, seed = 7) {
    const r = rng(seed), S = swarm;
    const rad = Math.min(ROWS / 2 - 3, Math.max(8, 0.75 * Math.sqrt(S.n)));
    cx = Math.max(cx, rad + 2);
    for (let i = 0; i < MAX_UNITS; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
        S.x[i] = Math.max(2, Math.min(COLS - 2, cx + Math.cos(a) * d));
        S.y[i] = Math.max(2, Math.min(ROWS - 2, cy + Math.sin(a) * d));
        S.vx[i] = 0; S.vy[i] = 0;
    }
    S.time = 0;
    updateSlots();
}

export function setCount(n) {
    swarm.n = Math.max(10, Math.min(MAX_UNITS, n | 0));
    updateSlots();
}

export function setFormation(name) {
    swarm.formation = FORMATIONS.includes(name) ? name : 'Box';
    updateSlots();
}

/** Face the approach: from the swarm's centroid toward the goal (or an explicit angle). */
export function setFacing(angle) {
    if (angle == null) {
        const c = centroid();
        angle = Math.atan2(field.goal.y - c.y, field.goal.x - c.x);
    }
    swarm.facing = angle;
    updateSlots();
}

/** Formation slot offsets, rotated to `facing`: local +x is forward. */
export function formationOffsets(type, count, facing, spacing) {
    const out = [], c = Math.cos(facing), s = Math.sin(facing);
    const put = (fwd, side) => out.push({ x: fwd * c - side * s, y: fwd * s + side * c });
    if (type === 'Wedge') {
        // A filled chevron: row r (behind the tip) holds 2r + 1 units.
        for (let row = 0; out.length < count; row++) {
            for (let k = -row; k <= row && out.length < count; k++) put(-row * spacing * 0.85, k * spacing * 0.85);
        }
    } else if (type === 'Circle') {
        put(0, 0);
        for (let ring = 1; out.length < count; ring++) {
            const rr = ring * spacing * 1.1, cap = Math.max(6, Math.floor((2 * Math.PI * rr) / spacing));
            const k = Math.min(cap, count - out.length);
            for (let j = 0; j < k; j++) put(Math.cos((j / k) * Math.PI * 2) * rr, Math.sin((j / k) * Math.PI * 2) * rr);
        }
    } else if (type === 'Flank') {
        put(0, 0);
        // Two wings beside a gap, each about twice as deep as it is wide.
        const wing = Math.floor((count - 1) / 2), wc = Math.max(3, Math.ceil(Math.sqrt(wing / 2)));
        for (const side of [-1, 1]) {
            for (let w = 0; w < wing && out.length < count; w++) put(-Math.floor(w / wc) * spacing, side * (spacing * 3 + (w % wc) * spacing));
        }
        while (out.length < count) put(-(out.length - 2 * wing) * spacing, 0);
    } else {
        // Box: centred on the goal, so a big block does not trail back down the approach.
        const cols = Math.max(5, Math.ceil(Math.sqrt(count * 1.5))), rows = Math.ceil(count / cols);
        for (let i = 0; i < count; i++) put(((rows - 1) / 2 - Math.floor(i / cols)) * spacing, ((i % cols) - (cols - 1) / 2) * spacing);
    }
    return out.slice(0, count);
}

export function updateSlots() {
    const S = swarm, off = formationOffsets(S.formation, S.n, S.facing, S.spacing);
    // Slots take over within formRange of the goal, which must reach the
    // formation's farthest slot or a big block's corners are never filled.
    let reach = 0;
    for (let i = 0; i < S.n; i++) reach = Math.max(reach, Math.hypot(off[i].x, off[i].y));
    S.formRange = Math.min(56, Math.max(22, reach * 1.15 + 6));
    for (let i = 0; i < S.n; i++) {
        S.slotX[i] = Math.max(1.5, Math.min(COLS - 1.5, field.goal.x + off[i].x));
        S.slotY[i] = Math.max(1.5, Math.min(ROWS - 1.5, field.goal.y + off[i].y));
    }
}

export function centroid() {
    const S = swarm;
    let x = 0, y = 0;
    for (let i = 0; i < S.n; i++) { x += S.x[i]; y += S.y[i]; }
    return { x: x / S.n, y: y / S.n };
}

// --- spatial hash (1-cell buckets: the neighbour radius is under a cell, and a
// packed swarm makes bigger buckets quadratically dearer) ---------------------------------

const HC = 1, HCOLS = Math.ceil(COLS / HC), HROWS = Math.ceil(ROWS / HC);
const head = new Int32Array(HCOLS * HROWS), next = new Int32Array(MAX_UNITS);

function buildHash() {
    head.fill(-1);
    const S = swarm;
    for (let i = 0; i < S.n; i++) {
        const b = Math.min(HROWS - 1, (S.y[i] / HC) | 0) * HCOLS + Math.min(HCOLS - 1, (S.x[i] / HC) | 0);
        next[i] = head[b]; head[b] = i;
    }
}

/** Closest open cell to a cell, searching outward ring by ring (rare path). */
function nearestOpen(cx, cy) {
    for (let r = 1; r < 24; r++) {
        let best = null, bd = Infinity;
        for (let y = cy - r; y <= cy + r; y++) {
            for (let x = cx - r; x <= cx + r; x++) {
                if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || getCost(x, y) >= TERRAIN.WALL) continue;
                const d = (x - cx) ** 2 + (y - cy) ** 2;
                if (d < bd) { bd = d; best = { x, y }; }
            }
        }
        if (best) return best;
    }
    return null;
}

/**
 * One fixed step. The hot loop reads the field's typed arrays directly
 * (hoisted to locals, cells indexed inline): a thousand units times a dozen
 * lookups is where a per-lookup function call shows up in the frame time.
 */
export function tickUnits(dt) {
    const S = swarm, R = S.radius * 3.2, R2 = R * R, anyThreat = tactics.threats.length > 0;
    const X = S.x, Y = S.y, VX = S.vx, VY = S.vy, SX = S.slotX, SY = S.slotY;
    const COST = field.cost, DIST = field.integration, FX = field.flowX, FY = field.flowY, THR = field.threat;
    const WALL = TERRAIN.WALL, ROUGH = TERRAIN.ROUGH, maxSpeed = S.maxSpeed, maxAccel = S.maxAccel, range = S.formRange;
    const cost = (x, y) => (x >= 0 && x < COLS && y >= 0 && y < ROWS ? COST[y * COLS + x] : WALL);
    const thr = (x, y) => (x >= 0 && x < COLS && y >= 0 && y < ROWS ? THR[y * COLS + x] : 0);
    S.time += dt;
    buildHash();
    for (let i = 0; i < S.n; i++) {
        const px = X[i], py = Y[i], vx = VX[i], vy = VY[i];
        const cx = px | 0, cy = py | 0, c = cy * COLS + cx;
        let ax = 0, ay = 0;
        // 1. flow (bilinear), fading out as the unit's slot takes over near the goal
        const dist = DIST[c];
        const near = dist < range ? 1 - dist / range : 0;
        const gx0 = Math.max(0, Math.min(COLS - 2, Math.floor(px - 0.5))), gy0 = Math.max(0, Math.min(ROWS - 2, Math.floor(py - 0.5)));
        const tx0 = Math.max(0, Math.min(1, px - 0.5 - gx0)), ty0 = Math.max(0, Math.min(1, py - 0.5 - gy0));
        const a = gy0 * COLS + gx0, b = a + 1, e = a + COLS, f = e + 1;
        let fx = (FX[a] * (1 - tx0) + FX[b] * tx0) * (1 - ty0) + (FX[e] * (1 - tx0) + FX[f] * tx0) * ty0;
        let fy = (FY[a] * (1 - tx0) + FY[b] * tx0) * (1 - ty0) + (FY[e] * (1 - tx0) + FY[f] * tx0) * ty0;
        const fl = Math.sqrt(fx * fx + fy * fy);
        if (fl > 1e-4) { fx /= fl; fy /= fl; } else { fx = 0; fy = 0; }
        ax += (fx * maxSpeed - vx) * W.flow * (1 - near) * 8;
        ay += (fy * maxSpeed - vy) * W.flow * (1 - near) * 8;
        // 2. formation slot, only once close (a slot far away would pull through walls)
        if (near > 0) {
            const tx = SX[i] - px, ty = SY[i] - py, d = Math.sqrt(tx * tx + ty * ty);
            const want = Math.min(maxSpeed, d * 2.5);
            if (d > 1e-3) { ax += ((tx / d) * want - vx) * W.slot * 8 * near; ay += ((ty / d) * want - vy) * W.slot * 8 * near; }
            else { ax -= vx * 8; ay -= vy * 8; }
        }
        // 3. separation + alignment
        const hx = (px / HC) | 0, hy = (py / HC) | 0;
        let sx = 0, sy = 0, avx = 0, avy = 0, k = 0;
        const by1 = Math.min(HROWS - 1, hy + 1), bx1 = Math.min(HCOLS - 1, hx + 1);
        for (let by = Math.max(0, hy - 1); by <= by1; by++) {
            for (let bx = Math.max(0, hx - 1); bx <= bx1; bx++) {
                for (let j = head[by * HCOLS + bx]; j !== -1; j = next[j]) {
                    if (j === i) continue;
                    const dx = px - X[j], dy = py - Y[j], d2 = dx * dx + dy * dy;
                    if (d2 < 1e-8 || d2 > R2) continue;
                    const d = Math.sqrt(d2), push = (R - d) / R;
                    sx += (dx / d) * push; sy += (dy / d) * push;
                    avx += VX[j]; avy += VY[j]; k++;
                }
            }
        }
        if (k) {
            ax += sx * W.sep + (avx / k - vx) * W.align;
            ay += sy * W.sep + (avy / k - vy) * W.align;
        }
        // 4. threat: push down the threat gradient
        if (anyThreat) {
            const t = THR[c];
            if (t > 0.05) {
                const ex = thr(cx - 1, cy) - thr(cx + 1, cy), ey = thr(cx, cy - 1) - thr(cx, cy + 1);
                const el = Math.sqrt(ex * ex + ey * ey);
                if (el > 1e-4) { ax += (ex / el) * W.threat * t; ay += (ey / el) * W.threat * t; }
            }
        }
        const al = Math.sqrt(ax * ax + ay * ay);
        if (al > maxAccel) { ax *= maxAccel / al; ay *= maxAccel / al; }
        let nvx = vx + ax * dt, nvy = vy + ay * dt;
        const sp = Math.sqrt(nvx * nvx + nvy * nvy);
        if (sp > maxSpeed) { nvx *= maxSpeed / sp; nvy *= maxSpeed / sp; }
        const mud = COST[c] === ROUGH ? 0.45 : 1;
        let nx = px + nvx * mud * dt, ny = py + nvy * mud * dt;
        if (COST[c] >= WALL) {
            // A wall was painted on top of this unit: walk it out to open ground.
            const out = nearestOpen(cx, cy);
            if (out) {
                const ex = out.x + 0.5 - px, ey = out.y + 0.5 - py, el = Math.sqrt(ex * ex + ey * ey) || 1;
                nvx = (ex / el) * maxSpeed * 0.5; nvy = (ey / el) * maxSpeed * 0.5;
                nx = px + nvx * dt; ny = py + nvy * dt;
            }
        } else if (cost(nx | 0, ny | 0) >= WALL) {
            // Walls: slide along whichever axis stays open, else stop.
            if (cost(nx | 0, cy) < WALL) { ny = py; nvy *= -0.2; }
            else if (cost(cx, ny | 0) < WALL) { nx = px; nvx *= -0.2; }
            else { nx = px; ny = py; nvx = 0; nvy = 0; }
        }
        X[i] = Math.max(1.05, Math.min(COLS - 1.05, nx));
        Y[i] = Math.max(1.05, Math.min(ROWS - 1.05, ny));
        VX[i] = nvx; VY[i] = nvy;
    }
}

/** Mean distance from each unit to its slot (how formed-up the swarm is). */
export function slotError() {
    const S = swarm;
    let e = 0;
    for (let i = 0; i < S.n; i++) e += Math.hypot(S.x[i] - S.slotX[i], S.y[i] - S.slotY[i]);
    return e / S.n;
}

/** Units standing in impassable cells (must stay 0). */
export function unitsInWalls() {
    const S = swarm;
    let n = 0;
    for (let i = 0; i < S.n; i++) if (getCost(S.x[i] | 0, S.y[i] | 0) >= TERRAIN.WALL) n++;
    return n;
}

/** Units within r of a point. */
export function unitsNear(x, y, r) {
    const S = swarm;
    let n = 0;
    for (let i = 0; i < S.n; i++) if (Math.hypot(S.x[i] - x, S.y[i] - y) <= r) n++;
    return n;
}
