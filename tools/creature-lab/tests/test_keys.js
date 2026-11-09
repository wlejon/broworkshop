// Keys: a species drawn pose by pose (lab/posing.js, creature::keyed), and
// the strider, which is. The keys are what was drawn, mirrored and cycled;
// a rig standing them on the ground walks, jogs and runs with its feet
// where they landed and its mass in free fall when none is down.
//   scripts/validate.sh tools/creature-lab/tests/test_keys.js

import { check, eq, test, done } from "/lib/kit/test.js";
import { loadCreature } from "/app/lab/creature.js";
import { runScenario } from "/app/lab/run.js";
import { analyzeRun, runCommand } from "/app/lab/commands.js";
import { keyPoses, balanceOf } from "/app/lab/posing.js";
import { boneHead, boneTail } from "/app/lab/skeleton.js";
import { massPhysics } from "/app/lab/natural.js";
import { T, TELE, GAIT } from "/app/lab/contract.js";

globalThis.creatureLab?.dispose?.();
const fs = require('fs');

const OUT = 'tests/out/creature-lab-test';
const strider = await loadCreature('strider');
const skel = strider.skel, K = strider.keys;
const bone = (n) => skel.bones[skel.index(n)];
const near = (a, b, tol, what) => check(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol, `${what}: ${a.map((v) => v.toFixed(3))} against ${b.map((v) => v.toFixed(3))}`);

test('a pose puts the feet where it draws them', () => {
    const [P] = keyPoses(strider, [[-1, K.index['walk-contact']]]);
    const rest = bone('toeL').head, restR = bone('toeR').head;
    near(boneHead(P, 0, skel.index('toeL')), [rest[0] - 0.02, rest[1], rest[2] + 0.23], 2e-3, 'the left ball');
    near(boneHead(P, 0, skel.index('toeR')), [restR[0] + 0.02, restR[1], restR[2] - 0.205], 2e-3, 'the right ball');
    // The legs reach them from where the pose has the hips.
    const hip = boneHead(P, 0, skel.index('thighL')), root = boneHead(P, 0, skel.index('pelvis'));
    check(Math.abs(root[1] - (bone('pelvis').head[1] - 0.026)) < 1e-3, `the root where it is drawn (${root[1].toFixed(3)})`);
    check(Math.hypot(hip[0] - root[0], hip[1] - root[1], hip[2] - root[2]) < 0.1, 'the hip on the pelvis');
});

test('a mirrored pose is the pose with its sides exchanged', () => {
    const [A, B] = keyPoses(strider, [[-1, K.index['walk-up']], [-1, K.index['walk-up~']]]);
    for (const [l, r] of [['toeL', 'toeR'], ['handL', 'handR'], ['ear2L', 'ear2R'], ['tail5', 'tail5'], ['head', 'head']]) {
        const a = boneTail(A, 0, bone(l)), b = boneTail(B, 0, bone(r));
        near([-a[0], a[1], a[2]], b, 2e-3, `${l} mirrored onto ${r}`);
    }
});

test('a cycle passes through its keys, its second half the first mirrored', () => {
    const c = K.cycles.findIndex((x) => x.name === 'walk');
    const [atKey, key, half, mir] = keyPoses(strider, [[c, 0.25], [-1, K.index['walk-pass']], [c, 0.75], [-1, K.index['walk-pass~']]]);
    for (const n of ['toeL', 'toeR', 'head', 'handL', 'tail5']) {
        near(boneTail(atKey, 0, bone(n)), boneTail(key, 0, bone(n)), 2e-3, `${n} at the key's phase`);
        near(boneTail(half, 0, bone(n)), boneTail(mir, 0, bone(n)), 2e-3, `${n} half a cycle on`);
    }
    eq(K.cycles[c].keys.length, 8, 'four keys drawn, eight in the cycle');
    // No foot goes under the ground between keys that have it down.
    const ph = Array.from({ length: 40 }, (_, i) => [c, i / 40]);
    const low = Math.min(...keyPoses(strider, ph).map((P) => Math.min(boneHead(P, 0, skel.index('toeL'))[1], boneHead(P, 0, skel.index('toeR'))[1])));
    check(low > bone('toeL').head[1] - 1e-3, `the lowest ball through the walk is on the ground (${low.toFixed(4)})`);
});

test('standing it is balanced over its feet', () => {
    const [P] = keyPoses(strider, [[-1, K.index.stand]]);
    const b = balanceOf(skel, P);
    eq(b.down, 2, 'both feet down');
    check(b.fore === 0 && b.side === 0, `its centre of mass over them (${b.text})`);
    const [F] = keyPoses(strider, [[-1, K.index['run-flight']]]);
    eq(balanceOf(skel, F).down, 0, 'the run\'s flight has neither down');
});

const recs = {};
const run = (sc) => (recs[sc] ||= runScenario(strider, sc));

test('the strider goes clean: stood, walking, jogging, running, turning, on slopes', () => {
    for (const sc of ['stand', 'walk', 'trot', 'gallop', 'start-stop', 'turn-in-place', 'slope-up', 'slope-down', 'rough-walk', 'graze', 'lie-down', 'startle']) {
        eq(analyzeRun(run(sc)).flags, [], `${sc} flags`);
    }
});

test('its feet stay where they landed', () => {
    for (const sc of ['walk', 'gallop']) {
        const r = analyzeRun(run(sc));
        for (const f of ['L', 'R']) {
            check(r.feet[f].stances > 6,`${sc}: ${f} stood ${r.feet[f].stances} stances`);
            check(r.feet[f].slipMax < 0.015,`${sc}: ${f} slid ${r.feet[f].slipMax} m at most`);
        }
    }
});

test('it walks at a walk and runs at a gallop, in free fall between a run\'s steps', () => {
    const gait = (rec) => rec.tele[(rec.steps - 5) * TELE + T.GAIT];
    eq(gait(run('walk')), GAIT.WALK, 'the walk reports a walk');
    eq(gait(run('gallop')), GAIT.RUN, 'the gallop reports a run');
    const w = massPhysics(run('walk')), g = massPhysics(run('gallop'));
    eq(w.flightSteps, 0, 'a walk is never off the ground');
    check(g.flightSteps > 100, `the run is off the ground ${g.flightSteps} steps`);
    check(g.flightOff < 0.15, `off free fall in ${g.flightOff} of its flight`);
});

await test('the model sheet draws its poses and cycles', async () => {
    const out = await runCommand(['model', 'strider', 'stand', 'walk-contact', 'forage', '--cycles', 'run', '--out', OUT]);
    eq(out.written.length, 1, 'one sheet');
    check(/strider\/model\.png$/.test(out.written[0]) && fs.existsSync(out.written[0]), `model.png written (${out.written[0]})`);
});

done('creature-lab keys');
