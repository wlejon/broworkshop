// Captures of the planet world in headless bro (virtual clock, 30 fps).
//
//   bro-headless --width 1280 --height 720 demos/planet demos/planet/capture.js -- \
//       still [shot[,shot...]]      captures/planet_<shot>.png
//   ... capture.js -- cost [shot[,shot...]]
//       GPU ms held at each shot (mean / median / max of 60 frames after an
//       eight-second warm and the plants placed), and its costliest passes
//   ... capture.js -- climb [steps=4]
//       captures/planet_climb<i>.png: the eye from region's (90 km) to
//       orbit's (18000 km) in `steps` views between, its height growing
//       by the same ratio each and its view turning down from region's
//       slant to orbit's nadir as evenly: whether anything pops or changes
//       character on the way up
//   ... capture.js -- fly [seconds=20]
//       the eye from region's height (90 km) down to 1500 m over the first
//       half, flying on at 6 km/s throughout, the land's regions made
//       under it as it goes: each frame's GPU ms and wall ms, the worst
//       frames, and captures/planet_fly.png at the end
import { SHOTS, setShot, holdView, land, plants, scene } from "/app/world.js";

const argv = (bro.app && bro.app.argv) || [];
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const fps = 30;
const step = (seconds) => { for (let i = 0, n = Math.max(1, Math.round(seconds * fps)); i < n; i++) advanceTime(1000 / fps); };
const opt = (key) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : undefined;
};
const shotsOf = (s) => (s && !s.includes('=') ? s : Object.keys(SHOTS).join(',')).split(',').filter((k) => SHOTS[k]);
// Frames until `busy()` is false (at most `max`), run on a held clock: the
// land's and plants' work goes on frame by frame, but the scene's clock (the
// wind the clouds drift on, the plants' sway, exposure) does not move, so a
// still shows the same moment however long the wait took.
const waitHeld = (busy, max) => {
    const scale = bro.time.scale;
    bro.time.scale = 0;
    let n = 0;
    for (; n < max && busy(); n++) advanceTime(1000 / fps);
    bro.time.scale = scale;
    return n;
};

document.body.classList.add('clean');
bro.menu.hide();
flush();
// The land is made by its processes first.
{
    const t0 = performance.now();
    const frames = waitHeld(() => !land.landStats()?.ready, 300);
    console.log(`land ready: ${land.landStats()?.ready} after ${frames} frames, ${Math.round(performance.now() - t0)} ms`);
}

