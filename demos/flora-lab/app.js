// flora-lab — grow a lush flowering landscape with broflora.
//
// The branch skeleton broflora simulates drives the rendered plant directly:
// real leaf cards are scattered along its twigs (Mesh.scatterLeaves) and a
// flower is stamped at every bloom anchor. The wireframe layers below are
// diagnostic overlays, off by default — toggle them on to inspect the sim.
//
// Fast rendering: Native C++ mesh emitters (world.emitFoliageMesh & world.emitBloomMesh)
// run leaf scattering and bloom stamping directly in C++, eliminating JS object
// marshaling for silky 360 FPS dynamic 3D rendering. Octahedral impostors
// (bro.impostor.createLayer) are also available.
//
// The meadow is lit by a full time-of-day rig (lighting.js): an HDR sky drives
// IBL + skybox, a CSM-shadowed sun rakes the canopy, and the Night preset adds
// drifting firefly point lights, a cool moonbeam spot, glowing blooms, and fog.
//
// Visual language:
//   branches      solid tapered tubes (the real stems)                 bark
//   foliage       leaf cards scattered along the twigs                 green
//   blooms        radial flowers at each bloom anchor                  blossom
//   impostors     merged octahedral billboard quads (fast 360 FPS)     emerald
//   shadow grid   wire box per cell whose Q_G < threshold   (diag)     blue
//   seed ring     wire circle at each plant's seedingRadius (diag)     white
//   plant origins cross + stem marker per plant origin     (diag)      amber

import { wire } from "/app/wire.js";
import { createLighting } from "/app/lighting.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { bakeImpostorAtlas } from "/lib/impostor.js";

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

// ─── Lighting rig ───────────────────────────────────────────────────────────
// The full time-of-day rig — IBL sky + skybox, a CSM-shadowed sun aligned to
// the HDR, distance fog, night fireflies (point lights), and ACES tonemapping
// — lives in lighting.js. Instead of a flat ambient term the foliage now takes
// orientation-dependent skylight from the environment map, so a leaf facing the
// sky reads cool and one facing the ground reads warm, and the canopy keeps its
// form in shade. The blooms' golden eyes read their emissive gain from the
// active preset so they glow after dark.
let bloomEmissiveGain = 0.5;
const lighting = createLighting(scene, {
    onEmissiveGain: (g) => { bloomEmissiveGain = g; },
});
const START_PRESET = 'golden';

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
    y: 0, color: '#36421f', metallic: 0, roughness: 1.0,   // mossy meadow floor
    receivesShadow: true,
});

// ─── broflora sim on a worker thread ───────────────────────────────────────
//
// The whole ecosystem sim + mesh emit runs in sim-worker.js on its own thread.
// This thread never steps the sim or scatters a single leaf: it drives the
// worker with a lightweight `pump {dt}` each frame and, when a frame packet
// comes back, uploads the compact branch-tube / foliage-scatter buffers (and
// the bloom meshes) to the GPU and draws. So the render loop pays neither the
// sim (~85 ms/s) nor the emit (~10 ms/rebuild) — it floats to the display
// ceiling while the plant keeps growing on the other thread.

const SPECIES = {
    sun:   { color: [0.55, 0.78, 0.32] },
    shade: { color: [0.30, 0.62, 0.45] },
};

const sim = new Worker('sim-worker.js');

// Latest data the worker has sent (the main thread's whole view of the sim).
let stats = { simTime: 0, plantCount: 0, moduleCount: 0, flowering: 0 };
let plantsData = new Float32Array(0);   // [x,y,z, speciesFlag] per plant
let shadowSnap = null;                   // { shadow, gridRes, ... } from a snapshot request

function pumpWorker(dt) { sim.postMessage({ type: 'pump', dt }); }

// ─── Overlay state ────────────────────────────────────────────────────────

