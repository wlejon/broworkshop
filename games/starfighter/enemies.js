// enemies.js — enemy / obstacle kinds: factories, flight paths, and one
// table entry per kind with update(e, dt, world) and draw(ctx, cam, e).
//
// `world` is the Flight session (flight.js): rand(), railSpeed, ship,
// spawnEnemyBolt(x, y, z), takeDamage(n), radio(text, ms), portMissed().
// Nothing here touches the DOM; draw goes through a camera (camera.js).

import { NEAR_Z } from "/app/camera.js";

// ── Meshes ────────────────────────────────────────────────────────────────

// Twin-vane fighter.
const FIGHTER_VERTS = [
    { x: 0, y: 0, z: 0.6 }, { x: 0, y: 0, z: -0.6 },          // nose, tail
    { x: 1.2, y: 0.9, z: 0 }, { x: 1.2, y: -0.9, z: 0 },      // right vane
    { x: -1.2, y: 0.9, z: 0 }, { x: -1.2, y: -0.9, z: 0 },    // left vane
    { x: 0.35, y: 0, z: 0 }, { x: -0.35, y: 0, z: 0 },        // pod attach
];
const FIGHTER_EDGES = [[0, 1], [0, 6], [0, 7], [1, 6], [1, 7], [2, 3], [2, 6], [3, 6], [4, 5], [4, 7], [5, 7]];

// Asymmetric heavy fighter.
const ACE_VERTS = [
    { x: 0, y: 0, z: 0.9 }, { x: 0, y: 0, z: -0.8 },
    { x: 1.6, y: 0.4, z: 0.2 }, { x: 0.6, y: -0.3, z: -0.3 },
    { x: -1.6, y: 0.4, z: 0.2 }, { x: -0.6, y: -0.3, z: -0.3 },
    { x: 0, y: 0.6, z: 0 },
];
const ACE_EDGES = [[0, 1], [0, 2], [0, 4], [0, 6], [1, 3], [1, 5], [1, 6], [2, 3], [4, 5], [3, 5]];

const OCTA_EDGES = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]];
// Eight corners: bottom face 0..3, top face 4..7.
const BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const QUAD_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0]];

/** Box from a bottom rectangle (hx0, hz0 at y0) to a top one (hx1, hz1 at y1). */
function box(hx0, hz0, y0, hx1, hz1, y1) {
    return [
        { x: -hx0, y: y0, z: -hz0 }, { x: hx0, y: y0, z: -hz0 },
        { x: hx0, y: y0, z: hz0 }, { x: -hx0, y: y0, z: hz0 },
        { x: -hx1, y: y1, z: -hz1 }, { x: hx1, y: y1, z: -hz1 },
        { x: hx1, y: y1, z: hz1 }, { x: -hx1, y: y1, z: hz1 },
    ];
}

const BUNKER_VERTS = box(2, 1.2, 0, 1.5, 1.0, 1.8);

const square = (r) => [{ x: -r, y: r, z: 0 }, { x: r, y: r, z: 0 }, { x: r, y: -r, z: 0 }, { x: -r, y: -r, z: 0 }];

/** Pitch (around X), then yaw (around Y), then scale. */
function xform(verts, yaw, pitch, scale) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    return verts.map((v) => {
        const y1 = v.y * cp - v.z * sp;
        const z1 = v.y * sp + v.z * cp;
        return { x: (v.x * cy - z1 * sy) * scale, y: y1 * scale, z: (v.x * sy + z1 * cy) * scale };
    });
}

// ── Factories ─────────────────────────────────────────────────────────────

/** Fighter on `path(u)`, u in 0..1 over `life` ms. */
export function createFighter({ path, life = 5200, fireAt = 0.45, fireCount = 2 } = {}) {
    return {
        kind: "fighter", path, life, t: 0,
        x: 0, y: 0, z: 300, radius: 1.6, scale: 1.5, yaw: 0, pitch: 0,
        color: "#6f6", hp: 1, score: 1000, dead: false,
        fireAt, fireCount, fired: 0,
    };
}

