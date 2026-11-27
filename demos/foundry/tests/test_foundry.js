// demos/foundry/tests/test_foundry.js — the compiler ladder and the UI.
import { test, check, frames, shot, done, clickOn, q, press } from "/lib/kit/test.js";
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
    // Statics: the segment's joint is held by the actuator, and a second segment on its tip
    // loads the shoulder with the whole elbow, stretched out.
    const seg = cache.get('armSegment'), arm = cache.get('twoLinkArm');
    const J = seg.joints[0];
    check(Math.abs(J.cont - cache.get('jointActuator').sources[0].cont) < 1e-6, 'the boom holds what the actuator gives');
    const segTip = seg.mounts[0], armTip = arm.mounts[0];
    check(Math.abs(segTip.payloadKg - (J.cont - J.hold) / (9.81 * (segTip.reach - J.s))) < 1e-6, 'payload is spare torque over the lever');
    check(Math.abs(armTip.reach - 2 * segTip.reach) < 1e-6, 'two segments stretched reach twice as far');
    const [sh, el] = arm.joints.slice().sort((a, b) => a.s - b.s);
    check(sh.hold > el.hold * 5, `the shoulder carries the elbow (${sh.hold.toFixed(0)} against ${el.hold.toFixed(0)} N·m)`);
    check(armTip.weakest === sh.label, 'the shoulder runs out first');
    // The actuator's worm is under its friction angle: it holds the joint with the power off,
    // to what its wheel carries, more than the motor can lift through it.
    const wormPath = cache.get('jointActuator').sources[0];
    check(wormPath.lock > wormPath.cont, `the worm locks (${wormPath.lock && wormPath.lock.toFixed(0)} against ${wormPath.cont.toFixed(0)} N·m driven)`);
    check(segTip.holdKg > segTip.payloadKg, 'so the segment holds more unpowered than it lifts');
    const lib2 = starterLibrary();
    lib2.jointActuator.children[1].params.quotient = 8;
    const free = compileLibrary(lib2).get('armSegment').mounts[0];
    check(free.holdKg === 0, 'a steep worm does not lock, and the arm holds nothing unpowered');
    check(arm.warnings.length === 0 && seg.warnings.length === 0, `arms have no warnings: ${arm.warnings.concat(seg.warnings).join('; ')}`);
});

