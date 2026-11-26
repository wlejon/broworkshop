// lib/machine/meshes.js — High-detail procedural mechanical PBR meshes
// (bro.mesh.Mesh with RGBA vertex colors for metallic rendering):
// sloped armored hulls, angled turrets with optics & cupolas, spoked gears,
// deep-dish armored road wheels, armored wheel sponsons, articulated mech
// legs with pistons & clawed feet, fluted muzzle-braked cannons, torsion
// coils, spoked flywheels, sloped tungsten dozer plows, and bearing hubs.

function makeBuilder() {
    const P = [], N = [], C = [], I = [];
    const pushV = (p, n, c) => {
        P.push(p[0], p[1], p[2]);
        N.push(n[0], n[1], n[2]);
        C.push(c[0], c[1], c[2], 1);
    };
    const tri = (a, b, c, col) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const base = P.length / 3;
        const n = [nx, ny, nz];
        pushV(a, n, col); pushV(b, n, col); pushV(c, n, col);
        I.push(base, base + 1, base + 2);
    };
    const quad = (a, b, c, d, wantN, col) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        const cl = Math.hypot(cx, cy, cz) || 1;
        const nl = Math.hypot(wantN[0], wantN[1], wantN[2]) || 1;
        const n = [wantN[0] / nl, wantN[1] / nl, wantN[2] / nl];
        const base = P.length / 3;
        pushV(a, n, col); pushV(b, n, col); pushV(c, n, col); pushV(d, n, col);
        if ((cx * n[0] + cy * n[1] + cz * n[2]) / cl >= 0) {
            I.push(base, base + 1, base + 2, base, base + 2, base + 3);
        } else {
            I.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
    };
    const box = (x0, y0, z0, x1, y1, z1, col) => {
        quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], col);
        quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], col);
        quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], col);
        quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], col);
        quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col);
        quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], col);
    };
    // Tapered chamfered box prism: top footprint (tx,tz) and bottom (bx,bz)
    const taperedBox = (y0, y1, bx, bz, tx, tz, col) => {
        const b0 = [-bx, y0, -bz], b1 = [bx, y0, -bz], b2 = [bx, y0, bz], b3 = [-bx, y0, bz];
        const t0 = [-tx, y1, -tz], t1 = [tx, y1, -tz], t2 = [tx, y1, tz], t3 = [-tx, y1, tz];
        quad(t0, t3, t2, t1, [0, 1, 0], col);
        quad(b0, b1, b2, b3, [0, -1, 0], col);
        quad(b0, t0, t1, b1, [0, 0.35, -0.94], col);
        quad(b2, t2, t3, b3, [0, 0.35, 0.94], col);
        quad(b1, t1, t2, b2, [0.94, 0.35, 0], col);
        quad(b3, t3, t0, b0, [-0.94, 0.35, 0], col);
    };
    const frustum = (y0, y1, rx0, rz0, rx1, rz1, seg, col, cap0 = true, cap1 = true, cx = 0, cz = 0) => {
        for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
            const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
            const p00 = [cx + rx0 * c0, y0, cz + rz0 * s0], p10 = [cx + rx0 * c1, y0, cz + rz0 * s1];
            const p01 = [cx + rx1 * c0, y1, cz + rz1 * s0], p11 = [cx + rx1 * c1, y1, cz + rz1 * s1];
            const am = 0.5 * (a0 + a1);
            quad(p00, p01, p11, p10, [Math.cos(am), 0, Math.sin(am)], col);
            if (cap0) tri([cx, y0, cz], p00, p10, col);
            if (cap1) tri([cx, y1, cz], p11, p01, col);
        }
    };
    // Cylinder along X axis
    const cylX = (x0, x1, r0, r1, seg, col, cy = 0, cz = 0) => {
        for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
            const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
            const p00 = [x0, cy + r0 * c0, cz + r0 * s0], p10 = [x0, cy + r0 * c1, cz + r0 * s1];
            const p01 = [x1, cy + r1 * c0, cz + r1 * s0], p11 = [x1, cy + r1 * c1, cz + r1 * s1];
            const am = 0.5 * (a0 + a1);
            quad(p00, p10, p11, p01, [0, Math.cos(am), Math.sin(am)], col);
            tri([x0, cy, cz], p10, p00, col);
            tri([x1, cy, cz], p01, p11, col);
        }
    };
    const build = () => new bro.mesh.Mesh({
        positions: new Float32Array(P), normals: new Float32Array(N),
        colors: new Float32Array(C), indices: new Uint32Array(I),
    });
    return { tri, quad, box, taperedBox, frustum, cylX, build };
}

