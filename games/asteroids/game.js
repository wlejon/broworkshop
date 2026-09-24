// Asteroids — arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: input -> rules, rules events -> sound and debris.
//   rules.js   ship, rocks, bullets on the wrapping field
//   render.js  vector drawing + the title backdrop

import { createEffects } from "/lib/arcade/effects.js";
import { bindPointer } from "/lib/arcade/pointer.js";
import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createAsteroids, step, drainEvents } from "/app/rules.js";
import { drawField, createTitleRocks, drawTitleRocks } from "/app/render.js";

// White square debris drifting to a stop; no gravity in space.
const fx = createEffects({
    particle: "square",
    burst: { speed: 100, speedVar: 200, up: 0, life: 500, lifeVar: 400, size: 2, sizeVar: 0, gravity: 0, drag: 1, spin: 0 },
});
const DEBRIS = { large: 22, medium: 14, small: 8 };
const BANG = { large: "bang-large", medium: "bang-med", small: "bang-small" };

let api = null;
let titleRocks = null;

export const game = {
    id: "asteroids",
    clearColor: "#000000",

    // Relabel the standard actions for this control scheme (names stay shared).
    actions: [
        { name: "left", label: "Rotate Left", defaults: ["a", "ArrowLeft"] },
        { name: "right", label: "Rotate Right", defaults: ["d", "ArrowRight"] },
        { name: "up", label: "Thrust", defaults: ["w", "ArrowUp"] },
        { name: "primary", label: "Fire", defaults: [" ", "Mouse0"] },
        { name: "secondary", label: "Mouse Thrust", defaults: ["Shift", "Mouse2"] },
    ],

    init(shellApi) {
        api = shellApi;
        bindPointer(api, {
            move(p) {
                const run = api.getRun();
                if (run) run.pointer = { x: p.x, y: p.y };
            },
        });
        // Right button is thrust; keep the context menu off the canvas.
        api.view.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    },

    create(shellApi) {
        const { w, h } = shellApi.view.size();
        fx.clear();
        return {
            score: 0,
            field: createAsteroids(w, h),
            pointer: { x: w / 2, y: h / 2 },
            play: shellApi.play,
            highScore: shellApi.highScore,
        };
    },

    update(run, dt, input) {
        const field = run.field;
        const { w, h } = api.view.size();
        field.W = w;
        field.H = h;

        step(field, dt, {
            left: input.down("left"),
            right: input.down("right"),
            thrust: input.down("up"),
            fire: input.pressed("primary"),
            aim: input.down("secondary") ? run.pointer : null,
        });
        fx.update(dt);
        run.score = field.score;

        for (const e of drainEvents(field)) react(run, e);
        if (field.over) return { status: "gameover" };
    },

    draw(run, ctx) {
        drawField(ctx, run.field);
        fx.draw(ctx);
    },

    drawTitle(ctx, view, o) {
        const { w, h } = view.size();
        titleRocks = titleRocks || createTitleRocks(w, h);
        drawTitleRocks(ctx, titleRocks, w, h, o && o.dt);
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
    fire: [[880, 0.08, "square", 0.3]],
    "bang-large": [[80, 0.12, "sawtooth", 0.7], [50, 0.2, "sawtooth", 0.5]],
    "bang-med": [[120, 0.1, "sawtooth", 0.55], [70, 0.12, "sawtooth", 0.4]],
    "bang-small": [[200, 0.1, "sawtooth", 0.45]],
    "ship-explode": [[90, 0.2, "sawtooth", 0.7], [55, 0.25, "sawtooth", 0.55], [40, 0.2, "sawtooth", 0.4]],
    "extra-life": [[523, 0.08, "square", 0.6], [659, 0.08, "square", 0.6], [784, 0.12, "square", 0.7]],
    wave: [[330, 0.15, "triangle", 0.6]],
};

/** A rules event -> sound + debris. */
function react(run, e) {
    switch (e.type) {
        case "fire": run.play("fire"); break;
        case "wave": run.play("wave"); break;
        case "extralife": run.play("extra-life"); break;
        case "exhaust": {
            // One ember out the back, carried by the exhaust direction.
            const back = e.angle + Math.PI;
            fx.burst(e.x, e.y, "#ffaa44", 1, {
                speed: 25, speedVar: 50, life: 250, lifeVar: 150,
                vx: Math.cos(back) * 150, vy: Math.sin(back) * 150,
            });
            break;
        }
        case "bang":
            fx.burst(e.x, e.y, "#ffffff", DEBRIS[e.size]);
            run.play(BANG[e.size]);
            break;
        case "shipexplode":
            fx.burst(e.x, e.y, "#ffffff", 30, { speed: 125, speedVar: 250, life: 700, lifeVar: 500 });
            run.play("ship-explode");
            break;
    }
}
