// Hearthfolk: an observatory sim of five villagers on the arcade shell.
// The shell owns menus, pause and the loop; this plugin steps the sim,
// renders the village through an iso stage and wires the observatory.
//
//   sim.js         the village (tier-0 utility AI, clock, work, speech)
//   mind.js        tier 1: model-written JSON thinks that steer a villager
//   terrain.js / atlas.js / kinds.js   world generation, tiles, meshes
//   persist.js     save / load     models.js  Qwen minds + Kokoro voices
//   render.js      scene sync, lighting, selection tints
//   observatory.js chronicle, feed, bubbles, mind panel, toast
//   hooks.js       window.HEARTH for headless tests

import { createStage } from "/lib/arcade/scene3d.js";
import { clear } from "/lib/kit/dom.js";
import { PHASE_LABEL } from "/app/defs.js";
import { createGame } from "/app/sim.js";
import { setupLighting, syncWorld, createTints } from "/app/render.js";
import { loadMind, createVoices } from "/app/models.js";
import {
    wireChronicle, addFeed, createBubbles, renderPanels, toast,
} from "/app/observatory.js";

const PANEL_REFRESH_MS = 200;
const PAN_LIMIT = { x: 26, z: 20 };     // camera pan range around the map centre
const START_ZOOM = 0.70;
const SQ = Math.SQRT1_2;

let stage = null;       // scene + iso camera, built on the first create()
let lights = null;
let voices = null;
let bubbles = null;
let current = null;     // live run, for pointer handlers and test hooks

// HEARTHFOLK_NO_MODEL=1 (or hooks noModels()) keeps the minds and voices off.
export const options = { models: env("HEARTHFOLK_NO_MODEL") !== "1" };

function env(name) {
    try { return globalThis.process.env[name] || ""; } catch (e) { return ""; }
}

const PHASE = (sim) => PHASE_LABEL[sim.phaseName()] || sim.phaseName();
const resText = (r) => "food " + r.food + " · wood " + r.wood + " · stone " + r.stone +
    " · meals " + r.meals;

export const game = {
    id: "hearthfolk",
    clearColor: "#101418",

    actions: [
        { name: "primary", label: "Confirm", defaults: ["Enter"] },
        { name: "pause_sim", label: "Pause Sim", defaults: [" "] },
        { name: "speed1", label: "1x Speed", defaults: ["1"] },
        { name: "speed4", label: "4x Speed", defaults: ["4"] },
        { name: "save", label: "Save", defaults: ["F5"] },
        { name: "load", label: "Load", defaults: ["F9"] },
    ],

    create(ctx) {
        ensureStage();
        const sim = createGame(stage.scene);
        const run = {
            score: 0, play: ctx.play, sim,
            selected: null,
            tints: createTints(sim),
            pan: { x: 0, z: 0 }, base: { x: 0, z: 0 },
            framedFor: "",
            panelMs: 0, panelDirty: true,
        };
        current = run;
        lights.placeFire(sim);

        // Centre the camera on the hearth.
        stage.iso.zoom = START_ZOOM;
        frameCamera(run);
        const hc = sim.world.cellCenterWorldXZ(sim.hearth.x, sim.hearth.y);
        panBy(run, hc.x - run.base.x, hc.z - run.base.z);

        bubbles.clear();
        clear(document.getElementById("feed"));
        wireChronicle(sim);
        if (options.models) {
            loadMind(sim);
            voices = voices || createVoices();
        }
        sim.onSay = (v, text) => {
            addFeed(v, text);
            if (voices) voices.say(v.name, text);
        };
        return run;
    },

    update(run, dt, input) {
        const sim = run.sim;
        const dtSec = Math.min(0.06, Math.max(0, dt / 1000));
        sim.update(dtSec);
        sim.world.advance(dt * (sim.speed || 0));
        pan(run, input, dtSec);
        lights.update(sim);

        if (input.pressed("pause_sim")) setSpeed(run, sim.speed === 0 ? 1 : 0);
        if (input.pressed("speed1")) setSpeed(run, 1);
        if (input.pressed("speed4")) setSpeed(run, 4);
        if (input.pressed("save")) save(run);
        if (input.pressed("load")) load(run);

        syncWorld(sim);
        bubbles.sync(sim);
        run.tints.follow(run.selected);

        run.panelMs += dt;
        if (run.panelDirty || run.panelMs >= PANEL_REFRESH_MS) refreshPanels(run);
    },

    draw(run) {
        if (!stage) return;
        if (run) frameCamera(run);
        stage.applyCamera();
    },

    hud(run) {
        const sim = run && run.sim;
        if (!sim) return { day: "Day 1", phase: "Morning", thinks: "✓ 0  ✕ 0", res: "" };
        return {
            day: "Day " + sim.day(),
            phase: PHASE(sim),
            thinks: "✓ " + sim.mind.accepted + "  ✕ " + sim.mind.discarded,
            res: resText(sim.res),
        };
    },

    gameOverText(run) {
        const sim = run && run.sim;
        return sim ? "Day " + sim.day() + " · " + PHASE(sim) + "\n" + resText(sim.res) : "";
    },

    cue() {},
};

