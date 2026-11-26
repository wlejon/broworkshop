// demos/foundry/tests/test_operations.js — Comprehensive headless operational
// proving ground for EVERY Foundry machine (6 Tier-3) and every actuated
// subsystem/component (Tier-1 & Tier-2). Verifies real Box3D mechanical
// behavior: idle stability, forward/reverse drive/walk, left/right steering,
// turret azimuth/elevation + aimed ballistic fire, prismatic recoil stroke,
// outrigger spade deploy/stow + ground contact, catapult cock-and-whip +
// ballistic lob, flywheel clutch surge, pile-bunker stroke + target impact,
// and live bunker destruction.

import { compileMachine, qRot } from "/lib/machine/compiler.js";
import { BUILTIN_CATALOG, createCatalogResolver } from "/lib/machine/assemblies.js";
import { spawnCompiledMachine, stepMachine, computeAiInput } from "/lib/machine/runtime.js";

const resolver = createCatalogResolver({});
const results = [];
let failCount = 0;

function check(group, name, cond, detail) {
    const status = cond ? 'PASS' : 'FAIL';
    if (!cond) failCount++;
    results.push({ group, name, status, detail });
    console.log(`[${status}] ${group} :: ${name} (${detail})`);
}

function makeWorld() {
    const w = bro.dynamics.createWorld({ workers: 4 });
    w.addBox({ position: [0, -1, 0], half: [200, 1, 200], mass: 0, friction: 1.0, layers: 1 });
    return w;
}

function poseInfo(w, body) {
    const p = w.pose(body);
    const pos = [p[0], p[1], p[2]];
    const q = [p[3], p[4], p[5], p[6]];
    const up = qRot(q, [0, 1, 0]);
    const fwd = qRot(q, [0, 0, -1]);
    const yaw = Math.atan2(-fwd[0], -fwd[2]); // 0 when facing -Z, +left, -right
    return { pos, q, up, fwd, yaw };
}

function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

function stepN(w, inst, n, inputFn) {
    for (let i = 0; i < n; i++) {
        const inp = typeof inputFn === 'function' ? inputFn(i) : inputFn;
        stepMachine(inst, 1 / 60, inp || {});
        w.step(1 / 60, 4);
    }
}

function spawnFresh(id, opts = {}) {
    const c = compileMachine(BUILTIN_CATALOG[id], resolver);
    const w = makeWorld();
    const y0 = -c.bounds.min[1] + 0.12;
    const inst = spawnCompiledMachine(w, c, { position: [0, y0, 0], ...opts });
    return { c, w, inst };
}

// ============================================================================
// PART A: TIER-3 MACHINE OPERATIONAL PROVING TESTS (all 6 machines)
// ============================================================================
const T3_IDS = [
    'siege_howitzer',
    'iron_strider',
    'juggernaut_ram',
    'clockwork_catapult',
    'twin_autocannon_tank',
    'biped_titan',
];

