// Deterministic parcel-seeded building blueprints with LRU cache, BSP rooms,
// spanning-tree doorways, stairwell/elevator slab cutouts, and cleared furniture.

const MAX_CACHE = 512;
const bpCache = new Map();
const massCache = new Map();

const WALL_THICK = 0.24;
const SLAB_THICK = 0.20;
const PLINTH_DEPTH = 0.27; // padY - 0.15 .. padY + 0.12
const STAIR_STEPS = 18;

const FURN_DIMS = {
    table:   { hx: 0.72, hz: 0.47, h: 0.76 },
    chair:   { hx: 0.26, hz: 0.26, h: 0.92 },
    desk:    { hx: 0.77, hz: 0.39, h: 1.18 },
    sofa:    { hx: 0.97, hz: 0.45, h: 0.86 },
    bed:     { hx: 0.77, hz: 1.04, h: 0.95 },
    counter: { hx: 0.94, hz: 0.37, h: 0.96 },
    shelf:   { hx: 0.62, hz: 0.22, h: 1.90 },
    lamp:    { hx: 0.24, hz: 0.24, h: 1.64 },
    plant:   { hx: 0.26, hz: 0.26, h: 1.05 },
};

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

function mulberry32(seed) {
    let a = (seed | 0) >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function getPalette(kind, rng) {
    const pick = rng();
    if (kind === 'skyscraper') {
        const palettes = [
            [0.44, 0.48, 0.54, 1],
            [0.36, 0.41, 0.48, 1],
            [0.52, 0.50, 0.48, 1],
            [0.32, 0.38, 0.42, 1],
        ];
        return palettes[Math.floor(pick * palettes.length)];
    }
    if (kind === 'business') {
        const palettes = [
            [0.58, 0.52, 0.46, 1],
            [0.48, 0.50, 0.54, 1],
            [0.62, 0.48, 0.40, 1],
            [0.44, 0.48, 0.44, 1],
        ];
        return palettes[Math.floor(pick * palettes.length)];
    }
    const palettes = [
        [0.76, 0.70, 0.62, 1],
        [0.68, 0.72, 0.76, 1],
        [0.74, 0.64, 0.56, 1],
        [0.72, 0.74, 0.66, 1],
    ];
    return palettes[Math.floor(pick * palettes.length)];
}

function splitRoomsBSP(c0, r0, c1, r1, blocked, maxArea, rng, out) {
    // Partition rectangle [c0..c1] x [r0..r1] while skipping blocked core cells.
    const stack = [[c0, r0, c1, r1]];
    while (stack.length > 0) {
        const [x0, z0, x1, z1] = stack.pop();
        let hasBlocked = false;
        let anyFree = false;
        for (let r = z0; r <= z1; r++) {
            for (let c = x0; c <= x1; c++) {
                if (blocked[r][c]) hasBlocked = true;
                else anyFree = true;
            }
        }
        if (!anyFree) continue;

        const w = x1 - x0 + 1;
        const d = z1 - z0 + 1;
        if (!hasBlocked && w * d <= maxArea) {
            out.push({ c0: x0, r0: z0, c1: x1, r1: z1 });
            continue;
        }
        if (w === 1 && d === 1) {
            out.push({ c0: x0, r0: z0, c1: x1, r1: z1 });
            continue;
        }

        // If it contains a blocked cell, split right along the blocked boundary first if possible
        let splitVert = w >= d;
        if (w === 1) splitVert = false;
        else if (d === 1) splitVert = true;
        else if (!hasBlocked) splitVert = w > d ? true : (d > w ? false : rng() < 0.5);

        if (splitVert) {
            let cut = x0 + Math.floor(w * (0.35 + 0.3 * rng()));
            cut = clamp(cut, x0, x1 - 1);
            if (hasBlocked) {
                for (let cx = x0; cx < x1; cx++) {
                    let leftB = false, rightB = false;
                    for (let r = z0; r <= z1; r++) {
                        if (blocked[r][cx]) leftB = true;
                        if (blocked[r][cx + 1]) rightB = true;
                    }
                    if (leftB !== rightB) { cut = cx; break; }
                }
            }
            stack.push([x0, z0, cut, z1], [cut + 1, z0, x1, z1]);
        } else {
            let cut = z0 + Math.floor(d * (0.35 + 0.3 * rng()));
            cut = clamp(cut, z0, z1 - 1);
            if (hasBlocked) {
                for (let rz = z0; rz < z1; rz++) {
                    let topB = false, botB = false;
                    for (let c = x0; c <= x1; c++) {
                        if (blocked[rz][c]) topB = true;
                        if (blocked[rz + 1][c]) botB = true;
                    }
                    if (topB !== botB) { cut = rz; break; }
                }
            }
            stack.push([x0, z0, x1, cut], [x0, cut + 1, x1, z1]);
        }
    }
}

function assignRoomRole(kind, floorIdx, roomIdx, isEntry, isStairExit, rng) {
    if (isEntry) return kind === 'home' ? 'foyer' : 'lobby';
    if (isStairExit) return 'hall';
    if (kind === 'home') {
        if (floorIdx === 0) {
            const roles = ['living', 'kitchen', 'dining', 'study'];
            return roles[roomIdx % roles.length];
        }
        const roles = ['bedroom', 'study', 'lounge'];
        return roles[(roomIdx + Math.floor(rng() * 3)) % roles.length];
    }
    if (kind === 'business') {
        if (floorIdx === 0) return roomIdx % 2 === 0 ? 'retail' : 'office';
        const roles = ['office', 'conference', 'storage'];
        return roles[roomIdx % roles.length];
    }
    if (floorIdx === 0) return roomIdx % 2 === 0 ? 'lounge' : 'retail';
    const roles = ['office', 'conference', 'exec_suite', 'lounge'];
    return roles[(roomIdx + floorIdx) % roles.length];
}

function populateRoomFurniture(room, role, cellSize, halfW, halfD, clearPts, rng) {
    const x0 = -halfW + room.c0 * cellSize;
    const x1 = -halfW + (room.c1 + 1) * cellSize;
    const z0 = -halfD + room.r0 * cellSize;
    const z1 = -halfD + (room.r1 + 1) * cellSize;
    const rw = x1 - x0;
    const rd = z1 - z0;
    const cx = 0.5 * (x0 + x1);
    const cz = 0.5 * (z0 + z1);
    const items = [];
    const margin = WALL_THICK * 0.5 + 0.18;

    const tryPlace = (type, lx, lz, ry, tint) => {
        const d = FURN_DIMS[type];
        const rot90 = Math.abs(Math.sin(ry)) > 0.7;
        const hx = rot90 ? d.hz : d.hx;
        const hz = rot90 ? d.hx : d.hz;
        if (lx - hx < x0 + margin || lx + hx > x1 - margin) return false;
        if (lz - hz < z0 + margin || lz + hz > z1 - margin) return false;
        const minGap = (role === 'foyer' || role === 'lobby') ? 1.45 : 1.05;
        for (let i = 0; i < clearPts.length; i++) {
            const cp = clearPts[i];
            const dx = Math.max(0, Math.abs(lx - cp.x) - hx);
            const dz = Math.max(0, Math.abs(lz - cp.z) - hz);
            if (Math.hypot(dx, dz) < minGap) return false;
        }
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (Math.abs(lx - it.x) < hx + it.hx + 0.35 && Math.abs(lz - it.z) < hz + it.hz + 0.35) {
                return false;
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

    const wood = [0.46, 0.32, 0.20, 1];
    const oak = [0.62, 0.46, 0.30, 1];
    const fabric = [0.34, 0.40, 0.48, 1];
    const cream = [0.84, 0.80, 0.72, 1];
    const foliage = [0.22, 0.46, 0.22, 1];
    const dark = [0.24, 0.26, 0.30, 1];

    if (role === 'foyer' || role === 'lobby') {
        tryPlace('counter', cx, cz - rd * 0.15, 0, oak);
        tryPlace('sofa', x0 + 0.85, cz, Math.PI * 0.5, fabric);
        tryCorners('plant', [[x1 - 0.62, z0 + 0.62], [x0 + 0.62, z0 + 0.62], [x1 - 0.62, z1 - 0.62], [x0 + 0.62, z1 - 0.62]], 0, foliage);
        tryCorners('lamp', [[x0 + 0.58, z0 + 0.58], [x1 - 0.58, z0 + 0.58], [x0 + 0.58, z1 - 0.58]], 0, cream);
    } else if (role === 'living' || role === 'lounge') {
        tryPlace('sofa', cx, z0 + 0.85, 0, fabric);
        tryPlace('table', cx, cz + 0.45, 0, wood);
        tryCorners('lamp', [[x1 - 0.58, z0 + 0.58], [x0 + 0.58, z0 + 0.58], [x1 - 0.58, z1 - 0.58]], 0, cream);
        tryCorners('plant', [[x0 + 0.62, z1 - 0.62], [x1 - 0.62, z1 - 0.62], [x0 + 0.62, z0 + 0.62], [x1 - 0.62, z0 + 0.62]], 0, foliage);
    } else if (role === 'bedroom') {
        const bedCands = [
            [cx, z0 + 1.36, 0],
            [cx, z1 - 1.36, Math.PI],
            [x1 - 1.36, cz, Math.PI * 0.5],
            [x0 + 1.36, cz, -Math.PI * 0.5],
        ];
        for (let i = 0; i < bedCands.length; i++) {
            if (tryPlace('bed', bedCands[i][0], bedCands[i][1], bedCands[i][2], cream)) break;
        }
        tryCorners('shelf', [[x0 + 0.58, cz], [x1 - 0.58, cz]], Math.PI * 0.5, wood);
        tryCorners('lamp', [[x1 - 0.58, z0 + 0.58], [x0 + 0.58, z0 + 0.58], [x1 - 0.58, z1 - 0.58], [x0 + 0.58, z1 - 0.58]], 0, cream);
        tryCorners('plant', [[x0 + 0.62, z1 - 0.62], [x1 - 0.62, z1 - 0.62], [x0 + 0.62, z0 + 0.62]], 0, foliage);
    } else if (role === 'kitchen' || role === 'retail') {
        tryPlace('counter', cx, z0 + 0.68, 0, cream);
        tryPlace('table', cx, cz + 0.5, 0, oak);
        tryPlace('chair', cx, cz + 1.15, Math.PI, dark);
        tryPlace('shelf', x1 - 0.58, cz, -Math.PI * 0.5, wood);
    } else if (role === 'dining' || role === 'conference') {
        tryPlace('table', cx, cz, 0, wood);
        tryPlace('chair', cx, cz - 0.85, 0, dark);
        tryPlace('chair', cx, cz + 0.85, Math.PI, dark);
        tryCorners('plant', [[x0 + 0.62, z0 + 0.62], [x1 - 0.62, z0 + 0.62], [x0 + 0.62, z1 - 0.62], [x1 - 0.62, z1 - 0.62]], 0, foliage);
    } else if (role === 'office' || role === 'exec_suite' || role === 'study') {
        tryPlace('desk', cx, cz - 0.25, 0, oak);
        tryPlace('chair', cx, cz + 0.55, Math.PI, dark);
        tryCorners('shelf', [[x0 + 0.58, cz], [x1 - 0.58, cz]], Math.PI * 0.5, wood);
        tryCorners('plant', [[x1 - 0.62, z0 + 0.62], [x0 + 0.62, z0 + 0.62], [x1 - 0.62, z1 - 0.62], [x0 + 0.62, z1 - 0.62]], 0, foliage);
        if (role === 'exec_suite' || rng() < 0.4) {
            tryPlace('sofa', cx, z1 - 0.78, Math.PI, fabric);
        }
    } else if (role === 'storage') {
        tryPlace('shelf', x0 + 0.58, cz - 0.4, Math.PI * 0.5, dark);
        tryPlace('shelf', x1 - 0.58, cz + 0.4, -Math.PI * 0.5, dark);
        tryPlace('table', cx, cz, 0, wood);
    } else {
        tryCorners('plant', [[x0 + 0.62, z0 + 0.62], [x1 - 0.62, z0 + 0.62], [x0 + 0.62, z1 - 0.62], [x1 - 0.62, z1 - 0.62]], 0, foliage);
        tryCorners('lamp', [[x1 - 0.58, z0 + 0.58], [x0 + 0.58, z0 + 0.58], [x1 - 0.58, z1 - 0.58]], 0, cream);
    }

    return items;
}

function buildFloorTemplate({
    kind, floorIdx, totalFloors, cols, rows, cellSize, floorHeight,
    minC, maxC, minR, maxR,
    stairC, stairR0, stairR1, elevC, elevR, entryC, entryR, hasElev, palette, seed,
}) {
    const rng = mulberry32(seed ^ (floorIdx * 7919 + 31));
    const halfW = cols * cellSize * 0.5;
    const halfD = rows * cellSize * 0.5;
    const hasStairUp = floorIdx < totalFloors - 1;
    const hasStairDown = floorIdx > 0;

    // Blocked cells are stairwell & elevator core (managed explicitly)
    const blocked = Array.from({ length: rows }, () => new Uint8Array(cols));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (c < minC || c > maxC || r < minR || r > maxR) blocked[r][c] = 1;
        }
    }
    if (totalFloors > 1) {
        blocked[stairR0][stairC] = 1;
        blocked[stairR1][stairC] = 1;
    }
    if (hasElev) {
        blocked[elevR][elevC] = 1;
    }

    const maxArea = kind === 'home' ? 2 : (kind === 'business' ? 3 : 4);
    const bspRooms = [];
    splitRoomsBSP(minC, minR, maxC, maxR, blocked, maxArea, rng, bspRooms);

    // Cell -> room ID map (-1 = out/shaft, -2 = stairwell)
    const cellRoom = Array.from({ length: rows }, () => new Int32Array(cols).fill(-1));
    const rooms = bspRooms.map((rb, idx) => {
        for (let r = rb.r0; r <= rb.r1; r++) {
            for (let c = rb.c0; c <= rb.c1; c++) {
                cellRoom[r][c] = idx;
            }
        }
        const isEntry = floorIdx === 0 && entryC >= rb.c0 && entryC <= rb.c1 && entryR >= rb.r0 && entryR <= rb.r1;
        const isStairExit = hasStairDown && stairC >= rb.c0 && stairC <= rb.c1 && (stairR1 + 1) >= rb.r0 && (stairR1 + 1) <= rb.r1;
        const role = assignRoomRole(kind, floorIdx, idx, isEntry, isStairExit, rng);
        return {
            id: idx,
            ...rb,
            role,
            x0: -halfW + rb.c0 * cellSize,
            x1: -halfW + (rb.c1 + 1) * cellSize,
            z0: -halfD + rb.r0 * cellSize,
            z1: -halfD + (rb.r1 + 1) * cellSize,
            neighbors: [],
        };
    });

    if (totalFloors > 1) {
        cellRoom[stairR0][stairC] = -2;
        cellRoom[stairR1][stairC] = -2;
    }
    if (hasElev) {
        cellRoom[elevR][elevC] = -3;
    }

    // Collect shared cell edges between distinct walkable rooms
    const edgeMap = new Map();
    for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
            const a = cellRoom[r][c];
            if (a < 0) continue;
            if (c + 1 <= maxC) {
                const b = cellRoom[r][c + 1];
                if (b >= 0 && b !== a) {
                    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                    if (!edgeMap.has(key)) edgeMap.set(key, []);
                    edgeMap.get(key).push({ a, b, axis: 'x', c, r });
                }
            }
            if (r + 1 <= maxR) {
                const b = cellRoom[r + 1][c];
                if (b >= 0 && b !== a) {
                    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                    if (!edgeMap.has(key)) edgeMap.set(key, []);
                    edgeMap.get(key).push({ a, b, axis: 'z', c, r });
                }
            }
        }
    }

    // Spanning tree + 25% loop portals connecting all walkable rooms
    const startRoom = Math.max(0, floorIdx === 0 ? cellRoom[entryR][entryC] : (hasStairDown ? cellRoom[stairR1 + 1][stairC] : 0));
    const doorCellEdges = new Set();
    const visited = new Set([startRoom]);
    const doors = [];

    const addEdgeDoor = (e, kindTag = 'interior') => {
        const edgeId = e.axis === 'x' ? `V_${e.c + 1}_${e.r}` : `H_${e.c}_${e.r + 1}`;
        if (doorCellEdges.has(edgeId)) return;
        doorCellEdges.add(edgeId);
        if (e.a >= 0 && e.b >= 0) {
            if (!rooms[e.a].neighbors.includes(e.b)) rooms[e.a].neighbors.push(e.b);
            if (!rooms[e.b].neighbors.includes(e.a)) rooms[e.b].neighbors.push(e.a);
        }
        const x = e.axis === 'x' ? (-halfW + (e.c + 1) * cellSize) : (-halfW + (e.c + 0.5) * cellSize);
        const z = e.axis === 'x' ? (-halfD + (e.r + 0.5) * cellSize) : (-halfD + (e.r + 1) * cellSize);
        doors.push({
            x, z,
            ry: e.axis === 'x' ? Math.PI * 0.5 : 0,
            nx: e.axis === 'x' ? 1 : 0,
            nz: e.axis === 'x' ? 0 : 1,
            width: cellSize * 0.72,
            height: floorHeight * 0.78,
            bayWidth: cellSize,
            kind: kindTag,
            roomA: e.a,
            roomB: e.b,
        });
    };

    const allPairs = Array.from(edgeMap.values());
    let progress = true;
    while (visited.size < rooms.length && progress) {
        progress = false;
        for (let i = 0; i < allPairs.length; i++) {
            const list = allPairs[i];
            const e = list[Math.floor(rng() * list.length)];
            const inA = visited.has(e.a);
            const inB = visited.has(e.b);
            if (inA !== inB) {
                visited.add(inA ? e.b : e.a);
                addEdgeDoor(e, 'interior');
                progress = true;
            }
        }
    }
    for (let i = 0; i < allPairs.length; i++) {
        if (rng() < 0.25) {
            const list = allPairs[i];
            addEdgeDoor(list[Math.floor(rng() * list.length)], 'interior');
        }
    }
    if (floorIdx === 0) {
        for (let i = 0; i < allPairs.length; i++) {
            const list = allPairs[i];
            if (list.some((e) => e.a === startRoom || e.b === startRoom)) {
                addEdgeDoor(list[Math.floor(list.length * 0.5)], 'interior');
            }
        }
    }

    // Explicit doors for front exterior entry, stairwell bottom, and elevator
    const clearPts = [];
    if (floorIdx === 0) {
        const dx = -halfW + (entryC + 0.5) * cellSize;
        const dz = halfD;
        doors.push({
            x: dx, z: dz, ry: 0, nx: 0, nz: -1,
            width: cellSize * 0.72, height: floorHeight * 0.78, bayWidth: cellSize,
            kind: 'exterior', roomA: cellRoom[entryR][entryC], roomB: -1,
        });
        clearPts.push({ x: dx, z: dz });
    }
    if (hasStairUp) {
        // Connect South stair entry (stairC, stairR1) to South neighbor (stairC, stairR1 + 1)
        const sRoom = cellRoom[stairR1 + 1][stairC];
        const edgeId = `H_${stairC}_${stairR1 + 1}`;
        doorCellEdges.add(edgeId);
        const dx = -halfW + (stairC + 0.5) * cellSize;
        const dz = -halfD + (stairR1 + 1) * cellSize;
        doors.push({
            x: dx, z: dz, ry: 0, nx: 0, nz: -1,
            width: cellSize * 0.72, height: floorHeight * 0.78, bayWidth: cellSize,
            kind: 'stair_entry', roomA: -2, roomB: sRoom,
        });
        clearPts.push({ x: dx, z: dz });
    }
    if (hasStairDown) {
        // Top-of-flight exit on North landing (stairC, stairR0) to East neighbor (stairC + 1, stairR0)
        const eRoom = cellRoom[stairR0][stairC + 1];
        const edgeId = `V_${stairC + 1}_${stairR0}`;
        doorCellEdges.add(edgeId);
        const dx = -halfW + (stairC + 1) * cellSize;
        const dz = -halfD + (stairR0 + 0.5) * cellSize;
        doors.push({
            x: dx, z: dz, ry: Math.PI * 0.5, nx: -1, nz: 0,
            width: cellSize * 0.72, height: floorHeight * 0.78, bayWidth: cellSize,
            kind: 'stair_exit', roomA: -2, roomB: eRoom,
        });
        clearPts.push({ x: dx, z: dz });
    }
    if (hasElev) {
        const eRoom = cellRoom[elevR + 1][elevC];
        const edgeId = `H_${elevC}_${elevR + 1}`;
        doorCellEdges.add(edgeId);
        const dx = -halfW + (elevC + 0.5) * cellSize;
        const dz = -halfD + (elevR + 1) * cellSize;
        doors.push({
            x: dx, z: dz, ry: 0, nx: 0, nz: 1,
            width: cellSize * 0.72, height: floorHeight * 0.78, bayWidth: cellSize,
            kind: 'elevator', roomA: -3, roomB: eRoom,
        });
        clearPts.push({ x: dx, z: dz });
    }
    for (let i = 0; i < doors.length; i++) {
        clearPts.push({ x: doors[i].x, z: doors[i].z });
    }

    // Stair flight geometry (ascends -Z from South entry toward North upper landing)
    const stairs = [];
    let stairCutZ0 = 0;
    let stairCutZ1 = 0;
    const stairX0 = -halfW + stairC * cellSize;
    const stairX1 = stairX0 + cellSize;
    const stairZNorth = -halfD + stairR0 * cellSize;
    const stairZSouth = -halfD + (stairR1 + 1) * cellSize;
    const approachTop = cellSize >= 4.0 ? 2.90 : 1.80;
    const approachBot = cellSize >= 4.0 ? 0.50 : 0.15;
    if (totalFloors > 1) {
        const zStart = stairZSouth - approachBot;
        const zEnd = stairZNorth + approachTop - (cellSize >= 4.0 ? 0.15 : 0.10);
        const runLen = zStart - zEnd;
        const cx = 0.5 * (stairX0 + stairX1);
        stairCutZ0 = stairZNorth + approachTop;
        stairCutZ1 = stairZSouth - (cellSize >= 4.0 ? 0.80 : 0.60);
        if (hasStairUp) {
            const width = Math.min(cellSize - 0.5, 2.0);
            stairs.push({
                x0: cx - width * 0.5,
                x1: cx + width * 0.5,
                z0: zStart,
                z1: zEnd,
                cx,
                width,
                runLen,
                rise: floorHeight,
                steps: STAIR_STEPS,
                dir: -1,
            });
            clearPts.push({ x: cx, z: zStart }, { x: cx, z: zEnd });
        }
        if (hasStairDown && !hasStairUp) {
            clearPts.push({ x: cx, z: stairZNorth + 0.5 * approachTop });
        }
    }

    // Slab tiles (merge unbroken row runs and extend 0.16m under perimeter/shaft/stairwell walls so footings never overhang cutouts)
    const slabTiles = [];
    const extPad = WALL_THICK * 0.5 + 0.04; // 0.16 m ledge so walls sit 100% on slab
    const seamPad = 0.015;
    for (let r = minR; r <= maxR; r++) {
        let runStartC = -1;
        const flushRun = (endC) => {
            if (runStartC < 0) return;
            const leftPad = runStartC === minC ? extPad : extPad; // covers adjacent shaft/stair wall too
            const rightPad = endC === maxC ? extPad : extPad;
            const topPad = r === minR ? extPad : (hasElev && r - 1 === elevR && runStartC <= elevC && endC >= elevC ? extPad : seamPad);
            const botPad = r === maxR ? extPad : (hasElev && r + 1 === elevR && runStartC <= elevC && endC >= elevC ? extPad : seamPad);
            const cx0 = -halfW + runStartC * cellSize - leftPad;
            const cx1 = -halfW + (endC + 1) * cellSize + rightPad;
            const cz0 = -halfD + r * cellSize - topPad;
            const cz1 = -halfD + (r + 1) * cellSize + botPad;
            slabTiles.push({
                x0: cx0, x1: cx1, z0: cz0, z1: cz1,
                thick: floorIdx === 0 ? PLINTH_DEPTH : SLAB_THICK,
            });
            runStartC = -1;
        };

        for (let c = minC; c <= maxC; c++) {
            const isElevCell = hasElev && c === elevC && r === elevR;
            const isStairCut = hasStairDown && c === stairC && (r === stairR0 || r === stairR1);
            if (isElevCell) {
                flushRun(c - 1);
                if (floorIdx === 0) {
                    const cx0 = -halfW + c * cellSize - (c === minC ? extPad : 0);
                    const cx1 = -halfW + (c + 1) * cellSize + (c === maxC ? extPad : 0);
                    const cz0 = -halfD + r * cellSize - (r === minR ? extPad : 0);
                    const cz1 = -halfD + (r + 1) * cellSize + (r === maxR ? extPad : 0);
                    slabTiles.push({ x0: cx0, x1: cx1, z0: cz0, z1: cz1, thick: PLINTH_DEPTH, isPit: true });
                } else {
                    const sx0 = -halfW + c * cellSize;
                    const sx1 = sx0 + cellSize;
                    const sz0 = -halfD + r * cellSize;
                    const sz1 = sz0 + cellSize;
                    if (c === minC) slabTiles.push({ x0: sx0 - extPad, x1: sx0 + extPad, z0: sz0 - seamPad, z1: sz1 + seamPad, thick: SLAB_THICK });
                    if (c === maxC) slabTiles.push({ x0: sx1 - extPad, x1: sx1 + extPad, z0: sz0 - seamPad, z1: sz1 + seamPad, thick: SLAB_THICK });
                    if (r === minR) slabTiles.push({ x0: sx0 - (c === minC ? extPad : seamPad), x1: sx1 + (c === maxC ? extPad : seamPad), z0: sz0 - extPad, z1: sz0 + extPad, thick: SLAB_THICK });
                    if (r === maxR) slabTiles.push({ x0: sx0 - (c === minC ? extPad : seamPad), x1: sx1 + (c === maxC ? extPad : seamPad), z0: sz1 - extPad, z1: sz1 + extPad, thick: SLAB_THICK });
                }
                continue;
            }
            if (isStairCut) {
                flushRun(c - 1);
                const cz0 = -halfD + r * cellSize - (r === minR ? extPad : seamPad);
                const cz1 = -halfD + (r + 1) * cellSize + (r === maxR ? extPad : seamPad);
                const cx0 = -halfW + c * cellSize - (c === minC ? extPad : seamPad);
                const cx1 = -halfW + (c + 1) * cellSize + (c === maxC ? extPad : seamPad);
                const topLandZ1 = stairZNorth + approachTop;
                const botSillZ0 = stairCutZ1;
                if (r === stairR0) {
                    slabTiles.push({ x0: cx0, x1: cx1, z0: cz0, z1: topLandZ1, thick: SLAB_THICK });
                    if (topLandZ1 < cz1 - 0.02) {
                        if (c === minC) slabTiles.push({ x0: stairX0 - extPad, x1: stairX0 + extPad, z0: topLandZ1 - seamPad, z1: cz1, thick: SLAB_THICK });
                        if (c === maxC) slabTiles.push({ x0: stairX1 - extPad, x1: stairX1 + extPad, z0: topLandZ1 - seamPad, z1: cz1, thick: SLAB_THICK });
                    }
                } else {
                    slabTiles.push({ x0: cx0, x1: cx1, z0: botSillZ0, z1: cz1, thick: SLAB_THICK });
                    if (cz0 < botSillZ0 - 0.02) {
                        if (c === minC) slabTiles.push({ x0: stairX0 - extPad, x1: stairX0 + extPad, z0: cz0, z1: botSillZ0 + seamPad, thick: SLAB_THICK });
                        if (c === maxC) slabTiles.push({ x0: stairX1 - extPad, x1: stairX1 + extPad, z0: cz0, z1: botSillZ0 + seamPad, thick: SLAB_THICK });
                    }
                }
                continue;
            }
            if (runStartC < 0) runStartC = c;
        }
        flushRun(maxC);
    }
    if (floorIdx === 0) {
        // Exterior entry threshold porch slab under front door (supports bro.eye doorway threshold check)
        const px0 = -halfW + entryC * cellSize;
        const px1 = px0 + cellSize;
        slabTiles.push({ x0: px0, x1: px1, z0: halfD + extPad, z1: halfD + 1.30, thick: PLINTH_DEPTH, isPorch: true });
    }

    // Wall segments (exterior perimeter + interior room partitions + shaft walls)
    const wallSegs = [];
    const extTint = palette;
    const intTint = [0.78, 0.76, 0.72, 1];
    const shaftTint = [0.46, 0.48, 0.52, 1];

    // Vertical cell edges (along Z, at x = -halfW + c * cellSize)
    for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC + 1; c++) {
            const left = (c - 1 >= minC) ? cellRoom[r][c - 1] : -1;
            const right = (c <= maxC) ? cellRoom[r][c] : -1;
            const leftExt = c - 1 < minC;
            const rightExt = c > maxC;
            if (left === right && !(leftExt !== rightExt)) continue;
            if (leftExt && rightExt) continue;

            const isExt = leftExt || rightExt;
            const isElevEdge = hasElev && ((c - 1 === elevC && r === elevR) || (c === elevC && r === elevR));
            const isStairEdge = totalFloors > 1 && ((c - 1 === stairC && (r === stairR0 || r === stairR1)) || (c === stairC && (r === stairR0 || r === stairR1)));
            const edgeId = `V_${c}_${r}`;
            const hasDoor = doorCellEdges.has(edgeId);

            const wx = -halfW + c * cellSize;
            const wz = -halfD + (r + 0.5) * cellSize;
            let type = 'solid';
            if (hasDoor) type = 'door';
            else if (isExt && !isElevEdge && !isStairEdge && ((c + r + floorIdx) & 1) === 0) type = 'window';

            wallSegs.push({
                x: wx, z: wz, ry: Math.PI * 0.5, length: cellSize,
                type, isExt,
                roomA: left, roomB: right,
                tint: isExt ? extTint : (isElevEdge ? shaftTint : intTint),
            });
        }
    }

    // Horizontal cell edges (along X, at z = -halfD + r * cellSize)
    for (let r = minR; r <= maxR + 1; r++) {
        for (let c = minC; c <= maxC; c++) {
            const north = (r - 1 >= minR) ? cellRoom[r - 1][c] : -1;
            const south = (r <= maxR) ? cellRoom[r][c] : -1;
            const northExt = r - 1 < minR;
            const southExt = r > maxR;
            if (north === south && !(northExt !== southExt)) continue;
            if (northExt && southExt) continue;

            const isExt = northExt || southExt;
            const isElevEdge = hasElev && ((c === elevC && r - 1 === elevR) || (c === elevC && r === elevR));
            const isFrontDoor = floorIdx === 0 && southExt && c === entryC && r === entryR + 1;
            const edgeId = `H_${c}_${r}`;
            const hasDoor = isFrontDoor || doorCellEdges.has(edgeId);

            const wx = -halfW + (c + 0.5) * cellSize;
            const wz = -halfD + r * cellSize;
            let type = 'solid';
            if (hasDoor) type = 'door';
            else if (isExt && !isElevEdge && !(totalFloors > 1 && c === stairC) && ((c + r + floorIdx) & 1) === 0) {
                type = 'window';
            }

            wallSegs.push({
                x: wx, z: wz, ry: 0, length: cellSize,
                type, isExt,
                roomA: north, roomB: south,
                tint: isExt ? extTint : (isElevEdge ? shaftTint : intTint),
            });
        }
    }

    // Furnish walkable rooms
    const furniture = [];
    for (let i = 0; i < rooms.length; i++) {
        const rm = rooms[i];
        const items = populateRoomFurniture(rm, rm.role, cellSize, halfW, halfD, clearPts, rng);
        for (let j = 0; j < items.length; j++) {
            furniture.push({ ...items[j], roomId: rm.id });
        }
    }

    return {
        rooms,
        cellRoom,
        doors,
        stairs,
        stairCutZ0,
        stairCutZ1,
        slabTiles,
        wallSegs,
        furniture,
        minC, maxC, minR, maxR,
        footW: (maxC - minC + 1) * cellSize,
        footD: (maxR - minR + 1) * cellSize,
        footCX: -halfW + 0.5 * (minC + maxC + 1) * cellSize,
        footCZ: -halfD + 0.5 * (minR + maxR + 1) * cellSize,
    };
}