const overlays = {
    branches:    { label: 'branches',   color: [0.33, 0.23, 0.14], on: true,  node: null },
    foliage:     { label: 'foliage',    color: [0.34, 0.55, 0.24], on: true,  node: null },
    blooms:      { label: 'blooms',     color: [0.97, 0.62, 0.76], on: true,  node: null },
    impostors:   { label: 'impostors (fast)', color: [0.30, 0.85, 0.55], on: false, node: null, quadCount: 0 },
    shadowGrid:  { label: 'shadow grid', color: [0.45, 0.60, 1.00, 0.30], on: false, node: null },
    seedRings:   { label: 'seeding radius', color: [1.00, 1.00, 1.00, 0.35], on: false, node: null },
    plantOrigins:{ label: 'plant origins', color: [1.00, 0.85, 0.30, 0.80], on: false, node: null },
};

// Leaf cards / flowers bake a per-vertex windBend value into vertex colors;
// clearing the color buffer lets the flat material color show instead.
function stripVertexColors(mesh) {
    if (!mesh) return mesh;
    try { mesh.colors = new Float32Array(0); } catch (e) {}
    return mesh;
}

// Rotate a mesh so its local +Y points along unit vector n.
function orientYTo(mesh, n) {
    const ny = Math.max(-1, Math.min(1, n[1]));
    const ang = Math.acos(ny);
    if (ang < 1e-4) return;
    if (ang > Math.PI - 1e-4) { mesh.rotate(1, 0, 0, Math.PI); return; }
    let ax = n[2], az = -n[0];                 // cross([0,1,0], n)
    const L = Math.hypot(ax, 0, az) || 1;
    mesh.rotate(ax / L, 0, az / L, ang);
}

// Persistent scene mesh node references
let branchesNode = null;
let foliageNode = null;
let bloomPetalsNode = null;
let bloomCentersNode = null;
let shadowGridNode = null;
let seedRingsNode = null;
let plantOriginsNode = null;

// Base geometry cache
let cachedLeafCard = null;
let cachedBranchCylinder = null;
let cachedFlowerBase = null;
let cachedCenterBase = null;

function getLeafCard() {
    if (!cachedLeafCard) {
        cachedLeafCard = Mesh.leafCard('oval', {
            width: 0.13, length: 0.23, bend: 0.45,
            fullUV: true, shapedSilhouette: true, cup: 0.3,
            widthSegments: 3, lengthSegments: 6,
        });
    }
    return cachedLeafCard;
}

function getBranchCylinder() {
    if (!cachedBranchCylinder) {
        cachedBranchCylinder = Mesh.cylinder(1.0, 0.5, 6);
        cachedBranchCylinder.translate(0, 0, 0.5);
    }
    return cachedBranchCylinder;
}

function getBloomBases() {
    if (!cachedFlowerBase) {
        cachedFlowerBase = Mesh.flower({
            petalCount: 5, petalShape: 'petal',
            petalLength: 0.13, petalWidth: 0.085, petalBend: 0.4,
            petalCup: 0.22, shapedPetals: true,
            outerTilt: -0.15, innerTilt: -0.12,
            centerRadius: 0.03, centerHeight: 0.02,
        });
        stripVertexColors(cachedFlowerBase);

        cachedCenterBase = Mesh.sphere(0.03, 8, 6);
        cachedCenterBase.scale(1, 0.5, 1);
        stripVertexColors(cachedCenterBase);
    }
    return { base: cachedFlowerBase, centerBase: cachedCenterBase };
}

function destroyOverlay(key) {
    const o = overlays[key];
    if (!o.node) return;
    const nodes = Array.isArray(o.node) ? o.node : [o.node];
    for (const n of nodes) { if (n && n.destroy) n.destroy(); }
    o.node = null;
}
function destroyAllOverlays() {
    for (const k in overlays) destroyOverlay(k);
    branchesNode = null;
    foliageNode = null;
    bloomPetalsNode = null;
    bloomCentersNode = null;
    shadowGridNode = null;
    seedRingsNode = null;
    plantOriginsNode = null;
}

// Apply the worker's branch-tube segment buffer — upload it to the GPU tube
// node (created on first packet). The tube geometry is synthesised in the VS,
// so this only pushes a compact per-segment buffer (~0.6ms), never a mesh.
function applyBranches(tube) {
    if (!tube || tube.segCount === 0) {
        if (branchesNode) branchesNode.visible = false;
        return;
    }
    const desc = Object.assign({ sides: 6, radiusScale: 1.0 }, tube);
    if (!branchesNode) {
        branchesNode = scene.createInstancedMesh({
            tube: desc,
            color: overlays.branches.color,
            metallic: 0.0, roughness: 0.85,
            castsShadow: true, receivesShadow: true,
        });
        overlays.branches.node = branchesNode;
    } else {
        branchesNode.visible = true;
        branchesNode.setTubeSegments(desc);
    }
}

