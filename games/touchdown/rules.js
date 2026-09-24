// Touchdown rules — jagged terrain with landing pads, the lander's
// gravity / thrust / rotation, and the safe-landing test. No DOM, audio or
// drawing. Physics is in px per 60 Hz frame (f = dt / 16.67).
//
// createMission(w, h, rng) starts level 1. The plugin calls
// step(m, dt ms, controls) every frame, controls = { left, right, thrust,
// aim } (aim = {x, y} steers toward the pointer and thrusts). Events on
// m.events: land {gained} · crash {reasons}. After a landing the plugin
// shows its screen and calls nextLevel(m).

export const GRAVITY = 0.06;
export const THRUST = 0.14;
export const ROT_SPEED = 0.065;
export const FUEL_BURN = 0.65;
export const MAX_SAFE_VY = 2.4;
export const MAX_SAFE_VX = 1.8;
export const MAX_SAFE_TILT = 0.22;
export const LANDER_W = 14;
export const LANDER_H = 16;

export function createMission(w, h, rng = Math.random) {
    const m = {
        W: w, H: h, rng,
        level: 1,
        score: 0,
        landings: 0,
        terrain: null,
        lander: null,
        status: "flying",      // "flying" | "landed" | "crashed"
        reasons: [],           // why the last touchdown was a crash
        lastBonus: 0,
        lastPadWidth: 0,
        events: [],
    };
    startLevel(m);
    return m;
}

function startLevel(m) {
    m.terrain = buildTerrain(m.W, m.H, m.level, m.rng);
    m.lander = newLander(m.W, m.level, m.rng);
    m.status = "flying";
    m.reasons = [];
}

/** After the landed screen. */
export function nextLevel(m) {
    m.level++;
    startLevel(m);
}

const rand = (rng, a, b) => a + rng() * (b - a);

/** Fuel for a level: 1000, 110 less each level, never under 350. */
export function levelFuel(level) {
    return Math.max(350, 1000 - (level - 1) * 110);
}

function newLander(W, level, rng) {
    const fuel = levelFuel(level);
    return {
        x: W * 0.5 + rand(rng, -W * 0.25, W * 0.25), y: 70,
        vx: rand(rng, -0.9, 0.9) + (level - 1) * 0.1, vy: 0,
        angle: 0, thrusting: false, fuel, fuelMax: fuel,
    };
}

// ── Terrain ──────────────────────────────────────────────────────────────

/**
 * A polyline across the view with flat pads spliced in. Pads get fewer,
 * narrower and the ground rougher as the level rises; narrow pads pay more.
 */
export function buildTerrain(W, H, level, rng = Math.random) {
    const points = [], pads = [];
    const seg = 18;
    const amp = Math.min(180, 50 + level * 14);
    const jag = 0.35 + Math.min(0.45, level * 0.06);
    const ranges = [];
    for (let p = Math.max(2, 5 - Math.floor(level / 2)); p > 0; p--) {
        const width = Math.max(36, Math.floor(Math.max(40, 120 - level * 10) + rand(rng, -10, 10)));
        for (let tries = 0; tries < 20; tries++) {         // pads never overlap or touch
            const x1 = Math.floor(rand(rng, 60, W - 60 - width));
            if (ranges.some((r) => x1 < r.x2 + seg * 2 && x1 + width > r.x1 - seg * 2)) continue;
            ranges.push({ x1, x2: x1 + width });
            break;
        }
    }

    let x = 0, y = H * 0.78 + rand(rng, -20, 20);
    while (x <= W + seg) {
        const pr = ranges.find((r) => x >= r.x1 && x <= r.x2);
        if (pr) {
            if (!points.length || points[points.length - 1].x < pr.x1) points.push({ x: pr.x1, y });
            points.push({ x: pr.x2, y });
            const width = pr.x2 - pr.x1;
            pads.push({ x1: pr.x1, x2: pr.x2, y, width, bonus: Math.floor(50 + (140 - Math.min(140, width)) * 2.8) });
            x = pr.x2 + seg;
            y += rand(rng, -amp * jag, amp * jag);
            continue;
        }
        points.push({ x, y });
        x += seg + rand(rng, -5, 5);
        y += rand(rng, -amp * jag, amp * jag);
        if (y < H * 0.4) y = H * 0.4 + rand(rng, 0, 10);
        if (y > H - 30) y = H - 30 - rand(rng, 0, 10);
    }
    if (points[0].x > 0) points.unshift({ x: 0, y: points[0].y });
    if (points[points.length - 1].x < W) points.push({ x: W, y: points[points.length - 1].y });
    return { points, pads };
}

