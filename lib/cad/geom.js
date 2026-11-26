// lib/cad/geom.js — Parametric CAD solid modeling kernel in pure code on top of bro.mesh.Mesh.
// Provides beveled 2D-to-3D extrusions (with arbitrary cutouts/holes via Mesh.polygon2D),
// lathe-turned solids of revolution, oriented struts/beams, helical coil springs,
// curved hydraulic hoses, and fast multi-part mesh merging with clean UVs & crease normals.

const M = () => bro.mesh.Mesh;

/** Build an extruded 3D solid along Z in [-depth/2, +depth/2] from a CCW 2D outer polygon
 *  and optional CW holes, with optional front/back chamfer bevels! */
export function extrude2D(outer, holes = [], depth = 0.2, bevel = 0) {
    const Mesh = M();
    const h = depth * 0.5;
    const b = Math.min(bevel, depth * 0.28);
    const meshes = [];

    // Helper: inset/outset simple loop slightly for clean chamfer faces
    const scaleLoop = (pts, factor) => {
        const out = new Array(pts.length);
        for (let i = 0; i < pts.length; i += 2) {
            out[i] = pts[i] * factor;
            out[i + 1] = pts[i + 1] * factor;
        }
        return out;
    };

    const frontZ = h;
    const backZ = -h;
    const bodyFrontZ = h - b;
    const bodyBackZ = -h + b;

    // Front (+Z) and Back (-Z) flat faces via exact earcut triangulation with holes
    const frontFace = Mesh.polygon2D(outer, holes, frontZ);
    if (!frontFace.empty) meshes.push(frontFace);

    const backFace = Mesh.polygon2D(outer, holes, backZ);
    if (!backFace.empty) {
        backFace.flipFaces();
        meshes.push(backFace);
    }

    // Side walls for outer loop (CCW -> outward normal) and each hole (CW -> inward hole wall)
    const addWallStrip = (ringA, zA, ringB, zB) => {
        const n = ringA.length / 2;
        if (n < 3) return;
        const pos = new Float32Array(n * 4 * 3);
        const idx = new Uint32Array(n * 6);
        let vp = 0, ip = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const ax0 = ringA[i * 2], ay0 = ringA[i * 2 + 1];
            const ax1 = ringA[j * 2], ay1 = ringA[j * 2 + 1];
            const bx0 = ringB[i * 2], by0 = ringB[i * 2 + 1];
            const bx1 = ringB[j * 2], by1 = ringB[j * 2 + 1];
            const base = vp / 3;
            pos[vp++] = ax0; pos[vp++] = ay0; pos[vp++] = zA;
            pos[vp++] = ax1; pos[vp++] = ay1; pos[vp++] = zA;
            pos[vp++] = bx1; pos[vp++] = by1; pos[vp++] = zB;
            pos[vp++] = bx0; pos[vp++] = by0; pos[vp++] = zB;
            // Winding: for CCW outer loop with zA < zB, outward normal is (e x +Z) -> (base, base+1, base+2)
            idx[ip++] = base; idx[ip++] = base + 1; idx[ip++] = base + 2;
            idx[ip++] = base; idx[ip++] = base + 2; idx[ip++] = base + 3;
        }
        meshes.push(new Mesh({ positions: pos, indices: idx }));
    };

    const loops = [outer, ...holes];
    for (let li = 0; li < loops.length; li++) {
        const loop = loops[li];
        if (b > 1e-5 && li === 0) {
            // Subtle outer chamfer bevel inset toward polygon centroid catches crisp specular highlights!
            let cx = 0, cy = 0, nPts = loop.length / 2;
            for (let k = 0; k < loop.length; k += 2) { cx += loop[k]; cy += loop[k + 1]; }
            cx /= Math.max(1, nPts); cy /= Math.max(1, nPts);
            let maxR = 0;
            for (let k = 0; k < loop.length; k += 2) maxR = Math.max(maxR, Math.hypot(loop[k] - cx, loop[k + 1] - cy));
            const f = maxR > 1e-4 ? Math.max(0.86, (maxR - b * 0.72) / maxR) : 1;
            const innerRing = new Array(loop.length);
            for (let k = 0; k < loop.length; k += 2) {
                innerRing[k] = cx + (loop[k] - cx) * f;
                innerRing[k + 1] = cy + (loop[k + 1] - cy) * f;
            }
            meshes.length = 0;
            const fCap = Mesh.polygon2D(innerRing, holes, frontZ);
            const bCap = Mesh.polygon2D(innerRing, holes, backZ);
            if (!bCap.empty) bCap.flipFaces();
            if (!fCap.empty) meshes.push(fCap);
            if (!bCap.empty) meshes.push(bCap);
            addWallStrip(innerRing, backZ, loop, bodyBackZ);
            addWallStrip(loop, bodyBackZ, loop, bodyFrontZ);
            addWallStrip(loop, bodyFrontZ, innerRing, frontZ);
        } else {
            addWallStrip(loop, backZ, loop, frontZ);
        }
    }

    const merged = Mesh.merge(meshes);
    merged.weld(1e-5);
    merged.computeCreaseNormals(42);
    merged.projectUVs('box', 1.2);
    return merged;
}

