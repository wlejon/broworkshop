// Procedural closed single-island outward-CCW meshes for buildings, stairs, elevators,
// pitched roofs, porches, awnings, and skyscraper crowns. Furniture re-exported from furniture_meshes.js.
export {
    createTableMesh,
    createChairMesh,
    createDeskMesh,
    createSofaMesh,
    createBedMesh,
    createCounterMesh,
    createShelfMesh,
    createLampMesh,
    createPlantMesh,
    createRugMesh,
    createCeilingLightMesh,
    createWallArtMesh,
} from '/app/buildings/furniture_meshes.js';

const FACES = [
    { n: [1, 0, 0],  t: [0, 0, -1, 1], c: (x0, y0, z0, x1, y1, z1) => [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
    { n: [-1, 0, 0], t: [0, 0, 1, 1],  c: (x0, y0, z0, x1, y1, z1) => [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 1, 0],  t: [1, 0, 0, 1],  c: (x0, y0, z0, x1, y1, z1) => [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
    { n: [0, -1, 0], t: [1, 0, 0, 1],  c: (x0, y0, z0, x1, y1, z1) => [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    { n: [0, 0, 1],  t: [1, 0, 0, 1],  c: (x0, y0, z0, x1, y1, z1) => [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], t: [-1, 0, 0, 1], c: (x0, y0, z0, x1, y1, z1) => [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
];

class MeshAcc {
    constructor() {
        this.pos = [];
        this.nrm = [];
        this.tan = [];
        this.uvs = [];
        this.idx = [];
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

    addBox(x0, y0, z0, x1, y1, z1, matId = 0, param = 0.0) {
        for (let fi = 0; fi < FACES.length; fi++) {
            const f = FACES[fi];
            const pts = f.c(x0, y0, z0, x1, y1, z1);
            const b = this.pos.length / 3;
            for (let k = 0; k < 4; k++) {
                const p = pts[k];
                this.pos.push(p[0], p[1], p[2]);
                this.nrm.push(f.n[0], f.n[1], f.n[2]);
                this.tan.push(f.t[0], f.t[1], f.t[2], f.t[3]);
                this.uvs.push(matId, param);
            }
            this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
    }

    addPrismRoof(hx, hz, y0, yPeak, ridgeHalfX, matRoof, matGable, zc = 0.0) {
        // Closed hip/gable prism from base [-hx..hx] x [zc-hz..zc+hz] at y0 to ridge at yPeak
        const bFL = [-hx, y0, zc + hz], bFR = [hx, y0, zc + hz], bRR = [hx, y0, zc - hz], bRL = [-hx, y0, zc - hz];
        const tL = [-ridgeHalfX, yPeak, zc], tR = [ridgeHalfX, yPeak, zc];
        const ref = [0, y0 + (yPeak - y0) * 0.35, zc];
        this.addQuadOut(bRL, bRR, bFR, bFL, ref, matGable, 0.0); // bottom soffit
        this.addQuadOut(bFL, bFR, tR, tL, ref, matRoof, 0.0);    // front roof slope
        this.addQuadOut(bRR, bRL, tL, tR, ref, matRoof, 0.0);    // back roof slope
        if (ridgeHalfX < hx - 0.02) {
            this.addTriOut(bFR, bRR, tR, ref, matRoof, 0.0);     // right hip slope
            this.addTriOut(bRL, bFL, tL, ref, matRoof, 0.0);     // left hip slope
        } else {
            this.addTriOut(bFR, bRR, tR, ref, matGable, 0.0);    // right gable triangle
            this.addTriOut(bRL, bFL, tL, ref, matGable, 0.0);    // left gable triangle
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

export function createParallaxShellMesh() {
    const m = new MeshAcc();
    m.addBox(-0.5, 0.0, -0.5, 0.5, 1.0, 0.5, 0, 0.0);
    return m.build();
}

export function createSolidBoxMesh(matId = 0, param = 0.0) {
    const m = new MeshAcc();
    m.addBox(-0.5, 0.0, -0.5, 0.5, 1.0, 0.5, matId, param);
    return m.build();
}

export function createWallDoorMesh(matId = 0, param = 0.0) {
    const m = new MeshAcc();
    m.addBox(-0.5, 0.0, -0.5, -0.36, 1.0, 0.5, matId, param);
    m.addBox(0.36, 0.0, -0.5, 0.5, 1.0, 0.5, matId, param);
    m.addBox(-0.38, 0.78, -0.5, 0.38, 1.0, 0.5, matId, param);
    m.addBox(-0.38, 0.0, -0.52, -0.34, 0.80, 0.52, 2, 0.0);
    m.addBox(0.34, 0.0, -0.52, 0.38, 0.80, 0.52, 2, 0.0);
    m.addBox(-0.38, 0.76, -0.52, 0.38, 0.81, 0.52, 2, 0.0);
    return m.build();
}

export function createWallWindowMesh(matId = 0, param = 0.0) {
    const m = new MeshAcc();
    m.addBox(-0.5, 0.0, -0.5, 0.5, 0.28, 0.5, matId, param);
    m.addBox(-0.5, 0.80, -0.5, 0.5, 1.0, 0.5, matId, param);
    m.addBox(-0.5, 0.26, -0.5, -0.24, 0.82, 0.5, matId, param);
    m.addBox(0.24, 0.26, -0.5, 0.5, 0.82, 0.5, matId, param);
    m.addBox(-0.02, 0.26, -0.22, 0.02, 0.82, 0.22, 1, 0.0);
    return m.build();
}

export function createWindowGlassMesh() {
    const m = new MeshAcc();
    m.addBox(-0.242, 0.278, -0.07, -0.021, 0.802, 0.07, 3, 0.0);
    m.addBox(0.021, 0.278, -0.07, 0.242, 0.802, 0.07, 3, 0.0);
    return m.build();
}

export function createStairFlightMesh(steps = 18) {
    const m = new MeshAcc();
    for (let i = 0; i < steps; i++) {
        const z0 = i / steps;
        const z1 = Math.min(1.0, (i + 1) / steps + 0.01);
        const yBot = Math.max(0.0, (i - 2) / steps);
        const yTop = (i + 1) / steps;
        m.addBox(-0.5, yBot, z0, 0.5, yTop, z1, 2, 0.0);
    }
    // Handrail posts & sloped top brass/oak banister on left side
    for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const z = t * 0.94 + 0.03;
        m.addBox(-0.48, t * 0.92, z - 0.018, -0.42, t + 0.26, z + 0.018, 1, 0.0);
    }
    for (let i = 0; i < 4; i++) {
        const t0 = i / 4, t1 = (i + 1) / 4;
        m.addBox(-0.49, Math.min(t0, t1) + 0.23, t0 * 0.94 + 0.02, -0.41, Math.max(t0, t1) + 0.28, t1 * 0.94 + 0.04, 2, 0.0);
    }
    return m.build();
}

export function createElevatorCabMesh() {
    const m = new MeshAcc();
    m.addBox(-0.50, 0.00, -0.50, 0.50, 0.05, 0.50, 2, 2.0);   // Marble cab floor
    m.addBox(-0.36, 0.00, 0.46, 0.36, 0.05, 0.540, 1, 0.0);   // Brass threshold sill
    m.addBox(-0.50, 0.03, -0.50, -0.44, 1.00, 0.50, 2, 0.0);  // Wood-paneled left wall
    m.addBox(0.44, 0.03, -0.50, 0.50, 1.00, 0.50, 2, 0.0);    // Wood-paneled right wall
    m.addBox(-0.46, 0.03, -0.50, 0.46, 1.00, -0.44, 1, 0.0);  // Brushed steel back wall
    m.addBox(-0.46, 0.94, -0.46, 0.46, 1.00, 0.50, 0, 0.55);  // Ceiling
    m.addBox(-0.24, 0.91, -0.24, 0.24, 0.96, 0.24, 5, 0.55);  // Ceiling light panel
    // Guide shoes
    m.addBox(-0.540, 0.00, -0.14, -0.46, 0.08, 0.14, 1, 0.0);
    m.addBox(0.46, 0.00, -0.14, 0.540, 0.08, 0.14, 1, 0.0);
    m.addBox(-0.540, 0.92, -0.14, -0.46, 1.00, 0.14, 1, 0.0);
    m.addBox(0.46, 0.92, -0.14, 0.540, 1.00, 0.14, 1, 0.0);
    return m.build();
}

// Exterior Architectural Silhouettes (closed single outward-CCW islands, base seated flush at y=0)

export function createGableRoofMesh() {
    const m = new MeshAcc();
    m.addBox(-0.51, 0.00, -0.51, 0.51, 0.06, 0.51, 0, 0.0); // fascia eaves collar seated flush at y=0
    m.addPrismRoof(0.55, 0.55, 0.02, 1.00, 0.55, 11, 0);    // pitched gable shingle roof
    m.addBox(0.24, 0.15, -0.28, 0.36, 1.08, -0.14, 0, 0.0); // brick chimney overlapping slope
    return m.build();
}

export function createHipRoofMesh() {
    const m = new MeshAcc();
    m.addBox(-0.51, 0.00, -0.51, 0.51, 0.06, 0.51, 0, 0.0); // fascia eaves collar seated flush at y=0
    m.addPrismRoof(0.55, 0.55, 0.02, 1.00, 0.18, 11, 0);    // 4-slope hip shingle roof
    m.addBox(-0.34, 0.15, -0.28, -0.22, 1.06, -0.14, 0, 0.0);
    return m.build();
}

export function createPorchCanopyMesh() {
    const m = new MeshAcc();
    // Covered suburban front entry canopy (posts sit flush on porch slab, ledger seated on front wall)
    m.addBox(-1.35, -0.03, 0.92, -1.19, 2.75, 1.08, 0, 0.0);
    m.addBox( 1.19, -0.03, 0.92,  1.35, 2.75, 1.08, 0, 0.0);
    m.addBox(-1.44, 2.70, -0.02, 1.44, 2.86, 1.16, 0, 0.0);
    m.addPrismRoof(1.48, 0.62, 2.84, 3.48, 0.15, 11, 0, 0.55);
    return m.build();
}

export function createStorefrontAwningMesh() {
    const m = new MeshAcc();
    // Unit commercial storefront awning (width=1 along X, mounting rail spans wall faces 0.00..+0.09)
    const ref = [0, 0.35, 0.45];
    const bL = [-0.50, 0.0, -0.02], bR = [0.50, 0.0, -0.02];
    const fL = [-0.50, 0.0, 1.00],  fR = [0.50, 0.0, 1.00];
    const tL = [-0.50, 0.68, -0.02], tR = [0.50, 0.68, -0.02];
    const mL = [-0.50, 0.14, 1.00],  mR = [0.50, 0.14, 1.00];
    m.addBox(-0.50, 0.0, -0.02, 0.50, 0.68, 0.09, 1, 0.0); // wall-flush mounting ledger
    m.addQuadOut(bL, bR, fR, fL, ref, 8, 0.0);
    m.addQuadOut(tL, tR, mR, mL, ref, 8, 0.0);
    m.addQuadOut(fL, fR, mR, mL, ref, 8, 0.0);
    m.addQuadOut(bR, bL, tL, tR, ref, 8, 0.0);
    m.addQuadOut(bL, fL, mL, tL, ref, 8, 0.0);
    m.addQuadOut(fR, bR, tR, mR, ref, 8, 0.0);
    return m.build();
}

export function createSkyCrownSteppedMesh() {
    const m = new MeshAcc();
    // Tiered Art-Deco skyscraper crown seated flush at y=0
    m.addBox(-0.48, 0.00, -0.48, 0.48, 0.34, 0.48, 0, 0.0);
    m.addBox(-0.34, 0.30, -0.34, 0.34, 0.64, 0.34, 0, 0.0);
    m.addBox(-0.20, 0.60, -0.20, 0.20, 0.88, 0.20, 1, 0.0);
    m.addBox(-0.04, 0.84, -0.04, 0.04, 1.05, 0.04, 4, 0.0);
    return m.build();
}

export function createSkyCrownSpireMesh() {
    const m = new MeshAcc();
    // Modern tapered zinc/slate skyscraper crown + architectural spire seated flush at y=0
    m.addBox(-0.46, 0.00, -0.46, 0.46, 0.22, 0.46, 7, 0.0);
    m.addPrismRoof(0.42, 0.42, 0.18, 0.72, 0.04, 7, 7);
    m.addBox(-0.03, 0.55, -0.03, 0.03, 1.15, 0.03, 4, 0.0);
    return m.build();
}

export function createRoofHvacMesh() {
    const m = new MeshAcc();
    // Rooftop mechanical penthouse & twin chiller units seated flush at y=0
    m.addBox(-0.46, 0.00, -0.46, 0.10, 0.90, 0.32, 1, 0.0);
    m.addBox( 0.06, 0.00, -0.26, 0.46, 0.55, 0.34, 1, 0.0);
    return m.build();
}
