// Physics Playground — an interactive sandbox for bro's 3D Jolt surface.
//
// broworkshop's physics footprint before this app was entirely 2D arcade, so
// the whole rigid-body layer was dark. This demo lights up the parts that are
// hard to appreciate from a doc comment — the ones where the API is one line
// but the BEHAVIOUR is the point.
//
// THE TOUR. Three bays, and the camera-focus buttons in the HUD fly between
// them:
//
//   z = 0    the main sandbox — material lanes, spawning, areas, layers,
//            ragdolls, soft bodies
//   z = -18  the machine yard — SixDOF machines, motors, and the gear /
//            rack-and-pinion / pulley bench
//   z = +18  the breakyard — a suspension bridge held together by constraints
//            with a breaking threshold you can drag from indestructible to
//            fragile
//
// WHAT IS DEMONSTRATED, by module:
//
//   stage.js   Three material lanes fed by three identical ramps. Friction and
//              restitution stop being numbers and become "how far did it go"
//              and "how high did it come back".
//   spawn.js   Bodies + their visuals + the registry that makes click-to-select
//              and live property editing possible.
//   areas.js   setAreaOverride zones — gravity scale, buoyancy+drag, and a
//              point-gravity well — each drawn as a translucent hull so you can
//              see the boundary an object crosses when its behaviour changes.
//   layers.js  A six-layer collision matrix, editable live from a checkbox grid.
//              Spawned bodies are colour-coded by layer, so untick a pair and
//              the effect is immediate and obvious.
//   ragdoll.js Thirteen-part humanoids: joints that hold, limbs you can punch
//              individually, and BOTH pose drives side by side — motorised
//              (muscle tone, still falls) versus kinematic (stands up, shoves).
//   softbody.js A pinned cloth and a pressurized ball. Pinned vertices are
//              exactly immovable while the sheet between them sags; pressure
//              turns the ball from a wet bag into a drum.
//   machines.js SixDOF constraints as machine tools. A slewing crane with a
//              motorised winch, a piston lift, and a turret whose two position
//              motors are re-aimed at a moving drone every frame. Every axis of
//              every machine is switchable locked / limited / free live, drawn
//              as colour-coded bars at the pivot. Plus a collideConnected
//              toggle, and the mechanism bench: `gear`, `rackAndPinion` and
//              `pulley` — three constraint types that existed in the binding
//              layer and that no broworkshop app had ever called.
//   breakables.js A suspension bridge whose every joint carries a
//              `breakingImpulse`. Drag the threshold, drop a wrecking ball or
//              fire a shell down the deck, and watch getBrokenConstraints()
//              report the unzip joint by joint.
//   contacts.js The contact manifold from Physics.getContacts(), drawn as
//              quills and listed with penetration and impulse — and then USED:
//              the impulse estimate drives spark bursts, impact flashes, a
//              force meter and camera shake. Diagnostic data and gameplay
//              input are the same stream read two ways.
//   hud.js     The switchboard. Every feature here is toggleable live.
//
// The headline control is the step-rate slider next to the interpolation
// checkbox. Every physics visual in broworkshop today snaps at the step rate
// because nothing turns Physics.setInterpolation on; running the world
// deliberately slow at 15 Hz makes the difference impossible to miss.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";

// layers.js pushes its matrix at Physics on import, and createBody resolves
// layer NAMES against that table — so it has to land before stage.js starts
// building bodies. Import order is load-bearing here.
import "/app/layers.js";
import { buildStage } from "/app/stage.js";
import { buildAreas } from "/app/areas.js";
import { initSpawn, bodies, spawn, rain, materialRace, clearAll, despawn, bodyCount, onClearAll } from "/app/spawn.js";
import { initRagdolls, findPart, updateRagdolls, clearRagdolls } from "/app/ragdoll.js";
import { initSoftBodies, updateSoftBodies, clearSoftBodies } from "/app/softbody.js";
import { initMachines, buildMachines, updateMachines, clearMachineDebris } from "/app/machines.js";
import { initBreakables, buildBridge, noteBroken, rebuildBridge, clearRubble } from "/app/breakables.js";
import { initContacts, consume as consumeContacts, updateContacts, shakeOffset, clearContacts, setFocus as setContactFocus } from "/app/contacts.js";
import { state, bindHud, select, setFps, refreshCount, spawnCurrent, dropOne, selectRagdollPart, refreshRagdollHud, refreshChunk3Hud } from "/app/hud.js";

installSystemMenu();

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

