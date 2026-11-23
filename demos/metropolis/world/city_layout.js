// Deterministic 150.99 km^2 organic city & suburban layout, scenic river & bridges, road network,
// parcels, and terrain height. Math mirrors shaders/terrain_produce.bk and shaders/ground_mesh.bk bit-for-bit.

export const WORLD_MIN = -6144;
export const WORLD_MAX = 6144;
export const WORLD_SIZE = 12288; // 12288^2 = 150.994944 km^2 (>= 120 km^2)
export const BLOCK_SIZE = 128;   // 96 x 96 blocks: bx, bz in [-48, 47]
export const BLOCK_MIN = -48;
export const BLOCK_MAX = 47;

export const ROAD_WIDTH = { avenue: 20, street: 12, suburban: 9 };
export const SIDEWALK_WIDTH = { avenue: 3.5, street: 2.5, suburban: 2.0 };
export const SPEED_LIMIT = { avenue: 22, street: 14, suburban: 11 };
export const CURB_HEIGHT = 0.15;
export const ROAD_SKIRT = 6.0;
export const DOWNTOWN_DATUM_Y = 2.0;

export const RIVER_HALF_W = 34.0;
export const RIVER_BANK = 18.0;
export const RIVER_BED_Y = -2.6;
export const WATER_LEVEL_Y = -0.45;
export const MAX_WARP = 42.0;

const URBAN_RING_R2 = 2560 * 2560;
const MAX_BLOCK_CACHE = 4096;
const blockParcelCache = new Map();

export function hash2f(ix, iz, seed) {
    let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return (h >>> 8) * (1 / 16777216);
}

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

export function warpDelta(u, v) {
    const r = Math.hypot(u, v);
    if (r <= 580.0 || r >= 5900.0) return [0, 0];
    const amp = smoothstep(580.0, 1080.0, r) * (1.0 - smoothstep(5250.0, 5900.0, r));
    const dx = amp * (26.0 * Math.sin(v * (1.0 / 250.0)) + 15.0 * Math.cos((u + v) * (1.0 / 380.0)));
    const dz = amp * (26.0 * Math.sin(u * (1.0 / 270.0) + 1.1) + 15.0 * Math.sin((u - v) * (1.0 / 400.0)));
    return [dx, dz];
}

export function gridToWorld(u, v) {
    const [dx, dz] = warpDelta(u, v);
    return [u + dx, v + dz];
}

export function worldToGrid(x, z) {
    if (x * x + z * z <= 576.0 * 576.0) return [x, z];
    let u = x;
    let v = z;
    for (let i = 0; i < 6; i++) {
        const [dx, dz] = warpDelta(u, v);
        u = x - dx;
        v = z - dz;
    }
    return [u, v];
}

export function worldToBlock(x, z) {
    const [u, v] = worldToGrid(x, z);
    return [Math.floor(u / BLOCK_SIZE), Math.floor(v / BLOCK_SIZE)];
}

export function gridTangentU(u, v) {
    const eps = 1.0;
    const [x0, z0] = gridToWorld(u - eps, v);
    const [x1, z1] = gridToWorld(u + eps, v);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
}

export function gridTangentV(u, v) {
    const eps = 1.0;
    const [x0, z0] = gridToWorld(u, v - eps);
    const [x1, z1] = gridToWorld(u, v + eps);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
}

export function riverCenterU(v) {
    return 768.0 + 185.0 * Math.sin(v * (1.0 / 620.0)) + 70.0 * Math.cos(v * (1.0 / 310.0));
}

export function isOnBridgeAvenueV(v) {
    const aveV = Math.floor(v / 512.0 + 0.5) * 512.0;
    return Math.abs(v - aveV) <= 15.0;
}

export function riverCorridorInfo(u, v) {
    const rc = riverCenterU(v);
    const dist = Math.abs(u - rc);
    const aveV = Math.floor(v / 512.0 + 0.5) * 512.0;
    const aveVD = Math.abs(v - aveV);
    const bridgeMask = 1.0 - smoothstep(14.5, 22.0, aveVD);
    const carveFactor = (1.0 - smoothstep(RIVER_HALF_W - 4.0, RIVER_HALF_W + RIVER_BANK, dist)) * (1.0 - bridgeMask);
    const roadSuppress = (1.0 - smoothstep(RIVER_HALF_W + 6.0, RIVER_HALF_W + 22.0, dist)) * (1.0 - bridgeMask);
    return { dist, bridgeMask, carveFactor, roadSuppress, inWater: carveFactor > 0.35 };
}

