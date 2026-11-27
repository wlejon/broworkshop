// lib/foundry/arena.js — The Macro Physics Seam + 3D Combat Arena (bro.dynamics / Box3D).
//
// Proves the Two-Engine + Narrow Seam architecture:
//   - Outer Engine (Box3D): each compiled machine is ONLY 1 compound chassis body +
//     at most 1 articulated macro weapon body (hinge), battling in a physically
//     grounded 12x12 m arena with destructible concrete pillars (world.addStructure!).
//   - Inner Engine (runtime.js): runs every nested sub-assembly (gears, bearings,
//     slip clutches, shear pins, motors) in microseconds per tick.
//   - Narrow Seam (60 Hz):
//       Inner -> Outer: drive traction forces + weapon drive torque & reaction torque.
//       Outer -> Inner: Box3D collision impulses, weapon stall deceleration shocks,
//                       and ground traction resistance flow right back into the
//                       compiled machine's ports, triggering real wear & cascades!

import { createMachineRuntime } from "./runtime.js";

const PI = Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function qFromY(yaw) { return [0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5)]; }
function qRot(q, v) {
    const [qx, qy, qz, qw] = q, [vx, vy, vz] = v;
    const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
    return [
        vx + qw * tx + (qy * tz - qz * ty),
        vy + qw * ty + (qz * tx - qx * tz),
        vz + qw * tz + (qx * ty - qy * tx),
    ];
}
function yawOf(q) {
    const f = qRot(q, [0, 0, 1]);
    return Math.atan2(f[0], f[2]);
}
function wrapAngle(a) {
    while (a > PI) a -= 2 * PI;
    while (a < -PI) a += 2 * PI;
    return a;
}

/**
 * Create a live Box3D combat arena with destructible concrete obstacles and
 * any number of compiled machines. Works identically headless or with a 3D view.
 */
