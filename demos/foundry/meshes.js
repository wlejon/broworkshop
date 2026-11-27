// demos/foundry/meshes.js — Multi-Material Precision Mechanical CAD Geometry Kit.
//
// Produces rich vertex streams for demos/foundry/shaders/foundry_part.bk:
//   positions: Float32Array (xyz)
//   normals:   Float32Array (unit xyz)
//   uvs:       Float32Array ([matId, param])
//   colors:    Float32Array ([rLin, gLin, bLin, ao])  (ao: 0=crevice, 0.5=neutral, 1=bright edge)
//   indices:   Uint32Array

const PI = Math.PI;
const TAU = 2 * PI;

export const MAT = {
    STEEL: 0,
    CAST: 1,
    BRASS: 2,
    COPPER: 3,
    RUBBER: 4,
    ARMOR: 5,
    GLOW: 6,
    CONCRETE: 7,
};

function toLin(c) {
    return [
        Math.pow(Math.max(0, Math.min(1, c[0])), 2.2),
        Math.pow(Math.max(0, Math.min(1, c[1])), 2.2),
        Math.pow(Math.max(0, Math.min(1, c[2])), 2.2),
    ];
}
export function shade(c, k) { return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]; }

export class PartBuilder {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }

    v(x, y, z, nx, ny, nz, mat, param, col, ao = 0.5) {
        const idx = this.p.length / 3;
        const lc = toLin(col);
        this.p.push(x, y, z);
        this.n.push(nx, ny, nz);
        this.u.push(mat, param);
        this.c.push(lc[0], lc[1], lc[2], ao);
        return idx;
    }

    tri(a, b, c) { this.i.push(a, b, c); }

    quad(p0, p1, p2, p3, mat, col, ao = 0.5, param = 0) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const a = this.v(p0[0], p0[1], p0[2], nx, ny, nz, mat, param, col, ao);
        const b = this.v(p1[0], p1[1], p1[2], nx, ny, nz, mat, param, col, ao);
        const c = this.v(p2[0], p2[1], p2[2], nx, ny, nz, mat, param, col, ao);
        const d = this.v(p3[0], p3[1], p3[2], nx, ny, nz, mat, param, col, ao);
        this.i.push(a, b, c, a, c, d);
    }

    box(cx, cy, cz, hx, hy, hz, mat = MAT.STEEL, col = [0.6, 0.64, 0.68], ao = 0.54, param = 0) {
        const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], mat, col, ao, param);
        this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], mat, col, ao, param);
        this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], mat, col, Math.min(0.88, ao + 0.12), param);
        this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], mat, col, Math.max(0.12, ao - 0.22), param);
        this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], mat, col, ao, param);
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], mat, col, ao, param);
    }

    cylZ(cx, cy, cz, r, len, segs = 22, mat = MAT.STEEL, col = [0.64, 0.68, 0.72], aoSide = 0.55, aoCap = 0.62, param = 0) {
        const z0 = cz - len * 0.5, z1 = cz + len * 0.5;
        const c0 = this.v(cx, cy, z0, 0, 0, -1, mat, param, col, aoCap * 0.85);
        const c1 = this.v(cx, cy, z1, 0, 0, 1, mat, param, col, aoCap * 0.85);
        for (let k = 0; k < segs; k++) {
            const a0 = (k / segs) * TAU, a1 = ((k + 1) / segs) * TAU;
            const ca0 = Math.cos(a0), sa0 = Math.sin(a0), ca1 = Math.cos(a1), sa1 = Math.sin(a1);
            const x0 = cx + r * ca0, y0 = cy + r * sa0, x1 = cx + r * ca1, y1 = cy + r * sa1;
            const s0 = this.v(x0, y0, z0, ca0, sa0, 0, mat, param, col, aoSide);
            const s1 = this.v(x1, y1, z0, ca1, sa1, 0, mat, param, col, aoSide);
            const s2 = this.v(x1, y1, z1, ca1, sa1, 0, mat, param, col, aoSide);
            const s3 = this.v(x0, y0, z1, ca0, sa0, 0, mat, param, col, aoSide);
            this.i.push(s0, s1, s2, s0, s2, s3);
            const f0 = this.v(x0, y0, z1, 0, 0, 1, mat, param, col, aoCap);
            const f1 = this.v(x1, y1, z1, 0, 0, 1, mat, param, col, aoCap);
            this.tri(c1, f0, f1);
            const b0 = this.v(x0, y0, z0, 0, 0, -1, mat, param, col, aoCap);
            const b1 = this.v(x1, y1, z0, 0, 0, -1, mat, param, col, aoCap);
            this.tri(c0, b1, b0);
        }
    }

    cylY(cx, cy, cz, r, len, segs = 20, mat = MAT.STEEL, col = [0.64, 0.68, 0.72], aoSide = 0.56, aoCap = 0.64, param = 0) {
        const y0 = cy - len * 0.5, y1 = cy + len * 0.5;
        const c0 = this.v(cx, y0, cz, 0, -1, 0, mat, param, col, aoCap * 0.8);
        const c1 = this.v(cx, y1, cz, 0, 1, 0, mat, param, col, aoCap * 0.85);
        for (let k = 0; k < segs; k++) {
            const a0 = (k / segs) * TAU, a1 = ((k + 1) / segs) * TAU;
            const ca0 = Math.cos(a0), sa0 = Math.sin(a0), ca1 = Math.cos(a1), sa1 = Math.sin(a1);
            const x0 = cx + r * ca0, z0 = cz + r * sa0, x1 = cx + r * ca1, z1 = cz + r * sa1;
            const s0 = this.v(x0, y0, z0, ca0, 0, sa0, mat, param, col, aoSide);
            const s1 = this.v(x1, y0, z1, ca1, 0, sa1, mat, param, col, aoSide);
            const s2 = this.v(x1, y1, z1, ca1, 0, sa1, mat, param, col, aoSide);
            const s3 = this.v(x0, y1, z0, ca0, 0, sa0, mat, param, col, aoSide);
            this.i.push(s0, s2, s1, s0, s3, s2);
            const f0 = this.v(x0, y1, z0, 0, 1, 0, mat, param, col, aoCap);
            const f1 = this.v(x1, y1, z1, 0, 1, 0, mat, param, col, aoCap);
            this.tri(c1, f1, f0);
            const b0 = this.v(x0, y0, z0, 0, -1, 0, mat, param, col, aoCap);
            const b1 = this.v(x1, y0, z1, 0, -1, 0, mat, param, col, aoCap);
            this.tri(c0, b0, b1);
        }
    }

    cylX(cx, cy, cz, r, len, segs = 24, mat = MAT.RUBBER, col = [0.16, 0.17, 0.19], aoSide = 0.5, aoCap = 0.55) {
        const x0 = cx - len * 0.5, x1 = cx + len * 0.5;
        const c0 = this.v(x0, cy, cz, -1, 0, 0, mat, 0, col, aoCap * 0.8);
        const c1 = this.v(x1, cy, cz, 1, 0, 0, mat, 0, col, aoCap * 0.8);
        for (let k = 0; k < segs; k++) {
            const a0 = (k / segs) * TAU, a1 = ((k + 1) / segs) * TAU;
            const ca0 = Math.cos(a0), sa0 = Math.sin(a0), ca1 = Math.cos(a1), sa1 = Math.sin(a1);
            const y0 = cy + r * ca0, z0 = cz + r * sa0, y1 = cy + r * ca1, z1 = cz + r * sa1;
            const s0 = this.v(x0, y0, z0, 0, ca0, sa0, mat, a0, col, aoSide);
            const s1 = this.v(x0, y1, z1, 0, ca1, sa1, mat, a1, col, aoSide);
            const s2 = this.v(x1, y1, z1, 0, ca1, sa1, mat, a1, col, aoSide);
            const s3 = this.v(x1, y0, z0, 0, ca0, sa0, mat, a0, col, aoSide);
            this.i.push(s0, s2, s1, s0, s3, s2);
            const f0 = this.v(x1, y0, z0, 1, 0, 0, mat, a0, col, aoCap);
            const f1 = this.v(x1, y1, z1, 1, 0, 0, mat, a1, col, aoCap);
            this.tri(c1, f1, f0);
            const b0 = this.v(x0, y0, z0, -1, 0, 0, mat, a0, col, aoCap);
            const b1 = this.v(x0, y1, z1, -1, 0, 0, mat, a1, col, aoCap);
            this.tri(c0, b0, b1);
        }
    }

    boltZ(cx, cy, cz, r, h, col = [0.74, 0.77, 0.82]) {
        this.cylZ(cx, cy, cz, r, h, 6, MAT.STEEL, col, 0.68, 0.80);
    }

    boltY(cx, cy, cz, r, h, col = [0.74, 0.77, 0.82]) {
        this.cylY(cx, cy, cz, r, h, 6, MAT.STEEL, col, 0.68, 0.80);
    }

    extrudeRing(pts, len, boreR, mat, col) {
        const z0 = -len * 0.5, z1 = len * 0.5, n = pts.length;
        for (let k = 0; k < n; k++) {
            const a = pts[k], b = pts[(k + 1) % n];
            const ao = 0.5 * ((a[2] ?? 0.5) + (b[2] ?? 0.5));
            this.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], mat, col, ao);
        }
        for (let k = 0; k < n; k++) {
            const a = pts[k], b = pts[(k + 1) % n];
            const aa = Math.atan2(a[1], a[0]), ab = Math.atan2(b[1], b[0]);
            const ia = [Math.cos(aa) * boreR, Math.sin(aa) * boreR];
            const ib = [Math.cos(ab) * boreR, Math.sin(ab) * boreR];
            const aoOuter = 0.5 * ((a[2] ?? 0.5) + (b[2] ?? 0.5));
            this.quad([ia[0], ia[1], z1], [a[0], a[1], z1], [b[0], b[1], z1], [ib[0], ib[1], z1], mat, col, aoOuter);
            this.quad([a[0], a[1], z0], [ia[0], ia[1], z0], [ib[0], ib[1], z0], [b[0], b[1], z0], mat, col, aoOuter);
            this.quad([ib[0], ib[1], z0], [ia[0], ia[1], z0], [ia[0], ia[1], z1], [ib[0], ib[1], z1], mat, shade(col, 0.68), 0.20);
        }
    }

    build() {
        return new bro.mesh.Mesh({
            positions: new Float32Array(this.p),
            normals: new Float32Array(this.n),
            uvs: new Float32Array(this.u),
            colors: new Float32Array(this.c),
            indices: new Uint32Array(this.i),
        });
    }
}

