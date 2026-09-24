// mesh-data.js — Mesh <-> plain typed arrays, for posting meshes between the
// page and mesh-worker.js. Used on both sides.

/** Copy a Mesh's streams: { positions, indices, normals?, uvs?, colors? }. */
export function meshToData(m) {
    const out = {
        positions: new Float32Array(m.positions),
        indices: new Uint32Array(m.indices),
    };
    if (m.hasNormals) out.normals = new Float32Array(m.normals);
    if (m.hasUVs) out.uvs = new Float32Array(m.uvs);
    if (m.hasColors) out.colors = new Float32Array(m.colors);
    return out;
}

/** Rebuild a Mesh from meshToData output. */
export function meshFromData(d) {
    const opts = { positions: d.positions, indices: d.indices };
    if (d.normals) opts.normals = d.normals;
    if (d.uvs) opts.uvs = d.uvs;
    if (d.colors) opts.colors = d.colors;
    return new Mesh(opts);
}
