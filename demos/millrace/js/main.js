// js/main.js — Alpine Millrace watermill entry point, scene assembly, camera views & interactive HUD.

import { boot } from '/lib/kit/app.js';
import { sceneViewport, orbitRotation } from '/lib/kit/viewport3d.js';
import { Camera } from '/lib/kit/camera.js';
import { skyEnvironment } from '/lib/kit/sky.js';
import {
  makeGraniteRockPbrSet,
  makeFieldstoneWallPbrSet,
  makeWeatheredOakPbrSet,
  makeCedarShinglePbrSet,
  makePlasterPbrSet,
  makeCastIronPbrSet,
  makeMillstonePbrSet,
  makeTreeBarkPbrSet,
  makeFoliagePbrSet,
  makeTroutPbrSet,
  makeSoftSpriteTex,
} from './pbr_materials.js';
import {
  createSculptedValleyTerrain,
  createMillpondWaterMesh,
  VALLEY_TERRAIN_BK,
  MILLPOND_WATER_BK,
  WATER_STREAM_BK,
} from './terrain_water.js';
import { buildMillhouseArchitecture } from './millhouse_arch.js';
import { buildMillMechanics } from './mill_mechanics.js';
import { buildMillNature } from './mill_nature.js';
import { MillraceController, VIEW_PRESETS, MOOD_PRESETS } from './mill_life.js';

boot();

const hero = VIEW_PRESETS.valley;
const vp = sceneViewport('#stage', {
  orbit: {
    target: hero.target.slice(), dist: hero.dist, fov: hero.fov,
    near: 0.1, far: 140, rot: orbitRotation(hero.yaw, hero.pitch),
  },
  controls: { minDist: 1.4, maxDist: 28 },
});

const { canvas, scene, cam } = vp;
const pickMap = new Map();
const registerPick = (node, meta) => pickMap.set(node, meta);
const add = (opts) => (opts.mesh ? scene.createMesh({ castsShadow: true, receivesShadow: true, ...opts }) : scene.createNode(opts));

// Build procedural PBR material library
const mats = {
  granite: makeGraniteRockPbrSet(),
  fieldstone: makeFieldstoneWallPbrSet(),
  oak: makeWeatheredOakPbrSet(),
  shingles: makeCedarShinglePbrSet(),
  plaster: makePlasterPbrSet(),
  iron: makeCastIronPbrSet(),
  millstone: makeMillstonePbrSet(),
  bark: makeTreeBarkPbrSet(),
  autumnLeaf: makeFoliagePbrSet('autumn'),
  pineNeedle: makeFoliagePbrSet('pine'),
  ivyLeaf: makeFoliagePbrSet('ivy'),
  fern: makeFoliagePbrSet('fern'),
  trout: makeTroutPbrSet(),
  sprite: makeSoftSpriteTex(64),
};

skyEnvironment(scene, { hdri: 'kloofendal_43d_clear_puresky', intensity: 0.52, rotation: 0.5 });
scene.setGroundBounce([0.11, 0.14, 0.08]);
scene.setSSAO({ radius: 0.42, bias: 0.02, intensity: 1.0 });
scene.setSSR({ enabled: true, maxDistance: 10, steps: 28, thickness: 0.22, intensity: 0.35, edgeFade: 0.16 });
scene.setMSAA(4);

const terrainNodes = [];
const attachTerrainShader = (node, meadowMask = 1.0) => {
  node.setShader({
    module: VALLEY_TERRAIN_BK, file: `terrain_${terrainNodes.length}.bk`,
    uniforms: { time: 0.0, sunBoost: 1.0, meadowMask, pad: 0.0 },
  });
  terrainNodes.push(node);
};

// Terrain & Pond Water
const valleyTerrain = add({
  name: 'Alpine Valley Terrain',
  mesh: createSculptedValleyTerrain(88),
  texture: mats.granite.albedo, normalTexture: mats.granite.normal, metallicRoughnessTexture: mats.granite.mr,
  color: '#ffffff', roughness: 1.0, metallic: 0.02,
});
attachTerrainShader(valleyTerrain, 1.0);

