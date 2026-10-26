// The flight: a ship lifts off at the ground shot's spot, climbs out of the
// air to `hmax=` (250 km) and comes down again to land downrange, flown as
// a player would see it: a frame every 1/30 s of the flight's clock, paced
// to the wall's, each shown as it is with whatever has come in (no frame
// waits for the scene to load). Its speeds are the ones descent.js measured
// the planet can be flown at with every frame's detail in, by height band
// (its "max speed" lines; `fast=` times them): what the flight records is
// whether that holds when nothing waits, the work still pending a frame
// and its GPU time.
//
// bro-headless --width 1280 --height 720 demos/planet demos/planet/flight.js -- [tag=x] [fast=1] [hmax=250000] [from=s] [to=s]
//
// Out: captures/planet_flight<_tag>.webm; captures/planet_flight<_tag>.csv
// a row a frame: frame, time s, height m, ground speed m/s, climb m/s, wall
// ms, render GPU ms, the work pending (perf.pendingWork); and the log's
// summary by height band: the share of frames shown with work pending, by
// kind, and the GPU time.
//
// from=<s> to=<s>: only that part of the flight (its first view settled).
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
const fast = +opt('fast', 1), HMAX = +opt('hmax', 2.5e5);

const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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
// ground covered. The ship rises straight up (none across under 150 m, all
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
const up = climb();
// The flight: the climb, then the same climb backwards down to the landing.
const N = 2 * (up.hs.length - 1) + 1;
const S = 2 * up.ss[up.ss.length - 1];
const flightAt = (i) => (i < up.hs.length ? { h: up.hs[i], s: up.ss[i] }
                                          : { h: up.hs[N - 1 - i], s: S - up.ss[N - 1 - i] });
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

// The ship: a hull standing on its tail, wings, a fin, legs and the
// engine's glow (its brightness the thrust), its nose its local +y.
const ship = scene.createNode();
const part = (o) => { const n = scene.createMesh(Object.assign({ castsShadow: true, receivesShadow: true }, o)); ship.addChild(n); return n; };
const HULL = { color: [0.82, 0.83, 0.86], metallic: 0.7, roughness: 0.32 };
part(Object.assign({ mesh: 'capsule', radius: 1.7, height: 13, position: [0, 6.5, 0] }, HULL));
part(Object.assign({ mesh: 'box', halfW: 5.2, halfH: 1.6, halfD: 0.18, position: [0, 3.0, 0] }, HULL));
part(Object.assign({ mesh: 'box', halfW: 0.18, halfH: 1.8, halfD: 2.6, position: [0, 2.6, -1.2] }, HULL, { color: [0.7, 0.18, 0.12] }));
part({ mesh: 'box', halfW: 1.0, halfH: 0.9, halfD: 0.05, position: [0, 10.4, 1.62], color: [0.08, 0.1, 0.14], metallic: 0.2, roughness: 0.08 });
for (let k = 0; k < 3; k++) {
    const a = k * 2.0944;
    part(Object.assign({ mesh: 'cylinder', radius: 0.14, height: 3.2, position: [2.0 * Math.cos(a), 0.9, 2.0 * Math.sin(a)], rotation: [0.35 * Math.sin(a), 0, -0.35 * Math.cos(a)] }, HULL));
}
const glow = part({ mesh: 'sphere', radius: 1.1, position: [0, -0.6, 0], color: [1.0, 0.55, 0.2], emissive: 0, emissiveColor: [1.0, 0.5, 0.15], castsShadow: false });

// A rotation's quaternion from its frame's axes (columns x, y, z).
function quat(x, y, z) {
    const t = x[0] + y[1] + z[2];
    if (t > 0) { const s = 0.5 / Math.sqrt(t + 1); return [(y[2] - z[1]) * s, (z[0] - x[2]) * s, (x[1] - y[0]) * s, 0.25 / s]; }
    if (x[0] > y[1] && x[0] > z[2]) { const s = 2 * Math.sqrt(1 + x[0] - y[1] - z[2]); return [0.25 * s, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s]; }
    if (y[1] > z[2]) { const s = 2 * Math.sqrt(1 + y[1] - x[0] - z[2]); return [(y[0] + x[1]) / s, 0.25 * s, (z[1] + y[2]) / s, (z[0] - x[2]) / s]; }
    const s = 2 * Math.sqrt(1 + z[2] - x[0] - y[1]);
    return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, 0.25 * s, (x[1] - y[0]) / s];
}

// The view's pitch below level by height, as descent.js's: level near the
// ground, looking down more as the ship climbs.
const PITCH = [[1.8e7, 90], [1.2e6, 62], [9e4, 21], [1500, 3], [1.8, -1]];
function pitch(h) {
    const l = Math.log(Math.max(h, 1.8));
    for (let j = 1; j < PITCH.length; j++) {
        const a = PITCH[j - 1], b = PITCH[j];
        if (h >= b[0]) return (a[1] + (b[1] - a[1]) * smooth((Math.log(a[0]) - l) / (Math.log(a[0]) - Math.log(b[0])))) * Math.PI / 180;
    }
    return PITCH[PITCH.length - 1][1] * Math.PI / 180;
}

