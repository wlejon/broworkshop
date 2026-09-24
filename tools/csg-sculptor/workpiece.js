// workpiece.js — the document: the mesh being sculpted, its scene node, and
// the boolean operations that change it. Every change goes through a History
// entry holding the mesh before and after, so undo / redo swap whole meshes.

import { History } from "/lib/kit/history.js";

/** Blank workpieces. Mesh.box / cylinder take half extents. */
export const PRESETS = {
    box:      () => Mesh.box(1.4, 1.4, 1.4),
    sphere:   () => Mesh.sphere(1.6, 32, 24),
    cylinder: () => Mesh.cylinder(1.4, 1.6, 32),
    torus:    () => Mesh.torus(1.5, 0.6, 32, 24),
    column:   () => Mesh.merge([
        Mesh.cylinder(0.9, 1.8, 28),
        Mesh.box(1.2, 0.18, 1.2).translate(0, 1.9, 0),
        Mesh.box(1.2, 0.18, 1.2).translate(0, -1.9, 0),
    ]),
    bracket:  () => Mesh.merge([
        Mesh.box(1.6, 0.25, 1.2),
        Mesh.box(0.25, 1.2, 1.2).translate(-1.35, 1.2, 0),
        Mesh.box(0.18, 0.9, 0.18).rotate(0, 0, 1, Math.PI / 4).translate(-0.6, 0.6, 0),
    ]),
};

export const MATERIALS = {
    studio: { color: '#94a3b8', roughness: 0.4,  metallic: 0.25 },
    clay:   { color: '#c05c46', roughness: 0.85, metallic: 0.05 },
    metal:  { color: '#e2e8f0', roughness: 0.18, metallic: 0.92 },
    gold:   { color: '#d4af37', roughness: 0.25, metallic: 0.88 },
    jade:   { color: '#2ed573', roughness: 0.45, metallic: 0.1 },
};

/** Boolean operations by name: the Mesh method and a label. */
export const OPS = {
    carve:     { method: 'booleanDifference',   label: 'Subtract' },
    union:     { method: 'booleanUnion',        label: 'Union' },
    intersect: { method: 'booleanIntersection', label: 'Intersect' },
};

/**
 * The workpiece on `scene`. opts: { history, onChange() }.
 * Returns { mesh, material, preset, load(name), apply(cutterMesh, op),
 * setMaterial(name), stats() }.
 */
export function createWorkpiece(scene, opts) {
    const o = opts || {};
    const history = o.history || new History({ limit: 30 });
    let mesh = null, node = null, material = 'studio', preset = null;

    const show = (m) => {
        mesh = m;
        if (node) node.destroy();
        node = scene.createMesh(Object.assign({ mesh: m }, MATERIALS[material]));
        if (o.onChange) o.onChange();
    };
    const commit = (label, next) => {
        const prev = mesh;
        show(next);
        history.record(label, () => show(next), () => show(prev));
    };

    const wp = {
        history,
        get mesh() { return mesh; },
        get material() { return material; },
        get preset() { return preset; },
        get node() { return node; },

        /** Replace the workpiece with a blank (undoable). */
        load(name) {
            const make = PRESETS[name];
            if (!make) throw new Error('csg: no preset ' + name);
            const m = make();
            m.computeNormals();
            preset = name;
            if (!mesh) show(m); else commit('Load ' + name, m);
        },

        /**
         * Apply `op` (a key of OPS) with `cutter` (a Mesh in world space).
         * Returns the result mesh, or null when the operation failed or left
         * nothing (the workpiece is then unchanged).
         */
        apply(cutter, op) {
            const spec = OPS[op];
            if (!spec) throw new Error('csg: no operation ' + op);
            let result = null;
            try { result = mesh[spec.method](cutter); } catch (e) { return null; }
            if (!result || !result.vertexCount || !result.triangleCount) return null;
            result.computeNormals();
            commit(spec.label, result);
            return result;
        },

        /** Change the look (not part of history). */
        setMaterial(name) {
            if (!MATERIALS[name]) throw new Error('csg: no material ' + name);
            material = name;
            if (mesh) show(mesh);
        },

        stats() {
            if (!mesh) return { verts: 0, tris: 0, size: [0, 0, 0] };
            const bb = mesh.computeBBox();
            return {
                verts: mesh.vertexCount, tris: mesh.triangleCount,
                size: [0, 1, 2].map((i) => bb.max[i] - bb.min[i]),
            };
        },
    };
    return wp;
}
