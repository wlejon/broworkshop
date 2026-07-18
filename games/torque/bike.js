// bike.js — a motorcycle: Jolt's MotorcycleController, and one toggle.
//
// A two-wheeler is the wheeled controller plus a LEAN SPRING: a torque applied
// about the chassis' forward axis that drives the bike toward the roll angle
// its current speed and steering actually require. That single addition is what
// makes a two-wheeled vehicle rideable at all, and it is invisible when it is
// working — a bike that stays up looks like nothing is happening.
//
// So this module exists to make it visible by taking it AWAY. setLeanController
// (false) leaves everything else identical — same chassis, same wheels, same
// engine, same rider input — and the bike falls over in the first corner. One
// HUD switch, run the same corner twice, and the difference is the feature.
//
// Spring strength is left on AUTO. bro scales the constant and damping to the
// chassis' real roll inertia (k = 150·I, c = 30·I); Jolt's raw sample numbers
// (5000/1000) assume that sample's offset centre of mass and will shake a
// uniform-density chassis to pieces. `lean.maxAngle` is the only knob touched.

import { held, strength, setHeld, setRespawnHandler, makeSteering, rollDegrees } from "/app/input.js";

// A slim chassis at a high density: ≈ 240 kg over 0.30 m³, which is a big road
// bike with a rider on it. The box is small because the mass should sit low and
// central — the visible bodywork below is cosmetic children, not collision.
const CHASSIS = { x: 0.22, y: 0.34, z: 0.50 };
const CHASSIS_DENSITY = 800;              // ≈ 240 kg
const WHEEL_RADIUS = 0.33;
const WHEEL_WIDTH = 0.12;
const WHEELBASE = 0.78;                   // ± from the chassis centre
const MAX_LEAN = 45;                      // degrees the spring is allowed to ask for

/**
 * Build the motorcycle.
 * @param {Object} scene  scene context
 * @param {Object} spawn  { position, rotation } — the shared start point
 */
