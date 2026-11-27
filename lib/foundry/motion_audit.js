// lib/foundry/motion_audit.js — Kinematic Motion & Invalid-Interaction Audit Engine.
//
// Sweeps every moving component through its real 3D kinematic cycle (rotation, rocking
// swing, linear reciprocation) and tests for physically invalid interactions in motion:
//   1. SWEPT_COLLISION    — SAT 3D OBB-vs-OBB collisions between moving parts & neighbors
//   2. FRAME_CLIP         — Moving parts slicing into real frame walls, slabs, or 4-post columns
//   3. GROUND_STRIKE      — Moving effectors plunging below the machine's ground plane
//   4. SHAFT_OBSTRUCTION  — Connecting drive shafts passing straight through unrelated parts
//   5. SHAFT_ANGLE        — Hard-angled rotary shafts lacking a bevel/diff/belt/chain transfer
//   6. KINEMATIC_STALL    — Connected outputs that fail to move or fault during active operation
//
// Pure JS (zero DOM dependency): runs in < 1 ms inside Foundry's live 3D editor AND
// headlessly across entire machine libraries via demos/foundry/tests/audit_motion.js.

import { createMachineRuntime } from "./runtime.js";

const PI = Math.PI;
const TAU = PI * 2;

function rotY(p, yaw) {
    if (!yaw) return [p[0], p[1], p[2]];
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}

/** Multiply two 3x3 rotation matrices (stored as 3 column basis vectors [ux, uy, uz]). */
function basisFromYawPitchRoll(yaw, rx, ry, rz) {
    // World basis = R_y(yaw) * R_x(rx) * R_y(ry) * R_z(rz)
    const mul = (m, v) => [
        m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
        m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
        m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
    ];
    const rY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; };
    const rX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, s], [0, -s, c]]; };
    const rZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; };
    const matMul = (A, B) => [mul(A, B[0]), mul(A, B[1]), mul(A, B[2])];
    let M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (yaw) M = matMul(M, rY(yaw));
    if (rx) M = matMul(M, rX(rx));
    if (ry) M = matMul(M, rY(ry));
    if (rz) M = matMul(M, rZ(rz));
    return M;
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Exact 3D Separating Axis Theorem (SAT) OBB-vs-OBB overlap test.
 * Returns { hit, overlap, point } where overlap is minimum penetration depth in meters.
 */
export function obbOverlap(A, B) {
    const t = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]];
    let minPen = Infinity;

    const testAxis = (ax) => {
        const l = Math.hypot(ax[0], ax[1], ax[2]);
        if (l < 1e-6) return true;
        const nx = ax[0] / l, ny = ax[1] / l, nz = ax[2] / l;
        const n = [nx, ny, nz];
        const dist = Math.abs(dot3(t, n));
        const rA = A.h[0] * Math.abs(dot3(A.u[0], n)) + A.h[1] * Math.abs(dot3(A.u[1], n)) + A.h[2] * Math.abs(dot3(A.u[2], n));
        const rB = B.h[0] * Math.abs(dot3(B.u[0], n)) + B.h[1] * Math.abs(dot3(B.u[1], n)) + B.h[2] * Math.abs(dot3(B.u[2], n));
        const pen = (rA + rB) - dist;
        if (pen <= 0) return false;
        if (pen < minPen) minPen = pen;
        return true;
    };

    for (let i = 0; i < 3; i++) if (!testAxis(A.u[i])) return { hit: false, overlap: 0 };
    for (let j = 0; j < 3; j++) if (!testAxis(B.u[j])) return { hit: false, overlap: 0 };
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            if (!testAxis(cross3(A.u[i], B.u[j]))) return { hit: false, overlap: 0 };
        }
    }
    return {
        hit: true,
        overlap: minPen,
        point: [(A.c[0] + B.c[0]) * 0.5, (A.c[1] + B.c[1]) * 0.5, (A.c[2] + B.c[2]) * 0.5],
    };
}

