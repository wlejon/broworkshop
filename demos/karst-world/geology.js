// Continuous 3D karst geology & cave-network fields packed into 3 stacked SVDAG regions:
//   Region 0 (Solid) : canyon massif, monumental natural stone bridge, cliff overhangs
//   Region 1 (Carve) : 90 m river cavern, 48 m cathedral + sinkhole skylight, upper gallery
//   Region 2 (Solid) : cathedral island & limestone cave columns inside the carved cavern

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const mix = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};

function smin(a, b, k) {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return b + (a - b) * h - k * h * (1 - h);
}

function smax(a, b, k) {
    return -smin(-a, -b, k);
}

function hash3i(ix, iy, iz) {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function vnoise2(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash3i(ix, 0, iz), b = hash3i(ix + 1, 0, iz);
    const c = hash3i(ix, 0, iz + 1), d = hash3i(ix + 1, 0, iz + 1);
    return mix(mix(a, b, ux), mix(c, d, ux), uz) * 2 - 1;
}

function vnoise3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const n000 = hash3i(ix, iy, iz),     n100 = hash3i(ix + 1, iy, iz);
    const n010 = hash3i(ix, iy + 1, iz), n110 = hash3i(ix + 1, iy + 1, iz);
    const n001 = hash3i(ix, iy, iz + 1), n101 = hash3i(ix + 1, iy, iz + 1);
    const n011 = hash3i(ix, iy + 1, iz + 1), n111 = hash3i(ix + 1, iy + 1, iz + 1);
    const nx00 = mix(n000, n100, ux), nx10 = mix(n010, n110, ux);
    const nx01 = mix(n001, n101, ux), nx11 = mix(n011, n111, ux);
    return mix(mix(nx00, nx10, uy), mix(nx01, nx11, uy), uz) * 2 - 1;
}

function fbm2(x, z, octaves = 3) {
    let sum = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amp * vnoise2(x * freq, z * freq);
        freq *= 2.04;
        amp *= 0.5;
    }
    return sum;
}

function fbm3(x, y, z, octaves = 3) {
    let sum = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amp * vnoise3(x * freq, y * freq, z * freq);
        freq *= 2.03;
        amp *= 0.5;
    }
    return sum;
}

function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
    const pax = x - ax, pay = y - ay, paz = z - az;
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const denom = bax * bax + bay * bay + baz * baz;
    const h = denom > 1e-8 ? clamp((pax * bax + pay * bay + paz * baz) / denom, 0, 1) : 0;
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

function sdEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.hypot(px, py, pz);
    if (k0 < 1e-6) return -Math.min(rx, ry, rz);
    const k1 = Math.hypot(px / rx, py / ry, pz / rz);
    return k0 * (k0 - 1) / k1;
}

export const WORLD_CFG = {
    dagCenter: [0, 20, 0],
    dagOrigin: [-128, -108, -128],
    voxelSize: 1.0,
    maxDepth: 6,
    targetDepth: 5,
    macroCell: 8.0,

    heroMin: [-95, -6, -95],
    chunkGrid: 40,
    chunkGridY: 52,
    chunkCells: 39,
    chunkStride: 38,
    cellSize: 1.25,
    chunksPerSide: 4,

    waterY: 5.2,
};

export function riverCenterX(z) {
    return Math.sin(z * 0.028) * 12.0 - 2.0;
}

