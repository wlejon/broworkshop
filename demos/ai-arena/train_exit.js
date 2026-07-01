// train_exit.js — headless ExIt (expert iteration) training loop for the
// "exit_net" agent (agents/exit_net.js), mirroring brogameagent's own
// reference trainer (brogameagent/tools/nn_exit.cpp) iteration shape:
//
//   iteration k:
//     - generate EPISODES self-play matches on Scenarios.DUEL_1V1
//       (exit_net vs the existing "scripted" agent), capturing a Situation
//       per hero decision; iteration 0 uses classical MCTS (untrained-net
//       priors/values would just be noise), every later iteration uses the
//       net being trained
//     - backfill each episode's captured situations with its discounted
//       final return and push them into a ReplayBuffer
//     - run TRAIN_STEPS minibatch SGD steps via ExItTrainer
//     - evaluate the updated net against the same scripted baseline over
//       EVAL_EPISODES episodes
//     - checkpoint net.save() to <appDir>/checkpoints/exit_iter_<k>.bgnn
//
// This drives the REAL app (not a bypassed bare World like nn_exit.cpp) —
// setScenario/advanceTime/the exit_net registry agent — the same machinery
// every other agent in this app runs through, just paced by a headless
// script instead of a person clicking Red/Blue AI dropdowns.
//
// Script-file headless invocations run as plain classic scripts (no ES
// import), so this only uses the window.get*/setScenario debug hooks
// main.js exposes, plus bro.ai.game.* (a real global) and require('fs').
//
// Run:
//   bro-headless ../broworkshop/demos/ai-arena train_exit.js
//
// Overrideable globals (set via -e BEFORE the script path, same convention
// as fast_eval.js/headless_eval.js):
//   TRAIN_ITERS          iterations               (default 3)
//   TRAIN_EPISODES       self-play episodes/iter   (default 6)
//   TRAIN_MAX_SECONDS    per-episode sim-time cap  (default 20)
//   TRAIN_STEPS          SGD steps/iter            (default 300)
//   TRAIN_EVAL_EPISODES  eval episodes/iter        (default 4)
"use strict";

var fs = require("fs");

var ITERS         = typeof TRAIN_ITERS         === "number" ? TRAIN_ITERS         : 3;
var EPISODES      = typeof TRAIN_EPISODES      === "number" ? TRAIN_EPISODES      : 6;
var MAX_SECONDS   = typeof TRAIN_MAX_SECONDS   === "number" ? TRAIN_MAX_SECONDS   : 20;
var TRAIN_STEPS_N = typeof TRAIN_STEPS         === "number" ? TRAIN_STEPS         : 300;
var EVAL_EPISODES = typeof TRAIN_EVAL_EPISODES === "number" ? TRAIN_EVAL_EPISODES : 4;
var GAMMA = 0.97;

// DUEL_1V1's roster ids (scenarios.js: rosterLine assigns idOffset+i+1) —
// Alpha (red/team0) = 1, India (blue/team1) = 2. Stable across rebuilds
// since the roster array itself never changes.
var HERO_ID = 1, OPP_ID = 2;

var OUT_DIR = (process.env.BRO_APP_DIR || ".") + "/checkpoints/";
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

var exitNet = getExitNet();
var net = exitNet.net();
var handle = exitNet.handle();
var buf = bro.ai.game.learn.createReplayBuffer(8192);

var trainer = bro.ai.game.learn.createExItTrainer();
trainer.setNet(net);
trainer.setBuffer(buf);
trainer.setWeightsHandle(handle);
trainer.setConfig({ lr: 0.005, momentum: 0.9, batch: 32, publishEvery: 250, rngSeed: 0x1234n });

