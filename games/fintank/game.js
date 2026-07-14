// Fintank — aquarium tend-and-defend on the arcade foundation.
// Domain: fish.js, intruders.js, pets.js, economy.js, particles.js, text.js.

import { Economy } from "/app/economy.js";
import { Particles } from "/app/particles.js";
import { Fish } from "/app/fish.js";
import { Intruders } from "/app/intruders.js";
import { Pets } from "/app/pets.js";

// ── World state (module-level sim) ──────────────────────────────────────
var slot = null;
var fish = [];
var pellets = [];
var coins = [];
var intruders = [];
var activePet = null;

var DAY_MS = 120000;
var dayTimer = 0;
var waveSchedule = [];
var waveCursor = 0;
var coinsGainedToday = 0;
var intrudersKilledToday = 0;
var nextStatus = "playing";
var lastDayBonus = 0;

var tankTop = 70, tankBottom = 760, tankLeft = 40, tankRight = 1160;
var viewW = 1200, viewH = 800;

var _play = function (/* name */) {};
var shellRef = null;
var bgT = 0;

function rand(a, b) { return a + Math.random() * (b - a); }

function computeLayout(Wd, Hd) {
    tankLeft = 30;
    tankRight = Wd - 30;
    tankTop = 70;
    tankBottom = Hd - 30;
}

function addPellet(x, y) {
    pellets.push({
        alive: true,
        x: x,
        y: (y != null ? y : tankTop + 10),
        vx: rand(-10, 10),
        vy: rand(20, 40),
        wobble: Math.random() * Math.PI * 2,
        age: 0
    });
    Particles.splash(x, tankTop);
    _play("splash");
}

function addCoin(x, y, tier, value) {
    coins.push({
        alive: true,
        x: x, y: y,
        vx: rand(-6, 6),
        vy: rand(5, 20),
        tier: tier,
        value: value,
        age: 0,
        life: 10,
        spin: Math.random() * Math.PI * 2,
        settled: false
    });
    _play("coin_drop@" + (tier || 1));
}

function collectCoin(c) {
    if (!c.alive || c._consumed) return;
    c.alive = false;
    c._consumed = true;
    slot.coins += c.value;
    slot.totalCoins = (slot.totalCoins || 0) + c.value;
    coinsGainedToday += c.value;
    _play("coin_get@" + (c.tier || 1));
    Particles.floatText(c.x, c.y - 10, "+" + c.value, "#f2c95b");
}

function onFishAte(f) {
    _play("chomp");
    Particles.spark(f.x, f.y, "#ffd080", 4);
}

function damageIntruder(iu, amt) {
    var died = Intruders.damage(iu, amt);
    if (died) {
        _play("intruder_die");
        Particles.spark(iu.x, iu.y, iu.def.color, 14);
        Particles.shake(4);
        slot.coins += iu.def.reward;
        slot.totalCoins = (slot.totalCoins || 0) + iu.def.reward;
        coinsGainedToday += iu.def.reward;
        Particles.floatText(iu.x, iu.y, "+" + iu.def.reward, "#c0ff70");
        intrudersKilledToday++;
    } else {
        _play("hit");
        Particles.spark(iu.x, iu.y, "#ff6060", 5);
    }
}

function spawnIntruder(type) {
    var def = Intruders.TYPES[type] || Intruders.TYPES.snatcher;
    var fromLeft = Math.random() < 0.5;
    var x = fromLeft ? tankLeft - 40 : tankRight + 40;
    var y = rand(tankTop + 40, tankBottom - 40);
    var iu = Intruders.makeIntruder(type, x, y, slot ? slot.day : 1);
    intruders.push(iu);
    _play("intruder_roar");
}

function onEggLay(x, y) {
    if (!slot) return;
    var cap = Economy.maxFishCap(slot);
    if (fish.filter(function (f) { return !f.dead; }).length >= cap) return;
    var nf = Fish.makeFish(1, x, y);
    nf.size = 4;
    fish.push(nf);
    Particles.spark(x, y, "#a8f06c", 8);
    _play("hatch");
}

function startGame(slotN) {
    slot = Economy.loadSlot(slotN);
    slot.slot = slotN;
    Economy.settings.activeSlot = slotN;
    Economy.saveSettings();
    if (!slot.fish || slot.fish.length === 0) {
        slot.fish = [{ tier: 1 }, { tier: 1 }];
    }
}

