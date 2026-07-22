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

// ─── broflora world ───────────────────────────────────────────────────────

let world = null;
let rootProto = -1;
let plants = [];   // { idx, species, color }

const SPECIES = {
    sun:   {
        species:  { shadeTolerance: 0.35, moduleMatureAge: 0.6,
                    tropismG2: 0.12, growthScale: 1.0,
                    orthotropy: 0.4, rootVigorMax: 2.5,
                    apicalControl: 0.35, apicalControlMature: 0.3,
                    individualVariation: 0.18, maxAge: 60,
                    seedingRadius: 0.0 },
        color: [0.55, 0.78, 0.32],
    },
    shade: {
        species:  { shadeTolerance: 0.65, moduleMatureAge: 0.7,
                    tropismG2: 0.12, growthScale: 0.8,
                    orthotropy: 0.48, rootVigorMax: 2.0,
                    apicalControl: 0.30, apicalControlMature: 0.3,
                    individualVariation: 0.16, maxAge: 70,
                    seedingRadius: 0.0 },
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

function rebuildBranches() {
    if (!overlays.branches.on || world.moduleCount === 0) {
        if (branchesNode) branchesNode.visible = false;
        return;
    }
    if (world.emitSegmentTransforms && scene.createInstancedMesh) {
        const transforms = world.emitSegmentTransforms();
        if (!transforms || transforms.length === 0) {
            if (branchesNode) branchesNode.visible = false;
            return;
        }
        const cyl = getBranchCylinder();
        if (!branchesNode) {
            branchesNode = scene.createInstancedMesh({
                mesh: cyl,
                instances: transforms,
                color: overlays.branches.color,
                metallic: 0.0, roughness: 0.85,
                // Branch cylinders are opaque solids: 17k separate instanced
                // draws hit InstancedMeshNode's fixed per-instance GPU cost
                // (~3us each -> tens of ms). staticBatch bakes them into one
                // merged draw (pixel-identical), collapsing that to ~0.1ms. The
                // trade is an O(verts) CPU rebake when the set changes each
                // rebuild — cheap here (~245k verts) next to the GPU it saves.
                staticBatch: true,
                castsShadow: true, receivesShadow: true,
            });
            overlays.branches.node = branchesNode;
        } else {
            branchesNode.visible = true;
            branchesNode.setInstances(transforms);
        }
        return;
    }

    const mesh = world.emitMesh(6);
    if (!mesh || mesh.triangleCount === 0) {
        if (branchesNode) branchesNode.visible = false;
        return;
    }
    if (!branchesNode) {
        branchesNode = scene.createMesh({
            data: mesh,
            color: overlays.branches.color,
            metallic: 0.0, roughness: 0.85,
            castsShadow: true, receivesShadow: true,
        });
        overlays.branches.node = branchesNode;
    } else {
        branchesNode.visible = true;
        branchesNode.updateMesh(mesh, { transfer: true });
    }
}

function rebuildFoliage() {
    if (!overlays.foliage.on || world.moduleCount === 0) {
        if (foliageNode) foliageNode.visible = false;
        return;
    }

    const leaf = getLeafCard();
    if (world.emitFoliageTransforms && scene.createInstancedMesh) {
        const transforms = world.emitFoliageTransforms({
            maxRadius:     0.22,
            minDepth:      1,
            perUnitLength: 120,
            upBias:        0.5,
            tiltJitter:    0.55,
            rollJitter:    0.9,
            baseScale:     1.0,
            scaleJitter:   0.3,
            scaleByRadius: 0.25,
            seed:          0x1eaf,
        });
        if (!transforms || transforms.length === 0) {
            if (foliageNode) foliageNode.visible = false;
            return;
        }
        if (!foliageNode) {
            foliageNode = scene.createInstancedMesh({
                mesh: leaf,
                instances: transforms,
                color: SPECIES.sun.color,
                metallic: 0.0, roughness: 0.92,
                doubleSided: true, subsurface: 0.5,
                // Leaf cards carry the base→tip windBend in vertex-colour R.
                // Keep it as the wind channel only (sway) without letting the
                // gradient wash the green albedo to red.
                vertexColorTint: false,
                castsShadow: false, receivesShadow: true,
            });
            overlays.foliage.node = foliageNode;
        } else {
            foliageNode.visible = true;
            foliageNode.setInstances(transforms);
        }
        return;
    }

    if (world.emitFoliageMesh) {
        // Fast native C++ foliage emitter — zero JS object allocations
        const foliage = world.emitFoliageMesh(leaf, {
            maxRadius:     0.22,
            minDepth:      1,
            perUnitLength: 120,
            upBias:        0.5,
            tiltJitter:    0.55,
            rollJitter:    0.9,
            baseScale:     1.0,
            scaleJitter:   0.3,
            scaleByRadius: 0.25,
            seed:          0x1eaf,
        });
        if (!foliage || foliage.triangleCount === 0) {
            if (foliageNode) foliageNode.visible = false;
            return;
        }
        if (!foliageNode) {
            foliageNode = scene.createMesh({
                data: foliage,
                color: SPECIES.sun.color,
                metallic: 0.0, roughness: 0.92,
                twoSided: true, subsurface: 0.5,
                vertexColorTint: false, wind: 1,
                castsShadow: false, receivesShadow: true,
            });
            overlays.foliage.node = foliageNode;
        } else {
            foliageNode.visible = true;
            foliageNode.castsShadow = false;
            foliageNode.updateMesh(foliage, { transfer: true });
        }
        return;
    }

    // Fallback JS path
    destroyOverlay('foliage');
    const groups = { sun: { segs: [], w: [] }, shade: { segs: [], w: [] } };
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (!info) continue;
        const segs = world.emitPlantSegments(i);
        if (!segs || segs.length === 0) continue;
        const fol = world.emitPlantFoliage(i);
        const g = (info.species.shadeTolerance >= 0.6) ? groups.shade : groups.sun;
        for (let k = 0; k < segs.length; k++) {
            g.segs.push(segs[k]);
            const f = fol && fol[k];
            const raw      = f && f.lightExposure01 !== undefined ? f.lightExposure01 : 1.0;
            const exposure = 0.12 + 0.88 * raw;
            const maturity = f ? Math.min(1, f.age01) : 1.0;
            const alive    = f ? (1.0 - f.senescence01) : 1.0;
            const twig     = f && f.twigGrade01 !== undefined ? f.twigGrade01 : 1.0;
            g.w.push(exposure * maturity * alive * twig);
        }
    }

    const nodes = [];
    let seed = 0x1eaf;
    for (const key of ['sun', 'shade']) {
        const segs = groups[key].segs;
        if (segs.length === 0) continue;
        const foliage = Mesh.scatterLeaves(segs, leaf, {
            maxRadius:     0.22,
            minDepth:      1,
            perUnitLength: 220,
            densityWeight: groups[key].w,
            upBias:        0.5,
            tiltJitter:    0.55,
            rollJitter:    0.9,
            baseScale:     1.0,
            scaleJitter:   0.3,
            scaleByRadius: 0.25,
            seed:          seed,
        });
        seed = (seed * 2654435761) >>> 0;
        if (!foliage || foliage.triangleCount === 0) continue;
        nodes.push(scene.createMesh({
            data: foliage,
            color: SPECIES[key].color,
            metallic: 0.0, roughness: 0.92,
            twoSided: true, subsurface: 0.5,
            vertexColorTint: false, wind: 1,
            castsShadow: true, receivesShadow: true,
        }));
    }
    overlays.foliage.node = nodes.length ? nodes : null;
}

const BLOOM_CAP = 120;
function rebuildBlooms() {
    if (!overlays.blooms.on || world.moduleCount === 0) {
        if (bloomPetalsNode) bloomPetalsNode.visible = false;
        if (bloomCentersNode) bloomCentersNode.visible = false;
        return;
    }

    const { base, centerBase } = getBloomBases();

    if (world.emitBloomMesh) {
        // Fast native C++ bloom mesh emitter — zero JS object allocations
        const [mergedPetals, mergedCenters] = world.emitBloomMesh(base, centerBase, {
            bloomCap: BLOOM_CAP,
            bloomLightMin: 0.18,
        });

        if (mergedPetals && mergedPetals.triangleCount > 0) {
            if (!bloomPetalsNode) {
                bloomPetalsNode = scene.createMesh({
                    data: mergedPetals,
                    color: overlays.blooms.color,
                    metallic: 0.0, roughness: 0.55,
                    twoSided: true, subsurface: 0.4,
                    castsShadow: false, receivesShadow: true,
                });
            } else {
                bloomPetalsNode.visible = true;
                bloomPetalsNode.updateMesh(mergedPetals, { transfer: true });
            }
        } else if (bloomPetalsNode) {
            bloomPetalsNode.visible = false;
        }

        if (mergedCenters && mergedCenters.triangleCount > 0) {
            if (!bloomCentersNode) {
                bloomCentersNode = scene.createMesh({
                    data: mergedCenters,
                    color: [0.98, 0.80, 0.25],   // golden eye
                    metallic: 0.0, roughness: 0.6, emissive: 0.3 * bloomEmissiveGain,
                    castsShadow: false, receivesShadow: true,
                });
            } else {
                bloomCentersNode.visible = true;
                bloomCentersNode.emissive = 0.3 * bloomEmissiveGain;
                bloomCentersNode.updateMesh(mergedCenters, { transfer: true });
            }
        } else if (bloomCentersNode) {
            bloomCentersNode.visible = false;
        }
        overlays.blooms.node = [bloomPetalsNode, bloomCentersNode].filter(Boolean);
        return;
    }

    // Fallback JS path
    destroyOverlay('blooms');
    const anchors = world.emitBloomAnchors();
    if (!anchors || anchors.length === 0) return;

    const stride = anchors.length > BLOOM_CAP ? Math.ceil(anchors.length / BLOOM_CAP) : 1;
    const petalParts = [];
    const centerParts = [];
    const BLOOM_LIGHT_MIN = 0.18;
    for (let i = 0; i < anchors.length; i += stride) {
        const a = anchors[i];
        if (a.lightExposure01 !== undefined && a.lightExposure01 < BLOOM_LIGHT_MIN) continue;
        const s = 0.8 + 0.5 * Math.min(1, a.age01 || 0.5);

        const f = base.clone();
        orientYTo(f, a.normal);
        f.scale(s, s, s);
        f.translate(a.position[0], a.position[1], a.position[2]);
        petalParts.push(f);

        const c = centerBase.clone();
        orientYTo(c, a.normal);
        c.scale(s, s, s);
        const lift = 0.012 * s;
        c.translate(a.position[0] + a.normal[0] * lift,
                    a.position[1] + a.normal[1] * lift,
                    a.position[2] + a.normal[2] * lift);
        centerParts.push(c);
    }
    if (petalParts.length === 0) return;

    const nodes = [];
    const mergedPetals = Mesh.merge(petalParts);
    if (mergedPetals && mergedPetals.triangleCount > 0) {
        nodes.push(scene.createMesh({
            data: mergedPetals,
            color: overlays.blooms.color,
            metallic: 0.0, roughness: 0.55,
            twoSided: true, subsurface: 0.4,
            castsShadow: false, receivesShadow: true,
        }));
    }
    const mergedCenters = Mesh.merge(centerParts);
    if (mergedCenters && mergedCenters.triangleCount > 0) {
        nodes.push(scene.createMesh({
            data: mergedCenters,
            color: [0.98, 0.80, 0.25],
            metallic: 0.0, roughness: 0.6, emissive: 0.3 * bloomEmissiveGain,
            castsShadow: false, receivesShadow: true,
        }));
    }
    overlays.blooms.node = nodes.length ? nodes : null;
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
    if (!overlays.impostors.on || !world || world.plantCount === 0) return;
    if (!bro.impostor || !bro.impostor.createLayer) return;

    if (!atlasCache.sun || !atlasCache.shade) {
        initImpostorAtlases();
    }

    const groups = { sun: { plantIndices: [] }, shade: { plantIndices: [] } };
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (!info) continue;
        const gKey = (info.species.shadeTolerance >= 0.6) ? 'shade' : 'sun';
        groups[gKey].plantIndices.push(i);
    }

    const nodes = [];
    let totalQuads = 0;

    for (const key of ['sun', 'shade']) {
        const pIndices = groups[key].plantIndices;
        if (pIndices.length === 0) continue;
        const atlas = atlasCache[key];
        if (!atlas) continue;

        const transforms = new Float32Array(pIndices.length * 9);
        for (let idx = 0; idx < pIndices.length; idx++) {
            const pIdx = pIndices[idx];
            const info = world.plantInfo(pIdx);
            const o = idx * 9;
            const px = info ? info.origin[0] : 0;
            const py = info ? info.origin[1] : 0;
            const pz = info ? info.origin[2] : 0;
            transforms[o] = px; transforms[o + 1] = py; transforms[o + 2] = pz;
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

    const parts = [];
    const half = GRID_CELL * 0.48;
    const stride = 1;
    for (let iy = 0; iy < GRID_HEIGHT; iy += stride) {
        for (let iz = 0; iz < GRID_RES; iz += stride) {
            for (let ix = 0; ix < GRID_RES; ix += stride) {
                const cx = -WORLD_SIZE * 0.5 + (ix + 0.5) * GRID_CELL;
                const cy = (iy + 0.5) * GRID_CELL;
                const cz = -WORLD_SIZE * 0.5 + (iz + 0.5) * GRID_CELL;
                const q = world.sampleShadow([cx, cy, cz]);
                if (q == null || q > 0.85) continue;
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
    if (!overlays.seedRings.on) {
        if (seedRingsNode) seedRingsNode.visible = false;
        return;
    }
    const parts = [];
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (!info) continue;
        const r = info.species.seedingRadius;
        if (!(r > 0)) continue;
        parts.push(wire.translate(wire.circle(r, 48),
            info.origin[0], 0.02, info.origin[2]));
    }
    if (parts.length === 0) {
        if (seedRingsNode) seedRingsNode.visible = false;
        return;
    }
    const merged = wire.merge(parts);
    if (!merged) {
        if (seedRingsNode) seedRingsNode.visible = false;
        return;
    }
    if (!seedRingsNode) {
        seedRingsNode = scene.createMesh({
            positions: merged.positions, indices: merged.indices,
            drawMode: 'lines', lineWidth: 1,
            color: overlays.seedRings.color,
        });
        overlays.seedRings.node = seedRingsNode;
    } else {
        seedRingsNode.visible = true;
        seedRingsNode.updateMesh({ positions: merged.positions, indices: merged.indices });
    }
}

function rebuildPlantOrigins() {
    if (!overlays.plantOrigins.on) {
        if (plantOriginsNode) plantOriginsNode.visible = false;
        return;
    }
    const parts = [];
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (!info) continue;
        parts.push(wire.translate(wire.cross(0.18),
            info.origin[0], 0.02, info.origin[2]));
        parts.push(wire.line(
            [info.origin[0], 0, info.origin[2]],
            [info.origin[0], 0.6, info.origin[2]]));
    }
    const merged = wire.merge(parts);
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

function rebuildAll() {
    rebuildBranches();
    rebuildFoliage();
    rebuildBlooms();
    rebuildImpostors();
    rebuildShadowGrid();
    rebuildSeedRings();
    rebuildPlantOrigins();
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

    els.simTime.textContent = world.simTime.toFixed(2);
    els.plantCt.textContent = world.plantCount;
    els.moduleCt.textContent = world.moduleCount;

    let flowering = 0;
    for (let i = 0; i < world.plantCount; i++) {
        const info = world.plantInfo(i);
        if (info && info.flowering) flowering++;
    }
    els.floweringCt.textContent = flowering;

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
        rebuildAll();
    });
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

// Time-of-day selector — one button per lighting preset. Switching re-tints
// the blooms (their emissive gain rides the preset) so the rebuild picks up
// the new glow.
const todRoot = document.getElementById('todButtons');
const todBtns = {};
function selectTod(key) {
    lighting.apply(key);
    for (const k in todBtns) todBtns[k].classList.toggle('on', k === key);
    rebuildBlooms();
}
for (const key of lighting.order) {
    const b = document.createElement('button');
    b.textContent = lighting.presets[key].label;
    b.addEventListener('click', () => selectTod(key));
    todRoot.appendChild(b);
    todBtns[key] = b;
}

// ─── Main loop ────────────────────────────────────────────────────────────

function tick() {
    if (playing) {
        const dtTotal = SIM_DT * timeScale;
        const steps = Math.min(4, Math.max(1, Math.round(timeScale)));
        const stepDt = dtTotal / steps;
        for (let i = 0; i < steps; i++) {
            world.step(stepDt);
        }
        frameCt++;
        if (frameCt % REBUILD_EVERY === 0) {
            rebuildAll();
        } else {
            updateStats(false);
        }
    } else {
        updateStats(true);
    }
    lighting.update(0.016);   // drift the fireflies even while the sim is paused
    requestAnimationFrame(tick);
}

installSystemMenu();
// A gentle breeze. Foliage meshes opt in via `wind:1`; the per-vertex
// windBend (leaf base→tip) shapes the sway so tips flutter and stems stay
// put. Branches carry no color buffer, so the woody structure holds firm.
scene.setWind({ direction: [1, 0, 0.35], strength: 0.06, frequency: 1.1 });
selectTod(START_PRESET);   // light the scene before the first frame
rebuildAll();
requestAnimationFrame(tick);

// ─── Debug surface for headless ───────────────────────────────────────────
globalThis.__lab = { world, plants, overlays, getLeafCard, rebuildAll, rebuildBranches, rebuildFoliage, rebuildBlooms, rebuildImpostors, rebuildShadowGrid, rebuildSeedRings, rebuildPlantOrigins, lighting, selectTod };
