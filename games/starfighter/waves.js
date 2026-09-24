// waves.js — the three sectors of a campaign loop: space, surface, trench.
//
// Each entry of WAVES is { create(world), update(ws, dt, world),
// draw(ctx, cam, ws, stars), isComplete(ws, world) }. A wave schedules
// spawns and owns its backdrop geometry (star field / ground grid / trench);
// the Flight session (flight.js) owns enemies, bolts, collisions and score.
// All randomness goes through world.rand().

import {
    createFighter, createAce, createFireball, createTower, createBunker,
    createCatwalk, createPylon, createTurret, createPort, swoopPath, randomSwoop,
} from "/app/enemies.js";

export const SPACE = "space", SURFACE = "surface", TRENCH = "trench";
export const ORDER = [SPACE, SURFACE, TRENCH];

/** Sector number (1..3) of a wave. */
export const sectorOf = (wave) => ORDER.indexOf(wave) + 1;
/** The wave after `wave`, or null at the end of a loop. */
export const nextWave = (wave) => ORDER[ORDER.indexOf(wave) + 1] || null;
/** Difficulty / bonus scale for campaign loop n (1-based), capped at 3. */
export const loopScale = (loop) => Math.min(3.0, 1 + (loop - 1) * 0.35);

const SPAWN_HORIZON = 280;

// ── Space: fighter packs, fireballs, the Black Ace ────────────────────────

function createSpace(world) {
    const loop = world.loop;
    const totalFighters = Math.round(6 + (loop - 1) * 2);
    const schedule = [];
    let t = 1500;
    const perWave = [Math.ceil(totalFighters / 3), Math.ceil(totalFighters / 3)];
    perWave.push(totalFighters - perWave[0] - perWave[1]);
    for (const n of perWave) {
        for (let i = 0; i < n; i++) schedule.push({ type: "fighter", at: t + i * 650 });
        t += n * 650 + 1500;
    }
    // Two dodge-only fireballs between packs.
    schedule.push({ type: "fireball", at: schedule[Math.floor(schedule.length * 0.3)].at + 900 });
    schedule.push({ type: "fireball", at: schedule[Math.floor(schedule.length * 0.6)].at + 900 });
    // The Black Ace, once, near the end; earlier on later loops.
    schedule.push({ type: "ace", at: Math.max(4000, t - 3500 - (loop - 1) * 600) });
    schedule.sort((a, b) => a.at - b.at);

    return { kind: SPACE, elapsed: 0, spawned: 0, totalFighters, schedule, finishAfterMs: t + 2800, loopScale: loopScale(loop) };
}

function updateSpace(ws, dt, world) {
    ws.elapsed += dt;
    const rand = world.rand;
    while (ws.spawned < ws.schedule.length && ws.schedule[ws.spawned].at <= ws.elapsed) {
        const entry = ws.schedule[ws.spawned++];
        if (entry.type === "fighter") {
            world.addEnemy(createFighter({
                path: randomSwoop(rand),
                life: 4400 + rand() * 1200,
                fireCount: 1 + (rand() < ws.loopScale - 0.8 ? 1 : 0),
            }));
        } else if (entry.type === "fireball") {
            world.addEnemy(createFireball({
                x: (rand() * 2 - 1) * 14,
                y: (rand() * 2 - 1) * 10,
                z: 240,
                vz: -0.14 - rand() * 0.05,
            }));
            world.radio("FIREBALL :: EVADE", 900);
        } else if (entry.type === "ace") {
            // A slow, wide swoop straight at the player.
            world.addEnemy(createAce({ path: swoopPath(55, 18, 4, 2, -55, -12), life: 7000 }));
            world.radio("!! BLACK ACE INBOUND !!", 2000);
            world.cue("ace");
        }
    }
}

function isSpaceComplete(ws, world) {
    // Everything spawned and the sky is clear; a short grace lets the last
    // explosions breathe unless the finish timer already ran out.
    if (ws.spawned < ws.schedule.length || world.hasLiveEnemies()) return false;
    if (ws.elapsed < ws.finishAfterMs - 1000) return ws.elapsed > ws.schedule[ws.schedule.length - 1].at + 2000;
    return true;
}

// ── Surface: towers, bunkers and catwalks over a scrolling grid ───────────

export const GROUND_Y = -8;
const GRID_FAR = 320;
const GRID_STEP = 20;
const GRID_X_HALF = 90;
const GRID_LONGX = [-70, -40, -20, 0, 20, 40, 70];

/** Evenly spaced z positions that scroll toward the camera and wrap. */
function scrollers(far, step) {
    const zs = [];
    for (let g = 0; g < far / step; g++) zs.push(g * step);
    return zs;
}

function scrollAll(zs, adv, far) {
    for (let i = 0; i < zs.length; i++) {
        zs[i] -= adv;
        if (zs[i] < 0) zs[i] += far;
    }
}