function enterPlayScreen() {
    Economy.saveSlot(slot);
    beginDay();
}

function beginDay() {
    fish = [];
    pellets = [];
    coins = [];
    intruders = [];
    Particles.reset();
    computeLayout(viewW, viewH);
    for (var i = 0; i < slot.fish.length; i++) {
        var def = Economy.fishById(slot.fish[i].tier) || Economy.FISH_TIERS[0];
        var x = rand(tankLeft + 50, tankRight - 50);
        var y = rand(tankTop + 60, tankBottom - 60);
        var f = Fish.makeFish(def.id, x, y);
        f.size = def.size; f.grown = true; f.hunger = 80;
        fish.push(f);
    }
    activePet = slot.activePet ? Pets.makeActivePet(slot.activePet) : null;

    dayTimer = 0;
    coinsGainedToday = 0;
    intrudersKilledToday = 0;
    lastDayBonus = 0;
    waveSchedule = Intruders.spawnWaveForDay(slot.day, Math.random);
    waveCursor = 0;
    nextStatus = "playing";
}

function tick(ms) {
    if (!slot) return;
    computeLayout(viewW, viewH);

    dayTimer += ms;

    while (waveCursor < waveSchedule.length && waveSchedule[waveCursor].t <= dayTimer) {
        spawnIntruder(waveSchedule[waveCursor].type);
        waveCursor++;
    }

    var worldCtx = {
        Wd: viewW, Hd: viewH,
        tankLeft: tankLeft, tankRight: tankRight, tankTop: tankTop, tankBottom: tankBottom,
        fish: fish, pellets: pellets, coins: coins, intruders: intruders,
        pelletTier: function () { return slot.pelletTier; },
        filterMult: function () { return Economy.filterMult(slot); },
        onCoinDrop: function (x, y, tier, val) { addCoin(x, y, tier, val); },
        onFishAte: onFishAte,
        onEggLay: onEggLay,
        onFishEaten: function (f) {
            _play("fish_die");
            Particles.spark(f.x, f.y, "#ff6080", 10);
        },
        onCoinTaken: function (c) {
            Particles.spark(c.x, c.y, "#ff4040", 6);
        },
        addPellet: function (x, y) { addPellet(x, y != null ? y : tankTop + 20); },
        addCoinAt: function (x, y, tier, val) { addCoin(x, y, tier, val); },
        collectCoin: collectCoin,
        damageIntruder: damageIntruder,
        onAlchemUpgrade: function (c) { Particles.spark(c.x, c.y, "#b06acb", 6); }
    };

    for (var i = fish.length - 1; i >= 0; i--) {
        Fish.step(fish[i], ms, worldCtx);
        if (fish[i]._despawn) fish.splice(i, 1);
    }

    for (var j = pellets.length - 1; j >= 0; j--) {
        var p = pellets[j];
        p.age += ms;
        p.wobble += ms / 200;
        p.x += Math.sin(p.wobble) * 12 * (ms / 1000);
        p.y += p.vy * (ms / 1000);
        if (!p.alive || p._consumed || p.y > tankBottom - 10 || p.age > 12000) {
            pellets.splice(j, 1);
        }
    }

    for (var k = coins.length - 1; k >= 0; k--) {
        var c = coins[k];
        c.age += ms / 1000;
        c.spin += ms / 80;
        if (!c.settled) {
            c.x += c.vx * (ms / 1000);
            c.y += c.vy * (ms / 1000);
            c.vy += 30 * (ms / 1000);
            if (c.y > tankBottom - 12) {
                c.y = tankBottom - 12;
                c.vy = 0; c.vx = 0; c.settled = true;
            }
        }
        if (c.age >= c.life || c._consumed) {
            coins.splice(k, 1);
        }
    }

    for (var m = intruders.length - 1; m >= 0; m--) {
        Intruders.step(intruders[m], ms, worldCtx);
        if (intruders[m]._despawn) intruders.splice(m, 1);
    }

    if (activePet) Pets.step(activePet, ms, worldCtx);

    Particles.update(ms, viewW, viewH);

    for (var q = fish.length - 1; q >= 0; q--) {
        if (fish[q].dead && fish[q].y < tankTop - 10) fish.splice(q, 1);
    }

    var aliveFish = 0;
    for (var r = 0; r < fish.length; r++) if (!fish[r].dead) aliveFish++;
    if (aliveFish === 0 && slot.fish.length > 0) {
        slot.fish = [];
        Economy.saveSlot(slot);
        nextStatus = "gameover";
    }
    if (dayTimer >= DAY_MS && nextStatus === "playing") {
        endDay();
    }
}

