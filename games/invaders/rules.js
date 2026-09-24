// Invaders rules — the formation, shields, bullets, UFO and lives as plain
// data in view pixels. No DOM, audio or drawing.
//
// createInvaders(w, h) builds a field; step(field, dt, controls) advances it
// with controls = { left, right, fire } (booleans; fire is a fresh press).
// What happened goes onto field.events for the plugin:
//   shoot · shield {x,y,enemy} · cancel {x,y} · kill {x,y,type} · ufo {x,y,points}
//   ufoarrive · march {phase} · die {x,y} · wave {wave} · gameover

export const ROWS = 5;
export const COLS = 11;
export const ENEMY_W = 32;
export const ENEMY_H = 22;
const ENEMY_HGAP = 14;
const ENEMY_VGAP = 14;
const ENEMY_DROP = 18;

export const PLAYER_W = 42;
export const PLAYER_H = 18;
const PLAYER_SPEED = 320;           // px/s
const PLAYER_BULLET_SPEED = 560;
const ENEMY_BULLET_SPEED = 240;
const MAX_ENEMY_BULLETS = 3;
const SIDE_MARGIN = 20;

export const SHIELD_COUNT = 4;
export const SHIELD_W = 72;
export const SHIELD_H = 44;
export const SHIELD_CELL = 4;
export const SHIELD_COLS = SHIELD_W / SHIELD_CELL;   // 18
export const SHIELD_ROWS = SHIELD_H / SHIELD_CELL;   // 11

export const UFO_W = 40;
export const UFO_H = 16;
const UFO_POINTS = [50, 100, 150, 300];

export const DIE_MS = 1200;
export const LIVES = 3;

/** Points per invader type: 0 back row (squid), 1 middle (crab), 2 front (octopus). */
export const POINTS = [30, 20, 10];

export function createInvaders(width, height, rng = Math.random) {
    const field = {
        W: width,
        H: height,
        rng,
        score: 0,
        wave: 1,
        lives: LIVES,
        phase: "playing",         // "playing" | "dying" | "over"
        player: { x: 0, y: 0, alive: true, dieTimer: 0 },
        bullet: null,
        enemies: [],
        enemyDir: 1,
        stepInterval: 700,
        stepTimer: 0,
        marchPhase: 0,
        enemyBullets: [],
        fireTimer: 0,
        fireInterval: 900,
        ufo: null,
        ufoTimer: 12000 + rng() * 8000,
        shields: [],
        events: [],
    };
    buildShields(field);
    buildFormation(field);
    resetPlayer(field);
    return field;
}

// ── Setup ────────────────────────────────────────────────────────────────

/** An 18x11 shield grid with rounded top corners and a notch underneath. */
export function buildShield(x, y) {
    const grid = [];
    const mid = SHIELD_COLS / 2;
    for (let r = 0; r < SHIELD_ROWS; r++) {
        const row = [];
        for (let c = 0; c < SHIELD_COLS; c++) {
            let on = true;
            if (r >= SHIELD_ROWS - 4 && Math.abs(c - mid + 0.5) < 3 - (SHIELD_ROWS - 1 - r) * 0.8) on = false;
            if (r < 2 && (c < 1 || c > SHIELD_COLS - 2)) on = false;
            row.push(on);
        }
        grid.push(row);
    }
    return { x, y, grid };
}

function buildShields(field) {
    const span = field.W - 120;
    const gap = (span - SHIELD_W * SHIELD_COUNT) / (SHIELD_COUNT - 1);
    field.shields = [];
    for (let i = 0; i < SHIELD_COUNT; i++) {
        // Whole-pixel origins so the 4 px cells draw without seams.
        field.shields.push(buildShield(Math.round(60 + i * (SHIELD_W + gap)), Math.round(field.H - 170)));
    }
}

function buildFormation(field) {
    const gridW = COLS * ENEMY_W + (COLS - 1) * ENEMY_HGAP;
    const startX = (field.W - gridW) / 2;
    const startY = 100 + Math.min(60, (field.wave - 1) * 12);
    field.enemies = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            field.enemies.push({
                col: c,
                row: r,
                x: startX + c * (ENEMY_W + ENEMY_HGAP),
                y: startY + r * (ENEMY_H + ENEMY_VGAP),
                alive: true,
                type: r === 0 ? 0 : r <= 2 ? 1 : 2,
            });
        }
    }
    field.enemyDir = 1;
    field.stepTimer = 0;
    field.marchPhase = 0;
    field.enemyBullets = [];
    field.fireTimer = 0;
    field.fireInterval = Math.max(280, 950 - (field.wave - 1) * 80);
    field.stepInterval = marchInterval(field);
}

