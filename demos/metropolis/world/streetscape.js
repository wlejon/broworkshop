// Pre-warmed streetscape: tapered cantilevered streetlamps, traffic signals,
// organic multi-branch trees & autumn/emerald canopies, benches, river water & bridges.

const LAMP_D = 230;
const TREE_D = 255;

function addTriOut(pos, nrm, uvs, idx, p0, p1, p2, ref, matId, param = 0) {
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
    const b = pos.length / 3;
    for (const p of pts) {
        pos.push(p[0], p[1], p[2]);
        nrm.push(nx, ny, nz);
        uvs.push(matId, param);
    }
    idx.push(b, b + 1, b + 2);
}

function addQuadOut(pos, nrm, uvs, idx, p0, p1, p2, p3, ref, matId, param = 0) {
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
    const b = pos.length / 3;
    for (const p of pts) {
        pos.push(p[0], p[1], p[2]);
        nrm.push(nx, ny, nz);
        uvs.push(matId, param);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
}

function addBox(pos, nrm, uvs, idx, x0, y0, z0, x1, y1, z1, matId, param = 0) {
    const ref = [0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.5 * (z0 + z1)];
    addQuadOut(pos, nrm, uvs, idx, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], ref, matId, param);
    addQuadOut(pos, nrm, uvs, idx, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], ref, matId, param);
    addQuadOut(pos, nrm, uvs, idx, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], ref, matId, param);
    addQuadOut(pos, nrm, uvs, idx, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], ref, matId, param);
    addQuadOut(pos, nrm, uvs, idx, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], ref, matId, param);
    addQuadOut(pos, nrm, uvs, idx, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], ref, matId, param);
}

function addTaperedCyl(pos, nrm, uvs, idx, p0, r0, p1, r1, sides, matId, param = 0) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const ax = dx / len, ay = dy / len, az = dz / len;
    const up = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let tx = up[1] * az - up[2] * ay;
    let ty = up[2] * ax - up[0] * az;
    let tz = up[0] * ay - up[1] * ax;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ay * tz - az * ty, by = az * tx - ax * tz, bz = ax * ty - ay * tx;

    const ring0 = [];
    const ring1 = [];
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
        addQuadOut(pos, nrm, uvs, idx, ring0[i], ring0[j], ring1[j], ring1[i], mid, matId, param);
        addTriOut(pos, nrm, uvs, idx, p0, ring0[j], ring0[i], mid, matId, param);
        addTriOut(pos, nrm, uvs, idx, p1, ring1[i], ring1[j], mid, matId, param);
    }
}

function addIcosphereLobe(pos, nrm, uvs, idx, cx, cy, cz, rx, ry, rz, matId, param = 0) {
    const t = (1 + Math.sqrt(5)) * 0.5;
    const rawV = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const verts = rawV.map((v) => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [cx + (v[0] / l) * rx, cy + (v[1] / l) * ry, cz + (v[2] / l) * rz];
    });
    const tris = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const ref = [cx, cy, cz];
    for (const [a, b, c] of tris) {
        addTriOut(pos, nrm, uvs, idx, verts[a], verts[b], verts[c], ref, matId, param);
    }
}

function createStreetLampMesh() {
    const pos = [], nrm = [], uvs = [], idx = [];
    // Deep-anchored base plinth (y=-1.10) + tapered 8-sided mast + curved mast arm + luminaire hood & lens
    addTaperedCyl(pos, nrm, uvs, idx, [0, -1.10, 0], 0.16, [0, 0.55, 0], 0.12, 8, 1, 0);
    addTaperedCyl(pos, nrm, uvs, idx, [0, 0.50, 0], 0.095, [0, 6.05, 0], 0.055, 8, 1, 0);
    addTaperedCyl(pos, nrm, uvs, idx, [-0.04, 5.90, 0], 0.05, [0.55, 6.18, 0], 0.045, 6, 1, 0);
    addTaperedCyl(pos, nrm, uvs, idx, [0.50, 6.16, 0], 0.045, [1.18, 6.20, 0], 0.04, 6, 1, 0);
    addBox(pos, nrm, uvs, idx, 0.96, 6.12, -0.16, 1.48, 6.24, 0.16, 1, 0);
    addBox(pos, nrm, uvs, idx, 1.02, 6.05, -0.11, 1.44, 6.14, 0.11, 5, 0.65);
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uvs), indices: new Uint32Array(idx) });
}

