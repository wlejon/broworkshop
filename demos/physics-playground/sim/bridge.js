// sim/bridge.js — a suspension bridge held together by constraints that snap.
//
// Every constraint carries a `breakingImpulse` in N·s; when the impulse the
// solver needed to hold a joint closed exceeds it in one step, Jolt disables
// the constraint and Physics.getBrokenConstraints() reports its handle. A
// whole destruction system for one number per joint.
//
// A bridge fails LEGIBLY: twelve planks hinged end to end between two towers,
// hung from a cable beam by distance constraints on every other plank. Drop a
// wrecking ball and the hanger over the impact goes first, its load moves to
// its neighbours, and the deck unzips. Set the threshold high and the same
// impact does nothing.
//
// A broken constraint is DISABLED, not destroyed (setConstraintEnabled could
// revive it), but rebuild() recreates anyway: a revived joint would snap the
// deck back to its build pose through the debris lying on it.

import { addStatic, addBody, BodyGroup, removeBody } from "/lib/kit/physics3d.js";
import { ctx, scene } from "./ctx.js";

export const BRIDGE = { z: 18, y: 5.0, span: 20, planks: 12, plankMass: 40 };
const DECK_HALF_Z = 1.6;

/**
 * Live state. joints: [{ handle, kind, index }]; broken: handles known to
 * have snapped; log: newest last, capped.
 */
export const bridge = {
    built: false, threshold: 900,
    planks: [], towers: [], joints: [], broken: new Set(), log: [],
};

/** Balls and shells fired at the bridge: swept by clear all and by rebuild. */
export const rubble = new BodyGroup(scene);

let yardBuilt = false;

// The breakyard floor and backdrop outlive every rebuild. Without a floor a
// snapped plank falls forever and the collapse reads as a bug.
function buildYard() {
    const { z } = BRIDGE;
    addStatic(ctx.scene, { shape: 'box', halfExtents: { x: 20, y: 0.5, z: 8 }, position: { x: 0, y: -0.5, z },
        layer: 'static', friction: 0.9, restitution: 0.05 }, { color: '#2c3036', roughness: 0.95 });
    ctx.scene.createMesh({ mesh: 'box', halfW: 20, halfH: 7, halfD: 0.3, x: 0, y: 7, z: z + 8, color: '#1a1d22', roughness: 1.0 });
    yardBuilt = true;
}

/** Build (or rebuild) the bridge; every joint gets the current threshold. */
export function buildBridge() {
    destroyBridge();
    if (!yardBuilt) buildYard();
    const { z, y, span, planks, plankMass } = BRIDGE;
    const plankLen = span / planks;
    const half = plankLen / 2 - 0.03;          // a hair of clearance between planks
    const x0 = -span / 2;
    const sc = ctx.scene;

    for (const sx of [-1, 1]) {
        const tx = sx * (span / 2 + 0.5);
        bridge.towers.push(addStatic(sc, {
            shape: 'box', halfExtents: { x: 0.5, y: y / 2 + 1.2, z: DECK_HALF_Z },
            position: { x: tx, y: y / 2 + 0.7, z }, layer: 'static', friction: 0.9,
        }, { color: '#4a4e56', roughness: 0.9 }));
    }
    for (let i = 0; i < planks; i++) {
        const x = x0 + plankLen * (i + 0.5);
        bridge.planks.push({ ...addBody(sc, {
            shape: 'box', halfExtents: { x: half, y: 0.12, z: DECK_HALF_Z }, position: { x, y, z },
            mass: plankMass, layer: 'player', friction: 1.0, restitution: 0.02,
        }, { color: i % 2 ? '#8d7b68' : '#7a6a58', roughness: 0.9 }), x, index: i });
    }

    // Hinges, not fixed joints: a deck should articulate. A chain of fixed
    // joints is one rigid beam that survives or explodes all at once.
    const link = (b1, b2, px, kind, index) => {
        const handle = Physics.createConstraint({
            type: 'hinge', body1: b1, body2: b2, point1: { x: px, y, z }, point2: { x: px, y, z },
            axis: { x: 0, y: 0, z: 1 }, breakingImpulse: bridge.threshold,
        });
        bridge.joints.push({ handle, kind, index });
    };
    link(bridge.towers[0].tag, bridge.planks[0].tag, x0, 'anchor', 0);
    for (let i = 0; i < planks - 1; i++) link(bridge.planks[i].tag, bridge.planks[i + 1].tag, x0 + plankLen * (i + 1), 'deck', i);
    link(bridge.planks[planks - 1].tag, bridge.towers[1].tag, x0 + span, 'anchor', planks - 1);

    // Hangers: distance constraints (a cable only pulls) from a static beam to
    // every other plank. They hold the deck up and they break first.
    const cableY = y + 4.0;
    const cable = addStatic(sc, { shape: 'box', halfExtents: { x: span / 2, y: 0.09, z: 0.09 },
        position: { x: 0, y: cableY, z }, layer: 'static' }, { color: '#3b4048', roughness: 0.8 });
    bridge.towers.push(cable);
    for (let i = 0; i < planks; i += 2) {
        const p = bridge.planks[i];
        const handle = Physics.createConstraint({
            type: 'distance', body1: cable.tag, body2: p.tag,
            point1: { x: p.x, y: cableY, z }, point2: { x: p.x, y, z },
            minDistance: 0, maxDistance: cableY - y, breakingImpulse: bridge.threshold,
        });
        bridge.joints.push({ handle, kind: 'hanger', index: i });
        p.hanger = handle;
        p.hangerRod = sc.createMesh({ mesh: 'cylinder', radius: 0.03, halfHeight: (cableY - y) / 2, segments: 6,
            x: p.x, y: (cableY + y) / 2, z, color: '#2a2f36', roughness: 0.8 });
    }
    bridge.built = true;
    return bridge;
}