// The lanes run -24..+24 along X at z = -6/0/+6, which is an awkward thing to
// frame: straight down +Z the three lanes overlap into one stripe, and the
// orbit camera's default near-level pitch puts the eye below the perimeter
// walls. So the start pose is an explicit yaw + pitch — a raised three-quarter
// view from front-left. Yaw separates the lanes across the screen, pitch gets
// the eye above the walls, and both together are what make the translucent
// area hulls read as volumes rather than as flat rectangles.
const startRot = Camera.quatMul(
    Camera.quatFromAxis(0, 1, 0, -0.55),    // yaw: swing round to the -X side
    Camera.quatFromAxis(1, 0, 0, -0.42));   // pitch: ~24 degrees down
const cam = Camera.createOrbit({
    target: [2, 2, 0],
    rot:    startRot,
    dist:   46,
    fov:    52,
    near:   0.1,
    far:    400,
});

// --- Environment ------------------------------------------------------------
// Lit rather than flat-shaded on purpose: the material lanes are distinguished
// by colour AND by roughness (ice is near-mirror, concrete is matte), and a
// shadow-casting sun is what makes a bouncing ball's height legible — the
// contact shadow is a better depth cue than the ball itself.

// Exposure is deliberately below 1: the lanes are told apart by colour, and a
// hot key light washes a saturated surface toward white, which is exactly the
// cue the demo cannot afford to lose.
scene.setAmbient([0.055, 0.06, 0.075]);
scene.setToneMap({ mode: 'aces', exposure: 0.85 });

const sun = scene.createLight({
    type: 'directional',
    position: [-12, 18, 10],
    direction: [-0.35, -1.0, -0.28],
    color: [1.0, 0.97, 0.90],
    intensity: 2.4,
    castsShadow: true,
    name: 'sun',
});

// A cool fill from the opposite side so the far faces of objects sitting in
// the sun's shadow do not go to pure ambient black.
scene.createLight({
    type: 'directional',
    direction: [0.5, -0.6, 0.5],
    color: [0.45, 0.58, 0.80],
    intensity: 0.9,
    name: 'fill',
});

// --- World ------------------------------------------------------------------

const stage = buildStage(scene);
buildAreas(scene);
initSpawn(scene);
initRagdolls(scene);
initSoftBodies(scene);
initMachines(scene);
initBreakables(scene);
initContacts(scene);
buildMachines();
buildBridge();

// "Clear all" has to mean all. Ragdolls and soft bodies are not rigid bodies in
// spawn.js's tag registry — a ragdoll's bodies and joints live and die as one
// unit, and a soft body is a particle cloud — so each registers its own
// teardown rather than spawn.js growing knowledge of both.
onClearAll(() => { clearRagdolls(); refreshRagdollHud(); });
onClearAll(() => clearSoftBodies());

// Chunk 3's teardown. The MACHINES themselves are fixtures, like the lanes and
// the ramps — "clear all" that deleted the crane would leave a HUD full of dead
// handles, exactly the trap spawn.js's clearAll() comment warns about. What it
// does sweep is everything the machines and the bridge PRODUCE: payloads,
// shells, wrecking balls, rubble, and the contact viewer's accumulated state.
// The bridge is rebuilt rather than removed, so "clear all" also means "undo
// the damage" — which is what a user pressing it after a collapse wants.
onClearAll(() => clearMachineDebris());
onClearAll(() => { rebuildBridge(); });
onClearAll(() => { clearContacts(); setContactFocus(null); });

const world = { stage, sun };

// bindHud builds the cloth and the ball, so the soft-body module must be
// initialised above it.
bindHud(stage);

// The bay buttons live here rather than in hud.js: the camera belongs to
// app.js, and hud.js importing app.js would close the module cycle.
{
    const row = document.getElementById('viewRow');
    if (row) {
        for (const b of row.querySelectorAll('button')) {
            b.addEventListener('click', () => {
                focusView(b.dataset.view);
                for (const o of row.querySelectorAll('button')) o.classList.toggle('sel', o === b);
            });
        }
    }
}

// --- Picking ----------------------------------------------------------------
//
// Left click does one of two things depending on what is under the cursor:
// hit a dynamic body -> select it; hit anything else (or nothing) -> spawn at
// that point. Both start from the same unproject + raycast, which is why the
// selection test and the spawn test in tests/ can share a helper.
//
// Note the raycast layer filter is deliberately absent: the ray should see
// layers regardless of what the collision matrix says, because "I can click
// it" and "it collides with that" are different questions. The API's `layers`
// filter is independent of the matrix for exactly this reason.

function rayFromPixel(lx, ly) {
    const r = scene.unprojectLocal(lx, ly);
    if (!r) return null;
    return { o: r.origin, d: r.dir };
}

/**
 * Resolve a canvas-local pixel to an action. Exported so the smoke test can
 * drive selection and click-spawn through the same path the mouse uses.
 * @returns {{kind:'select'|'part'|'spawn'|'miss', tag?:number, point?:{x,y,z}}}
 */
