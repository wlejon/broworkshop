// js/main.js — Interactive Vulcan No. 4 viewport, picking, camera damping, and throttled HUD telemetry.

import { boot } from '/lib/kit/app.js';
import { sceneViewport, orbitRotation } from '/lib/kit/viewport3d.js';
import { Camera } from '/lib/kit/camera.js';
import { buildEngineScene } from './engine_build.js';
import { EngineController, VIEW_PRESETS, MOOD_PRESETS } from './engine_kinematics.js';

boot();

const hero = VIEW_PRESETS.gallery;
const vp = sceneViewport('#stage', {
  orbit: {
    target: hero.target.slice(),
    dist: hero.dist,
    fov: hero.fov,
    near: 0.08,
    far: 120,
    rot: orbitRotation(hero.yaw, hero.pitch),
  },
  controls: { minDist: 1.3, maxDist: 22 },
});

const { canvas, scene, cam } = vp;
const pickMap = new Map();
const registerPick = (node, meta) => { pickMap.set(node, meta); };
const rig = buildEngineScene(scene, registerPick);
const ctrl = new EngineController(rig, scene, canvas);

let camGoal = null;
let activeView = 'gallery';
let selected = null;
let hudVisible = true;
let hudTimer = 0;

const $ = (s) => document.querySelector(s);
const viewBtns = Array.from(document.querySelectorAll('[data-view]'));
const playBtn = $('#playBtn');
const dirBtn = $('#dirBtn');
const cutawayBtn = $('#cutawayBtn');
const throttleSlider = $('#throttleSlider');
const throttleVal = $('#throttleVal');
const moodLabel = $('#moodLabel');
const rpmReadout = $('#rpmReadout');
const placard = $('#placard');

function setView(name) {
  const p = VIEW_PRESETS[name] || VIEW_PRESETS.gallery;
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

function toggleDir() {
  ctrl.direction *= -1;
  dirBtn.textContent = ctrl.direction > 0 ? 'Forward' : 'Reverse';
  dirBtn.classList.toggle('active', ctrl.direction < 0);
}

function toggleCutaway() {
  ctrl.setCutaway(!ctrl.cutaway);
  cutawayBtn.classList.toggle('active', ctrl.cutaway);
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
  const deg = (((ctrl.theta * 180) / Math.PI) % 360 + 360) % 360;
  const bar = (1.2 + ctrl.throttle * 8.2).toFixed(1);
  rpmReadout.textContent = `${ctrl.rpmSmooth.toFixed(1)} RPM · ${bar} BAR`;
  if (selected && !placard.classList.contains('hidden')) {
    $('#plAngle').textContent = `${deg.toFixed(1)}°`;
    $('#plRpm').textContent = `${ctrl.rpmSmooth.toFixed(1)} RPM`;
    $('#plStroke').textContent = `${ctrl.pistonOffsetMm.toFixed(1)} mm`;
    $('#plGov').textContent = `${ctrl.govLift.toFixed(1)} mm`;
  }
}

// Cancel scripted fly if user starts manual orbit/pan/wheel
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
dirBtn.addEventListener('click', toggleDir);
cutawayBtn.addEventListener('click', toggleCutaway);
$('#moodBtn').addEventListener('click', cycleMood);
$('#hideHudBtn').addEventListener('click', toggleHud);
$('#showHudBtn').addEventListener('click', toggleHud);
$('#plClose').addEventListener('click', () => showSelection(null));
$('#plResetCam').addEventListener('click', () => { showSelection(null); setView('gallery'); });
throttleSlider.addEventListener('input', () => {
  const val = Number(throttleSlider.value);
  ctrl.throttle = val / 100.0;
  throttleVal.textContent = `${val}%`;
});

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === '1') setView('gallery');
  else if (e.key === '2') setView('crank');
  else if (e.key === '3') setView('gears');
  else if (e.key === '4') setView('governor');
  else if (e.key === 'm' || e.key === 'M') cycleMood();
  else if (e.key === 'c' || e.key === 'C') toggleCutaway();
  else if (e.key === 'r' || e.key === 'R') toggleDir();
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

  // Throttle DOM updates cleanly (~10 Hz) to eliminate periodic layout/GC hiccups
  hudTimer += dt;
  if (hudTimer >= 0.1) {
    hudTimer = 0;
    updateTelemetryDom();
  }
});

window.engine = {
  vp,
  scene,
  cam,
  ctrl,
  setView,
  snapView,
  applyMood: (m) => { moodLabel.textContent = ctrl.applyMood(m).label; },
  setThrottle: (v) => {
    ctrl.throttle = Math.max(0, Math.min(1, v));
    throttleSlider.value = String(Math.round(ctrl.throttle * 100));
    throttleVal.textContent = `${throttleSlider.value}%`;
  },
  setPhase: (frac, rpmNorm = 0.68) => { ctrl.setPose(frac * Math.PI * 2.0, rpmNorm); },
  selectPart: (id) => {
    for (const meta of pickMap.values()) {
      if (meta.id === id) { showSelection(meta); return meta; }
    }
    return null;
  },
  clearSelection: () => showSelection(null),
  get activeView() { return activeView; },
};
