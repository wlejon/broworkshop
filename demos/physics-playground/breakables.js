// breakables.js — a structure held together by constraints that can snap.
//
// `breakingImpulse` is the least visible feature in bro's physics surface and
// the most immediately useful. Every constraint carries a threshold in N·s;
// when the impulse the solver had to apply to keep that joint closed exceeds it
// in a single step, Jolt disables the constraint and the engine reports its
// handle from Physics.getBrokenConstraints(). That is a whole destruction
// system for one number per joint.
//
// The demo is a suspension bridge because a bridge fails LEGIBLY. Twelve planks
// chained end to end, both ends anchored to static towers, plus a hanger
// constraint from a cable line down to every plank. Drop a wrecking ball on the
// middle and the failure propagates: the hanger over the impact goes first, its
// load transfers to its neighbours, and the deck unzips outward. Set the
// threshold high and the identical impact does nothing at all.
//
// Two details worth knowing before reading the code:
//
//   * A broken constraint is DISABLED, not destroyed. Its handle stays valid,
//     getConstraintBreakingImpulse still reads back, and setConstraintEnabled
//     can revive it. `rebuild()` below destroys and recreates anyway, because a
//     revived joint would snap the deck back to its build pose through whatever
//     debris is now lying on it.
//   * getBrokenConstraints() DRAINS. Call it once per frame and keep what you
//     get, or the count is whatever happened since something else last asked.
//     app.js's frame loop owns the single call; everything here reads the
//     tally it accumulates.

export const BRIDGE = {
    z: 18,                  // its own bay, mirroring the machine yard at z=-18
    y: 5.0,                 // deck height
    span: 20,               // tower to tower, metres
    planks: 12,
    plankMass: 40,
};

let scene = null;
// The floor and backdrop outlive every rebuild — they are the yard, not the
// structure — so they are built once and skipped on subsequent buildBridge()es.
let yardBuilt = false;
export function initBreakables(sc) { scene = sc; }

/**
 * Live bridge state.
 *   joints  [{ handle, kind, index }]  every constraint in the structure
 *   broken  Set of handles known to have snapped
 */
export const bridge = {
    built: false,
    threshold: 900,
    planks: [],
    towers: [],
    joints: [],
    broken: new Set(),
    log: [],            // [{ handle, kind, index, t }] newest last, capped
};

const DECK_HALF_Z = 1.6;

/**
 * Build (or rebuild) the bridge. Every constraint is created with the current
 * `bridge.threshold`, so the slider's value at build time is the structure's
 * strength — and setThreshold() below pushes changes to the live joints too.
 */
