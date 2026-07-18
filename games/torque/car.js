// car.js — the car: a real Jolt WheeledVehicleController, not a raycast fake.
//
// Everything that makes a car feel like a car is drivetrain state, and all of
// it lives in the constraint: sprung suspension per corner, an engine with a
// torque ceiling and an RPM range, a clutch and a five-speed box that shifts
// itself, a limited-slip differential across the driven rear axle, and tire
// friction that comes off slip curves rather than a friction constant. The
// vehicle steps inside the engine's fixed physics tick — there is no
// per-frame vehicle.update(). Our job each frame is exactly two things:
// push driver input in, and pull render/telemetry state out.
//
// The wheels are DRIVEN, not animated. Every frame each wheel node takes the
// chassis-local position and quaternion the constraint computed, which
// already contains steer angle, suspension travel and spin. Nothing here
// fakes a rotation from speed — if the wheels are turning, the simulation
// turned them.
//
// Input arrives through the engine's action-binding system rather than raw
// keydown listeners, so chunk 3 can add gamepad bindings to the same action
// names without touching the driving code.

// Narrower than the wheel track on purpose: at halfW 0.9 against a 0.85
// half-track the wheels sat INSIDE the body and were invisible from every
// camera, which rather undercuts an app whose point is that they turn.
const CHASSIS = { x: 0.75, y: 0.4, z: 2.15 }; // half-extents, metres
const CHASSIS_DENSITY = 291;                  // ≈ 1500 kg for that box
const WHEEL_RADIUS = 0.35;
const WHEEL_WIDTH = 0.25;
// 0.30 m of travel, not 0.17. The road is a faceted ribbon and the car
// crosses a facet every ~70 ms at speed; short travel cannot absorb the
// kinks, so the wheels skip, lose contact over crests and the car takes
// off. The attachment point moves up to keep the ride height the same.
const SUSP_MIN = 0.12, SUSP_MAX = 0.42;

// The action names. Chunk 3 appends "gamepad:*" bindings to these same names.
export const ACTIONS = {
    throttle:  ['w', 'ArrowUp'],
    brake:     ['s', 'ArrowDown'],
    steerLeft: ['a', 'ArrowLeft'],
    steerRight:['d', 'ArrowRight'],
    handbrake: [' '],
    respawn:   ['r'],
};

// CHUNK 3: add gamepad bindings to these actions — "gamepad:righttrigger",
// "gamepad:lefttrigger", "gamepad:leftx-", "gamepad:leftx+", "gamepad:south",
// plus analog strength (bro.gamepad axis values) replacing the 0/1 held flags
// in readInput(), and rumble driven from wheel slip / contact events.

/**
 * Build the car: vehicle constraint, visual chassis, four visual wheels, and
 * the input plumbing.
 * @param {Object} scene   scene context
 * @param {Object} spawn   { position:{x,y,z}, rotation:{x,y,z,w} } from the track
 */