function createTreeMesh() {
    const pos = [], nrm = [], uvs = [], idx = [];
    // Combined single-island grounded tree: deep-rooted bark trunk/limbs (mat=10) + multi-lobe foliage crown (mat=9)
    addTaperedCyl(pos, nrm, uvs, idx, [0, -1.20, 0], 0.34, [0, 2.50, 0], 0.15, 7, 10, 0.0);
    addTaperedCyl(pos, nrm, uvs, idx, [0, 1.75, 0], 0.13, [0.82, 3.35, 0.35], 0.06, 6, 10, 0.0);
    addTaperedCyl(pos, nrm, uvs, idx, [0, 1.85, 0], 0.13, [-0.72, 3.28, -0.46], 0.06, 6, 10, 0.0);
    addTaperedCyl(pos, nrm, uvs, idx, [0, 2.05, 0], 0.12, [-0.15, 3.65, 0.68], 0.06, 6, 10, 0.0);
    addIcosphereLobe(pos, nrm, uvs, idx, 0.00, 3.85, 0.00, 1.42, 1.25, 1.42, 9, 0.25);
    addIcosphereLobe(pos, nrm, uvs, idx, 0.85, 3.35, 0.38, 1.05, 0.92, 1.05, 9, 0.25);
    addIcosphereLobe(pos, nrm, uvs, idx, -0.78, 3.28, -0.45, 1.08, 0.94, 1.08, 9, 0.25);
    addIcosphereLobe(pos, nrm, uvs, idx, -0.15, 3.55, 0.78, 1.02, 0.90, 1.02, 9, 0.25);
    addIcosphereLobe(pos, nrm, uvs, idx, 0.15, 4.45, -0.20, 1.04, 0.88, 1.04, 9, 0.25);
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uvs), indices: new Uint32Array(idx) });
}

function createBenchMesh() {
    const pos = [], nrm = [], uvs = [], idx = [];
    // Cast iron side legs + wooden seat & backrest slats (1.6 m bench)
    addBox(pos, nrm, uvs, idx, -0.74, -0.60, -0.22, -0.64, 0.44, 0.22, 1, 0);
    addBox(pos, nrm, uvs, idx, 0.64, -0.60, -0.22, 0.74, 0.44, 0.22, 1, 0);
    addBox(pos, nrm, uvs, idx, -0.74, 0.42, -0.22, -0.64, 0.84, -0.12, 1, 0);
    addBox(pos, nrm, uvs, idx, 0.64, 0.42, -0.22, 0.74, 0.84, -0.12, 1, 0);
    addBox(pos, nrm, uvs, idx, -0.80, 0.41, -0.18, 0.80, 0.47, 0.24, 2, 0);
    addBox(pos, nrm, uvs, idx, -0.80, 0.56, -0.22, 0.80, 0.82, -0.13, 2, 0);
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uvs), indices: new Uint32Array(idx) });
}

function createRiverWaterMesh() {
    const pos = [], nrm = [], uvs = [], idx = [];
    // Planar closed water slab (1 m x 0.22 m x 1 m centered in XZ at top y=0) -> curvedEdges = 0
    addBox(pos, nrm, uvs, idx, -0.5, -0.22, -0.5, 0.5, 0.0, 0.5, 3, 0);
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uvs), indices: new Uint32Array(idx) });
}

