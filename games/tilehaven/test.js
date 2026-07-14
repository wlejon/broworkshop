// test.js — scripted TileHaven session for bro-headless.
// Run: bro-headless games/tilehaven test.js
// Drives real click/drag road painting with edge-autotile junctions, bridge
// costs, building placement rules, depot connectivity (floodFill/components on
// every edit), cart hauling + reroute + stranding, production/consumption,
// population growth gating, bulldoze refunds, save/load round-trip, victory.

advanceTime(400);

// Arcade shell boots on title — Enter starts a run (Play is selected).
function pressKey(key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}
pressKey('Enter');
advanceTime(200);

const H = window.HAVEN;
assert(H, 'HAVEN debug surface exposed');
const { game, world } = H;
const T = H.TILE, F = H.FLAG, C = H.COSTS;
const D = game.depot;
const key = (x, y) => x + ',' + y;
const L_ROADS = 1, L_DECALS = 2;

function pump(ms) { for (let t = 0; t < ms; t += 100) advanceTime(100); }
function pumpUntil(desc, fn, maxMs) {
    for (let t = 0; t < (maxMs || 30000); t += 100) {
        if (fn()) return;
        advanceTime(100);
    }
    throw new Error('timeout waiting for ' + desc);
}

// Grant coins/wood so placement tests aren't blocked by economy (economy is
// asserted separately with deltas).
H.debug.addCoins(2000);
H.debug.addRes('wood', 300);

// BFS over paintable/painted cells — lays test roads through the terrain
// without hardcoding the seed's map.
function roadRoute(x0, y0, x1, y1) {
    const passable = (x, y) => game.roadAt(x, y) ||
        (world.getTile(x, y, 0) !== T.FOREST && world.getTile(x, y, 0) !== T.ORE &&
         !world.hasFlag(x, y, F.BLD) && x >= 0 && y >= 0 && x < H.MAP_W && y < H.MAP_H);
    const prev = new Map();
    const q = [[x0, y0]];
    prev.set(key(x0, y0), null);
    while (q.length) {
        const [x, y] = q.shift();
        if (x === x1 && y === y1) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= H.MAP_W || ny >= H.MAP_H) continue;
            if (prev.has(key(nx, ny)) || !passable(nx, ny)) continue;
            prev.set(key(nx, ny), [x, y]);
            q.push([nx, ny]);
        }
    }
    if (!prev.has(key(x1, y1))) return null;
    const out = [];
    let cur = [x1, y1];
    while (cur) { out.unshift({ x: cur[0], y: cur[1] }); cur = prev.get(key(cur[0], cur[1])); }
    return out;
}
function paintPath(cells) {
    for (const c of cells)
        if (!game.roadAt(c.x, c.y))
            assert(game.paintRoad(c.x, c.y), 'paintRoad at ' + c.x + ',' + c.y);
    world.rebuild();
}

// --- 1. Terrain generation -----------------------------------------------------

{
    assert(world.width === 28 && world.height === 20, 'map is 28x20');

    // The river crosses the whole map north to south, sits below grade, and
    // is animated water.
    for (let y = 0; y < 20; y++) {
        let n = 0;
        for (let x = 0; x < 28; x++) if (world.getTile(x, y, 0) === T.WATER) n++;
        assert(n >= 1, 'river crosses row ' + y);
    }
    for (const c of game.riverCells) {
        assert(world.getTile(c.x, c.y, 0) === T.WATER, 'river cell is water');
        assert(world.getElevation(c.x, c.y) === -1, 'river below grade');
    }
    // Bridgeable narrows: rows where the river is one cell wide.
    assert(game.narrows.length >= 1, 'narrows exist (' + game.narrows.length + ')');
    for (const n of game.narrows) {
        assert(world.getTile(n.x, n.y, 0) === T.WATER, 'narrow is water');
        assert(world.getTile(n.x - 1, n.y, 0) !== T.WATER &&
               world.getTile(n.x + 1, n.y, 0) !== T.WATER, 'narrow is 1 cell wide');
    }
    // Forest + ore hills.
    assert(game.forestCells.length >= 6, 'forest patches exist');
    assert(game.oreCells.length >= 4, 'ore hills exist');
    for (const c of game.oreCells)
        assert(world.getElevation(c.x, c.y) === 1, 'ore hill is elevated');
    // Depot seeded with its own road cell; exactly one road network.
    assert(world.getTile(D.x, D.y, L_ROADS) === T.ROAD, 'depot cell carries road');
    assert(world.hasFlag(D.x, D.y, F.ROAD), 'depot road flag');
    assert(game.netCount === 1, 'one road network at start');
    assert(world.components({ flag: F.ROAD }).length === 1, 'components agrees');
    assert(game.connectedRoads.has(key(D.x, D.y)), 'depot in its own network');
    screenshot('test-1-terrain.png');
}