/** Precision machined involute spur gear with recessed web, spokes, darkened root crevices, and bolted hub. */
export function spurGearMesh(teeth, moduleM, faceWidthM, col = [0.60, 0.64, 0.70], matId = MAT.STEEL) {
    const z = Math.max(8, Math.min(64, Math.round(teeth)));
    const pitchR = 0.5 * moduleM * z;
    const addR = pitchR + 0.92 * moduleM;
    const rootR = Math.max(pitchR * 0.45, pitchR - 1.15 * moduleM);
    const rimInner = rootR * 0.74;
    const boreR = Math.min(rootR * 0.34, Math.max(0.004, pitchR * 0.22));
    const hubR = Math.min(rimInner * 0.78, Math.max(boreR * 1.9, pitchR * 0.36));

    const pts = [];
    for (let t = 0; t < z; t++) {
        const base = (t / z) * TAU;
        const step = TAU / z;
        const pt = (a, r, ao) => [Math.cos(a) * r, Math.sin(a) * r, ao];
        pts.push(
            pt(base + step * 0.05, rootR, 0.14),
            pt(base + step * 0.19, pitchR, 0.56),
            pt(base + step * 0.29, addR, 0.88),
            pt(base + step * 0.51, addR, 0.88),
            pt(base + step * 0.61, pitchR, 0.56),
            pt(base + step * 0.75, rootR, 0.14),
        );
    }

    const b = new PartBuilder();
    b.extrudeRing(pts, faceWidthM, Math.max(boreR, rimInner), matId, col);
    if (rimInner > hubR * 1.12) {
        b.cylZ(0, 0, 0, rimInner * 1.02, faceWidthM * 0.40, 24, MAT.CAST, shade(col, 0.64), 0.34, 0.26);
        const spokes = 5;
        const spokeL = (rimInner - hubR) * 0.55;
        const spokeR = (rimInner + hubR) * 0.5;
        for (let k = 0; k < spokes; k++) {
            const a = (k / spokes) * TAU;
            b.box(Math.cos(a) * spokeR, Math.sin(a) * spokeR, 0, Math.max(0.003, spokeL * 0.54), Math.max(0.003, spokeL * 0.54), faceWidthM * 0.36, matId, shade(col, 0.88), 0.62);
        }
    }
    b.cylZ(0, 0, 0, hubR, faceWidthM * 1.32, 18, matId, shade(col, 1.04), 0.64, 0.72);
    // Steel keyed axle stub seated inside bore
    b.cylZ(0, 0, 0, boreR * 0.94, faceWidthM * 1.65, 14, MAT.STEEL, [0.76, 0.79, 0.84], 0.70, 0.76);
    if (hubR > 0.014) {
        for (let k = 0; k < 4; k++) {
            const a = (k / 4) * TAU + PI / 4;
            b.boltZ(Math.cos(a) * hubR * 0.72, Math.sin(a) * hubR * 0.72, faceWidthM * 0.70, hubR * 0.14, faceWidthM * 0.14);
        }
    }
    return b.build();
}

