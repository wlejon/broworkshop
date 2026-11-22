// Karst World orchestrator: uses 3-region stacked SVDAG storage -> GPU smooth C^2 density
// -> seamless C++ Surface Nets chunks + triplanar strata shader + river water + smooth flora.
import { flyCamera } from "/lib/kit/flycam.js";
import { skyEnvironment, sunDirection } from "/lib/kit/sky.js";
import { WORLD_CFG, populateWorldDag } from "/app/geology.js";
import { createKarstMesher } from "/app/mesher.js";
import { createWaterNode } from "/app/shaders.js";
import { createFloraSystem } from "/app/flora.js";

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export const canvas = document.getElementById('stage');
export const scene = canvas ? canvas.getContext('scene') : null;
export const available = Boolean(
    scene && typeof bro !== 'undefined' && bro.voxeldag && bro.kernel?.gpu &&
    typeof Mesh !== 'undefined' && typeof Mesh.surfaceNets === 'function'
);

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
    overview: { label: '1 Canyon Overview',  pose: lookPose([56, 62, 92], [-4, 18, -16]) },
    bridge:   { label: '2 Stone Bridge',     pose: lookPose([6, 13.5, 62], [3, 18.0, 18]) },
    cavern:   { label: '3 River Cavern',     pose: lookPose([4, 12.5, 8], [-3, 13.5, -34]) },
    skylight: { label: '4 Cave Skylight',    pose: lookPose([-1, 12.0, -31], [-9, 18.5, -50]) },
    overhang: { label: '5 Cliff Overhang',   pose: lookPose([4, 12.5, 48], [-28, 18.5, 22]) },
    gallery:  { label: '6 Cliff Gallery',    pose: lookPose([-32.5, 24.5, -18.5], [2, 20.5, 18]) },
};

export const TIME_PRESETS = {
    afternoon: {
        label: 'Afternoon', hdri: 'kloofendal_43d_clear_puresky', envIntensity: 0.90, envRotation: 2.2,
        elevation: 44, heading: 195, intensity: 3.1, color: [1.0, 0.96, 0.89],
        exposure: -0.20, fog: { start: 180, end: 1350, color: [0.68, 0.78, 0.89] },
        ambient: [0.30, 0.34, 0.38],
    },
    golden: {
        label: 'Golden Hour', hdri: 'the_sky_is_on_fire', envIntensity: 0.52, envRotation: 3.6,
        elevation: 18, heading: 235, intensity: 4.2, color: [1.0, 0.68, 0.36],
        exposure: -0.10, fog: { start: 160, end: 1150, color: [0.84, 0.58, 0.42] },
        ambient: [0.28, 0.22, 0.20],
    },
    mist: {
        label: 'Morning Mist', hdri: 'kloppenheim_06_puresky', envIntensity: 0.82, envRotation: 1.5,
        elevation: 28, heading: 150, intensity: 2.9, color: [0.95, 0.96, 1.0],
        exposure: -0.05, fog: { start: 110, end: 920, color: [0.72, 0.78, 0.83] },
        ambient: [0.30, 0.33, 0.36],
    },
    twilight: {
        label: 'Twilight', hdri: 'dikhololo_night', envIntensity: 0.72, envRotation: 0.0,
        elevation: 16, heading: 210, intensity: 0.72, color: [0.58, 0.68, 0.95],
        exposure: 0.35, fog: { start: 150, end: 980, color: [0.10, 0.14, 0.24] },
        ambient: [0.10, 0.13, 0.22],
    },
};

export const SCULPT_TOOLS = {
    carveTunnel:  'Carve Tunnel',
    carveChamber: 'Carve Chamber',
    buildRock:    'Build Rock',
};

export const settings = {
    viewMode: 'smooth',   // 'smooth' | 'storage'
    cavesEnabled: true,
    showFlora: true,
    timeOfDay: 'afternoon',
};

export const sculpt = { tool: 'carveTunnel', edits: 0 };

