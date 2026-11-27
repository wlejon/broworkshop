// lib/foundry/compiler.js — Recursive Mechanical Compiler & Virtual Dyno.
//
// Compiles any Blueprint (which may recursively contain already-compiled
// sub-assemblies) into a Certified CompiledMachine with:
//   - Tight 3D bounding box, mass, CoM, inertia, cost
//   - Flattened hierarchical part list preserving top-level ownership & nested paths
//   - Reduced effort-flow powertrain chains (ratio, reflected J, torque-speed curves)
//   - Per-part load sensitivity factors (torque, RPM, radial bearing load, heat)
//   - Fail-safe cascade analysis & static out-of-spec warnings
//   - Certified Spec Sheet ready for nesting into larger machines or running in Box3D.

import { PRIMITIVES } from "./primitives.js";
import { findNode, hasAssemblyCycle, topoNodes } from "./blueprint.js";

const PI = Math.PI;
const RPM_TO_RAD = (2 * PI) / 60;
const RAD_TO_RPM = 60 / (2 * PI);
const TAN_20 = Math.tan((20 * PI) / 180); // 20-deg spur gear pressure angle

function rotYPoint(p, yaw) {
    if (!yaw) return p.slice();
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}
function rotYSize(sz, yaw) {
    if (!yaw) return sz.slice();
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    return [c * sz[0] + s * sz[2], sz[1], s * sz[0] + c * sz[2]];
}

/**
 * Recursively expand a blueprint into a flat list of primitive instances and
 * stitched internal links, keeping every part's hierarchical path and which
 * top-level node owns it.
 */
function flattenBlueprint(bp, library, prefix = '', topNodeId = null, depth = 0, outParts = [], outLinks = [], asmBoxes = []) {
    if (depth > 8) throw new Error('foundry compiler: assembly nesting exceeds depth 8');
    const ordered = topoNodes(bp);
    // Map local (nodeId, portId, dir) -> expanded (partPath, portId)
    const portMapIn = new Map();
    const portMapOut = new Map();

    // Auto-layout 3D offsets along Z (powertrain axis) when nodes don't specify pos3d.
    let cursorZ = 0;

    for (const node of ordered) {
        const path = prefix ? `${prefix}/${node.id}` : node.id;
        const ownerTop = topNodeId || node.id;

        if (node.type === 'assembly') {
            const subBp = library && library[node.ref];
            if (!subBp) continue;
            const subParts = [];
            const subLinks = [];
            const subRes = flattenBlueprint(subBp, library, path, ownerTop, depth + 1, subParts, subLinks, asmBoxes);

            // Apply optional assembly yaw rotation (e.g. transverse drive pods pointing into Left/Right wheels!)
            const yaw = node.yaw3d || 0;
            const rawBox = computePartsBounds(subParts);
            for (const sp of subParts) {
                const rel = [sp.pos3d[0] - rawBox.center[0], sp.pos3d[1] - rawBox.center[1], sp.pos3d[2] - rawBox.center[2]];
                const rr = rotYPoint(rel, yaw);
                sp.pos3d = [rr[0] + rawBox.center[0], rr[1] + rawBox.center[1], rr[2] + rawBox.center[2]];
                sp.size = rotYSize(sp.size, yaw);
                sp.yaw3d = (sp.yaw3d || 0) + yaw;
            }

            // Compute sub-assembly local bounds and place it as a coherent 3D bounding box.
            const box = computePartsBounds(subParts);
            const anchor = node.pos3d ? node.pos3d.slice() : [0, 0, cursorZ + box.size[2] * 0.5];
            const shift = [anchor[0] - box.center[0], anchor[1] - box.center[1], anchor[2] - box.center[2]];
            for (const sp of subParts) {
                sp.pos3d[0] += shift[0];
                sp.pos3d[1] += shift[1];
                sp.pos3d[2] += shift[2];
                outParts.push(sp);
            }
            for (const sl of subLinks) outLinks.push(sl);
            if (!node.pos3d) cursorZ += box.size[2] + 0.03;

            const shiftedBox = {
                path,
                topNodeId: ownerTop,
                ref: node.ref,
                label: node.label || subBp.name,
                scale: subBp.scale,
                depth,
                min: box.min.map((v, i) => v + shift[i]),
                max: box.max.map((v, i) => v + shift[i]),
                center: anchor,
                size: box.size,
                partPaths: subParts.map((p) => p.path),
            };
            asmBoxes.push(shiftedBox);

            // Wire exposed ports of subBp into the parent's port maps.
            for (const ep of subBp.exposedPorts || []) {
                const subKey = `${ep.nodeId}:${ep.portId}`;
                if (ep.dir === 'in') {
                    const target = subRes.portMapIn.get(subKey);
                    if (target) portMapIn.set(`${node.id}:${ep.id}`, target);
                } else {
                    const src = subRes.portMapOut.get(subKey);
                    if (src) portMapOut.set(`${node.id}:${ep.id}`, src);
                }
            }
            continue;
        }

        const def = PRIMITIVES[node.type];
        if (!def) continue;
        const params = Object.assign({}, def.defaults, node.params || {});
        const analysis = def.analyze(params);
        const sz = analysis.size;
        const pos3d = node.pos3d ? node.pos3d.slice() : [0, 0, cursorZ + sz[2] * 0.5];
        if (!node.pos3d) cursorZ += sz[2] + 0.025;

        const part = {
            path,
            id: node.id,
            topNodeId: ownerTop,
            type: node.type,
            label: node.label || def.label,
            cat: def.cat,
            color: def.color,
            params,
            analysis,
            pos3d,
            yaw3d: node.yaw3d || 0,
            size: sz.slice(),
            depth,
        };
        outParts.push(part);

        for (const inp of def.ins) portMapIn.set(`${node.id}:${inp.id}`, { path, port: inp.id, domain: inp.domain });
        for (const outp of def.outs) portMapOut.set(`${node.id}:${outp.id}`, { path, port: outp.id, domain: outp.domain });
    }

    for (const l of bp.links || []) {
        const src = portMapOut.get(`${l.from}:${l.fromPort}`);
        const dst = portMapIn.get(`${l.to}:${l.toPort}`);
        if (src && dst) {
            outLinks.push({
                from: src.path,
                fromPort: src.port,
                to: dst.path,
                toPort: dst.port,
                domain: l.domain || src.domain,
            });
        }
    }

    return { portMapIn, portMapOut };
}

