// Animation Lab — bro's skeletal animation tower, on one character.
//
// bro can build a rig, skin a mesh to it, compile keyframe data into clips and
// play them entirely in C++, and until now nothing in the tree used any of it.
// This app does, end to end, with no imported character asset:
//
//   rig.js      A humanoid skeleton (20 bones) and a skinned mesh generated
//               from bromesh capsules, with per-vertex weights derived from
//               distance to the bone segments. Real SkinData, real
//               createSkinnedMesh, GPU skinning, deforming shadow.
//   clips.js    idle / walk / run / wave / jump, authored as plain keyframe
//               DATA from phase-driven curves and compiled to bromesh
//               Animations. No JavaScript poses a bone per frame.
//   player.js   A facade over the skinned mesh's built-in player, which owns
//               evaluate → blend → skinning-palette natively.
//   stage.js    Ground, pad, marker run, and a shadow-casting key light — the
//               shadow is the cue that ties a foot to the floor.
//   overlay.js  getBoneWorldMatrix() per bone into a marker rig, so the pose
//               the app can read is visibly the pose the GPU is skinning with.
//   hud.js      The switchboard: clip selector, transport, speed, loop,
//               scrubber, crossfade.
//
// app.js wires those together, runs the camera and the frame loop, and exports
// the handles the smoke test asserts against.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { buildStage } from "/app/stage.js";
import { buildCharacter } from "/app/rig.js";
import { buildClips } from "/app/clips.js";
import { createPlayer } from "/app/player.js";
import { createBoneOverlay } from "/app/overlay.js";
import { state, bindHud, updateReadout, setFps, selectClip, crossfade } from "/app/hud.js";

installSystemMenu();

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

// Framed on the torso rather than the feet: a 1.7 m figure reads best with the
// pivot around chest height, and orbiting then sweeps around the character
// instead of around its ankles.
const cam = Camera.createOrbit({
    target: [0, 0.95, 0],
    dist: 4.6,
    fov: 45,
    near: 0.05,
    far: 200,
});

const stage = buildStage(scene);
const character = buildCharacter(scene, { name: 'character' });

// Clips are authored against the rig (bone names → indices) and registered
// once. From here on the engine owns playback entirely.
const clips = buildClips(character.rig);
for (const name of clips.names) {
    character.node.addClip(name, clips.animations[name]);
}

const player = createPlayer(character.node, clips);
const overlay = createBoneOverlay(scene, character);

bindHud(player, overlay, character);

// A one-shot clip would strand the character in its final pose, so anything
// non-looping falls back to idle. Even though every clip here currently loops,
// wiring it now means chunk 3's one-shot jump state has somewhere to land.
character.node.onAnimationFinished = () => crossfade('idle', 0.25);

// Start in idle through the HUD's own entry point, so the grid highlight and
// the engine agree from frame one.
selectClip('idle');

// --- Stage accent: the OTHER clip system --------------------------------------
// scene.createAnimationPlayer() animates scene-NODE properties from JSON
// clipDefs — a different tier from the skeletal player above, and worth having
// side by side so the distinction is concrete rather than documentation. This
// one breathes the rim light, which is scene dressing, not character motion.

const stagePlayer = scene.createAnimationPlayer();
stagePlayer.addClip('rimBreath', {
    duration: 6.0,
    loop: 'pingpong',
    tracks: [
        { target: 'rim', property: 'intensity', keys: [
            { time: 0.0, value: 11, ease: 'sineInOut' },
            { time: 6.0, value: 20 },
        ]},
        { target: 'fill', property: 'intensity', keys: [
            { time: 0.0, value: 26, ease: 'sineInOut' },
            { time: 6.0, value: 18 },
        ]},
    ],
});
stagePlayer.play('rimBreath');

// --- Camera input (right = orbit, middle = pan, wheel = zoom) -----------------

let rightDown = false, middleDown = false;
function updatePointerLock() {
    const want = rightDown || middleDown;
    const locked = document.pointerLockElement === canvas;
    if (want && !locked) canvas.requestPointerLock();
    else if (!want && locked) document.exitPointerLock();
}
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2)      { rightDown  = true; e.preventDefault(); updatePointerLock(); }
    else if (e.button === 1) { middleDown = true; e.preventDefault(); updatePointerLock(); }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightDown  = false;
    if (e.button === 1) middleDown = false;
    updatePointerLock();
});
document.addEventListener('mousemove', (e) => {
    if (rightDown)  Camera.orbitLook(cam, e.movementX, e.movementY);
    if (middleDown) Camera.orbitPan (cam, e.movementX, e.movementY);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
canvas.addEventListener('wheel', (e) => {
    cam.dist = Math.max(0.8, cam.dist * Math.exp(e.deltaY * 0.001));
    e.preventDefault();
});

// Space toggles playback: comparing a pose against the motion around it is the
// most common thing to want here, and reaching for the button loses the frame.
document.addEventListener('keydown', (ev) => {
    if (ev.key !== ' ') return;
    ev.preventDefault();
    if (player.playing) player.pause(); else player.resume();
});

// --- Frame loop ---------------------------------------------------------------
// The character is NOT touched here. The engine's skeletal player advances the
// clip, blends, and uploads the palette on its own tick — this loop only moves
// the camera, updates the debug overlay when it is on, and refreshes readouts.

let fpsAccum = 0, fpsFrames = 0, fpsLast = performance.now();

function frame() {
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));

    overlay.update();

    const now = performance.now();
    fpsAccum += now - fpsLast;
    fpsLast = now;
    if (++fpsFrames >= 20) {
        setFps(1000 / (fpsAccum / fpsFrames));
        fpsAccum = 0; fpsFrames = 0;
    }
    if (fpsFrames % 5 === 0) updateReadout();

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { scene, cam, canvas, character, player, clips, state,
         stage, overlay, stagePlayer };
export { selectClip, crossfade, updateReadout } from "/app/hud.js";
