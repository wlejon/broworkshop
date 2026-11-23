// Seamless (strictly tile-periodic) procedural PBR material generator for
// architectural exteriors, streets, terrain, and interiors.
// Returns { albedo, normal, mr, averageColor } maps ready for bro.scene meshes.

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));
const fract = (x) => x - Math.floor(x);
const lerp = (a, b, t) => a + (b - a) * t;

const LUT_SRGB = new Float32Array(256).map((_, i) => {
    const c = i / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

function hash2Periodic(ix, iy, px, py, seed) {
    const x = ((ix % px) + px) % px;
    const y = ((iy % py) + py) % py;
    let h = ((x * 374761393) ^ (y * 668265263) ^ (seed * 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function periodicNoise(u, v, px, py, seed) {
    const gx = u * px, gy = v * py;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2Periodic(ix, iy, px, py, seed);
    const b = hash2Periodic(ix + 1, iy, px, py, seed);
    const c = hash2Periodic(ix, iy + 1, px, py, seed);
    const d = hash2Periodic(ix + 1, iy + 1, px, py, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

export function periodicFbm(u, v, px = 8, py = 8, octaves = 4, seed = 17) {
    let val = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) {
        val += amp * periodicNoise(u, v, px << o, py << o, seed + o * 31);
        norm += amp;
        amp *= 0.5;
    }
    return val / norm;
}

export function heightToNormalMap(hg, w, h, strength = 2.6) {
    const data = new Uint8Array(w * h * 4);
    const at = (x, y) => hg[((y % h + h) % h) * w + ((x % w + w) % w)];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
            const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
            const l = Math.hypot(-dx, -dy, 1) || 1;
            const o = (y * w + x) * 4;
            data[o] = clampByte(((-dx / l) * 0.5 + 0.5) * 255);
            data[o + 1] = clampByte(((-dy / l) * 0.5 + 0.5) * 255);
            data[o + 2] = clampByte(((1 / l) * 0.5 + 0.5) * 255);
            data[o + 3] = 255;
        }
    }
    return { width: w, height: h, data };
}

export function packMRMap(rg, metalGridOrScalar, w, h) {
    const data = new Uint8Array(w * h * 4);
    const isScalar = typeof metalGridOrScalar === 'number';
    for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        data[o] = 255;
        data[o + 1] = clampByte(Math.max(0.04, Math.min(1, rg[i])) * 255);
        data[o + 2] = clampByte(Math.max(0, Math.min(1, isScalar ? metalGridOrScalar : metalGridOrScalar[i])) * 255);
        data[o + 3] = 255;
    }
    return { width: w, height: h, data };
}

function finalizeMaterial(w, h, albedoData, hg, rg, mg, normalStrength = 2.4) {
    let sr = 0, sg = 0, sb = 0, mrSum = 0, mmSum = 0;
    const isScalarM = typeof mg === 'number';
    const N = w * h;
    for (let i = 0; i < N; i++) {
        const o = i * 4;
        sr += LUT_SRGB[albedoData[o]];
        sg += LUT_SRGB[albedoData[o + 1]];
        sb += LUT_SRGB[albedoData[o + 2]];
        mrSum += rg[i];
        mmSum += isScalarM ? mg : mg[i];
    }
    return {
        albedo: { width: w, height: h, data: albedoData },
        normal: heightToNormalMap(hg, w, h, normalStrength),
        mr: packMRMap(rg, mg, w, h),
        averageColor: [sr / N, sg / N, sb / N],
        averageRoughness: mrSum / N,
        averageMetallic: mmSum / N,
    };
}

function makeAsphalt(w, h) {
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const macro = periodicFbm(u, v, 6, 6, 3, 101);
        const grit = periodicFbm(u, v, 24, 24, 3, 203);
        const speck = periodicNoise(u, v, 48, 48, 307);
        const c = 44 + macro * 24 + (grit - 0.5) * 18 + (speck > 0.85 ? 16 : 0);
        hg[idx] = 0.55 * grit + 0.25 * macro + 0.2 * speck;
        rg[idx] = 0.76 + (1 - grit) * 0.18 - macro * 0.08;
        alb[o] = clampByte(c); alb[o + 1] = clampByte(c * 1.01); alb[o + 2] = clampByte(c * 1.04); alb[o + 3] = 255;
    }
    return finalizeMaterial(w, h, alb, hg, rg, 0, 2.8);
}

function makeConcrete(w, h, baseTone = [178, 174, 166], slabs = 4) {
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const n = periodicFbm(u, v, 8, 8, 4, 411);
        const fine = periodicFbm(u, v, 24, 24, 2, 419);
        const fu = fract(u * slabs), fv = fract(v * slabs);
        const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
        const seam = edge < 0.035 ? 1 : 0;
        const slabId = hash2Periodic(Math.floor(u * slabs), Math.floor(v * slabs), slabs, slabs, 433);
        const tone = (0.88 + slabId * 0.08 + n * 0.14 + fine * 0.06) * (seam ? 0.74 : 1);
        hg[idx] = seam ? 0.15 : 0.45 + 0.35 * n + 0.2 * fine;
        rg[idx] = seam ? 0.94 : 0.72 + (1 - n) * 0.18;
        alb[o] = clampByte(baseTone[0] * tone);
        alb[o + 1] = clampByte(baseTone[1] * tone);
        alb[o + 2] = clampByte(baseTone[2] * tone);
        alb[o + 3] = 255;
    }
    return finalizeMaterial(w, h, alb, hg, rg, 0, 2.6);
}

function makeBrick(w, h, tintRgb = [156, 74, 56], seed = 501) {
    const cols = 4, rows = 8;
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const rIdx = Math.floor(v * rows);
        const su = fract(u + (rIdx & 1) * (0.5 / cols));
        const cIdx = Math.floor(su * cols);
        const lu = fract(su * cols), lv = fract(v * rows);
        const mortar = lu < 0.07 || lu > 0.93 || lv < 0.12 || lv > 0.88;
        const tex = periodicFbm(u, v, 12, 12, 3, seed);
        const bVar = hash2Periodic(cIdx, rIdx, cols, rows, seed + 19);
        if (mortar) {
            hg[idx] = 0.15 + tex * 0.1;
            rg[idx] = 0.94;
            const mc = 148 + tex * 26;
            alb[o] = clampByte(mc); alb[o + 1] = clampByte(mc * 0.97); alb[o + 2] = clampByte(mc * 0.91); alb[o + 3] = 255;
        } else {
            const bevel = Math.min(lu - 0.07, 0.93 - lu, lv - 0.12, 0.88 - lv);
            hg[idx] = 0.55 + Math.min(0.25, bevel * 2.5) + tex * 0.2;
            rg[idx] = 0.78 + (1 - tex) * 0.15;
            const s = 0.78 + bVar * 0.34 + (tex - 0.5) * 0.22;
            alb[o] = clampByte(tintRgb[0] * s);
            alb[o + 1] = clampByte(tintRgb[1] * s);
            alb[o + 2] = clampByte(tintRgb[2] * s);
            alb[o + 3] = 255;
        }
    }
    return finalizeMaterial(w, h, alb, hg, rg, 0, 3.2);
}

