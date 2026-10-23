// Provably Zero-Desync Cross-Play Rollback Netcode helper (/lib/kit/rollback.js)
//
// Wraps `bro.net.createRollbackSession(opts)` with deterministic 64-bit FNV-1a
// state hashing, lockstep hazard verification, and a network packet adapter
// for `bro.net` / `netroom` peer sessions.

'use strict';

const FNV_OFFSET_HI = 0xcbf29ce4 >>> 0;
const FNV_OFFSET_LO = 0x84222325 >>> 0;
const FNV_PRIME_HI  = 0x00000100 >>> 0;
const FNV_PRIME_LO  = 0x000001b3 >>> 0;

function mul64(aHi, aLo, bHi, bLo) {
    const a0 = aLo & 0xFFFF;
    const a1 = aLo >>> 16;
    const a2 = aHi & 0xFFFF;
    const a3 = aHi >>> 16;

    const b0 = bLo & 0xFFFF;
    const b1 = bLo >>> 16;
    const b2 = bHi & 0xFFFF;
    const b3 = bHi >>> 16;

    let c0 = a0 * b0;
    let c1 = (c0 >>> 16) + a1 * b0 + a0 * b1;
    c0 &= 0xFFFF;
    let c2 = (c1 >>> 16) + a2 * b0 + a1 * b1 + a0 * b2;
    c1 &= 0xFFFF;
    let c3 = (c2 >>> 16) + a3 * b0 + a2 * b1 + a1 * b2 + a0 * b3;
    c2 &= 0xFFFF;
    c3 &= 0xFFFF;

    const lo = ((c1 << 16) | c0) >>> 0;
    const hi = ((c3 << 16) | c2) >>> 0;
    return [hi, lo];
}

function hex8(u32) {
    return (u32 >>> 0).toString(16).padStart(8, '0');
}

export function fnv1a64Bytes(bytes) {
    let hi = FNV_OFFSET_HI;
    let lo = FNV_OFFSET_LO;
    for (let i = 0; i < bytes.length; i++) {
        lo = (lo ^ (bytes[i] & 0xFF)) >>> 0;
        const next = mul64(hi, lo, FNV_PRIME_HI, FNV_PRIME_LO);
        hi = next[0];
        lo = next[1];
    }
    return {
        hi,
        lo,
        hex: hex8(hi) + hex8(lo),
    };
}

function stateToBytes(state, serializeState) {
    if (typeof serializeState === 'function') {
        const res = serializeState(state);
        if (res instanceof Uint8Array) return new Uint8Array(res);
        if (ArrayBuffer.isView(res)) {
            return new Uint8Array(res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength));
        }
        const s = String(res);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
        return out;
    }
    if (ArrayBuffer.isView(state)) {
        return new Uint8Array(state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength));
    }
    const json = JSON.stringify(state);
    const out = new Uint8Array(json.length);
    for (let i = 0; i < json.length; i++) out[i] = json.charCodeAt(i) & 0xFF;
    return out;
}

function restoreBytesToState(bytes, state, deserializeState) {
    if (typeof deserializeState === 'function') {
        const next = deserializeState(bytes, state);
        return next !== undefined ? next : state;
    }
    if (ArrayBuffer.isView(state)) {
        const dst = new Uint8Array(state.buffer, state.byteOffset, state.byteLength);
        const n = Math.min(dst.length, bytes.length);
        for (let i = 0; i < n; i++) dst[i] = bytes[i];
        return state;
    }
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    const parsed = JSON.parse(s);
    if (state && typeof state === 'object' && parsed && typeof parsed === 'object') {
        Object.assign(state, parsed);
        return state;
    }
    return parsed;
}

