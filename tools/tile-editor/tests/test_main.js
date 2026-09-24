// Tile Editor: real clicks pick cells through the kit screen ray, every tool
// edits the map, strokes undo as one step, and a project round-trips.
import { check, eq, near, test, done, frames, q, text, clickOn, setValue, press, shot } from "/lib/kit/test.js";
import { worldToScreen } from "/lib/kit/viewport3d.js";
import { editor } from "/app/app.js";
import { GROUND_IDS, OVERLAY_IDS } from "/app/atlas.js";
import { BLOCK_BIT, LAYER } from "/app/map.js";

const { map, tools, brush, vp } = editor;
const world = map.world;

frames(10);
shot('demo-map');

/** Viewport pixel over the centre of cell (x, y). */
function cellPoint(x, y) {
    const c = world.cellCenterWorldXZ(x, y);
    const top = world.sampleHeight(c.x, c.z) || 0;
    const r = vp.canvas.getBoundingClientRect();
    const view = Camera.orbitViewOpts(vp.cam, vp.canvas);
    const s = worldToScreen([c.x, top, c.z], view, r.width, r.height);
    return { x: r.left + s.x, y: r.top + s.y };
}
function clickCell(x, y) {
    const p = cellPoint(x, y);
    click(p.x, p.y, 0);
    frames(2);
}
function dragCells(cells) {
    const pts = cells.map(([x, y]) => cellPoint(x, y));
    mouseDown(pts[0].x, pts[0].y, 0);
    for (const p of pts.slice(1)) mouseMove(p.x, p.y);
    mouseUp(pts[pts.length - 1].x, pts[pts.length - 1].y, 0);
    frames(2);
}
const at = (x, y) => ({ x, y });

test('boots with the demo map, the ground tool and every tool button', () => {
    eq(map.config.width, 48);
    eq(map.tileAt(15, 15, LAYER.ground), GROUND_IDS.stone, 'mesa is stone');
    eq(world.getElevation(15, 15), 3, 'mesa is raised');
    eq(map.tileAt(20, 24, LAYER.overlay), OVERLAY_IDS.road, 'road overlay');
    check(world.hasFlag(5, 31, BLOCK_BIT), 'river blocks');
    eq(tools.name, 'ground');
    eq(document.querySelectorAll('#toolbar [data-tool]').length, 7);
    check(!q('[data-section=ground]').hidden && q('[data-section=pathfind]').hidden, 'only the ground panel shows');
    check(world.triangleCount > 0, 'world meshed');
});

test('a real click picks the cell under the cursor (kit screen ray)', () => {
    const p = cellPoint(40, 40);
    const hit = editor.cellAt({ clientX: p.x, clientY: p.y });
    check(hit, 'hit the map');
    eq([hit.x, hit.y], [40, 40]);
});

test('clicking paints ground and one click is one undo step', () => {
    clickOn('#ground-swatches button[data-id="' + GROUND_IDS.sand + '"]');
    eq(brush.ground, GROUND_IDS.sand);
    const before = map.history.size();
    clickCell(40, 40);
    eq(map.tileAt(40, 40, LAYER.ground), GROUND_IDS.sand, 'painted sand');
    eq(map.history.size(), before + 1, 'one history entry');
    clickOn('#undo');
    eq(map.tileAt(40, 40, LAYER.ground), GROUND_IDS.grass, 'undo restores grass');
    clickOn('#redo');
    eq(map.tileAt(40, 40, LAYER.ground), GROUND_IDS.sand, 'redo');
});

test('a drag is one stroke; brush size paints a disc', () => {
    const before = map.history.size();
    dragCells([[40, 44], [41, 44], [42, 44], [43, 44]]);
    for (let x = 40; x <= 43; x++) eq(map.tileAt(x, 44, LAYER.ground), GROUND_IDS.sand, 'cell ' + x);
    eq(map.history.size(), before + 1, 'the whole drag is one entry');
    setValue('#brush-radius', 1);
    eq(brush.radius, 1);
    clickCell(45, 40);
    eq(map.tileAt(46, 40, LAYER.ground), GROUND_IDS.sand, 'radius 1 reaches the neighbour');
    eq(map.tileAt(46, 41, LAYER.ground), GROUND_IDS.grass, 'but not the diagonal');
    setValue('#brush-radius', 0);
});

test('stone blocks pathfinding; the flags brush overrides it', () => {
    clickOn('#ground-swatches button[data-id="' + GROUND_IDS.stone + '"]');
    clickCell(28, 40);
    check(world.hasFlag(28, 40, BLOCK_BIT), 'stone blocks');
    clickOn('[data-tool=flags]');
    check(!q('[data-section=flags]').hidden, 'flags panel shows');
    clickOn('#flag-value button[data-value="0"]');
    clickCell(28, 40);
    check(!world.hasFlag(28, 40, BLOCK_BIT), 'unblocked');
    eq(map.tileAt(28, 40, LAYER.ground), GROUND_IDS.stone, 'still stone');
});

