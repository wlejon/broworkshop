// tests/test_smoke.js — integration test for the anim-lab rig and player.
//
// The load-bearing assertion here is the last group: that bone transforms
// actually CHANGE between two advanceTime() calls while a clip plays, and stop
// changing when it is paused. Everything else (a node exists, a call did not
// throw) would pass just as happily against a rig that never moves, which is
// exactly the failure mode a skinning demo is prone to.

import {
    scene, character, player, clips, masks, state, overlay,
    selectClip, crossfade, selectSpace, setSpeedAxis, setDirection,
    setLayerEnabled, setLayerWeight, setLayerMask, LAYER_ROWS,
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

check('the full clip library is authored', clips.names.length === 12, clips.names.join(','));
for (const name of ['idle', 'walk', 'run', 'wave', 'jump',
                    'walkBack', 'walkStrafeL', 'walkStrafeR',
                    'crouchIdle', 'crouchWalk', 'point', 'nod']) {
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

console.log('--- bone masks ---');

for (const name of masks.names) {
    const packed = masks.get(name);
    check(`mask "${name}" is one entry per bone`,
          packed.length === character.boneCount, packed.length);
    check(`mask "${name}" selects something`, masks.count(name) > 0, masks.count(name));
}
check('"full body" covers every bone',
      masks.get('full body').every((v) => v === 1));
check('"right arm" is three bones', masks.count('right arm') === 3,
      masks.bones('right arm').join(','));
check('"head only" excludes the arms',
      masks.get('head only')[character.rig.index.shoulder_R] === 0);

// The three default layer masks must not overlap, or "three layers at once"
// would be three layers fighting.
const overlap = (a, b) => masks.get(a).some((v, i) => v === 1 && masks.get(b)[i] === 1);
check('the default layer masks are disjoint',
      !overlap('right arm', 'left arm') && !overlap('right arm', 'head only')
      && !overlap('left arm', 'head only'));

console.log('--- 1D blend space ---');

selectSpace('locomotion', 0);
advanceTime(200);
check('a blend space takes the base track',
      player.blendState().pos !== undefined, JSON.stringify(player.blendState()));

// Sweeping the axis: at a sample point that clip owns the mix outright,
// between two points both appear, and the weights always partition 1.
const sweep = [];
for (const s of [0.0, 0.4, 0.8, 1.2, 1.6, 2.5, 3.4, 4.2, 5.0]) {
    setSpeedAxis(s);
    advanceTime(16);
    const b = player.blendState();
    const w = {};
    for (const c of b.clips) w[c.name] = c.weight;
    sweep.push({ s, w, n: b.clips.length });

    const sum = b.clips.reduce((a, c) => a + c.weight, 0);
    check(`speed ${s.toFixed(1)}: weights sum to 1`, Math.abs(sum - 1) < 1e-3, sum);
    check(`speed ${s.toFixed(1)}: at most two clips blend`, b.clips.length <= 2, b.clips.length);
    check(`speed ${s.toFixed(1)}: parameter reported back`,
          Math.abs(b.pos[0] - s) < 1e-3, JSON.stringify(b.pos));
}

const at = (s) => sweep.find((e) => e.s === s).w;
check('idle owns the axis floor', Math.abs((at(0.0).idle || 0) - 1) < 1e-3,
      JSON.stringify(at(0.0)));
check('walk owns its sample point', Math.abs((at(1.6).walk || 0) - 1) < 1e-3,
      JSON.stringify(at(1.6)));
check('run owns the axis ceiling', Math.abs((at(5.0).run || 0) - 1) < 1e-3,
      JSON.stringify(at(5.0)));

// Handover: idle must fall monotonically and walk rise across 0 → 1.6, then
// walk fall and run rise across 1.6 → 5.0. This is the assertion that the
// space actually INTERPOLATES rather than snapping to the nearest clip.
const idleW = [0.0, 0.4, 0.8, 1.2, 1.6].map((s) => at(s).idle || 0);
const walkUp = [0.0, 0.4, 0.8, 1.2, 1.6].map((s) => at(s).walk || 0);
const walkDn = [1.6, 2.5, 3.4, 4.2, 5.0].map((s) => at(s).walk || 0);
const runUp  = [1.6, 2.5, 3.4, 4.2, 5.0].map((s) => at(s).run  || 0);
const falls = (a) => a.every((v, i) => i === 0 || v <= a[i - 1] + 1e-4);
const rises = (a) => a.every((v, i) => i === 0 || v >= a[i - 1] - 1e-4);
check('idle weight falls monotonically as speed rises', falls(idleW), JSON.stringify(idleW));
check('walk weight rises to its sample point', rises(walkUp), JSON.stringify(walkUp));
check('walk weight falls away past it', falls(walkDn), JSON.stringify(walkDn));
check('run weight rises toward the ceiling', rises(runUp), JSON.stringify(runUp));
check('mid-range genuinely blends two clips',
      sweep.find((e) => e.s === 0.8).n === 2 && sweep.find((e) => e.s === 3.4).n === 2);

// Beyond the ends the parameter clamps rather than extrapolating.
setSpeedAxis(5.0);
player.setLocomotion(99);
advanceTime(16);
check('the axis clamps at its top sample point',
      Math.abs(player.blendState().pos[0] - 5.0) < 1e-3, player.blendState().pos[0]);
setSpeedAxis(1.6);

// Phase sync is what keeps a 1.0 s walk and a 0.62 s run foot-aligned: the
// blended pose has to keep MOVING through a mid-range mix, not stall.
setSpeedAxis(3.0);
advanceTime(50);
const mix0 = bonePositions();
advanceTime(150);
check('a mid-range mix keeps animating', maxDelta(mix0, bonePositions()) > 0.005,
      maxDelta(mix0, bonePositions()));

console.log('--- 2D blend space ---');

selectSpace('directional', 0);
advanceTime(200);
check('the 2D space reports a 2D parameter',
      player.blendState().pos && player.blendState().pos.length === 2,
      JSON.stringify(player.blendState().pos));

// Each sample point must resolve to its own clip outright — this is what makes
// the pad's presets a meaningful demonstration rather than a vague nudge.
const CORNERS = [
    [ 0,  0, 'idle'],
    [ 0,  1, 'walk'],
    [ 0, -1, 'walkBack'],
    [-1,  0, 'walkStrafeL'],
    [ 1,  0, 'walkStrafeR'],
];
for (const [x, y, expect] of CORNERS) {
    setDirection(x, y);
    advanceTime(16);
    const b = player.blendState();
    const sum = b.clips.reduce((a, c) => a + c.weight, 0);
    const top = b.clips.slice().sort((a, c) => c.weight - a.weight)[0];
    check(`2D (${x}, ${y}) resolves to "${expect}"`, top.name === expect,
          JSON.stringify(b.clips));
    check(`2D (${x}, ${y}) gives it full weight`, Math.abs(top.weight - 1) < 1e-3,
          top.weight);
    check(`2D (${x}, ${y}) weights sum to 1`, Math.abs(sum - 1) < 1e-3, sum);
}

// A diagonal is where the three-nearest-points rule shows itself: forward-right
// is walk + strafeR + idle, not a two-way lerp.
setDirection(0.7, 0.7);
advanceTime(16);
const diag = player.blendState();
const diagNames = diag.clips.map((c) => c.name).sort();
check('a diagonal blends three sample points', diag.clips.length === 3,
      JSON.stringify(diag.clips));
check('the diagonal picks the right three',
      diagNames.join(',') === 'idle,walk,walkStrafeR', diagNames.join(','));
check('the diagonal weights sum to 1',
      Math.abs(diag.clips.reduce((a, c) => a + c.weight, 0) - 1) < 1e-3);

const dg0 = bonePositions();
advanceTime(150);
check('the diagonal mix animates', maxDelta(dg0, bonePositions()) > 0.005);

console.log('--- layers ---');

selectSpace('locomotion', 0);
setSpeedAxis(1.6);
advanceTime(200);
check('no layers to start', player.activeLayers().length === 0);

setLayerEnabled(1, true, 0);
advanceTime(200);
let bs = player.blendState();
check('the base survives a layer going on',
      bs.clips.length === 1 && bs.clips[0].name === 'walk', JSON.stringify(bs.clips));
check('the layer appears in blendState',
      bs.layers.length === 1 && bs.layers[0].name === 'wave', JSON.stringify(bs.layers));
check('the layer reports its slot', bs.layers[0].slot === 1, bs.layers[0].slot);
check('the layer runs its own phase', bs.layers[0].phase >= 0 && bs.layers[0].phase <= 1,
      bs.layers[0].phase);

// Three at once over a moving base — the headline claim.
setLayerEnabled(2, true, 0);
setLayerEnabled(3, true, 0);
advanceTime(200);
bs = player.blendState();
check('three layers run simultaneously', bs.layers.length === 3, JSON.stringify(bs.layers));
check('layers report in ascending slot order',
      bs.layers.every((l, i) => i === 0 || l.slot > bs.layers[i - 1].slot),
      bs.layers.map((l) => l.slot).join(','));
check('the base is still a blend space underneath them',
      bs.pos !== undefined && bs.clips[0].name === 'walk', JSON.stringify(bs.clips));

setLayerWeight(2, 0.35);
advanceTime(50);
const l2 = player.blendState().layers.find((l) => l.slot === 2);
check('layer weight is settable at runtime', Math.abs(l2.weight - 0.35) < 1e-3, l2.weight);
setLayerWeight(2, 1.0);

setLayerEnabled(2, false, 0);
setLayerEnabled(3, false, 0);
advanceTime(200);
check('stopping a layer frees its slot',
      player.activeLayers().map((l) => l.slot).join(',') === '1',
      JSON.stringify(player.activeLayers()));

console.log('--- masking isolates the layer to its bones ---');

// THE assertion this whole group exists for.
//
// Playback is deterministic under virtual time — restarting a blend space
// resets its phase, and advanceTime() is exact — so running the identical
// sequence twice produces a bit-identical pose. That makes it possible to ask
// the sharp question rather than a statistical one: with a right-arm-masked
// wave layered over a walking blend space, do the LEG bones land on exactly
// the pose they would have without the layer?
//
// "Exactly" is not hyperbole here: the tolerance below is 1e-6 m, and the
// measured delta is 0. A mask that leaked at all — through a parent bone, or
// by blending a bind-pose contribution into an unmasked bone — could not
// produce that.
function poseAfter(layerMask) {
    setLayerEnabled(1, false, 0);
    selectSpace('locomotion', 0);
    setSpeedAxis(1.6);
    if (layerMask) {
        setLayerMask(1, layerMask);
        setLayerEnabled(1, true, 0);
    }
    advanceTime(320);
    const read = (n) => {
        const m = character.node.getBoneWorldMatrix(n);
        return [m[12], m[13], m[14]];
    };
    return {
        phase: player.blendState().phase,
        ankle_L: read('ankle_L'), knee_R: read('knee_R'), toe_L: read('toe_L'),
        wrist_R: read('wrist_R'), elbow_R: read('elbow_R'),
        wrist_L: read('wrist_L'), head: read('head'),
    };
}
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

const bare = poseAfter(null);
const again = poseAfter(null);
check('playback is deterministic enough to compare poses exactly',
      dist(bare.ankle_L, again.ankle_L) === 0 && dist(bare.wrist_R, again.wrist_R) === 0,
      `${dist(bare.ankle_L, again.ankle_L)} / ${dist(bare.wrist_R, again.wrist_R)}`);
check('both runs land on the same phase', bare.phase === again.phase,
      `${bare.phase} vs ${again.phase}`);

const armed = poseAfter('right arm');
check('the masked-in arm MOVES under the layer',
      dist(bare.wrist_R, armed.wrist_R) > 0.20,
      dist(bare.wrist_R, armed.wrist_R).toFixed(4));
check('its parent elbow moves too',
      dist(bare.elbow_R, armed.elbow_R) > 0.05,
      dist(bare.elbow_R, armed.elbow_R).toFixed(4));
for (const bone of ['ankle_L', 'knee_R', 'toe_L']) {
    check(`the masked-out ${bone} is untouched by the layer`,
          dist(bare[bone], armed[bone]) < 1e-6, dist(bare[bone], armed[bone]));
}
check('the masked-out other arm is untouched',
      dist(bare.wrist_L, armed.wrist_L) < 1e-6, dist(bare.wrist_L, armed.wrist_L));
check('the masked-out head is untouched',
      dist(bare.head, armed.head) < 1e-6, dist(bare.head, armed.head));

// The converse, and the reason the above is about the MASK rather than about
// the clip: the same clip on the same layer with a full-body mask DOES take
// the legs over. If this failed, the isolation above would prove nothing more
// than "wave does not animate legs".
const full = poseAfter('full body');
check('a full-body mask lets the layer take the legs over',
      dist(bare.ankle_L, full.ankle_L) > 0.05, dist(bare.ankle_L, full.ankle_L).toFixed(4));
check('a head-only mask moves the head and nothing else', (() => {
    const h = poseAfter('head only');
    return dist(bare.head, h.head) > 1e-4 && dist(bare.ankle_L, h.ankle_L) < 1e-6
           && dist(bare.wrist_R, h.wrist_R) < 1e-6;
})());

setLayerMask(1, 'right arm');
setLayerEnabled(1, false, 0);

console.log('--- walk and wave at once ---');

// The payoff, stated as a test: a moving base and a gesture layer, together,
// with the legs on the base's clock and the arm on the layer's.
selectSpace('locomotion', 0);
setSpeedAxis(3.0);
setLayerEnabled(1, true, 0);
advanceTime(200);
const both0 = bonePositions();
advanceTime(180);
const both1 = bonePositions();
bs = player.blendState();
check('walking and waving at once: two base clips blending',
      bs.clips.length === 2, JSON.stringify(bs.clips));
check('walking and waving at once: a masked layer on top',
      bs.layers.length === 1 && bs.layers[0].name === 'wave');
check('walking and waving at once: the whole pose is in motion',
      maxDelta(both0, both1) > 0.005, maxDelta(both0, both1));
setLayerEnabled(1, false, 0);

console.log('--- HUD state ---');

check('state tracks speed', typeof state.speed === 'number');
check('state tracks the base track', state.base === 'locomotion', state.base);
check('state tracks both blend axes',
      state.speedAxis === 3.0 && typeof state.dirX === 'number', state.speedAxis);
check('the HUD exposes three layer rows', LAYER_ROWS.length === 3);
check('the layer rows default to disjoint masks',
      LAYER_ROWS.map((r) => r.mask).join('|') === 'right arm|left arm|head only',
      LAYER_ROWS.map((r) => r.mask).join('|'));

selectClip('walk');
check('a clip takes the base track back from a space', state.base === 'walk', state.base);
advanceTime(50);
check('and the space is gone from blendState',
      player.blendState().pos === undefined,
      JSON.stringify(player.blendState().pos));

// Leave the app in the state that best shows what it does: walking at a
// two-clip mix with a masked wave on top.
selectSpace('locomotion', 0.2);
setSpeedAxis(2.6);
setLayerEnabled(1, true, 0.2);
advanceTime(400);

console.log(failures === 0
    ? `\nPASS — all checks green`
    : `\nFAIL — ${failures} check(s) failed`);
assert(failures === 0, `${failures} check(s) failed`);
