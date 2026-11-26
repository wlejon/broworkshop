// Wrecking Lab — boots the lab (lab.js, importable by tests) and wires the toolbar.
import { boot } from "/lib/kit/app.js";
import { fpsMeter } from "/lib/kit/ui.js";
import { lab, startLab, rebuild, onTick } from "/app/lab.js";

boot();
startLab(document.getElementById('stage'));

const $ = (id) => document.getElementById(id);
for (const name of ['tower', 'block', 'wall']) $('build-' + name).addEventListener('click', () => rebuild(name));
$('reset').addEventListener('click', () => rebuild());
$('slow').addEventListener('change', (e) => { lab.slow = e.target.checked; });

const fps = fpsMeter();
lab.vp.onFrame(() => fps.tick());
onTick(() => {
    const s = lab.structure.counts, w = lab.world.counts;
    $('stat-standing').textContent = s.standing + ' / ' + s.cells;
    $('stat-pieces').textContent = s.pieces;
    $('stat-bodies').textContent = w.bodies;
    $('stat-step').textContent = lab.stepMs.toFixed(2);
    $('stat-fps').textContent = fps.fps ? fps.fps.toFixed(0) : '—';
});
