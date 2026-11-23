// 4 ecological manifolds, GPU compute advection/pack/extract kernels, and balanced HDR splat shader
// for Living Biosphere. All kernels adhere strictly to bro.kernel rules: no f64, no ternaries (?:),
// grid-stride loops, and push constants <= 232 bytes.

export const MANIFOLDS = [
    {
        id: 0,
        name: '3D Biosphere',
        short: '0 · 3D Biosphere',
        guide: 'What You\'re Seeing: 131,072 living organisms orbiting 64 coral reefs, hydrothermal vents, pelagic gyres, and abyssal trenches. GPU currents continuously advect swarms and exchange metabolic energy.',
        formula: '(x, y, z) ← Vulkan curl advection + restoring habitat spring · Color: trophic guild & critical stress',
        preset: { yaw: 0.52, pitch: 0.34, dist: 2.85, target: [0.0, -0.04, 0.0] },
    },
    {
        id: 1,
        name: 'Trophic Pyramid',
        short: '1 · Trophic Pyramid',
        guide: 'What You\'re Seeing: Organisms stratified into 4 ecological pyramid tiers — wide cyan Producer base, middle Grazer ring, upper amber Predator tier, and violet Decomposer crown.',
        formula: 'y = tier(role) · r = pyramidRadius(role, energy) · θ = species_sector + energy swirl',
        preset: { yaw: 0.38, pitch: 0.24, dist: 2.75, target: [0.0, 0.0, 0.0] },
    },
    {
        id: 2,
        name: 'Energy × Stress Phase',
        short: '2 · Energy × Stress',
        guide: 'What You\'re Seeing: Thermodynamic phase space plotting Energy (left→right), Stress (bottom→top), and Nutrient depth. Crimson particles above the threshold line trigger ReactiveQuery critical alerts.',
        formula: '(energy·1.15 − 0.95, stress·1.45 − 0.78, nutrient·1.35 − 0.68)',
        preset: { yaw: 0.28, pitch: 0.16, dist: 2.75, target: [0.0, 0.0, 0.0] },
    },
    {
        id: 3,
        name: 'Metabolic Helix',
        short: '3 · Metabolic Helix',
        guide: 'What You\'re Seeing: Helical life-cycle manifold mapping organism Age vertically and around the spiral while Energy expands the radial envelope across all 12 trophic species.',
        formula: 'θ = age·0.68 + species·0.52 · r = 0.44 + energy·0.36 · y = (age − 3.5)·0.24 + guild_offset',
        preset: { yaw: 0.44, pitch: 0.22, dist: 2.75, target: [0.0, 0.0, 0.0] },
    },
];

export function evalOrganismManifold(m, row) {
    if (m === 0) {
        return [row.x, row.y, row.z];
    }
    const sp = row.species_id | 0;
    const role = Math.min(3, Math.max(0, Math.floor(sp / 3)));
    const eClamped = Math.max(0.0, Math.min(1.8, row.energy));
    if (m === 1) {
        const tierY = -0.74 + role * 0.49 + ((row.stress - 0.5) * 0.10);
        const baseR = 0.96 - role * 0.23;
        const rad = Math.max(0.12, baseR * (0.62 + 0.38 * Math.min(1.2, eClamped)));
        const spInRole = sp - role * 3;
        const ang = (spInRole * 2.0944) + row.x * 1.15 + row.z * 0.95 + role * 0.45;
        return [Math.cos(ang) * rad, tierY, Math.sin(ang) * rad];
    }
    if (m === 2) {
        const px = eClamped * 1.15 - 0.95;
        const py = Math.max(0.0, Math.min(1.15, row.stress)) * 1.45 - 0.78;
        const pz = Math.max(0.0, Math.min(1.2, row.nutrient)) * 1.35 - 0.68;
        return [px, py, pz];
    }
    const age = Math.max(0.0, Math.min(7.5, row.age));
    const theta = age * 0.68 + sp * 0.5236;
    const rad = 0.44 + eClamped * 0.36 + 0.07 * Math.sin(age * 1.7 + role * 1.57);
    const hy = Math.max(-0.98, Math.min(0.98, (age - 3.5) * 0.24 + (role - 1.5) * 0.12));
    return [Math.cos(theta) * rad, hy, Math.sin(theta) * rad];
}

