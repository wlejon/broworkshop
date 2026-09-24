// Farm chrome: the title menu starts the farm through the engine's key path,
// the HUD panels fill from the world, and Esc pauses.
import { check, eq, frames, press, q, text, shot } from "/lib/kit/test.js";

const F = window.__farm;
check(F, "window.__farm installed");

for (const id of [
    "view", "overlay", "screen-title", "screen-howto", "screen-pause", "screen-gameover",
    "hud", "hud-clock", "hud-env", "hud-resources", "hud-market", "hud-objective",
    "hud-workers", "hud-alerts", "hud-dialog", "statsheet",
]) {
    check(document.getElementById(id), "#" + id + " present");
}

F.noVoices();
frames(4);
check(!q("#screen-title").hidden, "title visible after boot");
check(q("#hud").hidden, "HUD hidden on the title");
check(q("#statsheet").hidden, "stat sheet starts closed");

press("Enter");
frames(4);
eq(F.screen, "playing", "Enter on Start begins the farm");
check(!q("#hud").hidden, "HUD shown while playing");

check(/^Day 1 · \d\d:\d\d$/.test(text("#hud-clock")), "clock: " + text("#hud-clock"));
eq(q("#hud-resources").querySelectorAll(".res-chip").length, 7, "seven resource chips");
eq(q("#hud-market").querySelectorAll(".price-chip").length, 5, "five market prices");
eq(q("#hud-workers").querySelectorAll(".wk-row").length, 4, "four worker rows");
eq(q("#hud-workers").querySelectorAll(".wk-bar").length, 16, "four need bars per worker");
check(/Reach 1500g by Day 8/.test(text("#hud-objective")), "objective: " + text("#hud-objective"));
check(q("#hud-alerts").children.length >= 1, "alerts panel filled");
check(/Gold\s*200/.test(text("#hud-resources")), "starting gold: " + text("#hud-resources"));

// The farm runs on its own: time passes and the Foreman starts briefing.
const t0 = F.world.clock.t;
frames(60);
check(F.world.clock.t > t0, "sim clock advances while playing");
check(F.world.npcs.every((n) => n.station), "every worker has a station");
shot("playing");

press("Escape");
frames(2);
eq(F.screen, "pause", "Esc pauses");
const tp = F.world.clock.t;
frames(10);
eq(F.world.clock.t, tp, "paused farm does not advance");
press("Enter");
frames(2);
eq(F.screen, "playing", "Resume");

console.log("farm smoke ok");
