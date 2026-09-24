// TileHaven — arcade plugin: an iso stage over the sim's TileWorld, build
// tools on the mouse, keyboard pan, HUD. Rules live in sim.js, scene sync in
// render.js, DOM chrome in ui.js. The shell owns menus / pause / high score.

import { createStage } from "/lib/arcade/scene3d.js";
import { createGame, GOAL } from "/app/sim.js";
import { applyTints, syncObjects, tintSignature } from "/app/render.js";
import {
    TOOLS, fillPaletteCosts, refreshPalette, refreshInfoPanel, goalText, citySummary, toast,
} from "/app/ui.js";

const REFUSE_TEXT = {
    coins: "Not enough coins",
    wood: "Not enough wood",
    terrain: "Cannot build on that terrain",
    occupied: "That spot is taken",
    building: "A building is in the way",
    road: "Cannot build on a road",
    forest: "Lumber camps must sit beside a forest",
    ore: "Mines must be built on an ore hill",
    depot: "The depot cannot be demolished",
    bounds: "Out of bounds",
};

// Iso camera: a fixed diagonal offset from a pannable target; the wheel
// zooms the view height.
const CAMERA_OFFSET = [14, 16, 14];
const ZOOM = { step: 0.06, min: 0.45, max: 1.6 };
const PAN_SPEED = 9;                 // world units / s at zoom 1
const PAN_LIMIT = { x: 14, z: 10 };  // how far the target may leave the board centre
const SQ = Math.SQRT1_2;

// Scene state lives for the app; `current` is the run the pointer drives.
let stage = null;
let shell = null;
let current = null;

export const game = {
    id: "tilehaven",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Confirm", defaults: ["Enter"] },
        ...TOOLS.map((t) => ({ name: "tool_" + t, label: toolLabel(t), defaults: [toolKey(t)] })),
        { name: "save", label: "Save", defaults: ["F5"] },
        { name: "load", label: "Load", defaults: ["F9"] },
    ],

    create(ctx) {
        shell = ctx;
        ensureStage();
        const sim = createGame(stage.scene);
        const run = {
            score: 0,
            sim,
            tool: null,
            selected: null,
            hoverCell: null,
            painting: false,
            applied: new Map(),          // "x,y" -> tint currently on the world
            pan: { x: 0, z: 0 },
            tintSig: "",
            victoryPending: false,
        };
        current = run;
        stage.iso.zoom = 1;
        frameCamera(run);

        sim.onRefused = (r) => {
            toast(REFUSE_TEXT[r.reason] || "Cannot do that");
            ctx.play("refuse");
        };
        sim.onVictory = () => {
            run.victoryPending = true;
            ctx.play("win");
        };
        return run;
    },

    update(run, dt, input) {
        current = run;
        const sim = run.sim;
        if (run.victoryPending && !sim.sandbox) {
            run.victoryPending = false;
            return { status: "screen", name: "victory" };
        }

        const dtSec = Math.min(0.05, Math.max(0, dt / 1000));
        sim.update(dtSec);
        sim.world.advance(dt);
        panCamera(run, input, dtSec);

        for (const t of TOOLS) if (input.pressed("tool_" + t)) setTool(run, t);
        if (input.pressed("save")) saveCity(run);
        if (input.pressed("load")) loadCity(run);

        const sig = tintSignature(run);
        if (sig !== run.tintSig) {
            run.tintSig = sig;
            applyTints(run);
        }
        syncObjects(sim);
        run.score = sim.pop * 10 + sim.coins;
    },

    draw() {},

    hud(run) {
        if (!run) return { coins: 0, pop: 0, food: 0, wood: 0, ore: 0, carts: 0, goal: "GOAL" };
        const sim = run.sim;
        refreshPalette(run);
        refreshInfoPanel(run);
        return {
            coins: sim.coins, pop: sim.pop, food: sim.food, wood: sim.wood, ore: sim.ore,
            carts: sim.carts.length,
            goal: goalText(sim, GOAL),
        };
    },

    gameOverText(run) {
        return run ? citySummary(run.sim, "\n") : "";
    },

    onMenuAction(action, run) {
        if (action === "continue" && run) {
            run.sim.sandbox = true;
            return "playing";
        }
        return null;
    },

    onEnterScreen(name, run) {
        if (name === "victory" && run) {
            document.getElementById("victory-stats").textContent = citySummary(run.sim, " · ");
        }
    },

    cue(name, audio) {
        if (name === "refuse") audio.tone(200, 0.06, "square", 0.35);
        else if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.5],
                [659, 0.1, "square", 0.55],
                [784, 0.18, "square", 0.6],
            ]);
        }
    },
};

function toolLabel(t) {
    return t === "dozer" ? "Bulldoze" : t[0].toUpperCase() + t.slice(1);
}

function toolKey(t) {
    return { road: "r", house: "h", farm: "f", lumber: "l", mine: "m", market: "k", dozer: "b" }[t];
}

// ── Stage + camera ───────────────────────────────────────────────────────