export function valueNoise2D(x, z, cellSize, seed) {
    const gx = x / cellSize;
    const gz = z / cellSize;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = hash2f(ix, iz, seed);
    const b = hash2f(ix + 1, iz, seed);
    const c = hash2f(ix, iz + 1, seed);
    const d = hash2f(ix + 1, iz + 1, seed);
    const ab = a + (b - a) * ux;
    const cd = c + (d - c) * ux;
    return ab + (cd - ab) * uz;
}

export function sampleBlockDistrict(bx, bz) {
    const cx = (bx + 0.5) * BLOCK_SIZE;
    const cz = (bz + 0.5) * BLOCK_SIZE;
    const r = Math.hypot(cx, cz);

    // Central park & civic greenbelt
    if (bx >= 2 && bx <= 4 && bz >= -2 && bz <= 1) {
        return { zone: 'park', zoneId: 0, density: 0.08, seed: ((bx & 0xffff) << 16) | (bz & 0xffff) };
    }
    // Downtown high-rise core + midtown spine
    if (r < 1150 || (Math.abs(cx) < 384 && r < 1600)) {
        const density = 0.85 + 0.15 * (1 - clamp(r / 1600, 0, 1));
        return { zone: 'downtown', zoneId: 3, density, seed: ((bx & 0xffff) << 16) | (bz & 0xffff) };
    }
    // Commercial ring + neighborhood avenue strips
    const onAvenueStrip = ((bx & 3) === 0 || (bz & 3) === 0) && r < 4600 && hash2f(bx, bz, 71) < 0.22;
    if (r < 2450 || onAvenueStrip) {
        const density = 0.55 + 0.25 * (1 - clamp(r / 4600, 0, 1));
        return { zone: 'commercial', zoneId: 2, density, seed: ((bx & 0xffff) << 16) | (bz & 0xffff) };
    }
    // Suburban neighborhood parks
    if (hash2f(bx, bz, 97) < 0.10) {
        return { zone: 'park', zoneId: 0, density: 0.05, seed: ((bx & 0xffff) << 16) | (bz & 0xffff) };
    }
    const density = 0.30 + 0.25 * hash2f(bx, bz, 53);
    return { zone: 'suburb', zoneId: 1, density, seed: ((bx & 0xffff) << 16) | (bz & 0xffff) };
}

export function sampleDistrict(x, z) {
    const [bx, bz] = worldToBlock(x, z);
    return sampleBlockDistrict(bx, bz);
}

export function roadKindForLine(lineIndex, perpLineIndex) {
    if ((lineIndex & 3) === 0) return 'avenue';
    const lx = lineIndex * BLOCK_SIZE;
    const lz = perpLineIndex * BLOCK_SIZE;
    return (lx * lx + lz * lz) < URBAN_RING_R2 ? 'street' : 'suburban';
}

export function baseTerrainHeightUV(u, v) {
    const r = Math.hypot(u, v);
    const urbanFlat = 1.0 - smoothstep(950, 1550, r);
    const hillAmp = (1.0 - urbanFlat) * (10.0 + 28.0 * smoothstep(2200, 5600, r));
    const n1 = valueNoise2D(u, v, 512.0, 101) * 2.0 - 1.0;
    const n2 = valueNoise2D(u, v, 256.0, 202) * 2.0 - 1.0;
    const n3 = valueNoise2D(u, v, 128.0, 303) * 2.0 - 1.0;
    const ridge = (1.0 - urbanFlat) * 6.0 * smoothstep(2600, 5800, r);
    const rDist = Math.abs(u - riverCenterU(v));
    const valleyFactor = smoothstep(RIVER_HALF_W + 20.0, RIVER_HALF_W + 180.0, rDist);
    const h = DOWNTOWN_DATUM_Y + (hillAmp * (0.62 * n1 + 0.28 * n2 + 0.10 * n3) + ridge) * valleyFactor;
    return clamp(h, -4.0, 58.0);
}

