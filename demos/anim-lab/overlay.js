// overlay.js — a bone overlay driven by getBoneWorldMatrix().
//
// This is the verification seam made visible. `getBoneWorldMatrix(name)`
// returns the bone's posed matrix in MODEL space — before the node's own
// transform — which is exactly what a prop socket, an IK target or a ragdoll
// driver reads. Parking a marker at each bone every frame proves the palette
// the GPU is skinning with is the pose the app can see, and gives a way to
// watch the rig with the mesh switched off.
//
// It is per-frame JS by nature (it is a debug view, not the animation), and it
// is off by default so the normal path stays zero-JS-per-frame.

export function createBoneOverlay(scene, character) {
    const rig = character.rig;
    const joints = [];
    const bones = [];

    // Joint markers: one small emissive sphere per bone origin.
    //
    // Note: `visible: false` passed to createMesh is ignored by the engine —
    // the node comes back visible regardless — so visibility is set on the
    // node after creation everywhere in this module.
    for (let i = 0; i < rig.names.length; ++i) {
        const j = scene.createMesh({
            mesh: 'sphere', radius: 0.028, segments: 10, rings: 7,
            color: '#ffffff', unlit: true,
            emissive: 2.0, emissiveColor: [1.0, 0.85, 0.35],
        });
        j.visible = false;
        joints.push(j);
    }

    // Bone links: a thin box per parent→child pair, scaled to span the gap.
    // Scaling a unit box beats rebuilding geometry — the overlay then costs
    // three property writes per bone per frame and no allocation.
    rig.parents.forEach((p, i) => {
        if (p < 0) return;
        const node = scene.createMesh({
            mesh: 'box', halfW: 0.012, halfH: 0.5, halfD: 0.012,
            color: '#ffffff', unlit: true,
            emissive: 1.2, emissiveColor: [0.40, 0.80, 1.0],
        });
        node.visible = false;
        bones.push({ child: i, parent: p, node });
    });

    let enabled = false;
    const pos = new Array(rig.names.length);

    function setEnabled(on) {
        enabled = !!on;
        for (const j of joints) j.visible = enabled;
        for (const b of bones)  b.node.visible = enabled;
    }

    function update() {
        if (!enabled) return;

        // Model space equals world space here: the character node sits at the
        // origin with no rotation or scale. Chunk 3 moves the node under root
        // motion, at which point this needs the node transform composed in.
        for (let i = 0; i < rig.names.length; ++i) {
            const m = character.node.getBoneWorldMatrix(i);
            if (!m) { pos[i] = null; continue; }
            pos[i] = [m[12], m[13], m[14]];      // column-major translation
            const j = joints[i];
            j.x = m[12]; j.y = m[13]; j.z = m[14];
        }

        for (const b of bones) {
            const a = pos[b.parent], c = pos[b.child];
            if (!a || !c) { b.node.visible = false; continue; }
            b.node.visible = true;

            const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
            const len = Math.hypot(dx, dy, dz) || 1e-4;

            b.node.x = (a[0] + c[0]) / 2;
            b.node.y = (a[1] + c[1]) / 2;
            b.node.z = (a[2] + c[2]) / 2;
            // The box is authored 1 unit tall along Y, so a Y scale of `len`
            // makes it span the gap; the quaternion rotates +Y onto the bone.
            // scaleY rather than the `scale` array: the two are separate
            // accessors on a node and do not read each other back.
            b.node.scaleY = len;
            b.node.quaternion = quatFromYTo(dx / len, dy / len, dz / len);
        }
    }

    /** Shortest-arc quaternion taking +Y onto the unit vector (x, y, z). */
    function quatFromYTo(x, y, z) {
        // cross([0,1,0], d) = (z, 0, -x); dot = y.
        const w = 1 + y;
        if (w < 1e-6) return [0, 0, 1, 0];      // antiparallel: 180° about Z
        const q = [z, 0, -x, w];
        const l = Math.hypot(q[0], q[1], q[2], q[3]);
        return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    }

    return { setEnabled, update, joints, bones, get enabled() { return enabled; } };
}
