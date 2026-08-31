// app.js — Main entry point for Instanced Crowd showcase.

import { CrowdManager } from "./instances.js";
import { updateSwarm, updateVortex, updateWave, updateHelix, updatePulsar } from "./patterns.js";
import { CrowdUI } from "./ui.js";

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

if (!scene) {
    console.error('Scene context could not be initialized.');
}

// --- Environment & Lighting Setup ---
scene.setAmbient([0.06, 0.08, 0.12]);
scene.setToneMap({ mode: 'aces', exposure: 1.15 });

// Key Light (Sun)
const sunLight = scene.createLight({
    type: 'directional',
    direction: [-0.4, -1.0, -0.3],
    color: [1.0, 0.98, 0.92],
    intensity: 2.5,
    castsShadow: true,
    name: 'sun'
});

// Cool Rim Fill Light
scene.createLight({
    type: 'directional',
    direction: [0.5, 0.6, 0.6],
    color: [0.35, 0.65, 0.95],
    intensity: 1.2,
    name: 'rim'
});

// Warm Underlight / Bounce
scene.createLight({
    type: 'directional',
    direction: [0.0, 1.0, 0.0],
    color: [0.5, 0.25, 0.4],
    intensity: 0.5,
    name: 'bounce'
});

// Ground reference ring grid
const groundRing = scene.createMesh({
    mesh: Mesh.torus(30.0, 0.15, 64, 16),
    color: '#1a2638',
    emissive: 0.2,
    emissiveColor: '#00f2fe',
    y: -16.0
});

const centerCore = scene.createMesh({
    mesh: Mesh.sphere(1.2, 24, 16),
    color: '#00f2fe',
    emissive: 0.8,
    emissiveColor: '#00f2fe',
    roughness: 0.1
});

// --- Camera Setup ---
const startRot = Camera.quatMul(
    Camera.quatFromAxis(0, 1, 0, -0.45),
    Camera.quatFromAxis(1, 0, 0, -0.32)
);

const cam = Camera.createOrbit({
    target: [0, 0, 0],
    rot: startRot,
    dist: 55,
    fov: 50,
    near: 0.1,
    far: 500
});

// --- Crowd & UI Manager ---
const crowd = new CrowdManager(scene, 10000, 'arrow');
const ui = new CrowdUI(canvas, scene, cam, crowd);

// --- Animation Loop ---
let lastTime = performance.now();
let simTime = 0;

function frame(now) {
    const rawDt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    if (!ui.config.paused) {
        const dt = rawDt;
        simTime += dt * ui.config.speed;

        // Auto-orbit camera if enabled
        if (ui.config.autoOrbit && typeof Camera !== 'undefined' && Camera.orbitLook) {
            Camera.orbitLook(cam, 0.8, 0);
        }

        // 1. Update pattern coordinates
        switch (ui.config.pattern) {
            case 'vortex':
                updateVortex(crowd.particles, dt, simTime, ui.config, ui.mouse3D);
                break;
            case 'wave':
                updateWave(crowd.particles, dt, simTime, ui.config, ui.mouse3D);
                break;
            case 'helix':
                updateHelix(crowd.particles, dt, simTime, ui.config, ui.mouse3D);
                break;
            case 'pulsar':
                updatePulsar(crowd.particles, dt, simTime, ui.config, ui.mouse3D);
                break;
            case 'swarming':
            default:
                updateSwarm(crowd.particles, dt, simTime, ui.config, ui.mouse3D);
                break;
        }

        // 2. Pulse center core visual
        if (centerCore) {
            const coreScale = 1.0 + 0.25 * Math.sin(simTime * 4.0);
            centerCore.scale = [coreScale, coreScale, coreScale];
        }

        // 3. Upload instances buffer to GPU
        crowd.updateBuffers(ui.config, ui.config.colorScheme, ui.config.orientToVelocity);
    }

    // Camera view submission
    if (typeof Camera !== 'undefined' && Camera.orbitViewOpts) {
        scene.setCamera(Camera.orbitViewOpts(cam, canvas));
    }

    // Performance metrics
    ui.updateMetrics(now);

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export { scene, cam, crowd, ui };
