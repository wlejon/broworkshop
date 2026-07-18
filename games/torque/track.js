// track.js — the circuit.
//
// The whole track is generated from one closed parametric centerline rather
// than hand-placed pieces, because everything downstream needs to agree about
// where the road IS: the collision ribbon, the render mesh, the barriers, the
// kerbs, the respawn point, the trackside camera and the lap counter all read
// the same sample array. Hand-placed geometry drifts; a shared centerline
// cannot.
//
//   r(t) = R0 + R1·cos(2t) + R2·cos(3t)     radius modulation → varied corners
//   y(t) = H1·(1-cos 2t) + H2·(1-cos 3t)    crests and dips, level at the line
//
// Banking is DERIVED from the sampled curvature (the road leans into whatever
// the curve happens to do) and then masked to zero across one corner, so the
// circuit has both a banked corner you can carry speed through and a flat one
// that punishes it. Nothing about the bank is authored per-corner.
//
// Surfaces are separate static bodies because Jolt friction is per body: the
// tarmac ribbon, the ice patch and the runoff strips are three different
// materials, and the vehicle's tire friction curves multiply against whatever
// body its wheels are standing on. That is the entire mechanism behind the
// low-grip patch — no special-casing in the car.

const TAU = Math.PI * 2;

// --- Shape parameters --------------------------------------------------------

export const N = 360;                     // centerline samples (≈1.6 m apart)
export const HALF_WIDTH = 7.0;            // tarmac half-width
export const RUNOFF = 4.0;                // gravel shoulder beyond the tarmac
export const BARRIER_LAT = HALF_WIDTH + RUNOFF + 0.8;

const R0 = 90, R1 = 22, R2 = 12;          // radius modulation
// Elevation. Written as (1 - cos) rather than sin so the gradient is ZERO at
// t = 0 — the start/finish line has to be level, or the car rolls off the line
// on its own and every stationary reading is taken on a slope.
const H1 = 3.2, H2 = 2.2;

const BANK_GAIN = 39.0;                   // per-sample turn → bank radians
                                          // (scales with N: turn is a per-sample delta)
const MAX_BANK = 0.22;                    // ≈12.6°

// Landmark positions are FRACTIONS of the loop, not sample indices, so the
// sample count can be changed for surface smoothness without silently moving
// the flat corner and the ice patch somewhere else.
const frac = (f) => Math.round(f * N);

// The one corner deliberately left flat. Its bank is faded out over a few
// samples at each end so the road surface stays continuous — a hard step in
// the bank would put a ridge across the track that launches the car.
const FLAT_FROM = frac(0.29), FLAT_TO = frac(0.45), FLAT_FADE = frac(0.033);

// The start/finish straight is flat too, and for a harder reason than taste:
// a car parked on a banked road slides sideways down the camber the moment
// you let the brakes off, so a banked grid means the car never actually sits
// still and no two runs from the line ever start the same.
const LINE_FLAT = frac(0.05), LINE_FADE = frac(0.033);

// The low-grip patch. Chunk 2 tunes per-wheel friction against this; even
// without that it is the most interesting 50 m on the circuit.
export const ICE_START = frac(0.55), ICE_LEN = frac(0.09);
const ICE_END = ICE_START + ICE_LEN;

// Surface friction. The vehicle's own longitudinal/lateral friction scalars
// multiply into these, so the ratio is what matters, not the absolute value.
export const SURFACES = {
    tarmac: { friction: 1.05, color: '#212429', roughness: 0.92, metallic: 0.0 },
    ice:    { friction: 0.06, color: '#a9d9ef', roughness: 0.12, metallic: 0.0 },
    runoff: { friction: 0.62, color: '#3f4a2c', roughness: 0.98, metallic: 0.0 },
};

// --- Centerline --------------------------------------------------------------

function centerAt(t) {
    const r = R0 + R1 * Math.cos(2 * t) + R2 * Math.cos(3 * t);
    return {
        x: r * Math.cos(t),
        y: H1 * (1 - Math.cos(2 * t)) + H2 * (1 - Math.cos(3 * t)),
        z: r * Math.sin(t),
    };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (v) => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
};

// smoothstep, used only to fade the bank mask in and out
const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

