// net.js — the FPS Arena client connection: bro.net callbacks, packet
// handling, and the predicted local player.
//
// One connection per run. `session` is the single live view of it that the
// plugin, the world and the HUD read; it is a const object mutated in place
// (headless tests import it and see the live values).

import { MOVE_SPEED, stepMove } from "/app/arena.js";
import { EVT, encodeInput, encodeSetName, decodeMessage } from "/app/protocol.js";

const SNAP_DIST2 = 9.0;          // prediction error (m²) that snaps instead of blends
const BLEND_RATE = 5.0;          // per second, toward the server position
const HISTORY_MS = 500;          // remote snapshots kept for interpolation

export const session = {
    conn: null,                  // bro.net connection id, once connected
    pendingName: null,           // the name to announce; null once we hung up
    connected: false,
    lost: false,                 // the server dropped us (or never answered)
    error: "",
    myId: null,
    clientTick: 0,
    serverTick: 0,
    names: new Map(),            // id → display name
    remotes: new Map(),          // id → { states: [{ t, x, y, z, yaw, alive, health, kills }] }
    me: {
        x: 0, z: 0, yaw: 0, pitch: 0,
        health: 100, alive: true, kills: 0,
        serverX: 0, serverZ: 0, hasServerPos: false,
    },
};

let handlers = {};
let wired = false;

function reset() {
    Object.assign(session, {
        conn: null, connected: false, lost: false, error: "",
        myId: null, clientTick: 0, serverTick: 0,
    });
    session.names.clear();
    session.remotes.clear();
    Object.assign(session.me, {
        x: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true, kills: 0,
        serverX: 0, serverZ: 0, hasServerPos: false,
    });
}

function wire() {
    if (wired) return;
    wired = true;
    bro.net.onconnect = (id) => {
        session.conn = id;
        session.connected = true;
        session.error = "";
        bro.net.send(id, encodeSetName(session.pendingName || "Player"));
        if (handlers.onConnect) handlers.onConnect();
    };
    bro.net.ondisconnect = () => {
        if (session.conn == null && !session.pendingName) return;   // a close we asked for
        session.error = session.connected ? "Lost connection to server" : "Could not reach the server";
        session.lost = true;
        session.connected = false;
        session.conn = null;
        if (handlers.onLost) handlers.onLost();
    };
    bro.net.onmessage = (_id, data) => handle(decodeMessage(data));
}

/**
 * Open a connection. handlers: onConnect(), onLost(), onKill(killerId, victimId),
 * onHit(shooterId, victimId), onSpawn(). Returns false (with session.error set)
 * when bro.net refuses the address outright.
 */
export function connect(address, name, h) {
    handlers = h || {};
    wire();
    reset();
    session.pendingName = name;
    try {
        bro.net.init();
        if (bro.net.connect(address) === false) throw new Error("bad address " + address);
        return true;
    } catch (e) {
        session.error = "Connect failed: " + (e && e.message ? e.message : e);
        session.lost = true;
        return false;
    }
}

/** Close the connection (no onLost for a disconnect we asked for). */
export function disconnect() {
    const id = session.conn;
    session.pendingName = null;
    session.conn = null;
    session.connected = false;
    if (id != null) {
        try { bro.net.disconnect(id); } catch (e) { /* already gone */ }
    }
}

/** Send one input snapshot (unreliable) and advance the client tick. */
export function sendInput(keys) {
    if (session.conn == null) return;
    session.clientTick++;
    const me = session.me;
    bro.net.send(session.conn, encodeInput(session.clientTick, keys, me.yaw, me.pitch), false);
}

/**
 * Client-side prediction: move the local player with the server's own step,
 * then ease toward the last authoritative position (snap when far off).
 */
export function predict(keys, dt) {
    const me = session.me;
    if (me.alive) stepMove(me, keys, me.yaw, dt, MOVE_SPEED);
    if (!me.hasServerPos) return;
    const ex = me.serverX - me.x, ez = me.serverZ - me.z;
    const err2 = ex * ex + ez * ez;
    if (err2 > SNAP_DIST2) {
        me.x = me.serverX;
        me.z = me.serverZ;
    } else if (err2 > 0.0001) {
        const blend = Math.min(1, BLEND_RATE * dt);
        me.x += ex * blend;
        me.z += ez * blend;
    }
}

/** A display name for an id: "You", the server's name, or "Player N". */
export function nameOf(id) {
    if (id === session.myId) return "You";
    return session.names.get(id) || "Player " + id;
}

function handle(msg) {
    if (!msg) return;
    const me = session.me;
    switch (msg.type) {
        case "welcome":
            session.myId = msg.id;
            session.serverTick = msg.serverTick;
            break;

        case "state": {
            session.serverTick = msg.serverTick;
            const now = Date.now();
            const seen = new Set();
            for (const p of msg.players) {
                seen.add(p.id);
                if (p.id === session.myId) {
                    me.serverX = p.x;
                    me.serverZ = p.z;
                    me.hasServerPos = true;
                    me.health = p.health;
                    me.alive = p.alive;
                    me.kills = p.kills;
                    continue;
                }
                let r = session.remotes.get(p.id);
                if (!r) session.remotes.set(p.id, r = { states: [] });
                r.states.push({ t: now, ...p });
                while (r.states.length > 2 && r.states[0].t < now - HISTORY_MS) r.states.shift();
            }
            for (const id of session.remotes.keys()) if (!seen.has(id)) session.remotes.delete(id);
            break;
        }

        case "names":
            session.names.clear();
            for (const e of msg.entries) session.names.set(e.id, e.name);
            break;

        case "event":
            if (msg.evt === EVT.KILL) {
                if (handlers.onKill) handlers.onKill(msg.killerId, msg.victimId);
            } else if (msg.evt === EVT.HIT) {
                if (handlers.onHit) handlers.onHit(msg.killerId, msg.victimId);
            } else if (msg.evt === EVT.SPAWN) {
                me.x = me.serverX = msg.x;
                me.z = me.serverZ = msg.z;
                me.hasServerPos = true;
                me.alive = true;
                me.health = 100;
                if (handlers.onSpawn) handlers.onSpawn();
            }
            break;
    }
}
