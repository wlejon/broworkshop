// protocol.js — FPS Arena binary wire format (client ↔ server).
// Pure encode/decode only. No DOM, scene, or shell.
// Layout must stay in lockstep with server.js (duplicated constants there).

// ── Message types ────────────────────────────────────────────────────────

export const MSG = {
    INPUT: 0x01,
    STATE: 0x02,
    WELCOME: 0x03,
    EVENT: 0x04,
    NAMES: 0x05,
};

// ── Event subtypes (MSG.EVENT payload) ───────────────────────────────────

export const EVT = {
    KILL: 0,
    HIT: 1,
    SPAWN: 2,
};

// ── Input bit flags (MSG.INPUT keys byte) ────────────────────────────────

export const IN = {
    FWD: 1,
    BACK: 2,
    LEFT: 4,
    RIGHT: 8,
    SHOOT: 16,
};

// ── Client → server ──────────────────────────────────────────────────────

/** 14-byte unreliable input snapshot. */
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

/** Reliable JSON name-set (server also accepts this text form). */
export function encodeSetName(name) {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "set_name", name }));
    return bytes.buffer;
}

// ── Server → client ──────────────────────────────────────────────────────

/**
 * Decode one server packet into a plain object.
 * @param {ArrayBuffer|ArrayBufferView} data
 * @returns {
 *   | { type: "welcome", id: number, serverTick: number }
 *   | { type: "state", serverTick: number, players: Array<{
 *         id: number, x: number, y: number, z: number, yaw: number,
 *         health: number, alive: boolean, kills: number
 *       }> }
 *   | { type: "names", entries: Array<{ id: number, name: string }> }
 *   | { type: "event", evt: number, killerId?: number, victimId?: number,
 *       x?: number, z?: number }
 *   | null
 * }
 */
export function decodeMessage(data) {
    const ab = data instanceof ArrayBuffer ? data : data.buffer;
    const byteOffset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
    const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
    if (byteLength < 1) return null;

    const v = new DataView(ab, byteOffset, byteLength);
    const type = v.getUint8(0);

    switch (type) {
        case MSG.WELCOME: {
            if (byteLength < 7) return null;
            return {
                type: "welcome",
                id: v.getUint16(1, true),
                serverTick: v.getUint32(3, true),
            };
        }

        case MSG.STATE: {
            if (byteLength < 10) return null;
            const serverTick = v.getUint32(1, true);
            const count = v.getUint8(9);
            const players = [];
            let off = 10;
            const stride = 2 + 4 * 4 + 1 + 1 + 2; // id + xyz yaw + health + flags + kills
            for (let i = 0; i < count; i++) {
                if (off + stride > byteLength) break;
                const id = v.getUint16(off, true); off += 2;
                const x = v.getFloat32(off, true); off += 4;
                const y = v.getFloat32(off, true); off += 4;
                const z = v.getFloat32(off, true); off += 4;
                const yaw = v.getFloat32(off, true); off += 4;
                const health = v.getUint8(off); off += 1;
                const flags = v.getUint8(off); off += 1;
                const kills = v.getUint16(off, true); off += 2;
                players.push({
                    id, x, y, z, yaw, health,
                    alive: !!(flags & 1),
                    kills,
                });
            }
            return { type: "state", serverTick, players };
        }

        case MSG.NAMES: {
            if (byteLength < 2) return null;
            const count = v.getUint8(1);
            const entries = [];
            let off = 2;
            const bytes = new Uint8Array(ab, byteOffset, byteLength);
            const dec = new TextDecoder();
            for (let i = 0; i < count; i++) {
                if (off + 3 > byteLength) break;
                const id = v.getUint16(off, true); off += 2;
                const nameLen = v.getUint8(off); off += 1;
                if (off + nameLen > byteLength) break;
                const name = dec.decode(bytes.subarray(off, off + nameLen));
                off += nameLen;
                entries.push({ id, name });
            }
            return { type: "names", entries };
        }

        case MSG.EVENT: {
            if (byteLength < 2) return null;
            const evt = v.getUint8(1);
            if (evt === EVT.KILL || evt === EVT.HIT) {
                if (byteLength < 6) return null;
                return {
                    type: "event",
                    evt,
                    killerId: v.getUint16(2, true),
                    victimId: v.getUint16(4, true),
                };
            }
            if (evt === EVT.SPAWN) {
                if (byteLength < 10) return null;
                return {
                    type: "event",
                    evt,
                    x: v.getFloat32(2, true),
                    z: v.getFloat32(6, true),
                };
            }
            return { type: "event", evt };
        }

        default:
            return null;
    }
}
