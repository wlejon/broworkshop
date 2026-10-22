// Captures of the planet world in headless bro (virtual clock, 30 fps).
//
//   bro-headless --width 1280 --height 720 demos/planet demos/planet/capture.js -- \
//       still [shot[,shot...]]      captures/planet_<shot>.png
//   ... capture.js -- cost [shot[,shot...]]
//       GPU ms held at each shot (mean / median / max of 60 frames after a
//       two-second warm)
import { SHOTS, setShot, land, scene } from "/app/world.js";

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
        step(+(opt('warm') || 2.0));
        setShot(shot);   // (the ground under a view is read once the land is in)
        step(1.0);
        screenshot(`${OUT}/planet_${shot}.png`);
        console.log(`${shot}: captures/planet_${shot}.png ${JSON.stringify(land.landStats())}`);
    }
} else if (mode === 'cost') {
    for (const shot of shotsOf(argv[1])) {
        setShot(shot);
        step(2.0);
        setShot(shot);
        step(1.0);
        const ms = [];
        for (let i = 0; i < 60; i++) {
            advanceTime(1000 / fps);
            const p = scene.perf && scene.perf();
            if (p && p.gpuMs !== undefined) ms.push(p.gpuMs);
        }
        ms.sort((a, b) => a - b);
        const mean = ms.reduce((a, b) => a + b, 0) / Math.max(ms.length, 1);
        console.log(`${shot}: ${mean.toFixed(2)} / ${(ms[ms.length >> 1] || 0).toFixed(2)} / ${(ms[ms.length - 1] || 0).toFixed(2)} ms`);
    }
}