const mode = argv[0] || 'still';
if (mode === 'still') {
    for (const shot of shotsOf(argv[1])) {
        setShot(shot);
        // (Long enough for the plants' canopy to come in and the land's
        // tiles made again with it.)
        step(+(opt('warm') || 8.0));
        setShot(shot);   // (the ground under a view is read once the land is in)
        step(1.0);
        // The plants about the view placed.
        waitHeld(() => plants.plantPlacement()?.pending > 0, 600);
        // The land's regions about the view in, and its tiles made over them.
        waitHeld(() => land.landStats()?.regionsPending > 0, 4000);
        // (The plants are placed once the ground under them is in: placed
        // again over the regions' ground.)
        const placed = waitHeld(() => plants.plantPlacement()?.pending > 0, 4000);
        const waited = waitHeld(() => land.landStats()?.missing > 0, 4000);
        console.log(`${shot}: the plants placed after ${placed} frames, the land's tiles in after ${waited} frames`);
        step(1.0);
        screenshot(`${OUT}/planet_${shot}.png`);
        const cs = scene.cullStats();
        console.log(`${shot}: captures/planet_${shot}.png ev ${cs.exposureEv?.toFixed(2)} (metered ${cs.meteredEv?.toFixed(2)})${JSON.stringify(land.landStats())}`);
    }
} else if (mode === 'climb') {
    const steps = +(opt('steps') || 4);
    const pitch0 = Math.atan2(9e4, 2.4e5);
    for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1);
        const h = 9e4 * Math.pow(1.8e7 / 9e4, t);
        const p = pitch0 + (Math.PI / 2 - pitch0) * t;
        const dir = [0, -Math.sin(p), -Math.cos(p)];
        setShot('region');
        holdView([0, h, 0], [dir[0] * h, h + dir[1] * h, dir[2] * h], Math.max(50, h * 1e-3), 6e7,
                 [0, Math.cos(p), -Math.sin(p)]);
        step(+(opt('warm') || 4.0));
        screenshot(`${OUT}/planet_climb${i}.png`);
        console.log(`climb ${i}: ${Math.round(h / 1000)} km, ${(p * 180 / Math.PI).toFixed(0)} deg down`);
    }
} else if (mode === 'fly') {
    const seconds = +(opt('seconds') || 20), frames = Math.round(seconds * fps);
    // The path is laid out in the shot's place frame and held on the body,
    // brought into the place frame each frame: a re-anchor does not move it.
    setShot('region');
    const O0 = scene.place.origin.slice(), B0 = scene.place.basis.slice();
    const ground = (x, z, up) => {
        const q = scene.toPlace([0, 1, 2].map((i) => O0[i] + B0[i * 3] * x + B0[i * 3 + 2] * z));
        return [q[0], land.landHeight(q[0], q[2]) + up, q[2]];
    };
    const at = (i) => {
        const t = i / frames, h = 9e4 * Math.pow(1500 / 9e4, Math.min(t * 2, 1)), z = -6000 * t * seconds;
        const eye = ground(0, z, h), look = ground(0, z - 3 * h, 0);
        return { eye: eye.map((v) => (Number.isFinite(v) ? v : h)), look: look.map((v, k) => (Number.isFinite(v) ? v : eye[k] - (k === 2 ? 3 * h : k === 1 ? h : 0))), h };
    };
    let v = at(0);
    holdView(v.eye, v.look, 50, 4e6);
    step(8.0);
    for (let i = 0; i < 4000 && land.landStats()?.regionsPending > 0; i++) advanceTime(1000 / fps);
    perf.gpuFrameMs();
    const gpu = [], wall = [];
    for (let i = 0; i <= frames; i++) {
        v = at(i);
        holdView(v.eye, v.look, Math.max(1, v.h * 5e-4), 4e6);
        const t0 = performance.now();
        advanceTime(1000 / fps);
        wall.push({ ms: performance.now() - t0, i });
        const p = (perf.gpuPasses && perf.gpuPasses()) || {};
        const top = Object.entries(p).filter(([, x]) => typeof x === 'number').sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([k, x]) => `${k} ${x.toFixed(2)}`).join(', ');
        gpu.push({ ms: perf.gpuFrameMs(), i, h: v.h, regions: land.landStats()?.regions, pending: land.landStats()?.regionsPending, top });
    }
    screenshot(`${OUT}/planet_fly.png`);
    const worst = (a) => a.slice().sort((x, y) => y.ms - x.ms);
    const mean = (a) => a.reduce((s, x) => s + x.ms, 0) / Math.max(a.length, 1);
    const g = worst(gpu), w = worst(wall);
    console.log(`fly: ${frames} frames; GPU mean ${mean(gpu).toFixed(2)} ms, p99 ${g[Math.floor(g.length / 100)].ms.toFixed(2)}, worst ${g.slice(0, 5).map((x) => `${x.ms.toFixed(2)}@${x.i} (${Math.round(x.h)} m, ${x.regions} in, ${x.pending} pending)`).join(', ')}`);
    console.log(`fly: the worst frame's dearest passes: ${g[0].top}`);
    console.log(`fly: wall mean ${mean(wall).toFixed(2)} ms, worst ${w.slice(0, 5).map((x) => `${x.ms.toFixed(1)}@${x.i}`).join(', ')}`);
    console.log(`fly: end ${JSON.stringify(land.landStats())}`);
} else if (mode === 'cost') {
    for (const shot of shotsOf(argv[1])) {
        setShot(shot);
        step(8.0);
        setShot(shot);
        step(1.0);
        // (The plants are placed once the land's regions are in under them.)
        waitHeld(() => land.landStats()?.regionsPending > 0, 4000);
        waitHeld(() => plants.plantPlacement()?.pending > 0, 4000);
        waitHeld(() => land.landStats()?.missing > 0, 4000);
        step(1.0);
        perf.gpuFrameMs();
        const ms = [];
        const sums = {}, mins = {};
        for (let i = 0; i < 60; i++) {
            advanceTime(1000 / fps);
            ms.push(perf.gpuFrameMs());
            const p = (perf.gpuPasses && perf.gpuPasses()) || {};
            for (const k in p) {
                if (typeof p[k] !== 'number') continue;
                sums[k] = (sums[k] || 0) + p[k];
                mins[k] = Math.min(mins[k] ?? Infinity, p[k]);
            }
        }
        const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 8)
            .map(([k, v]) => `${k} ${(v / 60).toFixed(2)}`).join(', ');
        console.log(`${shot} passes: ${top}`);
        // (Each pass's mean, and its least: a frame the GPU's clock held up.)
        const clouds = ['clouds', 'clouds-prepare']
            .map((k) => `${k} ${((sums[k] || 0) / 60).toFixed(3)} (least ${(mins[k] ?? 0).toFixed(3)})`).join(', ');
        console.log(`${shot} clouds: ${clouds}`);
        const ground = Object.keys(sums).filter((k) => /land|world|terrain|ground/i.test(k))
            .map((k) => `${k} ${(sums[k] / 60).toFixed(3)}`).join(', ');
        console.log(`${shot} land: ${ground}`);
        ms.sort((a, b) => a - b);
        const mean = ms.reduce((a, b) => a + b, 0) / Math.max(ms.length, 1);
        console.log(`${shot}: ${mean.toFixed(2)} / ${(ms[ms.length >> 1] || 0).toFixed(2)} / ${(ms[ms.length - 1] || 0).toFixed(2)} ms`);
    }
}
