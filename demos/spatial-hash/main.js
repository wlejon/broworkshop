// Spatial Hash 3D — a live, interactive showcase of bro.math.SpatialHash3D.
//
// The whole headline of a spatial hash is: per-frame neighbour queries over a
// large moving population stay cheap, where brute force is O(n²). This demo
// runs a few thousand boids in a thin-slab 3D world (a wide XZ plane, a small
// Y band) and rebuilds the hash from scratch EVERY frame, then drives flocking
// + four interactive query tools off it. A live brute-force comparison turns
// the speedup into a number on screen instead of a claim.
//
// World axes → screen: X → screen-x, Z → screen-y (a top-down view). Y is a
// thin slab [-SLAB, +SLAB]; it gives the 3D index real work to do (queries are
// genuinely 3D — the dilation by maxRadius spans Y too) while staying legible
// when projected to 2D. Agent Y also drives dot size, so depth reads visually.
//
// SpatialHash3D methods exercised, and where:
//   new / reset(cellSize)  — rebuild the index when the cell-size slider moves
//   clear()                — wipe between frames before re-inserting everyone
//   insert(x,y,z,id)       — every boid, every frame
//   insertSphere(...,r,id) — a handful of "blob" entries with large radii
//   remove(id)             — when the population slider shrinks the flock
//   radiusQuery(...)       — (a) flocking separation per boid, (b) cursor probe
//   queryAABB(...)         — the drag-selection box
//   nearest(...)           — probe line from cursor to closest agent center
//   .size / .cellSize / .maxRadius — surfaced live in the HUD

// Tiny self-contained math helpers (the shared /lib/math.js MathX only mounts
// when launched through the workshop project root; this demo stands alone, so
// we inline just the few helpers it uses).
const MathX = {
  TAU: Math.PI * 2,
  clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  randRange(lo, hi) { return lo + Math.random() * (hi - lo); },
};

const canvas = document.querySelector('#view');
const ctx = canvas.getContext('2d');

// ----- controls --------------------------------------------------------------
const elPause   = document.querySelector('#pause');
const elStep    = document.querySelector('#step');
const elBrute   = document.querySelector('#brute');
const elCount   = document.querySelector('#count');
const elCell    = document.querySelector('#cell');
const elRadius  = document.querySelector('#radius');
const elCountV  = document.querySelector('#countVal');
const elCellV   = document.querySelector('#cellVal');
const elRadiusV = document.querySelector('#radiusVal');

// ----- HUD -------------------------------------------------------------------
const hud = {
  fps:    document.querySelector('#fps'),
  agents: document.querySelector('#agents'),
  hsize:  document.querySelector('#hsize'),
  hcell:  document.querySelector('#hcell'),
  hmax:   document.querySelector('#hmax'),
  qpf:    document.querySelector('#qpf'),
  tbuild: document.querySelector('#tbuild'),
  thash:  document.querySelector('#thash'),
  tbrute: document.querySelector('#tbrute'),
  speed:  document.querySelector('#speed'),
  cand:   document.querySelector('#cand'),
};

// ----- world -----------------------------------------------------------------
// World units; the visible XZ region maps to the canvas. Y is the thin slab.
const WORLD_W = 1600;   // X extent
const WORLD_D = 1000;   // Z extent
const SLAB    = 70;     // Y in [-SLAB, +SLAB]

let count    = +elCount.value;
let cellSize = +elCell.value;
let queryR   = +elRadius.value;
let bruteOn  = true;
let paused   = false;
let stepOnce = false;

// Boid state in flat typed arrays (id == array index).
let px = new Float32Array(0), py = new Float32Array(0), pz = new Float32Array(0);
let vx = new Float32Array(0), vy = new Float32Array(0), vz = new Float32Array(0);

const SPEED = 90;       // world units / sec target speed
const SEP_R = 26;       // separation radius (per-boid radiusQuery)

// A few large "blob" sphere entries — these get insertSphere'd with big radii.
// Their ids live above the boid id range so they never collide with boids.
const SPHERE_BASE = 1000000;
const NUM_SPHERES = 6;
const spheres = [];     // {x,y,z,r,vx,vz}

