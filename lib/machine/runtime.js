// lib/machine/runtime.js — Live Box3D runtime for compiled recursive machines:
// instantiates compound rigid clusters, clamped servo joints, analytical internal
// couplings (gears/ratchets/flywheels/springs/cams), ballistic cannons with real
// 3rd-law recoil, boundary fracture tracking, and autonomous battle AI.

import { materialOf } from "./materials.js";
import { vAdd, vSub, vScale, vDot, vNorm, qMul, qRot, qAxis } from "./compiler.js";

const G = 9.81;

export function spawnCompiledMachine(world, compiled, opts = {}) {
    const origin = opts.position || [0, 0, 0];
    const yaw = opts.yaw || 0;
    const rotY = qAxis(0, 1, 0, yaw);
    const layers = opts.layers ?? 1;
    const mask = opts.mask ?? -1;

    const clusterBodies = [];
    const aliveClusters = new Set();

    for (const cl of compiled.clusters) {
        const wPos = vAdd(origin, qRot(rotY, cl.com));
        const mat = materialOf(cl.rootNode.material);
        let body;
        if (cl.parts.length === 1) {
            const p = cl.parts[0];
            const wRot = qMul(rotY, p.rotation);
            const common = {
                position: wPos,
                rotation: wRot,
                mass: cl.massKg,
                friction: p.friction ?? (p.role === 'wheel' ? 1.25 : p.role === 'foot' || p.role === 'spade' ? 1.15 : mat.friction),
                restitution: p.restitution ?? mat.restitution,
                linearDamping: 0.04,
                angularDamping: 0.06,
                layers,
                mask,
            };
            if (p.shape === 'sphere' || p.role === 'wheel') {
                body = world.addSphere({ ...common, radius: p.radius });
            } else if (p.shape === 'cylinder') {
                body = world.addCylinder({ ...common, radius: p.radius, halfHeight: p.halfHeight, segments: 12 });
            } else {
                body = world.addBox({ ...common, half: p.half });
            }
        } else {
            body = world.addCompound({
                position: wPos,
                rotation: rotY,
                friction: mat.friction,
                restitution: mat.restitution,
                linearDamping: 0.04,
                angularDamping: 0.06,
                layers,
                mask,
                parts: cl.localParts.map((lp) => ({
                    center: lp.center,
                    rotation: lp.rotation,
                    half: lp.half,
                    mass: lp.mass,
                })),
            });
        }
        clusterBodies.push(body);
        aliveClusters.add(body);
    }

    // Filter self-collisions between joint-linked clusters (plus wheel-chassis pairs).
    const filterSet = new Set();
    const addFilter = (ca, cb) => {
        if (ca === cb || ca < 0 || cb < 0) return;
        const a = Math.min(ca, cb), b = Math.max(ca, cb);
        const k = `${a}:${b}`;
        if (filterSet.has(k)) return;
        filterSet.add(k);
        world.addJoint({ kind: 'filter', a: clusterBodies[a], b: clusterBodies[b] });
    };
    for (const [ca, cb] of compiled.filterPairs) addFilter(ca, cb);
    for (let i = 0; i < compiled.clusters.length; i++) {
        if (compiled.clusters[i].rootNode.role === 'wheel' || compiled.clusters[i].rootNode.role === 'foot') {
            addFilter(0, i);
        }
    }

    // Create articulated DOF joints.
    const joints = [];
    const jointById = new Map();
    const jointByNode = new Map();
    for (const cj of compiled.joints) {
        const a = clusterBodies[cj.clusterA];
        const b = clusterBodies[cj.clusterB];
        const anchor = vAdd(origin, qRot(rotY, cj.anchor));
        const anchorB = cj.anchorB ? vAdd(origin, qRot(rotY, cj.anchorB)) : undefined;
        const axis = qRot(rotY, cj.axis);
        const axisB = cj.axisB ? qRot(rotY, cj.axisB) : undefined;
        const jid = world.addJoint({
            kind: cj.kind,
            a,
            b,
            anchor,
            anchorB,
            axis,
            axisB,
            lower: cj.lower,
            upper: cj.upper,
            enableLimit: cj.enableLimit,
            target: cj.target,
            hertz: cj.hertz,
            damping: cj.damping,
            maxSpring: cj.enableSpring ? cj.maxEffort : 0,
            enableSpring: cj.enableSpring,
            motorSpeed: cj.motorSpeed,
            maxMotor: cj.maxEffort,
            enableMotor: cj.enableMotor,
            breakForce: cj.breakForce,
            breakTorque: cj.breakTorque,
            collide: false,
        });
        const rec = { ...cj, jointId: jid, a, b, broken: false, util: 0, angle: cj.target || 0, speed: 0, stripped: false };
        joints.push(rec);
        jointById.set(jid, rec);
        jointByNode.set(cj.nodeId, rec);
    }

    // Internal compiled mechanism state (gears, ratchets, flywheels, springs, cams).
    const mechState = {
        time: 0,
        spadesDeployed: false,
        catapultCharge: 0,   // 0..1 stored elastic energy
        catapultReleasing: 0,
        flywheelEnergy: 0,   // Joules stored
        flywheelRpm: 0,
        clutchTimer: 0,
        breechFlash: 0,
        windupCooldown: 0,
        cannons: compiled.cannons.map((c) => ({ ...c, cooldown: 0 })),
        couplings: compiled.couplings.map((c) => ({ ...c, broken: false, spinAngle: 0, energy: 0, activeLoad: 0 })),
    };

    return {
        id: opts.name || compiled.id,
        team: opts.team ?? 1,
        world,
        compiled,
        clusterBodies,
        aliveClusters,
        rootBody: clusterBodies[0],
        joints,
        jointById,
        jointByNode,
        mech: mechState,
        brokenCount: 0,
        strippedCount: 0,
        peakCombatUtil: 0,
        integrity: 1.0,
        projectilesOut: [],
    };
}

