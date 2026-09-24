// Wordspire — letter-grid word builder with three modes, on the arcade shell.
// Shell owns screens, loop, pause, HUD plumbing and the high score.
// Tiles + paths: letters.js · session: board.js · drawing: render.js
// · words: dictionary.js · points: scoring.js

import { cellAt, cellCenter } from "/lib/arcade/grid.js";
import { formatClock } from "/lib/arcade/timers.js";
import { createEffects } from "/lib/arcade/effects.js";
import { bindPointer } from "/lib/arcade/pointer.js";
import { recordScore, createScoreTabs, today } from "/lib/arcade/scores.js";
import { createOptions, sfxVolume } from "/lib/arcade/options.js";
import { Board, PUZZLE_COUNT } from "/app/board.js";
import { Dictionary } from "/app/dictionary.js";
import { burningDanger } from "/app/letters.js";
import { layoutFor, buttons, hit, drawBackground, drawBoard } from "/app/render.js";

const MODES = ["classic", "timed", "puzzle"];
const HS_KEY = { classic: "hsClassic", timed: "hsTimed", puzzle: "hsPuzzle" };
const EXTRA_LABEL = { classic: "Words", timed: "Time", puzzle: "Puzzle" };
const SCREENS = ["modeselect", "highscores", "settings", "credits"];
const DIFFICULTY = ["Easy", "Normal", "Hard"];

// Used when words.txt cannot be read, so the game still plays.
const FALLBACK_WORDS = [
    "cat", "dog", "eat", "run", "sun", "moon", "star", "stone", "word", "play",
    "game", "hello", "world", "tile", "chain", "board", "spire", "tower",
    "test", "type", "tone", "crate", "rate", "hate", "late", "plate",
];

const fx = createEffects({
    particle: "square",
    burst: { speed: 180, speedVar: 180, up: 0, life: 450, lifeVar: 300, size: 2, sizeVar: 3, gravity: 500, drag: 1, spin: 0 },
});

// Menu-level choices (not session state).
let nextMode = "classic";
let scoreTabs = null;
let options = null;
let titleTime = 0;

