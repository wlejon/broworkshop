// How plants hold a lean in the wind: the ground truth of the motion oracle
// (lib/kit/sway.js, the GPU's sway ported line for line) for each kind of
// plant, from saplings to tall conifers, under scripted winds. Run in
// headless bro, from broworkshop:
//
//   bro-headless --width 1280 --height 720 demos/grove demos/grove/lean.js -- [label=lean] [plants=a,b,..]
//
// The plants: the grove's own broadleaf ('broadleaf', drawn at PLANT_SCALE),
// every conifer and shrub preset as the grove grows it, and saplings and
// young trees (the fir and oak presets grown SAPLING_SECONDS or
// YOUNG_SECONDS rather than the grove's 50). For
// each, the parts that tell: the stem at a quarter, half, three quarters
// and its top (the leader, followed up its thickest wood), a low and a high
// bough's tip and a high twig.
//
// The runs (the drag scripted through sway.debug.drag, so a run is the
// model's answer to one clean input; the wind blows along +x):
//
//   steady U     the drag of U m/s (2.5, 5, 10, 15), no gusts, 30 s after
//                10 s: the held lean (mean downwind, cm and % of the
//                plant's height), what moves about it (std, and std/mean),
//                the share of frames the part is upwind of its rest (it
//                swings through rest rather than holding a lean), its
//                dominant Hz.
//   step         still to 12 m/s at 2 s (eased over 0.3 s): its peak over
//                the lean it settles to (the overshoot ratio), how many
//                times it swings more than 10% of that lean about it after
//                first reaching it (ring cycles), its time to 90%.
//   gust         5 m/s, a gust to 12 m/s (rising 1 s, held 2 s, falling
//                1 s): the lean it adds, how far it swings back past its
//                lean before the gust after release (overshoot over that
//                added lean), ring cycles after release.
//   gusty,       the grove's winds (the field's own gusts, 30 s): mean,
//   breeze       std/mean, upwind share, dominant Hz, jerk spikes.
//
// Writes demos/grove/captures/motion/<label>.txt / .json and
// <label>_tracks.jpg (the tall conifer's and a sapling's parts through the
// step and the gust).

import { grove, scene, WINDS, PRESET_PLANTS, PLANT_SCALE, groundHeight } from "/app/grove.js";
import { sheet } from "/lib/kit/motion.js";
import * as swayNow from "/lib/kit/sway.js";