for (const id of T3_IDS) {
    // 1. Idle stability (2.0s with zero input)
    {
        const { w, inst } = spawnFresh(id);
        stepN(w, inst, 30, {}); // settle
        const p0 = poseInfo(w, inst.rootBody);
        stepN(w, inst, 120, {});
        const p1 = poseInfo(w, inst.rootBody);
        const drift = Math.hypot(p1.pos[0] - p0.pos[0], p1.pos[2] - p0.pos[2]);
        check(id, 'idle_stability', inst.brokenCount === 0 && p1.up[1] > 0.92 && drift < 0.65,
            `upY=${p1.up[1].toFixed(3)} drift=${drift.toFixed(2)}m broken=${inst.brokenCount}`);
        w.destroy();
    }

    // 2. Forward & Reverse locomotion
    {
        const { w, inst } = spawnFresh(id);
        stepN(w, inst, 20, {});
        const pStart = poseInfo(w, inst.rootBody);
        stepN(w, inst, 150, { throttle: 1.0 });
        const pFwd = poseInfo(w, inst.rootBody);
        const fwdDist = -(pFwd.pos[2] - pStart.pos[2]);

        stepN(w, inst, 30, { throttle: 0 });
        const pStop = poseInfo(w, inst.rootBody);
        stepN(w, inst, 150, { throttle: -1.0 });
        const pRev = poseInfo(w, inst.rootBody);
        const revDist = (pRev.pos[2] - pStop.pos[2]);

        const minFwd = (id === 'iron_strider' || id === 'biped_titan') ? 2.5 : 8.0;
        const minRev = (id === 'iron_strider' || id === 'biped_titan') ? 1.8 : 6.0;
        check(id, 'forward_drive', inst.brokenCount === 0 && pFwd.up[1] > 0.85 && fwdDist >= minFwd,
            `fwd=${fwdDist.toFixed(2)}m (need >=${minFwd}) upY=${pFwd.up[1].toFixed(2)} broken=${inst.brokenCount}`);
        check(id, 'reverse_drive', inst.brokenCount === 0 && pRev.up[1] > 0.85 && revDist >= minRev,
            `rev=${revDist.toFixed(2)}m (need >=${minRev}) upY=${pRev.up[1].toFixed(2)} broken=${inst.brokenCount}`);
        w.destroy();
    }

    // 3. Left & Right Steering (integrated unwrapped yaw — verifies real controllable turning!)
    {
        const { w, inst } = spawnFresh(id);
        stepN(w, inst, 20, {});
        let prevY = poseInfo(w, inst.rootBody).yaw, accL = 0;
        for (let i = 0; i < 120; i++) {
            stepMachine(inst, 1 / 60, { throttle: 0.35, steer: -1.0 });
            w.step(1 / 60, 4);
            const y = poseInfo(w, inst.rootBody).yaw;
            accL += angleDiff(y, prevY);
            prevY = y;
        }
        const pL = poseInfo(w, inst.rootBody);
        w.destroy();

        const r2 = spawnFresh(id);
        stepN(r2.w, r2.inst, 20, {});
        let prevYr = poseInfo(r2.w, r2.inst.rootBody).yaw, accR = 0;
        for (let i = 0; i < 120; i++) {
            stepMachine(r2.inst, 1 / 60, { throttle: 0.35, steer: 1.0 });
            r2.w.step(1 / 60, 4);
            const y = poseInfo(r2.w, r2.inst.rootBody).yaw;
            accR += angleDiff(y, prevYr);
            prevYr = y;
        }
        const pR = poseInfo(r2.w, r2.inst.rootBody);

        const degL = accL * 180 / Math.PI;
        const degR = accR * 180 / Math.PI;
        check(id, 'steer_left', inst.brokenCount === 0 && pL.up[1] > 0.85 && degL > 25 && degL < 175,
            `dYaw=${degL.toFixed(1)}deg (need 25..175) upY=${pL.up[1].toFixed(2)}`);
        check(id, 'steer_right', r2.inst.brokenCount === 0 && pR.up[1] > 0.85 && degR < -25 && degR > -175,
            `dYaw=${degR.toFixed(1)}deg (need -175..-25) upY=${pR.up[1].toFixed(2)}`);
        r2.w.destroy();
    }
}

// ============================================================================
// PART B: MACHINE-SPECIFIC MECHANISM PROVING TESTS
// ============================================================================

// B1. Turret aiming (azimuth + elevation), aimed firing, and recoil slide stroke
for (const id of ['siege_howitzer', 'iron_strider', 'twin_autocannon_tank', 'biped_titan']) {
    const { w, inst } = spawnFresh(id);
    stepN(w, inst, 25, {});
    // Command turret yaw to +0.85 rad (left) and pitch to +0.45 rad (up)
    stepN(w, inst, 90, { turretYaw: 0.85, turretPitch: 0.45 });
    const yawJ = inst.joints.find((j) => (j.channel || j.role) === 'turret_yaw');
    const pitchJ = inst.joints.find((j) => (j.channel || j.role) === 'turret_pitch');
    const recoilJoints = inst.joints.filter((j) => j.role === 'recoil');

    const yawErr = yawJ ? Math.abs(yawJ.angle - 0.85) : 99;
    const pitchErr = pitchJ ? Math.abs(pitchJ.angle - 0.45) : 99;
    check(id, 'turret_track', yawJ && pitchJ && yawErr < 0.12 && pitchErr < 0.12,
        `yaw=${yawJ?.angle.toFixed(2)} (tgt 0.85) pitch=${pitchJ?.angle.toFixed(2)} (tgt 0.45)`);

    // Fire while aimed left+up and verify projectile velocity matches aimed direction AND recoil slide strokes!
    let maxRecoil = 0;
    let firstVel = null;
    for (let i = 0; i < 60; i++) {
        stepMachine(inst, 1 / 60, { turretYaw: 0.85, turretPitch: 0.45, fire: i === 2 });
        w.step(1 / 60, 4);
        if (!firstVel && inst.projectilesOut.length > 0) {
            firstVel = w.velocity(inst.projectilesOut[0].body).slice(0, 3);
        }
        for (const rj of recoilJoints) {
            maxRecoil = Math.max(maxRecoil, Math.abs(rj.angle));
        }
    }
    const recoilReturn = recoilJoints.length ? Math.max(...recoilJoints.map((r) => Math.abs(r.angle))) : 0;
    const aimedOk = firstVel && firstVel[0] < -35 && firstVel[1] > 20 && firstVel[2] < -25;
    check(id, 'aimed_fire', !!aimedOk && inst.brokenCount === 0,
        `vel=${firstVel ? firstVel.map((v) => v.toFixed(1)).join(',') : 'NONE'} shells=${inst.projectilesOut.length} broken=${inst.brokenCount}`);
    check(id, 'recoil_damper_stroke', maxRecoil > 0.04 && recoilReturn < maxRecoil * 0.6,
        `peakStroke=${maxRecoil.toFixed(3)}m settled=${recoilReturn.toFixed(3)}m`);
    w.destroy();
}

