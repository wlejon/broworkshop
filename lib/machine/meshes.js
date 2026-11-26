// lib/machine/meshes.js — Procedural engineered mechanical meshes (bro.mesh.Mesh
// with vertex colors for PBR metallic rendering): gears, lugged wheels,
// fluted cannons with muzzle brakes, hydraulic pistons, coil springs, I-beam
// trusses, chamfered armor plates, bearing hubs, and sloped tungsten plows.

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
    const frustum = (y0, y1, rx0, rz0, rx1, rz1, seg, col, cap0 = true, cap1 = true) => {
        for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
            const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
            const p00 = [rx0 * c0, y0, rz0 * s0], p10 = [rx0 * c1, y0, rz0 * s1];
            const p01 = [rx1 * c0, y1, rz1 * s0], p11 = [rx1 * c1, y1, rz1 * s1];
            const am = 0.5 * (a0 + a1);
            quad(p00, p01, p11, p10, [Math.cos(am), 0, Math.sin(am)], col);
            if (cap0) tri([0, y0, 0], p00, p10, col);
            if (cap1) tri([0, y1, 0], p11, p01, col);
        }
    };
    const build = () => new bro.mesh.Mesh({
        positions: new Float32Array(P), normals: new Float32Array(N),
        colors: new Float32Array(C), indices: new Uint32Array(I),
    });
    return { tri, quad, box, frustum, build };
}

const mulRgb = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

export function chamferedBoxMesh(hx, hy, hz, baseRgb = [0.75, 0.78, 0.82]) {
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.55);
    const lite = mulRgb(baseRgb, 1.08);
    const ch = Math.min(hx, hy, hz) * 0.14;
    // Main armored core + raised deck ribs + dark bolt trim plates
    b.box(-hx, -hy + ch, -hz + ch, hx, hy - ch, hz - ch, baseRgb);
    b.box(-hx + ch, -hy, -hz + ch, hx - ch, hy, hz - ch, lite);
    b.box(-hx + ch, -hy + ch, -hz, hx - ch, hy - ch, hz, baseRgb);
    // Dark seam band around midsection
    if (hy > 0.18) {
        b.box(-hx * 1.01, -hy * 0.14, -hz * 0.92, hx * 1.01, hy * 0.14, hz * 0.92, dark);
    }
    return b.build();
}

export function trussBeamMesh(hx, hy, hz, baseRgb = [0.75, 0.78, 0.82]) {
    const b = makeBuilder();
    const web = mulRgb(baseRgb, 0.50);
    const flange = mulRgb(baseRgb, 1.05);
    const axis = hx >= hy && hx >= hz ? 0 : hy >= hz ? 1 : 2;
    if (axis === 1) {
        // Vertical I-beam / strut
        b.box(-hx, -hy, -hz, hx, hy, -hz * 0.45, flange);
        b.box(-hx, -hy, hz * 0.45, hx, hy, hz, flange);
        b.box(-hx * 0.55, -hy, -hz * 0.45, hx * 0.55, hy, hz * 0.45, web);
        b.box(-hx * 1.05, -hy * 0.92, -hz * 1.05, hx * 1.05, -hy * 0.68, hz * 1.05, baseRgb);
        b.box(-hx * 1.05, hy * 0.68, -hz * 1.05, hx * 1.05, hy * 0.92, hz * 1.05, baseRgb);
    } else if (axis === 2) {
        // Longitudinal Z truss / bogie rail
        b.box(-hx, hy * 0.45, -hz, hx, hy, hz, flange);
        b.box(-hx, -hy, -hz, hx, -hy * 0.45, hz, flange);
        b.box(-hx * 0.55, -hy * 0.45, -hz, hx * 0.55, hy * 0.45, hz, web);
        for (let k = -2; k <= 2; k++) {
            const zc = k * hz * 0.38;
            b.box(-hx * 1.04, -hy * 0.9, zc - 0.06, hx * 1.04, hy * 0.9, zc + 0.06, baseRgb);
        }
    } else {
        // Transverse X beam
        b.box(-hx, hy * 0.45, -hz, hx, hy, hz, flange);
        b.box(-hx, -hy, -hz, hx, -hy * 0.45, hz, flange);
        b.box(-hx, -hy * 0.45, -hz * 0.55, hx, hy * 0.45, hz * 0.55, web);
    }
    return b.build();
}

