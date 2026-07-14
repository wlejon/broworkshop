// DeepDelve — arcade plugin (scene, camera, FOV tints, HUD).
// Domain rules: sim.js. Shell owns menus / pause / high score.

import {
    MAP_W, MAP_H, FLOORS, HSTEP, FOV_R,
    TILE, FLAG, MONSTERS, PLAYER_BASE,
    createGame, blobVariantMasks,
} from "/app/sim.js";

// ── Scene state (lazy; built on first create / test ensure) ──────────────

/** @type {HTMLCanvasElement|null} */
let viewCanvas = null;
/** @type {object|null} */
let scene = null;
/** @type {object|null} */
let torch = null;
/** @type {object|null} */
let core = null; // createGame instance (persists across restarts)
let wiredHud = false;

const applied = new Map();
let effects = [];
let effectsDirty = false;
let nowMs = 0;
let playerYaw = Math.PI;
const cam = { x: 0, z: 0, init: false };
const vis = { player: { x: 0, y: 0 }, monsters: new Map() };
const hpBars = new Map();

const TINT_UNSEEN = [0.03, 0.03, 0.05];
const TINT_REMEMBERED = [0.16, 0.17, 0.25];
const TINT_VISIBLE = [1, 1, 1];

const MONSTER_KIND = { rat: "rat", wolf: "wolf", archer: "archer", ogre: "ogre", boss: "ogre" };
const MONSTER_COLOR = {
    rat: [0.62, 0.45, 0.32, 1],
    wolf: [0.58, 0.60, 0.66, 1],
    archer: [0.88, 0.87, 0.78, 1],
    ogre: [0.45, 0.62, 0.34, 1],
    boss: [0.82, 0.20, 0.18, 1],
};
const MONSTER_SCALE = { rat: 0.9, wolf: 1.0, archer: 1.0, ogre: 1.25, boss: 1.8 };
const ITEM_KIND = { potion: "potion", gold: "gold", weapon: "weapon", armor: "armor", amulet: "amulet" };

const DIR_ACTIONS = [
    ["up", 0, -1],
    ["down", 0, 1],
    ["left", -1, 0],
    ["right", 1, 0],
];

function el(id) {
    return document.getElementById(id);
}

// ── Scene bootstrap ──────────────────────────────────────────────────────

function ensureScene() {
    if (scene) return;
    viewCanvas = document.getElementById("view") || document.querySelector("canvas");
    if (!viewCanvas) throw new Error("deepdelve: #view canvas missing");
    scene = viewCanvas.getContext("scene");
    if (!scene) throw new Error("deepdelve: scene context unavailable");

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        if (viewCanvas.width !== w) viewCanvas.width = w;
        if (viewCanvas.height !== h) viewCanvas.height = h;
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    scene.setToneMap({ mode: "aces", exposure: 1.06, gamma: 2.2 });
    scene.setAmbient([0.14, 0.15, 0.20]);
    scene.createLight({
        type: "directional",
        direction: [-0.35, -1.0, -0.22],
        color: [0.62, 0.68, 0.85],
        intensity: 0.85,
    });
    torch = scene.createLight({
        type: "point", position: [0, 2, 0],
        color: [1.0, 0.72, 0.42], intensity: 2.6, range: 9.5,
    });
}

// ── FOV tints / combat flash ─────────────────────────────────────────────

function cellHelpers(world) {
    const C00 = world.cellCenterWorldXZ(0, 0);
    const C10 = world.cellCenterWorldXZ(1, 0);
    const C01 = world.cellCenterWorldXZ(0, 1);
    const DX = C10.x - C00.x, DZ = C01.z - C00.z;
    return {
        cellWorldX: (px) => C00.x + px * DX,
        cellWorldZ: (py) => C00.z + py * DZ,
        cellTopY: (x, y) => world.getElevation(Math.round(x), Math.round(y)) * HSTEP,
    };
}

function applyTints(force) {
    if (!core) return;
    if (!force && !core.fogDirty && !effectsDirty) return;
    const world = core.world;
    const effTint = new Map();
    for (const e of effects)
        for (const c of e.cells) effTint.set(c.y * MAP_W + c.x, e.color);
    let dirty = false;
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            const i = y * MAP_W + x;
            let rgb = effTint.get(i);
            if (!rgb) {
                const f = core.fog[i];
                rgb = f === 2 ? TINT_VISIBLE : f === 1 ? TINT_REMEMBERED : TINT_UNSEEN;
            }
            const cur = applied.get(i);
            if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
            world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
            applied.set(i, rgb);
            dirty = true;
        }
    }
    core.fogDirty = false;
    effectsDirty = false;
    if (dirty) world.rebuild();
}

