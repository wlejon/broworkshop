// HexFront — turn-based hex tactics, arcade plugin on a 3D stage.
// Shell (/lib/arcade): screens, loop, pause, bindings, high score. Here:
// picking cells on the stage, the select -> move -> attack flow, the blue
// AI's turn and move animations on game-clock timers (so pause freezes
// them), the HUD panels, save / load.
//   rules.js   map, units, movement, combat, AI
//   board.js   the TileWorld, unit instances, HP bars, highlights, popups

import { createStage } from "/lib/arcade/scene3d.js";
import { createTimers } from "/lib/arcade/timers.js";
import {
    UNIT_TYPES, createBattle, aliveUnits, unitAt, tileName, reachable, routeTo,
    attackTargets, attack, beginBlueTurn, beginRedTurn, aiAct, victoryScore,
    snapshot, restore, drainEvents,
} from "/app/rules.js";
import { createBoard, TINT } from "/app/board.js";

const MOVE_STEP_MS = 70;
const AI_STEP_MS = 260;
const TOAST_MS = 1600;
const SAVE_KEY = "battle";

let api = null;
let stage = null;
let board = null;           // the current run's board (one TileWorld at a time)

export const game = {
    id: "hexfront",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Select", defaults: ["Enter"] },
        { name: "endturn", label: "End Turn", defaults: ["e"] },
        { name: "save", label: "Save", defaults: ["s"] },
        { name: "load", label: "Load", defaults: ["l"] },
    ],

    defaults: { highScore: 0, battle: null },

    init(shellApi) {
        api = shellApi;
        const bind = (id, fn) => document.getElementById(id).addEventListener("click", () => {
            const run = api.getRun();
            if (run && api.getScreen() === "playing") fn(run);
        });
        bind("btn-endturn", endTurn);
        bind("btn-save", saveGame);
        bind("btn-load", loadGame);
    },

    create(shellApi) {
        ensureStage();
        if (board) board.destroy();                 // Restart / Play Again: drop the old world
        board = createBoard(stage.scene);
        const run = {
            score: 0,
            battle: createBattle(board.world),
            board,
            timers: createTimers(),
            sel: null,              // { unit, phase: "move" | "attack", reach, targets }
            busy: false,            // a move is animating
            aiRunning: false,
            result: null,
            play: shellApi.play,
            highScore: shellApi.highScore,
        };
        board.sync(run.battle);
        board.clearHighlights();
        frameCamera();
        return run;
    },

    update(run, dt, input) {
        run.timers.step(dt);
        run.board.stepPopups(dt);
        if (input.pressed("endturn")) endTurn(run);
        if (input.pressed("save")) saveGame(run);
        if (input.pressed("load")) loadGame(run);
        react(run);
        if (run.result) return { status: "gameover", result: run.result };
    },

    draw() {
        // The scene renders itself; the 2D shell canvas stays hidden.
    },

    hud(run) {
        if (!run) return { turn: "TURN —", side: "—", ai: "" };
        const red = run.battle.turn.side === "red";
        const side = document.getElementById("hud-side");
        side.className = red ? "side-red" : "side-blue";
        document.getElementById("hud-ai").style.display = run.aiRunning ? "" : "none";
        unitPanel(run);
        return {
            turn: "TURN " + run.battle.turn.number,
            side: red ? "RED MOVES" : "BLUE MOVES",
            ai: run.aiRunning ? "BLUE IS MOVING…" : "",
        };
    },

    gameOverText(run) {
        const won = run.battle.turn.winner === "red";
        return (won ? "VICTORY" : "DEFEAT") + "\nTurn " + run.battle.turn.number + "\n" +
            (won ? "Blue forces eliminated" : "Red forces eliminated") +
            (won ? "\nScore " + run.score + (run._newBest ? "  ·  NEW BEST" : "") : "");
    },

    onEnterScreen(name, run) {
        if (name === "gameover" && run) {
            const won = run.battle.turn.winner === "red";
            const title = document.getElementById("gameover-title");
            title.textContent = won ? "VICTORY" : "DEFEAT";
            title.className = "overlay-title " + (won ? "victory" : "defeat");
        }
        if (name !== "playing") hideToast();
    },

    cue(name, audio) {
        const seq = CUES[name];
        if (seq) audio.sequence(seq);
    },
};

const CUES = {
    hit: [[180, 0.08, "square", 0.45]],
    win: [[523, 0.1, "square", 0.5], [659, 0.1, "square", 0.55], [784, 0.18, "square", 0.6]],
    lose: [[220, 0.12, "sawtooth", 0.4], [160, 0.2, "sawtooth", 0.45]],
};

