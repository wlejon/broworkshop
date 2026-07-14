// Gemswap — match-3 on the arcade foundation.
// Domain: board.js, particles.js, puzzles.js.
// Screens / loop / pause / HUD: /lib/arcade.

import { Board } from "/app/board.js";
import { Particles } from "/app/particles.js";
import { Puzzles } from "/app/puzzles.js";

const BASE_W = 900;
const BASE_H = 800;

/** Mode for the next create() call. */
let preferredMode = "classic";
let shellRef = null;

export const game = {
    id: "gemswap",
    clearColor: "#0a0612",

    // Mouse pick is handled on the canvas; keep primary keyboard-only so
    // a click does not also trigger cursorConfirm at a different cell.
    actions: [
        { name: "primary", label: "Pick / Swap", defaults: [" ", "Enter"] },
    ],

    defaults: {
        highScore: 0,
        highClassic: 0,
        highTimed: 0,
        highPuzzle: 0,
        hintDelay: 5,
    },

    create(ctx) {
        Board.setPlay(function (name) { ctx.play(name); });
        Board.setMatchCue(function (chain, size) {
            matchCue(ctx.audio, chain, size);
        });

        const hintSec = ctx.save.get("hintDelay") || 5;
        if (Board.setHintDelay) Board.setHintDelay(hintSec * 1000);

        Board.startGame(preferredMode);
        Particles.clear();

        const run = {
            score: 0,
            mode: preferredMode,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            audio: ctx.audio,
            view: ctx.view,
            ended: false,
        };

        attachPointer(run);
        syncScore(run);
        return run;
    },

    update(run, dt, input) {
        // Keyboard cursor + pick
        if (input.pressed("up")) Board.cursorMove(-1, 0);
        else if (input.pressed("down")) Board.cursorMove(1, 0);
        else if (input.pressed("left")) Board.cursorMove(0, -1);
        else if (input.pressed("right")) Board.cursorMove(0, 1);

        if (input.pressed("primary")) {
            Board.cursorConfirm();
        }

        Board.update(dt);
        Particles.update(dt);
        syncScore(run);

        const done = Board.isGameOver() ||
            (Board.getMode() === "puzzle" && Board.isFinished());
        if (done && !run.ended) {
            run.ended = true;
            // Per-mode best tracking
            const score = Board.getScore();
            const mode = Board.getMode();
            const key = mode === "timed" ? "highTimed"
                : mode === "puzzle" ? "highPuzzle"
                : "highClassic";
            const prev = run.save.get(key) || 0;
            if (score > prev) {
                run.save.set(key, score);
                run.save.save();
            }
            run.play("gameover");
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w: W, h: H } = view.size();
        Board.calcLayout(W, H);
        // Background is filled by shell clear + board starfield
        Board.drawBackground(ctx, W, H);
        Board.drawBoard(ctx);
        Particles.draw(ctx);
    },

    drawTitle(ctx, view) {
        const { w: W, h: H } = view.size();
        ctx.fillStyle = "#0a0612";
        ctx.fillRect(0, 0, W, H);
    },

    hud(run) {
        if (!run) {
            return { score: 0, best: 0, level: 1, extra: 0 };
        }
        const mode = Board.getMode();
        const chain = Board.getChain();
        const extraLabel = document.getElementById("hud-extra-label");
        let extra = 0;
        if (mode === "classic") {
            if (extraLabel) extraLabel.textContent = "MOVES";
            extra = Board.getMoves();
        } else if (mode === "timed") {
            if (extraLabel) extraLabel.textContent = "TIME";
            extra = Board.formatTime(Board.getModeTimer());
        } else if (mode === "puzzle") {
            if (extraLabel) extraLabel.textContent = "FROZEN";
            extra = Board.getFrozenRemaining();
        }

        const comboLabel = document.getElementById("hud-combo-label");
        const comboVal = document.getElementById("hud-combo");
        if (chain > 1) {
            if (comboLabel) {
                comboLabel.hidden = false;
                comboLabel.style.display = "";
            }
            if (comboVal) {
                comboVal.hidden = false;
                comboVal.style.display = "";
                comboVal.textContent = "x" + chain;
            }
        } else {
            if (comboLabel) {
                comboLabel.hidden = true;
                comboLabel.style.display = "none";
            }
            if (comboVal) {
                comboVal.hidden = true;
                comboVal.style.display = "none";
            }
        }

        return {
            score: Board.getScore(),
            best: run.highScore(),
            level: Board.getLevel(),
            extra: extra,
        };
    },

    gameOverText(run) {
        const score = Board.getScore();
        const mode = Board.getMode();
        const stats = Board.getStats() || {};
        const finished = Board.isFinished();
        const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
        const title = document.getElementById("gameover-title");
        if (title) {
            title.textContent = finished ? (modeLabel + " Complete!") : "Game Over";
        }
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score      " + score + tag + "\n" +
            "Level      " + Board.getLevel() + "    Moves  " + Board.getMoves() + "\n" +
            "Max Chain  x" + Board.getMaxChain() + "\n" +
            "Matches    " + (stats.matches || 0) + "\n" +
            "Specials   F" + (stats.flameMade || 0) +
            " S" + (stats.starMade || 0) +
            " H" + (stats.hyperMade || 0) + "\n" +
            "Best       " + best
        );
    },

    onEnterScreen(name) {
        if (name === "title") {
            // Keep preferredMode so restart from gameover still works;
            // only reset when leaving via title "play" path is not needed.
        }
    },

    onMenuAction(action) {
        if (action === "modeselect") return "modeselect";
        if (action === "credits") return "credits";
        if (action === "mode-classic") {
            preferredMode = "classic";
            return { startRun: true };
        }
        if (action === "mode-timed") {
            preferredMode = "timed";
            return { startRun: true };
        }
        if (action === "mode-puzzle") {
            preferredMode = "puzzle";
            return { startRun: true };
        }
        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "pick") audio.tone(520, 0.06, "sine", 0.35);
        else if (name === "cursor") audio.tone(380, 0.04, "sine", 0.22);
        else if (name === "swap_ok") {
            audio.sequence([
                [520, 0.05, "sine", 0.4],
                [720, 0.08, "sine", 0.4],
            ]);
        } else if (name === "swap_bad") {
            audio.tone(220, 0.12, "square", 0.28);
        } else if (name === "match") {
            audio.tone(440, 0.14, "triangle", 0.4);
        } else if (name === "hyper") {
            audio.sequence([
                [300, 0.06, "sawtooth", 0.5],
                [500, 0.08, "sawtooth", 0.5],
                [800, 0.10, "sawtooth", 0.5],
                [1200, 0.14, "triangle", 0.45],
            ]);
        } else if (name === "levelup") {
            audio.sequence([
                [523, 0.1, "triangle", 0.5],
                [659, 0.1, "triangle", 0.5],
                [784, 0.1, "triangle", 0.5],
                [1047, 0.18, "sine", 0.5],
            ]);
        } else if (name === "shuffle") {
            audio.tone(150, 0.25, "sawtooth", 0.3);
        } else if (name === "gameover") {
            audio.sequence([
                [440, 0.15, "triangle", 0.45],
                [330, 0.15, "triangle", 0.45],
                [220, 0.25, "triangle", 0.45],
            ]);
        }
    },
};