export const game = {
    id: "wordspire",
    clearColor: "#0a0614",

    actions: [
        { name: "primary", label: "Add tile", defaults: [" "] },
        { name: "secondary", label: "Remove last", defaults: ["Backspace"] },
        { name: "confirm", label: "Submit", defaults: ["Enter"] },
    ],

    defaults: {
        highScore: 0,
        difficulty: 1,
        sfxVol: 80,
        hsClassic: [],
        hsTimed: [],
        hsPuzzle: [],
        topWords: [],
    },

    init(api) {
        scoreTabs = createScoreTabs(api.save, [
            ...MODES.map((m) => ({
                id: m,
                key: HS_KEY[m],
                format: (e) => pad(e.score, 6) + "  Words " + pad(e.words || 0, 3) + "  Best " + (e.best || "-").toUpperCase(),
            })),
            {
                id: "words",
                key: "topWords",
                empty: "No words yet",
                format: (e) => (e.word || "").toUpperCase() + "  +" + (e.score || 0) + "  (" + (e.mode || "?") + ")",
            },
        ]);
        options = createOptions(api, [
            sfxVolume(),
            { key: "difficulty", action: "cycle-difficulty", values: [1, 2, 0], label: (v) => DIFFICULTY[v] || "Normal" },
        ]);
        options.applyAll();
        bindPointer(api, {
            click: (p) => clickAt(api, p),
            dblclick: (p) => dblclickAt(api, p),
        });
        loadDictionary(api);
    },

    create(api) {
        fx.clear();
        const run = {
            score: 0,
            save: api.save,
            play: api.play,
            layout: layoutFor(api.view.width(), api.view.height()),
            board: null,
        };
        run.board = new Board({
            mode: nextMode,
            difficulty: options ? options.get("difficulty") : 1,
            fx: boardFx(api, () => run.layout),
        });
        return run;
    },

    update(run, dt, input) {
        const b = run.board;
        if (input.pressed("up")) b.moveCursor(-1, 0);
        else if (input.pressed("down")) b.moveCursor(1, 0);
        else if (input.pressed("left")) b.moveCursor(0, -1);
        else if (input.pressed("right")) b.moveCursor(0, 1);
        if (input.pressed("primary")) b.tapCursor();
        if (input.pressed("confirm")) b.submit();
        if (input.pressed("secondary")) b.removeLast();

        b.step(dt);
        fx.update(dt);
        run.score = b.score;

        if (b.ended()) {
            recordScore(run.save, HS_KEY[b.mode], {
                score: b.score, words: b.words, longest: b.longest, best: b.bestWord,
                bestScore: b.bestWordScore, time: Math.floor(b.time), date: today(),
            });
            if (b.finished) run.play("win");    // a collapse already cued "gameover"
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        run.layout = layoutFor(w, h);
        drawBackground(ctx, w, h, run.board.time);
        const o = fx.shakeOffset();
        ctx.save();
        ctx.translate(o.x, o.y);
        drawBoard(ctx, run.board, run.layout, w, h, run.board.preview());
        fx.draw(ctx);
        ctx.restore();
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        titleTime += 16;
        drawBackground(ctx, w, h, titleTime);
    },

    hud(run) {
        const warn = document.getElementById("burning-warn");
        const combo = document.getElementById("hud-combo-stat");
        const b = run && run.board;
        if (warn) warn.style.display = b && b.mode === "classic" && !b.ended() && burningDanger(b.grid) ? "block" : "none";
        if (combo) combo.style.display = b && b.streak >= 2 ? "" : "none";
        if (!b) return { score: 0, level: 1, extra: 0, longest: "-", bestword: "-" };
        const extra = b.mode === "timed" ? formatClock(b.timeLeft, true)
            : b.mode === "puzzle" ? Math.min(PUZZLE_COUNT, b.puzzleSolved + 1) + "/" + PUZZLE_COUNT
            : b.words;
        return {
            score: b.score,
            level: b.level,
            extra,
            "extra-label": EXTRA_LABEL[b.mode],
            longest: b.longest ? b.longest.toUpperCase() : "-",
            bestword: b.bestWord ? b.bestWord.toUpperCase() + " (" + b.bestWordScore + ")" : "-",
            combo: "x" + b.streak,
        };
    },

    gameOverText(run) {
        const b = run.board;
        const title = document.getElementById("gameover-title");
        if (title) title.textContent = b.finished ? cap(b.mode) + " Complete!" : "Game Over";
        return (
            "Mode     " + cap(b.mode) + "\n" +
            "Score    " + b.score + (run._newBest ? "  ·  NEW BEST" : "") + "\n" +
            "Words    " + b.words + (b.mode === "classic" ? "    Doused  " + b.doused : "") + "\n" +
            "Longest  " + (b.longest ? b.longest.toUpperCase() : "-") + "\n" +
            "Best     " + (b.bestWord ? b.bestWord.toUpperCase() + " +" + b.bestWordScore : "-") + "\n" +
            "Time     " + formatClock(b.time)
        );
    },

    onEnterScreen(name, run) {
        if (name === "highscores") scoreTabs.show(run ? run.board.mode : nextMode);
        if (name === "settings") options.render();
    },

    onMenuAction(action) {
        const mode = /^mode-(\w+)$/.exec(action);
        if (mode) {
            nextMode = mode[1];
            return { startRun: true };
        }
        if (action === "hs-next") { scoreTabs.next(); return null; }
        if (options.handle(action)) return null;
        return SCREENS.includes(action) ? action : null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        const at = /^(tile|submit)@(\d+)$/.exec(name);
        if (at && at[1] === "tile") {
            audio.tone(LADDER[Math.min(LADDER.length - 1, +at[2])], 0.06, "triangle", 0.45);
        } else if (at) {
            const base = Math.min(7, Math.max(0, +at[2] - 3));
            audio.sequence([
                [LADDER[base], 0.06, "square", 0.55],
                [LADDER[base + 2], 0.06, "square", 0.55],
                [LADDER[base + 4], 0.1, "square", 0.65],
            ]);
        } else if (CUES[name]) {
            audio.sequence(CUES[name]);
        }
    },
};

// ── Sound ─────────────────────────────────────────────────────────────────

const LADDER = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25, 783.99, 880.0];
const CUES = {
    submit_fail: [[220, 0.07, "sawtooth", 0.5], [160, 0.12, "sawtooth", 0.5]],
    sizzle: [[90, 0.18, "sawtooth", 0.55]],
    fanfare: [[523.25, 0.08, "square", 0.7], [659.25, 0.08, "square", 0.7], [783.99, 0.08, "square", 0.8], [1046.5, 0.18, "square", 0.95]],
    tile_remove: [[180, 0.04, "triangle", 0.3]],
    clear_chain: [[130, 0.08, "sine", 0.3]],
    gameover: [[440, 0.18, "sawtooth", 0.6], [330, 0.18, "sawtooth", 0.55], [220, 0.3, "sawtooth", 0.6], [165, 0.4, "sawtooth", 0.55]],
    win: [[523, 0.08, "square", 0.7], [659, 0.08, "square", 0.7], [784, 0.08, "square", 0.7], [1047, 0.22, "square", 0.95]],
};

