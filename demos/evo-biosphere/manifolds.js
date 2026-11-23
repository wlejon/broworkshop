// GPU manifolds, compute evolution kernels, & HDR atomic splatting shaders for Evolutionary Biosphere.
// Strictly uses f32/u32/i32 (no f64, no ternary ?:, <= 232B push constants per kernel).

export const MANIFOLDS = [
    {
        id: 0,
        short: '0 · 3D Habitat',
        name: '3D Ecological Reef Habitat',
        guide: '131,072 living organisms clustered across 8 thermal, abyssal, and canopy niches. Colors encode bitwise genomic traits (cyan=Biolum, red-amber=Thermo, silver=Armored, violet=Venom); spray Mutagen (XOR ^5) or drop an Asteroid directly onto any reef.',
        formula: '(x, y, z) · SpatialIndex("hab3d", cell=0.25)',
        preset: { yaw: 0.48, pitch: 0.34, dist: 3.05, target: [0.0, 0.0, 0.0] },
    },
    {
        id: 1,
        short: '1 · Phenotype Space',
        name: '3D Phenotype Adaptive Landscape',
        guide: 'Every organism plotted directly in continuous trait coordinates (gene_a × fitness × gene_b). High-fitness organisms rise into luminous adaptive peaks while mutating outliers fan out across the valley floor.',
        formula: '(gene_a · 0.72, (fitness − 0.45) · 2.1, gene_b · 0.72)',
        preset: { yaw: 0.62, pitch: 0.30, dist: 3.35, target: [0.0, 0.06, 0.0] },
    },
    {
        id: 2,
        short: '2 · Fitness Mountain',
        name: 'Radial Fitness Peak Cone',
        guide: 'A radial fitness mountain sorting organisms from low-fitness base skirts up to the sharp glowing apex, spun around the cylinder by genetic drift angle atan2(gene_b, gene_a).',
        formula: 'r = (1 − fitness) · 1.12 + 0.06, θ = atan2(gene_b, gene_a), y = (fitness − 0.38) · 2.1',
        preset: { yaw: 0.36, pitch: 0.32, dist: 3.15, target: [0.0, 0.10, 0.0] },
    },
    {
        id: 3,
        short: '3 · Phylogenetic Spire',
        name: 'Generation & Clade Spiral Spire',
        guide: 'A vertical evolutionary helix climbing by generation from primordial NULL-parent founders at the base ring up to newly evolved Speciation Burst lineages at the crown.',
        formula: 'θ = clade_id/32·2π + gen·0.18, r = 0.25 + clade_id/32·0.76, y = (gen/36 − 0.42)·2.1',
        preset: { yaw: 0.54, pitch: 0.26, dist: 3.25, target: [0.0, 0.08, 0.0] },
    },
];

