// sim.js — FPS Arena authoritative match: players, movement, hitscan,
// health, respawn, bots. No sockets here: server.js feeds it connections and
// packets and hands it a `send`, so the whole match runs (and is tested)
// without networking.
//
//   const match = createMatch({ send: (id, buf, reliable) => bro.net.send(id, buf, reliable) });
//   match.join(connId); match.message(connId, data); match.leave(connId);
//   setInterval(() => match.tick(1 / 60), 1000 / 60);

import {
    EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS, SPAWNS, PLAYER_COLORS, IN,
    stepMove, collide, forward, rayCylinder, solidHit,
} from "./arena.js";
import {
    EVT, decodeClientMessage, encodeWelcome, encodeState, encodeEvent, encodeSpawn, encodeNames,
} from "./protocol.js";
import { createBots } from "./bots.js";

export const MAX_HEALTH = 100;
export const HIT_DAMAGE = 25;
export const RESPAWN_SECS = 3.0;
export const SHOOT_COOLDOWN = 0.15;   // seconds between shots
export const SHOT_RANGE = 100;

/**
 * opts: send(id, ArrayBuffer, reliable = true) — required;
 *       bots = 3; log = console.log; random = Math.random.
 * Returns the match: { players, tick, join, leave, message, shoot, addBot,
 *                      pickSpawn, serverTick }.
 */
