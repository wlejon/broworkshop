// The field and the tactical read: the wave, its NavGrid mirror, the leader
// A*, chokes, LOS-shadowed threat and cover, danger routing.
//
//   scripts/validate.sh demos/tactical-flowfield
import { check, test, done, frames } from "/lib/kit/test.js";
import { COLS, ROWS, TERRAIN, DANGER, field, getCost, setCell, paint, setGoal, updateField, sampleFlow, distanceAt, reachable, leaderRoute } from "/app/field.js";
import { tactics, addThreat, clearThreats, threatAt, CHOKE_MAX } from "/app/tactics.js";
import { loadScenario, placeGoal, refresh, lab } from "/app/lab.js";

frames(10);

const mid = COLS / 2 | 0, cy = ROWS / 2;

test('the choke scenario: one wall, one gap, one choke region', () => {
    loadScenario('choke');
    check(getCost(mid, 5) === TERRAIN.WALL && getCost(mid, cy | 0) === TERRAIN.OPEN, 'wall with a gap');
    check(tactics.chokes.length === 1, 'chokes ' + tactics.chokes.length);
    const c = tactics.chokes[0];
    check(Math.abs(c.x - mid) < 3 && Math.abs(c.y - cy) < 3, `choke at ${c.x.toFixed(1)},${c.y.toFixed(1)}`);
    check(c.width >= 2 && c.width <= CHOKE_MAX, 'width ' + c.width);
});

test('the wave reaches every open cell and points through the gap', () => {
    check(!field.dirty && field.reached > 8000, 'reached ' + field.reached);
    check(distanceAt(field.goal.x, field.goal.y) === 0, 'goal is zero');
    // Far side of the wall, level with a wall section: the route runs via the gap.
    const d = distanceAt(20, 10);
    check(d > Math.hypot(field.goal.x - 20, field.goal.y - 10), 'detour costs more than the straight line');
    const f = sampleFlow(mid - 10, 10, { x: 0, y: 0 });
    check(f.y > 0.3 && f.x > 0, `north of the gap flows south-east (${f.x.toFixed(2)},${f.y.toFixed(2)})`);
    check(sampleFlow(mid - 10, ROWS - 10, { x: 0, y: 0 }).y < -0.3, 'south of the gap flows north');
    check(!reachable(mid + 0.5, 5.5), 'a wall cell is unreachable');
    check(field.lastWaveMs > 0, 'wave timed');
});

test('terrain edits mirror into the NavGrid and re-run the wave', () => {
    const v = field.version, waves = lab.waves;
    const x = 40, y = 20;
    setCell(x, y, TERRAIN.WALL);
    check(!field.grid.isWalkable(x + 0.5, y + 0.5), 'NavGrid cell blocked');
    check(field.version > v && field.dirty, 'version bumped, wave dirty');
    refresh();
    check(!field.dirty && lab.waves === waves + 1, 'wave re-ran once');
    check(!reachable(x + 0.5, y + 0.5), 'no longer reached');
    setCell(x, y, TERRAIN.OPEN);
    check(field.grid.isWalkable(x + 0.5, y + 0.5), 'NavGrid cell open again');
    const n = paint(30, 50, 2, TERRAIN.ROUGH);
    check(n > 8 && getCost(30, 50) === TERRAIN.ROUGH, 'painted mud ' + n);
    check(paint(30, 50, 2, TERRAIN.ROUGH) === 0, 'painting the same again changes nothing');
    check(paint(0.5, 0.5, 3, TERRAIN.OPEN) === 0 || getCost(0, 0) === TERRAIN.WALL, 'border is not paintable');
    check(getCost(0, 0) === TERRAIN.WALL, 'border stays');
    loadScenario('choke');
});

test('mud costs more than open ground', () => {
    loadScenario('clear');
    placeGoal(100, cy);
    const open = distanceAt(20, cy);
    paint(60, cy, 4, TERRAIN.ROUGH);
    refresh();
    const muddy = distanceAt(20, cy);
    check(muddy > open, `mud detour ${open.toFixed(1)} -> ${muddy.toFixed(1)}`);
    check(muddy < open + 4 * 2 * TERRAIN.ROUGH, 'but routes around rather than straight through');
});