// One pass over the loop producing everything every consumer needs. `right`
// is the horizontal right-hand normal; `basis` is that same vector rolled by
// the bank angle, which is what lateral offsets are measured along.
function buildSamples() {
    const P = [];
    for (let i = 0; i < N; i++) P.push(centerAt((i / N) * TAU));

    const out = [];
    for (let i = 0; i < N; i++) {
        const prev = P[(i - 1 + N) % N], next = P[(i + 1) % N];
        const tangent = norm(sub(next, prev));
        // right = cross(tangent, up) with up = +Y, flattened to horizontal
        const right = norm({ x: -tangent.z, y: 0, z: tangent.x });
        out.push({ position: P[i], tangent, right, bank: 0, turn: 0 });
    }

    // Curvature: how fast the tangent swings toward the right vector. Negative
    // means a left-hander, which wants the right-hand edge raised.
    for (let i = 0; i < N; i++) {
        const s = out[i], nx = out[(i + 1) % N];
        s.turn = (nx.tangent.x - s.tangent.x) * s.right.x
               + (nx.tangent.z - s.tangent.z) * s.right.z;
    }

    for (let i = 0; i < N; i++) {
        const s = out[i];
        let bank = Math.max(-MAX_BANK, Math.min(MAX_BANK, -s.turn * BANK_GAIN));
        // Fade the bank away across the deliberately flat corner.
        if (i >= FLAT_FROM - FLAT_FADE && i <= FLAT_TO + FLAT_FADE) {
            const inMask = Math.min(smooth(FLAT_FROM - FLAT_FADE, FLAT_FROM, i),
                                    smooth(FLAT_TO + FLAT_FADE, FLAT_TO, i));
            bank *= 1 - inMask;
        }
        // Flatten around the line, measured as wrap-around distance from 0.
        const dLine = Math.min(i, N - i);
        bank *= smooth(LINE_FLAT, LINE_FLAT + LINE_FADE, dLine);
        s.bank = bank;
        const cb = Math.cos(bank), sb = Math.sin(bank);
        s.basis = { x: s.right.x * cb, y: sb, z: s.right.z * cb };
    }
    return out;
}

export const samples = buildSamples();

/** Surface point at sample `i`, `lat` metres right of the centerline. */
export function edge(i, lat) {
    const s = samples[((i % N) + N) % N];
    return {
        x: s.position.x + lat * s.basis.x,
        y: s.position.y + lat * s.basis.y,
        z: s.position.z + lat * s.basis.z,
    };
}

/** Sample record at `i` (wraps). */
export function sampleAt(i) { return samples[((i % N) + N) % N]; }

/** Yaw (radians about +Y) that aligns local +Z with the tangent at `i`. */
export function yawAt(i) {
    const t = sampleAt(i).tangent;
    return Math.atan2(t.x, t.z);
}

/** Quaternion for a yaw about +Y. */
export function quatYaw(yaw) {
    return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Nearest centerline sample index to a world XZ position (lap progress). */
export function nearestIndex(x, z) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < N; i++) {
        const p = samples[i].position;
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

// --- Ribbon meshing ----------------------------------------------------------
//
// Winding is (lat0, lat1, lat0+1) / (lat1, lat1+1, lat0+1) with lat0 < lat1,
// which gives a +Y face normal. Jolt mesh shapes are one-sided, so getting
// this backwards produces a road you fall straight through — it is checked by
// the smoke test driving on it, not by inspection.

function indexSpan(from, count) {
    const out = [];
    for (let k = 0; k <= count; k++) out.push((from + k) % N);
    return out;
}

function ribbon(idxs, lat0, lat1) {
    const pos = new Float32Array(idxs.length * 6);
    for (let k = 0; k < idxs.length; k++) {
        const a = edge(idxs[k], lat0), b = edge(idxs[k], lat1);
        pos.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6);
    }
    const tri = new Uint32Array((idxs.length - 1) * 6);
    for (let k = 0; k + 1 < idxs.length; k++) {
        const l0 = k * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
        tri.set([l0, r0, l1, r0, r1, l1], k * 6);
    }
    return { positions: pos, indices: tri };
}

// --- Construction ------------------------------------------------------------

/**
 * Build the circuit into `scene` and the default physics world.
 * @returns {Object} track handle — surfaces, spawn pose, scenery, lookups
 */