export function getBuildingMass(parcel) {
    if (!parcel || parcel.kind === 'park') return null;
    const hit = massCache.get(parcel.id);
    if (hit) return hit;

    const rng = mulberry32(parcel.seed ^ 0x517cc1b7);
    const kind = parcel.kind;
    const rot = parcel.rot || 0;
    const rot90 = parcel.entrySide === 'E' || parcel.entrySide === 'W';
    const availW = (rot90 ? parcel.padHalfD : parcel.padHalfW) * 2.0 - 1.2;
    const availD = (rot90 ? parcel.padHalfW : parcel.padHalfD) * 2.0 - 1.2;
    const cellSize = kind === 'home' ? 3.0 : 4.0;
    let cols, rows;
    if (kind === 'home') {
        cols = clamp(Math.floor((availW * 0.72) / cellSize), 3, 4);
        rows = clamp(Math.floor((availD * 0.65) / cellSize), 3, 5);
    } else if (kind === 'business') {
        cols = clamp(Math.floor((availW * 0.88) / cellSize), 3, 6);
        rows = clamp(Math.floor((availD * 0.88) / cellSize), 3, 6);
    } else {
        cols = clamp(Math.floor((availW * 0.90) / cellSize), 5, 9);
        rows = clamp(Math.floor((availD * 0.90) / cellSize), 5, 9);
    }
    const width = cols * cellSize;
    const depth = rows * cellSize;
    const baseY = parcel.padY + 0.12;
    const totalFloors = Math.max(1, parcel.floors | 0);
    const floorHeight = parcel.floorHeight || (kind === 'home' ? 3.2 : (kind === 'business' ? 3.6 : 3.8));
    const palette = getPalette(kind, rng);
    const setbackStart = totalFloors >= 20 && cols >= 5 && rows >= 5 ? Math.floor(totalFloors * 0.68) : totalFloors;
    const m = {
        id: parcel.id, kind, originX: parcel.cx, originZ: parcel.cz, rot,
        width, depth, halfW: width * 0.5, halfD: depth * 0.5,
        seedMod: (parcel.seed & 1023) * 0.13,
        cellSize, cols, rows, baseY, totalFloors, floorHeight, palette,
        setbackStart,
        sbWidth: (cols - 2) * cellSize,
        sbDepth: (rows - 2) * cellSize,
    };
    if (massCache.size >= 2048) massCache.delete(massCache.keys().next().value);
    massCache.set(parcel.id, m);
    return m;
}

