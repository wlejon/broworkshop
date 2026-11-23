// 4 financial microstructure GPU manifolds, closed-loop compute kernels, and HDR splat shader.
// Strict bro.kernel compliance: no f64, no ternaries (?:), grid-stride loops, push constants <= 232B.

import { INSTRUMENT_DEFS } from "./data.js";

export const MANIFOLDS = [
    {
        id: 0,
        name: 'Orderbook Wall',
        short: '0: Orderbook Wall',
        desc: 'What You\'re Seeing: 131,072 live limit orders arranged across 16 instrument depth canyons separated along the central mid-price spread. Cyan/teal BID walls face amber/crimson ASK walls; bright gold marks resting whales & icebergs; magenta flags toxic flow.',
        preset: { yaw: 0.52, pitch: 0.44, dist: 2.65, target: [0.0, 0.04, 0.0] },
    },
    {
        id: 1,
        name: 'Liquidity Torus',
        short: '1: Liquidity Torus',
        desc: 'What You\'re Seeing: Cross-venue capital ring. Lit exchanges orbit the 16-spoke outer torus rim (cyan bids, amber asks) while null-venue OTC dark-pool orders swirl in the violet inner core, bridged by magenta toxic flow arcs.',
        preset: { yaw: 0.42, pitch: 0.56, dist: 2.75, target: [0.0, 0.0, 0.0] },
    },
    {
        id: 2,
        name: 'Leverage × PnL',
        short: '2: Leverage × PnL',
        desc: 'What You\'re Seeing: Live relational join of 131,072 orders against 4,096 trading agents. Left→right is desk leverage (4x+ squeeze danger on right); top→bottom is margin headroom & normalized PnL; depth is log notional & fill toxicity.',
        preset: { yaw: 0.34, pitch: 0.20, dist: 2.75, target: [0.0, 0.0, 0.0] },
    },
    {
        id: 3,
        name: 'Sector Risk Matrix',
        short: '3: Sector Matrix',
        desc: 'What You\'re Seeing: 5 sectors (AI_TECH, CRYPTO, MACRO_ETF, COMMODITY, FX) × 4 strategy clusters (MM, ARB, MOMENTUM, HEDGE/RETAIL). Rising crimson & magenta plumes reveal systemic contagion propagating across leveraged strategies.',
        preset: { yaw: 0.58, pitch: 0.48, dist: 2.70, target: [0.0, 0.04, 0.0] },
    },
];

const STRAT_ID_MAP = { MM: 0, ARB: 1, MOMENTUM: 2, HEDGE: 3, RETAIL: 4 };

export function evalOrderManifold(m, o, ag) {
    if (m === 0) return [o.x, o.y, o.z];

    const sym = (o.sym_id | 0) & 15;
    const side = (o.side | 0) & 1;
    const flags = o.flags | 0;
    const isDark = o.venue_id == null;
    const venueSlot = isDark ? 0 : (((o.venue_id | 0) - 1) & 15);
    const strat = typeof o.strategy === 'number' ? o.strategy : (STRAT_ID_MAP[o.strategy] ?? 0);
    const inst = INSTRUMENT_DEFS[sym] || INSTRUMENT_DEFS[0];
    const sector = inst.sectorIdx | 0;
    const logNot = Math.max(0.0, Math.min(1.0, (Math.log10(Math.max(1000.0, o.notional)) - 3.6) / 3.1));
    const distNorm = Math.max(0.0, Math.min(1.0, o.dist_mid / 65.0));

    if (m === 1) {
        if ((flags & 1) !== 0) {
            const ang = (sym / 16.0) * 6.2831853 + o.x * 0.45 + o.fill_ratio * 0.6;
            const rad = 0.68 + 0.22 * Math.sin(ang * 3.0 + o.y);
            const ay = 0.24 + 0.34 * Math.abs(Math.sin(ang * 4.0 + distNorm * 2.0));
            return [Math.cos(ang) * rad, ay, Math.sin(ang) * rad];
        }
        if (isDark) {
            const ang = (sym / 16.0) * 6.2831853 + o.z * 0.6 + strat * 0.28;
            const phi = distNorm * 6.2831853 + o.fill_ratio * 1.4;
            const rMaj = 0.42;
            const rMin = 0.13 + logNot * 0.08;
            const rad = rMaj + Math.cos(phi) * rMin;
            return [Math.cos(ang) * rad, Math.sin(phi) * rMin, Math.sin(ang) * rad];
        }
        const ang = (venueSlot / 16.0) * 6.2831853 + (sym - 7.5) * 0.015 + o.fill_ratio * 0.08;
        const phi = (side === 0 ? 1.4 : -1.4) + distNorm * 2.2 + o.x * 0.45;
        const rMaj = 0.98;
        const rMin = 0.16 + logNot * 0.18;
        const rad = rMaj + Math.cos(phi) * rMin;
        return [Math.cos(ang) * rad, Math.sin(phi) * rMin, Math.sin(ang) * rad];
    }

    if (m === 2) {
        const lev = ag ? ag.leverage : 2.5;
        const margin = ag ? ag.margin_ratio : 0.45;
        const pnlNorm = ag ? (ag.pnl / Math.max(1.0, ag.equity)) : 0.0;
        const px = Math.max(0.0, Math.min(1.0, (lev - 1.0) / 5.2)) * 2.2 - 1.1;
        const py = Math.max(-0.95, Math.min(0.95, pnlNorm * 1.4 + (0.64 - margin) * 0.85));
        const pz = (logNot - 0.45) * 1.5 + (side === 0 ? -0.14 : 0.14) + distNorm * 0.35;
        return [px, py, pz];
    }

    // Manifold 3: 5 sectors x 4 strategy cluster lattice
    const sx = (sector - 2.0) * 0.48 + o.x * 0.08;
    const stratCol = strat < 4 ? strat : 3;
    const szBase = -0.66 + stratCol * 0.44 + (strat === 4 ? 0.11 : -0.04);
    const sz = szBase + o.z * 0.08;
    const stress = Math.max(0.0, Math.min(1.0, distNorm * 0.55 + ((flags & 3) !== 0 ? 0.45 : 0.0)));
    const sy = -0.34 + stress * 0.88 + (strat === 4 ? 0.16 : 0.0) + o.y * 0.14;
    return [sx, sy, sz];
}

