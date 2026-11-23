// DESI DR1 dataset loader, flat LCDM cosmology LUT, and 150k-object 3D Cosmic Web synthesizer.
// Uses zero-copy bro.table.mmap(desi-dr1.brotable) when ingested, else synthesizes
// cellular filaments, supercluster knots, BAO 105 Mpc/h acoustic shells, deep cosmic voids,
// 11.8 Gyr high-z QSO light-cone, and rest/observer galaxy color sequences.

import { hasRealDataFile, resolveDataFile } from "/lib/sci-atlas/data-paths.js";

export const COSMO_SCHEMA = {
    ord: 'u32',
    cx: 'f32',
    cy: 'f32',
    cz: 'f32',
    z: 'f32',
    lookback_gyr: 'f32',
    g_r: 'f32',
    r_z: 'f32',
    flux_r: 'f32',
    spectype: 'i32',
    void_score: 'f32',
};

export const GPU_COLS = [
    'cx', 'cy', 'cz', 'z', 'lookback_gyr',
    'g_r', 'r_z', 'flux_r', 'spectype', 'void_score',
];

export const SPEC_LABELS = [
    'GALAXY (BGS/ELG)',
    'LRG (Red Sequence)',
    'QSO (Quasar)',
    'STAR (Foreground)',
];

export const SPEC_COLORS = [
    '#5ec2ff',
    '#ff9d52',
    '#d67bff',
    '#7bf2b8',
];

// Flat Planck-2018 / DESI fiducial LCDM parameters:
//   Omega_m = 0.315, Omega_L = 0.685, c/H0 = 2997.92458 Mpc/h, t_H = 14.51 Gyr (h = 0.674)
const OMEGA_M = 0.315;
const OMEGA_L = 0.685;
const DH_MPCH = 2997.92458;
const TH_GYR = 14.51;
const LUT_N = 512;
const LUT_ZMAX = 4.5;
const LUT_DZ = LUT_ZMAX / LUT_N;

const CHI_LUT = new Float32Array(LUT_N + 1);
const LB_LUT = new Float32Array(LUT_N + 1);

(function buildCosmoLut() {
    let chiAcc = 0.0;
    let lbAcc = 0.0;
    const sub = 8;
    const hStep = LUT_DZ / sub;
    for (let i = 0; i < LUT_N; i++) {
        const z0 = i * LUT_DZ;
        for (let s = 0; s < sub; s++) {
            const zm = z0 + (s + 0.5) * hStep;
            const opz = 1.0 + zm;
            const ez = Math.sqrt(OMEGA_M * opz * opz * opz + OMEGA_L);
            chiAcc += (DH_MPCH / ez) * hStep;
            lbAcc += (TH_GYR / (opz * ez)) * hStep;
        }
        CHI_LUT[i + 1] = chiAcc;
        LB_LUT[i + 1] = lbAcc;
    }
})();

export function comovingDistanceMpcH(z) {
    if (z <= 0) return 0.0;
    if (z >= LUT_ZMAX) return CHI_LUT[LUT_N];
    const f = z / LUT_DZ;
    const i = Math.min(LUT_N - 1, f | 0);
    const t = f - i;
    return CHI_LUT[i] + (CHI_LUT[i + 1] - CHI_LUT[i]) * t;
}

export function lookbackGyr(z) {
    if (z <= 0) return 0.0;
    if (z >= LUT_ZMAX) return LB_LUT[LUT_N];
    const f = z / LUT_DZ;
    const i = Math.min(LUT_N - 1, f | 0);
    const t = f - i;
    return LB_LUT[i] + (LB_LUT[i + 1] - LB_LUT[i]) * t;
}

export function redshiftFromChi(chiMpcH) {
    if (chiMpcH <= 0) return 0.0;
    if (chiMpcH >= CHI_LUT[LUT_N]) return LUT_ZMAX;
    let lo = 0, hi = LUT_N;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (CHI_LUT[mid] <= chiMpcH) lo = mid;
        else hi = mid;
    }
    const c0 = CHI_LUT[lo];
    const c1 = CHI_LUT[lo + 1];
    const t = c1 > c0 ? (chiMpcH - c0) / (c1 - c0) : 0.0;
    return (lo + t) * LUT_DZ;
}