function flashCells(cells, color, durMs) {
    effects.push({ cells, color, until: nowMs + durMs });
    effectsDirty = true;
}

function wireCoreCallbacks() {
    if (!core) return;
    core.onShot = (line) => flashCells(line, [1.0, 0.78, 0.38], 160);
    core.onFullRedraw = () => { applied.clear(); applyTints(true); };
    core.onLog = renderLog;
    core.onHurt = () => {
        const v = el("vignette");
        if (!v) return;
        v.classList.remove("hit");
        void v.offsetWidth;
        v.classList.add("hit");
    };
    core.onDescend = (floor) => announce("FLOOR " + floor + (floor === FLOORS ? " ΓÇö THE DEEPEST DARK" : ""));
    core.onGameOver = () => { /* shell ends run via update status */ };
}

function announce(msg) {
    const a = el("announce");
    if (!a) return;
    a.textContent = msg;
    a.style.display = "";
    a.classList.remove("pop");
    void a.offsetWidth;
    a.classList.add("pop");
    setTimeout(() => { a.style.display = "none"; }, 2200);
}

function renderLog() {
    if (!core) return;
    const box = el("log");
    if (!box) return;
    box.innerHTML = "";
    for (const m of core.msgs.slice(-7)) {
        const d = document.createElement("div");
        d.className = "log-line " + (m.cls || "");
        d.textContent = m.text;
        box.appendChild(d);
    }
}

// ── Camera / entity lerp ─────────────────────────────────────────────────

function updateCamera(dtSec, helpers) {
    const px = helpers.cellWorldX(vis.player.x), pz = helpers.cellWorldZ(vis.player.y);
    if (!cam.init) { cam.x = px; cam.z = pz; cam.init = true; }
    const k = 1 - Math.pow(0.0022, dtSec);
    cam.x += (px - cam.x) * k;
    cam.z += (pz - cam.z) * k;
    const rect = viewCanvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const py = helpers.cellTopY(core.player.x, core.player.y);
    scene.setCamera({
        fov: 46, aspect, near: 0.1, far: 120,
        position: [cam.x, py + 9.6, cam.z + 6.4],
        target: [cam.x, py, cam.z - 0.4],
    });
}

function lerpVis(dtSec) {
    const rate = Math.min(1, dtSec * 11);
    const p = core.player;
    vis.player.x += (p.x - vis.player.x) * rate;
    vis.player.y += (p.y - vis.player.y) * rate;
    if (Math.abs(p.x - vis.player.x) > 1.6 || Math.abs(p.y - vis.player.y) > 1.6) {
        vis.player.x = p.x; vis.player.y = p.y;
    }
    const seen = new Set();
    for (const m of core.monsters) {
        seen.add(m.id);
        let v = vis.monsters.get(m.id);
        if (!v) { v = { x: m.x, y: m.y, yaw: 0 }; vis.monsters.set(m.id, v); }
        const dx = m.x - v.x, dy = m.y - v.y;
        if (Math.abs(dx) > 1.6 || Math.abs(dy) > 1.6) { v.x = m.x; v.y = m.y; }
        else { v.x += dx * rate; v.y += dy * rate; }
        if (dx * dx + dy * dy > 0.0001) v.yaw = Math.atan2(dx, dy);
    }
    for (const id of vis.monsters.keys()) if (!seen.has(id)) vis.monsters.delete(id);
}

function fogAt(x, y) {
    return core.fog[y * MAP_W + x];
}

// ── Place 3D objects from domain state ───────────────────────────────────

