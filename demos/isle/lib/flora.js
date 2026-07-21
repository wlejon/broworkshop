// flora.js — grow plant prototypes and instance them across the island by biome.

// Grows N prototypes once on boot.
export function initFlora(scene, atlas) {
    const world = bro.flora.createWorld({
        rngSeed: 0xDEADBEEF,
        climate: { annualTempBase: 12, annualPrecip: 1000 }
    });

    // 1. Define species prototypes
    // Tree 1: Pine (Boreal)
    const protoPine = world.addPrototype(bro.flora.prototypes.whorl(5, 0.4));
    world.addVoronoiSite(protoPine, 0.15, 0.9);
    const pineIdx = world.addPlant({
        origin: [0, 0, 0],
        prototypeIndex: protoPine,
        species: { moduleMatureAge: 0.4, growthScale: 1.2 }
    });

    // Tree 2: Deciduous (Temperate/Rainforest)
    const protoDecid = world.addPrototype(bro.flora.prototypes.whorl(4, 0.65));
    world.addVoronoiSite(protoDecid, 0.3, 0.7);
    const decidIdx = world.addPlant({
        origin: [10, 0, 0],
        prototypeIndex: protoDecid,
        species: { moduleMatureAge: 0.5, growthScale: 1.0 }
    });

    // Shrub (Tundra/Desert/Undergrowth)
    const protoShrub = world.addPrototype(bro.flora.prototypes.fork());
    world.addVoronoiSite(protoShrub, 0.4, 0.5);
    const shrubIdx = world.addPlant({
        origin: [20, 0, 0],
        prototypeIndex: protoShrub,
        species: { moduleMatureAge: 0.8, growthScale: 0.5 }
    });

    // Grow them by stepping the simulation
    for (let i = 0; i < 120; i++) {
        world.step(0.1);
    }

    // Emit their meshes (low side count for performance at scale)
    const pineMesh = world.emitPlantMesh(pineIdx, 4);
    const decidMesh = world.emitPlantMesh(decidIdx, 5);
    const shrubMesh = world.emitPlantMesh(shrubIdx, 4);

    return {
        types: {
            pine: { mesh: pineMesh, color: [0.12, 0.22, 0.16] },
            decid: { mesh: decidMesh, color: [0.18, 0.32, 0.14] },
            shrub: { mesh: shrubMesh, color: [0.26, 0.28, 0.18] }
        }
    };
}

// Spawns instanced trees across the terrain based on biome/moisture/slope.
export function populateFlora(scene, floraData, atlas, clipmap) {
    const W = atlas.width, H = atlas.height;
    const mpc = atlas.metresPerCell;

    // We will collect transforms for each type.
    // 9 floats per instance: px, py, pz, qx, qy, qz, qw, scale, variantIndex
    const maxInstances = 8000;
    const pineXf = [];
    const decidXf = [];
    const shrubXf = [];

    // Seeded LCG PRNG
    let seed = 1337;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };

    // Sample step: don't check every cell, step to make it sparse
    const step = 4;
    for (let z = step; z < H - step; z += step) {
        for (let x = step; x < W - step; x += step) {
            const idx = z * W + x;
            const h = atlas.elevation[idx];
            if (h <= 2.0) continue; // Skip sea and beach line

            const sl = atlas.slope[idx];
            if (sl > 0.38) continue; // Too steep for trees

            const biome = atlas.biomes[idx];
            const moisture = atlas.surfaceData[idx * 3 + 1]; // 0..1 moisture

            // Decide tree density and type based on biome
            let pineProb = 0.0;
            let decidProb = 0.0;
            let shrubProb = 0.0;

            // Biome mappings:
            // 2 (ice/tundra): only shrubs
            // 3 (alpine): pine/shrub
            // 4 (boreal): mostly pines
            // 6 (grassland), 9 (savanna): scattered deciduous / shrubs
            // 7 (temperate forest), 10 (seasonal tropical), 11 (rainforest): deciduous
            // 5, 8 (desert): none or rare desert shrub
            if (biome === 2) {
                shrubProb = 0.08;
            } else if (biome === 3) {
                pineProb = 0.04;
                shrubProb = 0.06;
            } else if (biome === 4) {
                pineProb = 0.18;
                shrubProb = 0.04;
            } else if (biome === 6 || biome === 9) {
                decidProb = 0.05 * moisture;
                shrubProb = 0.08;
            } else if (biome === 7 || biome === 10 || biome === 11) {
                decidProb = 0.22 * (biome === 11 ? 1.5 : 1.0);
                shrubProb = 0.05;
            } else if (biome === 5 || biome === 8) {
                shrubProb = 0.01; // very sparse desert shrub
            }

            // Draw random value
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
                // World position
                const worldX = atlas.originX + x * mpc + (rand() - 0.5) * mpc * step;
                const worldZ = atlas.originZ + z * mpc + (rand() - 0.5) * mpc * step;
                
                // Read exact height from clipmap
                const worldY = clipmap.elevationAt(worldX, worldZ);
                if (worldY <= 1.0) continue; // Don't submerge

                // Random yaw
                const yaw = rand() * Math.PI * 2;
                const qy = Math.sin(yaw / 2);
                const qw = Math.cos(yaw / 2);

                // Scale (slightly random)
                const scale = 0.7 + rand() * 0.6;

                // Pack transforms
                const xf = (selectedType === 'pine') ? pineXf : (selectedType === 'decid') ? decidXf : shrubXf;
                if (xf.length / 9 < maxInstances) {
                    xf.push(worldX, worldY, worldZ, 0, qy, 0, qw, scale, 0);
                }
            }
        }
    }

    // Create instanced meshes
    const nodes = [];
    const createInst = (type, xfData) => {
        if (xfData.length === 0) return;
        const info = floraData.types[type];
        const instMesh = scene.createInstancedMesh({
            mesh: info.mesh,
            instancesFromTransforms: new Float32Array(xfData),
            color: info.color,
            metallic: 0.0,
            roughness: 0.9,
            castsShadow: true,
            receivesShadow: true
        });
        nodes.push(instMesh);
    };

    createInst('pine', pineXf);
    createInst('decid', decidXf);
    createInst('shrub', shrubXf);

    return {
        nodes,
        destroy() {
            nodes.forEach(n => scene.destroyNode ? scene.destroyNode(n) : n.destroy && n.destroy());
        }
    };
}
