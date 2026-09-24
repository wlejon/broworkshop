// Overlays built from the worker's plant / shadow snapshots, not a live world:
//
//   impostors      octahedral billboard atlases (impostor.js), one quad per
//                  plant through bro.impostor.createLayer; the fast path that
//                  replaces branches + foliage + blooms
//   shadowGrid     a wire box per shadow-grid cell whose occupancy Q < 0.85
//   seedRings      each plant's seeding radius (every species here seeds at 0,
//                  so it draws nothing; kept for when seeding is on)
//   plantOrigins   a cross + stem marker per plant
//
// Rebuilt when a packet lands or a toggle flips.

import { bakeImpostorAtlas } from "/app/impostor.js";
import { wire } from "/app/wire.js";
import { WORLD_SIZE, GRID_RES, GRID_CELL, GRID_HEIGHT, SPECIES, leafCard, prototypes, createWorld } from "/app/shared.js";

export const OVERLAYS = {
    impostors:    { label: 'impostors (fast)', color: [0.30, 0.85, 0.55], on: false },
    shadowGrid:   { label: 'shadow grid',      color: [0.45, 0.60, 1.00, 0.30], on: false },
    seedRings:    { label: 'seeding radius',   color: [1.00, 1.00, 1.00, 0.35], on: false },
    plantOrigins: { label: 'plant origins',    color: [1.00, 0.85, 0.30, 0.80], on: false },
};

// Grow one plant of `key` in a scratch world and bake its atlas.
function bakeAtlas(key) {
    const world = createWorld(0xBAADF00D);
    const p = prototypes();
    const proto = world.addPrototype(key === 'sun' ? p.mono : p.symp);
    world.addVoronoiSite(proto, 0.5, 0.3);
    const idx = world.addPlant({ origin: [0, 0, 0], species: SPECIES[key].species, prototypeIndex: proto });
    for (let s = 0; s < 100; s++) world.step(0.1);

    const branchMesh = world.emitPlantMesh(idx, 6);
    const segs = world.emitPlantSegments(idx);
    const fol = world.emitPlantFoliage(idx);
    // Leaf density per segment: light, maturity, life and twig grade.
    const densityWeight = segs.map((_, k) => {
        const f = fol[k];
        if (!f) return 1;
        return (0.12 + 0.88 * (f.lightExposure01 ?? 1)) * Math.min(1, f.age01) *
               (1 - f.senescence01) * (f.twigGrade01 ?? 1);
    });
    const leafMesh = segs.length ? Mesh.scatterLeaves(segs, leafCard(), {
        maxRadius: 0.035, minDepth: 2, perUnitLength: 220, densityWeight,
        upBias: 0.7, tiltJitter: 0.55, rollJitter: 0.9,
        baseScale: 1.0, scaleJitter: 0.3, scaleByRadius: 0.25, seed: 0x1eaf,
    }) : null;
    const cap = document.createElement('canvas');
    cap.width = cap.height = 128;
    return bakeImpostorAtlas(cap.getContext('scene'), { branchMesh, leafMesh },
        { cols: 8, rows: 8, cell: 128, leafColor: SPECIES[key].color });
}

export function createDiagnostics(scene) {
    const atlases = {};
    let impostorNodes = [], impostorQuads = 0;
    const wires = { shadowGrid: null, plantOrigins: null };

    function impostors(plants) {
        for (const n of impostorNodes) n.destroy();
        impostorNodes = [];
        impostorQuads = 0;
        const count = plants.length / 4;
        if (!OVERLAYS.impostors.on || count === 0 || !bro.impostor) return;
        for (const key of ['sun', 'shade']) {
            const origins = [];
            for (let i = 0; i < count; i++) {
                if (plants[i * 4 + 3] === SPECIES[key].flag) origins.push(i);
            }
            if (!origins.length) continue;
            if (!atlases[key]) atlases[key] = bakeAtlas(key);
            // Per instance: position, rotation quaternion, scale, variant.
            const xf = new Float32Array(origins.length * 9);
            origins.forEach((i, j) => xf.set([plants[i * 4], plants[i * 4 + 1], plants[i * 4 + 2], 0, 0, 0, 1, 1, 0], j * 9));
            const layer = bro.impostor.createLayer(scene, atlases[key], xf, { cullNear: 2000, cullFar: 4000 });
            if (layer && layer.node) { impostorNodes.push(layer.node); impostorQuads += layer.quadCount; }
        }
    }

    function showWire(key, parts, lineWidth) {
        const merged = OVERLAYS[key].on && parts.length ? wire.merge(parts) : null;
        if (!merged) { if (wires[key]) wires[key].visible = false; return; }
        if (!wires[key]) {
            wires[key] = scene.createMesh({ positions: merged.positions, indices: merged.indices,
                drawMode: 'lines', lineWidth, color: OVERLAYS[key].color });
        } else {
            wires[key].visible = true;
            wires[key].updateMesh({ positions: merged.positions, indices: merged.indices });
        }
    }

    function shadowGrid(shadow) {
        const parts = [];
        if (OVERLAYS.shadowGrid.on && shadow) {
            const half = GRID_CELL * 0.48;
            let n = 0;
            for (let iy = 0; iy < GRID_HEIGHT; iy++)
                for (let iz = 0; iz < GRID_RES; iz++)
                    for (let ix = 0; ix < GRID_RES; ix++) {
                        const q = shadow[n++];
                        if (q > 0.85) continue;
                        parts.push(wire.translate(wire.box(half, half, half),
                            -WORLD_SIZE * 0.5 + (ix + 0.5) * GRID_CELL, (iy + 0.5) * GRID_CELL,
                            -WORLD_SIZE * 0.5 + (iz + 0.5) * GRID_CELL));
                    }
        }
        showWire('shadowGrid', parts, 1);
    }

    function plantOrigins(plants) {
        const parts = [];
        for (let i = 0; OVERLAYS.plantOrigins.on && i < plants.length / 4; i++) {
            const x = plants[i * 4], z = plants[i * 4 + 2];
            parts.push(wire.translate(wire.cross(0.18), x, 0.02, z));
            parts.push(wire.line([x, 0, z], [x, 0.6, z]));
        }
        showWire('plantOrigins', parts, 2);
    }

    return {
        /** Rebuild every overlay from the latest plants + shadow snapshot. */
        rebuild(plants, shadow) {
            impostors(plants);
            shadowGrid(shadow);
            plantOrigins(plants);
        },
        get impostorQuads() { return impostorQuads; },
        get wires() { return wires; },
    };
}
