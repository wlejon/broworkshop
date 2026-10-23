// Formal Dogfooding & Edge-Case Regression Suite (#125)
//
// Verifies the real latent edge-case bugs discovered across broworkshop/lib
// by the Bronze static prover (`bronze check`, `bronze check --deterministic`,
// `bronze prove-equiv`, `bronze synth-tests`) and manual formal audit:
//   1. lib/kit/math3d.js: quatYTo(0, 0, 0), q.axis(0, 0, 0, angle), q.slerp zero-norm
//   2. lib/kit/camera.js: Camera.quatLook degenerate when forward || up or forward == 0
//   3. lib/kit/viewport3d.js: screenRay & worldToScreen when view direction || up or pos == target
//   4. lib/bot-aim.js: angleDelta non-finite / huge angle wrap & negative dt guard
//   5. lib/arcade/grid.js: createFalls(0).offset 0/0 NaN, fitBoard/cellAt 0/0 NaN & negative cell leak,
//      createWave IEEE-754 deterministic distance & tie-breaking
//   6. lib/kit/sway.js: analyse n=0/n=1 Hann window & speedRms 0/0 NaN, levelDrive/treeLevel zeta=0
//   7. lib/kit/motion-sheet.js & lib/kit/params.js: pctl negative percentile clamp, logMap min==max
//
// Run with bro-headless:
//   bro-headless lib-tests lib-tests/test_formal_dogfood.js
// Run with bronze static prover:
//   bronze check --deterministic lib-tests/test_formal_dogfood.js

import { q, quatYTo } from "../lib/kit/math3d.js";
import { Camera } from "../lib/kit/camera.js";
import { screenRay, worldToScreen } from "../lib/kit/viewport3d.js";
import { BotAim } from "../lib/bot-aim.js";
import { createWave, createFalls, fitBoard, cellAt } from "../lib/arcade/grid.js";
import { levelDrive, treeLevel, analyse } from "../lib/kit/sway.js";
import { pctl } from "../lib/kit/motion-sheet.js";
import { logMap } from "../lib/kit/params.js";

let tests = 0;
let failed = 0;

function t(name, fn) {
    tests++;
    try {
        fn();
        console.log('  ok   ' + name);
    } catch (e) {
        failed++;
        console.log('  FAIL ' + name + ': ' + (e && e.message ? e.message : e));
        if (e && e.stack) console.log(e.stack);
    }
}

function near(a, b, eps, msg) {
    const tol = eps !== undefined ? eps : 1e-6;
    if (!Number.isFinite(a) || Math.abs(a - b) > tol) {
        throw new Error((msg || 'near') + ': ' + a + ' vs ' + b + ' (tol=' + tol + ')');
    }
}

function truthy(v, msg) {
    if (!v) throw new Error(msg || 'expected truthy');
}

function quatLen4(arr) {
    return Math.sqrt(arr[0] * arr[0] + arr[1] * arr[1] + arr[2] * arr[2] + arr[3] * arr[3]);
}

function quatObjLen(o) {
    return Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z + o.w * o.w);
}

// 1. lib/kit/math3d.js — quatYTo(0, 0, 0) witness synthesized by `bronze synth-tests`
t('math3d.quatYTo: zero vector returns unit identity quaternion [0,0,0,1]', () => {
    const q0 = quatYTo(0, 0, 0);
    near(quatLen4(q0), 1.0, 1e-9, 'quatYTo(0,0,0) must have unit norm (was 0.70710678)');
    near(q0[0], 0.0, 1e-9, 'q0.x');
    near(q0[1], 0.0, 1e-9, 'q0.y');
    near(q0[2], 0.0, 1e-9, 'q0.z');
    near(q0[3], 1.0, 1e-9, 'q0.w');

    // Non-zero directions remain unit quaternions
    const qx = quatYTo(1, 0, 0);
    near(quatLen4(qx), 1.0, 1e-9, 'quatYTo(1,0,0) unit norm');
    const qny = quatYTo(0, -1, 0);
    near(quatLen4(qny), 1.0, 1e-9, 'quatYTo(0,-1,0) unit norm');
});

