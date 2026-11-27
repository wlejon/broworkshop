// lib/foundry/parts.js — the primitive parts a mechanism is built from.
//
// A part is the same thing a compiled assembly is (see compile.js): a box in
// its own frame, ports placed on it, and what it does between its ports. So
// a part and a contract are interchangeable as children of an assembly.
//
//   build(params) -> {
//     box:      { min, max }              metres, the part's frame
//     massKg, com
//     ports:    [{ id, label, domain, dir, pos, axis }]
//                 domain  rot | lin | hyd | elec | mnt
//                 dir     in | out
//                 pos     where the port is, on the box's surface
//                 axis    the way the port faces (a unit axis, outward)
//     paths:    [{ from, to, k, eff, cont, peak, flowMax, mode, role, label }]
//                 power entering `from` leaves `to` with
//                   effort_out = effort_in * k * eff,  flow_out = flow_in / k
//                 cont / peak: the effort at `to` this part carries forever /
//                 once; flowMax: the fastest `to` turns or moves.
//                 role: 'limiter' slips at peak, 'fuse' breaks at peak.
//     sources:  [{ port, stall, noLoad, cont, power, draw }]
//                 an output that makes power: effort `stall` at rest falling
//                 to 0 at flow `noLoad`, `cont` held forever, `power` at most;
//                 draw: { port, eff } the input it runs from (electric)
//     supplies: [{ port, voltage, power, peak, energyWh }]   electric
//     shape:    what partmesh.js draws (the dimensions it needs)
//     summary
//   }
//
// Domains: rot carries torque (N·m) and angular speed (rad/s); lin force (N)
// and speed (m/s); hyd pressure (Pa) and flow (m³/s); elec power (W); mnt is
// a structural mount, carrying weight and no power. Mechanical ports (rot,
// lin, mnt) mate face to face; hyd and elec are hoses and
// cables, so they connect wherever the ports are.

import { matOf } from "./materials.js";

const PI = Math.PI;
const RPM = (2 * PI) / 60;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function lewisY(teeth) {
    return 0.484 - 2.87 / Math.max(8, teeth);
}

function box(x0, y0, z0, x1, y1, z1) { return { min: [x0, y0, z0], max: [x1, y1, z1] }; }
function port(id, label, domain, dir, pos, axis) { return { id, label, domain, dir, pos, axis }; }

// Spur mesh strength of a pinion (Lewis), torques at the pinion.
function spurStrength(z, moduleM, faceM, mat) {
    const Y = lewisY(z);
    const r = 0.5 * moduleM * z;
    return {
        cont: mat.fatiguePa * 0.55 * faceM * moduleM * Y * r,
        peak: mat.ultimatePa * 0.72 * faceM * moduleM * Y * r,
    };
}

