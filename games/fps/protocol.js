// protocol.js — FPS Arena binary wire format, both directions.
// Pure encode/decode: the client (game.js) and the server (server.js) both
// import this file, so the two ends cannot drift apart.
//
// Client → server
//   INPUT  (14 B, unreliable)  type u8 | clientTick u32 | keys u8 | yaw f32 | pitch f32
//   NAME   (reliable)          JSON text {"type":"set_name","name":...}
// Server → client
//   WELCOME (9 B)              type u8 | yourId u32 | serverTick u32
//   STATE  (unreliable)        type u8 | serverTick u32 | lastInputTick u32 | count u8
//                              then per player: id u32 | x y z yaw f32 | health u8 |
//                              flags u8 (1 alive, 2 firing) | kills u16      (24 B)
//   EVENT  KILL/HIT (12 B)     type u8 | evt u8 | killerId u32 | victimId u32 | value u16
//   EVENT  SPAWN (10 B)        type u8 | evt u8 | x f32 | z f32
//   NAMES                      type u8 | count u8, then id u32 | len u8 | utf8 name
// All multi-byte fields are little-endian. Player ids are bro.net connection
// handles (full 32-bit values) for humans and 10000+ for bots.

export { IN } from "./arena.js";

export const MSG = { INPUT: 0x01, STATE: 0x02, WELCOME: 0x03, EVENT: 0x04, NAMES: 0x05 };
export const EVT = { KILL: 0, HIT: 1, SPAWN: 2 };

const STATE_HEADER = 10;
const STATE_STRIDE = 24;
const enc = new TextEncoder();
const dec = new TextDecoder();

