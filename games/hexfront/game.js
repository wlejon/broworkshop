// HexFront — arcade foundation plugin (3D hex tactics).
// Domain: sim.js. Shell owns menus / pause / session; scene lives on #view.

import { createGame, UNIT_TYPES, FLAG_WATER } from "/app/sim.js";

let canvas = null;
let scene = null;
let wired = false;
/** @type {object|null} */
/** @type {object|null} Latest run (wiring + HUD). */
let activeRun = null;

export const game = {
    id: "hexfront",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Select", defaults: ["Enter"] },
        { name: "endturn", label: "End Turn", defaults: ["e"] },
        { name: "save", label: "Save", defaults: ["s"] },
        { name: "load", label: "Load", defaults: ["l"] },
    ],

    create(ctx) {
        ensureScene();
        ensureWiring();

        const battle = createGame(scene);

        const run = {
            score: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            battle,
            sel: null,
            busy: false,
            aiRunning: false,
            pendingOver: null,
            toastTimer: null,
        };
        activeRun = run;
        frameCamera();

        battle.onCombat = (info) => {
            damagePopup(battle.world, info.defender, "-" + info.damage, "#ffd75e");
            if (info.counterDamage > 0) {
                setTimeout(() => {
                    damagePopup(battle.world, info.attacker, "-" + info.counterDamage, "#8fd0ff");
                }, 250);
            }
            ctx.play("hit");
        };
        battle.onGameOver = (winner) => {
            run.pendingOver = winner;
            run.score = winner === "red"
                ? Math.max(1, 1000 - battle.turn.number * 10)
                : 0;
            battle.clearHighlights();
            ctx.play(winner === "red" ? "win" : "lose");
        };

        exposeDebug(run);
        return run;
    },

    update(run, dt, input) {
        activeRun = run;
        if (!run || !run.battle) return;

        if (run.pendingOver) {
            const w = run.pendingOver;
            run.pendingOver = null;
            return {
                status: "gameover",
                result: { winner: w, score: run.score },
            };
        }

        if (input.pressed("endturn")) endTurn(run);
        if (input.pressed("save")) saveGame(run);
        if (input.pressed("load")) loadGame(run);
    },

    draw() {
        // 3D scene is engine-rendered.
    },

    hud(run) {
        if (!run || !run.battle) {
            return {
                turn: "TURN —",
                side: "—",
                ai: "",
            };
        }
        const b = run.battle;
        const red = b.turn.side === "red";
        const sideEl = document.getElementById("hud-side");
        if (sideEl) {
            sideEl.textContent = red ? "RED MOVES" : "BLUE MOVES";
            sideEl.className = red ? "side-red" : "side-blue";
        }
        const aiEl = document.getElementById("hud-ai");
        if (aiEl) aiEl.style.display = run.aiRunning ? "" : "none";

        refreshUnitPanel(run);

        return {
            turn: "TURN " + b.turn.number,
            side: red ? "RED MOVES" : "BLUE MOVES",
            ai: run.aiRunning ? "BLUE IS MOVING…" : "",
        };
    },

    gameOverText(run, result) {
        const winner = (result && result.winner) ||
            (run && run.battle && run.battle.turn.winner) || "blue";
        const turn = run && run.battle ? run.battle.turn.number : 0;
        if (winner === "red") {
            return "VICTORY\nTurn " + turn + "\nBlue forces eliminated";
        }
        return "DEFEAT\nTurn " + turn + "\nRed forces eliminated";
    },

    onEnterScreen(name, run) {
        if (name === "gameover" && run && run.battle) {
            const title = document.getElementById("gameover-title");
            if (title) {
                const w = run.battle.turn.winner;
                title.textContent = w === "red" ? "VICTORY" : "DEFEAT";
                title.className = "overlay-title " + (w === "red" ? "victory" : "defeat");
            }
        }
    },

    cue(name, audio) {
        if (name === "hit") audio.tone(180, 0.08, "square", 0.45);
        else if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.5],
                [659, 0.1, "square", 0.55],
                [784, 0.18, "square", 0.6],
            ]);
        } else if (name === "lose") {
            audio.sequence([
                [220, 0.12, "sawtooth", 0.4],
                [160, 0.2, "sawtooth", 0.45],
            ]);
        }
    },
};

// ── Scene ──────────────────────────────────────────────────────────────────

function ensureScene() {
    if (scene) return;
    canvas = document.getElementById("view");
    if (!canvas) throw new Error("hexfront: #view canvas missing");
    scene = canvas.getContext("scene");
    if (!scene) throw new Error("hexfront: scene context unavailable");

    scene.setToneMap({ mode: "aces", exposure: 1.05, gamma: 2.2 });
    scene.setAmbient([0.16, 0.17, 0.20]);
    scene.createLight({
        type: "directional",
        direction: [-0.45, -1.0, -0.35],
        color: [1.0, 0.96, 0.88],
        intensity: 2.6,
    });
    window.addEventListener("resize", frameCamera);
}

