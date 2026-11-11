// Every species in creatures/ auto-discovers, loads, and walks with zero metric
// flags; standing/winged species bind every limb in its own skin with no stretch
// in walk or gallop; and leopard, iguana and ursa step cleanly in a GPU Flock.
//   scripts/validate.sh tools/creature-lab/tests/test_roster.js

import { check, eq, test, done } from "/lib/kit/test.js";
import { loadCreature, appPath } from "/app/lab/creature.js";
import { runScenario } from "/app/lab/run.js";
import { analyzeRun } from "/app/lab/commands.js";
import { boundFlags, skinInMotion, skinFlags } from "/app/lab/skinsee.js";
import { Flock } from "/app/lab/flock.js";
import { groundEnv } from "/app/lab/scenarios.js";
import { TELE, T, GAIT } from "/app/lab/contract.js";

globalThis.creatureLab?.dispose?.();
const fs = require('fs');

const EXPECTED = [
    'bunny', 'courser', 'deer', 'faun', 'finch', 'hexa', 'human',
    'iguana', 'leopard', 'puff', 'strider', 'ursa', 'wader',
];

const entries = fs.readdirSync(appPath('creatures'))
    .filter((f) => f.endsWith('.js') && !f.includes('@'))
    .map((f) => f.slice(0, -3))
    .sort();

test('creatures/ auto-discovers all 13 species', () => {
    eq(entries, EXPECTED, 'the 13 roster species');
});

const loaded = {};
for (const name of EXPECTED) loaded[name] = await loadCreature(name);

await test('every species builds its mesh, shaders and walks with zero metric flags', () => {
    for (const name of EXPECTED) {
        const c = loaded[name];
        check(c.body.positions.length > 300, `${name}: mesh built`);
        check(c.coat.includes('module creature::coat'), `${name}: coat module`);
        check(c.face.includes('module creature::face'), `${name}: face module`);
        const rec = runScenario(c, 'walk');
        eq(analyzeRun(rec).flags, [], `${name} walk: metrics`);
    }
});

await test('human, finch, leopard, iguana and ursa have clean limb binding and skin in motion', () => {
    for (const name of ['human', 'finch', 'leopard', 'iguana', 'ursa']) {
        const c = loaded[name];
        eq(boundFlags(c), [], `${name}: bound at rest`);
        for (const sc of ['walk', 'gallop']) {
            const rec = runScenario(c, sc);
            eq(analyzeRun(rec).flags, [], `${name} ${sc}: metrics`);
            eq(skinFlags(skinInMotion(rec)), [], `${name} ${sc}: skin in motion`);
        }
    }
});

await test('leopard, iguana and ursa step cleanly in a GPU flock', () => {
    const dt = 1 / 120;
    for (const name of ['leopard', 'iguana', 'ursa']) {
        const c = loaded[name];
        const f = new Flock(c, 36, { behaviour: 'travel' });
        f.setGround(groundEnv({}));
        for (let i = 0; i < 360; i++) f.step(dt);
        const tele = f.readTele();
        let finite = 0, moving = 0, off = 0;
        const minSpeed = 0.45 * c.def.speeds.walk;
        for (let i = 0; i < f.count; i++) {
            const o = i * TELE;
            const x = tele[o + T.POS], y = tele[o + T.POS + 1], z = tele[o + T.POS + 2];
            const sp = tele[o + T.SPEED], g = tele[o + T.GAIT];
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(sp)) finite++;
            if (Math.hypot(x, z) > f.radius + 3) off++;
            if (g >= GAIT.WALK && sp >= minSpeed) moving++;
        }
        eq(finite, f.count, `${name}: finite telemetry`);
        eq(off, 0, `${name}: stays on the field`);
        check(moving >= Math.floor(0.6 * f.count), `${name}: ${moving}/${f.count} moving at pace`);
        f.destroy();
    }
});

done('roster');