const argv = (bro.app && bro.app.argv) || [];
const opt = (k, d) => { const a = argv.find((s) => s.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
// Another port of the GPU's sway (a before model, run against the build it
// matches): a driver script imports a module that sets globalThis.LEAN_SWAY
// to its namespace, then this file.
const sway = globalThis.LEAN_SWAY || swayNow;
const label = opt('label', 'lean');
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/') + '/motion';
require('fs').mkdirSync(OUT, { recursive: true });
const fps = 30;
const SAPLING_SECONDS = 14, YOUNG_SECONDS = 5, SIM_STEP = 0.02;

document.body.classList.add('clean');
flush();

// --- the plants ---------------------------------------------------------------------

// A plant from a world's branch tubes: its records, segments and parts.
function plantsOf(world, M) {
    const tubes = world.emitBranchTubes({ sides: 6 }), v = tubes.vegetation;
    const byRoot = new Map();
    for (let i = 0; i < tubes.segCount; i++) {
        const rec = Array.from(v.subarray(i * 16, i * 16 + 16)), seg = Array.from(tubes.segments.subarray(i * 8, i * 8 + 8));
        const key = rec.slice(0, 3).map((x) => x.toFixed(3)).join(',');
        if (!byRoot.has(key)) byRoot.set(key, []);
        byRoot.get(key).push({ rec, seg });
    }
    return [...byRoot.values()].map((rs) => {
        const parts = rs.map((r) => sway.part(r.rec, M, 'tip', [0.6, 0.8], r.seg));
        return { recs: rs.map((r) => r.rec), segs: rs.map((r) => r.seg), parts, root: parts[0].root, height: parts[0].height, M };
    });
}

// The leader: from the thickest segment at the root, on through the
// thickest segment leaving each one's tip.
function leader(tree) {
    const S = tree.segs, near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-4;
    let cur = -1;
    S.forEach((s, i) => { if (s[1] < 0.05 && (cur < 0 || s[3] > S[cur][3])) cur = i; });
    const chain = [];
    while (cur >= 0 && chain.length < 400) {
        chain.push(cur);
        let next = -1;
        S.forEach((s, i) => { if (!chain.includes(i) && near(s.slice(0, 3), S[cur].slice(4, 7)) && (next < 0 || s[3] > S[next][3])) next = i; });
        cur = next;
    }
    return chain;
}

// The parts that tell, each a sway.part at a segment's tip.
function tellingParts(tree) {
    const P = tree.parts, H = tree.height, out = [];
    const chain = leader(tree);
    const above = (i) => P[i].rest[1] - tree.root[1];
    for (const f of [0.25, 0.5, 0.75]) {
        const i = chain.reduce((b, k) => (Math.abs(above(k) - f * H) < Math.abs(above(b) - f * H) ? k : b), chain[0]);
        out.push({ name: `stem ${Math.round(f * 100)}%`, p: P[i], at: above(i) / H });
    }
    // The top: the highest tip of the plant (the leader's, on a conifer).
    let top = 0;
    P.forEach((p, i) => { if (p.rest[1] > P[top].rest[1]) top = i; });
    out.push({ name: 'top', p: P[top], at: above(top) / H });
    // Bough tips (a limb's farthest wood), low and high, and a high twig.
    const tips = P.map((p, i) => ({ p, i, w: tree.recs[i][9] })).filter((q) => q.w > 0.95 && q.p.limb.limb.sway > 0)
        .sort((a, b) => above(a.i) - above(b.i));
    if (tips.length) {
        const at = (f) => tips[Math.min(tips.length - 1, Math.floor(f * tips.length))];
        const lo = at(0.1), hi = at(0.85);
        out.push({ name: 'bough low', p: lo.p, at: above(lo.i) / H }, { name: 'bough high', p: hi.p, at: above(hi.i) / H });
        const tw = tips.filter((q) => q.p.limb.twig.sway > 0);
        if (tw.length) { const q = tw[Math.floor(0.9 * (tw.length - 1))]; out.push({ name: 'twig high', p: q.p, at: above(q.i) / H }); }
    }
    return out;
}

function grownPlant(name, seconds) {
    const S = 30;
    const world = bro.flora.createWorld({
        rngSeed: 0xc0f1,
        climate: { annualTempBase: 12, annualPrecip: 1000 },
        shadow: { origin: [-S / 2, -2, -S / 2], cellSize: 1, width: S, height: 34, depth: S, fill: 1 },
    });
    world.plantSpecies(name, { origin: [0, 0, 0] });
    world.grow(Math.round(seconds / SIM_STEP), SIM_STEP, { cache: bro.app.cacheDir });
    return world;
}

const PLANTS = {};
{
    const trees = plantsOf(grove.world, sway.model([0, 0, 0], 0, PLANT_SCALE));
    PLANTS.broadleaf = trees.sort((a, b) => Math.hypot(a.root[0] - 6.5, a.root[2] - 9.5) - Math.hypot(b.root[0] - 6.5, b.root[2] - 9.5))[0];
    PRESET_PLANTS.forEach((p, k) => {
        const M = sway.model([p.x, groundHeight(p.x, p.z) - 0.06, p.z], 0, 1);
        PLANTS[p.name] = plantsOf(grove.presetWorld[k], M)[0];
    });
    PLANTS['sapling fir'] = plantsOf(grownPlant('fir', SAPLING_SECONDS), sway.model([0, 0, 0], 0, 1))[0];
    PLANTS['sapling oak'] = plantsOf(grownPlant('oak', SAPLING_SECONDS), sway.model([0, 0, 0], 0, 1))[0];
    // Younger still: a few metres, the small trees a meadow's edge has.
    PLANTS['young fir'] = plantsOf(grownPlant('fir', YOUNG_SECONDS), sway.model([0, 0, 0], 0, 1))[0];
    PLANTS['young oak'] = plantsOf(grownPlant('oak', YOUNG_SECONDS), sway.model([0, 0, 0], 0, 1))[0];
}
const want = opt('plants', 'young fir,young oak,sapling fir,sapling oak,fir,spruce,pine,cedar,cypress,redwood,broadleaf,birch,boxwood,hydrangea,holly,lavender')
    .split(',').filter((n) => PLANTS[n]);

// --- the runs -----------------------------------------------------------------------

const P = sway.pressure;
// A field with no gusts blowing along +x, for the scripted drags.
const still = (t) => ({ dir: [1, 0], base: 0, gustSpeed: 0, gust: 0, invAlong: 1 / 45, invAcross: 1 / 83, t });
const smoothstep = (a, b, x) => { const s = Math.min(1, Math.max(0, (x - a) / (b - a))); return s * s * (3 - 2 * s); };

// The part's along-wind offset (m) from rest, per frame, from t0 for n frames.
function track(q, drag, t0, n, wsAt = still) {
    sway.debug.drag = drag;
    const xs = [], ps = [];
    for (let k = 0; k < n; k++) {
        const ws = wsAt(t0 + k / fps);
        const r = sway.position(q.p, ws);
        const d = [ws.dir[0], 0, ws.dir[1]];
        xs.push((r.p[0] - q.p.rest[0]) * d[0] + (r.p[2] - q.p.rest[2]) * d[2]);
        ps.push(r.p);
    }
    sway.debug.drag = null;
    return { xs, ps };
}
const mean = (s) => s.reduce((a, b) => a + b, 0) / s.length;
const std = (s) => { const m = mean(s); return Math.sqrt(mean(s.map((v) => (v - m) ** 2))); };
// Swings about `ref` larger than `thr`: the count of extrema of (x - ref)
// beyond it, alternating side (a swing through and back counts two).
function ringCycles(s, ref, thr) {
    let n = 0, side = 0;
    for (let k = 1; k < s.length - 1; k++) {
        const d = s[k] - ref;
        const ext = (s[k] >= s[k - 1] && s[k] >= s[k + 1]) || (s[k] <= s[k - 1] && s[k] <= s[k + 1]);
        if (!ext || Math.abs(d) < thr) continue;
        const sd = Math.sign(d);
        if (sd !== side) { n++; side = sd; }
    }
    return n;
}

function steady(q, U) {
    const tr = track(q, () => P(U), 10, 30 * fps).xs;
    const m = mean(tr), sd = std(tr);
    const a = sway.analyse(tr.map((v) => [v, 0, 0]), fps);
    return { U, mean: m, std: sd, ratio: sd / Math.max(Math.abs(m), 1e-9), upwind: tr.filter((v) => v < 0).length / tr.length, hz: a.domHz };
}

// The step and gust runs with and without the unresolved eddies
// (sway.debug.eddies 0: the response to the scripted drag alone, its own
// overshoot and ringing; a port without the split answers the same both ways).
function eddiesOff(f) {
    const was = sway.debug.eddies;
    sway.debug.eddies = 0;
    try { return f(); } finally { sway.debug.eddies = was; }
}

function step(q, U = 12) {
    const t0 = 0, n = 20 * fps;
    const run = () => track(q, (x, z, t) => P(U) * smoothstep(2, 2.3, t), t0, n).xs;
    const measure = (tr) => {
        const fin = mean(tr.slice(12 * fps));
        const after = tr.slice(2 * fps, 12 * fps);
        const peak = Math.max(...after);
        const k90 = after.findIndex((v) => v >= 0.9 * fin);
        const from = k90 < 0 ? after.length : k90;
        return { tr, final: fin, overshoot: peak / Math.max(fin, 1e-9), t90: k90 < 0 ? null : k90 / fps,
                 cycles: ringCycles(after.slice(from), fin, 0.1 * Math.abs(fin)), std: std(tr.slice(12 * fps)) };
    };
    const all = measure(run());
    all.response = measure(eddiesOff(run));
    return all;
}

function gust(q, U0 = 5, U1 = 12) {
    const n = 18 * fps;
    const run = () => track(q, (x, z, t) => P(U0) + (P(U1) - P(U0)) * smoothstep(4, 5, t) * (1 - smoothstep(7, 8, t)), 0, n).xs;
    const measure = (tr) => {
        const base = mean(tr.slice(1 * fps, 4 * fps)), held = mean(tr.slice(5.5 * fps, 7 * fps));
        const added = held - base, rel = tr.slice(8 * fps, 16 * fps);
        return { tr, base, added, overshoot: (base - Math.min(...rel)) / Math.max(added, 1e-9),
                 cycles: ringCycles(rel, base, 0.1 * Math.abs(added)) };
    };
    const all = measure(run());
    all.response = measure(eddiesOff(run));
    return all;
}

function field(q, wind) {
    scene.setWind(WINDS[wind].wind);
    const params = scene.wind();
    const r = track(q, null, 300, 30 * fps, (t) => sway.windStateAt(params, t));
    const m = mean(r.xs), sd = std(r.xs);
    const a = sway.analyse(r.ps, fps, [1, 0, 0]);
    return { mean: m, std: sd, ratio: sd / Math.max(Math.abs(m), 1e-9), upwind: r.xs.filter((v) => v < 0).length / r.xs.length,
             hz: a.domHz, spikes: a.spikes.length, maxStep: a.maxStep };
}

// --- the report ---------------------------------------------------------------------

const cm = (v) => (v * 100).toFixed(1);
const lines = [`lean: what each plant's parts do under scripted winds (sway.js, the GPU's sway); ${new Date().toISOString()}`];
const json = {};
const levelsOf = (p) => ['trunk', 'limb', 'twig'].map((k) => {
    const c = k === 'trunk' ? p.trunk : p.limb[k];
    return c && c.sway > 0 ? `${k} ${c.freq.toFixed(2)} Hz ${cm(c.sway * c.len)} cm/${c.len.toFixed(2)} m` : null;
}).filter(Boolean).join('; ');

const stepRuns = {}, gustRuns = {};
for (const name of want) {
    const tree = PLANTS[name];
    const parts = tellingParts(tree);
    json[name] = { height: tree.height, parts: {} };
    lines.push('', `== ${name}: ${tree.height.toFixed(1)} m, ${tree.parts.length} segments`);
    lines.push('part          at    levels (freq, static tip deflection at 10 m/s / length)');
    for (const q of parts) lines.push(`${q.name.padEnd(13)} ${q.at.toFixed(2)}  ${levelsOf(q.p)}`);
    lines.push('steady: held lean cm (% of height) | std/mean | upwind share | Hz, at 2.5 / 5 / 10 / 15 m/s');
    for (const q of parts) {
        const rs = [2.5, 5, 10, 15].map((U) => steady(q, U));
        json[name].parts[q.name] = { at: q.at, steady: rs };
        lines.push(`${q.name.padEnd(13)} ` + rs.map((r) => `${cm(r.mean).padStart(6)} (${(100 * r.mean / tree.height).toFixed(2)}%) ${r.ratio.toFixed(2)} ${r.upwind.toFixed(2)} ${r.hz.toFixed(1)}`).join(' |'));
    }
    lines.push('step to 12 m/s: final cm | overshoot (peak / final) | ring cycles | t90 s || gust 5 -> 12 m/s: added cm | overshoot after release | ring cycles');
    lines.push('  (each then without the unresolved eddies: overshoot, cycles, t90 | overshoot, cycles)');
    stepRuns[name] = {}; gustRuns[name] = {};
    for (const q of parts) {
        const s = step(q), g = gust(q), sr = s.response, gr = g.response;
        stepRuns[name][q.name] = s.tr; gustRuns[name][q.name] = g.tr;
        Object.assign(json[name].parts[q.name], {
            step: { final: s.final, overshoot: s.overshoot, cycles: s.cycles, t90: s.t90, std: s.std,
                    response: { overshoot: sr.overshoot, cycles: sr.cycles, t90: sr.t90 } },
            gust: { added: g.added, overshoot: g.overshoot, cycles: g.cycles, response: { overshoot: gr.overshoot, cycles: gr.cycles } } });
        const t90 = (v) => (v === null ? '  -  ' : v.toFixed(2).padStart(5));
        lines.push(`${q.name.padEnd(13)} ${cm(s.final).padStart(6)} ${s.overshoot.toFixed(2).padStart(6)} ${String(s.cycles).padStart(4)} ${t90(s.t90)} || ` +
                   `${cm(g.added).padStart(6)} ${g.overshoot.toFixed(2).padStart(6)} ${String(g.cycles).padStart(4)}` +
                   `   (${sr.overshoot.toFixed(2)} ${sr.cycles} ${t90(sr.t90)} | ${gr.overshoot.toFixed(2)} ${gr.cycles})`);
    }
    lines.push('field (grove winds): mean cm | std/mean | upwind share | Hz | jerk spikes, gusty || breeze');
    for (const q of parts) {
        const a = field(q, 'gusty'), b = field(q, 'breeze');
        Object.assign(json[name].parts[q.name], { gusty: a, breeze: b });
        const f = (r) => `${cm(r.mean).padStart(6)} ${r.ratio.toFixed(2)} ${r.upwind.toFixed(2)} ${r.hz.toFixed(1).padStart(4)} ${String(r.spikes).padStart(2)}`;
        lines.push(`${q.name.padEnd(13)} ${f(a)} || ${f(b)}`);
    }
}

// Summary rows: the tall conifer's top and every plant's top and high twig.
lines.push('', 'summary (top / bough high / twig high): step overshoot, ring cycles | gust overshoot, cycles | steady 10 m/s std/mean, upwind share' +
           ' | without eddies: step overshoot, cycles, gust overshoot');
for (const name of want) {
    const parts = json[name].parts;
    const row = ['top', 'bough high', 'twig high'].filter((k) => parts[k]).map((k) => {
        const p = parts[k], s10 = p.steady[2];
        return `${k} ${p.step.overshoot.toFixed(2)},${p.step.cycles} | ${p.gust.overshoot.toFixed(2)},${p.gust.cycles} | ${s10.ratio.toFixed(2)},${s10.upwind.toFixed(2)}` +
               ` | ${p.step.response.overshoot.toFixed(2)},${p.step.response.cycles},${p.gust.response.overshoot.toFixed(2)}`;
    });
    lines.push(`${name.padEnd(12)} ${row.join('  ;  ')}`);
}

require('fs').writeFileSync(`${OUT}/${label}.txt`, lines.join('\n') + '\n');
require('fs').writeFileSync(`${OUT}/${label}.json`, JSON.stringify(json));
console.log(lines.join('\n'));

// The tracks: the tall conifers' and a sapling's parts through the step and the gust.
{
    const show = ['spruce', 'fir', 'sapling fir', 'young fir', 'broadleaf'].filter((n) => stepRuns[n]);
    const S = sheet(1280, 720);
    const colW = 640, rowsH = Math.floor(700 / show.length);
    show.forEach((name, i) => {
        const keys = ['top', 'stem 75%', 'bough high', 'twig high'].filter((k) => stepRuns[name][k]);
        const tr = (runs) => keys.map((k) => ({ label: k, xs: runs[name][k].map((v) => v * 100) }));
        sway.plotTracks(S, tr(stepRuns), 0, i * rowsH, colW, rowsH, fps, `${name}: still -> 12 m/s at 2 s (along wind, cm)`);
        sway.plotTracks(S, tr(gustRuns), colW, i * rowsH, colW, rowsH, fps, `${name}: 5 m/s, gust to 12 m/s 4-8 s`);
    });
    S.save(`${OUT}/${label}_tracks.jpg`);
}