test('the UI shows every design and edits undo', () => {
    frames(4);
    const f = window.foundry;
    f.reset();
    frames(2);
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

test('a hundred arm segments in a chain', () => {
    const f = window.foundry;
    const N = 100;
    const d = { id: 'chain100', name: 'Hundred Segments', level: 6, paint: [0.9, 0.7, 0.15], note: '', children: [], links: [], ports: [] };
    for (let i = 0; i < N; i++) {
        d.children.push({ id: `s${i}`, design: 'armSegment' });
        if (i) d.links.push({ a: `s${i - 1}.tip`, b: `s${i}.base`, spin: 3 });
    }
    d.ports.push({ id: 'base', label: 'Base', at: 's0.base' }, { id: 'tip', label: 'Tip', at: `s${N - 1}.tip` });
    f.lib.chain100 = d;
    let t = perf.now();
    compileLibrary(f.lib, f.cache);
    const compileMs = perf.now() - t;
    const c = f.cache.get('chain100'), seg = f.cache.get('armSegment');
    check(c.ok && c.partCount === N * seg.partCount, `it compiles (${c.errors.slice(0, 2).join('; ')})`);
    check(c.joints.length === N, 'every segment brings its joint');
    check(Math.abs(c.mounts[0].reach - N * seg.mounts[0].reach) < 1e-6 * N, 'stretched, it reaches a hundred segments');
    check(c.mounts[0].payloadKg === 0 && c.warnings.some((w) => w.includes('cannot hold up')), 'and its shoulder cannot hold the rest up');
    t = perf.now();
    f.open('chain100');
    frames(2);
    console.log(`chain100: compile ${compileMs.toFixed(0)} ms, open + 2 frames ${(perf.now() - t).toFixed(0)} ms`);
    shot('chain100');
    delete f.lib.chain100;
    f.cache.delete('chain100');
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

test('a machine built from nothing by clicks, aimed at a goal, and built on', () => {
    const f = window.foundry;
    f.reset();
    frames(2);
    const rowOf = (name) => {
        const r = [...document.querySelectorAll('#library .f-design')].find((x) => x.querySelector('.name').textContent === name);
        r.scrollIntoView({ block: 'nearest' });
        flush();
        return r;
    };
    const ports = () => f.lib[f.current].ports.map((p) => p.at);
    // A pod: motor, the reducer, a clutch, a battery. Each lands wired.
    clickOn('#newDesign'); frames(2);
    clickOn('#title .nm'); frames(1);
    q('#title input.nm').value = '';
    textInput('Test Pod'); press('Enter'); frames(1);
    check(f.lib[f.current].name === 'Test Pod', 'the title renames the design');
    clickOn('#palette button[data-part="motor"]'); frames(1);
    check(ports().includes('moto1.out') && ports().includes('moto1.pwr'), `a lone motor exposes its shaft and its power (${ports()})`);
    clickOn(rowOf('Reducer 9:1').querySelector('.use')); frames(1);
    check(f.contract(f.current).level === 2, 'using a level-1 design makes this level 2');
    clickOn('#palette button[data-part="clutch"]'); frames(1);
    clickOn('#palette button[data-part="battery"]'); frames(1);
    const pod = f.contract(f.current);
    check(pod.ok && !pod.warnings.length, `the pod builds clean: ${pod.errors.concat(pod.warnings).join('; ')}`);
    check(pod.ports.length === 1 && pod.sources.length === 1 && pod.sources[0].supply, 'the battery feeds the motor, and only the output is left exposed');
    const saved = JSON.parse(require('fs').readFileSync(f.store, 'utf8')).designs;
    check(Object.values(saved).some((d) => d.name === 'Test Pod' && d.children.length === 4), 'every edit is saved to the library file');
    // A goal from what it does, then asked for more than it has.
    clickOn('#setGoal'); frames(1);
    check(f.contract(f.current).goal.pass, 'a drafted goal is met');
    const eff = q('#goal input[data-goal="effort"]');
    eff.value = '400'; eff.dispatchEvent(new Event('change', { bubbles: true })); frames(1);
    check(!f.contract(f.current).goal.pass && /not met/.test(q('#goalPill').textContent), 'asking 400 N·m of it misses');
    f.history.undo(); frames(1);
    check(f.contract(f.current).goal.pass, 'undo puts the goal back');
    // A level up: the pod and a worm. The default worm strips under the pod; a problem points at it.
    const podName = 'Test Pod';
    clickOn('#newDesign'); frames(1);
    clickOn(rowOf(podName).querySelector('.use')); frames(1);
    clickOn('#palette button[data-part="worm"]'); frames(1);
    const prob = document.querySelector('#problems .f-prob.pick');
    check(prob && prob.dataset.child === 'worm1', 'the worm warning names the worm');
    clickOn(prob); frames(1);
    check(f.selected === 'worm1' && /worm1/.test(q('#inspTitle').textContent), 'clicking the problem selects the worm');
    clickOn('#flow .f-stage-chip.src'); frames(1);
    check(f.selected === 'tes1' && q('#flow .f-stage-chip.sel'), `a flow stage selects its child (${f.selected})`);
    // An arm on it: a boom on the wheel, the tip exposed, a lift goal.
    const actId = f.current;
    clickOn('#newDesign'); frames(1);
    clickOn(rowOf(f.lib[actId].name).querySelector('.use')); frames(1);
    clickOn('#palette button[data-part="boom"]'); frames(2);
    const arm = f.contract(f.current);
    check(arm.mounts.length === 1 && arm.mounts[0].payloadKg > 0, 'a boom on the actuator lifts at its tip');
    clickOn('#setGoal'); frames(1);
    check(f.contract(f.current).goal.lift, 'the goal drafted for an arm is a lift');
    check(!arm.ports.some((p) => p.domain === 'elec'), 'its battery rides along: no power line');
    // Three of the starter segment (powered from outside), tip to base: each gets its own power line.
    clickOn('#newDesign'); frames(1);
    for (let k = 0; k < 3; k++) { clickOn(rowOf('Arm Segment').querySelector('.use')); frames(1); }
    const chain = f.contract(f.current);
    check(chain.level === 5, `three arms make level 5 (${chain.level})`);
    check(chain.ports.filter((p) => p.domain === 'elec').length === 3, `every segment has its own power line (${chain.ports.map((p) => p.id)})`);
    check(chain.joints.length === 3 && chain.joints.every((J) => J.cont > 0), 'every joint is driven');
    check(document.querySelectorAll('#flow [data-child]').length === 3, 'the flow shows the three joints');
    shot('built-chain');
    // Seven more from the inspector: one edit, and the ten run on in a line.
    f.select('arm3'); frames(1);
    q('#chainCount').value = '7';
    clickOn('#chainMore'); frames(2);
    const ten = f.contract(f.current), sz = ten.size.slice().sort((a, b) => b - a);
    check(f.lib[f.current].children.length === 10 && ten.ports.filter((p) => p.domain === 'elec').length === 10, 'chain more adds seven, each powered');
    check(sz[0] > 12 && sz[1] < 1, `ten segments run straight (${ten.size.map((v) => v.toFixed(2))})`);
    f.history.undo(); frames(1);
    check(f.lib[f.current].children.length === 3, 'one undo takes the seven back');
    // Removing the middle segment closes the chain up.
    f.select('arm2'); frames(1);
    clickOn('#removeChild'); frames(1);
    const two = f.lib[f.current];
    check(two.links.some((l) => l.a === 'arm1.tip' && l.b === 'arm3.base'), `the chain closes up (${two.links.map((l) => l.a + '>' + l.b)})`);
    // Unpowered, a segment's joint turns nothing.
    two.ports = two.ports.filter((p) => p.at !== 'arm3.pwr');
    f.cache.clear();
    const dark = f.contract(f.current);
    check(dark.joints.some((J) => J.cont === 0), 'a segment with no power drives nothing');
    // A variant: copy the pod, then swap the copy into the actuator in place of the original.
    f.reset(); frames(1);
    clickOn(rowOf('Drive Pod')); frames(1);
    clickOn('#copyDesign'); frames(1);
    const podCopy = f.current;
    clickOn(rowOf('Joint Actuator')); frames(1);
    f.select('pod'); frames(1);
    const sw = q('#swapFor');
    check([...sw.options].some((o) => o.value === podCopy), 'the copy is offered in the pod\'s place');
    sw.value = podCopy; sw.dispatchEvent(new Event('change', { bubbles: true })); frames(1);
    const ja = f.lib.jointActuator;
    check(ja.children.find((x) => x.id === 'pod').design === podCopy && ja.links.some((l) => l.a === 'pod.out' && l.b === 'wrm.in'), 'swapped, and still driving the worm');
    check(f.contract('jointActuator').ok, 'the actuator builds on the copy');
    // A crane: a worm set to slew from behind its wheel turns a boom round level, an arm segment on its tip.
    f.reset(); frames(1);
    clickOn('#newDesign'); frames(1);
    f.useDesign('drivePod'); f.addPart('worm'); frames(1);
    f.select(f.lib[f.current].children.find((x) => x.part === 'worm').id); frames(1);
    const mt = q('#inspector [data-param="mount"]');
    mt.value = 'back'; mt.dispatchEvent(new Event('change', { bubbles: true })); frames(1);
    f.addPart('boom'); f.useDesign('armSegment'); frames(1);
    const crane = f.contract(f.current), slew = crane.joints.find((J) => J.upright);
    check(slew && slew.carry > slew.hold && slew.hold > slew.cont, `the turntable's drive carries no weight, though it could not hold the arm level (${slew && slew.hold.toFixed(0)} N·m): its boom does`);
    check(crane.ok && !crane.warnings.length && crane.mounts[0].payloadKg > 100, `the crane lifts ${crane.mounts[0].payloadKg.toFixed(0)} kg, the arm segment's own`);
    check(f.contract('jointActuator').joints.every((J) => !J.upright), 'a joint on a base that does not face its axis still carries its weight');
    // A slewing ring takes a drive on every pinion, and their torques add.
    const ringWith = (pods, pinions = pods) => {
        f.reset(); frames(1);
        clickOn('#newDesign'); frames(1);
        f.addPart('slewRing'); f.select('slew1'); frames(1);
        const pn = q('#inspector [data-param="pinions"]').parentNode.querySelector('input[type=number]');
        pn.value = String(pinions); pn.dispatchEvent(new Event('change', { bubbles: true })); frames(1);
        for (let i = 0; i < pods; i++) f.useDesign('drivePod');
        f.addPart('boom'); frames(1);
        return f.contract(f.current);
    };
    const r4 = ringWith(4);
    const pinned = f.lib[f.current].links.filter((l) => /^slew1\.in\d$/.test(l.b)).length;
    check(pinned === 4 && r4.ok, `each pod wired to a pinion of its own (${pinned})`);
    check(q('#flow').textContent.includes('turntable'), 'the flow shows the ring as a turntable');
    const rMix = ringWith(1, 4);
    check(rMix.errors.some((e) => /not driven|partly/.test(e)), `pinions without a drive of their own are an error (${rMix.errors.join('; ')})`);
    const r1 = ringWith(1);
    const one = r1.joints[0].cont, four = r4.joints[0].cont;
    check(Math.abs(four / one - 4) < 0.01 || four >= r4.joints[0].bend * 0.999, `four drives turn it four times as hard as one (${one.toFixed(0)} → ${four.toFixed(0)} N·m)`);
    f.reset();
});

done('foundry');
