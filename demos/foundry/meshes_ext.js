// demos/foundry/meshes_ext.js — Multi-Material Precision CAD Geometry for Extended
// Foundry Mechanisms (Planetary, Worm, HTD Belt, Roller Chain, Hydraulics, Lead Screw,
// Crawler Tracks, Supercaps, Oil Coolers & New Weapon/Tool Effectors).

import { MAT, PartBuilder, shade } from "/app/meshes.js";

const PI = Math.PI;
const TAU = 2 * PI;

/** Supercapacitor burst bank: 4 cylindrical ultra-cap cells strapped in an anodized busbar rack. */
export function capacitorBankMesh(size) {
    const [W, H, D] = size;
    const b = new PartBuilder();
    b.box(0, -H * 0.36, 0, W * 0.48, H * 0.12, D * 0.48, MAT.CAST, [0.16, 0.19, 0.24], 0.48);
    const cellR = Math.min(W * 0.20, D * 0.22);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.cylY(sx * W * 0.24, 0.02 * H, sz * D * 0.24, cellR, H * 0.78, 16, MAT.ARMOR, [0.10, 0.44, 0.58], 0.64, 0.72);
        b.cylY(sx * W * 0.24, H * 0.44, sz * D * 0.24, cellR * 0.35, H * 0.08, 10, MAT.COPPER, [0.84, 0.46, 0.18], 0.76, 0.82);
    }
    // Copper collector busbars + cyan surge status LED
    b.box(0, H * 0.46, -D * 0.24, W * 0.32, H * 0.04, D * 0.06, MAT.COPPER, [0.84, 0.46, 0.18], 0.74);
    b.box(0, H * 0.46, D * 0.24, W * 0.32, H * 0.04, D * 0.06, MAT.COPPER, [0.84, 0.46, 0.18], 0.74);
    b.box(0, H * 0.48, 0, W * 0.24, H * 0.03, D * 0.05, MAT.GLOW, [0.14, 0.90, 1.0], 0.85, 1.4);
    return b.build();
}

/** Axial-piston hydraulic pump: ribbed cast-iron swashplate body, aluminum flange & brass SAE ports. */
export function hydraulicPumpMesh(size) {
    const [W, H, L] = size;
    const r = Math.min(W, H) * 0.46;
    const b = new PartBuilder();
    b.cylZ(0, 0, -L * 0.06, r, L * 0.68, 20, MAT.ARMOR, [0.12, 0.36, 0.46], 0.58, 0.66);
    b.cylZ(0, 0, -L * 0.42, r * 1.12, L * 0.14, 18, MAT.STEEL, [0.66, 0.70, 0.75], 0.66, 0.74);
    b.cylZ(0, 0, L * 0.34, r * 0.86, L * 0.24, 18, MAT.CAST, [0.20, 0.23, 0.28], 0.54, 0.62);
    // Brass high-pressure SAE outlet fittings + top pressure port
    b.cylY(0, r * 1.05, L * 0.22, r * 0.22, r * 0.38, 12, MAT.BRASS, [0.86, 0.66, 0.22], 0.74, 0.80);
    b.cylX(r * 0.95, 0, L * 0.22, r * 0.18, r * 0.36, 12, MAT.BRASS, [0.86, 0.66, 0.22], 0.74, 0.80);
    // Mounting foot
    b.box(0, -r * 0.94, 0, r * 0.95, r * 0.14, L * 0.38, MAT.CAST, [0.18, 0.20, 0.25], 0.46);
    return b.build();
}

/** Cutaway coaxial planetary gearbox: bolted ring housing, central sun, orbiting planets on bronze pins! */
export function planetaryGearMesh(od, fw, planets = 3, col = [0.62, 0.66, 0.72]) {
    const rOut = od * 0.5;
    const rRing = rOut * 0.82;
    const rSun = rRing * 0.34;
    const rPlan = (rRing - rSun) * 0.48;
    const rOrb = rSun + rPlan;
    const b = new PartBuilder();

    // Outer cast-steel ring gear housing with cutaway front face so planets are clearly visible!
    const segs = 28, pts = [];
    for (let k = 0; k < segs; k++) {
        const a = (k / segs) * TAU;
        pts.push([Math.cos(a) * rOut, Math.sin(a) * rOut, 0.66]);
    }
    b.extrudeRing(pts, fw * 1.15, rRing, MAT.CAST, [0.22, 0.25, 0.30]);
    // 6 mounting flange bolts around outer ring
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        b.boltZ(Math.cos(a) * rOut * 0.91, Math.sin(a) * rOut * 0.91, fw * 0.62, rOut * 0.065, fw * 0.14);
    }
    // Central hardened steel sun pinion
    b.cylZ(0, 0, 0, rSun, fw * 1.28, 16, MAT.STEEL, shade(col, 1.08), 0.70, 0.78);
    // Orbiting planet gears + gleaming bronze needle-bearing pins!
    const count = Math.max(3, Math.min(6, Math.round(planets)));
    for (let k = 0; k < count; k++) {
        const a = (k / count) * TAU;
        const px = Math.cos(a) * rOrb, py = Math.sin(a) * rOrb;
        b.cylZ(px, py, 0, rPlan, fw * 0.92, 16, MAT.STEEL, col, 0.66, 0.74);
        b.cylZ(px, py, 0, rPlan * 0.38, fw * 1.24, 10, MAT.BRASS, [0.86, 0.64, 0.22], 0.78, 0.84);
    }
    // Rear carrier backing plate
    b.cylZ(0, 0, -fw * 0.56, rRing * 0.94, fw * 0.18, 22, MAT.STEEL, shade(col, 0.84), 0.54, 0.60);
    return b.build();
}

