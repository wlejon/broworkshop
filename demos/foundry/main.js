// demos/foundry/main.js — Precision Mechanical Engineering CAD Workbench & Box3D Proving Ground.
// Features code-compiled procedural PBR machined metals, true 20° involute gear trains,
// multi-part orbiting ball bearings, gusseted Warren steel trusses, exploded cutaway view,
// and live mouse-aimed Box3D proving ground.

import { boot } from "/lib/kit/app.js";
import { sceneViewport, orbitRotation, localPoint, Camera } from "/lib/kit/viewport3d.js";
import { pickRay } from "/lib/kit/dynamics3d.js";
import { skyEnvironment, sunDirection } from "/lib/kit/sky.js";
import { fixedStep, fpsMeter } from "/lib/kit/ui.js";
import { getCadMaterial } from "/lib/cad/materials.js";
import { chamferedBox } from "/lib/cad/geom.js";
import { CAD_CATALOG, buildCadAssembly } from "/lib/cad/assemblies.js";
import { createProvingGround } from "/lib/cad/proving.js";

boot();

const $ = (id) => document.getElementById(id);
const HERO_YAW = 0.48;
const HERO_PITCH = -0.26;

const vp = sceneViewport('#stage', {
    orbit: { target: [0, 1.15, 0], dist: 5.4, fov: 40, near: 0.15, far: 900, rot: orbitRotation(HERO_YAW, HERO_PITCH) },
    controls: { minDist: 1.4, maxDist: 120 },
});
const scene = vp.scene;

scene.setToneMap({ mode: 'aces' });
scene.setShadowQuality({ pcfTaps: 5 });
scene.setSSAO({ enabled: true, radius: 0.45, intensity: 1.15, bias: 0.012 });
scene.setBloom({ threshold: 1.25, intensity: 0.18, radius: 0.65, iterations: 4 });

const sun = scene.createLight({ type: 'directional', direction: sunDirection(46, 315), color: [1.0, 0.96, 0.90], intensity: 3.8 });
sun.castsShadow = true;
const rim = scene.createLight({ type: 'directional', direction: sunDirection(26, 138), color: [0.55, 0.78, 1.0], intensity: 1.55 });
const fillLamp = scene.createLight({ type: 'point', position: [-4.5, 5.2, 4.8], color: [1.0, 0.92, 0.80], intensity: 24, range: 28 });

const MOODS = {
    studio: {
        bg: '#10151d', hdri: 'kloppenheim_06_puresky', envInt: 0.44, envRot: 1.2,
        sunDir: sunDirection(46, 315), sunCol: [1.0, 0.96, 0.90], sunInt: 3.8,
        rimDir: sunDirection(26, 138), rimCol: [0.55, 0.78, 1.0], rimInt: 1.55,
        lampCol: [1.0, 0.92, 0.80], lampInt: 24, ev: 0.14,
        fog: { mode: 'linear', start: 18, end: 52, color: [0.075, 0.092, 0.118] },
        bounce: [0.12, 0.14, 0.17],
    },
    forge: {
        bg: '#140e0b', hdri: 'belfast_sunset_puresky', envInt: 0.36, envRot: 2.0,
        sunDir: sunDirection(40, 318), sunCol: [1.0, 0.80, 0.52], sunInt: 4.1,
        rimDir: sunDirection(24, 145), rimCol: [0.46, 0.72, 1.0], rimInt: 1.65,
        lampCol: [1.0, 0.68, 0.32], lampInt: 30, ev: 0.12,
        fog: { mode: 'linear', start: 16, end: 46, color: [0.09, 0.06, 0.048] },
        bounce: [0.15, 0.10, 0.06],
    },
    daylight: {
        bg: '#1f2835', hdri: 'kloofendal_43d_clear_puresky', envInt: 0.55, envRot: 1.8,
        sunDir: sunDirection(48, 328), sunCol: [1.0, 0.97, 0.90], sunInt: 4.0,
        rimDir: sunDirection(24, 146), rimCol: [0.62, 0.80, 1.0], rimInt: 1.05,
        lampCol: [1.0, 0.95, 0.88], lampInt: 12, ev: 0.18,
        fog: { mode: 'linear', start: 24, end: 72, color: [0.14, 0.18, 0.24] },
        bounce: [0.16, 0.18, 0.21],
    },
};

let activeMood = 'studio';
function applyStudioLighting(key = activeMood) {
    const m = MOODS[key] || MOODS.studio;
    activeMood = key;
    vp.canvas.style.background = m.bg;
    skyEnvironment(scene, { hdri: m.hdri, intensity: m.envInt, rotation: m.envRot, fallbackAmbient: [0.14, 0.16, 0.20] });
    sun.direction = m.sunDir; sun.color = m.sunCol; sun.intensity = m.sunInt;
    rim.direction = m.rimDir; rim.color = m.rimCol; rim.intensity = m.rimInt;
    fillLamp.color = m.lampCol; fillLamp.intensity = m.lampInt;
    scene.setExposure({ mode: 'fixed', ev: m.ev });
    scene.setFog(m.fog);
    if (typeof scene.setGroundBounce === 'function') scene.setGroundBounce(m.bounce);
}

