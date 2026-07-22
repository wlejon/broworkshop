// flora.js — grow plant prototypes and instance them across the island by biome.

import { bakeImpostorAtlas } from '/app/lib/impostor.js';
import { createImpostorLayer } from '/app/lib/impostorLayer.js';

// Per-cell tree-species probabilities from the control atlas. Factored out of
// the placement loop so the L1 canopy-height field (buildIslandCanopyField)
// tests the EXACT same biome rule populateFlora uses to place trees.
function treeProbs(biome, moisture) {
    let pine = 0.0, decid = 0.0, shrub = 0.0;
    if (biome === 2) {
        shrub = 0.10;
    } else if (biome === 3) {
        pine = 0.05; shrub = 0.08;
    } else if (biome === 4) {
        pine = 0.20; shrub = 0.05;
    } else if (biome === 6 || biome === 9) {
        decid = 0.06 * moisture; shrub = 0.08;
    } else if (biome === 7 || biome === 10 || biome === 11) {
        decid = 0.25 * (biome === 11 ? 1.5 : 1.0); shrub = 0.05;
    } else if (biome === 5 || biome === 8) {
        shrub = 0.012; // sparse desert shrub
    }
    return { pine, decid, shrub };
}

// Grows a single prototype in a dedicated flora world with full light.
export function growPrototype(name, whorlArms, whorlSpread, speciesProps) {
    const world = bro.flora.createWorld({
        rngSeed: 0xBAADF00D,
        climate: { annualTempBase: 14, annualPrecip: 1000 },
        shadow: {
            origin:   [-10, 0, -10],
            cellSize: 1.0,
            width: 20, height: 20, depth: 20, fill: 1.0 // Full sun required for growth
        }
    });

    const proto = world.addPrototype(bro.flora.prototypes.whorl(whorlArms, whorlSpread));
    world.addVoronoiSite(proto, 0.3, 0.6);

    const plantIdx = world.addPlant({
        origin: [0, 0, 0],
        prototypeIndex: proto,
        species: speciesProps
    });

    // Step to grow from seedling to mature tree
    for (let i = 0; i < 140; i++) {
        world.step(0.1);
    }

    // 1. Emit branches
    const branchMesh = world.emitPlantMesh(plantIdx, 4);

    // 2. Emit foliage leaf cards
    const leaf = Mesh.leafCard('oval', {
        width: 0.22, length: 0.36, bend: 0.45,
        fullUV: true, shapedSilhouette: true, cup: 0.3,
        widthSegments: 3, lengthSegments: 6
    });

    const segs = world.emitPlantSegments(plantIdx);
    const fol = world.emitPlantFoliage(plantIdx);
    const densityWeight = [];

    if (segs && segs.length > 0) {
        for (let k = 0; k < segs.length; k++) {
            const f = fol && fol[k];
            const raw = f && f.lightExposure01 !== undefined ? f.lightExposure01 : 1.0;
            const exposure = 0.15 + 0.85 * raw;
            const maturity = f ? Math.min(1, f.age01) : 1.0;
            const alive = f ? (1.0 - f.senescence01) : 1.0;
            const twig = f && f.twigGrade01 !== undefined ? f.twigGrade01 : 1.0;
            densityWeight.push(exposure * maturity * alive * twig);
        }
    }

    const leafMesh = Mesh.scatterLeaves(segs, leaf, {
        maxRadius:     0.5,
        minDepth:      1,
        perUnitLength: 550,
        densityWeight: densityWeight,
        upBias:        0.5,
        tiltJitter:    0.5,
        rollJitter:    0.8,
        baseScale:     1.5,
        scaleJitter:   0.3,
        scaleByRadius: 0.25,
        seed:          0x1eaf
    });

    return { branchMesh, leafMesh };
}