/** Pillow-block bearing with cast-iron base, mounting bolts, machined race, and visible chrome balls/bronze sleeve. */
export function bearingMesh(boreM, kind = 'ball') {
    const d = Math.max(0.008, boreM);
    const od = d * 2.1, w = d * 0.85;
    const b = new PartBuilder();
    const segs = 22, pts = [];
    for (let k = 0; k < segs; k++) {
        const a = (k / segs) * TAU;
        pts.push([Math.cos(a) * od * 0.54, Math.sin(a) * od * 0.54, 0.58]);
    }
    b.extrudeRing(pts, w, od * 0.42, MAT.CAST, [0.22, 0.25, 0.29]);
    b.box(0, -od * 0.48, 0, od * 0.78, od * 0.15, w * 0.52, MAT.CAST, [0.20, 0.23, 0.27], 0.48);
    for (const sx of [-1, 1]) {
        b.boltY(sx * od * 0.58, -od * 0.31, 0, od * 0.09, od * 0.12);
    }
    const innerMat = kind === 'bushing' ? MAT.BRASS : MAT.STEEL;
    const innerCol = kind === 'bushing' ? [0.78, 0.54, 0.24] : [0.72, 0.75, 0.80];
    const iPts = [];
    for (let k = 0; k < 18; k++) {
        const a = (k / 18) * TAU;
        iPts.push([Math.cos(a) * d * 0.76, Math.sin(a) * d * 0.76, 0.72]);
    }
    b.extrudeRing(iPts, w * 1.12, d * 0.52, innerMat, innerCol);
    // Steel journal sleeve through bearing bore
    b.cylZ(0, 0, 0, d * 0.48, w * 1.55, 14, MAT.STEEL, [0.74, 0.77, 0.82], 0.68, 0.74);

    if (kind !== 'bushing') {
        const count = kind === 'roller' ? 10 : 8;
        const ringR = (od * 0.42 + d * 0.76) * 0.5;
        const ballR = Math.max(0.002, (od * 0.42 - d * 0.76) * 0.44);
        for (let k = 0; k < count; k++) {
            const a = (k / count) * TAU;
            b.cylZ(Math.cos(a) * ringR, Math.sin(a) * ringR, 0, ballR, w * 0.72, 10, MAT.STEEL, [0.84, 0.87, 0.90], 0.80, 0.86);
        }
    }
    return b.build();
}

/** Brushless industrial motor with ribbed barrel, visible wound copper coils, and bolted endbells. */
export function motorMesh(size) {
    const r = Math.max(0.02, Math.min(size[0], size[1]) * 0.5);
    const len = Math.max(0.04, size[2]);
    const b = new PartBuilder();
    b.cylZ(0, 0, 0, r * 0.78, len * 0.66, 22, MAT.COPPER, [0.84, 0.44, 0.16], 0.56, 0.50);
    const fins = 12;
    for (let k = 0; k < fins; k++) {
        const a = (k / fins) * TAU;
        b.box(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, 0, r * 0.13, r * 0.13, len * 0.34, MAT.CAST, [0.18, 0.21, 0.26], 0.60);
    }
    b.cylZ(0, 0, len * 0.38, r * 0.92, len * 0.18, 22, MAT.STEEL, [0.68, 0.72, 0.76], 0.64, 0.72);
    b.cylZ(0, 0, -len * 0.38, r * 0.90, len * 0.16, 22, MAT.STEEL, [0.60, 0.64, 0.68], 0.56, 0.66);
    for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + PI / 4;
        b.boltZ(Math.cos(a) * r * 0.70, Math.sin(a) * r * 0.70, len * 0.49, r * 0.10, len * 0.05);
    }
    b.cylZ(0, 0, len * 0.52, r * 0.24, len * 0.20, 14, MAT.STEEL, [0.80, 0.83, 0.87], 0.74, 0.80);
    b.box(0, -r * 0.90, 0, r * 0.92, r * 0.14, len * 0.40, MAT.CAST, [0.18, 0.21, 0.25], 0.44);
    return b.build();
}

/** Heavy multi-cylinder industrial V8/inline diesel engine (with twin turbos & flywheel bellhousing!). */
export function engineMesh(size, cylinders = 8) {
    const [W, H, L] = size;
    const b = new PartBuilder();
    // Heavy industrial enamel V-block crankcase & deep finned oil sump
    b.box(0, -H * 0.08, 0, W * 0.36, H * 0.28, L * 0.44, MAT.ARMOR, [0.76, 0.52, 0.12], 0.56);
    b.box(0, -H * 0.40, 0, W * 0.30, H * 0.11, L * 0.42, MAT.CAST, [0.16, 0.18, 0.21], 0.32);
    // Heavy steel mounting skids along crankcase bottom
    for (const sx of [-1, 1]) {
        b.box(sx * W * 0.42, -H * 0.38, 0, W * 0.08, H * 0.08, L * 0.44, MAT.CAST, [0.22, 0.24, 0.28], 0.50);
    }

    const perBank = cylinders >= 4 ? Math.ceil(cylinders / 2) : cylinders;
    const banks = cylinders >= 4 ? [-1, 1] : [0];
    for (const side of banks) {
        for (let k = 0; k < perBank; k++) {
            const z = perBank > 1 ? (-0.34 + (0.68 * k) / (perBank - 1)) * L : 0;
            const x = side * W * 0.26;
            b.box(x, H * 0.20, z, W * 0.16, H * 0.22, (L * 0.33) / Math.max(1, perBank), MAT.STEEL, [0.64, 0.68, 0.72], 0.60);
            b.box(side * W * 0.45, H * 0.18, z, W * 0.09, H * 0.06, (L * 0.16) / Math.max(1, perBank), MAT.BRASS, [0.64, 0.46, 0.32], 0.56);
        }
        // Crimson heavy diesel valve cover + longitudinal exhaust log
        b.box(side * W * 0.27, H * 0.44, 0, W * 0.17, H * 0.065, L * 0.43, MAT.ARMOR, [0.66, 0.18, 0.14], 0.68);
        b.cylZ(side * W * 0.50, H * 0.18, 0, H * 0.075, L * 0.80, 12, MAT.BRASS, [0.58, 0.42, 0.30], 0.52, 0.56);
        // Twin front turbocharger snails
        b.cylZ(side * W * 0.24, H * 0.56, L * 0.24, H * 0.14, L * 0.16, 16, MAT.STEEL, [0.74, 0.77, 0.82], 0.70, 0.76);
    }
    // Cast intake intercooler plenum + heavy flywheel bellhousing on output end
    b.box(0, H * 0.42, -L * 0.06, W * 0.14, H * 0.12, L * 0.34, MAT.STEEL, [0.70, 0.74, 0.78], 0.66);
    b.cylZ(0, -H * 0.04, L * 0.46, H * 0.34, L * 0.14, 22, MAT.CAST, [0.24, 0.27, 0.31], 0.58, 0.66);
    b.cylZ(0, -H * 0.04, L * 0.54, H * 0.14, L * 0.10, 16, MAT.STEEL, [0.76, 0.79, 0.84], 0.72, 0.78);
    return b.build();
}