export const PARTS = {
    battery: {
        label: 'Battery Pack',
        cat: 'Power',
        note: 'Stored electric power. What it can give at once is its capacity times its C-rate.',
        defaults: { voltage: 48, capacityWh: 600, maxC: 10 },
        schema: {
            voltage: { label: 'Voltage', min: 12, max: 800, step: 12, unit: 'V' },
            capacityWh: { label: 'Capacity', min: 50, max: 200000, step: 50, unit: 'Wh' },
            maxC: { label: 'C-rate', min: 1, max: 30, step: 1, unit: 'C' },
        },
        build(p) {
            const wh = Math.max(20, p.capacityWh);
            const massKg = wh / 150;
            const s = Math.cbrt(massKg / 1900);
            const hx = s * 0.75, hy = s * 0.42, hz = s * 0.55;
            const power = wh * p.maxC;
            return {
                box: box(-hx, -hy, -hz, hx, hy, hz),
                massKg,
                ports: [port('pwr', 'Power Out', 'elec', 'out', [hx * 0.55, hy, -hz * 0.5], [0, 1, 0])],
                paths: [],
                sources: [],
                supplies: [{ port: 'pwr', voltage: p.voltage, power, peak: power * 1.8, energyWh: wh }],
                shape: { kind: 'battery', hx, hy, hz },
                summary: `${p.voltage} V · ${wh} Wh · ${(power / 1000).toFixed(1)} kW`,
            };
        },
    },

    motor: {
        label: 'Electric Motor',
        cat: 'Power',
        note: 'Brushless motor. Torque falls in a straight line from stall to its no-load speed; it holds about 40% of stall forever.',
        defaults: { powerW: 2400, noLoadRpm: 3600, efficiency: 0.88 },
        schema: {
            powerW: { label: 'Power', min: 100, max: 2000000, step: 100, unit: 'W' },
            noLoadRpm: { label: 'No-load', min: 300, max: 12000, step: 100, unit: 'rpm' },
            efficiency: { label: 'Efficiency', min: 0.7, max: 0.96, step: 0.01, unit: '' },
        },
        build(p) {
            const P = Math.max(50, p.powerW);
            const wNl = Math.max(10, p.noLoadRpm) * RPM;
            const stall = (4 * P) / wNl;
            const massKg = 0.6 + Math.pow(P / 1000, 0.82) * 1.45;
            const r = clamp(0.034 * Math.pow(massKg, 0.33), 0.022, 2.0);
            const len = r * 2.3;
            const stub = r * 0.32;
            return {
                box: box(-r, -r, -len / 2, r, r * 1.22, len / 2 + stub),
                massKg,
                ports: [
                    port('pwr', 'Power In', 'elec', 'in', [0, r * 1.22, -len * 0.18], [0, 1, 0]),
                    port('out', 'Shaft', 'rot', 'out', [0, 0, len / 2 + stub], [0, 0, 1]),
                ],
                paths: [],
                sources: [{
                    port: 'out', stall, noLoad: wNl, cont: stall * 0.42, power: P,
                    draw: { port: 'pwr', eff: clamp(p.efficiency, 0.5, 0.97) },
                }],
                supplies: [],
                shape: { kind: 'motor', r, len, stub },
                summary: `${(P / 1000).toFixed(1)} kW · ${p.noLoadRpm} rpm · ${stall.toFixed(1)} N·m stall`,
            };
        },
    },

    engine: {
        label: 'Combustion Engine',
        cat: 'Power',
        note: 'Runs on its own fuel. Flat torque across its band, and it never stalls the way a motor does: it just dies.',
        defaults: { displacementCc: 2000, cylinders: 4, redlineRpm: 5200 },
        schema: {
            displacementCc: { label: 'Displacement', min: 50, max: 60000, step: 50, unit: 'cc' },
            cylinders: { label: 'Cylinders', min: 1, max: 16, step: 1, unit: '' },
            redlineRpm: { label: 'Redline', min: 1500, max: 9000, step: 100, unit: 'rpm' },
        },
        build(p) {
            const cc = Math.max(25, p.displacementCc);
            const cyl = clamp(Math.round(p.cylinders), 1, 16);
            const torque = cc * 0.075;
            const wRed = p.redlineRpm * RPM;
            const power = torque * wRed * 0.75;
            const massKg = 3 + Math.pow(cc / 100, 0.85) * 4.5;
            const s = Math.cbrt(massKg / 1500);
            const len = s * (0.55 + 0.12 * cyl), hw = s * 0.42, hh = s * 0.55, stub = s * 0.12;
            return {
                box: box(-hw, -hh, -len / 2, hw, hh, len / 2 + stub),
                massKg,
                ports: [port('out', 'Crank', 'rot', 'out', [0, -hh * 0.35, len / 2 + stub], [0, 0, 1])],
                paths: [],
                // Flat band: stall stands for the torque near idle, noLoad the redline.
                sources: [{ port: 'out', stall: torque * 1.35, noLoad: wRed, cont: torque * 0.8, power }],
                supplies: [],
                shape: { kind: 'engine', hw, hh, len, stub, cyl, crankY: -hh * 0.35 },
                summary: `${cc} cc · ${cyl} cyl · ${(power / 1000).toFixed(0)} kW`,
            };
        },
    },

    shaft: {
        label: 'Drive Shaft',
        cat: 'Transmission',
        note: 'Carries torque across a gap. Twists off if it is too thin for what goes through it.',
        defaults: { diameterMm: 20, lengthMm: 120, material: 'alloySteel' },
        schema: {
            diameterMm: { label: 'Diameter', min: 4, max: 800, step: 1, unit: 'mm' },
            lengthMm: { label: 'Length', min: 10, max: 20000, step: 10, unit: 'mm' },
            material: { label: 'Material', kind: 'material' },
        },
        build(p) {
            const mat = matOf(p.material);
            const d = Math.max(0.003, p.diameterMm / 1000), L = Math.max(0.01, p.lengthMm / 1000);
            const hub = d * 0.9;
            const peak = (PI / 16) * d ** 3 * mat.shearPa;
            return {
                box: box(-hub, -hub, -L / 2, hub, hub, L / 2),
                massKg: PI * (d / 2) ** 2 * L * mat.density,
                ports: [
                    port('in', 'In', 'rot', 'in', [0, 0, -L / 2], [0, 0, -1]),
                    port('out', 'Out', 'rot', 'out', [0, 0, L / 2], [0, 0, 1]),
                ],
                paths: [{ from: 'in', to: 'out', k: 1, eff: 0.998, cont: peak * 0.42, peak, flowMax: 15000 * RPM, mode: 'twists off', label: 'shaft' }],
                sources: [], supplies: [],
                shape: { kind: 'shaft', d, L, hub },
                summary: `Ø${p.diameterMm} × ${p.lengthMm} mm · ${peak.toFixed(0)} N·m`,
            };
        },
    },

    spur: {
        label: 'Spur Gear Stage',
        cat: 'Transmission',
        note: 'A pinion driving a gear between two plates. The output shaft is offset by the centre distance. The pinion teeth strip first.',
        defaults: { teethIn: 14, teethOut: 42, moduleMm: 2, faceMm: 16, material: 'alloySteel' },
        schema: {
            teethIn: { label: 'Pinion', min: 10, max: 60, step: 1, unit: 'T' },
            teethOut: { label: 'Gear', min: 12, max: 160, step: 1, unit: 'T' },
            moduleMm: { label: 'Module', min: 0.5, max: 40, step: 0.5, unit: 'mm' },
            faceMm: { label: 'Face', min: 4, max: 600, step: 2, unit: 'mm' },
            material: { label: 'Material', kind: 'material' },
        },
        build(p) {
            const mat = matOf(p.material);
            const z1 = Math.max(10, Math.round(p.teethIn)), z2 = Math.max(10, Math.round(p.teethOut));
            const m = Math.max(0.0005, p.moduleMm / 1000), b = Math.max(0.002, p.faceMm / 1000);
            const r1 = 0.5 * m * z1, r2 = 0.5 * m * z2, cd = r1 + r2;
            const ra1 = r1 + m, ra2 = r2 + m;
            const k = z2 / z1;
            const s = spurStrength(z1, m, b, mat);
            const plate = Math.max(0.003, b * 0.28);
            const pad = Math.max(0.004, m * 2.5);
            const hz = b / 2 + plate;
            const stub = Math.max(0.006, r1 * 0.9);
            const ry = Math.max(ra1, ra2) + pad;
            const massKg = PI * (r1 * r1 + r2 * r2) * b * mat.density * 0.8 + 2 * (2 * cd + ra1 + ra2) * 2 * ry * plate * 2700 * 0.55;
            return {
                box: box(-cd / 2 - ra1 - pad, -ry, -hz - stub, cd / 2 + ra2 + pad, ry, hz + stub),
                massKg,
                ports: [
                    port('in', 'Pinion', 'rot', 'in', [-cd / 2, 0, -hz - stub], [0, 0, -1]),
                    port('out', 'Gear', 'rot', 'out', [cd / 2, 0, hz + stub], [0, 0, 1]),
                ],
                paths: [{
                    from: 'in', to: 'out', k, eff: 0.97,
                    cont: s.cont * k, peak: s.peak * k,
                    flowMax: (25 / Math.max(0.004, r1)) / k, mode: 'strips its teeth', label: 'pinion',
                }],
                sources: [], supplies: [],
                shape: { kind: 'spur', z1, z2, m, b, r1, r2, cd, plate, stub, pad, ry, hz },
                summary: `${k.toFixed(2)}:1 · ${(s.peak * k).toFixed(0)} N·m strip`,
            };
        },
    },

    planetary: {
        label: 'Planetary Stage',
        cat: 'Transmission',
        note: 'Sun in, carrier out, ring fixed. Shares the load over its planets, so it is strong for its size, and stays on one axis.',
        defaults: { sunTeeth: 15, planetTeeth: 24, planets: 4, moduleMm: 2, faceMm: 22, material: 'alloySteel' },
        schema: {
            sunTeeth: { label: 'Sun', min: 10, max: 60, step: 1, unit: 'T' },
            planetTeeth: { label: 'Planet', min: 10, max: 80, step: 1, unit: 'T' },
            planets: { label: 'Planets', min: 3, max: 6, step: 1, unit: '' },
            moduleMm: { label: 'Module', min: 0.5, max: 40, step: 0.5, unit: 'mm' },
            faceMm: { label: 'Face', min: 4, max: 600, step: 2, unit: 'mm' },
            material: { label: 'Material', kind: 'material' },
        },
        build(p) {
            const mat = matOf(p.material);
            const zs = Math.max(10, Math.round(p.sunTeeth)), zp = Math.max(10, Math.round(p.planetTeeth));
            const zr = zs + 2 * zp, n = clamp(Math.round(p.planets), 3, 6);
            const m = Math.max(0.0005, p.moduleMm / 1000), b = Math.max(0.002, p.faceMm / 1000);
            const k = 1 + zr / zs;
            const s = spurStrength(zs, m, b, mat);
            const R = 0.5 * m * zr + m * 3.2;
            const hz = b / 2 + Math.max(0.004, b * 0.35);
            const stub = Math.max(0.006, m * zs * 0.5);
            return {
                box: box(-R, -R, -hz - stub, R, R, hz + stub),
                massKg: PI * R * R * b * mat.density * 0.55 + PI * R * R * hz * 2 * 2700 * 0.3,
                ports: [
                    port('in', 'Sun', 'rot', 'in', [0, 0, -hz - stub], [0, 0, -1]),
                    port('out', 'Carrier', 'rot', 'out', [0, 0, hz + stub], [0, 0, 1]),
                ],
                paths: [{
                    from: 'in', to: 'out', k, eff: 0.97,
                    cont: s.cont * n * 0.8 * k, peak: s.peak * n * 0.8 * k,
                    flowMax: (22 / Math.max(0.004, 0.5 * m * zs)) / k, mode: 'strips its sun', label: 'sun gear',
                }],
                sources: [], supplies: [],
                shape: { kind: 'planetary', zs, zp, zr, n, m, b, R, hz, stub },
                summary: `${k.toFixed(2)}:1 · ${n} planets · ${(s.peak * n * 0.8 * k).toFixed(0)} N·m`,
            };
        },
    },

    worm: {
        label: 'Worm Drive',
        cat: 'Transmission',
        note: 'Turns the drive through a right angle with a huge ratio in one step. Slow and lossy; below 50% efficiency it holds its load with the power off.',
        defaults: { wheelTeeth: 40, starts: 1, quotient: 10, moduleMm: 3, faceMm: 28, material: 'bronze' },
        schema: {
            wheelTeeth: { label: 'Wheel', min: 20, max: 120, step: 1, unit: 'T' },
            starts: { label: 'Starts', min: 1, max: 4, step: 1, unit: '' },
            quotient: { label: 'Worm Ø', min: 6, max: 24, step: 1, unit: '× module' },
            moduleMm: { label: 'Module', min: 1, max: 40, step: 0.5, unit: 'mm' },
            faceMm: { label: 'Face', min: 6, max: 600, step: 2, unit: 'mm' },
            material: { label: 'Wheel', kind: 'material' },
        },
        build(p) {
            const mat = matOf(p.material);
            const zw = Math.max(16, Math.round(p.wheelTeeth)), st = clamp(Math.round(p.starts), 1, 4);
            const m = Math.max(0.001, p.moduleMm / 1000), b = Math.max(0.004, p.faceMm / 1000);
            const k = zw / st;
            // Wheel and worm pitch radii; the worm's diameter is `quotient` modules,
            // so a fatter worm (or fewer starts) has a shallower lead: slower to
            // drive and, once its lead is under the friction angle, self-locking.
            const q = clamp(p.quotient ?? 10, 6, 24);
            const rw = 0.5 * m * zw, rq = 0.5 * m * q;
            const cd = rw + rq;
            const lead = Math.atan((st * m) / (2 * rq));
            const eff = clamp(Math.tan(lead) / Math.tan(lead + 0.06), 0.25, 0.92);
            // Bronze wheel teeth carry the load; worm teeth wrap them, so ~1.6x a spur tooth.
            const s = spurStrength(zw, m, b, mat);
            const wl = rq * 2 + m * 8;                  // worm length along X
            const pad = m * 2.5, hz = b / 2 + m * 2.2, stub = Math.max(0.008, rq * 0.9);
            const top = cd + rq + m + pad;
            const half = Math.max(rw + m + pad, wl / 2 + pad);
            return {
                box: box(-half - stub, -rw - m - pad, -hz, half, top, hz + stub),
                massKg: PI * rw * rw * b * mat.density * 0.7 + 2 * half * (top + rw) * 2 * hz * 7200 * 0.18,
                ports: [
                    port('in', 'Worm', 'rot', 'in', [-half - stub, cd, 0], [-1, 0, 0]),
                    port('out', 'Wheel', 'rot', 'out', [0, 0, hz + stub], [0, 0, 1]),
                    port('base', 'Base', 'mnt', 'in', [0, -rw - m - pad, 0], [0, -1, 0]),
                ],
                paths: [{
                    from: 'in', to: 'out', k, eff,
                    cont: s.cont * 1.6, peak: s.peak * 1.6,
                    flowMax: (3000 * RPM) / k, mode: 'strips its wheel', label: 'worm wheel',
                    selfLocking: eff < 0.5,
                }],
                sources: [], supplies: [],
                shape: { kind: 'worm', zw, st, m, b, rw, rq, cd, wl, half, hz, stub, top, pad },
                summary: `${k.toFixed(0)}:1 · ${(eff * 100).toFixed(0)}%${eff < 0.5 ? ' · self-locking' : ''}`,
            };
        },
    },

    bevel: {
        label: 'Bevel Stage',
        cat: 'Transmission',
        note: 'Turns the drive through a right angle at a modest ratio.',
        defaults: { teethIn: 18, teethOut: 36, moduleMm: 2.5, faceMm: 14, material: 'alloySteel' },
        schema: {
            teethIn: { label: 'Pinion', min: 10, max: 60, step: 1, unit: 'T' },
            teethOut: { label: 'Gear', min: 10, max: 120, step: 1, unit: 'T' },
            moduleMm: { label: 'Module', min: 0.5, max: 40, step: 0.5, unit: 'mm' },
            faceMm: { label: 'Face', min: 4, max: 400, step: 2, unit: 'mm' },
            material: { label: 'Material', kind: 'material' },
        },
        build(p) {
            const mat = matOf(p.material);
            const z1 = Math.max(10, Math.round(p.teethIn)), z2 = Math.max(10, Math.round(p.teethOut));
            const m = Math.max(0.0005, p.moduleMm / 1000), b = Math.max(0.002, p.faceMm / 1000);
            const r1 = 0.5 * m * z1, r2 = 0.5 * m * z2, k = z2 / z1;
            const s = spurStrength(z1, m, b * 0.85, mat);
            const pad = m * 3, stub = Math.max(0.006, r1 * 0.8);
            // Pinion on Z (input from -Z), gear on X (output to +X); they meet at the origin corner.
            const hx = r1 + b + pad, hz = r2 + b + pad;
            return {
                box: box(-r1 - pad, -r2 - pad, -hz - stub, hx + stub, r2 + pad, r1 + pad),
                massKg: PI * (r1 * r1 + r2 * r2) * b * mat.density + (hx + r1) * 2 * (r2 + pad) * (hz + r1) * 7200 * 0.08,
                ports: [
                    port('in', 'Pinion', 'rot', 'in', [0, 0, -hz - stub], [0, 0, -1]),
                    port('out', 'Gear', 'rot', 'out', [hx + stub, 0, 0], [1, 0, 0]),
                ],
                paths: [{ from: 'in', to: 'out', k, eff: 0.96, cont: s.cont * k, peak: s.peak * k, flowMax: (20 / Math.max(0.004, r1)) / k, mode: 'strips its teeth', label: 'bevel pinion' }],
                sources: [], supplies: [],
                shape: { kind: 'bevel', z1, z2, m, b, r1, r2, pad, stub, hx, hz },
                summary: `${k.toFixed(2)}:1 · right angle`,
            };
        },
    },

    chain: {
        label: 'Chain Drive',
        cat: 'Transmission',
        note: 'Carries the drive sideways across a span at a ratio. Long reach for little weight.',
        defaults: { teethIn: 13, teethOut: 39, pitchMm: 12.7, spanMm: 220, material: 'alloySteel' },
        schema: {
            teethIn: { label: 'Driver', min: 9, max: 60, step: 1, unit: 'T' },
            teethOut: { label: 'Driven', min: 9, max: 120, step: 1, unit: 'T' },
            pitchMm: { label: 'Pitch', min: 6, max: 200, step: 0.5, unit: 'mm' },
            spanMm: { label: 'Span', min: 40, max: 20000, step: 10, unit: 'mm' },
            material: { label: 'Material', kind: 'material' },
        },
        build(p) {
            const mat = matOf(p.material);
            const z1 = Math.max(9, Math.round(p.teethIn)), z2 = Math.max(9, Math.round(p.teethOut));
            const pc = Math.max(0.004, p.pitchMm / 1000), span = Math.max(0.03, p.spanMm / 1000);
            const r1 = pc / (2 * Math.sin(PI / z1)), r2 = pc / (2 * Math.sin(PI / z2));
            const k = z2 / z1;
            // Chain tensile strength ~ 0.24 * pitch² * UTS (roller chain).
            const tens = 0.24 * pc * pc * mat.ultimatePa;
            const w = pc * 1.1, plate = pc * 0.25, stub = pc * 0.9;
            const ry = Math.max(r1, r2) + pc;
            return {
                box: box(-ry, -r1 - pc, -w / 2 - plate - stub, ry, span + r2 + pc, w / 2 + plate + stub),
                massKg: span * 2 * pc * pc * 7800 * 0.9 + PI * (r1 * r1 + r2 * r2) * w * 7800 * 0.5,
                ports: [
                    port('in', 'Driver', 'rot', 'in', [0, 0, -w / 2 - plate - stub], [0, 0, -1]),
                    port('out', 'Driven', 'rot', 'out', [0, span, w / 2 + plate + stub], [0, 0, 1]),
                ],
                paths: [{ from: 'in', to: 'out', k, eff: 0.97, cont: tens * 0.2 * r2, peak: tens * r2, flowMax: (12 / r1) * (1 / k), mode: 'snaps its chain', label: 'chain' }],
                sources: [], supplies: [],
                shape: { kind: 'chain', z1, z2, pc, span, r1, r2, w, plate, stub },
                summary: `${k.toFixed(2)}:1 over ${(span * 1000).toFixed(0)} mm`,
            };
        },
    },

    clutch: {
        label: 'Slip Clutch',
        cat: 'Protection',
        note: 'Slips at its set torque instead of passing a shock on. Parts behind it never see more than that.',
        defaults: { slipNm: 120, radiusMm: 60 },
        schema: {
            slipNm: { label: 'Slips at', min: 2, max: 2000000, step: 5, unit: 'N·m' },
            radiusMm: { label: 'Plate radius', min: 15, max: 2000, step: 5, unit: 'mm' },
        },
        build(p) {
            const r = Math.max(0.012, p.radiusMm / 1000), T = Math.max(1, p.slipNm);
            const len = Math.max(0.03, r * 0.8), stub = r * 0.3;
            return {
                box: box(-r, -r, -len / 2 - stub, r, r, len / 2 + stub),
                massKg: 0.2 + PI * r * r * len * 7600 * 0.45,
                ports: [
                    port('in', 'In', 'rot', 'in', [0, 0, -len / 2 - stub], [0, 0, -1]),
                    port('out', 'Out', 'rot', 'out', [0, 0, len / 2 + stub], [0, 0, 1]),
                ],
                paths: [{ from: 'in', to: 'out', k: 1, eff: 0.99, cont: T, peak: T, flowMax: 8000 * RPM, mode: 'slips', role: 'limiter', label: 'clutch' }],
                sources: [], supplies: [],
                shape: { kind: 'clutch', r, len, stub },
                summary: `slips at ${T.toFixed(0)} N·m`,
            };
        },
    },

    shearPin: {
        label: 'Shear Pin',
        cat: 'Protection',
        note: 'A cheap pin that breaks clean above its torque, so the gears behind it do not.',
        defaults: { diameterMm: 6, material: 'brass' },
        schema: {
            diameterMm: { label: 'Pin', min: 1, max: 200, step: 0.5, unit: 'mm' },
            material: { label: 'Material', kind: 'material' },
        },
        build(p) {
            const mat = matOf(p.material);
            const d = Math.max(0.001, p.diameterMm / 1000);
            const hub = Math.max(0.012, d * 2.4), len = hub * 1.5;
            const snap = (PI / 4) * d * d * mat.shearPa * 2 * hub * 0.5;
            return {
                box: box(-hub, -hub, -len / 2, hub, hub, len / 2),
                massKg: PI * hub * hub * len * 7850 * 0.4,
                ports: [
                    port('in', 'In', 'rot', 'in', [0, 0, -len / 2], [0, 0, -1]),
                    port('out', 'Out', 'rot', 'out', [0, 0, len / 2], [0, 0, 1]),
                ],
                paths: [{ from: 'in', to: 'out', k: 1, eff: 0.999, cont: snap * 0.7, peak: snap, flowMax: 15000 * RPM, mode: 'shears', role: 'fuse', label: 'shear pin' }],
                sources: [], supplies: [],
                shape: { kind: 'shearPin', d, hub, len },
                summary: `breaks at ${snap.toFixed(0)} N·m`,
            };
        },
    },

    leadScrew: {
        label: 'Ball Screw',
        cat: 'Motion',
        note: 'Turns rotation into a push along its axis. Fine lead: big force, slow. The nut carriage runs the stroke.',
        defaults: { diameterMm: 25, leadMm: 10, strokeMm: 400, ball: 1 },
        schema: {
            diameterMm: { label: 'Diameter', min: 6, max: 600, step: 1, unit: 'mm' },
            leadMm: { label: 'Lead', min: 1, max: 200, step: 1, unit: 'mm' },
            strokeMm: { label: 'Stroke', min: 20, max: 30000, step: 10, unit: 'mm' },
            ball: { label: 'Ball nut', options: { 1: 'Ball (90%)', 0: 'Acme (35%)' } },
        },
        build(p) {
            const d = Math.max(0.004, p.diameterMm / 1000), lead = Math.max(0.0005, p.leadMm / 1000);
            const stroke = Math.max(0.01, p.strokeMm / 1000);
            const ball = String(p.ball) !== '0';
            const k = (2 * PI) / lead, eff = ball ? 0.9 : 0.35;
            // Thrust: root area in compression, and Euler buckling over the stroke.
            const root = d * 0.82;
            const crush = (PI / 4) * root * root * 380e6;
            const buckle = (PI * PI * 205e9 * (PI * root ** 4 / 64)) / ((0.7 * stroke) ** 2);
            const peak = Math.min(crush, buckle);
            const nut = d * 1.6, block = d * 1.2;
            const L = stroke + nut * 1.4 + block * 2;
            return {
                box: box(-nut, -nut, -L / 2, nut, nut, L / 2 + d * 0.6),
                massKg: PI * (d / 2) ** 2 * L * 7850 + nut * nut * nut * 7850 * 2,
                ports: [
                    port('in', 'Screw', 'rot', 'in', [0, 0, -L / 2], [0, 0, -1]),
                    port('out', 'Rod', 'lin', 'out', [0, 0, L / 2 + d * 0.6], [0, 0, 1]),
                ],
                paths: [{ from: 'in', to: 'out', k, eff, cont: peak * 0.4, peak, flowMax: (3000 * RPM) / k, mode: peak === buckle ? 'buckles' : 'crushes its thread', label: 'screw' }],
                sources: [], supplies: [],
                shape: { kind: 'leadScrew', d, lead, stroke, nut, block, L, ball },
                summary: `${(lead * 1000).toFixed(0)} mm lead · ${(peak / 1000).toFixed(1)} kN · ${(stroke * 1000).toFixed(0)} mm`,
            };
        },
    },

    pump: {
        label: 'Hydraulic Pump',
        cat: 'Hydraulics',
        note: 'Turns shaft power into oil flow. Pressure is torque over displacement; the relief caps it.',
        defaults: { displacementCc: 10, reliefBar: 250 },
        schema: {
            displacementCc: { label: 'Displacement', min: 1, max: 5000, step: 1, unit: 'cc/rev' },
            reliefBar: { label: 'Relief', min: 50, max: 450, step: 10, unit: 'bar' },
        },
        build(p) {
            const D = Math.max(1e-7, p.displacementCc * 1e-6);
            const k = (2 * PI) / D;
            const relief = p.reliefBar * 1e5;
            const s = Math.cbrt(D) * 4.2;
            const len = s * 1.3, stub = s * 0.25;
            return {
                box: box(-s / 2, -s / 2, -len / 2 - stub, s / 2, s / 2 + s * 0.18, len / 2),
                massKg: 1.2 + s * s * len * 7200 * 0.35,
                ports: [
                    port('in', 'Shaft', 'rot', 'in', [0, 0, -len / 2 - stub], [0, 0, -1]),
                    port('out', 'Pressure', 'hyd', 'out', [0, s / 2 + s * 0.18, len * 0.15], [0, 1, 0]),
                ],
                paths: [{ from: 'in', to: 'out', k, eff: 0.88, cont: relief * 0.85, peak: relief, flowMax: D * 60, mode: 'relieves', role: 'limiter', label: 'relief valve' }],
                sources: [], supplies: [],
                shape: { kind: 'pump', s, len, stub },
                summary: `${p.displacementCc} cc/rev · relief ${p.reliefBar} bar`,
            };
        },
    },

    ram: {
        label: 'Hydraulic Ram',
        cat: 'Hydraulics',
        note: 'Oil pressure on a piston: force is pressure times bore area. A long thin rod buckles before the cylinder bursts.',
        defaults: { boreMm: 63, rodMm: 36, strokeMm: 500, ratedBar: 210 },
        schema: {
            boreMm: { label: 'Bore', min: 16, max: 1500, step: 1, unit: 'mm' },
            rodMm: { label: 'Rod', min: 8, max: 1000, step: 1, unit: 'mm' },
            strokeMm: { label: 'Stroke', min: 20, max: 30000, step: 10, unit: 'mm' },
            ratedBar: { label: 'Rated', min: 50, max: 450, step: 10, unit: 'bar' },
        },
        build(p) {
            const bore = Math.max(0.01, p.boreMm / 1000), rod = Math.min(bore * 0.9, Math.max(0.006, p.rodMm / 1000));
            const stroke = Math.max(0.01, p.strokeMm / 1000), rated = p.ratedBar * 1e5;
            const A = (PI / 4) * bore * bore;
            const buckle = (PI * PI * 205e9 * (PI * rod ** 4 / 64)) / ((2 * stroke) ** 2);
            const wall = bore * 0.12, R = bore / 2 + wall;
            const body = stroke + bore * 1.2;
            const eye = rod * 0.9;
            return {
                box: box(-R, -R, -body / 2 - eye, R, R + wall * 1.5, body / 2 + eye * 1.6),
                massKg: PI * (R * R - (bore / 2) ** 2) * body * 7850 + PI * (rod / 2) ** 2 * stroke * 7850,
                ports: [
                    port('in', 'Oil', 'hyd', 'in', [0, R + wall * 1.5, -body / 2 + bore * 0.4], [0, 1, 0]),
                    port('out', 'Rod eye', 'lin', 'out', [0, 0, body / 2 + eye * 1.6], [0, 0, 1]),
                ],
                paths: [{ from: 'in', to: 'out', k: A, eff: 0.95, cont: Math.min(A * rated, buckle * 0.5), peak: Math.min(A * rated * 1.5, buckle), flowMax: 0.5, mode: buckle < A * rated * 1.5 ? 'buckles its rod' : 'bursts', label: 'cylinder' }],
                sources: [], supplies: [],
                shape: { kind: 'ram', bore, rod, stroke, R, wall, body, eye },
                summary: `Ø${p.boreMm} × ${p.strokeMm} mm · ${(A * rated / 1000).toFixed(0)} kN`,
            };
        },
    },
};

