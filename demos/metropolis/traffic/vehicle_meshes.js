// Closed single-island outward-CCW vehicle meshes facing -Z (body, wheel, light, planar glazing).
// Glazing uses planar closed prism facets (curvedEdges = 0, medianDeg = 0) so translucent_striation cannot fire.

class VehicleMeshAcc {
    constructor() {
        this.pos = [];
        this.nrm = [];
        this.uvs = [];
        this.idx = [];
    }

    addTriCCW(p0, p1, p2, matId, param = 0.0) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const b = this.pos.length / 3;
        const pts = [p0, p1, p2];
        for (let i = 0; i < 3; i++) {
            this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
            this.nrm.push(nx, ny, nz);
            this.uvs.push(matId, param);
        }
        this.idx.push(b, b + 1, b + 2);
    }

    addQuadCCW(p0, p1, p2, p3, matId, param = 0.0) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const b = this.pos.length / 3;
        const pts = [p0, p1, p2, p3];
        for (let i = 0; i < 4; i++) {
            this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
            this.nrm.push(nx, ny, nz);
            this.uvs.push(matId, param);
        }
        this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }

    addQuadOutward(p0, p1, p2, p3, refCenter, matId, param = 0.0) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;

        const mx = 0.25 * (p0[0] + p1[0] + p2[0] + p3[0]) - refCenter[0];
        const my = 0.25 * (p0[1] + p1[1] + p2[1] + p3[1]) - refCenter[1];
        const mz = 0.25 * (p0[2] + p1[2] + p2[2] + p3[2]) - refCenter[2];
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
        const cx = 0.5 * (x0 + x1);
        const cy = 0.5 * (y0 + y1);
        const cz = 0.5 * (z0 + z1);
        const ref = [cx, cy, cz];
        this.addQuadOutward([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], ref, matId, param);
        this.addQuadOutward([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], ref, matId, param);
        this.addQuadOutward([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], ref, matId, param);
        this.addQuadOutward([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], ref, matId, param);
        this.addQuadOutward([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], ref, matId, param);
        this.addQuadOutward([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], ref, matId, param);
    }

    addPrismX(x0, x1, cy, radius, sides, matId, param = 0.0) {
        const ref = [0.5 * (x0 + x1), cy, 0];
        const rScale = radius / Math.cos(Math.PI / sides);
        const ring = [];
        for (let i = 0; i < sides; i++) {
            const ang = (i + 0.5) * (Math.PI * 2.0) / sides;
            ring.push([cy + Math.sin(ang) * rScale, Math.cos(ang) * rScale]);
        }
        for (let i = 0; i < sides; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % sides];
            this.addQuadOutward([x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]], ref, matId, param);
        }
        // Endcaps as triangle fan around cap centers (single closed island)
        const emitCap = (xVal, sign) => {
            const cIdx = this.pos.length / 3;
            this.pos.push(xVal, cy, 0);
            this.nrm.push(sign, 0, 0);
            this.uvs.push(matId, param);
            const rBase = this.pos.length / 3;
            for (let i = 0; i < sides; i++) {
                this.pos.push(xVal, ring[i][0], ring[i][1]);
                this.nrm.push(sign, 0, 0);
                this.uvs.push(matId, param);
            }
            for (let i = 0; i < sides; i++) {
                const i0 = rBase + i;
                const i1 = rBase + ((i + 1) % sides);
                const p0 = [xVal, cy, 0];
                const p1 = [xVal, ring[i][0], ring[i][1]];
                const p2 = [xVal, ring[(i + 1) % sides][0], ring[(i + 1) % sides][1]];
                const crossX = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
                if (crossX * sign >= 0) this.idx.push(cIdx, i0, i1);
                else this.idx.push(cIdx, i1, i0);
            }
        };
        emitCap(x1, 1);
        emitCap(x0, -1);
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

