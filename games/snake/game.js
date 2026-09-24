// Snake — the reference arcade plugin.
//
// The shell (/lib/arcade) owns screens, the loop, pause, input bindings, the
// HUD plumbing and the high score. This file only wires the pieces:
//   rules.js   the board: pure state + stepping, events out
//   render.js  drawing a board
//   game.js    input -> rules, rules events -> sound, HUD and game-over text

import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createSnake, turn, advance, drainEvents, DIRS } from "/app/rules.js";
import { drawGame, layoutFor, FLASH_MS } from "/app/render.js";

export const game = {
    id: "snake",
    clearColor: "#06100a",

    create(api) {
        return {
            score: 0,
            board: createSnake(),
            flash: 0,              // ms left on the food pulse
            play: api.play,
            highScore: api.highScore,
        };
    },

    update(run, dt, input) {
        const board = run.board;
        for (const name of ["up", "down", "left", "right"]) {
            if (input.pressed(name)) { turn(board, DIRS[name]); break; }
        }

        advance(board, dt);
        run.flash = Math.max(0, run.flash - dt);
        for (const e of drainEvents(board)) react(run, e);
        run.score = board.score;

        if (!board.alive) return { status: "gameover" };
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawGame(ctx, run.board, layoutFor(w, h), run.flash);
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            length: run ? run.board.snake.length : 3,
        };
    },

    gameOverText(run) {
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Length", run.board.snake.length],
            ["Best", run.highScore()],
        ]);
    },

    // Game SFX only — menu move/select tones are shell-owned.
    cue(name, audio) {
        if (name === "eat") audio.tone(660, 0.08, "square", 0.6);
        else if (name === "die") {
            audio.sequence([
                [300, 0.15, "sawtooth", 0.5],
                [200, 0.2, "sawtooth", 0.5],
                [120, 0.3, "sawtooth", 0.5],
            ]);
        }
    },
};

/** A rules event -> sound and the food pulse. */
function react(run, e) {
    if (e.type === "eat") run.flash = FLASH_MS;
    run.play(e.type);
}
