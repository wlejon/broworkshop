// Tumble — 3D marble-run puzzle on the arcade shell; the arcade README's
// reference scene game. Build a path under a piece budget, drop marbles
// from the gold spout, beat par into the green cup. Eight-level campaign.
//
// The shell owns menus, pause, the session and the frame loop; the scene
// lives on #view through lib/arcade/scene3d.js (built lazily in create()).
//
//   game.js      this plugin: session, input, level flow
//   board.js     playfield: environment, grid, budget, placement
//   marbles.js   run phase: spawn, piece kicks, win / fail
//   aids.js      build guides in the scene (layer, cursor, solution pads)
//   ui.js        HUD, palette, coach tips, screens
//   pieces.js    piece geometry + physics    levels.js  the campaign
//   progress.js  save: best times, unlocks   solutions.js verified layouts
//   hooks.js     window.__tumble for headless tests

import { createStage } from "/lib/arcade/scene3d.js";
import { LEVELS, fmt } from "/app/levels.js";
import { PIECES } from "/app/pieces.js";
import { SOLUTIONS } from "/app/solutions.js";
import * as board from "/app/board.js";
import * as marbles from "/app/marbles.js";
import * as progress from "/app/progress.js";
import * as ui from "/app/ui.js";
import { createAids } from "/app/aids.js";

let stage = null;       // scene + orbit camera, built on the first create()
let shellApi = null;    // shell api (getScreen), captured in create()
let current = null;     // live run, for pointer handlers and test hooks
let nextLevel = null;   // one-shot level index for the next create()

export const game = {
    id: "tumble",
    clearColor: "#05060a",

    actions: [
        { name: "primary", label: "Run / Reset", defaults: [" "] },
        { name: "secondary", label: "Rotate Piece", defaults: ["r"] },
        { name: "layer_up", label: "Layer Up", defaults: ["e"] },
        { name: "layer_down", label: "Layer Down", defaults: ["q"] },
        { name: "p1", label: "Piece 1", defaults: ["1"] },
        { name: "p2", label: "Piece 2", defaults: ["2"] },
        { name: "p3", label: "Piece 3", defaults: ["3"] },
        { name: "p4", label: "Piece 4", defaults: ["4"] },
        { name: "p5", label: "Piece 5", defaults: ["5"] },
        { name: "p6", label: "Piece 6", defaults: ["6"] },
        { name: "p7", label: "Piece 7", defaults: ["7"] },
    ],

    defaults: progress.PROGRESS_DEFAULTS,

    create(ctx) {
        shellApi = ctx;
        ensureStage();
        const idx = progress.clampLevel(nextLevel != null ? nextLevel : progress.lastLevel(ctx.save));
        nextLevel = null;
        const run = {
            play: ctx.play,
            save: ctx.save,
            scene: stage.scene,
            score: 0,          // shell high score: inverted clear time
            mode: "build",
            build: { selected: "block", rot: 0, layer: 0 },
            coachStep: 0,
            newBest: false,
            pending: null,     // "complete" → show the complete screen next update
        };
        current = run;
        loadLevel(run, idx);
        return run;
    },

    update(run, dt, input) {
        if (!run.pending) {
            handleKeys(run, input);
            const result = marbles.stepRun(run, dt);
            if (result === "complete") completeLevel(run);
            else if (result === "fail") failRun(run);
        }
        if (run.pending) {
            const name = run.pending;
            run.pending = null;
            return { status: "screen", name };
        }
        syncView(run);
    },

    draw() {
        if (stage) stage.applyCamera();
    },

    hud(run) {
        if (!run || !run.level) {
            return { level: "—", mode: "BUILD", timer: "—", par: "—", best: "—", marbles: "0", budget: "0 / 0", tagline: "" };
        }
        const level = run.level;
        const t = board.budgetTotals(run);
        const running = run.mode === "run";
        return {
            level: "Level " + (run.levelIdx + 1) + " — " + level.name,
            mode: running ? "RUNNING" : "BUILD",
            timer: running ? ((run.resultMs != null ? run.resultMs : run.runtime) / 1000).toFixed(2) + "s" : "ready",
            par: "gold " + fmt(level.par.gold) + " · bronze " + fmt(level.par.bronze),
            best: fmt(progress.bestTimes(run.save)[level.id]),
            marbles: run.marblesSpawned + "/" + level.maxMarbles +
                (run.marblesRemoved ? "  (" + run.marblesRemoved + " cleared)" : ""),
            budget: t.used + " / " + t.limit,
            tagline: level.tagline || "",
        };
    },

    // Tumble never ends a run in game over; the shell still requires the screen.
    gameOverText(run) {
        if (!run || !run.level) return "";
        return run.level.name + "\nTime: " + fmt(run.resultMs != null ? run.resultMs / 1000 : null);
    },

    onEnterScreen(name, run, api) {
        if (name === "title") ui.fillTitle(api.save);
        else if (name === "levels") ui.renderLevels(api.save);
        else if (name === "complete" && run) ui.fillComplete(run);
    },

    onMenuAction(action, run, api) {
        if (action === "levels") return "levels";
        if (action === "retry") return { startRun: true };
        if (action === "next" && run) {
            if (run.levelIdx >= LEVELS.length - 1) return "title";
            nextLevel = run.levelIdx + 1;
            return { startRun: true };
        }
        if (action === "resetprogress") {
            progress.resetProgress(api.save);
            ui.fillTitle(api.save);
            ui.toast("Progress reset.");
            return null;
        }
        if (action.indexOf("level-") === 0) {
            const i = parseInt(action.slice(6), 10);
            if (i >= 0 && i < progress.unlockedCount(api.save)) {
                nextLevel = i;
                return { startRun: true };
            }
        }
        return null;
    },

    // Game SFX; "tick" / "pick" are build feedback. Menu tones are the shell's.
    cue(name, audio) {
        if (name === "tick") audio.tone(440, 0.03, "sine", 0.3);
        else if (name === "pick") audio.tone(620, 0.06, "square", 0.35);
        else if (name === "place") audio.tone(540, 0.04, "triangle", 0.3);
        else if (name === "remove") audio.tone(200, 0.06, "square", 0.3);
        else if (name === "drop") audio.tone(320, 0.04, "sine", 0.25);
        else if (name === "clink") audio.tone(880, 0.03, "triangle", 0.18);
        else if (name === "goal") {
            audio.sequence([
                [523, 0.09, "square", 0.55],
                [659, 0.09, "square", 0.6],
                [784, 0.1, "square", 0.65],
                [1047, 0.18, "square", 0.7],
                [1319, 0.28, "triangle", 0.55],
            ]);
        } else if (name === "fail") {
            audio.sequence([
                [220, 0.12, "sawtooth", 0.45],
                [160, 0.2, "sawtooth", 0.5],
            ]);
        }
    },
};

