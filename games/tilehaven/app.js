// app.js — TileHaven shell: scene/camera (pannable iso), click/drag painting,
// tint compositor (hover ghost / route preview / disconnection warnings),
// per-frame render sync (buildings + carts + warning markers as TileWorld
// object instances), HTML HUD, save/load, victory banner.

import {
    createGame, TILE, FLAG, COSTS, BUILD_INFO, GOAL, PROD, HOUSE_CAP,
    MAP_W, MAP_H, HSTEP, CART_LOAD, L_GROUND, L_ROADS,
} from '/app/game.js';

const canvas = document.getElementById('game');
const scene = canvas.getContext('scene');

scene.setToneMap({ mode: 'aces', exposure: 0.98, gamma: 2.2 });
scene.setAmbient([0.21, 0.22, 0.26]);
scene.createLight({
    type: 'directional',
    direction: [-0.55, -1.0, -0.30],
    color: [1.0, 0.96, 0.87],
    intensity: 2.0,
});

const game = createGame(scene);
const world = game.world;

// ---------------------------------------------------------------------------
// Camera — orthographic iso, arrow/WASD pan + wheel zoom.
// ---------------------------------------------------------------------------

const camera = { panX: 0, panZ: 0, zoom: 1 };
let baseCX = 0, baseCZ = 0, baseSize = 12;

function frameCamera() {
    const b = world.worldBounds();
    baseCX = (b.minX + b.maxX) / 2;
    baseCZ = (b.minZ + b.maxZ) / 2;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const spanZ = b.maxZ - b.minZ;
    const diag = Math.hypot(b.maxX - b.minX, spanZ);
    baseSize = Math.max(spanZ * 0.72 + 2.0, (diag * 0.72 + 1.5) / aspect);
    applyCamera(aspect);
}
function applyCamera(aspect) {
    if (aspect === undefined) {
        const rect = canvas.getBoundingClientRect();
        aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    }
    const cx = baseCX + camera.panX, cz = baseCZ + camera.panZ;
    scene.setCamera({
        mode: 'orthographic',
        size: baseSize * camera.zoom, aspect, near: 0.1, far: 200,
        position: [cx + 14, 16, cz + 14],
        target: [cx, 0, cz],
    });
}
frameCamera();
window.addEventListener('resize', frameCamera);

// Screen-right on the ground plane is (1,0,-1)/sqrt2; screen-up is (1,0,1)/sqrt2
// (for the fixed +14,+16,+14 iso offset).
const SQ = Math.SQRT1_2;
const panKeys = { right: false, left: false, up: false, down: false };
function updatePan(dt) {
    const s = 9 * dt * camera.zoom;
    let dx = 0, dz = 0;
    if (panKeys.right) { dx += SQ * s; dz -= SQ * s; }
    if (panKeys.left) { dx -= SQ * s; dz += SQ * s; }
    if (panKeys.up) { dx += SQ * s; dz += SQ * s; }
    if (panKeys.down) { dx -= SQ * s; dz -= SQ * s; }
    if (dx || dz) {
        camera.panX = Math.max(-14, Math.min(14, camera.panX + dx));
        camera.panZ = Math.max(-10, Math.min(10, camera.panZ + dz));
        applyCamera();
    }
}

// ---------------------------------------------------------------------------
// Tint compositor — one desired-tint map, diffed against what's applied.
// (No world.getTint — JS owns the state; base is plain white.)
// ---------------------------------------------------------------------------

const applied = new Map();     // "x,y" -> [r,g,b]

