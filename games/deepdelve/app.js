// app.js — DeepDelve shell: scene/camera/torch lighting, fog-of-war tint
// compositor, turn-based keyboard input, per-frame render sync (player /
// monsters / items / doors / traps / decor as TileWorld object instances),
// HTML HUD with message log, save/load, and the advanceTime-friendly loop.

import {
    createGame, MONSTERS, TILE, FLAG, PLAYER_BASE,
    MAP_W, MAP_H, HSTEP, FLOORS, FOV_R, blobVariantMasks,
} from '/app/game.js';

const canvas = document.getElementById('game');
const scene = canvas.getContext('scene');

// A dim dungeon: low cool ambient + faint moonish key, the player's torch
// carries the mood. Fog tint does the actual visibility gating.
scene.setToneMap({ mode: 'aces', exposure: 1.06, gamma: 2.2 });
scene.setAmbient([0.14, 0.15, 0.20]);
scene.createLight({
    type: 'directional',
    direction: [-0.35, -1.0, -0.22],
    color: [0.62, 0.68, 0.85],
    intensity: 0.85,
});
const torch = scene.createLight({
    type: 'point', position: [0, 2, 0],
    color: [1.0, 0.72, 0.42], intensity: 2.6, range: 9.5,
});

const game = createGame(scene, (Math.random() * 0xFFFFFFFF) >>> 0);
const world = game.world;

// ---------------------------------------------------------------------------
// Cell -> world helpers
// ---------------------------------------------------------------------------

const C00 = world.cellCenterWorldXZ(0, 0);
const C10 = world.cellCenterWorldXZ(1, 0);
const C01 = world.cellCenterWorldXZ(0, 1);
const DX = C10.x - C00.x, DZ = C01.z - C00.z;
const cellWorldX = (px) => C00.x + px * DX;
const cellWorldZ = (py) => C00.z + py * DZ;
const cellTopY = (x, y) => world.getElevation(Math.round(x), Math.round(y)) * HSTEP;

// ---------------------------------------------------------------------------
// Fog-of-war tint compositor — desired tint per cell diffed against applied.
// (No world.getTint, so JS owns the state.) Fog owns every cell; short-lived
// effects (arrow flashes, hits) override on top.
// ---------------------------------------------------------------------------

const TINT_UNSEEN = [0.03, 0.03, 0.05];
const TINT_REMEMBERED = [0.16, 0.17, 0.25];
const TINT_VISIBLE = [1, 1, 1];

const applied = new Map();        // idx -> [r,g,b]
let effects = [];                 // { cells: [{x,y}], color, until (perf ms) }
let effectsDirty = false;
let nowMs = 0;

function applyTints(force) {
    if (!force && !game.fogDirty && !effectsDirty) return;
    const effTint = new Map();
    for (const e of effects)
        for (const c of e.cells) effTint.set(c.y * MAP_W + c.x, e.color);
    let dirty = false;
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            const i = y * MAP_W + x;
            let rgb = effTint.get(i);
            if (!rgb) {
                const f = game.fog[i];
                rgb = f === 2 ? TINT_VISIBLE : f === 1 ? TINT_REMEMBERED : TINT_UNSEEN;
            }
            const cur = applied.get(i);
            if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
            world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
            applied.set(i, rgb);
            dirty = true;
        }
    }
    game.fogDirty = false;
    effectsDirty = false;
    if (dirty) world.rebuild();
}

function flashCells(cells, color, durMs) {
    effects.push({ cells, color, until: nowMs + durMs });
    effectsDirty = true;
}

game.onShot = (line) => flashCells(line, [1.0, 0.78, 0.38], 160);
game.onFullRedraw = () => { applied.clear(); applyTints(true); };

// ---------------------------------------------------------------------------
// Camera — perspective, follows the player smoothly.
// ---------------------------------------------------------------------------

const cam = { x: 0, z: 0, init: false };
function updateCamera(dt) {
    const px = cellWorldX(vis.player.x), pz = cellWorldZ(vis.player.y);
    if (!cam.init) { cam.x = px; cam.z = pz; cam.init = true; }
    const k = 1 - Math.pow(0.0022, dt);
    cam.x += (px - cam.x) * k;
    cam.z += (pz - cam.z) * k;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const py = cellTopY(game.player.x, game.player.y);
    scene.setCamera({
        fov: 46, aspect, near: 0.1, far: 120,
        position: [cam.x, py + 9.6, cam.z + 6.4],
        target: [cam.x, py, cam.z - 0.4],
    });
}

