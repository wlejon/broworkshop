// Nova Squadron — rail-shooter trench run on the arcade shell.
// Shell owns screens, loop, pause, HUD plumbing and the game-over best.
// Session: flight.js (waves.js, enemies.js) · camera: camera.js · drawing: render.js

import { bindPointer } from "/lib/arcade/pointer.js";
import { createOptions, sfxVolume } from "/lib/arcade/options.js";
import { createCamera, createStarfield } from "/app/camera.js";
import { Flight, FORWARD_SPEED, shieldBar } from "/app/flight.js";
import { drawFlight, createTunnel } from "/app/render.js";

const YOKE_SENSITIVITY = 1 / 240;     // pointer-lock: px of motion per unit of yoke
const YOKE_DEAD = 0.06;               // absolute mode: dead zone around the centre

// Menu-level choices: a seed for the next run (tests).
export const menu = { seed: null };

let options = null;
let camera = null;
let stars = null;
const tunnel = createTunnel();
let tunnelLast = 0;

export const game = {
    id: "starfighter",
    clearColor: "#000000",

    actions: [
        { name: "primary", label: "Fire", defaults: [" ", "Mouse0"] },
        { name: "secondary", label: "Fire (alt)", defaults: ["Mouse2"] },
        { name: "target", label: "Targeting Computer", defaults: ["t"] },
    ],

    defaults: { sfxVol: 80 },

    init(api) {
        options = createOptions(api, [sfxVolume()]);
        options.applyAll();
        const canvas = api.view.canvas;
        bindPointer(api, {
            move(p, e) {
                const run = api.getRun();
                if (run) aimYoke(run, api.view, p, e);
            },
        });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        // Relative yoke re-centres whenever the lock is (re)taken.
        document.addEventListener("pointerlockchange", () => {
            const run = api.getRun();
            if (run && document.pointerLockElement === canvas) run.flight.steer(0, 0);
        });
    },

    create(api) {
        const { w, h } = api.view.size();
        camera = camera || createCamera(w, h);
        camera.setViewport(w, h);
        camera.reset();
        stars = createStarfield();
        const flight = new Flight({ seed: menu.seed, fx: flightFx(api) });
        menu.seed = null;
        return { score: 0, save: api.save, flight };
    },

    update(run, dt, input) {
        const f = run.flight;
        f.firing = input.down("primary") || input.down("secondary");
        if (input.pressed("target")) f.toggleTargeting();
        f.step(dt);
        camera.update(dt);
        stars.advance(FORWARD_SPEED * dt);
        run.score = f.score;

        if (f.status === "dead") return { status: "gameover" };
        if (f.status === "victory") {
            // The run goes on after the victory screen, so record the best now.
            run._newBest = run.save.maybeHighScore(f.score) || run._newBest;
            return { status: "screen", name: "victory" };
        }
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        if (camera.width() !== w || camera.height() !== h) camera.setViewport(w, h);
        drawFlight(ctx, camera, stars, run.flight);
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        const now = performance.now();
        tunnel.tick(tunnelLast ? now - tunnelLast : 16);
        tunnelLast = now;
        tunnel.draw(ctx, w, h);
    },

    hud(run) {
        const f = run && run.flight;
        const lock = document.getElementById("hud-lock");
        const radio = document.getElementById("hud-radio");
        lock.classList.toggle("active", !!(f && f.lockActive));
        radio.classList.toggle("active", !!(f && f.radioActive));
        if (f && f.radioActive) radio.textContent = f.radioText;
        if (!f) return { score: 0, wave: "1-1", shields: shieldBar(0) };
        // #hud-high is filled by the shell.
        return { score: f.score, wave: f.label, shields: shieldBar(f.shields) };
    },

    gameOverText(run) {
        const f = run.flight;
        return (
            "Score    " + f.score + (run._newBest ? "  ·  NEW BEST" : "") + "\n" +
            "Sector   " + f.label + "\n" +
            "Best     " + run.save.highScore()
        );
    },

    onEnterScreen(name, run, api) {
        const playing = name === "playing";
        document.body.classList.toggle("playing", playing);
        if (playing) lockPointer(api.view.canvas);
        else unlockPointer();
        // Shake only decays in play; a menu over a frozen shake would flicker.
        if (!playing && camera) camera.reset();
        if (name === "settings") options.render();
        if (name === "victory" && run) {
            const f = run.flight;
            document.getElementById("victory-stats").textContent =
                "CITADEL CAMPAIGN " + f.loop + " COMPLETE\n\n" +
                "SHIELD BONUS  +" + f.shieldBonus + "\n" +
                "SCORE   " + f.score + (run._newBest ? "  ·  NEW BEST" : "");
        }
    },

    onMenuAction(action, run) {
        if (action === "continue" && run) {
            run.flight.advanceLoop();
            return "playing";
        }
        if (options.handle(action)) return null;
        if (action === "settings") return "settings";
        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (CHORDS[name]) for (const t of CHORDS[name]) audio.tone(...t);
        else if (ARPEGGIOS[name]) audio.sequence(ARPEGGIOS[name]);
    },
};

