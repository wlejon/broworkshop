// rig.js — a humanoid skeleton and a skinned mesh bound to it, built from
// nothing but bromesh primitives.
//
// There is no character asset in this repo, and the point of the demo is the
// ANIMATION tower rather than the art, so the whole rig is generated: a bone
// table gives the hierarchy, capsules welded along each bone give the body,
// and per-vertex weights fall out of distance-to-bone-segment. The result is
// blocky, but it is a genuine GPU-skinned mesh — the same seam a glTF import
// lands on — so everything downstream (clips, blending, state machines) is
// exercised for real.
//
// Conventions, all of which matter and none of which are guessable:
//   - Quaternions are xyzw. Matrices are column-major mat4 (translation at
//     indices 12/13/14), matching glTF and bromesh.
//   - The bind pose uses IDENTITY rotations on every bone, so each bone's
//     world matrix is a pure translation and its inverse-bind is just the
//     negated translation. That keeps the rig math trivial and exact.
//   - Because the bind rotations are identity, every limb bone points along
//     its own local -Y (arms hang down, legs go down, spine goes up). Clip
//     authoring in clips.js relies on that uniformity: +X rotation swings a
//     limb toward -Z, +Z rotation swings it toward -X.

// ── Bone table ───────────────────────────────────────────────────────────────
//
// [name, parentName, localTranslation]. Order is the bone index order, and
// parents must precede children (the engine's forward kinematics walks the
// array once). `root` sits at the origin and is deliberately left out of the
// skinning weights — it exists as the root-motion bone.

const BONE_TABLE = [
    ['root',       null,        [0,     0,     0]],
    ['hips',       'root',      [0,     0.98,  0]],
    ['spine',      'hips',      [0,     0.16,  0]],
    ['chest',      'spine',     [0,     0.20,  0]],
    ['neck',       'chest',     [0,     0.20,  0]],
    ['head',       'neck',      [0,     0.11,  0]],

    // The arms bind in an A-POSE — angled out roughly 25° — and that is not a
    // style choice, it is what makes proximity weighting possible at all.
    // Twice this rig was built with the arms hanging straight down, and twice
    // the skin tore: first the shoulder sat inside the 0.135-radius torso
    // capsule so the upper arm's root vertices bound to `chest`, then the
    // hands ended up level with and beside the hips, so hip vertices bound to
    // `wrist`. Separating the limbs in the bind pose is the whole reason the
    // industry binds in a T- or A-pose, and it is cheaper than any amount of
    // weight-painting cleverness.
    //
    // Rotations stay identity, so bone world matrices remain pure
    // translations and the inverse-binds stay trivial — the pose is angled by
    // the OFFSETS, not by bind rotations.
    ['shoulder_L', 'chest',     [ 0.21,  0.13,  0]],
    ['elbow_L',    'shoulder_L',[ 0.115,-0.245, 0]],
    ['wrist_L',    'elbow_L',   [ 0.105,-0.225, 0]],
    ['shoulder_R', 'chest',     [-0.21,  0.13,  0]],
    ['elbow_R',    'shoulder_R',[-0.115,-0.245, 0]],
    ['wrist_R',    'elbow_R',   [-0.105,-0.225, 0]],

    ['hip_L',      'hips',      [ 0.10,-0.06,  0]],
    ['knee_L',     'hip_L',     [0,    -0.42,  0]],
    ['ankle_L',    'knee_L',    [0,    -0.40,  0]],
    ['toe_L',      'ankle_L',   [0,    -0.06,  0.13]],
    ['hip_R',      'hips',      [-0.10,-0.06,  0]],
    ['knee_R',     'hip_R',     [0,    -0.42,  0]],
    ['ankle_R',    'knee_R',    [0,    -0.40,  0]],
    ['toe_R',      'ankle_R',   [0,    -0.06,  0.13]],
];

// Limb geometry: one capsule per [from, to] bone pair at the given radius.
// Radii are chosen so neighbouring capsules overlap slightly — the mesh is a
// merge, not a boolean union, so overlap is what makes the joints read as
// welded rather than as a string of sausages.
const LIMB_PARTS = [
    ['hips',       'spine',      0.130],
    ['spine',      'chest',      0.132],
    ['chest',      'neck',       0.135],
    ['neck',       'head',       0.055],

    ['shoulder_L', 'elbow_L',    0.062],
    ['elbow_L',    'wrist_L',    0.052],
    ['shoulder_R', 'elbow_R',    0.062],
    ['elbow_R',    'wrist_R',    0.052],

    ['hip_L',      'knee_L',     0.090],
    ['knee_L',     'ankle_L',    0.074],
    ['ankle_L',    'toe_L',      0.058],
    ['hip_R',      'knee_R',     0.090],
    ['knee_R',     'ankle_R',    0.074],
    ['ankle_R',    'toe_R',      0.058],
];

// Bones whose weighting segment is a short stub rather than a bone-to-child
// span, because they are chain ends with no child to point at.
const LEAF_STUB = 0.09;