/** 90-degree self-locking worm & bronze wheel reducer. */
export function wormGearMesh(od, fw, col = [0.80, 0.58, 0.24]) {
    const rW = od * 0.5;
    const b = new PartBuilder();
    // Cast-iron lower gearbox cradle
    b.box(0, -rW * 0.92, 0, rW * 0.95, rW * 0.16, fw * 0.72, MAT.CAST, [0.20, 0.22, 0.27], 0.46);
    // Gleaming SAE 660 bronze worm wheel (rotates around X/Z plane)
    const segs = 26, pts = [];
    for (let k = 0; k < segs; k++) {
        const a = (k / segs) * TAU;
        const r = k % 2 === 0 ? rW : rW * 0.93;
        pts.push([Math.cos(a) * r, Math.sin(a) * r, k % 2 === 0 ? 0.84 : 0.28]);
    }
    b.extrudeRing(pts, fw, rW * 0.34, MAT.BRASS, col);
    b.cylZ(0, 0, 0, rW * 0.38, fw * 1.45, 16, MAT.STEEL, [0.68, 0.72, 0.76], 0.66, 0.74);

    // Hardened steel helical worm screw riding across the top of the bronze wheel!
    const wY = rW * 1.06;
    const wR = rW * 0.22;
    b.cylX(0, wY, 0, wR * 0.65, rW * 2.1, 14, MAT.STEEL, [0.74, 0.77, 0.82], 0.70, 0.76);
    for (let k = -3; k <= 3; k++) {
        b.cylX(k * rW * 0.18, wY, 0, wR * 1.15, rW * 0.08, 16, MAT.STEEL, [0.62, 0.66, 0.72], 0.74, 0.66);
    }
    // End thrust bearing bosses holding the worm shaft
    for (const sx of [-1, 1]) {
        b.box(sx * rW * 0.86, wY * 0.5, 0, rW * 0.14, wY * 0.62, fw * 0.44, MAT.CAST, [0.22, 0.25, 0.30], 0.54);
    }
    return b.build();
}

/** HTD toothed timing belt & twin flanged aluminum pulleys spanning along Z. */
export function beltDriveMesh(r1, r2, span, width) {
    const b = new PartBuilder();
    const z1 = -span * 0.5, z2 = span * 0.5;
    // Drive & driven CNC aluminum flanged pulleys (aligned with X axis so belt runs along Z!)
    const pulley = (z, r) => {
        b.cylX(0, 0, z, r, width * 0.92, 22, MAT.STEEL, [0.68, 0.72, 0.76], 0.66, 0.74);
        b.cylX(-width * 0.52, 0, z, r * 1.12, width * 0.09, 22, MAT.STEEL, [0.76, 0.80, 0.84], 0.72, 0.78);
        b.cylX(width * 0.52, 0, z, r * 1.12, width * 0.09, 22, MAT.STEEL, [0.76, 0.80, 0.84], 0.72, 0.78);
        b.cylX(0, 0, z, r * 0.38, width * 1.35, 14, MAT.CAST, [0.20, 0.22, 0.26], 0.52, 0.60);
    };
    pulley(z1, r1);
    pulley(z2, r2);
    // Dark neoprene HTD timing belt top & bottom runs + yellow tensioner idler!
    const rAvg = (r1 + r2) * 0.5;
    b.box(0, rAvg * 0.96, 0, width * 0.46, 0.006, span * 0.52, MAT.RUBBER, [0.14, 0.15, 0.18], 0.52);
    b.box(0, -rAvg * 0.96, 0, width * 0.46, 0.006, span * 0.52, MAT.RUBBER, [0.14, 0.15, 0.18], 0.46);
    b.cylX(0, rAvg * 1.12, 0, Math.min(r1, r2) * 0.42, width * 0.90, 14, MAT.BRASS, [0.84, 0.64, 0.20], 0.72, 0.78);
    return b.build();
}

/** Heavy steel roller chain & toothed sprockets spanning along Z. */
export function chainDriveMesh(r1, r2, span, pitch) {
    const b = new PartBuilder();
    const z1 = -span * 0.5, z2 = span * 0.5;
    const w = Math.max(0.012, pitch * 1.1);
    const sprocket = (z, r) => {
        b.cylX(0, 0, z, r, w * 0.65, 20, MAT.STEEL, [0.56, 0.60, 0.66], 0.64, 0.72);
        b.cylX(0, 0, z, r * 0.42, w * 1.4, 14, MAT.CAST, [0.22, 0.25, 0.30], 0.52, 0.60);
    };
    sprocket(z1, r1);
    sprocket(z2, r2);
    // Upper & lower articulated steel chain runs with visible pin links!
    const rAvg = (r1 + r2) * 0.5;
    const links = Math.max(6, Math.min(20, Math.round(span / Math.max(0.012, pitch * 1.6))));
    for (let k = 0; k < links; k++) {
        const z = z1 + (k + 0.5) * (span / links);
        const col = k % 2 === 0 ? [0.36, 0.39, 0.44] : [0.58, 0.62, 0.68];
        b.box(0, rAvg * 0.96, z, w * 0.55, pitch * 0.38, (span / links) * 0.44, MAT.STEEL, col, 0.62);
        b.box(0, -rAvg * 0.96, z, w * 0.55, pitch * 0.38, (span / links) * 0.44, MAT.STEEL, col, 0.54);
    }
    return b.build();
}

/** One-way sprag freewheel clutch with anodized violet outer race and chrome sprag elements. */
export function overrunClutchMesh(d, len) {
    const r = d * 0.5;
    const b = new PartBuilder();
    const pts = [], segs = 22;
    for (let k = 0; k < segs; k++) {
        const a = (k / segs) * TAU;
        pts.push([Math.cos(a) * r, Math.sin(a) * r, 0.68]);
    }
    b.extrudeRing(pts, len, r * 0.74, MAT.ARMOR, [0.46, 0.30, 0.78]);
    // Inner alloy keyed hub
    b.cylZ(0, 0, 0, r * 0.48, len * 1.26, 16, MAT.STEEL, [0.70, 0.74, 0.78], 0.68, 0.76);
    // Visible chrome sprag wedges seated between inner and outer race!
    const sprags = 8;
    const midR = r * 0.61;
    for (let k = 0; k < sprags; k++) {
        const a = (k / sprags) * TAU;
        b.cylZ(Math.cos(a) * midR, Math.sin(a) * midR, 0, r * 0.10, len * 0.85, 8, MAT.STEEL, [0.84, 0.87, 0.92], 0.80, 0.86);
    }
    return b.build();
}

