// garage.js — three vehicles, one driver, one start line.
//
// All three vehicles are built once and stay alive for the life of the app.
// That is a deliberate choice over building and destroying on demand: a Jolt
// vehicle constraint is cheap to leave standing, whereas destroying one
// invalidates its chassis body tag, its PhysicsNode and anything parented to
// that node — including the cameras — so a destroy-on-switch design turns every
// vehicle change into a lifetime problem. Keeping them alive makes switching a
// pure rebinding: point the cameras at a different chassis, send input to a
// different constraint, park the other two.
//
// "Park" is not a metaphor. An inactive vehicle is still simulated, and an
// automatic gearbox creeps at idle, so the two vehicles you are not driving
// would slowly wander off down the circuit. Each frame the garage holds full
// brake on them (their own idle()) and, once they have stopped, parks them in
// the runoff so the active vehicle has a clear road.
//
// The one thing that genuinely cannot be rebound is TIRE FRICTION. Jolt bakes
// longitudinalFriction / lateralFriction into wheel settings at construction and
// bro exposes no setter, so a preset change rebuilds the car's constraint. The
// garage owns that too, because it is the thing that knows the cameras have to
// let go first.

import { createCar, TIRE_PRESETS, TIRE_ORDER } from "/app/car.js";
import { createTank, buildProvingGround } from "/app/tank.js";
import { createBike } from "/app/bike.js";
import { releaseAll } from "/app/input.js";

export const KINDS = ['car', 'tank', 'bike'];

/**
 * Build all three vehicles and the machinery to switch between them.
 *
 * @param {Object} scene
 * @param {Object} world   track handle
 * @param {Object} hooks
 * @param {Function} hooks.onAttach   called with the newly active vehicle so
 *                                    the caller can re-parent its cameras
 * @param {Function} [hooks.onDetach] called BEFORE a chassis node is destroyed,
 *                                    so the caller can let go of it first
 * @param {Function} [hooks.onChange] called after a switch completes
 */
export function createGarage(scene, world, { onAttach, onDetach, onChange } = {}) {
    // Parking bays: distinct points around the circuit, in the runoff on the
    // inside so nothing sits on the racing line. Spread out so two parked
    // vehicles never intersect.
    const BAYS = {
        car:  { index: Math.round(world.N * 0.955), lat: -(world.HALF_WIDTH + 1.8) },
        tank: { index: Math.round(world.N * 0.940), lat: -(world.HALF_WIDTH + 3.4) },
        bike: { index: Math.round(world.N * 0.925), lat: -(world.HALF_WIDTH + 1.8) },
    };

    function bayPose(kind) {
        const b = BAYS[kind];
        const p = world.edge(b.index, b.lat);
        return {
            position: { x: p.x, y: p.y + 1.6, z: p.z },
            rotation: world.quatYaw(world.yawAt(b.index)),
        };
    }

    // Built in their bays and moved to the line on activation, so nothing ever
    // spawns on top of anything else.
    const vehicles = {
        car:  createCar(scene, bayPose('car')),
        tank: createTank(scene, bayPose('tank')),
        bike: createBike(scene, bayPose('bike')),
    };

    // The tank's obstacles. Built once, near the start line, in the runoff — the
    // car can reach them too, which is the point of putting them there.
    const provingGround = buildProvingGround(scene, world);

    let activeKind = 'car';

    /** Move a vehicle to the shared start point, at rest. */
    function toStart(v) {
        v.respawn(world.spawn.position, world.spawn.rotation);
    }

    /** Move a vehicle back to its bay, at rest. */
    function toBay(v) {
        const pose = bayPose(v.kind);
        v.respawn(pose.position, pose.rotation);
    }

    // The car starts on the line. onAttach is deliberately NOT fired here: the
    // caller cannot have built its cameras yet (they need a vehicle to parent
    // to), so createCameras takes the starting vehicle directly and onAttach
    // only ever fires for SUBSEQUENT moves.
    toStart(vehicles.car);

    /**
     * Switch to another vehicle. The one being left goes back to its bay so it
     * is not abandoned mid-corner on the racing line, and the one arriving is
     * placed at the shared start point — every vehicle is judged from the same
     * spot, which is the only way the comparison means anything.
     */
    function select(kind) {
        if (!(kind in vehicles) || kind === activeKind) return vehicles[activeKind];
        const leaving = vehicles[activeKind];
        const arriving = vehicles[kind];

        // Input never carries across a switch: releasing the throttle key on the
        // car and finding the tank already at full throttle would be its own bug.
        releaseAll();
        leaving.idle();
        toBay(leaving);

        activeKind = kind;
        toStart(arriving);
        if (onAttach) onAttach(arriving);
        if (onChange) onChange(arriving);
        return arriving;
    }

    /**
     * Change the car's tyres. Rebuilds the car's constraint (see the note at the
     * top), so the cameras have to be re-attached afterwards — which is exactly
     * what onAttach does, and why this lives here rather than in car.js.
     */
    function setTirePreset(name) {
        if (!(name in TIRE_PRESETS) || name === vehicles.car.tirePreset) return false;
        const wasActive = activeKind === 'car';
        // Order matters and is the whole reason this lives in the garage: the
        // rebuild DESTROYS the car's chassis node, and a destroyed node cannot
        // have children removed from it afterwards. The cameras have to let go
        // first, then re-attach to whatever the rebuild produced.
        if (wasActive && onDetach) onDetach();
        const changed = vehicles.car.setTirePreset(name);
        if (wasActive && onAttach) onAttach(vehicles.car);
        return changed;
    }

    /**
     * Per-frame. The active vehicle drives; the others hold their brakes, and
     * once each has actually stopped it is nudged back to its bay so a parked
     * vehicle that got shunted does not end up blocking the circuit.
     */
    function update(dt) {
        const active = vehicles[activeKind];
        active.applyInput(dt);
        active.syncWheels(dt);

        for (const kind of KINDS) {
            if (kind === activeKind) continue;
            const v = vehicles[kind];
            v.idle();
            v.syncWheels(dt);
        }
        return active;
    }

    return {
        vehicles,
        provingGround,
        update,
        select,
        setTirePreset,
        toStart,
        bayPose,
        KINDS,
        TIRE_PRESETS,
        TIRE_ORDER,
        get active() { return vehicles[activeKind]; },
        get activeKind() { return activeKind; },
        get car() { return vehicles.car; },
        get tank() { return vehicles.tank; },
        get bike() { return vehicles.bike; },
    };
}
