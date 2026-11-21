// GPU SVDAG -> smooth continuous C^2 density pipeline -> seamless Surface Nets terrain chunks.
import { WORLD_CFG, outerHeightAt } from "/app/geology.js";
import { attachKarstShader } from "/app/shaders.js";

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

const KERNEL_SRC = `
import std::noise::*;
import voxeldag;

fn sample_region_state<BReg, BN, BC, BB>(
    wp: vec3<f32>,
    ri: u32,
    regions: BReg,
    nodes: BN,
    children: BC,
    bricks: BB
) -> u32 {
    let base = (ri * 5u) as i32;
    let r0 = regions[base];
    let r4 = regions[base + 4];
    let flags = bitcast<u32>(r4.z);
    let root = bitcast<u32>(r4.x);
    if ((flags & voxeldag::REGION_ENABLED) == 0u || root == voxeldag::DAG_INVALID || r0.w <= 0.0) {
        return 0u;
    }
    let r1 = regions[base + 1];
    let r2 = regions[base + 2];
    let r3 = regions[base + 3];
    let rel = wp - r0.xyz;
    let inv_ext = 1.0 / max(r0.w, 1e-6);
    let u = vec3<f32>(dot(rel, r1.xyz), dot(rel, r2.xyz), dot(rel, r3.xyz)) * inv_ext;
    if (u.x < 0.0 || u.x >= 1.0 || u.y < 0.0 || u.y >= 1.0 || u.z < 0.0 || u.z >= 1.0) {
        return 0u;
    }

    var p: vec3<f32> = u;
    var cur: u32 = root;
    var lvl: u32 = 0u;
    while (lvl < 16u) {
        let n = nodes[cur as i32];
        let masks = n.x;
        let solid_mask = masks & 0xFFu;
        let carve_mask = (masks >> 8u) & 0xFFu;
        let leaf_mask = (masks >> 16u) & 0xFFu;
        let node_flags = (masks >> 24u) & 0xFFu;
        if (solid_mask == 0u && (node_flags & voxeldag::DAG_FLAG_UNIFORM_CARVE) != 0u) {
            return 2u;
        }
        let sp = p * 2.0;
        let ox = sp.x >= 1.0 ? 1u : 0u;
        let oy = sp.y >= 1.0 ? 1u : 0u;
        let oz = sp.z >= 1.0 ? 1u : 0u;
        let oct = ox | (oy << 1u) | (oz << 2u);
        let bit = 1u << oct;
        let has_s = (solid_mask & bit) != 0u;
        let has_c = (carve_mask & bit) != 0u;
        if (!has_s && !has_c) {
            return 0u;
        }
        let valid_mask = solid_mask | carve_mask;
        let slot = voxeldag::popcount_below32(valid_mask, oct);
        let raw_ref = children[(n.y + slot) as i32];
        if ((raw_ref & voxeldag::DAG_ANIM_BIT) != 0u || raw_ref == voxeldag::DAG_INVALID) {
            return 0u;
        }
        let child_p = vec3<f32>(sp.x - (ox as f32), sp.y - (oy as f32), sp.z - (oz as f32));
        if ((leaf_mask & bit) != 0u) {
            let b0 = bricks[(raw_ref * 2u) as i32];
            let b1 = bricks[(raw_ref * 2u + 1u) as i32];
            let bp = clamp(floor(child_p * 4.0), vec3<f32>(0.0), vec3<f32>(3.0));
            let bidx = (bp.x as u32) + ((bp.y as u32) << 2u) + ((bp.z as u32) << 4u);
            let out_s = voxeldag::bit64_set(b0.x, b0.y, bidx) ? 1u : 0u;
            let uni_c = (b1.w & voxeldag::DAG_BRICK_UNIFORM_CARVE) != 0u;
            let out_c = (uni_c || voxeldag::bit64_set(b0.z, b0.w, bidx)) ? 2u : 0u;
            return out_s | out_c;
        }
        cur = raw_ref;
        p = child_p;
        lvl += 1u;
    }
    return 0u;
}

@kernel @grid(3)
fn k_dag_raw(
    g: grid<3>,
    out: write_store<f32, 1>,
    ox: f32, oy: f32, oz: f32, step: f32,
    region_count: u32,
    caves_enabled: f32,
    regions: read_store<vec4<f32>, 1>,
    nodes: read_store<vec4<u32>, 1>,
    children: read_store<u32, 1>,
    bricks: read_store<vec4<u32>, 1>
) {
    let gx = g.x();
    let gy = g.y();
    let gz = g.z();
    let wp = vec3<f32>(ox + (gx as f32) * step, oy + (gy as f32) * step, oz + (gz as f32) * step);

    var s0: bool = false;
    var c1: bool = false;
    var s2: bool = false;
    if (region_count > 0u) {
        s0 = (sample_region_state(wp, 0u, regions, nodes, children, bricks) & 1u) != 0u;
    }
    if (caves_enabled > 0.5 && region_count > 1u) {
        c1 = (sample_region_state(wp, 1u, regions, nodes, children, bricks) & 2u) != 0u;
    }
    if (region_count > 2u) {
        s2 = (sample_region_state(wp, 2u, regions, nodes, children, bricks) & 1u) != 0u;
    }

    let idx = (gz * 58 + gy) * 46 + gx;
    out[idx] = ((s0 && !c1) || s2) ? -1.0 : 1.0;
}

@kernel @grid(3)
fn k_blur_a(g: grid<3>, src: read_store<f32, 1>, dst: write_store<f32, 1>) {
    let gx = g.x();
    let gy = g.y();
    let gz = g.z();
    var sum: f32 = 0.0;
    var dz: i32 = -1;
    while (dz <= 1) {
        let wz = (dz == 0) ? 2.0 : 1.0;
        let sz = gz + 1 + dz;
        var dy: i32 = -1;
        while (dy <= 1) {
            let wy = (dy == 0) ? 2.0 : 1.0;
            let sy = gy + 1 + dy;
            var dx: i32 = -1;
            while (dx <= 1) {
                let wx = (dx == 0) ? 2.0 : 1.0;
                let sx = gx + 1 + dx;
                sum += src[(sz * 58 + sy) * 46 + sx] * (wx * wy * wz);
                dx += 1;
            }
            dy += 1;
        }
        dz += 1;
    }
    dst[(gz * 56 + gy) * 44 + gx] = sum * (1.0 / 64.0);
}

@kernel @grid(3)
fn k_blur_b(
    g: grid<3>,
    src: read_store<f32, 1>,
    dst: write_store<f32, 1>,
    ox: f32, oy: f32, oz: f32, step: f32
) {
    let gx = g.x();
    let gy = g.y();
    let gz = g.z();
    var sum: f32 = 0.0;
    var dz: i32 = -1;
    while (dz <= 1) {
        let wz = (dz == 0) ? 2.0 : 1.0;
        let sz = gz + 1 + dz;
        var dy: i32 = -1;
        while (dy <= 1) {
            let wy = (dy == 0) ? 2.0 : 1.0;
            let sy = gy + 1 + dy;
            var dx: i32 = -1;
            while (dx <= 1) {
                let wx = (dx == 0) ? 2.0 : 1.0;
                let sx = gx + 1 + dx;
                sum += src[(sz * 56 + sy) * 44 + sx] * (wx * wy * wz);
                dx += 1;
            }
            dy += 1;
        }
        dz += 1;
    }
    let d = sum * (1.0 / 64.0);
    let wp = vec3<f32>(ox + (gx as f32) * step, oy + (gy as f32) * step, oz + (gz as f32) * step);
    let edge_x = 1.0 - smoothstep(82.0, 92.0, abs(wp.x));
    let edge_z = 1.0 - smoothstep(82.0, 92.0, abs(wp.z));
    let band = max(0.0, 1.0 - abs(d) * 1.15) * edge_x * edge_z;
    let warp = fbm_simplex<f32, 3>(wp * 0.025, 2, 2.0, 0.5, 0.0, 11);
    let strata = sin(wp.y * 0.72 + warp * 2.6) * 0.075;
    let crag = fbm_simplex<f32, 3>(wp * 0.065, 3, 2.0, 0.5, 0.0, 77) * 0.12;
    dst[(gz * 54 + gy) * 42 + gx] = d + band * (strata + crag);
}
`;