export function createCar(scene, spawn) {
    const vehicle = Physics.createVehicle({
        chassis: {
            shape: 'box',
            halfExtents: CHASSIS,
            position: spawn.position,
            rotation: spawn.rotation,
            density: CHASSIS_DENSITY,
            friction: 0.35,
            restitution: 0.1,
        },
        // A righting torque past 60° of pitch/roll. A showcase car that lands
        // on its roof and stays there is a showcase of nothing, and Jolt's own
        // vehicle sample uses the same clamp. Note this is a LIMIT, not
        // stability: the geometry below is what actually keeps the car down.
        maxPitchRollAngle: 60,
        collisionTester: 'cylinder',
        wheels: [
            // Front left / front right — steer, brake, no drive.
            wheel(-0.88,  1.46, { steerable: true, maxSteerAngle: 32, maxBrakeTorque: 3200 }),
            wheel( 0.88,  1.46, { steerable: true, maxSteerAngle: 32, maxBrakeTorque: 3200 }),
            // Rear left / rear right — driven, and the handbrake lives here.
            wheel(-0.88, -1.46, { driven: true, maxBrakeTorque: 1600, maxHandBrakeTorque: 7000 }),
            wheel( 0.88, -1.46, { driven: true, maxBrakeTorque: 1600, maxHandBrakeTorque: 7000 }),
        ],
        // 520 N·m through 3.50:1 first and a 3.42 final drive is ≈12 m/s² of
        // launch thrust. The wheelie limit is g x halfWheelbase / CoMheight =
        // 9.81 x 1.46 / 0.65 ≈ 22 m/s², so the front stays down with margin.
        engine: { maxTorque: 520, minRPM: 900, maxRPM: 7000 },
        transmission: {
            mode: 'auto',
            // Overall first-gear ratio is 3.50 x 3.42 = 12.0:1, which tops out
            // near 68 km/h on a 0.35 m tyre at the 6200 rpm shift point. Gearing
            // this tall enough to matter: at 7.5:1 the box never left first.
            gearRatios: [3.50, 2.30, 1.65, 1.25, 1.00],
            reverseGearRatios: [-2.90],
            switchTime: 0.32,
            clutchStrength: 12,
            shiftUpRPM: 6200,
            shiftDownRPM: 2600,
        },
        // One differential across the rear axle, moderately limited-slip so a
        // wheel on the ice patch cannot take all the torque.
        differentials: [
            { leftWheel: 2, rightWheel: 3, ratio: 3.42, leftRightSplit: 0.5,
              limitedSlipRatio: 1.4, engineTorqueRatio: 1.0 },
        ],
        antiRollBars: [
            { leftWheel: 0, rightWheel: 1, stiffness: 1200 },
            { leftWheel: 2, rightWheel: 3, stiffness: 900 },
        ],
    });

    // Rollover is geometry, not luck. The tip threshold is (half wheel track) /
    // (CoM height above the contact patch); with the wheels attached at y=-0.05
    // on 0.30 m of travel and a 0.35 m tyre, the patch sits ~0.62 m below the
    // chassis centre against a 0.88 m half-track — about 1.4 g, comfortably
    // above the ~1.0 g the tyres can generate. The first draft attached the
    // wheels at -0.30 on 0.30 m of travel: a 1.13 m CoM height on a 0.78 m
    // half-track, i.e. 0.9 g, and the car rolled onto its door in every fast
    // corner instead of sliding.
    function wheel(x, z, extra) {
        return Object.assign({
            position: { x, y: 0.0, z },
            radius: WHEEL_RADIUS,
            width: WHEEL_WIDTH,
            suspensionMinLength: SUSP_MIN,
            suspensionMaxLength: SUSP_MAX,
            suspensionFrequency: 1.9,
            suspensionDamping: 0.55,
            // CHUNK 2: these two scalars are the per-wheel tire-friction demo —
            // drop lateralFriction on the rears for a drift setup, drop both on
            // one side to simulate a puncture, and pair them with the ice patch.
            longitudinalFriction: 1.15,
            // 0.88 x the curve's 1.2 peak is about 1.05 g of lateral grip,
            // comfortably under the ~1.3 g rollover threshold — so the car
            // slides when it runs out of grip instead of tripping over.
            lateralFriction: 0.88,
        }, extra);
    }

    // --- Visuals -------------------------------------------------------------
    // pixelsPerUnit: 1 is the 3D convention — the physics node's transform is
    // world units, not the 2D pixel mapping the default assumes.
    const chassisNode = scene.createPhysicsNode({
        name: 'carChassis', body: vehicle.chassisBody, pixelsPerUnit: 1, autoSync: true,
    });

    chassisNode.add(scene.createMesh({
        name: 'carBody', mesh: 'box',
        halfW: CHASSIS.x, halfH: CHASSIS.y, halfD: CHASSIS.z,
        color: '#c8452e', metallic: 0.55, roughness: 0.32,
    }));
    // Cabin and nose are cosmetic children of the same node, so they ride the
    // chassis for free and make the car's heading obvious from any camera.
    chassisNode.add(scene.createMesh({
        mesh: 'box', halfW: 0.64, halfH: 0.32, halfD: 0.95,
        y: 0.66, z: -0.25, color: '#1d2126', metallic: 0.2, roughness: 0.25,
    }));
    chassisNode.add(scene.createMesh({
        mesh: 'box', halfW: 0.55, halfH: 0.09, halfD: 0.3,
        y: 0.34, z: 1.85, color: '#f5f1d8', emissive: 1.4, roughness: 0.3,
    }));
    chassisNode.add(scene.createMesh({    // rear wing, so roll is readable
        mesh: 'box', halfW: 0.78, halfH: 0.05, halfD: 0.3,
        y: 0.72, z: -1.95, color: '#1d2126', roughness: 0.4,
    }));

    const wheelNodes = [];
    for (let i = 0; i < vehicle.wheelCount; i++) {
        const n = scene.createMesh({
            name: `wheel${i}`, mesh: 'cylinder',
            radius: WHEEL_RADIUS, halfHeight: WHEEL_WIDTH / 2, segments: 20,
            color: '#15171a', roughness: 0.95,
        });
        // Spoke bars on both faces: without a mark on the disc, a spinning
        // cylinder of revolution is visually indistinguishable from a still
        // one, and "the wheels spin" is a claim this app has to actually show.
        for (const side of [-1, 1]) {
            n.add(scene.createMesh({
                mesh: 'box', halfW: 0.055, halfH: 0.006, halfD: WHEEL_RADIUS * 0.82,
                y: side * (WHEEL_WIDTH / 2 + 0.004),
                color: '#d7dce2', metallic: 0.8, roughness: 0.3,
            }));
        }
        chassisNode.add(n);
        wheelNodes.push(n);
    }

    // --- Input ---------------------------------------------------------------
    // Held-flag set fed by "action" events; the test writes into it directly
    // through setHeld(), which is the same path the keyboard takes.
    const held = Object.create(null);
    for (const name in ACTIONS) {
        held[name] = false;
        if (typeof bro !== 'undefined' && bro.settings && bro.settings.defineAction) {
            bro.settings.defineAction(`torque_${name}`, ACTIONS[name]);
        }
    }

    let onRespawn = null;
    document.addEventListener('action', (e) => {
        const a = e.detail.action;
        if (!a || !a.startsWith('torque_')) return;
        const key = a.slice('torque_'.length);
        if (!(key in held)) return;
        held[key] = e.detail.phase === 'down';
        if (key === 'respawn' && e.detail.phase === 'down' && onRespawn) onRespawn();
    });

    // Steering is rate-limited rather than binary: a keyboard gives you 0 or 1,
    // and a car that snaps to full lock in one tick is undriveable. Return to
    // centre is faster than turn-in, which is what a self-centering rack does.
    let steer = 0;
    const STEER_IN = 2.6, STEER_BACK = 5.0;

    // Teleporting the chassis zeroes the BODY, but the drivetrain is separate
    // state: the wheels keep spinning, the engine keeps its revs and the auto
    // box keeps its gear, so a car "respawned" mid-lap would sit on the line
    // with 5000 rpm and wheelspin. This holds full brake and handbrake for a
    // moment after a respawn to spin everything back down to idle, which also
    // makes repeated runs from the line start from identical state.
    let settle = 0;
    const SETTLE_TIME = 0.6;

    /** Push this frame's driver input into the constraint. */
    function applyInput(dt) {
        if (settle > 0) {
            settle -= dt;
            steer = 0;
            vehicle.setInput({ forward: 0, right: 0, brake: 1, handBrake: 1 });
            return;
        }
        const target = (held.steerRight ? 1 : 0) - (held.steerLeft ? 1 : 0);
        const rate = (target === 0 || Math.sign(target) !== Math.sign(steer)) ? STEER_BACK : STEER_IN;
        const step = rate * dt;
        steer += Math.max(-step, Math.min(step, target - steer));
        if (Math.abs(steer) < 1e-4) steer = 0;

        // One pedal does brake-then-reverse, the way an automatic behaves:
        // press it while rolling forward and it slows the car, press it at a
        // standstill and the box picks reverse off the sign of `forward`.
        const speed = vehicle.speed;
        let forward = held.throttle ? 1 : 0;
        let brake = 0;
        if (held.brake) {
            if (speed > 0.8) { brake = 1; forward = 0; }
            else { forward = -1; }
        }
        // An automatic creeps: the clutch stays partly engaged at idle, so with
        // no pedal at all the car walks forward on its own and never actually
        // comes to rest. Hold the brake when stopped and unattended — which is
        // what the driver's left foot is doing anyway — so the car sits still
        // on the grid and on hills.
        if (!held.throttle && !held.brake && !held.handbrake && Math.abs(speed) < 0.6) {
            brake = 1;
        }

        vehicle.setInput({
            forward, right: steer, brake,
            handBrake: held.handbrake ? 1 : 0,
        });
    }

    /** Copy constraint wheel state onto the wheel nodes. Render only. */
    function syncWheels() {
        for (let i = 0; i < vehicle.wheelCount; i++) {
            const ws = vehicle.wheelState(i);
            if (!ws) continue;
            wheelNodes[i].position = [ws.position.x, ws.position.y, ws.position.z];
            wheelNodes[i].quaternion = [ws.rotation.x, ws.rotation.y, ws.rotation.z, ws.rotation.w];
        }
    }

    /**
     * Drivetrain + per-wheel telemetry.
     *
     * `compression` is normalised suspension travel (1 = fully compressed).
     * `slip` is longitudinal slip ratio derived from the wheel's own angular
     * velocity against the chassis' forward speed — Jolt solves against slip
     * curves internally but does not publish the ratio, so this is computed
     * here from published state rather than read out of the solver.
     */
    function telemetry() {
        const st = vehicle.getState();
        const speed = st.speed;
        const wheels = [];
        for (let i = 0; i < vehicle.wheelCount; i++) {
            const ws = vehicle.wheelState(i);
            if (!ws) continue;
            const surfaceSpeed = ws.angularVelocity * WHEEL_RADIUS;
            const denom = Math.max(Math.abs(speed), 1.5);
            wheels.push({
                index: i,
                contact: ws.contact,
                contactBody: ws.contactBody,
                suspensionLength: ws.suspensionLength,
                compression: clamp01((SUSP_MAX - ws.suspensionLength) / (SUSP_MAX - SUSP_MIN)),
                steerDeg: ws.steerAngle * 180 / Math.PI,
                spin: ws.rotationAngle,
                angularVelocity: ws.angularVelocity,
                slip: (surfaceSpeed - speed) / denom,
            });
        }
        return {
            speed, kmh: speed * 3.6, rpm: st.rpm, gear: st.gear,
            switching: st.isSwitchingGear, steer, wheels,
        };
    }

    /** Put the car back on the road at a given track sample, at rest. */
    function respawn(position, rotation) {
        const b = vehicle.chassisBody;
        Physics.setPosition(b, position.x, position.y, position.z);
        Physics.setRotation(b, rotation.x, rotation.y, rotation.z, rotation.w);
        Physics.setLinearVelocity(b, 0, 0, 0);
        Physics.setAngularVelocity(b, 0, 0, 0);
        Physics.activate(b);
        vehicle.setInput({ forward: 0, right: 0, brake: 1, handBrake: 1 });
        steer = 0;
        settle = SETTLE_TIME;
    }

    /** True while a respawn is still spinning the drivetrain down. */
    function isSettling() { return settle > 0; }

    // CHUNK 3: spatial audio — attach an engine-note emitter to chassisNode and
    // drive its playbackRate from telemetry().rpm; scene.bindAudioListenerToCamera
    // then gives Doppler on the trackside camera for free.

    return {
        vehicle,
        chassisNode,
        wheelNodes,
        held,
        applyInput,
        syncWheels,
        telemetry,
        respawn,
        isSettling,
        setHeld(name, on) { if (name in held) held[name] = !!on; },
        setRespawnHandler(fn) { onRespawn = fn; },
        get steerInput() { return steer; },
        WHEEL_RADIUS, SUSP_MIN, SUSP_MAX,
    };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