// ── Level flow ──────────────────────────────────────────────────────────

function loadLevel(run, idx) {
    board.resetBoard(run, idx);
    const sol = SOLUTIONS[idx];
    run.aids = createAids(run.scene, run.level, sol ? sol.pieces : []);
    run.aids.setLayer(run.build.layer);
    const f = board.framing(run.level);
    stage.reframe(f.pivot, f.dist);
    hoverRay = null;
    run.save.set("lastLevel", idx);
    run.save.save();
    marbles.enterBuild(run);
    ui.beginCoach(run);
    ui.renderPalette(run);
    syncView(run);
    if (run.level.tagline) ui.toast(run.level.tagline, 1800);
}

function completeLevel(run) {
    const r = progress.recordClear(run.save, run.levelIdx, run.resultMs / 1000);
    run.newBest = r.newBest;
    run.score = r.score;
    board.pulseGoal(run);
    run.play("goal");
    marbles.freeze(run);
    run.pending = "complete";
}

function failRun(run) {
    run.play("fail");
    ui.toast("No marbles reached the cup. Rebuild and try again.");
    marbles.enterBuild(run);
}

function toggleMode(run) {
    if (run.mode === "build") {
        marbles.enterRun(run);
        run.play("drop");
        ui.advanceCoach(run, "run");
    } else if (run.mode === "run") {
        marbles.enterBuild(run);
    }
}

/** Scene guides + DOM state that follow the mode. */
function syncView(run) {
    run.aids.showBuild(run.mode === "build", run.placed.size === 0);
    refreshHover(run);
    ui.syncHud(run);
}

// ── Build actions (shared by input and test hooks) ──────────────────────

function place(run, type, cx, cy, cz, rot) {
    if (!board.placePiece(run, type, cx, cy, cz, rot)) return false;
    run.play("place");
    ui.renderPalette(run);
    ui.advanceCoach(run, "place", board.budgetTotals(run).used);
    return true;
}

function remove(run, key) {
    if (!board.removePiece(run, key)) return false;
    run.play("remove");
    ui.renderPalette(run);
    return true;
}

function select(run, type) {
    const b = run.budget[type];
    if (!b || b.limit <= 0) return false;
    run.build.selected = type;
    run.play("pick");
    ui.renderPalette(run);
    return true;
}

function rotate(run) {
    const def = PIECES[run.build.selected];
    if (!def || !def.rotatable) return false;
    run.build.rot = (run.build.rot + 1) & 3;
    run.play("tick");
    return true;
}

function setLayer(run, y) {
    const b = run.level.bounds.y;
    run.build.layer = Math.max(b[0], Math.min(b[1], y | 0));
    run.aids.setLayer(run.build.layer);
}

