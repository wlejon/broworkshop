// Parquet Earth Atlas — CSV Ingest, Parquet (LZ4 & Snappy), mmap Bundles,
// Incremental ReactiveQuery leftJoin + groupBy, & Single Canonical 3D Globe.

import { $ } from "/lib/kit/dom.js";
import { sceneViewport, orbitRotation, Camera } from "/lib/kit/viewport3d.js";
import { h, fpsMeter } from "/lib/kit/index.js";
import {
  GLOBE_RADIUS,
  REGION_DEFS,
  latLonToSphere,
  depthColor,
  loadOrBuildEarthTables,
} from "./data.js";
import { drawRegionalChart, drawMagnitudeHistogram } from "./charts.js";

const fs = require('fs');
const path = require('path');

const GLOBE_MARKERS_BK = `
module atlas_markers;
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
    out.base_color = v.v0.rgb * 0.3;
    out.emissive = v.v0.rgb * v.v0.a;
    return out;
}
`;

const q = bro.table;
const dataset = loadOrBuildEarthTables();
let { events, stations, regions } = dataset;

const vp = sceneViewport('#gpu-canvas', {
  orbit: { target: [0, 0, 0], rot: orbitRotation(0.75, -0.32), dist: 24, fov: 46, near: 0.2, far: 300 },
  controls: { minDist: 11.8, maxDist: 90 },
});
const { scene, cam, canvas } = vp;

scene.setAmbient([0.08, 0.12, 0.20]);
scene.setToneMap({ mode: 'aces' });
scene.setExposure({ compensation: 0.1 });
scene.createLight({ type: 'directional', direction: [-0.4, -0.8, -0.5], color: [0.92, 0.96, 1.0], intensity: 2.0 });
scene.createLight({ type: 'directional', direction: [0.6, 0.4, 0.7], color: [0.22, 0.48, 0.85], intensity: 0.9 });

// Earth globe core & subtle equator / polar meridian rings
scene.createMesh({
  mesh: 'sphere', radius: GLOBE_RADIUS - 0.04, segments: 48, rings: 32,
  color: '#0b1829', roughness: 0.82, metallic: 0.1,
});
scene.createMesh({
  mesh: 'torus', majorRadius: GLOBE_RADIUS + 0.03, minorRadius: 0.025, majorSegments: 96, minorSegments: 8,
  color: '#1f4266', emissive: 0.25, emissiveColor: '#28e0ff',
});

let markerNode = null;
let poseKb = null;
let tintKb = null;
let packedCapacity = 0;

function syncGlobeMarkers() {
  const n = events.rowCount;
  if (n !== packedCapacity || !poseKb || !tintKb) {
    poseKb = events.packToKernelBuffer(['sx', 'sy', 'sz', 'radius'], { layout: 'aos', dtype: 'f32', residency: 'gpu' });
    tintKb = events.packToKernelBuffer(['cr', 'cg', 'cb', 'alpha'], { layout: 'aos', dtype: 'f32', residency: 'gpu' });
    if (markerNode) markerNode.destroy();
    const idRows = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      idRows[o] = 1; idRows[o + 5] = 1; idRows[o + 10] = 1;
      idRows[o + 12] = 1; idRows[o + 13] = 1; idRows[o + 14] = 1; idRows[o + 15] = 1;
    }
    markerNode = scene.createInstancedMesh({
      mesh: Mesh.octahedron(1.0),
      roughness: 0.35,
      metallic: 0.15,
      instances: idRows,
    });
    markerNode.setShader({ module: GLOBE_MARKERS_BK });
    markerNode.setShaderBuffer('poses', poseKb);
    markerNode.setShaderBuffer('tints', tintKb);
    markerNode.setInstanceCullSpheres(poseKb);
    markerNode.setCullBounds([-14, -14, -14], [14, 14, 14]);
    packedCapacity = n;
  } else {
    events.packToKernelBuffer(['sx', 'sy', 'sz', 'radius'], { layout: 'aos', dtype: 'f32', residency: 'gpu', target: poseKb });
    events.packToKernelBuffer(['cr', 'cg', 'cb', 'alpha'], { layout: 'aos', dtype: 'f32', residency: 'gpu', target: tintKb });
    markerNode.setInstanceCullSpheres(poseKb);
  }
}
syncGlobeMarkers();

