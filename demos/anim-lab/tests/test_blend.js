// Blend spaces (1D speed, 2D direction), masked layers, and the mask
// isolation proof: a right-arm wave over a walk leaves the legs bit-identical.

import { check, eq, near, test, done } from "/lib/kit/test.js";
import { player } from "/app/lab.js";
import { state, LAYER_ROWS, selectClip, selectSpace, setSpeedAxis, setDirection,
         setLayerEnabled, setLayerWeight, setLayerMask } from "/app/actions.js";
import { bonePositions, maxDelta, dist, boneAt, weightSum } from "/app/tests/helpers.js";

const SWEEP = [0.0, 0.4, 0.8, 1.2, 1.6, 2.5, 3.4, 4.2, 5.0];
const sweep = [];

test('1D space: takes the base track and partitions weight along the axis', () => {
    selectSpace('locomotion', 0);
    advanceTime(200);
    check((player.blendState().pos || []).length === 1, 'a space reports a 1D pos');
    for (const s of SWEEP) {
        setSpeedAxis(s);
        advanceTime(16);
        const b = player.blendState();
        const w = {};
        for (const c of b.clips) w[c.name] = c.weight;
        sweep.push({ s, w, n: b.clips.length });
        near(weightSum(b), 1, 1e-3, `speed ${s}: weights sum`);
        check(b.clips.length <= 2, `speed ${s}: at most two clips`);
        near(b.pos[0], s, 1e-3, `speed ${s}: parameter reported back`);
    }
});

test('1D space: sample points own the mix; neighbours hand over monotonically', () => {
    const at = (s) => sweep.find((e) => e.s === s).w;
    near(at(0.0).idle || 0, 1, 1e-3, 'idle owns the floor');
    near(at(1.6).walk || 0, 1, 1e-3, 'walk owns its point');
    near(at(5.0).run || 0, 1, 1e-3, 'run owns the ceiling');
    const falls = (a) => a.every((v, i) => i === 0 || v <= a[i - 1] + 1e-4);
    const rises = (a) => a.every((v, i) => i === 0 || v >= a[i - 1] - 1e-4);
    const lo = [0.0, 0.4, 0.8, 1.2, 1.6], hi = [1.6, 2.5, 3.4, 4.2, 5.0];
    check(falls(lo.map((s) => at(s).idle || 0)), 'idle falls');
    check(rises(lo.map((s) => at(s).walk || 0)), 'walk rises');
    check(falls(hi.map((s) => at(s).walk || 0)), 'walk falls past its point');
    check(rises(hi.map((s) => at(s).run || 0)), 'run rises');
    check(sweep.find((e) => e.s === 0.8).n === 2 && sweep.find((e) => e.s === 3.4).n === 2, 'mid-range blends two');
});

test('1D space: clamps at the ends and keeps animating mid-range', () => {
    setSpeedAxis(5.0);
    player.setLocomotion(99);
    advanceTime(16);
    near(player.blendState().pos[0], 5.0, 1e-3, 'clamps at the top');
    setSpeedAxis(3.0);
    advanceTime(50);
    const a = bonePositions();
    advanceTime(150);
    check(maxDelta(a, bonePositions()) > 0.005, 'phase-synced mix keeps moving');
});

test('2D space: each compass point resolves to its own clip outright', () => {
    selectSpace('directional', 0);
    advanceTime(200);
    eq((player.blendState().pos || []).length, 2, '2D parameter');
    for (const [x, y, want] of [[0, 0, 'idle'], [0, 1, 'walk'], [0, -1, 'walkBack'],
                                [-1, 0, 'walkStrafeL'], [1, 0, 'walkStrafeR']]) {
        setDirection(x, y);
        advanceTime(16);
        const b = player.blendState();
        const top = b.clips.slice().sort((a, c) => c.weight - a.weight)[0];
        eq(top.name, want, `(${x}, ${y})`);
        near(top.weight, 1, 1e-3, `(${x}, ${y}) full weight`);
        near(weightSum(b), 1, 1e-3, `(${x}, ${y}) sum`);
    }
});

test('2D space: a diagonal is a genuine three-way mix', () => {
    setDirection(0.7, 0.7);
    advanceTime(16);
    const b = player.blendState();
    eq(b.clips.map((c) => c.name).sort().join(','), 'idle,walk,walkStrafeR');
    near(weightSum(b), 1, 1e-3, 'sum');
    const a = bonePositions();
    advanceTime(150);
    check(maxDelta(a, bonePositions()) > 0.005, 'the diagonal animates');
});

