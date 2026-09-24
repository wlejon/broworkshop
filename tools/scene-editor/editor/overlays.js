// Scene overlays: UI geometry that is not part of the document. Everything
// here is unlit and orange so it reads as a crisp affordance over the lit
// model, and none of it takes part in picking or snapping.
//
//   Highlight  the picked face / face group, drawn over a primitive
//   Preview    a tool's rubber-band geometry (a filled shape or a polyline)

import { Mat4Lib } from "../model/mat4.js";
import { EdgeMesh } from "../model/edge-mesh.js";
import { polylineData } from "../model/mesh-ops.js";

export const ACCENT = '#ffa502';
const ACCENT_RGBA = [1.0, 0.647, 0.008, 1.0];
const HIGHLIGHT_EPS = 0.002;       // lift along the normal against z-fighting

/** Copy a SceneObject's composed world transform onto a scene node. */
export function copyWorldTransform(node, obj) {
    const dec = Mat4Lib.decomposeTRS(obj.getWorldMatrix());
    const eul = Mat4Lib.quatToEuler(dec.rotation);
    node.x = dec.translation[0]; node.y = dec.translation[1]; node.z = dec.translation[2];
    node.rotationX = eul[0]; node.rotationY = eul[1]; node.rotationZ = eul[2];
    node.scaleX = dec.scale[0]; node.scaleY = dec.scale[1]; node.scaleZ = dec.scale[2];
}

/**
 * One highlight at a time. Triangles are copied out of the primitive's local
 * buffers (or override buffers, for a push/pull preview) and the node follows
 * the primitive's world transform.
 */
export class Highlight {
    constructor(scene) {
        this.scene = scene;
        this.node = null;
        this.primitive = null;
        this.tris = null;
        this.normal = null;
    }

    clear() {
        if (this.node) { this.node.destroy(); this.node = null; }
        this.primitive = null;
        this.tris = null;
        this.normal = null;
    }

    /** Clear if it is on `obj`. */
    release(obj) {
        if (this.primitive && obj && this.primitive.id === obj.id) this.clear();
    }

    triangles(primitive, triIndices, normal, positionsSrc, indicesSrc) {
        this.clear();
        if (!primitive || !triIndices || triIndices.length === 0) return;
        const pos = positionsSrc || primitive.positions;
        const idx = indicesSrc || primitive.indices;
        const lx = normal[0] * HIGHLIGHT_EPS, ly = normal[1] * HIGHLIGHT_EPS, lz = normal[2] * HIGHLIGHT_EPS;
        const n = triIndices.length;
        const positions = new Float32Array(n * 9);
        const normals = new Float32Array(n * 9);
        const indices = new Uint32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const t = triIndices[i];
            for (let k = 0; k < 3; k++) {
                const src = idx[t * 3 + k] * 3, dst = (i * 3 + k) * 3;
                positions[dst] = pos[src] + lx;
                positions[dst + 1] = pos[src + 1] + ly;
                positions[dst + 2] = pos[src + 2] + lz;
                normals[dst] = normal[0]; normals[dst + 1] = normal[1]; normals[dst + 2] = normal[2];
                indices[i * 3 + k] = i * 3 + k;
            }
        }
        this.node = this.scene.createMesh({ positions, normals, indices, color: ACCENT, unlit: true, name: 'highlight' });
        copyWorldTransform(this.node, primitive);
        this.primitive = primitive;
        this.tris = triIndices;
        this.normal = normal;
    }

    faceGroup(primitive, groupIdx) {
        const g = primitive && primitive.faceGroups.groups[groupIdx];
        if (!g) { this.clear(); return; }
        this.triangles(primitive, g.tris, g.normal);
    }

    /**
     * With buffers: rebuild the same triangles from them (push/pull, where
     * the mesh changes under the highlight). Without: re-sync the transform
     * (move / rotate / scale change only the world matrix).
     */
    refresh(positionsSrc, indicesSrc) {
        if (!this.primitive) return;
        if (positionsSrc) this.triangles(this.primitive, this.tris, this.normal, positionsSrc, indicesSrc);
        else if (this.node) copyWorldTransform(this.node, this.primitive);
    }

    /** refresh() if the highlight is on `obj`. */
    follow(obj) {
        if (this.primitive && obj && this.primitive.id === obj.id) this.refresh();
    }
}

/** A tool's preview node: created on first show, updated in place, destroyed on clear. */
export class Preview {
    constructor(scene, name) {
        this.scene = scene;
        this.name = name;
        this.node = null;
    }

    clear() {
        if (this.node) { this.node.destroy(); this.node = null; }
    }

    _show(data, createOpts) {
        if (this.node) this.node.updateMesh(data);
        else this.node = this.scene.createMesh(Object.assign({ unlit: true, name: this.name }, createOpts, data));
    }

    /** A filled mesh ({ positions, indices, normals }); null clears. */
    mesh(mesh) {
        if (!mesh) { this.clear(); return; }
        this._show({ positions: mesh.positions, indices: mesh.indices, normals: mesh.normals }, { color: ACCENT });
    }

    /** A thin-prism polyline through world points; fewer than 2 points clears. */
    polyline(points, closed, thickness) {
        if (!points || points.length < 2) { this.clear(); return; }
        const { positions, edges } = polylineData(points, closed);
        const data = EdgeMesh.buildEdgeMesh(positions, edges, { thickness: thickness || 0.014, color: ACCENT_RGBA });
        this._show({ positions: data.positions, normals: data.normals, colors: data.colors, indices: data.indices });
    }
}
