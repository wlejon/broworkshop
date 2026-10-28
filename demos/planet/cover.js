// The plants against the land's canopy that stands for them, over a square
// of the woods seen straight down: how much each covers, and how bright
// their leaves and the ground between are. The plants' hand-over to their
// canopy taken apart.
//
// Four renders of each view, the tone curve linear (gamma 1, so a pixel is
// its value):
//   1. the plants, the land hidden: a pixel with a depth is a leaf (the
//      render's normals, sky black), so the plants' cover and which pixels
//      are theirs;
//   2. the plants lit (EV 15): per block the mean light of their pixels
//      and of the rest, the ground between them;
//   3. the canopy in their place (their range 1 m), drawn by a shader set
//      that writes its cover as the land's colour (exposure 1): `set=<dir>`,
//      a copy of src/scene/vulkan/shaders whose mesh.frag ends, for
//      SCENE_LAND and SCENE_GROUND, with outColor = vec4(canopyShown, 0.25,
//      0.0, 1.0): the green a known value, so the curve the frame went
//      through is undone whatever it was;
//   4. the canopy lit: its blocks' light fitted as leaves times its cover
//      and ground times the rest (least squares over the blocks).
//
// bro-headless --grant files --width 640 --height 360 demos/planet demos/planet/cover.js -- noair set=<dir> [h=2000,4000] [size=1000] [n=16] [at=0,0] [frames]
//
// Out: per height, each one's cover (mean, their correlation over the
// blocks, k: the plants' optical depth -ln(1 - cover) over the canopy's
// where the canopy is neither bare nor closed), and the leaves' and the
// ground's light (stops at EV 15) each way.

import { holdView, land, plants, grass, scene, R, setShot, still } from "/app/world.js";
import { sub, add, mul, unit, cross, dot, viewProjection, groundSquare } from "/app/view_ground.js";

const argv = (bro.app && bro.app.argv) || [];
const opt = (key, d) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : d;
};
const HEIGHTS = opt('h', '2000,4000').split(',').map(Number);
const SIZE = +opt('size', 1000), NB = +opt('n', 16), S = 96;   // blocks a side; sample points a side
const RANGE = +opt('plantsrange', 6000);   // (world.js's)
const SET = opt('set');
if (!SET) throw new Error('cover.js: set=<shader set dir> (its mesh.frag writing the canopy\'s cover)');
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const t0 = perf.now();

document.body.classList.add('clean');
bro.menu.hide();
perf.loadShaderSet(SET);
scene.setToneMap({ mode: 'linear', gamma: 1 });
const LIT = { mode: 'fixed', ev: 15 }, RAW = { mode: 'fixed' };
scene.setExposure(LIT);
flush();
perf.settle({ maxFrames: 300, kinds: ['land processes'] });

// The spot, as ladder.js's: the ground shot's, `at=` km along and across.
setShot('ground');
const shot = unit(scene.toBody(still.view.eye));
const way = (() => {
    const d = sub(scene.toBody(still.view.look), scene.toBody(still.view.eye));
    return unit(sub(d, mul(shot, dot(d, shot))));
})();
const [ax, az] = opt('at', '0,0').split(',').map((s) => +s * 1000);
const dir = unit(add(mul(shot, R), add(mul(way, ax), mul(cross(shot, way), az))));
const p0 = scene.toPlace(mul(dir, R));
const g0 = Math.max(land.landHeight(p0[0], p0[2]) + (p0[0] ** 2 + p0[2] ** 2) / (2 * R), 0);
const centre = mul(dir, R + g0);
const sq = groundSquare(centre, SIZE);

const frames = (n) => { for (let k = 0; k < n; k++) advanceTime(16); };
const luma = (d, o) => (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
// The square's S x S sample points' pixels (byte offsets; -1 off the screen).
function samples(view, w, h) {
    const at = new Int32Array(S * S);
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const u = (x + 0.5) / S - 0.5, v = 0.5 - (y + 0.5) / S;
            const q = view.project(add(sq.at, add(mul(sq.e1, u * SIZE), mul(sq.e2, v * SIZE))));
            const X = q ? Math.floor(q[0]) : -1, Y = q ? Math.floor(q[1]) : -1;
            at[y * S + x] = X < 0 || Y < 0 || X >= w || Y >= h ? -1 : (Y * w + X) * 4;
        }
    return at;
}
const blockOf = (i) => Math.floor(Math.floor(i / S) * NB / S) * NB + Math.floor((i % S) * NB / S);
const stops = (v) => (v > 0 ? Math.log2(v / 2.54e-5).toFixed(2) : '-');

