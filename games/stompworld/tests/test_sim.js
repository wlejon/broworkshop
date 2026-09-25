// Stompworld AI environment: the gaps are jumpable, snapshots restore
// exactly, the pickup arms the auto-fire, the heuristic finishes from the
// last stretch and seeds a replay buffer, and observations are well formed.
import { check, eq, test, done } from "/lib/kit/test.js";
import { TILE } from "/app/rules.js";
import { createLevelSim, spawnAtCol, endReason, NUM_ACTIONS } from "/app/sim.js";
import { heuristicAction, populateWarmup, makeRng } from "/app/ai/heuristic.js";
import { buildObs, obsDim } from "/app/ai/obs.js";

const RIGHT = 2, JUMP_RIGHT = 5;
// The replay buffer and the obs window are bro.ai.game.learn / .grid, which
// builds without the AI tower report as { available: false }.
const has = (k) => !!(bro.ai.game[k] && bro.ai.game[k].available !== false);
const aiTest = has("learn") && has("grid") ? test
    : (name) => console.log("SKIP: " + name + " (bro.ai.game.learn / .grid not in this build)");
const sim = createLevelSim({ timeLimit: 300 });
const col = () => Math.floor(sim.player.x / TILE);

/** Reset at a column; `edit(snap)` may change the start state. */
function startAt(c, edit) {
    spawnAtCol(sim, c);
    sim.reset();
    if (edit) {
        const snap = sim.snapshot();
        edit(snap);
        sim.restore(snap);
    }
}
const noEnemies = (s) => { s.stompers = []; s.flyers = []; };

test("each pit is jumpable with a held jump", () => {
    for (const [from, edge, far] of [[2, 12, 16], [38, 44, 50], [65, 72, 78]]) {
        startAt(from, noEnemies);
        while (col() < edge) sim.step(RIGHT);
        for (let t = 0; t < 30 && sim.alive; t++) sim.step(t < 6 ? JUMP_RIGHT : RIGHT);
        check(sim.alive, "survived the pit after col " + edge);
        check(col() >= far, "landed past the pit: col " + col());
    }
});

test("snapshot / restore replays exactly", () => {
    startAt(30);
    const rng = makeRng(7);
    for (let t = 0; t < 10; t++) sim.step((rng() * NUM_ACTIONS) | 0);
    const snap = sim.snapshot();
    const actions = Array.from({ length: 25 }, () => (rng() * NUM_ACTIONS) | 0);
    const run = () => actions.map((a) => sim.step(a).reward + ":" + sim.player.x + "," + sim.player.y).join(" ");
    const first = run();
    sim.restore(snap);
    eq(run(), first, "same trajectory after restore");
});

test("the pickup arms the hero and the heuristic reaches the flag", () => {
    startAt(110);
    let t = 0;
    while (t++ < 200 && !sim.step(heuristicAction(sim, () => 0.99)).done);
    eq(endReason(sim), "flag");
    check(sim.hasWeapon && sim.pickupCollected, "picked up the beam");
    eq(sim.score, 1300, "pickup 300 + flag 1000");
});

test("armed, auto-fire blasts the staircase ahead", () => {
    startAt(96, (s) => { noEnemies(s); s.hasWeapon = true; });
    let beams = 0;
    for (let t = 0; t < 40 && sim.alive && !sim.won; t++) {
        sim.step(RIGHT);
        sim.tilemap.commitOverlays();
        beams += sim.recentBeams.length;
    }
    check(beams > 0, "fired");
    check(sim.pixelsDestroyed > 0, "terrain destroyed: " + sim.pixelsDestroyed);
});

test("unarmed, auto-fire stays quiet", () => {
    startAt(96, noEnemies);
    for (let t = 0; t < 20; t++) sim.step(RIGHT);
    eq(sim.pixelsDestroyed, 0);
});

aiTest("behaviour-cloning warmup fills a replay buffer", () => {
    const buffer = bro.ai.game.learn.createGenericReplayBuffer(5000);
    spawnAtCol(sim, 110);
    const r = populateWarmup(buffer, sim, { targetSamples: 2, maxAttempts: 10, seed: 1 });
    check(r.kept >= 1 && r.flags >= 1, JSON.stringify(r));
    eq(buffer.size, r.tuplesPushed);
    check(r.tuplesPushed > 5, "tuples: " + r.tuplesPushed);
});

aiTest("observations are fixed-size and bounded", () => {
    startAt(20);
    const o = buildObs(sim);
    eq(o.length, obsDim());
    eq(obsDim(), 594, "layout (changing it invalidates checkpoints)");
    check(Array.from(o).every((v) => Number.isFinite(v) && v >= -1 && v <= 1), "in [-1, 1]");
});

done("stompworld sim");
