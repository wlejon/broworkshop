// GridKeep — arcade plugin: a fixed iso stage over the sim's TileWorld,
// tower placement on the mouse, HUD chrome, sound. Rules live in sim.js,
// scene sync in render.js, DOM chrome in ui.js. The shell owns menus /
// pause / high score.

import { createStage } from "/lib/arcade/scene3d.js";
import { createEffects } from "/lib/arcade/effects.js";
import { createGame, CREEP_TYPES, MAP_W, MAP_H } from "/app/sim.js";
import { applyTints, flashCells, expireFlashes, syncObjects, disposeRun, TINT } from "/app/render.js";
import { TOWERS, fillPalette, refreshChrome, setGameOverTitle } from "/app/ui.js";

const REFUSE_TEXT = {
    blocks: "That would wall off the path!",
    gold: "Not enough gold",
    terrain: "Cannot build on that terrain",
    occupied: "A tower is already there",
    creep: "A creep is in the way",
};

const CAMERA_OFFSET = [14, 15, 14];

// Scene state lives for the app; `current` is the run the pointer drives.
let stage = null;
let shell = null;
let current = null;
const fx = createEffects();

export const game = {
    id: "gridkeep",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Confirm", defaults: ["Enter"] },
        { name: "wave", label: "Start Wave", defaults: [" "] },
        { name: "t1", label: "Arrow Tower", defaults: ["1"] },
        { name: "t2", label: "Cannon Tower", defaults: ["2"] },
        { name: "t3", label: "Frost Tower", defaults: ["3"] },
        { name: "upgrade", label: "Upgrade", defaults: ["u"] },
        { name: "sell", label: "Sell", defaults: ["x"] },
    ],

    create(ctx) {
        shell = ctx;
        ensureStage();
        if (current) disposeRun(current);
        fx.clear();
        const sim = createGame(stage.scene);
        const run = {
            score: 0,
            sim,
            placeType: null,
            selectedTower: null,
            hoverCell: null,
            hoverPlaceable: false,
            applied: new Map(),      // "x,y" -> tint currently on the world
            flashes: [],             // timed cell tints { cells, color, until }
            hpBars: new Map(),       // creep id -> billboard shape
            hurtT: 0,                // lives box flash, seconds left
            over: null,              // { won } once the sim ends
        };
        current = run;
        frameCamera(run);
        wireSim(run, ctx);
        return run;
    },

    update(run, dt, input) {
        current = run;
        const sim = run.sim;
        if (run.over) return { status: "gameover", result: Object.assign({ score: run.score }, run.over) };

        const dtSec = Math.min(0.05, Math.max(0, dt / 1000));
        sim.update(dtSec);
        sim.world.advance(dt);
        fx.update(dt);
        run.hurtT = Math.max(0, run.hurtT - dtSec);

        if (expireFlashes(run)) applyTints(run);
        if (run.selectedTower && !sim.towers.includes(run.selectedTower)) selectTower(run, null);

        if (input.pressed("wave")) sim.startNextWave();
        if (input.pressed("t1")) setPlaceType(run, "arrow");
        if (input.pressed("t2")) setPlaceType(run, "cannon");
        if (input.pressed("t3")) setPlaceType(run, "frost");
        if (input.pressed("upgrade")) upgradeSelected(run);
        if (input.pressed("sell")) sellSelected(run);

        syncObjects(run, stage.scene);
    },

    draw() {},

    hud(run) {
        if (!run) return { gold: "0", lives: "0", wave: "—" };
        const sim = run.sim;
        refreshChrome(run);
        return {
            gold: String(sim.gold),
            lives: String(sim.lives),
            wave: (sim.wave || "—") + " / " + sim.finalWave,
        };
    },

    gameOverText(run) {
        const sim = run.sim;
        const best = run._newBest ? "\nScore " + run.score + "  ·  NEW BEST" : "\nScore " + run.score;
        if (sim.won) {
            return "All " + sim.finalWave + " waves repelled\n" +
                sim.kills + " creeps slain · " + sim.lives + " lives left" + best;
        }
        return "Survived to wave " + sim.wave + "\n" + sim.kills + " creeps slain" + best;
    },

    onEnterScreen(name, run) {
        if (name === "gameover" && run) setGameOverTitle(run.sim.won);
    },

    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    wave: [[300, 0.12, "sawtooth", 0.4]],
    clear: [[720, 0.1, "triangle", 0.4]],
    leak: [[140, 0.15, "square", 0.45]],
    refuse: [[200, 0.06, "square", 0.35]],
    win: [[523, 0.1, "square", 0.5], [659, 0.1, "square", 0.55], [784, 0.18, "square", 0.6]],
    lose: [[220, 0.12, "sawtooth", 0.4], [160, 0.2, "sawtooth", 0.45]],
};

// ── Sim → HUD / sound ────────────────────────────────────────────────────

