// Fintank — arcade plugin: save slots, the between-days shop, the day loop's
// screens, settings and high scores. The aquarium itself is tank.js. The
// shell owns menus / pause / the best-day high score.
//
// Flow: title -> slots -> shop -> (day) -> dayclear -> shop | next day
//       all fish lost -> gameover -> try again (shop, day 1)

import { bindPointer } from "/lib/arcade/pointer.js";
import { createOptions, sfxVolume } from "/lib/arcade/options.js";
import { recordScore } from "/lib/arcade/scores.js";
import * as Eco from "/app/economy.js";
import { createTank, drawTitleWater, DAY_MS } from "/app/tank.js";

const QUICK_BUY_KEYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3];

let api = null;
let tank = null;
let options = null;
let titleClock = 0;

const $ = (id) => document.getElementById(id);

export const game = {
    id: "fintank",
    clearColor: "#020e1a",
    hudScreens: ["shop", "dayclear"],

    actions: [
        { name: "primary", label: "Quick feed", defaults: [" "] },
        ...QUICK_BUY_KEYS.map((n) => ({ name: "buy_" + n, label: "Quick buy " + n, defaults: [String(n)] })),
    ],

    defaults: {
        highScore: 0,          // best day reached
        difficulty: 1,
        sfxVol: 80,
        activeSlot: 1,
        hsDays: [],            // top runs: { score: day, day, slot, totalCoins }
    },

    init(shellApi) {
        api = shellApi;
        tank = createTank({
            width: api.view.width(), height: api.view.height(),
            play: (name) => api.play(name),
            hungerMult: () => Eco.HUNGER_MULT[options.get("difficulty")] || 1,
        });
        options = createOptions(api, [
            sfxVolume(),
            { key: "difficulty", action: "cycle-difficulty", values: [1, 2, 0], label: (v) => Eco.DIFFICULTY[v] },
        ]);
        options.applyAll();
        importOldScores();
        bindPointer(api, { down: (p) => tank.clickAt(p.x, p.y) });
    },

    create() {
        tank.resize(api.view.width(), api.view.height());
        if (!tank.slot) tank.startSlot(api.save.get("activeSlot") || 1);
        tank.beginDay();
        return { score: bestDay(), ended: false, dayEnded: false };
    },

    update(run, dt, input) {
        tank.resize(api.view.width(), api.view.height());
        if (input.pressed("primary")) tank.quickFeed();
        for (const n of QUICK_BUY_KEYS) if (input.pressed("buy_" + n)) tank.quickBuy(n);
        tank.tick(dt);
        run.score = bestDay();

        if (tank.status === "dayclear" && !run.dayEnded) {
            run.dayEnded = true;
            api.play("day_end");
            return { status: "screen", name: "dayclear" };
        }
        if (tank.status === "gameover" && !run.ended) {
            run.ended = true;
            const slot = tank.slot;
            recordScore(api.save, "hsDays", {
                score: bestDay(), day: bestDay(), slot: slot.slot, totalCoins: slot.totalCoins || 0,
            });
            api.play("gameover");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        tank.resize(view.width(), view.height());
        const sh = tank.fx.shakeOffset();
        ctx.save();
        ctx.translate(sh.x, sh.y);
        tank.draw(ctx);
        ctx.restore();
    },

    drawTitle(ctx, view) {
        titleClock += 16;
        drawTitleWater(ctx, view.width(), view.height(), titleClock);
    },

    hud() {
        const slot = tank && tank.slot;
        if (!slot) return { coins: 0, day: 1, time: DAY_MS / 1000, fish: "0", pet: "-" };
        const inShop = api.getScreen() === "shop";
        const cap = Eco.maxFishCap(slot);
        return {
            coins: slot.coins,
            day: slot.day,
            time: inShop ? "—" : Math.max(0, Math.ceil((DAY_MS - tank.dayTimer) / 1000)),
            fish: (inShop ? slot.fish.length : tank.aliveFish()) + "/" + cap,
            pet: slot.activePet ? slot.activePet.toUpperCase() : "-",
        };
    },

    gameOverText(run) {
        if (!tank || !tank.slot) return "ALL YOUR FISH WERE LOST";
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return "ALL YOUR FISH WERE LOST\n\n" +
            "Best Day     " + bestDay() + tag + "\n" +
            "Total Coins  " + (tank.slot.totalCoins || 0) + "\n" +
            "Slot         " + tank.slot.slot;
    },

    onEnterScreen(name) {
        if (name === "slots") renderSlots();
        else if (name === "shop") renderShop();
        else if (name === "dayclear") renderDayClear();
        else if (name === "highscores") renderScores();
        else if (name === "settings") options.render();
    },

    onMenuAction(action, run) {
        if (action === "slots" || action === "highscores" || action === "settings" || action === "credits") return action;
        if (options.handle(action)) return null;

        const slotN = /^slot-(\d)$/.exec(action);
        if (slotN) {
            const n = Number(slotN[1]);
            api.save.set("activeSlot", n);
            api.save.save();
            tank.startSlot(n);
            return "shop";
        }
        const erase = /^erase-(\d)$/.exec(action);
        if (erase) {
            Eco.eraseSlot(Number(erase[1]));
            renderSlots();
            return null;
        }
        const shopItem = /^shop-(\d+)$/.exec(action);
        if (shopItem) {
            const res = tank.shopBuy(Number(shopItem[1]));
            api.play(res.ok ? "buy" : "buy_fail");
            renderShop();
            return null;
        }

        if (action === "start-day") {
            if (!run) return { startRun: true };
            run.dayEnded = run.ended = false;
            tank.beginDay();
            return "playing";
        }
        if (action === "shop") {                       // day clear -> shop for the next day
            tank.nextDay();
            if (run) run.dayEnded = false;
            return "shop";
        }
        if (action === "next") {                       // day clear -> straight into the next day
            tank.nextDay();
            if (run) run.dayEnded = run.ended = false;
            return "playing";
        }
        if (action === "tryagain") {
            tank.resetForRetry();
            return "shop";
        }
        return null;
    },

    // Game SFX only; menu move/select are shell-owned.
    cue(name, audio) {
        const tone = TONES[name];
        if (tone) { audio.tone(...tone); return; }
        const seq = SEQUENCES[name];
        if (seq) { audio.sequence(seq); return; }
        const coin = /^coin_(drop|get)@(\d+)$/.exec(name);
        if (coin) {
            const tier = Number(coin[2]) || 1;
            if (coin[1] === "drop") audio.tone(440 + tier * 80, 0.05, "sine", 0.45);
            else audio.tone(620 + tier * 120, 0.06, "triangle", 0.5);
        }
    },
};

const TONES = {
    feed: [280, 0.06, "triangle", 0.4],
    splash: [180, 0.05, "sine", 0.3],
    chomp: [220, 0.04, "square", 0.35],
    hit: [140, 0.05, "sawtooth", 0.5],
    fish_die: [120, 0.20, "sawtooth", 0.45],
    buy: [520, 0.05, "square", 0.45],
    buy_fail: [180, 0.08, "sawtooth", 0.45],
};
const SEQUENCES = {
    intruder_roar: [[90, 0.08, "sawtooth", 0.55], [70, 0.10, "sawtooth", 0.55]],
    intruder_die: [[220, 0.05, "square", 0.55], [160, 0.05, "square", 0.55], [100, 0.10, "square", 0.45]],
    hatch: [[500, 0.05, "square", 0.5], [620, 0.05, "square", 0.5], [780, 0.08, "square", 0.6]],
    day_end: [[523, 0.08, "square", 0.6], [659, 0.08, "square", 0.6], [784, 0.08, "square", 0.6], [1047, 0.18, "square", 0.85]],
    gameover: [[440, 0.18, "sawtooth", 0.5], [330, 0.18, "sawtooth", 0.5], [220, 0.30, "sawtooth", 0.5]],
};

// Scores used to live in their own "fintank:days" key; fold them into the save once.
function importOldScores() {
    try {
        const old = JSON.parse(localStorage.getItem("fintank:days") || "null");
        if (Array.isArray(old) && !(api.save.get("hsDays") || []).length) {
            for (const e of old) recordScore(api.save, "hsDays", { score: e.day || 0, day: e.day || 0,
                slot: e.slot || 1, totalCoins: e.totalCoins || 0 });
        }
        localStorage.removeItem("fintank:days");
    } catch (e) { /* unreadable: drop it */ }
}

function bestDay() {
    const s = tank.slot;
    return s ? s.bestDay || s.day || 1 : 0;
}

// ── Screens ──────────────────────────────────────────────────────────────

function renderSlots() {
    for (const n of SLOTS) {
        const el = document.querySelector('[data-action="slot-' + n + '"]');
        if (!Eco.slotExists(n)) { el.textContent = "SLOT " + n + " - NEW"; continue; }
        const s = Eco.loadSlot(n);
        el.textContent = "SLOT " + n + " - DAY " + s.day + " - " + s.coins + "C - " + s.fish.length + " FISH";
    }
}

function renderShop() {
    const slot = tank.slot;
    const host = $("shop-items");
    host.textContent = "";
    Eco.shopCatalog(slot).forEach((it, i) => {
        const div = document.createElement("div");
        div.className = "menu-item" + (i === 0 ? " selected" : "") + (it.disabled ? " disabled" : "");
        div.setAttribute("data-action", "shop-" + i);
        div.textContent = it.label + (it.price < 0 ? "" : "  " + it.price + "C");
        host.appendChild(div);
    });
    const start = document.createElement("div");
    start.className = "menu-item";
    start.setAttribute("data-action", "start-day");
    start.textContent = ">> START DAY " + slot.day;
    host.appendChild(start);
    $("shop-subtitle").textContent = "DAY " + slot.day + " - " + slot.coins + " COINS";
}

function renderDayClear() {
    const slot = tank.slot, today = tank.today;
    $("dayclear-stats").textContent = [
        "DAY " + slot.day + " SURVIVED",
        "FISH REMAINING: " + tank.aliveFish(),
        "COINS COLLECTED: " + today.coins,
        "INTRUDERS DEFEATED: " + today.kills,
        "BONUS: +" + today.bonus + "C",
        "BALANCE: " + slot.coins + "C",
    ].join("\n");
}

function renderScores() {
    const list = api.save.get("hsDays") || [];
    $("hs-list").textContent = list.length
        ? list.map((e, i) => (i < 9 ? " " : "") + (i + 1) + ". DAY " + e.day + "  COINS " + e.totalCoins + "  SLOT " + e.slot).join("\n")
        : "NO SCORES YET";
}

// ── Test surface (hooks.js) ──────────────────────────────────────────────

export const internals = {
    get tank() { return tank; },
    get options() { return options; },
    get api() { return api; },
};
