// The same ground from every height: refine, never replace, as a picture
// and a number, in seconds rather than a flight's minutes. The eye looks
// straight down on the ground shot's spot (or `at=<x>,<z>` km along and
// across its way) from a ladder of heights, each view settled about it;
// squares of the ground fixed on the body, 250 m to 64 km a side, are read
// off each render.
//
// bro-headless --grant files --width 1280 --height 720 demos/planet demos/planet/ladder.js -- [noclouds] [tag=x] [h=500,1000,...] [sizes=250,1000,...] [at=0,0]
//
// Controls, to find what a step is: noair (no atmosphere: the land's own
// look; the exposure then meters the frame, so read the stops, not the
// sheet's brightness), noshadow, plantsrange=<m> (the land's canopy nearer),
// rgb (each square's channels over the exposure on the log too), hide=
// plants,grass, frames (each rung's render, its normals and its exactly
// black pixels), twin (each rung again with the land's canopy for the
// plants, the two set against each other). A few heights and squares run
// in seconds: 2 to 4 rungs of 1 or 2 squares at 640x360 in 5 to 10 s, the
// whole default ladder some 25 s. Give it ev=15 (the planet's metered
// EV by day; world.js then fixes the exposure there): an adapting meter is
// still moving when a rung is shot, and its reading lags, so a rung's light
// depended on the rung before.
//
// Out: captures/ladder<_tag>.png, a contact sheet: a row a square, a
// column a height, each square resampled into a tile at one exposure (the
// ladder's median), blank where the view does not hold it whole or holds
// it under 24 px; and on the log each square's light (linear luma over the
// exposure, in stops) by height and its change from the height before:
// the land drawn as one thing from every height changes little and
// smoothly; a hand-over to something else steps.

import { holdView, land, plants, grass, scene, R, setShot, still, sun } from "/app/world.js";
import { sub, add, mul, unit, cross, dot, viewProjection, groundSquare, readSquare, squareTile, tileGrid, compareGrids, toSrgb } from "/app/view_ground.js";

const argv = (bro.app && bro.app.argv) || [];
const opt = (key, d) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : d;
};
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const tag = opt('tag') ? `_${opt('tag')}` : '';
const HEIGHTS = opt('h', '500,1000,2000,4000,8000,16000,32000,64000,128000,256000,512000').split(',').map(Number);
const SIZES = opt('sizes', '250,1000,4000,16000,64000').split(',').map(Number);
const TILE = 128;
const PLANTS_RANGE = +opt('plantsrange', 6000);   // (world.js's)
const t0 = perf.now();
if (!argv.some((s) => typeof s === 'string' && s.startsWith('ev=')))
    console.log('ladder: no ev= given: the exposure adapts, and a rung\'s light depends on the rungs before it');

// (noshadow: the sun casts none, the control for a shift that is the
// shadows' reach.)
if (argv.includes('noshadow')) sun.castsShadow = false;
// (noplantshadow: the plants cast none, the land's sun still shading.)
if (argv.includes('noplantshadow')) plants.castsShadow = false;
// (hide=plants,grass: those nodes not drawn, to find what a square's
// pattern is made of.)
const NODES = { plants, grass };
for (const k of opt('hide', '').split(',').filter(Boolean)) NODES[k].visible = false;
document.body.classList.add('clean');
bro.menu.hide();
flush();
perf.settle({ maxFrames: 300, kinds: ['land processes'] });

// The spot: the ground shot's, moved `at=` km along and across its way.
setShot('ground');
const shot = unit(scene.toBody(still.view.eye));
const way = (() => {
    const d = sub(scene.toBody(still.view.look), scene.toBody(still.view.eye));
    return unit(sub(d, mul(shot, dot(d, shot))));
})();
const [ax, az] = opt('at', '0,0').split(',').map((s) => +s * 1000);
const dir = unit(add(mul(shot, R), add(mul(way, ax), mul(cross(shot, way), az))));
// (The ground under it: the land's height in the place frame, its curve
// taken out.)
const groundAt = (d) => {
    const p = scene.toPlace(mul(d, R));
    const g = land.landHeight(p[0], p[2]) + (p[0] ** 2 + p[2] ** 2) / (2 * R);
    return Number.isFinite(g) ? Math.max(g, 0) : 0;
};
const g0 = groundAt(dir);
const centre = mul(dir, R + g0);
const squares = SIZES.map((s) => groundSquare(centre, s));
// (The ground under each square, the land's own heights (its curve taken
// out): a square near the sea's level may show the sea through a coarse
// level's mesh.)
squares.forEach((sq) => {
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (let a = 0; a < 16; a++)
        for (let c = 0; c < 16; c++) {
            const u = (a + 0.5) / 16 - 0.5, v = (c + 0.5) / 16 - 0.5;
            const p = scene.toPlace(add(sq.at, add(mul(sq.e1, u * sq.size), mul(sq.e2, v * sq.size))));
            const g = land.landHeight(p[0], p[2]);
            if (!Number.isFinite(g)) continue;
            lo = Math.min(lo, g); hi = Math.max(hi, g); sum += g; n++;
        }
    console.log(`ladder: ${sq.size} m square's ground ${lo.toFixed(0)} .. ${hi.toFixed(0)} m, mean ${(sum / n).toFixed(0)}`);
});