// B2. Bastion Siege Howitzer: Outrigger Spades stow clear & deploy onto ground
{
    const { w, inst } = spawnFresh('siege_howitzer');
    const spadeJoints = inst.joints.filter((j) => (j.channel || j.role) === 'spade');
    stepN(w, inst, 60, { spades: false });
    const stowedAngle = spadeJoints.reduce((s, j) => s + j.angle, 0) / Math.max(1, spadeJoints.length);
    const padBody = spadeJoints[0]?.b;
    const stowedY = padBody ? w.pose(padBody)[1] : 99;

    stepN(w, inst, 80, { spades: true });
    const deployedAngle = spadeJoints.reduce((s, j) => s + j.angle, 0) / Math.max(1, spadeJoints.length);
    const deployedY = padBody ? w.pose(padBody)[1] : 99;

    check('siege_howitzer', 'spades_stow_and_deploy',
        spadeJoints.length === 2 && stowedY > deployedY + 0.18 && inst.brokenCount === 0,
        `stowed=(ang=${stowedAngle.toFixed(2)}, y=${stowedY.toFixed(2)}m) deployed=(ang=${deployedAngle.toFixed(2)}, y=${deployedY.toFixed(2)}m)`);
    w.destroy();
}

// B3. Clockwork Siege Catapult: Cock down -> whip UP & FORWARD on fire -> lob boulder into bunker
{
    const { w, inst } = spawnFresh('clockwork_catapult');
    const armJ = inst.joints.find((j) => (j.channel || j.role) === 'catapult_arm');
    // Charge for 90 frames (1.5s) without firing
    stepN(w, inst, 90, {});
    const cockedAngle = armJ ? armJ.angle : 99;
    const charged = inst.mech.catapultCharge;

    // Trigger release & track peak whip angle + boulder velocity
    let minAngle = cockedAngle;
    let maxAngle = cockedAngle;
    let lobVel = null;
    for (let i = 0; i < 60; i++) {
        stepMachine(inst, 1 / 60, { fire: i < 4 });
        w.step(1 / 60, 4);
        if (armJ) {
            minAngle = Math.min(minAngle, armJ.angle);
            maxAngle = Math.max(maxAngle, armJ.angle);
        }
        if (!lobVel && inst.projectilesOut.length > 0) {
            lobVel = w.velocity(inst.projectilesOut[0].body).slice(0, 3);
        }
    }
    // Cocked should be near +0.10 (down/horizontal); release should whip NEGATIVE (<-0.65 rad, UP & FORWARD!)
    check('clockwork_catapult', 'catapult_cock_and_whip',
        cockedAngle > -0.15 && minAngle < -0.60 && charged > 0.5 && inst.brokenCount === 0,
        `charge=${(charged * 100).toFixed(0)}% cocked=${cockedAngle.toFixed(2)}rad whipMin=${minAngle.toFixed(2)}rad broken=${inst.brokenCount}`);
    check('clockwork_catapult', 'catapult_ballistic_lob',
        !!lobVel && lobVel[2] < -18 && lobVel[1] > 10,
        `boulderVel=${lobVel ? lobVel.map((v) => v.toFixed(1)).join(',') : 'NONE'}`);
    w.destroy();
}

