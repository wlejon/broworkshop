// ARDY Motion — text → G1 humanoid motion, rendered as a live skeleton.
//
// Type a prompt, hit Generate: the worker encodes it with LLM2Vec, rolls out
// the ARDY autoregressive diffusion motion model, and returns per-frame G1 joint
// positions (bro.motion). We render the 34-joint skeleton as spheres + beaded
// bones and play the clip back at its native 25 fps in an orbitable 3D scene.
//
// The skeleton is drawn position-only (joints + interpolated bone beads) so it
// needs no per-bone orientation math — every node is placed straight from the
// world joint positions the engine's forward kinematics produced.
import "/lib/camera.js";

const PATHS = {
  checkpoint:  "D:/projects/brodiffusion/weights/ardy-g152",
  textEncoder: "D:/projects/brolm/weights/llm2vec-llama3-8b",
  device:      "cuda",
};
const BEADS_PER_BONE = 4;

function $(id) { return document.getElementById(id); }
function status(s) { $('status').textContent = s; }

let scene, canvas, cam;
let jointNodes = [], bones = [];          // bones: { a, c, beads:[node] }
let clip = null;
const off = { x: 0, y: 0, z: 0 };
let playing = false, playT = 0, frameIdx = 0, autoRotate = true;
let worker = null, ready = false, last = 0, dragging = false;

// ── scene ────────────────────────────────────────────────────────────────────
function setupScene() {
  canvas = $('view');
  scene = canvas.getContext('scene');

  scene.setAmbient([0.24, 0.25, 0.30]);
  scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.55],
                      intensity: 2.4, color: [1.0, 0.98, 0.94] });
  scene.createLight({ type: 'directional', direction: [0.6, -0.35, 0.5],
                      intensity: 0.7, color: [0.68, 0.78, 1.0] });
  scene.setToneMap({ mode: 'aces', exposure: 1.1 });

  // ground
  scene.createMesh({ mesh: 'plane', halfW: 8, halfD: 8, y: 0,
                     color: [0.14, 0.15, 0.19], roughness: 0.96, metallic: 0.0 });

  cam = Camera.createOrbit({ target: [0, 0.9, 0], dist: 4.2, fov: 45 });
  applyCam();

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { dragging = true; e.preventDefault(); }
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    Camera.orbitLook(cam, -e.movementX, e.movementY);
    applyCam();
  });
  canvas.addEventListener('wheel', (e) => {
    cam.dist = Math.max(1.5, Math.min(14, cam.dist * Math.exp(e.deltaY * 0.001)));
    applyCam();
    e.preventDefault();
  });

  requestAnimationFrame(tick);
}

function applyCam() { scene.setCamera(Camera.orbitViewOpts(cam, canvas)); }

// ── skeleton nodes (built once we know the joint count + hierarchy) ───────────
function buildSkeleton(J, parents) {
  jointNodes.forEach(n => n.destroy());
  bones.forEach(b => b.beads.forEach(n => n.destroy()));
  jointNodes = [];
  bones = [];

  for (let j = 0; j < J; j++) {
    jointNodes.push(scene.createMesh({
      mesh: 'sphere', radius: 0.035, segments: 12, rings: 8,
      color: [0.98, 0.56, 0.16], roughness: 0.5, emissive: 0.12,
    }));
  }
  for (let j = 0; j < J; j++) {
    const p = parents[j];
    if (p < 0) continue;
    const beads = [];
    for (let k = 0; k < BEADS_PER_BONE; k++) {
      beads.push(scene.createMesh({
        mesh: 'sphere', radius: 0.022, segments: 8, rings: 6,
        color: [0.55, 0.70, 0.98], roughness: 0.6,
      }));
    }
    bones.push({ a: p, c: j, beads: beads });
  }
}

// ── clip framing + posing ─────────────────────────────────────────────────────
function frameClip() {
  const P = clip.positions, n = (P.length / 3) | 0;
  let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
    if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
  }
  // center the walk horizontally, drop the feet onto the floor (y=0).
  off.x = -(mnx + mxx) / 2;
  off.z = -(mnz + mxz) / 2;
  off.y = -mny;
  const height = Math.max(0.5, mxy - mny);
  // Frame on the standing figure's height (it is much taller than it is wide),
  // so the humanoid fills the view rather than shrinking with its walk drift.
  Camera.orbitReframe(cam, [0, height * 0.5, 0], Math.max(1.8, height * 1.05));
  applyCam();
}