export function pickAt(lx, ly) {
    const ray = rayFromPixel(lx, ly);
    if (!ray) return { kind: 'miss' };
    const hit = Physics.raycastClosest(
        ray.o[0], ray.o[1], ray.o[2], ray.d[0], ray.d[1], ray.d[2], 400);
    if (!hit) return { kind: 'miss' };

    // Ragdoll parts are ORDINARY bodies, so a raycast reports one as a plain
    // body tag with nothing to say it belongs to a joint set — the part lookup
    // has to happen before the loose-body registry is consulted.
    const part = findPart(hit.bodyId);
    if (part) {
        selectRagdollPart(part.entry, part.index);
        return { kind: 'part', tag: hit.bodyId, part: part.index, point: hit.position };
    }

    if (bodies.has(hit.bodyId)) {
        select(hit.bodyId);
        // The contact viewer follows the selection: picking a body is also how
        // you ask "show me THIS body's contacts".
        setContactFocus(hit.bodyId);
        return { kind: 'select', tag: hit.bodyId, point: hit.position };
    }
    // Static geometry — spawn just above the surface so the new body drops
    // onto it instead of starting interpenetrated.
    const p = { x: hit.position.x, y: hit.position.y + 1.2, z: hit.position.z };
    const e = spawnCurrent(p);
    refreshCount();
    return { kind: 'spawn', tag: e.tag, point: p };
}

canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    pickAt(ev.clientX - rect.left, ev.clientY - rect.top);
});

// --- Camera input (right = orbit, middle = pan, wheel = zoom) ----------------
// Left mouse belongs to picking above.

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
    cam.dist = Math.max(4.0, cam.dist * Math.exp(e.deltaY * 0.001));
    e.preventDefault();
});

// Keyboard shortcuts for the two things you reach for constantly while
// watching a sandbox: spawn another object, and turn the headline feature on
// and off without hunting for its checkbox.
document.addEventListener('keydown', (ev) => {
    if (ev.key === ' ') {
        ev.preventDefault();
        const box = document.getElementById('interp');
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change'));
    } else if (ev.key === 'Enter') {
        ev.preventDefault();
        dropOne();
        refreshCount();
    } else if (ev.key === 'Escape') {
        select(null);
    }
});

// --- Frame loop -------------------------------------------------------------
//
// Rigid bodies need nothing here: a PhysicsNode auto-syncs from its body once
// per frame, honouring Physics.setInterpolation, so the whole rigid sandbox
// (including every ragdoll part, which is an ordinary body under an ordinary
// PhysicsNode) renders itself.
//
// The two things that DO need a tick are the two that have no single transform
// to sync. Kinematic pose drive is incremental pursuit and must be re-issued
// every step; a soft body's state IS its geometry, so its vertices have to be
// streamed into its mesh.

let fpsAccum = 0, fpsFrames = 0, fpsLast = performance.now();
let lastFrameTime = performance.now();

/**
 * Drain the two global physics event streams, exactly once per frame, and fan
 * them out to their consumers.
 *
 * Both Physics.getContacts() and Physics.getBrokenConstraints() DRAIN on read:
 * whatever you get, nobody else will. So the drain cannot live inside the
 * module that wants the data — breakables.js and contacts.js would each see
 * roughly half the stream and both would be quietly wrong. The frame loop owns
 * the call and hands the arrays out; that is the whole reason this function
 * exists rather than each module reading for itself.
 *
 * Exported so tests can pump the streams without a rendered frame.
 */
export function pumpPhysicsStreams(dt = 1 / 60) {
    noteBroken(Physics.getBrokenConstraints() || []);
    consumeContacts(Physics.getContacts(), (tag) => bodies.has(tag));
    updateContacts(dt);
}

function frame() {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - lastFrameTime) / 1000));
    lastFrameTime = now;

    updateRagdolls(dt);
    updateSoftBodies();
    updateMachines(dt);
    pumpPhysicsStreams(dt);

    // Camera shake is contact-driven: the offset is derived from the impulse
    // the solver estimated this frame, so a wrecking ball jolts the view and a
    // drifting box does not. Applied to the view's POSITION only — shaking the
    // orbit pivot would fight the user's own mouse input.
    const view = Camera.orbitViewOpts(cam, canvas);
    const sh = shakeOffset(now / 1000);
    if (sh[0] || sh[1] || sh[2]) {
        view.position = [view.position[0] + sh[0], view.position[1] + sh[1], view.position[2] + sh[2]];
    }
    scene.setCamera(view);

    fpsAccum += now - fpsLast;
    fpsLast = now;
    if (++fpsFrames >= 20) {
        setFps(1000 / (fpsAccum / fpsFrames));
        fpsAccum = 0; fpsFrames = 0;
        refreshCount();
        refreshRagdollHud();
        refreshChunk3Hud();
    }

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Camera focus -----------------------------------------------------------
//
// The world is 60 m wide across three bays, and hunting for the crane with a
// mouse orbit is nobody's idea of a demo. Each bay gets a button.