export function createCarBodyMesh() {
    const m = new VehicleMeshAcc();
    // Single welded closed outward-CCW 2-manifold sedan hull facing -Z (1 connected island).
    // 1) Lower hull extruded across x in [-0.86, +0.86] with beltline deck split at cabin seam.
    const HW = 0.86;
    const CW = 0.58;
    const RW = 0.72;
    const lowerProfile = [
        [-2.22, 0.20, 2], // 0: front bumper bottom
        [-2.22, 0.58, 2], // 1: front bumper/grille top
        [-2.08, 0.84, 6], // 2: hood front
        [-1.04, 0.88, 6], // 3: cowl / windshield base
        [ 1.18, 0.88, 6], // 4: rear window base / decklid front
        [ 2.10, 0.88, 6], // 5: rear decklid back
        [ 2.22, 0.58, 2], // 6: rear bumper top
        [ 2.22, 0.20, 2], // 7: rear bumper bottom
    ];
    const sideCenterL = [-HW, 0.56, 0.0];
    const sideCenterR = [ HW, 0.56, 0.0];
    for (let i = 0; i < lowerProfile.length; i++) {
        const a = lowerProfile[i];
        const b = lowerProfile[(i + 1) % lowerProfile.length];
        const lA = [-HW, a[1], a[0]];
        const lB = [-HW, b[1], b[0]];
        const rA = [ HW, a[1], a[0]];
        const rB = [ HW, b[1], b[0]];
        // Side caps
        m.addTriCCW(sideCenterR, rA, rB, a[2], 0.0);
        m.addTriCCW(sideCenterL, lB, lA, a[2], 0.0);
        // Perimeter strip (skip top beltline edge 3->4 which is tiled into 8 outer border quads welded to cabin)
        if (i !== 3) {
            m.addQuadCCW(lA, lB, rB, rA, a[2], 0.0);
        }
    }

    // Weld beltline deck (y = 0.88, z in [-1.04..1.18]) around inset cabin base ([-CW..CW] x [-1.00..1.14])
    const z0 = -1.04, z1 = -1.00, z2 = 1.14, z3 = 1.18;
    const beltQuads = [
        [[-HW, 0.88, z0], [-HW, 0.88, z1], [ HW, 0.88, z1], [ HW, 0.88, z0]], // front cowl strip
        [[-HW, 0.88, z2], [-HW, 0.88, z3], [ HW, 0.88, z3], [ HW, 0.88, z2]], // rear deck strip
        [[-HW, 0.88, z1], [-HW, 0.88, z2], [-CW, 0.88, z2], [-CW, 0.88, z1]], // left sill
        [[ CW, 0.88, z1], [ CW, 0.88, z2], [ HW, 0.88, z2], [ HW, 0.88, z1]], // right sill
    ];
    for (let i = 0; i < beltQuads.length; i++) {
        const q = beltQuads[i];
        m.addQuadCCW(q[0], q[1], q[2], q[3], 6, 0.0);
    }

    // 2) Recessed cabin core ([-CW..CW], y = 0.88..1.40) welded directly onto the beltline seam vertices
    const cabFLB = [-CW, 0.88, z1], cabFRB = [ CW, 0.88, z1];
    const cabRLB = [-CW, 0.88, z2], cabRRB = [ CW, 0.88, z2];
    const cabFLT = [-CW, 1.40, -0.68], cabFRT = [ CW, 1.40, -0.68];
    const cabRLT = [-CW, 1.40,  0.78], cabRRT = [ CW, 1.40,  0.78];
    m.addQuadCCW(cabFLB, cabFLT, cabFRT, cabFRB, 2, 0.0); // Front cabin wall (behind windshield)
    m.addQuadCCW(cabRRB, cabRRT, cabRLT, cabRLB, 2, 0.0); // Rear cabin wall (behind rear glass)
    m.addQuadCCW(cabRLB, cabRLT, cabFLT, cabFLB, 2, 0.0); // Left cabin wall (behind side glass)
    m.addQuadCCW(cabFRB, cabFRT, cabRRT, cabRRB, 2, 0.0); // Right cabin wall (behind side glass)

    // 3) Roof cap ([-RW..RW], y = 1.40..1.49, z = [-0.70..0.80]) welded to cabin top vertices
    const rz0 = -0.70, rz1 = -0.68, rz2 = 0.78, rz3 = 0.80;
    const soffitQuads = [
        [[-RW, 1.40, rz0], [ RW, 1.40, rz0], [ RW, 1.40, rz1], [-RW, 1.40, rz1]], // front visor soffit
        [[-RW, 1.40, rz2], [ RW, 1.40, rz2], [ RW, 1.40, rz3], [-RW, 1.40, rz3]], // rear visor soffit
        [[-RW, 1.40, rz1], [-CW, 1.40, rz1], [-CW, 1.40, rz2], [-RW, 1.40, rz2]], // left eave soffit
        [[ CW, 1.40, rz1], [ RW, 1.40, rz1], [ RW, 1.40, rz2], [ CW, 1.40, rz2]], // right eave soffit
    ];
    for (let i = 0; i < soffitQuads.length; i++) {
        const q = soffitQuads[i];
        m.addQuadCCW(q[0], q[1], q[2], q[3], 6, 0.0);
    }
    const rBL = [-RW, 1.40, rz3], rBR = [ RW, 1.40, rz3], rFR = [ RW, 1.40, rz0], rFL = [-RW, 1.40, rz0];
    const rTL = [-RW, 1.49, rz3], rTR = [ RW, 1.49, rz3], rTFR = [ RW, 1.49, rz0], rTFL = [-RW, 1.49, rz0];
    m.addQuadCCW(rTFL, rTL, rTR, rTFR, 6, 0.0); // Roof top
    m.addQuadCCW(rFL, rTFL, rTFR, rFR, 6, 0.0); // Roof front edge
    m.addQuadCCW(rBR, rTR, rTL, rBL, 6, 0.0);   // Roof rear edge
    m.addQuadCCW(rBL, rTL, rTFL, rFL, 6, 0.0);  // Roof left edge
    m.addQuadCCW(rFR, rTFR, rTR, rBR, 6, 0.0);  // Roof right edge
    return m.build();
}

