// flora-lab — make broflora's sim primitives visible.
//
// Visual language:
//   branches      solid mesh (the real plant)                         brown
//   foliage       wire sphere cage per sample, scaled by mass         green
//   blooms        wire cross + normal stub per anchor                  magenta
//   shadow grid   wire box per cell whose Q_G < threshold              blue
//   seed ring     wire circle on ground at each plant's seedingRadius  white

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

scene.setAmbient([0.06, 0.07, 0.08]);
scene.setToneMap({ mode: 'aces', exposure: 1.0 });

scene.createLight({
    type: 'directional',
    direction: [-0.4, -0.85, -0.25],
    color: [1.0, 0.96, 0.9],
    intensity: 2.2,
    castsShadow: true,
});

// ─── Orbit camera ─────────────────────────────────────────────────────────

const cam = {
    target: [0, 2, 0],
    theta: Math.PI * 0.35,
    phi:   Math.PI * 0.40,
    radius: 18,
    fov: 50, near: 0.1, far: 500,
};

function applyCamera() {
    const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    const st = Math.sin(cam.theta), ct = Math.cos(cam.theta);
    const eye = [
        cam.target[0] + cam.radius * sp * ct,
        cam.target[1] + cam.radius * cp,
        cam.target[2] + cam.radius * sp * st,
    ];
    scene.setCamera({
        position: eye, target: cam.target, up: [0, 1, 0],
        fov: cam.fov, near: cam.near, far: cam.far,
    });
}
applyCamera();

let dragMode = 0, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    dragMode = (e.button === 2 || e.shiftKey) ? 2 : 1;
    e.preventDefault();
});
window.addEventListener('mouseup', () => { dragMode = 0; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousemove', (e) => {
    if (!dragMode) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragMode === 1) {
        cam.theta += dx * 0.01;
        cam.phi   += dy * 0.01;
        const eps = 0.05;
        if (cam.phi < eps) cam.phi = eps;
        if (cam.phi > Math.PI - eps) cam.phi = Math.PI - eps;
    } else {
        const sp = Math.sin(cam.phi);
        const right = [-Math.sin(cam.theta), 0, Math.cos(cam.theta)];
        const fwd  = [sp * Math.cos(cam.theta), Math.cos(cam.phi), sp * Math.sin(cam.theta)];
        const up = [
            -fwd[1] * right[2],
            right[0] * fwd[2] - right[2] * fwd[0],
            -right[0] * fwd[1],
        ];
        const k = cam.radius * 0.0015;
        cam.target[0] += (-right[0] * dx + up[0] * dy) * k;
        cam.target[1] += (-right[1] * dx + up[1] * dy) * k;
        cam.target[2] += (-right[2] * dx + up[2] * dy) * k;
    }
    applyCamera();
});
canvas.addEventListener('wheel', (e) => {
    cam.radius *= Math.exp(e.deltaY * 0.001);
    if (cam.radius < 1) cam.radius = 1;
    if (cam.radius > 200) cam.radius = 200;
    applyCamera();
    e.preventDefault();
}, { passive: false });

// ─── Ground ───────────────────────────────────────────────────────────────

const WORLD_SIZE = 16;     // metres; ground is [-8,8] × [-8,8]
const GRID_RES = 16;       // shadow grid cells per side
const GRID_CELL = WORLD_SIZE / GRID_RES;
const GRID_HEIGHT = 16;    // metres tall

scene.createMesh({
    mesh: 'plane',
    halfW: WORLD_SIZE * 0.5, halfD: WORLD_SIZE * 0.5,
    y: 0, color: '#3a4238', metallic: 0, roughness: 0.95,
    receivesShadow: true,
});

// ─── broflora world ───────────────────────────────────────────────────────

let world = null;
let rootProto = -1;
let plants = [];   // { idx, species, color }

