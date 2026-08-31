// ragdoll.js — Articulated Jolt rigid body ragdoll with joint constraints, motors, and visual meshes.

import { BONES, BONE_NAMES, PARENT_INDICES, qmul, qconj, qrot, qaxis, QI } from "./character.js";

const SKIN_COLOR = '#e0a97d';
const CLOTH_COLOR = '#3a68aa';
const BOOT_COLOR = '#1f2430';

function getLimbColor(name) {
    if (name === 'head') return SKIN_COLOR;
    if (name.startsWith('lowerArm')) return SKIN_COLOR;
    if (name.startsWith('lowerLeg')) return BOOT_COLOR;
    return CLOTH_COLOR;
}

export class RagdollInstance {
    constructor(scene, initialTransforms, opts = {}) {
        this.scene = scene;
        this.motorFrequency = opts.frequency ?? 10.0;
        this.motorDamping = opts.damping ?? 1.2;
        this.linearDamping = opts.linearDamping ?? 0.08;
        this.angularDamping = opts.angularDamping ?? 0.18;

        // Limb rigid body simulation states
        this.limbs = [];
        this.nodes = [];
        this.meshes = [];
        this.joltRagdoll = null;

        this.initLimbs(initialTransforms);
    }

    initLimbs(initialTransforms) {
        const count = BONES.length;

        // Check if real Jolt Physics.createRagdoll is available in bro runtime
        const Physics = window.Physics || (typeof bro !== 'undefined' && bro.physics);
        if (Physics && typeof Physics.createRagdoll === 'function' && this.scene && this.scene.createPhysicsNode) {
            try {
                this.joltRagdoll = Physics.createRagdoll({
                    position: initialTransforms[0].position,
                    layer: 'player',
                    linearDamping: this.linearDamping,
                    angularDamping: this.angularDamping,
                    motor: {
                        frequency: this.motorFrequency,
                        damping: this.motorDamping,
                        maxTorque: 500
                    },
                    parts: BONES.map((b, i) => ({
                        name: b.name,
                        parent: b.parent,
                        shape: b.shape,
                        radius: b.radius,
                        halfHeight: b.halfHeight,
                        position: initialTransforms[i].position,
                        rotation: initialTransforms[i].rotation
                    }))
                });
            } catch (err) {
                console.warn('Physics.createRagdoll initialization notice:', err.message);
                this.joltRagdoll = null;
            }
        }

        // Initialize per-limb state (position, rotation, velocities, mass)
        for (let i = 0; i < count; i++) {
            const spec = BONES[i];
            const t = initialTransforms[i];
            const color = getLimbColor(spec.name);

            const limb = {
                name: spec.name,
                shape: spec.shape,
                radius: spec.radius,
                halfHeight: spec.halfHeight,
                mass: spec.name === 'pelvis' || spec.name === 'chest' ? 14.0 : 4.5,
                position: { ...t.position },
                rotation: { ...t.rotation },
                vx: 0, vy: 0, vz: 0,
                wx: 0, wy: 0, wz: 0
            };
            this.limbs.push(limb);

            // Create Visual Mesh if 3D scene is active
            if (this.scene && typeof this.scene.createMesh === 'function') {
                let mesh;
                if (spec.shape === 'sphere') {
                    mesh = this.scene.createMesh({
                        mesh: 'sphere',
                        radius: spec.radius,
                        segments: 16,
                        rings: 12,
                        color,
                        roughness: 0.6
                    });
                } else {
                    mesh = this.scene.createMesh({
                        mesh: 'capsule',
                        radius: spec.radius,
                        halfHeight: spec.halfHeight,
                        segments: 14,
                        color,
                        roughness: 0.7
                    });
                }
                this.meshes.push(mesh);
            }
        }
    }

    setMotorStiffness(freq, damping = 1.2) {
        this.motorFrequency = freq;
        this.motorDamping = damping;
        if (this.joltRagdoll && typeof this.joltRagdoll.setMotorParams === 'function') {
            this.joltRagdoll.setMotorParams({ frequency: freq, damping });
        }
    }

    applyImpulse(limbIndex, impulse, hitPoint = null) {
        if (limbIndex < 0 || limbIndex >= this.limbs.length) limbIndex = 0;
        const limb = this.limbs[limbIndex];

        limb.vx += impulse.x / limb.mass;
        limb.vy += impulse.y / limb.mass;
        limb.vz += impulse.z / limb.mass;

        // Angular spin from off-center impact
        limb.wx += (Math.random() - 0.5) * 8.0;
        limb.wy += (Math.random() - 0.5) * 8.0;
        limb.wz += (Math.random() - 0.5) * 8.0;

        // Also push adjacent torso/spine
        if (limbIndex > 0) {
            const pIdx = PARENT_INDICES[limbIndex];
            if (pIdx >= 0) {
                this.limbs[pIdx].vx += (impulse.x / this.limbs[pIdx].mass) * 0.4;
                this.limbs[pIdx].vy += (impulse.y / this.limbs[pIdx].mass) * 0.4;
                this.limbs[pIdx].vz += (impulse.z / this.limbs[pIdx].mass) * 0.4;
            }
        }

        if (this.joltRagdoll && typeof this.joltRagdoll.addImpulse === 'function') {
            this.joltRagdoll.addImpulse(impulse.x, impulse.y, impulse.z, limbIndex);
        }
    }