export function createBike(scene, spawn) {
    const vehicle = Physics.createVehicle({
        type: 'motorcycle',
        chassis: {
            shape: 'box',
            halfExtents: CHASSIS,
            position: spawn.position,
            rotation: spawn.rotation,
            density: CHASSIS_DENSITY,
            friction: 0.4,
            restitution: 0.05,
        },
        // 60° is deliberately generous for a bike: the lean spring routinely
        // asks for 35-40° in a fast corner, and clamping tighter than that would
        // fight the very feature this module demonstrates. It also means a
        // fallen bike stops at 60° instead of lying flat, which keeps the
        // "lean off" failure legible rather than just dumping it on its side.
        maxPitchRollAngle: 60,
        collisionTester: 'cylinder',
        wheels: [
            // Front: steers, on a 30° caster (suspensionDirection raked back).
            // The rake is not decoration — trail is what makes a bike's steering
            // self-centering, and without it the lean controller has nothing
            // stable to steer against.
            { position: { x: 0, y: -0.26, z: WHEELBASE },
              radius: WHEEL_RADIUS, width: WHEEL_WIDTH,
              suspensionDirection: { x: 0, y: -1, z: 0.577 },   // tan(30°)
              suspensionMinLength: 0.14, suspensionMaxLength: 0.36,
              suspensionFrequency: 1.5, suspensionDamping: 0.5,
              steerable: true, maxSteerAngle: 30,
              maxBrakeTorque: 900,
              longitudinalFriction: 1.1, lateralFriction: 1.05 },
            // Rear: driven, and where the handbrake bites.
            { position: { x: 0, y: -0.26, z: -WHEELBASE },
              radius: WHEEL_RADIUS, width: WHEEL_WIDTH,
              suspensionMinLength: 0.14, suspensionMaxLength: 0.38,
              suspensionFrequency: 2.0, suspensionDamping: 0.55,
              driven: true, maxBrakeTorque: 500, maxHandBrakeTorque: 1400,
              longitudinalFriction: 1.1, lateralFriction: 1.05 },
        ],
        engine: { maxTorque: 150, minRPM: 1000, maxRPM: 10000 },
        transmission: {
            mode: 'auto',
            gearRatios: [2.27, 1.63, 1.30, 1.09, 0.96, 0.88],
            reverseGearRatios: [-4],
            switchTime: 0.18,
            clutchStrength: 2,
            shiftUpRPM: 8000,
            shiftDownRPM: 2000,
        },
        lean: { maxAngle: MAX_LEAN },
    });

    // bro exposes no getter for the lean controller's state, so track it here.
    // It starts ON, which is the rideable configuration.
    let leanEnabled = true;
    vehicle.setLeanController(true);

    // --- Visuals -------------------------------------------------------------
    // The bike is 44 cm wide and the entire demonstration is how far it is
    // tilted, so the silhouette has to carry roll from a chase camera. A rider
    // figure does more for that than any amount of detail on the machine.

    const chassisNode = scene.createPhysicsNode({
        name: 'bikeChassis', body: vehicle.chassisBody, pixelsPerUnit: 1, autoSync: true,
    });

    chassisNode.add(scene.createMesh({          // frame / engine mass
        name: 'bikeBody', mesh: 'box',
        halfW: CHASSIS.x, halfH: CHASSIS.y, halfD: CHASSIS.z,
        color: '#1f242a', metallic: 0.5, roughness: 0.45,
    }));
    chassisNode.add(scene.createMesh({          // fuel tank
        mesh: 'box', halfW: 0.20, halfH: 0.15, halfD: 0.34,
        y: 0.44, z: 0.16, color: '#d2402f', metallic: 0.7, roughness: 0.22,
    }));
    chassisNode.add(scene.createMesh({          // seat + tail
        mesh: 'box', halfW: 0.16, halfH: 0.08, halfD: 0.40,
        y: 0.46, z: -0.42, color: '#15181b', roughness: 0.8,
    }));
    chassisNode.add(scene.createMesh({          // front fairing / screen
        mesh: 'box', halfW: 0.19, halfH: 0.20, halfD: 0.10,
        y: 0.58, z: 0.62, rx: -18, color: '#d2402f', metallic: 0.6, roughness: 0.25,
    }));
    chassisNode.add(scene.createMesh({          // headlight
        mesh: 'box', halfW: 0.13, halfH: 0.08, halfD: 0.06,
        y: 0.34, z: 0.72, color: '#f5f1d8', emissive: 1.5, roughness: 0.3,
    }));
    chassisNode.add(scene.createMesh({          // handlebars
        mesh: 'box', halfW: 0.34, halfH: 0.035, halfD: 0.035,
        y: 0.70, z: 0.50, color: '#9aa2ac', metallic: 0.8, roughness: 0.3,
    }));
    // Forks, raked to match the front wheel's suspension direction.
    for (const side of [-1, 1]) {
        chassisNode.add(scene.createMesh({
            mesh: 'cylinder', radius: 0.035, halfHeight: 0.40, segments: 10,
            x: side * 0.11, y: 0.24, z: 0.60, rx: -30,
            color: '#b9c0c8', metallic: 0.85, roughness: 0.2,
        }));
    }
    // Rider: torso, head, and legs. Fixed to the chassis on purpose — the rider
    // leans WITH the bike, which is what makes a 40° lean angle read as a 40°
    // lean angle instead of as a camera roll.
    chassisNode.add(scene.createMesh({
        mesh: 'box', halfW: 0.17, halfH: 0.30, halfD: 0.16,
        y: 0.86, z: -0.10, rx: 22, color: '#2b3f6b', roughness: 0.7,
    }));
    chassisNode.add(scene.createMesh({          // helmet
        mesh: 'sphere', radius: 0.16, segments: 16,
        y: 1.26, z: 0.16, color: '#e8ecf1', metallic: 0.3, roughness: 0.25,
    }));
    for (const side of [-1, 1]) {
        chassisNode.add(scene.createMesh({      // thighs
            mesh: 'box', halfW: 0.09, halfH: 0.09, halfD: 0.24,
            x: side * 0.17, y: 0.50, z: -0.14, color: '#2b3f6b', roughness: 0.7,
        }));
        chassisNode.add(scene.createMesh({      // arms, reaching to the bars
            mesh: 'box', halfW: 0.055, halfH: 0.055, halfD: 0.30,
            x: side * 0.20, y: 0.82, z: 0.24, rx: -12, color: '#2b3f6b', roughness: 0.7,
        }));
    }

    const wheelNodes = [];
    for (let i = 0; i < vehicle.wheelCount; i++) {
        const n = scene.createMesh({
            name: `bikeWheel${i}`, mesh: 'cylinder',
            radius: WHEEL_RADIUS, halfHeight: WHEEL_WIDTH / 2, segments: 22,
            color: '#141618', roughness: 0.92,
        });
        for (const side of [-1, 1]) {
            n.add(scene.createMesh({            // brake disc, doubles as a spin mark
                mesh: 'box', halfW: 0.035, halfH: 0.005, halfD: WHEEL_RADIUS * 0.66,
                y: side * (WHEEL_WIDTH / 2 + 0.004),
                color: '#c3cad3', metallic: 0.85, roughness: 0.25,
            }));
        }
        chassisNode.add(n);
        wheelNodes.push(n);
    }

    // --- Control -------------------------------------------------------------

    const steering = makeSteering(2.2, 4.2);
    let settle = 0;
    const SETTLE_TIME = 0.6;

    function applyInput(dt) {
        if (settle > 0) {
            settle -= dt;
            steering.reset();
            vehicle.setInput({ forward: 0, right: 0, brake: 1, handBrake: 1 });
            return;
        }
        const steer = steering.step(dt);

        // Analog throttle and brake, same rule as the car: strength() for the
        // amount, the digital state for the brake-or-reverse decision.
        const speed = vehicle.speed;
        let forward = strength('throttle');
        let brake = 0;
        if (held.brake) {
            const pedal = strength('brake');
            if (speed > 0.8) { brake = pedal; forward = 0; }
            else { forward = -pedal; }
        }
        if (forward === 0 && brake === 0 && !held.handbrake && Math.abs(speed) < 0.6) {
            brake = 1;
        }

        vehicle.setInput({
            forward, right: steer, brake,
            handBrake: strength('handbrake'),
        });
    }

    function idle() {
        steering.reset();
        vehicle.setInput({ forward: 0, right: 0, brake: 1, handBrake: 1 });
    }

    function syncWheels() {
        for (let i = 0; i < vehicle.wheelCount; i++) {
            const ws = vehicle.wheelState(i);
            if (!ws) continue;
            wheelNodes[i].position = [ws.position.x, ws.position.y, ws.position.z];
            wheelNodes[i].quaternion = [ws.rotation.x, ws.rotation.y, ws.rotation.z, ws.rotation.w];
        }
    }

    /**
     * Telemetry. `leanDeg` is the headline: signed chassis roll in degrees,
     * positive leaning right. With the controller on it tracks the corner and
     * settles back to zero on the straights; with it off it runs away to the
     * 60° pitch/roll clamp and stays there.
     */
    function telemetry() {
        const st = vehicle.getState();
        const speed = st.speed;
        const leanDeg = rollDegrees(chassisNode);
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
                compression: clamp01((0.38 - ws.suspensionLength) / (0.38 - 0.14)),
                steerDeg: ws.steerAngle * 180 / Math.PI,
                spin: ws.rotationAngle,
                angularVelocity: ws.angularVelocity,
                slip: (surfaceSpeed - speed) / denom,
            });
        }
        return {
            kind: 'bike',
            speed, kmh: speed * 3.6, rpm: st.rpm, gear: st.gear,
            switching: st.isSwitchingGear, steer: steering.value, wheels,
            leanDeg,
            leanEnabled,
            fallen: Math.abs(leanDeg) > 35,
        };
    }

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

    /** The showpiece switch. Nothing else about the bike changes. */
    function setLean(on) {
        leanEnabled = !!on;
        vehicle.setLeanController(leanEnabled);
        return leanEnabled;
    }

    function isSettling() { return settle > 0; }

    return {
        kind: 'bike',
        label: 'Bike',
        // Lower and closer than the car's — a bike is small, and the lean angle
        // is only readable if it fills a reasonable part of the frame.
        camRig: { chase: [0, 2.2, -5.6], chasePitch: -9, bonnet: [0, 1.25, 0.45], bonnetPitch: -4 },
        hint: 'Two wheels, held up by a <b>lean spring</b> that torques the chassis into the corner. Switch it off and the same corner puts the bike on its side.',
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
        setLean,
        get leanEnabled() { return leanEnabled; },
        get steerInput() { return steering.value; },
        WHEEL_RADIUS,
    };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
