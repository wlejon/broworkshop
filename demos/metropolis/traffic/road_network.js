// Deterministic road lane graph, slope probes, and curb-side parked car slots aligned with city_layout.js.
import * as layout from '/app/world/city_layout.js';

const LANE_SPECS = {
    avenue:   { offsets: [2.4, 6.2], halfWidth: 10.0, speedLimit: 22 },
    street:   { offsets: [2.2],      halfWidth: 6.0,  speedLimit: 14 },
    suburban: { offsets: [2.25],     halfWidth: 4.5,  speedLimit: 11 },
};

const CAR_PALETTES = [
    [0.72, 0.14, 0.16, 1],
    [0.14, 0.30, 0.56, 1],
    [0.76, 0.78, 0.80, 1],
    [0.18, 0.20, 0.23, 1],
    [0.16, 0.42, 0.28, 1],
    [0.78, 0.58, 0.16, 1],
    [0.44, 0.20, 0.38, 1],
    [0.54, 0.58, 0.62, 1],
];

const PARKED_CACHE = new Map();
const MAX_PARKED_CACHE = 1024;

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

export function getLaneSpec(roadKind) {
    return LANE_SPECS[roadKind] || LANE_SPECS.suburban;
}

export function yawForAxisDir(axis, dir) {
    if (axis === 'z') return dir < 0 ? 0.0 : Math.PI;
    return dir > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
}

export function laneCoord(lineCoord, roadKind, axis, dir, laneIdx = 0) {
    const spec = getLaneSpec(roadKind);
    const off = spec.offsets[Math.min(laneIdx, spec.offsets.length - 1)];
    if (axis === 'z') {
        return lineCoord + (dir < 0 ? off : -off);
    }
    return lineCoord + (dir > 0 ? off : -off);
}

export function getNearestRoadPoint(x, z, opts = {}) {
    const avoidIntersection = opts.avoidIntersection !== false;
    const rx = clamp(Math.floor(x / layout.BLOCK_SIZE + 0.5), layout.BLOCK_MIN + 1, layout.BLOCK_MAX);
    const rz = clamp(Math.floor(z / layout.BLOCK_SIZE + 0.5), layout.BLOCK_MIN + 1, layout.BLOCK_MAX);

    const xKind = layout.roadKindForLine(rx, rz);
    const zKind = layout.roadKindForLine(rz, rx);
    const xSpec = getLaneSpec(xKind);
    const zSpec = getLaneSpec(zKind);

    const lineX = rx * layout.BLOCK_SIZE;
    const lineZ = rz * layout.BLOCK_SIZE;

    // Candidate on N-S road (axis = 'z')
    const dirNS = (x >= lineX) ? -1 : 1;
    const offIdxNS = xSpec.offsets.length > 1 && Math.abs(x - lineX) > 5.0 ? 1 : 0;
    const pxNS = laneCoord(lineX, xKind, 'z', dirNS, offIdxNS);
    let pzNS = clamp(z, layout.WORLD_MIN + 24, layout.WORLD_MAX - 24);
    if (avoidIntersection) {
        const dzInt = pzNS - lineZ;
        const minClr = zSpec.halfWidth + 5.0;
        if (Math.abs(dzInt) < minClr) {
            pzNS = lineZ + (dzInt >= 0 ? minClr : -minClr);
        }
    }
    const dNS = Math.hypot(pxNS - x, pzNS - z);

    // Candidate on E-W road (axis = 'x')
    const dirEW = (z >= lineZ) ? 1 : -1;
    const offIdxEW = zSpec.offsets.length > 1 && Math.abs(z - lineZ) > 5.0 ? 1 : 0;
    const pzEW = laneCoord(lineZ, zKind, 'x', dirEW, offIdxEW);
    let pxEW = clamp(x, layout.WORLD_MIN + 24, layout.WORLD_MAX - 24);
    if (avoidIntersection) {
        const dxInt = pxEW - lineX;
        const minClr = xSpec.halfWidth + 5.0;
        if (Math.abs(dxInt) < minClr) {
            pxEW = lineX + (dxInt >= 0 ? minClr : -minClr);
        }
    }
    const dEW = Math.hypot(pxEW - x, pzEW - z);

    if (dNS <= dEW) {
        const py = layout.sampleGroundHeight(pxNS, pzNS);
        return {
            x: pxNS, y: py, z: pzNS,
            yaw: yawForAxisDir('z', dirNS),
            roadKind: xKind,
            roadAxis: 'z',
            lineIdx: rx,
            dir: dirNS,
            laneIdx: offIdxNS,
            dist: dNS,
        };
    }
    const py = layout.sampleGroundHeight(pxEW, pzEW);
    return {
        x: pxEW, y: py, z: pzEW,
        yaw: yawForAxisDir('x', dirEW),
        roadKind: zKind,
        roadAxis: 'x',
        lineIdx: rz,
        dir: dirEW,
        laneIdx: offIdxEW,
        dist: dEW,
    };
}

