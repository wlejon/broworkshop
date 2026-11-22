// js/main.js — Entry point, PBR assembly, lighting, camera interaction & test API for Fresnel.

import { boot } from '/lib/kit/app.js';
import { sceneViewport, orbitRotation } from '/lib/kit/viewport3d.js';
import { Camera } from '/lib/kit/camera.js';
import { skyEnvironment } from '/lib/kit/sky.js';
import {
  makeDressedGranitePbrSet,
  makeInlaidSlateFloorPbrSet,
  makeRivetedCastIronPbrSet,
  makeBrushedBrassPbrSet,
  makeVerdigrisCopperPbrSet,
  makeMahoganyWoodPbrSet,
  makeParchmentChartPbrSet,
  makeDialFacePbrSet,
  makeSoftMistSprite,
} from './maritime_pbr.js';
import { buildTowerArchitecture } from './tower_arch.js';
import { buildFresnelOptics } from './fresnel_optics.js';
import { buildWatchroomInterior } from './watchroom_interior.js';
import { FresnelController, VIEW_PRESETS, MOOD_PRESETS } from './fresnel_ctrl.js';

const hero = VIEW_PRESETS.overview;
const vp = sceneViewport('#stage', {
  orbit: {
    target: hero.target.slice(), dist: hero.dist, fov: hero.fov,
    near: 0.1, far: 160, rot: orbitRotation(hero.yaw, hero.pitch),
  },
  controls: { minDist: 1.5, maxDist: 28 },
});

const { canvas, scene, cam } = vp;
const pickMap = new Map();
const registerPick = (node, meta) => pickMap.set(node, meta);
const add = (opts) => (opts.mesh ? scene.createMesh({ castsShadow: true, receivesShadow: true, ...opts }) : scene.createNode(opts));

const mats = {
  granite: makeDressedGranitePbrSet(),
  slate: makeInlaidSlateFloorPbrSet(),
  iron: makeRivetedCastIronPbrSet(),
  brass: makeBrushedBrassPbrSet(),
  copper: makeVerdigrisCopperPbrSet(),
  mahogany: makeMahoganyWoodPbrSet(),
  parchment: makeParchmentChartPbrSet(),
  dial: makeDialFacePbrSet(),
  mist: makeSoftMistSprite(64),
};

skyEnvironment(scene, { hdri: 'qwantani_puresky', intensity: 0.52, rotation: 1.05 });
scene.setGroundBounce([0.08, 0.11, 0.14]);
scene.setSSAO({ radius: 0.44, bias: 0.02, intensity: 0.95 });
scene.setSSR({ enabled: false });
scene.setMSAA(4);

const tower = buildTowerArchitecture(scene, add, mats, registerPick);
const optics = buildFresnelOptics(scene, add, mats, registerPick);
const interior = buildWatchroomInterior(add, mats, registerPick);

const mistParticles = scene.createParticles3D({
  name: 'Sea Spray Dust & Air',
  texture: mats.mist,
  position: [0.0, 4.4, 0.0],
  maxParticles: 40, rate: 10,
  lifetime: { min: 1.6, max: 3.0 },
  size: { start: 0.04, end: 0.16 },
  color: { start: [0.90, 0.95, 1.0, 0.12], end: [0.90, 0.95, 1.0, 0.0] },
  velocity: { direction: [0.4, 0.18, 0.25], spread: 70, speed: 0.28, speedSpread: 0.12 },
  gravity: [0, -0.02, 0], drag: 0.35, softness: 0.20,
  shape: { type: 'sphere', radius: 1.85 },
});

const lights = {
  key: scene.createLight({ name: 'Coastal Sun Key', type: 'directional', position: [10, 14, 9], direction: [-0.52, -0.68, -0.52], color: [1, 0.86, 0.68], intensity: 2.85, castsShadow: true, shadowBias: 0.0005 }),
  rim: scene.createLight({ name: 'Atlantic Sky Fill', type: 'directional', position: [-10, 9, 4], direction: [0.72, -0.46, -0.52], color: [0.58, 0.78, 0.98], intensity: 1.20, castsShadow: false }),
  mantle: scene.createLight({ name: 'Welsbach Vapor Mantle Light', type: 'point', position: optics.lampPos, color: [1.0, 0.82, 0.45], intensity: 1.65, range: 11.0, castsShadow: false }),
  watch: scene.createLight({ name: 'Watchroom Gimbal Lamp Light', type: 'point', position: interior.watchLightPos, color: [1.0, 0.72, 0.32], intensity: 0.95, range: 5.5, castsShadow: false }),
  beacon: scene.createLight({ name: 'Rotating Fresnel Beacon Sweep', type: 'directional', position: [0, 4.5, 0], direction: [0, -0.18, 1], color: [1.0, 0.88, 0.56], intensity: 0.8, castsShadow: false }),
};

