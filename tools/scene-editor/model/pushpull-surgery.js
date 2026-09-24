// Push/pull mesh surgery, SketchUp-style: the cap rim never warps.
//
// pushPullSurgery(snap, groupIdx, axis, t) rebuilds the whole mesh from a
// pristine snapshot with face group `groupIdx` displaced by axis * t, so a
// drag re-runs it every frame from the same source and preview, cancel and
// commit all go through one path. Two cases:
//
//   - Sketch face (the group is the entire mesh, a flat polygon): duplicate
//     the boundary, bridge old to new with side quads, and add a back face at
//     the original position, closing the polygon into a slab. Bridges that
//     are coplanar with an adjacent group merge into it; the rest become new
//     wall groups.
//   - Closed solid: translate the group's vertices in place. Adjacent faces
//     follow through shared vertices and stay planar; no new geometry, so the
//     manifold is preserved.
//
// Composes EditMesh primitives (findFaceGroupBoundary, duplicateBoundary,
// addBridge, rematchTwins). All positions and the axis are primitive-LOCAL.

import { EditMesh } from "./edit-mesh.js";

const BRIDGE_MERGE_TOL = 0.9995;   // cos(1.8 deg): bridge coplanar with its neighbour

/**
 * snap: { positions, indices, triToGroup, faceGroups } (pre-drag state).
 * Returns { positions, indices, normals, triToGroup, faceTris }, faceTris
 * being the moved face's triangle indices in the new buffers.
 */
export function pushPullSurgery(snap, gIdx, axis, t) {
    const offset = [axis[0] * t, axis[1] * t, axis[2] * t];
    const isSketchFace = snap.faceGroups.groups[gIdx].tris.length === snap.indices.length / 3;

    const em = EditMesh.fromMeshData(snap.positions, snap.indices, snap.triToGroup);
    const movedFaces = em.faces.filter(f => f.group === gIdx);

    if (isSketchFace) extrudeSketchFace(em, snap, gIdx, offset, movedFaces);
    else translateSolidFace(em, gIdx, offset, movedFaces);

    EditMesh.rematchTwins(em);
    const out = EditMesh.toMeshDataWithGroups(em);
    const normals = flatGroupNormals(out);

    const movedSet = new Set(movedFaces);
    const faceTris = [];
    for (let i = 0; i < em.faces.length; i++) {
        if (movedSet.has(em.faces[i])) faceTris.push(i);
    }
    return {
        positions:  out.positions,
        indices:    out.indices,
        normals,
        triToGroup: out.triToGroup,
        faceTris,
    };
}

// Sketch face: duplicate + bridge + back face. The only way to turn an open
// polygon into a closed slab.
function extrudeSketchFace(em, snap, gIdx, offset, movedFaces) {
    const baseGroupCount = snap.faceGroups.groups.length;
    let nextGroup = baseGroupCount;
    const { dupMap, oldBoundary } = EditMesh.duplicateBoundary(em, gIdx, offset);

    const bridgeGroup = (rec, n) => {
        if (rec.adjGroup >= 0 && rec.adjGroup < baseGroupCount) {
            const adjN = snap.faceGroups.groups[rec.adjGroup].normal;
            if (n[0] * adjN[0] + n[1] * adjN[1] + n[2] * adjN[2] > BRIDGE_MERGE_TOL) return rec.adjGroup;
        }
        return nextGroup++;
    };
    for (const loop of oldBoundary) {
        for (const rec of loop) {
            const a = rec.oldA, b = rec.oldB;
            const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
            let bx = ey * offset[2] - ez * offset[1];
            let by = ez * offset[0] - ex * offset[2];
            let bz = ex * offset[1] - ey * offset[0];
            const bl = Math.hypot(bx, by, bz);
            if (bl > 1e-10) { bx /= bl; by /= bl; bz /= bl; }
            EditMesh.addBridge(em, rec.oldA, rec.oldB, rec.newA, rec.newB, bridgeGroup(rec, [bx, by, bz]));
        }
    }

    // Back face at the original positions, reversed winding.
    const backGroup = nextGroup++;
    const oldOf = new Map();
    for (const [o, n] of dupMap.entries()) if (!oldOf.has(n)) oldOf.set(n, o);
    for (const f of movedFaces) {
        const origs = EditMesh.faceHalfEdges(f).map(he => {
            const v = oldOf.get(he.origin);
            if (!v) throw new Error('push/pull back face: vertex missing from dupMap');
            return v;
        });
        const bf = { halfEdge: null, group: backGroup };
        em.faces.push(bf);
        const h0 = { origin: origs[0], twin: null, next: null, face: bf };
        const h1 = { origin: origs[2], twin: null, next: null, face: bf };
        const h2 = { origin: origs[1], twin: null, next: null, face: bf };
        em.halfEdges.push(h0, h1, h2);
        h0.next = h1; h1.next = h2; h2.next = h0;
        bf.halfEdge = h0;
        if (!origs[0].halfEdge) origs[0].halfEdge = h0;
        if (!origs[2].halfEdge) origs[2].halfEdge = h1;
        if (!origs[1].halfEdge) origs[1].halfEdge = h2;
    }
}

