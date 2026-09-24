// DeepDelve — arcade plugin: turn input, HUD panels, message log. Rules live
// in sim.js, the 3D presentation in view.js. The shell owns menus / pause /
// high score. One sim (and its TileWorld) lives for the app; each run
// regenerates it with a fresh seed.

import { FLOORS, createGame } from "/app/sim.js";
import { createDelveView } from "/app/view.js";

const DIR_ACTIONS = [
    ["up", 0, -1],
    ["down", 0, 1],
    ["left", -1, 0],
    ["right", 1, 0],
];
const REPEAT_DELAY = 230, REPEAT_EVERY = 120;   // ms, held-direction auto-move
const LOG_LINES = 7;
const ARROW_FLASH = { color: [1.0, 0.78, 0.38], ms: 160 };

let view = null;      // createDelveView(), built on the first run
let core = null;      // createGame instance, reused across runs
let wiredButtons = false;

const $ = (id) => document.getElementById(id);
const newSeed = () => (Math.random() * 0xFFFFFFFF) >>> 0;

// ── Sim + view lifecycle ─────────────────────────────────────────────────

/** Build the scene and the sim on first use (runs or test hooks). */
function ensureCore() {
    if (core) return core;
    view = createDelveView();
    core = createGame(view.scene, newSeed());
    core.onShot = (line) => view.flash(line, ARROW_FLASH.color, ARROW_FLASH.ms);
    core.onFullRedraw = () => {          // a new floor / loaded grid: retint every cell
        view.applied.clear();
        view.applyTints(core, true);
    };
    core.onLog = renderLog;
    core.onHurt = () => pulse($("vignette"), "hit");
    core.onDescend = (floor) => announce("FLOOR " + floor + (floor === FLOORS ? " — THE DEEPEST DARK" : ""));
    return core;
}

/** After the sim jumps (new run, load, descend, teleport): resync visuals. */
function refresh(full) {
    if (full) view.reset(core);
    else view.applyTints(core, false);
    renderLog();
}

function act(action) {
    if (core.over) return;
    if (action.type === "move") view.face(action.dx, action.dy);
    core.playerAct(action);
    refresh(false);
}

function loadRun() {
    if (core.loadRun()) refresh(true);
    else renderLog();
}

// ── DOM chrome ───────────────────────────────────────────────────────────

function renderLog() {
    const box = $("log");
    if (!box || !core) return;
    box.textContent = "";
    for (const m of core.msgs.slice(-LOG_LINES)) {
        const d = document.createElement("div");
        d.className = "log-line " + (m.cls || "");
        d.textContent = m.text;
        box.appendChild(d);
    }
}

// Restart a CSS animation class.
function pulse(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
}

let announceTimer = null;
function announce(msg) {
    const a = $("announce");
    a.textContent = msg;
    a.hidden = false;
    pulse(a, "pop");
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { a.hidden = true; }, 2200);
}

function wireButtons() {
    if (wiredButtons) return;
    wiredButtons = true;
    $("btn-potion").addEventListener("click", () => { if (core) act({ type: "potion" }); });
    $("btn-save").addEventListener("click", () => { if (core) core.saveRun(); });
    $("btn-load").addEventListener("click", () => { if (core) loadRun(); });
}

function scoreOf(g) {
    return g.kills * 100 + g.goldTotal + g.floor * 50 + (g.won ? 1000 : 0);
}

// ── Plugin ───────────────────────────────────────────────────────────────

export const game = {
    id: "deepdelve",
    clearColor: "#07080c",

    actions: [
        { name: "primary", label: "Wait", defaults: [" "] },
        { name: "potion", label: "Potion", defaults: ["q"] },
        { name: "search", label: "Search", defaults: ["e"] },
        { name: "save", label: "Save", defaults: ["F5"] },
        { name: "load", label: "Load", defaults: ["F9"] },
    ],

    create(ctx) {
        const fresh = !core;
        ensureCore();
        if (!fresh) core.newRun(newSeed());
        refresh(true);
        wireButtons();
        return {
            score: scoreOf(core),
            play: ctx.play,
            held: null,           // { name, dx, dy } direction being held
            repeatAt: 0,
        };
    },

    update(run, dt, input) {
        const now = view.clock;
        for (const [name, dx, dy] of DIR_ACTIONS) {
            if (!input.pressed(name)) continue;
            run.held = { name, dx, dy };
            run.repeatAt = now + REPEAT_DELAY;
            act({ type: "move", dx, dy });
        }
        if (run.held && !input.down(run.held.name)) run.held = null;
        if (run.held && now >= run.repeatAt) {
            run.repeatAt = now + REPEAT_EVERY;
            act({ type: "move", dx: run.held.dx, dy: run.held.dy });
        }
        if (input.pressed("primary")) act({ type: "wait" });
        if (input.pressed("potion")) act({ type: "potion" });
        if (input.pressed("search")) act({ type: "search" });
        if (input.pressed("save")) core.saveRun();
        if (input.pressed("load")) loadRun();

        run.score = scoreOf(core);
        if (core.over) {
            run.play(core.won ? "win" : "die");
            return { status: "gameover" };
        }
        view.frame(core, dt);
    },

    draw() {},

    hud() {
        if (!core) {
            const dash = "—";
            return { hp: dash, atk: dash, def: dash, gold: dash, floor: dash, turn: dash,
                weapon: dash, armor: dash, potions: dash };
        }
        const p = core.player;
        const frac = p.hp / p.maxHp;
        const fill = $("hp-fill");
        fill.style.width = Math.round(frac * 100) + "%";
        fill.style.background = frac > 0.55 ? "#4bd24f" : frac > 0.28 ? "#e6c33c" : "#e04430";
        $("btn-potion").classList.toggle("disabled", p.potions <= 0);
        return {
            hp: p.hp + " / " + p.maxHp,
            atk: p.atk,
            def: p.def,
            gold: p.gold,
            floor: core.floor + " / " + FLOORS,
            turn: core.turn,
            weapon: p.weapon,
            armor: p.armor,
            potions: p.potions,
        };
    },

    gameOverText(run) {
        if (!core) return "";
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            (core.won ? "YOU ESCAPED WITH THE AMULET" : "YOU HAVE DIED") + "\n\n" +
            "Floor     " + core.floor + " of " + FLOORS + "\n" +
            "Slain     " + core.kills + "  ·  Gold  " + core.goldTotal + "\n" +
            "Turns     " + core.turn + "\n" +
            "Score     " + scoreOf(core) + tag
        );
    },

    // Game SFX only; menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.5],
                [659, 0.1, "square", 0.55],
                [784, 0.12, "square", 0.6],
                [1047, 0.28, "square", 0.65],
            ]);
        } else if (name === "die") {
            audio.sequence([
                [220, 0.14, "sawtooth", 0.45],
                [140, 0.22, "sawtooth", 0.5],
            ]);
        }
    },
};

// ── Test surface (hooks.js) ──────────────────────────────────────────────

export const internals = {
    ensureCore,
    refresh,
    get core() { return core; },
    get view() { return view; },
};