function matchCue(audio, chain, size) {
    if (!audio) return;
    const base = 440;
    const step = Math.min(chain, 8);
    const freq = base * Math.pow(1.122, step);
    const vol = Math.min(1.0, 0.35 + size * 0.06);
    audio.tone(freq, 0.14, "triangle", vol);
    if (size >= 4) {
        audio.sequence([
            [freq * 1.5, 0.09, "triangle", vol * 0.7],
            [freq * 2.0, 0.12, "sine", vol * 0.6],
        ]);
    }
    if (chain >= 3) {
        audio.sequence([
            [600 + chain * 40, 0.06, "square", 0.35],
            [760 + chain * 40, 0.06, "square", 0.35],
            [960 + chain * 40, 0.10, "square", 0.35],
        ]);
    }
}

function syncScore(run) {
    if (run) run.score = Board.getScore();
}

/** One listener set per canvas; always targets the latest run on that canvas. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._gemswapRun = run;
    if (canvas._gemswapPointer) return;
    canvas._gemswapPointer = true;

    function localXY(e) {
        const r = canvas._gemswapRun;
        if (!r || !r.view) return null;
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        let x, y;
        if (rect) {
            const scaleX = r.view.width() / (rect.width || BASE_W);
            const scaleY = r.view.height() / (rect.height || BASE_H);
            x = (e.clientX - rect.left) * scaleX;
            y = (e.clientY - rect.top) * scaleY;
        } else if (typeof e.offsetX === "number") {
            x = e.offsetX;
            y = e.offsetY;
        } else {
            x = e.clientX;
            y = e.clientY;
        }
        return { x: x, y: y };
    }

    canvas.addEventListener("mousedown", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        const p = localXY(e);
        if (!p) return;
        canvas._gemswapDragFrom = pointToCell(p.x, p.y);
        Board.handleClick(p.x, p.y);
    });

    canvas.addEventListener("mouseup", function (e) {
        if (!shellRef || shellRef.getScreen() !== "playing") return;
        const from = canvas._gemswapDragFrom;
        if (!from) return;
        const p = localXY(e);
        if (!p) { canvas._gemswapDragFrom = null; return; }
        const cell = pointToCell(p.x, p.y);
        if (cell) {
            const dr = cell.r - from.r;
            const dc = cell.c - from.c;
            if (Math.abs(dr) + Math.abs(dc) === 1) {
                Board.handleClick(p.x, p.y);
            }
        }
        canvas._gemswapDragFrom = null;
    });
}

function pointToCell(px, py) {
    const layout = Board.getLayout();
    const dx = px - layout.ox;
    const dy = py - layout.oy;
    if (dx < 0 || dy < 0) return null;
    const c = Math.floor(dx / layout.cell);
    const r = Math.floor(dy / layout.cell);
    if (r < 0 || r >= Board.ROWS || c < 0 || c >= Board.COLS) return null;
    return { r: r, c: c };
}

export function installTestHooks(shell) {
    shellRef = shell;

    // Thin Screens facade so existing tests can switch to "playing"
    const Screens = {
        switchTo: function (name) {
            if (name === "playing" || name === "play") {
                if (!shell.getRun()) {
                    preferredMode = preferredMode || "classic";
                    shell.startRun();
                } else {
                    shell.switchTo("playing");
                }
            } else if (name === "title") {
                shell.switchTo("title");
            } else if (name === "gameOver" || name === "gameover") {
                shell.switchTo("gameover");
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

    window.__gemswap = {
        G: {
            Board: Board,
            Puzzles: Puzzles,
            Particles: Particles,
            Screens: Screens,
        },
        board: Board,
        particles: Particles,
        puzzles: Puzzles,
        screens: Screens,
        shell: shell,
    };
}
