// A creature's skeleton, resolved: bone indices, the constants module the
// rig and the skin hook import (`creature::skeleton`), and the reading of a
// pose back into joint positions and angles.
//
// A pose is, per bone, three vec4 rows [R | p]: the bone's world rotation
// from rest and the world position of its head. A rest point q of the bone
// is at R (q - head) + p.
//
// A bone marked `face` carries no flesh and no mass: its turn from the head
// is a part of the face's state (`gaze`: where the eyes look; `lid`: the
// eyelids' hinge, x closing them and z tilting them), written by the rig as
// any bone's is and drawn by the creature's face (lab/skin.bk). The
// measures of how the body moves leave them out: an eye is meant to jump.

export const ROWS = 12;   // floats per bone in a pose

const DEG = Math.PI / 180;

export function resolveSkeleton(def) {
    const bones = def.bones.map((b, i) => ({ ...b, index: i }));
    const byName = new Map(bones.map((b) => [b.name, b]));
    for (const b of bones) {
        b.parentIndex = b.parent == null ? -1 : byName.get(b.parent)?.index;
        if (b.parentIndex === undefined) throw new Error(`skeleton: ${b.name}'s parent ${b.parent} is unknown`);
        if (b.parentIndex >= b.index) throw new Error(`skeleton: ${b.name} comes before its parent ${b.parent}`);
        b.length = Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
        const lim = b.limits || {};
        b.lim = ['x', 'y', 'z'].map((k) => (lim[k] || [-180, 180]).map((d) => d * DEG));
    }
    const index = (name) => {
        const b = byName.get(name);
        if (!b) throw new Error(`skeleton: no bone ${name}`);
        return b.index;
    };
    const feet = (def.feet || []).map((f, k) => ({ ...f, index: k, boneIndex: index(f.bone) }));
    const tracks = (def.tracks || []).map((t) => ({ ...t, boneIndex: index(t.bone) }));
    const mass = bones.reduce((s, b) => s + (b.mass || 0), 0);
    const parts = skeletonParts(bones, feet);
    return {
        bones, feet, tracks, mass, count: bones.length, index, parts,
        chartJoints: (def.chartJoints || []).map(index),
        module: skeletonModule(bones, feet, tracks, parts),
    };
}

// What the general motion layers need of any skeleton, from its bones alone:
//   legs      per foot, the chain above it (up through parents that carry
//             only that chain) and its top bone, the joint the leg swings
//             from, and the chain's length
//   dangle    bones off the legs and off the root that carry no leg below
//             them: neck, head, ears, tail (the parts that hang and swing)
//   spine     the chain from the root to the bone the front-most leg hangs
//             from (the trunk the legs hold up)
//   subtree   per bone, the mass it carries (itself and everything below it)
//             and where that mass's centre is from its head at rest
function skeletonParts(bones, feet) {
    const kids = bones.map(() => []);
    for (const b of bones) if (b.parentIndex >= 0) kids[b.parentIndex].push(b.index);
    const inLeg = new Set();
    const legs = feet.map((f) => {
        let b = f.boneIndex, len = 0;
        const chain = [];
        while (b >= 0) {
            inLeg.add(b);
            chain.push(b);
            len += bones[b].length;
            const p = bones[b].parentIndex;
            if (p < 0 || kids[p].length > 1) break;
            b = p;
        }
        return { foot: f.index, top: b, chain: chain.reverse(), length: len, carrier: bones[b].parentIndex };
    });
    const sub = bones.map(() => ({ m: 0, c: [0, 0, 0] }));
    for (let i = bones.length - 1; i >= 0; i--) {
        const b = bones[i], m = b.mass || 0;
        const mid = [0, 1, 2].map((k) => (b.head[k] + b.tail[k]) / 2);
        const s = sub[i];
        for (let k = 0; k < 3; k++) s.c[k] += mid[k] * m;
        s.m += m;
        if (b.parentIndex >= 0) {
            const p = sub[b.parentIndex];
            for (let k = 0; k < 3; k++) p.c[k] += s.c[k];
            p.m += s.m;
        }
    }
    const subC = sub.map((s, i) => (s.m > 0 ? s.c.map((v, k) => v / s.m - bones[i].head[k]) : [0, 0, 0]));
    const hasLeg = bones.map(() => false);
    for (const l of legs) for (let b = l.top; b >= 0; b = bones[b].parentIndex) hasLeg[b] = true;
    const root = bones.findIndex((b) => b.parentIndex < 0);
    // (A face bone is among them: with no mass it is carried exactly as its
    // parent goes, which is what keeps the eyes in a head that swings.)
    const dangle = bones.map((b) => (!inLeg.has(b.index) && b.index !== root && !hasLeg[b.index] ? 1 : 0));
    // The spine: from the carrier of the front-most leg back to the root.
    let front = legs[0];
    for (const l of legs) if (bones[l.top].head[2] > bones[front.top].head[2]) front = l;
    const spine = [];
    for (let b = front ? front.carrier : root; b >= 0; b = bones[b].parentIndex) spine.unshift(b);
    return { legs, dangle, spine, subMass: sub.map((s) => s.m), subC, root };
}