function spawnSpheres() {
  spheres.length = 0;
  for (let i = 0; i < NUM_SPHERES; i++) {
    spheres.push({
      x: MathX.randRange(120, WORLD_W - 120),
      y: MathX.randRange(-SLAB, SLAB),
      z: MathX.randRange(120, WORLD_D - 120),
      r: MathX.randRange(55, 130),
      vx: MathX.randRange(-30, 30),
      vz: MathX.randRange(-30, 30),
    });
  }
}

function resizeFlock(n) {
  const old = px.length;
  const npx = new Float32Array(n), npy = new Float32Array(n), npz = new Float32Array(n);
  const nvx = new Float32Array(n), nvy = new Float32Array(n), nvz = new Float32Array(n);
  const keep = Math.min(old, n);
  npx.set(px.subarray(0, keep)); npy.set(py.subarray(0, keep)); npz.set(pz.subarray(0, keep));
  nvx.set(vx.subarray(0, keep)); nvy.set(vy.subarray(0, keep)); nvz.set(vz.subarray(0, keep));
  for (let i = old; i < n; i++) {
    npx[i] = MathX.randRange(0, WORLD_W);
    npy[i] = MathX.randRange(-SLAB, SLAB);
    npz[i] = MathX.randRange(0, WORLD_D);
    const a = MathX.randRange(0, MathX.TAU);
    nvx[i] = Math.cos(a) * SPEED; nvz[i] = Math.sin(a) * SPEED;
    nvy[i] = MathX.randRange(-12, 12);
  }
  // If the flock shrank, drop the now-removed ids from the hash explicitly so
  // remove() is exercised; clear()+rebuild would also handle it, but removing
  // by id is the documented O(1) path and worth showing.
  if (n < old) for (let i = n; i < old; i++) hash.remove(i);
  px = npx; py = npy; pz = npz; vx = nvx; vy = nvy; vz = nvz;
}

// ----- the spatial hash ------------------------------------------------------
let hash = new bro.math.SpatialHash3D(cellSize);

// ----- mouse / interaction ---------------------------------------------------
// Cursor in world coords (XZ); Y probe sits at slab center (0).
let mouseX = WORLD_W * 0.5, mouseZ = WORLD_D * 0.5, mouseInside = false;
let dragging = false, dragA = null, dragB = null;   // AABB drag in world coords

function screenToWorld(sx, sy) {
  return { x: sx / canvas.width * WORLD_W, z: sy / canvas.height * WORLD_D };
}

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const w = screenToWorld((e.clientX - r.left) / r.width * canvas.width,
                          (e.clientY - r.top) / r.height * canvas.height);
  mouseX = w.x; mouseZ = w.z; mouseInside = true;
  if (dragging) dragB = w;
});
canvas.addEventListener('mouseleave', () => { mouseInside = false; });
canvas.addEventListener('mousedown', (e) => {
  const r = canvas.getBoundingClientRect();
  const w = screenToWorld((e.clientX - r.left) / r.width * canvas.width,
                          (e.clientY - r.top) / r.height * canvas.height);
  dragging = true; dragA = w; dragB = w;
});
window.addEventListener('mouseup', () => {
  // A click with no real drag clears the box; a real drag keeps it.
  if (dragging && dragA && dragB) {
    const dx = Math.abs(dragA.x - dragB.x), dz = Math.abs(dragA.z - dragB.z);
    if (dx < 6 && dz < 6) { dragA = dragB = null; }
  }
  dragging = false;
});

// ----- controls wiring -------------------------------------------------------
elPause.addEventListener('click', () => {
  paused = !paused;
  elPause.textContent = paused ? 'Resume' : 'Pause';
  elPause.classList.toggle('active', paused);
});
elStep.addEventListener('click', () => { stepOnce = true; });
elBrute.addEventListener('click', () => {
  bruteOn = !bruteOn;
  elBrute.textContent = 'Brute compare: ' + (bruteOn ? 'on' : 'off');
  elBrute.classList.toggle('active', !bruteOn);
});
elCount.addEventListener('input', () => {
  count = +elCount.value; elCountV.textContent = count; resizeFlock(count);
});
elCell.addEventListener('input', () => {
  cellSize = +elCell.value; elCellV.textContent = cellSize;
  hash.reset(cellSize);   // exercise reset(): new cell size + clear
});
elRadius.addEventListener('input', () => {
  queryR = +elRadius.value; elRadiusV.textContent = queryR;
});