/** Deterministic highland heightfield used both for outer skirt and base massif relief. */
export function outerHeightAt(x, z) {
    const rx = riverCenterX(z);
    const dx = Math.abs(x - rx);

    // Canyon walls rising smoothly from riverbed (2.4 m) to surrounding limestone plateaus (42..47 m);
    // the northern massif across z in [-14, -84] seals the gorge so the river carves through rock.
    const massifMask = (1 - smoothstep(-18, -6, z)) * smoothstep(-94, -78, z);
    const plateauH = 42.0 + fbm2(x * 0.012 + 3.7, z * 0.012 - 1.9, 3) * 6.5;
    const riverBedH = 2.4 + fbm2(x * 0.05, z * 0.05, 2) * 0.9;
    const wallT = clamp(Math.max(smoothstep(15, 42, dx), massifMask), 0, 1);

    let h = mix(riverBedH, plateauH, wallT);

    // Sweeping West Cliff Amphitheater ridge around x in [-46, -16], z in [-4, +48]
    const westRidge = Math.exp(-Math.pow((x + 30) / 20, 2) - Math.pow((z - 22) / 30, 2));
    h += westRidge * 5.0;

    // Gentle east highland saddle so overview looks cleanly down into the gorge & bridge
    const overviewDip = Math.exp(-Math.pow((x - 52) / 28, 2) - Math.pow((z - 68) / 28, 2));
    h -= overviewDip * 9.0;

    // Outer mountain amphitheater ring outside the 190 m hero volume
    const r = Math.hypot(x, z);
    const rim = smoothstep(92, 420, r);
    const ridge = (1 - Math.abs(vnoise2(x * 0.0045 - 2.1, z * 0.0045 + 4.3)));
    h += rim * (14.0 + ridge * ridge * 78.0);
    return h;
}

/** Region 0 Solid Massif SDF (< 0 inside rock). Includes monumental bridge & overhanging cliffs. */
export function massifSdf(x, y, z) {
    // 3D overhanging displacement near the West Cliff Amphitheater (z in [-2, +52], x in [-48, -12])
    const ovBandY = Math.exp(-Math.pow((y - 31.5) / 10.5, 2));
    const ovMaskZ = Math.exp(-Math.pow((z - 22) / 26, 2));
    const ovMaskX = Math.exp(-Math.pow((x + 28) / 22, 2));
    const overhangShift = ovBandY * ovMaskZ * ovMaskX * 15.5;

    // Taper hero 3D relief smoothly toward +-84 m so the perimeter stitches cleanly to outerHeightAt
    const heroWeight = (1 - smoothstep(76, 90, Math.abs(x))) * (1 - smoothstep(76, 90, Math.abs(z)));
    const sx = x - overhangShift * heroWeight;

    const baseH = outerHeightAt(sx, z);
    let d = y - baseH;

    if (heroWeight > 0.001) {
        // Organic 3D crags weighted strictly onto steep cliff/canyon walls (keeps flat grassy plateaus pothole-free)
        const rx = riverCenterX(z);
        const wallDist = Math.abs(Math.abs(x - rx) - 24.0);
        const slopeCragMask = clamp(1.0 - smoothstep(10.0, 22.0, wallDist) * (y > 35.0 ? 1.0 : 0.2), 0.15, 1.0);
        const plateauFlatten = smoothstep(37.0, 42.0, y) * smoothstep(24.0, 36.0, Math.abs(x - rx));
        const cragAmp = mix(2.6, 0.35, plateauFlatten);
        d += fbm3(x * 0.042 + 1.3, y * 0.068, z * 0.042 - 2.7, 3) * cragAmp * heroWeight * slopeCragMask;

        // Monumental 40 m Natural Limestone Bridge spanning the canyon at z ~ +18
        const brDx = x - riverCenterX(18.0);
        const brDz = z - 18.0;
        const archRise = 33.5 - 0.0068 * brDx * brDx;
        const thick = 4.6 + 0.0042 * brDx * brDx;
        const slabY = Math.abs(y - archRise) - thick;
        const slabZ = Math.abs(brDz) - (7.6 + 0.005 * brDx * brDx);
        const slabX = Math.abs(brDx) - 38.0;
        const ox = Math.max(slabX, 0), oy = Math.max(slabY, 0), oz = Math.max(slabZ, 0);
        const rawBridge = Math.hypot(ox, oy, oz) + Math.min(Math.max(slabX, slabY, slabZ), 0) - 1.2
            + fbm3(x * 0.08, y * 0.08, z * 0.08, 2) * 1.1;
        d = smin(d, rawBridge, 4.5);

        // Deep natural riverside alcove hollow carved directly into the lower West Overhang wall
        const underHollow = sdCapsule(x, y, z, -24, 12.0, 4, -30, 12.5, 44, 11.2);
        d = smax(d, -underHollow, 3.8);
    }

    return d;
}

