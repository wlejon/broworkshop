// Sculpted single-island outward-CCW interior furniture, area rugs, ceiling luminaires, and wall art.
// All floor-standing props keep base at y = 0.0 exact and minXZ < 2.5 m (for eye_structure floor detection).

class FurnAcc {
    constructor() {
        this.pos = [];
        this.nrm = [];
        this.tan = [];
        this.uvs = [];
        this.idx = [];
    }

    addQuadOut(p0, p1, p2, p3, ref, matId, param = 0.0) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const mx = 0.25 * (p0[0] + p1[0] + p2[0] + p3[0]) - ref[0];
        const my = 0.25 * (p0[1] + p1[1] + p2[1] + p3[1]) - ref[1];
        const mz = 0.25 * (p0[2] + p1[2] + p2[2] + p3[2]) - ref[2];
        const flip = (nx * mx + ny * my + nz * mz) < 0;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        const pts = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
        const tx = Math.abs(ny) > 0.9 ? [1, 0, 0, 1] : [nz, 0, -nx, 1];
        const b = this.pos.length / 3;
        for (let i = 0; i < 4; i++) {
            this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
            this.nrm.push(nx, ny, nz);
            this.tan.push(tx[0], tx[1], tx[2], tx[3]);
            this.uvs.push(matId, param);
        }
        this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }

    addTriOut(p0, p1, p2, ref, matId, param = 0.0) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const mx = (p0[0] + p1[0] + p2[0]) / 3 - ref[0];
        const my = (p0[1] + p1[1] + p2[1]) / 3 - ref[1];
        const mz = (p0[2] + p1[2] + p2[2]) / 3 - ref[2];
        const flip = (nx * mx + ny * my + nz * mz) < 0;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        const pts = flip ? [p0, p2, p1] : [p0, p1, p2];
        const tx = Math.abs(ny) > 0.9 ? [1, 0, 0, 1] : [nz, 0, -nx, 1];
        const b = this.pos.length / 3;
        for (let i = 0; i < 3; i++) {
            this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
            this.nrm.push(nx, ny, nz);
            this.tan.push(tx[0], tx[1], tx[2], tx[3]);
            this.uvs.push(matId, param);
        }
        this.idx.push(b, b + 1, b + 2);
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

    addFrustum(cx, y0, cz, rx0, rz0, y1, rx1, rz1, sides, matId, param = 0.0) {
        const r0 = [], r1 = [];
        for (let i = 0; i < sides; i++) {
            const a = (i * Math.PI * 2) / sides;
            const ca = Math.cos(a), sa = Math.sin(a);
            r0.push([cx + ca * rx0, y0, cz + sa * rz0]);
            r1.push([cx + ca * rx1, y1, cz + sa * rz1]);
        }
        const ref = [cx, 0.5 * (y0 + y1), cz];
        for (let i = 0; i < sides; i++) {
            const j = (i + 1) % sides;
            this.addQuadOut(r0[i], r0[j], r1[j], r1[i], ref, matId, param);
            this.addTriOut([cx, y0, cz], r0[j], r0[i], ref, matId, param);
            this.addTriOut([cx, y1, cz], r1[i], r1[j], ref, matId, param);
        }
    }

    addTaperedCyl(p0, r0, p1, r1, sides, matId, param = 0.0) {
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        const ax = dx / len, ay = dy / len, az = dz / len;
        const up = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let tx = up[1] * az - up[2] * ay, ty = up[2] * ax - up[0] * az, tz = up[0] * ay - up[1] * ax;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const bx = ay * tz - az * ty, by = az * tx - ax * tz, bz = ax * ty - ay * tx;
        const ring0 = [], ring1 = [];
        for (let i = 0; i < sides; i++) {
            const a = (i * Math.PI * 2) / sides;
            const ca = Math.cos(a), sa = Math.sin(a);
            const rx = tx * ca + bx * sa, ry = ty * ca + by * sa, rz = tz * ca + bz * sa;
            ring0.push([p0[0] + rx * r0, p0[1] + ry * r0, p0[2] + rz * r0]);
            ring1.push([p1[0] + rx * r1, p1[1] + ry * r1, p1[2] + rz * r1]);
        }
        const mid = [0.5 * (p0[0] + p1[0]), 0.5 * (p0[1] + p1[1]), 0.5 * (p0[2] + p1[2])];
        for (let i = 0; i < sides; i++) {
            const j = (i + 1) % sides;
            this.addQuadOut(ring0[i], ring0[j], ring1[j], ring1[i], mid, matId, param);
            this.addTriOut(p0, ring0[j], ring0[i], mid, matId, param);
            this.addTriOut(p1, ring1[i], ring1[j], mid, matId, param);
        }
    }

    addChamferedPlate(cx, y0, y1, cz, hx, hz, bev, matId, param = 0.0) {
        const pts = [
            [cx + hx - bev, cz - hz], [cx + hx, cz - hz + bev],
            [cx + hx, cz + hz - bev], [cx + hx - bev, cz + hz],
            [cx - hx + bev, cz + hz], [cx - hx, cz + hz - bev],
            [cx - hx, cz - hz + bev], [cx - hx + bev, cz - hz],
        ];
        const ref = [cx, 0.5 * (y0 + y1), cz];
        const tc = [cx, y1, cz], bc = [cx, y0, cz];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            this.addTriOut(tc, [a[0], y1, a[1]], [b[0], y1, b[1]], ref, matId, param);
            this.addTriOut(bc, [b[0], y0, b[1]], [a[0], y0, a[1]], ref, matId, param);
            this.addQuadOut([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], ref, matId, param);
        }
    }

    build() {
        return new Mesh({
            positions: new Float32Array(this.pos),
            normals: new Float32Array(this.nrm),
            tangents: new Float32Array(this.tan),
            uvs: new Float32Array(this.uvs),
            indices: new Uint32Array(this.idx),
        });
    }
}

