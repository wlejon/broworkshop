// Character Lab — a bench for bro's Jolt-backed kinematic character controller.
//
// Physics.createCharacter is the one big engine feature no app in the tree
// uses; every game here rolls its own movement instead. This app exists to
// make that look like a mistake. It builds a course where each controller
// behaviour has a piece of geometry that proves it, wires the thinnest
// possible movement loop on top, and puts the controller's own state on
// screen so you can watch it decide.
//
// WHAT IS DEMONSTRATED, and where the proof lives
// -----------------------------------------------
//
//   step-up limit          stairs, risers 0.15 -> 0.65 m. The controller walks
//                          up every riser under `stepUp` and stops dead at the
//                          first one over it. Move the slider, move the cutoff.
//   slope limit            five ramps at 15/30/42/52/65 degrees. Under the
//                          limit the ground reports "onGround"; over it,
//                          "onSteepGround" and gravity slides you back with no
//                          JS involved.
//   stance / setShape      a tunnel with 1.10 m of clearance. Standing is 1.80
//                          m, crouched 0.80 m. Past the exit, setShape REFUSES
//                          to stand you up — one boolean, the whole "can I
//                          stand here" query.
//   ground detection       a 2.5 m gap: grounded goes true -> false -> true.
//   floor snap             six 0.30 m terraces under a 0.50 m stickToFloor.
//   pushing rigid bodies   crates and barrels, shoved up to `maxStrength` N.
//   moving platforms       a kinematic slab; you ride it at groundVelocity +
//                          your own desire, for free.
//   sensing                shape casts, overlaps and rays run BEFORE a move,
//                          drawn in the world, with their filters as live
//                          checkboxes. One ray, three filters, three bodies.
//   character vs character 32 real character controllers in a plaza. Nothing
//                          in the app resolves a collision; shouldering through
//                          the crowd costs you two thirds of your speed and
//                          the HUD measures it.
//   innerBody              one checkbox decides whether the rest of the physics
//                          world can SEE the character. A thrown ball either
//                          bounces off you or passes through; an overlapShape
//                          either finds you or does not.
//   heightfield terrain    the far half of the world is a 64x64 heightfield.
//                          Same controller, same slope limit, non-primitive
//                          ground — and the engine's reported slope is checked
//                          against the derivative of the height function that
//                          built it.
//
// MODULES
//
//   course.js     The obstacle course. Visual and collision are authored as one
//                 object so they cannot desync.
//   character.js  The controller. ~60 lines of actual logic — set a desired
//                 velocity, read the state back. No collision response, no
//                 ground probe, no step sweep. Those are Jolt's.
//   queries.js    The sensing layer: four queries, drawn in the world.
//   crowd.js      The NPC crowd. Steering only; the physics is the engine's.
//   innerbody.js  The ball launcher and the self-visibility query.
//   terrain.js    The heightfield. One height function, two consumers.
//   hud.js        Sliders for every tunable the API exposes, plus the live
//                 readouts every section above is measured by.
//
// app.js wires them together, runs the follow camera, converts WASD into a
// camera-relative direction, projects the world labels into the DOM, and
// exports the handles the smoke test drives.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { buildCourse, tickCourse } from "/app/course.js";
import {
    createCharacter, tickCharacter, resetToSpawn, teleport, rebuild,
    tune, charState, input, SPAWN,
    RADIUS, STAND_HALF, CROUCH_HALF, isCrouched, characterVisual,
} from "/app/character.js";
import {
    buildQueryVis, tickQueries, nameBodies, setFacing, getFacing,
    pickAlongRay, sense, qState, bodyName,
    forwardCast, ledgeProbe, proximity, lookRay,
} from "/app/queries.js";
import {
    buildCrowd, tickCrowd, sampleThrough, crowd, crowdState, npcs,
    setCrowdSize, setCrowdPhysical, resetCrowd, placeNpc, npcPosition,
    crowdBodies, isNpcBody, PLAZA,
} from "/app/crowd.js";
import {
    buildBallLab, tickBallLab, launchBall, clearBall, selfOverlap,
    ballLab, ballState, ballPosition, ballBody, BALL_LAB,
} from "/app/innerbody.js";
import {
    buildTerrain, tickTerrain, regenerateTerrain, heightAt, slopeAt,
    onTerrain, probeGround, terrain, terrainState, TERRAIN_WALK, SEAM_Z,
} from "/app/terrain.js";
import { bindHud, updateReadout, setFps, view } from "/app/hud.js";

installSystemMenu();

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

// The course spans roughly x -20..22 and z -18..14, so the far plane only has
// to clear a few hundred units. Near stays tight because the follow camera
// gets close to the capsule when the user zooms in.
// The starting pitch is well above the orbit default: the course lies 12-30 m
// ahead of the spawn pad, and a shallow third-person angle stares at empty
// floor. This looks down over the character's shoulder at the whole course.
const cam = Camera.createOrbit({
    target: [SPAWN.x, SPAWN.y + 0.6, SPAWN.z],
    rot: Camera.quatFromAxis(1, 0, 0, -0.45),
    dist: 13,
    fov: 58,
    near: 0.1,
    far: 300,
});