// Apply the worker's foliage-scatter buffers to the GPU scatter node. The
// leaves are synthesised in the VS from the per-segment + per-leaf buffers.
function applyFoliage(s) {
    if (!s || s.segCount === 0) {
        if (foliageNode) foliageNode.visible = false;
        return;
    }
    const leaf = getLeafCard();
    // The scatter node needs the same placement params the worker emitted with
    // (they shape each leaf's transform in the VS); the counts come baked into
    // the per-leaf buffer.
    const scatter = Object.assign({
        maxRadius: 0.22, minDepth: 1, perUnitLength: 120,
        upBias: 0.5, tiltJitter: 0.55, rollJitter: 0.9,
        baseScale: 1.0, scaleJitter: 0.3, scaleByRadius: 0.25, seed: 0x1eaf,
    }, s);
    if (!foliageNode) {
        foliageNode = scene.createInstancedMesh({
            mesh: leaf,
            scatter,
            color: SPECIES.sun.color,
            metallic: 0.0, roughness: 0.92,
            doubleSided: true, subsurface: 0.5,
            vertexColorTint: false,
            castsShadow: false, receivesShadow: true,
        });
        overlays.foliage.node = foliageNode;
    } else {
        foliageNode.visible = true;
        foliageNode.setScatterSegments(scatter);
    }
}

// Apply the worker's bloom meshes (transferred zero-copy by pointer).
function applyBlooms(petals, centers) {
    if (petals && petals.triangleCount > 0) {
        if (!bloomPetalsNode) {
            bloomPetalsNode = scene.createMesh({
                data: petals,
                color: overlays.blooms.color,
                metallic: 0.0, roughness: 0.55,
                twoSided: true, subsurface: 0.4,
                castsShadow: false, receivesShadow: true,
            });
        } else {
            bloomPetalsNode.visible = true;
            bloomPetalsNode.updateMesh(petals, { transfer: true });
        }
    } else if (bloomPetalsNode) {
        bloomPetalsNode.visible = false;
    }

    if (centers && centers.triangleCount > 0) {
        if (!bloomCentersNode) {
            bloomCentersNode = scene.createMesh({
                data: centers,
                color: [0.98, 0.80, 0.25],   // golden eye
                metallic: 0.0, roughness: 0.6, emissive: 0.3 * bloomEmissiveGain,
                castsShadow: false, receivesShadow: true,
            });
        } else {
            bloomCentersNode.visible = true;
            bloomCentersNode.emissive = 0.3 * bloomEmissiveGain;
            bloomCentersNode.updateMesh(centers, { transfer: true });
        }
    } else if (bloomCentersNode) {
        bloomCentersNode.visible = false;
    }
    overlays.blooms.node = [bloomPetalsNode, bloomCentersNode].filter(Boolean);
}


// ─── Fast Octahedral Impostor Rendering ────────────────────────────────────
const atlasCache = { sun: null, shade: null };

