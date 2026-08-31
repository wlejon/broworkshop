// contraptions.js — Constructs 5 mechanical machines using Jolt physics joints & constraints.

import {
    createGearMesh, createPulleyMesh, createCylinderSleeveMesh, createPistonHeadMesh,
    createConnectingRodMesh, createSteelSphereMesh, createBridgePlankMesh,
    createPedestalMesh, createDynamicRod
} from "./visuals.js";

// --- Active machine registry & state ---
export const activeBodies = [];
export const activeConstraints = [];
export const activeMeshes = [];
export const activeRods = [];

export let currentMachineType = 'pendulum';
export let brokenConstraintCount = 0;

/**
 * Constraint creation wrappers over Physics.createConstraint
 */
export function createHingeConstraint(opts) {
    return Physics.createConstraint({
        type: 'hinge',
        body1: opts.body1,
        body2: opts.body2 != null ? opts.body2 : -1,
        point1: opts.point1 || opts.point,
        point2: opts.point2 || opts.point,
        axis: opts.axis || { x: 0, y: 0, z: 1 },
        limitMin: opts.limitMin,
        limitMax: opts.limitMax,
        motor: opts.motor,
        breakingImpulse: opts.breakingImpulse
    });
}

export function createSliderConstraint(opts) {
    return Physics.createConstraint({
        type: 'slider',
        body1: opts.body1,
        body2: opts.body2 != null ? opts.body2 : -1,
        point1: opts.point1 || opts.point,
        point2: opts.point2 || opts.point,
        axis: opts.axis || { x: 0, y: 1, z: 0 },
        limitMin: opts.limitMin != null ? opts.limitMin : -10,
        limitMax: opts.limitMax != null ? opts.limitMax : 10,
        motor: opts.motor,
        breakingImpulse: opts.breakingImpulse
    });
}

export function createDistanceConstraint(opts) {
    return Physics.createConstraint({
        type: 'distance',
        body1: opts.body1,
        body2: opts.body2 != null ? opts.body2 : -1,
        point1: opts.point1,
        point2: opts.point2,
        minDistance: opts.minDistance != null ? opts.minDistance : 0,
        maxDistance: opts.maxDistance,
        breakingImpulse: opts.breakingImpulse,
        collideConnected: !!opts.collideConnected
    });
}

export function createPointConstraint(opts) {
    return Physics.createConstraint({
        type: 'point',
        body1: opts.body1,
        body2: opts.body2 != null ? opts.body2 : -1,
        point1: opts.point1 || opts.point,
        point2: opts.point2 || opts.point,
        breakingImpulse: opts.breakingImpulse
    });
}

export function createGearConstraint(opts) {
    return Physics.createConstraint({
        type: 'gear',
        body1: opts.body1,
        body2: opts.body2,
        hingeAxis1: opts.hingeAxis1 || { x: 0, y: 0, z: 1 },
        hingeAxis2: opts.hingeAxis2 || { x: 0, y: 0, z: 1 },
        ratio: opts.ratio != null ? opts.ratio : 1.0,
        constraint1: opts.constraint1,
        constraint2: opts.constraint2
    });
}

export function createPulleyConstraint(opts) {
    return Physics.createConstraint({
        type: 'pulley',
        body1: opts.body1,
        body2: opts.body2,
        bodyPoint1: opts.bodyPoint1,
        fixedPoint1: opts.fixedPoint1,
        bodyPoint2: opts.bodyPoint2,
        fixedPoint2: opts.fixedPoint2,
        ratio: opts.ratio != null ? opts.ratio : 1.0,
        minLength: opts.minLength != null ? opts.minLength : 0.1,
        maxLength: opts.maxLength != null ? opts.maxLength : 20.0
    });
}

/**
 * Registers a body and its associated scene node
 */
function registerPart(tag, node, syncType = 'standard', extraData = {}) {
    const entry = { tag, node, syncType, ...extraData };
    activeBodies.push(entry);
    if (node) activeMeshes.push(node);
    return entry;
}

/**
 * Clears current contraption
 */
