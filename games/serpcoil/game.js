// Serpcoil — chain shooter on the arcade shell. A run is one level: clearing
// the coil shows "levelclear", the coil reaching the maw ends the run.
// Shell owns screens, loop, pause, HUD plumbing and the game-over best.
// Session: coil.js (chain.js, shooter.js, path.js) · levels.js · drawing: render.js

import { createEffects } from "/lib/arcade/effects.js";
import { bindPointer } from "/lib/arcade/pointer.js";
import { createOptions, sfxVolume } from "/lib/arcade/options.js";
import { LEVELS } from "/app/levels.js";
import { COLORS } from "/app/chain.js";
import { Coil } from "/app/coil.js";
import { drawStars, drawCoil } from "/app/render.js";

const SCREENS = ["levelselect", "settings", "credits"];

const fx = createEffects({
    particle: "square",
    label: { font: "Consolas, monospace", small: 18 },
    burst: { speed: 112, speedVar: 252, up: 0, life: 700, lifeVar: 400, size: 2, sizeVar: 2, gravity: 0, drag: 0.98, spin: 0 },
});

// Menu-level choices: the level the next run plays, and a seed for tests.
export const menu = { levelIdx: 0, seed: null };
let options = null;

export const game = {
    id: "serpcoil",
    clearColor: "#070412",

    defaults: {
        highScore: 0,
        sfxVol: 80,
        unlocked: 1,
        stars: {},
        bestScore: {},
    },

    init(api) {
        buildLevelGrid();
        options = createOptions(api, [sfxVolume()]);
        options.applyAll();
        bindPointer(api, {
            move(p) {
                const run = api.getRun();
                if (run) run.mouse = p;
            },
        });
        // Right click swaps (secondary); keep the context menu out of the way.
        api.view.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    },

    create(api) {
        fx.clear();
        const { w, h } = api.view.size();
        const coil = new Coil({ levelIdx: menu.levelIdx, width: w, height: h, seed: menu.seed, fx: coilFx(api) });
        menu.seed = null;
        return { score: 0, save: api.save, play: api.play, coil, mouse: null };
    },

    update(run, dt, input) {
        const c = run.coil;
        const turn = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
        if (turn) {
            c.turn(turn, dt);
            run.mouse = null;          // keys own the aim until the mouse moves again
        } else if (run.mouse) {
            c.aimAt(run.mouse.x, run.mouse.y);
        }
        if (input.pressed("primary")) c.fire();
        if (input.pressed("secondary")) c.swap();

        c.step(dt);
        fx.update(dt);
        run.score = c.score;

        if (c.status === "won") {
            recordWin(run);
            return { status: "screen", name: "levelclear" };
        }
        if (c.status === "lost") return { status: "gameover" };
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawStars(ctx, w, h);
        drawCoil(ctx, run.coil);
        fx.draw(ctx);
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        drawStars(ctx, w, h);
    },

    hud(run) {
        const c = run && run.coil;
        document.getElementById("hud-progress-fill").style.width = (c ? Math.max(0, Math.min(100, c.progress * 100)) : 0) + "%";
        document.getElementById("hud-danger").style.display = c && c.danger ? "" : "none";
        if (!c) return { score: 0, level: 1, combo: "x1", left: 0 };
        return { score: c.score, level: c.levelIdx + 1, combo: "x" + c.combo, left: c.left };
    },

    gameOverText(run) {
        const c = run.coil;
        return (
            "Score    " + c.score + (run._newBest ? "  ·  NEW BEST" : "") + "\n" +
            "Level    " + (c.levelIdx + 1) + " — " + c.level.name + "\n" +
            "Best     " + run.save.highScore()
        );
    },

    onEnterScreen(name, run, api) {
        if (name === "title") menu.levelIdx = 0;
        if (name === "levelselect") refreshLevelGrid(api.save);
        if (name === "settings") options.render();
        if (name === "levelclear") fillClear(run);
    },

    onMenuAction(action, run) {
        const level = /^level-(\d+)$/.exec(action);
        if (level) {
            menu.levelIdx = +level[1];
            return { startRun: true };
        }
        if (action === "nextlevel" && run) {
            const next = run.coil.levelIdx + 1;
            if (next >= LEVELS.length) return "title";
            menu.levelIdx = next;
            return { startRun: true };
        }
        if (options.handle(action)) return null;
        return SCREENS.includes(action) ? action : null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

// ── Sound ─────────────────────────────────────────────────────────────────

const CUES = {
    shoot: [[220, 0.06, "sawtooth", 0.4]],
    swap: [[540, 0.07, "sine", 0.35]],
    insert: [[380, 0.05, "square", 0.3]],
    danger: [[180, 0.18, "sawtooth", 0.5]],
    powerup: [[880, 0.2, "square", 0.7]],
    clear: [[523, 0.12, "square", 0.6], [659, 0.12, "square", 0.6], [784, 0.12, "square", 0.7], [1047, 0.25, "square", 0.8]],
    gameover: [[300, 0.18, "sawtooth", 0.5], [240, 0.18, "sawtooth", 0.5], [180, 0.36, "sawtooth", 0.55]],
};

// ── Wiring ────────────────────────────────────────────────────────────────

const hex = (color) => (COLORS[color] ? COLORS[color].hex : color);

function coilFx(api) {
    return {
        cue: (name) => api.play(name),
        // Each colour pops at its own pitch; cascades climb a semitone a step.
        pop(color, depth) {
            const base = COLORS[color] ? COLORS[color].tone : 440;
            api.audio.tone(base * Math.pow(2, (depth - 1) / 12), 0.14, "square", 0.5);
        },
        burst: (x, y, color, n) => fx.burst(x, y, hex(color), n),
        label: (x, y, text, color) => fx.label(x, y, text, color),
        ring: (x, y, maxR, color) => fx.ring(x, y, { maxR, color }),
        puff: (x, y) => fx.burst(x, y, "#9a56ff", 6, { speed: 40, speedVar: 60, life: 500, lifeVar: 0, size: 3, sizeVar: 0 }),
    };
}

/** Stars, per-level best, unlock the next level and the overall best. */
function recordWin(run) {
    const c = run.coil;
    const save = run.save;
    const stars = Object.assign({}, save.get("stars"));
    const best = Object.assign({}, save.get("bestScore"));
    stars[c.levelIdx] = Math.max(stars[c.levelIdx] || 0, c.stars);
    best[c.levelIdx] = Math.max(best[c.levelIdx] || 0, c.score);
    save.set("stars", stars);
    save.set("bestScore", best);
    save.set("unlocked", Math.min(LEVELS.length, Math.max(save.get("unlocked") || 1, c.levelIdx + 2)));
    // A clear does not end the shell run, so the overall best is recorded here.
    run._newBest = save.maybeHighScore(c.score);
    save.save();
}

function fillClear(run) {
    if (!run) return;
    const c = run.coil;
    document.getElementById("clear-stars").textContent = "★".repeat(c.stars) + "☆".repeat(3 - c.stars);
    document.getElementById("levelclear-stats").textContent =
        "Score        " + c.score + (run._newBest ? "  ·  NEW BEST" : "") + "\n" +
        "Level        " + (c.levelIdx + 1) + " — " + c.level.name + "\n" +
        "Clear bonus  +" + c.bonus;
}

// ── Level select ──────────────────────────────────────────────────────────

/** One menu-item tile per level (data-action level-N), built once. */
function buildLevelGrid() {
    const grid = document.getElementById("level-grid");
    grid.textContent = "";
    LEVELS.forEach((lv, i) => {
        const tile = document.createElement("div");
        tile.className = "menu-item level-node";
        tile.id = "level-node-" + i;
        tile.title = lv.name;
        tile.setAttribute("data-action", "level-" + i);
        const num = document.createElement("div");
        num.className = "level-num";
        num.textContent = String(i + 1);
        const stars = document.createElement("div");
        stars.className = "level-stars";
        const score = document.createElement("div");
        score.className = "level-score";
        tile.append(num, stars, score);
        grid.appendChild(tile);
    });
}

function refreshLevelGrid(save) {
    const unlocked = save.get("unlocked") || 1;
    const stars = save.get("stars") || {};
    const best = save.get("bestScore") || {};
    LEVELS.forEach((lv, i) => {
        const tile = document.getElementById("level-node-" + i);
        tile.classList.toggle("disabled", i >= unlocked);
        tile.querySelector(".level-stars").textContent = stars[i] ? "★".repeat(stars[i]) : " ";
        tile.querySelector(".level-score").textContent = best[i] ? String(best[i]) : "";
    });
}
