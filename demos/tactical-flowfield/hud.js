// hud.js — Tactical Flow Field's controls and readouts.

import { $ } from "/lib/kit/dom.js";
import { fpsMeter, segmented } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";
import { field } from "/app/field.js";
import { tactics } from "/app/tactics.js";
import { swarm, FORMATIONS, setFormation, setCount, slotError } from "/app/units.js";
import { show } from "/app/render.js";
import { lab, on, TOOLS, setTool, loadScenario } from "/app/lab.js";

const put = (id, v) => { $('#' + id).textContent = String(v); };
const TOOL_LABELS = { goal: 'Goal', wall: 'Wall', rough: 'Mud', erase: 'Erase', threat: 'Threat' };

export function wireHud() {
    const tools = segmented('#tools', TOOLS.map((t) => [t, TOOL_LABELS[t]]), { value: lab.tool, onChange: setTool });
    const formations = segmented('#formations', FORMATIONS, { value: swarm.formation, onChange: setFormation });
    tools.buttons.forEach((b) => { b.dataset.tool = b.dataset.value; });
    formations.buttons.forEach((b) => { b.dataset.formation = b.dataset.value; });

    bindControl('#unit-count-slider', { out: '#unit-count-val', fmt: (v) => v.toFixed(0), onChange: setCount });
    bindControl('#brush-size-slider', { out: '#brush-size-val', fmt: (v) => v.toFixed(1) + ' cells', onChange: (v) => { lab.brush = v; } });
    setCount(+$('#unit-count-slider').value);

    const overlay = (id, key) => bindControl(id, { onChange: (v) => { show[key] = v; } });
    overlay('#toggle-flow', 'flow');
    overlay('#toggle-integration', 'integration');
    overlay('#toggle-influence', 'influence');
    bindControl('#toggle-choke', { onChange: (v) => { show.chokes = v; show.cover = v; } });
    overlay('#toggle-leader', 'leader');

    $('#btn-scenario-choke').addEventListener('click', () => loadScenario('choke'));
    $('#btn-scenario-river').addEventListener('click', () => loadScenario('river'));
    $('#btn-clear-all').addEventListener('click', () => loadScenario('clear'));

    const fps = fpsMeter();
    on('tick', () => { put('stat-fps', fps.fps.toFixed(0)); readout(); });
    on('wave', readout);
    on('scenario', readout);
    (function count() { fps.tick(); requestAnimationFrame(count); })();
    readout();
    $('#status').textContent = 'ready';
}

function readout() {
    put('stat-wave-ms', field.lastWaveMs.toFixed(2) + ' ms');
    put('stat-reached', field.reached);
    put('stat-units', swarm.n);
    put('stat-slot', slotError().toFixed(1) + ' cells');
    const L = lab.leader;
    put('stat-astar-wp', L ? L.points.length + (L.partial ? ' (partial)' : '') : 'none');
    put('stat-astar-len', L ? L.length.toFixed(1) + ' cells' : '—');
    put('stat-astar-ms', L ? L.ms.toFixed(3) + ' ms' : '—');
    put('stat-choke-count', tactics.chokes.length);
    put('stat-cover', tactics.coverCells);
    put('stat-threats', tactics.threats.length);
    $('#status').textContent = `${lab.scenario} · ${lab.tool} tool · ${swarm.formation}`;
}
