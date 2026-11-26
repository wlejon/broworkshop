// lib/machine/view.js — Engineered PBR mechanical renderer, Bay 3D picker,
// CAD corner selection brackets, precision face hardpoints, live Bench Test
// animation, and Physical-Form stress overlay.

import { quatYTo } from "/lib/kit/math3d.js";
import { materialOf } from "./materials.js";
import { vAdd, vSub, qMul, qRot, qAxis } from "./compiler.js";
import { getMechanicalMesh, bearingHubMesh } from "./meshes.js";

function hexToRgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
    ];
}

function heatRgb(baseHex, util) {
    const b = hexToRgb(baseHex);
    const u = Math.max(0, Math.min(1.3, util || 0));
    let t = [0.22, 0.88, 0.48], mix = Math.min(0.60, 0.22 + u * 0.65);
    if (u >= 0.55 && u < 0.90) {
        t = [0.98, 0.68, 0.14]; mix = 0.50 + (u - 0.55) * 1.1;
    } else if (u >= 0.90) {
        t = [1.0, 0.18, 0.16]; mix = 0.85;
    }
    return [b[0] * (1 - mix) + t[0] * mix, b[1] * (1 - mix) + t[1] * mix, b[2] * (1 - mix) + t[2] * mix];
}

function makeRod(scene, color, radius = 0.03, emissive = 0.75) {
    const mesh = scene.createMesh({
        mesh: 'cylinder', radius, halfHeight: 0.5, segments: 8,
        color, roughness: 0.35, emissive, emissiveColor: color,
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
        destroy() { mesh.destroy(); },
    };
}

function addCornerBrackets(scene, list, center, half, color = '#e5a024') {
    const minDim = Math.max(0.15, Math.min(half[0], half[1], half[2]));
    const pad = Math.min(0.04, minDim * 0.10);
    const hx = half[0] + pad, hy = half[1] + pad, hz = half[2] + pad;
    const lx = Math.min(0.26, hx * 0.28);
    const ly = Math.min(0.22, hy * 0.32);
    const lz = Math.min(0.26, hz * 0.28);
    const r = Math.max(0.004, Math.min(0.009, minDim * 0.018));
    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const cx = center[0] + sx * hx;
                const cy = center[1] + sy * hy;
                const cz = center[2] + sz * hz;
                const rx = makeRod(scene, color, r, 0.75);
                rx.set([cx, cy, cz], [cx - sx * lx, cy, cz]);
                const ry = makeRod(scene, color, r, 0.75);
                ry.set([cx, cy, cz], [cx, cy - sy * ly, cz]);
                const rz = makeRod(scene, color, r, 0.75);
                rz.set([cx, cy, cz], [cx, cy, cz - sz * lz]);
                list.push(rx, ry, rz);
            }
        }
    }
}

function createPartNode(scene, p, tintRgb) {
    const mat = materialOf(p.material);
    const mesh = getMechanicalMesh(p);
    return scene.createMesh({
        mesh,
        color: tintRgb,
        vertexColorTint: true,
        metallic: mat.metallic,
        roughness: mat.roughness,
        castsShadow: true,
        receivesShadow: true,
    });
}

function rayBoxIntersect(origin, dir, min, max) {
    let tmin = -Infinity, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
        if (Math.abs(dir[i]) < 1e-8) {
            if (origin[i] < min[i] || origin[i] > max[i]) return null;
        } else {
            let t1 = (min[i] - origin[i]) / dir[i];
            let t2 = (max[i] - origin[i]) / dir[i];
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) return null;
        }
    }
    return tmax >= 0 ? Math.max(0, tmin) : null;
}

const FACES = [
    { key: '+X', n: [1, 0, 0] },  { key: '-X', n: [-1, 0, 0] },
    { key: '+Y', n: [0, 1, 0] },  { key: '-Y', n: [0, -1, 0] },
    { key: '+Z', n: [0, 0, 1] },  { key: '-Z', n: [0, 0, -1] },
];

