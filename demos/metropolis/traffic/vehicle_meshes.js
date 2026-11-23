// Closed single-island outward-CCW sculpted 4-archetype vehicles (sedan, SUV, coupe, van),
// smooth-beveled 20-segment alloy wheels, dark trim/grilles, LED lights, and planar glazing.
// Glazing uses planar closed outward-CCW facets (curvedEdges = 0) so translucent_striation cannot fire.

class VehicleMeshAcc {
    constructor() {
        this.pos = [];
        this.nrm = [];
        this.uvs = [];
        this.idx = [];
    }

    addTriOut(p0, p1, p2, ref, matId, param = 0.0) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const mx = (p0[0] + p1[0] + p2[0]) / 3 - ref[0];
        const my = (p0[1] + p1[1] + p2[1]) / 3 - ref[1];
        const mz = (p0[2] + p1[2] + p2[2]) / 3 - ref[2];
        const flip = (nx * mx + ny * my + nz * mz) < 0;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        const pts = flip ? [p0, p2, p1] : [p0, p1, p2];
        const b = this.pos.length / 3;
        for (let i = 0; i < 3; i++) {
            this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
            this.nrm.push(nx, ny, nz);
            this.uvs.push(matId, param);
        }
        this.idx.push(b, b + 1, b + 2);
    }

    addQuadOut(p0, p1, p2, p3, ref, matId, param = 0.0) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const mx = 0.25 * (p0[0] + p1[0] + p2[0] + p3[0]) - ref[0];
        const my = 0.25 * (p0[1] + p1[1] + p2[1] + p3[1]) - ref[1];
        const mz = 0.25 * (p0[2] + p1[2] + p2[2] + p3[2]) - ref[2];
        const flip = (nx * mx + ny * my + nz * mz) < 0;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        const pts = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
        const b = this.pos.length / 3;
        for (let i = 0; i < 4; i++) {
            this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
            this.nrm.push(nx, ny, nz);
            this.uvs.push(matId, param);
        }
        this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }

    addBox(x0, y0, z0, x1, y1, z1, matId, param = 0.0) {
        const ref = [0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.5 * (z0 + z1)];
        this.addQuadOut([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], ref, matId, param);
        this.addQuadOut([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], ref, matId, param);
        this.addQuadOut([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], ref, matId, param);
        this.addQuadOut([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], ref, matId, param);
        this.addQuadOut([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], ref, matId, param);
        this.addQuadOut([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], ref, matId, param);
    }

    // Closed extruded/lofted multi-station 10-point symmetrical hull tube (1 connected welded island).
    // Each station: { z, xBot, xMid, xBelt, xCrown, yBot, ySill, yBelt, yCrown, beltMat, topMat }
    addLoftedHull(stations) {
        const rings = [];
        for (let si = 0; si < stations.length; si++) {
            const s = stations[si];
            const z = s.z;
            // 10-point CCW perimeter around XZ cross-section (bottom -> right flank -> roof crown -> left flank)
            const ring = [
                [-s.xBot * 0.72, s.yBot, z],   // 0: bottom left
                [ s.xBot * 0.72, s.yBot, z],   // 1: bottom right
                [ s.xMid,        s.ySill, z],  // 2: right lower rocker / arch lip
                [ s.xBelt,       s.yBelt, z],  // 3: right beltline shoulder
                [ s.xCrown,      s.yCrown - 0.035, z], // 4: right roof / hood corner
                [ 0,             s.yCrown, z], // 5: top center crest (hood / roof crown)
                [-s.xCrown,      s.yCrown - 0.035, z], // 6: left roof / hood corner
                [-s.xBelt,       s.yBelt, z],  // 7: left beltline shoulder
                [-s.xMid,        s.ySill, z],  // 8: left lower rocker / arch lip
            ];
            rings.push({ pts: ring, s });
        }

        // Connect consecutive stations
        for (let si = 0; si + 1 < rings.length; si++) {
            const a = rings[si];
            const b = rings[si + 1];
            const zMid = 0.5 * (a.s.z + b.s.z);
            const yMid = 0.25 * (a.s.yBot + b.s.yBot + a.s.yCrown + b.s.yCrown);
            const ref = [0, yMid, zMid];
            const N = a.pts.length;
            for (let pi = 0; pi < N; pi++) {
                const pj = (pi + 1) % N;
                let mat = 6;
                if (pi === 0 || pi === 1 || pi === 8) mat = a.s.lowMat ?? 13;
                else if (pi >= 3 && pi <= 5) mat = a.s.topMat ?? 6;
                else mat = a.s.sideMat ?? 6;
                this.addQuadOut(a.pts[pi], a.pts[pj], b.pts[pj], b.pts[pi], ref, mat, 0.0);
            }
        }

        // Front nose cap (ring 0) & rear tail cap (ring N-1)
        const emitEndCap = (ringObj, mat) => {
            const pts = ringObj.pts;
            const c = [0, 0.5 * (ringObj.s.yBot + ringObj.s.yCrown), ringObj.s.z];
            const ref = [0, c[1], ringObj.s.z + (ringObj.s.z < 0 ? 0.35 : -0.35)];
            for (let pi = 0; pi < pts.length; pi++) {
                const pj = (pi + 1) % pts.length;
                this.addTriOut(c, pts[pi], pts[pj], ref, mat, 0.0);
            }
        };
        emitEndCap(rings[0], 13);
        emitEndCap(rings[rings.length - 1], 13);
    }

    addLatheWheel(radius, width, sides = 20) {
        // Multi-ring revolved tire + recessed 5-spoke-stepped metallic alloy wheel (single closed island)
        const rings = [
            { x: -width * 0.50, r: radius * 0.62, m: 4 }, // inner rim hub
            { x: -width * 0.44, r: radius * 0.68, m: 4 }, // rim barrel
            { x: -width * 0.48, r: radius * 0.94, m: 12 }, // inner sidewall bevel
            { x: -width * 0.34, r: radius,        m: 12 }, // inner tread shoulder
            { x:  width * 0.34, r: radius,        m: 12 }, // outer tread shoulder
            { x:  width * 0.48, r: radius * 0.94, m: 12 }, // outer sidewall bevel
            { x:  width * 0.40, r: radius * 0.64, m: 4 }, // outer alloy rim dish
            { x:  width * 0.45, r: radius * 0.56, m: 4 }, // outer alloy rim lip
        ];
        const ptsPerRing = [];
        for (let ri = 0; ri < rings.length; ri++) {
            const ring = [];
            for (let i = 0; i < sides; i++) {
                const a = (i * Math.PI * 2) / sides;
                ring.push([rings[ri].x, Math.sin(a) * rings[ri].r, Math.cos(a) * rings[ri].r]);
            }
            ptsPerRing.push(ring);
        }
        const refCenter = [0, 0, 0];
        for (let ri = 0; ri + 1 < rings.length; ri++) {
            const rA = ptsPerRing[ri];
            const rB = ptsPerRing[ri + 1];
            const mat = rings[ri].m === 4 && rings[ri + 1].m === 4 ? 4 : 12;
            for (let i = 0; i < sides; i++) {
                const j = (i + 1) % sides;
                this.addQuadOut(rA[i], rA[j], rB[j], rB[i], refCenter, mat, 0.0);
            }
        }
        // Inner & outer center hub caps
        const capInner = ptsPerRing[0];
        const cIn = [rings[0].x, 0, 0];
        const refIn = [rings[0].x + 0.15, 0, 0];
        for (let i = 0; i < sides; i++) {
            this.addTriOut(cIn, capInner[i], capInner[(i + 1) % sides], refIn, 4, 0.0);
        }
        const last = rings.length - 1;
        const capOuter = ptsPerRing[last];
        const cOut = [rings[last].x + 0.02, 0, 0];
        const refOut = [rings[last].x - 0.15, 0, 0];
        for (let i = 0; i < sides; i++) {
            this.addTriOut(cOut, capOuter[i], capOuter[(i + 1) % sides], refOut, 4, 0.0);
        }
        // Subtle 5-spoke outer hub raised ribs overlapping alloy dish cleanly
        for (let k = 0; k < 5; k++) {
            const ang = (k * Math.PI * 2) / 5;
            const sy = Math.sin(ang) * radius * 0.50;
            const sz = Math.cos(ang) * radius * 0.50;
            this.addBox(width * 0.36, Math.min(0, sy) - 0.022, Math.min(0, sz) - 0.022,
                width * 0.48, Math.max(0, sy) + 0.022, Math.max(0, sz) + 0.022, 4, 0.0);
        }
    }

    build() {
        return new Mesh({
            positions: new Float32Array(this.pos),
            normals: new Float32Array(this.nrm),
            uvs: new Float32Array(this.uvs),
            indices: new Uint32Array(this.idx),
        });
    }
}