function computePartsBounds(parts) {
    if (!parts.length) return { min: [0, 0, 0], max: [0.1, 0.1, 0.1], center: [0, 0, 0], size: [0.1, 0.1, 0.1] };
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) {
        for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], p.pos3d[a] - p.size[a] * 0.5);
            max[a] = Math.max(max[a], p.pos3d[a] + p.size[a] * 0.5);
        }
    }
    const size = [Math.max(0.02, max[0] - min[0]), Math.max(0.02, max[1] - min[1]), Math.max(0.02, max[2] - min[2])];
    const center = [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5];
    return { min, max, center, size };
}

/**
 * Trace all rotational powertrain chains in the flattened graph.
 * Each chain runs from a driver (motor / ic_engine) OR an exposed rot input
 * down through gears/bearings/clutches/shear_pins/flywheels/shafts/springs
 * to an output (wheel / weapon_head / exposed rot output / terminal part).
 */
function buildPowerChains(bp, parts, links, rootPortMaps) {
    const partByPath = new Map(parts.map((p) => [p.path, p]));
    const flowOut = new Map();
    const flowIn = new Map();
    const elecIn = new Map();
    const FLOW_DOMAINS = new Set(['rot', 'hyd', 'lin']);

    for (const l of links) {
        if (FLOW_DOMAINS.has(l.domain)) {
            (flowOut.get(l.from) || flowOut.set(l.from, []).get(l.from)).push(l.to);
            (flowIn.get(l.to) || flowIn.set(l.to, []).get(l.to)).push(l.from);
        } else if (l.domain === 'elec') {
            (elecIn.get(l.to) || elecIn.set(l.to, []).get(l.to)).push(l.from);
        }
    }

    // Chain roots: motors, engines, or flow parts with no upstream rot/hyd/lin link.
    const roots = [];
    for (const p of parts) {
        if (p.type === 'motor' || p.type === 'ic_engine') {
            roots.push(p);
        } else {
            const def = PRIMITIVES[p.type];
            const hasFlow = def.ins.some((x) => FLOW_DOMAINS.has(x.domain)) ||
                            def.outs.some((x) => FLOW_DOMAINS.has(x.domain));
            if (hasFlow && !(flowIn.get(p.path)?.length)) {
                roots.push(p);
            }
        }
    }

    const chains = [];
    let chainSeq = 1;

    function walkChain(pathList, visited) {
        const last = pathList[pathList.length - 1];
        const nexts = (flowOut.get(last) || []).filter((n) => !visited.has(n));
        if (!nexts.length) {
            chains.push(finalizeChain(chainSeq++, pathList, partByPath, elecIn));
            return;
        }
        for (const nxt of nexts) {
            const v2 = new Set(visited);
            v2.add(nxt);
            walkChain(pathList.concat([nxt]), v2);
        }
    }

    for (const r of roots) {
        walkChain([r.path], new Set([r.path]));
    }
    return chains;
}