// ── Stage ────────────────────────────────────────────────────────────────

function ensureStage() {
    if (stage) return;
    stage = createStage({ iso: { target: [0, 0, 0], offset: [6, 26, 20], size: 12, far: 200 } });
    const scene = stage.scene;
    scene.setToneMap({ mode: "aces", exposure: 1.05, gamma: 2.2 });
    scene.setAmbient([0.16, 0.17, 0.20]);
    scene.createLight({ type: "directional", direction: [-0.45, -1.0, -0.35], color: [1.0, 0.96, 0.88], intensity: 2.6 });
    window.addEventListener("resize", frameCamera);
    stage.onTap((p) => {
        const run = api.getRun();
        if (!run || api.getScreen() !== "playing") return;
        const ray = stage.rayAt(p.clientX, p.clientY);
        const hit = ray && run.board.world.raycastCell(ray.origin, ray.dir, 500);
        if (hit) actOnCell(run, hit.x, hit.y);
        else if (run.sel && run.sel.phase === "move") deselect(run);
    });
}

// Fit the whole map in view: project the map's box onto the camera's
// screen axes, centre on it and size the view to the larger span (plus a
// margin for the HUD strips top and bottom).
function frameCamera() {
    if (!stage || !board) return;
    const b = board.world.worldBounds();
    const r = stage.canvas.getBoundingClientRect();
    const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : 16 / 10;
    const off = stage.iso.offset;
    const len = Math.hypot(off[0], off[1], off[2]);
    const fwd = [-off[0] / len, -off[1] / len, -off[2] / len];
    const right = norm([-fwd[2], 0, fwd[0]]);                       // fwd x up
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    const dot = (a, v) => a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
    const rs = [], us = [];
    for (const x of [b.minX, b.maxX]) for (const y of [-1, 1.2]) for (const z of [b.minZ, b.maxZ]) {
        rs.push(dot([x, y, z], right));
        us.push(dot([x, y, z], up));
    }
    const rMid = (Math.min(...rs) + Math.max(...rs)) / 2, uMid = (Math.min(...us) + Math.max(...us)) / 2;
    const rSpan = Math.max(...rs) - Math.min(...rs), uSpan = Math.max(...us) - Math.min(...us);
    // The point at (rMid, uMid) on screen, slid along the view ray to the ground (y = 0).
    const p = [right[0] * rMid + up[0] * uMid, right[1] * rMid + up[1] * uMid, right[2] * rMid + up[2] * uMid];
    const s = -p[1] / fwd[1];
    stage.reframe([p[0] + fwd[0] * s, 0, p[2] + fwd[2] * s], Math.max(uSpan, rSpan / aspect) * 1.06 + 1.2);
    stage.applyCamera();
}

function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

/** Client pixel over a cell's surface (tests click through this). */
export function projectCell(x, y) {
    const p = board.topOf(x, y);
    return stage.toScreen(p.x, p.y, p.z);
}

// ── Events -> sound, popups, game over ───────────────────────────────────

function react(run) {
    const b = run.battle;
    const events = drainEvents(b);
    if (events.length) run.board.sync(b);
    for (const e of events) {
        if (e.type === "combat") {
            run.play("hit");
            run.board.popup(e.defender.x, e.defender.y, "-" + e.damage, "#ffd75e");
            if (e.counterDamage > 0) {
                const a = e.attacker;
                run.timers.after(250, () => run.board.popup(a.x, a.y, "-" + e.counterDamage, "#8fd0ff"));
            }
        } else if (e.type === "gameover") {
            const won = e.winner === "red";
            run.score = won ? victoryScore(b) : 0;
            run.board.clearHighlights();
            run.play(won ? "win" : "lose");
            run.result = { winner: e.winner, score: run.score };
        }
    }
}

// ── Selection ────────────────────────────────────────────────────────────

function refreshHighlights(run) {
    const { board: bd, battle: b, sel } = run;
    bd.clearHighlights();
    if (!sel) return;
    if (sel.phase === "move") {
        bd.highlight([...sel.reach.values()].filter((c) => !unitAt(b, c.x, c.y)), TINT.move);
    }
    bd.highlight(sel.targets, TINT.target);
    bd.highlight([sel.unit], TINT.selected);
}

function select(run, unit) {
    run.sel = { unit, phase: "move", reach: reachable(run.battle, unit), targets: attackTargets(run.battle, unit) };
    refreshHighlights(run);
}

function deselect(run) {
    run.sel = null;
    run.board.clearHighlights();
}

function finishUnit(run, unit) {
    unit.acted = true;
    run.board.sync(run.battle);                    // dims the spent unit
    deselect(run);
}

