// app.js — Main entry point for Mechanical Sandbox laboratory.

import {
    buildClockworkPendulum, buildGearboxAndPulley, buildPistonAndCrankshaft,
    buildNewtonsCradle, buildSuspensionBridge, dropHeavyLoad, nudgeMachine,
    updateContraptions, activeBodies, activeConstraints, brokenConstraintCount,
    currentMachineType
} from "./contraptions.js";
import { PhysicsInteraction } from "./interaction.js";

// --- Physics Engine Initialization ---
if (typeof Physics !== 'undefined') {
    Physics.createWorld({ maxBodies: 1024 });
    Physics.setGravity(0, -9.81, 0);
}

// --- Canvas & Scene Graph Setup ---
const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

scene.setAmbient([0.08, 0.10, 0.14]);
scene.setToneMap({ mode: 'aces', exposure: 1.1 });

// Key Studio Light with Shadows
const sun = scene.createLight({
    type: 'directional',
    direction: [-0.5, -1.0, -0.4],
    color: [1.0, 0.96, 0.90],
    intensity: 2.8,
    castsShadow: true,
    name: 'sun'
});

// Cool Fill Light
scene.createLight({
    type: 'directional',
    direction: [0.6, -0.5, 0.5],
    color: [0.4, 0.65, 0.95],
    intensity: 1.2,
    name: 'fill'
});

// Warm Rim Light
scene.createLight({
    type: 'directional',
    direction: [0.0, -0.8, -0.8],
    color: [0.95, 0.65, 0.4],
    intensity: 0.8,
    name: 'rim'
});

// Studio Ground Stage
const floor = scene.createMesh({
    mesh: Mesh.cylinder(25.0, 0.2, 32),
    color: '#0e131d',
    roughness: 0.7,
    metalness: 0.3,
    y: -0.1
});

// Grid Ring Accent
scene.createMesh({
    mesh: Mesh.torus(25.0, 0.1, 64, 16),
    color: '#1e293b',
    emissive: 0.3,
    emissiveColor: '#e65c00',
    y: 0.0
});

// Physics Floor Plane
const floorBody = Physics.createBody({
    shape: 'box',
    static: true,
    position: { x: 0, y: -0.5, z: 0 },
    halfExtents: { x: 50, y: 0.5, z: 50 }
});

// --- Camera Setup ---
const startRot = Camera.quatMul(
    Camera.quatFromAxis(0, 1, 0, -0.4),
    Camera.quatFromAxis(1, 0, 0, -0.25)
);

const cam = Camera.createOrbit({
    target: [0, 3.5, 0],
    rot: startRot,
    dist: 16,
    fov: 45,
    near: 0.1,
    far: 250
});

// --- Interaction Handler ---
const interaction = new PhysicsInteraction(canvas, scene, cam);

// --- State and UI Management ---
const state = {
    motorSpeed: 1.0,
    gravity: 9.8,
    restitution: 0.99,
    breakingImpulse: 1200,
    paused: false
};

const MACHINE_INFO = {
    pendulum: {
        title: 'Clockwork Pendulum',
        desc: 'High-inertia compound pendulum with harmonic oscillation and escapement gear.',
        target: [0, 4.5, 0],
        dist: 15
    },
    gearbox: {
        title: 'Gearbox & Pulley',
        desc: 'Multi-stage gear train coupled to an overhead cable pulley lifting cargo against counterweights.',
        target: [1.0, 3.8, 0],
        dist: 16
    },
    piston: {
        title: 'Piston & Crankshaft',
        desc: 'Internal combustion engine mechanism: rotating crank converting angular momentum to reciprocating linear slider motion.',
        target: [0, 3.2, 0],
        dist: 12
    },
    cradle: {
        title: "Newton's Cradle",
        desc: 'Precision V-cable suspended elastic collision demonstration conserving momentum & kinetic energy.',
        target: [0, 3.5, 0],
        dist: 13
    },
    bridge: {
        title: 'Suspension Bridge',
        desc: 'Articulated deck planks suspended with catenary cables. Joint breaking stress test under extreme load.',
        target: [0, 3.0, 0],
        dist: 18
    }
};

function switchContraption(type) {
    const info = MACHINE_INFO[type];
    if (!info) return;

    document.getElementById('machine-title').textContent = info.title;
    document.getElementById('machine-desc').textContent = info.desc;

    // Adjust camera target
    Camera.orbitReframe(cam, info.target, info.dist);

    // Toggle specific controls
    const restRow = document.getElementById('restitution-row');
    const breakRow = document.getElementById('break-row');
    const motorRow = document.getElementById('motor-row');

    if (restRow) restRow.style.display = type === 'cradle' ? 'flex' : 'none';
    if (breakRow) breakRow.style.display = type === 'bridge' ? 'flex' : 'none';
    if (motorRow) motorRow.style.display = (type === 'pendulum' || type === 'gearbox' || type === 'piston') ? 'flex' : 'none';

    switch (type) {
        case 'gearbox':
            buildGearboxAndPulley(scene, state);
            break;
        case 'piston':
            buildPistonAndCrankshaft(scene, state);
            break;
        case 'cradle':
            buildNewtonsCradle(scene, state);
            break;
        case 'bridge':
            buildSuspensionBridge(scene, state);
            break;
        case 'pendulum':
        default:
            buildClockworkPendulum(scene, state);
            break;
    }
}

