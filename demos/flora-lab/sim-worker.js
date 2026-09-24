// flora-lab sim worker: owns the broflora world on a background thread.
//
// The page never touches the sim. It pumps this worker once per rendered
// frame with the real dt; the worker steps the world on a fixed timestep
// (growth stays framerate-independent, and headless tests can drive it the
// same way) and, at most REBUILD_HZ times a second, posts a frame packet:
// the branch-tube per-segment buffer, the foliage-scatter per-segment +
// per-leaf buffers, the bloom meshes (transferred by pointer), the optional
// organic SDF mesh, stats and the plant origins. The page uploads those to
// the GPU nodes and draws, so its frame pays neither the sim nor the emit.
//
// Messages in:  pump {dt} | timeScale {v} | climate {temp} | playing {on} |
//               step | seed {x, z, species} | reset | layers {flags} |
//               snapshot {which: {shadowGrid}}
// Messages out: frame {...} | snapshot {shadow?, plants}

import { WORLD_SIZE, GRID_RES, GRID_CELL, GRID_HEIGHT, SPECIES, FOLIAGE, TUBE, BLOOM_CAP,
         bloomBases, prototypes, createWorld, speciesOf } from "/app/shared.js";

const SIM_STEP_DT = 0.02;     // sim seconds per step
const BASE_GROWTH = 1.0;      // sim seconds per real second at 1x
const MAX_CATCHUP = 6;        // steps per pump at most; a longer stall is dropped
const REBUILD_MIN_DT = 1 / 12;

let world = null, rootProto = -1, blooms = null;

function plant(x, z, key) {
    world.addPlant({ origin: [x, 0, z], species: (SPECIES[key] || SPECIES.sun).species, prototypeIndex: rootProto });
}

function buildWorld() {
    world = createWorld(0xC0FFEE);
    const p = prototypes();
    rootProto = world.addPrototype(p.mono);
    const symp = world.addPrototype(p.symp);
    const tuft = world.addPrototype(p.tuft);
    world.addVoronoiSite(rootProto, 0.5, 0.3);
    world.addVoronoiSite(symp, 0.35, 0.5);
    world.addVoronoiSite(tuft, 0.12, 0.3);
    plant(-4.5, -2, 'sun');
    plant(-1.5, 1, 'sun');
    plant(1.5, -1, 'shade');
    plant(4.5, 2, 'shade');
}

// The layers the page shows; only those are emitted.
let layers = { branches: true, foliage: true, blooms: true, organicSdf: false };

function plantsArray() {
    const n = world.plantCount;
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const info = world.plantInfo(i);
        if (!info) continue;
        a.set([info.origin[0], info.origin[1], info.origin[2], SPECIES[speciesOf(info.species.shadeTolerance)].flag], i * 4);
    }
    return a;
}

function emitFrame() {
    const packet = { type: 'frame' };
    const transfer = [];
    if (layers.branches) {
        const t = world.emitBranchTubes({ sides: TUBE.sides });
        packet.branches = t;
        transfer.push(t.segments.buffer);
    }
    if (layers.foliage) {
        const f = world.emitScatterSegments(FOLIAGE);
        packet.foliage = f;
        transfer.push(f.segments.buffer, f.instSeg.buffer);
    }
    if (layers.blooms) {
        if (!blooms) blooms = bloomBases();
        const bm = world.emitBloomMesh(blooms.petals, blooms.center, { bloomCap: BLOOM_CAP, bloomLightMin: 0.18 });
        if (bm[0] && bm[0].triangleCount > 0) { packet.bloomPetals = bm[0]; transfer.push(bm[0]); }
        if (bm[1] && bm[1].triangleCount > 0) { packet.bloomCenters = bm[1]; transfer.push(bm[1]); }
    }
    if (layers.organicSdf) {
        const sm = world.emitWorldSdfMesh({ voxelSize: 0.05, smoothK: 0.03 });
        if (sm && sm.triangleCount > 0) { packet.organicSdf = sm; transfer.push(sm); }
    }
    let flowering = 0;
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (info && info.flowering) flowering++;
    }
    packet.stats = { simTime: world.simTime, plantCount: world.plantCount, moduleCount: world.moduleCount, flowering };
    packet.plants = plantsArray();
    transfer.push(packet.plants.buffer);
    self.postMessage(packet, transfer);
}

// Shadow-grid occupancy for the diagnostic overlay, on request.
function emitSnapshot(which) {
    const snap = { type: 'snapshot' };
    const transfer = [];
    if (which && which.shadowGrid) {
        const a = new Float32Array(GRID_RES * GRID_HEIGHT * GRID_RES);
        let n = 0;
        for (let iy = 0; iy < GRID_HEIGHT; iy++)
            for (let iz = 0; iz < GRID_RES; iz++)
                for (let ix = 0; ix < GRID_RES; ix++) {
                    const q = world.sampleShadow([
                        -WORLD_SIZE * 0.5 + (ix + 0.5) * GRID_CELL,
                        (iy + 0.5) * GRID_CELL,
                        -WORLD_SIZE * 0.5 + (iz + 0.5) * GRID_CELL,
                    ]);
                    a[n++] = q == null ? 1.0 : q;
                }
        snap.shadow = a;
        transfer.push(a.buffer);
    }
    snap.plants = plantsArray();
    transfer.push(snap.plants.buffer);
    self.postMessage(snap, transfer);
}

let playing = true, timeScale = 1.0, simAccum = 0, dirty = true, clock = 0, lastEmit = -1;

function emitNow() { emitFrame(); dirty = false; lastEmit = clock; }

function pump(dt) {
    if (!(dt > 0)) return;
    clock += Math.min(dt, 0.1);
    if (playing) {
        simAccum += Math.min(dt, 0.1) * BASE_GROWTH * timeScale;
        let steps = 0;
        while (simAccum >= SIM_STEP_DT && steps < MAX_CATCHUP) {
            world.step(SIM_STEP_DT);
            simAccum -= SIM_STEP_DT;
            steps++;
            dirty = true;
        }
        if (steps === MAX_CATCHUP) simAccum = 0;
    }
    if (dirty && clock - lastEmit >= REBUILD_MIN_DT) emitNow();
}

self.onmessage = (e) => {
    const m = e.data;
    if (!m || !m.type) return;
    switch (m.type) {
        case 'pump':      pump(m.dt); break;
        case 'timeScale': timeScale = m.v; break;
        case 'climate':   world.setClimate({ annualTempBase: m.temp }); break;
        case 'playing':   playing = !!m.on; break;
        case 'step':      world.step(SIM_STEP_DT); emitNow(); break;
        case 'seed':      plant(m.x, m.z, m.species); dirty = true; break;
        case 'reset':     buildWorld(); emitNow(); break;
        case 'layers':    layers = m.flags; dirty = true; break;
        case 'snapshot':  emitSnapshot(m.which); break;
    }
};

buildWorld();
emitNow();   // geometry for the page's first frames
