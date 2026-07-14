// GridKeep — arcade foundation plugin (3D maze tower defense).
// Domain: sim.js. Shell owns menus / pause / session; scene lives on #view.

import {
    createGame, TILE, TOWER_TYPES, CREEP_TYPES, MAX_LEVEL, upgradeCost,
    FLAG_BLOCK, FLAG_NOBUILD, FLAG_TOWER, MAP_W, MAP_H, SPAWNS, BASE, HSTEP,
} from "/app/sim.js";

let canvas = null;
let scene = null;
let wired = false;
/** @type {object|null} */
let G = null;

const REFUSE_TEXT = {
    blocks: "That would wall off the path!",
    gold: "Not enough gold",
    terrain: "Cannot build on that terrain",
    occupied: "A tower is already there",
    creep: "A creep is in the way",
};

const TOWER_COLOR = {
    arrow: [0.64, 0.46, 0.26, 1],
    cannon: [0.32, 0.34, 0.40, 1],
    frost: [0.34, 0.58, 0.95, 1],
};
const LEVEL_ACCENT = [null, [1, 1, 1], [1.25, 1.12, 0.9], [1.6, 1.25, 0.7]];
const CREEP_COLOR = {
    normal: [0.78, 0.22, 0.50, 1],
    fast: [1.0, 0.52, 0.10, 1],
    tank: [0.40, 0.28, 0.16, 1],
    boss: [0.70, 0.08, 0.08, 1],
};

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
        ensureScene();
        ensureWiring();

        const sim = createGame(scene);
        const C00 = sim.world.cellCenterWorldXZ(0, 0);
        const C10 = sim.world.cellCenterWorldXZ(1, 0);
        const C01 = sim.world.cellCenterWorldXZ(0, 1);

        const run = {
            score: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            sim,
            placeType: null,
            selectedTower: null,
            hoverCell: null,
            hoverPlaceable: false,
            applied: new Map(),
            effects: [],
            hpBars: new Map(),
            cellWorldX: (px) => C00.x + px * (C10.x - C00.x),
            cellWorldZ: (py) => C00.z + py * (C01.z - C00.z),
            pendingOver: null,
            toastTimer: null,
            hudCache: "",
        };
        G = run;
        frameCamera(sim.world);

        sim.onSplash = (x, y) => {
            flashCells(run, sim.world.cellsInRange(x, y, 1, "vertex"), [1.7, 1.15, 0.5], 0.18);
        };
        sim.onRefused = (r) => {
            flashCells(run, [{ x: r.x, y: r.y }], [1.9, 0.35, 0.35], 0.35);
            toast(run, REFUSE_TEXT[r.reason] || "Cannot build there");
            ctx.play("refuse");
        };
        sim.onWaveStart = (n, def) => {
            const names = [...new Set(def.groups.map(g => CREEP_TYPES[g.t].name))].join(" + ");
            announce("WAVE " + n + (n === sim.finalWave ? " — FINAL!" : "") + "  ·  " + names);
            ctx.play("wave");
        };
        sim.onWaveCleared = (n, bonus) => {
            if (n < sim.finalWave) toast(run, "Wave " + n + " cleared  ·  +" + bonus + "g bonus");
            ctx.play("clear");
        };
        sim.onLeak = () => {
            const lv = document.getElementById("hud-lives-box");
            if (lv) {
                lv.classList.remove("hurt");
                void lv.offsetWidth;
                lv.classList.add("hurt");
            }
            ctx.play("leak");
        };
        sim.onGameOver = (won) => {
            run.pendingOver = won;
            run.score = won ? 1000 + sim.lives * 50 + sim.kills : sim.kills * 10;
            run.placeType = null;
            run.selectedTower = null;
            applyTints(run);
            ctx.play(won ? "win" : "lose");
        };

        // Static palette cost labels
        for (const type of Object.keys(TOWER_TYPES)) {
            const btn = document.getElementById("btn-" + type);
            if (!btn) continue;
            const cost = btn.querySelector(".tb-cost");
            const desc = btn.querySelector(".tb-desc");
            if (cost) cost.textContent = TOWER_TYPES[type].cost + "g";
            if (desc) desc.textContent = TOWER_TYPES[type].desc;
        }

        exposeDebug(run);
        return run;
    },

    update(run, dt, input) {
        G = run;
        if (!run || !run.sim) return;

        if (run.pendingOver !== null && run.pendingOver !== undefined) {
            const won = run.pendingOver;
            run.pendingOver = null;
            return {
                status: "gameover",
                result: { won, score: run.score, kills: run.sim.kills, wave: run.sim.wave, lives: run.sim.lives },
            };
        }

        const dtSec = Math.min(0.05, Math.max(0, dt / 1000));
        run.sim.update(dtSec);
        run.sim.world.advance(dt);

        if (run.effects.length) {
            const n = run.effects.length;
            run.effects = run.effects.filter(e => e.until > run.sim.time);
            if (run.effects.length !== n) applyTints(run);
        }
        if (run.selectedTower && !run.sim.towers.includes(run.selectedTower)) {
            run.selectedTower = null;
            applyTints(run);
        }

        if (input.pressed("wave")) run.sim.startNextWave();
        if (input.pressed("t1")) setPlaceType(run, "arrow");
        if (input.pressed("t2")) setPlaceType(run, "cannon");
        if (input.pressed("t3")) setPlaceType(run, "frost");
        if (input.pressed("upgrade") && run.selectedTower) run.sim.upgradeTower(run.selectedTower);
        if (input.pressed("sell") && run.selectedTower) {
            run.sim.sellTower(run.selectedTower);
            run.selectedTower = null;
            applyTints(run);
        }

        syncRender(run);
    },

    draw() {},

    hud(run) {
        if (!run || !run.sim) {
            return { gold: "0", lives: "0", wave: "—" };
        }
        const sim = run.sim;
        const waveBtn = document.getElementById("btn-wave");
        if (waveBtn) {
            waveBtn.textContent = sim.waveActive
                ? "WAVE " + sim.wave + " INCOMING"
                : sim.wave >= sim.finalWave ? "ALL WAVES DONE"
                    : "START WAVE " + (sim.wave + 1) + "  [Space]";
            waveBtn.classList.toggle("disabled", sim.waveActive || sim.over || sim.wave >= sim.finalWave);
        }

        for (const type of Object.keys(TOWER_TYPES)) {
            const btn = document.getElementById("btn-" + type);
            if (!btn) continue;
            btn.classList.toggle("selected", run.placeType === type);
            btn.classList.toggle("poor", sim.gold < TOWER_TYPES[type].cost);
        }

        refreshTowerPanel(run);

        return {
            gold: String(sim.gold),
            lives: String(sim.lives),
            wave: (sim.wave || "—") + " / " + sim.finalWave,
        };
    },

    gameOverText(run, result) {
        const sim = run && run.sim;
        const won = result ? result.won : (sim && sim.won);
        if (won) {
            return "VICTORY\nAll " + (sim ? sim.finalWave : "") + " waves repelled\n" +
                (sim ? sim.kills : 0) + " creeps slain · " + (sim ? sim.lives : 0) + " lives left";
        }
        return "THE KEEP HAS FALLEN\nSurvived to wave " + (sim ? sim.wave : 0) +
            "\n" + (sim ? sim.kills : 0) + " creeps slain";
    },

    onEnterScreen(name, run) {
        if (name === "gameover" && run && run.sim) {
            const title = document.getElementById("gameover-title");
            if (title) {
                title.textContent = run.sim.won ? "VICTORY" : "THE KEEP HAS FALLEN";
                title.className = "overlay-title " + (run.sim.won ? "victory" : "defeat");
            }
        }
    },

    cue(name, audio) {
        if (name === "wave") audio.tone(300, 0.12, "sawtooth", 0.4);
        else if (name === "clear") audio.tone(720, 0.1, "triangle", 0.4);
        else if (name === "leak") audio.tone(140, 0.15, "square", 0.45);
        else if (name === "refuse") audio.tone(200, 0.06, "square", 0.35);
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
    if (!canvas) throw new Error("gridkeep: #view canvas missing");
    scene = canvas.getContext("scene");
    if (!scene) throw new Error("gridkeep: scene context unavailable");

    scene.setToneMap({ mode: "aces", exposure: 0.98, gamma: 2.2 });
    scene.setAmbient([0.20, 0.21, 0.25]);
    scene.createLight({
        type: "directional",
        direction: [-0.55, -1.0, -0.30],
        color: [1.0, 0.96, 0.87],
        intensity: 2.05,
    });
    window.addEventListener("resize", () => {
        if (G && G.sim) frameCamera(G.sim.world);
    });
}