const mulRgb = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

export function chamferedBoxMesh(hx, hy, hz, baseRgb = [0.84, 0.86, 0.90]) {
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.46);
    const mid = mulRgb(baseRgb, 0.78);
    const lite = mulRgb(baseRgb, 1.06);
    const accent = [0.88, 0.62, 0.22];
    const ch = Math.min(hx, hy, hz) * 0.20;

    // Sculpted lower belly taper + wide mid-belt + sloped upper deck armor
    b.taperedBox(-hy, -hy + ch, hx * 0.86, hz * 0.88, hx, hz, dark);
    b.box(-hx, -hy + ch, -hz, hx, hy - ch, hz, baseRgb);
    b.taperedBox(hy - ch, hy, hx, hz, hx * 0.88, hz * 0.90, lite);

    // Side structural armor belt & bolted corner brackets
    if (hy > 0.22 && hz > 0.65) {
        b.box(-hx * 1.03, -hy * 0.18, -hz * 0.86, hx * 1.03, hy * 0.18, hz * 0.86, mid);
        const boltSteps = Math.min(4, Math.max(2, Math.floor(hz * 1.4)));
        for (let i = 0; i < boltSteps; i++) {
            const zc = -hz * 0.68 + (i / (boltSteps - 1)) * (hz * 1.36);
            b.box(-hx * 1.06, -hy * 0.08, zc - 0.06, hx * 1.06, hy * 0.08, zc + 0.06, dark);
        }
        // Rear engine deck louver grilles (+Z) & front tow shackles (-Z)
        for (let i = 0; i < 3; i++) {
            const zg = hz * 0.25 + i * hz * 0.18;
            b.box(-hx * 0.62, hy * 0.96, zg - 0.05, hx * 0.62, hy * 1.04, zg + 0.05, dark);
        }
        b.box(-hx * 0.72, -hy * 0.15, -hz * 1.04, -hx * 0.54, hy * 0.15, -hz * 0.96, accent);
        b.box(hx * 0.54, -hy * 0.15, -hz * 1.04, hx * 0.72, hy * 0.15, -hz * 0.96, accent);
    }
    return b.build();
}

export function turretMesh(hx, hy, hz, baseRgb = [0.86, 0.88, 0.92]) {
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.44);
    const mid = mulRgb(baseRgb, 0.74);
    const lite = mulRgb(baseRgb, 1.06);
    const optic = [0.16, 0.78, 0.95];
    const brass = [0.88, 0.64, 0.22];

    // Heavy lower turret collar + sloped angled cheek armor housing
    b.taperedBox(-hy, -hy * 0.35, hx * 0.92, hz * 0.92, hx, hz, dark);
    b.taperedBox(-hy * 0.35, hy * 0.85, hx, hz, hx * 0.78, hz * 0.82, baseRgb);
    b.taperedBox(hy * 0.85, hy * 1.05, hx * 0.78, hz * 0.82, hx * 0.68, hz * 0.72, lite);

    // Armored front mantlet block (-Z) & optical rangefinder visor
    b.box(-hx * 0.58, -hy * 0.25, -hz * 1.05, hx * 0.58, hy * 0.52, -hz * 0.68, mid);
    b.box(-hx * 0.44, hy * 0.54, -hz * 0.86, -hx * 0.12, hy * 0.74, -hz * 0.62, dark);
    b.box(-hx * 0.40, hy * 0.59, -hz * 0.89, -hx * 0.16, hy * 0.69, -hz * 0.83, optic);

    // Rear bustle ammo rack (+Z) with protective bars
    b.box(-hx * 0.74, -hy * 0.10, hz * 0.76, hx * 0.74, hy * 0.55, hz * 1.12, mid);
    b.box(-hx * 0.78, hy * 0.48, hz * 0.82, hx * 0.78, hy * 0.60, hz * 1.15, dark);

    // Commander's circular cupola hatch + brass pivot ring on roof
    b.frustum(hy * 0.95, hy * 1.24, hx * 0.28, hx * 0.28, hx * 0.24, hx * 0.24, 14, mid, true, true, hx * 0.30, hz * 0.18);
    b.frustum(hy * 1.20, hy * 1.30, hx * 0.18, hx * 0.18, hx * 0.16, hx * 0.16, 12, brass, true, true, hx * 0.30, hz * 0.18);
    return b.build();
}

