// Metropolis — Phase 3 clean boot entry (terrain + river hydrology + non-grid roads & bridges).
// Phase 4 adds streamed buildings, interior volumes, vehicles, rail cars, and flora trees.

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight } from "/lib/kit/sky.js";
import { createUrbanMaterialLibrary } from "/lib/pbr-materials.js";
import { SECTOR_SIZE, terrainHeight, riverCenterX } from "/app/world/terrain_field.js";
import { createCityGraph } from "/app/world/city_graph.js";
import { createTerrainStream } from "/app/world/terrain_stream.js";
import { createRiverWater } from "/app/world/river_water.js";
import { buildSectorRoadAndBridgeNodes } from "/app/world/road_bridge_mesh.js";

const statusEl = document.getElementById('status');
const perfEl = document.getElementById('perfStats');

const vp = sceneViewport('#stage', {
    orbit: {
        target: [riverCenterX(0) - 80, 12, 0],
        dist: 240,
        fov: 58,
        near: 0.6,
        far: 14000,
        rot: orbitRotation(0.65, -0.32),
    },
    controls: { orbitButton: 0, panButton: 2, minDist: 2, maxDist: 4500 },
});

const { scene } = vp;
const sky = daylight(scene, { order: ['noon', 'golden', 'dawn', 'night'], pcf: 2, ground: [0.10, 0.14, 0.08] });
sky.apply('noon');
sky.setScale(14);

const graph = createCityGraph();
const mats = createUrbanMaterialLibrary(128);
const terrain = createTerrainStream(scene);
const water = createRiverWater(scene);
const activeSectors = new Map();

function syncSectors(eye) {
    const csx = Math.floor(eye[0] / SECTOR_SIZE), csz = Math.floor(eye[2] / SECTOR_SIZE);
    const keep = new Set();
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const sx = csx + dx, sz = csz + dz;
        const k = `${sx},${sz}`;
        keep.add(k);
        if (!activeSectors.has(k)) {
            activeSectors.set(k, buildSectorRoadAndBridgeNodes(scene, graph, graph.getSectorData(sx, sz), mats));
        }
    }
    for (const [k, built] of activeSectors) {
        if (keep.has(k)) continue;
        built.destroy();
        activeSectors.delete(k);
    }
}

let curPos = [riverCenterX(0) - 180, 120, 220];
let curFwd = [0.5, -0.35, -0.78];
let curUp = [0, 1, 0];

vp.onView((view) => {
    curPos = view.position;
    const dx = view.target[0] - curPos[0], dy = view.target[1] - curPos[1], dz = view.target[2] - curPos[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    curFwd = [dx / dl, dy / dl, dz / dl];
    curUp = view.up || [0, 1, 0];
});

let simTime = 0;
vp.onFrame((dt) => {
    simTime += dt;
    terrain.update(curPos, curFwd, curUp, { width: 1600, height: 960, fov: 58 });
    water.update(simTime);
    syncSectors(curPos);
    sky.update(dt);
    if (perfEl) {
        const ts = terrain.stats();
        const st = scene.cullStats();
        perfEl.textContent = `tiles ${ts.drawCount} (${ts.pending} pend) | sectors ${activeSectors.size} | gpu ${(st.frameGpuMs || 0).toFixed(2)} ms`;
    }
});

let readyFlag = false;
terrain.whenReady().then(() => {
    syncSectors(curPos);
    readyFlag = true;
    if (statusEl) statusEl.textContent = 'ready';
});

globalThis.__metropolis = {
    get ready() { return readyFlag; },
    whenReady: () => terrain.whenReady(),
    scene,
    graph,
    terrain,
    sampleTerrainHeight: terrainHeight,
};