const W = window.innerWidth, H = window.innerHeight;
const rungs = [];
for (const h of HEIGHTS) {
    const eyeB = mul(dir, R + g0 + h);
    const eye = scene.toPlace(eyeB), look = scene.toPlace(centre);
    const upP = sub(scene.toPlace(add(eyeB, way)), eye);
    holdView(eye, look, Math.max(0.1, 0.01 * h), Math.max(4e5, 4 * Math.sqrt(2 * R * h) + 4e5), upP);
    // (A few frames at the new view first: its wants are the newest
    // render's, the last view's until it is drawn.)
    for (let k = 0; k < 4; k++) advanceTime(16);
    // (Settled as far as the squares it reads: the plants placed out to
    // them, not only about the eye.)
    const st = perf.settle({ maxFrames: 3000, within: Math.max(1000, 1.2 * h + 0.75 * SIZES[SIZES.length - 1]) });
    if (st.stalled || !st.settled) console.log(`ladder: ${h} m unsettled after ${st.frames} frames: ${st.pending.join('; ')}`);
    holdView(eye, look, Math.max(0.1, 0.01 * h), Math.max(4e5, 4 * Math.sqrt(2 * R * h) + 4e5), upP);
    // (hold=<frames> more: work the settle is not offered, which comes in
    // over frames, the trees' among it.)
    for (let k = +opt('hold', 30); k >= 0; k--) advanceTime(16);
    const im = scene.toImageData();
    // (frames: each rung's whole render too, to see what a square holds.)
    // (And its normals, the sky black: a hole in the ground is sky.)
    if (argv.includes('frames')) {
        bro.image.encodePngFile(`${OUT}/ladder${tag}_${h}.png`, im.data, im.width, im.height, 4);
        let black = 0;
        for (let i = 0; i < im.data.length; i += 4) if (im.data[i] + im.data[i + 1] + im.data[i + 2] === 0) black++;
        console.log(`ladder: ${h} m frame, ${black} pixels exactly black`);
        scene.setInspect(true);
        advanceTime(16);
        const ins = scene.inspectFrame({ image: 'normals' });
        scene.setInspect(false);
        if (ins && ins.image) bro.image.encodePngFile(`${OUT}/ladder${tag}_${h}_normals.png`, ins.image, ins.width, ins.height, 4);
    }
    const view = viewProjection(scene, im.width, im.height);
    // (twin: the same view again with the land's canopy for the plants, read
    // into `twin` and set against them below: the plants' hand-over seen
    // in place.)
    let twin = null;
    if (argv.includes('twin')) {
        plants.setPlants({ range: 1 });
        perf.settle({ maxFrames: 600, kinds: ['plants', 'land'] });
        for (let k = 0; k < 4; k++) advanceTime(16);
        const ti = scene.toImageData();
        twin = squares.map((sq) => { const m = readSquare(ti, view, sq, 48); return m && m.span >= 24 ? { ...m, tile: squareTile(ti, view, sq, TILE) } : null; });
        if (argv.includes('frames')) bro.image.encodePngFile(`${OUT}/ladder${tag}_${h}_canopy.png`, ti.data, ti.width, ti.height, 4);
        plants.setPlants({ range: PLANTS_RANGE });
    }
    const cs = scene.cullStats();
    const exposure = cs && cs.exposureScale > 0 ? cs.exposureScale : 1;
    const reads = squares.map((sq) => {
        const m = readSquare(im, view, sq, 48);
        return m && m.span >= 24 ? { ...m, L: Math.log2((0.2126 * m.r + 0.7152 * m.g + 0.0722 * m.b) / exposure), tile: squareTile(im, view, sq, TILE) } : null;
    });
    rungs.push({ h, exposure, reads, twin, frames: st.frames });
}