function initImpostorAtlases() {
    const capCvs = document.createElement('canvas');
    capCvs.width = 128; capCvs.height = 128;
    const capScene = capCvs.getContext('scene');

    const leaf = Mesh.leafCard('oval', {
        width: 0.13, length: 0.23, bend: 0.45,
        fullUV: true, shapedSilhouette: true, cup: 0.3,
        widthSegments: 3, lengthSegments: 6,
    });

    for (const key of ['sun', 'shade']) {
        const def = SPECIES[key];
        const masterWorld = bro.flora.createWorld({
            rngSeed: 0xBAADF00D,
            climate: { annualTempBase: 15, annualPrecip: 1000 },
            shadow: { origin: [-10, 0, -10], cellSize: 1.0, width: 20, height: 20, depth: 20, fill: 1.0 }
        });
        const protoArms = (key === 'sun') ? 5 : 3;
        const protoSpread = (key === 'sun') ? 0.8 : 0.55;
        const pIdx = masterWorld.addPrototype(bro.flora.prototypes.whorl(protoArms, protoSpread));
        masterWorld.addVoronoiSite(pIdx, 0.5, 0.3);
        const plantIdx = masterWorld.addPlant({
            origin: [0, 0, 0],
            species: def.species,
            prototypeIndex: pIdx,
        });

        for (let s = 0; s < 100; s++) masterWorld.step(0.1);

        const branchMesh = masterWorld.emitPlantMesh ? masterWorld.emitPlantMesh(plantIdx, 6) : masterWorld.emitMesh(6);
        const segs = masterWorld.emitPlantSegments(plantIdx);
        const fol = masterWorld.emitPlantFoliage(plantIdx);
        const densityWeight = [];
        if (segs && segs.length > 0) {
            for (let k = 0; k < segs.length; k++) {
                const f = fol && fol[k];
                const raw = f && f.lightExposure01 !== undefined ? f.lightExposure01 : 1.0;
                const exposure = 0.12 + 0.88 * raw;
                const maturity = f ? Math.min(1, f.age01) : 1.0;
                const alive = f ? (1.0 - f.senescence01) : 1.0;
                const twig = f && f.twigGrade01 !== undefined ? f.twigGrade01 : 1.0;
                densityWeight.push(exposure * maturity * alive * twig);
            }
        }
        const leafMesh = (segs && segs.length > 0) ? Mesh.scatterLeaves(segs, leaf, {
            maxRadius: 0.22, minDepth: 1, perUnitLength: 220,
            densityWeight: densityWeight, upBias: 0.5, tiltJitter: 0.55, rollJitter: 0.9,
            baseScale: 1.0, scaleJitter: 0.3, scaleByRadius: 0.25, seed: 0x1eaf
        }) : null;

        atlasCache[key] = bakeImpostorAtlas(capScene, { branchMesh, leafMesh }, {
            cols: 8, rows: 8, cell: 128, leafColor: def.color
        });
    }
}

function rebuildImpostors() {
    destroyOverlay('impostors');
    overlays.impostors.quadCount = 0;
    const nPlants = plantsData.length / 4;
    if (!overlays.impostors.on || nPlants === 0) return;
    if (!bro.impostor || !bro.impostor.createLayer) return;

    if (!atlasCache.sun || !atlasCache.shade) {
        initImpostorAtlases();
    }

    // Group plant origins by species flag (plantsData: [x,y,z, flag] per plant;
    // flag 1 = shade, 0 = sun).
    const groups = { sun: [], shade: [] };
    for (let i = 0; i < nPlants; i++) {
        const o = i * 4;
        const key = (plantsData[o + 3] >= 0.5) ? 'shade' : 'sun';
        groups[key].push([plantsData[o], plantsData[o + 1], plantsData[o + 2]]);
    }

    const nodes = [];
    let totalQuads = 0;

    for (const key of ['sun', 'shade']) {
        const origins = groups[key];
        if (origins.length === 0) continue;
        const atlas = atlasCache[key];
        if (!atlas) continue;

        const transforms = new Float32Array(origins.length * 9);
        for (let idx = 0; idx < origins.length; idx++) {
            const o = idx * 9;
            transforms[o] = origins[idx][0]; transforms[o + 1] = origins[idx][1]; transforms[o + 2] = origins[idx][2];
            transforms[o + 3] = 0; transforms[o + 4] = 0; transforms[o + 5] = 0; transforms[o + 6] = 1;
            transforms[o + 7] = 1.0;
            transforms[o + 8] = 0;
        }

        const layer = bro.impostor.createLayer(scene, atlas, transforms, {
            cullNear: 2000, cullFar: 4000
        });
        if (layer && layer.node) {
            nodes.push(layer.node);
            totalQuads += layer.quadCount;
        }
    }

    overlays.impostors.node = nodes.length ? nodes : null;
    overlays.impostors.quadCount = totalQuads;
}

