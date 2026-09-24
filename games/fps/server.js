// FPS Arena — authoritative server.
//
//   bro-server games/fps games/fps/server.js --tickrate 60
//
// The launcher runs this same file in a Worker (launcher/apps.json "server").
// Clients send 60 Hz input; the match (sim.js) moves everyone, resolves
// hitscan, health and respawns, runs the bots (bots.js), and sends each
// client a state snapshot every tick. Wire format: protocol.js.
// Imports are relative so they resolve the same under bro-server and a Worker.

import { createMatch } from "./sim.js";

const PORT = 27015;
const TICK_RATE = 60;

bro.net.init();
if (!bro.net.host(PORT)) {
    console.error("FPS server: failed to bind port " + PORT);
    if (bro.server) bro.server.stop();
    throw new Error("FPS server: port " + PORT + " unavailable");
}
if (bro.server) bro.server.tickrate = TICK_RATE;
console.log("FPS server on port " + PORT);

const match = createMatch({
    send: (id, buf, reliable) => bro.net.send(id, buf, reliable !== false),
});

bro.net.onconnect = (id) => match.join(id);
bro.net.ondisconnect = (id) => match.leave(id);
bro.net.onmessage = (id, data) => match.message(id, data);

setInterval(() => match.tick(1 / TICK_RATE), 1000 / TICK_RATE);

setInterval(() => {
    const humans = Array.from(match.players.values()).filter((p) => !p.isBot).length;
    if (humans > 0) console.log("[tick " + match.serverTick + "] " + humans + " player(s)");
}, 10000);