export function toothedGearMesh(radius, halfThick, teeth = 16, baseRgb = [0.85, 0.68, 0.34]) {
    const b = makeBuilder();
    const dark = mulRgb(baseRgb, 0.68);
    const hub = [0.76, 0.79, 0.84];
    const rRoot = radius * 0.78, rTip = radius;
    b.frustum(-halfThick, halfThick, rRoot, rRoot, rRoot, rRoot, Math.max(16, teeth * 2), baseRgb, true, true);
    b.frustum(-halfThick * 1.24, halfThick * 1.24, radius * 0.36, radius * 0.36, radius * 0.36, radius * 0.36, 16, hub, true, true);
    // Solid enclosed involute-style gear teeth with top/bottom caps & outer faces
    const tw = (2 * Math.PI * rRoot / teeth) * 0.34;
    const hT = rTip - rRoot * 0.90;
    for (let i = 0; i < teeth; i++) {
        const ang = (i / teeth) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const rc = rRoot + hT * 0.44;
        const tx = -sa, tz = ca;
        const cx = ca * rc, cz = sa * rc;
        const y0 = -halfThick * 0.95, y1 = halfThick * 0.95;
        const p00 = [cx - tx * tw - ca * hT * 0.5, y0, cz - tz * tw - sa * hT * 0.5];
        const p10 = [cx + tx * tw - ca * hT * 0.5, y0, cz + tz * tw - sa * hT * 0.5];
        const p01 = [cx - tx * tw * 0.68 + ca * hT * 0.5, y0, cz - tz * tw * 0.68 + sa * hT * 0.5];
        const p11 = [cx + tx * tw * 0.68 + ca * hT * 0.5, y0, cz + tz * tw * 0.68 + sa * hT * 0.5];
        const q00 = [p00[0], y1, p00[2]];
        const q10 = [p10[0], y1, p10[2]];
        const q01 = [p01[0], y1, p01[2]];
        const q11 = [p11[0], y1, p11[2]];
        b.quad(q00, q10, q11, q01, [0, 1, 0], baseRgb);
        b.quad(p00, p01, p11, p10, [0, -1, 0], baseRgb);
        b.quad(p01, q01, q11, p11, [ca, 0, sa], dark);
        b.quad(p00, q00, q01, p01, [-tx, 0, -tz], dark);
        b.quad(p10, p11, q11, q10, [tx, 0, tz], dark);
    }
    return b.build();
}

