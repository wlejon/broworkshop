// tank.js — a tracked vehicle: Jolt's TrackedVehicleController.
//
// A tank is not a car with wide wheels. The controller is a different family
// with a different idea of what steering IS: there are no steered wheels and no
// differential, there are two TRACKS, each with its own drivetrain connection
// and brake, and you turn by running them at different rates. Everything else —
// chassis, suspension geometry, engine, gearbox, wheelState — carries over from
// the wheeled controller unchanged, which is exactly what makes the comparison
// worth putting in the same app.
//
// Track layout, verified against the runtime rather than assumed: chassis
// forward is +Z and up is +Y, so the vehicle's LEFT is +X (cross(up, forward) =
// Y x Z = +X). tracks[0] is therefore the +X row of road wheels and tracks[1]
// the -X row, `leftRatio` drives tracks[0] and `rightRatio` drives tracks[1],
// and `right: +1` reverses the -X track to pivot right — the same sign
// convention as the car's steering, so one steering integrator serves both.
//
// THE HANDLING CONTRAST is the point. Against the car: roughly five times the
// mass, a third of the top speed, no steering geometry at all, and — the thing
// no car can do — a neutral turn, spinning on its own centre with the tracks
// counter-rotating. The smoke test measures exactly that: heading changes by
// more than a radian while the hull moves less than its own length.

import { held, strength, setHeld, setRespawnHandler, makeSteering, rollDegrees } from "/app/input.js";

// The hull is narrower than the track centreline on purpose, and it is the same
// trap the car hit: at halfW 1.5 against a 1.42 track the road wheels and the
// belts sat INSIDE the hull box and were invisible from every camera, which
// rather undercuts a vehicle whose whole story is what its tracks are doing.
// At 1.15 the running gear stands proud of the hull and the belts read.
const HULL = { x: 1.15, y: 0.5, z: 2.6 };  // half-extents, metres
const HULL_DENSITY = 650;                  // ≈ 7800 kg for that box
const WHEEL_RADIUS = 0.38;
const WHEEL_WIDTH = 0.26;
const WHEELS_PER_SIDE = 5;
const TRACK_X = 1.42;                     // road-wheel centreline, each side
const WHEEL_Y = -0.34;                    // suspension attachment height
const WHEEL_Z0 = 1.85, WHEEL_DZ = 0.95;   // front wheel, spacing back from it

// Generous travel for the same reason the car needs it: the road is a faceted
// ribbon, and a tank that skips over the facets looks like a bug rather than
// like 7.8 tonnes. Soft and heavily damped — a tank wallows, it does not bounce.
const SUSP_MIN = 0.15, SUSP_MAX = 0.48;

/**
 * Build the tank.
 * @param {Object} scene  scene context
 * @param {Object} spawn  { position, rotation } — the shared start point
 */