export function createArena(opts = {}) {
    const halfSize = opts.halfSize ?? 5.5;
    const world = bro.dynamics.createWorld({ gravity: [0, -9.81, 0] });
    world.hitSpeed = 0.6;

    // Arena floor & 4 steel perimeter walls (layer 1)
    const wallH = 0.9, wallT = 0.3;
    world.addBox({ position: [0, -0.5, 0], half: [halfSize + 1, 0.5, halfSize + 1], mass: 0, friction: 0.85, layers: 1 });
    world.addBox({ position: [0, wallH / 2, halfSize + wallT], half: [halfSize + wallT, wallH / 2, wallT], mass: 0, restitution: 0.35, layers: 1 });
    world.addBox({ position: [0, wallH / 2, -halfSize - wallT], half: [halfSize + wallT, wallH / 2, wallT], mass: 0, restitution: 0.35, layers: 1 });
    world.addBox({ position: [halfSize + wallT, wallH / 2, 0], half: [wallT, wallH / 2, halfSize + wallT], mass: 0, restitution: 0.35, layers: 1 });
    world.addBox({ position: [-halfSize - wallT, wallH / 2, 0], half: [wallT, wallH / 2, halfSize + wallT], mass: 0, restitution: 0.35, layers: 1 });

    // Destructible masonry/concrete arena barriers using bro.dynamics::Structure
    // (the EXACT same structural destruction system used in Metropolis!).
    const structures = [];
    if (opts.obstacles !== false) {
        const pillarSpecs = opts.pillarPositions || [
            { x: 0, z: -2.6, w: 0.9, h: 0.9, d: 0.35 },
            { x: 0, z: 2.6,  w: 0.9, h: 0.9, d: 0.35 },
        ];
        for (const ps of pillarSpecs) {
            const st = world.addStructure({
                frames: [{ position: [ps.x, 0, ps.z], rotation: [0, 0, 0, 1] }],
                members: [
                    { center: [0, 0.04, 0], half: [ps.w * 0.55, 0.04, ps.d * 0.6], anchored: true },
                    { center: [0, 0.08 + ps.h * 0.5, 0], half: [ps.w * 0.5, ps.h * 0.5, ps.d * 0.5],
                      sigma: 0.065e6, crush: 0.65e6, give: 0.004, mass: 120 },
                ],
                ties: [[0, 1]],
                chunk: 0.28,
                safety: 1.5,
                layers: 1,
            });
            structures.push({ spec: ps, structure: st });
        }
    }

    const bots = [];
    const bodyToBot = new Map();
    const fxEvents = []; // sparks / impacts / breaks for visual renderer
    let simTime = 0;

    /**
     * Spawn a compiled machine across the Narrow Seam into Box3D.
     * Each bot uses ONLY 1 chassis body (+ 1 hinged weapon body if armed).
     */
    function spawnBot(compiled, cfg = {}) {
        const idx = bots.length;
        const teamLayer = 1 << (idx + 1); // Bot 0 = layer 2, Bot 1 = layer 4, etc.
        const pos = cfg.position || [idx === 0 ? -2.4 : 2.4, 0.22, 0];
        const yaw = cfg.yaw ?? (idx === 0 ? PI / 2 : -PI / 2);
        const rot = qFromY(yaw);

        const [W, H, L] = compiled.macroSize;
        const hw = Math.max(0.22, W * 0.5);
        const hh = Math.max(0.09, H * 0.5);
        const hl = Math.max(0.26, L * 0.5);
        const mass = Math.max(8, compiled.massKg);

        const chassisBody = world.addBox({
            position: [pos[0], hh + 0.04, pos[2]],
            rotation: rot,
            half: [hw, hh, hl],
            mass,
            friction: 0.25,          // low base slide friction; wheel traction is applied explicitly!
            restitution: 0.22,
            linearDamping: 0.25,
            angularDamping: 2.4,
            layers: teamLayer,
            mask: ~teamLayer,        // never self-collide with own weapon body
        });

        // Optional macro weapon body (1 single Box3D body on a hinge!)
        // Positioned at the compiled blueprint's EXACT CAD offset from the chassis frame so the
        // 3D rendered weapon bolts flush onto the real turret / nose bulkhead (1:1 with Dyno Bench).
        const framePart = compiled.parts.find((p) => p.type === 'frame');
        const refC = framePart ? framePart.pos3d : compiled.bounds.center;
        let weaponBody = null, weaponJoint = null, weaponKind = null, weaponHead = null;
        if (compiled.weaponChain) {
            weaponHead = compiled.weaponChain.stages[compiled.weaponChain.stages.length - 1].part;
            weaponKind = weaponHead.analysis.weaponKind;
            const wm = Math.max(2, weaponHead.analysis.massKg);
            const wr = Math.max(0.16, weaponHead.analysis.radiusM);
            const cadOff = [
                weaponHead.pos3d[0] - refC[0],
                weaponHead.pos3d[1] - refC[1],
                weaponHead.pos3d[2] - refC[2],
            ];

            if (weaponKind === 'spinner_bar') {
                const offW = qRot(rot, cadOff);
                const wPos = [pos[0] + offW[0], hh + 0.04 + offW[1], pos[2] + offW[2]];
                weaponBody = world.addBox({
                    position: wPos,
                    rotation: rot,
                    half: [wr, 0.03, 0.055],
                    mass: wm,
                    friction: 0.4,
                    restitution: 0.45,
                    angularDamping: 0.15,
                    layers: teamLayer,
                    mask: ~teamLayer,
                });
                weaponJoint = world.addJoint({
                    kind: 'hinge',
                    a: chassisBody,
                    b: weaponBody,
                    anchor: wPos,
                    axis: [0, 1, 0],
                    collide: false,
                    enableMotor: true,
                    motorSpeed: 0,
                    maxMotor: 100,
                });
            } else if (weaponKind === 'spinner_drum') {
                const offW = qRot(rot, cadOff);
                const wPos = [pos[0] + offW[0], hh + 0.04 + offW[1], pos[2] + offW[2]];
                const axis = qRot(rot, [1, 0, 0]);
                weaponBody = world.addBox({
                    position: wPos,
                    rotation: rot,
                    half: [wr * 1.1, wr, wr],
                    mass: wm,
                    friction: 0.5,
                    restitution: 0.55,
                    angularDamping: 0.12,
                    layers: teamLayer,
                    mask: ~teamLayer,
                });
                weaponJoint = world.addJoint({
                    kind: 'hinge',
                    a: chassisBody,
                    b: weaponBody,
                    anchor: wPos,
                    axis,
                    collide: false,
                    enableMotor: true,
                    motorSpeed: 0,
                    maxMotor: 120,
                });
            } else if (weaponKind === 'hammer_arm' || weaponKind === 'crusher_jaw' || weaponKind === 'flipper_spatula' || weaponKind === 'piledriver_spear' || weaponKind === 'fork_lifter' || weaponKind === 'grapple_claw' || weaponKind === 'trebuchet_arm' || weaponKind === 'excavator_boom') {
                const isFlip = weaponKind === 'flipper_spatula' || weaponKind === 'fork_lifter';
                const isCrush = weaponKind === 'crusher_jaw' || weaponKind === 'grapple_claw' || weaponKind === 'excavator_boom';
                const isSpear = weaponKind === 'piledriver_spear';
                const isTreb = weaponKind === 'trebuchet_arm';
                const pivotLocal = isFlip ? [0, -hh * 0.20, hl + 0.02]
                    : weaponKind === 'excavator_boom' ? [0, hh * 0.55, hl * 0.45]
                    : isCrush ? [0, hh * 0.40, hl * 0.58]
                    : isSpear ? [0, hh * 0.1, hl + 0.05]
                    : isTreb ? [0, hh + 0.14, hl * 0.25]
                    : [0, hh + 0.08, 0.05];
                const pivotW = qRot(rot, pivotLocal);
                const anchor = [pos[0] + pivotW[0], hh + 0.04 + pivotW[1], pos[2] + pivotW[2]];
                const headLocal = isFlip ? [0, -hh * 0.12, hl + wr * 0.55]
                    : weaponKind === 'excavator_boom' ? cadOff
                    : isCrush ? [0, hh * 0.35, hl + wr * 0.42]
                    : isSpear ? [0, hh * 0.1, hl + wr * 0.65]
                    : isTreb ? [0, hh + 0.18, hl * 0.45]
                    : [0, hh + 0.08 + wr * 0.5, 0.05];
                const headW = qRot(rot, headLocal);
                const wPos = [pos[0] + headW[0], hh + 0.04 + headW[1], pos[2] + headW[2]];
                const axis = qRot(rot, [1, 0, 0]);
                weaponBody = world.addBox({
                    position: wPos,
                    rotation: rot,
                    half: isFlip ? [wr * 0.65, 0.06, wr * 0.55]
                        : weaponKind === 'grapple_claw' ? [wr * 0.58, 0.07, wr * 0.52]
                        : [0.07, wr * 0.42, wr * 0.55],
                    mass: wm,
                    friction: 0.5,
                    restitution: 0.35,
                    layers: teamLayer,
                    mask: ~teamLayer,
                });
                weaponJoint = world.addJoint({
                    kind: 'hinge',
                    a: chassisBody,
                    b: weaponBody,
                    anchor,
                    axis,
                    collide: false,
                    enableLimit: true,
                    lower: isFlip ? -0.9 : isTreb ? -1.1 : -0.4,
                    upper: isFlip ? 0.15 : isTreb ? 0.8 : 1.6,
                    enableMotor: true,
                    motorSpeed: 0,
                    maxMotor: 260,
                });
            }
        }

        const runtime = createMachineRuntime(compiled, { label: cfg.label || compiled.name });
        const bot = {
            id: idx,
            label: cfg.label || compiled.name,
            team: cfg.team ?? idx,
            color: cfg.color || (idx === 0 ? '#f59e0b' : '#38bdf8'),
            compiled,
            runtime,
            controller: cfg.controller || 'duelist',
            chassisBody,
            weaponBody,
            weaponJoint,
            weaponKind,
            weaponHead,
            half: [hw, hh, hl],
            prevWeaponOmega: 0,
            prevLinVel: [0, 0, 0],
            hammerStrikeTimer: 0,
            lastActiveStrikeAt: -10,
            hitsDealt: 0,
            hitsTaken: 0,
            manual: { throttle: 0, steer: 0, weapon: 1, fire: false },
            lastEventCount: 0,
            ai: {
                state: 'flank_spin', // 'flank_spin' | 'charge' | 'retreat' | 'evade_wall'
                timer: idx === 0 ? 0.65 : 0.85,
                flankDir: idx === 0 ? 1 : -1,
                clinchTimer: 0,
                stuckTimer: 0,
                flippedTimer: 0,
                lastHitsTotal: 0,
            },
        };
        bots.push(bot);
        bodyToBot.set(chassisBody, { bot, part: 'chassis' });
        if (weaponBody != null) bodyToBot.set(weaponBody, { bot, part: 'weapon' });
        return bot;
    }

    /** Compute autonomous multi-pass tactical AI or manual control inputs for a bot. */
    function controlFor(bot, dt) {
        if (bot.controller === 'manual') {
            const t = clamp(bot.manual.throttle, -1, 1);
            const s = clamp(bot.manual.steer, -1, 1);
            return {
                throttleL: clamp(t + s * 0.85, -1, 1),
                throttleR: clamp(t - s * 0.85, -1, 1),
                weaponThrottle: bot.manual.weapon,
                fireTrigger: bot.manual.fire,
            };
        }
        if (bot.controller === 'idle') {
            return { throttleL: 0, throttleR: 0, weaponThrottle: 0, fireTrigger: false };
        }
        if (bot.controller === 'pillar_ram') {
            const p = world.pose(bot.chassisBody);
            const vel = world.velocity(bot.chassisBody);
            const target = structures.length ? [structures[0].spec.x, structures[0].spec.z] : [0, 0];
            const dx = target[0] - p[0], dz = target[1] - p[2];
            const dist = Math.hypot(dx, dz);
            const speed = Math.hypot(vel[0], vel[2]);
            const ai = bot.ai;
            if (dist < 1.25 && speed < 0.5) ai.clinchTimer += dt; else ai.clinchTimer = 0;
            if (ai.clinchTimer > 0.7) { ai.state = 'retreat'; ai.timer = 1.2; ai.clinchTimer = 0; }
            if (ai.state === 'retreat') {
                ai.timer -= dt;
                if (ai.timer <= 0 || dist > 2.8) ai.state = 'charge';
                return { throttleL: -0.9, throttleR: -0.82, weaponThrottle: 1.0, fireTrigger: false };
            }
            const desired = Math.atan2(dx, dz);
            const err = wrapAngle(desired - yawOf([p[3], p[4], p[5], p[6]]));
            const steer = clamp(err * 1.9, -1, 1);
            const fwd = Math.abs(err) < 0.8 ? 0.98 : 0.28;
            return {
                throttleL: clamp(fwd + steer * 0.7, -1, 1),
                throttleR: clamp(fwd - steer * 0.7, -1, 1),
                weaponThrottle: 1.0,
                fireTrigger: dist < 1.35,
            };
        }

        // --- Multi-Pass BattleBots Tactical Combat AI ---
        const opp = bots.find((b) => b !== bot);
        if (!opp) return { throttleL: 0, throttleR: 0, weaponThrottle: 1, fireTrigger: false };

        const ai = bot.ai;
        const p = world.pose(bot.chassisBody);
        const op = world.pose(opp.chassisBody);
        const vel = world.velocity(bot.chassisBody);
        const speed = Math.hypot(vel[0], vel[2]);
        const dx = op[0] - p[0], dz = op[2] - p[2];
        const dist = Math.hypot(dx, dz);
        const yaw = yawOf([p[3], p[4], p[5], p[6]]);
        const toOpp = Math.atan2(dx, dz);
        const errOpp = wrapAngle(toOpp - yaw);

        // Track hits, clinch deadlock, and wall stalls
        const hitsTotal = bot.hitsDealt + bot.hitsTaken;
        const justHit = hitsTotal > ai.lastHitsTotal;
        ai.lastHitsTotal = hitsTotal;

        if (dist < 1.25) ai.clinchTimer += dt; else ai.clinchTimer = Math.max(0, ai.clinchTimer - dt * 2);
        if (speed < 0.35) ai.stuckTimer += dt; else ai.stuckTimer = Math.max(0, ai.stuckTimer - dt * 2);

        const nearWall = Math.abs(p[0]) > halfSize - 0.85 || Math.abs(p[2]) > halfSize - 0.85;
        const wch = bot.compiled.weaponChain;
        const wcs = wch ? bot.runtime.chainState.get(wch.id) : null;
        const isSpinner = bot.weaponKind === 'spinner_bar' || bot.weaponKind === 'spinner_drum';
        const spinFrac = (isSpinner && wch && wcs && !wcs.broken)
            ? Math.abs(wcs.omegaOut) / Math.max(10, wch.noLoadRpmOut * (2 * PI / 60))
            : 1.0;

        ai.timer -= dt;

        // State transitions: break clinches cleanly, retreat after big hits, flank & re-charge!
        if (ai.state === 'charge') {
            if ((justHit && dist < 1.35 && ai.timer < 1.7) || ai.clinchTimer > 0.85 || ai.stuckTimer > 0.95) {
                ai.state = 'retreat';
                ai.timer = 1.15 + (bot.id * 0.25);
                ai.flankDir = -ai.flankDir;
                ai.clinchTimer = 0;
                ai.stuckTimer = 0;
            } else if (ai.timer <= 0) {
                ai.state = 'flank_spin';
                ai.timer = 1.1;
            }
        } else if (ai.state === 'retreat') {
            if (dist > 2.45 || ai.timer <= 0) {
                ai.state = 'flank_spin';
                ai.timer = isSpinner ? 1.15 : 0.65;
            }
        } else if (ai.state === 'evade_wall') {
            if ((!nearWall && ai.timer <= 0.2) || ai.timer <= 0) {
                ai.state = 'flank_spin';
                ai.timer = 0.9;
            }
        } else {
            // flank_spin: arc wide to spin up weapon & line up flank shot, then CHARGE!
            if (ai.stuckTimer > 0.9 && nearWall) {
                ai.state = 'evade_wall';
                ai.timer = 1.0;
                ai.stuckTimer = 0;
            } else if ((spinFrac > 0.62 && Math.abs(errOpp) < 0.65 && ai.timer < 0.6) || ai.timer <= 0) {
                ai.state = 'charge';
                ai.timer = 2.4;
            }
        }

        let fwd = 0, steer = 0;
        if (ai.state === 'retreat') {
            // Back away briskly with a J-turn toward arena center so we never back into a corner!
            const toCenter = Math.atan2(-p[0], -p[2]);
            const errC = wrapAngle(toCenter - yaw);
            fwd = nearWall ? 0.65 : -0.92;
            steer = nearWall ? clamp(errC * 2.2, -1, 1) : ai.flankDir * 0.72;
        } else if (ai.state === 'evade_wall') {
            const toCenter = Math.atan2(-p[0], -p[2]);
            const errC = wrapAngle(toCenter - yaw);
            fwd = Math.abs(errC) < 1.0 ? 0.85 : -0.75;
            steer = clamp(errC * 2.2, -1, 1);
        } else if (ai.state === 'flank_spin') {
            // Aim at a flanking arc point ±1.35 m perpendicular to enemy so bots weave & circle!
            const invD = 1 / Math.max(0.5, dist);
            const perpX = -dz * invD * ai.flankDir;
            const perpZ = dx * invD * ai.flankDir;
            const lead = clamp(dist * 0.45, 0.6, 1.5);
            const tx = clamp(op[0] + perpX * lead, -halfSize + 1.1, halfSize - 1.1);
            const tz = clamp(op[2] + perpZ * lead, -halfSize + 1.1, halfSize - 1.1);
            const errFlank = wrapAngle(Math.atan2(tx - p[0], tz - p[2]) - yaw);
            steer = clamp(errFlank * 2.0, -1, 1);
            fwd = Math.abs(errFlank) < 0.9 ? 0.72 : 0.22;
        } else {
            // CHARGE: full throttle intercept!
            steer = clamp(errOpp * 2.3, -1, 1);
            fwd = Math.abs(errOpp) < 0.75 ? 1.0 : 0.25;
        }

        const fireTrigger = dist < 1.45 && Math.abs(errOpp) < 0.55;
        return {
            throttleL: clamp(fwd + steer * 0.82, -1, 1),
            throttleR: clamp(fwd - steer * 0.82, -1, 1),
            weaponThrottle: 1.0,
            fireTrigger,
        };
    }

    /** Step the entire coupled Macro (Box3D) + Inner (Compiled Runtime) arena by `dt`. */
    function step(dt = 1 / 60) {
        simTime += dt;
        fxEvents.length = 0;

        // --- 1. Inspect hits from previous step & measure real macro shock loads ---
        const pendingLoads = bots.map(() => ({
            loadL: 0, loadR: 0, shockL: 0, shockR: 0, radialL: 0, radialR: 0,
            weaponDragNm: 0, weaponShockNm: 0, weaponRadialN: 0,
            impactImpulseNs: 0, impactFace: 'front',
        }));

        const hits = world.hits();
        for (let i = 0; i < hits.length; i += 9) {
            const bA = hits[i] | 0, bB = hits[i + 1] | 0;
            const pt = [hits[i + 2], hits[i + 3], hits[i + 4]];
            const nrm = [hits[i + 5], hits[i + 6], hits[i + 7]];
            const speed = hits[i + 8];
            if (speed < 0.8) continue;

            const infoA = bodyToBot.get(bA);
            const infoB = bodyToBot.get(bB);

            const applyHitOn = (info, otherBody, sign) => {
                if (!info) return;
                const bot = info.bot;
                const ld = pendingLoads[bot.id];
                const mSelf = world.mass(info.part === 'weapon' ? bot.weaponBody : bot.chassisBody);
                const mOther = world.hasBody(otherBody) ? world.mass(otherBody) : 0;
                const effM = mOther > 0 ? (mSelf * mOther) / (mSelf + mOther) : mSelf;
                const impulse = effM * speed * 1.15;

                if (info.part === 'weapon' && bot.compiled.weaponChain) {
                    const cs = bot.runtime.chainState.get(bot.compiled.weaponChain.id);
                    const wr = bot.weaponHead?.analysis.radiusM || 0.3;
                    const tipSpeed = Math.abs(cs.omegaOut) * wr;
                    const isSpinner = bot.weaponKind === 'spinner_bar' || bot.weaponKind === 'spinner_drum';
                    // Real kinetic collision: elastic steel/hydraulic compliance absorbs glancing blows
                    // so protected (SAFE) machines survive multiple impacts via clutch slip / relief bleed,
                    // while unprotected drivetrains still suffer real wear & tooth stripping!
                    const contactSec = isSpinner ? 0.068 : 0.12;
                    const shockImpulse = effM * Math.max(speed * 0.7, isSpinner ? tipSpeed * 0.36 : speed * 0.6);
                    const shockTorque = (shockImpulse / contactSec) * wr * (isSpinner ? 0.16 : 0.10);
                    ld.weaponShockNm += Math.min(260, shockTorque);
                    ld.weaponRadialN += Math.min(3500, (shockImpulse / contactSec) * 0.28);
                    bot.hitsDealt++;
                    // Transfer real kinetic knockback to the target body if weapon is spinning fast!
                    if (isSpinner && tipSpeed > 4 && world.hasBody(otherBody) && mOther > 0) {
                        const kick = Math.min(440, bot.compiled.weaponChain.reflectedInertiaOut * Math.abs(cs.omegaOut) / wr * 1.45);
                        world.applyImpulse(otherBody, [-nrm[0] * sign * kick, kick * 0.26, -nrm[2] * sign * kick], pt);
                        // Slow down the spinning rotor by energy transferred!
                        cs.omegaOut *= 0.55;
                    }
                    fxEvents.push({ kind: 'weapon_hit', pos: pt, intensity: Math.min(2, shockTorque / 70), botId: bot.id });
                } else {
                    ld.impactImpulseNs += impulse;
                    // Determine which face took the hit in chassis local coords
                    const p = world.pose(bot.chassisBody);
                    const fwd = qRot([p[3], p[4], p[5], p[6]], [0, 0, 1]);
                    const rel = [pt[0] - p[0], pt[2] - p[2]];
                    const dotF = rel[0] * fwd[0] + rel[1] * fwd[2];
                    ld.impactFace = dotF > 0.15 ? 'front' : dotF < -0.15 ? 'rear' : 'side';
                    // Tires/tracks cushion lateral bumps; fraction of shock still loads wheel bearings!
                    ld.radialL += Math.min(2400, (impulse / 0.085) * 0.14);
                    ld.radialR += Math.min(2400, (impulse / 0.085) * 0.14);
                    bot.hitsTaken++;
                    if (impulse > 40) fxEvents.push({ kind: 'impact', pos: pt, intensity: Math.min(1.5, impulse / 180), botId: bot.id });
                }
            };

            applyHitOn(infoA, bB, 1);
            applyHitOn(infoB, bA, -1);
        }

        // --- 2. Step Inner Engine (Compiled Runtime) & Push Forces to Outer Engine (Box3D) ---
        for (const bot of bots) {
            const cmd = controlFor(bot, dt);
            const ld = pendingLoads[bot.id];
            const pose = world.pose(bot.chassisBody);
            const vel = world.velocity(bot.chassisBody);
            const q = [pose[3], pose[4], pose[5], pose[6]];
            const fwd = qRot(q, [0, 0, 1]);
            const right = qRot(q, [1, 0, 0]);
            const up = qRot(q, [0, 1, 0]);
            const vFwd = vel[0] * fwd[0] + vel[2] * fwd[2];
            const vLat = vel[0] * right[0] + vel[2] * right[2];

            // Measure sudden linear deceleration (e.g. hitting concrete pillar)
            const dv = Math.hypot(vel[0] - bot.prevLinVel[0], vel[2] - bot.prevLinVel[2]);
            if (dv > 2.2) ld.impactImpulseNs += bot.compiled.massKg * dv * 0.65;
            bot.prevLinVel = [vel[0], vel[1], vel[2]];

            // Measure weapon hinge stall deceleration from Box3D (avoid double-counting already recorded contact hits)
            if (bot.weaponBody != null && bot.compiled.weaponChain) {
                const wVel = world.velocity(bot.weaponBody);
                const wSpin = bot.weaponKind === 'spinner_bar' ? wVel[4] : Math.hypot(wVel[3], wVel[4], wVel[5]);
                const dw = Math.abs(wSpin - bot.prevWeaponOmega);
                if (dw > 14 && ld.weaponShockNm < 5) {
                    const J = bot.compiled.weaponChain.reflectedInertiaOut;
                    ld.weaponShockNm += Math.min(95, J * (dw / dt) * 0.12);
                }
                bot.prevWeaponOmega = wSpin;
            }

            // Ground traction resistance loads for Left/Right drivetrains
            const weightPerSide = bot.compiled.massKg * 9.81 * 0.5;
            const loadBase = (weightPerSide * 0.12) * 0.13; // rolling resistance torque
            ld.loadL = loadBase + Math.abs(cmd.throttleL) * 14 + (Math.abs(vFwd) < 0.25 && Math.abs(cmd.throttleL) > 0.5 ? 26 : 0);
            ld.loadR = loadBase + Math.abs(cmd.throttleR) * 14 + (Math.abs(vFwd) < 0.25 && Math.abs(cmd.throttleR) > 0.5 ? 26 : 0);
            ld.radialL += weightPerSide * 0.65;
            ld.radialR += weightPerSide * 0.65;

            // Step the compiled machine's internal runtime!
            bot.runtime.stepMacro(dt, {
                throttleL: cmd.throttleL,
                throttleR: cmd.throttleR,
                weaponThrottle: cmd.weaponThrottle,
                fireTrigger: cmd.fireTrigger,
                ...ld,
            });

            // Forward new failure / slip events into fxEvents for immediate 3D visual pops!
            while (bot.lastEventCount < bot.runtime.events.length) {
                const ev = bot.runtime.events[bot.lastEventCount++];
                if (ev.kind === 'fail' || ev.kind === 'CLUTCH SLIP') {
                    fxEvents.push({
                        kind: ev.kind === 'fail' ? 'part_fail' : 'clutch_slip',
                        pos: [pose[0], pose[1] + 0.18, pose[2]],
                        botId: bot.id,
                        event: ev,
                    });
                }
            }

            // Inner -> Outer: Apply Left & Right wheel traction forces to Box3D chassis!
            const grounded = pose[1] < bot.half[1] + 0.24 && up[1] > 0.45;
            if (grounded) {
                const sideForce = (chain, throttle) => {
                    if (!chain) return 0;
                    const cs = bot.runtime.chainState.get(chain.id);
                    const wheel = chain.stages[chain.stages.length - 1].part;
                    const r = wheel.analysis.radiusM || 0.13;
                    const maxTraction = weightPerSide * (wheel.analysis.grip || 1.15);
                    if (cs.seized) return -Math.sign(vFwd) * maxTraction * 0.85;
                    if (cs.broken) return 0;
                    const targetV = cs.omegaOut * r;
                    const rawF = clamp(cs.torqueOut / r + (targetV - vFwd) * bot.compiled.massKg * 2.2, -maxTraction, maxTraction);
                    return Math.abs(throttle) > 0.05 ? rawF : -vFwd * bot.compiled.massKg * 1.4;
                };
                const fL = sideForce(bot.compiled.driveL, cmd.throttleL);
                const fR = sideForce(bot.compiled.driveR, cmd.throttleR);
                const fNet = fL + fR;
                const yawTorque = (fL - fR) * (bot.half[0] * 1.55);

                // Lateral tire grip (prevents ice-skating sideways)
                const fLat = clamp(-vLat * bot.compiled.massKg * 7.5, -weightPerSide * 1.6, weightPerSide * 1.6);
                world.applyForce(bot.chassisBody, [fwd[0] * fNet + right[0] * fLat, 0, fwd[2] * fNet + right[2] * fLat], [pose[0], pose[1], pose[2]]);
                world.applyTorque(bot.chassisBody, [0, yawTorque, 0]);
                // Keep low-slung combat bot upright unless launched hard
                if (up[1] < 0.99) {
                    world.applyTorque(bot.chassisBody, [-up[2] * bot.compiled.massKg * 8, 0, up[0] * bot.compiled.massKg * 8]);
                }
                bot.ai.flippedTimer = 0;
            } else if (up[1] < 0.55) {
                // Real BattleBots Srimech (self-righting recovery after 1.1 s tipped on side/roof!)
                bot.ai.flippedTimer += dt;
                if (bot.ai.flippedTimer > 1.15) {
                    bot.ai.flippedTimer = 0;
                    const m = bot.compiled.massKg;
                    world.applyImpulse(bot.chassisBody, [0, m * 3.1, 0], [pose[0], pose[1], pose[2]]);
                    world.applyTorque(bot.chassisBody, [-up[2] * m * 85, 0, up[0] * m * 85]);
                    fxEvents.push({ kind: 'clutch_slip', pos: [pose[0], pose[1] + 0.15, pose[2]], botId: bot.id });
                }
            }

            // Active mechanical strikes (Flipper, Forklift hoist, Grapple clamp/shove, Trebuchet fling, Piledriver, Crusher, Hammer)
            if (cmd.fireTrigger && bot.compiled.weaponChain && simTime - bot.lastActiveStrikeAt > 0.75) {
                const wcs = bot.runtime.chainState.get(bot.compiled.weaponChain.id);
                const opp = bots.find((b) => b !== bot);
                const activeKinds = ['flipper_spatula', 'piledriver_spear', 'crusher_jaw', 'hammer_arm', 'fork_lifter', 'grapple_claw', 'trebuchet_arm', 'excavator_boom'];
                if (opp && wcs && !wcs.broken && !wcs.seized && activeKinds.includes(bot.weaponKind)) {
                    const op = world.pose(opp.chassisBody);
                    const dist = Math.hypot(op[0] - pose[0], op[2] - pose[2]);
                    if (dist < 1.32) {
                        bot.lastActiveStrikeAt = simTime;
                        bot.hitsDealt++;
                        opp.hitsTaken++;
                        const pt = [(pose[0] + op[0]) * 0.5, pose[1] + 0.12, (pose[2] + op[2]) * 0.5];
                        if (bot.weaponKind === 'flipper_spatula') {
                            world.applyImpulse(opp.chassisBody, [fwd[0] * 180, 420, fwd[2] * 180], pt);
                        } else if (bot.weaponKind === 'fork_lifter') {
                            // Scoops underneath and hoists/tips the opponent cleanly upward!
                            world.applyImpulse(opp.chassisBody, [fwd[0] * 150, 390, fwd[2] * 150], [op[0], op[1] - 0.08, op[2]]);
                            world.applyTorque(opp.chassisBody, [right[0] * 260, 0, right[2] * 260]);
                        } else if (bot.weaponKind === 'trebuchet_arm') {
                            // Torsion-spring counterweight catapult fling!
                            world.applyImpulse(opp.chassisBody, [fwd[0] * 250, 490, fwd[2] * 250], pt);
                        } else if (bot.weaponKind === 'grapple_claw') {
                            // Sumo clamp & bulldoze shove toward the walls/pillars!
                            world.applyImpulse(opp.chassisBody, [fwd[0] * 350, 75, fwd[2] * 350], pt);
                        } else if (bot.weaponKind === 'piledriver_spear') {
                            world.applyImpulse(opp.chassisBody, [fwd[0] * 340, 90, fwd[2] * 340], pt);
                        } else if (bot.weaponKind === 'hammer_arm') {
                            world.applyImpulse(opp.chassisBody, [fwd[0] * 210, -140, fwd[2] * 210], pt);
                        } else {
                            world.applyImpulse(opp.chassisBody, [fwd[0] * 240, 120, fwd[2] * 240], pt);
                        }
                        fxEvents.push({ kind: 'weapon_hit', pos: pt, intensity: 1.6, botId: bot.id });
                    }
                }
            }

            // Inner -> Outer: Drive macro weapon hinge from compiled weapon chain!
            if (bot.weaponJoint != null && bot.compiled.weaponChain) {
                const wch = bot.compiled.weaponChain;
                const wcs = bot.runtime.chainState.get(wch.id);
                if (bot.weaponKind === 'spinner_bar' || bot.weaponKind === 'spinner_drum') {
                    if (wcs.broken) {
                        world.setJointMotor(bot.weaponJoint, 0, 0.2, true);
                    } else if (wcs.seized) {
                        world.setJointMotor(bot.weaponJoint, 0, 500, true);
                    } else {
                        const targetW = clamp(wcs.omegaOut, -180, 180);
                        world.setJointMotor(bot.weaponJoint, targetW, Math.max(5, Math.abs(wcs.torqueOut) * 1.4), true);
                    }
                } else if (['hammer_arm', 'crusher_jaw', 'flipper_spatula', 'piledriver_spear', 'fork_lifter', 'grapple_claw', 'trebuchet_arm', 'excavator_boom'].includes(bot.weaponKind)) {
                    if (wcs.broken) {
                        world.setJointMotor(bot.weaponJoint, 0, 0.2, true);
                    } else if (bot.weaponKind === 'hammer_arm' || bot.weaponKind === 'trebuchet_arm') {
                        const dir = bot.weaponKind === 'trebuchet_arm' ? -1 : 1;
                        if (simTime - wcs.springFiredAt < 0.22) {
                            world.setJointMotor(bot.weaponJoint, 26 * dir, Math.max(60, wch.peakTorqueOut * 0.9), true);
                        } else {
                            world.setJointMotor(bot.weaponJoint, -3.5 * dir, 45, true);
                        }
                    } else {
                        // Hydraulic forklift/flipper lifts upward; crusher/grapple clamps forward!
                        const active = (simTime % 2.4) < 0.75;
                        const upLift = bot.weaponKind === 'flipper_spatula' || bot.weaponKind === 'fork_lifter';
                        const spd = upLift ? (active ? -16 : 3.5) : (active ? 6.5 : -3.5);
                        world.setJointMotor(bot.weaponJoint, spd, Math.max(80, Math.min(400, wch.contTorqueOut)), true);
                    }
                }
            }
        }

        // --- 3. Step Outer Box3D World ---
        world.step(dt, 4);
    }

    function destroy() {
        for (const s of structures) s.structure.destroy();
        world.destroy();
    }

    return {
        world,
        halfSize,
        bots,
        structures,
        fxEvents,
        get time() { return simTime; },
        spawnBot,
        step,
        destroy,
    };
}