function endDay() {
    var invNext = [];
    for (var i = 0; i < fish.length; i++) if (!fish[i].dead) invNext.push({ tier: fish[i].tier });
    slot.fish = invNext;
    var bonus = invNext.length * 25 + slot.day * 20;
    slot.coins += bonus;
    slot.totalCoins = (slot.totalCoins || 0) + bonus;
    lastDayBonus = bonus;
    if (slot.day > (slot.bestDay || 0)) slot.bestDay = slot.day;
    Economy.saveSlot(slot);
    nextStatus = "dayclear";
}

function advanceToNextDay() {
    slot.day = (slot.day || 1) + 1;
    Economy.saveSlot(slot);
    beginDay();
}

function resetSlotForRetry() {
    slot.fish = [{ tier: 1 }, { tier: 1 }];
    slot.day = 1;
    slot.coins = Math.max(slot.coins, 150);
    Economy.saveSlot(slot);
}

function shopBuyAt(idx) {
    var items = Economy.shopCatalog(slot);
    var it = items[idx];
    if (!it || it.disabled) return { ok: false };
    var res;
    if (it.kind === "pellet") res = Economy.buyPelletNext(slot);
    else if (it.kind === "fish") res = Economy.buyFish(slot, it.id);
    else if (it.kind === "upgrade") res = Economy.buyUpgrade(slot, it.id);
    else if (it.kind === "pet") res = Economy.buyPet(slot, it.id);
    else res = { ok: false };
    if (res.ok) Economy.saveSlot(slot);
    return res;
}

function buy(item) {
    if (!slot) return { ok: false };
    var res;
    if (item === "pellet") res = Economy.buyPelletNext(slot);
    else if (item.indexOf("fish_tier") === 0) {
        var t = parseInt(item.substr("fish_tier".length), 10);
        res = Economy.buyFish(slot, t);
        if (res.ok) {
            computeLayout(viewW, viewH);
            var f = Fish.makeFish(t, rand(tankLeft + 60, tankRight - 60), rand(tankTop + 60, tankBottom - 60));
            f.size = f.def.size * 0.6;
            fish.push(f);
        }
    } else if (item.indexOf("upgrade_") === 0) {
        res = Economy.buyUpgrade(slot, item.substr("upgrade_".length));
    } else if (item.indexOf("pet_") === 0) {
        var pid = item.substr("pet_".length);
        res = Economy.buyPet(slot, pid);
        if (res.ok) {
            activePet = Pets.makeActivePet(pid);
            slot.activePet = pid;
        }
    } else res = { ok: false, reason: "UNKNOWN" };
    if (res && res.ok) Economy.saveSlot(slot);
    return res;
}

function quickBuy(n) {
    if (n === 1) buy("pellet");
    else if (n >= 2 && n <= 6) buy("fish_tier" + (n - 1));
}

function quickFeed() {
    var cx = (tankLeft + tankRight) / 2;
    for (var i = 0; i < 5; i++) {
        addPellet(cx + (i - 2) * 40, tankTop + 20);
    }
}

function clickAt(x, y) {
    for (var i = 0; i < intruders.length; i++) {
        var iu = intruders[i];
        if (iu.dead) continue;
        if (Math.hypot(iu.x - x, iu.y - y) < iu.def.size + 6) {
            damageIntruder(iu, 1);
            return;
        }
    }
    for (var j = coins.length - 1; j >= 0; j--) {
        var c = coins[j];
        if (!c.alive || c._consumed) continue;
        if (Math.hypot(c.x - x, c.y - y) < 20) {
            collectCoin(c);
            return;
        }
    }
    if (y > tankTop + 5 && y < tankBottom - 5 && x > tankLeft && x < tankRight) {
        addPellet(x, tankTop + 15);
        _play("feed");
    }
}

