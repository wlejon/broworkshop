// lib/cad/parts.js — High-detail parametric mechanical CAD parts in pure code.
// True 20° involute spur gears (with spoke lightening cutouts & keyway hubs),
// multi-part ball bearings (chamfered races, brass cages, individual chrome balls),
// split cast-iron pillow blocks, real flanged I-beams & gusseted Warren steel trusses,
// hydraulic cylinders & chrome rods, helical coil springs, forged connecting rods,
// spoked flywheels, braided hoses, lug-bolted wheels, and rifled ordnance barrels.

import {
    extrude2D, revolveProfile, circleLoop, sectorHoleCW, roundedRectLoop,
    orientBetween, chamferedBox, finalizeCadMesh,
} from "./geom.js";

const M = () => bro.mesh.Mesh;

/**
 * True 20-degree pressure-angle involute spur gear along Z-axis (rotates around Z).
 * Pitch radius = module * teeth / 2. Two gears with the same module mesh accurately
 * at center distance = module * (z1 + z2) / 2!
 */
export function involuteGear({
    module = 0.045,
    teeth = 24,
    width = 0.14,
    boreR = 0.075,
    spokes = 6,
    hubR = null,
    hubW = null,
    bevel = 0.008,
} = {}) {
    const rPitch = (module * teeth) * 0.5;
    const rAdd = rPitch + module * 0.96;
    const rDed = Math.max(boreR + 0.03, rPitch - module * 1.18);
    const rBase = rPitch * Math.cos(20 * Math.PI / 180);
    const pitchToothHalf = (Math.PI / (2 * teeth)) * 0.94;
    const invAlpha = Math.tan(20 * Math.PI / 180) - (20 * Math.PI / 180);

    // Exact involute flank offset angle at radius r
    const invAt = (r) => {
        if (r <= rBase) return 0;
        const a = Math.acos(rBase / r);
        return Math.tan(a) - a;
    };

    const outer = [];
    const step = (Math.PI * 2) / teeth;
    for (let t = 0; t < teeth; t++) {
        const mid = t * step;
        const flankHalfAt = (r) => pitchToothHalf + invAlpha - invAt(r);

        const aRoot0 = mid - step * 0.36;
        const aBase0 = mid - flankHalfAt(Math.max(rBase, rDed));
        const aPitch0 = mid - flankHalfAt(rPitch);
        const aTip0 = mid - Math.max(0.004, flankHalfAt(rAdd));
        const aTip1 = mid + Math.max(0.004, flankHalfAt(rAdd));
        const aPitch1 = mid + flankHalfAt(rPitch);
        const aBase1 = mid + flankHalfAt(Math.max(rBase, rDed));
        const aRoot1 = mid + step * 0.36;

        outer.push(
            Math.cos(aRoot0) * rDed, Math.sin(aRoot0) * rDed,
            Math.cos(aBase0) * Math.max(rDed * 1.01, rBase), Math.sin(aBase0) * Math.max(rDed * 1.01, rBase),
            Math.cos(aPitch0) * rPitch, Math.sin(aPitch0) * rPitch,
            Math.cos(aTip0) * rAdd, Math.sin(aTip0) * rAdd,
            Math.cos(aTip1) * rAdd, Math.sin(aTip1) * rAdd,
            Math.cos(aPitch1) * rPitch, Math.sin(aPitch1) * rPitch,
            Math.cos(aBase1) * Math.max(rDed * 1.01, rBase), Math.sin(aBase1) * Math.max(rDed * 1.01, rBase),
            Math.cos(aRoot1) * rDed, Math.sin(aRoot1) * rDed,
        );
    }

    const actualHubR = hubR ?? Math.min(rDed * 0.48, Math.max(boreR * 1.75, boreR + 0.045));
    const rimInR = rDed - Math.max(module * 1.4, 0.045);
    const holes = [];

    // Center shaft bore with rectangular keyway notch at +Y!
    const keyW = boreR * 0.30, keyD = boreR * 0.24;
    const borePts = [];
    const bSegs = 20;
    for (let i = 0; i < bSegs; i++) {
        const a = -(i / bSegs) * Math.PI * 2; // CW hole
        const x = Math.cos(a) * boreR;
        const y = Math.sin(a) * boreR;
        if (y > 0 && Math.abs(x) < keyW) {
            borePts.push(x, boreR + keyD);
        } else {
            borePts.push(x, y);
        }
    }
    holes.push(borePts);

    // Cut spoked lightening windows when gear is large enough!
    if (spokes > 0 && rimInR - actualHubR > 0.06) {
        const rIn = actualHubR + 0.025;
        const rOut = rimInR;
        const sector = (Math.PI * 2) / spokes;
        const spokeAngularHalf = Math.min(0.24, Math.max(0.11, 0.036 / ((rIn + rOut) * 0.5)));
        for (let s = 0; s < spokes; s++) {
            const a0 = s * sector + spokeAngularHalf;
            const a1 = (s + 1) * sector - spokeAngularHalf;
            if (a1 - a0 > 0.14) {
                holes.push(sectorHoleCW(rIn, rOut, a0, a1, 7));
            }
        }
    }

    const gearBody = extrude2D(outer, holes, width, bevel);

    // Raised machined hub boss on both sides + inner recessed collar
    const bossW = hubW ?? (width * 1.48);
    const bossProfile = [
        [boreR, -bossW * 0.5],
        [actualHubR - 0.01, -bossW * 0.5],
        [actualHubR, -bossW * 0.5 + 0.012],
        [actualHubR, bossW * 0.5 - 0.012],
        [actualHubR - 0.01, bossW * 0.5],
        [boreR, bossW * 0.5],
    ];
    const boss = revolveProfile(bossProfile, 28, true);
    boss.rotate(1, 0, 0, Math.PI * 0.5); // align lathe Y-axis onto Z-axis!

    return finalizeCadMesh([gearBody, boss], 1.6, 40);
}

