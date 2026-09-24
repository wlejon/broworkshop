// The five steer.* kernels live on the pad, and computeLeadAim's turret
// proving itself by missing without it.
//
//   scripts/validate.sh demos/nav-lab
import { check, test, done, text, setValue } from "/lib/kit/test.js";
import { steerState, simulateShot, agentSpeed, distanceToTarget, agentOf, ARRIVE_SLOWING, HIT_RADIUS } from "/app/steering.js";
import { reach, reveal } from "./reach.js";

advanceTime(100);
const S = bro.ai.game.steer;
const mag = (f) => Math.hypot(f.fx, f.fz);

test('the kernels as pure functions', () => {
    check(Math.abs(mag(S.seek(0, 0, 10, 0)) - 1) < 1e-3, 'seek is unit length');
    const far = S.arrive(0, 0, 10, 0, 3.0), near = S.arrive(8.5, 0, 10, 0, 3.0), nearer = S.arrive(9.5, 0, 10, 0, 3.0);
    check(Math.abs(mag(far) - 1) < 1e-3, 'arrive at full magnitude outside the radius');
    check(mag(nearer) < mag(near) && mag(near) < 1.0, `shrinks: ${mag(near).toFixed(3)}, ${mag(nearer).toFixed(3)}`);
});

test('live on the pad: arrive slows, seek does not, flee and evade leave', () => {
    check(steerState.agents.every((a) => !a.node.visible), 'hidden until switched on');
    reveal('#steerOn');
    setValue('#steerOn', true);
    check(steerState.enabled && steerState.agents.every((a) => a.node.visible), 'switched on from the panel');
    advanceTime(3000);
    let arrive = 0, seek = 0, inside = 0;
    for (let i = 0; i < 50; i++) {
        advanceTime(100);
        if (distanceToTarget('arrive') < ARRIVE_SLOWING) inside++;
        arrive += agentSpeed('arrive'); seek += agentSpeed('seek');
    }
    arrive /= 50; seek /= 50;
    console.log(`      mean speed arrive ${arrive.toFixed(2)}, seek ${seek.toFixed(2)} m/s; ${inside}/50 inside the slowing radius`);
    check(inside > 40, 'arrive settled inside its slowing radius');
    check(arrive < seek * 0.8, `${arrive.toFixed(2)} vs ${seek.toFixed(2)}`);
    check(Math.abs(seek - agentOf('seek').speed) < 0.02, 'seek at full speed throughout');
    check(distanceToTarget('flee') > 3.0 && distanceToTarget('evade') > 3.0, 'flee/evade moved away');
    check(/m\/s/.test(text('#stSeekV')), 'HUD speed readout');
});

test('computeLeadAim hits a crossing target that straight aim misses', () => {
    const direct = simulateShot(1.0, false), lead = simulateShot(1.0, true);
    check(lead.valid, 'lead solution valid');
    check(direct.closest > HIT_RADIUS * 2, 'straight aim misses by ' + direct.closest.toFixed(2));
    check(lead.closest <= HIT_RADIUS && lead.closest * 5 < direct.closest, 'lead within ' + lead.closest.toFixed(3));
    check(Math.abs(lead.yaw - direct.yaw) > 0.05, 'the yaw differs');
    // Constant-velocity flights hit; flights spanning a reversal honestly miss.
    const REVERSAL = 2.4, FLIGHT = 0.65;
    const spans = (t) => Math.floor(t / REVERSAL) !== Math.floor((t + FLIGHT) / REVERSAL);
    let wins = 0, clean = 0, dirty = 0, dirtyMiss = 0;
    for (const t of [0.4, 0.8, 1.2, 1.6, 2.0, 2.8, 3.2, 3.6, 4.0, 4.4]) {
        const a = simulateShot(t, false), b = simulateShot(t, true);
        if (spans(t)) { dirty++; if (b.closest > HIT_RADIUS) dirtyMiss++; }
        else { clean++; if (b.closest < a.closest && b.closest <= HIT_RADIUS) wins++; }
    }
    check(wins === clean, `${wins}/${clean} constant-velocity launches hit`);
    check(dirty > 0 && dirtyMiss === dirty, `${dirtyMiss}/${dirty} reversal launches miss`);
});

test('the live turret scores with lead on and misses with it off', () => {
    advanceTime(6000);
    check(steerState.fired > 5 && steerState.hits > steerState.misses, `lead: ${steerState.hits} hits / ${steerState.misses} misses`);
    reveal('#leadOn');
    setValue('#leadOn', false);
    check(!steerState.leadOn && steerState.fired === 0, 'toggle resets the tally');
    advanceTime(6000);
    check(steerState.fired > 5 && steerState.misses > steerState.hits, `no lead: ${steerState.hits} hits / ${steerState.misses} misses`);
    reach('#btnMeasureAim');
    check(/computeLeadAim comes within/.test(text('#aimHint')), text('#aimHint'));
});

done('nav-lab steering');
