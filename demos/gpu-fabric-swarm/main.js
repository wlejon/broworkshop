// Neural GPU Swarm — 65,536-Agent Zero-Copy Table -> CUDA Tensor -> PTX Kernel -> 3D Scene
// Single canonical GPU instancing path: setShader vertex hook + setShaderBuffer + setInstanceCullSpheres.

import { $ } from "/lib/kit/dom.js";
import { sceneViewport, orbitRotation, Camera } from "/lib/kit/viewport3d.js";
import { h, fpsMeter } from "/lib/kit/index.js";
import { AGENT_COUNT, SPECIES_DEFS, createSwarmTables, buildCensusQuery } from "./data.js";
import { createSwarmGpuSim } from "./sim.js";
import { drawSpeciesCensusChart, drawChunkReuseChart } from "./charts.js";

const fs = require('fs');
const os = require('os');
const path = require('path');

const SCENE_HOOK_BK = `
module swarm_hook;
import mesh;
@binding(4, 14) var poses: read_buffer<vec4<f32>>;
@binding(4, 15) var tints: read_buffer<vec4<f32>>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
    var out = v;
    let p = poses[v.instance_index];
    out.pos = out.pos * p.w + p.xyz;
    out.v0 = tints[v.instance_index];
    return out;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
    var out = s;
    let glow = v.v0.a;
    out.base_color = v.v0.rgb * 0.65;
    out.emissive = v.v0.rgb * glow;
    return out;
}
`;

const vp = sceneViewport('#gpu-canvas', {
  orbit: { target: [0, 0, 0], rot: orbitRotation(0.55, -0.38), dist: 38, fov: 50, near: 0.2, far: 400 },
  controls: { minDist: 8, maxDist: 160 },
});
const { scene, cam, canvas } = vp;

scene.setAmbient([0.05, 0.08, 0.14]);
scene.setToneMap({ mode: 'aces' });
scene.setExposure({ compensation: 0.15 });
scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.3], color: [0.95, 0.98, 1.0], intensity: 2.2 });
scene.createLight({ type: 'directional', direction: [0.6, 0.5, 0.6], color: [0.25, 0.55, 0.95], intensity: 1.0 });

// Subtle reference core ring
scene.createMesh({
  mesh: 'torus', majorRadius: 15.0, minorRadius: 0.09, majorSegments: 72, minorSegments: 12,
  color: '#172538', emissive: 0.18, emissiveColor: '#28e0ff', y: 0,
});

const { agents, species } = createSwarmTables();
const sim = createSwarmGpuSim(agents);

// Build identity instance rows once (held GPU-resident by engine when unchanged)
const idRows = new Float32Array(AGENT_COUNT * 16);
for (let i = 0; i < AGENT_COUNT; i++) {
  const o = i * 16;
  idRows[o] = 1; idRows[o + 5] = 1; idRows[o + 10] = 1;
  idRows[o + 12] = 1; idRows[o + 13] = 1; idRows[o + 14] = 1; idRows[o + 15] = 1;
}
const flyerMesh = Mesh.octahedron(0.85);
const swarmNode = scene.createInstancedMesh({ mesh: flyerMesh, roughness: 0.3, metallic: 0.2, instances: idRows });
swarmNode.setShader({ module: SCENE_HOOK_BK });
swarmNode.setShaderBuffer('poses', sim.poseKb);
swarmNode.setShaderBuffer('tints', sim.tintKb);
swarmNode.setInstanceCullSpheres(sim.poseKb);
swarmNode.setCullBounds([-60, -35, -60], [60, 35, 60]);

// Legend strip
const legendEl = $('#species-legend');
for (const s of SPECIES_DEFS) {
  legendEl.appendChild(h('span.sci-legend-item', null,
    h('span.sci-swatch', { style: { background: s.hex } }),
    h('span', null, s.name)
  ));
}

const state = {
  paused: false,
  autoOrbit: true,
  swirl: 1.15,
  cohesion: 1.0,
  minEnergy: 0.05,
  dirtyChunks: [0, 1],
  censusRows: [],
  lastReactive: { recomputedChunks: 16, reusedChunks: 0 },
  bundleBytes: 0,
  parquetBytes: 0,
  mmapVerified: false,
};

