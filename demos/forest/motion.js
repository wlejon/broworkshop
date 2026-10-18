// The motion oracle on the forest (lib/kit/motion.js; see
// broflora/docs/look-and-motion.md, "Motion oracle"). Run in headless bro,
// from broworkshop:
//
//   bro-headless --width 1280 --height 720 demos/forest demos/forest/motion.js -- <command> [...] [+ <command> ...]
//
//   static [dists=5,20,60,150] [wind=gusty] [seconds=5] [part=broadleaf]
//                       a tree of the part (the handover subject of
//                       capture.js) from each distance, across the wind,
//                       the camera still: regions `subject` (its box) and
//                       `view`
//   interior [shot=trunks] [wind=gusty] [seconds=5]
//                       a flight shot held still (trunks: in among them;
//                       or understory, glade, ...)
//   flight [wind=gusty] [from=0] [to=34]
//                       the flight, streaming: the camera moves, so motion
//                       is the view's own; pops, flashes and flicker are
//                       what count, with fixed slit-scans across the view
//   dolly [wind=still] [d0=12] [d1=420] [seconds=30] [part=broadleaf]
//                       the subject seen from a steady log dolly out through
//                       every handover (leaves, cards, clumps, crowns): per
//                       frame its tiers and a pop score (its picture's change
//                       against the frame before, beyond the dolly's own
//                       smooth change); still air, so any jump is the level
//                       of detail
//   meadow [wind=gusty] [seconds=8] [h=8]
//                       the meadow far off, across it and the wind, the
//                       trees hidden: regions by ground distance, slit-scans
//                       at 30-150 m (does a gust travel across it?)
//
// Everything goes to demos/forest/captures/motion/.

import { forest, setWind, sky, flight, flightAt, FLIGHT_SECONDS, vp, groundHeight, setTier, holdView, viewPoints, SHOTS, scene,
         MEADOW } from "/app/forest.js";
import { MotionRun, sheet } from "/lib/kit/motion.js";
import * as sway from "/lib/kit/sway.js";

