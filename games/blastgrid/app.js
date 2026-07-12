// app.js — BlastGrid shell: scene/camera/lighting, keyboard input, per-frame
// render sync (bombers / bombs / fire / power-ups as TileWorld object
// instances), blast tint flashes + light flash, HTML HUD, frame loop.

import {
    createGame, TILE, ROSTER, SPAWNS, POWER_TYPES,
    FLAG_SOLID, FLAG_SOFT, FLAG_BOMB, FLAG_DANGER,
    MAP_W, MAP_H, HSTEP, FUSE, FIRE_LINGER, WINS_TARGET,
    BASE_RANGE, BASE_BOMBS, BASE_SPEED, SPEED_STEP,
} from '/app/game.js';

const canvas = document.getElementById('game');
const scene = canvas.getContext('scene');

scene.setToneMap({ mode: 'aces', exposure: 1.0, gamma: 2.2 });
scene.setAmbient([0.22, 0.23, 0.27]);
scene.createLight({
    type: 'directional',
    direction: [-0.45, -1.0, -0.35],
    color: [1.0, 0.96, 0.88],
    intensity: 2.0,
});

const game = createGame(scene);
const world = game.world;

// One reusable point light, flashed on every blast.
const flashLight = scene.createLight({
    type: 'point', position: [0, 1.4, 0],
    color: [1.0, 0.72, 0.38], intensity: 0, range: 7,
});
let flashT = 0;
const FLASH_DUR = 0.28;

// ---------------------------------------------------------------------------
// Camera — perspective, gently tilted, whole arena framed.
// ---------------------------------------------------------------------------

function frameCamera() {
    const b = world.worldBounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const fovDeg = 42, fov = fovDeg * Math.PI / 180;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    // Fit the tilted depth vertically and the width horizontally.
    const distV = (spanZ * 0.60 + 1.8) / Math.tan(fov / 2);
    const distH = (spanX * 0.54 + 1.2) / (Math.tan(fov / 2) * aspect);
    const dist = Math.max(distV, distH);
    const pitch = 58 * Math.PI / 180;                     // from horizontal
    scene.setCamera({
        fov: fovDeg, aspect, near: 0.1, far: 200,
        position: [cx, Math.sin(pitch) * dist, cz + Math.cos(pitch) * dist],
        target: [cx, 0, cz - 0.4],
    });
}
frameCamera();
window.addEventListener('resize', frameCamera);

// ---------------------------------------------------------------------------
// Object kinds
// ---------------------------------------------------------------------------

const K = {};
{
    // Bomber: rounded body + head + nose (authored facing +Z), per-instance color.
    K.bomber = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.26, 14, 10).translate(0, 0.30, 0),
            Mesh.sphere(0.16, 12, 8).translate(0, 0.60, 0),
            Mesh.box(0.05, 0.05, 0.05).translate(0, 0.60, 0.16),
            Mesh.box(0.09, 0.06, 0.13).translate(-0.11, 0.05, 0),
            Mesh.box(0.09, 0.06, 0.13).translate(0.11, 0.05, 0),
        ]),
        { color: [1, 1, 1, 1], roughness: 0.75 });

    // Bomb: black orb + fuse nub; pulse + red flush via per-instance color/scale.
    K.bomb = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.235, 14, 10).translate(0, 0.24, 0),
            Mesh.cylinder(0.045, 0.10, 6).translate(0, 0.50, 0),
        ]),
        { color: [1, 1, 1, 1], roughness: 0.45, metallic: 0.25 });

    // Fire: bright plume (no shadow so the cross stays readable).
    K.fire = world.addObjectKind(
        Mesh.merge([
            Mesh.cone(0.32, 0.62, 8, 1, false).translate(0, 0.02, 0),
            Mesh.sphere(0.20, 10, 7).translate(0, 0.14, 0),
        ]),
        { color: [1.0, 0.52, 0.10, 1], roughness: 0.35, castsShadow: false });

    // Power-ups: shape + color coded, spinning + bobbing.
    K.pBombs = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.16, 12, 8).translate(0, 0.16, 0),
            Mesh.cylinder(0.035, 0.08, 6).translate(0, 0.36, 0),
        ]),
        { color: [0.30, 0.55, 1.0, 1], roughness: 0.4, metallic: 0.2 });
    K.pRange = world.addObjectKind(
        Mesh.cone(0.17, 0.36, 8, 1, false).translate(0, 0.04, 0),
        { color: [1.0, 0.45, 0.10, 1], roughness: 0.4 });
    K.pSpeed = world.addObjectKind(
        Mesh.torus(0.15, 0.055, 14, 8).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.20, 0),
        { color: [0.15, 0.95, 0.85, 1], roughness: 0.35, metallic: 0.3 });

    world.rebuildObjects();
}
const PU_KIND = { bombs: K.pBombs, range: K.pRange, speed: K.pSpeed };