function desiredTints() {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + ',' + y, rgb);
    };
    // Disconnection warnings (slow blink so the remesh churn stays low).
    const blinkOn = (game.time % 1.2) < 0.7;
    for (const b of game.buildings) {
        if (b.connected) continue;
        put(b.x, b.y, blinkOn ? [1.9, 0.42, 0.38] : [1.45, 0.6, 0.55]);
    }
    // Selected building: its cell gold, its haul route tinted.
    if (selected) {
        for (const c of game.routeFor(selected)) put(c.x, c.y, [1.45, 1.3, 0.55]);
        put(selected.x, selected.y, [1.55, 1.35, 0.6]);
    }
    // Hover ghost for the armed tool.
    if (tool && hoverCell) {
        const { x, y } = hoverCell;
        if (tool === 'road') {
            const chk = game.canPaintRoad(x, y);
            put(x, y, chk.ok ? (chk.bridge ? [0.65, 1.1, 1.55] : [0.6, 1.5, 0.65])
                : [1.8, 0.45, 0.45]);
        } else if (tool === 'dozer') {
            const has = game.buildingAt(x, y) || world.getTile(x, y, L_ROADS) !== 0;
            put(x, y, has ? [1.7, 0.9, 0.4] : [1.2, 1.2, 1.2]);
        } else {
            put(x, y, game.canPlace(tool, x, y).ok ? [0.6, 1.5, 0.65] : [1.8, 0.45, 0.45]);
            if (tool === 'lumber')
                for (const c of world.cellsInRange(x, y, 1, 'vertex'))
                    if (world.getTile(c.x, c.y, L_GROUND) === TILE.FOREST)
                        put(c.x, c.y, [1.2, 1.45, 0.8]);
        }
    }
    return want;
}