export function sampleSlopeTransform(x, z, yaw, halfWB = 1.35, halfTrack = 0.80) {
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const fx = -sy, fz = -cy;
    const rx = cy, rz = -sy;

    const hFL = layout.sampleGroundHeight(x + fx * halfWB - rx * halfTrack, z + fz * halfWB - rz * halfTrack);
    const hFR = layout.sampleGroundHeight(x + fx * halfWB + rx * halfTrack, z + fz * halfWB + rz * halfTrack);
    const hRL = layout.sampleGroundHeight(x - fx * halfWB - rx * halfTrack, z - fz * halfWB - rz * halfTrack);
    const hRR = layout.sampleGroundHeight(x - fx * halfWB + rx * halfTrack, z - fz * halfWB + rz * halfTrack);

    const y = 0.25 * (hFL + hFR + hRL + hRR);
    const frontH = 0.5 * (hFL + hFR);
    const rearH = 0.5 * (hRL + hRR);
    const rightH = 0.5 * (hFR + hRR);
    const leftH = 0.5 * (hFL + hRL);

    return {
        y,
        pitch: clamp(Math.atan2(frontH - rearH, 2.0 * halfWB), -0.45, 0.45),
        roll: clamp(Math.atan2(rightH - leftH, 2.0 * halfTrack), -0.35, 0.35),
    };
}

export function getSpawnSegmentsNear(camPos, minR = 24, maxR = 250) {
    const segs = [];
    const bx0 = Math.max(layout.BLOCK_MIN + 1, Math.floor((camPos[0] - maxR) / layout.BLOCK_SIZE));
    const bx1 = Math.min(layout.BLOCK_MAX, Math.ceil((camPos[0] + maxR) / layout.BLOCK_SIZE));
    const bz0 = Math.max(layout.BLOCK_MIN + 1, Math.floor((camPos[2] - maxR) / layout.BLOCK_SIZE));
    const bz1 = Math.min(layout.BLOCK_MAX, Math.ceil((camPos[2] + maxR) / layout.BLOCK_SIZE));

    // N-S roads (x = rx * 128)
    for (let rx = bx0; rx <= bx1; rx++) {
        const lineX = rx * layout.BLOCK_SIZE;
        for (let bz = bz0; bz < bz1; bz++) {
            const zMid = (bz + 0.5) * layout.BLOCK_SIZE;
            const d = Math.hypot(lineX - camPos[0], zMid - camPos[2]);
            if (d < minR * 0.5 || d > maxR + 64) continue;
            const kind = layout.roadKindForLine(rx, bz);
            const spec = getLaneSpec(kind);
            segs.push({
                axis: 'z',
                lineIdx: rx,
                perpIdx: bz,
                lineCoord: lineX,
                startS: bz * layout.BLOCK_SIZE + 16,
                endS: (bz + 1) * layout.BLOCK_SIZE - 16,
                roadKind: kind,
                spec,
            });
        }
    }

    // E-W roads (z = rz * 128)
    for (let rz = bz0; rz <= bz1; rz++) {
        const lineZ = rz * layout.BLOCK_SIZE;
        for (let bx = bx0; bx < bx1; bx++) {
            const xMid = (bx + 0.5) * layout.BLOCK_SIZE;
            const d = Math.hypot(xMid - camPos[0], lineZ - camPos[2]);
            if (d < minR * 0.5 || d > maxR + 64) continue;
            const kind = layout.roadKindForLine(rz, bx);
            const spec = getLaneSpec(kind);
            segs.push({
                axis: 'x',
                lineIdx: rz,
                perpIdx: bx,
                lineCoord: lineZ,
                startS: bx * layout.BLOCK_SIZE + 16,
                endS: (bx + 1) * layout.BLOCK_SIZE - 16,
                roadKind: kind,
                spec,
            });
        }
    }
    return segs;
}

