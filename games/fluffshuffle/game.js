// Fluffshuffle — wrap-drag match-3 with puff creatures, on the arcade shell.
// Shell owns screens, loop, pause, HUD plumbing and the high score.
// Rules: rules.js · session: board.js · drawing: render.js, puffs.js

import { fitBoard, cellAt, cellCenter, formatClock } from "/lib/arcade/grid.js";
import { createEffects } from "/lib/arcade/effects.js";
import { bindPointer } from "/lib/arcade/pointer.js";
import { recordScore, createScoreTabs, today } from "/lib/arcade/scores.js";
import { createOptions, sfxVolume, toggle } from "/lib/arcade/options.js";
import { ROWS, COLS } from "/app/rules.js";
import { Board } from "/app/board.js";
import { drawBackground, drawBoard } from "/app/render.js";

const MODES = ["classic", "timed", "puzzle"];
const HS_KEY = { classic: "hsClassic", timed: "hsTimed", puzzle: "hsPuzzle" };
const EXTRA_LABEL = { classic: "Popped", timed: "Time", puzzle: "Moves" };
const SCREENS = ["modeselect", "highscores", "settings", "credits"];
const COLOR_PITCH = [0, 440, 494, 523, 587, 659, 784];

const fx = createEffects({
    particle: "tuft",
    burst: { speed: 60, speedVar: 180, up: 40, life: 650, lifeVar: 450, size: 2, sizeVar: 3, gravity: 260, drag: 0.92, spin: 6 },
    label: { small: 20 },
});

// Menu-level choices and screens that need the api (not session state).
let nextMode = "classic";
let scoreTabs = null;
let options = null;
const settings = { dragDead: 6, eyeTrack: true, showCursor: true };

