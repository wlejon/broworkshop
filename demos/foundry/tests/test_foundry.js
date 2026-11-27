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

test('clicks in the view pick and open what is under them', () => {
    const f = window.foundry;
    f.open('drivePod');
    frames(4);
    const c = f.contract('drivePod');
    const rect = q('#stage3d').getBoundingClientRect();
    // A pixel where the child shows: scan its projected box for one the view's pick names it at.
    const at = (cid) => {
        const s = c.shapes.filter((x) => x.child === cid);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const b of s) for (let k = 0; k < 8; k++) {
            const p = f.vp.toScreen([k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]]);
            x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
        for (let j = 1; j < 16; j++) for (let i = 1; i < 16; i++) {
            const x = x0 + (x1 - x0) * (i / 16), y = y0 + (y1 - y0) * (j / 16);
            if (f.view.pick(x, y) === cid) return { x: rect.left + x, y: rect.top + y };
        }
        throw new Error(`no pixel shows ${cid}`);
    };
    for (const cid of ['mtr', 'clu']) {
        const p = at(cid);
        click(p.x, p.y, 0);
        frames(2);
        check(f.selected === cid, `a click on ${cid} selects it (got ${f.selected})`);
    }
    check(q('#inspTitle').textContent.startsWith('clu'), 'the inspector follows the click');
    const p = at('red');
    click(p.x, p.y, 0);
    frames(1);
    click(p.x, p.y, 0);
    frames(3);
    check(f.current === 'reducer9', `a double click on the reducer opens it (at ${f.current})`);
});

test('gears turn at their ratios', () => {
    const f = window.foundry;
    f.open('reducer9');
    frames(30);
    const mv = f.view.movers.filter((m) => m.kind === 'part');
    const ang = (cid, port) => Math.abs(mv.find((m) => m.path[0] === cid && m.port === port).angle);
    const a1 = ang('s1', 'in'), a2 = ang('s1', 'out'), a3 = ang('s2', 'in'), a4 = ang('s2', 'out');
    check(a1 > 0.5, `the input turns (${a1.toFixed(2)} rad)`);
    check(Math.abs(a1 / a2 - 3) < 0.01, `first stage 3:1 (${(a1 / a2).toFixed(3)})`);
    check(Math.abs(a2 - a3) < 1e-6, 'the coupled shafts turn together');
    check(Math.abs(a3 / a4 - 3) < 0.01, `second stage 3:1 (${(a3 / a4).toFixed(3)})`);
    // In mesh, a pinion and its gear turn opposite ways.
    const s = (cid, port) => Math.sign(mv.find((m) => m.path[0] === cid && m.port === port).angle);
    check(s('s1', 'in') === -s('s1', 'out'), 'meshing gears counter-rotate');
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