export function baseTerrainHeight(x, z) {
    const [u, v] = worldToGrid(x, z);
    return baseTerrainHeightUV(u, v);
}

function snapCoord(coord, lineCenter, flatHalf, skirt) {
    const d = coord - lineCenter;
    const ad = Math.abs(d);
    if (ad <= flatHalf) return lineCenter;
    if (ad >= flatHalf + skirt) return coord;
    return lineCenter + d * smoothstep(flatHalf, flatHalf + skirt, ad);
}

export function roadTerrainHeight(x, z) {
    const [u, v] = worldToGrid(x, z);
    const rx = Math.floor(u / BLOCK_SIZE + 0.5);
    const rz = Math.floor(v / BLOCK_SIZE + 0.5);
    const xKind = roadKindForLine(rx, rz);
    const zKind = roadKindForLine(rz, rx);
    const halfX = ROAD_WIDTH[xKind] * 0.5;
    const halfZ = ROAD_WIDTH[zKind] * 0.5;
    const flatHalfX = halfX + SIDEWALK_WIDTH[xKind] + 0.5;
    const flatHalfZ = halfZ + SIDEWALK_WIDTH[zKind] + 0.5;

    const rc = riverCorridorInfo(u, v);
    const sx = rc.roadSuppress > 0.01
        ? u + (snapCoord(u, rx * BLOCK_SIZE, flatHalfX, ROAD_SKIRT) - u) * (1.0 - rc.roadSuppress)
        : snapCoord(u, rx * BLOCK_SIZE, flatHalfX, ROAD_SKIRT);
    const sz = rc.roadSuppress > 0.01
        ? v + (snapCoord(v, rz * BLOCK_SIZE, flatHalfZ, ROAD_SKIRT) - v) * (1.0 - rc.roadSuppress)
        : snapCoord(v, rz * BLOCK_SIZE, flatHalfZ, ROAD_SKIRT);

    const dx = Math.abs(u - rx * BLOCK_SIZE);
    const dz = Math.abs(v - rz * BLOCK_SIZE);
    const curbX = smoothstep(halfX - 0.15, halfX + 0.15, dx);
    const curbZ = smoothstep(halfZ - 0.15, halfZ + 0.15, dz);

    let h = baseTerrainHeightUV(sx, sz) + CURB_HEIGHT * Math.min(curbX, curbZ) * (1.0 - rc.roadSuppress);
    const bridgeDeckLift = (1.0 - smoothstep(RIVER_HALF_W + 4.0, RIVER_HALF_W + 32.0, rc.dist)) * rc.bridgeMask * 1.45;
    h += bridgeDeckLift;
    if (rc.carveFactor > 0.001) {
        h += (RIVER_BED_Y - h) * rc.carveFactor;
    }
    return h;
}

export function sampleRoad(x, z) {
    const [u, v] = worldToGrid(x, z);
    const rx = Math.floor(u / BLOCK_SIZE + 0.5);
    const rz = Math.floor(v / BLOCK_SIZE + 0.5);
    const xKind = roadKindForLine(rx, rz);
    const zKind = roadKindForLine(rz, rx);
    const halfX = ROAD_WIDTH[xKind] * 0.5;
    const halfZ = ROAD_WIDTH[zKind] * 0.5;
    const swX = halfX + SIDEWALK_WIDTH[xKind];
    const swZ = halfZ + SIDEWALK_WIDTH[zKind];
    const dx = Math.abs(u - rx * BLOCK_SIZE);
    const dz = Math.abs(v - rz * BLOCK_SIZE);

    const rc = riverCorridorInfo(u, v);
    const onXRoad = dx <= halfX && rc.roadSuppress < 0.5;
    const onZRoad = dz <= halfZ && (zKind === 'avenue' || rc.roadSuppress < 0.5);
    const onRoad = onXRoad || onZRoad;
    const onXSw = !onRoad && dx <= swX && rc.roadSuppress < 0.5;
    const onZSw = !onRoad && dz <= swZ && (zKind === 'avenue' || rc.roadSuppress < 0.5);
    const onSidewalk = !onRoad && (onXSw || onZSw);

    let roadKind;
    let roadAxis;
    let centerCoord;
    if (onXRoad && onZRoad) {
        roadKind = ROAD_WIDTH[xKind] >= ROAD_WIDTH[zKind] ? xKind : zKind;
        roadAxis = 'intersection';
        centerCoord = ROAD_WIDTH[xKind] >= ROAD_WIDTH[zKind] ? rx * BLOCK_SIZE : rz * BLOCK_SIZE;
    } else if (onXRoad) {
        roadKind = xKind;
        roadAxis = 'z';
        centerCoord = rx * BLOCK_SIZE;
    } else if (onZRoad) {
        roadKind = zKind;
        roadAxis = 'x';
        centerCoord = rz * BLOCK_SIZE;
    } else if (onXSw && (!onZSw || dx <= dz)) {
        roadKind = xKind;
        roadAxis = 'z';
        centerCoord = rx * BLOCK_SIZE;
    } else if (onZSw) {
        roadKind = zKind;
        roadAxis = 'x';
        centerCoord = rz * BLOCK_SIZE;
    } else if (dx <= dz) {
        roadKind = xKind;
        roadAxis = 'z';
        centerCoord = rx * BLOCK_SIZE;
    } else {
        roadKind = zKind;
        roadAxis = 'x';
        centerCoord = rz * BLOCK_SIZE;
    }

    return {
        onRoad,
        onSidewalk,
        inRiver: rc.inWater,
        roadKind,
        roadAxis,
        centerCoord,
        speedLimit: SPEED_LIMIT[roadKind],
    };
}