// Grows all 3 prototypes on boot.
export function initFlora(scene, atlas) {
    // Pine (Boreal/Alpine): 5 arms whorl, narrow spread, orthotropic
    const pine = growPrototype('pine', 5, 0.45, {
        shadeTolerance: 0.35, moduleMatureAge: 0.5,
        tropismG2: 0.12, growthScale: 1.2,
        orthotropy: 0.38, rootVigorMax: 3.5,
        apicalControl: 0.4, apicalControlMature: 0.35,
        individualVariation: 0.1, maxAge: 80
    });

    // Deciduous (Temperate/Rainforest): 4 arms whorl, wide spreading crown
    const decid = growPrototype('decid', 4, 0.7, {
        shadeTolerance: 0.35, moduleMatureAge: 0.6,
        tropismG2: 0.12, growthScale: 1.0,
        orthotropy: 0.4, rootVigorMax: 3.0,
        apicalControl: 0.35, apicalControlMature: 0.3,
        individualVariation: 0.15, maxAge: 60
    });

    // Shrub (Tundra/Desert/Undergrowth): 3 arms whorl, compact dome
    const shrub = growPrototype('shrub', 3, 0.55, {
        shadeTolerance: 0.8, moduleMatureAge: 0.7,
        tropismG2: 0.12, growthScale: 0.6,
        orthotropy: 0.48, rootVigorMax: 2.2,
        apicalControl: 0.30, apicalControlMature: 0.3,
        individualVariation: 0.12, maxAge: 50
    });

    return {
        types: {
            pine: {
                branchMesh: pine.branchMesh,
                leafMesh: pine.leafMesh,
                leafColor: [0.10, 0.20, 0.12]
            },
            decid: {
                branchMesh: decid.branchMesh,
                leafMesh: decid.leafMesh,
                leafColor: [0.18, 0.35, 0.14]
            },
            shrub: {
                branchMesh: shrub.branchMesh,
                leafMesh: shrub.leafMesh,
                leafColor: [0.25, 0.32, 0.16]
            }
        }
    };
}

