// flora-lab entry: the panel. The scene, worker and layers are lab.js, which
// tests import.
import { boot, h, stats, segmented, toggleButton, bindControl } from "/lib/kit/index.js";
import { sky, view, control, setLayer, triangles, onUpdate } from "/app/lab.js";
import { LAYERS } from "/app/layers.js";
import { OVERLAYS } from "/app/diagnostics.js";

const app = boot();

toggleButton('#play', { on: true, labels: ['Play', 'Pause'], onChange: (on) => control.play(on) });
document.getElementById('step').addEventListener('click', control.step);
document.getElementById('seed').addEventListener('click', control.seed);
document.getElementById('reset').addEventListener('click', control.reset);
bindControl('#timeScale', { out: '#timeScaleV', fmt: (v) => v.toFixed(1) + '×', onChange: control.timeScale });
bindControl('#temp', { out: '#tempV', fmt: (v) => v.toFixed(1) + ' °C', onChange: control.temperature });

segmented('#tod', Object.fromEntries(sky.order.map((k) => [k, sky.presets[k].label])),
    { value: sky.current, onChange: (k) => sky.apply(k) });

// One checkbox per layer / overlay, with its colour as a swatch.
const css = (c) => 'rgba(' + [0, 1, 2].map((i) => Math.round(c[i] * 255)).join(',') + ',' + (c[3] ?? 1) + ')';
const boxes = {};
const defs = Object.assign({}, LAYERS, OVERLAYS);
for (const key of Object.keys(defs)) {
    const d = defs[key];
    boxes[key] = h('input', { type: 'checkbox', checked: d.on, dataset: { layer: key } });
    boxes[key].addEventListener('change', () => {
        for (const k of setLayer(key, boxes[key].checked)) boxes[k].checked = defs[k].on;
    });
    document.getElementById('layers').appendChild(h('label.k-field', null,
        boxes[key], h('span.swatch', { style: { background: css(d.color) } }), h('span', null, d.label)));
}

const readouts = stats('#stats', { simTime: 'sim time', plants: 'plants', modules: 'modules', flowering: 'flowering', tris: 'tri / frame' });
onUpdate(() => {
    const s = view.stats;
    readouts.set({ simTime: s.simTime.toFixed(2), plants: s.plantCount, modules: s.moduleCount,
                   flowering: s.flowering, tris: triangles().toLocaleString() });
});
app.status.ok('growing');
