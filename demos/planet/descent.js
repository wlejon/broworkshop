// The descent: one flight from orbit to eye level, every frame at the
// detail its view wants, to a WebM, and how long each frame's detail took
// to come in.
//
//   bro-headless --grant files --width 1920 --height 1080 demos/planet demos/planet/descent.js -- \
//       [seconds=40] [k=0.08] [walk=1.4] [quality=good] [tag=<t>]
//
// The eye comes down from orbit's height (18000 km) to 1.8 m over the
// ground shot's spot, its height falling by the same ratio each second for
// the first 85% of the flight, then walks on at eye level; it flies forward
// at `k` times its height a second (at least `walk` m/s), so it lands at the
// ground shot's eye looking its way. Its view turns from straight down to
// level by its height (orbit's nadir, the limb's and region's slants, low's
// and ground's near-level look).
//
// Each frame: the view is set and the scene settled for it on a held clock
// (perf.settle without the exposure: the land's regions and tiles, the
// plants, the ground layers, the world service's jobs, the clouds' bakes),
// timed on the wall clock (perf.now: performance.now rides virtual time); then the exposure let settle (untimed: a meter, not loading); then
// one frame of the flight's clock is rendered, its GPU ms read, and encoded.
//
// Out: captures/planet_descent<_tag>.webm; captures/planet_descent<_tag>.csv
// a row a frame: frame, time s, height m, ground speed m/s, descent m/s,
// load ms (wall, the settle), load frames, its kinds' frames, render GPU ms,
// and the pop meter's (luma levels over 16 px blocks, mean and 99th
// percentile): load_pop, the frame's first picture at its view (what had
// come in for the last view) against its settled one, and step_pop, the
// settled pictures' second difference over three frames (a switch between
// representations); and the log's summary by height band: the most each
// band's frames took to load, the speeds it could be flown at with its
// detail always in (this flight's speeds scaled by (a frame's 1/fps s) /
// (its load s)), the pops; then the worst steps against the motion about
// them, and the worst load pops.
//
// from=<s> to=<s>: only that part of the flight (its first view settled
// untimed), for working on one transition.
import { setShot, holdView, still, land, scene, R } from "/app/world.js";

const fs = require("fs");
const argv = (bro.app && bro.app.argv) || [];
const opt = (key, d) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : d;
};
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const tag = opt('tag') ? `_${opt('tag')}` : '';
const fps = 30;
const seconds = +opt('seconds', 40), N = Math.round(seconds * fps);
const k = +opt('k', 0.08), walk = +opt('walk', 1.4);
const H0 = 1.8e7, H1 = 1.8, T1 = 0.85 * seconds;
// What a frame waits on to be in at its detail: all but the exposure.
const LOAD = ['land processes', 'land', 'plants', 'world service', 'ground layers', 'clouds'];

const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

document.body.classList.add('clean');
bro.menu.hide();
flush();
perf.settle({ maxFrames: 300, kinds: ['land processes'] });

// The landing: the ground shot's spot and its way, on the body (read from
// the global grid's heights, not settled there: nothing about the landing
// is made before the flight comes to it).
setShot('ground');
const end = scene.toBody(still.view.eye);
const up0 = unit(end);
const way = (() => {
    const d = sub(scene.toBody(still.view.look), end);
    return unit(sub(d, mul(up0, dot(d, up0))));
})();