/** Proportional hydraulic pressure-relief valve manifold with brass cartridge screw & gauge. */
export function hydraulicValveMesh(size) {
    const [W, H, D] = size;
    const b = new PartBuilder();
    // CNC-machined billet aluminum manifold block
    b.box(0, 0, 0, W * 0.46, H * 0.42, D * 0.46, MAT.STEEL, [0.64, 0.68, 0.74], 0.64);
    // Dual dark solenoid actuator coils on top
    b.cylY(-W * 0.22, H * 0.52, 0, W * 0.16, H * 0.34, 14, MAT.ARMOR, [0.10, 0.56, 0.52], 0.62, 0.70);
    b.cylY(W * 0.22, H * 0.52, 0, W * 0.16, H * 0.34, 14, MAT.CAST, [0.18, 0.21, 0.26], 0.58, 0.66);
    // Brass relief pressure adjuster screw + glowing status indicator
    b.cylX(W * 0.56, 0, 0, H * 0.18, W * 0.24, 10, MAT.BRASS, [0.88, 0.68, 0.22], 0.76, 0.82);
    b.box(0, H * 0.44, D * 0.38, W * 0.16, H * 0.06, D * 0.04, MAT.GLOW, [0.16, 0.92, 0.82], 0.85, 1.3);
    return b.build();
}

/** Active finned oil/air heat exchanger radiator with dual shroud fans and brass barbs. */
export function radiatorMesh(size) {
    const [W, H, D] = size;
    const b = new PartBuilder();
    // Dark steel outer shroud frame
    b.box(0, H * 0.46, 0, W * 0.5, H * 0.06, D * 0.5, MAT.CAST, [0.18, 0.21, 0.26], 0.62);
    b.box(0, -H * 0.46, 0, W * 0.5, H * 0.06, D * 0.5, MAT.CAST, [0.18, 0.21, 0.26], 0.46);
    b.box(-W * 0.46, 0, 0, W * 0.06, H * 0.5, D * 0.5, MAT.CAST, [0.18, 0.21, 0.26], 0.58);
    b.box(W * 0.46, 0, 0, W * 0.06, H * 0.5, D * 0.5, MAT.CAST, [0.18, 0.21, 0.26], 0.58);
    // Finned aluminum core rows
    const rows = 7;
    for (let k = 0; k < rows; k++) {
        const y = (-0.36 + (0.72 * k) / (rows - 1)) * H;
        b.box(0, y, 0, W * 0.42, H * 0.032, D * 0.40, MAT.STEEL, [0.66, 0.72, 0.78], 0.68);
    }
    // Dual circular fan shrouds on front face + brass inlet/outlet fittings
    const fr = Math.min(W * 0.20, H * 0.36);
    b.cylZ(-W * 0.22, 0, D * 0.44, fr, D * 0.16, 16, MAT.CAST, [0.14, 0.17, 0.22], 0.54, 0.60);
    b.cylZ(W * 0.22, 0, D * 0.44, fr, D * 0.16, 16, MAT.CAST, [0.14, 0.17, 0.22], 0.54, 0.60);
    b.cylY(-W * 0.36, H * 0.56, 0, D * 0.24, H * 0.14, 10, MAT.BRASS, [0.86, 0.66, 0.22], 0.74, 0.80);
    b.cylY(W * 0.36, H * 0.56, 0, D * 0.24, H * 0.14, 10, MAT.BRASS, [0.86, 0.66, 0.22], 0.74, 0.80);
    return b.build();
}

/** Double-acting hydraulic cylinder: painted steel barrel, brass hose fittings & chrome piston rod! */
export function hydraulicRamMesh(bore, stroke) {
    const r = bore * 0.64;
    const barrelLen = stroke * 0.88;
    const b = new PartBuilder();
    // Heavy industrial enamel cylinder barrel
    b.cylZ(0, 0, -stroke * 0.24, r, barrelLen, 20, MAT.ARMOR, [0.14, 0.46, 0.68], 0.62, 0.68);
    // Rear clevis mount + front gland nut
    b.box(0, 0, -stroke * 0.72, r * 0.88, r * 0.88, r * 0.65, MAT.CAST, [0.20, 0.23, 0.28], 0.54);
    b.cylZ(0, 0, stroke * 0.22, r * 1.12, r * 0.48, 18, MAT.CAST, [0.22, 0.25, 0.30], 0.62, 0.70);
    // Twin brass SAE hydraulic ports along barrel top
    b.cylY(0, r * 1.08, -stroke * 0.52, r * 0.22, r * 0.36, 10, MAT.BRASS, [0.88, 0.68, 0.22], 0.74, 0.80);
    b.cylY(0, r * 1.08, stroke * 0.08, r * 0.22, r * 0.36, 10, MAT.BRASS, [0.88, 0.68, 0.22], 0.74, 0.80);
    // Gleaming chrome piston rod extending forward + rod-end eye clevis
    b.cylZ(0, 0, stroke * 0.48, r * 0.44, stroke * 0.56, 16, MAT.STEEL, [0.84, 0.87, 0.91], 0.78, 0.84);
    b.cylX(0, 0, stroke * 0.76, r * 0.52, r * 0.85, 14, MAT.STEEL, [0.68, 0.72, 0.76], 0.68, 0.74);
    return b.build();
}

/** Precision Acme lead-screw linear actuator with bronze traveling nut carriage & twin guide rods. */
export function leadScrewMesh(d, stroke) {
    const r = d * 0.5;
    const b = new PartBuilder();
    // Threaded steel center screw
    b.cylZ(0, 0, 0, r, stroke, 16, MAT.STEEL, [0.72, 0.76, 0.80], 0.70, 0.78);
    // End bearing anchor blocks + twin chrome linear guide rods
    for (const sz of [-1, 1]) {
        b.box(0, 0, sz * stroke * 0.48, r * 2.5, r * 1.35, r * 0.8, MAT.CAST, [0.20, 0.23, 0.28], 0.58);
    }
    for (const sx of [-1, 1]) {
        b.cylZ(sx * r * 1.8, 0, 0, r * 0.48, stroke * 0.96, 12, MAT.STEEL, [0.80, 0.84, 0.88], 0.74, 0.80);
    }
    // Gleaming bronze traveling carriage nut block
    b.box(0, 0, stroke * 0.08, r * 2.35, r * 1.45, r * 1.85, MAT.BRASS, [0.82, 0.60, 0.22], 0.74);
    return b.build();
}

