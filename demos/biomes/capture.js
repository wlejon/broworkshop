// Captures of the biomes world in headless bro (virtual clock, 30 fps).
//
//   bro-headless --width 2560 --height 1364 demos/biomes demos/biomes/capture.js -- \
//       still <shot[,shot...]> [sky=afternoon]      captures/biomes_<shot>.png
//   (every mode takes probes=0 to light the ambient by the open sky)
//   ... capture.js -- cost <shot[,shot...]> [sky=afternoon]
//       GPU ms held at each shot (mean / median / max of 60 frames after a
//       five-second warm), the plants drawn, and the passes (perf.gpuPasses)
//   ... capture.js -- strip <shot> [frames=90]      a second of motion, every
//       third frame side by side: captures/biomes_<shot>_strip.png
//   ... capture.js -- jump <from> <to> [hold=3] [frames=90]
//       holds <from>, cuts the camera to <to>, and logs every frame after the
//       cut: GPU ms, the world service's budget, spent and worst error, and
//       the turf's fills and missing tiles (scene.cullStats)
//   ... capture.js -- exposure [from=canopy] [to=flyover] [hold=5]
//       cuts from one shot to another and back, logging every frame's
//       metered EV, the EV applied and the exposure scale
//   ... capture.js -- motion walk|fly|pan|sun [frames=150]
//       walk: the glade at 1.4 m/s; fly: the flyover at 40 m/s; every frame's
//       GPU ms and shadow pages (drawn, overlays, left wanted), and how many
//       frames went over 2.78 ms. pan (the glade sidestepping at 0.5 m/s) and
//       sun (the glade held, the sun turning 0.02 degrees a frame) run in a
//       calm with the exposure pinned and read the ground at fixed world
//       points frame over frame: how much it changes (a still scene's ground
//       should not), the frames' change spikes, and two slit-scans
//       (captures/biomes_motion_<kind>.png: a row a frame of a line of ground
//       across the view at 6 m and 20 m); passes=<n> logs each frame's n
//       dearest passes too
import { sky, SHOTS, setShot, holdView, plants, SPECIES, MEADOW, groundHeight, scene, vp } from "/app/world.js";

const argv = (bro.app && bro.app.argv) || [];
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const fps = 30;
const step = (seconds) => { for (let i = 0, n = Math.max(1, Math.round(seconds * fps)); i < n; i++) advanceTime(1000 / fps); };
const opt = (key) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : undefined;
};
const shotsOf = (s) => (s || Object.keys(SHOTS).join(',')).split(',').filter((k) => SHOTS[k]);

// The plants node's detail, for A/Bs: pixels=, shadowPixels=, shadowRange=, ...
for (const k of ['pixels', 'minElements', 'woodRange', 'range', 'shadowTexels', 'shadowRange'])
    if (opt(k) !== undefined) plants.setPlants({ [k]: +opt(k) });
// The probe grid, for A/Bs: probes=0 lights the ambient by the open sky.
if (opt('probes') !== undefined) scene.setProbeGrid(opt('probes') !== '0');

document.body.classList.add('clean');
flush();
sky.apply(opt('sky') || 'afternoon');
// The plants are placed about the eye on the engine's threads: the first
// shot waits for the world in reach.
{
    let frames = 0;
    const t0 = performance.now();
    for (; frames < 600 && (frames === 0 || plants.plantPlacement().pending > 0); frames++) advanceTime(1000 / fps);
    const p = plants.plantPlacement();
    console.log(`placed: ${p.cells} cells, ${plants.plantStats().plants} plants in ${frames} frames, ` +
                `${Math.round(performance.now() - t0)} ms`);
}