export function sponsonBogieMesh(hx, hy, hz, baseRgb = [0.80, 0.83, 0.88]) {
    // Armored wheel-carrier mudguard & side rocker girder wrapping suspension bogie
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.45);
    const mid = mulRgb(baseRgb, 0.76);
    const brass = [0.86, 0.62, 0.22];

    // Upper sloped armored mudguard deck
    b.taperedBox(hy * 0.10, hy * 1.05, hx * 1.12, hz * 1.08, hx * 0.92, hz * 0.96, baseRgb);
    // Heavy inner structural rocker beam
    b.box(-hx * 0.65, -hy * 0.95, -hz * 0.92, hx * 0.65, hy * 0.15, hz * 0.92, dark);
    // Side protective armor skirt with recessed wheel-arch notches
    b.box(-hx * 1.12, -hy * 0.38, -hz * 1.04, hx * 1.12, hy * 0.25, hz * 1.04, mid);
    // Front & rear sloped mud-flaps + 3 bolted shock mounts
    b.box(-hx * 1.08, -hy * 0.85, -hz * 1.12, hx * 1.08, hy * 0.12, -hz * 0.96, dark);
    b.box(-hx * 1.08, -hy * 0.85, hz * 0.96, hx * 1.08, hy * 0.12, hz * 1.12, dark);
    for (const zc of [-hz * 0.68, 0, hz * 0.68]) {
        b.box(-hx * 1.16, -hy * 0.15, zc - 0.08, hx * 1.16, hy * 0.35, zc + 0.08, brass);
    }
    return b.build();
}

export function mechLegMesh(hx, hy, hz, baseRgb = [0.82, 0.85, 0.90]) {
    // Articulated armored mech leg strut: twin heavy plates, hydraulic actuator rod, knee shield
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.44);
    const mid = mulRgb(baseRgb, 0.74);
    const chrome = [0.92, 0.94, 0.98];
    const brass = [0.88, 0.64, 0.22];

    // Inner load-bearing spine
    b.box(-hx * 0.62, -hy * 0.96, -hz * 0.56, hx * 0.62, hy * 0.96, hz * 0.56, dark);
    // Twin armored side cheeks
    b.taperedBox(-hy * 0.88, hy * 0.88, hx * 0.96, hz * 0.88, hx * 1.06, hz * 1.02, baseRgb);
    // Front armored shin/thigh shield plate (-Z)
    b.taperedBox(-hy * 0.72, hy * 0.78, hx * 0.84, hz * 0.42, hx * 0.94, hz * 0.52, mid);
    b.box(-hx * 0.78, hy * 0.42, -hz * 1.14, hx * 0.78, hy * 0.92, -hz * 0.78, baseRgb);
    // Rear hydraulic actuator cylinder + bright chrome piston rod (+Z)
    b.frustum(-hy * 0.15, hy * 0.80, hx * 0.36, hx * 0.36, hx * 0.36, hx * 0.36, 10, brass, true, true, 0, hz * 0.96);
    b.frustum(-hy * 0.82, -hy * 0.10, hx * 0.20, hx * 0.20, hx * 0.20, hx * 0.20, 10, chrome, true, true, 0, hz * 0.96);
    // Top & bottom clevis bearing collars
    b.cylX(-hx * 1.24, hx * 1.24, hz * 0.56, hz * 0.56, 12, dark, hy * 0.82, 0);
    b.cylX(-hx * 1.20, hx * 1.20, hz * 0.52, hz * 0.52, 12, dark, -hy * 0.82, 0);
    return b.build();
}

