// bots.js — FPS Arena AI players, server side.
//
// Movement is bro.ai.game: a nav grid baked from the arena's solids and one
// steering agent per bot. Aim is lib/bot-aim.js: the desired aim is resampled
// at 15 Hz and the gun turns at a finite rate, so a bot swinging onto a
// strafing target lags like a person does, and only fires once the gun is
// inside its cone.
//
// Each bot runs a small state machine over cover points precomputed around
// every obstacle:
//   ROAM   patrol between cover points while nobody is targeted
//   PUSH   advance on a distant target, strafe once close
//   COVER  move to a point with no line of sight to the target
//   PEEK   step out to a point that sees the target and shoot
//   HEAL   hide and regenerate below HEAL_THRESHOLD
// Target choice is a small reward score: near, wounded, visible targets win.

import { BotAim } from "/lib/bot-aim.js";
import {
    ARENA_HALF, WALL_THICK, PLAYER_RADIUS, EYE_HEIGHT, MOVE_SPEED, OBSTACLES, SOLIDS,
} from "./arena.js";

const MAX_HEALTH = 100;
const BOT_SPEED = MOVE_SPEED * 0.90;
const HEAL_RATE = 8;            // HP/s while healing out of sight
const HEAL_THRESHOLD = 50;      // seek cover below this
const HEAL_RESUME = 85;         // leave cover above this
const PEEK_DURATION = 0.6;      // seconds exposed per peek
const COVER_RETREAT_TIME = 1.5; // seconds in cover before peeking
const ENGAGE_RANGE = 25;        // max shooting / pushing distance
const CLOSE_RANGE = 10;         // switch to cover-and-peek play
const COVER_SEARCH_DIST = 15;   // max distance to look for cover
const PEEK_SEARCH_DIST = 6;     // peek spots are right next to the bot

const BOT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
const FIRST_BOT_ID = 10000;

const ST = { ROAM: 0, PUSH: 1, COVER: 2, PEEK: 3, HEAL: 4 };

/**
 * env: { players (Map id → player), pickSpawn(), shoot(player) → victim|null
 *        (applies the cooldown), random(), simTime() → seconds }.
 * Returns { add(player), tick(dt), onKill(shooter, victim), onRespawn(player),
 *           nextId(), nameFor(id), list, coverPoints }.
 */
