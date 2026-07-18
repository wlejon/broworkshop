// stage.js — the sandbox itself: three material lanes, three identical feed
// ramps, and a perimeter to keep things in frame.
//
// The layout exists to make friction and restitution VISIBLE rather than
// merely configured. Everything is symmetric except the surface material:
// three lanes running along +X, each fed by an identical ramp at the same
// height, so a ball released on all three at once is a controlled experiment.
// Whatever the balls then do differently is the material and nothing else.
//
//   ice       friction 0.02, restitution 0.05 — slides almost forever
//   concrete  friction 1.10, restitution 0.05 — grips, stops short
//   rubber    friction 0.85, restitution 0.92 — grips AND bounces
//
// Ice-vs-rubber is also the natural showcase for combine modes: two bodies
// with wildly different restitution have to resolve to ONE number per contact,
// and which number depends entirely on the combine rule. See hud.js.
//
// Static bodies get a plain mesh at a fixed transform rather than a
// PhysicsNode — nothing to sync when nothing moves, and it keeps the
// per-frame sync loop proportional to the number of things actually in
// motion.

// Lane geometry. Half-extents are shared between the collider and the mesh so
// the two can never drift apart.
const LANE_HALF_X = 24;
const LANE_HALF_Y = 0.5;
const LANE_HALF_Z = 2.6;

export const MATERIALS = [
    {
        key: 'ice', label: 'Ice', z: -6,
        friction: 0.02, restitution: 0.05,
        color: '#5fb8e0', roughness: 0.10, metallic: 0.0,
        note: 'slick — slides the full lane',
    },
    {
        key: 'concrete', label: 'Concrete', z: 0,
        friction: 1.10, restitution: 0.05,
        color: '#4a4e56', roughness: 0.95, metallic: 0.0,
        note: 'grippy — stops short, no bounce',
    },
    {
        key: 'rubber', label: 'Rubber', z: 6,
        friction: 0.85, restitution: 0.92,
        color: '#8c2f2c', roughness: 0.65, metallic: 0.0,
        note: 'grippy AND springy — stops short, bounces high',
    },
];

// Ramp: a slab tilted about Z so its -X end is high. The release point sits
// just above the high end, which is why RAMP_TOP is derived from the same
// angle rather than eyeballed — change RAMP_ANGLE and the spawn point follows.
const RAMP_ANGLE = -0.35;            // radians about Z; negative = descends toward +X
const RAMP_HALF_X = 5.0;
const RAMP_CENTER_X = -16;
const RAMP_CENTER_Y = 2.2;

// Release point: 75% of the way up rather than at the very tip. Dropping onto
// the tip makes the ball strike the ramp's end CAP, which kicks it backwards
// off the high end instead of down the slope — the release has to land on the
// slab's top face with room to spare.
const RAMP_RELEASE_T = 0.75;
export const RAMP_TOP = {
    x: RAMP_CENTER_X - RAMP_HALF_X * RAMP_RELEASE_T * Math.cos(RAMP_ANGLE),
    y: RAMP_CENTER_Y + RAMP_HALF_X * RAMP_RELEASE_T * Math.sin(-RAMP_ANGLE) + 0.75,
};

// Quaternion for a rotation of `a` radians about +Z.
const quatZ = (a) => ({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) });

/**
 * Build the static world. Returns the handles the HUD and the tests need —
 * notably `lanes`, keyed by material, so a test can read back the friction it
 * is about to prove something about.
 */
export function buildStage(scene) {
    const lanes = {};
    const ramps = [];

    for (const m of MATERIALS) {
        // Collider and visual share half-extents and centre. The lane top
        // surface lands exactly on y = 0 so every spawn height in the app can
        // be read as "metres above the floor".
        const body = Physics.createBody({
            shape: 'box',
            halfExtents: { x: LANE_HALF_X, y: LANE_HALF_Y, z: LANE_HALF_Z },
            position: { x: 0, y: -LANE_HALF_Y, z: m.z },
            static: true,
            layer: 'static',
            friction: m.friction,
            restitution: m.restitution,
        });

        const mesh = scene.createMesh({
            mesh: 'box',
            halfW: LANE_HALF_X, halfH: LANE_HALF_Y, halfD: LANE_HALF_Z,
            x: 0, y: -LANE_HALF_Y, z: m.z,
            color: m.color, roughness: m.roughness, metallic: m.metallic,
        });

        // A low emissive kerb at each lane's near edge. Purely a legend: it
        // reads as a coloured stripe from any camera angle, which the lane
        // surface itself does not once the camera is low.
        scene.createMesh({
            mesh: 'box',
            halfW: LANE_HALF_X, halfH: 0.06, halfD: 0.12,
            x: 0, y: 0.06, z: m.z + LANE_HALF_Z,
            color: m.color, emissive: 1.6, emissiveColor: m.color,
            roughness: 1.0,
        });

        // Feed ramp — identical for every lane, so the only variable
        // downstream is the surface. Given a low friction of its own so the
        // ramp does not itself become the experiment.
        const rampBody = Physics.createBody({
            shape: 'box',
            halfExtents: { x: RAMP_HALF_X, y: 0.25, z: LANE_HALF_Z * 0.92 },
            position: { x: RAMP_CENTER_X, y: RAMP_CENTER_Y, z: m.z },
            rotation: quatZ(RAMP_ANGLE),
            static: true,
            layer: 'scenery',
            friction: 0.08,
            restitution: 0.0,
        });
        scene.createMesh({
            mesh: 'box',
            halfW: RAMP_HALF_X, halfH: 0.25, halfD: LANE_HALF_Z * 0.92,
            x: RAMP_CENTER_X, y: RAMP_CENTER_Y, z: m.z,
            rz: RAMP_ANGLE * 180 / Math.PI,
            color: '#8d7b68', roughness: 0.85,
        });

        lanes[m.key] = { ...m, body, mesh, rampBody, releaseZ: m.z };
        ramps.push(rampBody);
    }

    // Perimeter. On the `scenery` layer, which is what makes the layer matrix
    // demo tangible: turn projectile-vs-scenery off and projectiles sail
    // straight out through the walls while everything else stays contained.
    const walls = [];
    const wall = (x, y, z, hx, hy, hz) => {
        const b = Physics.createBody({
            shape: 'box', halfExtents: { x: hx, y: hy, z: hz },
            position: { x, y, z }, static: true, layer: 'scenery',
            friction: 0.4, restitution: 0.2,
        });
        scene.createMesh({
            mesh: 'box', halfW: hx, halfH: hy, halfD: hz, x, y, z,
            color: '#3b4048', roughness: 0.9,
        });
        walls.push(b);
        return b;
    };
    wall( 25.5, 1.5, 0, 0.5, 1.5, 10.0);   // far end (+X) — the backstop
    wall(-25.5, 3.0, 0, 0.5, 3.0, 10.0);   // behind the ramps
    wall(0, 1.5,  9.6, 25.0, 1.5, 0.5);
    wall(0, 1.5, -9.6, 25.0, 1.5, 0.5);

    return { lanes, ramps, walls, RAMP_TOP, MATERIALS };
}