// ---------------------------------------------------------------------------
// Per-frame render sync — smooth movers re-anchored to their current cell.
// Monsters render only when their cell is VISIBLE; items/doors/decor persist
// on REMEMBERED cells (dimmed), roguelike-style.
// ---------------------------------------------------------------------------

const K = game.kinds;
const MONSTER_KIND = { rat: 'rat', wolf: 'wolf', archer: 'archer', ogre: 'ogre', boss: 'ogre' };
const MONSTER_COLOR = {
    rat: [0.62, 0.45, 0.32, 1],
    wolf: [0.58, 0.60, 0.66, 1],
    archer: [0.88, 0.87, 0.78, 1],
    ogre: [0.45, 0.62, 0.34, 1],
    boss: [0.82, 0.20, 0.18, 1],
};
const MONSTER_SCALE = { rat: 0.9, wolf: 1.0, archer: 1.0, ogre: 1.25, boss: 1.8 };
const ITEM_KIND = { potion: 'potion', gold: 'gold', weapon: 'weapon', armor: 'armor', amulet: 'amulet' };

// Visual positions lerp toward logical cell positions (turn-based, so short).
const vis = { player: { x: 0, y: 0 }, monsters: new Map() };   // id -> {x,y,yaw}
function lerpVis(dt) {
    const rate = Math.min(1, dt * 11);
    const p = game.player;
    vis.player.x += (p.x - vis.player.x) * rate;
    vis.player.y += (p.y - vis.player.y) * rate;
    if (Math.abs(p.x - vis.player.x) > 1.6 || Math.abs(p.y - vis.player.y) > 1.6) {
        vis.player.x = p.x; vis.player.y = p.y;                 // teleport / descend snap
    }
    const seen = new Set();
    for (const m of game.monsters) {
        seen.add(m.id);
        let v = vis.monsters.get(m.id);
        if (!v) { v = { x: m.x, y: m.y, yaw: 0 }; vis.monsters.set(m.id, v); }
        const dx = m.x - v.x, dy = m.y - v.y;
        if (Math.abs(dx) > 1.6 || Math.abs(dy) > 1.6) { v.x = m.x; v.y = m.y; }
        else { v.x += dx * rate; v.y += dy * rate; }
        if (dx * dx + dy * dy > 0.0001) v.yaw = Math.atan2(dx, dy);
    }
    for (const id of vis.monsters.keys()) if (!seen.has(id)) vis.monsters.delete(id);
}

const hpBars = new Map();          // monster.id -> ShapeNode
const fogAt = (x, y) => game.fog[y * MAP_W + x];