export function mechFootMesh(hx, hy, hz, baseRgb = [0.68, 0.72, 0.78]) {
    // Wide armored 3-toed mechanical walker foot with tungsten traction cleats
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.46);
    const lite = mulRgb(baseRgb, 1.06);
    const brass = [0.88, 0.62, 0.22];

    // Central ankle block + sloped armored foot carapace
    b.taperedBox(-hy, hy * 0.65, hx * 0.96, hz * 0.74, hx * 0.72, hz * 0.56, baseRgb);
    b.taperedBox(hy * 0.55, hy * 1.35, hx * 0.56, hz * 0.44, hx * 0.44, hz * 0.36, lite);
    // Twin forward articulated toe pads (-Z)
    b.taperedBox(-hy, hy * 0.25, hx * 0.38, hz * 0.36, hx * 0.30, hz * 0.26, dark);
    b.box(-hx * 0.96, -hy, -hz * 1.06, -hx * 0.22, hy * 0.15, -hz * 0.48, baseRgb);
    b.box(hx * 0.22, -hy, -hz * 1.06, hx * 0.96, hy * 0.15, -hz * 0.48, baseRgb);
    // Rear stabilizer heel spur (+Z)
    b.box(-hx * 0.48, -hy, hz * 0.46, hx * 0.48, hy * 0.15, hz * 1.05, dark);
    // Toe hinge accent bars
    b.box(-hx * 0.98, -hy * 0.2, -hz * 0.56, hx * 0.98, hy * 0.12, -hz * 0.42, brass);
    return b.build();
}

export function trussBeamMesh(hx, hy, hz, baseRgb = [0.82, 0.85, 0.90]) {
    const b = makeBuilder();
    const web = mulRgb(baseRgb, 0.46);
    const flange = mulRgb(baseRgb, 1.04);
    const rivet = [0.86, 0.64, 0.24];
    const axis = hx >= hy && hx >= hz ? 0 : hy >= hz ? 1 : 2;
    if (axis === 1) {
        b.box(-hx, -hy, -hz, hx, hy, -hz * 0.44, flange);
        b.box(-hx, -hy, hz * 0.44, hx, hy, hz, flange);
        b.box(-hx * 0.52, -hy, -hz * 0.44, hx * 0.52, hy, hz * 0.44, web);
        b.box(-hx * 1.06, -hy * 0.92, -hz * 1.06, hx * 1.06, -hy * 0.68, hz * 1.06, baseRgb);
        b.box(-hx * 1.06, hy * 0.68, -hz * 1.06, hx * 1.06, hy * 0.92, hz * 1.06, baseRgb);
    } else if (axis === 2) {
        b.box(-hx, hy * 0.44, -hz, hx, hy, hz, flange);
        b.box(-hx, -hy, -hz, hx, -hy * 0.44, hz, flange);
        b.box(-hx * 0.52, -hy * 0.44, -hz, hx * 0.52, hy * 0.44, hz, web);
        for (let k = -2; k <= 2; k++) {
            const zc = k * hz * 0.38;
            b.box(-hx * 1.05, -hy * 0.92, zc - 0.055, hx * 1.05, hy * 0.92, zc + 0.055, k === 0 ? rivet : baseRgb);
        }
    } else {
        b.box(-hx, hy * 0.44, -hz, hx, hy, hz, flange);
        b.box(-hx, -hy, -hz, hx, -hy * 0.44, hz, flange);
        b.box(-hx, -hy * 0.44, -hz * 0.52, hx, hy * 0.44, hz * 0.52, web);
        for (let k = -1; k <= 1; k++) {
            const xc = k * hx * 0.55;
            b.box(xc - 0.055, -hy * 0.92, -hz * 1.05, xc + 0.055, hy * 0.92, hz * 1.05, baseRgb);
        }
    }
    return b.build();
}