export function createTableMesh() {
    const m = new FurnAcc();
    // Chamfered dining / conference table: 1.48 x 0.76 x 0.92 m + under-apron + tapered oak legs + centerpiece bowl
    m.addChamferedPlate(0, 0.70, 0.76, 0, 0.74, 0.46, 0.16, 2, 0.0);
    m.addBox(-0.58, 0.61, -0.34, 0.58, 0.71, 0.34, 2, 0.0);
    for (const sx of [-0.52, 0.52]) {
        for (const sz of [-0.30, 0.30]) {
            m.addFrustum(sx, 0.0, sz, 0.028, 0.028, 0.65, 0.044, 0.044, 6, 2, 0.0);
        }
    }
    m.addFrustum(0, 0.75, 0, 0.10, 0.10, 0.85, 0.18, 0.18, 10, 0, 0.55); // ceramic bowl
    return m.build();
}

export function createChairMesh() {
    const m = new FurnAcc();
    // Contoured armchair / dining chair: 0.52 x 0.92 x 0.52 m
    m.addChamferedPlate(0, 0.41, 0.45, 0, 0.24, 0.24, 0.05, 2, 0.0);
    m.addChamferedPlate(0, 0.44, 0.49, 0.01, 0.22, 0.21, 0.05, 8, 0.0);
    m.addBox(-0.22, 0.46, -0.23, 0.22, 0.92, -0.16, 8, 0.0);
    m.addBox(-0.24, 0.44, -0.24, -0.18, 0.90, -0.15, 2, 0.0);
    m.addBox( 0.18, 0.44, -0.24,  0.24, 0.90, -0.15, 2, 0.0);
    for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
        m.addFrustum(lx, 0.0, lz, 0.022, 0.022, 0.43, 0.032, 0.032, 6, 1, 0.0);
    }
    return m.build();
}