/** Update analytical internal mechanisms and drive Box3D joints cleanly. */
export function stepMachine(inst, dt, input = {}) {
    const { world, compiled, mech } = inst;
    mech.time += dt;
    if (mech.clutchTimer > 0) mech.clutchTimer = Math.max(0, mech.clutchTimer - dt);
    if (mech.catapultReleasing > 0) mech.catapultReleasing = Math.max(0, mech.catapultReleasing - dt);
    if (mech.windupCooldown > 0) mech.windupCooldown = Math.max(0, mech.windupCooldown - dt);

    // Check newly broken Box3D joints.
    for (const jid of world.broken()) {
        const rec = inst.jointById.get(jid);
        if (rec && !rec.broken) {
            rec.broken = true;
            inst.brokenCount++;
        }
    }

    // Read root pose for orientation & turret tracking.
    const rootPose = world.pose(inst.rootBody);
    const rPos = [rootPose[0], rootPose[1], rootPose[2]];
    const rQuat = [rootPose[3], rootPose[4], rootPose[5], rootPose[6]];
    const rootFwd = qRot(rQuat, [0, 0, -1]);

    // Step compiled couplings: flywheels, gears, ratchets, springs, cams.
    let flywheelTorqueBoost = 1.0;
    let camSwing = 0, camLift = 0;
    for (const c of mech.couplings) {
        if (c.broken) continue;
        if (c.kind === 'flywheel') {
            const maxE = c.maxEnergy || 220000;
            // Charge continuously up to rated energy; dumping converts kinetic energy to extra ram/drive force.
            if (input.clutchDump && c.energy > maxE * 0.25) {
                mech.clutchTimer = Math.max(mech.clutchTimer, 0.38);
                c.energy *= 0.2;
            } else {
                c.energy = Math.min(maxE, c.energy + (c.chargeW || 55000) * dt);
            }
            const frac = c.energy / maxE;
            c.spinAngle += dt * (8 + 55 * frac);
            mech.flywheelEnergy = c.energy;
            mech.flywheelRpm = 200 + 1800 * frac;
            if (mech.clutchTimer > 0) flywheelTorqueBoost = Math.max(flywheelTorqueBoost, 2.8);
        } else if (c.kind === 'cam') {
            const freq = (c.freqHz || 1.3) * (0.4 + 0.8 * Math.abs(input.throttle || 0));
            c.spinAngle += dt * Math.PI * 2 * (Math.abs(input.throttle || 0) > 0.05 || Math.abs(input.steer || 0) > 0.05 ? freq : 0);
            const ph = c.spinAngle + (c.phaseOffset || 0);
            camSwing = Math.sin(ph);
            camLift = Math.max(0, Math.cos(ph));
        } else if (c.kind === 'gear') {
            const torque = Math.abs((input.throttle || 0) * (c.nominalTorque || 8000) * flywheelTorqueBoost);
            c.activeLoad = torque;
            c.spinAngle += dt * (input.throttle || 0) * 14 * (c.ratio || 1);
            if (c.maxTorque > 0 && torque > c.maxTorque * 1.45) {
                c.broken = true;
                inst.strippedCount++;
            }
        } else if (c.kind === 'spring') {
            const maxE = c.maxEnergy || 180000;
            if (input.fire && c.energy > maxE * 0.3 && mech.catapultReleasing <= 0) {
                mech.catapultReleasing = 0.28;
                c.energy = 0;
            } else if (mech.catapultReleasing <= 0) {
                c.energy = Math.min(maxE, c.energy + (c.chargeW || 75000) * dt);
            }
            mech.catapultCharge = c.energy / maxE;
        }
    }

    if (input.toggleSpades) mech.spadesDeployed = !mech.spadesDeployed;
    if (input.spades !== undefined) mech.spadesDeployed = !!input.spades;

    const throttle = Math.max(-1, Math.min(1, input.throttle || 0));
    const steer = Math.max(-1, Math.min(1, input.steer || 0));
    const turretYaw = input.turretYaw ?? 0;
    const turretPitch = input.turretPitch ?? 0.25;

    let stepPeakUtil = 0;
    for (const j of inst.joints) {
        if (j.broken || !world.hasJoint(j.jointId)) {
            j.broken = true;
            j.util = 1.5;
            continue;
        }
        const st = world.jointState(j.jointId);
        const ld = world.jointLoad(j.jointId);
        j.angle = st.position;
        j.speed = st.speed;
        const fMag = Math.hypot(ld.force[0], ld.force[1], ld.force[2]);
        const cap = j.breakForce > 0 ? j.breakForce : Math.max(j.maxEffort * 1.5, 4e4);
        j.util = Math.min(1.5, fMag / Math.max(1, cap));
        stepPeakUtil = Math.max(stepPeakUtil, j.util);

        const ch = j.channel || j.role;
        if (j.kind === 'wheel') {
            // Left (-X) vs right (+X) differential skid steer; forward = -Z -> negative omega around +X.
            const side = j.anchor[0] < 0 ? -1 : 1;
            const drive = (throttle - steer * side * 0.85) * (j.scale || 1);
            const targetSpeed = -drive * 14.0;
            world.setJointMotor(j.jointId, targetSpeed, j.maxEffort * flywheelTorqueBoost, true);
        } else if (j.kind === 'hinge') {
            let target = j.target || 0;
            if (ch === 'turret_yaw') {
                target = turretYaw;
            } else if (ch === 'turret_pitch') {
                target = turretPitch;
            } else if (ch === 'spade') {
                target = mech.spadesDeployed ? j.upper * 0.92 : j.lower * 0.85;
            } else if (ch === 'catapult_arm') {
                // Release shoots to upper limit with high torque, otherwise winds back slowly to lower limit.
                if (mech.catapultReleasing > 0.05) {
                    world.setJointTarget(j.jointId, j.upper, 18, 0.2, j.maxEffort * 1.6, true);
                    continue;
                } else {
                    target = j.lower + (1 - mech.catapultCharge) * 0.15;
                    world.setJointTarget(j.jointId, target, 4, 1.0, j.maxEffort * 0.45, true);
                    continue;
                }
            } else if (ch === 'gait_hip_L' || ch === 'gait_hip_R') {
                const phShift = ch === 'gait_hip_L' ? 0 : Math.PI;
                const walkVel = Math.abs(throttle) > 0.05 ? throttle : (Math.abs(steer) > 0.05 ? (ch === 'gait_hip_L' ? -steer : steer) : 0);
                const swing = Math.sin(mech.time * 4.2 + phShift) * 0.34 * walkVel;
                target = swing * (j.sign || 1);
            } else if (ch === 'gait_knee_L' || ch === 'gait_knee_R') {
                const phShift = ch === 'gait_knee_L' ? 0 : Math.PI;
                const active = (Math.abs(throttle) + Math.abs(steer)) > 0.05 ? 1 : 0;
                const lift = Math.max(0, Math.cos(mech.time * 4.2 + phShift)) * 0.48 * active;
                target = (j.target || -0.35) + lift;
            } else if (ch === 'gait_ankle_L' || ch === 'gait_ankle_R') {
                target = j.target || 0.25;
            }
            const clTarget = Math.max(j.lower, Math.min(j.upper, target));
            world.setJointTarget(j.jointId, clTarget, j.hertz, j.damping, j.maxEffort * flywheelTorqueBoost, true);
        } else if (j.kind === 'slider') {
            if (ch === 'pile_bunker') {
                if (input.fire || mech.clutchTimer > 0.15) {
                    world.setJointTarget(j.jointId, j.upper, 24, 0.4, j.maxEffort * flywheelTorqueBoost, true);
                } else {
                    world.setJointTarget(j.jointId, j.lower, 5, 1.0, j.maxEffort * 0.5, true);
                }
            } else if (ch === 'spade') {
                const tgt = mech.spadesDeployed ? j.upper : j.lower;
                world.setJointTarget(j.jointId, tgt, j.hertz, j.damping, j.maxEffort, true);
            }
            // Recoil sliders stay at their compiled spring target (0) and compress naturally under impulse.
        }
    }

    // Step cannons & handle physical firing + 3rd-law recoil!
    for (const c of mech.cannons) {
        if (c.cooldown > 0) c.cooldown = Math.max(0, c.cooldown - dt);
        const fireCatapultArm = c.catapultTrigger && mech.catapultReleasing > 0.20 && c.cooldown <= 0;
        const fireNormal = input.fire && !c.catapultTrigger && c.cooldown <= 0;
        if ((fireNormal || fireCatapultArm) && inst.aliveClusters.has(inst.clusterBodies[c.clusterId])) {
            const barrelBody = inst.clusterBodies[c.clusterId];
            if (!world.hasBody(barrelBody)) continue;
            const bp = world.pose(barrelBody);
            const bPos = [bp[0], bp[1], bp[2]];
            const bQuat = [bp[3], bp[4], bp[5], bp[6]];
            const dir = vNorm(qRot(bQuat, c.localDir));
            const muzzle = vAdd(bPos, qRot(bQuat, c.localOffset));
            c.cooldown = c.cooldownSec || 1.2;

            // Spawn physical shell with swept collision (bullet: true) and apply real 3rd-law recoil!
            const pMass = c.massKg || 25;
            const speed = c.muzzleSpeed || 95;
            const shellRad = c.shellRadius || 0.24;
            const shellBody = world.addSphere({
                position: vAdd(muzzle, vScale(dir, shellRad + 0.35)),
                radius: shellRad,
                mass: pMass,
                velocity: vScale(dir, speed),
                bullet: true,
                friction: 0.4,
                restitution: 0.15,
            });
            // Kick barrel backward (real recoil drives recoil slide & stresses chassis!).
            const recoilMag = c.recoilNs || (pMass * speed * 0.65);
            world.applyImpulse(barrelBody, vScale(dir, -recoilMag), bPos);
            inst.projectilesOut.push({
                body: shellBody,
                ownerTeam: inst.team,
                radius: shellRad,
                mass: pMass,
                age: 0,
                maxAge: 6.0,
            });
        }
    }

    // Gentle upright gyro trim only if machine specifies active gyroStabilize (e.g. bipedal titan).
    if (compiled.couplings.some((c) => c.kind === 'gyro') && world.hasBody(inst.rootBody)) {
        const up = qRot(rQuat, [0, 1, 0]);
        const corrX = -up[2]; // pitch correction about X? up cross Y = (up.z, 0, -up.x)
        const axX = up[2], axZ = -up[0];
        const angVel = world.velocity(inst.rootBody).slice(3, 6);
        const gain = compiled.nameplate.massKg * 14.0;
        const damp = compiled.nameplate.massKg * 2.5;
        world.applyTorque(inst.rootBody, [axX * gain - angVel[0] * damp, 0, axZ * gain - angVel[2] * damp]);
    }

    inst.peakCombatUtil = stepPeakUtil;
    const totalConstraints = Math.max(1, inst.joints.length + mech.couplings.length);
    inst.integrity = Math.max(0, 1 - (inst.brokenCount + inst.strippedCount) / Math.max(2, totalConstraints * 0.6));
    return { rPos, rQuat, rootFwd };
}

