// market.js — the economy's price layer. Pure + serializable like env.js.
//
// Holds a fluctuating price per tradeable good and per buyable item, drifting
// over sim time with the world's DETERMINISTIC rng (no Math.random — the sim
// stays reproducible). world.js owns one market state (world.market) and calls
// stepMarket() each tick; sell()/buy() in world.actions read world.market.prices.
//
// Prices mean-revert toward a season-adjusted base with a bounded random walk,
// re-rolled on an interval so they move on a human timescale (visible discrete
// shifts, good for "different price state" reads), not per-frame jitter.

// Base prices (gold per unit). Produce goods are what pens/crops yield; feed and
// animal are buy-side items.
export const BASE_PRICES = {
    eggs: 5, milk: 9, wool: 13, crops: 8,   // sell goods (inventory -> gold)
    feed: 0.25,                             // buy: gold -> barnFeed (per unit)
    animal: 90,                             // buy: gold -> a young animal
};

// Goods the player/orchestrator can sell from inventory.
export const SELLABLE = ['eggs', 'milk', 'wool', 'crops'];

// Per-good random-walk volatility (fraction of base per re-roll step).
const VOL = { eggs: 0.16, milk: 0.16, wool: 0.18, crops: 0.20, feed: 0.18, animal: 0.10 };
// Clamp bounds as fractions of the season base.
const LO  = { eggs: 0.6, milk: 0.6, wool: 0.6, crops: 0.55, feed: 0.7, animal: 0.85 };
const HI  = { eggs: 1.7, milk: 1.7, wool: 1.75, crops: 1.8, feed: 1.6, animal: 1.3 };

// Season nudges the base: produce/wool scarcer (pricier) in winter, crops cheap
// in summer abundance, feed pricier in winter.
const SEASON_MULT = {
    spring: { crops: 0.95 },
    summer: { crops: 0.85 },
    fall:   { crops: 1.10, wool: 1.10 },
    winter: { crops: 1.35, wool: 1.25, feed: 1.20 },
};

const PRICE_INTERVAL = 7000;   // ms between price re-rolls

function seasonBase(good, season) {
    const m = (SEASON_MULT[season] && SEASON_MULT[season][good]) || 1;
    return BASE_PRICES[good] * m;
}

export function createMarket() {
    const prices = {};
    for (const k of Object.keys(BASE_PRICES)) prices[k] = BASE_PRICES[k];
    return { prices, timer: PRICE_INTERVAL };
}

export function stepMarket(world, dt, rng) {
    const m = world.market;
    m.timer -= dt;
    if (m.timer > 0) return;
    m.timer = PRICE_INTERVAL * (0.7 + 0.6 * rng());
    const season = (world.env && world.env.season) || 'spring';
    for (const good of Object.keys(BASE_PRICES)) {
        const base = seasonBase(good, season);
        let p = m.prices[good];
        p += (base - p) * 0.18;                       // mean reversion
        p += (rng() * 2 - 1) * VOL[good] * base;      // random step
        const lo = base * LO[good], hi = base * HI[good];
        m.prices[good] = Math.max(lo, Math.min(hi, p));
    }
}

// 'high' | 'mid' | 'low' relative to the season base — drives sell timing + HUD.
export function priceLevel(good, price, season) {
    const base = seasonBase(good, season);
    if (price >= base * 1.15) return 'high';
    if (price <= base * 0.88) return 'low';
    return 'mid';
}

// Serializable market snapshot for observe().
export function marketObserve(world) {
    const m = world.market;
    const season = (world.env && world.env.season) || 'spring';
    const prices = {}, level = {};
    for (const k of Object.keys(m.prices)) {
        prices[k] = Math.round(m.prices[k] * 10) / 10;
        level[k] = priceLevel(k, m.prices[k], season);
    }
    return { prices, level };
}

// Info alerts when a sellable good is fetching a high price.
export function marketAlerts(world) {
    const season = (world.env && world.env.season) || 'spring';
    const out = [];
    for (const good of SELLABLE) {
        if (world.resources[good] > 0 && priceLevel(good, world.market.prices[good], season) === 'high') {
            out.push({ level: 'info', who: 'market', msg: `${good} price is high — sell` });
        }
    }
    return out;
}
