// Deterministic curved road lane graph, slope probes, and curb-side parked car slots aligned with city_layout.js.
import * as layout from '/app/world/city_layout.js';

const LANE_SPECS = {
    avenue:   { offsets: [2.4, 6.2], halfWidth: 10.0, speedLimit: 22 },
    street:   { offsets: [2.2],      halfWidth: 6.0,  speedLimit: 14 },
    suburban: { offsets: [2.25],     halfWidth: 4.5,  speedLimit: 11 },
};

const CAR_PALETTES = [
    [0.64, 0.12, 0.14, 1], // Crimson pearl
    [0.13, 0.28, 0.54, 1], // Deep sapphire
    [0.82, 0.83, 0.85, 1], // Glacier white
    [0.16, 0.18, 0.21, 1], // Obsidian metallic
    [0.14, 0.36, 0.25, 1], // British racing green
    [0.72, 0.50, 0.16, 1], // Champagne bronze
    [0.36, 0.42, 0.48, 1], // Slate titanium
    [0.66, 0.28, 0.14, 1], // Burnt copper
    [0.18, 0.24, 0.36, 1], // Midnight navy
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

export function yawForGridAxisDir(u, v, axis, dir) {
    if (axis === 'z') {
        const [tx, tz] = layout.gridTangentV(u, v);
        const yNeg = Math.atan2(tx, tz);
        return dir < 0 ? yNeg : yNeg + Math.PI;
    }
    const [tx, tz] = layout.gridTangentU(u, v);
    const yPos = Math.atan2(-tx, -tz);
    return dir > 0 ? yPos : yPos + Math.PI;
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
    const [gu, gv] = layout.worldToGrid(x, z);
    const rx = clamp(Math.floor(gu / layout.BLOCK_SIZE + 0.5), layout.BLOCK_MIN + 1, layout.BLOCK_MAX);
    const rz = clamp(Math.floor(gv / layout.BLOCK_SIZE + 0.5), layout.BLOCK_MIN + 1, layout.BLOCK_MAX);

    const xKind = layout.roadKindForLine(rx, rz);
    const zKind = layout.roadKindForLine(rz, rx);
    const xSpec = getLaneSpec(xKind);
    const zSpec = getLaneSpec(zKind);

    const lineU = rx * layout.BLOCK_SIZE;
    const lineV = rz * layout.BLOCK_SIZE;

    // Candidate on N-S road (along grid V, u = rx * 128)
    const dirNS = (gu >= lineU) ? -1 : 1;
    const offIdxNS = xSpec.offsets.length > 1 && Math.abs(gu - lineU) > 5.0 ? 1 : 0;
    const puNS = laneCoord(lineU, xKind, 'z', dirNS, offIdxNS);
    let pvNS = clamp(gv, layout.WORLD_MIN + 24, layout.WORLD_MAX - 24);
    if (avoidIntersection) {
        const dzInt = pvNS - lineV;
        const minClr = zSpec.halfWidth + 5.0;
        if (Math.abs(dzInt) < minClr) {
            pvNS = lineV + (dzInt >= 0 ? minClr : -minClr);
        }
    }
    const [wxNS, wzNS] = layout.gridToWorld(puNS, pvNS);
    const dNS = Math.hypot(wxNS - x, wzNS - z);

    // Candidate on E-W road (along grid U, v = rz * 128)
    const dirEW = (gv >= lineV) ? 1 : -1;
    const offIdxEW = zSpec.offsets.length > 1 && Math.abs(gv - lineV) > 5.0 ? 1 : 0;
    const pvEW = laneCoord(lineV, zKind, 'x', dirEW, offIdxEW);
    let puEW = clamp(gu, layout.WORLD_MIN + 24, layout.WORLD_MAX - 24);
    if (avoidIntersection) {
        const dxInt = puEW - lineU;
        const minClr = xSpec.halfWidth + 5.0;
        if (Math.abs(dxInt) < minClr) {
            puEW = lineU + (dxInt >= 0 ? minClr : -minClr);
        }
    }
    const [wxEW, wzEW] = layout.gridToWorld(puEW, pvEW);
    const dEW = Math.hypot(wxEW - x, wzEW - z);

    const rcNS = layout.riverCorridorInfo(puNS, pvNS);
    const useNS = (dNS <= dEW) && rcNS.roadSuppress < 0.35;

    if (useNS) {
        const py = layout.sampleGroundHeight(wxNS, wzNS);
        return {
            x: wxNS, y: py, z: wzNS,
            yaw: yawForGridAxisDir(puNS, pvNS, 'z', dirNS),
            roadKind: xKind,
            roadAxis: 'z',
            lineIdx: rx,
            dir: dirNS,
            laneIdx: offIdxNS,
            dist: dNS,
        };
    }
    const py = layout.sampleGroundHeight(wxEW, wzEW);
    return {
        x: wxEW, y: py, z: wzEW,
        yaw: yawForGridAxisDir(puEW, pvEW, 'x', dirEW),
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
    const [guCam, gvCam] = layout.worldToGrid(camPos[0], camPos[2]);
    const bx0 = Math.max(layout.BLOCK_MIN + 1, Math.floor((guCam - maxR) / layout.BLOCK_SIZE));
    const bx1 = Math.min(layout.BLOCK_MAX, Math.ceil((guCam + maxR) / layout.BLOCK_SIZE));
    const bz0 = Math.max(layout.BLOCK_MIN + 1, Math.floor((gvCam - maxR) / layout.BLOCK_SIZE));
    const bz1 = Math.min(layout.BLOCK_MAX, Math.ceil((gvCam + maxR) / layout.BLOCK_SIZE));

    // N-S roads (grid u = rx * 128)
    for (let rx = bx0; rx <= bx1; rx++) {
        const lineU = rx * layout.BLOCK_SIZE;
        for (let bz = bz0; bz < bz1; bz++) {
            const vMid = (bz + 0.5) * layout.BLOCK_SIZE;
            const rc = layout.riverCorridorInfo(lineU, vMid);
            if (rc.dist < layout.RIVER_HALF_W + 24.0) continue;
            const d = Math.hypot(lineU - guCam, vMid - gvCam);
            if (d < minR * 0.5 || d > maxR + 64) continue;
            const kind = layout.roadKindForLine(rx, bz);
            const spec = getLaneSpec(kind);
            segs.push({
                axis: 'z',
                lineIdx: rx,
                perpIdx: bz,
                lineCoord: lineU,
                startS: bz * layout.BLOCK_SIZE + 16,
                endS: (bz + 1) * layout.BLOCK_SIZE - 16,
                roadKind: kind,
                spec,
            });
        }
    }

    // E-W roads (grid v = rz * 128)
    for (let rz = bz0; rz <= bz1; rz++) {
        const lineV = rz * layout.BLOCK_SIZE;
        for (let bx = bx0; bx < bx1; bx++) {
            const uMid = (bx + 0.5) * layout.BLOCK_SIZE;
            const rc = layout.riverCorridorInfo(uMid, lineV);
            if (rc.roadSuppress > 0.2) continue;
            const d = Math.hypot(uMid - guCam, lineV - gvCam);
            if (d < minR * 0.5 || d > maxR + 64) continue;
            const kind = layout.roadKindForLine(rz, bx);
            const spec = getLaneSpec(kind);
            segs.push({
                axis: 'x',
                lineIdx: rz,
                perpIdx: bx,
                lineCoord: lineV,
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

        // West edge of block (facing North -Z along street)
        if (h0 < 0.78 && bx > layout.BLOCK_MIN) {
            const xKind = layout.roadKindForLine(bx, bz);
            const xSpec = getLaneSpec(xKind);
            const pu = bx * layout.BLOCK_SIZE + parkedLateralOffset(xKind, xSpec);
            const pv = bz * layout.BLOCK_SIZE + (0.28 + 0.44 * h1) * layout.BLOCK_SIZE;
            if (layout.riverCorridorInfo(pu, pv).dist >= layout.RIVER_HALF_W + 22.0) {
                const [wx, wz] = layout.gridToWorld(pu, pv);
                const yaw = yawForGridAxisDir(pu, pv, 'z', -1);
                const slope = sampleSlopeTransform(wx, wz, yaw);
                const arch = Math.floor(layout.hash2f(bx, bz, 709) * 4) % 4;
                list.push({
                    id: `pk_${bx}_${bz}_0`,
                    wx, wy: slope.y, wz,
                    yaw, pitch: slope.pitch, roll: slope.roll,
                    roadKind: xKind,
                    archetype: arch,
                    color: CAR_PALETTES[Math.floor(h1 * CAR_PALETTES.length) % CAR_PALETTES.length],
                });
            }
        }

        // North edge of block (facing East +X along street)
        if (h2 < 0.65 && bz > layout.BLOCK_MIN) {
            const zKind = layout.roadKindForLine(bz, bx);
            const zSpec = getLaneSpec(zKind);
            const pu = bx * layout.BLOCK_SIZE + (0.28 + 0.44 * h3) * layout.BLOCK_SIZE;
            const pv = bz * layout.BLOCK_SIZE + parkedLateralOffset(zKind, zSpec);
            if (layout.riverCorridorInfo(pu, pv).dist >= layout.RIVER_HALF_W + 22.0) {
                const [wx, wz] = layout.gridToWorld(pu, pv);
                const yaw = yawForGridAxisDir(pu, pv, 'x', 1);
                const slope = sampleSlopeTransform(wx, wz, yaw);
                const arch = Math.floor(layout.hash2f(bx, bz, 733) * 4) % 4;
                list.push({
                    id: `pk_${bx}_${bz}_1`,
                    wx, wy: slope.y, wz,
                    yaw, pitch: slope.pitch, roll: slope.roll,
                    roadKind: zKind,
                    archetype: arch,
                    color: CAR_PALETTES[Math.floor(h3 * CAR_PALETTES.length) % CAR_PALETTES.length],
                });
            }
        }
    }

    if (PARKED_CACHE.size >= MAX_PARKED_CACHE) {
        PARKED_CACHE.delete(PARKED_CACHE.keys().next().value);
    }
    PARKED_CACHE.set(key, list);
    return list;
}

export { CAR_PALETTES };