function rebuildShadowGrid() {
    if (!overlays.shadowGrid.on) {
        if (shadowGridNode) shadowGridNode.visible = false;
        return;
    }

    // Shadow occupancy is a worker-side query — request a snapshot and rebuild
    // when it arrives (this overlay is a dev diagnostic, off the hot path).
    if (!shadowSnap) {
        sim.postMessage({ type: 'snapshot', which: { shadowGrid: true } });
        return;
    }
    const parts = [];
    const half = GRID_CELL * 0.48;
    let n = 0;
    for (let iy = 0; iy < GRID_HEIGHT; iy++) {
        for (let iz = 0; iz < GRID_RES; iz++) {
            for (let ix = 0; ix < GRID_RES; ix++) {
                const q = shadowSnap.shadow[n++];
                if (q == null || q > 0.85) continue;
                const cx = -WORLD_SIZE * 0.5 + (ix + 0.5) * GRID_CELL;
                const cy = (iy + 0.5) * GRID_CELL;
                const cz = -WORLD_SIZE * 0.5 + (iz + 0.5) * GRID_CELL;
                parts.push(wire.translate(wire.box(half, half, half), cx, cy, cz));
            }
        }
    }
    if (parts.length === 0) {
        if (shadowGridNode) shadowGridNode.visible = false;
        return;
    }
    const merged = wire.merge(parts);
    if (!merged) {
        if (shadowGridNode) shadowGridNode.visible = false;
        return;
    }
    if (!shadowGridNode) {
        shadowGridNode = scene.createMesh({
            positions: merged.positions, indices: merged.indices,
            drawMode: 'lines', lineWidth: 1,
            color: overlays.shadowGrid.color,
        });
        overlays.shadowGrid.node = shadowGridNode;
    } else {
        shadowGridNode.visible = true;
        shadowGridNode.updateMesh({ positions: merged.positions, indices: merged.indices });
    }
}

function rebuildSeedRings() {
    // Every species in this app has seedingRadius 0, so this overlay draws
    // nothing; kept as a hook for when seeding is enabled.
    if (seedRingsNode) seedRingsNode.visible = false;
}

function rebuildPlantOrigins() {
    if (!overlays.plantOrigins.on) {
        if (plantOriginsNode) plantOriginsNode.visible = false;
        return;
    }
    const parts = [];
    const n = plantsData.length / 4;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const x = plantsData[o], z = plantsData[o + 2];
        parts.push(wire.translate(wire.cross(0.18), x, 0.02, z));
        parts.push(wire.line([x, 0, z], [x, 0.6, z]));
    }
    const merged = parts.length ? wire.merge(parts) : null;
    if (!merged) {
        if (plantOriginsNode) plantOriginsNode.visible = false;
        return;
    }
    if (!plantOriginsNode) {
        plantOriginsNode = scene.createMesh({
            positions: merged.positions, indices: merged.indices,
            drawMode: 'lines', lineWidth: 2,
            color: overlays.plantOrigins.color,
        });
        overlays.plantOrigins.node = plantOriginsNode;
    } else {
        plantOriginsNode.visible = true;
        plantOriginsNode.updateMesh({ positions: merged.positions, indices: merged.indices });
    }
}

// The diagnostic overlays read the worker's plant/shadow snapshot, not a live
// world — rebuilt whenever a fresh packet lands or a toggle flips.
function rebuildDiagnostics() {
    rebuildImpostors();
    rebuildShadowGrid();
    rebuildSeedRings();
    rebuildPlantOrigins();
}

// Apply a frame packet from the sim worker: upload the enabled layers' compact
// buffers, cache stats + plant origins, and refresh the diagnostic overlays.
function applyFrame(f) {
    if (f.branches) applyBranches(f.branches); else if (branchesNode) branchesNode.visible = false;
    if (f.foliage)  applyFoliage(f.foliage);   else if (foliageNode)  foliageNode.visible = false;
    if (overlays.blooms.on) applyBlooms(f.bloomPetals, f.bloomCenters);
    else { if (bloomPetalsNode) bloomPetalsNode.visible = false; if (bloomCentersNode) bloomCentersNode.visible = false; }
    if (f.stats)  stats = f.stats;
    if (f.plants) plantsData = f.plants;
    rebuildDiagnostics();
    updateStats(true);
}

// ─── HUD: stats + controls ───────────────────────────────────────────────

