// Asteroids rules — ship, rocks, bullets on a wrapping field, in view
// pixels and milliseconds. No DOM, audio or drawing.
//
// createAsteroids(w, h) builds a field; step(field, dt, controls) advances
// it with controls = { left, right, thrust, fire, aim } where aim is null or
// { x, y } (steer toward a point and thrust, the mouse scheme). What
// happened goes onto field.events for the plugin:
//   fire · exhaust {x,y,angle} · bang {x,y,size} · shipexplode {x,y}
//   extralife · wave {wave} · gameover

export const SHIP_ROT_SPEED = 0.005;   // rad / ms
export const SHIP_THRUST = 0.00018;    // px / ms²
export const SHIP_MAX_SPEED = 0.5;     // px / ms
const SHIP_DRAG = 0.9995;              // per ms
export const SHIP_RADIUS = 12;
export const BULLET_SPEED = 0.6;       // px / ms
export const BULLET_LIFE = 900;        // ms
export const BULLET_COOLDOWN = 160;    // ms
export const MAX_BULLETS = 5;
export const RESPAWN_DELAY = 1200;     // ms
export const INVULN_TIME = 2500;       // ms
export const EXTRA_LIFE_AT = 10000;
export const LIVES = 3;

export const SIZES = {
    large: { r: 42, score: 20, speed: 0.04, next: "medium" },
    medium: { r: 22, score: 50, speed: 0.07, next: "small" },
    small: { r: 12, score: 100, speed: 0.1, next: null },
};

export function createAsteroids(width, height, rng = Math.random) {
    const field = {
        W: width,
        H: height,
        rng,
        score: 0,
        lives: LIVES,
        wave: 0,
        ship: makeShip(width, height),
        rocks: [],
        bullets: [],
        respawnTimer: 0,
        invuln: INVULN_TIME,
        cooldown: 0,
        nextExtraLife: EXTRA_LIFE_AT,
        over: false,
        events: [],
    };
    spawnWave(field, 1);
    return field;
}

// ── Geometry ─────────────────────────────────────────────────────────────

export function wrap(v, max) {
    if (v < 0) return v + max;
    if (v >= max) return v - max;
    return v;
}

/** Squared distance on the torus (the shorter way round each axis). */
export function wrapDistSq(ax, ay, bx, by, W, H) {
    let dx = Math.abs(ax - bx);
    let dy = Math.abs(ay - by);
    if (dx > W / 2) dx = W - dx;
    if (dy > H / 2) dy = H - dy;
    return dx * dx + dy * dy;
}

/** A lumpy closed outline of 10-13 points around radius r. */
export function rockShape(r, rng = Math.random) {
    const pts = [];
    const n = 10 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (0.75 + rng() * 0.45);
        pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    return pts;
}

// ── Setup ────────────────────────────────────────────────────────────────

function makeShip(W, H) {
    return { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2, thrusting: false, alive: true };
}

export function makeRock(field, x, y, size) {
    const info = SIZES[size];
    const a = field.rng() * Math.PI * 2;
    const sp = info.speed * (0.6 + field.rng() * 0.8);
    return {
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: 0,
        rotSpeed: (field.rng() - 0.5) * 0.0015,
        radius: info.r,
        size,
        shape: rockShape(info.r, field.rng),
    };
}

/** 3 + wave large rocks (max 10), kept 180 px clear of the ship. */
export function spawnWave(field, wave) {
    field.wave = wave;
    field.rocks = [];
    const count = Math.min(10, 3 + wave);
    const cx = field.ship ? field.ship.x : field.W / 2;
    const cy = field.ship ? field.ship.y : field.H / 2;
    const safe = 180;
    for (let i = 0; i < count; i++) {
        let x, y, tries = 0;
        do {
            x = field.rng() * field.W;
            y = field.rng() * field.H;
            tries++;
        } while (tries < 20 && wrapDistSq(x, y, cx, cy, field.W, field.H) < safe * safe);
        field.rocks.push(makeRock(field, x, y, "large"));
    }
    field.events.push({ type: "wave", wave });
}

// ── Step ─────────────────────────────────────────────────────────────────

export function step(field, dt, controls) {
    if (field.over) return;
    if (field.cooldown > 0) field.cooldown -= dt;
    if (field.invuln > 0) field.invuln -= dt;

    stepShip(field, dt, controls);
    stepBullets(field, dt);
    stepRocks(field, dt);
    bulletHits(field);
    shipHits(field);

    if (field.rocks.length === 0 && !field.over) spawnWave(field, field.wave + 1);
}

function stepShip(field, dt, c) {
    const s = field.ship;
    if (!s.alive) {
        if (field.over) return;
        field.respawnTimer -= dt;
        if (field.respawnTimer <= 0) respawn(field);
        return;
    }

    if (c.aim) {
        steerToward(s, c.aim, dt);
    } else {
        if (c.left) s.angle -= SHIP_ROT_SPEED * dt;
        if (c.right) s.angle += SHIP_ROT_SPEED * dt;
    }

    s.thrusting = !!(c.aim || c.thrust);
    if (s.thrusting) {
        s.vx += Math.cos(s.angle) * SHIP_THRUST * dt;
        s.vy += Math.sin(s.angle) * SHIP_THRUST * dt;
        const sp = Math.hypot(s.vx, s.vy);
        if (sp > SHIP_MAX_SPEED) {
            s.vx = (s.vx / sp) * SHIP_MAX_SPEED;
            s.vy = (s.vy / sp) * SHIP_MAX_SPEED;
        }
        if (field.rng() < 0.6) {
            field.events.push({
                type: "exhaust",
                x: s.x - Math.cos(s.angle) * 10,
                y: s.y - Math.sin(s.angle) * 10,
                angle: s.angle,
            });
        }
    }

    const drag = Math.pow(SHIP_DRAG, dt);
    s.vx *= drag;
    s.vy *= drag;
    s.x = wrap(s.x + s.vx * dt, field.W);
    s.y = wrap(s.y + s.vy * dt, field.H);

    if (c.fire) fire(field);
}

