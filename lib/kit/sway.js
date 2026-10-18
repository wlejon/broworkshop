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
export const debug = { ring: 1 };

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
/** sceneWindGustAtTime: the gust at world x, z at time t; `fine` adds the second octave. */
export function gustAt(ws, x, z, t, fine = true) {
    if (ws.gust <= 0) return 0;
    const along = x * ws.dir[0] + z * ws.dir[1] - t * ws.gustSpeed;
    const across = -x * ws.dir[1] + z * ws.dir[0];
    let g = noise(along * ws.invAlong, across * ws.invAcross) * 0.5 + 0.5;
    if (fine) g += 0.35 * noise(along * ws.invAlong * 3.18 + 5.3, across * ws.invAcross * 4.17);
    return Math.max(g - 0.45, 0) * 2.4 * ws.gust;
}
export const pressure = (u) => Math.pow(Math.max(u, 0) / 10, 1.3);

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

/** vegWind for a plant rooted at `root`. */
export function vegWind(ws, root) {
    const u = ws.base, t = ws.t;
    return { dir: [ws.dir[0], 0, ws.dir[1]], side: [-ws.dir[1], 0, ws.dir[0]], t,
             p0: pressure(u + 4 * gustAt(ws, root[0], root[2], t, true)),
             p1: pressure(u + 4 * gustAt(ws, root[0], root[2], t - 0.4, false)),
             p2: pressure(u + 4 * gustAt(ws, root[0], root[2], t - 1.3, false)) };
}

/** vegLevel: one level's tip deflection (world m). */
export function level(c, zeta, phase, w, bob) {
    if (c.sway <= 0 || c.freq <= 0) return [0, 0, 0];
    const period = 1 / c.freq;
    const lag = Math.min(0.25 * period, 1.3);
    const mean = lag < 0.4 ? w.p0 + (w.p1 - w.p0) * lag * 2.5 : w.p1 + (w.p2 - w.p1) * (lag - 0.4) / 0.9;
    const slow = Math.min(1, Math.max(0, (0.5 * period - 0.4) / 0.9));
    const d01 = Math.abs(w.p0 - w.p1);
    const kick = d01 + (d01 + Math.abs(w.p1 - w.p2) - d01) * slow;
    const turb = 0.051 * mean * Math.pow(Math.max(c.freq, 0.1), -1 / 3) / Math.sqrt(zeta);
    const gust = 0.4 * kick * Math.min(1, 1.25 * period);
    const ring = 1.41421 * Math.sqrt(turb * turb + gust * gust) * debug.ring;
    const th = TWO_PI * (c.freq * w.t + phase);
    const th2 = TWO_PI * (c.freq * 1.13 * w.t + phase * 3.7) + 1.3;
    const k = c.sway * c.len;
    return [(w.dir[0] * (mean + ring * Math.sin(th)) + w.side[0] * 0.6 * ring * Math.sin(th2)) * k,
            bob * ring * Math.sin(th * 0.97 + 2.1) * k,
            (w.dir[2] * (mean + ring * Math.sin(th)) + w.side[2] * 0.6 * ring * Math.sin(th2)) * k];
}
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
    if (pt.limb.limb.sway <= 0 || weight <= 0) return { offset, omega, levels };
    const rel = sub(rest, pt.root);
    const out2 = rel[0] * rel[0] + rel[2] * rel[2];
    const dir = out2 > 1e-6 ? norm([rel[0], 0.75 * Math.sqrt(out2), rel[2]]) : [0, 1, 0];
    const s = Math.min(1, Math.max(0, weight));
    const xl = level(pt.limb.limb, 0.08, pt.limb.phase, w, pt.bob[0]);
    levels.limb = mul(xl, bend(s));
    offset = add(offset, levels.limb);
    omega = add(omega, mul(cross(dir, xl), bendSlope(s) / Math.max(pt.limb.limb.len, 0.05)));
    if (pt.limb.twig.sway <= 0) return { offset, omega, levels };
    const w0 = 1 - Math.min(1, 1.5 * pt.limb.twig.len / Math.max(pt.limb.limb.len, 0.05));
    const u = Math.min(1, Math.max(0, (s - w0) / Math.max(1 - w0, 1e-3)));
    if (u <= 0) return { offset, omega, levels };
    const ra = rest;
    const ph = pt.limb.phase + 0.12 * (Math.sin(dot(ra, [3.1, 1.7, 2.3])) + Math.sin(dot(ra, [-1.9, 2.9, 3.7])) + Math.sin(dot(ra, [2.7, -3.3, 1.3])));
    const xw = level(pt.limb.twig, 0.05, ph, w, pt.bob[1]);
    levels.twig = mul(xw, bend(u));
    offset = add(offset, levels.twig);
    omega = add(omega, mul(cross(dir, xw), bendSlope(u) / Math.max(pt.limb.twig.len, 0.02)));
    return { offset, omega, levels };
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
export function leafTurn(ps, w, axis, normal, seed, amount = 1) {
    const gust = Math.min(1, Math.max(0, (w.p0 - 0.12) * 1.6)) * amount;
    let omega = ps.omega;
    const turn = cross(axis, w.dir), tl = len(turn);
    if (tl > 1e-4) omega = add(omega, mul(turn, Math.min(Math.atan2(tl, dot(axis, w.dir)) * 0.45, 1) * gust / tl));
    let side = cross(normal, axis);
    const sl = len(side);
    side = sl > 1e-4 ? mul(side, 1 / sl) : [1, 0, 0];
    const f = 3 + 4 * ((seed * 7.13) % 1) + 2.5 * Math.min(w.p0, 1);
    const a = amount * 0.35 * Math.sqrt(w.p0) * (0.55 + 0.45 * Math.sin(TWO_PI * (0.6 * w.t + seed)));
    const th = TWO_PI * (f * w.t + seed);
    omega = add(omega, add(mul(axis, a * Math.sin(th)), mul(side, 0.45 * a * Math.sin(1.37 * th + 2))));
    return { omega, phase: th, amp: a, freq: f };
}

/** World position of a part now: the wood's point, or with `leaf` ({len}:
 *  a leaf of that length hanging there along the wood's direction) its tip. */
export function position(pt, ws, leaf) {
    const w = vegWind(ws, pt.root);
    const ps = pose(pt, w);
    if (!leaf) return { p: add(pt.rest, ps.offset), levels: ps.levels, w };
    const axis = norm(pt.tipDir), normal = norm(cross(axis, [0, 1, 0]).every((v) => v === 0) ? [1, 0, 0] : cross(cross(axis, [0, 1, 0]), axis));
    const seed = ((Math.sin(dot(pt.anchorNode, [12.9898, 78.233, 37.719]) + (leaf.treeSeed || 0) * 61.7) * 43758.5453) % 1 + 1) % 1;
    const lt = leafTurn(ps, w, axis, normal, seed);
    return { p: add(add(pt.rest, ps.offset), rotate(lt.omega, mul(axis, leaf.len))), phase: lt.phase, flutterAmp: lt.amp, w };
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
    const spikes = [];
    j3.forEach((v, i) => { if (v > med + 8 * mad && v > 3 * med && v > 1e-4) spikes.push({ frame: i + 3, jerk: v, z: (v - med) / mad }); });
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