function syncRender(helpers) {
    const world = core.world;
    const K = core.kinds;
    for (const kn of Object.keys(K)) world.clearObjects(K[kn]);

    {
        const cx = Math.round(vis.player.x), cy = Math.round(vis.player.y);
        world.addObject(K.player, cx, cy, {
            yaw: playerYaw,
            offsetX: vis.player.x - cx, offsetZ: vis.player.y - cy,
            color: [0.55, 0.72, 1.0, 1],
        });
    }

    for (const m of core.monsters) {
        const v = vis.monsters.get(m.id);
        if (!v) continue;
        const cx = Math.round(v.x), cy = Math.round(v.y);
        if (fogAt(cx, cy) !== 2) continue;
        world.addObject(K[MONSTER_KIND[m.type]], cx, cy, {
            yaw: v.yaw, scale: MONSTER_SCALE[m.type],
            offsetX: v.x - cx, offsetZ: v.y - cy,
            color: MONSTER_COLOR[m.type],
        });
    }

    for (const it of core.items) {
        const f = fogAt(it.x, it.y);
        if (f === 0) continue;
        const dim = f === 2 ? 1 : 0.32;
        const bob = it.kind === "amulet" ? Math.sin(nowMs * 0.003) * 0.06 + 0.06 : 0;
        world.addObject(K[ITEM_KIND[it.kind]], it.x, it.y, {
            yaw: (it.x * 7 + it.y * 13) % 6.28,
            yOffset: bob,
            color: [dim, dim, dim, 1],
        });
    }

    for (const d of core.doors) {
        if (d.open) continue;
        const f = fogAt(d.x, d.y);
        if (f === 0) continue;
        const dim = f === 2 ? 1 : 0.32;
        world.addObject(K.door, d.x, d.y, {
            yaw: d.orient === 0 ? 0 : Math.PI / 2,
            color: [dim, dim, dim, 1],
        });
    }
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            if (world.getTile(x, y, 0) !== TILE.TRAPR) continue;
            const f = fogAt(x, y);
            if (f === 0) continue;
            const armed = world.hasFlag(x, y, FLAG.TRAP);
            const dim = f === 2 ? 1 : 0.32;
            world.addObject(K.spikes, x, y, {
                yaw: (x * 5 + y * 3) % 6.28, scale: armed ? 0.7 : 1.0,
                color: armed ? [dim, dim * 0.6, dim * 0.6, 1] : [dim, dim, dim, 1],
            });
        }
    }
    for (const d of core.decor) {
        const f = fogAt(d.x, d.y);
        if (f === 0) continue;
        const dim = f === 2 ? 1 : 0.32;
        const glow = d.kind === "mushroom" && f === 2 ? 1.5 : 1;
        world.addObject(K[d.kind], d.x, d.y, {
            yaw: d.yaw, scale: d.scale,
            offsetX: d.ox, offsetZ: d.oz,
            color: [dim * glow, dim * glow, dim * glow, 1],
        });
    }

    world.rebuildObjects();

    const seen = new Set();
    for (const m of core.monsters) {
        const def = MONSTERS[m.type];
        const v = vis.monsters.get(m.id);
        if (!v || m.hp >= def.hp) continue;
        const cx = Math.round(v.x), cy = Math.round(v.y);
        if (fogAt(cx, cy) !== 2) continue;
        seen.add(m.id);
        const frac = Math.max(0, m.hp / def.hp);
        const fill = frac > 0.6 ? "#46d24a" : frac > 0.3 ? "#e6c33c" : "#e04430";
        const anchor = [
            helpers.cellWorldX(v.x),
            helpers.cellTopY(v.x, v.y) + 0.75 * MONSTER_SCALE[m.type],
            helpers.cellWorldZ(v.y),
        ];
        let bar = hpBars.get(m.id);
        if (!bar) {
            bar = scene.createShape({
                shape: "rect", width: 0.55, height: 0.07,
                fill, worldAnchor: anchor, billboard: "full",
            });
            hpBars.set(m.id, bar);
        }
        bar.worldAnchor = anchor;
        bar.width = Math.max(0.05, 0.55 * frac);
        bar.fillColor = fill;
    }
    for (const [id, bar] of hpBars)
        if (!seen.has(id)) { bar.destroy(); hpBars.delete(id); }
}

// ── Actions / HUD wiring ─────────────────────────────────────────────────

function resetVisuals() {
    for (const [, bar] of hpBars) bar.destroy();
    hpBars.clear();
    vis.monsters.clear();
    if (core) {
        vis.player.x = core.player.x;
        vis.player.y = core.player.y;
    }
    cam.init = false;
    applied.clear();
    effects = [];
    effectsDirty = true;
    playerYaw = Math.PI;
}

function scoreOf(g) {
    if (!g) return 0;
    return g.kills * 100 + g.goldTotal + g.floor * 50 + (g.won ? 1000 : 0);
}

function doMove(dx, dy) {
    if (!core || core.over) return;
    if (dx > 0) playerYaw = Math.PI / 2;
    else if (dx < 0) playerYaw = -Math.PI / 2;
    else if (dy > 0) playerYaw = Math.PI;
    else playerYaw = 0;
    core.playerAct({ type: "move", dx, dy });
    applyTints(false);
    renderLog();
}