// The flight by frame: height, and ground distance still to go to the landing.
const height = (t) => (t < T1 ? H0 * Math.pow(H1 / H0, t / T1) : H1);
const speed = (t) => Math.max(k * height(t), walk);
const togo = new Float64Array(N + 1);
for (let i = N - 1; i >= 0; i--) togo[i] = togo[i + 1] + speed((i + 0.5) / fps) / fps;
// The view's pitch below level by height: straight down from orbit, the
// limb's and region's slants, low's and ground's near-level look.
const PITCH = [[1.8e7, 90], [1.2e6, 62], [9e4, 21], [1500, 3], [1.8, -1]];
function pitch(h) {
    const l = Math.log(h);
    for (let j = 1; j < PITCH.length; j++) {
        const a = PITCH[j - 1], b = PITCH[j];
        if (h >= b[0]) {
            const s = (Math.log(a[0]) - l) / (Math.log(a[0]) - Math.log(b[0]));
            const e = Math.max(0, Math.min(1, s)), w = e * e * (3 - 2 * e);
            return (a[1] + (b[1] - a[1]) * w) * Math.PI / 180;
        }
    }
    return PITCH[PITCH.length - 1][1] * Math.PI / 180;
}
// The ground (or the sea) under a body point near the landing, over the datum.
function groundAt(radial) {
    const p = scene.toPlace(mul(radial, R));
    if (Math.hypot(p[0], p[2]) > 2e5) return 0;
    const g = land.landHeight(p[0], p[2]) + (p[0] ** 2 + p[2] ** 2) / (2 * R);
    return Number.isFinite(g) ? Math.max(g, 0) : 0;
}
// Frame i's view, held in the place frame as it is now.
function viewAt(i) {
    const t = i / fps, h = height(t), th = togo[i] / R;
    const r = add(mul(up0, Math.cos(th)), mul(way, -Math.sin(th)));
    const f = add(mul(way, Math.cos(th)), mul(up0, Math.sin(th)));
    const eyeB = mul(r, R + groundAt(r) + h);
    const p = pitch(h);
    const d = add(mul(f, Math.cos(p)), mul(r, -Math.sin(p)));
    const u = add(mul(r, Math.cos(p)), mul(f, Math.sin(p)));
    const eye = scene.toPlace(eyeB);
    const look = scene.toPlace(add(eyeB, mul(d, Math.max(10, h))));
    const upP = sub(scene.toPlace(add(eyeB, u)), eye);
    const horizon = Math.sqrt(2 * R * h + h * h);
    return { eye, look, up: upP, near: Math.min(1e5, Math.max(0.1, h * 5e-4)), far: Math.max(4e5, 4 * horizon + 4e5), h };
}
const hold = (v) => holdView(v.eye, v.look, v.near, v.far, v.up);

// The pop meter reads the picture as the luma of 16 px blocks: fine enough
// to see a cloud or a level's edge change, coarse enough that a frame's
// motion moves a block's mean only a little.
const BLOCK = 16;
const W = window.innerWidth, Hpx = window.innerHeight;
const BW = Math.floor(W / BLOCK), BH = Math.floor(Hpx / BLOCK);
function blocks() {
    const px = getPixels(0, 0, BW * BLOCK, BH * BLOCK).data, row = BW * BLOCK * 4;
    const out = new Float32Array(BW * BH);
    for (let y = 0; y < BH * BLOCK; y++) {
        const o = (y / BLOCK | 0) * BW;
        for (let x = 0, p = y * row; x < BW * BLOCK; x++, p += 4)
            out[o + (x / BLOCK | 0)] += 0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2];
    }
    for (let k = 0; k < out.length; k++) out[k] /= BLOCK * BLOCK;
    return out;
}
// The mean and the 99th percentile of |a| over the blocks (a change of one
// part of the picture shows in the percentile however small the part).
function spread(a) {
    const s = Array.from(a, Math.abs).sort((x, y) => x - y);
    return { mean: s.reduce((x, y) => x + y, 0) / s.length, p99: s[Math.floor(s.length * 0.99)] };
}
const diff = (a, b) => a.map((x, k) => x - b[k]);