const rig = { tower, optics, interior, mistParticles, lights };
const ctrl = new FresnelController(rig, scene, canvas);

let camGoal = null, activeView = 'overview', selected = null, hudVisible = true, hudTimer = 0;
const $ = (s) => document.querySelector(s);
const viewBtns = Array.from(document.querySelectorAll('[data-view]'));
const playBtn = $('#playBtn'), speedSlider = $('#speedSlider'), speedVal = $('#speedVal');
const windSlider = $('#windSlider'), windVal = $('#windVal'), moodBtn = $('#moodBtn');
const shutterBtn = $('#shutterBtn'), telemetryText = $('#telemetryText'), placard = $('#placard');

function setView(name) {
  const p = VIEW_PRESETS[name] || VIEW_PRESETS.overview;
  activeView = name;
  camGoal = { target: p.target.slice(), dist: p.dist, fov: p.fov, rot: orbitRotation(p.yaw, p.pitch) };
  for (const b of viewBtns) b.classList.toggle('active', b.dataset.view === name);
}

function snapView(name) {
  setView(name);
  const p = VIEW_PRESETS[name] || VIEW_PRESETS.overview;
  vp.reframe(p.target, p.dist, { yaw: p.yaw, pitch: p.pitch });
  cam.fov = p.fov;
  camGoal = null;
}

function showPlacard(meta) {
  selected = meta;
  if (!meta) { placard.classList.add('hidden'); return; }
  $('#pl-cat').textContent = meta.kind;
  $('#pl-name').textContent = meta.name;
  $('#pl-desc').textContent = meta.desc;
  updateHudReadout();
  placard.classList.remove('hidden');
}

function updateHudReadout() {
  const rpm = (0.14 + 0.54 * ctrl.speedSmooth) * 60 / (Math.PI * 2);
  const flashSec = (60 / Math.max(0.2, rpm) / 6).toFixed(1);
  const windKt = Math.round(8 + ctrl.windSmooth * 36);
  const moodLabel = (MOOD_PRESETS[ctrl.mood] || MOOD_PRESETS.dawn).label;
  telemetryText.textContent = `${rpm.toFixed(1)} RPM · ${moodLabel}`;
  if (selected) {
    $('#pl-rpm').textContent = `${rpm.toFixed(1)} RPM`;
    $('#pl-flash').textContent = `${flashSec}s (6x)`;
    $('#pl-wind').textContent = `${windKt} kts`;
    $('#pl-lamp').textContent = ctrl.shutterOpen ? '1st-Order Lit' : 'Shuttered';
  }
}

for (const b of viewBtns) b.addEventListener('click', () => setView(b.dataset.view));
playBtn.addEventListener('click', () => {
  ctrl.playing = !ctrl.playing;
  playBtn.textContent = ctrl.playing ? 'Pause' : 'Play';
  playBtn.classList.toggle('active', ctrl.playing);
});
speedSlider.addEventListener('input', () => {
  ctrl.speed = Number(speedSlider.value) / 100;
  speedVal.textContent = `${speedSlider.value}%`;
  updateHudReadout();
});
windSlider.addEventListener('input', () => {
  ctrl.wind = Number(windSlider.value) / 100;
  windVal.textContent = `${windSlider.value}%`;
  updateHudReadout();
});
moodBtn.addEventListener('click', () => {
  const order = ['dawn', 'sunset', 'midnight'];
  const next = order[(order.indexOf(ctrl.mood) + 1) % order.length];
  const m = ctrl.applyMood(next);
  ctrl.applyState();
  moodBtn.textContent = `Sky: ${m.label}`;
  updateHudReadout();
});
shutterBtn.addEventListener('click', () => {
  ctrl.setShutter(!ctrl.shutterOpen);
  shutterBtn.textContent = ctrl.shutterOpen ? 'Beams: Active' : 'Beams: Shuttered';
  shutterBtn.classList.toggle('active', ctrl.shutterOpen);
  updateHudReadout();
});
$('#pl-close').addEventListener('click', () => showPlacard(null));
$('#pl-reset').addEventListener('click', () => setView('overview'));

