// GPU manifolds, closed-loop traffic physics, chunk extractor, and HDR atomic splatting
// for Urban Mobility Twin (131,072 vehicles + 24 cyan transit hubs on bro.kernel).

export const MANIFOLDS = [
    {
        id: 0,
        name: '3D Metropolis Grid',
        short: '0: Metropolis 3D',
        desc: 'What You\'re Seeing: 131,072 live vehicles flowing across 256 avenues, ring expressways, arched bridges, and elevated eVTOL air corridors (y > 0.2). Emerald = smooth flow, Amber = slowdown, Crimson = gridlock, Cyan beacons = 24 transit hubs.',
    },
    {
        id: 1,
        name: 'Congestion Elevation',
        short: '1: Congestion Towers',
        desc: 'What You\'re Seeing: Delay-extruded city heat map. Free-flowing traffic stays grounded on the road deck while delayed vehicles rise vertically into glowing amber and crimson congestion towers above bottleneck blocks.',
    },
    {
        id: 2,
        name: 'Speed × Delay × Battery',
        short: '2: Telemetry Cloud',
        desc: 'What You\'re Seeing: 3D fleet phase space. Horizontal X = speed (left stalled, right express), vertical Y = delay minutes (top = SLA breach), depth Z = battery charge (front = low battery).',
    },
    {
        id: 3,
        name: 'District Flow Ring',
        short: '3: District Ring',
        desc: 'What You\'re Seeing: Polar corridor radar across all 256 road segments. Angle = road_id across Downtown, Midtown, Harbor, and TechPark; radius = congestion delay; height = remaining battery charge.',
    },
];

export const MOB_PACK_SHADER = `
@kernel @grid(1)
fn k_pack_mob(g: grid<1>,
              x: read_store<f32, 1>, y: read_store<f32, 1>, z: read_store<f32, 1>,
              speed: read_store<f32, 1>, vx: read_store<f32, 1>, vz: read_store<f32, 1>,
              delayMin: read_store<f32, 1>, battery: read_store<f32, 1>,
              mode: read_store<u32, 1>,
              s0: write_store<vec4<f32>, 1>, s1: write_store<vec4<f32>, 1>,
              count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let m = mode[i] & 15u;
        let bQ = floor(clamp(battery[i], 0.0, 1.0) * 16383.0 + 0.5);
        s0[i] = vec4<f32>(x[i], y[i], z[i], speed[i]);
        s1[i] = vec4<f32>(vx[i], vz[i], delayMin[i], bQ * 16.0 + (m as f32));
        i += stride;
    }
}
`;

export const MOB_HOME_PACK_SHADER = `
@kernel @grid(1)
fn k_pack_home(g: grid<1>,
               x: read_store<f32, 1>, z: read_store<f32, 1>,
               roadId: read_store<i32, 1>,
               home4: write_store<vec4<f32>, 1>,
               count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        home4[i] = vec4<f32>(x[i], z[i], max(roadId[i], 0) as f32, 0.145);
        i += stride;
    }
}
`;

export const MOB_STEP_SHADER = `
@kernel @grid(1)
fn k_step_mob(g: grid<1>,
              s0: rw_store<vec4<f32>, 1>,
              s1: rw_store<vec4<f32>, 1>,
              home4: read_store<vec4<f32>, 1>,
              count: u32, stride: u32,
              dt: f32, time: f32, rushFactor: f32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let p0 = s0[i];
        let p1 = s1[i];
        let hm = home4[i];

        var px = p0.x;
        var py = p0.y;
        var pz = p0.z;
        var spd = p0.w;

        let vx = p1.x;
        let vz = p1.y;
        var delay = p1.z;

        let pk = floor(p1.w + 0.25) as u32;
        let mode = pk & 15u;
        var batt = ((pk >> 4u) as f32) / 16383.0;

        let hx = hm.x;
        let hz = hm.y;
        let halfLen = hm.w;

        var baseCruise: f32 = 54.0;
        if mode == 1u {
            baseCruise = 40.0;
        } else if mode == 2u {
            baseCruise = 46.0;
        } else if mode == 3u {
            baseCruise = 104.0;
        }

        let wave = sin(hx * 2.35 + hz * 1.85 + time * 0.52) * (0.20 * rushFactor);
        let jamFactor = clamp(delay * 0.028, 0.0, 0.86);
        let targetSpd = max(5.5, baseCruise * (1.0 - wave) * (1.0 - jamFactor));
        let relax = dt * (0.42 + 0.45 * (1.0 - jamFactor));
        spd = clamp(spd + (targetSpd - spd) * relax, 4.0, 125.0);

        if spd < 19.0 && delay < 34.0 {
            delay = delay + dt * 0.48;
        } else {
            delay = max(0.0, delay - dt * 0.34);
        }

        // Battery drains smoothly while cruising, and fast-charges at hub threshold
        let drainRate = 0.0045 + 0.000045 * spd;
        if batt < 0.095 {
            batt = 0.96;
        } else {
            batt = clamp(batt - dt * drainRate, 0.05, 1.0);
        }

        // Advect smoothly along road lane and wrap within segment bounds
        let stepLen = (spd / 62.0) * dt * 0.26;
        px = px + vx * stepLen;
        pz = pz + vz * stepLen;
        let dx = px - hx;
        let dz = pz - hz;
        if (dx * dx + dz * dz) > (halfLen * halfLen) {
            px = hx - dx * 0.90;
            pz = hz - dz * 0.90;
        }

        let bQ = floor(clamp(batt, 0.0, 1.0) * 16383.0 + 0.5);
        s0[i] = vec4<f32>(px, py, pz, spd);
        s1[i] = vec4<f32>(vx, vz, delay, bQ * 16.0 + (mode as f32));
        i += stride;
    }
}
`;

