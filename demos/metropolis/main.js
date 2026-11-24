// Metropolis: a city grown from its land. A street field (tensor streamlines
// shaped by the river, the hills and the district cores) traces the roads; the
// blocks between them fill with lots by zone; every building is composed of
// masses (podiums, shafts, wings, roofs, plant), each one record the GPU draws
// with its facade and rooms (lib/city). Terrain streams through
// bro.tiles, the river is a ribbon, the sky is lib/kit's daylight.

import { SKY, daylight } from "/lib/kit/sky.js";
import { loadOrGenerateCity, growInWorker } from "/lib/city/cache.js";
import { createBuildingRenderer } from "/lib/city/building_render.js";
import { createBridges } from "/lib/city/bridges.js";
import { createTrafficRenderer } from "/lib/city/traffic_render.js";
import { createInteriors } from "/lib/city/interior.js";
import { terrainHeight, riverCenterX, RIVER_BED_Y } from "/app/world/terrain_field.js";
import { SITE } from "/app/world/site.js";
import { createTerrainStream } from "/app/world/terrain_stream.js";
import { createRiverWater } from "/app/world/river_water.js";
import { createFlyCamera } from "/app/player/fly.js";

const fs = require('fs');
const readLib = (p) => fs.readFileSync(bro.resolvePath('/lib/' + p), 'utf8');

const canvas = document.getElementById('stage');
canvas.width = window.innerWidth || 1600;
canvas.height = window.innerHeight || 960;
const scene = canvas.getContext('scene');
if (!scene || !bro.tiles) {
    document.getElementById('unavailable').hidden = false;
    throw new Error('Metropolis requires bro.scene and bro.tiles');
}

const SKY_PRESETS = {
    day:   { ...SKY.afternoon, exposure: { mode: 'auto', meter: 'incident' } },
    dusk:  { ...SKY.golden,    exposure: { mode: 'auto', meter: 'incident' } },
    night: {
        label: 'Night',
        hdri: 'dikhololo_night', envIntensity: 0.02, envRotation: 0.0,
        sun: { direction: [-0.35, -0.78, -0.50], color: [0.58, 0.70, 0.96], intensity: 0.25 },
        shadow: false,
        exposure: { mode: 'fixed', ev: 3.5 },
        fog: { start: 60, end: 900, color: [0.004, 0.006, 0.012] },
        ambientFallback: [0.004, 0.005, 0.008],
        emissiveGain: 1, fireflies: 0,
    },
};
const NIGHT = { day: 0, dusk: 0.55, night: 1 };

const sky = daylight(scene, { presets: SKY_PRESETS, order: ['day', 'dusk', 'night'], pcf: 2, ground: [0.09, 0.13, 0.06] });
sky.apply('day');
sky.setScale(16);
// Contact shading at a room's scale (corners, under shelves and desks); from
// a street or the air it is under a pixel and costs the same.
scene.setSSAO({ enabled: true, radius: 0.6, intensity: 1, bias: 0.02 });

const water = createRiverWater(scene);
const cam = createFlyCamera(canvas, scene);

const statusEl = document.getElementById('status');
// The city is grown in a worker into the app's cache (world/grow_worker.js,
// lib/city/city_worker.js; keyed on lib/city and world/), so a cold start or
// a lib/city edit leaves the window live while it grows; the page then reads
// it back.
const tg = perf.now();
if (statusEl) statusEl.textContent = 'growing the city';
const grown = await growInWorker(new URL('./world/grow_worker.js', import.meta.url), { sources: ['/app/world'] });
if (!grown.ok) console.warn(`metropolis: city worker failed (${grown.error}); growing it here`);
else console.log(`metropolis: city grown in a worker in ${(perf.now() - tg).toFixed(0)} ms (${grown.hit ? 'cached' : 'generated'})`);
const t0 = perf.now();
const { city, hit: cityCached } = loadOrGenerateCity(SITE, { sources: ['/app/world'] });
console.log(`metropolis: city in ${(perf.now() - t0).toFixed(0)} ms (${cityCached ? 'cache hit' : 'cache miss'}): ${city.graph.edges.length} roads, ${city.lots.length} lots, ${city.masses.count} masses`,
    JSON.stringify(Object.fromEntries(Object.entries(city.timings).map(([k, v]) => [k, Math.round(v)]))));

const ground = city.ground;
const terrain = createTerrainStream(scene, ground);

let timeMode = 'day';
let buildings = null;
let bridges = null;
let cars = null;
let interiors = null;

