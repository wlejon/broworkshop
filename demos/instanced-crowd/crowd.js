// Instanced Crowd — thousands of agents, one InstancedMeshNode.
//
//   patterns.js   five motion patterns + the colour schemes
//   instances.js  particle arrays, agent meshes, the per-frame setInstances()
//   crowd.js      (this) viewport, lights, HUD, mouse field, frame loop
//
// Tests import this module; main.js is only the page entry.

import { boot } from "/lib/kit/app.js";
import { $ } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { segmented, fpsMeter } from "/lib/kit/ui.js";
import { sceneViewport, orbitRotation, Camera } from "/lib/kit/viewport3d.js";
import { Crowd, MESHES } from "./instances.js";
import { stepPattern, PATTERNS, COLOR_SCHEMES } from "./patterns.js";

const { status } = boot();

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 0, 0], rot: orbitRotation(-0.45, -0.32), dist: 55, fov: 50, near: 0.1, far: 500 },
    controls: { minDist: 5, maxDist: 250 },
});
export const { scene, cam, canvas } = vp;

scene.setAmbient([0.06, 0.08, 0.12]);
scene.setToneMap({ mode: 'aces', exposure: 1.15 });
scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.3], color: [1.0, 0.98, 0.92],
    intensity: 2.5, castsShadow: true, name: 'sun' });
scene.createLight({ type: 'directional', direction: [0.5, 0.6, 0.6], color: [0.35, 0.65, 0.95],
    intensity: 1.2, name: 'rim' });
scene.createLight({ type: 'directional', direction: [0.0, 1.0, 0.0], color: [0.5, 0.25, 0.4],
    intensity: 0.5, name: 'bounce' });

// A reference ring below the swarm and a pulsing core at its centre.
scene.createMesh({ mesh: 'torus', majorRadius: 30, minorRadius: 0.15, majorSegments: 64, minorSegments: 16,
    color: '#1a2638', emissive: 0.2, emissiveColor: '#00f2fe', y: -16.0 });
const core = scene.createMesh({ mesh: 'sphere', radius: 1.2, segments: 24, rings: 16,
    color: '#00f2fe', emissive: 0.8, emissiveColor: '#00f2fe', roughness: 0.1 });

// The attractor marker: shown only while the field is live.
const marker = scene.createMesh({ mesh: 'sphere', radius: 0.6, segments: 16, rings: 12,
    color: '#ffffff', emissive: 3.0, emissiveColor: '#ff4fd8', roughness: 1 });
marker.visible = false;

// --- state -----------------------------------------------------------------------

export const config = {
    pattern: 'swarming', colorScheme: 'cyberpunk', meshType: 'arrow',
    speed: 1.0, scale: 1.0, spread: 1.0, mouseMode: 'attract',
    orientToVelocity: true, noise: true, autoOrbit: false,
    paused: false,
};

export const crowd = new Crowd(scene, 10000, config.meshType);

/** The mouse field: a world point while the left button drags, else null. */
export const field = { point: null };

// --- HUD ---------------------------------------------------------------------------

const countBar = segmented('#counts', [[1000, '1k'], [5000, '5k'], [10000, '10k'], [25000, '25k']], {
    value: 10000, small: false, onChange: (n) => setCount(n),
});

export const panel = params('#params', config, {
    pattern:          { label: 'motion', options: PATTERNS },
    colorScheme:      { label: 'colour', options: COLOR_SCHEMES },
    meshType:         { label: 'mesh', options: MESHES },
    speed:            { min: 0.1, max: 3.0, step: 0.05, fmt: (v) => v.toFixed(2) + 'x' },
    scale:            { min: 0.2, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) + 'x' },
    spread:           { min: 0.5, max: 3.0, step: 0.1, fmt: (v) => v.toFixed(1) + 'x' },
    mouseMode:        { label: 'mouse field', options: { attract: 'attract', repel: 'repel', off: 'off (passive)' } },
    orientToVelocity: { label: 'orient', hint: 'point each agent along its velocity' },
    noise:            { label: 'turbulence', hint: 'noise jitter on the swarm' },
    autoOrbit:        { label: 'auto-orbit', hint: 'slowly orbit the camera' },
}, {
    onChange: (key, v) => { if (key === 'meshType') crowd.setMeshType(v); },
});

export function setCount(n) {
    crowd.setCount(n);
    countBar.value = n;
    $('#instances').textContent = n.toLocaleString();
}

export function setPaused(on) {
    config.paused = !!on;
    status.set(config.paused ? 'paused (Space resumes)' : 'running');
}

$('#instances').textContent = crowd.count.toLocaleString();
setPaused(false);

// --- input -------------------------------------------------------------------------
//
// Left-drag moves the field over the horizontal plane through the orbit pivot
// (or 40 units down the ray when that plane is edge-on / behind the eye).

export function fieldAt(lx, ly) {
    const { origin: o, dir: d } = vp.ray(lx, ly);
    const y = cam.pivot[1];
    if (Math.abs(d[1]) > 1e-4) {
        const t = (y - o[1]) / d[1];
        if (t > 0 && t < 300) return [o[0] + d[0] * t, y, o[2] + d[2] * t];
    }
    return [o[0] + d[0] * 40, o[1] + d[1] * 40, o[2] + d[2] * 40];
}

let dragging = false;
const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    field.point = fieldAt(...local(e));
});
document.addEventListener('mousemove', (e) => { if (dragging) field.point = fieldAt(...local(e)); });
document.addEventListener('mouseup', (e) => { if (e.button === 0) { dragging = false; field.point = null; } });

document.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName || '')) return;
    if (e.key === ' ') { e.preventDefault(); setPaused(!config.paused); }
    else if (e.key === 'r' || e.key === 'R') vp.reframe([0, 0, 0], 55);
});

// --- frame loop ----------------------------------------------------------------------

const fps = fpsMeter();
let simTime = 0, frameNo = 0, msAccum = 0;

vp.onFrame((dt) => {
    const f = fps.tick();
    msAccum += dt;
    const live = field.point && config.mouseMode !== 'off';
    marker.visible = !!live;
    if (live) { marker.x = field.point[0]; marker.y = field.point[1]; marker.z = field.point[2]; }

    if (!config.paused) {
        simTime += dt * config.speed;
        if (config.autoOrbit) Camera.orbitLook(cam, 48 * dt, 0);
        stepPattern(crowd.particles, dt, simTime, config, live ? field.point : null);
        const s = 1.0 + 0.25 * Math.sin(simTime * 4.0);
        core.scale = [s, s, s];
        crowd.upload(config.scale, config.colorScheme, config.orientToVelocity);
    }

    if (++frameNo % 20 === 0) {
        $('#fps').textContent = f ? f.toFixed(0) : '—';
        $('#fps').className = f >= 55 ? 'ok' : f >= 30 ? 'warn' : 'err';
        $('#frameMs').textContent = (msAccum / 20 * 1000).toFixed(1) + ' ms';
        msAccum = 0;
        // Nodes the renderer drew last frame: the crowd is ONE of them at any size.
        const c = scene.cullStats();
        if (c) $('#draws').textContent = `${c.instancedDrawn} inst + ${c.meshDrawn} mesh`;
    }
});
