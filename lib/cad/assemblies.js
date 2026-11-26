// lib/cad/assemblies.js — Four precision-engineered mechanical CAD assemblies
// built 100% in code from parametric involute gears, multi-part ball bearings,
// split pillow blocks, gusseted Warren steel trusses, hydraulic cylinders,
// coil springs, braided hoses, connecting rods, pistons, and instanced hex bolts.
//
// Each assembly mounts live into a bro.scene with exact kinematics, exploded-view
// inspection offsets, analytical torque/stress calculation, and Proving Ground metadata.

import { chamferedBox, finalizeCadMesh, quatFromYTo } from "./geom.js";
import {
    involuteGear, ballBearingParts, pillowBlock, iBeamBetween, warrenTruss,
    spokedFlywheel, coilSpring, hydraulicBarrel, hydraulicRod, connectingRod,
    machinedShaft, hydraulicHose, precisionWheel, rifledCannonAssembly,
    finnedCylinderCutaway, machinedPiston,
} from "./parts.js";
import { qAxis, qMul, qRot, createAssemblyBuilder } from "./builder.js";

// ============================================================================
// 1. COMPOUND 9:1 REDUCTION GEARBOX & TWIN-CYLINDER CRANK ENGINE
// ============================================================================
function buildCompoundGearbox(scene) {
    const b = createAssemblyBuilder(scene);
    const mod = 0.044;
    const z1 = 12, z2 = 36, z3 = 14, z4 = 42;
    const r1 = (mod * z1) * 0.5; // 0.264
    const r2 = (mod * z2) * 0.5; // 0.792
    const r3 = (mod * z3) * 0.5; // 0.308
    const r4 = (mod * z4) * 0.5; // 0.924

    // Exact center-to-center pitch distances so teeth mesh tooth-into-gap with full deck clearance!
    const x1 = -1.16;
    const x2 = x1 + (r1 + r2); // -0.104
    const x3 = x2 + (r3 + r4); // +1.128
    const yShaft = 1.56;
    const zFront = 0.44, zBack = -0.44;

    // Bolted structural Warren-truss base frame & side longitudinal girders
    const trussBolts = [];
    const trussF = warrenTruss({ length: 3.9, height: 0.44, depth: 0.14, bays: 6, chordSize: 0.066, boltPoints: trussBolts });
    trussF.translate(0, 0.32, 0.56);
    for (const tb of trussBolts) b.addBolts([{ pos: [tb.pos[0], tb.pos[1] + 0.32, tb.pos[2] + 0.56], normal: tb.normal, scale: 0.85 }]);

    const trussBoltsB = [];
    const trussB = warrenTruss({ length: 3.9, height: 0.44, depth: 0.14, bays: 6, chordSize: 0.066, boltPoints: trussBoltsB });
    trussB.translate(0, 0.32, -0.56);
    for (const tb of trussBoltsB) b.addBolts([{ pos: [tb.pos[0], tb.pos[1] + 0.32, tb.pos[2] - 0.56], normal: tb.normal, scale: 0.85 }]);

    // Cross I-beams & tapered A-frame cast/steel bearing stanchions up to y = yShaft - 0.28 = 1.28!
    const crossBeams = [trussF, trussB];
    for (const xs of [-1.75, x1, x2, x3, 1.75]) {
        crossBeams.push(iBeamBetween([xs, 0.50, -0.60], [xs, 0.50, 0.60], 0.11, 0.14, 0.022));
        crossBeams.push(iBeamBetween([xs, 0.13, -0.60], [xs, 0.13, 0.60], 0.09, 0.12, 0.020));
    }
    for (const xs of [x1, x2, x3]) {
        for (const zs of [zFront, zBack]) {
            // Sloped A-frame I-beam stanchions + machined top mounting plate (zero clipping with gears!)
            crossBeams.push(iBeamBetween([xs - 0.24, 0.52, zs], [xs - 0.12, yShaft - 0.28, zs], 0.085, 0.10, 0.018));
            crossBeams.push(iBeamBetween([xs + 0.24, 0.52, zs], [xs + 0.12, yShaft - 0.28, zs], 0.085, 0.10, 0.018));
            const cap = chamferedBox(0.32, 0.036, 0.11, 0.008);
            cap.translate(xs, yShaft - 0.295, zs);
            crossBeams.push(cap);
        }
    }
    b.addPart(finalizeCadMesh(crossBeams, 1.2, 42), 'truss_slate', {
        id: 'chassis_truss', label: 'Bolted Steel Truss Bedplate', explode: [0, -0.55, 0], stress: 0.28, stressLoadScale: 0.35,
    });

    // 4 Cast-iron vibration mounting pads with anchor bolts
    const feet = [];
    for (const fx of [-1.85, 1.85]) {
        for (const fz of [-0.56, 0.56]) {
            const pad = chamferedBox(0.20, 0.055, 0.18, 0.01);
            pad.translate(fx, 0.055, fz);
            feet.push(pad);
            b.addBolts([
                { pos: [fx - 0.11, 0.11, fz - 0.09], normal: [0, 1, 0], scale: 1.2 },
                { pos: [fx + 0.11, 0.11, fz + 0.09], normal: [0, 1, 0], scale: 1.2 },
            ]);
        }
    }
    b.addPart(finalizeCadMesh(feet, 1.5, 40), 'cast_iron', { id: 'feet', label: 'Cast Iron Isolator Feet', explode: [0, -0.75, 0], stress: 0.18 });

    // 6 Split Pillow-Block Ball Bearings (front & back on all 3 shafts!)
    const ratio1 = 1.0;
    const ratio2 = -(z1 / z2);         // -1/3
    const ratio3 = ratio2 * -(z3 / z4); // +1/9
    b.addBearingStation(x1, yShaft, zFront, { boreR: 0.072, outerR: 0.165, centerH: 0.28, explodeZ: 0.45, idPrefix: 'brg1f', speedRatio: ratio1 });
    b.addBearingStation(x1, yShaft, zBack, { boreR: 0.072, outerR: 0.165, centerH: 0.28, explodeZ: -0.45, idPrefix: 'brg1b', speedRatio: ratio1 });
    b.addBearingStation(x2, yShaft, zFront, { boreR: 0.082, outerR: 0.185, centerH: 0.28, explodeZ: 0.45, idPrefix: 'brg2f', speedRatio: ratio2 });
    b.addBearingStation(x2, yShaft, zBack, { boreR: 0.082, outerR: 0.185, centerH: 0.28, explodeZ: -0.45, idPrefix: 'brg2b', speedRatio: ratio2 });
    b.addBearingStation(x3, yShaft, zFront, { boreR: 0.092, outerR: 0.195, centerH: 0.28, explodeZ: 0.45, idPrefix: 'brg3f', speedRatio: ratio3 });
    b.addBearingStation(x3, yShaft, zBack, { boreR: 0.092, outerR: 0.195, centerH: 0.28, explodeZ: -0.45, idPrefix: 'brg3b', speedRatio: ratio3 });

    // 3 Ground Chrome Drive Shafts
    b.addPart(machinedShaft({ length: 1.48, radius: 0.070 }), 'chrome_shaft', {
        id: 'shaft1', label: 'Input Crankshaft', pos: [x1, yShaft, 0.04], explode: [0, 0, 0.25], stress: 0.48, stressLoadScale: 0.48,
        extra: { spinAxis: 'z', ratio: ratio1, phase: 0 },
    });
    b.addPart(machinedShaft({ length: 1.24, radius: 0.080 }), 'chrome_shaft', {
        id: 'shaft2', label: 'Intermediate Layshaft', pos: [x2, yShaft, 0], explode: [0, 0, -0.10], stress: 0.55, stressLoadScale: 0.55,
        extra: { spinAxis: 'z', ratio: ratio2, phase: 0 },
    });
    b.addPart(machinedShaft({ length: 1.56, radius: 0.090 }), 'chrome_shaft', {
        id: 'shaft3', label: 'High-Torque Output Shaft', pos: [x3, yShaft, -0.08], explode: [0, 0, -0.35], stress: 0.65, stressLoadScale: 0.65,
        extra: { spinAxis: 'z', ratio: ratio3, phase: 0 },
    });

    // 4 MESHING INVOLUTE SPUR GEARS (exact center distances & tooth phases!)
    // Stage 1 sits at z = +0.16; Stage 2 sits at z = -0.16!
    b.addPart(involuteGear({ module: mod, teeth: z1, width: 0.15, boreR: 0.070, spokes: 0 }), 'blued_steel', {
        id: 'gear1', label: '12T Hardened Input Pinion', pos: [x1, yShaft, 0.16], explode: [0, 0, 0.85], stress: 0.58, stressLoadScale: 0.55,
        extra: { spinAxis: 'z', ratio: ratio1, phase: 0 },
    });
    b.addPart(involuteGear({ module: mod, teeth: z2, width: 0.15, boreR: 0.080, spokes: 6 }), 'machined_steel', {
        id: 'gear2', label: '36T Spoked Compound Gear', pos: [x2, yShaft, 0.16], explode: [0, 0, 0.72], stress: 0.46, stressLoadScale: 0.52,
        extra: { spinAxis: 'z', ratio: ratio2, phase: Math.PI / z2 },
    });
    b.addPart(involuteGear({ module: mod, teeth: z3, width: 0.16, boreR: 0.080, spokes: 0 }), 'turned_brass', {
        id: 'gear3', label: '14T Brass Second Pinion', pos: [x2, yShaft, -0.16], explode: [0, 0, -0.72], stress: 0.68, stressLoadScale: 0.62,
        extra: { spinAxis: 'z', ratio: ratio2, phase: 0 },
    });
    b.addPart(involuteGear({ module: mod, teeth: z4, width: 0.16, boreR: 0.090, spokes: 6 }), 'gunmetal_ordnance', {
        id: 'gear4', label: '42T Forged Bull Gear', pos: [x3, yShaft, -0.16], explode: [0, 0, -0.85], stress: 0.54, stressLoadScale: 0.60,
        extra: { spinAxis: 'z', ratio: ratio3, phase: Math.PI / z4 },
    });

    // Heavy Spoked Counterweighted Output Flywheel at z = -0.76
    b.addPart(spokedFlywheel({ radius: 0.84, rimWidth: 0.19, rimThick: 0.12, spokes: 6, boreR: 0.090 }), 'cast_iron', {
        id: 'flywheel', label: '840mm Spoked Inertia Flywheel', pos: [x3, yShaft, -0.76], explode: [0, 0, -1.45], stress: 0.36, stressLoadScale: 0.42,
        extra: { spinAxis: 'z', ratio: ratio3, phase: 0 },
    });

    // Twin Cutaway Reciprocating Crank-Slider Cylinders driving Shaft 1 (at z = +0.66 & z = -0.14? No, front side z = +0.72!)
    const crankR = 0.17;
    const rodLen = 0.62;
    const cylBaseY = yShaft + 0.44;
    const zCyl = 0.68;

    // Crank throw web & eccentric crankpin on input shaft front
    const web = chamferedBox(0.085, crankR * 0.65 + 0.05, 0.032, 0.008);
    web.translate(0, crankR * 0.5, -0.045);
    const pin = bro.mesh.Mesh.cylinder(0.045, 0.075, 16);
    pin.rotate(1, 0, 0, Math.PI * 0.5);
    pin.translate(0, crankR, 0);
    b.addPart(finalizeCadMesh([web, pin], 2.0, 36), 'turned_brass', {
        id: 'crank_throw', label: 'Eccentric Brass Crank Throw', pos: [x1, yShaft, zCyl], explode: [0, 0, 1.15], stress: 0.62,
        extra: { spinAxis: 'z', ratio: ratio1, phase: 0 },
    });

    // Cutaway Finned Cylinder sitting directly above Crank Throw
    const cylMesh = finnedCylinderCutaway({ boreR: 0.155, height: 0.56, fins: 7 });
    // Cylinder support struts tying down to truss frame
    const cylStrutL = iBeamBetween([-0.22, -0.44, -0.12], [-0.18, 0.05, 0], 0.065, 0.065, 0.015);
    const cylStrutR = iBeamBetween([0.22, -0.44, -0.12], [0.18, 0.05, 0], 0.065, 0.065, 0.015);
    b.addPart(finalizeCadMesh([cylMesh, cylStrutL, cylStrutR], 1.6, 38), 'cast_iron', {
        id: 'cylinder_cutaway', label: 'Cutaway Finned Drive Cylinder', pos: [x1, cylBaseY, zCyl], explode: [0, 0.85, 1.05], stress: 0.40,
    });

    // Dynamic Reciprocating Piston & Forged Connecting Rod (updated kinematically every frame!)
    const pistonRec = b.addPart(machinedPiston({ radius: 0.148, height: 0.19 }), 'chrome_shaft', {
        id: 'piston', label: 'Machined 3-Ring Piston', pos: [x1, yShaft + rodLen, zCyl], explode: [0, 0.55, 1.35], stress: 0.55,
        extra: { kind: 'piston', cx: x1, cy: yShaft, cz: zCyl, crankR, rodLen },
    });
    const rodRec = b.addPart(connectingRod({ length: rodLen, bigR: 0.055, smallR: 0.042, thick: 0.058 }), 'machined_steel', {
        id: 'conrod', label: 'Forged I-Section Con-Rod', pos: [x1, yShaft, zCyl], explode: [0, 0.25, 1.30], stress: 0.64,
        extra: { kind: 'conrod', cx: x1, cy: yShaft, cz: zCyl, crankR, rodLen },
    });

    // Hydraulic Load Dynamometer Brake + Twin Helical Governor Springs + Braided Hoses on Right Deck
    b.addPart(hydraulicBarrel({ length: 0.66, outerR: 0.082, rodR: 0.036 }), 'industrial_amber', {
        id: 'dyno_cyl', label: 'Hydraulic Brake Cylinder', pos: [x3 + 0.56, 0.56, 0.44], explode: [0.45, 0, 0.35], stress: 0.35,
    });
    b.addPart(hydraulicRod({ length: 0.52, rodR: 0.036 }), 'chrome_shaft', {
        id: 'dyno_rod', label: 'Chrome Brake Plunger', pos: [x3 + 0.56, 1.38, 0.44], explode: [0.45, 0.40, 0.35], stress: 0.38,
        extra: { kind: 'oscillateY', amp: 0.07, freq: 1.0, baseY: 1.38 },
    });
    b.addPart(coilSpring({ coilR: 0.095, wireR: 0.018, turns: 7, length: 0.48 }), 'turned_brass', {
        id: 'gov_spring', label: 'Helical Governor Spring', pos: [x3 + 0.56, 0.58, 0.04], explode: [0.55, 0.15, 0], stress: 0.44,
    });
    // Curved braided hydraulic hose connecting brake cylinder to copper manifold on truss frame!
    b.addPart(hydraulicHose([
        [x3 + 0.66, 0.74, 0.44], [x3 + 0.84, 0.80, 0.36],
        [x3 + 0.88, 0.56, 0.18], [x3 + 0.72, 0.46, -0.05], [x3 + 0.52, 0.48, -0.30],
    ], 0.022), 'rubber_hose', {
        id: 'hose1', label: 'Braided Hydraulic Line', explode: [0.65, 0.1, 0.15], stress: 0.15,
    });
    b.addPart(chamferedBox(0.11, 0.075, 0.11, 0.01), 'copper_fitting', {
        id: 'manifold', label: 'Copper Hydraulic Manifold', pos: [x3 + 0.48, 0.48, -0.34], explode: [0.35, -0.1, -0.25], stress: 0.20,
    });

    b.commitBolts();

    const spec = {
        id: 'compound_gearbox',
        name: '9:1 Compound Gearbox & Crank Drive',
        subtitle: '3-Stage 20° Involute Gear Train · 6 Pillow-Block Ball Bearings · Cutaway Crank-Slider',
        category: 'mechanism',
        massKg: 4850,
        gearRatio: '9.00 : 1',
        canAim: false,
        canDrive: false,
        camTarget: [0, 1.15, 0],
        camDist: 5.4,
        specs: [
            { k: 'Gear Train', v: '12T→36T / 14T→42T (9:1)' },
            { k: 'Module / PA', v: 'm = 52mm · 20° Involute' },
            { k: 'Bearings', v: '6× 10-Ball Radial + Brass Cage' },
            { k: 'Peak Torque', v: '18,400 N·m @ Output' },
        ],
    };

    const update = (state, explode = 0, rootPos = null, rootQuat = null) => {
        const theta = state.theta || 0;
        b.setRootTransform(rootPos, rootQuat, explode, (it, pos, rot) => {
            const ex = it.extra;
            if (!ex) return null;
            if (ex.spinAxis === 'z') {
                return { rot: qAxis(0, 0, 1, theta * ex.ratio + (ex.phase || 0)) };
            }
            if (ex.kind === 'piston') {
                // Exact analytical crank-slider displacement!
                const px = Math.sin(-theta) * ex.crankR;
                const py = Math.cos(theta) * ex.crankR;
                const yPin = ex.cy + py + Math.sqrt(Math.max(0.01, ex.rodLen * ex.rodLen - px * px));
                return { pos: [ex.cx + it.explode[0] * explode, yPin + it.explode[1] * explode, ex.cz + it.explode[2] * explode] };
            }
            if (ex.kind === 'conrod') {
                const bx = ex.cx - Math.sin(theta) * ex.crankR;
                const by = ex.cy + Math.cos(theta) * ex.crankR;
                const dy = Math.sqrt(Math.max(0.01, ex.rodLen * ex.rodLen - (bx - ex.cx) * (bx - ex.cx)));
                const ang = Math.atan2(-(ex.cx - bx), dy); // tilt from +Y toward piston pin at x = ex.cx
                return {
                    pos: [bx + it.explode[0] * explode, by + it.explode[1] * explode, ex.cz + it.explode[2] * explode],
                    rot: qAxis(0, 0, 1, ang),
                };
            }
            if (ex.kind === 'oscillateY') {
                const dy = Math.sin(theta * 0.5) * ex.amp * (state.load ?? 0.5);
                return { pos: [pos[0], ex.baseY + dy + it.explode[1] * explode, pos[2]] };
            }
            return null;
        });
    };

    return {
        spec, builder: b, update,
        setStress: (on, load) => b.applyStressOverlay(on, load),
        stats: b.getStats(),
        destroy: b.destroy,
    };
}