/** The Black Ace: cannot be killed; a hit makes it break off (+2000). */
export function createAce({ path, life = 6500 } = {}) {
    return {
        kind: "ace", path, life, t: 0,
        x: 0, y: 0, z: 300, radius: 2.2, scale: 1.9, yaw: 0, pitch: 0,
        color: "#f84", hp: 999, score: 0, dead: false,
        flee: false, fireAt: 0.4, fireCount: 3, fired: 0,
    };
}

/** Dodge-only threat flying straight at the camera. */
export function createFireball({ x = 0, y = 0, z = 260, vz = -0.18 } = {}) {
    return { kind: "fireball", x, y, z, vz, radius: 2.4, scale: 2.4, color: "#f66", t: 0, hp: 0, score: 0, dead: false };
}

/** Surface tower; origin at the base, the glowing top is where it is hit. */
export function createTower({ x = 0, y = 0, z = 300, h = 14, rand = Math.random } = {}) {
    return {
        kind: "tower", x, y, z, height: h, radius: 3.5, hitY: h - 2,
        hp: 1, score: 300, color: "#6a6", topColor: "#ff6", dead: false,
        fireCooldown: 900 + rand() * 1200, fireVariance: 700 + rand() * 600,
    };
}

export function createBunker({ x = 0, y = 0, z = 300 } = {}) {
    return { kind: "bunker", x, y, z, radius: 2.2, hp: 1, score: 50, color: "#5a5", dead: false };
}

/** Rigid walkway at ship altitude; soaks shots and hurts on contact. */
export function createCatwalk({ x = 0, y = 6, z = 300, spanX = 10 } = {}) {
    return { kind: "catwalk", x, y, z, spanX, radius: 4.0, hp: 99, score: 0, color: "#a84", dead: false, hasHit: false };
}

/** Trench column blocking a lane; two shots to clear. */
export function createPylon({ x = 0, z = 300, halfWidth = 1.6 } = {}) {
    return { kind: "pylon", x, y: 0, z, radius: 2.0, halfWidth, hp: 2, score: 100, color: "#88f", dead: false, hasHit: false };
}

/** Wall-mounted trench turret; side +1 right wall, -1 left. */
export function createTurret({ x = 0, y = 0, z = 300, side = 1, rand = Math.random } = {}) {
    return { kind: "turret", x, y, z, side, radius: 1.8, hp: 1, score: 50, color: "#f88", dead: false, fireCooldown: 700 + rand() * 1100 };
}

/** The reactor vent: the objective of the trench run. */
export function createPort({ x = 0, y = 0, z = 420 } = {}) {
    return { kind: "port", x, y, z, radius: 2.8, innerRadius: 1.0, hp: 1, score: 25000, color: "#fe8", dead: false, resolved: false };
}

// ── Paths ─────────────────────────────────────────────────────────────────

function bezier(s, p, e) {
    return (u) => {
        const iu = 1 - u;
        return {
            x: iu * iu * s.x + 2 * iu * u * p.x + u * u * e.x,
            y: iu * iu * s.y + 2 * iu * u * p.y + u * u * e.y,
            z: iu * iu * s.z + 2 * iu * u * p.z + u * u * e.z,
        };
    };
}

/** Enter near the horizon, pass close to the player, exit behind. */
export function swoopPath(startX, startY, passX, passY, endX, endY) {
    return bezier({ x: startX, y: startY, z: 260 }, { x: passX, y: passY, z: 35 }, { x: endX, y: endY, z: -40 });
}

/** Side-to-side fly-by that never gets close. */
export function arcPath(startX, startY, endX, endY, passZ = 60) {
    return bezier(
        { x: startX, y: startY, z: 220 },
        { x: (startX + endX) * 0.5, y: (startY + endY) * 0.5 + 10, z: passZ },
        { x: endX, y: endY, z: -20 },
    );
}

