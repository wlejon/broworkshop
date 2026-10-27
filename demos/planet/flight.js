// The flight: the eye lifts off at the ground shot's spot, climbs out of the
// air to `hmax=` (250 km) and comes down again to land downrange, a ship's
// path seen from its cockpit (no ship is drawn), flown as a player would
// see it: a frame every 1/30 s of the flight's clock, paced
// to the wall's, each shown as it is with whatever has come in (no frame
// waits for the scene to load). Its speeds are the ones descent.js measured
// the planet can be flown at with every frame's detail in, by height band
// (its "max speed" lines; `fast=` times them): what the flight records is
// whether that holds when nothing waits, the work still pending a frame
// and its GPU time.
//
// dur=<s> flies it in that many seconds instead, whatever the bands allow,
// out to hmax= 20,000 km by default (the whole planet in view) and back.
//
// bro-headless --grant files --width 1280 --height 720 demos/planet demos/planet/flight.js -- [tag=x] [dur=30] [fast=1] [hmax=250000] [from=s] [to=s] [sub=12] [capture=0] [passes=1]
//
// Out: captures/planet_flight<_tag>.webm; captures/planet_flight<_tag>.csv
// a row a frame: frame, time s, height m, ground speed m/s, climb m/s, wall
// ms, render GPU ms, the work pending (perf.pendingWork); and the log's
// summary by height band: the share of frames shown with work pending, by
// kind, and the GPU time.
//
// from=<s> to=<s>: only that part of the flight (its first view settled).
// capture=0: no video, its GPU times a player's (see CAPTURE); passes=1:
// the dearest passes on each second's line.
import { setShot, holdView, still, land, scene, R } from "/app/world.js";

const fs = require("fs");
const argv = (bro.app && bro.app.argv) || [];
const opt = (key, d) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : d;
};
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const tag = opt('tag') ? `_${opt('tag')}` : '';
const fps = 30, dt = 1 / fps;
const DUR = +opt('dur', 0);
const fast = +opt('fast', 1), HMAX = +opt('hmax', DUR > 0 ? 2e7 : 2.5e5), SUB = Math.max(1, Math.round(+opt('sub', 1)));
const PASSES = opt('passes', '0') !== '0';

const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const smooth = (e) => { e = Math.max(0, Math.min(1, e)); return e * e * (3 - 2 * e); };

document.body.classList.add('clean');
bro.menu.hide();
flush();
perf.settle({ maxFrames: 300, kinds: ['land processes'] });