export function clearContraption() {
    for (const c of activeConstraints) {
        Physics.destroyConstraint(c);
    }
    activeConstraints.length = 0;

    for (const b of activeBodies) {
        Physics.destroyBody(b.tag);
    }
    activeBodies.length = 0;

    for (const m of activeMeshes) {
        if (m && typeof m.destroy === 'function') m.destroy();
    }
    activeMeshes.length = 0;

    for (const r of activeRods) {
        r.destroy();
    }
    activeRods.length = 0;

    brokenConstraintCount = 0;
}

// -----------------------------------------------------------------------------
// 1. Clockwork Pendulum & Escapement
// -----------------------------------------------------------------------------
export function buildClockworkPendulum(scene, state) {
    clearContraption();
    currentMachineType = 'pendulum';

    // Pedestal Frame
    const frameMesh = createPedestalMesh(scene, 0.4, 4.2, 0.3, '#1e293b');
    frameMesh.position = [0, 4.2, -0.4];
    activeMeshes.push(frameMesh);

    const topBeam = scene.createMesh({
        mesh: Mesh.box(2.0, 0.2, 0.4),
        color: '#334155',
        position: [0, 8.2, 0]
    });
    activeMeshes.push(topBeam);

    // Escape Wheel (Gear)
    const wheelRot = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    const gearBody = Physics.createBody({
        shape: 'cylinder', radius: 1.2, halfHeight: 0.15,
        position: { x: 0, y: 5.5, z: 0 },
        rotation: wheelRot,
        mass: 5.0,
        gravityFactor: 0
    });
    const gearNode = createGearMesh(scene, 1.2, 0.15, 14, '#d4af37');
    registerPart(gearBody, gearNode);

    const gearHinge = createHingeConstraint({
        body1: gearBody,
        point: { x: 0, y: 5.5, z: 0 },
        axis: { x: 0, y: 0, z: 1 },
        motor: { type: 'velocity', target: state.motorSpeed * 2.0, maxTorque: 200 }
    });
    activeConstraints.push(gearHinge);

    // Pendulum Anchor & Bob
    const pivotY = 7.8;
    const rodLen = 5.2;

    const bobBody = Physics.createBody({
        shape: 'sphere', radius: 0.65,
        position: { x: 2.2, y: pivotY - rodLen * 0.9, z: 0 }, // pulled to side at start
        mass: 25.0,
        linearDamping: 0.005,
        angularDamping: 0.005,
        restitution: 0.85
    });
    const bobNode = createSteelSphereMesh(scene, 0.65, '#e2e8f0');
    registerPart(bobBody, bobNode);

    const pendulumHinge = createHingeConstraint({
        body1: bobBody,
        point1: { x: 0, y: pivotY, z: 0 },
        point2: { x: 0, y: pivotY, z: 0 },
        axis: { x: 0, y: 0, z: 1 }
    });
    activeConstraints.push(pendulumHinge);

    // Dynamic brass rod visual
    const rodVisual = createDynamicRod(scene, '#d4af37', 0.04);
    activeRods.push(rodVisual);
    bobBody.rodVisual = rodVisual;
    bobBody.pivotPos = { x: 0, y: pivotY, z: 0 };
}