function wireHudButtons(run) {
    if (wiredHud) return;
    wiredHud = true;
    const potion = el("btn-potion");
    if (potion) {
        potion.addEventListener("click", () => {
            if (!core || core.over) return;
            core.playerAct({ type: "potion" });
            applyTints(false);
            renderLog();
        });
    }
    const saveBtn = el("btn-save");
    if (saveBtn) {
        saveBtn.addEventListener("click", () => {
            if (!core) return;
            core.saveRun();
            renderLog();
        });
    }
    const loadBtn = el("btn-load");
    if (loadBtn) {
        loadBtn.addEventListener("click", () => {
            if (!core) return;
            if (core.loadRun()) {
                resetVisuals();
                applyTints(true);
                renderLog();
            } else {
                renderLog();
            }
        });
    }
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

    defaults: {
        highScore: 0,
    },

    create(ctx) {
        ensureScene();
        if (!core) {
            core = createGame(scene, (Math.random() * 0xFFFFFFFF) >>> 0);
            wireCoreCallbacks();
        } else {
            for (const [, bar] of hpBars) bar.destroy();
            hpBars.clear();
            core.newRun((Math.random() * 0xFFFFFFFF) >>> 0);
        }
        resetVisuals();
        applyTints(true);
        renderLog();
        wireHudButtons();

        const run = {
            score: 0,
            play: ctx.play,
            save: ctx.save,
            highScore: ctx.highScore,
            heldDir: null,
            heldName: null,
            repeatAt: 0,
            ended: false,
        };
        run.score = scoreOf(core);
        return run;
    },

    update(run, dt, input) {
        if (!core) return;
        nowMs = performance.now();
        const dtSec = dt / 1000;
        const helpers = cellHelpers(core.world);

        if (run.ended || core.over) {
            if (!run.ended) {
                run.ended = true;
                run.score = scoreOf(core);
                run.save.maybeHighScore(run.score);
                run.save.save();
                run.play(core.won ? "win" : "die");
            }
            return { status: "gameover" };
        }

        // Direction edges + held auto-repeat
        for (const [name, dx, dy] of DIR_ACTIONS) {
            if (input.pressed(name)) {
                run.heldDir = [dx, dy];
                run.heldName = name;
                run.repeatAt = nowMs + 230;
                doMove(dx, dy);
            }
        }
        for (const [name] of DIR_ACTIONS) {
            if (run.heldName === name && !input.down(name)) {
                run.heldDir = null;
                run.heldName = null;
            }
        }
        if (run.heldDir && nowMs >= run.repeatAt) {
            run.repeatAt = nowMs + 120;
            doMove(run.heldDir[0], run.heldDir[1]);
        }

        if (input.pressed("primary")) {
            core.playerAct({ type: "wait" });
            applyTints(false);
            renderLog();
        }
        if (input.pressed("potion")) {
            core.playerAct({ type: "potion" });
            applyTints(false);
            renderLog();
        }
        if (input.pressed("search")) {
            core.playerAct({ type: "search" });
            applyTints(false);
            renderLog();
        }
        if (input.pressed("save")) {
            core.saveRun();
            renderLog();
        }
        if (input.pressed("load")) {
            if (core.loadRun()) {
                resetVisuals();
                applyTints(true);
            }
            renderLog();
        }

        if (core.over) {
            run.ended = true;
            run.score = scoreOf(core);
            run.save.maybeHighScore(run.score);
            run.save.save();
            run.play(core.won ? "win" : "die");
            return { status: "gameover" };
        }

        if (effects.length) {
            const n = effects.length;
            effects = effects.filter((e) => e.until > nowMs);
            if (effects.length !== n) effectsDirty = true;
        }

        core.world.advance(dt);
        applyTints(false);
        lerpVis(dtSec);
        updateCamera(dtSec, helpers);

        const ty = helpers.cellTopY(core.player.x, core.player.y);
        torch.position = [
            helpers.cellWorldX(vis.player.x),
            ty + 1.5,
            helpers.cellWorldZ(vis.player.y),
        ];
        torch.intensity = 2.6 + Math.sin(nowMs * 0.013) * 0.18 + Math.sin(nowMs * 0.037) * 0.12;

        syncRender(helpers);
        run.score = scoreOf(core);
    },

    draw() {
        // Scene is engine-rendered; keep camera/tints fresh if update was skipped.
        if (!core || !scene) return;
        const helpers = cellHelpers(core.world);
        updateCamera(0.016, helpers);
    },

    hud(run) {
        if (!core) {
            return {
                hp: "ΓÇö", atk: "ΓÇö", def: "ΓÇö", gold: "ΓÇö",
                floor: "ΓÇö", turn: "ΓÇö", weapon: "ΓÇö", armor: "ΓÇö", potions: "ΓÇö",
            };
        }
        const p = core.player;
        const frac = p.hp / p.maxHp;
        const fill = el("hp-fill");
        if (fill) {
            fill.style.width = Math.round(frac * 100) + "%";
            fill.style.background = frac > 0.55 ? "#4bd24f" : frac > 0.28 ? "#e6c33c" : "#e04430";
        }
        const potBtn = el("btn-potion");
        if (potBtn) potBtn.classList.toggle("disabled", p.potions <= 0);
        return {
            hp: p.hp + " / " + p.maxHp,
            atk: String(p.atk),
            def: String(p.def),
            gold: String(p.gold),
            floor: core.floor + " / " + FLOORS,
            turn: String(core.turn),
            weapon: p.weapon,
            armor: p.armor,
            potions: String(p.potions),
        };
    },

    gameOverText(run) {
        if (!core) return "";
        const tag = run && run._newBest ? "  ┬╖  NEW BEST" : "";
        return (
            (core.won ? "YOU ESCAPED WITH THE AMULET" : "YOU HAVE DIED") + "\n\n" +
            "Floor     " + core.floor + " of " + FLOORS + "\n" +
            "Slain     " + core.kills + "  ┬╖  Gold  " + core.goldTotal + "\n" +
            "Turns     " + core.turn + "\n" +
            "Score     " + scoreOf(core) + tag
        );
    },

    // Game SFX only ΓÇö menu move/select are shell-owned.
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

// ── Test hooks (window.DELVE) ────────────────────────────────────────────

export function installTestHooks(shell) {
    // Lazy: scene is created on first run (or DELVE.ensure()) so headless
    // --no-gpu can still open the title screen.
    window.DELVE = {
        shell,
        ensure() {
            ensureScene();
            if (!core) {
                core = createGame(scene, (Math.random() * 0xFFFFFFFF) >>> 0);
                wireCoreCallbacks();
                resetVisuals();
                applyTints(true);
                renderLog();
            }
            return this;
        },
        get game() { return core; },
        get world() { return core && core.world; },
        get scene() { return scene; },
        get appliedTints() { return applied; },
        TILE, FLAG, MONSTERS, MAP_W, MAP_H, FOV_R, PLAYER_BASE,
        get blobVariants() { return blobVariantMasks(); },
        debug: {
            newRun(seed) {
                window.DELVE.ensure();
                core.newRun(seed);
                resetVisuals();
                applyTints(true);
                renderLog();
                if (shell.getScreen() !== "playing") shell.startRun();
            },
            teleport(x, y) {
                window.DELVE.ensure();
                core.player.x = x; core.player.y = y;
                core.computeFOV();
                applyTints(false);
                renderLog();
            },
            spawnMonster(type, x, y, opts = {}) {
                window.DELVE.ensure();
                const m = core.spawnMonster(type, x, y);
                if (opts.awake) m.awake = true;
                return m;
            },
            clearMonsters() { core.monsters.length = 0; },
            killMonster(m) {
                m.hp = 0;
                core.monsters.splice(core.monsters.indexOf(m), 1);
            },
            setHP(n) { core.player.hp = n; },
            addPotion(n) { core.player.potions += (n || 1); },
            placeItem(kind, x, y, extra = {}) { core.items.push({ kind, x, y, ...extra }); },
            placeTrap(x, y) { core.world.setFlag(x, y, FLAG.TRAP, true); },
            placeDoor(x, y, orient = 0) {
                core.world.setTile(x, y, TILE.DOOR, 0);
                core.world.setFlag(x, y, FLAG.DOOR, true);
                core.doors.push({ x, y, open: false, orient });
                core.computeFOV();
                applyTints(false);
            },
            setWall(x, y, on) {
                if (on === undefined) on = true;
                core.world.setTile(x, y, on ? TILE.WALL : TILE.FLOOR, 0);
                core.world.setFlag(x, y, FLAG.WALL, on);
                core.world.setFlag(x, y, FLAG.OPEN, !on);
                if (on) core.world.setElevation(x, y, 4);
                else core.world.setElevation(x, y, 0);
                core.computeFOV();
                applyTints(false);
            },
            carve(x0, y0, x1, y1) {
                for (let y = y0; y <= y1; y++) {
                    for (let x = x0; x <= x1; x++) {
                        core.world.setTile(x, y, TILE.FLOOR, 0);
                        core.world.setElevation(x, y, 0);
                        core.world.setFlag(x, y, 0xFF, false);
                        core.world.setFlag(x, y, FLAG.OPEN, true);
                    }
                }
                core.computeFOV();
                applyTints(false);
            },
            descend() {
                core.descend();
                resetVisuals();
                applyTints(true);
                renderLog();
            },
            refresh() { applyTints(false); renderLog(); },
        },
        shell,
    };
}