/** Armored battery pack with cooling ribs, copper busbars, and live charge LED strip. */
export function batteryMesh(size) {
    const [W, H, D] = size;
    const b = new PartBuilder();
    b.box(0, 0, 0, W * 0.48, H * 0.44, D * 0.48, MAT.ARMOR, [0.14, 0.32, 0.48], 0.56);
    b.box(0, H * 0.45, 0, W * 0.50, H * 0.06, D * 0.50, MAT.CAST, [0.18, 0.21, 0.25], 0.62);
    b.box(-W * 0.25, H * 0.52, D * 0.32, W * 0.08, H * 0.08, D * 0.08, MAT.ARMOR, [0.82, 0.18, 0.14], 0.76);
    b.box(W * 0.25, H * 0.52, D * 0.32, W * 0.08, H * 0.08, D * 0.08, MAT.CAST, [0.16, 0.18, 0.20], 0.68);
    b.box(0, H * 0.49, -D * 0.30, W * 0.28, H * 0.03, D * 0.04, MAT.GLOW, [0.18, 0.88, 0.95], 0.8, 1.0);
    return b.build();
}

/** Spoked heavy flywheel rotor with lathe-turned outer inertia ring & recessed hub. */
export function flywheelMesh(r, thickness, col = [0.52, 0.56, 0.62]) {
    const b = new PartBuilder();
    const pts = [], segs = 30;
    for (let k = 0; k < segs; k++) {
        const a = (k / segs) * TAU;
        pts.push([Math.cos(a) * r, Math.sin(a) * r, 0.70]);
    }
    b.extrudeRing(pts, thickness, r * 0.64, MAT.STEEL, col);
    b.cylZ(0, 0, 0, r * 0.66, thickness * 0.28, 24, MAT.CAST, shade(col, 0.56), 0.28, 0.24);
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        b.box(Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44, 0, r * 0.15, r * 0.15, thickness * 0.44, MAT.STEEL, shade(col, 0.90), 0.62);
    }
    b.cylZ(0, 0, 0, r * 0.28, thickness * 1.36, 18, MAT.STEEL, shade(col, 1.08), 0.68, 0.76);
    return b.build();
}

/** Vented slip clutch with twin pressure plates, bronze friction disc, and spring bosses. */
export function clutchMesh(r, len) {
    const b = new PartBuilder();
    b.cylZ(0, 0, -len * 0.24, r, len * 0.30, 24, MAT.CAST, [0.28, 0.24, 0.34], 0.58, 0.66);
    b.cylZ(0, 0, len * 0.24, r * 0.96, len * 0.30, 24, MAT.CAST, [0.28, 0.24, 0.34], 0.58, 0.66);
    b.cylZ(0, 0, 0, r * 0.92, len * 0.20, 24, MAT.BRASS, [0.80, 0.44, 0.22], 0.70, 0.64);
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        b.cylZ(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72, 0, r * 0.10, len * 0.86, 8, MAT.STEEL, [0.72, 0.75, 0.80], 0.72, 0.78);
    }
    return b.build();
}

/** Machined twin-flange shear-pin hub with gleaming brass sacrificial cross-pin. */
export function shearPinMesh(r, len, snapped = false) {
    const b = new PartBuilder();
    const gap = snapped ? len * 0.32 : len * 0.05;
    b.cylZ(0, 0, -len * 0.24 - gap, r, len * 0.36, 18, MAT.STEEL, [0.64, 0.68, 0.72], 0.64, 0.72);
    b.cylZ(0, 0, len * 0.24 + gap, r, len * 0.36, 18, MAT.STEEL, [0.64, 0.68, 0.72], 0.64, 0.72);
    const pinCol = snapped ? [0.95, 0.24, 0.14] : [0.90, 0.70, 0.22];
    if (!snapped) {
        b.box(0, 0, 0, r * 1.32, r * 0.26, r * 0.26, MAT.BRASS, pinCol, 0.82);
    } else {
        b.box(-r * 0.72, r * 0.18, -gap, r * 0.48, r * 0.24, r * 0.24, MAT.BRASS, pinCol, 0.82);
        b.box(r * 0.72, -r * 0.18, gap, r * 0.48, r * 0.24, r * 0.24, MAT.BRASS, pinCol, 0.82);
    }
    return b.build();
}

/** Machined drive shaft with stepped shoulders. */
export function shaftMesh(r, len, col = [0.74, 0.78, 0.82]) {
    const b = new PartBuilder();
    b.cylZ(0, 0, 0, r, len, 16, MAT.STEEL, col, 0.68, 0.76);
    b.cylZ(0, 0, -len * 0.38, r * 1.35, len * 0.10, 16, MAT.STEEL, shade(col, 0.88), 0.62, 0.70);
    b.cylZ(0, 0, len * 0.38, r * 1.35, len * 0.10, 16, MAT.STEEL, shade(col, 0.88), 0.62, 0.70);
    return b.build();
}

/** Connecting shaft + bolted flange couplers spanning exactly along Z from -len/2 to +len/2. */
export function couplerShaftMesh(len, r = 0.011) {
    const b = new PartBuilder();
    b.cylZ(0, 0, 0, r, len, 14, MAT.STEEL, [0.70, 0.74, 0.79], 0.66, 0.74);
    if (len > 0.03) {
        const fr = r * 1.55, fl = Math.min(0.016, len * 0.18);
        b.cylZ(0, 0, -len * 0.36, fr, fl, 14, MAT.CAST, [0.26, 0.29, 0.34], 0.56, 0.64);
        b.cylZ(0, 0, len * 0.36, fr, fl, 14, MAT.CAST, [0.26, 0.29, 0.34], 0.56, 0.64);
    }
    return b.build();
}