t('math3d.q.axis and q.slerp: zero axis and unnormalized axis produce unit quaternions', () => {
    const qZero = q.axis(0, 0, 0, Math.PI);
    near(quatObjLen(qZero), 1.0, 1e-9, 'q.axis(0,0,0,PI) returns identity (was zero quat)');
    near(qZero.w, 1.0, 1e-9, 'q.axis(0,0,0,PI).w == 1');

    const qScaled = q.axis(0, 5, 0, Math.PI / 2);
    near(quatObjLen(qScaled), 1.0, 1e-9, 'q.axis(0,5,0,PI/2) normalizes axis');

    const qSlerpZero = q.slerp({ x: 0, y: 0, z: 0, w: 0 }, { x: 0, y: 0, z: 0, w: 0 }, 0.5);
    near(quatObjLen(qSlerpZero), 1.0, 1e-9, 'q.slerp on zero quats returns identity');
});

// 2. lib/kit/camera.js — Camera.quatLook collinear forward/up & zero forward
t('Camera.quatLook: collinear forward === up and zero forward produce valid rotations', () => {
    // Witness 1: zero forward (e.g. orbitFromView when position == target)
    const q0 = Camera.quatLook([0, 0, 0], [0, 1, 0]);
    near(quatLen4(q0), 1.0, 1e-9, 'quatLook([0,0,0],[0,1,0]) unit norm');

    // Witness 2: forward parallel to up ([0, 1, 0] vs [0, 1, 0])
    const qUp = Camera.quatLook([0, 1, 0], [0, 1, 0]);
    near(quatLen4(qUp), 1.0, 1e-9, 'quatLook([0,1,0],[0,1,0]) unit norm');
    const fwdUp = Camera.quatRotVec(qUp, [0, 0, -1]);
    near(fwdUp[0], 0.0, 1e-6, 'quatLook([0,1,0]) forward.x');
    near(fwdUp[1], 1.0, 1e-6, 'quatLook([0,1,0]) forward.y');
    near(fwdUp[2], 0.0, 1e-6, 'quatLook([0,1,0]) forward.z');

    // Witness 3: diagonal forward parallel to up ([0, s, s] vs [0, s, s])
    const s = Math.SQRT1_2;
    const qDiag = Camera.quatLook([0, s, s], [0, s, s]);
    const fwdDiag = Camera.quatRotVec(qDiag, [0, 0, -1]);
    near(fwdDiag[0], 0.0, 1e-6, 'diagonal collinear forward.x');
    near(fwdDiag[1], s, 1e-6, 'diagonal collinear forward.y (was 0.65328)');
    near(fwdDiag[2], s, 1e-6, 'diagonal collinear forward.z (was 0.75711)');
});

// 3. lib/kit/viewport3d.js — top-down camera (target - position parallel to up)
t('viewport3d.screenRay and worldToScreen: top-down camera parallel to up does not collapse basis', () => {
    const topDownView = {
        position: [0, 10, 0],
        target: [0, 0, 0],
        up: [0, 1, 0],
        fov: 60,
    };
    const rLeft = screenRay(topDownView, 800, 600, 100, 300);
    const rRight = screenRay(topDownView, 800, 600, 700, 300);
    // Previously r and u collapsed to [0,0,0], making rLeft.dir === rRight.dir === [0,-1,0]
    const diff = Math.abs(rLeft.dir[0] - rRight.dir[0]) + Math.abs(rLeft.dir[2] - rRight.dir[2]);
    truthy(diff > 0.2, 'left and right screen rays must diverge in top-down view (got diff=' + diff + ')');

    const proj = worldToScreen([2, 0, 0], topDownView, 800, 600);
    truthy(!proj.behind, 'point below top-down camera is in front');
    truthy(Math.abs(proj.x - 400) > 10 || Math.abs(proj.y - 300) > 10,
        'off-axis world point must not collapse to screen center (400,300)');
});

// 4. lib/bot-aim.js — O(1) angle wrapping, non-finite inputs, negative dt guard
t('BotAim.tick: handles huge angles in O(1), non-finite angles without hanging, and ignores dt <= 0', () => {
    const aim = BotAim.create({ turnSpeed: 5 });
    BotAim.set(aim, 0, 0);
    aim.desiredYaw = 1e9;
    BotAim.tick(aim, 0.016);
    truthy(Number.isFinite(aim.yaw) && Math.abs(aim.yaw) <= Math.PI, 'yaw stays finite and bounded');

    const prevYaw = aim.yaw;
    BotAim.tick(aim, -0.5);
    near(aim.yaw, prevYaw, 1e-12, 'negative dt does not invert rotation step');

    aim.desiredYaw = Infinity;
    BotAim.tick(aim, 0.016);
    truthy(Number.isFinite(aim.yaw), 'Infinity desiredYaw does not hang or poison yaw');
});

