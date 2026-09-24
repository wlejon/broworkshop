// Clap Runner — a sound-driven neon runner on the arcade shell.
// Shell owns screens, loop, pause, HUD plumbing and the high score.
// Run: runner.js · drawing: render.js · mic -> moves: gestures.js
// Sounds: sfx.js · telemetry strip: ui.js

import { createEffects } from "/lib/arcade/effects.js";
import { createOptions } from "/lib/arcade/options.js";
import { Runner, WORLD_W, WORLD_H } from "/app/runner.js";
import { glowDot, emit, makeBackdrop, drawBackdrop, drawRun } from "/app/render.js";
import { createDetector, createMic } from "/app/gestures.js";
import { createSfx } from "/app/sfx.js";
import { flashBadge, badgeFor, renderTelemetry, setMicButton, setMuteButton, bindButtons } from "/app/ui.js";

const DOUBLE_TAP_MIN_MS = 80;
const DOUBLE_TAP_MAX_MS = 350;

const fx = createEffects({
    particle: glowDot,
    label: { font: "\"Courier New\", monospace", small: 16, big: 24 },
});
const detector = createDetector();
const backdrop = makeBackdrop(7);
const idle = new Runner();          // the title screen's runner, standing still

let api = null;
let sfx = null;
let mic = null;
let options = null;

export const game = {
    id: "clap-runner",
    clearColor: "#060612",
    hudScreens: ["title", "settings"],

    // Space jumps (keyboard only: a click on the strip's buttons must not);
    // W / Up jump through "up", S / Down slide through "down", E glides.
    actions: [
        { name: "primary", label: "Jump", defaults: [" "] },
        { name: "glide", label: "Glide", defaults: ["e"] },
    ],

    defaults: {
        highScore: 0,
        sfxVol: 80,
        clapThreshold: 0.28,
        whistleMinHz: 700,
    },

    init(shellApi) {
        api = shellApi;
        sfx = createSfx(() => api.audio.ctx());
        mic = createMic(detector, onMicFrame);
        options = createOptions(api, [
            { key: "clapThreshold", action: "cycle-clap",
              values: [0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4, 0.5, 0.6, 0.8],
              label: (v) => v.toFixed(2), apply: (v) => { detector.clapThreshold = v; } },
            { key: "whistleMinHz", action: "cycle-whistle",
              values: [500, 600, 700, 800, 900, 1000, 1200, 1500],
              label: (v) => String(v), apply: (v) => { detector.whistleMinHz = v; } },
            { key: "sfxVol", action: "cycle-sfx",
              values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
              label: (v) => String(v),
              apply: (v) => { api.audio.setSfxVol(v / 100); sfx.setVolume(v / 100); } },
        ]);
        options.applyAll();
        bindButtons({ mic: toggleMic, settings: () => api.switchTo("settings"), mute: toggleMute });
        refreshBest();
    },

    create(shellApi) {
        fx.clear();
        detector.drain();
        const runner = new Runner();
        runner.fx = runnerFx(shellApi, runner);
        return {
            score: 0,
            runner,
            pending: [],          // mic actions waiting for the next update
            lastTap: -Infinity,   // sim ms of the last jump key press
            keySlide: false,
        };
    },

    update(run, dt, input) {
        const r = run.runner;
        const now = r.time * 1000;

        if (input.pressed("primary") || input.pressed("up")) {
            if (now - run.lastTap > DOUBLE_TAP_MIN_MS && now - run.lastTap < DOUBLE_TAP_MAX_MS) {
                r.superJump();
                flashBadge("SUPER JUMP");
            } else {
                r.jump();
                flashBadge("JUMP");
            }
            run.lastTap = now;
        }
        if (input.pressed("down")) {
            run.keySlide = true;
            r.slideStart();
            flashBadge("SLIDE DASH");
        } else if (run.keySlide && !input.down("down")) {
            run.keySlide = false;
            r.slideEnd();
        }
        if (input.pressed("glide")) flashBadge("HOVER GLIDE");

        for (const ev of run.pending) {
            if (ev.action === "jump") r.jump();
            else if (ev.action === "superJump") r.superJump();
            else if (ev.action === "slide") r.slideStart();
        }
        run.pending.length = 0;

        const glide = input.down("glide") || detector.glideActive;
        if (glide && !r.player.gliding) r.glideStart();
        else if (!glide && r.player.gliding) r.glideEnd();

        const crashed = r.step(Math.min(0.1, dt / 1000));
        fx.update(dt);
        run.score = r.score;
        if (crashed) return { status: "gameover" };
    },

    draw(run, ctx, view) {
        drawScene(ctx, view, run.runner);
    },

    drawTitle(ctx, view) {
        drawScene(ctx, view, idle);
    },

    hud(run) {
        refreshBest();
        const r = run ? run.runner : idle;
        return {
            score: r.score.toLocaleString(),
            multiplier: r.multiplier + "X",
            distance: Math.floor(r.distance) + " m",
            coins: r.coins,
        };
    },

    gameOverText(run) {
        refreshBest();
        const r = run.runner;
        return "Score: " + r.score.toLocaleString() + " | Distance: " + Math.floor(r.distance) +
            "m | Coins: " + r.coins + (run._newBest ? "\nNEW BEST!" : "");
    },

    onEnterScreen(name, run) {
        // The glide hum must not outlive the run on a menu.
        if (name !== "playing" && run) run.runner.glideEnd();
        if (name === "settings") options.render();
    },

    onMenuAction(action, run) {
        if (options.handle(action)) return null;
        if (action === "settings") return "settings";
        if (action === "settings-back") return run && !run.runner.crashed ? "pause" : "title";
        return null;
    },

    cue(name) {
        if (sfx) sfx.play(name);
    },
};