export function classifyDesiSpectype(rawType, desiTargetBig, gMinusR, rMinusZ, z) {
    if (rawType === 81) return 2; // 'Q' -> QSO
    if (rawType === 83) return 3; // 'S' -> STAR
    // 'G' -> GALAXY: separate Luminous Red Galaxies (LRG) from BGS/ELG
    const isLrgBit = (desiTargetBig & 1n) !== 0n;
    if (isLrgBit || (gMinusR > 0.92 && rMinusZ > 0.42 && z > 0.22 && z < 1.25)) {
        return 1;
    }
    return 0;
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

function sampleGalaxyColors(rng, spectype, z) {
    if (spectype === 3) {
        // Milky Way foreground stars along stellar locus
        const u = rng.rand();
        const g_r = 0.25 + u * 1.15 + rng.gauss() * 0.08;
        const r_z = 0.08 + u * 0.75 + rng.gauss() * 0.06;
        const flux_r = 1.6 + rng.gauss() * 0.65;
        return { g_r, r_z, flux_r };
    }
    if (spectype === 2) {
        // High-z Quasars (blue UV excess shifting slightly across Ly-alpha)
        const g_r = 0.14 + 0.16 * Math.min(2.5, z) + rng.gauss() * 0.15;
        const r_z = 0.22 + 0.12 * Math.sin(z * 1.8) + rng.gauss() * 0.14;
        const flux_r = 0.45 - 0.18 * Math.min(2.5, z) + rng.gauss() * 0.35;
        return { g_r, r_z, flux_r };
    }
    if (spectype === 1) {
        // Red sequence LRGs (strong 4000A break moving across g-r and r-z with redshift)
        const g_r = 1.05 + 0.58 * Math.min(1.1, z) + rng.gauss() * 0.14;
        const r_z = 0.52 + 0.45 * Math.max(0.0, z - 0.35) + rng.gauss() * 0.11;
        const flux_r = 0.65 - 0.35 * z + rng.gauss() * 0.28;
        return { g_r, r_z, flux_r };
    }
    // Star-forming BGS & ELG blue cloud galaxies
    const g_r = 0.38 + 0.22 * Math.min(1.4, z) + rng.gauss() * 0.16;
    const r_z = 0.24 + 0.20 * Math.min(1.4, z) + rng.gauss() * 0.14;
    const flux_r = 0.55 - 0.32 * z + rng.gauss() * 0.36;
    return { g_r, r_z, flux_r };
}

function generateSample() {
    const N = 150000;
    const t0 = performance.now();
    const rng = makeRng(20260710);

    // 1. Build 3D cellular cosmic web: 260 supercluster nodes + filament edges + BAO 105 Mpc/h acoustic correlation
    const nNodes = 260;
    const nBaoAnchors = 42;
    const nodes = new Array(nNodes);
    for (let i = 0; i < nNodes; i++) {
        // Uniform-volume radial spread inside r ~ 260..2250 Mpc/h
        const rMin = i < nBaoAnchors ? 460.0 : 240.0;
        const rSpan = i < nBaoAnchors ? 1380.0 : 2010.0;
        const r = rMin + Math.pow(rng.rand(), 0.40) * rSpan;
        const phi = rng.rand() * Math.PI * 2.0;
        let sinB = rng.rand() * 2.0 - 1.0;
        if (Math.abs(sinB) < 0.14) sinB = (sinB < 0 ? -1 : 1) * (0.14 + rng.rand() * 0.35);
        const cosB = Math.sqrt(Math.max(0.0, 1.0 - sinB * sinB));
        let px = r * cosB * Math.cos(phi);
        let py = r * cosB * Math.sin(phi);
        let pz = r * sinB;
        if (i < nBaoAnchors) {
            for (let attempt = 0; attempt < 20; attempt++) {
                let ok = true;
                for (let j = 0; j < i; j++) {
                    if (Math.hypot(px - nodes[j][0], py - nodes[j][1], pz - nodes[j][2]) < 340.0) {
                        ok = false; break;
                    }
                }
                if (ok) break;
                const r2 = rMin + Math.pow(rng.rand(), 0.40) * rSpan;
                const p2 = rng.rand() * Math.PI * 2.0;
                const sb2 = (rng.rand() < 0.5 ? -1 : 1) * (0.16 + rng.rand() * 0.78);
                const cb2 = Math.sqrt(Math.max(0.0, 1.0 - sb2 * sb2));
                px = r2 * cb2 * Math.cos(p2);
                py = r2 * cb2 * Math.sin(p2);
                pz = r2 * sb2;
            }
        }
        nodes[i] = [px, py, pz];
    }

    // Connect each node to 3 nearest neighbors within 600 Mpc/h to form lacy cosmic web
    const edges = [];
    for (let i = 0; i < nNodes; i++) {
        const a = nodes[i];
        const near = [];
        for (let j = i + 1; j < nNodes; j++) {
            const b = nodes[j];
            const d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
            if (d2 < 600.0 * 600.0) near.push({ j, d2 });
        }
        near.sort((u, v) => u.d2 - v.d2);
        const take = Math.min(3, near.length);
        for (let k = 0; k < take; k++) {
            const b = nodes[near[k].j];
            const mx = 0.5 * (a[0] + b[0]) + rng.gauss() * 44.0;
            const my = 0.5 * (a[1] + b[1]) + rng.gauss() * 44.0;
            const mz = 0.5 * (a[2] + b[2]) + rng.gauss() * 44.0;
            edges.push([a, [mx, my, mz], b]);
        }
    }

    // 2. Populate typed columnar buffers
    const ord = new Uint32Array(N);
    const cx = new Float32Array(N);
    const cy = new Float32Array(N);
    const cz = new Float32Array(N);
    const zArr = new Float32Array(N);
    const lookbackArr = new Float32Array(N);
    const grArr = new Float32Array(N);
    const rzArr = new Float32Array(N);
    const fluxArr = new Float32Array(N);
    const spectype = new Int32Array(N);
    const voidScore = new Float32Array(N);

    const nFilament = 93500;
    const nBaoShells = 22000;
    const nKnots = 6500;
    const nQso = 21500;
    const nField = 5000;

    for (let i = 0; i < N; i++) {
        ord[i] = i;
        let x = 0, y = 0, zc = 0;
        let st = 0;
        let vs = 0.25;

        if (i < nFilament) {
            // Lacy cosmic web filament bridges
            const e = edges[Math.floor(rng.rand() * edges.length)];
            const t = rng.rand();
            const u = 1.0 - t;
            const bx = u * u * e[0][0] + 2 * u * t * e[1][0] + t * t * e[2][0];
            const by = u * u * e[0][1] + 2 * u * t * e[1][1] + t * t * e[2][1];
            const bz = u * u * e[0][2] + 2 * u * t * e[1][2] + t * t * e[2][2];
            const sig = 12.0 + 16.0 * Math.sin(t * Math.PI);
            x = bx + rng.gauss() * sig;
            y = by + rng.gauss() * sig;
            zc = bz + rng.gauss() * sig;
            st = rng.rand() < 0.34 ? 1 : 0;
            vs = Math.max(0.05, Math.min(0.65, 0.14 + Math.abs(rng.gauss()) * 0.14));
        } else if (i < nFilament + nBaoShells) {
            // 105 Mpc/h BAO correlation ripple integrated across 24 supercluster anchors
            const anchor = nodes[i % 24];
            const rShell = 105.0 + rng.gauss() * 5.8;
            const phi = rng.rand() * Math.PI * 2.0;
            const cosT = rng.rand() * 2.0 - 1.0;
            const sinT = Math.sqrt(Math.max(0.0, 1.0 - cosT * cosT));
            x = anchor[0] + rShell * sinT * Math.cos(phi);
            y = anchor[1] + rShell * sinT * Math.sin(phi);
            zc = anchor[2] + rShell * cosT;
            st = rng.rand() < 0.56 ? 1 : 0;
            vs = Math.max(0.08, Math.min(0.55, 0.22 + Math.abs(rng.gauss()) * 0.10));
        } else if (i < nFilament + nBaoShells + nKnots) {
            // Compact triaxial supercluster knots (primary BAO anchors host richer cluster cores)
            const nodeIdx = (i % 3 !== 0) ? (i % 24) : (i % nNodes);
            const node = nodes[nodeIdx];
            const sig = nodeIdx < 24 ? 8.5 : 13.0;
            x = node[0] + rng.gauss() * sig;
            y = node[1] + rng.gauss() * (sig * 0.85);
            zc = node[2] + rng.gauss() * (sig * 1.15);
            st = rng.rand() < 0.62 ? 1 : 0;
            vs = Math.max(0.01, Math.min(0.22, 0.04 + Math.abs(rng.gauss()) * 0.06));
        } else if (i < nFilament + nBaoShells + nKnots + nQso) {
            // High-z Quasars (11.8-Gyr light cone out to z = 3.5, chi ~ 4680 Mpc/h)
            const zq = 0.72 + Math.pow(rng.rand(), 1.25) * 2.78;
            const chiQ = comovingDistanceMpcH(zq);
            const phi = rng.rand() * Math.PI * 2.0;
            let sinB = rng.rand() * 2.0 - 1.0;
            if (Math.abs(sinB) < 0.14) sinB = (sinB < 0 ? -1 : 1) * (0.14 + rng.rand() * 0.4);
            const cosB = Math.sqrt(Math.max(0.0, 1.0 - sinB * sinB));
            const sheetMod = 1.0 + 0.03 * Math.sin(phi * 5.0 + zq * 4.0);
            x = chiQ * sheetMod * cosB * Math.cos(phi);
            y = chiQ * sheetMod * cosB * Math.sin(phi);
            zc = chiQ * sheetMod * sinB;
            st = 2;
            vs = 0.42 + rng.rand() * 0.35;
        } else if (i < nFilament + nBaoShells + nKnots + nQso + nField) {
            // Diffuse cosmic wall / void-edge galaxies
            const r = 320.0 + Math.pow(rng.rand(), 0.45) * 1980.0;
            const phi = rng.rand() * Math.PI * 2.0;
            const sinB = rng.rand() * 2.0 - 1.0;
            const cosB = Math.sqrt(Math.max(0.0, 1.0 - sinB * sinB));
            x = r * cosB * Math.cos(phi);
            y = r * cosB * Math.sin(phi);
            zc = r * sinB;
            st = rng.rand() < 0.25 ? 1 : 0;
            vs = 0.72 + rng.rand() * 0.24;
        } else {
            // Sparse Milky Way foreground stars (low redshift z ~ 0.006..0.045)
            const r = 40.0 + rng.rand() * 140.0;
            const phi = rng.rand() * Math.PI * 2.0;
            const sinB = rng.rand() * 2.0 - 1.0;
            const cosB = Math.sqrt(Math.max(0.0, 1.0 - sinB * sinB));
            x = r * cosB * Math.cos(phi);
            y = r * cosB * Math.sin(phi);
            zc = r * sinB;
            st = 3;
            vs = 0.15;
        }

        const chi = Math.hypot(x, y, zc);
        const zVal = Math.max(0.005, Math.min(3.5, redshiftFromChi(chi)));
        const lbVal = lookbackGyr(zVal);
        const col = sampleGalaxyColors(rng, st, zVal);

        cx[i] = x;
        cy[i] = y;
        cz[i] = zc;
        zArr[i] = zVal;
        lookbackArr[i] = lbVal;
        grArr[i] = Math.max(-0.5, Math.min(2.5, col.g_r));
        rzArr[i] = Math.max(-0.5, Math.min(2.2, col.r_z));
        fluxArr[i] = Math.max(-1.8, Math.min(3.5, col.flux_r));
        spectype[i] = st;
        voidScore[i] = vs;
    }

    const tbl = bro.table.create(COSMO_SCHEMA);
    tbl.insertMany({
        ord, cx, cy, cz, z: zArr, lookback_gyr: lookbackArr,
        g_r: grArr, r_z: rzArr, flux_r: fluxArr, spectype, void_score: voidScore,
    });
    tbl.createRangeIndex('z');
    tbl.createSpatialIndex('cosmo3d', ['cx', 'cy', 'cz'], 60.0);

    return {
        isReal: false,
        table: tbl,
        snap: tbl.snapshot(),
        buildMs: performance.now() - t0,
    };
}

// Finds rich filament/BAO knots and deep cosmic voids dynamically from the loaded snapshot
// so Probe Filament/Void and Probe Deep Void work cleanly on BOTH real DESI DR1 and synthetic data.
export function discoverProbesFromSnap(snap) {
    const filamentLandmarks = [];
    const voidLandmarks = [];
    const BOX = 2100.0;
    const N = 32;
    const counts = new Uint32Array(N * N * N);
    const sumX = new Float32Array(N * N * N);
    const sumY = new Float32Array(N * N * N);
    const sumZ = new Float32Array(N * N * N);

    const nChunks = snap.chunkCount;
    const step = Math.max(1, Math.floor(snap.rowCount / 180000));
    for (let ci = 0; ci < nChunks; ci++) {
        const rc = snap.chunkRowCount(ci);
        const cx = snap.chunkColumnView(ci, 'cx');
        const cy = snap.chunkColumnView(ci, 'cy');
        const cz = snap.chunkColumnView(ci, 'cz');
        for (let r = 0; r < rc; r += step) {
            const x = cx[r], y = cy[r], z = cz[r];
            const gx = Math.floor(((x + BOX) / (2 * BOX)) * N);
            const gy = Math.floor(((y + BOX) / (2 * BOX)) * N);
            const gz = Math.floor(((z + BOX) / (2 * BOX)) * N);
            if (gx >= 2 && gx < N - 2 && gy >= 2 && gy < N - 2 && gz >= 2 && gz < N - 2) {
                const idx = (gz * N + gy) * N + gx;
                counts[idx]++;
                sumX[idx] += x;
                sumY[idx] += y;
                sumZ[idx] += z;
            }
        }
    }

    const cellW = (2 * BOX) / N;
    const hotCells = [];
    const coldCells = [];
    for (let gz = 3; gz < N - 3; gz++) {
        for (let gy = 3; gy < N - 3; gy++) {
            for (let gx = 3; gx < N - 3; gx++) {
                const idx = (gz * N + gy) * N + gx;
                const c = counts[idx];
                const px = -BOX + (gx + 0.5) * cellW;
                const py = -BOX + (gy + 0.5) * cellW;
                const pz = -BOX + (gz + 0.5) * cellW;
                const dist = Math.hypot(px, py, pz);
                if (dist < 250.0 || dist > 1950.0) continue;

                if (c >= 4) {
                    hotCells.push({
                        c,
                        pt: [sumX[idx] / c, sumY[idx] / c, sumZ[idx] / c],
                    });
                } else if (c === 0) {
                    // Verify surrounded by filament walls in >= 4 axial directions within 3 cells
                    let walls = 0;
                    let amb = 0;
                    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
                        let hit = 0;
                        for (let s = 1; s <= 3; s++) {
                            const nIdx = ((gz + dz * s) * N + (gy + dy * s)) * N + (gx + dx * s);
                            amb += counts[nIdx];
                            if (counts[nIdx] > 0) hit = 1;
                        }
                        walls += hit;
                    }
                    if (walls >= 4 && amb >= 6) {
                        coldCells.push({ amb, pt: [px, py, pz] });
                    }
                }
            }
        }
    }

    hotCells.sort((a, b) => b.c - a.c);
    // Refine each dense cell center onto the exact supercluster core via mean-shift within 45 Mpc/h,
    // then score by 100..110 Mpc/h BAO shell contrast using SpatialIndex.
    const scoredHot = [];
    const candCount = Math.min(30, hotCells.length);
    for (let i = 0; i < candCount; i++) {
        let pt = hotCells[i].pt.slice();
        let baoScore = hotCells[i].c;
        try {
            const coreRes = snap.query().whereInRadius('cosmo3d', pt, 55.0)
                .select({ cx: 'cx', cy: 'cy', cz: 'cz' }).run();
            if (coreRes.rowCount >= 4) {
                let sx = 0, sy = 0, sz = 0;
                for (let ci = 0; ci < coreRes.chunkCount; ci++) {
                    const rc = coreRes.chunkRowCount(ci);
                    const vx = coreRes.chunkColumnView(ci, 'cx');
                    const vy = coreRes.chunkColumnView(ci, 'cy');
                    const vz = coreRes.chunkColumnView(ci, 'cz');
                    for (let r = 0; r < rc; r++) { sx += vx[r]; sy += vy[r]; sz += vz[r]; }
                }
                pt = [sx / coreRes.rowCount, sy / coreRes.rowCount, sz / coreRes.rowCount];
            }
            const qRes = snap.query().whereInRadius('cosmo3d', pt, 125.0)
                .select({ cx: 'cx', cy: 'cy', cz: 'cz' }).run();
            let nBao = 0, nTrough = 0;
            for (let ci = 0; ci < qRes.chunkCount; ci++) {
                const rc = qRes.chunkRowCount(ci);
                const vx = qRes.chunkColumnView(ci, 'cx');
                const vy = qRes.chunkColumnView(ci, 'cy');
                const vz = qRes.chunkColumnView(ci, 'cz');
                for (let r = 0; r < rc; r++) {
                    const d = Math.hypot(vx[r] - pt[0], vy[r] - pt[1], vz[r] - pt[2]);
                    if (d >= 98.0 && d <= 112.0) nBao++;
                    else if (d >= 70.0 && d <= 90.0) nTrough++;
                }
            }
            baoScore = nBao - 0.85 * nTrough;
        } catch (_) {}
        scoredHot.push({ pt, score: baoScore });
    }
    scoredHot.sort((a, b) => b.score - a.score);
    for (const h of scoredHot) {
        if (filamentLandmarks.every((p) => Math.hypot(p.pt[0] - h.pt[0], p.pt[1] - h.pt[1], p.pt[2] - h.pt[2]) > 350.0)) {
            filamentLandmarks.push({
                name: `Supercluster BAO Knot #${filamentLandmarks.length + 1}`,
                pt: h.pt,
            });
            if (filamentLandmarks.length >= 6) break;
        }
    }

    coldCells.sort((a, b) => b.amb - a.amb);
    for (const v of coldCells) {
        if (voidLandmarks.every((p) => Math.hypot(p.pt[0] - v.pt[0], p.pt[1] - v.pt[1], p.pt[2] - v.pt[2]) > 350.0)) {
            voidLandmarks.push({
                name: `Deep Cosmic Void #${voidLandmarks.length + 1}`,
                pt: v.pt,
            });
            if (voidLandmarks.length >= 5) break;
        }
    }

    if (filamentLandmarks.length === 0) {
        filamentLandmarks.push({ name: 'Local Cosmic Filament', pt: [450.0, 220.0, 180.0] });
    }
    if (voidLandmarks.length === 0) {
        voidLandmarks.push({ name: 'Bootes-Scale Cosmic Void', pt: [-620.0, 480.0, -340.0] });
    }
    return { filamentLandmarks, voidLandmarks };
}

export function loadCosmoDataset() {
    if (hasRealDataFile('desi-dr1.brotable')) {
        const path = resolveDataFile('desi-dr1.brotable');
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
