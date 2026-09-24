// Missile Command rules — cities, silos, falling ICBMs, counter-missiles and
// chaining explosions, in view pixels and seconds. No DOM, audio or drawing.
//
// createDefense(w, h) builds the battlefield and starts wave 1. The plugin
// calls launch(d, x, y) on a click and step(d, dt) every frame. Events on
// d.events: launch · explode {x,y,enemy} · cityhit · silohit · wavecleared
// {summary} · gameover. After wavecleared the plugin shows its screen and
// calls nextWave(d) to go on.

export const NUM_CITIES = 6;
export const NUM_SILOS = 3;
export const AMMO_PER_SILO = 10;
export const GROUND_FRAC = 0.88;       // ground line, fraction of height
const SILO_FRAC = 0.85;
const CITY_FRAC = 0.88;
export const MAX_BLAST_R = 48;
const BLAST_GROW = 140;                // px/s
const BLAST_SHRINK = 60;               // px/s
export const MISSILE_SPEED = 520;      // px/s
export const BOMB_SCORE = 25;
export const CITY_BONUS = 100;
export const AMMO_BONUS = 5;
const CITY_HIT_X = 22;
const SILO_HIT_X = 28;
const SILO_HIT_Y = 40;
const WAVE_SECONDS = 28;
const CLEAR_DELAY = 0.8;               // s after the last blast before wavecleared
const LOSS_DELAY = 1.5;                // s after the last city before gameover

export function createDefense(width, height, rng = Math.random) {
    const W = width, H = height;
    const d = {
        W, H, rng,
        groundY: H * GROUND_FRAC,
        score: 0,
        wave: 1,
        silos: [W * 0.08, W * 0.5, W * 0.92].map((x) => ({ x, y: H * SILO_FRAC, ammo: AMMO_PER_SILO, alive: true })),
        cities: [0.2, 0.28, 0.36, 0.64, 0.72, 0.8].map((f) => ({ x: W * f, y: H * CITY_FRAC, alive: true })),
        enemies: [],
        missiles: [],
        blasts: [],
        spawnTimes: [],
        spawnCursor: 0,
        clock: 0,
        endTimer: 0,
        phase: "playing",      // "playing" | "cleared" | "over"
        summary: null,
        events: [],
    };
    beginWave(d);
    return d;
}

/** Refill live silos and schedule 10 + 4·wave ICBMs over the wave. */
export function beginWave(d) {
    for (const s of d.silos) if (s.alive) s.ammo = AMMO_PER_SILO;
    const count = 10 + d.wave * 4;
    d.spawnTimes = [];
    for (let k = 0; k < count; k++) d.spawnTimes.push(d.rng() * WAVE_SECONDS * 0.85);
    d.spawnTimes.sort((a, b) => a - b);
    d.spawnCursor = 0;
    d.clock = 0;
    d.endTimer = 0;
    d.enemies = [];
    d.missiles = [];
    d.blasts = [];
    d.phase = "playing";
    d.summary = null;
}

/** After the wave-complete screen: next wave. */
export function nextWave(d) {
    d.wave++;
    beginWave(d);
}

export function enemySpeed(wave) {
    return Math.min(140, 40 + wave * 8);
}

export const citiesLeft = (d) => d.cities.filter((c) => c.alive).length;

// ── Player fire ──────────────────────────────────────────────────────────

/** Fire from the nearest silo with ammo toward (x, y), clamped above the ground. */
export function launch(d, x, y) {
    if (d.phase !== "playing") return false;
    const ty = Math.min(y, d.groundY - 8);
    let best = null, bestD = Infinity;
    for (const s of d.silos) {
        if (!s.alive || s.ammo <= 0) continue;
        const dist = (s.x - x) ** 2 + (s.y - ty) ** 2;
        if (dist < bestD) { bestD = dist; best = s; }
    }
    if (!best) return false;
    best.ammo--;
    const dx = x - best.x, dy = ty - best.y;
    const len = Math.hypot(dx, dy) || 1;
    d.missiles.push({
        sx: best.x, sy: best.y, x: best.x, y: best.y, tx: x, ty,
        vx: dx / len * MISSILE_SPEED, vy: dy / len * MISSILE_SPEED, alive: true,
    });
    d.events.push({ type: "launch" });
    return true;
}

// ── Step ─────────────────────────────────────────────────────────────────

/** dt in ms. */
export function step(d, dt) {
    if (d.phase !== "playing") return;
    const ds = dt / 1000;
    d.clock += ds;
    while (d.spawnCursor < d.spawnTimes.length && d.spawnTimes[d.spawnCursor] <= d.clock) {
        spawnEnemy(d);
        d.spawnCursor++;
    }
    stepEnemies(d, ds);
    stepMissiles(d, ds);
    stepBlasts(d, ds);
    d.enemies = d.enemies.filter((e) => e.alive);
    d.missiles = d.missiles.filter((m) => m.alive);
    d.blasts = d.blasts.filter((b) => b.alive);

    if (citiesLeft(d) === 0) {
        d.endTimer += ds;
        if (d.endTimer > LOSS_DELAY) {
            d.phase = "over";
            d.events.push({ type: "gameover" });
        }
        return;
    }
    if (waveDone(d)) {
        d.endTimer += ds;
        if (d.endTimer > CLEAR_DELAY) completeWave(d);
    }
}