const SPECIES = {
    sun:   {
        // Sun-loving pioneer: taller, more upright, open crown. Low apical
        // dominance lets vigor reach all four whorl arms so the crown
        // branches volumetrically; `orthotropy` lifts the arms enough to
        // gain height while still spreading.
        species:  { shadeTolerance: 0.35, moduleMatureAge: 0.6,
                    tropismG2: 0.12, growthScale: 1.0,
                    orthotropy: 0.4, rootVigorMax: 3.0,
                    apicalControl: 0.35, apicalControlMature: 0.3,
                    maxAge: 60 },
        color: [0.55, 0.78, 0.32],
    },
    shade: {
        // Shade-tolerant understory: slower, rounder, denser dome. Lower
        // orthotropy keeps it spreading wide and low.
        species:  { shadeTolerance: 0.8, moduleMatureAge: 0.7,
                    tropismG2: 0.12, growthScale: 0.8,
                    orthotropy: 0.48, rootVigorMax: 2.5,
                    apicalControl: 0.30, apicalControlMature: 0.3,
                    maxAge: 70 },
        color: [0.30, 0.62, 0.45],
    },
};

function buildWorld() {
    world = bro.flora.createWorld({
        rngSeed: 0xC0FFEE,
        climate: { annualTempBase: 15, annualPrecip: 1000 },
        shadow: {
            origin:   [-WORLD_SIZE * 0.5, 0, -WORLD_SIZE * 0.5],
            cellSize: GRID_CELL,
            width:  GRID_RES, height: GRID_HEIGHT, depth: GRID_RES,
            fill: 1.0,
        },
    });

    // Two whorl variants — both fill the crown volumetrically (a short
    // trunk topped by arms fanned in 3D) so growth never collapses into a
    // vertical whip. Module selection drifts between them in (determinacy,
    // apicalControl) space: vigorous shoots open a broad 5-arm crown, while
    // suppressed / low-vigor shoots make a smaller, denser 3-arm tuft. Both
    // sites sit at the plants' apicalControl (~0.3); only determinacy
    // (which tracks vigor) separates them.
    rootProto = world.addPrototype(bro.flora.prototypes.whorl(5, 0.8));
    const protoTuft = world.addPrototype(bro.flora.prototypes.whorl(3, 0.55));
    world.addVoronoiSite(rootProto, 0.5,  0.3);   // vigorous → broad crown
    world.addVoronoiSite(protoTuft, 0.12, 0.3);   // suppressed → dense tuft

    plants = [];
    // Initial planting: 2 sun + 2 shade in a row across the patch.
    const layout = [
        { x: -4.5, z: -2, sp: 'sun'   },
        { x: -1.5, z:  1, sp: 'sun'   },
        { x:  1.5, z: -1, sp: 'shade' },
        { x:  4.5, z:  2, sp: 'shade' },
    ];
    for (const p of layout) plant(p.x, p.z, p.sp);
}

function plant(x, z, speciesKey) {
    const def = SPECIES[speciesKey];
    const idx = world.addPlant({
        origin: [x, 0, z],
        species: def.species,
        prototypeIndex: rootProto,
    });
    if (idx >= 0) {
        plants.push({ origin: [x, 0, z], species: speciesKey, color: def.color });
    }
}

buildWorld();

// ─── Overlay state ────────────────────────────────────────────────────────

const overlays = {
    branches:    { label: 'branches',   color: [0.46, 0.30, 0.20], on: true, node: null },
    foliage:     { label: 'foliage',    color: [0.45, 0.85, 0.30, 0.55], on: true, node: null },
    blooms:      { label: 'blooms',     color: [1.00, 0.45, 0.75, 0.85], on: true, node: null },
    shadowGrid:  { label: 'shadow grid', color: [0.45, 0.60, 1.00, 0.30], on: false, node: null },
    seedRings:   { label: 'seeding radius', color: [1.00, 1.00, 1.00, 0.35], on: true, node: null },
    plantOrigins:{ label: 'plant origins', color: [1.00, 0.85, 0.30, 0.80], on: true, node: null },
};

function destroyOverlay(key) {
    const o = overlays[key];
    if (o.node) { o.node.destroy && o.node.destroy(); o.node = null; }
}
function destroyAllOverlays() { for (const k in overlays) destroyOverlay(k); }

function rebuildBranches() {
    destroyOverlay('branches');
    if (!overlays.branches.on || world.moduleCount === 0) return;
    const mesh = world.emitMesh(6);
    if (!mesh || mesh.triangleCount === 0) return;
    overlays.branches.node = scene.createMesh({
        data: mesh,
        color: overlays.branches.color,
        metallic: 0.0, roughness: 0.85,
        castsShadow: true, receivesShadow: true,
    });
}