let playerYaw = Math.PI;
function syncRender() {
    for (const kn of Object.keys(K)) world.clearObjects(K[kn]);

    // Player (always visible), facing the last move direction.
    {
        const cx = Math.round(vis.player.x), cy = Math.round(vis.player.y);
        world.addObject(K.player, cx, cy, {
            yaw: playerYaw,
            offsetX: vis.player.x - cx, offsetZ: vis.player.y - cy,
            color: [0.55, 0.72, 1.0, 1],
        });
    }

    // Monsters — visible cells only.
    for (const m of game.monsters) {
        const v = vis.monsters.get(m.id);
        if (!v) continue;
        const cx = Math.round(v.x), cy = Math.round(v.y);
        if (fogAt(cx, cy) !== 2) continue;
        world.addObject(K[MONSTER_KIND[m.type]], cx, cy, {
            yaw: v.yaw, scale: MONSTER_SCALE[m.type],
            offsetX: v.x - cx, offsetZ: v.y - cy,
            color: MONSTER_COLOR[m.type],
        });
    }

    // Items — persist on remembered cells, dimmed.
    for (const it of game.items) {
        const f = fogAt(it.x, it.y);
        if (f === 0) continue;
        const dim = f === 2 ? 1 : 0.32;
        const bob = it.kind === 'amulet' ? Math.sin(nowMs * 0.003) * 0.06 + 0.06 : 0;
        world.addObject(K[ITEM_KIND[it.kind]], it.x, it.y, {
            yaw: (it.x * 7 + it.y * 13) % 6.28,
            yOffset: bob,
            color: [dim, dim, dim, 1],
        });
    }

    // Doors (closed slabs), revealed traps, decor.
    for (const d of game.doors) {
        if (d.open) continue;
        const f = fogAt(d.x, d.y);
        if (f === 0) continue;
        const dim = f === 2 ? 1 : 0.32;
        world.addObject(K.door, d.x, d.y, {
            yaw: d.orient === 0 ? 0 : Math.PI / 2,
            color: [dim, dim, dim, 1],
        });
    }
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            if (world.getTile(x, y, 0) !== TILE.TRAPR) continue;
            const f = fogAt(x, y);
            if (f === 0) continue;
            const armed = world.hasFlag(x, y, FLAG.TRAP);
            const dim = f === 2 ? 1 : 0.32;
            world.addObject(K.spikes, x, y, {
                yaw: (x * 5 + y * 3) % 6.28, scale: armed ? 0.7 : 1.0,
                color: armed ? [dim, dim * 0.6, dim * 0.6, 1] : [dim, dim, dim, 1],
            });
        }
    }
    for (const d of game.decor) {
        const f = fogAt(d.x, d.y);
        if (f === 0) continue;
        const dim = f === 2 ? 1 : 0.32;
        const glow = d.kind === 'mushroom' && f === 2 ? 1.5 : 1;
        world.addObject(K[d.kind], d.x, d.y, {
            yaw: d.yaw, scale: d.scale,
            offsetX: d.ox, offsetZ: d.oz,
            color: [dim * glow, dim * glow, dim * glow, 1],
        });
    }

    world.rebuildObjects();

    // Monster HP bars — visible + damaged only.
    const seen = new Set();
    for (const m of game.monsters) {
        const def = MONSTERS[m.type];
        const v = vis.monsters.get(m.id);
        if (!v || m.hp >= def.hp) continue;
        const cx = Math.round(v.x), cy = Math.round(v.y);
        if (fogAt(cx, cy) !== 2) continue;
        seen.add(m.id);
        const frac = Math.max(0, m.hp / def.hp);
        const fill = frac > 0.6 ? '#46d24a' : frac > 0.3 ? '#e6c33c' : '#e04430';
        const anchor = [cellWorldX(v.x), cellTopY(v.x, v.y) + 0.75 * MONSTER_SCALE[m.type], cellWorldZ(v.y)];
        let bar = hpBars.get(m.id);
        if (!bar) {
            bar = scene.createShape({
                shape: 'rect', width: 0.55, height: 0.07,
                fill, worldAnchor: anchor, billboard: 'full',
            });
            hpBars.set(m.id, bar);
        }
        bar.worldAnchor = anchor;
        bar.width = Math.max(0.05, 0.55 * frac);
        bar.fillColor = fill;
    }
    for (const [id, bar] of hpBars)
        if (!seen.has(id)) { bar.destroy(); hpBars.delete(id); }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
let hudCache = '';

function updateHUD() {
    const p = game.player;
    const sig = [p.hp, p.maxHp, p.atk, p.def, p.gold, p.potions, p.weapon, p.armor,
        game.floor, game.turn, game.over, game.won].join('|');
    if (sig === hudCache) return;
    hudCache = sig;

    el('hp-text').textContent = p.hp + ' / ' + p.maxHp;
    const frac = p.hp / p.maxHp;
    const fill = el('hp-fill');
    fill.style.width = Math.round(frac * 100) + '%';
    fill.style.background = frac > 0.55 ? '#4bd24f' : frac > 0.28 ? '#e6c33c' : '#e04430';
    el('stat-atk').textContent = p.atk;
    el('stat-def').textContent = p.def;
    el('stat-gold').textContent = p.gold;
    el('stat-floor').textContent = game.floor + ' / ' + FLOORS;
    el('stat-turn').textContent = game.turn;
    el('inv-weapon').textContent = p.weapon;
    el('inv-armor').textContent = p.armor;
    el('inv-potions').textContent = p.potions;
    el('btn-potion').classList.toggle('disabled', p.potions <= 0);
}

