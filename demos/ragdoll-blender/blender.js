// blender.js — the animation <-> ragdoll blend controller.
//
// One Jolt ragdoll the whole time; what changes is who drives it:
//
//   ANIMATED    the clip, kinematically: driveToPoseKinematic every frame, so
//               the parts are real bodies moving at the clip's velocities (a
//               running figure that gets hit keeps its momentum for free)
//   IMPACT      motors: driveToPose toward the clip at `stiffness * (1 - w)`
//               Hz while the blend weight w ramps 0 -> 1 in ~0.1 s, so the
//               joints resist the hit briefly and then give up
//   RAGDOLL     nothing: limp, until the kinetic energy stays low
//   SETTLING    at rest on the ground, prone or supine
//   GETTING_UP  kinematic again, toward lerpPose(snapshot, getup clip, 1 - w)
//               with w falling 1 -> 0: the heap on the floor blends into the
//               get-up clip, which ends standing, which hands back to idle

import { q } from "/lib/kit/math3d.js";
import { spawnRagdoll, buildPose, lerpPose, PELVIS_BIND_Y } from "/lib/kit/ragdoll.js";
import { CLIPS, GETUP_TIME } from "./anim.js";

export const STATES = ['ANIMATED', 'IMPACT', 'RAGDOLL', 'SETTLING', 'GETTING_UP'];

const IMPACT_RATE = 10;      // blend weight per second into the ragdoll
const GETUP_RATE = 0.7;      // ... and back out of it while standing up
const SETTLE_KE = 1.2;       // J: below this for SETTLE_TIME = at rest
const SETTLE_TIME = 0.4;

export class RagdollBlender {
    constructor(scene, opts = {}) {
        this.stiffness = opts.stiffness ?? 12;     // Hz, the impact motors
        this.state = 'ANIMATED';
        this.weight = 0;                          // 0 = all animation, 1 = all physics
        this.clip = 'idle';
        this.time = 0;
        this.root = { x: 0, z: 0, yaw: 0 };
        this.prone = true;
        this.settleTimer = 0;
        this.snapshot = null;
        this.onState = opts.onState || null;
        this.rig = spawnRagdoll(scene, {
            position: { x: 0, y: 0, z: 0 }, layer: 'player',
            colors: { skin: '#e0a97d', cloth: '#3a68aa', boots: '#1f2430' },
            motor: { frequency: this.stiffness, damping: 1 },
        });
        this.rd = this.rig.rd;
        this.rd.setPose(this.animPose());
    }

    /** The current clip's world pose at the current root. */
    animPose(clip = this.clip, t = this.time) {
        return buildPose(CLIPS[clip](t), { x: this.root.x, y: PELVIS_BIND_Y, z: this.root.z },
            q.axis(0, 1, 0, this.root.yaw));
    }

    setState(s) {
        if (this.state === s) return;
        this.state = s;
        if (this.onState) this.onState(s);
    }

    /** Pick a looping clip. Anything but ANIMATED stands back up first. */
    setAnimation(name) {
        if (!CLIPS[name]) return false;
        if (this.state !== 'ANIMATED') return this.resetToStand(name);
        if (this.clip !== name) { this.clip = name; this.time = 0; }
        return true;
    }

    /** Hit part `index`: blend into the ragdoll, or add to one already limp. */
    triggerRagdoll(index = 2, impulse = null) {
        const tag = this.rd.partBody(index);
        this.rd.activate();
        if (impulse) Physics.addImpulse(tag, impulse.x, impulse.y, impulse.z);
        if (this.state === 'RAGDOLL' || this.state === 'SETTLING' || this.state === 'IMPACT') {
            if (this.state === 'SETTLING') { this.settleTimer = 0; this.setState('RAGDOLL'); }
            return true;
        }
        this.weight = 0;
        this.settleTimer = 0;
        this.setState('IMPACT');
        return true;
    }

