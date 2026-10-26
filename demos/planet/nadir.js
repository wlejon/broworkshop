// Straight down on one place of the body from several heights: each view's
// middle is the next one's whole (crop the higher view to (h_low - 6 km) /
// (h_high - 6 km) of its side), so a cloud or a lake seen from two heights
// can be set side by side, refined or replaced. After each view settles,
// more frames can be drawn and shot (again=), with what is still pending
// and the shadow and world counters, to catch what settles late unsaid.
//
// bro-headless --grant files --width 1024 --height 1024 demos/planet demos/planet/nadir.js -- [heights=270000,90000,30000,13000] [x=0] [z=0] [again=1,5,20]
// -> captures/planet_nadir_<h>.png (and _<h>_<n>.png)
import { holdView, setShot, land, scene } from "/app/world.js";
document.body.classList.add('clean');
bro.menu.hide();
bro.time.scale = 0;
flush();
const arg = (k, d) => { const a = (bro.app.argv || []).find((s) => s.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
// (The body is placed with the first frames: toBody answers nothing before.)
setShot(arg('shot', 'region'));
perf.settle({ maxFrames: 8000 });
const X = +arg('x', 0), Z = +arg('z', 0);
const OUT = bro.resolvePath('/app/captures');
for (const h of arg('heights', '270000,90000,30000,13000').split(',').map(Number)) {
    // (Placed in the body's frame and held again once the place re-anchors
    // under the eye, which moves the place frame the view was given in.)
    const b = Array.from(scene.toBody([X, land.landHeight(X, Z), Z]));
    for (let k = 0; k < 2; k++) {
        const p = scene.toPlace(b);
        const g = land.landHeight(p[0], p[2]);
        holdView([p[0], g + h, p[2]], [p[0], g, p[2]], Math.max(1, h * 1e-3), h * 10 + 1e6, [0, 0, -1]);
        perf.settle({ maxFrames: 8000 });
        advanceTime(16);
    }
    perf.settle({ maxFrames: 8000 });
    screenshot(`${OUT}/planet_nadir_${h}.png`);
    console.log('nadir', h, perf.pendingWork().join('; '));
    let done = 0;
    for (const n of arg('again', '').split(',').filter(Boolean).map(Number)) {
        for (; done < n; done++) advanceTime(16);
        screenshot(`${OUT}/planet_nadir_${h}_${n}.png`);
        const cs = scene.cullStats();
        const pick = {};
        for (const k in cs) if (/shadow|world|sun|land/i.test(k) && typeof cs[k] !== 'object') pick[k] = cs[k];
        console.log('again', n, perf.pendingWork().join('; '), JSON.stringify(pick));
    }
}
