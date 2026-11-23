// GPU manifold shader + camera presets for Gaia DR3 6D Phase-Space Observatory.
// Packs bro.table GPU KernelBuffers into coalesced vec4<f32> stores (s0, s1, s2) so
// k_splat fits well within Vulkan's 256-byte push-constant budget while streaming coalesced reads.

export const MANIFOLDS = [
    {
        id: 0,
        name: '3D Galactic Disk',
        short: '0 · Galactic Disk',
        guide: 'Each dot is a real star measured by ESA Gaia. Hot young stars trace bright spiral arms around our Sun; scrub Epoch (Myr) to rewind or fast-forward their orbits through the Milky Way.',
        formula: '(gx, gz, gy) · 0.14 kpc⁻¹ · 6-step Milky Way orbital integrator',
        preset: { yaw: 0.45, pitch: 0.56, dist: 3.15, target: [-0.22, 0.0, 0.0] },
    },
    {
        id: 1,
        name: '3D HR Evolutionary Relief',
        short: '1 · 3D HR Diagram',
        guide: 'Stars sorted by surface temperature (blue-left to red-right) and true brightness (bright-up to faint-down), extruded into depth by heavy-element richness [Fe/H] to separate giants, dwarfs, and white dwarfs.',
        formula: '((BP−RP − 1.1)·0.85, (4.5 − M_G)·0.18, ([Fe/H] + 0.5)·0.7)',
        preset: { yaw: 0.20, pitch: 0.14, dist: 2.85, target: [0.08, -0.05, -0.05] },
    },
    {
        id: 2,
        name: 'Toomre Galactic Archaeology',
        short: '2 · Toomre Streams',
        guide: 'Orbital velocity fingerprint: fast disk stars (~232 km/s) orbit together on the left, while scattered high-speed streamers near v_φ ≈ 0 are ancient debris from a swallowed dwarf galaxy (Gaia-Sausage-Enceladus).',
        formula: '((v_φ − 150)/140, (v_⊥ − 90)/110, [Fe/H]·0.55)',
        preset: { yaw: 0.22, pitch: 0.18, dist: 2.85, target: [-0.15, 0.12, -0.15] },
    },
    {
        id: 3,
        name: 'Vertical Phase-Space Snail',
        short: '3 · Vertical Snail',
        guide: 'A giant spiral wave in disk height (z) vs vertical speed (v_z) — gravitational ringing left behind hundreds of millions of years ago when the Sagittarius dwarf galaxy plunged through the Milky Way.',
        formula: '(z·0.8, v_z/65, (R − 8.1)·0.25) · Sgr Dwarf tidal spiral',
        preset: { yaw: 0.16, pitch: 0.08, dist: 2.35, target: [0.0, 0.0, 0.0] },
    },
];

export const GAIA_PACK_SHADER = `
@kernel @grid(1)
fn k_pack4(g: grid<1>,
           c0: read_store<f32, 1>, c1: read_store<f32, 1>,
           c2: read_store<f32, 1>, c3: read_store<f32, 1>,
           out: write_store<vec4<f32>, 1>, count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        out[i] = vec4<f32>(c0[i], c1[i], c2[i], c3[i]);
        i += stride;
    }
}

@kernel @grid(1)
fn k_pack_phot(g: grid<1>,
               v_phi: read_store<f32, 1>, v_perp: read_store<f32, 1>,
               bp_rp: read_store<f32, 1>, teff: read_store<f32, 1>,
               pop: read_store<i32, 1>,
               out: write_store<vec4<f32>, 1>, count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let t_int = floor(clamp(teff[i], 1000.0, 50000.0));
        let p_int = clamp(pop[i], 0, 7) as f32;
        out[i] = vec4<f32>(v_phi[i], v_perp[i], bp_rp[i], t_int * 8.0 + p_int);
        i += stride;
    }
}
`;

