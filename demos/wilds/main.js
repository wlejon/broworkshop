// wilds entry: the panel, the frame readout and the windowed bench. The
// world, its routes and the flight are world.js, which bench.js and the
// tests import.
import { boot, segmented, stats } from "/lib/kit/index.js";
import { vp, sky, world, flight, fly, land, ROUTES, SPEEDS, WINDS, setWind, setTier, forestStats, KM } from "/app/world.js";

const app = boot();

const labels = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o[k].label]));
const routes = segmented('#routes', labels(ROUTES), { value: flight.route, onChange: (k) => fly(k, 0) });
segmented('#speeds', SPEEDS, { value: String(flight.speed), onChange: (k) => { flight.speed = +k; } });
segmented('#winds', labels(WINDS), { value: world.wind, onChange: setWind });
segmented('#tod', Object.fromEntries(sky.order.map((k) => [k, sky.presets[k].label])),
    { value: sky.current, onChange: (k) => sky.apply(k) });
segmented('#tiers', { auto: 'By size', leaves: 'Leaves', clumps: 'Clumps', crowns: 'Crowns' },
    { value: 'auto', onChange: setTier });

// Any drag or wheel on the view takes it over from the flight.
for (const ev of ['pointerdown', 'wheel']) vp.canvas.addEventListener(ev, () => land(), { capture: true });

// --- the frame: real intervals between frames (vsync caps them at the display's rate)

const fpsEl = document.querySelector('#fps'), frameEl = document.querySelector('#frame');
const recent = [];          // [time ms, interval ms], the last two seconds
let last = performance.now(), shown = 0;
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
let recorder = null;        // the bench's, while it runs
requestAnimationFrame(function tick() {
    const now = performance.now(), dt = now - last;
    last = now;
    recent.push([now, dt]);
    while (recent.length && recent[0][0] < now - 2000) recent.shift();
    if (recorder) recorder.push(dt);
    if (now - shown > 250 && recent.length > 2) {
        shown = now;
        const ms = recent.map((r) => r[1]).sort((a, b) => a - b);
        const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
        fpsEl.textContent = (1000 / mean).toFixed(0) + ' fps';
        frameEl.textContent = `median ${pct(ms, 0.5).toFixed(2)} ms\n1% low ${(1000 / pct(ms, 0.99)).toFixed(0)} fps · ` +
                              `worst ${ms[ms.length - 1].toFixed(1)} ms`;
    }
    requestAnimationFrame(tick);
});

const readouts = stats('#stats', { trees: 'trees', tiers: 'leaves / clumps / crowns', verts: 'vertices', at: 'eye' });
vp.onFrame(() => {
    const s = forestStats();
    if (!s) return;
    readouts.set({
        trees: s.treeCount.toLocaleString(),
        tiers: `${s.trees.leaves} / ${s.trees.clumps} / ${s.trees.crowns}`,
        verts: (s.vertices / 1e6).toFixed(1) + ' M',
        at: flight.on ? `${flight.route} ${flight.t.toFixed(0)} s` : 'orbit',
    });
});

// --- the bench: every route for 15 s at the chosen speed, its frame times ---------

const out = document.querySelector('#bench-out');
document.querySelector('#bench').addEventListener('click', async () => {
    const rows = ['route            fps  1%low  worst'];
    out.textContent = rows.join('\n');
    for (const key of Object.keys(ROUTES)) {
        fly(key, 0);
        routes.value = key;
        await new Promise((r) => setTimeout(r, 2000));        // settle: tiles, tiers, uploads
        recorder = [];
        await new Promise((r) => setTimeout(r, 15000));
        const ms = recorder.sort((a, b) => a - b);
        recorder = null;
        const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
        rows.push(`${key.padEnd(14)} ${(1000 / mean).toFixed(0).padStart(5)} ${(1000 / pct(ms, 0.99)).toFixed(0).padStart(6)} ` +
                  `${ms[ms.length - 1].toFixed(1).padStart(6)} ms`);
        out.textContent = rows.join('\n');
        console.log('wilds bench ' + rows[rows.length - 1]);
    }
});

app.status.ok(`${KM} km, ${world.stats.trees.toLocaleString()} trees; booted in ${(world.bootMs.total / 1000).toFixed(1)} s`);