export function toothedGearMesh(radius, halfThick, teeth = 16, baseRgb = [0.90, 0.72, 0.36]) {
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.56);
    const rimCol = mulRgb(baseRgb, 1.05);
    const hub = [0.76, 0.80, 0.86];
    const rRoot = radius * 0.80, rTip = radius;

    // Recessed web disc + raised outer gear rim + machined steel shaft hub
    b.frustum(-halfThick * 0.62, halfThick * 0.62, rRoot * 0.86, rRoot * 0.86, rRoot * 0.86, rRoot * 0.86, Math.max(16, teeth), dark, true, true);
    b.frustum(-halfThick, halfThick, rRoot, rRoot, rRoot, rRoot, Math.max(16, teeth * 2), rimCol, true, true);
    b.frustum(-halfThick * 1.28, halfThick * 1.28, radius * 0.34, radius * 0.34, radius * 0.34, radius * 0.34, 16, hub, true, true);
    b.frustum(-halfThick * 1.42, halfThick * 1.42, radius * 0.16, radius * 0.16, radius * 0.16, radius * 0.16, 12, [0.24, 0.27, 0.32], true, true);

    // 4 radial lightening spokes across the face
    for (let s = 0; s < 4; s++) {
        const a = (s / 4) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a), tx = -sa, tz = ca;
        const r0 = radius * 0.30, r1 = rRoot * 0.94, w = radius * 0.08;
        const y0 = -halfThick * 0.92, y1 = halfThick * 0.92;
        const p0 = [ca * r0 - tx * w, y1, sa * r0 - tz * w], p1 = [ca * r0 + tx * w, y1, sa * r0 + tz * w];
        const p2 = [ca * r1 + tx * w, y1, sa * r1 + tz * w], p3 = [ca * r1 - tx * w, y1, sa * r1 - tz * w];
        b.quad(p0, p1, p2, p3, [0, 1, 0], rimCol);
        b.quad([p0[0], y0, p0[2]], [p3[0], y0, p3[2]], [p2[0], y0, p2[2]], [p1[0], y0, p1[2]], [0, -1, 0], rimCol);
    }

    // Solid enclosed involute-style gear teeth
    const tw = (2 * Math.PI * rRoot / teeth) * 0.34;
    const hT = rTip - rRoot * 0.90;
    for (let i = 0; i < teeth; i++) {
        const ang = (i / teeth) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const rc = rRoot + hT * 0.44;
        const tx = -sa, tz = ca;
        const cx = ca * rc, cz = sa * rc;
        const y0 = -halfThick * 0.96, y1 = halfThick * 0.96;
        const p00 = [cx - tx * tw - ca * hT * 0.5, y0, cz - tz * tw - sa * hT * 0.5];
        const p10 = [cx + tx * tw - ca * hT * 0.5, y0, cz + tz * tw - sa * hT * 0.5];
        const p01 = [cx - tx * tw * 0.66 + ca * hT * 0.5, y0, cz - tz * tw * 0.66 + sa * hT * 0.5];
        const p11 = [cx + tx * tw * 0.66 + ca * hT * 0.5, y0, cz + tz * tw * 0.66 + sa * hT * 0.5];
        const q00 = [p00[0], y1, p00[2]], q10 = [p10[0], y1, p10[2]];
        const q01 = [p01[0], y1, p01[2]], q11 = [p11[0], y1, p11[2]];
        b.quad(q00, q10, q11, q01, [0, 1, 0], rimCol);
        b.quad(p00, p01, p11, p10, [0, -1, 0], rimCol);
        b.quad(p01, q01, q11, p11, [ca, 0, sa], dark);
        b.quad(p00, q00, q01, p01, [-tx, 0, -tz], dark);
        b.quad(p10, p11, q11, q10, [tx, 0, tz], dark);
    }
    return b.build();
}

