// lib/foundry/primitives.js — Level-0 physical building blocks of the Foundry.
//
// Every primitive computes its real SI bounding box, mass, inertia, cost,
// typed ports, continuous/peak spec bounds, and failure mode from physical
// dimensions and material choice. The same primitives scale smoothly from
// 5 cm battle-bot gearboxes up to multi-metre titan drivetrains.

import { matOf } from "./materials.js";
import { PRIMITIVES_EXT } from "./primitives_ext.js";

export const PORT_COLORS = {
    elec: '#38bdf8',    // DC electrical bus
    rot: '#f59e0b',     // rotational shaft (omega, torque)
    hyd: '#06b6d4',     // hydraulic pressure & flow (bar, L/min)
    lin: '#a855f7',     // linear ram / striker (v, force kN)
    struct: '#4ade80',  // structural frame mount
};

export const PORT_COMPAT = {
    elec: ['elec'],
    rot: ['rot'],
    hyd: ['hyd'],
    lin: ['lin'],
    struct: ['struct'],
};

const PI = Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Lewis form factor Y for standard 20-deg full-depth involute spur gear teeth.
 * Fewer teeth = narrower tooth root = lower Y = weaker tooth!
 */
export function lewisY(teeth) {
    const z = Math.max(8, teeth);
    return 0.484 - 2.87 / z;
}