// ============================================================================
// 2. PRECISION SIEGE TRUSS HOWITZER CARRIAGE (MOUSE-AIMED + LIVE HYDRAULICS!)
// ============================================================================
function buildTrussHowitzer(scene) {
    const b = createAssemblyBuilder(scene);
    const trussBolts = [];
    const deckY = 1.05;

    // Dual longitudinal Warren steel truss carriage frames (running along Z!)
    const frameParts = [];
    for (const sx of [-1.05, 1.05]) {
        const localBolts = [];
        const tr = warrenTruss({ length: 4.4, height: 0.56, depth: 0.16, bays: 6, chordSize: 0.072, boltPoints: localBolts });
        tr.rotate(0, 1, 0, Math.PI * 0.5); // align along Z!
        tr.translate(sx, deckY, 0);
        frameParts.push(tr);
        for (const lb of localBolts) {
            // Rotate bolt pos & normal by +90° about Y: (x,y,z) -> (z, y, -x)
            b.addBolts([{
                pos: [sx + lb.pos[2], deckY + lb.pos[1], -lb.pos[0]],
                normal: [lb.normal[2], lb.normal[1], -lb.normal[0]],
                scale: 0.9,
            }]);
        }
    }
    // Cross I-beams tying left & right trusses + heavy central turret ring deck plate
    for (const zc of [-2.05, -1.1, 0, 1.1, 2.05]) {
        frameParts.push(iBeamBetween([-1.08, deckY - 0.24, zc], [1.08, deckY - 0.24, zc], 0.12, 0.14, 0.024));
        frameParts.push(iBeamBetween([-1.08, deckY + 0.24, zc], [1.08, deckY + 0.24, zc], 0.10, 0.14, 0.022));
    }
    const deckRing = chamferedBox(1.12, 0.055, 1.25, 0.015);
    deckRing.translate(0, deckY + 0.30, 0.1);
    frameParts.push(deckRing);

    b.addPart(finalizeCadMesh(frameParts, 1.2, 42), 'truss_slate', {
        id: 'carriage_truss', label: 'Bolted Warren-Truss Carriage', explode: [0, -0.45, 0], stress: 0.35, stressLoadScale: 0.45,
    });

    // 4 Spoked Lug-Bolted Precision Roadwheels + 4 Helical Suspension Coil Springs + 4 Hydraulic Dampers!
    const wheelCoords = [[-1.36, 0.58, -1.55], [1.36, 0.58, -1.55], [-1.36, 0.58, 1.55], [1.36, 0.58, 1.55]];
    const wheelMesh = precisionWheel({ radius: 0.58, width: 0.32, spokes: 8 });
    const springMesh = coilSpring({ coilR: 0.115, wireR: 0.022, turns: 6, length: 0.44 });
    const dampMesh = hydraulicBarrel({ length: 0.46, outerR: 0.058, rodR: 0.028 });
    wheelCoords.forEach(([wx, wy, wz], idx) => {
        const sgn = Math.sign(wx);
        b.addPart(wheelMesh.clone(), 'gunmetal_ordnance', {
            id: `wheel_${idx}`, label: `Spoked Bogie Wheel ${idx + 1}`, pos: [wx, wy, wz],
            explode: [sgn * 0.55, -0.25, 0], stress: 0.42,
            extra: { kind: 'wheel', side: sgn },
        });
        // Axle stub shaft
        const ax = machinedShaft({ length: 0.48, radius: 0.062 });
        ax.rotate(0, 1, 0, Math.PI * 0.5);
        b.addPart(ax, 'chrome_shaft', {
            id: `axle_${idx}`, label: 'Forged Stub Axle', pos: [sgn * 1.15, wy, wz], explode: [sgn * 0.3, -0.15, 0], stress: 0.52,
        });
        // Helical suspension coil spring & amber damper between axle & truss
        b.addPart(springMesh.clone(), 'blued_steel', {
            id: `spring_${idx}`, label: 'Helical Bogie Spring', pos: [sgn * 1.05, wy + 0.06, wz], explode: [sgn * 0.25, -0.05, 0], stress: 0.48,
        });
        b.addPart(dampMesh.clone(), 'industrial_amber', {
            id: `damp_${idx}`, label: 'Hydraulic Bogie Damper', pos: [sgn * 0.88, wy + 0.05, wz + (wz > 0 ? -0.22 : 0.22)], explode: [sgn * 0.2, 0, 0], stress: 0.32,
        });
    });

    // EXPOSED SLEWING RING GEAR (42T) + MESHING 12T BRASS AZIMUTH DRIVE PINION!
    const slewMod = 0.042;
    const zRing = 42, zPin = 12;
    const rRing = (slewMod * zRing) * 0.5; // 0.882
    const rPin = (slewMod * zPin) * 0.5;   // 0.252
    const slewY = deckY + 0.42;
    const slewZ = 0.1;

    const ringGear = involuteGear({ module: slewMod, teeth: zRing, width: 0.12, boreR: 0.42, spokes: 6 });
    ringGear.rotate(1, 0, 0, Math.PI * 0.5); // horizontal ring gear (spins around Y!)
    b.addPart(ringGear, 'machined_steel', {
        id: 'slew_ring', label: '42T Exposed Slewing Ring Gear', pos: [0, slewY, slewZ], explode: [0, 0.35, 0], stress: 0.52,
        extra: { kind: 'turret_yaw' },
    });

    // Meshing 12T Brass Azimuth Pinion seated at rear of ring gear (exact center distance rRing + rPin!)
    const pinZ = slewZ + rRing + rPin;
    const pinGear = involuteGear({ module: slewMod, teeth: zPin, width: 0.14, boreR: 0.055, spokes: 0 });
    pinGear.rotate(1, 0, 0, Math.PI * 0.5);
    b.addPart(pinGear, 'turned_brass', {
        id: 'slew_pinion', label: '12T Brass Azimuth Pinion', pos: [0, slewY, pinZ], explode: [0, 0.35, 0.35], stress: 0.65,
        extra: { kind: 'slew_pinion', ratio: -(zRing / zPin), phase: Math.PI / zPin },
    });
    // Vertical pinion drive motor housing mounted on carriage deck
    const motor = bro.mesh.Mesh.cylinder(0.14, 0.22, 18);
    motor.translate(0, -0.26, 0);
    b.addPart(finalizeCadMesh([motor], 1.8, 36), 'cast_iron', {
        id: 'slew_motor', label: 'Azimuth Drive Motor', pos: [0, slewY, pinZ], explode: [0, 0.1, 0.35], stress: 0.26,
    });

    // Articulated Turret Trunnion Yoke (twin slotted steel cheeks + trunnion ball bearings, rotates with turretYaw!)
    const yokeY = slewY + 0.44;
    const yokeParts = [];
    for (const sx of [-0.54, 0.54]) {
        yokeParts.push(iBeamBetween([sx, -0.34, 0.42], [sx, 0.34, 0.12], 0.12, 0.14, 0.024));
        yokeParts.push(iBeamBetween([sx, -0.34, -0.42], [sx, 0.34, 0.12], 0.12, 0.14, 0.024));
        yokeParts.push(pillowBlock({ boreR: 0.12, width: 0.12, centerH: 0.22 }));
        yokeParts[yokeParts.length - 1].rotate(0, 1, 0, Math.PI * 0.5);
        yokeParts[yokeParts.length - 1].translate(sx, 0.36, 0.12);
    }
    const yokeBase = chamferedBox(0.68, 0.075, 0.58, 0.015);
    yokeBase.translate(0, -0.32, 0);
    yokeParts.push(yokeBase);
    b.addPart(finalizeCadMesh(yokeParts, 1.3, 40), 'truss_slate', {
        id: 'turret_yoke', label: 'Forged Trunnion Yoke', pos: [0, yokeY, slewZ], explode: [0, 0.78, 0], stress: 0.58, stressLoadScale: 0.55,
        extra: { kind: 'turret_yaw' },
    });

    // Rifled Stepped Ordnance Cannon + Perforated Muzzle Brake + Twin Hydro-Pneumatic Recoil Recuperators
    const trunnionY = yokeY + 0.36;
    const trunnionZ = slewZ + 0.12;
    b.addPart(rifledCannonAssembly({ length: 3.9, boreR: 0.115 }), 'gunmetal_ordnance', {
        id: 'cannon_barrel', label: '155mm Rifled Barrel & Recuperators', pos: [0, trunnionY, trunnionZ], explode: [0, 1.25, -0.45], stress: 0.72, stressLoadScale: 0.60,
        extra: { kind: 'cannon', pivotY: trunnionY, pivotZ: trunnionZ, slewZ },
    });

    // Twin LIVE Hydraulic Elevation Cylinders (barrels + gleaming chrome piston rods spanning deck -> barrel cradle!)
    for (const sx of [-0.42, 0.42]) {
        b.addPart(hydraulicBarrel({ length: 0.72, outerR: 0.068, rodR: 0.032 }), 'industrial_amber', {
            id: `elev_cyl_${sx < 0 ? 'l' : 'r'}`, label: 'Hydraulic Elevation Cylinder', pos: [sx, slewY + 0.14, slewZ - 0.52], explode: [sx * 0.4, 0.85, -0.35], stress: 0.60,
            extra: { kind: 'elev_cyl', sideX: sx, baseLocal: [sx, slewY + 0.14, slewZ - 0.52], pivotLocal: [sx, trunnionY, trunnionZ], attachLocal: [0, -0.22, -0.78], slewZ },
        });
        b.addPart(hydraulicRod({ length: 0.68, rodR: 0.032 }), 'chrome_shaft', {
            id: `elev_rod_${sx < 0 ? 'l' : 'r'}`, label: 'Chrome Elevation Rod', pos: [sx, trunnionY - 0.22, trunnionZ - 0.78], explode: [sx * 0.4, 1.15, -0.45], stress: 0.66,
            extra: { kind: 'elev_rod', sideX: sx, baseLocal: [sx, slewY + 0.14, slewZ - 0.52], pivotLocal: [sx, trunnionY, trunnionZ], attachLocal: [0, -0.22, -0.78], slewZ },
        });
    }

    // Rear Deployable Truss Outrigger Recoil Spades (left & right at z = +2.15)
    for (const sx of [-0.95, 0.95]) {
        const leg = iBeamBetween([0, 0, 0], [0, -0.72, 0.62], 0.11, 0.14, 0.022);
        const shoe = chamferedBox(0.24, 0.055, 0.28, 0.01);
        shoe.translate(0, -0.76, 0.68);
        b.addPart(finalizeCadMesh([leg, shoe], 1.4, 40), 'industrial_amber', {
            id: `spade_${sx < 0 ? 'l' : 'r'}`, label: 'Hydraulic Recoil Spade', pos: [sx, deckY - 0.12, 2.05], explode: [sx * 0.3, -0.2, 0.65], stress: 0.45,
            extra: { kind: 'spade' },
        });
    }

    b.commitBolts();

    const spec = {
        id: 'truss_howitzer',
        name: 'Siege Truss Howitzer MK-V',
        subtitle: 'Bolted Warren-Truss Carriage · 42T Exposed Slewing Ring · Twin Elevation Hydraulics',
        category: 'artillery',
        massKg: 24600,
        gearRatio: '3.50 : 1 Slew',
        canAim: true,
        canDrive: true,
        camTarget: [0, 1.48, -0.35],
        camDist: 7.1,
        camYaw: 2.38,
        specs: [
            { k: 'Ordnance', v: '155mm Rifled · Twin Recuperators' },
            { k: 'Slewing Drive', v: '42T Ring / 12T Brass Pinion' },
            { k: 'Suspension', v: '4× Coil Spring + Hydraulic Damper' },
            { k: 'Muzzle Impulse', v: '11,400 N·s · 108 m/s AP Shell' },
        ],
    };

    const update = (state, explode = 0, rootPos = null, rootQuat = null) => {
        const yaw = state.turretYaw ?? 0;
        const pitch = Math.max(-0.08, Math.min(0.68, state.turretPitch ?? 0.16));
        const recoil = state.recoil ?? 0;
        const wheelSpin = state.wheelSpin ?? (state.theta || 0);
        const spades = state.spades ? 0.36 : -0.35;
        const qYaw = qAxis(0, 1, 0, yaw);
        const qPitch = qAxis(1, 0, 0, pitch);
        const qCannon = qMul(qYaw, qPitch);

        b.setRootTransform(rootPos, rootQuat, explode, (it, pos, rot) => {
            const ex = it.extra;
            if (!ex) return null;
            if (ex.kind === 'wheel') return { rot: qAxis(1, 0, 0, -wheelSpin) };
            if (ex.kind === 'turret_yaw') return { rot: qYaw };
            if (ex.kind === 'slew_pinion') return { rot: qAxis(0, 1, 0, yaw * ex.ratio + ex.phase) };
            if (ex.kind === 'spade') return { rot: qAxis(1, 0, 0, spades) };
            if (ex.kind === 'cannon') {
                const rel = qRot(qYaw, [0, 0, ex.pivotZ - ex.slewZ]);
                const recVec = qRot(qCannon, [0, 0, recoil]);
                return {
                    pos: [
                        rel[0] + recVec[0] + it.explode[0] * explode,
                        ex.pivotY + recVec[1] + it.explode[1] * explode,
                        ex.slewZ + rel[2] + recVec[2] + it.explode[2] * explode,
                    ],
                    rot: qCannon,
                };
            }
            if (ex.kind === 'elev_cyl' || ex.kind === 'elev_rod') {
                // Exact 2-point hydraulic cylinder orientation between turret deck & elevating barrel cradle!
                const pBase = qRot(qYaw, [ex.baseLocal[0], ex.baseLocal[1], ex.baseLocal[2] - ex.slewZ]);
                pBase[2] += ex.slewZ;
                const piv = qRot(qYaw, [ex.pivotLocal[0], ex.pivotLocal[1], ex.pivotLocal[2] - ex.slewZ]);
                piv[2] += ex.slewZ;
                const off = qRot(qCannon, ex.attachLocal);
                const pTop = [piv[0] + off[0], piv[1] + off[1], piv[2] + off[2]];
                const dx = pTop[0] - pBase[0], dy = pTop[1] - pBase[1], dz = pTop[2] - pBase[2];
                const qDir = quatFromYTo(dx, dy, dz);
                if (ex.kind === 'elev_cyl') {
                    return { pos: [pBase[0] + it.explode[0] * explode, pBase[1] + it.explode[1] * explode, pBase[2] + it.explode[2] * explode], rot: qDir };
                }
                return { pos: [pTop[0] + it.explode[0] * explode, pTop[1] + it.explode[1] * explode, pTop[2] + it.explode[2] * explode], rot: qDir };
            }
            return null;
        });
    };

    return {
        spec, builder: b, update,
        setStress: (on, load) => b.applyStressOverlay(on, load),
        stats: b.getStats(),
        destroy: b.destroy,
    };
}