function drawTank(dctx, Wd, Hd) {
    computeLayout(Wd, Hd);
    var g = dctx.createLinearGradient(0, tankTop, 0, tankBottom);
    var lightMult = slot ? Economy.lightMult(slot) : 1.0;
    var topCol = shadeHex("#155874", lightMult - 1);
    var botCol = shadeHex("#061a2a", 0);
    g.addColorStop(0, topCol);
    g.addColorStop(1, botCol);
    dctx.fillStyle = g;
    dctx.fillRect(0, 0, Wd, Hd);

    dctx.strokeStyle = "#2a5068";
    dctx.lineWidth = 3;
    dctx.strokeRect(tankLeft, tankTop, tankRight - tankLeft, tankBottom - tankTop);

    dctx.fillStyle = "#1a2840";
    dctx.fillRect(tankLeft, tankBottom - 14, tankRight - tankLeft, 14);
    for (var gi = 0; gi < 40; gi++) {
        var gx = tankLeft + (gi / 40) * (tankRight - tankLeft) + (gi * 17 % 20);
        dctx.fillStyle = gi % 3 === 0 ? "#283b58" : "#334768";
        dctx.fillRect(gx, tankBottom - 12 + (gi % 3), 6, 4);
    }

    drawPlant(dctx, tankLeft + 80, tankBottom - 14, 100);
    drawPlant(dctx, tankRight - 80, tankBottom - 14, 120);

    Particles.draw(dctx);

    for (var i = 0; i < pellets.length; i++) {
        var p = pellets[i];
        dctx.fillStyle = pelletColor(slot ? slot.pelletTier : 1);
        dctx.beginPath();
        dctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        dctx.fill();
        dctx.fillStyle = "#ffffff";
        dctx.globalAlpha = 0.4;
        dctx.beginPath();
        dctx.arc(p.x - 1.5, p.y - 1.5, 1.2, 0, Math.PI * 2);
        dctx.fill();
        dctx.globalAlpha = 1;
    }

    for (var j = 0; j < coins.length; j++) drawCoin(dctx, coins[j]);
    for (var k = 0; k < fish.length; k++) Fish.draw(dctx, fish[k]);
    for (var m = 0; m < intruders.length; m++) Intruders.draw(dctx, intruders[m]);
    if (activePet) Pets.draw(dctx, activePet);
}

function drawCoin(dctx, c) {
    var tierColor = ["#f2c95b", "#f2c95b", "#ffd890", "#ffec70", "#fff6a0", "#d8c0ff", "#ffe0ff"];
    var col = tierColor[c.tier] || "#f2c95b";
    var fade = c.age > c.life - 3 ? Math.max(0.3, 1 - (c.age - (c.life - 3)) / 3) : 1.0;
    dctx.save();
    dctx.translate(c.x, c.y);
    dctx.rotate(c.spin);
    dctx.globalAlpha = fade;
    dctx.fillStyle = col;
    var sw = 10 + c.tier * 2;
    dctx.beginPath();
    dctx.ellipse(0, 0, sw, Math.abs(Math.cos(c.spin)) * sw, 0, 0, Math.PI * 2);
    dctx.fill();
    dctx.fillStyle = "#8a6020";
    dctx.fillRect(-2, -4, 4, 8);
    dctx.restore();
    dctx.globalAlpha = 1;
}

function drawPlant(dctx, x, yBase, h) {
    dctx.strokeStyle = "#2a6a3a";
    dctx.lineWidth = 3;
    dctx.beginPath();
    for (var i = 0; i < 5; i++) {
        var swayX = x + Math.sin(i * 0.6 + performance.now() / 800) * 8;
        var y = yBase - (i / 5) * h;
        if (i === 0) dctx.moveTo(swayX, yBase);
        dctx.lineTo(swayX + (i % 2 === 0 ? -4 : 4), y);
    }
    dctx.stroke();
}

function pelletColor(tier) {
    return ["#ffd08c", "#ffd08c", "#ffb050", "#c0f070", "#e0c0ff"][tier] || "#ffd08c";
}

function shadeHex(hex, pct) {
    var c = hex.replace("#", "");
    var r = parseInt(c.substr(0, 2), 16);
    var g = parseInt(c.substr(2, 2), 16);
    var b = parseInt(c.substr(4, 2), 16);
    function m(x) { return Math.max(0, Math.min(255, Math.round(x + (pct > 0 ? (255 - x) : x) * pct))); }
    return "rgb(" + m(r) + "," + m(g) + "," + m(b) + ")";
}