/** Armored continuous crawler tank track pod: drive sprocket, idler, road wheels & ribbed rubber belt! */
export function trackUnitMesh(L, H, W) {
    const r = H * 0.44;
    const span = Math.max(0.08, L - H);
    const b = new PartBuilder();
    // Armored inner bogie suspension beam
    b.box(0, 0, 0, W * 0.34, H * 0.28, span * 0.52, MAT.CAST, [0.20, 0.23, 0.28], 0.52);
    // Rear toothed steel drive sprocket & front idler wheel
    b.cylX(0, 0, -span * 0.5, r * 0.92, W * 0.88, 18, MAT.STEEL, [0.62, 0.66, 0.72], 0.66, 0.74);
    b.cylX(0, 0, span * 0.5, r * 0.88, W * 0.88, 18, MAT.STEEL, [0.56, 0.60, 0.66], 0.62, 0.70);
    // 4 lower road wheels
    for (let k = 0; k < 4; k++) {
        const z = (-0.34 + (0.68 * k) / 3) * span;
        b.cylX(0, -H * 0.22, z, r * 0.54, W * 0.84, 14, MAT.CAST, [0.26, 0.30, 0.36], 0.54, 0.62);
    }
    // Continuous rubber-cleated tank track belt (top, bottom, front/rear wraps + steel grouser ribs!)
    b.box(0, r * 0.94, 0, W * 0.50, H * 0.08, span * 0.52, MAT.RUBBER, [0.13, 0.14, 0.16], 0.50);
    b.box(0, -r * 0.94, 0, W * 0.50, H * 0.08, span * 0.52, MAT.RUBBER, [0.13, 0.14, 0.16], 0.42);
    b.cylX(0, 0, -span * 0.5, r * 1.02, W * 0.98, 18, MAT.RUBBER, [0.14, 0.15, 0.17], 0.48, 0.44);
    b.cylX(0, 0, span * 0.5, r * 1.02, W * 0.98, 18, MAT.RUBBER, [0.14, 0.15, 0.17], 0.48, 0.44);
    // Steel grouser traction cleats along top & bottom track runs
    const cleats = 8;
    for (let k = 0; k < cleats; k++) {
        const z = (-0.44 + (0.88 * k) / (cleats - 1)) * span;
        b.box(0, r * 1.04, z, W * 0.52, H * 0.03, span * 0.025, MAT.STEEL, [0.46, 0.50, 0.56], 0.72);
        b.box(0, -r * 1.04, z, W * 0.52, H * 0.03, span * 0.025, MAT.STEEL, [0.46, 0.50, 0.56], 0.48);
    }
    return b.build();
}

/** Compact high-KE vertical toothed weapon drum (rotates around X axis!). */
export function verticalDrumMesh(r) {
    const rad = Math.max(0.06, r);
    const w = rad * 2.1;
    const b = new PartBuilder();
    b.cylX(0, 0, 0, rad * 0.84, w, 22, MAT.CAST, [0.22, 0.25, 0.30], 0.54, 0.62);
    // 4 staggered hardened crimson S7 impact tooth bars along the drum circumference
    for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU;
        const y = Math.cos(a) * rad * 0.88, z = Math.sin(a) * rad * 0.88;
        b.box(0, y, z, w * 0.46, rad * 0.22, rad * 0.22, MAT.ARMOR, [0.86, 0.20, 0.14], 0.82);
        b.box(0, Math.cos(a) * rad * 1.02, Math.sin(a) * rad * 1.02, w * 0.44, rad * 0.08, rad * 0.08, MAT.STEEL, [0.84, 0.87, 0.92], 0.88);
    }
    // End bearing journals
    b.cylX(0, 0, 0, rad * 0.26, w * 1.24, 14, MAT.STEEL, [0.76, 0.80, 0.84], 0.74, 0.80);
    return b.build();
}

/** Hydraulic piercing crusher jaw beak with hardened S7 crimson fang tip & pivot clevis. */
export function crusherJawMesh(reach) {
    const r = Math.max(0.18, reach);
    const b = new PartBuilder();
    // Rear heavy pivot clevis
    b.cylX(0, 0, -r * 0.38, 0.042, 0.14, 14, MAT.CAST, [0.22, 0.25, 0.30], 0.56, 0.64);
    // Curved upper forged steel jaw beam
    b.box(0, r * 0.18, -r * 0.05, 0.036, 0.044, r * 0.42, MAT.STEEL, [0.46, 0.50, 0.56], 0.68);
    // Downward piercing S7 hardened steel fang beak!
    b.box(0, r * 0.06, r * 0.36, 0.028, r * 0.22, 0.055, MAT.ARMOR, [0.86, 0.20, 0.14], 0.82);
    b.box(0, -r * 0.14, r * 0.38, 0.016, 0.045, 0.032, MAT.STEEL, [0.86, 0.88, 0.92], 0.90);
    // Lower anvil clamping forks
    for (const sx of [-1, 1]) {
        b.box(sx * 0.14, -r * 0.22, r * 0.12, 0.024, 0.024, r * 0.45, MAT.ARMOR, [0.28, 0.32, 0.38], 0.66);
    }
    return b.build();
}

