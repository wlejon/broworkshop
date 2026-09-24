// Character Lab — a bench for bro's Jolt-backed kinematic character controller.
//
// Physics.createCharacter is the one big engine feature no app in the tree
// uses; every game here rolls its own movement instead. This app builds a
// course where each controller behaviour has a piece of geometry that proves
// it, wires the thinnest possible movement loop on top, and puts the
// controller's own state on screen so you can watch it decide.
//
//   step-up limit          stairs, risers 0.15 -> 0.65 m
//   slope limit            ramps at 15/30/42/52/65 degrees
//   stance / setShape      a 1.10 m tunnel; setShape refuses to stand you up
//   ground detection       a 2.5 m gap: grounded true -> false -> true
//   floor snap             six 0.30 m terraces under a 0.50 m stickToFloor
//   pushing rigid bodies   crates and barrels, shoved up to `maxStrength` N
//   moving platforms       a kinematic slab you ride at groundVelocity
//   sensing                shape casts, overlaps and rays, drawn, with filters
//   character vs character 32 real character controllers in a plaza
//   innerBody              whether the rest of the world can SEE the character
//   heightfield terrain    a 64x64 heightfield checked against its function
//   skinned avatar         an auto-rigged body driven by the engine's player,
//                          blend spaces and state machine from the controller
//
// Modules: course.js (geometry), character.js (the controller), avatar.js
// (the rigged body), queries.js (sensing), crowd.js, innerbody.js,
// terrain.js. This module assembles them, owns the camera, input and the
// frame tick, and exports the handles the HUD and the tests share. Tests
// import this module, never main.js (see ENGINE-ISSUES.md).

import "/lib/camera.js";
import { sceneViewport, screenRay, worldToScreen } from "/lib/kit/viewport3d.js";
import { buildCourse, tickCourse } from "/app/course.js";
import { createCharacter, tickCharacter, rebuild, tune, charState, input, SPAWN } from "/app/character.js";
import { buildQueryVis, tickQueries, nameBodies, setFacing, pickAlongRay } from "/app/queries.js";
import { buildCrowd, tickCrowd, sampleThrough } from "/app/crowd.js";
import { buildBallLab, tickBallLab } from "/app/innerbody.js";
import { buildTerrain, tickTerrain, regenerateTerrain } from "/app/terrain.js";

// The course lies 12-30 m ahead of the spawn pad, so the starting pitch looks
// down over the character's shoulder at all of it. Right-drag orbits, the
// wheel zooms; the left button is the pick, so panning is off (the pivot
// follows the character anyway).
export const vp = sceneViewport('#stage', {
    orbit: { target: [SPAWN.x, SPAWN.y + 0.6, SPAWN.z], rot: Camera.quatFromAxis(1, 0, 0, -0.45),
             dist: 13, fov: 58, near: 0.1, far: 300 },
    controls: { panButton: -1, minDist: 2.5, maxDist: 40 },
});
export const { canvas, scene, cam } = vp;

// Interpolation on: physics steps at 60 Hz while rendering is uncapped, and
// without it the capsule and every crate visibly snap.
Physics.setInterpolation(true);
Physics.setGravity(0, -tune.gravity, 0);

export const world = buildCourse(scene);
createCharacter(scene);
// The sensing layer sizes its ghost capsule from the live character and names
// query hits from the course's body tags, so it goes after both.
nameBodies(world);
buildQueryVis(scene);
buildTerrain(scene);
buildCrowd(scene);
buildBallLab(scene);

/** View toggles the HUD owns. */
export const view = { labels: true, interpolation: true };

/** Held keys. Tests press keys by writing here — the path a keyboard takes. */
export const keys = Object.create(null);

// Construction-time changes (controller options, terrain shape) are coalesced
// to one rebuild per frame: a dragged slider fires on every pixel.
const pending = { rebuild: false, terrain: false };
export function requestRebuild() { pending.rebuild = true; }
export function requestTerrain() { pending.terrain = true; }
export const terrainPending = () => pending.terrain;

// --- input -----------------------------------------------------------------------

let facingInitialised = false;

/**
 * WASD -> a world-space XZ direction relative to where the camera looks.
 * Camera forward is flattened and renormalized, so pitching down never slows
 * the character.
 */