function finalizeChain(seq, pathList, partByPath, elecIn) {
    const stages = pathList.map((path) => partByPath.get(path));
    const first = stages[0];
    const last = stages[stages.length - 1];

    const isDriver = first.type === 'motor' || first.type === 'ic_engine';
    // Follow elec upstream through optional capacitor_bank to find battery + burst power boost!
    let battery = null;
    let capBoostW = 0;
    if (isDriver && first.type === 'motor') {
        const q = (elecIn.get(first.path) || []).slice();
        const seen = new Set(q);
        while (q.length) {
            const ep = partByPath.get(q.shift());
            if (!ep) continue;
            if (ep.type === 'battery' && !battery) battery = ep;
            if (ep.type === 'capacitor_bank') capBoostW += (ep.analysis.peakPowerBoostW || 0);
            for (const up of (elecIn.get(ep.path) || [])) {
                if (!seen.has(up)) { seen.add(up); q.push(up); }
            }
        }
    }

    let kind = 'shaft';
    if (last.type === 'wheel' || last.type === 'track_unit') kind = last.params.side === 'right' ? 'drive_right' : 'drive_left';
    else if (last.type === 'weapon_head') kind = 'weapon';

    // Cumulative gear ratio from input (index 0) to each stage i:
    // omega_i = omega_in / ratioFromIn[i], torque_i = torque_in * ratioFromIn[i] * effFromIn[i]
    const stageMeta = [];
    let cumRatio = 1;
    let cumEff = 1;
    for (let i = 0; i < stages.length; i++) {
        const p = stages[i];
        const a = p.analysis;
        const rIn = cumRatio;
        const eIn = cumEff;
        const rStage = a.ratio || 1;
        const eStage = a.efficiency || 1;
        cumRatio *= rStage;
        cumEff *= eStage;
        stageMeta.push({
            part: p,
            path: p.path,
            ratioIn: rIn,
            ratioOut: cumRatio,
            effToHere: cumEff,
            // Stage local inertia reflected to the chain's OUTPUT shaft:
            // J_out = J_local * (totalRatio / ratioLocal)^2  (filled after loop)
            ratioToOut: 1,
            torqueFactorFromOut: 1,
            rpmFactorFromOut: 1,
            radialFactorFromOut: 0,
        });
    }

    const totalRatio = cumRatio;
    const totalEff = cumEff;
    let reflectedInertiaOut = 0;
    let maxInputRpm = Infinity;

    // Also compute bearing radial loads from adjacent gear separating force F_r = F_t * tan(20 deg)
    let prevGearR = 0.03;
    let hasLimiterDownstream = false;
    let limiterCapAtOut = Infinity;
    let sacrificialCapAtOut = Infinity;

    // Walk backward from output -> input to compute factors relative to OUTPUT shaft!
    for (let i = stageMeta.length - 1; i >= 0; i--) {
        const sm = stageMeta[i];
        const p = sm.part;
        const a = p.analysis;
        // Speed of stage's output side relative to chain output:
        const ratioToOut = totalRatio / sm.ratioOut; // >= 1 for upstream stages
        sm.ratioToOut = ratioToOut;
        sm.rpmFactorFromOut = totalRatio / sm.ratioIn; // input side RPM factor
        // Torque on stage's rated side per 1 N·m at chain output:
        sm.torqueFactorFromOut = 1 / Math.max(1e-6, ratioToOut);

        // Reflect inertia to output shaft: J_ref = J * (w_stage / w_out)^2
        if (p.type === 'gear_pair') {
            reflectedInertiaOut += (a.inertiaIn || 0) * Math.pow(totalRatio / sm.ratioIn, 2);
            reflectedInertiaOut += (a.inertiaOut || 0) * Math.pow(ratioToOut, 2);
            prevGearR = a.r2 || 0.03;
        } else {
            reflectedInertiaOut += (a.inertia || 0) * Math.pow(ratioToOut, 2);
        }

        // Radial load per 1 N·m at output (gear mesh separation + overhung weapon/wheel load)
        if (p.type === 'bearing') {
            const lever = Math.max(0.015, prevGearR);
            // Tangential force = torque / r; radial = tangential * tan(20°) + overhung shock factor
            sm.radialFactorFromOut = (sm.torqueFactorFromOut / lever) * (TAN_20 + 0.65);
        }

        // Track output-referenced limits
        if (a.rated.rpmMax) {
            const outRpmLim = a.rated.rpmMax / Math.max(1e-6, sm.rpmFactorFromOut);
            if (outRpmLim < maxInputRpm) maxInputRpm = outRpmLim;
        }

        sm.shieldedBySlip = hasLimiterDownstream;
        sm.slipCapOutNm = limiterCapAtOut;
        sm.sacrificialCapOutNm = sacrificialCapAtOut;

        if (a.isLimiter && a.slipTorqueNm) {
            hasLimiterDownstream = true;
            limiterCapAtOut = Math.min(limiterCapAtOut, a.slipTorqueNm * ratioToOut);
        }
        if (a.isSacrificial && !a.isLimiter) {
            sacrificialCapAtOut = Math.min(sacrificialCapAtOut, a.rated.torquePeakNm * ratioToOut);
        }
    }

    // Driver output performance (or nominal 1000 RPM / 100 N·m test input for passive sub-assemblies)
    let noLoadRpmOut = 1000 / totalRatio;
    let stallTorqueOut = 100 * totalRatio * totalEff;
    let contTorqueOut = 60 * totalRatio * totalEff;
    let maxPowerW = 0;

    if (isDriver) {
        const dr = first.analysis.rated;
        noLoadRpmOut = dr.noLoadRpm / totalRatio;
        stallTorqueOut = dr.stallTorqueNm * totalRatio * totalEff;
        contTorqueOut = dr.torqueContNm * totalRatio * totalEff;
        maxPowerW = dr.powerContW * totalEff;
        if (battery) {
            const elecAvail = battery.analysis.rated.powerContW + capBoostW * 0.4;
            maxPowerW = Math.min(maxPowerW, elecAvail * dr.efficiency * totalEff);
        }
    }

    // Effective failure order accounting for slip clutches shielding upstream parts!
    const failSafeOrder = [];
    for (const sm of stageMeta) {
        const p = sm.part, a = p.analysis, r = a.rated;
        let contOut = Infinity, peakOut = Infinity, mode = a.failureMode;
        if (r.torqueContNm != null) contOut = Math.min(contOut, r.torqueContNm / Math.max(1e-6, sm.torqueFactorFromOut));
        if (r.torquePeakNm != null) peakOut = Math.min(peakOut, r.torquePeakNm / Math.max(1e-6, sm.torqueFactorFromOut));
        if (p.type === 'bearing' && sm.radialFactorFromOut > 0) {
            contOut = Math.min(contOut, r.radialContN / sm.radialFactorFromOut);
            peakOut = Math.min(peakOut, r.radialPeakN / sm.radialFactorFromOut);
        }
        sm.contOutNm = contOut;
        sm.peakOutNm = peakOut;
        const shielded = sm.shieldedBySlip && sm.slipCapOutNm < peakOut;
        if (isFinite(peakOut)) {
            failSafeOrder.push({
                path: p.path,
                topNodeId: p.topNodeId,
                label: p.label,
                type: p.type,
                contOutNm: contOut,
                peakOutNm: peakOut,
                // Effective trigger order: a part upstream of a lower slip clutch cannot be reached until clutch fails
                effectivePeakOutNm: shielded ? peakOut + 1e6 : peakOut,
                cost: a.cost,
                isSacrificial: !!a.isSacrificial,
                isLimiter: !!a.isLimiter,
                failureMode: mode,
                shieldedBySlip: shielded,
            });
        }
    }
    failSafeOrder.sort((a, b) => a.effectivePeakOutNm - b.effectivePeakOutNm);

    // Effective chain rated continuous & shock output torque
    const ratedContOutNm = Math.min(contTorqueOut, ...failSafeOrder.map((f) => f.contOutNm));
    const ratedPeakOutNm = failSafeOrder.length ? failSafeOrder[0].peakOutNm : stallTorqueOut;

    // Sample deterministic Torque-Speed curve (17 points from 0 to noLoadRpmOut)
    const curve = [];
    const effectiveStall = Math.min(stallTorqueOut, limiterCapAtOut);
    for (let k = 0; k <= 16; k++) {
        const frac = k / 16;
        const rpm = noLoadRpmOut * frac;
        let torque = 0;
        if (isDriver && first.type === 'ic_engine') {
            // Realistic IC bell-shaped torque curve peaking at 65% redline
            const bell = 0.62 + 0.38 * Math.sin(PI * Math.min(1, frac * 1.15));
            torque = Math.min(stallTorqueOut * bell, limiterCapAtOut);
        } else {
            torque = Math.min(stallTorqueOut * (1 - frac), limiterCapAtOut);
        }
        const powerW = torque * rpm * RPM_TO_RAD;
        curve.push({ rpm, torque, powerW, overSpec: torque > ratedContOutNm * 1.02 });
    }

    return {
        id: `chain_${seq}`,
        label: kind === 'drive_left' ? 'Left Drivetrain'
            : kind === 'drive_right' ? 'Right Drivetrain'
            : kind === 'weapon' ? 'Weapon Drive'
            : `Powertrain ${seq}`,
        kind,
        isDriver,
        driverPath: isDriver ? first.path : null,
        batteryPath: battery ? battery.path : null,
        outputPath: last.path,
        outputType: last.type,
        stages: stageMeta,
        totalRatio,
        efficiency: totalEff,
        reflectedInertiaOut: Math.max(1e-5, reflectedInertiaOut),
        noLoadRpmOut,
        maxSafeRpmOut: Math.min(noLoadRpmOut * 1.25, maxInputRpm),
        stallTorqueOut,
        contTorqueOut: ratedContOutNm,
        peakTorqueOut: ratedPeakOutNm,
        limiterCapAtOut,
        sacrificialCapAtOut,
        maxPowerW: isDriver ? maxPowerW : (ratedContOutNm * noLoadRpmOut * RPM_TO_RAD),
        failSafeOrder,
        curve,
        hasSpring: stages.some((s) => s.type === 'spring_actuator'),
        springPart: stages.find((s) => s.type === 'spring_actuator') || null,
    };
}