// ── Wiring ────────────────────────────────────────────────────────────────

/** Show the loading screen until words.txt is indexed (or falls back). */
function loadDictionary(api) {
    if (Dictionary.loaded()) return;
    const status = document.getElementById("loading-status");
    const say = (s) => { if (status) status.textContent = s; };
    api.switchTo("loading");
    say("Reading dictionary...");
    Dictionary.load("words.txt").then((n) => {
        say(n + " words loaded.");
    }).catch((err) => {
        console.error("wordspire: dictionary load failed:", err);
        Dictionary.setWords(FALLBACK_WORDS);
        say("Dictionary unavailable; using a short word list.");
    }).then(() => {
        if (api.getScreen() === "loading") api.switchTo("title");
    });
}

/** Board effects in cell coordinates -> pixels through the current layout. */
function boardFx(api, layout) {
    return {
        cue: (name) => api.play(name),
        toast: (text) => fx.toast("#action-text", text, 1100),
        burst(r, c, color) { const p = cellCenter(layout(), r, c); fx.burst(p.x, p.y, color, 14); },
        shake: (ms, amp) => fx.shake(ms, amp),
        word: (entry) => recordScore(api.save, "topWords", entry),
    };
}

function clickAt(api, p) {
    const run = api.getRun();
    if (!run) return;
    const b = buttons(run.layout, api.view.width());
    if (b && hit(b.submit, p.x, p.y)) { run.board.submit(); return; }
    if (b && hit(b.clear, p.x, p.y)) { run.board.clearChain(); return; }
    const cell = cellAt(run.layout, p.x, p.y);
    if (cell) run.board.tap(cell.r, cell.c);
}

/**
 * Double-click a tile submits the chain ending on it. Its two clicks have
 * already toggled that tile (added then dropped, or dropped then re-added),
 * so put it back on the end first.
 */
function dblclickAt(api, p) {
    const run = api.getRun();
    const cell = run && cellAt(run.layout, p.x, p.y);
    if (!cell) return;
    const ch = run.board.chain;
    const last = ch[ch.length - 1];
    if (!last || last[0] !== cell.r || last[1] !== cell.c) run.board.tap(cell.r, cell.c);
    run.board.submit();
}

function pad(n, w) { const s = String(n); return s.length >= w ? s : " ".repeat(w - s.length) + s; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