/**
 * Multi-part radial ball bearing aligned along Z-axis.
 * Returns { racesMesh, cageMesh, ballsMesh } so outer/inner hardened races, brass retainer cage,
 * and mirror-chrome orbiting balls render with separate authentic PBR metals!
 */
export function ballBearingParts({
    innerR = 0.08,
    outerR = 0.18,
    width = 0.085,
    balls = 10,
} = {}) {
    const Mesh = M();
    const hw = width * 0.5;
    const ch = Math.min(0.01, width * 0.14);
    const midR = (innerR + outerR) * 0.5;
    const raceThick = (outerR - innerR) * 0.27;
    const ballR = Math.min(hw * 0.72, (outerR - innerR) * 0.28);

    const outerRace = revolveProfile([
        [outerR - raceThick, -hw + ch],
        [outerR - raceThick + ch, -hw],
        [outerR - ch, -hw],
        [outerR, -hw + ch],
        [outerR, hw - ch],
        [outerR - ch, hw],
        [outerR - raceThick + ch, hw],
        [outerR - raceThick, hw - ch],
    ], 32, true);
    outerRace.rotate(1, 0, 0, Math.PI * 0.5);

    const innerRace = revolveProfile([
        [innerR, -hw + ch],
        [innerR + ch, -hw],
        [innerR + raceThick - ch, -hw],
        [innerR + raceThick, -hw + ch],
        [innerR + raceThick, hw - ch],
        [innerR + raceThick - ch, hw],
        [innerR + ch, hw],
        [innerR, hw - ch],
    ], 32, true);
    innerRace.rotate(1, 0, 0, Math.PI * 0.5);

    const racesMesh = finalizeCadMesh([outerRace, innerRace], 2.5, 36);

    // Stamped brass retainer cage ring sitting between balls
    const cageR0 = midR - ballR * 0.32;
    const cageR1 = midR + ballR * 0.32;
    const cw = hw * 0.48;
    const cage = revolveProfile([
        [cageR0, -cw], [cageR1, -cw], [cageR1, cw], [cageR0, cw],
    ], 28, true);
    cage.rotate(1, 0, 0, Math.PI * 0.5);

    // Individual mirror-chrome steel balls seated around the pitch circle!
    const ballList = [];
    for (let i = 0; i < balls; i++) {
        const a = (i / balls) * Math.PI * 2;
        const sp = Mesh.sphere(ballR, 14, 10);
        sp.translate(Math.cos(a) * midR, Math.sin(a) * midR, 0);
        ballList.push(sp);
    }
    const ballsMesh = finalizeCadMesh(ballList, 2.0, 60);
    return { racesMesh, cageMesh: finalizeCadMesh([cage], 2.5, 42), ballsMesh };
}