/** Region 1 Subterranean Carve SDF (< 0 inside carved cave voids). */
export function cavesSdf(x, y, z) {
    // 1. Grand River Cavern: soaring portal at (1, 11.5, -8) winding into Cathedral and out north
    const sMouth = sdCapsule(x, y, z, 2.0, 10.5, 2.0, -3.5, 12.5, -26.0, 11.5);
    const sBend1 = sdCapsule(x, y, z, -3.5, 12.5, -26.0, -8.0, 14.5, -46.0, 11.0);
    // 2. Vast Subterranean Cathedral Dome at (-8, 16.5, -48)
    const cathedral = sdEllipsoid(x, y, z, -8.0, 16.5, -48.0, 22.5, 15.0, 19.0);
    // 3. Karst Sinkhole Skylight piercing vertically from cathedral vault through mountain roof
    const skylight = sdCapsule(x, y, z, -8.0, 20.0, -48.0, -8.0, 56.0, -48.0, 9.5 + smoothstep(32, 48, y) * 3.0);
    // 4. North River Exit Passage curving out through north cliff at z ~ -92
    const sNorth1 = sdCapsule(x, y, z, -2.0, 12.0, -56.0, 7.0, 11.5, -75.0, 10.5);
    const sNorth2 = sdCapsule(x, y, z, 7.0, 11.5, -75.0, 13.0, 11.0, -96.0, 11.5);

    // 5. Upper West Cliff Gallery (~55 m): overhang portal -> lookout window -> sloped cathedral ramp
    const galEntry = sdCapsule(x, y, z, -17.0, 24.5, 8.0, -32.0, 24.0, -8.0, 7.2);
    const galHall = sdCapsule(x, y, z, -32.0, 24.0, -8.0, -32.0, 24.0, -24.0, 7.8);
    const galWindow = sdCapsule(x, y, z, -32.0, 24.0, -17.0, -10.0, 23.5, -14.0, 6.8);
    const galRamp = sdCapsule(x, y, z, -32.0, 24.0, -22.0, -21.0, 17.0, -44.0, 7.8);

    // 6. West Amphitheater Deep Overhang Recess under the 45 m cliff brow
    const ampUndercut = sdCapsule(x, y, z, -28.0, 11.5, 16.0, -34.0, 12.0, 40.0, 9.8);

    let d = smin(sMouth, sBend1, 5.0);
    d = smin(d, cathedral, 5.5);
    d = smin(d, skylight, 4.0);
    d = smin(d, sNorth1, 5.0);
    d = smin(d, sNorth2, 4.0);
    d = smin(d, galEntry, 3.8);
    d = smin(d, galHall, 3.8);
    d = smin(d, galWindow, 3.2);
    d = smin(d, galRamp, 4.2);
    d = smin(d, ampUndercut, 3.5);

    // Natural water-eroded cave wall irregularity
    d += fbm3(x * 0.065 + 4.1, y * 0.085, z * 0.065 - 3.3, 3) * 1.9;
    return d;
}

/** Region 2 Solid Cave Formations (< 0 inside rock) overriding Region 1 Carve voids. */
export function formationsSdf(x, y, z) {
    // 1. Sunlit mossy karst islet in the center of the subterranean cathedral skylight pool
    const islet = sdEllipsoid(x, y, z, -7.0, 4.4, -47.0, 6.4, 3.4, 5.4);

    // 2. Sculpted limestone pillars bracing the cathedral vault perimeter
    const pillars = [
        [-21.0, 2.0, -38.0, -20.0, 29.0, -37.0, 2.4],
        [  7.0, 2.0, -42.0,   6.0, 29.0, -41.0, 2.3],
        [-19.0, 2.0, -58.0, -18.0, 28.0, -57.0, 2.5],
        [  5.0, 2.0, -57.0,   4.0, 28.0, -56.0, 2.4],
    ];
    let d = islet;
    for (const p of pillars) {
        // Flair top stalactite + bottom stalagmite waist with subtle cos(y) flute
        const pd = sdCapsule(x, y, z, p[0], p[1], p[2], p[3], p[4], p[5], p[6] + 0.55 * Math.cos(y * 0.35));
        d = Math.min(d, pd);
    }

    d += fbm3(x * 0.14 + 2.1, y * 0.14, z * 0.14, 2) * 0.65;
    return d;
}

