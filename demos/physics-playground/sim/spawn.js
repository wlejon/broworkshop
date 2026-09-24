// sim/spawn.js — loose dynamic bodies and the registry that finds them again.
//
// A raycast answers with a tag and nothing else, so click-to-select, the live
// property editor and "clear all" all hang off `bodies`, a tag -> entry map.

import { BodyGroup } from "/lib/kit/physics3d.js";
import { LAYER_COLORS } from "./layers.js";
import { scene } from "./ctx.js";

/** tag -> { tag, node, kind, layer } */
export const bodies = new BodyGroup(scene);
export const bodyCount = () => bodies.size;

// Shape recipes: the createBody shape plus, where the generated mesh will not
// do, a look.mesh override. The compound is a deliberately lopsided L whose
// centre of mass sits off its geometric centre: it tumbles like no primitive,
// which is the clearest proof that compound inertia is real.
const SHAPES = {
    box: () => ({ body: { shape: 'box', halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }, roughness: 0.6 }),
    sphere: () => ({ body: { shape: 'sphere', radius: 0.45 }, roughness: 0.35, segments: 24 }),
    capsule: () => ({ body: { shape: 'capsule', radius: 0.3, halfHeight: 0.45 }, roughness: 0.5, segments: 20 }),
    compound: () => ({
        body: {
            shape: 'compound',
            parts: [
                { shape: 'box', halfExtents: { x: 0.7, y: 0.22, z: 0.22 }, localPosition: { x: -0.2, y: 0, z: 0 } },
                { shape: 'box', halfExtents: { x: 0.22, y: 0.6, z: 0.22 }, localPosition: { x: 0.7, y: 0.4, z: 0 } },
            ],
        },
        roughness: 0.55,
    }),
    torus: () => {
        const t = Mesh.torus(0.42, 0.16, 20, 12);
        return {
            // A torus is concave: decomposedMesh splits it into convex hulls, so
            // it can hang on a post and roll like a ring rather than a disc.
            body: { shape: 'decomposedMesh', positions: t.positions, indices: t.indices, maxHulls: 16 },
            roughness: 0.45,
            mesh: (s, color) => s.createMesh({
                mesh: 'torus', majorRadius: 0.42, minorRadius: 0.16,
                majorSegments: 20, minorSegments: 12, color, roughness: 0.45,
            }),
        };
    },
};

export const SHAPE_KINDS = Object.keys(SHAPES);

/**
 * Spawn one dynamic body. opts are createBody names (friction, restitution,
 * linearDamping, angularDamping, gravityFactor, mass, frictionCombine,
 * restitutionCombine) plus `layer` (also picks the colour) and `velocity`.
 */
export function spawn(kind, pos, opts = {}) {
    const recipe = (SHAPES[kind] || SHAPES.box)();
    const layer = opts.layer || 'player';
    const color = LAYER_COLORS[layer] || '#cccccc';
    return bodies.add({
        ...recipe.body,
        position: pos,
        layer,
        friction: opts.friction ?? 0.5,
        restitution: opts.restitution ?? 0.3,
        linearDamping: opts.linearDamping ?? 0.05,
        angularDamping: opts.angularDamping ?? 0.05,
        gravityFactor: opts.gravityFactor ?? 1.0,
        ...(opts.mass != null ? { mass: opts.mass } : {}),
        ...(opts.frictionCombine ? { frictionCombine: opts.frictionCombine } : {}),
        ...(opts.restitutionCombine ? { restitutionCombine: opts.restitutionCombine } : {}),
    }, {
        color, roughness: recipe.roughness, segments: recipe.segments,
        mesh: recipe.mesh ? (s) => recipe.mesh(s, color) : null,
        velocity: opts.velocity,
    }, { kind, layer });
}

/**
 * One identical box at the top of every ramp: the material A/B/C test.
 * Boxes, not spheres: a rolling ball barely cares what it rolls on, so all
 * three finish within centimetres (correct physics, useless demo). A sliding
 * box makes contact friction the dominant term.
 */
export function materialRace(stage, opts = {}) {
    return stage.MATERIALS.map((m) => spawn('box', { x: stage.RAMP_TOP.x, y: stage.RAMP_TOP.y, z: m.z }, {
        layer: 'player', friction: 0.6, restitution: 0.1,
        angularDamping: 0.4,          // discourages tumbling: keep it a slide
        ...opts,
    }));
}

/**
 * Stress spawn over the lanes at varied heights (so the pile arrives over
 * several steps), cycling shapes and layers so the colour coding and the
 * layer matrix both have something to act on.
 */
export function rain(n, opts = {}) {
    const layers = opts.layers || ['player', 'debris', 'projectile'];
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push(spawn(SHAPE_KINDS[i % SHAPE_KINDS.length], {
            x: -8 + Math.random() * 26, y: 8 + Math.random() * 9, z: -8 + Math.random() * 16,
        }, { layer: layers[i % layers.length], friction: 0.5, restitution: 0.35 }));
    }
    return out;
}

export const despawn = (tag) => bodies.remove(tag);

// "Clear all" has to mean all. Ragdolls, soft bodies, machine debris and the
// bridge are not in `bodies`; each registers its own teardown here rather
// than this module learning about all of them.
const clearHooks = [];
export function onClearAll(fn) { clearHooks.push(fn); }

/**
 * Remove every spawned object. Deliberately NOT Physics.destroyAll(), which
 * would take the lanes, ramps, sensors and machines with it and leave a panel
 * full of dead handles.
 */
export function clearAll() {
    bodies.clear();
    for (const fn of clearHooks) fn();
}
