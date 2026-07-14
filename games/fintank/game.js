// Fintank — arcade plugin (screens, HUD, cues, test hooks).
// Domain: tank.js + fish/intruders/pets/economy. Shell owns menus / pause.

import { Economy } from "/app/economy.js";
import { Particles } from "/app/particles.js";
import { Fish } from "/app/fish.js";
import { Intruders } from "/app/intruders.js";
import { Pets } from "/app/pets.js";
import {
    Game,
    setPlay,
    playCue,
    setShellRef,
    getShellRef,
    startGame,
    enterPlayScreen,
    attachPointer,
    tick,
    drawTank,
    drawBg,
    getSlot,
    getDayTimer,
    getDayMs,
    getFish,
    getNextStatus,
    dayStats,
    gameOverStats,
    rebuildShop,
    refreshSlotLabels,
    shopBuyAt,
    advanceToNextDay,
    resetSlotForRetry,
    quickFeed,
    quickBuy,
    setViewSize,
} from "/app/tank.js";

// Re-export for any import of Game from game.js.
export { Game };

// ── Plugin ───────────────────────────────────────────────────────────────

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
        setPlay(function (name) { ctx.play(name); });
        if (ctx.save.get("difficulty") != null) {
            Economy.settings.difficulty = ctx.save.get("difficulty");
        }
        if (!getSlot()) startGame(Economy.settings.activeSlot || 1);
        enterPlayScreen();
        attachPointer(ctx.view);
        setViewSize(ctx.view.width(), ctx.view.height());

        var slot = getSlot();
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
        if (run.view) setViewSize(run.view.width(), run.view.height());

        if (input.pressed("primary")) quickFeed();
        ensureHotkeys();

        tick(dt);
        var slot = getSlot();
        run.score = slot ? (slot.bestDay || slot.day || 0) : 0;

        var nextStatus = getNextStatus();
        if (nextStatus === "dayclear" && !run.dayEnded) {
            run.dayEnded = true;
            run.play("day_end");
            return { status: "screen", name: "dayclear" };
        }
        if (nextStatus === "gameover" && !run.ended) {
            run.ended = true;
            Economy.addHS({
                day: slot.bestDay || slot.day,
                slot: slot.slot,
                totalCoins: slot.totalCoins || 0,
            });
            if (run.save) {
                run.save.maybeHighScore(slot.bestDay || slot.day || 0);
            }
            run.play("gameover");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        var size = view.size();
        setViewSize(size.w, size.h);
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
        var slot = getSlot();
        if (!slot) {
            return { coins: 0, day: 1, time: 120, fish: "0", pet: "-" };
        }
        var dayTimer = getDayTimer();
        var DAY_MS = getDayMs();
        var fish = getFish();
        var secLeft = Math.max(0, Math.ceil((DAY_MS - dayTimer) / 1000));
        var aliveFish = 0;
        for (var i = 0; i < fish.length; i++) if (!fish[i].dead) aliveFish++;
        var shell = getShellRef();
        var fishDisp = (shell && shell.getScreen() === "shop")
            ? (slot.fish.length + "/" + Economy.maxFishCap(slot))
            : (aliveFish + "/" + Economy.maxFishCap(slot));
        return {
            coins: slot.coins,
            day: slot.day,
            time: (shell && shell.getScreen() === "shop") ? "—" : secLeft,
            fish: fishDisp,
            pet: slot.activePet ? slot.activePet.toUpperCase() : "-",
        };
    },

    gameOverText(run) {
        if (!getSlot()) return "ALL YOUR FISH WERE LOST";
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
        if (name === "slots") refreshSlotLabels();
        if (name === "shop") rebuildShop();
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
        if (name === "highscores") renderHS();
        if (name === "settings") renderSettings(api);
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
            if (run) {
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
            playCue(res && res.ok ? "buy" : "buy_fail");
            rebuildShop();
            return null;
        }

        if (action === "shop") {
            advanceToNextDay();
            if (run) run.dayEnded = false;
            return "shop";
        }
        if (action === "next") {
            advanceToNextDay();
            if (run) {
                run.dayEnded = false;
                run.ended = false;
            }
            return "playing";
        }

        if (action === "tryagain" || action === "restart") {
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

// ── Shell chrome helpers ─────────────────────────────────────────────────

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
        var shell = getShellRef();
        if (!shell || shell.getScreen() !== "playing") return;
        if (e.repeat) return;
        if (/^[1-5]$/.test(e.key)) {
            quickBuy(parseInt(e.key, 10));
        }
    });
}

// ── Test hooks ───────────────────────────────────────────────────────────

export function installTestHooks(shell) {
    setShellRef(shell);
    if (shell.api && shell.api.play) {
        setPlay(function (name) { shell.api.play(name); });
    }

    var Screens = {
        switchTo: function (name) {
            if (name === "playing" || name === "play") {
                if (!shell.getRun()) {
                    if (!getSlot()) startGame(1);
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