// --- 2. Road painting via real click + drag; edge-autotile junctions -------------

{
    // Arm the road tool by clicking the real toolbar button.
    const r = document.getElementById('btn-road').getBoundingClientRect();
    click(r.x + r.width / 2, r.y + r.height / 2);
    advanceTime(48);
    assert(H.tool === 'road', 'road tool armed via toolbar click');

    // Drag-paint 4 cells east of the depot with real mouse events.
    const coins0 = game.coins;
    const cells = [];
    for (let x = D.x + 1; x <= D.x + 4; x++) cells.push({ x, y: D.y });
    for (const c of cells)
        assert(game.canPaintRoad(c.x, c.y).ok, 'paintable at ' + c.x + ',' + c.y);
    const p0 = H.projectCell(cells[0].x, cells[0].y);
    mouseDown(p0.x, p0.y);
    for (const c of cells) {
        const p = H.projectCell(c.x, c.y);
        mouseMove(p.x, p.y);
    }
    mouseUp(H.projectCell(cells[3].x, cells[3].y).x, H.projectCell(cells[3].x, cells[3].y).y);
    advanceTime(48);
    for (const c of cells) {
        assert(world.getTile(c.x, c.y, L_ROADS) === T.ROAD, 'road painted at ' + c.x + ',' + c.y);
        assert(world.hasFlag(c.x, c.y, F.ROAD), 'road flag at ' + c.x + ',' + c.y);
        assert(!world.hasFlag(c.x, c.y, F.OFFROAD), 'offroad cleared at ' + c.x + ',' + c.y);
        assert(game.connectedRoads.has(key(c.x, c.y)), 'cell joined depot network');
    }
    assert(game.coins === coins0 - 4 * C.road.coins, 'road cost deducted (4 cells)');
    assert(document.getElementById('hud-coins').textContent === String(game.coins),
        'HUD coins updated');
    H.setTool('road');   // disarm (toggle)

    // Build a crossroad at (D.x+2, D.y) and a T-junction at (D.x+4, D.y):
    //   cross: arms E,N,W,S (mask 15); T: arms N,W,S but no E (mask 14... E=1)
    game.paintRoad(D.x + 2, D.y - 1);
    game.paintRoad(D.x + 2, D.y + 1);
    game.paintRoad(D.x + 4, D.y - 1);
    game.paintRoad(D.x + 4, D.y + 1);
    world.rebuild();
    advanceTime(60);
    const crossMask = game.edgeMaskAt(D.x + 2, D.y);
    const tMask = game.edgeMaskAt(D.x + 4, D.y);
    assert(crossMask === 15, 'crossroad has all four arms (mask 15)');
    assert(tMask === (2 | 4 | 8), 'T-junction lacks the east arm (mask 14, got ' + tMask + ')');
    assert(crossMask !== tMask, 'junctions resolve to different autotile variants');

    // Verify the RENDER path actually drew different variants: just south-east
    // of each cell centre both cells are road; toward the open east edge the
    // T-junction's decal is alpha-cut and grass shows through, while the
    // crossroad's east arm is still road-grey.
    const gray = (p) => Math.abs(p.r - p.g) < 26 && Math.abs(p.g - p.b) < 30 && p.r > 45;
    const grassy = (p) => p.g > p.r + 12;
    const east = (x, y) => {
        const a = H.projectCell(x, y), b = H.projectCell(x + 1, y);
        return { x: a.x + (b.x - a.x) * 0.38, y: a.y + (b.y - a.y) * 0.38 };
    };
    mouseMove(5, 5);           // park the cursor: no hover tint on the samples
    advanceTime(48);
    const pc = east(D.x + 2, D.y), pt = east(D.x + 4, D.y);
    const pxCross = getPixel(Math.round(pc.x), Math.round(pc.y));
    const pxT = getPixel(Math.round(pt.x), Math.round(pt.y));
    assert(gray(pxCross), 'crossroad east arm renders road pixels (' + JSON.stringify(pxCross) + ')');
    assert(grassy(pxT), 'T-junction open east edge shows grass (' + JSON.stringify(pxT) + ')');
    screenshot('test-2-roads.png');
}