// -----------------------------------------------------------------------------
// 2. Gearbox & Pulley System
// -----------------------------------------------------------------------------
export function buildGearboxAndPulley(scene, state) {
    clearContraption();
    currentMachineType = 'gearbox';

    const bindRot = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    const baseY = 3.5;

    // Gear 1 (Input Pinion)
    const g1x = -3.2;
    const g1r = 0.8;
    const g1Body = Physics.createBody({
        shape: 'cylinder', radius: g1r, halfHeight: 0.16,
        position: { x: g1x, y: baseY, z: 0 },
        rotation: bindRot,
        mass: 15,
        gravityFactor: 0
    });
    const g1Node = createGearMesh(scene, g1r, 0.16, 10, '#e65c00');
    registerPart(g1Body, g1Node);

    const h1 = createHingeConstraint({
        body1: g1Body,
        point: { x: g1x, y: baseY, z: 0 },
        axis: { x: 0, y: 0, z: 1 },
        motor: { type: 'velocity', target: state.motorSpeed * 3.0, maxTorque: 5000 }
    });
    activeConstraints.push(h1);

    // Gear 2 (Intermediate 2:1 reduction)
    const g2x = g1x + g1r + 1.2;
    const g2r = 1.2;
    const g2Body = Physics.createBody({
        shape: 'cylinder', radius: g2r, halfHeight: 0.16,
        position: { x: g2x, y: baseY, z: 0 },
        rotation: bindRot,
        mass: 30,
        gravityFactor: 0
    });
    const g2Node = createGearMesh(scene, g2r, 0.16, 15, '#d4af37');
    registerPart(g2Body, g2Node);

    const h2 = createHingeConstraint({
        body1: g2Body,
        point: { x: g2x, y: baseY, z: 0 },
        axis: { x: 0, y: 0, z: 1 }
    });
    activeConstraints.push(h2);

    const gearJoint12 = createGearConstraint({
        body1: g1Body, body2: g2Body,
        constraint1: h1, constraint2: h2,
        ratio: 1.5
    });
    activeConstraints.push(gearJoint12);

    // Gear 3 + Pulley Drum (Output)
    const g3x = g2x + g2r + 0.9;
    const g3r = 0.9;
    const g3Body = Physics.createBody({
        shape: 'cylinder', radius: g3r, halfHeight: 0.22,
        position: { x: g3x, y: baseY, z: 0 },
        rotation: bindRot,
        mass: 25,
        gravityFactor: 0
    });
    const g3Node = createPulleyMesh(scene, g3r, 0.22, '#4facfe');
    registerPart(g3Body, g3Node);

    const h3 = createHingeConstraint({
        body1: g3Body,
        point: { x: g3x, y: baseY, z: 0 },
        axis: { x: 0, y: 0, z: 1 }
    });
    activeConstraints.push(h3);

    const gearJoint23 = createGearConstraint({
        body1: g2Body, body2: g3Body,
        constraint1: h2, constraint2: h3,
        ratio: 0.75
    });
    activeConstraints.push(gearJoint23);

    // Suspended Cargo Crate (Body A) & Counterweight (Body B)
    const crateX = 2.5;
    const crateBody = Physics.createBody({
        shape: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        position: { x: crateX, y: 1.8, z: 0 },
        mass: 35.0,
        linearDamping: 0.1
    });
    const crateNode = scene.createMesh({
        mesh: Mesh.box(0.5, 0.5, 0.5),
        color: '#ff8008',
        roughness: 0.5
    });
    registerPart(crateBody, crateNode);

    const weightX = 5.0;
    const weightBody = Physics.createBody({
        shape: 'cylinder', radius: 0.45, halfHeight: 0.6,
        position: { x: weightX, y: 4.8, z: 0 },
        mass: 30.0,
        linearDamping: 0.1
    });
    const weightNode = scene.createMesh({
        mesh: Mesh.cylinder(0.45, 0.6, 16),
        color: '#718096',
        roughness: 0.3,
        metalness: 0.8
    });
    registerPart(weightBody, weightNode);

    // Pulley Overhead Pivots
    const fixP1 = { x: crateX, y: 6.5, z: 0 };
    const fixP2 = { x: weightX, y: 6.5, z: 0 };

    const pulleyJoint = createPulleyConstraint({
        body1: crateBody,
        body2: weightBody,
        bodyPoint1: { x: crateX, y: 2.3, z: 0 },
        fixedPoint1: fixP1,
        bodyPoint2: { x: weightX, y: 5.4, z: 0 },
        fixedPoint2: fixP2,
        ratio: 1.0,
        minLength: 1.0,
        maxLength: 10.0
    });
    activeConstraints.push(pulleyJoint);

    // Visual Pulley Wheels & Ropes
    const pWh1 = createPulleyMesh(scene, 0.4, 0.1, '#64748b');
    pWh1.position = [fixP1.x, fixP1.y, fixP1.z];
    activeMeshes.push(pWh1);

    const pWh2 = createPulleyMesh(scene, 0.4, 0.1, '#64748b');
    pWh2.position = [fixP2.x, fixP2.y, fixP2.z];
    activeMeshes.push(pWh2);

    const r1 = createDynamicRod(scene, '#e2e8f0', 0.03);
    const r2 = createDynamicRod(scene, '#e2e8f0', 0.03);
    const rTop = createDynamicRod(scene, '#e2e8f0', 0.03);
    activeRods.push(r1, r2, rTop);
    rTop.set(fixP1, fixP2);

    crateBody.pulleyVisual = { r1, r2, fixP1, fixP2, weightBody };
}

