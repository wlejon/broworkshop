// Gaia DR3 dataset loader + realistic 150k-star Milky Way 6D phase-space synthesizer.
// Uses real zero-copy bro.table.mmap(gaia-dr3.brotable) when ingested, else synthesizes
// multi-component Bar/Spiral Disk, Thick Disk, Gaia-Sausage-Enceladus, Open Clusters,
// HR sequences (MS, Binary Ridge, RGB, Red Clump, White Dwarfs), and Vertical Snail.

import { hasRealDataFile, resolveDataFile } from "/lib/sci-atlas/data-paths.js";

export const GAIA_SCHEMA = {
    ord: 'u32',
    gx: 'f32',
    gy: 'f32',
    gz: 'f32',
    vx: 'f32',
    vy: 'f32',
    vz: 'f32',
    v_phi: 'f32',
    v_perp: 'f32',
    bp_rp: 'f32',
    mg: 'f32',
    fe_h: 'f32',
    teff: 'f32',
    pop: 'i32',
};

export const GPU_COLS = [
    'gx', 'gy', 'gz', 'vx', 'vy', 'vz',
    'v_phi', 'v_perp', 'bp_rp', 'mg', 'fe_h', 'teff', 'pop',
];

export const POP_LABELS = [
    'Thin Disk',
    'Thick Disk',
    'Halo / GSE',
    'Open Cluster / Stream',
];

export const POP_COLORS = [
    '#7ab8ff',
    '#e8b96b',
    '#d977ff',
    '#66f2b8',
];

export const SUN_POS = [-8.122, 0.0, 0.021];

export function estimateTeff(bpRp) {
    const c = Math.max(-0.4, Math.min(3.5, bpRp));
    const t = 4600.0 * (1.0 / (0.92 * c + 1.70) + 1.0 / (0.92 * c + 0.62));
    return Math.max(2600.0, Math.min(28000.0, t));
}

export function classifyPopulation(gx, gy, gz, vPhi, vPerp, feH, mg, bpRp) {
    const vToomre = Math.hypot(vPhi - 232.0, vPerp);
    if (vToomre > 180.0 || feH < -1.05 || Math.abs(gz) > 2.2) return 2;
    if (vToomre > 76.0 || feH < -0.45 || Math.abs(gz) > 0.78) return 1;
    if (mg < 1.6 && bpRp < 0.35 && vToomre < 24.0) return 3;
    return 0;
}

// Converts ICRS (ra, dec [deg], parallax [mas], pmra, pmdec [mas/yr], rv [km/s])
// into Galactocentric (gx, gy, gz [kpc], vx, vy, vz, v_phi, v_perp [km/s]).
export function icrsToGalactocentric(raDeg, decDeg, parallaxMas, pmra, pmdec, rv) {
    const deg2rad = Math.PI / 180.0;
    const ra = raDeg * deg2rad;
    const dec = decDeg * deg2rad;
    const ca = Math.cos(ra), sa = Math.sin(ra);
    const cd = Math.cos(dec), sd = Math.sin(dec);

    const rx = cd * ca, ry = cd * sa, rz = sd;
    const px = -sa, py = ca, pz = 0.0;
    const qx = -sd * ca, qy = -sd * sa, qz = cd;

    const dKpc = 1.0 / parallaxMas;
    const kTan = 4.74047;
    const vRa = kTan * pmra * dKpc;
    const vDec = kTan * pmdec * dKpc;

    const vxIcrs = rv * rx + vRa * px + vDec * qx;
    const vyIcrs = rv * ry + vRa * py + vDec * qy;
    const vzIcrs = rv * rz + vRa * pz + vDec * qz;

    const xI = dKpc * rx, yI = dKpc * ry, zI = dKpc * rz;

    // Hipparcos / ESA ICRS -> Galactic orthogonal matrix rows
    const gx = -8.122 + (-0.0548755604162154 * xI - 0.8734370902348850 * yI - 0.4838350155487132 * zI);
    const gy = 0.4941094278755837 * xI - 0.4448296299600112 * yI + 0.7469822444972189 * zI;
    const gz = 0.021 + (-0.8676661490190047 * xI - 0.1980763734312015 * yI + 0.4559837761750669 * zI);

    const uGal = -0.0548755604162154 * vxIcrs - 0.8734370902348850 * vyIcrs - 0.4838350155487132 * vzIcrs;
    const vGal = 0.4941094278755837 * vxIcrs - 0.4448296299600112 * vyIcrs + 0.7469822444972189 * vzIcrs;
    const wGal = -0.8676661490190047 * vxIcrs - 0.1980763734312015 * vyIcrs + 0.4559837761750669 * vzIcrs;

    // Solar Galactocentric motion: V_LSR (0, 233.6, 0) + Schonrich (11.1, 12.24, 7.25)
    const vx = uGal + 11.1;
    const vy = vGal + 245.84;
    const vz = wGal + 7.25;

    const rXy = Math.max(Math.hypot(gx, gy), 1e-4);
    const vR = (gx * vx + gy * vy) / rXy;
    const vPhi = (gy * vx - gx * vy) / rXy;
    const vPerp = Math.hypot(vR, vz);

    return { gx, gy, gz, vx, vy, vz, vPhi, vPerp };
}