/** Low-profile Hardox AR500 launching flipper spatula with stiffener ribs & hinge knuckles. */
export function flipperSpatulaMesh(reach) {
    const r = Math.max(0.18, reach);
    const hw = r * 0.64;
    const b = new PartBuilder();
    // Sloped Hardox launcher wedge plate
    const fl = [-hw, -0.04, r * 0.56], fr = [hw, -0.04, r * 0.56];
    const tl = [-hw, 0.08, -r * 0.46], tr = [hw, 0.08, -r * 0.46];
    const bl = [-hw, -0.04, -r * 0.46], br = [hw, -0.04, -r * 0.46];
    b.quad(tl, tr, fr, fl, MAT.ARMOR, [0.86, 0.48, 0.10], 0.74);
    b.quad(bl, br, fr, fl, MAT.CAST, [0.18, 0.20, 0.25], 0.30);
    // Bright steel leading scraping blade
    b.box(0, -0.035, r * 0.57, hw, 0.010, 0.018, MAT.STEEL, [0.82, 0.85, 0.90], 0.86);
    // Twin rear hinge knuckles
    for (const sx of [-1, 1]) {
        b.cylX(sx * hw * 0.68, 0.06, -r * 0.46, 0.032, 0.055, 12, MAT.STEEL, [0.68, 0.72, 0.76], 0.68, 0.76);
    }
    return b.build();
}

/** Heavy forged tool-steel workshop forging press die platen. */
export function pressPlatenMesh(r) {
    const w = Math.max(0.16, r * 1.4);
    const b = new PartBuilder();
    b.box(0, 0, 0, w * 0.5, 0.055, w * 0.42, MAT.CAST, [0.22, 0.25, 0.30], 0.56);
    b.box(0, -0.062, 0, w * 0.46, 0.018, w * 0.38, MAT.STEEL, [0.72, 0.76, 0.80], 0.78);
    // Safety crimson trim strip on upper ram bolster
    b.box(0, 0.048, w * 0.43, w * 0.48, 0.016, 0.010, MAT.ARMOR, [0.84, 0.20, 0.14], 0.80);
    return b.build();
}

/** 90-degree spiral-bevel transfer gearbox with cutaway cast housing & meshing conical gears! */
export function bevelGearMesh(od, col = [0.64, 0.68, 0.74]) {
    const r = od * 0.46;
    const b = new PartBuilder();
    // Cutaway cast-iron L-cradle housing
    b.box(0, -r * 0.92, 0, r * 0.95, r * 0.18, r * 0.95, MAT.CAST, [0.19, 0.22, 0.27], 0.46);
    b.box(-r * 0.88, 0, 0, r * 0.14, r * 0.85, r * 0.85, MAT.CAST, [0.21, 0.24, 0.29], 0.54);
    // Input conical bevel pinion along Z
    b.cylZ(0, 0, -r * 0.56, r * 0.52, r * 0.34, 18, MAT.STEEL, shade(col, 1.06), 0.70, 0.78);
    b.cylZ(0, 0, -r * 0.32, r * 0.34, r * 0.22, 16, MAT.BRASS, [0.84, 0.64, 0.22], 0.74, 0.80);
    // Driven conical crown wheel along X (90° right-angle mesh!)
    b.cylX(r * 0.34, 0, 0.04 * r, r * 0.86, r * 0.26, 22, MAT.STEEL, col, 0.68, 0.76);
    b.cylX(r * 0.16, 0, 0.04 * r, r * 0.58, r * 0.18, 20, MAT.STEEL, shade(col, 0.88), 0.66, 0.72);
    // Transverse output axle stubs
    b.cylX(0, 0, 0.04 * r, r * 0.24, r * 2.15, 14, MAT.STEEL, [0.76, 0.80, 0.84], 0.74, 0.80);
    return b.build();
}

/** Cutaway bevel summing differential with twin side gears, bronze spider pinions & ring cage! */
export function differentialMesh(od, col = [0.64, 0.68, 0.74]) {
    const r = od * 0.48;
    const b = new PartBuilder();
    // Bolted outer cast carrier ring
    const segs = 24, pts = [];
    for (let k = 0; k < segs; k++) {
        const a = (k / segs) * TAU;
        pts.push([Math.cos(a) * r, Math.sin(a) * r, 0.68]);
    }
    b.extrudeRing(pts, r * 0.38, r * 0.72, MAT.ARMOR, [0.76, 0.38, 0.12]);
    // Open spider cage side flanges + cross pin
    b.cylZ(0, 0, -r * 0.55, r * 0.72, r * 0.22, 18, MAT.STEEL, col, 0.64, 0.72);
    b.cylZ(0, 0, r * 0.55, r * 0.72, r * 0.22, 18, MAT.STEEL, col, 0.64, 0.72);
    b.cylY(0, 0, 0, r * 0.14, r * 1.45, 12, MAT.STEEL, [0.80, 0.84, 0.88], 0.74, 0.80);
    // Gleaming bronze spider bevel pinions top & bottom
    b.cylY(0, r * 0.42, 0, r * 0.30, r * 0.24, 14, MAT.BRASS, [0.88, 0.66, 0.22], 0.78, 0.84);
    b.cylY(0, -r * 0.42, 0, r * 0.30, r * 0.24, 14, MAT.BRASS, [0.88, 0.66, 0.22], 0.78, 0.84);
    // 6 carrier bolts
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        b.boltZ(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.24, r * 0.08, r * 0.14);
    }
    return b.build();
}