export const GAIA_SHADER = `
import sci::splat::*;

// Converts km/s to kpc/Myr: 1 km/s = 0.001022712 kpc/Myr
const KM_S_TO_KPC_MYR: f32 = 0.0010227;
// Characteristic Milky Way circular speed squared: (232 * 0.0010227)^2
const V0_SQ: f32 = 0.056298;

fn eval_manifold_pos(m: u32,
                     gx0: f32, gy0: f32, gz0: f32, vz0: f32,
                     gx_t: f32, gy_t: f32, gz_t: f32,
                     vp: f32, vpp: f32,
                     bprp: f32, mgv: f32, feh: f32) -> vec3<f32> {
    if m == 0u {
        return vec3<f32>(gx_t * 0.14, gz_t * 0.14, gy_t * 0.14);
    }
    if m == 1u {
        return vec3<f32>((bprp - 1.1) * 0.85, (4.5 - mgv) * 0.18, (feh + 0.5) * 0.7);
    }
    if m == 2u {
        let fh = clamp(feh, -2.5, 0.6);
        return vec3<f32>((vp - 150.0) / 140.0, (vpp - 90.0) / 110.0, fh * 0.55);
    }
    let r_xy = sqrt(gx0 * gx0 + gy0 * gy0);
    return vec3<f32>(gz0 * 0.8, vz0 / 65.0, (r_xy - 8.1) * 0.25);
}

fn eval_manifold_col(m: u32,
                     bprp: f32, mgv: f32, feh: f32, teff_v: f32,
                     vp: f32, vpp: f32, pop_v: i32) -> vec3<f32> {
    let bb = blackbody_rgb((bprp - 0.1) / 2.6);
    let hot = clamp((teff_v - 7000.0) / 14000.0, 0.0, 0.35);
    let lum = clamp(1.18 - 0.055 * mgv, 0.45, 1.85);
    let base_col = (bb + vec3<f32>(hot * 0.3, hot * 0.45, hot * 0.9)) * lum;

    if m == 0u {
        if pop_v == 3 {
            return base_col * 1.25 + vec3<f32>(0.05, 0.14, 0.22);
        }
        return base_col;
    }
    if m == 1u {
        return base_col * 1.05;
    }
    if m == 2u {
        let kin = plasma_rgb(clamp((vpp - 25.0) / 230.0, 0.0, 1.0));
        let metal_boost = clamp((-feh - 0.3) * 0.4, 0.0, 0.45);
        let blended = mix(base_col * 0.85, kin * 1.12, vec3<f32>(0.68, 0.68, 0.68));
        if pop_v == 2 {
            return blended * (1.15 + metal_boost);
        }
        return blended;
    }
    let snail = thermal_div_rgb(clamp((vp - 218.0) / 38.0, -1.0, 1.0));
    return mix(base_col * 0.42, snail * 0.75, vec3<f32>(0.82, 0.82, 0.82));
}

fn mw_accel(px: f32, py: f32, pz: f32) -> vec3<f32> {
    let r2 = px * px + py * py;
    let inv_d = 1.0 / (r2 + 0.85);
    let ax = -V0_SQ * px * inv_d;
    let ay = -V0_SQ * py * inv_d;
    let r_xy = sqrt(r2);
    let hz_scale = exp(clamp((8.122 - r_xy) * 0.10, -1.2, 1.4));
    let kz = 0.0072 * hz_scale / (1.0 + 0.45 * pz * pz);
    let az = -kz * pz;
    return vec3<f32>(ax, ay, az);
}

// Coalesced vec4 stores:
//   s0 = (gx, gy, gz, mg)
//   s1 = (vx, vy, vz, fe_h)
//   s2 = (v_phi, v_perp, bp_rp, floor(teff) * 8 + pop)
@kernel @grid(1)
fn k_splat(
    g: grid<1>,
    accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
    accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
    s0: read_store<vec4<f32>, 1>,
    s1: read_store<vec4<f32>, 1>,
    s2: read_store<vec4<f32>, 1>,
    mask: read_store<u32, 1>,
    count: u32, stride: u32, width: u32, height: u32,
    camR: vec4<f32>, camU: vec4<f32>, camF: vec4<f32>, camT: vec4<f32>,
    fromM: u32, toM: u32, morph: f32,
    hasMask: u32, radiusMode: u32, timeMyr: f32
) {
    var idx: u32 = g.x() as u32;
    let need_orbit = (fromM == 0u || toM == 0u) && abs(timeMyr) > 0.005;
    let dt = timeMyr / 6.0;

    while idx < count {
        let v0 = s0[idx];
        let v1 = s1[idx];
        let v2 = s2[idx];

        let gx0 = v0.x;
        let gy0 = v0.y;
        let gz0 = v0.z;
        let mgv = v0.w;

        let vz0 = v1.z;
        let feh = v1.w;

        let vp = v2.x;
        let vpp = v2.y;
        let bprp = v2.z;
        let tp_code = v2.w as u32;
        let pop_v = (tp_code & 7u) as i32;
        let teff_v = (tp_code >> 3u) as f32;

        var px = gx0;
        var py = gy0;
        var pz = gz0;

        if need_orbit {
            var pvx = v1.x * KM_S_TO_KPC_MYR;
            var pvy = v1.y * KM_S_TO_KPC_MYR;
            var pvz = vz0 * KM_S_TO_KPC_MYR;
            var a = mw_accel(px, py, pz);
            var step: i32 = 0;
            while step < 6 {
                let hdt = 0.5 * dt;
                pvx += a.x * hdt;
                pvy += a.y * hdt;
                pvz += a.z * hdt;
                px += pvx * dt;
                py += pvy * dt;
                pz += pvz * dt;
                a = mw_accel(px, py, pz);
                pvx += a.x * hdt;
                pvy += a.y * hdt;
                pvz += a.z * hdt;
                step += 1;
            }
        }

        let p_from = eval_manifold_pos(fromM, gx0, gy0, gz0, vz0, px, py, pz, vp, vpp, bprp, mgv, feh);
        let p_to = eval_manifold_pos(toM, gx0, gy0, gz0, vz0, px, py, pz, vp, vpp, bprp, mgv, feh);
        let p = mix(p_from, p_to, vec3<f32>(morph, morph, morph));

        let sp = project_point(p, camR, camU, camF, camT, width, height);
        if sp.z > 0.05 {
            let c_from = eval_manifold_col(fromM, bprp, mgv, feh, teff_v, vp, vpp, pop_v);
            let c_to = eval_manifold_col(toM, bprp, mgv, feh, teff_v, vp, vpp, pop_v);
            let base_c = mix(c_from, c_to, vec3<f32>(morph, morph, morph));

            let m_active = mask_active(mask, idx, hasMask);
            var bright: f32 = 1.0;
            var rmode: u32 = radiusMode;
            if hasMask != 0u {
                if m_active > 0.5 {
                    bright = 1.35;
                } else {
                    bright = 0.06;
                    rmode = 0u;
                }
            }

            splat_pixel(accR, accG, accB, accC, sp.x, sp.y, width, height, base_c * bright, rmode);
        }

        idx += stride;
    }
}
`;
