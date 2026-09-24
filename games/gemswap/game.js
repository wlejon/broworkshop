// Gemswap — match-3 with specials and three modes, on the arcade shell.
// Shell owns screens, loop, pause, HUD plumbing and the high score.
// Rules: rules.js · session: board.js · drawing: render.js · layouts: puzzles.js

import { fitBoard, cellAt, cellCenter, formatClock } from "/lib/arcade/grid.js";
import { createEffects } from "/lib/arcade/effects.js";
import { bindPointer } from "/lib/arcade/pointer.js";
import { recordScore, createScoreTabs, today } from "/lib/arcade/scores.js";
import { createOptions, sfxVolume } from "/lib/arcade/options.js";
import { Board } from "/app/board.js";
import { drawBackground, drawBoard } from "/app/render.js";

const MODES = ["classic", "timed", "puzzle"];
const HS_KEY = { classic: "hsClassic", timed: "hsTimed", puzzle: "hsPuzzle" };
const EXTRA_LABEL = { classic: "Moves", timed: "Time", puzzle: "Frozen" };
const SCREENS = ["modeselect", "highscores", "settings", "credits"];

const fx = createEffects({ particle: "shard", label: { glow: true } });

// Menu-level choices (not session state): next mode, screens that need the api.
let nextMode = "classic";
let scoreTabs = null;
let options = null;

