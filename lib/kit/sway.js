// The motion oracle, ground-truth half: where a part of a plant IS at each
// frame, evaluated exactly as bro.scene's GPU does (the wind field of
// bro/src/scene/wind_field.h and scene_camera.glsl, the pose of
// scene_vegetation.glsl's vegWind / vegTreeLevel / vegPose / vegLeafTurn, ported line for
// line: keep them in step), and what its track says about the motion.
//
//   import * as sway from "/lib/kit/sway.js";
//   const ws = sway.windState(scene);                  // each frame, after advanceTime
//   const part = sway.part(record16, model, 'tip');    // a vegetation record (16 floats)
//   const p = sway.position(part, ws);                 // world xyz now
//
// The ported field is checked against scene.windAt() (checkWind), and a
// track against the rendered motion of the same point. Track analysis (analyse): amplitude, dominant frequency, the
// largest move a frame, jerk spikes (third difference standing out of the
// track's own), and the instantaneous frequency of a leaf's flutter phase.
// Coherence (correlate): peak correlation and lag between tracks.

const TWO_PI = 6.28318530718;

// Diagnostics: scale the levels' ringing (0: the drag's mean bend alone),
// to tell which term a motion comes from. `eddies` scales a tree level's
// share from the unresolved turbulence alone (its resonant ring and its
// buffeting; 0: what the gusts' own change does, the step response).
// `drag` (x, z, t) => drag: a scripted drag in place of the wind field's,
// for step and gust-pulse runs.
export const debug = { ring: 1, local: 1, drag: null, eddies: 1 };

// --- the wind field -----------------------------------------------------------------

/** The field now, as the camera block carries it (scene.wind()). */
export function windState(scene) {
    const w = scene.wind();
    const scale = Math.max(1, w.gustScale || 45);
    const d = w.now.direction;
    const l = Math.hypot(d[0], d[2]) || 1;
    return { dir: [d[0] / l, d[2] / l], base: w.now.speed, gustSpeed: w.gustSpeed, gust: Math.max(0, w.gust),
             invAlong: 1 / scale, invAcross: 1 / (scale * 1.85), t: w.time };
}

/** The field at any wind-clock time t from setWind's parameters (scene.wind()
 *  once): wind_field.h's windFieldState, so tracks need no frames rendered. */
export function windStateAt(params, t) {
    const d = params.direction || [1, 0, 0];
    let dx = d[0], dz = d[2];
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) { dx /= l; dz /= l; } else { dx = 1; dz = 0; }
    const ang = Math.atan2(dz, dx) + params.drift * (0.7 * Math.sin(t * 0.021) + 0.3 * Math.sin(t * 0.063 + 1));
    const scale = Math.max(1, params.gustScale);
    return { dir: [Math.cos(ang), Math.sin(ang)], base: Math.max(0, params.speed) * (1 + 0.28 * Math.sin(t * 0.037 + 2)),
             gustSpeed: params.gustSpeed, gust: Math.max(0, params.gust), invAlong: 1 / scale, invAcross: 1 / (scale * 1.85), t };
}

