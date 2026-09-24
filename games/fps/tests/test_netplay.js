// FPS Arena end to end over loopback: server.js runs in a Worker (as the
// launcher runs it), the page connects through the real title menu, and the
// match plays out through bro.net — welcome, roster, bots rendered as remote
// bodies, predicted movement confirmed by the server, pause, disconnect.
import { check, frames, pumpUntil, press, q, text, shot } from "/lib/kit/test.js";
import { session } from "/app/net.js";
import { remoteCount } from "/app/world.js";
import { lookState } from "/app/game.js";
import { stepMove, IN, MOVE_SPEED } from "/app/arena.js";

const server = new Worker("server.js", { type: "module" });
frames(30);

// Title: the form is filled from the save and Connect is the first item.
check(!q("#screen-title").hidden, "title shown");
check(q("#address-input").value === "127.0.0.1:27015", "default address");
press("Enter");
check(pumpUntil(() => session.connected && session.myId != null, 20000), "connected and welcomed");
check(pumpUntil(() => session.names.size >= 4 && remoteCount() >= 3, 10000),
      "roster of 4 and three bot bodies: names " + session.names.size + ", bodies " + remoteCount());
check(Array.from(session.names.values()).includes("Player"), "our name reached the server");
check(q("#overlay").hidden && !q("#hud").hidden, "playing: HUD up, menus down");
check(text("#health-text") === "100", "full health: " + text("#health-text"));
check(!q("#click-prompt").hidden && q("#connecting").hidden, "asks for a click to capture the mouse");

// The server ticks on the Worker's wall clock, so drive the page in real time
// too (virtual time alone would run the client ahead of the server).
// Each step is at least 16 ms of wall time, and returns as soon as pred()
// holds. On a loaded machine the Worker's ticks come late, so every wait
// below is a condition with a generous wall-clock budget, not a fixed time.
function realtimeUntil(pred, budgetMs) {
    const end = Date.now() + budgetMs;
    while (!pred()) {
        if (Date.now() > end) return !!pred();
        const next = Date.now() + 16;
        advanceTime(16);
        while (Date.now() < next) { /* hold the page to the server's clock */ }
    }
    return true;
}

/**
 * A heading from (x, z) with a clear run of `dist` metres, found with the
 * same stepMove the server runs. Spawns are random, and straight at the
 * centre can be straight into an obstacle: the walk then stops after 0.1 m
 * however long W is held. Tries the centre first, then fans out.
 */
function clearHeading(x, z, dist) {
    const centre = Math.atan2(-x, z);           // yaw 0 = -Z
    for (let k = 0; k < 24; k++) {
        const yaw = centre + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        const p = { x, z };
        for (let t = 0; t < dist / MOVE_SPEED + 0.5; t += 1 / 60) stepMove(p, IN.FWD, yaw, 1 / 60, MOVE_SPEED);
        if (Math.hypot(p.x - x, p.z - z) >= dist) return yaw;
    }
    return centre;
}

// Capture the mouse and walk: prediction moves us, and the server agrees.
// The bots are live, so a walk can end in a death (and a respawn elsewhere):
// then wait for the respawn and walk again from the new spot.
const me = session.me;
check(realtimeUntil(() => me.hasServerPos && me.alive, 15000), "the server placed us and we are alive");
const look = lookState();
look.locked = true;                  // what a click's pointer lock does
const W = 119;
const WALK = 3;                      // metres, server-confirmed
let from = null, served = 0, walked = 0, attempts = 0;
while (attempts < 4) {
    attempts++;
    realtimeUntil(() => me.alive && me.hasServerPos, 15000);
    me.yaw = clearHeading(me.serverX, me.serverZ, WALK + 1);
    from = { x: me.serverX, z: me.serverZ };
    keyDown(W);
    realtimeUntil(() => !me.alive ||
        Math.hypot(me.serverX - from.x, me.serverZ - from.z) >= WALK, 20000);
    keyUp(W);
    served = Math.hypot(me.serverX - from.x, me.serverZ - from.z);
    walked = Math.hypot(me.x - from.x, me.z - from.z);
    if (me.alive && served >= WALK) break;
    console.log("walk attempt " + attempts + " cut short (alive " + me.alive + ", " +
                served.toFixed(2) + " m on the server); retrying");
}
check(served >= WALK && walked >= WALK * 0.8,
      "walked " + walked.toFixed(2) + " m predicted, " + served.toFixed(2) + " m on the server" +
      " (attempt " + attempts + ")");
// Standing still, prediction and the server converge.
check(realtimeUntil(() => Math.hypot(me.serverX - me.x, me.serverZ - me.z) < 0.5, 10000),
      "server confirms the position: " + me.serverX.toFixed(2) + "," + me.serverZ.toFixed(2) +
      " vs " + me.x.toFixed(2) + "," + me.z.toFixed(2));
check(session.clientTick > 30 && session.serverTick > 30, "ticks flowing");
shot("playing");

// Esc pauses (and the match keeps running server-side), Disconnect leaves.
press("Escape");
check(!q("#screen-pause").hidden, "pause menu");
check(!lookState().locked, "pause releases the mouse");
press("ArrowDown"); press("ArrowDown"); press("Enter");
frames(4);
check(!q("#screen-title").hidden, "Disconnect returns to the title");
check(!session.connected && remoteCount() === 0, "connection closed, remote bodies gone");

server.terminate();
console.log("fps netplay ok");