export const game = {
    id: "gemswap",
    clearColor: "#0a0612",

    // Mouse picks go through the canvas pointer; keep primary keyboard-only
    // so a click never also confirms the keyboard cursor's cell.
    actions: [
        { name: "primary", label: "Pick / Swap", defaults: [" ", "Enter"] },
    ],

    defaults: {
        highScore: 0,
        sfxVol: 80,
        hintDelay: 5,
        hsClassic: [],
        hsTimed: [],
        hsPuzzle: [],
    },

    init(api) {
        scoreTabs = createScoreTabs(api.save, MODES.map((m) => ({
            id: m,
            key: HS_KEY[m],
            format: (e) => pad(e.score, 7) + "  Lv" + (e.level || 1) + "  x" + (e.chain || 1),
        })));
        options = createOptions(api, [
            sfxVolume(),
            { key: "hintDelay", action: "cycle-hint", values: [3, 5, 8, 12, 0],
              label: (v) => (v ? v + "s" : "Off") },
        ]);
        options.applyAll();
        bindPointer(api, {
            down(p) { pressAt(api, p, true); },
            up(p) { pressAt(api, p, false); },
        });
    },

    create(api) {
        const hint = options ? options.get("hintDelay") : 5;
        fx.clear();
        const run = {
            score: 0,
            save: api.save,
            play: api.play,
            dragFrom: null,
            layout: null,
            board: new Board({
                mode: nextMode,
                hintDelay: hint ? hint * 1000 : Infinity,
                fx: boardFx(api, () => run.layout),
            }),
        };
        run.layout = layoutFor(api.view);
        return run;
    },

    update(run, dt, input) {
        const b = run.board;
        if (input.pressed("up")) b.cursorMove(-1, 0);
        else if (input.pressed("down")) b.cursorMove(1, 0);
        else if (input.pressed("left")) b.cursorMove(0, -1);
        else if (input.pressed("right")) b.cursorMove(0, 1);
        if (input.pressed("primary")) b.cursorConfirm();

        b.step(dt);
        fx.update(dt);
        run.score = b.score;

        if (b.ended()) {
            recordScore(run.save, HS_KEY[b.mode], {
                score: b.score, level: b.level, chain: b.maxChain, date: today(),
            });
            run.play("gameover");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        run.layout = layoutFor(view);
        drawBackground(ctx, w, h, run.board.time);
        drawBoard(ctx, run.board, run.layout, fx.shakeOffset());
        fx.draw(ctx);
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        drawBackground(ctx, w, h, 0);
    },

    hud(run) {
        if (!run) return { score: 0, level: 1, extra: 0 };
        const b = run.board;
        const extra = b.mode === "timed" ? formatClock(b.timeLeft, true)
            : b.mode === "puzzle" ? b.frozenLeft
            : b.moves;
        const combo = document.getElementById("hud-combo-stat");
        if (combo) combo.style.display = b.chain > 1 ? "" : "none";
        return {
            score: b.score,
            level: b.mode === "puzzle" ? b.puzzleIndex + 1 : b.level,
            "level-label": b.mode === "puzzle" ? "Puzzle" : "Level",
            extra,
            "extra-label": EXTRA_LABEL[b.mode],
            combo: "x" + b.chain,
        };
    },

    gameOverText(run) {
        const b = run.board;
        const title = document.getElementById("gameover-title");
        if (title) title.textContent = b.finished ? cap(b.mode) + " Complete!" : "Game Over";
        const s = b.stats;
        return (
            "Score      " + b.score + (run._newBest ? "  ·  NEW BEST" : "") + "\n" +
            "Level      " + b.level + "    Moves  " + b.moves + "\n" +
            "Max Chain  x" + b.maxChain + "\n" +
            "Matches    " + s.matches + "\n" +
            "Specials   Flame " + s.flameMade + " · Star " + s.starMade + " · Hyper " + s.hyperMade
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
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

// ── Sound ─────────────────────────────────────────────────────────────────

const CUES = {
    pick: [[520, 0.06, "sine", 0.35]],
    cursor: [[380, 0.04, "sine", 0.22]],
    swap_ok: [[520, 0.05, "sine", 0.4], [720, 0.08, "sine", 0.4]],
    swap_bad: [[220, 0.12, "square", 0.28]],
    hyper: [[300, 0.06, "sawtooth", 0.5], [500, 0.08, "sawtooth", 0.5], [800, 0.1, "sawtooth", 0.5], [1200, 0.14, "triangle", 0.45]],
    levelup: [[523, 0.1, "triangle", 0.5], [659, 0.1, "triangle", 0.5], [784, 0.1, "triangle", 0.5], [1047, 0.18, "sine", 0.5]],
    shuffle: [[150, 0.25, "sawtooth", 0.3]],
    gameover: [[440, 0.15, "triangle", 0.45], [330, 0.15, "triangle", 0.45], [220, 0.25, "triangle", 0.45]],
};

/** Pitch climbs with cascade depth; bigger groups add a sparkle. */
function matchCue(audio, chain, size) {
    const freq = 440 * Math.pow(1.122, Math.min(chain, 8));
    const vol = Math.min(1, 0.35 + size * 0.06);
    audio.tone(freq, 0.14, "triangle", vol);
    if (size >= 4) audio.sequence([[freq * 1.5, 0.09, "triangle", vol * 0.7], [freq * 2, 0.12, "sine", vol * 0.6]]);
    if (chain >= 3) {
        audio.sequence([
            [600 + chain * 40, 0.06, "square", 0.35],
            [760 + chain * 40, 0.06, "square", 0.35],
            [960 + chain * 40, 0.1, "square", 0.35],
        ]);
    }
}

// ── Wiring ────────────────────────────────────────────────────────────────

/** Board effects in cell coordinates -> pixels through the current layout. */
function boardFx(api, layout) {
    const at = (r, c) => cellCenter(layout(), r, c);
    return {
        cue: (name) => api.play(name),
        matchCue: (chain, size) => matchCue(api.audio, chain, size),
        burst(r, c, color, n) { const p = at(r, c); fx.burst(p.x, p.y, color, n); },
        label(r, c, text, color, big) { const p = at(r, c); fx.label(p.x, p.y - (big ? 0 : 6), text, color, { big }); },
        shake: (ms, amp) => fx.shake(ms, amp),
    };
}

function layoutFor(view) {
    const { w, h } = view.size();
    return fitBoard(w, h, 8, 8, { minCell: 32, maxCell: 72, padX: 200, padY: 80, biasX: -60, minX: 30, minY: 40 });
}

/** Mouse: press picks; releasing on a neighbour of the press swaps (drag). */
function pressAt(api, p, isDown) {
    const run = api.getRun();
    if (!run) return;
    const cell = cellAt(run.layout, p.x, p.y);
    if (isDown) {
        run.dragFrom = cell;
        if (cell) run.board.pick(cell.r, cell.c);
        return;
    }
    const from = run.dragFrom;
    run.dragFrom = null;
    if (from && cell && Math.abs(cell.r - from.r) + Math.abs(cell.c - from.c) === 1) {
        run.board.pick(cell.r, cell.c);
    }
}

function pad(n, w) { const s = String(n); return s.length >= w ? s : " ".repeat(w - s.length) + s; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
