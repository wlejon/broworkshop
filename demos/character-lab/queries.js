// queries.js — the sensing layer.
//
// The controller in character.js never asks the world a question: it sets a
// velocity and reads back what Jolt decided. That is the right way to move a
// character, but it means every decision happens after the fact. This file is
// the other half — the queries a game asks BEFORE it commits to a move, drawn
// in the world so you can watch them answer.
//
// Four sensors, each one a single engine call:
//
//   forward sweep   castShapeClosest of the character's own capsule along the
//                   facing direction. This is "can I walk there" asked one
//                   frame early. The ghost capsule drawn at the sweep's end is
//                   literally where the character would stop.
//   ledge probe     castShapeClosest of a small sphere, straight down, from a
//                   point AHEAD of the feet. The distance it falls before
//                   hitting something is the drop you are about to walk off.
//                   This is how an NPC knows not to stroll into the gap.
//   proximity       overlapShape of a sphere centred on the character. No
//                   sweep, no ray — just "what is touching this volume right
//                   now". Every body it returns gets a halo.
//   look ray        raycastClosest along the facing direction, run TWICE with
//                   different filters so the filters are the demo.
//
// The filters are the part worth staring at. `raycastClosest` from the
// character's own centre hits the character's own inner rigid body at
// fraction 0 — measured, not theorised — so a look ray without
// `ignoreBody: character.innerBody` is useless. Turn the checkbox off in the
// HUD and watch the ray collapse to zero length against yourself. Turn
// `ignoreBodies: world.props` on and the same ray stops caring about crates
// and reaches the ramp eleven metres behind them. Both readouts are on screen
// at once so the difference is not a claim, it is two numbers.

import { character, charState, RADIUS, STAND_HALF, CROUCH_HALF, isCrouched } from "/app/character.js";

// --- tunables ----------------------------------------------------------------
// Everything here is bound to a HUD control. The `show*` flags gate only the
// debug geometry; the queries themselves keep running so the readout stays
// live even with the visualisation off.

export const sense = {
    // which sensors run
    forwardCast: true,
    ledgeProbe: true,
    proximity: true,
    lookRay: true,
    // debug geometry
    drawVolumes: true,
    // filter demonstrations
    ignoreSelf: true,      // ignoreBody: character.innerBody
    ignoreProps: false,    // ignoreBodies: world.props
    movingOnly: true,      // layers: ['moving'] on the proximity sensor
    // geometry
    castDistance: 3.0,
    proxRadius: 3.0,
    ledgeAhead: 0.9,
    ledgeThreshold: 0.45,  // a drop deeper than this counts as a ledge
    rayLength: 30,
    // Height of the look ray relative to the capsule CENTRE. It defaults below
    // centre for a concrete reason: the crates are only 0.70 m tall, so a ray
    // fired from the capsule's middle sails clean over them and the
    // `ignoreBodies` demonstration has nothing to ignore. Dropping it to crate
    // height puts a prop in the way, which is what makes the filter visible.
    rayHeight: -0.55,
};

/** Live results. The HUD reads this; so does the smoke test. */
export const qState = {
    /** forward sweep: { bodyId, name, dist, normal } or null when clear */
    sweep: null,
    sweepClear: true,
    /** ledge probe: { drop, bodyId, name, isLedge } — drop is Infinity if
     *  nothing was found within the probe's reach at all. */
    ledge: null,
    /** overlapShape results, nearest first: [{ bodyId, name, depth, dist }] */
    prox: [],
    /** look ray with the current filters, and the same ray with none */
    ray: null,
    rayUnfiltered: null,
    /** last click-to-overlapPoint result: { bodyId, name, at } */
    pick: null,
};

// The direction the sensors look. app.js keeps this on the last commanded move
// direction (falling back to camera forward when standing still) so the probes
// point where the player is about to go, not where the camera happens to be.
let facing = { x: 0, z: -1 };

export function setFacing(x, z) {
    const len = Math.hypot(x, z);
    if (len > 1e-4) { facing.x = x / len; facing.z = z / len; }
}

export function getFacing() { return { x: facing.x, z: facing.z }; }

// --- body naming -------------------------------------------------------------
// Query results are body TAGS. A HUD full of bare integers proves nothing, so
// every tag the course created gets a human name once at startup.

const names = new Map();

export function nameBodies(world) {
    names.clear();
    world.props.forEach((tag, i) => {
        names.set(tag, i < 5 ? `crate ${i + 1}` : `barrel ${i - 4}`);
    });
    if (world.platform) names.set(world.platform.tag, 'platform');
}

