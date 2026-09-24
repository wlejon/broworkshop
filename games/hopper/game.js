// Hopper — Frogger-style lane crosser, arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: input -> hops, rules events -> sound and banners.
//   rules.js   lanes, logs, pads, timer, lives
//   render.js  terrain, lanes, frog

import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createHopper, hop, step, drainEvents } from "/app/rules.js";
import { drawCrossing, layoutFor } from "/app/render.js";

const HOPS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DEATH_TEXT = { squish: "SQUISH!", drown: "SPLASH!", timeout: "TIME UP!" };

export const game = {
    id: "hopper",
    clearColor: "#06060a",

    create(api) {
        return {
            score: 0,
            crossing: createHopper(),
            banner: { text: "", timer: 0 },
            play: api.play,
            highScore: api.highScore,
        };
    },

    update(run, dt, input) {
        const g = run.crossing;
        for (const name in HOPS) {
            if (input.pressed(name)) { hop(g, HOPS[name][0], HOPS[name][1]); break; }
        }
        step(g, dt);
        run.banner.timer = Math.max(0, run.banner.timer - dt);
        run.score = g.score;

        for (const e of drainEvents(g)) react(run, e);
        if (g.over) return { status: "gameover" };
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawCrossing(ctx, run.crossing, layoutFor(w, h), w, h, run.banner);
    },

    hud(run) {
        if (!run) return { score: 0, lives: 3, time: 60, pads: "0/5" };
        const g = run.crossing;
        return {
            score: run.score,
            best: Math.max(run.highScore(), run.score),     // live: the shell records it at the end
            lives: g.lives,
            time: Math.ceil(g.timeLeft / 1000),
            pads: g.padsFilled + "/" + g.pads.length,
        };
    },

    gameOverText(run) {
        const g = run.crossing;
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Level", g.level],
            ["Pads", g.padsFilled + "/" + g.pads.length],
            ["Best", run.highScore()],
        ]);
    },

    // Game SFX only — menu move/select tones are shell-owned.
    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    hop: [[520, 0.06, "square", 0.5]],
    squish: [[180, 0.2, "sawtooth", 0.7], [100, 0.3, "sawtooth", 0.7]],
    drown: [[300, 0.15, "triangle", 0.6], [150, 0.3, "triangle", 0.6]],
    pad: [[660, 0.1, "square", 0.7], [880, 0.15, "square", 0.8]],
    win: [[523, 0.1, "square", 0.7], [659, 0.1, "square", 0.7], [784, 0.1, "square", 0.7], [1047, 0.2, "square", 0.8]],
};

function react(run, e) {
    switch (e.type) {
        case "hop": run.play("hop"); break;
        case "pad": run.play("pad"); break;
        case "roundclear":
            run.play("win");
            run.banner = { text: "ROUND CLEAR!", timer: 1500 };
            break;
        case "death":
            run.play(e.kind === "drown" ? "drown" : "squish");
            run.banner = { text: DEATH_TEXT[e.kind], timer: 900 };
            break;
    }
}