/** Cardan Double Universal-Joint (U-Joint) driveshaft for moderate shaft offsets (10°–28°). */
export function cardanShaftMesh(len, r = 0.011) {
    const b = new PartBuilder();
    const uOff = Math.max(0.014, len * 0.5 - Math.min(0.032, len * 0.16));
    // Splined telescoping center steel shaft
    b.cylZ(0, 0, 0, r * 0.96, Math.max(0.01, len - Math.min(0.06, len * 0.28)), 14, MAT.STEEL, [0.68, 0.72, 0.78], 0.68, 0.76);
    b.cylZ(0, 0, 0, r * 1.25, Math.min(0.032, len * 0.24), 12, MAT.CAST, [0.26, 0.29, 0.34], 0.58, 0.66);
    // Forged steel U-joint clevis yokes + brass cross-trunnion spiders at BOTH ends!
    for (const sz of [-1, 1]) {
        const z = sz * uOff;
        b.cylZ(0, 0, z + sz * r * 1.1, r * 1.50, r * 1.35, 14, MAT.CAST, [0.24, 0.27, 0.32], 0.56, 0.64);
        b.cylX(0, 0, z, r * 0.58, r * 3.1, 10, MAT.BRASS, [0.88, 0.68, 0.22], 0.76, 0.82);
        b.cylY(0, 0, z, r * 0.58, r * 3.1, 10, MAT.BRASS, [0.88, 0.68, 0.22], 0.76, 0.82);
        b.box(0, r * 1.15, z - sz * r * 0.75, r * 0.55, r * 0.32, r * 1.15, MAT.STEEL, [0.62, 0.66, 0.72], 0.68);
        b.box(0, -r * 1.15, z - sz * r * 0.75, r * 0.55, r * 0.32, r * 1.15, MAT.STEEL, [0.62, 0.66, 0.72], 0.68);
    }
    return b.build();
}

/** Compact bolted cast-iron 90° Miter/Bevel Transfer Junction Block for orthogonal shaft corners. */
export function miterBoxMesh(r = 0.011) {
    const s = Math.max(0.018, r * 2.45);
    const b = new PartBuilder();
    b.box(0, 0, 0, s, s, s, MAT.CAST, [0.22, 0.25, 0.30], 0.56);
    b.cylX(0, 0, 0, s * 0.68, s * 2.28, 14, MAT.BRASS, [0.84, 0.64, 0.22], 0.74, 0.80);
    b.cylY(0, 0, 0, s * 0.68, s * 2.28, 14, MAT.STEEL, [0.64, 0.68, 0.74], 0.68, 0.74);
    b.cylZ(0, 0, 0, s * 0.68, s * 2.28, 14, MAT.STEEL, [0.64, 0.68, 0.74], 0.68, 0.74);
    return b.build();
}

/** High-pressure braided rubber hydraulic hose with hex brass swivel crimp fittings at both ends. */
export function hydHoseMesh(len, r = 0.008) {
    const b = new PartBuilder();
    b.cylZ(0, 0, 0, r * 0.92, len, 12, MAT.RUBBER, [0.14, 0.16, 0.20], 0.46, 0.40);
    if (len > 0.025) {
        const fl = Math.min(0.022, len * 0.20);
        b.cylZ(0, 0, -len * 0.5 + fl * 0.6, r * 1.48, fl, 6, MAT.BRASS, [0.88, 0.68, 0.22], 0.76, 0.82);
        b.cylZ(0, 0, len * 0.5 - fl * 0.6, r * 1.48, fl, 6, MAT.BRASS, [0.88, 0.68, 0.22], 0.76, 0.82);
    }
    return b.build();
}

/** Wound torsion spring actuator with stacked coils & clevis end plates. */
export function springMesh(r, len) {
    const b = new PartBuilder();
    b.cylZ(0, 0, 0, r * 0.45, len * 0.96, 14, MAT.CAST, [0.22, 0.24, 0.28], 0.35, 0.45);
    const coils = 6;
    for (let k = 0; k < coils; k++) {
        const z = (-0.36 + (0.72 * k) / (coils - 1)) * len;
        b.cylZ(0, 0, z, r * 0.94, len * 0.08, 20, MAT.STEEL, [0.58, 0.38, 0.88], 0.72, 0.78);
    }
    b.cylZ(0, 0, -len * 0.45, r * 1.05, len * 0.10, 18, MAT.CAST, [0.26, 0.28, 0.32], 0.58, 0.68);
    b.cylZ(0, 0, len * 0.45, r * 1.05, len * 0.10, 18, MAT.CAST, [0.26, 0.28, 0.32], 0.58, 0.68);
    return b.build();
}