// A boom: a box-section beam on a pivot. Turned at `in` about its pivot, it
// carries what is mounted at `tip`; it is a joint of the arm it is in. Its
// own bending strength at the root (yield over the section modulus, with a
// margin) is one of that joint's limits (compile.js, joints).
PARTS.boom = {
    label: 'Boom',
    cat: 'Structure',
    note: 'A box-section beam turned about its pivot. What the joint driving it and the beam itself hold, less the weight of everything beyond, is what it lifts at its tip.',
    defaults: { lengthM: 0.8, heightMm: 120, widthMm: 80, wallMm: 4, material: 'alloySteel' },
    schema: {
        lengthM: { label: 'Length', min: 0.1, max: 200, step: 0.05, unit: 'm' },
        heightMm: { label: 'Depth', min: 10, max: 8000, step: 5, unit: 'mm' },
        widthMm: { label: 'Width', min: 10, max: 8000, step: 5, unit: 'mm' },
        wallMm: { label: 'Wall', min: 1, max: 400, step: 0.5, unit: 'mm' },
        material: { label: 'Material', kind: 'material' },
    },
    build(p) {
        const mat = matOf(p.material);
        const L = Math.max(0.05, p.lengthM);
        const h = Math.max(0.01, p.heightMm / 1000), w = Math.max(0.01, p.widthMm / 1000);
        const t = clamp(p.wallMm / 1000, 0.0005, Math.min(h, w) * 0.45);
        const area = h * w - (h - 2 * t) * (w - 2 * t);
        const Z = (w * h ** 3 - (w - 2 * t) * (h - 2 * t) ** 3) / (6 * h);
        const hub = h * 0.62;                       // pivot boss radius
        const plate = Math.max(0.004, t * 2);       // end plates
        const stub = Math.max(0.006, hub * 0.25);
        const tipX = L + plate;
        const massKg = area * L * mat.density + 2 * PI * hub * hub * w * mat.density * 0.5;
        // The beam lies along +X from the pivot (z axis), its width along Z.
        return {
            box: box(-hub, -Math.max(h / 2, hub), -w / 2 - stub, tipX, Math.max(h / 2, hub), w / 2),
            massKg,
            com: [L * 0.48, 0, 0],
            ports: [
                port('in', 'Pivot', 'rot', 'in', [0, 0, -w / 2 - stub], [0, 0, -1]),
                port('tip', 'Tip', 'mnt', 'out', [tipX, 0, 0], [1, 0, 0]),
            ],
            paths: [], sources: [], supplies: [],
            beam: { bend: (mat.yieldPa * Z) / 1.5, mode: 'bends at its root' },
            shape: { kind: 'boom', L, h, w, t, hub, plate, stub },
            summary: `${L.toFixed(2)} m · ${(p.heightMm)}×${p.widthMm} mm · ${((mat.yieldPa * Z) / 1.5 / 1000).toFixed(1)} kN·m`,
        };
    },
};

export const PART_CATEGORIES = ['Power', 'Transmission', 'Protection', 'Motion', 'Hydraulics', 'Structure'];

export function partDefaults(type) {
    const def = PARTS[type];
    return def ? { ...def.defaults } : {};
}

/** The element of a primitive part: what compile.js places and composes. */
export function buildPart(type, params) {
    const def = PARTS[type];
    if (!def) throw new Error(`foundry: no part "${type}"`);
    const p = Object.assign({}, def.defaults, params || {});
    const el = def.build(p);
    el.kind = 'part';
    el.type = type;
    el.label = def.label;
    el.params = p;
    el.com = el.com || [(el.box.min[0] + el.box.max[0]) / 2, (el.box.min[1] + el.box.max[1]) / 2, (el.box.min[2] + el.box.max[2]) / 2];
    el.shapes = [{ min: el.box.min.slice(), max: el.box.max.slice() }];
    el.partCount = 1;
    return el;
}
