// Breakout — reference arcade plugin with a mid-run screen.
//
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: input -> rules, rules events -> sound and screens.
//   rules.js   the court: paddle, ball and bricks as plain data
//   render.js  drawing a court
// Clearing the wall shows #screen-levelclear; its Next Level item comes back
// through onMenuAction.

import { bindPointer } from "/lib/arcade/pointer.js";
import { statsBlock, newBest } from "/lib/arcade/scores.js";
import {
    createBreakout, startLevel, resize, launch, nudgePaddle, aimPaddle, step, drainEvents,
} from "/app/rules.js";
import { drawCourt } from "/app/render.js";

let api = null;

export const game = {
    id: "breakout",
    clearColor: "#06060a",

    init(shellApi) {
        api = shellApi;
        // The mouse steers the paddle until an arrow key takes over again.
        bindPointer(api, {
            move(p) {
                const run = api.getRun();
                if (run) run.aimX = p.x;
            },
        });
    },

    create(shellApi) {
        const { w, h } = shellApi.view.size();
        return {
            score: 0,
            court: createBreakout(w, h),
            aimX: null,            // mouse x while the mouse has the paddle
            play: shellApi.play,
            highScore: shellApi.highScore,
        };
    },

    update(run, dt, input) {
        const court = run.court;
        const { w, h } = api.view.size();
        resize(court, w, h);

        if (input.pressed("left") || input.pressed("right")) run.aimX = null;
        if (input.pressed("primary")) launch(court);
        if (run.aimX != null) aimPaddle(court, run.aimX);
        else nudgePaddle(court, (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0), dt);

        step(court, dt);
        run.score = court.score;

        let result;
        for (const e of drainEvents(court)) {
            run.play(e.type === "brick" ? "brick" + e.row : e.type);
            if (e.type === "levelclear") result = { status: "screen", name: "levelclear" };
            if (e.type === "gameover") result = { status: "gameover" };
        }
        return result;
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawCourt(ctx, run.court, w, h);
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            level: run ? run.court.level : 1,
            lives: run ? run.court.lives : 3,
        };
    },

    gameOverText(run) {
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Level", run.court.level],
            ["Best", run.highScore()],
        ]);
    },

    onEnterScreen(name, run) {
        if (name === "levelclear" && run) {
            document.getElementById("levelclear-stats").textContent = statsBlock([
                ["Level", run.court.level + " complete"],
                ["Score", run.score],
            ]);
        }
    },

    onMenuAction(action, run) {
        if (action === "nextlevel" && run) {
            startLevel(run.court, run.court.level + 1);
            return "playing";
        }
        return null;
    },

    // Game SFX only — menu move/select tones are shell-owned.
    cue(name, audio) {
        if (name.startsWith("brick")) {
            // Higher rows ring higher.
            audio.tone(400 + Number(name.slice(5)) * 60, 0.07, "square", 0.6);
            return;
        }
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    launch: [[500, 0.08, "triangle", 0.5]],
    paddle: [[220, 0.05, "square", 0.5]],
    wall: [[180, 0.04, "square", 0.4]],
    life: [[300, 0.15, "sawtooth", 0.5], [200, 0.2, "sawtooth", 0.5]],
    gameover: [[300, 0.2, "sawtooth", 0.5], [250, 0.2, "sawtooth", 0.5], [180, 0.4, "sawtooth", 0.5]],
    levelclear: [[523, 0.1, "square", 0.7], [659, 0.1, "square", 0.7], [784, 0.15, "square", 0.8]],
};