// (from= / to=: only the frames between those seconds of the flight, the
// first settled before the timing starts.)
const I0 = Math.max(0, Math.round(+opt('from', 0) * fps)), I1 = Math.min(N, Math.round(+opt('to', seconds) * fps));
const enc = new VideoEncoder({ path: `${OUT}/planet_descent${tag}.webm`, width: W, height: Hpx, fps, quality: opt('quality', 'good') });
const rows = ['frame,t,height_m,ground_mps,descent_mps,load_ms,load_frames,waited,render_gpu_ms,load_pop,load_pop_p99,step_pop,step_pop_p99'];
const log = [];
if (I0 > 0) { hold(viewAt(I0)); perf.settle({ maxFrames: 8000 }); }
perf.gpuFrameMs();
const t00 = perf.now();
const shown = [];
for (let i = I0; i <= I1; i++) {
    let v = viewAt(i);
    hold(v);
    // The first frame at the view, with what had come in for the last one:
    // what a flight that does not wait shows, and how far it is from the
    // view's own (load_pop).
    // (A frame on a held clock: flush() renders without the frame's
    // callbacks, so the held view would not be pushed.)
    const t0 = perf.now();
    const scale = bro.time.scale;
    bro.time.scale = 0;
    advanceTime(1000 / fps);
    bro.time.scale = scale;
    const t1 = perf.now();
    const before = blocks();
    const t2 = perf.now();
    let s = perf.settle({ maxFrames: 8000, kinds: LOAD });
    let frames = s.frames + 1;
    const waited = Object.assign({}, s.waited);
    // The ground under the eye may have come in under it: placed again, and settled.
    const again = viewAt(i);
    if (Math.abs(again.eye[1] - v.eye[1]) > 0.01) {
        hold(v = again);
        s = perf.settle({ maxFrames: 8000, kinds: LOAD });
        frames += s.frames;
        for (const [kind, n] of Object.entries(s.waited)) waited[kind] = (waited[kind] || 0) + n;
    }
    const loadMs = (t1 - t0) + (perf.now() - t2);
    perf.settle({ maxFrames: 300, kinds: ['exposure'] });
    perf.gpuFrameMs();
    advanceTime(1000 / fps);
    const gpu = perf.gpuFrameMs();
    enc.addViewportFrame();
    const after = blocks();
    // (The exposure is let settle after `before` was read, so a load pop
    // also holds the exposure's move over the frame: small, the metering
    // follows a smooth flight.)
    const lp = spread(diff(after, before));
    // A step: the picture's second difference over three frames, small
    // where it moves smoothly, the size of the change where something
    // switched (step_pop: on the frame that switched, and again on the next).
    shown.push(after);
    if (shown.length > 3) shown.shift();
    const sp = shown.length === 3 ? spread(shown[2].map((x, k) => x - 2 * shown[1][k] + shown[0][k])) : { mean: 0, p99: 0 };
    const t = i / fps;
    const ground = speed(t), descent = i < N ? (height(t) - height(t + 1 / fps)) * fps : 0;
    const kinds = Object.entries(waited).map(([kind, n]) => `${kind}:${n}`).join(' ');
    rows.push([i, t.toFixed(3), v.h.toFixed(2), ground.toFixed(2), descent.toFixed(2), loadMs.toFixed(1), frames, kinds, gpu.toFixed(2),
               lp.mean.toFixed(2), lp.p99.toFixed(1), sp.mean.toFixed(2), sp.p99.toFixed(1)].join(','));
    log.push({ i, t, h: v.h, ground, descent, loadMs, frames, gpu, settled: s.settled, pending: s.pending, lp, sp });
    if (!s.settled) console.log(`descent ${i}: not settled (${s.pending.join('; ')})`);
    if (i % fps === 0) console.log(`descent ${i}/${N}: ${Math.round(v.h)} m, load ${loadMs.toFixed(0)} ms (${frames} frames ${kinds}), render ${gpu.toFixed(2)} ms GPU, ${((perf.now() - t00) / 1000).toFixed(0)} s in`);
}
enc.finish();
// (The check: the landing settled again from scratch waits on nothing, and
// its still is the video's last frame.)
const fin = perf.settle({ maxFrames: 8000 });
screenshot(`${OUT}/planet_descent${tag}_end.png`);
console.log(`descent: at the landing, settled again: ${fin.frames} frames ${JSON.stringify(fin.waited)}${fin.settled ? '' : ` (${fin.pending.join('; ')})`}; pending before: ${JSON.stringify(perf.pendingWork())}`);
fs.writeFileSync(`${OUT}/planet_descent${tag}.csv`, rows.join('\n') + '\n');