function makeLimestone(w, h) {
    return makeConcrete(w, h, [212, 202, 182], 3);
}

function makeCurtainGlass(w, h) {
    const cols = 4, rows = 2;
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h);
    const rg = new Float32Array(w * h), mg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const fu = fract(u * cols), fv = fract(v * rows);
        const mullion = fu < 0.08 || fu > 0.92 || fv < 0.12 || fv > 0.88;
        const subtle = periodicFbm(u, v, 8, 8, 2, 709);
        if (mullion) {
            hg[idx] = 0.85; rg[idx] = 0.28; mg[idx] = 0.85;
            const mc = 68 + subtle * 16;
            alb[o] = clampByte(mc); alb[o + 1] = clampByte(mc * 1.03); alb[o + 2] = clampByte(mc * 1.08); alb[o + 3] = 255;
        } else {
            const paneVar = hash2Periodic(Math.floor(u * cols), Math.floor(v * rows), cols, rows, 733);
            const band = 0.85 + 0.15 * Math.sin((fv - 0.12) * Math.PI / 0.76);
            hg[idx] = 0.25; rg[idx] = 0.09 + paneVar * 0.04; mg[idx] = 0.12;
            const s = (0.72 + paneVar * 0.28) * band;
            alb[o] = clampByte(34 * s); alb[o + 1] = clampByte(56 * s); alb[o + 2] = clampByte(74 * s); alb[o + 3] = 255;
        }
    }
    return finalizeMaterial(w, h, alb, hg, rg, mg, 2.2);
}

function makeStucco(w, h, tintRgb = [224, 214, 198]) {
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const macro = periodicFbm(u, v, 6, 6, 3, 809);
        const grain = periodicFbm(u, v, 24, 24, 2, 821);
        hg[idx] = 0.45 * macro + 0.55 * grain;
        rg[idx] = 0.82 + (1 - grain) * 0.12;
        const s = 0.90 + macro * 0.14 + (grain - 0.5) * 0.06;
        alb[o] = clampByte(tintRgb[0] * s); alb[o + 1] = clampByte(tintRgb[1] * s); alb[o + 2] = clampByte(tintRgb[2] * s); alb[o + 3] = 255;
    }
    return finalizeMaterial(w, h, alb, hg, rg, 0, 1.8);
}

