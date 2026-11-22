// Stacked additive+subtractive Sparse Voxel DAG showcase world:
// Heightfield terrain with carve cutouts + 4 concentric/hero SVDAG regions.
import { flyCamera } from "/lib/kit/flycam.js";
import { skyEnvironment, sunDirection } from "/lib/kit/sky.js";
import { createTerrainMesh, heightAt, raycastTerrain } from "/app/terrain.js";
import { buildArchetypes } from "/app/archetypes.js";

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export const canvas = document.getElementById('stage');
export const scene = canvas ? canvas.getContext('scene') : null;
export const available = Boolean(scene && typeof bro !== 'undefined' && bro.voxeldag && bro.kernel?.gpu);

/** Build a flyCamera pose { pos, yaw, pitch } aimed from `pos` toward `target`. */
export function lookPose(pos, target) {
    const dx = target[0] - pos[0], dy = target[1] - pos[1], dz = target[2] - pos[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const fx = dx / len, fy = dy / len, fz = dz / len;
    return {
        pos: pos.slice(),
        yaw: Math.atan2(-fx, -fz),
        pitch: Math.asin(clamp(fy, -0.995, 0.995)),
    };
}

export const PRESETS = {
    overview:  { label: '1 Valley Overview',   pose: lookPose([-54, 52, 86], [8, 22, -26]) },
    cavern:    { label: '2 Cliff Cavern',      pose: lookPose([-32, 21.8, -33], [-24, 22.8, -56]) },
    overhang:  { label: '3 Cliff Overhang',    pose: lookPose([26, 20.5, -24], [40, 23.6, -46]) },
    forest:    { label: '4 LOD Horizon',       pose: lookPose([-146, 74, 130], [55, 28, -85]) },
    windmills: { label: '5 Windmill Meadow',   pose: lookPose([-38, 33, 68], [-86, 23, 24]) },
    fractal:   { label: '6 Fractal Monument',  pose: lookPose([38, 35, 52], [72, 36, 18]) },
};

export const TIME_PRESETS = {
    afternoon: {
        label: 'Afternoon', hdri: 'kloofendal_43d_clear_puresky', envIntensity: 0.92, envRotation: 2.3,
        elevation: 36, heading: 205, intensity: 3.6, color: [1.0, 0.96, 0.88],
        exposure: -0.15, fog: { start: 420, end: 1650, color: [0.68, 0.78, 0.90] },
        ambient: [0.30, 0.34, 0.38],
    },
    golden: {
        label: 'Golden Hour', hdri: 'the_sky_is_on_fire', envIntensity: 0.50, envRotation: 3.6,
        elevation: 15, heading: 230, intensity: 4.2, color: [1.0, 0.68, 0.36],
        exposure: -0.10, fog: { start: 340, end: 1400, color: [0.84, 0.58, 0.42] },
        ambient: [0.28, 0.22, 0.20],
    },
    dawn: {
        label: 'Dawn', hdri: 'spruit_sunrise', envIntensity: 0.65, envRotation: 1.8,
        elevation: 18, heading: 145, intensity: 3.4, color: [1.0, 0.82, 0.62],
        exposure: -0.05, fog: { start: 360, end: 1500, color: [0.78, 0.74, 0.72] },
        ambient: [0.26, 0.26, 0.30],
    },
    dusk: {
        label: 'Dusk', hdri: 'dikhololo_night', envIntensity: 0.72, envRotation: 0.0,
        elevation: 14, heading: 210, intensity: 0.65, color: [0.58, 0.68, 0.95],
        exposure: 0.38, fog: { start: 260, end: 1100, color: [0.10, 0.14, 0.24] },
        ambient: [0.10, 0.13, 0.22],
    },
};

export const SCULPT_TOOLS = {
    carve:    'Carve Cave',
    arch:     'Stone Arch',
    grove:    'Sway Grove',
    windmill: 'Windmill',
    beacon:   'Crystal',
};

export const settings = {
    showVoxelDag: true,
    showTerrain: true,
    carveCutouts: true,
    autoAnimate: true,
    lodScale: 1.0,
    maxRaySteps: 128,
    animFps: 8,
    timeOfDay: 'afternoon',
};

export const sculpt = { tool: 'carve', edits: 0 };

function hash2u(ix, iz) {
    let n = Math.imul(ix, 1597334677) ^ Math.imul(iz, 3812015801);
    n = Math.imul(n ^ (n >>> 15), 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function buildWorld(sceneGraph) {
    sceneGraph.setToneMap({ mode: 'aces', gamma: 2.2 });
    sceneGraph.setShadowQuality({ pcfTaps: 3 });

    const light = sceneGraph.createLight({ type: 'directional', castsShadow: true });
    light.shadowNormalBias = 0.05;

    const tNode = createTerrainMesh(sceneGraph);
    const voxelWorld = bro.voxeldag.createWorld(sceneGraph);
    voxelWorld.setLodScale(settings.lodScale);
    voxelWorld.setMaxRaySteps(settings.maxRaySteps);
    voxelWorld.setAnimFps(settings.animFps);
    voxelWorld.setAutoAnimate(settings.autoAnimate);

    const arch = buildArchetypes(voxelWorld);

    // Region 0: Hero 3D Carved Landmarks (targetDepth=5 -> 16 m cells, 0.25 m voxels) + live sculpts
    const carveOrigin = [-256, -192, -256];
    const carveId = voxelWorld.addRegion({
        center: [0, 64, 0], voxelSize: 0.25, maxDepth: 9,
        minDist: 0, fadeStart: 360, maxDist: 460, enabled: true, castShadow: true,
    });

    // Region 1: Dense animated woodland, windmills, boulders & cairns (8 m cells, 0.25 m voxels)
    const forestOrigin = [-512, -448, -512];
    const forestId = voxelWorld.addRegion({
        center: [0, 64, 0], voxelSize: 0.25, maxDepth: 10,
        minDist: 0, fadeStart: 380, maxDist: 480, enabled: true, castShadow: true,
    });

    // Region 2: Horizon IGN-dithered mountain forest & karst spires (32 m cells, 1.0 m voxels)
    const horizonOrigin = [-2048, -1920, -2048];
    const horizonId = voxelWorld.addRegion({
        center: [0, 128, 0], voxelSize: 1.0, maxDepth: 10,
        minDist: 330, fadeStart: 1200, maxDist: 1750, enabled: true, castShadow: false,
    });

    // Region 3: 32 m Recursive 3D Sierpinski Pyramid on East Promontory (y = 24.0 m)
    const monumentId = voxelWorld.addRegion({
        center: [72, 88, 18], voxelSize: 0.0625, maxDepth: 9,
        minDist: 0, fadeStart: 650, maxDist: 850, enabled: true, castShadow: true,
    });

    let baseInstances = 0;
    let baseVirtualVoxels = 0;
    let sculptVirtualVoxels = 0;

    function stampHeroLandmarks() {
        // Hero Cliff Cavern: cell (14, 13, 12) => x in [-32,-16], y in [16,32], z in [-64,-48]
        voxelWorld.stampCarveAndSolid(carveId, 14, 13, 12, arch.heroCavern.carve, arch.heroCavern.solid, 5);
        voxelWorld.place(carveId, 14, 12, 12, arch.heroCavern.base, 5);

        // Hero Cantilevered Cliff Overhang: inner (18, 13, 12) + projecting brow (18, 13, 13)
        voxelWorld.stampCarveAndSolid(carveId, 18, 13, 12, arch.heroOverhang.inner.carve, arch.heroOverhang.inner.solid, 5);
        voxelWorld.place(carveId, 18, 13, 13, arch.heroOverhang.brow, 5);

        // Hero Natural Stone Arch Bridge spanning the gorge: (16, 12, 14) + (16, 13, 14)
        voxelWorld.place(carveId, 16, 12, 14, arch.heroArch.lower, 5);
        voxelWorld.place(carveId, 16, 13, 14, arch.heroArch.upper, 5);
    }

    function populateForestRegion() {
        const td = 7, cells = 128, cellSize = 8.0, slots = 4;
        const maxItems = 32000;
        const batch = new Uint32Array(maxItems * 5);
        let used = 0;

        const pushRef = (ix, iy, iz, refObj) => {
            if (!refObj || iy < 0 || iy >= cells || used >= maxItems) return;
            const o = used * 5;
            batch[o] = ix;
            batch[o + 1] = iy;
            batch[o + 2] = iz;
            batch[o + 3] = refObj.ref;
            batch[o + 4] = refObj.isLeaf ? 1 : 0;
            used++;
        };

        const placeSlotted = (wx, wz, slice, voxWeight) => {
            const wy = heightAt(wx, wz);
            const ix = Math.floor((wx - forestOrigin[0]) / cellSize);
            const iz = Math.floor((wz - forestOrigin[2]) / cellSize);
            const fyRaw = (wy - forestOrigin[1]) / cellSize;
            const iy = Math.floor(fyRaw);
            if (ix < 1 || ix >= cells - 1 || iz < 1 || iz >= cells - 1 || iy < 1 || iy >= cells - 2) return false;
            const frac = clamp(fyRaw - iy, 0, 0.9999);
            const slot = Math.min(slots - 1, Math.floor(frac * slots));
            const s = slice[slot];
            if (!s) return false;
            pushRef(ix, iy, iz, s.main);
            pushRef(ix, iy + 1, iz, s.upper);
            pushRef(ix, iy - 1, iz, s.below);
            baseInstances++;
            baseVirtualVoxels += voxWeight;
            return true;
        };

        // 14 animated spinning windmills across the West Windmill Meadow
        const windmillSites = [
            [-64, 18], [-82, 10], [-102, 22], [-72, 38], [-94, 42], [-116, 34], [-60, 56],
            [-84, 62], [-108, 60], [-126, 12], [-56, -4], [-78, -8], [-102, -4], [-120, 48],
        ];
        const occupied = new Set();
        for (let i = 0; i < windmillSites.length; i++) {
            const [wx, wz] = windmillSites[i];
            const phase = i % 8;
            if (placeSlotted(wx, wz, arch.windmill[phase], 32768)) {
                const ix = Math.floor((wx - forestOrigin[0]) / cellSize);
                const iz = Math.floor((wz - forestOrigin[2]) / cellSize);
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) occupied.add(((iz + dz) << 8) | (ix + dx));
                }
            }
        }

        // Dense valley & hillside woodland, boulders, ruins, and pulsing crystal beacons
        for (let iz = 14; iz < 114; iz++) {
            const wz = forestOrigin[2] + (iz + 0.5) * cellSize;
            for (let ix = 14; ix < 114; ix++) {
                if (occupied.has((iz << 8) | ix)) continue;
                const wx = forestOrigin[0] + (ix + 0.5) * cellSize;
                const rCenter = Math.hypot(wx, wz);
                if (rCenter > 430) continue;

                // Preserve hero sightlines, cliff faces, promontory plinth, and camera approaches
                if (wx > -46 && wx < 60 && wz > -58 && wz < -12) continue;
                if (wx > -18 && wx < 28 && wz >= -12 && wz < 32) continue;
                if (Math.hypot(wx - 72, wz - 18) < 30) continue;
                if (Math.hypot(wx + 54, wz - 86) < 18) continue;

                const h = heightAt(wx, wz);
                const hSteep = Math.max(
                    Math.abs(heightAt(wx + 2.5, wz) - h),
                    Math.abs(heightAt(wx, wz + 2.5) - h)
                ) / 2.5;
                if (hSteep > 0.72) continue;

                const rnd = hash2u(ix + 17, iz + 43);
                const patch = 0.5 + 0.5 * Math.sin(wx * 0.025 + Math.cos(wz * 0.022));
                const density = rCenter < 140 ? 0.42 : 0.66;
                if (rnd > density) continue;

                const kindRoll = hash2u(ix * 3 + 7, iz * 5 + 11);
                const ph4 = (ix + iz * 3) & 3;
                let slice = null;
                if (kindRoll < 0.025) {
                    slice = arch.beacon[ph4];
                } else if (kindRoll < 0.045) {
                    slice = arch.ruin;
                } else if (kindRoll < 0.14) {
                    slice = arch.boulders[(ix + iz) & 1];
                } else if (h > 36 || patch < 0.34) {
                    slice = arch.conifer[(ix ^ iz) & 1][ph4];
                } else if (kindRoll < 0.28) {
                    slice = arch.autumn[ph4];
                } else {
                    slice = arch.broadleaf[(ix + iz) & 1][ph4];
                }
                placeSlotted(wx, wz, slice, 32768);
            }
        }
        voxelWorld.placeBatchTyped(forestId, batch, td, used);
    }

    function populateHorizonRegion() {
        const td = 7, cells = 128, cellSize = 32.0, slots = 8;
        const maxItems = 18000;
        const batch = new Uint32Array(maxItems * 5);
        let used = 0;

        for (let iz = 28; iz < 100; iz++) {
            const wz = horizonOrigin[2] + (iz + 0.5) * cellSize;
            for (let ix = 28; ix < 100; ix++) {
                const wx = horizonOrigin[0] + (ix + 0.5) * cellSize;
                const r = Math.hypot(wx, wz);
                if (r < 320 || r > 1060) continue;

                const wy = heightAt(wx, wz);
                const fyRaw = (wy - horizonOrigin[1]) / cellSize;
                const iy = Math.floor(fyRaw);
                if (iy < 1 || iy >= cells - 2) continue;

                const rnd = hash2u(ix + 101, iz + 203);
                if (rnd > 0.72) continue;

                const slot = Math.min(slots - 1, Math.floor(clamp(fyRaw - iy, 0, 0.9999) * slots));
                const slope = Math.hypot(heightAt(wx + 6, wz) - wy, heightAt(wx, wz + 6) - wy) / 6;
                const kindSet = (slope > 0.55 || wy > 88) && rnd < 0.24
                    ? arch.farSpire
                    : (wy > 48 || ((ix + iz) & 1) ? arch.farPine : arch.farLush);
                const s = kindSet[slot];
                if (!s) continue;

                for (const [cy, refObj] of [[iy, s.main], [iy + 1, s.upper], [iy - 1, s.below]]) {
                    if (!refObj || cy < 0 || cy >= cells || used >= maxItems) continue;
                    const o = used * 5;
                    batch[o] = ix; batch[o + 1] = cy; batch[o + 2] = iz;
                    batch[o + 3] = refObj.ref; batch[o + 4] = refObj.isLeaf ? 1 : 0;
                    used++;
                }
                baseInstances++;
                baseVirtualVoxels += 32768;
            }
        }
        voxelWorld.placeBatchTyped(horizonId, batch, td, used);
    }

    function populateSierpinskiMonument() {
        const count = 3125; // 5^5 instances of the 16^3 Sierpinski unit across a 32 m pyramid
        const batch = new Uint32Array(count * 5);
        let used = 0;
        const unit = arch.sierpinskiUnit;
        const emit = (ox, oy, oz, size) => {
            if (size === 1) {
                const o = used * 5;
                batch[o] = ox; batch[o + 1] = oy; batch[o + 2] = oz;
                batch[o + 3] = unit.ref; batch[o + 4] = unit.isLeaf ? 1 : 0;
                used++;
                return;
            }
            const h = size >> 1;
            emit(ox, oy, oz, h);
            emit(ox + h, oy, oz, h);
            emit(ox, oy, oz + h, h);
            emit(ox + h, oy, oz + h, h);
            emit(ox + (h >> 1), oy + h, oz + (h >> 1), h);
        };
        emit(48, 0, 48, 32);
        voxelWorld.placeBatchTyped(monumentId, batch, 7, used);
        baseInstances += used;
        // 32^3 bounding grid * 16^3 unit voxels = 512^3 virtual volume (134,217,728 voxels)
        baseVirtualVoxels += 512 * 512 * 512;
    }

    stampHeroLandmarks();
    populateForestRegion();
    populateHorizonRegion();
    populateSierpinskiMonument();
    baseInstances += 6;
    baseVirtualVoxels += 6 * 262144;

    function syncCarveBuffers() {
        const bufs = voxelWorld.buffers([0, 0, 0]);
        tNode.setShaderBuffer('regions', bufs.regions);
        tNode.setShaderBuffer('nodes', bufs.nodes);
        tNode.setShaderBuffer('children', bufs.children);
        tNode.setShaderBuffer('bricks', bufs.bricks);
        tNode.setShaderUniform('region_count', bufs.regionCount);
        tNode.setShaderUniform('carve_enabled', settings.showVoxelDag && settings.carveCutouts ? 1.0 : 0.0);
    }
    syncCarveBuffers();

    return {
        light, tNode, voxelWorld, arch,
        carveOrigin, carveId, forestId, horizonId, monumentId,
        stampHeroLandmarks, syncCarveBuffers,
        statsCounts: () => ({ instances: baseInstances + sculpt.edits, virtualVoxels: baseVirtualVoxels + sculptVirtualVoxels }),
        addSculptVoxels: (n) => { sculptVirtualVoxels += n; },
        clearSculptVoxels: () => { sculptVirtualVoxels = 0; },
    };
}

const built = available ? buildWorld(scene) : null;

export const sun = built ? built.light : null;
export const terrainNode = built ? built.tNode : null;
export const vd = built ? built.voxelWorld : null;

export const fly = (canvas && available)
    ? flyCamera(canvas, {
        ...PRESETS.overview.pose,
        speed: 30, boost: 3, lookSpeed: 0.003, worldUp: true,
        ground: null, fov: 62, near: 0.3, far: 2600,
    })
    : null;

export function applyTimeOfDay(key) {
    if (!available) return;
    const p = TIME_PRESETS[key];
    if (!p) return;
    settings.timeOfDay = key;
    skyEnvironment(scene, { hdri: p.hdri, intensity: p.envIntensity, rotation: p.envRotation, fallbackAmbient: p.ambient });
    sun.direction = sunDirection(p.elevation, p.heading);
    sun.intensity = p.intensity;
    sun.color = p.color;
    scene.setExposure({ compensation: p.exposure });
    scene.setFog(p.fog);
}

export function applySettings() {
    if (!available) return;
    vd.node.visible = !!settings.showVoxelDag;
    terrainNode.visible = !!settings.showTerrain;
    vd.setLodScale(settings.lodScale);
    vd.setMaxRaySteps(settings.maxRaySteps);
    vd.setAnimFps(settings.animFps);
    vd.setAutoAnimate(!!settings.autoAnimate);
    built.syncCarveBuffers();
}

export function selectPreset(name) {
    if (!available || !fly) return false;
    const p = PRESETS[name];
    if (!p) return false;
    fly.pose(p.pose);
    return true;
}

export function sculptAtCenter(tool = sculpt.tool) {
    if (!available || !fly) return null;
    const hit = raycastTerrain(fly.cam.pos, fly.forward(), 260);
    if (!hit) return null;
    const p = hit.position;
    const cellSize = 8.0, td = 6, cells = 64, slots = 4;
    const ix = Math.floor((p[0] - built.carveOrigin[0]) / cellSize);
    const iz = Math.floor((p[2] - built.carveOrigin[2]) / cellSize);
    const fyRaw = (p[1] - built.carveOrigin[1]) / cellSize;
    const iy = Math.floor(fyRaw);
    if (ix < 1 || ix >= cells - 1 || iz < 1 || iz >= cells - 1 || iy < 1 || iy >= cells - 2) return null;

    if (tool === 'carve') {
        const dx = fly.cam.pos[0] - p[0], dz = fly.cam.pos[2] - p[2];
        const dirKey = Math.abs(dz) >= Math.abs(dx) ? (dz >= 0 ? '+z' : '-z') : (dx >= 0 ? '+x' : '-x');
        const st = built.arch.sculpt.carve[dirKey];
        vd.stampCarveAndSolid(built.carveId, ix, iy, iz, st.carve, st.solid, td);
    } else {
        const slot = Math.min(slots - 1, Math.floor(clamp(fyRaw - iy, 0, 0.9999) * slots));
        let slice = null;
        if (tool === 'arch') slice = built.arch.sculpt.arch[slot];
        else if (tool === 'windmill') slice = built.arch.windmill[sculpt.edits % 8][slot];
        else if (tool === 'beacon') slice = built.arch.beacon[sculpt.edits % 4][slot];
        else slice = built.arch.broadleaf[sculpt.edits % 2][sculpt.edits % 4][slot];
        if (slice) {
            if (slice.main) vd.place(built.carveId, ix, iy, iz, slice.main, td);
            if (slice.upper) vd.place(built.carveId, ix, iy + 1, iz, slice.upper, td);
            if (slice.below) vd.place(built.carveId, ix, iy - 1, iz, slice.below, td);
        }
    }

    sculpt.edits++;
    built.addSculptVoxels(32768);
    built.syncCarveBuffers();
    return hit;
}

export function resetSculpt() {
    if (!available) return;
    vd.clearRegion(built.carveId);
    built.stampHeroLandmarks();
    sculpt.edits = 0;
    built.clearSculptVoxels();
    built.syncCarveBuffers();
}

export function getTelemetry() {
    if (!available) return null;
    const s = vd.stats();
    const { instances, virtualVoxels } = built.statsCounts();
    const poolBytes = s.nodes * 16 + s.children * 4 + s.bricks * 16 + s.attrs * 8;
    const naiveBytes = virtualVoxels * 4;
    const compression = Math.max(1, Math.round(naiveBytes / Math.max(1, poolBytes)));
    return {
        ...s,
        instances,
        virtualVoxels,
        poolBytes,
        compression,
        edits: sculpt.edits,
    };
}

const hooks = [];
export function onFrame(fn) { hooks.push(fn); }

if (available) {
    applyTimeOfDay(settings.timeOfDay);
    applySettings();
    let last = performance.now();
    const tick = () => {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        scene.setCamera(fly.update(dt));
        for (const fn of hooks) fn(dt);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}
