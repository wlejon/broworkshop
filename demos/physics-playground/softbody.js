// softbody.js — cloth and a pressurized volume.
//
// Soft bodies are the one physics primitive whose STATE does not fit in a
// transform. A rigid body is a position and a rotation; a soft body is a few
// hundred particles held together by XPBD constraints, and the only way to see
// it is to stream those particle positions into a mesh every frame. That
// streaming is half of what this module is for — the other half is showing that
// the particles are individually addressable.
//
// Two bodies, chosen because they exercise the two creation paths and the two
// things people actually want from soft bodies:
//
//   cloth   a grid in the local XZ plane. Pinned vertices have invMass 0, so
//           they do not move AT ALL — not "barely", exactly not. That makes the
//           pin set the cleanest possible proof the constraint layer is real:
//           the sheet between the pins sags metres while the pinned corners
//           hold to the bit.
//   ball    a closed icosphere with gas pressure. Pressure is a single scalar
//           and it changes the body from a wet rag to a drum: at 300 the ball
//           lands and stays landed, at 6000 it rebounds most of the way back.
//
// Per-vertex control (setVertex / setVertexVelocity) is the grab surface, and
// the gust/poke buttons are it in miniature — pick a region of indices, hand
// each one a velocity, and watch that region and only that region move.
//
// Note on pressure: there is no runtime setPressure. Pressure is baked at
// creation, so the slider rebuilds the ball. That is honest rather than
// awkward — the rebuild is instant and it also re-drops the ball, which is
// exactly what you want when comparing two pressures.

// --- Icosphere ---------------------------------------------------------------
//
// The pressurized path needs a CLOSED mesh with outward winding, and it needs
// roughly even triangle areas or the gas term pushes unevenly and the ball
// wobbles like a water balloon. An icosphere gives both; a UV sphere gives
// neither (its poles are a fan of slivers).

