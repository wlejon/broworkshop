// Touchdown — gravity lander, arcade plugin.
// Shell (/lib/arcade): screens, loop, pause, bindings, HUD plumbing, high
// score. Here: keys and the right mouse button -> controls, the looping
// thrust sound, exhaust and crash particles, the telemetry panel.
//   rules.js   terrain, lander physics, landing test
//   render.js  drawing

import { bindPointer } from "/lib/arcade/pointer.js";
import { createEffects } from "/lib/arcade/effects.js";
import { statsBlock, newBest } from "/lib/arcade/scores.js";
import { createMission, step, nextLevel, altitude, drainEvents } from "/app/rules.js";
import { createStars, drawWorld, drawBanner, drawTitleBackdrop } from "/app/render.js";

const FRAME = 60;                                  // rules speeds are px/frame

let api = null;

export const game = {
    id: "touchdown",
    clearColor: "#000000",

    actions: [
        { name: "left", label: "Rotate Left", defaults: ["a", "ArrowLeft"] },
        { name: "right", label: "Rotate Right", defaults: ["d", "ArrowRight"] },
        // W/Up for flight thrust; Space stays on primary so menus use Enter/Space to confirm.
        { name: "up", label: "Thrust", defaults: ["w", "ArrowUp"] },
        { name: "primary", label: "Thrust (Space)", defaults: [" "] },
        { name: "secondary", label: "Mouse Thrust", defaults: ["Mouse2"] },
    ],

    init(shellApi) {
        api = shellApi;
        api.view.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        bindPointer(api, {
            move(p) {
                const run = api.getRun();
                if (run) run.mouse = { x: p.x, y: p.y };
            },
        });
    },

    create(shellApi) {
        const { w, h } = shellApi.view.size();
        return {
            score: 0,
            mission: createMission(w, h),
            stars: createStars(w, h),
            mouse: { x: w / 2, y: h / 2 },
            fx: createEffects({ particle: "square" }),
            thrustVoice: -1,
            play: shellApi.play,
            highScore: shellApi.highScore,
        };
    },

    update(run, dt, input) {
        const m = run.mission;
        const size = api.view.size();
        m.W = size.w;
        m.H = size.h;

        const mouseHeld = input.down("secondary");
        step(m, dt, {
            left: input.down("left"),
            right: input.down("right"),
            thrust: input.down("up") || input.down("primary"),
            aim: mouseHeld ? run.mouse : null,
        });
        run.score = m.score;
        const L = m.lander;
        if (L.thrusting) {
            thrustSound(run, true);
            if (Math.random() < 0.8) exhaust(run.fx, L);
        } else {
            thrustSound(run, false);
        }
        run.fx.update(dt);

        let result;
        for (const e of drainEvents(m)) {
            thrustSound(run, false);
            if (e.type === "land") {
                run.play("landed");
                result = { status: "screen", name: "landed" };
            } else if (e.type === "crash") {
                run.play("crash");
                run.fx.burst(L.x, L.y, "#ffbb55", 13, CRASH);
                run.fx.burst(L.x, L.y, "#ffffff", 27, CRASH);
                run.fx.shake(1330, 16);
                result = { status: "gameover" };
            }
        }
        return result;
    },

    draw(run, ctx, view) {
        const o = run.fx.shakeOffset();
        ctx.save();
        ctx.translate(o.x, o.y);
        drawWorld(ctx, run.mission, run.stars, run.fx);
        ctx.restore();
        drawBanner(ctx, run.mission, view.width(), view.height());
    },

    drawTitle(ctx, view, o) {
        drawTitleBackdrop(ctx, view.width(), view.height(), o && o.dt ? o.dt : 16);
    },

    hud(run) {
        if (!run) return { score: 0, level: 1, landed: 0, fuel: 1000 };
        const m = run.mission;
        setText("tel-alt", String(altitude(m)));
        setText("tel-hvel", m.lander.vx.toFixed(2));
        setText("tel-vvel", m.lander.vy.toFixed(2));
        return {
            score: run.score,
            best: Math.max(run.highScore(), run.score),
            level: m.level,
            landed: m.landings,
            fuel: Math.max(0, Math.round(m.lander.fuel)),
        };
    },

    gameOverText(run) {
        return statsBlock([
            ["Score", run.score + newBest(run)],
            ["Level", run.mission.level],
            ["Landed", run.mission.landings],
            ["Best", run.highScore()],
        ]);
    },

    onEnterScreen(name, run) {
        if (name !== "playing" && run) thrustSound(run, false);
        if (name === "landed" && run) {
            const m = run.mission;
            document.getElementById("landed-stats").textContent = statsBlock([
                ["LEVEL", m.level],
                ["PAD WIDTH", m.lastPadWidth],
                ["BONUS", "+" + m.lastBonus],
                ["SCORE", m.score],
                ["FUEL LEFT", Math.round(m.lander.fuel)],
            ]);
        }
        // Telemetry only while a run is on mid-game screens.
        const tel = document.getElementById("telemetry");
        tel.hidden = !(run && (name === "playing" || name === "pause" || name === "landed"));
    },

    onMenuAction(action, run) {
        if (action === "next" && run) {
            nextLevel(run.mission);
            run.fx.clear();
            return "playing";
        }
        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    landed: [[523, 0.09, "square", 0.6], [659, 0.09, "square", 0.6], [784, 0.14, "square", 0.7]],
    crash: [[90, 0.22, "sawtooth", 0.8], [55, 0.28, "sawtooth", 0.6], [40, 0.35, "sawtooth", 0.45]],
};

// Debris: 0.8-5.3 px/frame in every direction, a slight upward kick, lunar gravity.
const CRASH = { speed: 0.8 * FRAME, speedVar: 4.5 * FRAME, up: 0.5 * FRAME, life: 600, lifeVar: 400,
    size: 1, sizeVar: 2, gravity: 0.02 * FRAME * FRAME, drag: 1, spin: 0 };

// One exhaust spark out of the nozzle, in a 0.6 rad cone, carrying some of the ship's drift.
function exhaust(fx, L) {
    fx.burst(L.x + Math.sin(L.angle) * 10, L.y + Math.cos(L.angle) * 10, "#ff9955", 1, {
        angle: Math.PI / 2 - L.angle, arc: 0.6,
        speed: 2.5 * FRAME, speedVar: 1.5 * FRAME, up: 0,
        vx: L.vx * 0.3 * FRAME, vy: L.vy * 0.3 * FRAME,
        life: 280, lifeVar: 120, size: 1, sizeVar: 1.5,
        gravity: 0.02 * FRAME * FRAME, drag: 1, spin: 0,
    });
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// A sustained white-noise voice while the engine burns (one-shot tones don't hold).
function thrustSound(run, on) {
    const actx = api && api.audio && api.audio.ctx();
    if (!actx || on === (run.thrustVoice !== -1)) return;
    try {
        if (on) {
            const id = actx.createVoice();
            actx.setVoiceWaveform(id, "whitenoise");
            actx.setVoiceFrequency(id, 300);
            actx.setVoiceGain(id, 4.0);
            actx.setVoiceAttack(id, 0.02);
            actx.setVoiceDecay(id, 0.1);
            actx.setVoiceSustain(id, 1.0);
            actx.setVoiceRelease(id, 0.08);
            actx.startVoice(id, actx.currentTime);
            run.thrustVoice = id;
        } else {
            actx.stopVoice(run.thrustVoice, actx.currentTime);
            run.thrustVoice = -1;
        }
    } catch (e) {
        run.thrustVoice = -1;
    }
}
