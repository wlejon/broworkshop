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
// Input arrives through the shared action set in input.js rather than raw
// keydown listeners, so chunk 3 can add gamepad bindings to the same action
// names without touching the driving code.
//
// TIRE PRESETS (chunk 2). Per-wheel longitudinalFriction / lateralFriction are
// CREATE-TIME options — Jolt bakes them into the wheel settings and bro exposes
// no setter for them afterwards. Changing a preset therefore rebuilds the
// vehicle in place: the handle this module returns is a stable wrapper whose
// internals get swapped, so every reference held by app.js, the HUD and the
// smoke test survives a preset change. The scene nodes cannot survive it (a
// PhysicsNode is bound to a body tag and the old chassis body dies with the old
// constraint), which is why the garage detaches the cameras around a rebuild.

import { held, setHeld, setRespawnHandler, makeSteering } from "/app/input.js";

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

/**
 * Tire presets — the per-wheel friction demo, front axle and rear axle tuned
 * separately because that split is what changes the car's BALANCE rather than
 * just its overall grip.
 *
 * The scalars multiply Jolt's default slip curves: longitudinal rides the
 * slip-ratio curve ((0,0)(0.06,1.2)(0.2,1.0)) and lateral the slip-angle curve
 * ((0,3)(3,1.2)(20,1.0)). They then multiply again against the friction of the
 * BODY under the wheel, which is how the track's ice patch and these presets
 * compound: ice tyres on the ice patch is 0.20 x 0.06.
 *
 * `drift` is the interesting one. It does not reduce grip overall — it takes
 * lateral grip off the REAR axle only and adds a little to the front, which is
 * the textbook oversteer setup: the front bites, the rear lets go, and the car
 * rotates instead of understeering off the outside of the corner.
 */
export const TIRE_PRESETS = {
    tarmac: {
        label: 'Tarmac',
        hint: 'Baseline racing rubber. Grip is even front to rear; the car understeers gently at the limit.',
        front: { longitudinal: 1.15, lateral: 0.88 },
        rear:  { longitudinal: 1.15, lateral: 0.88 },
    },
    wet: {
        label: 'Wet',
        hint: 'Standing water. Everything is down about 40% — it accelerates, brakes and turns worse, but stays balanced.',
        front: { longitudinal: 0.62, lateral: 0.54 },
        rear:  { longitudinal: 0.62, lateral: 0.54 },
    },
    ice: {
        label: 'Ice',
        hint: 'Winter tyres on a frozen lake. Barely any grip in either direction: the wheels light up and the car goes where it was already pointing.',
        front: { longitudinal: 0.22, lateral: 0.20 },
        rear:  { longitudinal: 0.22, lateral: 0.20 },
    },
    drift: {
        label: 'Drift',
        hint: 'Rear lateral grip cut to a third with the front left alone. Same total grip, wildly different balance — the rear steps out and the car rotates.',
        front: { longitudinal: 1.15, lateral: 1.02 },
        rear:  { longitudinal: 1.15, lateral: 0.30 },
    },
};

export const TIRE_ORDER = ['tarmac', 'wet', 'ice', 'drift'];

// Re-exported so chunk 1's callers (and the smoke test) keep working now that
// the action table itself has moved into the shared input module.
export { ACTIONS } from "/app/input.js";

/**
 * Build the car: vehicle constraint, visual chassis, four visual wheels, and
 * the input plumbing.
 * @param {Object} scene   scene context
 * @param {Object} spawn   { position:{x,y,z}, rotation:{x,y,z,w} } from the track
 */
