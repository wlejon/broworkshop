// The motion oracle, ground-truth half: where a part of a plant IS at each
// frame, evaluated exactly as bro.scene's GPU does (the wind field of
// bro/src/scene/wind_field.h and scene_camera.glsl, the pose of
// scene_vegetation.glsl's vegLevel / vegPose / vegLeafTurn, ported line for
// line: keep them in step), and what its track says about the motion.
//
//   import * as sway from "/lib/kit/sway.js";
//   const ws = sway.windState(scene);                  // each frame, after advanceTime
//   const part = sway.part(record16, model, 'tip');    // a vegetation record (16 floats)
//   const p = sway.position(part, ws);                 // world xyz now
//
// The ported field is checked against scene.windAt() (checkWind), and a
// track against the rendered motion of the same point (the grove's `truth`
// command). Track analysis (analyse): amplitude, dominant frequency, the
// largest move a frame, jerk spikes (third difference standing out of the
// track's own), and the instantaneous frequency of a leaf's flutter phase.
// Coherence (correlate): peak correlation and lag between tracks.

const TWO_PI = 6.28318530718;

// Diagnostics: scale the levels' ringing (0: the drag's mean bend alone),
// to tell which term a motion comes from.
export const debug = { ring: 1, local: 1 };

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

const FREQ = [0.05, 50], SWAY = [1e-5, 1], LEN = [0.005, 200];
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
 *  per-segment record (emitBranchTubes, emitForest's segmentVegetation:
 *  v2 = weightFrom, weightTo); without it, a per-vertex record (v2 =
 *  anchor, weight; v1.w < 0 a wood record's tip). `bob`: the node's limb
 *  and twig bob ([0.6, 0.8] a broadleaf's; a forest node's look sets its own). */
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
    const trunk = { freq: logValue(w >>> 12, 12, FREQ) / scale, sway: logValue(w & 4095, 12, SWAY), len: height };
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
export const dragAt = (ws, x, z, t, fine = true) => pressure(ws.base + 4 * gustAt(ws, x, z, t, fine));
/** vegSmoothAbs. */
export const smoothAbs = (x) => Math.sqrt(x * x + 0.0025) - 0.05;
/** vegLag: a level's lag behind its drag, a quarter period. */
export const lagOf = (f) => Math.min(0.25 / Math.max(f, 0.05), 1.3);
export const TURBULENCE = 0.051, CROWN_TURBULENCE = 0.14, GUST_KICK = 0.4;

/** vegWindLagged at world x, z: the drag `lag` back and its smooth change over `span` before. */
export function windLagged(ws, x, z, lag, span) {
    const t = ws.t;
    const trunk = dragAt(ws, x, z, t - lag, true);
    return { dir: [ws.dir[0], 0, ws.dir[1]], side: [-ws.dir[1], 0, ws.dir[0]], t, ws,
             trunk, kick: smoothAbs(trunk - dragAt(ws, x, z, t - lag - span, true)) };
}
/** vegWind for a plant (a part) rooted at `root` with trunk frequency `trunkFreq`. */
export function vegWind(ws, root, trunkFreq = 0.6) {
    return windLagged(ws, root[0], root[2], lagOf(trunkFreq), Math.min(0.5 / Math.max(trunkFreq, 0.05), 1.5));
}

/** vegLevelDrive: one level's tip deflection (world m) under drag `mean` and change `kick`. */
export function levelDrive(c, zeta, turbulence, phase, mean, kick, w, bob) {
    if (c.sway <= 0 || c.freq <= 0) return [0, 0, 0];
    const period = 1 / c.freq;
    const turb = turbulence * mean * Math.pow(Math.max(c.freq, 0.1), -1 / 3) / Math.sqrt(zeta);
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

/** vegPose: the wood's offset and rotation vector at the part's rest point.
 *  Also returns each level's share of the offset (trunk, limb, twig). */
export function pose(pt, w, rest = pt.rest, weight = pt.weight) {
    const h = Math.min(1.3, Math.max(0, (rest[1] - pt.root[1]) / pt.height));
    const xt = level(pt.trunk, 0.15, pt.seed, w, 0);
    const bt = bend(h);
    let offset = sub(mul(xt, bt), [0, 0.6 * dot(xt, xt) * bt / pt.height, 0]);
    let omega = mul(cross([0, 1, 0], xt), bendSlope(h) / pt.height);
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
    const xl = levelDrive(pt.limb.limb, 0.08, CROWN_TURBULENCE, pt.limb.phase, drag, w.kick, w, pt.bob[0]);
    levels.limb = mul(xl, bend(s));
    offset = add(offset, levels.limb);
    omega = add(omega, mul(cross(dir, xl), bendSlope(s) / Math.max(pt.limb.limb.len, 0.05)));
    if (pt.limb.twig.sway <= 0) return { offset, omega, levels, drag };
    const w0 = 1 - Math.min(1, 1.5 * pt.limb.twig.len / Math.max(pt.limb.limb.len, 0.05));
    const u = Math.min(1, Math.max(0, (s - w0) / Math.max(1 - w0, 1e-3)));
    if (u <= 0) return { offset, omega, levels, drag };
    const ra = rest;
    const ph = pt.limb.phase + 0.12 * (Math.sin(dot(ra, [3.1, 1.7, 2.3])) + Math.sin(dot(ra, [-1.9, 2.9, 3.7])) + Math.sin(dot(ra, [2.7, -3.3, 1.3])));
    const xw = levelDrive(pt.limb.twig, 0.2, CROWN_TURBULENCE, ph, drag, w.kick, w, pt.bob[1]);
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

// --- leaves on twigs ----------------------------------------------------------------
// bro.scene's scene_forest_shoot.glsl, ported line for line (keep in step):
// a broad forest clump's sprays, shoots and leaves, its twig pieces, and the
// spray's and shoot's own bending. Specimen units throughout; `opts` is the
// forest's placement (emitForest's seed, upBias, tiltJitter, shell,
// baseScale, scaleJitter), its leaf length `Lf` (header[1].z) and the
// clump's flatness `flat` (procClumpFlat).

const u32 = (x) => x >>> 0;
export function procHash(x) {
    x = u32(x);
    x = u32(Math.imul(x ^ (x >>> 16), 0x7feb352d));
    x = u32(Math.imul(x ^ (x >>> 15), 0x846ca68b));
    return u32(x ^ (x >>> 16));
}
const procDraw = (base, k) => (procHash(u32(base + Math.imul(k, 0x9e3779b9))) >>> 8) / 16777216;
const smoothstep = (a, b, x) => { const s = Math.min(1, Math.max(0, (x - a) / (b - a))); return s * s * (3 - 2 * s); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function perpendicularUnit(t) {
    let c = cross(t, [0, 1, 0]);
    if (dot(c, c) < 1e-8) c = cross(t, [1, 0, 0]);
    return norm(c);
}
const rotAxis = (v, axis, ang) => add(add(mul(v, Math.cos(ang)), mul(cross(axis, v), Math.sin(ang))), mul(axis, dot(axis, v) * (1 - Math.cos(ang))));

export const SHOOT = { leaves: 8, sprayShoots: 5, internode: 0.35, lateral: 0.75, shootAngle: 1.0, leafAngle: 0.95,
                       flatten: 0.6, droop: 0.12, tilt: 1.0 };
/** The pieces of each twig (FOREST_STEM_PIECES and the rest), its joints'
 *  crook and zigzag, its radius in leaf lengths at its start and end. */
export const PIECES = { stem: 4, limb: 5, limbSprays: 2, hub: 5, axis: 4, shoot: 4 };
PIECES.spray = PIECES.hub + PIECES.axis;
PIECES.stems = 3 * PIECES.stem;
export const CROOK = 0.2, ZIGZAG = [0.1, 0.045];
export const SHOOT_RADIUS = [0.011, 0.005];   // a shoot's at its base and tip; wood carrying k shoots x sqrt(k)

/** A clump (its 8 floats: centre xyz, radius, twig dir xyz, leaf count) as
 *  forestClumpShoots reads it. */
export function clumpShoots(rec, clump, opts, phyllotaxis = 0) {
    const n = Math.round(rec[7]);
    const S = Math.max(1, Math.floor((n + 4) / SHOOT.leaves));
    const NB = S < 3 ? S : Math.max(3, Math.floor((S + 2) / SHOOT.sprayShoots));
    const C = rec.slice(0, 3), r = rec[3];
    const D = dot(rec.slice(4, 7), rec.slice(4, 7)) > 1e-12 ? norm(rec.slice(4, 7)) : [0, 1, 0];
    const seed = u32(opts.seed);
    const sb = procHash(seed ^ procHash(u32(Math.imul(clump, 0x632be5ab) + 0x51ed27)) ^ 0x5eed1234);
    return { C, r, D, B: sub(C, mul(D, 0.35 * r)), n, S, NB, clump, seed, sb, Lf: Math.max(opts.Lf, 1e-4), phyllotaxis,
             flat: opts.flat || 1, opts };
}

function lobe(c, l) {
    if (l <= 0) return { lc: c.C, lr: c.r * 0.72 };
    const cb = procHash(c.seed ^ procHash(u32(Math.imul(c.clump, 0x632be5ab) + 0x51ed27)));
    const b = procHash(u32(cb + Math.imul(l, 0x9e3779b9)));
    const z = procDraw(b, 0) * 1.2 - 0.4, phi = procDraw(b, 1) * TWO_PI, s = Math.sqrt(Math.max(0, 1 - z * z));
    return { lc: add(c.C, mul([s * Math.cos(phi), z * c.flat, s * Math.sin(phi)], c.r * 0.42)), lr: c.r * (0.5 + 0.2 * procDraw(b, 2)) };
}
const flatOf = (c, v) => [v[0], v[1] * (v[1] < 0 ? 0.7 : 0.9) * c.flat, v[2]];
function bezier(a, k, b, t) {
    const d = mul(mix3(sub(k, a), sub(b, k), t), 2);
    return { p: mix3(mix3(a, k, t), mix3(k, b, t), t), t: dot(d, d) > 1e-12 ? norm(d) : norm(sub(b, a)) };
}
// forestCrook: a joint's step aside, any way across T.
function crook(h, k, T, amp) {
    const a = perpendicularUnit(T), b = cross(T, a);
    const ang = TWO_PI * procDraw(h, 2 * k + 11);
    return mul(add(mul(a, Math.cos(ang)), mul(b, Math.sin(ang))), amp * (0.5 + 0.5 * procDraw(h, 2 * k + 12)));
}
// forestHermite: the curve through a piece's joints a and b leaving and
// arriving along their ways ta and tb (pulled FOREST_HERMITE_PULL of the
// chord): the point f along it and its way there.
export const HERMITE_PULL = 0.8;
export function hermite(a, ta, b, tb, f) {
    const L = HERMITE_PULL * len(sub(b, a));
    const m0 = mul(ta, L), m1 = mul(tb, L);
    const f2 = f * f, f3 = f2 * f;
    const d = add(add(mul(sub(a, b), 6 * f2 - 6 * f), mul(m0, 3 * f2 - 4 * f + 1)), mul(m1, 3 * f2 - 2 * f));
    const p = add(add(add(a, mul(sub(b, a), 3 * f2 - 2 * f3)), mul(m0, f3 - 2 * f2 + f)), mul(m1, f3 - f2));
    return { p, t: dot(d, d) > 1e-14 ? norm(d) : norm(add(sub(b, a), [1e-7, 1e-7, 1e-7])) };
}
// forestPieceAt: the piece and the share along it at u (0..1) of K pieces.
function pieceAt(u, K) {
    const x = Math.min(1, Math.max(0, u)) * K;
    const k0 = Math.min(Math.floor(x), K - 1);
    return { k0, f: x - k0 };
}
const lobeStream = (c, l) => procHash(c.sb ^ u32(Math.imul(l + 31, 0x85ebca6b)));
// forestLobeStemJoint / forestLobeStemAt.
function lobeStemJoint(c, lc, lr, lk, k) {
    let o = sub(lc, c.B);
    o = dot(o, o) > 1e-10 ? norm(o) : c.D;
    const Z = add(lc, mul(o, 0.3 * lr));
    const L = len(sub(Z, c.B));
    const q = bezier(c.B, add(c.B, mul(c.D, 0.5 * L)), Z, k / PIECES.stem);
    if (k > 0) q.p = add(q.p, crook(lk, k, q.t, CROOK * L / PIECES.stem));
    return q;
}
function lobeStemAt(c, lc, lr, lk, t) {
    const { k0, f } = pieceAt(t, PIECES.stem);
    const a = lobeStemJoint(c, lc, lr, lk, k0), b = lobeStemJoint(c, lc, lr, lk, k0 + 1);
    return hermite(a.p, a.t, b.p, b.t, f);
}
// forestZigzag: to alternate sides in the plane the leaves spread in, at
// most ZIGZAG_PIECE of the pieces' length.
export const ZIGZAG_PIECE = 0.12;
function zigzag(c, h, k, T, side, piece) {
    const amp = Math.min((c.phyllotaxis === 0 ? ZIGZAG[0] : ZIGZAG[1]) * c.Lf, ZIGZAG_PIECE * piece);
    const sgn = (k & 1) ? 1 : -1;
    return add(mul(side, sgn * amp * (0.6 + 0.8 * procDraw(h, 2 * k + 21))),
               mul(cross(T, side), amp * 0.6 * (procDraw(h, 2 * k + 22) - 0.5)));
}
// forestSprayTwigJoint.
function sprayTwigJoint(s, k) {
    // A cubic off its hub along the wood it leaves (hubWay), into its axis.
    const he = sub(s.E, s.hub), L = len(he);
    const w = norm(add(s.hubWay, mul(he, 1 / Math.max(L, 1e-6))));
    const p1 = add(s.hub, mul(w, 0.35 * L)), p2 = sub(s.E, mul(s.h, 0.35 * L));
    const t = k / PIECES.hub, r = 1 - t;
    const d = mul(add(add(mul(sub(p1, s.hub), r * r), mul(sub(p2, p1), 2 * r * t)), mul(sub(s.E, p2), t * t)), 3);
    const T = dot(d, d) > 1e-12 ? norm(d) : norm(add(he, [1e-6, 1e-6, 1e-6]));
    let p = add(add(mul(s.hub, r * r * r), mul(add(mul(p1, r), mul(p2, t)), 3 * r * t)), mul(s.E, t * t * t));
    if (k > 0 && k < PIECES.hub) p = add(p, crook(s.hb, k, T, CROOK * L / PIECES.hub));
    return { p, t: T };
}
// forestSprayAxisJoint / forestSprayAxisAt.
function sprayAxisJoint(c, s, k) {
    const y = s.lam * k / PIECES.axis;
    const a = arc(s.u, s.h, s.rho, y);
    const q = k > 0 ? add(a.p, zigzag(c, s.hb, k, a.T, cross(a.T, a.N), s.lam / PIECES.axis)) : a.p;
    return { p: add(s.lc, flatOf(c, q)), t: norm(flatOf(c, a.T)) };
}
function sprayAxisAt(c, s, y) {
    const { k0, f } = pieceAt(y / Math.max(s.lam, 1e-5), PIECES.axis);
    const a = sprayAxisJoint(c, s, k0), b = sprayAxisJoint(c, s, k0 + 1);
    return hermite(a.p, a.t, b.p, b.t, f).p;
}
// forestShootJoint / forestShootAt. A shoot leaves the axis halfway between
// the axis' way there and its own.
function shootJoint(c, s, sh, k) {
    const x = sh.len * k / PIECES.shoot;
    const a = arc(sh.u, sh.h, s.rho, x);
    const q = k > 0 ? add(a.p, zigzag(c, sh.hs, k, a.T, cross(a.T, a.N), sh.len / PIECES.shoot)) : a.p;
    const T = k === 0 ? norm(add(a.T, arc(s.u, s.h, s.rho, sh.y).T)) : a.T;
    return { p: add(add(s.lc, flatOf(c, q)), sh.delta), t: norm(flatOf(c, T)) };
}
function shootAt(c, s, sh, x) {
    const { k0, f } = pieceAt(x / Math.max(sh.len, 1e-5), PIECES.shoot);
    const a = shootJoint(c, s, sh, k0), b = shootJoint(c, s, sh, k0 + 1);
    return hermite(a.p, a.t, b.p, b.t, f).p;
}
function arc(u, h, rho, x) {
    const a = x / Math.max(rho, 1e-5), ca = Math.cos(a), sa = Math.sin(a);
    const N = add(mul(u, ca), mul(h, sa));
    return { p: mul(N, rho), T: sub(mul(h, ca), mul(u, sa)), N };
}

export function spray(c, b) {
    const l = b % 3, i = Math.floor(b / 3);
    const L = Math.floor(c.NB / 3) + (l < c.NB % 3 ? 1 : 0);
    const { lc, lr } = lobe(c, l);
    const hb = procHash(u32(c.sb + Math.imul(b + 1, 0x9e3779b9)));
    const lh = procHash(c.sb ^ u32(Math.imul(l + 7, 0x85ebca6b)));
    let o = sub(lc, c.B);
    o = dot(o, o) > 1e-10 ? norm(o) : c.D;
    const e1 = perpendicularUnit(o), e2 = cross(o, e1);
    const fl = Math.max(L, 1);
    const z = Math.min(1, Math.max(-1, 1 - 2 * (i + 0.5) / fl + (procDraw(hb, 0) - 0.5) * 1.2 / fl));
    const phi = i * 2.39996323 + TWO_PI * procDraw(lh, 0) + (procDraw(hb, 1) - 0.5) * 0.6;
    const sz = Math.sqrt(Math.max(0, 1 - z * z));
    const u = norm(add(mul(o, z), mul(add(mul(e1, Math.cos(phi)), mul(e2, Math.sin(phi))), sz)));
    const rho = lr * (1 - c.opts.shell * (0.2 + 0.6 * procDraw(hb, 2)));
    const E = add(lc, flatOf(c, mul(u, rho)));
    const away = sub(E, c.B);
    let t = sub(away, mul(u, dot(away, u)));
    t = dot(t, t) > 1e-10 ? norm(t) : perpendicularUnit(u);
    const h = rotAxis(t, u, (procDraw(hb, 3) * 2 - 1) * 0.6);
    const Q = Math.floor(c.S / c.NB) + (b < c.S % c.NB ? 1 : 0);
    const lam = Math.min(Q * SHOOT.lateral * c.Lf * (0.85 + 0.3 * procDraw(hb, 4)), 0.9 * rho);
    return { lc, lr, u, h, sd: cross(u, h), rho, lam, Q, hb, E, lobe: l, z };
}

// A lobe's limbs (forestLobeSprays, forestLobeLimbs, forestLimbSlots,
// forestLimbDir, forestLimbJoint, forestSprayHub).
export const lobeSprays = (NB, l) => Math.floor(NB / 3) + (l < NB % 3 ? 1 : 0);
export const lobeLimbs = (L) => (L < 3 ? 0 : Math.floor((L + PIECES.limbSprays - 1) / PIECES.limbSprays));
export const limbSlots = (NB) => lobeLimbs(lobeSprays(NB, 0));
function limbDir(c, l, lc, g, G) {
    let o = sub(lc, c.B);
    o = dot(o, o) > 1e-10 ? norm(o) : c.D;
    const e1 = perpendicularUnit(o), e2 = cross(o, e1);
    const lh = procHash(c.sb ^ u32(Math.imul(l + 7, 0x85ebca6b)));
    const z = 1 - 2 * (g + 0.5) / G;
    const phi = g * 2.39996323 + TWO_PI * procDraw(lh, 1);
    const sz = Math.sqrt(Math.max(0, 1 - z * z));
    return { d: norm(add(mul(o, z), mul(add(mul(e1, Math.cos(phi)), mul(e2, Math.sin(phi))), sz))), z };
}
function limbJoint(c, l, g, G, k) {
    const { lc, lr } = lobe(c, l);
    const { d, z } = limbDir(c, l, lc, g, G);
    const lk = lobeStream(c, l);
    const t0 = 0.4 + 0.27 * (z + 1);
    const at = lobeStemAt(c, lc, lr, lk, t0), a = at.p, st = at.t;
    const b = add(lc, flatOf(c, mul(d, lr * 0.95 * (1 - 0.8 * c.opts.shell))));
    const L = len(sub(b, a));
    const w = norm(add(st, norm(add(sub(b, a), mul(d, 1e-4)))));
    const q = bezier(a, add(a, mul(w, 0.5 * L)), b, k / PIECES.limb);
    if (k > 0 && k < PIECES.limb) q.p = add(q.p, crook(procHash(u32(lk + Math.imul(g + 1, 0x9e3779b9))), k, q.t, CROOK * L / PIECES.limb));
    return q;
}
export function sprayHub(c, s) {
    const G = lobeLimbs(lobeSprays(c.NB, s.lobe));
    if (G === 0) {
        const q = lobeStemAt(c, s.lc, s.lr, lobeStream(c, s.lobe), 0.4 + 0.27 * (s.z + 1));
        return { p: q.p, way: q.t };
    }
    let best = 0, bd = -2;
    for (let g = 0; g < G; g++) {
        const k = dot(limbDir(c, s.lobe, s.lc, g, G).d, s.u);
        if (k > bd) { bd = k; best = g; }
    }
    const a = limbJoint(c, s.lobe, best, G, 0).p, b = limbJoint(c, s.lobe, best, G, PIECES.limb).p;
    const ab = sub(b, a);
    const u = Math.min(1, Math.max(1 / PIECES.limb, dot(sub(s.E, a), ab) / Math.max(dot(ab, ab), 1e-10)));
    const { k0, f } = pieceAt(u, PIECES.limb);
    const j0 = limbJoint(c, s.lobe, best, G, k0), j1 = limbJoint(c, s.lobe, best, G, k0 + 1);
    const q = hermite(j0.p, j0.t, j1.p, j1.t, f);
    return { p: q.p, way: q.t };
}

export function shoot(c, s, ix, q) {
    const m = Math.floor(c.n / c.S) + (ix < c.n % c.S ? 1 : 0);
    const hs = procHash(s.hb ^ u32(Math.imul(q + 1, 0xc2b2ae35)));
    const y = q === 0 ? s.lam : s.lam * (s.Q - q) / Math.max(s.Q, 1);
    const a = arc(s.u, s.h, s.rho, y);
    const side = (q & 1) ? 1 : -1;
    const h = q === 0 ? a.T : norm(add(mul(a.T, Math.cos(SHOOT.shootAngle)), mul(s.sd, side * Math.sin(SHOOT.shootAngle))));
    const L = Math.min(Math.max(m, 1) * SHOOT.internode * c.Lf * (0.85 + 0.3 * procDraw(hs, 0)), s.rho);
    // Moved to leave the axis as drawn.
    const delta = sub(sprayAxisAt(c, s, y), add(s.lc, flatOf(c, mul(a.N, s.rho))));
    return { y, u: a.N, h, len: L, m, hs, delta };
}

const shootNode = (i, M) => 1 - Math.pow(Math.max(1 - (i + 0.6) / (M + 0.2), 0), 1.25);

/** Leaf `j` (its key less the clump's base): its node P, frame (X, N, F
 *  scaled by its size), and where it hangs ({spray, shoot, x}). */
export function shootLeaf(c, j) {
    const ix = j % c.S, k = Math.floor(j / c.S), b = ix % c.NB, q = Math.floor(ix / c.NB);
    const s = spray(c, b), sh = shoot(c, s, ix, q);
    const opp = c.phyllotaxis === 1;
    const M = opp ? Math.floor((sh.m + 1) / 2) : sh.m, i = opp ? Math.floor(k / 2) : k;
    const tn = shootNode(i, M), x = sh.len * tn;
    const a = arc(sh.u, sh.h, s.rho, x);
    // On the twig as drawn: the chord of its piece of the shoot.
    const P = shootAt(c, s, sh, x);
    const hl = procHash(u32(sh.hs + Math.imul(k + 1, 0x27d4eb2f)));
    let psi = c.phyllotaxis === 0 ? Math.PI * (i & 1) : c.phyllotaxis === 1 ? Math.PI / 2 * (i & 1) + Math.PI * (k & 1) : i * 2.5132741;
    psi += (procDraw(hl, 0) - 0.5) * 0.5;
    const Bn = cross(a.T, a.N);
    const e = add(mul(Bn, Math.cos(psi)), mul(a.N, Math.sin(psi)));
    const delta = SHOOT.leafAngle + (procDraw(hl, 1) - 0.5) * 0.35;
    const F0 = add(mul(a.T, Math.cos(delta)), mul(e, Math.sin(delta)));
    const ub = c.opts.upBias, tj = c.opts.tiltJitter;
    const Nt = norm(add(mul(a.N, 1 - ub), [0, ub, 0]));
    let F = sub(sub(F0, mul(Nt, SHOOT.flatten * dot(F0, Nt))), [0, SHOOT.droop, 0]);
    F = dot(F, F) > 1e-10 ? norm(F) : a.T;
    const jit = [procDraw(hl, 2) * 2 - 1, procDraw(hl, 3) * 2 - 1, procDraw(hl, 4) * 2 - 1];
    let N = add(Nt, mul(jit, SHOOT.tilt * tj));
    N = sub(N, mul(F, dot(N, F)));
    N = dot(N, N) > 1e-10 ? norm(N) : perpendicularUnit(F);
    const grade = 0.8 + 0.35 * smoothstep(0, 0.5, tn) - 0.12 * smoothstep(0.8, 1, tn);
    const size = c.opts.baseScale * (1 + (procDraw(hl, 5) * 2 - 1) * c.opts.scaleJitter) * grade;
    return { P, F, N, X: cross(F, N), size, at: { spray: s, shoot: sh, x } };
}

/** Twig piece `p` of the clump at `end` (0 its start, 1 its end): its point,
 *  radius, and how it bends (kind 0 a lobe's twig, 1 a spray's, 2 a shoot;
 *  `along` y on the axis or x on the shoot). Null when not there. */
export const TWIG_TIP = 0.25;   // FOREST_TWIG_TIP: a stem's, limb's, axis' or shoot's end radius share
export function twigEnd(c, p, end) {
    const Lf = c.Lf, e = end > 0.5 ? 1 : 0;
    const tip = (at) => (at ? TWIG_TIP : 1);
    const pipe = (shoots) => SHOOT_RADIUS[0] * Math.sqrt(Math.max(shoots, 1));
    const Qm = c.S / Math.max(c.NB, 1);
    if (p < PIECES.stems) {
        const l = Math.floor(p / PIECES.stem);
        if (l >= c.NB) return null;
        const { lc, lr } = lobe(c, l);
        const k = p - l * PIECES.stem + e, f = k / PIECES.stem, L = lobeSprays(c.NB, l);
        const radius = Lf * (pipe(L * Qm) + (pipe(Math.min(L, 2) * Qm) - pipe(L * Qm)) * f) * tip(k === PIECES.stem);
        const q = lobeStemJoint(c, lc, lr, lobeStream(c, l), k);
        return { p: q.p, t: q.t, radius, frac: f, kind: 0, along: 0, base: k === 0 };
    }
    const slots = limbSlots(c.NB) * PIECES.limb, sprays = PIECES.stems + 3 * slots;
    if (p < sprays) {
        const l = Math.floor((p - PIECES.stems) / slots), q = (p - PIECES.stems) - l * slots;
        const g = Math.floor(q / PIECES.limb), G = lobeLimbs(lobeSprays(c.NB, l));
        if (g >= G) return null;
        const k = q - g * PIECES.limb + e, f = k / PIECES.limb, carried = lobeSprays(c.NB, l) / G * Qm;
        const j = limbJoint(c, l, g, G, k);
        return { p: j.p, t: j.t, radius: Lf * (pipe(carried) + (pipe(carried * 0.6) - pipe(carried)) * f) * tip(k === PIECES.limb),
                 frac: f, kind: 0, along: 0, base: k === 0 };
    }
    const pre = sprays + PIECES.spray * c.NB;
    if (p < pre) {
        const b = Math.floor((p - sprays) / PIECES.spray), r = (p - sprays) - b * PIECES.spray + e;
        const s = spray(c, b);
        if (r < PIECES.hub || (r === PIECES.hub && e === 1)) {
            const f = r / PIECES.hub;
            const hub = sprayHub(c, s);
            s.hub = hub.p;
            s.hubWay = hub.way;
            const j = sprayTwigJoint(s, r);
            return { p: j.p, t: j.t, radius: Lf * pipe(s.Q) * (1.08 - 0.08 * f), frac: f, kind: 1, along: 0, spray: s,
                     base: r === 0 };
        }
        const k = r - PIECES.hub, f = k / PIECES.axis;
        const j = sprayAxisJoint(c, s, k);
        return { p: j.p, t: j.t, radius: Lf * pipe(1 + (s.Q - 1) * (1 - f)) * tip(k === PIECES.axis), frac: f, kind: 1,
                 along: s.lam * f, spray: s, base: false };
    }
    const ix = Math.floor((p - pre) / PIECES.shoot);
    if (ix >= c.S) return null;
    const k = (p - pre) - ix * PIECES.shoot + e, f = k / PIECES.shoot;
    const s = spray(c, ix % c.NB), sh = shoot(c, s, ix, Math.floor(ix / c.NB));
    const j = shootJoint(c, s, sh, k);
    return { p: j.p, t: j.t, radius: Lf * (SHOOT_RADIUS[0] + (SHOOT_RADIUS[1] - SHOOT_RADIUS[0]) * f) * tip(k === PIECES.shoot),
             frac: f, kind: 2, along: sh.len * f, spray: s, shoot: sh, base: k === 0 };
}
/** A point `f` (0..1) along twig piece `p` as drawn: on the curve through
 *  its two ends (hermite), its radius, frac and along between theirs. */
export function twigAt(c, p, f) {
    const a = twigEnd(c, p, 0), b = twigEnd(c, p, 1);
    if (!a || !b) return null;
    const q = hermite(a.p, a.t, b.p, b.t, f);
    const m = (x, y) => x + (y - x) * f;
    return { ...a, p: q.p, t: q.t, radius: m(a.radius, b.radius), frac: m(a.frac, b.frac), along: m(a.along, b.along) };
}
/** The pieces a clump draws: its lobes' stems and limbs and its sprays'
 *  twigs, then its shoots'. */
const sprayPieces = (c) => PIECES.stems + 3 * PIECES.limb * limbSlots(c.NB) + PIECES.spray * c.NB;
export const twigPieces = (c) => (c.n <= 0 ? 0 : sprayPieces(c) + PIECES.shoot * c.S);
/** The first piece of shoot `ix` (its PIECES.shoot run from base to tip). */
export const shootPiece = (c, ix) => sprayPieces(c) + PIECES.shoot * ix;

/** forestShootSwayAt + forestShootBend: the offset (specimen units) and turn
 *  of a point `along` a spray's axis (kind 1) or shoot (kind 2) at time t. */
export function shootBend(s, sh, kind, along, drag, amount, t) {
    if (kind === 0) return { offset: [0, 0, 0], omega: [0, 0, 0] };
    const a = amount * Math.sqrt(Math.max(drag, 0));
    const fb = 1.4 + 0.8 * procDraw(s.hb, 5);
    const tb = a * 0.08 * Math.sin(TWO_PI * (cycles(fb, t) + procDraw(s.hb, 6)));
    const wb = norm(add(s.u, mul(s.sd, procDraw(s.hb, 7) - 0.5)));
    const sprayAt = (y) => mul(wb, tb * y * y / Math.max(s.lam, 1e-4));
    if (kind === 1) return { offset: sprayAt(along), omega: [0, 0, 0] };
    const fs = 2.2 + 1.0 * procDraw(sh.hs, 1);
    const ts = a * 0.12 * Math.sin(TWO_PI * (cycles(fs, t) + procDraw(sh.hs, 2)));
    const ws = norm(add(sh.u, mul(cross(sh.u, sh.h), procDraw(sh.hs, 3) - 0.5)));
    const L = Math.max(sh.len, 1e-4);
    const omega = add(mul(cross(sh.h, ws), ts * 2 * along / L), mul(cross(s.h, wb), tb * 2 * sh.y / Math.max(s.lam, 1e-4)));
    return { offset: add(sprayAt(sh.y), mul(ws, ts * along * along / L)), omega };
}

// --- tracks -------------------------------------------------------------------------

/** One track's numbers. `xs`: positions (world, [x,y,z] per frame), `fps`,
 *  `dir`: the axis to measure along (the wind's), `phase` (optional): the
 *  flutter phase per frame. */
export function analyse(xs, fps, dir = [1, 0, 0], phase) {
    const n = xs.length;
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
    const spec = [];
    for (let f = 0.25; f <= Math.min(15, fps / 2); f *= 1.04) {
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) {
            const wv = 0.5 - 0.5 * Math.cos(TWO_PI * i / (n - 1));
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
    const out = { rms, pp, maxStep, maxStepAt, speedRms: Math.sqrt(sv / (n - 1)) * fps, domHz: bestF, fastShare: fast,
                  jerkMedian: med, spikes };
    if (phase) {
        // Instantaneous frequency of the flutter phase (Hz) per frame.
        const inst = [];
        for (let i = 1; i < n; i++) inst.push((phase[i] - phase[i - 1]) / TWO_PI * fps);
        const s = [...inst].sort((a, b) => a - b);
        out.flutterHz = { median: s[s.length >> 1], p05: s[Math.floor(0.05 * s.length)], p95: s[Math.floor(0.95 * s.length)],
                          min: s[0], max: s[s.length - 1], aliased: inst.filter((v) => Math.abs(v) > fps / 2).length / inst.length,
                          backwards: inst.filter((v) => v < 0).length / inst.length, series: inst };
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
            g.strokeStyle = color;
            g.beginPath();
            for (let k = 0; k < n; k++) {
                const x = X + 4 + (k / (n - 1)) * pw, y = y0 + rowH - 6 - ((s[k] - lo) / span) * (rowH - 10);
                if (k) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
        };
        if (tr.ys) line(tr.ys, '#59f');
        line(tr.xs, tr.color || '#6f6');
        for (const m of tr.marks || []) { g.fillStyle = '#f33'; g.fillRect(X + 4 + (m / (n - 1)) * pw - 1, y0, 2, rowH - 4); }
        S.text(`${tr.label}  (${span.toFixed(1)} ${unit} span)`, X + pw + 10, y0 + 11, '#fff', 11);
        if (tr.note) S.text(tr.note, X + pw + 10, y0 + 24, '#bbb', 10);
    });
    for (let s = 0; s <= tracks[0].xs.length / fps; s += 1) S.text(`${s}`, X + 4 + (s * fps / (tracks[0].xs.length - 1)) * (w - 300) - 3, Y + h - 2, '#777', 9);
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