function icosphere(radius = 0.6, subdiv = 2) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    let faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];

    for (let s = 0; s < subdiv; s++) {
        const mid = new Map();
        const midpoint = (a, b) => {
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            let i = mid.get(key);
            if (i !== undefined) return i;
            const va = verts[a], vb = verts[b];
            verts.push([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
            i = verts.length - 1;
            mid.set(key, i);
            return i;
        };
        const next = [];
        for (const [a, b, c] of faces) {
            const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
            next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        faces = next;
    }

    const positions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const L = Math.hypot(v[0], v[1], v[2]) || 1;
        positions[i * 3]     = (v[0] / L) * radius;
        positions[i * 3 + 1] = (v[1] / L) * radius;
        positions[i * 3 + 2] = (v[2] / L) * radius;
    }
    const indices = new Uint32Array(faces.length * 3);
    for (let i = 0; i < faces.length; i++) {
        indices[i * 3] = faces[i][0]; indices[i * 3 + 1] = faces[i][1]; indices[i * 3 + 2] = faces[i][2];
    }
    return { positions, indices };
}

// --- Layout ------------------------------------------------------------------
//
// Both bodies live downfield of the water tank (x = 4..12) and above the lanes,
// so nothing here interferes with the material race or the area-field zones.

export const CLOTH = { gridX: 16, gridZ: 16, spacing: 0.28, mass: 3.0,
                       position: { x: 19, y: 6.0, z: 0 } };
export const BALL  = { radius: 0.6, subdiv: 2, mass: 2.0,
                       position: { x: 15, y: 6.0, z: 0 } };

/** Pin presets. Vertex (x,z) of a cloth grid lives at index z*gridX + x. */
export const PIN_SETS = {
    corners: 'four corners — a hammock; drop things into it',
    edge:    'one edge — a banner; the sheet drapes and swings',
    none:    'nothing pinned — the whole sheet falls',
};

export function pinIndices(set, gridX = CLOTH.gridX, gridZ = CLOTH.gridZ) {
    if (set === 'none') return [];
    if (set === 'edge') {
        const out = [];
        for (let x = 0; x < gridX; x++) out.push(x);     // the z = 0 row
        return out;
    }
    return [0, gridX - 1, (gridZ - 1) * gridX, gridX * gridZ - 1];
}

// --- Registry ----------------------------------------------------------------

/** key -> { key, sb, node, topo, meta } — at most one cloth and one ball. */
export const softBodies = new Map();

let sceneRef = null;
export function initSoftBodies(scene) { sceneRef = scene; }
export const softBodyCount = () => softBodies.size;

/**
 * Build the render mesh for a soft body and register the pair.
 *
 * The node is deliberately left at IDENTITY: vertices() streams WORLD-space
 * positions, so any transform on the node would apply twice. recomputeNormals
 * is not optional either — the stream carries positions only, and without
 * derived normals a deforming surface lights as if it were still flat.
 */
function register(key, sb, meta, look) {
    const topo = sb.topology();
    const node = sceneRef.createMesh({
        positions: sb.vertices(),
        indices: topo.indices,
        recomputeNormals: true,
        twoSided: true,
        ...look,
    });
    const entry = { key, sb, node, topo, meta };
    softBodies.set(key, entry);
    return entry;
}

/**
 * Create (or recreate) the cloth.
 * @param {string} [set='corners'] - a key of PIN_SETS
 */
export function buildCloth(set = 'corners', opts = {}) {
    if (!sceneRef) throw new Error('softbody.js: initSoftBodies(scene) not called');
    destroySoft('cloth');

    const sb = Physics.createSoftBody({
        cloth: {
            gridX: CLOTH.gridX, gridZ: CLOTH.gridZ, spacing: CLOTH.spacing,
            mass: CLOTH.mass, pinned: pinIndices(set),
        },
        position: CLOTH.position,
        layer: 'player',
        // Rigid edges but no bend constraints: the sheet keeps its area while
        // folding freely, which is what makes a hammock read as fabric rather
        // than as a trampoline skin.
        compliance: opts.compliance ?? 0,
        numIterations: 8,
        friction: 0.5,
        linearDamping: 0.25,        // corner-pinned sheets swing forever below this
        vertexRadius: 0.012,        // keeps the surface just off whatever lands on it
        restitution: 0,
        // A pinned sheet is welded to the static world, so the body transform
        // should NOT chase the vertices. This is not cosmetic: with
        // updatePosition on, the body origin drifts as the sheet sags and
        // vertices() reconstructs world positions through a moving transform,
        // which perturbs even a pinned vertex in the low bits. Off, a pinned
        // vertex reads back bit-identical forever — which is the truth.
        updatePosition: false,
    });

    return register('cloth', sb, { pinSet: set, pinned: pinIndices(set) },
                    { color: '#c94f6d', roughness: 0.95, metallic: 0.0 });
}

/**
 * Create (or recreate) the pressurized ball and drop it.
 *
 * @param {number} [pressure=2500] - Jolt's n*R*T gas coefficient. Below ~400
 *                                   the ball cannot hold its own shape; above
 *                                   ~5000 it is a drum.
 */
export function buildBall(pressure = 2500, opts = {}) {
    if (!sceneRef) throw new Error('softbody.js: initSoftBodies(scene) not called');
    destroySoft('ball');

    const geo = icosphere(BALL.radius, BALL.subdiv);
    const sb = Physics.createSoftBody({
        mesh: {
            vertices: geo.positions, indices: geo.indices,
            mass: BALL.mass, pressure,
        },
        position: opts.position || BALL.position,
        layer: 'player',
        compliance: 1e-5,           // a hair of stretch — a perfectly rigid
                                    // skin makes pressure almost unobservable
        numIterations: 8,
        friction: 0.6,
        restitution: 0.25,
        linearDamping: 0.02,
        vertexRadius: 0.01,
    });

    return register('ball', sb, { pressure },
                    { color: '#ffd166', roughness: 0.45, metallic: 0.0 });
}

/** The pressure slider: no runtime setter exists, so rebuild at the new value. */
export function setBallPressure(pressure) {
    return buildBall(pressure);
}

export function getBall() { return softBodies.get('ball'); }
export function getCloth() { return softBodies.get('cloth'); }

/** Rebuild the cloth with a different pin set, keeping everything else. */
export function setPinSet(set) {
    return buildCloth(set);
}

/**
 * Toggle one vertex's pin at runtime — the cheap path that needs no rebuild.
 * Used by the corner buttons in the HUD.
 */
export function togglePin(entry, index) {
    if (!entry) return false;
    const pinned = entry.meta.pinned;
    const at = pinned.indexOf(index);
    const on = at < 0;
    if (on) pinned.push(index); else pinned.splice(at, 1);
    entry.sb.pin(index, on);
    return on;
}

// --- Per-vertex control ------------------------------------------------------

/**
 * Kick a region of vertices with setVertexVelocity.
 *
 * The region is deliberately a HALF of the sheet rather than the whole thing:
 * the proof that per-vertex control works is that the untouched half stays
 * where it was, and you only get that contrast by leaving some of it alone.
 *
 * @returns {number[]} the vertex indices that were kicked
 */
export function gust(entry, strength = 6, opts = {}) {
    if (!entry) return [];
    const verts = entry.sb.vertices();
    const n = entry.sb.vertexCount;

    // Region: everything on the +X side of the body's own centroid.
    let cx = 0;
    for (let i = 0; i < n; i++) cx += verts[i * 3];
    cx /= n;

    const hit = [];
    const pinned = new Set(entry.meta.pinned || []);
    for (let i = 0; i < n; i++) {
        if (verts[i * 3] <= cx) continue;
        if (pinned.has(i)) continue;         // a pinned vertex has invMass 0
        entry.sb.setVertexVelocity(i, opts.vx ?? 0, opts.vy ?? strength, opts.vz ?? strength * 0.4);
        hit.push(i);
    }
    return hit;
}

/**
 * Dent a soft body inward with setVertex — a hard teleport of one region's
 * particles toward the centroid, which is what a grab or a finger poke is.
 * setVertex zeroes the vertex's velocity, so the recovery you then see is the
 * pressure and edge constraints pushing back, nothing else.
 *
 * A depth of 0 selects the cap without touching it — useful for measuring the
 * region before and after.
 *
 * @returns {number[]} the vertex indices that were moved
 */
export function poke(entry, depth = 0.35) {
    if (!entry) return [];
    const verts = entry.sb.vertices();
    const n = entry.sb.vertexCount;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += verts[i * 3]; cy += verts[i * 3 + 1]; cz += verts[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;

    // The cap facing +Y: the top of the ball, where a poke is visible from the
    // default camera rather than hidden against the floor.
    const hit = [];
    const pinned = new Set(entry.meta.pinned || []);
    for (let i = 0; i < n; i++) {
        const dy = verts[i * 3 + 1] - cy;
        if (dy < 0.35 * BALL.radius) continue;
        if (pinned.has(i)) continue;
        hit.push(i);
        if (depth === 0) continue;
        const dx = verts[i * 3] - cx, dz = verts[i * 3 + 2] - cz;
        const L = Math.hypot(dx, dy, dz) || 1;
        entry.sb.setVertex(i,
            verts[i * 3]     - (dx / L) * depth,
            verts[i * 3 + 1] - (dy / L) * depth,
            verts[i * 3 + 2] - (dz / L) * depth);
    }
    return hit;
}

/** Mean position of a set of vertex indices — the measurement helper. */
export function regionCentroid(entry, indices) {
    const v = entry.sb.vertices();
    let x = 0, y = 0, z = 0;
    for (const i of indices) { x += v[i * 3]; y += v[i * 3 + 1]; z += v[i * 3 + 2]; }
    const n = Math.max(1, indices.length);
    return { x: x / n, y: y / n, z: z / n };
}

/**
 * Mean distance of a vertex set from the body's own centroid.
 *
 * The rotation-invariant way to ask "is this region dented". A ball rolls, so
 * the height of a fixed vertex set is mostly a statement about which way the
 * ball is facing; its radius is not.
 */
export function regionRadius(entry, indices) {
    const v = entry.sb.vertices();
    const n = entry.sb.vertexCount;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += v[i * 3]; cy += v[i * 3 + 1]; cz += v[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    let s = 0;
    for (const i of indices) s += Math.hypot(v[i * 3] - cx, v[i * 3 + 1] - cy, v[i * 3 + 2] - cz);
    return s / Math.max(1, indices.length);
}

/** Mean vertex height — a soft body's honest "how high is it". */
export function meanHeight(entry) {
    const v = entry.sb.vertices();
    let s = 0;
    for (let i = 0; i < entry.sb.vertexCount; i++) s += v[i * 3 + 1];
    return s / entry.sb.vertexCount;
}

// --- Per-frame ---------------------------------------------------------------

/**
 * Stream every soft body's vertices into its mesh. This is the whole render
 * path: there is no PhysicsNode for a soft body because there is no single
 * transform to sync — the geometry itself is the state.
 */
export function updateSoftBodies() {
    for (const e of softBodies.values()) {
        e.node.updateMesh({ positions: e.sb.vertices(), indices: e.topo.indices },
                          { recomputeNormals: true });
    }
}

// --- Teardown ----------------------------------------------------------------

export function destroySoft(key) {
    const e = softBodies.get(key);
    if (!e) return false;
    if (e.node && e.node.destroy) e.node.destroy();
    e.sb.destroy();
    softBodies.delete(key);
    return true;
}

export function clearSoftBodies() {
    for (const k of [...softBodies.keys()]) destroySoft(k);
}