// GPU compute kernels: pack table columns -> vec4 stores, evolve selection/fitness, & extract 4096-row chunks.
export const EVO_COMPUTE_SHADER = `
@kernel @grid(1)
fn k_pack_evo(g: grid<1>,
              x: read_store<f32, 1>, y: read_store<f32, 1>,
              z: read_store<f32, 1>, fitness: read_store<f32, 1>,
              geneA: read_store<f32, 1>, geneB: read_store<f32, 1>,
              traits: read_store<u32, 1>, cladeId: read_store<i32, 1>,
              nicheId: read_store<i32, 1>, generation: read_store<i32, 1>,
              s0: write_store<vec4<f32>, 1>, s1: write_store<vec4<f32>, 1>,
              count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        s0[i] = vec4<f32>(x[i], y[i], z[i], fitness[i]);
        let tm = traits[i] & 1023u;
        let gen = (clamp(generation[i], 0, 4095) as u32) << 10u;
        let cl = max(cladeId[i], 0) as u32;
        let ni = (max(nicheId[i], 0) as u32) & 15u;
        s1[i] = vec4<f32>(geneA[i], geneB[i], (tm | gen) as f32, (cl * 16u + ni) as f32);
        i += stride;
    }
}

@kernel @grid(1)
fn k_step_evo(g: grid<1>,
              s0: rw_store<vec4<f32>, 1>,
              s1: rw_store<vec4<f32>, 1>,
              cladeOpt: read_store<vec4<f32>, 1>,
              count: u32, stride: u32,
              dt: f32, time: f32, selPressure: f32, driftAmp: f32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let v0 = s0[i];
        let v1 = s1[i];
        let cn = v1.w as u32;
        let clade = min(cn >> 4u, 31u);
        let opt = cladeOpt[clade];

        let tg = v1.z as u32;
        let traits = tg & 1023u;

        let fi = i as f32;
        let driftA = sin(fi * 0.037 + time * 1.15) * driftAmp;
        let driftB = cos(fi * 0.053 - time * 0.95) * driftAmp;
        let pull = clamp(dt * selPressure * 0.14, 0.0, 0.25);

        let ga = clamp(v1.x + (opt.x - v1.x) * pull + driftA * dt, -2.15, 2.15);
        let gb = clamp(v1.y + (opt.y - v1.y) * pull + driftB * dt, -2.15, 2.15);

        let da = ga - opt.x;
        let db = gb - opt.y;
        let d2 = da * da + db * db;

        var traitBonus: f32 = 0.0;
        if (traits & 1u) != 0u { traitBonus += 0.03; }
        if (traits & 32u) != 0u { traitBonus += 0.04; }
        if (traits & 4u) != 0u { traitBonus += 0.02; }

        var nFit: f32 = clamp(exp(-d2 * 0.65) * 0.88 + traitBonus + 0.04, 0.04, 1.0);
        if opt.z > 0.5 {
            nFit *= 0.45;
        }

        // Gentle bounded ecological respiration around each organism's niche anchor
        let phase = fi * 0.019;
        let amp = 0.042 * dt * (0.45 + 0.55 * nFit);
        let nx = clamp(v0.x + cos(time * 1.25 + phase) * amp, -1.48, 1.48);
        let ny = clamp(v0.y + sin(time * 1.65 + phase * 1.3) * amp * 0.8, -1.38, 1.38);
        let nz = clamp(v0.z + sin(time * 1.10 - phase) * amp, -1.48, 1.48);

        s0[i] = vec4<f32>(nx, ny, nz, nFit);
        s1[i] = vec4<f32>(ga, gb, v1.z, v1.w);
        i += stride;
    }
}

@kernel @grid(1)
fn k_extract_chunk_cols(g: grid<1>,
                        s0: read_store<vec4<f32>, 1>,
                        s1: read_store<vec4<f32>, 1>,
                        outX: write_store<f32, 1>,
                        outY: write_store<f32, 1>,
                        outZ: write_store<f32, 1>,
                        outFit: write_store<f32, 1>,
                        outGa: write_store<f32, 1>,
                        outGb: write_store<f32, 1>,
                        baseOffset: u32, chunkRows: u32) {
    let r = g.x() as u32;
    if r < chunkRows {
        let v0 = s0[baseOffset + r];
        let v1 = s1[baseOffset + r];
        outX[r] = v0.x;
        outY[r] = v0.y;
        outZ[r] = v0.z;
        outFit[r] = v0.w;
        outGa[r] = v1.x;
        outGb[r] = v1.y;
    }
}
`;