// --- 3. Bridges over the river --------------------------------------------------

{
    const n = game.narrows[0];
    const chk = game.canPaintRoad(n.x, n.y);
    assert(chk.ok && chk.bridge, 'narrow is bridgeable');
    assert(chk.cost.coins === C.bridge.coins, 'bridge costs ' + C.bridge.coins);
    const coins0 = game.coins, nets0 = game.netCount;
    assert(game.paintRoad(n.x, n.y), 'bridge painted');
    assert(game.coins === coins0 - C.bridge.coins, 'bridge price deducted');
    assert(world.getTile(n.x, n.y, L_ROADS) === T.BRIDGE, 'bridge tile on roads layer');
    // The isolated bridge is its own network — components() sees the split.
    assert(game.netCount === nets0 + 1, 'isolated bridge is a separate road network');
    assert(!game.connectedRoads.has(key(n.x, n.y)), 'bridge not depot-connected yet');

    // Roads refuse forest and ore terrain.
    const fc = game.forestCells[0], oc = game.oreCells[0];
    assert(game.canPaintRoad(fc.x, fc.y).reason === 'terrain', 'no roads through forest');
    assert(game.canPaintRoad(oc.x, oc.y).reason === 'terrain', 'no roads up ore cliffs');
    assert(!game.paintRoad(fc.x, fc.y) && game.lastRefusal.reason === 'terrain',
        'refusal recorded');
}

// --- 4. Building placement rules -------------------------------------------------