function applyProvingLighting() {
    vp.canvas.style.background = '#1b222c';
    skyEnvironment(scene, { hdri: 'belfast_sunset_puresky', intensity: 0.50, rotation: 1.7, fallbackAmbient: [0.16, 0.18, 0.22] });
    sun.direction = sunDirection(30, 132); sun.color = [1.0, 0.90, 0.76]; sun.intensity = 4.2;
    rim.direction = sunDirection(22, 308); rim.color = [0.52, 0.72, 0.98]; rim.intensity = 0.90;
    fillLamp.intensity = 0;
    scene.setExposure({ mode: 'fixed', ev: 0.34 });
    scene.setFog({ mode: 'linear', start: 70, end: 220, color: [0.46, 0.50, 0.56] });
    if (typeof scene.setGroundBounce === 'function') scene.setGroundBounce([0.12, 0.13, 0.15]);
}

// Precision machined drafting test bedplate + clean studio cyclorama for CAD Bench mode
const benchStage = [];
function buildBenchStage() {
    const bedMat = getCadMaterial('bedplate_grid');
    const bed = scene.createMesh({ mesh: chamferedBox(3.4, 0.10, 2.8, 0.025), ...bedMat });
    bed.y = -0.10;
    benchStage.push(bed);

    const floor = scene.createMesh({
        mesh: 'plane', halfW: 36, halfD: 36, subdivX: 1, subdivZ: 1,
        color: '#11161e', roughness: 0.88, metallic: 0.10, receivesShadow: true,
    });
    floor.y = -0.205;
    benchStage.push(floor);

    // Clean matte architectural studio cyclorama drum (hides outdoor clouds while preserving full HDRI metal reflections!)
    const cyc = bro.mesh.Mesh.cylinder(22, 14, 48);
    cyc.flipFaces();
    cyc.computeNormals();
    const cycNode = scene.createMesh({
        mesh: cyc, color: '#141a23', roughness: 0.96, metallic: 0.02, castsShadow: false, receivesShadow: false,
    });
    cycNode.y = 12;
    benchStage.push(cycNode);

    // Subtle brass scale trim bars framing the test bedplate
    const brassMat = getCadMaterial('turned_brass');
    for (const sz of [-2.82, 2.82]) {
        const trim = scene.createMesh({ mesh: chamferedBox(3.42, 0.018, 0.022, 0.004), ...brassMat });
        trim.y = -0.008; trim.z = sz;
        benchStage.push(trim);
    }
}
function setBenchVisible(on) {
    for (const n of benchStage) n.visible = on;
    if (benchAsm) {
        for (const it of benchAsm.builder.items) it.node.visible = on;
    }
}

buildBenchStage();
applyStudioLighting('studio');

let mode = 'bench';
let selectedId = CAD_CATALOG[0].id;
let benchAsm = null;
let playing = true;
let rpm = 72;
let explodeAmt = 0;
let showStress = false;
let benchState = { theta: 0, turretYaw: 0, turretPitch: 0.17, recoil: 0, recoilVel: 0, wheelSpin: 0, punch: 0, spades: false, load: 0.55 };

const proving = createProvingGround(scene);
const keys = new Set();
let mouseLocal = null;
let mouseHeld = false;
let rightDragging = false;
let spadeLatch = false;
let camFollow = [0, 1.8, 12];

function refreshCatalogUI() {
    const list = $('assembly-list');
    list.innerHTML = '';
    for (const e of CAD_CATALOG) {
        const btn = document.createElement('button');
        btn.className = 'f-item' + (e.id === selectedId ? ' selected' : '');
        btn.innerHTML = `<span class="name">${e.name}</span><span class="tag">${e.tag}</span>`;
        btn.addEventListener('click', () => loadBenchAssembly(e.id));
        list.appendChild(btn);
    }
}