export const MKT_COMPUTE_SHADER = `
@kernel @grid(1)
fn k_pack_inst(g: grid<1>,
               midPrice: read_store<f32, 1>,
               volatility: read_store<f32, 1>,
               spreadBps: read_store<f32, 1>,
               sector: read_store<u32, 1>,
               instMeta4: write_store<vec4<f32>, 1>,
               count: u32) {
    let i = g.x() as u32;
    if i >= count {
        return;
    }
    instMeta4[i] = vec4<f32>(midPrice[i], volatility[i], spreadBps[i], (sector[i] & 7u) as f32);
}

@kernel @grid(1)
fn k_pack_agents(g: grid<1>,
                 leverage: read_store<f32, 1>,
                 marginRatio: read_store<f32, 1>,
                 equity: read_store<f32, 1>,
                 pnl: read_store<f32, 1>,
                 riskTier: read_store<u32, 1>,
                 agentMeta4: write_store<vec4<f32>, 1>,
                 count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let eq = max(equity[i], 1.0);
        agentMeta4[i] = vec4<f32>(leverage[i], marginRatio[i], pnl[i] / eq, riskTier[i] as f32);
        i += stride;
    }
}

@kernel @grid(1)
fn k_pack_orders_pos(g: grid<1>,
                     x: read_store<f32, 1>, y: read_store<f32, 1>, z: read_store<f32, 1>,
                     price: read_store<f32, 1>, qty: read_store<f32, 1>, agentId: read_store<u32, 1>,
                     s0: write_store<vec4<f32>, 1>, rest4: write_store<vec4<f32>, 1>,
                     linkIdx: write_store<u32, 1>,
                     count: u32, stride: u32, agentCount: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let px = x[i];
        let py = y[i];
        let pz = z[i];
        s0[i] = vec4<f32>(px, py, pz, price[i]);
        rest4[i] = vec4<f32>(px, py, pz, qty[i]);

        let rawAid = agentId[i];
        var aIdx: u32 = 0u;
        if rawAid > 0u {
            aIdx = min(rawAid - 1u, agentCount - 1u);
        }
        linkIdx[i] = aIdx;
        i += stride;
    }
}

@kernel @grid(1)
fn k_pack_orders_meta(g: grid<1>,
                      notional: read_store<f32, 1>, distMid: read_store<f32, 1>, fillRatio: read_store<f32, 1>,
                      symId: read_store<u32, 1>, side: read_store<u32, 1>, strategy: read_store<u32, 1>,
                      flags: read_store<u32, 1>, venueId: read_store<u32, 1>,
                      instMeta4: read_store<vec4<f32>, 1>, s1: write_store<vec4<f32>, 1>,
                      count: u32, stride: u32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let sym = symId[i] & 15u;
        let sd = side[i] & 1u;
        let strat = min(strategy[i], 4u) & 7u;
        let fl = flags[i] & 7u;
        let vid = venueId[i];
        var isDark: u32 = 0u;
        var vSlot: u32 = 0u;
        if vid == 0u {
            isDark = 1u;
        } else {
            vSlot = (vid - 1u) & 15u;
        }
        let sec = (floor(instMeta4[sym].w + 0.5) as u32) & 7u;
        let packedMeta = sym | (sd << 4u) | (strat << 5u) | (fl << 8u) | (isDark << 11u) | (sec << 12u) | (vSlot << 15u);
        s1[i] = vec4<f32>(notional[i], distMid[i], fillRatio[i], packedMeta as f32);
        i += stride;
    }
}

@kernel @grid(1)
fn k_step_orders(g: grid<1>,
                 s0: rw_store<vec4<f32>, 1>,
                 s1: rw_store<vec4<f32>, 1>,
                 rest4: read_store<vec4<f32>, 1>,
                 instMeta4: read_store<vec4<f32>, 1>,
                 count: u32, stride: u32,
                 dt: f32, timeSec: f32, shockAmp: f32) {
    var i: u32 = g.x() as u32;
    while i < count {
        let p0 = s0[i];
        let p1 = s1[i];
        let rst = rest4[i];

        var px = p0.x;
        var py = p0.y;
        var pz = p0.z;
        var prc = p0.w;

        var notl = p1.x;
        var dist = p1.y;
        var fill = p1.z;
        let pk = floor(p1.w + 0.25) as u32;

        let sym = pk & 15u;
        let sd = (pk >> 4u) & 1u;
        let strat = (pk >> 5u) & 7u;
        let fl = (pk >> 8u) & 7u;
        let qtyVal = rst.w;

        let inst = instMeta4[sym];
        let midP = max(inst.x, 0.05);
        let vol = inst.y;

        var sideSign: f32 = -1.0;
        if sd == 1u {
            sideSign = 1.0;
        }

        let wave = sin(timeSec * (0.95 + vol * 0.8) + (sym as f32) * 1.13 + rst.z * 2.4);
        let microShift = (wave * (0.35 + shockAmp * 1.2) + sin(timeSec * 2.1 + rst.x * 5.0) * 0.18) * vol;

        var distDrift: f32 = microShift * 1.8;
        if strat == 0u {
            distDrift = distDrift - 0.35;
        } else if (fl & 1u) != 0u {
            distDrift = distDrift + 1.25;
        }
        dist = clamp(dist + distDrift * dt, 0.35, 110.0);

        let targetPrice = max(0.05, midP * (1.0 + sideSign * dist * 0.0001 + wave * 0.0014 * vol));
        prc = prc + (targetPrice - prc) * min(1.0, dt * 4.5);
        notl = clamp(prc * qtyVal, 500.0, 20000000.0);

        // Close-to-mid resting orders gradually fill and replenish on book
        let fillSpeed = (0.045 + 0.035 * shockAmp) / (1.0 + dist * 0.18);
        fill = fill + dt * fillSpeed;
        if fill > 0.995 {
            fill = 0.04;
        }

        // Gentle spring-bounded breathing around SpatialIndex anchor
        let disp = vec3<f32>(px, py, pz) - rst.xyz;
        let zBreath = sideSign * clamp((dist - 14.0) * 0.0035, -0.10, 0.14) * sin(timeSec * 1.2 + (sym as f32));
        let yBreath = (fill - 0.5) * 0.055 * (1.0 + shockAmp * 0.8);
        px = px + (-disp.x * 2.4 + cos(timeSec * 1.4 + rst.z * 4.0) * 0.015) * dt;
        py = py + (yBreath - disp.y * 2.2) * dt;
        pz = pz + (zBreath - disp.z * 2.2) * dt;

        s0[i] = vec4<f32>(px, py, pz, prc);
        s1[i] = vec4<f32>(notl, dist, fill, p1.w);
        i += stride;
    }
}

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
            outCol[i] = s1[src].x;
        } else if colSel == 2u {
            outCol[i] = s1[src].y;
        } else {
            outCol[i] = s1[src].z;
        }
        i += stride;
    }
}
`;