/** Crank-slider stationary guide frame + split moving crank disc & reciprocating crosshead piston! */
export function crankSliderParts(throwM, rodLenM) {
    const r = Math.max(0.014, throwM);
    const L = Math.max(r * 2.4, rodLenM);

    // 1. Stationary twin-rail guide housing
    const bBase = new PartBuilder();
    bBase.box(0, -r * 1.35, L * 0.22, r * 1.45, r * 0.22, L * 0.65, MAT.CAST, [0.19, 0.22, 0.27], 0.46);
    for (const sx of [-1, 1]) {
        bBase.cylZ(sx * r * 1.1, 0, L * 0.55, r * 0.22, L * 0.85, 12, MAT.STEEL, [0.74, 0.78, 0.82], 0.70, 0.76);
    }
    bBase.box(0, 0, L * 0.96, r * 1.45, r * 0.75, r * 0.35, MAT.CAST, [0.22, 0.25, 0.30], 0.56);

    // 2. Rotating eccentric flywheel crank disc + offset bronze crankpin (spins around X!)
    const bCrank = new PartBuilder();
    bCrank.cylX(0, 0, 0, r * 1.25, r * 0.65, 22, MAT.STEEL, [0.56, 0.60, 0.66], 0.68, 0.76);
    bCrank.cylX(0, r * 0.82, 0, r * 0.28, r * 1.15, 14, MAT.BRASS, [0.90, 0.68, 0.22], 0.80, 0.86);

    // 3. Reciprocating steel crosshead piston & connecting bar (slides along Z!)
    const bPiston = new PartBuilder();
    bPiston.box(0, 0, L * 0.36, r * 0.34, r * 0.28, L * 0.42, MAT.ARMOR, [0.84, 0.22, 0.46], 0.74);
    bPiston.box(0, 0, L * 0.82, r * 0.95, r * 0.58, r * 0.72, MAT.STEEL, [0.76, 0.80, 0.84], 0.76);
    bPiston.cylZ(0, 0, L * 1.18, r * 0.36, L * 0.42, 14, MAT.STEEL, [0.84, 0.87, 0.92], 0.80, 0.86);

    return { base: bBase.build(), crank: bCrank.build(), piston: bPiston.build() };
}

/** Reciprocating hardened steel jackhammer / piledriver battering spear head! */
export function piledriverSpearMesh(reach) {
    const r = Math.max(0.16, reach);
    const b = new PartBuilder();
    b.cylZ(0, 0, -r * 0.22, 0.032, r * 0.55, 16, MAT.STEEL, [0.72, 0.76, 0.80], 0.70, 0.78);
    b.cylZ(0, 0, r * 0.16, 0.048, r * 0.26, 12, MAT.ARMOR, [0.86, 0.20, 0.14], 0.78, 0.84);
    // Forged chisel battering spike tip
    b.box(0, 0, r * 0.44, 0.022, 0.038, r * 0.22, MAT.STEEL, [0.84, 0.87, 0.92], 0.88);
    return b.build();
}

/** High-speed fluted CNC milling spindle & carbide endmill head! */
export function millSpindleMesh(r) {
    const rad = Math.max(0.05, r);
    const b = new PartBuilder();
    // Machined vertical spindle cartridge & collet chuck
    b.cylY(0, rad * 0.55, 0, rad * 0.78, rad * 1.35, 20, MAT.CAST, [0.20, 0.23, 0.28], 0.56, 0.64);
    b.cylY(0, -rad * 0.28, 0, rad * 0.52, rad * 0.48, 16, MAT.STEEL, [0.74, 0.78, 0.82], 0.72, 0.78);
    // Golden TiN-coated carbide fluted milling cutter!
    b.cylY(0, -rad * 0.82, 0, rad * 0.30, rad * 0.78, 12, MAT.BRASS, [0.92, 0.74, 0.24], 0.82, 0.88);
    return b.build();
}

/** Industrial hydraulic forklift mast & twin forged lifting forks! */
export function forkLifterMesh(reach) {
    const r = Math.max(0.18, reach);
    const hw = r * 0.58;
    const b = new PartBuilder();
    // Twin vertical I-channel mast rails + carriage backrest
    for (const sx of [-1, 1]) {
        b.box(sx * hw * 0.82, r * 0.14, -r * 0.38, 0.022, r * 0.42, 0.028, MAT.CAST, [0.19, 0.22, 0.27], 0.56);
        b.cylX(sx * hw * 0.82, r * 0.48, -r * 0.38, 0.026, 0.036, 12, MAT.BRASS, [0.84, 0.64, 0.22], 0.72, 0.78);
    }
    b.box(0, r * 0.18, -r * 0.36, hw * 0.92, 0.024, 0.022, MAT.STEEL, [0.58, 0.62, 0.68], 0.68);
    b.box(0, -r * 0.06, -r * 0.36, hw * 0.92, 0.032, 0.026, MAT.ARMOR, [0.88, 0.54, 0.12], 0.76);
    // Twin heavy tapered forged steel lifting forks + hazard-amber tips
    for (const sx of [-1, 1]) {
        const fx = sx * hw * 0.62;
        b.box(fx, -r * 0.08, -r * 0.32, 0.026, r * 0.18, 0.020, MAT.STEEL, [0.56, 0.60, 0.66], 0.68);
        b.box(fx, -r * 0.22, r * 0.06, 0.028, 0.018, r * 0.42, MAT.STEEL, [0.64, 0.68, 0.74], 0.74);
        b.box(fx, -r * 0.23, r * 0.48, 0.026, 0.011, r * 0.10, MAT.ARMOR, [0.92, 0.56, 0.10], 0.84);
    }
    return b.build();
}

/** Dual-jaw articulated sumo grapple clamp with opposing serrated pincers & yoke! */
export function grappleClawMesh(reach) {
    const r = Math.max(0.18, reach);
    const hw = r * 0.52;
    const b = new PartBuilder();
    // Heavy cast pivot crossbar & central hydraulic yoke
    b.box(0, 0, -r * 0.34, hw * 0.95, 0.034, 0.042, MAT.CAST, [0.20, 0.23, 0.28], 0.56);
    b.cylY(0, 0.045, -r * 0.34, 0.032, 0.055, 14, MAT.BRASS, [0.84, 0.64, 0.22], 0.74, 0.80);
    // Left & right forged pincer arms curving inward with serrated teeth
    for (const sx of [-1, 1]) {
        b.cylY(sx * hw * 0.84, 0, -r * 0.32, 0.034, 0.075, 14, MAT.STEEL, [0.68, 0.72, 0.76], 0.70, 0.78);
        b.box(sx * hw * 0.86, 0, r * 0.04, 0.024, 0.032, r * 0.38, MAT.ARMOR, [0.24, 0.56, 0.72], 0.72);
        b.box(sx * hw * 0.56, 0, r * 0.42, hw * 0.34, 0.028, 0.026, MAT.STEEL, [0.76, 0.80, 0.84], 0.80);
        // Serrated clamping grip pads along inner jaw face
        for (let k = 0; k < 3; k++) {
            b.box(sx * (hw * 0.72), 0, -r * 0.08 + k * r * 0.16, 0.018, 0.026, 0.022, MAT.ARMOR, [0.88, 0.54, 0.12], 0.80);
        }
    }
    // Overhead hold-down stabilizing arch
    b.box(0, r * 0.16, -r * 0.06, 0.026, 0.022, r * 0.36, MAT.STEEL, [0.62, 0.66, 0.72], 0.72);
    return b.build();
}