function view(data) {
    if (data instanceof ArrayBuffer) return new DataView(data);
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

// ── Client → server ──────────────────────────────────────────────────────

export function encodeInput(clientTick, keys, yaw, pitch) {
    const buf = new ArrayBuffer(14);
    const v = new DataView(buf);
    v.setUint8(0, MSG.INPUT);
    v.setUint32(1, clientTick >>> 0, true);
    v.setUint8(5, keys & 0xff);
    v.setFloat32(6, yaw, true);
    v.setFloat32(10, pitch, true);
    return buf;
}

export function encodeSetName(name) {
    return enc.encode(JSON.stringify({ type: "set_name", name })).buffer;
}

/**
 * Decode one client packet on the server:
 *   { type: "input", tick, keys, yaw, pitch } | { type: "set_name", name } | null
 */
export function decodeClientMessage(data) {
    const v = view(data);
    if (v.byteLength < 1) return null;
    if (v.getUint8(0) === 0x7b) {               // '{' — the JSON name message
        try {
            const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
            const msg = JSON.parse(dec.decode(bytes));
            if (msg && msg.type === "set_name" && typeof msg.name === "string") {
                return { type: "set_name", name: msg.name };
            }
        } catch (e) { /* malformed */ }
        return null;
    }
    if (v.getUint8(0) !== MSG.INPUT || v.byteLength < 14) return null;
    return {
        type: "input",
        tick: v.getUint32(1, true),
        keys: v.getUint8(5),
        yaw: v.getFloat32(6, true),
        pitch: v.getFloat32(10, true),
    };
}

// ── Server → client ──────────────────────────────────────────────────────

export function encodeWelcome(id, serverTick) {
    const buf = new ArrayBuffer(9);
    const v = new DataView(buf);
    v.setUint8(0, MSG.WELCOME);
    v.setUint32(1, id >>> 0, true);
    v.setUint32(5, serverTick >>> 0, true);
    return buf;
}

/** players: iterable of { id, x, y, z, yaw, health, alive, firing, kills }. */
export function encodeState(serverTick, lastInputTick, players) {
    const list = Array.from(players);
    const buf = new ArrayBuffer(STATE_HEADER + list.length * STATE_STRIDE);
    const v = new DataView(buf);
    v.setUint8(0, MSG.STATE);
    v.setUint32(1, serverTick >>> 0, true);
    v.setUint32(5, lastInputTick >>> 0, true);
    v.setUint8(9, list.length);
    let off = STATE_HEADER;
    for (const p of list) {
        v.setUint32(off, p.id >>> 0, true);
        v.setFloat32(off + 4, p.x, true);
        v.setFloat32(off + 8, p.y, true);
        v.setFloat32(off + 12, p.z, true);
        v.setFloat32(off + 16, p.yaw, true);
        v.setUint8(off + 20, Math.max(0, Math.min(255, Math.round(p.health))));
        v.setUint8(off + 21, (p.alive ? 1 : 0) | (p.firing ? 2 : 0));
        v.setUint16(off + 22, p.kills, true);
        off += STATE_STRIDE;
    }
    return buf;
}

export function encodeEvent(evt, id1, id2, value) {
    const buf = new ArrayBuffer(12);
    const v = new DataView(buf);
    v.setUint8(0, MSG.EVENT);
    v.setUint8(1, evt);
    v.setUint32(2, id1 >>> 0, true);
    v.setUint32(6, id2 >>> 0, true);
    v.setUint16(10, value || 0, true);
    return buf;
}

export function encodeSpawn(x, z) {
    const buf = new ArrayBuffer(10);
    const v = new DataView(buf);
    v.setUint8(0, MSG.EVENT);
    v.setUint8(1, EVT.SPAWN);
    v.setFloat32(2, x, true);
    v.setFloat32(6, z, true);
    return buf;
}

/** entries: iterable of { id, name }. Names are truncated to 255 UTF-8 bytes. */
export function encodeNames(entries) {
    const list = Array.from(entries, (e) => ({ id: e.id, bytes: enc.encode(e.name).subarray(0, 255) }));
    let len = 2;
    for (const e of list) len += 5 + e.bytes.length;
    const buf = new ArrayBuffer(len);
    const v = new DataView(buf);
    v.setUint8(0, MSG.NAMES);
    v.setUint8(1, list.length);
    let off = 2;
    for (const e of list) {
        v.setUint32(off, e.id >>> 0, true);
        v.setUint8(off + 4, e.bytes.length);
        new Uint8Array(buf, off + 5, e.bytes.length).set(e.bytes);
        off += 5 + e.bytes.length;
    }
    return buf;
}

/**
 * Decode one server packet on the client:
 *   { type: "welcome", id, serverTick }
 *   { type: "state", serverTick, lastInputTick, players: [{ id, x, y, z, yaw, health, alive, firing, kills }] }
 *   { type: "names", entries: [{ id, name }] }
 *   { type: "event", evt, killerId, victimId, value }  (KILL / HIT)
 *   { type: "event", evt, x, z }                       (SPAWN)
 *   null for anything malformed
 */
export function decodeMessage(data) {
    const v = view(data);
    const n = v.byteLength;
    if (n < 1) return null;
    switch (v.getUint8(0)) {
        case MSG.WELCOME:
            if (n < 9) return null;
            return { type: "welcome", id: v.getUint32(1, true), serverTick: v.getUint32(5, true) };

        case MSG.STATE: {
            if (n < STATE_HEADER) return null;
            const count = v.getUint8(9);
            const players = [];
            for (let i = 0, off = STATE_HEADER; i < count && off + STATE_STRIDE <= n; i++, off += STATE_STRIDE) {
                const flags = v.getUint8(off + 21);
                players.push({
                    id: v.getUint32(off, true),
                    x: v.getFloat32(off + 4, true),
                    y: v.getFloat32(off + 8, true),
                    z: v.getFloat32(off + 12, true),
                    yaw: v.getFloat32(off + 16, true),
                    health: v.getUint8(off + 20),
                    alive: !!(flags & 1),
                    firing: !!(flags & 2),
                    kills: v.getUint16(off + 22, true),
                });
            }
            return {
                type: "state",
                serverTick: v.getUint32(1, true),
                lastInputTick: v.getUint32(5, true),
                players,
            };
        }

        case MSG.NAMES: {
            if (n < 2) return null;
            const count = v.getUint8(1);
            const bytes = new Uint8Array(v.buffer, v.byteOffset, n);
            const entries = [];
            let off = 2;
            for (let i = 0; i < count && off + 5 <= n; i++) {
                const id = v.getUint32(off, true);
                const len = v.getUint8(off + 4);
                off += 5;
                if (off + len > n) break;
                entries.push({ id, name: dec.decode(bytes.subarray(off, off + len)) });
                off += len;
            }
            return { type: "names", entries };
        }

        case MSG.EVENT: {
            if (n < 2) return null;
            const evt = v.getUint8(1);
            if (evt === EVT.KILL || evt === EVT.HIT) {
                if (n < 10) return null;
                return {
                    type: "event", evt,
                    killerId: v.getUint32(2, true),
                    victimId: v.getUint32(6, true),
                    value: n >= 12 ? v.getUint16(10, true) : 0,
                };
            }
            if (evt === EVT.SPAWN) {
                if (n < 10) return null;
                return { type: "event", evt, x: v.getFloat32(2, true), z: v.getFloat32(6, true) };
            }
            return { type: "event", evt };
        }

        default:
            return null;
    }
}
