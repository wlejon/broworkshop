// tools/fast_eval.js — win rates at pure JS speed: matches step the world
// directly (sim/match.js stepHeadless), never touching the scene, so a
// 30-match eval takes seconds instead of 30 real-time minutes.
//
//   EVAL_BLUE=tactical EVAL_MATCHES=30 \
//     bro-headless demos/ai-arena demos/ai-arena/tools/fast_eval.js
//
// Environment:
//   EVAL_MATCHES    number of matches        (default 10)
//   EVAL_SECONDS    match time cap           (default 45)
//   EVAL_RED        red agent id             (default scripted)
//   EVAL_BLUE       blue agent id            (default scripted)
//   EVAL_SEED_BASE  world seed of match 0    (default 1)
import { runHeadlessMatch, pickScenario, teamAlive, teamHp } from "/app/sim/match.js";
import { evalConfig, report } from "/app/tools/eval_common.js";

const cfg = evalConfig({ matches: 10 });
const seedBase = +(process.env.EVAL_SEED_BASE || 1);

console.log("==== fast eval: red=" + cfg.red + " vs blue=" + cfg.blue + " ====");
console.log("matches=" + cfg.matches + " matchSeconds=" + cfg.seconds);

const results = [];
for (let m = 0; m < cfg.matches; m++) {
    const scenario = pickScenario(cfg.red, cfg.blue, m);
    const r = runHeadlessMatch(scenario, {
        redAi: cfg.red, blueAi: cfg.blue, seed: seedBase + m, seconds: cfg.seconds,
    });
    results.push({
        scenario: scenario.name, winner: r.winner, wallMs: r.wallMs, elapsed: r.state.elapsed,
        redAlive: teamAlive(r.state, 0), blueAlive: teamAlive(r.state, 1),
        redHp: teamHp(r.state, 0), blueHp: teamHp(r.state, 1),
    });
    report.match(m, cfg.matches, results[m]);
}
report.summary(cfg, results);
