// flora.js — grow plant prototypes and instance them across the island by biome.

import { bakeImpostorAtlas } from '/app/lib/impostor.js';
import { createImpostorLayer } from '/app/lib/impostorLayer.js';

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
        width: 0.14, length: 0.24, bend: 0.45,
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
        maxRadius:     0.25,
        minDepth:      1,
        perUnitLength: 200,
        densityWeight: densityWeight,
        upBias:        0.5,
        tiltJitter:    0.5,
        rollJitter:    0.8,
        baseScale:     1.0,
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

            let pineProb = 0.0;
            let decidProb = 0.0;
            let shrubProb = 0.0;

            if (biome === 2) {
                shrubProb = 0.10;
            } else if (biome === 3) {
                pineProb = 0.05;
                shrubProb = 0.08;
            } else if (biome === 4) {
                pineProb = 0.20;
                shrubProb = 0.05;
            } else if (biome === 6 || biome === 9) {
                decidProb = 0.06 * moisture;
                shrubProb = 0.08;
            } else if (biome === 7 || biome === 10 || biome === 11) {
                decidProb = 0.25 * (biome === 11 ? 1.5 : 1.0);
                shrubProb = 0.05;
            } else if (biome === 5 || biome === 8) {
                shrubProb = 0.012; // sparse desert shrub
            }

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
    const leafNodes = { pine: null, decid: null, shrub: null };

    // Bake the decid octahedral impostor atlas ONCE from the grown master
    // (CHUNK 1). The decid species is then drawn as one billboard layer below
    // instead of its branch + ~365k-tri leaf instanced meshes (CHUNK 2).
    let decidImpostor = null;
    if (decidXf.length > 0) {
        const dInfo = floraData.types.decid;
        const capCvs = document.createElement('canvas');
        capCvs.width = 256; capCvs.height = 256;
        const capScene = capCvs.getContext('scene');
        decidImpostor = bakeImpostorAtlas(
            capScene,
            { branchMesh: dInfo.branchMesh, leafMesh: dInfo.leafMesh },
            { leafColor: dInfo.leafColor }
        );
    }

    const createInst = (type, xfData) => {
        if (xfData.length === 0) return;
        const info = floraData.types[type];

        // Deciduous: ONE octahedral impostor billboard layer (CHUNK 2). This
        // REPLACES the raw branch + leaf instanced meshes (the ~365k-tri leaf
        // mesh) with a single camera-facing quad per tree sampling the baked
        // atlas — N quads instead of a huge leaf-card batch.
        // NOTE: pine + shrub still use full geometry; they route through
        // impostors in a later chunk (full-island FPS recovery is CHUNK 5).
        if (type === 'decid') {
            if (!decidImpostor) return;
            const layer = createImpostorLayer(scene, decidImpostor, xfData);
            nodes.push(layer.node);
            console.log(`[flora] decid impostor layer: ${layer.quadCount} billboard quads ` +
                        `(replaces branch+leaf mesh, was ~${info.leafMesh ? info.leafMesh.triangleCount : 0} leaf tris/tree)`);
            return;
        }

        // 1. Create wood branches batch (PBR brown wood material)
        const branchInst = scene.createInstancedMesh({
            mesh: info.branchMesh,
            instancesFromTransforms: new Float32Array(xfData),
            color: [0.26, 0.18, 0.12],
            metallic: 0.0,
            roughness: 0.9,
            castsShadow: true,
            receivesShadow: true
        });
        nodes.push(branchInst);

        // 2. Create foliage batch
        if (info.leafMesh && info.leafMesh.triangleCount > 0) {
            const leafInst = scene.createInstancedMesh({
                mesh: info.leafMesh,
                instancesFromTransforms: new Float32Array(xfData),
                color: info.leafColor,
                metallic: 0.0,
                roughness: 0.85,
                doubleSided: true,
                alphaCutoff: 0.5,
                castsShadow: true,
                receivesShadow: true
            });
            nodes.push(leafInst);
            leafNodes[type] = leafInst;
        }
    };

    createInst('pine', pineXf);
    createInst('decid', decidXf);
    createInst('shrub', shrubXf);

    console.log(`[flora] Spawned ${pineXf.length/9} pines, ${decidXf.length/9} decid, ${shrubXf.length/9} shrubs`);

    return {
        nodes,
        leafNodes,
        destroy() {
            nodes.forEach(n => scene.destroyNode ? scene.destroyNode(n) : n.destroy && n.destroy());
        }
    };
}
