// grove entry: the panel. The scene and the plants are grove.js, which tests
// and the capture tool import.
import { boot, segmented, stats } from "/lib/kit/index.js";
import { sky, grove, draw, WINDS, setWind, SHOTS, setShot } from "/app/grove.js";

const app = boot();

const labels = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o[k].label]));
segmented('#winds', labels(WINDS), { value: grove.wind, onChange: setWind });
segmented('#shots', labels(SHOTS), { value: grove.shot, onChange: setShot });
segmented('#tod', Object.fromEntries(sky.order.map((k) => [k, sky.presets[k].label])),
    { value: sky.current, onChange: (k) => sky.apply(k) });
segmented('#paths', { gpu: 'GPU nodes', mesh: 'Meshes' }, { value: grove.path, onChange: (p) => { draw(p); show(); } });

const readouts = stats('#stats', { plants: 'plants', parts: 'drawn' });
function show() {
    const s = grove.stats;
    readouts.set({
        plants: grove.world.plantCount,
        parts: Object.entries(s).map(([k, v]) => v.toLocaleString() + ' ' + k).join(', '),
    });
}
show();
app.status.ok((grove.grow.cached ? 'read grown in ' : 'grown in ') + (grove.growMs / 1000).toFixed(1) + ' s');
