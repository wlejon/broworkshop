// Arcade shell — boot a game plugin with shared screens, HUD, loop, and input.
//
// Games implement a plugin object and call:
//
//   import { boot } from "/lib/arcade/shell.js";
//   import { game } from "/app/game.js";
//   boot(game);
//
// See /lib/arcade/README.md for the full contract.

import { createLoop } from "/lib/arcade/loop.js";
import { createView } from "/lib/arcade/view.js";
import { createInput, STANDARD_ACTIONS } from "/lib/arcade/input.js";
import { createAudio } from "/lib/arcade/audio.js";
import { createSave } from "/lib/arcade/save.js";

/**
 * Boot the arcade shell with a game plugin.
 * @param {object} game
 * @param {object} [opts]
 */
export function boot(game, opts = {}) {
    if (!game || !game.id) {
        throw new Error("arcade.boot: game.id is required");
    }
    if (typeof game.create !== "function") {
        throw new Error("arcade.boot: game.create is required");
    }

    const audio = createAudio();
    audio.init();

    const save = createSave(game.id);
    save.load(Object.assign({ highScore: 0 }, game.defaults || {}));

    const actions = mergeActions(STANDARD_ACTIONS, game.actions);
    const input = createInput(actions, { storageKey: game.id + "_input" });
    input.attach(window);

    const view = createView({
        canvas: opts.canvas || "#view",
        width: opts.width || 800,
        height: opts.height || 700,
        clearColor: game.clearColor || "#000",
    });

    const overlay = document.getElementById("overlay");
    const hudEl = document.getElementById("hud");

    /** @type {object|null} */
    let run = null;
    let screen = "title";
    let menuIndex = 0;
    let mouseWired = false;

    const api = {
        audio,
        save,
        input,
        view,
        /**
         * Play a named cue. Menu navigation tones are owned by the shell
         * (`menu` / `select`). Game-specific names go to game.cue.
         */
        play(name) {
            if (name === "menu" || name === "select") {
                if (game.cueMenu) game.cueMenu(name, audio);
                else defaultCue(name, audio);
                return;
            }
            if (game.cue) game.cue(name, audio);
        },
        highScore() {
            return save.highScore();
        },
        /** Switch shell screen (e.g. custom "levelclear"). Prefer returning status from update. */
        switchTo(name) {
            switchTo(name);
        },
        getScreen() {
            return screen;
        },
    };

    // ── Screens ──────────────────────────────────────────────────────────

    function showScreen(name) {
        if (!overlay) return;
        const children = overlay.children;
        for (let i = 0; i < children.length; i++) {
            const el = children[i];
            const id = el.id || "";
            const match = id === "screen-" + name;
            el.hidden = !match;
            el.style.display = match ? "" : "none";
        }
        overlay.hidden = false;
        overlay.style.display = "";
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.hidden = true;
        overlay.style.display = "none";
    }

    function setHudVisible(on) {
        if (!hudEl) return;
        hudEl.hidden = !on;
        hudEl.style.display = on ? "" : "none";
    }

    function wantsHud(name) {
        if (name === "playing" || name === "pause" || name === "gameover") return true;
        // Custom mid-run screens (levelclear, wave, …) keep the HUD when a run exists.
        if (run && name !== "title" && name !== "howto") return true;
        if (game.hudScreens && game.hudScreens.indexOf(name) >= 0) return true;
        return false;
    }

    function getMenuItems() {
        const root = document.getElementById("screen-" + screen);
        if (!root) return [];
        const out = [];
        const items = root.querySelectorAll(".menu-item");
        for (let i = 0; i < items.length; i++) {
            if (!items[i].classList.contains("disabled")) out.push(items[i]);
        }
        return out;
    }

    function updateMenuSelection() {
        const items = getMenuItems();
        for (let i = 0; i < items.length; i++) {
            items[i].classList.toggle("selected", i === menuIndex);
        }
    }

    function switchTo(name) {
        screen = name;
        menuIndex = 0;

        if (name === "playing") {
            hideOverlay();
            setHudVisible(true);
        } else {
            showScreen(name);
            setHudVisible(wantsHud(name));
            updateMenuSelection();
            if (overlay) overlay.scrollTop = 0;
        }

        if (name === "gameover") {
            fillGameOver();
        }

        refreshHud();
        if (game.onEnterScreen) game.onEnterScreen(name, run, api);
        ensureMouse();
    }

    function fillGameOver() {
        const el = document.getElementById("gameover-stats");
        if (!el) return;
        if (game.gameOverText) {
            el.textContent = game.gameOverText(run, run && run._result ? run._result : null);
            return;
        }
        const score = run && run.score != null ? run.score : 0;
        const best = save.highScore();
        const isNew = run && run._newBest;
        el.textContent =
            "Score:  " + score + (isNew ? "  (NEW BEST!)" : "") + "\n" +
            "Best:   " + best;
    }

    function refreshHud() {
        if (!hudEl || !game.hud) return;
        const values = game.hud(run) || {};
        for (const key in values) {
            if (values[key] == null) continue;
            const el = document.getElementById("hud-" + key);
            if (el) el.textContent = String(values[key]);
        }
        const bestEl = document.getElementById("hud-best");
        if (bestEl && values.best == null) {
            bestEl.textContent = String(save.highScore());
        }
        // Alias: many games use #hud-high instead of #hud-best
        const highEl = document.getElementById("hud-high");
        if (highEl && values.high == null && values.best == null) {
            highEl.textContent = String(save.highScore());
        } else if (highEl && values.high != null) {
            highEl.textContent = String(values.high);
        } else if (highEl && values.best != null) {
            highEl.textContent = String(values.best);
        }
    }

    // ── Session ──────────────────────────────────────────────────────────

    function startRun() {
        run = game.create(api);
        if (run && typeof run === "object") {
            run._newBest = false;
            run._result = null;
        }
        refreshHud();
        switchTo("playing");
    }

    function endRun(result) {
        if (!run) {
            switchTo("gameover");
            return;
        }
        const score = (result && result.score != null)
            ? result.score
            : (run.score != null ? run.score : 0);
        run._newBest = save.maybeHighScore(score);
        if (result) run._result = result;
        switchTo("gameover");
    }

    // ── Actions from menus ───────────────────────────────────────────────

    function doMenuAction(action) {
        switch (action) {
            case "play":
            case "restart":
                api.play("select");
                startRun();
                break;
            case "resume":
                api.play("select");
                switchTo("playing");
                break;
            case "howto":
            case "howtoplay":
                api.play("select");
                switchTo("howto");
                break;
            case "back":
            case "title":
                api.play("select");
                switchTo("title");
                break;
            case "quit":
                api.play("select");
                exitApp();
                break;
            default:
                // Game-defined actions (nextlevel, continue, …)
                if (game.onMenuAction) {
                    api.play("select");
                    const result = game.onMenuAction(action, run, api);
                    applyMenuResult(result);
                }
                break;
        }
    }

    function applyMenuResult(result) {
        if (result == null) return;
        if (typeof result === "string") {
            switchTo(result);
            return;
        }
        if (result.switchTo) switchTo(result.switchTo);
        if (result.startRun) startRun();
        if (result.gameover) endRun(result.gameover === true ? null : result.gameover);
    }

    function exitApp() {
        try {
            if (typeof bro !== "undefined" && typeof bro.quit === "function") {
                bro.quit();
                return;
            }
        } catch (e) { /* fall through */ }
        try {
            if (typeof window !== "undefined" && typeof window.close === "function") {
                window.close();
                return;
            }
        } catch (e) { /* fall through */ }
        try {
            if (typeof process !== "undefined" && typeof process.exit === "function") {
                process.exit(0);
            }
        } catch (e) { /* ignore */ }
    }

    function activateMenuItem() {
        const items = getMenuItems();
        const el = items[menuIndex];
        if (!el) return;
        const action = el.getAttribute("data-action");
        if (action) doMenuAction(action);
    }

    function menuMove(delta) {
        const items = getMenuItems();
        if (!items.length) return;
        menuIndex = (menuIndex + delta + items.length) % items.length;
        updateMenuSelection();
        api.play("menu");
    }

    // ── Input routing ────────────────────────────────────────────────────

    function onShellAction(action, phase) {
        if (phase !== "down" || !action) return;

        if (screen === "playing") {
            if (action === "pause") {
                switchTo("pause");
                return;
            }
            return;
        }

        if (action === "up") menuMove(-1);
        else if (action === "down") menuMove(1);
        else if (action === "confirm" || action === "primary") activateMenuItem();
        else if (action === "pause") {
            if (screen === "pause") doMenuAction("resume");
            else if (screen === "title") { /* ignore */ }
            else doMenuAction("title");
        }
    }

    input.onAction(onShellAction);

    function ensureMouse() {
        if (mouseWired || !overlay) return;
        mouseWired = true;
        overlay.addEventListener("mousemove", (e) => {
            if (screen === "playing") return;
            const item = findMenuItem(e.target);
            if (!item) return;
            const items = getMenuItems();
            const i = items.indexOf(item);
            if (i >= 0 && i !== menuIndex) {
                menuIndex = i;
                updateMenuSelection();
                api.play("menu");
            }
        });
        overlay.addEventListener("click", (e) => {
            if (screen === "playing") return;
            const item = findMenuItem(e.target);
            if (!item) return;
            const items = getMenuItems();
            const i = items.indexOf(item);
            if (i < 0) return;
            menuIndex = i;
            updateMenuSelection();
            activateMenuItem();
        });
    }

    function findMenuItem(target) {
        let t = target;
        while (t && t !== overlay) {
            if (t.classList && t.classList.contains("menu-item")) return t;
            t = t.parentNode;
        }
        return null;
    }

    // ── Frame ────────────────────────────────────────────────────────────

    function update(dt) {
        if (screen !== "playing" || !run) return;

        let result;
        if (game.update) {
            result = game.update(run, dt, input);
        }

        if (result && result.status === "gameover") {
            endRun(result.result || result);
            return;
        }
        // Intermediate overlay (level clear, wave intro, …) without ending the run
        if (result && result.status === "screen" && result.name) {
            switchTo(result.name);
            return;
        }

        refreshHud();
    }

    function draw() {
        view.clear();
        // Prefer live run under menus (pause / title-after-play). Title art
        // only when there is no run yet.
        if (run && game.draw) {
            game.draw(run, view.ctx, view);
        } else if (game.drawTitle && (screen === "title" || screen === "howto")) {
            game.drawTitle(view.ctx, view, { screen, run });
        }
    }

    // ── Start ────────────────────────────────────────────────────────────

    if (!document.getElementById("screen-howto") && document.getElementById("screen-howtoplay")) {
        document.getElementById("screen-howtoplay").id = "screen-howto";
    }

    createLoop({ update, draw }).start();
    switchTo("title");

    return {
        api,
        getScreen: () => screen,
        getRun: () => run,
        switchTo,
        startRun,
    };
}

function mergeActions(base, extra) {
    if (!extra || !extra.length) return base.slice();
    const map = new Map();
    for (const a of base) map.set(a.name, a);
    for (const a of extra) map.set(a.name, a);
    return Array.from(map.values());
}

function defaultCue(name, audio) {
    if (name === "menu") audio.tone(440, 0.04, "sine", 0.3);
    else if (name === "select") audio.tone(660, 0.07, "square", 0.4);
}