function createBridgeRailMesh() {
    const pos = [], nrm = [], uvs = [], idx = [];
    // 1 m unit stone parapet & steel top rail anchored below deck
    addBox(pos, nrm, uvs, idx, -0.5, -0.85, -0.24, 0.5, 0.72, 0.24, 2, 1);
    addBox(pos, nrm, uvs, idx, -0.5, 0.70, -0.18, 0.5, 1.05, 0.18, 1, 0);
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uvs), indices: new Uint32Array(idx) });
}

const FOLIAGE_PALETTES = [
    [0.14, 0.36, 0.12, 1],
    [0.18, 0.42, 0.14, 1],
    [0.24, 0.44, 0.15, 1],
    [0.12, 0.30, 0.11, 1],
    [0.44, 0.34, 0.12, 1], // Warm autumn gold accent tree
    [0.52, 0.26, 0.11, 1], // Warm autumn russet accent tree
];

export function createStreetscape(scene, pools, layout) {
    const lampBatch = pools.registerBatch('street_lamps', createStreetLampMesh, {
        capacity: 1024, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 10, fadeOutDist: LAMP_D,
    });
    const treeBatch = pools.registerBatch('trees', createTreeMesh, {
        capacity: 1536, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 10, fadeOutDist: TREE_D,
    });
    const benchBatch = pools.registerBatch('street_benches', createBenchMesh, {
        capacity: 512, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 10, fadeOutDist: 140,
    });
    const railBatch = pools.registerBatch('bridge_rails', createBridgeRailMesh, {
        capacity: 256, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 10, fadeOutDist: 280,
    });
    const waterBatch = pools.registerBatch('river_water', createRiverWaterMesh, {
        capacity: 256,
        color: [0.14, 0.34, 0.42, 0.82],
        glowScale: 0.45,
        castsShadow: false,
        receivesShadow: true,
        doubleSided: false,
        drawOrder: 13,
        fadeOutDist: 0,
    });

    function pushTree(wx, wy, wz, scale, yaw, color, camPos) {
        treeBatch.pushRel(wx, wy, wz, camPos, 0, yaw, 0, scale, scale, scale, color);
    }

    function update(camPos, altitude) {
        const [guCam, gvCam] = layout.worldToGrid(camPos[0], camPos[2]);

        // River water & bridge parapets stay visible up to 1600 m altitude
        if (Math.abs(guCam - 768.0) <= 1400.0 + altitude * 1.4) {
            // Single seamless multi-sample ribbon per visible stretch (no double-alpha strip overlaps)
            const vStep = 40.0;
            const span = Math.min(1800, 480 + altitude * 1.6);
            const vStart = Math.floor((gvCam - span) / vStep) * vStep;
            const vEnd = gvCam + span;
            for (let v = vStart; v <= vEnd; v += vStep) {
                const ru0 = layout.riverCenterU(v);
                const ru1 = layout.riverCenterU(v + vStep);
                const [w0x, w0z] = layout.gridToWorld(ru0, v);
                const [w1x, w1z] = layout.gridToWorld(ru1, v + vStep);
                const wx = 0.5 * (w0x + w1x);
                const wz = 0.5 * (w0z + w1z);
                const segLen = Math.hypot(w1x - w0x, w1z - w0z) + 0.04;
                const rot = Math.atan2(w1x - w0x, w1z - w0z);
                waterBatch.pushRel(wx, layout.WATER_LEVEL_Y, wz, camPos, 0, rot, 0, 108.0, 1.0, segLen, [0.14, 0.34, 0.44, 0.85]);
            }

            // Bridge rails along E-W avenues (v = rz * 512) crossing the river
            const aveStart = Math.floor((gvCam - 320) / 512) * 512;
            const aveEnd = gvCam + 320;
            for (let av = aveStart; av <= aveEnd; av += 512) {
                if (Math.abs(av - gvCam) > 320) continue;
                const rc = layout.riverCenterU(av);
                for (let seg = -42; seg <= 42; seg += 24) {
                    const uSeg = rc + seg;
                    const [tuX, tuZ] = layout.gridTangentU(uSeg, av);
                    const bRot = Math.atan2(-tuZ, tuX);
                    for (const side of [-13.6, 13.6]) {
                        const [wx, wz] = layout.gridToWorld(uSeg, av + side);
                        const gy = layout.roadTerrainHeight(wx, wz);
                        railBatch.pushRel(wx, gy, wz, camPos, 0, bRot, 0, 24.5, 1.0, 1.0, [0.52, 0.52, 0.50, 1]);
                    }
                }
            }
        }

        if (altitude > 260) return;

        const [bxCenter, bzCenter] = layout.worldToBlock(camPos[0], camPos[2]);
        for (let bz = bzCenter - 2; bz <= bzCenter + 2; bz++) {
            for (let bx = bxCenter - 2; bx <= bxCenter + 2; bx++) {
                if (bx < layout.BLOCK_MIN || bx > layout.BLOCK_MAX || bz < layout.BLOCK_MIN || bz > layout.BLOCK_MAX) continue;
                const dist = layout.sampleBlockDistrict(bx, bz);
                const u0 = bx * layout.BLOCK_SIZE;
                const v0 = bz * layout.BLOCK_SIZE;

                // Streetlamps along west & north sidewalk curbs (facing into road)
                const roadX = layout.roadKindForLine(bx, bz);
                const lampUOff = layout.ROAD_WIDTH[roadX] * 0.5 + 1.0;
                for (let s = 0; s < 3; s++) {
                    const lv = v0 + 22 + s * 42;
                    const lu = u0 + lampUOff;
                    if (layout.riverCorridorInfo(lu, lv).roadSuppress > 0.2) continue;
                    const [wx, wz] = layout.gridToWorld(lu, lv);
                    const gy = layout.roadTerrainHeight(wx, wz);
                    if (Math.hypot(wx - camPos[0], gy - camPos[1], wz - camPos[2]) <= LAMP_D) {
                        const [tx, tz] = layout.gridTangentV(lu, lv);
                        const rotY = Math.PI + Math.atan2(tx, tz);
                        lampBatch.pushRel(wx, gy, wz, camPos, 0, rotY, 0, 1, 1, 1, [1.0, 0.86, 0.64, 1]);
                    }
                }

                // Boulevard trees along downtown/commercial avenues, suburban lawns, & parks
                const isAveW = (bx & 3) === 0;
                const treeSpacing = (dist.zone === 'suburb' || isAveW) ? 4 : 6;
                for (let s = 0; s < 3; s++) {
                    const h = layout.hash2f(bx * 7 + s, bz * 11, 809);
                    if (dist.zone === 'downtown' && !isAveW && h > 0.45) continue;
                    if (dist.zone === 'suburb' && h > 0.72) continue;
                    const tv = v0 + 28 + s * 36;
                    const tu = u0 + lampUOff + 1.1;
                    if (layout.riverCorridorInfo(tu, tv).inWater) continue;
                    const [wx, wz] = layout.gridToWorld(tu, tv);
                    const gy = layout.sampleGroundHeight(wx, wz);
                    if (Math.hypot(wx - camPos[0], gy - camPos[1], wz - camPos[2]) <= TREE_D) {
                        const sc = 0.82 + 0.46 * h;
                        const col = FOLIAGE_PALETTES[Math.floor(h * 19 + s) % (treeSpacing === 4 ? FOLIAGE_PALETTES.length : 4)];
                        pushTree(wx, gy, wz, sc, h * 6.28, col, camPos);
                    }
                }

                // Park interior tree groves, waterfront promenades & benches
                const parcels = layout.getParcelsInBlock(bx, bz);
                for (let pi = 0; pi < parcels.length; pi++) {
                    const p = parcels[pi];
                    if (p.kind === 'park') {
                        const dCam = Math.hypot(p.cx - camPos[0], p.cz - camPos[2]);
                        if (dCam > TREE_D + 40) continue;
                        const treeN = p.width > 45 ? 10 : 3;
                        for (let ti = 0; ti < treeN; ti++) {
                            const hx = layout.hash2f(bx * 13 + ti, bz * 17 + pi, 907);
                            const hz = layout.hash2f(bx * 19 + ti, bz * 23 + pi, 919);
                            const lx = (hx - 0.5) * (p.width * 0.78);
                            const lz = (hz - 0.5) * (p.depth * 0.78);
                            const tu = p.pu + lx;
                            const tv = p.pv + lz;
                            if (layout.riverCorridorInfo(tu, tv).dist < layout.RIVER_HALF_W + 18.0) continue;
                            const [wx, wz] = layout.gridToWorld(tu, tv);
                            const gy = layout.sampleGroundHeight(wx, wz);
                            const sc = 0.90 + 0.55 * hx;
                            const col = FOLIAGE_PALETTES[Math.floor((hx + hz) * 17) % FOLIAGE_PALETTES.length];
                            pushTree(wx, gy, wz, sc, hz * 6.28, col, camPos);
                        }
                        if (dCam <= 140) {
                            const gy = layout.sampleGroundHeight(p.cx, p.cz);
                            if (layout.riverCorridorInfo(p.pu, p.pv).dist >= layout.RIVER_HALF_W + 14.0) {
                                benchBatch.pushRel(p.cx, gy, p.cz, camPos, 0, p.rot, 0, 1, 1, 1, [0.46, 0.31, 0.19, 1]);
                            }
                        }
                    } else if (p.kind === 'home') {
                        // Suburban front-yard / backyard shade tree clear of building footprint
                        const hy = layout.hash2f(bx * 11 + pi, bz * 13 + pi, 941);
                        if (hy < 0.75) {
                            const side = hy < 0.38 ? -1 : 1;
                            const lx = side * (p.padHalfW + 1.8);
                            const lz = (hy - 0.4) * 5.0;
                            const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
                            const wx = p.cx + cr * lx + sr * lz;
                            const wz = p.cz - sr * lx + cr * lz;
                            if (Math.hypot(wx - camPos[0], wz - camPos[2]) <= TREE_D) {
                                const gy = layout.sampleGroundHeight(wx, wz);
                                const col = FOLIAGE_PALETTES[Math.floor(hy * 23) % FOLIAGE_PALETTES.length];
                                pushTree(wx, gy, wz, 0.78 + 0.35 * hy, hy * 6.28, col, camPos);
                            }
                        }
                    }
                }
            }
        }
    }

    function resolvePoleCollision(x, z) {
        let cx = x;
        let cz = z;
        let hit = false;
        const [bx0, bz0] = layout.worldToBlock(cx, cz);
        for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
            for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
                if (bx < layout.BLOCK_MIN || bx > layout.BLOCK_MAX || bz < layout.BLOCK_MIN || bz > layout.BLOCK_MAX) continue;
                const roadX = layout.roadKindForLine(bx, bz);
                const lu = bx * layout.BLOCK_SIZE + layout.ROAD_WIDTH[roadX] * 0.5 + 1.0;
                const v0 = bz * layout.BLOCK_SIZE;
                for (let s = 0; s < 3; s++) {
                    const lv = v0 + 22 + s * 42;
                    if (layout.riverCorridorInfo(lu, lv).roadSuppress > 0.2) continue;
                    const [lx, lz] = layout.gridToWorld(lu, lv);
                    const dx = cx - lx;
                    const dz = cz - lz;
                    const d = Math.hypot(dx, dz);
                    const minR = 1.15;
                    if (d < minR) {
                        hit = true;
                        const nx = d > 1e-4 ? dx / d : 1;
                        const nz = d > 1e-4 ? dz / d : 0;
                        cx = lx + nx * minR;
                        cz = lz + nz * minR;
                    }
                }
            }
        }
        return { x: cx, z: cz, hit };
    }

    return { update, resolvePoleCollision };
}