export const ARCHETYPE_SPECS = [
    {
        // 0: Sports Sedan
        stations: [
            { z: -2.22, xBot: 0.72, xMid: 0.86, xBelt: 0.80, xCrown: 0.58, yBot: 0.21, ySill: 0.42, yBelt: 0.62, yCrown: 0.68, lowMat: 13, topMat: 13, sideMat: 13 },
            { z: -2.08, xBot: 0.82, xMid: 0.92, xBelt: 0.89, xCrown: 0.72, yBot: 0.19, ySill: 0.48, yBelt: 0.78, yCrown: 0.83, lowMat: 13, topMat: 6, sideMat: 6 },
            { z: -1.12, xBot: 0.84, xMid: 0.93, xBelt: 0.90, xCrown: 0.74, yBot: 0.18, ySill: 0.44, yBelt: 0.88, yCrown: 0.92, lowMat: 13, topMat: 6, sideMat: 6 },
            { z:  1.28, xBot: 0.84, xMid: 0.92, xBelt: 0.89, xCrown: 0.73, yBot: 0.18, ySill: 0.44, yBelt: 0.92, yCrown: 0.95, lowMat: 13, topMat: 6, sideMat: 6 },
            { z:  2.08, xBot: 0.82, xMid: 0.91, xBelt: 0.88, xCrown: 0.70, yBot: 0.20, ySill: 0.48, yBelt: 0.89, yCrown: 0.92, lowMat: 13, topMat: 6, sideMat: 6 },
            { z:  2.22, xBot: 0.70, xMid: 0.85, xBelt: 0.78, xCrown: 0.56, yBot: 0.24, ySill: 0.44, yBelt: 0.66, yCrown: 0.72, lowMat: 13, topMat: 13, sideMat: 13 },
        ],
        cabin: { zFBot: -1.00, zFTop: -0.44, zRTop: 0.62, zRBot: 1.22, wBot: 0.68, wTop: 0.62, yBot: 0.86, yTop: 1.44 },
        glass: { zFBot: -1.04, zFTop: -0.46, zRTop: 0.60, zRBot: 1.24, wBot: 0.79, wTop: 0.67, yBot: 0.68, yTop: 1.40 },
        mirrors: [-0.95, 0.95, 0.92, -0.78],
        lights: { yH: 0.66, zH: -2.19, yT: 0.76, zT: 2.18 },
    },
    {
        // 1: Modern SUV
        stations: [
            { z: -2.26, xBot: 0.78, xMid: 0.92, xBelt: 0.88, xCrown: 0.66, yBot: 0.26, ySill: 0.50, yBelt: 0.72, yCrown: 0.78, lowMat: 13, topMat: 13, sideMat: 13 },
            { z: -2.10, xBot: 0.88, xMid: 0.98, xBelt: 0.96, xCrown: 0.78, yBot: 0.24, ySill: 0.54, yBelt: 0.92, yCrown: 0.97, lowMat: 13, topMat: 6, sideMat: 6 },
            { z: -1.08, xBot: 0.88, xMid: 0.99, xBelt: 0.96, xCrown: 0.80, yBot: 0.24, ySill: 0.52, yBelt: 1.00, yCrown: 1.03, lowMat: 13, topMat: 6, sideMat: 6 },
            { z:  2.06, xBot: 0.86, xMid: 0.96, xBelt: 0.92, xCrown: 0.74, yBot: 0.25, ySill: 0.54, yBelt: 1.04, yCrown: 1.07, lowMat: 13, topMat: 6, sideMat: 6 },
            { z:  2.24, xBot: 0.76, xMid: 0.90, xBelt: 0.86, xCrown: 0.64, yBot: 0.28, ySill: 0.52, yBelt: 0.74, yCrown: 0.80, lowMat: 13, topMat: 13, sideMat: 13 },
        ],
        cabin: { zFBot: -1.02, zFTop: -0.50, zRTop: 1.44, zRBot: 1.98, wBot: 0.74, wTop: 0.68, yBot: 0.96, yTop: 1.70 },
        glass: { zFBot: -1.05, zFTop: -0.52, zRTop: 1.42, zRBot: 2.00, wBot: 0.86, wTop: 0.75, yBot: 0.80, yTop: 1.64 },
        mirrors: [-1.02, 1.02, 1.04, -0.82],
        lights: { yH: 0.78, zH: -2.18, yT: 0.88, zT: 2.16 },
    },
    {
        // 2: Fastback Coupe
        stations: [
            { z: -2.18, xBot: 0.74, xMid: 0.88, xBelt: 0.84, xCrown: 0.62, yBot: 0.17, ySill: 0.36, yBelt: 0.55, yCrown: 0.61, lowMat: 13, topMat: 13, sideMat: 13 },
            { z: -2.02, xBot: 0.84, xMid: 0.94, xBelt: 0.92, xCrown: 0.74, yBot: 0.16, ySill: 0.42, yBelt: 0.70, yCrown: 0.76, lowMat: 13, topMat: 6, sideMat: 6 },
            { z: -0.92, xBot: 0.86, xMid: 0.95, xBelt: 0.92, xCrown: 0.76, yBot: 0.16, ySill: 0.40, yBelt: 0.83, yCrown: 0.87, lowMat: 13, topMat: 6, sideMat: 6 },
            { z:  1.45, xBot: 0.86, xMid: 0.94, xBelt: 0.90, xCrown: 0.73, yBot: 0.16, ySill: 0.42, yBelt: 0.88, yCrown: 0.91, lowMat: 13, topMat: 6, sideMat: 6 },
            { z:  2.06, xBot: 0.82, xMid: 0.92, xBelt: 0.88, xCrown: 0.68, yBot: 0.18, ySill: 0.44, yBelt: 0.83, yCrown: 0.87, lowMat: 13, topMat: 6, sideMat: 6 },
            { z:  2.18, xBot: 0.70, xMid: 0.86, xBelt: 0.78, xCrown: 0.56, yBot: 0.22, ySill: 0.40, yBelt: 0.60, yCrown: 0.66, lowMat: 13, topMat: 13, sideMat: 13 },
        ],
        cabin: { zFBot: -0.88, zFTop: -0.22, zRTop: 0.48, zRBot: 1.40, wBot: 0.70, wTop: 0.60, yBot: 0.80, yTop: 1.36 },
        glass: { zFBot: -0.90, zFTop: -0.24, zRTop: 0.46, zRBot: 1.42, wBot: 0.82, wTop: 0.66, yBot: 0.62, yTop: 1.31 },
        mirrors: [-0.98, 0.98, 0.88, -0.68],
        lights: { yH: 0.58, zH: -2.10, yT: 0.72, zT: 2.12 },
    },
    {
        // 3: Commercial Delivery Van
        stations: [
            { z: -2.30, xBot: 0.82, xMid: 0.96, xBelt: 0.92, xCrown: 0.72, yBot: 0.22, ySill: 0.50, yBelt: 0.78, yCrown: 0.84, lowMat: 13, topMat: 13, sideMat: 13 },
            { z: -2.10, xBot: 0.90, xMid: 0.98, xBelt: 0.96, xCrown: 0.80, yBot: 0.22, ySill: 0.52, yBelt: 1.02, yCrown: 1.07, lowMat: 13, topMat: 6, sideMat: 6 },
            { z: -1.42, xBot: 0.80, xMid: 0.98, xBelt: 0.96, xCrown: 0.84, yBot: 0.16, ySill: 0.50, yBelt: 1.12, yCrown: 1.16, lowMat: 13, topMat: 6, sideMat: 6 },
            { z: -0.82, xBot: 0.80, xMid: 0.98, xBelt: 0.92, xCrown: 0.78, yBot: 0.16, ySill: 0.50, yBelt: 1.88, yCrown: 1.98, lowMat: 6, topMat: 6, sideMat: 6 },
            { z:  1.36, xBot: 0.80, xMid: 0.98, xBelt: 0.92, xCrown: 0.78, yBot: 0.16, ySill: 0.50, yBelt: 1.88, yCrown: 1.98, lowMat: 6, topMat: 6, sideMat: 6 },
            { z:  2.14, xBot: 0.80, xMid: 0.98, xBelt: 0.92, xCrown: 0.78, yBot: 0.16, ySill: 0.50, yBelt: 1.88, yCrown: 1.98, lowMat: 6, topMat: 6, sideMat: 6 },
            { z:  2.32, xBot: 0.82, xMid: 0.94, xBelt: 0.88, xCrown: 0.70, yBot: 0.26, ySill: 0.52, yBelt: 1.05, yCrown: 1.10, lowMat: 13, topMat: 13, sideMat: 13 },
        ],
        cabin: { zFBot: -1.38, zFTop: -0.82, zRTop: -0.05, zRBot: -0.02, wBot: 0.78, wTop: 0.72, yBot: 1.02, yTop: 1.94 },
        glass: { zFBot: -1.42, zFTop: -0.84, zRTop: -0.10, zRBot: -0.04, wBot: 0.90, wTop: 0.83, yBot: 1.00, yTop: 1.90 },
        mirrors: [-1.05, 1.05, 1.18, -1.25],
        lights: { yH: 0.78, zH: -2.27, yT: 0.86, zT: 2.28 },
    },
];

