// Stompworld live play: one run of the level for a human. Movement, enemies
// and hit tests come from rules.js (the AI sim uses the same ones); this file
// adds what only a human run has: lives, the clock, aimed beam shots that
// carve terrain and fling enemies, the death and flag animations.

import { Platformer } from "/lib/platformer.js";
import { buildLevel, spawnMobs } from "/app/level.js";
import {
    BEAM_LENGTH, BEAM_THICKNESS, EXPLOSION_R,
    createHero, spawnTop, stepStomper, stepFlyer, resolveStomps, touchingFlyer,
    touchingFlag, beamHits,
} from "/app/rules.js";
import { createCamera, followBody, makeFlash, ageFlashes } from "/app/render.js";

export const LIVES = 3;
export const TIME_LIMIT = 300;
export const SCORE = {
    perPixel: 0.05,   // terrain blasted by the beam
    stomp: 100,
    beamStomp: 100,
    beamFlyer: 500,
    flag: 1000,
};
const WEAPON_COOLDOWN_MS = 250;
const EXPLOSION_TTL_MS = 320;
const DEATH_MS = 900;
const WIN_WALK_MS = 1500;
const RAGDOLL_MS = 2200;

/** Fresh play state. `cue(name)` plays a sound. */
export function createPlay(cue) {
    const lvl = buildLevel({ destructible: true });
    const w = {
        cue,
        tilemap: lvl.tilemap,
        flag: lvl.flag,
        spawn: lvl.spawn,
        stompers: lvl.stompers,
        flyers: lvl.flyers,
        hero: null,
        cam: createCamera(lvl.tilemap),
        score: 0,
        lives: LIVES,
        timeLeft: TIME_LIMIT,
        deathTimer: 0,
        winTimer: 0,
        hasWeapon: true,     // play starts armed; the pickup is a training goal
        weaponCooldown: 0,
        beams: [],
        explosions: [],
        tick: 0,
    };
    placeHero(w);
    return w;
}

function placeHero(w) {
    w.hero = createHero(w.spawn.x, spawnTop(w.spawn));
    followBody(w.cam, w.hero, true);
}

/** After a lost life: hero back at spawn, enemies respawned, clock reset. */
function respawn(w) {
    placeHero(w);
    const mobs = spawnMobs();
    w.stompers = mobs.stompers;
    w.flyers = mobs.flyers;
    w.timeLeft = TIME_LIMIT;
    w.weaponCooldown = 0;
    w.deathTimer = 0;
}

/**
 * Advance one frame. `c` = { left, right, jumpHeld, jumpPressed, fire, aim }
 * (aim is a world point). Returns "win" or "gameover" when the run ends.
 */
export function stepPlay(w, dt, c) {
    w.tick += dt / (1000 / 60);
    w.beams = ageFlashes(w.beams, dt);
    w.explosions = ageFlashes(w.explosions, dt);
    pruneRagdolls(w);

    if (w.winTimer > 0) return stepWinWalk(w, dt);
    if (w.deathTimer > 0) return stepDeath(w, dt);

    const before = Math.floor(w.timeLeft);
    w.timeLeft -= dt / 1000;
    if (w.timeLeft <= 0) { w.timeLeft = 0; kill(w); return null; }
    const now = Math.floor(w.timeLeft);
    if (now !== before && now >= 1 && now <= 5) w.cue("timeWarn");

    const ev = Platformer.step(w.hero, {
        left: c.left, right: c.right, jumpHeld: c.jumpHeld, jumpPressed: c.jumpPressed,
    }, w.tilemap, dt);
    if (ev.jumped) w.cue("jump");
    if (ev.landed) w.cue("land");

    if (w.weaponCooldown > 0) w.weaponCooldown -= dt;
    if (c.fire) fireBeam(w, c.aim);

    stepMobs(w, dt);
    const stomp = resolveStomps(w.hero, w.stompers);
    if (stomp.kills) { w.score += stomp.kills * SCORE.stomp; w.cue("stomp"); }
    if (stomp.hurt || touchingFlyer(w.hero, w.flyers) || w.hero.y > w.tilemap.heightPx + 64) {
        kill(w);
    } else if (touchingFlag(w.hero, w.flag)) {
        w.score += SCORE.flag;
        w.cue("win");
        w.winTimer = WIN_WALK_MS;
    }
    follow(w);
    return null;
}

