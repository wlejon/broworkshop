// The wilds' frame-rate bench, in headless bro (a real GPU, the clock
// virtual: every frame is 1/60 s of flight, so a run is the same on any
// machine; the times are real).
//
//   bro-headless --width 2560 --height 1364 demos/wilds demos/wilds/bench.js -- \
//       routes [routes=orbit,cruise,treetop,skim,walk,vista] [speeds=1] [seconds=20] [warm=3]
//              [sky=golden] [wind=breeze] [tier=auto] [label=wilds] [km=4]
//       each route at each speed: a warm, then `seconds` of frames, each
//       frame's GPU ms (perf.gpuFrameMs: the scene's render on the GPU), the
//       main thread's CPU ms (perf.threadCpuMs over the frame's update and
//       render recording, its waits left out), the frame's wall ms (its waits
//       in: the GPU's and the worker pool's) and the trees at each tier;
//       a line per route and speed (mean / p50 / p95 / p99 / worst, the
//       frame as the slower of the two, so the fps it bounds), the three
//       worst frames with where the eye was, and <label>_bench.json
//   ... bench.js -- stills [routes=...] [t=10] [label=wilds]
//       a frame of each route t seconds in: captures/<label>_<route>.png
//
// Everything goes to demos/wilds/captures/.

import { world, ROUTES, flight, fly, routeAt, setTier, setWind, sky, forestStats, KM } from "/app/world.js";

const argv = (bro.app && bro.app.argv) || [];
const opt = (key, dflt) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : dflt;
};
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
require('fs').mkdirSync(OUT, { recursive: true });

document.body.classList.add('clean');
flush();

const FPS = 60, DT = 1000 / FPS;
const label = opt('label', 'wilds');
const routes = opt('routes', Object.keys(ROUTES).join(',')).split(',');
setWind(opt('wind', 'breeze'));
sky.apply(opt('sky', 'golden'));
setTier(opt('tier', 'auto'));

const pct = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
const summary = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1] };
};
const f2 = (v) => v.toFixed(2);

function run() {
    const speeds = opt('speeds', '1').split(',').map(Number);
    const seconds = +opt('seconds', 20), warm = +opt('warm', 3);
    const out = { km: KM, trees: world.stats.trees, size: [window.innerWidth, window.innerHeight], runs: [] };
    console.log(`wilds bench: ${KM} km, ${world.stats.trees.toLocaleString()} trees, ${window.innerWidth}x${window.innerHeight}, ` +
                `${seconds} s a run at ${FPS} fps of flight`);
    for (const key of routes) for (const speed of speeds) {
        fly(key, 0);
        flight.speed = speed;
        for (let i = 0; i < warm * FPS; i++) advanceTime(DT);
        perf.gpuFrameMs();
        const frames = [];
        // `prof=main|all`: bro.profiler over the run, its report (`top=` lines, 30) after the line.
        const prof = opt('prof');
        if (prof) bro.profiler.start({ hz: 2000, threads: prof });
        for (let i = 0; i < seconds * FPS; i++) {
            // (perf.now: the real clock; performance.now is the virtual one.)
            const c0 = perf.threadCpuMs(), w0 = perf.now();
            advanceTime(DT);
            flush();
            // The render finished last, a frame or so behind, not this one:
            // the next frame's work overlaps this one's on the GPU, as a
            // window's frames do. (Waiting for this one, 8 ms of a walk
            // frame, was the GPU's whole frame on top of the CPU's each
            // frame, outside the wall it measured.)
            const gpu = perf.gpuFrameMs({ wait: false });
            const cpu = perf.threadCpuMs() - c0, wall = perf.now() - w0;
            const st = forestStats();
            const { eye } = routeAt(key, flight.t);
            frames.push({ t: +flight.t.toFixed(2), gpu, cpu, wall, eye: eye.map((v) => +v.toFixed(0)),
                          tiers: [st.trees.leaves, st.trees.clumps, st.trees.crowns], verts: st.vertices,
                          shadowVerts: st.shadowVertices, entries: st.entries, detail: [st.detail, st.shadowDetail] });
        }
        const report = prof ? bro.profiler.stop({ report: true, top: +opt('top', 30) }).report : null;
        const gpu = summary(frames.map((f) => f.gpu)), cpu = summary(frames.map((f) => f.cpu));
        const wall = summary(frames.map((f) => f.wall));
        const frame = summary(frames.map((f) => Math.max(f.gpu, f.cpu)));
        const tiers = [0, 1, 2].map((k) => Math.round(frames.reduce((a, f) => a + f.tiers[k], 0) / frames.length));
        const verts = frames.reduce((a, f) => a + f.verts, 0) / frames.length;
        console.log(`${key.padEnd(8)} x${speed}: GPU ${f2(gpu.mean)} mean, ${f2(gpu.p50)} p50, ${f2(gpu.p95)} p95, ` +
                    `${f2(gpu.p99)} p99, ${f2(gpu.max)} max | CPU ${f2(cpu.mean)} mean, ${f2(cpu.p95)} p95, ${f2(cpu.max)} max | ` +
                    `wall ${f2(wall.mean)} mean, ${f2(wall.p50)} p50 | ` +
                    `${(1000 / frame.p50).toFixed(0)} fps p50, ${(1000 / frame.p99).toFixed(0)} at p99 | ` +
                    `trees ${tiers.join(' / ')}, ${(verts / 1e6).toFixed(1)} M verts`);
        const worst = frames.slice().sort((a, b) => Math.max(b.gpu, b.cpu) - Math.max(a.gpu, a.cpu)).slice(0, 3);
        for (const w of worst)
            console.log(`    worst t ${w.t} s at [${w.eye}]: GPU ${f2(w.gpu)}, CPU ${f2(w.cpu)}, trees ${w.tiers.join(' / ')}`);
        if (report) console.log(report);
        out.runs.push({ route: key, speed, gpu, cpu, wall, frame, tiers, verts, frames });
    }
    const file = `${OUT}/${label}_bench.json`;
    require('fs').writeFileSync(file, JSON.stringify(out));
    console.log('wrote ' + file);
}

function stills() {
    const t = +opt('t', 10);
    for (const key of routes) {
        fly(key, 0);
        flight.speed = 1;
        for (let i = 0; i < t * 30; i++) advanceTime(1000 / 30);
        const file = `${OUT}/${label}_${key}.png`;
        screenshot(file);
        console.log('wrote ' + file);
    }
}

const mode = argv.find((s) => !s.includes('=')) || 'routes';
if (mode === 'stills') stills(); else run();