/** Ground height under x (clamped to the ends). */
export function terrainY(terrain, x) {
    const pts = terrain.points;
    if (x <= pts[0].x) return pts[0].y;
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].x >= x) {
            const a = pts[i - 1], b = pts[i];
            return a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x || 1));
        }
    }
    return pts[pts.length - 1].y;
}

export function padAt(terrain, x) {
    return terrain.pads.find((p) => x >= p.x1 && x <= p.x2) || null;
}

/** Height of the lander above the ground under it. */
export function altitude(m) {
    return Math.max(0, Math.round(terrainY(m.terrain, m.lander.x) - m.lander.y));
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ── Step ─────────────────────────────────────────────────────────────────

export function step(m, dt, controls) {
    if (m.status !== "flying") return;
    const f = Math.min(3, dt / 16.67);
    const L = m.lander;
    const c = controls || {};

    if (c.aim) {                                   // turn toward the pointer
        const dx = c.aim.x - L.x, dy = c.aim.y - L.y;
        if (dx * dx + dy * dy > 16) {
            const target = Math.atan2(dx, -dy);
            const diff = wrapAngle(target - L.angle);
            const turn = ROT_SPEED * f;
            L.angle = Math.abs(diff) <= turn ? target : L.angle + Math.sign(diff) * turn;
        }
    } else {
        if (c.left) L.angle -= ROT_SPEED * f;
        if (c.right) L.angle += ROT_SPEED * f;
    }

    L.thrusting = !!(c.thrust || c.aim) && L.fuel > 0;
    if (L.thrusting) {
        L.vx += Math.sin(L.angle) * THRUST * f;
        L.vy -= Math.cos(L.angle) * THRUST * f;
        L.fuel = Math.max(0, L.fuel - FUEL_BURN * f);
    }
    L.vy += GRAVITY * f;
    L.x += L.vx * f;
    L.y += L.vy * f;
    if (L.x < 0) L.x += m.W;
    else if (L.x > m.W) L.x -= m.W;

    const foot = Math.abs(Math.cos(L.angle)) * LANDER_H * 0.55;
    const ground = terrainY(m.terrain, L.x);
    if (L.y + foot >= ground) {
        L.y = ground - foot;
        touchdown(m);
    }
}

// Safe = on a pad, slow both ways, nearly upright. Pay the pad, 20% of the
// fuel left and a softness bonus; otherwise say why it crashed.
function touchdown(m) {
    const L = m.lander;
    L.thrusting = false;
    const pad = padAt(m.terrain, L.x);
    const vx = Math.abs(L.vx), vy = Math.abs(L.vy), tilt = Math.abs(wrapAngle(L.angle));
    if (pad && vx <= MAX_SAFE_VX && vy <= MAX_SAFE_VY && tilt <= MAX_SAFE_TILT) {
        const gained = pad.bonus + Math.floor(L.fuel * 0.2) + Math.max(0, Math.round((MAX_SAFE_VY - vy) * 50));
        m.score += gained;
        m.landings++;
        m.lastBonus = gained;
        m.lastPadWidth = pad.width;
        m.status = "landed";
        L.vx = L.vy = 0;
        m.events.push({ type: "land", gained });
        return;
    }
    const reasons = [];
    if (!pad) reasons.push("NOT ON A FLAT PAD");
    if (vy > MAX_SAFE_VY) reasons.push("DESCENT TOO FAST");
    if (vx > MAX_SAFE_VX) reasons.push("LATERAL DRIFT TOO HIGH");
    if (tilt > MAX_SAFE_TILT) reasons.push("NOT UPRIGHT");
    m.reasons = reasons;
    m.status = "crashed";
    m.events.push({ type: "crash", reasons });
}

export function drainEvents(m) {
    const out = m.events;
    m.events = [];
    return out;
}
