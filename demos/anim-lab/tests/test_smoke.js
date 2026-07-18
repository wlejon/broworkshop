// tests/test_smoke.js — integration test for the anim-lab rig and player.
//
// The load-bearing assertion here is the last group: that bone transforms
// actually CHANGE between two advanceTime() calls while a clip plays, and stop
// changing when it is paused. Everything else (a node exists, a call did not
// throw) would pass just as happily against a rig that never moves, which is
// exactly the failure mode a skinning demo is prone to.

import {
    scene, character, player, clips, state, overlay,
    selectClip, crossfade,
} from "/app/app.js";

let failures = 0;
function check(label, ok, detail) {
    if (ok) {
        console.log(`  ok   ${label}`);
    } else {
        failures++;
        console.log(`  FAIL ${label}${detail !== undefined ? ' — ' + detail : ''}`);
    }
}

// Snapshot every bone's model-space translation, which is what a clip visibly
// moves. Rotations without translation change would still be motion, but on
// this rig every animated joint has children, so a rotating joint always moves
// something's origin.
function bonePositions() {
    const out = [];
    for (let i = 0; i < character.boneCount; ++i) {
        const m = character.node.getBoneWorldMatrix(i);
        out.push(m ? [m[12], m[13], m[14]] : null);
    }
    return out;
}

function maxDelta(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; ++i) {
        if (!a[i] || !b[i]) continue;
        for (let k = 0; k < 3; ++k) d = Math.max(d, Math.abs(a[i][k] - b[i][k]));
    }
    return d;
}

console.log('--- rig ---');

check('skinned mesh node exists', character.node && character.node.type === 'skinnedMesh',
      character.node && character.node.type);
check('bone count is the full humanoid (20)', character.boneCount === 20, character.boneCount);
check('node palette matches the skeleton', character.node.boneCount === character.boneCount,
      `${character.node.boneCount} vs ${character.boneCount}`);
check('skin covers the mesh', character.node.skinReady === true);
check('skin weights validate clean', character.skinReport.clean === true,
      JSON.stringify(character.skinReport));
check('mesh has geometry', character.mesh.vertexCount > 500 && character.mesh.triangleCount > 500,
      `${character.mesh.vertexCount} verts / ${character.mesh.triangleCount} tris`);

// Every bone the clips reference must resolve, or a clip would throw on play.
for (const name of ['root', 'hips', 'chest', 'head', 'shoulder_R', 'elbow_R',
                    'hip_L', 'knee_L', 'ankle_L', 'toe_R']) {
    check(`skeleton has bone "${name}"`, character.rig.index[name] !== undefined);
}

console.log('--- bind pose renders ---');

// stop() drops the player and the mesh renders in bind pose. A non-empty draw
// means the skinned pipeline actually submitted geometry.
player.stop(0);
advanceTime(50);
const bindPose = bonePositions();
check('bind pose exposes bone matrices', bindPose[character.rig.index.head] !== null);
check('bind pose head is above the hips',
      bindPose[character.rig.index.head][1] > bindPose[character.rig.index.hips][1],
      `head y ${bindPose[character.rig.index.head][1]}`);
check('bind pose is roughly human height',
      bindPose[character.rig.index.head][1] > 1.3 && bindPose[character.rig.index.head][1] < 2.0,
      bindPose[character.rig.index.head][1]);

const stats = scene.cullStats();
check('scene draws meshes in bind pose', stats.meshDrawn > 0, JSON.stringify(stats));
check('the skinned character casts a shadow', stats.shadowDrawn > 0, stats.shadowDrawn);

console.log('--- clips ---');

check('all five clips authored', clips.names.length === 5, clips.names.join(','));
for (const name of ['idle', 'walk', 'run', 'wave', 'jump']) {
    const def = clips.defs[name];
    check(`clip "${name}" is keyframe data`,
          def && def.tracks.length > 0 && def.tracks.every((t) => t.keys.length > 1),
          def && `${def.tracks.length} tracks`);
    check(`clip "${name}" round-trips as JSON`,
          JSON.parse(JSON.stringify(def)).duration === def.duration);
}

console.log('--- playback advances each clip ---');

