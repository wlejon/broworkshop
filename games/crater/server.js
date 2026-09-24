// Crater — authoritative server.
//
//   bro-server games/crater games/crater/server.js
//
// The launcher runs this same file in a Worker (launcher/apps.json "server").
// Connections, the hello/welcome handshake and JSON framing are
// lib/netroom.js; the rules are match.js; the physics is shared.js, the same
// module the client renders with. Imports resolve relative to this file, so
// they work under bro-server and in a Worker alike.

import { NetRoom } from "/lib/netroom.js";
import { createMatch, MAX_PLAYERS } from "./match.js";

const PORT = 27100;

let match = null;
const room = NetRoom.host({
    port: PORT,
    maxPlayers: MAX_PLAYERS,
    accept: () => match.admit(),
    onJoin: (p) => match.join(p.id, p.name),
    onLeave: (p) => match.leave(p.id),
    onMessage(id, tag, m) {
        switch (tag) {
            case "ready": match.setReady(id, m.ready); break;
            case "addBot": match.addBot(id); break;
            case "start": match.start(id); break;
            case "fire": match.fire(id, m); break;
        }
    },
});
match = createMatch({ room });

// Forfeit stalled human turns (a player who walked away can't hang the match).
setInterval(() => match.checkTimeout(), 1000);

console.log("[crater] listening on " + PORT);
