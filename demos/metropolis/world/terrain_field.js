// Deterministic natural terrain & river-first hydrology field for Metropolis.
// All math matches shaders/terrain_produce.bk bit-for-bit so streamed GPU tiles,
// roads, bridges and building plinths align within millimetres.

export const WORLD_HALF = 5632; // 11,264 m x 11,264 m = 126.9 km^2
export const ROOT_SIZE = 2816;  // 4 x 4 roots of 2816 m = 11,264 m
export const SECTOR_SIZE = 512;
export const WATER_Y = 0.0;
export const RIVER_BED_Y = -6.5;

export function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function hash2i(ix, iz, seed) {
    let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0;
    h = Math.imul((h ^ (h >>> 15)) >>> 0, 0x2c1b3c6d) >>> 0;
    h = Math.imul((h ^ (h >>> 12)) >>> 0, 0x297a2d39) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return (h >>> 8) * (1.0 / 16777216.0);
}

function valueNoise(x, z, cellSize, seed) {
    const gx = x / cellSize, gz = z / cellSize;
    const flx = Math.floor(gx), flz = Math.floor(gz);
    const ix = flx | 0, iz = flz | 0;
    const fx = gx - flx, fz = gz - flz;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = hash2i(ix, iz, seed);
    const b = hash2i(ix + 1, iz, seed);
    const c = hash2i(ix, iz + 1, seed);
    const d = hash2i(ix + 1, iz + 1, seed);
    return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
}

/** Smooth winding river centerline X as a function of Z. */
export function riverCenterX(z) {
    return 340 * Math.sin(z / 1150) + 190 * Math.cos(z / 580) - 80 * Math.sin(z / 2400);
}

/** River half-width widening gently from north headwaters toward southern harbor. */
export function riverHalfWidth(z) {
    return 58 + 26 * smoothstep(200, 3200, z) + 10 * Math.sin(z / 720);
}

/** Signed horizontal distance from water edge (< 0 inside channel, >= 0 on dry land). */
export function riverSignedDist(x, z) {
    return Math.abs(x - riverCenterX(z)) - riverHalfWidth(z);
}

/** Continuous natural valley + hillside terrain elevation in metres (exact GPU twin). */
export function terrainHeight(x, z) {
    const nBig = valueNoise(x, z, 1100, 11);
    const nMed = valueNoise(x, z, 420, 23);
    const nFine = valueNoise(x, z, 150, 37);
    const nMicro = valueNoise(x, z, 52, 53);

    const r = Math.hypot(x, z);
    const rd = riverSignedDist(x, z);

    // Gentle valley floor rolling +5.5..+14m near city cores, rising into +40..+145m foothills & ridges.
    const valleyFloor = 5.5 + 5.0 * nBig + 2.4 * nMed + 1.0 * nFine + 0.3 * nMicro;
    const outerRise = smoothstep(3300, 5800, r);
    const ridgeNoise = Math.abs(valueNoise(x + 600, z - 400, 1400, 71) - 0.48) * 2.0;
    const foothills = outerRise * (28.0 + 52.0 * nBig + 30.0 * ridgeNoise + 12.0 * nMed + 3.5 * nFine);
    const neBoost = (1.0 - smoothstep(450, 2600, Math.hypot(x - 4400, z + 4200))) * 34.0;
    const nwBoost = (1.0 - smoothstep(450, 2700, Math.hypot(x + 4500, z + 4100))) * 38.0;
    const innerHills = 18.0 * smoothstep(0.5, 0.9, valueNoise(x + 211, z - 97, 1700, 83));
    const upland = valleyFloor + foothills + neBoost + nwBoost + innerHills;

    // Gentle flattening near immediate downtown riverbank terrace so piers/embankments seat naturally
    const riverValley = 4.6 + 1.8 * nMed + 0.6 * nFine;
    const terraceBlend = smoothstep(-5, 240, rd);
    const dryElev = riverValley + (upland - riverValley) * terraceBlend;

    // Carve river channel smoothly from bank (+4m) down to RIVER_BED_Y (-6.5m)
    const bankSlope = smoothstep(-10, 42, rd);
    return RIVER_BED_Y + (dryElev - RIVER_BED_Y) * bankSlope;
}

export function terrainGradient(x, z, eps = 2.0) {
    const hx0 = terrainHeight(x - eps, z);
    const hx1 = terrainHeight(x + eps, z);
    const hz0 = terrainHeight(x, z - eps);
    const hz1 = terrainHeight(x, z + eps);
    return [(hx1 - hx0) / (2 * eps), (hz1 - hz0) / (2 * eps)];
}

/** Macro district classification driven by natural valley & riverfront geography. */
export function districtAt(x, z) {
    const rd = riverSignedDist(x, z);
    if (rd < 0) return 'river';
    if (rd < 24 && Math.abs(z) < 2200) return 'park';
    const dDowntown = Math.hypot(x - (riverCenterX(0) - 520), z - 40);
    if (dDowntown < 760) return 'downtown';
    const dOldtown = Math.hypot(x - (riverCenterX(180) + 560), z - 180);
    if (dOldtown < 720) return 'oldtown';
    const dMidtown = Math.hypot(x - (riverCenterX(-1450) - 480), z + 1450);
    if (dMidtown < 640) return 'midtown';
    const dHarbor = Math.hypot(x - (riverCenterX(1550) - 340), z - 1550);
    if (dHarbor < 680) return 'harbor';
    const [gx, gz] = terrainGradient(x, z, 6.0);
    const slope = Math.hypot(gx, gz);
    const r = Math.hypot(x, z);
    if (r < 4600 && slope < 0.25 && terrainHeight(x, z) < 75) return 'suburb';
    return 'hills';
}

/** Band-limited macro landcover weights [urban, parkGrass, forest, rockSand] matching GPU shader. */
export function landcoverAt(x, z) {
    const rd = riverSignedDist(x, z);
    const h = terrainHeight(x, z);
    const r = Math.hypot(x, z);
    const n = valueNoise(x, z, 280, 97);

    const bankSand = 1.0 - smoothstep(-2, 16, rd);
    const slopeRock = smoothstep(52, 92, h);
    const rockSand = Math.max(bankSand, slopeRock * 0.78);

    const westDist = Math.hypot(x - (-460), z - 50);
    const eastDist = Math.hypot(x - 620, z - 160);
    const northDist = Math.hypot(x - (-420), z + 1450);
    const harborDist = Math.hypot(x - (-300), z - 1550);
    const urbanCore = Math.max(
        1.0 - smoothstep(420, 1250, westDist),
        1.0 - smoothstep(380, 1120, eastDist),
        1.0 - smoothstep(360, 960, northDist),
        1.0 - smoothstep(360, 980, harborDist),
    ) * smoothstep(8, 36, rd);

    const subDensity = (1.0 - smoothstep(1400, 4400, r)) * smoothstep(20, 60, rd) * (1.0 - smoothstep(38, 72, h));
    const urban = Math.min(1, urbanCore * 0.9 + subDensity * 0.42);
    const forest = Math.max(0, smoothstep(0.46, 0.76, n + outerBias(r)) * (1.0 - urbanCore * 0.9) * smoothstep(14, 48, rd) * (1.0 - bankSand));
    const parkGrass = Math.max(0.05, 1.0 - Math.min(1, urban + forest + rockSand));
    const sum = urban + parkGrass + forest + rockSand || 1;
    return [urban / sum, parkGrass / sum, forest / sum, rockSand / sum];
}

function outerBias(r) {
    return smoothstep(1200, 3200, r) * 0.22;
}