function frameCamera() {
    if (!activeRun || !activeRun.battle || !scene) return;
    const world = activeRun.battle.world;
    const b = world.worldBounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const size = Math.max(spanZ * 0.92 + 2.2, (spanX + 1.5) / aspect);
    scene.setCamera({
        mode: "orthographic",
        size, aspect, near: 0.1, far: 200,
        position: [cx + 6, 26, cz + 20],
        target: [cx, 0, cz],
    });
}

// ── UI helpers ─────────────────────────────────────────────────────────────

const el = (id) => document.getElementById(id);

function toast(run, msg) {
    let t = el("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.display = "";
    if (run.toastTimer) clearTimeout(run.toastTimer);
    run.toastTimer = setTimeout(() => { t.style.display = "none"; }, 1600);
}

function damagePopup(world, unit, text, color) {
    if (!scene || !unit) return;
    const p = world.cellCenterWorldXZ(unit.x, unit.y);
    let topY = world.sampleHeight(p.x, p.z);
    if (topY === null) topY = 0;
    const node = scene.createHtmlNode({
        width: 80, height: 30, pxPerUnit: 60,
        worldAnchor: [p.x, topY + 1.5, p.z], billboard: "full",
        html: '<div style="color:' + color + ';font:bold 22px monospace;text-align:center;' +
              'text-shadow:0 1px 3px #000">' + text + "</div>",
    });
    let rise = 0;
    const iv = setInterval(() => {
        rise += 0.06;
        node.worldAnchor = [p.x, topY + 1.5 + rise, p.z];
        if (rise > 0.6) { clearInterval(iv); node.destroy(); }
    }, 50);
}

function refreshUnitPanel(run) {
    const panel = el("unit-panel");
    if (!panel) return;
    const u = run.sel ? run.sel.unit : null;
    panel.style.display = u ? "" : "none";
    if (!u) return;
    const t = UNIT_TYPES[u.type];
    const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };
    set("unit-name", t.name + " (" + u.side.toUpperCase() + ")");
    set("unit-hp", u.hp + " / " + t.hp);
    set("unit-atk", String(t.atk));
    set("unit-move", String(t.move));
    set("unit-range", t.rangeMin === t.rangeMax
        ? String(t.rangeMax) : t.rangeMin + "-" + t.rangeMax);
    set("unit-terrain", run.battle.tileName(u.x, u.y));
    set("unit-hint", run.sel.phase === "attack"
        ? "Pick a target — or click elsewhere to hold position."
        : "Blue cells: move. Red-lit enemies: attack.");
}

// ── Selection / turns ──────────────────────────────────────────────────────

function refreshHighlights(run) {
    const battle = run.battle;
    battle.clearHighlights();
    if (!run.sel) return;
    const u = run.sel.unit;
    if (run.sel.phase === "move") {
        const cells = [];
        for (const c of run.sel.reach.values())
            if (!battle.unitAt(c.x, c.y)) cells.push(c);
        battle.highlight(cells, 0.45, 0.70, 1.55);
        battle.highlight(run.sel.targets.map(t => ({ x: t.x, y: t.y })), 1.9, 0.30, 0.30);
    } else {
        battle.highlight(run.sel.targets.map(t => ({ x: t.x, y: t.y })), 1.9, 0.30, 0.30);
    }
    battle.highlight([{ x: u.x, y: u.y }], 1.6, 1.45, 0.45);
}

function select(run, unit) {
    run.sel = {
        unit, phase: "move",
        reach: run.battle.reachable(unit),
        targets: run.battle.attackTargets(unit),
    };
    refreshHighlights(run);
}

function deselect(run) {
    run.sel = null;
    run.battle.clearHighlights();
}

function finishUnit(run, unit) {
    unit.acted = true;
    run.battle.sync();
    deselect(run);
}

function doMove(run, unit, tx, ty) {
    const path = run.battle.routeTo(unit, tx, ty);
    if (!path.length) return;
    run.busy = true;
    run.battle.clearHighlights();
    run.battle.moveUnitAlong(unit, path, 70, () => {
        run.busy = false;
        const targets = run.battle.attackTargets(unit);
        if (targets.length) {
            run.sel = { unit, phase: "attack", reach: new Map(), targets };
            refreshHighlights(run);
        } else {
            finishUnit(run, unit);
        }
    });
}

function doAttack(run, att, def) {
    run.battle.attack(att, def);
    if (att.alive) finishUnit(run, att); else deselect(run);
}