export const PRIMITIVES = {
    battery: {
        type: 'battery',
        label: 'Battery Pack',
        cat: 'Power',
        color: '#38bdf8',
        note: 'DC power source. Peak current draw sags voltage and heats cells.',
        ins: [],
        outs: [{ id: 'elec_out', label: 'DC Out', domain: 'elec' }],
        defaults: { voltage: 48, capacityWh: 400, maxC: 12 },
        schema: {
            voltage:    { label: 'Voltage',   min: 12, max: 800, step: 12, unit: 'V' },
            capacityWh: { label: 'Capacity',  min: 50, max: 50000, step: 50, unit: 'Wh' },
            maxC:       { label: 'Discharge', min: 2,  max: 30,  step: 1,  unit: 'C' },
        },
        analyze(p) {
            const wh = Math.max(20, p.capacityWh);
            const v = Math.max(12, p.voltage);
            const massKg = wh / 155;                      // ~155 Wh/kg LiFePO4/LiPo pack with casing
            const vol = massKg / 1850;
            const s = Math.cbrt(vol);
            const maxPowerW = wh * p.maxC;                // continuous C-rate power
            const peakPowerW = maxPowerW * 1.8;
            const cost = 25 + wh * 0.16;
            return {
                size: [s * 1.4, s * 0.72, s * 1.0],
                massKg,
                inertia: massKg * s * s / 6,
                cost,
                thermalCapJ: massKg * 950,
                thermalDissWPerK: 6 * Math.pow(massKg, 0.65),
                rated: {
                    voltage: v,
                    capacityWh: wh,
                    powerContW: maxPowerW,
                    powerPeakW: peakPowerW,
                    tempMaxC: 85,
                },
                failureMode: 'burnout',
                summary: `${v}V · ${wh} Wh · ${(maxPowerW / 1000).toFixed(1)} kW`,
            };
        },
    },

    motor: {
        type: 'motor',
        label: 'Electric Motor',
        cat: 'Power',
        color: '#fb923c',
        note: 'Brushless drive. Linear torque-speed curve; stalling dumps copper I^2R heat into windings.',
        ins: [{ id: 'elec_in', label: 'DC In', domain: 'elec' }],
        outs: [
            { id: 'rot_out', label: 'Shaft Out', domain: 'rot' },
            { id: 'mount', label: 'Mount', domain: 'struct' },
        ],
        defaults: { powerW: 2400, noLoadRpm: 3600, efficiency: 0.86 },
        schema: {
            powerW:     { label: 'Rated Power', min: 200, max: 250000, step: 200, unit: 'W' },
            noLoadRpm:  { label: 'No-Load RPM', min: 300, max: 12000,  step: 100, unit: 'rpm' },
            efficiency: { label: 'Efficiency',  min: 0.65, max: 0.95,  step: 0.01, unit: '' },
        },
        analyze(p) {
            const P = Math.max(100, p.powerW);
            const wNoLoad = Math.max(10, p.noLoadRpm) * 2 * PI / 60;
            // Peak mechanical power occurs at w = w_nl / 2: P_max = (tau_stall * w_nl) / 4
            const stallTorque = (4 * P) / wNoLoad;
            const contTorque = stallTorque * 0.42;
            const massKg = 0.6 + Math.pow(P / 1000, 0.82) * 1.45;
            const r = clamp(0.032 * Math.pow(massKg, 0.33), 0.025, 0.9);
            const len = r * 2.4;
            const J = 0.25 * (massKg * 0.35) * r * r;
            const cost = 45 + P * 0.045;
            return {
                size: [r * 2, r * 2, len],
                massKg,
                inertia: J,
                cost,
                thermalCapJ: massKg * 460,
                thermalDissWPerK: 4.5 * Math.pow(massKg, 0.65),
                rated: {
                    powerContW: P,
                    torqueContNm: contTorque,
                    torquePeakNm: stallTorque * 2.2,
                    stallTorqueNm: stallTorque,
                    noLoadRpm: p.noLoadRpm,
                    rpmMax: p.noLoadRpm * 1.35,
                    efficiency: clamp(p.efficiency, 0.5, 0.96),
                    tempMaxC: 135,
                },
                failureMode: 'burnout',
                summary: `${(P / 1000).toFixed(1)} kW · ${contTorque.toFixed(1)} N·m cont / ${stallTorque.toFixed(1)} stall`,
            };
        },
    },

    ic_engine: {
        type: 'ic_engine',
        label: 'Combustion Engine',
        cat: 'Power',
        color: '#ef4444',
        note: 'Internal combustion engine. High energy density; scales from 60 cc mower to multi-litre titan V12.',
        ins: [],
        outs: [
            { id: 'rot_out', label: 'Crank Out', domain: 'rot' },
            { id: 'mount', label: 'Mount', domain: 'struct' },
        ],
        defaults: { displacementCc: 120, cylinders: 1, redlineRpm: 5400, fuelKg: 1.5 },
        schema: {
            displacementCc: { label: 'Displacement', min: 30, max: 24000, step: 30, unit: 'cc' },
            cylinders:      { label: 'Cylinders',    min: 1,  max: 12,    step: 1,  unit: '' },
            redlineRpm:     { label: 'Redline',      min: 1800, max: 9000, step: 200, unit: 'rpm' },
            fuelKg:         { label: 'Fuel Tank',    min: 0.2, max: 500,  step: 0.2, unit: 'kg' },
        },
        analyze(p) {
            const cc = Math.max(25, p.displacementCc);
            // BMEP ~ 8.5 bar => ~0.068 N·m per cc for 4-stroke industrial engine
            const peakTorque = cc * 0.068 * (1 + 0.03 * Math.min(12, p.cylinders));
            const contTorque = peakTorque * 0.78;
            const wRed = p.redlineRpm * 2 * PI / 60;
            const powerW = peakTorque * (wRed * 0.72);
            const dryMass = 2.2 + Math.pow(cc / 100, 0.85) * 4.8;
            const massKg = dryMass + p.fuelKg;
            const s = Math.cbrt(dryMass / 1400);
            const J = 0.002 + dryMass * s * s * 0.08;
            const cost = 110 + cc * 0.85 + p.cylinders * 35;
            return {
                size: [s * 1.1, s * 1.0, s * (0.9 + 0.16 * Math.min(8, p.cylinders))],
                massKg,
                inertia: J,
                cost,
                thermalCapJ: dryMass * 520,
                thermalDissWPerK: 14 * Math.pow(dryMass, 0.68),
                rated: {
                    powerContW: powerW,
                    torqueContNm: contTorque,
                    torquePeakNm: peakTorque * 1.25,
                    stallTorqueNm: peakTorque * 1.15,
                    noLoadRpm: p.redlineRpm,
                    rpmMax: p.redlineRpm * 1.18,
                    efficiency: 0.30,
                    fuelKg: p.fuelKg,
                    burnKgPerSec: powerW / (43e6 * 0.30),
                    tempMaxC: 190,
                },
                failureMode: 'seize',
                summary: `${cc} cc (${p.cylinders} cyl) · ${(powerW / 1000).toFixed(1)} kW · ${peakTorque.toFixed(0)} N·m`,
            };
        },
    },

    gear_pair: {
        type: 'gear_pair',
        label: 'Spur Gear Stage',
        cat: 'Transmission',
        color: '#f59e0b',
        note: 'Meshed pinion & gear. Tooth strength follows Lewis bending equation; undersized teeth strip under shock.',
        ins: [{ id: 'rot_in', label: 'Pinion In', domain: 'rot' }],
        outs: [
            { id: 'rot_out', label: 'Gear Out', domain: 'rot' },
            { id: 'mount', label: 'Housing', domain: 'struct' },
        ],
        defaults: { teethIn: 14, teethOut: 42, moduleMm: 2.5, faceWidthMm: 16, material: 'alloySteel' },
        schema: {
            teethIn:     { label: 'Pinion Teeth', min: 10, max: 60,  step: 1,   unit: 'T' },
            teethOut:    { label: 'Gear Teeth',   min: 10, max: 120, step: 1,   unit: 'T' },
            moduleMm:    { label: 'Module',       min: 1,  max: 30,  step: 0.5, unit: 'mm' },
            faceWidthMm: { label: 'Face Width',   min: 4,  max: 240, step: 2,   unit: 'mm' },
            material:    { label: 'Material',     kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const z1 = Math.max(10, Math.round(p.teethIn));
            const z2 = Math.max(10, Math.round(p.teethOut));
            const m = Math.max(0.5, p.moduleMm) / 1000;    // metres
            const b = Math.max(2, p.faceWidthMm) / 1000;   // metres
            const r1 = 0.5 * m * z1;
            const r2 = 0.5 * m * z2;
            const ratio = z2 / z1;
            // Lewis bending capacity at the weaker pinion tooth: F_t = sigma * b * m * Y
            const Y = lewisY(z1);
            const ftCont = (mat.fatiguePa * 0.55) * b * m * Y;
            const ftPeak = (mat.ultimatePa * 0.72) * b * m * Y;
            const torqueInCont = ftCont * r1;
            const torqueInPeak = ftPeak * r1;
            const torqueOutCont = torqueInCont * ratio;
            const torqueOutPeak = torqueInPeak * ratio;
            const mass1 = PI * r1 * r1 * b * mat.density * 0.82;
            const mass2 = PI * r2 * r2 * b * mat.density * 0.76;
            const housing = (mass1 + mass2) * 0.35;
            const massKg = mass1 + mass2 + housing;
            const J1 = 0.5 * mass1 * r1 * r1;
            const J2 = 0.5 * mass2 * r2 * r2;
            const centerDist = r1 + r2;
            const pitchSpeedMax = 28; // m/s spur gear pitch-line speed limit before scuff/whine
            const rpmMaxIn = (pitchSpeedMax / Math.max(0.005, r1)) * 60 / (2 * PI);
            const cost = 18 + (mass1 + mass2) * mat.costPerKg * 3.2;
            return {
                size: [centerDist + r1 + r2 + 0.015, Math.max(r1, r2) * 2 + 0.015, b + 0.02],
                massKg,
                inertiaIn: J1,
                inertiaOut: J2,
                inertia: J1 + J2 / (ratio * ratio),
                ratio,
                efficiency: 0.96,
                centerDist,
                r1, r2, z1, z2, faceWidthM: b,
                cost,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 3.5 * Math.pow(massKg, 0.65),
                rated: {
                    torqueInContNm: torqueInCont,
                    torqueInPeakNm: torqueInPeak,
                    torqueContNm: torqueOutCont,
                    torquePeakNm: torqueOutPeak,
                    rpmMax: rpmMaxIn,
                    tempMaxC: mat.maxTempC * 0.55,
                },
                wearFactor: mat.wearFactor,
                failureMode: 'freewheel', // stripped teeth lose engagement
                summary: `${ratio.toFixed(2)}:1 · ${torqueOutCont.toFixed(0)} N·m cont / ${torqueOutPeak.toFixed(0)} strip`,
            };
        },
    },

    bearing: {
        type: 'bearing',
        label: 'Bearing Block',
        cat: 'Transmission',
        color: '#22d3ee',
        note: 'Supports shaft radial/shock loads. Bronze bushings are cheap & compact but wear quickly under heavy load; roller bearings last.',
        ins: [{ id: 'rot_in', label: 'Shaft In', domain: 'rot' }],
        outs: [
            { id: 'rot_out', label: 'Shaft Out', domain: 'rot' },
            { id: 'mount', label: 'Mount', domain: 'struct' },
        ],
        defaults: { boreMm: 20, kind: 'ball', material: 'alloySteel' },
        schema: {
            boreMm:   { label: 'Bore Dia', min: 6, max: 400, step: 2, unit: 'mm' },
            kind:     { label: 'Type',     options: { bushing: 'Bronze Bushing', ball: 'Deep-Groove Ball', roller: 'Tapered Roller' } },
            material: { label: 'Material', kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const d = Math.max(4, p.boreMm) / 1000;
            const kindK = p.kind === 'roller' ? { load: 2.2, rpm: 0.75, drag: 0.0025, wear: 0.35, cost: 2.4, mass: 1.5 }
                : p.kind === 'ball' ? { load: 1.0, rpm: 1.4, drag: 0.0015, wear: 0.65, cost: 1.4, mass: 1.0 }
                : { load: 0.42, rpm: 0.45, drag: 0.018, wear: 3.8, cost: 0.35, mass: 0.65 };
            const od = d * 2.1;
            const width = d * 0.85;
            const massKg = PI * (od * od - d * d) / 4 * width * mat.density * kindK.mass;
            // Dynamic radial load capacity scales with d^2 * yield
            const radialContN = 0.045 * d * d * mat.yieldPa * kindK.load;
            const radialPeakN = radialContN * 2.4;
            const rpmMax = (140 / Math.max(0.006, d)) * kindK.rpm;
            const cost = 4 + massKg * mat.costPerKg * 4.5 * kindK.cost;
            return {
                size: [od * 1.4, od * 1.3, width * 1.2],
                massKg,
                inertia: 0.5 * massKg * d * d * 0.25,
                ratio: 1,
                efficiency: 1 - kindK.drag,
                cost,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 3.0 * Math.pow(massKg, 0.65),
                rated: {
                    radialContN,
                    radialPeakN,
                    torqueContNm: radialContN * d * 3.5,
                    torquePeakNm: radialPeakN * d * 4.5,
                    rpmMax,
                    tempMaxC: p.kind === 'bushing' ? 140 : 180,
                },
                wearFactor: kindK.wear * mat.wearFactor,
                failureMode: 'seize', // worn-out bearing seizes shaft!
                summary: `${p.kind} Ø${p.boreMm}mm · ${(radialContN / 1000).toFixed(1)} kN radial`,
            };
        },
    },

    shear_pin: {
        type: 'shear_pin',
        label: 'Shear Pin Fuse',
        cat: 'Protection',
        color: '#facc15',
        note: 'Sacrificial mechanical fuse. Snaps cleanly above its rated torque to save expensive gearboxes & motors!',
        ins: [{ id: 'rot_in', label: 'Shaft In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Shaft Out', domain: 'rot' }],
        defaults: { diameterMm: 7, material: 'brass' },
        schema: {
            diameterMm: { label: 'Pin Dia', min: 2, max: 120, step: 0.5, unit: 'mm' },
            material:   { label: 'Material', kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const d = Math.max(1.5, p.diameterMm) / 1000;
            // Solid round shaft in pure torsion: T = (pi / 16) * d^3 * tau
            // Double-shear coupling hub amplifies effective lever slightly (radius = 1.6*d)
            const snapTorque = (PI / 16) * d * d * d * mat.shearPa * 3.6;
            const contTorque = snapTorque * 0.72;
            const hubR = Math.max(0.015, d * 2.2);
            const len = hubR * 1.6;
            const massKg = PI * hubR * hubR * len * 7850 * 0.35;
            const pinMass = PI * (d / 2) * (d / 2) * (hubR * 2) * mat.density;
            const cost = 2.5 + pinMass * mat.costPerKg * 2.5; // dirt cheap to replace!
            return {
                size: [hubR * 2, hubR * 2, len],
                massKg,
                inertia: 0.5 * massKg * hubR * hubR,
                ratio: 1,
                efficiency: 0.998,
                cost,
                isSacrificial: true,
                thermalCapJ: massKg * 450,
                thermalDissWPerK: 2.0,
                rated: {
                    torqueContNm: contTorque,
                    torquePeakNm: snapTorque,
                    rpmMax: 20000,
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 1.2,
                failureMode: 'freewheel', // clean disconnect, zero upstream jam!
                summary: `SNAPS @ ${snapTorque.toFixed(0)} N·m · $${cost.toFixed(0)} fuse`,
            };
        },
    },

    slip_clutch: {
        type: 'slip_clutch',
        label: 'Slip Clutch',
        cat: 'Protection',
        color: '#e879f9',
        note: 'Torque limiter. Clamps upstream torque to its set point by slipping—dumps spike energy into heat & pad wear.',
        ins: [{ id: 'rot_in', label: 'Drive In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Drive Out', domain: 'rot' }],
        defaults: { slipTorqueNm: 85, radiusMm: 55 },
        schema: {
            slipTorqueNm: { label: 'Slip Torque', min: 5,  max: 50000, step: 5, unit: 'N·m' },
            radiusMm:     { label: 'Plate Radius', min: 20, max: 600,  step: 5, unit: 'mm' },
        },
        analyze(p) {
            const r = Math.max(0.015, p.radiusMm / 1000);
            const tSlip = Math.max(2, p.slipTorqueNm);
            const massKg = 0.25 + PI * r * r * (0.018 + r * 0.14) * 7600;
            const padLifeJ = 18000 + PI * r * r * 1.8e7; // Joules of slip energy before pads glaze/burn
            const cost = 32 + massKg * 18 + tSlip * 0.12;
            return {
                size: [r * 2.1, r * 2.1, Math.max(0.03, r * 0.65)],
                massKg,
                inertia: 0.5 * massKg * r * r,
                ratio: 1,
                efficiency: 0.985,
                cost,
                isLimiter: true,
                slipTorqueNm: tSlip,
                padLifeJ,
                thermalCapJ: massKg * 500,
                thermalDissWPerK: 6.5 * Math.pow(massKg, 0.7),
                rated: {
                    torqueContNm: tSlip,
                    torquePeakNm: tSlip * 1.02, // slips instead of breaking!
                    rpmMax: 15000,
                    tempMaxC: 240,
                },
                wearFactor: 1.0,
                failureMode: 'freewheel', // burned-out friction pads slip forever
                summary: `Slips @ ${tSlip.toFixed(0)} N·m · ${(padLifeJ / 1000).toFixed(0)} kJ pads`,
            };
        },
    },

    flywheel: {
        type: 'flywheel',
        label: 'Flywheel Rotor',
        cat: 'Transmission',
        color: '#94a3b8',
        note: 'Stores rotational kinetic energy (0.5·J·ω²). Smooths impacts but slows spin-up and bursts above hoop-stress RPM.',
        ins: [{ id: 'rot_in', label: 'Shaft In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Shaft Out', domain: 'rot' }],
        defaults: { radiusMm: 95, thicknessMm: 22, material: 'alloySteel' },
        schema: {
            radiusMm:    { label: 'Radius',    min: 30, max: 1200, step: 5, unit: 'mm' },
            thicknessMm: { label: 'Thickness', min: 6,  max: 250,  step: 2, unit: 'mm' },
            material:    { label: 'Material',  kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const r = Math.max(0.02, p.radiusMm / 1000);
            const h = Math.max(0.004, p.thicknessMm / 1000);
            const massKg = PI * r * r * h * mat.density;
            const J = 0.5 * massKg * r * r;
            // Thin-rim hoop stress burst limit: sigma = rho * v^2 => w_max = sqrt(sigma_y / rho) / r
            const wBurst = Math.sqrt((mat.yieldPa * 0.75) / mat.density) / r;
            const rpmMax = wBurst * 60 / (2 * PI);
            const cost = 15 + massKg * mat.costPerKg * 1.8;
            return {
                size: [r * 2, r * 2, h + 0.01],
                massKg,
                inertia: J,
                ratio: 1,
                efficiency: 0.996,
                cost,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 3.5 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: mat.shearPa * 0.01 * r * r * h * 1000,
                    torquePeakNm: mat.shearPa * 0.02 * r * r * h * 1000,
                    rpmMax,
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: 0.25,
                failureMode: 'freewheel',
                summary: `${massKg.toFixed(1)} kg · J=${J.toFixed(4)} kg·m²`,
            };
        },
    },

    shaft: {
        type: 'shaft',
        label: 'Drive Shaft',
        cat: 'Transmission',
        color: '#cbd5e1',
        note: 'Transmits torque between stages. Twists and shears if diameter is undersized for output torque.',
        ins: [{ id: 'rot_in', label: 'In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Out', domain: 'rot' }],
        defaults: { diameterMm: 18, lengthMm: 160, material: 'alloySteel' },
        schema: {
            diameterMm: { label: 'Diameter', min: 4,  max: 300,  step: 1,  unit: 'mm' },
            lengthMm:   { label: 'Length',   min: 30, max: 4000, step: 10, unit: 'mm' },
            material:   { label: 'Material', kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const d = Math.max(0.003, p.diameterMm / 1000);
            const l = Math.max(0.02, p.lengthMm / 1000);
            const massKg = PI * (d / 2) * (d / 2) * l * mat.density;
            const torqueCont = (PI / 16) * d * d * d * mat.fatiguePa * 0.65;
            const torquePeak = (PI / 16) * d * d * d * mat.shearPa;
            const cost = 6 + massKg * mat.costPerKg * 2.0;
            return {
                size: [d * 1.4, d * 1.4, l],
                massKg,
                inertia: 0.5 * massKg * (d / 2) * (d / 2),
                ratio: 1,
                efficiency: 0.998,
                cost,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 2.5,
                rated: {
                    torqueContNm: torqueCont,
                    torquePeakNm: torquePeak,
                    rpmMax: 18000,
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor,
                failureMode: 'freewheel',
                summary: `Ø${p.diameterMm}×${p.lengthMm}mm · ${torquePeak.toFixed(0)} N·m shear`,
            };
        },
    },

    spring_actuator: {
        type: 'spring_actuator',
        label: 'Spring & Ratchet',
        cat: 'Transmission',
        color: '#a855f7',
        note: 'Winds up elastic energy from a low-power motor and releases a high-torque hammer/flipper pulse.',
        ins: [{ id: 'rot_in', label: 'Wind In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Strike Out', domain: 'rot' }],
        defaults: { stiffnessNmRad: 180, maxAngleDeg: 110, material: 'toolSteel' },
        schema: {
            stiffnessNmRad: { label: 'Stiffness', min: 20, max: 50000, step: 10, unit: 'N·m/rad' },
            maxAngleDeg:    { label: 'Max Wind',  min: 30, max: 180,   step: 10, unit: '°' },
            material:       { label: 'Material',  kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const k = Math.max(10, p.stiffnessNmRad);
            const rad = clamp(p.maxAngleDeg, 20, 200) * PI / 180;
            const maxTorque = k * rad;
            const energyJ = 0.5 * k * rad * rad;
            const massKg = 0.4 + energyJ * 0.0065 * (7850 / mat.density) * (1380e6 / mat.yieldPa);
            const r = clamp(0.035 * Math.pow(massKg, 0.35), 0.03, 0.8);
            const cost = 28 + massKg * mat.costPerKg * 3.0;
            return {
                size: [r * 2, r * 2, r * 3.0],
                massKg,
                inertia: 0.4 * massKg * r * r,
                ratio: 1,
                efficiency: 0.90,
                cost,
                isSpring: true,
                stiffnessNmRad: k,
                maxAngleRad: rad,
                energyJ,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 3.0,
                rated: {
                    torqueContNm: maxTorque * 0.85,
                    torquePeakNm: maxTorque * 1.35,
                    rpmMax: 4000,
                    tempMaxC: mat.maxTempC * 0.6,
                },
                wearFactor: mat.wearFactor,
                failureMode: 'freewheel',
                summary: `${energyJ.toFixed(0)} J stored · ${maxTorque.toFixed(0)} N·m impulse`,
            };
        },
    },

    frame: {
        type: 'frame',
        label: 'Chassis Frame',
        cat: 'Structure',
        color: '#4ade80',
        note: 'Primary load-bearing skeleton. Carries mounted assemblies and absorbs collision G-loads.',
        ins: [{ id: 'struct_in', label: 'Mounts', domain: 'struct' }],
        outs: [{ id: 'struct_out', label: 'Chassis Bus', domain: 'struct' }],
        defaults: { lengthM: 0.82, widthM: 0.64, heightM: 0.22, wallMm: 5, material: 'alloySteel' },
        schema: {
            lengthM:  { label: 'Length', min: 0.3, max: 15,  step: 0.05, unit: 'm' },
            widthM:   { label: 'Width',  min: 0.3, max: 15,  step: 0.05, unit: 'm' },
            heightM:  { label: 'Height', min: 0.1, max: 8,   step: 0.02, unit: 'm' },
            wallMm:   { label: 'Wall',   min: 1.5, max: 80,  step: 0.5,  unit: 'mm' },
            material: { label: 'Material', kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const L = Math.max(0.2, p.lengthM), W = Math.max(0.2, p.widthM), H = Math.max(0.08, p.heightM);
            const t = Math.max(0.001, p.wallMm / 1000);
            // Perimeter rail + cross-members + bottom pan
            const railLen = 4 * (L + W + H);
            const sectionA = 4 * (0.04 * Math.max(1, L) * t);
            const vol = railLen * sectionA * 0.45 + L * W * t * 0.5;
            const massKg = vol * mat.density;
            const compLoadCont = mat.yieldPa * sectionA * 0.35;
            const compLoadPeak = mat.ultimatePa * sectionA * 0.85;
            const cost = 35 + massKg * mat.costPerKg * 2.2;
            return {
                size: [W, H, L],
                massKg,
                inertia: massKg * (W * W + L * L) / 12,
                cost,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 15 * (W * L),
                rated: {
                    structContN: compLoadCont,
                    structPeakN: compLoadPeak,
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 0.5,
                failureMode: 'buckle',
                summary: `${(W * 100).toFixed(0)}×${(L * 100).toFixed(0)}cm · ${massKg.toFixed(1)} kg · ${(compLoadPeak / 1000).toFixed(0)} kN`,
            };
        },
    },

    armor: {
        type: 'armor',
        label: 'Armor / Wedge',
        cat: 'Structure',
        color: '#64748b',
        note: 'Protective plating or front plow. Absorbs impact energy before excess shock enters the frame.',
        ins: [{ id: 'struct_in', label: 'Frame', domain: 'struct' }],
        outs: [],
        defaults: { widthM: 0.64, heightM: 0.22, thicknessMm: 8, material: 'hardox', face: 'front' },
        schema: {
            widthM:      { label: 'Width',     min: 0.15, max: 15,  step: 0.05, unit: 'm' },
            heightM:     { label: 'Height',    min: 0.08, max: 8,   step: 0.02, unit: 'm' },
            thicknessMm: { label: 'Thickness', min: 1.5,  max: 120, step: 0.5,  unit: 'mm' },
            material:    { label: 'Material',  kind: 'material' },
            face:        { label: 'Face',      options: { front: 'Front Wedge', side: 'Side Skirt', rear: 'Rear Plate', top: 'Top Deck' } },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const W = Math.max(0.1, p.widthM), H = Math.max(0.05, p.heightM), t = Math.max(0.001, p.thicknessMm / 1000);
            const massKg = W * H * t * mat.density;
            const impactPeakN = mat.yieldPa * (W * t) * 0.45;
            const cost = 15 + massKg * mat.costPerKg * 1.9;
            return {
                size: [W, H, Math.max(0.02, t * 3)],
                massKg,
                inertia: massKg * (W * W + H * H) / 12,
                cost,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 10 * W * H,
                rated: {
                    structContN: impactPeakN * 0.5,
                    structPeakN: impactPeakN,
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor,
                failureMode: 'buckle',
                summary: `${p.face} ${p.thicknessMm}mm ${mat.label.split(' ')[0]} · ${massKg.toFixed(1)} kg`,
            };
        },
    },

    wheel: {
        type: 'wheel',
        label: 'Drive Wheel',
        cat: 'Output',
        color: '#34d399',
        note: 'Macro traction output. Converts axle torque to driving force (F = τ/r) and reflects push resistance back.',
        ins: [
            { id: 'rot_in', label: 'Axle In', domain: 'rot' },
            { id: 'struct_in', label: 'Mount', domain: 'struct' },
        ],
        outs: [],
        defaults: { radiusM: 0.13, widthM: 0.08, grip: 1.15, side: 'left' },
        schema: {
            radiusM: { label: 'Radius', min: 0.05, max: 2.5, step: 0.01, unit: 'm' },
            widthM:  { label: 'Width',  min: 0.03, max: 1.5, step: 0.01, unit: 'm' },
            grip:    { label: 'Grip μ', min: 0.4,  max: 1.8, step: 0.05, unit: '' },
            side:    { label: 'Side',   options: { left: 'Left Drive', right: 'Right Drive' } },
        },
        analyze(p) {
            const r = Math.max(0.04, p.radiusM), w = Math.max(0.02, p.widthM);
            const massKg = PI * r * r * w * 1350; // rubber tread + aluminum hub
            const J = 0.6 * massKg * r * r;
            const torquePeak = 450 * Math.pow(r / 0.12, 2.5) * (w / 0.08);
            const cost = 22 + massKg * 9;
            return {
                size: [w, r * 2, r * 2],
                massKg,
                inertia: J,
                cost,
                isOutput: 'wheel',
                side: p.side || 'left',
                radiusM: r,
                grip: p.grip,
                thermalCapJ: massKg * 1200,
                thermalDissWPerK: 6 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torquePeak * 0.6,
                    torquePeakNm: torquePeak,
                    rpmMax: (22 / r) * 60 / (2 * PI), // ~22 m/s tread speed
                    tempMaxC: 130,
                },
                wearFactor: 0.8,
                failureMode: 'freewheel', // shredded tire / stripped hub
                summary: `${p.side} Ø${(r * 200).toFixed(0)}cm · μ=${p.grip.toFixed(2)}`,
            };
        },
    },

    weapon_head: {
        type: 'weapon_head',
        label: 'Weapon / Tool Head',
        cat: 'Output',
        color: '#f43f5e',
        note: 'Macro kinetic/hydraulic effector (spinner bar, vertical drum, hammer, piercing crusher jaw, flipper spatula, or press platen).',
        ins: [
            { id: 'rot_in', label: 'Rotary In', domain: 'rot' },
            { id: 'lin_in', label: 'Linear In', domain: 'lin' },
            { id: 'struct_in', label: 'Mount', domain: 'struct' },
        ],
        outs: [],
        defaults: { kind: 'spinner_bar', massKg: 11, radiusM: 0.34, material: 'toolSteel' },
        schema: {
            kind: {
                label: 'Type',
                options: {
                    spinner_bar: 'Horizontal Spinner Bar',
                    spinner_drum: 'Vertical Toothed Drum',
                    hammer_arm: 'Overhead Hammer',
                    crusher_jaw: 'Hydraulic Crusher Jaw',
                    flipper_spatula: 'Launcher Flipper',
                    piledriver_spear: 'Jackhammer Battering Spear',
                    fork_lifter: 'Hydraulic Forklift Lifter',
                    grapple_claw: 'Dual-Jaw Grapple Claw',
                    winch_drum: 'Heavy Cable Winch Drum',
                    trebuchet_arm: 'Torsion Catapult Arm',
                    excavator_boom: 'Excavator Boom & Bucket',
                    auger_drill: 'Helical Core-Drill Auger',
                    lathe_chuck: '3-Jaw Foundry Lathe Chuck',
                    mech_legs: 'Bipedal Hydraulic Mech Legs',
                    press_platen: 'Forging Press Die',
                    mill_spindle: 'CNC Milling Cutter',
                },
            },
            massKg:   { label: 'Mass',     min: 1, max: 5000, step: 0.5, unit: 'kg' },
            radiusM:  { label: 'Reach/R',  min: 0.06, max: 4.0, step: 0.02, unit: 'm' },
            material: { label: 'Material', kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const m = Math.max(0.5, p.massKg), r = Math.max(0.06, p.radiusM);
            const J = p.kind === 'spinner_bar' ? (m * r * r) / 3
                : p.kind === 'spinner_drum' || p.kind === 'mill_spindle' || p.kind === 'winch_drum' || p.kind === 'auger_drill' || p.kind === 'lathe_chuck' ? 0.5 * m * r * r
                : 0.75 * m * r * r;
            const size = p.kind === 'spinner_bar' ? [r * 2, 0.06, 0.11]
                : p.kind === 'spinner_drum' ? [r * 2.2, r * 2.0, r * 2.0]
                : p.kind === 'crusher_jaw' ? [0.16, r * 0.55, r * 1.15]
                : p.kind === 'flipper_spatula' ? [r * 1.25, 0.14, r * 1.15]
                : p.kind === 'piledriver_spear' ? [0.10, 0.10, r * 1.35]
                : p.kind === 'fork_lifter' ? [r * 1.28, r * 0.92, r * 1.08]
                : p.kind === 'grapple_claw' ? [r * 1.15, r * 0.42, r * 1.05]
                : p.kind === 'winch_drum' ? [r * 2.2, r * 2.0, r * 2.0]
                : p.kind === 'trebuchet_arm' ? [0.16, r * 0.36, r * 1.45]
                : p.kind === 'excavator_boom' ? [r * 0.42, r * 0.92, r * 1.25]
                : p.kind === 'auger_drill' ? [r * 1.7, r * 3.8, r * 1.7]
                : p.kind === 'lathe_chuck' ? [r * 2.0, r * 2.0, r * 2.8]
                : p.kind === 'mech_legs' ? [r * 1.25, r * 1.45, r * 0.72]
                : p.kind === 'mill_spindle' ? [r * 1.6, r * 2.4, r * 1.6]
                : p.kind === 'press_platen' ? [r * 1.4, 0.14, r * 1.2]
                : [0.14, r * 0.35, r * 1.2];
            const cost = 40 + m * mat.costPerKg * 2.2;
            const torquePeak = mat.yieldPa * 1.8e-6 * Math.pow(m, 0.9) * r * 10;
            return {
                size,
                massKg: m,
                inertia: J,
                cost,
                isOutput: 'weapon',
                weaponKind: p.kind,
                radiusM: r,
                thermalCapJ: m * mat.specificHeat,
                thermalDissWPerK: 8 * Math.pow(m, 0.6),
                rated: {
                    torqueContNm: torquePeak * 0.5,
                    torquePeakNm: torquePeak,
                    rpmMax: (p.kind === 'spinner_bar' || p.kind === 'spinner_drum' || p.kind === 'mill_spindle' || p.kind === 'lathe_chuck' || p.kind === 'auger_drill') ? 10000 : 1800,
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 0.4,
                failureMode: 'buckle',
                summary: `${p.kind.replace('_', ' ')} · ${m} kg · R=${(r * 100).toFixed(0)}cm`,
            };
        },
    },
};

Object.assign(PRIMITIVES, PRIMITIVES_EXT);

export const PRIMITIVE_CATEGORIES = ['Power', 'Transmission', 'Protection', 'Structure', 'Output'];

export function primitiveDef(type) {
    return PRIMITIVES[type] || null;
}

export function defaultParams(type) {
    const def = PRIMITIVES[type];
    return def ? { ...def.defaults } : {};
}