let house1, farm1, lumber1, mine1;
{
    // House beside the painted road, via a real projected click.
    const hx = D.x + 1, hy = D.y + 1;   // south of the road run
    assert(game.canPlace('house', hx, hy).ok, 'house spot valid');
    H.setTool('house');
    const p = H.projectCell(hx, hy);
    click(p.x, p.y);
    advanceTime(48);
    house1 = game.buildingAt(hx, hy);
    assert(house1 && house1.type === 'house', 'house placed by real click');
    assert(world.hasFlag(hx, hy, F.BLD), 'building flag set');
    assert(house1.connected, 'house is road-connected (adjacent to network)');
    H.setTool(null);

    // Farm on the other side of the road.
    const fx = D.x + 3, fy = D.y + 1;
    farm1 = game.placeBuilding('farm', fx, fy);
    assert(farm1, 'farm placed');
    assert(farm1.cropCells.length >= 1, 'farm sowed crop strips');
    for (const c of farm1.cropCells)
        assert(world.getTile(c.x, c.y, L_DECALS) === T.CROP, 'animated crop decal at ' +
            c.x + ',' + c.y);

    // Lumber camp: must touch forest.
    let lspot = null;
    outer:
    for (const fc of game.forestCells)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = fc.x + dx, y = fc.y + dy;
            if (game.canPlace('lumber', x, y).ok) { lspot = { x, y }; break outer; }
        }
    assert(lspot, 'found a lumber spot beside forest');
    lumber1 = game.placeBuilding('lumber', lspot.x, lspot.y);
    assert(lumber1, 'lumber camp placed beside forest');
    // Far from any forest: refused.
    let farSpot = null;
    for (let x = 0; x < 28 && !farSpot; x++)
        for (let y = 0; y < 20 && !farSpot; y++) {
            if (world.getTile(x, y, 0) !== T.GRASS || world.hasFlag(x, y, F.BLD) ||
                game.roadAt(x, y)) continue;
            const anyForest = world.cellsInRange(x, y, 1, 'vertex')
                .some(c => world.getTile(c.x, c.y, 0) === T.FOREST);
            if (!anyForest) farSpot = { x, y };
        }
    assert(game.canPlace('lumber', farSpot.x, farSpot.y).reason === 'forest',
        'lumber far from forest refused');

    // Mine: ON an ore hill only.
    const oc = game.oreCells.find(c => !world.hasFlag(c.x, c.y, F.BLD));
    mine1 = game.placeBuilding('mine', oc.x, oc.y);
    assert(mine1, 'mine placed on ore hill');
    assert(game.canPlace('mine', D.x + 1, D.y - 1).reason === 'ore',
        'mine on grass refused');

    // Other refusals.
    const wc = game.riverCells[0];
    assert(game.canPlace('house', wc.x, wc.y).reason === 'terrain', 'house on water refused');
    assert(game.canPlace('house', D.x + 2, D.y).reason === 'road', 'house on road refused');
    assert(game.canPlace('house', hx, hy).reason === 'occupied', 'occupied cell refused');
    const coinsAll = game.coins;
    H.debug.addCoins(-(game.coins));      // broke
    assert(game.canPlace('house', hx + 1, hy + 1).reason === 'coins', 'no coins refused');
    H.debug.addCoins(coinsAll);
    const woodAll = game.wood;
    H.debug.addRes('wood', -game.wood);
    assert(game.canPlace('house', hx + 1, hy + 1).reason === 'wood', 'no wood refused');
    H.debug.addRes('wood', woodAll);
    world.rebuild();
}

// --- 5. Depot connectivity: floodFill/components on every edit --------------------

{
    // The mine sits away from the network: warning state.
    assert(!mine1.connected, 'mine not yet connected');
    advanceTime(700);          // let the warning blink tint + marker appear
    assert(world.objectCount(game.kinds.warn) >= 1, 'warning marker shown');
    screenshot('test-3-warning.png');

    // Wire the mine in: route from the road end to a grass cell beside the mine.
    let gate = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = mine1.x + dx, y = mine1.y + dy;
        if (world.getTile(x, y, 0) === T.GRASS && !world.hasFlag(x, y, F.BLD)) gate = { x, y };
    }
    assert(gate, 'mine has a grass gate cell');
    const route = roadRoute(D.x + 2, D.y - 1, gate.x, gate.y);
    assert(route, 'road route to the mine exists');
    paintPath(route);
    assert(mine1.connected, 'mine connected after painting the road');
    assert(game.netCount >= 1, 'network count sane');

    // Cut every road cell touching the depot: EVERYTHING disconnects.
    const nets0 = game.netCount;
    const cuts = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = D.x + dx, y = D.y + dy;
        if (!game.roadAt(x, y)) continue;
        const r = game.bulldoze(x, y);
        assert(r.ok && r.what === 'road', 'road bulldozed at ' + x + ',' + y);
        cuts.push({ x, y });
    }
    assert(cuts.length >= 1, 'depot had road links to cut');
    assert(game.netCount > nets0 || cuts.length > 1,
        'components recomputed after cut (nets ' + nets0 + ' -> ' + game.netCount + ')');
    assert(game.connectedRoads.size === 1, 'only the depot pad remains connected');
    assert(!mine1.connected && !house1.connected && !farm1.connected,
        'cutting the depot links disconnects every building');
    // Reconnect: connectivity restores.
    for (const c of cuts) assert(game.paintRoad(c.x, c.y), 'road repainted');
    assert(mine1.connected && house1.connected && farm1.connected,
        'reconnecting restores every building');
    world.rebuild();
}