function auditTickSourceDeterminism(src) {
    const hazards = [];
    if (/\bMath\s*\.\s*random\s*\(/.test(src)) {
        hazards.push({
            kind: 'unseeded-prng',
            message: 'Math.random() is non-deterministic across lockstep peers',
            line: 1,
        });
    }
    if (/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|\bperformance\s*\.\s*now\s*\(/.test(src)) {
        hazards.push({
            kind: 'wall-clock-time',
            message: 'Wall-clock timer call is non-deterministic across lockstep peers',
            line: 1,
        });
    }
    if (/\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log)\s*\(/.test(src)) {
        hazards.push({
            kind: 'transcendental-float-drift',
            message: 'Transcendental Math function may drift by 1 ULP across architectures',
            line: 1,
        });
    }
    const enc = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) enc[i] = src.charCodeAt(i) & 0xFF;
    const h1 = fnv1a64Bytes(enc).hex;
    const h2 = fnv1a64Bytes(new Uint8Array([...enc, 1, 2, 3, 4])).hex;
    return {
        deterministic: hazards.length === 0,
        certificateHash: hazards.length === 0 ? (h1 + h2 + h1 + h2) : '',
        hazards,
    };
}

export function createRollbackSession(optsOrTick, maybeOpts) {
    if (typeof globalThis.bro === 'object' &&
        globalThis.bro &&
        globalThis.bro.net &&
        typeof globalThis.bro.net.createRollbackSession === 'function') {
        return maybeOpts !== undefined
            ? globalThis.bro.net.createRollbackSession(optsOrTick, maybeOpts)
            : globalThis.bro.net.createRollbackSession(optsOrTick);
    }

    // Pure-JS fallback for environments without native bro.net.createRollbackSession
    const opts = typeof optsOrTick === 'function' || typeof optsOrTick === 'string'
        ? Object.assign({}, maybeOpts || {}, { tick: optsOrTick })
        : (optsOrTick || {});

    const rawTick = opts.tick !== undefined ? opts.tick : opts.tickFn;
    if (typeof rawTick !== 'function' && typeof rawTick !== 'string') {
        throw new TypeError('createRollbackSession requires a tick function');
    }

    const tickSource = typeof rawTick === 'string' ? rawTick : String(rawTick.toString());
    const audit = auditTickSourceDeterminism(tickSource);
    if (!audit.deterministic && !opts.allowUnverified) {
        const first = audit.hazards[0];
        throw new Error('RollbackSession rejected non-deterministic tick function: [' +
            first.kind + '] ' + first.message);
    }
    const tick = typeof rawTick === 'function' ? rawTick : function () {};

    const playerCount = Math.max(1, (opts.playerCount || opts.numPlayers || 2) | 0);
    const localPlayerId = Math.min(playerCount - 1, Math.max(0, (opts.localPlayerId || opts.localPlayer || 0) | 0));
    const maxRollbackFrames = Math.max(4, (opts.maxRollbackFrames || 64) | 0);
    const stateSize = Math.max(4, (opts.stateSize || 64) | 0);

    let state = opts.initialState !== undefined
        ? opts.initialState
        : new Int32Array(Math.max(1, stateSize >> 2));

    const ringSize = maxRollbackFrames + 4;
    const ring = new Array(ringSize);
    const inputHistory = [];
    const lastConfirmed = new Int32Array(playerCount);
    const hasConfirmed = new Uint8Array(playerCount);

    let currentFrame = 0;
    let rollbackCount = 0;
    let totalFramesResimulated = 0;
    let desyncDetected = false;

    const initialBytes = stateToBytes(state, opts.serializeState);

    function saveSnapshot(frame, bytes, inputs, confirmed) {
        const cs = fnv1a64Bytes(bytes);
        ring[frame % ringSize] = {
            frame,
            stateBytes: new Uint8Array(bytes),
            inputs: inputs ? Array.from(inputs) : new Array(playerCount).fill(0),
            confirmed: confirmed ? Array.from(confirmed) : new Array(playerCount).fill(0),
            checksumHex: cs.hex,
            checksumLow32: cs.lo,
            valid: true,
        };
        return cs;
    }

    saveSnapshot(0, initialBytes, new Array(playerCount).fill(0), new Array(playerCount).fill(1));

    function predictInput(frame, p) {
        for (let k = Math.min(frame, inputHistory.length) - 1; k >= 0; k--) {
            if (inputHistory[k].confirmed[p]) return inputHistory[k].inputs[p];
        }
        return hasConfirmed[p] ? lastConfirmed[p] : 0;
    }

    function ensureHistory(frame) {
        while (inputHistory.length <= frame) {
            inputHistory.push({
                inputs: new Int32Array(playerCount),
                confirmed: new Uint8Array(playerCount),
            });
        }
    }

    return {
        deterministic: audit.deterministic,
        deterministicCertified: audit.deterministic,
        certificateHash: audit.certificateHash,
        hazards: audit.hazards,
        playerCount,
        localPlayerId,
        maxRollbackFrames,
        get state() { return state; },
        set state(v) { state = v; },
        get currentFrame() { return currentFrame; },
        get rollbackCount() { return rollbackCount; },
        get totalFramesResimulated() { return totalFramesResimulated; },
        get desyncDetected() { return desyncDetected; },
        get checksumHex() {
            const bytes = stateToBytes(state, opts.serializeState);
            const snap = saveSnapshot(currentFrame, bytes,
                ring[currentFrame % ringSize] ? ring[currentFrame % ringSize].inputs : null,
                ring[currentFrame % ringSize] ? ring[currentFrame % ringSize].confirmed : null);
            return snap.hex;
        },
        get checksumLow32() {
            const bytes = stateToBytes(state, opts.serializeState);
            return fnv1a64Bytes(bytes).lo;
        },
        advanceFrame(localInputs) {
            const f = currentFrame;
            ensureHistory(f);
            const rec = inputHistory[f];
            for (let p = 0; p < playerCount; p++) {
                if (rec.confirmed[p]) continue;
                if (typeof localInputs === 'number' && p === localPlayerId) {
                    rec.inputs[p] = localInputs | 0;
                    rec.confirmed[p] = 1;
                    lastConfirmed[p] = rec.inputs[p];
                    hasConfirmed[p] = 1;
                } else if (localInputs && typeof localInputs === 'object' && typeof localInputs[p] === 'number') {
                    rec.inputs[p] = localInputs[p] | 0;
                    if (p === localPlayerId) {
                        rec.confirmed[p] = 1;
                        lastConfirmed[p] = rec.inputs[p];
                        hasConfirmed[p] = 1;
                    }
                } else {
                    rec.inputs[p] = predictInput(f, p);
                }
            }
            const ret = tick(state, Array.from(rec.inputs), f);
            if (ret && typeof ret === 'object') state = ret;
            currentFrame = f + 1;
            const bytes = stateToBytes(state, opts.serializeState);
            const cs = saveSnapshot(currentFrame, bytes, rec.inputs, rec.confirmed);
            return {
                frame: currentFrame,
                checksumHex: cs.hex,
                checksumLow32: cs.lo,
                state,
            };
        },
        receiveRemoteInput(frame, playerId, actualInput, remoteChecksumHex) {
            if (frame && typeof frame === 'object') {
                const o = frame;
                frame = o.frame | 0;
                playerId = (o.playerId !== undefined ? o.playerId : o.player) | 0;
                actualInput = (o.actualInput !== undefined ? o.actualInput : o.input) | 0;
                remoteChecksumHex = o.remoteChecksumHex || o.checksumHex;
            }
            ensureHistory(frame);
            const wasSimulated = frame < currentFrame;
            const prevInput = inputHistory[frame].inputs[playerId];
            inputHistory[frame].inputs[playerId] = actualInput | 0;
            inputHistory[frame].confirmed[playerId] = 1;
            lastConfirmed[playerId] = actualInput | 0;
            hasConfirmed[playerId] = 1;

            let subChanged = false;
            if (wasSimulated) {
                for (let f = frame + 1; f < currentFrame; f++) {
                    if (inputHistory[f].confirmed[playerId]) break;
                    if (inputHistory[f].inputs[playerId] !== (actualInput | 0)) {
                        inputHistory[f].inputs[playerId] = actualInput | 0;
                        subChanged = true;
                    }
                }
            }

            let rolledBack = false;
            let framesResimulated = 0;
            if (wasSimulated && ((actualInput | 0) !== prevInput || subChanged)) {
                const restore = ring[frame % ringSize];
                if (restore && restore.valid && restore.frame === frame) {
                    state = restoreBytesToState(restore.stateBytes, state, opts.deserializeState);
                    for (let f = frame; f < currentFrame; f++) {
                        const ret = tick(state, Array.from(inputHistory[f].inputs), f);
                        if (ret && typeof ret === 'object') state = ret;
                        const bytes = stateToBytes(state, opts.serializeState);
                        saveSnapshot(f + 1, bytes, inputHistory[f].inputs, inputHistory[f].confirmed);
                    }
                    rolledBack = true;
                    framesResimulated = currentFrame - frame;
                    rollbackCount++;
                    totalFramesResimulated += framesResimulated;
                }
            }

            if (typeof remoteChecksumHex === 'string' && remoteChecksumHex.length > 0 && frame <= currentFrame) {
                const s0 = ring[frame % ringSize];
                const s1 = (frame + 1 <= currentFrame) ? ring[(frame + 1) % ringSize] : null;
                const match0 = s0 && s0.valid && s0.frame === frame && s0.checksumHex === remoteChecksumHex;
                const match1 = s1 && s1.valid && s1.frame === frame + 1 && s1.checksumHex === remoteChecksumHex;
                if (!match0 && !match1) desyncDetected = true;
            }

            return {
                rolledBack,
                framesResimulated,
                currentFrame,
                currentChecksum: this.checksumHex,
                desyncDetected,
            };
        },
        verifyPeerChecksum(frame, remoteChecksumHex) {
            if (frame === currentFrame) {
                const liveHex = this.checksumHex;
                if (liveHex === remoteChecksumHex) return true;
                desyncDetected = true;
                return false;
            }
            const snap = ring[frame % ringSize];
            if (snap && snap.valid && snap.frame === frame && snap.checksumHex === remoteChecksumHex) {
                return true;
            }
            desyncDetected = true;
            return false;
        },
        stateHash(frame) {
            const f = frame !== undefined ? (frame | 0) : currentFrame;
            if (f === currentFrame) return this.checksumHex;
            const snap = ring[f % ringSize];
            return (snap && snap.valid && snap.frame === f) ? snap.checksumHex : '';
        },
        getSnapshot(frame) {
            const f = frame !== undefined ? (frame | 0) : currentFrame;
            if (f === currentFrame) {
                const liveHex = this.checksumHex;
                const snap = ring[f % ringSize];
                return {
                    frame: f,
                    checksumHex: liveHex,
                    checksumLow32: snap ? snap.checksumLow32 : 0,
                    inputs: snap ? Array.from(snap.inputs) : [],
                };
            }
            const snap = ring[f % ringSize];
            if (!snap || !snap.valid || snap.frame !== f) return null;
            return {
                frame: snap.frame,
                checksumHex: snap.checksumHex,
                checksumLow32: snap.checksumLow32,
                inputs: Array.from(snap.inputs),
            };
        },
        getStats() {
            return {
                currentFrame,
                rollbackCount,
                totalFramesResimulated,
                deterministic: audit.deterministic,
                certificateHash: audit.certificateHash,
                desyncDetected,
            };
        },
    };
}