function loadBenchAssembly(id) {
    selectedId = id;
    if (benchAsm) { benchAsm.destroy(); benchAsm = null; }
    benchAsm = buildCadAssembly(scene, id);
    benchState = { theta: 0, turretYaw: 0, turretPitch: 0.17, recoil: 0, recoilVel: 0, wheelSpin: 0, punch: 0, spades: false, load: 0.55 };
    $('sl-pitch').value = '10';
    $('sl-yaw').value = '0';
    $('val-pitch').textContent = '10° / 0°';
    $('aim-ctrls').style.display = benchAsm.spec.canAim ? 'flex' : 'none';
    benchAsm.setStress(showStress, benchState.load);
    benchAsm.update(benchState, explodeAmt);

    // Populate telemetry card
    $('asm-subtitle').textContent = benchAsm.spec.subtitle;
    $('st-parts').textContent = String(benchAsm.stats.partCount);
    $('st-bolts').textContent = String(benchAsm.stats.boltCount);
    $('st-tris').textContent = benchAsm.stats.triangles.toLocaleString();
    $('st-mass').textContent = `${benchAsm.spec.massKg.toLocaleString()} kg`;

    const spDiv = $('asm-specs');
    spDiv.innerHTML = '';
    for (const row of benchAsm.spec.specs) {
        const el = document.createElement('div');
        el.className = 'f-spec-row';
        el.innerHTML = `<span>${row.k}</span><b>${row.v}</b>`;
        spDiv.appendChild(el);
    }

    refreshCatalogUI();
    if (mode === 'bench') {
        vp.reframe(benchAsm.spec.camTarget, benchAsm.spec.camDist, { yaw: benchAsm.spec.camYaw ?? HERO_YAW, pitch: HERO_PITCH });
        $('status').textContent = `Compiled ${benchAsm.spec.name} — ${benchAsm.stats.partCount} CAD parts · ${benchAsm.stats.boltCount} hex bolts · ${benchAsm.stats.triangles.toLocaleString()} tris`;
    } else {
        launchProving();
    }
}

function launchProving() {
    mode = 'proving';
    document.body.classList.add('proving-mode');
    if (benchAsm) { benchAsm.destroy(); benchAsm = null; }
    setBenchVisible(false);
    applyProvingLighting();
    $('mode-bench').classList.remove('active');
    $('mode-proving').classList.add('active');

    const testId = selectedId === 'compound_gearbox' ? 'truss_howitzer' : selectedId;
    proving.start(testId);
    proving.setStress(showStress);
    spadeLatch = false;
    mouseHeld = false;
    camFollow = [0, 2.8, 12];
    vp.reframe([0, 2.8, 12], 15.5, { yaw: 0.16, pitch: -0.26 });
    const rect = vp.canvas.getBoundingClientRect();
    mouseLocal = [rect.width * 0.5, rect.height * 0.32];
    const ret = $('aim-reticle');
    ret.style.left = `${mouseLocal[0]}px`;
    ret.style.top = `${mouseLocal[1]}px`;
    ret.classList.add('visible');
    vp.canvas.classList.add('aim-cursor');
    $('pt-name').textContent = proving.cad.spec.name;
    $('status').textContent = `Proving Ground live — move mouse to aim, click or Space to fire, WASD to drive`;
}

function enterBench() {
    mode = 'bench';
    document.body.classList.remove('proving-mode');
    proving.cleanup();
    $('aim-reticle').classList.remove('visible');
    vp.canvas.classList.remove('aim-cursor');
    applyStudioLighting(activeMood);
    setBenchVisible(true);
    $('mode-proving').classList.remove('active');
    $('mode-bench').classList.add('active');
    loadBenchAssembly(selectedId);
}

// Wire UI controls
$('mode-bench').addEventListener('click', enterBench);
$('mode-proving').addEventListener('click', launchProving);
$('btn-proving-reset').addEventListener('click', launchProving);

for (const btn of $('mood-tabs').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
        for (const b of $('mood-tabs').querySelectorAll('button')) b.classList.remove('active');
        btn.classList.add('active');
        activeMood = btn.dataset.mood;
        if (mode === 'bench') applyStudioLighting(activeMood);
    });
}

$('sl-rpm').addEventListener('input', (e) => {
    rpm = +e.target.value;
    $('val-rpm').textContent = `${rpm} RPM`;
});
$('sl-explode').addEventListener('input', (e) => {
    explodeAmt = +e.target.value / 100;
    $('val-explode').textContent = `${e.target.value}%`;
});
$('sl-pitch').addEventListener('input', () => {
    benchState.turretPitch = (+$('sl-pitch').value) * Math.PI / 180;
    $('val-pitch').textContent = `${$('sl-pitch').value}° / ${$('sl-yaw').value}°`;
});
$('sl-yaw').addEventListener('input', () => {
    benchState.turretYaw = (+$('sl-yaw').value) * Math.PI / 180;
    $('val-pitch').textContent = `${$('sl-pitch').value}° / ${$('sl-yaw').value}°`;
});
$('btn-play').addEventListener('click', () => {
    playing = !playing;
    $('btn-play').textContent = playing ? 'Pause' : 'Run';
});
$('btn-cycle').addEventListener('click', () => {
    if (benchAsm?.spec.canAim) {
        benchState.recoilVel = 3.6;
        benchState.spades = !benchState.spades;
    } else {
        benchState.theta += 1.2;
        benchState.punch = 1.15;
    }
});
$('chk-stress').addEventListener('change', (e) => {
    showStress = e.target.checked;
    if (benchAsm) benchAsm.setStress(showStress, benchState.load);
    if (proving.active) proving.setStress(showStress);
});