function frameCamera(world) {
    if (!scene || !canvas || !world) return;
    const b = world.worldBounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const diag = Math.hypot(spanX, spanZ);
    const size = Math.max(spanZ * 0.78 + 2.0, (diag * 0.78 + 1.5) / aspect);
    scene.setCamera({
        mode: "orthographic",
        size, aspect, near: 0.1, far: 200,
        position: [cx + 14, 15, cz + 14],
        target: [cx, 0, cz],
    });
}

// ── Tints ──────────────────────────────────────────────────────────────────

function desiredTints(run) {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + "," + y, rgb);
    };
    const world = run.sim.world;
    if (run.selectedTower) {
        for (const c of world.cellsInRange(run.selectedTower.x, run.selectedTower.y,
            run.sim.towerRange(run.selectedTower), "vertex"))
            put(c.x, c.y, [0.75, 0.92, 1.45]);
        put(run.selectedTower.x, run.selectedTower.y, [1.5, 1.4, 0.7]);
    } else if (run.placeType && run.hoverCell) {
        const def = TOWER_TYPES[run.placeType];
        const elev = world.getTile(run.hoverCell.x, run.hoverCell.y, 0) === TILE.EGRASS;
        const range = def.range + (elev ? 1 : 0);
        for (const c of world.cellsInRange(run.hoverCell.x, run.hoverCell.y, range, "vertex"))
            put(c.x, c.y, [0.82, 0.95, 1.35]);
        put(run.hoverCell.x, run.hoverCell.y,
            run.hoverPlaceable ? [0.55, 1.55, 0.6] : [1.8, 0.45, 0.45]);
    }
    for (const e of run.effects)
        for (const c of e.cells) put(c.x, c.y, e.color);
    return want;
}

