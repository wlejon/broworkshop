// Single-source building mesh & scene node builder consuming a BuildingBlueprint
// from city-building-blueprint.js across LOD2 (horizon proxy), LOD1 (exterior PBR),
// and LOD0 (enterable + multi-floor furnished interiors with InteriorVolume + local lights).

import { materialProps } from "/lib/pbr-materials.js";
import { generateFloorPlan, computeTierLodColor } from "/lib/city-building-blueprint.js";

function mul3(a, b) {
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

export function uvBox(w, h, d, tileSize = 4.0) {
    const m = Mesh.box(w, h, d);
    const pos = m.positions, nrm = m.normals;
    const uvs = new Float32Array((pos.length / 3) * 2);
    const inv = 1 / Math.max(0.25, tileSize);
    for (let i = 0; i < pos.length / 3; i++) {
        const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
        const ax = Math.abs(nrm[i * 3]), ay = Math.abs(nrm[i * 3 + 1]), az = Math.abs(nrm[i * 3 + 2]);
        if (ay >= ax && ay >= az) {
            uvs[i * 2] = px * inv; uvs[i * 2 + 1] = pz * inv;
        } else if (ax >= az) {
            uvs[i * 2] = pz * inv; uvs[i * 2 + 1] = py * inv;
        } else {
            uvs[i * 2] = px * inv; uvs[i * 2 + 1] = py * inv;
        }
    }
    m.uvs = uvs;
    return m;
}

function quadTriMesh(quads, tileSize = 3.0) {
    const pos = [], nrm = [], uvs = [], idx = [];
    const inv = 1 / tileSize;
    for (const q of quads) {
        const [a, b, c, d] = q;
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const base = pos.length / 3;
        for (const p of [a, b, c, d]) {
            pos.push(p[0], p[1], p[2]);
            nrm.push(nx, ny, nz);
            uvs.push((p[0] + p[2]) * inv, Math.hypot(p[0], p[1]) * inv);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return new Mesh({
        positions: new Float32Array(pos),
        normals: new Float32Array(nrm),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(idx),
    });
}

function triListMesh(tris, tileSize = 3.0) {
    const pos = [], nrm = [], uvs = [], idx = [];
    const inv = 1 / tileSize;
    for (const [a, b, c] of tris) {
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const base = pos.length / 3;
        for (const p of [a, b, c]) {
            pos.push(p[0], p[1], p[2]); nrm.push(nx, ny, nz); uvs.push(p[0] * inv, p[1] * inv);
        }
        idx.push(base, base + 1, base + 2);
    }
    return new Mesh({
        positions: new Float32Array(pos),
        normals: new Float32Array(nrm),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(idx),
    });
}

function buildRoofShapes(bp) {
    const r = bp.roof;
    const roofMeshes = [], trimMeshes = [], wallMeshes = [];
    if (r.type === 'gable') {
        const hw = r.width * 0.5 + r.overhang, hd = r.depth * 0.5 + r.overhang;
        const y0 = r.bottomY - 0.08, y1 = r.bottomY + r.height;
        roofMeshes.push(quadTriMesh([
            [[-hw, y0, hd], [0, y1, hd], [0, y1, -hd], [-hw, y0, -hd]],
            [[0, y1, -hd], [0, y1, hd], [hw, y0, hd], [hw, y0, -hd]],
        ], 3.0));
        // Solid roof underside + gable end triangles
        const gw = r.width * 0.5, gd = r.depth * 0.5;
        wallMeshes.push(triListMesh([
            [[-gw, r.bottomY, gd], [gw, r.bottomY, gd], [0, y1, gd]],
            [[gw, r.bottomY, -gd], [-gw, r.bottomY, -gd], [0, y1, -gd]],
        ], 3.0));
        if (r.hasChimney) {
            trimMeshes.push(uvBox(0.9, r.height * 0.85 + 0.6, 0.9, 2.0).translate(r.width * 0.26, r.bottomY + r.height * 0.65, -r.depth * 0.18));
        }
    } else if (r.type === 'hip') {
        const hw = r.width * 0.5 + r.overhang, hd = r.depth * 0.5 + r.overhang;
        const rw = Math.max(0.2, r.width * 0.25), y0 = r.bottomY - 0.06, y1 = r.bottomY + r.height;
        roofMeshes.push(quadTriMesh([
            [[-hw, y0, hd], [hw, y0, hd], [rw, y1, 0], [-rw, y1, 0]],
            [[hw, y0, -hd], [-hw, y0, -hd], [-rw, y1, 0], [rw, y1, 0]],
        ], 3.0));
        roofMeshes.push(triListMesh([
            [[-hw, y0, -hd], [-hw, y0, hd], [-rw, y1, 0]],
            [[hw, y0, hd], [hw, y0, -hd], [rw, y1, 0]],
        ], 3.0));
    } else if (r.type === 'canopy') {
        roofMeshes.push(uvBox(r.width, r.height, r.depth, 4.0).translate(0, r.bottomY + r.height * 0.5, 0));
    } else if (r.type === 'setback_crown') {
        roofMeshes.push(uvBox(r.width * 0.96, 0.6, r.depth * 0.96, 4.0).translate(0, r.bottomY + 0.3, 0));
        roofMeshes.push(uvBox(r.width * 0.56, r.height, r.depth * 0.56, 4.0).translate(0, r.bottomY + r.height * 0.5, 0));
        if (r.hasSpire) {
            trimMeshes.push(uvBox(0.7, r.spireH, 0.7, 3.0).translate(0, r.bottomY + r.height + r.spireH * 0.5, 0));
        }
    } else {
        // flat_parapet
        const pw = r.width + 0.25, pd = r.depth + 0.25, ph = r.height;
        const y = r.bottomY + ph * 0.5;
        roofMeshes.push(uvBox(pw, 0.28, pd, 4.0).translate(0, r.bottomY + 0.14, 0));
        trimMeshes.push(uvBox(pw, ph, 0.28, 3.0).translate(0, y, pd * 0.5 - 0.14));
        trimMeshes.push(uvBox(pw, ph, 0.28, 3.0).translate(0, y, -pd * 0.5 + 0.14));
        trimMeshes.push(uvBox(0.28, ph, pd - 0.56, 3.0).translate(-pw * 0.5 + 0.14, y, 0));
        trimMeshes.push(uvBox(0.28, ph, pd - 0.56, 3.0).translate(pw * 0.5 - 0.14, y, 0));
        if (r.hvacCount) {
            for (let i = 0; i < r.hvacCount; i++) {
                trimMeshes.push(uvBox(1.8, 1.1, 1.5, 2.0).translate(-r.width * 0.2 + i * 2.8, r.bottomY + 0.75, 0));
            }
        }
    }
    return { roofMeshes, trimMeshes, wallMeshes };
}

function colorMesh(mesh, rgb) {
    const n = mesh.positions.length / 3;
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        cols[i * 4] = rgb[0]; cols[i * 4 + 1] = rgb[1]; cols[i * 4 + 2] = rgb[2]; cols[i * 4 + 3] = 1;
    }
    mesh.colors = cols;
    return mesh;
}

/** Builds a compact, silhouette- and albedo-matched LOD2 Mesh from a BuildingBlueprint. */
export function buildBuildingLod2Data(bp, mats) {
    const pal = bp.materials;
    const parts = [];
    const plinthH = bp.plinth.topY - bp.plinth.bottomY;
    const baseAvg = mats[pal.base]?.averageColor ?? [0.42, 0.40, 0.38];
    parts.push(colorMesh(
        uvBox(bp.width + 0.2, plinthH, bp.depth + 0.2, 4).translate(0, (bp.plinth.bottomY + bp.plinth.topY) * 0.5, 0),
        baseAvg,
    ));
    for (const t of bp.tiers) {
        const h = t.topY - t.bottomY;
        if (t.windowStyle === 'curtain') {
            const glassAvg = mats.curtainGlass?.averageColor ?? [0.06, 0.10, 0.14];
            const role = t.matRole === 'base' ? pal.base : (t.matRole === 'trim' ? pal.trim : pal.wall);
            const wallCol = mul3(mats[role]?.averageColor ?? [0.55, 0.53, 0.50], t.tint ?? [1, 1, 1]);
            parts.push(colorMesh(uvBox(t.width - 0.12, h, t.depth - 0.12, 4).translate(0, (t.bottomY + t.topY) * 0.5, 0), glassAvg));
            const bandCount = Math.min(t.floors, 18);
            const bandStep = h / bandCount;
            const spH = Math.min(1.25, bandStep * 0.36);
            for (let fi = 0; fi < bandCount; fi++) {
                parts.push(colorMesh(uvBox(t.width + 0.06, spH, t.depth + 0.06, 4)
                    .translate(0, t.bottomY + fi * bandStep + spH * 0.5, 0), wallCol));
            }
        } else {
            const c = computeTierLodColor(t, bp, mats);
            parts.push(colorMesh(uvBox(t.width, h, t.depth, 4).translate(0, (t.bottomY + t.topY) * 0.5, 0), c));
        }
    }
    if (bp.archetype === 'shopfront' && pal.awning) {
        const aw = mul3(mats.stucco?.averageColor ?? [0.7, 0.7, 0.7], pal.awning);
        parts.push(colorMesh(uvBox(bp.width * 0.9, 0.35, 1.4, 2).translate(0, 3.1, bp.depth * 0.5 + 0.65), aw));
    }

    const { roofMeshes, trimMeshes, wallMeshes } = buildRoofShapes(bp);
    const roofAvg = mul3(mats[pal.roof]?.averageColor ?? [0.3, 0.3, 0.32], bp.roof.tint ?? [1, 1, 1]);
    const trimAvg = mats[pal.trim]?.averageColor ?? [0.55, 0.54, 0.52];
    const wallAvg = mul3(mats[pal.wall]?.averageColor ?? [0.55, 0.52, 0.48], pal.tint ?? [1, 1, 1]);
    for (const m of roofMeshes) parts.push(colorMesh(m, roofAvg));
    for (const m of trimMeshes) parts.push(colorMesh(m, trimAvg));
    for (const m of wallMeshes) parts.push(colorMesh(m, wallAvg));
    return Mesh.merge(parts);
}

function appendExteriorTierParts(bp, tier, buckets, skipFloor0Walls = false) {
    const pal = bp.materials;
    const addPart = (role, mesh, tint = [1, 1, 1]) => {
        const key = `${role}:${tint[0].toFixed(2)},${tint[1].toFixed(2)},${tint[2].toFixed(2)}`;
        if (!buckets.has(key)) buckets.set(key, { role, tint, meshes: [] });
        buckets.get(key).meshes.push(mesh);
    };
    const roleName = tier.matRole === 'base' ? pal.base : (tier.matRole === 'trim' ? pal.trim : pal.wall);
    const startFloor = skipFloor0Walls && tier.bottomY <= 1.0 ? 1 : 0;

    if (tier.windowStyle === 'curtain') {
        for (let fi = startFloor; fi < tier.floors; fi++) {
            const fy0 = tier.bottomY + fi * tier.floorH;
            const spandrelH = Math.min(1.25, tier.floorH * 0.36);
            const winH = tier.floorH - spandrelH;
            addPart(roleName, uvBox(tier.width + 0.06, spandrelH, tier.depth + 0.06, 4.0)
                .translate(0, fy0 + spandrelH * 0.5, 0), tier.tint);
            addPart('curtainGlass', uvBox(tier.width - 0.12, winH, tier.depth - 0.12, 3.8)
                .translate(0, fy0 + spandrelH + winH * 0.5, 0), [1, 1, 1]);
            // Corner architectural pilasters tying vertical silhouette cleanly
            const pw = 0.72;
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                addPart(roleName, uvBox(pw, winH, pw, 4.0)
                    .translate(sx * (tier.width * 0.5 - pw * 0.5), fy0 + spandrelH + winH * 0.5, sz * (tier.depth * 0.5 - pw * 0.5)), tier.tint);
            }
        }
    } else {
        const baseY = tier.bottomY + startFloor * tier.floorH;
        const remainH = tier.topY - baseY;
        if (remainH > 0.1) {
            addPart(roleName, uvBox(tier.width, remainH, tier.depth, 3.5).translate(0, baseY + remainH * 0.5, 0), tier.tint);
        }
        const bx = Math.max(2, Math.floor(tier.width / bp.baySpacing));
        const bz = Math.max(2, Math.floor(tier.depth / bp.baySpacing));
        for (let fi = startFloor; fi < tier.floors; fi++) {
            const fy0 = tier.bottomY + fi * tier.floorH;
            addPart(pal.trim, uvBox(tier.width + 0.14, 0.20, tier.depth + 0.14, 4.0)
                .translate(0, fy0 + tier.floorH - 0.10, 0), [1, 1, 1]);
            const winW = bp.archetype === 'house' ? 1.35 : 1.55;
            const winH = Math.min(tier.floorH * 0.54, 1.85);
            const wy = fy0 + tier.floorH * 0.54;
            for (let i = 0; i < bx; i++) {
                const wx = ((i + 0.5) / bx - 0.5) * (tier.width - 1.6);
                for (const s of [-1, 1]) {
                    addPart('curtainGlass', uvBox(winW, winH, 0.08, 3.0).translate(wx, wy, s * (tier.depth * 0.5 + 0.02)), [1, 1, 1]);
                }
            }
            for (let j = 0; j < bz; j++) {
                const wz = ((j + 0.5) / bz - 0.5) * (tier.depth - 1.6);
                for (const s of [-1, 1]) {
                    addPart('curtainGlass', uvBox(0.08, winH, winW, 3.0).translate(s * (tier.width * 0.5 + 0.02), wy, wz), [1, 1, 1]);
                }
            }
        }
    }
}

function flushBucketsToNodes(scene, root, buckets, mats, castsShadow = true) {
    const out = [];
    const glassNodes = [];
    for (const b of buckets.values()) {
        if (!b.meshes.length) continue;
        const m = mats[b.role] ?? mats.concrete;
        const n = scene.createMesh(Object.assign({
            data: Mesh.merge(b.meshes),
            castsShadow,
            receivesShadow: true,
        }, materialProps(m, b.tint)));
        root.addChild(n);
        if (b.role === 'curtainGlass') {
            n.emissiveColor = [1.0, 0.78, 0.42];
            n.emissive = 0;
            glassNodes.push(n);
        }
        out.push(n);
    }
    return { out, glassNodes };
}

/** Textured multi-material exterior LOD1 hierarchy sharing exact LOD2 silhouette & roof. */
export function buildBuildingLod1Nodes(scene, bp, mats, opts = {}) {
    const root = scene.createNode({ position: [bp.x, bp.groundY, bp.z], rotation: [0, bp.yaw, 0] });
    const pal = bp.materials;
    const buckets = new Map();
    const addPart = (role, mesh, tint = [1, 1, 1]) => {
        const key = `${role}:${tint[0].toFixed(2)},${tint[1].toFixed(2)},${tint[2].toFixed(2)}`;
        if (!buckets.has(key)) buckets.set(key, { role, tint, meshes: [] });
        buckets.get(key).meshes.push(mesh);
    };

    const plinthH = bp.plinth.topY - bp.plinth.bottomY;
    addPart(pal.base, uvBox(bp.width + 0.24, plinthH, bp.depth + 0.24, 4.0)
        .translate(0, (bp.plinth.bottomY + bp.plinth.topY) * 0.5, 0), [1, 1, 1]);
    for (const tier of bp.tiers) appendExteriorTierParts(bp, tier, buckets, false);

    if (bp.archetype === 'shopfront' && pal.awning) {
        addPart('stucco', uvBox(bp.width * 0.9, 0.35, 1.4, 2.0)
            .translate(0, 3.1, bp.depth * 0.5 + 0.65), pal.awning);
    }

    const { roofMeshes, trimMeshes, wallMeshes } = buildRoofShapes(bp);
    for (const m of roofMeshes) addPart(pal.roof, m, bp.roof.tint);
    for (const m of trimMeshes) addPart(pal.trim, m, [1, 1, 1]);
    for (const m of wallMeshes) addPart(pal.wall, m, pal.tint);

    const { out: nodes, glassNodes } = flushBucketsToNodes(scene, root, buckets, mats, opts.castsShadow ?? true);
    const setNight = (nf) => {
        const on = nf > 0.05;
        for (const gn of glassNodes) {
            gn.emissiveColor = [1.0, 0.76, 0.40];
            gn.emissive = on ? 22.0 * nf : 0;
        }
    };
    return { root, nodes, setNight, destroy() { root.destroy(); } };
}

function buildFurnitureMeshParts(kind) {
    const wood = [], fabric = [], metal = [];
    if (kind === 'desk' || kind === 'reception' || kind === 'counter') {
        const w = kind === 'reception' ? 2.8 : (kind === 'counter' ? 2.4 : 1.5);
        const h = kind === 'reception' || kind === 'counter' ? 1.05 : 0.76;
        const d = kind === 'counter' ? 0.9 : 0.78;
        wood.push(uvBox(w, 0.08, d, 2).translate(0, h - 0.04, 0));
        if (kind === 'desk') {
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                metal.push(uvBox(0.06, h - 0.08, 0.06, 1).translate(sx * (w * 0.45), (h - 0.08) * 0.5, sz * (d * 0.42)));
            }
        } else {
            wood.push(uvBox(w - 0.1, h - 0.08, d - 0.1, 2).translate(0, (h - 0.08) * 0.5, 0));
        }
    } else if (kind === 'chair') {
        fabric.push(uvBox(0.52, 0.08, 0.50, 1).translate(0, 0.46, 0));
        fabric.push(uvBox(0.50, 0.50, 0.07, 1).translate(0, 0.74, -0.22));
        metal.push(uvBox(0.06, 0.42, 0.06, 1).translate(0, 0.21, 0));
        metal.push(uvBox(0.42, 0.04, 0.42, 1).translate(0, 0.02, 0));
    } else if (kind === 'sofa') {
        fabric.push(uvBox(2.0, 0.26, 0.85, 2).translate(0, 0.24, 0));
        fabric.push(uvBox(2.0, 0.48, 0.22, 2).translate(0, 0.56, -0.32));
        for (const s of [-0.9, 0.9]) fabric.push(uvBox(0.2, 0.42, 0.85, 2).translate(s, 0.40, 0));
        wood.push(uvBox(1.88, 0.10, 0.75, 2).translate(0, 0.05, 0));
    } else if (kind === 'bed') {
        wood.push(uvBox(1.75, 0.22, 2.15, 2).translate(0, 0.18, 0));
        wood.push(uvBox(1.80, 0.95, 0.10, 2).translate(0, 0.52, -1.04));
        fabric.push(uvBox(1.62, 0.22, 1.98, 2).translate(0, 0.39, 0.04));
        fabric.push(uvBox(1.30, 0.12, 0.42, 1).translate(0, 0.52, -0.72));
    } else if (kind === 'table_round' || kind === 'conference_table') {
        const w = kind === 'conference_table' ? 3.2 : 1.3;
        const d = kind === 'conference_table' ? 1.3 : 1.3;
        wood.push(uvBox(w, 0.07, d, 2).translate(0, 0.72, 0));
        metal.push(uvBox(0.14, 0.68, 0.14, 1).translate(0, 0.34, 0));
        metal.push(uvBox(w * 0.4, 0.04, d * 0.4, 1).translate(0, 0.02, 0));
    } else if (kind === 'shelf') {
        wood.push(uvBox(0.45, 2.0, 1.6, 2).translate(0, 1.0, 0));
    } else if (kind === 'bench') {
        wood.push(uvBox(2.1, 0.08, 0.56, 2).translate(0, 0.46, 0));
        metal.push(uvBox(0.08, 0.44, 0.50, 1).translate(-0.85, 0.22, 0));
        metal.push(uvBox(0.08, 0.44, 0.50, 1).translate(0.85, 0.22, 0));
    } else if (kind === 'planter') {
        metal.push(uvBox(0.75, 0.62, 0.75, 2).translate(0, 0.31, 0));
        fabric.push(uvBox(0.62, 0.75, 0.62, 1).translate(0, 0.85, 0));
    }
    return { wood, fabric, metal };
}