/** Name a single body after startup. The crowd uses this: NPC inner bodies do
 *  not exist when nameBodies() runs, and an overlap list full of bare integers
 *  would defeat the point of the sensor readout. */
export function nameBody(tag, name) {
    if (tag != null && tag > 0) names.set(tag, name);
}

/** The character's own inner body tag, or undefined when it has none. Passing
 *  `ignoreBody: undefined` is a no-op filter, which is exactly right: with
 *  `innerBody: false` the character is not in the broadphase at all, so there
 *  is nothing to exclude. */
function selfBody() {
    return character && character.innerBody > 0 ? character.innerBody : undefined;
}

/** Human name for a body tag. Falls back to a tag literal so an unnamed body
 *  is still identifiable — that matters when the ray hits course scenery. */
export function bodyName(tag) {
    if (tag == null || tag < 0) return '—';
    if (character && tag === character.innerBody) return 'SELF (inner body)';
    return names.get(tag) || `static #${tag}`;
}

// --- geometry helpers --------------------------------------------------------

/** Quaternion rotating +Y onto the unit vector `d`. Cylinders and capsules are
 *  authored Y-up, so this is what points one along an arbitrary direction. */
function quatFromY(d) {
    const dot = d[1];                       // dot([0,1,0], d)
    if (dot > 0.999999) return [0, 0, 0, 1];
    if (dot < -0.999999) return [1, 0, 0, 0];   // 180° about X
    // axis = cross([0,1,0], d) = (d.z, 0, -d.x)
    const ax = d[2], ay = 0, az = -d[0];
    const alen = Math.hypot(ax, ay, az) || 1;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const s = Math.sin(angle / 2);
    return [ax / alen * s, ay / alen * s, az / alen * s, Math.cos(angle / 2)];
}

/** Half-height of the capsule the character is currently wearing. */
const halfNow = () => (isCrouched() ? CROUCH_HALF : STAND_HALF);

// --- debug geometry ----------------------------------------------------------
//
// Node colours cannot be changed after creation (the MeshNode `color` setter is
// a silent no-op), so anything that needs to signal hit-vs-miss is built as a
// PAIR of identical meshes in two colours and the pair is toggled. It costs a
// handful of nodes and buys an unambiguous red/green read at a glance.

const COL = {
    miss:  '#5fd39a',   // nothing in the way
    hit:   '#e0705a',   // something is
    probe: '#8fa8d8',   // neutral probe geometry
    prox:  '#7fd0e0',   // proximity shell
    halo:  '#ffd166',   // a body inside the proximity shell
    ray:   '#c89ae0',   // look ray
    pick:  '#ffffff',
};

let vis = null;

/** A line segment drawn as a very thin cylinder. Authored 1 m long about the
 *  origin so `scaleY` is the length in metres and nothing else has to change. */
function makeLine(scene, color, thickness) {
    const n = scene.createMesh({
        mesh: 'cylinder', radius: thickness, halfHeight: 0.5, segments: 8,
        color, metallic: 0, roughness: 0.4, emissive: 0.5, emissiveColor: color,
    });
    n.visible = false;
    return n;
}

function makeBall(scene, color, radius) {
    const n = scene.createMesh({
        mesh: 'sphere', radius, segments: 14, rings: 10,
        color, emissive: 0.8, emissiveColor: color, roughness: 0.3,
    });
    n.visible = false;
    return n;
}

/**
 * Build every debug node once. Called after the character exists, because the
 * ghost capsules are sized from the character's real dimensions — a swept
 * volume drawn at the wrong radius would be a lie.
 */