export const game = {
    id: "fluffshuffle",
    clearColor: "#0d1326",

    // Mouse drags go through the canvas pointer, so primary is keyboard-only.
    actions: [
        { name: "primary", label: "Grab / Release", defaults: [" ", "Enter"] },
    ],

    defaults: {
        highScore: 0,
        sfxVol: 80,
        dragDead: 6,
        showCursor: true,
        eyeTrack: true,
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
        const DRAG = [];
        for (let px = 2; px <= 20; px++) DRAG.push(px);
        options = createOptions(api, [
            sfxVolume(),
            { key: "dragDead", action: "cycle-drag", values: DRAG, apply: (v) => { settings.dragDead = v; } },
            toggle("showCursor", "toggle-cursor", (v) => { settings.showCursor = v; }),
            toggle("eyeTrack", "toggle-eyes", (v) => { settings.eyeTrack = v; }),
        ]);
        options.applyAll();
        bindPointer(api, {
            down(p) {
                const run = api.getRun();
                const cell = run && cellAt(run.layout, p.x, p.y);
                if (cell) run.board.press(cell.r, cell.c, p.x, p.y);
            },
            move(p) { const run = api.getRun(); if (run) run.board.move(p.x, p.y, run.layout.cell); },
            up(p) { const run = api.getRun(); if (run) run.board.release(p.x, p.y); },
        });
    },

    create(api) {
        fx.clear();
        const run = {
            score: 0,
            save: api.save,
            play: api.play,
            layout: layoutFor(api.view),
            board: null,
        };
        run.board = new Board({ mode: nextMode, settings, fx: boardFx(api, () => run.layout) });
        return run;
    },

    update(run, dt, input) {
        const b = run.board;
        if (input.pressed("up")) b.cursorSlide(-1, 0);
        else if (input.pressed("down")) b.cursorSlide(1, 0);
        else if (input.pressed("left")) b.cursorSlide(0, -1);
        else if (input.pressed("right")) b.cursorSlide(0, 1);
        if (input.pressed("primary")) b.cursorAction();

        b.step(dt);
        fx.update(dt);
        run.score = b.score;

        if (b.ended()) {
            if (b.score > 0) {
                recordScore(run.save, HS_KEY[b.mode], { score: b.score, level: b.level, chain: b.maxChain, date: today() });
            }
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
        const extra = b.mode === "timed" ? formatClock(b.timeLeft)
            : b.mode === "puzzle" ? b.puzzleMovesLeft
            : b.popped;
        const combo = document.getElementById("hud-combo-stat");
        if (combo) combo.style.display = b.chain > 1 ? "" : "none";
        return {
            score: b.score,
            level: b.mode === "puzzle" ? b.puzzleIndex + 1 : b.level,
            "level-label": b.mode === "puzzle" ? "Puzzle" : "Level",
            extra,
            "extra-label": EXTRA_LABEL[b.mode],
            goal: b.mode === "puzzle" ? b.popped + " / " + b.puzzleTarget : "",
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
            "Popped     " + s.popped + "\n" +
            "Max Chain  x" + b.maxChain + "\n" +
            "Specials   Jumbo " + s.jumboMade + " · Arrow " + s.arrowMade + " · Prism " + s.prismMade + "\n" +
            "Unlocks    " + s.unlocks
        );
    },

    onEnterScreen(name, run) {
        if (name === "highscores") scoreTabs.show(run ? run.board.mode : nextMode);
        if (name === "settings") options.render();
        const goal = document.getElementById("hud-goal-stat");
        if (goal) goal.style.display = run && run.board.mode === "puzzle" ? "" : "none";
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
    grab: [[520, 0.05, "sine", 0.35]],
    snap: [[880, 0.04, "square", 0.3]],
    cursor: [[380, 0.04, "sine", 0.22]],
    thud: [[120, 0.16, "sawtooth", 0.4]],
    lock: [[260, 0.06, "triangle", 0.35], [180, 0.1, "triangle", 0.35]],
    levelup: [[523, 0.1, "triangle", 0.5], [659, 0.1, "triangle", 0.5], [784, 0.1, "triangle", 0.5], [1047, 0.18, "sine", 0.5]],
    gameover: [[440, 0.15, "triangle", 0.45], [330, 0.15, "triangle", 0.45], [220, 0.25, "triangle", 0.45]],
};

/** Each puff color has its own note; cascades climb a semitone per step. */
function matchCue(audio, chain, color, size) {
    const freq = (COLOR_PITCH[color] || 520) * Math.pow(1.0595, Math.min(chain, 8));
    const vol = Math.min(1, 0.35 + size * 0.05);
    audio.tone(freq, 0.12, "triangle", vol);
    audio.tone(freq * 1.5, 0.06, "sine", 0.25 * vol);
    if (size >= 4) audio.sequence([[freq * 1.5, 0.08, "triangle", vol * 0.7], [freq * 2, 0.12, "sine", vol * 0.55]]);
    if (chain >= 3) {
        audio.sequence([
            [600 + chain * 50, 0.06, "square", 0.3],
            [760 + chain * 50, 0.06, "square", 0.3],
            [960 + chain * 50, 0.1, "square", 0.3],
        ]);
    }
}

// ── Wiring ────────────────────────────────────────────────────────────────

function boardFx(api, layout) {
    const at = (r, c) => cellCenter(layout(), r, c);
    return {
        cue: (name) => api.play(name),
        matchCue: (chain, color, size) => matchCue(api.audio, chain, color, size),
        burst(r, c, color, n) { const p = at(r, c); fx.burst(p.x, p.y, color, n); },
        label(r, c, text, color, big) { const p = at(r, c); fx.label(p.x, p.y - (big ? 0 : 10), text, color, { big }); },
        shake: (ms, amp) => fx.shake(ms, amp),
    };
}

export function layoutFor(view) {
    const { w, h } = view.size();
    return fitBoard(w, h, ROWS, COLS, { minCell: 48, maxCell: 100, padX: 200, padY: 80, biasX: -60, minX: 30, minY: 40 });
}

/** Mode for the next run (make_video.js and tests start runs directly). */
export function setNextMode(mode) {
    nextMode = mode;
}

function pad(n, w) { const s = String(n); return s.length >= w ? s : " ".repeat(w - s.length) + s; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
