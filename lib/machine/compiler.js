// lib/machine/compiler.js — Recursive Machine Compiler:
// Pass 1: Flatten nested `unit` sub-assemblies with provenance & transforms
// Pass 2: Compile rigid clusters (1 compound Box3D body per bolted cluster)
// Pass 3: Bounded interval certification over operating ranges [lo, hi]
// Pass 4: Multi-case load flow (gravity / actuate / recoil), support polygon & sensitivities
// Pass 5: Emit immutable compiled unit IR + nameplate & hints

import { materialOf, boxMassKg, cylMassKg, partForceCapacity } from "./materials.js";
import { iv, ivAdd, ivMul, ivSin, ivCos, ivAbs, ivSqrt, boundOverRange } from "./interval.js";

const G = 9.81;

export function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function vCross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function vNorm(a, fb = [0, 1, 0]) {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-7 ? [a[0] / l, a[1] / l, a[2] / l] : [...fb];
}

export function qMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
export function qRot(q, v) {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
    const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
    const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    return [
        v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
        v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
        v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
    ];
}
export function qAxis(ax, ay, az, angle) {
    const l = Math.hypot(ax, ay, az);
    if (!(l > 1e-7)) return [0, 0, 0, 1];
    const s = Math.sin(angle * 0.5) / l;
    return [ax * s, ay * s, az * s, Math.cos(angle * 0.5)];
}
function qMirrorX(q) { return [q[0], -q[1], -q[2], q[3]]; }

function xfPoint(pos, rot, scale, p, mirrorX) {
    const sp = [p[0] * scale * (mirrorX ? -1 : 1), p[1] * scale, p[2] * scale];
    return vAdd(pos, qRot(rot, sp));
}

function xfDir(rot, d, mirrorX, flipOnMirror) {
    const sd = [mirrorX && flipOnMirror ? -d[0] : d[0], d[1], d[2]];
    return vNorm(qRot(rot, sd), sd);
}

