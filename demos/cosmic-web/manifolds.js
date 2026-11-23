// GPU manifold shaders + 64^3 GPU density volume sculptor + camera presets for DESI DR1 Cosmic Web.
// Packs bro.table GPU KernelBuffers into two coalesced vec4<f32> stores (s0, s1) so k_splat
// stays at 8 buffers / 176 bytes of push constants (strictly <= 256B Vulkan budget).

export const VOL_DIM = 64;
export const VOL_TOTAL = 64 * 64 * 64; // 262,144 voxels
export const VOL_BOX_HALF = 2400.0;    // +/- 2400 Mpc/h comoving cube

export const MANIFOLDS = [
    {
        id: 0,
        name: '3D Comoving Cosmic Web',
        short: '0 · 3D Cosmic Web',
        guide: 'A 3D map of real galaxies & quasars woven into dark-matter filaments around vast cosmic voids. Click anywhere to measure the 105 Mpc/h BAO ripple — frozen echoes of sound waves from the early Universe.',
        formula: '(cx, cz, cy) · 0.0008 Mpc/h⁻¹  (Ω_m=0.315, H₀=100h)',
        preset: { yaw: 0.52, pitch: 0.34, dist: 3.35, target: [0.0, 0.0, 0.0] },
    },
    {
        id: 1,
        name: '12-Gyr Light-Cone Cosmic History',
        short: '1 · 12-Gyr Light-Cone',
        guide: 'Looking outward is looking backward in time: nearby spiral galaxies sit at the narrow present-day base (z≈0), flaring upward through 12 billion years of expanding cosmic history toward distant quasars.',
        formula: '(cos θ · r_cone, (z − 1.2)·0.85, sin θ · r_cone),  r_cone = 0.25 + 0.35z',
        preset: { yaw: 0.32, pitch: 0.16, dist: 3.45, target: [0.0, 0.18, 0.0] },
    },
    {
        id: 2,
        name: 'Color–Color–Redshift Evolution',
        short: '2 · Color–Color–z',
        guide: 'Galaxies sorted by optical color vs redshift: star-forming blue spirals cluster center-left, ancient red ellipticals (LRGs) form a warm cloud to the right, and high-redshift quasars stream skyward.',
        formula: '((g−r − 0.8)·1.1, (z − 1.0)·0.9, (r−z − 0.5)·1.1)',
        preset: { yaw: 0.42, pitch: 0.20, dist: 2.95, target: [0.0, 0.05, 0.0] },
    },
    {
        id: 3,
        name: 'Inverted Cosmic Void Sculpture (64³ GPU)',
        short: '3 · Void Sculptor 64³',
        guide: 'An inverted view of the cosmos computed live on a 64³ GPU density grid: bright filaments fade away so the vast, empty cyan/indigo cosmic void bubbles between galaxy walls emerge as 3D sculptures.',
        formula: '64³ atomic_add density volume → inverted cyan/indigo void bubbles',
        preset: { yaw: 0.56, pitch: 0.36, dist: 3.15, target: [0.0, 0.0, 0.0] },
    },
];