// -----------------------------------------------------------------------------
// 3. Piston & Crankshaft Engine
// -----------------------------------------------------------------------------
export function buildPistonAndCrankshaft(scene, state) {
    clearContraption();
    currentMachineType = 'piston';

    const crankOrigin = { x: 0, y: 2.2, z: 0 };
    const crankRadius = 1.0;
    const conrodLength = 3.2;

    // Base Pedestal
    const base = createPedestalMesh(scene, 2.0, 0.4, 1.2, '#1e293b');
    base.position = [0, 0.4, 0];
    activeMeshes.push(base);

    // Flywheel / Crank disc
    const crankRot = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    const crankBody = Physics.createBody({
        shape: 'cylinder', radius: 1.3, halfHeight: 0.18,
        position: crankOrigin,
        rotation: crankRot,
        mass: 40.0,
        gravityFactor: 0
    });
    const crankNode = scene.createMesh({
        mesh: Mesh.cylinder(1.3, 0.18, 24),
        color: '#c59b27',
        roughness: 0.3,
        metalness: 0.8
    });
    registerPart(crankBody, crankNode);

    const crankHinge = createHingeConstraint({
        body1: crankBody,
        point: crankOrigin,
        axis: { x: 0, y: 0, z: 1 },
        motor: { type: 'velocity', target: state.motorSpeed * 4.0, maxTorque: 8000 }
    });
    activeConstraints.push(crankHinge);

    // Cylinder Bore Sleeve (Static Visual)
    const sleeve = createCylinderSleeveMesh(scene, 0.85, 1.6, '#334155');
    sleeve.position = [0, crankOrigin.y + conrodLength + 0.6, 0];
    activeMeshes.push(sleeve);

    // Piston Head (Linear Slider)
    const pistonInitY = crankOrigin.y + conrodLength;
    const pistonBody = Physics.createBody({
        shape: 'cylinder', radius: 0.72, halfHeight: 0.45,
        position: { x: 0, y: pistonInitY, z: 0 },
        mass: 10.0,
        linearDamping: 0.05
    });
    const pistonNode = createPistonHeadMesh(scene, 0.72, 0.45, '#cbd5e1');
    registerPart(pistonBody, pistonNode);

    const sliderJoint = createSliderConstraint({
        body1: pistonBody,
        point: { x: 0, y: pistonInitY, z: 0 },
        axis: { x: 0, y: 1, z: 0 },
        limitMin: -crankRadius * 1.5,
        limitMax: crankRadius * 1.5
    });
    activeConstraints.push(sliderJoint);

    // Connecting Rod (Point Constraints to Crank Pin and Piston Wrist Pin)
    const rodVisual = createConnectingRodMesh(scene, conrodLength, 0.22, '#94a3b8');
    activeMeshes.push(rodVisual);

    crankBody.conrodVisual = {
        rodNode: rodVisual,
        crankOrigin,
        crankRadius,
        pistonBody,
        conrodLength
    };
}

// -----------------------------------------------------------------------------
// 4. Newton's Cradle
// -----------------------------------------------------------------------------
export function buildNewtonsCradle(scene, state) {
    clearContraption();
    currentMachineType = 'cradle';

    const numBalls = 5;
    const ballRadius = 0.42;
    const stringLen = 4.2;
    const frameY = 6.2;
    const zOffset = 0.75; // V-shaped suspension for planar swing

    // Overhead Gantry Frame
    const topBar = scene.createMesh({
        mesh: Mesh.box(2.8, 0.15, zOffset + 0.2),
        color: '#334155',
        position: [0, frameY, 0],
        metalness: 0.8
    });
    activeMeshes.push(topBar);

    for (let i = 0; i < numBalls; i++) {
        const x = (i - (numBalls - 1) * 0.5) * (ballRadius * 2.001);
        // If ball 0, pull back to start motion
        let startX = x;
        let startY = frameY - stringLen;
        if (i === 0) {
            startX = x - 2.6;
            startY = frameY - Math.sqrt(stringLen * stringLen - 2.6 * 2.6);
        }

        const ball = Physics.createBody({
            shape: 'sphere', radius: ballRadius,
            position: { x: startX, y: startY, z: 0 },
            mass: 12.0,
            restitution: state.restitution != null ? state.restitution : 0.99,
            friction: 0.02,
            linearDamping: 0.001,
            angularDamping: 0.001
        });
        const ballMesh = createSteelSphereMesh(scene, ballRadius, '#f1f5f9');
        registerPart(ball, ballMesh);

        // V-suspension strings
        const pL = { x, y: frameY, z: -zOffset };
        const pR = { x, y: frameY, z: zOffset };

        const cL = createDistanceConstraint({
            body1: ball,
            point1: pL,
            point2: { x: startX, y: startY, z: 0 },
            maxDistance: Math.hypot(startX - x, startY - frameY, zOffset)
        });
        const cR = createDistanceConstraint({
            body1: ball,
            point1: pR,
            point2: { x: startX, y: startY, z: 0 },
            maxDistance: Math.hypot(startX - x, startY - frameY, zOffset)
        });
        activeConstraints.push(cL, cR);

        const rodL = createDynamicRod(scene, '#94a3b8', 0.015);
        const rodR = createDynamicRod(scene, '#94a3b8', 0.015);
        activeRods.push(rodL, rodR);

        ball.cradleVisual = { rodL, rodR, pL, pR };
    }
}