/**
 * Split cast-iron pillow block bearing housing (bore centered at [0, 0, 0] along Z,
 * mounting base resting at y = -centerH). Includes ribbed saddle, bolted top cap, and base slots.
 */
export function pillowBlock({
    boreR = 0.18,
    width = 0.14,
    centerH = 0.28,
} = {}) {
    const outerR = boreR + 0.075;
    const baseHalfW = outerR + 0.17;
    const baseH = Math.max(0.065, centerH * 0.24);
    const yBase = -centerH;

    // Extruded cast-iron arched pedestal profile with central bore hole
    const outer = [
        -baseHalfW, yBase,
        baseHalfW, yBase,
        baseHalfW, yBase + baseH,
        outerR + 0.03, yBase + baseH + 0.02,
        outerR + 0.015, 0.02,
    ];
    // Top semi-circular cap arch
    const archSegs = 16;
    for (let i = 0; i <= archSegs; i++) {
        const a = (i / archSegs) * Math.PI;
        outer.push(Math.cos(a) * outerR, Math.sin(a) * outerR);
    }
    outer.push(
        -(outerR + 0.015), 0.02,
        -(outerR + 0.03), yBase + baseH + 0.02,
        -baseHalfW, yBase + baseH,
    );

    const boreHole = circleLoop(0, 0, boreR, 24, false);
    const housing = extrude2D(outer, [boreHole], width, 0.01);

    // Side cap bolt lugs & vertical stiffening ribs
    const lugL = chamferedBox(0.042, 0.048, width * 0.44, 0.008);
    lugL.translate(-(outerR + 0.025), 0, 0);
    const lugR = chamferedBox(0.042, 0.048, width * 0.44, 0.008);
    lugR.translate(outerR + 0.025, 0, 0);

    // Brass grease fitting boss on top of cap
    const zerk = M().cylinder(0.016, 0.024, 8);
    zerk.translate(0, outerR + 0.02, 0);

    return finalizeCadMesh([housing, lugL, lugR, zerk], 1.6, 38);
}

/**
 * True flanged structural I-beam spanning from `a` to `b`, with periodic web stiffeners!
 */
export function iBeamBetween(a, b, height = 0.22, width = 0.16, thick = 0.028) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 1e-4) return new (M())();
    const hh = height * 0.5, hw = width * 0.5, tw = thick * 0.5, tf = thick;
    // True I-section profile in XY, extruded along Z then rotated onto +Y so orientBetween aligns it cleanly!
    const prof = [
        -hw, -hh, hw, -hh, hw, -hh + tf, tw, -hh + tf,
        tw, hh - tf, hw, hh - tf, hw, hh, -hw, hh,
        -hw, hh - tf, -tw, hh - tf, -tw, -hh + tf, -hw, -hh + tf,
    ];
    const beam = extrude2D(prof, [], len, 0.004);
    beam.rotate(1, 0, 0, Math.PI * 0.5); // extrusion Z -> +Y
    return orientBetween(beam, a, b);
}

/**
 * Real engineered Warren Steel Truss span (along X from -len/2 to +len/2, height H along Y, depth D along Z).
 * Includes flanged top & bottom chords, alternating diagonal braces, triangular gusset plates at every node,
 * and populates `boltPoints` with exact fastener positions for instanced hex bolts!
 */