// ----- simulation step -------------------------------------------------------
// Per-boid separation steering using radiusQuery. Returns total candidate
// count examined (sum of radiusQuery result-list lengths) so the HUD can show
// "avg candidates" — i.e. how much work the hash saved vs scanning all N.
function flock(dt) {
  let candidates = 0;
  for (let i = 0; i < count; i++) {
    const x = px[i], y = py[i], z = pz[i];
    const ids = hash.radiusQuery(x, y, z, SEP_R);
    candidates += ids.length;
    let sxx = 0, syy = 0, szz = 0;
    for (let k = 0; k < ids.length; k++) {
      const j = ids[k];
      if (j >= count) continue;        // skip sphere ids
      if (j === i) continue;
      const ddx = x - px[j], ddy = y - py[j], ddz = z - pz[j];
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d2 > 1e-4) { const inv = 1 / d2; sxx += ddx * inv; syy += ddy * inv; szz += ddz * inv; }
    }
    // Apply separation as an acceleration; keep speed roughly constant.
    vx[i] += sxx * 600 * dt;
    vy[i] += syy * 600 * dt;
    vz[i] += szz * 600 * dt;
  }
  return candidates;
}

function integrate(dt) {
  for (let i = 0; i < count; i++) {
    // Gentle pull toward center keeps the flock on screen.
    vx[i] += (WORLD_W * 0.5 - px[i]) * 0.02 * dt;
    vz[i] += (WORLD_D * 0.5 - pz[i]) * 0.02 * dt;
    vy[i] += (-py[i]) * 0.4 * dt;                 // stay in the slab

    // Renormalize XZ speed toward target so boids don't blow up.
    const sp = Math.hypot(vx[i], vz[i]) || 1;
    const f = MathX.lerp(sp, SPEED, 0.1) / sp;
    vx[i] *= f; vz[i] *= f;
    vy[i] = MathX.clamp(vy[i], -25, 25);

    px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;

    // Wrap around the XZ torus; clamp Y to the slab.
    if (px[i] < 0) px[i] += WORLD_W; else if (px[i] >= WORLD_W) px[i] -= WORLD_W;
    if (pz[i] < 0) pz[i] += WORLD_D; else if (pz[i] >= WORLD_D) pz[i] -= WORLD_D;
    py[i] = MathX.clamp(py[i], -SLAB, SLAB);
  }
  for (const s of spheres) {
    s.x += s.vx * dt; s.z += s.vz * dt;
    if (s.x < s.r || s.x > WORLD_W - s.r) s.vx *= -1;
    if (s.z < s.r || s.z > WORLD_D - s.r) s.vz *= -1;
    s.x = MathX.clamp(s.x, s.r, WORLD_W - s.r);
    s.z = MathX.clamp(s.z, s.r, WORLD_D - s.r);
  }
}

// Rebuild the hash from scratch: clear + re-insert every boid and sphere.
function rebuildHash() {
  hash.clear();
  for (let i = 0; i < count; i++) hash.insert(px[i], py[i], pz[i], i);
  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    hash.insertSphere(s.x, s.y, s.z, s.r, SPHERE_BASE + i);
  }
}

// ----- brute-force reference (for the live comparison only) ------------------
// Mirrors radiusQuery for points + the sphere reach rule, scanning all ids.
function bruteRadius(qx, qy, qz, r) {
  const out = [];
  const r2 = r * r;
  for (let i = 0; i < count; i++) {
    const dx = px[i] - qx, dy = py[i] - qy, dz = pz[i] - qz;
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
  }
  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    const dx = s.x - qx, dy = s.y - qy, dz = s.z - qz;
    const reach = r + s.r;
    if (dx * dx + dy * dy + dz * dz <= reach * reach) out.push(SPHERE_BASE + i);
  }
  return out;
}

// ----- query tools driven each frame -----------------------------------------
// Results captured for drawing + the comparison numbers.
let probeIds = [];      // radiusQuery around cursor
let boxIds = [];        // queryAABB result
let nearestId = -1;     // nearest to cursor
let qPerFrame = 0;      // total queries issued this frame (incl. per-boid)