export function flywheelMesh(radius, halfThick) {
    // High-density tungsten kinetic rotor with copper-amber energy rim band & steel hub
    const b = makeBuilder();
    const dark = [0.28, 0.31, 0.36];
    const rim = [0.46, 0.50, 0.56];
    const band = [0.92, 0.60, 0.18];
    const hub = [0.80, 0.84, 0.90];
    b.frustum(-halfThick, halfThick, radius * 0.96, radius * 0.96, radius * 0.96, radius * 0.96, 24, dark, true, true);
    b.frustum(-halfThick * 0.52, halfThick * 0.52, radius * 1.02, radius * 1.02, radius * 1.02, radius * 1.02, 24, band, true, true);
    b.frustum(-halfThick * 1.08, halfThick * 1.08, radius * 0.68, radius * 0.68, radius * 0.68, radius * 0.68, 18, rim, true, true);
    b.frustum(-halfThick * 1.24, halfThick * 1.24, radius * 0.30, radius * 0.30, radius * 0.30, radius * 0.30, 14, hub, true, true);
    return b.build();
}

export function armoredWheelMesh(radius, halfWidth) {
    const b = makeBuilder();
    const tire = [0.20, 0.22, 0.25];
    const tread = [0.13, 0.14, 0.17];
    const rim = [0.66, 0.70, 0.76];
    const dish = [0.38, 0.42, 0.48];
    const hub = [0.90, 0.64, 0.22];

    // Heavy tire carcass + deep-dish armored road wheel + bolted bronze center hub
    b.frustum(-halfWidth, halfWidth, radius * 0.94, radius * 0.94, radius * 0.94, radius * 0.94, 24, tire, true, true);
    b.frustum(-halfWidth * 1.05, halfWidth * 1.05, radius * 0.68, radius * 0.68, radius * 0.68, radius * 0.68, 20, rim, true, true);
    b.frustum(-halfWidth * 1.08, halfWidth * 1.08, radius * 0.50, radius * 0.50, radius * 0.50, radius * 0.50, 16, dish, true, true);
    b.frustum(-halfWidth * 1.18, halfWidth * 1.18, radius * 0.25, radius * 0.25, radius * 0.25, radius * 0.25, 12, hub, true, true);

    // 6 raised lug bolts around the wheel dish
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bx = Math.cos(a) * radius * 0.38, bz = Math.sin(a) * radius * 0.38;
        b.frustum(-halfWidth * 1.14, halfWidth * 1.14, radius * 0.06, radius * 0.06, radius * 0.06, radius * 0.06, 6, rim, true, true, bx, bz);
    }

    // 12 solid beveled track-shoe tread cleats
    const lugs = 12;
    for (let i = 0; i < lugs; i++) {
        const a = (i / lugs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a), tx = -sa, tz = ca;
        const rIn = radius * 0.90, rOut = radius * 1.01;
        const w = 0.115 * radius, hw = halfWidth * 0.93;
        const i0 = [ca * rIn - tx * w, -hw, sa * rIn - tz * w];
        const i1 = [ca * rIn + tx * w, -hw, sa * rIn + tz * w];
        const i2 = [ca * rIn + tx * w, hw, sa * rIn + tz * w];
        const i3 = [ca * rIn - tx * w, hw, sa * rIn - tz * w];
        const p0 = [ca * rOut - tx * w, -hw, sa * rOut - tz * w];
        const p1 = [ca * rOut + tx * w, -hw, sa * rOut + tz * w];
        const p2 = [ca * rOut + tx * w, hw, sa * rOut + tz * w];
        const p3 = [ca * rOut - tx * w, hw, sa * rOut - tz * w];
        b.quad(p0, p1, p2, p3, [ca, 0, sa], tread);
        b.quad(i0, p0, p3, i3, [-tx, 0, -tz], tread);
        b.quad(i1, i2, p2, p1, [tx, 0, tz], tread);
        b.quad(i0, i1, p1, p0, [0, -1, 0], tread);
        b.quad(i3, p3, p2, i2, [0, 1, 0], tread);
    }
    return b.build();
}