function buildScene(sceneGraph) {
    sceneGraph.setToneMap({ mode: 'aces', gamma: 2.2 });
    sceneGraph.setShadowQuality({ pcfTaps: 3 });

    const light = sceneGraph.createLight({ type: 'directional', castsShadow: true });
    light.shadowNormalBias = 0.05;

    // Gentle subterranean water/limestone bounce lights inside the caves
    const caveLights = [
        sceneGraph.createLight({ type: 'point', position: [-7, 9.5, -47], color: [0.24, 0.82, 0.92], intensity: 65, range: 38, castsShadow: false }),
        sceneGraph.createLight({ type: 'point', position: [-12, 22.0, -44], color: [1.0, 0.79, 0.56], intensity: 42, range: 38, castsShadow: false }),
        sceneGraph.createLight({ type: 'point', position: [-2, 11.5, -22], color: [0.28, 0.75, 0.86], intensity: 42, range: 34, castsShadow: false }),
        sceneGraph.createLight({ type: 'point', position: [-30, 23.0, -16], color: [1.0, 0.80, 0.60], intensity: 30, range: 26, castsShadow: false }),
    ];

    const t0 = performance.now();
    const voxelWorld = bro.voxeldag.createWorld(sceneGraph);
    voxelWorld.setLodScale(1.1);
    voxelWorld.setMaxRaySteps(128);
    voxelWorld.setAutoAnimate(false);
    // Keep the voxel raymarcher off by default: bro.voxeldag serves as 3D terrain storage.
    voxelWorld.node.visible = false;

    const dagInfo = populateWorldDag(voxelWorld);
    const tDag = performance.now();

    const mesher = createKarstMesher(sceneGraph, voxelWorld);
    mesher.remeshAll(settings.cavesEnabled);
    const tMesh = performance.now();

    const waterNode = createWaterNode(sceneGraph, WORLD_CFG.waterY);
    const camClearings = [
        ...Object.values(PRESETS).map((p) => [p.pose.pos[0], p.pose.pos[2], 7.0]),
        [-21, -7, 10.5],
        [-15, -1, 8.5],
    ];
    const flora = createFloraSystem(sceneGraph, camClearings);
    flora.scatterFromChunks(mesher.chunks);
    const tFlora = performance.now();

    console.log(
        `karst-world boot: dag=${(tDag - t0).toFixed(0)}ms ` +
        `surfaceNets=${(tMesh - tDag).toFixed(0)}ms flora=${(tFlora - tMesh).toFixed(0)}ms`
    );

    const carveCellMap = new Map();
    const formCellMap = new Map();

    const seedCellMaps = () => {
        carveCellMap.clear();
        formCellMap.clear();
        const seedFrom = (map, collector) => {
            const a = collector.array;
            for (let i = 0; i < collector.count; i++) {
                const o = i * 5;
                map.set(`${a[o]},${a[o + 1]},${a[o + 2]}`, { ref: a[o + 3], isLeaf: a[o + 4] !== 0 });
            }
        };
        seedFrom(carveCellMap, dagInfo.carveBatch);
        seedFrom(formCellMap, dagInfo.formBatch);
    };
    seedCellMaps();

    return {
        light, caveLights, voxelWorld, dagInfo, mesher, waterNode, flora,
        carveCellMap, formCellMap, seedCellMaps,
    };
}

const world = available ? buildScene(scene) : null;

export const sun = world ? world.light : null;
export const vd = world ? world.voxelWorld : null;

