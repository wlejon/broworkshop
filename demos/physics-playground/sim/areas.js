// sim/areas.js — gravity and damping fields (the Godot Area3D analog).
//
// An area is a SENSOR body carrying a field override. The physics step itself
// applies the field to every dynamic body overlapping the volume: no per-frame
// JS, no "am I in the water" flags, so the behaviour survives any step rate and
// stays deterministic under advanceTime(). Three zones, three mechanisms:
//
//   lowgrav  gravityMode 'scale': world gravity multiplied down
//   water    gravityMode 'replace' + damping: world gravity ignored inside; a
//            weak upward gravity plus heavy drag reads as buoyancy
//   well     gravityPoint, inverse-square falloff, 'combine': ADDS to world
//            gravity, so bodies arc into the centre instead of hanging
//
// Membership follows the sensor contact stream, so a field engages the step
// after the overlap begins: invisible at 60 Hz, 66 ms of lag at 15 Hz.

import { addStatic } from "/lib/kit/physics3d.js";
import { ctx } from "./ctx.js";

export const AREA_DEFS = [
    {
        key: 'lowgrav', label: 'Low gravity',
        hint: 'gravityScale — world gravity multiplied down. Things hang.',
        shape: { shape: 'box', halfExtents: { x: 4, y: 5, z: 2.6 } },
        position: { x: 8, y: 5, z: -6 },               // over the ice lane
        color: [0.45, 0.75, 1.0, 0.11],
        params: { gravityScale: 0.12 },
        build: (p) => ({ gravityScale: p.gravityScale, gravityMode: 'scale', priority: 0 }),
        controls: { gravityScale: { label: 'gravity x', min: 0, max: 1, step: 0.01 } },
    },
    {
        key: 'water', label: 'Water (drag)',
        hint: 'replace gravity + heavy damping. Things sink slowly and settle.',
        shape: { shape: 'box', halfExtents: { x: 4, y: 2.5, z: 2.6 } },
        position: { x: 8, y: 2.5, z: 0 },              // sunk onto the concrete lane
        color: [0.20, 0.70, 0.85, 0.22],
        params: { buoyancy: -1.6, linearDamping: 4.0, angularDamping: 3.0 },
        build: (p) => ({
            gravity: { x: 0, y: p.buoyancy, z: 0 }, gravityMode: 'replace',
            linearDamping: p.linearDamping, angularDamping: p.angularDamping, priority: 1,
        }),
        controls: {
            buoyancy:       { label: 'gravity Y', min: -9.8, max: 4, step: 0.1 },
            linearDamping:  { label: 'lin damp', min: 0, max: 12, step: 0.1 },
            angularDamping: { label: 'ang damp', min: 0, max: 12, step: 0.1 },
        },
    },
    {
        key: 'well', label: 'Gravity well',
        hint: 'gravityPoint + inverse-square falloff, combined with world gravity.',
        shape: { shape: 'sphere', radius: 4.5 },
        position: { x: 9, y: 5.5, z: 6 },              // over the rubber lane
        color: [0.75, 0.45, 1.0, 0.15],
        params: { gravityStrength: 26, falloffDistance: 3.0 },
        build: (p) => ({
            gravityPoint: true, gravityStrength: p.gravityStrength,
            falloffDistance: p.falloffDistance, gravityMode: 'combine', priority: 0,
        }),
        controls: {
            gravityStrength: { label: 'strength', min: 0, max: 60, step: 1 },
            falloffDistance: { label: 'falloff m', min: 0, max: 8, step: 0.1 },
        },
    },
];

/** key -> { def, tag, mesh, params, enabled } */
export const areas = new Map();

/**
 * Create every zone. Sensors exist unconditionally; toggling a zone installs
 * or clears its OVERRIDE, keeping the tag stable and the broadphase unchurned.
 */
export function buildAreas() {
    for (const def of AREA_DEFS) {
        const c = def.color;
        const { tag, mesh } = addStatic(ctx.scene, {
            ...def.shape, position: def.position, sensor: true, layer: 'static',
        }, {
            color: c, roughness: 0.25, twoSided: true, segments: 28,
            emissive: 0.35, emissiveColor: [c[0], c[1], c[2]],
        });
        areas.set(def.key, { def, tag, mesh, params: { ...def.params }, enabled: true });
        applyArea(def.key);
    }
    return areas;
}

/** Push a zone's params at Jolt, or clear the override when it is off. */
export function applyArea(key) {
    const a = areas.get(key);
    if (!a) return false;
    a.mesh.visible = a.enabled;
    return Physics.setAreaOverride(a.tag, a.enabled ? a.def.build(a.params) : null) !== false;
}

export function setAreaEnabled(key, on) {
    const a = areas.get(key);
    if (!a) return false;
    a.enabled = !!on;
    return applyArea(key);
}

export function setAreaParam(key, param, value) {
    const a = areas.get(key);
    if (!a) return false;
    a.params[param] = value;
    return applyArea(key);
}
