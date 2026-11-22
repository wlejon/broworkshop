// Procedural closed single-island outward-CCW meshes for buildings, stairs, elevators, and furniture.

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

export function createWallDoorMesh() {
    const m = new MeshAcc();
    // Door aperture: x in [-0.36, 0.36], y in [0, 0.78]
    m.addBox(-0.5, 0.0, -0.5, -0.36, 1.0, 0.5, 0, 0.0);
    m.addBox(0.36, 0.0, -0.5, 0.5, 1.0, 0.5, 0, 0.0);
    m.addBox(-0.38, 0.78, -0.5, 0.38, 1.0, 0.5, 0, 0.0);
    // Overlapping jamb & header trim (single connected island)
    m.addBox(-0.38, 0.0, -0.52, -0.34, 0.80, 0.52, 1, 0.0);
    m.addBox(0.34, 0.0, -0.52, 0.38, 0.80, 0.52, 1, 0.0);
    m.addBox(-0.38, 0.76, -0.52, 0.38, 0.81, 0.52, 1, 0.0);
    return m.build();
}

export function createWallWindowMesh() {
    const m = new MeshAcc();
    // Window aperture: x in [-0.24, 0.24], y in [0.28, 0.80]
    m.addBox(-0.5, 0.0, -0.5, 0.5, 0.28, 0.5, 0, 0.0);
    m.addBox(-0.5, 0.80, -0.5, 0.5, 1.0, 0.5, 0, 0.0);
    m.addBox(-0.5, 0.26, -0.5, -0.24, 0.82, 0.5, 0, 0.0);
    m.addBox(0.24, 0.26, -0.5, 0.5, 0.82, 0.5, 0, 0.0);
    // Central vertical mullion overlapping sill & lintel
    m.addBox(-0.02, 0.26, -0.22, 0.02, 0.82, 0.22, 1, 0.0);
    return m.build();
}

export function createWindowGlassMesh() {
    const m = new MeshAcc();
    // Planar closed outward-CCW glass panes inside left/right window sub-apertures (curvedEdges = 0).
    // Slight 2 mm overlap into sill/lintel/jamb ensures contact graph connectivity without Z-fighting.
    m.addBox(-0.242, 0.278, -0.07, -0.021, 0.802, 0.07, 3, 0.0);
    m.addBox(0.021, 0.278, -0.07, 0.242, 0.802, 0.07, 3, 0.0);
    return m.build();
}

export function createStairFlightMesh(steps = 18) {
    const m = new MeshAcc();
    // Sloped-carriage stepped flight from (y=0, z=0) ascending to (y=1, z=1), single closed island.
    // Sloped underside preserves >= 0.88 * floorHeight headroom for stacked multi-story stairs.
    for (let i = 0; i < steps; i++) {
        const z0 = i / steps;
        const z1 = Math.min(1.0, (i + 1) / steps + 0.01);
        const yBot = Math.max(0.0, (i - 2) / steps);
        const yTop = (i + 1) / steps;
        m.addBox(-0.5, yBot, z0, 0.5, yTop, z1, 2, 0.0);
    }
    return m.build();
}

export function createElevatorCabMesh() {
    const m = new MeshAcc();
    // Normalized [-0.5..0.5] x [0..1] x [-0.5..0.5], open at +Z
    m.addBox(-0.50, 0.00, -0.50, 0.50, 0.05, 0.50, 2, 0.0);   // Floor
    m.addBox(-0.36, 0.00, 0.46, 0.36, 0.05, 0.540, 2, 0.0);   // Front doorway threshold sill
    m.addBox(-0.50, 0.03, -0.50, -0.44, 1.00, 0.50, 1, 0.0); // Left wall
    m.addBox(0.44, 0.03, -0.50, 0.50, 1.00, 0.50, 1, 0.0);   // Right wall
    m.addBox(-0.46, 0.03, -0.50, 0.46, 1.00, -0.44, 1, 0.0); // Back wall
    m.addBox(-0.46, 0.94, -0.46, 0.46, 1.00, 0.50, 0, 0.0);  // Ceiling
    m.addBox(-0.24, 0.91, -0.24, 0.24, 0.96, 0.24, 5, 0.55); // Ceiling light panel
    // Side guide shoes engaging shaft guide channels (contacts shaft walls at all heights)
    m.addBox(-0.540, 0.00, -0.14, -0.46, 0.08, 0.14, 1, 0.0);
    m.addBox(0.46, 0.00, -0.14, 0.540, 0.08, 0.14, 1, 0.0);
    m.addBox(-0.540, 0.92, -0.14, -0.46, 1.00, 0.14, 1, 0.0);
    m.addBox(0.46, 0.92, -0.14, 0.540, 1.00, 0.14, 1, 0.0);
    return m.build();
}