export function destroyBridge() {
    for (const j of bridge.joints) Physics.destroyConstraint(j.handle);
    for (const p of bridge.planks) { if (p.hangerRod) p.hangerRod.destroy(); removeBody(p); }
    for (const t of bridge.towers) removeBody(t);
    bridge.joints = []; bridge.planks = []; bridge.towers = [];
    bridge.broken.clear(); bridge.log.length = 0;
    bridge.built = false;
    return true;
}

/**
 * Push a new threshold at every live joint. Already-broken joints are skipped:
 * a disabled constraint does not un-break, and writing to it would make the
 * readout lie.
 */
export function setThreshold(n) {
    bridge.threshold = n;
    for (const j of bridge.joints) {
        if (!bridge.broken.has(j.handle)) Physics.setConstraintBreakingImpulse(j.handle, n);
    }
    return true;
}

/** Fold one frame's drained broken handles into the tally. */
export function noteBroken(handles) {
    let n = 0;
    for (const h of handles) {
        const j = bridge.joints.find((o) => o.handle === h);
        if (!j || bridge.broken.has(h)) continue;
        bridge.broken.add(h);
        bridge.log.push({ handle: h, kind: j.kind, index: j.index });
        if (bridge.log.length > 40) bridge.log.shift();
        if (j.kind === 'hanger') {                        // a snapped hanger loses its cable
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
 * Drop a heavy ball on the deck, a metre off the centre line: the hanger beam
 * runs the full span right above the deck, and a ball dropped on the centre
 * line lands on the BEAM and sits there, a silent no-op that looks exactly
 * like "breakingImpulse does not work".
 */
export function dropWreckingBall(mass = 900, height = 12) {
    return rubble.add({ shape: 'sphere', radius: 0.9, position: { x: 0, y: BRIDGE.y + height, z: BRIDGE.z + 1.0 },
        mass, layer: 'player', friction: 0.6, restitution: 0.05 }, { color: '#31363d', roughness: 0.35, metallic: 0.9 });
}

/**
 * Fire a shell along the deck: loads the deck joints in shear rather than the
 * hangers in tension, so the same threshold breaks a different pattern.
 */
export function fireProjectile(speed = 60, mass = 120) {
    return rubble.add({ shape: 'sphere', radius: 0.45, position: { x: -BRIDGE.span / 2 - 6, y: BRIDGE.y + 0.6, z: BRIDGE.z },
        mass, layer: 'player', friction: 0.4, restitution: 0.2 },
        { color: '#ffd166', emissive: 2.2, roughness: 0.4, velocity: { x: speed, y: 0, z: 0 } });
}

export function clearRubble() { rubble.clear(); return true; }

/** Put the bridge back exactly as it was, and take the wreckage with it. */
export function rebuildBridge() {
    clearRubble();
    return buildBridge();
}