function dayStats() {
    return {
        day: slot.day,
        fishCount: fish.filter(function (f) { return !f.dead; }).length,
        coinsGainedToday: coinsGainedToday,
        intrudersKilled: intrudersKilledToday,
        bonus: lastDayBonus,
        coins: slot.coins
    };
}

function gameOverStats() {
    return { bestDay: slot.bestDay || slot.day, totalCoins: slot.totalCoins || 0, slot: slot.slot };
}

function drawBg(ctx, Wd, Hd) {
    bgT += 16;
    var g = ctx.createLinearGradient(0, 0, 0, Hd);
    g.addColorStop(0, "#08283a");
    g.addColorStop(1, "#020e1a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Wd, Hd);
    for (var i = 0; i < 6; i++) {
        ctx.globalAlpha = 0.04 + (i % 2) * 0.02;
        ctx.strokeStyle = "#5fc0ff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        var y = (i * 120 + (bgT * 0.02) % 120);
        for (var x = 0; x <= Wd; x += 20) {
            var yy = y + Math.sin((x + bgT * 0.01 + i * 30) * 0.03) * 6;
            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function refreshSlotLabels() {
    for (var n = 1; n <= 3; n++) {
        var el = document.querySelector('[data-action="slot-' + n + '"]');
        if (!el) continue;
        var s = Economy.loadSlot(n);
        var fresh = (s.day === 1 && s.fish.length === 0 && s.coins === 200 && !s.bestDay);
        el.textContent = "SLOT " + n + (fresh ? " - NEW"
            : " - DAY " + s.day + " - " + s.coins + "C - " + s.fish.length + " FISH");
    }
}

function rebuildShop() {
    if (!slot) return;
    var items = Economy.shopCatalog(slot);
    var host = document.getElementById("shop-items");
    if (!host) return;
    host.innerHTML = "";
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var div = document.createElement("div");
        div.className = "menu-item";
        if (i === 0) div.classList.add("selected");
        if (it.disabled) div.classList.add("disabled");
        div.setAttribute("data-action", "shop-" + i);
        var priceStr = it.price < 0 ? "" : ("  " + it.price + "C");
        div.textContent = it.label + priceStr;
        host.appendChild(div);
    }
    var next = document.createElement("div");
    next.className = "menu-item";
    next.setAttribute("data-action", "start-day");
    next.textContent = ">> START DAY " + slot.day;
    host.appendChild(next);

    var title = document.getElementById("shop-subtitle");
    if (title) title.textContent = "DAY " + slot.day + " - " + slot.coins + " COINS";
}

/** One listener set per canvas; always targets the latest view on that canvas. */
function attachPointer(view) {
    if (!view || !view.canvas) return;
    var canvas = view.canvas;
    canvas._fintankView = view;
    if (canvas._fintankPointer) return;
    canvas._fintankPointer = true;
    canvas.addEventListener("mousedown", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        var v = canvas._fintankView;
        if (!v) return;
        var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
        var W = v.width(), H = v.height();
        var x, y;
        if (rect) {
            x = (e.clientX - rect.left) * (W / (rect.width || W));
            y = (e.clientY - rect.top) * (H / (rect.height || H));
        } else if (typeof e.offsetX === "number") {
            x = e.offsetX;
            y = e.offsetY;
        } else {
            x = e.clientX;
            y = e.clientY;
        }
        clickAt(x, y);
    });
}

// Public Game facade for tests / shop
export const Game = {
    startGame: startGame,
    getSlot: function () { return slot; },
    enterPlayScreen: enterPlayScreen,
    onEnterPlay: function () {
        if (!fish.length && slot) beginDay();
    },
    tick: tick,
    draw: drawTank,
    status: function () { return nextStatus; },
    dayStats: dayStats,
    gameOverStats: gameOverStats,
    shopBuyAt: shopBuyAt,
    buy: buy,
    quickBuy: quickBuy,
    quickFeed: quickFeed,
    clickAt: clickAt,
    advanceToNextDay: advanceToNextDay,
    resetSlotForRetry: resetSlotForRetry,
    _state: function () {
        return {
            slot: slot, fish: fish, pellets: pellets, coins: coins,
            intruders: intruders, pet: activePet, dayTimer: dayTimer
        };
    },
    _forceEndDay: function () { endDay(); },
    _addCoins: function (n) {
        slot.coins += n;
        slot.totalCoins = (slot.totalCoins || 0) + n;
        Economy.saveSlot(slot);
    },
    _addPellet: addPellet,
    _addCoin: addCoin,
    _spawnIntruder: spawnIntruder,
    _killAllIntruders: function () {
        for (var i = 0; i < intruders.length; i++) {
            if (!intruders[i].dead) {
                intruders[i].dead = true;
                intrudersKilledToday++;
            }
        }
    },
    _collectAllCoins: function () {
        for (var i = 0; i < coins.length; i++) {
            if (coins[i].alive && !coins[i]._consumed) collectCoin(coins[i]);
        }
    },
    _feedFish: function (index) {
        var f = fish[index || 0];
        if (!f) return;
        f.hasFood = true;
        f.coinTimer = 100;
        f.hunger = 100;
    }
};

// ── Arcade plugin ───────────────────────────────────────────────────────

export const game = {
    id: "fintank",
    clearColor: "#020e1a",
    hudScreens: ["shop", "dayclear"],

    actions: [
        { name: "primary", label: "Quick feed", defaults: [" "] },
    ],

    defaults: {
        highScore: 0,
        difficulty: 1,
        sfxVol: 80,
    },

    create(ctx) {
        _play = function (name) { ctx.play(name); };
        if (ctx.save.get("difficulty") != null) {
            Economy.settings.difficulty = ctx.save.get("difficulty");
        }
        if (!slot) startGame(Economy.settings.activeSlot || 1);
        enterPlayScreen();
        attachPointer(ctx.view);
        viewW = ctx.view.width();
        viewH = ctx.view.height();

        return {
            score: slot.bestDay || slot.day || 1,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            view: ctx.view,
            ended: false,
            dayEnded: false,
        };
    },

    update(run, dt, input) {
        if (run.view) {
            viewW = run.view.width();
            viewH = run.view.height();
        }

        if (input.pressed("primary")) quickFeed();
        // Number keys via raw keyboard not in arcade actions — wire via secondary poll:
        // Arcade input only exposes named actions; map confirm-less digit keys via window is
        // avoided. Hotkeys 1-5 still useful: attach once.
        ensureHotkeys();

        tick(dt);
        run.score = slot ? (slot.bestDay || slot.day || 0) : 0;

        if (nextStatus === "dayclear" && !run.dayEnded) {
            run.dayEnded = true;
            _play("day_end");
            return { status: "screen", name: "dayclear" };
        }
        if (nextStatus === "gameover" && !run.ended) {
            run.ended = true;
            Economy.addHS({
                day: slot.bestDay || slot.day,
                slot: slot.slot,
                totalCoins: slot.totalCoins || 0
            });
            if (run.save) {
                run.save.maybeHighScore(slot.bestDay || slot.day || 0);
            }
            _play("gameover");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        var size = view.size();
        viewW = size.w;
        viewH = size.h;
        var sh = Particles.shakeOffset();
        ctx.save();
        ctx.translate(sh.x, sh.y);
        drawTank(ctx, size.w, size.h);
        ctx.restore();
    },

    drawTitle(ctx, view) {
        var size = view.size();
        drawBg(ctx, size.w, size.h);
    },

    hud(run) {
        if (!slot) {
            return { coins: 0, day: 1, time: 120, fish: "0", pet: "-" };
        }
        var secLeft = Math.max(0, Math.ceil((DAY_MS - dayTimer) / 1000));
        var aliveFish = 0;
        for (var i = 0; i < fish.length; i++) if (!fish[i].dead) aliveFish++;
        // On shop before a day, fish array may be empty — show inventory count
        var fishDisp = (shellRef && shellRef.getScreen() === "shop")
            ? (slot.fish.length + "/" + Economy.maxFishCap(slot))
            : (aliveFish + "/" + Economy.maxFishCap(slot));
        return {
            coins: slot.coins,
            day: slot.day,
            time: (shellRef && shellRef.getScreen() === "shop") ? "—" : secLeft,
            fish: fishDisp,
            pet: slot.activePet ? slot.activePet.toUpperCase() : "-",
        };
    },

    gameOverText(run) {
        if (!slot) return "ALL YOUR FISH WERE LOST";
        var st = gameOverStats();
        var tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "ALL YOUR FISH WERE LOST\n\n" +
            "Best Day     " + st.bestDay + tag + "\n" +
            "Total Coins  " + st.totalCoins + "\n" +
            "Slot         " + st.slot
        );
    },

    onEnterScreen(name, run, api) {
        if (name === "slots") {
            refreshSlotLabels();
        }
        if (name === "shop") {
            rebuildShop();
        }
        if (name === "dayclear") {
            var st = dayStats();
            var el = document.getElementById("dayclear-stats");
            if (el) {
                el.textContent = [
                    "DAY " + st.day + " SURVIVED",
                    "FISH REMAINING: " + st.fishCount,
                    "COINS COLLECTED: " + st.coinsGainedToday,
                    "INTRUDERS DEFEATED: " + st.intrudersKilled,
                    "BONUS: +" + st.bonus + "C",
                    "BALANCE: " + st.coins + "C",
                ].join("\n");
            }
        }
        if (name === "highscores") {
            renderHS();
        }
        if (name === "settings") {
            renderSettings(api);
        }
    },

    onMenuAction(action, run, api) {
        if (action === "play" || action === "slots") return "slots";
        if (action === "highscores") return "highscores";
        if (action === "settings") return "settings";
        if (action === "credits") return "credits";

        if (action === "slot-1" || action === "slot-2" || action === "slot-3") {
            var n = parseInt(action.split("-")[1], 10);
            startGame(n);
            return "shop";
        }
        if (action === "erase-1" || action === "erase-2" || action === "erase-3") {
            Economy.eraseSlot(parseInt(action.split("-")[1], 10));
            refreshSlotLabels();
            return null;
        }

        if (action === "start-day") {
            // From shop → begin day (create/restart run)
            if (run) {
                // Existing run (after dayclear path that kept run): just re-enter play
                run.dayEnded = false;
                run.ended = false;
                enterPlayScreen();
                return "playing";
            }
            return { startRun: true };
        }

        if (action.indexOf("shop-") === 0) {
            var idx = parseInt(action.slice(5), 10);
            var res = shopBuyAt(idx);
            if (res && res.ok) _play("buy");
            else _play("buy_fail");
            rebuildShop();
            return null;
        }

        if (action === "shop") {
            // dayclear → shop (advance day first)
            advanceToNextDay();
            if (run) {
                run.dayEnded = false;
            }
            return "shop";
        }
        if (action === "next") {
            // dayclear → next day immediately
            advanceToNextDay();
            if (run) {
                run.dayEnded = false;
                run.ended = false;
            }
            return "playing";
        }

        if (action === "tryagain" || action === "restart") {
            // gameover try again → shop (not immediate play)
            resetSlotForRetry();
            return "shop";
        }

        if (action === "cycle-difficulty") {
            var d = Economy.settings.difficulty | 0;
            d = (d + 1) % 3;
            Economy.settings.difficulty = d;
            Economy.saveSettings();
            if (api && api.save) {
                api.save.set("difficulty", d);
                api.save.save();
            }
            renderSettings(api);
            return null;
        }
        if (action === "cycle-sfx") {
            var v = Economy.settings.sfxVol | 0;
            v = (v + 10) % 110;
            Economy.settings.sfxVol = v;
            Economy.saveSettings();
            if (api && api.audio && api.audio.setSfxVol) api.audio.setSfxVol(v / 100);
            if (api && api.save) {
                api.save.set("sfxVol", v);
                api.save.save();
            }
            renderSettings(api);
            return null;
        }

        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "feed") audio.tone(280, 0.06, "triangle", 0.4);
        else if (name === "splash") audio.tone(180, 0.05, "sine", 0.3);
        else if (name === "chomp") audio.tone(220, 0.04, "square", 0.35);
        else if (name === "hit") audio.tone(140, 0.05, "sawtooth", 0.5);
        else if (name === "fish_die") audio.tone(120, 0.20, "sawtooth", 0.45);
        else if (name === "buy") audio.tone(520, 0.05, "square", 0.45);
        else if (name === "buy_fail") audio.tone(180, 0.08, "sawtooth", 0.45);
        else if (name === "intruder_roar") {
            audio.sequence([
                [90, 0.08, "sawtooth", 0.55],
                [70, 0.10, "sawtooth", 0.55],
            ]);
        } else if (name === "intruder_die") {
            audio.sequence([
                [220, 0.05, "square", 0.55],
                [160, 0.05, "square", 0.55],
                [100, 0.10, "square", 0.45],
            ]);
        } else if (name === "hatch") {
            audio.sequence([
                [500, 0.05, "square", 0.5],
                [620, 0.05, "square", 0.5],
                [780, 0.08, "square", 0.6],
            ]);
        } else if (name === "day_end") {
            audio.sequence([
                [523, 0.08, "square", 0.6],
                [659, 0.08, "square", 0.6],
                [784, 0.08, "square", 0.6],
                [1047, 0.18, "square", 0.85],
            ]);
        } else if (name === "gameover") {
            audio.sequence([
                [440, 0.18, "sawtooth", 0.5],
                [330, 0.18, "sawtooth", 0.5],
                [220, 0.30, "sawtooth", 0.5],
            ]);
        } else if (name.indexOf("coin_drop@") === 0) {
            var t1 = parseInt(name.slice(10), 10) || 1;
            audio.tone(440 + t1 * 80, 0.05, "sine", 0.45);
        } else if (name.indexOf("coin_get@") === 0) {
            var t2 = parseInt(name.slice(9), 10) || 1;
            audio.tone(620 + t2 * 120, 0.06, "triangle", 0.5);
        }
    },
};

function renderHS() {
    var out = document.getElementById("hs-list");
    if (!out) return;
    var list = Economy.listHS();
    if (!list.length) { out.textContent = "NO SCORES YET"; return; }
    out.textContent = list.map(function (e, i) {
        var rank = (i + 1) + ".";
        if (i < 9) rank = " " + rank;
        return rank + " DAY " + (e.day || 0) + "  COINS " + (e.totalCoins || 0) + "  SLOT " + (e.slot || "?");
    }).join("\n");
}

function renderSettings(api) {
    var s = Economy.settings;
    var el;
    el = document.getElementById("opt-sfxVol");
    if (el) el.textContent = String(s.sfxVol);
    el = document.getElementById("opt-difficulty");
    if (el) el.textContent = Economy.difficultyLabel();
}

var hotkeysWired = false;
function ensureHotkeys() {
    if (hotkeysWired) return;
    hotkeysWired = true;
    window.addEventListener("keydown", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        if (e.repeat) return;
        if (/^[1-5]$/.test(e.key)) {
            quickBuy(parseInt(e.key, 10));
        }
    });
}

