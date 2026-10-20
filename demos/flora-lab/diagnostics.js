// Overlays built from the worker's plant / shadow snapshots, not a live world:
//
//   shadowGrid     a wire box per shadow-grid cell whose occupancy Q < 0.85
//   seedRings      each plant's seeding radius (every species here seeds at 0,
//                  so it draws nothing; kept for when seeding is on)
//   plantOrigins   a cross + stem marker per plant
//
// Rebuilt when a packet lands or a toggle flips.

import { wire } from "/app/wire.js";
import { WORLD_SIZE, GRID_RES, GRID_CELL, GRID_HEIGHT } from "/app/shared.js";

export const OVERLAYS = {
    shadowGrid:   { label: 'shadow grid',      color: [0.45, 0.60, 1.00, 0.30], on: false },
    seedRings:    { label: 'seeding radius',   color: [1.00, 1.00, 1.00, 0.35], on: false },
    plantOrigins: { label: 'plant origins',    color: [1.00, 0.85, 0.30, 0.80], on: false },
};

export function createDiagnostics(scene) {
    const wires = { shadowGrid: null, plantOrigins: null };

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
            shadowGrid(shadow);
            plantOrigins(plants);
        },
        get wires() { return wires; },
    };
}