/** Heavy grooved steel cable winch drum with braided wire rope coils & side worm flange! */
export function winchDrumMesh(r) {
    const rad = Math.max(0.06, r);
    const w = rad * 1.95;
    const b = new PartBuilder();
    // Side cast-iron drum retention cheeks
    for (const sx of [-1, 1]) {
        b.cylX(sx * w * 0.46, 0, 0, rad * 0.98, w * 0.10, 24, MAT.CAST, [0.22, 0.25, 0.30], 0.56, 0.64);
    }
    // Wrapped braided steel wire-rope cable coils across spool barrel
    const coils = 7;
    for (let k = 0; k < coils; k++) {
        const x = (-0.36 + (0.72 * k) / (coils - 1)) * w;
        const c = k % 2 === 0 ? [0.56, 0.60, 0.66] : [0.46, 0.50, 0.56];
        b.cylX(x, 0, 0, rad * 0.78, w * 0.095, 22, MAT.STEEL, c, 0.62, 0.70);
    }
    // Drive-side golden bronze bull flange + shaft journals
    b.cylX(-w * 0.54, 0, 0, rad * 0.62, w * 0.08, 18, MAT.BRASS, [0.84, 0.64, 0.22], 0.74, 0.80);
    b.cylX(0, 0, 0, rad * 0.24, w * 1.32, 14, MAT.STEEL, [0.76, 0.80, 0.84], 0.74, 0.80);
    // Hanging forged crimson safety hook & clevis below spool
    b.box(0, -rad * 1.05, rad * 0.15, rad * 0.14, rad * 0.22, rad * 0.14, MAT.ARMOR, [0.88, 0.46, 0.10], 0.80);
    return b.build();
}

/** Spring-wound counterweight catapult / trebuchet throwing arm with cupped launch cradle! */
export function trebuchetArmMesh(reach) {
    const r = Math.max(0.20, reach);
    const b = new PartBuilder();
    // Main pivot trunnion shaft & brass bushing collar
    b.cylX(0, 0, 0, 0.044, 0.16, 16, MAT.BRASS, [0.86, 0.66, 0.22], 0.74, 0.80);
    // Long structural truss throwing beam (forward arm + rear counterweight tail)
    b.box(0, 0.02, r * 0.12, 0.032, 0.034, r * 0.62, MAT.STEEL, [0.58, 0.62, 0.68], 0.70);
    // Heavy cast-iron counterweight blocks bolted to the rear tail
    b.box(0, 0.02, -r * 0.44, 0.095, 0.072, 0.075, MAT.CAST, [0.18, 0.21, 0.26], 0.56);
    b.box(0, 0.02, -r * 0.44, 0.105, 0.022, 0.050, MAT.ARMOR, [0.88, 0.54, 0.12], 0.76);
    // Cupped Hardox throwing scoop cradle at the front tip
    b.box(0, 0.02, r * 0.68, 0.125, 0.018, 0.095, MAT.ARMOR, [0.88, 0.50, 0.10], 0.78);
    b.box(-0.115, 0.055, r * 0.68, 0.014, 0.042, 0.095, MAT.STEEL, [0.74, 0.78, 0.82], 0.76);
    b.box(0.115, 0.055, r * 0.68, 0.014, 0.042, 0.095, MAT.STEEL, [0.74, 0.78, 0.82], 0.76);
    return b.build();
}

/** Articulated industrial hydraulic excavator boom, dipper stick, cylinder & toothed digging bucket! */
export function excavatorBoomMesh(reach) {
    const r = Math.max(0.28, reach);
    const b = new PartBuilder();
    // Base boom pivot trunnion
    b.cylX(0, -r * 0.22, -r * 0.42, 0.052, 0.18, 16, MAT.CAST, [0.20, 0.23, 0.28], 0.56, 0.64);
    // Rising yellow/amber box-section main boom girder
    b.box(0, r * 0.10, -r * 0.20, 0.046, r * 0.36, 0.058, MAT.ARMOR, [0.90, 0.58, 0.08], 0.76);
    b.box(0, r * 0.36, r * 0.04, 0.044, 0.056, r * 0.28, MAT.ARMOR, [0.90, 0.58, 0.08], 0.78);
    // Hydraulic stick cylinder mounted along top of main boom
    b.cylZ(0, r * 0.46, -r * 0.04, 0.026, r * 0.40, 14, MAT.ARMOR, [0.16, 0.44, 0.74], 0.68, 0.76);
    b.cylZ(0, r * 0.46, r * 0.22, 0.014, r * 0.22, 12, MAT.STEEL, [0.84, 0.87, 0.92], 0.84, 0.90);
    // Knee pin + downward-angled dipper stick arm
    b.cylX(0, r * 0.36, r * 0.30, 0.040, 0.15, 14, MAT.BRASS, [0.86, 0.66, 0.22], 0.74, 0.80);
    b.box(0, r * 0.04, r * 0.36, 0.036, r * 0.32, 0.046, MAT.ARMOR, [0.86, 0.54, 0.08], 0.74);
    // Heavy curved dark-steel digging bucket + 4 forged teeth!
    b.box(0, -r * 0.28, r * 0.38, r * 0.20, 0.095, 0.105, MAT.CAST, [0.22, 0.25, 0.30], 0.58);
    b.box(0, -r * 0.36, r * 0.28, r * 0.20, 0.020, 0.12, MAT.STEEL, [0.58, 0.62, 0.68], 0.70);
    for (let k = 0; k < 4; k++) {
        const tx = (-0.75 + (1.5 * k) / 3) * r * 0.20;
        b.box(tx, -r * 0.37, r * 0.16, 0.016, 0.016, 0.042, MAT.STEEL, [0.82, 0.85, 0.90], 0.86);
    }
    return b.build();
}