export function isRoad(x, z) {
    return sampleRoad(x, z).onRoad;
}

function edgeInset(lineIdx, blockPerpIdx) {
    const k0 = roadKindForLine(lineIdx, blockPerpIdx);
    const k1 = roadKindForLine(lineIdx, blockPerpIdx + 1);
    const w0 = ROAD_WIDTH[k0] * 0.5 + SIDEWALK_WIDTH[k0];
    const w1 = ROAD_WIDTH[k1] * 0.5 + SIDEWALK_WIDTH[k1];
    return Math.max(w0, w1) + 3.5;
}

function parcelWorldRotation(entrySide, pu, pv) {
    if (entrySide === 'S' || entrySide === 'N') {
        const [tx, tz] = gridTangentU(pu, pv);
        const baseRot = Math.atan2(-tz, tx);
        return entrySide === 'S' ? baseRot : Math.PI + baseRot;
    }
    const [tx, tz] = gridTangentV(pu, pv);
    const delta = Math.atan2(tx, tz);
    return (entrySide === 'E' ? Math.PI * 0.5 : -Math.PI * 0.5) + delta;
}

function parcelPadTilt(pu, pv) {
    const [tx, tz] = gridTangentU(pu, pv);
    return Math.atan2(-tz, tx);
}

function nearestEntrySide(cx, cz, xMin, xMax, zMin, zMax) {
    const dW = cx - xMin;
    const dE = xMax - cx;
    const dN = cz - zMin;
    const dS = zMax - cz;
    let best = 'S';
    let bestD = dS;
    if (dN < bestD) { bestD = dN; best = 'N'; }
    if (dW < bestD) { bestD = dW; best = 'W'; }
    if (dE < bestD) { best = 'E'; }
    return best;
}