const ready = Promise.all([
    // The bridges: decks along the graph's bridge edges, on piers in the river.
    createBridges(scene, city.graph, readLib('city/bridge.bk'), { waterBed: RIVER_BED_Y - 1 }).then((b) => { bridges = b; }),
    // The interiors cut the open buildings' footprints out of the ground too.
    Promise.all([terrain.whenReady(), createBuildingRenderer(scene, city.masses, readLib('city/building.bk'))]).then(([, b]) => {
        buildings = b;
        terrain.node.setShaderBuffer('masses', b.masses);
        interiors = createInteriors(scene, city.masses, b.walls, [terrain.node]);
    }),
    // Traffic on the road graph, simulated in a worker: lanes both ways, lights at the junctions.
    createTrafficRenderer(scene, city.graph, city.field.density, readLib('city/car.bk'), { count: 12000, lines: city.transit }).then((c) => { cars = c; }),
]).then(() => { if (statusEl) statusEl.textContent = 'ready'; });

const todButtons = [...document.querySelectorAll('#todButtons [data-tod]')];
for (const b of todButtons) b.addEventListener('click', () => setTimeMode(b.dataset.tod));
function setTimeMode(tm) {
    if (!SKY_PRESETS[tm]) return;
    timeMode = tm;
    sky.apply(tm);
    buildings?.setNight(NIGHT[tm]);
    bridges?.setNight(NIGHT[tm] > 0.5 ? 1 : 0);
    cars?.setNight(NIGHT[tm]);
    terrain.setNight(NIGHT[tm] > 0.5 ? 1 : 0);
    for (const b of todButtons) b.classList.toggle('active', b.dataset.tod === tm);
}

const rx = riverCenterX(0);
cam.setPose([rx + 120, terrainHeight(rx + 120, 300) + 60, 300], 0.9, -0.12);

window.addEventListener('keydown', (e) => {
    if (e.key === '1') setTimeMode('day');
    else if (e.key === '2') setTimeMode('dusk');
    else if (e.key === '3') setTimeMode('night');
    else if (e.key.toLowerCase() === 'h') { const h = document.getElementById('hud'); h.hidden = !h.hidden; }
});

const statsEl = document.getElementById('perfStats');
let statFrames = 0, statMs = 0, statAt = 0;
function showStats(dt, st) {
    statFrames++; statMs += dt * 1000;
    const now = performance.now();
    if (now - statAt < 500) return;
    statAt = now;
    const cs = scene.cullStats();
    const agl = st.pos[1] - terrainHeight(st.pos[0], st.pos[2]);
    statsEl.textContent =
        `${(statMs / statFrames).toFixed(2)} ms/frame  gpu ${(cs.frameGpuMs || 0).toFixed(2)} ms\n` +
        `${city.masses.buildings.length} buildings ·${(city.graph.edges.reduce((a, e) => a + e.len, 0) / 1000).toFixed(0)} km of road · ${cars?.drawn ?? 0} of ${cars?.cars ?? 0} cars drawn\n` +
        `x ${st.pos[0].toFixed(0)} z ${st.pos[2].toFixed(0)} · ${agl.toFixed(0)} m up`;
    statFrames = 0; statMs = 0;
}

// The view the tile cache selects for: the canvas as shown (its CSS box fills
// the window, which can be resized after canvas.width was set), so tiles at
// the screen's edges are inside its frustum.
const viewOf = (st) => ({ width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height, fov: st.fov });

let last = performance.now(), simTime = 0;
function tick() {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
    last = now; simTime += dt;
    cam.update(dt);
    const st = cam.state();
    terrain.update(st.pos, st.fwd, st.up, viewOf(st));
    water.update(simTime);
    sky.update(dt);
    cars?.update(dt, st.pos, st.fwd);
    interiors?.update(st.pos, NIGHT[timeMode], dt);
    showStats(dt, st);
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
if (bro.app.argv.includes('--bench')) ready.then(() => import('./tests/bench_window.js')).then((b) => b.run(globalThis.__metropolis));

globalThis.__metropolis = {
    scene, sky, city, ground, terrain, cam, get cars() { return cars; }, get interiors() { return interiors; }, get buildings() { return buildings; },
    whenReady: () => ready,
    setTimeMode,
    setPose: (pos, yaw, pitch) => {
        cam.setPose(pos, yaw, pitch);
        const st = cam.state();
        terrain.update(st.pos, st.fwd, st.up, viewOf(st));
    },
    lookAt(eye, target) {
        const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
        this.setPose(eye, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    },
};
