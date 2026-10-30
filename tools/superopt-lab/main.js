// Superopt Lab: bro's program provers, one question per tab. Each tab shows
// the engine's answer beside what the page checked by running the code
// itself: Prove (equivalence and round trips), Fuzz (path inputs and hazard
// witnesses) and Superoptimize (CEGIS search and proven rewrites).

import { boot, $, statusLine, stats, tabs } from "/lib/kit/index.js";
import { createProveTab } from "./prove.js";
import { createFuzzTab } from "./fuzz.js";
import { createSuperoptTab } from "./superopt.js";

boot();

const status = statusLine('#status');
const statBar = stats('#stats', { verdict: 'answer', size: 'size', checks: 'page checks passed' });

const panes = {};
let active = 'prove';
let pending = false;

const app = {
  // A tab's result: status-bar stats and the status line.
  report(values, text, kind) {
    statBar.set(values);
    if (kind === 'ok') status.ok(text); else status.warn(text);
  },
  fail(msg) { status.error(msg); },
  active: () => active,
  // Draw the active tab once, after layout settles this frame.
  redraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; panes[active] && panes[active].draw(); });
  },
};

panes.prove = createProveTab(app);
panes.fuzz = createFuzzTab(app);
panes.superopt = createSuperoptTab(app);

const defaults = { prove: 'absBug', fuzz: 'gate', superopt: 'sign' };

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
  prove: panes.prove.state,
  fuzz: panes.fuzz.state,
  superopt: panes.superopt.state,
};

globalThis.__superoptLab = { state, tabBar, panes };
