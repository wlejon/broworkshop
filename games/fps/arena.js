// arena.js — FPS Arena geometry and movement, shared by client and server.
//
// The client predicts its own movement with exactly the code the server runs
// (stepMove), so prediction and authority only disagree by network timing.
// Pure data + math: no DOM, no scene, no bro.net.

export const ARENA_HALF = 20;
export const WALL_H = 3;
export const WALL_THICK = 0.5;

export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.6;
export const MOVE_SPEED = 6.0;

/** Obstacles: centre (x, z), half-extents hw / hd, half-height hh (base on the floor). */
export const OBSTACLES = [
    { x: -8, z: -8, hw: 1.5, hd: 1.5, hh: 1.5 },
    { x: 8, z: 8, hw: 1.5, hd: 1.5, hh: 1.5 },
    { x: -8, z: 8, hw: 1.0, hd: 3.0, hh: 1.0 },
    { x: 8, z: -8, hw: 3.0, hd: 1.0, hh: 1.0 },
    { x: 0, z: 0, hw: 1.0, hd: 1.0, hh: 2.5 },
    { x: -15, z: 0, hw: 0.5, hd: 4.0, hh: 1.5 },
    { x: 15, z: 0, hw: 0.5, hd: 4.0, hh: 1.5 },
    { x: 0, z: 15, hw: 4.0, hd: 0.5, hh: 1.5 },
    { x: 0, z: -15, hw: 4.0, hd: 0.5, hh: 1.5 },
];

export const WALLS = [
    { x: 0, z: -ARENA_HALF, hw: ARENA_HALF, hd: WALL_THICK, hh: WALL_H },
    { x: 0, z: ARENA_HALF, hw: ARENA_HALF, hd: WALL_THICK, hh: WALL_H },
    { x: -ARENA_HALF, z: 0, hw: WALL_THICK, hd: ARENA_HALF, hh: WALL_H },
    { x: ARENA_HALF, z: 0, hw: WALL_THICK, hd: ARENA_HALF, hh: WALL_H },
];

export const SOLIDS = OBSTACLES.concat(WALLS);

export const SPAWNS = [
    { x: -16, z: -16 }, { x: 16, z: -16 }, { x: -16, z: 16 }, { x: 16, z: 16 },
    { x: 0, z: -16 }, { x: 0, z: 16 }, { x: -16, z: 0 }, { x: 16, z: 0 },
];

export const PLAYER_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12",
    "#9b59b6", "#1abc9c", "#e67e22", "#e91e63",
];

/** Input bit flags (the keys byte of an input packet). */
export const IN = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, SHOOT: 16 };

/** Unit view direction; yaw 0 looks down -Z. */
export function forward(yaw, pitch) {
    const cp = Math.cos(pitch || 0);
    return { x: Math.sin(yaw) * cp, y: Math.sin(pitch || 0), z: -Math.cos(yaw) * cp };
}

/**
 * Push a circle (xz plane) out of an AABB. Returns the corrected { x, z }, or
 * null when they do not overlap.
 */
export function pushCircleOutOfAABB(px, pz, r, box) {
    const bx0 = box.x - box.hw, bx1 = box.x + box.hw;
    const bz0 = box.z - box.hd, bz1 = box.z + box.hd;
    const cx = Math.max(bx0, Math.min(px, bx1));
    const cz = Math.max(bz0, Math.min(pz, bz1));
    const dx = px - cx, dz = pz - cz;
    const dist2 = dx * dx + dz * dz;
    if (dist2 < r * r && dist2 > 0.0001) {
        const dist = Math.sqrt(dist2);
        const pen = r - dist;
        return { x: px + (dx / dist) * pen, z: pz + (dz / dist) * pen };
    }
    if (dist2 < 0.0001) {
        // Centre inside the box: out along the shortest axis.
        const dl = px - bx0, dr = bx1 - px, dt = pz - bz0, db = bz1 - pz;
        const min = Math.min(dl, dr, dt, db);
        if (min === dl) return { x: bx0 - r, z: pz };
        if (min === dr) return { x: bx1 + r, z: pz };
        if (min === dt) return { x: px, z: bz0 - r };
        return { x: px, z: bz1 + r };
    }
    return null;
}

/** Resolve a player position against every solid and the arena bounds, in place. */
export function collide(p) {
    for (const box of SOLIDS) {
        const r = pushCircleOutOfAABB(p.x, p.z, PLAYER_RADIUS, box);
        if (r) { p.x = r.x; p.z = r.z; }
    }
    const lim = ARENA_HALF - PLAYER_RADIUS - WALL_THICK;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
}

/**
 * One movement step from input bits: walk relative to yaw at MOVE_SPEED
 * (diagonals normalised), then collide. Mutates p.x / p.z. dt in seconds.
 */
export function stepMove(p, keys, yaw, dt, speed) {
    const fwdX = Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    let mx = 0, mz = 0;
    if (keys & IN.FWD) { mx += fwdX; mz += fwdZ; }
    if (keys & IN.BACK) { mx -= fwdX; mz -= fwdZ; }
    if (keys & IN.LEFT) { mx -= rightX; mz -= rightZ; }
    if (keys & IN.RIGHT) { mx += rightX; mz += rightZ; }
    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0.001) {
        const s = (speed || MOVE_SPEED) * dt / len;
        p.x += mx * s;
        p.z += mz * s;
    }
    collide(p);
}

/** Ray vs AABB (slab method); the box spans y 0..2*hh. Distance, or -1. */
export function rayAABB(ox, oy, oz, dx, dy, dz, box) {
    const slabs = [
        [ox, dx, box.x - box.hw, box.x + box.hw],
        [oy, dy, 0, box.hh * 2],
        [oz, dz, box.z - box.hd, box.z + box.hd],
    ];
    let tmin = -Infinity, tmax = Infinity;
    for (const [o, d, mn, mx] of slabs) {
        if (Math.abs(d) < 1e-9) {
            if (o < mn || o > mx) return -1;
            continue;
        }
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return -1;
    }
    return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : -1);
}

/** Ray vs vertical cylinder centred (cx, cz), radius r, y 0..h. Distance, or -1. */
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, h) {
    const ex = ox - cx, ez = oz - cz;
    const a = dx * dx + dz * dz;
    if (a < 1e-12) return -1;
    const b = 2 * (ex * dx + ez * dz);
    const c = ex * ex + ez * ez - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    let t = (-b - sq) / (2 * a);
    if (t < 0) t = (-b + sq) / (2 * a);
    if (t < 0) return -1;
    const y = oy + dy * t;
    return y < 0 || y > h ? -1 : t;
}

/** First solid hit along a ray, as a distance (Infinity when clear). */
export function solidHit(ox, oy, oz, dx, dy, dz) {
    let best = Infinity;
    for (const box of SOLIDS) {
        const t = rayAABB(ox, oy, oz, dx, dy, dz, box);
        if (t >= 0 && t < best) best = t;
    }
    return best;
}

/** Shortest signed angle from a to b, radians. */
export function angleDelta(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
}
