// app.js — HexFront wiring: scene/camera setup, click handling, the
// select/move/attack state machine, AI turn pacing, HUD, and save/load keys.

import { createGame, UNIT_TYPES, FLAG_WATER } from '/app/game.js';

const canvas = document.getElementById('game');
const scene = canvas.getContext('scene');

scene.setToneMap({ mode: 'aces', exposure: 1.05, gamma: 2.2 });
scene.setAmbient([0.16, 0.17, 0.20]);
scene.createLight({
    type: 'directional',
    direction: [-0.45, -1.0, -0.35],
    color: [1.0, 0.96, 0.88],
    intensity: 2.6,
});

const game = createGame(scene);
const world = game.world;

// ---------------------------------------------------------------------------
// Camera — fixed isometric-style framing of the whole map (orthographic +
// tilt). worldBounds() is topology-aware, so the hex grid's ragged edge is
// framed correctly without hand-tuned constants.
// ---------------------------------------------------------------------------

function frameCamera() {
    const b = world.worldBounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const size = Math.max(spanZ * 0.92 + 2.2, (spanX + 1.5) / aspect);
    scene.setCamera({
        mode: 'orthographic',
        size, aspect, near: 0.1, far: 200,
        position: [cx + 6, 26, cz + 20],
        target: [cx, 0, cz],
    });
}
frameCamera();
window.addEventListener('resize', frameCamera);

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const el = id => document.getElementById(id);
const hudTurn = el('hud-turn'), hudSide = el('hud-side'), hudAi = el('hud-ai');
const unitPanel = el('unit-panel');
const banner = el('banner'), bannerText = el('banner-text');

function updateHUD() {
    hudTurn.textContent = 'TURN ' + game.turn.number;
    const red = game.turn.side === 'red';
    hudSide.textContent = red ? 'RED MOVES' : 'BLUE MOVES';
    hudSide.className = red ? 'side-red' : 'side-blue';
    hudAi.style.display = aiRunning ? '' : 'none';

    const u = sel ? sel.unit : null;
    unitPanel.style.display = u ? '' : 'none';
    if (u) {
        const t = UNIT_TYPES[u.type];
        el('unit-name').textContent = t.name + ' (' + u.side.toUpperCase() + ')';
        el('unit-hp').textContent = u.hp + ' / ' + t.hp;
        el('unit-atk').textContent = t.atk;
        el('unit-move').textContent = t.move;
        el('unit-range').textContent = t.rangeMin === t.rangeMax
            ? String(t.rangeMax) : t.rangeMin + '-' + t.rangeMax;
        el('unit-terrain').textContent = game.tileName(u.x, u.y);
        el('unit-hint').textContent = sel.phase === 'attack'
            ? 'Pick a target — or click elsewhere to hold position.'
            : 'Blue cells: move. Red-lit enemies: attack.';
    }
}

function showBanner(winner) {
    banner.style.display = '';
    banner.className = winner === 'red' ? 'victory' : 'defeat';
    bannerText.textContent = winner === 'red' ? 'VICTORY' : 'DEFEAT';
    game.clearHighlights();
}

