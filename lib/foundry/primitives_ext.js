// lib/foundry/primitives_ext.js — Extended Mechanical, Hydraulic, Linear & Thermal Primitives.
//
// Adds 12 physically grounded components to PRIMITIVES:
//   Power:        capacitor_bank, hydraulic_pump
//   Transmission: planetary_gear, worm_gear, belt_drive, chain_drive, hydraulic_ram, lead_screw
//   Protection:   overrun_clutch, hydraulic_valve, radiator
//   Output:       track_unit

import { matOf } from "./materials.js";

const PI = Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const PRIMITIVES_EXT = {
    capacitor_bank: {
        type: 'capacitor_bank',
        label: 'Supercap Bank',
        cat: 'Power',
        color: '#22d3ee',
        note: 'High-C pulse buffer between battery and burst actuators. Multiplies peak electrical surge 3x for flippers & spinners.',
        ins: [{ id: 'elec_in', label: 'DC In', domain: 'elec' }],
        outs: [{ id: 'elec_out', label: 'Burst Out', domain: 'elec' }],
        defaults: { voltage: 48, energyKJ: 24, maxPeakKW: 28 },
        schema: {
            voltage:   { label: 'Voltage',   min: 12, max: 800, step: 12, unit: 'V' },
            energyKJ:  { label: 'Energy',    min: 4,  max: 5000, step: 4, unit: 'kJ' },
            maxPeakKW: { label: 'Peak Surge', min: 5, max: 2000, step: 5, unit: 'kW' },
        },
        analyze(p) {
            const kj = Math.max(2, p.energyKJ);
            const massKg = Math.max(0.5, kj / 18); // ~18 kJ/kg industrial supercaps
            const s = Math.cbrt(massKg / 1450);
            const cost = 45 + kj * 2.2;
            return {
                size: [s * 1.45, s * 0.72, s * 0.95],
                massKg,
                inertia: massKg * s * s / 6,
                cost,
                thermalCapJ: massKg * 850,
                thermalDissWPerK: 7 * Math.pow(massKg, 0.65),
                peakPowerBoostW: p.maxPeakKW * 1000,
                rated: {
                    voltage: p.voltage,
                    powerContW: p.maxPeakKW * 400,
                    powerPeakW: p.maxPeakKW * 1000,
                    tempMaxC: 75,
                },
                failureMode: 'burnout',
                summary: `${p.voltage}V · ${kj} kJ · ${p.maxPeakKW} kW burst`,
            };
        },
    },

    hydraulic_pump: {
        type: 'hydraulic_pump',
        label: 'Hydraulic Pump',
        cat: 'Power',
        color: '#06b6d4',
        note: 'Axial-piston pump converting rotary shaft power into high-pressure hydraulic flow (bar & L/min).',
        ins: [{ id: 'rot_in', label: 'Shaft In', domain: 'rot' }],
        outs: [{ id: 'hyd_out', label: 'Hyd Out', domain: 'hyd' }],
        defaults: { dispCcRev: 14, maxBar: 260, efficiency: 0.90 },
        schema: {
            dispCcRev:  { label: 'Displ.',     min: 2, max: 500, step: 2, unit: 'cc/r' },
            maxBar:     { label: 'Max Press',  min: 80, max: 420, step: 20, unit: 'bar' },
            efficiency: { label: 'Efficiency', min: 0.75, max: 0.96, step: 0.01, unit: '' },
        },
        analyze(p) {
            const cc = Math.max(2, p.dispCcRev);
            const bar = Math.max(60, p.maxBar);
            // Torque required at max pressure: tau = (P * V) / (2*pi*eta)
            const dispM3 = cc * 1e-6;
            const torquePeak = (bar * 1e5 * dispM3) / (2 * PI * p.efficiency);
            const torqueCont = torquePeak * 0.75;
            const massKg = Math.max(1.2, Math.pow(cc, 0.72) * 0.42);
            const r = clamp(0.036 * Math.pow(massKg, 0.33), 0.032, 0.55);
            const cost = 95 + massKg * 26 + bar * 0.25;
            return {
                size: [r * 2.1, r * 2.0, r * 2.5],
                massKg,
                inertia: 0.35 * massKg * r * r,
                cost,
                ratio: 1,
                efficiency: p.efficiency,
                dispCcRev: cc,
                maxBar: bar,
                thermalCapJ: massKg * 480,
                thermalDissWPerK: 6 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torqueCont,
                    torquePeakNm: torquePeak * 1.25,
                    pressureContBar: bar * 0.80,
                    pressurePeakBar: bar,
                    rpmMax: clamp(4200 / Math.pow(cc / 12, 0.28), 1200, 5200),
                    tempMaxC: 115,
                },
                wearFactor: 0.9,
                failureMode: 'seize',
                summary: `${cc} cc/r · ${bar} bar · ${(p.efficiency * 100).toFixed(0)}%`,
            };
        },
    },

    planetary_gear: {
        type: 'planetary_gear',
        label: 'Planetary Stage',
        cat: 'Transmission',
        color: '#f59e0b',
        note: 'Compact coaxial 3-planet epicyclic reduction. Zero axis offset and 3x load sharing vs single spur stage.',
        ins: [{ id: 'rot_in', label: 'Sun In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Carrier Out', domain: 'rot' }],
        defaults: { ratio: 5, ringOdMm: 78, faceWidthMm: 22, planets: 3, material: 'alloySteel' },
        schema: {
            ratio:       { label: 'Ratio',      min: 3, max: 9, step: 0.5, unit: ':1' },
            ringOdMm:    { label: 'Ring OD',    min: 40, max: 1400, step: 4, unit: 'mm' },
            faceWidthMm: { label: 'Face Width', min: 10, max: 350, step: 2, unit: 'mm' },
            planets:     { label: 'Planets',    min: 3, max: 6, step: 1, unit: '' },
            material:    { label: 'Material',   kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const ratio = Math.max(3, p.ratio);
            const od = Math.max(0.036, p.ringOdMm / 1000);
            const fw = Math.max(0.008, p.faceWidthMm / 1000);
            const planets = Math.max(3, Math.round(p.planets));
            const rRing = od * 0.44;
            const rSun = rRing / Math.max(2, ratio - 1);
            // 3+ planets share torque with ~0.88 load-sharing factor
            const modM = rRing / 24;
            const toothStrengthN = mat.yieldPa * 0.45 * fw * modM * 0.34;
            const torquePeakOut = toothStrengthN * rRing * planets * 0.85;
            const torqueContOut = torquePeakOut * 0.58;
            const vol = PI * (od * 0.5) ** 2 * fw * 0.72;
            const massKg = Math.max(0.25, vol * mat.density);
            const cost = 55 + massKg * mat.costPerKg * 3.8 + planets * 14;
            return {
                size: [od, od, fw * 1.45],
                massKg,
                inertia: 0.45 * massKg * (od * 0.4) ** 2,
                cost,
                ratio,
                efficiency: 0.96,
                odM: od,
                faceWidthM: fw,
                planets,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 6.5 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torqueContOut,
                    torquePeakNm: torquePeakOut,
                    rpmMax: clamp(9500 / Math.pow(od / 0.08, 0.65), 600, 14000),
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 0.65,
                failureMode: 'freewheel',
                summary: `${ratio}:1 Coaxial · ${planets}P Ø${p.ringOdMm}mm`,
            };
        },
    },

    worm_gear: {
        type: 'worm_gear',
        label: 'Worm Reducer',
        cat: 'Transmission',
        color: '#d97706',
        note: 'High-ratio self-locking worm & bronze wheel. Holds crushing/lifting loads with power off, but sliding friction runs HOT.',
        ins: [{ id: 'rot_in', label: 'Worm In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Wheel Out', domain: 'rot' }],
        defaults: { ratio: 20, wheelOdMm: 95, faceWidthMm: 26, material: 'bronze' },
        schema: {
            ratio:       { label: 'Ratio',      min: 8, max: 50, step: 2, unit: ':1' },
            wheelOdMm:   { label: 'Wheel OD',   min: 45, max: 1600, step: 5, unit: 'mm' },
            faceWidthMm: { label: 'Face Width', min: 12, max: 300, step: 2, unit: 'mm' },
            material:    { label: 'Wheel Mat',  kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const ratio = Math.max(8, p.ratio);
            const od = Math.max(0.04, p.wheelOdMm / 1000);
            const fw = Math.max(0.01, p.faceWidthMm / 1000);
            const eff = clamp(0.76 - ratio * 0.0045, 0.52, 0.74);
            const rW = od * 0.5;
            const torquePeakOut = mat.yieldPa * 0.32 * fw * (rW * 0.14) * rW * 2.4;
            const torqueContOut = torquePeakOut * 0.48;
            const massKg = Math.max(0.45, PI * rW * rW * fw * mat.density * 1.15);
            const cost = 48 + massKg * mat.costPerKg * 2.9;
            return {
                size: [od * 1.18, od * 1.28, fw * 2.2],
                massKg,
                inertia: 0.5 * massKg * rW * rW,
                cost,
                ratio,
                efficiency: eff,
                selfLocking: ratio >= 14,
                odM: od,
                faceWidthM: fw,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 5.5 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torqueContOut,
                    torquePeakNm: torquePeakOut,
                    rpmMax: clamp(4800 / Math.pow(od / 0.1, 0.5), 400, 6000),
                    tempMaxC: Math.min(mat.maxTempC, 195),
                },
                wearFactor: mat.wearFactor * 1.35,
                failureMode: 'seize',
                summary: `${ratio}:1 Self-Lock · ${(eff * 100).toFixed(0)}% eff`,
            };
        },
    },

    belt_drive: {
        type: 'belt_drive',
        label: 'HTD Belt Drive',
        cat: 'Transmission',
        color: '#eab308',
        note: 'Toothed belt & pulleys spanning chassis bays. Absorbs weapon shock and slips/snaps cheaply ($9 belt) before stripping gears!',
        ins: [{ id: 'rot_in', label: 'Drive Pulley', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Driven Pulley', domain: 'rot' }],
        defaults: { ratio: 2.0, widthMm: 25, spanMm: 180, slipTorqueNm: 55 },
        schema: {
            ratio:        { label: 'Ratio',       min: 0.5, max: 4.5, step: 0.1, unit: ':1' },
            widthMm:      { label: 'Belt Width',  min: 9, max: 180, step: 2, unit: 'mm' },
            spanMm:       { label: 'Center Span', min: 80, max: 1800, step: 10, unit: 'mm' },
            slipTorqueNm: { label: 'Belt Slip',   min: 12, max: 8000, step: 5, unit: 'N·m' },
        },
        analyze(p) {
            const ratio = Math.max(0.5, p.ratio);
            const w = Math.max(0.009, p.widthMm / 1000);
            const span = Math.max(0.07, p.spanMm / 1000);
            const r1 = clamp(span * 0.16, 0.022, 0.25);
            const r2 = clamp(r1 * ratio, 0.024, 0.45);
            const slipNm = Math.max(8, p.slipTorqueNm);
            const peakNm = slipNm * 1.55;
            const massKg = Math.max(0.22, (r1 * r1 + r2 * r2) * PI * w * 2700 * 0.65 + span * w * 0.8);
            const cost = 9 + w * 240 + span * 25;
            return {
                size: [r2 * 2.1, r2 * 2.1, span + r1 + r2],
                massKg,
                inertia: 0.4 * massKg * r2 * r2,
                cost,
                ratio,
                efficiency: 0.95,
                isLimiter: true,
                isSacrificial: true,
                slipTorqueNm: slipNm,
                padLifeJ: 12000 * (w / 0.025),
                r1,
                r2,
                spanM: span,
                widthM: w,
                thermalCapJ: massKg * 1100,
                thermalDissWPerK: 7 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: slipNm * 0.88,
                    torquePeakNm: peakNm,
                    rpmMax: 9000,
                    tempMaxC: 115,
                },
                wearFactor: 1.1,
                failureMode: 'freewheel',
                summary: `${ratio.toFixed(1)}:1 HTD · ${p.widthMm}mm · slip ${slipNm} N·m`,
            };
        },
    },

    chain_drive: {
        type: 'chain_drive',
        label: 'Roller Chain',
        cat: 'Transmission',
        color: '#94a3b8',
        note: 'Hardened steel roller chain & sprockets. Transmits massive torque across long spans with zero slip cushion.',
        ins: [{ id: 'rot_in', label: 'Drive Sprocket', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Driven Sprocket', domain: 'rot' }],
        defaults: { ratio: 2.2, pitchMm: 12.7, spanMm: 220, material: 'alloySteel' },
        schema: {
            ratio:    { label: 'Ratio',      min: 0.5, max: 5.0, step: 0.1, unit: ':1' },
            pitchMm:  { label: 'Chain Pitch', min: 6.35, max: 50.8, step: 3.175, unit: 'mm' },
            spanMm:   { label: 'Span',       min: 100, max: 2400, step: 20, unit: 'mm' },
            material: { label: 'Material',   kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const ratio = Math.max(0.5, p.ratio);
            const pitch = Math.max(0.006, p.pitchMm / 1000);
            const span = Math.max(0.09, p.spanMm / 1000);
            const r1 = clamp(pitch * 2.4, 0.024, 0.30);
            const r2 = clamp(r1 * ratio, 0.028, 0.55);
            const tensileN = mat.yieldPa * (pitch * pitch * 0.22);
            const torquePeak = tensileN * r2;
            const torqueCont = torquePeak * 0.45;
            const massKg = Math.max(0.45, (r1 * r1 + r2 * r2) * PI * pitch * mat.density * 0.45 + span * pitch * 14);
            const cost = 24 + massKg * mat.costPerKg * 2.5;
            return {
                size: [pitch * 2.4, r2 * 2.15, span + r1 + r2],
                massKg,
                inertia: 0.5 * massKg * r2 * r2,
                cost,
                ratio,
                efficiency: 0.96,
                r1,
                r2,
                spanM: span,
                pitchM: pitch,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 6 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torqueCont,
                    torquePeakNm: torquePeak,
                    rpmMax: clamp(4500 / Math.pow(pitch / 0.0127, 0.8), 400, 6500),
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 1.15,
                failureMode: 'freewheel',
                summary: `${ratio.toFixed(1)}:1 #${Math.round(p.pitchMm * 3.15)} Chain · ${Math.round(torqueCont)} N·m`,
            };
        },
    },

    overrun_clutch: {
        type: 'overrun_clutch',
        label: 'Sprag Freewheel',
        cat: 'Protection',
        color: '#a78bfa',
        note: 'One-way sprag clutch. Drives weapon forward cleanly, freewheels during coastdown so kinetic rotors never backdrive the motor.',
        ins: [{ id: 'rot_in', label: 'Drive In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Freewheel Out', domain: 'rot' }],
        defaults: { diameterMm: 54, material: 'toolSteel' },
        schema: {
            diameterMm: { label: 'Outer Dia', min: 28, max: 600, step: 4, unit: 'mm' },
            material:   { label: 'Material',  kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const d = Math.max(0.024, p.diameterMm / 1000);
            const len = d * 0.55;
            const massKg = Math.max(0.18, PI * (d * 0.5) ** 2 * len * mat.density * 0.65);
            const torquePeak = mat.yieldPa * 1.4e-4 * Math.pow(d / 0.05, 3) * 1.2;
            const cost = 38 + massKg * mat.costPerKg * 4.5;
            return {
                size: [d, d, len],
                massKg,
                inertia: 0.4 * massKg * (d * 0.4) ** 2,
                cost,
                ratio: 1,
                efficiency: 0.99,
                isFreewheel: true,
                backdriveDamping: 0.35, // cushions 65% of reverse backdrive spikes!
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 4.5 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torquePeak * 0.55,
                    torquePeakNm: torquePeak,
                    rpmMax: clamp(11000 / Math.pow(d / 0.05, 0.7), 900, 14000),
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 0.7,
                failureMode: 'freewheel',
                summary: `One-Way Ø${p.diameterMm}mm · ${Math.round(torquePeak * 0.55)} N·m`,
            };
        },
    },

    hydraulic_valve: {
        type: 'hydraulic_valve',
        label: 'Relief Valve',
        cat: 'Protection',
        color: '#2dd4bf',
        note: 'Hydraulic pressure-relief manifold. Bleeds pressure spikes above setpoint so hoses, pumps & cylinders never burst!',
        ins: [{ id: 'hyd_in', label: 'Hyd In', domain: 'hyd' }],
        outs: [{ id: 'hyd_out', label: 'Regulated Out', domain: 'hyd' }],
        defaults: { reliefBar: 210, flowLpm: 35 },
        schema: {
            reliefBar: { label: 'Relief Set', min: 50, max: 380, step: 10, unit: 'bar' },
            flowLpm:   { label: 'Max Flow',   min: 8, max: 800, step: 5, unit: 'L/m' },
        },
        analyze(p) {
            const bar = Math.max(40, p.reliefBar);
            const lpm = Math.max(5, p.flowLpm);
            const massKg = Math.max(0.8, 0.5 + Math.pow(lpm / 20, 0.65) * 1.1);
            const s = clamp(0.055 * Math.pow(massKg, 0.33), 0.045, 0.45);
            // Equivalent shaft-side clamp torque scaled to typical 14cc pump displacement
            const equivSlipNm = (bar * 1e5 * 14e-6) / (2 * PI) * 1.35 * Math.pow(lpm / 35, 0.65);
            const cost = 62 + massKg * 22;
            return {
                size: [s * 1.6, s * 1.15, s * 1.35],
                massKg,
                inertia: 0.001,
                cost,
                ratio: 1,
                efficiency: 0.96,
                isLimiter: true,
                reliefBar: bar,
                slipTorqueNm: equivSlipNm,
                padLifeJ: 90000 * Math.pow(massKg, 0.8),
                thermalCapJ: massKg * 520,
                thermalDissWPerK: 6 * Math.pow(massKg, 0.65),
                rated: {
                    pressureContBar: bar,
                    pressurePeakBar: bar * 1.35,
                    torqueContNm: equivSlipNm,
                    torquePeakNm: equivSlipNm * 1.35,
                    tempMaxC: 135,
                },
                wearFactor: 0.45,
                failureMode: 'freewheel',
                summary: `Relief ${bar} bar · ${lpm} L/min`,
            };
        },
    },

    radiator: {
        type: 'radiator',
        label: 'Oil / Air Cooler',
        cat: 'Protection',
        color: '#60a5fa',
        note: 'Finned aluminum heat exchanger with fan shroud. Boosts thermal dissipation across adjacent motors, worm drives & hydraulics.',
        ins: [{ id: 'struct_in', label: 'Mount', domain: 'struct' }],
        outs: [],
        defaults: { coolingKW: 3.5, widthMm: 160, heightMm: 120 },
        schema: {
            coolingKW: { label: 'Rejection', min: 0.5, max: 250, step: 0.5, unit: 'kW' },
            widthMm:   { label: 'Width',     min: 80, max: 1800, step: 20, unit: 'mm' },
            heightMm:  { label: 'Height',    min: 60, max: 1400, step: 20, unit: 'mm' },
        },
        analyze(p) {
            const w = Math.max(0.07, p.widthMm / 1000);
            const h = Math.max(0.05, p.heightMm / 1000);
            const d = Math.max(0.032, Math.min(w, h) * 0.28);
            const massKg = Math.max(0.4, w * h * d * 1150);
            const cost = 35 + p.coolingKW * 24 + massKg * 12;
            return {
                size: [w, h, d],
                massKg,
                inertia: massKg * w * w / 12,
                cost,
                coolBoostWPerK: p.coolingKW * 18, // active cooling boost added to machine thermal budget
                thermalCapJ: massKg * 900,
                thermalDissWPerK: p.coolingKW * 22,
                rated: {
                    powerContW: p.coolingKW * 1000,
                    tempMaxC: 150,
                },
                wearFactor: 0.15,
                failureMode: 'burnout',
                summary: `${p.coolingKW.toFixed(1)} kW cooler · ${p.widthMm}×${p.heightMm}mm`,
            };
        },
    },

    hydraulic_ram: {
        type: 'hydraulic_ram',
        label: 'Hydraulic Ram',
        cat: 'Transmission',
        color: '#38bdf8',
        note: 'Double-acting hydraulic cylinder (hyd -> lin). Force F = P × Area; drives piercing crushers, flippers, presses & Titan limbs.',
        ins: [{ id: 'hyd_in', label: 'Hyd In', domain: 'hyd' }],
        outs: [{ id: 'lin_out', label: 'Ram Rod', domain: 'lin' }],
        defaults: { boreMm: 58, strokeMm: 160, maxBar: 250, material: 'alloySteel' },
        schema: {
            boreMm:   { label: 'Bore Dia', min: 20, max: 350, step: 4, unit: 'mm' },
            strokeMm: { label: 'Stroke',   min: 50, max: 2400, step: 20, unit: 'mm' },
            maxBar:   { label: 'Max Bar',  min: 100, max: 400, step: 20, unit: 'bar' },
            material: { label: 'Material', kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const bore = Math.max(0.018, p.boreMm / 1000);
            const stroke = Math.max(0.04, p.strokeMm / 1000);
            const area = PI * (bore * 0.5) ** 2;
            const forcePeakN = p.maxBar * 1e5 * area;
            const forceContN = forcePeakN * 0.78;
            // Effective lever conversion so rotational powertrains couple cleanly to linear force!
            const leverM = Math.max(0.04, stroke * 0.35);
            const ratio = clamp((area * 1e5) / 14, 3.5, 45);
            const od = bore * 1.32;
            const len = stroke * 1.45;
            const massKg = Math.max(0.7, PI * (od * 0.5) ** 2 * len * mat.density * 0.42);
            const cost = 68 + massKg * mat.costPerKg * 2.8;
            return {
                size: [od, od, len],
                massKg,
                inertia: 0.25 * massKg * leverM * leverM,
                cost,
                ratio,
                efficiency: 0.91,
                boreM: bore,
                strokeM: stroke,
                forceContN,
                forcePeakN,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 6 * Math.pow(massKg, 0.65),
                rated: {
                    forceContN,
                    forcePeakN,
                    torqueContNm: forceContN * leverM,
                    torquePeakNm: forcePeakN * leverM,
                    pressureContBar: p.maxBar * 0.80,
                    pressurePeakBar: p.maxBar,
                    tempMaxC: 120,
                },
                wearFactor: 0.75,
                failureMode: 'freewheel', // blown hydraulic seal
                summary: `Ø${p.boreMm}mm × ${p.strokeMm}mm · ${(forcePeakN / 1000).toFixed(1)} kN`,
            };
        },
    },

    lead_screw: {
        type: 'lead_screw',
        label: 'Lead Screw',
        cat: 'Transmission',
        color: '#c084fc',
        note: 'Acme / ball-screw linear actuator (rot -> lin). Enormous mechanical advantage for presses, vises & clamps.',
        ins: [{ id: 'rot_in', label: 'Shaft In', domain: 'rot' }],
        outs: [{ id: 'lin_out', label: 'Carriage Out', domain: 'lin' }],
        defaults: { diameterMm: 28, leadMm: 6, strokeMm: 220, material: 'toolSteel' },
        schema: {
            diameterMm: { label: 'Screw Dia', min: 10, max: 180, step: 2, unit: 'mm' },
            leadMm:     { label: 'Lead Pitch', min: 2, max: 32, step: 1, unit: 'mm' },
            strokeMm:   { label: 'Travel',    min: 60, max: 2000, step: 20, unit: 'mm' },
            material:   { label: 'Material',  kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const d = Math.max(0.01, p.diameterMm / 1000);
            const lead = Math.max(0.002, p.leadMm / 1000);
            const stroke = Math.max(0.05, p.strokeMm / 1000);
            const eff = lead >= 0.008 ? 0.76 : 0.58;
            const ratio = clamp((2 * PI * 0.05) / lead, 6, 48);
            const forcePeakN = mat.yieldPa * 0.45 * PI * (d * 0.42) ** 2;
            const massKg = Math.max(0.35, PI * (d * 0.5) ** 2 * stroke * mat.density * 1.45);
            const cost = 44 + massKg * mat.costPerKg * 3.6;
            return {
                size: [d * 2.4, d * 2.4, stroke],
                massKg,
                inertia: 0.5 * massKg * (d * 0.5) ** 2,
                cost,
                ratio,
                efficiency: eff,
                selfLocking: eff < 0.65,
                diameterM: d,
                strokeM: stroke,
                forceContN: forcePeakN * 0.55,
                forcePeakN,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 5.5 * Math.pow(massKg, 0.65),
                rated: {
                    forceContN: forcePeakN * 0.55,
                    forcePeakN,
                    torqueContNm: forcePeakN * 0.04 * 0.55,
                    torquePeakNm: forcePeakN * 0.04,
                    rpmMax: 2400,
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 1.15,
                failureMode: 'seize',
                summary: `Tr${p.diameterMm}×${p.leadMm} · ${(forcePeakN / 1000).toFixed(1)} kN`,
            };
        },
    },

    track_unit: {
        type: 'track_unit',
        label: 'Crawler Track',
        cat: 'Output',
        color: '#10b981',
        note: 'Armored continuous tank track pod. Massive pushing traction (μ=1.65) and low ground pressure, slower top speed than wheels.',
        ins: [
            { id: 'rot_in', label: 'Sprocket In', domain: 'rot' },
            { id: 'struct_in', label: 'Mount', domain: 'struct' },
        ],
        outs: [],
        defaults: { lengthM: 0.68, heightM: 0.20, widthM: 0.11, grip: 1.65, side: 'left' },
        schema: {
            lengthM: { label: 'Length', min: 0.30, max: 6.5, step: 0.05, unit: 'm' },
            heightM: { label: 'Height', min: 0.12, max: 2.2, step: 0.02, unit: 'm' },
            widthM:  { label: 'Width',  min: 0.06, max: 1.4, step: 0.02, unit: 'm' },
            grip:    { label: 'Grip μ', min: 0.8,  max: 2.2, step: 0.05, unit: '' },
            side:    { label: 'Side',   options: { left: 'Left Track', right: 'Right Track' } },
        },
        analyze(p) {
            const L = Math.max(0.28, p.lengthM);
            const H = Math.max(0.10, p.heightM);
            const W = Math.max(0.05, p.widthM);
            const rSprocket = H * 0.44;
            const massKg = L * H * W * 1050;
            const J = 0.55 * massKg * rSprocket * rSprocket;
            const torquePeak = 900 * Math.pow(H / 0.20, 2.4) * (W / 0.10);
            const cost = 85 + massKg * 14;
            return {
                size: [W, H, L],
                massKg,
                inertia: J,
                cost,
                isOutput: 'wheel',
                isTracked: true,
                side: p.side || 'left',
                radiusM: rSprocket,
                lengthM: L,
                heightM: H,
                widthM: W,
                grip: p.grip,
                thermalCapJ: massKg * 900,
                thermalDissWPerK: 8 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torquePeak * 0.65,
                    torquePeakNm: torquePeak,
                    rpmMax: (12 / rSprocket) * 60 / (2 * PI),
                    tempMaxC: 140,
                },
                wearFactor: 0.95,
                failureMode: 'freewheel', // thrown track
                summary: `${p.side} Track ${(L * 100).toFixed(0)}×${(H * 100).toFixed(0)}cm · μ=${p.grip.toFixed(2)}`,
            };
        },
    },

    bevel_gear: {
        type: 'bevel_gear',
        label: '90° Bevel Transfer',
        cat: 'Transmission',
        color: '#fbbf24',
        note: 'Spiral-bevel 90-degree right-angle gearbox. Transfers longitudinal engine/motor power to transverse shafts or vertical spindles.',
        ins: [{ id: 'rot_in', label: 'Pinion In', domain: 'rot' }],
        outs: [{ id: 'rot_out', label: 'Crown Out', domain: 'rot' }],
        defaults: { ratio: 2.0, crownOdMm: 92, material: 'alloySteel' },
        schema: {
            ratio:     { label: 'Ratio',    min: 1.0, max: 4.5, step: 0.25, unit: ':1' },
            crownOdMm: { label: 'Crown OD', min: 45, max: 1400, step: 5, unit: 'mm' },
            material:  { label: 'Material', kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const ratio = Math.max(1.0, p.ratio);
            const od = Math.max(0.04, p.crownOdMm / 1000);
            const rC = od * 0.5;
            const fw = od * 0.24;
            const torquePeak = mat.yieldPa * 0.38 * fw * (rC * 0.16) * rC * 2.2;
            const massKg = Math.max(0.35, od * od * od * mat.density * 0.28);
            const cost = 54 + massKg * mat.costPerKg * 3.5;
            return {
                size: [od * 1.15, od * 1.05, od * 1.15],
                massKg,
                inertia: 0.45 * massKg * rC * rC,
                cost,
                ratio,
                efficiency: 0.95,
                odM: od,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 6 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torquePeak * 0.55,
                    torquePeakNm: torquePeak,
                    rpmMax: clamp(8200 / Math.pow(od / 0.09, 0.65), 700, 12000),
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 0.78,
                failureMode: 'freewheel',
                summary: `90° Bevel ${ratio.toFixed(2)}:1 · Ø${p.crownOdMm}mm`,
            };
        },
    },

    differential: {
        type: 'differential',
        label: 'Summing Differential',
        cat: 'Transmission',
        color: '#f97316',
        note: 'Cutaway bevel spider differential / torque combiner. Sums twin motors or engines onto a single high-power shaft (or splits 1->2).',
        ins: [
            { id: 'rot_in', label: 'Drive A In', domain: 'rot' },
            { id: 'rot_in_b', label: 'Drive B In', domain: 'rot' },
        ],
        outs: [
            { id: 'rot_out', label: 'Main Out', domain: 'rot' },
            { id: 'rot_out_b', label: 'Aux Out', domain: 'rot' },
        ],
        defaults: { ratio: 1.5, carrierOdMm: 118, material: 'toolSteel' },
        schema: {
            ratio:       { label: 'Ratio',      min: 1.0, max: 4.0, step: 0.25, unit: ':1' },
            carrierOdMm: { label: 'Carrier OD', min: 65, max: 1600, step: 8, unit: 'mm' },
            material:    { label: 'Material',   kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const ratio = Math.max(1.0, p.ratio);
            const od = Math.max(0.055, p.carrierOdMm / 1000);
            const r = od * 0.5;
            const torquePeak = mat.yieldPa * 0.44 * (od * 0.28) * (r * 0.18) * r * 3.0;
            const massKg = Math.max(0.65, od * od * od * mat.density * 0.36);
            const cost = 88 + massKg * mat.costPerKg * 3.9;
            return {
                size: [od * 1.25, od * 1.05, od * 1.25],
                massKg,
                inertia: 0.52 * massKg * r * r,
                cost,
                ratio,
                efficiency: 0.94,
                odM: od,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 7 * Math.pow(massKg, 0.65),
                rated: {
                    torqueContNm: torquePeak * 0.58,
                    torquePeakNm: torquePeak,
                    rpmMax: clamp(7500 / Math.pow(od / 0.11, 0.65), 600, 10000),
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 0.72,
                failureMode: 'freewheel',
                summary: `Bevel Diff ${ratio.toFixed(1)}:1 · Ø${p.carrierOdMm}mm`,
            };
        },
    },

    crank_slider: {
        type: 'crank_slider',
        label: 'Crank-Slider Ram',
        cat: 'Transmission',
        color: '#ec4899',
        note: 'Eccentric crankshaft & steel connecting rod (rot -> reciprocating lin). Drives rapid battering spears, jackhammers & punch presses!',
        ins: [{ id: 'rot_in', label: 'Crank In', domain: 'rot' }],
        outs: [{ id: 'lin_out', label: 'Recip Rod', domain: 'lin' }],
        defaults: { throwMm: 42, rodLenMm: 155, material: 'toolSteel' },
        schema: {
            throwMm:  { label: 'Crank Throw', min: 14, max: 360, step: 4, unit: 'mm' },
            rodLenMm: { label: 'Conrod Len',  min: 70, max: 1400, step: 10, unit: 'mm' },
            material: { label: 'Material',    kind: 'material' },
        },
        analyze(p) {
            const mat = matOf(p.material);
            const rThrow = Math.max(0.012, p.throwMm / 1000);
            const rodL = Math.max(rThrow * 2.4, p.rodLenMm / 1000);
            const forcePeakN = mat.yieldPa * 0.35 * (rThrow * 0.55) ** 2;
            const torquePeak = forcePeakN * rThrow * 1.4;
            const massKg = Math.max(0.55, (rThrow * 2.4) ** 2 * rodL * mat.density * 0.24);
            const cost = 64 + massKg * mat.costPerKg * 3.4;
            return {
                size: [rThrow * 3.2, rThrow * 2.8, rodL + rThrow * 2.2],
                massKg,
                inertia: 0.45 * massKg * rThrow * rThrow,
                cost,
                ratio: 2.2,
                efficiency: 0.92,
                throwM: rThrow,
                rodLenM: rodL,
                forceContN: forcePeakN * 0.52,
                forcePeakN,
                thermalCapJ: massKg * mat.specificHeat,
                thermalDissWPerK: 6.5 * Math.pow(massKg, 0.65),
                rated: {
                    forceContN: forcePeakN * 0.52,
                    forcePeakN,
                    torqueContNm: torquePeak * 0.52,
                    torquePeakNm: torquePeak,
                    rpmMax: clamp(3200 / Math.pow(rThrow / 0.04, 0.55), 350, 4800),
                    tempMaxC: mat.maxTempC,
                },
                wearFactor: mat.wearFactor * 1.05,
                failureMode: 'seize',
                summary: `${(p.throwMm * 2).toFixed(0)}mm stroke · ${(forcePeakN / 1000).toFixed(1)} kN`,
            };
        },
    },
};