const els = {
    simTime: document.getElementById('simTime'),
    plantCt: document.getElementById('plantCt'),
    moduleCt: document.getElementById('moduleCt'),
    floweringCt: document.getElementById('floweringCt'),
    triCt: document.getElementById('triCt'),
};

let lastStatsTime = 0;
function updateStats(force = false) {
    const now = performance.now();
    if (!force && (now - lastStatsTime < 100)) return;
    lastStatsTime = now;

    els.simTime.textContent = stats.simTime.toFixed(2);
    els.plantCt.textContent = stats.plantCount;
    els.moduleCt.textContent = stats.moduleCount;
    els.floweringCt.textContent = stats.flowering;

    let totalTris = 0;
    if (overlays.branches.on && branchesNode && branchesNode.visible) {
        totalTris += (branchesNode.data && branchesNode.data.triangleCount) ? branchesNode.data.triangleCount : (branchesNode._triCount || 0);
    }
    if (overlays.foliage.on && foliageNode && foliageNode.visible) {
        totalTris += (foliageNode.data && foliageNode.data.triangleCount) ? foliageNode.data.triangleCount : (foliageNode._triCount || 0);
    }
    if (overlays.blooms.on) {
        if (bloomPetalsNode && bloomPetalsNode.visible) {
            totalTris += (bloomPetalsNode.data && bloomPetalsNode.data.triangleCount) ? bloomPetalsNode.data.triangleCount : (bloomPetalsNode._triCount || 0);
        }
        if (bloomCentersNode && bloomCentersNode.visible) {
            totalTris += (bloomCentersNode.data && bloomCentersNode.data.triangleCount) ? bloomCentersNode.data.triangleCount : (bloomCentersNode._triCount || 0);
        }
    }
    if (overlays.impostors.on && overlays.impostors.node) {
        totalTris += (overlays.impostors.quadCount || 0) * 2;
    }

    els.triCt.textContent = totalTris > 0 ? totalTris.toLocaleString() : '0';
}

// Toggle row builder
const togglesRoot = document.getElementById('overlayToggles');
function rgbaCss(c) {
    const r = (c[0] * 255) | 0, g = (c[1] * 255) | 0, b = (c[2] * 255) | 0;
    const a = c.length > 3 ? c[3] : 1;
    return `rgba(${r},${g},${b},${a})`;
}

const toggleInputs = {};
for (const key of Object.keys(overlays)) {
    const o = overlays[key];
    const row = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = o.on;
    toggleInputs[key] = cb;
    cb.addEventListener('change', () => {
        o.on = cb.checked;
        if (key === 'impostors' && cb.checked) {
            overlays.branches.on = false;
            overlays.foliage.on = false;
            overlays.blooms.on = false;
            if (toggleInputs.branches) toggleInputs.branches.checked = false;
            if (toggleInputs.foliage) toggleInputs.foliage.checked = false;
            if (toggleInputs.blooms) toggleInputs.blooms.checked = false;
        } else if ((key === 'branches' || key === 'foliage' || key === 'blooms') && cb.checked) {
            overlays.impostors.on = false;
            if (toggleInputs.impostors) toggleInputs.impostors.checked = false;
        }
        // Tell the worker which hot layers to emit; refresh diagnostics locally.
        sim.postMessage({ type: 'layers', flags: {
            branches: overlays.branches.on, foliage: overlays.foliage.on, blooms: overlays.blooms.on,
        }});
        // A layer turned off won't get another packet — hide its node now.
        if (!overlays.branches.on && branchesNode) branchesNode.visible = false;
        if (!overlays.foliage.on && foliageNode) foliageNode.visible = false;
        if (!overlays.blooms.on) {
            if (bloomPetalsNode) bloomPetalsNode.visible = false;
            if (bloomCentersNode) bloomCentersNode.visible = false;
        }
        rebuildDiagnostics();
    });
    const sw = document.createElement('span');
    sw.className = 'swatch'; sw.style.background = rgbaCss(o.color);
    const txt = document.createElement('span');
    txt.textContent = o.label;
    row.appendChild(cb); row.appendChild(sw); row.appendChild(txt);
    togglesRoot.appendChild(row);
}

// Sim controls — every control is a message to the worker (it owns the sim).
let playing = true;