// Runs one duel episode to completion (or the sim-time cap) and returns its
// outcome. When `capture` is true, exit_net records a Situation per hero
// decision and this backfills+pushes them into `buf` with the discounted
// final return, same as nn_exit.cpp's run_one(). `episodeSeed` reseeds
// exit_net's MCTS per episode — without this every self-play episode in
// DUEL_1V1 (fixed spawns, deterministic scripted opponent) replays nearly
// identically, starving the replay buffer of diverse situations.
function runEpisode(capture, episodeSeed) {
    setScenario("duel_1v1");
    var state = getState();
    state.redAi = "exit_net";
    state.blueAi = "scripted";
    exitNet.setSeed(episodeSeed >>> 0);
    exitNet.setCapturing(!!capture);

    var t0 = state.elapsed;
    for (;;) {
        advanceTime(100);
        var s = getState();
        var hero = s.byId[HERO_ID], opp = s.byId[OPP_ID];
        if (!hero.unit.alive || !opp.unit.alive) break;
        if ((s.elapsed - t0) >= MAX_SECONDS) break;
    }
    exitNet.setCapturing(false);

    var s2 = getState();
    var hero = s2.byId[HERO_ID], opp = s2.byId[OPP_ID];
    var heroAlive = hero.unit.alive, oppAlive = opp.unit.alive;
    var hh = heroAlive ? hero.unit.hp / hero.unit.maxHp : 0;
    var eh = oppAlive ? opp.unit.hp / opp.unit.maxHp : 0;
    var outcome = (heroAlive && !oppAlive) ? 1 : ((!heroAlive && oppAlive) ? -1 : 0);
    var finalReturn = hh - eh;
    if (!heroAlive) finalReturn = -1; else if (!oppAlive) finalReturn = 1;

    var situations = capture ? exitNet.takeCaptured() : [];
    var g = finalReturn;
    for (var i = situations.length - 1; i >= 0; i--) {
        situations[i].valueTarget = g;
        g *= GAMMA;
        buf.push(situations[i]);
    }
    return { outcome: outcome, hpDelta: hh - eh, situations: situations.length };
}

console.log("iter\tphase\tmetric\tvalue");
for (var it = 0; it < ITERS; it++) {
    // === Generate ===
    exitNet.setUseNet(it > 0);   // iteration 0: classical MCTS (untrained net = noise)
    console.log(it + "\tgen\tstart_buf\t" + buf.size);
    var t0 = Date.now();
    var wins = 0, losses = 0, totalSit = 0, hpdSum = 0;
    for (var ep = 0; ep < EPISODES; ep++) {
        var r = runEpisode(true, 0xEEE5CAFE + it * 1000 + ep);
        if (r.outcome > 0) wins++; else if (r.outcome < 0) losses++;
        totalSit += r.situations;
        hpdSum += r.hpDelta;
    }
    console.log(it + "\tgen\twins\t" + wins);
    console.log(it + "\tgen\tlosses\t" + losses);
    console.log(it + "\tgen\tsituations\t" + totalSit);
    console.log(it + "\tgen\tmean_hp_delta\t" + (hpdSum / EPISODES).toFixed(4));
    console.log(it + "\tgen\tms\t" + (Date.now() - t0));

    if (buf.size === 0) { console.log(it + "\tskip\tempty_buffer\t1"); continue; }

    // === Train ===
    var t1 = Date.now();
    var last = null;
    for (var s = 0; s < TRAIN_STEPS_N; s++) last = trainer.step();
    console.log(it + "\ttrain\tloss_v\t" + last.lossValue.toFixed(4));
    console.log(it + "\ttrain\tloss_p\t" + last.lossPolicy.toFixed(4));
    console.log(it + "\ttrain\tms\t" + (Date.now() - t1));
    handle.publish(net.save(), BigInt((it + 1) * TRAIN_STEPS_N));

    // === Eval vs the scripted baseline (always uses the trained net) ===
    exitNet.setUseNet(true);
    var t2 = Date.now();
    var ew = 0, el = 0, ehpd = 0;
    for (var e2 = 0; e2 < EVAL_EPISODES; e2++) {
        var r2 = runEpisode(false, 0xEEEE + it * 100 + e2);
        if (r2.outcome > 0) ew++; else if (r2.outcome < 0) el++;
        ehpd += r2.hpDelta;
    }
    console.log(it + "\teval\twins\t" + ew);
    console.log(it + "\teval\tlosses\t" + el);
    console.log(it + "\teval\tmean_hp_delta\t" + (ehpd / EVAL_EPISODES).toFixed(4));
    console.log(it + "\teval\twin_rate\t" + (EVAL_EPISODES > 0 ? (ew / EVAL_EPISODES).toFixed(3) : "0"));
    console.log(it + "\teval\tms\t" + (Date.now() - t2));

    var path = OUT_DIR + "exit_iter_" + it + ".bgnn";
    fs.writeFileSync(path, net.save());
    console.log(it + "\tsave\tpath\t" + path);
}
console.log("TRAINING DONE");