/** Spawn schedule entries (anchored at their start z) once within the horizon. */
function spawnDue(ws, world, make) {
    while (ws.spawnCursor < ws.schedule.length) {
        const entry = ws.schedule[ws.spawnCursor];
        const liveZ = entry.z - ws.elapsed * ws.railSpeed;
        if (liveZ > SPAWN_HORIZON) break;
        world.addEnemy(make(entry, liveZ));
        ws.spawnCursor++;
    }
}

function createSurface(world) {
    const loop = world.loop, rand = world.rand;
    const scale = loopScale(loop);
    // Features stream in along z, tighter on later loops.
    const schedule = [];
    let z = 240;
    const featureCount = Math.round(14 + (loop - 1) * 3);
    for (let i = 0; i < featureCount; i++) {
        const r = rand();
        const laneX = (rand() * 2 - 1) * 40;
        if (r < 0.55) schedule.push({ type: "tower", x: laneX, z });
        else if (r < 0.85) schedule.push({ type: "bunker", x: laneX, z });
        else schedule.push({ type: "catwalk", x: laneX * 0.4, z, spanX: 14 + rand() * 8, y: (rand() * 2 - 1) * 6 });
        z += 18 + rand() * 22 - scale * 4;
    }
    return {
        kind: SURFACE, elapsed: 0, schedule, spawnCursor: 0,
        railSpeed: 0.085 * Math.min(1.4, 1 + (loop - 1) * 0.08),
        gridZ: scrollers(GRID_FAR, GRID_STEP),
        loopScale: scale,
        endSignalAt: 0,     // set once the schedule is exhausted
    };
}

function updateSurface(ws, dt, world) {
    ws.elapsed += dt;
    scrollAll(ws.gridZ, ws.railSpeed * dt, GRID_FAR);
    spawnDue(ws, world, (entry, z) => {
        if (entry.type === "tower") return createTower({ x: entry.x, y: GROUND_Y, z, rand: world.rand });
        if (entry.type === "bunker") return createBunker({ x: entry.x, y: GROUND_Y, z });
        return createCatwalk({ x: entry.x, y: entry.y, z, spanX: entry.spanX });
    });
    if (ws.spawnCursor >= ws.schedule.length && !ws.endSignalAt) ws.endSignalAt = ws.elapsed + 2800;
}

