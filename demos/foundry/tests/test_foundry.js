// demos/foundry/tests/test_foundry.js — the compiler ladder and the UI.
import { test, check, frames, shot, done, clickOn, q } from "/lib/kit/test.js";
import { starterLibrary } from "/lib/foundry/designs.js";
import { compileLibrary } from "/lib/foundry/compile.js";
import { PARTS, partDefaults } from "/lib/foundry/parts.js";

const RPM = (2 * Math.PI) / 60;

test('the starter ladder compiles, places cleanly and meets its goals', () => {
    const lib = starterLibrary();
    const cache = compileLibrary(lib);
    for (const id of Object.keys(lib)) {
        const c = cache.get(id);
        check(c.ok, `${id} builds: ${c.errors.join('; ')}`);
        check(c.clashes.length === 0, `${id} has no clashes: ${JSON.stringify(c.clashes)}`);
        check(c.links.every((l) => !l.misaligned), `${id} links line up`);
        check(c.goal && c.goal.pass, `${id} meets its goal: ${c.goal && c.goal.checks.filter((k) => !k.pass).map((k) => k.id).join(',')}`);
    }
    const red = cache.get('reducer9');
    const path = red.paths.find((p) => p.to === 'out');
    check(Math.abs(path.k - 9) < 1e-9, 'reducer ratio is 9');
    const pod = cache.get('drivePod');
    const src = pod.sources.find((s) => s.port === 'out');
    check(src.peak <= 150 + 1e-6, 'the clutch caps the pod at its slip torque');
    check(src.guarded, 'the clutch guards a stage');
    check(Math.abs(src.noLoad - 3600 * RPM / 9) < 1e-6, 'pod free speed is the motor over the reducer');
    // A parent sees the child only by its contract: the pod's box holds the reducer's.
    const redInPod = pod.children.find((c) => c.id === 'red');
    check(redInPod.el === red, 'the pod uses the compiled reducer');
});

test('the UI shows every design and edits undo', () => {
    frames(4);
    const f = window.foundry;
    for (const id of Object.keys(f.lib)) {
        f.open(id);
        frames(6);
        shot(id);
        check(q('#goalPill').textContent.length > 0, `${id} has a goal pill`);
    }
    f.open('reducer9');
    frames(2);
    f.select('s2');
    frames(2);
    check(q('#inspector [data-param="teethOut"]'), 'inspector shows the gear params');
    const before = f.contract('reducer9').paths[0].k;
    f.lib.reducer9.children[1].params.teethOut = 45;
    const inp = q('#inspector input[type=number]');
    check(!!inp, 'a number field');
    f.addPart('shearPin');
    frames(2);
    check(f.lib.reducer9.children.length === 3, 'part added');
    check(f.contract('reducer9').ports.some((p) => p.at && p.at.startsWith('shea')), 'the new part carries the output');
    f.history.undo();
    frames(2);
    check(f.lib.reducer9.children.length === 2, 'undo removes it');
    check(f.contract('reducer9').paths[0].k === before, 'ratio unchanged');
    f.open('jointActuator');
    frames(2);
    f.drillInto('pod');
    frames(2);
    check(f.current === 'drivePod', 'drilled into the pod');
    clickOn('#crumbs button');
    frames(2);
    check(f.current === 'jointActuator', 'breadcrumb back up');
    shot('ui');
});

test('every part draws on its own', () => {
    const f = window.foundry;
    for (const type of Object.keys(PARTS)) {
        const id = `solo_${type}`;
        f.lib[id] = { id, name: PARTS[type].label, level: 1, paint: [0.86, 0.42, 0.12], note: PARTS[type].note, children: [{ id: 'p', part: type, params: partDefaults(type) }], links: [], ports: [] };
        compileLibrary(f.lib, f.cache);
        f.open(id);
        frames(4);
        check(f.contract(id).ok, `${type} builds`);
        shot(`part-${type}`);
        delete f.lib[id];
        f.cache.delete(id);
    }
});

done('foundry');