const argv = (bro.app && bro.app.argv) || [];
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/') + '/motion';
require('fs').mkdirSync(OUT, { recursive: true });
const fps = 30;
let args = [];
const opt = (k, d) => { const a = args.find((s) => s.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };

document.body.classList.add('clean');
flush();

const frame = () => { advanceTime(1000 / fps); flush(); };
const pxPerMetre = (d) => (innerHeight / 2) / Math.tan(vp.cam.fov * Math.PI / 360) / d;

function setup(wind) {
    setWind(wind);
    sky.apply(opt('sky', 'noon'));
    setTier('auto');
    scene.setDither(false);
}

// A clear tree of the part near (40, 30) (capture.js's handover subject).
function subject() {
    const part = forest.parts.find((p) => p.name === opt('part')) || forest.parts[0];
    const inst = part.trees, spec = part.emit.specimens;
    const near = [];
    for (let i = 0; i < inst.length / 8; i++) near.push([Math.hypot(inst[i * 8] - 40, inst[i * 8 + 2] - 30), i]);
    near.sort((a, b) => a[0] - b[0]);
    let best = near[0][1], bestClear = -1;
    for (const [d, i] of near.slice(0, 40)) {
        let clear = Infinity;
        for (const p of forest.parts) {
            const t = p.trees;
            for (let j = 0; j < t.length / 8; j++) {
                if (p === part && j === i) continue;
                clear = Math.min(clear, Math.hypot(t[j * 8] - inst[i * 8], t[j * 8 + 2] - inst[i * 8 + 2]));
            }
        }
        const score = Math.min(clear, 12) - 0.05 * d;
        if (score > bestClear) { bestClear = score; best = i; }
    }
    const s = inst[best * 8 + 5] | 0, sc = inst[best * 8 + 3];
    const h = spec[s * 16 + 6] * sc, cr = spec[s * 16 + 7] * sc;
    const off = Math.hypot(spec[s * 16 + 8], spec[s * 16 + 10]) * sc;
    const base = [inst[best * 8], inst[best * 8 + 1], inst[best * 8 + 2]];
    return { index: best, specimen: s, scale: sc, node: part.node, part: part.name, height: h, reach: cr + off, base,
             top: [base[0], base[1] + h * 0.6, base[2]] };
}

// The subject's screen box (0..1) from its bounding cylinder.
function subjectRect(sub, pad = 0.01) {
    let u0 = 1, v0 = 1, u1 = 0, v1 = 0, any = false;
    for (let a = 0; a < 8; a++) for (const y of [sub.base[1], sub.base[1] + sub.height * 1.05]) {
        const ang = a * Math.PI / 4;
        const s = vp.toScreen([sub.base[0] + Math.cos(ang) * sub.reach, y, sub.base[2] + Math.sin(ang) * sub.reach]);
        if (!s || s.behind) continue;
        any = true;
        u0 = Math.min(u0, s.x / innerWidth); u1 = Math.max(u1, s.x / innerWidth); v0 = Math.min(v0, s.y / innerHeight); v1 = Math.max(v1, s.y / innerHeight);
    }
    return any ? [Math.max(0, u0 - pad), Math.max(0, v0 - pad), Math.min(1, u1 + pad), Math.min(1, v1 + pad)] : null;
}

const acrossYaw = () => { const d = scene.wind().direction || [1, 0, 0.3]; return Math.atan2(d[0], d[2]) + Math.PI * 0.5; };
// Eye `d` m from the subject's crown, across the wind (yaw), level-ish.
function viewSubject(sub, d, yaw = acrossYaw(), pitch = -0.08) {
    const t = sub.top, dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    let eye = [t[0] + dir[0] * d, t[1] - dir[1] * d, t[2] + dir[2] * d];
    eye[1] = Math.max(eye[1], groundHeight(eye[0], eye[2]) + 1.6);
    holdView(eye, t);
    return eye;
}
const lodText = (l) => `w ${l.widening.toFixed(2)}${l.card ? ' card' : ''} L ${l.leaves.toFixed(2)} C ${l.clumps.toFixed(2)} R ${l.crowns.toFixed(2)}`;

function record(run, F, meta = () => ({})) {
    for (let k = 0; k < F; k++) { frame(); run.grab(Object.assign({ t: scene.wind().time }, meta(k))); }
    return run.finish();
}

// --- commands -----------------------------------------------------------------------

function staticViews() {
    const wind = opt('wind', 'gusty'), seconds = +opt('seconds', 5), F = Math.round(seconds * fps);
    setup(wind);
    flight.on = false;
    const sub = subject();
    const out = [];
    for (const d of opt('dists', '5,20,60,150').split(',').map(Number)) {
        // From 40 m out the eye rises over the canopy (25 m over the
        // subject's crown), so no nearer crown stands between it and the subject.
        viewSubject(sub, d, acrossYaw(), d >= 40 ? -Math.atan2(25, d) : -0.08);
        for (let i = 0; i < 45; i++) frame();
        const l = sub.node.forestTreeLod(sub.specimen, pxPerMetre(d) * sub.scale);
        const rect = subjectRect(sub);
        const regions = rect ? [{ name: 'subject', rect }, { name: 'view', rect: [0, 0, 1, 1] }] : [];
        const run = new MotionRun({ name: `forest_static_${sub.part}_${d}m_${wind}`, out: OUT, fps, keepFrames: true, frames: F, regions,
                                    notes: [`a ${sub.part} tree (${sub.height.toFixed(1)} m, specimen ${sub.specimen}) at ${d} m across the wind (${wind}), camera still, ${seconds} s`,
                                            `its level of detail: ${lodText(l)}; region subject = its bounding cylinder on screen, view = the rest`],
                                    eventMeta: (m) => (m.t !== undefined ? `wind clock ${m.t.toFixed(2)} s` : '') });
        const s = record(run, F);
        out.push(`${d} m: ${s.flags.length} flags`);
    }
    console.log(out.join('\n'));
}

function interior() {
    const wind = opt('wind', 'gusty'), seconds = +opt('seconds', 5), F = Math.round(seconds * fps), shot = opt('shot', 'trunks');
    setup(wind);
    const s = SHOTS[shot];
    if (s.view) { const v = viewPoints(s.view); holdView(v.eye, v.look); }
    else { const f = flightAt(s.t); holdView(f.eye, f.look); }
    for (let i = 0; i < 45; i++) frame();
    const run = new MotionRun({ name: `forest_${shot}_${wind}`, out: OUT, fps, keepFrames: true, frames: F,
                                regions: [{ name: 'upper', rect: [0, 0, 1, 0.4] }, { name: 'middle', rect: [0, 0.4, 1, 0.7] }, { name: 'ground', rect: [0, 0.7, 1, 1] }],
                                notes: [`the ${shot} shot held still, ${wind}, ${seconds} s; regions: the view's upper 40% (crowns), middle (trunks, understory), lower 30% (ground)`],
                                eventMeta: (m) => (m.t !== undefined ? `wind clock ${m.t.toFixed(2)} s` : '') });
    record(run, F);
}

function flightRun() {
    const wind = opt('wind', 'gusty'), from = +opt('from', 0), to = Math.min(+opt('to', FLIGHT_SECONDS), FLIGHT_SECONDS);
    setup(wind);
    const F = Math.round((to - from) * fps);
    // Start on the flight a second early so the streaming has its first frame.
    holdView(flightAt(from).eye, flightAt(from).look);
    for (let i = 0; i < 30; i++) frame();
    const slits = [0.2, 0.4, 0.6, 0.8].map((y) => ({ label: `y ${Math.round(y * 100)}%`, y, x0: 0, x1: 1 }));
    const run = new MotionRun({ name: `forest_flight_${wind}`, out: OUT, fps, keepFrames: false, frames: F, slits, cameraMoving: true,
                                regions: [{ name: 'upper', rect: [0, 0, 1, 0.4] }, { name: 'middle', rect: [0, 0.4, 1, 0.7] }, { name: 'lower', rect: [0, 0.7, 1, 1] }],
                                notes: [`the flight from ${from} s to ${to} s (${wind}); the camera moves, so motion is mostly the view's own: read the events (pops, flashes) and flicker`],
                                eventMeta: (m) => `flight ${m.ft.toFixed(2)} s, eye ${m.eye.map((v) => v.toFixed(0)).join(',')}` });
    for (let k = 0; k < F; k++) {
        const ft = from + k / fps, f = flightAt(ft);
        holdView(f.eye, f.look);
        frame();
        run.grab({ t: scene.wind().time, ft, eye: f.eye });
    }
    run.finish();
}

function dolly() {
    const wind = opt('wind', 'still'), seconds = +opt('seconds', 30), F = Math.round(seconds * fps);
    const d0 = +opt('d0', 12), d1 = +opt('d1', 420);
    setup(wind);
    flight.on = false;
    const sub = subject();
    const yaw = acrossYaw();
    const dAt = (k) => d0 * Math.pow(d1 / d0, k / (F - 1));
    // The eye climbs as it backs off (0.4 m a metre, to 25 m over the
    // crown), so no nearer crown crosses between it and the subject.
    const pitchAt = (d) => -Math.atan2(Math.min(25, 0.4 * d), d);
    viewSubject(sub, d0, yaw, pitchAt(d0));
    for (let i = 0; i < 45; i++) frame();
    const lods = [], rects = [];
    const run = new MotionRun({ name: `forest_dolly_${sub.part}_${wind}`, out: OUT, fps, keepFrames: false, frames: F, cameraMoving: true,
                                regionAt: (k) => (rects[Math.min(k, rects.length - 1)] ? [{ name: 'subject', rect: rects[Math.min(k, rects.length - 1)] }] : []),
                                notes: [`a ${sub.part} tree (${sub.height.toFixed(1)} m) from ${d0} m out to ${d1} m in ${seconds} s (a steady log dolly), ${wind}`,
                                        'region subject = its bounding cylinder on screen, frame by frame'],
                                eventMeta: (m) => `d ${m.d.toFixed(1)} m, ${m.lod}` });
    // The subject's picture each frame: mean luma and its rms change against
    // the frame before, inside its box (in still air: what the dolly's
    // smooth zoom changes, plus any jump).
    const series = [];
    let prev = null;
    for (let k = 0; k < F; k++) {
        const d = dAt(k);
        viewSubject(sub, d, yaw, pitchAt(d));
        const l = sub.node.forestTreeLod(sub.specimen, pxPerMetre(d) * sub.scale);
        lods.push(l);
        rects.push(subjectRect(sub, 0.004));
        frame();
        run.grab({ t: scene.wind().time, d, lod: lodText(l) });
        const f = frameImage(), top = Math.max(0, f.height - innerHeight), r = rects[k];
        if (!r) { series.push(null); continue; }
        // The box's pixels resampled to a fixed 64 x 64 grid, so frames at
        // different scales compare like with like.
        const G = 64, cur = new Float32Array(G * G);
        let sum = 0;
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
            const x = Math.min(innerWidth - 1, Math.floor((r[0] + (r[2] - r[0]) * (i + 0.5) / G) * innerWidth));
            const y = Math.min(innerHeight - 1, Math.floor((r[1] + (r[3] - r[1]) * (j + 0.5) / G) * innerHeight));
            const o = ((y + top) * f.width + x) * 4;
            const v = 0.2126 * f.data[o] + 0.7152 * f.data[o + 1] + 0.0722 * f.data[o + 2];
            cur[j * G + i] = v; sum += v;
        }
        let ch = 0;
        if (prev) { for (let i = 0; i < G * G; i++) ch += (cur[i] - prev[i]) ** 2; ch = Math.sqrt(ch / (G * G)); }
        series.push({ k, d, mean: sum / (G * G), change: prev ? ch : NaN, l });
        prev = cur;
    }
    const s = run.finish();
    // Pop score: each frame's change against the median of the second
    // around it (the dolly's smooth part), in units of that median's spread.
    const ch = series.map((e) => (e ? e.change : NaN));
    const lines = [`dolly: ${sub.part} tree ${sub.index} (specimen ${sub.specimen}, ${sub.height.toFixed(1)} m) ${d0} .. ${d1} m, ${wind}, ${seconds} s`];
    const pops = [];
    for (let k = 2; k < F; k++) {
        if (!Number.isFinite(ch[k])) continue;
        const win = [];
        for (let j = Math.max(1, k - 15); j < Math.min(F, k + 16); j++) if (j !== k && Number.isFinite(ch[j])) win.push(ch[j]);
        win.sort((a, b) => a - b);
        const med = win[win.length >> 1], mad = win.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[win.length >> 1] * 1.4826;
        const z = (ch[k] - med) / Math.max(mad, 0.15);
        series[k].z = z;
        if (z > 6 && ch[k] - med > 0.6) pops.push(series[k]);
    }
    // The handovers: where each tier's share crosses a half (and the card switch).
    const cross = [];
    const keys = [['leaves', (l) => l.leaves], ['clumps', (l) => l.clumps], ['crowns', (l) => l.crowns], ['card', (l) => (l.card ? 1 : 0)], ['widening>1.05', (l) => (l.widening > 1.05 ? 1 : 0)]];
    for (const [name, f] of keys) for (let k = 1; k < F; k++) {
        const a = f(series[k - 1] ? series[k - 1].l : lods[k - 1]), b = f(series[k] ? series[k].l : lods[k]);
        if ((a - 0.5) * (b - 0.5) < 0) cross.push({ name, k, d: dAt(k), dir: b > a ? 'rises' : 'falls' });
    }
    cross.sort((a, b) => a.k - b.k);
    lines.push('handovers (a tier share crossing a half):');
    for (const c of cross) lines.push(`  ${c.name} ${c.dir} at frame ${c.k}, ${c.d.toFixed(1)} m`);
    lines.push(`pops in the subject's picture (change against the frame before > 6 sigma over the dolly's own), ${pops.length}:`);
    for (const p of pops.sort((a, b) => b.z - a.z).slice(0, 20)) {
        const near = cross.filter((c) => Math.abs(c.k - p.k) <= 3).map((c) => c.name);
        lines.push(`  frame ${p.k} (${(p.k / fps).toFixed(2)} s), ${p.d.toFixed(1)} m: change ${p.change.toFixed(2)} levels, z ${p.z.toFixed(1)}, mean ${p.mean.toFixed(1)}; ` +
                   `${lodText(p.l)}${near.length ? '; AT A HANDOVER: ' + near.join(', ') : ''}`);
    }
    // Per handover: the largest step in the subject's mean luma within 5
    // frames of it, against the steps around it (a value pop).
    lines.push('mean-luma step at each handover (largest |step| within 5 frames, vs the median |step| of the 2 s around):');
    const step = series.map((e, k) => (e && series[k - 1] ? e.mean - series[k - 1].mean : NaN));
    for (const c of cross) {
        let big = 0, at = c.k;
        for (let k = c.k - 5; k <= c.k + 5; k++) if (Math.abs(step[k]) > Math.abs(big)) { big = step[k]; at = k; }
        const around = [];
        for (let k = c.k - 30; k <= c.k + 30; k++) if (Math.abs(k - c.k) > 5 && Number.isFinite(step[k])) around.push(Math.abs(step[k]));
        around.sort((a, b) => a - b);
        lines.push(`  ${c.name} at ${c.d.toFixed(1)} m: step ${big.toFixed(2)} levels at frame ${at} (x${(Math.abs(big) / Math.max(around[around.length >> 1] || 0, 0.01)).toFixed(1)} the usual)`);
    }
    // The sheet: change, z and mean against distance, the tiers below.
    const S = sheet();
    const marks = cross.map((c) => c.k);
    sway.plotTracks(S, [
        { label: 'change vs frame before (levels)', xs: ch.map((v) => (Number.isFinite(v) ? v : 0)), marks: pops.map((p) => p.k), color: '#fc6', note: 'red = pops' },
        { label: 'pop z', xs: series.map((e) => (e && Number.isFinite(e.z) ? Math.min(e.z, 30) : 0)), marks, color: '#f96', note: 'red = handovers' },
        { label: 'mean luma (levels)', xs: series.map((e) => (e ? e.mean : 0)), marks, note: 'red = handovers' },
        { label: 'tiers: leaves (green), clumps (blue)', xs: lods.map((l) => l.leaves), ys: lods.map((l) => l.clumps), marks },
        { label: 'tiers: crowns (green), widening/4 (blue)', xs: lods.map((l) => l.crowns), ys: lods.map((l) => l.widening / 4), marks },
    ], 0, 0, 1280, 600, fps, `${s.name || 'dolly'}: ${d0} .. ${d1} m over ${seconds} s (time across; seconds marked)`, '');
    S.text(`distance at each second: ${Array.from({ length: Math.floor(seconds / 5) + 1 }, (_, i) => `${i * 5}s ${dAt(Math.min(F - 1, i * 5 * fps)).toFixed(0)}m`).join('  ')}`, 6, 620, '#ccc', 12);
    const file = S.save(`${OUT}/forest_dolly_${sub.part}_${wind}_pops.jpg`);
    lines.push(file);
    require('fs').writeFileSync(`${OUT}/forest_dolly_${sub.part}_${wind}_pops.txt`, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
}

// The meadow far off: the eye `h` m up at its edge looking across it and
// across the wind (so a gust travels sideways on screen), the trees and
// shrubs hidden. Regions are bands of ground distance; the slit-scans run
// across the view at 30, 60, 100 and 150 m, where a travelling gust is a
// slant and a standing one a vertical stripe.
function meadowRun() {
    const wind = opt('wind', 'gusty'), seconds = +opt('seconds', 8), F = Math.round(seconds * fps), h = +opt('h', 8);
    setup(wind);
    flight.on = false;
    const was = forest.parts.map((p) => p.node.visible);
    forest.parts.forEach((p) => { p.node.visible = false; });
    const w = scene.wind().direction || [1, 0, 0.3], wl = Math.hypot(w[0], w[2]);
    const across = [-w[2] / wl, w[0] / wl];
    const c = [MEADOW.x, MEADOW.z];
    const eye = [c[0] - across[0] * 75, 0, c[1] - across[1] * 75];
    eye[1] = groundHeight(eye[0], eye[2]) + h;
    const at = (d) => { const x = eye[0] + across[0] * d, z = eye[2] + across[1] * d; return [x, groundHeight(x, z), z]; };
    holdView(eye, at(45));
    for (let i = 0; i < 45; i++) frame();
    const yAt = (d) => { const s = vp.toScreen(at(d)); return s && !s.behind ? Math.min(1, Math.max(0, s.y / innerHeight)) : null; };
    // (The meadow runs to about 150 m from its edge: past that the forest floor.)
    const ys = [15, 30, 60, 100, 150].map(yAt);
    const band = (a, b, name) => (ys[a] !== null && ys[b] !== null && ys[a] > ys[b] + 0.02 ? [{ name, rect: [0, ys[b], 1, ys[a]] }] : []);
    const regions = [...band(0, 1, 'near 15-30 m'), ...band(1, 2, 'mid 30-60 m'), ...band(2, 3, 'far 60-100 m'), ...band(3, 4, 'farthest 100-150 m')];
    const slits = [30, 60, 100, 150].map((d) => ({ label: `${d} m`, y: yAt(d), x0: 0, x1: 1 })).filter((s) => s.y !== null);
    const run = new MotionRun({ name: `forest_meadow_${wind}`, out: OUT, fps, keepFrames: false, frames: F, regions, slits,
                                notes: [`the meadow from its edge ${h} m up, across it and the wind (${wind}), the trees hidden, ${seconds} s; ` +
                                        `regions by ground distance; slits across the view at 30, 60, 100, 150 m (a travelling gust is a slant)`],
                                eventMeta: (m) => (m.t !== undefined ? `wind clock ${m.t.toFixed(2)} s` : '') });
    record(run, F);
    forest.parts.forEach((p, k) => { p.node.visible = was[k]; });
    // Does the picture travel? Per slit: its luma smoothed over 40 px (the
    // blades' grain and sway out), less each pixel's mean over the run; the
    // shift (along the row, `lag` frames on) where it best matches itself is
    // its travel. A gust wave moves at the gusts' speed downwind; a picture that
    // only brightens and darkens in place peaks at no shift.
    const lag = 15, B = 8, lines = [`travel per slit (shift of best match ${lag} frames on; wind ${(scene.wind().speed || 0).toFixed(1)} m/s across the view):`];
    slits.forEach((s, i) => {
        const rows = run.slitRows[i];
        if (!rows || rows.length <= lag) return;
        const N = Math.floor(rows[0].length / 4 / B), T = rows.length;
        const A = rows.map((r) => {
            const out = new Float32Array(N);
            for (let x = 0; x < N; x++) {
                let sum = 0;
                for (let k = 0; k < B; k++) { const o = (x * B + k) * 4; sum += 0.2126 * r[o] + 0.7152 * r[o + 1] + 0.0722 * r[o + 2]; }
                out[x] = sum / B;
            }
            const sm = new Float32Array(N);
            for (let x = 0; x < N; x++) { let a = 0, n = 0; for (let k = -2; k <= 2; k++) if (x + k >= 0 && x + k < N) { a += out[x + k]; n++; } sm[x] = a / n; }
            return sm;
        });
        const mean = new Float32Array(N);
        for (const a of A) for (let x = 0; x < N; x++) mean[x] += a[x] / T;
        let vsum = 0;
        for (const a of A) for (let x = 0; x < N; x++) { a[x] -= mean[x]; vsum += a[x] * a[x]; }
        const std = Math.sqrt(vsum / (T * N));
        const M = 40;
        let best = -2, bestS = 0;
        const corr = [];
        for (let sh = -M; sh <= M; sh++) {
            let c = 0, na = 0, nb = 0;
            for (let t = 0; t + lag < T; t++) {
                const a = A[t], b = A[t + lag];
                for (let x = Math.max(0, -sh); x < Math.min(N, N - sh); x++) { c += a[x] * b[x + sh]; na += a[x] * a[x]; nb += b[x + sh] * b[x + sh]; }
            }
            const r = c / Math.sqrt(Math.max(na * nb, 1e-9));
            corr.push(r);
            if (r > best) { best = r; bestS = sh; }
        }
        const r0 = corr[M];
        const D = [30, 60, 100, 150][i];
        const mps = (bestS * B / pxPerMetre(D)) / (lag / fps);
        lines.push(`  ${s.label}: change in time ${std.toFixed(2)} levels rms; best match ${best.toFixed(2)} at ${bestS * B} px ` +
                   `(${mps.toFixed(1)} m/s along x), in place ${r0.toFixed(2)}`);
    });
    console.log(lines.join('\n'));
    require('fs').appendFileSync(`${OUT}/forest_meadow_${wind}_motion.txt`, lines.join('\n') + '\n');
}

const MODES = { static: staticViews, interior, flight: flightRun, dolly, meadow: meadowRun };
const commands = [[]];
for (const a of argv) a === '+' ? commands.push([]) : commands[commands.length - 1].push(a);
for (const cmd of commands) {
    args = cmd;
    const mode = cmd[0] || 'static';
    const before = new Set(document.body.children);
    const t0 = perf.now();
    (MODES[mode] || staticViews)();
    console.log(`${mode}: ${((perf.now() - t0) / 1000).toFixed(1)} s wall`);
    for (const el of [...document.body.children]) if (!before.has(el)) el.remove();
    flight.on = false;
    setTier('auto');
    flush();
}