// -----------------------------------------------------------------------------
// 5. Suspension Bridge & Breakable Joints
// -----------------------------------------------------------------------------
export function buildSuspensionBridge(scene, state) {
    clearContraption();
    currentMachineType = 'bridge';

    const numPlanks = 7;
    const plankHw = 1.0;
    const plankHh = 0.12;
    const plankHd = 0.55;
    const span = numPlanks * plankHd * 2.0;

    const towerX = span * 0.5 + 1.2;
    const towerY = 5.0;

    // Anchor Towers (Left & Right)
    const towerL = scene.createMesh({
        mesh: Mesh.box(0.5, towerY * 0.5, 1.4),
        color: '#1e293b',
        position: [-towerX, towerY * 0.5, 0]
    });
    const towerR = scene.createMesh({
        mesh: Mesh.box(0.5, towerY * 0.5, 1.4),
        color: '#1e293b',
        position: [towerX, towerY * 0.5, 0]
    });
    activeMeshes.push(towerL, towerR);

    const breakingThreshold = state.breakingImpulse != null ? state.breakingImpulse : 1200;

    const planks = [];
    for (let i = 0; i < numPlanks; i++) {
        const z = (i - (numPlanks - 1) * 0.5) * (plankHd * 2.0);
        const plankBody = Physics.createBody({
            shape: 'box', halfExtents: { x: plankHw, y: plankHh, z: plankHd },
            position: { x: 0, y: 1.5, z },
            mass: 25.0,
            linearDamping: 0.1,
            angularDamping: 0.2
        });
        const plankMesh = createBridgePlankMesh(scene, plankHw, plankHh, plankHd, '#8b5a2b');
        registerPart(plankBody, plankMesh);
        planks.push(plankBody);

        // Hanger cables from overhead catenary
        const topAnchorL = { x: -plankHw * 0.9, y: towerY * 0.9, z };
        const topAnchorR = { x: plankHw * 0.9, y: towerY * 0.9, z };

        const cL = createDistanceConstraint({
            body1: plankBody,
            point1: topAnchorL,
            point2: { x: -plankHw * 0.9, y: 1.5, z },
            maxDistance: Math.hypot(0, towerY * 0.9 - 1.5, 0),
            breakingImpulse: breakingThreshold
        });
        const cR = createDistanceConstraint({
            body1: plankBody,
            point1: topAnchorR,
            point2: { x: plankHw * 0.9, y: 1.5, z },
            maxDistance: Math.hypot(0, towerY * 0.9 - 1.5, 0),
            breakingImpulse: breakingThreshold
        });
        activeConstraints.push(cL, cR);

        const rodL = createDynamicRod(scene, '#94a3b8', 0.02);
        const rodR = createDynamicRod(scene, '#94a3b8', 0.02);
        activeRods.push(rodL, rodR);

        plankBody.bridgeHanger = { rodL, rodR, topAnchorL, topAnchorR, plankHw };
    }

    // Connect adjacent planks with hinge/distance constraints
    for (let i = 0; i < numPlanks - 1; i++) {
        const b1 = planks[i];
        const b2 = planks[i + 1];
        const midZ = ((i - (numPlanks - 1) * 0.5) + 0.5) * (plankHd * 2.0);

        const hinge = createHingeConstraint({
            body1: b1,
            body2: b2,
            point: { x: 0, y: 1.5, z: midZ },
            axis: { x: 1, y: 0, z: 0 },
            breakingImpulse: breakingThreshold
        });
        activeConstraints.push(hinge);
    }
}