test('layers: three masked layers run over a walking base', () => {
    selectSpace('locomotion', 0);
    setSpeedAxis(1.6);
    advanceTime(200);
    eq(player.activeLayers().length, 0, 'none to start');
    setLayerEnabled(1, true, 0);
    advanceTime(200);
    let bs = player.blendState();
    check(bs.clips.length === 1 && bs.clips[0].name === 'walk', 'base survives: ' + JSON.stringify(bs.clips));
    check(bs.layers.length === 1 && bs.layers[0].name === 'wave' && bs.layers[0].slot === 1, 'layer in blendState');
    check(bs.layers[0].phase >= 0 && bs.layers[0].phase <= 1, 'layer runs its own phase');

    setLayerEnabled(2, true, 0);
    setLayerEnabled(3, true, 0);
    advanceTime(200);
    bs = player.blendState();
    eq(bs.layers.length, 3, 'three at once');
    check(bs.layers.every((l, i) => i === 0 || l.slot > bs.layers[i - 1].slot), 'ascending slot order');
    check(bs.pos.length === 1 && bs.clips[0].name === 'walk', 'still a blend space underneath');

    setLayerWeight(2, 0.35);
    advanceTime(50);
    near(player.blendState().layers.find((l) => l.slot === 2).weight, 0.35, 1e-3, 'runtime weight');
    setLayerWeight(2, 1.0);

    setLayerEnabled(2, false, 0);
    setLayerEnabled(3, false, 0);
    advanceTime(200);
    eq(player.activeLayers().map((l) => l.slot).join(','), '1', 'stopping frees the slot');
});

// Playback is deterministic under virtual time, so the sharp question can be
// asked: with a right-arm wave over a walk, do the LEG bones land on EXACTLY
// the pose they would have without it? A leaking mask could not give 0.
function poseAfter(mask) {
    setLayerEnabled(1, false, 0);
    selectSpace('locomotion', 0);
    setSpeedAxis(1.6);
    if (mask) { setLayerMask(1, mask); setLayerEnabled(1, true, 0); }
    advanceTime(320);
    const p = { phase: player.blendState().phase };
    for (const b of ['ankle_L', 'knee_R', 'toe_L', 'wrist_R', 'elbow_R', 'wrist_L', 'head']) p[b] = boneAt(b);
    return p;
}

test('masking isolates a layer to its bones, exactly', () => {
    const bare = poseAfter(null), again = poseAfter(null);
    check(dist(bare.ankle_L, again.ankle_L) === 0 && dist(bare.wrist_R, again.wrist_R) === 0, 'deterministic');
    eq(bare.phase, again.phase, 'same phase');

    const armed = poseAfter('right arm');
    check(dist(bare.wrist_R, armed.wrist_R) > 0.20, 'the masked-in wrist moves');
    check(dist(bare.elbow_R, armed.elbow_R) > 0.05, 'its elbow moves');
    for (const b of ['ankle_L', 'knee_R', 'toe_L', 'wrist_L', 'head']) {
        check(dist(bare[b], armed[b]) < 1e-6, `masked-out ${b} untouched (${dist(bare[b], armed[b])})`);
    }
    // The converse: it is the MASK, not the clip, that keeps the legs out.
    const full = poseAfter('full body');
    check(dist(bare.ankle_L, full.ankle_L) > 0.05, 'full-body mask takes the legs');
    const hd = poseAfter('head only');
    check(dist(bare.head, hd.head) > 1e-4 && dist(bare.ankle_L, hd.ankle_L) < 1e-6 &&
          dist(bare.wrist_R, hd.wrist_R) < 1e-6, 'head only moves only the head');
    setLayerMask(1, 'right arm');
    setLayerEnabled(1, false, 0);
});

test('walk and wave at once', () => {
    selectSpace('locomotion', 0);
    setSpeedAxis(3.0);
    setLayerEnabled(1, true, 0);
    advanceTime(200);
    const a = bonePositions();
    advanceTime(180);
    const bs = player.blendState();
    eq(bs.clips.length, 2, 'two base clips blending');
    check(bs.layers.length === 1 && bs.layers[0].name === 'wave', 'a masked layer on top');
    check(maxDelta(a, bonePositions()) > 0.005, 'the whole pose moves');
    setLayerEnabled(1, false, 0);
});

test('action state tracks the base track and the axes', () => {
    eq(state.base, 'locomotion');
    eq(state.speedAxis, 3.0);
    eq(LAYER_ROWS.map((r) => r.mask).join('|'), 'right arm|left arm|head only', 'disjoint default masks');
    selectClip('walk');
    eq(state.base, 'walk', 'a clip takes the base back');
    advanceTime(50);
    // blendState().pos is [] (not undefined) once no space drives the base.
    eq((player.blendState().pos || []).length, 0, 'the space is gone from blendState');
});

done('anim-lab blend');
