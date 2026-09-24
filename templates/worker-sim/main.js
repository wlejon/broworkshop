// Worker Sim — the worker-thread skeleton. Copy the folder, rename, replace
// sim/physics.js with your own simulation.
//
// The page never simulates: sim/worker.js steps the world on its own timer
// and streams frames as transferred Float32Arrays (sim/protocol.js). The page
// keeps only the newest frame, draws it on the next animation frame, and
// hands the buffer back. Commands (mode, count, pause, step, mouse) go
// through lib/kit/worker-rpc.js.
import { boot, ids, readout, fpsMeter, toggleButton, segmented, frameLoop, bindControl, fmtBytes } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { MODES, FORCES } from "/app/sim/protocol.js";
import { drawFrame } from "/app/sim/draw.js";

const app = boot({ menu: { view: [{ id: 'view.reset', label: 'Reset Simulation' }],
                           handlers: { 'view.reset': () => rpc.post({ type: 'reset' }) } } });
const el = ids('view', 'count', 'speed', 'pause', 'step', 'reset');
const ctx = el.view.getContext('2d');
const fps = fpsMeter();
const threads = readout('#threads', {
    fps: 'page fps', drawMs: 'draw', tps: 'worker ticks/s', stepMs: 'step',
    entities: 'entities', frames: 'frames drawn', dropped: 'frames skipped',
    tick: 'worker tick', transfer: 'handed over',
});

const state = { mode: 'boids', frames: 0, dropped: 0, bytes: 0, bytesSince: performance.now() };
let pending = null;                       // newest frame not yet drawn

// ---- the worker --------------------------------------------------------------

const rpc = workerClient('sim/worker.js', { type: 'module' });

rpc.on('frame', (msg) => {
    if (pending) { recycle(pending); state.dropped++; }      // superseded before it was drawn
    pending = msg;
    state.bytes += msg.buffer.byteLength;
    threads.set({ tps: msg.tps, stepMs: msg.stepMs.toFixed(1) + ' ms', entities: msg.count.toLocaleString(), tick: msg.tick });
});

function recycle(msg) {
    rpc.post({ type: 'recycle', buffer: msg.buffer }, [msg.buffer]);
}

function viewSize() {
    const w = Math.max(1, el.view.clientWidth | 0), h = Math.max(1, el.view.clientHeight | 0);
    if (el.view.width !== w || el.view.height !== h) {
        el.view.width = w; el.view.height = h;
        return true;
    }
    return false;
}

viewSize();
rpc.request({ type: 'init', width: el.view.width, height: el.view.height,
              count: +el.count.value, mode: state.mode })
    .then((r) => app.status.ok('running · ' + r.count.toLocaleString() + ' entities on the worker'))
    .catch((e) => app.status.error(e));

// ---- drawing -----------------------------------------------------------------

frameLoop(() => {
    if (viewSize()) rpc.post({ type: 'resize', width: el.view.width, height: el.view.height });
    const f = fps.tick();
    if (!pending) return;
    const msg = pending;
    pending = null;
    const t0 = performance.now();
    drawFrame(ctx, el.view.width, el.view.height, new Float32Array(msg.buffer), msg.count, state.mode);
    recycle(msg);
    state.frames++;
    const now = performance.now();
    threads.set({ fps: f.toFixed(0), drawMs: (now - t0).toFixed(1) + ' ms', frames: state.frames, dropped: state.dropped });
    if (now - state.bytesSince >= 500) {
        threads.set('transfer', fmtBytes(state.bytes * 1000 / (now - state.bytesSince)) + '/s, 0 copies');
        state.bytes = 0;
        state.bytesSince = now;
    }
});

// ---- controls ----------------------------------------------------------------

/** Send a config change; errors land in the status line. */
const configure = (fields) => rpc.request(Object.assign({ type: 'config' }, fields)).catch((e) => app.status.error(e));

segmented('#mode', MODES, { value: state.mode, onChange: (m) => {
    state.mode = m;
    configure({ mode: m });
} });
// The readout follows the drag; the worker re-seeds once, on release.
const count = bindControl(el.count, { out: '#countVal', fmt: (v) => v / 1000 + 'k' });
el.count.addEventListener('change', () => configure({ count: count.value }));
bindControl(el.speed, { out: '#speedVal', fmt: (v) => v.toFixed(1) + '×', reset: 1,
    onChange: (v) => rpc.post({ type: 'config', speed: v }) });       // high rate while dragging: no reply

// The status changes on the worker's reply, so "paused" means it has stopped.
toggleButton(el.pause, { labels: ['Pause', 'Resume'], onChange: (paused) => {
    el.step.disabled = !paused;
    rpc.request({ type: paused ? 'pause' : 'resume' })
        .then((r) => app.status.set(paused ? 'paused at tick ' + r.tick + ' · Step advances one tick' : 'running'))
        .catch((e) => app.status.error(e));
} });
el.step.addEventListener('click', () => {
    rpc.request({ type: 'step' })
        .then((r) => app.status.set('paused · tick ' + r.tick + ' took ' + r.stepMs + ' ms'))
        .catch((e) => app.status.error(e));
});
el.reset.addEventListener('click', () => rpc.post({ type: 'reset' }));

// ---- mouse: drag applies a force at the pointer -------------------------------

let force = -1;                            // FORCES value while a button is down
function sendMouse(e) {
    const r = el.view.getBoundingClientRect();
    rpc.post({ type: 'mouse', x: e.clientX - r.left, y: e.clientY - r.top, active: force >= 0, force: Math.max(0, force) });
}
el.view.addEventListener('mousedown', (e) => {
    force = e.shiftKey || e.button === 1 ? FORCES.vortex : e.button === 2 ? FORCES.repel : FORCES.attract;
    sendMouse(e);
});
el.view.addEventListener('mousemove', (e) => { if (force >= 0) sendMouse(e); });
window.addEventListener('mouseup', (e) => { if (force >= 0) { force = -1; sendMouse(e); } });
el.view.addEventListener('contextmenu', (e) => e.preventDefault());