export function createBodyForArchetype(idx) {
    const spec = ARCHETYPE_SPECS[idx] || ARCHETYPE_SPECS[0];
    const m = new VehicleMeshAcc();
    m.addLoftedHull(spec.stations);
    // Tapered cabin core + flush painted roof cap for passenger cars (van uses integral high-roof hull)
    const c = spec.cabin;
    const g = spec.glass;
    if (idx !== 3) {
        m.addLoftedHull([
            { z: c.zFBot, xBot: c.wBot, xMid: c.wBot, xBelt: c.wBot, xCrown: c.wBot * 0.9, yBot: c.yBot - 0.14, ySill: c.yBot, yBelt: c.yBot + 0.04, yCrown: c.yBot + 0.06, lowMat: 13, topMat: 13, sideMat: 13 },
            { z: c.zFTop, xBot: c.wBot, xMid: c.wTop, xBelt: c.wTop, xCrown: c.wTop * 0.9, yBot: c.yBot - 0.14, ySill: c.yTop - 0.09, yBelt: c.yTop - 0.03, yCrown: c.yTop + 0.04, lowMat: 13, topMat: 6, sideMat: 13 },
            { z: c.zRTop, xBot: c.wBot, xMid: c.wTop, xBelt: c.wTop, xCrown: c.wTop * 0.9, yBot: c.yBot - 0.14, ySill: c.yTop - 0.09, yBelt: c.yTop - 0.03, yCrown: c.yTop + 0.04, lowMat: 13, topMat: 13, sideMat: 13 },
            { z: c.zRBot, xBot: c.wBot, xMid: c.wBot, xBelt: c.wBot, xCrown: c.wBot * 0.9, yBot: c.yBot - 0.14, ySill: c.yBot, yBelt: c.yBot + 0.04, yCrown: c.yBot + 0.06, lowMat: 13, topMat: 13, sideMat: 13 },
        ]);
        m.addBox(-c.wTop * 0.98, g.yTop - 0.02, c.zFTop, c.wTop * 0.98, c.yTop + 0.04, c.zRTop, 6, 0.0);
    }
    // Side mirrors overlapping A-pillar shoulder (stays 1 connected island)
    const [mxL, mxR, my, mz] = spec.mirrors;
    m.addBox(mxL - 0.08, my - 0.05, mz - 0.08, mxL + 0.28, my + 0.06, mz + 0.06, 13, 0.0);
    m.addBox(mxR - 0.28, my - 0.05, mz - 0.08, mxR + 0.08, my + 0.06, mz + 0.06, 13, 0.0);
    return m.build();
}