export function createBayView(scene) {
    let partVisuals = [];
    let hubVisuals = [];
    let overlayItems = [];
    let socketOrbs = [];
    let cadItems = [];
    let lastCompiled = null;
    let selectedWorldCenter = null;
    let yShift = 0;

    const clearAll = () => {
        for (const m of partVisuals) m.node.destroy();
        partVisuals = [];
        for (const h of hubVisuals) h.destroy();
        hubVisuals = [];
        for (const o of overlayItems) o.destroy();
        overlayItems = [];
        for (const s of socketOrbs) s.node.destroy();
        socketOrbs = [];
        for (const g of cadItems) g.destroy();
        cadItems = [];
        selectedWorldCenter = null;
    };

    const computeClusterTransforms = (compiled, sweepJointIdx, sweepValue) => {
        const clPos = compiled.clusters.map((c) => [...c.com]);
        const clRot = compiled.clusters.map(() => [0, 0, 0, 1]);
        if (sweepJointIdx >= 0 && sweepJointIdx < compiled.joints.length) {
            const sj = compiled.joints[sweepJointIdx];
            const delta = sweepValue ?? 0;
            const children = Array.from({ length: compiled.clusters.length }, () => []);
            for (const j of compiled.joints) children[j.clusterA].push(j.clusterB);
            const dq = sj.kind === 'hinge' ? qAxis(sj.axis[0], sj.axis[1], sj.axis[2], delta) : [0, 0, 0, 1];
            const dp = sj.kind === 'slider' ? [sj.axis[0] * delta, sj.axis[1] * delta, sj.axis[2] * delta] : [0, 0, 0];
            const applySub = (cid) => {
                if (sj.kind === 'hinge') {
                    const rel = vSub(clPos[cid], sj.anchor);
                    clPos[cid] = vAdd(sj.anchor, qRot(dq, rel));
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

    const render = (compiled, opts = {}) => {
        clearAll();
        lastCompiled = compiled;
        if (!compiled) return;
        const loadCaseName = opts.loadCase || 'off';
        const showHeatmap = loadCaseName !== 'off';
        const lc = showHeatmap ? (compiled.loadCases[loadCaseName] || compiled.loadCases.recoil) : null;
        const selectedId = opts.selectedNodeId || compiled.nodes[0]?.id;
        const selectedSocket = opts.selectedSocket || '+Y';
        const groundY = opts.groundY ?? 0;
        yShift = groundY - compiled.bounds.min[1];
        const { clPos, clRot } = computeClusterTransforms(compiled, opts.sweepJointIdx ?? -1, opts.sweepValue ?? 0);

        let selectedBounds = null;
        for (const cl of compiled.clusters) {
            const cp = clPos[cl.id], cr = clRot[cl.id];
            for (const p of cl.parts) {
                const mat = materialOf(p.material);
                const util = lc ? (lc.nodeUtil[p.id] || 0) : 0;
                const tint = showHeatmap ? heatRgb(mat.color, util) : hexToRgb(mat.color);
                const node = createPartNode(scene, p, tint);
                const wp = vAdd(cp, qRot(cr, p.localPos));
                let wr = qMul(cr, p.rotation);
                if (p.role === 'wheel') wr = qMul(wr, qAxis(0, 0, 1, Math.PI * 0.5));
                node.x = wp[0]; node.y = wp[1] + yShift; node.z = wp[2];
                node.quaternion = wr;
                const rBox = [
                    Math.max(p.half[0], p.radius || 0.2),
                    Math.max(p.half[1], p.halfHeight || 0.2),
                    Math.max(p.half[2], p.radius || 0.2),
                ];
                partVisuals.push({
                    node, part: p, basePos: [wp[0], wp[1] + yShift, wp[2]], baseRot: wr,
                    min: [wp[0] - rBox[0], wp[1] + yShift - rBox[1], wp[2] - rBox[2]],
                    max: [wp[0] + rBox[0], wp[1] + yShift + rBox[1], wp[2] + rBox[2]],
                });
                const isSel = selectedId && (p.id === selectedId || p.rawId === selectedId);
                if (isSel) {
                    selectedBounds = { center: [wp[0], wp[1] + yShift, wp[2]], half: rBox };
                    selectedWorldCenter = [wp[0], wp[1] + yShift, wp[2]];
                }
            }
        }

        // Precision bronze/steel bearing pins at every articulated hinge anchor
        const hubMesh = bearingHubMesh(0.16, 0.20);
        for (const j of compiled.joints) {
            if (j.kind !== 'hinge') continue;
            const hNode = scene.createMesh({ mesh: hubMesh, color: [1, 1, 1], vertexColorTint: true, metallic: 0.88, roughness: 0.28, castsShadow: true });
            hNode.x = j.anchor[0]; hNode.y = j.anchor[1] + yShift; hNode.z = j.anchor[2];
            hNode.quaternion = quatYTo(j.axis[0], j.axis[1], j.axis[2]);
            hubVisuals.push(hNode);
        }

        // Crisp 8-corner CAD selection brackets & precision face hardpoints
        if (selectedBounds && opts.showSockets !== false) {
            if (opts.showSelectionBrackets !== false) {
                addCornerBrackets(scene, cadItems, selectedBounds.center, selectedBounds.half, '#f59e0b');
            }
            for (const f of FACES) {
                const edgePos = [
                    selectedBounds.center[0] + f.n[0] * (selectedBounds.half[0] + 0.02),
                    selectedBounds.center[1] + f.n[1] * (selectedBounds.half[1] + 0.02),
                    selectedBounds.center[2] + f.n[2] * (selectedBounds.half[2] + 0.02),
                ];
                const isActive = f.key === selectedSocket;
                const pos = [
                    edgePos[0] + f.n[0] * (isActive ? 0.14 : 0.08),
                    edgePos[1] + f.n[1] * (isActive ? 0.14 : 0.08),
                    edgePos[2] + f.n[2] * (isActive ? 0.14 : 0.08),
                ];
                const orb = scene.createMesh({
                    mesh: 'cylinder', radius: isActive ? 0.075 : 0.048, halfHeight: isActive ? 0.022 : 0.015, segments: 12,
                    color: isActive ? '#38bdf8' : '#3a556a',
                    metallic: 0.4, roughness: 0.3,
                    emissive: isActive ? 1.15 : 0.25,
                    emissiveColor: isActive ? '#38bdf8' : '#254358',
                });
                orb.x = pos[0]; orb.y = pos[1]; orb.z = pos[2];
                orb.quaternion = quatYTo(f.n[0], f.n[1], f.n[2]);
                socketOrbs.push({ key: f.key, normal: f.n, pos, node: orb });

                if (isActive) {
                    const stem = makeRod(scene, '#38bdf8', 0.012, 0.9);
                    stem.set(edgePos, pos);
                    cadItems.push(stem);

                    if (opts.showGhostFrame && opts.ghostHalf) {
                        const gHalf = opts.ghostHalf;
                        const gp = [
                            selectedBounds.center[0] + f.n[0] * (selectedBounds.half[0] + gHalf[0] + 0.04),
                            selectedBounds.center[1] + f.n[1] * (selectedBounds.half[1] + gHalf[1] + 0.04),
                            selectedBounds.center[2] + f.n[2] * (selectedBounds.half[2] + gHalf[2] + 0.04),
                        ];
                        const x0 = gp[0] - gHalf[0], x1 = gp[0] + gHalf[0];
                        const y0 = gp[1] - gHalf[1], y1 = gp[1] + gHalf[1];
                        const z0 = gp[2] - gHalf[2], z1 = gp[2] + gHalf[2];
                        const edges = [
                            [[x0, y0, z0], [x1, y0, z0]], [[x0, y1, z0], [x1, y1, z0]],
                            [[x0, y0, z1], [x1, y0, z1]], [[x0, y1, z1], [x1, y1, z1]],
                            [[x0, y0, z0], [x0, y1, z0]], [[x1, y0, z0], [x1, y1, z0]],
                            [[x0, y0, z1], [x0, y1, z1]], [[x1, y0, z1], [x1, y1, z1]],
                            [[x0, y0, z0], [x0, y0, z1]], [[x1, y0, z0], [x1, y0, z1]],
                            [[x0, y1, z0], [x0, y1, z1]], [[x1, y1, z0], [x1, y1, z1]],
                        ];
                        for (const [ea, eb] of edges) {
                            const r = makeRod(scene, '#38bdf8', 0.008, 0.85);
                            r.set(ea, eb);
                            cadItems.push(r);
                        }
                    }
                }
            }
        }

        if (showHeatmap && lc) {
            const c = lc.shiftedCom;
            const comCol = lc.tipMargin >= 0 ? '#34d399' : '#f87171';
            const comSphere = scene.createMesh({
                mesh: 'sphere', radius: 0.20, segments: 14, rings: 10,
                color: comCol, emissive: 1.0, emissiveColor: comCol,
            });
            comSphere.x = c[0]; comSphere.y = c[1] + yShift; comSphere.z = c[2];
            overlayItems.push(comSphere);

            const plumb = makeRod(scene, comCol, 0.03, 0.9);
            plumb.set([c[0], c[1] + yShift, c[2]], [c[0], groundY + 0.03, c[2]]);
            overlayItems.push(plumb);

            const poly = lc.supportPoly || [];
            const polyCol = lc.tipMargin >= 0 ? '#10b981' : '#ef4444';
            for (let i = 0; i < poly.length && poly.length >= 2; i++) {
                const a = poly[i], b = poly[(i + 1) % poly.length];
                const edge = makeRod(scene, polyCol, 0.036, 0.9);
                edge.set([a[0], groundY + 0.03, a[1]], [b[0], groundY + 0.03, b[1]]);
                overlayItems.push(edge);
            }

            for (const ff of lc.forceFlow) {
                const col = ff.util > 0.9 ? '#ff3b30' : ff.util > 0.55 ? '#f59e0b' : '#38bdf8';
                const rod = makeRod(scene, col, 0.022 + Math.min(0.04, ff.util * 0.035), 0.85);
                rod.set([ff.from[0], ff.from[1] + yShift, ff.from[2]], [ff.to[0], ff.to[1] + yShift, ff.to[2]]);
                overlayItems.push(rod);
            }
        }
    };

    const animateBench = (t) => {
        if (!lastCompiled) return;
        for (const pv of partVisuals) {
            const p = pv.part;
            if (p.role === 'wheel') {
                pv.node.quaternion = qMul(pv.baseRot, qAxis(0, 1, 0, -t * 3.5));
            } else if (p.meshKind === 'gear' || p.meshKind === 'flywheel' || p.meshKind === 'cam') {
                const rate = p.meshKind === 'flywheel' ? 10.0 : (p.rawId === 'pinion' ? 6.0 : -1.5);
                pv.node.quaternion = qMul(pv.baseRot, qAxis(0, 1, 0, t * rate));
            }
        }
    };

    const pick = (ray) => {
        if (!ray) return null;
        let bestSocket = null, bestSDist = Infinity;
        for (const s of socketOrbs) {
            const min = [s.pos[0] - 0.18, s.pos[1] - 0.18, s.pos[2] - 0.18];
            const max = [s.pos[0] + 0.18, s.pos[1] + 0.18, s.pos[2] + 0.18];
            const d = rayBoxIntersect(ray.origin, ray.dir, min, max);
            if (d !== null && d < bestSDist) { bestSDist = d; bestSocket = s.key; }
        }
        if (bestSocket) return { type: 'socket', socket: bestSocket };

        let bestNode = null, bestNDist = Infinity;
        for (const pv of partVisuals) {
            const d = rayBoxIntersect(ray.origin, ray.dir, pv.min, pv.max);
            if (d !== null && d < bestNDist) { bestNDist = d; bestNode = pv.part; }
        }
        if (bestNode) return { type: 'part', nodeId: bestNode.id, label: `${bestNode.rawId} (${bestNode.material})` };
        return null;
    };

    return {
        render, animateBench, pick, destroy: clearAll,
        getSelectedWorldCenter: () => selectedWorldCenter ? [...selectedWorldCenter] : null,
        getYShift: () => yShift,
    };
}

export function createRuntimeMachineView(scene, inst, opts = {}) {
    const teamTintHex = opts.teamTint || null;
    const partEntries = [];
    for (const cl of inst.compiled.clusters) {
        const body = inst.clusterBodies[cl.id];
        for (const p of cl.parts) {
            const mat = materialOf(p.material);
            const useTeamTint = teamTintHex && (p.role === 'chassis' || p.role === 'turret' || p.role === 'armor');
            const baseRgb = hexToRgb(useTeamTint ? teamTintHex : mat.color);
            const node = createPartNode(scene, p, baseRgb);
            const baseRot = p.role === 'wheel' ? qMul(p.rotation, qAxis(0, 0, 1, Math.PI * 0.5)) : p.rotation;
            partEntries.push({ node, body, clusterId: cl.id, localPos: p.localPos, baseRot, role: p.role, meshKind: p.meshKind, rawId: p.rawId, baseHex: useTeamTint ? teamTintHex : mat.color, baseRgb });
        }
    }

    const sync = (showStress = false) => {
        const world = inst.world;
        const t = inst.mech ? inst.mech.time : 0;
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
            let wr = qMul(bq, e.baseRot);
            if (e.meshKind === 'flywheel' || e.meshKind === 'gear' || e.meshKind === 'cam') {
                const rate = e.meshKind === 'flywheel' ? 14 : (e.rawId === 'pinion' ? 6 : -1.5);
                wr = qMul(wr, qAxis(0, 1, 0, t * rate));
            }
            e.node.x = wp[0]; e.node.y = wp[1]; e.node.z = wp[2];
            e.node.quaternion = wr;
            e.node.visible = true;
            if (showStress) {
                const j = inst.jointByNode.get(inst.compiled.clusters[e.clusterId].rootNode.id);
                const u = j ? (j.broken ? 1.2 : j.util) : 0.15;
                e.node.color = heatRgb(e.baseHex, u);
            } else {
                e.node.color = e.baseRgb;
            }
        }
    };
    sync(false);

    return {
        update: sync,
        destroy() { for (const e of partEntries) e.node.destroy(); partEntries.length = 0; },
    };
}
