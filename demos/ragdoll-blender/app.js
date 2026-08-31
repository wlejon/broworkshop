// app.js — Main entry point for Ragdoll Blender demo.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { CharacterController } from "./character.js";
import { RagdollInstance } from "./ragdoll.js";
import { RagdollBlender, BLEND_STATE } from "./blender.js";
import { CannonSystem } from "./cannons.js";

installSystemMenu();

const canvas = document.getElementById('stage');
let scene = null;
try {
    scene = canvas.getContext('scene');
} catch (_) {
    scene = null;
}

// --- Orbit Camera Setup ---
const cam = Camera.createOrbit({
    target: [0, 1.1, 0],
    dist: 5.5,
    pitch: 15,
    yaw: 25,
    fov: 45,
    near: 0.1,
    far: 100
});

// --- 3D Scene Environment & Lighting Setup ---
if (scene) {
    scene.setAmbient([0.08, 0.10, 0.14]);
    scene.setToneMap({ mode: 'aces', exposure: 1.1 });

    // Key Sun Light with shadows
    scene.createLight({
        type: 'directional',
        direction: [-0.5, -1.0, -0.4],
        color: [1.0, 0.96, 0.90],
        intensity: 2.2,
        castsShadow: true
    });

    // Cool Rim Light
    scene.createLight({
        type: 'directional',
        direction: [0.6, 0.4, 0.5],
        color: [0.3, 0.6, 0.95],
        intensity: 1.1
    });

    // Floor Ground Plane Grid
    try {
        if (typeof Mesh !== 'undefined' && Mesh.plane) {
            scene.createMesh({
                mesh: Mesh.plane(30, 30),
                color: '#141c2b',
                roughness: 0.85,
                y: 0
            });
        }
    } catch (_) {}
}

// Fallback 2D Canvas Context for non-WebGL/headless environments
const ctx = scene ? null : canvas.getContext('2d');

// --- Instantiate Character, Ragdoll, Blender & Cannon Systems ---
const character = new CharacterController();
const initialPose = character.computeBoneTransforms();
const ragdoll = new RagdollInstance(scene, initialPose, { frequency: 12, damping: 1.2 });
const blender = new RagdollBlender(character, ragdoll);
const cannons = new CannonSystem(scene, blender);

// Position cannon off to the side aiming at torso
cannons.setMuzzlePos(-5.5, 1.8, 0.0);
cannons.setTargetPos(0.0, 1.4, 0.0);

// --- UI Controls Wiring ---
// Animation buttons
document.querySelectorAll('[data-anim]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-anim]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        character.setAnimation(btn.dataset.anim);
        if (blender.state !== BLEND_STATE.ANIMATED) {
            blender.resetToStand({ x: 0, y: 0, z: 0 }, btn.dataset.anim);
        }
    });
});

// Action buttons
const btnCannon = document.getElementById('btn-cannon');
const btnRagdoll = document.getElementById('btn-ragdoll');
const btnGetUp = document.getElementById('btn-getup');
const btnResetStand = document.getElementById('btn-reset-stand');
const btnToggleCam = document.getElementById('btn-toggle-cam');

btnCannon.addEventListener('click', () => {
    cannons.shoot();
});

btnRagdoll.addEventListener('click', () => {
    blender.triggerRagdoll(2, { x: 35, y: 20, z: 0 }); // Punch chest
});

btnGetUp.addEventListener('click', () => {
    blender.triggerGetUp();
});

btnResetStand.addEventListener('click', () => {
    blender.resetToStand({ x: 0, y: 0, z: 0 }, character.currentAnim);
});

btnToggleCam.addEventListener('click', () => {
    cam.target = [0, 1.1, 0];
    cam.dist = 5.5;
    cam.pitch = 15;
    cam.yaw = 25;
});

// Sliders
const sliderStiffness = document.getElementById('slider-stiffness');
const motorStiffVal = document.getElementById('motor-stiff-val');
sliderStiffness.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    motorStiffVal.textContent = `${val} Hz`;
    ragdoll.setMotorStiffness(val);
});

const sliderCannonSpd = document.getElementById('slider-cannon-spd');
const cannonSpdVal = document.getElementById('cannon-spd-val');
sliderCannonSpd.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    cannonSpdVal.textContent = `${val} m/s`;
    cannons.projectileSpeed = val;
});

// Telemetry & Badge elements
const stateBadge = document.getElementById('state-badge');
const blendWeightVal = document.getElementById('blend-weight-val');
const blendMeterFill = document.getElementById('blend-meter-fill');
const statFps = document.getElementById('stat-fps');
const statPelvisY = document.getElementById('stat-pelvis-y');
const statKe = document.getElementById('stat-ke');
const statRest = document.getElementById('stat-rest');

let lastTime = performance.now();
let frameCount = 0;
let fpsTimer = 0;

