// Smooth non-voxel procedural pine, canyon oak, shrub, and limestone boulder instances
// scattered cleanly onto sunlit Surface Nets vertices (zero placement inside dark caves).
import { outerHeightAt } from "/app/geology.js";

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const mix = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

function hash2(x, z, seed = 1337) {
    let n = Math.imul(Math.floor(x * 10), 374761393) ^ Math.imul(Math.floor(z * 10), 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

class SmoothMesh {
    constructor() {
        this.pos = [];
        this.nrm = [];
        this.col = [];
        this.idx = [];
    }

    push(x, y, z, nx, ny, nz, rgba) {
        const l = Math.hypot(nx, ny, nz) || 1;
        this.pos.push(x, y, z);
        this.nrm.push(nx / l, ny / l, nz / l);
        this.col.push(rgba[0], rgba[1], rgba[2], rgba[3] ?? 1.0);
        return (this.pos.length / 3) - 1;
    }

    addLathe(rings, segs, colBot, colTop) {
        // rings: [[y, r, droop], ...]
        const base = this.pos.length / 3;
        for (let r = 0; r < rings.length; r++) {
            const [ry, rad, droop] = rings[r];
            const t = r / Math.max(1, rings.length - 1);
            const col = [
                mix(colBot[0], colTop[0], t),
                mix(colBot[1], colTop[1], t),
                mix(colBot[2], colTop[2], t),
            ];
            const prevR = rings[Math.max(0, r - 1)][1];
            const nextR = rings[Math.min(rings.length - 1, r + 1)][1];
            const prevY = rings[Math.max(0, r - 1)][0];
            const nextY = rings[Math.min(rings.length - 1, r + 1)][0];
            const dr = nextR - prevR, dy = nextY - prevY;
            const nyBase = -dr, nrBase = dy;
            for (let i = 0; i <= segs; i++) {
                const a = (i / segs) * Math.PI * 2;
                const cs = Math.cos(a), sn = Math.sin(a);
                const wave = 1 + 0.08 * Math.sin(a * 5 + r * 1.7);
                const x = cs * rad * wave, z = sn * rad * wave;
                const y = ry - droop * (0.5 + 0.5 * Math.cos(a * 3 + r));
                this.push(x, y, z, cs * nrBase, nyBase, sn * nrBase, col);
            }
        }
        const stride = segs + 1;
        for (let r = 0; r < rings.length - 1; r++) {
            for (let i = 0; i < segs; i++) {
                const a = base + r * stride + i, b = a + 1;
                const c = a + stride, d = c + 1;
                this.idx.push(a, c, b, b, c, d);
            }
        }
    }

    addEllipsoid(cx, cy, cz, rx, ry, rz, cBot, cTop, seed = 1) {
        const stacks = 10, slices = 16;
        const base = this.pos.length / 3;
        for (let st = 0; st <= stacks; st++) {
            const phi = (st / stacks) * Math.PI;
            const sy = Math.cos(phi), sr = Math.sin(phi);
            const cT = 0.5 + 0.5 * sy;
            const col = [mix(cBot[0], cTop[0], cT), mix(cBot[1], cTop[1], cT), mix(cBot[2], cTop[2], cT)];
            for (let sl = 0; sl <= slices; sl++) {
                const th = sl === slices ? 0 : (sl / slices) * Math.PI * 2;
                let lx = sr * Math.cos(th), ly = sy, lz = sr * Math.sin(th);
                if (st > 0 && st < stacks) {
                    const bump = 1 + 0.11 * Math.sin(th * 3 + phi * 4 + seed) * Math.cos(phi * 3 - th * 2);
                    lx *= bump; ly *= bump; lz *= bump;
                }
                this.push(cx + lx * rx, cy + ly * ry, cz + lz * rz, lx / rx, ly / ry, lz / rz, col);
            }
        }
        const stride = slices + 1;
        for (let st = 0; st < stacks; st++) {
            for (let sl = 0; sl < slices; sl++) {
                const a = base + st * stride + sl, b = a + 1, c = a + stride, d = c + 1;
                this.idx.push(a, b, c, b, d, c);
            }
        }
    }

    toMesh() {
        const m = new Mesh({
            positions: new Float32Array(this.pos),
            normals: new Float32Array(this.nrm),
            colors: new Float32Array(this.col),
            indices: new Uint32Array(this.idx),
        });
        m.computeNormals();
        return m;
    }
}

function buildPineMesh() {
    const sm = new SmoothMesh();
    const barkD = [0.24, 0.17, 0.11], barkL = [0.34, 0.24, 0.16];
    sm.addLathe([[-0.55, 0.34, 0], [0.0, 0.25, 0], [3.2, 0.14, 0], [6.8, 0.05, 0]], 10, barkD, barkL);
    const leafD = [0.07, 0.21, 0.09], leafL = [0.16, 0.35, 0.15];
    for (let tier = 0; tier < 5; tier++) {
        const y0 = 1.8 + tier * 1.15;
        const rMax = 2.05 * (1 - tier * 0.16);
        sm.addLathe([
            [y0 - 0.15, 0.08, 0],
            [y0 - 0.35, rMax, 0.18],
            [y0 + 0.65, rMax * 0.48, 0.08],
            [y0 + 1.55, 0.04, 0],
        ], 12, leafD, leafL);
    }
    return sm.toMesh();
}

function buildOakMesh() {
    const sm = new SmoothMesh();
    const barkD = [0.27, 0.19, 0.13], barkL = [0.38, 0.28, 0.19];
    sm.addLathe([[-0.55, 0.42, 0], [0.0, 0.30, 0], [2.4, 0.21, 0], [3.6, 0.14, 0]], 10, barkD, barkL);
    const leafD = [0.11, 0.28, 0.09], leafL = [0.24, 0.45, 0.15];
    sm.addEllipsoid(0.0, 4.4, 0.0, 2.25, 1.55, 2.15, leafD, leafL, 1.7);
    sm.addEllipsoid(1.3, 3.8, 0.6, 1.45, 1.15, 1.40, leafD, leafL, 3.1);
    sm.addEllipsoid(-1.2, 3.9, -0.5, 1.40, 1.10, 1.45, leafD, leafL, 5.2);
    sm.addEllipsoid(-0.4, 4.1, 1.3, 1.35, 1.05, 1.30, leafD, leafL, 7.4);
    sm.addEllipsoid(0.2, 5.4, -0.2, 1.45, 1.10, 1.40, leafD, leafL, 9.8);
    return sm.toMesh();
}

function buildShrubMesh() {
    const sm = new SmoothMesh();
    const bot = [0.10, 0.26, 0.08], top = [0.21, 0.42, 0.13];
    sm.addEllipsoid(0.0, 0.35, 0.0, 0.95, 0.62, 0.90, bot, top, 2.3);
    sm.addEllipsoid(0.55, 0.25, 0.35, 0.68, 0.48, 0.62, bot, top, 4.9);
    sm.addEllipsoid(-0.50, 0.28, -0.35, 0.65, 0.46, 0.66, bot, top, 8.1);
    return sm.toMesh();
}

function buildBoulderMesh() {
    if (typeof Mesh.rock === 'function') {
        const m = Mesh.rock(1.0, 42, 3);
        const vc = m.vertexCount;
        const col = new Float32Array(vc * 4);
        const pos = m.positions;
        for (let i = 0; i < vc; i++) {
            const moss = clamp((pos[i * 3 + 1] + 0.2) * 0.6, 0, 1);
            col[i * 4] = mix(0.38, 0.54, moss);
            col[i * 4 + 1] = mix(0.36, 0.50, moss);
            col[i * 4 + 2] = mix(0.33, 0.43, moss);
            col[i * 4 + 3] = 1.0;
        }
        m.colors = col;
        return m;
    }
    const sm = new SmoothMesh();
    sm.addEllipsoid(0, 0.05, 0, 1.1, 0.75, 0.95, [0.34, 0.32, 0.30], [0.54, 0.50, 0.44], 12.3);
    return sm.toMesh();
}

function packInstance(buf, idx, x, y, z, scale, yaw, tint) {
    const o = idx * 16;
    const cs = Math.cos(yaw) * scale, sn = Math.sin(yaw) * scale;
    buf[o] = cs;      buf[o + 1] = 0;     buf[o + 2] = sn;   buf[o + 3] = x;
    buf[o + 4] = 0;       buf[o + 5] = scale; buf[o + 6] = 0;    buf[o + 7] = y;
    buf[o + 8] = -sn;     buf[o + 9] = 0;     buf[o + 10] = cs;  buf[o + 11] = z;
    buf[o + 12] = tint[0]; buf[o + 13] = tint[1]; buf[o + 14] = tint[2]; buf[o + 15] = 1.0;
}

export function createFloraSystem(scene, blockList = []) {
    const pineNode = scene.createInstancedMesh({ mesh: buildPineMesh(), roughness: 0.85, castsShadow: true });
    const oakNode = scene.createInstancedMesh({ mesh: buildOakMesh(), roughness: 0.86, castsShadow: true });
    const shrubNode = scene.createInstancedMesh({ mesh: buildShrubMesh(), roughness: 0.88, castsShadow: true });
    const boulderNode = scene.createInstancedMesh({ mesh: buildBoulderMesh(), roughness: 0.90, castsShadow: true });

    const counts = { pines: 0, oaks: 0, shrubs: 0, boulders: 0 };

    function isBlocked(x, z) {
        for (const [bx, bz, br] of blockList) {
            if ((x - bx) * (x - bx) + (z - bz) * (z - bz) < br * br) return true;
        }
        return false;
    }

    function scatterFromChunks(chunks) {
        const treeCells = new Set();
        const smallCells = new Set();
        const pines = [], oaks = [], shrubs = [], boulders = [];

        const cellKey = (x, z, size) => `${Math.floor(x / size)},${Math.floor(z / size)}`;
        const hasNeighbor = (set, x, z, size) => {
            const cx = Math.floor(x / size), cz = Math.floor(z / size);
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (set.has(`${cx + dx},${cz + dz}`)) return true;
                }
            }
            return false;
        };

        for (const ch of chunks) {
            const m = ch.mesh;
            if (!m || m.vertexCount === 0) continue;
            const pos = m.positions, nrm = m.normals, col = m.colors;
            const vc = m.vertexCount;
            for (let i = 0; i < vc; i += 2) {
                const wx = pos[i * 3], wy = pos[i * 3 + 1], wz = pos[i * 3 + 2];
                const ny = nrm[i * 3 + 1], sky = col[i * 4];
                if (sky < 0.86 || ny < 0.78 || wy < 8.6 || wy > 54.0) continue;
                if (isBlocked(wx, wz)) continue;

                const r = hash2(wx, wz, 101);
                const rKind = hash2(wx + 7.3, wz - 3.1, 409);

                if (ny > 0.82 && wy > 9.4 && !hasNeighbor(treeCells, wx, wz, 5.6) && r < 0.56) {
                    treeCells.add(cellKey(wx, wz, 5.6));
                    const s = 0.85 + rKind * 0.55;
                    const tint = [0.88 + r * 0.20, 0.90 + rKind * 0.16, 0.86 + r * 0.16];
                    if (wy > 45.5 || rKind < 0.65) {
                        pines.push([wx, wy - 0.15, wz, s, r * Math.PI * 2, tint]);
                    } else {
                        oaks.push([wx, wy - 0.15, wz, s * 0.94, r * Math.PI * 2, tint]);
                    }
                } else if (!hasNeighbor(smallCells, wx, wz, 3.0) && r < 0.70) {
                    smallCells.add(cellKey(wx, wz, 3.0));
                    if (rKind < 0.24) {
                        boulders.push([wx, wy - 0.22, wz, 0.75 + r * 1.15, rKind * Math.PI * 2, [0.95, 0.95, 0.94]]);
                    } else {
                        shrubs.push([wx, wy - 0.12, wz, 0.75 + r * 0.65, rKind * Math.PI * 2, [0.90 + r * 0.18, 0.92 + rKind * 0.15, 0.90]]);
                    }
                }
            }
        }

        // Scatter smooth outer horizon pines on surrounding canyon highlands (r = 96..340 m)
        for (let gz = -340; gz <= 340; gz += 12) {
            for (let gx = -340; gx <= 340; gx += 12) {
                if (Math.abs(gx) < 94 && Math.abs(gz) < 94) continue;
                const d2 = gx * gx + gz * gz;
                if (d2 > 340 * 340) continue;
                const jx = gx + (hash2(gx, gz, 901) - 0.5) * 9.0;
                const jz = gz + (hash2(gx, gz, 902) - 0.5) * 9.0;
                const hy = outerHeightAt(jx, jz);
                if (hy < 12 || hy > 74) continue;
                const slopeEst = Math.max(
                    Math.abs(outerHeightAt(jx + 2, jz) - hy),
                    Math.abs(outerHeightAt(jx, jz + 2) - hy)
                ) / 2;
                if (slopeEst > 0.58) continue;
                const r = hash2(jx, jz, 733);
                if (r > 0.62) continue;
                const sc = 0.95 + r * 0.65;
                const tint = [0.90 + r * 0.15, 0.92 + r * 0.14, 0.90];
                if (hy > 42 || r < 0.65) pines.push([jx, hy - 0.25, jz, sc, r * 6.28, tint]);
                else oaks.push([jx, hy - 0.25, jz, sc * 0.9, r * 6.28, tint]);
            }
        }

        const uploadList = (node, list) => {
            const buf = new Float32Array(list.length * 16);
            for (let i = 0; i < list.length; i++) {
                const [x, y, z, s, yaw, tint] = list[i];
                packInstance(buf, i, x, y, z, s, yaw, tint);
            }
            node.setInstances(buf);
        };

        uploadList(pineNode, pines);
        uploadList(oakNode, oaks);
        uploadList(shrubNode, shrubs);
        uploadList(boulderNode, boulders);

        counts.pines = pines.length;
        counts.oaks = oaks.length;
        counts.shrubs = shrubs.length;
        counts.boulders = boulders.length;
    }

    return {
        scatterFromChunks,
        setVisible(on) {
            const v = !!on;
            pineNode.visible = v && counts.pines > 0;
            oakNode.visible = v && counts.oaks > 0;
            shrubNode.visible = v && counts.shrubs > 0;
            boulderNode.visible = v && counts.boulders > 0;
        },
        stats() {
            return { ...counts, total: counts.pines + counts.oaks + counts.shrubs + counts.boulders };
        },
    };
}