function runTools() {
  probeIds = []; boxIds = []; nearestId = -1;
  let q = count;          // one radiusQuery per boid in flock()

  if (mouseInside) {
    probeIds = hash.radiusQuery(mouseX, 0, mouseZ, queryR);  q++;
    nearestId = hash.nearest(mouseX, 0, mouseZ, WORLD_W);    q++;
  }
  if (dragA && dragB) {
    const minX = Math.min(dragA.x, dragB.x), maxX = Math.max(dragA.x, dragB.x);
    const minZ = Math.min(dragA.z, dragB.z), maxZ = Math.max(dragA.z, dragB.z);
    boxIds = hash.queryAABB(minX, -SLAB, minZ, maxX, SLAB, maxZ);  q++;
  }
  qPerFrame = q;
}

// ----- timing ----------------------------------------------------------------
let lastFps = 0, fpsAccum = 0, fpsCount = 0, fpsT = 0;
let tBuild = 0, tHash = 0, tBrute = 0, avgCand = 0;

function simulate(dt) {
  // Build the index for this frame and time it.
  let t0 = performance.now();
  rebuildHash();
  tBuild = performance.now() - t0;

  // The hash-driven work: per-boid separation queries + cursor/box/nearest.
  t0 = performance.now();
  const cand = flock(dt);
  runTools();
  tHash = performance.now() - t0;
  avgCand = count > 0 ? cand / count : 0;

  // Brute-force the SAME cursor radius query, repeated enough times to be a
  // fair stopwatch read against the hash's per-frame query load. We scale the
  // single brute query up to ~count queries so the comparison is apples to
  // apples with the per-boid separation pass.
  if (bruteOn && mouseInside) {
    const reps = Math.max(1, Math.min(count, 1200));   // cap so a huge flock stays responsive
    t0 = performance.now();
    for (let r = 0; r < reps; r++) bruteRadius(mouseX, 0, mouseZ, queryR);
    const per = (performance.now() - t0) / reps;
    tBrute = per * count;     // extrapolate to a full per-boid pass
  } else {
    tBrute = 0;
  }

  integrate(dt);
}

// ----- rendering -------------------------------------------------------------
function W2SX(x) { return x / WORLD_W * canvas.width; }
function W2SY(z) { return z / WORLD_D * canvas.height; }

function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#0c0e12';
  ctx.fillRect(0, 0, w, h);

  // Faint grid showing the hash cell size, so cellSize is visible spatially.
  const cell = cellSize / WORLD_W * w;
  if (cell >= 6) {
    ctx.strokeStyle = 'rgba(40,52,72,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx <= w; gx += cell) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
    const cz = cellSize / WORLD_D * h;
    for (let gy = 0; gy <= h; gy += cz) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
    ctx.stroke();
  }

  // Membership sets for coloring (small, fast lookups).
  const inProbe = new Set(probeIds);
  const inBox = new Set(boxIds);

  // Boids. Y maps to dot radius (depth cue) and a slight hue shift.
  for (let i = 0; i < count; i++) {
    const sx = W2SX(px[i]), sy = W2SY(pz[i]);
    const depth = (py[i] + SLAB) / (2 * SLAB);      // 0..1
    const rad = 1.1 + depth * 2.0;
    let color;
    if (inBox.has(i))        color = '#ffd166';     // AABB selection
    else if (inProbe.has(i)) color = '#7fe6a8';     // radius probe
    else {
      const g = Math.floor(120 + depth * 90);
      color = `rgb(80,${g},${170})`;
    }
    ctx.fillStyle = color;
    ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }

  // Spheres (blob entries). Glow when the cursor probe currently reaches them,
  // demonstrating insertSphere dilation: a big sphere is matched even though
  // its center can be well outside the query radius.
  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    const id = SPHERE_BASE + i;
    const reached = inProbe.has(id);
    const cx = W2SX(s.x), cy = W2SY(s.z);
    const rxw = s.r / WORLD_W * w, rzh = s.r / WORLD_D * h;
    const sr = (rxw + rzh) * 0.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rxw, rzh, 0, 0, MathX.TAU);
    if (reached) {
      ctx.fillStyle = 'rgba(255,140,90,0.22)';
      ctx.fill();
      ctx.strokeStyle = '#ff8c5a';
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = 'rgba(120,140,180,0.5)';
      ctx.lineWidth = 1;
    }
    ctx.stroke();
    // center marker
    ctx.fillStyle = reached ? '#ffcaa8' : '#8aa0c8';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    void sr;
  }

  // Radius probe ring + nearest line.
  if (mouseInside) {
    const cx = W2SX(mouseX), cy = W2SY(mouseZ);
    const rrx = queryR / WORLD_W * w, rry = queryR / WORLD_D * h;
    ctx.strokeStyle = 'rgba(127,230,168,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy, rrx, rry, 0, 0, MathX.TAU); ctx.stroke();

    if (nearestId >= 0 && nearestId < count) {
      const nx = W2SX(px[nearestId]), ny = W2SY(pz[nearestId]);
      ctx.strokeStyle = '#ff5d9e';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nx, ny); ctx.stroke();
      ctx.fillStyle = '#ff5d9e';
      ctx.beginPath(); ctx.ellipse(nx, ny, 4, 4, 0, 0, MathX.TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(127,230,168,0.9)';
    ctx.fillRect(cx - 1, cy - 1, 3, 3);
  }

  // AABB selection box.
  if (dragA && dragB) {
    const x0 = W2SX(Math.min(dragA.x, dragB.x)), x1 = W2SX(Math.max(dragA.x, dragB.x));
    const y0 = W2SY(Math.min(dragA.z, dragB.z)), y1 = W2SY(Math.max(dragA.z, dragB.z));
    ctx.fillStyle = 'rgba(255,209,102,0.08)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  // Small in-canvas legend.
  ctx.font = '12px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  const legend = [
    ['#7fe6a8', 'radiusQuery (probe + separation)'],
    ['#ffd166', 'queryAABB (drag select)'],
    ['#ff5d9e', 'nearest (probe → closest)'],
    ['#ff8c5a', 'insertSphere reach'],
  ];
  let ly = 12;
  for (const [c, t] of legend) {
    ctx.fillStyle = c; ctx.fillRect(14, ly + 2, 10, 10);
    ctx.fillStyle = '#9aa6ba'; ctx.fillText(t, 30, ly);
    ly += 18;
  }
}

