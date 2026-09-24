// intruders.js — the tank's raiders: types, waves, behaviour, drawing.
//   snatcher  small fast fish predator
//   siphoner  eats coins
//   drifter   slow and tanky, eats fish
//   swarmer   weak, arrives in groups
//   wrecker   boss, every fifth day

import { shade, dot, poly } from "/app/paint.js";

export const TYPES = {
    snatcher: { hp: 2,  speed: 70, size: 18, color: "#b06acb", eats: "fish",  reward: 20 },
    siphoner: { hp: 3,  speed: 55, size: 22, color: "#d85050", eats: "coins", reward: 30 },
    drifter:  { hp: 6,  speed: 30, size: 30, color: "#5a7080", eats: "fish",  reward: 60 },
    swarmer:  { hp: 1,  speed: 90, size: 14, color: "#c0ff70", eats: "fish",  reward: 10 },
    wrecker:  { hp: 25, speed: 35, size: 44, color: "#903030", eats: "all",   reward: 300 },
};

const DYING_MS = 800;

/** A new intruder of `type` entering at (x, y); hit points scale 20 % a day. */
export function makeIntruder(type, x, y, day) {
    const t = TYPES[type] || TYPES.snatcher;
    const hp = Math.ceil(t.hp * (1 + ((day || 1) - 1) * 0.2));
    return {
        type, def: t, x, y,
        vx: (x < 0 ? 1 : -1) * t.speed,
        vy: (Math.random() - 0.5) * 15,
        hp, hpMax: hp,
        targetFish: null,
        eatCooldown: 0,
        wag: 0,
        dead: false,
        dying: 0,                  // ms since death (sinking)
        hitFlash: 0,
        entered: false,
    };
}

/** Knock `amt` hit points off; true when that killed it. */
export function damageIntruder(iu, amt) {
    if (iu.dead) return false;
    iu.hp -= amt;
    iu.hitFlash = 120;
    if (iu.hp <= 0) { iu.dead = true; return true; }
    return false;
}

/** Step one intruder by `ms` against the tank world context. */
export function stepIntruder(iu, ms, w) {
    const s = ms / 1000;
    if (iu.dead) {
        iu.dying += ms;
        iu.y += 0.02 * ms;
        if (iu.dying > DYING_MS) iu._despawn = true;
        return;
    }
    iu.wag += ms / 100;
    if (iu.hitFlash > 0) iu.hitFlash = Math.max(0, iu.hitFlash - ms);
    if (iu.eatCooldown > 0) iu.eatCooldown = Math.max(0, iu.eatCooldown - ms);

    if (!iu.entered) {                               // swim in from off-screen
        iu.x += iu.vx * s;
        if (iu.x > w.tankLeft + 10 && iu.x < w.tankRight - 10) iu.entered = true;
        return;
    }

    const eats = iu.def.eats;
    if (!iu.targetFish && (eats === "fish" || eats === "all")) iu.targetFish = nearest(iu, w.fish, (f) => !f.dead);
    if (iu.targetFish && iu.targetFish.dead) iu.targetFish = null;

    if (eats === "coins") {
        const c = nearest(iu, w.coins, (c) => c.alive && !c._consumed);
        if (c) {
            moveTowards(iu, c.x, c.y, s);
            if (Math.hypot(iu.x - c.x, iu.y - c.y) < 16) {
                c._consumed = true;
                w.onCoinTaken(c);
            }
        } else wander(iu, s);
    } else if (iu.targetFish) {
        const f = iu.targetFish;
        moveTowards(iu, f.x, f.y, s);
        if (Math.hypot(iu.x - f.x, iu.y - f.y) < 18 && iu.eatCooldown <= 0) {
            f.dead = true;
            iu.eatCooldown = 1500;
            w.onFishEaten(f);
            iu.targetFish = null;
        }
    } else wander(iu, s);

    if (iu.x < w.tankLeft + 10) { iu.x = w.tankLeft + 10; iu.vx = Math.abs(iu.vx); }
    if (iu.x > w.tankRight - 10) { iu.x = w.tankRight - 10; iu.vx = -Math.abs(iu.vx); }
    if (iu.y < w.tankTop + 20) { iu.y = w.tankTop + 20; iu.vy = Math.abs(iu.vy); }
    if (iu.y > w.tankBottom - 20) { iu.y = w.tankBottom - 20; iu.vy = -Math.abs(iu.vy); }
}

function wander(iu, s) {
    iu.x += iu.vx * s;
    iu.y += iu.vy * s;
    iu.vy += (Math.random() - 0.5) * 12;
    iu.vy *= 0.96;
}

