// match.js — Crater's authoritative rules: lobby roster, ready state, turn
// order, the shot simulation, damage, bots, and the win. No sockets: the
// server (server.js) hands it a room ({ send, broadcast, kick }) and calls
// the on* entry points, so the whole match runs — and is tested — without
// networking.
//
// Messages out (tag → payload):
//   state  { phase: "lobby", hostId, players:[{ id, name, color, ready, bot }] }
//          { phase: "match", ...snapshot }   (roster change mid-match)
//   match  { phase: "match", seed, turn, hm:[...], players:[{ id, name, color, bot, x, hp, alive }] }
//   shot   { shooter, originX, originY, vx, vy, flightMs, hit, impactX, impactY,
//            craterCols, damages:[[id, hp]], dead:[id], prevTurn, nextTurn }
//   skip   { prevTurn, nextTurn }            (a human's turn timed out)
//   over   { winnerId, winnerName }          (after the killing shot lands)

import {
    C, rng, generateHeightmap, heightAt, muzzleOrigin, launchVelocity,
    simulateShot, carveCrater, blastDamage,
} from "./shared.js";

export const MAX_PLAYERS = 6;
export const RETURN_TO_LOBBY_MS = 5000;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * opts: room { send(id, tag, msg), broadcast(tag, msg) } — required;
 *       setTimeout / now — injectable clock (defaults: the real ones);
 *       random — seed source; log.
 */