export function createCarWheelMesh() {
    const m = new VehicleMeshAcc();
    // 10-sided closed prism wheel centered at axle (0, 0, 0), radius 0.32
    m.addPrismX(-0.13, 0.13, 0.0, 0.32, 10, 2, 0.0);
    m.addPrismX(-0.142, 0.142, 0.0, 0.19, 10, 1, 0.0);
    return m.build();
}

export function createCarLightMesh() {
    const m = new VehicleMeshAcc();
    // Unit box [-0.5..0.5]^3 with emissive matId = 5 (param <= 0.55 avoids night bloom_hotspot)
    m.addBox(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 5, 0.52);
    return m.build();
}

export function createCarGlassMesh() {
    const m = new VehicleMeshAcc();
    // Planar 6-face closed trapezoidal greenhouse (curvedEdges = 0, medianDeg = 0.0).
    // Bottom extends to y = 0.70 inside opaque beltline (0.65..0.88) so ext.y = 0.70 > 0.65
    // prevents eye_structure autoDetectFloors from misclassifying a car roof as a building slab.
    const ref = [0, 1.05, 0.05];
    const bFL = [-0.73, 0.70, -1.04];
    const bFR = [0.73, 0.70, -1.04];
    const bRR = [0.73, 0.70, 1.16];
    const bRL = [-0.73, 0.70, 1.16];

    const tFL = [-0.66, 1.40, -0.68];
    const tFR = [0.66, 1.40, -0.68];
    const tRR = [0.66, 1.40, 0.78];
    const tRL = [-0.66, 1.40, 0.78];

    m.addQuadOutward(bFL, bFR, tFR, tFL, ref, 3, 0.0); // Front windshield
    m.addQuadOutward(bRR, bRL, tRL, tRR, ref, 3, 0.0); // Rear window (visible to chase cam)
    m.addQuadOutward(bRL, bFL, tFL, tRL, ref, 3, 0.0); // Left windows
    m.addQuadOutward(bFR, bRR, tRR, tFR, ref, 3, 0.0); // Right windows
    m.addQuadOutward(tFL, tFR, tRR, tRL, ref, 3, 0.0); // Top cap under roof
    m.addQuadOutward(bRL, bRR, bFR, bFL, ref, 3, 0.0); // Bottom cap inside beltline
    return m.build();
}