export function createGlassForArchetype(idx) {
    const g = (ARCHETYPE_SPECS[idx] || ARCHETYPE_SPECS[0]).glass;
    const m = new VehicleMeshAcc();
    const ref = [0, 0.5 * (g.yBot + g.yTop), 0.5 * (g.zFBot + g.zRBot)];
    const bFL = [-g.wBot, g.yBot, g.zFBot];
    const bFR = [ g.wBot, g.yBot, g.zFBot];
    const bRR = [ g.wBot, g.yBot, g.zRBot];
    const bRL = [-g.wBot, g.yBot, g.zRBot];

    const tFL = [-g.wTop, g.yTop, g.zFTop];
    const tFR = [ g.wTop, g.yTop, g.zFTop];
    const tRR = [ g.wTop, g.yTop, g.zRTop];
    const tRL = [-g.wTop, g.yTop, g.zRTop];

    m.addQuadOut(bFL, bFR, tFR, tFL, ref, 3, 0.0);
    m.addQuadOut(bRR, bRL, tRL, tRR, ref, 3, 0.0);
    m.addQuadOut(bRL, bFL, tFL, tRL, ref, 3, 0.0);
    m.addQuadOut(bFR, bRR, tRR, tFR, ref, 3, 0.0);
    m.addQuadOut(tFL, tFR, tRR, tRL, ref, 3, 0.0);
    m.addQuadOut(bRL, bRR, bFR, bFL, ref, 3, 0.0);
    return m.build();
}