// ============================================================================
// 3. PRECISION TRUSS CRANK-ROCKER WALKER RIG (KLANN / MECH LINKAGE)
// ============================================================================
function buildKlannWalker(scene) {
    const b = createAssemblyBuilder(scene);
    const spineY = 2.05;

    // Open bolted Warren-truss central spine chassis
    const spineParts = [];
    for (const sx of [-0.52, 0.52]) {
        const localBolts = [];
        const tr = warrenTruss({ length: 3.0, height: 0.62, depth: 0.14, bays: 5, chordSize: 0.068, boltPoints: localBolts });
        tr.rotate(0, 1, 0, Math.PI * 0.5);
        tr.translate(sx, spineY, 0);
        spineParts.push(tr);
        for (const lb of localBolts) {
            b.addBolts([{
                pos: [sx + lb.pos[2], spineY + lb.pos[1], -lb.pos[0]],
                normal: [lb.normal[2], lb.normal[1], -lb.normal[0]],
                scale: 0.85,
            }]);
        }
    }
    for (const zc of [-1.42, -0.68, 0, 0.68, 1.42]) {
        spineParts.push(iBeamBetween([-0.54, spineY - 0.28, zc], [0.54, spineY - 0.28, zc], 0.11, 0.12, 0.022));
        spineParts.push(iBeamBetween([-0.54, spineY + 0.28, zc], [0.54, spineY + 0.28, zc], 0.10, 0.12, 0.022));
    }
    b.addPart(finalizeCadMesh(spineParts, 1.3, 42), 'truss_slate', {
        id: 'walker_spine', label: 'Bolted Truss Spine Chassis', explode: [0, 0.35, 0], stress: 0.34,
    });

    // Exposed Central Meshing Reduction Gear Train (14T brass motor pinion -> twin 28T crank gears!)
    const gMod = 0.040;
    const zP = 14, zC = 28;
    const distZ = gMod * (zP + zC) * 0.5; // 0.84m fore & aft!
    const motorPin = involuteGear({ module: gMod, teeth: zP, width: 0.16, boreR: 0.06, spokes: 0 });
    motorPin.rotate(0, 1, 0, Math.PI * 0.5); // rotates around X!
    b.addPart(motorPin, 'turned_brass', {
        id: 'center_pinion', label: '14T Central Brass Drive Pinion', pos: [0, spineY, 0], explode: [0, 0.65, 0], stress: 0.64,
        extra: { kind: 'spinX', ratio: 2.0, phase: 0 },
    });
    const centerShaft = machinedShaft({ length: 1.36, radius: 0.058 });
    centerShaft.rotate(0, 1, 0, Math.PI * 0.5);
    b.addPart(centerShaft, 'chrome_shaft', {
        id: 'center_shaft', label: 'Central Drive Shaft', pos: [0, spineY, 0], explode: [0, 0.55, 0], stress: 0.50,
    });

    for (const [tag, zc] of [['front', -distZ], ['rear', distZ]]) {
        const cg = involuteGear({ module: gMod, teeth: zC, width: 0.14, boreR: 0.072, spokes: 6 });
        cg.rotate(0, 1, 0, Math.PI * 0.5);
        b.addPart(cg, 'machined_steel', {
            id: `crank_gear_${tag}`, label: `28T ${tag} Crank Bull Gear`, pos: [0, spineY, zc], explode: [0, 0.45, Math.sign(zc) * 0.35], stress: 0.52,
            extra: { kind: 'spinX', ratio: -1.0, phase: Math.PI / zC },
        });
        const sh = machinedShaft({ length: 1.92, radius: 0.068 });
        sh.rotate(0, 1, 0, Math.PI * 0.5);
        b.addPart(sh, 'chrome_shaft', {
            id: `crank_shaft_${tag}`, label: `${tag} Crank Axle`, pos: [0, spineY, zc], explode: [0, 0.25, Math.sign(zc) * 0.35], stress: 0.55,
        });
    }

    // 4 Articulated Precision Steel-Truss Legs (Twin-Chord Truss Femur + Knee Bearing + Gusseted Tibia + Ankle Clevis & Grip Footpad!)
    const legSpecs = [
        { id: 'fl', sx: -1, zc: -distZ, phase: 0 },
        { id: 'fr', sx: 1, zc: -distZ, phase: Math.PI },
        { id: 'rl', sx: -1, zc: distZ, phase: Math.PI },
        { id: 'rr', sx: 1, zc: distZ, phase: 0 },
    ];
    const femurLen = 1.02, tibiaLen = 1.08;
    const bpKnee = ballBearingParts({ innerR: 0.062, outerR: 0.148, width: 0.12, balls: 10 });
    bpKnee.racesMesh.rotate(0, 1, 0, Math.PI * 0.5);
    bpKnee.ballsMesh.rotate(0, 1, 0, Math.PI * 0.5);

    for (const ls of legSpecs) {
        const hipX = ls.sx * 0.88;
        b.addPart(bpKnee.racesMesh.clone(), 'blued_steel', {
            id: `hip_brg_${ls.id}`, label: 'Hip Radial Bearing', pos: [hipX, spineY, ls.zc], explode: [ls.sx * 0.35, 0, 0], stress: 0.50,
        });
        // True triangulated A-truss upper femur link with cross-bracing
        const femurMesh = finalizeCadMesh([
            iBeamBetween([0, 0, -0.10], [0, -femurLen, -0.055], 0.11, 0.085, 0.020),
            iBeamBetween([0, 0, 0.10], [0, -femurLen, 0.055], 0.11, 0.085, 0.020),
            iBeamBetween([0, -0.25, -0.09], [0, -0.62, 0.07], 0.055, 0.06, 0.014),
            iBeamBetween([0, -0.62, 0.07], [0, -0.92, -0.055], 0.055, 0.06, 0.014),
            chamferedBox(0.075, 0.11, 0.15, 0.012),
        ], 1.5, 40);
        b.addPart(femurMesh, 'machined_steel', {
            id: `femur_${ls.id}`, label: 'Truss Upper Leg Link', pos: [hipX, spineY, ls.zc], explode: [ls.sx * 0.55, -0.1, 0], stress: 0.58,
            extra: { kind: 'leg_femur', hip: [hipX, spineY, ls.zc], phase: ls.phase, femurLen, tibiaLen, side: ls.sx },
        });
        b.addPart(bpKnee.racesMesh.clone(), 'turned_brass', {
            id: `knee_${ls.id}`, label: 'Knee Bearing Assembly', pos: [hipX, spineY - femurLen, ls.zc], explode: [ls.sx * 0.72, -0.2, 0], stress: 0.62,
            extra: { kind: 'leg_knee', hip: [hipX, spineY, ls.zc], phase: ls.phase, femurLen, tibiaLen, side: ls.sx },
        });
        // Tapered dual-chord lower tibia truss + heavy ankle clevis + articulated treaded footpad
        const tibiaMesh = finalizeCadMesh([
            iBeamBetween([0, 0, -0.065], [0, -tibiaLen + 0.08, -0.04], 0.10, 0.08, 0.020),
            iBeamBetween([0, 0, 0.065], [0, -tibiaLen + 0.08, 0.04], 0.10, 0.08, 0.020),
            iBeamBetween([0, -0.22, -0.06], [0, -0.58, 0.05], 0.05, 0.055, 0.012),
            iBeamBetween([0, -0.58, 0.05], [0, -0.92, -0.04], 0.05, 0.055, 0.012),
            chamferedBox(0.11, 0.08, 0.11, 0.012).translate(0, -tibiaLen + 0.08, 0),
            chamferedBox(0.22, 0.048, 0.36, 0.014).translate(0, -tibiaLen + 0.02, 0),
        ], 1.4, 40);
        b.addPart(tibiaMesh, 'gunmetal_ordnance', {
            id: `tibia_${ls.id}`, label: 'Truss Lower Leg & Articulated Foot', pos: [hipX, spineY - femurLen, ls.zc], explode: [ls.sx * 0.85, -0.45, 0], stress: 0.60,
            extra: { kind: 'leg_tibia', hip: [hipX, spineY, ls.zc], phase: ls.phase, femurLen, tibiaLen, side: ls.sx },
        });
        // Live Hydraulic Leg Actuator Cylinder spanning Chassis -> Knee!
        b.addPart(hydraulicBarrel({ length: 0.62, outerR: 0.056, rodR: 0.028 }), 'industrial_amber', {
            id: `leg_cyl_${ls.id}`, label: 'Hydraulic Leg Actuator', pos: [ls.sx * 0.58, spineY + 0.24, ls.zc], explode: [ls.sx * 0.45, 0.2, 0], stress: 0.56,
            extra: { kind: 'leg_cyl', hip: [hipX, spineY, ls.zc], anchor: [ls.sx * 0.58, spineY + 0.24, ls.zc - 0.18], phase: ls.phase, femurLen, tibiaLen, side: ls.sx },
        });
        b.addPart(hydraulicRod({ length: 0.62, rodR: 0.028 }), 'chrome_shaft', {
            id: `leg_rod_${ls.id}`, label: 'Chrome Actuator Rod', pos: [hipX, spineY - 0.5, ls.zc], explode: [ls.sx * 0.65, 0.05, 0], stress: 0.62,
            extra: { kind: 'leg_rod', hip: [hipX, spineY, ls.zc], anchor: [ls.sx * 0.58, spineY + 0.24, ls.zc - 0.18], phase: ls.phase, femurLen, tibiaLen, side: ls.sx },
        });
    }

    // Top Twin Braided Hydraulic Supply Hoses + Copper Manifold
    b.addPart(chamferedBox(0.24, 0.11, 0.28, 0.015), 'copper_fitting', {
        id: 'hyd_manifold', label: 'Central Hydraulic Manifold', pos: [0, spineY + 0.40, 0], explode: [0, 0.95, 0], stress: 0.28,
    });
    for (const sx of [-1, 1]) {
        b.addPart(hydraulicHose([
            [sx * 0.18, spineY + 0.42, 0], [sx * 0.45, spineY + 0.52, -0.35],
            [sx * 0.58, spineY + 0.36, -distZ - 0.12],
        ], 0.020), 'rubber_hose', { id: `hose_f_${sx}`, label: 'Braided Hydraulic Line', explode: [sx * 0.3, 0.85, -0.2], stress: 0.18 });
        b.addPart(hydraulicHose([
            [sx * 0.18, spineY + 0.42, 0], [sx * 0.45, spineY + 0.52, 0.35],
            [sx * 0.58, spineY + 0.36, distZ - 0.12],
        ], 0.020), 'rubber_hose', { id: `hose_r_${sx}`, label: 'Braided Hydraulic Line', explode: [sx * 0.3, 0.85, 0.2], stress: 0.18 });
    }

    b.commitBolts();

    const spec = {
        id: 'klann_walker_rig',
        name: 'Articulated Truss Walker MK-IV',
        subtitle: 'Exposed 2:1 Gear Spine · 4 Hydraulic-Actuated Truss Legs · Radial Knee Bearings',
        category: 'walker',
        massKg: 14200,
        gearRatio: '2.00 : 1 Spine',
        canAim: false,
        canDrive: true,
        camTarget: [0, 1.55, 0],
        camDist: 6.4,
        specs: [
            { k: 'Drivetrain', v: '14T Brass → Twin 28T Crank Gears' },
            { k: 'Leg Actuation', v: '4× Hydraulic + Radial Bearings' },
            { k: 'Gait Cycle', v: 'Diagonal Trot · Self-Leveling' },
            { k: 'Chassis', v: 'Dual Bolted Warren Steel Truss' },
        ],
    };

    const legKinematics = (theta, phase, hip, femurLen) => {
        const ph = theta + phase;
        const hipAng = Math.sin(ph) * 0.36;
        const kneeBend = -0.35 - Math.max(0, Math.cos(ph)) * 0.48;
        const kneePos = [
            hip[0],
            hip[1] - Math.cos(hipAng) * femurLen,
            hip[2] - Math.sin(hipAng) * femurLen,
        ];
        const midFemur = [
            hip[0],
            hip[1] - Math.cos(hipAng) * (femurLen * 0.62),
            hip[2] - Math.sin(hipAng) * (femurLen * 0.62),
        ];
        return { hipAng, kneeBend, kneePos, midFemur };
    };

    const update = (state, explode = 0, rootPos = null, rootQuat = null) => {
        const theta = state.theta || 0;
        b.setRootTransform(rootPos, rootQuat, explode, (it, pos, rot) => {
            const ex = it.extra;
            if (!ex) return null;
            if (ex.kind === 'spinX') return { rot: qAxis(1, 0, 0, theta * ex.ratio + (ex.phase || 0)) };
            if (ex.kind === 'leg_femur') {
                const k = legKinematics(theta, ex.phase, ex.hip, ex.femurLen);
                return { rot: qAxis(1, 0, 0, k.hipAng) };
            }
            if (ex.kind === 'leg_knee') {
                const k = legKinematics(theta, ex.phase, ex.hip, ex.femurLen);
                return {
                    pos: [k.kneePos[0] + it.explode[0] * explode, k.kneePos[1] + it.explode[1] * explode, k.kneePos[2] + it.explode[2] * explode],
                };
            }
            if (ex.kind === 'leg_tibia') {
                const k = legKinematics(theta, ex.phase, ex.hip, ex.femurLen);
                return {
                    pos: [k.kneePos[0] + it.explode[0] * explode, k.kneePos[1] + it.explode[1] * explode, k.kneePos[2] + it.explode[2] * explode],
                    rot: qAxis(1, 0, 0, k.hipAng + k.kneeBend),
                };
            }
            if (ex.kind === 'leg_cyl' || ex.kind === 'leg_rod') {
                const k = legKinematics(theta, ex.phase, ex.hip, ex.femurLen);
                const a = ex.anchor, t = k.midFemur;
                const qDir = quatFromYTo(t[0] - a[0], t[1] - a[1], t[2] - a[2]);
                if (ex.kind === 'leg_cyl') return { pos: [a[0] + it.explode[0] * explode, a[1] + it.explode[1] * explode, a[2] + it.explode[2] * explode], rot: qDir };
                return { pos: [t[0] + it.explode[0] * explode, t[1] + it.explode[1] * explode, t[2] + it.explode[2] * explode], rot: qDir };
            }
            return null;
        });
    };

    return {
        spec, builder: b, update,
        setStress: (on, load) => b.applyStressOverlay(on, load),
        stats: b.getStats(),
        destroy: b.destroy,
    };
}