// The log: a square a line, its light at each height and the step from the
// height before.
const fmtH = (h) => (h >= 1000 ? `${h / 1000} km` : `${h} m`);
console.log(`ladder: ${HEIGHTS.length} heights in ${((perf.now() - t0) / 1000).toFixed(1)} s (settles ${rungs.map((r) => r.frames).join(' ')} frames; exposure ${rungs.map((r) => r.exposure.toPrecision(3)).join(' ')})`);
SIZES.forEach((s, k) => {
    let last = null;
    const parts = rungs.map((r) => {
        const m = r.reads[k];
        if (!m) return null;
        const step = last === null ? '' : ` (${m.L - last >= 0 ? '+' : ''}${(m.L - last).toFixed(2)})`;
        last = m.L;
        // (rgb: its channels over the exposure too, for a probe's own outputs.)
        const rgb = argv.includes('rgb') ? ` [${[m.r, m.g, m.b].map((c) => (c / r.exposure).toPrecision(3)).join(' ')}]` : '';
        return `${fmtH(r.h)} ${m.L.toFixed(2)}${step}${rgb}`;
    }).filter(Boolean);
    console.log(`ladder: ${fmtH(s)} square: ${parts.join(', ')}`);
});

// The structure: each square's pattern (its blocks' light, the mean taken
// out) at each height against the height before and against the lowest
// that holds it, at the finest band both views resolve (n x n blocks, a
// block 3 px or more in each). Refining keeps it: r near 1 and the spreads
// alike; a hand-over to something else drops r, or the spread (washed
// out) or raises it (a pattern of its own).
const BANDS = [32, 16, 8, 4];
const bandFor = (a, b) => BANDS.find((n) => n * 3 <= Math.min(a.span, b.span));
const cmp = (a, b) => {
    const n = bandFor(a, b);
    if (!n) return null;
    const c = compareGrids(tileGrid(b.tile, TILE, n), tileGrid(a.tile, TILE, n));
    return c && { n, ...c };
};
const fmtC = (c) => `n${c.n} r ${c.r.toFixed(2)} d ${c.d.toFixed(2)} spread ${c.sa.toFixed(2)}->${c.sb.toFixed(2)}`;
SIZES.forEach((s, k) => {
    const held = rungs.map((r) => ({ h: r.h, m: r.reads[k] })).filter((x) => x.m);
    if (held.length < 2) return;
    const steps = [], drift = [];
    for (let j = 1; j < held.length; j++) {
        const c = cmp(held[j].m, held[j - 1].m), f = cmp(held[j].m, held[0].m);
        if (c) steps.push(`${fmtH(held[j].h)} ${fmtC(c)}`);
        if (f && j > 1) drift.push(`${fmtH(held[j].h)} r ${f.r.toFixed(2)} (n${f.n})`);
    }
    console.log(`ladder: ${fmtH(s)} square, each height on the one before: ${steps.join(', ') || 'none resolved'}`);
    if (drift.length) console.log(`ladder: ${fmtH(s)} square, on ${fmtH(held[0].h)}: ${drift.join(', ')}`);
});
// (twin: each height's plants against the canopy drawn for them in the
// same view, their light (stops) and their pattern.)
if (argv.includes('twin')) SIZES.forEach((s, k) => {
    const parts = rungs.map((r) => {
        const a = r.reads[k], b = r.twin && r.twin[k];
        if (!a || !b) return null;
        const Lb = Math.log2((0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b) / r.exposure);
        const c = cmp(b, a);
        return `${fmtH(r.h)} ${a.L.toFixed(2)} canopy ${Lb.toFixed(2)}${c ? ` ${fmtC(c)}` : ''}`;
    }).filter(Boolean);
    if (parts.length) console.log(`ladder: ${fmtH(s)} square, plants against their canopy: ${parts.join(', ')}`);
});

// The sheet, at the ladder's median exposure.
const ex = rungs.map((r) => r.exposure).sort((a, b) => a - b)[rungs.length >> 1];
const GAP = 4, SW = rungs.length * (TILE + GAP) + GAP, SH = SIZES.length * (TILE + GAP) + GAP;
const sheet = new Uint8Array(SW * SH * 4);
for (let i = 0; i < SW * SH; i++) sheet.set([20, 22, 28, 255], i * 4);
rungs.forEach((r, c) => r.reads.forEach((m, k) => {
    if (!m) return;
    const x0 = GAP + c * (TILE + GAP), y0 = GAP + k * (TILE + GAP);
    const scale = ex / r.exposure;
    for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
            const o = (y * TILE + x) * 3;
            if (Number.isNaN(m.tile[o])) continue;
            sheet.set([toSrgb(m.tile[o] * scale), toSrgb(m.tile[o + 1] * scale), toSrgb(m.tile[o + 2] * scale), 255], ((y0 + y) * SW + x0 + x) * 4);
        }
}));
bro.image.encodePngFile(`${OUT}/ladder${tag}.png`, sheet, SW, SH, 4);
console.log(`ladder: captures/ladder${tag}.png (rows ${SIZES.map(fmtH).join(', ')}; columns ${HEIGHTS.map(fmtH).join(', ')}) in ${((perf.now() - t0) / 1000).toFixed(1)} s`);