// Turn toward the aim point at the normal rotation rate.
function steerToward(s, aim, dt) {
    const dx = aim.x - s.x, dy = aim.y - s.y;
    if (dx * dx + dy * dy <= 16) return;
    const target = Math.atan2(dy, dx);
    let diff = target - s.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = SHIP_ROT_SPEED * dt;
    if (diff > turn) s.angle += turn;
    else if (diff < -turn) s.angle -= turn;
    else s.angle = target;
}

/** Fire from the nose; limited by cooldown and bullets in flight. */
export function fire(field) {
    const s = field.ship;
    if (!s.alive || field.bullets.length >= MAX_BULLETS || field.cooldown > 0) return false;
    const nx = Math.cos(s.angle), ny = Math.sin(s.angle);
    field.bullets.push({
        x: s.x + nx * 14,
        y: s.y + ny * 14,
        vx: nx * BULLET_SPEED + s.vx,
        vy: ny * BULLET_SPEED + s.vy,
        life: BULLET_LIFE,
    });
    field.cooldown = BULLET_COOLDOWN;
    field.events.push({ type: "fire" });
    return true;
}

function stepBullets(field, dt) {
    field.bullets = field.bullets.filter((b) => {
        b.life -= dt;
        b.x = wrap(b.x + b.vx * dt, field.W);
        b.y = wrap(b.y + b.vy * dt, field.H);
        return b.life > 0;
    });
}

function stepRocks(field, dt) {
    for (const a of field.rocks) {
        a.x = wrap(a.x + a.vx * dt, field.W);
        a.y = wrap(a.y + a.vy * dt, field.H);
        a.rot += a.rotSpeed * dt;
    }
}

function bulletHits(field) {
    for (let bi = field.bullets.length - 1; bi >= 0; bi--) {
        const b = field.bullets[bi];
        for (let ai = field.rocks.length - 1; ai >= 0; ai--) {
            const a = field.rocks[ai];
            if (wrapDistSq(b.x, b.y, a.x, a.y, field.W, field.H) < a.radius * a.radius) {
                field.bullets.splice(bi, 1);
                field.rocks.splice(ai, 1);
                breakRock(field, a, b.vx, b.vy);
                break;
            }
        }
    }
}

function shipHits(field) {
    const s = field.ship;
    if (!s.alive || field.invuln > 0) return;
    for (let i = 0; i < field.rocks.length; i++) {
        const a = field.rocks[i];
        const rr = a.radius + SHIP_RADIUS * 0.7;
        if (wrapDistSq(s.x, s.y, a.x, a.y, field.W, field.H) < rr * rr) {
            killShip(field);
            field.rocks.splice(i, 1);
            breakRock(field, a, s.vx, s.vy);
            return;
        }
    }
}

/** Score the rock, split it in two of the next size, maybe grant a life. */
export function breakRock(field, rock, pushVx, pushVy) {
    const info = SIZES[rock.size];
    field.score += info.score;
    field.events.push({ type: "bang", x: rock.x, y: rock.y, size: rock.size });

    if (info.next) {
        for (let i = 0; i < 2; i++) {
            const child = makeRock(field, rock.x, rock.y, info.next);
            const a = field.rng() * Math.PI * 2;
            const sp = SIZES[info.next].speed * (0.8 + field.rng() * 0.6);
            child.vx = Math.cos(a) * sp + (pushVx || 0) * 0.2;
            child.vy = Math.sin(a) * sp + (pushVy || 0) * 0.2;
            field.rocks.push(child);
        }
    }

    if (field.score >= field.nextExtraLife) {
        field.lives++;
        field.nextExtraLife += EXTRA_LIFE_AT;
        field.events.push({ type: "extralife" });
    }
}

function killShip(field) {
    const s = field.ship;
    if (!s.alive) return;
    s.alive = false;
    s.thrusting = false;
    field.events.push({ type: "shipexplode", x: s.x, y: s.y });
    field.lives--;
    if (field.lives <= 0) {
        field.over = true;
        field.events.push({ type: "gameover" });
    } else {
        field.respawnTimer = RESPAWN_DELAY;
    }
}

// Respawn in the centre once no rock is within 100 px of it.
function respawn(field) {
    const cx = field.W / 2, cy = field.H / 2;
    const safe = 100;
    for (const a of field.rocks) {
        if (wrapDistSq(a.x, a.y, cx, cy, field.W, field.H) < (safe + a.radius) ** 2) {
            field.respawnTimer = 200;
            return;
        }
    }
    field.ship = makeShip(field.W, field.H);
    field.invuln = INVULN_TIME;
}

export function drainEvents(field) {
    const out = field.events;
    field.events = [];
    return out;
}
