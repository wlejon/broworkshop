// sim/stage.js — the sandbox bay: three material lanes, three identical feed
// ramps, and a perimeter.
//
// The layout makes friction and restitution VISIBLE. Everything is symmetric
// except the lane surface, so a box released on all three ramps at once is a
// controlled experiment: whatever differs downstream is the material.
//
//   ice       friction 0.02, restitution 0.05 — slides almost forever
//   concrete  friction 1.10, restitution 0.05 — grips, stops short
//   rubber    friction 0.85, restitution 0.92 — grips AND bounces

import { addStatic, q } from "/lib/kit/physics3d.js";
import { ctx } from "./ctx.js";

// Shared by collider and visual so the two cannot drift apart.
const LANE = { x: 24, y: 0.5, z: 2.6 };

export const MATERIALS = [
    { key: 'ice', label: 'Ice', z: -6, friction: 0.02, restitution: 0.05,
      color: '#5fb8e0', roughness: 0.10, note: 'slick — slides the full lane' },
    { key: 'concrete', label: 'Concrete', z: 0, friction: 1.10, restitution: 0.05,
      color: '#4a4e56', roughness: 0.95, note: 'grippy — stops short, no bounce' },
    { key: 'rubber', label: 'Rubber', z: 6, friction: 0.85, restitution: 0.92,
      color: '#8c2f2c', roughness: 0.65, note: 'grippy AND springy — stops short, bounces high' },
];

// Ramp: a slab tilted about Z, high at -X. The release point is derived from
// the same angle, 75% of the way up: dropping onto the very tip strikes the
// slab's end cap and kicks the box backwards off the ramp.
const RAMP_ANGLE = -0.35;
const RAMP_HALF_X = 5.0;
const RAMP_CENTER = { x: -16, y: 2.2 };
const RAMP_RELEASE_T = 0.75;
export const RAMP_TOP = {
    x: RAMP_CENTER.x - RAMP_HALF_X * RAMP_RELEASE_T * Math.cos(RAMP_ANGLE),
    y: RAMP_CENTER.y + RAMP_HALF_X * RAMP_RELEASE_T * Math.sin(-RAMP_ANGLE) + 0.75,
};

/** Built handles: lanes keyed by material (the tests read their friction back). */
export const stage = { lanes: {}, ramps: [], walls: [], MATERIALS, RAMP_TOP };

export function buildStage() {
    const scene = ctx.scene;
    for (const m of MATERIALS) {
        // Lane tops land exactly on y = 0: every spawn height reads as "metres
        // above the floor".
        const lane = addStatic(scene, {
            shape: 'box', halfExtents: LANE, position: { x: 0, y: -LANE.y, z: m.z },
            layer: 'static', friction: m.friction, restitution: m.restitution,
        }, { color: m.color, roughness: m.roughness, metallic: 0 });

        // An emissive kerb on the near edge: reads as a coloured stripe from any
        // angle, which the lane surface itself does not once the camera is low.
        scene.createMesh({
            mesh: 'box', halfW: LANE.x, halfH: 0.06, halfD: 0.12,
            x: 0, y: 0.06, z: m.z + LANE.z,
            color: m.color, emissive: 1.6, emissiveColor: m.color, roughness: 1.0,
        });

        // Feed ramp: identical per lane, low friction so the ramp itself is not
        // the experiment.
        const ramp = addStatic(scene, {
            shape: 'box', halfExtents: { x: RAMP_HALF_X, y: 0.25, z: LANE.z * 0.92 },
            position: { x: RAMP_CENTER.x, y: RAMP_CENTER.y, z: m.z },
            rotation: q.axis(0, 0, 1, RAMP_ANGLE),
            layer: 'scenery', friction: 0.08, restitution: 0.0,
        }, { color: '#8d7b68', roughness: 0.85 });

        stage.lanes[m.key] = { ...m, body: lane.tag, mesh: lane.mesh, rampBody: ramp.tag };
        stage.ramps.push(ramp.tag);
    }

    // Perimeter on the `scenery` layer, which is what makes the layer matrix
    // tangible: untick projectile/scenery and pink bodies leave through the walls.
    const wall = (x, y, z, hx, hy, hz) => stage.walls.push(addStatic(scene, {
        shape: 'box', halfExtents: { x: hx, y: hy, z: hz }, position: { x, y, z },
        layer: 'scenery', friction: 0.4, restitution: 0.2,
    }, { color: '#3b4048', roughness: 0.9 }).tag);
    wall(25.5, 1.5, 0, 0.5, 1.5, 10.0);     // far end (+X), the backstop
    wall(-25.5, 3.0, 0, 0.5, 3.0, 10.0);    // behind the ramps
    wall(0, 1.5, 9.6, 25.0, 1.5, 0.5);
    wall(0, 1.5, -9.6, 25.0, 1.5, 0.5);
    return stage;
}