function classifyMacroCell(fn, ox, oy, oz, size) {
    const h = size * 0.5;
    const cx = ox + h, cy = oy + h, cz = oz + h;
    let lo = Infinity, hi = -Infinity;
    for (let kz = 0; kz <= 1; kz++) {
        const pz = oz + kz * size;
        for (let ky = 0; ky <= 1; ky++) {
            const py = oy + ky * size;
            for (let kx = 0; kx <= 1; kx++) {
                const v = fn(ox + kx * size, py, pz);
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
    }
    const vc = fn(cx, cy, cz);
    if (vc < lo) lo = vc;
    if (vc > hi) hi = vc;
    const margin = size * 1.35;
    if (hi < -margin) return -1; // uniform interior
    if (lo > margin) return 1;   // uniform exterior
    return 0;                    // boundary cell
}

function makeBatchCollector(maxCells) {
    const arr = new Uint32Array(maxCells * 5);
    let count = 0;
    return {
        push(ix, iy, iz, archetype) {
            if (!archetype || archetype.ref === 0xFFFFFFFF || count >= maxCells) return;
            const o = count * 5;
            arr[o] = ix;
            arr[o + 1] = iy;
            arr[o + 2] = iz;
            arr[o + 3] = archetype.ref;
            arr[o + 4] = archetype.isLeaf ? 1 : 0;
            count++;
        },
        get array() { return arr; },
        get count() { return count; },
    };
}

/** Populate the 3 stacked SVDAG storage regions and build reusable sculpt brushes. */
export function populateWorldDag(vd) {
    const cfg = WORLD_CFG;
    const common = {
        center: cfg.dagCenter,
        voxelSize: cfg.voxelSize,
        maxDepth: cfg.maxDepth,
        minDist: 0,
        fadeStart: 320,
        maxDist: 420,
        enabled: true,
        castShadow: true,
    };
    const solidId = vd.addRegion(common);
    const carveId = vd.addRegion({ ...common, castShadow: false });
    const formId = vd.addRegion(common);

    const uniformSolid = vd.addArchetypeFromBox([0.24, 0.21, 0.18, 1.0], 1, { roughness: 0.92 });
    const uniformCarve = vd.addArchetypeFromBox([1.0, 1.0, 1.0, 1.0], 1, { state: 'carve' });

    const brushes = {
        carveTunnel: vd.addCarveArchetypeFromSdf({ kind: 'sphere', radius: 0.92 }, 1),
        carveChamber: vd.addCarveArchetypeFromSdf({ kind: 'sphere', radius: 0.94 }, 1),
        buildRock: vd.addArchetypeFromSdf({ kind: 'sphere', radius: 0.90 }, 1, {
            color: [0.30, 0.25, 0.20, 1.0], roughness: 0.90,
        }),
    };

    const ox0 = cfg.dagOrigin[0], oy0 = cfg.dagOrigin[1], oz0 = cfg.dagOrigin[2];
    const mSize = cfg.macroCell, half = mSize * 0.5;
    const solidBatch = makeBatchCollector(9000);
    const carveBatch = makeBatchCollector(5000);
    const formBatch = makeBatchCollector(1000);

    const counts = {
        solidUniform: 0, solidBoundary: 0,
        carveUniform: 0, carveBoundary: 0,
        formUniform: 0, formBoundary: 0,
    };

    for (let iy = 12; iy <= 20; iy++) {
        const wy0 = oy0 + iy * mSize, wyc = wy0 + half;
        for (let iz = 3; iz <= 28; iz++) {
            const wz0 = oz0 + iz * mSize, wzc = wz0 + half;
            for (let ix = 3; ix <= 28; ix++) {
                const wx0 = ox0 + ix * mSize, wxc = wx0 + half;

                const sCls = classifyMacroCell(massifSdf, wx0, wy0, wz0, mSize);
                if (sCls === -1) {
                    solidBatch.push(ix, iy, iz, uniformSolid);
                    counts.solidUniform++;
                } else if (sCls === 0) {
                    const gx = (massifSdf(wxc + 1, wyc, wzc) - massifSdf(wxc - 1, wyc, wzc)) * 0.5;
                    const gy = (massifSdf(wxc, wyc + 1, wzc) - massifSdf(wxc, wyc - 1, wzc)) * 0.5;
                    const gz = (massifSdf(wxc, wyc, wzc + 1) - massifSdf(wxc, wyc, wzc - 1)) * 0.5;
                    const invNorm = 1.0 / (Math.max(1.0, Math.hypot(gx, gy, gz)) * 2.4);
                    const col = wyc >= 38
                        ? [0.16, 0.24, 0.14, 1.0]
                        : wyc >= 14
                            ? [0.30, 0.25, 0.20, 1.0]
                            : [0.18, 0.20, 0.21, 1.0];
                    const arch = vd.addArchetypeFromSdf(
                        (lx, ly, lz) => massifSdf(wxc + lx * half, wyc + ly * half, wzc + lz * half) * invNorm,
                        1,
                        { color: col, roughness: 0.92 }
                    );
                    solidBatch.push(ix, iy, iz, arch);
                    counts.solidBoundary++;
                }

                // Only populate cave carvings where massif could exist above seafloor
                if (wy0 < 56 && sCls <= 0) {
                    const cCls = classifyMacroCell(cavesSdf, wx0, wy0, wz0, mSize);
                    if (cCls === -1) {
                        carveBatch.push(ix, iy, iz, uniformCarve);
                        counts.carveUniform++;
                    } else if (cCls === 0) {
                        const cArch = vd.addCarveArchetypeFromSdf(
                            (lx, ly, lz) => cavesSdf(wxc + lx * half, wyc + ly * half, wzc + lz * half),
                            1
                        );
                        carveBatch.push(ix, iy, iz, cArch);
                        counts.carveBoundary++;
                    }
                }

                // Cave formations only inside the subterranean cathedral & West cliff gallery
                if (wxc > -38 && wxc < 16 && wzc > -68 && wzc < -6 && wy0 < 36) {
                    const fCls = classifyMacroCell(formationsSdf, wx0, wy0, wz0, mSize);
                    if (fCls === -1) {
                        formBatch.push(ix, iy, iz, uniformSolid);
                        counts.formUniform++;
                    } else if (fCls === 0) {
                        const fArch = vd.addArchetypeFromSdf(
                            (lx, ly, lz) => formationsSdf(wxc + lx * half, wyc + ly * half, wzc + lz * half) / 2.4,
                            1,
                            { color: [0.25, 0.23, 0.20, 1.0], roughness: 0.88 }
                        );
                        formBatch.push(ix, iy, iz, fArch);
                        counts.formBoundary++;
                    }
                }
            }
        }
    }

    const td = cfg.targetDepth;
    vd.placeBatchTyped(solidId, solidBatch.array, td, solidBatch.count);
    vd.placeBatchTyped(carveId, carveBatch.array, td, carveBatch.count);
    vd.placeBatchTyped(formId, formBatch.array, td, formBatch.count);

    return {
        solidId, carveId, formId, brushes, counts,
        carveBatch, formBatch,
        restoreInitial() {
            vd.clearRegion(carveId);
            vd.placeBatchTyped(carveId, carveBatch.array, td, carveBatch.count);
            vd.clearRegion(formId);
            vd.placeBatchTyped(formId, formBatch.array, td, formBatch.count);
        },
    };
}