export const EVO_SPLAT_SHADER = `
import sci::splat::*;

const TAU: f32 = 6.283185;

fn safe_atan2(y: f32, x: f32) -> f32 {
    if abs(x) < 1e-5 && abs(y) < 1e-5 {
        return 0.0;
    }
    return atan2(y, x);
}

fn eval_evo_pos(m: u32,
                px: f32, py: f32, pz: f32, fit: f32,
                ga: f32, gb: f32, gen: f32, clade: f32) -> vec3<f32> {
    if m == 0u {
        return vec3<f32>(px, py, pz);
    }
    if m == 1u {
        return vec3<f32>(
            ga * 0.72,
            (clamp(fit, 0.0, 1.0) - 0.45) * 2.1,
            gb * 0.72
        );
    }
    if m == 2u {
        let f = clamp(fit, 0.0, 1.0);
        let theta = safe_atan2(gb, ga) + (clade / 32.0) * 0.42;
        let r = (1.0 - f) * 1.12 + 0.06;
        let yCone = (f - 0.38) * 2.1;
        return vec3<f32>(cos(theta) * r, yCone, sin(theta) * r);
    }
    // Manifold 3: Phylogenetic Spire
    let ang = (clade / 32.0) * TAU + gen * 0.18 + ga * 0.22;
    let rad = 0.25 + (clade / 32.0) * 0.76 + (1.0 - clamp(fit, 0.0, 1.0)) * 0.16;
    let ySpire = (clamp(gen, 0.0, 36.0) / 36.0 - 0.42) * 2.1;
    return vec3<f32>(cos(ang) * rad, ySpire, sin(ang) * rad);
}

fn eval_evo_col(m: u32, fit: f32, traits: u32, clade: f32, niche: f32) -> vec3<f32> {
    let f = clamp(fit, 0.0, 1.0);
    let phyIdx = (clade as u32) % 6u;
    var baseCol: vec3<f32> = vec3<f32>(0.25, 0.78, 1.05);
    if phyIdx == 1u {
        baseCol = vec3<f32>(1.15, 0.42, 0.20);
    } else if phyIdx == 2u {
        baseCol = vec3<f32>(0.58, 0.72, 0.98);
    } else if phyIdx == 3u {
        baseCol = vec3<f32>(0.42, 1.05, 0.48);
    } else if phyIdx == 4u {
        baseCol = vec3<f32>(0.88, 0.34, 1.12);
    } else if phyIdx == 5u {
        baseCol = vec3<f32>(1.12, 0.86, 0.26);
    }

    // Bitwise traits_mask accent modulation so XOR mutations visibly shift coloration
    if (traits & 1u) != 0u {
        baseCol = mix(baseCol, vec3<f32>(0.22, 0.94, 1.25), vec3<f32>(0.38, 0.38, 0.38));
    }
    if (traits & 2u) != 0u {
        baseCol = mix(baseCol, vec3<f32>(1.28, 0.40, 0.18), vec3<f32>(0.36, 0.36, 0.36));
    }
    if (traits & 4u) != 0u {
        baseCol = mix(baseCol, vec3<f32>(0.68, 0.80, 1.04), vec3<f32>(0.28, 0.28, 0.28));
    }
    if (traits & 16u) != 0u {
        baseCol = mix(baseCol, vec3<f32>(0.92, 0.30, 1.22), vec3<f32>(0.30, 0.30, 0.30));
    }

    if m == 2u {
        let peakCol = plasma_rgb(f);
        baseCol = mix(baseCol, peakCol, vec3<f32>(0.48, 0.48, 0.48));
    } else if m == 1u {
        let nicheTint = blackbody_rgb(clamp(niche / 7.0, 0.0, 1.0));
        baseCol = mix(baseCol, nicheTint, vec3<f32>(0.25, 0.25, 0.25));
    }

    let gain = 0.14 + 0.38 * smoothstep(0.08, 0.96, f);
    return baseCol * gain;
}

// Total push constants: 7 ptrs (56B) + 4 u32 (16B) + 8B pad + 4 vec4 (64B) + 6 scalars (24B) = 168B <= 232B.
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
    hasMask: u32, radiusMode: u32, time: f32
) {
    var idx: u32 = g.x() as u32;
    while idx < count {
        let v0 = s0[idx];
        let v1 = s1[idx];

        let px = v0.x;
        let py = v0.y;
        let pz = v0.z;
        let fit = v0.w;

        let ga = v1.x;
        let gb = v1.y;
        let tg = v1.z as u32;
        let traits = tg & 1023u;
        let gen = (tg >> 10u) as f32;
        let cn = v1.w as u32;
        let clade = (cn >> 4u) as f32;
        let niche = (cn & 15u) as f32;

        var pos: vec3<f32> = vec3<f32>(px, py, pz);
        if fromM == toM || morph >= 0.999 {
            pos = eval_evo_pos(toM, px, py, pz, fit, ga, gb, gen, clade);
        } else {
            let p0 = eval_evo_pos(fromM, px, py, pz, fit, ga, gb, gen, clade);
            let p1 = eval_evo_pos(toM, px, py, pz, fit, ga, gb, gen, clade);
            pos = mix(p0, p1, vec3<f32>(morph, morph, morph));
        }

        let sp = project_point(pos, camR, camU, camF, camT, width, height);
        if sp.z > 0.05 {
            var col = eval_evo_col(toM, fit, traits, clade, niche);
            if fromM != toM && morph < 0.999 {
                let c0 = eval_evo_col(fromM, fit, traits, clade, niche);
                col = mix(c0, col, vec3<f32>(morph, morph, morph));
            }

            let mAct = mask_active(mask, idx, hasMask);
            var bright: f32 = 1.0;
            var rMode: u32 = radiusMode;
            if hasMask != 0u {
                if mAct > 0.5 {
                    bright = 1.65;
                    rMode = 1u;
                } else {
                    bright = 0.055;
                    rMode = 0u;
                }
            }

            splat_pixel(accR, accG, accB, accC, sp.x, sp.y, width, height, col * bright, rMode);
        }
        idx += stride;
    }
}
`;