function handleKeys(run, input) {
    const avail = board.availablePieces(run);
    for (let i = 1; i <= 7; i++) {
        if (input.pressed("p" + i) && i <= avail.length) select(run, avail[i - 1]);
    }
    if (input.pressed("secondary")) rotate(run);
    if (run.mode === "build") {
        if (input.pressed("layer_down")) { setLayer(run, run.build.layer - 1); run.play("tick"); }
        if (input.pressed("layer_up")) { setLayer(run, run.build.layer + 1); run.play("tick"); }
    }
    if (input.pressed("primary")) toggleMode(run);
}

// ── Pointer ─────────────────────────────────────────────────────────────

// World ray under the cursor, taken in pointer events only; the frame loop
// intersects it with the build layer (so a layer change re-aims the cursor
// cell without a new ray). Dropped whenever the camera moves.
let hoverRay = null;

function ensureStage() {
    if (stage) return;
    stage = createStage({
        orbit: { target: [0, 3, 0], dist: 12, fov: 50, near: 0.1, far: 400 },
        controls: { minDist: 4, maxDist: 60 },
    });
    stage.onTap((p) => { if (building()) clickCell(current, p); });
    stage.onTap((p) => { if (building()) removeAt(current, p); }, { button: 2 });
    const setHover = (ray) => {
        hoverRay = ray;
        if (current && current.aids) refreshHover(current);
    };
    stage.canvas.addEventListener("mousemove", (e) => {
        setHover(stage.controls.dragging ? null : stage.rayAt(e.clientX, e.clientY));
    });
    stage.canvas.addEventListener("mouseleave", () => setHover(null));
    stage.canvas.addEventListener("wheel", () => setHover(null));
    const palette = document.getElementById("hud-palette");
    palette.addEventListener("click", (e) => {
        let el = e.target;
        while (el && el !== palette && !el.getAttribute("data-piece")) el = el.parentNode;
        if (el && el !== palette && current) select(current, el.getAttribute("data-piece"));
    });
}

function building() {
    return current && current.mode === "build" && shellApi && shellApi.getScreen() === "playing";
}

/** Cell on the active build layer under a client pixel, or null. */
function cellAt(run, clientX, clientY) {
    const hit = stage.planeHit(stage.rayAt(clientX, clientY), run.build.layer + 0.08);
    return hit ? { cx: Math.floor(hit.x), cy: run.build.layer, cz: Math.floor(hit.z) } : null;
}

function clickCell(run, p) {
    const c = cellAt(run, p.clientX, p.clientY);
    if (!c) { ui.toast("Aim at the blue floor grid, then click."); return; }
    const why = board.placeBlocker(run, run.build.selected, c.cx, c.cy, c.cz);
    if (why === "budget") ui.toast("Out of that piece — pick another on the left.");
    else if (why) ui.toast("That cell is blocked — try a green-highlighted cell.");
    else place(run, run.build.selected, c.cx, c.cy, c.cz, run.build.rot);
}

/** Right-click: the piece under the cursor, else the piece in the hovered cell. */
function removeAt(run, p) {
    const hit = stage.pick(p.clientX, p.clientY, 200);
    const key = hit && hit.node ? run.meshToCell.get(hit.node.id) : null;
    if (key && remove(run, key)) return;
    const c = cellAt(run, p.clientX, p.clientY);
    if (c) remove(run, board.cellKey(c.cx, c.cy, c.cz));
}

/** Cursor highlight + ghost for the build-layer cell under the hover ray. */
function refreshHover(run) {
    if (run.mode !== "build") return;
    const hit = stage.planeHit(hoverRay, run.build.layer + 0.08);
    if (!hit) { run.aids.hideCursor(); return; }
    const c = { cx: Math.floor(hit.x), cy: run.build.layer, cz: Math.floor(hit.z) };
    const valid = !board.placeBlocker(run, run.build.selected, c.cx, c.cy, c.cz);
    run.aids.hover(c.cx, c.cy, c.cz, valid, run.build.selected);
}

// ── Test surface ────────────────────────────────────────────────────────

/** Internals for hooks.js (window.__tumble); not used by the game itself. */
export const internals = {
    get run() { return current; },
    get stage() { return stage; },
    startLevel(shell, idx) { nextLevel = idx | 0; shell.startRun(); return current; },
    place, remove, select, rotate, setLayer, completeLevel,
    /** Build-layer cell under a client pixel, plus whether the selected piece fits. */
    cellAt(run, clientX, clientY) {
        const c = cellAt(run, clientX, clientY);
        return c && Object.assign(c, { free: !board.placeBlocker(run, run.build.selected, c.cx, c.cy, c.cz) });
    },
    enterRun(run) { if (run.mode !== "run") toggleMode(run); },
    enterBuild(run) { marbles.enterBuild(run); },
};
