// planet entry: the panel over the world (world.js, which the capture script
// imports too).
import { boot, segmented } from "/lib/kit/index.js";
import { vp, scene, SHOTS, setShot, letGo, setMode, onMode, MODE_HELP } from "/app/world.js";

boot();

const labels = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o[k].label]));
const shots = segmented('#shots', labels(SHOTS), { value: 'orbit', onChange: setShot });

// While the world prepares (scene.pendingWork: its processes, regions,
// plants, cloud bakes) a quiet badge over the view says what is still
// coming in; the other views open once the land's processes have run and
// the clouds' cover is baked (before, they would show a bare globe).
const preparing = document.getElementById('preparing');
const gate = (p) => p.some((s) => s.startsWith('land processes') || s.startsWith('clouds: cover'));
let opened = false, frames = 0;
const showPending = () => {
    const p = scene.pendingWork();
    preparing.hidden = p.length === 0;
    if (p.length) preparing.textContent = `Preparing: ${p[0]}${p.length > 1 ? ` (+${p.length - 1})` : ''}`;
    // (Before the first render the list is empty: it counts once it has
    // held something, or a second of frames has passed.)
    if (p.length || ++frames > 60) opened = opened || !gate(p);
    for (const b of shots.buttons) b.disabled = !opened && b.dataset.value !== 'orbit';
    requestAnimationFrame(showPending);
};
showPending();

// Walk, fly or orbit (F cycles them); the help line says the mode's keys.
// (The button gives the keys back to the view: Space would press it again.)
const mode = segmented('#mode', { walk: 'Walk', fly: 'Fly', orbit: 'Orbit' },
                       { value: 'orbit', onChange: (m) => { setMode(m); document.activeElement?.blur?.(); } });
onMode((m) => { mode.value = m; document.getElementById('help').textContent = MODE_HELP[m]; });

// Any drag or wheel on the view takes it over from the held shot.
for (const ev of ['pointerdown', 'wheel']) vp.canvas.addEventListener(ev, () => letGo(), { capture: true });