function applyTints() {
    const want = desiredTints();
    let dirty = false;
    for (const k of applied.keys()) {
        if (!want.has(k)) {
            const [x, y] = k.split(',').map(Number);
            world.setTint(x, y, 1, 1, 1, 1);
            applied.delete(k);
            dirty = true;
        }
    }
    for (const [k, rgb] of want) {
        const cur = applied.get(k);
        if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
        const [x, y] = k.split(',').map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        applied.set(k, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

// ---------------------------------------------------------------------------
// Per-frame render sync: buildings, carts, cargo, warning markers.
// ---------------------------------------------------------------------------

const K = game.kinds;
const BLD_KIND = () => ({
    depot: K.depot, house: K.house, farm: K.farm,
    lumber: K.lumber, mine: K.mine, market: K.market,
});
const CARGO_COLOR = {
    food: [0.55, 0.95, 0.35, 1],
    wood: [0.62, 0.42, 0.20, 1],
    ore: [1.0, 0.72, 0.25, 1],
};
const HOUSE_TINTS = [
    [0.95, 0.82, 0.62, 1], [0.85, 0.70, 0.72, 1], [0.72, 0.80, 0.88, 1],
];

function syncRender() {
    const km = BLD_KIND();
    for (const t of Object.keys(km)) world.clearObjects(km[t]);
    world.clearObjects(K.houseRoof);
    world.clearObjects(K.cart);
    world.clearObjects(K.cargo);
    world.clearObjects(K.warn);

    for (const b of game.buildings) {
        const opts = { yaw: b.yaw, scale: b.type === 'depot' ? 1.5 : 1.15 };
        if (b.type === 'house') {
            opts.color = HOUSE_TINTS[b.id % HOUSE_TINTS.length];
            // fuller houses read bigger (clamped — debug/test pops can exceed cap)
            opts.scale = 1.0 + 0.05 * Math.min(b.pop, HOUSE_CAP);
        }
        world.addObject(km[b.type], b.x, b.y, opts);
        if (b.type === 'house')
            world.addObject(K.houseRoof, b.x, b.y, { yaw: opts.yaw, scale: opts.scale });
        if (!b.connected)
            world.addObject(K.warn, b.x, b.y, {
                yOffset: 0.95 + 0.08 * Math.sin(game.time * 5 + b.id),
            });
    }

    // Carts — anchored to the rounded cell, sub-cell offset carries the smooth
    // motion; yOffset lerps the ground height so bridges dip smoothly.
    for (const c of game.carts) {
        const pos = game.cartPos(c);
        const cx = Math.round(pos.x), cy = Math.round(pos.y);
        const a = c.path[c.seg], b2 = c.path[Math.min(c.seg + 1, c.path.length - 1)];
        const ea = world.getElevation(a.x, a.y) * HSTEP;
        const eb = world.getElevation(b2.x, b2.y) * HSTEP;
        const desiredY = ea + (eb - ea) * c.t + 0.02;
        const cellTop = world.getElevation(cx, cy) * HSTEP;
        const yaw = Math.atan2(b2.x - a.x, b2.y - a.y);
        world.addObject(K.cart, cx, cy, {
            yaw, offsetX: pos.x - cx, offsetZ: pos.y - cy,
            yOffset: desiredY - cellTop,
        });
        if (c.goods)
            world.addObject(K.cargo, cx, cy, {
                yaw, offsetX: pos.x - cx, offsetZ: pos.y - cy,
                yOffset: desiredY - cellTop + 0.19,
                color: CARGO_COLOR[c.goods.res],
            });
    }

    world.rebuildObjects();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const hud = {
    coins: el('hud-coins'), pop: el('hud-pop'), food: el('hud-food'),
    wood: el('hud-wood'), ore: el('hud-ore'), carts: el('hud-carts'),
    goal: el('hud-goal'),
    panel: el('info-panel'), banner: el('banner'),
};
let hudCache = '';

function updateHUD() {
    const sig = [game.coins, game.pop, game.food, game.wood, game.ore,
        game.carts.length, tool || '', selected ? selected.id + ':' +
        (selected.stock || 0) + ':' + selected.connected + ':' + selected.pop : '',
        game.victory, game.pop + '/' + game.jobs()].join('|');
    if (sig === hudCache) return;
    hudCache = sig;

    hud.coins.textContent = game.coins;
    hud.pop.textContent = game.pop;
    hud.food.textContent = game.food;
    hud.wood.textContent = game.wood;
    hud.ore.textContent = game.ore;
    hud.carts.textContent = game.carts.length;
    hud.goal.textContent = game.victory
        ? 'GOAL REACHED'
        : 'GOAL  ' + game.pop + '/' + GOAL.pop + ' pop · ' +
          Math.min(game.coins, GOAL.coins) + '/' + GOAL.coins + ' coins';

    for (const t of ['road', 'house', 'farm', 'lumber', 'mine', 'market', 'dozer']) {
        const btn = el('btn-' + t);
        btn.classList.toggle('selected', tool === t);
        if (COSTS[t]) {
            btn.classList.toggle('poor',
                game.coins < COSTS[t].coins || game.wood < COSTS[t].wood);
        }
    }

    if (selected) {
        const b = selected;
        const info = BUILD_INFO[b.type] || { name: 'Depot', desc: 'The heart of your city — all roads lead here.' };
        el('ip-name').textContent = info.name;
        let status;
        if (b.type === 'depot') status = 'Hub · ' + game.totalHauls + ' hauls received';
        else if (!b.connected) status = 'NOT ROAD-CONNECTED — build a road to the depot!';
        else if (b.type === 'house') status = b.pop + '/' + HOUSE_CAP + ' residents' +
            (game.food < 1 ? ' · needs food' : '');
        else if (b.type === 'market') status = 'Trading hub — carts deliver here';
        else if (!b.staffed) status = 'NO WORKERS — build houses (' + game.pop + '/' + game.jobs() + ' jobs filled)';
        else status = 'Producing ' + PROD[b.type].res + ' · stock ' + b.stock + '/' + CART_LOAD +
            (b.cartOut ? ' · cart en route' : '');
        el('ip-status').textContent = status;
        el('ip-status').classList.toggle('warn-text', !b.connected || (PROD[b.type] && !b.staffed));
        hud.panel.style.display = '';
    } else {
        hud.panel.style.display = 'none';
    }
}

let toastTimer = null;
function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.style.display = '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1900);
}
game.onToast = toast;

const REFUSE_TEXT = {
    coins: 'Not enough coins',
    wood: 'Not enough wood',
    terrain: 'Cannot build on that terrain',
    occupied: 'That spot is taken',
    building: 'A building is in the way',
    road: 'Cannot build on a road',
    forest: 'Lumber camps must sit beside a forest',
    ore: 'Mines must be built on an ore hill',
    depot: 'The depot cannot be demolished',
    bounds: 'Out of bounds',
};
game.onRefused = (r) => toast(REFUSE_TEXT[r.reason] || 'Cannot do that');

game.onVictory = () => {
    hud.banner.style.display = '';
    el('banner-text').textContent = 'TILEHAVEN THRIVES';
    el('banner-sub').textContent =
        'Population ' + game.pop + ' · ' + game.coins + ' coins · ' +
        game.totalHauls + ' cart hauls · ' + game.totalOreSold + ' ore sold';
    updateHUD();
};
el('btn-continue').addEventListener('click', () => {
    game.sandbox = true;
    hud.banner.style.display = 'none';
});

// ---------------------------------------------------------------------------
// Input: tool palette, hover ghost, click/drag painting.
// ---------------------------------------------------------------------------

let tool = null;         // 'road' | building type | 'dozer' | null (select)
let selected = null;     // selected building
let hoverCell = null;
let painting = false;    // mouse held with road/dozer tool

function setTool(t) {
    tool = (tool === t) ? null : t;
    selected = null;
    applyTints();
    updateHUD();
}

function pickCell(e) {
    const rect = canvas.getBoundingClientRect();
    const ray = scene.unprojectLocal(e.clientX - rect.left, e.clientY - rect.top);
    if (!ray) return null;
    const hit = world.raycastCell(ray.origin, ray.dir, 500);
    return hit ? { x: hit.x, y: hit.y } : null;
}

// Shared by real clicks and the test harness.
function actOnCell(x, y) {
    if (tool === 'road') {
        if (game.paintRoad(x, y)) world.rebuild();
        return;
    }
    if (tool === 'dozer') {
        const r = game.bulldoze(x, y);
        if (r.ok) {
            world.rebuild();
            if (r.what === 'building') toast('Demolished (+' + r.refund + ' coins)');
        } else if (r.reason === 'depot') {
            game.onRefused({ reason: 'depot' });
        }
        return;
    }
    if (tool) {                                 // building tool
        const b = game.placeBuilding(tool, x, y);
        if (b) world.rebuild();
        updateHUD();
        return;
    }
    // Select mode
    const b = game.buildingAt(x, y);
    selected = (b && b !== selected) ? b : null;
    applyTints();
    updateHUD();
}

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { setTool(null); return; }
    if (e.button !== 0) return;
    const c = pickCell(e);
    if (!c) return;
    actOnCell(c.x, c.y);
    if (tool === 'road' || tool === 'dozer') painting = true;
    updateHUD();
});
canvas.addEventListener('mouseup', () => { painting = false; });
canvas.addEventListener('mousemove', (e) => {
    const c = pickCell(e);
    if (!c) {
        if (hoverCell) { hoverCell = null; applyTints(); }
        return;
    }
    const changed = !hoverCell || hoverCell.x !== c.x || hoverCell.y !== c.y;
    hoverCell = c;
    if (painting && changed && (tool === 'road' || tool === 'dozer')) {
        actOnCell(c.x, c.y);
        updateHUD();
    }
    if (changed) applyTints();
});

for (const t of ['road', 'house', 'farm', 'lumber', 'mine', 'market', 'dozer']) {
    const btn = el('btn-' + t);
    btn.addEventListener('click', () => setTool(t));
    const costEl = btn.querySelector('.tb-cost');
    if (costEl && COSTS[t]) {
        costEl.textContent = COSTS[t].coins + 'c' +
            (COSTS[t].wood ? ' + ' + COSTS[t].wood + 'w' : '');
    }
}
el('btn-save').addEventListener('click', () => {
    if (game.saveCity()) toast('City saved');
});
el('btn-load').addEventListener('click', () => {
    if (!game.hasSave()) { toast('No saved city'); return; }
    if (game.loadCity()) {
        selected = null; tool = null;
        applied.clear();               // load reset every tint to white
        applyTints();
        world.rebuild();
        toast('City loaded');
        updateHUD();
    } else toast('Save file is corrupt');
});

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowright' || k === 'd') panKeys.right = true;
    else if (k === 'arrowleft' || k === 'a') panKeys.left = true;
    else if (k === 'arrowup' || k === 'w') panKeys.up = true;
    else if (k === 'arrowdown' || k === 's') panKeys.down = true;
    else if (k === 'r') setTool('road');
    else if (k === 'h') setTool('house');
    else if (k === 'f') setTool('farm');
    else if (k === 'l') setTool('lumber');
    else if (k === 'm') setTool('mine');
    else if (k === 'k') setTool('market');
    else if (k === 'b' || k === 'x') setTool('dozer');
    else if (k === 'escape') { setTool(null); selected = null; applyTints(); updateHUD(); }
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowright' || k === 'd') panKeys.right = false;
    else if (k === 'arrowleft' || k === 'a') panKeys.left = false;
    else if (k === 'arrowup' || k === 'w') panKeys.up = false;
    else if (k === 'arrowdown' || k === 's') panKeys.down = false;
});
canvas.addEventListener('wheel', (e) => {
    camera.zoom = Math.max(0.45, Math.min(1.6, camera.zoom * (1 + e.deltaY * 0.06)));
    applyCamera();
});

