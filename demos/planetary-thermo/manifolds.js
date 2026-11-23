// GPU manifold shaders + camera presets for Planetary Thermodynamic Memory.
// Packs bro.table GPU KernelBuffers once on GPU via k_pack4 + k_pack_state into
// 2 vec4<f32> buffers (s0, s1) so k_splat uses only 7 buffer pointers (~172B push constants,
// well below Vulkan's 256-byte limit).

export const MANIFOLDS = [
    {
        id: 0,
        name: '3D Planetary Thermodynamic Shell',
        short: '0 · Earth Shell',
        guide: 'Real weather stations wrapped around Earth by temperature departure from the 1951–80 norm: cold waves indent icy blue, while heat domes bulge amber/crimson — especially across the fast-warming Arctic.',
        formula: '(ex, ey, ez) · (1 + clamp(anom_c, −12, 12) · 0.015)',
        preset: { yaw: 1.85, pitch: 0.42, dist: 2.58, target: [0.0, 0.0, 0.0] },
    },
    {
        id: 1,
        name: '125-Year Seasonal Climate Helix',
        short: '1 · Climate Helix',
        guide: 'A 3D corkscrew through time: each coil is one calendar year rising from 1900 at the cool blue base to the flaring amber/crimson 2020s rim at the top, with winter/summer wrapped around the circle.',
        formula: 'r = 0.72 + anom_c·0.035, θ = DOY/365.25·2π, y = ((year−1900)/125 − 0.5)·2.2',
        preset: { yaw: 0.42, pitch: 0.38, dist: 3.10, target: [0.0, 0.0, 0.0] },
    },
    {
        id: 2,
        name: 'Thermodynamic State Phase-Space',
        short: '2 · Phase-Space',
        guide: 'Every station-day plotted by daily low temp vs daily high temp across Earth latitudes — revealing Polar cold tails (bottom-left), Temperate swing zones, and Tropical warmth (top-right).',
        formula: '((Tmin − 5)·0.035, (Tmax − 15)·0.035, lat / 55)',
        preset: { yaw: 0.58, pitch: 0.28, dist: 3.45, target: [-0.22, -0.22, 0.0] },
    },
    {
        id: 3,
        name: 'Hovmöller Latitude × Century Wavefront',
        short: '3 · Hovmöller',
        guide: 'Earth latitudes stacked front-to-back against 125 years left-to-right, showing the cooling early century shifting into global warming and acute Arctic Amplification along the northern edge.',
        formula: '(((year − 1900)/125 − 0.5)·2.4, clamp(anom_c, −12, 12)·0.08, (lat/90)·1.1)',
        preset: { yaw: 0.35, pitch: 0.36, dist: 3.15, target: [0.0, 0.04, 0.0] },
    },
];

export const THERMO_PACK_SHADER = `
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
fn k_pack_state(g: grid<1>,
                year: read_store<i32, 1>, doy: read_store<i32, 1>,
                tmin: read_store<f32, 1>, tmax: read_store<f32, 1>,
                lat: read_store<f32, 1>,
                out: write_store<vec4<f32>, 1>, count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let y_off = clamp(year[i] - 1900, 0, 255) as u32;
        let d_val = clamp(doy[i], 1, 366) as u32;
        let packed_yd = ((y_off << 9u) | d_val) as f32;
        out[i] = vec4<f32>(packed_yd, tmin[i], tmax[i], lat[i]);
        i += stride;
    }
}
`;

