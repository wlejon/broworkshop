// rigged_avatar.js — Procedural humanoid mesh auto-rigged via bromesh Rig.autoRig (BBW).
// Deploys a GPU-skinned character with procedural locomotion and animation poses.

function makeBox(cx, cy, cz, hx, hy, hz) {
    const m = Mesh.box(hx, hy, hz);
    m.translate(cx, cy, cz);
    return m;
}

export function buildHumanoidMesh() {
    const parts = [];

    // Torso: upper and lower segments
    parts.push(makeBox(0, 0.15, 0, 0.18, 0.18, 0.10));
    parts.push(makeBox(0, 0.40, 0, 0.20, 0.14, 0.11));

    // Head and neck
    parts.push(makeBox(0, 0.58, 0, 0.06, 0.06, 0.06));
    parts.push(makeBox(0, 0.74, 0, 0.11, 0.13, 0.12));

    // Left Arm (negative X)
    parts.push(makeBox(-0.26, 0.45, 0, 0.08, 0.055, 0.055)); // shoulder
    parts.push(makeBox(-0.39, 0.45, 0, 0.09, 0.05, 0.05));   // upper arm
    parts.push(makeBox(-0.54, 0.45, 0, 0.09, 0.045, 0.045)); // forearm
    parts.push(makeBox(-0.67, 0.45, 0, 0.05, 0.035, 0.045)); // hand

    // Right Arm (positive X)
    parts.push(makeBox(0.26, 0.45, 0, 0.08, 0.055, 0.055));
    parts.push(makeBox(0.39, 0.45, 0, 0.09, 0.05, 0.05));
    parts.push(makeBox(0.54, 0.45, 0, 0.09, 0.045, 0.045));
    parts.push(makeBox(0.67, 0.45, 0, 0.05, 0.035, 0.045));

    // Left Leg (negative X)
    parts.push(makeBox(-0.11, -0.25, 0, 0.065, 0.20, 0.065)); // thigh
    parts.push(makeBox(-0.11, -0.65, 0, 0.055, 0.20, 0.055)); // shin
    parts.push(makeBox(-0.11, -0.85, 0.04, 0.06, 0.04, 0.11)); // foot

    // Right Leg (positive X)
    parts.push(makeBox(0.11, -0.25, 0, 0.065, 0.20, 0.065));
    parts.push(makeBox(0.11, -0.65, 0, 0.055, 0.20, 0.055));
    parts.push(makeBox(0.11, -0.85, 0.04, 0.06, 0.04, 0.11));

    return Mesh.merge(parts);
}

