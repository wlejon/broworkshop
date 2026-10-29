// Captures of the planet world in headless bro (virtual clock, 30 fps).
//
//   bro-headless --grant files --width 1280 --height 720 demos/planet demos/planet/capture.js -- \
//       still [shot[,shot...]]      captures/planet_<shot>.png
//       [tag=<t>]                   ... named planet_<shot>_<t>.png instead
//       [crop=x,y,w,h[;...]]        and those rects of it, _crop<i>.png
//   ... capture.js -- cost [shot[,shot...]]
//       GPU ms held at each shot (mean / median / max of 60 frames after an
//       eight-second warm and the scene settled), its costliest passes, and
//       each world-service job's GPU ms a unit (`land`: a land tile made)
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
//       the two sets at the same moment; with crop=x,y,w,h, B's light on
//       A's over that rect in 32 px blocks (looksDiff)
//   ... capture.js -- compare [shot,...] dir=<tree> ko=SUN,FORMS [frames=30]
//       set B the tree compiled with KO_SUN, then KO_FORMS (its parts
//       guarded `#ifndef KO_<part>`), each against A: a line a part, the
//       frame's difference and the passes that moved
//
// Every view waits for the scene to settle (perf.settle: the land's regions
// and tiles, the plants placed, the clouds' bakes, the exposure) on a held
// clock, so a still shows the same moment however long the wait took.
import { SHOTS, setShot, holdView, still, land, scene } from "/app/world.js";

