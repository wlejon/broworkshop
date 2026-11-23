// Metropolis — 120 km^2 Streamed City & Suburbs on Natural Terrain
// Combines bro.tiles terrain, curved river hydrology + bridges, non-grid districts,
// hillside suburbs, bro.flora trees & cached impostors, single-source LOD2/LOD1/LOD0
// enterable buildings with InteriorVolume + GPU-tiled lights, traffic & commuter rail.

import { SKY, AIR, SUN_LUX, daylight } from "/lib/kit/sky.js";
import { createUrbanMaterialLibrary } from "/lib/pbr-materials.js";
import { terrainHeight, riverCenterX } from "/app/world/terrain_field.js";
import { createCityGraph } from "/app/world/city_graph.js";
import { createTerrainStream } from "/app/world/terrain_stream.js";
import { createRiverWater } from "/app/world/river_water.js";
import { createCityStreamer } from "/app/world/city_streamer.js";
import { createTrafficAndTransit } from "/app/traffic/traffic_transit.js";
import { createTraversalController } from "/app/player/traversal_modes.js";
import { createHud } from "/app/player/hud.js";

const canvas = document.getElementById('stage');
canvas.width = window.innerWidth || 1600;
canvas.height = window.innerHeight || 960;
const scene = canvas.getContext('scene');
const unavailableEl = document.getElementById('unavailable');

if (!scene || !bro.tiles || !bro.flora) {
    if (unavailableEl) unavailableEl.hidden = false;
    throw new Error('Metropolis requires bro.scene, bro.tiles, and bro.flora');
}

const SKY_PRESETS = {
    day:   { ...SKY.afternoon, exposure: { mode: 'auto', meter: 'incident' } },
    dusk:  { ...SKY.golden,    exposure: { mode: 'auto', meter: 'incident' } },
    night: {
        label: 'Night',
        hdri: 'dikhololo_night', envIntensity: 1.25, envRotation: 0.0,
        sun: { direction: [-0.35, -0.78, -0.50], color: [0.58, 0.70, 0.96], intensity: 1.35 },
        shadow: false,
        exposure: { mode: 'fixed', ev: 5.8 },
        fog: { start: 28, end: 260, color: [0.03, 0.05, 0.11] },
        ambientFallback: [0.12, 0.15, 0.25],
        emissiveGain: 1.6, fireflies: 0,
    },
};

let timeMode = 'day';
const sky = daylight(scene, {
    presets: SKY_PRESETS,
    order: ['day', 'dusk', 'night'],
    pcf: 2,
    ground: [0.09, 0.13, 0.06],
});
sky.apply('day');
sky.setScale(16);

const mats = createUrbanMaterialLibrary(256);
const graph = createCityGraph();
const terrain = createTerrainStream(scene);
const water = createRiverWater(scene);
const traffic = createTrafficAndTransit(scene, graph);
const streamer = createCityStreamer({ scene, graph, mats, hideOnBake: [terrain.node, water.node, ...traffic.getNodes()] });

const hud = createHud({
    onSetMode: (m) => traversal.setMode(m),
    onSetTimeMode: (tm) => setTimeMode(tm),
});

const traversal = createTraversalController({
    canvas, scene, graph, streamer, traffic,
    onModeChange: (m) => hud.syncMode(m),
});

// Start overlooking central bridge, riverfront promenade, and downtown skyline (clear East riverbank overlook)
const initPos = [riverCenterX(165) + 52, terrainHeight(riverCenterX(165) + 52, 165) + 22, 165];
traversal.setPose(initPos, 0.62, -0.14);

function nightFactorFor(tm) {
    return tm === 'night' ? 1.0 : (tm === 'dusk' ? 0.55 : 0.0);
}

function setTimeMode(tm) {
    if (!SKY_PRESETS[tm]) return;
    timeMode = tm;
    sky.apply(tm);
    hud.syncTod(tm);
}

window.addEventListener('keydown', (e) => {
    if (e.key === '1') setTimeMode('day');
    else if (e.key === '2') setTimeMode('dusk');
    else if (e.key === '3') setTimeMode('night');
    else if (e.key.toLowerCase() === 'h') hud.toggleVisibility();
});

let readyFlag = false;
let simTime = 0;
let lastTime = performance.now();
let fpsSmooth = 120;
let meanMsSmooth = 3.0;

const initPromise = terrain.whenReady().then(() => {
    streamer.init(traversal.getState().pos);
    // Restore initial hero vista after any impostor bake
    traversal.setPose(initPos, 0.62, -0.14);
    readyFlag = true;
    hud.setReady('ready');
});

function tick() {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0001, (now - lastTime) / 1000));
    lastTime = now;
    simTime += dt;

    const nightFactor = nightFactorFor(timeMode);
    traffic.update(dt, nightFactor, traversal.getState().pos);
    traversal.update(dt);

    const st = traversal.getState();
    terrain.update(st.pos, st.fwd, st.up, { width: canvas.width, height: canvas.height, fov: st.mode === 'drive' ? 62 : 58 });
    water.update(simTime);
    if (readyFlag) streamer.update(st.pos, dt, nightFactor);
    sky.update(dt);

    const cs = scene.cullStats();
    const ms = dt * 1000;
    meanMsSmooth += (ms - meanMsSmooth) * 0.1;
    fpsSmooth = 1000 / Math.max(0.1, meanMsSmooth);

    hud.update({
        mode: st.mode,
        timeMode,
        pos: st.pos,
        district: st.district,
        inBuilding: st.inBuilding,
        stationName: st.stationName,
        speed: st.speed,
        tiles: terrain.stats(),
        stream: streamer.stats(),
        traffic: traffic.stats(),
        shadowPagesDynamic: cs.shadowPagesDynamic || 0,
        perf: { fps: fpsSmooth, meanMs: meanMsSmooth, gpuMs: cs.frameGpuMs || 0 },
    });

    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

globalThis.__metropolis = {
    get ready() { return readyFlag; },
    whenReady: () => initPromise,
    scene,
    graph,
    terrain,
    streamer,
    traffic,
    traversal,
    setMode: (m) => traversal.setMode(m),
    setTimeMode,
    setPose: (pos, yaw, pitch) => {
        traversal.setPose(pos, yaw, pitch);
        const st = traversal.getState();
        terrain.update(st.pos, st.fwd, st.up, { width: canvas.width, height: canvas.height, fov: 58 });
        if (readyFlag) streamer.update(st.pos, 0, nightFactorFor(timeMode), true);
    },
    setWalkInput: (inp) => traversal.setWalkInput(inp),
    setDriveInput: (inp) => traffic.setDriveInput(inp),
    sampleTerrainHeight: terrainHeight,
    getState: () => ({ ...traversal.getState(), timeMode, stream: streamer.stats(), traffic: traffic.stats() }),
    getPerfStats: () => ({
        cull: scene.cullStats(),
        tiles: terrain.stats(),
        stream: streamer.stats(),
        fps: fpsSmooth,
        meanMs: meanMsSmooth,
    }),
};