// ----- main loop -------------------------------------------------------------
let prev = performance.now();
function frame() {
  const now = performance.now();
  let dt = (now - prev) / 1000;
  prev = now;
  if (dt > 0.05) dt = 0.05;       // clamp big hitches

  if (!paused || stepOnce) {
    simulate(stepOnce ? 1 / 60 : dt);
    stepOnce = false;
  } else {
    // Still rebuild + run tools while paused so probe/box/nearest stay live.
    let t0 = performance.now();
    rebuildHash(); tBuild = performance.now() - t0;
    t0 = performance.now(); runTools(); tHash = performance.now() - t0;
  }

  draw();

  // FPS (1s window) + HUD.
  fpsAccum += dt; fpsCount++; fpsT += dt;
  if (fpsT >= 0.5) { lastFps = fpsCount / fpsAccum; fpsAccum = 0; fpsCount = 0; fpsT = 0; }
  hud.fps.textContent    = lastFps.toFixed(0);
  hud.agents.textContent = count;
  hud.hsize.textContent  = hash.size;
  hud.hcell.textContent  = hash.cellSize;
  hud.hmax.textContent   = hash.maxRadius.toFixed(0);
  hud.qpf.textContent    = qPerFrame;
  hud.tbuild.textContent = tBuild.toFixed(2);
  hud.thash.textContent  = tHash.toFixed(2);
  hud.tbrute.textContent = bruteOn ? tBrute.toFixed(2) : 'off';
  hud.speed.textContent  = (bruteOn && tHash > 0) ? (tBrute / tHash).toFixed(1) + '×' : '—';
  hud.cand.textContent   = avgCand.toFixed(1);

  requestAnimationFrame(frame);
}

function resize() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener('resize', resize);

// Initialize after layout completes (clientWidth is 300x150 before first
// layout; the load event fires after, so the backing store matches the box).
function init() {
  resize();
  elCountV.textContent = count;
  elCellV.textContent = cellSize;
  elRadiusV.textContent = queryR;
  spawnSpheres();
  resizeFlock(count);
  requestAnimationFrame(frame);
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  window.addEventListener('load', init);
}

// Expose a few internals for headless test.js (drive the same code paths).
globalThis.__sh = {
  get hash() { return hash; },
  rebuildHash, bruteRadius,
  get count() { return count; },
  setMouse(x, z) { mouseX = x; mouseZ = z; mouseInside = true; },
  get px() { return px; }, get py() { return py; }, get pz() { return pz; },
  spheres, SPHERE_BASE, SLAB, WORLD_W, WORLD_D,
};