export function createMatch(opts) {
    const room = opts.room;
    const later = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const now = opts.now || (() => Date.now());
    const random = opts.random || Math.random;
    const log = opts.log || ((...a) => console.log("[crater]", ...a));

    const state = {
        phase: "lobby",             // lobby | match | ended
        players: new Map(),         // id → player (humans: connection id; bots: negative)
        hostId: null,
        hm: null,
        seed: 0,
        turn: null,
        turnIdx: 0,
        aliveOrder: [],             // ids in turn order for this match
        turnStart: 0,
        winnerId: null,
    };
    let nextBotId = -1;

    function makePlayer(id, name, bot) {
        return {
            id,
            name: name || (bot ? "Bot " + (-id) : "Player " + id),
            color: C.COLORS[state.players.size % C.COLORS.length],
            ready: !!bot, bot: !!bot,
            hp: C.HP_MAX, x: 0, alive: true,
        };
    }

    function lobbyState() {
        return {
            phase: "lobby",
            hostId: state.hostId,
            players: Array.from(state.players.values(), (p) => ({
                id: p.id, name: p.name, color: p.color, ready: p.ready, bot: p.bot,
            })),
        };
    }

    function matchSnapshot() {
        return {
            phase: "match",
            seed: state.seed,
            turn: state.turn,
            hm: Array.from(state.hm),
            players: Array.from(state.players.values(), (p) => ({
                id: p.id, name: p.name, color: p.color, bot: p.bot, x: p.x, hp: p.hp, alive: p.alive,
            })),
        };
    }

    const broadcastState = () => room.broadcast("state", state.phase === "match" ? matchSnapshot() : lobbyState());

    // ── Lobby ────────────────────────────────────────────────────────────

    /** Can this connection join right now? A reason string refuses it. */
    function admit() {
        if (state.phase !== "lobby") return "Match in progress — try later";
        if (state.players.size >= MAX_PLAYERS) return "Server full";
        return null;
    }

    function join(id, name) {
        const p = makePlayer(id, name, false);
        state.players.set(id, p);
        if (state.hostId == null) state.hostId = id;
        broadcastState();
        log("joined:", p.name);
        return p;
    }

    function leave(id) {
        if (!state.players.has(id)) return;
        state.players.delete(id);
        if (state.hostId === id) {
            state.hostId = null;
            for (const p of state.players.values()) if (!p.bot) { state.hostId = p.id; break; }
        }
        if (state.phase === "match") {
            if (state.turn === id) advanceTurn();
            state.aliveOrder = state.aliveOrder.filter((q) => q !== id);
            // Keep the index on whoever holds the turn now that the list shifted.
            state.turnIdx = Math.max(0, state.aliveOrder.indexOf(state.turn));
            checkWin();
        }
        broadcastState();
        log("left:", id);
    }

    function setReady(id, ready) {
        const p = state.players.get(id);
        if (!p || state.phase !== "lobby") return;
        p.ready = !!ready;
        broadcastState();
    }

    function addBot(id) {
        if (id !== state.hostId || state.phase !== "lobby" || state.players.size >= MAX_PLAYERS) return null;
        const botId = nextBotId--;
        const p = makePlayer(botId, null, true);
        state.players.set(botId, p);
        broadcastState();
        return p;
    }

    /** Host starts once there are two tanks and every human is ready. */
    function start(id) {
        if (id !== state.hostId || state.phase !== "lobby") return false;
        const all = Array.from(state.players.values());
        if (all.length < 2 || all.some((p) => !p.bot && !p.ready)) return false;
        startMatch();
        return true;
    }

    // ── Match ────────────────────────────────────────────────────────────

    function startMatch() {
        state.phase = "match";
        state.seed = (random() * 2147483647) | 0;
        state.hm = generateHeightmap(state.seed);

        // Even slots with jitter, shuffled so the order is not the join order.
        const players = Array.from(state.players.values());
        const margin = 8, span = C.WORLD_W - margin * 2, slot = span / players.length;
        const r = rng(state.seed ^ 0xA5A5);
        const xs = players.map((_, i) => margin + (i + 0.5) * slot + (r() - 0.5) * slot * 0.4);
        for (let i = xs.length - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            [xs[i], xs[j]] = [xs[j], xs[i]];
        }
        players.forEach((p, i) => Object.assign(p, { x: xs[i], hp: C.HP_MAX, alive: true }));

        state.aliveOrder = players.map((p) => p.id);
        state.turnIdx = 0;
        state.turn = state.aliveOrder[0];
        state.turnStart = now();
        state.winnerId = null;
        room.broadcast("match", matchSnapshot());
        scheduleBot();
    }

    /** Next living player in order; a bot's shot waits `delayMs` (the current shell's flight). */
    function advanceTurn(delayMs) {
        const order = state.aliveOrder;
        for (let step = 0; step < order.length; step++) {
            state.turnIdx = (state.turnIdx + 1) % order.length;
            const p = state.players.get(order[state.turnIdx]);
            if (p && p.alive) {
                state.turn = p.id;
                state.turnStart = now();
                scheduleBot(delayMs || 0);
                return;
            }
        }
    }

    /**
     * One tank left (or none): the match is over. The 'over' broadcast waits
     * for `delayMs` so the killing shot plays out on clients first.
     */
    function checkWin(delayMs) {
        if (state.phase !== "match") return state.phase === "ended";
        const alive = state.aliveOrder.filter((id) => {
            const p = state.players.get(id);
            return p && p.alive;
        });
        if (alive.length > 1) return false;
        state.phase = "ended";
        state.winnerId = alive.length === 1 ? alive[0] : null;
        const w = state.winnerId != null ? state.players.get(state.winnerId) : null;
        const payload = { winnerId: state.winnerId, winnerName: w ? w.name : null };
        const delay = Math.max(0, delayMs || 0);
        later(() => room.broadcast("over", payload), delay);
        later(returnToLobby, delay + RETURN_TO_LOBBY_MS);
        return true;
    }

    function returnToLobby() {
        Object.assign(state, { phase: "lobby", hm: null, turn: null, aliveOrder: [] });
        // Humans back to unready at full health; bots go so the host can re-pick.
        for (const p of Array.from(state.players.values())) {
            if (p.bot) state.players.delete(p.id);
            else Object.assign(p, { hp: C.HP_MAX, alive: true, ready: false });
        }
        broadcastState();
    }

    function fire(id, m) {
        if (state.phase !== "match" || state.turn !== id) return null;
        const p = state.players.get(id);
        if (!p || !p.alive) return null;
        return executeFire(p, m.angle, m.power, m.dir);
    }

    function executeFire(p, angle, power, dir) {
        angle = clamp(+angle || 0, 0, Math.PI / 2);
        power = clamp(+power || 0, 0.05, 1);
        dir = +dir >= 0 ? 1 : -1;

        const o = muzzleOrigin(state.hm, p.x, angle, dir);
        const v = launchVelocity(angle, power, dir);
        const res = simulateShot(state.hm, o.x, o.y, v.vx, v.vy, { recordPath: false });

        const damages = [], dead = [];
        let craterCols = [];
        if (res.hit) {
            craterCols = carveCrater(state.hm, res.x, res.y, C.CRATER_RAD);
            for (const t of state.players.values()) {
                if (!t.alive) continue;
                const dmg = blastDamage(res.x, res.y, t.x, heightAt(state.hm, t.x) + C.TANK_H * 0.5);
                if (dmg <= 0) continue;
                t.hp = Math.max(0, t.hp - dmg);
                damages.push([t.id, t.hp]);
                if (t.hp === 0) { t.alive = false; dead.push(t.id); }
            }
        }

        const prevTurn = state.turn;
        const over = checkWin(res.flightMs + 500);
        // The next bot waits for this shell to land on the clients, or it could
        // fire mid-flight and clobber the projectile being animated.
        if (!over) advanceTurn(res.flightMs);

        const shot = {
            shooter: p.id,
            originX: o.x, originY: o.y, vx: v.vx, vy: v.vy,
            flightMs: res.flightMs, hit: res.hit, impactX: res.x, impactY: res.y,
            craterCols, damages, dead, prevTurn,
            nextTurn: over ? null : state.turn,
        };
        room.broadcast("shot", shot);
        return shot;
    }

    // ── Bots ─────────────────────────────────────────────────────────────

    function scheduleBot(extraDelayMs) {
        const p = state.players.get(state.turn);
        if (!p || !p.bot || !p.alive) return;
        later(() => botFire(p), C.BOT_DELAY + (extraDelayMs || 0));
    }

    /** Aim at the nearest enemy with the low-angle ballistic solution, plus jitter. */
    function botFire(p) {
        if (state.phase !== "match" || state.turn !== p.id || !p.alive) return;
        let best = null, bestD = Infinity;
        for (const t of state.players.values()) {
            if (t.id === p.id || !t.alive) continue;
            const d = Math.abs(t.x - p.x);
            if (d < bestD) { bestD = d; best = t; }
        }
        if (!best) return;

        const dir = best.x > p.x ? 1 : -1;
        const dx = Math.max(1, Math.abs(best.x - p.x));
        const dy = heightAt(state.hm, best.x) - heightAt(state.hm, p.x);
        const r = rng(((now() & 0xffff) << 16) ^ (p.id & 0xffff));
        let power = 0.45 + r() * 0.35;
        const v = power * C.MAX_SPEED, g = C.GRAVITY;
        // angle = atan((v² − √(v⁴ − g(g·dx² + 2·dy·v²))) / (g·dx))
        const disc = v ** 4 - g * (g * dx * dx + 2 * dy * v * v);
        let angle = disc >= 0 ? Math.atan((v * v - Math.sqrt(disc)) / (g * dx)) : 0.9 + r() * 0.4;
        angle = clamp(angle + (r() - 0.5) * 0.12, 0.1, 1.45);
        power = clamp(power + (r() - 0.5) * 0.08, 0.15, 1.0);
        executeFire(p, angle, power, dir);
    }

    /** Forfeit a human turn that has run past TURN_TIMEOUT. Call about once a second. */
    function checkTimeout() {
        if (state.phase !== "match" || state.turn == null) return;
        if (now() - state.turnStart < C.TURN_TIMEOUT) return;
        const p = state.players.get(state.turn);
        if (!p || p.bot) return;
        log("timeout — skipping turn for", p.name);
        advanceTurn();
        room.broadcast("skip", { prevTurn: p.id, nextTurn: state.turn });
    }

    return {
        state, admit, join, leave, setReady, addBot, start, fire, checkTimeout,
        lobbyState, matchSnapshot,
    };
}