// The speeds the descent measured (demos/planet/descent.js, its "max
// speed" by band, 2026-10-26): [height m, ground m/s, climb or descent m/s]
// at each band's middle, read between them on the logs.
const SPEEDS = [[30, 3.5, 21], [316, 3.5, 21], [3160, 67, 397], [31600, 260, 1500], [316000, 1100, 6200]];
function capAt(h) {
    const l = Math.log(Math.max(h, 1));
    if (h <= SPEEDS[0][0]) return [SPEEDS[0][1], SPEEDS[0][2]];
    for (let j = 1; j < SPEEDS.length; j++) {
        const a = SPEEDS[j - 1], b = SPEEDS[j];
        if (h <= b[0]) {
            const s = (l - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
            return [Math.exp(Math.log(a[1]) + s * (Math.log(b[1]) - Math.log(a[1]))),
                    Math.exp(Math.log(a[2]) + s * (Math.log(b[2]) - Math.log(a[2])))];
        }
    }
    const z = SPEEDS[SPEEDS.length - 1];
    return [z[1], z[2]];
}

// A climb out of `HMAX`'s air from the ground, by frame: the height and the
// ground covered. The eye rises straight up (none across under 150 m, all
// of the band's by 600 m), as fast as the band allows, slowing near the
// ground and near the top (0.4 of the height a second there, and no more
// than ACCEL's change a second).
const ACCEL = 25;
function climb() {
    const hs = [0], ss = [0];
    let h = 0, s = 0, v = 0;
    while (h < HMAX - 0.5) {
        const [g, c] = capAt(h);
        const want = Math.min(c * fast, 0.4 * h + 1.5, 0.4 * (HMAX - h) + 0.5);
        v = Math.min(want, v + ACCEL * dt);
        h = Math.min(HMAX, h + v * dt);
        s += g * fast * smooth((h - 150) / 450) * dt;
        hs.push(h);
        ss.push(s);
    }
    return { hs, ss };
}
// dur=<s>: the climb takes half of it whatever the bands allow, its eye's
// height (over 1.8 m) rising by the same ratio each moment, eased at the
// ground and at the top; forward at 0.3 of its height a second (none under
// 150 m, all by 600 m, at most 20 km/s).
function climbTimed() {
    const n = Math.max(2, Math.round(DUR / 2 * fps));
    const hs = [0], ss = [0];
    const l0 = Math.log(1.8), l1 = Math.log(HMAX + 1.8);
    let s = 0;
    for (let i = 1; i <= n; i++) {
        const u = i / n, e = u * u * u * (u * (6 * u - 15) + 10);
        const h = Math.exp(l0 + (l1 - l0) * e) - 1.8;
        s += Math.min(0.3 * h, 2e4) * smooth((h - 150) / 450) * dt;
        hs.push(h);
        ss.push(s);
    }
    return { hs, ss };
}
const up = DUR > 0 ? climbTimed() : climb();
// The flight: the climb, then the same climb backwards down to the landing.
const N = 2 * (up.hs.length - 1) + 1;
const S = 2 * up.ss[up.ss.length - 1];
const flightAt0 = (i) => (i < up.hs.length ? { h: up.hs[i], s: up.ss[i] }
                                           : { h: up.hs[N - 1 - i], s: S - up.ss[N - 1 - i] });
// (Between frames too, for the engine frames a video frame is made of.)
const flightAt = (x) => {
    // (Within the flight: the first frame's engine frames before it are its own.)
    x = Math.max(0, Math.min(x, N - 1));
    const i = Math.floor(x), f = x - i;
    const a = flightAt0(i);
    if (f === 0) return a;
    const b = flightAt0(Math.min(i + 1, N - 1));
    return { h: a.h + f * (b.h - a.h), s: a.s + f * (b.s - a.s) };
};
console.log(`flight: ${N} frames (${(N / fps / 60).toFixed(1)} min) to ${(HMAX / 1000).toFixed(0)} km, ${(S / 1000).toFixed(0)} km downrange`);

// The lift-off: the ground shot's spot and its way, on the body.
setShot('ground');
const start = scene.toBody(still.view.eye);
const up0 = unit(start);
const way = (() => {
    const d = sub(scene.toBody(still.view.look), start);
    return unit(sub(d, mul(up0, dot(d, up0))));
})();

// The ground (or the sea) under a body direction, over the datum (0 where
// the place's grid does not reach: high up, where it does not show).
function groundAt(radial) {
    const p = scene.toPlace(mul(radial, R));
    if (Math.hypot(p[0], p[2]) > 2e5) return 0;
    const g = land.landHeight(p[0], p[2]) + (p[0] ** 2 + p[2] ** 2) / (2 * R);
    return Number.isFinite(g) ? Math.max(g, 0) : 0;
}

// The view's pitch below level by height, as descent.js's: level near the
// ground, looking down more as the eye climbs.
const PITCH = [[1.8e7, 90], [1.2e6, 62], [9e4, 21], [1500, 3], [1.8, -1]];
function pitch(h) {
    const l = Math.log(Math.max(h, 1.8));
    for (let j = 1; j < PITCH.length; j++) {
        const a = PITCH[j - 1], b = PITCH[j];
        if (h >= b[0]) return (a[1] + (b[1] - a[1]) * smooth((Math.log(a[0]) - l) / (Math.log(a[0]) - Math.log(b[0])))) * Math.PI / 180;
    }
    return PITCH[PITCH.length - 1][1] * Math.PI / 180;
}

// Frame i: the eye on the path, looking on down its way, held in the place
// frame as it is now.
function frameAt(i) {
    const a = flightAt(i), b = flightAt(Math.min(i + 1, N - 1)), z = flightAt(Math.max(i - 1, 0));
    const th = a.s / R;
    const r = add(mul(up0, Math.cos(th)), mul(way, Math.sin(th)));
    const f = unit(sub(way, mul(r, dot(way, r))));
    const eyeB = mul(r, R + groundAt(r) + a.h + 1.8);
    const p = pitch(a.h + 1.8);
    const look = add(mul(f, Math.cos(p)), mul(r, -Math.sin(p)));
    const eye = scene.toPlace(eyeB);
    const at = scene.toPlace(add(eyeB, mul(look, 100)));
    const upP = sub(scene.toPlace(add(eyeB, r)), scene.toPlace(eyeB));
    const horizon = Math.sqrt(2 * R * a.h + a.h ** 2);
    return {
        h: a.h, ground: (b.s - z.s) * fps / 2, climb: (b.h - z.h) * fps / 2,
        eye, look: at, up: upP, near: Math.max(0.1, Math.min(1e4, 0.01 * a.h)), far: Math.max(4e5, 4 * horizon + 4e5),
    };
}
function show(v) {
    holdView(v.eye, v.look, v.near, v.far, v.up);
}

const I0 = Math.max(0, Math.round(+opt('from', 0) * fps)), I1 = Math.min(N - 1, Math.round(+opt('to', N / fps) * fps));
const W = window.innerWidth, H = window.innerHeight;
// (capture=0: no video, every engine frame paced to the wall's clock as a
// player's at fps * sub. Encoding a frame takes the CPU a few hundred ms
// while the GPU waits, and the GPU drops to its idle clocks between frames
// (P8, 210 MHz on the 4090), so a captured run's GPU times are its clocks'
// as much as its work's, up to ten times a player's; only an uncaptured
// run's are a player's.)
const CAPTURE = opt('capture', '1') !== '0';
const enc = CAPTURE ? new VideoEncoder({ path: `${OUT}/planet_flight${tag}.webm`, width: W, height: H, fps, quality: opt('quality', 'good') }) : null;
const SLOT = 1000 / fps / SUB;
let due = 0;
function step() {
    advanceTime(SLOT);
    if (CAPTURE) return;
    const now = perf.now();
    due = Math.max(due + SLOT, now);
    if (due > now) wallSleep(due - now);
}
const rows = ['frame,t,height_m,ground_mps,climb_mps,wall_ms,render_gpu_ms,pending'];
// A frame's wall time by part: the engine frame, reading its GPU time,
// handing it to the encoder, asking what is pending.
const parts = [];
const log = [];
// (The first view settled: the flight starts with the pad's scene in. A
// flight from a later frame first runs the world's clock to it, a second
// at a time: the clouds drift with the wind, so a stretch of the flight
// shows the skies the whole flight would.)
show(frameAt(I0));
for (let s = I0 / fps; s > 0; s -= 1) advanceTime(1000 * Math.min(s, 1));
perf.settle({ maxFrames: 8000 });
perf.gpuFrameMs();
const t00 = perf.now();
due = t00;
for (let i = I0; i <= I1; i++) {
    const t0 = perf.now();
    // Each video frame `sub` engine frames, so the world's services get the
    // frames a player at fps * sub would give them (12: 360 fps); the
    // render's GPU time the worst of them.
    let gpu = 0;
    for (let k = 1; k < SUB; k++) {
        show(frameAt(i - 1 + k / SUB));
        step();
        gpu = Math.max(gpu, perf.gpuFrameMs());
    }
    const v = frameAt(i);
    show(v);
    const ta = perf.now();
    step();
    const tb = perf.now();
    // (The capture draws the frame; its GPU time is then that render's.)
    if (CAPTURE) enc.addViewportFrame();
    const tc = perf.now();
    gpu = Math.max(gpu, perf.gpuFrameMs());
    const td = perf.now();
    const pending = perf.pendingWork();
    parts.push([tb - ta, td - tc, tc - tb, perf.now() - td]);
    const wall = perf.now() - t0;
    // (Paced to the wall's clock: the scene's workers get a frame's time.)
    if (CAPTURE && wall < 1000 / fps) wallSleep(1000 / fps - wall);
    rows.push([i, (i / fps).toFixed(3), v.h.toFixed(1), v.ground.toFixed(2), v.climb.toFixed(2), wall.toFixed(1), gpu.toFixed(2), `"${pending.join('; ')}"`].join(','));
    log.push({ i, h: v.h, gpu, pending, wall });
    if (i % fps === 0) {
        console.log(`flight ${i}/${N}: ${Math.round(v.h)} m, ${v.ground.toFixed(0)} m/s across, ${v.climb.toFixed(0)} m/s up, render ${gpu.toFixed(2)} ms GPU${pending.length ? `, pending ${pending.join('; ')}` : ''}, ${((perf.now() - t00) / 1000).toFixed(0)} s in`);
        if (PASSES) {
            const p = perf.gpuPasses();
            console.log('  passes ' + Object.entries(p).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, ms]) => `${n} ${ms.toFixed(2)}`).join(', '));
            const cs = scene.cullStats();
            console.log(`  world budget ${cs.worldBudgetMs.toFixed(2)} ms, spent ${cs.worldSpentMs.toFixed(2)}, ${cs.worldJobs} jobs, ${cs.worldQueued} queued, land fills ${cs.landFills}; ` +
                Object.entries(cs.worldKindMs || {}).map(([n, ms]) => `${n} ${ms.toFixed(3)}`).join(', '));
        }
    }
}
if (CAPTURE) {
    enc.finish();
    screenshot(`${OUT}/planet_flight${tag}_end.png`);
}
fs.writeFileSync(`${OUT}/planet_flight${tag}.csv`, rows.join('\n') + '\n');