const pondWater = add({
  name: 'Millpond & Tailrace Water',
  mesh: createMillpondWaterMesh(72, 84),
  color: [0.05, 0.24, 0.28, 0.54], roughness: 0.024, metallic: 0.02,
  castsShadow: false, receivesShadow: true,
});
pondWater.setShader({ module: MILLPOND_WATER_BK, file: 'millpond_water.bk', uniforms: { time: 0, flow: 0.76, breeze: 0.48, pad: 0 } });

// Build Architecture, Mechanics, Nature & Particles
const arch = buildMillhouseArchitecture(scene, add, mats, registerPick);
const mech = buildMillMechanics(add, mats, registerPick);
const nature = buildMillNature(scene, add, mats, attachTerrainShader, registerPick);

nature.cliffCascade.setShader({ module: WATER_STREAM_BK, file: 'cliff_cascade.bk', uniforms: { time: 0, flow: 0.76, softTop: 1.0, pad: 0 } });
const streams = [mech.flumeWater, mech.spillJet, nature.cliffCascade];

const sprayParticles = scene.createParticles3D({
  name: 'Waterwheel Spray Mist',
  texture: mats.sprite,
  position: [-0.45, 0.14, -0.05],
  maxParticles: 48, rate: 14,
  lifetime: { min: 0.6, max: 1.3 },
  size: { start: 0.09, end: 0.24 },
  color: { start: [0.90, 0.96, 1.0, 0.14], end: [0.90, 0.96, 1.0, 0.0] },
  velocity: { direction: [0, 0.6, 0.8], spread: 60, speed: 0.32, speedSpread: 0.14 },
  gravity: [0, -0.18, 0], drag: 0.55, softness: 0.20,
  shape: { type: 'sphere', radius: 0.22 },
});

const smokeParticles = scene.createParticles3D({
  name: 'Chimney Woodsmoke',
  texture: mats.sprite,
  position: arch.chimneyTopPos,
  maxParticles: 36, rate: 6,
  lifetime: { min: 2.0, max: 3.4 },
  size: { start: 0.18, end: 0.62 },
  color: { start: [0.76, 0.78, 0.82, 0.20], end: [0.80, 0.82, 0.86, 0.0] },
  velocity: { direction: [0.18, 1.0, 0.10], spread: 24, speed: 0.34, speedSpread: 0.10 },
  gravity: [0.05, 0.04, 0.02], drag: 0.25, softness: 0.18,
  shape: { type: 'sphere', radius: 0.10 },
});

const fireflies = scene.createParticles3D({
  name: 'Millpond Fireflies',
  texture: mats.sprite,
  position: [-1.0, 0.95, 2.1],
  maxParticles: 40, rate: 0,
  lifetime: { min: 2.2, max: 3.8 },
  size: { start: 0.030, end: 0.005 },
  color: { start: [1.0, 0.86, 0.32, 0.92], end: [1.0, 0.58, 0.12, 0.0] },
  blend: 'additive',
  velocity: { direction: [0, 1, 0], spread: 180, speed: 0.16, speedSpread: 0.08 },
  gravity: [0, 0.02, 0], drag: 0.4, softness: 0.14,
  shape: { type: 'sphere', radius: 2.8 },
});

const lights = {
  key: scene.createLight({ name: 'Alpine Sun', type: 'directional', position: [8, 12, 9], direction: [-0.46, -0.76, -0.54], color: [1, 0.96, 0.88], intensity: 3.3, castsShadow: true, shadowBias: 0.0005 }),
  rim: scene.createLight({ name: 'Valley Sky Rim', type: 'directional', position: [-9, 7, -4], direction: [0.76, -0.55, 0.28], color: [0.64, 0.86, 1.0], intensity: 1.15, castsShadow: false }),
  lantern: scene.createLight({ name: 'Porch Lantern Light', type: 'point', position: arch.lanternWorldPos, color: [1.0, 0.66, 0.25], intensity: 1.2, range: 6.5, castsShadow: false }),
};

