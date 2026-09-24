// Stompworld rules shared by live play (play.js) and the headless AI sim
// (sim.js): sizes, the hero's platformer tuning, enemy motion, stomps and
// beam hits. Both sides import these so a trained agent plays the same game
// a human does.

import { Platformer } from "/app/platformer.js";

export const TILE = 32;
export const VIEW_W = 800;
export const VIEW_H = 576;

/** Hero body size and platformer tuning. */
export const HERO_W = 24;
export const HERO_H = 30;
export const HERO_CFG = {
    gravity: 2400, maxFall: 900,
    runSpeed: 240, accel: 1800,
    airAccel: 1200, friction: 1800,
    jumpVel: -850, jumpCutMul: 0.45,
    coyoteTime: 100, jumpBuffer: 120,
};

/** Upward kick after landing on a stomper. */
export const STOMP_BOUNCE_VY = -380;
const STOMP_GRAVITY = 1800;
const STOMP_MAX_FALL = 800;

/** Beam weapon geometry. */
export const BEAM_LENGTH = 600;
export const BEAM_THICKNESS = 8;
export const EXPLOSION_R = 56;

/** Level spawn point → the hero body's top-left (it drops the last 4 px). */
export function spawnTop(spawn) { return spawn.y - 4; }

/** A hero body with its top-left at (x, y). */
export function createHero(x, y) {
    const p = Platformer.createBody({ x, y, w: HERO_W, h: HERO_H, cfg: HERO_CFG });
    p.facing = 1;
    return p;
}

export function overlaps(a, b) {
    return a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h;
}

/** True once the hero is inside the flag pole's column. */
export function touchingFlag(p, flag) {
    return !!flag && p.x + p.w >= flag.x + 8 && p.x <= flag.x + flag.w - 8;
}

// ── Enemies ─────────────────────────────────────────────────────────────

/** Walk a stomper: gravity, bounce off walls, turn at ledges. */
export function stepStomper(s, dt, tm) {
    if (s.ragdoll) { stepRagdoll(s, dt); return; }
    if (!s.alive) { s.squashTimer -= dt; return; }
    s.animT += dt;
    const dts = dt / 1000;
    s.vy = Math.min(STOMP_MAX_FALL, s.vy + STOMP_GRAVITY * dts);
    s.onGround = false;
    moveX(s, s.vx * dts, tm);
    moveY(s, s.vy * dts, tm);
    if (s.onGround) {
        const probeX = s.vx > 0 ? s.x + s.w + 1 : s.x - 1;
        if (!tm.solidAtPx(probeX, s.y + s.h + 2)) s.vx = -s.vx;
    }
}

function moveX(s, dx, tm) {
    s.x += dx;
    const r0 = Math.floor(s.y / TILE);
    const r1 = Math.floor((s.y + s.h - 0.001) / TILE);
    if (dx === 0) return;
    const col = dx > 0 ? Math.floor((s.x + s.w - 0.001) / TILE) : Math.floor(s.x / TILE);
    for (let r = r0; r <= r1; r++) {
        if (!tm.solidAt(col, r)) continue;
        if (dx > 0) { s.x = col * TILE - s.w; s.vx = -Math.abs(s.vx); }
        else { s.x = (col + 1) * TILE; s.vx = Math.abs(s.vx); }
        return;
    }
}

function moveY(s, dy, tm) {
    s.y += dy;
    const c0 = Math.floor(s.x / TILE);
    const c1 = Math.floor((s.x + s.w - 0.001) / TILE);
    if (dy === 0) return;
    const row = dy > 0 ? Math.floor((s.y + s.h - 0.001) / TILE) : Math.floor(s.y / TILE);
    for (let c = c0; c <= c1; c++) {
        if (!tm.solidAt(c, row)) continue;
        if (dy > 0) { s.y = row * TILE - s.h; s.onGround = true; }
        else s.y = (row + 1) * TILE;
        s.vy = 0;
        return;
    }
}

/** Patrol a flyer around its spawn, bobbing if it has a bob amplitude. */
export function stepFlyer(f, dt) {
    if (f.ragdoll) { stepRagdoll(f, dt); return; }
    if (f.alive === false) return;
    const dts = dt / 1000;
    f.x += f.vx * dts;
    if (f.x > f.spawnX + f.patrolRange) {
        f.x = f.spawnX + f.patrolRange;
        f.vx = -Math.abs(f.vx);
    } else if (f.x < f.spawnX - f.patrolRange) {
        f.x = f.spawnX - f.patrolRange;
        f.vx = Math.abs(f.vx);
    }
    if (f.bobAmp > 0) {
        f.bobT += dts;
        const y = f.spawnY + Math.sin(f.bobT * f.bobFreq) * f.bobAmp;
        f.vy = (y - f.y) / dts;
        f.y = y;
    } else {
        f.vy = 0;
    }
    f.animT += dt;
}

/** Tumbling body flung by a beam (live play only). */
export function stepRagdoll(e, dt) {
    const dts = dt / 1000;
    e.vy += 1800 * dts;
    e.x += e.vx * dts;
    e.y += e.vy * dts;
    e.rot = (e.rot || 0) + (e.rotVel || 0) * dts;
    e.ragdollTTL -= dt;
}

/**
 * Hero vs live stompers: landing on one from above squashes it and bounces
 * the hero. Returns { kills, hurt } (hurt: touched one from the side).
 */
export function resolveStomps(p, stompers) {
    let kills = 0;
    for (const s of stompers) {
        if (!s.alive || s.ragdoll || !overlaps(p, s)) continue;
        if (p.vy > 0 && (p.y + p.h - s.y) < 16) {
            s.alive = false;
            s.squashTimer = 350;
            p.vy = STOMP_BOUNCE_VY;
            kills++;
        } else {
            return { kills, hurt: true };
        }
    }
    return { kills, hurt: false };
}

/** Hero touching any live flyer. */
export function touchingFlyer(p, flyers) {
    for (const f of flyers) {
        if (f.alive !== false && !f.ragdoll && overlaps(p, f)) return true;
    }
    return false;
}

/**
 * Does a beam from (x0,y0) to (x1,y1) with half-width `half`, or its
 * explosion of radius r at (hx,hy), touch entity e's box?
 */
export function beamHits(e, x0, y0, x1, y1, half, hx, hy, r) {
    const ex0 = e.x, ex1 = e.x + e.w, ey0 = e.y, ey1 = e.y + e.h;
    const cx = Math.min(ex1, Math.max(ex0, hx));
    const cy = Math.min(ey1, Math.max(ey0, hy));
    if ((cx - hx) * (cx - hx) + (cy - hy) * (cy - hy) <= r * r) return true;
    // Liang–Barsky clip of the segment against the box grown by `half`.
    const dx = x1 - x0, dy = y1 - y0;
    const ps = [-dx, dx, -dy, dy];
    const qs = [x0 - (ex0 - half), (ex1 + half) - x0, y0 - (ey0 - half), (ey1 + half) - y0];
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 4; i++) {
        if (ps[i] === 0) {
            if (qs[i] < 0) return false;
            continue;
        }
        const t = qs[i] / ps[i];
        if (ps[i] < 0) {
            if (t > t1) return false;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return false;
            if (t < t1) t1 = t;
        }
    }
    return true;
}