/**
 * Real 3D Spatial Clearance & Swept-Volume Interference Checker.
 * Catches solid part collisions AND rotating weapon swept-disc intersections
 * against chassis walls, armor plates, and adjacent machinery!
 */
function checkSpatialInterference(parts, links) {
    const interferences = [];
    const linked = new Set();
    for (const l of links) {
        linked.add(`${l.from}|${l.to}`);
        linked.add(`${l.to}|${l.from}`);
    }

    const aabbOf = (p) => [
        p.pos3d[0] - p.size[0] * 0.5, p.pos3d[0] + p.size[0] * 0.5,
        p.pos3d[1] - p.size[1] * 0.5, p.pos3d[1] + p.size[1] * 0.5,
        p.pos3d[2] - p.size[2] * 0.5, p.pos3d[2] + p.size[2] * 0.5,
    ];

    // 1. Solid part-vs-part AABB interference (skip frame cavity and directly linked couplings)
    for (let i = 0; i < parts.length; i++) {
        const A = parts[i];
        if (A.type === 'frame') continue;
        const ba = aabbOf(A);
        for (let j = i + 1; j < parts.length; j++) {
            const B = parts[j];
            if (B.type === 'frame') continue;
            if (linked.has(`${A.path}|${B.path}`)) continue;
            // Same subassembly neighbors (e.g. bearing seated on gear shaft) are allowed
            const dirA = A.path.includes('/') ? A.path.slice(0, A.path.lastIndexOf('/')) : '';
            const dirB = B.path.includes('/') ? B.path.slice(0, B.path.lastIndexOf('/')) : '';
            if (dirA && dirA === dirB) continue;

            const bb = aabbOf(B);
            const ox = Math.min(ba[1], bb[1]) - Math.max(ba[0], bb[0]);
            const oy = Math.min(ba[3], bb[3]) - Math.max(ba[2], bb[2]);
            const oz = Math.min(ba[5], bb[5]) - Math.max(ba[4], bb[4]);
            if (ox > 0.015 && oy > 0.015 && oz > 0.015) {
                const volOv = ox * oy * oz;
                const volMin = Math.min(
                    A.size[0] * A.size[1] * A.size[2],
                    B.size[0] * B.size[1] * B.size[2]
                );
                if (volOv > volMin * 0.12) {
                    const depthCm = Math.min(ox, oy, oz) * 100;
                    interferences.push({
                        kind: 'solid',
                        aPath: A.path,
                        bPath: B.path,
                        topNodeId: A.topNodeId,
                        depthM: Math.min(ox, oy, oz),
                        text: `INTERFERENCE: ${A.label} clips into ${B.label} (${depthCm.toFixed(1)} cm overlap)`,
                    });
                }
            }
        }
    }

    // 2. Rotating horizontal spinner bar swept-disc clearance vs chassis/armor/wheels/internals!
    for (const w of parts) {
        if (w.type !== 'weapon_head' || w.analysis.weaponKind !== 'spinner_bar') continue;
        const R = w.analysis.radiusM;
        const cx = w.pos3d[0], cy = w.pos3d[1], cz = w.pos3d[2];
        const yLo = cy - 0.032, yHi = cy + 0.032;

        for (const o of parts) {
            if (o === w || linked.has(`${w.path}|${o.path}`)) continue;
            const bo = aabbOf(o);
            if (bo[3] < yLo || bo[2] > yHi) continue;
            // Closest point on O's XZ box to spinner center (cx, cz)
            const qx = Math.max(bo[0], Math.min(cx, bo[1]));
            const qz = Math.max(bo[4], Math.min(cz, bo[5]));
            const d = Math.hypot(qx - cx, qz - cz);
            if (d < R - 0.012) {
                interferences.push({
                    kind: 'swept',
                    aPath: w.path,
                    bPath: o.path,
                    topNodeId: w.topNodeId,
                    depthM: R - d,
                    text: `SWEPT INTERFERENCE: ${w.label} disc (R=${(R * 100).toFixed(0)}cm) slices into ${o.label} by ${((R - d) * 100).toFixed(1)} cm!`,
                });
            }
        }
    }

    return interferences;
}