    /** From the ground: pick the clip by which way the chest faces. */
    triggerGetUp() {
        if (this.state !== 'SETTLING' && this.state !== 'RAGDOLL') return false;
        const chest = Physics.getTransform(this.rd.partBody(2));
        const fwd = q.rot(chest.rotation, { x: 0, y: 0, z: 1 });
        const up = q.rot(chest.rotation, { x: 0, y: 1, z: 0 });   // pelvis -> head
        this.prone = fwd.y < 0;
        // Stand up facing along the body: head-ward from the stomach, feet-ward
        // from the back (a sit-up ends facing the feet).
        const s = this.prone ? 1 : -1;
        const pelvis = Physics.getTransform(this.rd.partBody(0)).position;
        this.root = { x: pelvis.x, z: pelvis.z, yaw: Math.atan2(up.x * s, up.z * s) };
        this.snapshot = this.rd.pose();
        this.clip = this.prone ? 'getup_prone' : 'getup_supine';
        this.time = 0;
        this.weight = 1;
        this.setState('GETTING_UP');
        return true;
    }

    /** Teleport upright at `pos` playing `clip`, velocities zeroed. */
    resetToStand(clip = this.clip.startsWith('getup') ? 'idle' : this.clip, pos = { x: 0, z: 0 }) {
        this.rd.stopDrive();
        this.clip = clip;
        this.time = 0;
        this.root = { x: pos.x, z: pos.z, yaw: 0 };
        this.rd.setPose(this.animPose());
        for (const tag of this.rig.tags) {
            Physics.setLinearVelocity(tag, 0, 0, 0);
            Physics.setAngularVelocity(tag, 0, 0, 0);
        }
        this.weight = 0;
        this.settleTimer = 0;
        this.setState('ANIMATED');
        return true;
    }

    setStiffness(hz) { this.stiffness = hz; }

    /** Sum of 1/2 m v^2 over the parts (linear), joules. */
    kineticEnergy() {
        let ke = 0;
        for (const tag of this.rig.tags) {
            const v = Physics.getVelocity(tag).linear;
            ke += 0.5 * Physics.getBodyProperties(tag).mass * (v.x * v.x + v.y * v.y + v.z * v.z);
        }
        return ke;
    }

    pelvisHeight() { return Physics.getTransform(this.rd.partBody(0)).position.y; }

    /** Resting-state label for the telemetry. */
    restLabel() {
        switch (this.state) {
            case 'ANIMATED': return 'Active';
            case 'SETTLING': return this.prone ? 'Prone (Stomach)' : 'Supine (Back)';
            case 'GETTING_UP': return 'Recovering';
            default: return 'Tumbling';
        }
    }

    update(dt) {
        if (dt <= 0) return;
        this.time += dt;
        switch (this.state) {
            case 'ANIMATED':
                this.rd.driveToPoseKinematic(this.animPose(), dt);
                break;
            case 'IMPACT': {
                this.weight = Math.min(1, this.weight + dt * IMPACT_RATE);
                const hz = this.stiffness * (1 - this.weight);
                if (this.weight >= 1 || hz < 0.5) {
                    this.rd.stopDrive();
                    this.weight = 1;
                    this.setState('RAGDOLL');
                } else {
                    this.rd.driveToPose(this.animPose(), { frequency: hz, damping: 1 });
                }
                break;
            }
            case 'RAGDOLL':
                if (this.kineticEnergy() < SETTLE_KE) {
                    this.settleTimer += dt;
                    if (this.settleTimer > SETTLE_TIME) {
                        const fwd = q.rot(Physics.getTransform(this.rd.partBody(2)).rotation, { x: 0, y: 0, z: 1 });
                        this.prone = fwd.y < 0;
                        this.setState('SETTLING');
                    }
                } else {
                    this.settleTimer = 0;
                }
                break;
            case 'SETTLING':
                break;
            case 'GETTING_UP': {
                this.weight = Math.max(0, this.weight - dt * GETUP_RATE);
                this.rd.driveToPoseKinematic(lerpPose(this.snapshot, this.animPose(), 1 - this.weight), dt);
                if (this.time >= GETUP_TIME && this.weight <= 0.05) {
                    this.weight = 0;
                    this.clip = 'idle';
                    this.time = 0;
                    this.setState('ANIMATED');
                }
                break;
            }
        }
    }
}
