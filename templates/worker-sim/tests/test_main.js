// Worker Sim — the simulation module on its own, then the page end to end:
// frames arrive from the worker, controls reach it, pause/step/reset work.
// Run: scripts/validate.sh templates/worker-sim
import { check, eq, near, test, done, waitFor, clickOn, setValue, text, q, shot } from "/lib/kit/test.js";
import { createSim } from "/app/sim/physics.js";
import { STRIDE, X, Y, VX, VY } from "/app/sim/protocol.js";

// ---- physics (no worker) -----------------------------------------------------

const speeds = (sim) => {
    const out = [];
    for (let i = 0; i < sim.count; i++) out.push(Math.hypot(sim.state[i * STRIDE + VX], sim.state[i * STRIDE + VY]));
    return out;
};

test('a seeded sim replays exactly', () => {
    const a = createSim({ width: 400, height: 300, count: 300, seed: 7 });
    const b = createSim({ width: 400, height: 300, count: 300, seed: 7 });
    for (let i = 0; i < 10; i++) { a.step(1 / 60); b.step(1 / 60); }
    eq(Array.from(a.state.slice(0, 12)), Array.from(b.state.slice(0, 12)));
});

test('boids keep their speed inside the clamp and wrap around the edges', () => {
    const sim = createSim({ width: 400, height: 300, count: 400, mode: 'boids', seed: 1 });
    for (let i = 0; i < 30; i++) sim.step(1 / 60);
    const v = speeds(sim);
    check(Math.min(...v) >= 49.9 && Math.max(...v) <= 160.1, 'speeds in [50, 160]: ' + Math.min(...v) + '..' + Math.max(...v));
    for (let i = 0; i < sim.count; i++) {
        const x = sim.state[i * STRIDE + X], y = sim.state[i * STRIDE + Y];
        check(x >= 0 && x < 400 && y >= 0 && y < 300, 'entity ' + i + ' inside the world');
    }
});

test('particles stay inside the walls and fall', () => {
    const sim = createSim({ width: 400, height: 300, count: 200, mode: 'particles', seed: 2 });
    const meanY = () => { let s = 0; for (let i = 0; i < sim.count; i++) s += sim.state[i * STRIDE + Y]; return s / sim.count; };
    const y0 = meanY();
    for (let i = 0; i < 120; i++) sim.step(1 / 60);
    for (let i = 0; i < sim.count; i++) {
        const x = sim.state[i * STRIDE + X], y = sim.state[i * STRIDE + Y];
        check(x >= 6 && x <= 394 && y >= 6 && y <= 294, 'particle ' + i + ' inside the walls');
    }
    check(meanY() > y0, 'gravity pulls the mean down: ' + y0.toFixed(1) + ' -> ' + meanY().toFixed(1));
});

test('the mouse attracts', () => {
    const sim = createSim({ width: 400, height: 400, count: 1, mode: 'gravity', seed: 3 });
    sim.state.set([100, 200, 0, 0, 1, 0]);
    Object.assign(sim.mouse, { x: 180, y: 200, active: true, force: 0 });
    sim.step(1 / 60);
    check(sim.state[VX] > 0, 'pulled toward +x: ' + sim.state[VX]);
});

test('setCount re-seeds at the new size', () => {
    const sim = createSim({ count: 100, seed: 4 });
    sim.setCount(250);
    eq(sim.state.length, 250 * STRIDE);
    sim.step(1 / 60);
});

// ---- the page + worker -------------------------------------------------------

const row = (label) => {
    for (const r of document.querySelectorAll('#threads > div')) {
        if (r.firstChild.textContent === label) return r.lastChild.textContent;
    }
    throw new Error('no readout row ' + label);
};
/** Let wall time pass (the worker runs on a real thread) while frames pump. */
const idle = (ms) => { const until = Date.now() + ms; waitFor(() => Date.now() > until, 'idle', ms + 2000); };
const drawn = () => +row('frames drawn');
const tick = () => +row('worker tick');

test('the worker boots and streams frames', () => {
    waitFor(() => /^running/.test(text('#status')), 'worker init', 15000);
    waitFor(() => drawn() >= 5, 'frames drawn', 15000);
    eq(row('entities'), '4,000');
    check(/copies/.test(row('handed over')), 'transfer rate shown');
});

test('mode buttons switch the worker', () => {
    clickOn('#mode [data-value=particles]');
    check(q('#mode [data-value=particles]').classList.contains('active'), 'particles active');
    const n = drawn();
    waitFor(() => drawn() > n + 3, 'frames keep coming', 20000);
    clickOn('#mode [data-value=boids]');
});

// Waits key on the worker's replies (shown in the status line), never on a
// frame count: under load its messages lag, and Step's frame is skipped
// whenever the page still holds every pooled buffer.
const statusTick = (re) => { const m = re.exec(text('#status')); return m ? +m[1] : null; };
const resumeIfPaused = () => {
    if (text('#pause') !== 'Resume') return;
    clickOn('#pause');
    waitFor(() => /^running/.test(text('#status')), 'resume acknowledged', 15000);
};

test('pause stops the stream; Step advances exactly one tick', () => {
    try {
        clickOn('#pause');
        eq(text('#pause'), 'Resume');
        check(!q('#step').disabled, 'step enabled while paused');
        waitFor(() => statusTick(/^paused at tick (\d+)/) != null, 'pause acknowledged', 15000);
        const at = statusTick(/^paused at tick (\d+)/);
        // Every frame the worker sent before stopping arrived ahead of the reply.
        const shown = tick();
        check(shown <= at, 'readout tick ' + shown + ' <= paused tick ' + at);
        idle(500);
        eq(tick(), shown, 'no frames while paused');
        clickOn('#step');
        waitFor(() => statusTick(/tick (\d+) took/) != null, 'step reply', 15000);
        eq(statusTick(/tick (\d+) took/), at + 1, 'the step is the only tick since the pause');
        resumeIfPaused();
        check(q('#step').disabled, 'step disabled again');
        const t = tick();
        waitFor(() => tick() > t, 'frames flow again', 15000);
    } finally {
        resumeIfPaused();
    }
});

test('the entity count reaches the worker', () => {
    resumeIfPaused();
    setValue('#count', 2000);
    eq(text('#countVal'), '2k');
    waitFor(() => row('entities') === '2,000', 'count applied', 20000);
    setValue('#count', 4000);
    waitFor(() => row('entities') === '4,000', 'count restored', 20000);
});

test('the speed slider shows its value', () => {
    setValue('#speed', 2);
    eq(text('#speedVal'), '2.0×');
    near(+q('#speed').value, 2, 1e-6);
});

shot('main');
done('worker-sim');