export const COSMO_PACK_SHADER = `
import sci::splat::*;

const VOL_N: u32 = 64u;
const BOX_HALF: f32 = 2400.0;

@kernel @grid(1)
fn k_pack_s0(g: grid<1>,
             cx: read_store<f32, 1>, cy: read_store<f32, 1>,
             cz: read_store<f32, 1>, zcol: read_store<f32, 1>,
             out: write_store<vec4<f32>, 1>, count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        out[i] = vec4<f32>(cx[i], cy[i], cz[i], zcol[i]);
        i += stride;
    }
}

@kernel @grid(1)
fn k_pack_s1(g: grid<1>,
             gr: read_store<f32, 1>, rz: read_store<f32, 1>,
             flux: read_store<f32, 1>, voidScore: read_store<f32, 1>,
             spectype: read_store<i32, 1>,
             out: write_store<vec4<f32>, 1>, count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let vq = floor(clamp(voidScore[i], 0.0, 1.0) * 16383.0);
        let st = clamp(spectype[i], 0, 3) as f32;
        out[i] = vec4<f32>(gr[i], rz[i], flux[i], vq * 4.0 + st);
        i += stride;
    }
}

@kernel @grid(1)
fn k_vol_clear(g: grid<1>, volRaw: rw_store<u32, 1>, total: u32) {
    let i = g.x() as u32;
    if i < total {
        volRaw[i] = 0u;
    }
}

@kernel @grid(1)
fn k_vol_deposit(g: grid<1>,
                 s0: read_store<vec4<f32>, 1>,
                 mask: read_store<u32, 1>,
                 volRaw: rw_store<u32, 1>,
                 count: u32, stride: u32, hasMask: u32) {
    var idx: u32 = g.x() as u32;
    let scale = (VOL_N as f32) / (2.0 * BOX_HALF);
    while idx < count {
        if mask_active(mask, idx, hasMask) > 0.5 {
            let v = s0[idx];
            let fx = (v.x + BOX_HALF) * scale;
            let fy = (v.y + BOX_HALF) * scale;
            let fz = (v.z + BOX_HALF) * scale;
            if fx >= 0.0 && fx < 64.0 && fy >= 0.0 && fy < 64.0 && fz >= 0.0 && fz < 64.0 {
                let vx = min(63u, fx as u32);
                let vy = min(63u, fy as u32);
                let vz = min(63u, fz as u32);
                let vid = (vz * VOL_N + vy) * VOL_N + vx;
                volRaw.atomic_add(vid, 1u);
            }
        }
        idx += stride;
    }
}

fn read_vox(volRaw: read_store<u32, 1>, x: i32, y: i32, z: i32) -> f32 {
    if x < 0 || x >= 64 || y < 0 || y >= 64 || z < 0 || z >= 64 {
        return 0.0;
    }
    let vid = ((z as u32) * 64u + (y as u32)) * 64u + (x as u32);
    return volRaw[vid] as f32;
}

@kernel @grid(3)
fn k_vol_sculpt(g: grid<3>,
                volRaw: read_store<u32, 1>,
                volSculpt: write_store<u32, 1>) {
    let vx = g.x() as i32;
    let vy = g.y() as i32;
    let vz = g.z() as i32;
    if vx >= 64 || vy >= 64 || vz >= 64 {
        return;
    }

    // 5x5x5 smoothed inner density: bridges thin filaments so ONLY true wide void cavities read empty!
    var sumIn: f32 = 0.0;
    var wSum: f32 = 0.0;
    var dz: i32 = -2;
    while dz <= 2 {
        var dy: i32 = -2;
        while dy <= 2 {
            var dx: i32 = -2;
            while dx <= 2 {
                let d2 = (dx * dx + dy * dy + dz * dz) as f32;
                let w = 1.0 / (1.0 + d2 * 0.75);
                sumIn += read_vox(volRaw, vx + dx, vy + dy, vz + dz) * w;
                wSum += w;
                dx += 1;
            }
            dy += 1;
        }
        dz += 1;
    }
    let avgIn = sumIn / wSum;

    // 26-direction surrounding filament shell survey (steps 2..5 voxels = 150..375 Mpc/h)
    var sumOut: f32 = 0.0;
    var outCnt: f32 = 0.0;
    var wallHits: u32 = 0u;
    var maxRing: f32 = 0.0;

    var rx: i32 = -1;
    while rx <= 1 {
        var ry: i32 = -1;
        while ry <= 1 {
            var rz: i32 = -1;
            while rz <= 1 {
                if rx != 0 || ry != 0 || rz != 0 {
                    let n2 = read_vox(volRaw, vx + rx * 2, vy + ry * 2, vz + rz * 2);
                    if n2 > maxRing { maxRing = n2; }
                    var raySum: f32 = 0.0;
                    var s: i32 = 2;
                    while s <= 5 {
                        let v = read_vox(volRaw, vx + rx * s, vy + ry * s, vz + rz * s);
                        sumOut += v;
                        outCnt += 1.0;
                        raySum += v;
                        s += 1;
                    }
                    if raySum >= 1.0 {
                        wallHits += 1u;
                    }
                }
                rz += 1;
            }
            ry += 1;
        }
        rx += 1;
    }

    let avgOut = sumOut / max(outCnt, 1.0);
    let normRatio = avgIn / max(avgOut, 0.04);
    let edgeGrad = clamp((maxRing - avgIn * 1.5) / max(avgOut * 2.4, 0.35), 0.0, 1.0);

    // Trim outer boundary shell cleanly inside observed cosmic web
    let fx = ((vx as f32) - 31.5) / 31.5;
    let fy = ((vy as f32) - 31.5) / 31.5;
    let fz = ((vz as f32) - 31.5) / 31.5;
    let rBox = sqrt(fx * fx + fy * fy + fz * fz);
    var hitsFinal: u32 = wallHits;
    if rBox > 0.86 {
        hitsFinal = 0u;
    }

    let relDensQ = min(255u, (clamp(normRatio * 0.5, 0.0, 1.0) * 255.0) as u32);
    let ambQ = min(255u, (clamp(log(1.0 + avgOut) * 145.0, 0.0, 255.0)) as u32);
    let gradQ = min(255u, (edgeGrad * 255.0) as u32);
    let vid = ((vz as u32) * 64u + (vy as u32)) * 64u + (vx as u32);
    volSculpt[vid] = relDensQ | (ambQ << 8u) | (gradQ << 16u) | (min(15u, hitsFinal >> 1u) << 24u);
}
`;