export function buildQueryVis(scene) {
    const ghost = (color) => {
        const n = scene.createMesh({
            mesh: 'capsule', radius: RADIUS, halfHeight: STAND_HALF,
            segments: 16, rings: 10,
            color: [...cssRgb(color), 0.32], twoSided: true,
            emissive: 0.35, emissiveColor: color, roughness: 0.5,
        });
        n.visible = false;
        return n;
    };

    vis = {
        // forward sweep
        ghostMiss: ghost(COL.miss),
        ghostHit:  ghost(COL.hit),
        sweepLineMiss: makeLine(scene, COL.miss, 0.018),
        sweepLineHit:  makeLine(scene, COL.hit, 0.018),
        sweepPoint: makeBall(scene, COL.hit, 0.07),
        sweepNormal: makeLine(scene, '#ffffff', 0.012),
        // ledge probe
        ledgeLine: makeLine(scene, COL.probe, 0.014),
        ledgeOk:   makeBall(scene, COL.miss, 0.09),
        ledgeDrop: makeBall(scene, COL.hit, 0.11),
        // proximity
        proxShell: (() => {
            // Authored at radius 1 so `scale` is the radius in metres. Two-sided
            // because the character stands inside it and would otherwise see
            // straight through the back faces.
            // Kept very faint on purpose: at a 3 m radius this shell covers
            // most of the screen, and anything heavier turns the whole course
            // into fog. It only has to read as a boundary.
            const n = scene.createMesh({
                mesh: 'sphere', radius: 1, segments: 28, rings: 18,
                color: [...cssRgb(COL.prox), 0.05], twoSided: true,
                emissive: 0.10, emissiveColor: COL.prox, roughness: 0.9,
            });
            n.visible = false;
            return n;
        })(),
        halos: Array.from({ length: 12 }, () => {
            const n = scene.createMesh({
                mesh: 'sphere', radius: 1, segments: 16, rings: 12,
                color: [...cssRgb(COL.halo), 0.30], twoSided: true,
                emissive: 0.7, emissiveColor: COL.halo, roughness: 0.4,
            });
            n.visible = false;
            return n;
        }),
        // look ray
        rayLine: makeLine(scene, COL.ray, 0.010),
        rayPoint: makeBall(scene, COL.ray, 0.09),
        // click pick
        pickPoint: makeBall(scene, COL.pick, 0.13),
    };
    return vis;
}

/** '#rrggbb' -> [r, g, b] in 0..1, so a colour can be reused with an alpha. */
function cssRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Place a line node so it spans from a to b. */
function spanLine(node, ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) { node.visible = false; return; }
    node.x = (ax + bx) / 2;
    node.y = (ay + by) / 2;
    node.z = (az + bz) / 2;
    node.quaternion = quatFromY([dx / len, dy / len, dz / len]);
    node.scaleY = len;
    node.visible = true;
}

function place(node, x, y, z) { node.x = x; node.y = y; node.z = z; node.visible = true; }

function hideAll() {
    if (!vis) return;
    for (const k of Object.keys(vis)) {
        const v = vis[k];
        if (Array.isArray(v)) { for (const n of v) n.visible = false; }
        else v.visible = false;
    }
}

// --- the queries themselves --------------------------------------------------
//
// Each of these is deliberately a plain function of the world state with no
// side effects on the scene, so the smoke test can call them directly and
// assert on a number instead of on a picture.

/**
 * Sweep the character's own capsule forward. Returns the nearest hit or null.
 *
 * `fraction` is 0..1 along direction*maxDistance, so the distance in metres is
 * fraction*maxDistance — this is the one field of the result that is easy to
 * misread, since raycast's fraction means the same thing but against maxDist.
 */
export function forwardCast(dir, distance) {
    if (!character) return null;
    const p = charState.position;
    const hit = Physics.castShapeClosest({
        shape: 'capsule', radius: RADIUS, halfHeight: halfNow(),
        position: { x: p.x, y: p.y, z: p.z },
        direction: { x: dir.x, y: 0, z: dir.z },
        maxDistance: distance,
        ignoreBody: selfBody(),
    });
    if (!hit) return null;
    return {
        bodyId: hit.bodyId,
        name: bodyName(hit.bodyId),
        dist: hit.fraction * distance,
        at: hit.position,
        normal: hit.normal,
    };
}

/**
 * Drop a small sphere straight down from a point ahead of the feet and measure
 * how far it falls. On flat ground the answer is the probe's own start height;
 * at the lip of the gap it is that plus the two metres to the floor below.
 *
 * The probe starts slightly ABOVE the feet so that a step UP ahead of the
 * character registers as a short drop rather than as an immediate hit inside
 * the riser.
 */
export function ledgeProbe(dir, ahead, threshold) {
    if (!character) return null;
    const p = charState.position;
    const foot = p.y - RADIUS - halfNow();
    const startY = foot + 0.5;
    const ox = p.x + dir.x * ahead;
    const oz = p.z + dir.z * ahead;
    const REACH = 6.0;
    const hit = Physics.castShapeClosest({
        shape: 'sphere', radius: 0.16,
        position: { x: ox, y: startY, z: oz },
        direction: { x: 0, y: -1, z: 0 },
        maxDistance: REACH,
        ignoreBody: selfBody(),
    });
    // Drop is measured from the FEET, not from the probe start, so flat ground
    // reads ~0.00 and the readout is a number the user can sanity-check.
    if (!hit) {
        return { drop: Infinity, bodyId: -1, name: 'nothing', isLedge: true,
                 from: { x: ox, y: startY, z: oz }, to: { x: ox, y: startY - REACH, z: oz } };
    }
    const drop = foot - hit.position.y;
    return {
        drop, bodyId: hit.bodyId, name: bodyName(hit.bodyId),
        isLedge: drop > threshold,
        from: { x: ox, y: startY, z: oz }, to: hit.position,
    };
}