let censusRq = buildCensusQuery(agents, state.minEnergy);
function refreshCensus(dirtyChunks) {
  if (dirtyChunks) state.dirtyChunks = dirtyChunks;
  const res = censusRq.refresh();
  state.censusRows = res.table.toArray();
  state.lastReactive = {
    recomputedChunks: res.recomputedChunks,
    reusedChunks: res.reusedChunks,
  };
  drawSpeciesCensusChart($('#chart-census'), state.censusRows);
  drawChunkReuseChart($('#chart-chunks'), state.dirtyChunks, sim.writebackTicks);
  $('#hud-reuse').textContent = `${res.reusedChunks}/16 reused`;
  $('#st-reactive').textContent = `${res.recomputedChunks} dirty / ${res.reusedChunks} reused`;
}
refreshCensus([]);

function renderVitals() {
  const el = $('#fabric-vitals');
  el.innerHTML = '';
  const rows = [
    ['Tensor Backend', `${String(sim.device).toUpperCase()} (zero-copy PTX)`],
    ['GPU Kernel Dispatch', 'dispatchTensors -> k_integrate_swarm'],
    ['Scene Instancing', 'vertex hook + GPU cullSpheres'],
    ['SpatialIndex', `pos3d (${agents.hasSpatialIndex('pos3d') ? 'ready' : 'off'})`],
    ['RangeIndex', `energy (${agents.hasRangeIndex('energy') ? 'ready' : 'off'})`],
    ['Reactive Recompute', `${state.lastReactive.recomputedChunks} / 16 chunks`],
    ['Reactive Reuse', `${state.lastReactive.reusedChunks} / 16 chunks`],
  ];
  for (const [k, v] of rows) {
    el.appendChild(h('div', null, h('span', null, k), h('b', null, v)));
  }
  $('#hud-dev').textContent = String(sim.device).toUpperCase();
  $('#st-device').textContent = String(sim.device);
  $('#device-badge').textContent = `${String(sim.device).toUpperCase()} + VULKAN`;
}

function saveAndMmapBundle() {
  const outDir = path.join(os.tmpdir(), 'broworkshop_gpu_fabric_swarm');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  const bndPath = path.join(outDir, 'swarm_state.brobundle');
  bro.table.saveBundle(bndPath, { agents, species }, { compress: false });
  const mapped = bro.table.mmapBundle(bndPath, { verify: true });
  state.bundleBytes = fs.statSync(bndPath).size;
  state.mmapVerified = !!(mapped.agents.isMapped && mapped.species.isMapped && mapped.agents.rowCount === AGENT_COUNT);
  mapped.agents.close();
  mapped.species.close();
  updateIoUi();
  return { path: bndPath, bytes: state.bundleBytes, verified: state.mmapVerified };
}

function exportParquetLz4() {
  const outDir = path.join(os.tmpdir(), 'broworkshop_gpu_fabric_swarm');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  const pqPath = path.join(outDir, 'swarm_agents_lz4.parquet');
  agents.saveParquet(pqPath, { compress: 'lz4' });
  state.parquetBytes = fs.statSync(pqPath).size;
  const rt = bro.table.fromParquetFile(pqPath, { columns: ['id', 'species_id', 'x', 'energy'] });
  const ok = rt.rowCount === AGENT_COUNT;
  updateIoUi();
  return { path: pqPath, bytes: state.parquetBytes, rows: rt.rowCount, ok };
}

function updateIoUi() {
  const el = $('#io-stats');
  el.innerHTML = '';
  el.appendChild(h('div', null,
    h('span', null, 'Bundle (.brobundle)'),
    h('b', null, state.bundleBytes ? `${(state.bundleBytes / (1024 * 1024)).toFixed(2)} MB (mmap ok)` : 'not saved yet')
  ));
  el.appendChild(h('div', null,
    h('span', null, 'Parquet (LZ4)'),
    h('b', null, state.parquetBytes ? `${(state.parquetBytes / (1024 * 1024)).toFixed(2)} MB` : 'not exported yet')
  ));
}

function triggerPulse() {
  const dirty = sim.injectEnergyPulse();
  refreshCensus(dirty);
  renderVitals();
  return dirty;
}

function syncChunks() {
  const dirty = sim.writebackChunks(2);
  refreshCensus(dirty);
  renderVitals();
  return dirty;
}