function parkedLateralOffset(roadKind, spec) {
    // Keep parked cars structurally separated from active traffic lanes and clear of curbs:
    // - avenue: curb shoulder bay on asphalt (|8.95 - 6.2| = 2.75 m from outer lane, wheels <= 9.75 < 9.85)
    // - street: curb shoulder bay on asphalt (|4.95 - 2.2| = 2.75 m from lane, wheels <= 5.75 < 5.85)
    // - suburban: off-road driveway apron outside sidewalk (|7.65 - 2.25| = 5.40 m from lane)
    if (roadKind === 'avenue' || roadKind === 'street') return spec.halfWidth - 1.05;
    return spec.halfWidth + 2.0 + 1.15;
}

export function getBlockParkedCars(bx, bz) {
    if (bx < layout.BLOCK_MIN || bx > layout.BLOCK_MAX || bz < layout.BLOCK_MIN || bz > layout.BLOCK_MAX) {
        return [];
    }
    const key = ((bx + 2048) * 4096) + (bz + 2048);
    const cached = PARKED_CACHE.get(key);
    if (cached) return cached;

    const dist = layout.sampleBlockDistrict(bx, bz);
    const list = [];
    if (dist.zone !== 'park') {
        const h0 = layout.hash2f(bx, bz, 307);
        const h1 = layout.hash2f(bx, bz, 409);
        const h2 = layout.hash2f(bx, bz, 503);
        const h3 = layout.hash2f(bx, bz, 601);

        // West edge of block (facing North -Z)
        if (h0 < 0.78 && bx > layout.BLOCK_MIN) {
            const xKind = layout.roadKindForLine(bx, bz);
            const xSpec = getLaneSpec(xKind);
            const wx = bx * layout.BLOCK_SIZE + parkedLateralOffset(xKind, xSpec);
            const wz = bz * layout.BLOCK_SIZE + (0.28 + 0.44 * h1) * layout.BLOCK_SIZE;
            const slope = sampleSlopeTransform(wx, wz, 0.0);
            list.push({
                id: `pk_${bx}_${bz}_0`,
                wx, wy: slope.y, wz,
                yaw: 0.0, pitch: slope.pitch, roll: slope.roll,
                roadKind: xKind,
                color: CAR_PALETTES[Math.floor(h1 * CAR_PALETTES.length) % CAR_PALETTES.length],
            });
        }

        // North edge of block (facing East +X)
        if (h2 < 0.65 && bz > layout.BLOCK_MIN) {
            const zKind = layout.roadKindForLine(bz, bx);
            const zSpec = getLaneSpec(zKind);
            const wx = bx * layout.BLOCK_SIZE + (0.28 + 0.44 * h3) * layout.BLOCK_SIZE;
            const wz = bz * layout.BLOCK_SIZE + parkedLateralOffset(zKind, zSpec);
            const yaw = -Math.PI * 0.5;
            const slope = sampleSlopeTransform(wx, wz, yaw);
            list.push({
                id: `pk_${bx}_${bz}_1`,
                wx, wy: slope.y, wz,
                yaw, pitch: slope.pitch, roll: slope.roll,
                roadKind: zKind,
                color: CAR_PALETTES[Math.floor(h3 * CAR_PALETTES.length) % CAR_PALETTES.length],
            });
        }
    }

    if (PARKED_CACHE.size >= MAX_PARKED_CACHE) {
        PARKED_CACHE.delete(PARKED_CACHE.keys().next().value);
    }
    PARKED_CACHE.set(key, list);
    return list;
}

export { CAR_PALETTES };
