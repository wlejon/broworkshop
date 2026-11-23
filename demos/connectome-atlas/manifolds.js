// Connectome manifolds and HDR atomic splatting kernel for FlyWire whole-brain atlas.
// Compiles cleanly on GPU via HdrSplatEngine (<= 232B push constants, no f64, no ternaries).

export const MANIFOLDS = [
    {
        id: 0,
        name: '3D Anatomical Tractome',
        short: '0: Tractome 3D',
        desc: 'Complete 3D fruit-fly brain (139,248 real neurons & 16.8M synapses). Colors show neurotransmitters (cyan=ACh excitatory, pink=GABA inhibitory); golden flashes are live signals hopping across real synapses.',
    },
    {
        id: 1,
        name: 'Sensory → Motor Flow Torus',
        short: '1: Flow Torus',
        desc: 'Circuit hierarchy ring: neurons sorted by role from outer sensory inputs (vision/smell) through central interneurons to inner motor outputs, preserving left/right symmetry.',
    },
    {
        id: 2,
        name: 'E / I Polarity Field',
        short: '2: E/I Polarity',
        desc: 'Neural gas pedal vs brake: excitatory transmitters (ACh/Dopamine/Octopamine) float above, while inhibitory transmitters (GABA/Glutamate) sink below, arranged radially by hub connections.',
    },
    {
        id: 3,
        name: 'Synaptic Hub Landscape',
        short: '3: Hub Degree',
        desc: 'Left/right hemisphere axis vs synaptic fan-out radius: bright magenta/gold peaks on the outer rim highlight master connector neurons carrying thousands of synapses.',
    },
];

// Packs 6 table column KernelBuffers (x, y, z, flow_id, nt_id, out_syn) into 2 dense GPU stores
// via a grid-stride loop so k_splat stays cleanly under Vulkan's 256-byte push constant limit.
export const CONNECTOME_PACK_SHADER = `
@kernel @grid(1)
fn k_pack(g: grid<1>,
          x: read_store<f32, 1>, y: read_store<f32, 1>, z: read_store<f32, 1>,
          flowId: read_store<i32, 1>, ntId: read_store<i32, 1>, outSyn: read_store<i32, 1>,
          pos4: write_store<vec4<f32>, 1>, attr: write_store<u32, 1>,
          count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        pos4[i] = vec4<f32>(x[i], y[i], z[i], 1.0);
        let fl = (max(flowId[i], 0) as u32) & 15u;
        let nt = (max(ntId[i], 0) as u32) & 15u;
        let os = min(max(outSyn[i], 0) as u32, 16777215u);
        attr[i] = fl | (nt << 4u) | (os << 8u);
        i += stride;
    }
}
`;