function moveTowards(iu, tx, ty, s) {
    const dx = tx - iu.x, dy = ty - iu.y;
    const d = Math.hypot(dx, dy) || 1;
    iu.vx = dx / d * iu.def.speed;
    iu.vy = dy / d * iu.def.speed;
    iu.x += iu.vx * s;
    iu.y += iu.vy * s;
}

function nearest(iu, list, ok) {
    let best = null, bd = Infinity;
    for (const e of list) {
        if (!ok(e)) continue;
        const d = Math.hypot(iu.x - e.x, iu.y - e.y);
        if (d < bd) { bd = d; best = e; }
    }
    return best;
}

/** The day's arrival schedule: [{ t (ms into the day), type }]. */
export function waveForDay(day, rng = Math.random) {
    if (day % 5 === 0) {                             // boss day
        const list = [{ t: 4000, type: "wrecker" }];
        for (let i = 0; i < 3; i++) list.push({ t: 10000 + i * 3000, type: "swarmer" });
        return list;
    }
    const count = 1 + Math.min(5, Math.floor(day / 2));
    const types = ["snatcher"];
    if (day >= 2) types.push("siphoner");
    if (day >= 3) types.push("swarmer");
    if (day >= 4) types.push("drifter");
    const list = [];
    for (let k = 0; k < count; k++) {
        const type = types[Math.floor(rng() * types.length)];
        list.push({ t: 20000 + k * 18000 + Math.floor(rng() * 4000), type });
    }
    return list;
}

// ── Drawing ──────────────────────────────────────────────────────────────

const ellipse = (ctx, color, rx, ry) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
};

const BODY = {
    swarmer(ctx, sz, col) {                          // spiky dart
        poly(ctx, col, [[sz, 0], [-sz, -sz * 0.7], [-sz * 0.7, 0], [-sz, sz * 0.7]]);
    },
    drifter(ctx, sz, col) {                          // spotted blob
        ellipse(ctx, col, sz, sz * 0.8);
        for (let i = -1; i <= 1; i++) dot(ctx, i * sz * 0.4, -sz * 0.15, sz * 0.15, shade(col, -0.3));
    },
    siphoner(ctx, sz, col) {                         // all mouth
        ellipse(ctx, col, sz, sz * 0.65);
        poly(ctx, "#300808", [[sz, 0], [sz * 0.4, -sz * 0.4], [sz * 0.6, 0], [sz * 0.4, sz * 0.4]]);
    },
    wrecker(ctx, sz, col) {                          // spiked boss with a red eye
        ellipse(ctx, col, sz * 1.2, sz * 0.8);
        for (let k = 0; k < 5; k++) {
            ctx.save();
            ctx.rotate((k - 2) * 0.35);
            poly(ctx, "#402020", [[0, -sz * 0.8], [-6, -sz * 1.2], [6, -sz * 1.2]]);
            ctx.restore();
        }
        dot(ctx, sz * 0.6, -sz * 0.2, sz * 0.18, "#ffa040");
    },
    snatcher(ctx, sz, col) {                         // sleek predator
        ellipse(ctx, col, sz, sz * 0.4);
        poly(ctx, shade(col, -0.2), [[-sz, 0], [-sz * 1.6, -sz * 0.5], [-sz * 1.6, sz * 0.5]]);
        poly(ctx, "#ffffff", [[sz, -sz * 0.1], [sz * 0.7, -sz * 0.3], [sz * 0.8, -sz * 0.1]]);
    },
};

export function drawIntruder(ctx, iu) {
    const sz = iu.def.size;
    ctx.save();
    ctx.translate(iu.x, iu.y);
    ctx.scale(iu.vx < 0 ? -1 : 1, 1);
    if (iu.hitFlash > 0) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(iu.hitFlash * 0.2);
    (BODY[iu.type] || BODY.snatcher)(ctx, sz, iu.def.color);
    dot(ctx, sz * 0.45, -sz * 0.2, sz * 0.14, "#ffffff");
    dot(ctx, sz * 0.48, -sz * 0.2, sz * 0.08, "#200008");
    ctx.restore();

    if (!iu.dead && iu.hpMax > 1) {                  // HP bar
        const w = 32, pct = iu.hp / iu.hpMax;
        const y = iu.y - sz - 10;
        ctx.fillStyle = "rgba(20,5,5,0.8)";
        ctx.fillRect(iu.x - w / 2, y, w, 4);
        ctx.fillStyle = pct > 0.5 ? "#50e070" : pct > 0.25 ? "#f0c050" : "#e05050";
        ctx.fillRect(iu.x - w / 2, y, w * pct, 4);
    }
}