export function createDeskMesh() {
    const m = new FurnAcc();
    // Executive office workstation: 1.54 x 1.20 x 0.76 m with dual widescreen displays & keyboard
    m.addChamferedPlate(0, 0.70, 0.76, 0, 0.77, 0.38, 0.04, 2, 0.0);
    m.addBox(-0.73, 0.0, -0.35, -0.44, 0.71, 0.35, 2, 0.0);
    m.addBox( 0.44, 0.0, -0.35,  0.73, 0.71, 0.35, 2, 0.0);
    // Metallic drawer pulls
    for (const dy of [0.20, 0.40, 0.58]) {
        m.addBox(-0.64, dy, 0.34, -0.53, dy + 0.03, 0.37, 1, 0.0);
        m.addBox( 0.53, dy, 0.34,  0.64, dy + 0.03, 0.37, 1, 0.0);
    }
    m.addBox(-0.70, 0.30, -0.35, 0.70, 0.71, -0.28, 2, 0.0); // modesty panel
    // Monitor riser + dual subtle glowing displays + keyboard tray
    m.addBox(-0.08, 0.75, -0.24, 0.08, 0.90, -0.16, 1, 0.0);
    m.addBox(-0.56, 0.87, -0.21, -0.02, 1.20, -0.16, 1, 0.0);
    m.addBox( 0.02, 0.87, -0.21,  0.56, 1.20, -0.16, 1, 0.0);
    m.addBox(-0.53, 0.90, -0.17, -0.05, 1.17, -0.145, 5, 0.24);
    m.addBox( 0.05, 0.90, -0.17,  0.53, 1.17, -0.145, 5, 0.24);
    m.addBox(-0.22, 0.75, 0.04, 0.22, 0.775, 0.19, 13, 0.0); // keyboard
    return m.build();
}

export function createSofaMesh() {
    const m = new FurnAcc();
    // Plush 3-cushion sofa: 1.96 x 0.88 x 0.88 m with wood plinth, legs, cushions, armrests & pillows
    for (const [lx, lz] of [[-0.86, -0.34], [0.86, -0.34], [-0.86, 0.34], [0.86, 0.34]]) {
        m.addFrustum(lx, 0.0, lz, 0.025, 0.025, 0.12, 0.038, 0.038, 6, 2, 0.0);
    }
    m.addBox(-0.96, 0.10, -0.42, 0.96, 0.24, 0.42, 2, 0.0); // wood base apron
    for (const cx of [-0.52, 0.0, 0.52]) {
        m.addChamferedPlate(cx, 0.22, 0.43, 0.04, 0.255, 0.39, 0.05, 8, 0.0); // 3 seat cushions
        m.addChamferedPlate(cx, 0.40, 0.86, -0.28, 0.255, 0.13, 0.05, 8, 0.0); // 3 back cushions
    }
    m.addBox(-0.98, 0.22, -0.42, -0.78, 0.64, 0.42, 8, 0.0); // left padded arm
    m.addBox( 0.78, 0.22, -0.42,  0.98, 0.64, 0.42, 8, 0.0); // right padded arm
    m.addBox(-0.96, 0.22, -0.44,  0.96, 0.82, -0.34, 8, 0.0); // rear back shell
    // Flanking throw pillows (overlapping seat & arms cleanly)
    m.addChamferedPlate(-0.68, 0.41, 0.64, -0.10, 0.11, 0.12, 0.03, 0, 0.55);
    m.addChamferedPlate( 0.68, 0.41, 0.64, -0.10, 0.11, 0.12, 0.03, 0, 0.55);
    return m.build();
}

