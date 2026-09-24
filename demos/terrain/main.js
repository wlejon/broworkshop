// Terrain entry: the settings panel, the HUD and the sculpt input. The world,
// camera and sculpting live in lab.js (tests import it, never this file).
import { boot, params, stats, fpsMeter, foldPanels, segmented } from "/lib/kit/index.js";
import { sunControls } from "/lib/kit/sky.js";
import { crosshair } from "/lib/crosshair.js";
import { canvas, config, terrain, fly, sun, HOME, sculpt, sculptAtCenter, toggleSculptMode,
         reconfigure, regen, onFrame } from "/app/lab.js";
import { MESH_MODES, MATERIALS, DEFAULT_COLORS, PRESETS, presetValues } from "/app/config.js";

const app = boot();
crosshair.configure({ style: 'circle', size: 6, thickness: 1, color: '#ffffff', opacity: 0.7, outline: false });
crosshair.show();

// --- terrain parameters: every change debounces one configure() ---------------------

const f2 = (v) => v.toFixed(2);
const panels = [];
const section = (id, spec) => panels.push(params('#' + id, config, spec, {
    onChange: (k, v) => { if (k === 'meshMode') config.meshMode = +v; reconfigure(); },
}));
section('noise', {
    frequency:  { min: 0.005, max: 0.15, step: 0.001, fmt: (v) => v.toFixed(3) },
    octaves:    { min: 1, max: 10, step: 1 },
    gain:       { min: 0.1, max: 1.0, step: 0.01, fmt: f2 },
    lacunarity: { min: 1.0, max: 4.0, step: 0.05, fmt: f2 },
    seed:       { min: 0, max: 9999, step: 1 },
});
section('mesh', {
    meshMode:    { label: 'mode', options: MESH_MODES },
    terraceStep: { min: 0.25, max: 6.0, step: 0.25, label: 'terrace step', fmt: f2 },
});
section('shape', {
    baseHeight:      { min: 1, max: 128, step: 1, label: 'base height' },
    heightAmplitude: { min: 1, max: 128, step: 1, label: 'amplitude' },
    seaLevel:        { min: 0, max: 128, step: 1, label: 'sea level' },
    cellSize:        { min: 0.25, max: 4.0, step: 0.25, label: 'cell size', fmt: f2 },
});
section('chunks', {
    chunkSizeX:        { min: 8, max: 128, step: 8, label: 'chunk X' },
    chunkSizeY:        { min: 8, max: 260, step: 8, label: 'chunk Y' },
    chunkSizeZ:        { min: 8, max: 128, step: 8, label: 'chunk Z' },
    loadRadius:        { min: 1, max: 10, step: 1, label: 'load radius' },
    unloadRadius:      { min: 2, max: 14, step: 1, label: 'unload radius' },
    maxLoadsPerUpdate: { min: 1, max: 8, step: 1, label: 'loads / update' },
});
section('palette', Object.fromEntries(MATERIALS.map((m, i) => [m, { type: 'color', label: (i + 1) + ': ' + m }])));
const refresh = () => { for (const p of panels) p.refresh(); };

document.getElementById('randomSeed').addEventListener('click', () => {
    config.seed = Math.floor(Math.random() * 10000);
    refresh();
    reconfigure();
});
document.getElementById('resetColors').addEventListener('click', () => {
    Object.assign(config, DEFAULT_COLORS);
    refresh();
    reconfigure();
});
segmented('#presets', Object.fromEntries(Object.keys(PRESETS).map((k) => [k, PRESETS[k].label])), {
    value: null,
    onChange: (name) => { Object.assign(config, presetValues(name)); refresh(); reconfigure(); },
});

// --- camera + sun ---------------------------------------------------------------

params('#camera', fly.opts, {
    speed:     { min: 2, max: 80, step: 1, label: 'move speed' },
    lookSpeed: { min: 0.0005, max: 0.010, step: 0.0005, label: 'sensitivity', fmt: (v) => v.toFixed(4) },
    fov:       { min: 30, max: 120, step: 1 },
    far:       { min: 100, max: 2000, step: 50, label: 'view distance' },
});
document.getElementById('resetPos').addEventListener('click', () => fly.pose(HOME));
sunControls('#sun', sun, { elevation: 60, heading: 218, intensity: 3.5 });
foldPanels('#panel');

// --- input ------------------------------------------------------------------------

const sculptModes = segmented('#sculpt', { raise: 'Raise', lower: 'Lower' }, {
    value: sculpt.mode, onChange: (m) => { sculpt.mode = m; },
});
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) sculptAtCenter(); });
document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Tab') {
        e.preventDefault();
        const panel = document.getElementById('panel');
        panel.hidden = !panel.hidden;
    }
    if (e.key === '[' || e.key === ']') sculptModes.value = toggleSculptMode();
});

// --- HUD ------------------------------------------------------------------------------

regen.onStart = () => {
    app.status.busy('regenerating…');
    setTimeout(() => app.status.ok('ready'), 400);
};
app.status.ok('ready');
const hud = stats('#stats', { pos: 'pos', fps: 'fps', chunks: 'chunks', tris: 'tris', seed: 'seed' });
const fps = fpsMeter();
let n = 0;
onFrame(() => {
    fps.tick();
    if (++n % 6) return;
    const p = fly.cam.pos;
    hud.set({ pos: p.map((v) => v.toFixed(1)).join(', '), fps: fps.fps.toFixed(0),
              chunks: terrain.chunkCount, tris: terrain.triangleCount.toLocaleString(), seed: config.seed });
});