function resetPlayer(field) {
    const p = field.player;
    p.x = field.W / 2 - PLAYER_W / 2;
    p.y = field.H - 70;
    p.alive = true;
    p.dieTimer = 0;
    field.bullet = null;
}

/** The march speeds up as the formation thins and with each wave. */
export function marchInterval(field) {
    const alive = aliveCount(field);
    const base = Math.max(220, 760 - (field.wave - 1) * 60);
    return Math.max(40, base * (0.15 + (alive / (ROWS * COLS)) * 0.85));
}

export function aliveCount(field) {
    let n = 0;
    for (const e of field.enemies) if (e.alive) n++;
    return n;
}

// ── Step ─────────────────────────────────────────────────────────────────

export function step(field, dt, controls) {
    if (field.phase === "over") return;
    if (field.phase === "dying") {
        stepDying(field, dt);
        return;
    }

    if (controls.fire) fire(field);
    movePlayer(field, dt, controls);
    stepPlayerBullet(field, dt);
    if (stepEnemyBullets(field, dt)) return;

    field.stepTimer += dt;
    if (field.stepTimer >= field.stepInterval) {
        field.stepTimer = 0;
        march(field);
        if (field.phase !== "playing") return;
    }

    stepEnemyFire(field, dt);
    stepUfo(field, dt);

    if (aliveCount(field) === 0) nextWave(field);
}

function stepDying(field, dt) {
    field.player.dieTimer -= dt;
    if (field.player.dieTimer > 0) return;
    field.lives = Math.max(0, field.lives - 1);
    if (field.lives <= 0) {
        field.phase = "over";
        field.events.push({ type: "gameover" });
        return;
    }
    resetPlayer(field);
    field.phase = "playing";
}

function movePlayer(field, dt, controls) {
    const p = field.player;
    const dir = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
    p.x += dir * PLAYER_SPEED * dt / 1000;
    p.x = Math.max(SIDE_MARGIN, Math.min(field.W - SIDE_MARGIN - PLAYER_W, p.x));
}

/** One shot on screen at a time. */
export function fire(field) {
    const p = field.player;
    if (!p.alive || field.bullet) return false;
    field.bullet = { x: p.x + PLAYER_W / 2, y: p.y, vy: -PLAYER_BULLET_SPEED };
    field.events.push({ type: "shoot" });
    return true;
}

function stepPlayerBullet(field, dt) {
    const b = field.bullet;
    if (!b) return;
    b.y += b.vy * dt / 1000;
    if (b.y < 0) {
        field.bullet = null;
        return;
    }
    if (shieldHit(field, b.x, b.y)) {
        field.bullet = null;
        field.events.push({ type: "shield", x: b.x, y: b.y, enemy: false });
        return;
    }
    const u = field.ufo;
    if (u && b.x >= u.x && b.x <= u.x + UFO_W && b.y >= u.y && b.y <= u.y + UFO_H) {
        field.score += u.points;
        field.events.push({ type: "ufo", x: u.x + UFO_W / 2, y: u.y + UFO_H / 2, points: u.points });
        field.ufo = null;
        field.bullet = null;
        return;
    }
    for (const e of field.enemies) {
        if (!e.alive) continue;
        if (b.x >= e.x && b.x <= e.x + ENEMY_W && b.y >= e.y && b.y <= e.y + ENEMY_H) {
            e.alive = false;
            field.score += POINTS[e.type];
            field.events.push({ type: "kill", x: e.x + ENEMY_W / 2, y: e.y + ENEMY_H / 2, enemyType: e.type });
            field.bullet = null;
            field.stepInterval = marchInterval(field);
            return;
        }
    }
}

/** Returns true when an enemy bullet killed the player this frame. */
function stepEnemyBullets(field, dt) {
    const p = field.player;
    for (let i = field.enemyBullets.length - 1; i >= 0; i--) {
        const eb = field.enemyBullets[i];
        eb.y += eb.vy * dt / 1000;
        if (eb.y > field.H) {
            field.enemyBullets.splice(i, 1);
            continue;
        }
        if (shieldHit(field, eb.x, eb.y)) {
            field.events.push({ type: "shield", x: eb.x, y: eb.y, enemy: true });
            field.enemyBullets.splice(i, 1);
            continue;
        }
        const b = field.bullet;
        if (b && (eb.x - b.x) ** 2 + (eb.y - b.y) ** 2 < 64) {
            field.bullet = null;
            field.enemyBullets.splice(i, 1);
            field.events.push({ type: "cancel", x: eb.x, y: eb.y });
            continue;
        }
        if (p.alive && eb.x >= p.x && eb.x <= p.x + PLAYER_W && eb.y >= p.y && eb.y <= p.y + PLAYER_H) {
            field.enemyBullets.splice(i, 1);
            killPlayer(field);
            return true;
        }
    }
    return false;
}

