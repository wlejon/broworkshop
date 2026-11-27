// lib/foundry/runtime.js — Quantized Compiled Machine Runtime (Inner Engine).
//
// Executes a CompiledMachine in microseconds per 60 Hz tick without needing
// hundreds of Box3D bodies. Tracks live RPM, exact shaft/gear rotation angles,
// torque, slip clutch dissipation, battery/fuel consumption, thermal rise,
// wear accumulation, and instant out-of-spec failure cascades (shear pin snap
// protecting upstream gears vs. pinion strip vs. bearing seizure).

import { wearRate } from "./materials.js";

const PI = Math.PI;
const RPM_TO_RAD = (2 * PI) / 60;
const RAD_TO_RPM = 60 / (2 * PI);
const AMBIENT_C = 24;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Create a live stateful runtime from a CompiledMachine.
 */
export function createMachineRuntime(compiled, opts = {}) {
    const label = opts.label || compiled.name;
    let time = 0;

    // Per-part live state indexed by hierarchical path
    const partState = new Map();
    for (const p of compiled.parts) {
        partState.set(p.path, {
            path: p.path,
            topNodeId: p.topNodeId,
            type: p.type,
            label: p.label,
            cost: p.analysis.cost,
            isSacrificial: !!p.analysis.isSacrificial,
            isLimiter: !!p.analysis.isLimiter,
            rpm: 0,
            angle: 0,
            torqueNm: 0,
            radialN: 0,
            powerW: 0,
            tempC: AMBIENT_C,
            stressRatio: 0,      // load / continuous rating
            peakRatio: 0,        // load / ultimate peak rating
            wear: 0,             // 0..1 (1 = worn out -> fails)
            status: 'ok',        // 'ok' | 'warn' | 'overstress' | 'slipping' | 'failed'
            failed: false,
            failMode: null,      // 'freewheel' | 'seize' | 'burnout' | 'buckle'
            failReason: null,
            failTime: null,
            outOfSpecMsg: null,
            lastAlertAt: -10,
            peakSeenNm: 0,
            maxStressSeen: 0,
        });
    }

    // Per-chain live state
    const chainState = new Map();
    for (const ch of compiled.chains) {
        chainState.set(ch.id, {
            id: ch.id,
            kind: ch.kind,
            omegaOut: 0,         // rad/s at output shaft
            angleOut: 0,         // rad at output shaft
            torqueOut: 0,        // N·m currently delivered to output
            powerW: 0,
            slipping: false,
            slipPowerW: 0,
            broken: false,       // freewheel break in chain
            seized: false,       // seized bearing/engine in chain
            springCharge: 0,     // 0..1 for spring_actuator
            springFiredAt: -10,
        });
    }

    // Battery / fuel stores
    const stores = {
        batteryWh: 0,
        batteryMaxWh: 0,
        fuelKg: 0,
        fuelMaxKg: 0,
    };
    for (const p of compiled.parts) {
        if (p.type === 'battery') { stores.batteryWh += p.analysis.rated.capacityWh; stores.batteryMaxWh += p.analysis.rated.capacityWh; }
        if (p.type === 'ic_engine') { stores.fuelKg += p.analysis.rated.fuelKg; stores.fuelMaxKg += p.analysis.rated.fuelKg; }
    }

    // Immediate granular out-of-spec event feed (newest last)
    const events = [];
    const MAX_EVENTS = 160;

    function emitEvent(ev) {
        const entry = { t: +time.toFixed(2), machine: label, ...ev };
        events.push(entry);
        if (events.length > MAX_EVENTS) events.shift();
        return entry;
    }

    function triggerFail(ps, mode, reason, value, limit, unit, cascade) {
        if (ps.failed) return;
        ps.failed = true;
        ps.failMode = mode;
        ps.failReason = reason;
        ps.failTime = time;
        ps.status = 'failed';
        ps.outOfSpecMsg = `${reason} (${value.toFixed(0)} > ${limit.toFixed(0)} ${unit})`;
        emitEvent({
            severity: ps.isSacrificial ? 'warn' : 'crit',
            kind: 'fail',
            path: ps.path,
            topNodeId: ps.topNodeId,
            partName: ps.label,
            reason,
            value,
            limit,
            unit,
            cascade: cascade || (ps.isSacrificial ? 'FUSE SNAPPED — upstream drivetrain PROTECTED' : `Chain ${mode}`),
            repairCost: ps.cost,
        });
    }

    function maybeWarnOutOfSpec(ps, kind, ratio, value, limit, unit, note) {
        ps.outOfSpecMsg = `${kind}: ${value.toFixed(0)}/${limit.toFixed(0)} ${unit} (${Math.round(ratio * 100)}%)`;
        // Skip fleeting startup-inrush alerts during first 0.25 s unless truly extreme
        if (time < 0.25 && ratio < 1.35) return;
        if (time - ps.lastAlertAt < 0.75) return;
        ps.lastAlertAt = time;
        emitEvent({
            severity: ratio >= 1.0 ? 'warn' : 'info',
            kind,
            path: ps.path,
            topNodeId: ps.topNodeId,
            partName: ps.label,
            reason: note || `${kind} out of spec`,
            value,
            limit,
            unit,
            cascade: ratio >= 1.0 ? 'Accelerated wear' : 'Near continuous limit',
            repairCost: 0,
        });
    }

    /**
     * Step one powertrain chain for `dt` seconds.
     *
     * @param {Object} ch            compiled chain
     * @param {number} dt            seconds
     * @param {Object} cmd           { throttle (-1..1), loadTorqueNm, shockTorqueNm, radialShockN, fireTrigger, extOmega }
     */
    function stepChain(ch, dt, cmd) {
        const cs = chainState.get(ch.id);
        const throttle = clamp(cmd.throttle ?? 0, -1, 1);
        const extLoad = cmd.loadTorqueNm ?? 0;          // steady resistive brake load at output (opposes spin)
        const shockOut = Math.abs(cmd.shockTorqueNm ?? 0); // sudden impact spike at output!
        const radialShock = Math.abs(cmd.radialShockN ?? 0);

        // Scan chain integrity: any freewheel break or seizure?
        let brokenAt = -1;
        let seizedAt = -1;
        for (let i = 0; i < ch.stages.length; i++) {
            const ps = partState.get(ch.stages[i].path);
            if (!ps.failed) continue;
            if (ps.failMode === 'seize' && seizedAt < 0) seizedAt = i;
            if ((ps.failMode === 'freewheel' || ps.failMode === 'burnout') && brokenAt < 0) brokenAt = i;
        }
        cs.broken = brokenAt >= 0;
        cs.seized = seizedAt >= 0;
        cs.slipping = false;
        cs.slipPowerW = 0;

        // 1. Compute available driver torque at output (before any clutch/break).
        let driveTorqueOut = 0;
        const driverSm = ch.stages[0];
        const driverPs = partState.get(driverSm.path);
        const wNoLoad = ch.noLoadRpmOut * RPM_TO_RAD;

        if (!cs.broken && !driverPs.failed) {
            const hasEnergy = ch.isDriver
                ? (driverSm.part.type === 'ic_engine' ? stores.fuelKg > 0 : (stores.batteryMaxWh === 0 || stores.batteryWh > 0))
                : true;
            if (hasEnergy && Math.abs(throttle) > 1e-3) {
                const targetW = throttle * wNoLoad;
                const frac = clamp(cs.omegaOut / Math.max(1e-4, wNoLoad), -1.4, 1.4);
                const dir = Math.sign(throttle);
                const slipFactor = clamp(1 - (frac * dir), 0, 1.8);
                driveTorqueOut = dir * Math.abs(throttle) * ch.stallTorqueOut * slipFactor;
                if (Math.sign(targetW) === Math.sign(cs.omegaOut) && Math.abs(cs.omegaOut) > Math.abs(targetW)) {
                    driveTorqueOut = 0; // governor / back-EMF cap
                }
            }
        }

        // 2. Spring-loaded striker special handling (winds while throttle > 0, fires impulse on fireTrigger)
        let springImpulseTorque = 0;
        if (ch.hasSpring && ch.springPart && !cs.broken && !cs.seized) {
            const sp = ch.springPart.analysis;
            const sps = partState.get(ch.springPart.path);
            if (!sps.failed) {
                if (cmd.fireTrigger && cs.springCharge > 0.25) {
                    springImpulseTorque = sp.stiffnessNmRad * sp.maxAngleRad * cs.springCharge * 1.4;
                    cs.springCharge = 0;
                    cs.springFiredAt = time;
                } else if (Math.abs(throttle) > 0.1 && cs.springCharge < 1) {
                    const windRate = (ch.maxPowerW / Math.max(10, sp.energyJ)) * Math.abs(throttle);
                    cs.springCharge = Math.min(1, cs.springCharge + windRate * dt);
                }
            }
        }

        // 3. Propagate steady + shock torque BACKWARD from output -> input!
        // This is the core fail-safe cascade resolver:
        //   - A Slip Clutch clamps transmitted torque to slipTorqueNm (dissipating heat & pad wear).
        //   - A Shear Pin (or stripped gear) snapping stops the shock from reaching upstream parts!
        const signOmega = Math.abs(cs.omegaOut) > 0.05 ? Math.sign(cs.omegaOut) : Math.sign(driveTorqueOut || 1);
        const viscousDrag = (0.015 * ch.contTorqueOut) * (cs.omegaOut / Math.max(1, wNoLoad));
        const seizeDrag = cs.seized ? ch.stallTorqueOut * 4.0 : 0;

        // Effective steady torque transmitted across the output shaft:
        // equals resistive load + viscous drag + inertial acceleration load (capped by driver torque).
        const speedErrFrac = clamp(Math.abs(throttle * wNoLoad - cs.omegaOut) / Math.max(1, wNoLoad), 0, 1);
        const accelLoad = ch.isDriver ? Math.abs(driveTorqueOut) * 0.45 * speedErrFrac : Math.min(ch.contTorqueOut * 0.35, Math.abs(driveTorqueOut) * 0.15 * speedErrFrac);
        let steadyOutMag = cs.broken ? 0 : Math.min(Math.abs(driveTorqueOut), Math.abs(extLoad) + Math.abs(viscousDrag) + accelLoad);
        if (cs.seized) steadyOutMag = Math.max(steadyOutMag, Math.abs(driveTorqueOut));
        if (springImpulseTorque > 0) steadyOutMag = Math.max(steadyOutMag, springImpulseTorque);

        let propSteadyOut = steadyOutMag;
        let propShockOut = shockOut;
        let blockedUpstream = false;
        let clutchLimitOut = Infinity;

        for (let i = ch.stages.length - 1; i >= 0; i--) {
            const sm = ch.stages[i];
            const p = sm.part;
            const a = p.analysis;
            const ps = partState.get(p.path);

            ps.outOfSpecMsg = null;

            // Update stage speed & rotation angle (exact kinematic ratio!)
            const downstreamFree = brokenAt > i;
            const upstreamFree = brokenAt >= 0 && brokenAt < i;
            const stageOmega = upstreamFree ? cs.omegaOut * sm.ratioToOut
                : downstreamFree ? (throttle * wNoLoad * 0.95) * sm.ratioToOut
                : cs.omegaOut * sm.ratioToOut;
            ps.rpm = Math.abs(stageOmega * RAD_TO_RPM);
            ps.angle += stageOmega * dt;

            if (ps.failed) {
                ps.torqueNm = 0;
                ps.stressRatio = 0;
                ps.peakRatio = 0;
                ps.status = 'failed';
                if (ps.failMode === 'freewheel') blockedUpstream = true;
                continue;
            }

            // Torque actually seen at THIS stage's rated shaft
            const localSteady = blockedUpstream ? 0 : propSteadyOut * sm.torqueFactorFromOut;
            const localShock = blockedUpstream ? 0 : propShockOut * sm.torqueFactorFromOut;
            const localPeak = localSteady + localShock;
            ps.torqueNm = localPeak;
            if (localPeak > ps.peakSeenNm) ps.peakSeenNm = localPeak;

            // --- One-Way Sprag / Freewheel Clutch: cushions reverse coasting backdrive shocks! ---
            if (a.isFreewheel && propShockOut > 0) {
                propShockOut *= (a.backdriveDamping ?? 0.35);
            }

            // --- Torque / Pressure Limiters (Slip Clutch, HTD Belt Drive, Hydraulic Relief Valve)! ---
            if (a.isLimiter && a.slipTorqueNm) {
                const limit = a.slipTorqueNm;
                clutchLimitOut = Math.min(clutchLimitOut, limit / Math.max(1e-6, sm.torqueFactorFromOut));
                if (localPeak > limit) {
                    const excess = localPeak - limit;
                    const slipOmega = Math.max(4, Math.abs(stageOmega) * 0.35 + excess / Math.max(1, limit) * 18);
                    const slipW = limit * slipOmega;
                    cs.slipping = true;
                    cs.slipPowerW += slipW;
                    ps.tempC += (slipW * dt) / Math.max(50, a.thermalCapJ);
                    ps.wear = Math.min(1, ps.wear + (slipW * dt) / Math.max(500, a.padLifeJ || 18000));
                    ps.status = 'slipping';
                    ps.stressRatio = 1.05;
                    ps.peakRatio = limit / Math.max(1e-6, a.rated.torquePeakNm);
                    const tag = p.type === 'hydraulic_valve' ? 'RELIEF VALVE'
                        : p.type === 'belt_drive' ? 'BELT SLIP' : 'CLUTCH SLIP';
                    const msg = p.type === 'hydraulic_valve'
                        ? `Relieving at ${a.reliefBar} bar (bled pressure spike)`
                        : `Slipping at ${limit.toFixed(0)} N·m (absorbed ${excess.toFixed(0)} N·m spike)`;
                    maybeWarnOutOfSpec(ps, tag, 1.05, localPeak, limit, 'N·m', msg);
                    // Clamp what propagates UPSTREAM!
                    propSteadyOut = Math.min(propSteadyOut, limit / Math.max(1e-6, sm.torqueFactorFromOut));
                    propShockOut = Math.max(0, (limit - localSteady) / Math.max(1e-6, sm.torqueFactorFromOut));
                    if (ps.wear >= 1 || ps.tempC >= a.rated.tempMaxC) {
                        const fReason = p.type === 'belt_drive' ? 'BELT SNAPPED / BURNT'
                            : p.type === 'hydraulic_valve' ? 'RELIEF SEAL BLOWN'
                            : (ps.tempC >= a.rated.tempMaxC ? 'CLUTCH GLAZED/OVERHEAT' : 'CLUTCH PADS WORN OUT');
                        triggerFail(ps, 'freewheel', fReason,
                            ps.tempC >= a.rated.tempMaxC ? ps.tempC : 100, ps.tempC >= a.rated.tempMaxC ? a.rated.tempMaxC : 100,
                            ps.tempC >= a.rated.tempMaxC ? '°C' : '%', 'Limiter decoupled — output freewheels');
                        blockedUpstream = true;
                    }
                    continue;
                }
            }

            // --- Bearing radial load + L10 wear ---
            let stressRatio = a.rated.torqueContNm ? localPeak / a.rated.torqueContNm : 0;
            let peakRatio = a.rated.torquePeakNm ? localPeak / a.rated.torquePeakNm : 0;

            if (p.type === 'bearing') {
                const rad = (blockedUpstream ? 0 : (propSteadyOut + propShockOut) * sm.radialFactorFromOut) + radialShock * 0.55;
                ps.radialN = rad;
                const rCont = rad / Math.max(1, a.rated.radialContN);
                const rPeak = rad / Math.max(1, a.rated.radialPeakN);
                stressRatio = Math.max(stressRatio, rCont);
                peakRatio = Math.max(peakRatio, rPeak);
            }

            // Overspeed check
            const rpmRatio = a.rated.rpmMax ? ps.rpm / a.rated.rpmMax : 0;
            if (rpmRatio > 1.0) {
                stressRatio = Math.max(stressRatio, rpmRatio);
                peakRatio = Math.max(peakRatio, rpmRatio * 0.92);
            }

            // Thermal integration (waste heat minus cooling)
            const mechPower = Math.abs(localSteady * stageOmega);
            ps.powerW = mechPower;
            let heatW = mechPower * (1 - (a.efficiency || 0.99));
            if (p.type === 'motor') {
                // Copper I^2R heat spikes heavily under stall!
                const tFrac = localSteady / Math.max(1, a.rated.torqueContNm);
                heatW = (a.rated.powerContW * (1 - a.rated.efficiency)) * (0.15 + tFrac * tFrac);
            } else if (p.type === 'bearing') {
                heatW = mechPower * (1 - a.efficiency) + ps.radialN * 0.004 * Math.abs(stageOmega) * (1 + ps.wear * 3);
            }
            const radBonus = (compiled.coolingBoostWPerK || 0) / Math.max(2, compiled.parts.length * 0.5);
            const coolW = (ps.tempC - AMBIENT_C) * ((a.thermalDissWPerK || 4) + radBonus);
            ps.tempC = Math.max(AMBIENT_C, ps.tempC + ((heatW - coolW) * dt) / Math.max(20, a.thermalCapJ || 200));
            const tempRatio = a.rated.tempMaxC ? (ps.tempC - AMBIENT_C) / Math.max(10, a.rated.tempMaxC - AMBIENT_C) : 0;

            ps.stressRatio = Math.max(stressRatio, tempRatio);
            ps.peakRatio = peakRatio;
            if (ps.stressRatio > ps.maxStressSeen) ps.maxStressSeen = ps.stressRatio;

            // --- Immediate Ultimate Failure Check! ---
            if (peakRatio >= 1.0) {
                const reason = p.type === 'shear_pin' ? 'SHEAR PIN SNAPPED'
                    : p.type === 'gear_pair' || p.type === 'planetary_gear' ? 'GEAR TEETH STRIPPED'
                    : p.type === 'worm_gear' ? 'WORM WHEEL GALLING / SEIZE'
                    : p.type === 'chain_drive' ? 'ROLLER CHAIN SNAPPED'
                    : p.type === 'hydraulic_pump' ? 'HYDRAULIC PUMP SEIZED'
                    : p.type === 'hydraulic_ram' ? 'CYLINDER SEAL BLOWN'
                    : p.type === 'lead_screw' ? 'LEAD SCREW BOUND'
                    : p.type === 'bearing' ? 'BEARING CRUSHED / SEIZED'
                    : p.type === 'shaft' ? 'SHAFT SHEARED'
                    : p.type === 'flywheel' ? 'FLYWHEEL BURST'
                    : 'OVERLOAD FRACTURE';
                const unit = p.type === 'bearing' && ps.radialN >= a.rated.radialPeakN ? 'N' : 'N·m';
                const val = unit === 'N' ? ps.radialN : localPeak;
                const lim = unit === 'N' ? a.rated.radialPeakN : a.rated.torquePeakNm;
                triggerFail(ps, a.failureMode, reason, val, lim, unit);
                if (a.failureMode === 'freewheel') {
                    // Sacrificial shear pin or stripped gear breaks torque continuity!
                    // Upstream gears & motors are SAVED from the shock!
                    blockedUpstream = true;
                    propShockOut = 0;
                    propSteadyOut = 0;
                    brokenAt = i;
                } else if (a.failureMode === 'seize') {
                    seizedAt = i;
                }
                continue;
            }

            if (a.rated.tempMaxC && ps.tempC >= a.rated.tempMaxC) {
                triggerFail(ps, a.failureMode, 'THERMAL FAILURE', ps.tempC, a.rated.tempMaxC, '°C');
                if (a.failureMode === 'burnout' || a.failureMode === 'freewheel') blockedUpstream = true;
                continue;
            }

            // --- Wear accumulation (undersized parts visibly wear out in battle!) ---
            const revHz = Math.max(0.5, ps.rpm / 60);
            const wf = a.wearFactor ?? 1.0;
            // Base wear scaled so running at 1.4x continuous rating wears a bushing/gear meaningfully in 20-60s
            const dWear = wearRate(stressRatio, revHz, (1 / 950) * wf) * dt;
            if (dWear > 0) ps.wear = Math.min(1, ps.wear + dWear);

            if (ps.wear >= 1.0) {
                const reason = p.type === 'bearing' ? 'BEARING WORN OUT → SEIZED'
                    : p.type === 'gear_pair' ? 'GEAR TEETH WORN OUT → STRIPPED'
                    : 'FATIGUE WEAR FAILURE';
                triggerFail(ps, a.failureMode, reason, 100, 100, '%', `Worn to 100% — ${a.failureMode}`);
                if (a.failureMode === 'freewheel') blockedUpstream = true;
                continue;
            }

            // --- Granular Status & Immediate Out-Of-Spec Reporting ---
            if (stressRatio >= 1.0 || tempRatio >= 0.92) {
                ps.status = 'overstress';
                if (p.type === 'bearing' && ps.radialN > a.rated.radialContN) {
                    maybeWarnOutOfSpec(ps, 'RADIAL OVERLOAD', stressRatio, ps.radialN, a.rated.radialContN, 'N', 'Bearing radial load out of spec');
                } else if (rpmRatio > 1.0) {
                    maybeWarnOutOfSpec(ps, 'OVERSPEED', rpmRatio, ps.rpm, a.rated.rpmMax, 'rpm', 'RPM exceeds spec');
                } else if (tempRatio >= 0.92) {
                    maybeWarnOutOfSpec(ps, 'OVERHEAT', tempRatio, ps.tempC, a.rated.tempMaxC, '°C', 'Approaching thermal limit');
                } else {
                    maybeWarnOutOfSpec(ps, 'OVER-TORQUE', stressRatio, localPeak, a.rated.torqueContNm, 'N·m', 'Torque exceeds continuous spec');
                }
            } else if (stressRatio >= 0.82 || ps.wear >= 0.55) {
                ps.status = 'warn';
                if (ps.wear >= 0.55) ps.outOfSpecMsg = `WEAR ${Math.round(ps.wear * 100)}%`;
            } else {
                ps.status = 'ok';
            }
        }

        // 4. Integrate output shaft angular velocity using reflected inertia!
        const effectiveDrive = cs.broken ? 0 : clamp(driveTorqueOut + springImpulseTorque, -clutchLimitOut, clutchLimitOut);
        const netTorque = effectiveDrive - signOmega * (Math.abs(extLoad) + seizeDrag) - viscousDrag;
        if (cmd.extOmega != null) {
            cs.omegaOut = cmd.extOmega;
        } else {
            const alpha = netTorque / ch.reflectedInertiaOut;
            let nextW = cs.omegaOut + alpha * dt;
            // Prevent friction/brake from reversing spin past zero
            if (Math.abs(effectiveDrive) < Math.abs(extLoad) + seizeDrag && Math.sign(nextW) !== Math.sign(cs.omegaOut) && Math.abs(cs.omegaOut) > 1e-3) {
                nextW = 0;
            }
            cs.omegaOut = clamp(nextW, -wNoLoad * 1.45, wNoLoad * 1.45);
        }
        cs.angleOut += cs.omegaOut * dt;
        cs.torqueOut = effectiveDrive;
        cs.powerW = Math.abs(effectiveDrive * cs.omegaOut);

        // 5. Drain battery / fuel store
        if (ch.isDriver && !cs.broken) {
            if (driverSm.part.type === 'ic_engine' && stores.fuelKg > 0) {
                const burn = driverSm.part.analysis.rated.burnKgPerSec * (0.15 + 0.85 * Math.abs(throttle));
                stores.fuelKg = Math.max(0, stores.fuelKg - burn * dt);
            } else if (driverSm.part.type === 'motor' && stores.batteryMaxWh > 0) {
                const elecW = cs.powerW / Math.max(0.4, driverSm.part.analysis.rated.efficiency * ch.efficiency);
                stores.batteryWh = Math.max(0, stores.batteryWh - (elecW * dt) / 3600);
                if (ch.batteryPath) {
                    const bps = partState.get(ch.batteryPath);
                    const bMax = compiled.parts.find((x) => x.path === ch.batteryPath)?.analysis.rated.powerContW || 5000;
                    bps.powerW = elecW;
                    bps.stressRatio = elecW / bMax;
                    bps.status = bps.stressRatio > 1.0 ? 'overstress' : bps.stressRatio > 0.82 ? 'warn' : 'ok';
                }
            }
        }
    }

    /** Apply a macro structural collision impulse (N·s) onto armor & chassis frame. */
    function applyStructuralImpact(impulseNs, face = 'front', dt = 1 / 60) {
        if (!(impulseNs > 1)) return;
        // Convert impulse over elastic-plastic 55 ms steel/chassis contact into peak impact force
        const peakForceN = impulseNs / Math.max(0.055, dt * 3.2);
        let remainingN = peakForceN;

        // First let matching armor plates absorb shock
        for (const apath of compiled.structure.armorPaths) {
            const p = compiled.parts.find((x) => x.path === apath);
            const ps = partState.get(apath);
            if (!p || ps.failed) continue;
            if (p.params.face !== face && face !== 'any') continue;
            const r = p.analysis.rated;
            const ratio = remainingN / Math.max(1, r.structContN);
            const pRatio = remainingN / Math.max(1, r.structPeakN);
            ps.stressRatio = Math.max(ps.stressRatio * 0.7, ratio);
            ps.peakRatio = Math.max(ps.peakRatio * 0.7, pRatio);
            if (ps.stressRatio > ps.maxStressSeen) ps.maxStressSeen = ps.stressRatio;
            if (pRatio >= 1.0) {
                triggerFail(ps, 'buckle', 'ARMOR BREACHED', remainingN, r.structPeakN, 'N', 'Impact penetrates to chassis frame');
                remainingN = Math.max(0, remainingN - r.structPeakN * 0.55);
            } else {
                ps.wear = Math.min(1, ps.wear + Math.max(0, ratio - 0.5) * 0.14);
                ps.status = ratio >= 1.0 ? 'overstress' : ratio >= 0.75 ? 'warn' : 'ok';
                if (ratio >= 1.0) maybeWarnOutOfSpec(ps, 'ARMOR DENT', ratio, remainingN, r.structContN, 'N', 'Armor plate took out-of-spec hit');
                remainingN *= 0.42; // armor damped most of the blow!
            }
        }

        // Remainder enters the chassis frame
        if (compiled.structure.framePath) {
            const fp = compiled.parts.find((x) => x.path === compiled.structure.framePath);
            const fps = partState.get(compiled.structure.framePath);
            if (fp && !fps.failed) {
                const r = fp.analysis.rated;
                const ratio = remainingN / Math.max(1, r.structContN);
                const pRatio = remainingN / Math.max(1, r.structPeakN);
                fps.stressRatio = Math.max(fps.stressRatio * 0.75, ratio);
                fps.peakRatio = Math.max(fps.peakRatio * 0.75, pRatio);
                if (fps.stressRatio > fps.maxStressSeen) fps.maxStressSeen = fps.stressRatio;
                if (pRatio >= 1.0) {
                    triggerFail(fps, 'buckle', 'CHASSIS FRAME BUCKLED', remainingN, r.structPeakN, 'N', 'Structural frame compromised');
                } else if (ratio >= 0.7) {
                    fps.wear = Math.min(1, fps.wear + (ratio - 0.65) * 0.08);
                    fps.status = ratio >= 1.0 ? 'overstress' : 'warn';
                    if (ratio >= 1.0) maybeWarnOutOfSpec(fps, 'FRAME SHOCK', ratio, remainingN, r.structContN, 'N', 'Frame load exceeded yield margin');
                }
            }
        }
    }

    /** Decay transient structural stress indicators between impacts. */
    function decayStructure(dt) {
        const paths = [...compiled.structure.armorPaths, ...(compiled.structure.framePath ? [compiled.structure.framePath] : [])];
        for (const path of paths) {
            const ps = partState.get(path);
            if (!ps || ps.failed) continue;
            ps.stressRatio *= Math.exp(-3.5 * dt);
            ps.peakRatio *= Math.exp(-4.5 * dt);
            if (ps.stressRatio < 0.7) ps.status = ps.wear >= 0.55 ? 'warn' : 'ok';
        }
    }

    /** Step all chains in Dyno Bench mode (tests any sub-assembly or machine directly!). */
    function stepDyno(dt, cmd = {}) {
        time += dt;
        decayStructure(dt);
        for (const ch of compiled.chains) {
            const isPrimary = ch === compiled.primaryChain;
            stepChain(ch, dt, {
                throttle: cmd.throttle ?? 1.0,
                loadTorqueNm: isPrimary ? (cmd.loadTorqueNm ?? 0) : (cmd.loadTorqueNm ?? 0) * 0.3,
                shockTorqueNm: isPrimary ? (cmd.shockTorqueNm ?? 0) : 0,
                radialShockN: isPrimary ? (cmd.radialShockN ?? 0) : 0,
                fireTrigger: !!cmd.fireTrigger,
            });
        }
        if (cmd.impactImpulseNs > 0) applyStructuralImpact(cmd.impactImpulseNs, 'front', dt);
    }

    /** Step all chains in Macro Arena Seam mode. */
    function stepMacro(dt, cmd = {}) {
        time += dt;
        decayStructure(dt);
        for (const ch of compiled.chains) {
            if (ch.kind === 'drive_left') {
                stepChain(ch, dt, {
                    throttle: cmd.throttleL ?? 0,
                    loadTorqueNm: cmd.loadL ?? 0,
                    shockTorqueNm: cmd.shockL ?? 0,
                    radialShockN: cmd.radialL ?? 0,
                });
            } else if (ch.kind === 'drive_right') {
                stepChain(ch, dt, {
                    throttle: cmd.throttleR ?? 0,
                    loadTorqueNm: cmd.loadR ?? 0,
                    shockTorqueNm: cmd.shockR ?? 0,
                    radialShockN: cmd.radialR ?? 0,
                });
            } else if (ch.kind === 'weapon') {
                stepChain(ch, dt, {
                    throttle: cmd.weaponThrottle ?? 0,
                    loadTorqueNm: cmd.weaponDragNm ?? 0,
                    shockTorqueNm: cmd.weaponShockNm ?? 0,
                    radialShockN: cmd.weaponRadialN ?? 0,
                    fireTrigger: !!cmd.fireTrigger,
                });
            } else {
                stepChain(ch, dt, { throttle: cmd.weaponThrottle ?? 0, loadTorqueNm: 0 });
            }
        }
        if (cmd.impactImpulseNs > 0) {
            applyStructuralImpact(cmd.impactImpulseNs, cmd.impactFace || 'front', dt);
        }
    }

    /**
     * Roll up worst status, stress, wear, and temp from all internal parts onto
     * each top-level Blueprint node (for real-time Blueprint + 3D scale views!).
     */
    function getNodeRollups() {
        const rank = { ok: 0, warn: 1, slipping: 2, overstress: 3, failed: 4 };
        const map = new Map();
        for (const ps of partState.values()) {
            let r = map.get(ps.topNodeId);
            if (!r) {
                r = {
                    topNodeId: ps.topNodeId,
                    status: 'ok',
                    maxStress: 0,
                    maxWear: 0,
                    maxTempC: AMBIENT_C,
                    rpm: 0,
                    torqueNm: 0,
                    failedCount: 0,
                    worstPart: ps,
                    outOfSpecMsg: null,
                };
                map.set(ps.topNodeId, r);
            }
            if (rank[ps.status] > rank[r.status] || (rank[ps.status] === rank[r.status] && ps.stressRatio > r.maxStress)) {
                r.status = ps.status;
                r.worstPart = ps;
                if (ps.outOfSpecMsg) r.outOfSpecMsg = `${ps.label}: ${ps.outOfSpecMsg}`;
            }
            if (ps.stressRatio > r.maxStress) r.maxStress = ps.stressRatio;
            if (ps.wear > r.maxWear) r.maxWear = ps.wear;
            if (ps.tempC > r.maxTempC) r.maxTempC = ps.tempC;
            if (ps.rpm > r.rpm) r.rpm = ps.rpm;
            if (ps.torqueNm > r.torqueNm) r.torqueNm = ps.torqueNm;
            if (ps.failed) r.failedCount++;
        }
        return map;
    }

    /** Complete post-battle / post-dyno repair autopsy & fail-safe accounting. */
    function getAutopsy() {
        const failed = [];
        const worn = [];
        let repairCost = 0;
        let savedCost = 0;

        for (const ps of partState.values()) {
            if (ps.failed) {
                failed.push({ path: ps.path, label: ps.label, reason: ps.failReason, cost: ps.cost, isSacrificial: ps.isSacrificial, failTime: ps.failTime });
                repairCost += ps.cost;
            } else if (ps.wear >= 0.25) {
                const partBill = ps.wear >= 0.70 ? ps.cost : ps.cost * ps.wear;
                worn.push({ path: ps.path, label: ps.label, wear: ps.wear, cost: partBill, replace: ps.wear >= 0.70 });
                repairCost += partBill;
            }
        }
        // Estimate saved cost when a sacrificial shear pin snapped while upstream gears stayed intact
        const snappedFuses = failed.filter((f) => f.isSacrificial);
        if (snappedFuses.length) {
            for (const ps of partState.values()) {
                if (!ps.failed && (ps.type === 'gear_pair' || ps.type === 'motor' || ps.type === 'ic_engine')) {
                    savedCost += ps.cost;
                }
            }
        }

        return {
            time,
            failed,
            worn: worn.sort((a, b) => b.wear - a.wear),
            repairCost,
            savedCost,
            totalBuildCost: compiled.cost,
            operational: !failed.some((f) => !f.isSacrificial) && failed.length < compiled.parts.length,
        };
    }

    /** Replace all failed & heavily worn parts and cool back to ambient. */
    function repairAll() {
        for (const ps of partState.values()) {
            ps.failed = false;
            ps.failMode = null;
            ps.failReason = null;
            ps.failTime = null;
            ps.wear = 0;
            ps.tempC = AMBIENT_C;
            ps.stressRatio = 0;
            ps.peakRatio = 0;
            ps.status = 'ok';
            ps.outOfSpecMsg = null;
        }
        for (const cs of chainState.values()) {
            cs.omegaOut = 0;
            cs.torqueOut = 0;
            cs.broken = false;
            cs.seized = false;
            cs.slipping = false;
            cs.springCharge = 0;
        }
        stores.batteryWh = stores.batteryMaxWh;
        stores.fuelKg = stores.fuelMaxKg;
        events.length = 0;
        time = 0;
    }

    return {
        compiled,
        label,
        partState,
        chainState,
        stores,
        events,
        get time() { return time; },
        stepDyno,
        stepMacro,
        applyStructuralImpact,
        getNodeRollups,
        getAutopsy,
        repairAll,
    };
}
