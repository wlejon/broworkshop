// avatar.js — an auto-rigged, engine-animated body for the capsule.
//
// A box humanoid is generated with bromesh, rigged by Rig.autoRig (bounded
// biharmonic weights, voxel-bind as a fallback) and skinned on the GPU. It is
// then driven exactly the way demos/anim-lab drives its hand-built rig: the
// shared clip library in lib/kit/humanoid.js is compiled against THIS
// skeleton (boneFrames maps the canonical bone names onto the auto-rig's and
// hangs its T-pose arms), blend spaces map the controller's measured speed
// onto idle → walk → run, and a three-state machine picks ground / crouch /
// air from the controller's own groundState and stance. No bone is posed
// from JavaScript; update() only writes two numbers and, when the state
// changes, calls travel().

import { humanoidClipDefs, compileClips, AUTORIG_HUMANOID } from "/lib/kit/humanoid.js";
import { boneFrames, sampleTracks, compileClip, boneOverlay, skeletonParents } from "/lib/kit/skeletal.js";

function box(cx, cy, cz, hx, hy, hz) {
    const m = Mesh.box(hx, hy, hz);
    m.translate(cx, cy, cz);
    return m;
}

/**
 * A 1.76 m box humanoid in a T-pose, centred on the capsule centre (feet at
 * -0.89, the capsule's bottom is -0.90). Faces +Z.
 */
export function buildHumanoidMesh() {
    const parts = [
        box(0, 0.15, 0, 0.18, 0.18, 0.10), box(0, 0.40, 0, 0.20, 0.14, 0.11),     // torso
        box(0, 0.58, 0, 0.06, 0.06, 0.06), box(0, 0.74, 0, 0.11, 0.13, 0.12),     // neck, head
    ];
    for (const s of [-1, 1]) {
        parts.push(box(s * 0.26, 0.45, 0, 0.08, 0.055, 0.055));                   // shoulder
        parts.push(box(s * 0.39, 0.45, 0, 0.09, 0.05, 0.05));                     // upper arm
        parts.push(box(s * 0.54, 0.45, 0, 0.09, 0.045, 0.045));                   // forearm
        parts.push(box(s * 0.67, 0.45, 0, 0.05, 0.035, 0.045));                   // hand
        parts.push(box(s * 0.11, -0.25, 0, 0.065, 0.20, 0.065));                  // thigh
        parts.push(box(s * 0.11, -0.65, 0, 0.055, 0.20, 0.055));                  // shin
        parts.push(box(s * 0.11, -0.85, 0.04, 0.06, 0.04, 0.11));                 // foot
    }
    const mesh = Mesh.merge(parts);
    mesh.computeNormals();
    return mesh;
}

// Airborne: legs tucked, arms raised for balance. A held two-key loop.
function airDef() {
    const pose = {
        hips:  { rot: () => [0.18, 0, 0] },
        spine: { rot: () => [0.10, 0, 0] },
        hip_L: { rot: () => [-0.75, 0, 0.05] },  hip_R: { rot: () => [-0.45, 0, -0.05] },
        knee_L: { rot: () => [1.10, 0, 0] },     knee_R: { rot: () => [0.80, 0, 0] },
        shoulder_L: { rot: () => [-0.9, 0, 0.35] }, shoulder_R: { rot: () => [-0.9, 0, -0.35] },
        elbow_L: { rot: () => [-0.5, 0, 0] },    elbow_R: { rot: () => [-0.5, 0, 0] },
    };
    return { name: 'air', duration: 1.0, loop: 'loop', tracks: sampleTracks(1.0, pose, 1) };
}

const GRAPH = {
    states: [
        { name: 'ground', source: 'locomotion' },
        { name: 'crouch', source: 'locomotionCrouch' },
        { name: 'air', source: 'air' },
    ],
    transitions: [
        { from: 'ground', to: 'crouch', fade: 0.18, syncPhase: true },
        { from: 'crouch', to: 'ground', fade: 0.18, syncPhase: true },
        { from: '*', to: 'air', fade: 0.12 },
        { from: '*', to: 'ground', fade: 0.15 },
        { from: '*', to: 'crouch', fade: 0.15 },
    ],
    initial: 'ground',
};

/**
 * Build, rig, skin and animate the avatar. Returns null when this build has
 * no Rig (the capsule stays the only visual).
 * Returns { node, skeleton, boneCount, methodUsed, clips, overlay,
 *           update(charState), state }.
 */
export function createAvatar(scene, opts) {
    if (typeof Rig === 'undefined' || typeof Rig.autoRig !== 'function') return null;
    const o = opts || {};
    const mesh = buildHumanoidMesh();
    let rig, methodUsed = 'bbw';
    try {
        rig = Rig.autoRig(mesh, { rigType: 'humanoid', method: 'bbw' });
    } catch (e) {
        console.warn('character-lab: BBW auto-rig failed, falling back to voxelBind:', e.message);
        rig = Rig.autoRig(mesh, { rigType: 'humanoid', method: 'voxelBind' });
        methodUsed = 'voxelBind';
    }

    const node = scene.createSkinnedMesh({
        data: mesh, skin: rig.skin, name: o.name || 'avatar',
        color: o.color || '#4fa8d8', metallic: 0.15, roughness: 0.45,
    });
    node.castsShadow = true;
    node.setSkeleton(rig.skeleton);

    const frames = boneFrames(rig.skeleton, AUTORIG_HUMANOID);
    const clips = compileClips(humanoidClipDefs(), frames,
        { only: ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk'] });
    const air = airDef();
    clips.defs.air = air;
    clips.animations.air = compileClip(air, frames, { lenient: true });
    clips.names.push('air');
    for (const n of clips.names) node.addClip(n, clips.animations[n]);

    // The axis is the controller's measured planar speed in m/s, so the gait
    // matches the ground it covers.
    node.addBlendSpace1D('locomotion', [
        { clip: 'idle', pos: 0.0 }, { clip: 'walk', pos: 1.6 }, { clip: 'run', pos: 5.0 },
    ]);
    node.addBlendSpace1D('locomotionCrouch', [
        { clip: 'crouchIdle', pos: 0.0 }, { clip: 'crouchWalk', pos: 1.6 },
    ]);
    node.addStateMachine(GRAPH);

    const overlay = boneOverlay(scene, node, skeletonParents(rig.skeleton));

    return {
        node, skeleton: rig.skeleton, boneCount: rig.skeleton.bones.length, methodUsed, clips, overlay,
        get state() { return node.state; },
        /** Feed the controller's state in: two blend positions and maybe a travel. */
        update(cs) {
            const speed = cs.horizontalSpeed || 0;
            node.setBlendPos('locomotion', speed);
            node.setBlendPos('locomotionCrouch', speed);
            const want = !cs.isGrounded ? 'air' : cs.stance === 'crouching' ? 'crouch' : 'ground';
            if (node.state !== want) node.travel(want);
            overlay.update();
        },
    };
}