function applyTints(run) {
    const world = run.sim.world;
    const want = desiredTints(run);
    let dirty = false;
    for (const key of run.applied.keys()) {
        if (!want.has(key)) {
            const [x, y] = key.split(",").map(Number);
            world.setTint(x, y, 1, 1, 1, 1);
            run.applied.delete(key);
            dirty = true;
        }
    }
    for (const [key, rgb] of want) {
        const cur = run.applied.get(key);
        if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
        const [x, y] = key.split(",").map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        run.applied.set(key, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

function flashCells(run, cells, color, durSec) {
    run.effects.push({ cells, color, until: run.sim.time + durSec });
    applyTints(run);
}

// ── Render sync ────────────────────────────────────────────────────────────

function syncRender(run) {
    const sim = run.sim;
    const world = sim.world;
    const K = sim.kinds;
    const groundY = 0;

    for (const type of Object.keys(TOWER_TYPES)) world.clearObjects(K[type]);
    for (const t of sim.towers) {
        const base = TOWER_COLOR[t.type], acc = LEVEL_ACCENT[t.level];
        world.addObject(K[t.type], t.x, t.y, {
            yaw: t.yaw,
            scale: 1 + 0.13 * (t.level - 1),
            color: [base[0] * acc[0], base[1] * acc[1], base[2] * acc[2], 1],
        });
    }

    for (const kn of ["normal", "fast", "tank"]) world.clearObjects(K[kn]);
    for (const c of sim.creeps) {
        const cx = Math.round(c.px), cy = Math.round(c.py);
        const col = [...CREEP_COLOR[c.type]];
        if (sim.isSlowed(c)) { col[0] *= 0.45; col[1] *= 0.75; col[2] = Math.min(1, col[2] * 1.6 + 0.3); }
        if (c.hitFlash > 0) { col[0] = Math.min(1.6, col[0] + 0.9); col[1] += 0.5; col[2] += 0.5; }
        world.addObject(K[c.type], cx, cy, {
            yaw: c.yaw,
            scale: c.def.scale,
            offsetX: c.px - cx,
            offsetZ: c.py - cy,
            color: col,
        });
    }

    for (const kn of ["projArrow", "projCannon", "projFrost"]) world.clearObjects(K[kn]);
    const PK = { arrow: K.projArrow, cannon: K.projCannon, frost: K.projFrost };
    for (const p of sim.projectiles) {
        const cx = Math.round(p.x), cy = Math.round(p.y);
        if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) continue;
        const cellTop = world.getElevation(cx, cy) * HSTEP;
        world.addObject(PK[p.kind], cx, cy, {
            yaw: p.yaw,
            offsetX: p.x - cx,
            offsetZ: p.y - cy,
            yOffset: Math.max(0.05, groundY + p.h - cellTop),
        });
    }

    world.rebuildObjects();

    const seen = new Set();
    for (const c of sim.creeps) {
        if (c.hp >= c.maxHp) continue;
        seen.add(c.id);
        const frac = c.hp / c.maxHp;
        const fill = frac > 0.6 ? "#46d24a" : frac > 0.3 ? "#e6c33c" : "#e04430";
        const anchor = [run.cellWorldX(c.px), groundY + 0.62 * c.def.scale + 0.18, run.cellWorldZ(c.py)];
        let bar = run.hpBars.get(c.id);
        if (!bar) {
            bar = scene.createShape({
                shape: "rect", width: 0.6, height: 0.075,
                fill, worldAnchor: anchor, billboard: "full",
            });
            run.hpBars.set(c.id, bar);
        }
        bar.worldAnchor = anchor;
        bar.width = Math.max(0.05, 0.6 * frac * c.def.scale);
        bar.fillColor = fill;
    }
    for (const [id, bar] of run.hpBars) {
        if (!seen.has(id)) { bar.destroy(); run.hpBars.delete(id); }
    }
}

// ── HUD / UI ───────────────────────────────────────────────────────────────

function toast(run, msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.display = "";
    if (run.toastTimer) clearTimeout(run.toastTimer);
    run.toastTimer = setTimeout(() => { t.style.display = "none"; }, 1800);
}

function announce(msg) {
    const a = document.getElementById("announce");
    if (!a) return;
    a.textContent = msg;
    a.style.display = "";
    a.classList.remove("pop");
    void a.offsetWidth;
    a.classList.add("pop");
    setTimeout(() => { a.style.display = "none"; }, 2400);
}

function refreshTowerPanel(run) {
    const panel = document.getElementById("tower-panel");
    if (!panel) return;
    if (!run.selectedTower) {
        panel.style.display = "none";
        return;
    }
    const t = run.selectedTower, def = TOWER_TYPES[t.type], sim = run.sim;
    const name = document.getElementById("tp-name");
    const stats = document.getElementById("tp-stats");
    if (name) {
        name.textContent = def.name + " Tower  ·  L" + t.level +
            (t.elevated ? "  (hilltop +1 range)" : "");
    }
    if (stats) {
        stats.textContent =
            "DMG " + sim.towerDamage(t) +
            "  ·  RANGE " + sim.towerRange(t) +
            "  ·  RATE " + (1 / sim.towerCooldown(t)).toFixed(1) + "/s" +
            (def.splash ? "  ·  SPLASH" : "") + (def.slow ? "  ·  SLOWS" : "");
    }
    const up = document.getElementById("btn-upgrade");
    if (up) {
        if (t.level >= MAX_LEVEL) {
            up.textContent = "MAX LEVEL";
            up.classList.add("disabled");
        } else {
            up.textContent = "UPGRADE  (" + upgradeCost(t) + "g)";
            up.classList.toggle("disabled", sim.gold < upgradeCost(t));
        }
    }
    const sell = document.getElementById("btn-sell");
    if (sell) sell.textContent = "SELL  (+" + sim.sellRefund(t) + "g)";
    panel.style.display = "";
}

// ── Input ──────────────────────────────────────────────────────────────────

function setPlaceType(run, type) {
    run.placeType = (run.placeType === type) ? null : type;
    run.selectedTower = null;
    refreshHover(run, run.hoverCell ? run.hoverCell.x : -99, run.hoverCell ? run.hoverCell.y : -99, true);
    applyTints(run);
}

function pickCell(e) {
    const rect = canvas.getBoundingClientRect();
    const ray = scene.unprojectLocal(e.clientX - rect.left, e.clientY - rect.top);
    if (!ray || !G) return null;
    const hit = G.sim.world.raycastCell(ray.origin, ray.dir, 500);
    return hit ? { x: hit.x, y: hit.y } : null;
}

function refreshHover(run, x, y, force) {
    if (!force && run.hoverCell && run.hoverCell.x === x && run.hoverCell.y === y) return;
    run.hoverCell = (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) ? { x, y } : null;
    if (run.hoverCell && run.placeType)
        run.hoverPlaceable = run.sim.canPlace(run.placeType, run.hoverCell.x, run.hoverCell.y).ok;
    applyTints(run);
}

function actOnCell(run, x, y) {
    if (run.sim.over) return;
    const t = run.sim.towerAt(x, y);
    if (t) {
        run.selectedTower = (run.selectedTower === t) ? null : t;
        run.placeType = null;
        applyTints(run);
        return;
    }
    if (run.placeType) {
        const placed = run.sim.placeTower(run.placeType, x, y);
        if (placed) {
            refreshHover(run, x, y, true);
            applyTints(run);
        }
        return;
    }
    if (run.selectedTower) {
        run.selectedTower = null;
        applyTints(run);
    }
}

function ensureWiring() {
    if (wired) return;
    wired = true;
    ensureScene();

    canvas.addEventListener("mousemove", (e) => {
        if (!G) return;
        const c = pickCell(e);
        if (c) refreshHover(G, c.x, c.y, false);
        else if (G.hoverCell) { G.hoverCell = null; applyTints(G); }
    });
    canvas.addEventListener("mousedown", (e) => {
        if (!G) return;
        if (e.button === 2) {
            G.placeType = null; G.selectedTower = null;
            applyTints(G);
            return;
        }
        if (e.button !== 0) return;
        const c = pickCell(e);
        if (!c) return;
        actOnCell(G, c.x, c.y);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    for (const type of Object.keys(TOWER_TYPES)) {
        const btn = document.getElementById("btn-" + type);
        if (btn) btn.addEventListener("click", () => { if (G) setPlaceType(G, type); });
    }
    const waveBtn = document.getElementById("btn-wave");
    if (waveBtn) waveBtn.addEventListener("click", () => { if (G) G.sim.startNextWave(); });
    const upBtn = document.getElementById("btn-upgrade");
    if (upBtn) upBtn.addEventListener("click", () => {
        if (G && G.selectedTower) G.sim.upgradeTower(G.selectedTower);
    });
    const sellBtn = document.getElementById("btn-sell");
    if (sellBtn) sellBtn.addEventListener("click", () => {
        if (G && G.selectedTower) {
            G.sim.sellTower(G.selectedTower);
            G.selectedTower = null;
            applyTints(G);
        }
    });
}

// ── Debug ──────────────────────────────────────────────────────────────────

function projectCell(x, y) {
    if (!G || !scene) return { x: 0, y: 0 };
    const world = G.sim.world;
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
    window.GRIDKEEP = {
        game: run.sim,
        world: run.sim.world,
        scene,
        projectCell,
        actOnCell: (x, y) => actOnCell(run, x, y),
        setPlaceType: (type) => setPlaceType(run, type),
        get placeType() { return run.placeType; },
        get selectedTower() { return run.selectedTower; },
        TILE, TOWER_TYPES, CREEP_TYPES, SPAWNS, BASE,
        FLAG_BLOCK, FLAG_NOBUILD, FLAG_TOWER, MAP_W, MAP_H,
        debug: {
            addGold(n) { run.sim.gold += n; },
            setLives(n) { run.sim.lives = n; },
            setWave(n) { run.sim.wave = n; },
            spawnCreep(type, x, y, opts) { return run.sim.spawnCreep(type, x, y, opts); },
            killAll() { for (const c of [...run.sim.creeps]) run.sim.damageCreep(c, 1e9); },
            freeze(on) { run.sim.frozen = !!on; },
        },
    };
}