// --- 6. Carts haul goods; production is staffed + connected ---------------------

{
    // No population yet: industry is idle even when connected.
    farm1.stock = 0;
    pump(6000);
    assert(farm1.stock === 0 && !farm1.staffed, 'no workers -> no production');

    // Staff it: 4 residents cover farm + lumber.
    H.debug.setHousePop(house1, 4);
    assert(game.pop === 4, 'population 4');
    pump(200);
    assert(farm1.staffed, 'farm staffed once housed workers exist');

    const food0 = game.food, hauls0 = game.totalHauls;
    pumpUntil('farm cart dispatched', () => game.carts.length > 0, 20000);
    const cart = game.carts.find(c => c.fromId === farm1.id);
    assert(cart, 'cart came from the farm');
    assert(cart.goods && cart.goods.res === 'food' && cart.goods.n === 4, 'cart carries 4 food');
    assert(farm1.cartOut, 'farm marked cart-out');
    // It moves.
    const pA = game.cartPos(cart);
    advanceTime(600);
    const pB = game.cartPos(cart);
    assert(Math.hypot(pB.x - pA.x, pB.y - pA.y) > 0.5, 'cart is driving');
    assert(world.objectCount(game.kinds.cart) >= 1, 'cart instance rendered');
    // It delivers and returns.
    pumpUntil('food delivered', () => game.totalHauls > hauls0, 20000);
    assert(game.food >= food0 + 4 - 3, 'food banked (minus a little upkeep)');
    pumpUntil('cart returned home', () => !farm1.cartOut, 20000);

    // Mine hauls ore -> coins at the depot.
    H.debug.setHousePop(house1, 6);   // staff the mine too
    const coins0 = game.coins, ore0 = game.ore;
    H.debug.fillStock(mine1);
    pumpUntil('ore delivered', () => game.ore >= ore0 + 4, 30000);
    assert(game.coins >= coins0 + 4 * 5 - 2, 'ore sold for coins on delivery');
}

// --- 7. Production / consumption ticks --------------------------------------------

{
    // Disconnect production by emptying farms' staff: pop stays, but pause the
    // farm by cutting its stock source — simplest isolation: bulldoze nothing,
    // just watch upkeep outpace a single farm at high pop.
    const bigPop = 30;
    H.debug.setHousePop(house1, 6);
    // add a couple more houses to hold the population
    const h2 = game.placeBuilding('house', D.x + 1, D.y + 2);
    const h3 = game.placeBuilding('house', D.x + 3, D.y + 2);
    assert(h2 && h3, 'extra houses placed');
    H.debug.setHousePop(h2, 6);
    H.debug.setHousePop(h3, 6);
    assert(game.pop === 18, 'pop 18 housed');
    // Upkeep: ceil(18/10) = 2 food per 5s tick. Hold the farm's output by
    // draining its stock each step (an earlier cart may still be in flight —
    // wait it out first).
    const drain = () => { farm1.stock = 0; };
    pumpUntil('farm carts done', () => {
        drain();
        return !game.carts.some(c => c.fromId === farm1.id);
    }, 30000);
    const f0 = game.food;
    for (let t = 0; t < 10500; t += 100) { advanceTime(100); drain(); }
    assert(game.food <= f0 - 3, 'city consumed food over two upkeep ticks (' +
        f0 + ' -> ' + game.food + ')');
}

// --- 8. Population growth gated on food + market access ----------------------------