export function createMatch(opts) {
    const send = opts.send;
    const log = opts.log || ((...a) => console.log(...a));
    const random = opts.random || Math.random;

    const players = new Map();
    let serverTick = 0;
    let simTime = 0;            // seconds of simulated match
    let nextColor = 0;

    function makePlayer(id, name, isBot) {
        const sp = pickSpawn();
        return {
            id, name, isBot: !!isBot,
            color: PLAYER_COLORS[nextColor++ % PLAYER_COLORS.length],
            x: sp.x, y: 0, z: sp.z, yaw: 0, pitch: 0,
            health: MAX_HEALTH, alive: true, kills: 0, deaths: 0,
            respawnTimer: 0, shootCooldown: 0, lastShoot: false,
            input: 0, lastInputTick: 0,
        };
    }

    /** The spawn point farthest from every living player. */
    function pickSpawn() {
        let best = SPAWNS[Math.floor(random() * SPAWNS.length)];
        let bestDist = -1;
        let anyAlive = false;
        for (const sp of SPAWNS) {
            let minDist = Infinity;
            for (const p of players.values()) {
                if (!p.alive) continue;
                anyAlive = true;
                const dx = p.x - sp.x, dz = p.z - sp.z;
                minDist = Math.min(minDist, dx * dx + dz * dz);
            }
            if (minDist > bestDist) { bestDist = minDist; best = sp; }
        }
        return anyAlive ? best : SPAWNS[Math.floor(random() * SPAWNS.length)];
    }

    const toHumans = (buf, reliable) => {
        for (const p of players.values()) if (!p.isBot) send(p.id, buf, reliable);
    };
    const broadcastNames = () => toHumans(encodeNames(players.values()));

    // ── Combat ───────────────────────────────────────────────────────────

    /** Hitscan from the shooter's eye along its aim; damages the first player hit. */
    function shoot(shooter) {
        const d = forward(shooter.yaw, shooter.pitch);
        const ox = shooter.x, oy = EYE_HEIGHT, oz = shooter.z;
        const wall = solidHit(ox, oy, oz, d.x, d.y, d.z);
        let bestT = Math.min(SHOT_RANGE, wall), victim = null;
        for (const p of players.values()) {
            if (p === shooter || !p.alive) continue;
            const t = rayCylinder(ox, oy, oz, d.x, d.y, d.z, p.x, p.z, PLAYER_RADIUS * 1.5, PLAYER_HEIGHT);
            if (t >= 0 && t < bestT) { bestT = t; victim = p; }
        }
        if (!victim) return null;

        victim.health -= HIT_DAMAGE;
        const hit = encodeEvent(EVT.HIT, shooter.id, victim.id, HIT_DAMAGE);
        if (!victim.isBot) send(victim.id, hit);
        if (!shooter.isBot) send(shooter.id, hit);

        if (victim.health <= 0) {
            victim.health = 0;
            victim.alive = false;
            victim.respawnTimer = RESPAWN_SECS;
            victim.deaths++;
            shooter.kills++;
            bots.onKill(shooter, victim);
            toHumans(encodeEvent(EVT.KILL, shooter.id, victim.id, 0));
            log(`${shooter.name} killed ${victim.name} [${shooter.kills} kills]`);
        }
        return victim;
    }

    /** Fire if the cooldown allows (edge-triggered for humans via lastShoot). */
    function tryShoot(p) {
        if (p.shootCooldown > 0) return null;
        p.shootCooldown = SHOOT_COOLDOWN;
        return shoot(p);
    }

    // ── Bots ─────────────────────────────────────────────────────────────

    const bots = createBots({
        players, pickSpawn, shoot: tryShoot, random,
        simTime: () => simTime,
    });

    function addBot() {
        const id = bots.nextId();
        const p = makePlayer(id, bots.nameFor(id), true);
        players.set(id, p);
        bots.add(p);
        log(p.name + " spawned [" + players.size + " total]");
        broadcastNames();
        return p;
    }

    // ── Connections ──────────────────────────────────────────────────────

    function join(id) {
        const p = makePlayer(id, "Player", false);
        players.set(id, p);
        log("Player " + id + " joined [" + players.size + " players]");
        send(id, encodeWelcome(id, serverTick));
        send(id, encodeSpawn(p.x, p.z));
        broadcastNames();
        return p;
    }

    function leave(id) {
        const p = players.get(id);
        if (!p) return;
        players.delete(id);
        log(p.name + " left [" + players.size + " players]");
        broadcastNames();
    }

    function message(id, data) {
        const p = players.get(id);
        if (!p || p.isBot) return;
        const m = decodeClientMessage(data);
        if (!m) return;
        if (m.type === "set_name") {
            p.name = m.name.substring(0, 16) || "Player";
            log("Player " + id + ' is "' + p.name + '"');
            broadcastNames();
        } else {
            p.input = m.keys;
            p.yaw = m.yaw;
            p.pitch = m.pitch;
            p.lastInputTick = m.tick;
        }
    }

    // ── Tick ─────────────────────────────────────────────────────────────

    function respawn(p) {
        const sp = pickSpawn();
        p.x = sp.x; p.z = sp.z; p.y = 0;
        p.health = MAX_HEALTH;
        p.alive = true;
        if (p.isBot) bots.onRespawn(p);
        else send(p.id, encodeSpawn(p.x, p.z));
        log(p.name + " respawned");
    }

    function tick(dt) {
        serverTick++;
        simTime += dt;
        for (const p of players.values()) {
            p.shootCooldown = Math.max(0, p.shootCooldown - dt);
            if (!p.alive) {
                p.respawnTimer -= dt;
                if (p.respawnTimer <= 0) respawn(p);
                continue;
            }
            if (p.isBot) continue;
            stepMove(p, p.input, p.yaw, dt);
            const wants = !!(p.input & IN.SHOOT);
            if (wants && !p.lastShoot) tryShoot(p);
            p.lastShoot = wants;
        }

        bots.tick(dt);
        for (const p of players.values()) if (p.alive && p.isBot) collide(p);

        const snapshot = Array.from(players.values(), (p) => ({
            id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
            health: p.health, alive: p.alive, firing: p.shootCooldown > 0, kills: p.kills,
        }));
        for (const p of players.values()) {
            if (!p.isBot) send(p.id, encodeState(serverTick, p.lastInputTick, snapshot), false);
        }
    }

    for (let i = 0; i < (opts.bots != null ? opts.bots : 3); i++) addBot();

    return {
        players, tick, join, leave, message, shoot, addBot, pickSpawn, bots,
        get serverTick() { return serverTick; },
    };
}