export function hash(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
    h = Math.imul((h ^ (h >>> 13)) >>> 0, 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
}
export function noise(px, py) {
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
    return (ab + (cd - ab) * uy) * 2 - 1;
}
/** sceneWindNoise5: the quintic fade, smooth to the second derivative (the gusts). */
export function noise5(px, py) {
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
    return (ab + (cd - ab) * uy) * 2 - 1;
}
/** sceneWindSoftRamp: max(x, 0) with its corner rounded by a hyperbola. */
export const GUST_SOFT = 0.06;
export const softRamp = (x) => 0.5 * (x + Math.sqrt(x * x + GUST_SOFT * GUST_SOFT));
/** sceneWindGustAtTime: the gust at world x, z at time t; `fine` adds the second octave. */
export function gustAt(ws, x, z, t, fine = true) {
    if (ws.gust <= 0) return 0;
    const along = x * ws.dir[0] + z * ws.dir[1] - t * ws.gustSpeed;
    const across = -x * ws.dir[1] + z * ws.dir[0];
    let g = noise5(along * ws.invAlong, across * ws.invAcross) * 0.5 + 0.5;
    if (fine) g += 0.35 * noise5(along * ws.invAlong * 3.18 + 5.3, across * ws.invAcross * 4.17);
    return softRamp(g - 0.45) * 2.4 * ws.gust;
}
export const pressure = (u) => Math.pow(Math.max(u, 0) / 10, 1.3);

// The oscillator clock (scene_camera.glsl sceneWindCycles): a frequency
// rounded to whole cycles in 256 s, its phase on the clock (in double here:
// the GPU's t mod 256 gives the same angle).
export const CLOCK_PERIOD = 256;
export const quantise = (hz) => Math.round(hz * CLOCK_PERIOD) / CLOCK_PERIOD;
/** Cycles (unwrapped) of an oscillator of `hz` at time t. */
export const cycles = (hz, t) => quantise(hz) * t;

/** The ported gust against the engine's (scene.windAt) at a few points: the largest difference. */
export function checkWind(scene, pts) {
    const ws = windState(scene);
    let worst = 0;
    for (const [x, z] of pts) worst = Math.max(worst, Math.abs(gustAt(ws, x, z, ws.t, true) - scene.windAt(x, z).gust));
    return worst;
}

// --- the records --------------------------------------------------------------------

const FREQ = [0.05, 50], SWAY = [1e-5, 1], LEN = [0.005, 200], SHAPE = [1, 4];
const logValue = (code, bits, r) => (code === 0 ? 0 : r[0] * Math.exp((code - 1) / ((1 << bits) - 2) * Math.log(r[1] / r[0])));

/** A model: world = pos + Ry(yaw) (scale p). */
export function model(pos = [0, 0, 0], yaw = 0, scale = 1) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { scale, apply: (p) => [pos[0] + scale * (p[0] * c + p[2] * s), pos[1] + scale * p[1], pos[2] + scale * (-p[0] * s + p[2] * c)],
             dir: (p) => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c] };
}

/** A part of a plant from its vegetation record (16 floats: v0..v3) at
 *  `where`: 'tip' (the segment's far end), 'base', or a number 0..1 along
 *  it. `seg`: the segment (8 floats: from xyz, rFrom, to xyz, rTo) for a
 *  per-segment record (emitBranchTubes: v2 = weightFrom, weightTo); without
 *  it, a per-vertex record (v2 = anchor, weight; v1.w < 0 a wood record's
 *  tip). `bob`: the node's limb and twig bob ([0.6, 0.8] a broadleaf's). */
