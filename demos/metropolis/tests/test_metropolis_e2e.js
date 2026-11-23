// Phase 4 E2E Verification: streams full 120 km² Metropolis app via __metropolis,
// captures 6 multi-distance/TOD/interior screenshots, validates Walk/Drive/Transit/Fly,
// verifies static shadow caching (shadowPagesDynamic === 0), cross-LOD step-back stability,
// and measures settled GPU frame time (< 5.0 ms -> 200+ fps target).

import { check, frames, waitFor } from "/lib/kit/test.js";
import { riverCenterX, riverHalfWidth } from "/app/world/terrain_field.js";

const OUT_DIR = "/home/j/.gemini/antigravity-cli/brain/1c5b9bd1-d3c8-4d13-9b18-65c5d395f2a9/metropolis_v2";

function lookAt(m, eye, target) {
    const dx = target[0] - eye[0];
    const dy = target[1] - eye[1];
    const dz = target[2] - eye[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    m.setPose(eye, yaw, pitch);
}

function settleView(n = 14) {
    frames(n);
    if (typeof perf !== "undefined" && typeof perf.settle === "function") perf.settle();
}

function captureAndMeasure(m, name, opts = {}) {
    const { minLuma = 0.04, maxBlown = 0.72, settleFrames = 14 } = opts;
    settleView(settleFrames);
    const img = m.scene.captureFrame();
    const meas = bro.eye.measure(img);
    screenshot(`${OUT_DIR}/${name}.png`);
    const st = m.getPerfStats();
    const gpuMs = typeof perf !== "undefined" && typeof perf.gpuFrameMs === "function" ? perf.gpuFrameMs() : 0;
    console.log(
        `  shot ${name}: luma=${meas.lumaMean.toFixed(3)} blown=${meas.blownWhiteRatio.toFixed(3)} ` +
        `seam=${(meas.seam ? meas.seam.score : 0).toFixed(3)} gpuMs=${gpuMs.toFixed(2)} ` +
        `lod0=${st.stream.activeLod0} quads=${st.stream.activeQuads} tiles=${st.tiles.drawCount || 0}`
    );
    check(meas.lumaMean >= minLuma, `${name} not black (lumaMean=${meas.lumaMean.toFixed(3)})`);
    check(meas.blownWhiteRatio <= maxBlown, `${name} not blown white (${meas.blownWhiteRatio.toFixed(3)})`);
    return { img, meas, st };
}

function findBuilding(graph, predicate) {
    for (let r = 0; r <= 7; r++) {
        for (let sx = -r; sx <= r; sx++) {
            for (let sz = -r; sz <= r; sz++) {
                if (Math.max(Math.abs(sx), Math.abs(sz)) !== r) continue;
                const sec = graph.getSectorData(sx, sz);
                for (const bp of sec.buildings) {
                    if (predicate(bp)) return bp;
                }
            }
        }
    }
    return null;
}

waitFor(() => Boolean(globalThis.__metropolis), "globalThis.__metropolis mounted", 15000);
const m = globalThis.__metropolis;
let readyDone = false;
m.whenReady().then(() => { readyDone = true; });
waitFor(() => readyDone, "metropolis initialization & flora bake", 90000);
frames(18);

const rx0 = riverCenterX(0);

// --- 1. Six Required Visual Views ---
// View 1: River, central arch bridge & skyline from open east riverbank overlook
const overX = riverCenterX(165) + 46;
lookAt(m, [overX, m.sampleTerrainHeight(overX, 165) + 22, 165], [rx0 - 240, 26, -20]);
captureAndMeasure(m, "01_river_bridge_skyline");

function findClearStreetView(m, segments, yOff = 5.2, minClear = 65) {
    for (const seg of segments) {
        const dx = seg.x1 - seg.x0, dz = seg.z1 - seg.z0;
        const len = Math.hypot(dx, dz);
        if (len < 60) continue;
        const eyeX = seg.x0 + dx * 0.25, eyeZ = seg.z0 + dz * 0.25;
        const eyeY = m.sampleTerrainHeight(eyeX, eyeZ) + yOff;
        const tx = dx / len, tz = dz / len;
        m.setPose([eyeX, eyeY, eyeZ], Math.atan2(-tx, -tz), 0.04);
        frames(4);
        const hit = m.scene.raycast([eyeX, eyeY, eyeZ], [tx, 0.03, tz], minClear);
        if (!hit) {
            return {
                eye: [eyeX, eyeY, eyeZ],
                target: [seg.x0 + dx * 1.1, m.sampleTerrainHeight(seg.x1, seg.z1) + yOff + 4.0, seg.z0 + dz * 1.1],
            };
        }
    }
    return null;
}

// View 2: Downtown grand urban avenue centered down an unobstructed road segment
const secDT = m.graph.getSectorData(-1, 0);
const urbanSegs = secDT.roads.filter((r) => r.kind === "urban");
const aveView = findClearStreetView(m, urbanSegs, 4.5, 80);
check(aveView !== null, "found unobstructed downtown urban avenue vista");
lookAt(m, aveView.eye, [aveView.target[0], aveView.target[1] + 4.0, aveView.target[2]]);
captureAndMeasure(m, "02_street_boulevard");

// View 3: Organic hillside suburbs nestled into foothill contours (elevated street view showing pitched roofs & trees)
const subSegs = [];
for (let r = 2; r <= 5; r++) {
    for (let sx = -r; sx <= r; sx++) {
        for (let sz = -r; sz <= r; sz++) {
            if (Math.max(Math.abs(sx), Math.abs(sz)) !== r) continue;
            for (const seg of m.graph.getSectorData(sx, sz).roads) {
                if (seg.kind !== "suburb") continue;
                const mx = 0.5 * (seg.x0 + seg.x1), mz = 0.5 * (seg.z0 + seg.z1);
                if (m.sampleTerrainHeight(mx, mz) > 16) subSegs.push(seg);
            }
        }
    }
}
const subView = findClearStreetView(m, subSegs, 10.5, 48);
check(subView !== null, "found unobstructed curved hillside suburb vista");
lookAt(m, subView.eye, [subView.target[0], subView.eye[1] - 5.5, subView.target[2]]);
captureAndMeasure(m, "03_suburb_hills");

// View 4: Enterable furnished LOD0 building interior
const skyscraper = findBuilding(m.graph, (bp) => bp.archetype === "skyscraper");
check(skyscraper !== null, "downtown/midtown skyscrapers populated cleanly");
const enterable = findBuilding(m.graph, (bp) => bp.archetype === "shopfront" || bp.archetype === "midrise");
check(enterable !== null, "found downtown/oldtown enterable building");
// Step right outside doorway (+Z local rotated by yaw -> [cos(yaw)*lx + sin(yaw)*lz, ly, -sin(yaw)*lx + cos(yaw)*lz])
const cy = Math.cos(enterable.yaw), sy = Math.sin(enterable.yaw);
const toLocalWorld = (lx, ly, lz) => [enterable.x + cy * lx + sy * lz, enterable.groundY + ly, enterable.z - sy * lx + cy * lz];
lookAt(m, toLocalWorld(0, 3.2, 14), toLocalWorld(0, 2.2, 0));
settleView(12);
check(m.streamer.getActiveLod0List().length >= 1, `LOD0 promoted near building (${m.streamer.getActiveLod0List().length})`);
// Step inside doorway looking straight across furnished interior toward reception desk / seating
m.setMode("walk");
lookAt(
    m,
    toLocalWorld(0, 1.65, enterable.depth * 0.28),
    toLocalWorld(0, 0.95, 0)
);
settleView(10);
const insideState = m.getState();
check(insideState.inBuilding !== null, `walk mode detects interior of ${enterable.archetype} (${enterable.id})`);
captureAndMeasure(m, "04_interior_room", { minLuma: 0.045, settleFrames: 8 });

// View 5: Night illumination with streetlights, vehicle headlights, train beam & lit skyline windows
m.setMode("fly");
m.setTimeMode("night");
lookAt(m, [overX, m.sampleTerrainHeight(overX, 165) + 22, 165], [rx0 - 240, 26, -20]);
captureAndMeasure(m, "05_dusk_night", { minLuma: 0.035, maxBlown: 0.35, settleFrames: 16 });

// View 6: High flyover panorama across river, 5 bridges, districts & hills
m.setTimeMode("day");
lookAt(m, [rx0 - 540, 350, 720], [rx0 + 40, 22, -140]);
captureAndMeasure(m, "06_flyover_high", { settleFrames: 16 });

// --- 2. Static Shadow Caching & Cross-LOD Step-Back Consistency ---
for (let step = 0; step < 5; step++) {
    lookAt(m, [rx0 - 460 + step * 45, 210, 420 - step * 35], [rx0 - 80, 18, -40]);
    settleView(6);
    const dyn = m.getPerfStats().cull.shadowPagesDynamic || 0;
    check(dyn === 0, `flyover step ${step}: static shadows remain cached (shadowPagesDynamic=${dyn})`);
}

// Step-back check vertically across quad (-1, 0) LOD1/LOD2 boundary (~340m effective height distance) over downtown
lookAt(m, [-128, 312, 128], [-220, 20, 60]); // dist3D = (312 - 18) * 1.15 = 338.1m < 340 -> LOD1
settleView(10);
const nearImg = m.scene.captureFrame();
lookAt(m, [-128, 316, 128], [-220, 20, 60]); // dist3D = (316 - 18) * 1.15 = 342.7m > 340 -> LOD2 (1.2% vertical step)
settleView(10);
const farImg = m.scene.captureFrame();
const lodCmp = bro.eye.compare(nearImg, farImg);
const lumaDiff = Math.abs(bro.eye.measure(nearImg).lumaMean - bro.eye.measure(farImg).lumaMean);
console.log(`  ok   LOD1/LOD2 horizon stability compare: ssim=${lodCmp.ssim.toFixed(3)} deltaE=${lodCmp.deltaEMean.toFixed(2)} lumaDiff=${lumaDiff.toFixed(4)}`);
check(lodCmp.ssim > 0.48 && lodCmp.deltaEMean < 12 && lumaDiff < 0.03,
    `LOD boundary stays coherent (ssim=${lodCmp.ssim.toFixed(3)}, deltaE=${lodCmp.deltaEMean.toFixed(2)}, lumaDiff=${lumaDiff.toFixed(4)})`);

// --- 3. Drive, Walk & Transit Traversal Verification ---
m.setMode("drive");
settleView(6);
const car0 = m.traffic.getHeroCar();
m.setDriveInput({ throttle: 1, steer: 0.15, brake: 0 });
frames(32);
m.setDriveInput({ throttle: 0, steer: 0, brake: 0 });
const car1 = m.traffic.getHeroCar();
const drivenDist = Math.hypot(car1.x - car0.x, car1.z - car0.z);
check(drivenDist > 1.2, `hero coupe drives forward smoothly (dist=${drivenDist.toFixed(2)}m)`);
check(car1.y > 0.25, `hero car remains on elevated deck / above river (y=${car1.y.toFixed(2)})`);
console.log(`  ok   drive mode moved hero car ${drivenDist.toFixed(2)}m, y=${car1.y.toFixed(2)}m`);

m.setMode("transit");
settleView(10);
const trState = m.getState();
check(trState.mode === "transit" && Boolean(trState.stationName), `transit mode riding near ${trState.stationName}`);
check(trState.traffic.trains >= 4, `commuter rail active (${trState.traffic.trains} trains)`);
console.log(`  ok   transit & traffic verified (station="${trState.stationName}", trains=${trState.traffic.trains}, vehicles=${trState.traffic.vehicles})`);

// --- 4. Performance Benchmark (Street & High Flyover GPU Frame Time) ---
function measureGpuMs(label) {
    const samples = [];
    for (let i = 0; i < 30; i++) {
        advanceTime(16);
        flush();
        const ms = typeof perf !== "undefined" && typeof perf.gpuFrameMs === "function" ? perf.gpuFrameMs() : 0;
        if (i >= 10 && ms > 0) samples.push(ms);
    }
    check(samples.length > 0, `${label} collected non-zero GPU frame samples`);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const sorted = samples.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    console.log(`  perf ${label}: meanGpuMs=${mean.toFixed(2)} ms (${(1000 / Math.max(0.05, mean)).toFixed(0)} fps eq), p95=${p95.toFixed(2)} ms`);
    check(mean < 5.0, `${label} mean GPU time < 5.0 ms for 200+ fps target (got ${mean.toFixed(2)} ms)`);
}

m.setMode("fly");
lookAt(m, aveView.eye, aveView.target);
settleView(12);
measureGpuMs("street_boulevard");

lookAt(m, [rx0 - 540, 350, 720], [rx0 + 40, 22, -140]);
settleView(12);
measureGpuMs("flyover_high");

console.log("PASS: test_metropolis_e2e");
