// 2048 — sliding tile puzzle, arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: arrows slide, U undoes, R deals a fresh board; rules events
// -> sound, the win screen and game over once the animation settles.
//   rules.js   grid, slide/merge, spawn, undo, win/stuck
//   render.js  board, tiles, slide animation

import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createBoard, slide, undo, keepPlaying, drainEvents } from "/app/rules.js";
import { drawBoard, drawEmptyBoard, popIn, slideAnim, animDuration } from "/app/render.js";

const DIRS = ["left", "right", "up", "down"];

let api = null;

function freshBoard(run) {
    run.board = createBoard();
    run.anim = popIn(run.board.grid);
    run.animT = 0;
    run.pending = null;
}

export const game = {
    id: "2048",
    clearColor: "#faf8ef",

    actions: [
        { name: "undo", label: "Undo", defaults: ["u"] },
        { name: "restart_board", label: "Restart Board", defaults: ["r"] },
    ],

    init(shellApi) {
        api = shellApi;
    },

    create(shellApi) {
        const run = { score: 0, anim: null, animT: 0, pending: null, highScore: shellApi.highScore };
        freshBoard(run);
        return run;
    },

    update(run, dt, input) {
        const b = run.board;
        if (run.anim) {                                 // input waits for the slide to land
            run.animT += dt;
            if (run.animT < animDuration(run.anim)) return;
            run.anim = null;
            const pending = run.pending;
            run.pending = null;
            if (pending === "win") return { status: "screen", name: "win" };
            if (pending === "gameover") return { status: "gameover" };
            return;
        }

        if (input.pressed("undo")) {
            if (undo(b)) run.score = b.score;
            return;
        }
        if (input.pressed("restart_board")) {
            api.save.maybeHighScore(b.score);          // the discarded board still counts
            freshBoard(run);
            run.score = 0;
            return;
        }

        const dir = DIRS.find((d) => input.pressed(d));
        const result = dir && slide(b, dir);
        if (!result) return;
        run.score = b.score;
        run.anim = slideAnim(result);
        run.animT = 0;
        for (const e of drainEvents(b)) {
            api.play(e.type);
            if (e.type === "win") run.pending = "win";
            else if (e.type === "lose") run.pending = "gameover";
        }
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawBoard(ctx, w, h, run.board.grid, run.anim, run.animT);
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        drawEmptyBoard(ctx, w, h);
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            best: run ? Math.max(run.highScore(), run.score) : 0,
        };
    },

    gameOverText(run) {
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Best", run.highScore()],
        ]);
    },

    onEnterScreen(name, run) {
        if (name === "win" && run) {
            document.getElementById("win-stats").textContent = statsBlock([
                ["Score", run.score],
                ["Best", Math.max(run.highScore(), run.score)],
            ]);
        }
    },

    onMenuAction(action, run) {
        if (action === "keepplaying" && run) {
            keepPlaying(run.board);
            return "playing";
        }
        return null;
    },

    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    merge: [[520, 0.06, "square", 0.45]],
    move: [[280, 0.03, "triangle", 0.2]],
    win: [[523, 0.1, "square", 0.5], [659, 0.1, "square", 0.55], [784, 0.18, "square", 0.6]],
    lose: [[300, 0.12, "sawtooth", 0.45], [200, 0.18, "sawtooth", 0.45]],
};