function stepMobs(w, dt) {
    for (const s of w.stompers) stepStomper(s, dt, w.tilemap);
    for (const f of w.flyers) stepFlyer(f, dt);
}

function follow(w) {
    followBody(w.cam, w.hero);
}

/** The hero strolls off past the flag, then the run is won. */
function stepWinWalk(w, dt) {
    w.winTimer -= dt;
    w.hero.vx = 80;
    Platformer.step(w.hero, { right: true }, w.tilemap, dt);
    stepMobs(w, dt);
    follow(w);
    return w.winTimer <= 0 ? "win" : null;
}

/** The hero drops off-screen; then respawn or game over. */
function stepDeath(w, dt) {
    w.deathTimer -= dt;
    w.hero.vy += 2400 * (dt / 1000);
    w.hero.y += w.hero.vy * (dt / 1000);
    if (w.deathTimer > 0) return null;
    if (w.lives <= 0) {
        w.cue("gameover");
        return "gameover";
    }
    respawn(w);
    return null;
}

function kill(w) {
    if (w.deathTimer > 0) return;
    w.lives--;
    w.cue("die");
    w.deathTimer = DEATH_MS;
}

// ── Beam ────────────────────────────────────────────────────────────────

/** Fire toward a world point: carve terrain, fling what it touches. */
export function fireBeam(w, aim) {
    if (!w.hasWeapon || w.weaponCooldown > 0) return false;
    const p = w.hero;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    const dist = aim ? Math.hypot(aim.x - px, aim.y - py) : 0;
    const ux = dist < 1 ? (p.facing < 0 ? -1 : 1) : (aim.x - px) / dist;
    const uy = dist < 1 ? 0 : (aim.y - py) / dist;
    if (Math.abs(ux) > 0.05) p.facing = ux < 0 ? -1 : 1;

    const start = p.w / 2 + 2;
    const x0 = px + ux * start, y0 = py + uy * start;
    const r = w.tilemap.damageBeam(x0, y0, px + ux * BEAM_LENGTH, py + uy * BEAM_LENGTH, BEAM_THICKNESS, true);
    const hx = r.hitX, hy = r.hitY;
    const blast = r.hit ? EXPLOSION_R : 0;
    let cleared = r.cleared | 0;
    if (blast) cleared += w.tilemap.damageCircle(hx, hy, blast) | 0;
    w.score += Math.floor(cleared * SCORE.perPixel);

    w.beams.push(makeFlash({ x0, y0, x1: hx, y1: hy }));
    if (blast) w.explosions.push({ cx: hx, cy: hy, rMax: blast, ttl: EXPLOSION_TTL_MS, ttlMax: EXPLOSION_TTL_MS });

    const half = BEAM_THICKNESS / 2 + 2;
    const dir = ux < 0 ? -1 : 1;
    for (const f of w.flyers) {
        if (f.ragdoll || !beamHits(f, x0, y0, hx, hy, half, hx, hy, blast)) continue;
        ragdollify(f, dir);
        w.score += SCORE.beamFlyer;
    }
    for (const s of w.stompers) {
        if (!s.alive || s.ragdoll || !beamHits(s, x0, y0, hx, hy, half, hx, hy, blast)) continue;
        ragdollify(s, dir);
        w.score += SCORE.beamStomp;
    }
    w.cue("beam");
    if (r.hit) w.cue("boom");
    w.weaponCooldown = WEAPON_COOLDOWN_MS;
    return true;
}

function rand(min, max) { return min + Math.random() * (max - min); }

function ragdollify(e, dir) {
    e.alive = false;
    e.ragdoll = true;
    e.vx = dir * rand(180, 380) + rand(-60, 60);
    e.vy = -rand(420, 720);
    e.rot = 0;
    e.rotVel = rand(-12, 12);
    e.ragdollTTL = RAGDOLL_MS;
}

function pruneRagdolls(w) {
    const floor = w.tilemap.heightPx + 200;
    const keep = (e) => !e.ragdoll || (e.ragdollTTL > 0 && e.y < floor);
    if (w.flyers.some((e) => !keep(e))) w.flyers = w.flyers.filter(keep);
    if (w.stompers.some((e) => !keep(e))) w.stompers = w.stompers.filter(keep);
}