export function cannonBarrelMesh(radius, halfLen, tubeRgb = [0.46, 0.50, 0.56]) {
    // Stepped ordnance tube (+Y local -> rotated -90 deg X to point -Z forward)
    const b = makeBuilder();
    const dark = mulRgb(tubeRgb, 0.50);
    const steel = [0.80, 0.84, 0.90];
    const brass = [0.88, 0.62, 0.22];
    // Heavy breech recoil collar + reinforced jacket
    b.frustum(-halfLen, -halfLen * 0.38, radius * 1.62, radius * 1.62, radius * 1.38, radius * 1.38, 16, dark, true, true);
    b.frustum(-halfLen * 0.42, -halfLen * 0.28, radius * 1.52, radius * 1.52, radius * 1.52, radius * 1.52, 16, brass, true, true);
    // Main tapered barrel tube + mid-barrel fume extractor bulge
    b.frustum(-halfLen * 0.35, halfLen * 0.80, radius * 1.02, radius * 1.02, radius * 0.84, radius * 0.84, 16, tubeRgb, true, true);
    b.frustum(halfLen * 0.02, halfLen * 0.34, radius * 1.24, radius * 1.24, radius * 1.20, radius * 1.20, 16, dark, true, true);
    // Slotted heavy muzzle brake + dark bore tip
    b.frustum(halfLen * 0.74, halfLen * 1.06, radius * 1.38, radius * 1.38, radius * 1.32, radius * 1.32, 12, steel, true, true);
    b.frustum(halfLen * 0.84, halfLen * 0.94, radius * 1.44, radius * 1.44, radius * 1.44, radius * 1.44, 12, dark, true, true);
    b.frustum(halfLen * 0.96, halfLen * 1.08, radius * 0.64, radius * 0.64, radius * 0.64, radius * 0.64, 12, [0.08, 0.09, 0.11], false, true);
    return b.build();
}

export function pistonMesh(radius, halfLen, bodyRgb = [0.88, 0.60, 0.18]) {
    const b = makeBuilder();
    const dark = mulRgb(bodyRgb, 0.55);
    const chrome = [0.92, 0.94, 0.98];
    b.frustum(-halfLen, halfLen * 0.12, radius, radius, radius, radius, 12, bodyRgb, true, true);
    b.frustum(halfLen * 0.04, halfLen * 0.18, radius * 1.15, radius * 1.15, radius * 1.15, radius * 1.15, 12, dark, true, true);
    b.frustum(halfLen * 0.12, halfLen, radius * 0.52, radius * 0.52, radius * 0.52, radius * 0.52, 12, chrome, true, true);
    return b.build();
}

export function coilSpringMesh(radius, halfLen, brassRgb = [0.90, 0.66, 0.24]) {
    const b = makeBuilder();
    b.frustum(-halfLen, halfLen, radius * 0.42, radius * 0.42, radius * 0.42, radius * 0.42, 12, [0.34, 0.37, 0.42], true, true);
    const coils = 6;
    for (let i = 0; i < coils; i++) {
        const yc = -halfLen * 0.78 + (i / (coils - 1)) * (halfLen * 1.56);
        b.frustum(yc - halfLen * 0.08, yc + halfLen * 0.08, radius, radius, radius, radius, 16, brassRgb, true, true);
    }
    return b.build();
}