export function warrenTruss({
    length = 3.2,
    height = 0.62,
    depth = 0.20,
    bays = 5,
    chordSize = 0.075,
    boltPoints = null,
} = {}) {
    const parts = [];
    const x0 = -length * 0.5, x1 = length * 0.5;
    const y0 = -height * 0.5, y1 = height * 0.5;

    // Top & bottom chords (front & back double channels or single flanged I-beams)
    parts.push(iBeamBetween([x0, y0, 0], [x1, y0, 0], chordSize, depth, chordSize * 0.24));
    parts.push(iBeamBetween([x0, y1, 0], [x1, y1, 0], chordSize, depth, chordSize * 0.24));
    // End vertical posts
    parts.push(iBeamBetween([x0, y0, 0], [x0, y1, 0], chordSize, depth, chordSize * 0.24));
    parts.push(iBeamBetween([x1, y0, 0], [x1, y1, 0], chordSize, depth, chordSize * 0.24));

    const bayW = length / bays;
    const diagSize = chordSize * 0.68;
    const gHalf = chordSize * 1.15;
    for (let i = 0; i < bays; i++) {
        const xa = x0 + i * bayW;
        const xm = xa + bayW * 0.5;
        const xb = xa + bayW;
        // Warren V diagonals
        parts.push(iBeamBetween([xa, y0, 0], [xm, y1, 0], diagSize, depth * 0.72, diagSize * 0.25));
        parts.push(iBeamBetween([xm, y1, 0], [xb, y0, 0], diagSize, depth * 0.72, diagSize * 0.25));

        // Gusset plates on front (+Z) and back (-Z) faces at top & bottom joints
        for (const [gx, gy] of [[xa, y0], [xm, y1], ...(i === bays - 1 ? [[xb, y0]] : [])]) {
            for (const side of [-1, 1]) {
                const gp = chamferedBox(gHalf, chordSize * 0.88, 0.012, 0.003);
                gp.translate(gx, gy, side * (depth * 0.5 + 0.01));
                parts.push(gp);
                if (boltPoints) {
                    boltPoints.push({ pos: [gx - gHalf * 0.48, gy, side * (depth * 0.5 + 0.022)], normal: [0, 0, side] });
                    boltPoints.push({ pos: [gx + gHalf * 0.48, gy, side * (depth * 0.5 + 0.022)], normal: [0, 0, side] });
                }
            }
        }
    }
    return finalizeCadMesh(parts, 1.4, 42);
}

/**
 * Heavy rim-weighted spoked cast/machined flywheel (along Z-axis).
 */
export function spokedFlywheel({
    radius = 0.62,
    rimWidth = 0.18,
    rimThick = 0.11,
    spokes = 6,
    boreR = 0.075,
} = {}) {
    const rimIn = radius - rimThick;
    const hubR = Math.max(boreR * 2.1, 0.15);
    const ch = 0.018;
    // Lathe-turned heavy outer rim with chamfered corners & stepped groove
    const hw = rimWidth * 0.5;
    const rim = revolveProfile([
        [rimIn, -hw + ch], [rimIn + ch, -hw],
        [radius - ch, -hw], [radius, -hw + ch],
        [radius, hw - ch], [radius - ch, hw],
        [rimIn + ch, hw], [rimIn, hw - ch],
    ], 44, true);
    rim.rotate(1, 0, 0, Math.PI * 0.5);

    // Central stepped machined hub
    const hub = revolveProfile([
        [boreR, -hw * 1.1], [hubR - 0.012, -hw * 1.1], [hubR, -hw * 0.95],
        [hubR, hw * 0.95], [hubR - 0.012, hw * 1.1], [boreR, hw * 1.1],
    ], 28, true);
    hub.rotate(1, 0, 0, Math.PI * 0.5);

    // Tapered I-profile spokes connecting hub to rim
    const parts = [rim, hub];
    for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        const p0 = [Math.cos(a) * (hubR * 0.85), Math.sin(a) * (hubR * 0.85), 0];
        const p1 = [Math.cos(a) * (rimIn + 0.02), Math.sin(a) * (rimIn + 0.02), 0];
        parts.push(iBeamBetween(p0, p1, rimWidth * 0.44, rimWidth * 0.34, 0.022));
    }
    return finalizeCadMesh(parts, 1.5, 38);
}

/**
 * True 3D helical coil spring along +Y from y = 0 to y = length (swept via Mesh.tube!).
 */
