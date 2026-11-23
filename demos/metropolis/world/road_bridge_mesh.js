// Static world-space PBR road ribbon, elevated bridge, and rail viaduct mesher.
// Built once per active 512m sector so shadows & GPU draw lists stay cached cleanly.

import { SECTOR_SIZE, WATER_Y, RIVER_BED_Y, terrainHeight } from "/app/world/terrain_field.js";
import { materialProps } from "/lib/pbr-materials.js";
import { uvBox } from "/lib/city-building-mesh.js";

function appendMeshToArrays(acc, mesh) {
    const base = acc.pos.length / 3;
    const p = mesh.positions, n = mesh.normals, u = mesh.uvs, idx = mesh.indices;
    for (let i = 0; i < p.length; i++) acc.pos.push(p[i]);
    for (let i = 0; i < n.length; i++) acc.nrm.push(n[i]);
    for (let i = 0; i < u.length; i++) acc.uvs.push(u[i]);
    for (let i = 0; i < idx.length; i++) acc.idx.push(base + idx[i]);
}

function makeEmptyAcc() {
    return { pos: [], nrm: [], uvs: [], idx: [] };
}

function accToMesh(acc) {
    if (!acc.idx.length) return null;
    return new Mesh({
        positions: new Float32Array(acc.pos),
        normals: new Float32Array(acc.nrm),
        uvs: new Float32Array(acc.uvs),
        indices: new Uint32Array(acc.idx),
    });
}

