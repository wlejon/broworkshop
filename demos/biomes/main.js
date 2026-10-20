// biomes entry: the panel over the world (world.js, which the capture
// script imports too).
import { boot, segmented } from "/lib/kit/index.js";
import { vp, sky, SHOTS, setShot, land } from "/app/world.js";

boot();

const labels = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o[k].label]));
segmented('#shots', labels(SHOTS), { value: 'glade', onChange: setShot });
segmented('#tod', Object.fromEntries(sky.order.map((k) => [k, sky.presets[k].label])),
    { value: sky.current, onChange: (k) => sky.apply(k) });

// Any drag or wheel on the view takes it over from the held shot.
for (const ev of ['pointerdown', 'wheel']) vp.canvas.addEventListener(ev, () => land(), { capture: true });