export function coilSpring({
    coilR = 0.12,
    wireR = 0.022,
    turns = 7,
    length = 0.48,
    stepsPerTurn = 14,
} = {}) {
    const Mesh = M();
    const total = Math.max(24, Math.round(turns * stepsPerTurn));
    const path = [];
    for (let i = 0; i <= total; i++) {
        const t = i / total;
        const a = t * turns * Math.PI * 2;
        // Ground-flat transition at very top & bottom coil ends
        const y = t < 0.06 ? (t / 0.06) * wireR * 1.2
            : t > 0.94 ? length - ((1 - t) / 0.06) * wireR * 1.2
                : wireR * 1.2 + ((t - 0.06) / 0.88) * (length - wireR * 2.4);
        path.push([Math.cos(a) * coilR, y, Math.sin(a) * coilR]);
    }
    const coil = Mesh.tube(path, wireR, 10, { capStart: true, capEnd: true });
    coil.computeCreaseNormals(55);
    coil.projectUVs('box', 2.4);
    return coil;
}

/**
 * Hydraulic cylinder barrel (base clevis at y = 0, extends along +Y to y = length)
 * plus brass port fittings and bolted front gland nut.
 */
export function hydraulicBarrel({
    length = 0.85,
    outerR = 0.095,
    rodR = 0.042,
} = {}) {
    const glandH = 0.075;
    const capH = 0.08;
    const barrel = revolveProfile([
        [0, 0.06], [outerR * 1.08, 0.06], [outerR * 1.14, 0.08],
        [outerR * 1.14, 0.06 + capH], [outerR, 0.06 + capH + 0.012],
        [outerR, length - glandH], [outerR * 1.18, length - glandH + 0.01],
        [outerR * 1.18, length - 0.01], [outerR * 1.08, length],
        [rodR + 0.012, length], [rodR + 0.012, length - 0.04],
    ], 24, false);

    // Rear clevis mounting eye at y = 0
    const eyeOuter = roundedRectLoop(0, 0.03, outerR * 0.72, 0.075, 0.035, 4, true);
    const eyeHole = circleLoop(0, 0, outerR * 0.34, 16, false);
    const clevis = extrude2D(eyeOuter, [eyeHole], outerR * 1.1, 0.008);

    // Side hydraulic port bosses near base & gland
    const port1 = M().cylinder(0.022, 0.035, 10);
    port1.rotate(0, 0, 1, Math.PI * 0.5);
    port1.translate(outerR + 0.022, 0.17, 0);
    const port2 = M().cylinder(0.022, 0.035, 10);
    port2.rotate(0, 0, 1, Math.PI * 0.5);
    port2.translate(outerR + 0.022, length - 0.12, 0);

    return finalizeCadMesh([barrel, clevis, port1, port2], 1.8, 38);
}

/** Chrome hydraulic piston rod (piston inside barrel at y = -length, rod-end eye at y = 0). */
export function hydraulicRod({
    length = 0.80,
    rodR = 0.042,
} = {}) {
    const shaft = revolveProfile([
        [0, -length], [rodR * 1.6, -length], [rodR * 1.6, -length + 0.07],
        [rodR, -length + 0.08], [rodR, -0.07], [rodR * 1.4, -0.06],
        [rodR * 1.4, -0.03], [rodR * 0.9, -0.02],
    ], 20, false);
    const eyeOuter = roundedRectLoop(0, 0, rodR * 1.9, rodR * 1.9, rodR * 0.9, 5, true);
    const eyeHole = circleLoop(0, 0, rodR * 0.85, 16, false);
    const eye = extrude2D(eyeOuter, [eyeHole], rodR * 2.1, 0.006);
    return finalizeCadMesh([shaft, eye], 2.0, 38);
}