/**
 * Random swoop sized for the visible cone (half-width ~0.77z, half-height
 * ~0.58z at 60° on 4:3), so the enemy crosses the screen, not the margins.
 */
export function randomSwoop(rand = Math.random) {
    const side = rand() < 0.5 ? -1 : 1;
    const startX = side * (40 + rand() * 30);
    const startY = (rand() * 2 - 1) * 30;
    const passX = (rand() * 2 - 1) * 14;
    const passY = (rand() * 2 - 1) * 10;
    const endX = -side * (25 + rand() * 20);
    const endY = startY + (rand() * 2 - 1) * 15;
    return swoopPath(startX, startY, passX, passY, endX, endY);
}

// ── Behaviours ────────────────────────────────────────────────────────────

function updateFlyer(e, dt, world) {
    e.t += dt;
    const u = Math.min(1, e.t / e.life);
    if (e.flee) {
        // A spooked ace accelerates away.
        e.z += 0.25 * dt;
        e.x += (e.x < 0 ? -0.05 : 0.05) * dt;
        if (e.z > 400) e.dead = true;
        return;
    }
    if (e.path) {
        const lx = e.x, lz = e.z;
        const p = e.path(u);
        e.x = p.x; e.y = p.y; e.z = p.z;
        const dx = e.x - lx, dz = e.z - lz;
        if (Math.abs(dx) + Math.abs(dz) > 0.01) e.yaw = Math.atan2(dx, -dz);
        e.pitch = Math.sin(e.t * 0.002) * 0.1;
        if (u >= 1) e.dead = true;
    }
    // Shots spread along the path from fireAt, 0.12 apart.
    if (e.fired < e.fireCount && u >= e.fireAt + e.fired * 0.12) {
        world.spawnEnemyBolt(e.x, e.y, e.z);
        e.fired++;
    }
}

/** Ground and trench features ride the rail toward the camera. */
function scroll(e, dt, world) {
    e.z -= world.railSpeed * dt;
    if (e.z < -30) e.dead = true;
    return !e.dead;
}

function drawMesh(ctx, cam, e, verts, edges) {
    cam.edges(ctx, xform(verts, e.yaw, e.pitch, e.scale), edges, e.color, 1, e.x, e.y, e.z);
}