function actOnCell(run, x, y) {
    if (!run || !run.battle) return;
    const battle = run.battle;
    if (battle.turn.over || battle.turn.side !== "red" || run.busy || run.aiRunning) return;
    const u = battle.unitAt(x, y);

    if (!run.sel) {
        if (u && u.side === "red" && !u.acted) select(run, u);
        return;
    }

    if (run.sel.phase === "move") {
        if (u === run.sel.unit) { deselect(run); return; }
        if (u && u.side === "blue" && run.sel.targets.includes(u)) {
            doAttack(run, run.sel.unit, u); return;
        }
        if (u && u.side === "red") {
            if (!u.acted) select(run, u); else deselect(run);
            return;
        }
        const key = x + "," + y;
        if (!u && run.sel.reach.has(key)) { doMove(run, run.sel.unit, x, y); return; }
        deselect(run);
    } else {
        if (u && u.side === "blue" && run.sel.targets.includes(u)) {
            doAttack(run, run.sel.unit, u); return;
        }
        finishUnit(run, run.sel.unit);
    }
}

function endTurn(run) {
    if (!run || !run.battle) return;
    const battle = run.battle;
    if (battle.turn.over || battle.turn.side !== "red" || run.busy || run.aiRunning) return;
    deselect(run);
    battle.beginBlueTurn();
    run.aiRunning = true;
    const queue = battle.aliveUnits("blue");
    let i = 0;
    const step = () => {
        if (battle.turn.over) { run.aiRunning = false; return; }
        if (i >= queue.length) {
            run.aiRunning = false;
            battle.beginRedTurn();
            return;
        }
        const unit = queue[i++];
        if (unit.alive) battle.aiAct(unit);
        setTimeout(step, 260);
    };
    setTimeout(step, 260);
}

function saveGame(run) {
    if (!run || !run.battle) return;
    if (run.battle.save()) toast(run, "Game saved");
}

function loadGame(run) {
    if (!run || !run.battle) return;
    if (run.busy || run.aiRunning) return;
    if (run.battle.load()) {
        deselect(run);
        if (run.battle.turn.over) run.pendingOver = run.battle.turn.winner;
        toast(run, "Game loaded");
    } else {
        toast(run, "No save found");
    }
}

// ── Input wiring ───────────────────────────────────────────────────────────

function ensureWiring() {
    if (wired) return;
    wired = true;
    ensureScene();

    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !activeRun) return;
        const rect = canvas.getBoundingClientRect();
        const ray = scene.unprojectLocal(e.clientX - rect.left, e.clientY - rect.top);
        if (!ray) return;
        const hit = activeRun.battle.world.raycastCell(ray.origin, ray.dir, 500);
        if (!hit) {
            if (activeRun.sel && activeRun.sel.phase === "move") deselect(activeRun);
            return;
        }
        actOnCell(activeRun, hit.x, hit.y);
    });

    const bindBtn = (id, fn) => {
        const n = el(id);
        if (n) n.addEventListener("click", () => { if (activeRun) fn(activeRun); });
    };
    bindBtn("btn-endturn", endTurn);
    bindBtn("btn-save", saveGame);
    bindBtn("btn-load", loadGame);
}

// ── Debug / test surface ───────────────────────────────────────────────────

function projectCell(x, y) {
    if (!activeRun || !scene) return { x: 0, y: 0 };
    const world = activeRun.battle.world;
    const c = world.cellCenterWorldXZ(x, y);
    let topY = world.sampleHeight(c.x, c.z);
    if (topY === null) topY = 0;
    const V = scene.viewMatrix, P = scene.projectionMatrix;
    const mul = (m, v) => [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
    ];
    const clip = mul(P, mul(V, [c.x, topY, c.z, 1]));
    const rect = canvas.getBoundingClientRect();
    return {
        x: rect.left + (clip[0] / clip[3] * 0.5 + 0.5) * rect.width,
        y: rect.top + (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * rect.height,
    };
}

function exposeDebug(run) {
    window.HEXFRONT = {
        game: run.battle,
        world: run.battle.world,
        scene,
        projectCell,
        actOnCell: (x, y) => actOnCell(run, x, y),
        endTurn: () => endTurn(run),
        saveGame: () => saveGame(run),
        loadGame: () => loadGame(run),
        get selection() { return run.sel; },
        get busy() { return run.busy; },
        get aiRunning() { return run.aiRunning; },
        FLAG_WATER,
        debug: {
            place(unit, x, y) { unit.x = x; unit.y = y; run.battle.sync(); },
            setHp(unit, hp) { unit.hp = hp; run.battle.sync(); },
            resetActed(side) {
                for (const u of run.battle.aliveUnits(side)) u.acted = false;
                run.battle.sync();
            },
        },
    };
}