// 5. lib/arcade/grid.js — createFalls(0), fitBoard / cellAt, createWave determinism
t('arcade/grid: createFalls(0) avoids 0/0 NaN, fitBoard/cellAt reject degenerate & negative cells', () => {
    const falls = createFalls(0);
    falls.add(2, 0, 0);
    const off = falls.offset(2, 0);
    truthy(Number.isFinite(off), 'createFalls(0).offset must be finite (was NaN)');
    near(off, 0.0, 1e-9, 'zero-duration fall settles immediately to 0');

    // Witness: W == padX (200) -> previously layout.cell = 0 and cellAt returned {r: NaN, c: NaN}
    const layoutZero = fitBoard(200, 200, 8, 8);
    truthy(layoutZero.cell >= 1, 'fitBoard clamps cell >= 1 (was 0)');
    const hitDegenerate = cellAt({ ox: 100, oy: 100, cell: 0, rows: 8, cols: 8 }, 100, 100);
    truthy(hitDegenerate === null, 'cellAt with cell=0 returns null (was {r: NaN, c: NaN})');

    // Witness: W < padX (150 < 200) -> previously layout.cell = -7 and cellAt returned {r: -1, c: -1}
    const layoutSmall = fitBoard(150, 200, 8, 8);
    truthy(layoutSmall.cell >= 1, 'fitBoard with W < padX clamps cell >= 1 (was -7)');
    const hitNegCell = cellAt({ ox: 136, oy: 136, cell: -7, rows: 8, cols: 8 }, 140, 140);
    truthy(hitNegCell === null, 'cellAt with negative cell returns null (was {r: -1, c: -1})');

    // Deterministic wave ordering on equidistant cells
    const wave = createWave([[0, 1], [1, 0], [2, 1], [1, 2]], { stagger: 10 });
    truthy(wave.cells.length === 4, 'wave has 4 cells');
    near(wave.cells[0].r, 0, 0, 'tie-break row 0 first');
    near(wave.cells[1].r, 1, 0, 'tie-break row 1 second');
    near(wave.cells[1].c, 0, 0, 'tie-break col 0 before col 2');
});

// 6. lib/kit/sway.js — single-sample and empty track analysis & zeta=0 damping
t('kit/sway: analyse handles n=0 and n=1 without 0/0 NaN, levelDrive/treeLevel handle zeta=0', () => {
    const a0 = analyse([], 30);
    near(a0.rms, 0, 1e-9, 'analyse([]) rms');
    near(a0.speedRms, 0, 1e-9, 'analyse([]) speedRms');

    const a1 = analyse([[1, 2, 3]], 30, [1, 0, 0], [0.5]);
    truthy(Number.isFinite(a1.speedRms) && Number.isFinite(a1.fastShare),
        'analyse(n=1) speedRms and fastShare are finite (were NaN)');
    truthy(Number.isFinite(a1.flutterHz.aliased) && Number.isFinite(a1.flutterHz.backwards),
        'analyse(n=1) flutterHz ratios are finite (were NaN)');

    const w = { dir: [1, 0, 0], side: [0, 0, 1], t: 1.0 };
    const c = { freq: 1.0, sway: 0.1, len: 2.0 };
    const d1 = levelDrive(c, 0, 0.05, 0, 0, 0, w, 0.5);
    truthy(Number.isFinite(d1[0]) && Number.isFinite(d1[1]) && Number.isFinite(d1[2]),
        'levelDrive with zeta=0 is finite (was NaN)');
    const d2 = treeLevel(c, 0, 0.05, 0, 0, 0, w, 0.5, 0, 0);
    truthy(Number.isFinite(d2[0]) && Number.isFinite(d2[1]) && Number.isFinite(d2[2]),
        'treeLevel with zeta=0 is finite (was NaN)');
});

// 7. lib/kit/motion-sheet.js & lib/kit/params.js — pctl negative p, logMap min==max
t('kit/motion-sheet pctl and kit/params logMap: boundary inputs stay finite', () => {
    const v = pctl([10, 20, 30], -0.5);
    near(v, 10, 1e-9, 'pctl clamps p < 0 to index 0 (was undefined)');
    const vHi = pctl([10, 20, 30], 1.5);
    near(vHi, 30, 1e-9, 'pctl clamps p > 1 to last index');

    const lm = logMap(100, 100);
    near(lm.to(100), 0, 1e-9, 'logMap(100,100).to(100) is 0 (was NaN)');
    near(lm.from(500), 100, 1e-9, 'logMap(100,100).from(500) is 100');
});

console.log('\n' + (tests - failed) + '/' + tests + ' passed');
if (failed > 0) throw new Error(failed + ' test(s) failed');