const f = (x) => {
    const s = String(Math.fround(x));
    return /[.eE]/.test(s) ? s : s + '.0';
};
const v3 = (a) => `vec3<f32>(${a.map(f).join(', ')})`;

// The constants module every rig and the skin hook import.
function skeletonModule(bones, feet, tracks, parts) {
    const n = bones.length;
    const arr = (t, xs) => `array<${t}, ${xs.length}> = [${xs.join(', ')}]`;
    const track = (name) => { const t = tracks.find((x) => x.name === name); return t ? t.boneIndex : -1; };
    let s = 'module creature::skeleton;\n';
    s += `pub const NB: i32 = ${n};\n`;
    s += `pub const NFEET: i32 = ${feet.length};\n`;
    s += `pub const HEAD: array<vec3<f32>, ${n}> = [${bones.map((b) => v3(b.head)).join(', ')}];\n`;
    s += `pub const TAIL: array<vec3<f32>, ${n}> = [${bones.map((b) => v3(b.tail)).join(', ')}];\n`;
    s += `pub const PARENT: array<i32, ${n}> = [${bones.map((b) => b.parentIndex).join(', ')}];\n`;
    s += `pub const LIM_LO: array<vec3<f32>, ${n}> = [${bones.map((b) => v3(b.lim.map((r) => r[0]))).join(', ')}];\n`;
    s += `pub const LIM_HI: array<vec3<f32>, ${n}> = [${bones.map((b) => v3(b.lim.map((r) => r[1]))).join(', ')}];\n`;
    // The skeleton's parts (skeletonParts): masses, the dangling chains, legs.
    s += `pub const MASS: ${arr('f32', bones.map((b) => f(b.mass || 0)))};\n`;
    s += `pub const TOTAL_MASS: f32 = ${f(Math.max(1e-3, bones.reduce((a, b) => a + (b.mass || 0), 0)))};\n`;
    s += `pub const ROOT: i32 = ${parts.root};\n`;
    s += `pub const DANGLE: ${arr('i32', parts.dangle)};\n`;
    s += `pub const SUB_MASS: ${arr('f32', parts.subMass.map(f))};\n`;
    s += `pub const SUB_C: ${arr('vec3<f32>', parts.subC.map(v3))};\n`;
    const legs = parts.legs.length ? parts.legs : [{ top: parts.root, length: 1, carrier: -1 }];
    s += `pub const NLEGS: i32 = ${parts.legs.length};\n`;
    s += `pub const LEG_TOP: ${arr('i32', legs.map((l) => l.top))};\n`;
    s += `pub const LEG_LEN: ${arr('f32', legs.map((l) => f(l.length)))};\n`;
    s += `pub const LEG_CARRIER: ${arr('i32', legs.map((l) => l.carrier))};\n`;
    s += `pub const FOOT_BONE: ${arr('i32', (feet.length ? feet : [{ boneIndex: parts.root }]).map((ft) => ft.boneIndex))};\n`;
    s += `pub const MEAN_LEG: f32 = ${f(legs.reduce((a, l) => a + l.length, 0) / legs.length)};\n`;
    s += `pub const NSPINE: i32 = ${parts.spine.length};\n`;
    s += `pub const SPINE: ${arr('i32', parts.spine.length ? parts.spine : [parts.root])};\n`;
    s += `pub const TRACK_HEAD: i32 = ${track('head')};\n`;
    // The face's bones (`face: 'gaze' | 'lid'`, children of the head): the
    // skin hooks read their turns from the head and hand them to the face.
    const faceBone = (kind) => { const b = bones.find((x) => x.face === kind); return b ? b.index : -1; };
    const gaze = faceBone('gaze'), lid = faceBone('lid');
    s += `pub const FACE_GAZE: i32 = ${gaze};\n`;
    s += `pub const FACE_LID: i32 = ${lid};\n`;
    s += `pub const FACE_HEAD: i32 = ${gaze >= 0 ? bones[gaze].parentIndex : lid >= 0 ? bones[lid].parentIndex : Math.max(0, track('head'))};\n`;
    for (const b of bones) s += `pub const B_${b.name.toUpperCase()}: i32 = ${b.index};\n`;
    for (const ft of feet) s += `pub const FOOT_${ft.name.toUpperCase()}: i32 = ${ft.index};\n`;
    return s;
}

