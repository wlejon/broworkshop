// Chomper ghosts — four personalities as plain objects, stepped against a
// maze and Chomper's position. No drawing.
//   scarlet  chases Chomper       rose   aims 4 tiles ahead of him
//   azure    wanders at random    amber  chases from afar, retreats up close

import {
    COLS, ROWS, GHOST_HOUSE, GHOST_DOOR, wrapCol, passableForGhost,
} from "/app/maze.js";

/** right, left, up, down */
export const DIRS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
];

export const opposite = (d) => (d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2);

const SPEED = 6.5;             // tiles/s
const FRIGHT_SPEED = 4.5;
const LEAVE_SPEED = 3;
const HOME_SPEED = 8;

const ROSTER = [
    ["scarlet", "#ff0000", COLS - 2, 1, "chase", 0],
    ["rose", "#ffb8ff", 1, 1, "ahead", 2000],
    ["azure", "#00ffff", COLS - 2, ROWS - 2, "random", 5000],
    ["amber", "#ffb852", 1, ROWS - 2, "mixed", 8000],
];

export function createGhosts() {
    return ROSTER.map(([name, color, cc, cr, personality, spawnDelay]) =>
        resetGhost({ name, color, corner: { c: cc, r: cr }, personality, spawnDelay }));
}

/** Back in the house, waiting out its spawn delay. */
export function resetGhost(g) {
    return Object.assign(g, {
        c: GHOST_HOUSE.c, r: GHOST_HOUSE.r, dir: 2,
        mode: "house",         // house · leaving · chase · frightened · eaten
        houseTimer: g.spawnDelay, frightTimer: 0,
    });
}

/** True while it can touch Chomper (roaming or frightened). */
export const isLoose = (g) => g.mode === "chase" || g.mode === "frightened";

export function frighten(g, ms) {
    if (!isLoose(g)) return;
    g.mode = "frightened";
    g.frightTimer = ms;
    g.dir = opposite(g.dir);
}

function target(g, pac) {
    switch (g.personality) {
        case "chase": return { c: pac.c, r: pac.r };
        case "ahead": return { c: pac.c + DIRS[pac.dir].dx * 4, r: pac.r + DIRS[pac.dir].dy * 4 };
        case "mixed": {
            const dc = pac.c - g.c, dr = pac.r - g.r;
            return dc * dc + dr * dr > 64 ? { c: pac.c, r: pac.r } : g.corner;
        }
        default: return null;  // random
    }
}

// At a tile centre: never reverse; head for the target, or pick at random.
function chooseDir(m, g, pac, rng) {
    const ci = Math.round(g.c), ri = Math.round(g.r);
    const options = [];
    for (let i = 0; i < 4; i++) {
        if (i === opposite(g.dir)) continue;
        const nc = wrapCol(ci + DIRS[i].dx), nr = ri + DIRS[i].dy;
        if (passableForGhost(m, nc, nr, false)) options.push({ i, c: nc, r: nr });
    }
    if (!options.length) return opposite(g.dir);
    const t = g.mode === "frightened" ? null : target(g, pac);
    if (!t) return options[Math.floor(rng() * options.length)].i;
    let best = options[0], bestD = Infinity;
    for (const o of options) {
        const d2 = (o.c - t.c) ** 2 + (o.r - t.r) ** 2;
        if (d2 < bestD) { bestD = d2; best = o; }
    }
    return best.i;
}

// Straight-line glide toward (c, r); true on arrival.
function glide(g, c, r, step) {
    const dc = c - g.c, dr = r - g.r;
    const dist = Math.hypot(dc, dr);
    if (dist < step) { g.c = c; g.r = r; return true; }
    g.c += (dc / dist) * step;
    g.r += (dr / dist) * step;
    return false;
}

export function stepGhost(m, g, dt, pac, rng) {
    const ds = dt / 1000;

    if (g.mode === "house") {
        g.houseTimer -= dt;
        g.r = GHOST_HOUSE.r + Math.sin(g.houseTimer * 0.005) * 0.12;     // bob
        if (g.houseTimer <= 0) { g.mode = "leaving"; g.c = GHOST_HOUSE.c; }
        return;
    }
    if (g.mode === "leaving") {                     // out through the door, one row past it
        if (glide(g, GHOST_DOOR.c, GHOST_DOOR.r - 1, LEAVE_SPEED * ds)) {
            g.mode = "chase";
            g.dir = rng() < 0.5 ? 1 : 0;
        }
        return;
    }
    if (g.mode === "eaten") {                       // eyes run home greedily, doors open
        const home = GHOST_HOUSE;
        if (Math.hypot(home.c - g.c, home.r - g.r) < 0.2) {
            g.c = home.c; g.r = home.r;
            g.mode = "leaving";
            return;
        }
        const ci = Math.round(g.c), ri = Math.round(g.r);
        let best = null, bestD = Infinity;
        for (let i = 0; i < 4; i++) {
            const nc = wrapCol(ci + DIRS[i].dx), nr = ri + DIRS[i].dy;
            if (!passableForGhost(m, nc, nr, true)) continue;
            const d2 = (nc - home.c) ** 2 + (nr - home.r) ** 2;
            if (d2 < bestD) { bestD = d2; best = i; }
        }
        if (best !== null) g.dir = best;
        g.c = wrapCol(g.c + DIRS[g.dir].dx * HOME_SPEED * ds);
        g.r += DIRS[g.dir].dy * HOME_SPEED * ds;
        return;
    }

    if (g.mode === "frightened") {
        g.frightTimer -= dt;
        if (g.frightTimer <= 0) g.mode = "chase";
    }
    const step = (g.mode === "frightened" ? FRIGHT_SPEED : SPEED) * ds;
    const ci = Math.round(g.c), ri = Math.round(g.r);
    if (Math.abs(g.c - ci) < step * 0.5 && Math.abs(g.r - ri) < step * 0.5) {
        g.c = ci; g.r = ri;
        g.dir = chooseDir(m, g, pac, rng);
    }
    let d = DIRS[g.dir];
    if (!passableForGhost(m, wrapCol(ci + d.dx), ri + d.dy, false)) {   // never mid-wall
        g.c = ci; g.r = ri;
        g.dir = chooseDir(m, g, pac, rng);
        d = DIRS[g.dir];
    }
    g.c = wrapCol(g.c + d.dx * step);
    g.r += d.dy * step;
}