function makeRng(seed) {
    let s = seed >>> 0;
    const rand = () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
    };
    let spare = null;
    const gauss = () => {
        if (spare !== null) { const v = spare; spare = null; return v; }
        let u = 0, v = 0, s2 = 0;
        do {
            u = rand() * 2.0 - 1.0;
            v = rand() * 2.0 - 1.0;
            s2 = u * u + v * v;
        } while (s2 >= 1.0 || s2 === 0.0);
        const f = Math.sqrt(-2.0 * Math.log(s2) / s2);
        spare = v * f;
        return u * f;
    };
    return { rand, gauss };
}

function sampleHR(rng, pop, feH, ageBias) {
    const u = rng.rand();
    let bpRp = 1.0;
    let mg = 5.0;

    if (pop === 3 && ageBias === 'young') {
        // Young open cluster main sequence: joins smoothly onto the MS curve
        const t = Math.pow(rng.rand(), 1.15);
        bpRp = -0.24 + t * 2.45;
        if (bpRp < 0.35) mg = 0.8 + 4.4 * bpRp;
        else if (bpRp < 1.35) mg = 2.34 + 4.0 * (bpRp - 0.35);
        else mg = 6.34 + 3.4 * (bpRp - 1.35);
        mg += rng.gauss() * 0.14;
    } else if (u < 0.032 && pop !== 2) {
        // White Dwarf Cooling Track
        bpRp = -0.22 + Math.pow(rng.rand(), 1.15) * 1.45;
        mg = 10.35 + 3.15 * bpRp + rng.gauss() * 0.25;
    } else if (u < 0.085) {
        // Red Clump / Horizontal Branch
        if (pop === 2 && rng.rand() < 0.55) {
            bpRp = 0.08 + rng.rand() * 0.65;
            mg = 0.58 + rng.gauss() * 0.18;
        } else {
            bpRp = 1.16 - 0.12 * Math.max(0, -feH) + rng.gauss() * 0.075;
            mg = 0.48 + rng.gauss() * 0.17;
        }
    } else if (u < 0.185) {
        // Subgiant & Red Giant Branch (turns off around G/F, curves up to cool bright K/M giants)
        const s = rng.rand();
        const metalShift = feH * 0.14;
        if (s < 0.22) {
            // Subgiant bridge
            const f = rng.rand();
            bpRp = 0.65 + f * 0.42 + metalShift;
            mg = 3.6 - f * 1.1 + rng.gauss() * 0.18;
        } else {
            // RGB ascent
            const f = Math.pow(rng.rand(), 1.3);
            bpRp = 1.05 + f * 1.15 + metalShift + rng.gauss() * 0.06;
            mg = 2.5 - f * 4.9 + rng.gauss() * 0.28;
        }
    } else {
        // Main Sequence (+ Equal-Mass Binary Ridge ~9% of MS stars)
        const t = rng.rand();
        if (t < 0.05) bpRp = -0.28 + rng.rand() * 0.58;
        else if (t < 0.48) bpRp = 0.30 + rng.rand() * 0.85;
        else if (t < 0.84) bpRp = 1.15 + rng.rand() * 0.85;
        else bpRp = 2.00 + rng.rand() * 1.25;

        // Piecewise MS M_G(bp_rp) + subdwarf shift for low metallicity
        const c = bpRp;
        if (c < 0.35) mg = 1.1 + 4.4 * c;
        else if (c < 1.35) mg = 2.64 + 3.95 * (c - 0.35);
        else if (c < 2.25) mg = 6.59 + 3.45 * (c - 1.35);
        else mg = 9.70 + 3.15 * (c - 2.25);

        mg -= feH * 0.28;
        if (rng.rand() < 0.10) mg -= 0.72; // Binary ridge
        mg += rng.gauss() * 0.19;
    }

    bpRp = Math.max(-0.38, Math.min(3.45, bpRp));
    mg = Math.max(-5.8, Math.min(14.8, mg));
    const teff = estimateTeff(bpRp) * (1.0 + rng.gauss() * 0.015);
    return { bpRp, mg, teff: Math.max(2650.0, Math.min(27000.0, teff)) };
}

