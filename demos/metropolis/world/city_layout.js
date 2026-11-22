// Deterministic 150.99 km^2 city & suburban layout, road network, parcels, and terrain height.
// Math in hash2f, valueNoise2D, baseTerrainHeight, and roadTerrainHeight mirrors
// shaders/terrain_produce.bk bit-for-bit so CPU queries and GPU tiles agree within < 2 mm.

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
    if (hash2f(bx, bz, 97) < 0.09) {
        return { zone: 'park', zoneId: 0, density: 0.05, seed: ((bx & 0xffff) << 16) | (bz & 0xffff) };
    }
    const density = 0.30 + 0.25 * hash2f(bx, bz, 53);
    return { zone: 'suburb', zoneId: 1, density, seed: ((bx & 0xffff) << 16) | (bz & 0xffff) };
}

export function sampleDistrict(x, z) {
    const bx = Math.floor(x / BLOCK_SIZE);
    const bz = Math.floor(z / BLOCK_SIZE);
    return sampleBlockDistrict(bx, bz);
}

export function roadKindForLine(lineIndex, perpLineIndex) {
    if ((lineIndex & 3) === 0) return 'avenue';
    const lx = lineIndex * BLOCK_SIZE;
    const lz = perpLineIndex * BLOCK_SIZE;
    return (lx * lx + lz * lz) < URBAN_RING_R2 ? 'street' : 'suburban';
}

export function baseTerrainHeight(x, z) {
    const r = Math.hypot(x, z);
    const urbanFlat = 1.0 - smoothstep(950, 1550, r);
    const hillAmp = (1.0 - urbanFlat) * (10.0 + 28.0 * smoothstep(2200, 5600, r));
    const n1 = valueNoise2D(x, z, 512.0, 101) * 2.0 - 1.0;
    const n2 = valueNoise2D(x, z, 256.0, 202) * 2.0 - 1.0;
    const n3 = valueNoise2D(x, z, 128.0, 303) * 2.0 - 1.0;
    const ridge = (1.0 - urbanFlat) * 6.0 * smoothstep(2600, 5800, r);
    const h = DOWNTOWN_DATUM_Y + hillAmp * (0.62 * n1 + 0.28 * n2 + 0.10 * n3) + ridge;
    return clamp(h, -4.0, 58.0);
}

function snapCoord(coord, lineCenter, flatHalf, skirt) {
    const d = coord - lineCenter;
    const ad = Math.abs(d);
    if (ad <= flatHalf) return lineCenter;
    if (ad >= flatHalf + skirt) return coord;
    return lineCenter + d * smoothstep(flatHalf, flatHalf + skirt, ad);
}

export function roadTerrainHeight(x, z) {
    const rx = Math.floor(x / BLOCK_SIZE + 0.5);
    const rz = Math.floor(z / BLOCK_SIZE + 0.5);
    const xKind = roadKindForLine(rx, rz);
    const zKind = roadKindForLine(rz, rx);
    const halfX = ROAD_WIDTH[xKind] * 0.5;
    const halfZ = ROAD_WIDTH[zKind] * 0.5;
    const flatHalfX = halfX + SIDEWALK_WIDTH[xKind] + 0.5;
    const flatHalfZ = halfZ + SIDEWALK_WIDTH[zKind] + 0.5;

    const sx = snapCoord(x, rx * BLOCK_SIZE, flatHalfX, ROAD_SKIRT);
    const sz = snapCoord(z, rz * BLOCK_SIZE, flatHalfZ, ROAD_SKIRT);
    const dx = Math.abs(x - rx * BLOCK_SIZE);
    const dz = Math.abs(z - rz * BLOCK_SIZE);
    const curbX = smoothstep(halfX - 0.15, halfX + 0.15, dx);
    const curbZ = smoothstep(halfZ - 0.15, halfZ + 0.15, dz);
    return baseTerrainHeight(sx, sz) + CURB_HEIGHT * Math.min(curbX, curbZ);
}