function readMoveInput() {
    const f = Camera.quatRotVec(cam.rot, [0, 0, -1]);
    const r = Camera.quatRotVec(cam.rot, [1, 0, 0]);
    const fl = Math.hypot(f[0], f[2]) || 1, rl = Math.hypot(r[0], r[2]) || 1;
    let x = 0, z = 0;
    if (keys.w) { x += f[0] / fl; z += f[2] / fl; }
    if (keys.s) { x -= f[0] / fl; z -= f[2] / fl; }
    if (keys.d) { x += r[0] / rl; z += r[2] / rl; }
    if (keys.a) { x -= r[0] / rl; z -= r[2] / rl; }
    input.x = x;
    input.z = z;
    input.crouch = !!(keys.c || keys.control);
    // Sensors look where the player is about to walk; standing still, they
    // keep the last direction so releasing W does not swing every probe.
    if (x || z) setFacing(x, z);
    else if (!facingInitialised) { setFacing(f[0] / fl, f[2] / fl); facingInitialised = true; }
}

// --- picking + world labels ------------------------------------------------------

const viewNow = () => Camera.orbitViewOpts(cam, canvas);

/** Pick whatever solid is under a canvas pixel (ray + overlapPoint). */
export function pickAtScreen(sx, sy) {
    const r = canvas.getBoundingClientRect();
    const ray = screenRay(viewNow(), r.width, r.height, sx, sy);
    return pickAlongRay(ray.origin[0], ray.origin[1], ray.origin[2], ray.dir[0], ray.dir[1], ray.dir[2], 300);
}

// The engine has no 3D text node, so risers and ramp angles are DOM labels
// projected through the exact view the scene is handed (vp.onView).
export const labelEls = world.labels.map((l) => {
    const el = document.createElement('div');
    el.className = 'wl ' + l.cls;
    el.textContent = l.text;
    document.getElementById('labels').appendChild(el);
    return el;
});

function projectLabels(v) {
    const r = canvas.getBoundingClientRect();
    const W = r.width, H = r.height;
    if (!W || !H) return;
    for (let i = 0; i < world.labels.length; ++i) {
        const el = labelEls[i];
        const s = view.labels ? worldToScreen(world.labels[i].at, v, W, H) : null;
        if (!s || s.behind || s.depth <= cam.near || s.x < -120 || s.x > W + 120 || s.y < -40 || s.y > H + 40) {
            el.style.display = 'none';
            continue;
        }
        el.style.display = 'block';
        el.style.left = s.x.toFixed(1) + 'px';
        el.style.top = s.y.toFixed(1) + 'px';
        // Fade with distance so the far end of the course is not a wall of text.
        el.style.opacity = Math.max(0.15, Math.min(1, 34 / s.depth)).toFixed(2);
    }
}

// --- the frame -------------------------------------------------------------------
//
// Pending rebuilds, input, the character, the platform, the crowd (steered
// against the player's settled position), the throughput sample, the ball,
// the terrain readout, and the sensors last so every query sees the frame's
// final world. Then the orbit pivot follows the character; sceneViewport
// pushes the camera and the labels are projected through that same view.

export function tick(dt) {
    if (pending.rebuild) { pending.rebuild = false; rebuild(scene); }
    if (pending.terrain) { pending.terrain = false; regenerateTerrain(); }
    readMoveInput();
    tickCharacter();
    tickCourse(world, dt);
    tickCrowd(dt);
    const cmd = Math.hypot(input.x, input.z);
    if (cmd > 1e-6) sampleThrough(input.x / cmd, input.z / cmd, tune.moveSpeed, dt);
    else sampleThrough(0, 0, 0, dt);
    tickBallLab(dt);
    tickTerrain();
    tickQueries(world);
    const p = charState.position;
    Camera.orbitReframe(cam, [p.x, p.y + 0.6, p.z], cam.dist);
}

vp.onFrame(tick);
vp.onView(projectLabels);

// Re-exports, so the HUD and the tests have one import.
export * from "/app/character.js";
export * from "/app/queries.js";
export * from "/app/crowd.js";
export * from "/app/innerbody.js";
export * from "/app/terrain.js";