export function createCarBodyMesh() {
    return createBodyForArchetype(0);
}

export function createCarGlassMesh() {
    return createGlassForArchetype(0);
}

export function createCarWheelMesh() {
    const m = new VehicleMeshAcc();
    m.addLatheWheel(0.32, 0.25, 20);
    return m.build();
}

export function createCarLightMesh() {
    const m = new VehicleMeshAcc();
    m.addBox(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 5, 0.52);
    return m.build();
}

export function registerCarBatches(pools) {
    const bodies = [];
    const glasses = [];
    for (let i = 0; i < ARCHETYPE_SPECS.length; i++) {
        bodies.push(pools.registerBatch(i === 0 ? 'car_body' : `car_body_${i}`, () => createBodyForArchetype(i), {
            capacity: 64, glowScale: 0.45, castsShadow: true, receivesShadow: true, doubleSided: false, drawOrder: 10, fadeOutDist: 280,
        }));
        glasses.push(pools.registerBatch(i === 0 ? 'car_glass' : `car_glass_${i}`, () => createGlassForArchetype(i), {
            capacity: 64, color: [0.06, 0.09, 0.12, 0.78], glowScale: 0.45, castsShadow: false, receivesShadow: true, doubleSided: false, drawOrder: 14, fadeOutDist: 280,
        }));
    }
    return {
        body: bodies[0],
        glass: glasses[0],
        bodies,
        glasses,
        wheel: pools.registerBatch('car_wheel', createCarWheelMesh, {
            capacity: 512, glowScale: 0.45, castsShadow: true, receivesShadow: true, doubleSided: false, drawOrder: 10, fadeOutDist: 280,
        }),
        light: pools.registerBatch('car_light', createCarLightMesh, {
            capacity: 512, glowScale: 0.45, castsShadow: true, receivesShadow: false, doubleSided: false, drawOrder: 11, fadeOutDist: 280,
        }),
    };
}

