// lib/kit/skeletal.js — skeletal clips as data, and a bone overlay.
//
// The engine's skinned-mesh player (node.play / blend spaces / layers / state
// machines) evaluates bromesh `Animation` clips in C++. This module is the JS
// half that turns readable keyframe DATA into those clips, and draws the pose
// the engine is skinning with.
//
//   import { boneFrames, sampleTracks, compileClip, boneOverlay } from "/lib/kit/skeletal.js";
//
//   const target = boneFrames(skeleton);                  // any Skeleton
//   const def = { name: 'nod', duration: 1.5, tracks: sampleTracks(1.5, {
//       head: { rot: (p) => [0.3 * Math.sin(p * 2 * Math.PI), 0, 0] },
//   }, 24) };
//   node.addClip('nod', compileClip(def, target));
//
// Rotations are authored in MODEL axes, about the bone's pivot, relative to
// the rest pose: +X tips a downward limb backward (toward -Z), -X swings it
// forward, whatever the rig's own bone-axis convention is. boneFrames()
// precomputes the per-bone change of frame, so the same clip data drives an
// identity-bind rig (demos/anim-lab) and an auto-rigged one whose bones point
// along their local +Y (demos/character-lab) — see lib/kit/humanoid.js.
// Translation keys are OFFSETS from the bone's bind translation.
//
// Quaternions are [x, y, z, w]; matrices are column-major (translation at
// 12/13/14), matching bromesh and glTF.

import { quatYTo, quatFromEuler, quatMul } from "./math3d.js";

const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
const QI = [0, 0, 0, 1];

// --- bone frames --------------------------------------------------------------

/**
 * Everything compileClip needs to know about a skeleton. opts:
 *   map    { canonicalName: actualName } — clip data names bones by the
 *          canonical vocabulary; names not in the map resolve as themselves.
 *   rest   { canonicalName: [ex, ey, ez] } — a model-axes rotation applied
 *          to that bone before any clip (e.g. hang an auto-rig's T-pose arms).
 *          Every compiled clip holds rested bones at their rest rotation.
 * Returns { index(name) -> bone index or -1, names, pre[], post[], bindT[] }.
 */
export function boneFrames(skeleton, opts) {
    const o = opts || {};
    const bones = skeleton.bones;               // fresh Joint copies
    const n = bones.length;
    const byName = new Map();
    bones.forEach((b, i) => byName.set(b.name, i));
    const map = o.map || {};
    const index = (name) => {
        const actual = Object.prototype.hasOwnProperty.call(map, name) ? map[name] : name;
        const i = actual == null ? undefined : byName.get(actual);
        return i === undefined ? -1 : i;
    };

    // Rested world rotations by forward kinematics (parents precede children).
    const restQ = new Array(n).fill(null);
    for (const canon of Object.keys(o.rest || {})) {
        const i = index(canon);
        if (i >= 0) { const e = o.rest[canon]; restQ[i] = quatFromEuler(e[0], e[1], e[2]); }
    }
    const world = new Array(n);
    const pre = new Array(n), post = new Array(n), bindT = new Array(n);
    for (let i = 0; i < n; ++i) {
        const b = bones[i];
        const parentW = b.parent >= 0 ? world[b.parent] : QI;
        let w = quatMul(parentW, Array.from(b.localR));
        if (restQ[i]) w = quatMul(restQ[i], w);
        world[i] = w;
        // local = conj(W'parent) * D * W'bone  — D in model axes.
        pre[i] = conj(parentW);
        post[i] = w;
        bindT[i] = Array.from(b.localT);
    }
    const rested = restQ.map((q, i) => (q ? i : -1)).filter((i) => i >= 0);
    return { index, names: bones.map((b) => b.name), pre, post, bindT, rested, boneCount: n };
}

// --- clip data -------------------------------------------------------------------

/**
 * Bake phase-driven curves into keyframe tracks. `curves` maps a bone name to
 * { rot(p) -> [ex,ey,ez], pos(p) -> [dx,dy,dz] } for normalized phase p.
 * Sampling runs 0..steps INCLUSIVE, so a looping clip's last key equals its
 * first (the engine wraps at `duration`; a missing end key shows as a hitch).
 */
export function sampleTracks(duration, curves, steps) {
    const tracks = [];
    for (const bone of Object.keys(curves)) {
        const c = curves[bone];
        const rot = c.rot ? [] : null, pos = c.pos ? [] : null;
        for (let i = 0; i <= steps; ++i) {
            const p = i / steps, time = p * duration;
            if (rot) rot.push({ time, euler: c.rot(p) });
            if (pos) pos.push({ time, value: c.pos(p) });
        }
        if (rot) tracks.push({ bone, property: 'rotation', keys: rot });
        if (pos) tracks.push({ bone, property: 'translation', keys: pos });
    }
    return tracks;
}

/**
 * Compile a clipDef — { name, duration, tracks: [{ bone, property:
 * 'rotation'|'translation'|'scale', interp, keys: [{ time, euler | value }] }] }
 * — into a bromesh Animation for `frames` (from boneFrames). Tracks naming a
 * bone the skeleton does not have are dropped when opts.lenient, else throw.
 */