export const ECO_COMPUTE_SHADER = `
fn role_from_species(sp: i32) -> i32 {
    if sp < 3 {
        return 0;
    }
    if sp < 6 {
        return 1;
    }
    if sp < 9 {
        return 2;
    }
    return 3;
}

// Packs 8 bro.table columns into coalesced GPU vec4 stores:
//   basePos = (x, y, z, species_id)
//   s0      = (x, y, z, energy)
//   s1      = (stress, nutrient, age, species_id * 16 + role)
@kernel @grid(1)
fn k_pack_eco(g: grid<1>,
              x: read_store<f32, 1>, y: read_store<f32, 1>, z: read_store<f32, 1>,
              energy: read_store<f32, 1>, stress: read_store<f32, 1>,
              nutrient: read_store<f32, 1>, age: read_store<f32, 1>,
              species_id: read_store<i32, 1>,
              basePos: write_store<vec4<f32>, 1>,
              s0: write_store<vec4<f32>, 1>,
              s1: write_store<vec4<f32>, 1>,
              count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let sp = clamp(species_id[i], 0, 11);
        let role = role_from_species(sp);
        let px = x[i];
        let py = y[i];
        let pz = z[i];
        basePos[i] = vec4<f32>(px, py, pz, sp as f32);
        s0[i] = vec4<f32>(px, py, pz, energy[i]);
        s1[i] = vec4<f32>(stress[i], nutrient[i], age[i], (sp * 16 + role) as f32);
        i += stride;
    }
}

// Syncs energy and stress from bro.table back into live s0/s1 after spatial brush updates.
@kernel @grid(1)
fn k_sync_es(g: grid<1>,
             energy: read_store<f32, 1>, stress: read_store<f32, 1>,
             s0: rw_store<vec4<f32>, 1>, s1: rw_store<vec4<f32>, 1>,
             count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let v0 = s0[i];
        let v1 = s1[i];
        s0[i] = vec4<f32>(v0.x, v0.y, v0.z, energy[i]);
        s1[i] = vec4<f32>(stress[i], v1.y, v1.z, v1.w);
        i += stride;
    }
}

// Advances GPU fluid curl advection around each reef/plume anchor + metabolic energy/stress exchange.
@kernel @grid(1)
fn k_step_eco(g: grid<1>,
              basePos: read_store<vec4<f32>, 1>,
              s0: rw_store<vec4<f32>, 1>,
              s1: rw_store<vec4<f32>, 1>,
              count: u32, stride: u32,
              dt: f32, timeSec: f32, flowAmp: f32, metabRate: f32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let bp = basePos[i];
        let rest = bp.xyz;
        let v0 = s0[i];
        let v1 = s1[i];

        let pos = v0.xyz;
        var energy: f32 = v0.w;
        var stress: f32 = v1.x;
        var nutrient: f32 = v1.y;
        var age: f32 = v1.z;
        let spRole = (v1.w + 0.5) as u32;
        let role = (spRole & 15u) as i32;

        // Spring-bounded divergence-free oceanic current around SpatialIndex habitat rest position
        let disp = pos - rest;
        let curl = vec3<f32>(
            sin(rest.y * 5.2 + timeSec * 1.15) * 0.085 - rest.z * 0.045,
            cos(rest.z * 5.4 - timeSec * 0.92) * 0.060,
            cos(rest.x * 5.2 + timeSec * 1.05) * 0.085 + rest.x * 0.045
        );
        let nextPos = pos + (curl - disp * 1.55) * (dt * flowAmp);

        // Metabolic exchange & environmental current wave
        let envWave = 0.5 + 0.5 * sin(rest.x * 3.8 + rest.z * 3.1 - timeSec * 0.75);
        let mdt = dt * metabRate;

        if role == 0 {
            // Producers synthesize energy from nutrients + sunlight/vent plume wave
            let uptake = (0.14 * nutrient + 0.08 * envWave - 0.11 * stress) * mdt;
            energy = energy + uptake;
            nutrient = nutrient - 0.035 * mdt + 0.025 * envWave * mdt;
        } else if role == 1 {
            // Grazers consume ambient productivity and drift softly
            let graze = (0.11 * envWave - 0.095 * stress - 0.045) * mdt;
            energy = energy + graze;
            nutrient = nutrient + 0.015 * mdt;
        } else if role == 2 {
            // Predators have higher metabolic burn offset by hunting surges
            let hunt = (0.12 * sin(timeSec * 0.9 + rest.y * 4.0) + 0.06 * nutrient - 0.075) * mdt;
            energy = energy + hunt;
        } else {
            // Decomposers recycle stressed biomass back into nutrients
            let recycle = (0.12 * stress + 0.05 * (1.0 - envWave) - 0.045) * mdt;
            energy = energy + recycle;
            nutrient = nutrient + 0.045 * mdt;
        }

        // Thermal/toxicity stress drift & starvation pressure
        let ventHeat = clamp((-rest.y) * 0.25 + envWave * 0.16, 0.0, 0.35);
        var dStress: f32 = (ventHeat * 0.06 - 0.04 * energy) * mdt;
        if energy < 0.22 {
            dStress = dStress + 0.075 * mdt;
        }
        if energy < 0.14 && role != 3 {
            energy = energy - 0.018 * mdt;
        }
        stress = clamp(stress + dStress, 0.015, 0.98);
        energy = clamp(energy, 0.02, 1.85);
        nutrient = clamp(nutrient, 0.04, 1.25);

        age = age + dt * (0.06 + 0.04 * metabRate);
        if age > 7.2 {
            age = 0.2;
        }

        s0[i] = vec4<f32>(nextPos.x, nextPos.y, nextPos.z, energy);
        s1[i] = vec4<f32>(stress, nutrient, age, v1.w);
        i += stride;
    }
}

// Extracts one 4096-row chunk of scalar energy (colMode=0) or stress (colMode=1) for readFromKernelBuffer.
@kernel @grid(1)
fn k_extract_chunk_col(g: grid<1>,
                       s0: read_store<vec4<f32>, 1>,
                       s1: read_store<vec4<f32>, 1>,
                       outChunk: write_store<f32, 1>,
                       offset: u32, chunkRows: u32, totalCount: u32,
                       colMode: u32, stride: u32) {
    var r: u32 = g.x() as u32;
    while r < chunkRows {
        let idx = offset + r;
        var val: f32 = 0.0;
        if idx < totalCount {
            if colMode == 0u {
                val = s0[idx].w;
            } else {
                val = s1[idx].x;
            }
        }
        outChunk[r] = val;
        r += stride;
    }
}

// Extracts full dense column when tombstones exist prior to Compact.
@kernel @grid(1)
fn k_extract_full_col(g: grid<1>,
                      s0: read_store<vec4<f32>, 1>,
                      s1: read_store<vec4<f32>, 1>,
                      outFull: write_store<f32, 1>,
                      totalCount: u32, colMode: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < totalCount {
        if colMode == 0u {
            outFull[i] = s0[i].w;
        } else {
            outFull[i] = s1[i].x;
        }
        i += stride;
    }
}
`;