function waveDone(d) {
    return d.spawnCursor >= d.spawnTimes.length && !d.enemies.length && !d.missiles.length && !d.blasts.length;
}

function targets(d) {
    return d.cities.concat(d.silos).filter((t) => t.alive);
}

function aimEnemy(d, x, y, split) {
    const list = targets(d);
    if (!list.length) return null;
    const t = list[Math.floor(d.rng() * list.length)];
    const dx = t.x - x, dy = t.y - y;
    const len = Math.hypot(dx, dy) || 1;
    const sp = enemySpeed(d.wave);
    return { x, y, sx: x, sy: y, tx: t.x, ty: t.y, vx: dx / len * sp, vy: dy / len * sp, alive: true, splitAt: split };
}

// From wave 3 some ICBMs split in two partway down.
function spawnEnemy(d) {
    const splitChance = Math.min(0.05 + d.wave * 0.02, 0.35);
    const split = d.wave >= 3 && d.rng() < splitChance ? 0.25 + d.rng() * 0.35 : -1;
    const e = aimEnemy(d, d.rng() * d.W, 0, split);
    if (e) d.enemies.push(e);
}

function stepEnemies(d, ds) {
    for (const e of d.enemies.slice()) {
        if (!e.alive) continue;
        e.x += e.vx * ds;
        e.y += e.vy * ds;
        if (e.splitAt > 0 && e.y / (e.ty || 1) >= e.splitAt) {
            e.alive = false;
            for (let k = 0; k < 2; k++) {
                const child = aimEnemy(d, e.x, e.y, -1);
                if (child) d.enemies.push(child);
            }
            continue;
        }
        if (e.y >= e.ty || e.y >= d.groundY) {
            e.alive = false;
            impact(d, e);
        }
    }
}

// A ground hit takes out a city or silo under it, else just scorches.
function impact(d, e) {
    for (const c of d.cities) {
        if (c.alive && Math.abs(c.x - e.x) < CITY_HIT_X) {
            c.alive = false;
            d.events.push({ type: "cityhit" });
            blast(d, c.x, c.y, true);
            return;
        }
    }
    for (const s of d.silos) {
        if (s.alive && Math.abs(s.x - e.x) < SILO_HIT_X && Math.abs(e.y - s.y) < SILO_HIT_Y) {
            s.alive = false;
            s.ammo = 0;
            d.events.push({ type: "silohit" });
            blast(d, s.x, s.y, true);
            return;
        }
    }
    blast(d, e.x, d.groundY, true);
}

function stepMissiles(d, ds) {
    for (const m of d.missiles) {
        if (!m.alive) continue;
        m.x += m.vx * ds;
        m.y += m.vy * ds;
        const passedX = m.vx >= 0 ? m.x >= m.tx : m.x <= m.tx;
        const passedY = m.vy >= 0 ? m.y >= m.ty : m.y <= m.ty;
        if ((passedX && passedY) || (m.tx - m.x) ** 2 + (m.ty - m.y) ** 2 < 25) {
            m.alive = false;
            blast(d, m.tx, m.ty, false);
        }
    }
}

function blast(d, x, y, enemy) {
    d.blasts.push({ x, y, r: 2, growing: true, alive: true, enemy });
    d.events.push({ type: "explode", x, y, enemy });
}

// Blasts grow then shrink; any ICBM inside one blows up too (chains).
// Only player-made blasts score.
function stepBlasts(d, ds) {
    for (let i = 0; i < d.blasts.length; i++) {
        const b = d.blasts[i];
        if (!b.alive) continue;
        if (b.growing) {
            b.r = Math.min(MAX_BLAST_R, b.r + BLAST_GROW * ds);
            if (b.r >= MAX_BLAST_R) b.growing = false;
        } else {
            b.r -= BLAST_SHRINK * ds;
            if (b.r <= 0) { b.r = 0; b.alive = false; continue; }
        }
        for (const e of d.enemies) {
            if (!e.alive || (e.x - b.x) ** 2 + (e.y - b.y) ** 2 > b.r * b.r) continue;
            e.alive = false;
            if (!b.enemy) d.score += BOMB_SCORE;
            blast(d, e.x, e.y, false);
        }
    }
}

/** Bonus for surviving cities and unused missiles; rebuild a city every 2nd wave. */
function completeWave(d) {
    const cities = citiesLeft(d);
    let ammo = 0;
    for (const s of d.silos) if (s.alive) ammo += s.ammo;
    const summary = { cities, ammo, cityBonus: cities * CITY_BONUS, ammoBonus: ammo * AMMO_BONUS };
    d.score += summary.cityBonus + summary.ammoBonus;
    if (d.wave % 2 === 0) {
        const ruin = d.cities.find((c) => !c.alive);
        if (ruin) ruin.alive = true;
    }
    d.summary = summary;
    d.phase = "cleared";
    d.events.push({ type: "wavecleared", summary });
}

export function drainEvents(d) {
    const out = d.events;
    d.events = [];
    return out;
}
