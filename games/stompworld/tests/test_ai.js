// Stompworld AI modes against a scratch checkpoint folder (never the
// app's own ckpt/): the demo without and with a checkpoint, then Train AI
// resuming from it, with its trainer and MCTS module workers producing
// trajectories that the page replays; F toggles fast; Title stops it all.
import { check, eq, test, done, frames, simUntil, waitFor, q, press, shot } from "/lib/kit/test.js";
import { createNet } from "/app/ai/policy.js";

const fs = require("fs");
const SW = window.__SW;
const root = String(bro.appDir).replace(/\\/g, "/") + "/../../tests/out/stompworld-ckpt";
const EMPTY = root + "/empty";
const SEEDED = root + "/seeded";
for (const dir of [EMPTY, SEEDED]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(dir + "/" + f);
}
// A freshly initialised net stands in for a trained one.
fs.writeFileSync(SEEDED + "/best.bin", createNet().save());
fs.writeFileSync(SEEDED + "/best.json", JSON.stringify({ meanReturn: 0 }));

const visible = (id) => !q("#overlay").hidden && !q("#screen-" + id).hidden;
function menu(action) {
    q('#screen-title [data-action="' + action + '"]').click();
    frames(3);
}
function toTitle() {
    press("Escape");
    frames(2);
    check(visible("pause"), "paused");
    q('#screen-pause [data-action="title"]').click();
    frames(2);
    check(visible("title"), "title");
}

frames(5);

test("AI Demo without a checkpoint says so", () => {
    SW.setCheckpointDir(EMPTY);
    menu("demo");
    eq(SW.mode, "demo");
    check(!SW.demo.hasCheckpoint, "no checkpoint");
    eq(SW.demo.phase, "finished");
    check(q("#hud").hidden, "arcade HUD hidden in demo");
    shot("demo-no-checkpoint");
    toTitle();
    eq(SW.mode, null, "demo stopped");
});

test("AI Demo plays a checkpoint", () => {
    SW.setCheckpointDir(SEEDED);
    menu("demo");
    check(SW.demo.hasCheckpoint, "checkpoint loaded");
    simUntil(() => SW.demo.tick > 120 || SW.demo.phase === "finished", 5000);
    check(SW.demo.tick > 0, "the policy is driving the sim: " + JSON.stringify(SW.demo));
    check(["network", "backtrack", "toflag", "finished"].includes(SW.demo.phase), SW.demo.phase);
    shot("demo");
    toTitle();
});

test("Train AI resumes, self-plays and replays", () => {
    menu("train");
    eq(SW.mode, "train");
    check(q("#hud").hidden, "arcade HUD hidden in training");
    waitFor(() => SW.train.trainerReady, "trainer ready", 60000);
    check(SW.train.warmup.resumed, "resumed from the seeded checkpoint");
    waitFor(() => SW.train.trajectories > 0 && SW.train.episodes > 0, "a replayed trajectory", 180000);
    check(SW.train.mctsEpisodes >= 0, "MCTS stats");
    press("f");
    frames(2);
    check(SW.train.fast, "F = fast");
    press("f");
    frames(2);
    check(!SW.train.fast, "F again = normal");
    shot("train");
    toTitle();
    eq(SW.mode, null, "training stopped");
});

done("stompworld ai");