let toastTimer = null;
function toast(msg) {
    let t = el('toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1600);
}

// Floating damage numbers: tiny HTML billboards anchored above the defender,
// destroyed shortly after.
function damagePopup(unit, text, color) {
    const p = world.cellCenterWorldXZ(unit.x, unit.y);
    let topY = world.sampleHeight(p.x, p.z);
    if (topY === null) topY = 0;
    const node = scene.createHtmlNode({
        width: 80, height: 30, pxPerUnit: 60,
        worldAnchor: [p.x, topY + 1.5, p.z], billboard: 'full',
        html: '<div style="color:' + color + ';font:bold 22px monospace;text-align:center;' +
              'text-shadow:0 1px 3px #000">' + text + '</div>',
    });
    let rise = 0;
    const iv = setInterval(() => {
        rise += 0.06;
        node.worldAnchor = [p.x, topY + 1.5 + rise, p.z];
        if (rise > 0.6) { clearInterval(iv); node.destroy(); }
    }, 50);
}

game.onCombat = (info) => {
    damagePopup(info.defender, '-' + info.damage, '#ffd75e');
    if (info.counterDamage > 0)
        setTimeout(() => damagePopup(info.attacker, '-' + info.counterDamage, '#8fd0ff'), 250);
};
game.onGameOver = showBanner;

// ---------------------------------------------------------------------------
// Selection state machine
// ---------------------------------------------------------------------------

let sel = null;        // { unit, phase: 'move'|'attack', reach: Map, targets: [] }
let busy = false;      // input locked during move animation
let aiRunning = false;

function refreshHighlights() {
    game.clearHighlights();
    if (!sel) return;
    const u = sel.unit;
    if (sel.phase === 'move') {
        const cells = [];
        for (const c of sel.reach.values())
            if (!game.unitAt(c.x, c.y)) cells.push(c);
        game.highlight(cells, 0.45, 0.70, 1.55);
        game.highlight(sel.targets.map(t => ({ x: t.x, y: t.y })), 1.9, 0.30, 0.30);
    } else {
        game.highlight(sel.targets.map(t => ({ x: t.x, y: t.y })), 1.9, 0.30, 0.30);
    }
    game.highlight([{ x: u.x, y: u.y }], 1.6, 1.45, 0.45);
}

function select(unit) {
    sel = {
        unit, phase: 'move',
        reach: game.reachable(unit),
        targets: game.attackTargets(unit),
    };
    refreshHighlights();
    updateHUD();
}

function deselect() {
    sel = null;
    game.clearHighlights();
    updateHUD();
}

function finishUnit(unit) {
    unit.acted = true;
    game.sync();
    deselect();
}

function doMove(unit, tx, ty) {
    const path = game.routeTo(unit, tx, ty);
    if (!path.length) return;
    busy = true;
    game.clearHighlights();
    game.moveUnitAlong(unit, path, 70, () => {
        busy = false;
        const targets = game.attackTargets(unit);
        if (targets.length) {
            sel = { unit, phase: 'attack', reach: new Map(), targets };
            refreshHighlights();
            updateHUD();
        } else {
            finishUnit(unit);
        }
    });
}

function doAttack(att, def) {
    game.attack(att, def);
    if (att.alive) finishUnit(att); else deselect();
}

// Shared by real mouse clicks and the test harness: act on a picked cell.
function actOnCell(x, y) {
    if (game.turn.over || game.turn.side !== 'red' || busy || aiRunning) return;
    const u = game.unitAt(x, y);

    if (!sel) {
        if (u && u.side === 'red' && !u.acted) select(u);
        return;
    }

    if (sel.phase === 'move') {
        if (u === sel.unit) { deselect(); return; }
        if (u && u.side === 'blue' && sel.targets.includes(u)) { doAttack(sel.unit, u); return; }
        if (u && u.side === 'red') { if (!u.acted) select(u); else deselect(); return; }
        const key = x + ',' + y;
        if (!u && sel.reach.has(key)) { doMove(sel.unit, x, y); return; }
        deselect();
    } else {  // attack phase (after moving)
        if (u && u.side === 'blue' && sel.targets.includes(u)) { doAttack(sel.unit, u); return; }
        finishUnit(sel.unit);   // clicked elsewhere: hold position
    }
}

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const ray = scene.unprojectLocal(e.clientX - rect.left, e.clientY - rect.top);
    if (!ray) return;
    const hit = world.raycastCell(ray.origin, ray.dir, 500);
    if (!hit) { if (sel && sel.phase === 'move') deselect(); return; }
    actOnCell(hit.x, hit.y);
});

// ---------------------------------------------------------------------------
// Turn flow + AI pacing
// ---------------------------------------------------------------------------

function endTurn() {
    if (game.turn.over || game.turn.side !== 'red' || busy || aiRunning) return;
    deselect();
    game.beginBlueTurn();
    aiRunning = true;
    updateHUD();
    const queue = game.aliveUnits('blue');
    let i = 0;
    const step = () => {
        if (game.turn.over) { aiRunning = false; updateHUD(); return; }
        if (i >= queue.length) {
            aiRunning = false;
            game.beginRedTurn();
            updateHUD();
            return;
        }
        const unit = queue[i++];
        if (unit.alive) game.aiAct(unit);
        setTimeout(step, 260);
    };
    setTimeout(step, 260);
}

function saveGame() {
    if (game.save()) toast('Game saved');
}
function loadGame() {
    if (busy || aiRunning) return;
    if (game.load()) {
        deselect();
        banner.style.display = game.turn.over ? '' : 'none';
        if (game.turn.over) showBanner(game.turn.winner);
        toast('Game loaded');
        updateHUD();
    } else {
        toast('No save found');
    }
}

el('btn-endturn').addEventListener('click', endTurn);
el('btn-save').addEventListener('click', saveGame);
el('btn-load').addEventListener('click', loadGame);

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'e') endTurn();
    else if (k === 's') saveGame();
    else if (k === 'l') loadGame();
    else if (k === 'escape' && sel && sel.phase === 'move') deselect();
});

updateHUD();

// ---------------------------------------------------------------------------
// Test / debug surface (used by test.js — also handy in the headless REPL)
// ---------------------------------------------------------------------------

// Project a cell's top-surface centre to viewport CSS pixels (for driving
// real click() picking in headless tests).
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

window.HEXFRONT = {
    game, world, scene,
    projectCell,
    actOnCell,
    endTurn,
    saveGame, loadGame,
    get selection() { return sel; },
    get busy() { return busy; },
    get aiRunning() { return aiRunning; },
    FLAG_WATER,
    debug: {
        place(unit, x, y) { unit.x = x; unit.y = y; game.sync(); },
        setHp(unit, hp) { unit.hp = hp; game.sync(); },
        resetActed(side) { for (const u of game.aliveUnits(side)) u.acted = false; game.sync(); },
    },
};