export function installTestHooks(shell) {
    shellRef = shell;

    var Screens = {
        switchTo: function (name) {
            if (name === "playing" || name === "play") {
                if (!shell.getRun()) {
                    if (!slot) startGame(1);
                    shell.startRun();
                } else {
                    shell.switchTo("playing");
                }
            } else if (name === "gameOver" || name === "gameover") {
                shell.switchTo("gameover");
            } else if (name === "howtoplay") {
                shell.switchTo("howto");
            } else {
                shell.switchTo(name);
            }
        },
        manager: function () {
            return {
                name: function () { return shell.getScreen(); },
                current: function () { return null; },
            };
        },
    };

    window.__fintank = {
        F: {
            Economy: Economy,
            Particles: Particles,
            Fish: Fish,
            Intruders: Intruders,
            Pets: Pets,
            Screens: Screens,
            Game: Game,
        },
        state: function () { return Game._state(); },
        feed: function (x) { Game._addPellet(x != null ? x : 600, 100); },
        buy: function (item) { return Game.buy(item); },
        addCoins: function (n) { Game._addCoins(n); },
        spawnIntruder: function (type) { Game._spawnIntruder(type || "snatcher"); },
        killAllIntruders: function () { Game._killAllIntruders(); },
        collectAllCoins: function () { Game._collectAllCoins(); },
        feedFish: function (i) { Game._feedFish(i); },
        endDay: function () { Game._forceEndDay(); },
        dayProgress: function () { var s = Game._state(); return s.dayTimer; },
        screens: Screens,
        game: Game,
        economy: Economy,
        shell: shell,
    };
}