export function createBots(env) {
    const ai = bro.ai.game;
    const random = env.random || Math.random;
    const nav = ai.createNavGrid({
        minX: -ARENA_HALF, minZ: -ARENA_HALF, maxX: ARENA_HALF, maxZ: ARENA_HALF,
        cellSize: 0.5, obstacles: SOLIDS, padding: PLAYER_RADIUS + 0.2,
    });
    const los = (ax, az, bx, bz) => ai.hasLineOfSight(ax, az, bx, bz, SOLIDS);
    const coverPoints = buildCoverPoints(nav);
    const bots = new Map();     // id → bot
    let nextId = FIRST_BOT_ID;

    // ── Cover ────────────────────────────────────────────────────────────

    /** Closest point that hides from the threat without leaving the fight. */
    function findCover(x, z, tx, tz) {
        let best = null, bestScore = -Infinity;
        for (const cp of coverPoints) {
            const distToBot = Math.hypot(cp.x - x, cp.z - z);
            if (distToBot > COVER_SEARCH_DIST || los(cp.x, cp.z, tx, tz)) continue;
            const distToThreat = Math.hypot(cp.x - tx, cp.z - tz);
            const score = -distToBot * 2.0 - Math.max(0, distToThreat - ENGAGE_RANGE) * 3.0;
            if (score > bestScore) { bestScore = score; best = cp; }
        }
        return best;
    }

    /** The nearest cover point that CAN see the threat: where to lean out and shoot. */
    function findPeekSpot(x, z, tx, tz) {
        let best = null, bestDist = Infinity;
        for (const cp of coverPoints) {
            const d = Math.hypot(cp.x - x, cp.z - z);
            if (d > PEEK_SEARCH_DIST || d >= bestDist || !los(cp.x, cp.z, tx, tz)) continue;
            best = cp;
            bestDist = d;
        }
        return best;
    }

    // ── Targeting ────────────────────────────────────────────────────────

    function chooseTarget(bot) {
        const p = bot.player;
        let bestId = null, bestScore = -Infinity;
        for (const [id, other] of env.players) {
            if (id === p.id || !other.alive) continue;
            const dist = Math.hypot(other.x - p.x, other.z - p.z);
            let score = -dist;
            score += (MAX_HEALTH - other.health) * 0.5;           // easy kills
            if (los(p.x, p.z, other.x, other.z)) score += 15;     // engage now
            if (p.health < HEAL_THRESHOLD && dist < CLOSE_RANGE) score -= 20;
            if (score > bestScore) { bestScore = score; bestId = id; }
        }
        bot.targetId = bestId;
    }

    // ── State machine ────────────────────────────────────────────────────

    function transition(bot, target, dist, hasLOS) {
        const p = bot.player;
        if (!target) { bot.state = ST.ROAM; return; }
        const coverFrom = () => findCover(p.x, p.z, target.x, target.z);

        if (p.health < HEAL_THRESHOLD && bot.state !== ST.HEAL) {
            const cover = coverFrom();
            if (cover) { bot.coverPoint = cover; bot.state = ST.HEAL; }
            return;                                               // no cover: keep fighting
        }
        switch (bot.state) {
            case ST.HEAL:
                if (p.health >= HEAL_RESUME) bot.state = hasLOS ? ST.PEEK : ST.PUSH;
                break;
            case ST.ROAM: {
                if (dist > CLOSE_RANGE) { bot.state = ST.PUSH; break; }
                const cover = coverFrom();
                bot.coverPoint = cover;
                bot.state = cover ? ST.COVER : ST.PUSH;
                break;
            }
            case ST.PUSH:
                if (dist < CLOSE_RANGE) {
                    const cover = coverFrom();
                    if (cover) { bot.coverPoint = cover; bot.state = ST.COVER; }
                }
                break;
            case ST.COVER: {
                const cp = bot.coverPoint || p;
                const atCover = (p.x - cp.x) ** 2 + (p.z - cp.z) ** 2 < 1.5;
                if (atCover && bot.stateTimer > COVER_RETREAT_TIME) {
                    const peek = findPeekSpot(p.x, p.z, target.x, target.z);
                    bot.peekPoint = peek;
                    bot.state = peek ? ST.PEEK : ST.PUSH;
                }
                break;
            }
            case ST.PEEK:
                if (bot.stateTimer > PEEK_DURATION) {
                    const cover = coverFrom();
                    bot.coverPoint = cover;
                    bot.state = cover ? ST.COVER : ST.PUSH;
                }
                break;
        }
    }

    function walkTo(bot, x, z) {
        bot.agent.setTarget(x, z);
    }

    function roamTarget(bot) {
        if (bot.agent.hasTarget && !bot.agent.atTarget) return;
        if (coverPoints.length) {
            bot.roamIdx = (bot.roamIdx + 1 + Math.floor(random() * 3)) % coverPoints.length;
            const dest = coverPoints[bot.roamIdx];
            walkTo(bot, dest.x, dest.z);
            return;
        }
        const lim = ARENA_HALF - PLAYER_RADIUS - WALL_THICK - 1.0;
        for (let tries = 0; tries < 8; tries++) {
            const rx = (random() * 2 - 1) * lim, rz = (random() * 2 - 1) * lim;
            if (nav.isWalkable(rx, rz)) { walkTo(bot, rx, rz); return; }
        }
    }

    function act(bot, target, dist, hasLOS, dt) {
        const p = bot.player;
        switch (bot.state) {
            case ST.ROAM:
                roamTarget(bot);
                break;
            case ST.PUSH:
                if (!target) break;
                if (dist > CLOSE_RANGE) {
                    walkTo(bot, target.x, target.z);
                } else {
                    // Strafe across the line to the target, flipping side now and then.
                    const px = -(target.z - p.z) / dist, pz = (target.x - p.x) / dist;
                    const side = Math.sin(env.simTime() * 3 + p.id * 7) > 0 ? 1 : -1;
                    walkTo(bot, p.x + px * side * 3, p.z + pz * side * 3);
                }
                break;
            case ST.COVER:
            case ST.HEAL:
                if (bot.coverPoint) walkTo(bot, bot.coverPoint.x, bot.coverPoint.z);
                break;
            case ST.PEEK:
                if (bot.peekPoint) walkTo(bot, bot.peekPoint.x, bot.peekPoint.z);
                break;
        }
        bot.agent.update(dt);
        p.x = bot.agent.x;
        p.z = bot.agent.z;

        if (bot.state === ST.HEAL) {
            if (!hasLOS || !target) p.health = Math.min(MAX_HEALTH, p.health + HEAL_RATE * dt);
        } else if (target && (bot.state !== ST.COVER || hasLOS)) {
            fireAt(bot, target, dist, hasLOS, dt);
        }
    }

    /** Shoot only with line of sight, in range, off cooldown, and on target. */
    function fireAt(bot, target, dist, hasLOS, dt) {
        const p = bot.player;
        bot.shootDelay = Math.max(0, bot.shootDelay - dt);
        if (!hasLOS || dist >= ENGAGE_RANGE || bot.shootDelay > 0 || p.shootCooldown > 0) return;
        if (!BotAim.canFireAt(bot.aim, p.x, EYE_HEIGHT, p.z, target.x, EYE_HEIGHT, target.z)) return;
        env.shoot(p);
        bot.shootDelay = 0.1 + random() * 0.15;
    }

    function tickBot(bot, dt) {
        const p = bot.player;
        bot.stateTimer += dt;
        bot.thinkTimer -= dt;
        const current = bot.targetId != null ? env.players.get(bot.targetId) : null;
        if (bot.thinkTimer <= 0 || !current || !current.alive) {
            chooseTarget(bot);
            bot.thinkTimer = 0.5 + random() * 0.5;
        }
        const t = bot.targetId != null ? env.players.get(bot.targetId) : null;
        const target = t && t.alive ? t : null;
        const dist = target ? Math.hypot(target.x - p.x, target.z - p.z) : Infinity;
        const hasLOS = target ? los(p.x, p.z, target.x, target.z) : false;

        const prev = bot.state;
        transition(bot, target, dist, hasLOS);
        if (bot.state !== prev) bot.stateTimer = 0;

        // Aim: sample the target's eye (or the walking direction) into the
        // tracker; the player's look direction is always the tracker's.
        const simT = env.simTime();
        if (target) {
            BotAim.requestAimAt(bot.aim, simT, p.x, EYE_HEIGHT, p.z, target.x, EYE_HEIGHT, target.z);
        } else if (bot.agent.hasTarget) {
            BotAim.requestAim(bot.aim, simT, bot.agent.yaw, 0);
        }
        BotAim.tick(bot.aim, dt);

        act(bot, target, dist, hasLOS, dt);
        p.yaw = bot.aim.yaw;
        p.pitch = bot.aim.pitch;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    function add(player) {
        const agent = ai.createAgent({
            navGrid: nav, x: player.x, z: player.z, speed: BOT_SPEED, radius: PLAYER_RADIUS,
        });
        bots.set(player.id, {
            player, agent,
            targetId: null, thinkTimer: 0, shootDelay: 0,
            state: ST.ROAM, stateTimer: 0, coverPoint: null, peekPoint: null,
            roamIdx: Math.floor(random() * Math.max(1, coverPoints.length)),
            score: 0,
            aim: BotAim.create({ turnSpeed: 5.0, sampleHz: 15, fireConeRad: 0.15 }),
        });
    }

    function onRespawn(player) {
        const bot = bots.get(player.id);
        if (!bot) return;
        bot.agent.setPosition(player.x, player.z);
        bot.agent.clearTarget();
        Object.assign(bot, { state: ST.ROAM, stateTimer: 0, coverPoint: null, peekPoint: null, targetId: null });
        bot.score -= 1;                                  // death penalty
        BotAim.set(bot.aim, 0, 0);
    }

    function onKill(shooter, victim) {
        const s = bots.get(shooter.id), v = bots.get(victim.id);
        if (s) s.score += 2;
        if (v) v.score -= 1;
    }

    function tick(dt) {
        for (const bot of bots.values()) if (bot.player.alive) tickBot(bot, dt);
    }

    return {
        add, tick, onKill, onRespawn,
        nextId: () => nextId++,
        nameFor: (id) => BOT_NAMES[(id - FIRST_BOT_ID) % BOT_NAMES.length] + " (bot)",
        list: bots,
        coverPoints,
        STATES: ST,
    };
}

/**
 * Candidate cover positions around every obstacle: the four face centres and
 * four corners, pushed out far enough to clear the nav grid's padded, cell-
 * snapped footprint (nav padding 0.6 + cell 0.5 + margin), inside the arena.
 */
function buildCoverPoints(nav) {
    const pad = PLAYER_RADIUS + 0.2 + 0.5 + 0.3;
    const lim = ARENA_HALF - PLAYER_RADIUS - WALL_THICK - 0.5;
    const out = [];
    OBSTACLES.forEach((o, i) => {
        const ex = o.hw + pad, ez = o.hd + pad;
        const pts = [
            [0, -ez], [0, ez], [-ex, 0], [ex, 0],
            [-ex, -ez], [ex, -ez], [-ex, ez], [ex, ez],
        ];
        for (const [dx, dz] of pts) {
            const x = o.x + dx, z = o.z + dz;
            if (Math.abs(x) < lim && Math.abs(z) < lim && nav.isWalkable(x, z)) out.push({ x, z, obstIdx: i });
        }
    });
    return out;
}
