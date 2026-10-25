// planet entry: the panel over the world (world.js, which the capture script
// imports too).
import { boot, segmented } from "/lib/kit/index.js";
import { vp, SHOTS, setShot, letGo, setMode, onMode, MODE_HELP } from "/app/world.js";

boot();

const labels = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o[k].label]));
segmented('#shots', labels(SHOTS), { value: 'orbit', onChange: setShot });

// Walk, fly or orbit (F cycles them); the help line says the mode's keys.
// (The button gives the keys back to the view: Space would press it again.)
const mode = segmented('#mode', { walk: 'Walk', fly: 'Fly', orbit: 'Orbit' },
                       { value: 'orbit', onChange: (m) => { setMode(m); document.activeElement?.blur?.(); } });
onMode((m) => { mode.value = m; document.getElementById('help').textContent = MODE_HELP[m]; });

// Any drag or wheel on the view takes it over from the held shot.
for (const ev of ['pointerdown', 'wheel']) vp.canvas.addEventListener(ev, () => letGo(), { capture: true });