function makePlanks(w, h, baseRgb = [154, 114, 76], cols = 1, rows = 8, roughBase = 0.45, seed = 901) {
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const rIdx = Math.floor(v * rows);
        const cIdx = Math.floor(u * cols);
        const lv = fract(v * rows), lu = fract(u * cols);
        const seam = Math.min(lv, 1 - lv) < 0.045 || (cols > 1 && Math.min(lu, 1 - lu) < 0.03);
        const grain = periodicFbm(u, v, 4, 24, 3, seed);
        const pVar = hash2Periodic(cIdx, rIdx, cols, rows, seed + 17);
        const bevel = cols === 1 ? (0.3 + 0.7 * lv) : (seam ? 0.1 : 0.7 + 0.25 * grain);
        hg[idx] = seam ? 0.12 : bevel;
        rg[idx] = seam ? 0.88 : roughBase + (1 - grain) * 0.18;
        const tone = (seam ? 0.62 : (0.82 + pVar * 0.24 + (grain - 0.5) * 0.16));
        alb[o] = clampByte(baseRgb[0] * tone); alb[o + 1] = clampByte(baseRgb[1] * tone); alb[o + 2] = clampByte(baseRgb[2] * tone); alb[o + 3] = 255;
    }
    return finalizeMaterial(w, h, alb, hg, rg, 0, 2.4);
}

function makeShingle(w, h) {
    const cols = 6, rows = 8;
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const rIdx = Math.floor(v * rows);
        const su = fract(u + (rIdx & 1) * (0.5 / cols));
        const cIdx = Math.floor(su * cols);
        const lu = fract(su * cols), lv = fract(v * rows);
        const gap = Math.min(lv, 1 - lv) < 0.06 || Math.min(lu, 1 - lu) < 0.03;
        const grit = periodicFbm(u, v, 24, 24, 2, 1009);
        const pVar = hash2Periodic(cIdx, rIdx, cols, rows, 1013);
        hg[idx] = gap ? 0.15 : 0.45 + lv * 0.4 + grit * 0.15;
        rg[idx] = 0.84 + (1 - grit) * 0.12;
        const s = (gap ? 0.55 : (0.8 + pVar * 0.24)) * (0.9 + grit * 0.2);
        alb[o] = clampByte(72 * s); alb[o + 1] = clampByte(76 * s); alb[o + 2] = clampByte(84 * s); alb[o + 3] = 255;
    }
    return finalizeMaterial(w, h, alb, hg, rg, 0, 2.8);
}

function makeBrushedMetal(w, h) {
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const streak = periodicFbm(u, v, 4, 32, 3, 1103);
        const fine = periodicFbm(u, v, 16, 16, 2, 1109);
        hg[idx] = 0.6 * streak + 0.4 * fine;
        rg[idx] = 0.26 + (1 - streak) * 0.16;
        const c = 158 + streak * 32 + fine * 12;
        alb[o] = clampByte(c * 0.96); alb[o + 1] = clampByte(c * 0.98); alb[o + 2] = clampByte(c * 1.02); alb[o + 3] = 255;
    }
    return finalizeMaterial(w, h, alb, hg, rg, 0.88, 1.4);
}

function makeGrass(w, h) {
    const alb = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h, idx = y * w + x, o = idx * 4;
        const patch = periodicFbm(u, v, 6, 6, 3, 1201);
        const blades = periodicFbm(u, v, 28, 28, 3, 1213);
        hg[idx] = 0.4 * patch + 0.6 * blades;
        rg[idx] = 0.82 + (1 - blades) * 0.14;
        const s = 0.78 + patch * 0.25 + (blades - 0.5) * 0.24;
        alb[o] = clampByte(72 * s); alb[o + 1] = clampByte(116 * s); alb[o + 2] = clampByte(50 * s); alb[o + 3] = 255;
    }
    return finalizeMaterial(w, h, alb, hg, rg, 0, 2.2);
}

export function createUrbanMaterialLibrary(size = 256) {
    const w = size, h = size;
    return {
        asphalt: makeAsphalt(w, h),
        concrete: makeConcrete(w, h),
        limestone: makeLimestone(w, h),
        brickRed: makeBrick(w, h, [154, 72, 54], 501),
        brickTan: makeBrick(w, h, [182, 148, 108], 601),
        curtainGlass: makeCurtainGlass(w, h),
        stucco: makeStucco(w, h, [226, 216, 198]),
        woodSiding: makePlanks(w, h, [188, 178, 158], 1, 10, 0.72, 911),
        woodFloor: makePlanks(w, h, [156, 114, 72], 4, 8, 0.42, 929),
        roofShingle: makeShingle(w, h),
        brushedMetal: makeBrushedMetal(w, h),
        lobbyTile: makeConcrete(w, h, [206, 200, 192], 6),
        grass: makeGrass(w, h),
        riverStone: makeBrick(w, h, [118, 114, 108], 701),
    };
}

export function materialProps(mat, tint = [1, 1, 1]) {
    return {
        texture: mat.albedo,
        normalTexture: mat.normal,
        metallicRoughnessTexture: mat.mr,
        color: tint,
        roughness: 1.0,
        metallic: mat.averageMetallic > 0.01 ? 1.0 : 0.0,
    };
}
