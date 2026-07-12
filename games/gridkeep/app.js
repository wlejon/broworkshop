// app.js — GridKeep shell: scene/camera, mouse picking, tint highlights,
// per-frame render sync (creeps / towers / projectiles as TileWorld object
// instances), HTML HUD, and the advanceTime-friendly frame loop.

import {
    createGame, TILE, TOWER_TYPES, CREEP_TYPES, MAX_LEVEL, upgradeCost,
    FLAG_BLOCK, FLAG_NOBUILD, FLAG_TOWER, MAP_W, MAP_H, SPAWNS, BASE, HSTEP,
} from '/app/game.js';

const canvas = document.getElementById('game');
const scene = canvas.getContext('scene');

scene.setToneMap({ mode: 'aces', exposure: 0.98, gamma: 2.2 });
scene.setAmbient([0.20, 0.21, 0.25]);
scene.createLight({
    type: 'directional',
    direction: [-0.55, -1.0, -0.30],
    color: [1.0, 0.96, 0.87],
    intensity: 2.05,
});

const game = createGame(scene);
const world = game.world;

// ---------------------------------------------------------------------------
// Camera — fixed isometric framing (orthographic, 45° yaw diagonal).
// ---------------------------------------------------------------------------

function frameCamera() {
    const b = world.worldBounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    // The 45°-rotated footprint projects wider than either axis; fit both.
    const diag = Math.hypot(spanX, spanZ);
    const size = Math.max(spanZ * 0.78 + 2.0, (diag * 0.78 + 1.5) / aspect);
    scene.setCamera({
        mode: 'orthographic',
        size, aspect, near: 0.1, far: 200,
        position: [cx + 14, 15, cz + 14],
        target: [cx, 0, cz],
    });
}
frameCamera();
window.addEventListener('resize', frameCamera);

// ---------------------------------------------------------------------------
// Cell <-> world helpers (square grid, linear mapping measured off the world)
// ---------------------------------------------------------------------------

const C00 = world.cellCenterWorldXZ(0, 0);
const C10 = world.cellCenterWorldXZ(1, 0);
const C01 = world.cellCenterWorldXZ(0, 1);
const DX = C10.x - C00.x, DZ = C01.z - C00.z;
const cellWorldX = (px) => C00.x + px * DX;
const cellWorldZ = (py) => C00.z + py * DZ;

// ---------------------------------------------------------------------------
// Tint compositor — one desired-tint map, diffed against what's applied.
// (There is no world.getTint, so JS owns the state; base is plain white.)
// ---------------------------------------------------------------------------

const applied = new Map();     // "x,y" -> [r,g,b]
let effects = [];              // { cells: [{x,y}], color: [r,g,b], until: gameTime }

function desiredTints() {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + ',' + y, rgb);
    };
    // selection / hover range previews (under effects so flashes win)
    if (selectedTower) {
        for (const c of world.cellsInRange(selectedTower.x, selectedTower.y,
            game.towerRange(selectedTower), 'vertex'))
            put(c.x, c.y, [0.75, 0.92, 1.45]);
        put(selectedTower.x, selectedTower.y, [1.5, 1.4, 0.7]);
    } else if (placeType && hoverCell) {
        const def = TOWER_TYPES[placeType];
        const elev = world.getTile(hoverCell.x, hoverCell.y, 0) === TILE.EGRASS;
        const range = def.range + (elev ? 1 : 0);
        for (const c of world.cellsInRange(hoverCell.x, hoverCell.y, range, 'vertex'))
            put(c.x, c.y, [0.82, 0.95, 1.35]);
        const ok = hoverPlaceable;
        put(hoverCell.x, hoverCell.y, ok ? [0.55, 1.55, 0.6] : [1.8, 0.45, 0.45]);
    }
    for (const e of effects)
        for (const c of e.cells) put(c.x, c.y, e.color);
    return want;
}

