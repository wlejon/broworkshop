// js/main.js — Application entry point wiring viewport3d, picking, camera damping, and HUD.

import { boot } from '/lib/kit/app.js';
import { sceneViewport, orbitRotation } from '/lib/kit/viewport3d.js';
import { Camera } from '/lib/kit/camera.js';
import { AureliaOrrery, VIEW_PRESETS, MOOD_PRESETS } from './orrery.js';

boot();

const hero = VIEW_PRESETS.hero;
const vp = sceneViewport('#stage', {
  orbit: {
    target: hero.target.slice(),
    dist: hero.dist,
    fov: hero.fov,
    near: 0.08,
    far: 180,
    rot: orbitRotation(hero.yaw, hero.pitch),
  },
  controls: { minDist: 1.4, maxDist: 28 },
});

const { canvas, scene, cam } = vp;
const orrery = new AureliaOrrery(scene, canvas);

// Smooth damped camera target state
let camGoal = null;
let activeView = 'hero';
let selected = null;
let following = false;
let hudVisible = true;

const $ = (s) => document.querySelector(s);
const viewBtns = Array.from(document.querySelectorAll('[data-view]'));
const speedBtns = Array.from(document.querySelectorAll('[data-speed]'));
const playBtn = $('#playBtn');
const dirBtn = $('#dirBtn');
const lawBtn = $('#lawBtn');
const moodBtn = $('#moodBtn');
const moodLabel = $('#moodLabel');
const epochReadout = $('#epochReadout');
const placard = $('#placard');
const plFollow = $('#plFollow');

function setView(name) {
  const p = VIEW_PRESETS[name] || VIEW_PRESETS.hero;
  activeView = name;
  following = false;
  updateFollowUi();
  camGoal = {
    target: p.target.slice(),
    dist: p.dist,
    fov: p.fov,
    rot: orbitRotation(p.yaw, p.pitch),
  };
  for (const b of viewBtns) b.classList.toggle('active', b.dataset.view === name);
}

function cycleMood() {
  const keys = Object.keys(MOOD_PRESETS);
  const next = keys[(keys.indexOf(orrery.mood) + 1) % keys.length];
  const m = orrery.applyMood(next);
  moodLabel.textContent = m.label;
}

function setSpeed(s) {
  orrery.speed = s;
  for (const b of speedBtns) b.classList.toggle('active', Number(b.dataset.speed) === s);
}

function togglePlay() {
  orrery.playing = !orrery.playing;
  playBtn.textContent = orrery.playing ? 'Pause' : 'Play';
  playBtn.classList.toggle('active', orrery.playing);
}

function toggleDir() {
  orrery.direction *= -1;
  dirBtn.textContent = orrery.direction > 0 ? 'Prograde' : 'Retrograde';
  dirBtn.classList.toggle('active', orrery.direction < 0);
}

function toggleLaw() {
  orrery.law = orrery.law === 'kepler' ? 'harmonic' : 'kepler';
  lawBtn.textContent = orrery.law === 'kepler' ? 'Keplerian' : 'Harmonic';
}

function toggleHud() {
  hudVisible = !hudVisible;
  for (const id of ['#hud-brand', '#hud-views', '#hud-transport']) {
    $(id).classList.toggle('hidden', !hudVisible);
  }
  if (!hudVisible) placard.classList.add('hidden');
  else if (selected) placard.classList.remove('hidden');
  $('#showHudBtn').classList.toggle('hidden', hudVisible);
}

function updateFollowUi() {
  plFollow.textContent = following ? 'Release Body' : 'Follow Body';
  plFollow.classList.toggle('active', following);
}

function showSelection(meta) {
  selected = meta;
  if (!meta) {
    placard.classList.add('hidden');
    following = false;
    updateFollowUi();
    return;
  }
  $('#plKind').textContent = meta.kind;
  $('#plName').textContent = meta.name;
  $('#plDesc').textContent = meta.desc;
  $('#plDist').textContent = meta.distLabel;
  $('#plPeriod').textContent = meta.periodLabel;
  $('#plTilt').textContent = meta.tiltLabel;
  $('#plLon').textContent = orrery.bodyLongitudeDeg(meta.id) || '—';
  placard.classList.remove('hidden');
  following = typeof meta.worldTarget === 'function';
  if (following) {
    const wp = meta.worldTarget();
    camGoal = { target: wp.slice(), dist: Math.max(1.8, (meta.spec ? meta.spec.radius * 7.5 : 2.0)), fov: 40, rot: null };
  }
  updateFollowUi();
}

// Cancel scripted camera fly if user begins manual orbit/pan/wheel
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2) {
    camGoal = null;
    if (e.button === 1) following = false;
    updateFollowUi();
  }
});
canvas.addEventListener('wheel', () => { camGoal = null; });

