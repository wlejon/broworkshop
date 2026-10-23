// Captures of the planet world in headless bro (virtual clock, 30 fps).
//
//   bro-headless --width 1280 --height 720 demos/planet demos/planet/capture.js -- \
//       still [shot[,shot...]]      captures/planet_<shot>.png
//   ... capture.js -- cost [shot[,shot...]]
//       GPU ms held at each shot (mean / median / max of 60 frames after an
//       eight-second warm and the plants placed), and its costliest passes
import { SHOTS, setShot, land, plants, scene } from "/app/world.js";

const argv = (bro.app && bro.app.argv) || [];
const OUT = bro.resolvePath('/app/captures').replace(/\\/g, '/');
const fps = 30;
const step = (seconds) => { for (let i = 0, n = Math.max(1, Math.round(seconds * fps)); i < n; i++) advanceTime(1000 / fps); };
const opt = (key) => {
    const a = argv.find((s) => typeof s === 'string' && s.startsWith(key + '='));
    return a ? a.slice(key.length + 1) : undefined;
};
const shotsOf = (s) => (s && !s.includes('=') ? s : Object.keys(SHOTS).join(',')).split(',').filter((k) => SHOTS[k]);

document.body.classList.add('clean');
bro.menu.hide();
flush();
// The land is made by its processes first.
{
    const t0 = performance.now();
    let frames = 0;
    for (; frames < 300 && !land.landStats()?.ready; frames++) advanceTime(1000 / fps);
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
        for (let i = 0; i < 600 && plants.plantPlacement()?.pending > 0; i++) advanceTime(1000 / fps);
        step(0.5);
        screenshot(`${OUT}/planet_${shot}.png`);
        console.log(`${shot}: captures/planet_${shot}.png ${JSON.stringify(land.landStats())}`);
    }
} else if (mode === 'cost') {
    for (const shot of shotsOf(argv[1])) {
        setShot(shot);
        step(8.0);
        setShot(shot);
        step(1.0);
        for (let i = 0; i < 600 && plants.plantPlacement()?.pending > 0; i++) advanceTime(1000 / fps);
        step(1.0);
        perf.gpuFrameMs();
        const ms = [];
        const sums = {};
        for (let i = 0; i < 60; i++) {
            advanceTime(1000 / fps);
            ms.push(perf.gpuFrameMs());
            const p = (perf.gpuPasses && perf.gpuPasses()) || {};
            for (const k in p) if (typeof p[k] === 'number') sums[k] = (sums[k] || 0) + p[k];
        }
        const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 8)
            .map(([k, v]) => `${k} ${(v / 60).toFixed(2)}`).join(', ');
        console.log(`${shot} passes: ${top}`);
        ms.sort((a, b) => a - b);
        const mean = ms.reduce((a, b) => a + b, 0) / Math.max(ms.length, 1);
        console.log(`${shot}: ${mean.toFixed(2)} / ${(ms[ms.length >> 1] || 0).toFixed(2)} / ${(ms[ms.length - 1] || 0).toFixed(2)} ms`);
    }
}