// Legend bar
const legendEl = $('#depth-legend');
for (const [hex, label] of [['#28e0ff', 'Shallow <70 km'], ['#ffbd3d', 'Intermediate 70-250 km'], ['#ff4fd8', 'Deep Trench >250 km']]) {
  legendEl.appendChild(h('span.sci-legend-item', null, h('span.sci-swatch', { style: { background: hex } }), h('span', null, label)));
}

const state = {
  autoOrbit: true,
  minMag: 2.0,
  snappyParquetBytes: 0,
  lz4ParquetBytes: dataset.lz4ParquetBytes,
  bundleBytes: dataset.bundleBytes,
  csvBytes: dataset.csvBytes,
  lastGroupStats: { recomputedChunks: events.chunkCount, reusedChunks: 0 },
  lastJoinStats: { recomputedChunks: events.chunkCount, reusedChunks: 0 },
  groupRows: [],
  nullStationCount: 0,
  mmapVerified: false,
};

const stationsSnap = stations.snapshot();
let rqGroup = events.query()
  .where(q.ge('mag', state.minMag))
  .groupBy(['region_id'])
  .agg({ count: q.count(), avgMag: q.avg('mag'), maxMag: q.max('mag'), avgDepth: q.avg('depth_km') })
  .orderBy('region_id')
  .reactive();

let rqJoin = events.query()
  .leftJoin(stationsSnap, 'station_id', 'station_id')
  .select({ eid: 'left.event_id', mag: 'left.mag', station_code: 'right.code' })
  .reactive();

function refreshAnalytics() {
  const gr = rqGroup.refresh();
  const jr = rqJoin.refresh();
  state.groupRows = gr.table.toArray();
  state.lastGroupStats = { recomputedChunks: gr.recomputedChunks, reusedChunks: gr.reusedChunks };
  state.lastJoinStats = { recomputedChunks: jr.recomputedChunks, reusedChunks: jr.reusedChunks };
  state.nullStationCount = jr.table.query().where(q.isNull('station_code')).count();

  // Magnitude histogram via RangeIndex range filters
  const bins = [[2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 10]];
  const labels = ['2-3', '3-4', '4-5', '5-6', '6-7', '7+'];
  const counts = bins.map(([lo, hi]) =>
    events.query().where(q.and(q.ge('mag', lo), q.lt('mag', hi))).count()
  );

  // Top-5 strongest via RangeIndex orderBy limit
  const top = events.query().orderBy('mag', 'desc').limit(5).toArray();
  const topEl = $('#top-quakes');
  topEl.innerHTML = '';
  for (const r of top) {
    const reg = REGION_DEFS[r.region_id | 0] || REGION_DEFS[0];
    topEl.appendChild(h('div.atlas-top-row', null,
      h('span', null, `#${r.event_id} · ${reg.name.split(' ')[0]}`),
      h('span', null, `Mw ${r.mag.toFixed(2)} · ${Math.round(r.depth_km)}km`)
    ));
  }

  drawRegionalChart($('#chart-regions'), state.groupRows);
  drawMagnitudeHistogram($('#chart-mag'), counts, labels);

  const joinVitals = $('#join-vitals');
  joinVitals.innerHTML = '';
  for (const [k, v] of [
    ['GroupBy Chunks Reused', `${gr.reusedChunks} / ${events.chunkCount}`],
    ['LeftJoin Chunks Reused', `${jr.reusedChunks} / ${events.chunkCount}`],
    ['Unmonitored (NULL station)', state.nullStationCount.toLocaleString()],
    ['Active Filter Rows', jr.table.rowCount.toLocaleString()],
  ]) {
    joinVitals.appendChild(h('div', null, h('span', null, k), h('b', null, v)));
  }

  const fmtEl = $('#format-stats');
  fmtEl.innerHTML = '';
  const fmtKb = (b) => b ? `${(b / 1024).toFixed(1)} KB` : 'click button';
  for (const [k, v] of [
    ['CSV Ingest (regions+stations)', fmtKb(state.csvBytes)],
    ['Parquet (LZ4)', fmtKb(state.lz4ParquetBytes)],
    ['Parquet (Snappy)', fmtKb(state.snappyParquetBytes)],
    ['.brobundle (4096B mmap)', fmtKb(state.bundleBytes)],
  ]) {
    fmtEl.appendChild(h('div', null, h('span', null, k), h('b', null, v)));
  }

  $('#atlas-badge').textContent = `${events.rowCount.toLocaleString()} EVENTS`;
  $('#hud-count').textContent = events.rowCount.toLocaleString();
  $('#hud-nulls').textContent = state.nullStationCount.toLocaleString();
  $('#hud-reuse').textContent = `${gr.reusedChunks}/${events.chunkCount} reused`;
  $('#st-events').textContent = events.rowCount.toLocaleString();
  $('#st-stations').textContent = stations.rowCount.toLocaleString();
  $('#st-parquet').textContent = state.snappyParquetBytes
    ? `${(state.lz4ParquetBytes / 1024).toFixed(0)}K LZ4 / ${(state.snappyParquetBytes / 1024).toFixed(0)}K Snappy`
    : `${(state.lz4ParquetBytes / 1024).toFixed(0)} KB LZ4`;
  $('#st-bundle').textContent = `${(state.bundleBytes / (1024 * 1024)).toFixed(2)} MB`;
  $('#st-reactive').textContent = `agg=${gr.reusedChunks}/${events.chunkCount}, join=${jr.reusedChunks}/${events.chunkCount}`;
}

