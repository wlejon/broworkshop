// Solver Lab: bro's solvers and the proofs behind them, one question per tab.
// Each tab shows the engine's answer beside what the page checked on its
// own: Solve (bitvector SAT), Layout (constraint layout), Trajectory
// (symbolic autodiff + shooting) and Lockstep (verified capsules + rollback).

import { boot, $, statusLine, stats, tabs } from "/lib/kit/index.js";
import { createSolveTab } from "./solve.js";
import { createLayoutTab } from "./layout.js";
import { createTrajectoryTab } from "./trajectory.js";
import { createLockstepTab } from "./lockstep.js";

boot();

const status = statusLine('#status');
const statBar = stats('#stats', { verdict: 'answer', solved: 'size', checks: 'page checks passed' });

const panes = {};
let active = 'solve';
let pending = false;

const app = {
  // A tab's result: status-bar stats and the status line.
  report(values, text, kind) {
    statBar.set(values);
    if (kind === 'ok') status.ok(text); else status.warn(text);
  },
  reportChecks(text) { statBar.set('checks', text); },
  fail(msg) { status.error(msg); },
  active: () => active,
  // Draw the active tab once, after layout settles this frame.
  redraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; panes[active] && panes[active].draw(); });
  },
};

panes.solve = createSolveTab(app);
panes.layout = createLayoutTab(app);
panes.trajectory = createTrajectoryTab(app);
panes.lockstep = createLockstepTab(app);

const defaults = { solve: 'xorSum', layout: 'editor', trajectory: 'ripple', lockstep: 'arena' };

export const tabBar = tabs('#tabs', {
  onChange(name) {
    active = name;
    $('#tab-question').textContent = panes[name] ? panes[name].question : '';
    const p = panes[name];
    if (!p) return;
    if (!p.state.key) p.load(defaults[name]); else app.redraw();
  },
});
window.addEventListener('resize', () => app.redraw());

export const state = {
  get activeTab() { return active; },
  solve: panes.solve.state,
  layout: panes.layout.state,
  trajectory: panes.trajectory.state,
  lockstep: panes.lockstep.state,
};

globalThis.__solverLab = { state, tabBar, panes };
