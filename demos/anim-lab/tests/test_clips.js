// Rig, clips, transport, crossfade, bone overlay and masks.
//
// The load-bearing assertions are the "moves bones" ones: bone transforms must
// CHANGE between two advanceTime() calls while a clip plays and stop changing
// while paused. A node existing or a call not throwing would pass just as
// happily against a rig that never moves.

import { check, eq, near, test, done } from "/lib/kit/test.js";
import { scene, character, player, clips, masks, overlay } from "/app/lab.js";
import { selectClip, crossfade, pause, play, scrub, setSpeed, setLoop, stop } from "/app/actions.js";
import { bonePositions, maxDelta, weightSum } from "/app/tests/helpers.js";

const idx = character.rig.index;

test('rig: skinned mesh, 20 bones, clean skin, real geometry', () => {
    eq(character.node.type, 'skinnedMesh');
    eq(character.boneCount, 20, 'full humanoid');
    eq(character.node.boneCount, character.boneCount, 'palette matches skeleton');
    check(character.node.skinReady === true, 'skin covers the mesh');
    check(character.skinReport.clean === true, 'skin validates: ' + JSON.stringify(character.skinReport));
    check(character.mesh.vertexCount > 500 && character.mesh.triangleCount > 500, 'mesh has geometry');
    for (const n of ['root', 'hips', 'chest', 'head', 'shoulder_R', 'elbow_R', 'hip_L', 'knee_L', 'ankle_L', 'toe_R']) {
        check(idx[n] !== undefined, `bone "${n}"`);
    }
});

test('bind pose renders, human height, with a shadow', () => {
    stop(0);
    advanceTime(50);
    const p = bonePositions();
    check(p[idx.head] !== null, 'bind pose exposes bone matrices');
    check(p[idx.head][1] > p[idx.hips][1], 'head above hips');
    check(p[idx.head][1] > 1.3 && p[idx.head][1] < 2.0, 'head y ' + p[idx.head][1]);
    const s = scene.cullStats();
    check(s.meshDrawn > 0, 'draws meshes: ' + JSON.stringify(s));
    check(s.shadowDrawn > 0, 'skinned character casts a shadow');
});

test('clip library: 14 clips of keyframe data that round-trip as JSON', () => {
    eq(clips.names.length, 14, clips.names.join(','));
    for (const n of ['idle', 'walk', 'run', 'wave', 'jump', 'walkBack', 'walkStrafeL', 'walkStrafeR',
                     'crouchIdle', 'crouchWalk', 'point', 'nod']) {
        const def = clips.defs[n];
        check(def && def.tracks.length > 0 && def.tracks.every((t) => t.keys.length > 1), `"${n}" is keyframe data`);
        eq(JSON.parse(JSON.stringify(def)).duration, def.duration, `"${n}" round-trips`);
    }
});

for (const name of clips.names) {
    test(`playback: "${name}" advances and moves bones`, () => {
        selectClip(name);
        advanceTime(16);
        const t0 = player.currentTime, p0 = bonePositions();
        advanceTime(200);
        eq(player.currentClip, name, 'current');
        check(player.playing, 'playing');
        check(player.duration > 0, 'duration');
        // A short clip can wrap inside 200 ms: "advanced" means moved at all.
        check(Math.abs(player.currentTime - t0) > 1e-4, 'clock advances');
        const d = maxDelta(p0, bonePositions());
        check(d > 0.005, `pose moved (max delta ${d.toFixed(4)} m)`);
    });
}

test('pausing freezes the pose; resuming moves it again', () => {
    selectClip('walk');
    advanceTime(120);
    pause();
    const a = bonePositions();
    advanceTime(300);
    const b = bonePositions();
    check(player.playing === false, 'reports not playing');
    check(maxDelta(a, b) < 1e-5, 'paused pose drifts ' + maxDelta(a, b));
    play();
    advanceTime(120);
    check(player.playing, 'playing again');
    check(maxDelta(b, bonePositions()) > 0.005, 'resumed pose moves');
});

test('scrubbing re-poses while paused', () => {
    pause();
    scrub(0.0);
    const a = bonePositions();
    scrub(0.5);
    check(maxDelta(a, bonePositions()) > 0.01, 'seek re-poses');
    near(player.normalizedTime, 0.5, 0.02, 'reports the sought time');
    play();
});

test('speed: 3x advances the clock faster than 1x', () => {
    selectClip('walk');
    setSpeed(1.0);
    advanceTime(16);
    let t = player.currentTime;
    advanceTime(100);
    const slow = Math.abs(player.currentTime - t);
    setSpeed(3.0);
    advanceTime(16);
    t = player.currentTime;
    advanceTime(100);
    const fast = Math.abs(player.currentTime - t);
    setSpeed(1.0);
    check(fast > slow * 1.5, `${slow.toFixed(4)} vs ${fast.toFixed(4)}`);
});

test('crossfade: two clips mid-fade, weights partition 1, settles on target', () => {
    selectClip('walk');
    advanceTime(200);
    crossfade('run', 0.4);
    advanceTime(100);
    const bs = player.blendState();
    check(bs.clips.length >= 2, 'blends two clips: ' + JSON.stringify(bs.clips));
    near(weightSum(bs), 1, 0.05, 'weights sum');
    const mid = bonePositions();
    advanceTime(500);
    check(maxDelta(mid, bonePositions()) > 0.005, 'pose keeps moving through the fade');
    eq(player.currentClip, 'run', 'settles on the target');
});

test('crossfade: zero-length and stacked fades settle', () => {
    crossfade('walk', 0);
    advanceTime(50);
    crossfade('run', 0.3);
    advanceTime(30);
    crossfade('idle', 0.3);          // a fade started mid-fade
    advanceTime(400);
    eq(player.currentClip, 'idle');
});

test('loop toggle keeps the clip active', () => {
    selectClip('walk');
    setLoop(false);
    advanceTime(50);
    eq(player.currentClip, 'walk', 'loop off');
    setLoop(true);
    advanceTime(50);
    eq(player.currentClip, 'walk', 'loop on');
});

test('bone overlay: a marker per bone, tracking getBoneWorldMatrix', () => {
    overlay.setEnabled(true);
    overlay.update();
    check(overlay.enabled, 'enabled');
    eq(overlay.joints.length, character.boneCount, 'one marker per bone');
    check(overlay.joints[0].visible === true, 'visible');
    const m = character.node.getBoneWorldMatrix('head');
    near(overlay.joints[idx.head].y, m[13], 1e-4, 'head marker y');
    overlay.setEnabled(false);
    check(overlay.joints[0].visible === false, 'hidden again');
});

test('bone masks: packed per bone, the defaults disjoint', () => {
    for (const n of masks.names) {
        eq(masks.get(n).length, character.boneCount, `"${n}" one entry per bone`);
        check(masks.count(n) > 0, `"${n}" selects something`);
    }
    check(masks.get('full body').every((v) => v === 1), 'full body covers every bone');
    eq(masks.count('right arm'), 3, masks.bones('right arm').join(','));
    eq(masks.get('head only')[idx.shoulder_R], 0, 'head only excludes the arms');
    const overlap = (a, b) => masks.get(a).some((v, i) => v === 1 && masks.get(b)[i] === 1);
    check(!overlap('right arm', 'left arm') && !overlap('right arm', 'head only') && !overlap('left arm', 'head only'),
        'default layer masks are disjoint');
});

done('anim-lab clips');
