// Invaders — arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: input -> rules, rules events -> sound and explosions.
//   rules.js   formation, shields, bullets, UFO, lives
//   render.js  sprites, shields, starfield

import { createEffects } from "/lib/arcade/effects.js";
import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createInvaders, step, drainEvents } from "/app/rules.js";
import { drawField, drawTitleStars, createStars, twinkle } from "/app/render.js";

// Square debris, no gravity, slowing like the original per-frame drag.
const fx = createEffects({
    particle: "square",
    burst: { speed: 40, speedVar: 140, up: 0, life: 400, lifeVar: 300, size: 3, sizeVar: 0, gravity: 0, drag: 0.96, spin: 0 },
});

let api = null;

export const game = {
    id: "invaders",
    clearColor: "#000",

    init(shellApi) { api = shellApi; },

    create(shellApi) {
        const { w, h } = shellApi.view.size();
        fx.clear();
        return {
            score: 0,
            field: createInvaders(w, h),
            stars: createStars(w, h),
            play: shellApi.play,
            highScore: shellApi.highScore,
        };
    },

    update(run, dt, input) {
        const field = run.field;
        const { w, h } = api.view.size();
        field.W = w;
        field.H = h;

        twinkle(run.stars);
        step(field, dt, {
            left: input.down("left"),
            right: input.down("right"),
            fire: input.pressed("primary"),
        });
        fx.update(dt);
        run.score = field.score;

        for (const e of drainEvents(field)) react(run, e);
        if (field.phase === "over") return { status: "gameover" };
    },

    draw(run, ctx) {
        drawField(ctx, run.field, run.stars);
        fx.draw(ctx);
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        drawTitleStars(ctx, w, h);
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            wave: run ? run.field.wave : 1,
            lives: run ? run.field.lives : 3,
        };
    },

    gameOverText(run) {
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Wave", run.field.wave],
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
    shoot: [[880, 0.08, "square", 0.4]],
    hit: [[200, 0.12, "sawtooth", 0.6]],
    kill: [[120, 0.18, "sawtooth", 0.7]],
    march0: [[90, 0.08, "triangle", 0.5]],
    march1: [[120, 0.08, "triangle", 0.5]],
    ufo: [[660, 0.15, "square", 0.5]],
    die: [[300, 0.2, "sawtooth", 0.6], [200, 0.25, "sawtooth", 0.6], [100, 0.35, "sawtooth", 0.6]],
};

/** A rules event -> sound + debris. */
function react(run, e) {
    switch (e.type) {
        case "shoot": run.play("shoot"); break;
        case "march": run.play("march" + e.phase); break;
        case "ufoarrive": run.play("ufo"); break;
        case "shield":
            fx.burst(e.x, e.y, e.enemy ? "#ff8040" : "#4fff6a", e.enemy ? 4 : 5);
            if (!e.enemy) run.play("hit");
            break;
        case "cancel": fx.burst(e.x, e.y, "#fff", 6); break;
        case "kill": fx.burst(e.x, e.y, "#4fff6a", 14); run.play("kill"); break;
        case "ufo": fx.burst(e.x, e.y, "#ff5080", 20); run.play("kill"); break;
        case "die": fx.burst(e.x, e.y, "#fff", 30); run.play("die"); break;
    }
}