export function getParcelsInBlock(bx, bz) {
    const key = ((bx + 2048) * 4096) + (bz + 2048);
    const cached = blockParcelCache.get(key);
    if (cached) return cached;

    if (bx < BLOCK_MIN || bx > BLOCK_MAX || bz < BLOCK_MIN || bz > BLOCK_MAX) {
        return [];
    }

    const district = sampleBlockDistrict(bx, bz);
    const x0Block = bx * BLOCK_SIZE;
    const z0Block = bz * BLOCK_SIZE;
    const uMin = x0Block + edgeInset(bx, bz);
    const uMax = x0Block + BLOCK_SIZE - edgeInset(bx + 1, bz);
    const vMin = z0Block + edgeInset(bz, bx);
    const vMax = z0Block + BLOCK_SIZE - edgeInset(bz + 1, bx);
    const spanX = Math.max(10, uMax - uMin);
    const spanZ = Math.max(10, vMax - vMin);

    const parcels = [];
    if (district.zone === 'park') {
        const pu = 0.5 * (uMin + uMax);
        const pv = 0.5 * (vMin + vMax);
        const [cx, cz] = gridToWorld(pu, pv);
        const padY = roadTerrainHeight(cx, cz);
        parcels.push({
            id: `b_${bx}_${bz}_0`,
            pu, pv,
            x0: cx - spanX * 0.5, z0: cz - spanZ * 0.5,
            x1: cx + spanX * 0.5, z1: cz + spanZ * 0.5,
            cx, cz,
            rot: parcelWorldRotation('S', pu, pv),
            padRot: parcelPadTilt(pu, pv),
            kind: 'park',
            width: spanX,
            depth: spanZ,
            floors: 0,
            floorHeight: 0,
            seed: Math.floor(hash2f(bx, bz, 11) * 0x7fffffff),
            entrySide: 'S',
            padHalfW: 0,
            padHalfD: 0,
            padSkirt: 0,
            padY,
        });
    } else {
        let cols = 2;
        let rows = 2;
        if (district.zone === 'downtown') {
            const pick = hash2f(bx, bz, 17);
            if (pick < 0.25) { cols = 1; rows = 2; }
            else if (pick < 0.50) { cols = 2; rows = 1; }
            else { cols = 2; rows = 2; }
        } else if (district.zone === 'commercial') {
            const pick = hash2f(bx, bz, 23);
            if (pick < 0.45) { cols = 3; rows = 2; }
            else if (pick < 0.70) { cols = 2; rows = 3; }
            else { cols = 2; rows = 2; }
        } else {
            const pick = hash2f(bx, bz, 31);
            cols = pick < 0.55 ? 4 : 3;
            rows = 2;
        }

        const gap = district.zone === 'suburb' ? 3.5 : 2.5;
        const cellW = (spanX - gap * (cols - 1)) / cols;
        const cellD = (spanZ - gap * (rows - 1)) / rows;
        const distR = Math.hypot((bx + 0.5) * BLOCK_SIZE, (bz + 0.5) * BLOCK_SIZE);
        const isCoreZero = (bx >= -1 && bx <= 0 && bz >= -1 && bz <= 0);

        let idx = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const px0 = uMin + c * (cellW + gap);
                const pz0 = vMin + r * (cellD + gap);
                const px1 = px0 + cellW;
                const pz1 = pz0 + cellD;
                let pu = 0.5 * (px0 + px1);
                let pv = 0.5 * (pz0 + pz1);

                const hSeed = hash2f(bx * 8 + c, bz * 8 + r, 41);
                const hSeed2 = hash2f(bx * 8 + c, bz * 8 + r, 67);
                const hSeed3 = hash2f(bx * 8 + c, bz * 8 + r, 89);

                // Keep river promenade clear of buildings
                const nearRiver = Math.abs(pu - riverCenterU(pv)) < (RIVER_HALF_W + 26.0);
                // Occasional urban/commercial pocket park plazas outside block (0,0) center
                const isPocketPark = !nearRiver && !isCoreZero && district.zone !== 'suburb' && hSeed3 < 0.08;
                if (nearRiver || isPocketPark) {
                    const [cx, cz] = gridToWorld(pu, pv);
                    parcels.push({
                        id: `b_${bx}_${bz}_${idx++}`,
                        pu, pv,
                        x0: cx - cellW * 0.5, z0: cz - cellD * 0.5,
                        x1: cx + cellW * 0.5, z1: cz + cellD * 0.5,
                        cx, cz,
                        rot: parcelWorldRotation('S', pu, pv),
                        padRot: parcelPadTilt(pu, pv),
                        kind: 'park',
                        width: cellW,
                        depth: cellD,
                        floors: 0,
                        floorHeight: 0,
                        seed: Math.floor(hSeed * 0x7fffffff),
                        entrySide: 'S',
                        padHalfW: 0,
                        padHalfD: 0,
                        padSkirt: 0,
                        padY: roadTerrainHeight(cx, cz),
                    });
                    continue;
                }

                const entrySide = nearestEntrySide(pu, pv, uMin, uMax, vMin, vMax);
                let kind;
                let floors;
                let floorHeight;
                if (district.zone === 'downtown') {
                    const coreBoost = 1 - clamp(distR / 1450, 0, 1);
                    if (hSeed < 0.14 && coreBoost < 0.65) {
                        kind = 'business';
                        floors = 4 + Math.floor(hSeed2 * 5);
                        floorHeight = 3.6;
                    } else {
                        kind = 'skyscraper';
                        floors = Math.round(12 + (0.45 * coreBoost + 0.55 * hSeed2) * 32);
                        floorHeight = 3.8;
                    }
                } else if (district.zone === 'commercial') {
                    if (hSeed < 0.18 && distR < 1950) {
                        kind = 'skyscraper';
                        floors = 10 + Math.floor(hSeed2 * 8);
                        floorHeight = 3.8;
                    } else {
                        kind = 'business';
                        floors = 2 + Math.floor(hSeed2 * 5);
                        floorHeight = 3.6;
                    }
                } else {
                    if (hSeed < 0.06 && ((bx & 3) === 0 || (bz & 3) === 0)) {
                        kind = 'business';
                        floors = 2 + Math.floor(hSeed2 * 2);
                        floorHeight = 3.6;
                    } else {
                        kind = 'home';
                        floors = 1 + (hSeed2 > 0.42 ? 1 : 0);
                        floorHeight = 3.2;
                    }
                }

                // Organic setback stagger so buildings vary in distance from streets
                if (kind === 'home') {
                    const setback = (hSeed3 - 0.35) * 4.0;
                    if (entrySide === 'S') pv -= setback;
                    else if (entrySide === 'N') pv += setback;
                    else if (entrySide === 'E') pu -= setback;
                    else pu += setback;
                } else if (!isCoreZero) {
                    const shift = (hSeed3 - 0.5) * 2.2;
                    if (entrySide === 'S' || entrySide === 'N') pv += shift;
                    else pu += shift;
                }

                const [cx, cz] = gridToWorld(pu, pv);
                const rot = parcelWorldRotation(entrySide, pu, pv);
                const padRot = parcelPadTilt(pu, pv);
                const padHalfW = kind === 'home' ? Math.max(4.5, cellW * 0.36) : Math.max(2.0, cellW * 0.5 - 0.5);
                const padHalfD = kind === 'home' ? Math.max(4.5, cellD * 0.36) : Math.max(2.0, cellD * 0.5 - 0.5);
                const padY = roadTerrainHeight(cx, cz) + 0.05;

                parcels.push({
                    id: `b_${bx}_${bz}_${idx++}`,
                    pu, pv,
                    x0: cx - cellW * 0.5, z0: cz - cellD * 0.5,
                    x1: cx + cellW * 0.5, z1: cz + cellD * 0.5,
                    cx, cz,
                    rot,
                    padRot,
                    kind,
                    width: cellW,
                    depth: cellD,
                    floors,
                    floorHeight,
                    seed: Math.floor(hSeed * 0x7fffffff),
                    entrySide,
                    padHalfW,
                    padHalfD,
                    padSkirt: 3.0,
                    padY,
                });
            }
        }
    }

    if (blockParcelCache.size >= MAX_BLOCK_CACHE) {
        const firstKey = blockParcelCache.keys().next().value;
        blockParcelCache.delete(firstKey);
    }
    blockParcelCache.set(key, parcels);
    return parcels;
}

export function sampleGroundHeight(x, z) {
    let h = roadTerrainHeight(x, z);
    const [bx0, bz0] = worldToBlock(x, z);
    for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
        for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
            const parcels = getParcelsInBlock(bx, bz);
            for (let i = 0; i < parcels.length; i++) {
                const p = parcels[i];
                if (p.padSkirt <= 0) continue;
                const dxp = x - p.cx;
                const dzp = z - p.cz;
                const pr = p.padRot || 0;
                const cr = Math.cos(pr);
                const sr = Math.sin(pr);
                const lx = cr * dxp - sr * dzp;
                const lz = sr * dxp + cr * dzp;
                const qx = Math.max(0, Math.abs(lx) - p.padHalfW);
                const qz = Math.max(0, Math.abs(lz) - p.padHalfD);
                const dist = Math.hypot(qx, qz);
                if (dist < p.padSkirt) {
                    const w = 1.0 - smoothstep(0.0, p.padSkirt, dist);
                    h += (p.padY - h) * w;
                }
            }
        }
    }
    return h;
}