// Yaw matters more than it looks. The orbit camera sits at pivot + rot*(0,0,d),
// so yaw 0 puts the eye on the pivot's +Z side. The machine yard is at z=-18
// with the whole sandbox between it and +Z — viewed from the front the crane is
// behind a translucent water tank and a gravity well. Viewing the yard from
// BEHIND (yaw ~ pi) puts empty space at its back instead. The bridge at z=+18
// has the opposite geometry and keeps a near-zero yaw.
export const VIEWS = {
    sandbox:  { pivot: [2, 2, 0],     dist: 46, yaw: -0.55,             pitch: -0.42 },
    machines: { pivot: [-6, 3.5, -18], dist: 24, yaw: Math.PI - 0.40,   pitch: -0.34 },
    bench:    { pivot: [20, 3, -18],  dist: 15, yaw: Math.PI - 0.30,    pitch: -0.30 },
    bridge:   { pivot: [0, 4.5, 18],  dist: 24, yaw:  0.30,             pitch: -0.22 },
};

export function focusView(name) {
    const v = VIEWS[name];
    if (!v) return false;
    cam.rot = Camera.quatMul(
        Camera.quatFromAxis(0, 1, 0, v.yaw),
        Camera.quatFromAxis(1, 0, 0, v.pitch));
    Camera.orbitReframe(cam, v.pivot, v.dist);
    return true;
}

export { scene, cam, canvas, world, stage, state };
export { bodies, spawn, rain, materialRace, clearAll, despawn, bodyCount, spawnCurrent, dropOne };
export { select, refreshCount } from "/app/hud.js";
export { setStepRate, setInterpolation, setSelectedProp, setCombine, refreshSelection } from "/app/hud.js";
export { areas, setAreaEnabled, setAreaParam, getArea, AREA_DEFS } from "/app/areas.js";
export {
    ragdolls, ragdollCount, totalPartCount, spawnRagdoll, ragdollRain, driveRagdoll,
    stopDrive, poseError, jointResidual, punchPart, selectPart, selection, findPart, despawnRagdoll,
    clearRagdolls, updateRagdolls, buildPose, PARTS, PART_NAMES, POSES, POSE_NAMES,
} from "/app/ragdoll.js";
export {
    softBodies, buildCloth, buildBall, setBallPressure, setPinSet, getCloth, getBall,
    gust, poke, regionCentroid, regionRadius, meanHeight, pinIndices, togglePin, updateSoftBodies,
    clearSoftBodies, destroySoft, CLOTH, BALL, PIN_SETS,
} from "/app/softbody.js";
export {
    dropRagdoll, dropRagdollRain, selectRagdollPart, punchSelected, driveSelected,
    limpSelected, refreshRagdollHud, setClothPins, dropOntoCloth, gustCloth,
    setPressure, dropBall, pokeBall,
} from "/app/hud.js";
export { LAYER_NAMES, SPAWN_LAYERS, LAYER_COLORS, setPair, togglePair, collides, getMatrix, resetLayers } from "/app/layers.js";
export {
    machines, mechanisms, machineDebris, AXIS_NAMES, AXIS_MODES, modeOf,
    setAxisMode, setMotor, setMotorTarget, rebuildConstraint, machineOffset,
    setCollideConnected, getCollideConnected, collideSeparation,
    setGearDrive, setGearRatio, resetGears, setRackDrive, rackOffset, resetRack, resetPulley,
    resetMachines,
    fireTurret, craneLoad, loadPiston, spawnDebris, clearMachineDebris,
    setShowAxes, setShowAllAxes, setTurretTracking, updateMachines, YARD_Z,
} from "/app/machines.js";
export {
    BRIDGE, bridge, buildBridge, rebuildBridge, destroyBridge, setThreshold,
    noteBroken, brokenCount, jointCount, dropWreckingBall, fireProjectile,
    rubble, clearRubble,
} from "/app/breakables.js";
export {
    state as contactState, recent as contactLog, consume as consumeContacts,
    setFocus as setContactFocus, getFocus as getContactFocus,
    shakeOffset, clearContacts, updateContacts,
} from "/app/contacts.js";
export {
    setAxis, driveMotor, setBreakThreshold, smashBridge, shootBridge,
    setContactsEnabled, setContactDraw, setContactEffects, setContactDrawAll,
    setContactThreshold, refreshChunk3Hud,
} from "/app/hud.js";