// Interpolation is on by default: physics steps at 60 Hz while rendering is
// uncapped, and without it the capsule and every crate visibly snap.
Physics.setInterpolation(true);
Physics.setGravity(0, -tune.gravity, 0);

const world = buildCourse(scene);
createCharacter(scene);

// The sensing layer needs the character to exist first — the ghost capsule it
// draws for the forward sweep is sized from the character's real dimensions —
// and it needs the course's body tags so query results can be named rather than
// printed as bare integers.
nameBodies(world);
buildQueryVis(scene);

// The three late additions. Terrain first: it is static geometry that the
// crowd and the ball lab never touch, but the HUD's "walk me to the hills"
// button needs its height function available the moment the panel binds.
buildTerrain(scene);
buildCrowd(scene);
buildBallLab(scene);

const applyPendingRebuild = bindHud(scene);

// --- Input -------------------------------------------------------------------
// `keys` is exported: the smoke test presses keys rather than calling movement
// functions, so it exercises exactly the path a human's keyboard does.

export const keys = Object.create(null);

const MOVE_KEYS = { w: 1, a: 1, s: 1, d: 1 };

document.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    keys[k] = true;
    if (k === ' ') { input.jump = true; e.preventDefault(); }
    if (k === 'r') { resetToSpawn(); resetCrowd(); }
    if (k === 'b') launchBall();
    if (MOVE_KEYS[k] || k === 'c' || k === 'control') e.preventDefault();
});
document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

// Camera: right-drag orbits, wheel zooms. The pivot is re-anchored to the
// character every frame, so orbiting is orbiting AROUND the character.
let rightDown = false;
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { rightDown = true; e.preventDefault(); canvas.requestPointerLock(); }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 2) { rightDown = false; document.exitPointerLock(); }
});
document.addEventListener('mousemove', (e) => {
    if (rightDown) Camera.orbitLook(cam, e.movementX, e.movementY);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * Turn a pixel on the canvas into a world-space ray. This is projectLabels()
 * run backwards through the same focal length and camera rotation, so the ray
 * provably matches what is on screen — a pick that used a second, independent
 * projection would be a pick that silently drifts.
 */
export function screenRay(sx, sy) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const aspect = W / H;
    const focal = 1 / Math.tan((cam.fov * Math.PI / 180) / 2);
    const ndcX = (sx / W - 0.5) * 2;
    const ndcY = (0.5 - sy / H) * 2;
    // Undo the divide-by-depth: at depth 1 the camera-space point is this.
    const local = [ndcX * aspect / focal, ndcY / focal, -1];
    const d = Camera.quatRotVec(cam.rot, local);
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    return {
        origin: [cam.pos[0], cam.pos[1], cam.pos[2]],
        dir: [d[0] / len, d[1] / len, d[2] / len],
    };
}

/** Left-click picks whatever solid is under the cursor via overlapPoint. */
export function pickAtScreen(sx, sy) {
    const r = screenRay(sx, sy);
    return pickAlongRay(r.origin[0], r.origin[1], r.origin[2],
                        r.dir[0], r.dir[1], r.dir[2], 300);
}

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) pickAtScreen(e.offsetX, e.offsetY);
});
canvas.addEventListener('wheel', (e) => {
    cam.dist = Math.max(2.5, Math.min(40, cam.dist * Math.exp(e.deltaY * 0.001)));
    e.preventDefault();
});

/**
 * Turn WASD into a world-space direction on the XZ plane, relative to where
 * the camera is looking. Camera forward is projected flat and renormalized so
 * that pitching the camera down never slows the character.
 */
function readMoveInput() {
    const f = Camera.quatRotVec(cam.rot, [0, 0, -1]);
    const r = Camera.quatRotVec(cam.rot, [1, 0, 0]);
    const fl = Math.hypot(f[0], f[2]) || 1;
    const rl = Math.hypot(r[0], r[2]) || 1;
    let x = 0, z = 0;
    if (keys['w']) { x += f[0] / fl; z += f[2] / fl; }
    if (keys['s']) { x -= f[0] / fl; z -= f[2] / fl; }
    if (keys['d']) { x += r[0] / rl; z += r[2] / rl; }
    if (keys['a']) { x -= r[0] / rl; z -= r[2] / rl; }
    input.x = x;
    input.z = z;
    input.crouch = !!(keys['c'] || keys['control']);

    // The sensors look where the player is about to walk. While a move key is
    // held that is the commanded direction; standing still, it stays on the
    // last one, so releasing W does not swing every probe around.
    if (x || z) setFacing(x, z);
    else if (!facingInitialised) { setFacing(f[0] / fl, f[2] / fl); facingInitialised = true; }
}