export const CONNECTOME_SHADER = `
import sci::splat::*;

fn safe_atan2(y: f32, x: f32) -> f32 {
    if abs(x) < 1e-5 && abs(y) < 1e-5 {
        return 0.0;
    }
    return atan2(y, x);
}

// Neurotransmitter HDR linear palette:
// 0=ACH cyan, 1=GABA magenta-red, 2=GLUT amber, 3=DA gold, 4=SER violet, 5=OCT emerald
fn nt_color(nt: i32) -> vec3<f32> {
    if nt == 0 {
        return vec3<f32>(0.14, 0.92, 1.25);
    }
    if nt == 1 {
        return vec3<f32>(1.26, 0.18, 0.56);
    }
    if nt == 2 {
        return vec3<f32>(1.22, 0.72, 0.14);
    }
    if nt == 3 {
        return vec3<f32>(1.30, 1.06, 0.22);
    }
    if nt == 4 {
        return vec3<f32>(0.78, 0.34, 1.32);
    }
    if nt == 5 {
        return vec3<f32>(0.18, 1.18, 0.62);
    }
    return vec3<f32>(0.68, 0.78, 0.92);
}

fn manifold_pos(m: u32, px: f32, py: f32, pz: f32, flow: i32, nt: i32, outS: i32) -> vec3<f32> {
    if m == 0u {
        return vec3<f32>(px, py, pz);
    }
    if m == 1u {
        let ang = safe_atan2(py, px);
        let fClamped = clamp(flow as f32, 0.0, 3.0);
        let majorR = 0.62 + fClamped * 0.22;
        let phi = pz * 2.1 + (nt as f32) * 0.68;
        let tubeR = 0.11 + clamp(log(1.0 + max(outS as f32, 0.0)) * 0.025, 0.0, 0.18);
        let rad = majorR + cos(phi) * tubeR;
        let axialY = (fClamped - 1.5) * 0.34 + sin(phi) * tubeR;
        return vec3<f32>(cos(ang) * rad, axialY, sin(ang) * rad);
    }
    if m == 2u {
        var polSign: f32 = 0.15;
        if nt == 0 || nt == 3 || nt == 5 {
            polSign = 1.0;
        } else if nt == 1 || nt == 2 {
            polSign = -1.0;
        }
        let ang = safe_atan2(py, px);
        let logHub = log(1.0 + max(outS as f32, 0.0)) * 0.17;
        let rad = 0.22 + logHub;
        let yPos = polSign * (0.40 + 0.34 * abs(py) + 0.08 * logHub) + pz * 0.12;
        return vec3<f32>(cos(ang) * rad, yPos, sin(ang) * rad);
    }
    // Manifold 3: Synaptic Hub Degree Landscape
    let degR = log(1.0 + max(outS as f32, 0.0)) * 0.25;
    let ang = safe_atan2(pz, py);
    let r = degR * 0.62;
    return vec3<f32>(px, cos(ang) * r, sin(ang) * r);
}

@kernel @grid(1)
fn k_splat(g: grid<1>,
           accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
           accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
           pos4: read_store<vec4<f32>, 1>, attr: read_store<u32, 1>,
           act: read_store<f32, 1>, mask: read_store<u32, 1>,
           count: u32, stride: u32, width: u32, height: u32,
           camR: vec4<f32>, camU: vec4<f32>, camF: vec4<f32>, camT: vec4<f32>,
           fromM: u32, toM: u32, morph: f32, hasMask: u32, radiusMode: u32) {
    var idx: u32 = g.x() as u32;
    while idx < count {
        let mAct = mask_active(mask, idx, hasMask);
        let a = clamp(act[idx], 0.0, 1.0);
        if hasMask == 0u || mAct >= 0.5 || a >= 0.02 {
            let pRaw = pos4[idx];
            let px = pRaw.x;
            let py = pRaw.y;
            let pz = pRaw.z;
            let pk = attr[idx];
            let flow = (pk & 15u) as i32;
            let nt = ((pk >> 4u) & 15u) as i32;
            let outS = (pk >> 8u) as i32;

            var pos: vec3<f32> = vec3<f32>(px, py, pz);
            if fromM == toM || morph >= 0.999 {
                pos = manifold_pos(toM, px, py, pz, flow, nt, outS);
            } else {
                let p0 = manifold_pos(fromM, px, py, pz, flow, nt, outS);
                let p1 = manifold_pos(toM, px, py, pz, flow, nt, outS);
                pos = mix(p0, p1, vec3<f32>(morph, morph, morph));
            }

            let proj = project_point(pos, camR, camU, camF, camT, width, height);
            if proj.z > 0.05 {
                let hubNorm = clamp(log(1.0 + max(outS as f32, 0.0)) / 7.5, 0.0, 1.0);
                let ntCol = nt_color(nt);
                let hubCol = plasma_rgb(hubNorm);

                var hubBlend: f32 = 0.0;
                if toM == 3u {
                    hubBlend += morph * 0.74;
                }
                if fromM == 3u {
                    hubBlend += (1.0 - morph) * 0.74;
                }
                let baseCol = mix(ntCol, hubCol, vec3<f32>(hubBlend, hubBlend, hubBlend));

                var gain: f32 = 0.11 + 0.15 * hubNorm;
                if hasMask != 0u && mAct >= 0.5 {
                    gain *= 1.85;
                }
                var col = baseCol * gain;

                if a > 0.08 {
                    let spikeHdr = vec3<f32>(1.85, 1.38, 0.38) * (a * 2.35);
                    col = col + baseCol * (a * 0.85) + spikeHdr;
                }

                var rMode: u32 = radiusMode;
                if a > 0.20 {
                    rMode = 1u;
                }
                splat_pixel(accR, accG, accB, accC, proj.x, proj.y, width, height, col, rMode);
            }
        }
        idx += stride;
    }
}
`;