/** Forged I-section connecting rod from big-end [0,0,0] to small-end [0,length,0], Z-axis pins. */
export function connectingRod({
    length = 0.72,
    bigR = 0.11,
    smallR = 0.06,
    thick = 0.07,
} = {}) {
    const bigOuter = circleLoop(0, 0, bigR + 0.045, 24, true);
    const bigHole = circleLoop(0, 0, bigR, 20, false);
    const bigEnd = extrude2D(bigOuter, [bigHole], thick * 1.25, 0.008);

    const smOuter = circleLoop(0, length, smallR + 0.032, 20, true);
    const smHole = circleLoop(0, length, smallR, 16, false);
    const smEnd = extrude2D(smOuter, [smHole], thick, 0.007);

    // Tapered forged shank with recessed H-beam web
    const shank = iBeamBetween([0, bigR + 0.02, 0], [0, length - smallR - 0.015, 0], thick * 0.95, thick * 0.82, 0.016);
    // Split cap bolt ears on big end
    const earL = chamferedBox(0.032, 0.055, thick * 0.55, 0.005);
    earL.translate(-(bigR + 0.055), 0, 0);
    const earR = chamferedBox(0.032, 0.055, thick * 0.55, 0.005);
    earR.translate(bigR + 0.055, 0, 0);

    return finalizeCadMesh([bigEnd, smEnd, shank, earL, earR], 2.0, 38);
}

/** Stepped lathe-turned drive shaft along Z-axis with collars and chamfered ends. */
export function machinedShaft({ length = 1.0, radius = 0.072 } = {}) {
    const hl = length * 0.5;
    const ch = Math.min(0.012, radius * 0.18);
    const m = revolveProfile([
        [0, -hl], [radius - ch, -hl], [radius, -hl + ch],
        [radius, -hl * 0.72], [radius * 1.12, -hl * 0.70], [radius * 1.12, -hl * 0.64], [radius, -hl * 0.62],
        [radius, hl * 0.62], [radius * 1.12, hl * 0.64], [radius * 1.12, hl * 0.70], [radius, hl * 0.72],
        [radius, hl - ch], [radius - ch, hl], [0, hl],
    ], 24, false);
    m.rotate(1, 0, 0, Math.PI * 0.5);
    return finalizeCadMesh([m], 2.0, 38);
}

/** Single precision hex bolt head + washer aligned along +Y (used via scene.createInstancedMesh!). */
export function hexBoltMesh(radius = 0.024, height = 0.022) {
    const washer = M().cylinder(radius * 1.48, height * 0.16, 14);
    washer.translate(0, height * 0.16, 0);
    const head = M().cylinder(radius, height * 0.45, 6);
    head.translate(0, height * 0.72, 0);
    const tip = M().cylinder(radius * 0.58, height * 0.16, 10);
    tip.translate(0, height * 1.18, 0);
    return finalizeCadMesh([washer, head, tip], 3.0, 30);
}

/** Curved braided hydraulic hose swept along a 3D cubic polyline. */
export function hydraulicHose(points, radius = 0.022) {
    const hose = M().tube(points, radius, 10, { capStart: true, capEnd: true });
    hose.computeCreaseNormals(55);
    hose.projectUVs('box', 3.5);
    return hose;
}

/**
 * Engineered heavy steel spoked roadwheel (rotates around X-axis for vehicles).
 * Includes stepped machined outer tire band, recessed dish, 8 spokes, hub cap, and lug bolts!
 */
export function precisionWheel({ radius = 0.56, width = 0.30, spokes = 8 } = {}) {
    const hw = width * 0.5;
    const tireIn = radius * 0.76;
    const ch = 0.022;
    const rim = revolveProfile([
        [tireIn, -hw + ch], [tireIn + ch, -hw],
        [radius - ch, -hw], [radius, -hw + ch],
        [radius, hw - ch], [radius - ch, hw],
        [tireIn + ch, hw], [tireIn, hw - ch],
    ], 36, true);
    rim.rotate(0, 0, 1, Math.PI * 0.5); // axis -> X

    // Stepped center planetary hub + lug ring
    const hubR = radius * 0.30;
    const hub = revolveProfile([
        [0, -hw * 1.05], [hubR * 0.9, -hw * 1.05], [hubR, -hw * 0.9],
        [hubR, hw * 0.9], [hubR * 0.85, hw * 1.12], [hubR * 0.55, hw * 1.18], [0, hw * 1.18],
    ], 24, false);
    hub.rotate(0, 0, 1, Math.PI * 0.5);

    const parts = [rim, hub];
    // Radial forged spokes + outer tread grouser bars
    for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        parts.push(iBeamBetween(
            [0, Math.cos(a) * hubR * 0.8, Math.sin(a) * hubR * 0.8],
            [0, Math.cos(a) * (tireIn + 0.02), Math.sin(a) * (tireIn + 0.02)],
            width * 0.36, width * 0.24, 0.02
        ));
        // Lug bolts around hub face
        const lug = M().cylinder(0.022, 0.026, 6);
        lug.rotate(0, 0, 1, Math.PI * 0.5);
        lug.translate(hw * 0.95, Math.cos(a) * hubR * 0.72, Math.sin(a) * hubR * 0.72);
        parts.push(lug);
    }
    const treadN = 20;
    for (let i = 0; i < treadN; i++) {
        const a = (i / treadN) * Math.PI * 2;
        const lug = chamferedBox(hw * 0.86, 0.024, 0.032, 0.005);
        lug.rotate(1, 0, 0, a);
        lug.translate(0, Math.cos(a) * (radius + 0.012), Math.sin(a) * (radius + 0.012));
        parts.push(lug);
    }
    return finalizeCadMesh(parts, 1.5, 38);
}