// Left click 3D raycast picking
let downPos = null;
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) downPos = [e.clientX, e.clientY]; });
canvas.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !downPos) return;
  const distPx = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (distPx > 6) return;
  const r = canvas.getBoundingClientRect();
  const ray = vp.ray(e.clientX - r.left, e.clientY - r.top);
  const hit = ray && scene.raycast(ray.origin, ray.dir, 120);
  const meta = hit && hit.hit ? orrery.lookupPick(hit.node) : null;
  showSelection(meta);
});

// UI controls
for (const b of viewBtns) b.addEventListener('click', () => setView(b.dataset.view));
for (const b of speedBtns) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
playBtn.addEventListener('click', togglePlay);
dirBtn.addEventListener('click', toggleDir);
lawBtn.addEventListener('click', toggleLaw);
moodBtn.addEventListener('click', cycleMood);
$('#hideHudBtn').addEventListener('click', toggleHud);
$('#showHudBtn').addEventListener('click', toggleHud);
$('#plClose').addEventListener('click', () => showSelection(null));
plFollow.addEventListener('click', () => {
  if (!selected || typeof selected.worldTarget !== 'function') return;
  following = !following;
  updateFollowUi();
});
$('#plResetCam').addEventListener('click', () => {
  showSelection(null);
  setView('hero');
});

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === '1') setView('hero');
  else if (e.key === '2') setView('ecliptic');
  else if (e.key === '3') setView('planisphere');
  else if (e.key === '4') setView('clockwork');
  else if (e.key === 'm' || e.key === 'M') cycleMood();
  else if (e.key === 'h' || e.key === 'H') toggleHud();
  else if (e.key === 'r' || e.key === 'R') toggleDir();
  else if (e.key === 'Escape') showSelection(null);
});

function slerpOrBlend(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  const out = [
    a[0] + (b[0] * sign - a[0]) * t,
    a[1] + (b[1] * sign - a[1]) * t,
    a[2] + (b[2] * sign - a[2]) * t,
    a[3] + (b[3] * sign - a[3]) * t,
  ];
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  return [out[0] / n, out[1] / n, out[2] / n, out[3] / n];
}

vp.onFrame((dt) => {
  orrery.updateKinematics(dt);

  // Smooth camera transition or followed planet tracking
  const alpha = 1 - Math.exp(-dt * 7.5);
  if (following && selected && typeof selected.worldTarget === 'function') {
    const wp = selected.worldTarget();
    const cur = cam.pivot;
    const nextPivot = [
      cur[0] + (wp[0] - cur[0]) * Math.min(1, alpha * 1.6),
      cur[1] + (wp[1] - cur[1]) * Math.min(1, alpha * 1.6),
      cur[2] + (wp[2] - cur[2]) * Math.min(1, alpha * 1.6),
    ];
    Camera.orbitReframe(cam, nextPivot, camGoal ? cam.dist : cam.dist);
  }
  if (camGoal) {
    const cur = cam.pivot;
    const nextPivot = [
      cur[0] + (camGoal.target[0] - cur[0]) * alpha,
      cur[1] + (camGoal.target[1] - cur[1]) * alpha,
      cur[2] + (camGoal.target[2] - cur[2]) * alpha,
    ];
    const nextDist = cam.dist + (camGoal.dist - cam.dist) * alpha;
    cam.fov += (camGoal.fov - cam.fov) * alpha;
    if (camGoal.rot) cam.rot = slerpOrBlend(cam.rot, camGoal.rot, alpha);
    Camera.orbitReframe(cam, nextPivot, nextDist);
    const donePos = Math.hypot(
      nextPivot[0] - camGoal.target[0],
      nextPivot[1] - camGoal.target[1],
      nextPivot[2] - camGoal.target[2]
    ) < 0.01 && Math.abs(nextDist - camGoal.dist) < 0.01;
    if (donePos) camGoal = null;
  }

  epochReadout.textContent = `Day ${orrery.simDays.toFixed(1)}`;
  if (selected && !placard.classList.contains('hidden')) {
    const lon = orrery.bodyLongitudeDeg(selected.id);
    if (lon) $('#plLon').textContent = lon;
  }
});

// Expose handle cleanly for automated visual inspection & unit tests
window.orrery = {
  vp,
  scene,
  cam,
  orrery,
  setView,
  applyMood: (m) => {
    const info = orrery.applyMood(m);
    moodLabel.textContent = info.label;
    return info;
  },
  snapView: (name) => {
    setView(name);
    if (camGoal) {
      if (camGoal.rot) cam.rot = camGoal.rot.slice();
      cam.fov = camGoal.fov;
      Camera.orbitReframe(cam, camGoal.target, camGoal.dist);
      camGoal = null;
    }
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));
  },
  selectBody: (id) => {
    const body = orrery.bodies.find((b) => b.spec.id === id);
    if (body) showSelection(orrery.lookupPick(body.planetMesh));
  },
  clearSelection: () => showSelection(null),
  get activeView() { return activeView; },
};