// By height band: how many frames were shown with work pending, by kind,
// and the GPU's time.
const BANDS = [[1e5, Infinity], [1e4, 1e5], [1e3, 1e4], [100, 1e3], [10, 100], [0, 10]];
const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 1e5 ? 0 : 1)} km` : `${m.toFixed(m >= 10 ? 0 : 1)} m`);
// (A frame's wall time is what the scene's loaders had for it: more than
// 1/fps here, with the encoding, says how much the run flatters a player.)
const walls = log.map((x) => x.wall).sort((a, b) => a - b);
console.log(`flight: ${log.length} frames in ${((perf.now() - t00) / 1000).toFixed(0)} s (a frame's wall median ${walls[walls.length >> 1].toFixed(0)} ms, ${(1000 / fps).toFixed(0)} ms in real time); captures/planet_flight${tag}${CAPTURE ? '.webm, ' : '.'}csv` +
    (CAPTURE ? ' (GPU times at the clocks capture leaves the GPU: capture=0 for a player\'s)' : ''));
{
    const med = (k) => { const a = parts.map((p) => p[k]).sort((x, y) => x - y); return a[a.length >> 1].toFixed(1); };
    const mean = (k) => (parts.reduce((s, p) => s + p[k], 0) / parts.length).toFixed(1);
    console.log(`  a frame's wall by part, median / mean ms: engine frame ${med(0)} / ${mean(0)}, GPU time read ${med(1)} / ${mean(1)}, ` +
        `to the encoder ${med(2)} / ${mean(2)}, pending asked ${med(3)} / ${mean(3)}`);
}
for (const [lo, hi] of BANDS) {
    const fs_ = log.filter((x) => x.h >= lo && x.h < hi);
    if (!fs_.length) continue;
    const kinds = {};
    for (const x of fs_) for (const p of x.pending) { const k = p.split(':')[0]; kinds[k] = (kinds[k] || 0) + 1; }
    const late = fs_.filter((x) => x.pending.length).length;
    const gpu = fs_.map((x) => x.gpu).sort((a, b) => a - b);
    console.log(`  ${fmt(lo).padStart(7)} - ${hi === Infinity ? 'top' : fmt(hi)}: ${fs_.length} frames, ${late} shown with work pending ` +
        `(${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}); render GPU median ${gpu[gpu.length >> 1].toFixed(2)} ms, worst ${gpu[gpu.length - 1].toFixed(2)}`);
}