// Walk the A* route a cell per step, then offer targets from the new cell.
function moveUnit(run, unit, tx, ty) {
    const path = routeTo(run.battle, unit, tx, ty);
    if (!path.length) return;
    run.busy = true;
    run.board.clearHighlights();
    let i = 0;
    const stepOnce = () => {
        unit.x = path[i].x;
        unit.y = path[i].y;
        run.board.sync(run.battle);
        return ++i < path.length;
    };
    const arrive = () => {
        run.busy = false;
        const targets = attackTargets(run.battle, unit);
        if (!targets.length) { finishUnit(run, unit); return; }
        run.sel = { unit, phase: "attack", reach: new Map(), targets };
        refreshHighlights(run);
    };
    if (!stepOnce()) { arrive(); return; }
    run.timers.every(MOVE_STEP_MS, () => {
        if (stepOnce()) return true;
        arrive();
        return false;
    });
}

function strike(run, att, def) {
    attack(run.battle, att, def);
    if (att.alive) finishUnit(run, att);
    else deselect(run);
}

/** A click on cell (x, y) during red's turn. */
export function actOnCell(run, x, y) {
    const b = run.battle;
    if (b.turn.over || b.turn.side !== "red" || run.busy || run.aiRunning) return;
    const u = unitAt(b, x, y);
    const sel = run.sel;
    if (!sel) {
        if (u && u.side === "red" && !u.acted) select(run, u);
        return;
    }
    if (u && u.side === "blue" && sel.targets.includes(u)) { strike(run, sel.unit, u); return; }
    if (sel.phase === "attack") { finishUnit(run, sel.unit); return; }     // hold position
    if (u === sel.unit) { deselect(run); return; }
    if (u && u.side === "red") {
        if (!u.acted) select(run, u); else deselect(run);
        return;
    }
    if (!u && sel.reach.has(x + "," + y)) { moveUnit(run, sel.unit, x, y); return; }
    deselect(run);
}

// ── Turns, save, load ────────────────────────────────────────────────────

/** Hand over to blue: each unit acts in turn, a beat apart, then red again. */
export function endTurn(run) {
    const b = run.battle;
    if (b.turn.over || b.turn.side !== "red" || run.busy || run.aiRunning) return;
    deselect(run);
    beginBlueTurn(b);
    run.aiRunning = true;
    const queue = aliveUnits(b, "blue");
    let i = 0;
    run.timers.every(AI_STEP_MS, () => {
        if (b.turn.over) { run.aiRunning = false; return false; }
        if (i >= queue.length) {
            run.aiRunning = false;
            beginRedTurn(b);
            run.board.sync(b);
            return false;
        }
        const unit = queue[i++];
        if (unit.alive) aiAct(b, unit);
        run.board.sync(b);
        return true;
    });
}

function saveGame(run) {
    api.save.set(SAVE_KEY, snapshot(run.battle));
    api.save.save();
    toast("Game saved");
}

function loadGame(run) {
    if (run.busy || run.aiRunning) return;
    if (!restore(run.battle, api.save.get(SAVE_KEY))) { toast("No save found"); return; }
    deselect(run);
    run.board.sync(run.battle);
    toast("Game loaded");
    if (run.battle.turn.over) {
        run.score = run.battle.turn.winner === "red" ? victoryScore(run.battle) : 0;
        run.result = { winner: run.battle.turn.winner, score: run.score };
    }
}

// ── HUD panels ───────────────────────────────────────────────────────────

let toastTimer = null;         // cancel() for the pending hide

function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.style.display = "";
    if (toastTimer) toastTimer();
    toastTimer = api.getRun().timers.after(TOAST_MS, hideToast);
}

function hideToast() {
    toastTimer = null;
    document.getElementById("toast").style.display = "none";
}

function unitPanel(run) {
    const panel = document.getElementById("unit-panel");
    const u = run.sel ? run.sel.unit : null;
    panel.style.display = u ? "" : "none";
    if (!u) return;
    const t = UNIT_TYPES[u.type];
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    set("unit-name", t.name + " (" + u.side.toUpperCase() + ")");
    set("unit-hp", u.hp + " / " + t.hp);
    set("unit-atk", String(t.atk));
    set("unit-move", String(t.move));
    set("unit-range", t.rangeMin === t.rangeMax ? String(t.rangeMax) : t.rangeMin + "-" + t.rangeMax);
    set("unit-terrain", tileName(run.battle, u.x, u.y));
    set("unit-hint", run.sel.phase === "attack"
        ? "Pick a target — or click elsewhere to hold position."
        : "Blue cells: move. Red-lit enemies: attack.");
}