export const MOB_EXTRACT_CHUNK_SHADER = `
@kernel @grid(1)
fn k_extract_chunk_col(g: grid<1>,
                       s0: read_store<vec4<f32>, 1>,
                       s1: read_store<vec4<f32>, 1>,
                       outCol: write_store<f32, 1>,
                       offset: u32, count: u32, stride: u32, colSel: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let src = offset + i;
        if colSel == 0u {
            outCol[i] = s0[src].w;
        } else if colSel == 1u {
            outCol[i] = s1[src].z;
        } else {
            let pk = floor(s1[src].w + 0.25) as u32;
            outCol[i] = ((pk >> 4u) as f32) / 16383.0;
        }
        i += stride;
    }
}
`;

export const MOB_SPLAT_SHADER = `
import sci::splat::*;

fn manifold_pos(m: u32, px: f32, py: f32, pz: f32,
                spd: f32, delay: f32, batt: f32,
                roadId: f32, mode: u32) -> vec3<f32> {
    if m == 0u {
        return vec3<f32>(px, py, pz);
    }
    if m == 1u {
        let tower = clamp(delay * 0.032, 0.0, 1.18);
        return vec3<f32>(px, py + tower, pz);
    }
    if m == 2u {
        let sx = (clamp(spd / 115.0, 0.0, 1.0) - 0.5) * 2.25;
        let sy = (clamp(delay / 34.0, 0.0, 1.0) - 0.36) * 1.55;
        let sz = (clamp(batt, 0.0, 1.0) - 0.5) * 2.15;
        return vec3<f32>(sx, sy, sz);
    }
    // Manifold 3: District Flow Ring (polar road_id angle, delay radius, battery height)
    let ang = (roadId / 256.0) * 6.2831853 + (mode as f32) * 0.011;
    let rad = 0.40 + clamp(delay / 30.0, 0.0, 1.0) * 0.88 + clamp(spd / 115.0, 0.0, 1.0) * 0.14;
    let bh = (clamp(batt, 0.0, 1.0) - 0.45) * 1.10;
    return vec3<f32>(cos(ang) * rad, bh, sin(ang) * rad);
}

fn flow_color(spd: f32, delay: f32, batt: f32, mode: u32, time: f32) -> vec3<f32> {
    let slowStress = clamp((42.0 - spd) / 36.0, 0.0, 1.0) * 0.42;
    let dlyStress = clamp(delay / 22.0, 0.0, 1.0) * 0.78;
    let stress = clamp(slowStress + dlyStress, 0.0, 1.0);

    var freeCol = vec3<f32>(0.10, 1.24, 0.64);
    if mode == 3u {
        freeCol = vec3<f32>(0.16, 0.92, 1.42);
    } else if mode == 1u {
        freeCol = vec3<f32>(0.18, 1.15, 0.88);
    }

    let amber = vec3<f32>(1.32, 0.84, 0.14);
    let crimson = vec3<f32>(1.52, 0.16, 0.12);

    var col = freeCol;
    if stress < 0.46 {
        let u = stress / 0.46;
        col = mix(freeCol, amber, vec3<f32>(u, u, u));
    } else {
        let u = (stress - 0.46) / 0.54;
        col = mix(amber, crimson, vec3<f32>(u, u, u));
    }

    if batt < 0.15 {
        let pulse = 0.65 + 0.35 * sin(time * 6.0);
        col = mix(col, vec3<f32>(1.35, 0.25, 1.25), vec3<f32>(0.55 * pulse, 0.55 * pulse, 0.55 * pulse));
    }
    return col;
}

@kernel @grid(1)
fn k_splat(g: grid<1>,
           accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
           accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
           s0: read_store<vec4<f32>, 1>, s1: read_store<vec4<f32>, 1>,
           home4: read_store<vec4<f32>, 1>, mask: read_store<u32, 1>,
           count: u32, stride: u32, width: u32, height: u32,
           camR: vec4<f32>, camU: vec4<f32>, camF: vec4<f32>, camT: vec4<f32>,
           fromM: u32, toM: u32, morph: f32, hasMask: u32, radiusMode: u32, time: f32) {
    var idx: u32 = g.x() as u32;
    while idx < count {
        let mAct = mask_active(mask, idx, hasMask);
        if hasMask == 0u || mAct >= 0.5 {
            let p0 = s0[idx];
            let p1 = s1[idx];
            let hm = home4[idx];

            let px = p0.x;
            let py = p0.y;
            let pz = p0.z;
            let spd = p0.w;
            let delay = p1.z;

            let pk = floor(p1.w + 0.25) as u32;
            let mode = pk & 15u;
            let batt = ((pk >> 4u) as f32) / 16383.0;
            let roadId = hm.z;

            var pos: vec3<f32> = vec3<f32>(px, py, pz);
            if fromM == toM || morph >= 0.999 {
                pos = manifold_pos(toM, px, py, pz, spd, delay, batt, roadId, mode);
            } else {
                let a = manifold_pos(fromM, px, py, pz, spd, delay, batt, roadId, mode);
                let b = manifold_pos(toM, px, py, pz, spd, delay, batt, roadId, mode);
                pos = mix(a, b, vec3<f32>(morph, morph, morph));
            }

            let proj = project_point(pos, camR, camU, camF, camT, width, height);
            if proj.z > 0.05 {
                let baseCol = flow_color(spd, delay, batt, mode, time);
                var gain: f32 = 0.088;
                if delay > 16.0 {
                    gain = 0.21;
                } else if mode == 3u {
                    gain = 0.14;
                }
                if hasMask != 0u && mAct >= 0.5 {
                    gain = gain * 1.5;
                }
                var rMode: u32 = radiusMode;
                if delay > 20.0 {
                    rMode = 1u;
                }
                splat_pixel(accR, accG, accB, accC, proj.x, proj.y, width, height, baseCol * gain, rMode);
            }
        }
        idx += stride;
    }
}
`;