/** Exact 3D line-segment vs AABB intersection test (slab method). Returns hit point or null. */
function segmentHitsAABB(p0, p1, box) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    let tMin = 0.06, tMax = 0.94; // ignore endpoints touching connected part housings
    for (let i = 0; i < 3; i++) {
        const bMin = box.c[i] - box.h[i];
        const bMax = box.c[i] + box.h[i];
        if (Math.abs(d[i]) < 1e-8) {
            if (p0[i] < bMin || p0[i] > bMax) return null;
        } else {
            let t1 = (bMin - p0[i]) / d[i];
            let t2 = (bMax - p0[i]) / d[i];
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) return null;
        }
    }
    const tm = (tMin + tMax) * 0.5;
    return [p0[0] + d[0] * tm, p0[1] + d[1] * tm, p0[2] + d[2] * tm];
}

/** Exact 3D physical port position matching view3d.js::portWorldPos. */
export function portWorldPos(part, dir, otherPart = null) {
    let local = [0, 0, 0];
    const a = part.analysis || {};
    if (part.type === 'gear_pair' && dir === 'out') {
        local = [a.centerDist || 0, 0, 0];
    } else if (part.type === 'belt_drive' || part.type === 'chain_drive') {
        const halfSpan = (a.spanM || 0.16) * 0.5;
        local = [0, 0, dir === 'in' ? -halfSpan : halfSpan];
    } else if (part.type === 'track_unit' && dir === 'in') {
        const halfS = (a.lengthM || 0.68) * 0.34;
        if (otherPart) {
            let bestD = Infinity;
            for (const c of [[0, 0, -halfS], [0, 0, 0], [0, 0, halfS]]) {
                const rc = rotY(c, part.yaw3d || 0);
                const wx = part.pos3d[0] + rc[0], wy = part.pos3d[1] + rc[1], wz = part.pos3d[2] + rc[2];
                const d = Math.hypot(otherPart.pos3d[0] - wx, otherPart.pos3d[1] - wy, otherPart.pos3d[2] - wz);
                if (d < bestD) { bestD = d; local = c; }
            }
        } else {
            local = [0, 0, -halfS];
        }
    } else if (part.type === 'weapon_head' && dir === 'in') {
        const wk = a.weaponKind;
        const wr = a.radiusM || 0.30;
        if (wk === 'spinner_bar') local = [0, -0.044, -0.088];
        else if (wk === 'mill_spindle') local = [0, wr * 1.15, 0];
        else if (wk === 'auger_drill') local = [0, wr * 1.75, 0];
        else if (wk === 'mech_legs') local = [0, wr * 0.56, 0];
        else if (wk === 'excavator_boom') local = [0, -wr * 0.22, -wr * 0.42];
    }
    const r = rotY(local, part.yaw3d || 0);
    return [part.pos3d[0] + r[0], part.pos3d[1] + r[1], part.pos3d[2] + r[2]];
}

/** Decompose a structural `frame` into its real physical steel walls, slabs & columns (matching meshes.js::frameMesh). */
export function frameSolidBoxes(framePart) {
    const [W, H, L] = framePart.analysis.size;
    const hw = W * 0.5, hh = H * 0.5, hl = L * 0.5;
    const [cx, cy, cz] = framePart.pos3d;
    const yaw = framePart.yaw3d || 0;
    const boxes = [];
    const addBox = (lx, ly, lz, hx, hy, hz, tag) => {
        const rc = rotY([lx, ly, lz], yaw);
        boxes.push({
            tag,
            c: [cx + rc[0], cy + rc[1], cz + rc[2]],
            h: [hx, hy, hz],
            u: basisFromYawPitchRoll(yaw, 0, 0, 0),
        });
    };

    if (H > Math.min(W, L) * 0.65) {
        // Tall 4-post industrial gantry / press / mech spine: 4 columns + top/bottom slabs
        const colR = Math.max(0.035, Math.min(W, L) * 0.065);
        const slabH = Math.max(0.055, H * 0.085);
        addBox(0, -hh + slabH * 0.5, 0, hw, slabH * 0.5, hl, 'frame base slab');
        addBox(0, hh - slabH * 0.5, 0, hw, slabH * 0.5, hl, 'frame crown slab');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            addBox(sx * (hw - colR * 1.2), 0, sz * (hl - colR * 1.2), colR, hh - slabH, colR, 'frame corner column');
        }
    } else {
        // Low-profile box-tube chassis frame: side walls + rear wall + split front bulkhead (central shaft portal)
        const wall = Math.max(0.012, Math.min(W, L) * 0.032);
        const portalHW = Math.max(0.065, W * 0.14);
        const sideW = Math.max(0.01, (W - portalHW * 2) * 0.5);
        addBox(-hw + wall * 0.5, 0, 0, wall * 0.5, hh, hl, 'frame left wall');
        addBox(hw - wall * 0.5, 0, 0, wall * 0.5, hh, hl, 'frame right wall');
        addBox(0, 0, -hl + wall * 0.5, hw, hh, wall * 0.5, 'frame rear wall');
        addBox(-(portalHW + sideW * 0.5), 0, hl - wall * 0.5, sideW * 0.5, hh, wall * 0.5, 'frame front-left bulkhead');
        addBox(portalHW + sideW * 0.5, 0, hl - wall * 0.5, sideW * 0.5, hh, wall * 0.5, 'frame front-right bulkhead');
    }
    return boxes;
}

