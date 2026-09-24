// fish.js — fish: movement, hunger, feeding, coin drops, eggs, drawing.
// Plain state objects stepped against the tank's world context (tank.js).

import { FISH_TIERS, fishById, pelletById, coinValue, PELLET_TIERS } from "/app/economy.js";
import { shade, centeredText, dot, poly } from "/app/paint.js";

const HUNGER_DECAY = 1.6;        // per second at filter 1.0, NORMAL
const STARVE_MS = 12000;         // at zero hunger this long, a fish dies
const SEEK_BELOW = 85;           // hunger under which a fish chases pellets
const EAT_RANGE = 14;
const WALL = 20;                 // keep-off margin inside the tank

export function makeFish(tierId, x, y) {
    const t = fishById(tierId) || FISH_TIERS[0];
    return {
        tier: t.id,
        def: t,
        x, y,
        vx: (Math.random() < 0.5 ? -1 : 1) * t.speed,
        vy: (Math.random() - 0.5) * 10,
        age: 0,
        size: t.size * 0.55,          // hatchlings grow to def.size
        grown: false,
        hunger: 100,                  // 0 starving .. 100 full
        starveMs: 0,
        eatCooldown: 0,               // ms after eating before chasing again
        coinTimer: 0,                 // ms until the fed fish drops a coin
        hasFood: false,               // fed, coin pending
        target: null,                 // pellet being chased
        dead: false,
        wag: Math.random() * Math.PI * 2,
        eggTimer: 20 + Math.random() * 20,   // s until the next egg (egg layers)
    };
}

const pelletOf = (w) => pelletById(w.pelletTier()) || PELLET_TIERS[0];

/**
 * Step one fish by `ms`. w: the tank world context (bounds, pellets,
 * pelletTier(), hungerMult(), onCoinDrop, onFishAte, onEggLay).
 */
export function stepFish(f, ms, w) {
    if (f.dead) {                                   // belly-up float to the surface
        f.y -= 0.04 * ms;
        if (f.y < w.tankTop - 20) f._despawn = true;
        return;
    }
    const s = ms / 1000;
    f.age += ms;
    f.hunger = Math.max(0, f.hunger - HUNGER_DECAY * w.hungerMult() * s);
    if (f.hunger <= 0) {
        f.starveMs += ms;
        if (f.starveMs > STARVE_MS) { f.dead = true; return; }
    } else {
        f.starveMs = 0;
    }

    if (!f.grown) {
        f.size = Math.min(f.def.size, f.size + 0.0008 * ms);
        if (f.size >= f.def.size - 0.2) f.grown = true;
    }
    if (f.eatCooldown > 0) f.eatCooldown = Math.max(0, f.eatCooldown - ms);

    // A fed fish drops one coin after its digest time.
    if (f.hasFood) {
        f.coinTimer -= ms;
        if (f.coinTimer <= 0) {
            let tier = f.def.coinTier;
            let value = coinValue(tier);
            if (f.def.diamondDrop && Math.random() < 0.3) { value *= 2; tier = 6; }
            w.onCoinDrop(f.x, f.y + 10, tier, Math.round(value * pelletOf(w).coinBoost));
            f.hasFood = false;
        }
    }

    if (f.def.eggLayer && f.grown && f.hunger > 40) {
        f.eggTimer -= s;
        if (f.eggTimer <= 0) {
            w.onEggLay(f.x, f.y);
            f.eggTimer = 30 + Math.random() * 20;
        }
    }

    if (!f.target && f.hunger < SEEK_BELOW && f.eatCooldown <= 0) f.target = nearestPellet(f, w.pellets);
    if (f.target && (!f.target.alive || f.target._consumed)) f.target = null;

    if (f.target) {
        const dx = f.target.x - f.x, dy = f.target.y - f.y;
        const d = Math.hypot(dx, dy) || 1;
        const spd = f.def.speed * 1.6;
        f.vx = (dx / d) * spd;
        f.vy = (dy / d) * spd;
        if (d < EAT_RANGE) {
            f.target._consumed = true;
            f.hunger = Math.min(100, f.hunger + pelletOf(w).restore);
            f.hasFood = true;
            f.coinTimer = f.def.feedMs;
            f.eatCooldown = 600;
            f.target = null;
            w.onFishAte(f);
        }
    } else {                                        // idle wander
        f.vy += (Math.random() - 0.5) * 10;
        f.vy *= 0.98;
        if (Math.random() < 0.001 * ms) f.vx = -f.vx;
    }
    f.x += f.vx * s;
    f.y += f.vy * s;

    if (f.x < w.tankLeft + WALL) { f.x = w.tankLeft + WALL; f.vx = Math.abs(f.vx); }
    if (f.x > w.tankRight - WALL) { f.x = w.tankRight - WALL; f.vx = -Math.abs(f.vx); }
    if (f.y < w.tankTop + WALL) { f.y = w.tankTop + WALL; f.vy = Math.abs(f.vy); }
    if (f.y > w.tankBottom - WALL) { f.y = w.tankBottom - WALL; f.vy = -Math.abs(f.vy); }
    f.wag += ms / 120;
}

function nearestPellet(f, pellets) {
    let best = null, bd = Infinity;
    for (const p of pellets) {
        if (!p.alive || p._consumed) continue;
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        if (d < bd) { bd = d; best = p; }
    }
    return best;
}

export function drawFish(ctx, f) {
    const sz = f.size, col = f.def.color;
    const wag = Math.sin(f.wag) * 0.3;
    const hungry = f.hunger < 30;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.vx < 0 ? -1 : 1, 1);
    ctx.globalAlpha = f.dead ? 0.5 : 1.0;

    poly(ctx, shade(col, -0.2), [[-sz, 0], [-sz * 1.8, -sz * 0.7 + wag * sz], [-sz * 1.8, sz * 0.7 + wag * sz]]); // tail
    ctx.fillStyle = hungry ? shade(col, -0.35) : col;                                                         // body
    ctx.beginPath();
    ctx.ellipse(0, 0, sz, sz * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(col, 0.3);                                                                          // belly
    ctx.beginPath();
    ctx.ellipse(0, sz * 0.25, sz * 0.7, sz * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    poly(ctx, shade(col, -0.2), [[-sz * 0.3, -sz * 0.55], [sz * 0.2, -sz * 0.55], [0, -sz]]);                 // top fin
    dot(ctx, sz * 0.4, -sz * 0.1, sz * 0.16, "#ffffff");                                                      // eye
    dot(ctx, sz * 0.46, -sz * 0.1, sz * 0.08, "#0a1020");
    ctx.restore();

    if (!f.dead && hungry) {                                                                                  // hunger alert
        ctx.save();
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(f.wag * 2);
        centeredText(ctx, "!", f.x, f.y - sz - 14, "#ff9a6a");
        ctx.restore();
    }
}
