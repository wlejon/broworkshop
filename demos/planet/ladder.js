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
// rgb (each square's channels over the exposure on the log too). A few
// heights and squares run in seconds.
//
// Out: captures/ladder<_tag>.png, a contact sheet: a row a square, a
// column a height, each square resampled into a tile at one exposure (the
// ladder's median), blank where the view does not hold it whole or holds
// it under 24 px; and on the log each square's light (linear luma over the
// exposure, in stops) by height and its change from the height before:
// the land drawn as one thing from every height changes little and
// smoothly; a hand-over to something else steps.

import { holdView, land, scene, R, setShot, still, sun } from "/app/world.js";
import { sub, add, mul, unit, cross, dot, viewProjection, groundSquare, readSquare, squareTile, toSrgb } from "/app/view_ground.js";

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
const t0 = perf.now();

// (noshadow: the sun casts none, the control for a shift that is the
// shadows' reach.)
if (argv.includes('noshadow')) sun.castsShadow = false;
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
    const st = perf.settle({ maxFrames: 3000, within: 1000 });
    holdView(eye, look, Math.max(0.1, 0.01 * h), Math.max(4e5, 4 * Math.sqrt(2 * R * h) + 4e5), upP);
    advanceTime(16);
    const im = scene.toImageData();
    const view = viewProjection(scene, im.width, im.height);
    const cs = scene.cullStats();
    const exposure = cs && cs.exposureScale > 0 ? cs.exposureScale : 1;
    const reads = squares.map((sq) => {
        const m = readSquare(im, view, sq, 48);
        return m && m.span >= 24 ? { ...m, L: Math.log2((0.2126 * m.r + 0.7152 * m.g + 0.0722 * m.b) / exposure), tile: squareTile(im, view, sq, TILE) } : null;
    });
    rungs.push({ h, exposure, reads, frames: st.frames });
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
