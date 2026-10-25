// Captures of the planet world in headless bro (virtual clock, 30 fps).
//
//   bro-headless --width 1280 --height 720 demos/planet demos/planet/capture.js -- \
//       still [shot[,shot...]]      captures/planet_<shot>.png
//   ... capture.js -- cost [shot[,shot...]]
//       GPU ms held at each shot (mean / median / max of 60 frames after an
//       eight-second warm and the scene settled), and its costliest passes
//   ... capture.js -- climb [steps=4]
//       captures/planet_climb<i>.png: the eye from region's (90 km) to
//       orbit's (18000 km) in `steps` views between, its height growing
//       by the same ratio each and its view turning down from region's
//       slant to orbit's nadir as evenly: whether anything pops or changes
//       character on the way up; with cost=1, the clouds' passes and the
//       frame's GPU ms at each view (mean of 60 frames held there)
//   ... capture.js -- fly [seconds=20]
//       the eye from region's height (90 km) down to 1500 m over the first
//       half, flying on at 6 km/s throughout, the land's regions made
//       under it as it goes: each frame's GPU ms and wall ms, the worst
//       frames, and captures/planet_fly.png at the end
//   ... capture.js -- compare [shot[,shot...]] dir=<shader tree> [frames=60]
//       the scene's shaders from <dir> (a copy of bro's
//       src/scene/vulkan/shaders, edited) against the running ones, on the
//       same held view in one process, a frame each in turn
//       (perf.compareShaders): each set's frame and pass GPU ms (mean and
//       least) and B's difference from A per pass, with its standard error;
//       captures/planet_<shot>_a.png and _b.png,
//       the two sets at the same moment
//
// Every view waits for the scene to settle (perf.settle: the land's regions
// and tiles, the plants placed, the clouds' bakes, the exposure) on a held
// clock, so a still shows the same moment however long the wait took.
import { SHOTS, setShot, holdView, land, scene } from "/app/world.js";

const argv = (bro.app && bro.app.argv) || [];
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const fps = 30;
const step = (seconds) => { for (let i = 0, n = Math.max(1, Math.round(seconds * fps)); i < n; i++) advanceTime(1000 / fps); };
const opt = (key) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : undefined;
};
const shotsOf = (s) => (s && !s.includes('=') ? s : Object.keys(SHOTS).join(',')).split(',').filter((k) => SHOTS[k]);
// The scene settled for the view on a held clock (at most `max` frames;
// `kinds` only those kinds of work).
const settle = (what, max = 8000, kinds) => {
    const s = perf.settle({ maxFrames: max, kinds });
    console.log(`${what}: settled ${s.settled} after ${s.frames} frames ${JSON.stringify(s.waited)}${s.settled ? '' : ` (${s.pending.join('; ')})`}`);
    return s;
};
// A shot set and settled: long enough a warm for the plants' canopy to come
// in and the land's tiles made again with it, the shot set again (the
// ground under a view is read once the land is in), then settled.
const settleShot = (shot) => {
    setShot(shot);
    step(+(opt('warm') || 8.0));
    setShot(shot);
    step(1.0);
    settle(shot);
    step(1.0);
};

document.body.classList.add('clean');
bro.menu.hide();
flush();
// The land is made by its processes first (the shots stand on it).
settle('start', 300, ['land processes']);

const mode = argv[0] || 'still';
if (mode === 'still') {
    for (const shot of shotsOf(argv[1])) {
        settleShot(shot);
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
        if (opt('cost')) {
            // (The clouds' passes and the frame, mean of 60 frames held here.)
            perf.gpuFrameMs();
            const sums = {};
            let frame = 0;
            for (let f = 0; f < 60; f++) {
                advanceTime(1000 / fps);
                frame += perf.gpuFrameMs();
                const ps = (perf.gpuPasses && perf.gpuPasses()) || {};
                for (const k of ['clouds', 'clouds-prepare']) sums[k] = (sums[k] || 0) + (ps[k] || 0);
            }
            console.log(`climb ${i} cost: clouds ${(sums.clouds / 60).toFixed(3)}, clouds-prepare ${(sums['clouds-prepare'] / 60).toFixed(3)}, frame ${(frame / 60).toFixed(2)} ms`);
        }
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
    settle('fly start', 4000);
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
        settleShot(shot);
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
} else if (mode === 'compare') {
    const dir = opt('dir');
    if (!dir) throw new Error('compare: dir=<shader tree> is required');
    const set = perf.loadShaderSet(dir);
    console.log(`set B ${set.dir}${set.failed.length ? `; did not compile (A's kept): ${set.failed.join(', ')}` : ''}`);
    const frames = +(opt('frames') || 60);
    const f3 = (x) => x.toFixed(3).padStart(8);
    for (const shot of shotsOf(argv[1])) {
        settleShot(shot);
        const r = perf.compareShaders({ frames });
        const row = (name, a, b, d) =>
            `  ${name.padEnd(28)}${f3(a.mean)}${f3(b.mean)}${f3(a.min)}${f3(b.min)}${f3(d.ms)} ±${d.se.toFixed(3).padEnd(6)}${(d.pct >= 0 ? '+' : '') + d.pct.toFixed(1)}%`;
        console.log(`${shot}: ${frames} frames a set, in pairs of A and B; ${r.set.differing} of ${r.set.shaders} shaders differ, ${r.set.twinned} of ${r.set.pipelines} pipelines twinned`);
        console.log(`  ${'pass'.padEnd(28)}${'A mean'.padStart(8)}${'B mean'.padStart(8)}${'A least'.padStart(8)}${'B least'.padStart(8)}${'B-A'.padStart(8)}`);
        console.log(row('frame', r.a.frame, r.b.frame, r.diff.frame));
        // (The passes over 0.02 ms in either set, dearest first.)
        Object.keys(r.diff.passes)
            .filter((k) => Math.max(r.a.passes[k].mean, r.b.passes[k].mean) > 0.02)
            .sort((x, y) => r.a.passes[y].mean - r.a.passes[x].mean)
            .forEach((k) => console.log(row(k, r.a.passes[k], r.b.passes[k], r.diff.passes[k])));
        // The two sets' pictures at the same moment, each set's bakes made by it.
        for (const s of ['a', 'b']) {
            perf.useShaderSet(s, { rebake: true });
            settle(`${shot} ${s}`, 600);
            screenshot(`${OUT}/planet_${shot}_${s}.png`);
        }
        perf.useShaderSet('a', { rebake: true });
        console.log(`${shot}: captures/planet_${shot}_a.png, captures/planet_${shot}_b.png`);
    }
}