const rig = { terrainNodes, pondWater, streams, arch, mech, nature, sprayParticles, smokeParticles, fireflies, lights };
const ctrl = new MillraceController(rig, scene, canvas);

// UI & Camera Interaction
let camGoal = null, activeView = 'valley', selected = null, hudVisible = true, hudTimer = 0;
const $ = (s) => document.querySelector(s);
const viewBtns = Array.from(document.querySelectorAll('[data-view]'));
const playBtn = $('#playBtn'), flowSlider = $('#flowSlider'), flowVal = $('#flowVal');
const breezeSlider = $('#breezeSlider'), breezeVal = $('#breezeVal'), moodLabel = $('#moodLabel');
const lifeReadout = $('#lifeReadout'), placard = $('#placard');

function setView(name) {
  const p = VIEW_PRESETS[name] || VIEW_PRESETS.valley;
  activeView = name;
  camGoal = { target: p.target.slice(), dist: p.dist, fov: p.fov, rot: orbitRotation(p.yaw, p.pitch) };
  for (const b of viewBtns) b.classList.toggle('active', b.dataset.view === name);
}

function snapView(name) {
  setView(name);
  if (camGoal) {
    if (camGoal.rot) cam.rot = camGoal.rot.slice();
    cam.fov = camGoal.fov;
    Camera.orbitReframe(cam, camGoal.target, camGoal.dist);
    camGoal = null;
  }
  scene.setCamera(Camera.orbitViewOpts(cam, canvas));
}

function cycleMood() {
  const keys = Object.keys(MOOD_PRESETS);
  const next = keys[(keys.indexOf(ctrl.mood) + 1) % keys.length];
  moodLabel.textContent = ctrl.applyMood(next).label;
}

function togglePlay() {
  ctrl.playing = !ctrl.playing;
  playBtn.textContent = ctrl.playing ? 'Pause' : 'Play';
  playBtn.classList.toggle('active', ctrl.playing);
}

function toggleHud() {
  hudVisible = !hudVisible;
  for (const id of ['#hud-brand', '#hud-views', '#hud-transport']) $(id).classList.toggle('hidden', !hudVisible);
  if (!hudVisible) placard.classList.add('hidden');
  else if (selected) placard.classList.remove('hidden');
  $('#showHudBtn').classList.toggle('hidden', hudVisible);
}

function showSelection(meta) {
  selected = meta;
  if (!meta) { placard.classList.add('hidden'); return; }
  $('#plKind').textContent = meta.kind;
  $('#plName').textContent = meta.name;
  $('#plDesc').textContent = meta.desc;
  placard.classList.remove('hidden');
  updateTelemetryDom();
}

function updateTelemetryDom() {
  const fPct = Math.round(ctrl.flowSmooth * 100);
  const rpm = ((0.25 + 1.05 * ctrl.flowSmooth) * 60 / (Math.PI * 2)).toFixed(1);
  const moodShort = ctrl.mood === 'twilight' ? 'Twilight' : (ctrl.mood === 'harvest' ? 'Harvest' : 'Morning');
  lifeReadout.textContent = `${rpm} RPM · ${fPct}% Sluice · ${moodShort}`;
  if (selected && !placard.classList.contains('hidden')) {
    const id = selected.id || '';
    $('#plZone').textContent = id === 'gears' ? 'Gear Porch' : (id === 'aqueduct' ? 'Upper Sluice' : (id === 'bridge' ? 'Millpond' : 'Wheelpit'));
    $('#plActivity').textContent = ctrl.playing ? 'Turning' : 'Paused';
    $('#plRatio').textContent = id === 'gears' ? '20 : 12 (1.67x)' : '1 : 1 Drive';
    $('#plRpm').textContent = `${rpm} rpm`;
  }
}