export function buildBridge() {
    destroyBridge();

    const { z, y, span, planks, plankMass } = BRIDGE;

    // The breakyard floor. Not decoration: without it a snapped plank falls out
    // of the world forever and the collapse has no bottom, which reads as a bug
    // rather than as a bridge failing. The back wall doubles as a clean backdrop
    // for the bridge camera view — otherwise the whole sandbox is visible
    // through the wreckage.
    if (!yardBuilt) {
        Physics.createBody({
            shape: 'box', halfExtents: { x: 20, y: 0.5, z: 8 },
            position: { x: 0, y: -0.5, z }, static: true, layer: 'static',
            friction: 0.9, restitution: 0.05,
        });
        scene.createMesh({
            mesh: 'box', halfW: 20, halfH: 0.5, halfD: 8,
            x: 0, y: -0.5, z, color: '#2c3036', roughness: 0.95,
        });
        scene.createMesh({
            mesh: 'box', halfW: 20, halfH: 7, halfD: 0.3,
            x: 0, y: 7, z: z + 8, color: '#1a1d22', roughness: 1.0,
        });
        yardBuilt = true;
    }
    const plankLen = span / planks;
    const half = plankLen / 2 - 0.03;      // a hair of clearance between planks
    const x0 = -span / 2;

    // --- Towers: static, and the deck's two end anchors ---------------------
    for (const sx of [-1, 1]) {
        const tx = sx * (span / 2 + 0.5);
        const tag = Physics.createBody({
            shape: 'box', halfExtents: { x: 0.5, y: y / 2 + 1.2, z: DECK_HALF_Z },
            position: { x: tx, y: (y / 2 + 1.2) - 0.5, z },
            static: true, layer: 'static', friction: 0.9,
        });
        const mesh = scene.createMesh({
            mesh: 'box', halfW: 0.5, halfH: y / 2 + 1.2, halfD: DECK_HALF_Z,
            x: tx, y: (y / 2 + 1.2) - 0.5, z, color: '#4a4e56', roughness: 0.9,
        });
        bridge.towers.push({ tag, mesh, x: tx });
    }

    // --- Deck ---------------------------------------------------------------
    for (let i = 0; i < planks; i++) {
        const cx = x0 + plankLen * (i + 0.5);
        const tag = Physics.createBody({
            shape: 'box', halfExtents: { x: half, y: 0.12, z: DECK_HALF_Z },
            position: { x: cx, y, z },
            mass: plankMass, layer: 'player', friction: 1.0, restitution: 0.02,
        });
        const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
        node.add(scene.createMesh({
            mesh: 'box', halfW: half, halfH: 0.12, halfD: DECK_HALF_Z,
            color: i % 2 ? '#8d7b68' : '#7a6a58', roughness: 0.9,
        }));
        bridge.planks.push({ tag, node, x: cx, index: i });
    }

    // --- Deck joints: plank -> plank, and the two end anchors ----------------
    //
    // A hinge, not a fixed joint: a bridge deck is supposed to articulate, and
    // a chain of fixed joints is a single rigid beam that either survives or
    // explodes all at once. Hinges give the deck the sag that makes the
    // failure look like a failure.
    const link = (b1, b2, px, kind, index) => {
        const h = Physics.createConstraint({
            type: 'hinge', body1: b1, body2: b2,
            point1: { x: px, y, z }, point2: { x: px, y, z },
            axis: { x: 0, y: 0, z: 1 },
            breakingImpulse: bridge.threshold,
        });
        bridge.joints.push({ handle: h, kind, index });
        return h;
    };

    link(bridge.towers[0].tag, bridge.planks[0].tag, x0, 'anchor', 0);
    for (let i = 0; i < planks - 1; i++) {
        link(bridge.planks[i].tag, bridge.planks[i + 1].tag, x0 + plankLen * (i + 1), 'deck', i);
    }
    link(bridge.planks[planks - 1].tag, bridge.towers[1].tag, x0 + span, 'anchor', planks - 1);

    // --- Hangers: a static cable line down to every other plank -------------
    //
    // These are what actually hold the deck up, and they are the joints that
    // break first. Distance constraints, so a hanger can only pull — exactly
    // like a real cable, and exactly the load path a wrecking ball attacks.
    const cableY = y + 4.0;
    const cableTag = Physics.createBody({
        shape: 'box', halfExtents: { x: span / 2, y: 0.09, z: 0.09 },
        position: { x: 0, y: cableY, z }, static: true, layer: 'static',
    });
    scene.createMesh({
        mesh: 'box', halfW: span / 2, halfH: 0.09, halfD: 0.09,
        x: 0, y: cableY, z, color: '#3b4048', roughness: 0.8,
    });
    bridge.towers.push({ tag: cableTag, mesh: null, x: 0 });

    for (let i = 0; i < planks; i += 2) {
        const p = bridge.planks[i];
        const h = Physics.createConstraint({
            type: 'distance', body1: cableTag, body2: p.tag,
            point1: { x: p.x, y: cableY, z }, point2: { x: p.x, y, z },
            minDistance: 0, maxDistance: cableY - y,
            breakingImpulse: bridge.threshold,
        });
        bridge.joints.push({ handle: h, kind: 'hanger', index: i });
        p.hangerRod = makeHangerRod(p.x, cableY, y, z);
        p.hanger = h;
    }

    bridge.built = true;
    bridge.broken.clear();
    bridge.log.length = 0;
    return bridge;
}

/** A thin vertical rod standing in for a hanger cable. Hidden when it snaps. */
function makeHangerRod(x, top, bottom, z) {
    const mesh = scene.createMesh({
        mesh: 'cylinder', radius: 0.03, halfHeight: (top - bottom) / 2, segments: 6,
        x, y: (top + bottom) / 2, z, color: '#2a2f36', roughness: 0.8,
    });
    return mesh;
}