export function part(rec, M, where = 'tip', bob = [0.6, 0.8], seg = null) {
    const v0 = rec.slice(0, 4), v1 = rec.slice(4, 8), v2 = rec.slice(8, 12), v3 = rec.slice(12, 16);
    if (seg) {
        const along = where === 'tip' ? 1 : where === 'base' ? 0 : where;
        const a = [0, 1, 2].map((k) => seg[k] + (seg[4 + k] - seg[k]) * along);
        return part([...v0, ...v1, ...a, v2[0] + (v2[1] - v2[0]) * along, ...v3], M, 'base', bob, null,
                    norm(sub(M.dir(seg.slice(4, 7)), M.dir(seg.slice(0, 3)))));
    }
    return partOf(v0, v1, v2, v3, M, where, bob, arguments[5]);
}
function partOf(v0, v1, v2, v3, M, where, bob, tipDir) {
    const scale = M.scale;
    const root = M.apply(v0);
    const height = Math.max(v0[3] * scale, 0.05);
    const w = Math.round(Math.max(v3[3], 0));
    // packSwayTrunk: freq, sway (9 bits each), shape (6 bits, 0 unset: the uniform beam's bend).
    const sh = w & 63;
    const trunk = { freq: logValue(w >>> 15, 9, FREQ) / scale, sway: logValue((w >>> 6) & 511, 9, SWAY), len: height,
                    shape: sh === 0 ? 0 : SHAPE[0] + (SHAPE[1] - SHAPE[0]) * (sh - 1) / 62 };
    const a = Math.round(Math.max(v3[1], 0)), b = Math.round(Math.max(v3[2], 0));
    const limb = {
        phase: (a >>> 18) / 64,
        twig: { freq: logValue((a >>> 12) & 63, 6, FREQ) / scale, sway: logValue((a >>> 6) & 63, 6, SWAY), len: logValue(a & 63, 6, LEN) * scale },
        limb: { freq: logValue(b >>> 16, 8, FREQ) / scale, sway: logValue((b >>> 8) & 255, 8, SWAY), len: logValue(b & 255, 8, LEN) * scale },
    };
    const along = where === 'tip' ? 1 : where === 'base' ? 0 : where;
    const wood = v1[3] < 0;
    const p0 = M.apply(v2), p1 = wood ? M.apply(v1) : p0;
    const rest = [p0[0] + (p1[0] - p0[0]) * along, p0[1] + (p1[1] - p0[1]) * along, p0[2] + (p1[2] - p0[2]) * along];
    const weight = wood ? v2[3] + (-v1[3] - 1 - v2[3]) * along : v2[3];
    const seed = hash(Math.floor(root[0] * 8), Math.floor(root[2] * 8));
    return { root, height, trunk, limb, rest, weight: Math.min(1, Math.max(0, weight)), seed, bob,
             anchorNode: v2.slice(0, 3), tipDir: tipDir || (wood ? norm(sub(p1, p0)) : [0, 1, 0]) };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** vegDragAt: the drag at world x, z at time t. */
export const dragAt = (ws, x, z, t, fine = true) =>
    (debug.drag ? debug.drag(x, z, t) : pressure(ws.base + 4 * gustAt(ws, x, z, t, fine)));
/** vegSmoothAbs. */
export const smoothAbs = (x) => Math.sqrt(x * x + 0.0025) - 0.05;
/** vegLag: a level's lag behind its drag, a quarter period. */
export const lagOf = (f) => Math.min(0.25 / Math.max(f, 0.05), 1.3);
export const TURBULENCE = 0.051, GUST_KICK = 0.4;

/** vegWindLagged at world x, z: the drag `lag` back and its smooth change over `span` before. */
export function windLagged(ws, x, z, lag, span) {
    const t = ws.t;
    const trunk = dragAt(ws, x, z, t - lag, true);
    return { dir: [ws.dir[0], 0, ws.dir[1]], side: [-ws.dir[1], 0, ws.dir[0]], t, ws,
             trunk, kick: smoothAbs(trunk - dragAt(ws, x, z, t - lag - span, true)) };
}
/** vegWind for a plant (a part) rooted at `root` with trunk frequency `trunkFreq`:
 *  the drag at its root a tenth and four tenths of a period back, their mean
 *  (the trunk's) and their smooth difference (the kick). */
export function vegWind(ws, root, trunkFreq = 0.6) {
    const period = 1 / Math.max(trunkFreq, 0.05), t = ws.t;
    const a = dragAt(ws, root[0], root[2], t - Math.min(0.1 * period, 0.5), true);
    const b = dragAt(ws, root[0], root[2], t - Math.min(0.4 * period, 2.1), true);
    return { dir: [ws.dir[0], 0, ws.dir[1]], side: [-ws.dir[1], 0, ws.dir[0]], t, ws, trunk: 0.5 * (a + b),
             kick: smoothAbs(a - b) };
}

/** vegLevelDrive: one level's tip deflection (world m) under drag `mean` and change `kick`. */
export function levelDrive(c, zeta, turbulence, phase, mean, kick, w, bob) {
    if (c.sway <= 0 || c.freq <= 0) return [0, 0, 0];
    const z = Math.max(zeta, 1e-6);
    const period = 1 / c.freq;
    const turb = turbulence * mean * Math.pow(Math.max(c.freq, 0.1), -1 / 3) / Math.sqrt(z);
    const gust = GUST_KICK * kick * Math.min(1, 1.25 * period);
    const rms = Math.sqrt(turb * turb + gust * gust) * debug.ring;
    const t = w.t;
    const a1 = TWO_PI * (cycles(c.freq * (1 - zeta), t) + phase);
    const a2 = TWO_PI * (cycles(c.freq * (1 + zeta), t) + phase * 2.3) + 2;
    const a3 = TWO_PI * (cycles(c.freq * 1.13, t) + phase * 3.7) + 1.3;
    const a4 = TWO_PI * (cycles(c.freq * 0.97, t) + phase) + 2.1;
    const along = mean + rms * (Math.sin(a1) + Math.sin(a2)), across = 0.85 * rms * Math.sin(a3);
    const k = c.sway * c.len;
    return [(w.dir[0] * along + w.side[0] * across) * k, 1.41421 * bob * rms * Math.sin(a4) * k,
            (w.dir[2] * along + w.side[2] * across) * k];
}
/** vegLevel: driven by the plant's trunk drag. */
export const level = (c, zeta, phase, w, bob) => levelDrive(c, zeta, TURBULENCE, phase, w.trunk, w.kick, w, bob);
const bend = (s) => (s <= 1 ? s * s * (3 - s) * 0.5 : 1 + 1.5 * (s - 1));
const bendSlope = (s) => (s <= 1 ? s * (3 - 1.5 * s) : 1.5);
/** vegTrunkBend / vegTrunkBendSlope: h^p, the uniform beam's when unset. */
export const trunkBend = (h, p) => (p <= 0 ? bend(h) : h <= 1 ? Math.pow(Math.max(h, 0), p) : 1 + p * (h - 1));
const trunkBendSlope = (h, p) => (p <= 0 ? bendSlope(h) : h <= 1 ? p * Math.pow(Math.max(h, 1e-4), p - 1) : p);

// Trees and shrubs: a held lean, damped by size (vegTreeLevel and its terms).
export const AERO_DAMPING = 4.0, TREE_TURBULENCE = 0.04, CROWN_RING = 0.07, BUFFET = 0.2, EDDY_HZ = 0.7,
             BOUGH_DAMPING = 0.2, SPRAY_DAMPING = 0.35, REFERENCE_WIND = 10;
/** vegSpeed: the wind speed whose drag is `drag`. */
export const speedOf = (drag) => REFERENCE_WIND * Math.pow(Math.max(drag, 0), 1 / 1.3);
/** vegDamping: a level's damping ratio under drag `mean`. */
export const damping = (c, zeta0, mean) =>
    Math.min(zeta0 + AERO_DAMPING * TWO_PI * c.freq * c.sway * c.len * speedOf(mean) / (REFERENCE_WIND * REFERENCE_WIND), 2);
/** vegTrunkDamping. */
export const trunkDamping = (mean) => 0.12 + 0.012 * speedOf(mean);
const smoothstepAB = (a, b, x) => { const s = Math.min(1, Math.max(0, (x - a) / (b - a))); return s * s * (3 - 2 * s); };
/** vegOver: how much a level rings for its damping. */
export const over = (zeta) => 1 - smoothstepAB(0.3, 0.8, zeta);
/** vegBuffet: the unresolved eddies' buffeting, along and across, each about
 *  1 rms; its rates spread by the limb's `seed`, its phases the point's. */
export function buffetAt(phase, seed, t) {
    const s = 0.85 + 0.3 * (seed * 7.31 - Math.floor(seed * 7.31));   // GLSL fract
    const b1 = Math.sin(TWO_PI * (cycles(0.37 * s, t) + phase));
    const b2 = Math.sin(TWO_PI * (cycles(0.61 * s, t) + phase * 2.7) + 1.1);
    const b3 = Math.sin(TWO_PI * (cycles(1.01 * s, t) + phase * 4.1) + 2.3);
    const c1 = Math.sin(TWO_PI * (cycles(0.43 * s, t) + phase * 1.9) + 0.7);
    const c2 = Math.sin(TWO_PI * (cycles(0.79 * s, t) + phase * 3.3) + 2.9);
    return [(b1 + 0.7 * b2 + 0.45 * b3) * 1.088, (c1 + 0.6 * c2) * 1.213];
}
/** vegTreeLevel: a tree level's tip deflection (world m). */
export function treeLevel(c, zeta, ring, phase, mean, kick, w, bob, buffet, seed = phase) {
    if (c.sway <= 0 || c.freq <= 0) return [0, 0, 0];
    const z = Math.max(zeta, 1e-6);
    const ov = over(z), t = w.t;
    let rms = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0;
    if (ov > 0) {
        const turb = ring * mean * Math.pow(Math.max(c.freq, 0.1), -1 / 3) / Math.sqrt(z) * debug.eddies;
        const gust = GUST_KICK * kick * Math.min(1, 1.25 / c.freq) * Math.sqrt(0.15 / z);
        rms = ov * Math.sqrt(turb * turb + gust * gust) * debug.ring;
        // A fixed band (a frequency that followed the damping would chirp).
        a1 = Math.sin(TWO_PI * (cycles(c.freq * 0.94, t) + phase));
        a2 = Math.sin(TWO_PI * (cycles(c.freq * 1.06, t) + phase * 2.3) + 2);
        a3 = Math.sin(TWO_PI * (cycles(c.freq * 1.13, t) + phase * 3.7) + 1.3);
        a4 = Math.sin(TWO_PI * (cycles(c.freq * 0.97, t) + phase) + 2.1);
    }
    let b = [0, 0];
    if (buffet > 0) {
        const lp = c.freq * c.freq / (c.freq * c.freq + EDDY_HZ * EDDY_HZ);
        const k = buffet * mean * lp * debug.ring * debug.eddies, bf = buffetAt(phase, seed, t);
        b = [bf[0] * BUFFET * k, bf[1] * 0.7 * BUFFET * k];
    }
    const along = mean + b[0] + rms * (a1 + a2), across = b[1] + 0.85 * rms * a3;
    const k = c.sway * c.len;
    return [(w.dir[0] * along + w.side[0] * across) * k, bob * (1.41421 * rms * a4 + 0.5 * b[1]) * k,
            (w.dir[2] * along + w.side[2] * across) * k];
}

/** vegPose: the wood's offset and rotation vector at the part's rest point.
 *  Also returns each level's share of the offset (trunk, limb, twig). */
export function pose(pt, w, rest = pt.rest, weight = pt.weight) {
    const h = Math.min(1.3, Math.max(0, (rest[1] - pt.root[1]) / pt.height));
    const shape = pt.trunk.shape || 0;
    const xt = treeLevel(pt.trunk, trunkDamping(w.trunk), TREE_TURBULENCE, pt.seed, w.trunk, w.kick, w, 0, 0);
    const bt = trunkBend(h, shape);
    let offset = sub(mul(xt, bt), [0, 0.6 * dot(xt, xt) * bt / pt.height, 0]);
    let omega = mul(cross([0, 1, 0], xt), trunkBendSlope(h, shape) / pt.height);
    const levels = { trunk: offset, limb: [0, 0, 0], twig: [0, 0, 0] };
    let drag = w.trunk;
    if (pt.limb.limb.sway <= 0 || weight <= 0) return { offset, omega, levels, drag };
    const rel = sub(rest, pt.root);
    const out2 = rel[0] * rel[0] + rel[2] * rel[2];
    const dir = out2 > 1e-6 ? norm([rel[0], 0.75 * Math.sqrt(out2), rel[2]]) : [0, 1, 0];
    const s = Math.min(1, Math.max(0, weight));
    // The limb feels the wind where it is (debug.local 0: at the root, as the trunk).
    const lx = debug.local ? rest : pt.root;
    drag = dragAt(w.ws, lx[0], lx[2], w.t - lagOf(pt.limb.limb.freq), true);
    const xl = treeLevel(pt.limb.limb, damping(pt.limb.limb, BOUGH_DAMPING, drag), CROWN_RING, pt.limb.phase, drag, w.kick,
                         w, pt.bob[0], 1, pt.limb.phase);
    levels.limb = mul(xl, bend(s));
    offset = add(offset, levels.limb);
    omega = add(omega, mul(cross(dir, xl), bendSlope(s) / Math.max(pt.limb.limb.len, 0.05)));
    if (pt.limb.twig.sway <= 0) return { offset, omega, levels, drag };
    const w0 = 1 - Math.min(1, 1.5 * pt.limb.twig.len / Math.max(pt.limb.limb.len, 0.05));
    const u = Math.min(1, Math.max(0, (s - w0) / Math.max(1 - w0, 1e-3)));
    if (u <= 0) return { offset, omega, levels, drag };
    const ra = rest;
    const ph = pt.limb.phase + 0.12 * (Math.sin(dot(ra, [3.1, 1.7, 2.3])) + Math.sin(dot(ra, [-1.9, 2.9, 3.7])) + Math.sin(dot(ra, [2.7, -3.3, 1.3])));
    const xw = treeLevel(pt.limb.twig, damping(pt.limb.twig, SPRAY_DAMPING, drag), CROWN_RING, ph, drag, w.kick, w,
                         pt.bob[1], 1, pt.limb.phase);
    levels.twig = mul(xw, bend(u));
    offset = add(offset, levels.twig);
    omega = add(omega, mul(cross(dir, xw), bendSlope(u) / Math.max(pt.limb.twig.len, 0.02)));
    return { offset, omega, levels, drag };
}

function rotate(omega, v) {
    const a = len(omega);
    if (a < 1e-9) return v;
    const k = mul(omega, 1 / a), c = Math.cos(a), s = Math.sin(a);
    return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

/** vegLeafTurn for a leaf hanging at the part's rest point: its stem
 *  `axis` (unit, world) and card `normal`; returns the total rotation vector
 *  and the flutter's phase (radians, for its instantaneous frequency). */
export const LEAF_FLUTTER_HZ = [2.0, 2.5];
const smoothstep01 = (x) => { const s = Math.min(1, Math.max(0, x)); return s * s * (3 - 2 * s); };
export function leafTurn(ps, w, axis, normal, seed, amount = 1) {
    const drag = ps.drag;
    const gust = smoothstep01((drag - 0.12) * 1.6) * amount;
    let omega = ps.omega;
    const turn = cross(axis, w.dir), tl = len(turn);
    if (tl > 1e-4) omega = add(omega, mul(turn, Math.min(Math.atan2(tl, dot(axis, w.dir)) * 0.45, 1) * gust / tl));
    let side = cross(normal, axis);
    const sl = len(side);
    side = sl > 1e-4 ? mul(side, 1 / sl) : [1, 0, 0];
    const f = LEAF_FLUTTER_HZ[0] + LEAF_FLUTTER_HZ[1] * ((seed * 7.13) % 1);
    const a = amount * 0.35 * Math.sqrt(Math.max(drag, 0)) *
              (0.55 + 0.45 * Math.sin(TWO_PI * (cycles(0.45 + 0.3 * ((seed * 3.7) % 1), w.t) + seed)));
    const th = TWO_PI * (cycles(f, w.t) + seed);
    const th2 = TWO_PI * (cycles(1.37 * f, w.t) + 1.37 * seed) + 2;
    omega = add(omega, add(mul(axis, a * Math.sin(th)), mul(side, 0.45 * a * Math.sin(th2))));
    return { omega, phase: th, amp: a, freq: quantise(f) };
}

/** World position of a part now: the wood's point, or with `leaf` ({len}:
 *  a leaf of that length hanging there along the wood's direction) its tip. */
export function position(pt, ws, leaf) {
    const w = vegWind(ws, pt.root, pt.trunk.freq);
    const ps = pose(pt, w);
    if (!leaf) return { p: add(pt.rest, ps.offset), levels: ps.levels, w };
    const axis = norm(pt.tipDir), normal = norm(cross(axis, [0, 1, 0]).every((v) => v === 0) ? [1, 0, 0] : cross(cross(axis, [0, 1, 0]), axis));
    const seed = ((Math.sin(dot(pt.anchorNode, [12.9898, 78.233, 37.719]) + (leaf.treeSeed || 0) * 61.7) * 43758.5453) % 1 + 1) % 1;
    const lt = leafTurn(ps, w, axis, normal, seed);
    return { p: add(add(pt.rest, ps.offset), rotate(lt.omega, mul(axis, leaf.len))), phase: lt.phase, flutterAmp: lt.amp, w };
}

export { rotate };

// --- tracks -------------------------------------------------------------------------

/** One track's numbers. `xs`: positions (world, [x,y,z] per frame), `fps`,
 *  `dir`: the axis to measure along (the wind's), `phase` (optional): the
 *  flutter phase per frame. */
export function analyse(xs, fps, dir = [1, 0, 0], phase) {
    const n = xs.length;
    if (!n) return { rms: 0, pp: 0, maxStep: 0, maxStepAt: 0, speedRms: 0, domHz: 0, fastShare: 0, jerkMedian: 0, spikes: [] };
    const along = xs.map((p) => dot(p, dir));
    const mean = along.reduce((a, b) => a + b, 0) / n;
    const x = along.map((v) => v - mean);
    const rms = Math.sqrt(x.reduce((a, b) => a + b * b, 0) / n);
    let pp = 0, lo = Infinity, hi = -Infinity;
    for (const v of x) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    pp = hi - lo;
    // The largest move between frames (3D) and the speed RMS.
    let maxStep = 0, maxStepAt = 0, sv = 0;
    for (let i = 1; i < n; i++) {
        const d = len(sub(xs[i], xs[i - 1]));
        sv += d * d;
        if (d > maxStep) { maxStep = d; maxStepAt = i; }
    }
    // Dominant frequency: a Hann-windowed DFT of the detrended along-wind track, 0.1-15 Hz.
    // (From 0.25 Hz: below it is the gusts' own slow lean, a few cycles a run.)
    let bestF = 0, bestP = 0;
    const spec = [], hannDenom = Math.max(1, n - 1);
    for (let f = 0.25; f <= Math.min(15, fps / 2); f *= 1.04) {
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) {
            const wv = n > 1 ? 0.5 - 0.5 * Math.cos(TWO_PI * i / hannDenom) : 1;
            re += x[i] * wv * Math.cos(TWO_PI * f * i / fps);
            im += x[i] * wv * Math.sin(TWO_PI * f * i / fps);
        }
        const pw = re * re + im * im;
        spec.push([f, pw]);
        if (pw > bestP) { bestP = pw; bestF = f; }
    }
    // Energy above 4 Hz: the share of the motion's power that is fast.
    const tot = spec.reduce((a, s) => a + s[1], 0) || 1;
    const fast = spec.filter((s) => s[0] > 4).reduce((a, s) => a + s[1], 0) / tot;
    // Jerk spikes: the third difference of the 3D track, against its own median.
    const j3 = [];
    for (let i = 3; i < n; i++) {
        const d = sub(sub(xs[i], mul(xs[i - 1], 3)), sub(xs[i - 3], mul(xs[i - 2], 3)));
        j3.push(len(d));
    }
    const sorted = [...j3].sort((a, b) => a - b), med = sorted[sorted.length >> 1] || 0;
    const mad = [...j3].map((v) => Math.abs(v - med)).sort((a, b) => a - b)[j3.length >> 1] * 1.4826 || 1e-9;
    // A spike also stands out of its own neighbourhood (frames 4-8 either
    // side; a one-frame kink spreads over the 4 third differences round it):
    // a strong but smooth swing (a big gust's onset) is not one.
    const spikes = [];
    j3.forEach((v, i) => {
        if (!(v > med + 8 * mad && v > 3 * med && v > 1e-4)) return;
        const near = [];
        for (let d = 4; d <= 8; d++) { if (i - d >= 0) near.push(j3[i - d]); if (i + d < j3.length) near.push(j3[i + d]); }
        near.sort((a, b) => a - b);
        const local = near[near.length >> 1] || 0;
        if (v > 3 * local) spikes.push({ frame: i + 3, jerk: v, z: (v - med) / mad });
    });
    const out = { rms, pp, maxStep, maxStepAt, speedRms: n > 1 ? Math.sqrt(sv / (n - 1)) * fps : 0, domHz: bestF, fastShare: fast,
                  jerkMedian: med, spikes };
    if (phase) {
        // Instantaneous frequency of the flutter phase (Hz) per frame.
        const inst = [];
        for (let i = 1; i < n; i++) inst.push((phase[i] - phase[i - 1]) / TWO_PI * fps);
        const s = [...inst].sort((a, b) => a - b), il = inst.length || 1;
        out.flutterHz = { median: s[s.length >> 1] || 0, p05: s[Math.floor(0.05 * s.length)] || 0, p95: s[Math.floor(0.95 * s.length)] || 0,
                          min: s[0] || 0, max: s[s.length - 1] || 0, aliased: inst.filter((v) => Math.abs(v) > fps / 2).length / il,
                          backwards: inst.filter((v) => v < 0).length / il, series: inst };
    }
    return out;
}

/** Peak correlation and lag (frames, b after a) of two scalar series within +-maxLag. */
export function correlate(a, b, maxLag) {
    const n = a.length;
    const z = (s) => { const m = s.reduce((p, q) => p + q, 0) / n; const d = s.map((v) => v - m); const e = Math.sqrt(d.reduce((p, q) => p + q * q, 0)) || 1; return d.map((v) => v / e); };
    const A = z(a), Bv = z(b);
    let best = -2, lag = 0, zero = 0;
    for (let l = -maxLag; l <= maxLag; l++) {
        let s = 0;
        for (let k = Math.max(0, -l); k < Math.min(n, n - l); k++) s += A[k] * Bv[k + l];
        if (l === 0) zero = s;
        if (s > best) { best = s; lag = l; }
    }
    return { corr: best, lag, zero };
}

// The tracks' own checks, on synthetic series (calibration).
export function selfTest(fps) {
    const n = 300, lines = [];
    const smooth = [], popped = [], chirp = [];
    for (let i = 0; i < n; i++) {
        const t = i / fps;
        const x = 0.05 * Math.sin(TWO_PI * 0.7 * t) + 0.02 * Math.sin(TWO_PI * 1.6 * t + 1);
        smooth.push([x, 0, 0]);
        popped.push([x + (i === 150 ? 0.01 : 0), 0, 0]);
    }
    const ph = [];
    for (let i = 0; i < n; i++) { const t = 30 + i / fps; ph.push(TWO_PI * ((5 + 2 * Math.sin(t)) * t)); chirp.push([0, 0, 0]); }
    const a = analyse(smooth, fps), b = analyse(popped, fps), c = analyse(chirp, fps, [1, 0, 0], ph);
    lines.push(`${a.spikes.length === 0 && Math.abs(a.domHz - 0.7) < 0.08 ? 'PASS' : 'FAIL'} track: smooth sway clean, dominant ${a.domHz.toFixed(2)} Hz (0.7)`);
    lines.push(`${b.spikes.some((s) => Math.abs(s.frame - 150) <= 3) ? 'PASS' : 'FAIL'} track: a 1 cm one-frame pop found (${b.spikes.map((s) => s.frame).join(',')})`);
    lines.push(`${c.flutterHz.max > 30 ? 'PASS' : 'FAIL'} track: a time-scaled chirp's instantaneous frequency caught (max ${c.flutterHz.max.toFixed(0)} Hz)`);
    const l = correlate(smooth.map((p) => p[0]), smooth.map((p, i) => (smooth[Math.max(0, i - 10)][0])), 30);
    lines.push(`${l.lag === 10 ? 'PASS' : 'FAIL'} track: correlate finds a 10-frame lag (${l.lag})`);
    return lines;
}

// --- sheets ---------------------------------------------------------------------------

/** Plot tracks as sparklines on a sheet (motion.js sheet()): each
 *  {label, xs (along-wind cm per frame), ys (across cm), note}. */
export function plotTracks(S, tracks, X, Y, w, h, fps, title, unit = 'cm') {
    const g = S.g, rowH = Math.max(28, Math.floor((h - 20) / Math.max(1, tracks.length)));
    S.text(title, X + 4, Y + 13, '#fff', 12);
    tracks.forEach((tr, i) => {
        const y0 = Y + 20 + i * rowH, n = tr.xs.length;
        let lo = Infinity, hi = -Infinity;
        for (const v of [...tr.xs, ...(tr.ys || [])]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        const span = Math.max(hi - lo, 1e-3), pw = w - 300;
        g.strokeStyle = '#333';
        g.strokeRect(X + 4, y0, pw, rowH - 4);
        const line = (s, color) => {
            const denom = Math.max(1, n - 1);
            g.strokeStyle = color;
            g.beginPath();
            for (let k = 0; k < n; k++) {
                const x = X + 4 + (k / denom) * pw, y = y0 + rowH - 6 - ((s[k] - lo) / span) * (rowH - 10);
                if (k) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
        };
        if (tr.ys) line(tr.ys, '#59f');
        line(tr.xs, tr.color || '#6f6');
        const denom = Math.max(1, n - 1);
        for (const m of tr.marks || []) { g.fillStyle = '#f33'; g.fillRect(X + 4 + (m / denom) * pw - 1, y0, 2, rowH - 4); }
        S.text(`${tr.label}  (${span.toFixed(1)} ${unit} span)`, X + pw + 10, y0 + 11, '#fff', 11);
        if (tr.note) S.text(tr.note, X + pw + 10, y0 + 24, '#bbb', 10);
    });
    const t0Denom = Math.max(1, tracks[0].xs.length - 1);
    for (let s = 0; s <= tracks[0].xs.length / fps; s += 1) S.text(`${s}`, X + 4 + (s * fps / t0Denom) * (w - 300) - 3, Y + h - 2, '#777', 9);
}

/** A space-time image: rows = time (down), columns = members (e.g. trees
 *  sorted along the wind), colour = a signed value (blue - / red +). */
export function plotSpaceTime(S, cols, X, Y, w, h, title, labels) {
    const n = cols[0].length, m = cols.length;
    let mx = 1e-9;
    for (const c of cols) for (const v of c) mx = Math.max(mx, Math.abs(v));
    const cw = Math.max(1, Math.floor(w / m)), rh = Math.max(1, Math.floor((h - 34) / n));
    const im = S.g.createImageData(cw * m, rh * n);
    for (let k = 0; k < n * rh; k++) for (let j = 0; j < m * cw; j++) {
        const v = cols[Math.floor(j / cw)][Math.floor(k / rh)] / mx, d = (k * cw * m + j) * 4;
        im.data[d] = v > 0 ? 40 + 215 * v : 40; im.data[d + 1] = 40 + 60 * (1 - Math.abs(v)); im.data[d + 2] = v < 0 ? 40 - 215 * v : 40; im.data[d + 3] = 255;
    }
    S.g.putImageData(im, X, Y + 18);
    S.text(title, X + 2, Y + 12, '#fff', 12);
    if (labels) S.text(labels, X + 2, Y + 30 + rh * n, '#aaa', 10);
}
