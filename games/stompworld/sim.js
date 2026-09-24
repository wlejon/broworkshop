// Headless, snapshot/restorable Stompworld environment for the AI (play
// agent, MCTS rollouts, training replay, demo). The human game is play.js;
// both step the hero and enemies with rules.js so they play the same.
//
// Action space: one head of 6 movement actions
//   0 idle, 1 left, 2 right, 3 jump, 4 jump-left, 5 jump-right
// One step(action) = FRAME_SKIP physics ticks of FIXED_DT_MS. Jump actions
// hold jump for the whole decision and press it on the first tick.
//
// Aiming is not learned. After each decision the sim auto-fires once when
// armed and off cooldown, at the nearest live enemy within
// AUTO_FIRE_RANGE_PX, or straight ahead if a destructible tile blocks the
// next few columns. The weapon comes from the pickup at column 115.
//
// Rewards per step:
//   REW_PER_PIXEL × terrain cleared, REW_STOMP × stomps,
//   REW_BEAM_STOMP / REW_BEAM_FLYER × beam kills, REW_PICKUP on pickup,
//   terminal REW_FLAG / REW_DEATH / REW_TIMEOUT (stall counts as timeout),
//   plus potential shaping γ·Φ' − Φ with Φ = −dist(hero, flag) × PBRS_SCALE.

import { Platformer } from "/lib/platformer.js";
import { buildLevel, GROUND_ID } from "/app/level.js";
import {
    TILE, HERO_CFG, BEAM_LENGTH, BEAM_THICKNESS, EXPLOSION_R,
    createHero, spawnTop, stepStomper, stepFlyer, resolveStomps, touchingFlyer,
    touchingFlag, overlaps, beamHits,
} from "/app/rules.js";

export { TILE, BEAM_LENGTH, BEAM_THICKNESS, EXPLOSION_R };
export const FIXED_DT_MS = 1000 / 60;
export const FRAME_SKIP = 4;
export const NUM_ACTIONS = 6;
export const HEAD_SIZES = [NUM_ACTIONS];
export const ACTION_NAMES = ["idle", "left", "right", "jump", "jump-left", "jump-right"];

export const REW_PER_PIXEL = 0.005;
export const REW_STOMP = 1.0;
export const REW_BEAM_STOMP = 1.0;
export const REW_BEAM_FLYER = 10.0;
export const REW_PICKUP = 3.0;
export const REW_FLAG = 1.5;
export const REW_DEATH = -0.5;
export const REW_TIMEOUT = -0.3;
const PBRS_GAMMA = 0.99;
const PBRS_SCALE = 0.01;

export const WEAPON_COOLDOWN_DECISIONS = 4;   // ~270 ms between shots
export const AUTO_FIRE_RANGE_PX = 240;
const AUTO_FIRE_LOOKAHEAD_TILES = 3;

function actionInput(a, firstTick, prevJumpHeld) {
    const jump = a === 3 || a === 4 || a === 5;
    return {
        left: a === 1 || a === 4,
        right: a === 2 || a === 5,
        jumpHeld: jump,
        jumpPressed: jump && !prevJumpHeld && firstTick,
    };
}

/** Why a finished episode ended. */
export function endReason(sim) {
    if (sim.won) return "flag";
    if (sim.stalledOut) return "stall";
    if (sim.timeLeft <= 0) return "timeout";
    return "death";
}

/**
 * A sim over a fresh copy of the level. opts: timeLimit (s, default 600),
 * stallDecisions (0 = never stall out), stallEpsilonPx, freeBackwalkPx,
 * trackDamagedTiles (false in workers that never draw).
 */
export function createLevelSim(opts = {}) {
    const lvl = buildLevel({ destructible: true, trackDamagedTiles: opts.trackDamagedTiles });
    return createSim({ ...lvl, ...opts });
}

/** Where a hero standing at `col` starts (for curriculum spawns). */
export function spawnAtCol(sim, col) {
    sim.setSpawn(col * TILE + 2, spawnTop(sim.levelSpawn));
}

