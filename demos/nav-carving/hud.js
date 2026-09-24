// hud.js — NavMesh Carving's controls and readouts.

import { $, h, clear } from "/lib/kit/dom.js";
import { fpsMeter, toggleButton } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";
import { TARGETS, SPAWN, FLOOR_NAMES, floorOf } from "/app/level.js";
import { navState, generation } from "/app/nav.js";
import { linksOf } from "/app/plan.js";
import { lift, callLift, liftLabel } from "/app/elevator.js";
import { agentState, spawnAgent, spawnSquad, clearAgents, sendAll } from "/app/agents.js";
import { lab, doors, view, on, toggle, setView } from "/app/lab.js";

const put = (id, v) => { $('#' + id).textContent = String(v); };
const LABELS = {
    gate: ['Gate: open', 'Gate: closed'],
    barricade: ['Barricade: off', 'Barricade: on'],
    bridge: ['Bridge: retracted', 'Bridge: out'],
};

export function wireHud() {
    // The gate's button reads "closed" when the obstacle is in (on = blocking).
    const buttons = {};
    for (const name of ['gate', 'barricade', 'bridge']) {
        const blocking = () => (name === 'gate' ? !doors.gate.open : doors[name].open);
        buttons[name] = toggleButton('#btn-toggle-' + name, { on: blocking(), labels: LABELS[name], onChange: () => toggle(name) });
        buttons[name].sync = () => { buttons[name].on = blocking(); };
    }
    on('doors', () => { for (const k in buttons) buttons[k].sync(); });
    for (const f of [0, 1, 2]) $('#btn-elev-' + f).addEventListener('click', () => callLift(f));

    $('#btn-spawn-1').addEventListener('click', () => spawnAgent(SPAWN));
    $('#btn-spawn-5').addEventListener('click', () => spawnSquad(5, SPAWN));
    $('#btn-clear-agents').addEventListener('click', clearAgents);
    const targets = $('#targets');
    for (const key in TARGETS) {
        targets.appendChild(h('button.small', { id: 'btn-target-' + key, onclick: () => send(TARGETS[key], TARGETS[key].label) }, TARGETS[key].label));
    }
    on('pick', (p) => describe(p, `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`));

    bindControl('#toggle-nav-nodes', { onChange: (v) => setView('overlay', v) });
    bindControl('#toggle-path-lines', { onChange: (v) => setView('paths', v) });
    bindControl('#toggle-link-arcs', { onChange: (v) => setView('links', v) });

    const fps = fpsMeter();
    lab.vp.onFrame(() => fps.tick());
    on('tick', () => { put('stat-fps', fps.fps.toFixed(0)); readout(); });
    on('surface', readout);
    readout();
    describe(TARGETS.mezz, TARGETS.mezz.label);   // where the boot squad is headed
    $('#status').textContent = 'ready';
}

function send(goal, label) {
    sendAll(goal);
    describe(goal, label);
}

/** Say how the squad's first route gets there (the plan is the interesting part). */
function describe(goal, label) {
    const rec = agentState.agents[0];
    const el = $('#planHint');
    if (!rec) { el.className = 'hint'; el.textContent = 'No agents: spawn some first.'; return; }
    const links = linksOf(rec.plan);
    if (rec.plan.partial) {
        el.className = 'hint err';
        el.textContent = `${label} is unreachable right now: agents walk to the closest reachable point and wait. They re-plan the moment the surface changes.`;
    } else {
        el.className = 'hint ok';
        el.textContent = `${label}: ${links.length ? 'walk + ' + links.join(' + ') : 'walking all the way'} (${rec.plan.cost.toFixed(1)} s planned).`;
    }
}

function readout() {
    const agents = agentState.agents, t = agentState.traversals;
    put('stat-agents', agents.length);
    put('stat-traversals', t.ladder + t.jump + t.lift);
    put('stat-ladder', t.ladder); put('stat-jump', t.jump); put('stat-lift', t.lift);
    put('stat-elev-floor', liftLabel());
    put('stat-elev-queue', lift.queue.length ? lift.queue.map((f) => 'F' + f).join(' ') : '—');
    put('stat-gen', generation());
    put('stat-carves', Object.keys(navState.handles).filter((k) => navState.handles[k]).join(', ') || 'none');
    put('stat-tiles', navState.tilesRebuilt);
    put('stat-samples', view.walkableSamples);
    put('stat-repaths', agentState.repaths);
    const roster = $('#roster');
    clear(roster);
    for (const rec of agents) {
        roster.appendChild(h('div', null,
            h('i.sw', { style: { background: rec.color } }),
            h('span.name', null, '#' + rec.id),
            h('span', { class: 'state' + (rec.blocked ? ' blocked' : '') }, rec.blocked && rec.state === 'IDLE' ? 'BLOCKED' : rec.state),
            h('span.floor', null, FLOOR_NAMES[floorOf(rec.y)])));
    }
}
