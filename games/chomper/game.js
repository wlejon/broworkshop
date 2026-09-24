// Chomper — Pac-Man-style maze chase, arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: arrows buffer a turn, rules events -> sound and the
// level-clear screen.
//   maze.js    layout, walls, pellets
//   ghosts.js  ghost personalities and movement
//   rules.js   Chomper, scoring, lives, levels
//   render.js  drawing

import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createChomper, step, nextLevel, drainEvents } from "/app/rules.js";
import { layoutFor, drawGame, drawMaze } from "/app/render.js";
import { createMaze } from "/app/maze.js";

const TURNS = ["right", "left", "up", "down"];   // DIRS order

let titleMaze = null;

export const game = {
    id: "chomper",
    clearColor: "#000",

    create(api) {
        return { score: 0, chomp: false, game: createChomper(), play: api.play, highScore: api.highScore };
    },

    update(run, dt, input) {
        const g = run.game;
        const turn = TURNS.findIndex((d) => input.pressed(d));
        step(g, dt, turn);
        run.score = g.score;

        let result;
        for (const e of drainEvents(g)) {
            if (e.type === "chomp") {
                run.chomp = !run.chomp;                  // alternate two pitches
                run.play(run.chomp ? "chompHi" : "chompLo");
            } else if (e.type === "levelclear") {
                run.play("win");
                result = { status: "screen", name: "levelclear" };
            } else if (e.type === "gameover") {
                result = { status: "gameover" };
            } else {
                run.play(e.type);
            }
        }
        return result;
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawGame(ctx, run.game, layoutFor(w, h));
    },

    // Title backdrop: the full maze, dimmed by the overlay.
    drawTitle(ctx, view) {
        const { w, h } = view.size();
        titleMaze = titleMaze || createMaze();
        drawMaze(ctx, titleMaze, layoutFor(w, h));
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            best: run ? Math.max(run.highScore(), run.score) : 0,
            lives: run ? run.game.lives : 3,
            level: run ? run.game.level : 1,
        };
    },

    gameOverText(run) {
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Level", run.game.level],
            ["Best", run.highScore()],
        ]);
    },

    onEnterScreen(name, run) {
        if (name === "levelclear" && run) {
            document.getElementById("levelclear-stats").textContent = statsBlock([
                ["Level", run.game.level + " clear!"],
                ["Score", run.score],
            ]);
        }
    },

    onMenuAction(action, run) {
        if (action === "nextlevel" && run) {
            nextLevel(run.game);
            return "playing";
        }
        return null;
    },

    // Game SFX only — menu move/select tones are shell-owned.
    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    chompHi: [[440, 0.04, "square", 0.3]],
    chompLo: [[330, 0.04, "square", 0.3]],
    power: [[220, 0.3, "sawtooth", 0.5]],
    eatghost: [[523, 0.08, "square", 0.6], [659, 0.08, "square", 0.6], [784, 0.12, "square", 0.7]],
    die: [[400, 0.15, "sawtooth", 0.6], [300, 0.15, "sawtooth", 0.6], [200, 0.3, "sawtooth", 0.6]],
    win: [[523, 0.1, "square", 0.7], [659, 0.1, "square", 0.7], [784, 0.1, "square", 0.7], [1047, 0.2, "square", 0.8]],
};