export const MOB_HUB_SPLAT_SHADER = `
import sci::splat::*;

fn hub_pos(m: u32, idx: u32, h: vec4<f32>) -> vec3<f32> {
    if m == 0u {
        return h.xyz;
    }
    if m == 1u {
        return vec3<f32>(h.x, h.y + 0.05, h.z);
    }
    if m == 2u {
        return vec3<f32>(0.95, -0.42, ((idx as f32) / 24.0 - 0.5) * 1.6);
    }
    let ang = ((idx as f32) / 24.0) * 6.2831853;
    return vec3<f32>(cos(ang) * 0.34, 0.30, sin(ang) * 0.34);
}

@kernel @grid(1)
fn k_splat_hubs(g: grid<1>,
                accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
                accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
                hubPos4: read_store<vec4<f32>, 1>,
                hubCount: u32, width: u32, height: u32,
                camR: vec4<f32>, camU: vec4<f32>, camF: vec4<f32>, camT: vec4<f32>,
                fromM: u32, toM: u32, morph: f32, time: f32) {
    let idx = g.x() as u32;
    if idx >= hubCount {
        return;
    }
    let h = hubPos4[idx];
    var pos: vec3<f32> = h.xyz;
    if fromM == toM || morph >= 0.999 {
        pos = hub_pos(toM, idx, h);
    } else {
        pos = mix(hub_pos(fromM, idx, h), hub_pos(toM, idx, h), vec3<f32>(morph, morph, morph));
    }
    let proj = project_point(pos, camR, camU, camF, camT, width, height);
    if proj.z > 0.05 {
        let pulse = 1.0 + 0.22 * sin(time * 3.2 + (idx as f32) * 0.7);
        let col = vec3<f32>(0.22, 1.55, 2.05) * pulse;
        splat_pixel(accR, accG, accB, accC, proj.x, proj.y, width, height, col, 1u);
        splat_pixel(accR, accG, accB, accC, proj.x - 1.0, proj.y, width, height, col * 0.65, 0u);
        splat_pixel(accR, accG, accB, accC, proj.x, proj.y - 1.0, width, height, col * 0.65, 0u);
    }
}
`;
