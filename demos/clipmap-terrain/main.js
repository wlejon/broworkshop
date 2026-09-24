// Clipmap Terrain entry: the panel and the HUD. The world, camera and surface
// settings live in lab.js (tests import it, never this file).
import { boot, params, stats, fpsMeter, foldPanels, segmented } from "/lib/kit/index.js";
import { sunControls } from "/lib/kit/sky.js";
import { canvas, clipmap, sun, fly, surface, applySurface, VIEWS, setView, onFrame } from "/app/lab.js";

const app = boot();
const m = (v) => v.toFixed(0) + ' m';

segmented('#views', Object.fromEntries(Object.keys(VIEWS).map((k) => [k, VIEWS[k].label])), {
    value: 'home', onChange: setView,
});
params('#flight', fly.opts, {
    speed: { min: 20, max: 1000, step: 20, label: 'flight speed', fmt: (v) => v + ' m/s' },
});
params('#surface', surface, {
    snowLine:         { min: 200, max: 3000, step: 50, label: 'snow line', fmt: m },
    detailRelief:     { min: 0, max: 1.5, step: 0.05, label: 'detail relief', fmt: (v) => v.toFixed(2) },
    detailWavelength: { min: 2, max: 100, step: 2, label: 'detail wavelength', fmt: m },
    forestStrength:   { min: 0, max: 1, step: 0.05, label: 'forest', fmt: (v) => v.toFixed(2) },
}, { onChange: applySurface });
sunControls('#sun', sun, { elevation: 40, heading: 135, intensity: 3.2 });
foldPanels('#panel');

// --- panel + tip ------------------------------------------------------------------

const panel = document.getElementById('panel');
const togglePanel = () => { panel.hidden = !panel.hidden; };
document.getElementById('togglePanel').addEventListener('click', togglePanel);
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) return;
    e.preventDefault();
    togglePanel();
});
const tip = document.getElementById('tip');
document.addEventListener('pointerlockchange', () => { tip.hidden = document.pointerLockElement === canvas; });

// --- HUD --------------------------------------------------------------------------

const info = stats('#info', { res: 'resolution / level', cell: 'finest cell', verts: 'vertices', elev: 'ground at camera' });
info.set({ res: clipmap.resolution + ' × ' + clipmap.resolution, cell: clipmap.cellSize.toFixed(1) + ' m' });
const hud = stats('#stats', { tris: 'tris', levels: 'levels', far: 'far', alt: 'altitude', fps: 'fps' });
const fps = fpsMeter();
let n = 0;
onFrame(() => {
    fps.tick();
    if (++n % 6) return;
    hud.set({
        tris: (clipmap.triangleCount / 1000).toFixed(1) + 'k', levels: clipmap.levels,
        far: (clipmap.farDistance / 1000).toFixed(1) + ' km', alt: m(fly.altitude) + ' AGL', fps: fps.fps.toFixed(0),
    });
    info.set({ verts: clipmap.vertexCount.toLocaleString(), elev: fly.groundHeight.toFixed(1) + ' m' });
});
app.status.ok('ready');
