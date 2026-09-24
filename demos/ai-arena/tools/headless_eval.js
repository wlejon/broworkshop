// tools/headless_eval.js — win rates through the live app: each match runs
// in the real scene (attachAIWorld + AgentBindings), paced by advanceTime.
// Slower than fast_eval.js (the scene steps at most 8 ticks a frame) but it
// exercises exactly what a person watching the arena sees.
//
//   EVAL_BLUE=options_mcts bro-headless demos/ai-arena demos/ai-arena/tools/headless_eval.js
//
// Environment: EVAL_MATCHES (default 6), EVAL_SECONDS (45), EVAL_RED,
// EVAL_BLUE (scripted).
import { lab } from "/app/lab.js";
import { pickScenario, decided, verdict, teamAlive, teamHp } from "/app/sim/match.js";
import { evalConfig, report } from "/app/tools/eval_common.js";

const cfg = evalConfig({ matches: 6 });
const TICK_MS = 500;

console.log("==== headless eval: red=" + cfg.red + " vs blue=" + cfg.blue + " ====");
console.log("matches=" + cfg.matches + " matchSeconds=" + cfg.seconds);

const results = [];
for (let m = 0; m < cfg.matches; m++) {
    const scenario = pickScenario(cfg.red, cfg.blue, m);
    lab.setScenario(scenario, { redAi: cfg.red, blueAi: cfg.blue });
    const t0 = Date.now();
    for (let k = 0; k < Math.ceil(cfg.seconds * 1000 / TICK_MS); k++) {
        advanceTime(TICK_MS);
        if (decided(lab.state) !== null) break;
    }
    const s = lab.state;
    results.push({
        scenario: scenario.name, winner: verdict(s), wallMs: Date.now() - t0, elapsed: s.elapsed,
        redAlive: teamAlive(s, 0), blueAlive: teamAlive(s, 1), redHp: teamHp(s, 0), blueHp: teamHp(s, 1),
    });
    report.match(m, cfg.matches, results[m]);
}
report.summary(cfg, results);