// Furniture meshes: 1 unit = 1 meter, base at y = 0.0 exact, minXZ < 2.5 m, single connected island.

export function createTableMesh() {
    const m = new MeshAcc();
    // Octagonal chamfered dining / conference table: 1.40 x 0.76 x 0.90 m (diagonal corner bevels avoid axis_grid)
    const cx = 0.70, cz = 0.45, bev = 0.22;
    const pts = [
        [cx - bev, -cz], [cx, -cz + bev],
        [cx, cz - bev],  [cx - bev, cz],
        [-cx + bev, cz], [-cx, cz - bev],
        [-cx, -cz + bev], [-cx + bev, -cz],
    ];
    const y0 = 0.70, y1 = 0.76;
    const bt = m.pos.length / 3;
    for (const [px, pz] of pts) {
        m.pos.push(px, y1, pz); m.nrm.push(0, 1, 0); m.tan.push(1, 0, 0, 1); m.uvs.push(2, 0);
    }
    for (let i = 1; i + 1 < pts.length; i++) m.idx.push(bt, bt + i + 1, bt + i);
    const bb = m.pos.length / 3;
    for (const [px, pz] of pts) {
        m.pos.push(px, y0, pz); m.nrm.push(0, -1, 0); m.tan.push(1, 0, 0, 1); m.uvs.push(2, 0);
    }
    for (let i = 1; i + 1 < pts.length; i++) m.idx.push(bb, bb + i, bb + i + 1);
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        const nx = c[1] - a[1], nz = -(c[0] - a[0]);
        const l = Math.hypot(nx, nz) || 1;
        const nrm = [nx / l, 0, nz / l];
        const sb = m.pos.length / 3;
        m.pos.push(c[0], y0, c[1], a[0], y0, a[1], a[0], y1, a[1], c[0], y1, c[1]);
        for (let k = 0; k < 4; k++) { m.nrm.push(...nrm); m.tan.push(1, 0, 0, 1); m.uvs.push(2, 0); }
        m.idx.push(sb, sb + 1, sb + 2, sb, sb + 2, sb + 3);
    }
    const lx = 0.44, lz = 0.24;
    m.addBox(-lx - 0.035, 0.0, -lz - 0.035, -lx + 0.035, 0.72, -lz + 0.035, 2, 0.0);
    m.addBox(lx - 0.035, 0.0, -lz - 0.035, lx + 0.035, 0.72, -lz + 0.035, 2, 0.0);
    m.addBox(-lx - 0.035, 0.0, lz - 0.035, -lx + 0.035, 0.72, lz + 0.035, 2, 0.0);
    m.addBox(lx - 0.035, 0.0, lz - 0.035, lx + 0.035, 0.72, lz + 0.035, 2, 0.0);
    return m.build();
}

export function createChairMesh() {
    const m = new MeshAcc();
    // Chair: 0.50 x 0.92 x 0.50 m
    m.addBox(-0.24, 0.43, -0.24, 0.24, 0.48, 0.24, 2, 0.0);   // Seat
    m.addBox(-0.24, 0.46, -0.24, 0.24, 0.92, -0.17, 2, 0.0);  // Backrest
    const lx = 0.19, lz = 0.19;
    m.addBox(-lx - 0.025, 0.0, -lz - 0.025, -lx + 0.025, 0.45, -lz + 0.025, 1, 0.0);
    m.addBox(lx - 0.025, 0.0, -lz - 0.025, lx + 0.025, 0.45, -lz + 0.025, 1, 0.0);
    m.addBox(-lx - 0.025, 0.0, lz - 0.025, -lx + 0.025, 0.45, lz + 0.025, 1, 0.0);
    m.addBox(lx - 0.025, 0.0, lz - 0.025, lx + 0.025, 0.45, lz + 0.025, 1, 0.0);
    return m.build();
}

export function createDeskMesh() {
    const m = new MeshAcc();
    // Office desk: 1.50 x 0.76 x 0.75 m + monitor stand
    m.addBox(-0.75, 0.70, -0.37, 0.75, 0.76, 0.37, 2, 0.0);
    m.addBox(-0.73, 0.0, -0.35, -0.45, 0.72, 0.35, 0, 0.0); // Left drawer pedestal
    m.addBox(0.45, 0.0, -0.35, 0.73, 0.72, 0.35, 0, 0.0);   // Right drawer pedestal
    m.addBox(-0.70, 0.32, -0.35, 0.70, 0.71, -0.29, 0, 0.0); // Modesty panel
    m.addBox(-0.08, 0.74, -0.22, 0.08, 0.88, -0.14, 1, 0.0); // Monitor neck
    m.addBox(-0.32, 0.86, -0.20, 0.32, 1.18, -0.14, 1, 0.0); // Monitor screen frame
    return m.build();
}