/** CNC-milled box-tube combat chassis frame OR open 4-post industrial H-frame press when tall! */
export function frameMesh(W, H, L, col = [0.22, 0.26, 0.32]) {
    const b = new PartBuilder();
    const hw = W * 0.5, hh = H * 0.5, hl = L * 0.5;

    // Tall machine frame (e.g. 25t Workshop Forging Press): build open 4-post industrial H-frame!
    if (H > Math.min(W, L) * 0.65) {
        const colR = Math.max(0.035, Math.min(W, L) * 0.065);
        const slabH = Math.max(0.055, H * 0.085);
        // Heavy cast-iron base bolster bed + bolted top crown platen
        b.box(0, -hh + slabH * 0.5, 0, hw, slabH * 0.5, hl, MAT.CAST, shade(col, 0.78), 0.44);
        b.box(0, hh - slabH * 0.5, 0, hw, slabH * 0.5, hl, MAT.ARMOR, col, 0.66);
        // 4 gleaming machined alloy steel tie-columns at corners
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const x = sx * (hw - colR * 1.4), z = sz * (hl - colR * 1.4);
            b.cylY(x, 0, z, colR, H - slabH * 1.6, 16, MAT.STEEL, [0.70, 0.74, 0.80], 0.68, 0.76);
            b.boltY(x, hh + 0.014, z, colR * 1.25, 0.028, [0.80, 0.84, 0.88]);
        }
        return b.build();
    }

    const t = Math.max(0.018, Math.min(W, H) * 0.13);
    // Heavy bolted bottom belly pan + low recessed mounting cross-ribs (never slices internal motors!)
    b.box(0, -hh + t * 0.34, 0, hw - t * 0.1, t * 0.34, hl - t * 0.1, MAT.ARMOR, shade(col, 0.76), 0.38);
    b.box(0, -hh + t * 0.72, -hl * 0.35, hw - t * 1.0, t * 0.22, t * 0.45, MAT.CAST, shade(col, 0.84), 0.48);
    b.box(0, -hh + t * 0.72, hl * 0.25, hw - t * 1.0, t * 0.22, t * 0.45, MAT.CAST, shade(col, 0.84), 0.48);
    // Rear cross-bulkhead & split front bulkhead with central weapon shaft portal!
    b.box(0, 0, -hl + t * 0.5, hw, hh, t * 0.5, MAT.ARMOR, col, 0.60);
    const portalW = Math.min(hw * 0.26, 0.085);
    const cheekW = Math.max(t, (hw - portalW) * 0.5);
    b.box(-(portalW + cheekW), 0, hl - t * 0.5, cheekW, hh * 0.86, t * 0.5, MAT.ARMOR, col, 0.64);
    b.box((portalW + cheekW), 0, hl - t * 0.5, cheekW, hh * 0.86, t * 0.5, MAT.ARMOR, col, 0.64);
    b.box(0, -hh * 0.58, hl - t * 0.5, portalW, hh * 0.28, t * 0.5, MAT.CAST, shade(col, 0.82), 0.52);
    // Left & right longitudinal side rails (top & bottom chord with clean open wheel arch!)
    for (const sx of [-1, 1]) {
        const x = sx * (hw - t * 0.5);
        b.box(x, hh - t * 0.45, 0, t * 0.5, t * 0.45, hl, MAT.ARMOR, shade(col, 1.06), 0.72);
        b.box(x, -hh + t * 0.5, 0, t * 0.5, t * 0.5, hl, MAT.ARMOR, shade(col, 0.90), 0.50);
        // Front & rear vertical corner stanchions + gusset blocks
        b.box(x, 0, hl - t * 0.7, t * 0.56, hh, t * 0.7, MAT.CAST, shade(col, 0.84), 0.62);
        b.box(x, 0, -hl + t * 0.7, t * 0.56, hh, t * 0.7, MAT.CAST, shade(col, 0.84), 0.62);
        // Countersunk hex bolts along top rail
        for (let k = -3; k <= 3; k++) {
            b.boltY(x, hh + 0.002, k * (hl * 0.27), t * 0.24, 0.006);
        }
    }
    return b.build();
}

/** Sloped AR500 Hardox front plow / nose armor with bright wear lip & countersunk armor bolts. */
export function wedgeArmorMesh(w, h, d, col = [0.26, 0.31, 0.37]) {
    const b = new PartBuilder();
    const hw = w * 0.5, hh = h * 0.5, hd = d * 0.5;
    const fl = [-hw, -hh, hd], fr = [hw, -hh, hd];
    const bl = [-hw, -hh, -hd], br = [hw, -hh, -hd];
    const tl = [-hw, hh, -hd], tr = [hw, hh, -hd];
    b.quad(tl, tr, fr, fl, MAT.ARMOR, col, 0.70);
    b.quad(br, bl, tl, tr, MAT.CAST, shade(col, 0.74), 0.34);
    b.quad(bl, br, fr, fl, MAT.CAST, shade(col, 0.58), 0.24);
    const sl0 = b.v(...bl, -1, 0, 0, MAT.ARMOR, 0, col, 0.54);
    const sl1 = b.v(...fl, -1, 0, 0, MAT.ARMOR, 0, col, 0.66);
    const sl2 = b.v(...tl, -1, 0, 0, MAT.ARMOR, 0, col, 0.66);
    b.tri(sl0, sl1, sl2);
    const sr0 = b.v(...br, 1, 0, 0, MAT.ARMOR, 0, col, 0.54);
    const sr1 = b.v(...tr, 1, 0, 0, MAT.ARMOR, 0, col, 0.66);
    const sr2 = b.v(...fr, 1, 0, 0, MAT.ARMOR, 0, col, 0.66);
    b.tri(sr0, sr1, sr2);
    b.box(0, -hh + 0.011, hd + 0.007, hw * 0.98, 0.011, 0.014, MAT.STEEL, [0.70, 0.74, 0.79], 0.80);
    for (let k = -2; k <= 2; k++) {
        b.boltY(k * hw * 0.36, hh * 0.38, -hd * 0.32, 0.010, 0.012);
    }
    return b.build();
}

/** Sculpted 5-spoke aluminum drive wheel with moulded rubber tread (rotates about X). */
export function wheelMesh(r, w) {
    const b = new PartBuilder();
    b.cylX(0, 0, 0, r, w, 26, MAT.RUBBER, [0.13, 0.14, 0.16], 0.50, 0.42);
    b.cylX(0, 0, 0, r * 0.64, w * 1.04, 20, MAT.STEEL, [0.64, 0.68, 0.72], 0.62, 0.68);
    b.cylX(0, 0, 0, r * 0.30, w * 1.12, 14, MAT.CAST, [0.20, 0.23, 0.28], 0.42, 0.50);
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        b.box(0, Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46, w * 0.56, r * 0.075, r * 0.075, MAT.STEEL, [0.76, 0.79, 0.83], 0.78);
    }
    return b.build();
}

/** Heavy beveled S7 tool-steel horizontal spinner bar with crimson carbide tooth tips & vertical spindle hub. */
export function spinnerBarMesh(radiusM) {
    const r = Math.max(0.14, radiusM);
    const b = new PartBuilder();
    // Forged dark tool-steel bar body
    b.box(0, 0, 0, r * 0.96, 0.019, 0.044, MAT.STEEL, [0.42, 0.46, 0.52], 0.62);
    // Raised center structural rib along bar
    b.box(0, 0.016, 0, r * 0.72, 0.007, 0.022, MAT.CAST, [0.24, 0.27, 0.32], 0.58);
    // Hardened crimson-coated S7 impact teeth at leading tips
    b.box(r * 0.85, 0.002, 0.038, r * 0.14, 0.023, 0.026, MAT.ARMOR, [0.84, 0.20, 0.14], 0.82);
    b.box(-r * 0.85, 0.002, -0.038, r * 0.14, 0.023, 0.026, MAT.ARMOR, [0.84, 0.20, 0.14], 0.82);
    // Bright replaceable tungsten-carbide tooth tips
    b.box(r * 0.94, 0.002, 0.056, r * 0.05, 0.018, 0.010, MAT.STEEL, [0.82, 0.85, 0.90], 0.88);
    b.box(-r * 0.94, 0.002, -0.056, r * 0.05, 0.018, 0.010, MAT.STEEL, [0.82, 0.85, 0.90], 0.88);
    // Machined cylindrical vertical spindle collar + top castle locknut + 6 hex bolts
    const hubR = Math.min(0.064, r * 0.19);
    b.cylY(0, 0, 0, hubR, 0.056, 20, MAT.CAST, [0.22, 0.25, 0.30], 0.58, 0.66);
    b.cylY(0, 0.034, 0, hubR * 0.45, 0.018, 6, MAT.BRASS, [0.82, 0.64, 0.24], 0.74, 0.80);
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        b.boltY(Math.cos(a) * hubR * 0.74, 0.031, Math.sin(a) * hubR * 0.74, 0.007, 0.010);
    }
    return b.build();
}