// ── Wiring ────────────────────────────────────────────────────────────────

/** 960 x 540 world scaled onto the view. */
function drawScene(ctx, view, runner) {
    const { w, h } = view.size();
    ctx.save();
    ctx.scale(w / WORLD_W, h / WORLD_H);
    drawBackdrop(ctx, backdrop, runner.scroll);
    drawRun(ctx, runner);
    fx.draw(ctx);
    ctx.restore();
}

/** Runner effects -> shell cues and particle bursts (slide / thrust trail at its speed). */
function runnerFx(shellApi, runner) {
    return {
        cue: (name) => shellApi.play(name),
        emit: (kind, x, y, color, count) => emit(fx, kind, x, y, color, count, runner.speed),
        text: (x, y, text, color) => fx.label(x, y, text, color),
    };
}

/** Every 10 ms mic frame: telemetry strip, badge, and queued moves. */
function onMicFrame(t) {
    renderTelemetry(t);
    const run = api.getRun();
    const playing = api.getScreen() === "playing" && run;
    for (const ev of detector.drain()) {
        const badge = badgeFor(ev.action);
        if (badge) flashBadge(badge);
        if (playing) run.pending.push(ev);
    }
}

function toggleMic() {
    if (mic.active) {
        mic.stop();
        setMicButton("off");
        flashBadge("KEYBOARD ONLY");
        renderTelemetry(detector.telemetry);
        return;
    }
    const ok = mic.start({ live: true });
    setMicButton(ok ? "on" : "failed");
    flashBadge(ok ? "MIC LISTENING" : "MIC DENIED");
}

function toggleMute() {
    sfx.setMuted(!sfx.muted);
    setMuteButton(sfx.muted);
}

function refreshBest() {
    const el = document.getElementById("hud-best");
    if (el && api) el.textContent = api.save.highScore().toLocaleString();
}

/** Test surface: the live mic wiring and the detector. */
export const internals = {
    detector, fx,
    get mic() { return mic; },
    get sfx() { return sfx; },
    get options() { return options; },
};