/** Classify whether a part actively moves in 3D kinematics and compute its exact OBB at `phase` ∈ [0, 2π). */
export function partWorldOBBAtPhase(part, phase = 0) {
    const a = part.analysis || {};
    const sz = a.size || [0.06, 0.06, 0.06];
    let localOff = [0, 0, 0];
    let rx = 0, ry = 0, rz = 0;
    let hx = sz[0] * 0.45, hy = sz[1] * 0.45, hz = sz[2] * 0.45;
    let dynamic = false;

    if (part.type === 'gear_pair') {
        const cd = a.centerDist || 0;
        const r1 = a.r1 || sz[1] * 0.3, r2 = a.r2 || sz[1] * 0.5;
        localOff = [(cd + r2 - r1) * 0.5, 0, 0];
        hx = (cd + r1 + r2) * 0.46;
        hy = Math.max(r1, r2) * 0.94;
        hz = (a.faceWidthM || sz[2]) * 0.46;
    } else if (part.type === 'hydraulic_ram') {
        dynamic = true;
        const amp = Math.min(0.05, (a.strokeM || 0.16) * 0.14);
        localOff = [0, 0, Math.sin(phase) * amp];
    } else if (part.type === 'crank_slider') {
        dynamic = true;
        const amp = a.throwM || 0.042;
        localOff = [0, 0, Math.sin(phase) * amp];
    } else if (part.type === 'weapon_head') {
        const wk = a.weaponKind;
        dynamic = true;
        if (wk === 'spinner_bar') {
            ry = phase;
        } else if (wk === 'spinner_drum' || wk === 'winch_drum') {
            rx = phase;
        } else if (wk === 'auger_drill' || wk === 'mill_spindle') {
            ry = phase;
        } else if (wk === 'lathe_chuck') {
            rz = phase;
        } else if (wk === 'hammer_arm') {
            rx = -0.25 + Math.sin(phase) * 0.55;
            localOff = [0, (a.radiusM || 0.4) * 0.22, 0];
        } else if (wk === 'crusher_jaw') {
            rx = -0.10 + Math.sin(phase) * 0.28;
        } else if (wk === 'flipper_spatula') {
            rx = -0.22 + Math.sin(phase) * 0.38;
        } else if (wk === 'trebuchet_arm') {
            rx = -0.32 + Math.sin(phase) * 0.68;
        } else if (wk === 'grapple_claw') {
            rx = -0.06 + Math.sin(phase) * 0.22;
        } else if (wk === 'excavator_boom') {
            rx = -0.08 + Math.sin(phase) * 0.24;
        } else if (wk === 'mech_legs') {
            rx = Math.sin(phase) * 0.12;
        } else if (wk === 'piledriver_spear') {
            localOff = [0, 0, Math.sin(phase) * 0.045];
        } else if (wk === 'fork_lifter') {
            localOff = [0, 0.04 + Math.sin(phase) * 0.085, 0];
        } else if (wk === 'press_platen') {
            localOff = [0, Math.sin(phase) * 0.06, 0];
        }
    }

    const yaw = part.yaw3d || 0;
    const u = basisFromYawPitchRoll(yaw, rx, ry, rz);
    // Rotate localOff by yaw (pivot is at part.pos3d)
    const rOff = rotY(localOff, yaw);
    const c = [part.pos3d[0] + rOff[0], part.pos3d[1] + rOff[1], part.pos3d[2] + rOff[2]];
    return { c, h: [hx, hy, hz], u, dynamic };
}

