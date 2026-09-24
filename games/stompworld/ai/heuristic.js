// Hand-written Stompworld controllers:
//   heuristicAction  walk to the flag, jumping pits, walls, stompers and
//                    body-height flyers while avoiding jumps into flyers
//                    that are lethal at the apex. Seeds training by
//                    behaviour cloning (populateWarmup) so a random net is
//                    not stuck learning "stand still".
//   scriptedMove     terrain-only walker the AI demo uses once the hero is
//                    armed (auto-fire clears enemies).
// Aiming is automatic in the sim, so neither picks shots.

import { TILE } from "/app/rules.js";
import { NUM_ACTIONS } from "/app/sim.js";
import { buildObs } from "/app/ai/obs.js";

const RIGHT = 2, LEFT = 1, JUMP_RIGHT = 5, JUMP_LEFT = 4;
const run = (dir) => (dir > 0 ? RIGHT : LEFT);
const jump = (dir) => (dir > 0 ? JUMP_RIGHT : JUMP_LEFT);

function solid(sim, c, r) {
    const tm = sim.tilemap;
    if (c < 0 || c >= tm.cols || r < 0 || r >= tm.rows) return false;
    return !!tm.solidAt(c, r);
}

/** Terrain in the next column: { pit, wall, head }. */
export function terrainAhead(sim, dir) {
    const p = sim.player;
    const col = Math.floor((p.x + p.w / 2) / TILE);
    const row = Math.floor((p.y + p.h / 2) / TILE);
    const foot = Math.floor((p.y + p.h + 2) / TILE);
    return {
        pit: !solid(sim, col + dir, foot),
        wall: solid(sim, col + dir, row),
        head: solid(sim, col + dir, row - 1),
    };
}

function canJump(p) {
    return !!p.onGround || (p.coyote || 0) > 10;
}

/** Walk in `dir`, jumping whatever terrain is in the way. */
export function scriptedMove(sim, dir) {
    const p = sim.player;
    const t = terrainAhead(sim, dir);
    if ((t.pit || t.wall || t.head) && canJump(p)) return jump(dir);
    if (!p.onGround && p.vy < -50) return jump(dir);   // hold jump while rising
    return run(dir);
}

function stomperClose(sim, dir) {
    const p = sim.player;
    const px = p.x + p.w / 2;
    let best = Infinity;
    for (const s of sim.stompers) {
        if (!s.alive) continue;
        const dx = s.x + s.w / 2 - px;
        if (dx * dir <= 0 || Math.abs(dx) > 250) continue;
        if (Math.abs(s.y + s.h / 2 - (p.y + p.h / 2)) > 100) continue;
        best = Math.min(best, Math.abs(dx));
    }
    return best < 90;
}

/** bodyLevel: a flyer to jump over; apexLethal: one not to jump into. */
function flyersAhead(sim, dir) {
    const p = sim.player;
    const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
    let bodyLevel = false, apexLethal = false;
    for (const f of sim.flyers) {
        if (!f.alive) continue;
        const dx = f.x + f.w / 2 - pcx;
        const dy = f.y + f.h / 2 - pcy;
        if (dx * dir <= 0 || Math.abs(dx) >= 175) continue;
        if (Math.abs(dy) < 30) bodyLevel = true;
        else if (dy > -200 && dy < -50) apexLethal = true;
    }
    return { bodyLevel, apexLethal };
}

/** The demonstration policy; `rng()` in [0,1) adds 2% random actions. */
export function heuristicAction(sim, rng) {
    const p = sim.player;
    const dir = 1;
    if (rng() < 0.02) return (rng() * NUM_ACTIONS) | 0;

    const flyers = flyersAhead(sim, dir);
    if (flyers.bodyLevel && canJump(p)) return jump(dir);

    const t = terrainAhead(sim, dir);
    const wantJump = t.wall || t.head || t.pit || stomperClose(sim, dir);
    if (flyers.apexLethal && wantJump && p.onGround && !t.pit) return run(dir);
    if (flyers.apexLethal && !wantJump) return run(dir);
    if (wantJump && canJump(p)) return jump(dir);
    if (!p.onGround && p.vy < -50) return jump(dir);
    return run(dir);
}

/** mulberry32 */
export function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function rollOne(sim, rng, maxDecisions) {
    sim.reset();
    const out = [];
    for (let t = 0; t < maxDecisions; t++) {
        const obs = buildObs(sim).slice();
        const a = heuristicAction(sim, rng);
        const policyTarget = new Float32Array(NUM_ACTIONS);
        policyTarget[a] = 1;
        const r = sim.step(a);
        out.push({ obs, policyTarget, reward: r.reward });
        if (r.done) break;
    }
    return out;
}

/**
 * Roll heuristic episodes and push (obs, one-hot action, discounted
 * return) tuples into `buffer`. Episodes that neither win nor earn
 * minReward are dropped. Returns counts for the training HUD.
 */
export function populateWarmup(buffer, sim, opts = {}) {
    const target = opts.targetSamples || 30;
    const maxAttempts = opts.maxAttempts || 200;
    const gamma = opts.gamma || 0.99;
    const maxDecisions = opts.maxDecisions || 400;
    const minReward = opts.minReward ?? 0.2;
    const rng = makeRng(opts.seed || 0xBC51A57E);
    const mask = new Float32Array(0);
    const stats = { attempts: 0, kept: 0, flags: 0, deaths: 0, timeouts: 0, tuplesPushed: 0 };

    while (stats.kept < target && stats.attempts < maxAttempts) {
        stats.attempts++;
        const tuples = rollOne(sim, rng, maxDecisions);
        if (sim.won) stats.flags++;
        else if (sim.timeLeft <= 0) stats.timeouts++;
        else stats.deaths++;
        const total = tuples.reduce((s, t) => s + t.reward, 0);
        if (!sim.won && total < minReward) continue;
        stats.kept++;
        let g = 0;
        for (let i = tuples.length - 1; i >= 0; i--) {
            g = tuples[i].reward + gamma * g;
            buffer.push({
                obs: tuples[i].obs,
                policyTarget: tuples[i].policyTarget,
                actionMask: mask,
                valueTarget: Math.max(-1, Math.min(1, g)),
            });
            stats.tuplesPushed++;
        }
    }
    return stats;
}