// Camera perspective 3D to 2D projection helper for Canvas 2D fallback
function project3D(x, y, z, width, height) {
    const cy = Math.cos((cam.yaw * Math.PI) / 180);
    const sy = Math.sin((cam.yaw * Math.PI) / 180);
    const cp = Math.cos((cam.pitch * Math.PI) / 180);
    const sp = Math.sin((cam.pitch * Math.PI) / 180);

    const relX = x - cam.target[0];
    const relY = y - cam.target[1];
    const relZ = z - cam.target[2];

    const rx = relX * cy - relZ * sy;
    const rz = relX * sy + relZ * cy;
    const ry = relY * cp - rz * sp;
    const depth = relY * sp + rz * cp + cam.dist;

    const fovScale = 750 / Math.max(0.1, depth);
    return {
        x: width / 2 + rx * fovScale,
        y: height / 2 - ry * fovScale,
        depth
    };
}

// --- Main Simulation & Render Loop ---
function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    // FPS Meter
    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
        statFps.textContent = Math.round(frameCount / fpsTimer);
        frameCount = 0;
        fpsTimer = 0;
    }

    // 1. Update Core Ragdoll & Cannon Systems
    blender.update(dt);
    cannons.update(dt);

    // 2. Update HUD Telemetry
    const wPct = Math.round(blender.blendWeight * 100);
    blendMeterFill.style.width = `${wPct}%`;
    blendWeightVal.textContent = `${wPct} % (${blender.blendWeight > 0.5 ? 'Ragdoll' : 'Kinematic'})`;

    // State Badge
    stateBadge.textContent = blender.state;
    stateBadge.className = 'badge';
    if (blender.state === BLEND_STATE.ANIMATED) stateBadge.classList.add('animated');
    else if (blender.state === BLEND_STATE.RAGDOLL || blender.state === BLEND_STATE.IMPACT) stateBadge.classList.add('ragdoll');
    else if (blender.state === BLEND_STATE.SETTLING) stateBadge.classList.add('settling');
    else if (blender.state === BLEND_STATE.GETTING_UP) stateBadge.classList.add('getting_up');

    // Pelvis Height & Kinetic Energy
    const pelvis = blender.blendedTransforms[0];
    statPelvisY.textContent = `${pelvis.position.y.toFixed(2)} m`;
    const ke = ragdoll.getKineticEnergy();
    statKe.textContent = `${ke.toFixed(1)} J`;

    if (blender.state === BLEND_STATE.ANIMATED) statRest.textContent = 'Active';
    else if (blender.state === BLEND_STATE.SETTLING) statRest.textContent = blender.isProne ? 'Prone (Stomach)' : 'Supine (Back)';
    else if (blender.state === BLEND_STATE.GETTING_UP) statRest.textContent = 'Recovering';
    else statRest.textContent = 'Tumbling';

    // 3. Fallback Canvas 2D Rendering if WebGL scene is not available
    if (ctx) {
        ctx.fillStyle = '#0d111a';
        ctx.fillRect(0, 0, 1280, 720);

        // Draw 3D Ground Grid
        ctx.strokeStyle = '#1a2333';
        ctx.lineWidth = 1;
        for (let i = -6; i <= 6; i++) {
            const p1 = project3D(i * 1.5, 0, -9, 1280, 720);
            const p2 = project3D(i * 1.5, 0, 9, 1280, 720);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();

            const p3 = project3D(-9, 0, i * 1.5, 1280, 720);
            const p4 = project3D(9, 0, i * 1.5, 1280, 720);
            ctx.beginPath();
            ctx.moveTo(p3.x, p3.y);
            ctx.lineTo(p4.x, p4.y);
            ctx.stroke();
        }

        // Draw Cannon Muzzle & Trajectory
        const traj = cannons.getTrajectoryPoints(30);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        traj.forEach((pt, idx) => {
            const p = project3D(pt.x, pt.y, pt.z, 1280, 720);
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Cannon Barrel
        const muz = project3D(cannons.muzzlePos.x, cannons.muzzlePos.y, cannons.muzzlePos.z, 1280, 720);
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.arc(muz.x, muz.y, 8, 0, Math.PI * 2);
        ctx.fill();

        // Draw Live Flying Cannonballs
        for (const ball of cannons.cannonballs) {
            const p = project3D(ball.x, ball.y, ball.z, 1280, 720);
            ctx.fillStyle = '#222834';
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(3, ball.radius * 60), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // Draw Character Limbs
        const limbs = blender.blendedTransforms;
        for (const limb of limbs) {
            const p = project3D(limb.position.x, limb.position.y, limb.position.z, 1280, 720);
            const r = Math.max(4, limb.radius * 70);

            ctx.fillStyle = limb.name === 'head' ? '#e0a97d' : (limb.name.startsWith('lowerArm') ? '#e0a97d' : '#3a68aa');
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 1.5;

            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // Draw Particles
        for (const pt of cannons.particles) {
            const p = project3D(pt.x, pt.y, pt.z, 1280, 720);
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
