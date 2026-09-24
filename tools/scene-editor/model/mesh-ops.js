// Geometry helpers the editor's tools share: face-group boundaries and
// planes, polylines <-> edge data, triangle filtering. Pure functions over
// Primitive / EdgePrimitive state; no scene or DOM access.

import "/lib/sketch.js";
import { Mat4Lib } from "./mat4.js";
import { EditMesh } from "./edit-mesh.js";

/** Face group index of a registry pick ({ primitive, hit }). */
export function pickedGroup(pick) {
    return pick.primitive.faceGroups.triToGroup[pick.hit.triangleIndex];
}

/**
 * World-space boundary loop of a face group, CCW around the face (half-edge
 * winding). null when the face has holes (several loops) or is degenerate.
 */
export function faceGroupBoundaryWorld(prim, gIdx) {
    // The primitive's cached EditMesh carries no group tags; build a tagged one.
    const em = EditMesh.fromMeshData(prim.positions, prim.indices, prim.faceGroups.triToGroup);
    const loops = EditMesh.findFaceGroupBoundary(em, gIdx);
    if (!loops || loops.length !== 1 || loops[0].length < 3) return null;
    const w = prim.getWorldMatrix();
    return loops[0].map(he => Mat4Lib.transformPoint(w, [he.origin.x, he.origin.y, he.origin.z]));
}

/** World normal of a face group. */
export function faceGroupWorldNormal(prim, gIdx) {
    return Sketch.v3norm(prim.localToWorldNormal(prim.faceGroups.groups[gIdx].normal));
}

/** Sketch plane of a face group, anchored at the boundary loop's first vertex. */
export function planeForFaceGroup(prim, gIdx, loopWorld) {
    const normal = faceGroupWorldNormal(prim, gIdx);
    const { u, v } = Sketch.worldAxisBasis(normal);
    return { origin: loopWorld[0].slice(), normal, u, v };
}

/** The default sketch plane: the ground (y = 0), u/v along world axes. */
export function groundPlane() {
    const normal = [0, 1, 0];
    const { u, v } = Sketch.worldAxisBasis(normal);
    return { origin: [0, 0, 0], normal, u, v };
}

/**
 * Sketch plane under a world ray: the plane of the face it hits (anchored at
 * the hit), else the ground. Drawing tools lock it on their first click, so a
 * shape drawn on a face stays on that face.
 */
export function sketchPlaneFromRay(registry, ray) {
    const pick = registry.pickAt(ray.origin, ray.dir);
    if (!pick || !pick.hit) return groundPlane();
    const normal = pick.hit.normal.slice();
    const { u, v } = Sketch.worldAxisBasis(normal);
    return { origin: pick.hit.position.slice(), normal, u, v, onPrimitiveId: pick.primitive.id };
}

/** Transform a world ray into `prim`'s local frame (direction renormalised). */
export function worldRayToLocal(ray, prim) {
    const inv = prim.getWorldInverse();
    const d = Mat4Lib.transformDir(inv, ray.dir);
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return {
        origin: Mat4Lib.transformPoint(inv, ray.origin),
        dir: [d[0] / L, d[1] / L, d[2] / L],
        worldPerLocal: L,
    };
}

/**
 * Points [[x,y,z], ...] -> { positions: Float32Array, edges: [{a, b}] }
 * joining consecutive points (and last to first when `closed`).
 */
export function polylineData(points, closed) {
    const positions = new Float32Array(points.length * 3);
    points.forEach((p, i) => { positions[i * 3] = p[0]; positions[i * 3 + 1] = p[1]; positions[i * 3 + 2] = p[2]; });
    const edges = [];
    for (let i = 0; i < points.length - 1; i++) edges.push({ a: i, b: i + 1 });
    if (closed && points.length > 2) edges.push({ a: points.length - 1, b: 0 });
    return { positions, edges };
}

/**
 * Order an EdgePrimitive's edges into one world-space polyline, walking from
 * a degree-1 vertex (or any vertex of a closed loop). null unless the edges
 * form a single simple chain of 2+ vertices.
 */
export function edgePrimitiveToPath(edgePrim) {
    if (!edgePrim || edgePrim.kind !== 'edge-primitive') return null;
    const adj = new Map();
    for (const e of edgePrim.edges) {
        if (!adj.has(e.a)) adj.set(e.a, []);
        if (!adj.has(e.b)) adj.set(e.b, []);
        adj.get(e.a).push(e.b);
        adj.get(e.b).push(e.a);
    }
    if (adj.size === 0) return null;
    let start = adj.keys().next().value;
    for (const [v, ns] of adj) if (ns.length === 1) { start = v; break; }

    const order = [];
    const visited = new Set();
    let cur = start, prev = -1;
    while (cur != null && !visited.has(cur)) {
        visited.add(cur);
        order.push(cur);
        let next = null;
        for (const v of adj.get(cur)) if (v !== prev && !visited.has(v)) { next = v; break; }
        prev = cur;
        cur = next;
    }
    if (order.length < 2) return null;
    const w = edgePrim.getWorldMatrix();
    const P = edgePrim.positions;
    return order.map(i => Mat4Lib.transformPoint(w, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]));
}

const SLIVER_AREA_MIN = 1e-10;

/**
 * Drop near-zero-area triangles. Ear clipping near-collinear input emits
 * slivers that confuse face-group detection and shade badly once extruded.
 */
export function dropSliverTris(positions, indices) {
    const out = [];
    for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
        const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2];
        const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2];
        const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        if (0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz) >= SLIVER_AREA_MIN) {
            out.push(indices[t], indices[t + 1], indices[t + 2]);
        }
    }
    return out;
}

/**
 * Triangulate a planar world-space loop into mesh buffers facing `normal`.
 * `cleanSlivers` filters degenerate triangles. null when nothing is left.
 */
export function polygonMesh(loop3D, normal, cleanSlivers) {
    const mesh = Mesh.polygon3D(Sketch.flatten3D(loop3D), [], normal);
    if (!mesh || mesh.vertexCount === 0) return null;
    const indices = cleanSlivers ? dropSliverTris(mesh.positions, mesh.indices) : mesh.indices;
    if (indices.length === 0) return null;
    return {
        positions: new Float32Array(mesh.positions),
        indices:   new Uint32Array(indices),
        normals:   new Float32Array(mesh.normals),
    };
}

/**
 * Buffers for `prim` with face group `gIdx` removed. Vertices are kept
 * (orphans are harmless: BVH and inference only see referenced ones).
 */
export function withoutFaceGroup(prim, gIdx) {
    const drop = new Set(prim.faceGroups.groups[gIdx].tris);
    const src = prim.indices, triCount = src.length / 3;
    const indices = new Uint32Array((triCount - drop.size) * 3);
    let dst = 0;
    for (let t = 0; t < triCount; t++) {
        if (drop.has(t)) continue;
        indices[dst++] = src[t * 3]; indices[dst++] = src[t * 3 + 1]; indices[dst++] = src[t * 3 + 2];
    }
    return {
        positions: new Float32Array(prim.positions),
        indices,
        normals: prim.normals ? new Float32Array(prim.normals) : null,
    };
}