function rebuildFoliage() {
    destroyOverlay('foliage');
    if (!overlays.foliage.on) return;
    const segs = world.emitSegments();
    const fol  = world.emitFoliage();
    if (!segs || segs.length === 0) return;

    const parts = [];
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i], f = fol[i];
        if (!f || f.mass < 0.02) continue;
        // Place sphere cage at midpoint of segment, sized by mass.
        const mx = (s.from[0] + s.to[0]) * 0.5;
        const my = (s.from[1] + s.to[1]) * 0.5;
        const mz = (s.from[2] + s.to[2]) * 0.5;
        const r = Math.min(0.45, 0.08 + f.mass * 0.20);
        parts.push(wire.translate(wire.sphereCage(r, 10), mx, my, mz));
    }
    if (parts.length === 0) return;
    const merged = wire.merge(parts);
    if (!merged) return;
    overlays.foliage.node = scene.createMesh({
        positions: merged.positions, indices: merged.indices,
        drawMode: 'lines', lineWidth: 1,
        color: overlays.foliage.color,
    });
}

function rebuildBlooms() {
    destroyOverlay('blooms');
    if (!overlays.blooms.on) return;
    const anchors = world.emitBloomAnchors();
    if (!anchors || anchors.length === 0) return;

    const parts = [];
    const stub = 0.18;
    for (const a of anchors) {
        const p = a.position, n = a.normal;
        parts.push(wire.translate(wire.cross(0.07), p[0], p[1], p[2]));
        parts.push(wire.line(p, [p[0] + n[0] * stub, p[1] + n[1] * stub, p[2] + n[2] * stub]));
    }
    const merged = wire.merge(parts);
    if (!merged) return;
    overlays.blooms.node = scene.createMesh({
        positions: merged.positions, indices: merged.indices,
        drawMode: 'lines', lineWidth: 2,
        color: overlays.blooms.color,
    });
}

function rebuildShadowGrid() {
    destroyOverlay('shadowGrid');
    if (!overlays.shadowGrid.on) return;

    const parts = [];
    const half = GRID_CELL * 0.48;
    // Sample on a coarse stride so the visualization stays readable.
    const stride = 1;
    for (let iy = 0; iy < GRID_HEIGHT; iy += stride) {
        for (let iz = 0; iz < GRID_RES; iz += stride) {
            for (let ix = 0; ix < GRID_RES; ix += stride) {
                const cx = -WORLD_SIZE * 0.5 + (ix + 0.5) * GRID_CELL;
                const cy = (iy + 0.5) * GRID_CELL;
                const cz = -WORLD_SIZE * 0.5 + (iz + 0.5) * GRID_CELL;
                const q = world.sampleShadow([cx, cy, cz]);
                if (q == null || q > 0.85) continue;   // only show occluded cells
                parts.push(wire.translate(wire.box(half, half, half), cx, cy, cz));
            }
        }
    }
    if (parts.length === 0) return;
    const merged = wire.merge(parts);
    if (!merged) return;
    overlays.shadowGrid.node = scene.createMesh({
        positions: merged.positions, indices: merged.indices,
        drawMode: 'lines', lineWidth: 1,
        color: overlays.shadowGrid.color,
    });
}

function rebuildSeedRings() {
    destroyOverlay('seedRings');
    if (!overlays.seedRings.on) return;
    const parts = [];
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (!info) continue;
        const r = info.species.seedingRadius;
        if (!(r > 0)) continue;
        parts.push(wire.translate(wire.circle(r, 48),
            info.origin[0], 0.02, info.origin[2]));
    }
    if (parts.length === 0) return;
    const merged = wire.merge(parts);
    if (!merged) return;
    overlays.seedRings.node = scene.createMesh({
        positions: merged.positions, indices: merged.indices,
        drawMode: 'lines', lineWidth: 1,
        color: overlays.seedRings.color,
    });
}

function rebuildPlantOrigins() {
    destroyOverlay('plantOrigins');
    if (!overlays.plantOrigins.on) return;
    const parts = [];
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (!info) continue;
        // Small cross + short vertical line above ground.
        parts.push(wire.translate(wire.cross(0.18),
            info.origin[0], 0.02, info.origin[2]));
        parts.push(wire.line(
            [info.origin[0], 0, info.origin[2]],
            [info.origin[0], 0.6, info.origin[2]]));
    }
    const merged = wire.merge(parts);
    if (!merged) return;
    overlays.plantOrigins.node = scene.createMesh({
        positions: merged.positions, indices: merged.indices,
        drawMode: 'lines', lineWidth: 2,
        color: overlays.plantOrigins.color,
    });
}