function renderLog() {
    const box = el('log');
    box.innerHTML = '';
    for (const m of game.msgs.slice(-7)) {
        const d = document.createElement('div');
        d.className = 'log-line ' + (m.cls || '');
        d.textContent = m.text;
        box.appendChild(d);
    }
}
game.onLog = renderLog;

game.onHurt = () => {
    const v = el('vignette');
    v.classList.remove('hit');
    void v.offsetWidth;
    v.classList.add('hit');
};

function announce(msg) {
    const a = el('announce');
    a.textContent = msg;
    a.style.display = '';
    a.classList.remove('pop');
    void a.offsetWidth;
    a.classList.add('pop');
    setTimeout(() => { a.style.display = 'none'; }, 2200);
}
game.onDescend = (floor) => announce('FLOOR ' + floor + (floor === FLOORS ? ' — THE DEEPEST DARK' : ''));

game.onGameOver = (won) => {
    const b = el('banner');
    b.style.display = '';
    b.className = won ? 'victory' : 'defeat';
    el('banner-text').textContent = won ? 'YOU ESCAPED WITH THE AMULET' : 'YOU HAVE DIED';
    el('banner-sub').textContent =
        'Floor ' + game.floor + ' of ' + FLOORS +
        '  ·  ' + game.kills + ' monsters slain' +
        '  ·  ' + game.goldTotal + ' gold' +
        '  ·  ' + game.turn + ' turns' +
        '  —  Enter for a new delve';
};

// ---------------------------------------------------------------------------
// Input — one action per keydown, held keys auto-repeat via the frame loop.
// ---------------------------------------------------------------------------

const KEYDIR = {
    arrowup: [0, -1], w: [0, -1],
    arrowdown: [0, 1], s: [0, 1],
    arrowleft: [-1, 0], a: [-1, 0],
    arrowright: [1, 0], d: [1, 0],
};
const pressed = new Set();
let heldDir = null, heldKey = null, repeatAt = 0;

function afterAction() {
    applyTints(false);
    renderLog();
    updateHUD();
}

function doMove(dir) {
    if (dir[0] > 0) playerYaw = Math.PI / 2;
    else if (dir[0] < 0) playerYaw = -Math.PI / 2;
    else if (dir[1] > 0) playerYaw = Math.PI;
    else playerYaw = 0;
    game.playerAct({ type: 'move', dx: dir[0], dy: dir[1] });
    afterAction();
}

function restart() {
    for (const [, bar] of hpBars) bar.destroy();
    hpBars.clear();
    vis.monsters.clear();
    el('banner').style.display = 'none';
    game.newRun((Math.random() * 0xFFFFFFFF) >>> 0);
    vis.player.x = game.player.x; vis.player.y = game.player.y;
    cam.init = false;
    afterAction();
}

window.addEventListener('keydown', (e) => {
    const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
    if (pressed.has(k)) return;                    // ignore DOM auto-repeat
    pressed.add(k);
    if (game.over) {
        if (k === 'enter') restart();
        return;
    }
    const dir = KEYDIR[k];
    if (dir) {
        heldDir = dir; heldKey = k; repeatAt = nowMs + 230;
        doMove(dir);
        return;
    }
    if (k === 'space' || k === '.') { game.playerAct({ type: 'wait' }); afterAction(); }
    else if (k === 'q') { game.playerAct({ type: 'potion' }); afterAction(); }
    else if (k === 'e') { game.playerAct({ type: 'search' }); afterAction(); }
    else if (k === 'f5') { game.saveRun(); afterAction(); }
    else if (k === 'f9') { game.loadRun(); syncAfterLoad(); }
});
window.addEventListener('keyup', (e) => {
    const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
    pressed.delete(k);
    if (k === heldKey) { heldDir = null; heldKey = null; }
});

function syncAfterLoad() {
    vis.player.x = game.player.x; vis.player.y = game.player.y;
    vis.monsters.clear();
    cam.init = false;
    afterAction();
}