test('the leader line is a NavGrid A* route to the goal', () => {
    loadScenario('choke');
    const r = leaderRoute({ x: 12, y: 10 });
    check(r && r.points.length >= 2 && !r.partial, 'route found');
    const last = r.points[r.points.length - 1];
    check(Math.hypot(last.x - field.goal.x, last.y - field.goal.y) < 1.5, 'ends at the goal');
    // Waypoints are string-pulled, so check where the route crosses the wall's x.
    const seg = r.points.findIndex((p, i) => i > 0 && r.points[i - 1].x <= mid && p.x >= mid);
    const a = r.points[seg - 1], b = r.points[seg], yAt = a.y + ((mid - a.x) / (b.x - a.x || 1)) * (b.y - a.y);
    check(seg > 0 && getCost(mid, Math.floor(yAt)) === TERRAIN.OPEN,'crosses the wall through the gap at y ' + yAt.toFixed(1));
    check(r.length > Math.hypot(field.goal.x - 12, field.goal.y - 10), 'longer than the straight line');
    check(lab.leader && lab.leader.points.length >= 2, 'lab keeps a leader route');
    // Fully walled off: partial or none.
    for (let y = 1; y < ROWS - 1; y++) setCell(mid, y, TERRAIN.WALL);
    const blocked = leaderRoute({ x: 12, y: 10 });
    check(!blocked || blocked.partial, 'walled off is partial');
    refresh();
    check(!reachable(12, 10) && field.reached < 5000, 'wave stops at the wall');
    loadScenario('choke');
});

test('threat is line-of-sight gated: walls cast shadows, and shadows are cover', () => {
    loadScenario('clear');
    for (let y = 20; y <= 50; y++) setCell(60, y, TERRAIN.WALL);
    addThreat(70, 35, 16, 1.5);
    refresh();
    check(threatAt(70, 35) > 1.2, 'hot at the source');
    check(threatAt(66, 35) > 0.2, 'hot in view');
    check(threatAt(58.5, 35.5) === 0, 'shadowed behind the wall');
    check(threatAt(90, 35) === 0, 'nothing past the radius');
    check(tactics.cover[35 * COLS + 59] === 1, 'the cell behind the wall is cover');
    check(tactics.cover[35 * COLS + 61] === 0, 'the cell facing the threat is not');
    check(tactics.coverCells > 10, 'cover cells ' + tactics.coverCells);
    clearThreats();
    check(tactics.coverCells === 0 && threatAt(70, 35) === 0, 'cleared');
});

test('danger reprices the wave: routes bend around a threat', () => {
    loadScenario('clear');
    placeGoal(110, cy);
    const calm = distanceAt(15, cy);
    addThreat(64, cy, 12, 1.5);
    refresh();
    const tense = distanceAt(15, cy);
    check(tense > calm + 2, `threat costs ${calm.toFixed(1)} -> ${tense.toFixed(1)}`);
    check(tense < calm + DANGER * 1.5 * 12, 'but the wave goes around, not through');
    const f = sampleFlow(52, cy + 0.5, { x: 0, y: 0 });
    check(Math.abs(f.y) > 0.2, `flow steers off the centre line (${f.x.toFixed(2)},${f.y.toFixed(2)})`);
    loadScenario('choke');
});

test('the river scenario: two bridges, two chokes', () => {
    loadScenario('river');
    check(tactics.chokes.length === 2, 'chokes ' + tactics.chokes.length);
    const ys = tactics.chokes.map((c) => c.y).sort((a, b) => a - b);
    check(Math.abs(ys[0] - ROWS * 0.3) < 4 && Math.abs(ys[1] - ROWS * 0.7) < 4, 'at the bridges ' + ys.map((v) => v.toFixed(1)));
    check(reachable(12, ROWS / 2), 'the start reaches the goal');
    loadScenario('choke');
});

test('a goal on a wall still yields a field (nothing reached, nothing crashes)', () => {
    setGoal(mid + 0.5, 5.5);
    check(updateField() === true && field.reached === 0, 'reached ' + field.reached);
    check(sampleFlow(20, 20, { x: 0, y: 0 }).x === 0, 'no flow');
    loadScenario('choke');
    check(field.reached > 8000, 'restored');
});

done('tactical-flowfield field');