/** Stationary 90-degree cast-iron bevel gearhead & weapon spindle turret under the horizontal spinner bar. */
export function spinnerTurretMesh() {
    const b = new PartBuilder();
    b.box(0, -0.044, -0.02, 0.052, 0.034, 0.068, MAT.CAST, [0.22, 0.25, 0.30], 0.54);
    b.cylY(0, -0.012, 0, 0.036, 0.042, 18, MAT.STEEL, [0.62, 0.66, 0.70], 0.62, 0.68);
    b.cylZ(0, -0.044, -0.088, 0.024, 0.038, 16, MAT.STEEL, [0.66, 0.70, 0.74], 0.64, 0.70);
    return b.build();
}

/** Overhead combat hammer arm with truss spar and heavy forged pick head. */
export function hammerArmMesh(reachM) {
    const r = Math.max(0.2, reachM);
    const b = new PartBuilder();
    b.box(0, 0, 0, 0.028, r * 0.48, 0.036, MAT.STEEL, [0.54, 0.58, 0.64], 0.66);
    b.box(0, r * 0.44, 0.04, 0.068, 0.055, 0.13, MAT.ARMOR, [0.80, 0.22, 0.16], 0.78);
    b.box(0, r * 0.44, 0.16, 0.024, 0.028, 0.055, MAT.STEEL, [0.80, 0.84, 0.88], 0.88);
    return b.build();
}

/** Cast-iron T-slot precision dyno bench bed (grounds Tier 1 subassemblies). */
export function dynoBedMesh(w, d, h = 0.022) {
    const b = new PartBuilder();
    b.box(0, -h * 0.5, 0, w * 0.5, h * 0.5, d * 0.5, MAT.CAST, [0.15, 0.17, 0.21], 0.46);
    // Machined bright steel T-slot rails running along Z
    const slots = 4;
    for (let k = 0; k < slots; k++) {
        const x = (-0.36 + (0.72 * k) / (slots - 1)) * w;
        b.box(x, 0.001, 0, w * 0.028, 0.002, d * 0.47, MAT.STEEL, [0.52, 0.56, 0.62], 0.68);
    }
    // 4 rubber/cast leveling feet
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.cylY(sx * w * 0.43, -h - 0.006, sz * d * 0.43, Math.min(w, d) * 0.055, 0.012, 12, MAT.RUBBER, [0.12, 0.13, 0.15], 0.4, 0.4);
    }
    return b.build();
}

/** Heavy steel I-beam gantry skid frame (grounds Tier 3 multi-storey Titan modules). */
export function titanGantryMesh(w, d, h = 0.18) {
    const b = new PartBuilder();
    for (const sx of [-1, 1]) {
        const x = sx * (w * 0.42);
        // Main longitudinal steel I-beam (top flange, web, bottom flange)
        b.box(x, -h * 0.12, 0, 0.14, h * 0.12, d * 0.5, MAT.ARMOR, [0.24, 0.27, 0.32], 0.64);
        b.box(x, -h * 0.50, 0, 0.04, h * 0.34, d * 0.49, MAT.CAST, [0.18, 0.20, 0.24], 0.42);
        b.box(x, -h * 0.88, 0, 0.15, h * 0.12, d * 0.5, MAT.ARMOR, [0.22, 0.25, 0.30], 0.46);
        // Yellow industrial end safety bumpers
        b.box(x, -h * 0.5, d * 0.505, 0.15, h * 0.46, 0.03, MAT.ARMOR, [0.82, 0.58, 0.08], 0.76);
        b.box(x, -h * 0.5, -d * 0.505, 0.15, h * 0.46, 0.03, MAT.ARMOR, [0.82, 0.58, 0.08], 0.76);
    }
    // Cross-ties
    for (let k = -2; k <= 2; k++) {
        b.box(0, -h * 0.45, k * d * 0.21, w * 0.40, h * 0.22, 0.07, MAT.CAST, [0.20, 0.23, 0.28], 0.52);
    }
    return b.build();
}

/** Detailed armored combat bot hull for the live Box3D Combat Arena (flush LED bezel — no pearl sphere!). */
export function arenaBotHullMesh(hw, hh, hl, accentCol, hasSpinner = false) {
    const b = new PartBuilder();
    // Main chamfered dark gunmetal armor tub
    b.box(0, -hh * 0.08, 0, hw * 0.96, hh * 0.80, hl * 0.94, MAT.ARMOR, [0.18, 0.21, 0.26], 0.56);
    // Stepped team-colored upper armor deck
    b.box(0, hh * 0.78, -hl * 0.06, hw * 0.84, hh * 0.16, hl * 0.76, MAT.ARMOR, accentCol, 0.68);
    // Dark recessed center hatch with cooling louvers & perimeter bolts
    b.box(0, hh * 0.93, -hl * 0.10, hw * 0.50, hh * 0.07, hl * 0.52, MAT.CAST, [0.14, 0.16, 0.20], 0.44);
    for (let k = -2; k <= 2; k++) {
        b.box(0, hh * 1.00, -hl * 0.24 + k * 0.042, hw * 0.34, 0.006, 0.012, MAT.STEEL, [0.44, 0.48, 0.54], 0.62);
    }
    // Heavy side steel rub-rails + wheel guards
    for (const sx of [-1, 1]) {
        b.box(sx * hw * 0.99, -hh * 0.05, 0, 0.020, hh * 0.38, hl * 0.92, MAT.STEEL, [0.54, 0.58, 0.64], 0.76);
        b.box(sx * hw * 0.86, hh * 0.78, -hl * 0.18, 0.032, hh * 0.22, 0.15, MAT.CAST, [0.22, 0.25, 0.30], 0.62);
    }
    // Flush armored telemetry visor housing on rear deck (the live LED bar sits inside!)
    b.box(0, hh * 0.98, -hl * 0.58, hw * 0.36, 0.018, 0.042, MAT.CAST, [0.12, 0.14, 0.18], 0.50);

    if (hasSpinner) {
        // Cantilevered armored weapon forks + low nose deflector behind the horizontal spinner
        b.box(-hw * 0.38, -hh * 0.25, hl * 1.04, 0.038, hh * 0.36, 0.14, MAT.STEEL, [0.50, 0.54, 0.60], 0.72);
        b.box(hw * 0.38, -hh * 0.25, hl * 1.04, 0.038, hh * 0.36, 0.14, MAT.STEEL, [0.50, 0.54, 0.60], 0.72);
        b.box(0, -hh * 0.35, hl * 0.96, hw * 0.88, hh * 0.42, 0.04, MAT.ARMOR, [0.26, 0.30, 0.36], 0.66);
    } else {
        // Heavy low-angle AR500 Hardox front ramming wedge plow
        const wD = 0.24;
        const fl = [-hw * 1.02, -hh * 0.92, hl + wD], fr = [hw * 1.02, -hh * 0.92, hl + wD];
        const bl = [-hw * 1.02, -hh * 0.92, hl - 0.02], br = [hw * 1.02, -hh * 0.92, hl - 0.02];
        const tl = [-hw * 1.02, hh * 0.76, hl - 0.02], tr = [hw * 1.02, hh * 0.76, hl - 0.02];
        b.quad(tl, tr, fr, fl, MAT.ARMOR, [0.28, 0.32, 0.38], 0.74);
        b.quad(bl, br, fr, fl, MAT.CAST, [0.14, 0.16, 0.20], 0.24);
        b.box(0, -hh * 0.84, hl + wD + 0.008, hw * 1.02, 0.012, 0.016, MAT.STEEL, [0.74, 0.78, 0.82], 0.84);
    }
    return b.build();
}