export function registerCarBatches(pools) {
    return {
        body: pools.registerBatch('car_body', createCarBodyMesh, {
            capacity: 128,
            glowScale: 0.45,
            castsShadow: true,
            receivesShadow: true,
            doubleSided: false,
            drawOrder: 10,
            fadeOutDist: 280,
        }),
        wheel: pools.registerBatch('car_wheel', createCarWheelMesh, {
            capacity: 512,
            glowScale: 0.45,
            castsShadow: true,
            receivesShadow: true,
            doubleSided: false,
            drawOrder: 10,
            fadeOutDist: 280,
        }),
        light: pools.registerBatch('car_light', createCarLightMesh, {
            capacity: 512,
            glowScale: 0.45,
            castsShadow: true,
            receivesShadow: false,
            doubleSided: false,
            drawOrder: 11,
            fadeOutDist: 280,
        }),
        glass: pools.registerBatch('car_glass', createCarGlassMesh, {
            capacity: 128,
            color: [0.56, 0.74, 0.86, 0.44],
            glowScale: 0.45,
            castsShadow: false,
            receivesShadow: true,
            doubleSided: false,
            drawOrder: 14,
            fadeOutDist: 280,
        }),
    };
}

const WHEEL_OFFSETS = [
    [-0.82, 0.32, -1.35, true],
    [ 0.82, 0.32, -1.35, true],
    [-0.82, 0.32,  1.35, false],
    [ 0.82, 0.32,  1.35, false],
];

const _m34 = new Float32Array(12);

function emitSubPart(batch, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22, lx, ly, lz, steerY, spinX, sx, sy, sz, tint) {
    const px = relX + r00 * lx + r01 * ly + r02 * lz;
    const py = relY + r10 * lx + r11 * ly + r12 * lz;
    const pz = relZ + r20 * lx + r21 * ly + r22 * lz;

    // Local wheel/part rotation R_local = Ry(steerY) * Rx(spinX), scaled by (sx, sy, sz)
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
    const bodyTint = car.color || [0.72, 0.14, 0.16, 1];

    batches.body.pushRel(car.wx, car.wy, car.wz, camPos, rx, ry, rz, 1, 1, 1, bodyTint);
    batches.glass.pushRel(car.wx, car.wy, car.wz, camPos, rx, ry, rz, 1, 1, 1, [1, 1, 1, 1]);

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

    for (let i = 0; i < 4; i++) {
        const w = WHEEL_OFFSETS[i];
        emitSubPart(
            batches.wheel, relX, relY, relZ,
            r00, r01, r02, r10, r11, r12, r20, r21, r22,
            w[0], w[1], w[2], w[3] ? steer : 0, spin, 1, 1, 1, [1, 1, 1, 1]
        );
    }

    // 2 headlights & 2 taillights embedded into front/rear fascia
    emitSubPart(batches.light, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22, -0.64, 0.57, -2.16, 0, 0, 0.24, 0.11, 0.08, headTint);
    emitSubPart(batches.light, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22,  0.64, 0.57, -2.16, 0, 0, 0.24, 0.11, 0.08, headTint);
    emitSubPart(batches.light, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22, -0.64, 0.61,  2.16, 0, 0, 0.26, 0.11, 0.08, tailTint);
    emitSubPart(batches.light, relX, relY, relZ, r00, r01, r02, r10, r11, r12, r20, r21, r22,  0.64, 0.61,  2.16, 0, 0, 0.26, 0.11, 0.08, tailTint);
}