el('btn-potion').addEventListener('click', () => { game.playerAct({ type: 'potion' }); afterAction(); });
el('btn-save').addEventListener('click', () => { game.saveRun(); afterAction(); });
el('btn-load').addEventListener('click', () => { game.loadRun(); syncAfterLoad(); });
el('banner').addEventListener('click', () => { if (game.over) restart(); });

// ---------------------------------------------------------------------------
// Frame loop — rAF driven; advanceTime() steps it deterministically headless.
// ---------------------------------------------------------------------------

let lastTs = -1;
function frame(ts) {
    const now = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
    const dtMs = lastTs < 0 ? 16 : Math.min(50, Math.max(0, now - lastTs));
    lastTs = now;
    nowMs = now;
    const dt = dtMs / 1000;

    // Held-key auto-repeat (turn-based walk).
    if (heldDir && !game.over && now >= repeatAt) {
        repeatAt = now + 120;
        doMove(heldDir);
    }

    // Expire effect flashes.
    if (effects.length) {
        const n = effects.length;
        effects = effects.filter(e => e.until > now);
        if (effects.length !== n) effectsDirty = true;
    }

    world.advance(dtMs);                       // animated water
    applyTints(false);
    lerpVis(dt);
    updateCamera(dt);

    // Torch follows the player, with a subtle flicker.
    const ty = cellTopY(game.player.x, game.player.y);
    torch.position = [cellWorldX(vis.player.x), ty + 1.5, cellWorldZ(vis.player.y)];
    torch.intensity = 2.6 + Math.sin(now * 0.013) * 0.18 + Math.sin(now * 0.037) * 0.12;

    syncRender();
    updateHUD();
    requestAnimationFrame(frame);
}
vis.player.x = game.player.x; vis.player.y = game.player.y;
renderLog();
updateHUD();
applyTints(true);
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Test / debug surface (used by test.js; handy in the headless REPL)
// ---------------------------------------------------------------------------

window.DELVE = {
    game, world, scene,
    TILE, FLAG, MONSTERS, MAP_W, MAP_H, FOV_R, PLAYER_BASE,
    blobVariants: blobVariantMasks(),
    appliedTints: applied,
    debug: {
        newRun(seed) { game.newRun(seed); syncAfterLoad(); },
        teleport(x, y) {
            game.player.x = x; game.player.y = y;
            game.computeFOV();
            afterAction();
        },
        spawnMonster(type, x, y, opts = {}) {
            const m = game.spawnMonster(type, x, y);
            if (opts.awake) m.awake = true;
            return m;
        },
        clearMonsters() { game.monsters.length = 0; },
        killMonster(m) { m.hp = 0; game.monsters.splice(game.monsters.indexOf(m), 1); },
        setHP(n) { game.player.hp = n; updateHUD(); },
        addPotion(n) { game.player.potions += (n || 1); updateHUD(); },
        placeItem(kind, x, y, extra = {}) { game.items.push({ kind, x, y, ...extra }); },
        placeTrap(x, y) { world.setFlag(x, y, FLAG.TRAP, true); },
        placeDoor(x, y, orient = 0) {
            world.setTile(x, y, TILE.DOOR, 0);
            world.setFlag(x, y, FLAG.DOOR, true);
            game.doors.push({ x, y, open: false, orient });
            game.computeFOV(); afterAction();
        },
        setWall(x, y, on) {
            if (on === undefined) on = true;
            world.setTile(x, y, on ? TILE.WALL : TILE.FLOOR, 0);
            world.setFlag(x, y, FLAG.WALL, on);
            world.setFlag(x, y, FLAG.OPEN, !on);
            if (on) world.setElevation(x, y, 4);
            else world.setElevation(x, y, 0);
            game.computeFOV(); afterAction();
        },
        // Carve an open elev-0 arena rectangle (for behaviour tests).
        carve(x0, y0, x1, y1) {
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    world.setTile(x, y, TILE.FLOOR, 0);
                    world.setElevation(x, y, 0);
                    world.setFlag(x, y, 0xFF, false);
                    world.setFlag(x, y, FLAG.OPEN, true);
                }
            }
            game.computeFOV(); afterAction();
        },
        descend() { game.descend(); syncAfterLoad(); },
        refresh() { afterAction(); },
    },
};
