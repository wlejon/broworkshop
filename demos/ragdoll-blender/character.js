// character.js — Humanoid bone hierarchy, forward kinematics, and procedural animation player.

const DEG = Math.PI / 180;
const HALF = Math.SQRT1_2;

// --- Quaternion & Vector Math Helpers ---
export const QI = { x: 0, y: 0, z: 0, w: 1 };

export function qmul(a, b) {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
    };
}

export function qconj(q) {
    return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function qaxis(ax, ay, az, angle) {
    const s = Math.sin(angle / 2);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
}

export function qrot(q, v) {
    const { x, y, z, w } = q;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return {
        x: v.x + w * tx + (y * tz - z * ty),
        y: v.y + w * ty + (z * tx - x * tz),
        z: v.z + w * tz + (x * ty - y * tx)
    };
}

export function qslerp(qa, qb, t) {
    let cosHalfTheta = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z;
    let bx = qb.x, by = qb.y, bz = qb.z, bw = qb.w;

    if (cosHalfTheta < 0) {
        bw = -bw; bx = -bx; by = -by; bz = -bz;
        cosHalfTheta = -cosHalfTheta;
    }

    if (Math.abs(cosHalfTheta) >= 1.0) {
        return { x: qa.x, y: qa.y, z: qa.z, w: qa.w };
    }

    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

    if (Math.abs(sinHalfTheta) < 0.001) {
        return {
            x: qa.x * 0.5 + bx * 0.5,
            y: qa.y * 0.5 + by * 0.5,
            z: qa.z * 0.5 + bz * 0.5,
            w: qa.w * 0.5 + bw * 0.5
        };
    }

    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    return {
        x: qa.x * ratioA + bx * ratioB,
        y: qa.y * ratioA + by * ratioB,
        z: qa.z * ratioA + bz * ratioB,
        w: qa.w * ratioA + bw * ratioB
    };
}

export function vlerp(a, b, t) {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t
    };
}

// --- Skeleton Definition ---
export const BONES = [
    { name: 'pelvis', shape: 'capsule', halfHeight: 0.09, radius: 0.13, position: { x: 0, y: 0.95, z: 0 } },
    { name: 'spine', parent: 'pelvis', shape: 'capsule', halfHeight: 0.10, radius: 0.12, position: { x: 0, y: 1.22, z: 0 } },
    { name: 'chest', parent: 'spine', shape: 'capsule', halfHeight: 0.11, radius: 0.15, position: { x: 0, y: 1.50, z: 0 } },
    { name: 'head', parent: 'chest', shape: 'sphere', radius: 0.13, position: { x: 0, y: 1.82, z: 0 } },

    // Right Arm
    { name: 'upperArmR', parent: 'chest', shape: 'capsule', halfHeight: 0.11, radius: 0.055, position: { x: 0.40, y: 1.58, z: 0 }, rotation: { x: 0, y: 0, z: -HALF, w: HALF } },
    { name: 'lowerArmR', parent: 'upperArmR', shape: 'capsule', halfHeight: 0.11, radius: 0.048, position: { x: 0.68, y: 1.58, z: 0 }, rotation: { x: 0, y: 0, z: -HALF, w: HALF } },

    // Left Arm
    { name: 'upperArmL', parent: 'chest', shape: 'capsule', halfHeight: 0.11, radius: 0.055, position: { x: -0.40, y: 1.58, z: 0 }, rotation: { x: 0, y: 0, z: HALF, w: HALF } },
    { name: 'lowerArmL', parent: 'upperArmL', shape: 'capsule', halfHeight: 0.11, radius: 0.048, position: { x: -0.68, y: 1.58, z: 0 }, rotation: { x: 0, y: 0, z: HALF, w: HALF } },

    // Right Leg
    { name: 'upperLegR', parent: 'pelvis', shape: 'capsule', halfHeight: 0.16, radius: 0.075, position: { x: 0.14, y: 0.62, z: 0 } },
    { name: 'lowerLegR', parent: 'upperLegR', shape: 'capsule', halfHeight: 0.16, radius: 0.062, position: { x: 0.14, y: 0.22, z: 0 } },

    // Left Leg
    { name: 'upperLegL', parent: 'pelvis', shape: 'capsule', halfHeight: 0.16, radius: 0.075, position: { x: -0.14, y: 0.62, z: 0 } },
    { name: 'lowerLegL', parent: 'upperLegL', shape: 'capsule', halfHeight: 0.16, radius: 0.062, position: { x: -0.14, y: 0.22, z: 0 } }
];