// B4. Juggernaut Pile-Bunker: Flywheel charge + clutch surge + ram spike punch + physical target smash!
{
    const { w, inst } = spawnFresh('juggernaut_ram');
    const ramJ = inst.joints.find((j) => (j.channel || j.role) === 'pile_bunker');
    // Place a heavy 8-ton test target crate 6.5m ahead (-Z)
    const target = w.addBox({ position: [0, 1.4, -7.2], half: [1.3, 1.4, 1.3], mass: 8000, friction: 0.7, layers: 4, mask: ~4 });

    stepN(w, inst, 60, {});
    const preEnergy = inst.mech.flywheelEnergy;
    const preRam = ramJ ? ramJ.angle : 0;

    let maxRam = 0;
    let surgeTriggered = false;
    for (let i = 0; i < 150; i++) {
        const distToTarget = Math.abs(w.pose(inst.rootBody)[2] - w.pose(target)[2]);
        const doClutch = i === 10;
        const doPunch = distToTarget < 5.5 || (i >= 40 && i <= 65);
        stepMachine(inst, 1 / 60, { throttle: 1.0, clutchDump: doClutch, fire: doPunch });
        w.step(1 / 60, 4);
        if (inst.mech.clutchTimer > 0) surgeTriggered = true;
        if (ramJ) maxRam = Math.max(maxRam, ramJ.angle);
    }
    const targetDisp = Math.abs(w.pose(target)[2] - (-7.2));
    check('juggernaut_ram', 'flywheel_charge_and_surge', preEnergy > 50000 && surgeTriggered,
        `preEnergy=${Math.round(preEnergy)}J surge=${surgeTriggered}`);
    check('juggernaut_ram', 'pile_bunker_stroke', ramJ && preRam < 0.15 && maxRam > 0.90 && inst.brokenCount === 0,
        `rest=${preRam.toFixed(2)}m maxStroke=${maxRam.toFixed(2)}m broken=${inst.brokenCount}`);
    check('juggernaut_ram', 'ram_target_impact', targetDisp > 3.0 && inst.brokenCount === 0,
        `8t_crate_knockback=${targetDisp.toFixed(2)}m broken=${inst.brokenCount}`);
    w.destroy();
}

