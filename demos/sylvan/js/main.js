// js/main.js — Interactive Sylvan sanctuary viewport, specimen picking, camera transitions & throttled HUD telemetry.

import { boot } from '/lib/kit/app.js';
import { sceneViewport, orbitRotation } from '/lib/kit/viewport3d.js';
import { Camera } from '/lib/kit/camera.js';
import { buildSylvanScene } from './sylvan_build.js';
import { SylvanController, VIEW_PRESETS, MOOD_PRESETS } from './sylvan_life.js';

boot();

const hero = VIEW_PRESETS.sanctuary;
const vp = sceneViewport('#stage', {
  orbit: {
    target: hero.target.slice(),
    dist: hero.dist,
    fov: hero.fov,
    near: 0.08,
    far: 120,
    rot: orbitRotation(hero.yaw, hero.pitch),
  },
  controls: { minDist: 1.5, maxDist: 18 },
});

const { canvas, scene, cam } = vp;
const pickMap = new Map();
const registerPick = (node, meta) => { pickMap.set(node, meta); };
const rig = buildSylvanScene(scene, registerPick);
const ctrl = new SylvanController(rig, scene, canvas);

let camGoal = null;
let activeView = 'sanctuary';
let selected = null;
let hudVisible = true;
let hudTimer = 0;

const $ = (s) => document.querySelector(s);
const viewBtns = Array.from(document.querySelectorAll('[data-view]'));
const playBtn = $('#playBtn');
const breezeSlider = $('#breezeSlider');
const breezeVal = $('#breezeVal');
const moodLabel = $('#moodLabel');
const lifeReadout = $('#lifeReadout');
const placard = $('#placard');

function setView(name) {
  const p = VIEW_PRESETS[name] || VIEW_PRESETS.sanctuary;
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
  if (!meta) {
    placard.classList.add('hidden');
    return;
  }
  $('#plKind').textContent = meta.kind;
  $('#plName').textContent = meta.name;
  $('#plDesc').textContent = meta.desc;
  placard.classList.remove('hidden');
  updateTelemetryDom();
}

function updateTelemetryDom() {
  const pct = Math.round(ctrl.breezeSmooth * 100);
  const temp = ctrl.mood === 'dusk' ? '17°C Dusk' : (ctrl.mood === 'sunbeam' ? '25°C Sun' : '22°C Mist');
  lifeReadout.textContent = `${rig.koiList.length} Koi · ${pct}% Breeze · ${temp}`;
  if (selected && !placard.classList.contains('hidden')) {
    const id = selected.id || '';
    const isKoi = id.startsWith('koi_');
    const isMaple = id === 'maple';
    const isCascade = id === 'cascade';
    $('#plZone').textContent = isMaple ? 'West Bank' : (isCascade ? 'North Falls' : 'Clear Pool');
    $('#plActivity').textContent = !ctrl.playing ? 'Paused' : (isKoi ? 'Gliding' : (isMaple ? 'Swaying' : 'Flowing'));
    $('#plBreeze').textContent = `${pct}%`;
    $('#plElev').textContent = isMaple ? '1.85 m' : (isCascade ? '1.10 m' : '-0.08 m');
  }
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2) camGoal = null;
});
canvas.addEventListener('wheel', () => { camGoal = null; });

let downPos = null;
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) downPos = [e.clientX, e.clientY]; });
canvas.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !downPos) return;
  const d = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (d > 6) return;
  const r = canvas.getBoundingClientRect();
  const ray = vp.ray(e.clientX - r.left, e.clientY - r.top);
  const hit = ray && scene.raycast(ray.origin, ray.dir, 80);
  showSelection(hit && hit.hit ? (pickMap.get(hit.node) || null) : null);
});

for (const b of viewBtns) b.addEventListener('click', () => setView(b.dataset.view));
playBtn.addEventListener('click', togglePlay);
$('#moodBtn').addEventListener('click', cycleMood);
$('#hideHudBtn').addEventListener('click', toggleHud);
$('#showHudBtn').addEventListener('click', toggleHud);
$('#plClose').addEventListener('click', () => showSelection(null));
$('#plResetCam').addEventListener('click', () => { showSelection(null); setView('sanctuary'); });
breezeSlider.addEventListener('input', () => {
  const val = Number(breezeSlider.value);
  ctrl.breeze = val / 100.0;
  breezeVal.textContent = `${val}%`;
});

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === '1') setView('sanctuary');
  else if (e.key === '2') setView('cascade');
  else if (e.key === '3') setView('pond');
  else if (e.key === '4') setView('canopy');
  else if (e.key === 'm' || e.key === 'M') cycleMood();
  else if (e.key === 'h' || e.key === 'H') toggleHud();
  else if (e.key === 'Escape') showSelection(null);
});

function blendQuat(a, b, t) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const o = [a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t];
  const n = Math.hypot(o[0], o[1], o[2], o[3]) || 1;
  return [o[0] / n, o[1] / n, o[2] / n, o[3] / n];
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
    if (Math.hypot(np[0] - camGoal.target[0], np[1] - camGoal.target[1], np[2] - camGoal.target[2]) < 0.01 &&
        Math.abs(nd - camGoal.dist) < 0.01) camGoal = null;
  }

  hudTimer += dt;
  if (hudTimer >= 0.1) {
    hudTimer = 0;
    updateTelemetryDom();
  }
});

window.sylvan = {
  vp,
  scene,
  ctrl,
  rig,
  pickMap,
  snapView,
  setPhase: (phase, br = ctrl.breeze) => ctrl.setPose(phase, br),
  selectSample: () => {
    const first = Array.from(pickMap.values())[0];
    showSelection(first || null);
    return first || null;
  },
  setHudVisible: (v) => { if (hudVisible !== Boolean(v)) toggleHud(); },
  setBreeze: (v) => {
    breezeSlider.value = String(Math.round(v * 100));
    ctrl.breeze = v;
    breezeVal.textContent = `${Math.round(v * 100)}%`;
  },
  getState: () => ({
    time: ctrl.time,
    playing: ctrl.playing,
    breeze: ctrl.breeze,
    mood: ctrl.mood,
    activeView,
    selectedId: selected ? selected.id : null,
  }),
};
