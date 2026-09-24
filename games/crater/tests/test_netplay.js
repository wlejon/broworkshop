// Crater end to end over loopback: server.js runs in a Worker (as the
// launcher runs it), the page connects through the title menu, fills the
// lobby with a bot, readies, starts, fires a shell that the server simulates
// and the client animates, takes the bot's reply, then leaves.
import { check, frames, pumpUntil, press, q, clickOn, shot } from "/lib/kit/test.js";
import { currentRun } from "/app/game.js";
import { C } from "/app/shared.js";

const server = new Worker("server.js", { type: "module" });
frames(30);

// The server's timers run on the Worker's wall clock: hold the page to it.
function realtimeUntil(pred, ms) {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) {
        const next = Date.now() + 16;
        advanceTime(16);
        while (Date.now() < next) { /* pace to the server */ }
    }
    return !!pred();
}

check(!q("#screen-title").hidden, "title shown");
check(q("#in-address").value === "127.0.0.1:27100", "default address");
press("Enter");
check(pumpUntil(() => { const r = currentRun(); return r && r.myId != null && r.phase === "lobby"; }, 20000),
      "connected, welcomed, in the lobby");
const run = currentRun();
check(!q("#screen-lobby").hidden && q("#hud").hidden, "lobby screen, no match HUD");
check(q("#lobby-players").textContent.includes("Player (you)"), "our row: " + q("#lobby-players").textContent);
check(q('[data-action="start"]').classList.contains("disabled"), "Start waits for Ready");

clickOn('[data-action="bot"]');
check(pumpUntil(() => run.lobby.entries.length === 2, 5000), "a bot joined the lobby");
pumpUntil(() => false, 300);
check(run.lobby.entries.length === 2, "one click, one bot: " + run.lobby.entries.length);
clickOn('[data-action="ready"]');
check(pumpUntil(() => run.lobby.entries.every((p) => p.ready), 5000), "everyone ready");
check(q('[data-action="ready"]').textContent === "Not Ready", "Ready toggles its label");
check(!q('[data-action="start"]').classList.contains("disabled"), "host may start");
clickOn('[data-action="start"]');
check(pumpUntil(() => run.phase === "match", 5000), "match started");
frames(2);
check(q("#overlay").hidden && !q("#hud").hidden, "playing: HUD up, menus down");
check(run.hm && run.hm.length === C.COLS && run.players.length === 2, "terrain and two tanks");
eq2(q("#hud-players").children.length, 2, "HUD lists both tanks");

// If the bot drew the first turn, its shell plays out before ours.
check(realtimeUntil(() => run.turn === run.myId && !run.projectile, 15000), "our turn");
check(q("#hud-turn").textContent.includes("(YOU)"), "HUD says it is our turn: " + q("#hud-turn").textContent);
const me = run.players.find((p) => p.id === run.myId);
const bot = run.players.find((p) => p.bot);
run.aim.dir = bot.x > me.x ? 1 : -1;
run.aim.angle = Math.PI / 4;
const before = Float32Array.from(run.hm);
press(" ");
check(realtimeUntil(() => run.projectile && run.projectile.shooter === run.myId, 5000), "our shell is in the air");
shot("shell");
check(realtimeUntil(() => !run.projectile || run.projectile.shooter !== run.myId, 15000), "and lands");
const dug = run.hm.some((h, i) => h !== before[i]);
check(dug || run.turn !== run.myId, "the crater (or a miss) was applied; turn passed");

// The bot answers from the server, and the turn comes back (unless someone died).
check(realtimeUntil(() => (run.turn === run.myId && !run.projectile) || run.phase === "gameover", 20000),
      "the bot fired back: turn " + run.turn + ", phase " + run.phase);

// Esc pauses (the match carries on at the server); Leave goes to the title.
if (run.phase === "match") {
    press("Escape");
    check(!q("#screen-pause").hidden, "pause menu");
    clickOn('#screen-pause [data-action="leave"]');
} else {
    frames(4);
    clickOn('#screen-gameover [data-action="leave"]');
}
frames(4);
check(!q("#screen-title").hidden, "back at the title");
check(!run.client, "connection closed");

server.terminate();
console.log("crater netplay ok");

function eq2(a, b, msg) { check(a === b, msg + ": " + a + " vs " + b); }
