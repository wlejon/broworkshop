// Stompworld: arcade plugin. Three modes share the shell's screens:
//   play   a human run of the level (play.js)
//   train  self-play training with a live replay (ai/train.js)
//   demo   the trained agent plays the level (ai/demo.js)
// The shell owns menus, pause, HUD and high score; this file maps input
// to the active mode and letterboxes the fixed 800×576 view into the canvas.
//
//   rules.js   shared physics + hit rules      play.js  human play
//   sim.js     headless env for the AI         render.js  shared drawing
//   level.js   the stage                       art.js   pixel-art sprites
//   ai/        observation, policy, workers, train + demo modes

import { VIEW_W, VIEW_H } from "/app/rules.js";
import { createPlay, stepPlay, LIVES, TIME_LIMIT } from "/app/play.js";
import {
    drawSky, drawWorld, drawBeams, drawExplosions, drawAimCursor,
} from "/app/render.js";
import { createTraining } from "/app/ai/train.js";
import { createDemo } from "/app/ai/demo.js";

// Train AI and AI Demo need the learning half of bro.ai.game (nn, grid,
// learn), which builds without the AI tower report as { available: false }.
const AI_PARTS = ["nn", "grid", "learn"];
const aiGame = globalThis.bro && bro.ai && bro.ai.game;
const AI_READY = !!aiGame && AI_PARTS.every((k) => aiGame[k] && aiGame[k].available !== false);
if (!AI_READY) {
    for (const action of ["train", "demo"]) {
        const item = document.querySelector('#screen-title [data-action="' + action + '"]');
        if (!item) continue;
        item.classList.add("disabled");
        item.textContent += " (not in this build)";
    }
}

// The shell's create() takes no arguments, so the menu action that starts
// a run leaves the mode here for it.
let nextMode = "play";
// The run whose workers / listeners are live (stopped when it is replaced).
let current = null;
// Checkpoint folder for train + demo (tests point it at scratch space).
let ckptDir = undefined;

const wired = new WeakSet();
const pointer = { clientX: -1, clientY: -1 };

export const game = {
    id: "stompworld",
    clearColor: "#000",

    actions: [
        { name: "primary", label: "Jump", defaults: [" ", "w", "ArrowUp"] },
        { name: "shoot", label: "Fire Beam", defaults: ["j", "k", "f", "Mouse0"] },
    ],

    create(api) {
        stopCurrent();
        wire(api);
        const run = { mode: nextMode, view: api.view, play: api.play, save: api.save, score: 0 };
        if (run.mode === "train") run.train = createTraining(api.play, { ckptDir });
        else if (run.mode === "demo") run.demo = createDemo({ ckptDir });
        else {
            run.world = createPlay(api.play);
            api.input.consume("shoot");   // the click that chose Play
        }
        current = run;
        return run;
    },

    update(run, dt, input) {
        if (run.train) { run.train.update(dt); return; }
        if (run.demo) { run.demo.update(dt); return; }
        const w = run.world;
        const result = stepPlay(w, dt, {
            left: input.down("left"),
            right: input.down("right"),
            // W / ArrowUp are also the shell's "up" keys, so accept either action.
            jumpHeld: input.down("primary") || input.down("up"),
            jumpPressed: input.pressed("primary") || input.pressed("up"),
            fire: input.pressed("shoot"),
            aim: aimWorld(run),
        });
        run.score = w.score;
        if (result === "gameover") return { status: "gameover" };
        if (result === "win") {
            run.newBest = run.save.maybeHighScore(run.score);
            return { status: "screen", name: "win" };
        }
    },

    draw(run, ctx, view) {
        const box = letterbox(view);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, view.width(), view.height());
        ctx.save();
        ctx.translate(box.ox, box.oy);
        ctx.scale(box.scale, box.scale);
        ctx.beginPath();
        ctx.rect(0, 0, VIEW_W, VIEW_H);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        drawSky(ctx);
        if (run.train) run.train.draw(ctx);
        else if (run.demo) run.demo.draw(ctx);
        else drawPlay(run, ctx);
        ctx.restore();
    },

    drawTitle(ctx, view) {
        drawSky(ctx, view.width(), view.height());
    },

    hud(run) {
        const w = run && run.world;
        if (!w) return { score: 0, lives: LIVES, time: TIME_LIMIT, beam: "—" };
        return {
            score: w.score,
            lives: Math.max(0, w.lives),
            time: Math.ceil(w.timeLeft),
            beam: w.hasWeapon ? "ON" : "—",
        };
    },

    gameOverText(run) {
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return "Score    " + (run ? run.score : 0) + tag + "\nBest     " + (run ? run.save.highScore() : 0);
    },

    onEnterScreen(name, run) {
        if (name === "title") {
            stopCurrent();
            nextMode = "play";
        }
        if (name === "win" && run) {
            document.getElementById("win-stats").textContent =
                "Score: " + run.score + (run.newBest ? "  ·  NEW BEST" : "") + "   Best: " + run.save.highScore();
        }
        // Train and demo draw their own status panels.
        if (run && run.mode !== "play" && name !== "title" && name !== "howto") {
            const hud = document.getElementById("hud");
            hud.hidden = true;
            hud.style.display = "none";
        }
    },

    onMenuAction(action) {
        if (action === "train" || action === "demo") {
            if (!AI_READY) return null;
            nextMode = action;
            return { startRun: true };
        }
        return null;
    },

    cue(name, audio) {
        const seq = SOUNDS[name];
        if (!seq) return;
        if (seq.length === 1) audio.tone(...seq[0]);
        else audio.sequence(seq);
    },
};