let facingInitialised = false;

// --- World-space labels ------------------------------------------------------
// The engine has no 3D text node, so the step risers and ramp angles are DOM
// elements projected through the same view the scene renders with. cam.rot is
// the camera orientation the scene was handed, so this cannot drift from what
// is on screen.

const labelLayer = document.getElementById('labels');
const labelEls = world.labels.map((l) => {
    const el = document.createElement('div');
    el.className = 'wl ' + l.cls;
    el.textContent = l.text;
    labelLayer.appendChild(el);
    return el;
});

function projectLabels() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    const aspect = W / H;
    const focal = 1 / Math.tan((cam.fov * Math.PI / 180) / 2);
    // Inverse of a unit quaternion is its conjugate — rotates world deltas
    // into camera space, where -Z is forward.
    const inv = [-cam.rot[0], -cam.rot[1], -cam.rot[2], cam.rot[3]];
    for (let i = 0; i < world.labels.length; ++i) {
        const el = labelEls[i];
        if (!view.labels) { el.style.display = 'none'; continue; }
        const a = world.labels[i].at;
        const local = Camera.quatRotVec(inv,
            [a[0] - cam.pos[0], a[1] - cam.pos[1], a[2] - cam.pos[2]]);
        const depth = -local[2];
        if (depth <= cam.near) { el.style.display = 'none'; continue; }
        const sx = (local[0] / depth * focal / aspect * 0.5 + 0.5) * W;
        const sy = (0.5 - local[1] / depth * focal * 0.5) * H;
        if (sx < -120 || sx > W + 120 || sy < -40 || sy > H + 40) {
            el.style.display = 'none';
            continue;
        }
        el.style.display = 'block';
        el.style.left = sx.toFixed(1) + 'px';
        el.style.top = sy.toFixed(1) + 'px';
        // Labels fade with distance so the far end of the course does not turn
        // into a wall of text.
        el.style.opacity = Math.max(0.15, Math.min(1, 34 / depth)).toFixed(2);
    }
}

// --- Frame loop --------------------------------------------------------------
// Order: apply any pending rebuild, read input, drive the character, advance
// the kinematic platform, then camera/labels/readout. The character is ticked
// before the camera so the follow camera never trails by a frame.

let last = performance.now();
let fpsAccum = 0, fpsFrames = 0;

function frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    applyPendingRebuild();
    readMoveInput();
    tickCharacter();
    tickCourse(world, dt);
    // The crowd steers after the player has been driven so an NPC's velocity
    // for this step is chosen against the player's current position, and the
    // ball lab after the crowd so its verdict reads the settled world.
    tickCrowd(dt);
    // How much of the commanded direction the player is actually making
    // progress along. Sampled here, while this frame's command is still live.
    const cmdLen = Math.hypot(input.x, input.z);
    if (cmdLen > 1e-6) sampleThrough(input.x / cmdLen, input.z / cmdLen, tune.moveSpeed, dt);
    else sampleThrough(0, 0, 0, dt);
    tickBallLab(dt);
    tickTerrain();

    // Sensors run last, after the controller has settled and after the
    // kinematic platform has moved, so every query sees the frame's final
    // world rather than a half-stepped one.
    tickQueries(world);

    // Follow: keep the orbit pivot on the character's head height and preserve
    // the user's current orbit orientation and zoom.
    const p = charState.position;
    Camera.orbitReframe(cam, [p.x, p.y + 0.6, p.z], cam.dist);
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));

    projectLabels();
    updateReadout();

    fpsAccum += dt;
    if (++fpsFrames >= 20) {
        setFps(fpsFrames / Math.max(1e-6, fpsAccum));
        fpsAccum = 0; fpsFrames = 0;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// The character handle is recreated by rebuild(), so it is exported through a
// live getter rather than a bound value.
export const state = {
    view, tune, charState, input, keys, sense, qState,
    crowd, crowdState, ballLab, ballState, terrain, terrainState,
};
export {
    sense, qState, setFacing, getFacing, bodyName, tickQueries, pickAlongRay,
    forwardCast, ledgeProbe, proximity, lookRay,
};
export {
    crowd, crowdState, npcs, setCrowdSize, setCrowdPhysical, resetCrowd,
    placeNpc, npcPosition, crowdBodies, isNpcBody, PLAZA, tickCrowd,
};
export {
    ballLab, ballState, launchBall, clearBall, selfOverlap, ballPosition,
    ballBody, BALL_LAB,
};
export {
    terrain, terrainState, regenerateTerrain, heightAt, slopeAt, onTerrain,
    probeGround, TERRAIN_WALK, SEAM_Z,
};
export { scene, cam, canvas, world, tune, charState, input, SPAWN };
export { resetToSpawn, teleport, rebuild, tickCharacter, isCrouched, characterVisual };
export { RADIUS, STAND_HALF, CROUCH_HALF };
export { character } from "/app/character.js";
