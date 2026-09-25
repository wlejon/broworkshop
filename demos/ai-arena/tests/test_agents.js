// AI Arena — every registered agent, two ways: a short headless match
// (sim/match.js, the evaluators' path) and a moment in the live scene
// (AgentBindings via attachAIWorld), each on the scenario it was built for.
//
//   scripts/validate.sh demos/ai-arena
import { check, test, done, simUntil, frames, q } from "/lib/kit/test.js";
import { lab } from "/app/lab.js";
import { Agents, ExitNet } from "/app/agents/index.js";
import { runHeadlessMatch, pickScenario, verdict, teamAlive } from "/app/sim/match.js";

const ids = Agents.all().map((d) => d.id);
check(ids[0] === 'scripted', 'scripted is the first (fallback) agent');
// exit_net registers only when bro.ai.game.nn is in the build.
check(ids.length === (ExitNet.available() ? 11 : 10), 'registered agents: ' + ids.join(', '));

// Red acted: moved a unit off its spawn, or hurt a blue one. (The search
// agents hold until an enemy is inside their rollout horizon, so "moved"
// alone is not a fair bar for them.)
const acted = (state) => state.agents.some((a, i) => {
    const r = state.scenario.roster[i];
    return a.unit.teamId === 0 ? Math.hypot(a.x - r.x, a.z - r.z) > 1 : a.unit.hp < a.unit.maxHp;
});

for (const id of ids) {
    test('headless: ' + id + ' plays red vs scripted', () => {
        const scn = pickScenario(id, 'scripted', 0);
        const r = runHeadlessMatch(scn, { redAi: id, blueAi: 'scripted', seed: 7, seconds: 8 });
        check(acted(r.state), id + ' acted on ' + scn.id);
        check([0, 1, -1].includes(r.winner), 'verdict');
        const def = Agents.get(id);
        if (def.stats) def.stats(r.state, 0);   // must not throw after a match
    });
}

test('headless scripted mirror fights to a result', () => {
    const r = runHeadlessMatch(pickScenario('scripted', 'scripted', 2), { seed: 3, seconds: 45 });
    check(r.state.agents.some((a) => a.unit.hp < a.unit.maxHp), 'damage dealt');
    check(verdict(r.state) === r.winner, 'verdict stable');
    check(teamAlive(r.state, 0) + teamAlive(r.state, 1) < r.state.agents.length || r.state.elapsed >= 44.9, 'kills or full time');
});

for (const id of ids) {
    test('live: ' + id + ' drives the red capsules', () => {
        const scn = pickScenario(id, 'scripted', 0);
        lab.setScenario(scn, { redAi: id, blueAi: 'scripted' });
        const start = lab.state;
        // 20 s: the search agents plan against a wall-clock budgetMs, so on
        // a loaded machine they get fewer iterations and commit later.
        check(simUntil(() => acted(start), 20000), id + ' acted in the scene');
        check(!q('#status').classList.contains('err'), 'no error surfaced: ' + q('#status').textContent);
    });
}

lab.setScenario('default_8v8', { redAi: 'scripted', blueAi: 'scripted' });
frames(2);
done('ai-arena agents');