// How much farther than the nearest bone a SECOND bone may be and still take
// any weight, in metres. This is the single most important number in the
// skin: without it, "two nearest bones by inverse-square distance" gives a
// torso vertex a few percent of the shoulder, and raising the arm then drags
// a sheet of body with it. A narrow band means two bones share a vertex only
// where they genuinely meet — at a joint — and everywhere else the vertex is
// rigid to one bone.
const BLEND_BAND = 0.07;

// ── Small vector helpers ─────────────────────────────────────────────────────

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function len(a)    { return Math.hypot(a[0], a[1], a[2]); }
function norm(a)   { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }

// Squared distance from point p to the segment [a, b], plus the clamped
// parameter. Used both for skin weighting and for the debug bone overlay.
function distToSegment(p, a, b) {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    let t = l2 > 1e-9 ? dot(sub(p, a), ab) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ── Skeleton construction ────────────────────────────────────────────────────

/**
 * Build the humanoid Skeleton plus the bind-pose world positions every other
 * stage needs (geometry placement, weighting, the debug overlay).
 * @returns {{ skeleton, names: string[], index: Object, parents: number[],
 *             worldPos: number[][], children: number[][] }}
 */
export function buildSkeleton() {
    const names = BONE_TABLE.map((b) => b[0]);
    const index = {};
    names.forEach((n, i) => { index[n] = i; });

    const parents = BONE_TABLE.map((b) => (b[1] === null ? -1 : index[b[1]]));
    const local = BONE_TABLE.map((b) => b[2]);

    // Parents precede children by construction, so one forward pass resolves
    // every world position.
    const worldPos = [];
    for (let i = 0; i < names.length; ++i) {
        const p = parents[i];
        worldPos.push(p < 0 ? local[i].slice() : add(worldPos[p], local[i]));
    }

    const children = names.map(() => []);
    parents.forEach((p, i) => { if (p >= 0) children[p].push(i); });

    // Identity bind rotations mean the inverse-bind is a pure negated
    // translation — no general matrix inverse needed anywhere in this app.
    const bones = names.map((name, i) => ({
        name,
        parent: parents[i],
        localT: local[i],
        localR: [0, 0, 0, 1],
        localS: [1, 1, 1],
        inverseBind: inverseTranslation(worldPos[i]),
    }));

    return {
        skeleton: Skeleton.fromBones(bones),
        names, index, parents, worldPos, children,
    };
}

function inverseTranslation(t) {
    const m = new Float32Array(16);
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
    m[12] = -t[0]; m[13] = -t[1]; m[14] = -t[2];
    return m;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * A capsule spanning world points `a` → `b`. Mesh.capsule builds along +Y
 * centred at the origin, so this rotates +Y onto the segment direction and
 * translates to the midpoint. halfHeight is the CYLINDRICAL half-length, so
 * it is shortened by the cap radius to keep the finished capsule roughly the
 * segment's length.
 */
function capsuleBetween(a, b, radius, segments = 12, rings = 6) {
    const d = sub(b, a);
    const l = len(d);
    const half = Math.max(l * 0.5 - radius * 0.6, l * 0.15);
    const mesh = Mesh.capsule(radius, half, segments, rings);

    const dir = norm(d);
    const axis = cross([0, 1, 0], dir);
    const axisLen = len(axis);
    if (axisLen > 1e-6) {
        mesh.rotate(axis[0] / axisLen, axis[1] / axisLen, axis[2] / axisLen,
                    Math.acos(Math.max(-1, Math.min(1, dot([0, 1, 0], dir)))));
    } else if (dir[1] < 0) {
        mesh.rotate(1, 0, 0, Math.PI);      // antiparallel: any perpendicular axis
    }

    const c = mid(a, b);
    return mesh.translate(c[0], c[1], c[2]);
}

/** Merge the capsule limbs plus the head/hand/foot props into one Mesh. */
function buildBodyMesh(rig) {
    const parts = [];

    for (const [from, to, radius] of LIMB_PARTS) {
        parts.push(capsuleBetween(rig.worldPos[rig.index[from]],
                                  rig.worldPos[rig.index[to]], radius));
    }

    // Head: a sphere slightly above the head joint, so the neck capsule enters
    // it rather than stopping at its centre.
    const hp = rig.worldPos[rig.index.head];
    parts.push(Mesh.sphere(0.125, 20, 14).translate(hp[0], hp[1] + 0.09, hp[2]));

    // Hands and feet: small boxes. Feet are offset forward from the ankle so
    // the silhouette has a toe — it is what makes a walk cycle readable.
    for (const s of ['L', 'R']) {
        // The hand continues along the forearm rather than straight down, so
        // it stays under the wrist bone in the angled A-pose.
        const w = rig.worldPos[rig.index['wrist_' + s]];
        const e = rig.worldPos[rig.index['elbow_' + s]];
        const fd = norm(sub(w, e));
        parts.push(Mesh.box(0.045, 0.062, 0.035)
            .translate(w[0] + fd[0] * 0.05, w[1] + fd[1] * 0.05, w[2] + fd[2] * 0.05));

        const t = rig.worldPos[rig.index['toe_' + s]];
        parts.push(Mesh.box(0.055, 0.032, 0.10)
            .translate(t[0], t[1] - 0.005, t[2] + 0.03));
    }

    return Mesh.merge(parts);
}

// ── Skin weighting ───────────────────────────────────────────────────────────

/**
 * Per-vertex bone indices + weights by proximity to bone segments.
 *
 * Each bone gets one weighting segment: bone origin → first child origin, or a
 * short downward stub for chain ends. Every vertex takes the two nearest
 * segments with inverse-square-distance weights, which produces a natural soft
 * falloff across a joint (a vertex on the elbow ends up genuinely shared
 * between upper and lower arm) without any painting.
 *
 * `root` is excluded: its segment would run straight up through the legs and
 * steal weight from them. It stays a pure transform bone for root motion.
 */
function buildSkin(mesh, rig) {
    const nb = rig.names.length;
    const rootIdx = rig.index.root;

    const segA = [], segB = [];
    for (let b = 0; b < nb; ++b) {
        const a = rig.worldPos[b];
        const kid = rig.children[b][0];
        segA.push(a);
        if (kid !== undefined && b !== rootIdx) {
            segB.push(rig.worldPos[kid]);
        } else {
            // Leaf (or root): stub along the direction this bone came from,
            // so the segment still has an orientation to be near.
            const p = rig.parents[b];
            const dir = p >= 0 ? norm(sub(a, rig.worldPos[p])) : [0, 1, 0];
            segB.push([a[0] + dir[0] * LEAF_STUB,
                       a[1] + dir[1] * LEAF_STUB,
                       a[2] + dir[2] * LEAF_STUB]);
        }
    }

    const pos = mesh.positions;
    const vc = mesh.vertexCount;
    const weights = new Float32Array(vc * 4);
    const indices = new Uint32Array(vc * 4);

    for (let v = 0; v < vc; ++v) {
        const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];

        // Track the two nearest bones in one pass.
        let b0 = -1, d0 = Infinity, b1 = -1, d1 = Infinity;
        for (let b = 0; b < nb; ++b) {
            if (b === rootIdx) continue;
            const d = distToSegment(p, segA[b], segB[b]);
            if (d < d0)      { b1 = b0; d1 = d0; b0 = b; d0 = d; }
            else if (d < d1) { b1 = b;  d1 = d; }
        }

        // Inverse-square weights, but the second influence is tapered to zero
        // across BLEND_BAND so it vanishes smoothly away from the joint
        // rather than being cut off with a seam.
        const taper = b1 >= 0 ? Math.max(0, 1 - (d1 - d0) / BLEND_BAND) : 0;
        const w0 = 1 / (d0 * d0 + 1e-4);
        const w1 = taper > 0 ? (1 / (d1 * d1 + 1e-4)) * taper * taper : 0;
        const sum = w0 + w1;

        const o = v * 4;
        indices[o]     = b0;
        indices[o + 1] = b1 >= 0 ? b1 : b0;
        weights[o]     = w0 / sum;
        weights[o + 1] = w1 / sum;
        // Slots 2/3 stay zero; SkinData still wants the full stride-4 layout.
        indices[o + 2] = b0;
        indices[o + 3] = b0;
    }

    // Inverse-binds are per bone and shared with the skeleton definition.
    const ibm = new Float32Array(nb * 16);
    for (let b = 0; b < nb; ++b) ibm.set(inverseTranslation(rig.worldPos[b]), b * 16);

    return new SkinData({
        boneWeights: weights,
        boneIndices: indices,
        inverseBindMatrices: ibm,
        boneCount: nb,
    });
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Build the character and add it to the scene.
 * @param {Object} scene
 * @param {Object} [opts] - { name, x, y, z, color }
 * @returns {{ node, rig, skeleton, mesh, skin, boneCount }}
 */
export function buildCharacter(scene, opts = {}) {
    const rig = buildSkeleton();
    const mesh = buildBodyMesh(rig);
    mesh.computeNormals();
    const skin = buildSkin(mesh, rig);

    // A clean skin is a precondition for everything else — an orphan vertex
    // (no bone within reach) collapses to the origin the moment a clip plays,
    // which looks like a broken clip rather than a broken bind.
    const report = SkinData.validate(mesh, skin);
    if (!report.clean) {
        console.warn('anim-lab: skin validation not clean —', JSON.stringify(report));
    }

    const node = scene.createSkinnedMesh({
        data: mesh,
        skin,
        name: opts.name || 'character',
        x: opts.x || 0, y: opts.y || 0, z: opts.z || 0,
        color: opts.color || '#c9b79c',
        metallic: 0.0,
        roughness: 0.62,
    });
    node.castsShadow = true;
    node.setSkeleton(rig.skeleton);

    return { node, rig, skeleton: rig.skeleton, mesh, skin,
             boneCount: rig.names.length, skinReport: report };
}

export { BONE_TABLE, distToSegment };