export const BONE_NAMES = BONES.map(b => b.name);
export const PARENT_INDICES = BONES.map(b => b.parent ? BONE_NAMES.indexOf(b.parent) : -1);

export class CharacterController {
    constructor() {
        this.time = 0;
        this.currentAnim = 'idle'; // 'idle' | 'walk' | 'run' | 'getup_prone' | 'getup_supine'
        this.animSpeed = 1.0;
        this.worldPos = { x: 0, y: 0, z: 0 };
        this.worldYaw = 0;
    }

    setAnimation(name, speed = 1.0) {
        if (this.currentAnim !== name) {
            this.currentAnim = name;
            this.time = 0;
            this.animSpeed = speed;
        }
    }

    update(dt) {
        this.time += dt * this.animSpeed;
    }

    /**
     * Evaluates procedural animation curves and returns local bone rotation deltas.
     */
    evaluateLocalRotations(animName, t) {
        const deltas = {};

        if (animName === 'idle') {
            const breath = Math.sin(t * 2.0);
            const sway = Math.sin(t * 1.0);
            deltas.chest = qaxis(1, 0, 0, breath * 3 * DEG);
            deltas.spine = qaxis(0, 1, 0, sway * 2 * DEG);
            deltas.head = qaxis(1, 0, 0, -breath * 2 * DEG);
            deltas.upperArmR = qaxis(0, 0, 1, (breath * 2 - 5) * DEG);
            deltas.upperArmL = qaxis(0, 0, 1, (-breath * 2 + 5) * DEG);
        } else if (animName === 'walk') {
            const freq = 4.2;
            const phase = t * freq;
            const legSwing = Math.sin(phase);
            const armSwing = Math.cos(phase);
            const bob = Math.abs(Math.sin(phase));

            deltas.pelvis = qaxis(0, 1, 0, legSwing * 5 * DEG);
            deltas.spine = qaxis(1, 0, 0, 6 * DEG); // forward lean
            deltas.chest = qaxis(0, 1, 0, -legSwing * 6 * DEG);

            // Legs
            deltas.upperLegR = qaxis(1, 0, 0, legSwing * 32 * DEG);
            deltas.lowerLegR = qaxis(1, 0, 0, Math.max(0, -legSwing * 45) * DEG);
            deltas.upperLegL = qaxis(1, 0, 0, -legSwing * 32 * DEG);
            deltas.lowerLegL = qaxis(1, 0, 0, Math.max(0, legSwing * 45) * DEG);

            // Arms (opposite to legs)
            deltas.upperArmR = qaxis(1, 0, 0, -armSwing * 28 * DEG);
            deltas.lowerArmR = qaxis(1, 0, 0, Math.max(0, armSwing * 25) * DEG);
            deltas.upperArmL = qaxis(1, 0, 0, armSwing * 28 * DEG);
            deltas.lowerArmL = qaxis(1, 0, 0, Math.max(0, -armSwing * 25) * DEG);
        } else if (animName === 'run') {
            const freq = 6.8;
            const phase = t * freq;
            const legSwing = Math.sin(phase);
            const armSwing = Math.cos(phase);

            deltas.spine = qaxis(1, 0, 0, 14 * DEG); // deep forward lean
            deltas.chest = qaxis(0, 1, 0, -legSwing * 10 * DEG);

            // Legs
            deltas.upperLegR = qaxis(1, 0, 0, legSwing * 50 * DEG);
            deltas.lowerLegR = qaxis(1, 0, 0, Math.max(0, -legSwing * 75) * DEG);
            deltas.upperLegL = qaxis(1, 0, 0, -legSwing * 50 * DEG);
            deltas.lowerLegL = qaxis(1, 0, 0, Math.max(0, legSwing * 75) * DEG);

            // Arms
            deltas.upperArmR = qaxis(1, 0, 0, -armSwing * 48 * DEG);
            deltas.lowerArmR = qaxis(1, 0, 0, 45 * DEG);
            deltas.upperArmL = qaxis(1, 0, 0, armSwing * 48 * DEG);
            deltas.lowerArmL = qaxis(1, 0, 0, 45 * DEG);
        } else if (animName === 'getup_prone') {
            // Push-up from prone ground position to standing (duration ~1.8s)
            const p = Math.min(1.0, t / 1.8);
            const smoothP = p * p * (3 - 2 * p);

            deltas.spine = qaxis(1, 0, 0, (1 - smoothP) * 35 * DEG);
            deltas.upperArmR = qaxis(0, 0, 1, (1 - smoothP) * 70 * DEG);
            deltas.upperArmL = qaxis(0, 0, 1, -(1 - smoothP) * 70 * DEG);
            deltas.upperLegR = qaxis(1, 0, 0, (1 - smoothP) * -45 * DEG);
            deltas.lowerLegR = qaxis(1, 0, 0, (1 - smoothP) * 60 * DEG);
            deltas.upperLegL = qaxis(1, 0, 0, (1 - smoothP) * -45 * DEG);
            deltas.lowerLegL = qaxis(1, 0, 0, (1 - smoothP) * 60 * DEG);
        } else if (animName === 'getup_supine') {
            // Sit-up from supine back position to standing (duration ~1.8s)
            const p = Math.min(1.0, t / 1.8);
            const smoothP = p * p * (3 - 2 * p);

            deltas.spine = qaxis(1, 0, 0, (1 - smoothP) * -40 * DEG);
            deltas.chest = qaxis(1, 0, 0, (1 - smoothP) * -20 * DEG);
            deltas.upperLegR = qaxis(1, 0, 0, (1 - smoothP) * -80 * DEG);
            deltas.lowerLegR = qaxis(1, 0, 0, (1 - smoothP) * 80 * DEG);
            deltas.upperLegL = qaxis(1, 0, 0, (1 - smoothP) * -80 * DEG);
            deltas.lowerLegL = qaxis(1, 0, 0, (1 - smoothP) * 80 * DEG);
        }

        return deltas;
    }