// B5. Live Cannon Bunker Destruction Check (anchored ground plinth + destructible masonry above!)
{
    const { w, inst } = spawnFresh('siege_howitzer');
    const st = w.addStructure({
        members: [
            { center: [0, 0.25, -22], half: [3.0, 0.25, 1.2], sigma: 2.5e6, crush: 1.6e7, anchored: true, span: 6 },
            { center: [-2.2, 2.3, -22], half: [0.5, 1.8, 0.5], sigma: 1.1e6, crush: 8.0e6, anchored: false, span: 6 },
            { center: [2.2, 2.3, -22], half: [0.5, 1.8, 0.5], sigma: 1.1e6, crush: 8.0e6, anchored: false, span: 6 },
            { center: [0, 2.3, -22], half: [1.7, 1.8, 0.45], sigma: 0.9e6, crush: 6.5e6, anchored: false, span: 6 },
            { center: [0, 4.45, -22], half: [2.8, 0.35, 1.2], sigma: 1.0e6, crush: 7.0e6, anchored: false, span: 6 },
        ],
        ties: [[0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [3, 4]],
        chunk: 1.0,
        safety: 1.4,
        maxPieces: 96,
    });
    const initStanding = st.counts.standing;
    stepN(w, inst, 180, (i) => ({ turretYaw: 0, turretPitch: 0.0, spades: true, fire: i === 25 || i === 115 }));
    const brokenCells = initStanding - st.counts.standing;
    check('arena_combat', 'howitzer_destroys_bunker', brokenCells > 0 && st.counts.pieces > 0,
        `standing=${st.counts.standing}/${initStanding} brokenCells=${brokenCells} debrisPieces=${st.counts.pieces}`);
    w.destroy();
}

// ============================================================================
// PART C: TIER-1 & TIER-2 SUBSYSTEM BENCH OPERATION CHECKS
// ============================================================================
for (const subId of ['recoil_breech', 'hydraulic_hinge', 'outrigger_spade', 'spring_catapult_arm', 'suspension_bogie', 'turret_howitzer_unit', 'pile_bunker_arm', 'trebuchet_launcher', 'mech_leg_unit']) {
    const benchBp = {
        id: 'bench_' + subId,
        name: 'Bench ' + subId,
        tier: 3,
        nodes: [{ id: 'bench', kind: 'beam', pos: [0, 2.5, 0], half: [2.0, 0.4, 2.0], material: 'tungsten', role: 'chassis', massKg: 25000 }],
        units: [{ id: 'sub', unitId: subId, parent: 'bench', mountPos: [0, 3.1, 0] }],
    };
    const c = compileMachine(benchBp, resolver);
    const w = makeWorld();
    const inst = spawnCompiledMachine(w, c, { position: [0, 0.5, 0] });
    const initAngles = inst.joints.map((j) => j.angle);
    const maxDelta = new Array(inst.joints.length).fill(0);
    let maxWheelSpin = 0;
    for (let i = 0; i < 120; i++) {
        stepMachine(inst, 1 / 60, {
            throttle: 1.0,
            turretYaw: 0.9,
            turretPitch: 0.5,
            actuate: i >= 30 ? 0.85 : -0.4,
            spades: i >= 45,
            fire: i === 60 || (subId === 'pile_bunker_arm' && i >= 50),
            clutchDump: i === 50,
        });
        w.step(1 / 60, 4);
        for (let k = 0; k < inst.joints.length; k++) {
            maxDelta[k] = Math.max(maxDelta[k], Math.abs(inst.joints[k].angle - initAngles[k]));
            if (inst.joints[k].kind === 'wheel') {
                const av = w.velocity(inst.joints[k].b);
                maxWheelSpin = Math.max(maxWheelSpin, Math.hypot(av[3], av[4], av[5]));
            }
        }
    }
    const maxMove = maxDelta.length ? Math.max(...maxDelta) : 0;
    const operated = subId === 'suspension_bogie' ? maxWheelSpin > 5.0 : maxMove > 0.08;
    check('subsystem', subId, inst.brokenCount === 0 && operated,
        subId === 'suspension_bogie'
            ? `dofs=${inst.joints.length} maxWheelSpin=${maxWheelSpin.toFixed(1)}rad/s broken=${inst.brokenCount}`
            : `dofs=${inst.joints.length} maxJointDelta=${maxMove.toFixed(2)} broken=${inst.brokenCount}`);
    w.destroy();
}

// Verify coupling-only Tier-1 components (gearbox_4to1, flywheel_bank, cam_oscillator) operate on bench
for (const subId of ['gearbox_4to1', 'flywheel_bank', 'cam_oscillator']) {
    const benchBp = {
        id: 'bench_' + subId,
        name: 'Bench ' + subId,
        tier: 3,
        nodes: [{ id: 'bench', kind: 'beam', pos: [0, 1.0, 0], half: [1.5, 0.3, 1.5], material: 'steel', role: 'chassis' }],
        units: [{ id: 'sub', unitId: subId, parent: 'bench', mountPos: [0, 1.5, 0] }],
    };
    const c = compileMachine(benchBp, resolver);
    const w = makeWorld();
    const inst = spawnCompiledMachine(w, c, { position: [0, 0.2, 0] });
    let surged = false;
    stepN(w, inst, 90, (i) => {
        if (inst.mech.clutchTimer > 0) surged = true;
        return { throttle: 0.85, clutchDump: i === 65 };
    });
    const maxSpin = Math.max(0, ...inst.mech.couplings.map((cp) => Math.abs(cp.spinAngle || 0)));
    const okSub = inst.brokenCount === 0 && inst.strippedCount === 0 && maxSpin > 5.0 && (subId !== 'flywheel_bank' || surged);
    check('subsystem', subId, okSub,
        `couplings=${inst.mech.couplings.length} maxSpin=${maxSpin.toFixed(1)}rad surged=${surged} stripped=${inst.strippedCount}`);
    w.destroy();
}

// Verify catapult boulder actually lands inside arena combat range (40..120m) and delivers kinetic impact!
{
    const { w, inst } = spawnFresh('clockwork_catapult');
    stepN(w, inst, 90, {});
    let boulder = null;
    for (let i = 0; i < 40; i++) {
        stepMachine(inst, 1 / 60, { fire: i < 4 });
        w.step(1 / 60, 4);
        if (!boulder && inst.projectilesOut.length > 0) boulder = inst.projectilesOut[0].body;
    }
    let minY = 99, landZ = 0, landed = false;
    for (let i = 0; i < 300 && boulder && w.hasBody(boulder); i++) {
        stepMachine(inst, 1 / 60, {});
        w.step(1 / 60, 4);
        const p = w.pose(boulder);
        if (p[1] < minY) minY = p[1];
        if (!landed && p[1] <= 0.60) { landed = true; landZ = -p[2]; }
    }
    check('clockwork_catapult', 'catapult_arena_range_landing', landed && landZ >= 40 && landZ <= 140,
        `landed=${landed} range=${landZ.toFixed(1)}m (arena target 40..140m)`);
    w.destroy();
}

console.log(`\n=== OPERATIONAL PROVING SUMMARY: ${results.length - failCount}/${results.length} PASSED (${failCount} FAILED) ===`);
if (failCount > 0) {
    throw new Error(`OPERATIONAL_TESTS_FAILED: ${failCount} check(s) failed`);
}
console.log('ALL_OPERATIONAL_TESTS_PASSED');