function wireSim(run, ctx) {
    const sim = run.sim;
    sim.onSplash = (x, y) => flashCells(run, sim.world.cellsInRange(x, y, 1, "vertex"), TINT.splash, 0.18);
    sim.onRefused = (r) => {
        flashCells(run, [{ x: r.x, y: r.y }], TINT.refused, 0.35);
        fx.toast("#toast", REFUSE_TEXT[r.reason] || "Cannot build there", 1800);
        ctx.play("refuse");
    };
    sim.onWaveStart = (n, def) => {
        const names = [...new Set(def.groups.map((g) => CREEP_TYPES[g.t].name))].join(" + ");
        fx.toast("#announce", "WAVE " + n + (n === sim.finalWave ? " — FINAL!" : "") + "  ·  " + names, 2400);
        ctx.play("wave");
    };
    sim.onWaveCleared = (n, bonus) => {
        if (n < sim.finalWave) fx.toast("#toast", "Wave " + n + " cleared  ·  +" + bonus + "g bonus", 1800);
        ctx.play("clear");
    };
    sim.onLeak = () => {
        run.hurtT = 0.5;
        ctx.play("leak");
    };
    sim.onGameOver = (won) => {
        run.over = { won };
        run.score = won ? 1000 + sim.lives * 50 + sim.kills : sim.kills * 10;
        run.placeType = null;
        run.selectedTower = null;
        applyTints(run);
        ctx.play(won ? "win" : "lose");
    };
}

// ── Stage + camera ───────────────────────────────────────────────────────

function ensureStage() {
    if (stage) return;
    stage = createStage({ iso: { offset: CAMERA_OFFSET, size: 12, near: 0.1, far: 200 } });
    const scene = stage.scene;
    scene.setToneMap({ mode: "aces", exposure: 0.98, gamma: 2.2 });
    scene.setAmbient([0.20, 0.21, 0.25]);
    scene.createLight({
        type: "directional",
        direction: [-0.55, -1.0, -0.30],
        color: [1.0, 0.96, 0.87],
        intensity: 2.05,
    });
    window.addEventListener("resize", () => { if (current) frameCamera(current); });
    fillPalette();
    wirePointer();
    wireButtons();
}

// Fit the whole map for the canvas aspect.
function frameCamera(run) {
    const b = run.sim.world.worldBounds();
    const rect = stage.canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const spanZ = b.maxZ - b.minZ;
    const diag = Math.hypot(b.maxX - b.minX, spanZ);
    stage.reframe([(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2],
        Math.max(spanZ * 0.78 + 2.0, (diag * 0.78 + 1.5) / aspect));
    stage.applyCamera();
}

/** The map cell under a client pixel, or null. */
function cellAt(clientX, clientY) {
    const ray = stage.rayAt(clientX, clientY);
    if (!ray || !current) return null;
    const hit = current.sim.world.raycastCell(ray.origin, ray.dir, 500);
    return hit ? { x: hit.x, y: hit.y } : null;
}

/** Client pixel of a cell's top centre (tests click through this). */
function cellScreen(x, y) {
    const world = current.sim.world;
    const c = world.cellCenterWorldXZ(x, y);
    const top = world.sampleHeight(c.x, c.z);
    return stage.toScreen(c.x, top === null ? 0 : top, c.z);
}

// ── Tools ────────────────────────────────────────────────────────────────

function setPlaceType(run, type) {
    run.placeType = run.placeType === type ? null : type;
    run.selectedTower = null;
    refreshHover(run, run.hoverCell, true);
}

function selectTower(run, t) {
    run.selectedTower = t;
    if (t) run.placeType = null;
    applyTints(run);
}

function upgradeSelected(run) {
    if (run.selectedTower) run.sim.upgradeTower(run.selectedTower);
}

function sellSelected(run) {
    if (!run.selectedTower) return;
    run.sim.sellTower(run.selectedTower);
    selectTower(run, null);
}

function refreshHover(run, cell, force) {
    const h = run.hoverCell;
    const same = cell && h ? cell.x === h.x && cell.y === h.y : cell === h;
    if (same && !force) return;
    run.hoverCell = cell && cell.x >= 0 && cell.y >= 0 && cell.x < MAP_W && cell.y < MAP_H ? cell : null;
    if (run.hoverCell && run.placeType)
        run.hoverPlaceable = run.sim.canPlace(run.placeType, run.hoverCell.x, run.hoverCell.y).ok;
    applyTints(run);
}

// A click selects a tower (or deselects it), places the armed tower, or
// clears the selection.
function actOnCell(run, x, y) {
    if (run.sim.over) return;
    const t = run.sim.towerAt(x, y);
    if (t) { selectTower(run, run.selectedTower === t ? null : t); return; }
    if (run.placeType) {
        if (run.sim.placeTower(run.placeType, x, y)) refreshHover(run, { x, y }, true);
        return;
    }
    if (run.selectedTower) selectTower(run, null);
}

// ── Input wiring (once per app) ──────────────────────────────────────────

const playing = () => current && shell && shell.getScreen() === "playing";

function wirePointer() {
    const canvas = stage.canvas;
    canvas.addEventListener("mousemove", (e) => {
        if (playing()) refreshHover(current, cellAt(e.clientX, e.clientY), false);
    });
    canvas.addEventListener("mousedown", (e) => {
        if (!playing()) return;
        if (e.button === 2) {
            current.placeType = null;
            selectTower(current, null);
            return;
        }
        if (e.button !== 0) return;
        const c = cellAt(e.clientX, e.clientY);
        if (c) actOnCell(current, c.x, c.y);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

function wireButtons() {
    const on = (id, fn) => document.getElementById(id).addEventListener("click", () => { if (playing()) fn(current); });
    for (const type of TOWERS) on("btn-" + type, (run) => setPlaceType(run, type));
    on("btn-wave", (run) => run.sim.startNextWave());
    on("btn-upgrade", upgradeSelected);
    on("btn-sell", sellSelected);
}

// ── Test surface (hooks.js) ──────────────────────────────────────────────

export const internals = {
    get stage() { return stage; },
    get run() { return current; },
    cellScreen,
    cellAt,
    actOnCell: (x, y) => actOnCell(current, x, y),
    setPlaceType: (t) => setPlaceType(current, t),
};