function triggerAftershockBurst() {
  const baseId = events.rowCount;
  const reg = REGION_DEFS[0]; // Japan Trench cluster -> appends to tail chunk only
  const burst = [];
  for (let i = 0; i < 128; i++) {
    const lat = reg.lat + Math.sin(i * 0.4) * 2.2;
    const lon = reg.lon + Math.cos(i * 0.3) * 2.5;
    const depth = 18.0 + (i % 40) * 3.5;
    const mag = 4.2 + (i % 32) * 0.08;
    const elev = GLOBE_RADIUS + 0.1 + (mag - 1.8) * 0.14;
    const [sx, sy, sz] = latLonToSphere(lat, lon, elev);
    const [cr, cg, cb] = depthColor(depth);
    burst.push({
      event_id: baseId + i,
      region_id: reg.id,
      station_id: i % 8 === 0 ? null : (i % 16),
      lat, lon, depth_km: depth, mag,
      sx, sy, sz, radius: 0.09 + (mag - 1.8) * 0.025,
      cr, cg, cb, alpha: 1.4,
    });
  }
  events.insertMany(burst);
  syncGlobeMarkers();
  refreshAnalytics();
  return events.rowCount;
}

function simulateStationOutage() {
  // Mutate a localized slice inside chunk 2 only so untouched chunks stay reused
  const start = 8200;
  const end = Math.min(events.rowCount, start + 120);
  for (let r = start; r < end; r++) {
    events.updateRow(r, { station_id: null });
  }
  refreshAnalytics();
  return end - start;
}

function roundTripParquet(codec) {
  const outPath = path.join(dataset.dataDir, `events_${codec}.parquet`);
  events.saveParquet(outPath, { compress: codec });
  const bytes = fs.statSync(outPath).size;
  const loaded = q.fromParquetFile(outPath, { columns: ['event_id', 'region_id', 'station_id', 'mag'] });
  if (codec === 'lz4') state.lz4ParquetBytes = bytes;
  else state.snappyParquetBytes = bytes;
  refreshAnalytics();
  return { codec, bytes, rows: loaded.rowCount, ok: loaded.rowCount === events.rowCount };
}