export function destroyBridge() {
    for (const j of bridge.joints) Physics.destroyConstraint(j.handle);
    for (const p of bridge.planks) {
        if (p.hangerRod) p.hangerRod.destroy();
        if (p.node) p.node.destroy();
        Physics.destroyBody(p.tag);
    }
    for (const t of bridge.towers) {
        if (t.mesh) t.mesh.destroy();
        Physics.destroyBody(t.tag);
    }
    bridge.joints = []; bridge.planks = []; bridge.towers = [];
    bridge.broken.clear(); bridge.log.length = 0;
    bridge.built = false;
    return true;
}

/**
 * Push a new breaking threshold at every live joint.
 *
 * This is the slider the demo exists for: at 30 000 N·s the bridge shrugs off a
 * one-tonne ball, at 200 it collapses under its own deck. Already-broken joints
 * are skipped — a disabled constraint would not un-break, and writing to it
 * would only make the readout lie.
 */
export function setThreshold(n) {
    bridge.threshold = n;
    for (const j of bridge.joints) {
        if (bridge.broken.has(j.handle)) continue;
        Physics.setConstraintBreakingImpulse(j.handle, n);
    }
    return true;
}

/**
 * Fold this frame's broken handles into the bridge's tally.
 *
 * The caller owns the getBrokenConstraints() drain (app.js's frame loop) and
 * hands the array here, because the drain is global: contacts.js and any future
 * consumer would each get a partial view if they all called it themselves.
 */
export function noteBroken(handles) {
    let n = 0;
    for (const h of handles) {
        const j = bridge.joints.find(o => o.handle === h);
        if (!j || bridge.broken.has(h)) continue;
        bridge.broken.add(h);
        bridge.log.push({ handle: h, kind: j.kind, index: j.index });
        if (bridge.log.length > 40) bridge.log.shift();
        // A snapped hanger loses its cable.
        if (j.kind === 'hanger') {
            const p = bridge.planks[j.index];
            if (p && p.hangerRod) p.hangerRod.visible = false;
        }
        n++;
    }
    return n;
}

export const brokenCount = () => bridge.broken.size;
export const jointCount = () => bridge.joints.length;

/**
 * Wrecking ball: a heavy sphere dropped on the deck.
 *
 * Offset a metre off the bridge's centre line on purpose. The hanger cable is a
 * static beam running the full span directly above the deck, and a ball dropped
 * on the centre line lands on the CABLE and sits there — a silent no-op that
 * looks exactly like "breakingImpulse does not work". The deck is 3.2 m wide
 * and the cable is 0.18 m wide, so a metre to the side clears the beam and
 * still lands square on the planks.
 */
export function dropWreckingBall(mass = 900, height = 12) {
    const tag = Physics.createBody({
        shape: 'sphere', radius: 0.9,
        position: { x: 0, y: BRIDGE.y + height, z: BRIDGE.z + 1.0 },
        mass, layer: 'player', friction: 0.6, restitution: 0.05,
    });
    const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
    node.add(scene.createMesh({ mesh: 'sphere', radius: 0.9, segments: 22, rings: 16,
        color: '#31363d', roughness: 0.35, metallic: 0.9 }));
    const e = { tag, node };
    rubble.set(tag, e);
    return e;
}

/**
 * Fire a projectile along the deck at speed. A different failure mode from the
 * ball: it loads the deck joints in shear rather than the hangers in tension,
 * so the same threshold gives a different break pattern.
 */
export function fireProjectile(speed = 60, mass = 120) {
    const tag = Physics.createBody({
        shape: 'sphere', radius: 0.45,
        position: { x: -BRIDGE.span / 2 - 6, y: BRIDGE.y + 0.6, z: BRIDGE.z },
        mass, layer: 'player', friction: 0.4, restitution: 0.2,
    });
    Physics.setLinearVelocity(tag, speed, 0, 0);
    const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
    node.add(scene.createMesh({ mesh: 'sphere', radius: 0.45, segments: 18, rings: 14,
        color: '#ffd166', emissive: 2.2, emissiveColor: '#ffd166', roughness: 0.4 }));
    const e = { tag, node };
    rubble.set(tag, e);
    return e;
}

/** Balls and shells fired at the bridge — swept by clear all and by rebuild. */
export const rubble = new Map();

export function clearRubble() {
    for (const e of rubble.values()) {
        if (e.node && e.node.destroy) e.node.destroy();
        Physics.destroyBody(e.tag);
    }
    rubble.clear();
    return true;
}

/** Put the bridge back exactly as it was, and take the wreckage with it. */
export function rebuildBridge() {
    clearRubble();
    return buildBridge();
}