// Spawns instanced trees across the terrain based on biome/moisture/slope.
export function populateFlora(scene, floraData, atlas, clipmap) {
    const W = atlas.width, H = atlas.height;
    const mpc = atlas.metresPerCell;

    // Instanced transforms: px, py, pz, qx, qy, qz, qw, scale, variantIndex
    const maxInstances = 12000;
    const pineXf = [];
    const decidXf = [];
    const shrubXf = [];

    let seed = 1337;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };

    // Sample terrain cells
    const step = 4;
    for (let z = step; z < H - step; z += step) {
        for (let x = step; x < W - step; x += step) {
            const idx = z * W + x;
            const h = atlas.elevation[idx];
            if (h <= 2.0) continue; // Above ocean and beach

            const sl = atlas.slope[idx];
            if (sl > 0.35) continue; // No trees on steep cliffs

            const biome = atlas.biomes[idx];
            const moisture = atlas.surfaceData[idx * 3 + 1]; // 0..1

            const { pine: pineProb, decid: decidProb, shrub: shrubProb } =
                treeProbs(biome, moisture);

            const r = rand();
            let selectedType = null;
            if (r < pineProb) {
                selectedType = 'pine';
            } else if (r < pineProb + decidProb) {
                selectedType = 'decid';
            } else if (r < pineProb + decidProb + shrubProb) {
                selectedType = 'shrub';
            }

            if (selectedType) {
                const worldX = atlas.originX + x * mpc + (rand() - 0.5) * mpc * step;
                const worldZ = atlas.originZ + z * mpc + (rand() - 0.5) * mpc * step;
                
                const worldY = clipmap.elevationAt(worldX, worldZ);
                if (worldY <= 1.0) continue;

                const yaw = rand() * Math.PI * 2;
                const qy = Math.sin(yaw / 2);
                const qw = Math.cos(yaw / 2);
                const scale = 0.85 + rand() * 0.7; // Healthy height scaling

                const xf = (selectedType === 'pine') ? pineXf : (selectedType === 'decid') ? decidXf : shrubXf;
                if (xf.length / 9 < maxInstances) {
                    xf.push(worldX, worldY, worldZ, 0, qy, 0, qw, scale, 0);
                }
            }
        }
    }

    const nodes = [];
    // Kept for season.js, which guards on null: leaf recolour is a no-op now
    // that every species is an impostor (the atlas albedo is baked at boot).
    const leafNodes = { pine: null, decid: null, shrub: null };

    // ---- Part A: bake ONE octahedral impostor atlas per species, ONCE -------
    // Every species (pine, decid, shrub) is drawn as a single camera-facing
    // billboard batch sampling its baked atlas — N quads per species instead of
    // the raw branch + leaf instanced meshes (the ~280M-tri/frame residual that
    // pinned isle at 8 FPS). Each atlas is baked once here at boot and cached.
    const xfByType = { pine: pineXf, decid: decidXf, shrub: shrubXf };
    const impostors = { pine: null, decid: null, shrub: null };
    for (const type of ['pine', 'decid', 'shrub']) {
        const xfData = xfByType[type];
        if (xfData.length === 0) continue;
        const info = floraData.types[type];
        const capCvs = document.createElement('canvas');
        capCvs.width = 256; capCvs.height = 256;
        const capScene = capCvs.getContext('scene');
        impostors[type] = bakeImpostorAtlas(
            capScene,
            { branchMesh: info.branchMesh, leafMesh: info.leafMesh },
            { leafColor: info.leafColor, cols: 8, rows: 8, cell: 192 }
        );
    }

    // ---- draw each species as one camera-facing impostor billboard layer ----
    // No canopy shell, no per-pixel crossfade: the old full-screen screen-door
    // dither (shell fragment + impostor fragment, one discarded per pixel) was
    // ~2x full-viewport fragment overdraw of an expensive fbm shader — the real
    // frame cost, and the flat green "membrane" look. The aerial/far forest read
    // now comes from the terrain material's forest tint (near-free), not a shell.
    const layers = { pine: null, decid: null, shrub: null };
    let totalQuads = 0, oldLeafTris = 0, oldBranchTris = 0;
    for (const type of ['pine', 'decid', 'shrub']) {
        const xfData = xfByType[type];
        const imp = impostors[type];
        if (xfData.length === 0 || !imp) continue;
        const info = floraData.types[type];
        const count = xfData.length / 9;

        // This island carries ~1497 impostor quads total (~3000 tris) — trivial,
        // so draw every one solid rather than distance-culling. The 450 m dither
        // fade was for million-tree worlds and (without TAA) reads as translucent
        // green streaks across a hillside. Push the cull past the 19 km island so
        // nothing dithers in view; tile-streaming replaces this for huge worlds.
        const layer = createImpostorLayer(scene, imp, xfData, { cullNear: 24000, cullFar: 30000 });
        nodes.push(layer.node);
        layers[type] = layer;
        totalQuads += layer.quadCount;

        oldLeafTris += (info.leafMesh ? info.leafMesh.triangleCount : 0) * count;
        oldBranchTris += (info.branchMesh ? info.branchMesh.triangleCount : 0) * count;
    }

    const oldTris = oldLeafTris + oldBranchTris;
    console.log(`[flora] Spawned ${pineXf.length/9} pines, ${decidXf.length/9} decid, ` +
                `${shrubXf.length/9} shrubs — ${totalQuads} impostor quads ` +
                `(${totalQuads * 2} tris) REPLACE ~${oldTris} raw tris`);

    return {
        nodes,
        leafNodes,
        layers,
        impostors,
        transforms: { pine: pineXf, decid: decidXf, shrub: shrubXf },
        stats: { totalQuads, oldLeafTris, oldBranchTris, oldTris, treeCanopyH: 0,
                 forestTexels: 0 },

        // Crossfade is gone; kept as a harmless no-op so app.js/tests that call it
        // don't need to guard. (A horizontal distance-LOD fade is a later item.)
        updateCanopy() { return 0; },

        destroy() {
            nodes.forEach(n => scene.destroyNode ? scene.destroyNode(n) : n.destroy && n.destroy());
        }
    };
}
