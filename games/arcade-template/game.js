// Arcade template — the game plugin: a thin layer between the shell and
// your rules. Copy this folder to start a game (see README.md).
//
// The shell (/lib/arcade) owns screens, the loop, pause, rebindable input,
// the HUD plumbing and the high score. This file only:
//   - turns input into rules calls          (update)
//   - turns rules events into sound/screens (react)
//   - hands the state to render.js          (draw)
//   - fills the HUD and game-over text      (hud, gameOverText)
// Session state lives on `run`; nothing here is module-level game state.
//
// Contract: /lib/arcade/README.md

import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createField, tap, step, drainEvents } from "/app/rules.js";
import { drawField, drawGrid } from "/app/render.js";

export const game = {
    /** Save / high-score namespace. Change it for every new game. */
    id: "arcade-template",

    /** Canvas clear colour; matches --arcade-bg in theme.css. */
    clearColor: "#0a0a0c",

    // Extra rebindable actions beyond the standard up/down/left/right/
    // primary/secondary/pause/confirm, e.g.:
    // actions: [{ name: "bomb", label: "Bomb", defaults: ["b"] }],

    // Optional one-time setup with the shell api: bindPointer, createOptions,
    // createScoreTabs, async loads. See gemswap / pegbounce.
    // init(api) {},

    /** A fresh run (Play, Play Again, Restart). */
    create(api) {
        return {
            score: 0,
            field: createField(),
            play: api.play,
            highScore: api.highScore,
        };
    },

    /**
     * One frame of play. dt is milliseconds. Return { status: "gameover" }
     * to end the run, or { status: "screen", name } for a mid-run screen.
     */
    update(run, dt, input) {
        const field = run.field;
        if (input.pressed("primary")) tap(field);
        step(field, dt);
        run.score = field.score;

        let result;
        for (const e of drainEvents(field)) {
            if (e.type === "score") run.play("score");
            if (e.type === "timeup") result = { status: "gameover" };
        }
        return result;
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawField(ctx, run.field, w, h);
    },

    /** Under the title menu before the first run; o.dt animates a backdrop. */
    drawTitle(ctx, view) {
        const { w, h } = view.size();
        drawGrid(ctx, w, h);
    },

    /** Field -> value; the shell writes #hud-<field> and fills #hud-best. */
    hud(run) {
        return { score: run ? run.score : 0 };
    },

    /** #gameover-stats text. The shell has already recorded the high score. */
    gameOverText(run) {
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Best", run.highScore()],
        ]);
    },

    /** Game sounds only; the shell plays the menu move/select tones. */
    cue(name, audio) {
        if (name === "score") audio.tone(720, 0.06, "square", 0.45);
    },
};