// --- reading poses (JS, for the lab's measures) ----------------------------

// The world position of rest point q on bone b of pose P (Float32Array, at
// float offset o of the creature's first bone).
export function bonePoint(P, o, b, head, q) {
    const k = o + b * ROWS;
    const x = q[0] - head[0], y = q[1] - head[1], z = q[2] - head[2];
    return [
        P[k] * x + P[k + 1] * y + P[k + 2] * z + P[k + 3],
        P[k + 4] * x + P[k + 5] * y + P[k + 6] * z + P[k + 7],
        P[k + 8] * x + P[k + 9] * y + P[k + 10] * z + P[k + 11],
    ];
}

export function boneHead(P, o, b) {
    const k = o + b * ROWS;
    return [P[k + 3], P[k + 7], P[k + 11]];
}

export function boneTail(P, o, bone) {
    return bonePoint(P, o, bone.index, bone.head, bone.tail);
}

export function boneAt(P, o, bone, t) {
    const q = [0, 1, 2].map((i) => bone.head[i] + (bone.tail[i] - bone.head[i]) * t);
    return bonePoint(P, o, bone.index, bone.head, q);
}

// The 3x3 rotation of bone b, row-major.
export function boneRot(P, o, b) {
    const k = o + b * ROWS;
    return [P[k], P[k + 1], P[k + 2], P[k + 4], P[k + 5], P[k + 6], P[k + 8], P[k + 9], P[k + 10]];
}

// A^T B for row-major 3x3.
function relRot(A, B) {
    const out = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        out[3 * i + j] = A[i] * B[j] + A[3 + i] * B[3 + j] + A[6 + i] * B[6 + j];
    }
    return out;
}

// Euler angles (radians) of R = Rx(x) Ry(y) Rz(z).
export function eulerXYZ(R) {
    const y = Math.asin(Math.max(-1, Math.min(1, R[2])));
    const x = Math.atan2(-R[5], R[8]);
    const z = Math.atan2(-R[1], R[0]);
    return [x, y, z];
}

// Each bone's angles from rest relative to its parent (radians, [x, y, z]).
export function jointAngles(P, o, skel) {
    const out = new Array(skel.count);
    for (const b of skel.bones) {
        const R = boneRot(P, o, b.index);
        const rel = b.parentIndex < 0 ? R : relRot(boneRot(P, o, b.parentIndex), R);
        out[b.index] = eulerXYZ(rel);
    }
    return out;
}

// The centre of mass of a pose: each bone's mass at its middle.
export function centreOfMass(P, o, skel) {
    let m = 0;
    const c = [0, 0, 0];
    for (const b of skel.bones) {
        if (!b.mass) continue;
        const p = boneAt(P, o, b, 0.5);
        for (let i = 0; i < 3; i++) c[i] += p[i] * b.mass;
        m += b.mass;
    }
    return c.map((x) => x / (m || 1));
}

// The rest pose: identity rotations at the rest heads.
export function restPose(skel) {
    const P = new Float32Array(skel.count * ROWS);
    for (const b of skel.bones) {
        P.set([1, 0, 0, b.head[0], 0, 1, 0, b.head[1], 0, 0, 1, b.head[2]], b.index * ROWS);
    }
    return P;
}
