// The live app: tools painted by real mouse input on the canvas, formation
// and scenario buttons, overlay toggles, sliders, readouts, screenshots.
//
//   scripts/validate.sh demos/tactical-flowfield
import { check, test, done, frames, text, q, clickOn, setValue, shot } from "/lib/kit/test.js";
import { COLS, ROWS, TERRAIN, field, getCost } from "/app/field.js";
import { tactics } from "/app/tactics.js";
import { swarm } from "/app/units.js";
import { show, toCanvas } from "/app/render.js";
import { lab, loadScenario } from "/app/lab.js";

frames(30);

/** Viewport coordinates of a world (cell-space) point on the stage canvas. */
function at(x, y) {
    const r = q('#stage').getBoundingClientRect(), p = toCanvas(x, y);
    return { x: r.left + p.x, y: r.top + p.y };
}
function clickWorld(x, y, button) { const p = at(x, y); click(p.x, p.y, button || 0); flush(); }
function dragWorld(points) {
    const p0 = at(points[0][0], points[0][1]);
    mouseMove(p0.x, p0.y); mouseDown(p0.x, p0.y, 0);
    for (const [x, y] of points.slice(1)) { const p = at(x, y); mouseMove(p.x, p.y); }
    const pn = at(...points[points.length - 1]);
    mouseUp(pn.x, pn.y, 0);
    flush();
}

test('boots into the choke scenario with live readouts', () => {
    check(lab.scenario === 'choke' && /^choke/.test(text('#status')), text('#status'));
    check(+text('#stat-units') === 1000 && text('#unit-count-val') === '1000', 'units');
    check(/ms$/.test(text('#stat-wave-ms')) && +text('#stat-reached') > 8000, text('#stat-reached'));
    check(+text('#stat-choke-count') === 1 && +text('#stat-threats') === 1, 'tactics readouts');
    check(+text('#stat-cover') > 0, 'cover ' + text('#stat-cover'));
    check(+text('#stat-astar-wp') >= 2 && /cells$/.test(text('#stat-astar-len')), text('#stat-astar-wp'));
    check(q('#tools').children.length === 5 && q('#formations').children.length === 4, 'segmented bars');
    check(q('[data-tool=goal]').classList.contains('active') && q('[data-formation=Box]').classList.contains('active'), 'defaults');
    check(+text('#stat-fps') >= 0, 'fps readout');
});
shot('boot');

test('goal tool: click places the goal, drag turns the formation', () => {
    clickWorld(100, 20);
    check(Math.abs(field.goal.x - 100) < 0.6 && Math.abs(field.goal.y - 20) < 0.6, `goal ${field.goal.x.toFixed(1)},${field.goal.y.toFixed(1)}`);
    check(!field.dirty, 'wave re-ran');
    dragWorld([[100, 20], [100, 26], [100, 32]]);
    check(Math.abs(swarm.facing - Math.PI / 2) < 0.2, 'facing south ' + swarm.facing.toFixed(2));
    clickWorld(90, 50, 2);
    check(Math.abs(field.goal.x - 90) < 0.6 && Math.abs(field.goal.y - 50) < 0.6, 'right-click moves the goal');
});

test('wall, mud and erase tools paint by dragging', () => {
    clickOn('[data-tool=wall]');
    check(lab.tool === 'wall' && q('[data-tool=wall]').classList.contains('active'), 'wall tool');
    const v = field.version;
    dragWorld([[20, 10], [20, 15], [20, 20]]);
    check(getCost(20, 15) === TERRAIN.WALL && field.version > v, 'painted wall');
    check(!field.grid.isWalkable(20.5, 15.5), 'NavGrid follows');
    clickOn('[data-tool=rough]');
    clickWorld(30, 60);
    check(getCost(30, 60) === TERRAIN.ROUGH, 'mud');
    clickOn('[data-tool=erase]');
    dragWorld([[20, 10], [20, 15], [20, 20]]);
    clickWorld(30, 60);
    check(getCost(20, 15) === TERRAIN.OPEN && getCost(30, 60) === TERRAIN.OPEN, 'erased');
    frames(20);
    check(/erase tool/.test(text('#status')), text('#status'));
});

test('brush slider sizes the brush', () => {
    setValue('#brush-size-slider', 5);
    check(lab.brush === 5 && text('#brush-size-val') === '5.0 cells', text('#brush-size-val'));
    clickOn('[data-tool=wall]');
    clickWorld(40, 40);
    check(getCost(44, 40) === TERRAIN.WALL && getCost(36, 40) === TERRAIN.WALL, 'wide brush');
    setValue('#brush-size-slider', 2.4);
});

test('threat tool drops a threat; erase removes it', () => {
    const n = tactics.threats.length;
    clickOn('[data-tool=threat]');
    clickWorld(100, 60);
    check(tactics.threats.length === n + 1, 'added');
    frames(20);
    check(+text('#stat-threats') === n + 1, text('#stat-threats'));
    clickOn('[data-tool=erase]');
    clickWorld(100, 60);
    check(tactics.threats.length === n, 'erased');
    clickOn('[data-tool=goal]');
});

test('formation buttons', () => {
    for (const f of ['Wedge', 'Circle', 'Flank', 'Box']) {
        clickOn(`[data-formation=${f}]`);
        check(swarm.formation === f && q(`[data-formation=${f}]`).classList.contains('active'), f);
    }
});

test('overlay toggles', () => {
    setValue('#toggle-integration', true);
    setValue('#toggle-influence', true);
    check(show.integration && show.influence, 'on');
    frames(40);
    shot('overlays');
    setValue('#toggle-flow', false);
    setValue('#toggle-choke', false);
    setValue('#toggle-leader', false);
    check(!show.flow && !show.chokes && !show.cover && !show.leader, 'off');
    frames(5);
    for (const [id, on] of [['#toggle-flow', true], ['#toggle-choke', true], ['#toggle-leader', true], ['#toggle-integration', false], ['#toggle-influence', false]]) setValue(id, on);
    check(show.flow && show.chokes && show.leader && !show.integration, 'restored');
});

test('unit slider', () => {
    setValue('#unit-count-slider', 2000);
    check(swarm.n === 2000 && text('#unit-count-val') === '2000', 'n ' + swarm.n);
    frames(20);
    check(+text('#stat-units') === 2000, text('#stat-units'));
    setValue('#unit-count-slider', 1000);
});

test('scenario buttons', () => {
    clickOn('#btn-scenario-river');
    check(lab.scenario === 'river' && tactics.chokes.length === 2 && tactics.threats.length === 0, 'river');
    frames(20);
    check(+text('#stat-choke-count') === 2, text('#stat-choke-count'));
    frames(240);
    shot('river');
    clickOn('#btn-clear-all');
    check(lab.scenario === 'clear' && tactics.chokes.length === 0, 'clear');
    let walls = 0;
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (getCost(x, y) !== TERRAIN.OPEN) walls++;
    check(walls === 0, 'open map');
    clickOn('#btn-scenario-choke');
    check(lab.scenario === 'choke' && tactics.chokes.length === 1, 'choke again');
    frames(600);
    shot('choke-arrived');
});

done('tactical-flowfield ui');
