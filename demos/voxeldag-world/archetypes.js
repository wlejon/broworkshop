// Procedural SVDAG archetype library using unitBounds + sub-cell vertical slotting.

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const mix = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class MeshBuilder {
    constructor() {
        this.pos = [];
        this.nrm = [];
        this.col = [];
        this.idx = [];
    }

    pushVertex(x, y, z, nx, ny, nz, rgba) {
        const l = Math.hypot(nx, ny, nz) || 1;
        this.pos.push(x, y, z);
        this.nrm.push(nx / l, ny / l, nz / l);
        this.col.push(rgba[0], rgba[1], rgba[2], rgba[3] ?? 1.0);
        return (this.pos.length / 3) - 1;
    }

    addTri(a, b, c) { this.idx.push(a, b, c); }

    addBox(cx, cy, cz, hx, hy, hz, rgba) {
        const faces = [
            [[1, 0, 0],  [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
            [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
            [[0, 1, 0],  [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
            [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
            [[0, 0, 1],  [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
            [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
        ];
        for (const [n, cs] of faces) {
            const b = this.pos.length / 3;
            for (const c of cs) {
                this.pushVertex(cx + c[0] * hx, cy + c[1] * hy, cz + c[2] * hz, n[0], n[1], n[2], rgba);
            }
            this.addTri(b, b + 1, b + 2);
            this.addTri(b, b + 2, b + 3);
        }
    }

    addOrientedBox(cx, cy, cz, ax, ay, az, bx, by, bz, nx, ny, nz, hx, hy, hz, rgba) {
        const pt = (u, v, w) => [
            cx + ax * (u * hx) + bx * (v * hy) + nx * (w * hz),
            cy + ay * (u * hx) + by * (v * hy) + ny * (w * hz),
            cz + az * (u * hx) + bz * (v * hy) + nz * (w * hz),
        ];
        const faces = [
            [[ax, ay, az],     [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
            [[-ax, -ay, -az],  [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
            [[bx, by, bz],     [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
            [[-bx, -by, -bz],  [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
            [[nx, ny, nz],     [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
            [[-nx, -ny, -nz],  [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
        ];
        for (const [nrm, cs] of faces) {
            const base = this.pos.length / 3;
            for (const c of cs) {
                const p = pt(c[0], c[1], c[2]);
                this.pushVertex(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], rgba);
            }
            this.addTri(base, base + 1, base + 2);
            this.addTri(base, base + 2, base + 3);
        }
    }

    addTaperedRingCyl(x0, y0, z0, x1, y1, z1, r0, r1, segs, cBot, cTop) {
        const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
        const len = Math.hypot(ax, ay, az) || 1;
        const dx = ax / len, dy = ay / len, dz = az / len;
        const ref = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let ux = dy * ref[2] - dz * ref[1];
        let uy = dz * ref[0] - dx * ref[2];
        let uz = dx * ref[1] - dy * ref[0];
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;

        const base = this.pos.length / 3;
        for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            const cs = Math.cos(a), sn = Math.sin(a);
            const nx = ux * cs + vx * sn, ny = uy * cs + vy * sn, nz = uz * cs + vz * sn;
            this.pushVertex(x0 + nx * r0, y0 + ny * r0, z0 + nz * r0, nx, ny, nz, cBot);
            this.pushVertex(x1 + nx * r1, y1 + ny * r1, z1 + nz * r1, nx, ny, nz, cTop);
        }
        for (let i = 0; i < segs; i++) {
            const a0 = base + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
            this.addTri(a0, a1, b0);
            this.addTri(b0, a1, b1);
        }
        const bc = this.pushVertex(x0, y0, z0, -dx, -dy, -dz, cBot);
        const tc = this.pushVertex(x1, y1, z1, dx, dy, dz, cTop);
        for (let i = 0; i < segs; i++) {
            this.addTri(bc, base + (i + 1) * 2, base + i * 2);
            this.addTri(tc, base + i * 2 + 1, base + (i + 1) * 2 + 1);
        }
    }

    addCone(cx, cy, cz, rBase, h, segs, cBot, cTop) {
        this.addTaperedRingCyl(cx, cy, cz, cx, cy + h, cz, rBase, Math.max(0.015, rBase * 0.08), segs, cBot, cTop);
    }

    addBlob(cx, cy, cz, rx, ry, rz, cBase, cHi, rng, jitter = 0.14) {
        const stacks = 4, slices = 8;
        const verts = [];
        for (let st = 0; st <= stacks; st++) {
            const phi = (st / stacks) * Math.PI;
            const sy = Math.cos(phi), sr = Math.sin(phi);
            for (let sl = 0; sl <= slices; sl++) {
                const th = (sl / slices) * Math.PI * 2;
                let lx = sr * Math.cos(th), ly = sy, lz = sr * Math.sin(th);
                if (st > 0 && st < stacks && sl < slices) {
                    const j = 1 + (rng() * 2 - 1) * jitter;
                    lx *= j;
                    ly *= 1 + (rng() * 2 - 1) * jitter * 0.6;
                    lz *= j;
                }
                const shade = clamp(0.68 + 0.32 * sy, 0.48, 1.0);
                const col = mix3(cBase, cHi, clamp(0.5 + 0.5 * sy, 0, 1));
                verts.push(this.pushVertex(
                    cx + lx * rx, cy + ly * ry, cz + lz * rz,
                    lx / rx, ly / ry, lz / rz,
                    [col[0] * shade, col[1] * shade, col[2] * shade, 1.0]
                ));
            }
        }
        const stride = slices + 1;
        for (let st = 0; st < stacks; st++) {
            for (let sl = 0; sl < slices; sl++) {
                const a = verts[st * stride + sl], b = a + 1;
                const c = verts[(st + 1) * stride + sl], d = c + 1;
                this.addTri(a, c, b);
                this.addTri(b, c, d);
            }
        }
    }

    addPyramid(cx, cy, cz, halfW, h, cBase, cApex) {
        const corners = [
            [cx - halfW, cy, cz - halfW],
            [cx + halfW, cy, cz - halfW],
            [cx + halfW, cy, cz + halfW],
            [cx - halfW, cy, cz + halfW],
        ];
        const apex = [cx, cy + h, cz];
        for (let i = 0; i < 4; i++) {
            const p0 = corners[i], p1 = corners[(i + 1) % 4];
            const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
            const vx = apex[0] - p0[0], vy = apex[1] - p0[1], vz = apex[2] - p0[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const dMid = [0.5 * (p0[0] + p1[0]) - cx, 0, 0.5 * (p0[2] + p1[2]) - cz];
            if (nx * dMid[0] + nz * dMid[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
            const i0 = this.pushVertex(p0[0], p0[1], p0[2], nx, ny, nz, cBase);
            const i1 = this.pushVertex(p1[0], p1[1], p1[2], nx, ny, nz, cBase);
            const ia = this.pushVertex(apex[0], apex[1], apex[2], nx, ny, nz, cApex);
            this.addTri(i0, i1, ia);
        }
        const b0 = this.pushVertex(corners[0][0], corners[0][1], corners[0][2], 0, -1, 0, cBase);
        const b1 = this.pushVertex(corners[1][0], corners[1][1], corners[1][2], 0, -1, 0, cBase);
        const b2 = this.pushVertex(corners[2][0], corners[2][1], corners[2][2], 0, -1, 0, cBase);
        const b3 = this.pushVertex(corners[3][0], corners[3][1], corners[3][2], 0, -1, 0, cBase);
        this.addTri(b0, b2, b1);
        this.addTri(b0, b3, b2);
    }

    toMesh() {
        let minY = Infinity, maxY = -Infinity;
        for (let i = 1; i < this.pos.length; i += 3) {
            const y = this.pos[i];
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        return {
            positions: new Float32Array(this.pos),
            normals: new Float32Array(this.nrm),
            colors: new Float32Array(this.col),
            indices: new Uint32Array(this.idx),
            minY,
            maxY,
        };
    }
}

function shiftMeshY(mesh, dy) {
    const pos = new Float32Array(mesh.positions.length);
    pos.set(mesh.positions);
    for (let i = 1; i < pos.length; i += 3) pos[i] += dy;
    return { ...mesh, positions: pos, minY: mesh.minY + dy, maxY: mesh.maxY + dy };
}

function voxMeshFixed(vd, mesh, depth, opts) {
    if (!mesh || mesh.maxY < -1.0 || mesh.minY > 1.0) return null;
    const r = vd.addArchetypeFromMesh(mesh, depth, { ...opts, unitBounds: true });
    return r.ref === 0xFFFFFFFF ? null : r;
}

function voxelizeSlotted(vd, mesh, depth, opts, slotCount) {
    const slots = new Array(slotCount);
    for (let s = 0; s < slotCount; s++) {
        const yDatum = -1.0 + ((s + 0.5) / slotCount) * 2.0;
        slots[s] = {
            main: voxMeshFixed(vd, shiftMeshY(mesh, yDatum), depth, opts),
            upper: voxMeshFixed(vd, shiftMeshY(mesh, yDatum - 2.0), depth, opts),
            below: voxMeshFixed(vd, shiftMeshY(mesh, yDatum + 2.0), depth, opts),
        };
    }
    return slots;
}

function voxelizeSlottedAnim(vd, frameMeshes, depth, opts, slotCount) {
    const nFrames = frameMeshes.length;
    const phases = Array.from({ length: nFrames }, () => new Array(slotCount));
    for (let s = 0; s < slotCount; s++) {
        const yDatum = -1.0 + ((s + 0.5) / slotCount) * 2.0;
        const mRefs = [], uRefs = [], bRefs = [];
        for (const m of frameMeshes) {
            const rm = voxMeshFixed(vd, shiftMeshY(m, yDatum), depth, opts);
            const ru = voxMeshFixed(vd, shiftMeshY(m, yDatum - 2.0), depth, opts);
            const rb = voxMeshFixed(vd, shiftMeshY(m, yDatum + 2.0), depth, opts);
            if (rm) mRefs.push(rm);
            if (ru) uRefs.push(ru);
            if (rb) bRefs.push(rb);
        }
        const mClip = mRefs.length === nFrames ? vd.registerAnimClip(mRefs) : -1;
        const uClip = uRefs.length === nFrames ? vd.registerAnimClip(uRefs) : -1;
        const bClip = bRefs.length === nFrames ? vd.registerAnimClip(bRefs) : -1;
        for (let ph = 0; ph < nFrames; ph++) {
            phases[ph][s] = {
                main: mClip >= 0 ? vd.makeAnimRef(mClip, ph) : (mRefs[0] || null),
                upper: uClip >= 0 ? vd.makeAnimRef(uClip, ph) : (uRefs[0] || null),
                below: bClip >= 0 ? vd.makeAnimRef(bClip, ph) : (bRefs[0] || null),
            };
        }
    }
    return phases;
}

function addOrganicTree(mb, { cx, cz, yBase, scale, species, swayX, swayZ, rng }) {
    const bark = [0.29, 0.21, 0.14];
    const rootY = yBase - 0.44 * scale;
    const h = 1.45 * scale;
    if (species === 2) {
        // Tall dark conifer with tiered conical skirts
        const leaf = [0.09, 0.27, 0.14], hi = [0.16, 0.39, 0.19];
        mb.addTaperedRingCyl(cx, rootY, cz, cx + swayX * 0.6, yBase + h * 0.80, cz + swayZ * 0.6,
            0.095 * scale, 0.030 * scale, 6, bark, bark);
        for (let t = 0; t < 4; t++) {
            const u = t / 4;
            const r = (0.40 - u * 0.22) * scale;
            const ty = yBase + h * (0.16 + u * 0.58);
            const dx = swayX * (0.3 + u * 0.7), dz = swayZ * (0.3 + u * 0.7);
            mb.addCone(cx + dx, ty, cz + dz, r, 0.44 * scale * (1 - u * 0.22), 7, scale3(leaf, 0.82 + u * 0.14), hi);
        }
        return;
    }
    const isAutumn = species === 1;
    const leaf = isAutumn ? [0.76, 0.38, 0.10] : [0.15, 0.40, 0.14];
    const hi = isAutumn ? [0.92, 0.62, 0.16] : [0.30, 0.56, 0.20];
    const trunkTop = yBase + h * 0.50;
    mb.addTaperedRingCyl(cx, rootY, cz, cx + swayX * 0.4, trunkTop, cz + swayZ * 0.4,
        0.10 * scale, 0.045 * scale, 6, bark, bark);
    const cr = 0.36 * scale;
    mb.addBlob(cx + swayX * 0.9, yBase + h * 0.68, cz + swayZ * 0.9, cr * 1.12, cr * 0.92, cr * 1.12, scale3(leaf, 0.84), hi, rng, 0.15);
    mb.addBlob(cx + swayX + 0.14 * scale, yBase + h * 0.58, cz + swayZ + 0.08 * scale, cr * 0.78, cr * 0.72, cr * 0.78, leaf, hi, rng, 0.14);
    mb.addBlob(cx + swayX - 0.12 * scale, yBase + h * 0.62, cz + swayZ - 0.10 * scale, cr * 0.74, cr * 0.70, cr * 0.74, leaf, hi, rng, 0.14);
    mb.addBlob(cx + swayX * 1.05, yBase + h * 0.88, cz + swayZ * 1.05, cr * 0.70, cr * 0.68, cr * 0.70, leaf, scale3(hi, 1.1), rng, 0.12);
}

function buildWindmillFrames() {
    const stoneA = [0.68, 0.64, 0.58], stoneB = [0.52, 0.49, 0.45];
    const timber = [0.34, 0.22, 0.13];
    const roofBot = [0.58, 0.25, 0.16], roofTop = [0.42, 0.16, 0.11];
    const sail = [0.93, 0.91, 0.84];
    const frames = [];
    for (let f = 0; f < 8; f++) {
        const mb = new MeshBuilder();
        const theta0 = (f / 8) * (Math.PI * 0.5);
        // Tapered stone & timber tower spanning fixed [-0.45, +1.58] height across every frame
        mb.addTaperedRingCyl(0, -0.45, 0, 0, 1.15, 0, 0.42, 0.25, 8, stoneB, stoneA);
        mb.addCone(0, 1.15, 0, 0.30, 0.43, 8, roofBot, roofTop);
        // Timber hub & shaft protruding toward +Z
        mb.addBox(0, 0.92, 0.24, 0.08, 0.08, 0.18, timber);
        for (let b = 0; b < 4; b++) {
            const a = theta0 + b * (Math.PI * 0.5);
            const ax = Math.cos(a), ay = Math.sin(a);
            const bx = -ay, by = ax;
            const rMid = 0.34;
            const sx = ax * rMid, sy = 0.92 + ay * rMid;
            // Thick timber spar so 32^3 voxels resolve unbroken spinning blades
            mb.addOrientedBox(sx, sy, 0.40, ax, ay, 0, bx, by, 0, 0, 0, 1, 0.31, 0.045, 0.048, timber);
            // White canvas sail panel trailing one side of the spar
            const cx = sx + bx * 0.075 + ax * 0.06, cy = sy + by * 0.075 + ay * 0.06;
            mb.addOrientedBox(cx, cy, 0.42, ax, ay, 0, bx, by, 0, 0, 0, 1, 0.24, 0.068, 0.036, sail);
        }
        frames.push(mb.toMesh());
    }
    return frames;
}

function buildCrystalBeaconFrames(vd, depth, slotCount) {
    // Non-emissive stone cairn base + 4-phase pulsing emissive crystal cluster merged cleanly
    const rng = mulberry32(911);
    const baseMb = new MeshBuilder();
    baseMb.addBlob(0, -0.05, 0, 0.40, 0.38, 0.40, [0.34, 0.36, 0.33], [0.46, 0.48, 0.43], rng, 0.16);
    baseMb.addBlob(-0.14, 0.06, 0.12, 0.24, 0.22, 0.22, [0.30, 0.33, 0.30], [0.44, 0.45, 0.40], rng, 0.15);
    baseMb.addBlob(0.15, 0.04, -0.10, 0.22, 0.20, 0.24, [0.32, 0.34, 0.31], [0.45, 0.46, 0.42], rng, 0.15);
    const cairnSlots = voxelizeSlotted(vd, baseMb.toMesh(), depth, { fillInterior: true, roughness: 0.92 }, slotCount);

    const pulseScales = [0.58, 0.85, 1.15, 0.88];
    const pulseEmissive = [0.30, 0.62, 0.95, 0.65];
    const crystalMesh = (() => {
        const mb = new MeshBuilder();
        const shards = [
            [0.0, 0.22, 0.0, 0.0, 1.02, 0.0, 0.10],
            [-0.12, 0.18, 0.08, -0.26, 0.80, 0.16, 0.075],
            [0.13, 0.18, -0.06, 0.26, 0.78, -0.14, 0.075],
            [0.04, 0.18, 0.14, 0.10, 0.68, 0.24, 0.068],
        ];
        const colA = [0.18, 0.78, 0.92], colB = [0.64, 0.98, 1.00];
        for (const [x0, y0, z0, x1, y1, z1, r] of shards) {
            mb.addTaperedRingCyl(x0, y0, z0, x1, y1, z1, r, r * 0.16, 5, colA, colB);
        }
        return mb.toMesh();
    })();

    const frameSets = [];
    for (let ph = 0; ph < 4; ph++) {
        const colCopy = new Float32Array(crystalMesh.colors.length);
        const s = pulseScales[ph];
        for (let i = 0; i < colCopy.length; i += 4) {
            colCopy[i] = clamp(crystalMesh.colors[i] * s, 0, 1);
            colCopy[i + 1] = clamp(crystalMesh.colors[i + 1] * s, 0, 1);
            colCopy[i + 2] = clamp(crystalMesh.colors[i + 2] * s, 0, 1);
            colCopy[i + 3] = 1.0;
        }
        const fm = { ...crystalMesh, colors: colCopy };
        frameSets.push(voxelizeSlotted(vd, fm, depth, {
            fillInterior: true, roughness: 0.25, emissive: pulseEmissive[ph],
        }, slotCount));
    }

    const phases = Array.from({ length: 4 }, () => new Array(slotCount));
    for (let s = 0; s < slotCount; s++) {
        const mRefs = [], uRefs = [], bRefs = [];
        for (let ph = 0; ph < 4; ph++) {
            const cMain = cairnSlots[s].main, cUp = cairnSlots[s].upper, cLow = cairnSlots[s].below;
            const kMain = frameSets[ph][s].main, kUp = frameSets[ph][s].upper, kLow = frameSets[ph][s].below;
            if (cMain || kMain) mRefs.push(cMain && kMain ? vd.mergeArchetypes(cMain, kMain) : (cMain || kMain));
            if (cUp || kUp) uRefs.push(cUp && kUp ? vd.mergeArchetypes(cUp, kUp) : (cUp || kUp));
            if (cLow || kLow) bRefs.push(cLow && kLow ? vd.mergeArchetypes(cLow, kLow) : (cLow || kLow));
        }
        const mc = mRefs.length === 4 ? vd.registerAnimClip(mRefs) : -1;
        const uc = uRefs.length === 4 ? vd.registerAnimClip(uRefs) : -1;
        const bc = bRefs.length === 4 ? vd.registerAnimClip(bRefs) : -1;
        for (let ph = 0; ph < 4; ph++) {
            phases[ph][s] = {
                main: mc >= 0 ? vd.makeAnimRef(mc, ph) : (mRefs[0] || null),
                upper: uc >= 0 ? vd.makeAnimRef(uc, ph) : (uRefs[0] || null),
                below: bc >= 0 ? vd.makeAnimRef(bc, ph) : (bRefs[0] || null),
            };
        }
    }
    return phases;
}

function buildHeroCavern(vd) {
    // 16 m cell @ depth=4 (64^3 voxels): solid vault recessed inside steep cliff (z_norm <= 0.60).
    const rockDark = [0.22, 0.16, 0.14];
    const rockWarm = [0.48, 0.29, 0.19];
    const floorCol = [0.29, 0.23, 0.19];
    const shell = new MeshBuilder();
    const rng = mulberry32(4201);

    // Enclosed sandstone chamber strictly behind z_norm = +0.60 (cliff rises to 39 m ahead of it)
    shell.addBox(0, -0.78, -0.20, 0.98, 0.22, 0.78, floorCol);   // stone floor -> z_norm <= +0.58
    shell.addBox(0, -0.02, -0.82, 0.98, 0.96, 0.17, rockDark);   // solid back wall
    shell.addBox(-0.74, -0.02, -0.20, 0.25, 0.96, 0.78, rockWarm); // west cheek
    shell.addBox(0.74, -0.02, -0.20, 0.25, 0.96, 0.78, rockWarm);  // east cheek
    shell.addBox(0, 0.66, -0.20, 0.98, 0.32, 0.78, rockWarm);    // cliff vault ceiling
    // Natural rocky portal arch & threshold boulders inside mouth + ceiling stalactites
    shell.addBlob(-0.46, -0.44, 0.48, 0.22, 0.22, 0.26, rockDark, floorCol, rng, 0.18);
    shell.addBlob(0.46, -0.44, 0.48, 0.22, 0.22, 0.26, rockDark, floorCol, rng, 0.18);
    shell.addBlob(-0.42, 0.26, 0.46, 0.24, 0.24, 0.22, rockDark, rockWarm, rng, 0.18);
    shell.addBlob(0.42, 0.26, 0.46, 0.24, 0.24, 0.22, rockDark, rockWarm, rng, 0.18);
    shell.addCone(-0.22, 0.38, 0.26, 0.10, -0.32, 5, rockWarm, rockDark);
    shell.addCone(0.24, 0.36, 0.10, 0.10, -0.30, 5, rockWarm, rockDark);
    shell.addCone(0.0, 0.40, -0.20, 0.12, -0.34, 5, rockDark, rockWarm);

    const crystal = new MeshBuilder();
    const glowTurqA = [0.04, 0.56, 0.84], glowTurqB = [0.16, 0.88, 0.96];
    const glowAmbA = [0.90, 0.34, 0.05], glowAmbB = [1.00, 0.68, 0.16];
    crystal.addTaperedRingCyl(-0.26, -0.60, -0.36, -0.18, 0.04, -0.26, 0.10, 0.02, 5, glowTurqA, glowTurqB);
    crystal.addTaperedRingCyl(0.24, -0.60, -0.24, 0.15, 0.10, -0.18, 0.11, 0.02, 5, glowAmbA, glowAmbB);
    crystal.addTaperedRingCyl(0.0, -0.60, -0.46, 0.0, 0.20, -0.38, 0.12, 0.025, 5, glowTurqA, glowTurqB);

    const solidShell = vd.addArchetypeFromMesh(shell.toMesh(), 4, { unitBounds: true, fillInterior: true, roughness: 0.94 });
    const crystalRef = vd.addArchetypeFromMesh(crystal.toMesh(), 4, { unitBounds: true, fillInterior: true, roughness: 0.28, emissive: 0.48 });
    const solid = vd.mergeArchetypes(solidShell, crystalRef);
    const carve = vd.addCarveArchetypeFromSdf({
        kind: 'tunnel', axis: 'z', radius: 0.46, halfLength: 0.88, center: [0, -0.24, 0.26],
    }, 4);

    // Foundation threshold beneath cavern cell (iy - 1) also recessed behind cliff slope
    const skirtMb = new MeshBuilder();
    skirtMb.addBox(0, 0.45, -0.22, 0.96, 0.55, 0.74, floorCol);
    const base = vd.addArchetypeFromMesh(skirtMb.toMesh(), 4, { unitBounds: true, fillInterior: true, roughness: 0.94 });

    return { solid, carve, base };
}

function buildHeroOverhang(vd) {
    const sandA = [0.50, 0.30, 0.20], sandB = [0.31, 0.22, 0.18];
    const rng = mulberry32(8302);

    // Inner undercut grotto built cleanly from organic rounded rock strata (no sharp box corners)
    const innerMb = new MeshBuilder();
    innerMb.addBox(0, -0.82, -0.24, 0.84, 0.16, 0.68, sandB);     // recessed stone floor shelf (z <= 0.44)
    innerMb.addBox(0, -0.08, -0.72, 0.84, 0.84, 0.24, sandB);    // deep cliff back wall
    innerMb.addBlob(-0.66, -0.10, -0.22, 0.24, 0.76, 0.62, sandB, sandA, rng, 0.14); // west buttress
    innerMb.addBlob(0.66, -0.10, -0.22, 0.24, 0.76, 0.62, sandB, sandA, rng, 0.14);  // east buttress
    innerMb.addBlob(0, 0.56, 0.18, 0.82, 0.34, 0.78, sandB, sandA, rng, 0.12);       // organic roof meeting brow at z=+0.96
    innerMb.addCone(-0.18, 0.30, 0.10, 0.09, -0.24, 5, sandA, sandB);
    innerMb.addCone(0.20, 0.28, 0.02, 0.09, -0.22, 5, sandA, sandB);

    const glowMb = new MeshBuilder();
    const ambA = [0.92, 0.35, 0.06], ambB = [1.0, 0.70, 0.18];
    glowMb.addTaperedRingCyl(-0.20, -0.64, -0.22, -0.14, -0.14, -0.14, 0.09, 0.02, 5, ambA, ambB);
    glowMb.addTaperedRingCyl(0.18, -0.64, -0.18, 0.12, -0.12, -0.10, 0.09, 0.02, 5, ambA, ambB);

    const innerShell = vd.addArchetypeFromMesh(innerMb.toMesh(), 4, { unitBounds: true, fillInterior: true, roughness: 0.93 });
    const innerGlow = vd.addArchetypeFromMesh(glowMb.toMesh(), 4, { unitBounds: true, fillInterior: true, roughness: 0.30, emissive: 0.48 });
    // Arched undercut Z tunnel sits flush from meadow base up beneath the brow roof
    const innerCarve = vd.addCarveArchetypeFromSdf({
        kind: 'tunnel', axis: 'z', radius: 0.44, halfLength: 0.82, center: [0, -0.24, 0.36],
    }, 4);

    // Organic cantilevered sandstone shelf anchoring low & deep at z=-1.0 right over the carved roof
    const browMb = new MeshBuilder();
    browMb.addBlob(0, 0.56, -0.45, 0.86, 0.34, 0.56, sandB, sandA, rng, 0.14);
    browMb.addBlob(-0.36, 0.46, 0.02, 0.52, 0.26, 0.44, sandB, sandA, rng, 0.16);
    browMb.addBlob(0.38, 0.46, 0.02, 0.52, 0.26, 0.44, sandB, sandA, rng, 0.16);
    browMb.addBlob(0.0, 0.50, 0.28, 0.64, 0.24, 0.34, sandB, sandA, rng, 0.16);
    browMb.addBlob(-0.44, 0.24, -0.52, 0.34, 0.24, 0.48, sandB, sandA, rng, 0.17);
    browMb.addBlob(0.44, 0.24, -0.52, 0.34, 0.24, 0.48, sandB, sandA, rng, 0.17);
    browMb.addCone(-0.22, 0.34, 0.22, 0.11, -0.24, 6, sandA, sandB);
    browMb.addCone(0.26, 0.32, 0.14, 0.10, -0.22, 6, sandA, sandB);
    const brow = vd.addArchetypeFromMesh(browMb.toMesh(), 4, { unitBounds: true, fillInterior: true, roughness: 0.93 });

    return {
        inner: { solid: vd.mergeArchetypes(innerShell, innerGlow), carve: innerCarve },
        brow,
    };
}

function buildHeroArch(vd) {
    const sandA = [0.52, 0.32, 0.21], sandB = [0.34, 0.23, 0.18];
    const rng = mulberry32(9901);
    const lowMb = new MeshBuilder();
    // Deep-rooted piers + craggy gorge abutment boulders rising through y = [-1.0, +1.0]
    lowMb.addTaperedRingCyl(-0.68, -1.0, 0.0, -0.60, 1.0, 0.0, 0.36, 0.28, 8, sandB, sandA);
    lowMb.addTaperedRingCyl(0.68, -1.0, 0.0, 0.60, 1.0, 0.0, 0.36, 0.28, 8, sandB, sandA);
    lowMb.addBlob(-0.74, -0.45, 0.10, 0.28, 0.52, 0.36, sandB, sandA, rng, 0.18);
    lowMb.addBlob(0.74, -0.45, -0.08, 0.28, 0.52, 0.36, sandB, sandA, rng, 0.18);

    const upMb = new MeshBuilder();
    // Curved parabolic arch span over upper cell (16..32 m), leaving center sunlit gap open
    const segs = 9;
    let px = -0.60, py = -1.0;
    for (let i = 1; i <= segs; i++) {
        const u = (i / segs) * 2 - 1;
        const nx = u * 0.60;
        const ny = -1.0 + (1 - u * u) * 0.92;
        const colA = mix3(sandB, sandA, 1 - u * u);
        upMb.addTaperedRingCyl(px, py, 0, nx, ny, 0, 0.29, 0.29, 8, colA, colA);
        px = nx; py = ny;
    }

    return {
        lower: vd.addArchetypeFromMesh(lowMb.toMesh(), 4, { unitBounds: true, fillInterior: true, roughness: 0.93 }),
        upper: vd.addArchetypeFromMesh(upMb.toMesh(), 4, { unitBounds: true, fillInterior: true, roughness: 0.93 }),
    };
}

function buildSculptStamps(vd) {
    // 8 m cell stamps (depth = 3, 32^3 voxels) for Region 0 targetDepth = 6
    const rockD = [0.24, 0.19, 0.16], rockL = [0.56, 0.36, 0.24];
    const dirs = [
        { key: '+z', axis: 'z', cx: 0, cz: 0.22, wallZ: -0.78, wallX: 0,   sx: 0.99, sz: 0.22 },
        { key: '-z', axis: 'z', cx: 0, cz: -0.22, wallZ: 0.78, wallX: 0,   sx: 0.99, sz: 0.22 },
        { key: '+x', axis: 'x', cx: 0.22, cz: 0, wallZ: 0,     wallX: -0.78, sx: 0.22, sz: 0.99 },
        { key: '-x', axis: 'x', cx: -0.22, cz: 0, wallZ: 0,    wallX: 0.78,  sx: 0.22, sz: 0.99 },
    ];
    const carve = {};
    for (const d of dirs) {
        const sm = new MeshBuilder();
        sm.addBox(0, -0.78, 0, 0.99, 0.22, 0.99, rockD);
        sm.addBox(0, 0.70, 0, 0.99, 0.29, 0.99, rockL);
        sm.addBox(d.wallX, 0, d.wallZ, d.sx, 0.99, d.sz, rockD);
        if (d.axis === 'z') {
            sm.addBox(-0.76, 0, 0, 0.23, 0.99, 0.99, rockL);
            sm.addBox(0.76, 0, 0, 0.23, 0.99, 0.99, rockL);
        } else {
            sm.addBox(0, 0, -0.76, 0.99, 0.99, 0.23, rockL);
            sm.addBox(0, 0, 0.76, 0.99, 0.99, 0.23, rockL);
        }
        const gm = new MeshBuilder();
        gm.addTaperedRingCyl(-d.wallX * 0.25, -0.58, -d.wallZ * 0.25, 0, 0.14, 0, 0.13, 0.03, 5, [0.18, 0.86, 0.95], [0.85, 1.0, 1.0]);
        const sRef = vd.addArchetypeFromMesh(sm.toMesh(), 3, { unitBounds: true, fillInterior: true, roughness: 0.94 });
        const gRef = vd.addArchetypeFromMesh(gm.toMesh(), 3, { unitBounds: true, fillInterior: true, roughness: 0.25, emissive: 0.90 });
        const cRef = vd.addCarveArchetypeFromSdf({
            kind: 'tunnel', axis: d.axis, radius: 0.54, halfLength: 0.80, center: [d.cx, -0.10, d.cz],
        }, 3);
        carve[d.key] = { solid: vd.mergeArchetypes(sRef, gRef), carve: cRef };
    }

    const archMb = new MeshBuilder();
    archMb.addTaperedRingCyl(-0.62, -0.60, 0, -0.52, 0.42, 0, 0.28, 0.22, 7, rockD, rockL);
    archMb.addTaperedRingCyl(0.62, -0.60, 0, 0.52, 0.42, 0, 0.28, 0.22, 7, rockD, rockL);
    archMb.addTaperedRingCyl(-0.56, 0.34, 0, 0.0, 0.74, 0, 0.23, 0.24, 7, rockL, rockL);
    archMb.addTaperedRingCyl(0.0, 0.74, 0, 0.56, 0.34, 0, 0.24, 0.23, 7, rockL, rockL);
    const arch = voxelizeSlotted(vd, archMb.toMesh(), 3, { fillInterior: true, roughness: 0.93 }, 4);

    return { carve, arch };
}

/** Build and intern every SVDAG archetype cleanly into `vd`. */
export function buildArchetypes(vd) {
    // 1. Animated tree species for Region 1 (4 sway frames, 4 vertical slots, depth = 3)
    const makeTreeSpecies = (species, variant) => {
        const frames = [];
        const offRng = mulberry32(31 + species * 17 + variant * 53);
        const ox = (offRng() * 2 - 1) * 0.22;
        const oz = (offRng() * 2 - 1) * 0.22;
        const copse = variant === 1 && species !== 1;
        const cx2 = copse ? clamp(-ox + (offRng() * 2 - 1) * 0.20, -0.45, 0.45) : 0;
        const cz2 = copse ? clamp(-oz + (offRng() * 2 - 1) * 0.20, -0.45, 0.45) : 0;
        for (let f = 0; f < 4; f++) {
            const ang = (f / 4) * Math.PI * 2;
            const mb = new MeshBuilder();
            addOrganicTree(mb, {
                cx: ox, cz: oz, yBase: 0, scale: 0.90 + variant * 0.16, species,
                swayX: Math.sin(ang) * 0.065, swayZ: Math.cos(ang) * 0.045,
                rng: mulberry32(100 + species * 37 + variant * 13),
            });
            if (copse) {
                addOrganicTree(mb, {
                    cx: cx2, cz: cz2, yBase: -0.04, scale: 0.66, species,
                    swayX: Math.sin(ang + 1.4) * 0.045, swayZ: Math.cos(ang + 1.4) * 0.035,
                    rng: mulberry32(240 + species * 19 + variant * 7),
                });
            }
            frames.push(mb.toMesh());
        }
        return voxelizeSlottedAnim(vd, frames, 3, { fillInterior: true, roughness: 0.88 }, 4);
    };

    const broadleaf = [makeTreeSpecies(0, 0), makeTreeSpecies(0, 1)];
    const autumn = makeTreeSpecies(1, 0);
    const conifer = [makeTreeSpecies(2, 0), makeTreeSpecies(2, 1)];

    // 2. Animated 8-frame spinning wooden windmill (4 vertical slots, depth = 3)
    const windmill = voxelizeSlottedAnim(vd, buildWindmillFrames(), 3, { fillInterior: true, roughness: 0.82 }, 4);

    // 3. Animated 4-frame pulsing emissive crystal cairn (4 vertical slots, depth = 3)
    const beacon = buildCrystalBeaconFrames(vd, 3, 4);

    // 4. Static jagged boulders & stone monolith ruins (4 vertical slots, depth = 3)
    const makeBoulder = (seed) => {
        const mb = new MeshBuilder();
        const rng = mulberry32(seed);
        const cA = [0.46, 0.36, 0.29], cB = [0.64, 0.50, 0.39];
        mb.addBlob(0, 0.06, 0, 0.56, 0.44, 0.50, cA, cB, rng, 0.20);
        mb.addBlob(0.28, -0.08, 0.20, 0.34, 0.30, 0.32, cA, cB, rng, 0.18);
        mb.addBlob(-0.24, -0.10, -0.18, 0.32, 0.28, 0.34, cA, cB, rng, 0.18);
        return voxelizeSlotted(vd, mb.toMesh(), 3, { fillInterior: true, roughness: 0.93 }, 4);
    };
    const boulders = [makeBoulder(501), makeBoulder(502)];

    const ruinMb = new MeshBuilder();
    const stone = [0.54, 0.52, 0.48], stoneTop = [0.68, 0.65, 0.60];
    ruinMb.addTaperedRingCyl(-0.34, -0.45, 0, -0.34, 0.85, 0, 0.16, 0.14, 6, stone, stoneTop);
    ruinMb.addTaperedRingCyl(0.34, -0.45, 0, 0.34, 0.85, 0, 0.16, 0.14, 6, stone, stoneTop);
    ruinMb.addBox(0, 0.90, 0, 0.52, 0.13, 0.17, stoneTop);
    const ruin = voxelizeSlotted(vd, ruinMb.toMesh(), 3, { fillInterior: true, roughness: 0.92 }, 4);

    // 5. Region 2 far horizon mountain clusters & karst spires (8 vertical slots, depth = 3)
    const makeFarCluster = (kind, seed) => {
        const mb = new MeshBuilder();
        const rng = mulberry32(seed);
        if (kind === 'spire') {
            mb.addCone(-0.18, -0.48, -0.10, 0.52, 1.65, 6, [0.42, 0.34, 0.28], [0.68, 0.58, 0.48]);
            mb.addCone(0.26, -0.48, 0.22, 0.40, 1.25, 6, [0.38, 0.32, 0.27], [0.62, 0.53, 0.44]);
        } else {
            const count = 6;
            for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2 + rng() * 0.4;
                const d = (i === 0 ? 0.0 : 0.42 + rng() * 0.28);
                const sp = kind === 'pine' ? 2 : (i % 4 === 0 ? 1 : (i % 2 === 0 ? 2 : 0));
                addOrganicTree(mb, {
                    cx: Math.cos(a) * d, cz: Math.sin(a) * d,
                    yBase: -0.05, scale: 0.62 + rng() * 0.26, species: sp, swayX: 0, swayZ: 0, rng,
                });
            }
        }
        return voxelizeSlotted(vd, mb.toMesh(), 3, { fillInterior: true, roughness: 0.90 }, 8);
    };
    const farLush = makeFarCluster('lush', 701);
    const farPine = makeFarCluster('pine', 702);
    const farSpire = makeFarCluster('spire', 703);

    // 6. Recursive 3D Sierpinski unit (depth = 2, 16^3 voxels -> base for 5^5 fractal pyramid)
    const spMb = new MeshBuilder();
    const sGold = [0.82, 0.65, 0.34], sApex = [0.95, 0.84, 0.50], sTrim = [0.22, 0.72, 0.62];
    spMb.addPyramid(-0.5, -1.0, -0.5, 0.495, 0.99, sGold, sTrim);
    spMb.addPyramid(0.5, -1.0, -0.5, 0.495, 0.99, sGold, sTrim);
    spMb.addPyramid(-0.5, -1.0, 0.5, 0.495, 0.99, sGold, sTrim);
    spMb.addPyramid(0.5, -1.0, 0.5, 0.495, 0.99, sGold, sTrim);
    spMb.addPyramid(0.0, 0.0, 0.0, 0.495, 0.99, sGold, sApex);
    const sierpinskiUnit = vd.addArchetypeFromMesh(spMb.toMesh(), 2, { unitBounds: true, fillInterior: true, roughness: 0.72 });

    // 7. Hero carved landmarks (depth = 4) + interactive sculpt stamps (depth = 3)
    const heroCavern = buildHeroCavern(vd);
    const heroOverhang = buildHeroOverhang(vd);
    const heroArch = buildHeroArch(vd);
    const sculpt = buildSculptStamps(vd);

    return {
        broadleaf, autumn, conifer, windmill, beacon, boulders, ruin,
        farLush, farPine, farSpire,
        sierpinskiUnit,
        heroCavern, heroOverhang, heroArch, sculpt,
    };
}
