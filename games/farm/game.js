// Farm — a 3D farm run by talking NPC workers and their Foreman, on the
// arcade shell. The farm is built once and Play continues it: the shell owns
// menus, pause and the loop; this plugin steps the farm, renders it and
// wires the HUD and click-to-inspect.
//
//   farm.js       the running farm (world + player + tasks + Foreman + voices)
//   world.js      the simulation model   speech.js  per-speaker speech channels
//   tasks.js      NPC task executor      orchestrator.js / stations.js  the Foreman
//   knowledge.js  beliefs + word of mouth  env.js / market.js  weather, prices
//   player.js     the farmer avatar      voice.js   Kokoro voices, spatial
//   render3d.js   the scene              hud.js / inspect.js  DOM panels
//   hooks.js      window.__farm for headless tests

import { createStage } from "/lib/arcade/scene3d.js";
import { createFarm } from "/app/farm.js";
import { createRenderer, fitBoard, CAMERA_OFFSET } from "/app/render3d.js";
import { renderHud, clockText } from "/app/hud.js";
import { createInspector } from "/app/inspect.js";

const HUD_REFRESH_MS = 250;
const HUD_DOCK_PX = 270;        // #hud width in theme.css: the board frames left of it
const PENS = ["coop", "meadow", "pasture"];

let stage = null;       // scene + iso camera, built on the first create()
let farm = null;        // the farm: built once, Play continues it
let renderer = null;
let inspector = null;
let shellApi = null;
let current = null;     // live run, for pointer handlers and test hooks
let framedFor = "";     // canvas/dock size the camera was last fitted to
const options = { voices: true };   // set before the first Play (hooks.js)

export const game = {
    id: "farm",
    clearColor: "#10160f",

    actions: [
        { name: "primary", label: "Interact", defaults: ["e", " "] },
        { name: "market", label: "Buy Feed", defaults: ["m"] },
        { name: "debug_feed", label: "Debug: Fill Feed Troughs", defaults: ["1"] },
        { name: "debug_water", label: "Debug: Fill Water Troughs", defaults: ["2"] },
        { name: "debug_crops", label: "Debug: Water Crops", defaults: ["3"] },
        { name: "debug_harvest", label: "Debug: Harvest + Collect", defaults: ["4"] },
        { name: "debug_plant", label: "Debug: Plant", defaults: ["5"] },
        { name: "debug_resupply", label: "Debug: Resupply", defaults: ["6"] },
        { name: "debug_observe", label: "Debug: Log observe()", defaults: ["o"] },
    ],

    create(ctx) {
        shellApi = ctx;
        ensureFarm(ctx);
        const run = { score: gold(), play: ctx.play, hudMs: HUD_REFRESH_MS };
        current = run;
        refreshPanels();
        return run;
    },

    update(run, dt, input) {
        if (input.pressed("primary")) interact(run);
        if (input.pressed("market")) buyFeed(run);
        for (const name in DEBUG) if (input.pressed(name)) { DEBUG[name](farm.world); refreshPanels(); }

        const dx = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
        const dy = (input.down("down") ? 1 : 0) - (input.down("up") ? 1 : 0);
        farm.step(dt, dx, dy);
        run.score = gold();

        run.hudMs += dt;
        if (run.hudMs >= HUD_REFRESH_MS) refreshPanels();
    },

    draw() {
        if (!farm) return;
        frameCamera();
        renderer.frame(farm.world);
    },

    // Panels refresh on their own clock (refreshPanels); the shell's per-frame
    // HUD pass only keeps the clock ticking.
    hud() {
        return farm ? { clock: clockText(farm.world.clock) } : {};
    },

    gameOverText() {
        return farm ? clockText(farm.world.clock) + "\nGold: " + gold() + "g" : "";
    },

    onEnterScreen(name) {
        if (!inspector) return;
        if (name === "pause" || name === "title" || name === "howto") inspector.close();
        if (name === "playing") refreshPanels();
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "tick") audio.tone(440, 0.04, "sine", 0.3);
        else if (name === "splash") audio.tone(170, 0.16, "sawtooth", 0.35);
        else if (name === "feed") audio.tone(320, 0.12, "triangle", 0.30);
        else if (name === "harvest") {
            audio.sequence([
                [660, 0.07, "square", 0.4],
                [880, 0.10, "square", 0.4],
            ]);
        } else if (name === "pickup") audio.tone(740, 0.08, "square", 0.45);
        else if (name === "plant") audio.tone(420, 0.07, "triangle", 0.4);
        else if (name === "nope") audio.tone(180, 0.10, "sine", 0.25);
    },
};