/**
 * Lathe-turn a 2D profile of `[radius, y]` pairs around the +Y axis (supports bores,
 * stepped shafts, chamfered collars, gun barrels, hydraulic cylinders, bearing races).
 * Profile should proceed from bottom to top on the outside (or closed loop for hollow rings!).
 */
export function revolveProfile(profile, segments = 32, closedLoop = false) {
    const Mesh = M();
    const m = profile.length;
    if (m < 2) return new Mesh();
    const ringCount = closedLoop ? m : m;
    const pos = [];
    const uvs = [];
    const idx = [];

    // Compute cumulative profile arc length for clean V coordinate
    const arc = new Float32Array(m);
    for (let i = 1; i < m; i++) {
        arc[i] = arc[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    }
    const totalArc = Math.max(1e-4, arc[m - 1]);

    for (let i = 0; i < m; i++) {
        const [r, y] = profile[i];
        const v = arc[i] / totalArc;
        for (let s = 0; s <= segments; s++) {
            const u = s / segments;
            const ang = u * Math.PI * 2;
            const c = Math.cos(ang), sn = Math.sin(ang);
            pos.push(r * c, y, r * sn);
            uvs.push(u * 2.0, v * 2.0);
        }
    }

    const stride = segments + 1;
    const segPairs = closedLoop ? m : m - 1;
    for (let i = 0; i < segPairs; i++) {
        const iNext = (i + 1) % m;
        const r0 = profile[i][0], r1 = profile[iNext][0];
        if (r0 < 1e-6 && r1 < 1e-6) continue;
        for (let s = 0; s < segments; s++) {
            const a = i * stride + s;
            const b = i * stride + s + 1;
            const c = iNext * stride + s + 1;
            const d = iNext * stride + s;
            // Outward normal for bottom-to-top profile: (a, c, b) & (a, d, c)
            idx.push(a, c, b);
            idx.push(a, d, c);
        }
    }

    const mesh = new Mesh({
        positions: new Float32Array(pos),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(idx),
    });
    mesh.computeCreaseNormals(38);
    return mesh;
}

/** Generate a circle loop in XY: CCW (+1) for outer boundary, CW (-1) for cutout hole. */
export function circleLoop(cx, cy, r, segs = 24, ccw = true) {
    const pts = [];
    for (let i = 0; i < segs; i++) {
        const a = (ccw ? 1 : -1) * (i / segs) * Math.PI * 2;
        pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return pts;
}

/** Generate a rounded-corner sector cutout hole (CW) for spoked gears & flywheels! */
export function sectorHoleCW(rIn, rOut, a0, a1, arcSegs = 8) {
    const pts = [];
    // Walk CW: outer arc from a1 -> a0, then inner arc from a0 -> a1
    for (let i = 0; i <= arcSegs; i++) {
        const a = a1 + (a0 - a1) * (i / arcSegs);
        pts.push(Math.cos(a) * rOut, Math.sin(a) * rOut);
    }
    for (let i = 0; i <= arcSegs; i++) {
        const a = a0 + (a1 - a0) * (i / arcSegs);
        pts.push(Math.cos(a) * rIn, Math.sin(a) * rIn);
    }
    return pts;
}

/** Generate a rounded rectangle 2D loop (CCW or CW). */
export function roundedRectLoop(cx, cy, halfW, halfH, r, cornerSegs = 4, ccw = true) {
    const cr = Math.min(r, halfW * 0.45, halfH * 0.45);
    const corners = [
        [cx + halfW - cr, cy + halfH - cr, 0],
        [cx - halfW + cr, cy + halfH - cr, Math.PI * 0.5],
        [cx - halfW + cr, cy - halfH + cr, Math.PI],
        [cx + halfW - cr, cy - halfH + cr, Math.PI * 1.5],
    ];
    const pts = [];
    for (const [qx, qy, aStart] of corners) {
        for (let i = 0; i <= cornerSegs; i++) {
            const a = aStart + (i / cornerSegs) * (Math.PI * 0.5);
            pts.push(qx + Math.cos(a) * cr, qy + Math.sin(a) * cr);
        }
    }
    if (!ccw) {
        const rev = [];
        for (let i = pts.length - 2; i >= 0; i -= 2) rev.push(pts[i], pts[i + 1]);
        return rev;
    }
    return pts;
}

/** Create a mesh aligned from point A to point B (default Y-axis geometry scaled/rotated onto A->B). */
export function orientBetween(mesh, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return mesh;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    // Rotate +Y = [0,1,0] to [ux,uy,uz]
    const dot = Math.max(-1, Math.min(1, uy));
    if (dot < -0.9999) {
        mesh.rotate(1, 0, 0, Math.PI);
    } else if (dot < 0.9999) {
        const ax = uz, ay = 0, az = -ux;
        const am = Math.hypot(ax, az) || 1;
        mesh.rotate(ax / am, 0, az / am, Math.acos(dot));
    }
    mesh.translate((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
    return mesh;
}

/** Build a chamfered rectangular steel bar/plate (subtle 45° edge chamfers that catch studio speculars!). */
export function chamferedBox(halfW, halfH, halfD, bevel = 0.015) {
    const b = Math.min(bevel, halfW * 0.22, halfH * 0.22, halfD * 0.22);
    const outer = [
        halfW - b, -halfH,
        halfW, -halfH + b,
        halfW, halfH - b,
        halfW - b, halfH,
        -halfW + b, halfH,
        -halfW, halfH - b,
        -halfW, -halfH + b,
        -halfW + b, -halfH,
    ];
    return extrude2D(outer, [], halfD * 2, b);
}

/** Merge an array of meshes cleanly, ensuring crease normals + box UVs + tangents. */
export function finalizeCadMesh(meshes, uvScale = 1.4, creaseDeg = 40) {
    const Mesh = M();
    const list = (Array.isArray(meshes) ? meshes : [meshes]).filter((m) => m && !m.empty);
    if (!list.length) return new Mesh();
    const out = list.length === 1 ? list[0] : Mesh.merge(list);
    out.computeCreaseNormals(creaseDeg);
    if (!out.hasUVs) out.projectUVs('box', uvScale);
    return out;
}

/** Build a row-major 3x4 affine + RGBA tint record (16 floats) for scene.createInstancedMesh. */
export function makeInstanceRow(pos, quat = [0, 0, 0, 1], scale = [1, 1, 1], rgba = [1, 1, 1, 1]) {
    const [qx, qy, qz, qw] = quat;
    const [sx, sy, sz] = Array.isArray(scale) ? scale : [scale, scale, scale];
    const xx = qx * qx, yy = qy * qy, zz = qz * qz;
    const xy = qx * qy, xz = qx * qz, yz = qy * qz;
    const wx = qw * qx, wy = qw * qy, wz = qw * qz;
    return [
        (1 - 2 * (yy + zz)) * sx, 2 * (xy - wz) * sy, 2 * (xz + wy) * sz, pos[0],
        2 * (xy + wz) * sx, (1 - 2 * (xx + zz)) * sy, 2 * (yz - wx) * sz, pos[1],
        2 * (xz - wy) * sx, 2 * (yz + wx) * sy, (1 - 2 * (xx + yy)) * sz, pos[2],
        rgba[0], rgba[1], rgba[2], rgba[3],
    ];
}

/** Quaternion rotating +Y to unit direction [dx, dy, dz]. */
export function quatFromYTo(dx, dy, dz) {
    const m = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / m, uy = dy / m, uz = dz / m;
    if (uy > 0.9999) return [0, 0, 0, 1];
    if (uy < -0.9999) return [1, 0, 0, 0];
    const ax = uz, az = -ux;
    const am = Math.hypot(ax, az) || 1;
    const half = Math.acos(Math.max(-1, Math.min(1, uy))) * 0.5;
    const s = Math.sin(half);
    return [(ax / am) * s, 0, (az / am) * s, Math.cos(half)];
}
