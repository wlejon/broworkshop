// Instanced Crowd: every pattern, colour scheme and mesh reaches the one
// instanced node; count, pause, the mouse field and the HUD work through real
// input. Run: scripts/validate.sh demos/instanced-crowd

import { check, eq, near, test, done, frames, setValue, text, clickOn, press, shot } from "/lib/kit/test.js";
import { scene, canvas, cam, crowd, config, field, fieldAt } from "/app/crowd.js";
import { PATTERNS, COLOR_SCHEMES } from "/app/patterns.js";
import { MESHES } from "/app/instances.js";

frames(30);

/** Sum of |position| over the crowd: moves whenever the crowd moves. */
const spread = () => { let s = 0; const P = crowd.particles; for (let i = 0; i < P.count; i++) s += Math.abs(P.px[i]) + Math.abs(P.py[i]); return s; };

test('boots with 10k agents on one instanced node', () => {
    eq(crowd.count, 10000);
    eq(crowd.node.instanceCount, 10000);
    eq(text('#instances'), '10,000');
    frames(20);
    const c = scene.cullStats();
    check(c.instancedDrawn === 1, `one instanced draw (${c.instancedDrawn})`);
    check(/^1 inst/.test(text('#draws')), `draws readout (${text('#draws')})`);
});

test('the count buttons resize the crowd', () => {
    for (const [label, n] of [['1k', 1000], ['25k', 25000], ['10k', 10000]]) {
        const b = [...document.querySelectorAll('#counts button')].find((x) => x.textContent === label);
        clickOn(b);
        frames(2);
        eq(crowd.node.instanceCount, n, label);
        check(b.classList.contains('active'), `${label} button active`);
    }
});

test('every pattern moves the crowd and keeps positions finite', () => {
    for (const p of Object.keys(PATTERNS)) {
        setValue('#params select', p);           // the first select is the pattern
        eq(config.pattern, p);
        const a = spread();
        frames(10);
        const b = spread();
        check(Number.isFinite(b) && Math.abs(a - b) > 1e-3, `${p} moves (${a.toFixed(0)} -> ${b.toFixed(0)})`);
    }
    setValue('#params select', 'swarming');
});

test('the instance buffer carries colours for every scheme', () => {
    const selects = document.querySelectorAll('#params select');
    for (const s of Object.keys(COLOR_SCHEMES)) {
        setValue(selects[1], s);
        frames(2);
        const b = crowd.buffer;
        check(b[12] >= 0 && b[12] <= 1 && b[15] === 1, `${s}: RGBA in range (${b[12].toFixed(2)}, ${b[15]})`);
    }
    setValue(selects[1], 'cyberpunk');
});

test('orienting to velocity puts +Z along the velocity', () => {
    frames(4);
    const P = crowd.particles, b = crowd.buffer;
    const v = [P.vx[7], P.vy[7], P.vz[7]], L = Math.hypot(...v);
    const z = [b[7 * 16 + 2], b[7 * 16 + 6], b[7 * 16 + 10]];   // third column
    near(z[0] / config.scale, v[0] / L, 1e-3, 'fx');
    near(z[1] / config.scale, v[1] / L, 1e-3, 'fy');
    near(z[2] / config.scale, v[2] / L, 1e-3, 'fz');
});

test('each mesh rebuilds the node at the same count', () => {
    const sel = document.querySelectorAll('#params select')[2];
    for (const m of Object.keys(MESHES)) {
        setValue(sel, m);
        frames(1);
        eq(crowd.meshType, m);
        eq(crowd.node.instanceCount, crowd.count, m);
    }
    setValue(sel, 'arrow');
});

test('Space pauses and resumes the simulation', () => {
    clickOn('#stage');                     // focus the page, not a control
    frames(1);
    press(' ');
    check(config.paused && /paused/.test(text('#status')), 'paused');
    const a = spread();
    frames(10);
    eq(spread(), a, 'nothing moves while paused');
    press(' ');
    check(!config.paused, 'resumed');
});

test('left-drag holds the field; releasing drops it', () => {
    const r = canvas.getBoundingClientRect();
    const x = r.left + r.width * 0.6, y = r.top + r.height * 0.6;
    mouseMove(x, y);
    mouseDown(x, y, 0);
    frames(2);
    check(field.point && field.point.every(Number.isFinite), 'field point set under the cursor');
    near(field.point[1], cam.pivot[1], 1e-3, 'on the pivot plane');
    const want = fieldAt(x - r.left, y - r.top);
    near(field.point[0], want[0], 1e-3, 'x from the pick ray');
    mouseUp(x, y, 0);
    frames(1);
    check(field.point === null, 'released');
});

test('attract gathers agents at the field; repel clears them', () => {
    setValue('#params select', 'swarming');
    const P = crowd.particles, keys = ['px', 'py', 'pz', 'vx', 'vy', 'vz'];
    const saved = keys.map((k) => P[k].slice());
    const near5 = () => { let n = 0; for (let i = 0; i < P.count; i++) if (Math.hypot(P.px[i] - 5, P.py[i], P.pz[i]) < 5) n++; return n; };
    const run = (mode) => {
        keys.forEach((k, j) => P[k].set(saved[j]));
        const selects = document.querySelectorAll('#params select');
        setValue(selects[3], mode);
        field.point = [5, 0, 0];
        frames(90);
        field.point = null;
        return near5();
    };
    const attract = run('attract'), repel = run('repel');
    setValue(document.querySelectorAll('#params select')[3], 'attract');
    check(attract > repel * 2, `agents within 5 of the field: attract ${attract} vs repel ${repel}`);
});

test('sliders format and drive config', () => {
    const ranges = document.querySelectorAll('#params input[type=range]');
    setValue(ranges[0], 2.5);
    eq(config.speed, 2.5);
    check(/2\.50x/.test(ranges[0].parentNode.textContent), 'speed readout');
    setValue(ranges[0], 1);
});

frames(20);
shot('crowd');
done('instanced-crowd');
