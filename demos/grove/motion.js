// The motion oracle on the grove (lib/kit/motion.js: the image half;
// lib/kit/sway.js: the ground truth). Run in headless bro, from broworkshop:
//
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/motion.js -- <command> [...] [+ <command> ...]
//
//   calibrate           synthetic objects in the empty meadow: one swaying
//                       smoothly (must score clean), one with injected pops,
//                       one flickering, one jittering, a lockstep pair and a
//                       travelling pair; then the sway tracks' own synthetic
//                       checks. Prints PASS/FAIL per injected fault.
//   plant <name> [wind=gusty] [seconds=5] [dist=]
//                       one plant alone in a static view across the wind:
//                       a preset (fir, spruce, pine, cedar, redwood, cypress,
//                       juniper, birch, boxwood, holly, hydrangea, hibiscus,
//                       lavender), `tree` (the grove's own broadleaf, the
//                       one at 6.5, 9.5), `bracken` (or any herb preset: the
//                       meadow drawing only it) or `meadow` (grass + herbs)
//   mover [wind=breeze] [through=grass|herbs|bracken|shrub]
//                       a walker (a capsule, 1.4 m/s) through grass, the
//                       meadow's herbs, a bracken patch and a boxwood: per
//                       block response against distance from its path and
//                       time since it passed (lag, peak, recovery,
//                       overshoot), the shrub's reaction, the herbs'
//   truth [wind=gusty] [seconds=20]
//                       ground-truth tracks of the grove's own trees (bark
//                       tips at several heights, a leaf), evaluated as the
//                       GPU does (sway.js), checked against the rendered
//                       motion of the same tips (bark only, tracked in the
//                       image), and the stand's coherence
//   twigs [wind=gusty] [seconds=10]
//                       the grove broadleaf's leaves on their twigs: each
//                       leaf's node against its shoot's drawn twig at rest
//                       and in the wind (the gap, and its ratio to the
//                       petiole), and how far the tips move about their nodes
//
// `floor=contrast` on any command draws the ground one flat pale sand
// (grove.js contrastFloor: a capture option, not the look), so the blocks
// and slit-scans of a grass or herb run see blades rather than turf; its
// reports carry `_contrast`.
//
// Everything goes to demos/grove/captures/motion/.

import { grove, draw, setWind, setShot, sky, vp, scene, groundHeight, ground, roller, PRESET_PLANTS, MEADOW_HERBS, PLANT_SCALE, contrastFloor } from "/app/grove.js";
import { MotionRun, sheet, THRESHOLDS } from "/lib/kit/motion.js";
import * as sway from "/lib/kit/sway.js";

const argv = (bro.app && bro.app.argv) || [];
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/') + '/motion';
require('fs').mkdirSync(OUT, { recursive: true });
const fps = 30;
let args = [];
const opt = (k, d) => { const a = args.find((s) => s.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const floorTag = () => (opt('floor') === 'contrast' ? '_contrast' : '');

document.body.classList.add('clean');
flush();

const frame = () => { advanceTime(1000 / fps); flush(); };
const allNodes = () => [...grove.nodes, ...grove.presets.map((p) => p.node), grove.grass, roller.node];

// Hide everything but `keep`; returns a restore function.
function only(keep) {
    const was = new Map(allNodes().map((n) => [n, n.visible]));
    for (const n of allNodes()) n.visible = keep.includes(n);
    return () => { for (const [n, v] of was) n.visible = v; };
}

// The screen box (0..1) of whatever `toggle(false)` hides, from a frame with
// it and one without (same clock).
function screenBox(toggle, pad = 0.01) {
    flush();
    const a = frameImage();
    toggle(false); flush();
    const b = frameImage();
    toggle(true); flush();
    const W = innerWidth, H = innerHeight, top = Math.max(0, a.height - H);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = ((y + top) * a.width + x) * 4;
        if (Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]) > 8) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    }
    if (x1 < 0) return null;
    return [Math.max(0, x0 / W - pad), Math.max(0, y0 / H - pad), Math.min(1, x1 / W + pad), Math.min(1, y1 / H + pad)];
}

// --- calibrate --------------------------------------------------------------------

function speckled(r, seed, gain = 1) {
    const m = Mesh.sphere(r, 28, 18);
    const c = new Float32Array(m.vertexCount * 4);
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let v = 0; v < m.vertexCount; v++) {
        const k = 0.08 + 0.92 * rnd() * rnd();
        c.set([0.75 * k * gain, 0.55 * k * gain, 0.35 * k * gain, 1], v * 4);
    }
    m.colors = c;
    return m;
}