function poseFrame(f) {
  const J = clip.joints, P = clip.positions, base = f * J * 3;
  const gp = (j) => [P[base + j * 3] + off.x, P[base + j * 3 + 1] + off.y,
                     P[base + j * 3 + 2] + off.z];
  for (let j = 0; j < J; j++) {
    const q = gp(j), nd = jointNodes[j];
    nd.x = q[0]; nd.y = q[1]; nd.z = q[2];
  }
  for (const b of bones) {
    const a = gp(b.a), c = gp(b.c), m = b.beads.length;
    for (let k = 0; k < m; k++) {
      const t = (k + 1) / (m + 1), nd = b.beads[k];
      nd.x = a[0] + (c[0] - a[0]) * t;
      nd.y = a[1] + (c[1] - a[1]) * t;
      nd.z = a[2] + (c[2] - a[2]) * t;
    }
  }
}

// ── main loop: auto-orbit + playback ──────────────────────────────────────────
function tick(t) {
  const dt = last ? (t - last) / 1000 : 0;
  last = t;
  if (autoRotate && !dragging) {
    Camera.orbitLook(cam, -(0.30 * dt) / cam.yawSpeed, 0);
    applyCam();
  }
  if (playing && clip) {
    playT += dt * clip.fps;
    frameIdx = Math.floor(playT) % clip.frames;
    poseFrame(frameIdx);
    $('frame').textContent = (frameIdx + 1) + ' / ' + clip.frames;
  }
  requestAnimationFrame(tick);
}

// ── worker client ─────────────────────────────────────────────────────────────
function initWorker() {
  worker = new Worker('motion-worker.js');
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'ready') {
      status('loading text encoder + motion model…');
      worker.postMessage({ type: 'load', paths: PATHS });
    } else if (m.type === 'loaded') {
      ready = true;
      status('ready · ' + m.device);
      $('gen').disabled = false;
    } else if (m.type === 'generated') {
      onClip(m.clip);
    } else if (m.type === 'error') {
      status('error (' + m.stage + '): ' + m.message);
      $('gen').disabled = false;
    }
  };
}

function onClip(c) {
  clip = c;
  buildSkeleton(c.joints, c.parents);
  frameClip();
  poseFrame(0);
  playing = true; playT = 0; frameIdx = 0;
  $('gen').disabled = false;
  $('playToggle').disabled = false;
  $('playToggle').textContent = 'Pause';
  status('playing · ' + c.frames + ' frames @ ' + c.fps + ' fps');
}

function generate() {
  if (!ready) return;
  const text = $('prompt').value.trim();
  if (!text) return;
  $('gen').disabled = true;
  playing = false;
  status('generating…');
  worker.postMessage({
    type: 'generate',
    text: text,
    opts: {
      frames: parseInt($('frames').value, 10) || 104,
      steps: 10,
      cfg: parseFloat($('cfg').value) || 2.5,
      seed: (Math.random() * 1e9) | 0,
    },
  });
}

// ── UI wiring ─────────────────────────────────────────────────────────────────
function initUI() {
  $('gen').addEventListener('click', generate);
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('gen').disabled) generate();
  });
  $('playToggle').addEventListener('click', () => {
    if (!clip) return;
    playing = !playing;
    $('playToggle').textContent = playing ? 'Pause' : 'Play';
  });
  $('autoRotate').addEventListener('change', (e) => { autoRotate = e.target.checked; });
  document.querySelectorAll('.chip').forEach((el) => {
    el.addEventListener('click', () => {
      $('prompt').value = el.textContent;
      if (!$('gen').disabled) generate();
    });
  });
}

function start() {
  if (!$('view')) { requestAnimationFrame(start); return; }
  setupScene();
  initUI();
  initWorker();
  status('starting worker…');
}

start();