let downPos = null;
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2) camGoal = null;
  if (e.button === 0) downPos = [e.clientX, e.clientY];
});
canvas.addEventListener('wheel', () => { camGoal = null; });
canvas.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !downPos) return;
  const d = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (d > 6) return;
  const r = canvas.getBoundingClientRect();
  const ray = vp.ray(e.clientX - r.left, e.clientY - r.top);
  const hit = ray && scene.raycast(ray.origin, ray.dir, 100);
  showSelection(hit && hit.hit ? (pickMap.get(hit.node) || null) : null);
});

for (const b of viewBtns) b.addEventListener('click', () => setView(b.dataset.view));
playBtn.addEventListener('click', togglePlay);
$('#moodBtn').addEventListener('click', cycleMood);
$('#hideHudBtn').addEventListener('click', toggleHud);
$('#showHudBtn').addEventListener('click', toggleHud);
$('#plClose').addEventListener('click', () => showSelection(null));
$('#plResetCam').addEventListener('click', () => { showSelection(null); setView('valley'); });
flowSlider.addEventListener('input', () => { const v = Number(flowSlider.value); ctrl.flow = v / 100; flowVal.textContent = `${v}%`; });
breezeSlider.addEventListener('input', () => { const v = Number(breezeSlider.value); ctrl.breeze = v / 100; breezeVal.textContent = `${v}%`; });

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === '1') setView('valley');
  else if (e.key === '2') setView('wheel');
  else if (e.key === '3') setView('gears');
  else if (e.key === '4') setView('pond');
  else if (e.key === '5') setView('bridge');
  else if (e.key === 'm' || e.key === 'M') cycleMood();
  else if (e.key === 'h' || e.key === 'H') toggleHud();
  else if (e.key === 'Escape') showSelection(null);
});

function blendQuat(a, b, t) {
  const s = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) < 0 ? -1 : 1;
  const o = [a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t];
  const n = Math.hypot(...o) || 1;
  return o.map((x) => x / n);
}

vp.onFrame((dt) => {
  ctrl.step(dt);
  if (camGoal) {
    const a = 1 - Math.exp(-dt * 7.5);
    const c = cam.pivot;
    const np = [c[0] + (camGoal.target[0] - c[0]) * a, c[1] + (camGoal.target[1] - c[1]) * a, c[2] + (camGoal.target[2] - c[2]) * a];
    const nd = cam.dist + (camGoal.dist - cam.dist) * a;
    cam.fov += (camGoal.fov - cam.fov) * a;
    if (camGoal.rot) cam.rot = blendQuat(cam.rot, camGoal.rot, a);
    Camera.orbitReframe(cam, np, nd);
    if (Math.hypot(np[0] - camGoal.target[0], np[1] - camGoal.target[1], np[2] - camGoal.target[2]) < 0.01 && Math.abs(nd - camGoal.dist) < 0.01) camGoal = null;
  }
  hudTimer += dt;
  if (hudTimer >= 0.1) { hudTimer = 0; updateTelemetryDom(); }
});

window.millrace = {
  vp, scene, ctrl, rig, pickMap, snapView,
  setPhase: (p, fl = ctrl.flow, br = ctrl.breeze) => ctrl.setPose(p, fl, br),
  selectSample: () => { const f = Array.from(pickMap.values())[0]; showSelection(f || null); return f || null; },
  setHudVisible: (v) => { if (hudVisible !== Boolean(v)) toggleHud(); },
  setFlow: (v) => { flowSlider.value = String(Math.round(v * 100)); ctrl.flow = v; flowVal.textContent = `${Math.round(v * 100)}%`; },
  setBreeze: (v) => { breezeSlider.value = String(Math.round(v * 100)); ctrl.breeze = v; breezeVal.textContent = `${Math.round(v * 100)}%`; },
  getState: () => ({ time: ctrl.time, playing: ctrl.playing, flow: ctrl.flow, breeze: ctrl.breeze, mood: ctrl.mood, activeView, selectedId: selected ? selected.id : null }),
};