export function createBedMesh() {
    const m = new FurnAcc();
    // Cozy queen bed: 1.56 x 1.02 x 2.08 m (wood headboard, mattress, folded duvet, 2 pillows, legs)
    for (const [lx, lz] of [[-0.72, -0.96], [0.72, -0.96], [-0.72, 0.96], [0.72, 0.96]]) {
        m.addFrustum(lx, 0.0, lz, 0.035, 0.035, 0.22, 0.045, 0.045, 6, 2, 0.0);
    }
    m.addBox(-0.77, 0.18, -1.03, 0.77, 0.36, 1.03, 2, 0.0);   // solid timber platform frame
    m.addBox(-0.78, 0.34, -1.04, 0.78, 1.02, -0.91, 2, 0.0);  // tall paneled headboard
    m.addBox(-0.78, 0.34, 0.94, 0.78, 0.48, 1.04, 2, 0.0);    // low footboard
    m.addChamferedPlate(0, 0.34, 0.56, 0.0, 0.72, 0.96, 0.06, 8, 0.0);   // plush mattress
    m.addChamferedPlate(0, 0.38, 0.61, 0.24, 0.74, 0.72, 0.06, 0, 0.55); // quilted duvet blanket
    m.addChamferedPlate(-0.34, 0.54, 0.68, -0.72, 0.28, 0.18, 0.05, 8, 0.0);
    m.addChamferedPlate( 0.34, 0.54, 0.68, -0.72, 0.28, 0.18, 0.05, 8, 0.0);
    return m.build();
}

export function createCounterMesh() {
    const m = new FurnAcc();
    // Kitchen / cafe / lobby reception island: 1.84 x 0.96 x 0.70 m
    m.addBox(-0.88, 0.0, -0.32, 0.88, 0.90, 0.32, 2, 0.0);
    m.addBox(-0.82, 0.10, 0.30, -0.06, 0.82, 0.34, 0, 0.55); // left shaker door
    m.addBox( 0.06, 0.10, 0.30,  0.82, 0.82, 0.34, 0, 0.55); // right shaker door
    m.addChamferedPlate(0, 0.89, 0.96, 0, 0.94, 0.37, 0.03, 2, 2.0); // stone countertop overhang
    m.addBox(-0.22, 0.95, -0.18, 0.22, 0.98, 0.16, 1, 0.0);  // steel sink basin rim
    m.addTaperedCyl([0, 0.96, -0.22], 0.025, [0, 1.18, -0.20], 0.02, 6, 4, 0.0); // gooseneck faucet
    m.addTaperedCyl([0, 1.17, -0.20], 0.02, [0, 1.12, -0.06], 0.016, 6, 4, 0.0);
    return m.build();
}

export function createShelfMesh() {
    const m = new FurnAcc();
    // Stocked library bookcase: 1.20 x 1.92 x 0.40 m with book clusters
    m.addBox(-0.60, 0.0, -0.20, -0.54, 1.92, 0.20, 2, 0.0);
    m.addBox( 0.54, 0.0, -0.20,  0.60, 1.92, 0.20, 2, 0.0);
    m.addBox(-0.56, 0.0, -0.20,  0.56, 1.92, -0.14, 2, 0.0);
    const ys = [0.04, 0.48, 0.96, 1.44, 1.88];
    for (let i = 0; i < ys.length; i++) {
        m.addBox(-0.56, ys[i] - 0.025, -0.16, 0.56, ys[i] + 0.025, 0.20, 2, 0.0);
    }
    // Stacked books on shelves (contacting shelf top & back panel)
    const bookRows = [
        [0.48, -0.46, -0.10, 0.30, 8], [0.48, 0.06, 0.44, 0.26, 0],
        [0.96, -0.48, 0.02, 0.32, 0],  [0.96, 0.22, 0.48, 0.28, 8],
        [1.44, -0.44, -0.08, 0.29, 8], [1.44, 0.14, 0.46, 0.24, 0],
    ];
    for (const [sy, x0, x1, bh, mat] of bookRows) {
        m.addBox(x0, sy + 0.02, -0.15, x1, sy + bh, 0.12, mat, 0.55);
    }
    return m.build();
}

