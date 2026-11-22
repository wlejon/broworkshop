// Room furniture, rugs, ceiling light fixtures, and interior wall art placement.
// Keeps clear circulation corridors around doorways, stairwells, and elevators.

const WALL_THICK = 0.24;

export const FURN_DIMS = {
    table:         { hx: 0.76, hz: 0.48, h: 0.85 },
    chair:         { hx: 0.28, hz: 0.28, h: 0.92 },
    desk:          { hx: 0.79, hz: 0.40, h: 1.20 },
    sofa:          { hx: 1.00, hz: 0.46, h: 0.88 },
    bed:           { hx: 0.80, hz: 1.06, h: 1.02 },
    counter:       { hx: 0.96, hz: 0.39, h: 1.18 },
    shelf:         { hx: 0.62, hz: 0.22, h: 1.92 },
    lamp:          { hx: 0.25, hz: 0.25, h: 1.66 },
    plant:         { hx: 0.28, hz: 0.28, h: 1.08 },
    rug:           { hx: 1.06, hz: 0.74, h: 0.03 },
    ceiling_light: { hx: 0.26, hz: 0.26, h: 0.15 },
    wall_art:      { hx: 0.48, hz: 0.06, h: 0.68 },
};

const PALETTES = {
    wood:    [0.44, 0.29, 0.18, 1],
    oak:     [0.64, 0.47, 0.30, 1],
    fabric:  [0.28, 0.36, 0.46, 1],
    velvet:  [0.46, 0.22, 0.24, 1],
    sage:    [0.28, 0.40, 0.34, 1],
    cream:   [0.86, 0.82, 0.74, 1],
    foliage: [0.18, 0.42, 0.18, 1],
    dark:    [0.22, 0.24, 0.28, 1],
    rugWarm: [0.56, 0.38, 0.28, 1],
    rugCool: [0.32, 0.38, 0.44, 1],
    art:     [0.68, 0.56, 0.42, 1],
};