/** Full Industrial BattleBox Arena enclosure: armored lower walls, caution kickrails, I-beam pilasters & corner floodlight towers! */
export function arenaWallRigMesh(hs) {
    const b = new PartBuilder();
    const wH = 0.95, wT = 0.18;
    const wallCol = [0.16, 0.19, 0.24];
    const steelCol = [0.32, 0.36, 0.42];
    const yellowCol = [0.80, 0.54, 0.06];

    // 4 main lower armored steel perimeter walls + upper rail beam + lower safety bumper
    const sides = [
        { cx: 0, cz: hs + wT, hx: hs + wT * 2, hz: wT, alongX: true },
        { cx: 0, cz: -hs - wT, hx: hs + wT * 2, hz: wT, alongX: true },
        { cx: hs + wT, cz: 0, hx: wT, hz: hs + wT * 2, alongX: false },
        { cx: -hs - wT, cz: 0, hx: wT, hz: hs + wT * 2, alongX: false },
    ];
    for (const s of sides) {
        // Armored lower steel kickwall
        b.box(s.cx, wH * 0.5, s.cz, s.hx, wH * 0.5, s.hz, MAT.ARMOR, wallCol, 0.56);
        // Yellow safety trim rail along top of armored kickwall
        b.box(s.cx, wH + 0.04, s.cz, s.hx, 0.04, s.hz * 1.08, MAT.ARMOR, yellowCol, 0.72);
        // Upper BattleBox Lexan-frame horizontal header beam (at y = 2.35 m)
        b.box(s.cx, 2.35, s.cz, s.hx, 0.06, 0.07, MAT.CAST, [0.14, 0.16, 0.20], 0.58);

        // Vertical steel I-beam pilasters & upper mullions along each wall
        const steps = 5;
        for (let k = -steps; k <= steps; k++) {
            const t = (k / steps) * hs;
            const px = s.alongX ? t : s.cx;
            const pz = s.alongX ? s.cz : t;
            const isCorner = Math.abs(k) === steps;
            const pW = isCorner ? 0.24 : 0.09;
            const pH = isCorner ? 3.2 : 2.35;
            b.box(px, pH * 0.5, pz, pW, pH * 0.5, pW, MAT.CAST, isCorner ? [0.18, 0.21, 0.26] : steelCol, 0.62);
            if (!isCorner) {
                // Inner kickplate buttress brace
                const bx = s.alongX ? px : (s.cx > 0 ? hs - 0.03 : -hs + 0.03);
                const bz = s.alongX ? (s.cz > 0 ? hs - 0.03 : -hs + 0.03) : pz;
                b.box(bx, wH * 0.48, bz, 0.06, wH * 0.46, 0.06, MAT.STEEL, steelCol, 0.68);
            }
        }
    }

    // 4 Corner Industrial Floodlight Towers with glowing overhead LED workbars!
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const cx = sx * (hs + 0.18), cz = sz * (hs + 0.18);
        // Angled overhang floodlight bracket arm pointing inward toward center ring
        b.box(cx - sx * 0.45, 3.15, cz - sz * 0.45, 0.55, 0.07, 0.55, MAT.CAST, [0.16, 0.18, 0.22], 0.55);
        // Glowing industrial LED light bar panel
        b.box(cx - sx * 0.62, 3.06, cz - sz * 0.62, 0.34, 0.035, 0.34, MAT.GLOW, [0.95, 0.97, 1.0], 0.9, 1.8);
    }
    return b.build();
}

/** Bolted steel floor anchor collar + hazard baseplate for destructible concrete arena pillars. */
export function concretePillarCollarMesh(w, d) {
    const b = new PartBuilder();
    b.box(0, 0.025, 0, w * 0.62, 0.025, d * 0.68, MAT.CAST, [0.18, 0.20, 0.24], 0.54);
    b.box(0, 0.058, 0, w * 0.56, 0.012, d * 0.60, MAT.ARMOR, [0.80, 0.54, 0.06], 0.72);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.boltY(sx * w * 0.55, 0.056, sz * d * 0.58, 0.022, 0.022);
    }
    return b.build();
}

/** Elongated glowing welding-spark streak mesh (oriented along +Z). */
export function sparkStreakMesh() {
    const b = new PartBuilder();
    b.box(0, 0, 0, 0.012, 0.012, 0.13, MAT.GLOW, [1.0, 0.84, 0.36], 1.0, 2.8);
    return b.build();
}

/** Unit 1x1x1 cube with clean per-face [0..1] UVs for demos/foundry/shaders/foundry_cage.bk. */
export function unitCageMesh() {
    const p = [], n = [], u = [], i = [];
    const faces = [
        [[0, 0, 1],  [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
        [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
        [[0, 1, 0],  [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
        [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
        [[1, 0, 0],  [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
        [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
    ];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [nm, corners] of faces) {
        const base = p.length / 3;
        for (let k = 0; k < 4; k++) {
            p.push(...corners[k]); n.push(...nm); u.push(...uvs[k]);
        }
        i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return new bro.mesh.Mesh({
        positions: new Float32Array(p),
        normals: new Float32Array(n),
        uvs: new Float32Array(u),
        indices: new Uint32Array(i),
    });
}