export function compileClip(def, frames, opts) {
    const lenient = !!(opts && opts.lenient);
    const channels = [];
    const driven = new Set();
    for (const track of def.tracks) {
        const bi = frames.index(track.bone);
        if (bi < 0) {
            if (lenient) continue;
            throw new Error(`clip "${def.name}": unknown bone "${track.bone}"`);
        }
        const isRot = track.property === 'rotation';
        const stride = isRot ? 4 : 3;
        const times = new Float32Array(track.keys.length);
        const values = new Float32Array(track.keys.length * stride);
        track.keys.forEach((key, k) => {
            times[k] = key.time;
            let v;
            if (isRot) {
                const d = key.euler ? quatFromEuler(key.euler[0], key.euler[1], key.euler[2]) : key.value;
                v = quatMul(quatMul(frames.pre[bi], d), frames.post[bi]);
            } else if (track.property === 'translation') {
                const t = frames.bindT[bi];
                v = [t[0] + key.value[0], t[1] + key.value[1], t[2] + key.value[2]];
            } else {
                v = key.value;
            }
            values.set(v, k * stride);
        });
        if (isRot) driven.add(bi);
        channels.push({ boneIndex: bi, path: track.property, interp: track.interp || 'linear', times, values });
    }
    // Rested bones this clip does not drive still hold their rest rotation.
    for (const bi of frames.rested || []) {
        if (driven.has(bi)) continue;
        const r = quatMul(frames.pre[bi], frames.post[bi]);
        channels.push({ boneIndex: bi, path: 'rotation', interp: 'linear',
                        times: new Float32Array([0, def.duration]), values: new Float32Array([...r, ...r]) });
    }
    return new Animation({ name: def.name, duration: def.duration, channels });
}

// --- bone overlay ----------------------------------------------------------------

/**
 * Joint markers and parent->child links that track a skinned mesh's pose via
 * getBoneWorldMatrix(). Those matrices are MODEL space, so every marker is a
 * child of `node`: the engine composes the node transform, and the overlay
 * stays glued to the rig under root motion or any node transform.
 * `parents[i]` is bone i's parent index (-1 at a root). Off by default.
 * opts: { jointRadius = 0.028, linkWidth = 0.012, jointColor, linkColor }.
 * Returns { setEnabled(on), update(), joints, links, enabled }.
 */
export function boneOverlay(scene, node, parents, opts) {
    const o = Object.assign({ jointRadius: 0.028, linkWidth: 0.012,
                              jointColor: [1.0, 0.85, 0.35], linkColor: [0.40, 0.80, 1.0] }, opts);
    const joints = parents.map(() => {
        const j = scene.createMesh({
            mesh: 'sphere', radius: o.jointRadius, segments: 10, rings: 7,
            color: '#ffffff', unlit: true, emissive: 2.0, emissiveColor: o.jointColor, visible: false,
        });
        node.add(j);
        return j;
    });
    // A unit-height box per link, scaled along Y to span the gap: three
    // property writes per bone per frame, no geometry rebuilds.
    const links = [];
    parents.forEach((p, i) => {
        if (p < 0) return;
        const m = scene.createMesh({
            mesh: 'box', halfW: o.linkWidth, halfH: 0.5, halfD: o.linkWidth,
            color: '#ffffff', unlit: true, emissive: 1.2, emissiveColor: o.linkColor, visible: false,
        });
        node.add(m);
        links.push({ child: i, parent: p, node: m });
    });

    let enabled = false;
    const pos = new Array(parents.length);
    const api = {
        joints, links,
        get enabled() { return enabled; },
        setEnabled(on) {
            enabled = !!on;
            for (const j of joints) j.visible = enabled;
            for (const l of links) l.node.visible = enabled;
        },
        update() {
            if (!enabled) return;
            for (let i = 0; i < joints.length; ++i) {
                const m = node.getBoneWorldMatrix(i);
                if (!m) { pos[i] = null; continue; }
                pos[i] = [m[12], m[13], m[14]];
                const j = joints[i];
                j.x = m[12]; j.y = m[13]; j.z = m[14];
            }
            for (const l of links) {
                const a = pos[l.parent], c = pos[l.child];
                if (!a || !c) { l.node.visible = false; continue; }
                const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
                l.node.visible = true;
                l.node.x = (a[0] + c[0]) / 2; l.node.y = (a[1] + c[1]) / 2; l.node.z = (a[2] + c[2]) / 2;
                // scaleY, not `scale`: the two are separate node accessors.
                l.node.scaleY = Math.hypot(dx, dy, dz) || 1e-4;
                l.node.quaternion = quatYTo(dx, dy, dz);
            }
        },
    };
    return api;
}

/** Parent index per bone of a Skeleton (what boneOverlay wants). */
export function skeletonParents(skeleton) {
    return skeleton.bones.map((b) => b.parent);
}