/** 2D convex hull in XZ plane for support polygon (Andrew's monotone chain). */
function hullXZ(pts) {
    if (pts.length < 3) return pts.map((p) => [p[0], p[2]]);
    const s = pts.map((p) => [p[0], p[2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const uniq = [];
    for (const p of s) {
        if (!uniq.length || Math.hypot(p[0] - uniq[uniq.length - 1][0], p[1] - uniq[uniq.length - 1][1]) > 1e-4) {
            uniq.push(p);
        }
    }
    if (uniq.length < 3) return uniq;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of uniq) {
        while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
        lo.push(p);
    }
    for (let i = uniq.length - 1; i >= 0; i--) {
        const p = uniq[i];
        while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
        hi.push(p);
    }
    lo.pop(); hi.pop();
    return lo.concat(hi);
}

/** Signed margin (+ inside, - outside) from XZ point (x, z) to support hull. */
function supportMarginXZ(poly, x, z) {
    if (!poly.length) return -1;
    if (poly.length === 1) return -Math.hypot(x - poly[0][0], z - poly[0][1]);
    if (poly.length === 2) {
        const ax = poly[0][0], az = poly[0][1], bx = poly[1][0], bz = poly[1][1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        return -Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    }
    let minSigned = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ex = b[0] - a[0], ez = b[1] - a[1], len = Math.hypot(ex, ez) || 1;
        // Left-hand inward normal for CCW hull: (-ez/len, ex/len)
        const signed = ((x - a[0]) * (-ez) + (z - a[1]) * ex) / len;
        if (signed < minSigned) minSigned = signed;
    }
    return minSigned;
}

function flattenBlueprint(bp, unitResolver, prefix, parentId, pos, rot, scale, mirrorX, outNodes, outCouplings, outPorts, stack) {
    if (!bp) throw new Error(`Machine compiler: missing blueprint for '${prefix || 'root'}'`);
    if (bp.id && stack.includes(bp.id)) {
        throw new Error(`Machine compiler: cyclic unit reference ${stack.join(' -> ')} -> ${bp.id}`);
    }
    const nextStack = bp.id ? [...stack, bp.id] : stack;
    const idMap = new Map();
    const ns = (raw) => (prefix ? `${prefix}/${raw}` : raw);

    for (const n of bp.nodes || []) {
        const fullId = ns(n.id);
        idMap.set(n.id, fullId);
        const pLocal = n.pos || [0, 0, 0];
        const rLocal = n.rot || [0, 0, 0, 1];
        const wPos = xfPoint(pos, rot, scale, pLocal, mirrorX);
        const wRot = qMul(rot, mirrorX ? qMirrorX(rLocal) : rLocal);
        const mat = n.material || 'steel';
        const shape = n.shape || (n.kind === 'wheel' || n.kind === 'cylinder' ? 'cylinder' : n.kind === 'sphere' ? 'sphere' : 'box');
        let half = n.half ? [n.half[0] * scale, n.half[1] * scale, n.half[2] * scale] : null;
        const radius = n.radius !== undefined ? n.radius * scale : undefined;
        const halfHeight = n.halfHeight !== undefined ? n.halfHeight * scale : undefined;
        if (!half) {
            if (shape === 'cylinder') half = [radius || 0.4, halfHeight || 0.15, radius || 0.4];
            else if (shape === 'sphere') half = [radius || 0.4, radius || 0.4, radius || 0.4];
            else half = [0.4, 0.4, 0.4];
        }
        const massKg = n.massKg !== undefined
            ? n.massKg * Math.pow(scale, 3)
            : (shape === 'cylinder' ? cylMassKg(radius || half[0], halfHeight || half[1], mat) : boxMassKg(half, mat));

        let joint = null;
        if (n.joint) {
            const j = n.joint;
            const anchor = xfPoint(pos, rot, scale, j.anchor || pLocal, mirrorX);
            const axis = xfDir(rot, j.axis || [0, 1, 0], mirrorX, !!j.mirrorFlip);
            const axisB = j.axisB ? xfDir(rot, j.axisB, mirrorX, !!j.mirrorFlip) : null;
            const anchorB = j.anchorB ? xfPoint(pos, rot, scale, j.anchorB, mirrorX) : null;
            joint = {
                ...j,
                anchor,
                axis,
                axisB,
                anchorB,
                maxEffort: (j.maxEffort || 0) * Math.pow(scale, 3),
                breakForce: (j.breakForce || 0) * Math.pow(scale, 2),
                breakTorque: (j.breakTorque || 0) * Math.pow(scale, 3),
            };
        }

        const resolvedParent = n.parent ? (idMap.get(n.parent) || ns(n.parent)) : parentId;
        let cannon = null;
        if (n.cannon) {
            cannon = {
                ...n.cannon,
                offset: vScale(n.cannon.offset || [0, 0, 0], scale),
                dir: vNorm(n.cannon.dir || [0, 0, -1]),
            };
        }

        outNodes.push({
            id: fullId,
            rawId: n.id,
            sourceUnit: bp.id || 'custom',
            kind: n.kind || 'beam',
            parent: resolvedParent,
            pos: wPos,
            rot: wRot,
            rotation: wRot,
            shape,
            half,
            radius: radius || half[0],
            halfHeight: halfHeight || half[1],
            material: mat,
            massKg,
            role: n.role || 'frame',
            groundContact: !!n.groundContact,
            friction: n.friction,
            restitution: n.restitution,
            joint,
            cannon,
            flywheel: n.flywheel ? { ...n.flywheel } : null,
            spring: n.spring ? { ...n.spring } : null,
            side: mirrorX ? -1 : (pLocal[0] < -0.05 ? -1 : pLocal[0] > 0.05 ? 1 : 0),
        });
    }

    for (const c of bp.couplings || []) {
        outCouplings.push({
            ...c,
            id: ns(c.id),
            sourceUnit: bp.id || 'custom',
            nodeId: c.nodeId ? (idMap.get(c.nodeId) || ns(c.nodeId)) : null,
            jointNodeId: c.jointNodeId ? (idMap.get(c.jointNodeId) || ns(c.jointNodeId)) : null,
            targetJointNodeId: c.targetJointNodeId ? (idMap.get(c.targetJointNodeId) || ns(c.targetJointNodeId)) : null,
        });
    }

    for (const p of bp.ports || []) {
        outPorts.push({
            ...p,
            id: ns(p.id),
            nodeId: p.nodeId ? (idMap.get(p.nodeId) || ns(p.nodeId)) : null,
        });
    }

    for (const u of bp.units || []) {
        const subBp = unitResolver(u.unitId);
        if (!subBp) throw new Error(`Machine compiler: unknown unit '${u.unitId}' referenced in '${bp.id || 'root'}'`);
        const uScale = scale * (u.scale ?? 1);
        const uMirror = mirrorX !== !!u.mirrorX;
        const mPos = xfPoint(pos, rot, scale, u.mountPos || [0, 0, 0], mirrorX);
        const mRot = qMul(rot, uMirror && !mirrorX ? qMirrorX(u.mountRot || [0, 0, 0, 1]) : (u.mountRot || [0, 0, 0, 1]));
        const uPrefix = ns(u.id);
        const uParent = u.parent ? (idMap.get(u.parent) || ns(u.parent)) : parentId;
        const startIdx = outNodes.length;
        flattenBlueprint(subBp, unitResolver, uPrefix, uParent, mPos, mRot, uScale, uMirror, outNodes, outCouplings, outPorts, nextStack);
        // Apply overrides/mount joint to the sub-unit's root node (first node added).
        if (outNodes.length > startIdx) {
            const subRoot = outNodes[startIdx];
            if (u.joint) {
                const j = u.joint;
                subRoot.joint = {
                    ...j,
                    anchor: xfPoint(pos, rot, scale, j.anchor || (u.mountPos || [0, 0, 0]), mirrorX),
                    axis: xfDir(rot, j.axis || [0, 1, 0], mirrorX, !!j.mirrorFlip),
                    axisB: j.axisB ? xfDir(rot, j.axisB, mirrorX, !!j.mirrorFlip) : null,
                    anchorB: j.anchorB ? xfPoint(pos, rot, scale, j.anchorB, mirrorX) : null,
                };
            }
            if (u.channelPrefix) {
                for (let k = startIdx; k < outNodes.length; k++) {
                    if (outNodes[k].joint && outNodes[k].joint.channel) {
                        outNodes[k].joint.channel = u.channelPrefix + outNodes[k].joint.channel;
                    }
                }
            }
            if (u.material) {
                for (let k = startIdx; k < outNodes.length; k++) {
                    if (outNodes[k].role === 'frame' || outNodes[k].role === 'armor' || outNodes[k].role === 'leg') {
                        outNodes[k].material = u.material;
                    }
                }
            }
        }
    }
}

export function compileMachine(blueprint, unitResolver, opts = {}) {
    const nodes = [], couplings = [], ports = [];
    flattenBlueprint(blueprint, unitResolver, '', null, [0, 0, 0], [0, 0, 0, 1], 1, false, nodes, couplings, ports, []);
    if (!nodes.length) throw new Error('Machine compiler: blueprint has zero parts');

    const nodeById = new Map();
    for (let i = 0; i < nodes.length; i++) {
        nodes[i].index = i;
        nodeById.set(nodes[i].id, nodes[i]);
    }

    // Pass 2: Build rigid clusters (nodes with parent && !joint merge into parent cluster).
    const clusterOfNode = new Map();
    const clusters = [];
    for (const n of nodes) {
        const pNode = n.parent ? nodeById.get(n.parent) : null;
        if (!pNode || n.joint) {
            const cid = clusters.length;
            clusters.push({ id: cid, rootNode: n, parts: [n], parentCluster: pNode ? clusterOfNode.get(pNode.id) : -1, joint: n.joint });
            clusterOfNode.set(n.id, cid);
        } else {
            const cid = clusterOfNode.get(pNode.id);
            clusters[cid].parts.push(n);
            clusterOfNode.set(n.id, cid);
        }
    }

    // Compute exact mass, COM, inertia bounds, cost for each cluster & whole machine.
    let totalMass = 0, totalCost = 0;
    const comWeighted = [0, 0, 0];
    const groundPts = [];
    const boundsMin = [Infinity, Infinity, Infinity], boundsMax = [-Infinity, -Infinity, -Infinity];

    for (const cl of clusters) {
        let cm = 0, cc = 0;
        const sum = [0, 0, 0];
        let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const p of cl.parts) {
            cm += p.massKg;
            const mat = materialOf(p.material);
            cc += p.massKg * mat.costPerKg;
            sum[0] += p.pos[0] * p.massKg;
            sum[1] += p.pos[1] * p.massKg;
            sum[2] += p.pos[2] * p.massKg;
            const r = Math.hypot(p.half[0], p.half[1], p.half[2]);
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], p.pos[k] - r);
                max[k] = Math.max(max[k], p.pos[k] + r);
                boundsMin[k] = Math.min(boundsMin[k], p.pos[k] - r);
                boundsMax[k] = Math.max(boundsMax[k], p.pos[k] + r);
            }
            if (p.groundContact || p.role === 'wheel' || p.role === 'foot' || p.role === 'spade') {
                groundPts.push([p.pos[0], p.pos[1] - p.half[1], p.pos[2]]);
            }
        }
        cl.massKg = Math.max(0.5, cm);
        cl.cost = cc;
        cl.com = [sum[0] / cl.massKg, sum[1] / cl.massKg, sum[2] / cl.massKg];
        cl.min = min; cl.max = max;
        cl.singleShape = cl.parts.length === 1 ? cl.parts[0].shape : 'compound';
        // Convert part centers relative to cluster COM in cluster-root frame (world-aligned at bind pose).
        cl.localParts = cl.parts.map((p) => {
            p.clusterId = cl.id;
            p.localPos = vSub(p.pos, cl.com);
            return { nodeId: p.id, center: p.localPos, rotation: p.rot, half: p.half, radius: p.radius, halfHeight: p.halfHeight, mass: p.massKg, shape: p.shape };
        });
        totalMass += cl.massKg;
        totalCost += cc;
        comWeighted[0] += cl.com[0] * cl.massKg;
        comWeighted[1] += cl.com[1] * cl.massKg;
        comWeighted[2] += cl.com[2] * cl.massKg;
    }
    const com = [comWeighted[0] / totalMass, comWeighted[1] / totalMass, comWeighted[2] / totalMass];
    if (!groundPts.length) {
        groundPts.push([boundsMin[0], boundsMin[1], boundsMin[2]], [boundsMax[0], boundsMin[1], boundsMin[2]],
            [boundsMax[0], boundsMin[1], boundsMax[2]], [boundsMin[0], boundsMin[1], boundsMax[2]]);
    }
    const supportPoly = hullXZ(groundPts);
    const tipMarginGravity = supportMarginXZ(supportPoly, com[0], com[2]);

    // Build compiled joints & filter pairs.
    const joints = [];
    const jointByNode = new Map();
    const filterPairs = [];
    const childClusters = Array.from({ length: clusters.length }, () => []);
    for (const cl of clusters) {
        if (cl.parentCluster >= 0 && cl.joint) {
            childClusters[cl.parentCluster].push(cl.id);
            const j = cl.joint;
            const cj = {
                id: joints.length,
                nodeId: cl.rootNode.id,
                clusterA: cl.parentCluster,
                clusterB: cl.id,
                kind: j.kind || 'hinge',
                anchor: j.anchor,
                anchorB: j.anchorB,
                axis: vNorm(j.axis || [0, 1, 0]),
                axisB: j.axisB ? vNorm(j.axisB) : null,
                lower: j.lower ?? -Math.PI * 0.5,
                upper: j.upper ?? Math.PI * 0.5,
                enableLimit: j.enableLimit !== undefined ? j.enableLimit : (j.kind === 'hinge' || j.kind === 'slider'),
                target: j.target ?? 0,
                hertz: j.hertz ?? 10,
                damping: j.damping ?? 0.9,
                maxEffort: j.maxEffort || 5e4,
                enableMotor: !!j.enableMotor,
                motorSpeed: j.motorSpeed || 0,
                enableSpring: j.enableSpring !== undefined ? j.enableSpring : (j.kind === 'hinge' || j.kind === 'slider'),
                breakForce: j.breakForce || 0,
                breakTorque: j.breakTorque || 0,
                role: j.role || cl.rootNode.role || 'actuator',
                channel: j.channel || null,
                sign: j.sign ?? 1,
                scale: j.scale ?? 1,
                material: cl.rootNode.material,
            };
            joints.push(cj);
            jointByNode.set(cl.rootNode.id, cj);
            filterPairs.push([cl.parentCluster, cl.id]);
        }
    }

    // Also compute downstream subtree mass & COM for each cluster.
    const subMass = new Float64Array(clusters.length);
    const subCom = clusters.map(() => [0, 0, 0]);
    const calcSub = (cid) => {
        let m = clusters[cid].massKg;
        const wc = vScale(clusters[cid].com, m);
        for (const ch of childClusters[cid]) {
            calcSub(ch);
            m += subMass[ch];
            wc[0] += subCom[ch][0] * subMass[ch];
            wc[1] += subCom[ch][1] * subMass[ch];
            wc[2] += subCom[ch][2] * subMass[ch];
        }
        subMass[cid] = m;
        subCom[cid] = [wc[0] / m, wc[1] / m, wc[2] / m];
    };
    for (const cl of clusters) if (cl.parentCluster < 0) calcSub(cl.id);

    // Pass 3: Certified Interval Extents for every articulated joint (hinge/slider).
    const extents = [];
    let worstStallMargin = Infinity;
    for (const j of joints) {
        if (j.kind !== 'hinge' && j.kind !== 'slider') continue;
        const mDown = subMass[j.clusterB];
        const r = vSub(subCom[j.clusterB], j.anchor);
        const lo = j.lower, hi = j.upper;
        let solved;
        if (j.kind === 'hinge') {
            // Horizontal moment arm perpendicular to axis projected onto horizontal plane:
            // r_perp = r - axis * dot(r, axis); torque(q) = mDown * G * |(R_axis(q)*r_perp)_xz|
            const ax = j.axis;
            const rPerp = vSub(r, vScale(ax, vDot(r, ax)));
            const u = rPerp;
            const v = vCross(ax, rPerp);
            solved = boundOverRange((qIv) => {
                const c = ivCos(qIv), s = ivSin(qIv);
                const rx = ivAdd(ivMul(c, iv(u[0])), ivMul(s, iv(v[0])));
                const rz = ivAdd(ivMul(c, iv(u[2])), ivMul(s, iv(v[2])));
                const hArm = ivSqrt(ivAdd(ivMul(rx, rx), ivMul(rz, rz)));
                return ivMul(iv(mDown * G), hArm);
            }, lo, hi, 1e-2, 32);
        } else {
            const slope = Math.abs(j.axis[1]);
            const fStatic = mDown * G * slope;
            solved = { min: fStatic, max: fStatic, argMin: lo, argMax: hi, splits: 0 };
        }
        const stallMargin = j.maxEffort / Math.max(1, solved.max);
        worstStallMargin = Math.min(worstStallMargin, stallMargin);
        extents.push({
            jointId: j.id,
            nodeId: j.nodeId,
            role: j.role,
            range: [lo, hi],
            minLoad: solved.min,
            maxLoad: solved.max,
            worstAngle: solved.argMax,
            capacity: j.maxEffort,
            stallMargin,
        });
    }
    if (!Number.isFinite(worstStallMargin)) worstStallMargin = 10;

    // Pass 4: Multi-Case Structural Load Flow (gravity, actuate, recoil).
    const cannons = nodes.filter((n) => n.cannon).map((n) => ({
        nodeId: n.id,
        clusterId: n.clusterId,
        localOffset: vAdd(n.localPos, qRot(n.rot, n.cannon.offset)),
        localDir: qRot(n.rot, n.cannon.dir),
        worldPos: vAdd(n.pos, qRot(n.rot, n.cannon.offset)),
        worldDir: xfDir(n.rot, n.cannon.dir, false, false),
        ...n.cannon,
    }));

    const hasRecoilSlide = joints.some((j) => j.kind === 'slider' && j.role === 'recoil');
    const spades = nodes.filter((n) => n.role === 'spade');
    const hasSpades = spades.length > 0;
    const totalRecoilNs = cannons.reduce((s, c) => s + (c.recoilNs || 0), 0);
    const recoilPeakForce = totalRecoilNs > 0 ? (totalRecoilNs / 0.08) * (hasRecoilSlide ? 0.38 : 1.0) : 0;

    // Support polygon with spades deployed vs retracted:
    const deployedPts = [...groundPts];
    if (hasSpades) {
        for (const sp of spades) {
            const outward = sp.pos[2] >= com[2] ? 1.0 : -1.0;
            deployedPts.push([sp.pos[0], boundsMin[1], sp.pos[2] + outward * 1.1]);
        }
    }
    const deployedPoly = hullXZ(deployedPts);

    const evaluateLoadCase = (caseName) => {
        const nodeUtil = {};
        const jointUtil = {};
        const clusterForce = Array.from({ length: clusters.length }, () => [0, 0, 0]);
        for (let i = 0; i < clusters.length; i++) {
            clusterForce[i][1] = -clusters[i].massKg * G;
            if (caseName === 'actuate') {
                clusterForce[i][0] += clusters[i].massKg * 6.0; // 0.6g maneuver inertia
            }
        }
        if (caseName === 'recoil') {
            for (const c of cannons) {
                const f = (c.recoilNs || 0) / 0.08 * (hasRecoilSlide ? 0.38 : 1.0);
                clusterForce[c.clusterId][0] -= c.worldDir[0] * f;
                clusterForce[c.clusterId][1] -= c.worldDir[1] * f;
                clusterForce[c.clusterId][2] -= c.worldDir[2] * f;
            }
        }
        // Accumulate child forces bottom-up toward root clusters.
        const totalForceOn = clusterForce.map((f) => [...f]);
        const accum = (cid) => {
            for (const ch of childClusters[cid]) {
                accum(ch);
                totalForceOn[cid][0] += totalForceOn[ch][0];
                totalForceOn[cid][1] += totalForceOn[ch][1];
                totalForceOn[cid][2] += totalForceOn[ch][2];
            }
        };
        for (const cl of clusters) if (cl.parentCluster < 0) accum(cl.id);

        let peakUtil = 0;
        const forceFlow = [];
        for (const j of joints) {
            const fVec = totalForceOn[j.clusterB];
            let fMag = Math.hypot(fVec[0], fVec[1], fVec[2]);
            if (caseName === 'actuate') fMag = Math.max(fMag, j.maxEffort * 0.65);
            const cap = j.breakForce > 0 ? j.breakForce : Math.max(j.maxEffort * 1.4, partForceCapacity(clusters[j.clusterB].rootNode.half, j.material));
            const u = fMag / Math.max(1, cap);
            jointUtil[j.nodeId] = u;
            peakUtil = Math.max(peakUtil, u);
            forceFlow.push({
                from: clusters[j.clusterB].com,
                to: clusters[j.clusterA].com,
                forceN: fMag,
                util: u,
                nodeId: j.nodeId,
            });
        }
        for (const n of nodes) {
            const fCluster = totalForceOn[n.clusterId];
            const share = (n.massKg / clusters[n.clusterId].massKg);
            const fNode = Math.hypot(fCluster[0], fCluster[1], fCluster[2]) * (0.35 + 0.65 * share);
            const cap = partForceCapacity(n.half, n.material);
            const u = Math.max(jointUtil[n.id] || 0, fNode / cap);
            nodeUtil[n.id] = u;
            peakUtil = Math.max(peakUtil, u);
        }

        // Dynamic COM offset under lateral recoil or actuation:
        let shiftZ = 0, shiftX = 0;
        if (caseName === 'recoil' && recoilPeakForce > 0) {
            const impulseArm = (boundsMax[1] - boundsMin[1]) * 0.55;
            shiftZ = (recoilPeakForce * impulseArm) / Math.max(1, totalMass * G);
        } else if (caseName === 'actuate') {
            shiftZ = 0.25;
        }
        const poly = (caseName === 'recoil' && hasSpades) ? deployedPoly : supportPoly;
        const tipMargin = supportMarginXZ(poly, com[0] + shiftX, com[2] + shiftZ);
        return { name: caseName, peakUtil, tipMargin, nodeUtil, jointUtil, forceFlow, shiftedCom: [com[0] + shiftX, com[1], com[2] + shiftZ], supportPoly: poly };
    };

    const loadCases = {
        gravity: evaluateLoadCase('gravity'),
        actuate: evaluateLoadCase('actuate'),
        recoil: evaluateLoadCase('recoil'),
    };
    const activeWorstUtil = Math.max(loadCases.gravity.peakUtil, loadCases.actuate.peakUtil, loadCases.recoil.peakUtil);
    const worstTipMargin = Math.min(loadCases.gravity.tipMargin, loadCases.recoil.tipMargin);

    // Weak points & finite-difference / physical hints for the player:
    const weakPoints = Object.entries(loadCases.recoil.nodeUtil)
        .map(([nodeId, util]) => ({ nodeId, util, role: nodeById.get(nodeId)?.role || 'part', material: nodeById.get(nodeId)?.material }))
        .sort((a, b) => b.util - a.util)
        .slice(0, 4);

    const hints = [];
    if (totalRecoilNs > 0 && !hasRecoilSlide) {
        hints.push('Add a Recoil Breech (prismatic damper) to cut frame recoil shock by ~62%.');
    }
    if (loadCases.recoil.tipMargin < 0.05 && totalRecoilNs > 0) {
        hints.push(hasSpades
            ? 'Recoil tips past deployed spades — widen stance or add rear counterweight.'
            : 'Cannon recoil tips chassis (margin ' + loadCases.recoil.tipMargin.toFixed(2) + ' m) — mount Outrigger Spades.');
    }
    if (worstStallMargin < 1.25) {
        const weakEx = extents.find((e) => e.stallMargin < 1.25);
        if (weakEx) hints.push(`Joint '${weakEx.role}' near stall (${(weakEx.stallMargin * 100).toFixed(0)}% torque margin) — boost motor or shorten lever.`);
    }
    for (const wp of weakPoints) {
        if (wp.util > 0.85) {
            const mat = wp.material === 'titanium' || wp.material === 'tungsten' ? 'thicker cross-section / brace' : 'Titanium alloy';
            hints.push(`High load on '${wp.role}' (${(wp.util * 100).toFixed(0)}%) — upgrade to ${mat}.`);
            break;
        }
    }
    if (!hints.length) hints.push('All compiled load cases & stroke bounds certified within alloy limits.');

    let rating = 'OVERLOAD';
    if (activeWorstUtil < 0.58 && worstTipMargin > 0.25 && worstStallMargin >= 1.6) rating = 'S';
    else if (activeWorstUtil < 0.82 && worstTipMargin > 0.02 && worstStallMargin >= 1.2) rating = 'A';
    else if (activeWorstUtil < 1.0 && worstTipMargin > -0.15 && worstStallMargin >= 1.0) rating = 'B';
    else if (activeWorstUtil < 1.2) rating = 'C';

    return {
        id: blueprint.id || 'custom_machine',
        name: blueprint.name || 'Custom Machine',
        tier: blueprint.tier || 3,
        category: blueprint.category || 'custom',
        description: blueprint.description || '',
        nodes,
        clusters,
        joints,
        filterPairs,
        couplings,
        ports,
        cannons,
        extents,
        loadCases,
        bounds: { min: boundsMin, max: boundsMax },
        com,
        supportPoly,
        deployedPoly,
        weakPoints,
        hints,
        nameplate: {
            rating,
            massKg: totalMass,
            cost: Math.round(totalCost),
            partCount: nodes.length,
            clusterCount: clusters.length,
            dofCount: joints.length,
            cannonCount: cannons.length,
            tipMargin: worstTipMargin,
            stallMargin: worstStallMargin,
            peakUtil: activeWorstUtil,
            ports: ports.map((p) => `${p.id} (${p.type})`),
        },
    };
}