function ensureStage() {
    if (stage) return;
    stage = createStage({
        iso: { offset: CAMERA_OFFSET, size: 12, near: 0.1, far: 200, wheel: ZOOM },
    });
    const scene = stage.scene;
    scene.setToneMap({ mode: "aces", exposure: 0.98, gamma: 2.2 });
    scene.setAmbient([0.21, 0.22, 0.26]);
    scene.createLight({
        type: "directional",
        direction: [-0.55, -1.0, -0.30],
        color: [1.0, 0.96, 0.87],
        intensity: 2.0,
    });
    window.addEventListener("resize", () => { if (current) frameCamera(current); });
    wirePointer();
    wireButtons();
    fillPaletteCosts();
}

// Fit the whole board in view at zoom 1 for the canvas aspect.
function frameCamera(run) {
    const b = run.sim.world.worldBounds();
    run.center = [(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2];
    const rect = stage.canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const spanZ = b.maxZ - b.minZ;
    const diag = Math.hypot(b.maxX - b.minX, spanZ);
    stage.iso.size = Math.max(spanZ * 0.72 + 2.0, (diag * 0.72 + 1.5) / aspect);
    aimCamera(run);
}

function aimCamera(run) {
    stage.iso.target = [run.center[0] + run.pan.x, 0, run.center[2] + run.pan.z];
    stage.applyCamera();
}

// Arrows / WASD pan along the screen axes of the diagonal view.
function panCamera(run, input, dt) {
    const s = PAN_SPEED * dt * stage.iso.zoom;
    let dx = 0, dz = 0;
    if (input.down("right")) { dx += SQ * s; dz -= SQ * s; }
    if (input.down("left")) { dx -= SQ * s; dz += SQ * s; }
    if (input.down("up")) { dx -= SQ * s; dz -= SQ * s; }
    if (input.down("down")) { dx += SQ * s; dz += SQ * s; }
    if (!dx && !dz) return;
    run.pan.x = Math.max(-PAN_LIMIT.x, Math.min(PAN_LIMIT.x, run.pan.x + dx));
    run.pan.z = Math.max(-PAN_LIMIT.z, Math.min(PAN_LIMIT.z, run.pan.z + dz));
    aimCamera(run);
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

function setTool(run, t) {
    run.tool = run.tool === t ? null : t;
    run.selected = null;
    applyTints(run);
}

function actOnCell(run, x, y) {
    const sim = run.sim;
    if (run.tool === "road") {
        if (sim.paintRoad(x, y)) sim.world.rebuild();
    } else if (run.tool === "dozer") {
        const r = sim.bulldoze(x, y);
        if (r.ok) {
            sim.world.rebuild();
            if (r.what === "building") toast("Demolished (+" + r.refund + " coins)");
        } else if (r.reason === "depot") {
            sim.onRefused({ reason: "depot" });
        }
    } else if (run.tool) {
        if (sim.placeBuilding(run.tool, x, y)) sim.world.rebuild();
    } else {
        const b = sim.buildingAt(x, y);
        run.selected = b && b !== run.selected ? b : null;
        applyTints(run);
    }
}

function saveCity(run) {
    if (run.sim.saveCity()) toast("City saved");
}

function loadCity(run) {
    const sim = run.sim;
    if (!sim.hasSave()) { toast("No saved city"); return; }
    if (!sim.loadCity()) { toast("Save file is corrupt"); return; }
    run.selected = null;
    run.tool = null;
    run.applied.clear();
    applyTints(run);
    sim.world.rebuild();
    toast("City loaded");
}

// ── Input wiring (once per app) ──────────────────────────────────────────

const playing = () => current && shell && shell.getScreen() === "playing";
const drags = (run) => run.tool === "road" || run.tool === "dozer";

function wirePointer() {
    const canvas = stage.canvas;
    canvas.addEventListener("mousedown", (e) => {
        if (!playing()) return;
        if (e.button === 2) { setTool(current, null); return; }
        if (e.button !== 0) return;
        const c = cellAt(e.clientX, e.clientY);
        if (!c) return;
        actOnCell(current, c.x, c.y);
        if (drags(current)) current.painting = true;
    });
    canvas.addEventListener("mouseup", () => { if (current) current.painting = false; });
    canvas.addEventListener("mousemove", (e) => {
        if (!playing()) return;
        const run = current;
        const c = cellAt(e.clientX, e.clientY);
        const h = run.hoverCell;
        const changed = c ? !h || h.x !== c.x || h.y !== c.y : !!h;
        run.hoverCell = c;
        if (!changed) return;
        if (c && run.painting && drags(run)) actOnCell(run, c.x, c.y);
        applyTints(run);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

function wireButtons() {
    for (const t of TOOLS) {
        document.getElementById("btn-" + t).addEventListener("click", () => {
            if (current) setTool(current, t);
        });
    }
    document.getElementById("btn-save").addEventListener("click", () => { if (current) saveCity(current); });
    document.getElementById("btn-load").addEventListener("click", () => { if (current) loadCity(current); });
}

// ── Test surface (hooks.js) ──────────────────────────────────────────────

export const internals = {
    get stage() { return stage; },
    get run() { return current; },
    cellScreen,
    cellAt,
    actOnCell: (x, y) => actOnCell(current, x, y),
    setTool: (t) => setTool(current, t),
    applyTints: () => applyTints(current),
};