// Mouse & Keyboard handlers for Proving Ground mouse-aiming
vp.canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { rightDragging = true; vp.canvas.classList.remove('aim-cursor'); return; }
    if (e.button === 0 && mode === 'proving') mouseHeld = true;
});
window.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
        rightDragging = false;
        if (mode === 'proving') vp.canvas.classList.add('aim-cursor');
    }
    if (e.button === 0) mouseHeld = false;
});
vp.canvas.addEventListener('mousemove', (e) => {
    if (mode !== 'proving' || rightDragging) return;
    const [px, py] = localPoint(vp.canvas, e);
    mouseLocal = [px, py];
    const ret = $('aim-reticle');
    ret.style.left = `${px}px`;
    ret.style.top = `${py}px`;
    ret.classList.add('visible');
});

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'v') {
        showStress = !showStress;
        $('chk-stress').checked = showStress;
        if (benchAsm) benchAsm.setStress(showStress, benchState.load);
        if (proving.active) proving.setStress(showStress);
    } else if (k === 'r' && mode === 'proving') {
        spadeLatch = !spadeLatch;
    }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// Expose clean hook for headless visual verification & automated proving
window.__foundry = {
    select: (id) => loadBenchAssembly(id),
    setExplode: (v) => { explodeAmt = v; $('sl-explode').value = String(Math.round(v * 100)); $('val-explode').textContent = `${Math.round(v * 100)}%`; },
    setStress: (v) => { showStress = !!v; $('chk-stress').checked = showStress; if (benchAsm) benchAsm.setStress(showStress, benchState.load); },
    setMood: (m) => applyStudioLighting(m),
    enterProving: () => launchProving(),
    enterBench: () => enterBench(),
    setCamera: (target, dist, yaw, pitch) => vp.reframe(target, dist, { yaw, pitch }),
    get stats() { return benchAsm ? benchAsm.stats : proving.cad?.stats; },
    get proving() { return proving; },
};

const fps = fpsMeter();
const stepFixed = fixedStep(1 / 60, 4);
let tickN = 0;

vp.onFrame((dt) => {
    fps.tick();
    if (mode === 'bench' && benchAsm) {
        if (playing) {
            const omega = (rpm * Math.PI * 2) / 60;
            benchState.theta += omega * dt;
            benchState.wheelSpin += omega * 0.28 * dt;
        }
        // Recoil spring recovery on Bench Fire preview
        benchState.recoilVel += (-72 * benchState.recoil - 13 * benchState.recoilVel) * dt;
        benchState.recoil = Math.max(0, Math.min(0.60, benchState.recoil + benchState.recoilVel * dt));
        benchAsm.update(benchState, explodeAmt);
    } else if (mode === 'proving' && proving.active) {
        if (mouseLocal && !rightDragging) {
            const ray = pickRay(vp, mouseLocal[0], mouseLocal[1]);
            if (ray) proving.aimAtRay(ray);
        }
        const throttle = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
        const steer = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
        const fire = keys.has(' ') || mouseHeld;

        let res = null;
        stepFixed(dt, (h) => { res = proving.step(h, { throttle, steer, fire, spades: spadeLatch }); });
        if (res) {
            const k = 1 - Math.exp(-9 * dt);
            camFollow[0] += (res.pos[0] - camFollow[0]) * k;
            camFollow[1] += (res.pos[1] - camFollow[1]) * k;
            camFollow[2] += (res.pos[2] - camFollow[2]) * k;
            const sh = res.shake * 0.25;
            const sx = sh ? Math.sin(tickN * 1.9) * sh : 0;
            const sy = sh ? Math.cos(tickN * 2.5) * sh : 0;
            Camera.orbitReframe(vp.cam, [camFollow[0] + sx, camFollow[1] + sy, camFollow[2]], vp.cam.dist);

            const ret = $('aim-reticle');
            ret.classList.toggle('locked', !!res.aimLocked);
            $('ret-range').textContent = `${Math.round(res.aimRange)}m`;
            $('ret-reload-bar').style.width = `${Math.round(res.reloadFrac * 100)}%`;

            if (++tickN % 6 === 0) {
                $('pt-shots').textContent = String(res.shotsFired);
                $('pt-dmg').textContent = String(res.brokenCells);
                $('pt-step').textContent = res.stepMs.toFixed(2);
            }
        }
    }
    if (++tickN % 15 === 0) {
        $('stat-fps').textContent = fps.fps ? fps.fps.toFixed(0) : '—';
    }
});

loadBenchAssembly(CAD_CATALOG[0].id);