// ============================================================================
// 4. DUAL-FLYWHEEL GEARED KINETIC PILE-DRIVER CARRIAGE
// ============================================================================
function buildTrussPileDriver(scene) {
    const b = createAssemblyBuilder(scene);
    const deckY = 1.02;

    // Twin heavy Warren steel truss side girders + front ram guide frame
    const frameParts = [];
    for (const sx of [-1.15, 1.15]) {
        const localBolts = [];
        const tr = warrenTruss({ length: 4.2, height: 0.62, depth: 0.16, bays: 6, chordSize: 0.074, boltPoints: localBolts });
        tr.rotate(0, 1, 0, Math.PI * 0.5);
        tr.translate(sx, deckY, 0);
        frameParts.push(tr);
        for (const lb of localBolts) {
            b.addBolts([{
                pos: [sx + lb.pos[2], deckY + lb.pos[1], -lb.pos[0]],
                normal: [lb.normal[2], lb.normal[1], -lb.normal[0]],
                scale: 0.9,
            }]);
        }
    }
    for (const zc of [-1.95, -0.95, 0.25, 1.45, 1.98]) {
        frameParts.push(iBeamBetween([-1.18, deckY - 0.26, zc], [1.18, deckY - 0.26, zc], 0.12, 0.14, 0.024));
    }
    // Dual hardened linear guide rails down the centerline for the kinetic pile-bunker ram!
    for (const sx of [-0.36, 0.36]) {
        frameParts.push(iBeamBetween([sx, deckY + 0.12, 1.2], [sx, deckY + 0.12, -2.25], 0.14, 0.12, 0.026));
    }
    b.addPart(finalizeCadMesh(frameParts, 1.2, 42), 'truss_slate', {
        id: 'ram_chassis', label: 'Bolted Twin-Girder Ram Carriage', explode: [0, -0.45, 0], stress: 0.38,
    });

    // 4 Precision Lug-Bolted Wheels
    const wheelMesh = precisionWheel({ radius: 0.56, width: 0.34, spokes: 8 });
    for (const [idx, [wx, wy, wz]] of [[-1.44, 0.56, -1.42], [1.44, 0.56, -1.42], [-1.44, 0.56, 1.42], [1.44, 0.56, 1.42]].entries()) {
        b.addPart(wheelMesh.clone(), 'gunmetal_ordnance', {
            id: `pwheel_${idx}`, label: `Heavy Roadwheel ${idx + 1}`, pos: [wx, wy, wz], explode: [Math.sign(wx) * 0.55, -0.2, 0], stress: 0.44,
            extra: { kind: 'wheel' },
        });
    }

    // Twin Counter-Rotating Spoked Flywheels Locked by Meshing 24T+24T Involute Spur Gears!
    const fMod = 0.044;
    const zF = 24;
    const rF = (fMod * zF) * 0.5; // 0.528 -> center distance = 1.056 (x = ±0.528!)
    const fwY = deckY + 0.78;
    const fwZ = 0.96;

    for (const [idx, sx] of [-1, 1].entries()) {
        const fx = sx * rF;
        b.addBearingStation(fx, fwY, fwZ + 0.34, { boreR: 0.072, outerR: 0.165, centerH: 0.42, explodeZ: 0.45, idPrefix: `fwbrg_${idx}`, speedRatio: sx * 2.4 });
        b.addPart(machinedShaft({ length: 0.96, radius: 0.070 }), 'chrome_shaft', {
            id: `fw_shaft_${idx}`, label: 'Flywheel Energy Shaft', pos: [fx, fwY, fwZ], explode: [sx * 0.3, 0.2, 0.2], stress: 0.55,
        });
        b.addPart(involuteGear({ module: fMod, teeth: zF, width: 0.14, boreR: 0.070, spokes: 6 }), idx === 0 ? 'turned_brass' : 'machined_steel', {
            id: `fw_gear_${idx}`, label: '24T Synchronizing Spur Gear', pos: [fx, fwY, fwZ + 0.12], explode: [sx * 0.35, 0.25, 0.65], stress: 0.62,
            extra: { kind: 'spinZ', ratio: sx * 2.4, phase: idx === 1 ? Math.PI / zF : 0 },
        });
        b.addPart(spokedFlywheel({ radius: 0.66, rimWidth: 0.17, rimThick: 0.11, spokes: 6, boreR: 0.070 }), 'cast_iron', {
            id: `fw_wheel_${idx}`, label: 'Counter-Rotating Inertia Flywheel', pos: [fx, fwY, fwZ - 0.18], explode: [sx * 0.45, 0.35, -0.35], stress: 0.48,
            extra: { kind: 'spinZ', ratio: sx * 2.4, phase: 0 },
        });
    }

    // Twin High-Pressure Hydraulic Accumulator Cylinders + Twin Helical Return Coil Springs
    for (const sx of [-0.62, 0.62]) {
        const cyl = hydraulicBarrel({ length: 1.48, outerR: 0.088, rodR: 0.042 });
        cyl.rotate(1, 0, 0, -Math.PI * 0.5); // point forward along -Z!
        b.addPart(cyl, 'industrial_amber', {
            id: `ram_cyl_${sx < 0 ? 'l' : 'r'}`, label: 'Hydraulic Pile-Driver Cylinder', pos: [sx, deckY + 0.24, 0.22], explode: [sx * 0.45, 0.2, 0], stress: 0.58,
        });
        const rod = hydraulicRod({ length: 1.38, rodR: 0.042 });
        rod.rotate(1, 0, 0, -Math.PI * 0.5);
        b.addPart(rod, 'chrome_shaft', {
            id: `ram_rod_${sx < 0 ? 'l' : 'r'}`, label: 'Chrome Punch Rod', pos: [sx, deckY + 0.24, -1.75], explode: [sx * 0.45, 0.2, -0.65], stress: 0.72,
            extra: { kind: 'ram_slide', baseZ: -1.75 },
        });
        const sp = coilSpring({ coilR: 0.095, wireR: 0.020, turns: 9, length: 0.85 });
        sp.rotate(1, 0, 0, -Math.PI * 0.5);
        b.addPart(sp, 'turned_brass', {
            id: `ram_spring_${sx < 0 ? 'l' : 'r'}`, label: 'Helical Return Coil Spring', pos: [sx, deckY + 0.54, -0.42], explode: [sx * 0.5, 0.5, -0.2], stress: 0.50,
        });
    }

    // Forged Blued-Steel Kinetic Pile-Driver Ram Head (ribbed bolster + stepped flange collar + tapered forged nose!)
    const ramHeadParts = [
        chamferedBox(0.76, 0.30, 0.34, 0.028),
        chamferedBox(0.84, 0.09, 0.36, 0.012).translate(0, -0.14, 0),
        chamferedBox(0.42, 0.24, 0.46, 0.024).translate(0, 0, -0.44),
        bro.mesh.Mesh.cylinder(0.28, 0.06, 16).rotate(1, 0, 0, Math.PI * 0.5).translate(0, 0, -0.88),
        bro.mesh.Mesh.cone(0.26, 0.56, 16, 2, true).rotate(1, 0, 0, -Math.PI * 0.5).translate(0, 0, -0.92),
    ];
    b.addPart(finalizeCadMesh(ramHeadParts, 1.4, 36), 'blued_steel', {
        id: 'ram_head', label: 'Forged Kinetic Pile-Driver Head', pos: [0, deckY + 0.24, -1.96], explode: [0, 0.15, -1.15], stress: 0.78, stressLoadScale: 0.55,
        extra: { kind: 'ram_slide', baseZ: -1.96 },
    });

    b.commitBolts();

    const spec = {
        id: 'truss_piledriver',
        name: 'Kinetic Dual-Flywheel Pile-Driver',
        subtitle: 'Counter-Rotating Geared Flywheels · Twin 1.5m Hydraulic Rams · Helical Return Springs',
        category: 'brawler',
        massKg: 21800,
        gearRatio: '1.00 : 1 Sync',
        canAim: false,
        canDrive: true,
        camTarget: [0, 1.32, -0.25],
        camDist: 6.7,
        camYaw: 2.42,
        specs: [
            { k: 'Energy Storage', v: 'Dual 660mm Spoked Flywheels' },
            { k: 'Sync Gears', v: '24T Brass ↔ 24T Steel Involute' },
            { k: 'Ram Stroke', v: '1.35m Guided Hydraulic Punch' },
            { k: 'Return System', v: 'Twin 9-Turn Helical Coils' },
        ],
    };

    const update = (state, explode = 0, rootPos = null, rootQuat = null) => {
        const theta = state.theta || 0;
        const punch = state.punch ?? Math.max(0, Math.sin(theta * 0.65)) ** 4 * 1.15;
        const wheelSpin = state.wheelSpin ?? (theta * 0.5);
        b.setRootTransform(rootPos, rootQuat, explode, (it, pos, rot) => {
            const ex = it.extra;
            if (!ex) return null;
            if (ex.kind === 'wheel') return { rot: qAxis(1, 0, 0, -wheelSpin) };
            if (ex.kind === 'spinZ') return { rot: qAxis(0, 0, 1, theta * ex.ratio + (ex.phase || 0)) };
            if (ex.kind === 'ram_slide') return { pos: [pos[0], pos[1], ex.baseZ - punch + it.explode[2] * explode] };
            return null;
        });
    };

    return {
        spec, builder: b, update,
        setStress: (on, load) => b.applyStressOverlay(on, load),
        stats: b.getStats(),
        destroy: b.destroy,
    };
}

export const CAD_CATALOG = [
    { id: 'compound_gearbox', name: '9:1 Compound Gearbox & Crank Drive', tag: 'TRANSMISSION', build: buildCompoundGearbox },
    { id: 'truss_howitzer', name: 'Siege Truss Howitzer MK-V', tag: 'ORDNANCE', build: buildTrussHowitzer },
    { id: 'klann_walker_rig', name: 'Articulated Truss Walker MK-IV', tag: 'LINKAGE', build: buildKlannWalker },
    { id: 'truss_piledriver', name: 'Dual-Flywheel Pile-Driver', tag: 'KINETIC RAM', build: buildTrussPileDriver },
];

export function buildCadAssembly(scene, id) {
    const entry = CAD_CATALOG.find((e) => e.id === id) || CAD_CATALOG[0];
    return entry.build(scene);
}