// ---------------------------------------------------------------------------
// Tint compositor — one desired-tint map, diffed against what's applied.
// (No world.getTint, so JS owns the state; base is plain white.)
// ---------------------------------------------------------------------------

let applied = new Map();       // "x,y" -> [r,g,b]

function desiredTints() {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + ',' + y, rgb);
    };
    // Danger preview: a whisper of red under pending blast cells.
    for (const k of game.dangerSet)
        put(k % MAP_W, (k / MAP_W) | 0, [1.18, 0.94, 0.88]);
    // Fire: hot orange fading to white as it burns out (quantized so the
    // remesh only runs a handful of times per blast, not every frame).
    for (const [k, until] of game.fire) {
        const t = Math.round(Math.max(0, Math.min(1, (until - game.time) / FIRE_LINGER)) * 5) / 5;
        put(k % MAP_W, (k / MAP_W) | 0, [1 + 1.25 * t, 1 + 0.32 * t, 1 - 0.55 * t]);
    }
    // Sudden death: blink the next cell to be crushed.
    if (game.sd.active) {
        const n = game.nextSdCell();
        if (n && Math.floor(game.time * 4) % 2 === 0) put(n.x, n.y, [1.9, 0.5, 0.5]);
    }
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

// ---------------------------------------------------------------------------
// Per-frame render sync
// ---------------------------------------------------------------------------

function syncRender() {
    // Bombers — anchored to the rounded cell, sub-cell offset carries the
    // smooth glide; a light walk-bob sells the movement.
    world.clearObjects(K.bomber);
    for (const e of game.contenders) {
        if (!e.alive) continue;
        const cx = Math.round(e.px), cy = Math.round(e.py);
        const bob = e.moving ? Math.abs(Math.sin(game.time * 11 + e.i)) * 0.05 : 0;
        world.addObject(K.bomber, cx, cy, {
            yaw: e.facing,
            offsetX: e.px - cx, offsetZ: e.py - cy,
            yOffset: bob,
            color: e.color,
        });
    }

    // Bombs — pulse faster as the fuse shortens, flush red near zero.
    world.clearObjects(K.bomb);
    for (const b of game.bombs) {
        const t = 1 - Math.max(0, b.fuse) / FUSE;                 // 0 fresh -> 1 boom
        const pulse = 1 + 0.08 * Math.sin(game.time * (6 + t * 14));
        const red = Math.max(0, (t - 0.55) / 0.45);
        world.addObject(K.bomb, b.x, b.y, {
            scale: pulse,
            color: [0.14 + 0.9 * red, 0.14, 0.17, 1],
        });
    }

    // Fire — plume per cell, shrinking as it burns out.
    world.clearObjects(K.fire);
    for (const [k, until] of game.fire) {
        const x = k % MAP_W, y = (k / MAP_W) | 0;
        const t = Math.max(0, Math.min(1, (until - game.time) / FIRE_LINGER));
        const jig = 1 + 0.10 * Math.sin(game.time * 40 + x * 3.1 + y * 7.3);
        world.addObject(K.fire, x, y, {
            scale: (0.35 + 0.95 * t) * jig,
            yaw: (x * 5 + y * 11) % 6.28,
            color: [1, 0.65 + 0.35 * t, 0.35 * t, 1],
        });
    }

    // Power-ups — spin + bob.
    for (const kn of POWER_TYPES) world.clearObjects(PU_KIND[kn]);
    for (const p of game.powerups) {
        world.addObject(PU_KIND[p.type], p.x, p.y, {
            yaw: game.time * 2.6,
            scale: 1.35,
            yOffset: 0.10 + Math.sin(game.time * 3.0 + p.x + p.y) * 0.05,
        });
    }

    world.rebuildObjects();

    // Blast light flash.
    if (flashT > 0) {
        flashLight.intensity = 30 * (flashT / FLASH_DUR);
    } else if (flashLight.intensity !== 0) {
        flashLight.intensity = 0;
    }
}

game.onBlast = (blast) => {
    const c = blast.centers[0];
    const w = world.cellCenterWorldXZ(c.x, c.y);
    flashLight.position = [w.x, 1.4, w.z];
    flashT = FLASH_DUR;
};

game.onArenaReset = () => {
    // Fresh grid: every authored cell already reset to white in buildArena;
    // just drop our bookkeeping so the compositor doesn't "restore" stale cells.
    applied = new Map();
    hudCache = '';
};

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const chipEls = [];
{
    const bar = el('chips');
    for (const e of game.contenders) {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.id = 'chip-' + e.i;
        const [r, g, b] = e.color;
        chip.innerHTML =
            '<span class="dot" style="background: rgb(' +
            Math.round(r * 255) + ',' + Math.round(g * 255) + ',' + Math.round(b * 255) +
            ')"></span><span class="cname">' + e.name +
            '</span><span class="cwins"></span>';
        bar.appendChild(chip);
        chipEls.push(chip);
    }
}