test('elevation raises and lowers', () => {
    clickOn('[data-tool=elevation]');
    const e0 = world.getElevation(42, 40);
    clickCell(42, 40);
    eq(world.getElevation(42, 40), e0 + 1, 'raised');
    clickOn('#elev-dir button[data-value="-1"]');
    clickCell(42, 40);
    eq(world.getElevation(42, 40), e0, 'lowered back');
    clickOn('#elev-dir button[data-value="1"]');
});

test('tint paints and reads back through getTint', () => {
    clickOn('[data-tool=tint]');
    setValue(q('#tint-params input[type=color]'), '#00ff00');
    clickCell(38, 40);
    const t = world.getTint(38, 40);
    near(t.r, 0, 0.01); near(t.g, 1, 0.01);
});

test('overlay: rect fill, flood fill and eyedropper', () => {
    tools.set('overlay');
    const t = tools.tool;
    t.down(at(36, 36), { shiftKey: true });
    t.move(at(38, 38));
    t.up();
    for (const [x, y] of [[36, 36], [37, 37], [38, 38], [36, 38]]) eq(map.tileAt(x, y, LAYER.overlay), OVERLAY_IDS.road, 'rect ' + x + ',' + y);
    clickOn('#overlay-swatches button[data-id="' + OVERLAY_IDS.crop + '"]');
    t.down(at(37, 37), { ctrlKey: true });
    eq(map.tileAt(36, 36, LAYER.overlay), OVERLAY_IDS.crop, 'flood reached the corner');
    eq(map.tileAt(35, 36, LAYER.overlay), 0, 'flood stayed in the region');
    clickOn('#overlay-swatches button[data-id="' + OVERLAY_IDS.road + '"]');
    t.down(at(37, 37), { altKey: true });
    eq(brush.overlay, OVERLAY_IDS.crop, 'eyedropper picked crop');
    check(q('#overlay-swatches button[data-id="' + OVERLAY_IDS.crop + '"]').classList.contains('active'), 'swatch follows');
});

test('Escape cancels a stroke in progress and restores its cells', () => {
    tools.set('ground');
    const t = tools.tool;
    brush.ground = GROUND_IDS.water;
    t.down(at(30, 44), {});
    t.move(at(31, 44));
    check(tools.busy(), 'stroke running');
    press('Escape');
    check(!tools.busy(), 'cancelled');
    eq(map.tileAt(30, 44, LAYER.ground), GROUND_IDS.grass);
    eq(map.tileAt(31, 44, LAYER.ground), GROUND_IDS.grass);
});

test('props place, undo and clear', () => {
    clickOn('[data-tool=object]');
    clickOn('#prop-kinds button[data-value="rock"]');
    clickCell(44, 36);
    clickCell(45, 36);
    eq(map.props.length, 2);
    eq(map.props[0].kind, 'rock');
    clickOn('#undo');
    eq(map.props.length, 1, 'undo removed one');
    clickOn('#clear-props');
    eq(map.props.length, 0);
    clickOn('#undo');
    eq(map.props.length, 1, 'clear is undoable');
});

test('pathfind finds a route and marks it', () => {
    clickOn('[data-tool=pathfind]');
    clickCell(24, 40);          // south of the river: the route has to take the bridge
    check(/start set/.test(text('#path-info')), 'start set');
    clickCell(40, 20);
    check(/waypoints/.test(text('#path-info')), 'path found: ' + text('#path-info'));
    check(map.markerCount > 1, 'markers drawn');
    clickOn('#clear-path');
    eq(map.markerCount, 0);
});

test('project data round-trips grid, tints and props', () => {
    const data = JSON.parse(JSON.stringify(map.serialize()));
    const sand = map.tileAt(40, 40, LAYER.ground);
    map.newMap({ width: 20, height: 12 });
    eq(map.config.width, 20);
    eq(map.props.length, 0);
    map.deserialize(data);
    eq(map.config.width, 48);
    eq(map.tileAt(40, 40, LAYER.ground), sand);
    near(world.getTint(38, 40).g, 1, 0.01, 'tint survived');
    eq(map.props.length, 1, 'props survived');
});

test('New map uses the form: hex topology', () => {
    const inputs = q('#map-params').querySelectorAll('input');
    setValue(inputs[0], 24);
    setValue(inputs[1], 16);
    clickOn('#topology button[data-value="hex"]');
    clickOn('#new-map');
    const c = map.config;
    eq([c.width, c.height, c.topology], [24, 16, 'hex']);
    eq(map.history.size(), 0, 'new map clears history');
    tools.set('ground');
    brush.ground = GROUND_IDS.dirt;
    clickCell(10, 8);
    eq(map.tileAt(10, 8, LAYER.ground), GROUND_IDS.dirt, 'hex picking works');
});

shot('main');
done();