export function createCar(scene, spawn) {
    // Everything that a tire-preset rebuild replaces lives in these `let`s; the
    // handle returned at the bottom reads them through getters, so its identity
    // is stable across rebuilds.
    let vehicle = null;
    let chassisNode = null;
    let wheelNodes = [];
    let tirePreset = 'tarmac';

    const steering = makeSteering(2.6, 5.0);

    // Teleporting the chassis zeroes the BODY, but the drivetrain is separate
    // state: the wheels keep spinning, the engine keeps its revs and the auto
    // box keeps its gear, so a car "respawned" mid-lap would sit on the line
    // with 5000 rpm and wheelspin. This holds full brake and handbrake for a
    // moment after a respawn to spin everything back down to idle, which also
    // makes repeated runs from the line start from identical state.
    let settle = 0;
    const SETTLE_TIME = 0.6;

    // Rollover is geometry, not luck. The tip threshold is (half wheel track) /
    // (CoM height above the contact patch); with the wheels attached at y=-0.05
    // on 0.30 m of travel and a 0.35 m tyre, the patch sits ~0.62 m below the
    // chassis centre against a 0.88 m half-track — about 1.4 g, comfortably
    // above the ~1.0 g the tyres can generate. The first draft attached the
    // wheels at -0.30 on 0.30 m of travel: a 1.13 m CoM height on a 0.78 m
    // half-track, i.e. 0.9 g, and the car rolled onto its door in every fast
    // corner instead of sliding.
    function wheel(x, z, grip, extra) {
        return Object.assign({
            position: { x, y: 0.0, z },
            radius: WHEEL_RADIUS,
            width: WHEEL_WIDTH,
            suspensionMinLength: SUSP_MIN,
            suspensionMaxLength: SUSP_MAX,
            suspensionFrequency: 1.9,
            suspensionDamping: 0.55,
            // The per-wheel tire-friction demo. These two scalars are the ONLY
            // difference between the presets — no code path anywhere else in
            // the app changes with the preset.
            longitudinalFriction: grip.longitudinal,
            lateralFriction: grip.lateral,
        }, extra);
    }

    /** Construct the constraint and all its visuals at a given pose. */
    function build(pose, presetName) {
        const preset = TIRE_PRESETS[presetName] || TIRE_PRESETS.tarmac;
        tirePreset = presetName in TIRE_PRESETS ? presetName : 'tarmac';

        vehicle = Physics.createVehicle({
            chassis: {
                shape: 'box',
                halfExtents: CHASSIS,
                position: pose.position,
                rotation: pose.rotation,
                density: CHASSIS_DENSITY,
                friction: 0.35,
                restitution: 0.1,
            },
            // A righting torque past 60° of pitch/roll. A showcase car that
            // lands on its roof and stays there is a showcase of nothing, and
            // Jolt's own vehicle sample uses the same clamp. Note this is a
            // LIMIT, not stability: the geometry above is what keeps the car down.
            maxPitchRollAngle: 60,
            collisionTester: 'cylinder',
            wheels: [
                // Front left / front right — steer, brake, no drive.
                wheel(-0.88,  1.46, preset.front, { steerable: true, maxSteerAngle: 32, maxBrakeTorque: 3200 }),
                wheel( 0.88,  1.46, preset.front, { steerable: true, maxSteerAngle: 32, maxBrakeTorque: 3200 }),
                // Rear left / rear right — driven, and the handbrake lives here.
                wheel(-0.88, -1.46, preset.rear, { driven: true, maxBrakeTorque: 1600, maxHandBrakeTorque: 7000 }),
                wheel( 0.88, -1.46, preset.rear, { driven: true, maxBrakeTorque: 1600, maxHandBrakeTorque: 7000 }),
            ],
            // 520 N·m through 3.50:1 first and a 3.42 final drive is ≈12 m/s² of
            // launch thrust. The wheelie limit is g x halfWheelbase / CoMheight =
            // 9.81 x 1.46 / 0.65 ≈ 22 m/s², so the front stays down with margin.
            engine: { maxTorque: 520, minRPM: 900, maxRPM: 7000 },
            transmission: {
                mode: 'auto',
                // Overall first-gear ratio is 3.50 x 3.42 = 12.0:1, which tops
                // out near 68 km/h on a 0.35 m tyre at the 6200 rpm shift point.
                // Gearing this tall enough to matter: at 7.5:1 it never left first.
                gearRatios: [3.50, 2.30, 1.65, 1.25, 1.00],
                reverseGearRatios: [-2.90],
                switchTime: 0.32,
                clutchStrength: 12,
                shiftUpRPM: 6200,
                shiftDownRPM: 2600,
            },
            // One differential across the rear axle, moderately limited-slip so
            // a wheel on the ice patch cannot take all the torque.
            differentials: [
                { leftWheel: 2, rightWheel: 3, ratio: 3.42, leftRightSplit: 0.5,
                  limitedSlipRatio: 1.4, engineTorqueRatio: 1.0 },
            ],
            antiRollBars: [
                { leftWheel: 0, rightWheel: 1, stiffness: 1200 },
                { leftWheel: 2, rightWheel: 3, stiffness: 900 },
            ],
        });

        // --- Visuals ---------------------------------------------------------
        // pixelsPerUnit: 1 is the 3D convention — the physics node's transform
        // is world units, not the 2D pixel mapping the default assumes.
        chassisNode = scene.createPhysicsNode({
            name: 'carChassis', body: vehicle.chassisBody, pixelsPerUnit: 1, autoSync: true,
        });

        chassisNode.add(scene.createMesh({
            name: 'carBody', mesh: 'box',
            halfW: CHASSIS.x, halfH: CHASSIS.y, halfD: CHASSIS.z,
            color: '#c8452e', metallic: 0.55, roughness: 0.32,
        }));
        // Cabin and nose are cosmetic children of the same node, so they ride
        // the chassis for free and make the heading obvious from any camera.
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

        wheelNodes = [];
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
    }

    build(spawn, tirePreset);

    /** Push this frame's driver input into the constraint. */
    function applyInput(dt) {
        if (settle > 0) {
            settle -= dt;
            steering.reset();
            vehicle.setInput({ forward: 0, right: 0, brake: 1, handBrake: 1 });
            return;
        }
        const steer = steering.step(dt);

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

    /** Hold everything still — what the garage does to a parked vehicle. */
    function idle() {
        steering.reset();
        vehicle.setInput({ forward: 0, right: 0, brake: 1, handBrake: 1 });
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
     *
     * `grip` carries the friction scalars the wheel was BUILT with, so the HUD
     * can show the preset's effect per wheel next to the slip it produces.
     */
    function telemetry() {
        const st = vehicle.getState();
        const preset = TIRE_PRESETS[tirePreset];
        const speed = st.speed;
        const wheels = [];
        for (let i = 0; i < vehicle.wheelCount; i++) {
            const ws = vehicle.wheelState(i);
            if (!ws) continue;
            const grip = i < 2 ? preset.front : preset.rear;
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
                grip,
            });
        }
        return {
            kind: 'car',
            speed, kmh: speed * 3.6, rpm: st.rpm, gear: st.gear,
            switching: st.isSwitchingGear, steer: steering.value, wheels,
            tirePreset, tireLabel: preset.label,
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
        steering.reset();
        settle = SETTLE_TIME;
    }

    /** Current world pose, used to rebuild the car exactly where it stands. */
    function pose() {
        const t = Physics.getTransform(vehicle.chassisBody);
        return {
            position: { x: t.position.x, y: t.position.y, z: t.position.z },
            rotation: { x: t.rotation.x, y: t.rotation.y, z: t.rotation.z, w: t.rotation.w },
        };
    }

    /**
     * Swap tyres. Because friction is create-time, this destroys the constraint
     * and its visuals and builds a fresh set at the same pose — the wrapper
     * object survives, the scene nodes do not. The caller (the garage) is
     * responsible for detaching anything parented to chassisNode first.
     */
    function setTirePreset(name) {
        if (!(name in TIRE_PRESETS) || name === tirePreset) return false;
        const where = pose();
        chassisNode.destroy();
        vehicle.destroy();
        build(where, name);
        // Same reasoning as respawn: the new drivetrain starts at idle, so give
        // it the settle window rather than dropping a running car onto the road.
        settle = SETTLE_TIME;
        return true;
    }

    /** True while a respawn is still spinning the drivetrain down. */
    function isSettling() { return settle > 0; }

    // CHUNK 3: spatial audio — attach an engine-note emitter to chassisNode and
    // drive its playbackRate from telemetry().rpm; scene.bindAudioListenerToCamera
    // then gives Doppler on the trackside camera for free.

    return {
        kind: 'car',
        label: 'Car',
        // Camera geometry differs per vehicle; the rig travels with the vehicle
        // so cameras.js never has to know what it is looking at.
        camRig: { chase: [0, 3.1, -8.4], chasePitch: -11, bonnet: [0, 1.02, 0.55], bonnetPitch: -3 },
        hint: 'Rear-wheel drive, five-speed automatic, limited-slip diff. Steers with the front wheels — it needs road speed to change direction.',
        get vehicle() { return vehicle; },
        get chassisNode() { return chassisNode; },
        get wheelNodes() { return wheelNodes; },
        get tirePreset() { return tirePreset; },
        held,
        applyInput,
        idle,
        syncWheels,
        telemetry,
        respawn,
        pose,
        setTirePreset,
        isSettling,
        setHeld,
        setRespawnHandler,
        get steerInput() { return steering.value; },
        WHEEL_RADIUS, SUSP_MIN, SUSP_MAX,
    };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
