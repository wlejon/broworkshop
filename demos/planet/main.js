// planet entry: the panel over the world (world.js, which the capture script
// imports too).
import { boot, segmented } from "/lib/kit/index.js";
import { vp, SHOTS, setShot, letGo } from "/app/world.js";

boot();

const labels = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o[k].label]));
segmented('#shots', labels(SHOTS), { value: 'orbit', onChange: setShot });

// Any drag or wheel on the view takes it over from the held shot.
for (const ev of ['pointerdown', 'wheel']) vp.canvas.addEventListener(ev, () => letGo(), { capture: true });