export const COSMO_SHADER = `
import sci::splat::*;

fn redshift_rgb(zIn: f32) -> vec3<f32> {
    let z = clamp(zIn, 0.0, 3.4);
    if z < 0.45 {
        let u = z / 0.45;
        return mix(vec3<f32>(0.28, 0.78, 1.32), vec3<f32>(0.98, 0.92, 0.58), vec3<f32>(u, u, u));
    }
    if z < 1.25 {
        let u = (z - 0.45) / 0.80;
        return mix(vec3<f32>(0.98, 0.92, 0.58), vec3<f32>(1.30, 0.46, 0.24), vec3<f32>(u, u, u));
    }
    let u = clamp((z - 1.25) / 2.15, 0.0, 1.0);
    return mix(vec3<f32>(1.30, 0.46, 0.24), vec3<f32>(1.08, 0.34, 1.32), vec3<f32>(u, u, u));
}

fn eval_manifold_pos(m: u32,
                     cx: f32, cy: f32, cz: f32, zval: f32,
                     gr: f32, rz: f32) -> vec3<f32> {
    if m == 0u || m == 3u {
        return vec3<f32>(cx * 0.0008, cz * 0.0008, cy * 0.0008);
    }
    if m == 1u {
        let ra_ang = atan2(cy, cx);
        let r_cone = 0.25 + 0.35 * zval;
        return vec3<f32>(cos(ra_ang) * r_cone, (zval - 1.2) * 0.85, sin(ra_ang) * r_cone);
    }
    return vec3<f32>((gr - 0.8) * 1.1, (zval - 1.0) * 0.9, (rz - 0.5) * 1.1);
}

fn eval_manifold_col(m: u32,
                     zval: f32, gr: f32, flux: f32,
                     void_v: f32, spec_v: i32) -> vec3<f32> {
    let rz_col = redshift_rgb(zval);
    let pls = plasma_rgb(clamp(zval / 2.8, 0.0, 1.0));
    let fil_boost = 0.42 + 0.56 * (1.0 - void_v);
    let flux_boost = clamp(0.54 + 0.11 * flux, 0.36, 0.88);

    if m == 0u {
        let base = mix(rz_col, pls, vec3<f32>(0.28, 0.28, 0.28)) * fil_boost * flux_boost;
        if spec_v == 1 {
            return base * 1.10 + vec3<f32>(0.08, 0.03, 0.0);
        }
        if spec_v == 2 {
            return vec3<f32>(0.88, 0.34, 1.15) * flux_boost;
        }
        if spec_v == 3 {
            return vec3<f32>(0.38, 0.92, 0.65);
        }
        return base;
    }
    if m == 1u {
        let cone_col = mix(rz_col, pls, vec3<f32>(0.40, 0.40, 0.40)) * flux_boost;
        if spec_v == 2 {
            return cone_col * 1.12 + vec3<f32>(0.10, 0.03, 0.18);
        }
        return cone_col * (0.58 + 0.38 * (1.0 - void_v));
    }
    if m == 2u {
        // Color-color-redshift sequence palette
        if spec_v == 1 {
            return vec3<f32>(0.96, 0.44, 0.18) * flux_boost;
        }
        if spec_v == 2 {
            return vec3<f32>(0.88, 0.28, 1.12) * flux_boost;
        }
        if spec_v == 3 {
            return vec3<f32>(0.38, 0.96, 0.66);
        }
        let u = clamp((gr - 0.1) / 1.4, 0.0, 1.0);
        return mix(vec3<f32>(0.26, 0.62, 1.08), vec3<f32>(0.96, 0.62, 0.26), vec3<f32>(u, u, u)) * flux_boost;
    }
    // Manifold 3: ghosted cosmic web filament scaffolding cradling glowing void bubbles
    let skel = mix(vec3<f32>(0.20, 0.14, 0.36), vec3<f32>(0.42, 0.24, 0.55), vec3<f32>(1.0 - void_v, 1.0 - void_v, 1.0 - void_v));
    return skel * (0.035 + 0.055 * (1.0 - void_v));
}

// Coalesced vec4 stores (total 8 buffers = 64B + 112B scalars/cams = 176B <= 256B limit):
//   s0 = (cx, cy, cz, z)
//   s1 = (g_r, r_z, flux_r, vq * 4 + spectype)
@kernel @grid(1)
fn k_splat(
    g: grid<1>,
    accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
    accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
    s0: read_store<vec4<f32>, 1>,
    s1: read_store<vec4<f32>, 1>,
    volSculpt: read_store<u32, 1>,
    mask: read_store<u32, 1>,
    count: u32, stride: u32, width: u32, height: u32,
    camR: vec4<f32>, camU: vec4<f32>, camF: vec4<f32>, camT: vec4<f32>,
    fromM: u32, toM: u32, morph: f32,
    hasMask: u32, radiusMode: u32, voidThresh: f32, voidGlow: f32, zFocus: f32
) {
    var idx: u32 = g.x() as u32;

    while idx < count {
        let v0 = s0[idx];
        let v1 = s1[idx];

        let cx = v0.x;
        let cy = v0.y;
        let cz = v0.z;
        let zval = v0.w;

        let gr = v1.x;
        let rz = v1.y;
        let flux = v1.z;
        let meta = v1.w as u32;
        let spec_v = (meta & 3u) as i32;
        let void_v = ((meta >> 2u) as f32) / 16383.0;

        let p_from = eval_manifold_pos(fromM, cx, cy, cz, zval, gr, rz);
        let p_to = eval_manifold_pos(toM, cx, cy, cz, zval, gr, rz);
        let p = mix(p_from, p_to, vec3<f32>(morph, morph, morph));

        let sp = project_point(p, camR, camU, camF, camT, width, height);
        if sp.z > 0.05 {
            let c_from = eval_manifold_col(fromM, zval, gr, flux, void_v, spec_v);
            let c_to = eval_manifold_col(toM, zval, gr, flux, void_v, spec_v);
            let base_c = mix(c_from, c_to, vec3<f32>(morph, morph, morph));

            let m_active = mask_active(mask, idx, hasMask);
            var bright: f32 = 1.0;
            var rmode: u32 = radiusMode;
            if zFocus > 0.0 && abs(zval - zFocus) < 0.08 {
                bright = 1.25;
            }
            if hasMask != 0u {
                if m_active > 0.5 {
                    bright *= 1.38;
                } else {
                    bright *= 0.06;
                    rmode = 0u;
                }
            }
            splat_pixel(accR, accG, accB, accC, sp.x, sp.y, width, height, base_c * bright, rmode);
        }

        idx += stride;
    }

    // Manifold 3: GPU-sculpted 64^3 inverted cosmic void bubbles emerging inside ghosted cosmic web
    if fromM == 3u || toM == 3u {
        var voidVis: f32 = 0.0;
        if fromM == 3u && toM == 3u {
            voidVis = 1.0;
        } else {
            if toM == 3u {
                voidVis = smoothstep(0.10, 0.95, morph);
            } else {
                voidVis = smoothstep(0.10, 0.95, 1.0 - morph);
            }
        }
        if voidVis > 0.01 {
            var vid: u32 = g.x() as u32;
            let voxStep: f32 = (2.0 * 2400.0) / 64.0;
            while vid < 262144u {
                let packed = volSculpt[vid];
                let hitsHalf = (packed >> 24u) & 15u;
                let ambQ = (packed >> 8u) & 255u;
                // Enclosed true cosmic void bubbles across cosmic web: emphasize curved void membranes
                if hitsHalf >= 5u && ambQ >= 8u {
                    let relDens = ((packed & 255u) as f32) / 127.5;
                    let effThresh = voidThresh * 0.50;
                    if relDens < effThresh {
                        let gradNorm = (((packed >> 16u) & 255u) as f32) / 255.0;
                        let vx = vid & 63u;
                        let vy = (vid >> 6u) & 63u;
                        let vz = (vid >> 12u) & 63u;

                        // 2-round avalanche integer hash eliminates 64^3 cubic grid lattice lines
                        var hv: u32 = vid ^ (vx * 374761393u) ^ (vy * 668265263u) ^ (vz * 2147483647u);
                        hv = (hv ^ (hv >> 15u)) * 2246822519u;
                        hv = (hv ^ (hv >> 13u)) * 3266489917u;
                        hv = hv ^ (hv >> 16u);

                        let emptiness = clamp((effThresh - relDens) / max(effThresh, 0.05), 0.0, 1.0);
                        let shell = clamp(gradNorm * gradNorm * 2.4 + 0.14, 0.14, 1.75);
                        let gBlend = clamp(gradNorm * 1.55, 0.0, 1.0);
                        let coreCol = vec3<f32>(0.10, 0.22, 0.95);
                        let edgeCol = vec3<f32>(0.16, 1.05, 1.38);
                        let vCol = mix(coreCol, edgeCol, vec3<f32>(gBlend, gBlend, gBlend));
                        let inten = emptiness * shell * voidGlow * voidVis * 1.45;

                        let jx = (((hv & 255u) as f32) / 255.0 - 0.5) * 0.95;
                        let jy = ((((hv >> 8u) & 255u) as f32) / 255.0 - 0.5) * 0.95;
                        let jz = ((((hv >> 16u) & 255u) as f32) / 255.0 - 0.5) * 0.95;
                        let cxv = -2400.0 + ((vx as f32) + 0.5 + jx) * voxStep;
                        let cyv = -2400.0 + ((vy as f32) + 0.5 + jy) * voxStep;
                        let czv = -2400.0 + ((vz as f32) + 0.5 + jz) * voxStep;
                        let vp = vec3<f32>(cxv * 0.0008, czv * 0.0008, cyv * 0.0008);
                        let sp = project_point(vp, camR, camU, camF, camT, width, height);
                        if sp.z > 0.05 {
                            splat_pixel(accR, accG, accB, accC, sp.x, sp.y, width, height, vCol * inten, 1u);
                        }
                    }
                }
                vid += stride;
            }
        }
    }
}
`;
