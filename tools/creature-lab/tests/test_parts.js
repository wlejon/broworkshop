// The skin and the parts, seen (lab/skinsee.js, lab/parts.js): a limb drawn
// inside another's skin is found at rest, skin pulled by the bones is found
// in motion, and each part is told from its carrier: glued on, riding it,
// wobbling on it or held steady. The strider is clean by all of them.
//   scripts/validate.sh tools/creature-lab/tests/test_parts.js

import { check, eq, test, done } from "/lib/kit/test.js";
import { loadCreature } from "/app/lab/creature.js";
import { runScenario } from "/app/lab/run.js";
import { runCommand } from "/app/lab/commands.js";
import { resolveSkeleton, ROWS } from "/app/lab/skeleton.js";
import { boundLimbs, boundFlags, skinInMotion, skinFlags } from "/app/lab/skinsee.js";
import { partsOf, partMotion, partFlags } from "/app/lab/parts.js";

globalThis.creatureLab?.dispose?.();
const fs = require('fs');
const OUT = 'tests/out/creature-lab-test';

// A trunk with one two-bone arm out along +X, and a tube of skin about the arm.
const armSkel = resolveSkeleton({
    bones: [
        { name: 'trunk', parent: null, head: [0, 1, 0], tail: [0, 1.3, 0] },
        { name: 'upper', parent: 'trunk', head: [0, 1, 0], tail: [0.5, 1, 0] },
        { name: 'lower', parent: 'upper', head: [0.5, 1, 0], tail: [1, 1, 0] },
    ],
    feet: [], tracks: [],
});
function tube(weightOf) {
    const rings = 15, seg = 12, positions = [], indices = [], weights = [];
    for (let r = 0; r < rings; r++) {
        const x = -0.2 + 1.4 * r / (rings - 1);
        for (let k = 0; k < seg; k++) {
            const a = 2 * Math.PI * k / seg;
            positions.push(x, 1 + 0.1 * Math.cos(a), 0.1 * Math.sin(a));
            weights.push([{ index: weightOf(x), w: 1 }]);
        }
    }
    for (let r = 0; r + 1 < rings; r++) for (let k = 0; k < seg; k++) {
        const a = r * seg + k, b = r * seg + (k + 1) % seg, c = a + seg, d = b + seg;
        indices.push(a, b, c, b, d, c);
    }
    return { skel: armSkel, body: { positions: new Float32Array(positions), indices: new Uint32Array(indices), weights } };
}

