// ORCA, scored: the funnel with avoidance off vs on, priority, layers/mask,
// and the elevation filter that keeps stacked crowds apart.
//
//   scripts/validate.sh demos/nav-lab
import { check, test, done, text, q } from "/lib/kit/test.js";
import { CHOKE } from "/app/level.js";
import { agentState } from "/app/agents.js";
import { crowdState, setAvoidance, overlapMean, scenarioFunnel, scenarioVip, scenarioFactions, scenarioStacked,
    deviationOf, findRole, snapshot, setAvoidHeight } from "/app/crowd.js";
import { reach } from "./reach.js";

advanceTime(100);
const RUN_MS = 9000;

test('avoidance cuts the funnel pile-up without deadlocking it', () => {
    const run = (avoid) => {
        scenarioFunnel(30);
        setAvoidance(avoid);
        advanceTime(RUN_MS);
        return { mean: overlapMean(), peak: crowdState.overlapPeak };
    };
    const off = run(false), on = run(true);
    console.log(`      avoidance OFF mean ${off.mean.toFixed(2)} peak ${off.peak}; ON mean ${on.mean.toFixed(2)} peak ${on.peak}`);
    check(crowdState.agents.length === 30, crowdState.agents.length + ' agents');
    check(agentState.world.avoidanceEnabled === true, 'world.avoidanceEnabled');
    check(off.mean > 1.0, 'interpenetrate with avoidance off: ' + off.mean.toFixed(2));
    check(on.mean < off.mean * 0.6, `${off.mean.toFixed(2)} -> ${on.mean.toFixed(2)}`);
    check(on.peak < off.peak, `peak ${off.peak} -> ${on.peak}`);
    check(crowdState.agents.some((r) => r.agent.x > CHOKE.x) && crowdState.agents.some((r) => r.agent.x < CHOKE.x), 'crowd on both sides');
});

test('a high-priority VIP holds its line', () => {
    scenarioVip(18);
    setAvoidance(true);
    advanceTime(RUN_MS);
    const vip = findRole('vip'), ctl = findRole('control');
    check(vip && ctl, 'both subjects exist');
    check(vip.devN > 100 && ctl.devN > 100, `${vip.devN} / ${ctl.devN} samples`);
    check(deviationOf(vip) < deviationOf(ctl), `VIP ${deviationOf(vip).toFixed(3)} vs control ${deviationOf(ctl).toFixed(3)}`);
});

test('factions walk through each other but avoid their own kind', () => {
    scenarioFactions(24);
    setAvoidance(true);
    advanceTime(RUN_MS);
    const cross = crowdState.crossFactionAccum, same = crowdState.sameFactionAccum;
    check(cross > 0 && cross > same * 2, `cross ${cross} vs same ${same}`);
});

// The strong form: the ground lane alone vs with a crowd overhead must give
// IDENTICAL trajectories (advanceTime playback is deterministic), and
// defeating the filter with a 12 m avoidance height must break that.
test('the elevation filter separates stacked crowds exactly', () => {
    const run = (levels, h) => {
        scenarioStacked(24, levels);
        setAvoidance(true);
        setAvoidHeight(h);
        advanceTime(5000);
        return snapshot('ground');
    };
    const alone = run([0], 2.0), withMezz = run([0, 4], 2.0), merged = run([0, 4], 12.0);
    check(alone.length >= 2 && withMezz.length === alone.length, alone.length + ' ground agents');
    let dPos = 0, dVel = 0, dMerged = 0;
    for (let i = 0; i < alone.length; i++) {
        dPos = Math.max(dPos, Math.hypot(alone[i].x - withMezz[i].x, alone[i].z - withMezz[i].z));
        dVel = Math.max(dVel, Math.hypot(alone[i].vx - withMezz[i].vx, alone[i].vz - withMezz[i].vz));
        dMerged = Math.max(dMerged, Math.hypot(alone[i].x - merged[i].x, alone[i].z - merged[i].z));
    }
    check(dPos === 0 && dVel === 0, `position delta ${dPos}, velocity delta ${dVel}`);
    check(dMerged > 0.1, 'a 12 m height makes the levels interact: ' + dMerged.toFixed(3));
});

test('the crowd panel runs scenarios and reports', () => {
    reach('#btnFunnel');
    check(crowdState.scenario !== 'none' && crowdState.agents.length === crowdState.count, crowdState.agents.length + ' agents');
    advanceTime(1000);
    check(text('#stScenario') === crowdState.scenario, text('#stScenario'));
    check(+text('#stCrowd') === crowdState.agents.length, 'crowd readout');
    check(q('#crowdHint').textContent.length > 20, 'scenario explained');
    reach('#btnClearCrowd');
    check(crowdState.agents.length === 0 && text('#stCrowd') === '0', 'cleared');
});

done('nav-lab crowd');