export function armoredWheelMesh(radius, halfWidth) {
    const b = makeBuilder();
    const tire = [0.24, 0.26, 0.29];
    const tread = [0.16, 0.17, 0.20];
    const rim = [0.64, 0.68, 0.74];
    const hub = [0.88, 0.64, 0.24];
    // Heavy solid carcass + steel road-wheel dish + bronze axle cap
    b.frustum(-halfWidth, halfWidth, radius * 0.94, radius * 0.94, radius * 0.94, radius * 0.94, 24, tire, true, true);
    b.frustum(-halfWidth * 1.04, halfWidth * 1.04, radius * 0.64, radius * 0.64, radius * 0.64, radius * 0.64, 18, rim, true, true);
    b.frustum(-halfWidth * 1.14, halfWidth * 1.14, radius * 0.26, radius * 0.26, radius * 0.26, radius * 0.26, 12, hub, true, true);
    // 12 closed heavy tank-track tread shoes
    const lugs = 12;
    for (let i = 0; i < lugs; i++) {
        const a = (i / lugs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a), tx = -sa, tz = ca;
        const rIn = radius * 0.90, rOut = radius * 1.00;
        const w = 0.11 * radius;
        const hw = halfWidth * 0.92;
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

export function cannonBarrelMesh(radius, halfLen, tubeRgb = [0.42, 0.45, 0.50]) {
    // Barrel aligned along local +Y (rotated in component by -90 deg X -> points -Z forward).
    const b = makeBuilder();
    const dark = mulRgb(tubeRgb, 0.55);
    const steel = [0.76, 0.79, 0.84];
    b.frustum(-halfLen, -halfLen * 0.35, radius * 1.45, radius * 1.45, radius * 1.25, radius * 1.25, 16, dark, true, true);
    b.frustum(-halfLen * 0.35, halfLen * 0.78, radius * 1.0, radius * 1.0, radius * 0.86, radius * 0.86, 16, tubeRgb, true, true);
    // Muzzle brake collar at +Y tip
    b.frustum(halfLen * 0.76, halfLen * 1.05, radius * 1.32, radius * 1.32, radius * 1.32, radius * 1.32, 12, steel, true, true);
    b.frustum(halfLen * 0.82, halfLen * 1.08, radius * 0.62, radius * 0.62, radius * 0.62, radius * 0.62, 12, [0.1, 0.1, 0.12], false, true);
    return b.build();
}

export function pistonMesh(radius, halfLen, bodyRgb = [0.85, 0.58, 0.16]) {
    const b = makeBuilder();
    const chrome = [0.88, 0.90, 0.94];
    b.frustum(-halfLen, halfLen * 0.15, radius, radius, radius, radius, 12, bodyRgb, true, true);
    b.frustum(halfLen * 0.10, halfLen, radius * 0.55, radius * 0.55, radius * 0.55, radius * 0.55, 12, chrome, true, true);
    return b.build();
}

export function coilSpringMesh(radius, halfLen, brassRgb = [0.86, 0.64, 0.24]) {
    const b = makeBuilder();
    b.frustum(-halfLen, halfLen, radius * 0.42, radius * 0.42, radius * 0.42, radius * 0.42, 10, [0.35, 0.38, 0.42], true, true);
    const coils = 5;
    for (let i = 0; i < coils; i++) {
        const yc = -halfLen * 0.75 + (i / (coils - 1)) * (halfLen * 1.5);
        b.frustum(yc - halfLen * 0.09, yc + halfLen * 0.09, radius, radius, radius, radius, 14, brassRgb, true, true);
    }
    return b.build();
}

export function slopedPlowMesh(hx, hy, hz, baseRgb = [0.46, 0.48, 0.54]) {
    // Wedge armored nose facing -Z!
    const b = makeBuilder();
    const edge = [0.88, 0.58, 0.18];
    const pFL = [-hx, -hy, -hz * 1.15], pFR = [hx, -hy, -hz * 1.15];
    const pBL = [-hx, -hy, hz], pBR = [hx, -hy, hz];
    const pTL = [-hx * 0.92, hy, hz * 0.25], pTR = [hx * 0.92, hy, hz * 0.25];
    const pBTL = [-hx * 0.92, hy, hz], pBTR = [hx * 0.92, hy, hz];
    b.quad(pFL, pFR, pTR, pTL, [0, 0.55, -0.83], baseRgb);
    b.quad(pTL, pTR, pBTR, pBTL, [0, 1, 0], baseRgb);
    b.quad(pBL, pBTL, pBTR, pBR, [0, 0, 1], baseRgb);
    b.quad(pFL, pBL, pBR, pFR, [0, -1, 0], baseRgb);
    b.tri(pFL, pTL, pBL, baseRgb); b.tri(pTL, pBTL, pBL, baseRgb);
    b.tri(pFR, pBR, pTR, baseRgb); b.tri(pTR, pBR, pBTR, baseRgb);
    // Heavy tungsten leading cutter edge
    b.box(-hx * 1.02, -hy, -hz * 1.20, hx * 1.02, -hy * 0.55, -hz * 0.85, edge);
    return b.build();
}

export function bearingHubMesh(radius = 0.24, halfLen = 0.24) {
    const b = makeBuilder();
    b.frustum(-halfLen, halfLen, radius, radius, radius, radius, 14, [0.45, 0.50, 0.56], true, true);
    b.frustum(-halfLen * 1.16, halfLen * 1.16, radius * 0.52, radius * 0.52, radius * 0.52, radius * 0.52, 12, [0.90, 0.62, 0.20], true, true);
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
    else if (mk === 'gear' || mk === 'flywheel' || mk === 'cam') mesh = toothedGearMesh(p.radius, p.halfHeight, mk === 'flywheel' ? 12 : 16);
    else if (mk === 'piston') mesh = pistonMesh(p.radius || Math.min(p.half[0], p.half[2]), p.halfHeight || p.half[1]);
    else if (mk === 'spring') mesh = coilSpringMesh(p.radius || 0.28, p.halfHeight || 0.35);
    else if (mk === 'plow') mesh = slopedPlowMesh(p.half[0], p.half[1], p.half[2]);
    else if (mk === 'truss' || mk === 'leg' || mk === 'catapult' || mk === 'spade') mesh = trussBeamMesh(p.half[0], p.half[1], p.half[2]);
    else if (mk === 'hub') mesh = bearingHubMesh(p.radius || Math.max(p.half[0], p.half[1]), p.halfHeight || p.half[2]);
    else mesh = chamferedBoxMesh(p.half[0], p.half[1], p.half[2]);

    cache.set(key, mesh);
    return mesh;
}
