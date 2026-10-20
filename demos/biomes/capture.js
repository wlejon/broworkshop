// Captures of the biomes world in headless bro (virtual clock, 30 fps).
//
//   bro-headless --width 2560 --height 1364 demos/biomes demos/biomes/capture.js -- \
//       still <shot[,shot...]> [sky=afternoon]      captures/biomes_<shot>.png
//   ... capture.js -- cost <shot[,shot...]> [sky=afternoon]
//       GPU ms held at each shot (mean / median / max of 60 frames after a
//       five-second warm), the plants drawn, and the passes (perf.gpuPasses)
//   ... capture.js -- strip <shot> [frames=90]      a second of motion, every
//       third frame side by side: captures/biomes_<shot>_strip.png
import { sky, SHOTS, setShot, holdView, plants, SPECIES, MEADOW, groundHeight } from "/app/world.js";

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

document.body.classList.add('clean');
flush();
sky.apply(opt('sky') || 'afternoon');

const mode = argv[0] || 'still';
if (mode === 'still') {
    for (const shot of shotsOf(argv[1])) {
        setShot(shot);
        step(1.0);
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
        }
    }
} else if (mode === 'specimens') {
    // One of each species alone in the meadow, side-lit, then from above.
    const x0 = MEADOW.x, z0 = MEADOW.z;
    const row = SPECIES.map((_, i) => {
        const x = x0 + (i - (SPECIES.length - 1) / 2) * 16;
        return { x, y: groundHeight(x, z0) - 0.1, z: z0, yaw: i, scale: 1, species: i, seed: 101 + i, tint: 0 };
    });
    plants.setPlants(row);
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