// ── Setup ───────────────────────────────────────────────────────────────

function ensureFarm(ctx) {
    if (farm) return;
    stage = createStage({ iso: { target: [20, 0, 14], offset: CAMERA_OFFSET, size: 29 } });
    farm = createFarm({
        getAudioCtx: () => (ctx.audio && ctx.audio.ctx ? ctx.audio.ctx() : null),
        isActive: () => shellApi && shellApi.getScreen() === "playing",
        voices: options.voices,
    });
    renderer = createRenderer(stage.scene, farm.world);
    inspector = createInspector(farm.world, stage);

    stage.onTap((p) => { if (playing()) inspector.clickAt(p.clientX, p.clientY); });
    document.getElementById("ss-close").addEventListener("click", (e) => {
        e.stopPropagation();
        if (current) current.play("tick");
        inspector.close();
    });
}

function playing() {
    return shellApi && shellApi.getScreen() === "playing";
}

/** Refit the iso camera when the canvas or the HUD dock changes size. */
function frameCamera() {
    const r = stage.canvas.getBoundingClientRect();
    const hud = document.getElementById("hud");
    const dock = hud && !hud.hidden ? (hud.getBoundingClientRect().width || HUD_DOCK_PX) : 0;
    const key = Math.round(r.width) + "x" + Math.round(r.height) + "|" + Math.round(dock);
    if (key !== framedFor && r.width > 0 && r.height > 0) {
        framedFor = key;
        fitBoard(stage, r.width, r.height, dock);
    }
    stage.applyCamera();
}

function gold() {
    return farm && farm.world.resources ? farm.world.resources.gold | 0 : 0;
}

function refreshPanels() {
    if (!farm) return;
    if (current) current.hudMs = 0;
    renderHud(farm.world, farm.world.observe());
    inspector.refresh();
}

// ── Player actions ──────────────────────────────────────────────────────

function interact(run) {
    const res = farm.interact();
    run.play(res.ok ? res.sfx : "nope");
    refreshPanels();
    return res;
}

function buyFeed(run) {
    const res = farm.buyFeed();
    run.play(res.ok ? "pickup" : "nope");
    refreshPanels();
    return res;
}

// Debug keys (1-6, O): shortcut the chores so the farm can be poked at.
const DEBUG = {
    debug_feed: (w) => PENS.forEach((p) => w.actions.refillFeedTrough(p)),
    debug_water: (w) => PENS.forEach((p) => w.actions.refillWaterTrough(p)),
    debug_crops: (w) => w.crops.forEach((c) => { if (c.stage !== "empty") w.actions.waterCrop(c.id); }),
    debug_harvest: (w) => {
        w.crops.forEach((c) => { if (c.stage === "ripe") w.actions.harvest(c.id); });
        PENS.forEach((p) => w.actions.collectProduce(p));
    },
    debug_plant: (w) => w.crops.forEach((c) => { if (c.stage === "empty") w.actions.plant(c.plotIndex, "wheat"); }),
    debug_resupply: (w) => { w.actions.drawWater(80); w.actions.loadFeed(80); },
    debug_observe: (w) => console.log(JSON.stringify(w.observe(), null, 2)),
};

// ── Test surface ────────────────────────────────────────────────────────

/** Internals for hooks.js (window.__farm); not used by the game itself. */
export const internals = {
    options,
    get farm() { return farm; },
    get stage() { return stage; },
    get inspector() { return inspector; },
    get run() { return current; },
    interact: () => interact(current),
    buyFeed: () => buyFeed(current),
    debug: DEBUG,
    refreshPanels,
};