export function buildTrack(scene) {
    const bodies = [];
    const surfaceBodies = {};   // key → body tag, for material lookup by wheel

    // A surface = one static mesh collider plus the matching render mesh, built
    // from identical vertex data so they can never disagree.
    function surface(key, idxs, lat0, lat1, mat, yLift) {
        const geo = ribbon(idxs, lat0, lat1);
        const tag = Physics.createBody({
            shape: 'mesh', static: true,
            positions: geo.positions, indices: geo.indices,
            friction: mat.friction, restitution: 0.02,
        });
        bodies.push(tag);
        // The visual sits a hair above the collider so coplanar z-fighting
        // between adjacent strips never shows.
        const vis = new Float32Array(geo.positions);
        if (yLift) for (let i = 1; i < vis.length; i += 3) vis[i] += yLift;
        scene.createMesh({
            name: `surface_${key}`,
            positions: vis, indices: geo.indices, recomputeNormals: true,
            color: mat.color, roughness: mat.roughness, metallic: mat.metallic,
        });
        return tag;
    }

    const loop = indexSpan(0, N);

    surfaceBodies.tarmac = surface('tarmac', indexSpan(ICE_END, N - ICE_LEN),
                                   -HALF_WIDTH, HALF_WIDTH, SURFACES.tarmac, 0.01);
    surfaceBodies.ice = surface('ice', indexSpan(ICE_START, ICE_LEN),
                                -HALF_WIDTH, HALF_WIDTH, SURFACES.ice, 0.01);
    surfaceBodies.runoffL = surface('runoffL', loop,
                                    -HALF_WIDTH - RUNOFF, -HALF_WIDTH, SURFACES.runoff, 0.0);
    surfaceBodies.runoffR = surface('runoffR', loop,
                                    HALF_WIDTH, HALF_WIDTH + RUNOFF, SURFACES.runoff, 0.0);

    // --- Barriers ------------------------------------------------------------
    // Solid armco either side, as yawed boxes rather than a mesh wall: a mesh
    // wall would be one-sided and let the car through from the outside, and a
    // box is also what a barrier feels like to hit.
    const barriers = [];
    const BARRIER_STEP = 5;
    for (let i = 0; i < N; i += BARRIER_STEP) {
        for (const side of [-1, 1]) {
            const a = edge(i, side * BARRIER_LAT);
            const b = edge(i + BARRIER_STEP, side * BARRIER_LAT);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 0.55, z: (a.z + b.z) / 2 };
            const halfD = Math.hypot(b.x - a.x, b.z - a.z) / 2 + 0.15;
            const yaw = Math.atan2(b.x - a.x, b.z - a.z);
            const tag = Physics.createBody({
                shape: 'box', static: true, position: mid,
                rotation: quatYaw(yaw),
                halfExtents: { x: 0.22, y: 0.75, z: halfD },
                friction: 0.35, restitution: 0.25,
            });
            bodies.push(tag);
            barriers.push(tag);
            scene.createMesh({
                mesh: 'box', halfW: 0.22, halfH: 0.75, halfD,
                x: mid.x, y: mid.y, z: mid.z, ry: yaw * 180 / Math.PI,
                color: side < 0 ? '#9aa3ad' : '#8d949d', metallic: 0.55, roughness: 0.45,
            });
        }
    }

    // --- Kerbs ---------------------------------------------------------------
    // Only where the road actually turns: a kerb on a straight is decoration,
    // a kerb on the apex is a decision. Red/white alternation makes rotation
    // rate readable from the cockpit.
    //
    // Deliberately shallow and slippery. A square 8 cm kerb at tarmac friction
    // is a trip hazard: a car running wide catches a wheel on it and rolls
    // onto its side instead of sliding, which reads as a physics bug rather
    // than as a mistake the driver made. 4 cm proud at mu 0.55 unsettles the
    // car without flipping it.
    const kerbs = [];
    for (let i = 0; i < N; i += 3) {
        if (Math.abs(sampleAt(i).turn) < 0.008) continue;
        for (const side of [-1, 1]) {
            const p = edge(i, side * (HALF_WIDTH + 0.45));
            const tag = Physics.createBody({
                shape: 'box', static: true,
                position: { x: p.x, y: p.y - 0.02, z: p.z },
                rotation: quatYaw(yawAt(i)),
                halfExtents: { x: 0.5, y: 0.06, z: 1.3 },
                friction: 0.55, restitution: 0.02,
            });
            bodies.push(tag);
            kerbs.push(tag);
            scene.createMesh({
                mesh: 'box', halfW: 0.5, halfH: 0.06, halfD: 1.3,
                x: p.x, y: p.y - 0.01, z: p.z, ry: yawAt(i) * 180 / Math.PI,
                color: (i / 3) % 2 < 1 ? '#d8dde3' : '#c3352f', roughness: 0.8,
            });
        }
    }

    // --- Scenery -------------------------------------------------------------
    // Posts exist purely so speed is legible. A car at 40 m/s on an empty
    // plane looks parked; the same car past a post every 15 m does not.
    const posts = [];
    for (let i = 0; i < N; i += 9) {
        for (const side of [-1, 1]) {
            const p = edge(i, side * (BARRIER_LAT + 2.4));
            posts.push(scene.createMesh({
                mesh: 'box', halfW: 0.12, halfH: 1.5, halfD: 0.12,
                x: p.x, y: p.y + 1.5, z: p.z,
                color: (i / 9) % 2 ? '#e8ecf1' : '#c3352f', roughness: 0.7,
            }));
        }
    }

    // Tyre stacks in the gravel at a few outside-of-corner spots — a hazard
    // with mass to it if you run wide, and a landmark when you do not.
    const tyres = [];
    for (const i of [0.10, 0.22, 0.40, 0.62, 0.80, 0.90].map(frac)) {
        const p = edge(i, (sampleAt(i).turn > 0 ? -1 : 1) * (HALF_WIDTH + RUNOFF - 1.2));
        for (let k = 0; k < 3; k++) {
            const y = p.y + 0.3 + k * 0.55;
            const tag = Physics.createBody({
                shape: 'cylinder', static: true, radius: 0.9, halfHeight: 0.28,
                position: { x: p.x, y, z: p.z }, friction: 0.9, restitution: 0.4,
            });
            bodies.push(tag);
            tyres.push(tag);
            scene.createMesh({
                mesh: 'cylinder', radius: 0.9, halfHeight: 0.28, segments: 18,
                x: p.x, y, z: p.z, color: '#1b1d20', roughness: 0.95,
            });
        }
    }

    // --- Start/finish --------------------------------------------------------
    const sfPos = edge(0, 0);
    scene.createMesh({
        mesh: 'box', halfW: HALF_WIDTH, halfH: 0.03, halfD: 0.5,
        x: sfPos.x, y: sfPos.y + 0.03, z: sfPos.z, ry: yawAt(0) * 180 / Math.PI,
        color: '#eef2f6', roughness: 0.8, emissive: 0.15,
    });

    // --- Catch floor ---------------------------------------------------------
    // The track is a ribbon in the air; without this, anything that leaves it
    // falls forever and the physics world quietly accumulates escapees.
    const floorTag = Physics.createBody({
        shape: 'box', static: true, position: { x: 0, y: -42, z: 0 },
        halfExtents: { x: 400, y: 1, z: 400 }, friction: 0.9,
    });
    bodies.push(floorTag);
    scene.createMesh({
        mesh: 'box', halfW: 400, halfH: 1, halfD: 400,
        x: 0, y: -42, z: 0, color: '#161a1f', roughness: 1.0,
    });

    // --- Spawn pose ----------------------------------------------------------
    const sp = edge(0, 0);
    const spawn = {
        position: { x: sp.x, y: sp.y + 1.4, z: sp.z },
        rotation: quatYaw(yawAt(0)),
    };

    return {
        bodies, barriers, kerbs, posts, tyres, surfaceBodies, spawn,
        samples, N, HALF_WIDTH, RUNOFF,
        iceRange: [ICE_START, ICE_END],
        floorY: -42,
        edge, sampleAt, yawAt, quatYaw, nearestIndex,
        /** true if `bodyTag` is the low-grip patch (used by the HUD readout) */
        isIce: (bodyTag) => bodyTag === surfaceBodies.ice,
        surfaceName(bodyTag) {
            for (const k in surfaceBodies) if (surfaceBodies[k] === bodyTag) {
                return k.startsWith('runoff') ? 'gravel' : k;
            }
            return bodyTag === -1 ? 'air' : 'other';
        },
    };
}