export function createSim(level) {
    const { tilemap, flag, pickup } = level;
    const timeLimit = level.timeLimit ?? 600;
    const stallDecisions = level.stallDecisions ?? 0;
    const stallEpsilonPx = level.stallEpsilonPx ?? 8;
    const freeBackwalkPx = level.freeBackwalkPx ?? 160;

    let spawnX = level.spawn.x;
    let spawnY = spawnTop(level.spawn);
    const stomperTemplates = level.stompers.map((s) => ({ ...s }));
    const flyerTemplates = (level.flyers || []).map((f) => ({ ...f }));

    const state = {
        player: null, stompers: null, flyers: null,
        score: 0, alive: true, won: false, tick: 0,
        timeLeft: timeLimit, prevJumpHeld: false,
        hasWeapon: false, pickupCollected: false, weaponCooldown: 0,
        pixelsDestroyed: 0, beamStompKillsTotal: 0, beamFlyerKillsTotal: 0,
        recentBeams: [],
        prevPhi: 0,
        stallBestScore: 0, stallSince: 0, stalledOut: false, peakX: 0,
    };

    function potential() {
        if (!flag) return 0;
        const p = state.player;
        const dx = Math.abs(p.x + p.w / 2 - (flag.x + flag.w / 2));
        const dy = Math.abs(p.y + p.h / 2 - (flag.y + flag.h / 2));
        return -((dx + dy) / TILE) * PBRS_SCALE;
    }

    function reset() {
        state.player = createHero(spawnX, spawnY);
        state.stompers = stomperTemplates.map((s) => ({ ...s }));
        state.flyers = flyerTemplates.map((f) => ({ ...f, bobT: 0, animT: 0, alive: true }));
        Object.assign(state, {
            score: 0, alive: true, won: false, tick: 0,
            timeLeft: timeLimit, prevJumpHeld: false,
            hasWeapon: false, pickupCollected: false, weaponCooldown: 0,
            pixelsDestroyed: 0, beamStompKillsTotal: 0, beamFlyerKillsTotal: 0,
            stallSince: 0, stalledOut: false,
        });
        state.recentBeams.length = 0;
        tilemap.resetDamage();
        state.prevPhi = potential();
        state.peakX = state.player.x;
        state.stallBestScore = state.player.x;
    }
    reset();

    function setSpawn(x, y) {
        spawnX = x;
        if (y != null) spawnY = y;
    }

    // ── Snapshots (MCTS restores these thousands of times per search) ───
    const SCALARS = [
        "score", "alive", "won", "tick", "timeLeft", "prevJumpHeld",
        "hasWeapon", "pickupCollected", "weaponCooldown",
        "pixelsDestroyed", "beamStompKillsTotal", "beamFlyerKillsTotal",
        "prevPhi", "stallBestScore", "stallSince", "stalledOut", "peakX",
    ];

    function snapshot() {
        const p = state.player;
        const snap = {
            player: {
                x: p.x, y: p.y, w: p.w, h: p.h, vx: p.vx, vy: p.vy,
                onGround: p.onGround, facing: p.facing, coyote: p.coyote, buffer: p.buffer,
            },
            stompers: state.stompers.map((s) => ({
                x: s.x, y: s.y, w: s.w, h: s.h, vx: s.vx, vy: s.vy, onGround: s.onGround,
                alive: s.alive, squashTimer: s.squashTimer, animT: s.animT,
            })),
            flyers: state.flyers.map((f) => ({
                x: f.x, y: f.y, w: f.w, h: f.h, vx: f.vx, vy: f.vy,
                spawnX: f.spawnX, spawnY: f.spawnY, patrolRange: f.patrolRange,
                bobAmp: f.bobAmp, bobFreq: f.bobFreq, bobT: f.bobT,
                animT: f.animT, alive: f.alive,
            })),
        };
        for (const k of SCALARS) snap[k] = state[k];
        return snap;
    }

    function restore(snap) {
        Object.assign(state.player, snap.player, { cfg: HERO_CFG });
        state.stompers = snap.stompers.map((s) => ({ ...s }));
        state.flyers = (snap.flyers || []).map((f) => ({ ...f }));
        for (const k of SCALARS) state[k] = snap[k];
        state.hasWeapon = !!snap.hasWeapon;
        state.pickupCollected = !!snap.pickupCollected;
        state.stalledOut = !!snap.stalledOut;
        state.weaponCooldown = snap.weaponCooldown | 0;
        state.pixelsDestroyed = snap.pixelsDestroyed | 0;
        state.beamStompKillsTotal = snap.beamStompKillsTotal | 0;
        state.beamFlyerKillsTotal = snap.beamFlyerKillsTotal | 0;
        if (snap.prevPhi == null) state.prevPhi = potential();
        if (snap.stallBestScore == null) state.stallBestScore = state.player.x + state.score;
        if (snap.stallSince == null) state.stallSince = 0;
        if (snap.peakX == null) state.peakX = state.player.x;
    }

    // ── Auto-fire ───────────────────────────────────────────────────────

    /** Unit aim at the nearest live enemy in range, or null. */
    function autoTarget() {
        const p = state.player;
        const px = p.x + p.w / 2, py = p.y + p.h / 2;
        let best = AUTO_FIRE_RANGE_PX * AUTO_FIRE_RANGE_PX, bx = 0, by = 0, found = false;
        for (const list of [state.stompers, state.flyers]) {
            for (const e of list) {
                if (!e.alive) continue;
                const dx = e.x + e.w / 2 - px, dy = e.y + e.h / 2 - py;
                const d2 = dx * dx + dy * dy;
                if (d2 < best || (!found && d2 <= best)) { best = d2; bx = dx; by = dy; found = true; }
            }
        }
        if (!found) return null;
        const d = Math.sqrt(best) || 1;
        return { ux: bx / d, uy: by / d };
    }

    /** A destructible tile in the hero's row or the one above, just ahead. */
    function destructibleAhead() {
        const p = state.player;
        const dir = p.facing < 0 ? -1 : 1;
        const col = Math.floor((p.x + p.w / 2) / TILE);
        const row = Math.floor((p.y + p.h / 2) / TILE);
        for (let dc = 1; dc <= AUTO_FIRE_LOOKAHEAD_TILES; dc++) {
            const c = col + dc * dir;
            if (c < 0 || c >= tilemap.cols) return false;
            for (const r of [row, row - 1]) {
                if (r < 0 || r >= tilemap.rows || !tilemap.solidAt(c, r)) continue;
                const id = tilemap.data[r * tilemap.cols + c];
                if (id !== 0 && id !== GROUND_ID) return true;
            }
        }
        return false;
    }

    // Beam shapes go on the tilemap's overlay list (cheap to undo during
    // search); applyAction commits them into the bitmask for real moves.
    function fireOneBeam(ux, uy) {
        const p = state.player;
        if (ux > 0) p.facing = 1;
        else if (ux < 0) p.facing = -1;
        const px = p.x + p.w / 2, py = p.y + p.h / 2;
        const start = p.w / 2 + 2;
        const x0 = px + ux * start, y0 = py + uy * start;
        const r = tilemap.traceBeam(x0, y0, px + ux * BEAM_LENGTH, py + uy * BEAM_LENGTH);
        const hx = r.hitX, hy = r.hitY;
        tilemap.pushOverlayBeam(x0, y0, hx, hy, BEAM_THICKNESS);
        const blast = r.hit ? EXPLOSION_R : 0;
        if (blast) tilemap.pushOverlayCircle(hx, hy, blast);
        let cleared = (r.len * BEAM_THICKNESS) | 0;
        if (blast) cleared += (Math.PI * blast * blast) | 0;
        state.recentBeams.push({ x0, y0, x1: hx, y1: hy });
        const half = BEAM_THICKNESS / 2 + 2;
        let stompKills = 0, flyerKills = 0;
        for (const s of state.stompers) {
            if (s.alive && beamHits(s, x0, y0, hx, hy, half, hx, hy, blast)) {
                s.alive = false; s.squashTimer = 350; stompKills++;
            }
        }
        for (const f of state.flyers) {
            if (f.alive && beamHits(f, x0, y0, hx, hy, half, hx, hy, blast)) {
                f.alive = false; flyerKills++;
            }
        }
        return { cleared, stompKills, flyerKills };
    }

    function autoFire() {
        const none = { cleared: 0, stompKills: 0, flyerKills: 0, fired: false };
        if (!state.hasWeapon || state.weaponCooldown > 0) return none;
        let dir = autoTarget();
        if (!dir && destructibleAhead()) dir = { ux: state.player.facing < 0 ? -1 : 1, uy: 0 };
        if (!dir) return none;
        const r = fireOneBeam(dir.ux, dir.uy);
        state.weaponCooldown = WEAPON_COOLDOWN_DECISIONS;
        return { ...r, fired: true };
    }

    // ── Stepping ────────────────────────────────────────────────────────

    function physicsTick(input, dt) {
        const p = state.player;
        Platformer.step(p, input, tilemap, dt);
        for (const s of state.stompers) stepStomper(s, dt, tilemap);
        for (const f of state.flyers) stepFlyer(f, dt);
        const r = resolveStomps(p, state.stompers);
        const killed = r.hurt || touchingFlyer(p, state.flyers) || p.y > tilemap.heightPx + 64;
        return { kills: r.kills, killed };
    }

    function takePickup() {
        if (!pickup || state.pickupCollected || !overlaps(state.player, pickup)) return false;
        state.pickupCollected = true;
        state.hasWeapon = true;
        return true;
    }

    // Per-decision accumulators, between beginDecision and endDecision.
    const cur = { open: false, stompKills: 0, died: false, won: false, pickup: false };

    /** Open a decision window (clears the beam log auto-fire refills). */
    function beginDecision() {
        state.recentBeams.length = 0;
        Object.assign(cur, { open: true, stompKills: 0, died: false, won: false, pickup: false });
    }

    /**
     * One physics tick of the open decision; tickIdx 0..FRAME_SKIP-1 (the
     * first presses jump). True when the decision ended early (death,
     * flag, timeout): stop ticking and call endDecision.
     */
    function tickPhysics(action, tickIdx) {
        if (!cur.open) return true;
        if (!state.alive || state.won) { cur.died = !state.alive && !state.won; return true; }
        const input = actionInput(action | 0, tickIdx === 0, state.prevJumpHeld);
        const ev = physicsTick(input, FIXED_DT_MS);
        state.prevJumpHeld = input.jumpHeld;
        state.tick++;
        state.timeLeft -= FIXED_DT_MS / 1000;
        cur.stompKills += ev.kills;
        if (ev.killed) { cur.died = true; return true; }
        if (takePickup()) cur.pickup = true;
        if (!state.won && touchingFlag(state.player, flag)) {
            state.won = true; cur.won = true; return true;
        }
        return state.timeLeft <= 0;
    }

    /** Close the decision: auto-fire, reward, score, stall check. */
    function endDecision() {
        if (!cur.open) return { reward: 0, done: !state.alive || state.won };
        cur.open = false;
        const { died, won, pickup: pickupHit, stompKills } = cur;

        let pixels = 0, beamStomps = 0, beamFlyers = 0;
        if (!died && !won) {
            const af = autoFire();
            if (af.fired) {
                pixels = af.cleared; beamStomps = af.stompKills; beamFlyers = af.flyerKills;
            } else if (state.weaponCooldown > 0) {
                state.weaponCooldown--;
            }
        }
        state.pixelsDestroyed += pixels;
        state.beamStompKillsTotal += beamStomps;
        state.beamFlyerKillsTotal += beamFlyers;

        const phi = potential();
        const shaping = PBRS_GAMMA * phi - state.prevPhi;
        state.prevPhi = phi;
        let reward = REW_PER_PIXEL * pixels
            + REW_STOMP * stompKills
            + REW_BEAM_STOMP * beamStomps
            + REW_BEAM_FLYER * beamFlyers
            + (pickupHit ? REW_PICKUP : 0)
            + shaping;

        state.score += stompKills * 100 + beamStomps * 100 + beamFlyers * 200
            + Math.floor(pixels * 0.05)
            + (pickupHit ? 300 : 0)
            + (won ? 1000 : 0);

        // Stall: no progress (furthest x plus score) for stallDecisions.
        const p = state.player;
        if (p.x > state.peakX) state.peakX = p.x;
        const x = p.x >= state.peakX - freeBackwalkPx ? state.peakX : p.x;
        if (x + state.score > state.stallBestScore + stallEpsilonPx) {
            state.stallBestScore = x + state.score;
            state.stallSince = 0;
        } else {
            state.stallSince++;
        }
        const stalled = stallDecisions > 0 && state.stallSince >= stallDecisions;

        let done = true;
        if (won) reward += REW_FLAG;
        else if (died) { reward += REW_DEATH; state.alive = false; }
        else if (state.timeLeft <= 0) { reward += REW_TIMEOUT; state.alive = false; }
        else if (stalled) { reward += REW_TIMEOUT; state.alive = false; state.stalledOut = true; }
        else done = false;
        return { reward, done };
    }

    /** One decision: FRAME_SKIP ticks, then auto-fire and reward. */
    function step(action) {
        if (!state.alive || state.won) return { reward: 0, done: true };
        beginDecision();
        for (let t = 0; t < FRAME_SKIP; t++) if (tickPhysics(action, t)) break;
        return endDecision();
    }

    const legal = Int32Array.from({ length: NUM_ACTIONS }, (_, i) => i);

    return {
        tilemap, flag, pickup,
        levelSpawn: level.spawn,
        get player() { return state.player; },
        get stompers() { return state.stompers; },
        get flyers() { return state.flyers; },
        get score() { return state.score; },
        get alive() { return state.alive; },
        get won() { return state.won; },
        get tick() { return state.tick; },
        get timeLeft() { return state.timeLeft; },
        get stalledOut() { return state.stalledOut; },
        get hasWeapon() { return state.hasWeapon; },
        get pickupCollected() { return state.pickupCollected; },
        get weaponCooldown() { return state.weaponCooldown; },
        get pixelsDestroyed() { return state.pixelsDestroyed; },
        get recentBeams() { return state.recentBeams; },
        numActions: NUM_ACTIONS,
        reset, snapshot, restore, step, setSpawn,
        legalActions: () => legal,
        beginDecision, tickPhysics, endDecision,
    };
}