$('#btn-pulse').addEventListener('click', triggerPulse);
$('#btn-sync-chunks').addEventListener('click', syncChunks);
$('#btn-save-bundle').addEventListener('click', saveAndMmapBundle);
$('#btn-export-parquet').addEventListener('click', exportParquetLz4);
$('#btn-pause').addEventListener('click', () => {
  state.paused = !state.paused;
  $('#btn-pause').textContent = state.paused ? 'Resume' : 'Pause';
});
$('#btn-autorotate').addEventListener('click', () => {
  state.autoOrbit = !state.autoOrbit;
  $('#btn-autorotate').textContent = `Auto-Orbit: ${state.autoOrbit ? 'On' : 'Off'}`;
});
$('#btn-reframe').addEventListener('click', () => vp.reframe([0, 0, 0], 38));

const bindRange = (id, key, onChange) => {
  const el = $(id);
  const valEl = $(id + '-val');
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    state[key] = v;
    if (valEl) valEl.textContent = v.toFixed(2);
    if (onChange) onChange(v);
  });
};
bindRange('#opt-swirl', 'swirl');
bindRange('#opt-cohesion', 'cohesion');
bindRange('#opt-energy-min', 'minEnergy', (v) => {
  censusRq.dispose();
  censusRq = buildCensusQuery(agents, v);
  refreshCensus(state.dirtyChunks);
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const ray = vp.ray(e.clientX - rect.left, e.clientY - rect.top);
  if (!ray) return;
  // Intersect click ray near pivot plane and query 3D SpatialIndex
  const denom = ray.dir[1];
  let pt = [0, 0, 0];
  if (Math.abs(denom) > 1e-3) {
    const t = -ray.origin[1] / denom;
    if (t > 0 && t < 200) {
      pt = [ray.origin[0] + ray.dir[0] * t, 0, ray.origin[2] + ray.dir[2] * t];
    }
  }
  const near = agents.nearest('pos3d', pt, 3, 25.0);
  if (near.rowCount > 0) {
    const sid = near.get(0, 'species_id') | 0;
    const spName = SPECIES_DEFS[sid] ? SPECIES_DEFS[sid].name : `Species ${sid}`;
    $('#probe-box').textContent =
      `agent #${near.get(0, 'id')} · ${spName}\n` +
      `pos=(${near.get(0, 'x').toFixed(2)}, ${near.get(0, 'y').toFixed(2)}, ${near.get(0, 'z').toFixed(2)})\n` +
      `energy=${near.get(0, 'energy').toFixed(3)} · dist=${near.get(0, '_distance').toFixed(2)}`;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    state.paused = !state.paused;
    $('#btn-pause').textContent = state.paused ? 'Resume' : 'Pause';
  } else if (e.key === 'r' || e.key === 'R') {
    vp.reframe([0, 0, 0], 38);
  }
});

const fps = fpsMeter();
let frameNo = 0;

// Kick one initial GPU simulation step immediately so first rendered frame is live
sim.stepGpu(0.016, state.swirl, state.cohesion);
renderVitals();
$('#status').textContent = 'ready';

vp.onFrame((dt) => {
  const f = fps.tick();
  if (!state.paused) {
    if (state.autoOrbit) Camera.orbitLook(cam, 24 * dt, 0);
    sim.stepGpu(dt, state.swirl, state.cohesion);
    $('#hud-step').textContent = String(sim.stepCount);
  }
  if (++frameNo % 15 === 0) {
    $('#st-fps').textContent = f ? f.toFixed(0) : '0';
    $('#st-sim-ms').textContent = `${sim.lastStepMs.toFixed(2)} ms`;
    const cs = scene.cullStats();
    if (cs) $('#st-draws').textContent = `${cs.instancedDrawn} node / ${AGENT_COUNT.toLocaleString()} inst`;
    drawSpeciesCensusChart($('#chart-census'), state.censusRows);
    drawChunkReuseChart($('#chart-chunks'), state.dirtyChunks, sim.writebackTicks);
  }
});

globalThis.__swarmDemo = {
  agents,
  species,
  sim,
  state,
  swarmNode,
  scene,
  triggerPulse,
  syncChunks,
  saveAndMmapBundle,
  exportParquetLz4,
};