{
    let hSpot = null;
    for (let y = 0; y < 20 && !hSpot; y++)
        for (let x = 0; x < 28 && !hSpot; x++)
            if (game.canPlace('house', x, y).ok &&
                [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
                    game.connectedRoads.has(key(x + dx, y + dy))))
                hSpot = { x, y };
    assert(hSpot, 'found a connected house spot');
    const h = game.placeBuilding('house', hSpot.x, hSpot.y);
    assert(h && h.connected, 'growth test house connected');
    // Starve: no growth (hold the farm so it can't restock the city).
    const foodStash = game.food;
    H.debug.addRes('food', -game.food);
    for (let t = 0; t < 13000; t += 100) {
        advanceTime(100);
        farm1.stock = 0;
        H.debug.addRes('food', -game.food);   // any in-flight delivery is confiscated
    }
    assert(h.pop === 0, 'no food -> no growth');
    // Feed: grows.
    H.debug.addRes('food', foodStash + 30);
    const pop0 = game.pop;
    pumpUntil('house grew', () => h.pop > 0, 15000);
    assert(game.pop > pop0, 'population rose');
    // Disconnected house never grows: place one far from any road.
    let iso = null;
    for (let x = 27; x >= 0 && !iso; x--)
        for (let y = 19; y >= 0 && !iso; y--)
            if (game.canPlace('house', x, y).ok &&
                ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
                    game.connectedRoads.has(key(x + dx, y + dy))))
                iso = game.placeBuilding('house', x, y);
    assert(iso && !iso.connected, 'isolated house is disconnected');
    pump(13000);
    assert(iso.pop === 0, 'no market road -> no growth');
    const rIso = game.bulldoze(iso.x, iso.y);
    assert(rIso.ok, 'isolated house cleaned up');
}

// --- 9. Bulldoze refunds; carts reroute or strand when roads vanish ----------------

{
    // Refund.
    const c0 = game.coins;
    let hs = null;
    for (let y = 0; y < 20 && !hs; y++)
        for (let x = 0; x < 28 && !hs; x++)
            if (game.canPlace('house', x, y).ok) hs = { x, y };
    const h = game.placeBuilding('house', hs.x, hs.y);
    assert(h, 'refund test house placed');
    const afterBuy = game.coins;
    const r = game.bulldoze(h.x, h.y);
    assert(r.ok && r.what === 'building', 'house bulldozed');
    assert(r.refund === Math.floor(C.house.coins / 2), 'refund is 50% of coins');
    assert(game.coins === afterBuy + r.refund, 'refund banked (' + c0 + ')');
    assert(!world.hasFlag(h.x, h.y, F.BLD), 'building flag cleared');

    // Reroute: give the farm a second, longer route to the depot, then cut the
    // short one under a moving cart.
    const loop = [];
    for (let x = D.x; x <= D.x + 4; x++) loop.push({ x, y: D.y + 3 });
    for (let y = D.y; y <= D.y + 3; y++) { loop.push({ x: D.x, y }); loop.push({ x: D.x + 4, y }); }
    for (const c of loop)
        if (!game.roadAt(c.x, c.y) && game.canPaintRoad(c.x, c.y).ok) game.paintRoad(c.x, c.y);
    world.rebuild();
    assert(farm1.connected, 'farm still connected with loop roads');

    H.debug.fillStock(farm1);
    farm1.cartOut = false;
    pumpUntil('loop cart dispatched', () => game.carts.some(c => c.fromId === farm1.id), 15000);
    const cart = game.carts.find(c => c.fromId === farm1.id);
    advanceTime(400);   // roll onto the road
    const rerouted0 = game.stats.cartsRerouted;
    // Cut the trunk cell just east of the depot (ahead of the cart's short path).
    assert(game.bulldoze(D.x + 1, D.y).ok, 'trunk cut under the cart');
    pump(400);
    assert(game.stats.cartsRerouted > rerouted0, 'cart rerouted around the cut');
    assert(game.carts.includes(cart), 'cart survived the cut');
    pumpUntil('rerouted cart delivered', () => !farm1.cartOut, 30000);
    game.paintRoad(D.x + 1, D.y);   // restore the trunk

    // Strand: cart en route, then remove EVERY route -> goods refunded home.
    H.debug.fillStock(farm1);
    pumpUntil('strand cart dispatched', () => game.carts.some(c => c.fromId === farm1.id), 15000);
    const cart2 = game.carts.find(c => c.fromId === farm1.id);
    assert(cart2.goods.n === 4, 'strand cart loaded');
    advanceTime(400);
    const stranded0 = game.stats.cartsStranded;
    const stockBefore = farm1.stock;
    // Sever both routes: cut all four cells around the depot road hub.
    const cuts = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = D.x + dx, y = D.y + dy;
        if (game.roadAt(x, y)) { game.bulldoze(x, y); cuts.push({ x, y }); }
    }
    // Also cut the corner the loop turns through so no alternate remains.
    for (const cx of [{ x: D.x, y: D.y + 3 }, { x: D.x + 4, y: D.y + 3 }])
        if (game.roadAt(cx.x, cx.y)) { game.bulldoze(cx.x, cx.y); cuts.push(cx); }
    pump(600);
    assert(game.stats.cartsStranded > stranded0, 'cart stranded when no route remains');
    assert(!game.carts.includes(cart2), 'stranded cart despawned');
    assert(farm1.stock >= stockBefore + 4, 'stranded goods handed back to the farm');
    // Repair the trunk for the rest of the session.
    for (const cx of cuts) if (game.canPaintRoad(cx.x, cx.y).ok) game.paintRoad(cx.x, cx.y);
    world.rebuild();
    assert(farm1.connected && house1.connected, 'city rewired');
}

