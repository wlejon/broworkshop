// Animation Lab — bro's skeletal animation tower, on one character.
//
// bro can build a rig, skin a mesh to it, compile keyframe data into clips,
// blend them, run a state machine over them, extract root motion out of them
// and carry a camera through the scene graph — all in C++, and until this app
// nothing in the tree used any of it. This does, end to end, with no imported
// character asset and no bone posed from JavaScript.
//
// ── What is demonstrated, and where ───────────────────────────────────────────
//
//   rig.js      A humanoid skeleton (20 bones) and a skinned mesh generated
//               from bromesh capsules, with per-vertex weights derived from
//               distance to the bone segments. Real SkinData, real
//               createSkinnedMesh, GPU skinning, deforming shadow.
//   clips.js    Fourteen clips — idle, the four compass gaits, run, the crouch
//               pair, jump, three gestures and the two root-motion gaits —
//               authored as plain keyframe DATA from phase-driven curves and
//               compiled to bromesh Animations. JSON in, Animation out.
//   masks.js    Named bone-mask presets (upper body / arms / one arm / head),
//               packed to the per-bone 0/1 arrays playLayer wants.
//   player.js   A facade over the skinned mesh's built-in player, which owns
//               evaluate → blend → skinning-palette natively — single clips,
//               crossfades, 1D/2D blend spaces, eight masked layers, and the
//               root-motion pump.
//   states.js   The state machine: a five-state graph with authored fades,
//               phase-synced crouch transitions and auto-advancing one-shots,
//               plus the parameter driver that decides when to travel.
//   cameras.js  Three camera NODES — orbit, a follow cam parented to the
//               character, and a wide cam flown by a node-property clip.
//   stage.js    Ground, pad, a 1.5 m marker run, and a shadow-casting key
//               light — the shadow ties a foot to the floor, the markers turn
//               root motion from a claim into a measurement.
//   overlay.js  getBoneWorldMatrix() per bone into a marker rig parented to
//               the character, so the pose the app can read is visibly the
//               pose the GPU is skinning with — even while the node moves.
//   hud.js      The switchboard: every feature above, toggleable live.
//
// ── The three tiers, kept distinct on purpose ─────────────────────────────────
//
// It is easy to conflate bro's animation systems. They are genuinely separate,
// and this app runs all three simultaneously so the difference is concrete:
//
//   1. skinnedMesh.play(...)            animates BONES. Clips, crossfades,
//                                       blend spaces, masked layers.
//   2. skinnedMesh.addStateMachine(...) animates STATE. A graph over tier 1,
//                                       where transitions carry the fades.
//   3. scene.createAnimationPlayer()    animates NODE PROPERTIES. Position,
//                                       rotation, fov, intensity — from JSON
//                                       clipDefs. Cutscenes, prop rigs, lights.
//
// Tier 3 breathes the rim light and flies the cinematic camera; tiers 1 and 2
// run the character. Nothing about them is shared except the frame they land
// in, which is the point.
//
// ── The showpiece: root motion vs treadmilling ────────────────────────────────
//
// Push the state-machine speed slider up and the character walks. With root
// motion OFF it walks in place forever, framed by markers it never reaches.
// Tick root motion ON and the same clips, at the same speed, through the same
// state machine, start moving the character down the run at 1.5 m a block —
// because the gait clips genuinely translate their root bone, and the engine
// hands that displacement to the app instead of drawing it. The odometer
// counts what the animation authored, not what a velocity integrator guessed.
//
// app.js wires those together, runs the frame loop, and exports the handles
// the smoke test asserts against.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { buildStage } from "/app/stage.js";
import { buildCharacter } from "/app/rig.js";
import { buildClips } from "/app/clips.js";
import { buildMasks } from "/app/masks.js";
import { createPlayer } from "/app/player.js";
import { createStateMachine } from "/app/states.js";
import { createCameras } from "/app/cameras.js";
import { createBoneOverlay } from "/app/overlay.js";
import { state, motion, bindHud, updateReadout, setFps, selectClip, crossfade,
         trigger, selectCamera } from "/app/hud.js";

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