const WHEEL_OFFSETS = [
    [-0.84, 0.32, -1.36, true],
    [ 0.84, 0.32, -1.36, true],
    [-0.84, 0.32,  1.36, false],
    [ 0.84, 0.32,  1.36, false],
];

const _m34 = new Float32Array(12);

function emitSubPart(batch, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22, lx, ly, lz, steerY, spinX, sx, sy, sz, tint) {
    const px = relX + r00 * lx + r01 * ly + r02 * lz;
    const py = relY + r10 * lx + r11 * ly + r12 * lz;
    const pz = relZ + r20 * lx + r21 * ly + r22 * lz;

    const cy = Math.cos(steerY), syr = Math.sin(steerY);
    const cx = Math.cos(spinX), sxr = Math.sin(spinX);
    const l00 = cy * sx,       l01 = (syr * sxr) * sy, l02 = (syr * cx) * sz;
    const l10 = 0,             l11 = cx * sy,          l12 = (-sxr) * sz;
    const l20 = (-syr) * sx,   l21 = (cy * sxr) * sy,  l22 = (cy * cx) * sz;

    _m34[0] = r00 * l00 + r01 * l10 + r02 * l20;
    _m34[1] = r00 * l01 + r01 * l11 + r02 * l21;
    _m34[2] = r00 * l02 + r01 * l12 + r02 * l22;
    _m34[3] = px;

    _m34[4] = r10 * l00 + r11 * l10 + r12 * l20;
    _m34[5] = r10 * l01 + r11 * l11 + r12 * l21;
    _m34[6] = r10 * l02 + r11 * l12 + r12 * l22;
    _m34[7] = py;

    _m34[8] = r20 * l00 + r21 * l10 + r22 * l20;
    _m34[9] = r20 * l01 + r21 * l11 + r22 * l21;
    _m34[10] = r20 * l02 + r21 * l12 + r22 * l22;
    _m34[11] = pz;

    batch.pushLocalMatrix(_m34, tint);
}