export function sampleRoad(x, z) {
    const rx = Math.floor(x / BLOCK_SIZE + 0.5);
    const rz = Math.floor(z / BLOCK_SIZE + 0.5);
    const xKind = roadKindForLine(rx, rz);
    const zKind = roadKindForLine(rz, rx);
    const halfX = ROAD_WIDTH[xKind] * 0.5;
    const halfZ = ROAD_WIDTH[zKind] * 0.5;
    const swX = halfX + SIDEWALK_WIDTH[xKind];
    const swZ = halfZ + SIDEWALK_WIDTH[zKind];
    const dx = Math.abs(x - rx * BLOCK_SIZE);
    const dz = Math.abs(z - rz * BLOCK_SIZE);

    const onXRoad = dx <= halfX;
    const onZRoad = dz <= halfZ;
    const onRoad = onXRoad || onZRoad;
    const onXSw = dx <= swX;
    const onZSw = dz <= swZ;
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

function entryRotation(side) {
    if (side === 'S') return 0;
    if (side === 'N') return Math.PI;
    if (side === 'E') return Math.PI * 0.5;
    return -Math.PI * 0.5;
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
    const xMin = x0Block + edgeInset(bx, bz);
    const xMax = x0Block + BLOCK_SIZE - edgeInset(bx + 1, bz);
    const zMin = z0Block + edgeInset(bz, bx);
    const zMax = z0Block + BLOCK_SIZE - edgeInset(bz + 1, bx);
    const spanX = Math.max(10, xMax - xMin);
    const spanZ = Math.max(10, zMax - zMin);

    const parcels = [];
    if (district.zone === 'park') {
        const cx = 0.5 * (xMin + xMax);
        const cz = 0.5 * (zMin + zMax);
        const padY = roadTerrainHeight(cx, cz);
        parcels.push({
            id: `b_${bx}_${bz}_0`,
            x0: xMin, z0: zMin, x1: xMax, z1: zMax,
            cx, cz,
            rot: 0,
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

        const gap = district.zone === 'suburb' ? 3.0 : 2.0;
        const cellW = (spanX - gap * (cols - 1)) / cols;
        const cellD = (spanZ - gap * (rows - 1)) / rows;
        const distR = Math.hypot((bx + 0.5) * BLOCK_SIZE, (bz + 0.5) * BLOCK_SIZE);

        let idx = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const px0 = xMin + c * (cellW + gap);
                const pz0 = zMin + r * (cellD + gap);
                const px1 = px0 + cellW;
                const pz1 = pz0 + cellD;
                const cx = 0.5 * (px0 + px1);
                const cz = 0.5 * (pz0 + pz1);
                const hSeed = hash2f(bx * 8 + c, bz * 8 + r, 41);
                const hSeed2 = hash2f(bx * 8 + c, bz * 8 + r, 67);

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

                const entrySide = nearestEntrySide(cx, cz, xMin, xMax, zMin, zMax);
                const padInset = kind === 'home' ? 2.5 : 0.5;
                const padHalfW = Math.max(2.0, cellW * 0.5 - padInset);
                const padHalfD = Math.max(2.0, cellD * 0.5 - padInset);
                const padY = roadTerrainHeight(cx, cz) + 0.05;

                parcels.push({
                    id: `b_${bx}_${bz}_${idx++}`,
                    x0: px0, z0: pz0, x1: px1, z1: pz1,
                    cx, cz,
                    rot: entryRotation(entrySide),
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
    const bx = Math.floor(x / BLOCK_SIZE);
    const bz = Math.floor(z / BLOCK_SIZE);
    const parcels = getParcelsInBlock(bx, bz);
    for (let i = 0; i < parcels.length; i++) {
        const p = parcels[i];
        if (p.padSkirt <= 0) continue;
        const qx = Math.max(0, Math.abs(x - p.cx) - p.padHalfW);
        const qz = Math.max(0, Math.abs(z - p.cz) - p.padHalfD);
        const dist = Math.hypot(qx, qz);
        if (dist < p.padSkirt) {
            const w = 1.0 - smoothstep(0.0, p.padSkirt, dist);
            h += (p.padY - h) * w;
        }
    }
    return h;
}
