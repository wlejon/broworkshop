// Missile Command — defend the cities, arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: the mouse aims, Fire launches, rules events -> sound and the
// wave-complete screen.
//   rules.js   battlefield, waves, blasts
//   render.js  drawing

import { bindPointer } from "/lib/arcade/pointer.js";
import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createDefense, launch, step, nextWave, drainEvents, CITY_BONUS, AMMO_BONUS } from "/app/rules.js";
import { drawBattle, createSky } from "/app/render.js";

let api = null;

export const game = {
    id: "missile-command",
    clearColor: "#05050c",

    init(shellApi) {
        api = shellApi;
        bindPointer(api, {
            move(p) {
                const run = api.getRun();
                if (run) run.aim = { x: p.x, y: p.y };
            },
        });
    },

    create(shellApi) {
        const { w, h } = shellApi.view.size();
        const defense = createDefense(w, h);
        return {
            score: 0,
            defense,
            sky: createSky(w, h, defense.groundY),
            aim: { x: w / 2, y: h / 2 },
            play: shellApi.play,
            highScore: shellApi.highScore,
        };
    },

    update(run, dt, input) {
        const d = run.defense;
        if (input.pressed("primary")) launch(d, run.aim.x, run.aim.y);
        step(d, dt);
        run.score = d.score;

        let result;
        for (const e of drainEvents(d)) {
            if (e.type === "wavecleared") {
                run.play("waveEnd");
                result = { status: "screen", name: "wavecomplete" };
            } else if (e.type === "gameover") {
                run.play("gameOver");
                result = { status: "gameover" };
            } else {
                run.play(e.type);
            }
        }
        return result;
    },

    draw(run, ctx) {
        drawBattle(ctx, run.defense, run.sky, run.aim);
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            wave: run ? run.defense.wave : 1,
        };
    },

    gameOverText(run) {
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Wave", run.defense.wave],
            ["Best", run.highScore()],
        ]);
    },

    onEnterScreen(name, run) {
        if (name === "wavecomplete" && run) {
            const s = run.defense.summary;
            document.getElementById("wave-stats").textContent = statsBlock([
                ["Cities saved", s.cities + " x " + CITY_BONUS + " = " + s.cityBonus],
                ["Unused missiles", s.ammo + " x " + AMMO_BONUS + " = " + s.ammoBonus],
                ["Total score", run.score],
            ]);
        }
        if (name === "title") document.getElementById("title-hi").textContent = String(api ? api.highScore() : 0);
    },

    onMenuAction(action, run) {
        if (action === "continue" && run) {
            nextWave(run.defense);
            return "playing";
        }
        return null;
    },

    // Game SFX only — menu move/select tones are shell-owned.
    cue(name, audio) {
        if (name === "explode") {
            audio.tone(90 + Math.random() * 40, 0.25, "sawtooth", 0.7);
            return;
        }
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    launch: [[220, 0.08, "sawtooth", 0.4]],
    cityhit: [[60, 0.5, "sawtooth", 0.9]],
    silohit: [[80, 0.4, "sawtooth", 0.8]],
    waveEnd: [[523, 0.12, "square", 0.6], [659, 0.12, "square", 0.6], [784, 0.16, "square", 0.7]],
    gameOver: [[220, 0.3, "sawtooth", 0.6], [180, 0.3, "sawtooth", 0.6], [140, 0.6, "sawtooth", 0.7]],
};