// Closed solid: move the group's vertices in place.
//
// Boundary vertices are gathered by walking the one-ring (twin.next) rather
// than by position key: Float32 sin(2 pi) ~ 1.7e-7 at cylinder seams, so seam
// duplicates are not key-equal after the push. Each ring is then snapped to
// one position so the result round-trips through fromMeshData's position
// keys without breaking twin pairings.
function translateSolidFace(em, gIdx, offset, movedFaces) {
    const toMove = new Set();
    const rings = [];
    const walkRing = (startHE) => {
        const ring = [];
        const seen = new Set();
        let cur = startHE;
        for (let i = 0; i <= em.halfEdges.length; i++) {
            if (seen.has(cur)) break;
            seen.add(cur);
            if (!toMove.has(cur.origin)) { toMove.add(cur.origin); ring.push(cur.origin); }
            if (!cur.twin) break;
            cur = cur.twin.next;
        }
        if (ring.length > 1) rings.push(ring);
    };

    const boundary = new Set();
    for (const loop of EditMesh.findFaceGroupBoundary(em, gIdx)) {
        for (const he of loop) { boundary.add(he.origin); boundary.add(he.next.origin); }
    }
    for (const f of movedFaces) {
        for (const he of EditMesh.faceHalfEdges(f)) {
            if (boundary.has(he.origin)) walkRing(he);
            else toMove.add(he.origin);
        }
    }
    for (const v of toMove) { v.x += offset[0]; v.y += offset[1]; v.z += offset[2]; }
    for (const ring of rings) {
        const first = ring[0];
        for (let i = 1; i < ring.length; i++) { ring[i].x = first.x; ring[i].y = first.y; ring[i].z = first.z; }
    }
}

// Flat per-group vertex normals from post-surgery geometry. A solid push can
// tilt adjacent faces, so each group's normal comes from its first triangle.
function flatGroupNormals(out) {
    const pos = out.positions, idx = out.indices, t2g = out.triToGroup;
    const groupNormal = new Map();
    for (let t = 0; t < t2g.length; t++) {
        const g = t2g[t];
        if (groupNormal.has(g)) continue;
        const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
        const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
        const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const L = Math.hypot(nx, ny, nz);
        if (L > 1e-10) { nx /= L; ny /= L; nz /= L; } else { nx = 0; ny = 1; nz = 0; }
        groupNormal.set(g, [nx, ny, nz]);
    }
    const normals = new Float32Array(pos.length);
    for (let t = 0; t < t2g.length; t++) {
        const n = groupNormal.get(t2g[t]);
        for (let k = 0; k < 3; k++) {
            const vi = idx[t * 3 + k] * 3;
            normals[vi] = n[0]; normals[vi + 1] = n[1]; normals[vi + 2] = n[2];
        }
    }
    return normals;
}

/**
 * Parameter t of the point on the line (pivot + t * axis) closest to `ray`.
 * 0 when the ray is parallel to the axis (the drag freezes until it isn't).
 */
export function rayVsAxisDistance(ray, pivot, axis) {
    const wx = ray.origin[0] - pivot[0], wy = ray.origin[1] - pivot[1], wz = ray.origin[2] - pivot[2];
    const b = ray.dir[0] * axis[0] + ray.dir[1] * axis[1] + ray.dir[2] * axis[2];
    const d = ray.dir[0] * wx + ray.dir[1] * wy + ray.dir[2] * wz;
    const e = axis[0] * wx + axis[1] * wy + axis[2] * wz;
    const denom = 1 - b * b;
    if (denom < 1e-6) return 0;
    return (e - b * d) / denom;
}