// ── Stage + camera ──────────────────────────────────────────────────────────

function ensureStage() {
    if (stage) return;
    stage = createStage({
        iso: { offset: [16, 18, 16], size: 14, zoom: START_ZOOM, far: 220,
               wheel: { step: 0.06, min: 0.28, max: 1.4 } },
    });
    lights = setupLighting(stage.scene);
    bubbles = createBubbles((v) => villagerScreen(current, v));
    stage.onTap((p) => {
        if (!current) return;
        const v = villagerAt(current, p.clientX, p.clientY);
        select(current, v && v !== current.selected ? v : null);
    });
    const bind = (id, fn) => document.getElementById(id)
        .addEventListener("click", () => { if (current) fn(current); });
    bind("btn-pause", (r) => setSpeed(r, 0));
    bind("btn-1x", (r) => setSpeed(r, 1));
    bind("btn-4x", (r) => setSpeed(r, 4));
    bind("btn-save", save);
    bind("btn-load", load);
}

// Fit the map's view height to the canvas when the canvas size changes; the
// pan offset and wheel zoom stay as they are.
function frameCamera(run) {
    const r = stage.canvas.getBoundingClientRect();
    const key = r.width + "x" + r.height;
    if (key === run.framedFor) return;
    run.framedFor = key;
    const b = run.sim.world.worldBounds();
    run.base = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : 16 / 10;
    const spanZ = b.maxZ - b.minZ;
    const diag = Math.hypot(b.maxX - b.minX, spanZ);
    stage.iso.size = Math.max(spanZ * 0.72 + 2.0, (diag * 0.72 + 1.5) / aspect);
    panBy(run, 0, 0);
}

function panBy(run, dx, dz) {
    run.pan.x = Math.max(-PAN_LIMIT.x, Math.min(PAN_LIMIT.x, run.pan.x + dx));
    run.pan.z = Math.max(-PAN_LIMIT.z, Math.min(PAN_LIMIT.z, run.pan.z + dz));
    stage.iso.target = [run.base.x + run.pan.x, 0, run.base.z + run.pan.z];
}

// Arrows / WASD pan along the screen axes of the iso view.
function pan(run, input, dt) {
    const s = 11 * dt * stage.iso.zoom;
    const right = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
    const up = (input.down("up") ? 1 : 0) - (input.down("down") ? 1 : 0);
    if (right || up) panBy(run, SQ * s * (right + up), SQ * s * (up - right));
}

// ── Picking ─────────────────────────────────────────────────────────────────

/** Client pixel of a villager's head (where the bubble anchors), or null. */
export function villagerScreen(run, v) {
    if (!run || !stage) return null;
    const ri = run.sim.renderInfo(v);
    const cc = run.sim.world.cellCenterWorldXZ(ri.anchor.x, ri.anchor.y);
    return stage.toScreen(cc.x + ri.offsetX, ri.worldY + 0.55, cc.z + ri.offsetZ);
}

/** The villager standing nearest the terrain cell under a client pixel (within 1.6 cells). */
function villagerAt(run, clientX, clientY) {
    const ray = stage.rayAt(clientX, clientY);
    const hit = ray && run.sim.world.raycastCell(ray.origin, ray.dir, 500);
    if (!hit) return null;
    let best = null, bestD = 1.6;
    for (const v of run.sim.villagers) {
        const d = Math.hypot(v.pos.x - hit.x, v.pos.y - hit.y);
        if (d < bestD) { bestD = d; best = v; }
    }
    return best;
}

// ── Actions ─────────────────────────────────────────────────────────────────

export function select(run, v) {
    run.selected = v || null;
    run.tints.apply(run.selected);
    run.panelDirty = true;
}

export function setSpeed(run, sp) {
    run.sim.speed = sp;
    run.panelDirty = true;
}

function save(run) {
    if (run.sim.saveVillage()) toast("Village saved");
}

function load(run) {
    const sim = run.sim;
    if (!sim.hasSave()) { toast("No saved village"); return; }
    if (!sim.loadVillage()) { toast("Save file is corrupt"); return; }
    run.selected = null;
    run.tints.clear();
    wireChronicle(sim);
    sim.world.rebuild();
    toast("Village loaded");
    run.panelDirty = true;
}

function refreshPanels(run) {
    run.panelMs = 0;
    run.panelDirty = false;
    renderPanels(run.sim, run.selected, !!(voices && voices.enabled));
}

/** Plugin state for hooks.js. */
export const internals = {
    options,
    get run() { return current; },
    get stage() { return stage; },
    get voices() { return voices; },
    villagerScreen: (v) => villagerScreen(current, v),
    select: (v) => select(current, v),
    setSpeed: (sp) => setSpeed(current, sp),
};