for (const h of HEIGHTS) {
    const eyeB = mul(dir, R + g0 + h);
    const eye = scene.toPlace(eyeB), look = scene.toPlace(centre);
    const upP = sub(scene.toPlace(add(eyeB, way)), eye);
    const hold = () => holdView(eye, look, Math.max(0.1, 0.01 * h), Math.max(4e5, 4 * Math.sqrt(2 * R * h) + 4e5), upP);
    hold();
    frames(4);
    perf.settle({ maxFrames: 3000, within: Math.max(1000, 1.2 * h + SIZE) });
    hold();
    frames(30);

    // 1. The plants' pixels: the land and the grass hidden, a depth theirs.
    land.visible = grass.visible = false;
    scene.setInspect(true);
    frames(2);
    const ins = scene.inspectFrame({ image: 'normals' });
    scene.setInspect(false);
    land.visible = grass.visible = true;
    const at = samples(viewProjection(scene, ins.width, ins.height), ins.width, ins.height);
    const leaf = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) if (at[i] >= 0) leaf[i] = ins.image[at[i]] + ins.image[at[i] + 1] + ins.image[at[i] + 2] > 0 ? 1 : 0;

    // 2. The plants lit: each block's cover, its leaves' light, its ground's.
    frames(2);
    const lit = scene.toImageData();
    const NN = NB * NB, cov = new Float64Array(NN), nb = new Float64Array(NN), lL = new Float64Array(NN), lG = new Float64Array(NN);
    for (let i = 0; i < S * S; i++) {
        if (at[i] < 0) continue;
        const b = blockOf(i), l = luma(lit.data, at[i]);
        nb[b]++; cov[b] += leaf[i];
        if (leaf[i]) lL[b] += l; else lG[b] += l;
    }

    // 3. The canopy's cover (set B, exposure 1); 4. the canopy lit.
    plants.setPlants({ range: 1 });
    perf.settle({ maxFrames: 600, kinds: ['plants', 'land'] });
    frames(4);
    perf.useShaderSet('b');
    scene.setExposure(RAW);
    frames(3);
    const cim = scene.toImageData();
    perf.useShaderSet('a');
    scene.setExposure(LIT);
    frames(3);
    const qim = scene.toImageData();
    plants.setPlants({ range: RANGE });
    // (The curve: green 0.25 came out as g, so a value v comes out as
    // v^e, e = ln g / ln 0.25.)
    let gs = 0, gn = 0;
    for (let i = 0; i < S * S; i++) if (at[i] >= 0) { gs += cim.data[at[i] + 1] / 255; gn++; }
    const e = Math.log(gs / gn) / Math.log(0.25);
    const cc = new Float64Array(NN), cq = new Float64Array(NN);
    for (let i = 0; i < S * S; i++) {
        if (at[i] < 0) continue;
        const b = blockOf(i);
        cc[b] += (cim.data[at[i]] / 255) ** (1 / e);
        cq[b] += luma(qim.data, at[i]);
    }
    if (argv.includes('frames')) {
        bro.image.encodePngFile(`${OUT}/cover_${h}_plants.png`, lit.data, lit.width, lit.height, 4);
        bro.image.encodePngFile(`${OUT}/cover_${h}_cover.png`, cim.data, cim.width, cim.height, 4);
        bro.image.encodePngFile(`${OUT}/cover_${h}_canopy.png`, qim.data, qim.width, qim.height, 4);
    }

    // Each block's means; the plants' leaves and ground where both show
    // (cover 0.1 .. 0.9); the canopy's fitted: q = a c + b (1 - c).
    let n = 0, md = 0, mc = 0, kd = 0, kc = 0, sL = 0, sG = 0, nL = 0;
    let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0;
    const D = new Float64Array(NN), C = new Float64Array(NN);
    for (let b = 0; b < NN; b++) {
        if (!nb[b]) { D[b] = C[b] = NaN; continue; }
        const d = cov[b] / nb[b], c = cc[b] / nb[b], q = cq[b] / nb[b];
        D[b] = d; C[b] = c;
        md += d; mc += c; n++;
        if (c > 0.05 && c < 0.95) { kd += -Math.log(Math.max(1 - d, 1e-3)); kc += -Math.log(1 - c); }
        if (d > 0.1 && d < 0.9) { sL += lL[b] / cov[b]; sG += lG[b] / (nb[b] - cov[b]); nL++; }
        s11 += c * c; s12 += c * (1 - c); s22 += (1 - c) * (1 - c); t1 += c * q; t2 += (1 - c) * q;
    }
    md /= n; mc /= n;
    let sdd = 0, scc = 0, sdc = 0;
    for (let b = 0; b < NN; b++) {
        if (Number.isNaN(D[b])) continue;
        sdd += (D[b] - md) ** 2; scc += (C[b] - mc) ** 2; sdc += (D[b] - md) * (C[b] - mc);
    }
    const det = s11 * s22 - s12 * s12;
    const a = det ? (t1 * s22 - t2 * s12) / det : NaN, bq = det ? (t2 * s11 - t1 * s12) / det : NaN;
    console.log(`cover: ${h} m, ${SIZE} m square in ${NB}x${NB}: cover plants ${md.toFixed(3)} canopy ${mc.toFixed(3)} r ${(sdc / Math.sqrt(Math.max(sdd * scc, 1e-12))).toFixed(2)} k ${(kd / Math.max(kc, 1e-9)).toFixed(2)}; ` +
                `curve ${e.toFixed(2)}; leaves plants ${stops(sL / nL)} canopy ${stops(a)}, ground plants ${stops(sG / nL)} canopy ${stops(bq)} (stops at EV 15)`);
}
console.log(`cover: ${HEIGHTS.length} heights in ${((perf.now() - t0) / 1000).toFixed(1)} s`);