// ---------------------------------------------------------------------------
// Frame loop — rAF driven; advanceTime() steps it deterministically headless.
// ---------------------------------------------------------------------------

let lastTs = -1;
let lastWarnSig = '';
function frame(ts) {
    const now = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
    const dtMs = lastTs < 0 ? 16 : Math.min(50, Math.max(0, now - lastTs));
    lastTs = now;
    const dt = dtMs / 1000;

    game.update(dt);
    world.advance(dtMs);       // animated river + crops
    updatePan(dt);

    // Warning tints blink on a timer — only re-diff when the blink phase or
    // the warning set changes (or a selection/hover is active).
    const blink = (game.time % 1.2) < 0.7;
    const warnSig = game.buildings.filter(b => !b.connected).map(b => b.id).join(',') +
        '|' + blink + '|' + (selected ? selected.id : '') + '|' +
        (hoverCell ? hoverCell.x + ',' + hoverCell.y + ',' + tool : '');
    if (warnSig !== lastWarnSig) {
        lastWarnSig = warnSig;
        applyTints();
    }

    syncRender();
    updateHUD();
    requestAnimationFrame(frame);
}
updateHUD();
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Test / debug surface (used by test.js; handy in the headless REPL)
// ---------------------------------------------------------------------------

function projectCell(x, y) {
    const c = world.cellCenterWorldXZ(x, y);
    let topY = world.sampleHeight(c.x, c.z);
    if (topY === null) topY = 0;
    const V = scene.viewMatrix, P = scene.projectionMatrix;
    const mul = (m, v) => [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
    ];
    const clip = mul(P, mul(V, [c.x, topY, c.z, 1]));
    const rect = canvas.getBoundingClientRect();
    return {
        x: rect.left + (clip[0] / clip[3] * 0.5 + 0.5) * rect.width,
        y: rect.top + (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * rect.height,
    };
}

window.HAVEN = {
    game, world, scene,
    projectCell, actOnCell, setTool,
    get tool() { return tool; },
    get selected() { return selected; },
    TILE, FLAG, COSTS, GOAL, MAP_W, MAP_H,
    debug: {
        addCoins(n) { game.coins += n; updateHUD(); },
        addRes(res, n) { game[res] += n; updateHUD(); },
        setHousePop(b, n) {
            if (b.type !== 'house') return;
            game.pop += n - b.pop;
            b.pop = n;
            updateHUD();
        },
        fillStock(b) { b.stock = CART_LOAD; },
        select(b) { selected = b; applyTints(); updateHUD(); },
    },
};
