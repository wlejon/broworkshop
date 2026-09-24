// BlastGrid — arcade plugin: a fixed perspective stage over the match's
// TileWorld, keyboard movement + bombs, HUD chips, round screens, sound.
// Match rules live in sim.js (tuning in rules.js, rivals in ai.js), scene
// sync in render.js, DOM chrome in ui.js. The shell owns menus / pause /
// high score (your round wins in the match).

import { createStage } from "/lib/arcade/scene3d.js";
import { createEffects } from "/lib/arcade/effects.js";
import { formatClock } from "/lib/arcade/grid.js";
import { createGame, WINS_TARGET, speedLevel } from "/app/sim.js";
import { registerKinds, applyTints, syncObjects, flashAt } from "/app/render.js";
import { buildChips, refreshChips, fillRoundScreen, matchSummary } from "/app/ui.js";

const DIRECTIONS = ["up", "down", "left", "right"];
const PICKUP_TEXT = { bombs: "+1 BOMB", range: "+1 RANGE", speed: "+SPEED" };

// Camera: 42° perspective pitched 58° down over the arena centre.
const FOV = 42;
const PITCH = 58 * Math.PI / 180;

// Scene state lives for the app; `current` is the running match.
let stage = null;
let flash = null;
let current = null;
const fx = createEffects();

export const game = {
    id: "blastgrid",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Drop Bomb", defaults: [" "] },
    ],

    create(ctx) {
        ensureStage();
        if (current) current.sim.world.destroy();
        fx.clear();
        const sim = createGame(stage.scene);
        const run = {
            score: 0,
            play: ctx.play,
            sim,
            kinds: registerKinds(sim.world),
            applied: new Map(),      // "x,y" -> tint currently on the world
            held: { up: false, down: false, left: false, right: false },
            flashT: 0,
        };
        current = run;
        wireSim(run);
        buildChips(sim);
        frameCamera(run);
        return run;
    },

    update(run, dt, input) {
        const sim = run.sim;
        const dtSec = dt / 1000;

        // Held directions feed the sim's latest-pressed-wins steering.
        for (const d of DIRECTIONS) {
            const now = input.down(d);
            if (now && !run.held[d]) sim.pressDir(d);
            if (!now && run.held[d]) sim.releaseDir(d);
            run.held[d] = now;
        }
        if (input.pressed("primary") && sim.dropBomb()) run.play("bomb");

        sim.update(dtSec);
        fx.update(dt);
        applyTints(run);
        syncObjects(run, flash, dtSec);
        run.score = sim.human.wins;

        if (sim.state === "roundover") {
            run.play("round");
            return { status: "screen", name: "roundover" };
        }
        if (sim.state === "matchover") {
            run.play(sim.winner === sim.human ? "win" : "lose");
            return { status: "gameover" };
        }
    },

    draw() {
        stage.applyCamera();
    },

    hud(run) {
        if (!run) return { timer: "—", round: "—", powers: "—" };
        const sim = run.sim, h = sim.human;
        refreshChips(sim);
        const timer = document.getElementById("hud-timer");
        timer.className = sim.sd.active ? "sudden" : sim.timeLeft <= 30 ? "low" : "";
        return {
            timer: sim.sd.active ? "SUDDEN DEATH" : formatClock(sim.timeLeft * 1000, true),
            round: "ROUND " + sim.round + " · FIRST TO " + WINS_TARGET,
            powers: "BOMBS " + h.bombCap + " · RANGE " + h.range + " · SPEED " + speedLevel(h.speed),
        };
    },

    gameOverText(run) {
        return matchSummary(run.sim, run._newBest);
    },

    onEnterScreen(name, run) {
        if (name === "roundover" && run) fillRoundScreen(run.sim);
    },

    onMenuAction(action, run) {
        if (action !== "continue" || !run) return null;
        // Into the next round: let go of any direction held over the banner.
        for (const d of DIRECTIONS) {
            if (run.held[d]) run.sim.releaseDir(d);
            run.held[d] = false;
        }
        run.sim.proceed();
        run.applied.clear();
        return "playing";
    },

    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    bomb: [[180, 0.05, "square", 0.35]],
    round: [[523, 0.08, "square", 0.45], [659, 0.12, "square", 0.5]],
    win: [[523, 0.09, "square", 0.55], [659, 0.09, "square", 0.6], [784, 0.1, "square", 0.65], [1047, 0.22, "square", 0.7]],
    lose: [[220, 0.12, "sawtooth", 0.45], [160, 0.2, "sawtooth", 0.5]],
};

// ── Sim → FX / HUD ───────────────────────────────────────────────────────

function wireSim(run) {
    const sim = run.sim;
    sim.onBlast = (blast) => flashAt(run, flash, blast.centers[0]);
    sim.onArenaReset = () => run.applied.clear();
    sim.onSuddenDeath = () => fx.toast("#announce", "SUDDEN DEATH — THE WALLS CLOSE IN", 2400);
    sim.onPickup = (e, type) => {
        if (e === sim.human) fx.toast("#toast", PICKUP_TEXT[type], 1200);
    };
}

// ── Stage + camera ───────────────────────────────────────────────────────

function ensureStage() {
    if (stage) return;
    const s = Math.sin(-PITCH / 2), c = Math.cos(-PITCH / 2);
    stage = createStage({
        orbit: { fov: FOV, near: 0.1, far: 200, rot: [s, 0, 0, c] },
        controls: false,
    });
    const scene = stage.scene;
    scene.setToneMap({ mode: "aces", exposure: 1.0, gamma: 2.2 });
    scene.setAmbient([0.22, 0.23, 0.27]);
    scene.createLight({
        type: "directional",
        direction: [-0.45, -1.0, -0.35],
        color: [1.0, 0.96, 0.88],
        intensity: 2.0,
    });
    flash = scene.createLight({
        type: "point", position: [0, 1.4, 0],
        color: [1.0, 0.72, 0.38], intensity: 0, range: 7,
    });
    window.addEventListener("resize", () => { if (current) frameCamera(current); });
}

// Back the camera off until the whole arena fits the canvas aspect.
function frameCamera(run) {
    const b = run.sim.world.worldBounds();
    const rect = stage.canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const half = Math.tan(FOV * Math.PI / 360);
    const distV = ((b.maxZ - b.minZ) * 0.60 + 1.8) / half;
    const distH = ((b.maxX - b.minX) * 0.54 + 1.2) / (half * aspect);
    stage.reframe([(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2 - 0.4], Math.max(distV, distH));
    stage.applyCamera();
}

// ── Test surface (hooks.js) ──────────────────────────────────────────────

export const internals = {
    get stage() { return stage; },
    get run() { return current; },
};