export function createSofaMesh() {
    const m = new MeshAcc();
    // Sofa: 1.90 x 0.86 x 0.86 m
    m.addBox(-0.95, 0.0, -0.43, 0.95, 0.42, 0.43, 2, 0.0);  // Base + cushion
    m.addBox(-0.95, 0.40, -0.43, 0.95, 0.86, -0.22, 2, 0.0); // Back
    m.addBox(-0.95, 0.40, -0.43, -0.76, 0.64, 0.43, 2, 0.0); // Left arm
    m.addBox(0.76, 0.40, -0.43, 0.95, 0.64, 0.43, 2, 0.0);  // Right arm
    return m.build();
}

export function createBedMesh() {
    const m = new MeshAcc();
    // Bed: 1.50 x 0.95 x 2.05 m (minXZ = 1.50 < 2.5 m)
    m.addBox(-0.75, 0.0, -1.02, 0.75, 0.36, 1.02, 2, 0.0);   // Frame
    m.addBox(-0.71, 0.34, -0.98, 0.71, 0.56, 0.98, 0, 0.0);  // Mattress
    m.addBox(-0.75, 0.34, -1.02, 0.75, 0.95, -0.90, 2, 0.0); // Headboard
    m.addBox(-0.60, 0.54, -0.88, -0.06, 0.65, -0.58, 0, 0.0); // Left pillow
    m.addBox(0.06, 0.54, -0.88, 0.60, 0.65, -0.58, 0, 0.0);   // Right pillow
    return m.build();
}

export function createCounterMesh() {
    const m = new MeshAcc();
    // Reception / kitchen counter: 1.80 x 0.96 x 0.68 m
    m.addBox(-0.88, 0.0, -0.31, 0.88, 0.90, 0.31, 0, 0.0);
    m.addBox(-0.92, 0.88, -0.35, 0.92, 0.96, 0.35, 2, 0.0);
    return m.build();
}

export function createShelfMesh() {
    const m = new MeshAcc();
    // Bookshelf / storage rack: 1.20 x 1.90 x 0.40 m
    m.addBox(-0.60, 0.0, -0.20, -0.54, 1.90, 0.20, 2, 0.0); // Left upright
    m.addBox(0.54, 0.0, -0.20, 0.60, 1.90, 0.20, 2, 0.0);   // Right upright
    m.addBox(-0.56, 0.0, -0.20, 0.56, 1.90, -0.15, 2, 0.0); // Back panel
    const ys = [0.02, 0.48, 0.96, 1.44, 1.86];
    for (let i = 0; i < ys.length; i++) {
        m.addBox(-0.56, ys[i] - 0.02, -0.18, 0.56, ys[i] + 0.02, 0.20, 2, 0.0);
    }
    return m.build();
}

export function createLampMesh() {
    const m = new MeshAcc();
    // Floor lamp: 0.44 x 1.65 x 0.44 m
    m.addBox(-0.18, 0.0, -0.18, 0.18, 0.04, 0.18, 1, 0.0);   // Base
    m.addBox(-0.03, 0.02, -0.03, 0.03, 1.38, 0.03, 1, 0.0);  // Stem
    m.addBox(-0.22, 1.30, -0.22, 0.22, 1.64, 0.22, 5, 0.65); // Emissive shade
    return m.build();
}

export function createPlantMesh() {
    const m = new MeshAcc();
    // Potted indoor plant with stepped diagonal canopy (avoids axis_grid on boxy foliage)
    m.addBox(-0.18, 0.0, -0.18, 0.18, 0.34, 0.18, 0, 0.0);   // Pot
    m.addBox(-0.04, 0.30, -0.04, 0.04, 0.72, 0.04, 2, 0.0);  // Trunk
    // Diamond/cross-layered foliage fronds
    m.addBox(-0.24, 0.52, -0.12, 0.24, 0.74, 0.12, 2, 0.0);
    m.addBox(-0.12, 0.56, -0.24, 0.12, 0.80, 0.24, 2, 0.0);
    m.addBox(-0.18, 0.70, -0.18, 0.18, 0.92, 0.18, 2, 0.0);
    m.addBox(-0.10, 0.88, -0.10, 0.10, 1.05, 0.10, 2, 0.0);
    return m.build();
}