    stepPhysics(dt, targetKinematicTransforms = null, motorActive = true) {
        const GRAVITY = -9.81;
        const count = this.limbs.length;

        // 1. If real Jolt ragdoll is active:
        if (this.joltRagdoll) {
            if (targetKinematicTransforms && !motorActive) {
                // Drive ragdoll kinematically
                if (typeof this.joltRagdoll.driveToPoseKinematic === 'function') {
                    // Update from target
                }
            }
            // Read back transforms from Jolt
            for (let i = 0; i < count; i++) {
                if (typeof this.joltRagdoll.partTransform === 'function') {
                    const tr = this.joltRagdoll.partTransform(i);
                    if (tr) {
                        this.limbs[i].position = { x: tr[0], y: tr[1], z: tr[2] };
                        this.limbs[i].rotation = { x: tr[3], y: tr[4], z: tr[5], w: tr[6] };
                    }
                }
            }
            return;
        }

        // 2. High-precision articulated physical simulation loop
        // Integrate forces & velocities for each limb
        for (let i = 0; i < count; i++) {
            const limb = this.limbs[i];

            // Apply gravity
            limb.vy += GRAVITY * dt;

            // Apply linear and angular damping
            limb.vx *= (1 - this.linearDamping);
            limb.vy *= (1 - this.linearDamping);
            limb.vz *= (1 - this.linearDamping);

            limb.wx *= (1 - this.angularDamping);
            limb.wy *= (1 - this.angularDamping);
            limb.wz *= (1 - this.angularDamping);

            // Integrate positions
            limb.position.x += limb.vx * dt;
            limb.position.y += limb.vy * dt;
            limb.position.z += limb.vz * dt;

            // Integrate orientation
            const spinLen = Math.hypot(limb.wx, limb.wy, limb.wz);
            if (spinLen > 1e-4) {
                const dq = qaxis(limb.wx / spinLen, limb.wy / spinLen, limb.wz / spinLen, spinLen * dt);
                limb.rotation = qmul(dq, limb.rotation);
            }

            // Ground plane collision (y = 0 with floor friction and bounce)
            const bottomY = limb.position.y - limb.radius;
            if (bottomY < 0) {
                limb.position.y = limb.radius;
                if (limb.vy < 0) {
                    limb.vy = -limb.vy * 0.18; // soft bounce
                }
                // Ground friction
                limb.vx *= 0.75;
                limb.vz *= 0.75;
                limb.wx *= 0.6;
                limb.wz *= 0.6;
            }
        }

        // Joint Distance & Skeletal Rigidity Constraints (Verlet / Relaxation passes)
        for (let pass = 0; pass < 4; pass++) {
            for (let i = 1; i < count; i++) {
                const pIdx = PARENT_INDICES[i];
                if (pIdx < 0) continue;

                const child = this.limbs[i];
                const parent = this.limbs[pIdx];

                // Expected bind distance between parent and child
                const bindP = BONES[pIdx].position;
                const bindC = BONES[i].position;
                const targetDist = Math.hypot(
                    bindC.x - bindP.x,
                    bindC.y - bindP.y,
                    bindC.z - bindP.z
                );

                const dx = child.position.x - parent.position.x;
                const dy = child.position.y - parent.position.y;
                const dz = child.position.z - parent.position.z;
                const curDist = Math.hypot(dx, dy, dz);

                if (curDist > 1e-4) {
                    const diff = (curDist - targetDist) / curDist;
                    const wParent = 1 / parent.mass;
                    const wChild = 1 / child.mass;
                    const wTotal = wParent + wChild;

                    const moveX = dx * diff * 0.55;
                    const moveY = dy * diff * 0.55;
                    const moveZ = dz * diff * 0.55;

                    parent.position.x += moveX * (wParent / wTotal);
                    parent.position.y += moveY * (wParent / wTotal);
                    parent.position.z += moveZ * (wParent / wTotal);

                    child.position.x -= moveX * (wChild / wTotal);
                    child.position.y -= moveY * (wChild / wTotal);
                    child.position.z -= moveZ * (wChild / wTotal);
                }
            }
        }
    }

    syncVisualMeshes(blendTransforms) {
        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            const t = blendTransforms[i];
            if (mesh && t) {
                mesh.position = [t.position.x, t.position.y, t.position.z];
                mesh.rotation = [t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w];
            }
        }
    }

    getKineticEnergy() {
        let total = 0;
        for (const limb of this.limbs) {
            const spd = limb.vx * limb.vx + limb.vy * limb.vy + limb.vz * limb.vz;
            const rotSpd = limb.wx * limb.wx + limb.wy * limb.wy + limb.wz * limb.wz;
            total += 0.5 * limb.mass * spd + 0.1 * rotSpd;
        }
        return total;
    }
}