export function slopedPlowMesh(hx, hy, hz, baseRgb = [0.56, 0.60, 0.66]) {
    // Swept armored ram blade facing -Z with heavy gusset ribs & tempered cutting edge
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.52);
    const edge = [0.92, 0.60, 0.16];
    const pFL = [-hx, -hy, -hz * 1.22], pFR = [hx, -hy, -hz * 1.22];
    const pBL = [-hx, -hy, hz], pBR = [hx, -hy, hz];
    const pTL = [-hx * 0.92, hy, hz * 0.18], pTR = [hx * 0.92, hy, hz * 0.18];
    const pBTL = [-hx * 0.92, hy, hz], pBTR = [hx * 0.92, hy, hz];
    b.quad(pFL, pFR, pTR, pTL, [0, 0.55, -0.83], baseRgb);
    b.quad(pTL, pTR, pBTR, pBTL, [0, 1, 0], baseRgb);
    b.quad(pBL, pBTL, pBTR, pBR, [0, 0, 1], dark);
    b.quad(pFL, pBL, pBR, pFR, [0, -1, 0], dark);
    b.tri(pFL, pTL, pBL, dark); b.tri(pTL, pBTL, pBL, dark);
    b.tri(pFR, pBR, pTR, dark); b.tri(pTR, pBR, pBTR, dark);
    // Vertical reinforcing armored ribs
    for (const xf of [-0.62, 0, 0.62]) {
        const x = hx * xf;
        b.box(x - hx * 0.06, -hy * 0.65, -hz * 0.85, x + hx * 0.06, hy * 0.72, hz * 0.45, dark);
    }
    // Tempered amber-tungsten cutter lip
    b.box(-hx * 1.03, -hy, -hz * 1.28, hx * 1.03, -hy * 0.54, -hz * 0.92, edge);
    return b.build();
}

export function bearingHubMesh(radius = 0.22, halfLen = 0.24) {
    const b = makeBuilder();
    b.frustum(-halfLen, halfLen, radius, radius, radius, radius, 16, [0.44, 0.48, 0.55], true, true);
    b.frustum(-halfLen * 1.16, halfLen * 1.16, radius * 0.56, radius * 0.56, radius * 0.56, radius * 0.56, 14, [0.92, 0.64, 0.20], true, true);
    b.frustum(-halfLen * 1.24, halfLen * 1.24, radius * 0.24, radius * 0.24, radius * 0.24, radius * 0.24, 10, [0.22, 0.25, 0.30], true, true);
    return b.build();
}

const cache = new Map();
export function getMechanicalMesh(p) {
    const mk = p.meshKind || p.role || 'box';
    const r = (v) => Math.round(v * 100);
    const key = p.role === 'wheel'
        ? `wheel:${r(p.radius)}:${r(p.halfHeight)}`
        : p.shape === 'cylinder'
            ? `${mk}:${r(p.radius)}:${r(p.halfHeight)}`
            : `${mk}:${r(p.half[0])}:${r(p.half[1])}:${r(p.half[2])}`;
    if (cache.has(key)) return cache.get(key);

    let mesh;
    if (p.role === 'wheel') mesh = armoredWheelMesh(p.radius, p.halfHeight);
    else if (mk === 'barrel') mesh = cannonBarrelMesh(p.radius, p.halfHeight);
    else if (mk === 'flywheel') mesh = flywheelMesh(p.radius, p.halfHeight);
    else if (mk === 'gear' || mk === 'cam') mesh = toothedGearMesh(p.radius, p.halfHeight, mk === 'cam' ? 12 : 16);
    else if (mk === 'piston') mesh = pistonMesh(p.radius || Math.min(p.half[0], p.half[2]), p.halfHeight || p.half[1]);
    else if (mk === 'spring') mesh = coilSpringMesh(p.radius || 0.28, p.halfHeight || 0.35);
    else if (mk === 'plow') mesh = slopedPlowMesh(p.half[0], p.half[1], p.half[2]);
    else if (mk === 'turret') mesh = turretMesh(p.half[0], p.half[1], p.half[2]);
    else if (mk === 'sponson') mesh = sponsonBogieMesh(p.half[0], p.half[1], p.half[2]);
    else if (mk === 'leg') mesh = mechLegMesh(p.half[0], p.half[1], p.half[2]);
    else if (mk === 'foot') mesh = mechFootMesh(p.half[0], p.half[1], p.half[2]);
    else if (mk === 'truss' || mk === 'catapult' || mk === 'spade') mesh = trussBeamMesh(p.half[0], p.half[1], p.half[2]);
    else if (mk === 'hub') mesh = bearingHubMesh(p.radius || Math.max(p.half[0], p.half[1]), p.halfHeight || p.half[2]);
    else mesh = chamferedBoxMesh(p.half[0], p.half[1], p.half[2]);

    cache.set(key, mesh);
    return mesh;
}
