// tank.js — one Fintank aquarium: the active save slot, the day loop, the
// entities in the water, player clicks, purchases and drawing. No shell or
// DOM wiring; game.js drives it and shows its screens.

import * as Eco from "/app/economy.js";
import { makeFish, stepFish, drawFish } from "/app/fish.js";
import { makeIntruder, stepIntruder, drawIntruder, damageIntruder, waveForDay, TYPES } from "/app/intruders.js";
import { makePet, stepPet, drawPet } from "/app/pets.js";
import { createParticles } from "/app/particles.js";
import { shade, dot } from "/app/paint.js";

export const DAY_MS = 120000;
const MARGIN = 30, TANK_TOP = 70;
const COIN_LIFE = 10;            // s a dropped coin stays collectable
const PELLET_LIFE = 12000;       // ms
const COIN_COLOR = ["#f2c95b", "#f2c95b", "#ffd890", "#ffec70", "#fff6a0", "#d8c0ff", "#ffe0ff"];
const PELLET_COLOR = ["#ffd08c", "#ffd08c", "#ffb050", "#c0f070", "#e0c0ff"];

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * opts: width, height (view px, see resize), play(cueName), hungerMult()
 * (difficulty).
 */
export function createTank(opts) {
    let W = opts.width, H = opts.height;
    const play = opts.play || (() => {});
    const bounds = { tankLeft: MARGIN, tankRight: W - MARGIN, tankTop: TANK_TOP, tankBottom: H - MARGIN };
    const fx = createParticles();

    const t = {
        slot: null,
        fish: [], pellets: [], coins: [], intruders: [], pet: null,
        dayTimer: 0,
        status: "playing",           // playing | dayclear | gameover
        today: { coins: 0, kills: 0, bonus: 0 },
        clock: 0,                    // ms of play, animates plants
        fx,
        bounds,
    };
    let wave = [], waveCursor = 0;

    /** Fit the tank to a view of w x h px (the canvas follows the window). */
    t.resize = function (w, h) {
        if (w === W && h === H) return;
        W = w; H = h;
        bounds.tankRight = W - MARGIN;
        bounds.tankBottom = H - MARGIN;
        Object.assign(world, bounds);
    };

    // ── Slot + day lifecycle ─────────────────────────────────────────────

    /** Make save slot n the active one (a new slot starts with two fish). */
    t.startSlot = function (n) {
        t.slot = Eco.loadSlot(n);
        if (!t.slot.fish.length) t.slot.fish = Eco.STARTER_FISH();
    };

    /** Stock the tank from the slot and start the day clock. */
    t.beginDay = function () {
        const slot = t.slot;
        Eco.saveSlot(slot);
        t.fish = []; t.pellets = []; t.coins = []; t.intruders = [];
        fx.reset();
        for (const owned of slot.fish) {
            const def = Eco.fishById(owned.tier) || Eco.FISH_TIERS[0];
            const f = makeFish(def.id, rand(bounds.tankLeft + 50, bounds.tankRight - 50),
                rand(bounds.tankTop + 60, bounds.tankBottom - 60));
            f.size = def.size; f.grown = true; f.hunger = 80;
            t.fish.push(f);
        }
        t.pet = slot.activePet ? makePet(slot.activePet) : null;
        t.dayTimer = 0;
        t.today = { coins: 0, kills: 0, bonus: 0 };
        wave = waveForDay(slot.day, Math.random);
        waveCursor = 0;
        t.status = "playing";
    };

    function endDay() {
        const slot = t.slot;
        slot.fish = t.fish.filter((f) => !f.dead).map((f) => ({ tier: f.tier }));
        const bonus = slot.fish.length * 25 + slot.day * 20;
        earn(bonus, false);
        t.today.bonus = bonus;
        if (slot.day > (slot.bestDay || 0)) slot.bestDay = slot.day;
        Eco.saveSlot(slot);
        t.status = "dayclear";
    }

    t.nextDay = function () {
        t.slot.day = (t.slot.day || 1) + 1;
        t.beginDay();
    };

    /** After a game over: back to day 1 with two fish, keeping some coins. */
    t.resetForRetry = function () {
        const slot = t.slot;
        slot.fish = Eco.STARTER_FISH();
        slot.day = 1;
        slot.coins = Math.max(slot.coins, 150);
        Eco.saveSlot(slot);
    };

    t.aliveFish = () => t.fish.filter((f) => !f.dead).length;

    // ── Economy events ───────────────────────────────────────────────────

    // Coins into the slot; `collected` ones count toward the day's tally.
    function earn(n, collected = true) {
        t.slot.coins += n;
        t.slot.totalCoins = (t.slot.totalCoins || 0) + n;
        if (collected) t.today.coins += n;
    }

    function addPellet(x, y) {
        t.pellets.push({
            alive: true, x, y: y != null ? y : bounds.tankTop + 10,
            vy: rand(20, 40), wobble: Math.random() * Math.PI * 2, age: 0,
        });
        fx.splash(x, bounds.tankTop);
        play("splash");
    }

    function addCoin(x, y, tier, value) {
        t.coins.push({
            alive: true, x, y, vx: rand(-6, 6), vy: rand(5, 20), tier, value,
            age: 0, life: COIN_LIFE, spin: Math.random() * Math.PI * 2, settled: false,
        });
        play("coin_drop@" + (tier || 1));
    }

    function collectCoin(c) {
        if (!c.alive || c._consumed) return;
        c.alive = false;
        c._consumed = true;
        earn(c.value);
        play("coin_get@" + (c.tier || 1));
        fx.floatText(c.x, c.y - 10, "+" + c.value, "#f2c95b");
    }

    function hitIntruder(iu, amt) {
        if (damageIntruder(iu, amt)) {
            play("intruder_die");
            fx.spark(iu.x, iu.y, iu.def.color, 14);
            fx.shake(4);
            earn(iu.def.reward);
            fx.floatText(iu.x, iu.y, "+" + iu.def.reward, "#c0ff70");
            t.today.kills++;
        } else {
            play("hit");
            fx.spark(iu.x, iu.y, "#ff6060", 5);
        }
    }

    function spawnIntruder(type) {
        const fromLeft = Math.random() < 0.5;
        const x = fromLeft ? bounds.tankLeft - 40 : bounds.tankRight + 40;
        const y = rand(bounds.tankTop + 40, bounds.tankBottom - 40);
        t.intruders.push(makeIntruder(TYPES[type] ? type : "snatcher", x, y, t.slot ? t.slot.day : 1));
        play("intruder_roar");
    }

    // The context fish / intruders / pets step against.
    const world = Object.assign({
        fish: null, pellets: null, coins: null, intruders: null,
        pelletTier: () => t.slot.pelletTier,
        hungerMult: () => Eco.filterMult(t.slot) * opts.hungerMult(),
        onCoinDrop: addCoin,
        onFishAte(f) { play("chomp"); fx.spark(f.x, f.y, "#ffd080", 4); },
        onEggLay(x, y) {
            if (t.aliveFish() >= Eco.maxFishCap(t.slot)) return;
            const baby = makeFish(1, x, y);
            baby.size = 4;
            t.fish.push(baby);
            fx.spark(x, y, "#a8f06c", 8);
            play("hatch");
        },
        onFishEaten(f) { play("fish_die"); fx.spark(f.x, f.y, "#ff6080", 10); },
        onCoinTaken(c) { fx.spark(c.x, c.y, "#ff4040", 6); },
        onAlchemUpgrade(c) { fx.spark(c.x, c.y, "#b06acb", 6); },
        addPellet: (x, y) => addPellet(x, y != null ? y : bounds.tankTop + 20),
        collectCoin,
        damageIntruder: hitIntruder,
    }, bounds);

    // ── Frame ────────────────────────────────────────────────────────────

    t.tick = function (ms) {
        if (!t.slot || t.status !== "playing") return;
        t.clock += ms;
        t.dayTimer += ms;
        while (waveCursor < wave.length && wave[waveCursor].t <= t.dayTimer) spawnIntruder(wave[waveCursor++].type);

        world.fish = t.fish; world.pellets = t.pellets; world.coins = t.coins; world.intruders = t.intruders;
        for (const f of t.fish) stepFish(f, ms, world);
        stepPellets(ms);
        stepCoins(ms);
        for (const iu of t.intruders) stepIntruder(iu, ms, world);
        if (t.pet) stepPet(t.pet, ms, world);
        fx.update(ms, W, H);
        t.fish = t.fish.filter((f) => !f._despawn);
        t.intruders = t.intruders.filter((iu) => !iu._despawn);

        if (t.aliveFish() === 0 && t.slot.fish.length > 0) {
            t.slot.fish = [];
            Eco.saveSlot(t.slot);
            t.status = "gameover";
        } else if (t.dayTimer >= DAY_MS) {
            endDay();
        }
    };

    function stepPellets(ms) {
        const s = ms / 1000;
        for (const p of t.pellets) {
            p.age += ms;
            p.wobble += ms / 200;
            p.x += Math.sin(p.wobble) * 12 * s;
            p.y += p.vy * s;
        }
        t.pellets = t.pellets.filter((p) => p.alive && !p._consumed &&
            p.y <= bounds.tankBottom - 10 && p.age <= PELLET_LIFE);
    }

    function stepCoins(ms) {
        const s = ms / 1000;
        for (const c of t.coins) {
            c.age += s;
            c.spin += ms / 80;
            if (c.settled) continue;
            c.x += c.vx * s;
            c.y += c.vy * s;
            c.vy += 30 * s;
            if (c.y > bounds.tankBottom - 12) {
                c.y = bounds.tankBottom - 12;
                c.vx = c.vy = 0;
                c.settled = true;
            }
        }
        t.coins = t.coins.filter((c) => c.age < c.life && !c._consumed);
    }

    // ── Player input ─────────────────────────────────────────────────────

    /** A click in view px: hit an intruder, else grab a coin, else drop food. */
    t.clickAt = function (x, y) {
        for (const iu of t.intruders) {
            if (!iu.dead && Math.hypot(iu.x - x, iu.y - y) < iu.def.size + 6) { hitIntruder(iu, 1); return; }
        }
        for (let j = t.coins.length - 1; j >= 0; j--) {
            const c = t.coins[j];
            if (c.alive && !c._consumed && Math.hypot(c.x - x, c.y - y) < 20) { collectCoin(c); return; }
        }
        if (y > bounds.tankTop + 5 && y < bounds.tankBottom - 5 && x > bounds.tankLeft && x < bounds.tankRight) {
            addPellet(x, bounds.tankTop + 15);
            play("feed");
        }
    };

    /** Space: a row of five pellets across the middle. */
    t.quickFeed = function () {
        const cx = (bounds.tankLeft + bounds.tankRight) / 2;
        for (let i = 0; i < 5; i++) addPellet(cx + (i - 2) * 40, bounds.tankTop + 20);
    };

    /**
     * Buy mid-day by id: "pellet", "fish_tier<N>", "upgrade_<id>", "pet_<id>".
     * A fish joins the tank at once (small); a pet starts working.
     */
    t.buy = function (item) {
        const slot = t.slot;
        if (!slot) return { ok: false };
        let res;
        if (item === "pellet") res = Eco.buyPelletNext(slot);
        else if (item.startsWith("fish_tier")) {
            const tier = parseInt(item.slice(9), 10);
            res = Eco.buyFish(slot, tier);
            if (res.ok) {
                const f = makeFish(tier, rand(bounds.tankLeft + 60, bounds.tankRight - 60),
                    rand(bounds.tankTop + 60, bounds.tankBottom - 60));
                f.size = f.def.size * 0.6;
                t.fish.push(f);
            }
        } else if (item.startsWith("upgrade_")) res = Eco.buyUpgrade(slot, item.slice(8));
        else if (item.startsWith("pet_")) {
            const id = item.slice(4);
            res = Eco.buyPet(slot, id);
            if (res.ok) { slot.activePet = id; t.pet = makePet(id); }
        } else res = { ok: false, reason: "UNKNOWN" };
        if (res.ok) Eco.saveSlot(slot);
        return res;
    };

    /** Hotkeys: 1 = next pellet, 2..6 = fish tiers 1..5. */
    t.quickBuy = function (n) {
        const res = n === 1 ? t.buy("pellet") : n >= 2 && n <= 6 ? t.buy("fish_tier" + (n - 1)) : { ok: false };
        play(res.ok ? "buy" : "buy_fail");
        return res;
    };

    /** Buy shop entry `idx` of Eco.shopCatalog(slot) between days. */
    t.shopBuy = function (idx) {
        const res = Eco.buyItem(t.slot, Eco.shopCatalog(t.slot)[idx]);
        if (res.ok) Eco.saveSlot(t.slot);
        return res;
    };

    // ── Test / debug actions ─────────────────────────────────────────────

    t.debug = {
        addPellet,
        addCoin,
        spawnIntruder,
        addCoins(n) { earn(n, false); Eco.saveSlot(t.slot); },
        killAllIntruders() {
            for (const iu of t.intruders) if (!iu.dead) { iu.dead = true; t.today.kills++; }
        },
        collectAllCoins() { for (const c of t.coins) collectCoin(c); },
        feedFish(i) {
            const f = t.fish[i || 0];
            if (f) { f.hasFood = true; f.coinTimer = 100; f.hunger = 100; }
        },
        endDay,
    };

    // ── Drawing ──────────────────────────────────────────────────────────

    t.draw = function (ctx) {
        const { tankLeft: L, tankRight: R, tankTop: T, tankBottom: B } = bounds;
        const g = ctx.createLinearGradient(0, T, 0, B);
        g.addColorStop(0, shade("#155874", (t.slot ? Eco.lightMult(t.slot) : 1) - 1));
        g.addColorStop(1, shade("#061a2a", 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = "#2a5068";
        ctx.lineWidth = 3;
        ctx.strokeRect(L, T, R - L, B - T);

        ctx.fillStyle = "#1a2840";                    // gravel
        ctx.fillRect(L, B - 14, R - L, 14);
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = i % 3 === 0 ? "#283b58" : "#334768";
            ctx.fillRect(L + (i / 40) * (R - L) + (i * 17 % 20), B - 12 + (i % 3), 6, 4);
        }
        drawPlant(ctx, L + 80, B - 14, 100);
        drawPlant(ctx, R - 80, B - 14, 120);

        fx.draw(ctx);
        const pelletCol = PELLET_COLOR[t.slot ? t.slot.pelletTier : 1] || PELLET_COLOR[0];
        for (const p of t.pellets) {
            dot(ctx, p.x, p.y, 4, pelletCol);
            ctx.globalAlpha = 0.4;
            dot(ctx, p.x - 1.5, p.y - 1.5, 1.2, "#ffffff");
            ctx.globalAlpha = 1;
        }
        for (const c of t.coins) drawCoin(ctx, c);
        for (const f of t.fish) drawFish(ctx, f);
        for (const iu of t.intruders) drawIntruder(ctx, iu);
        if (t.pet) drawPet(ctx, t.pet);
    };

    function drawPlant(ctx, x, yBase, h) {
        ctx.strokeStyle = "#2a6a3a";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const swayX = x + Math.sin(i * 0.6 + t.clock / 800) * 8;
            if (i === 0) ctx.moveTo(swayX, yBase);
            ctx.lineTo(swayX + (i % 2 === 0 ? -4 : 4), yBase - (i / 5) * h);
        }
        ctx.stroke();
    }

    return t;
}

function drawCoin(ctx, c) {
    const fade = c.age > c.life - 3 ? Math.max(0.3, 1 - (c.age - (c.life - 3)) / 3) : 1.0;
    const sw = 10 + c.tier * 2;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.spin);
    ctx.globalAlpha = fade;
    ctx.fillStyle = COIN_COLOR[c.tier] || COIN_COLOR[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, sw, Math.abs(Math.cos(c.spin)) * sw, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8a6020";
    ctx.fillRect(-2, -4, 4, 8);
    ctx.restore();
}

/** The title screen's water: a gradient with drifting wave lines at time tMs. */
export function drawTitleWater(ctx, W, H, tMs) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#08283a");
    g.addColorStop(1, "#020e1a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#5fc0ff";
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
        ctx.globalAlpha = 0.04 + (i % 2) * 0.02;
        ctx.beginPath();
        const y = i * 120 + (tMs * 0.02) % 120;
        for (let x = 0; x <= W; x += 20) {
            const yy = y + Math.sin((x + tMs * 0.01 + i * 30) * 0.03) * 6;
            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}