function appendRibbonStrip(acc, samples, halfOffsetL, halfOffsetR, yOffset, skirtDepth, uvScale = 0.1) {
    if (samples.length < 2) return;
    const base = acc.pos.length / 3;
    let dist = 0;
    for (let i = 0; i < samples.length; i++) {
        const cur = samples[i];
        const nxt = samples[Math.min(samples.length - 1, i + 1)];
        const prv = samples[Math.max(0, i - 1)];
        if (i > 0) dist += Math.hypot(cur.x - prv.x, cur.z - prv.z);
        const tx = nxt.x - prv.x, tz = nxt.z - prv.z;
        const tl = Math.hypot(tx, tz) || 1;
        const nx = -tz / tl, nz = tx / tl;

        const lx = cur.x + nx * halfOffsetL, lz = cur.z + nz * halfOffsetL;
        const rx = cur.x + nx * halfOffsetR, rz = cur.z + nz * halfOffsetR;
        const y = cur.y + yOffset;
        acc.pos.push(lx, y, lz, rx, y, rz);
        acc.nrm.push(0, 1, 0, 0, 1, 0);
        acc.uvs.push(halfOffsetL * uvScale, dist * uvScale, halfOffsetR * uvScale, dist * uvScale);
        if (i > 0) {
            const b = base + (i - 1) * 2;
            acc.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
    }
    if (skirtDepth > 0) {
        // Left & right side skirts extending below terrain so hillsides never leave underside cracks
        for (const offset of [halfOffsetL, halfOffsetR]) {
            const sb = acc.pos.length / 3;
            const sign = offset < 0 ? -1 : 1;
            let sdist = 0;
            for (let i = 0; i < samples.length; i++) {
                const cur = samples[i];
                const nxt = samples[Math.min(samples.length - 1, i + 1)];
                const prv = samples[Math.max(0, i - 1)];
                if (i > 0) sdist += Math.hypot(cur.x - prv.x, cur.z - prv.z);
                const tx = nxt.x - prv.x, tz = nxt.z - prv.z;
                const tl = Math.hypot(tx, tz) || 1;
                const nx = -tz / tl, nz = tx / tl;
                const px = cur.x + nx * offset, pz = cur.z + nz * offset;
                const yt = cur.y + yOffset;
                const yb = yt - skirtDepth;
                acc.pos.push(px, yt, pz, px, yb, pz);
                acc.nrm.push(nx * sign, 0, nz * sign, nx * sign, 0, nz * sign);
                acc.uvs.push(sdist * uvScale, 0, sdist * uvScale, skirtDepth * uvScale);
                if (i > 0) {
                    const b = sb + (i - 1) * 2;
                    if (sign > 0) acc.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
                    else acc.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
                }
            }
        }
    }
}

export function buildSectorRoadAndBridgeNodes(scene, graph, sectorData, mats) {
    const sx = sectorData.sx, sz = sectorData.sz;
    const xMin = sx * SECTOR_SIZE, xMax = xMin + SECTOR_SIZE;
    const zMin = sz * SECTOR_SIZE, zMax = zMin + SECTOR_SIZE;

    const ownsPoint = (x, z) => x >= xMin && x < xMax && z >= zMin && z < zMax;
    const asphaltAcc = makeEmptyAcc();
    const concreteAcc = makeEmptyAcc();
    const steelAcc = makeEmptyAcc();

    // 1. Roads and bridges owned by this sector (by segment midpoint so zero duplicates across sectors)
    for (const seg of sectorData.roads) {
        const mx = 0.5 * (seg.x0 + seg.x1), mz = 0.5 * (seg.z0 + seg.z1);
        if (!ownsPoint(mx, mz)) continue;

        const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
        const steps = Math.max(4, Math.ceil(len / (seg.isBridge ? 8 : 10)));
        const samples = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            samples.push({
                x: seg.x0 + (seg.x1 - seg.x0) * t,
                y: graph.sampleRoadDeckY(seg, t),
                z: seg.z0 + (seg.z1 - seg.z0) * t,
            });
        }

        // Road surface strip (+ embankment skirt down into hillside)
        appendRibbonStrip(asphaltAcc, samples, -seg.halfW, seg.halfW, 0.04, seg.isBridge ? 0.5 : 2.6, 0.12);

        if (seg.hasSidewalk) {
            appendRibbonStrip(concreteAcc, samples, -seg.halfW - seg.sidewalkW, -seg.halfW, 0.18, seg.isBridge ? 0.9 : 2.8, 0.2);
            appendRibbonStrip(concreteAcc, samples, seg.halfW, seg.halfW + seg.sidewalkW, 0.18, seg.isBridge ? 0.9 : 2.8, 0.2);
        }

        // Sculpted Bridge Piers, Arch/Towers & Deck Underside
        if (seg.isBridge) {
            const dx = seg.x1 - seg.x0, dz = seg.z1 - seg.z0;
            const yaw = Math.atan2(dx, dz);
            // Underside box girder across main water span
            for (const f of [0.32, 0.5, 0.68]) {
                const px = seg.x0 + dx * f, pz = seg.z0 + dz * f;
                const py = graph.sampleRoadDeckY(seg, f);
                const pierTop = py - 0.35;
                const pierBot = RIVER_BED_Y - 1.5;
                const ph = pierTop - pierBot;
                appendMeshToArrays(concreteAcc, uvBox(2.2, ph, 14.0, 4).rotate(0, 1, 0, yaw).translate(px, pierBot + ph * 0.5, pz));
            }
            // Architectural steel superstructure per bridge style
            const midX = seg.x0 + dx * 0.5, midZ = seg.z0 + dz * 0.5;
            const midY = graph.sampleRoadDeckY(seg, 0.5);
            if (seg.bridgeStyle === 'cable_stay') {
                for (const s of [0.36, 0.64]) {
                    const tx = seg.x0 + dx * s, tz = seg.z0 + dz * s;
                    const ty = graph.sampleRoadDeckY(seg, s);
                    appendMeshToArrays(steelAcc, uvBox(1.8, 34, 1.8, 3).translate(tx, ty + 16, tz - seg.halfW * 0.85));
                    appendMeshToArrays(steelAcc, uvBox(1.8, 34, 1.8, 3).translate(tx, ty + 16, tz + seg.halfW * 0.85));
                }
            } else {
                // Steel arch / truss ribs flanking deck
                const archSpan = len * (seg.spanEndT - seg.spanStartT);
                const nRibs = 10;
                for (let ri = 0; ri < nRibs; ri++) {
                    const sf = (ri + 0.5) / nRibs;
                    const gt = seg.spanStartT + (seg.spanEndT - seg.spanStartT) * sf;
                    const rx = seg.x0 + dx * gt, rz = seg.z0 + dz * gt;
                    const ry = graph.sampleRoadDeckY(seg, gt);
                    const archH = seg.bridgeStyle === 'arch' ? 4.0 + Math.sin(sf * Math.PI) * 14.0 : 8.5;
                    appendMeshToArrays(steelAcc, uvBox(0.9, archH, 0.9, 2).translate(rx, ry + archH * 0.5, rz - seg.halfW - 0.6));
                    appendMeshToArrays(steelAcc, uvBox(0.9, archH, 0.9, 2).translate(rx, ry + archH * 0.5, rz + seg.halfW + 0.6));
                    if (ri > 0 && ri < nRibs - 1) {
                        appendMeshToArrays(steelAcc, uvBox(archSpan / nRibs + 1.0, 0.9, seg.halfW * 2 + 2.0, 3)
                            .rotate(0, 1, 0, Math.atan2(-dz, dx)).translate(rx, ry + archH, rz));
                    }
                }
            }
            // Twin pedestrian/traffic safety barriers along bridge deck
            appendMeshToArrays(steelAcc, uvBox(len * 0.95, 1.05, 0.35, 3).rotate(0, 1, 0, Math.atan2(-dz, dx)).translate(midX, midY + 0.5, midZ - seg.halfW - 1.5));
            appendMeshToArrays(steelAcc, uvBox(len * 0.95, 1.05, 0.35, 3).rotate(0, 1, 0, Math.atan2(-dz, dx)).translate(midX, midY + 0.5, midZ + seg.halfW + 1.5));
        }
    }

    // 2. Elevated Commuter Rail Viaduct segments owned by this sector
    for (const tr of sectorData.transit) {
        const mx = 0.5 * (tr.x0 + tr.x1), mz = 0.5 * (tr.z0 + tr.z1);
        if (!ownsPoint(mx, mz)) continue;
        const samples = [
            { x: tr.x0, y: tr.y0, z: tr.z0 },
            { x: mx, y: 0.5 * (tr.y0 + tr.y1), z: mz },
            { x: tr.x1, y: tr.y1, z: tr.z1 },
        ];
        appendRibbonStrip(concreteAcc, samples, -3.4, 3.4, 0.0, 1.6, 0.15);
        appendRibbonStrip(steelAcc, samples, -1.25, -0.95, 0.12, 0.2, 0.25);
        appendRibbonStrip(steelAcc, samples, 0.95, 1.25, 0.12, 0.2, 0.25);
        // Support column down to terrainHeight - 2.0
        const gy = terrainHeight(mx, mz);
        const topY = 0.5 * (tr.y0 + tr.y1) - 1.3;
        const botY = Math.min(gy - 2.0, WATER_Y - 5.0);
        if (topY > botY + 0.5) {
            appendMeshToArrays(concreteAcc, uvBox(1.5, topY - botY, 1.5, 4).translate(mx, 0.5 * (topY + botY), mz));
        }
    }

    const nodes = [];
    const pushBucket = (acc, mat, tint = [1, 1, 1], cast = true) => {
        const m = accToMesh(acc);
        if (!m) return;
        nodes.push(scene.createMesh(Object.assign({
            data: m,
            castsShadow: cast,
            receivesShadow: true,
        }, materialProps(mat, tint))));
    };

    pushBucket(asphaltAcc, mats.asphalt, [1, 1, 1], false);
    pushBucket(concreteAcc, mats.concrete, [0.92, 0.91, 0.89], true);
    pushBucket(steelAcc, mats.brushedMetal, [0.72, 0.76, 0.80], true);

    return {
        nodes,
        destroy() { for (const n of nodes) n.destroy(); },
    };
}
