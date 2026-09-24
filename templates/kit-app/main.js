// Kit App — the lib/kit skeleton. Copy the folder, rename, replace the demo.
// For work that belongs off the page thread (a simulation, a model), start
// from templates/worker-sim instead: same layout, plus a worker-rpc worker.
import { boot, ids, logView, stats, fpsMeter, progressBar, tabs, toggleButton, frameLoop,
         params, bindControl } from "/lib/kit/index.js";

const app = boot({ menu: { view: [{ id: 'view.clear', label: 'Clear Log' }],
                           handlers: { 'view.clear': () => log.clear() } } });
const el = ids('view', 'run', 'pause', 'speed', 'shape');
const log = logView('#log');
const readouts = stats('#stats', { fps: 'fps', n: 'shapes' });
const fps = fpsMeter();
const progress = progressBar('#progress');
tabs('#tabs');

const state = { count: 24, size: 14, hue: 200, trails: false, speed: 1, shape: 'circle' };
params('#params', state, {
    count:  { min: 1, max: 200, step: 1, label: 'shapes' },
    size:   { min: 2, max: 40, step: 1 },
    hue:    { min: 0, max: 360, step: 1, fmt: (v) => v + '°' },
    trails: {},
}, { onChange: (k, v) => log.add(k + ' = ' + v) });
bindControl(el.speed, { out: '#speedVal', onChange: (v) => { state.speed = v; } });
bindControl(el.shape, { onChange: (v) => { state.shape = v; log.add('shape = ' + v); } });

const ctx = el.view.getContext('2d');
let t = 0;
const loop = frameLoop((dt) => {
    const w = el.view.width = el.view.clientWidth, hgt = el.view.height = el.view.clientHeight;
    t += dt * state.speed;
    if (!state.trails) ctx.clearRect(0, 0, w, hgt);
    for (let i = 0; i < state.count; i++) {
        const a = t + i * (Math.PI * 2 / state.count);
        const x = w / 2 + Math.cos(a) * w * 0.3, y = hgt / 2 + Math.sin(a * 2) * hgt * 0.3;
        ctx.fillStyle = 'hsl(' + ((state.hue + i * 5) % 360) + ', 70%, 60%)';
        if (state.shape === 'circle') { ctx.beginPath(); ctx.arc(x, y, state.size / 2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(x - state.size / 2, y - state.size / 2, state.size, state.size);
    }
    progress.set((t % 4) / 4);
    readouts.set({ fps: fps.tick().toFixed(0), n: state.count });
});
const pause = toggleButton(el.pause, { labels: ['Pause', 'Resume'],
    onChange: (on) => { if (on) loop.pause(); else loop.resume(); app.status.set(on ? 'paused' : 'running'); } });
el.run.addEventListener('click', () => { t = 0; pause.on = false; loop.resume(); app.status.ok('running'); log.add('restarted', 'ok'); });

app.status.ok('running');
log.add('booted');