// Blend spaces are registered ONCE, after the clips exist and before anything
// plays. They capture their member clips at registration time, so this is the
// natural place for them: from here on "locomotion" and "walk" are
// interchangeable arguments to play() — and to a state's `source`.
const masks = buildMasks(character.rig);
const player = createPlayer(character.node, clips, masks);
player.defineSpaces();

// The state machine goes on last, because its states reference those spaces by
// name. Installing it enters `idle` immediately, so the character is alive
// from frame one without the app playing anything explicitly.
const machine = createStateMachine(character.node, player);

const cameras = createCameras(scene, character, cam);
const overlay = createBoneOverlay(scene, character);

bindHud(player, overlay, character, masks, machine, cameras);

// A one-shot clip played MANUALLY (from the clip grid) would strand the
// character in its final pose, so anything non-looping falls back to idle.
// State-machine one-shots do not come through here — autoAdvance is authored
// into the graph and the engine leaves those states by itself.
character.node.onAnimationFinished = () => {
    if (character.node.state === null) crossfade('idle', 0.25);
};

// --- Stage accent: the node-property tier -------------------------------------
// scene.createAnimationPlayer() animates scene-NODE properties from JSON
// clipDefs — tier 3 above. This one breathes the rim light, which is scene
// dressing rather than character motion, and runs for the whole session so the
// distinction between the tiers is always on screen.

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

// Keyboard shortcuts for the things you reach for while watching rather than
// while reading the panel: pause, the two one-shots, and the camera cuts.
document.addEventListener('keydown', (ev) => {
    switch (ev.key) {
        case ' ': ev.preventDefault();
                  if (player.playing) player.pause(); else player.resume();
                  break;
        case 'j': case 'J': trigger('jump'); break;
        case 'v': case 'V': trigger('wave'); break;
        case '1': selectCamera('orbit');  break;
        case '2': selectCamera('follow'); break;
        case '3': selectCamera('wide');   break;
        default: return;
    }
});

// --- Frame loop ---------------------------------------------------------------
// The character's POSE is never touched here. The engine's skeletal player
// advances the clip, blends, runs the state machine's transitions and uploads
// the palette on its own tick. This loop does four things: drives the state
// machine's parameters, drains the root-motion accumulator onto the node,
// copies the orbit rig onto its camera node, and refreshes readouts.
//
// Note what is NOT here: scene.setCamera(). Camera nodes and the imperative
// view are last-call-wins, so a single setCamera would silently deactivate
// whichever camera node the user selected.

const MARKER_SPACING = 1.5;
const MARKER_COUNT = 7;

let fpsAccum = 0, fpsFrames = 0, fpsLast = performance.now();
let lastClock = bro.time.now;

function frame() {
    // bro.time.now is the SCALED clock in ms — the one that stops when the
    // engine is paused, which is the clock a state machine should age on.
    const clock = bro.time.now;
    const dt = Math.max(0, (clock - lastClock) / 1000);
    lastClock = clock;

    machine.tick(dt);

    // Root motion: drain whatever the engine extracted from this tick's
    // blended pose and walk the node by it. consumeRootMotion() is called
    // unconditionally while enabled — it resets on read, so skipping calls
    // would let displacement pile up and teleport the character later.
    if (machine.params.rootMotion) {
        motion.distance += player.pumpRootMotion(0);
        const z = character.node.position[2];
        motion.z = z;
        motion.markers = Math.max(0, Math.min(MARKER_COUNT,
            Math.floor(z / MARKER_SPACING)));
    }

    cameras.syncOrbit();
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

export { scene, cam, canvas, character, player, clips, masks, state, motion,
         stage, overlay, stagePlayer, machine, cameras, MARKER_SPACING };
export { selectClip, crossfade, updateReadout,
         selectSpace, setSpeedAxis, setDirection,
         setLayerEnabled, setLayerWeight, setLayerMask, setLayerClip,
         travelTo, trigger, setStateSpeed, setCrouch,
         setRootMotion, resetJourney, selectCamera,
         LAYER_ROWS } from "/app/hud.js";
