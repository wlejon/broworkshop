// flora-lab sim worker — owns the broflora WorldState on a background thread.
//
// The main thread never touches the sim. This worker steps it on a fixed
// wall-clock timestep (so growth is framerate-independent) and, at most
// REBUILD_HZ times a second, emits a compact "frame packet": the branch-tube
// per-segment buffer, the foliage-scatter per-segment + per-leaf buffers, and
// the bloom meshes — plus stats + plant origins. The main thread only uploads
// those buffers to the GPU and draws, so the render loop pays neither the sim
// (~85 ms/s) nor the mesh emit (~10 ms/rebuild). The compact buffers transfer
// zero-copy (Mesh by pointer) or as small ArrayBuffers, never the multi-MB
// merged geometry the GPU tube/scatter nodes make obsolete.

const WORLD_SIZE = 16;
const GRID_RES = 16;
const GRID_CELL = WORLD_SIZE / GRID_RES;
const GRID_HEIGHT = 16;

// Species — must match the palette the main thread tints impostors with.
const SPECIES = {
    sun: {
        species: { shadeTolerance: 0.35, moduleMatureAge: 0.6, tropismG2: 0.12,
                   growthScale: 1.0, orthotropy: 0.4, rootVigorMax: 2.5,
                   apicalControl: 0.35, apicalControlMature: 0.3,
                   individualVariation: 0.18, maxAge: 60, seedingRadius: 0.0 },
    },
    shade: {
        species: { shadeTolerance: 0.65, moduleMatureAge: 0.7, tropismG2: 0.12,
                   growthScale: 0.8, orthotropy: 0.48, rootVigorMax: 2.0,
                   apicalControl: 0.30, apicalControlMature: 0.3,
                   individualVariation: 0.16, maxAge: 70, seedingRadius: 0.0 },
    },
};

// Foliage placement — the count-shaping fields must match what the main thread
// passes to createInstancedMesh({scatter}) so leaves land on the twigs.
const folOpts = {
    maxRadius: 0.22, minDepth: 1, perUnitLength: 120,
    upBias: 0.5, tiltJitter: 0.55, rollJitter: 0.9,
    baseScale: 1.0, scaleJitter: 0.3, scaleByRadius: 0.25, seed: 0x1eaf,
};
const BLOOM_CAP = 120;
const TUBE = { sides: 6, radiusScale: 1.0 };

let world = null;
let rootProto = -1;
let bloomBase = null, bloomCenterBase = null;

function ensureBloomBases() {
    if (bloomBase) return;
    bloomBase = Mesh.flower({
        petalCount: 5, petalShape: 'petal',
        petalLength: 0.13, petalWidth: 0.085, petalBend: 0.4,
        petalCup: 0.22, shapedPetals: true,
        outerTilt: -0.15, innerTilt: -0.12,
        centerRadius: 0.03, centerHeight: 0.02,
    });
    try { bloomBase.colors = new Float32Array(0); } catch (e) {}
    bloomCenterBase = Mesh.sphere(0.03, 8, 6);
    bloomCenterBase.scale(1, 0.5, 1);
    try { bloomCenterBase.colors = new Float32Array(0); } catch (e) {}
}

function plant(x, z, key) {
    const def = SPECIES[key] || SPECIES.sun;
    world.addPlant({ origin: [x, 0, z], species: def.species, prototypeIndex: rootProto });
}

function buildWorld() {
    world = bro.flora.createWorld({
        rngSeed: 0xC0FFEE,
        climate: { annualTempBase: 15, annualPrecip: 1000 },
        shadow: {
            origin: [-WORLD_SIZE * 0.5, 0, -WORLD_SIZE * 0.5],
            cellSize: GRID_CELL, width: GRID_RES, height: GRID_HEIGHT, depth: GRID_RES,
            fill: 1.0,
        },
    });
    rootProto = world.addPrototype(bro.flora.prototypes.monopodial
        ? bro.flora.prototypes.monopodial(3, 0.7)
        : bro.flora.prototypes.whorl(5, 0.8));
    const protoSymp = world.addPrototype(bro.flora.prototypes.sympodial
        ? bro.flora.prototypes.sympodial(0.3, 0.75)
        : bro.flora.prototypes.whorl(4, 0.7));
    const protoTuft = world.addPrototype(bro.flora.prototypes.whorl(3, 0.55));
    world.addVoronoiSite(rootProto, 0.5, 0.3);
    world.addVoronoiSite(protoSymp,  0.35, 0.5);
    world.addVoronoiSite(protoTuft,  0.12, 0.3);
    for (const p of [
        { x: -4.5, z: -2, sp: 'sun' },
        { x: -1.5, z:  1, sp: 'sun' },
        { x:  1.5, z: -1, sp: 'shade' },
        { x:  4.5, z:  2, sp: 'shade' },
    ]) plant(p.x, p.z, p.sp);
}

// Which layers the main thread currently shows — the worker only emits those.
let layers = { branches: true, foliage: true, blooms: true };

function plantsArray() {
    const n = world.plantCount;
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const info = world.plantInfo(i);
        const o = i * 4;
        if (info) {
            a[o] = info.origin[0]; a[o + 1] = info.origin[1]; a[o + 2] = info.origin[2];
            a[o + 3] = (info.species.shadeTolerance >= 0.6) ? 1 : 0;   // species flag
        }
    }
    return a;
}

