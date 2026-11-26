// lib/machine/view.js — 3D visual renderer & Physical-Form Engineering Overlay
// for compiled machines in both the Foundry Bay (static + joint sweep scrubber)
// and Live Battle Arena (physics-driven cluster tracking + live stress colors).

import { quatYTo } from "/lib/kit/math3d.js";
import { materialOf } from "./materials.js";
import { vAdd, qMul, qRot, qAxis } from "./compiler.js";

function heatColor(baseHex, util) {
    // Parse #rrggbb and blend toward green (<0.55) / amber (0.55..0.9) / crimson (>0.9)
    const r0 = parseInt(baseHex.slice(1, 3), 16) / 255;
    const g0 = parseInt(baseHex.slice(3, 5), 16) / 255;
    const b0 = parseInt(baseHex.slice(5, 7), 16) / 255;
    const u = Math.max(0, Math.min(1.3, util || 0));
    let tr = 0.18, tg = 0.85, tb = 0.45, mix = Math.min(0.45, u * 0.6);
    if (u >= 0.55 && u < 0.92) {
        tr = 0.96; tg = 0.68; tb = 0.12; mix = 0.35 + (u - 0.55) * 1.1;
    } else if (u >= 0.92) {
        tr = 1.0; tg = 0.15; tb = 0.12; mix = 0.78;
    }
    const r = Math.round((r0 * (1 - mix) + tr * mix) * 255);
    const g = Math.round((g0 * (1 - mix) + tg * mix) * 255);
    const b = Math.round((b0 * (1 - mix) + tb * mix) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function makeRod(scene, color, radius = 0.04, emissive = 0.6) {
    const mesh = scene.createMesh({
        mesh: 'cylinder', radius, halfHeight: 0.5, segments: 8,
        color, roughness: 0.4, emissive, emissiveColor: color,
    });
    return {
        mesh,
        set(a, b) {
            const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
            const L = Math.hypot(dx, dy, dz);
            mesh.x = (a[0] + b[0]) * 0.5; mesh.y = (a[1] + b[1]) * 0.5; mesh.z = (a[2] + b[2]) * 0.5;
            mesh.quaternion = quatYTo(dx, dy, dz);
            mesh.scaleY = Math.max(0.01, L);
            mesh.visible = true;
        },
        hide() { mesh.visible = false; },
        destroy() { mesh.destroy(); },
    };
}

function createPartMesh(scene, p, tintOverride, highlight) {
    const mat = materialOf(p.material);
    const color = tintOverride || mat.color;
    const opts = {
        color,
        metallic: mat.metallic,
        roughness: mat.roughness,
        castsShadow: true,
        ...(highlight ? { emissive: 0.55, emissiveColor: '#4fc3f7' } : {}),
    };
    if (p.role === 'wheel') {
        // Lateral cylinder aligned along machine X axis (spin axis).
        return scene.createMesh({ mesh: 'cylinder', radius: p.radius, halfHeight: p.halfHeight, segments: 20, ...opts });
    }
    if (p.shape === 'cylinder') {
        return scene.createMesh({ mesh: 'cylinder', radius: p.radius, halfHeight: p.halfHeight, segments: 18, ...opts });
    }
    if (p.shape === 'sphere') {
        return scene.createMesh({ mesh: 'sphere', radius: p.radius, segments: 18, rings: 12, ...opts });
    }
    return scene.createMesh({ mesh: 'box', halfW: p.half[0], halfH: p.half[1], halfD: p.half[2], ...opts });
}

/** Static/interactive Foundry Bay view with load-case heatmap, COM, support hull & joint sweep. */
export function createBayView(scene) {
    let meshes = [];
    let overlayItems = [];
    let currentCompiled = null;

    const clearAll = () => {
        for (const m of meshes) m.node.destroy();
        meshes = [];
        for (const o of overlayItems) o.destroy();
        overlayItems = [];
    };

    const computeClusterTransforms = (compiled, sweepJointIdx, sweepValue) => {
        const clPos = compiled.clusters.map((c) => [...c.com]);
        const clRot = compiled.clusters.map(() => [0, 0, 0, 1]);
        if (sweepJointIdx >= 0 && sweepJointIdx < compiled.joints.length) {
            const sj = compiled.joints[sweepJointIdx];
            const delta = sweepValue ?? 0;
            // Propagate rigid delta transform down subtree rooted at sj.clusterB.
            const children = Array.from({ length: compiled.clusters.length }, () => []);
            for (const j of compiled.joints) children[j.clusterA].push(j.clusterB);
            const dq = sj.kind === 'hinge' ? qAxis(sj.axis[0], sj.axis[1], sj.axis[2], delta) : [0, 0, 0, 1];
            const dp = sj.kind === 'slider' ? [sj.axis[0] * delta, sj.axis[1] * delta, sj.axis[2] * delta] : [0, 0, 0];
            const applySub = (cid) => {
                if (sj.kind === 'hinge') {
                    const rel = [clPos[cid][0] - sj.anchor[0], clPos[cid][1] - sj.anchor[1], clPos[cid][2] - sj.anchor[2]];
                    const r = qRot(dq, rel);
                    clPos[cid] = [sj.anchor[0] + r[0], sj.anchor[1] + r[1], sj.anchor[2] + r[2]];
                    clRot[cid] = qMul(dq, clRot[cid]);
                } else {
                    clPos[cid] = vAdd(clPos[cid], dp);
                }
                for (const ch of children[cid]) applySub(ch);
            };
            applySub(sj.clusterB);
        }
        return { clPos, clRot };
    };

    return {
        render(compiled, opts = {}) {
            clearAll();
            currentCompiled = compiled;
            if (!compiled) return;
            const loadCaseName = opts.loadCase || 'recoil';
            const showHeatmap = loadCaseName !== 'off';
            const lc = showHeatmap ? (compiled.loadCases[loadCaseName] || compiled.loadCases.recoil) : null;
            const selectedId = opts.selectedNodeId || null;
            const groundY = opts.groundY ?? 0;
            const yShift = groundY - compiled.bounds.min[1];
            const { clPos, clRot } = computeClusterTransforms(compiled, opts.sweepJointIdx ?? -1, opts.sweepValue ?? 0);

            for (const cl of compiled.clusters) {
                const cp = clPos[cl.id], cr = clRot[cl.id];
                for (const p of cl.parts) {
                    const mat = materialOf(p.material);
                    const util = lc ? (lc.nodeUtil[p.nodeId || p.id] || 0) : 0;
                    const tint = showHeatmap ? heatColor(mat.color, util) : mat.color;
                    const isSel = selectedId && (p.id === selectedId || p.rawId === selectedId);
                    const node = createPartMesh(scene, p, tint, isSel);
                    const wp = vAdd(cp, qRot(cr, p.localPos));
                    let wr = qMul(cr, p.rotation);
                    if (p.role === 'wheel') wr = qMul(wr, qAxis(0, 0, 1, Math.PI * 0.5));
                    node.x = wp[0]; node.y = wp[1] + yShift; node.z = wp[2];
                    node.quaternion = wr;
                    meshes.push({ node, part: p });
                }
            }

            if (showHeatmap && lc) {
                // COM sphere + plumb line to support hull.
                const c = lc.shiftedCom;
                const comSphere = scene.createMesh({
                    mesh: 'sphere', radius: 0.22, segments: 14, rings: 10,
                    color: lc.tipMargin >= 0 ? '#38d399' : '#ff4d4f',
                    emissive: 0.85, emissiveColor: lc.tipMargin >= 0 ? '#38d399' : '#ff4d4f',
                });
                comSphere.x = c[0]; comSphere.y = c[1] + yShift; comSphere.z = c[2];
                overlayItems.push(comSphere);

                const plumb = makeRod(scene, lc.tipMargin >= 0 ? '#38d399' : '#ff4d4f', 0.035, 0.8);
                plumb.set([c[0], c[1] + yShift, c[2]], [c[0], groundY + 0.03, c[2]]);
                overlayItems.push(plumb);

                // Ground support polygon loop.
                const poly = lc.supportPoly || [];
                const polyCol = lc.tipMargin >= 0 ? '#27c288' : '#ff5555';
                for (let i = 0; i < poly.length && poly.length >= 2; i++) {
                    const a = poly[i], b = poly[(i + 1) % poly.length];
                    const edge = makeRod(scene, polyCol, 0.045, 0.75);
                    edge.set([a[0], groundY + 0.03, a[1]], [b[0], groundY + 0.03, b[1]]);
                    overlayItems.push(edge);
                }

                // Force-flow edges along joints.
                for (const ff of lc.forceFlow) {
                    const col = ff.util > 0.9 ? '#ff3b30' : ff.util > 0.55 ? '#ffaa00' : '#4fc3f7';
                    const rod = makeRod(scene, col, 0.025 + Math.min(0.05, ff.util * 0.04), 0.7);
                    rod.set([ff.from[0], ff.from[1] + yShift, ff.from[2]], [ff.to[0], ff.to[1] + yShift, ff.to[2]]);
                    overlayItems.push(rod);
                }
            }
        },
        destroy: clearAll,
    };
}

/** Live Arena visual synchronizer bound to a spawned runtime machine instance. */
export function createRuntimeMachineView(scene, inst, opts = {}) {
    const teamColor = opts.teamTint || null;
    const partEntries = [];
    for (const cl of inst.compiled.clusters) {
        const body = inst.clusterBodies[cl.id];
        for (const p of cl.parts) {
            const mat = materialOf(p.material);
            const tint = (teamColor && (p.role === 'chassis' || p.role === 'turret' || p.role === 'armor')) ? teamColor : mat.color;
            const node = createPartMesh(scene, p, tint, false);
            const baseRot = p.role === 'wheel' ? qMul(p.rotation, qAxis(0, 0, 1, Math.PI * 0.5)) : p.rotation;
            partEntries.push({ node, body, clusterId: cl.id, localPos: p.localPos, baseRot, role: p.role, baseTint: tint, nodeId: p.id });
        }
    }

    const sync = (showStress = false) => {
        const world = inst.world;
        const poses = new Map();
        for (const cl of inst.compiled.clusters) {
            const b = inst.clusterBodies[cl.id];
            if (world.hasBody(b)) poses.set(b, world.pose(b));
        }
        for (const e of partEntries) {
            const p = poses.get(e.body);
            if (!p) { e.node.visible = false; continue; }
            const bp = [p[0], p[1], p[2]], bq = [p[3], p[4], p[5], p[6]];
            const wp = vAdd(bp, qRot(bq, e.localPos));
            const wr = qMul(bq, e.baseRot);
            e.node.x = wp[0]; e.node.y = wp[1]; e.node.z = wp[2];
            e.node.quaternion = wr;
            e.node.visible = true;
            if (showStress) {
                const j = inst.jointByNode.get(inst.compiled.clusters[e.clusterId].rootNode.id);
                const u = j ? (j.broken ? 1.2 : j.util) : 0.15;
                e.node.color = heatColor(e.baseTint, u);
            } else {
                e.node.color = e.baseTint;
            }
        }
    };
    sync(false);

    return {
        update: sync,
        destroy() { for (const e of partEntries) e.node.destroy(); partEntries.length = 0; },
    };
}