test('a limb with a skin of its own is bound; one inside another\'s is found', () => {
    const own = tube((x) => (x < 0.05 ? 0 : x < 0.5 ? 1 : 2));
    eq(boundFlags(own), [], 'an arm in its own skin');
    const [L] = boundLimbs(own);
    eq(L.bones, ['upper', 'lower'], 'the limb is the chain out to the leaf');
    check(L.cuts.length >= 5 && L.cuts.every((c) => !c.none), `every cut finds a loop (${L.cuts.length})`);
    // The same tube weighted to the trunk for most of its length: an arm
    // laid in the body it was meshed with.
    const fused = tube((x) => (x < 0.7 ? 0 : 2));
    const flags = boundFlags(fused);
    eq(flags.length, 1, 'the fused arm is flagged');
    check(/upper is in trunk's skin/.test(flags[0]), flags[0]);
    check(boundLimbs(fused)[0].emerges > 0.5, 'and where it comes out of the body is past its middle');
});

// A chest carrying a head carrying two ears; poses from turns about Z.
const headSkel = resolveSkeleton({
    bones: [
        { name: 'pelvis', parent: null, head: [0, 0.6, 0], tail: [0, 0.8, 0] },
        { name: 'chest', parent: 'pelvis', head: [0, 0.8, 0], tail: [0, 1, 0] },
        { name: 'tail', parent: 'pelvis', head: [0, 0.6, 0], tail: [0, 0.6, -0.4] },
        { name: 'arm', parent: 'chest', head: [0.1, 0.95, 0], tail: [0.1, 0.6, 0] },
        { name: 'head', parent: 'chest', head: [0, 1, 0], tail: [0, 1.2, 0] },
        { name: 'earL', parent: 'head', head: [0.05, 1.2, 0], tail: [0.08, 1.4, 0] },
        { name: 'earR', parent: 'head', head: [-0.05, 1.2, 0], tail: [-0.08, 1.4, 0] },
    ],
    feet: [], tracks: [],
});
// The pose with each named bone turned (deg about Z) on its parent.
function posed(turns) {
    const B = headSkel.bones, P = new Float32Array(B.length * ROWS), ang = [], pos = [];
    for (const b of B) {
        const pa = b.parentIndex;
        ang[b.index] = (pa < 0 ? 0 : ang[pa]) + (turns[b.name] || 0) * Math.PI / 180;
        if (pa < 0) pos[b.index] = b.head.slice();
        else {
            const c = Math.cos(ang[pa]), s = Math.sin(ang[pa]), d = [b.head[0] - B[pa].head[0], b.head[1] - B[pa].head[1], b.head[2] - B[pa].head[2]];
            pos[b.index] = [pos[pa][0] + c * d[0] - s * d[1], pos[pa][1] + s * d[0] + c * d[1], pos[pa][2] + d[2]];
        }
        const c = Math.cos(ang[b.index]), s = Math.sin(ang[b.index]), k = b.index * ROWS;
        P.set([c, -s, 0, pos[b.index][0], s, c, 0, pos[b.index][1], 0, 0, 1, pos[b.index][2]], k);
    }
    return P;
}
const stride = (f) => Array.from({ length: 24 }, (_, i) => posed(f(Math.sin(2 * Math.PI * i / 24))));
const verdicts = (poses) => {
    const parts = partsOf(headSkel), motions = parts.map((p) => partMotion(headSkel, p, poses));
    return { parts, motions, by: Object.fromEntries(parts.map((p, i) => [p.name, motions[i].verdict])), flags: partFlags(headSkel, parts, motions) };
};

test('a part is told from what carries it', () => {
    eq(partsOf(headSkel).map((p) => p.name).sort(), ['arm', 'chest', 'earL', 'head', 'tail'], 'the parts: each limb (one of a pair) and each bone that branches');
    // The chest swings; the head and ears are fixed on it.
    const glued = verdicts(stride((s) => ({ chest: 12 * s })));
    eq(glued.by.head, 'glued', 'a head fixed on the chest');
    eq(glued.by.earL, 'glued', 'an ear fixed on the head');
    check(glued.flags.some((f) => /head is glued to chest/.test(f)), glued.flags.join(' | '));
    // The head swings further the same way: a head on a spring.
    eq(verdicts(stride((s) => ({ chest: 12 * s, head: 10 * s }))).by.head, 'wobbles', 'a head swinging further than the chest');
    // The hips swing, the chest and the head each turn back against what
    // carries them, the ears nod on the head and the arm and tail swing.
    const steady = verdicts(stride((s) => ({ pelvis: 14 * s, chest: -8 * s, head: -5 * s, earL: 8 * s, earR: -8 * s, arm: 20 * s, tail: 10 * s })));
    eq(steady.by.head, 'steadied', 'a head turned back against the chest');
    eq(steady.by.chest, 'steadied', 'a chest turned back against the hips');
    eq(steady.by.earL, '', 'an ear moving on the head has nothing against it');
    eq(steady.flags, [], 'and nothing is flagged');
});

const strider = await loadCreature('strider');

test('the strider\'s limbs are its own and its skin is not pulled', () => {
    eq(boundFlags(strider), [], 'bound at rest');
    for (const sc of ['walk', 'trot']) eq(skinFlags(skinInMotion(runScenario(strider, sc))), [], `${sc}: the skin in motion`);
});

test('the strider\'s parts sheet: the head steadied, nothing glued or riding', async () => {
    for (const sc of ['walk', 'idle']) {
        const out = await runCommand(['parts', 'strider', sc, '--out', OUT]);
        const png = out.written.find((p) => p.endsWith('.png'));
        check(png && fs.statSync(png).size > 20000, `${sc}: the sheet is drawn (${png})`);
        const j = JSON.parse(fs.readFileSync(out.written.find((p) => p.endsWith('.json')), 'utf8'));
        eq(j.flags, [], `${sc}: flags`);
        if (sc === 'walk') eq(j.parts.find((p) => p.name === 'head').verdict, 'steadied', 'walking, its head is held steady over the chest');
    }
});

await done('creature-lab parts');