// --- 10. Victory: pop 50 + 500 coins, banner, sandbox continue ---------------------

{
    assert(!game.victory, 'not yet victorious');
    // Push the city over the goal line.
    const houses = game.buildings.filter(b => b.type === 'house');
    let need = H.GOAL.pop - game.pop;
    for (const h of houses) {
        if (need <= 0) break;
        const grow = Math.min(50, need);   // debug hook has no cap
        H.debug.setHousePop(h, h.pop + grow);
        need -= grow;
    }
    if (game.coins < H.GOAL.coins) H.debug.addCoins(H.GOAL.coins - game.coins);
    advanceTime(300);
    assert(game.victory, 'victory triggered at 50 pop + 500 coins');
    const banner = document.getElementById('banner');
    assert(banner.style.display !== 'none', 'victory banner shown');
    assert(document.getElementById('banner-text').textContent === 'TILEHAVEN THRIVES',
        'banner text');
    screenshot('test-5-victory.png');
    // Sandbox continue.
    const r = document.getElementById('btn-continue').getBoundingClientRect();
    click(r.x + r.width / 2, r.y + r.height / 2);
    advanceTime(48);
    assert(game.sandbox, 'sandbox continue engaged');
    assert(banner.style.display === 'none', 'banner dismissed');
    // The sim keeps running.
    const t0 = game.time;
    advanceTime(500);
    assert(game.time > t0, 'sim continues in sandbox');
}

// --- 11. A busy city: many carts on the roads (money shot) -------------------------