// ── Sound ─────────────────────────────────────────────────────────────────

/** Tones that ring together. */
const CHORDS = {
    laser: [[1100, 0.07, "square", 0.35], [500, 0.1, "square", 0.25]],
    enemyLaser: [[700, 0.08, "square", 0.25], [350, 0.1, "square", 0.2]],
    enemyHit: [[260, 0.12, "sawtooth", 0.55], [140, 0.18, "sawtooth", 0.4]],
    enemyBoom: [[140, 0.2, "sawtooth", 0.7], [80, 0.28, "sawtooth", 0.55]],
    shieldHit: [[180, 0.22, "sawtooth", 0.5], [90, 0.18, "sawtooth", 0.45]],
    ace: [[520, 0.35, "sawtooth", 0.32], [320, 0.45, "sawtooth", 0.28]],
    lock: [[1400, 0.05, "square", 0.35]],
};

/** Tones played one after another. */
const ARPEGGIOS = {
    shipExplode: [[90, 0.25, "sawtooth", 0.8], [60, 0.3, "sawtooth", 0.7], [40, 0.4, "sawtooth", 0.5]],
    bullseye: [[523, 0.1, "square", 0.6], [659, 0.1, "square", 0.7], [784, 0.1, "square", 0.8], [1047, 0.3, "square", 0.9]],
    directHit: [[523, 0.1, "square", 0.6], [784, 0.22, "square", 0.8]],
    wave: [[330, 0.1, "triangle", 0.6], [440, 0.1, "triangle", 0.6], [554, 0.18, "triangle", 0.7]],
    bonusShield: [[659, 0.08, "triangle", 0.5], [880, 0.08, "triangle", 0.6], [1175, 0.16, "triangle", 0.7]],
};

// ── Wiring ────────────────────────────────────────────────────────────────

function flightFx(api) {
    return {
        cue: (name) => api.play(name),
        shake: (amount, ms) => camera.shake(amount, ms),
        flash: (color, ms) => camera.flash(color, ms),
        jitter: (px, ms) => camera.jitter(px, ms),
    };
}

/** Screen position -> yoke -1..1 around the centre, with a dead zone. */
export function toYoke(px, py, W, H) {
    const curve = (v) => {
        const a = Math.abs(v);
        if (a < YOKE_DEAD) return 0;
        return Math.sign(v) * Math.min(1, (a - YOKE_DEAD) / (1 - YOKE_DEAD));
    };
    return { x: curve((px - W * 0.5) / (W * 0.5)), y: -curve((py - H * 0.5) / (H * 0.5)) };
}

/** Pointer-locked: relative motion nudges the yoke. Otherwise: absolute. */
function aimYoke(run, view, p, e) {
    const f = run.flight;
    if (document.pointerLockElement === view.canvas) {
        f.steer(f.yoke.x + (e.movementX || 0) * YOKE_SENSITIVITY, f.yoke.y - (e.movementY || 0) * YOKE_SENSITIVITY);
        return;
    }
    const y = toYoke(p.x, p.y, view.width(), view.height());
    f.steer(y.x, y.y);
}

function lockPointer(canvas) {
    try { canvas.requestPointerLock(); } catch (e) { /* not available */ }
}

function unlockPointer() {
    try {
        if (document.pointerLockElement) document.exitPointerLock();
    } catch (e) { /* not available */ }
}