// Bind DOM UI
function bindUI() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            switchContraption(tab.dataset.type);
        });
    });

    const motorSl = document.getElementById('motor-slider');
    const motorVal = document.getElementById('motor-val');
    if (motorSl) {
        motorSl.addEventListener('input', (e) => {
            state.motorSpeed = parseFloat(e.target.value);
            if (motorVal) motorVal.textContent = state.motorSpeed.toFixed(1) + 'x';
            // Update active motor constraints if any
            for (const c of activeConstraints) {
                Physics.setConstraintMotor(c, { type: 'velocity', target: state.motorSpeed * 3.0, maxTorque: 5000 });
            }
        });
    }

    const gravSl = document.getElementById('gravity-slider');
    const gravVal = document.getElementById('gravity-val');
    if (gravSl) {
        gravSl.addEventListener('input', (e) => {
            state.gravity = parseFloat(e.target.value);
            if (gravVal) gravVal.textContent = state.gravity.toFixed(1) + ' m/s²';
            Physics.setGravity(0, -state.gravity, 0);
        });
    }

    const restSl = document.getElementById('restitution-slider');
    const restVal = document.getElementById('restitution-val');
    if (restSl) {
        restSl.addEventListener('input', (e) => {
            state.restitution = parseFloat(e.target.value);
            if (restVal) restVal.textContent = state.restitution.toFixed(2);
            for (const b of activeBodies) {
                Physics.setRestitution(b.tag, state.restitution);
            }
        });
    }

    const breakSl = document.getElementById('break-slider');
    const breakVal = document.getElementById('break-val');
    if (breakSl) {
        breakSl.addEventListener('input', (e) => {
            state.breakingImpulse = parseFloat(e.target.value);
            if (breakVal) breakVal.textContent = state.breakingImpulse + ' N';
        });
    }

    document.getElementById('btn-reset')?.addEventListener('click', () => {
        switchContraption(currentMachineType);
    });

    document.getElementById('btn-nudge')?.addEventListener('click', () => {
        nudgeMachine({ x: 0, y: 0, z: 250 });
    });

    document.getElementById('btn-drop')?.addEventListener('click', () => {
        const dropX = currentMachineType === 'bridge' ? 0 : 0.5;
        const dropZ = currentMachineType === 'bridge' ? 0 : 0.5;
        dropHeavyLoad(scene, dropX, 8.0, dropZ, 100.0);
    });

    document.getElementById('btn-reverse')?.addEventListener('click', () => {
        state.motorSpeed = -state.motorSpeed;
        if (motorSl) motorSl.value = state.motorSpeed;
        if (motorVal) motorVal.textContent = state.motorSpeed.toFixed(1) + 'x';
        for (const c of activeConstraints) {
            Physics.setConstraintMotor(c, { type: 'velocity', target: state.motorSpeed * 3.0, maxTorque: 5000 });
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            state.paused = !state.paused;
        } else if (e.key === 'r' || e.key === 'R') {
            switchContraption(currentMachineType);
        }
    });
}

bindUI();
switchContraption('pendulum');

// --- Render & Physics Step Loop ---
let lastTime = performance.now();
let fpsAccum = 0, fpsFrames = 0, fpsLast = performance.now();

function frame(now) {
    const rawDt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    const dt = 1 / 60;

    if (!state.paused) {
        interaction.update(dt);
        updateContraptions(dt);
    }

    // Camera view submission
    if (typeof Camera !== 'undefined' && Camera.orbitViewOpts) {
        scene.setCamera(Camera.orbitViewOpts(cam, canvas));
    }

    // Update metrics HUD
    fpsAccum += now - fpsLast;
    fpsLast = now;
    fpsFrames++;
    if (fpsFrames >= 20) {
        const fps = Math.round(1000 / (fpsAccum / fpsFrames));
        document.getElementById('metric-fps').textContent = fps + ' FPS';
        document.getElementById('metric-bodies').textContent = activeBodies.length;
        document.getElementById('metric-constraints').textContent = activeConstraints.length;
        document.getElementById('metric-broken').textContent = brokenConstraintCount;
        fpsAccum = 0;
        fpsFrames = 0;
    }

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export { scene, cam, state, switchContraption };
