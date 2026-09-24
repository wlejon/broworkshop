// The live app: toolbar toggles carve and report, lift calls, spawn/clear,
// send-to buttons with the plan explained, click-to-send through the camera,
// overlay toggles, the roster.
//
//   scripts/validate.sh demos/nav-carving
import { check, test, done, text, q, clickOn, setValue, shot, frames, simUntil } from "/lib/kit/test.js";
import { TARGETS } from "/app/level.js";
import { navState, generation } from "/app/nav.js";
import { lift } from "/app/elevator.js";
import { agentState } from "/app/agents.js";
import { lab, doors, view, pickLevel } from "/app/lab.js";

frames(30);

test('boots with a squad headed for the mezzanine by lift', () => {
    check(text('#status') === 'ready', text('#status'));
    check(+text('#stat-agents') === 5 && q('#roster').children.length === 5, 'roster of 5');
    check(/Mezzanine: walk \+ lift/.test(text('#planHint')), text('#planHint'));
    check(text('#stat-carves') === 'gate, barricade', text('#stat-carves'));
    check(text('#btn-toggle-gate') === 'Gate: closed' && q('#btn-toggle-gate').classList.contains('active'), 'gate button');
    check(+text('#stat-samples') > 1000, 'overlay samples ' + text('#stat-samples'));
});
shot('boot');

test('the barricade button carves and restores', () => {
    const gen = generation();
    clickOn('#btn-toggle-barricade');
    check(!doors.barricade.open && !navState.handles.barricade && generation() > gen, 'removed');
    check(text('#btn-toggle-barricade') === 'Barricade: off', text('#btn-toggle-barricade'));
    frames(20);
    check(text('#stat-carves') === 'gate' && +text('#stat-gen') === generation(), 'surface readout');
    clickOn('#btn-toggle-barricade');
    check(navState.handles.barricade > 0, 'back');
});

test('send-to buttons plan and explain', () => {
    clickOn('#btn-target-vault');
    check(agentState.agents.every((r) => r.blocked), 'vault is blocked');
    check(/unreachable/.test(text('#planHint')) && q('#planHint').classList.contains('err'), text('#planHint'));
    frames(20);
    clickOn('#btn-toggle-gate');
    check(doors.gate.open && text('#btn-toggle-gate') === 'Gate: open', 'gate opening');
    frames(90);
    check(!navState.handles.gate, 'released once clear');
    frames(30);
    check(agentState.agents.every((r) => !r.blocked), 'squad re-planned through the gate');
    check(!/BLOCKED/.test(text('#roster')), text('#roster'));
});

test('lift call buttons queue floors', () => {
    clickOn('#btn-elev-2');
    check(lift.queue.includes(2) || lift.floor === 2, 'F2 requested');
    check(simUntil(() => lift.floor === 2, 8000), 'car reached F2');
    frames(20);
    check(/^F2/.test(text('#stat-elev-floor')), text('#stat-elev-floor'));
});

test('spawn and clear', () => {
    clickOn('#btn-spawn-1');
    clickOn('#btn-spawn-5');
    frames(20);
    check(agentState.agents.length === 11 && +text('#stat-agents') === 11, text('#stat-agents'));
    clickOn('#btn-clear-agents');
    frames(20);
    check(agentState.agents.length === 0 && q('#roster').children.length === 0, 'cleared');
    clickOn('#btn-spawn-5');
});

test('click the level to send everyone there', () => {
    const r = lab.vp.canvas.getBoundingClientRect();
    const t = TARGETS.roof;
    const s = lab.vp.toScreen([t.x, t.y, t.z]);
    const p = pickLevel(s.x, s.y);
    check(p && Math.abs(p.y - 7) < 0.4, 'the roof is under its own projection: ' + JSON.stringify(p));
    click(r.left + s.x, r.top + s.y, 0);
    frames(2);
    const goal = agentState.agents[0].goal;
    check(Math.hypot(goal.x - p.x, goal.z - p.z) < 1e-3, 'first agent goes where clicked');
    check(/walk \+ lift/.test(text('#planHint')), text('#planHint'));
});

test('overlay toggles hide and show', () => {
    setValue('#toggle-nav-nodes', false);
    setValue('#toggle-path-lines', false);
    setValue('#toggle-link-arcs', false);
    check(!view.overlay && !view.paths && !view.links, 'all off');
    setValue('#toggle-nav-nodes', true);
    setValue('#toggle-path-lines', true);
    setValue('#toggle-link-arcs', true);
    check(view.overlay && view.paths && view.links, 'all on');
});

frames(240);
shot('routes');
done('nav-carving ui');