const playBtn = document.getElementById('play');
playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
    playBtn.classList.toggle('on', playing);
    sim.postMessage({ type: 'playing', on: playing });
});

document.getElementById('step1').addEventListener('click', () => {
    sim.postMessage({ type: 'step' });
});

document.getElementById('seed').addEventListener('click', () => {
    const sp = Math.random() < 0.5 ? 'sun' : 'shade';
    const x = (Math.random() - 0.5) * WORLD_SIZE * 0.8;
    const z = (Math.random() - 0.5) * WORLD_SIZE * 0.8;
    sim.postMessage({ type: 'seed', x, z, species: sp });
});

document.getElementById('reset').addEventListener('click', () => {
    shadowSnap = null;
    sim.postMessage({ type: 'reset' });
});

const tsInp = document.getElementById('timeScale');
const tsVal = document.getElementById('timeScaleV');
tsInp.addEventListener('input', () => {
    const timeScale = parseFloat(tsInp.value);
    tsVal.textContent = timeScale.toFixed(1) + '×';
    sim.postMessage({ type: 'timeScale', v: timeScale });
});

const tempInp = document.getElementById('temp');
const tempVal = document.getElementById('tempV');
tempInp.addEventListener('input', () => {
    const t = parseFloat(tempInp.value);
    tempVal.textContent = t.toFixed(1) + ' °C';
    sim.postMessage({ type: 'climate', temp: t });
});

// Time-of-day selector — one button per lighting preset. Switching re-tints
// the blooms; the emissive gain is re-applied to the live bloom node.
const todRoot = document.getElementById('todButtons');
const todBtns = {};
function selectTod(key) {
    lighting.apply(key);
    for (const k in todBtns) todBtns[k].classList.toggle('on', k === key);
    if (bloomCentersNode) bloomCentersNode.emissive = 0.3 * bloomEmissiveGain;
}
for (const key of lighting.order) {
    const b = document.createElement('button');
    b.textContent = lighting.presets[key].label;
    b.addEventListener('click', () => selectTod(key));
    todRoot.appendChild(b);
    todBtns[key] = b;
}

// ─── Sim worker plumbing ───────────────────────────────────────────────────
//
// The worker owns the sim and does all the heavy work (step + emit) on its own
// thread. This thread only: (1) pumps it once per rendered frame with the real
// dt, so growth stays framerate-independent; (2) uploads the compact buffers
// each frame packet carries and draws. A rendered frame that gets no packet
// costs only a draw, so the display floats to the render ceiling while the
// plant grows on the other thread.

sim.onmessage = (e) => {
    const m = e.data;
    if (!m || !m.type) return;
    if (m.type === 'frame') {
        applyFrame(m);
    } else if (m.type === 'snapshot') {
        if (m.shadow) shadowSnap = m;
        if (m.plants) plantsData = m.plants;
        rebuildDiagnostics();
    }
};

// ─── Main loop ────────────────────────────────────────────────────────────

let lastFrameT = performance.now() / 1000;
function tick() {
    const nowT = performance.now() / 1000;
    let realDt = nowT - lastFrameT;
    lastFrameT = nowT;
    if (realDt > 0.1) realDt = 0.1;   // swallow long stalls (tab switch / first frame)

    if (playing) pumpWorker(realDt);   // the worker steps + emits on its own thread
    updateStats(false);
    lighting.update(realDt);           // drift the fireflies on the real clock, even while paused
    requestAnimationFrame(tick);
};

installSystemMenu();
// A gentle breeze. Foliage meshes opt in via `wind:1`; the per-vertex
// windBend (leaf base→tip) shapes the sway so tips flutter and stems stay
// put. Branches carry no color buffer, so the woody structure holds firm.
scene.setWind({ direction: [1, 0, 0.35], strength: 0.06, frequency: 1.1 });
selectTod(START_PRESET);   // light the scene before the first frame
requestAnimationFrame(tick);

// ─── Debug surface for headless ───────────────────────────────────────────
globalThis.__lab = { sim, overlays, getLeafCard, applyFrame, rebuildDiagnostics,
    lighting, selectTod, getStats: () => stats, getPlants: () => plantsData };