function applyTints() {
    const want = desiredTints();
    let dirty = false;
    for (const key of applied.keys()) {
        if (!want.has(key)) {
            const [x, y] = key.split(',').map(Number);
            world.setTint(x, y, 1, 1, 1, 1);
            applied.delete(key);
            dirty = true;
        }
    }
    for (const [key, rgb] of want) {
        const cur = applied.get(key);
        if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
        const [x, y] = key.split(',').map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        applied.set(key, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

function flashCells(cells, color, durSec) {
    effects.push({ cells, color, until: game.time + durSec });
    applyTints();
}

game.onSplash = (x, y) => {
    flashCells(world.cellsInRange(x, y, 1, 'vertex'), [1.7, 1.15, 0.5], 0.18);
};
game.onRefused = (r) => {
    flashCells([{ x: r.x, y: r.y }], [1.9, 0.35, 0.35], 0.35);
    toast(REFUSE_TEXT[r.reason] || 'Cannot build there');
};
const REFUSE_TEXT = {
    blocks: 'That would wall off the path!',
    gold: 'Not enough gold',
    terrain: 'Cannot build on that terrain',
    occupied: 'A tower is already there',
    creep: 'A creep is in the way',
};

// ---------------------------------------------------------------------------
// Per-frame render sync: creeps, towers, projectiles, HP bars
// ---------------------------------------------------------------------------

const K = game.kinds;
const TOWER_COLOR = {
    arrow: [0.64, 0.46, 0.26, 1],
    cannon: [0.32, 0.34, 0.40, 1],
    frost: [0.34, 0.58, 0.95, 1],
};
const LEVEL_ACCENT = [null, [1, 1, 1], [1.25, 1.12, 0.9], [1.6, 1.25, 0.7]];
const CREEP_COLOR = {
    normal: [0.78, 0.22, 0.50, 1],
    fast: [1.0, 0.52, 0.10, 1],
    tank: [0.40, 0.28, 0.16, 1],
    boss: [0.70, 0.08, 0.08, 1],
};

const hpBars = new Map();      // creep.id -> ShapeNode
const groundY = 0;             // all walkable cells sit at elevation 0

function syncRender() {
    // Towers — one instanced kind per type, colour/scale encode the level.
    for (const type of Object.keys(TOWER_TYPES)) world.clearObjects(K[type]);
    for (const t of game.towers) {
        const base = TOWER_COLOR[t.type], acc = LEVEL_ACCENT[t.level];
        world.addObject(K[t.type], t.x, t.y, {
            yaw: t.yaw,
            scale: 1 + 0.13 * (t.level - 1),
            color: [base[0] * acc[0], base[1] * acc[1], base[2] * acc[2], 1],
        });
    }

    // Creeps — anchored to their rounded cell, sub-cell offset carries the
    // smooth interpolation. All walkable cells are elevation 0, so no pops.
    for (const kn of ['normal', 'fast', 'tank']) world.clearObjects(K[kn]);
    for (const c of game.creeps) {
        const cx = Math.round(c.px), cy = Math.round(c.py);
        const col = [...CREEP_COLOR[c.type]];
        if (game.isSlowed(c)) { col[0] *= 0.45; col[1] *= 0.75; col[2] = Math.min(1, col[2] * 1.6 + 0.3); }
        if (c.hitFlash > 0) { col[0] = Math.min(1.6, col[0] + 0.9); col[1] += 0.5; col[2] += 0.5; }
        world.addObject(K[c.type], cx, cy, {
            yaw: c.yaw,
            scale: c.def.scale,
            offsetX: c.px - cx,
            offsetZ: c.py - cy,
            color: col,
        });
    }

    // Projectiles — anchored to the cell under them; yOffset compensates for
    // that cell's elevation so flight height is in world terms.
    for (const kn of ['projArrow', 'projCannon', 'projFrost']) world.clearObjects(K[kn]);
    const PK = { arrow: K.projArrow, cannon: K.projCannon, frost: K.projFrost };
    for (const p of game.projectiles) {
        const cx = Math.round(p.x), cy = Math.round(p.y);
        if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) continue;
        const cellTop = world.getElevation(cx, cy) * HSTEP;
        world.addObject(PK[p.kind], cx, cy, {
            yaw: p.yaw,
            offsetX: p.x - cx,
            offsetZ: p.y - cy,
            yOffset: Math.max(0.05, groundY + p.h - cellTop),
        });
    }

    world.rebuildObjects();

    // HP bars — world-anchored billboards, shown once a creep is damaged.
    const seen = new Set();
    for (const c of game.creeps) {
        if (c.hp >= c.maxHp) continue;
        seen.add(c.id);
        const frac = c.hp / c.maxHp;
        const fill = frac > 0.6 ? '#46d24a' : frac > 0.3 ? '#e6c33c' : '#e04430';
        const anchor = [cellWorldX(c.px), groundY + 0.62 * c.def.scale + 0.18, cellWorldZ(c.py)];
        let bar = hpBars.get(c.id);
        if (!bar) {
            bar = scene.createShape({
                shape: 'rect', width: 0.6, height: 0.075,
                fill, worldAnchor: anchor, billboard: 'full',
            });
            hpBars.set(c.id, bar);
        }
        bar.worldAnchor = anchor;
        bar.width = Math.max(0.05, 0.6 * frac * c.def.scale);
        bar.fillColor = fill;
    }
    for (const [id, bar] of hpBars) {
        if (!seen.has(id)) { bar.destroy(); hpBars.delete(id); }
    }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const hud = {
    gold: el('hud-gold'), lives: el('hud-lives'), wave: el('hud-wave'),
    waveBtn: el('btn-wave'), panel: el('tower-panel'),
    banner: el('banner'), bannerText: el('banner-text'), bannerSub: el('banner-sub'),
};
let hudCache = '';

function updateHUD() {
    const sig = [game.gold, game.lives, game.wave, game.waveActive, game.over,
        selectedTower ? selectedTower.id + ':' + selectedTower.level : '',
        placeType || ''].join('|');
    if (sig === hudCache) return;
    hudCache = sig;

    hud.gold.textContent = game.gold;
    hud.lives.textContent = game.lives;
    hud.wave.textContent = (game.wave || '—') + ' / ' + game.finalWave;
    hud.waveBtn.textContent = game.waveActive
        ? 'WAVE ' + game.wave + ' INCOMING'
        : game.wave >= game.finalWave ? 'ALL WAVES DONE'
            : 'START WAVE ' + (game.wave + 1) + '  [Space]';
    hud.waveBtn.classList.toggle('disabled', game.waveActive || game.over || game.wave >= game.finalWave);

    for (const type of Object.keys(TOWER_TYPES)) {
        const btn = el('btn-' + type);
        btn.classList.toggle('selected', placeType === type);
        btn.classList.toggle('poor', game.gold < TOWER_TYPES[type].cost);
    }

    if (selectedTower) {
        const t = selectedTower, def = TOWER_TYPES[t.type];
        el('tp-name').textContent = def.name + ' Tower  ·  L' + t.level +
            (t.elevated ? '  (hilltop +1 range)' : '');
        el('tp-stats').textContent =
            'DMG ' + game.towerDamage(t) +
            '  ·  RANGE ' + game.towerRange(t) +
            '  ·  RATE ' + (1 / game.towerCooldown(t)).toFixed(1) + '/s' +
            (def.splash ? '  ·  SPLASH' : '') + (def.slow ? '  ·  SLOWS' : '');
        const up = el('btn-upgrade');
        if (t.level >= MAX_LEVEL) {
            up.textContent = 'MAX LEVEL';
            up.classList.add('disabled');
        } else {
            up.textContent = 'UPGRADE  (' + upgradeCost(t) + 'g)';
            up.classList.toggle('disabled', game.gold < upgradeCost(t));
        }
        el('btn-sell').textContent = 'SELL  (+' + game.sellRefund(t) + 'g)';
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
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1800);
}

function announce(msg) {
    const a = el('announce');
    a.textContent = msg;
    a.style.display = '';
    a.classList.remove('pop');
    void a.offsetWidth;         // restart the CSS animation
    a.classList.add('pop');
    setTimeout(() => { a.style.display = 'none'; }, 2400);
}

game.onWaveStart = (n, def) => {
    const names = [...new Set(def.groups.map(g => CREEP_TYPES[g.t].name))].join(' + ');
    announce('WAVE ' + n + (n === game.finalWave ? ' — FINAL!' : '') + '  ·  ' + names);
};
game.onWaveCleared = (n, bonus) => {
    if (n < game.finalWave) toast('Wave ' + n + ' cleared  ·  +' + bonus + 'g bonus');
};
game.onLeak = () => {
    const lv = el('hud-lives-box');
    lv.classList.remove('hurt');
    void lv.offsetWidth;
    lv.classList.add('hurt');
};
game.onGameOver = (won) => {
    hud.banner.style.display = '';
    hud.banner.className = won ? 'victory' : 'defeat';
    hud.bannerText.textContent = won ? 'VICTORY' : 'THE KEEP HAS FALLEN';
    hud.bannerSub.textContent = won
        ? 'All ' + game.finalWave + ' waves repelled  ·  ' + game.kills + ' creeps slain  ·  ' +
          game.lives + ' lives left'
        : 'Survived to wave ' + game.wave + '  ·  ' + game.kills + ' creeps slain';
    placeType = null;
    selectedTower = null;
    applyTints();
};

// ---------------------------------------------------------------------------
// Input: palette selection, hover ghost, click to place / select
// ---------------------------------------------------------------------------

let placeType = null;          // tower type armed for placement
let selectedTower = null;      // existing tower selected (panel + range)
let hoverCell = null;
let hoverPlaceable = false;

function setPlaceType(type) {
    placeType = (placeType === type) ? null : type;
    selectedTower = null;
    refreshHover(hoverCell ? hoverCell.x : -99, hoverCell ? hoverCell.y : -99, true);
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

function refreshHover(x, y, force) {
    if (!force && hoverCell && hoverCell.x === x && hoverCell.y === y) return;
    hoverCell = (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) ? { x, y } : null;
    if (hoverCell && placeType)
        hoverPlaceable = game.canPlace(placeType, hoverCell.x, hoverCell.y).ok;
    applyTints();
}

canvas.addEventListener('mousemove', (e) => {
    const c = pickCell(e);
    if (c) refreshHover(c.x, c.y, false);
    else if (hoverCell) { hoverCell = null; applyTints(); }
});

// Shared by real clicks and the test harness.
function actOnCell(x, y) {
    if (game.over) return;
    const t = game.towerAt(x, y);
    if (t) {                                  // always let clicks inspect towers
        selectedTower = (selectedTower === t) ? null : t;
        placeType = null;
        applyTints(); updateHUD();
        return;
    }
    if (placeType) {
        const placed = game.placeTower(placeType, x, y);
        if (placed) {
            refreshHover(x, y, true);          // re-evaluate ghost on the new maze
            applyTints();
        }
        updateHUD();
        return;
    }
    if (selectedTower) { selectedTower = null; applyTints(); updateHUD(); }
}

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {                     // right-click cancels
        placeType = null; selectedTower = null;
        applyTints(); updateHUD();
        return;
    }
    if (e.button !== 0) return;
    const c = pickCell(e);
    if (!c) return;
    actOnCell(c.x, c.y);
});

for (const type of Object.keys(TOWER_TYPES)) {
    const btn = el('btn-' + type);
    btn.addEventListener('click', () => setPlaceType(type));
    btn.querySelector('.tb-cost').textContent = TOWER_TYPES[type].cost + 'g';
    btn.querySelector('.tb-desc').textContent = TOWER_TYPES[type].desc;
}
el('btn-wave').addEventListener('click', () => { game.startNextWave(); updateHUD(); });
el('btn-upgrade').addEventListener('click', () => {
    if (selectedTower) { game.upgradeTower(selectedTower); updateHUD(); }
});
el('btn-sell').addEventListener('click', () => {
    if (selectedTower) {
        game.sellTower(selectedTower);
        selectedTower = null;
        applyTints(); updateHUD();
    }
});

window.addEventListener('keydown', (e) => {
    const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
    if (k === '1') setPlaceType('arrow');
    else if (k === '2') setPlaceType('cannon');
    else if (k === '3') setPlaceType('frost');
    else if (k === 'space') { game.startNextWave(); updateHUD(); }
    else if (k === 'escape') {
        placeType = null; selectedTower = null;
        applyTints(); updateHUD();
    } else if (k === 'u' && selectedTower) { game.upgradeTower(selectedTower); updateHUD(); }
    else if (k === 's' && selectedTower) {
        game.sellTower(selectedTower);
        selectedTower = null; applyTints(); updateHUD();
    }
});

// ---------------------------------------------------------------------------
// Frame loop — rAF driven; advanceTime() steps it deterministically headless.
// ---------------------------------------------------------------------------

let lastTs = -1;
function frame(ts) {
    const now = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
    const dtMs = lastTs < 0 ? 16 : Math.min(50, Math.max(0, now - lastTs));
    lastTs = now;
    const dt = dtMs / 1000;

    game.update(dt);
    world.advance(dtMs);                       // animated water border

    // expire tint flashes
    if (effects.length) {
        const n = effects.length;
        effects = effects.filter(e => e.until > game.time);
        if (effects.length !== n) applyTints();
    }
    // deselect a sold/vanished tower defensively
    if (selectedTower && !game.towers.includes(selectedTower)) {
        selectedTower = null; applyTints();
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

window.GRIDKEEP = {
    game, world, scene,
    projectCell, actOnCell, setPlaceType,
    get placeType() { return placeType; },
    get selectedTower() { return selectedTower; },
    TILE, TOWER_TYPES, CREEP_TYPES, SPAWNS, BASE,
    FLAG_BLOCK, FLAG_NOBUILD, FLAG_TOWER, MAP_W, MAP_H,
    debug: {
        addGold(n) { game.gold += n; updateHUD(); },
        setLives(n) { game.lives = n; updateHUD(); },
        setWave(n) { game.wave = n; updateHUD(); },
        spawnCreep(type, x, y, opts) { return game.spawnCreep(type, x, y, opts); },
        killAll() { for (const c of [...game.creeps]) game.damageCreep(c, 1e9); },
        freeze(on) { game.frozen = !!on; },
    },
};
