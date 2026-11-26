// lib/cad/builder.js — Shared precision CAD assembly builder & quaternion helpers.
// Batches hundreds of hex bolts into a single InstancedMesh draw call, builds
// 3-material pillow-block radial ball bearings, manages exploded cutaway offsets,
// and applies analytical stress-heatmap coloring.

import { getCadMaterial, stressTintRgb } from "./materials.js";
import { makeInstanceRow, quatFromYTo } from "./geom.js";
import { ballBearingParts, pillowBlock, hexBoltMesh } from "./parts.js";

export function qAxis(ax, ay, az, ang) {
    const m = Math.hypot(ax, ay, az) || 1;
    const s = Math.sin(ang * 0.5);
    return [(ax / m) * s, (ay / m) * s, (az / m) * s, Math.cos(ang * 0.5)];
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

export function createAssemblyBuilder(scene) {
    const items = [];
    const bolts = [];
    let triCount = 0;

    const addPart = (mesh, materialKey, opts = {}) => {
        if (!mesh || mesh.empty) return null;
        triCount += mesh.triangleCount || 0;
        const mat = getCadMaterial(materialKey);
        const node = scene.createMesh({ mesh, ...mat });
        const basePos = opts.pos ? [...opts.pos] : [0, 0, 0];
        const baseRot = opts.rot ? [...opts.rot] : [0, 0, 0, 1];
        const explode = opts.explode ? [...opts.explode] : [0, 0, 0];
        node.x = basePos[0]; node.y = basePos[1]; node.z = basePos[2];
        node.quaternion = baseRot;
        const rec = {
            id: opts.id || `part_${items.length}`,
            label: opts.label || materialKey,
            materialKey,
            node,
            basePos,
            baseRot,
            explode,
            stressBase: opts.stress ?? 0.22,
            stressLoadScale: opts.stressLoadScale ?? 0.45,
            extra: opts.extra || null,
        };
        items.push(rec);
        return rec;
    };

    const addBearingStation = (x, y, z, { boreR = 0.075, outerR = 0.175, centerH = 0.28, explodeZ = 0, idPrefix = 'brg', speedRatio = 1 } = {}) => {
        const pb = addPart(pillowBlock({ boreR: outerR, width: 0.13, centerH }), 'cast_iron', {
            id: `${idPrefix}_pb`, label: 'Split Pillow Block', pos: [x, y, z], explode: [0, -0.15, explodeZ * 1.15], stress: 0.30,
        });
        const bp = ballBearingParts({ innerR: boreR, outerR, width: 0.088, balls: 10 });
        const races = addPart(bp.racesMesh, 'blued_steel', {
            id: `${idPrefix}_race`, label: 'Hardened Bearing Races', pos: [x, y, z], explode: [0, 0, explodeZ * 1.35], stress: 0.42,
        });
        const cage = addPart(bp.cageMesh, 'turned_brass', {
            id: `${idPrefix}_cage`, label: 'Brass Ball Retainer', pos: [x, y, z], explode: [0, 0, explodeZ * 1.48], stress: 0.25,
            extra: { spinAxis: 'z', ratio: speedRatio * 0.5, phase: 0 },
        });
        const balls = addPart(bp.ballsMesh, 'chrome_shaft', {
            id: `${idPrefix}_balls`, label: 'Chrome Bearing Balls', pos: [x, y, z], explode: [0, 0, explodeZ * 1.48], stress: 0.50,
            extra: { spinAxis: 'z', ratio: speedRatio * 0.5, phase: 0 },
        });
        const footW = outerR + 0.12;
        const baseY = y - centerH + 0.068;
        bolts.push(
            { pos: [x - footW, baseY, z], normal: [0, 1, 0], scale: 1.1 },
            { pos: [x + footW, baseY, z], normal: [0, 1, 0], scale: 1.1 },
            { pos: [x - (outerR + 0.025), y + 0.052, z], normal: [0, 1, 0], scale: 0.92 },
            { pos: [x + (outerR + 0.025), y + 0.052, z], normal: [0, 1, 0], scale: 0.92 },
        );
        return { pb, races, cage, balls };
    };

    const addBolts = (list) => { for (const b of list) bolts.push(b); };

    let boltNode = null;
    const commitBolts = () => {
        if (!bolts.length) return;
        const bMesh = hexBoltMesh(0.024, 0.024);
        triCount += (bMesh.triangleCount || 0) * bolts.length;
        const rows = new Float32Array(bolts.length * 16);
        for (let i = 0; i < bolts.length; i++) {
            const b = bolts[i];
            const n = b.normal || [0, 1, 0];
            const q = quatFromYTo(n[0], n[1], n[2]);
            const s = b.scale ?? 1.0;
            const r = makeInstanceRow(b.pos, q, [s, s, s], [1, 1, 1, 1]);
            rows.set(r, i * 16);
        }
        const mat = getCadMaterial('chrome_shaft');
        boltNode = scene.createInstancedMesh({
            mesh: bMesh, capacity: bolts.length, instances: rows, ...mat,
        });
    };

    const applyStressOverlay = (enabled, loadFactor = 0.5) => {
        for (const it of items) {
            if (!enabled) {
                it.node.color = [1, 1, 1];
            } else {
                const u = it.stressBase + it.stressLoadScale * loadFactor;
                it.node.color = stressTintRgb(u);
            }
        }
    };

    const setRootTransform = (rootPos, rootQuat, explode = 0, animPoseFn = null) => {
        for (const it of items) {
            const localPos = [
                it.basePos[0] + it.explode[0] * explode,
                it.basePos[1] + it.explode[1] * explode,
                it.basePos[2] + it.explode[2] * explode,
            ];
            let localRot = it.baseRot;
            if (animPoseFn) {
                const ov = animPoseFn(it, localPos, localRot, explode);
                if (ov) {
                    if (ov.pos) { localPos[0] = ov.pos[0]; localPos[1] = ov.pos[1]; localPos[2] = ov.pos[2]; }
                    if (ov.rot) localRot = ov.rot;
                }
            }
            const wp = rootPos ? qRot(rootQuat, localPos) : localPos;
            it.node.x = (rootPos ? rootPos[0] : 0) + wp[0];
            it.node.y = (rootPos ? rootPos[1] : 0) + wp[1];
            it.node.z = (rootPos ? rootPos[2] : 0) + wp[2];
            it.node.quaternion = rootQuat ? qMul(rootQuat, localRot) : localRot;
        }
        if (boltNode) {
            boltNode.x = rootPos ? rootPos[0] : 0;
            boltNode.y = rootPos ? rootPos[1] : 0;
            boltNode.z = rootPos ? rootPos[2] : 0;
            boltNode.quaternion = rootQuat || [0, 0, 0, 1];
            boltNode.visible = explode < 0.04;
        }
    };

    const destroy = () => {
        for (const it of items) it.node.destroy();
        items.length = 0;
        if (boltNode) { boltNode.destroy(); boltNode = null; }
    };

    return {
        items, bolts, addPart, addBearingStation, addBolts, commitBolts,
        applyStressOverlay, setRootTransform, destroy,
        getStats: () => ({ partCount: items.length, boltCount: bolts.length, triangles: triCount }),
    };
}