export function populateRoomFurniture(room, role, cellSize, halfW, halfD, clearPts, rng) {
    const x0 = -halfW + room.c0 * cellSize;
    const x1 = -halfW + (room.c1 + 1) * cellSize;
    const z0 = -halfD + room.r0 * cellSize;
    const z1 = -halfD + (room.r1 + 1) * cellSize;
    const rd = z1 - z0;
    const cx = 0.5 * (x0 + x1);
    const cz = 0.5 * (z0 + z1);
    const items = [];
    const margin = WALL_THICK * 0.5 + 0.18;

    const tryPlace = (type, lx, lz, ry, tint, skipOverlap = false) => {
        const d = FURN_DIMS[type];
        const rot90 = Math.abs(Math.sin(ry)) > 0.7;
        const hx = rot90 ? d.hz : d.hx;
        const hz = rot90 ? d.hx : d.hz;
        if (lx - hx < x0 + margin || lx + hx > x1 - margin) return false;
        if (lz - hz < z0 + margin || lz + hz > z1 - margin) return false;
        const minGap = (role === 'foyer' || role === 'lobby') ? 1.45 : 1.05;
        if (!skipOverlap) {
            for (let i = 0; i < clearPts.length; i++) {
                const cp = clearPts[i];
                const dx = Math.max(0, Math.abs(lx - cp.x) - hx);
                const dz = Math.max(0, Math.abs(lz - cp.z) - hz);
                if (Math.hypot(dx, dz) < minGap) return false;
            }
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (it.type === 'rug') continue;
                if (Math.abs(lx - it.x) < hx + it.hx + 0.32 && Math.abs(lz - it.z) < hz + it.hz + 0.32) {
                    return false;
                }
            }
        }
        items.push({ type, x: lx, z: lz, ry, hx, hz, h: d.h, tint });
        return true;
    };

    const tryCorners = (type, corners, ry, tint) => {
        for (let i = 0; i < corners.length; i++) {
            if (tryPlace(type, corners[i][0], corners[i][1], ry, tint)) return true;
        }
        return false;
    };

    const fabricPick = rng() < 0.35 ? PALETTES.velvet : (rng() < 0.65 ? PALETTES.fabric : PALETTES.sage);
    const rugPick = rng() < 0.5 ? PALETTES.rugWarm : PALETTES.rugCool;

    if (role === 'foyer' || role === 'lobby') {
        tryPlace('counter', cx, cz - rd * 0.15, 0, PALETTES.oak);
        tryPlace('sofa', x0 + 0.85, cz, Math.PI * 0.5, fabricPick);
        tryPlace('rug', cx, cz + 0.25, 0, rugPick, true);
        tryCorners('plant', [[x1 - 0.62, z0 + 0.62], [x0 + 0.62, z0 + 0.62], [x1 - 0.62, z1 - 0.62], [x0 + 0.62, z1 - 0.62]], 0, PALETTES.foliage);
        tryCorners('lamp', [[x0 + 0.58, z0 + 0.58], [x1 - 0.58, z0 + 0.58], [x0 + 0.58, z1 - 0.58]], 0, PALETTES.cream);
    } else if (role === 'living' || role === 'lounge') {
        tryPlace('rug', cx, cz + 0.15, 0, rugPick, true);
        tryPlace('sofa', cx, z0 + 0.85, 0, fabricPick);
        tryPlace('table', cx, cz + 0.45, 0, PALETTES.wood);
        tryCorners('lamp', [[x1 - 0.58, z0 + 0.58], [x0 + 0.58, z0 + 0.58], [x1 - 0.58, z1 - 0.58]], 0, PALETTES.cream);
        tryCorners('plant', [[x0 + 0.62, z1 - 0.62], [x1 - 0.62, z1 - 0.62], [x0 + 0.62, z0 + 0.62], [x1 - 0.62, z0 + 0.62]], 0, PALETTES.foliage);
    } else if (role === 'bedroom') {
        const bedCands = [
            [cx, z0 + 1.36, 0],
            [cx, z1 - 1.36, Math.PI],
            [x1 - 1.36, cz, Math.PI * 0.5],
            [x0 + 1.36, cz, -Math.PI * 0.5],
        ];
        for (let i = 0; i < bedCands.length; i++) {
            if (tryPlace('bed', bedCands[i][0], bedCands[i][1], bedCands[i][2], PALETTES.cream)) break;
        }
        tryPlace('rug', cx, cz + 0.15, 0, rugPick, true);
        tryCorners('shelf', [[x0 + 0.58, cz], [x1 - 0.58, cz]], Math.PI * 0.5, PALETTES.wood);
        tryCorners('lamp', [[x1 - 0.58, z0 + 0.58], [x0 + 0.58, z0 + 0.58], [x1 - 0.58, z1 - 0.58], [x0 + 0.58, z1 - 0.58]], 0, PALETTES.cream);
        tryCorners('plant', [[x0 + 0.62, z1 - 0.62], [x1 - 0.62, z1 - 0.62], [x0 + 0.62, z0 + 0.62]], 0, PALETTES.foliage);
    } else if (role === 'kitchen' || role === 'retail') {
        tryPlace('counter', cx, z0 + 0.68, 0, PALETTES.cream);
        tryPlace('table', cx, cz + 0.5, 0, PALETTES.oak);
        tryPlace('chair', cx, cz + 1.15, Math.PI, PALETTES.dark);
        tryPlace('shelf', x1 - 0.58, cz, -Math.PI * 0.5, PALETTES.wood);
    } else if (role === 'dining' || role === 'conference') {
        tryPlace('rug', cx, cz, 0, rugPick, true);
        tryPlace('table', cx, cz, 0, PALETTES.wood);
        tryPlace('chair', cx, cz - 0.85, 0, PALETTES.dark);
        tryPlace('chair', cx, cz + 0.85, Math.PI, PALETTES.dark);
        tryCorners('plant', [[x0 + 0.62, z0 + 0.62], [x1 - 0.62, z0 + 0.62], [x0 + 0.62, z1 - 0.62], [x1 - 0.62, z1 - 0.62]], 0, PALETTES.foliage);
    } else if (role === 'office' || role === 'exec_suite' || role === 'study') {
        tryPlace('desk', cx, cz - 0.25, 0, PALETTES.oak);
        tryPlace('chair', cx, cz + 0.55, Math.PI, PALETTES.dark);
        tryCorners('shelf', [[x0 + 0.58, cz], [x1 - 0.58, cz]], Math.PI * 0.5, PALETTES.wood);
        tryCorners('plant', [[x1 - 0.62, z0 + 0.62], [x0 + 0.62, z0 + 0.62], [x1 - 0.62, z1 - 0.62], [x0 + 0.62, z1 - 0.62]], 0, PALETTES.foliage);
        if (role === 'exec_suite' || rng() < 0.4) {
            tryPlace('sofa', cx, z1 - 0.78, Math.PI, fabricPick);
        }
    } else if (role === 'storage') {
        tryPlace('shelf', x0 + 0.58, cz - 0.4, Math.PI * 0.5, PALETTES.dark);
        tryPlace('shelf', x1 - 0.58, cz + 0.4, -Math.PI * 0.5, PALETTES.dark);
        tryPlace('table', cx, cz, 0, PALETTES.wood);
    } else {
        tryCorners('plant', [[x0 + 0.62, z0 + 0.62], [x1 - 0.62, z0 + 0.62], [x0 + 0.62, z1 - 0.62], [x1 - 0.62, z1 - 0.62]], 0, PALETTES.foliage);
        tryCorners('lamp', [[x1 - 0.58, z0 + 0.58], [x0 + 0.58, z0 + 0.58], [x1 - 0.58, z1 - 0.58]], 0, PALETTES.cream);
    }

    return items;
}