// Frame i: the ship placed and turned along its way, the chase camera
// behind it looking on down its way, held in the place frame as it is now.
function frameAt(i) {
    const a = flightAt(i), b = flightAt(Math.min(i + 1, N - 1)), z = flightAt(Math.max(i - 1, 0));
    const th = a.s / R;
    const r = add(mul(up0, Math.cos(th)), mul(way, Math.sin(th)));
    const f = unit(sub(way, mul(r, dot(way, r))));
    const ground = groundAt(r);
    const posB = mul(r, R + ground + a.h + 0.9);
    // Its nose along its velocity, upright when it hovers.
    const vh = (b.s - z.s) * fps / 2, vv = (b.h - z.h) * fps / 2;
    const tilt = Math.atan2(vh, Math.max(Math.abs(vv), 0.5 * vh + 1e-3));
    const nose = unit(add(mul(r, Math.cos(tilt)), mul(f, Math.sin(tilt))));
    const right = unit(cross(f, r));
    const back = cross(right, nose);
    // The chase camera: behind and over it, looking down its way.
    const D = Math.min(45 + 0.004 * a.h, 600);
    const p = pitch(a.h + 40);
    const look = add(mul(f, Math.cos(p)), mul(r, -Math.sin(p)));
    const eyeB = add(sub(posB, mul(look, D)), mul(r, 0.18 * D));
    const eyeH = Math.hypot(...eyeB) - R - groundAt(unit(eyeB));
    const eyeLift = eyeH < 2 ? mul(r, 2 - eyeH) : [0, 0, 0];
    const eye = scene.toPlace(add(eyeB, eyeLift));
    const at = scene.toPlace(add(posB, mul(look, D)));
    const upP = sub(scene.toPlace(add(eyeB, r)), scene.toPlace(eyeB));
    const P = (d) => unit(sub(scene.toPlace(add(posB, d)), scene.toPlace(posB)));
    const horizon = Math.sqrt(2 * R * (a.h + D) + (a.h + D) ** 2);
    return {
        h: a.h, ground: (b.s - z.s) * fps / 2, climb: vv, thrust: Math.min(1, Math.abs(vv) / 50 + 0.25 * (a.h < HMAX * 0.99)),
        pos: scene.toPlace(posB), q: quat(P(right), P(nose), P(back)),
        eye, look: at, up: upP, near: Math.max(0.1, Math.min(1e4, D * 0.02)), far: Math.max(4e5, 4 * horizon + 4e5),
    };
}
function show(v) {
    ship.position = v.pos;
    ship.quaternion = v.q;
    glow.emissive = 6 * v.thrust;
    holdView(v.eye, v.look, v.near, v.far, v.up);
}

const I0 = Math.max(0, Math.round(+opt('from', 0) * fps)), I1 = Math.min(N - 1, Math.round(+opt('to', N / fps) * fps));
const W = window.innerWidth, H = window.innerHeight;
const enc = new VideoEncoder({ path: `${OUT}/planet_flight${tag}.webm`, width: W, height: H, fps, quality: opt('quality', 'good') });
const rows = ['frame,t,height_m,ground_mps,climb_mps,wall_ms,render_gpu_ms,pending'];
const log = [];
// (The first view settled: the flight starts with the pad's scene in.)
show(frameAt(I0));
perf.settle({ maxFrames: 8000 });
perf.gpuFrameMs();
const t00 = perf.now();
for (let i = I0; i <= I1; i++) {
    const t0 = perf.now();
    const v = frameAt(i);
    show(v);
    advanceTime(1000 / fps);
    const gpu = perf.gpuFrameMs();
    enc.addViewportFrame();
    const pending = perf.pendingWork();
    const wall = perf.now() - t0;
    // (Paced to the wall's clock: the scene's workers get a frame's time.)
    if (wall < 1000 / fps) wallSleep(1000 / fps - wall);
    rows.push([i, (i / fps).toFixed(3), v.h.toFixed(1), v.ground.toFixed(2), v.climb.toFixed(2), wall.toFixed(1), gpu.toFixed(2), `"${pending.join('; ')}"`].join(','));
    log.push({ i, h: v.h, gpu, pending, wall });
    if (i % fps === 0) console.log(`flight ${i}/${N}: ${Math.round(v.h)} m, ${v.ground.toFixed(0)} m/s across, ${v.climb.toFixed(0)} m/s up, render ${gpu.toFixed(2)} ms GPU${pending.length ? `, pending ${pending.join('; ')}` : ''}, ${((perf.now() - t00) / 1000).toFixed(0)} s in`);
}
enc.finish();
screenshot(`${OUT}/planet_flight${tag}_end.png`);
fs.writeFileSync(`${OUT}/planet_flight${tag}.csv`, rows.join('\n') + '\n');

// By height band: how many frames were shown with work pending, by kind,
// and the GPU's time.
const BANDS = [[1e5, Infinity], [1e4, 1e5], [1e3, 1e4], [100, 1e3], [10, 100], [0, 10]];
const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 1e5 ? 0 : 1)} km` : `${m.toFixed(m >= 10 ? 0 : 1)} m`);
// (A frame's wall time is what the scene's loaders had for it: more than
// 1/fps here, with the encoding, says how much the run flatters a player.)
const walls = log.map((x) => x.wall).sort((a, b) => a - b);
console.log(`flight: ${log.length} frames in ${((perf.now() - t00) / 1000).toFixed(0)} s (a frame's wall median ${walls[walls.length >> 1].toFixed(0)} ms, ${(1000 / fps).toFixed(0)} ms in real time); captures/planet_flight${tag}.webm, .csv`);
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