function rebuildAll() {
    rebuildBranches();
    rebuildFoliage();
    rebuildBlooms();
    rebuildShadowGrid();
    rebuildSeedRings();
    rebuildPlantOrigins();
    updateStats();
}

// ─── HUD: stats + controls ───────────────────────────────────────────────

const els = {
    simTime: document.getElementById('simTime'),
    plantCt: document.getElementById('plantCt'),
    moduleCt: document.getElementById('moduleCt'),
    floweringCt: document.getElementById('floweringCt'),
    triCt: document.getElementById('triCt'),
};

function updateStats() {
    els.simTime.textContent = world.simTime.toFixed(2);
    els.plantCt.textContent = world.plantCount;
    els.moduleCt.textContent = world.moduleCount;
    let flowering = 0;
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (info && info.flowering) flowering++;
    }
    els.floweringCt.textContent = flowering;
    const branchTris = (overlays.branches.node && world.emitMesh) ?
        (overlays.branches.node._triCount || '·') : 0;
    els.triCt.textContent = branchTris;
}

// Toggle row builder
const togglesRoot = document.getElementById('overlayToggles');
function rgbaCss(c) {
    const r = (c[0] * 255) | 0, g = (c[1] * 255) | 0, b = (c[2] * 255) | 0;
    const a = c.length > 3 ? c[3] : 1;
    return `rgba(${r},${g},${b},${a})`;
}
for (const key of Object.keys(overlays)) {
    const o = overlays[key];
    const row = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = o.on;
    cb.addEventListener('change', () => { o.on = cb.checked; rebuildAll(); });
    const sw = document.createElement('span');
    sw.className = 'swatch'; sw.style.background = rgbaCss(o.color);
    const txt = document.createElement('span');
    txt.textContent = o.label;
    row.appendChild(cb); row.appendChild(sw); row.appendChild(txt);
    togglesRoot.appendChild(row);
}

// Sim controls
let playing = true;
let timeScale = 1.0;
const SIM_DT = 0.02;          // per-step
const STEPS_PER_FRAME = 2;    // how many sim steps each rAF tick
const REBUILD_EVERY = 8;      // rebuild render meshes every N frames
let frameCt = 0;

const playBtn = document.getElementById('play');
playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
    playBtn.classList.toggle('on', playing);
});

document.getElementById('step1').addEventListener('click', () => {
    world.step(SIM_DT);
    rebuildAll();
});

document.getElementById('seed').addEventListener('click', () => {
    const sp = Math.random() < 0.5 ? 'sun' : 'shade';
    const x = (Math.random() - 0.5) * WORLD_SIZE * 0.8;
    const z = (Math.random() - 0.5) * WORLD_SIZE * 0.8;
    plant(x, z, sp);
    rebuildAll();
});

document.getElementById('reset').addEventListener('click', () => {
    destroyAllOverlays();
    buildWorld();
    rebuildAll();
});

const tsInp = document.getElementById('timeScale');
const tsVal = document.getElementById('timeScaleV');
tsInp.addEventListener('input', () => {
    timeScale = parseFloat(tsInp.value);
    tsVal.textContent = timeScale.toFixed(1) + '×';
});

const tempInp = document.getElementById('temp');
const tempVal = document.getElementById('tempV');
tempInp.addEventListener('input', () => {
    const t = parseFloat(tempInp.value);
    tempVal.textContent = t.toFixed(1) + ' °C';
    world.setClimate({ annualTempBase: t });
});

// ─── Main loop ────────────────────────────────────────────────────────────

function tick() {
    if (playing) {
        for (let i = 0; i < STEPS_PER_FRAME; i++) {
            world.step(SIM_DT * timeScale);
        }
        frameCt++;
        if (frameCt % REBUILD_EVERY === 0) rebuildAll();
        else updateStats();
    }
    requestAnimationFrame(tick);
}

rebuildAll();
requestAnimationFrame(tick);

// ─── Debug surface for headless ───────────────────────────────────────────
globalThis.__lab = { world, plants, overlays, rebuildAll };