function generateSample() {
    const N = 150000;
    const t0 = performance.now();
    const rng = makeRng(20260425);

    const ord = new Uint32Array(N);
    const gx = new Float32Array(N);
    const gy = new Float32Array(N);
    const gz = new Float32Array(N);
    const vx = new Float32Array(N);
    const vy = new Float32Array(N);
    const vz = new Float32Array(N);
    const v_phi = new Float32Array(N);
    const v_perp = new Float32Array(N);
    const bp_rp = new Float32Array(N);
    const mg = new Float32Array(N);
    const fe_h = new Float32Array(N);
    const teff = new Float32Array(N);
    const pop = new Int32Array(N);

    const clusters = [
        { pos: [-8.24, -0.02, -0.05], vel: [6.0, 218.0, -14.0], spread: 0.028, feh: 0.02, age: 'young', n: 1100 }, // Pleiades
        { pos: [-8.16, 0.02, -0.01], vel: [-32.0, 225.0, -2.0], spread: 0.022, feh: 0.13, age: 'mid', n: 1000 },   // Hyades
        { pos: [-8.08, -0.40, -0.10], vel: [-12.0, 222.0, -6.0], spread: 0.034, feh: 0.05, age: 'young', n: 900 }, // NGC 2516
        { pos: [-8.74, -0.42, 0.44], vel: [-22.0, 214.0, -18.0], spread: 0.032, feh: 0.00, age: 'mid', n: 950 },   // M67
        { pos: [-9.75, 1.35, -0.15], vel: [-18.0, 215.0, -8.0], spread: 0.048, feh: -0.04, age: 'young', n: 950 }, // h & chi Persei
    ];

    const nThin = 105000;
    const nThick = 27000;
    const nHalo = 12000;

    for (let i = 0; i < N; i++) {
        ord[i] = i;
        let x = 0, y = 0, z = 0, ux = 0, uy = 0, uz = 0, feh = 0, pClass = 0, ageBias = 'mid';

        if (i < nThin) {
            pClass = 0;
            const sub = rng.rand();
            if (sub < 0.20) {
                // Galactic Bar + Bulge (tilted ~27 deg)
                const angBar = 27.0 * Math.PI / 180.0;
                const bx = rng.gauss() * 1.95;
                const by = rng.gauss() * 0.72;
                x = bx * Math.cos(angBar) - by * Math.sin(angBar);
                y = bx * Math.sin(angBar) + by * Math.cos(angBar);
                z = rng.gauss() * 0.28;
                feh = 0.08 + rng.gauss() * 0.24;
            } else if (sub < 0.74) {
                // 4-arm Logarithmic Spiral Disk
                const arm = Math.floor(rng.rand() * 4);
                const r = 1.6 + Math.pow(rng.rand(), 0.78) * 12.6;
                const phiArm = arm * (Math.PI * 0.5) + 4.2 * Math.log(r / 2.2);
                const phi = phiArm + rng.gauss() * (0.28 + 0.018 * r);
                x = r * Math.cos(phi);
                y = r * Math.sin(phi);
                z = rng.gauss() * (0.14 + 0.014 * r);
                feh = 0.14 - 0.055 * (r - 8.122) + rng.gauss() * 0.16;
                if (rng.rand() < 0.28) ageBias = 'young';
            } else {
                // Local Gaia RVS Solar Neighborhood concentration
                const d = Math.abs(rng.gauss()) * 2.25;
                const th = rng.rand() * Math.PI * 2.0;
                x = -8.122 + d * Math.cos(th);
                y = d * Math.sin(th);
                z = 0.021 + rng.gauss() * 0.21;
                feh = -0.02 + rng.gauss() * 0.18;
            }

            const rXy = Math.max(Math.hypot(x, y), 0.35);
            const vCirc = 232.0 * rXy / Math.sqrt(rXy * rXy + 0.55);
            let vp = vCirc - 6.0 + rng.gauss() * 14.5;
            const vr = rng.gauss() * 27.0;
            let vzVal = rng.gauss() * 16.5;

            // Imprint Antoja (2018) Gaia Vertical Phase-Space Snail in solar-vicinity disk!
            if (rXy > 4.2 && rXy < 12.5) {
                const amp0 = 0.14 + Math.pow(rng.rand(), 0.72) * 1.15;
                let ang = rng.rand() * Math.PI * 2.0;
                const spiralPhase = ang + 9.2 * amp0 + 0.07 * (rXy - 8.122);
                ang -= 0.88 * Math.sin(spiralPhase);
                const amp = amp0 * (1.0 + 0.18 * Math.cos(ang + 9.2 * amp0 + 0.07 * (rXy - 8.122)));
                z = amp * Math.cos(ang) * 0.52;
                vzVal = amp * Math.sin(ang) * 40.0;
                vp += 18.0 * Math.cos(ang + 9.2 * amp0 + 0.07 * (rXy - 8.122));
            }

            // Convert cylindrical (vR, vPhi) back to Cartesian Galactic (vx, vy)
            ux = (x / rXy) * vr + (y / rXy) * vp;
            uy = (y / rXy) * vr - (x / rXy) * vp;
            uz = vzVal;
        } else if (i < nThin + nThick) {
            pClass = 1;
            const r = 1.5 + Math.pow(rng.rand(), 0.85) * 11.5;
            const phi = rng.rand() * Math.PI * 2.0;
            x = r * Math.cos(phi);
            y = r * Math.sin(phi);
            z = rng.gauss() * 0.68;
            const rXy = Math.max(Math.hypot(x, y), 0.4);
            const vp = 172.0 + rng.gauss() * 32.0;
            const vr = rng.gauss() * 54.0;
            ux = (x / rXy) * vr + (y / rXy) * vp;
            uy = (y / rXy) * vr - (x / rXy) * vp;
            uz = rng.gauss() * 38.0;
            feh = -0.72 + rng.gauss() * 0.26;
        } else if (i < nThin + nThick + nHalo) {
            pClass = 2;
            const rSph = 2.0 + Math.pow(rng.rand(), 0.8) * 14.0;
            const th = rng.rand() * Math.PI * 2.0;
            const cz = rng.rand() * 2.0 - 1.0;
            const sz = Math.sqrt(Math.max(0.0, 1.0 - cz * cz));
            x = rSph * sz * Math.cos(th);
            y = rSph * sz * Math.sin(th);
            z = rSph * cz * 0.72;
            const rXy = Math.max(Math.hypot(x, y), 0.35);

            let vp, vr, vzVal;
            if (rng.rand() < 0.68) {
                // Gaia-Sausage-Enceladus (radial merger remnant centered at v_phi ~ 0)
                vp = -4.0 + rng.gauss() * 36.0;
                const sign = rng.rand() < 0.5 ? 1.0 : -1.0;
                vr = sign * (145.0 + Math.abs(rng.gauss()) * 72.0);
                vzVal = rng.gauss() * 78.0;
                feh = -1.32 + rng.gauss() * 0.30;
            } else {
                // Sequoia retrograde / Helmi prograde halo substructure
                vp = (rng.rand() < 0.65 ? -135.0 : 85.0) + rng.gauss() * 44.0;
                vr = rng.gauss() * 115.0;
                vzVal = rng.gauss() * 98.0;
                feh = -1.72 + rng.gauss() * 0.36;
            }
            ux = (x / rXy) * vr + (y / rXy) * vp;
            uy = (y / rXy) * vr - (x / rXy) * vp;
            uz = vzVal;
        } else {
            pClass = 3;
            let k = i - (nThin + nThick + nHalo);
            let chosen = null;
            for (const c of clusters) {
                if (k < c.n) { chosen = c; break; }
                k -= c.n;
            }
            if (chosen) {
                x = chosen.pos[0] + rng.gauss() * chosen.spread;
                y = chosen.pos[1] + rng.gauss() * chosen.spread;
                z = chosen.pos[2] + rng.gauss() * chosen.spread;
                ux = chosen.vel[0] + rng.gauss() * 1.4;
                uy = chosen.vel[1] + rng.gauss() * 1.4;
                uz = chosen.vel[2] + rng.gauss() * 1.4;
                feh = chosen.feh + rng.gauss() * 0.04;
                ageBias = chosen.age;
            } else {
                // GD-1 / Palomar 5 cold halo stream arc
                const s = (k / 1100.0) * 2.0 - 1.0;
                x = -8.6 + s * 2.8 + rng.gauss() * 0.09;
                y = 2.6 + s * 3.1 - s * s * 0.9 + rng.gauss() * 0.09;
                z = 3.8 + s * 1.4 - s * s * 0.6 + rng.gauss() * 0.08;
                const rXy = Math.max(Math.hypot(x, y), 0.35);
                const vp = 116.0 + rng.gauss() * 4.5;
                const vr = -48.0 + s * 16.0 + rng.gauss() * 5.0;
                ux = (x / rXy) * vr + (y / rXy) * vp;
                uy = (y / rXy) * vr - (x / rXy) * vp;
                uz = -82.0 + s * 18.0 + rng.gauss() * 4.5;
                feh = -1.42 + rng.gauss() * 0.07;
            }
        }

        const rXy = Math.max(Math.hypot(x, y), 1e-4);
        const vrVal = (x * ux + y * uy) / rXy;
        const vpVal = (y * ux - x * uy) / rXy;
        const vppVal = Math.hypot(vrVal, uz);

        feh = Math.max(-2.5, Math.min(0.6, feh));
        const hr = sampleHR(rng, pClass, feh, ageBias);

        gx[i] = x; gy[i] = y; gz[i] = z;
        vx[i] = ux; vy[i] = uy; vz[i] = uz;
        v_phi[i] = vpVal;
        v_perp[i] = vppVal;
        bp_rp[i] = hr.bpRp;
        mg[i] = hr.mg;
        fe_h[i] = feh;
        teff[i] = hr.teff;
        pop[i] = pClass;
    }

    const tbl = bro.table.create(GAIA_SCHEMA);
    tbl.insertMany({
        ord, gx, gy, gz, vx, vy, vz,
        v_phi, v_perp, bp_rp, mg, fe_h, teff, pop,
    });
    tbl.createRangeIndex('mg');
    tbl.createSpatialIndex('gal3d', ['gx', 'gy', 'gz'], 0.3);

    return {
        isReal: false,
        table: tbl,
        snap: tbl.snapshot(),
        buildMs: performance.now() - t0,
    };
}

export function loadGaiaDataset() {
    if (hasRealDataFile('gaia-dr3.brotable')) {
        const path = resolveDataFile('gaia-dr3.brotable');
        const t0 = performance.now();
        const snap = bro.table.mmap(path);
        return {
            isReal: true,
            path,
            table: null,
            snap,
            buildMs: performance.now() - t0,
        };
    }
    return generateSample();
}