function samplePadded(padded, nx, ny, nz, fx, fy, fz) {
    const x0 = clamp(Math.floor(fx), 0, nx - 2);
    const y0 = clamp(Math.floor(fy), 0, ny - 2);
    const z0 = clamp(Math.floor(fz), 0, nz - 2);
    const tx = clamp(fx - x0, 0, 1);
    const ty = clamp(fy - y0, 0, 1);
    const tz = clamp(fz - z0, 0, 1);
    const at = (x, y, z) => padded[(z * ny + y) * nx + x];
    const c00 = at(x0, y0, z0) * (1 - tx) + at(x0 + 1, y0, z0) * tx;
    const c10 = at(x0, y0 + 1, z0) * (1 - tx) + at(x0 + 1, y0 + 1, z0) * tx;
    const c01 = at(x0, y0, z0 + 1) * (1 - tx) + at(x0 + 1, y0, z0 + 1) * tx;
    const c11 = at(x0, y0 + 1, z0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
}

function vertexLightingInfo(padded, nx, ny, nz, px, py, pz) {
    const ux = px + 1, uy = py + 1, uz = pz + 1;
    const e = 0.55;
    const gx = samplePadded(padded, nx, ny, nz, ux + e, uy, uz) - samplePadded(padded, nx, ny, nz, ux - e, uy, uz);
    const gy = samplePadded(padded, nx, ny, nz, ux, uy + e, uz) - samplePadded(padded, nx, ny, nz, ux, uy - e, uz);
    const gz = samplePadded(padded, nx, ny, nz, ux, uy, uz + e) - samplePadded(padded, nx, ny, nz, ux, uy, uz - e);
    const len = Math.hypot(gx, gy, gz) || 1;
    const nrm = [gx / len, gy / len, gz / len];

    // Upward sky visibility probe across padded vertical columns (keeps cave interiors un-grassed)
    const ix = clamp(Math.round(ux), 1, nx - 2);
    const iz = clamp(Math.round(uz), 1, nz - 2);
    const iyStart = clamp(Math.ceil(uy + 1.5), 1, ny - 1);
    const dirs = [[0, 0], [0.22, 0.14], [-0.22, -0.14]];
    let openCount = 0;
    for (const [sx, sz] of dirs) {
        let hit = false;
        for (let ky = iyStart; ky < ny; ky++) {
            const dy = ky - iyStart;
            const qx = clamp(Math.round(ux + sx * dy), 0, nx - 1);
            const qz = clamp(Math.round(uz + sz * dy), 0, nz - 1);
            if (padded[(qz * ny + ky) * nx + qx] < 0) {
                hit = true;
                break;
            }
        }
        if (!hit) openCount++;
    }
    const sky = openCount / dirs.length;

    // 6-sample local cavity AO
    const r = 2.6;
    const probes = [
        samplePadded(padded, nx, ny, nz, ux + r, uy, uz),
        samplePadded(padded, nx, ny, nz, ux - r, uy, uz),
        samplePadded(padded, nx, ny, nz, ux, uy + r, uz),
        samplePadded(padded, nx, ny, nz, ux, uy, uz + r),
        samplePadded(padded, nx, ny, nz, ux, uy, uz - r),
        samplePadded(padded, nx, ny, nz, ix, clamp(uy + r * 0.7, 1, ny - 2), iz),
    ];
    let airAvg = 0;
    for (const p of probes) airAvg += clamp(0.5 + p * 0.65, 0, 1);
    const ao = clamp(0.28 + 0.72 * (airAvg / probes.length), 0.25, 1.0);
    return { nrm, sky, ao };
}

/** Build the continuous outer mountain horizon skirt framing the 190 m hero basin out to 1350 m. */
function buildHorizonSkirt(scene) {
    const segs = 128;
    const radial = 32;
    const nVerts = (radial + 1) * segs;
    const pos = new Float32Array(nVerts * 3);
    const nrm = new Float32Array(nVerts * 3);
    const col = new Float32Array(nVerts * 4);
    const idx = new Uint32Array(radial * segs * 6);

    const frameCoord = (i, rFrac) => {
        const u = (i / segs) * 4;
        const side = Math.floor(u) % 4;
        const t = (u - Math.floor(u)) * 2 - 1;
        let sx = 0, sz = 0;
        if (side === 0) { sx = t; sz = 1; }
        else if (side === 1) { sx = 1; sz = -t; }
        else if (side === 2) { sx = -t; sz = -1; }
        else { sx = -1; sz = t; }
        const reach = 91.5 + Math.pow(rFrac, 1.9) * 1240;
        return [sx * reach + 0.625, sz * reach + 0.625];
    };

    for (let ir = 0; ir <= radial; ir++) {
        const rf = ir / radial;
        const tuck = ir === 0 ? -1.4 : 0.0;
        for (let ia = 0; ia < segs; ia++) {
            const [wx, wz] = frameCoord(ia, rf);
            const wy = outerHeightAt(wx, wz) + tuck;
            const eps = 2.0 + rf * 8.0;
            const hx = outerHeightAt(wx - eps, wz) - outerHeightAt(wx + eps, wz);
            const hz = outerHeightAt(wx, wz - eps) - outerHeightAt(wx, wz + eps);
            const hy = 2 * eps;
            const nl = Math.hypot(hx, hy, hz) || 1;
            const v = ir * segs + ia;
            pos[v * 3] = wx;
            pos[v * 3 + 1] = wy;
            pos[v * 3 + 2] = wz;
            nrm[v * 3] = hx / nl;
            nrm[v * 3 + 1] = hy / nl;
            nrm[v * 3 + 2] = hz / nl;
            col[v * 4] = 1.0;
            col[v * 4 + 1] = 1.0;
            col[v * 4 + 2] = 0.5;
            col[v * 4 + 3] = 1.0;
        }
    }

    let k = 0;
    for (let ir = 0; ir < radial; ir++) {
        const r0 = ir * segs, r1 = (ir + 1) * segs;
        for (let ia = 0; ia < segs; ia++) {
            const ib = (ia + 1) % segs;
            const a = r0 + ia, b = r0 + ib, c = r1 + ia, d = r1 + ib;
            idx[k++] = a; idx[k++] = c; idx[k++] = b;
            idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
    }

    const node = scene.createMesh({
        positions: pos, normals: nrm, colors: col, indices: idx,
        roughness: 0.9, castsShadow: true,
    });
    attachKarstShader(node);
    return node;
}

export function createKarstMesher(scene, vd) {
    const cfg = WORLD_CFG;
    const mod = bro.kernel.compile(KERNEL_SRC, { file: 'karst_mesher.bk' });
    const kDagRaw = mod.kernel('k_dag_raw');
    const kBlurA = mod.kernel('k_blur_a');
    const kBlurB = mod.kernel('k_blur_b');

    const NX0 = 46, NY0 = 58, NZ0 = 46;
    const NX1 = 44, NY1 = 56, NZ1 = 44;
    const NX2 = 42, NY2 = 54, NZ2 = 42;
    const rawBuf = bro.kernel.createBuffer(NX0 * NY0 * NZ0 * 4);
    const tmpBuf = bro.kernel.createBuffer(NX1 * NY1 * NZ1 * 4);
    const smoothBuf = bro.kernel.createBuffer(NX2 * NY2 * NZ2 * 4);
    const paddedWork = new Float32Array(NX2 * NY2 * NZ2);
    const innerWork = new Float32Array(cfg.chunkGrid * cfg.chunkGridY * cfg.chunkGrid);

    const chunks = [];
    for (let cz = 0; cz < cfg.chunksPerSide; cz++) {
        for (let cx = 0; cx < cfg.chunksPerSide; cx++) {
            const x0 = cfg.heroMin[0] + cx * cfg.chunkStride * cfg.cellSize;
            const y0 = cfg.heroMin[1];
            const z0 = cfg.heroMin[2] + cz * cfg.chunkStride * cfg.cellSize;
            const sizeXZ = cfg.chunkCells * cfg.cellSize;
            chunks.push({
                cx, cz, x0, y0, z0,
                x1: x0 + sizeXZ,
                z1: z0 + sizeXZ,
                node: null,
                mesh: null,
                padded: new Float32Array(NX2 * NY2 * NZ2),
                triangles: 0,
                vertices: 0,
            });
        }
    }

    const skirtNode = buildHorizonSkirt(scene);

    function extractChunk(ch, bufs, cavesEnabled) {
        const s = cfg.cellSize;
        kDagRaw.dispatch(
            [NX0, NY0, NZ0], rawBuf,
            ch.x0 - 3 * s, ch.y0 - 3 * s, ch.z0 - 3 * s, s,
            bufs.regionCount, cavesEnabled ? 1.0 : 0.0,
            bufs.regions, bufs.nodes, bufs.children, bufs.bricks
        );
        kBlurA.dispatch([NX1, NY1, NZ1], rawBuf, tmpBuf);
        kBlurB.dispatch(
            [NX2, NY2, NZ2], tmpBuf, smoothBuf,
            ch.x0 - s, ch.y0 - s, ch.z0 - s, s
        );

        smoothBuf.read(paddedWork);
        ch.padded.set(paddedWork);

        const gx = cfg.chunkGrid, gy = cfg.chunkGridY, gz = cfg.chunkGrid;
        for (let z = 0; z < gz; z++) {
            const pz = z + 1;
            for (let y = 0; y < gy; y++) {
                const py = y + 1;
                const srcOff = (pz * NY2 + py) * NX2 + 1;
                const dstOff = (z * gy + y) * gx;
                innerWork.set(paddedWork.subarray(srcOff, srcOff + gx), dstOff);
            }
        }

        const mesh = Mesh.surfaceNets(innerWork, gx, gy, gz, 0.0);
        const vCount = mesh.vertexCount;
        ch.mesh = vCount > 0 ? mesh : null;
        if (vCount === 0) {
            if (ch.node) ch.node.visible = false;
            ch.triangles = 0;
            ch.vertices = 0;
            return;
        }

        const pos = mesh.positions;
        const nrm = new Float32Array(vCount * 3);
        const col = new Float32Array(vCount * 4);
        for (let i = 0; i < vCount; i++) {
            const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
            const info = vertexLightingInfo(paddedWork, NX2, NY2, NZ2, px, py, pz);
            nrm[i * 3] = info.nrm[0];
            nrm[i * 3 + 1] = info.nrm[1];
            nrm[i * 3 + 2] = info.nrm[2];
            col[i * 4] = info.sky;
            col[i * 4 + 1] = info.ao;
            col[i * 4 + 2] = clamp((ch.y0 + py * s - cfg.waterY) / 42.0, 0, 1);
            col[i * 4 + 3] = 1.0;
        }

        mesh.scale(s, s, s).translate(ch.x0, ch.y0, ch.z0);
        mesh.normals = nrm;
        mesh.colors = col;

        ch.vertices = vCount;
        ch.triangles = mesh.triangleCount;

        if (!ch.node) {
            ch.node = scene.createMesh({ mesh, roughness: 0.88, castsShadow: true });
            attachKarstShader(ch.node);
        } else {
            ch.node.visible = true;
            ch.node.updateMesh(mesh, false);
        }
    }

    function densityAtWorld(x, y, z) {
        const step = cfg.cellSize;
        const span = cfg.chunkStride * step;
        const cx = clamp(Math.floor((x - cfg.heroMin[0]) / span), 0, cfg.chunksPerSide - 1);
        const cz = clamp(Math.floor((z - cfg.heroMin[2]) / span), 0, cfg.chunksPerSide - 1);
        const ch = chunks[cz * cfg.chunksPerSide + cx];
        const fx = (x - (ch.x0 - step)) / step;
        const fy = (y - (ch.y0 - step)) / step;
        const fz = (z - (ch.z0 - step)) / step;
        if (fx < 0 || fx > NX2 - 1 || fy < 0 || fy > NY2 - 1 || fz < 0 || fz > NZ2 - 1) {
            return y - outerHeightAt(x, z);
        }
        return samplePadded(ch.padded, NX2, NY2, NZ2, fx, fy, fz);
    }

    return {
        chunks,
        skirtNode,
        remeshAll(cavesEnabled = true) {
            const bufs = vd.buffers([0, 0, 0]);
            for (const ch of chunks) extractChunk(ch, bufs, cavesEnabled);
        },
        remeshBox(minP, maxP, cavesEnabled = true) {
            const bufs = vd.buffers([0, 0, 0]);
            const pad = 5.0;
            for (const ch of chunks) {
                if (ch.x1 + pad < minP[0] || ch.x0 - pad > maxP[0] ||
                    ch.z1 + pad < minP[2] || ch.z0 - pad > maxP[2]) continue;
                extractChunk(ch, bufs, cavesEnabled);
            }
        },
        setVisible(on) {
            const show = !!on;
            for (const ch of chunks) {
                if (ch.node) ch.node.visible = show && ch.triangles > 0;
            }
            skirtNode.visible = show;
        },
        raycastWorld(origin, dir, maxDist = 200) {
            const step = 0.85;
            let prevT = 0;
            let prevD = densityAtWorld(origin[0], origin[1], origin[2]);
            if (prevD <= 0) return null;
            for (let t = step; t <= maxDist; t += step) {
                const px = origin[0] + dir[0] * t;
                const py = origin[1] + dir[1] * t;
                const pz = origin[2] + dir[2] * t;
                const d = densityAtWorld(px, py, pz);
                if (d <= 0) {
                    let lo = prevT, hi = t;
                    for (let i = 0; i < 8; i++) {
                        const mid = 0.5 * (lo + hi);
                        if (densityAtWorld(origin[0] + dir[0] * mid, origin[1] + dir[1] * mid, origin[2] + dir[2] * mid) > 0) lo = mid;
                        else hi = mid;
                    }
                    const ht = 0.5 * (lo + hi);
                    return {
                        position: [origin[0] + dir[0] * ht, origin[1] + dir[1] * ht, origin[2] + dir[2] * ht],
                        dist: ht,
                    };
                }
                prevT = t;
                prevD = d;
            }
            return null;
        },
        stats() {
            let triangles = 0, vertices = 0, activeChunks = 0;
            for (const ch of chunks) {
                triangles += ch.triangles;
                vertices += ch.vertices;
                if (ch.triangles > 0) activeChunks++;
            }
            return { triangles, vertices, chunks: activeChunks };
        },
    };
}
