// lab.js — the scene, the character and the whole animation tower, built once.
//
// This module is engine-side only (no DOM besides the canvas), and every other
// module shares its handles: actions.js drives them, the HUD reads them, the
// frame loop in main.js ticks them, and the tests import them.
//
// What is demonstrated, and where:
//
//   rig.js      A 20-bone humanoid and a skinned mesh generated from bromesh
//               capsules, weighted by distance to the bone segments. Real
//               SkinData, createSkinnedMesh, GPU skinning, a deforming shadow.
//   lib/kit/humanoid.js
//               Fourteen clips — idle, the four compass gaits, run, the crouch
//               pair, jump, three gestures and two root-motion gaits —
//               authored as keyframe DATA and compiled to bromesh Animations
//               (shared with demos/character-lab's auto-rigged avatar).
//   masks.js    Named bone-mask presets, packed to the arrays playLayer wants.
//   player.js   A facade over the skinned mesh's built-in player: clips,
//               crossfades, 1D/2D blend spaces, masked layers, root motion.
//   states.js   A five-state machine with authored fades, phase-synced crouch
//               transitions and auto-advancing one-shots, plus its driver.
//   cameras.js  Three camera NODES: orbit, a follow cam parented to the
//               character, a wide cam flown by a node-property clip.
//   stage.js    Ground, pad, a 1.5 m marker run and a shadow-casting sun.
//
// The three animation tiers run at once and stay distinct:
//   1. skinnedMesh.play(...)            animates BONES
//   2. skinnedMesh.addStateMachine(...) animates STATE over tier 1
//   3. scene.createAnimationPlayer()    animates NODE PROPERTIES (the rim light
//                                       breathing here, the cinematic camera)
//
// No bone is posed from JavaScript: the engine advances, blends, runs the
// machine and uploads the palette on its own tick. tick() below only drives
// the machine's parameters, drains root motion onto the node, copies the orbit
// rig onto its camera node and moves the (off-by-default) bone overlay.

import { Camera } from "/lib/kit/camera.js";
import { humanoidClipDefs, compileClips } from "/lib/kit/humanoid.js";
import { boneFrames, boneOverlay } from "/lib/kit/skeletal.js";
import { buildStage, MARKER_SPACING, MARKER_COUNT } from "/app/stage.js";
import { buildCharacter } from "/app/rig.js";
import { buildMasks } from "/app/masks.js";
import { createPlayer } from "/app/player.js";
import { createStateMachine } from "/app/states.js";
import { createCameras } from "/app/cameras.js";

export { MARKER_SPACING, MARKER_COUNT };

export const canvas = document.getElementById('stage');
export const scene = canvas.getContext('scene');

// Framed on the torso: a 1.7 m figure reads best with the pivot at chest
// height, so orbiting sweeps around the character rather than its ankles.
export const cam = Camera.createOrbit({ target: [0, 0.95, 0], dist: 4.6, fov: 45, near: 0.05, far: 200 });

export const stage = buildStage(scene);
export const character = buildCharacter(scene, { name: 'character' });

// Clips are compiled against this rig and registered once; from here on the
// engine owns playback entirely.
export const clips = compileClips(humanoidClipDefs(), boneFrames(character.skeleton));
for (const name of clips.names) character.node.addClip(name, clips.animations[name]);

// Blend spaces capture their member clips at registration, so they go on
// after the clips and before anything plays. The state machine goes on last,
// because its states reference those spaces; installing it enters `idle`.
export const masks = buildMasks(character.rig);
export const player = createPlayer(character.node, clips, masks);
player.defineSpaces();
export const machine = createStateMachine(character.node, player);

export const cameras = createCameras(scene, character, cam);
export const overlay = boneOverlay(scene, character.node, character.rig.parents);

// Tier 3 as scene dressing: the rim and fill lights breathe for the whole
// session, so the difference between the tiers is always on screen.
export const stagePlayer = scene.createAnimationPlayer();
stagePlayer.addClip('rimBreath', {
    duration: 6.0,
    loop: 'pingpong',
    tracks: [
        { target: 'rim', property: 'intensity', keys: [
            { time: 0.0, value: 11, ease: 'sineInOut' }, { time: 6.0, value: 20 }] },
        { target: 'fill', property: 'intensity', keys: [
            { time: 0.0, value: 26, ease: 'sineInOut' }, { time: 6.0, value: 18 }] },
    ],
});
stagePlayer.play('rimBreath');

/** Root-motion telemetry: path length travelled, markers passed, node z. */
export const motion = { distance: 0, markers: 0, z: 0 };

/**
 * One frame. `dt` is seconds of the SCALED clock (bro.time), the one that
 * stops when the engine is paused — the clock a state machine should age on.
 *
 * Note what is NOT here: scene.setCamera(). Camera nodes and the imperative
 * view are last-call-wins, so one setCamera would silently deactivate the
 * camera node the user selected.
 */
export function tick(dt) {
    machine.tick(dt);

    // consumeRootMotion() resets on read, so it is drained every frame while
    // enabled: skipped frames would pile displacement up into a teleport.
    if (machine.params.rootMotion) {
        motion.distance += player.pumpRootMotion(0);
        const z = character.node.position[2];
        motion.z = z;
        motion.markers = Math.max(0, Math.min(MARKER_COUNT, Math.floor(z / MARKER_SPACING)));
    }
    cameras.syncOrbit();
    overlay.update();
}