/**
 * Heavy lathe-turned ordnance cannon barrel + perforated muzzle brake + twin hydro-pneumatic
 * recoil recuperators + sliding breech cradle (points forward along -Z!).
 */
export function rifledCannonAssembly({ length = 3.6, boreR = 0.11 } = {}) {
    const outerR = boreR * 1.95;
    // Stepped forged barrel along +Y, then rotated onto -Z
    const barrel = revolveProfile([
        [0, -0.55], [outerR * 1.48, -0.55], [outerR * 1.56, -0.48],
        [outerR * 1.56, 0.35], [outerR * 1.32, 0.44],
        [outerR * 1.32, 1.35], [outerR * 1.10, 1.45],
        [outerR * 1.02, 2.35], [outerR * 1.24, 2.40], [outerR * 1.24, 2.60], [outerR * 0.96, 2.66], // bore evacuator!
        [outerR * 0.88, length - 0.36],
        [outerR * 1.38, length - 0.34], [outerR * 1.38, length - 0.24], [outerR * 1.08, length - 0.22], // muzzle brake baffle 1
        [outerR * 1.08, length - 0.14], [outerR * 1.38, length - 0.12], [outerR * 1.38, length - 0.02], // baffle 2
        [outerR * 1.28, length], [boreR, length], [boreR, length - 0.45], [0, length - 0.45],
    ], 32, false);
    barrel.rotate(1, 0, 0, -Math.PI * 0.5); // +Y -> -Z!

    // Sculpted artillery breech collar, sliding-wedge housing, recoil cradle rails & operating crank!
    const breechCollar = revolveProfile([
        [0, 0.28], [outerR * 1.48, 0.28], [outerR * 1.54, 0.34],
        [outerR * 1.54, 0.74], [outerR * 1.28, 0.82], [outerR * 0.85, 0.84], [0, 0.84],
    ], 24, false);
    breechCollar.rotate(1, 0, 0, Math.PI * 0.5); // +Y -> +Z (rear!)
    const wedgeHousing = chamferedBox(outerR * 1.22, outerR * 1.32, 0.26, 0.025);
    wedgeHousing.translate(0, 0.02, 0.52);
    const crankArm = chamferedBox(0.18, 0.032, 0.032, 0.006);
    crankArm.translate(outerR * 1.45, 0.04, 0.56);
    const crankHandle = M().cylinder(0.028, 0.10, 12);
    crankHandle.rotate(1, 0, 0, Math.PI * 0.5);
    crankHandle.translate(outerR * 1.92, 0.04, 0.66);

    // Twin cylindrical hydro-pneumatic recoil recuperators mounted under the barrel + side guide rails
    const recupParts = [];
    for (const sx of [-1, 1]) {
        const rec = revolveProfile([
            [0, -0.35], [0.095, -0.35], [0.108, -0.30], [0.108, 1.65],
            [0.125, 1.68], [0.125, 1.78], [0.09, 1.80], [0, 1.80],
        ], 20, false);
        rec.rotate(1, 0, 0, -Math.PI * 0.5);
        rec.translate(sx * (outerR * 1.15), -outerR * 1.35, -0.15);
        recupParts.push(rec);
        recupParts.push(iBeamBetween([sx * (outerR * 1.48), -0.06, 0.55], [sx * (outerR * 1.48), -0.06, -1.65], 0.08, 0.06, 0.014));
    }

    // Clamp collars tying barrel to twin recuperators
    const c1 = chamferedBox(outerR * 1.72, outerR * 1.05, 0.08, 0.012);
    c1.translate(0, -outerR * 0.62, -0.45);
    const c2 = chamferedBox(outerR * 1.62, outerR * 0.98, 0.08, 0.012);
    c2.translate(0, -outerR * 0.62, -1.45);

    return finalizeCadMesh([barrel, breechCollar, wedgeHousing, crankArm, crankHandle, ...recupParts, c1, c2], 1.5, 38);
}