export const MKT_SPLAT_SHADER = `
import sci::splat::*;

fn eval_mkt_pos(m: u32,
                px: f32, py: f32, pz: f32,
                notional: f32, distMid: f32, fillRatio: f32,
                sym: u32, sd: u32, strat: u32, fl: u32, isDark: u32, sector: u32, vSlot: u32,
                ag: vec4<f32>, timeSec: f32, shockPulse: f32) -> vec3<f32> {
    if m == 0u {
        let ripple = shockPulse * 0.06 * sin(px * 6.0 + pz * 5.0 - timeSec * 12.0);
        return vec3<f32>(px, py + ripple, pz);
    }

    let logNot = clamp((log(max(notional, 1000.0)) / 2.302585 - 3.6) / 3.1, 0.0, 1.0);
    let distNorm = clamp(distMid / 65.0, 0.0, 1.0);

    if m == 1u {
        if (fl & 1u) != 0u {
            let ang = ((sym as f32) / 16.0) * 6.2831853 + px * 0.45 + fillRatio * 0.6 + timeSec * 0.14;
            let rad = 0.68 + 0.22 * sin(ang * 3.0 + py);
            let ay = 0.24 + 0.34 * abs(sin(ang * 4.0 + distNorm * 2.0));
            return vec3<f32>(cos(ang) * rad, ay, sin(ang) * rad);
        }
        if isDark == 1u {
            let ang = ((sym as f32) / 16.0) * 6.2831853 + pz * 0.6 + (strat as f32) * 0.28 + timeSec * 0.09;
            let phi = distNorm * 6.2831853 + fillRatio * 1.4;
            let rMaj = 0.42;
            let rMin = 0.13 + logNot * 0.08;
            let rad = rMaj + cos(phi) * rMin;
            return vec3<f32>(cos(ang) * rad, sin(phi) * rMin, sin(ang) * rad);
        }
        let ang = ((vSlot as f32) / 16.0) * 6.2831853 + ((sym as f32) - 7.5) * 0.015 + fillRatio * 0.08;
        var sideBias: f32 = -1.4;
        if sd == 0u {
            sideBias = 1.4;
        }
        let phi = sideBias + distNorm * 2.2 + px * 0.45;
        let rMaj = 0.98;
        let rMin = 0.16 + logNot * 0.18;
        let rad = rMaj + cos(phi) * rMin;
        return vec3<f32>(cos(ang) * rad, sin(phi) * rMin, sin(ang) * rad);
    }

    if m == 2u {
        let lev = ag.x;
        let margin = ag.y;
        let pnlNorm = ag.z;
        let xP = clamp((lev - 1.0) / 5.2, 0.0, 1.0) * 2.2 - 1.1;
        let yP = clamp(pnlNorm * 1.4 + (0.64 - margin) * 0.85, -0.95, 0.95);
        var sdOff: f32 = 0.14;
        if sd == 0u {
            sdOff = -0.14;
        }
        let zP = (logNot - 0.45) * 1.5 + sdOff + distNorm * 0.35;
        return vec3<f32>(xP, yP, zP);
    }

    // Manifold 3: 5 sectors x 4 strategy cluster lattice with systemic contagion wave
    let sx = ((sector as f32) - 2.0) * 0.48 + px * 0.075;
    var stratCol: u32 = strat;
    var szOff: f32 = -0.04;
    var syOff: f32 = 0.0;
    if strat >= 4u {
        stratCol = 3u;
        szOff = 0.11;
        syOff = 0.16;
    }
    let sz = -0.66 + (stratCol as f32) * 0.44 + szOff + pz * 0.075;
    var flStress: f32 = 0.0;
    if (fl & 3u) != 0u {
        flStress = 0.45;
    }
    let stress = clamp(distNorm * 0.55 + flStress + max(ag.y - 0.65, 0.0) * 0.6, 0.0, 1.0);
    let contagion = 0.10 * sin(timeSec * 2.4 - (sector as f32) * 0.85 - (stratCol as f32) * 0.9) * (0.25 + stress + shockPulse);
    let sy = -0.34 + stress * 0.88 + syOff + contagion + py * 0.13;
    return vec3<f32>(sx, sy, sz);
}

fn order_color(m: u32, sd: u32, fl: u32, isDark: u32,
               notional: f32, distMid: f32, ag: vec4<f32>, timeSec: f32) -> vec3<f32> {
    let distNorm = clamp(distMid / 60.0, 0.0, 1.0);
    var col = vec3<f32>(0.08, 1.02, 1.24);
    if sd == 1u {
        col = mix(vec3<f32>(1.24, 0.78, 0.14), vec3<f32>(1.36, 0.20, 0.14), vec3<f32>(distNorm, distNorm, distNorm));
    } else {
        col = mix(vec3<f32>(0.10, 1.18, 1.28), vec3<f32>(0.08, 0.66, 1.14), vec3<f32>(distNorm, distNorm, distNorm));
    }

    if m == 1u && isDark == 1u {
        col = vec3<f32>(0.62, 0.42, 1.38);
    } else if m == 2u {
        let mStress = clamp((ag.y - 0.36) / 0.54, 0.0, 1.0);
        let healthy = vec3<f32>(0.12, 1.12, 0.78);
        let warn = vec3<f32>(1.30, 0.82, 0.16);
        let crit = vec3<f32>(1.44, 0.18, 0.18);
        if mStress < 0.5 {
            let u = mStress * 2.0;
            col = mix(healthy, warn, vec3<f32>(u, u, u));
        } else {
            let u = (mStress - 0.5) * 2.0;
            col = mix(warn, crit, vec3<f32>(u, u, u));
        }
    } else if m == 3u {
        var rVal: f32 = distNorm * 0.52 + max(ag.y - 0.60, 0.0) * 0.85;
        if (fl & 3u) != 0u {
            rVal = rVal + 0.35;
        }
        let u = clamp(rVal, 0.0, 1.0);
        col = mix(vec3<f32>(0.18, 0.86, 1.32), vec3<f32>(1.46, 0.22, 0.38), vec3<f32>(u, u, u));
    }

    if notional > 420000.0 || (fl & 4u) != 0u {
        col = mix(col, vec3<f32>(1.48, 1.22, 0.22), vec3<f32>(0.78, 0.78, 0.78));
    }
    if (fl & 1u) != 0u {
        let pulse = 0.70 + 0.30 * sin(timeSec * 6.5);
        col = mix(col, vec3<f32>(1.45, 0.20, 1.20), vec3<f32>(0.75 * pulse, 0.75 * pulse, 0.75 * pulse));
    }
    return col;
}

@kernel @grid(1)
fn k_splat(g: grid<1>,
           accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
           accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
           s0: read_store<vec4<f32>, 1>, s1: read_store<vec4<f32>, 1>,
           linkIdx: read_store<u32, 1>, agentMeta4: read_store<vec4<f32>, 1>,
           mask: read_store<u32, 1>,
           count: u32, stride: u32, width: u32, height: u32,
           camR: vec4<f32>, camU: vec4<f32>, camF: vec4<f32>, camT: vec4<f32>,
           fromM: u32, toM: u32, morph: f32,
           hasMask: u32, radiusMode: u32, timeSec: f32, shockPulse: f32) {
    var idx: u32 = g.x() as u32;
    while idx < count {
        let mAct = mask_active(mask, idx, hasMask);
        if hasMask == 0u || mAct >= 0.5 {
            let p0 = s0[idx];
            let p1 = s1[idx];
            let ag = agentMeta4[linkIdx[idx]];

            let pk = floor(p1.w + 0.25) as u32;
            let sym = pk & 15u;
            let sd = (pk >> 4u) & 1u;
            let strat = (pk >> 5u) & 7u;
            let fl = (pk >> 8u) & 7u;
            let isDark = (pk >> 11u) & 1u;
            let sector = (pk >> 12u) & 7u;
            let vSlot = (pk >> 15u) & 15u;

            var pos: vec3<f32> = p0.xyz;
            if fromM == toM || morph >= 0.999 {
                pos = eval_mkt_pos(toM, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z,
                                   sym, sd, strat, fl, isDark, sector, vSlot, ag, timeSec, shockPulse);
            } else {
                let a = eval_mkt_pos(fromM, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z,
                                     sym, sd, strat, fl, isDark, sector, vSlot, ag, timeSec, shockPulse);
                let b = eval_mkt_pos(toM, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z,
                                     sym, sd, strat, fl, isDark, sector, vSlot, ag, timeSec, shockPulse);
                pos = mix(a, b, vec3<f32>(morph, morph, morph));
            }

            let proj = project_point(pos, camR, camU, camF, camT, width, height);
            if proj.z > 0.05 {
                let col = order_color(toM, sd, fl, isDark, p1.x, p1.y, ag, timeSec);
                var gain: f32 = 0.078;
                var rMode: u32 = radiusMode;
                if p1.x > 420000.0 || (fl & 5u) != 0u {
                    gain = 0.16;
                    rMode = 1u;
                }
                if hasMask != 0u && mAct >= 0.5 {
                    gain = gain * 1.45;
                }
                splat_pixel(accR, accG, accB, accC, proj.x, proj.y, width, height, col * gain, rMode);
            }
        }
        idx += stride;
    }
}
`;