{
    // Build out a compact city so several producers stream carts at once.
    const spots = [];
    for (let y = D.y - 3; y <= D.y + 4; y++)
        for (let x = D.x - 3; x <= D.x + 7; x++) spots.push({ x, y });
    let farms = 1, lumbers = 1, houses = 0;
    for (const s of spots) {
        if (farms < 4 && game.canPlace('farm', s.x, s.y).ok &&
            [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
                game.connectedRoads.has(key(s.x + dx, s.y + dy)))) {
            if (game.placeBuilding('farm', s.x, s.y)) farms++;
        } else if (houses < 6 && game.canPlace('house', s.x, s.y).ok &&
            [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
                game.connectedRoads.has(key(s.x + dx, s.y + dy)))) {
            const h = game.placeBuilding('house', s.x, s.y);
            if (h) { houses++; H.debug.setHousePop(h, 6); }
        }
    }
    // A second lumber camp if terrain allows.
    for (const fc of game.forestCells) {
        if (farms >= 4 && houses >= 4) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = fc.x + dx, y = fc.y + dy;
            if (game.canPlace('lumber', x, y).ok &&
                [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ex, ey]) =>
                    game.connectedRoads.has(key(x + ex, y + ey)))) {
                if (game.placeBuilding('lumber', x, y)) lumbers++;
                break;
            }
        }
        break;
    }
    world.rebuild();
    assert(game.pop >= 20, 'city is populated (' + game.pop + ')');

    // Fill every producer and watch the fleet roll.
    let maxCarts = 0;
    for (const b of game.buildings) if (H.game.buildings && b.stock !== undefined &&
        ['farm', 'lumber', 'mine'].includes(b.type)) H.debug.fillStock(b);
    for (let t = 0; t < 20000; t += 200) {
        advanceTime(200);
        maxCarts = Math.max(maxCarts, game.carts.length);
        if (game.carts.length >= 4) break;
    }
    assert(maxCarts >= 3, 'several carts hauling at once (peak ' + maxCarts + ')');
    assert(world.objectCount(game.kinds.cart) === game.carts.length,
        'every cart is an instanced object');
    screenshot('test-4-city.png');
}

// --- 12. Save -> load round trip -----------------------------------------------------

{
    // Snapshot with a cart in flight.
    for (const b of game.buildings)
        if (['farm', 'lumber', 'mine'].includes(b.type) && !b.cartOut) H.debug.fillStock(b);
    pumpUntil('a cart in flight for the save', () => game.carts.length > 0, 15000);

    const snap = {
        coins: game.coins, food: game.food, wood: game.wood, ore: game.ore,
        pop: game.pop, buildings: game.buildings.length, carts: game.carts.length,
        roadTile: world.getTile(D.x + 1, D.y, L_ROADS),
        netCount: game.netCount, hauls: game.totalHauls,
    };
    assert(game.saveCity(), 'city saved');

    // Vandalize the live state.
    game.bulldoze(D.x + 1, D.y);
    H.debug.addCoins(9999);
    const farmCount = game.buildings.filter(b => b.type === 'farm').length;
    game.bulldoze(farm1.x, farm1.y);
    assert(game.buildings.filter(b => b.type === 'farm').length === farmCount - 1,
        'farm demolished pre-load');

    // Load through the real UI button.
    const r = document.getElementById('btn-load').getBoundingClientRect();
    click(r.x + r.width / 2, r.y + r.height / 2);
    advanceTime(120);

    assert(game.coins === snap.coins, 'coins restored');
    assert(game.food === snap.food && game.wood === snap.wood && game.ore === snap.ore,
        'stores restored');
    assert(game.pop === snap.pop, 'population restored');
    assert(game.buildings.length === snap.buildings, 'buildings restored');
    assert(world.getTile(D.x + 1, D.y, L_ROADS) === T.ROAD, 'road grid round-tripped');
    assert(game.netCount === snap.netCount, 'road networks recomputed after load');
    assert(game.carts.length === snap.carts, 'carts restored');
    // world.load() drops object kinds (engine bug, worked around by
    // re-registering) — instances must be back after a frame.
    advanceTime(200);
    assert(world.objectCount(game.kinds.house) > 0, 'house instances re-placed after load');
    assert(world.objectCount(game.kinds.tree) > 0, 'forest decor re-scattered after load');
    assert(world.objectCount(game.kinds.cart) === game.carts.length, 'cart instances back');
    // The loaded cart resumes hauling.
    const hauls0 = game.totalHauls;
    pumpUntil('loaded cart delivers', () => game.totalHauls > hauls0, 30000);
}

console.log('TILEHAVEN: all assertions passed  (roads recomputed ' +
    game.stats.recomputes + 'x, carts dispatched ' + game.stats.cartsDispatched +
    ', rerouted ' + game.stats.cartsRerouted + ', stranded ' + game.stats.cartsStranded + ')');