export function pushCarVisual(batches, camPos, car, headTint, tailTint) {
    const rx = car.pitch || 0;
    const ry = car.yaw || 0;
    const rz = car.roll || 0;
    const spin = car.wheelSpin || 0;
    const steer = car.wheelSteer || 0;
    const arch = (car.archetype || 0) & 3;
    const bodyTint = car.color || [0.64, 0.12, 0.14, 1];
    const lightSpec = ARCHETYPE_SPECS[arch].lights;

    const bodyBatch = batches.bodies ? batches.bodies[arch] : batches.body;
    const glassBatch = batches.glasses ? batches.glasses[arch] : batches.glass;
    bodyBatch.pushRel(car.wx, car.wy, car.wz, camPos, rx, ry, rz, 1, 1, 1, bodyTint);
    glassBatch.pushRel(car.wx, car.wy, car.wz, camPos, rx, ry, rz, 1, 1, 1, [1, 1, 1, 1]);

    const relX = car.wx - camPos[0];
    const relY = car.wy - camPos[1];
    const relZ = car.wz - camPos[2];

    const cx = Math.cos(rx), sxr = Math.sin(rx);
    const cy = Math.cos(ry), syr = Math.sin(ry);
    const cz = Math.cos(rz), szr = Math.sin(rz);
    const r00 = cy * cz + syr * sxr * szr;
    const r01 = -cy * szr + syr * sxr * cz;
    const r02 = syr * cx;
    const r10 = cx * szr;
    const r11 = cx * cz;
    const r12 = -sxr;
    const r20 = -syr * cz + cy * sxr * szr;
    const r21 = syr * szr + cy * sxr * cz;
    const r22 = cy * cx;

    const wheelTint = [1, 1, 1, 1];
    for (let i = 0; i < 4; i++) {
        const w = WHEEL_OFFSETS[i];
        emitSubPart(
            batches.wheel, relX, relY, relZ,
            r00, r01, r02, r10, r11, r12, r20, r21, r22,
            w[0], w[1], w[2], w[3] ? steer : 0, spin, 1, 1, 1, wheelTint
        );
    }

    // Sleek wide LED headlights & crisp rear LED taillight bar (flush depth across outer hull skin)
    emitSubPart(batches.light, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22, -0.62, lightSpec.yH, lightSpec.zH, 0, 0, 0.34, 0.08, 0.05, headTint);
    emitSubPart(batches.light, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22,  0.62, lightSpec.yH, lightSpec.zH, 0, 0, 0.34, 0.08, 0.05, headTint);
    emitSubPart(batches.light, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22, -0.56, lightSpec.yT, lightSpec.zT, 0, 0, 0.44, 0.08, 0.05, tailTint);
    emitSubPart(batches.light, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22,  0.56, lightSpec.yT, lightSpec.zT, 0, 0, 0.44, 0.08, 0.05, tailTint);
}