function emitFrame() {
    if (!world) return;
    const packet = { type: 'frame' };
    const transfer = [];

    if (layers.branches) {
        const t = world.emitBranchTubes({ sides: TUBE.sides });
        packet.branches = t;                       // {segments, segCount, bounds*}
        transfer.push(t.segments.buffer);
    }
    if (layers.foliage) {
        const f = world.emitScatterSegments(folOpts);
        packet.foliage = f;                        // {segments, instSeg, ...}
        transfer.push(f.segments.buffer, f.instSeg.buffer);
    }
    if (layers.blooms) {
        ensureBloomBases();
        const bm = world.emitBloomMesh(bloomBase, bloomCenterBase,
                                       { bloomCap: BLOOM_CAP, bloomLightMin: 0.18 });
        // Mesh transfers zero-copy by pointer; list it so ownership moves.
        if (bm[0] && bm[0].triangleCount > 0) { packet.bloomPetals = bm[0]; transfer.push(bm[0]); }
        if (bm[1] && bm[1].triangleCount > 0) { packet.bloomCenters = bm[1]; transfer.push(bm[1]); }
    }

    let flowering = 0;
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (info && info.flowering) flowering++;
    }
    packet.stats = {
        simTime: world.simTime, plantCount: world.plantCount,
        moduleCount: world.moduleCount, flowering,
    };
    const pa = plantsArray();
    packet.plants = pa;
    transfer.push(pa.buffer);

    self.postMessage(packet, transfer);
}

// Diagnostic-overlay data the main thread can't compute without the world.
// Sent on request (the overlays are dev-only, off the hot path).
function emitSnapshot(which) {
    const snap = { type: 'snapshot' };
    const transfer = [];
    if (which && which.shadowGrid) {
        const a = new Float32Array(GRID_RES * GRID_HEIGHT * GRID_RES);
        let n = 0;
        for (let iy = 0; iy < GRID_HEIGHT; iy++)
            for (let iz = 0; iz < GRID_RES; iz++)
                for (let ix = 0; ix < GRID_RES; ix++) {
                    const cx = -WORLD_SIZE * 0.5 + (ix + 0.5) * GRID_CELL;
                    const cy = (iy + 0.5) * GRID_CELL;
                    const cz = -WORLD_SIZE * 0.5 + (iz + 0.5) * GRID_CELL;
                    const q = world.sampleShadow([cx, cy, cz]);
                    a[n++] = (q == null) ? 1.0 : q;
                }
        snap.shadow = a; snap.gridRes = GRID_RES; snap.gridHeight = GRID_HEIGHT;
        snap.gridCell = GRID_CELL; snap.worldSize = WORLD_SIZE;
        transfer.push(a.buffer);
    }
    snap.plants = plantsArray();
    transfer.push(snap.plants.buffer);
    self.postMessage(snap, transfer);
}

// ─── Fixed-timestep sim clock ──────────────────────────────────────────────
// Driven by 'pump' messages carrying the main thread's real dt (a worker's own
// setInterval doesn't pump reliably without the windowed engine loop, and
// message-driven stepping is what lets headless tests advance the sim too). The
// worker still does all the heavy step + emit work on its own thread; the main
// thread only fires the tiny pump and never blocks. Growth stays
// framerate-independent because dt is real wall-clock time.
const SIM_STEP_DT = 0.02;
const BASE_GROWTH = 1.0;      // sim-seconds per real second at 1.0× time scale
const MAX_CATCHUP = 6;
const REBUILD_HZ = 12;
const REBUILD_MIN_DT = 1.0 / REBUILD_HZ;

let playing = true;
let timeScale = 1.0;
let simAccum = 0;
let simDirty = true;          // emit an initial frame as soon as the world exists
let clock = 0;                // worker-local clock, accumulated from pump dt
let lastEmitT = 0;

function pump(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    clock += dt;

    if (playing && world) {
        simAccum += dt * BASE_GROWTH * timeScale;
        let steps = 0;
        while (simAccum >= SIM_STEP_DT && steps < MAX_CATCHUP) {
            world.step(SIM_STEP_DT);
            simAccum -= SIM_STEP_DT;
            steps++;
            simDirty = true;
        }
        if (steps === MAX_CATCHUP) simAccum = 0;
    }

    if (simDirty && (clock - lastEmitT) >= REBUILD_MIN_DT) {
        emitFrame();
        simDirty = false;
        lastEmitT = clock;
    }
}

self.onmessage = (e) => {
    const m = e.data;
    if (!m || !m.type) return;
    switch (m.type) {
        case 'pump':      pump(m.dt); break;
        case 'timeScale': timeScale = m.v; break;
        case 'climate':   if (world) world.setClimate({ annualTempBase: m.temp }); break;
        case 'playing':   playing = m.on; break;
        case 'step':
            if (world) { world.step(SIM_STEP_DT); emitFrame(); lastEmitT = clock; }
            break;
        case 'seed':      if (world) { plant(m.x, m.z, m.species); simDirty = true; } break;
        case 'reset':     buildWorld(); emitFrame(); lastEmitT = clock; break;
        case 'layers':    layers = m.flags; simDirty = true; break;   // re-emit with the new set
        case 'snapshot':  if (world) emitSnapshot(m.which); break;
    }
};

buildWorld();
emitFrame();                 // first frame so the main thread has geometry immediately