/**
 * Compile a Blueprint + Library into a Certified CompiledMachine.
 * Fast & deterministic (< 2 ms).
 */
export function compileBlueprint(bp, library = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const warnings = [];
    const errors = [];

    if (library[bp.id] && hasAssemblyCycle(bp.id, library)) {
        errors.push(`Cyclic assembly reference detected in "${bp.name}"`);
    }

    const parts = [];
    const links = [];
    const asmBoxes = [];
    const rootPortMaps = flattenBlueprint(bp, library, '', null, 0, parts, links, asmBoxes);

    const bounds = computePartsBounds(parts);
    let totalMass = 0, totalCost = 0;
    const com = [0, 0, 0];
    for (const p of parts) {
        const m = p.analysis.massKg;
        totalMass += m;
        totalCost += p.analysis.cost;
        com[0] += p.pos3d[0] * m;
        com[1] += p.pos3d[1] * m;
        com[2] += p.pos3d[2] * m;
    }
    if (totalMass > 0) { com[0] /= totalMass; com[1] /= totalMass; com[2] /= totalMass; }

    // Macro bounding box: if a chassis frame exists, frame defines the primary macro hull
    const framePart = parts.find((p) => p.type === 'frame');
    const macroSize = framePart
        ? [Math.max(framePart.size[0], bounds.size[0] * 0.75),
           Math.max(framePart.size[1], bounds.size[1] * 0.65),
           Math.max(framePart.size[2], bounds.size[2] * 0.75)]
        : bounds.size.slice();

    const chains = buildPowerChains(bp, parts, links, rootPortMaps);
    const interferences = checkSpatialInterference(parts, links);
    for (const it of interferences) {
        warnings.push({ severity: 'err', path: it.aPath, topNodeId: it.topNodeId, text: it.text });
    }
    const coolingBoostWPerK = parts
        .filter((p) => p.type === 'radiator')
        .reduce((s, p) => s + (p.analysis.coolBoostWPerK || 0), 0);

    // Structural summary (frame + armor plates)
    const armors = parts.filter((p) => p.type === 'armor');
    const structContN = (framePart ? framePart.analysis.rated.structContN : 18000) +
                        armors.reduce((s, a) => s + a.analysis.rated.structContN * 0.35, 0);
    const structPeakN = (framePart ? framePart.analysis.rated.structPeakN : 45000) +
                        armors.reduce((s, a) => s + a.analysis.rated.structPeakN * 0.45, 0);

    // Annotate parts with their chain membership and generate static engineering checks!
    const partChainInfo = new Map();
    let anyProtected = false;
    let anyUnprotectedRisk = false;
    let anyWearRisk = false;
    const failSafeVerdicts = [];

    for (const ch of chains) {
        for (const sm of ch.stages) {
            partChainInfo.set(sm.path, { chainId: ch.id, stage: sm });
        }
        if (ch.isDriver && ch.stages.length > 0 && ch.stages[0].part.type === 'motor' && !ch.batteryPath) {
            warnings.push({
                severity: 'warn',
                path: ch.stages[0].path,
                topNodeId: ch.stages[0].part.topNodeId,
                text: `${ch.stages[0].part.label}: no battery wired (using bench DC supply)`,
            });
        }

        // Check static stall overload & wear risk against weakest non-sacrificial part
        const firstFail = ch.failSafeOrder[0];
        const firstExpensive = ch.failSafeOrder.find((f) => !f.isSacrificial && !f.isLimiter && f.cost > 25);

        if (firstFail) {
            if (firstFail.isLimiter || firstFail.isSacrificial) {
                anyProtected = true;
                const saved = firstExpensive ? firstExpensive.cost : 0;
                const kindStr = firstFail.isLimiter ? 'slips' : 'snaps';
                failSafeVerdicts.push({
                    chainId: ch.id,
                    chainLabel: ch.label,
                    safe: true,
                    firstPart: firstFail.label,
                    text: firstExpensive
                        ? `SAFE: ${firstFail.label} ($${firstFail.cost.toFixed(0)}) ${kindStr} at ${firstFail.peakOutNm.toFixed(0)} N·m before ${firstExpensive.label} ($${saved.toFixed(0)}) fails at ${firstExpensive.peakOutNm.toFixed(0)} N·m`
                        : `PROTECTED: ${firstFail.label} limits peak load to ${firstFail.peakOutNm.toFixed(0)} N·m`,
                });
            } else {
                // Flag unprotected shock risk on weapon chains or when stall torque can actually break the first part
                const isRisk = ch.kind === 'weapon' || ch.stallTorqueOut > firstFail.peakOutNm * 0.85;
                if (isRisk) anyUnprotectedRisk = true;
                failSafeVerdicts.push({
                    chainId: ch.id,
                    chainLabel: ch.label,
                    safe: !isRisk,
                    firstPart: firstFail.label,
                    text: isRisk
                        ? `UNPROTECTED: ${firstFail.label} ($${firstFail.cost.toFixed(0)}) fails first at ${firstFail.peakOutNm.toFixed(0)} N·m (${firstFail.failureMode})`
                        : `OVERBUILT: Weakest part (${firstFail.label}, ${firstFail.peakOutNm.toFixed(0)} N·m) exceeds stall (${ch.stallTorqueOut.toFixed(0)} N·m)`,
                });
            }
        }

        // Check each stage for continuous wear risk at nominal operating torque (~38% stall, clamped by any slip clutch)
        const opTorque = Math.min(ch.stallTorqueOut * 0.38, ch.limiterCapAtOut);
        for (const sm of ch.stages) {
            if (sm.part.analysis.isSacrificial || sm.part.analysis.isLimiter || sm.part.type === 'motor' || sm.part.type === 'ic_engine') continue;
            if (opTorque > sm.contOutNm * 1.05) {
                anyWearRisk = true;
                warnings.push({
                    severity: 'warn',
                    path: sm.path,
                    topNodeId: sm.part.topNodeId,
                    text: `${sm.part.label}: operating load (${opTorque.toFixed(0)} N·m) exceeds continuous rating (${sm.contOutNm.toFixed(0)} N·m) — rapid wear!`,
                });
            }
            if (ch.noLoadRpmOut * sm.rpmFactorFromOut > (sm.part.analysis.rated.rpmMax || Infinity)) {
                warnings.push({
                    severity: 'err',
                    path: sm.path,
                    topNodeId: sm.part.topNodeId,
                    text: `${sm.part.label}: no-load speed (${(ch.noLoadRpmOut * sm.rpmFactorFromOut).toFixed(0)} rpm) exceeds max rating (${sm.part.analysis.rated.rpmMax.toFixed(0)} rpm)!`,
                });
            }
        }
    }

    // Overall fail-safe engineering grade
    const grade = errors.length ? 'INVALID'
        : anyUnprotectedRisk ? 'UNPROTECTED'
        : anyWearRisk ? 'WEAR_RISK'
        : anyProtected ? 'SAFE'
        : 'NOMINAL';

    // Primary representative chain (weapon if present, else first chain) for the spec sheet headline
    const primaryChain = chains.find((c) => c.kind === 'weapon') || chains[0] || null;
    const driveL = chains.find((c) => c.kind === 'drive_left') || null;
    const driveR = chains.find((c) => c.kind === 'drive_right') || null;
    const weaponChain = chains.find((c) => c.kind === 'weapon') || null;

    // Estimated top driving speed & weapon tip energy
    let topSpeedMs = 0;
    if (driveL || driveR) {
        const d = driveL || driveR;
        const wheel = d.stages[d.stages.length - 1].part;
        topSpeedMs = d.noLoadRpmOut * RPM_TO_RAD * (wheel.analysis.radiusM || 0.12) * 0.82;
    }
    let weaponEnergyJ = 0;
    if (weaponChain) {
        const wOut = weaponChain.noLoadRpmOut * RPM_TO_RAD * 0.85;
        weaponEnergyJ = weaponChain.hasSpring
            ? (weaponChain.springPart.analysis.energyJ || 0)
            : 0.5 * weaponChain.reflectedInertiaOut * wOut * wOut;
    }

    const compileMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

    return {
        id: bp.id,
        name: bp.name,
        scale: bp.scale,
        kind: bp.kind,
        blueprint: bp,
        parts,
        links,
        asmBoxes,
        chains,
        interferences,
        coolingBoostWPerK,
        partChainInfo,
        primaryChain,
        driveL,
        driveR,
        weaponChain,
        bounds,
        macroSize,
        massKg: Math.max(0.5, totalMass),
        com,
        cost: totalCost,
        structure: {
            framePath: framePart ? framePart.path : null,
            armorPaths: armors.map((a) => a.path),
            contN: structContN,
            peakN: structPeakN,
        },
        spec: {
            grade,
            compileMs,
            massKg: Math.max(0.5, totalMass),
            cost: totalCost,
            boundingBox: macroSize,
            partCount: parts.length,
            subAssemblyCount: asmBoxes.length,
            chainCount: chains.length,
            topSpeedMs,
            weaponEnergyJ,
            primaryRatio: primaryChain ? primaryChain.totalRatio : 1,
            primaryEfficiency: primaryChain ? primaryChain.efficiency : 1,
            primaryNoLoadRpm: primaryChain ? primaryChain.noLoadRpmOut : 0,
            primaryContTorqueNm: primaryChain ? primaryChain.contTorqueOut : 0,
            primaryPeakTorqueNm: primaryChain ? primaryChain.peakTorqueOut : 0,
            primaryPowerW: primaryChain ? primaryChain.maxPowerW : 0,
            failSafeVerdicts,
            warnings,
            errors,
        },
    };
}
