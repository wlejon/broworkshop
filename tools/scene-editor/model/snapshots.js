// Undo snapshots for SceneObjects. Every mutating edit records one history
// entry built from a before/after pair of these:
//
//   const prev = captureTransform(obj);  ...drag...  const next = captureTransform(obj);
//   history.record('Move', () => applyTransform(obj, next), () => applyTransform(obj, prev));
//
// Transform snapshots cover move / rotate / scale on any SceneObject (group,
// primitive, component instance). Mesh snapshots add the local buffers for
// edits that rewrite geometry (push/pull); applyMesh routes through
// Primitive.updateGeometry so BVH, face groups, inference and edges rebuild.

export function captureTransform(obj) {
    return {
        translation: obj.translation.slice(),
        rotation:    obj.rotation.slice(),
        scale:       obj.scale.slice(),
    };
}

export function applyTransform(obj, snap) {
    obj.setTRS(snap.translation, snap.rotation, snap.scale);
}

function sameTRS(snap, obj) {
    for (let i = 0; i < 3; i++) {
        if (snap.translation[i] !== obj.translation[i]) return false;
        if (snap.scale[i] !== obj.scale[i]) return false;
    }
    for (let i = 0; i < 4; i++) {
        if (snap.rotation[i] !== obj.rotation[i]) return false;
    }
    return true;
}

/** Has `obj` moved since `prev` was captured? (No-op drags record nothing.) */
export function transformChanged(prev, obj) {
    return !!prev && !sameTRS(prev, obj);
}

export function captureMesh(prim) {
    return Object.assign(captureTransform(prim), {
        positions: new Float32Array(prim.positions),
        indices:   new Uint32Array(prim.indices),
        normals:   prim.normals ? new Float32Array(prim.normals) : null,
    });
}

export function applyMesh(prim, snap) {
    prim.updateGeometry(snap.positions, snap.indices, snap.normals);
    applyTransform(prim, snap);
}

/** Buffers or transform differ from the snapshot. */
export function meshChanged(prev, prim) {
    if (!prev) return false;
    if (prev.positions.length !== prim.positions.length) return true;
    if (prev.indices.length !== prim.indices.length) return true;
    const a = prev.positions, b = prim.positions;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return !sameTRS(prev, prim);
}