const mode = argv[0] || 'still';
if (mode === 'still') {
    for (const shot of shotsOf(argv[1])) {
        setShot(shot);
        step(+(opt('warm') || 1.0));
        const file = `${OUT}/biomes_${shot}.png`;
        screenshot(file);
        const s = plants.plantStats();
        console.log(`${shot}: ${file}  plants ${s.visible}/${s.plants}, elements ${s.elements}, limbs ${s.limbs}`);
    }
} else if (mode === 'cost') {
    const passes = typeof perf.gpuPasses === 'function';
    for (const shot of shotsOf(argv[1])) {
        setShot(shot);
        step(5.0);
        perf.gpuFrameMs();
        const ms = [];
        const sums = {};
        for (let i = 0; i < 60; i++) {
            advanceTime(1000 / fps);
            ms.push(perf.gpuFrameMs());
            if (passes) {
                const p = perf.gpuPasses() || {};
                for (const k in p) if (typeof p[k] === 'number') sums[k] = (sums[k] || 0) + p[k];
            }
        }
        const sorted = ms.filter((v) => v >= 0).sort((a, b) => a - b);
        const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(sorted.length, 1);
        const s = plants.plantStats();
        console.log(`${shot}: GPU mean ${mean.toFixed(2)} median ${sorted[sorted.length >> 1].toFixed(2)} ` +
                    `max ${sorted[sorted.length - 1].toFixed(2)} ms; plants ${s.visible}, elements ${s.elements}, ` +
                    `limbs ${s.limbs}, cast ${s.shadowElements}`);
        if (passes) {
            const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 12);
            console.log('  ' + top.map(([k, v]) => `${k} ${(v / 60).toFixed(2)}`).join('  '));
            const shadow = Object.entries(sums).filter(([k]) => k.startsWith('shadow')).sort((a, b) => b[1] - a[1]);
            console.log('  shadow: ' + shadow.map(([k, v]) => `${k} ${(v / 60).toFixed(3)}`).join('  '));
        }
        const c = scene.cullStats() || {};
        console.log(`  pages: needed ${c.shadowPagesNeeded} resident ${c.shadowPagesResident} drawn ${c.shadowPagesDrawn} ` +
                    `dynamic ${c.shadowPagesDynamic} wanted ${c.shadowPagesWanted} views ${c.shadowViews}`);
    }
} else if (mode === 'specimens') {
    // One of each species alone in the meadow, side-lit, then from above.
    const x0 = MEADOW.x, z0 = MEADOW.z;
    const row = SPECIES.map((_, i) => {
        const x = x0 + (i - (SPECIES.length - 1) / 2) * 16;
        return { x, y: groundHeight(x, z0) - 0.1, z: z0, yaw: i, scale: 1, species: i, seed: 101 + i, tint: 0 };
    });
    plants.setPlants({ rules: null, plants: row });
    const views = {
        side: [[x0, groundHeight(x0, z0 + 52) + 6, z0 + 52], [x0, groundHeight(x0, z0) + 7, z0]],
        high: [[x0 + 30, groundHeight(x0, z0) + 50, z0 + 40], [x0, groundHeight(x0, z0) + 4, z0]],
    };
    for (const k in views) {
        holdView(views[k][0], views[k][1]);
        step(1.0);
        const file = `${OUT}/biomes_specimens_${k}.png`;
        screenshot(file);
        console.log(`specimens ${k}: ${file}`);
    }
} else if (mode === 'jump') {
    const from = SHOTS[argv[1]] ? argv[1] : 'glade', to = SHOTS[argv[2]] ? argv[2] : 'flyover';
    const frames = +(opt('frames') || 90);
    setShot(from);
    step(+(opt('hold') || 3));
    perf.gpuFrameMs();
    const f = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : '-').padStart(6);
    const row = (i, ms) => {
        const c = scene.cullStats() || {};
        console.log(`${String(i).padStart(4)} ${f(ms)} ms  budget ${f(c.worldBudgetMs)}  spent ${f(c.worldSpentMs)}  ` +
                    `jobs ${String(c.worldJobs ?? '-').padStart(4)}  queued ${String(c.worldQueued ?? '-').padStart(5)}  ` +
                    `worst ${f(c.worldWorstError)} px  fills ${String(c.groundLayerFills).padStart(4)}  ` +
                    `missing ${String(c.groundLayerMissing).padStart(5)}`);
        return c;
    };
    advanceTime(1000 / fps);
    console.log(`jump: ${from} held, then ${to}; frame 0 is the last held`);
    row(0, perf.gpuFrameMs());
    setShot(to);
    let over = 0, settled = -1;
    for (let i = 1; i <= frames; i++) {
        advanceTime(1000 / fps);
        const ms = perf.gpuFrameMs();
        const c = row(i, ms);
        if (ms > 2.78) over++;
        if (settled < 0 && c.groundLayerMissing === 0) settled = i;
    }
    console.log(`jump: ${over} of ${frames} frames over 2.78 ms; the turf settled at frame ${settled}`);
} else if (mode === 'exposure') {
    // The eye adapting: holds <from>, cuts to <to>, holds, cuts back, every
    // frame's metered EV, the EV applied and the scale (scene.cullStats,
    // read back from the GPU a few frames late).
    const from = SHOTS[argv[1]] ? argv[1] : 'canopy', to = SHOTS[argv[2]] ? argv[2] : 'flyover';
    const hold = Math.round(+(opt('hold') || 5) * fps);
    setShot(from);
    step(3);
    console.log(`exposure: ${from} held, cut to ${to} at frame 0, back to ${from} at frame ${hold}`);
    for (let i = 0; i < 2 * hold; i++) {
        if (i === 0) setShot(to);
        if (i === hold) setShot(from);
        advanceTime(1000 / fps);
        flush();
        const c = scene.cullStats() || {};
        console.log(`${String(i).padStart(4)} metered ${c.meteredEv.toFixed(3)}  applied ${c.exposureEv.toFixed(3)}  ` +
                    `scale ${c.exposureScale.toExponential(4)}`);
    }
} else if (mode === 'motion') {
    const kind = ['walk', 'fly', 'pan', 'sun'].includes(argv[1]) ? argv[1] : 'walk';
    const frames = +(opt('frames') || 150);
    const base = kind === 'fly' ? 'flyover' : 'glade';
    const E = SHOTS[base].eye(), L = SHOTS[base].look();
    const flat = Math.hypot(L[0] - E[0], L[2] - E[2]);
    const fwd = [(L[0] - E[0]) / flat, 0, (L[2] - E[2]) / flat], side = [-fwd[2], 0, fwd[0]];
    const speed = { walk: 1.4, fly: 40, pan: 0.5, sun: 0 }[kind] / fps;
    const dir = kind === 'pan' ? side : fwd;
    const temporal = kind === 'pan' || kind === 'sun';
    if (temporal) scene.setWind({ speed: 0, gust: 0 });
    holdView(E, L);
    step(3);
    if (temporal) {
        scene.setExposure({ mode: 'fixed', ev: scene.cullStats().exposureEv });
        step(0.5);
    }
    // Ground points fixed in the world ahead of the eye, and the two lines
    // of the slit-scans across the view.
    const ground = (a, s) => {
        const x = E[0] + fwd[0] * a + side[0] * s, z = E[2] + fwd[2] * a + side[2] * s;
        return [x, groundHeight(x, z), z];
    };
    const points = [];
    for (let a = 3; a <= 30; a += 0.75) for (let s = -8; s <= 8; s += 0.5) points.push(ground(a, s));
    const SLIT = 512, lines = [6, 20].map((a) => Array.from({ length: SLIT }, (_, k) => ground(a, -6 + 12 * k / (SLIT - 1))));
    const rect = vp.canvas.getBoundingClientRect();
    const lum = (img, p) => {
        const q = scene.projectLocal(p[0], p[1], p[2]);
        if (!q || q.behind) return -1;
        const x = q.x + rect.left - 0.5, y = q.y + rect.top - 0.5, x0 = Math.floor(x), y0 = Math.floor(y);
        if (x0 < 0 || y0 < 0 || x0 + 1 >= img.width || y0 + 1 >= img.height) return -1;
        const fx = x - x0, fy = y - y0, d = img.data;
        const at = (xx, yy) => { const i = (yy * img.width + xx) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
        return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    };
    const sun0 = sky.sun.direction.slice();
    const turn = (deg) => {
        const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        sky.sun.direction = [sun0[0] * c + sun0[2] * s, sun0[1], -sun0[0] * s + sun0[2] * c];
    };
    perf.gpuFrameMs();
    const ms = [], drawn = [], prev = new Float32Array(points.length).fill(-1);
    const energy = [], deltas = [];
    const scans = lines.map(() => new ImageData(SLIT, frames));
    let over = 0;
    console.log(`motion ${kind}: ${frames} frames from ${base}`);
    for (let i = 0; i < frames; i++) {
        const t = (i + 1) * speed;
        holdView([E[0] + dir[0] * t, E[1], E[2] + dir[2] * t], [L[0] + dir[0] * t, L[1], L[2] + dir[2] * t]);
        if (kind === 'sun') turn(0.02 * (i + 1));
        advanceTime(1000 / fps);
        const img = temporal ? frameImage() : null;
        const g = perf.gpuFrameMs();
        const c = scene.cullStats() || {};
        ms.push(g);
        drawn.push(c.shadowPagesDrawn);
        if (g > 2.78) over++;
        if (temporal) {
            let e = 0, n = 0;
            for (let k = 0; k < points.length; k++) {
                const v = lum(img, points[k]);
                if (v >= 0 && prev[k] >= 0) { const d = Math.abs(v - prev[k]); deltas.push(d); e += d; n++; }
                prev[k] = v;
            }
            if (i > 0) energy.push(n ? e / n : 0);
            lines.forEach((line, li) => {
                for (let k = 0; k < SLIT; k++) {
                    const v = Math.max(0, lum(img, line[k])), o = (i * SLIT + k) * 4, sd = scans[li].data;
                    sd[o] = sd[o + 1] = sd[o + 2] = Math.min(255, v); sd[o + 3] = 255;
                }
            });
        }
        console.log(`${String(i).padStart(4)} ${g.toFixed(2).padStart(6)} ms  pages drawn ${String(c.shadowPagesDrawn).padStart(4)}  ` +
                    `overlays ${String(c.shadowPagesDynamic).padStart(3)}  wanted ${String(c.shadowPagesWanted).padStart(4)}  ` +
                    `views ${String(c.shadowViews).padStart(3)}` + (temporal && i > 0 ? `  change ${energy[i - 1].toFixed(3)}` : ''));
        if (opt('passes') && typeof perf.gpuPasses === 'function') {
            const top = Object.entries(perf.gpuPasses() || {}).filter(([, v]) => typeof v === 'number')
                .sort((a, b) => b[1] - a[1]).slice(0, +opt('passes') || 8);
            console.log('       ' + top.map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  '));
        }
    }
    const sorted = ms.filter((v) => v >= 0).sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(sorted.length, 1);
    const dmean = drawn.reduce((a, b) => a + b, 0) / drawn.length;
    console.log(`motion ${kind}: GPU mean ${mean.toFixed(2)} median ${sorted[sorted.length >> 1].toFixed(2)} ` +
                `max ${sorted[sorted.length - 1].toFixed(2)} ms, ${over} of ${frames} frames over 2.78 ms; ` +
                `pages drawn a frame mean ${dmean.toFixed(1)} max ${Math.max(...drawn)}`);
    if (temporal) {
        deltas.sort((a, b) => a - b);
        const q = (p) => deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))];
        const em = energy.reduce((a, b) => a + b, 0) / energy.length, emax = Math.max(...energy);
        const pops = deltas.filter((d) => d > 16).length;
        console.log(`motion ${kind}: ground change a point a frame mean ${em.toFixed(3)} (spike ${emax.toFixed(3)}, ` +
                    `${(emax / em).toFixed(2)}x), p50 ${q(0.5).toFixed(2)} p99 ${q(0.99).toFixed(2)} p99.9 ${q(0.999).toFixed(2)} ` +
                    `max ${deltas[deltas.length - 1].toFixed(1)}, ${pops} of ${deltas.length} over 16`);
        const canvas = document.createElement('canvas');
        canvas.width = SLIT * 2 + 8; canvas.height = frames;
        const ctx = canvas.getContext('2d');
        scans.forEach((s, li) => ctx.putImageData(s, li * (SLIT + 8), 0));
        const file = `${OUT}/biomes_motion_${kind}${opt('tag') ? '_' + opt('tag') : ''}.png`;
        screenshot(file, canvas);
        console.log(`motion ${kind}: ${file}`);
    }
} else if (mode === 'strip') {
    const shot = shotsOf(argv[1])[0];
    setShot(shot);
    step(2.0);
    const frames = +(opt('frames') || 90);
    const imgs = [];
    for (let i = 0; i < frames; i++) {
        advanceTime(1000 / fps);
        if (i % 3 === 0) imgs.push(frameImage());
    }
    // The middle column band of each grab, side by side.
    const w = imgs[0].width, h = imgs[0].height, band = Math.max(8, Math.floor(w / imgs.length));
    const out = new ImageData(band * imgs.length, h);
    for (let k = 0; k < imgs.length; k++) {
        const src = imgs[k].data, x0 = Math.floor((w - band) / 2);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < band; x++) {
                const si = (y * w + x0 + x) * 4, di = (y * out.width + k * band + x) * 4;
                out.data[di] = src[si]; out.data[di + 1] = src[si + 1]; out.data[di + 2] = src[si + 2]; out.data[di + 3] = 255;
            }
    }
    const canvas = document.createElement('canvas');
    canvas.width = out.width; canvas.height = out.height;
    canvas.getContext('2d').putImageData(out, 0, 0);
    const file = `${OUT}/biomes_${shot}_strip.png`;
    screenshot(file, canvas);
    console.log(`strip: ${file}`);
}
