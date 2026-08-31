// blender.js — Dynamic Skeletal Animation to Ragdoll Blend Controller, Impact Handler, and Get-Up Recovery.

import { vlerp, qslerp, qrot, BONES } from "./character.js";

export const BLEND_STATE = {
    ANIMATED: 'ANIMATED',
    IMPACT: 'IMPACT',
    RAGDOLL: 'RAGDOLL',
    SETTLING: 'SETTLING',
    GETTING_UP: 'GETTING_UP'
};

export class RagdollBlender {
    constructor(character, ragdoll) {
        this.character = character;
        this.ragdoll = ragdoll;

        this.state = BLEND_STATE.ANIMATED;
        this.blendWeight = 0.0; // 0.0 = 100% animation, 1.0 = 100% ragdoll
        this.transitionSpeed = 4.0; // 1/s

        // Ground rest detection
        this.settleTimer = 0;
        this.isResting = false;
        this.isProne = true; // true = stomach down, false = back down

        // Blended transforms output
        this.blendedTransforms = [];
        this.initTransforms();
    }

    initTransforms() {
        const animTransforms = this.character.computeBoneTransforms();
        this.blendedTransforms = animTransforms.map(t => ({
            name: t.name,
            shape: t.shape,
            radius: t.radius,
            halfHeight: t.halfHeight,
            position: { ...t.position },
            rotation: { ...t.rotation }
        }));
    }

    triggerRagdoll(hitLimbIndex = 0, impulse = { x: 0, y: 0, z: 0 }) {
        if (this.state === BLEND_STATE.RAGDOLL) {
            // Already in ragdoll; just apply extra impulse
            this.ragdoll.applyImpulse(hitLimbIndex, impulse);
            return;
        }

        this.state = BLEND_STATE.IMPACT;
        this.blendWeight = 0.0;
        this.settleTimer = 0;
        this.isResting = false;

        // Copy current blended transforms to ragdoll limbs so physics starts seamlessly from current pose
        const animTransforms = this.character.computeBoneTransforms();
        for (let i = 0; i < this.ragdoll.limbs.length; i++) {
            const t = animTransforms[i];
            const limb = this.ragdoll.limbs[i];
            limb.position = { ...t.position };
            limb.rotation = { ...t.rotation };
            // Transfer procedural gait velocity
            limb.vx = (this.character.currentAnim === 'walk' || this.character.currentAnim === 'run') ? 1.2 : 0;
            limb.vy = 0;
            limb.vz = 0;
        }

        // Apply impact impulse to hit limb
        this.ragdoll.applyImpulse(hitLimbIndex, impulse);
    }

    triggerGetUp() {
        if (this.state !== BLEND_STATE.SETTLING && this.state !== BLEND_STATE.RAGDOLL) return;

        // Detect orientation: prone (face down) vs supine (face up)
        const chest = this.ragdoll.limbs[2]; // chest limb
        const forwardVec = qrot(chest.rotation, { x: 0, y: 0, z: 1 });
        this.isProne = forwardVec.y < 0; // chest facing downwards into ground

        // Reposition character root to where ragdoll pelvis landed
        const pelvis = this.ragdoll.limbs[0];
        this.character.worldPos = { x: pelvis.position.x, y: 0, z: pelvis.position.z };

        // Align character yaw with ragdoll torso heading
        const heading = Math.atan2(forwardVec.x, forwardVec.z);
        this.character.worldYaw = heading;

        // Switch character animation to appropriate getup clip
        this.character.setAnimation(this.isProne ? 'getup_prone' : 'getup_supine', 1.0);
        this.state = BLEND_STATE.GETTING_UP;
    }

    resetToStand(pos = { x: 0, y: 0, z: 0 }, anim = 'idle') {
        this.character.worldPos = { ...pos };
        this.character.worldYaw = 0;
        this.character.setAnimation(anim);
        this.state = BLEND_STATE.ANIMATED;
        this.blendWeight = 0.0;
        this.settleTimer = 0;
        this.isResting = false;

        const animTransforms = this.character.computeBoneTransforms();
        for (let i = 0; i < this.ragdoll.limbs.length; i++) {
            const t = animTransforms[i];
            const limb = this.ragdoll.limbs[i];
            limb.position = { ...t.position };
            limb.rotation = { ...t.rotation };
            limb.vx = 0; limb.vy = 0; limb.vz = 0;
            limb.wx = 0; limb.wy = 0; limb.wz = 0;
        }
    }

    update(dt) {
        // 1. Advance Skeletal Animation
        this.character.update(dt);
        const animTransforms = this.character.computeBoneTransforms();

        // 2. Step Physics Simulation
        const isDynamic = this.state !== BLEND_STATE.ANIMATED;
        if (isDynamic) {
            this.ragdoll.stepPhysics(dt, null, this.blendWeight < 0.5);
        }

        // 3. State Machine Transitions
        switch (this.state) {
            case BLEND_STATE.ANIMATED: {
                this.blendWeight = 0.0;
                break;
            }
            case BLEND_STATE.IMPACT: {
                this.blendWeight = Math.min(1.0, this.blendWeight + dt * this.transitionSpeed * 2.5);
                if (this.blendWeight >= 1.0) {
                    this.state = BLEND_STATE.RAGDOLL;
                }
                break;
            }
            case BLEND_STATE.RAGDOLL: {
                this.blendWeight = 1.0;
                // Monitor kinetic energy for settling detection
                const ke = this.ragdoll.getKineticEnergy();
                if (ke < 1.2) {
                    this.settleTimer += dt;
                    if (this.settleTimer > 0.4) {
                        this.state = BLEND_STATE.SETTLING;
                        this.isResting = true;
                    }
                } else {
                    this.settleTimer = 0;
                }
                break;
            }
            case BLEND_STATE.SETTLING: {
                this.blendWeight = 1.0;
                this.isResting = true;
                break;
            }
            case BLEND_STATE.GETTING_UP: {
                // Blend weight transitions from 1.0 down to 0.0 as character stands up
                this.blendWeight = Math.max(0.0, this.blendWeight - dt * 0.7);
                if (this.character.time >= 1.8 && this.blendWeight <= 0.05) {
                    this.state = BLEND_STATE.ANIMATED;
                    this.blendWeight = 0.0;
                    this.character.setAnimation('idle');
                }
                break;
            }
        }

        // 4. Blend Transforms (Kinematic Pose <-> Ragdoll Physical Pose)
        const w = this.blendWeight;
        const count = BONES.length;

        for (let i = 0; i < count; i++) {
            const at = animTransforms[i];
            const rt = this.ragdoll.limbs[i];
            const bt = this.blendedTransforms[i];

            if (w <= 0.001) {
                bt.position = { ...at.position };
                bt.rotation = { ...at.rotation };
            } else if (w >= 0.999) {
                bt.position = { ...rt.position };
                bt.rotation = { ...rt.rotation };
            } else {
                bt.position = vlerp(at.position, rt.position, w);
                bt.rotation = qslerp(at.rotation, rt.rotation, w);
            }
        }

        // 5. Update Visuals
        this.ragdoll.syncVisualMeshes(this.blendedTransforms);
    }
}
