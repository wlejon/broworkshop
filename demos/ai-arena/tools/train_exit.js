// tools/train_exit.js — headless ExIt (expert iteration) training for the
// "exit_net" agent (agents/exit_net.js), mirroring brogameagent's reference
// trainer (brogameagent/tools/nn_exit.cpp) iteration shape:
//
//   iteration k:
//     - EPISODES self-play duels (exit_net vs scripted on duel_1v1),
//       capturing a Situation per hero decision; iteration 0 searches with
//       classical MCTS (an untrained net's priors/values are noise), later
//       iterations with the net being trained
//     - backfill each episode's situations with its discounted final return
//       into a ReplayBuffer
//     - TRAIN_STEPS minibatch SGD steps (ExItTrainer)
//     - evaluate against scripted over EVAL_EPISODES duels
//     - checkpoint net.save() to <app>/checkpoints/exit_iter_<k>.bgnn
//       (File > Open Checkpoint loads one into the live app)
//
// Episodes run through the same match machinery and registered agents as
// the live arena, stepped headlessly (sim/match.js) instead of by the scene.
//
//   bro-headless demos/ai-arena demos/ai-arena/tools/train_exit.js
//
// Environment: TRAIN_ITERS (3), TRAIN_EPISODES (6), TRAIN_MAX_SECONDS (20),
// TRAIN_STEPS (300), TRAIN_EVAL_EPISODES (4), TRAIN_OUT (checkpoint
// directory, default <app>/checkpoints).
import { newMatch, stepHeadless, SIM_DT } from "/app/sim/match.js";
import { Scenarios } from "/app/sim/scenarios.js";
import { ExitNet } from "/app/agents/index.js";

const fs = require("fs");
const env = process.env;
const ITERS = +(env.TRAIN_ITERS || 3);
const EPISODES = +(env.TRAIN_EPISODES || 6);
const MAX_SECONDS = +(env.TRAIN_MAX_SECONDS || 20);
const TRAIN_STEPS = +(env.TRAIN_STEPS || 300);
const EVAL_EPISODES = +(env.TRAIN_EVAL_EPISODES || 4);
const GAMMA = 0.97;

const DUEL = Scenarios.byId("duel_1v1");
const HERO_ID = DUEL.roster[0].id, OPP_ID = DUEL.roster[1].id;   // red Alpha, blue India

const outDir = env.TRAIN_OUT || bro.resolvePath("checkpoints");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const net = ExitNet.net();
const handle = ExitNet.handle();
const buf = bro.ai.game.learn.createReplayBuffer(8192);
const trainer = bro.ai.game.learn.createExItTrainer();
trainer.setNet(net);
trainer.setBuffer(buf);
trainer.setWeightsHandle(handle);
trainer.setConfig({ lr: 0.005, momentum: 0.9, batch: 32, publishEvery: 250, rngSeed: 0x1234n });

// One duel to the end or the time cap. With `capture`, every hero decision
// becomes a Situation, backfilled with the discounted final return and
// pushed into `buf` (nn_exit.cpp's run_one). `seed` reseeds exit_net's
// MCTS per episode: with fixed spawns and a deterministic opponent, every
// episode would otherwise replay nearly identically.
function runEpisode(capture, seed) {
    // newMatch resets every agent, so set the seed/capture after it.
    const state = newMatch(DUEL, { redAi: "exit_net", blueAi: "scripted", seed });
    ExitNet.setSeed(seed >>> 0);
    ExitNet.setCapturing(capture);
    stepHeadless(state, Math.ceil(MAX_SECONDS / SIM_DT));
    ExitNet.setCapturing(false);

    const hero = state.byId[HERO_ID].unit, opp = state.byId[OPP_ID].unit;
    const hh = hero.alive ? hero.hp / hero.maxHp : 0;
    const eh = opp.alive ? opp.hp / opp.maxHp : 0;
    const outcome = hero.alive && !opp.alive ? 1 : !hero.alive && opp.alive ? -1 : 0;
    const finalReturn = !hero.alive ? -1 : !opp.alive ? 1 : hh - eh;

    const situations = capture ? ExitNet.takeCaptured() : [];
    let g = finalReturn;
    for (let i = situations.length - 1; i >= 0; i--) {
        situations[i].valueTarget = g;
        g *= GAMMA;
        buf.push(situations[i]);
    }
    return { outcome, hpDelta: hh - eh, situations: situations.length };
}

function episodes(n, capture, seedOf) {
    let wins = 0, losses = 0, sit = 0, hpd = 0;
    for (let e = 0; e < n; e++) {
        const r = runEpisode(capture, seedOf(e));
        if (r.outcome > 0) wins++; else if (r.outcome < 0) losses++;
        sit += r.situations;
        hpd += r.hpDelta;
    }
    return { wins, losses, sit, meanHpDelta: n ? hpd / n : 0 };
}

const row = (it, phase, metric, value) => console.log(it + "\t" + phase + "\t" + metric + "\t" + value);

console.log("iter\tphase\tmetric\tvalue");
for (let it = 0; it < ITERS; it++) {
    ExitNet.setUseNet(it > 0);
    row(it, "gen", "start_buf", buf.size);
    let t = Date.now();
    const gen = episodes(EPISODES, true, (e) => 0xEEE5CAFE + it * 1000 + e);
    row(it, "gen", "wins", gen.wins);
    row(it, "gen", "losses", gen.losses);
    row(it, "gen", "situations", gen.sit);
    row(it, "gen", "mean_hp_delta", gen.meanHpDelta.toFixed(4));
    row(it, "gen", "ms", Date.now() - t);
    if (buf.size === 0) { row(it, "skip", "empty_buffer", 1); continue; }

    t = Date.now();
    let last = null;
    for (let s = 0; s < TRAIN_STEPS; s++) last = trainer.step();
    row(it, "train", "loss_v", last.lossValue.toFixed(4));
    row(it, "train", "loss_p", last.lossPolicy.toFixed(4));
    row(it, "train", "ms", Date.now() - t);
    handle.publish(net.save(), BigInt((it + 1) * TRAIN_STEPS));

    ExitNet.setUseNet(true);
    t = Date.now();
    const ev = episodes(EVAL_EPISODES, false, (e) => 0xEEEE + it * 100 + e);
    row(it, "eval", "wins", ev.wins);
    row(it, "eval", "losses", ev.losses);
    row(it, "eval", "mean_hp_delta", ev.meanHpDelta.toFixed(4));
    row(it, "eval", "win_rate", EVAL_EPISODES ? (ev.wins / EVAL_EPISODES).toFixed(3) : "0");
    row(it, "eval", "ms", Date.now() - t);

    const path = outDir + "/exit_iter_" + it + ".bgnn";
    fs.writeFileSync(path, net.save());
    row(it, "save", "path", path);
}
console.log("TRAINING DONE");