const SOUNDS = {
    jump: [[520, 0.06, "square", 0.35], [720, 0.08, "square", 0.3]],
    land: [[140, 0.05, "triangle", 0.35]],
    stomp: [[260, 0.05, "square", 0.55], [120, 0.1, "sawtooth", 0.55], [80, 0.08, "whitenoise", 0.3]],
    die: [[440, 0.1, "square", 0.55], [330, 0.12, "sawtooth", 0.55], [220, 0.18, "sawtooth", 0.55], [150, 0.3, "triangle", 0.55]],
    win: [[523, 0.1, "square", 0.55], [659, 0.1, "square", 0.6], [784, 0.1, "square", 0.65], [1047, 0.25, "square", 0.7]],
    gameover: [[392, 0.2, "sawtooth", 0.55], [330, 0.2, "sawtooth", 0.55], [262, 0.4, "triangle", 0.55]],
    timeWarn: [[880, 0.08, "square", 0.4]],
    flyer: [[0, 0.08, "whitenoise", 0.18]],
    beam: [[1400, 0.04, "square", 0.35], [800, 0.06, "sawtooth", 0.45]],
    boom: [[120, 0.1, "sawtooth", 0.65], [60, 0.18, "whitenoise", 0.55], [40, 0.22, "triangle", 0.45]],
    pause: [[300, 0.05, "square", 0.3], [200, 0.08, "square", 0.3]],
};

// ── Modes ───────────────────────────────────────────────────────────────

function stopCurrent() {
    if (!current) return;
    if (current.train) current.train.stop();
    if (current.demo) current.demo.stop();
    current = null;
}

/** Once per shell: pointer tracking for aiming, F / C in training. */
function wire(api) {
    if (wired.has(api)) return;
    wired.add(api);
    window.addEventListener("mousemove", (e) => {
        pointer.clientX = e.clientX;
        pointer.clientY = e.clientY;
    });
    api.input.onAction((action, phase, key) => {
        const t = current && current.train;
        if (!t || phase !== "down" || api.getScreen() !== "playing") return;
        if (key === "f" || key === "F") t.toggleFast();
        else if (key === "c" || key === "C") t.clearTape();
    });
}

// ── Play view ───────────────────────────────────────────────────────────

function drawPlay(run, ctx) {
    const w = run.world;
    drawWorld(ctx, w.cam, {
        tilemap: w.tilemap,
        flag: w.flag,
        pickup: null,
        stompers: w.stompers,
        flyers: w.flyers,
        hero: w.hero,
        heroTick: w.tick,
    });
    drawBeams(ctx, w.cam, w.beams);
    drawExplosions(ctx, w.cam, w.explosions);
    if (w.hasWeapon) {
        const p = pointerView(run.view);
        drawAimCursor(ctx, p.x, p.y);
    }
}

/** Scale + offset that fit the virtual view into the canvas. */
function letterbox(view) {
    const W = view.width(), H = view.height();
    const scale = Math.min(W / VIEW_W, H / VIEW_H);
    return { scale, ox: Math.floor((W - VIEW_W * scale) / 2), oy: Math.floor((H - VIEW_H * scale) / 2) };
}

/** The pointer in virtual-view coordinates. */
function pointerView(view) {
    const rect = view.canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return { x: VIEW_W / 2, y: VIEW_H / 2 };
    const box = letterbox(view);
    const cx = (pointer.clientX - rect.left) * (view.width() / rect.width);
    const cy = (pointer.clientY - rect.top) * (view.height() / rect.height);
    return { x: (cx - box.ox) / box.scale, y: (cy - box.oy) / box.scale };
}

/** Aim point in the world, or null before the mouse has moved (fire ahead). */
function aimWorld(run) {
    if (pointer.clientX < 0) return null;
    const p = pointerView(run.view);
    return { x: p.x + run.world.cam.x, y: p.y + run.world.cam.y };
}

// ── Test hooks ──────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
    window.__SW = {
        get mode() { return current ? current.mode : null; },
        get nextMode() { return nextMode; },
        get world() { return current && current.world; },
        get train() { return current && current.train ? current.train.state : null; },
        get demo() { return current && current.demo ? current.demo.state : null; },
        /** Train / demo read and write checkpoints here instead of ckpt/. */
        setCheckpointDir(dir) { ckptDir = dir; },
    };
}