export const THERMO_SHADER = `
import sci::splat::*;

const TAU: f32 = 6.283185;

fn eval_manifold_pos(m: u32,
                     ex: f32, ey: f32, ez: f32, anom_c: f32,
                     year_norm: f32, doy_f: f32,
                     tmin_c: f32, tmax_c: f32, lat_deg: f32) -> vec3<f32> {
    if m == 0u {
        let r = 1.0 + clamp(anom_c, -12.0, 12.0) * 0.015;
        return vec3<f32>(ex * r, ey * r, ez * r);
    }
    let cont_year = year_norm + (doy_f / 365.25) / 125.0;
    if m == 1u {
        let angle = (doy_f / 365.25) * TAU;
        let y_helix = (cont_year - 0.5) * 2.2;
        let radius = max(0.18, 0.72 + clamp(anom_c, -12.0, 12.0) * 0.035);
        return vec3<f32>(cos(angle) * radius, y_helix, sin(angle) * radius);
    }
    if m == 2u {
        return vec3<f32>(
            (tmin_c - 5.0) * 0.035,
            (tmax_c - 15.0) * 0.035,
            lat_deg / 55.0
        );
    }
    return vec3<f32>(
        (cont_year - 0.5) * 2.4,
        clamp(anom_c, -12.0, 12.0) * 0.08,
        (lat_deg / 90.0) * 1.1
    );
}

fn eval_manifold_col(m: u32,
                     anom_c: f32, year_norm: f32,
                     lat_deg: f32, tmax_c: f32) -> vec3<f32> {
    let div_col = thermal_div_rgb(anom_c / 5.2);
    let abs_a = abs(anom_c);
    let energy = 0.16 + 0.46 * smoothstep(0.4, 5.2, abs_a);

    if m == 0u {
        let arctic_boost = 1.0 + 0.40 * smoothstep(55.0, 80.0, lat_deg) * smoothstep(0.4, 3.8, anom_c);
        return div_col * (energy * arctic_boost);
    }
    if m == 1u {
        let era_col = plasma_rgb(clamp(year_norm, 0.0, 1.0));
        let blended = mix(div_col, era_col, vec3<f32>(0.20, 0.20, 0.20));
        return blended * (energy * 1.05);
    }
    if m == 2u {
        let regime = blackbody_rgb(clamp(1.0 - (tmax_c + 32.0) / 78.0, 0.0, 1.0));
        return mix(div_col, regime, vec3<f32>(0.34, 0.34, 0.34)) * (0.14 + 0.40 * smoothstep(0.4, 5.0, abs_a));
    }
    let polar_glow = 1.0 + 0.38 * smoothstep(50.0, 82.0, lat_deg) * smoothstep(0.4, 3.6, anom_c);
    return div_col * (energy * 1.12 * polar_glow);
}

// Coalesced vec4 stores:
//   s0 = (ex, ey, ez, anom_c)
//   s1 = (packed(year, doy), tmin_c, tmax_c, lat)
// Total push constants: 7 pointers (56B) + 4 u32 (16B) + pad (8B) + 4 vec4 (64B) + 7 scalars (28B) = 172B <= 256B.
@kernel @grid(1)
fn k_splat(
    g: grid<1>,
    accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
    accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
    s0: read_store<vec4<f32>, 1>,
    s1: read_store<vec4<f32>, 1>,
    mask: read_store<u32, 1>,
    count: u32, stride: u32, width: u32, height: u32,
    camR: vec4<f32>, camU: vec4<f32>, camF: vec4<f32>, camT: vec4<f32>,
    fromM: u32, toM: u32, morph: f32,
    hasMask: u32, radiusMode: u32, yearLo: f32, yearHi: f32
) {
    var idx: u32 = g.x() as u32;
    let scrubbing = (yearLo > 1900.5) || (yearHi < 2024.5);

    while idx < count {
        let v0 = s0[idx];
        let v1 = s1[idx];

        let ex = v0.x;
        let ey = v0.y;
        let ez = v0.z;
        let anom_c = v0.w;

        let yd = v1.x as u32;
        let y_off = (yd >> 9u) as f32;
        let doy_f = (yd & 511u) as f32;
        let year_f = 1900.0 + y_off;
        let year_norm = y_off / 125.0;

        let tmin_c = v1.y;
        let tmax_c = v1.z;
        let lat_deg = v1.w;

        var p: vec3<f32> = vec3<f32>(ex, ey, ez);
        if fromM == toM || morph >= 0.999 {
            p = eval_manifold_pos(toM, ex, ey, ez, anom_c, year_norm, doy_f, tmin_c, tmax_c, lat_deg);
        } else {
            let p_from = eval_manifold_pos(fromM, ex, ey, ez, anom_c, year_norm, doy_f, tmin_c, tmax_c, lat_deg);
            let p_to = eval_manifold_pos(toM, ex, ey, ez, anom_c, year_norm, doy_f, tmin_c, tmax_c, lat_deg);
            p = mix(p_from, p_to, vec3<f32>(morph, morph, morph));
        }

        let sp = project_point(p, camR, camU, camF, camT, width, height);
        if sp.z > 0.05 {
            var base_c: vec3<f32> = vec3<f32>(0.5, 0.5, 0.5);
            if fromM == toM || morph >= 0.999 {
                base_c = eval_manifold_col(toM, anom_c, year_norm, lat_deg, tmax_c);
            } else {
                let c_from = eval_manifold_col(fromM, anom_c, year_norm, lat_deg, tmax_c);
                let c_to = eval_manifold_col(toM, anom_c, year_norm, lat_deg, tmax_c);
                base_c = mix(c_from, c_to, vec3<f32>(morph, morph, morph));
            }

            let m_active = mask_active(mask, idx, hasMask);
            let in_year = (year_f >= yearLo - 0.1) && (year_f <= yearHi + 0.1);
            var active_pt = m_active > 0.5;
            if !in_year {
                active_pt = false;
            }

            var bright: f32 = 1.0;
            var rmode: u32 = radiusMode;
            if hasMask != 0u || scrubbing {
                if active_pt {
                    bright = 1.55;
                } else {
                    bright = 0.045;
                    rmode = 0u;
                }
            }

            splat_pixel(accR, accG, accB, accC, sp.x, sp.y, width, height, base_c * bright, rmode);
        }

        idx += stride;
    }
}
`;