export function createTank(scene, spawn) {
    // Road-wheel positions: tracks[0] (+X, the vehicle's left) first, then
    // tracks[1] (-X). The track arrays below index into this order.
    const wheels = [];
    for (const side of [1, -1]) {
        for (let i = 0; i < WHEELS_PER_SIDE; i++) {
            wheels.push({
                position: { x: side * TRACK_X, y: WHEEL_Y, z: WHEEL_Z0 - i * WHEEL_DZ },
                radius: WHEEL_RADIUS,
                width: WHEEL_WIDTH,
                suspensionMinLength: SUSP_MIN,
                suspensionMaxLength: SUSP_MAX,
                suspensionFrequency: 1.15,
                suspensionDamping: 0.75,
                // On a tracked vehicle these are plain SCALARS against Jolt's
                // track defaults (4.0 longitudinal, 2.0 lateral) — there are no
                // slip curves, because Jolt models the track's terrain grip per
                // road wheel instead. Held at 1.0: a tank's problem is never
                // grip, it is mass, and the app's friction demo lives on the car.
                longitudinalFriction: 1.0,
                lateralFriction: 1.0,
            });
        }
    }

    const vehicle = Physics.createVehicle({
        type: 'tracked',
        chassis: {
            shape: 'box',
            halfExtents: HULL,
            position: spawn.position,
            rotation: spawn.rotation,
            density: HULL_DENSITY,
            friction: 0.6,
            restitution: 0.05,
        },
        maxPitchRollAngle: 60,
        collisionTester: 'cylinder',
        wheels,
        tracks: [
            { wheels: [0, 1, 2, 3, 4], inertia: 26, angularDamping: 0.6,
              maxBrakeTorque: 32000, differentialRatio: 6 },   // left  (+X)
            { wheels: [5, 6, 7, 8, 9], inertia: 26, angularDamping: 0.6,
              maxBrakeTorque: 32000, differentialRatio: 6 },   // right (-X)
        ],
        // Deliberately slow. Top gear is 1.5 x 6 = 9:1, which on a 0.38 m wheel
        // at 3200 rpm tops out near 14 m/s — about 50 km/h, a third of what the
        // car will do. 900 N·m through 4.5 x 6 = 27:1 in first is ~65 kN at the
        // track, which shifts 7.8 tonnes at a believable 8 m/s².
        engine: { maxTorque: 900, minRPM: 500, maxRPM: 3200 },
        transmission: {
            mode: 'auto',
            gearRatios: [4.5, 2.6, 1.5],
            reverseGearRatios: [-4.0],
            switchTime: 0.6,        // a tank's box is not a quick-shifting DCT
            clutchStrength: 14,
            shiftUpRPM: 2900,
            shiftDownRPM: 1100,
        },
        antiRollBars: [
            { leftWheel: 2, rightWheel: 7, stiffness: 2600 },
        ],
    });

    // --- Visuals -------------------------------------------------------------

    const chassisNode = scene.createPhysicsNode({
        name: 'tankHull', body: vehicle.chassisBody, pixelsPerUnit: 1, autoSync: true,
    });

    // Hull, glacis plate, turret and barrel. The turret and barrel are not
    // decoration: a box that pivots on the spot with no visible front end is
    // impossible to read, and the barrel is what makes the neutral turn legible.
    chassisNode.add(scene.createMesh({
        name: 'tankBody', mesh: 'box',
        halfW: HULL.x, halfH: HULL.y, halfD: HULL.z,
        color: '#4a5340', metallic: 0.35, roughness: 0.72,
    }));
    chassisNode.add(scene.createMesh({          // sloped glacis, front
        mesh: 'box', halfW: HULL.x * 0.92, halfH: 0.30, halfD: 0.70,
        y: 0.42, z: 1.75, rx: 34,
        color: '#535d47', metallic: 0.35, roughness: 0.70,
    }));
    const turret = scene.createMesh({
        name: 'tankTurret', mesh: 'cylinder',
        radius: 1.05, halfHeight: 0.34, segments: 22,
        y: 0.84, z: -0.35,
        color: '#59634c', metallic: 0.4, roughness: 0.65,
    });
    chassisNode.add(turret);
    turret.add(scene.createMesh({               // barrel, pointing forward (+Z)
        mesh: 'cylinder', radius: 0.13, halfHeight: 1.75, segments: 14,
        z: 1.75, y: 0.05, rx: 90,
        color: '#3c4436', metallic: 0.55, roughness: 0.5,
    }));
    chassisNode.add(scene.createMesh({          // commander's cupola
        mesh: 'cylinder', radius: 0.34, halfHeight: 0.16, segments: 14,
        y: 1.32, z: -0.75, color: '#3c4436', roughness: 0.6,
    }));

    // Road wheels, driven from the constraint exactly like the car's.
    const wheelNodes = [];
    for (let i = 0; i < vehicle.wheelCount; i++) {
        const n = scene.createMesh({
            name: `roadWheel${i}`, mesh: 'cylinder',
            radius: WHEEL_RADIUS, halfHeight: WHEEL_WIDTH / 2, segments: 16,
            color: '#26292c', roughness: 0.9,
        });
        // A hub cap on the outboard face, for the same reason the car's wheels
        // have spokes: a cylinder of revolution shows no rotation without a mark.
        const outboard = i < WHEELS_PER_SIDE ? 1 : -1;
        n.add(scene.createMesh({
            mesh: 'box', halfW: 0.05, halfH: 0.008, halfD: WHEEL_RADIUS * 0.75,
            y: outboard * (WHEEL_WIDTH / 2 + 0.005),
            color: '#9aa2ac', metallic: 0.7, roughness: 0.35,
        }));
        chassisNode.add(n);
        wheelNodes.push(n);
    }

    // --- Track belts ---------------------------------------------------------
    // The road wheels are simulated; the belt around them is not, so it is
    // animated from the one number that makes it honest — the driven wheel's own
    // angular velocity. Each belt is a ring of link boxes walked along a closed
    // loop path (bottom run, up the back, top run, down the front) by arc
    // length. Scroll the arc offset at the track's real linear speed and the
    // links move exactly as fast as the ground passes underneath, which is what
    // makes a neutral turn read: one belt runs forward, the other runs backward.

    const BELT_BOTTOM = WHEEL_Y - WHEEL_RADIUS;
    const BELT_TOP = WHEEL_Y + WHEEL_RADIUS;
    const BELT_FRONT = WHEEL_Z0 + 0.42;
    const BELT_REAR = WHEEL_Z0 - (WHEELS_PER_SIDE - 1) * WHEEL_DZ - 0.42;
    const RUN = BELT_FRONT - BELT_REAR;               // straight run length
    const RISE = BELT_TOP - BELT_BOTTOM;              // end-to-end climb
    const LOOP = 2 * RUN + 2 * RISE;
    const LINK_SPACING = 0.34;
    const LINK_COUNT = Math.round(LOOP / LINK_SPACING);

    /** Chassis-local point at arc distance `s` around the belt loop. */
    function beltPoint(s) {
        let d = ((s % LOOP) + LOOP) % LOOP;
        if (d < RUN) return { z: BELT_FRONT - d, y: BELT_BOTTOM };          // bottom, running back
        d -= RUN;
        if (d < RISE) return { z: BELT_REAR, y: BELT_BOTTOM + d };          // up the back
        d -= RISE;
        if (d < RUN) return { z: BELT_REAR + d, y: BELT_TOP };              // top, running forward
        d -= RUN;
        return { z: BELT_FRONT, y: BELT_TOP - d };                          // down the front
    }

    const belts = [];   // belts[0] = left (+X, tracks[0]), belts[1] = right
    for (const side of [1, -1]) {
        const links = [];
        for (let k = 0; k < LINK_COUNT; k++) {
            const n = scene.createMesh({
                mesh: 'box', halfW: WHEEL_WIDTH * 0.78, halfH: 0.055, halfD: LINK_SPACING * 0.42,
                x: side * TRACK_X,
                color: k % 3 === 0 ? '#31363b' : '#1e2225',   // every third link lighter,
                metallic: 0.5, roughness: 0.75,               // so motion is visible
            });
            chassisNode.add(n);
            links.push(n);
        }
        belts.push({ links, offset: 0 });
    }

    // --- Control -------------------------------------------------------------

    const steering = makeSteering(2.0, 3.6);   // slower than the car's rack
    let settle = 0;
    const SETTLE_TIME = 0.6;
    let neutralTurn = false;                   // last frame's pivot state, for the HUD

    /**
     * Skid steering. Two paths, and the difference between them is the whole
     * tracked-vehicle story:
     *
     *  - Normal driving uses `right`, which Jolt maps onto the track ratios the
     *    way its tank sample does: the inside track slows linearly with steer
     *    input and reverses at full lock.
     *  - Holding the handbrake engages a NEUTRAL TURN, which no car can do:
     *    the tracks are commanded to equal and opposite ratios explicitly, so
     *    the hull spins about its own centre whether or not there is any
     *    throttle. `forward: 1` here is drive to the tracks, not a request to
     *    travel forwards — with the ratios opposed it cancels out.
     */
    function applyInput(dt) {
        if (settle > 0) {
            settle -= dt;
            steering.reset();
            neutralTurn = false;
            vehicle.setInput({ forward: 0, right: 0, brake: 1, leftRatio: 1, rightRatio: 1 });
            return;
        }
        const steer = steering.step(dt);

        if (held.handbrake && Math.abs(steer) > 0.02) {
            neutralTurn = true;
            const dir = Math.sign(steer);
            // leftRatio drives tracks[0] (+X, the left side); pivoting right
            // means the left track forward and the right track reversed.
            vehicle.setInput({ forward: 1, brake: 0, leftRatio: dir, rightRatio: -dir });
            return;
        }
        neutralTurn = false;

        // Analog on the tracks too: a tank driver's throttle is a foot pedal,
        // and half a trigger is a genuinely useful creeping pace for something
        // that has to place itself on a ramp.
        const speed = vehicle.speed;
        let forward = strength('throttle');
        let brake = 0;
        if (held.brake) {
            const pedal = strength('brake');
            if (speed > 0.6) { brake = pedal; forward = 0; }
            else { forward = -pedal; }
        }
        // Same creep problem as the car's automatic, and a 7.8 t vehicle
        // creeping is worse. Stand on the brake when stopped and unattended.
        if (forward === 0 && brake === 0 && Math.abs(speed) < 0.5) brake = 1;
        // Holding the handbrake with no steer input is just a parking brake.
        if (held.handbrake) { brake = 1; forward = 0; }

        vehicle.setInput({ forward, right: steer, brake, leftRatio: 1, rightRatio: 1 });
    }

    /** Hold everything still — what the garage does to a parked vehicle. */
    function idle() {
        steering.reset();
        neutralTurn = false;
        vehicle.setInput({ forward: 0, right: 0, brake: 1, leftRatio: 1, rightRatio: 1 });
    }

    /** Linear speed of a track, from its driven road wheel. */
    function trackSpeed(which) {
        // drivenWheel defaults to the LAST wheel listed in the track, so wheel 4
        // for the left track and wheel 9 for the right.
        const ws = vehicle.wheelState(which === 0 ? 4 : 9);
        return ws ? ws.angularVelocity * WHEEL_RADIUS : 0;
    }

    /** Road wheels from the constraint; belts animated from track speed. */
    function syncWheels(dt) {
        for (let i = 0; i < vehicle.wheelCount; i++) {
            const ws = vehicle.wheelState(i);
            if (!ws) continue;
            wheelNodes[i].position = [ws.position.x, ws.position.y, ws.position.z];
            wheelNodes[i].quaternion = [ws.rotation.x, ws.rotation.y, ws.rotation.z, ws.rotation.w];
        }
        const step = dt || 0;
        for (let b = 0; b < belts.length; b++) {
            const belt = belts[b];
            // Positive track speed carries the bottom run backwards under the
            // hull, which is the direction beltPoint() walks for increasing s.
            belt.offset += trackSpeed(b) * step;
            const x = (b === 0 ? 1 : -1) * TRACK_X;
            for (let k = 0; k < belt.links.length; k++) {
                const p = beltPoint(belt.offset + k * LINK_SPACING);
                belt.links[k].position = [x, p.y, p.z];
            }
        }
    }

    /**
     * Telemetry. Per-TRACK speed is the reading that matters here — it is the
     * quantity the driver is actually commanding, and watching the two numbers
     * split apart (and go opposite in a neutral turn) is the tracked-vehicle
     * equivalent of watching a rev counter.
     */
    function telemetry() {
        const st = vehicle.getState();
        const speed = st.speed;
        const wheels = [];
        for (let i = 0; i < vehicle.wheelCount; i++) {
            const ws = vehicle.wheelState(i);
            if (!ws) continue;
            wheels.push({
                index: i,
                contact: ws.contact,
                contactBody: ws.contactBody,
                suspensionLength: ws.suspensionLength,
                compression: clamp01((SUSP_MAX - ws.suspensionLength) / (SUSP_MAX - SUSP_MIN)),
                steerDeg: 0,                       // tracked vehicles never steer a wheel
                spin: ws.rotationAngle,
                angularVelocity: ws.angularVelocity,
                slip: 0,
                track: i < WHEELS_PER_SIDE ? 0 : 1,
            });
        }
        const left = trackSpeed(0), right = trackSpeed(1);
        return {
            kind: 'tank',
            speed, kmh: speed * 3.6, rpm: st.rpm, gear: st.gear,
            switching: st.isSwitchingGear, steer: steering.value, wheels,
            tracks: { left, right, split: left - right },
            neutralTurn,
            rollDeg: rollDegrees(chassisNode),
        };
    }

    function respawn(position, rotation) {
        const b = vehicle.chassisBody;
        Physics.setPosition(b, position.x, position.y, position.z);
        Physics.setRotation(b, rotation.x, rotation.y, rotation.z, rotation.w);
        Physics.setLinearVelocity(b, 0, 0, 0);
        Physics.setAngularVelocity(b, 0, 0, 0);
        Physics.activate(b);
        vehicle.setInput({ forward: 0, right: 0, brake: 1, leftRatio: 1, rightRatio: 1 });
        steering.reset();
        settle = SETTLE_TIME;
    }

    function isSettling() { return settle > 0; }

    return {
        kind: 'tank',
        label: 'Tank',
        // Further back and higher than the car's: the hull is twice as wide and
        // the neutral turn is only legible with the whole vehicle in frame.
        camRig: { chase: [0, 5.0, -11.5], chasePitch: -15, bonnet: [0, 1.9, 1.2], bonnetPitch: -5 },
        hint: 'Tracked, ~7.8 t, no steered wheels at all — it turns by running one track faster than the other. Slow, unstoppable, and it can spin on the spot: hold <b>Space</b> with a steer key for a neutral turn.',
        vehicle,
        chassisNode,
        wheelNodes,
        held,
        applyInput,
        idle,
        syncWheels,
        telemetry,
        respawn,
        isSettling,
        setHeld,
        setRespawnHandler,
        trackSpeed,
        get steerInput() { return steering.value; },
        WHEEL_RADIUS, SUSP_MIN, SUSP_MAX, WHEELS_PER_SIDE,
    };
}