/**
 * Everything inside a sphere centred on the character. `layers: ['moving']`
 * is the interesting half: without it the ground slab and every piece of
 * course scenery is a hit and the list is useless; with it the sensor sees
 * exactly the dynamic bodies. That is the layer filter earning its keep.
 */
export function proximity(radius, movingOnly) {
    if (!character) return [];
    const p = charState.position;
    const opts = {
        shape: 'sphere', radius,
        position: { x: p.x, y: p.y, z: p.z },
        ignoreBody: selfBody(),
    };
    if (movingOnly) opts.layers = ['moving'];
    const hits = Physics.overlapShape(opts);
    const out = [];
    for (const h of hits) {
        // The overlap result carries a contact point, but the body CENTRE is
        // what a halo wants, and the centre distance is what reads as "how
        // close is that thing".
        let cx = h.position.x, cy = h.position.y, cz = h.position.z;
        const t = h.bodyId >= 0 ? Physics.getTransform(h.bodyId) : null;
        if (t) { cx = t.position.x; cy = t.position.y; cz = t.position.z; }
        out.push({
            bodyId: h.bodyId, name: bodyName(h.bodyId), depth: h.depth,
            dist: Math.hypot(cx - p.x, cy - p.y, cz - p.z),
            at: { x: cx, y: cy, z: cz },
        });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
}

/**
 * The look ray, run with whatever filters the HUD has switched on.
 *
 * `propTags` is world.props; passing it as `ignoreBodies` is the second half of
 * the filter demo. Note the eye height: the ray starts at the capsule centre,
 * which is INSIDE the character's own inner rigid body — that is exactly why
 * `ignoreBody` is not optional in practice.
 */
export function lookRay(dir, length, opts) {
    if (!character) return null;
    const p = charState.position;
    const oy = p.y + (opts && opts.height != null ? opts.height : sense.rayHeight);
    const filt = {};
    if (opts && opts.ignoreSelf) filt.ignoreBody = selfBody();
    if (opts && opts.ignoreProps && opts.propTags) filt.ignoreBodies = opts.propTags;
    if (opts && opts.layers) filt.layers = opts.layers;
    const hit = Physics.raycastClosest(p.x, oy, p.z, dir.x, 0, dir.z, length, filt);
    if (!hit) return null;
    return {
        bodyId: hit.bodyId, name: bodyName(hit.bodyId),
        dist: hit.fraction * length, at: hit.position, normal: hit.normal,
        from: { x: p.x, y: oy, z: p.z },
    };
}

/**
 * Click-to-pick. The caller supplies a world-space ray from the cursor; the
 * ray finds the surface, then `overlapPoint` is asked what solid contains a
 * point just *inside* that surface. Two different queries agreeing is the
 * point — the ray says where, overlapPoint says what.
 */
export function pickAlongRay(ox, oy, oz, dx, dy, dz, maxDist) {
    const hit = Physics.raycastClosest(ox, oy, oz, dx, dy, dz, maxDist || 200,
                                       { ignoreBody: selfBody() });
    if (!hit) { qState.pick = null; return null; }
    // Step a hair past the surface along the ray so the point is genuinely
    // inside the solid rather than exactly on its boundary.
    const EPS = 0.02;
    const px = hit.position.x + dx * EPS;
    const py = hit.position.y + dy * EPS;
    const pz = hit.position.z + dz * EPS;
    const inside = Physics.overlapPoint(px, py, pz);
    const bodyId = inside.length ? inside[0].bodyId : hit.bodyId;
    qState.pick = {
        bodyId, name: bodyName(bodyId),
        at: { x: hit.position.x, y: hit.position.y, z: hit.position.z },
        viaOverlap: inside.length > 0,
    };
    return qState.pick;
}

// --- per-frame driver --------------------------------------------------------

/**
 * Run every enabled sensor and move the debug geometry onto its result.
 * Called once per frame from app.js, after tickCharacter so the queries see
 * the position the controller just settled on.
 */
export function tickQueries(world) {
    if (!character) return qState;
    const p = charState.position;
    const dir = facing;

    // --- forward sweep ------------------------------------------------------
    qState.sweep = sense.forwardCast ? forwardCast(dir, sense.castDistance) : null;
    qState.sweepClear = !qState.sweep;

    // --- ledge probe --------------------------------------------------------
    qState.ledge = sense.ledgeProbe
        ? ledgeProbe(dir, sense.ledgeAhead, sense.ledgeThreshold) : null;

    // --- proximity ----------------------------------------------------------
    qState.prox = sense.proximity ? proximity(sense.proxRadius, sense.movingOnly) : [];

    // --- look ray, both ways ------------------------------------------------
    // The unfiltered ray is run unconditionally whenever the look ray is on:
    // it is the control in the experiment, and it is what makes the filtered
    // result mean something.
    if (sense.lookRay) {
        qState.ray = lookRay(dir, sense.rayLength, {
            ignoreSelf: sense.ignoreSelf,
            ignoreProps: sense.ignoreProps,
            propTags: world.props,
        });
        qState.rayUnfiltered = lookRay(dir, sense.rayLength, {});
    } else {
        qState.ray = null;
        qState.rayUnfiltered = null;
    }

    if (vis) drawQueries(p, dir);
    return qState;
}

function drawQueries(p, dir) {
    hideAll();
    if (!sense.drawVolumes) return;

    // --- forward sweep: a line down the sweep axis and a ghost capsule where
    // the character would come to rest. Green when the path is clear, red when
    // it is not, plus a dot on the contact point and a white normal stub.
    if (sense.forwardCast) {
        const s = qState.sweep;
        const d = s ? s.dist : sense.castDistance;
        const ex = p.x + dir.x * d, ez = p.z + dir.z * d;
        spanLine(s ? vis.sweepLineHit : vis.sweepLineMiss, p.x, p.y, p.z, ex, p.y, ez);
        const ghost = s ? vis.ghostHit : vis.ghostMiss;
        place(ghost, ex, p.y, ez);
        // The ghost is authored at standing height; squash it when crouched so
        // the drawn volume is the volume that was actually swept.
        ghost.scaleY = isCrouched()
            ? (CROUCH_HALF + RADIUS) / (STAND_HALF + RADIUS) : 1;
        if (s) {
            place(vis.sweepPoint, s.at.x, s.at.y, s.at.z);
            spanLine(vis.sweepNormal, s.at.x, s.at.y, s.at.z,
                     s.at.x + s.normal.x * 0.6, s.at.y + s.normal.y * 0.6,
                     s.at.z + s.normal.z * 0.6);
        }
    }

    // --- ledge probe: the probe's fall line, with a marker at the bottom that
    // turns red once the drop crosses the threshold.
    if (sense.ledgeProbe && qState.ledge) {
        const l = qState.ledge;
        spanLine(vis.ledgeLine, l.from.x, l.from.y, l.from.z, l.to.x, l.to.y, l.to.z);
        place(l.isLedge ? vis.ledgeDrop : vis.ledgeOk, l.to.x, l.to.y, l.to.z);
    }

    // --- proximity: the shell, plus a halo on every body inside it.
    if (sense.proximity) {
        place(vis.proxShell, p.x, p.y, p.z);
        vis.proxShell.scaleX = sense.proxRadius;
        vis.proxShell.scaleY = sense.proxRadius;
        vis.proxShell.scaleZ = sense.proxRadius;
        const n = Math.min(qState.prox.length, vis.halos.length);
        for (let i = 0; i < n; ++i) {
            const h = vis.halos[i], o = qState.prox[i];
            place(h, o.at.x, o.at.y, o.at.z);
            h.scaleX = 0.62; h.scaleY = 0.62; h.scaleZ = 0.62;
        }
    }

    // --- look ray: the FILTERED ray is the one drawn, so toggling a filter
    // visibly re-aims it. With ignoreSelf off it collapses to nothing, which is
    // the whole lesson.
    if (sense.lookRay) {
        const r = qState.ray;
        const d = r ? r.dist : sense.rayLength;
        const oy = p.y + sense.rayHeight;
        if (d > 0.05) {
            spanLine(vis.rayLine, p.x, oy, p.z,
                     p.x + dir.x * d, oy, p.z + dir.z * d);
        }
        if (r) place(vis.rayPoint, r.at.x, r.at.y, r.at.z);
    }

    if (qState.pick) place(vis.pickPoint, qState.pick.at.x, qState.pick.at.y, qState.pick.at.z);
}