export const CONNECTOME_EDGE_PACK_SHADER = `
@kernel @grid(1)
fn k_pack_edges(g: grid<1>,
                preIdx: read_store<u32, 1>, postIdx: read_store<u32, 1>,
                ntId: read_store<i32, 1>, synCount: read_store<i32, 1>,
                out: write_store<vec4<u32>, 1>, count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let nt = (max(ntId[i], 0) as u32) & 15u;
        let syn = min(max(synCount[i], 1) as u32, 65535u);
        out[i] = vec4<u32>(preIdx[i], postIdx[i], nt | (syn << 4u), 0u);
        i += stride;
    }
}
`;

export const CONNECTOME_EDGE_SHADER = `
import sci::splat::*;

fn safe_atan2(y: f32, x: f32) -> f32 {
    if abs(x) < 1e-5 && abs(y) < 1e-5 {
        return 0.0;
    }
    return atan2(y, x);
}

fn nt_edge_color(nt: i32) -> vec3<f32> {
    if nt == 0 {
        return vec3<f32>(0.14, 0.92, 1.25);
    }
    if nt == 1 {
        return vec3<f32>(1.26, 0.18, 0.56);
    }
    if nt == 2 {
        return vec3<f32>(1.22, 0.72, 0.14);
    }
    if nt == 3 {
        return vec3<f32>(1.30, 1.06, 0.22);
    }
    if nt == 4 {
        return vec3<f32>(0.78, 0.34, 1.32);
    }
    if nt == 5 {
        return vec3<f32>(0.18, 1.18, 0.62);
    }
    return vec3<f32>(0.68, 0.78, 0.92);
}

fn edge_manifold_pos(m: u32, px: f32, py: f32, pz: f32, flow: i32, nt: i32, outS: i32) -> vec3<f32> {
    if m == 0u {
        return vec3<f32>(px, py, pz);
    }
    if m == 1u {
        let ang = safe_atan2(py, px);
        let fClamped = clamp(flow as f32, 0.0, 3.0);
        let majorR = 0.62 + fClamped * 0.22;
        let phi = pz * 2.1 + (nt as f32) * 0.68;
        let tubeR = 0.11 + clamp(log(1.0 + max(outS as f32, 0.0)) * 0.025, 0.0, 0.18);
        let rad = majorR + cos(phi) * tubeR;
        let axialY = (fClamped - 1.5) * 0.34 + sin(phi) * tubeR;
        return vec3<f32>(cos(ang) * rad, axialY, sin(ang) * rad);
    }
    if m == 2u {
        var polSign: f32 = 0.15;
        if nt == 0 || nt == 3 || nt == 5 {
            polSign = 1.0;
        } else if nt == 1 || nt == 2 {
            polSign = -1.0;
        }
        let ang = safe_atan2(py, px);
        let logHub = log(1.0 + max(outS as f32, 0.0)) * 0.17;
        let rad = 0.22 + logHub;
        let yPos = polSign * (0.40 + 0.34 * abs(py) + 0.08 * logHub) + pz * 0.12;
        return vec3<f32>(cos(ang) * rad, yPos, sin(ang) * rad);
    }
    let degR = log(1.0 + max(outS as f32, 0.0)) * 0.25;
    let ang = safe_atan2(pz, py);
    let r = degR * 0.62;
    return vec3<f32>(px, cos(ang) * r, sin(ang) * r);
}

fn node_pos(m: u32, morph: f32, fromM: u32, toM: u32, pRaw: vec4<f32>, pk: u32) -> vec3<f32> {
    let flow = (pk & 15u) as i32;
    let nt = ((pk >> 4u) & 15u) as i32;
    let outS = (pk >> 8u) as i32;
    if fromM == toM || morph >= 0.999 {
        return edge_manifold_pos(toM, pRaw.x, pRaw.y, pRaw.z, flow, nt, outS);
    }
    let p0 = edge_manifold_pos(fromM, pRaw.x, pRaw.y, pRaw.z, flow, nt, outS);
    let p1 = edge_manifold_pos(toM, pRaw.x, pRaw.y, pRaw.z, flow, nt, outS);
    return mix(p0, p1, vec3<f32>(morph, morph, morph));
}

fn hash_u32(x: u32) -> f32 {
    var h = x ^ 0x9E3779B9u;
    h = h * 0x85EBCA6Bu;
    h = h ^ (h >> 13u);
    h = h * 0xC2B2AE35u;
    h = h ^ (h >> 16u);
    return ((h & 16777215u) as f32) / 16777216.0;
}

@kernel @grid(1)
fn k_splat_edges(g: grid<1>,
                 accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
                 accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
                 pos4: read_store<vec4<f32>, 1>, attr: read_store<u32, 1>,
                 edges: read_store<vec4<u32>, 1>, act: read_store<f32, 1>,
                 edgeCount: u32, stride: u32, width: u32, height: u32,
                 camR: vec4<f32>, camU: vec4<f32>, camF: vec4<f32>, camT: vec4<f32>,
                 fromM: u32, toM: u32, morph: f32, phase: f32,
                 restMinSyn: f32, fireMinSyn: f32) {
    var idx: u32 = g.x() as u32;
    while idx < edgeCount {
        let e = edges[idx];
        let pre = e.x;
        let post = e.y;
        let nt = (e.z & 15u) as i32;
        let syn = (e.z >> 4u) as f32;
        let aPre = clamp(act[pre], 0.0, 1.0);

        let isFiring = (aPre > 0.12) && (syn >= fireMinSyn);
        let isMajor = syn >= restMinSyn;
        if !isFiring && !isMajor {
            idx += stride;
            continue;
        }

        let p0 = node_pos(toM, morph, fromM, toM, pos4[pre], attr[pre]);
        let p1 = node_pos(toM, morph, fromM, toM, pos4[post], attr[post]);
        let diff = p1 - p0;
        let distSq = dot(diff, diff);

        if !isFiring && distSq < 0.015 {
            idx += stride;
            continue;
        }

        let ntCol = nt_edge_color(nt);
        let rnd = hash_u32(idx);

        if isFiring {
            let speed = 0.72 + 0.68 * aPre;
            let shifted = rnd + phase * speed;
            let t = shifted - floor(shifted);
            var pos = mix(p0, p1, vec3<f32>(t, t, t));
            let bow = sin(t * 3.1415926) * 0.04;
            pos = vec3<f32>(pos.x, pos.y + bow, pos.z);

            let proj = project_point(pos, camR, camU, camF, camT, width, height);
            let pulseCol = mix(ntCol, vec3<f32>(1.75, 1.32, 0.36), vec3<f32>(0.74, 0.74, 0.74))
                * (0.62 * aPre * clamp(log(1.0 + syn) * 0.28, 0.32, 1.0));
            if proj.z > 0.05 {
                var eRad: u32 = 0u;
                if aPre > 0.35 && syn >= 8.0 {
                    eRad = 1u;
                }
                splat_pixel(accR, accG, accB, accC, proj.x, proj.y, width, height, pulseCol, eRad);
            }
            if syn >= 10.0 && aPre > 0.28 {
                let s2 = t + 0.5;
                let t2 = s2 - floor(s2);
                var pos2 = mix(p0, p1, vec3<f32>(t2, t2, t2));
                let bow2 = sin(t2 * 3.1415926) * 0.04;
                pos2 = vec3<f32>(pos2.x, pos2.y + bow2, pos2.z);
                let proj2 = project_point(pos2, camR, camU, camF, camT, width, height);
                if proj2.z > 0.05 {
                    splat_pixel(accR, accG, accB, accC, proj2.x, proj2.y, width, height, pulseCol * 0.78, 0u);
                }
            }
        } else {
            let shifted = rnd + phase * 0.06;
            let t = shifted - floor(shifted);
            var pos = mix(p0, p1, vec3<f32>(t, t, t));
            let bow = sin(t * 3.1415926) * 0.04;
            pos = vec3<f32>(pos.x, pos.y + bow, pos.z);

            let proj = project_point(pos, camR, camU, camF, camT, width, height);
            if proj.z > 0.05 {
                let col = ntCol * (0.022 + 0.014 * min(log(1.0 + syn) * 0.22, 1.0));
                splat_pixel(accR, accG, accB, accC, proj.x, proj.y, width, height, col, 0u);
            }
        }
        idx += stride;
    }
}
`;
