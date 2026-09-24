// netroom.js — small lobby + message helpers over bro.net.
//
// Most multiplayer arcade games only need a tiny subset of networking:
// join/leave, a small JSON state, typed actions. That's what this covers.
// Hot-path binary traffic (FPS input at 60 Hz) should still use bro.net.send
// directly with a binary encoding (games/fps/protocol.js).
//
// Wire format: ArrayBuffer = TextEncoder(JSON.stringify({ t: tag, ...payload })).
//
// Handshake: the client sends `hello { name, meta }` on connect; the host
// either replies `welcome { id }` and calls onJoin, or replies
// `denied { reason }` and disconnects (server full, or opts.accept said no).
//
// Server (host) usage — works in bro-server, a launcher Worker, or a page:
//   import { NetRoom } from "/lib/netroom.js";
//   const room = NetRoom.host({
//       port: 27100,
//       maxPlayers: 8,
//       accept(player, hello) { return lobbyOpen ? null : "Match in progress"; },
//       onJoin(player)   { ... },   // { id, name, meta }
//       onLeave(player)  { ... },
//       onMessage(id, tag, msg) {},
//   });
//   room.broadcast("state", { turn: 0, map: [...] });
//   room.send(playerId, "youAre", { id });
//
// Client usage:
//   const client = NetRoom.join({
//       address: "127.0.0.1:27100",
//       name: "Jonny",
//       onConnect() {},
//       onMessage(tag, msg) {},     // includes "welcome" and "denied"
//       onDisconnect(reason) {},
//   });
//   client.send("fire", { angle: 45, power: 0.7 });

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Encode one tagged message. */
function frame(tag, msg) {
    return enc.encode(JSON.stringify(Object.assign({ t: tag }, msg || {}))).buffer;
}

/** Decode one message, or null if it is not a tagged JSON frame. */
function unframe(buf) {
    try {
        const obj = JSON.parse(dec.decode(buf));
        if (obj && typeof obj.t === "string") return obj;
    } catch (e) { /* not ours */ }
    return null;
}

function ensureNet() {
    if (typeof bro === "undefined" || !bro.net) {
        throw new Error("bro.net unavailable — NetRoom requires engine networking");
    }
}

const noop = () => {};

// ─── host ─────────────────────────────────────────────────────────────────

function host(opts) {
    ensureNet();
    const o = opts || {};
    const port = o.port || 27100;
    const maxPlayers = o.maxPlayers || 8;
    const accept = o.accept || (() => null);
    const onJoin = o.onJoin || noop;
    const onLeave = o.onLeave || noop;
    const onMessage = o.onMessage || noop;

    // connId → { id, name, meta, joined }. id === connId. `joined` flips on a
    // welcomed hello; onLeave only fires for players that joined.
    const players = new Map();

    const send = (connId, tag, msg, reliable) => {
        try { return bro.net.send(connId, frame(tag, msg), reliable !== false); } catch (e) { return false; }
    };
    const deny = (connId, reason) => {
        send(connId, "denied", { reason });
        players.delete(connId);
        try { bro.net.disconnect(connId); } catch (e) { /* already gone */ }
    };

    bro.net.init();
    if (!bro.net.host(port)) throw new Error("Failed to host on port " + port);

    bro.net.onconnect = (connId) => {
        // The name arrives with "hello"; a placeholder until then.
        players.set(connId, { id: connId, name: "Player " + connId, meta: {}, joined: false });
    };

    bro.net.ondisconnect = (connId) => {
        const p = players.get(connId);
        players.delete(connId);
        if (p && p.joined) onLeave(p);
    };

    bro.net.onmessage = (connId, data) => {
        const m = unframe(data);
        const p = players.get(connId);
        if (!m || !p) return;
        if (m.t === "hello") {
            if (p.joined) return;
            if (typeof m.name === "string" && m.name.trim()) p.name = m.name.trim().slice(0, 24);
            p.meta = m.meta || {};
            let joinedCount = 0;
            for (const q of players.values()) if (q.joined) joinedCount++;
            const reason = joinedCount >= maxPlayers ? "Server full" : accept(p, m);
            if (reason) { deny(connId, reason); return; }
            p.joined = true;
            send(connId, "welcome", { id: connId });
            onJoin(p);
            return;
        }
        if (p.joined) onMessage(connId, m.t, m);
    };

    return {
        port,
        players: () => Array.from(players.values()).filter((p) => p.joined),
        get: (id) => {
            const p = players.get(id);
            return p && p.joined ? p : null;
        },
        count: () => {
            let n = 0;
            for (const p of players.values()) if (p.joined) n++;
            return n;
        },
        send,
        broadcast(tag, msg, reliable) {
            try { bro.net.broadcast(frame(tag, msg), reliable !== false); } catch (e) { /* no peers */ }
        },
        kick(connId, reason) { deny(connId, reason || "Kicked"); },
        close() {
            try { bro.net.close(); } catch (e) { /* already closed */ }
        },
    };
}

// ─── client ───────────────────────────────────────────────────────────────

function join(opts) {
    ensureNet();
    const o = opts || {};
    const name = o.name || "Player";
    const meta = o.meta || {};
    const onConnect = o.onConnect || noop;
    const onMessage = o.onMessage || noop;
    const onDisconnect = o.onDisconnect || noop;

    let connId = null;
    let myId = null;
    let closed = false;

    bro.net.init();

    bro.net.onconnect = (id) => {
        if (closed) return;
        connId = id;
        bro.net.send(id, frame("hello", { name, meta }));
        onConnect();
    };

    bro.net.ondisconnect = (_id, reason) => {
        connId = null;
        if (closed) return;
        closed = true;
        onDisconnect(reason);
    };

    bro.net.onmessage = (_id, data) => {
        if (closed) return;
        const m = unframe(data);
        if (!m) return;
        if (m.t === "welcome") myId = m.id;
        onMessage(m.t, m);
    };

    if (!bro.net.connect(o.address)) throw new Error("Failed to connect to " + o.address);

    return {
        myId: () => myId,
        connected: () => connId != null,
        send(tag, msg, reliable) {
            if (connId == null) return false;
            return bro.net.send(connId, frame(tag, msg), reliable !== false);
        },
        /** Leave quietly: no onDisconnect callback for a close we asked for. */
        close() {
            closed = true;
            if (connId != null) {
                try { bro.net.disconnect(connId); } catch (e) { /* already gone */ }
            }
            connId = null;
        },
    };
}

export const NetRoom = { host, join, frame, unframe };