export const KINDS = {
    fighter: {
        update: updateFlyer,
        draw: (ctx, cam, e) => drawMesh(ctx, cam, e, FIGHTER_VERTS, FIGHTER_EDGES),
    },

    ace: {
        update: updateFlyer,
        draw: (ctx, cam, e) => drawMesh(ctx, cam, e, ACE_VERTS, ACE_EDGES),
    },

    fireball: {
        update(e, dt, world) {
            e.t += dt;
            e.z += e.vz * dt;
            if (e.z < NEAR_Z) {
                world.takeDamage(1);
                e.dead = true;
            }
        },
        draw(ctx, cam, e) {
            const r = e.scale * (1 + 0.15 * Math.sin(e.t * 0.02));
            const verts = [
                { x: 0, y: r, z: 0 }, { x: 0, y: -r, z: 0 }, { x: r, y: 0, z: 0 },
                { x: -r, y: 0, z: 0 }, { x: 0, y: 0, z: r }, { x: 0, y: 0, z: -r },
            ];
            cam.edges(ctx, verts, OCTA_EDGES, e.color, 1, e.x, e.y, e.z);
        },
    },

    tower: {
        update(e, dt, world) {
            if (!scroll(e, dt, world)) return;
            e.fireCooldown -= dt;
            if (e.fireCooldown <= 0 && e.z < 180 && e.z > 20) {
                world.spawnEnemyBolt(e.x, e.y + e.height, e.z);
                e.fireCooldown = e.fireVariance + world.rand() * 800;
            }
        },
        draw(ctx, cam, e) {
            const h = e.height;
            cam.edges(ctx, box(1, 1, 0, 0.6, 0.6, h), BOX_EDGES, e.color, 1, e.x, e.y, e.z);
            // Glowing top: a cross inside the top square.
            const top = [{ x: -0.6, y: h, z: -0.6 }, { x: 0.6, y: h, z: 0.6 }, { x: 0.6, y: h, z: -0.6 }, { x: -0.6, y: h, z: 0.6 }];
            cam.edges(ctx, top, [[0, 1], [2, 3]], e.topColor, 1, e.x, e.y, e.z);
        },
    },

    bunker: {
        update: scroll,
        draw: (ctx, cam, e) => cam.edges(ctx, BUNKER_VERTS, BOX_EDGES, e.color, 1, e.x, e.y, e.z),
    },

    catwalk: {
        update(e, dt, world) {
            if (!scroll(e, dt, world)) return;
            // As it passes the ship: inside its span and altitude band?
            if (!e.hasHit && e.z > 0 && e.z < 4) {
                const ship = world.ship;
                if (Math.abs(ship.x - e.x) < e.spanX && Math.abs(ship.y - e.y) < 2.2) {
                    e.hasHit = true;
                    world.takeDamage(1);
                    world.radio("CATWALK IMPACT", 900);
                }
            }
        },
        draw: (ctx, cam, e) => cam.edges(ctx, box(e.spanX, 0.4, 0, e.spanX, 0.4, 1), BOX_EDGES, e.color, 1, e.x, e.y, e.z),
    },

    pylon: {
        update(e, dt, world) {
            if (!scroll(e, dt, world)) return;
            if (!e.hasHit && e.z > 0 && e.z < 3 && Math.abs(world.ship.x - e.x) < e.halfWidth + 2.0) {
                e.hasHit = true;
                world.takeDamage(1);
                world.radio("PYLON IMPACT", 900);
            }
        },
        draw: (ctx, cam, e) => cam.edges(ctx, box(e.halfWidth, 0.5, -10, e.halfWidth, 0.5, 10), BOX_EDGES, e.color, 1, e.x, 0, e.z),
    },

    turret: {
        update(e, dt, world) {
            if (!scroll(e, dt, world)) return;
            e.fireCooldown -= dt;
            if (e.fireCooldown <= 0 && e.z > 12 && e.z < 180) {
                world.spawnEnemyBolt(e.x, e.y, e.z);
                e.fireCooldown = 900 + world.rand() * 900;
            }
        },
        draw(ctx, cam, e) {
            // Angular mount flush against the wall, pointing into the trench.
            const verts = [
                { x: 0, y: -0.8, z: -0.8 }, { x: 0, y: -0.8, z: 0.8 },
                { x: 0, y: 0.8, z: 0.8 }, { x: 0, y: 0.8, z: -0.8 },
                { x: -e.side * 1.4, y: 0, z: 0 },
            ];
            cam.edges(ctx, verts, [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]], e.color, 1, e.x, e.y, e.z);
        },
    },

    port: {
        update(e, dt, world) {
            if (!scroll(e, dt, world)) return;
            // Slipping past the ship unhit is a miss.
            if (!e.resolved && e.z < 6) {
                e.resolved = true;
                world.portMissed();
            }
        },
        draw(ctx, cam, e) {
            // Concentric squares sized from the runtime radii, so a
            // tightened vent on later loops looks as small as it plays.
            const outer = e.radius * 0.78;
            cam.edges(ctx, square(outer), QUAD_EDGES, e.color, 1, e.x, e.y, e.z);
            cam.edges(ctx, square(e.innerRadius * 0.9), QUAD_EDGES, "#fff", 1, e.x, e.y, e.z);
            cam.line(ctx, e.x - outer, e.y, e.z, e.x + outer, e.y, e.z, e.color, 0.6);
            cam.line(ctx, e.x, e.y - outer, e.z, e.x, e.y + outer, e.z, e.color, 0.6);
        },
    },
};

export function updateEnemy(e, dt, world) {
    KINDS[e.kind].update(e, dt, world);
}

export function drawEnemy(ctx, cam, e) {
    KINDS[e.kind].draw(ctx, cam, e);
}