    /**
     * Forward Kinematics: computes world positions and quaternions for all bones.
     */
    computeBoneTransforms(rootPos = this.worldPos, rootYaw = this.worldYaw) {
        const deltas = this.evaluateLocalRotations(this.currentAnim, this.time);
        const count = BONES.length;
        const transforms = [];

        const rootRot = qaxis(0, 1, 0, rootYaw);

        for (let i = 0; i < count; i++) {
            const bone = BONES[i];
            const pIdx = PARENT_INDICES[i];
            const localDelta = deltas[bone.name] || QI;
            const bindRot = bone.rotation || QI;

            let worldRot, worldPos;

            if (pIdx < 0) {
                // Root (Pelvis)
                worldRot = qmul(rootRot, qmul(bindRot, localDelta));
                worldPos = {
                    x: rootPos.x + bone.position.x,
                    y: rootPos.y + bone.position.y,
                    z: rootPos.z + bone.position.z
                };
            } else {
                const parentT = transforms[pIdx];
                const parentBone = BONES[pIdx];

                worldRot = qmul(parentT.rotation, qmul(bindRot, localDelta));

                // Offset in parent frame
                const localOffset = {
                    x: bone.position.x - parentBone.position.x,
                    y: bone.position.y - parentBone.position.y,
                    z: bone.position.z - parentBone.position.z
                };
                const rotatedOffset = qrot(parentT.rotation, localOffset);

                worldPos = {
                    x: parentT.position.x + rotatedOffset.x,
                    y: parentT.position.y + rotatedOffset.y,
                    z: parentT.position.z + rotatedOffset.z
                };
            }

            transforms.push({
                name: bone.name,
                shape: bone.shape,
                radius: bone.radius,
                halfHeight: bone.halfHeight,
                position: worldPos,
                rotation: worldRot
            });
        }

        return transforms;
    }
}