/** Vertical helical earth/rock core-boring auger with stacked spiral flights & carbide pilot bit! */
export function augerDrillMesh(r) {
    const rad = Math.max(0.06, r);
    const h = rad * 3.8;
    const b = new PartBuilder();
    // Upper hexagonal drive chuck + central forged drill stem
    b.cylY(0, h * 0.46, 0, rad * 0.44, h * 0.14, 6, MAT.CAST, [0.20, 0.23, 0.28], 0.58, 0.66);
    b.cylY(0, 0, 0, rad * 0.24, h * 0.92, 16, MAT.STEEL, [0.64, 0.68, 0.74], 0.70, 0.78);
    // Helical stepped spiral cutting flights descending the auger stem
    const flights = 14;
    for (let k = 0; k < flights; k++) {
        const t = k / (flights - 1);
        const y = (0.36 - t * 0.74) * h;
        const a = k * 0.85;
        const fr = rad * (0.94 - t * 0.16);
        b.box(Math.cos(a) * fr * 0.46, y, Math.sin(a) * fr * 0.46, fr * 0.56, h * 0.022, rad * 0.36,
            MAT.ARMOR, [0.88, 0.52, 0.10], 0.76);
    }
    // Tungsten-carbide tapered rock pilot bit at bottom tip
    b.cylY(0, -h * 0.46, 0, rad * 0.34, h * 0.12, 12, MAT.STEEL, [0.82, 0.86, 0.90], 0.84, 0.90);
    b.cylY(0, -h * 0.54, 0, rad * 0.14, h * 0.08, 8, MAT.BRASS, [0.90, 0.72, 0.24], 0.86, 0.92);
    return b.build();
}

/** Precision 3-jaw self-centering foundry lathe chuck gripping a turned steel/brass billet! */
export function latheChuckMesh(r) {
    const rad = Math.max(0.06, r);
    const b = new PartBuilder();
    // Heavy machined cast-steel chuck body
    b.cylZ(0, 0, -rad * 0.45, rad * 0.96, rad * 0.88, 26, MAT.STEEL, [0.58, 0.62, 0.68], 0.66, 0.74);
    b.cylZ(0, 0, -rad * 0.96, rad * 0.64, rad * 0.24, 20, MAT.CAST, [0.22, 0.25, 0.30], 0.56, 0.64);
    // 3 radially spaced stepped hardened clamping jaws (120° apart)
    for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU;
        b.box(Math.cos(a) * rad * 0.64, Math.sin(a) * rad * 0.64, rad * 0.14, rad * 0.24, rad * 0.24, rad * 0.42,
            MAT.CAST, [0.24, 0.27, 0.32], 0.62);
        b.box(Math.cos(a) * rad * 0.48, Math.sin(a) * rad * 0.48, rad * 0.34, rad * 0.18, rad * 0.18, rad * 0.22,
            MAT.STEEL, [0.76, 0.80, 0.84], 0.78);
    }
    // Turned gleaming bronze/steel workpiece shaft clamped in jaws!
    b.cylZ(0, 0, rad * 0.85, rad * 0.32, rad * 1.45, 22, MAT.BRASS, [0.88, 0.68, 0.24], 0.78, 0.84);
    b.cylZ(0, 0, rad * 1.55, rad * 0.22, rad * 0.42, 20, MAT.STEEL, [0.80, 0.84, 0.88], 0.82, 0.88);
    return b.build();
}

/** Articulated twin bipedal hydraulic walking mech leg assembly (hip clevises, thighs, knee rams, shins & armored feet)! */
export function mechLegsMesh(reach) {
    const r = Math.max(0.26, reach);
    const hipX = r * 0.44;
    const b = new PartBuilder();
    // Central pelvis bridge bar
    b.box(0, r * 0.56, 0, hipX * 1.05, 0.042, 0.075, MAT.CAST, [0.20, 0.23, 0.28], 0.56);
    for (const sx of [-1, 1]) {
        const lx = sx * hipX;
        // Hip rotary actuator drum
        b.cylX(lx, r * 0.56, 0, 0.068, 0.11, 18, MAT.ARMOR, [0.88, 0.54, 0.12], 0.74, 0.80);
        // Upper thigh structural strut (angled slightly forward)
        b.box(lx, r * 0.28, 0.045, 0.042, r * 0.28, 0.052, MAT.STEEL, [0.56, 0.60, 0.66], 0.70);
        // Hydraulic thigh-to-knee actuator cylinder
        b.cylY(lx + sx * 0.055, r * 0.26, 0.01, 0.022, r * 0.36, 12, MAT.ARMOR, [0.16, 0.46, 0.76], 0.68, 0.76);
        // Knee pivot drum + brass trunnion pin
        b.cylX(lx, 0, 0.09, 0.052, 0.11, 16, MAT.BRASS, [0.86, 0.66, 0.22], 0.74, 0.80);
        // Lower shin twin-spar truss (angled slightly back to center of mass)
        b.box(lx, -r * 0.28, 0.02, 0.036, r * 0.28, 0.046, MAT.STEEL, [0.64, 0.68, 0.74], 0.72);
        // Ankle stabilizer piston
        b.cylY(lx - sx * 0.042, -r * 0.26, -0.02, 0.016, r * 0.32, 10, MAT.STEEL, [0.80, 0.84, 0.88], 0.80, 0.86);
        // Wide articulated armored mech foot pad + rubber tread sole!
        b.box(lx, -r * 0.58, 0.04, 0.088, 0.030, 0.155, MAT.CAST, [0.22, 0.25, 0.30], 0.58);
        b.box(lx, -r * 0.62, 0.04, 0.092, 0.014, 0.162, MAT.RUBBER, [0.13, 0.14, 0.16], 0.44);
        b.box(lx, -r * 0.56, 0.18, 0.072, 0.022, 0.032, MAT.ARMOR, [0.88, 0.54, 0.12], 0.78);
    }
    return b.build();
}