/**
 * A modest proving ground for the tank, in the gravel just off the start line.
 *
 * Deliberately NOT a second world: the circuit already has elevation, camber
 * and a low-grip patch, and a tank needs one thing the tarmac cannot show —
 * something to climb and something to shove. Three ramps of increasing angle
 * and a stack of loose crates do that in a corner of the runoff the car can
 * also reach, so the difference between the two vehicles is observed on the
 * same obstacles rather than described.
 *
 * @returns {Object} { ramps, crates } body tags
 */
export function buildProvingGround(scene, world) {
    const ramps = [], crates = [];
    const base = Math.round(world.N * 0.055);         // just past the start line
    const lat = -(world.HALF_WIDTH + world.RUNOFF * 0.55);

    // Ramps: same footprint, increasing pitch. The car bottoms out on the third;
    // the tank walks up all of them.
    [8, 16, 26].forEach((deg, k) => {
        const i = base + k * 7;
        const p = world.edge(i, lat);
        const yaw = world.yawAt(i);
        const rx = deg * Math.PI / 180;
        // Yaw about +Y then pitch about the resulting local X, as a quaternion.
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
        const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
        const rot = { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx };
        const half = { x: 2.4, y: 0.22, z: 2.6 };
        const tag = Physics.createBody({
            shape: 'box', static: true,
            position: { x: p.x, y: p.y + 0.5, z: p.z },
            rotation: rot, halfExtents: half,
            friction: 0.85, restitution: 0.02,
        });
        ramps.push(tag);
        scene.createMesh({
            mesh: 'box', halfW: half.x, halfH: half.y, halfD: half.z,
            x: p.x, y: p.y + 0.5, z: p.z,
            quaternion: [rot.x, rot.y, rot.z, rot.w],
            color: '#6b6357', roughness: 0.9,
        });
    });

    // Crates: light enough that the tank barges through them without noticing
    // and heavy enough that the car does notice.
    const cp = world.edge(base + 24, lat);
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const x = cp.x + (col - 1) * 1.3;
            const z = cp.z + (row - 1) * 1.3;
            const y = cp.y + 0.6 + row * 0.05;
            const tag = Physics.createBody({
                shape: 'box', halfExtents: { x: 0.55, y: 0.55, z: 0.55 },
                position: { x, y, z }, density: 120,     // ≈ 160 kg
                friction: 0.7, restitution: 0.1,
            });
            crates.push(tag);
            const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1, autoSync: true });
            node.add(scene.createMesh({
                mesh: 'box', halfW: 0.55, halfH: 0.55, halfD: 0.55,
                color: (row + col) % 2 ? '#8a6f45' : '#7a6039', roughness: 0.85,
            }));
        }
    }

    return { ramps, crates };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