function calibrate() {
    setWind('still');
    scene.setDither(false);
    sky.apply('noon');
    const restore = only([]);
    roller.node.visible = false;
    // Eight speckled balls 4 m off, in two rows, each moving along x.
    const centre = [-1, groundHeight(-1, 14) + 1.1, 14];
    vp.reframe(centre, 4, { yaw: 0, pitch: 0 });
    frame();
    const sw = (f, ph = 0) => (t) => 0.06 * Math.sin(2 * Math.PI * f * t + ph) + 0.025 * Math.sin(2 * Math.PI * 1.9 * f * t + 1 + ph);
    let g = 0x1234;
    const noise = () => { // gaussian, Box-Muller on an LCG
        const u = ((g = (g * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) || 1e-9, v = (g = (g * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const F = 180;
    const objs = [
        { name: 'smooth', col: 0, row: 0, x: sw(0.7) },
        { name: 'pops', col: 1, row: 0, x: (t, k) => sw(0.83, 1)(t) + (k === 40 || k === 95 ? 0.035 : 0) + (k >= 140 ? 0.03 : 0) },
        { name: 'flicker', col: 2, row: 0, x: sw(0.61, 2), flicker: (k) => k >= 30 && k < 170 && k % 2 === 0 },
        { name: 'jitter', col: 3, row: 0, x: (t) => sw(0.77, 3)(t) + 0.003 * noise() },
        { name: 'lockA', col: 0, row: 1, x: sw(0.9, 0.5) },
        { name: 'travelA', col: 1, row: 1, x: sw(0.55, 4) },
        { name: 'travelB', col: 2, row: 1, x: (t) => sw(0.55, 4)(t - 0.5) },
        { name: 'lockB', col: 3, row: 1, x: sw(0.9, 0.5) },
    ];
    const made = [];
    objs.forEach((o, i) => {
        o.base = [centre[0] - 1.5 + o.col * 1.0, centre[1] + 0.4 - o.row * 0.8, centre[2]];
        o.node = scene.createMesh({ data: speckled(0.3, 77 + i * 31), color: [1, 1, 1], roughness: 0.8, castsShadow: false, receivesShadow: false });
        o.node.position = o.base;
        made.push(o.node);
        if (o.flicker) {
            o.twin = scene.createMesh({ data: speckled(0.302, 77 + i * 31, 1.07), color: [1, 1, 1], roughness: 0.8, castsShadow: false, receivesShadow: false });
            o.twin.position = o.base;
            o.twin.visible = false;
            made.push(o.twin);
        }
    });
    frame();
    // Each ball's region: its box with the motion's reach.
    const regions = objs.map((o) => {
        const r = screenBox((v) => { o.node.visible = v; });
        return { name: o.name, rect: [r[0] - 0.03, r[1], r[2] + 0.03, r[3]] };
    });
    const run = new MotionRun({ name: 'calibrate', out: OUT, fps, keepFrames: true, frames: F, regions,
                                notes: ['synthetic: eight speckled balls 5 m off (about 170 px/m), each along x;',
                                        'smooth: two sines 0.7 + 1.33 Hz; pops: +3.5 cm for one frame at 40 and 95, +3 cm from 140 on;',
                                        'flicker: 7% brighter every other frame 30-170; jitter: smooth + 3 mm (0.5 px) noise;',
                                        'lockA/lockB the same motion; travelB = travelA 0.5 s later'] });
    for (let k = 0; k < F; k++) {
        const t = k / fps;
        for (const o of objs) {
            const p = [o.base[0] + o.x(t, k), o.base[1], o.base[2]];
            o.node.position = p;
            if (o.twin) { o.twin.position = p; o.twin.visible = o.flicker(k); }
            (o.screen || (o.screen = [])).push(vp.toScreen(p).x);
        }
        frame();
        run.grab({ t });
    }
    const s = run.finish();
    // The estimator against the truth: each ball's reliable blocks' x motion
    // against its centre's projected motion, frame by frame.
    const est = [];
    for (const o of objs) {
        if (o.name === 'pops' || o.name === 'jitter') continue;
        const errs = [], med = [];
        for (let k = 0; k + 1 < F; k++) {
            const truth = o.screen[k + 1] - o.screen[k], vs = [];
            for (let b = 0; b < run.nb; b++) {
                if (run.regionOf(b, k) !== o.name || run.reliable[k][b] !== 1) continue;
                errs.push(Math.abs(run.V[k][2 * b] - truth)); vs.push(run.V[k][2 * b]);
            }
            if (vs.length) { vs.sort((p, q) => p - q); med.push(Math.abs(vs[vs.length >> 1] - truth)); }
        }
        const q = (a, p) => { a.sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; };
        est.push(`${o.name} ${q(errs, 0.5).toFixed(3)}/${q(errs, 0.9).toFixed(3)}/${q(med, 0.5).toFixed(3)}`);
    }
    console.log(`estimator |error| px/frame (each block median / p90 / the ball's median block): ${est.join(', ')}`);
    // Pass / fail per object.
    const R = s.regions, ev = (n) => R[n].events.pop + R[n].events.flash + R[n].events.kick;
    const checks = [
        [`smooth is clean (${ev('smooth')} events)`, ev('smooth') <= 1 && !s.flags.some((f) => /^(NOISE|JITTER|FLICKER|LOCK|INCOH)\w* smooth:/.test(f))],
        ['pops: its pops found (>= 3 events)', ev('pops') >= 3],
        ['flicker flagged', R.flicker.flickerBlocks > 0 && s.flags.some((f) => f.startsWith('FLICKER flicker'))],
        ['jitter flagged', s.flags.some((f) => /^(NOISE|JITTER) jitter/.test(f))],
        ['no jitter flag on the smooth, lockstep and travelling balls', !s.flags.some((f) => /^(NOISE|JITTER) (smooth|lock|travel)/.test(f))],
        [`false events on the four smooth balls: ${ev('lockA') + ev('lockB') + ev('travelA') + ev('travelB')} in ${(4 * F / fps).toFixed(0)} ball-seconds (< 0.25 a second)`,
         (ev('lockA') + ev('lockB') + ev('travelA') + ev('travelB')) / (4 * F / fps) < 0.25],
    ];
    const ab = run.regionCorrelation('lockA', 'lockB'), tr = run.regionCorrelation('travelA', 'travelB');
    checks.push([`lockstep pair corr ${ab.corr.toFixed(2)} lag ${ab.lag}`, ab.corr > 0.9 && Math.abs(ab.lag) <= 1]);
    checks.push([`travelling pair lag ${tr.lag} frames (15 injected)`, Math.abs(Math.abs(tr.lag) - 15) <= 2]);
    const lines = checks.map(([n, ok]) => `${ok ? 'PASS' : 'FAIL'} ${n}`);
    // The tracks' own checks (synthetic series).
    lines.push(...sway.selfTest(fps));
    console.log('\n' + lines.join('\n'));
    require('fs').appendFileSync(`${OUT}/calibrate_motion.txt`, 'calibration:\n' + lines.map((l) => '  ' + l).join('\n') + '\n');
    for (const n of made) n.destroy();
    restore();
}

// --- one plant in the wind ----------------------------------------------------------

const across = () => { const d = scene.wind().direction || [1, 0, 0.3]; return Math.atan2(d[0], d[2]) + Math.PI * 0.5; };

// Regions: a box cut into horizontal bands (top first).
function bands(rect, names) {
    const [x0, y0, x1, y1] = rect, n = names.length;
    return names.map((name, i) => ({ name, rect: [x0, y0 + (y1 - y0) * i / n, x1, y0 + (y1 - y0) * (i + 1) / n] }));
}

// `clock=<s>`: jump the wind clock there first (the motion a page shows
// after running that long).
function jumpClock() {
    const c = +opt('clock', 0), now = scene.wind().time;
    if (c > now) advanceTime((c - now) * 1000);
}

function record(run, frames) {
    for (let k = 0; k < frames; k++) { frame(); run.grab({ t: scene.wind().time }); }
    return run.finish();
}

function plant(name) {
    const wind = opt('wind', 'gusty'), seconds = +opt('seconds', 5), F = Math.round(seconds * fps);
    setWind(wind);
    sky.apply('noon');
    scene.setDither(false);
    const FOV = vp.cam.fov || 45, tanHalf = Math.tan(FOV * Math.PI / 360);
    jumpClock();
    const label = `plant_${name}${opt('dist') ? '_' + opt('dist') + 'm' : ''}_${wind}${opt('clock') ? '_t' + opt('clock') : ''}${floorTag()}`;
    const notes = [`${name} alone, seen across the wind (${wind}), ${seconds} s; wind clock from ${(scene.wind().time + 2).toFixed(1)} s`];
    let restore, regions;
    const preset = grove.presets.find((q) => q.name === name);
    if (preset || name === 'tree') {
        // A woody plant: alone (no grass), framed whole or from `dist`.
        const node = preset ? [preset.node] : grove.nodes;
        restore = only(node);
        let x, z, h;
        if (preset) { const r = preset.rows[0]; x = r.plant.x; z = r.plant.z; h = r.height; }
        else { x = 6.5; z = 9.5; h = 8; }
        const base = groundHeight(x, z);
        const eye = +opt('dist', 0) || Math.max(6, h / 0.8 / (2 * tanHalf));
        vp.reframe([x, base + Math.min(h * 0.5, eye * tanHalf * 0.8), z], eye, { yaw: across(), pitch: 0 });
        for (let i = 0; i < 45; i++) frame();
        const box = screenBox((v) => { for (const n of node) n.visible = v; });
        regions = bands(box, ['top', 'middle', 'bottom']);
        notes.push(`height ${h.toFixed(1)} m, eye ${eye.toFixed(1)} m off; regions: the plant's screen box in thirds`);
    } else {
        // Low plants: an herb preset alone, or the meadow (grass and its herbs).
        const g = grove.grass;
        restore = only([g]);
        const grassH = g.grassParams().height;
        if (name !== 'meadow') {
            g.setHerbs({ species: [{ preset: name, shade: 0, shadeRange: 1, patchCover: 1, abundance: 1 }] });
            g.setGrass({ height: 0.16 });
        }
        for (let i = 0; i < 15; i++) frame();
        const at = [-1, 13.5];
        const p = name === 'meadow' ? { height: 0.5 } : bro.flora.herbPreset(name);
        const pl = g.herbPlants(at[0], at[1], 12)[0];
        const d = +opt('dist', name === 'meadow' ? 4 : 2.5);
        const target = pl && d < 6 ? [pl.x, pl.y + Math.min(p.height * 0.5, 0.45), pl.z] : [at[0], groundHeight(at[0], at[1]) + 0.3, at[1]];
        vp.reframe(target, d, { yaw: across(), pitch: d < 6 ? -0.25 : -0.15 });
        for (let i = 0; i < 45; i++) frame();
        regions = bands([0, 0, 1, 1], ['far', 'middle', 'near']);
        notes.push(`${name === 'meadow' ? 'grass and the meadow herbs' : name + ' alone in a short sward'}, eye ${d} m from a plant; regions: the view in thirds (far at the top)`);
        const was = restore;
        restore = () => { g.setHerbs({ species: MEADOW_HERBS }); g.setGrass({ height: grassH }); was(); };
    }
    const run = new MotionRun({ name: label, out: OUT, fps, keepFrames: true, frames: F, regions, notes,
                                eventMeta: (m) => (m.t !== undefined ? `wind clock ${m.t.toFixed(2)} s` : '') });
    const s = record(run, F);
    restore();
    return s;
}

// --- a mover through the plants ---------------------------------------------------

// The ground point under full-res px (x, y): the view ray marched to 15 cm
// over the ground (about where the low plants' tops are seen).
function groundUnder(x, y, lift = 0.15) {
    const r = vp.ray(x, y);
    if (!r) return null;
    const o = r.origin || [r.o.x, r.o.y, r.o.z], d = r.dir || [r.d.x, r.d.y, r.d.z];
    let prev = 0;
    for (let t = 0.3; t < 40; t += 0.04) {
        const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
        if (p[1] < groundHeight(p[0], p[2]) + lift) {
            // One bisection step is plenty at 4 cm.
            const tm = 0.5 * (t + prev);
            return [o[0] + d[0] * tm, o[1] + d[1] * tm, o[2] + d[2] * tm];
        }
        prev = t;
    }
    return null;
}

function mover() {
    const through = opt('through', 'all');
    for (const k of through === 'all' ? ['grass', 'bracken', 'shrub'] : through.split(',')) moverRun(k);
}

function moverRun(through) {
    const wind = opt('wind', 'still');
    setWind(wind);
    sky.apply('noon');
    scene.setDither(false);
    const g = grove.grass, grassH = g.grassParams().height;
    const SPEED = 1.4, R = 0.25, HALF = 0.6, LEAD = 1.0, AFTER = +opt('after', 8), PUSH = { radius: 0.45, strength: 1, trample: 0.6 };
    const wasRolling = roller.running;
    roller.running = false;
    const keep = [g];
    let zp = 11.5, xc = -1, shrub = null;
    if (through === 'bracken') {
        g.setHerbs({ species: [{ preset: 'bracken', shade: 0, shadeRange: 1, patchCover: 1, abundance: 1 }] });
        g.setGrass({ height: 0.16 });
    } else if (through === 'shrub') {
        const p = grove.presets.find((q) => q.name === 'boxwood');
        const sp = p.emit.specimens;
        shrub = { p, x: p.rows[0].plant.x, z: p.rows[0].plant.z, height: sp[6], crown: sp[7] };
        keep.push(p.node);
        xc = shrub.x; zp = shrub.z;
    }
    const restore = only(keep);
    const x0 = xc - 4, x1 = xc + 4, F = Math.round((LEAD + (x1 - x0) / SPEED + AFTER) * fps);
    const walker = scene.createMesh({ data: Mesh.capsule(R, HALF, 16, 8), color: [0.55, 0.18, 0.12], roughness: 0.8, castsShadow: false, receivesShadow: true });
    // `body=hidden` (the default): the mover is tracked but not drawn, so
    // nothing hides the plants it parts and nothing is masked.
    const hidden = opt('body', 'hidden') === 'hidden';
    walker.visible = !hidden;
    const place = (x) => { walker.position = [x, groundHeight(x, zp) + HALF + R, zp]; };
    place(x0);
    g.addMover(walker, PUSH);
    const dist = shrub ? 5.5 : 4.5;
    vp.reframe([xc, groundHeight(xc, zp) + (shrub ? 0.4 : 0.15), zp], dist, { yaw: 0, pitch: shrub ? -0.45 : -0.6 });
    for (let i = 0; i < 30; i++) frame();
    let shrubBox = null;
    if (shrub) shrubBox = screenBox((v) => { shrub.p.node.visible = v; });
    // The walker's screen box each frame (its own motion is masked out).
    const masks = [];
    const boxOf = (x) => {
        const y0 = groundHeight(x, zp);
        let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
        for (const dx of [-R, R]) for (const dz of [-R, R]) for (const y of [y0, y0 + 2 * (HALF + R)]) {
            const s = vp.toScreen([x + dx, y, zp + dz]);
            if (!s) continue;
            u0 = Math.min(u0, s.x / innerWidth); u1 = Math.max(u1, s.x / innerWidth); v0 = Math.min(v0, s.y / innerHeight); v1 = Math.max(v1, s.y / innerHeight);
        }
        return u1 > u0 ? [u0 - 0.025, v0 - 0.03, u1 + 0.025, v1 + 0.02] : null;
    };
    const regions = shrubBox ? [{ name: 'shrub', rect: shrubBox }, { name: 'ground', rect: [0, 0, 1, 1] }] : [{ name: 'ground', rect: [0, 0, 1, 1] }];
    const label = `mover_${through}_${wind}${hidden ? '' : '_body'}${floorTag()}`;
    const run = new MotionRun({ name: label, out: OUT, fps, keepFrames: true, frames: F, regions,
                                mask: (k) => (masks[k] ? [masks[k]] : []),
                                notes: [`a walker (capsule r ${R} m, ${2 * (HALF + R)} m tall, grass mover radius ${PUSH.radius} strength ${PUSH.strength} trample ${PUSH.trample}) ` +
                                        `at ${SPEED} m/s along x from ${x0} to ${x1} at z ${zp}, through ${through === 'shrub' ? 'the boxwood (and the grass round it)' : through === 'bracken' ? 'bracken in a short sward' : 'the meadow (grass and its herbs)'}; wind ${wind}`,
                                        hidden ? 'the walker is not drawn (body=hidden): only what it does to the plants is seen' : 'the walker\'s own body is masked out of every frame'],
                                eventMeta: (m) => (m.wx !== undefined ? `walker at x ${m.wx.toFixed(2)}` : '') });
    const wx = [];
    for (let k = 0; k < F; k++) {
        const t = k / fps - LEAD;
        const x = Math.min(x1, x0 + SPEED * Math.max(0, t));
        place(x);
        wx.push(x);
        masks.push(hidden ? null : boxOf(x));
        frame();
        run.grab({ t: k / fps, wx: x });
    }
    const s = run.finish();
    // Each block: the ground under it, its distance from the path and when
    // the walker's centre passed it; its speed and its displacement along its
    // own largest excursion (cm), against the time since that passage.
    const tPass = (x) => LEAD + (x - x0) / SPEED;
    const PRE = Math.round(1.5 * fps), POST = Math.round(AFTER * fps) - 2, L = PRE + POST;
    const BINS = [[0, 0.3], [0.3, 0.6], [0.6, 1.0], [1.0, 1.5], [1.5, 2.5], [2.5, 4]];
    const acc = BINS.map(() => ({ n: 0, speed: new Float64Array(L), disp: new Float64Array(L), cnt: new Float64Array(L), chg: new Float64Array(L), ccnt: new Float64Array(L) }));
    const st = [], shrubAcc = { n: 0, speed: new Float64Array(F - 1), cnt: new Float64Array(F - 1), chg: new Float64Array(F), ccnt: new Float64Array(F) };
    const N = run.V.length;
    // Change from rest: each block against the first frame (the walker off
    // screen, nothing else moving in still air), blank while the walker covers it.
    const change = run.changeFrom(0);
    const covered = (b, k) => {
        const m = masks[k];
        if (!m) return false;
        const [bx, by] = run.blockCentre(b), u = bx / innerWidth, v = by / innerHeight, pu = 8 / innerWidth, pv = 8 / innerHeight;
        return u + pu >= m[0] && u - pu <= m[2] && v + pv >= m[1] && v - pv <= m[3];
    };
    const chgOf = (b) => change.map((c, k) => (covered(b, k) ? NaN : c[b]));
    for (let b = 0; b < run.nb; b++) {
        const [bx, by] = run.blockCentre(b);
        const reg = run.regionOf(b, N >> 1);
        const p = groundUnder(bx, by, reg === 'shrub' ? 0.5 : 0.15);
        if (!p) continue;
        const s0 = vp.toScreen(p), s1 = vp.toScreen([p[0] + 0.1, p[1], p[2]]), s2 = vp.toScreen([p[0], p[1], p[2] + 0.1]);
        if (!s0 || !s1 || !s2) continue;
        const pxPerM = 0.5 * (Math.hypot(s1.x - s0.x, s1.y - s0.y) + Math.hypot(s2.x - s0.x, s2.y - s0.y)) / 0.1;
        const cm = 100 / pxPerM;
        const sp = [], path = [[0, 0]];
        let valid = 0;
        for (let k = 0; k < N; k++) {
            const ok = run.reliable[k][b] === 1;
            const vx = ok ? run.V[k][2 * b] : 0, vy = ok ? run.V[k][2 * b + 1] : 0;
            if (ok) valid++;
            sp.push(ok ? Math.hypot(vx, vy) * cm * fps : NaN);
            path.push([path[k][0] + vx * cm, path[k][1] + vy * cm]);
        }
        if (reg === 'shrub') {
            for (let k = 0; k < N; k++) if (Number.isFinite(sp[k])) { shrubAcc.speed[k] += sp[k]; shrubAcc.cnt[k]++; }
            const ch = chgOf(b);
            for (let k = 0; k < F; k++) if (Number.isFinite(ch[k])) { shrubAcc.chg[k] += ch[k]; shrubAcc.ccnt[k]++; }
            shrubAcc.n++;
            continue;
        }
        const d = Math.abs(p[2] - zp), kp = Math.round(tPass(p[0]) * fps);
        if (p[0] < x0 + 0.5 || p[0] > x1 - 0.5 || kp - PRE < 0 || kp + POST > N) continue;
        const bin = BINS.findIndex(([a, c]) => d >= a && d < c);
        if (bin < 0) continue;
        const A = acc[bin], ch = chgOf(b);
        A.nc = (A.nc || 0) + 1;
        for (let j = 0; j < L; j++) { const k = kp - PRE + j; if (Number.isFinite(ch[k])) { A.chg[j] += ch[k]; A.ccnt[j]++; } }
        st.push({ b, x: p[0], z: p[2], d, kp, ch });
        if (valid < 0.5 * N) continue;
        // Tracked: its push direction, the largest excursion from where it
        // stood before the walker came.
        const base = path[kp - PRE];
        let best = 0, dir = [1, 0];
        for (let j = 0; j < L; j++) {
            const q = path[kp - PRE + j], e = Math.hypot(q[0] - base[0], q[1] - base[1]);
            if (e > best) { best = e; dir = [(q[0] - base[0]) / e, (q[1] - base[1]) / e]; }
        }
        A.n++;
        for (let j = 0; j < L; j++) {
            const k = kp - PRE + j, q = path[k];
            A.disp[j] += (q[0] - base[0]) * dir[0] + (q[1] - base[1]) * dir[1];
            if (Number.isFinite(sp[k])) { A.speed[j] += sp[k]; A.cnt[j]++; }
        }
    }
    const lines = [`mover through ${through} (${wind}): ${label}`];
    const tau = (j) => (j - PRE) / fps;
    const f2 = (v, w = 6) => (v === null ? '-' : v.toFixed(2)).padStart(w);
    lines.push(`blocks by distance |d| from the walker's path, aligned on the moment its centre passed them (tau = 0; its body spans tau -${(R / SPEED).toFixed(2)} .. +${(R / SPEED).toFixed(2)} s, ` +
               `the push disc tau -${((PUSH.radius) / SPEED).toFixed(2)} .. +${(PUSH.radius / SPEED).toFixed(2)} s at |d| 0).`);
    lines.push(`change from rest (rms luma levels against the first frame; still air, so any change is the walker's doing):`);
    lines.push('  |d| m      blocks  onset tau  peak (tau)        to 50% s  to 10% s  left at end (+' + AFTER + ' s)');
    const prof = [];
    BINS.forEach(([a, c], i) => {
        const A = acc[i];
        if (!A.nc) { lines.push(`  ${a}-${c}: no blocks`); return; }
        const ch = Array.from(A.chg, (v, j) => (A.ccnt[j] ? v / A.ccnt[j] : NaN));
        const base = ch.slice(0, Math.round(0.7 * fps)).filter(Number.isFinite);
        const b0 = base.length ? base.reduce((p, q) => p + q, 0) / base.length : 0;
        const onset = ch.findIndex((v) => v > b0 + 1);
        let pj = 0;
        for (let j = 0; j < L; j++) if (ch[j] > (ch[pj] || -1)) pj = j;
        const pk = ch[pj] - b0;
        const to = (f) => { const j = ch.findIndex((v, j2) => j2 > pj && v - b0 < f * pk); return j >= 0 ? tau(j) - tau(pj) : null; };
        const end = ch.slice(-5).filter(Number.isFinite);
        const left = end.length ? end.reduce((p, q) => p + q, 0) / end.length - b0 : NaN;
        lines.push(`  ${`${a}-${c}`.padEnd(9)} ${String(A.nc).padStart(7)} ${onset >= 0 ? f2(tau(onset), 9) : '     none'}  ${pk.toFixed(1).padStart(6)} (${tau(pj).toFixed(2)})  ` +
                   `${to(0.5) === null ? '   never' : f2(to(0.5), 8)}  ${to(0.1) === null ? '   never' : f2(to(0.1), 8)}  ${left.toFixed(1)} (${(100 * left / Math.max(pk, 1e-3)).toFixed(0)}% of peak)`);
        prof.push(A.prof = { label: `|d| ${a}-${c} m (${A.nc} blocks)`, chg: ch.map((v) => (Number.isFinite(v) ? v - b0 : 0)), disp: true });
    });
    lines.push(`tracked motion (speed cm/s; displacement cm along each block's own largest excursion; image motion over the ground's scale at 15 cm up):`);
    lines.push('  |d| m      blocks  base cm/s  onset s  peak speed (tau)   peak disp cm (tau)  back to 10% s  overshoot  left at end');
    BINS.forEach(([a, c], i) => {
        const A = acc[i];
        if (!A.n) { lines.push(`  ${a}-${c}: no tracked blocks`); return; }
        const speed = Array.from(A.speed, (v, j) => (A.cnt[j] ? v / A.cnt[j] : 0)), disp = Array.from(A.disp, (v) => v / A.n);
        const pre = speed.slice(0, Math.round(0.7 * fps));
        const bm = pre.reduce((p, q) => p + q, 0) / pre.length, bsd = Math.sqrt(pre.reduce((p, q) => p + (q - bm) ** 2, 0) / pre.length);
        const onset = speed.findIndex((v, j) => j > 0.7 * fps && v > bm + Math.max(3 * bsd, 1));
        let pj = 0, dj = 0;
        for (let j = 0; j < L; j++) { if (speed[j] > speed[pj]) pj = j; if (disp[j] > disp[dj]) dj = j; }
        const peakD = disp[dj] - disp[0];
        const back = disp.findIndex((v, j) => j > dj && v - disp[0] < 0.1 * peakD);
        let under = 0;
        for (let j = dj; j < L; j++) under = Math.min(under, disp[j] - disp[0]);
        lines.push(`  ${`${a}-${c}`.padEnd(9)} ${String(A.n).padStart(7)} ${bm.toFixed(1).padStart(10)} ${onset >= 0 ? tau(onset).toFixed(2).padStart(8) : '    none'} ` +
                   `${speed[pj].toFixed(1).padStart(9)} (${tau(pj).toFixed(2)})  ${peakD.toFixed(2).padStart(10)} (${tau(dj).toFixed(2)})  ` +
                   `${back >= 0 ? (tau(back) - tau(dj)).toFixed(2).padStart(12) : '       never'}  ${(peakD > 0 ? 100 * -under / peakD : 0).toFixed(0).padStart(7)}%  ${(peakD > 0 ? 100 * (disp[L - 1] - disp[0]) / peakD : 0).toFixed(0).padStart(8)}%`);
    });
    if (shrub) {
        const sp = Array.from(shrubAcc.speed, (v, k) => (shrubAcc.cnt[k] ? v / shrubAcc.cnt[k] : 0));
        // When the walker's capsule is inside the crown's reach.
        const inside = wx.map((x) => Math.hypot(x - shrub.x, 0) < shrub.crown + R);
        const kin = inside.indexOf(true), kout = inside.lastIndexOf(true);
        const mean = (a, b) => { let s = 0, n = 0; for (let k = Math.max(0, a); k < Math.min(sp.length, b); k++) { s += sp[k]; n++; } return n ? s / n : 0; };
        const before = mean(0, Math.round(LEAD * fps)), during = kin >= 0 ? mean(kin, kout + 1) : 0, after = mean(kout + fps, sp.length);
        lines.push(`the boxwood (${shrub.height.toFixed(2)} m tall, crown radius ${shrub.crown.toFixed(2)} m; ${shrubAcc.n} blocks over it):`);
        lines.push(kin >= 0 ? `  the walker's body is inside its crown from ${(kin / fps).toFixed(2)} s to ${(kout / fps).toFixed(2)} s (${((kout - kin + 1) / fps).toFixed(2)} s, ` +
                              `${(2 * (shrub.crown + R)).toFixed(2)} m of path): interpenetration unless the shrub parts` : '  the walker never reaches its crown');
        const chs = Array.from(shrubAcc.chg, (v, k) => (shrubAcc.ccnt[k] ? v / shrubAcc.ccnt[k] : 0));
        const meanC = (a, b) => { let s = 0, n = 0; for (let k = Math.max(0, a); k < Math.min(chs.length, b); k++) { s += chs[k]; n++; } return n ? s / n : 0; };
        lines.push(`  its visible blocks' mean speed: before ${before.toFixed(2)} cm/s, while the walker is inside ${during.toFixed(2)} cm/s, after ${after.toFixed(2)} cm/s ` +
                   `(x${(during / Math.max(before, 0.01)).toFixed(1)} while inside)`);
        lines.push(`  its change from rest (levels; the walker's body masked): while inside ${meanC(kin, kout + 1).toFixed(2)}, 1 s after it leaves ${meanC(kout + fps, kout + 2 * fps).toFixed(2)}, at the end ${meanC(F - 5, F).toFixed(2)}`);
        prof.push({ label: 'boxwood blocks (time from the run start)', chg: chs, speed: sp, disp: null, marks: kin >= 0 ? [kin, kout] : [] });
    }
    // The sheet: change from rest by distance, and space-time maps of the
    // change of the blocks within 0.6 m of the path, near side and far
    // (columns along the path, time down).
    const S = sheet();
    sway.plotTracks(S, prof.map((p) => ({ label: p.label, xs: p.chg, color: '#fc6', marks: p.marks || [PRE],
                                          note: p.disp ? `change from rest (levels); red = walker's centre passes` : 'change from rest (levels); red = walker enters / leaves the crown' })),
                    0, 0, 1280, 400, fps, `${label}: change from rest by distance from the path, -1.5 .. +${AFTER} s about the walker's passage`, 'levels');
    const NC = 64, eye = vp.ray(innerWidth / 2, innerHeight / 2).origin;
    const sideOf = (z) => Math.sign(z - zp) === Math.sign(eye[2] - zp) ? 'near' : 'far';
    ['near', 'far'].forEach((side, si) => {
        const cols = [], cn = [];
        for (let c = 0; c < NC; c++) { cols.push(new Float64Array(F)); cn.push(new Float64Array(F)); }
        for (const e of st) {
            if (e.d > 0.6 || sideOf(e.z) !== side) continue;
            const c = Math.floor((e.x - x0) / (x1 - x0) * NC);
            if (c < 0 || c >= NC) continue;
            for (let k = 0; k < F; k++) if (Number.isFinite(e.ch[k])) { cols[c][k] += e.ch[k]; cn[c][k]++; }
        }
        // Every other frame keeps the map inside the sheet.
        const step = Math.max(1, Math.ceil(F / 250));
        sway.plotSpaceTime(S, cols.map((col, c) => { const o = []; for (let k = 0; k < F; k += step) o.push(cn[c][k] ? col[k] / cn[c][k] : 0); return o; }),
                           si * 640, 405, 630, 285,
                           `${side} side, |d| < 0.6 m: change along the path (x ${x0}..${x1}) across, time down (${(F / fps).toFixed(1)} s)`, '');
    });
    lines.push(S.save(`${OUT}/${label}_response.jpg`));
    lines.push(`image summary: ${OUT}/${label}_motion.txt (flags: ${s.flags.length})`);
    require('fs').writeFileSync(`${OUT}/${label}_response.txt`, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    g.removeMover(walker);
    walker.destroy();
    if (through === 'bracken') { g.setHerbs({ species: MEADOW_HERBS }); g.setGrass({ height: grassH }); }
    roller.running = wasRolling;
    restore();
}

// --- ground truth -----------------------------------------------------------------

// The grove's trees' wood records (emitBranchTubes, drawn at PLANT_SCALE),
// grouped by tree (root).
function groveTrees() {
    const tubes = grove.world.emitBranchTubes({ sides: 10 }), v = tubes.vegetation, M = sway.model([0, 0, 0], 0, PLANT_SCALE);
    const trees = new Map();
    for (let i = 0; i < tubes.segCount; i++) {
        const rec = Array.from(v.subarray(i * 16, i * 16 + 16)), seg = Array.from(tubes.segments.subarray(i * 8, i * 8 + 8));
        const key = rec.slice(0, 3).map((x) => x.toFixed(3)).join(',');
        if (!trees.has(key)) trees.set(key, []);
        trees.get(key).push({ rec, seg });
    }
    return [...trees.values()].map((recs) => {
        const parts = recs.map((r) => sway.part(r.rec, M, 'tip', [0.6, 0.8], r.seg));
        return { recs: recs.map((r) => r.rec), parts, root: parts[0].root, height: parts[0].height };
    });
}

// A tree's telling parts: the trunk's top, a limb's middle, twig tips low,
// mid and high in the crown, a twig beside the high one, and a leaf on it.
function telling(tree, dir) {
    const P = tree.parts.map((p, i) => ({ p, i, tipW: tree.recs[i][9] }));
    const pick = [];
    const trunk = P.filter((q) => q.tipW <= 1e-3).sort((a, b) => b.p.rest[1] - a.p.rest[1])[0];
    if (trunk) pick.push({ name: 'trunk top', p: trunk.p });
    const limbMid = P.filter((q) => q.tipW > 0.4 && q.tipW < 0.6).sort((a, b) => b.p.rest[1] - a.p.rest[1]);
    if (limbMid.length) pick.push({ name: 'limb middle', p: limbMid[limbMid.length >> 1].p });
    const twigs = P.filter((q) => q.tipW > 0.95 && q.p.limb.twig.sway > 0).sort((a, b) => a.p.rest[1] - b.p.rest[1]);
    const at = (f) => twigs[Math.min(twigs.length - 1, Math.floor(f * twigs.length))];
    if (twigs.length) {
        pick.push({ name: 'twig low', p: at(0.15).p }, { name: 'twig middle', p: at(0.5).p });
        const hi = at(0.9);
        pick.push({ name: 'twig high', p: hi.p });
        const nb = twigs.filter((q) => q !== hi && Math.hypot(...[0, 1, 2].map((k) => q.p.rest[k] - hi.p.rest[k])) < 0.8 &&
                                     q.p.limb.phase !== hi.p.limb.phase).sort((a, b) =>
            Math.hypot(...[0, 1, 2].map((k) => a.p.rest[k] - hi.p.rest[k])) - Math.hypot(...[0, 1, 2].map((k) => b.p.rest[k] - hi.p.rest[k])))[0];
        if (nb) pick.push({ name: 'twig beside high (other limb)', p: nb.p });
        pick.push({ name: 'leaf on twig high', p: hi.p, leaf: { len: 0.12 * PLANT_SCALE } });
        // Twigs on the crown's upwind and downwind sides, in its upper half:
        // a gust should reach one before the other.
        if (dir) {
            const s = (q) => (q.p.rest[0] - tree.root[0]) * dir[0] + (q.p.rest[2] - tree.root[2]) * dir[2];
            const upper = twigs.filter((q) => q.p.rest[1] - tree.root[1] > 0.5 * tree.height).sort((a, b) => s(a) - s(b));
            if (upper.length > 4) {
                pick.push({ name: 'twig upwind', p: upper[0].p }, { name: 'twig downwind', p: upper[upper.length - 1].p });
            }
        }
    }
    return pick;
}

function truth() {
    const wind = opt('wind', 'gusty'), seconds = +opt('seconds', 20), N = Math.round(seconds * fps);
    // The GPU path: its first node is the wood alone, the render check below.
    draw('gpu');
    setWind(wind);
    scene.setDither(false);
    sky.apply('noon');
    frame();
    const params = scene.wind();
    const lines = [`ground truth: the grove's broadleaves in ${wind} (setWind ${JSON.stringify({ speed: params.speed, gust: params.gust, gustSpeed: params.gustSpeed, gustScale: params.gustScale })})`];
    // The port against the engine's field.
    let werr = 0;
    for (let i = 0; i < 20; i++) { frame(); werr = Math.max(werr, sway.checkWind(scene, [[6.5, 9.5], [-8, -1.5], [9, 0.5], [40, 40]])); }
    lines.push(`wind port vs scene.windAt: largest gust difference ${werr.toExponential(1)}`);
    const trees = groveTrees();
    const main = trees.sort((a, b) => Math.hypot(a.root[0] - 6.5, a.root[2] - 9.5) - Math.hypot(b.root[0] - 6.5, b.root[2] - 9.5))[0];
    const parts = telling(main, params.now.direction);
    const t0 = +opt('clock', scene.wind().time);
    const dir3 = (ws) => [ws.dir[0], 0, ws.dir[1]];
    const trackAll = (t0_, n) => parts.map((q) => {
        const xs = [], ph = [], amps = [];
        let ws;
        for (let k = 0; k < n; k++) {
            ws = sway.windStateAt(params, t0_ + k / fps);
            const r = sway.position(q.p, ws, q.leaf);
            xs.push(r.p);
            if (q.leaf) { ph.push(r.phase); amps.push(r.flutterAmp); }
        }
        return { q, xs, ph: q.leaf ? ph : null, a: sway.analyse(xs, fps, dir3(ws), q.leaf ? ph : null) };
    });
    const tracks = trackAll(t0, N);
    lines.push(`tree at (${main.root[0].toFixed(1)}, ${main.root[2].toFixed(1)}), ${main.height.toFixed(1)} m, ${main.recs.length} segments; ${seconds} s from wind clock ${t0.toFixed(1)} s`);
    lines.push('part                         rms cm   p-p cm  dom Hz  >4Hz share  max move cm/frame (frame)  speed cm/s  jerk spikes');
    for (const tr of tracks) {
        const a = tr.a;
        lines.push(`${tr.q.name.padEnd(28)} ${(a.rms * 100).toFixed(2).padStart(6)} ${(a.pp * 100).toFixed(2).padStart(8)} ${a.domHz.toFixed(2).padStart(7)} ` +
                   `${a.fastShare.toFixed(2).padStart(10)} ${(a.maxStep * 100).toFixed(2).padStart(10)} (${a.maxStepAt})${''.padStart(8)} ${(a.speedRms * 100).toFixed(1).padStart(8)}  ${a.spikes.length}`);
    }
    // How much of each part's motion is the drag's mean bend (the same for
    // every part of a tree, scaled), how much its own ringing.
    const along = (tr) => tr.xs.map((p) => p[0] * params.now.direction[0] + p[2] * params.now.direction[2]);
    sway.debug.ring = 0;
    const meanOnly = trackAll(t0, N);
    // The same bend under the drag at the root alone (as if every limb felt
    // the trunk's wind): the share of the motion all the tree's parts share.
    sway.debug.local = 0;
    const rootOnly = trackAll(t0, N);
    sway.debug.ring = 1;
    sway.debug.local = 1;
    const vr = (s) => { const m = s.reduce((a, b) => a + b, 0) / s.length; return s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length; };
    lines.push('share of each part\'s along-wind variance that is the mean bend under the drag where it is (ring off), its correlation with the whole;');
    lines.push('and that under the drag at the root (the one bend every part shares):');
    const shares = [];
    tracks.forEach((tr, i) => {
        const a = along(tr), m = along(meanOnly[i]), r = along(rootOnly[i]);
        shares.push(vr(r) / vr(a));
        lines.push(`  ${tr.q.name.padEnd(28)} ${(100 * vr(m) / vr(a)).toFixed(0).padStart(4)}%  corr ${sway.correlate(a, m, 0).corr.toFixed(2)}` +
                   `   root drag ${(100 * vr(r) / vr(a)).toFixed(0).padStart(4)}%  corr ${sway.correlate(a, r, 0).corr.toFixed(2)}`);
    });
    // Jerk spikes: what happens in the drag then. A gust band's edge (the
    // gust leaving 0, now or at the reads' lags) and the ringing's kick
    // (the trunk drag against its past crossing).
    const ev = [];
    const tf = parts[0].p.trunk.freq, lagT = sway.lagOf(tf), spanT = Math.min(0.5 / Math.max(tf, 0.05), 1.5);
    for (let k = 1; k < N; k++) {
        const s0 = sway.windStateAt(params, t0 + (k - 1) / fps), s1 = sway.windStateAt(params, t0 + k / fps);
        const g = (s, dt) => sway.gustAt(s, main.root[0], main.root[2], s.t - dt, true) > 0.5 * sway.GUST_SOFT * 2.4 * s.gust;
        if ([0, 0.4, lagT, lagT + spanT].some((dt) => g(s0, dt) !== g(s1, dt))) ev.push([k, 'a gust band edge']);
        const dk = (s) => sway.dragAt(s, main.root[0], main.root[2], s.t - lagT) - sway.dragAt(s, main.root[0], main.root[2], s.t - lagT - spanT);
        if (Math.sign(dk(s0)) !== Math.sign(dk(s1))) ev.push([k, 'drag vs its past cross (kick)']);
    }
    for (const tr of tracks) {
        if (!tr.a.spikes.length) continue;
        const why = tr.a.spikes.map((s) => { const e = ev.find((x) => Math.abs(x[0] - s.frame) <= 2); return e ? e[1] : 'none'; });
        const count = {};
        for (const w of why) count[w] = (count[w] || 0) + 1;
        lines.push(`  ${tr.q.name}: ${tr.a.spikes.length} jerk spikes (frames ${tr.a.spikes.slice(0, 8).map((s) => s.frame).join(',')}${tr.a.spikes.length > 8 ? ',..' : ''}); ` +
                   `within 2 frames of: ${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    // Coherence between the parts (along the wind).
    lines.push('coherence (peak correlation @ lag frames, + = column after row):');
    lines.push(''.padEnd(28) + tracks.map((t) => t.q.name.slice(0, 10).padStart(12)).join(''));
    for (const a of tracks) lines.push(a.q.name.padEnd(28) + tracks.map((b) => {
        const c = sway.correlate(along(a), along(b), fps);
        return `${c.corr.toFixed(2)}@${c.lag}`.padStart(12);
    }).join(''));
    // Lockstep in one line: over every pair of parts on different twigs (a
    // leaf and its own twig left out), the correlation at lag 0 and the peak's lag.
    {
        const z0 = [], lags = [];
        for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
            const a = tracks[i].q, b = tracks[j].q;
            if (a.p === b.p) continue;
            const c = sway.correlate(along(tracks[i]), along(tracks[j]), fps);
            z0.push(c.zero); lags.push(Math.abs(c.lag));
        }
        const med = (s) => [...s].sort((p, q) => p - q)[s.length >> 1];
        const up = tracks.find((t) => t.q.name === 'twig upwind'), dn = tracks.find((t) => t.q.name === 'twig downwind');
        const ud = up && dn ? sway.correlate(along(up), along(dn), fps) : null;
        lines.push(`lockstep: ${z0.length} part pairs, correlation at lag 0 median ${med(z0).toFixed(2)} (max ${Math.max(...z0).toFixed(2)}), ` +
                   `|peak lag| median ${med(lags)} frames; root-drag share median ${(100 * med(shares)).toFixed(0)}%` +
                   (ud ? `; upwind -> downwind twig: corr ${ud.corr.toFixed(2)} at lag ${ud.lag} frames` : ''));
    }
    // The leaf's flutter over a long clock: its phase's instantaneous frequency.
    const leaf = parts.find((q) => q.leaf);
    if (leaf) {
        lines.push(`leaf flutter (vegLeafTurn): instantaneous frequency of its phase, 5 s windows at wind clock t (Hz; aliased = |f| > ${fps / 2}, backwards = f < 0):`);
        for (const T of [5, 30, 120, 600, 1800, 3600]) {
            const ph = [], xs = [];
            for (let k = 0; k < 150; k++) {
                const r = sway.position(leaf.p, sway.windStateAt(params, T + k / fps), leaf.leaf);
                ph.push(r.phase); xs.push(r.p);
            }
            const a = sway.analyse(xs, fps, [1, 0, 0], ph).flutterHz;
            lines.push(`  t=${String(T).padStart(5)} s: median ${a.median.toFixed(1)}, 5-95% ${a.p05.toFixed(1)} .. ${a.p95.toFixed(1)}, ` +
                       `min ${a.min.toFixed(0)} max ${a.max.toFixed(0)}; aliased ${(100 * a.aliased).toFixed(0)}%, backwards ${(100 * a.backwards).toFixed(0)}%`);
        }
    }
    // The stand: every tree's trunk top, along the wind.
    const tops = trees.map((tr) => {
        const P = tr.parts.map((p, i) => ({ p, w: tr.recs[i][9] })).filter((q) => q.w <= 1e-3);
        const top = (P.length ? P : tr.parts.map((p) => ({ p }))).sort((a, b) => b.p.rest[1] - a.p.rest[1])[0].p;
        const xs = [];
        for (let k = 0; k < N; k++) xs.push(sway.position(top, sway.windStateAt(params, t0 + k / fps)).p);
        const d = params.now.direction, s = top.root[0] * d[0] + top.root[2] * d[2];
        return { s, top, xs, x: along({ xs }) };
    }).sort((a, b) => a.s - b.s);
    lines.push(`the stand: ${tops.length} plants' trunk tops (or highest wood), along the wind; gusts travel at ${params.gustSpeed} m/s`);
    const pairs = [];
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
        const c = sway.correlate(tops[i].x, tops[j].x, 2 * fps);
        pairs.push({ ds: tops[j].s - tops[i].s, c });
    }
    pairs.sort((a, b) => a.ds - b.ds);
    for (const p of pairs.filter((_, i) => i % Math.max(1, Math.floor(pairs.length / 12)) === 0))
        lines.push(`  ${p.ds.toFixed(1).padStart(6)} m apart along the wind: corr ${p.c.corr.toFixed(2)} at lag ${p.c.lag} frames (${(p.c.lag / fps).toFixed(2)} s; ` +
                   `a gust takes ${(p.ds / params.gustSpeed).toFixed(2)} s), corr at lag 0 ${p.c.zero.toFixed(2)}`);
    // The sheets.
    const S = sheet();
    const cm = (tr, k) => tr.xs.map((p) => 100 * (p[k === 'a' ? 0 : 2] * (k === 'a' ? 1 : 1)));
    const det = (s) => { const m = s.reduce((a, b) => a + b, 0) / s.length; return s.map((v) => v - m); };
    const d = params.now.direction;
    sway.plotTracks(S, tracks.map((tr) => ({
        label: tr.q.name,
        xs: det(tr.xs.map((p) => 100 * (p[0] * d[0] + p[2] * d[2]))), ys: det(tr.xs.map((p) => 100 * (-p[0] * d[2] + p[2] * d[0]))),
        marks: tr.a.spikes.map((s) => s.frame),
        note: `rms ${(tr.a.rms * 100).toFixed(1)} cm, ${tr.a.domHz.toFixed(2)} Hz, max ${(tr.a.maxStep * 100).toFixed(2)} cm/frame` +
              (tr.a.flutterHz ? `, flutter ${tr.a.flutterHz.p05.toFixed(0)}..${tr.a.flutterHz.p95.toFixed(0)} Hz` : ''),
    })), 0, 0, 1280, 430, fps, `truth: grove broadleaf parts, ${wind}, ${seconds} s from wind clock ${t0.toFixed(0)} s: along the wind (green) and across (blue), cm; red = jerk spikes`);
    sway.plotSpaceTime(S, tops.map((t) => det(t.x)), 0, 440, 640, 250, 'the stand: trunk tops (columns, upwind left), time down; red downwind',
                       tops.map((t) => t.s.toFixed(0)).join(' '));
    // Drag at each root (the gust field), same layout: the cause beside the effect.
    sway.plotSpaceTime(S, tops.map((t) => { const out = []; for (let k = 0; k < N; k++) out.push(sway.dragAt(sway.windStateAt(params, t0 + k / fps), t.top.root[0], t.top.root[2], t0 + k / fps)); return det(out); }),
                       660, 440, 620, 250, 'drag p0 at each root (the gusts)', '');
    const fileT = S.save(`${OUT}/truth_${wind}_tracks.jpg`);
    lines.push(fileT);
    // Verify against the render: the wood alone, side on; the image's own
    // tracks of the trunk top and the limb's middle against the truth's.
    const restore = only([grove.nodes[0]]);
    const x = main.root[0], z = main.root[2], base = groundHeight(x, z);
    vp.reframe([x, base + main.height * 0.55, z], main.height * 1.3, { yaw: across(), pitch: 0 });
    for (let i = 0; i < 30; i++) frame();
    const F = 150;
    const run = new MotionRun({ name: `truth_${wind}_bark`, out: OUT, fps, keepFrames: true, frames: F, notes: ['the grove trees\' wood alone (no leaves), side on: the truth check'] });
    const wss = [];
    for (let k = 0; k < F; k++) { frame(); wss.push(sway.windState(scene)); run.grab({ t: wss[k].t }); }
    run.finish();
    // Every tracked block against the wood under it: each block takes the
    // nearest segment midpoint (all trees, projected at rest) within 5 px,
    // and its image motion is compared with that point's true motion.
    const cand = [];
    for (const tr of trees) tr.parts.forEach((p) => {
        const s = vp.toScreen(p.rest);
        if (!s || s.behind || s.x < 0 || s.y < 0 || s.x >= innerWidth || s.y >= innerHeight) return;
        cand.push({ p, x: s.x, y: s.y, depth: s.depth });
    });
    const assign = new Map();
    for (let b = 0; b < run.nb; b++) {
        const [bx, by] = run.blockCentre(b);
        let best = null, bd = 25;
        for (const c of cand) { const d = (c.x - bx) ** 2 + (c.y - by) ** 2; if (d < bd || (d === bd && best && c.depth < best.depth)) { bd = d; best = c; } }
        if (!best) continue;
        // Alone: no other part within 8 px whose rest differs by more than
        // 30 cm (then the block's texture is that one part's).
        best.alone = !cand.some((c) => c !== best && (c.x - bx) ** 2 + (c.y - by) ** 2 < 64 && Math.hypot(c.p.rest[0] - best.p.rest[0], c.p.rest[1] - best.p.rest[1], c.p.rest[2] - best.p.rest[2]) > 0.3);
        assign.set(b, { ...best });
    }
    const scr = new Map();
    for (const [b, c] of assign) scr.set(b, wss.map((ws) => { const s = vp.toScreen(sway.position(c.p, ws).p); return [s.x, s.y]; }));
    lines.push(`truth vs the rendered wood: ${assign.size} blocks over a segment's tip; their image motion (px/frame) against the truth's, by lag (frames):`);
    for (let lag = -2; lag <= 2; lag++) {
        let sxy = 0, sxx = 0, syy = 0, n = 0, se = 0;
        for (const [b, s] of scr) for (let k = 2; k + 1 < F - 2; k++) {
            if (run.reliable[k][b] !== 1) continue;
            const kt = k + lag;
            const tv = [s[kt + 1][0] - s[kt][0], s[kt + 1][1] - s[kt][1]], iv = [run.V[k][2 * b], run.V[k][2 * b + 1]];
            for (let a = 0; a < 2; a++) { sxy += tv[a] * iv[a]; sxx += tv[a] * tv[a]; syy += iv[a] * iv[a]; se += (iv[a] - tv[a]) ** 2; n++; }
        }
        lines.push(`  lag ${lag >= 0 ? '+' : ''}${lag}: ${n / 2} samples, corr ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)}, image = ${(sxy / sxx).toFixed(2)} x truth, ` +
                   `truth rms ${Math.sqrt(sxx / n).toFixed(3)}, error rms ${Math.sqrt(se / n).toFixed(3)} px/frame`);
    }
    // Per block, the image's integrated path against the truth's (frame
    // noise sums away; a block with a lost pair is skipped), along the
    // truth's main screen axis, for blocks the truth moves 2 px or more.
    const per = [];
    for (const [b, s] of scr) {
        let ok = true;
        for (let k = 0; k < F - 1 && ok; k++) if (!(run.reliable[k][b] >= 1) || !Number.isFinite(run.V[k][2 * b])) ok = false;
        if (!ok) continue;
        const tx = s.map((p) => p[0] - s[0][0]), ty = s.map((p) => p[1] - s[0][1]);
        const ix = [0], iy = [0];
        for (let k = 0; k < F - 1; k++) { ix.push(ix[k] + run.V[k][2 * b]); iy.push(iy[k] + run.V[k][2 * b + 1]); }
        const vx = vr(tx), vy = vr(ty);
        const [T, I] = vx >= vy ? [tx, ix] : [ty, iy];
        const pp = Math.max(...T) - Math.min(...T);
        if (pp < 2) continue;
        const mT = T.reduce((a, v) => a + v, 0) / F, mI = I.reduce((a, v) => a + v, 0) / F;
        let c = 0, tt = 0, ii = 0;
        for (let k = 0; k < F; k++) { c += (T[k] - mT) * (I[k] - mI); tt += (T[k] - mT) ** 2; ii += (I[k] - mI) ** 2; }
        per.push({ corr: c / Math.sqrt(tt * ii), slope: c / tt, pp, alone: assign.get(b).alone });
    }
    const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
    for (const [label, set] of [['all', per], ['one part alone in the block', per.filter((p) => p.alone)]]) {
        if (!set.length) continue;
        const cs = set.map((p) => p.corr), ss = set.map((p) => p.slope);
        lines.push(`  integrated paths (${label}), ${set.length} steady blocks moving >= 2 px: corr median ${q(cs, 0.5).toFixed(2)} (p10 ${q(cs, 0.1).toFixed(2)}, p90 ${q(cs, 0.9).toFixed(2)}), ` +
                   `image = ${q(ss, 0.5).toFixed(2)} x truth (p10 ${q(ss, 0.1).toFixed(2)}, p90 ${q(ss, 0.9).toFixed(2)}), truth p-p median ${q(set.map((p) => p.pp), 0.5).toFixed(1)} px`);
    }
    restore();
    require('fs').writeFileSync(`${OUT}/truth_${wind}.txt`, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
}

// Leaves on their twigs (the forest path: bro.scene's scene_forest_shoot.glsl,
// ported in sway.js): for leaves across the grove broadleaf's crown, where
// each leaf's node is and where its shoot's twig is drawn at that point
// (the ribbon is straight between its pieces' posed ends) over `seconds` of
// wind, and how far the leaf's tip moves about its node. A leaf that stays
// on its twig has a gap far under its petiole.
function twigs() {
    const wind = opt('wind', 'gusty'), seconds = +opt('seconds', 10), N = Math.round(seconds * fps);
    draw('forest');
    setWind(wind);
    frame();
    const params = scene.wind();
    const e = grove.forest.emit;
    const opts = { seed: e.seed, upBias: e.upBias, tiltJitter: e.tiltJitter, shell: e.shell, baseScale: e.baseScale,
                   scaleJitter: e.scaleJitter };
    // The node's leaf: the default card (0.12) times its specimens' mean leaf size.
    let ls = 0, ln = 0;
    for (let i = 7; i < e.specimenLooks.length; i += 8) if (e.specimenLooks[i] > 0) { ls += e.specimenLooks[i]; ln++; }
    opts.Lf = 0.12 * Math.min(3, Math.max(0.2, ln ? ls / ln : 1)) * e.baseScale;
    // The specimen nearest the grove's tree.
    const sp = e.specimens, nSpec = sp.length / 16;
    let best = 0, bd = Infinity;
    for (let s = 0; s < nSpec; s++) {
        const d = Math.hypot(sp[s * 16 + 12] * PLANT_SCALE - 6.5, sp[s * 16 + 14] * PLANT_SCALE - 9.5);
        if (d < bd) { bd = d; best = s; }
    }
    // (emitForest's specimens: ..., origin xyz at 12, clumpFlat at 15.)
    const o = [sp[best * 16 + 12], sp[best * 16 + 13], sp[best * 16 + 14]];
    const M = sway.model(o.map((v) => v * PLANT_SCALE), 0, PLANT_SCALE);
    const c0 = sp[best * 16 + 2], cn = sp[best * 16 + 3];
    const flat = sp[best * 16 + 15] > 0 ? sp[best * 16 + 15] : 1;
    const petiole = e.specimenLeaves[best * 8 + 6], phyllo = Math.round(e.specimenLeaves[best * 8 + 7]);
    const keyBase = new Map();
    for (let i = 0; i < e.leaves.length; i += 2) {
        const c = e.leaves[i], k = e.leaves[i + 1];
        if (!keyBase.has(c) || keyBase.get(c) > k) keyBase.set(c, k);
    }
    const toWorld = (pt, w, p, sh, sprayOf, kind, along, t) => {
        const rest = M.apply(p);
        const ps = sway.pose(pt, w, rest, pt.weight);
        const b = sway.shootBend(sprayOf, sh, kind, along, ps.drag, 1, t);
        return { p: [rest[0] + ps.offset[0] + b.offset[0] * M.scale, rest[1] + ps.offset[1] + b.offset[1] * M.scale,
                     rest[2] + ps.offset[2] + b.offset[2] * M.scale], ps, b };
    };
    const lines = [`leaves on their twigs: specimen ${best} (${cn} clumps), petiole ${petiole.toFixed(2)} of the blade, phyllotaxis ${phyllo}; ` +
                   `${wind}, ${seconds} s, leaf length ${(opts.Lf * PLANT_SCALE * 100).toFixed(1)} cm`];
    const gaps = [], rests = [], relTips = [];
    for (let ci = c0; ci < c0 + cn; ci += Math.max(1, Math.floor(cn / 8))) {
        const rec = Array.from(e.clumps.subarray(ci * 8, ci * 8 + 8));
        if (rec[7] < 1) continue;
        const c = sway.clumpShoots(rec, ci, Object.assign({ flat }, opts), phyllo);
        const veg = Array.from(e.clumpVegetation.subarray(ci * 16, ci * 16 + 16));
        const pt = sway.part([...veg.slice(0, 8), ...rec.slice(0, 3), veg[9], ...veg.slice(12, 16)], M, 'base', [0.6, 0.8]);
        for (let j = 0; j < c.n; j += Math.max(1, Math.floor(c.n / 6))) {
            const L = sway.shootLeaf(c, j), at = L.at;
            const ix = j % c.S;
            const K = sway.PIECES.shoot, u = K * at.x / Math.max(at.shoot.len, 1e-6);
            const piece = Math.min(K - 1, Math.floor(u));
            const p0 = sway.twigEnd(c, sway.shootPiece(c, ix) + piece, 0), p1 = sway.twigEnd(c, sway.shootPiece(c, ix) + piece, 1);
            const f = u - piece;
            const pet = petiole * opts.Lf * L.size * PLANT_SCALE;
            let gmax = 0, rmax = 0, rel0 = null, relMax = 0;
            for (let k = 0; k < N; k++) {
                const ws = sway.windStateAt(params, params.time + k / fps);
                const w = sway.vegWind(ws, pt.root, pt.trunk.freq);
                const leaf = toWorld(pt, w, L.P, at.shoot, at.spray, 2, at.x, ws.t);
                const a = toWorld(pt, w, p0.p, at.shoot, at.spray, 2, p0.along, ws.t).p;
                const b = toWorld(pt, w, p1.p, at.shoot, at.spray, 2, p1.along, ws.t).p;
                const tw = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
                gmax = Math.max(gmax, Math.hypot(leaf.p[0] - tw[0], leaf.p[1] - tw[1], leaf.p[2] - tw[2]));
                if (k === 0) {
                    const ra = M.apply(p0.p), rb = M.apply(p1.p), rp = M.apply(L.P);
                    const rt = [ra[0] + (rb[0] - ra[0]) * f, ra[1] + (rb[1] - ra[1]) * f, ra[2] + (rb[2] - ra[2]) * f];
                    rmax = Math.hypot(rp[0] - rt[0], rp[1] - rt[1], rp[2] - rt[2]);
                }
                // The leaf's tip about its node (the wood's and shoot's turn, its own flutter).
                const Fw = sway.rotate(sway.leafTurn({ ...leaf.ps, omega: [leaf.ps.omega[0] + leaf.b.omega[0], leaf.ps.omega[1] + leaf.b.omega[1], leaf.ps.omega[2] + leaf.b.omega[2]] },
                                                     w, L.F, L.N, (j * 0.618) % 1).omega, L.F);
                const tip = Fw.map((v) => v * opts.Lf * L.size * PLANT_SCALE * (1 + petiole));
                if (!rel0) rel0 = tip;
                relMax = Math.max(relMax, Math.hypot(tip[0] - rel0[0], tip[1] - rel0[1], tip[2] - rel0[2]));
            }
            gaps.push({ g: gmax, pet }); rests.push(rmax); relTips.push(relMax);
        }
    }
    const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
    const g = gaps.map((x) => x.g), ratio = gaps.map((x) => x.g / Math.max(x.pet, 1e-6));
    lines.push(`  ${gaps.length} leaves: node to drawn twig, at rest median ${(q(rests, 0.5) * 1000).toFixed(2)} mm, max ${(Math.max(...rests) * 1000).toFixed(2)} mm;`);
    lines.push(`  in the wind max over time: median ${(q(g, 0.5) * 1000).toFixed(2)} mm, p95 ${(q(g, 0.95) * 1000).toFixed(2)} mm, max ${(Math.max(...g) * 1000).toFixed(2)} mm;` +
               ` over its petiole: p95 ${q(ratio, 0.95).toFixed(3)}, max ${Math.max(...ratio).toFixed(3)} (petiole median ${(q(gaps.map((x) => x.pet), 0.5) * 1000).toFixed(1)} mm)`);
    lines.push(`  the tip about its node (turn + flutter), largest excursion: median ${(q(relTips, 0.5) * 100).toFixed(1)} cm, max ${(Math.max(...relTips) * 100).toFixed(1)} cm`);
    require('fs').writeFileSync(`${OUT}/twigs_${wind}.txt`, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
}

const MODES = { calibrate, plant, mover, truth, twigs };
const commands = [[]];
for (const a of argv) a === '+' ? commands.push([]) : commands[commands.length - 1].push(a);
for (const cmd of commands) {
    args = cmd;
    const mode = cmd[0] || 'calibrate';
    const before = new Set(document.body.children);
    const t0 = perf.now();
    contrastFloor(opt('floor') === 'contrast');
    (MODES[mode] || calibrate)(...cmd.slice(1).filter((a) => !a.includes('=')));
    contrastFloor(false);
    console.log(`${mode}: ${((perf.now() - t0) / 1000).toFixed(1)} s wall`);
    for (const el of [...document.body.children]) if (!before.has(el)) el.remove();
    flush();
}
