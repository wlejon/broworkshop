// AI Arena — the live app: boot, combat flowing into the HUD, the toolbar
// (pause, scenario, AI selectors, focus, fog, rewind) and click-to-focus.
//
//   scripts/validate.sh demos/ai-arena
import { check, test, done, simUntil, frames, q, text, setValue, clickOn, shot } from "/lib/kit/test.js";
import { lab } from "/app/lab.js";
import { decided } from "/app/sim/match.js";
import { projectToCanvas, UNIT_Y } from "/app/view/stage.js";

const damageDealt = () => lab.state.agents.some((a) => a.unit.hp < a.unit.maxHp);
const positions = () => lab.state.agents.map((a) => a.x.toFixed(3) + "," + a.z.toFixed(3)).join(" ");

frames(5);

test('boots the 8v8 match with its roster and focus', () => {
    check(lab.state.scenario.id === 'default_8v8', 'default scenario');
    check(q('#roster').children.length === 16, 'roster rows: ' + q('#roster').children.length);
    check(q('#sel-focus').options.length === 16, 'focus options');
    check(lab.state.byId[lab.state.focusId].unit.teamId === 1, 'default focus is a blue unit');
    // exit_net registers only when bro.ai.game.nn is in the build.
    const g = globalThis.bro && bro.ai && bro.ai.game;
    const hasNet = !!g && ['nn', 'learn'].every((k) => g[k] && g[k].available !== false);
    check(q('#sel-red-ai').options.length >= (hasNet ? 11 : 10), 'every registered agent is selectable');
});

test('combat reaches the log, roster, reward and observation panels', () => {
    check(simUntil(damageDealt, 20000), 'someone took damage');
    frames(30);
    check(q('#log').children.length > 1, 'damage log lines');
    check(/HP \d+/.test(text('#roster')), 'roster shows HP');
    check(!/^Red 0\.0 \/ Blue 0\.0$/.test(text('#reward-nums')), 'reward moved: ' + text('#reward-nums'));
    check(q('#mask-row').querySelectorAll('.mask-cell.on').length > 0, 'action mask painted');
    check(/running/.test(text('#status')), 'status: ' + text('#status'));
});
shot('combat');

test('pause freezes the units; resume moves them again', () => {
    clickOn('#btn-pause');
    check(lab.paused && q('#btn-pause').textContent === 'Resume', 'paused');
    const before = positions();
    frames(40);
    check(positions() === before, 'units held still while paused');
    check(/paused/.test(text('#status')), 'status says paused');
    clickOn('#btn-pause');
    check(!lab.paused, 'resumed');
    check(simUntil(() => positions() !== before, 3000), 'units move after resume');
});

test('rewind restores an earlier snapshot', () => {
    simUntil(() => lab.state.elapsed > 4, 10000);
    const before = positions();
    clickOn('#btn-rewind');
    check(/rewound to t=/.test(q('#log').lastElementChild.textContent), 'rewind logged');
    check(positions() !== before, 'world restored to an earlier layout');
});

test('AI selectors route each team', () => {
    setValue('#sel-blue-ai', 'tactical');
    check(lab.state.blueAi === 'tactical' && lab.state.redAi === 'scripted', 'blue switched');
    frames(30);
    check(/tactical/.test(text('#agent-stats')), 'tactical publishes stats: ' + text('#agent-stats'));
    setValue('#sel-blue-ai', 'scripted');
});

test('scenario select rebuilds the match and keeps the agents', () => {
    setValue('#sel-red-ai', 'random');
    setValue('#sel-scenario', 'duel_1v1');
    check(lab.state.scenario.id === 'duel_1v1', 'duel built');
    check(q('#roster').children.length === 2, 'duel roster');
    check(lab.state.redAi === 'random', 'red agent kept across the rebuild');
    check(simUntil(damageDealt, 30000), 'duel fights');
    setValue('#sel-red-ai', 'scripted');
    setValue('#sel-scenario', 'squad_3v3');
    check(q('#roster').children.length === 6, '3v3 roster');
});

test('clicking a unit focuses it', () => {
    clickOn('#btn-pause');                       // hold the units still to aim
    const s = lab.state;
    const red = s.agents.find((a) => a.unit.teamId === 0 && a.unit.alive);
    const node = lab.stage.unitNode(red.unit.id);
    const sp = projectToCanvas(node.x, UNIT_Y, node.z);
    const r = q('#arena').getBoundingClientRect();
    click(r.left + sp.x, r.top + sp.y);
    frames(2);
    check(s.focusId === red.unit.id, 'focus follows the click (' + s.focusId + ' vs ' + red.unit.id + ')');
    check(q('#sel-focus').value === String(red.unit.id), 'focus select synced');
    clickOn('#btn-pause');
});

test('fog hides unseen enemies and shows belief ghosts', () => {
    clickOn('#btn-fog');
    check(lab.fog.enabled && q('#btn-fog').classList.contains('active'), 'fog on');
    frames(20);
    const blue = lab.state.agents.filter((a) => a.unit.teamId === 1 && a.unit.alive);
    const hidden = blue.filter((a) => !lab.stage.unitNode(a.unit.id).visible);
    // Red's view: at least one blue unit is out of sight at the 3v3 spawn.
    check(hidden.length > 0, 'some enemy hidden from red (' + hidden.length + ')');
    clickOn('#btn-fog');
    frames(2);
    check(blue.every((a) => lab.stage.unitNode(a.unit.id).visible), 'fog off shows everyone');
    for (const a of blue) { const g = lab.stage.ghost(a.unit.id); check(!g || !g.visible, 'ghosts hidden'); }
});

test('reset starts a fresh match', () => {
    clickOn('#btn-reset');
    check(lab.state.elapsed === 0 && lab.state.agents.every((a) => a.unit.hp === a.unit.maxHp), 'fresh');
    check(decided(lab.state) === null, 'both teams standing');
});

done('ai-arena ui');