export const fly = (canvas && available)
    ? flyCamera(canvas, {
        ...PRESETS.overview.pose,
        speed: 26, boost: 3, lookSpeed: 0.003, worldUp: true,
        ground: null, fov: 62, near: 0.3, far: 2200,
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

export function setViewMode(mode) {
    if (!available) return;
    settings.viewMode = mode === 'storage' ? 'storage' : 'smooth';
    const isStorage = settings.viewMode === 'storage';
    world.mesher.setVisible(!isStorage);
    world.waterNode.visible = !isStorage;
    world.flora.setVisible(!isStorage && settings.showFlora);
    vd.node.visible = isStorage;
    // Also toggle Region 1 visibility when inspecting SVDAG storage if caves disabled
    vd.updateRegion(world.dagInfo.carveId, { enabled: settings.cavesEnabled || !isStorage });
}

export function setCavesEnabled(on) {
    if (!available) return;
    settings.cavesEnabled = !!on;
    world.mesher.remeshAll(settings.cavesEnabled);
    world.flora.scatterFromChunks(world.mesher.chunks);
    setViewMode(settings.viewMode);
}

export function applySettings() {
    if (!available) return;
    setViewMode(settings.viewMode);
}

export function selectPreset(name) {
    if (!available || !fly) return false;
    const p = PRESETS[name];
    if (!p) return false;
    fly.pose(p.pose);
    return true;
}

function stampMacroMerged(regionId, map, ix, iy, iz, brush) {
    const key = `${ix},${iy},${iz}`;
    const prev = map.get(key);
    const merged = prev ? vd.mergeArchetypes(prev, brush) : brush;
    vd.place(regionId, ix, iy, iz, merged, WORLD_CFG.targetDepth);
    map.set(key, merged);
}

export function sculptAtCenter(tool = sculpt.tool) {
    if (!available || !fly) return null;
    const fwd = fly.forward();
    const hit = world.mesher.raycastWorld(fly.cam.pos, fwd, 180);
    if (!hit) return null;

    const p = hit.position;
    const cfg = WORLD_CFG;
    const ox0 = cfg.dagOrigin[0], oy0 = cfg.dagOrigin[1], oz0 = cfg.dagOrigin[2];
    const mSize = cfg.macroCell;

    const points = tool === 'carveTunnel'
        ? [
            [p[0] + fwd[0] * 1.5, p[1] + fwd[1] * 1.5, p[2] + fwd[2] * 1.5],
            [p[0] + fwd[0] * 7.0, p[1] + fwd[1] * 7.0, p[2] + fwd[2] * 7.0],
        ]
        : [p];

    const brush = world.dagInfo.brushes[tool] || world.dagInfo.brushes.carveTunnel;
    const isBuild = tool === 'buildRock';
    const regionId = isBuild ? world.dagInfo.formId : world.dagInfo.carveId;
    const map = isBuild ? world.formCellMap : world.carveCellMap;

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const pt of points) {
        const ix = clamp(Math.floor((pt[0] - ox0) / mSize), 3, 28);
        const iy = clamp(Math.floor((pt[1] - oy0) / mSize), 12, 20);
        const iz = clamp(Math.floor((pt[2] - oz0) / mSize), 3, 28);
        if (tool === 'carveChamber') {
            for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
                const jx = clamp(ix + dx, 3, 28), jy = clamp(iy + dy, 12, 20), jz = clamp(iz + dz, 3, 28);
                stampMacroMerged(regionId, map, jx, jy, jz, brush);
            }
        } else {
            stampMacroMerged(regionId, map, ix, iy, iz, brush);
        }
        minX = Math.min(minX, pt[0] - mSize);
        maxX = Math.max(maxX, pt[0] + mSize);
        minZ = Math.min(minZ, pt[2] - mSize);
        maxZ = Math.max(maxZ, pt[2] + mSize);
    }

    sculpt.edits++;
    world.mesher.remeshBox([minX, -10, minZ], [maxX, 60, maxZ], settings.cavesEnabled);
    world.flora.scatterFromChunks(world.mesher.chunks);
    setViewMode(settings.viewMode);
    return hit;
}

export function resetEdits() {
    if (!available) return;
    world.dagInfo.restoreInitial();
    world.seedCellMaps();
    sculpt.edits = 0;
    world.mesher.remeshAll(settings.cavesEnabled);
    world.flora.scatterFromChunks(world.mesher.chunks);
    setViewMode(settings.viewMode);
}

export function getTelemetry() {
    if (!available) return null;
    const s = vd.stats();
    const m = world.mesher.stats();
    const f = world.flora.stats();
    const poolBytes = s.nodes * 16 + s.children * 4 + s.bricks * 16 + s.attrs * 8;
    // Equivalent dense 1.0 m 3-region volumetric grid (solid + carve + formations, 12 bytes/voxel)
    // across the populated 208 x 72 x 208 m^3 karst volume.
    const denseBytes = 208 * 72 * 208 * 12;
    const compression = Math.max(1, Math.round(denseBytes / Math.max(1, poolBytes)));
    return {
        ...s,
        ...m,
        floraTotal: f.total,
        pines: f.pines,
        oaks: f.oaks,
        shrubs: f.shrubs,
        boulders: f.boulders,
        poolBytes,
        compression,
        edits: sculpt.edits,
    };
}

const hooks = [];
export function onFrame(fn) { hooks.push(fn); }

if (available) {
    applyTimeOfDay(settings.timeOfDay);
    setViewMode(settings.viewMode);
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