/**
 * Drop a heavy wrecking ball onto the active machine
 */
export function dropHeavyLoad(scene, x = 0, y = 8.0, z = 0, mass = 120.0) {
    const ball = Physics.createBody({
        shape: 'sphere', radius: 0.8,
        position: { x, y, z },
        mass,
        restitution: 0.1
    });
    const mesh = scene.createMesh({
        mesh: Mesh.sphere(0.8, 20, 14),
        color: '#ff3838',
        roughness: 0.3,
        metalness: 0.9
    });
    registerPart(ball, mesh);
    Physics.activate(ball);
}

/**
 * Nudge / Impel active machine
 */
export function nudgeMachine(impulse = { x: 0, y: 0, z: 250 }) {
    if (activeBodies.length > 0) {
        const target = activeBodies[0].tag;
        Physics.addImpulse(target, impulse.x, impulse.y, impulse.z);
        Physics.activate(target);
    }
}

/**
 * Sync transforms and update visual connectors
 */
export function updateContraptions(dt) {
    // 1. Sync body transforms to scene nodes
    for (const b of activeBodies) {
        const tf = Physics.getTransform(b.tag);
        if (!tf || !b.node) continue;

        b.node.position = [tf.position.x, tf.position.y, tf.position.z];
        b.node.quaternion = [tf.rotation.x, tf.rotation.y, tf.rotation.z, tf.rotation.w];

        // Specific visual updates
        if (b.rodVisual && b.pivotPos) {
            b.rodVisual.set(b.pivotPos, tf.position);
        }

        if (b.pulleyVisual) {
            const { r1, r2, fixP1, fixP2, weightBody } = b.pulleyVisual;
            const wTf = Physics.getTransform(weightBody);
            r1.set({ x: tf.position.x, y: tf.position.y + 0.5, z: tf.position.z }, fixP1);
            if (wTf) {
                r2.set({ x: wTf.position.x, y: wTf.position.y + 0.6, z: wTf.position.z }, fixP2);
            }
        }

        if (b.conrodVisual) {
            const { rodNode, crankOrigin, crankRadius, pistonBody } = b.conrodVisual;
            const pTf = Physics.getTransform(pistonBody.tag);
            // Crank pin position
            const angle = Math.atan2(tf.rotation.z, tf.rotation.w) * 2.0;
            const pinX = crankOrigin.x + Math.sin(angle) * crankRadius;
            const pinY = crankOrigin.y + Math.cos(angle) * crankRadius;
            const pinZ = crankOrigin.z;

            if (pTf) {
                const wristX = pTf.position.x;
                const wristY = pTf.position.y;
                const wristZ = pTf.position.z;

                const dx = wristX - pinX, dy = wristY - pinY, dz = wristZ - pinZ;
                rodNode.position = [(pinX + wristX) * 0.5, (pinY + wristY) * 0.5, (pinZ + wristZ) * 0.5];
                rodNode.quaternion = quatYTo(dx, dy, dz);
            }
        }

        if (b.cradleVisual) {
            const { rodL, rodR, pL, pR } = b.cradleVisual;
            rodL.set(pL, tf.position);
            rodR.set(pR, tf.position);
        }

        if (b.bridgeHanger) {
            const { rodL, rodR, topAnchorL, topAnchorR, plankHw } = b.bridgeHanger;
            rodL.set(topAnchorL, { x: tf.position.x - plankHw * 0.9, y: tf.position.y, z: tf.position.z });
            rodR.set(topAnchorR, { x: tf.position.x + plankHw * 0.9, y: tf.position.y, z: tf.position.z });
        }
    }

    // 2. Poll broken constraints
    if (typeof Physics.getBrokenConstraints === 'function') {
        const broken = Physics.getBrokenConstraints();
        if (broken && broken.length > 0) {
            brokenConstraintCount += broken.length;
        }
    }
}