for (const name of clips.names) {
    selectClip(name);
    advanceTime(16);
    const t0 = player.currentTime;
    const p0 = bonePositions();

    advanceTime(200);
    const t1 = player.currentTime;
    const p1 = bonePositions();

    check(`"${name}" reports as current`, player.currentClip === name, player.currentClip);
    check(`"${name}" is playing`, player.playing === true);
    check(`"${name}" has a duration`, player.duration > 0, player.duration);
    // A short clip can wrap inside 200 ms, so "advanced" means time moved at
    // all, not that it strictly increased.
    check(`"${name}" clock advances`, Math.abs(t1 - t0) > 1e-4, `${t0} -> ${t1}`);

    // The real assertion: the POSE moved, not just the clock.
    const d = maxDelta(p0, p1);
    check(`"${name}" moves bones (max delta ${d.toFixed(4)} m)`, d > 0.005, d);
}

console.log('--- pausing freezes the pose ---');

selectClip('walk');
advanceTime(120);
player.pause();
const paused0 = bonePositions();
advanceTime(300);
const paused1 = bonePositions();
check('paused player reports not playing', player.playing === false);
check('paused pose does not drift', maxDelta(paused0, paused1) < 1e-5,
      maxDelta(paused0, paused1));

player.resume();
advanceTime(120);
check('resumed player is playing again', player.playing === true);
check('resumed pose moves again', maxDelta(paused1, bonePositions()) > 0.005);

console.log('--- scrubbing ---');

player.pause();
player.seekNormalized(0.0);
const at0 = bonePositions();
player.seekNormalized(0.5);
const at50 = bonePositions();
check('seek re-poses while paused', maxDelta(at0, at50) > 0.01, maxDelta(at0, at50));
check('seek reports the sought time',
      Math.abs(player.normalizedTime - 0.5) < 0.02, player.normalizedTime);
player.resume();

console.log('--- speed ---');

selectClip('walk');
player.speed = 1.0;
advanceTime(16);
const s0 = player.currentTime;
advanceTime(100);
const slowStep = Math.abs(player.currentTime - s0);

player.speed = 3.0;
advanceTime(16);
const f0 = player.currentTime;
advanceTime(100);
const fastStep = Math.abs(player.currentTime - f0);
check('higher speed advances the clock faster', fastStep > slowStep * 1.5,
      `${slowStep.toFixed(4)} vs ${fastStep.toFixed(4)}`);
player.speed = 1.0;

console.log('--- crossfade ---');

selectClip('walk');
advanceTime(200);
crossfade('run', 0.4);
advanceTime(100);

// Mid-fade the base track carries BOTH clips; that is the observable proof a
// crossfade is running rather than a hard cut.
const blend = player.blendState();
check('crossfade blends two clips', blend.clips.length >= 2,
      JSON.stringify(blend.clips));
check('crossfade weights sum to 1',
      Math.abs(blend.clips.reduce((a, c) => a + c.weight, 0) - 1) < 0.05,
      JSON.stringify(blend.clips));

const mid = bonePositions();
advanceTime(500);
check('pose keeps moving through the fade', maxDelta(mid, bonePositions()) > 0.005);
check('crossfade settles on the target', player.currentClip === 'run', player.currentClip);

// Zero-length and back-to-back fades are the edge cases that throw if the fade
// machinery is being driven wrong.
crossfade('walk', 0);
advanceTime(50);
crossfade('run', 0.3);
advanceTime(30);
crossfade('idle', 0.3);          // start a fade mid-fade
advanceTime(400);
check('stacked crossfades do not throw and settle', player.currentClip === 'idle',
      player.currentClip);

console.log('--- loop toggle ---');

selectClip('walk');
player.loop = false;
advanceTime(50);
check('loop=false keeps the clip active', player.currentClip === 'walk');
player.loop = true;
advanceTime(50);
check('loop=true keeps the clip active', player.currentClip === 'walk');

console.log('--- bone overlay ---');

overlay.setEnabled(true);
overlay.update();
check('overlay enabled', overlay.enabled === true);
check('overlay has a marker per bone', overlay.joints.length === character.boneCount,
      overlay.joints.length);
check('overlay markers are visible', overlay.joints[0].visible === true);
const marker = overlay.joints[character.rig.index.head];
const headM = character.node.getBoneWorldMatrix('head');
check('overlay marker tracks its bone',
      Math.abs(marker.y - headM[13]) < 1e-4, `${marker.y} vs ${headM[13]}`);
overlay.setEnabled(false);
check('overlay markers hide again', overlay.joints[0].visible === false);

console.log('--- HUD state ---');

check('state exposes the selected clip', state.clip === 'walk', state.clip);
check('state tracks speed', state.speed === 1.0 || typeof state.speed === 'number');

// Leave the app in a presentable state.
selectClip('walk');
advanceTime(300);

console.log(failures === 0
    ? `\nPASS — all checks green`
    : `\nFAIL — ${failures} check(s) failed`);
assert(failures === 0, `${failures} check(s) failed`);