const argv = (bro.app && bro.app.argv) || [];
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const opt = (key) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : undefined;
};
// (fps=<n>: the frames a second the virtual clock steps by, 30 unless
// asked; work paced by time rather than frames costs a frame its share at
// the rate the frames come, so `cost fps=360` is the 360 fps frame.)
const fps = +(opt('fps') ?? 30);
const step = (seconds) => { for (let i = 0, n = Math.max(1, Math.round(seconds * fps)); i < n; i++) advanceTime(1000 / fps); };
// B's light on A's over rect `c` (x, y, w, h), both toImageData pictures:
// each 32 px block's mean linear luma, its log2; the blocks' mean
// difference in stops and mean |difference|, by thirds of the rect top to
// bottom too (far to near over ground), and r of the two sets of blocks.
const looksDiff = (a, b, c) => {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const luma = (im, x, y) => { const i = (im.channels || 4) * (y * im.width + x); return 0.2126 * lin(im.data[i]) + 0.7152 * lin(im.data[i + 1]) + 0.0722 * lin(im.data[i + 2]); };
    const B = 32, rows = [];
    for (let y = c[1]; y + B <= c[1] + c[3]; y += B) {
        const row = [];
        for (let x = c[0]; x + B <= c[0] + c[2]; x += B) {
            let sa = 0, sb = 0;
            for (let j = 0; j < B; j += 2) for (let i = 0; i < B; i += 2) { sa += luma(a, x + i, y + j); sb += luma(b, x + i, y + j); }
            row.push([Math.log2(Math.max(sa, 1e-6)), Math.log2(Math.max(sb, 1e-6))]);
        }
        rows.push(row);
    }
    const stat = (blocks) => {
        const n = blocks.length || 1;
        const d = blocks.reduce((s, [p, q]) => s + q - p, 0) / n;
        const ad = blocks.reduce((s, [p, q]) => s + Math.abs(q - p), 0) / n;
        return [d, ad];
    };
    const all = rows.flat();
    const ma = all.reduce((s, v) => s + v[0], 0) / all.length, mb = all.reduce((s, v) => s + v[1], 0) / all.length;
    let sab = 0, saa = 0, sbb = 0;
    for (const [p, q] of all) { sab += (p - ma) * (q - mb); saa += (p - ma) ** 2; sbb += (q - mb) ** 2; }
    const third = Math.ceil(rows.length / 3);
    const parts = [0, 1, 2].map((k) => stat(rows.slice(k * third, (k + 1) * third).flat()))
        .map(([d, ad]) => `${d >= 0 ? '+' : ''}${d.toFixed(2)}/${ad.toFixed(2)}`).join(' ');
    const [d, ad] = stat(all);
    return `${all.length} blocks: d ${d >= 0 ? '+' : ''}${d.toFixed(2)} |d| ${ad.toFixed(2)} stop, r ${(sab / Math.sqrt(saa * sbb || 1)).toFixed(2)}; thirds top to bottom (d/|d|) ${parts}`;
};
// The composited frame, what screenshot() writes, as its own copy.
const frameCopy = () => {
    const f = frameImage();
    return { width: f.width, height: f.height, channels: 4, data: new Uint8Array(f.data) };
};
// (eye=x,z,h look=x,z,h: a shot `at` from h over the ground at place (x, z)
// toward h over it at (x, z), the eye's height setting the near plane.)
if (opt('eye')) {
    const [ex, ez, eh] = opt('eye').split(',').map(Number), [lx, lz, lh] = (opt('look') || '0,-1000,0').split(',').map(Number);
    SHOTS.at = { label: 'At', near: Math.max(0.1, eh / 1000), far: 1e6,
                 eye: () => [ex, land.landHeight(ex, ez) + eh, ez], look: () => [lx, land.landHeight(lx, lz) + lh, lz] };
}
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
    // (tag=<t>: captures/planet_<shot>_<t>.png; crop=x,y,w,h[;x,y,w,h...]:
    // also those rects of it, _crop<i>.png.)
    const tag = opt('tag') ? `_${opt('tag')}` : '';
    const crops = (opt('crop') || '').split(';').filter(Boolean).map((c) => c.split(',').map(Number));
    for (const shot of shotsOf(argv[1])) {
        settleShot(shot);
        screenshot(`${OUT}/planet_${shot}${tag}.png`);
        crops.forEach((c, i) => screenshot(`${OUT}/planet_${shot}${tag}_crop${i}.png`, c[0], c[1], c[2], c[3]));
        const cs = scene.cullStats();
        const eye = still.view ? still.view.eye : [NaN, NaN, NaN];
        console.log(`${shot}: captures/planet_${shot}${tag}.png eye ${eye.map((v) => v.toFixed(3)).join(', ')} (ground ${land.landHeight(eye[0], eye[2]).toFixed(3)}) ev ${cs.exposureEv?.toFixed(2)} (metered ${cs.meteredEv?.toFixed(2)})${JSON.stringify(land.landStats())}`);
        console.log(`${shot}: clouds ${JSON.stringify(scene.cloudStats())}`);
        console.log(`${shot}: turf tiles needed ${cs.groundLayerNeeded} missing ${cs.groundLayerMissing} fills ${cs.groundLayerFills} shortfall ${cs.groundLayerShortfall?.toFixed(2)} px`);
    }
} else if (mode === 'looks') {
    // (a=<png> b=<png> [crop=x,y,w,h]: B's light on A's, two stills of
    // another run each, e.g. a world's args against another's.)
    const read = (p) => {
        const im = bro.image.decodeOriented(bro.resolvePath(`/app/captures/${p}`));
        return { width: im.width, height: im.height, channels: im.channels, data: im.pixels };
    };
    const a = read(opt('a')), b = read(opt('b'));
    const crop = opt('crop') ? opt('crop').split(',').map(Number) : [0, 0, a.width, a.height];
    console.log(`looks ${opt('b')} on ${opt('a')}: ${looksDiff(a, b, crop)}`);
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
                for (const k of ['clouds', 'clouds-prepare', 'clouds-volume']) sums[k] = (sums[k] || 0) + (ps[k] || 0);
            }
            console.log(`climb ${i} cost: clouds ${(sums.clouds / 60).toFixed(3)}, clouds-prepare ${(sums['clouds-prepare'] / 60).toFixed(3)}, clouds-volume ${(sums['clouds-volume'] / 60).toFixed(3)}, frame ${(frame / 60).toFixed(2)} ms`);
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
    // (settled=1: the end's view again once all is in, what the flight's
    // frame should have been.)
    if (opt('settled')) {
        settle('fly end', 4000);
        step(1.0);
        screenshot(`${OUT}/planet_fly_settled.png`);
    }
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
        // (passes=<n>: how many of the dearest to list, 8 unless asked.)
        const nPasses = +(opt('passes') ?? 8);
        const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, nPasses)
            .map(([k, v]) => `${k} ${(v / 60).toFixed(2)}`).join(', ');
        console.log(`${shot} passes: ${top}`);
        // (Each pass's mean, and its least: a frame the GPU's clock held up.)
        const clouds = ['clouds', 'clouds-prepare', 'clouds-volume']
            .map((k) => `${k} ${((sums[k] || 0) / 60).toFixed(3)} (least ${(mins[k] ?? 0).toFixed(3)})`).join(', ');
        console.log(`${shot} clouds: ${clouds}`);
        const ground = Object.keys(sums).filter((k) => /land|world|terrain|ground/i.test(k))
            .map((k) => `${k} ${(sums[k] / 60).toFixed(3)}`).join(', ');
        console.log(`${shot} land: ${ground}`);
        // (A unit of each world-service kind's work, GPU ms as measured: a
        // land tile's making, its surface run over every texel, is `land`.)
        const kinds = scene.cullStats().worldKindMs || {};
        console.log(`${shot} world jobs (ms a unit): ${Object.entries(kinds).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', ')}`);
        ms.sort((a, b) => a - b);
        const mean = ms.reduce((a, b) => a + b, 0) / Math.max(ms.length, 1);
        console.log(`${shot}: ${mean.toFixed(2)} / ${(ms[ms.length >> 1] || 0).toFixed(2)} / ${(ms[ms.length - 1] || 0).toFixed(2)} ms`);
    }
} else if (mode === 'compare' && opt('ko')) {
    // (ko=A,B: set B the tree compiled with KO_A, then with KO_B, each
    // against A on the same settled view: a part's cost, guarded
    // `#ifndef KO_<part>` in the tree.)
    const dir = opt('dir');
    if (!dir) throw new Error('compare: dir=<shader tree> is required');
    const frames = +(opt('frames') || 30);
    for (const shot of shotsOf(argv[1])) {
        settleShot(shot);
        for (const name of opt('ko').split(',')) {
            const set = perf.loadShaderSet(dir, { defines: `KO_${name}` });
            const r = perf.compareShaders({ frames });
            const moved = Object.keys(r.diff.passes)
                .filter((k) => Math.abs(r.diff.passes[k].ms) > Math.max(0.02, 2 * r.diff.passes[k].se))
                .sort((x, y) => r.diff.passes[x].ms - r.diff.passes[y].ms)
                .map((k) => `${k} ${r.a.passes[k].mean.toFixed(3)} ${r.diff.passes[k].ms >= 0 ? '+' : ''}${r.diff.passes[k].ms.toFixed(3)} (${r.diff.passes[k].pct.toFixed(0)}%)`).join(', ');
            // (The GPU's clock moves between knock-outs, so A's own ms with
            // each: a part's share of its pass is what compares across them.)
            const d = r.diff.frame;
            console.log(`${shot} KO_${name}: ${set.differing} shaders; frame A ${r.a.frame.mean.toFixed(2)} ${d.ms >= 0 ? '+' : ''}${d.ms.toFixed(3)} ±${d.se.toFixed(3)} ms${moved ? `; ${moved}` : ''}${set.failed.length ? `; failed: ${set.failed.join(', ')}` : ''}`);
            // (crop=x,y,w,h: and its picture's light on A's there.)
            const crop = (opt('crop') || '').split(';').filter(Boolean).map((c) => c.split(',').map(Number))[0];
            if (crop) {
                const ims = {};
                for (const s of ['a', 'b']) {
                    perf.useShaderSet(s, { rebake: true });
                    settle(`${shot} ${s}`, 600);
                    // (The frame's copy written, not screenshot()'s: after a
                    // set switch that was the same picture for both sets.)
                    ims[s] = frameCopy();
                    bro.image.encodePngFile(`${OUT}/planet_${shot}_ko_${s === 'b' ? name : 'A'}.png`,
                                            ims[s].data, ims[s].width, ims[s].height, 4);
                }
                perf.useShaderSet('a', { rebake: true });
                console.log(`${shot} KO_${name} looks: ${looksDiff(ims.a, ims.b, crop)}`);
            }
        }
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
        const ims = {};
        for (const s of ['a', 'b']) {
            perf.useShaderSet(s, { rebake: true });
            settle(`${shot} ${s}`, 600);
            screenshot(`${OUT}/planet_${shot}_${s}.png`);
            ims[s] = frameCopy();
        }
        perf.useShaderSet('a', { rebake: true });
        console.log(`${shot}: captures/planet_${shot}_a.png, captures/planet_${shot}_b.png`);
        // (crop=x,y,w,h: B's light on A's over that rect, in blocks.)
        const crop = (opt('crop') || '').split(';').filter(Boolean).map((c) => c.split(',').map(Number))[0];
        if (crop) console.log(`${shot} looks: ${looksDiff(ims.a, ims.b, crop)}`);
    }
}
