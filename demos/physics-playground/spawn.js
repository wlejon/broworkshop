// spawn.js — everything that puts a dynamic body into the world, plus the
// registry that lets the rest of the app find it again.
//
// Every spawned body is paired with a PhysicsNode so the visual follows the
// simulation, and recorded in `bodies` keyed by tag. The registry is what
// makes click-to-select, the live property editor and "clear all" possible:
// a raycast gives you a tag and nothing else, so there has to be a tag -> {
// node, layer, kind } map somewhere.

import { LAYER_COLORS } from '/app/layers.js';

/** tag -> { tag, node, mesh, kind, layer } */
export const bodies = new Map();

/**
 * Extra teardown to run on "clear all".
 *
 * Ragdolls and soft bodies are not rigid bodies in `bodies` — a ragdoll is a
 * joint set that lives and dies as one unit, a soft body is a particle cloud —
 * so neither can be despawned through this module's tag registry. Rather than
 * teach spawn.js about them (and invert the dependency), they register their
 * own cleanup here at import time.
 */
export const cleanupHooks = [];
export function onClearAll(fn) { cleanupHooks.push(fn); }

let sceneRef = null;
export function initSpawn(scene) { sceneRef = scene; }

export const bodyCount = () => bodies.size;

// Shape recipes. Each returns the createBody shape options and a matching
// visual, so a body and its mesh can never disagree about size. The compound
// is deliberately lopsided — an L of two boxes whose centre of mass sits off
// the geometric centre, which tumbles in a way no primitive does and is the
// clearest proof that compound inertia is real.
const SHAPES = {
    box: () => ({
        body: { shape: 'box', halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
        mesh: (s, color) => s.createMesh({ mesh: 'box', halfW: 0.4, halfH: 0.4, halfD: 0.4, color, roughness: 0.6 }),
    }),
    sphere: () => ({
        body: { shape: 'sphere', radius: 0.45 },
        mesh: (s, color) => s.createMesh({ mesh: 'sphere', radius: 0.45, segments: 24, rings: 18, color, roughness: 0.35 }),
    }),
    capsule: () => ({
        body: { shape: 'capsule', radius: 0.3, halfHeight: 0.45 },
        mesh: (s, color) => s.createMesh({ mesh: 'capsule', radius: 0.3, halfHeight: 0.45, segments: 20, color, roughness: 0.5 }),
    }),
    compound: () => ({
        body: {
            shape: 'compound',
            parts: [
                { shape: 'box', halfExtents: { x: 0.7, y: 0.22, z: 0.22 }, localPosition: { x: -0.2, y: 0, z: 0 } },
                { shape: 'box', halfExtents: { x: 0.22, y: 0.6, z: 0.22 }, localPosition: { x: 0.7, y: 0.4, z: 0 } },
            ],
        },
        // Two child meshes under the one PhysicsNode, matching the two parts.
        mesh: (s, color) => {
            const root = s.createNode('compound-visual');
            const a = s.createMesh({ mesh: 'box', halfW: 0.7, halfH: 0.22, halfD: 0.22, x: -0.2, y: 0, z: 0, color, roughness: 0.55 });
            const b = s.createMesh({ mesh: 'box', halfW: 0.22, halfH: 0.6, halfD: 0.22, x: 0.7, y: 0.4, z: 0, color, roughness: 0.55 });
            root.add(a); root.add(b);
            return root;
        },
    }),
};

export const SHAPE_KINDS = Object.keys(SHAPES);

/**
 * Spawn one dynamic body.
 *
 * @param {string} kind    - 'box' | 'sphere' | 'capsule' | 'compound'
 * @param {{x,y,z}} pos
 * @param {Object} [opts]  - forwarded to createBody; `layer` picks the colour
 *                           too, and the material fields (friction /
 *                           restitution / *Combine / mass / damping /
 *                           gravityFactor) are exactly the createBody names so
 *                           the HUD can pass its own state straight through.
 */
export function spawn(kind, pos, opts = {}) {
    if (!sceneRef) throw new Error('spawn.js: initSpawn(scene) not called');
    const recipe = (SHAPES[kind] || SHAPES.box)();
    const layer = opts.layer || 'player';
    const color = LAYER_COLORS[layer] || '#cccccc';

    const tag = Physics.createBody({
        ...recipe.body,
        position: pos,
        layer,
        friction:            opts.friction            ?? 0.5,
        restitution:         opts.restitution         ?? 0.3,
        linearDamping:       opts.linearDamping       ?? 0.05,
        angularDamping:      opts.angularDamping      ?? 0.05,
        gravityFactor:       opts.gravityFactor       ?? 1.0,
        ...(opts.mass              != null ? { mass: opts.mass } : {}),
        ...(opts.frictionCombine    ? { frictionCombine: opts.frictionCombine } : {}),
        ...(opts.restitutionCombine ? { restitutionCombine: opts.restitutionCombine } : {}),
    });

    const node = sceneRef.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
    const mesh = recipe.mesh(sceneRef, color);
    node.add(mesh);

    if (opts.velocity) {
        Physics.setLinearVelocity(tag, opts.velocity.x, opts.velocity.y, opts.velocity.z);
    }

    const entry = { tag, node, mesh, kind, layer };
    bodies.set(tag, entry);
    return entry;
}

/**
 * Release one identical object at the top of every ramp at once — the
 * material A/B/C test, and the fastest way to read the lanes.
 *
 * Boxes, not spheres, and that choice is the whole experiment. A sphere ROLLS,
 * and a rolling ball barely cares what it is rolling on — run the race with
 * spheres and all three finish within centimetres of each other, which is
 * correct physics and a useless demo. A box SLIDES, so the contact friction is
 * the dominant term and the three lanes spread out by tens of metres.
 */
export function materialRace(stage, opts = {}) {
    const out = [];
    for (const m of stage.MATERIALS) {
        out.push(spawn('box', { x: stage.RAMP_TOP.x, y: stage.RAMP_TOP.y, z: m.z }, {
            layer: 'player',
            friction: 0.6,
            restitution: 0.1,
            angularDamping: 0.4,   // discourages tumbling, keeps it a slide
            ...opts,
        }));
    }
    return out;
}

/**
 * Stress spawn. Scattered over the lanes at varied heights so the pile
 * arrives over several steps rather than as one degenerate stack, and cycled
 * through shapes and layers so the colour coding and the layer matrix both
 * have something to act on.
 */
export function rain(n, opts = {}) {
    const layers = opts.layers || ['player', 'debris', 'projectile'];
    const out = [];
    for (let i = 0; i < n; i++) {
        const kind = SHAPE_KINDS[i % SHAPE_KINDS.length];
        out.push(spawn(kind, {
            x: -8 + Math.random() * 26,
            y: 8 + Math.random() * 9,
            z: -8 + Math.random() * 16,
        }, {
            layer: layers[i % layers.length],
            friction: 0.5,
            restitution: 0.35,
        }));
    }
    return out;
}

/** Remove one spawned body and its visual. Safe on unknown tags. */
export function despawn(tag) {
    const e = bodies.get(tag);
    if (!e) return false;
    // Node first: once the body is gone the node's bound BodyID dangles, and
    // a sync between the two calls would read a destroyed body.
    if (e.node && e.node.destroy) e.node.destroy();
    Physics.destroyBody(tag);
    bodies.delete(tag);
    return true;
}

/**
 * Remove every spawned body. Deliberately NOT Physics.destroyAll() — that
 * would take the stage lanes, ramps, walls and area sensors with it and leave
 * an empty world with a HUD full of dead handles.
 */
export function clearAll() {
    for (const tag of [...bodies.keys()]) despawn(tag);
    for (const fn of cleanupHooks) fn();
}