// By height band: the dearest frame to load, and the speeds the band could
// be flown at with each frame's detail in before it is shown.
const BANDS = [[1e6, Infinity], [1e5, 1e6], [1e4, 1e5], [1e3, 1e4], [100, 1e3], [10, 100], [0, 10]];
const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 1e5 ? 0 : 1)} km` : `${m.toFixed(m >= 10 ? 0 : 1)} m`);
console.log(`descent: ${log.length} frames in ${((perf.now() - t00) / 1000).toFixed(0)} s; captures/planet_descent${tag}.webm, .csv`);
for (const [lo, hi] of BANDS) {
    const fs_ = log.filter((x) => x.h >= lo && x.h < hi);
    if (!fs_.length) continue;
    const worst = fs_.reduce((a, b) => (b.loadMs > a.loadMs ? b : a));
    const meanLoad = fs_.reduce((a, b) => a + b.loadMs, 0) / fs_.length;
    // (A frame's speeds scaled by how far its load fell short of a frame's time.)
    const scale = (x) => Math.min(1, (1000 / fps) / Math.max(x.loadMs, 1e-3));
    const slow = fs_.reduce((a, b) => (scale(b) < scale(a) ? b : a));
    const gpu = fs_.map((x) => x.gpu).sort((a, b) => a - b);
    const med = (key) => { const a = fs_.map((x) => x[key].p99).sort((p, q) => p - q); return `${a[a.length >> 1].toFixed(1)} / ${a[a.length - 1].toFixed(1)}`; };
    console.log(`  ${fmt(lo).padStart(7)} - ${hi === Infinity ? 'orbit' : fmt(hi)}: ${fs_.length} frames, load mean ${meanLoad.toFixed(0)} ms, worst ${worst.loadMs.toFixed(0)} ms at ${fmt(worst.h)} (${worst.frames} frames); ` +
        `max speed ${fmt(slow.ground * scale(slow))}/s ground, ${fmt(slow.descent * scale(slow))}/s down (flown at ${fmt(slow.ground)}/s, ${fmt(slow.descent)}/s); ` +
        `render GPU median ${gpu[gpu.length >> 1].toFixed(2)} ms, worst ${gpu[gpu.length - 1].toFixed(2)}; ` +
        `pops p99 (median / worst, luma levels): load ${med('lp')}, step ${med('sp')}`);
}
// The worst steps: a frame's step over the median of the 31 about it (the
// motion's own, which is large where sharp edges cross blocks), so a
// switch stands out of a steady flight; each counted once (the frame
// after it carries the same step negated).
for (let k = 0; k < log.length; k++) {
    const near = log.slice(Math.max(0, k - 15), k + 16).map((x) => x.sp.p99).sort((a, b) => a - b);
    log[k].excess = log[k].sp.p99 / Math.max(near[near.length >> 1], 1);
}
const seen = new Set();
const top = [];
for (const x of log.slice(2).sort((a, b) => b.excess - a.excess)) {
    if (top.length >= 12) break;
    if (seen.has(x.i - 1) || seen.has(x.i + 1) || seen.has(x.i)) continue;
    seen.add(x.i);
    top.push(`${x.t.toFixed(2)} s ${fmt(x.h)} ${x.excess.toFixed(1)}x (${x.sp.p99.toFixed(0)})`);
}
console.log(`descent: worst steps (time, height, times the motion's, p99 luma levels): ${top.join(', ')}`);
const loads = log.slice().sort((a, b) => b.lp.p99 - a.lp.p99).slice(0, 8).map((x) => `${x.t.toFixed(2)} s ${fmt(x.h)} ${x.lp.p99.toFixed(0)}`);
console.log(`descent: worst load pops: ${loads.join(', ')}`);