/** Cutaway finned reciprocating cylinder block + cranked piston head. */
export function finnedCylinderCutaway({ boreR = 0.14, height = 0.52, fins = 7 } = {}) {
    const parts = [];
    // Open half-shell cylinder cutaway (190 deg arc extruded along Y so piston inside is clearly visible!)
    const rIn = boreR + 0.008;
    const rOut = boreR + 0.048;
    const segs = 18;
    const aStart = -Math.PI * 0.08, aEnd = Math.PI * 1.08;
    const outer = [];
    for (let i = 0; i <= segs; i++) {
        const a = aStart + (aEnd - aStart) * (i / segs);
        outer.push(Math.cos(a) * rOut, Math.sin(a) * rOut);
    }
    for (let i = segs; i >= 0; i--) {
        const a = aStart + (aEnd - aStart) * (i / segs);
        outer.push(Math.cos(a) * rIn, Math.sin(a) * rIn);
    }
    const sleeve = extrude2D(outer, [], height, 0.006);
    sleeve.rotate(1, 0, 0, -Math.PI * 0.5); // extrusion Z -> +Y!
    sleeve.translate(0, height * 0.5, 0);
    parts.push(sleeve);

    // Cooling fins wrapping the back 190 deg cutaway
    for (let f = 0; f < fins; f++) {
        const y = 0.07 + (f / Math.max(1, fins - 1)) * (height - 0.14);
        const finPts = [];
        for (let i = 0; i <= segs; i++) {
            const a = aStart + (aEnd - aStart) * (i / segs);
            finPts.push(Math.cos(a) * (rOut + 0.048), Math.sin(a) * (rOut + 0.048));
        }
        for (let i = segs; i >= 0; i--) {
            const a = aStart + (aEnd - aStart) * (i / segs);
            finPts.push(Math.cos(a) * (rOut - 0.004), Math.sin(a) * (rOut - 0.004));
        }
        const fin = extrude2D(finPts, [], 0.016, 0.003);
        fin.rotate(1, 0, 0, -Math.PI * 0.5);
        fin.translate(0, y, 0);
        parts.push(fin);
    }

    // Bolted cylinder head cap on top
    const head = chamferedBox(rOut + 0.05, 0.045, rOut + 0.05, 0.01);
    head.translate(0, height + 0.04, 0);
    parts.push(head);
    return finalizeCadMesh(parts, 1.8, 38);
}

/** Machined aluminum/steel piston with 3 visible compression ring grooves! */
export function machinedPiston({ radius = 0.136, height = 0.18 } = {}) {
    const r = radius, gr = radius * 0.90;
    const h = height * 0.5;
    const m = revolveProfile([
        [0, -h], [r, -h], [r, h * 0.18],
        [gr, h * 0.20], [gr, h * 0.28], [r, h * 0.30], // ring groove 1
        [r, h * 0.44], [gr, h * 0.46], [gr, h * 0.54], [r, h * 0.56], // ring groove 2
        [r, h * 0.70], [gr, h * 0.72], [gr, h * 0.80], [r, h * 0.82], // ring groove 3
        [r, h - 0.012], [r - 0.012, h], [0, h],
    ], 24, false);
    return finalizeCadMesh([m], 2.2, 36);
}