export function createLampMesh() {
    const m = new FurnAcc();
    // Brushed brass standing lamp with glowing conical fabric drum shade
    m.addFrustum(0, 0.0, 0, 0.20, 0.20, 0.04, 0.17, 0.17, 10, 4, 0.0);
    m.addTaperedCyl([0, 0.03, 0], 0.026, [0, 1.40, 0], 0.020, 8, 4, 0.0);
    m.addFrustum(0, 1.32, 0, 0.23, 0.23, 1.66, 0.15, 0.15, 12, 5, 0.58);
    return m.build();
}

export function createPlantMesh() {
    const m = new FurnAcc();
    // Sculpted ceramic planter, dark soil, woody stems & 10 angled radiating botanical leaves
    m.addFrustum(0, 0.0, 0, 0.15, 0.15, 0.38, 0.21, 0.21, 10, 0, 0.55);
    m.addFrustum(0, 0.34, 0, 0.19, 0.19, 0.39, 0.19, 0.19, 10, 10, 0.0);
    m.addTaperedCyl([0, 0.36, 0], 0.04, [0, 0.78, 0], 0.025, 6, 10, 0.0);
    for (let k = 0; k < 10; k++) {
        const ang = k * (Math.PI * 2 / 5) + (k >= 5 ? 0.31 : 0);
        const tierY = k < 5 ? 0.62 : 0.76;
        const reach = k < 5 ? 0.28 : 0.21;
        const lift = k < 5 ? 0.22 : 0.30;
        const tx = Math.cos(ang) * reach, tz = Math.sin(ang) * reach;
        const px = Math.cos(ang + 1.57) * 0.075, pz = Math.sin(ang + 1.57) * 0.075;
        const tip = [tx, tierY + lift, tz];
        const baseL = [px * 0.6, tierY - 0.02, pz * 0.6];
        const baseR = [-px * 0.6, tierY - 0.02, -pz * 0.6];
        const midL = [tx * 0.5 + px, tierY + lift * 0.65, tz * 0.5 + pz];
        const midR = [tx * 0.5 - px, tierY + lift * 0.65, tz * 0.5 - pz];
        const topOff = [0, 0.025, 0];
        const bCenter = [tx * 0.45, tierY + lift * 0.4, tz * 0.45];
        const tTip = [tip[0], tip[1] + 0.015, tip[2]];
        // Closed thick diamond botanical frond
        m.addQuadOut(baseL, midL, tTip, midR, bCenter, 9, 0.0);
        m.addQuadOut([baseL[0], baseL[1] - topOff[1], baseL[2]], [midR[0], midR[1] - topOff[1], midR[2]],
            [tTip[0], tTip[1] - 0.01, tTip[2]], [midL[0], midL[1] - topOff[1], midL[2]], bCenter, 9, 0.0);
        m.addTriOut(baseL, midR, baseR, bCenter, 9, 0.0);
    }
    return m.build();
}

export function createRugMesh() {
    const m = new FurnAcc();
    // Low-pile woven area rug: 2.10 x 0.026 x 1.45 m (minXZ = 1.45 < 2.5 m)
    m.addChamferedPlate(0, 0.0, 0.026, 0, 1.05, 0.725, 0.06, 8, 0.0);
    return m.build();
}

export function createCeilingLightMesh() {
    const m = new FurnAcc();
    // Flush pendant ceiling luminaire mounted at y = 0.0 (top +0.04 overlaps ceiling/roof slab cleanly)
    m.addFrustum(0, -0.04, 0, 0.24, 0.24, 0.04, 0.24, 0.24, 12, 1, 0.0);
    m.addFrustum(0, -0.14, 0, 0.19, 0.19, -0.02, 0.22, 0.22, 12, 5, 0.56);
    return m.build();
}

export function createWallArtMesh() {
    const m = new FurnAcc();
    // Framed canvas wall art: 0.94 x 0.68 x 0.055 m (back at z=-0.015 seats into solid wall)
    m.addBox(-0.47, -0.34, -0.015, 0.47, 0.34, 0.032, 2, 0.0);
    m.addBox(-0.41, -0.28, 0.012, 0.41, 0.28, 0.044, 8, 0.0);
    return m.build();
}