export function getBuildingBlueprint(parcel) {
    if (!parcel || parcel.kind === 'park') return null;
    const hit = bpCache.get(parcel.id);
    if (hit) {
        bpCache.delete(parcel.id);
        bpCache.set(parcel.id, hit);
        return hit;
    }

    const rng = mulberry32(parcel.seed ^ 0x517cc1b7);
    const kind = parcel.kind;
    const rot = parcel.rot || 0;
    const rot90 = parcel.entrySide === 'E' || parcel.entrySide === 'W';
    const availW = (rot90 ? parcel.padHalfD : parcel.padHalfW) * 2.0 - 1.2;
    const availD = (rot90 ? parcel.padHalfW : parcel.padHalfD) * 2.0 - 1.2;

    const cellSize = kind === 'home' ? 3.0 : 4.0;
    let cols, rows;
    if (kind === 'home') {
        cols = clamp(Math.floor((availW * 0.72) / cellSize), 3, 4);
        rows = clamp(Math.floor((availD * 0.65) / cellSize), 3, 5);
    } else if (kind === 'business') {
        cols = clamp(Math.floor((availW * 0.88) / cellSize), 3, 6);
        rows = clamp(Math.floor((availD * 0.88) / cellSize), 3, 6);
    } else {
        cols = clamp(Math.floor((availW * 0.90) / cellSize), 5, 9);
        rows = clamp(Math.floor((availD * 0.90) / cellSize), 5, 9);
    }

    const width = cols * cellSize;
    const depth = rows * cellSize;
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const baseY = parcel.padY + 0.12;
    const totalFloors = Math.max(1, parcel.floors | 0);
    const floorHeight = parcel.floorHeight || (kind === 'home' ? 3.2 : (kind === 'business' ? 3.6 : 3.8));
    const palette = getPalette(kind, rng);

    const entryC = Math.floor(cols / 2);
    const entryR = rows - 1;
    const hasElev = (kind === 'skyscraper') || (kind === 'business' && totalFloors >= 2);
    const stairR0 = rows >= 4 ? 1 : 0;
    const stairR1 = stairR0 + 1;
    const stairC = kind === 'skyscraper' ? Math.max(1, entryC - 1) : 0;
    const elevC = kind === 'skyscraper' ? Math.min(cols - 2, entryC + 1) : (cols - 1);
    const elevR = rows >= 4 ? 1 : 0;

    const common = {
        kind, totalFloors, cols, rows, cellSize, floorHeight,
        stairC, stairR0, stairR1, elevC, elevR, entryC, entryR, hasElev, palette, seed: parcel.seed,
    };

    const lobbyTpl = buildFloorTemplate({ ...common, floorIdx: 0, minC: 0, maxC: cols - 1, minR: 0, maxR: rows - 1 });
    const upperTpls = [];
    if (totalFloors > 1) {
        upperTpls.push(buildFloorTemplate({ ...common, floorIdx: 1, minC: 0, maxC: cols - 1, minR: 0, maxR: rows - 1 }));
    }
    if (totalFloors > 2) {
        upperTpls.push(buildFloorTemplate({ ...common, floorIdx: 2, minC: 0, maxC: cols - 1, minR: 0, maxR: rows - 1 }));
    }
    let setbackTpl = null;
    let setbackTopTpl = null;
    const setbackStart = totalFloors >= 20 && cols >= 5 && rows >= 5 ? Math.floor(totalFloors * 0.68) : totalFloors;
    if (setbackStart < totalFloors) {
        setbackTpl = buildFloorTemplate({ ...common, floorIdx: setbackStart, minC: 1, maxC: cols - 2, minR: 1, maxR: rows - 2 });
        setbackTopTpl = buildFloorTemplate({ ...common, floorIdx: totalFloors - 1, minC: 1, maxC: cols - 2, minR: 1, maxR: rows - 2 });
    }

    const floors = new Array(totalFloors);
    for (let f = 0; f < totalFloors; f++) {
        let tpl;
        if (f === 0) tpl = lobbyTpl;
        else if (f === totalFloors - 1 && totalFloors > 2) {
            // Top floor doesn't have stairUp -> build exact top template once
            tpl = (f >= setbackStart && setbackTopTpl)
                ? setbackTopTpl
                : buildFloorTemplate({ ...common, floorIdx: f, minC: 0, maxC: cols - 1, minR: 0, maxR: rows - 1 });
        } else if (f >= setbackStart && setbackTpl) {
            tpl = setbackTpl;
        } else {
            tpl = upperTpls[(f - 1) % upperTpls.length];
        }
        floors[f] = {
            index: f,
            yBase: baseY + f * floorHeight,
            yCeil: baseY + (f + 1) * floorHeight,
            ...tpl,
        };
    }

    // Setback transition floor (setbackStart - 1) outer ring terrace/ceiling cap
    if (setbackStart < totalFloors && setbackStart > 0) {
        const extPad = WALL_THICK * 0.5 + 0.04;
        const ox0 = -halfW - extPad, ox1 = halfW + extPad;
        const oz0 = -halfD - extPad, oz1 = halfD + extPad;
        const ix0 = -halfW + cellSize - extPad, ix1 = halfW - cellSize + extPad;
        const iz0 = -halfD + cellSize - extPad, iz1 = halfD - cellSize + extPad;
        floors[setbackStart - 1].terraceSlabs = [
            { x0: ox0, x1: ox1, z0: oz0, z1: iz0, thick: SLAB_THICK },
            { x0: ox0, x1: ox1, z0: iz1, z1: oz1, thick: SLAB_THICK },
            { x0: ox0, x1: ix0, z0: iz0, z1: iz1, thick: SLAB_THICK },
            { x0: ix1, x1: ox1, z0: iz0, z1: iz1, thick: SLAB_THICK },
        ];
    }

    const elevatorShaft = hasElev ? {
        c: elevC,
        r: elevR,
        x0: -halfW + elevC * cellSize,
        x1: -halfW + (elevC + 1) * cellSize,
        z0: -halfD + elevR * cellSize,
        z1: -halfD + (elevR + 1) * cellSize,
        cx: -halfW + (elevC + 0.5) * cellSize,
        cz: -halfD + (elevR + 0.5) * cellSize,
        cabW: cellSize - 0.50,
        cabD: cellSize - 0.50,
        cabH: floorHeight - 0.35,
        doorX: -halfW + (elevC + 0.5) * cellSize,
        doorZ: -halfD + (elevR + 1) * cellSize,
    } : null;

    const bp = {
        id: parcel.id,
        kind,
        parcel,
        originX: parcel.cx,
        baseY,
        originZ: parcel.cz,
        rot,
        width,
        depth,
        halfW,
        halfD,
        cellSize,
        cols,
        rows,
        floorHeight,
        totalFloors,
        setbackStart,
        palette,
        floors,
        elevatorShaft,
        frontDoorLocal: {
            x: -halfW + (entryC + 0.5) * cellSize,
            z: halfD,
        },
        exteriorBox: {
            minX: -halfW,
            maxX: halfW,
            minY: parcel.padY - 0.15,
            maxY: baseY + totalFloors * floorHeight + 0.68,
            minZ: -halfD,
            maxZ: halfD,
        },
    };

    if (bpCache.size >= MAX_CACHE) {
        bpCache.delete(bpCache.keys().next().value);
    }
    bpCache.set(parcel.id, bp);
    return bp;
}

export function localToWorld(bp, lx, ly, lz) {
    const c = Math.cos(bp.rot);
    const s = Math.sin(bp.rot);
    return [
        bp.originX + c * lx + s * lz,
        ly,
        bp.originZ - s * lx + c * lz,
    ];
}

export function worldToLocal(bp, wx, wy, wz) {
    const dx = wx - bp.originX;
    const dz = wz - bp.originZ;
    const c = Math.cos(bp.rot);
    const s = Math.sin(bp.rot);
    return [
        c * dx - s * dz,
        wy,
        s * dx + c * dz,
    ];
}