function setHudVisible(vis) {
  hudVisible = vis;
  for (const el of [$('#hud-title'), $('#hud-views'), $('#hud-controls')]) el.classList.toggle('hidden', !vis);
  $('#showHudBtn').classList.toggle('hidden', vis);
  if (!vis) placard.classList.add('hidden');
  else if (selected) placard.classList.remove('hidden');
}
$('#hideHudBtn').addEventListener('click', () => setHudVisible(false));
$('#showHudBtn').addEventListener('click', () => setHudVisible(true));

let downPt = null;
canvas.addEventListener('pointerdown', (e) => { downPt = [e.clientX, e.clientY]; camGoal = null; });
canvas.addEventListener('pointerup', (e) => {
  if (!downPt || Math.hypot(e.clientX - downPt[0], e.clientY - downPt[1]) > 5) return;
  const hit = scene.pick(e.clientX, e.clientY);
  if (!hit || !hit.node) return;
  let cur = hit.node;
  while (cur) {
    if (pickMap.has(cur)) { showPlacard(pickMap.get(cur)); return; }
    cur = cur.parent;
  }
});

boot({
  handlers: {
    'file:quit': () => window.close(),
    'view:reset': () => setView('overview'),
    'view:hud': () => setHudVisible(!hudVisible),
  },
});

function lerpGoal(dt) {
  if (!camGoal) return false;
  const k = 1 - Math.exp(-dt * 8.0);
  const t = cam.pivot || [0, 3.65, 0];
  for (let i = 0; i < 3; ++i) t[i] += (camGoal.target[i] - t[i]) * k;
  const nextDist = (cam.dist || 11.8) + (camGoal.dist - (cam.dist || 11.8)) * k;
  cam.fov += (camGoal.fov - cam.fov) * k;
  if (camGoal.rot) {
    const q = cam.rot, q1 = camGoal.rot;
    const d = q[0] * q1[0] + q[1] * q1[1] + q[2] * q1[2] + q[3] * q1[3];
    const s = d < 0 ? -1 : 1;
    const nx = q[0] + (q1[0] * s - q[0]) * k;
    const ny = q[1] + (q1[1] * s - q[1]) * k;
    const nz = q[2] + (q1[2] * s - q[2]) * k;
    const nw = q[3] + (q1[3] * s - q[3]) * k;
    const inv = 1 / (Math.hypot(nx, ny, nz, nw) || 1);
    cam.rot = [nx * inv, ny * inv, nz * inv, nw * inv];
  }
  Camera.orbitReframe(cam, t, nextDist);
  const err = Math.hypot(t[0] - camGoal.target[0], t[1] - camGoal.target[1], t[2] - camGoal.target[2]) + Math.abs(nextDist - camGoal.dist);
  if (err < 0.005) camGoal = null;
  return true;
}

vp.onFrame((dt) => {
  ctrl.step(dt);
  lerpGoal(dt);
  hudTimer += dt;
  if (hudTimer > 0.25) { hudTimer = 0; updateHudReadout(); }
});

window.fresnel = {
  vp, scene, ctrl, rig, pickMap,
  snapView,
  setPhase: (p, sp = ctrl.speed, wn = ctrl.wind) => ctrl.setPose(p, sp, wn),
  setSpeed: (s) => { speedSlider.value = String(Math.round(s * 100)); speedSlider.dispatchEvent(new Event('input')); },
  setWind: (w) => { windSlider.value = String(Math.round(w * 100)); windSlider.dispatchEvent(new Event('input')); },
  setShutter: (o) => { ctrl.setShutter(o); shutterBtn.textContent = o ? 'Beams: Active' : 'Beams: Shuttered'; shutterBtn.classList.toggle('active', o); updateHudReadout(); },
  selectSample: () => { const meta = pickMap.get(optics.glassNode); showPlacard(meta); return meta; },
  setHudVisible,
  getState: () => ({ activeView, mood: ctrl.mood, shutterOpen: ctrl.shutterOpen, selectedId: selected ? selected.id : null, playing: ctrl.playing }),
};