function saveAndMmapAtlasBundle() {
  q.saveBundle(dataset.bundlePath, { events, stations, regions }, { compress: false });
  state.bundleBytes = fs.statSync(dataset.bundlePath).size;
  const mapped = q.mmapBundle(dataset.bundlePath, { verify: true });
  const ok = !!(mapped.events.isMapped && mapped.stations.isMapped && mapped.regions.isMapped &&
                mapped.events.rowCount === events.rowCount);
  mapped.events.close();
  mapped.stations.close();
  mapped.regions.close();
  state.mmapVerified = ok;
  refreshAnalytics();
  return { bytes: state.bundleBytes, ok };
}

$('#btn-aftershock').addEventListener('click', triggerAftershockBurst);
$('#btn-outage').addEventListener('click', simulateStationOutage);
$('#btn-compact').addEventListener('click', () => { events.compact(); syncGlobeMarkers(); refreshAnalytics(); });
$('#btn-pq-lz4').addEventListener('click', () => roundTripParquet('lz4'));
$('#btn-pq-snappy').addEventListener('click', () => roundTripParquet('snappy'));
$('#btn-bundle').addEventListener('click', saveAndMmapAtlasBundle);
$('#btn-autorotate').addEventListener('click', () => {
  state.autoOrbit = !state.autoOrbit;
  $('#btn-autorotate').textContent = `Auto-Orbit: ${state.autoOrbit ? 'On' : 'Off'}`;
});

$('#opt-min-mag').addEventListener('input', (e) => {
  state.minMag = parseFloat(e.target.value);
  $('#opt-min-mag-val').textContent = state.minMag.toFixed(2);
  rqGroup.dispose();
  rqGroup = events.query()
    .where(q.ge('mag', state.minMag))
    .groupBy(['region_id'])
    .agg({ count: q.count(), avgMag: q.avg('mag'), maxMag: q.max('mag'), avgDepth: q.avg('depth_km') })
    .orderBy('region_id')
    .reactive();
  refreshAnalytics();
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const ray = vp.ray(e.clientX - rect.left, e.clientY - rect.top);
  if (!ray) return;
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  const b = ox * dx + oy * dy + oz * dz;
  const c = (ox * ox + oy * oy + oz * oz) - GLOBE_RADIUS * GLOBE_RADIUS;
  const disc = b * b - c;
  if (disc < 0) return;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return;
  const hit = [ox + dx * t, oy + dy * t, oz + dz * t];
  const near = events.nearest('pos3d', hit, 1, 6.0);
  if (near.rowCount > 0) {
    const rid = near.get(0, 'region_id') | 0;
    const stId = near.get(0, 'station_id');
    const regRow = regions.query().where({ region_id: rid }).toArray()[0];
    const stRow = stId == null ? null : stations.query().where({ station_id: stId }).toArray()[0];
    $('#probe-box').textContent =
      `event #${near.get(0, 'event_id')} · Mw ${near.get(0, 'mag').toFixed(2)} · depth ${near.get(0, 'depth_km').toFixed(0)} km\n` +
      `belt: ${regRow ? regRow.name : 'Unknown'}\n` +
      `station: ${stRow ? `${stRow.code} (#${stRow.station_id})` : 'UNMONITORED (NULL)'}`;
  }
});

const fps = fpsMeter();
let frameNo = 0;

refreshAnalytics();
$('#status').textContent = 'ready';

vp.onFrame((dt) => {
  const f = fps.tick();
  if (state.autoOrbit) Camera.orbitLook(cam, 14 * dt, 0);
  if (++frameNo % 20 === 0) {
    $('#st-fps').textContent = f ? f.toFixed(0) : '0';
  }
});

globalThis.__earthAtlas = {
  dataset,
  events,
  stations,
  regions,
  state,
  markerNode,
  triggerAftershockBurst,
  simulateStationOutage,
  roundTripParquet,
  saveAndMmapAtlasBundle,
};