/** Lowest Y corner of an OBB in world space. */
function obbMinY(obb) {
    const extY = obb.h[0] * Math.abs(obb.u[0][1]) + obb.h[1] * Math.abs(obb.u[1][1]) + obb.h[2] * Math.abs(obb.u[2][1]);
    return obb.c[1] - extY;
}

/**
 * Audit a compiled machine for all invalid interactions in motion!
 * @param {object} compiled  Output of compileBlueprint()
 * @param {object} [opts]    { samples: 12, liveSim: false, checkGround: true }
 */
export function auditMachineMotion(compiled, opts = {}) {
    const samples = opts.samples ?? 12;
    const checkGround = opts.checkGround ?? (compiled.scale === 'machine');
    const findings = [];
    const byPath = new Map(compiled.parts.map((p) => [p.path, p]));

    // Build adjacency sets so directly mated neighbors aren't falsely flagged for touching at their coupling port
    const connected = new Set();
    for (const l of compiled.links || []) {
        connected.add(l.from + '|' + l.to);
        connected.add(l.to + '|' + l.from);
    }
    const areLinked = (a, b) => connected.has(a.path + '|' + b.path);

    // Precompute static OBBs + decomposed real frame steel walls/columns
    const staticOBBs = new Map();
    const frameBoxes = [];
    for (const p of compiled.parts) {
        if (p.type === 'frame') {
            for (const fb of frameSolidBoxes(p)) frameBoxes.push({ frame: p, box: fb });
        } else {
            staticOBBs.set(p.path, partWorldOBBAtPhase(p, 0));
        }
    }

    // Determine physical ground level (lowest wheel/track/mech-leg/frame bottom)
    let groundY = 0;
    if (checkGround) {
        let minSupportY = Infinity;
        for (const p of compiled.parts) {
            if (p.type === 'wheel' || p.type === 'track_unit' || p.type === 'frame' ||
                (p.type === 'weapon_head' && p.analysis.weaponKind === 'mech_legs')) {
                const obb = partWorldOBBAtPhase(p, 0);
                minSupportY = Math.min(minSupportY, obbMinY(obb));
            }
        }
        groundY = Number.isFinite(minSupportY) ? minSupportY : 0;
    }

    // --- 1, 2 & 3. Dynamic Swept OBB-vs-OBB, Frame Clip & Ground Strike Audit ---
    const tolM = compiled.scale === 'titan' ? 0.08 : 0.016;
    const solidParts = compiled.parts.filter((p) => p.type !== 'frame');

    for (const part of solidParts) {
        const probe0 = partWorldOBBAtPhase(part, 0);
        if (!probe0.dynamic) continue;

        const worstByOther = new Map();
        let worstFrame = null;
        let worstGround = null;

        for (let k = 0; k < samples; k++) {
            const phase = (k / samples) * TAU;
            const obb = partWorldOBBAtPhase(part, phase);

            // 1a. Swept collision against every other solid part
            for (const other of solidParts) {
                if (other === part || areLinked(part, other)) continue;
                const otherObb = partWorldOBBAtPhase(other, phase);
                const res = obbOverlap(obb, otherObb);
                if (res.hit && res.overlap > tolM) {
                    const key = [part.path, other.path].sort().join('|');
                    const prev = worstByOther.get(key);
                    if (!prev || res.overlap > prev.overlap) {
                        worstByOther.set(key, { other, overlap: res.overlap, phase, point: res.point });
                    }
                }
            }

            // 2. Moving effector vs real structural frame walls / slabs / columns
            // Skip `mech_legs` vs pelvis base slab and `auger_drill`/`mill_spindle` vs open bay
            for (const { frame, box } of frameBoxes) {
                if (part.type === 'weapon_head' && part.analysis.weaponKind === 'mech_legs') continue;
                const res = obbOverlap(obb, box);
                if (res.hit && res.overlap > tolM * 1.4) {
                    if (!worstFrame || res.overlap > worstFrame.overlap) {
                        worstFrame = { frame, tag: box.tag, overlap: res.overlap, phase, point: res.point };
                    }
                }
            }

            // 3. Ground plane strike check (moving weapon/effector plunging underground!)
            if (checkGround && part.type === 'weapon_head' && part.analysis.weaponKind !== 'mech_legs') {
                const lowY = obbMinY(obb);
                const depth = groundY - lowY;
                if (depth > 0.035) {
                    if (!worstGround || depth > worstGround.depth) {
                        worstGround = { depth, phase, point: [obb.c[0], groundY, obb.c[2]] };
                    }
                }
            }
        }

        for (const hit of worstByOther.values()) {
            // Avoid reporting symmetric pair twice when both parts are dynamic
            if (part.path > hit.other.path && partWorldOBBAtPhase(hit.other, 0).dynamic) continue;
            const deg = Math.round((hit.phase * 180) / PI);
            findings.push({
                severity: 'error',
                kind: 'SWEPT_COLLISION',
                partA: part.path,
                partB: hit.other.path,
                topNodeA: part.topNodeId,
                topNodeB: hit.other.topNodeId,
                phaseDeg: deg,
                overlapM: hit.overlap,
                point3d: hit.point,
                text: `SWEPT COLLISION: ${part.label} hits ${hit.other.label} at ${deg}° (${(hit.overlap * 100).toFixed(1)} cm overlap)`,
            });
        }
        if (worstFrame) {
            const deg = Math.round((worstFrame.phase * 180) / PI);
            findings.push({
                severity: 'error',
                kind: 'FRAME_CLIP',
                partA: part.path,
                partB: worstFrame.frame.path,
                topNodeA: part.topNodeId,
                topNodeB: worstFrame.frame.topNodeId,
                phaseDeg: deg,
                overlapM: worstFrame.overlap,
                point3d: worstFrame.point,
                text: `FRAME CLIP: ${part.label} clips ${worstFrame.tag} at ${deg}° (${(worstFrame.overlap * 100).toFixed(1)} cm)`,
            });
        }
        if (worstGround) {
            const deg = Math.round((worstGround.phase * 180) / PI);
            findings.push({
                severity: 'warn',
                kind: 'GROUND_STRIKE',
                partA: part.path,
                partB: null,
                topNodeA: part.topNodeId,
                topNodeB: null,
                phaseDeg: deg,
                overlapM: worstGround.depth,
                point3d: worstGround.point,
                text: `GROUND STRIKE: ${part.label} dips ${(worstGround.depth * 100).toFixed(1)} cm below floor at ${deg}°`,
            });
        }
    }

    // --- 4 & 5. Rotary Shaft Misalignment + Shaft Pass-Through Obstruction Audit ---
    for (const link of compiled.links || []) {
        if (link.domain !== 'rot' && link.domain !== 'lin') continue;
        const pA = byPath.get(link.from);
        const pB = byPath.get(link.to);
        if (!pA || !pB) continue;
        const aPos = portWorldPos(pA, 'out', pB);
        const bPos = portWorldPos(pB, 'in', pA);
        const dx = bPos[0] - aPos[0], dy = bPos[1] - aPos[1], dz = bPos[2] - aPos[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.015) continue;

        // 5. Rotary shaft alignment check
        if (link.domain === 'rot') {
            const axZ = rotY([0, 0, 1], pA.yaw3d || 0);
            const axX = rotY([1, 0, 0], pA.yaw3d || 0);
            const dotZ = Math.abs((dx * axZ[0] + dy * axZ[1] + dz * axZ[2]) / dist);
            const dotX = Math.abs((dx * axX[0] + dy * axX[1] + dz * axX[2]) / dist);
            const dotY = Math.abs(dy / dist);
            const isRightAngle = pA.type === 'bevel_gear' || pA.type === 'differential' || pA.type === 'worm_gear'
                || pA.type === 'belt_drive' || pA.type === 'chain_drive'
                || pB.type === 'bevel_gear' || pB.type === 'differential';
            const bestDot = isRightAngle ? Math.max(dotZ, dotX, dotY) : dotZ;
            const deg = Math.acos(Math.min(1, bestDot)) * 180 / PI;
            if (deg > 30) {
                findings.push({
                    severity: 'warn',
                    kind: 'SHAFT_ANGLE',
                    partA: pA.path,
                    partB: pB.path,
                    topNodeA: pA.topNodeId,
                    topNodeB: pB.topNodeId,
                    angleDeg: deg,
                    point3d: [(aPos[0] + bPos[0]) * 0.5, (aPos[1] + bPos[1]) * 0.5, (aPos[2] + bPos[2]) * 0.5],
                    text: `HARD SHAFT ANGLE: ${pA.label} → ${pB.label} bends ${deg.toFixed(0)}° (routed via 90° miter box)`,
                });
            }
        }

        // 4. Shaft pass-through obstruction against unrelated solid components
        for (const other of solidParts) {
            if (other === pA || other === pB) continue;
            if (areLinked(pA, other) && areLinked(pB, other)) continue;
            // Shrink obstacle box slightly by 1.2 cm so adjacent housing flanges don't false-trigger
            const ob = staticOBBs.get(other.path);
            if (!ob) continue;
            const shrink = compiled.scale === 'titan' ? 0.06 : 0.012;
            const testBox = {
                c: ob.c,
                h: [Math.max(0.005, ob.h[0] - shrink), Math.max(0.005, ob.h[1] - shrink), Math.max(0.005, ob.h[2] - shrink)],
            };
            const hitPt = segmentHitsAABB(aPos, bPos, testBox);
            if (hitPt) {
                findings.push({
                    severity: 'error',
                    kind: 'SHAFT_OBSTRUCTION',
                    partA: pA.path,
                    partB: other.path,
                    topNodeA: pA.topNodeId,
                    topNodeB: other.topNodeId,
                    point3d: hitPt,
                    text: `SHAFT OBSTRUCTION: drive shaft (${pA.label} → ${pB.label}) passes through ${other.label}`,
                });
            }
        }
    }

    // --- 6. Live Dynamic Motion Check (stalled outputs or startup motion faults) ---
    if (opts.liveSim) {
        const rt = createMachineRuntime(compiled);
        const nomLoad = Math.max(2, Math.round((compiled.spec.primaryContTorqueNm || 20) * 0.22));
        for (let i = 0; i < 60; i++) rt.stepDyno(1 / 60, { throttle: 0.75, loadTorqueNm: nomLoad });
        for (const ch of compiled.chains) {
            const cs = rt.chainState.get(ch.id);
            const outPart = ch.stages[ch.stages.length - 1]?.part;
            if (!cs || !outPart) continue;
            // High-ratio hydraulic rams legitimately move slowly (< 0.05 rad/s equiv); only flag true dead stalls!
            const stallEps = ch.totalRatio > 40 ? 1e-4 : 0.02;
            if (ch.isDriver && Math.abs(cs.omegaOut) < stallEps && !cs.broken) {
                findings.push({
                    severity: 'error',
                    kind: 'KINEMATIC_STALL',
                    partA: outPart.path,
                    partB: null,
                    topNodeA: outPart.topNodeId,
                    topNodeB: null,
                    point3d: outPart.pos3d.slice(),
                    text: `KINEMATIC STALL: ${ch.label} output (${outPart.label}) failed to move under nominal throttle`,
                });
            }
        }
        const aut = rt.getAutopsy();
        for (const f of aut.failed) {
            const fp = byPath.get(f.path);
            findings.push({
                severity: 'error',
                kind: 'MOTION_FAULT',
                partA: f.path,
                partB: null,
                topNodeA: fp?.topNodeId || null,
                topNodeB: null,
                point3d: fp ? fp.pos3d.slice() : [0, 0, 0],
                text: `STARTUP MOTION FAULT: ${f.label} failed (${f.reason}) under nominal operation`,
            });
        }
    }

    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warn').length;
    return {
        ok: errors === 0,
        counts: { errors, warnings, total: findings.length },
        findings,
    };
}
