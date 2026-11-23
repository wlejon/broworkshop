// Phase 3 verification: natural terrain relief, river hydrology, non-grid road
// graph, 5 elevated river bridges, organic hillside suburbs, commuter rail loop,
// bro.tiles streaming, and multi-altitude Vulkan captures.

import { WORLD_HALF, SECTOR_SIZE, WATER_Y, terrainHeight, riverCenterX, riverSignedDist } from "/app/world/terrain_field.js";
import { createCityGraph } from "/app/world/city_graph.js";
import { createTerrainStream } from "/app/world/terrain_stream.js";
import { createRiverWater } from "/app/world/river_water.js";
import { buildSectorRoadAndBridgeNodes } from "/app/world/road_bridge_mesh.js";
import { createUrbanMaterialLibrary } from "/lib/pbr-materials.js";
import { daylight } from "/lib/kit/sky.js";

function ok(cond, msg) {
    if (!cond) throw new Error(msg);
}

// 1. Verify Terrain Field Hydrology & Natural Hill Relief
let minH = Infinity, maxH = -Infinity;
for (let z = -4200; z <= 4200; z += 150) {
    const bed = terrainHeight(riverCenterX(z), z);
    ok(bed < -4.5, `river channel carved deep at z=${z} (bed=${bed.toFixed(2)})`);
    for (let x = -4200; x <= 4200; x += 200) {
        const h = terrainHeight(x, z);
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
    }
}
ok(maxH - minH > 65, `natural valley & foothill relief >= 65m (range=${(maxH - minH).toFixed(1)}m)`);
console.log(`  ok   terrain_field relief=${(maxH - minH).toFixed(1)}m (${minH.toFixed(1)}..${maxH.toFixed(1)})`);

// 2. Verify Non-Grid Road Graph, Bridges, Hillside Suburbs & Commuter Rail
const graph = createCityGraph();
ok(graph.bridges.length === 5, `5 river bridges constructed (${graph.bridges.length})`);
for (const b of graph.bridges) {
    const midY = graph.sampleRoadDeckY(b, 0.5);
    ok(midY >= WATER_Y + 11.0, `bridge ${b.id} clears river cleanly (${midY.toFixed(1)}m)`);
}

let dryNonBridgeCount = 0;
const headingBins = new Set();
for (const r of graph.roads) {
    if (!r.isBridge) {
        for (let k = 0; k <= 4; k++) {
            const t = k / 4;
            const rd = riverSignedDist(r.x0 + (r.x1 - r.x0) * t, r.z0 + (r.z1 - r.z0) * t);
            ok(rd >= 12.0, `non-bridge segment ${r.id} stays clear of river (rd=${rd.toFixed(1)}m)`);
        }
        dryNonBridgeCount++;
    }
    const deg = ((Math.atan2(r.z1 - r.z0, r.x1 - r.x0) * 180 / Math.PI) % 180 + 180) % 180;
    headingBins.add(Math.floor(deg / 15));
}
ok(dryNonBridgeCount > 300, `rich road network built (${dryNonBridgeCount} dry segments)`);
ok(headingBins.size >= 6, `non-grid directional diversity across ${headingBins.size} x 15-deg bins`);
ok(graph.stations.length === 5 && graph.transitLoop.length > 80, '5 commuter stations + closed viaduct loop');

// Check closed loop continuity
const tr0 = graph.transitLoop[0], trLast = graph.transitLoop[graph.transitLoop.length - 1];
ok(Math.hypot(trLast.x1 - tr0.x0, trLast.z1 - tr0.z0) < 0.01, 'commuter rail loop closes seamlessly');

// Check parcel seeding across representative urban + bridge + hillside sectors
let totalBuildings = 0, totalTrees = 0;
for (const [sx, sz] of [[-1, 0], [0, 0], [1, 0], [-1, -3], [-4, 0], [3, -2]]) {
    const s = graph.getSectorData(sx, sz);
    totalBuildings += s.buildings.length;
    totalTrees += s.trees.length;
    for (const b of s.buildings) {
        ok(riverSignedDist(b.x, b.z) >= 20, `building ${b.id} stays outside river`);
    }
    for (const t of s.trees) {
        ok(riverSignedDist(t.x, t.z) >= 10, `tree stays outside river`);
    }
}
ok(totalBuildings > 40 && totalTrees > 20, `seeded ${totalBuildings} buildings and ${totalTrees} trees cleanly`);
console.log(`  ok   city_graph invariants (${graph.roads.length} segments, ${headingBins.size} heading bins, 5 bridges, 5 stations)`);

// 3. Render & Visual Sanity via Headless Vulkan
const cv = document.createElement('canvas');
cv.width = 256; cv.height = 256;
document.body.appendChild(cv);
flush();

const scene = cv.getContext('scene');
ok(scene, 'scene context active');
const sky = daylight(scene, { order: ['noon'], pcf: 2, ground: [0.10, 0.13, 0.08] });
sky.apply('noon');
sky.setScale(12);

const mats = createUrbanMaterialLibrary(128);
const terrain = createTerrainStream(scene);
await terrain.whenReady();
const water = createRiverWater(scene);

const builtMeshes = [];
for (const [sx, sz] of [[-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1], [1, -1]]) {
    builtMeshes.push(buildSectorRoadAndBridgeNodes(scene, graph, graph.getSectorData(sx, sz), mats));
}

for (const [label, eye, tgt] of [
    ['bridge_closeup', [riverCenterX(0) - 180, 28, 120], [riverCenterX(0), 10, 0]],
    ['mid_flyover',    [riverCenterX(0) - 420, 220, 320], [riverCenterX(0), 12, -120]],
    ['high_vista',     [-600, 620, 820], [0, 15, -200]],
]) {
    const dx = tgt[0] - eye[0], dy = tgt[1] - eye[1], dz = tgt[2] - eye[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const fwd = [dx / dl, dy / dl, dz / dl];
    scene.setCamera({ fov: 55, near: 1.0, far: 14000, position: eye, target: tgt });
    for (let f = 0; f < 10; f++) {
        terrain.update(eye, fwd, [0, 1, 0], { width: 256, height: 256, fov: 55 });
        water.update(f * 0.016);
        scene.captureFrame();
    }
    const img = scene.captureFrame();
    const meas = bro.eye.measure(img);
    ok(meas.lumaMean > 0.06 && meas.blownWhiteRatio < 0.7,
        `${label} view renders with valid exposure (luma=${meas.lumaMean.toFixed(3)}, blown=${meas.blownWhiteRatio.toFixed(2)})`);
}

for (const b of builtMeshes) b.destroy();
water.destroy();
terrain.destroy();
document.body.removeChild(cv);
console.log('PASS: test_phase3_world');