function drawSurface(ctx, cam, ws) {
    const W = cam.width(), H = cam.height();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // Horizon glow.
    const horizon = cam.project(0, GROUND_Y, GRID_FAR);
    if (horizon.visible) {
        const grd = ctx.createLinearGradient(0, horizon.y - 60, 0, horizon.y + 4);
        grd.addColorStop(0, "rgba(60, 40, 80, 0)");
        grd.addColorStop(1, "rgba(120, 60, 80, 0.25)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, horizon.y - 60, W, 64);
    }

    ctx.lineWidth = 1.2;
    for (const x of GRID_LONGX) cam.line(ctx, x, GROUND_Y, cam.NEAR_Z + 0.1, x, GROUND_Y, GRID_FAR, "#3a6", 0.7);
    for (const tz of ws.gridZ) {
        if (tz < cam.NEAR_Z + 0.2 || tz > GRID_FAR) continue;
        cam.line(ctx, -GRID_X_HALF, GROUND_Y, tz, GRID_X_HALF, GROUND_Y, tz, "#3a6", 0.25 + (1 - tz / GRID_FAR) * 0.6);
    }
}

function isSurfaceComplete(ws, world) {
    if (ws.spawnCursor < ws.schedule.length) return false;
    if (world.hasLiveEnemies()) return ws.elapsed > ws.endSignalAt + 4000;
    return ws.elapsed > ws.endSignalAt;
}

// ── Trench: pylons, catwalks, turrets, then the vent ──────────────────────

export const TRENCH_HALF_W = 12;
const FLOOR_Y = -9;
const CEIL_Y = 9;
const TRENCH_FAR = 360;
const RIB_STEP = 16;
/** The port is "locked" (lock tone, HUD) while this far ahead. */
export const LOCK_NEAR = 10, LOCK_FAR = 85;

function createTrench(world) {
    const loop = world.loop, rand = world.rand;
    const scale = loopScale(loop);
    const schedule = [];
    const featureCount = Math.round(10 + (loop - 1) * 2);
    let z = 240;
    for (let i = 0; i < featureCount; i++) {
        const r = rand();
        if (r < 0.35) {
            schedule.push({ type: "catwalk", x: 0, y: (rand() * 2 - 1) * 6, z, spanX: TRENCH_HALF_W + 1 });
        } else if (r < 0.70) {
            schedule.push({ type: "pylon", x: (rand() * 2 - 1) * (TRENCH_HALF_W - 2.5), z, halfWidth: 1.4 + rand() * 1.4 });
        } else {
            const side = rand() < 0.5 ? -1 : 1;
            schedule.push({ type: "turret", x: side * (TRENCH_HALF_W - 0.6), y: (rand() * 2 - 1) * 6, z, side });
        }
        z += 18 + rand() * 16 - scale * 3;
    }
    // The vent sits past every other feature.
    const portZ = z + 80;
    schedule.push({ type: "port", x: 0, y: 0, z: portZ });

    return {
        kind: TRENCH, elapsed: 0, schedule, spawnCursor: 0,
        railSpeed: 0.09 * Math.min(1.45, 1 + (loop - 1) * 0.09),
        ribZ: scrollers(TRENCH_FAR, RIB_STEP),
        loopScale: scale,
        port: null,
        portResolved: false,
        portZStart: portZ,
        lockPulse: 0,
        wasLocked: false,
    };
}

function updateTrench(ws, dt, world) {
    ws.elapsed += dt;
    scrollAll(ws.ribZ, ws.railSpeed * dt, TRENCH_FAR);
    spawnDue(ws, world, (entry, z) => {
        if (entry.type === "catwalk") return createCatwalk({ x: entry.x, y: entry.y, z, spanX: entry.spanX });
        if (entry.type === "pylon") return createPylon({ x: entry.x, z, halfWidth: entry.halfWidth });
        if (entry.type === "turret") return createTurret({ x: entry.x, y: entry.y, z, side: entry.side, rand: world.rand });
        // The vent tightens every loop: bullseye tolerance shrinks.
        const shrink = Math.max(0.45, 1 - (world.loop - 1) * 0.15);
        const p = createPort({ x: entry.x, y: entry.y, z });
        p.radius *= shrink;
        p.innerRadius *= shrink;
        ws.port = p;
        world.radio("VENT AHEAD  ::  STAY CENTERED", 2400);
        return p;
    });

    // Lock-on while the vent is in the window; the tone quickens as it nears.
    if (ws.port && !ws.port.resolved) {
        const pz = ws.port.z;
        const inLock = pz > LOCK_NEAR && pz < LOCK_FAR;
        if (inLock && !ws.wasLocked) ws.lockPulse = 0;
        if (inLock) {
            ws.lockPulse -= dt;
            if (ws.lockPulse <= 0) {
                world.cue("lock");
                ws.lockPulse = 90 + ((pz - LOCK_NEAR) / (LOCK_FAR - LOCK_NEAR)) * 260;
            }
        }
        ws.wasLocked = inLock;
        world.lockActive = inLock;
    } else {
        world.lockActive = false;
    }
}

function drawTrench(ctx, cam, ws) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cam.width(), cam.height());
    const col = "#68f";
    const near = cam.NEAR_Z + 0.2;
    // Wall edges and a floor centre line running far to near.
    for (const x of [-TRENCH_HALF_W, TRENCH_HALF_W]) {
        cam.line(ctx, x, FLOOR_Y, near, x, FLOOR_Y, TRENCH_FAR, col, 0.9);
        cam.line(ctx, x, CEIL_Y, near, x, CEIL_Y, TRENCH_FAR, col, 0.9);
    }
    cam.line(ctx, 0, FLOOR_Y, near, 0, FLOOR_Y, TRENCH_FAR, col, 0.35);
    // Ribs: one upright per wall plus a floor span per position.
    for (const rz of ws.ribZ) {
        if (rz < cam.NEAR_Z + 0.3 || rz > TRENCH_FAR) continue;
        const a = 0.25 + (1 - rz / TRENCH_FAR) * 0.6;
        cam.line(ctx, -TRENCH_HALF_W, FLOOR_Y, rz, -TRENCH_HALF_W, CEIL_Y, rz, col, a);
        cam.line(ctx, TRENCH_HALF_W, FLOOR_Y, rz, TRENCH_HALF_W, CEIL_Y, rz, col, a);
        cam.line(ctx, -TRENCH_HALF_W, FLOOR_Y, rz, TRENCH_HALF_W, FLOOR_Y, rz, col, a * 0.6);
    }
}

// ── Table ─────────────────────────────────────────────────────────────────

export const WAVES = {
    [SPACE]: {
        create: createSpace,
        update: updateSpace,
        draw: (ctx, cam, ws, stars) => stars.draw(ctx, cam),
        isComplete: isSpaceComplete,
    },
    [SURFACE]: {
        create: createSurface,
        update: updateSurface,
        draw: drawSurface,
        isComplete: isSurfaceComplete,
    },
    [TRENCH]: {
        create: createTrench,
        update: updateTrench,
        draw: drawTrench,
        isComplete: (ws) => ws.portResolved,
    },
};