let hudCache = '';
function fmtTime(s) {
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
}

function updateHUD() {
    const h = game.human;
    const sig = [
        game.contenders.map(e => e.wins + (e.alive ? 'a' : 'd')).join(''),
        Math.floor(game.timeLeft), game.sd.active, game.state, game.round,
        h.bombCap, h.range, h.speed.toFixed(2),
    ].join('|');
    if (sig === hudCache) return;
    hudCache = sig;

    for (const e of game.contenders) {
        const chip = chipEls[e.i];
        chip.classList.toggle('dead', !e.alive);
        chip.querySelector('.cwins').textContent =
            '★'.repeat(e.wins) + '·'.repeat(Math.max(0, WINS_TARGET - e.wins));
    }
    const timer = el('timer');
    if (game.sd.active) {
        timer.textContent = 'SUDDEN DEATH';
        timer.className = 'sudden';
    } else {
        timer.textContent = fmtTime(game.timeLeft);
        timer.className = game.timeLeft <= 30 ? 'low' : '';
    }
    el('round').textContent = 'ROUND ' + game.round + ' · FIRST TO ' + WINS_TARGET;
    el('powers').textContent =
        'BOMBS ' + h.bombCap + ' · RANGE ' + h.range +
        ' · SPEED ' + (1 + Math.round((h.speed - BASE_SPEED) / SPEED_STEP));

    const banner = el('banner');
    if (game.state === 'roundover' || game.state === 'matchover') {
        banner.style.display = '';
        const w = game.winner;
        const bt = el('banner-text');
        if (game.state === 'matchover') {
            bt.textContent = w.name + ' WINS THE MATCH';
            el('banner-sub').textContent =
                (w === h ? 'Champion of the grid!' : 'Better luck next time.') +
                '  ·  Enter to play again';
        } else {
            bt.textContent = w ? w.name + ' WINS THE ROUND' : 'DRAW';
            el('banner-sub').textContent = 'Enter for the next round';
        }
        if (w) {
            const [r, g, b] = w.color;
            bt.style.color = 'rgb(' + Math.round(r * 255) + ',' +
                Math.round(g * 255) + ',' + Math.round(b * 255) + ')';
        } else bt.style.color = '#fff';
    } else {
        banner.style.display = 'none';
    }
}

function announce(msg) {
    const a = el('announce');
    a.textContent = msg;
    a.style.display = '';
    a.classList.remove('pop');
    void a.offsetWidth;
    a.classList.add('pop');
    setTimeout(() => { a.style.display = 'none'; }, 2400);
}

game.onSuddenDeath = () => announce('SUDDEN DEATH — THE WALLS CLOSE IN');
game.onPickup = (e, type) => {
    if (e !== game.human) return;
    const label = { bombs: '+1 BOMB', range: '+1 RANGE', speed: '+SPEED' }[type];
    const t = el('toast');
    t.textContent = label;
    t.style.display = '';
    clearTimeout(announce._toastTimer);
    announce._toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1200);
};

// ---------------------------------------------------------------------------
// Keyboard input
// ---------------------------------------------------------------------------

const KEYDIR = {
    arrowup: 'up', w: 'up',
    arrowdown: 'down', s: 'down',
    arrowleft: 'left', a: 'left',
    arrowright: 'right', d: 'right',
};
const pressed = new Set();

function normKey(e) {
    return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
}

window.addEventListener('keydown', (e) => {
    const k = normKey(e);
    if (pressed.has(k)) return;          // ignore auto-repeat
    pressed.add(k);
    const dir = KEYDIR[k];
    if (dir) { game.pressDir(dir); return; }
    if (k === ' ') { game.dropBomb(); return; }
    if (k === 'enter') { game.proceed(); updateHUD(); return; }
});
window.addEventListener('keyup', (e) => {
    const k = normKey(e);
    pressed.delete(k);
    const dir = KEYDIR[k];
    if (dir) game.releaseDir(dir);
});
el('banner').addEventListener('click', () => { game.proceed(); updateHUD(); });

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
    flashT = Math.max(0, flashT - dt);

    applyTints();
    syncRender();
    updateHUD();
    requestAnimationFrame(frame);
}
updateHUD();
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Test / debug surface (used by test.js; handy in the headless REPL)
// ---------------------------------------------------------------------------

window.BLAST = {
    game, world, scene,
    TILE, SPAWNS, ROSTER,
    FLAG_SOLID, FLAG_SOFT, FLAG_BOMB, FLAG_DANGER,
    MAP_W, MAP_H, FUSE, FIRE_LINGER,
    BASE_RANGE, BASE_BOMBS, BASE_SPEED,
    debug: game.debug,
};
