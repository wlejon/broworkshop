// Agents actually traverse: the lift, the ladder, the jump; blocked agents
// wait at the gate and go through when it opens; a carve mid-walk re-plans.
//
//   scripts/validate.sh demos/nav-carving
import { check, test, done, simUntil, shot } from "/lib/kit/test.js";
import { TARGETS, SPAWN, DOOR, floorOf } from "/app/level.js";
import { agentState, STATE, spawnSquad, clearAgents, sendAll } from "/app/agents.js";
import { lift } from "/app/elevator.js";
import { setDoor } from "/app/lab.js";

advanceTime(100);
const A = () => agentState.agents;
const allIdle = () => A().every((r) => r.state === STATE.IDLE);
const near = (r, t, d = 2.5) => Math.hypot(r.agent.x - t.x, r.agent.z - t.z) < d && floorOf(r.y) === floorOf(t.y);
const arrived = (t, d) => () => allIdle() && A().every((r) => near(r, t, d));

test('the boot squad rides the lift to the mezzanine', () => {
    check(A().length === 5, A().length + ' agents');
    check(simUntil(() => agentState.seen.has(STATE.RIDING), 20000), 'someone boarded');
    check(agentState.seen.has(STATE.WAITING), 'agents waited for the car');
    check(simUntil(arrived(TARGETS.mezz, 3.5), 60000), 'all on the mezzanine: '
        + A().map((r) => `${r.state}@${r.y.toFixed(1)}`).join(' '));
    check(agentState.traversals.lift === 5, agentState.traversals.lift + ' lift rides');
    check(lift.trips >= 2, lift.trips + ' lift stops');
    // The route height carries a rider's capsule: nobody is sunk into a floor.
    check(A().every((r) => Math.abs(r.node.y - (3.5 + 0.76)) < 0.25), 'capsules stand on the deck: ' + A().map((r) => r.node.y.toFixed(2)));
});
shot('mezzanine');

test('mezzanine to roof: everyone climbs the ladder', () => {
    sendAll(TARGETS.roof);
    check(A().every((r) => r.plan.legs.some((l) => l.kind === 'ladder')), 'ladder in every plan');
    check(simUntil(() => agentState.seen.has(STATE.CLIMBING), 15000), 'climbing seen');
    check(simUntil(arrived(TARGETS.roof, 3.5), 60000), 'all on the roof');
    check(agentState.traversals.ladder === 5, agentState.traversals.ladder + ' climbs');
});

test('bridge retracted: the squad jumps the gap to the island', () => {
    setDoor('bridge', false);
    sendAll(TARGETS.island);
    check(A().every((r) => r.plan.legs.some((l) => l.kind === 'jump')), 'jump in every plan');
    let peak = 0;
    check(simUntil(() => {
        for (const r of A()) if (r.state === STATE.JUMPING) peak = Math.max(peak, r.y);
        return arrived(TARGETS.island, 2.0)();
    }, 60000), 'all on the island');
    check(peak > 8.0, 'mid-jump height ' + peak.toFixed(2) + ' m: a parabola, not a slide');
    check(agentState.traversals.jump === 5, agentState.traversals.jump + ' jumps');
    setDoor('bridge', true);
});
shot('island');

test('blocked at the gate, through it when it opens', () => {
    clearAgents();
    spawnSquad(3, SPAWN);
    sendAll(TARGETS.vault);
    check(A().every((r) => r.blocked && r.plan.partial), 'plans are partial');
    check(simUntil(allIdle, 20000), 'walked to the clamp point');
    check(A().every((r) => r.agent.z > DOOR.z), 'waiting south of the gate');
    const repaths = agentState.repaths;
    setDoor('gate', true);
    check(simUntil(arrived(TARGETS.vault, 3.0), 30000), 'all in the vault: '
        + A().map((r) => `${r.state} z${r.agent.z.toFixed(1)}`).join(' '));
    check(agentState.repaths > repaths && A().every((r) => !r.blocked), 're-planned when the gate cleared');
    setDoor('gate', false);
});

test('a carve mid-walk re-plans onto the lift', () => {
    clearAgents();
    setDoor('barricade', false);
    spawnSquad(3, SPAWN);
    sendAll(TARGETS.mezz);
    check(A().every((r) => r.plan.legs.length === 1), 'walking the ramp');
    advanceTime(500);
    const repaths = agentState.repaths;
    setDoor('barricade', true);
    advanceTime(100);
    check(agentState.repaths >= repaths + 3, `${repaths} -> ${agentState.repaths}`);
    check(A().every((r) => r.plan.legs.some((l) => l.kind === 'lift')), 'every plan now uses the lift');
    check(simUntil(arrived(TARGETS.mezz, 3.5), 60000), 'all reached the mezzanine anyway');
});

done('nav-carving agents');