export const ECO_SPLAT_SHADER = `
import sci::splat::*;

fn guild_color(role: i32, sp: i32) -> vec3<f32> {
    if role == 0 {
        if sp == 2 {
            return vec3<f32>(0.10, 0.76, 1.05);
        }
        return vec3<f32>(0.12, 0.94, 0.78);
    }
    if role == 1 {
        return vec3<f32>(0.44, 0.92, 0.34);
    }
    if role == 2 {
        return vec3<f32>(1.08, 0.56, 0.16);
    }
    return vec3<f32>(0.84, 0.34, 1.06);
}

fn eval_eco_pos(m: u32,
                px: f32, py: f32, pz: f32,
                energy: f32, stress: f32, nutrient: f32, age: f32,
                sp: i32, role: i32) -> vec3<f32> {
    if m == 0u {
        return vec3<f32>(px, py, pz);
    }
    let eClamped = clamp(energy, 0.0, 1.8);
    if m == 1u {
        let tierY = -0.74 + (role as f32) * 0.49 + ((stress - 0.5) * 0.10);
        let baseR = 0.96 - (role as f32) * 0.23;
        let rad = max(0.12, baseR * (0.62 + 0.38 * min(1.2, eClamped)));
        let spInRole = (sp - role * 3) as f32;
        let ang = spInRole * 2.0944 + px * 1.15 + pz * 0.95 + (role as f32) * 0.45;
        return vec3<f32>(cos(ang) * rad, tierY, sin(ang) * rad);
    }
    if m == 2u {
        let xPhase = eClamped * 1.15 - 0.95;
        let yPhase = clamp(stress, 0.0, 1.15) * 1.45 - 0.78;
        let zPhase = clamp(nutrient, 0.0, 1.2) * 1.35 - 0.68;
        return vec3<f32>(xPhase, yPhase, zPhase);
    }
    let ageC = clamp(age, 0.0, 7.5);
    let theta = ageC * 0.68 + (sp as f32) * 0.5236;
    let rad = 0.44 + eClamped * 0.36 + 0.07 * sin(ageC * 1.7 + (role as f32) * 1.57);
    let hy = clamp((ageC - 3.5) * 0.24 + ((role as f32) - 1.5) * 0.12, -0.98, 0.98);
    return vec3<f32>(cos(theta) * rad, hy, sin(theta) * rad);
}

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
    hasMask: u32, radiusMode: u32, timeSec: f32
) {
    var idx: u32 = g.x() as u32;
    while idx < count {
        let v0 = s0[idx];
        let v1 = s1[idx];

        let px = v0.x;
        let py = v0.y;
        let pz = v0.z;
        let energy = v0.w;

        let stress = v1.x;
        let nutrient = v1.y;
        let age = v1.z;
        let spRole = (v1.w + 0.5) as u32;
        let role = (spRole & 15u) as i32;
        let sp = (spRole >> 4u) as i32;

        var pos: vec3<f32> = vec3<f32>(px, py, pz);
        if fromM == toM || morph >= 0.999 {
            pos = eval_eco_pos(toM, px, py, pz, energy, stress, nutrient, age, sp, role);
        } else {
            let p0 = eval_eco_pos(fromM, px, py, pz, energy, stress, nutrient, age, sp, role);
            let p1 = eval_eco_pos(toM, px, py, pz, energy, stress, nutrient, age, sp, role);
            pos = mix(p0, p1, vec3<f32>(morph, morph, morph));
        }

        let spProj = project_point(pos, camR, camU, camF, camT, width, height);
        if spProj.z > 0.05 {
            let baseG = guild_color(role, sp);
            let stressMix = clamp((stress - 0.56) * 2.1, 0.0, 0.92);
            let critCol = vec3<f32>(1.18, 0.24, 0.34);
            var col: vec3<f32> = mix(baseG, critCol, vec3<f32>(stressMix, stressMix, stressMix));

            if toM == 2u {
                let phaseCol = thermal_div_rgb(clamp((stress - 0.45) * 1.8, -1.0, 1.0));
                col = mix(col, phaseCol, vec3<f32>(morph * 0.55, morph * 0.55, morph * 0.55));
            } else if toM == 3u {
                let helixCol = plasma_rgb(clamp(energy * 0.68, 0.0, 1.0));
                col = mix(col, helixCol, vec3<f32>(morph * 0.42, morph * 0.42, morph * 0.42));
            }

            let eGain = 0.14 + 0.22 * clamp(energy, 0.05, 1.6);
            let mAct = mask_active(mask, idx, hasMask);
            var bright: f32 = eGain;
            var rMode: u32 = radiusMode;
            if hasMask != 0u {
                if mAct > 0.5 {
                    bright = eGain * 1.45;
                } else {
                    bright = eGain * 0.10;
                    rMode = 0u;
                }
            }
            if energy > 1.15 {
                rMode = 1u;
                bright = bright * 1.18;
            }

            splat_pixel(accR, accG, accB, accC, spProj.x, spProj.y, width, height, col * bright, rMode);
        }

        idx += stride;
    }
}
`;