/** Full enterable LOD0 hierarchy with hollow interior floors, doorway, furniture,
 *  Phase 1 InteriorVolume enclosure(s), and bounded tiled local lights. */
export function buildBuildingLod0(scene, bp, mats, opts = {}) {
    const root = scene.createNode({ position: [bp.x, bp.groundY, bp.z], rotation: [0, bp.yaw, 0] });
    const pal = bp.materials;
    const buckets = new Map();
    const addPart = (role, mesh, tint = [1, 1, 1]) => {
        const key = `${role}:${tint[0].toFixed(2)},${tint[1].toFixed(2)},${tint[2].toFixed(2)}`;
        if (!buckets.has(key)) buckets.set(key, { role, tint, meshes: [] });
        buckets.get(key).meshes.push(mesh);
    };

    const t0 = bp.tiers[0];
    const plinthH = bp.plinth.topY - bp.plinth.bottomY;
    addPart(pal.base, uvBox(bp.width + 0.24, plinthH, bp.depth + 0.24, 4.0)
        .translate(0, (bp.plinth.bottomY + bp.plinth.topY) * 0.5, 0), [1, 1, 1]);

    // Upper tiers remain solid/textured identically to LOD1
    for (let ti = 0; ti < bp.tiers.length; ti++) {
        appendExteriorTierParts(bp, bp.tiers[ti], buckets, true);
    }

    // Hollow ground floor with front doorway opening (+Z) and interior floors/furniture
    const wt = 0.28;
    const gY0 = t0.bottomY;
    const gH = t0.floorH;
    const gw = t0.width, gd = t0.depth;
    const doorW = Math.min(bp.doorway.width, gw * 0.45);
    const doorH = Math.min(bp.doorway.height, gH - 0.35);
    const sideW = (gw - doorW) * 0.5;
    const wallRole = t0.matRole === 'base' ? pal.base : (t0.matRole === 'trim' ? pal.trim : pal.wall);

    // Interior ground floor slab + ceiling slab
    const floorMat = bp.archetype === 'house' ? 'woodFloor' : 'lobbyTile';
    addPart(floorMat, uvBox(gw - 0.1, 0.22, gd - 0.1, 3.0).translate(0, gY0 + 0.11, 0), [1, 1, 1]);
    addPart('stucco', uvBox(gw - 0.1, 0.22, gd - 0.1, 4.0).translate(0, gY0 + gH - 0.11, 0), [0.92, 0.90, 0.88]);

    // Ground back & side walls + warm plaster drywall interior liners + front piers
    addPart(wallRole, uvBox(gw, gH, wt, 3.5).translate(0, gY0 + gH * 0.5, -gd * 0.5 + wt * 0.5), t0.tint);
    addPart(wallRole, uvBox(wt, gH, gd - wt * 2, 3.5).translate(-gw * 0.5 + wt * 0.5, gY0 + gH * 0.5, 0), t0.tint);
    addPart(wallRole, uvBox(wt, gH, gd - wt * 2, 3.5).translate(gw * 0.5 - wt * 0.5, gY0 + gH * 0.5, 0), t0.tint);
    addPart('stucco', uvBox(gw - wt * 2.8, gH - 0.44, 0.08, 4.0).translate(0, gY0 + gH * 0.5, -gd * 0.5 + wt + 0.14), [0.95, 0.92, 0.87]);
    addPart('stucco', uvBox(0.08, gH - 0.44, gd - wt * 2.8, 4.0).translate(-gw * 0.5 + wt + 0.14, gY0 + gH * 0.5, 0), [0.95, 0.92, 0.87]);
    addPart('stucco', uvBox(0.08, gH - 0.44, gd - wt * 2.8, 4.0).translate(gw * 0.5 - wt - 0.14, gY0 + gH * 0.5, 0), [0.95, 0.92, 0.87]);
    if (sideW > 0.1) {
        addPart(wallRole, uvBox(sideW, gH, wt, 3.5).translate(-doorW * 0.5 - sideW * 0.5, gY0 + gH * 0.5, gd * 0.5 - wt * 0.5), t0.tint);
        addPart(wallRole, uvBox(sideW, gH, wt, 3.5).translate(doorW * 0.5 + sideW * 0.5, gY0 + gH * 0.5, gd * 0.5 - wt * 0.5), t0.tint);
    }
    if (gH - doorH > 0.15) {
        addPart(wallRole, uvBox(doorW, gH - doorH, wt, 3.5).translate(0, gY0 + doorH + (gH - doorH) * 0.5, gd * 0.5 - wt * 0.5), t0.tint);
    }

    // Furnished ground floor interior (+ optional upper interior floor plan metadata/core)
    const plan0 = generateFloorPlan(bp, 0);
    const fy = gY0 + 0.22;
    addPart('stucco', uvBox(plan0.core.w, gH - 0.44, plan0.core.d, 4.0)
        .translate(plan0.core.x, gY0 + gH * 0.5, plan0.core.z), [0.89, 0.87, 0.83]);
    for (const pw of plan0.walls) {
        addPart('stucco', uvBox(pw.w, gH - 0.44, pw.d, 3.0).translate(pw.x, gY0 + gH * 0.5, pw.z), [0.92, 0.90, 0.86]);
    }
    for (const it of plan0.items) {
        const parts = buildFurnitureMeshParts(it.kind);
        const s = it.scale ?? 1;
        for (const m of parts.wood) addPart('woodFloor', m.scale(s, s, s).rotate(0, 1, 0, it.rot).translate(it.x, fy, it.z), [0.86, 0.72, 0.55]);
        for (const m of parts.fabric) addPart('stucco', m.scale(s, s, s).rotate(0, 1, 0, it.rot).translate(it.x, fy, it.z), it.kind === 'planter' ? [0.22, 0.45, 0.24] : [0.42, 0.48, 0.58]);
        for (const m of parts.metal) addPart('brushedMetal', m.scale(s, s, s).rotate(0, 1, 0, it.rot).translate(it.x, fy, it.z), [0.85, 0.85, 0.88]);
    }

    if (bp.archetype === 'shopfront' && pal.awning) {
        addPart('stucco', uvBox(bp.width * 0.9, 0.35, 1.4, 2.0)
            .translate(0, 3.1, bp.depth * 0.5 + 0.65), pal.awning);
    }

    const { roofMeshes, trimMeshes, wallMeshes } = buildRoofShapes(bp);
    for (const m of roofMeshes) addPart(pal.roof, m, bp.roof.tint);
    for (const m of trimMeshes) addPart(pal.trim, m, [1, 1, 1]);
    for (const m of wallMeshes) addPart(pal.wall, m, pal.tint);

    const { out: nodes, glassNodes } = flushBucketsToNodes(scene, root, buckets, mats, opts.castsShadow ?? true);

    // Phase 1 InteriorVolume + bounded non-shadow tiled ceiling Point lights
    const cy = Math.cos(bp.yaw), sy = Math.sin(bp.yaw);
    const toWorld = (lx, ly, lz) => [bp.x + cy * lx + sy * lz, bp.groundY + ly, bp.z - sy * lx + cy * lz];
    const interiorVolume = scene.createInteriorVolume({
        size: [gw - 0.3, gH - 0.2, gd - 0.3],
        position: toWorld(0, gY0 + gH * 0.5, 0),
        rotation: [0, bp.yaw, 0],
        skyVisibility: 0.08,
        sunVisibility: 0.25,
        ambientColor: [1.0, 0.90, 0.74],
        ambientIntensity: 0.95,
        blendDistance: 0.9,
        priority: 2,
        affectExposure: true,
    });

    const lights = [];
    const lightOffsets = gw > 14 ? [[-gw * 0.22, 0], [gw * 0.22, 0]] : [[0, 0]];
    for (const [lx, lz] of lightOffsets) {
        const l = scene.createLight({
            type: 'point',
            position: toWorld(lx, gY0 + gH - 0.55, lz),
            color: [1.0, 0.88, 0.70],
            intensity: 45,
            range: Math.max(10, Math.max(gw, gd) * 0.85),
            castsShadow: false,
        });
        lights.push(l);
    }

    const setNight = (nf) => {
        const on = nf > 0.05;
        for (const gn of glassNodes) {
            gn.emissiveColor = [1.0, 0.76, 0.40];
            gn.emissive = on ? 22.0 * nf : 0;
        }
    };

    return {
        root,
        nodes,
        interiorVolume,
        lights,
        setNight,
        destroy() {
            interiorVolume.destroy();
            for (const l of lights) l.destroy();
            root.destroy();
        },
    };
}
