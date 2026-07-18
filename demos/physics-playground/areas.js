// areas.js — gravity and damping fields (bro's Godot Area3D analog).
//
// An area is a SENSOR body carrying a field override. Once installed, the
// physics step itself applies the field to every dynamic body overlapping the
// volume: no per-frame JS, no contact bookkeeping, no "am I in the water"
// flags. That is the whole reason these are interesting — the behaviour change
// happens inside the step, so it survives at any step rate and stays
// deterministic under advanceTime().
//
// Three zones, chosen because they exercise the three distinct mechanisms:
//
//   lowgrav  gravityMode 'scale' — multiplies world gravity. The mildest form:
//            the field composes with whatever else is going on.
//   water    gravityMode 'replace' + linear/angular damping. Replace STOPS the
//            area walk, so world gravity is ignored entirely inside; a weak
//            upward gravity plus heavy drag reads as buoyancy.
//   well     gravityPoint with inverse-square falloff, in 'combine' mode so it
//            ADDS to world gravity instead of masking it — objects arc into
//            the centre rather than simply hanging.
//
// Every zone gets a translucent hull so the boundary is legible. The hull is
// a plain mesh at a fixed transform, not a PhysicsNode: sensors never move.
//
// One timing note, straight from the API docs and worth remembering when
// reading the tests: membership follows the sensor contact stream, so a field
// engages on the step AFTER the overlap begins and releases one step after it
// ends. At 60 Hz that is invisible; at the 15 Hz the interpolation demo uses
// it is a real 66 ms of lag on zone entry.

export const AREA_DEFS = [
    {
        key: 'lowgrav',
        label: 'Low gravity',
        hint: 'gravityScale — world gravity multiplied down. Things hang.',
        shape: 'box',
        halfExtents: { x: 4, y: 5, z: 2.6 },
        position: { x: 8, y: 5, z: -6 },          // over the ice lane
        color: [0.45, 0.75, 1.0, 0.11],
        enabled: true,
        params: { gravityScale: 0.12 },
        build: (p) => ({ gravityScale: p.gravityScale, gravityMode: 'scale', priority: 0 }),
        controls: [
            { key: 'gravityScale', label: 'gravity x', min: 0, max: 1, step: 0.01 },
        ],
    },
    {
        key: 'water',
        label: 'Water (drag)',
        hint: 'replace gravity + heavy damping. Things sink slowly and settle.',
        shape: 'box',
        halfExtents: { x: 4, y: 2.5, z: 2.6 },
        position: { x: 8, y: 2.5, z: 0 },         // sunk onto the concrete lane
        color: [0.20, 0.70, 0.85, 0.22],
        enabled: true,
        params: { buoyancy: -1.6, linearDamping: 4.0, angularDamping: 3.0 },
        build: (p) => ({
            gravity: { x: 0, y: p.buoyancy, z: 0 },
            gravityMode: 'replace',
            linearDamping: p.linearDamping,
            angularDamping: p.angularDamping,
            priority: 1,
        }),
        controls: [
            { key: 'buoyancy',       label: 'gravity Y', min: -9.8, max: 4, step: 0.1 },
            { key: 'linearDamping',  label: 'lin damp',  min: 0, max: 12, step: 0.1 },
            { key: 'angularDamping', label: 'ang damp',  min: 0, max: 12, step: 0.1 },
        ],
    },
    {
        key: 'well',
        label: 'Gravity well',
        hint: 'gravityPoint + inverse-square falloff, combined with world gravity.',
        shape: 'sphere',
        radius: 4.5,
        position: { x: 9, y: 5.5, z: 6 },         // over the rubber lane
        color: [0.75, 0.45, 1.0, 0.15],
        enabled: true,
        params: { gravityStrength: 26, falloffDistance: 3.0 },
        build: (p) => ({
            gravityPoint: true,
            gravityStrength: p.gravityStrength,
            falloffDistance: p.falloffDistance,
            gravityMode: 'combine',
            priority: 0,
        }),
        controls: [
            { key: 'gravityStrength', label: 'strength', min: 0, max: 60, step: 1 },
            { key: 'falloffDistance', label: 'falloff m', min: 0, max: 8, step: 0.1 },
        ],
    },
];

/** key -> { def, tag, mesh, params, enabled } */
export const areas = new Map();

/**
 * Create every zone. Sensors are created unconditionally — enabling and
 * disabling a zone installs or clears its OVERRIDE rather than creating and
 * destroying the body, which keeps the tag stable for the HUD and avoids
 * churning the broadphase every time somebody flicks a checkbox.
 */
export function buildAreas(scene) {
    for (const def of AREA_DEFS) {
        const shapeOpts = def.shape === 'sphere'
            ? { shape: 'sphere', radius: def.radius }
            : { shape: 'box', halfExtents: def.halfExtents };

        const tag = Physics.createBody({
            ...shapeOpts,
            position: def.position,
            static: true,
            sensor: true,
            layer: 'static',
        });

        const mesh = def.shape === 'sphere'
            ? scene.createMesh({
                mesh: 'sphere', radius: def.radius, segments: 28, rings: 20,
                x: def.position.x, y: def.position.y, z: def.position.z,
                color: def.color, roughness: 0.25, twoSided: true,
                emissive: 0.35, emissiveColor: [def.color[0], def.color[1], def.color[2]],
            })
            : scene.createMesh({
                mesh: 'box',
                halfW: def.halfExtents.x, halfH: def.halfExtents.y, halfD: def.halfExtents.z,
                x: def.position.x, y: def.position.y, z: def.position.z,
                color: def.color, roughness: 0.25, twoSided: true,
                emissive: 0.35, emissiveColor: [def.color[0], def.color[1], def.color[2]],
            });

        const entry = { def, tag, mesh, params: { ...def.params }, enabled: def.enabled };
        areas.set(def.key, entry);
        applyArea(def.key);
    }
    return areas;
}

/**
 * Push a zone's current params at Jolt, or clear the override if the zone is
 * off. Clearing rather than deleting means bodies already inside are released
 * on the next step and pick the field back up the moment it is re-enabled.
 */
export function applyArea(key) {
    const a = areas.get(key);
    if (!a) return false;
    if (!a.enabled) {
        Physics.setAreaOverride(a.tag, null);
        if (a.mesh) a.mesh.visible = false;
        return true;
    }
    if (a.mesh) a.mesh.visible = true;
    return Physics.setAreaOverride(a.tag, a.def.build(a.params));
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

export function getArea(key) { return areas.get(key); }