/** One march beat: sideways, or down and reverse at an edge. */
function march(field) {
    let left = Infinity, right = -Infinity;
    for (const e of field.enemies) {
        if (!e.alive) continue;
        left = Math.min(left, e.x);
        right = Math.max(right, e.x + ENEMY_W);
    }
    if (!isFinite(left)) return;

    const dx = 10 + (field.wave - 1);
    let dir = field.enemyDir;
    let drop = false;
    if (dir > 0 && right + dx > field.W - SIDE_MARGIN) { drop = true; dir = -1; }
    else if (dir < 0 && left - dx < SIDE_MARGIN) { drop = true; dir = 1; }

    for (const e of field.enemies) {
        if (!e.alive) continue;
        if (drop) e.y += ENEMY_DROP;
        else e.x += dir * dx;
    }
    field.enemyDir = dir;
    field.marchPhase = 1 - field.marchPhase;
    field.events.push({ type: "march", phase: field.marchPhase });

    // Reaching the player's line ends the game outright.
    for (const e of field.enemies) {
        if (e.alive && e.y + ENEMY_H >= field.player.y) {
            field.lives = 0;
            killPlayer(field);
            return;
        }
    }
}

function stepEnemyFire(field, dt) {
    field.fireTimer += dt;
    if (field.fireTimer < field.fireInterval) return;
    field.fireTimer = 0;
    field.fireInterval = Math.max(200, 400 + field.rng() * (900 - (field.wave - 1) * 40));
    if (field.enemyBullets.length < MAX_ENEMY_BULLETS) enemyFire(field);
}

/** The lowest invader of a random column fires. */
function enemyFire(field) {
    const lowest = new Map();
    for (const e of field.enemies) {
        if (!e.alive) continue;
        const cur = lowest.get(e.col);
        if (!cur || e.y > cur.y) lowest.set(e.col, e);
    }
    const shooters = Array.from(lowest.values());
    if (!shooters.length) return;
    const s = shooters[Math.floor(field.rng() * shooters.length)];
    field.enemyBullets.push({
        x: s.x + ENEMY_W / 2,
        y: s.y + ENEMY_H,
        vy: ENEMY_BULLET_SPEED + (field.wave - 1) * 10,
    });
}

function stepUfo(field, dt) {
    const u = field.ufo;
    if (u) {
        u.x += u.vx * dt / 1000;
        if ((u.vx > 0 && u.x > field.W + 40) || (u.vx < 0 && u.x < -40)) field.ufo = null;
        return;
    }
    field.ufoTimer -= dt;
    if (field.ufoTimer <= 0) spawnUfo(field);
}

function spawnUfo(field) {
    field.ufoTimer = 15000 + field.rng() * 10000;
    const fromLeft = field.rng() < 0.5;
    field.ufo = {
        x: fromLeft ? -30 : field.W + 30,
        y: 70,
        vx: fromLeft ? 140 : -140,
        points: UFO_POINTS[Math.floor(field.rng() * UFO_POINTS.length)],
    };
    field.events.push({ type: "ufoarrive" });
}

function killPlayer(field) {
    const p = field.player;
    if (!p.alive) return;
    p.alive = false;
    p.dieTimer = DIE_MS;
    field.phase = "dying";
    field.events.push({ type: "die", x: p.x + PLAYER_W / 2, y: p.y + PLAYER_H / 2 });
}

function nextWave(field) {
    field.wave += 1;
    field.bullet = null;
    field.ufo = null;
    buildShields(field);
    buildFormation(field);
    resetPlayer(field);
    field.phase = "playing";
    field.events.push({ type: "wave", wave: field.wave });
}

/** Carve a crater where (px, py) hits solid shield; true if it did. */
export function shieldHit(field, px, py) {
    for (const s of field.shields) {
        if (px < s.x || px > s.x + SHIELD_W || py < s.y || py > s.y + SHIELD_H) continue;
        const cc = Math.floor((px - s.x) / SHIELD_CELL);
        const cr = Math.floor((py - s.y) / SHIELD_CELL);
        if (cr < 0 || cr >= SHIELD_ROWS || cc < 0 || cc >= SHIELD_COLS || !s.grid[cr][cc]) continue;
        for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
                const r = cr + dr, c = cc + dc;
                if (r >= 0 && r < SHIELD_ROWS && c >= 0 && c < SHIELD_COLS && Math.abs(dr) + Math.abs(dc) <= 3) {
                    s.grid[r][c] = false;
                }
            }
        }
        return true;
    }
    return false;
}

export function drainEvents(field) {
    const out = field.events;
    field.events = [];
    return out;
}