/** Simple predictive AI controller for arena battles between compiled machines. */
export function computeAiInput(inst, targetPos, dt) {
    const pose = inst.world.pose(inst.rootBody);
    const pos = [pose[0], pose[1], pose[2]];
    const quat = [pose[3], pose[4], pose[5], pose[6]];
    const fwd = qRot(quat, [0, 0, -1]);
    const dx = targetPos[0] - pos[0], dz = targetPos[2] - pos[2];
    const dist = Math.hypot(dx, dz) || 1;
    const tx = dx / dist, tz = dz / dist;

    const dotFwd = fwd[0] * tx + fwd[2] * tz;
    const crossY = fwd[0] * tz - fwd[2] * tx; // + means target is to right/left depending on handedness
    const desiredDist = inst.compiled.category === 'artillery' ? 28 : (inst.compiled.category === 'brawler' ? 4.5 : 16);

    let throttle = 0;
    if (dist > desiredDist + 3) throttle = 0.85;
    else if (dist < desiredDist - 4 && inst.compiled.category === 'artillery') throttle = -0.6;

    const steer = Math.max(-1, Math.min(1, -crossY * 1.8));
    const localTargetAngle = Math.atan2(-(fwd[0] * tz - fwd[2] * tx), Math.max(-0.99, Math.min(0.99, dotFwd)));
    const turretPitch = Math.max(0.04, Math.min(0.75, 0.08 + dist * 0.006));
    const spades = inst.compiled.category === 'artillery' && dist < desiredDist + 8 && Math.abs(throttle) < 0.2;
    const fire = (Math.abs(localTargetAngle) < 0.35 || dist < 12) && dist < 85;
    const clutchDump = inst.compiled.category === 'brawler' && dist < 8.5;

    return { throttle, steer, turretYaw: localTargetAngle, turretPitch, spades, fire, clutchDump };
}