export function createAutoRiggedAvatar(scene) {
    if (typeof Rig === 'undefined' || typeof Rig.autoRig !== 'function') {
        console.warn('Rig.autoRig is not available in this build');
        return null;
    }

    const mesh = buildHumanoidMesh();
    let rigRes;
    try {
        rigRes = Rig.autoRig(mesh, { rigType: 'humanoid', method: 'bbw' });
    } catch (e) {
        console.warn('Rig.autoRig failed with BBW, falling back to voxelBind:', e.message);
        try {
            rigRes = Rig.autoRig(mesh, { rigType: 'humanoid', method: 'voxelBind' });
        } catch (e2) {
            console.error('Rig.autoRig failed:', e2.message);
            return null;
        }
    }

    let skinnedNode;
    try {
        skinnedNode = scene.createSkinnedMesh({
            mesh: mesh,
            skin: rigRes.skin,
            skeleton: rigRes.skeleton,
            color: '#4fa8d8',
            metallic: 0.15,
            roughness: 0.45,
            castsShadow: true,
            receivesShadow: true,
        });
    } catch (e) {
        console.warn('scene.createSkinnedMesh failed:', e.message);
        return null;
    }

    const boneCount = skinnedNode.boneCount || 16;
    const palette = new Float32Array(boneCount * 16);
    for (let i = 0; i < boneCount; i++) {
        palette[i * 16 + 0] = 1;
        palette[i * 16 + 5] = 1;
        palette[i * 16 + 10] = 1;
        palette[i * 16 + 15] = 1;
    }

    let animTime = 0;

    function setBoneTransform(boneIdx, tx, ty, tz, rx, ry, rz) {
        if (boneIdx < 0 || boneIdx >= boneCount) return;
        const off = boneIdx * 16;

        const cx = Math.cos(rx), sx = Math.sin(rx);
        const cy = Math.cos(ry), sy = Math.sin(ry);
        const cz = Math.cos(rz), sz = Math.sin(rz);

        // Rotation matrix Euler ZYX
        palette[off + 0] = cy * cz;
        palette[off + 1] = cy * sz;
        palette[off + 2] = -sy;
        palette[off + 3] = 0;

        palette[off + 4] = sx * sy * cz - cx * sz;
        palette[off + 5] = sx * sy * sz + cx * cz;
        palette[off + 6] = sx * cy;
        palette[off + 7] = 0;

        palette[off + 8] = cx * sy * cz + sx * sz;
        palette[off + 9] = cx * sy * sz - sx * cz;
        palette[off + 10] = cx * cy;
        palette[off + 11] = 0;

        palette[off + 12] = tx;
        palette[off + 13] = ty;
        palette[off + 14] = tz;
        palette[off + 15] = 1;
    }

    function update(charState, dt) {
        if (!skinnedNode || !skinnedNode.visible) return;
        animTime += dt;

        const speed = charState.horizontalSpeed || 0;
        const isAir = !charState.isGrounded;
        const isCrouch = charState.stance === 'crouched';

        // Reset palette to identity
        for (let i = 0; i < boneCount; i++) {
            const off = i * 16;
            for (let j = 0; j < 16; j++) palette[off + j] = (j % 5 === 0) ? 1 : 0;
        }

        if (isAir) {
            // Jump pose: legs tucked, arms spread
            setBoneTransform(1, 0, -0.05, 0, -0.2, 0, 0); // spine
            setBoneTransform(4, 0, 0, 0, 0.4, 0, 0.3);    // left arm
            setBoneTransform(7, 0, 0, 0, 0.4, 0, -0.3);   // right arm
            setBoneTransform(10, 0, 0.1, 0, -0.5, 0, 0);  // left leg
            setBoneTransform(13, 0, 0.1, 0, -0.5, 0, 0);  // right leg
        } else if (speed > 0.1) {
            // Walk / Run gait cycle
            const freq = Math.min(12, speed * 2.5);
            const cycle = animTime * freq;
            const legAmp = Math.min(0.7, speed * 0.16);
            const armAmp = Math.min(0.6, speed * 0.14);
            const bob = Math.abs(Math.sin(cycle)) * 0.04;

            // Pelvis bounce
            setBoneTransform(0, 0, -bob, 0, 0, 0, 0);

            // Legs swing counter-phase
            const lLegAngle = Math.sin(cycle) * legAmp;
            const rLegAngle = -Math.sin(cycle) * legAmp;
            setBoneTransform(10, 0, 0, 0, lLegAngle, 0, 0);
            setBoneTransform(13, 0, 0, 0, rLegAngle, 0, 0);

            // Arms swing opposite to legs
            setBoneTransform(4, 0, 0, 0, -rLegAngle * armAmp, 0, 0);
            setBoneTransform(7, 0, 0, 0, -lLegAngle * armAmp, 0, 0);
        } else if (isCrouch) {
            // Crouch pose
            setBoneTransform(0, 0, -0.35, 0, 0, 0, 0);
            setBoneTransform(1, 0, 0, 0, 0.3, 0, 0);
            setBoneTransform(10, 0, 0, 0, -0.6, 0, 0);
            setBoneTransform(13, 0, 0, 0, -0.6, 0, 0);
        } else {
            // Idle breathing
            const breathe = Math.sin(animTime * 2.0) * 0.02;
            setBoneTransform(1, 0, breathe, 0, breathe * 0.5, 0, 0);
        }

        try {
            skinnedNode.setSkinningMatrices(palette);
        } catch (_) {}
    }

    return {
        node: skinnedNode,
        methodUsed: rigRes.methodUsed,
        update,
    };
}
