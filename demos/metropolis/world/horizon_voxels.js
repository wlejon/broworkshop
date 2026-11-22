// Far-horizon sparse voxel DAG city ring (bro.voxeldag) with terrain-slotted archetypes,
// IGN pixel-matched dither handoff, and altitude-adaptive LOD pull-in.

const SLOTS = 8;
const BAND0_CELL = 32;
const BAND1_CELL = 128;

function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

function hashU32(ix, iz, seed) {
    let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    return (h ^ (h >>> 15)) >>> 0;
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
            this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
    }

    addPyramid(cx, cy, cz, hx, h, hz, rgbaBase, rgbaApex) {
        const corners = [
            [cx - hx, cy, cz - hz],
            [cx + hx, cy, cz - hz],
            [cx + hx, cy, cz + hz],
            [cx - hx, cy, cz + hz],
        ];
        const apex = [cx, cy + h, cz];
        for (let i = 0; i < 4; i++) {
            const p0 = corners[i];
            const p1 = corners[(i + 1) % 4];
            const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
            const vx = apex[0] - p0[0], vy = apex[1] - p0[1], vz = apex[2] - p0[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const dMidX = 0.5 * (p0[0] + p1[0]) - cx;
            const dMidZ = 0.5 * (p0[2] + p1[2]) - cz;
            if (nx * dMidX + nz * dMidZ < 0) { nx = -nx; ny = -ny; nz = -nz; }
            const i0 = this.pushVertex(p0[0], p0[1], p0[2], nx, ny, nz, rgbaBase);
            const i1 = this.pushVertex(p1[0], p1[1], p1[2], nx, ny, nz, rgbaBase);
            const ia = this.pushVertex(apex[0], apex[1], apex[2], nx, ny, nz, rgbaApex);
            this.idx.push(i0, i1, ia);
        }
        const b0 = this.pushVertex(corners[0][0], corners[0][1], corners[0][2], 0, -1, 0, rgbaBase);
        const b1 = this.pushVertex(corners[1][0], corners[1][1], corners[1][2], 0, -1, 0, rgbaBase);
        const b2 = this.pushVertex(corners[2][0], corners[2][1], corners[2][2], 0, -1, 0, rgbaBase);
        const b3 = this.pushVertex(corners[3][0], corners[3][1], corners[3][2], 0, -1, 0, rgbaBase);
        this.idx.push(b0, b2, b1, b0, b3, b2);
    }

    toMesh() {
        let minY = Infinity;
        let maxY = -Infinity;
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
    const r = vd.addArchetypeFromMesh(mesh, depth, { ...opts, unitBounds: true, fillInterior: true });
    return r.ref === 0xFFFFFFFF ? null : r;
}

function voxelizeSlotted(vd, solidMesh, glowMesh, depth, slotCount) {
    const slots = new Array(slotCount);
    for (let s = 0; s < slotCount; s++) {
        const yDatum = -1.0 + ((s + 0.5) / slotCount) * 2.0;
        const makeSlice = (dy) => {
            const sm = voxMeshFixed(vd, shiftMeshY(solidMesh, dy), depth, { roughness: 0.78 });
            const gm = glowMesh ? voxMeshFixed(vd, shiftMeshY(glowMesh, dy), depth, { roughness: 0.25, emissive: 0.35 }) : null;
            if (sm && gm) return vd.mergeArchetypes(sm, gm);
            return sm || gm;
        };
        slots[s] = {
            main: makeSlice(yDatum),
            upper: makeSlice(yDatum - 2.0),
            below: makeSlice(yDatum + 2.0),
        };
    }
    return slots;
}

function buildSkyscraperBaseSlots(vd, depth, slotCount) {
    const slots = new Array(slotCount);
    const stone = [0.42, 0.44, 0.48];
    const glass = [0.22, 0.30, 0.38];
    const winCol = [1.0, 0.86, 0.60];
    for (let s = 0; s < slotCount; s++) {
        const yDatum = -1.0 + ((s + 0.5) / slotCount) * 2.0;
        const yBot = Math.max(-1.0, yDatum - 0.25);
        const yMid = 0.5 * (yBot + 1.0);
        const hy = Math.max(0.08, 0.5 * (1.0 - yBot));
        const sb = new MeshBuilder();
        sb.addBox(0, yMid, 0, 0.74, hy, 0.74, stone);
        sb.addBox(0, yMid + hy * 0.15, 0, 0.68, hy * 0.75, 0.68, glass);
        const gb = new MeshBuilder();
        for (let wy = yBot + 0.28; wy < 0.92; wy += 0.30) {
            gb.addBox(0, wy, 0, 0.75, 0.06, 0.64, winCol);
            gb.addBox(0, wy, 0, 0.64, 0.06, 0.75, winCol);
        }
        const sm = voxMeshFixed(vd, sb.toMesh(), depth, { roughness: 0.55 });
        const gm = gb.pos.length > 0 ? voxMeshFixed(vd, gb.toMesh(), depth, { roughness: 0.22, emissive: 0.36 }) : null;
        const belowMb = new MeshBuilder();
        belowMb.addBox(0, 0.72, 0, 0.74, 0.28, 0.74, stone);
        const below = s <= 1 ? voxMeshFixed(vd, belowMb.toMesh(), depth, { roughness: 0.80 }) : null;
        slots[s] = {
            main: sm && gm ? vd.mergeArchetypes(sm, gm) : sm,
            upper: null,
            below,
        };
    }
    return slots;
}

function buildSkyscraperTier(vd, variant) {
    const sb = new MeshBuilder();
    const gb = new MeshBuilder();
    const frame = variant === 'A' ? [0.46, 0.49, 0.54] : [0.36, 0.40, 0.46];
    const winCol = variant === 'A' ? [1.0, 0.88, 0.62] : [0.82, 0.92, 1.0];
    if (variant === 'crown') {
        sb.addBox(0, -0.52, 0, 0.60, 0.48, 0.60, frame);
        sb.addBox(0, 0.10, 0, 0.44, 0.28, 0.44, frame);
        sb.addPyramid(0, 0.36, 0, 0.32, 0.56, 0.32, frame, [0.70, 0.72, 0.76]);
        gb.addBox(0, -0.50, 0, 0.62, 0.16, 0.52, winCol);
        gb.addBox(0, -0.50, 0, 0.52, 0.16, 0.62, winCol);
        gb.addBox(0, 0.88, 0, 0.06, 0.10, 0.06, [1.0, 0.24, 0.18]);
    } else {
        const hx = variant === 'A' ? 0.68 : 0.62;
        sb.addBox(0, 0.0, 0, hx, 1.0, hx, frame);
        for (let wy = -0.78; wy <= 0.82; wy += 0.32) {
            gb.addBox(0, wy, 0, hx + 0.02, 0.07, hx * 0.84, winCol);
            gb.addBox(0, wy, 0, hx * 0.84, 0.07, hx + 0.02, winCol);
        }
    }
    const sm = voxMeshFixed(vd, sb.toMesh(), 3, { roughness: 0.48 });
    const gm = voxMeshFixed(vd, gb.toMesh(), 3, { roughness: 0.22, emissive: 0.38 });
    return sm && gm ? vd.mergeArchetypes(sm, gm) : sm;
}

function buildArchetypes(vd) {
    const skyBase = buildSkyscraperBaseSlots(vd, 3, SLOTS);
    const skyMidA = buildSkyscraperTier(vd, 'A');
    const skyMidB = buildSkyscraperTier(vd, 'B');
    const skyCrown = buildSkyscraperTier(vd, 'crown');

    // Commercial mid-rise blocks (local y=0 at ground contact, foundation skirt to -0.25)
    const makeComm = (wallCol, roofCol, hNorm) => {
        const sb = new MeshBuilder();
        sb.addBox(0, hNorm * 0.5 - 0.10, 0, 0.72, hNorm * 0.5 + 0.10, 0.68, wallCol);
        sb.addBox(0, hNorm + 0.04, 0, 0.66, 0.06, 0.62, roofCol);
        const gb = new MeshBuilder();
        const win = [1.0, 0.85, 0.58];
        for (let wy = 0.18; wy < hNorm - 0.08; wy += 0.34) {
            gb.addBox(0, wy, 0, 0.74, 0.07, 0.56, win);
            gb.addBox(0, wy, 0, 0.58, 0.07, 0.70, win);
        }
        return voxelizeSlotted(vd, sb.toMesh(), gb.toMesh(), 3, SLOTS);
    };
    const commA = makeComm([0.52, 0.46, 0.40], [0.32, 0.33, 0.35], 1.15);
    const commB = makeComm([0.40, 0.44, 0.48], [0.28, 0.30, 0.32], 0.85);

    // Suburban home + yard tree clusters
    const makeSuburb = (wallCol, roofCol, ox, oz) => {
        const sb = new MeshBuilder();
        sb.addBox(ox, 0.12, oz, 0.36, 0.26, 0.32, wallCol);
        sb.addPyramid(ox, 0.36, oz, 0.38, 0.24, 0.34, roofCol, roofCol);
        sb.addBox(-ox * 0.8, 0.10, -oz * 0.8, 0.28, 0.22, 0.26, wallCol);
        sb.addPyramid(-ox * 0.8, 0.30, -oz * 0.8, 0.30, 0.20, 0.28, roofCol, roofCol);
        // Shade tree
        sb.addBox(-0.42, 0.16, 0.36, 0.07, 0.24, 0.07, [0.30, 0.21, 0.14]);
        sb.addBox(-0.42, 0.46, 0.36, 0.22, 0.22, 0.22, [0.16, 0.36, 0.14]);
        const gb = new MeshBuilder();
        gb.addBox(ox, 0.18, oz, 0.37, 0.06, 0.16, [1.0, 0.84, 0.52]);
        return voxelizeSlotted(vd, sb.toMesh(), gb.toMesh(), 3, SLOTS);
    };
    const suburbA = makeSuburb([0.74, 0.68, 0.60], [0.46, 0.24, 0.18], 0.22, 0.18);
    const suburbB = makeSuburb([0.64, 0.68, 0.72], [0.28, 0.30, 0.34], -0.20, 0.22);

    // Park trees
    const parkMb = new MeshBuilder();
    const offsets = [[-0.45, -0.35, 0.58], [0.38, -0.40, 0.50], [-0.15, 0.42, 0.66], [0.48, 0.32, 0.52]];
    for (const [tx, tz, th] of offsets) {
        parkMb.addBox(tx, th * 0.30 - 0.15, tz, 0.07, th * 0.35 + 0.15, 0.07, [0.29, 0.20, 0.13]);
        parkMb.addBox(tx, th * 0.72, tz, 0.25, th * 0.34, 0.25, [0.14, 0.34, 0.13]);
    }
    const parkTrees = voxelizeSlotted(vd, parkMb.toMesh(), null, 3, SLOTS);

    // Coarse 128 m city-block archetypes for Band 1
    const makeBlock = (kind) => {
        const sb = new MeshBuilder();
        const gb = new MeshBuilder();
        if (kind === 'downtown') {
            sb.addBox(-0.34, 0.82, -0.32, 0.26, 1.02, 0.26, [0.40, 0.44, 0.50]);
            sb.addBox(0.32, 1.05, 0.28, 0.28, 1.25, 0.28, [0.34, 0.38, 0.44]);
            sb.addBox(-0.28, 0.55, 0.34, 0.24, 0.75, 0.24, [0.46, 0.48, 0.52]);
            sb.addBox(0.34, 0.68, -0.30, 0.24, 0.88, 0.24, [0.38, 0.42, 0.46]);
            gb.addBox(0.32, 1.10, 0.28, 0.29, 0.65, 0.20, [1.0, 0.88, 0.62]);
            gb.addBox(-0.34, 0.88, -0.32, 0.27, 0.55, 0.18, [0.84, 0.92, 1.0]);
        } else if (kind === 'commercial') {
            sb.addBox(-0.34, 0.20, -0.30, 0.24, 0.32, 0.24, [0.50, 0.45, 0.40]);
            sb.addBox(0.34, 0.24, 0.30, 0.24, 0.36, 0.24, [0.42, 0.45, 0.49]);
            sb.addBox(-0.30, 0.16, 0.34, 0.22, 0.28, 0.22, [0.48, 0.44, 0.40]);
            gb.addBox(0.34, 0.26, 0.30, 0.25, 0.14, 0.18, [1.0, 0.86, 0.58]);
        } else {
            sb.addBox(-0.36, 0.04, -0.36, 0.18, 0.14, 0.18, [0.68, 0.62, 0.54]);
            sb.addBox(0.34, 0.04, 0.32, 0.18, 0.14, 0.18, [0.60, 0.64, 0.68]);
            sb.addBox(0.0, 0.06, -0.10, 0.22, 0.16, 0.22, [0.15, 0.35, 0.14]);
        }
        return voxelizeSlotted(vd, sb.toMesh(), gb.pos.length > 0 ? gb.toMesh() : null, 3, SLOTS);
    };
    const blockDowntown = makeBlock('downtown');
    const blockCommercial = makeBlock('commercial');
    const blockSuburb = makeBlock('suburb');

    return {
        skyBase, skyMidA, skyMidB, skyCrown,
        commA, commB, suburbA, suburbB, parkTrees,
        blockDowntown, blockCommercial, blockSuburb,
    };
}

export function createHorizonVoxels(scene, layout) {
    const vd = bro.voxeldag.createWorld(scene);
    vd.setLodScale(1.0);
    vd.setMaxRaySteps(14);

    const arch = buildArchetypes(vd);

    // Band 0: 3x3 regions covering [-6144, 6144]^2 (4096 m each, 32 m cells @ targetDepth 7, 1 m voxels)
    const band0Regions = [];
    const band0Batch = new Uint32Array(128 * 128 * 6 * 5);

    const pushBatch = (batch, count, ix, iy, iz, refObj, seen) => {
        if (!refObj || ix < 0 || ix >= 128 || iz < 0 || iz >= 128 || iy < 0 || iy >= 127) return count;
        const key = (iy << 14) | (iz << 7) | ix;
        if (seen.has(key)) return count;
        seen.add(key);
        const o = count * 5;
        batch[o + 0] = ix;
        batch[o + 1] = iy;
        batch[o + 2] = iz;
        batch[o + 3] = refObj.ref;
        batch[o + 4] = refObj.isLeaf ? 1 : 0;
        return count + 1;
    };

    const pushSlotted = (batch, count, ix, iy, iz, slice, seen) => {
        if (!slice) return count;
        count = pushBatch(batch, count, ix, iy, iz, slice.main, seen);
        count = pushBatch(batch, count, ix, iy + 1, iz, slice.upper, seen);
        count = pushBatch(batch, count, ix, iy - 1, iz, slice.below, seen);
        return count;
    };

    for (let rz = 0; rz < 3; rz++) {
        for (let rx = 0; rx < 3; rx++) {
            const cx = -4096 + rx * 4096;
            const cz = -4096 + rz * 4096;
            const id = vd.addRegion({
                center: [cx, 2016, cz],
                voxelSize: 1.0,
                maxDepth: 10,
                minDist: 420,
                minFadeEnd: 567,
                fadeStart: 1800,
                maxDist: 2400,
                enabled: true,
                castShadow: false,
            });
            const x0 = cx - 2048;
            const z0 = cz - 2048;
            const bxStart = -48 + rx * 32;
            const bzStart = -48 + rz * 32;
            const seen = new Set();
            let used = 0;

            for (let lbz = 0; lbz < 32; lbz++) {
                const bz = bzStart + lbz;
                for (let lbx = 0; lbx < 32; lbx++) {
                    const bx = bxStart + lbx;
                    const dist = layout.sampleBlockDistrict(bx, bz);
                    const parcels = layout.getParcelsInBlock(bx, bz);

                    if (dist.zone === 'park') {
                        for (let oz = 0; oz < 2; oz++) {
                            for (let ox = 0; ox < 2; ox++) {
                                const h = hashU32(bx * 4 + ox, bz * 4 + oz, 19);
                                if ((h & 3) === 0) continue;
                                const ix = lbx * 4 + 1 + ox;
                                const iz = lbz * 4 + 1 + oz;
                                const uW = x0 + (ix + 0.5) * BAND0_CELL;
                                const vW = z0 + (iz + 0.5) * BAND0_CELL;
                                if (layout.riverCorridorInfo(uW, vW).dist < layout.RIVER_HALF_W + 38.0) continue;
                                const [wx, wz] = layout.gridToWorld(uW, vW);
                                const gy = layout.sampleGroundHeight(wx, wz);
                                const fy = (gy + 32) / BAND0_CELL;
                                const iy = clamp(Math.floor(fy), 1, 124);
                                const slot = clamp(Math.floor((fy - iy) * SLOTS), 0, SLOTS - 1);
                                used = pushSlotted(band0Batch, used, ix, iy, iz, arch.parkTrees[slot], seen);
                            }
                        }
                        continue;
                    }

                    for (let pi = 0; pi < parcels.length; pi++) {
                        const p = parcels[pi];
                        if (p.kind === 'park') continue;
                        const ix = clamp(Math.floor((p.cx - x0) / BAND0_CELL), 0, 127);
                        const iz = clamp(Math.floor((p.cz - z0) / BAND0_CELL), 0, 127);
                        const gy = layout.sampleGroundHeight(p.cx, p.cz);
                        const fy = (gy + 32) / BAND0_CELL;
                        const iy = clamp(Math.floor(fy), 1, 120);
                        const slot = clamp(Math.floor((fy - iy) * SLOTS), 0, SLOTS - 1);

                        if (p.kind === 'skyscraper') {
                            used = pushSlotted(band0Batch, used, ix, iy, iz, arch.skyBase[slot], seen);
                            const totalH = p.floors * p.floorHeight;
                            const midCells = clamp(Math.round((totalH - 28) / BAND0_CELL), 1, 4);
                            for (let m = 1; m <= midCells; m++) {
                                const midRef = ((p.seed + m) & 1) === 0 ? arch.skyMidA : arch.skyMidB;
                                used = pushBatch(band0Batch, used, ix, iy + m, iz, midRef, seen);
                            }
                            used = pushBatch(band0Batch, used, ix, iy + midCells + 1, iz, arch.skyCrown, seen);
                        } else if (p.kind === 'business') {
                            const slice = (p.seed & 1) === 0 ? arch.commA[slot] : arch.commB[slot];
                            used = pushSlotted(band0Batch, used, ix, iy, iz, slice, seen);
                        } else {
                            const slice = (p.seed & 1) === 0 ? arch.suburbA[slot] : arch.suburbB[slot];
                            used = pushSlotted(band0Batch, used, ix, iy, iz, slice, seen);
                        }
                    }
                }
            }

            if (used > 0) {
                vd.placeBatchTyped(id, band0Batch, 7, used);
            }
            band0Regions.push({
                id,
                cx,
                cz,
                enabled: true,
                minDist: 420,
                minFadeEnd: 567,
                fadeStart: 1800,
                maxDist: 2400,
            });
        }
    }

    // Band 1: Single global region covering all 150.99 km^2 horizon (128 m cells @ targetDepth 7, 4 m voxels)
    const band1Id = vd.addRegion({
        center: [0, 8160, 0],
        voxelSize: 4.0,
        maxDepth: 10,
        minDist: 1800,
        minFadeEnd: 2400,
        fadeStart: 9500,
        maxDist: 11500,
        enabled: true,
        castShadow: false,
    });
    const band1Batch = new Uint32Array(96 * 96 * 3 * 5);
    const seen1 = new Set();
    let used1 = 0;
    for (let bz = -48; bz < 48; bz++) {
        for (let bx = -48; bx < 48; bx++) {
            const dist = layout.sampleBlockDistrict(bx, bz);
            if (dist.zone === 'park') continue;
            const bu = (bx + 0.5) * BAND1_CELL;
            const bv = (bz + 0.5) * BAND1_CELL;
            if (layout.riverCorridorInfo(bu, bv).dist < layout.RIVER_HALF_W + 24.0) continue;
            const [wx, wz] = layout.gridToWorld(bu, bv);
            const ix = clamp(Math.floor(wx / BAND1_CELL) + 64, 0, 127);
            const iz = clamp(Math.floor(wz / BAND1_CELL) + 64, 0, 127);
            const gy = layout.sampleGroundHeight(wx, wz);
            const fy = (gy + 32) / BAND1_CELL;
            const iy = clamp(Math.floor(fy), 0, 124);
            const slot = clamp(Math.floor((fy - iy) * SLOTS), 0, SLOTS - 1);
            const sliceSet = dist.zone === 'downtown'
                ? arch.blockDowntown
                : (dist.zone === 'commercial' ? arch.blockCommercial : arch.blockSuburb);
            used1 = pushSlotted(band1Batch, used1, ix, iy, iz, sliceSet[slot], seen1);
        }
    }
    if (used1 > 0) {
        vd.placeBatchTyped(band1Id, band1Batch, 7, used1);
    }

    let lastBand1Min = 1800;
    let lastBand1FadeEnd = 2400;
    const farMaxDist = 11500;
    const farFadeStart = 9500;

    function update(camPos, altitude = 0) {
        const alt = Math.max(0, altitude);
        const t = clamp((alt - 25) / 375, 0, 1);
        const meshFadeStart = Math.round(420 + (160 - 420) * t);
        const meshFadeEnd = Math.round(meshFadeStart * 1.35);
        const voxelMinDist = meshFadeStart;
        const voxelFadeStart = Math.round(1800 + (900 - 1800) * t);
        const voxelMaxDist = Math.round(2400 + (1250 - 2400) * t);

        for (let i = 0; i < band0Regions.length; i++) {
            const r = band0Regions[i];
            const dx = Math.max(0, Math.abs(camPos[0] - r.cx) - 2048);
            const dz = Math.max(0, Math.abs(camPos[2] - r.cz) - 2048);
            const distToBox = Math.hypot(dx, dz);
            const wantEnabled = distToBox <= voxelMaxDist + 200;

            const changed = wantEnabled !== r.enabled
                || Math.abs(voxelMinDist - r.minDist) >= 2
                || Math.abs(voxelFadeStart - r.fadeStart) >= 2
                || Math.abs(voxelMaxDist - r.maxDist) >= 2;

            if (changed) {
                r.enabled = wantEnabled;
                r.minDist = voxelMinDist;
                r.minFadeEnd = meshFadeEnd;
                r.fadeStart = voxelFadeStart;
                r.maxDist = voxelMaxDist;
                vd.updateRegion(r.id, {
                    enabled: wantEnabled,
                    minDist: voxelMinDist,
                    minFadeEnd: meshFadeEnd,
                    fadeStart: voxelFadeStart,
                    maxDist: voxelMaxDist,
                });
            }
        }

        if (Math.abs(voxelFadeStart - lastBand1Min) >= 2 || Math.abs(voxelMaxDist - lastBand1FadeEnd) >= 2) {
            lastBand1Min = voxelFadeStart;
            lastBand1FadeEnd = voxelMaxDist;
            vd.updateRegion(band1Id, {
                minDist: voxelFadeStart,
                minFadeEnd: voxelMaxDist,
                fadeStart: farFadeStart,
                maxDist: farMaxDist,
            });
        }

        return {
            meshFadeStart,
            meshFadeEnd,
            voxelMinDist,
            voxelFadeStart,
            voxelMaxDist: farMaxDist,
        };
    }

    function stats() {
        return vd.stats();
    }

    function dispose() {
        for (const r of band0Regions) {
            try { vd.removeRegion(r.id); } catch (_) {}
        }
        try { vd.removeRegion(band1Id); } catch (_) {}
    }

    return {
        world: vd,
        whenReady: () => Promise.resolve(),
        update,
        stats,
        dispose,
    };
}
