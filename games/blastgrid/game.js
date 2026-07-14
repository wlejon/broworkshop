// BlastGrid — arcade plugin (scene, bomb FX, HUD chips).
// Domain rules: sim.js. Shell owns menus / pause / high score.

import {
    MAP_W, MAP_H, TILE, FUSE, FIRE_LINGER,
    FLAG_SOLID, FLAG_SOFT, FLAG_BOMB, FLAG_DANGER,
    BASE_RANGE, BASE_BOMBS, BASE_SPEED, SPEED_STEP, WINS_TARGET,
    SPAWNS, ROSTER, POWER_TYPES,
    createGame,
} from "/app/sim.js";

// ── Scene state (lazy; built on first create / BLAST.ensure) ─────────────

/** @type {HTMLCanvasElement|null} */
let viewCanvas = null;
/** @type {object|null} */
let scene = null;
/** @type {object|null} */
let core = null;
/** @type {object|null} */
let flashLight = null;
let flashT = 0;
const FLASH_DUR = 0.28;
let applied = new Map();
let chipEls = [];
let chipsBuilt = false;
let wiredHud = false;
let toastTimer = 0;

const PU_KIND = {};
const K = {};

function el(id) {
    return document.getElementById(id);
}

// ── Scene bootstrap ──────────────────────────────────────────────────────

function ensureScene() {
    if (scene) return;
    viewCanvas = document.getElementById("view") || document.querySelector("canvas");
    if (!viewCanvas) throw new Error("blastgrid: #view canvas missing");
    scene = viewCanvas.getContext("scene");
    if (!scene) throw new Error("blastgrid: scene context unavailable");

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        if (viewCanvas.width !== w) viewCanvas.width = w;
        if (viewCanvas.height !== h) viewCanvas.height = h;
        frameCamera();
    }
    window.addEventListener("resize", resizeCanvas);

    scene.setToneMap({ mode: "aces", exposure: 1.0, gamma: 2.2 });
    scene.setAmbient([0.22, 0.23, 0.27]);
    scene.createLight({
        type: "directional",
        direction: [-0.45, -1.0, -0.35],
        color: [1.0, 0.96, 0.88],
        intensity: 2.0,
    });
    flashLight = scene.createLight({
        type: "point", position: [0, 1.4, 0],
        color: [1.0, 0.72, 0.38], intensity: 0, range: 7,
    });
    resizeCanvas();
}

function ensureCore() {
    ensureScene();
    if (core) return core;
    core = createGame(scene);
    registerObjectKinds();
    wireCoreCallbacks();
    buildChips();
    frameCamera();
    return core;
}

function registerObjectKinds() {
    const world = core.world;
    K.bomber = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.26, 14, 10).translate(0, 0.30, 0),
            Mesh.sphere(0.16, 12, 8).translate(0, 0.60, 0),
            Mesh.box(0.05, 0.05, 0.05).translate(0, 0.60, 0.16),
            Mesh.box(0.09, 0.06, 0.13).translate(-0.11, 0.05, 0),
            Mesh.box(0.09, 0.06, 0.13).translate(0.11, 0.05, 0),
        ]),
        { color: [1, 1, 1, 1], roughness: 0.75 });
    K.bomb = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.235, 14, 10).translate(0, 0.24, 0),
            Mesh.cylinder(0.045, 0.10, 6).translate(0, 0.50, 0),
        ]),
        { color: [1, 1, 1, 1], roughness: 0.45, metallic: 0.25 });
    K.fire = world.addObjectKind(
        Mesh.merge([
            Mesh.cone(0.32, 0.62, 8, 1, false).translate(0, 0.02, 0),
            Mesh.sphere(0.20, 10, 7).translate(0, 0.14, 0),
        ]),
        { color: [1.0, 0.52, 0.10, 1], roughness: 0.35, castsShadow: false });
    K.pBombs = world.addObjectKind(
        Mesh.merge([
            Mesh.sphere(0.16, 12, 8).translate(0, 0.16, 0),
            Mesh.cylinder(0.035, 0.08, 6).translate(0, 0.36, 0),
        ]),
        { color: [0.30, 0.55, 1.0, 1], roughness: 0.4, metallic: 0.2 });
    K.pRange = world.addObjectKind(
        Mesh.cone(0.17, 0.36, 8, 1, false).translate(0, 0.04, 0),
        { color: [1.0, 0.45, 0.10, 1], roughness: 0.4 });
    K.pSpeed = world.addObjectKind(
        Mesh.torus(0.15, 0.055, 14, 8).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.20, 0),
        { color: [0.15, 0.95, 0.85, 1], roughness: 0.35, metallic: 0.3 });
    PU_KIND.bombs = K.pBombs;
    PU_KIND.range = K.pRange;
    PU_KIND.speed = K.pSpeed;
    world.rebuildObjects();
}

// ── Camera / danger tints ────────────────────────────────────────────────

function frameCamera() {
    if (!core || !scene || !viewCanvas) return;
    const world = core.world;
    const b = world.worldBounds();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rect = viewCanvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const fovDeg = 42, fov = fovDeg * Math.PI / 180;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const distV = (spanZ * 0.60 + 1.8) / Math.tan(fov / 2);
    const distH = (spanX * 0.54 + 1.2) / (Math.tan(fov / 2) * aspect);
    const dist = Math.max(distV, distH);
    const pitch = 58 * Math.PI / 180;
    scene.setCamera({
        fov: fovDeg, aspect, near: 0.1, far: 200,
        position: [cx, Math.sin(pitch) * dist, cz + Math.cos(pitch) * dist],
        target: [cx, 0, cz - 0.4],
    });
}

function desiredTints() {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + "," + y, rgb);
    };
    for (const k of core.dangerSet)
        put(k % MAP_W, (k / MAP_W) | 0, [1.18, 0.94, 0.88]);
    for (const [k, until] of core.fire) {
        const t = Math.round(Math.max(0, Math.min(1, (until - core.time) / FIRE_LINGER)) * 5) / 5;
        put(k % MAP_W, (k / MAP_W) | 0, [1 + 1.25 * t, 1 + 0.32 * t, 1 - 0.55 * t]);
    }
    if (core.sd.active) {
        const n = core.nextSdCell();
        if (n && Math.floor(core.time * 4) % 2 === 0) put(n.x, n.y, [1.9, 0.5, 0.5]);
    }
    return want;
}

function applyTints() {
    const world = core.world;
    const want = desiredTints();
    let dirty = false;
    for (const key of applied.keys()) {
        if (!want.has(key)) {
            const [x, y] = key.split(",").map(Number);
            world.setTint(x, y, 1, 1, 1, 1);
            applied.delete(key);
            dirty = true;
        }
    }
    for (const [key, rgb] of want) {
        const cur = applied.get(key);
        if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
        const [x, y] = key.split(",").map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        applied.set(key, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

// ── Place 3D objects from domain state ───────────────────────────────────

function syncRender() {
    const world = core.world;
    world.clearObjects(K.bomber);
    for (const e of core.contenders) {
        if (!e.alive) continue;
        const cx = Math.round(e.px), cy = Math.round(e.py);
        const bob = e.moving ? Math.abs(Math.sin(core.time * 11 + e.i)) * 0.05 : 0;
        world.addObject(K.bomber, cx, cy, {
            yaw: e.facing,
            offsetX: e.px - cx, offsetZ: e.py - cy,
            yOffset: bob,
            color: e.color,
        });
    }

    world.clearObjects(K.bomb);
    for (const b of core.bombs) {
        const t = 1 - Math.max(0, b.fuse) / FUSE;
        const pulse = 1 + 0.08 * Math.sin(core.time * (6 + t * 14));
        const red = Math.max(0, (t - 0.55) / 0.45);
        world.addObject(K.bomb, b.x, b.y, {
            scale: pulse,
            color: [0.14 + 0.9 * red, 0.14, 0.17, 1],
        });
    }

    world.clearObjects(K.fire);
    for (const [k, until] of core.fire) {
        const x = k % MAP_W, y = (k / MAP_W) | 0;
        const t = Math.max(0, Math.min(1, (until - core.time) / FIRE_LINGER));
        const jig = 1 + 0.10 * Math.sin(core.time * 40 + x * 3.1 + y * 7.3);
        world.addObject(K.fire, x, y, {
            scale: (0.35 + 0.95 * t) * jig,
            yaw: (x * 5 + y * 11) % 6.28,
            color: [1, 0.65 + 0.35 * t, 0.35 * t, 1],
        });
    }

    for (const kn of POWER_TYPES) world.clearObjects(PU_KIND[kn]);
    for (const p of core.powerups) {
        world.addObject(PU_KIND[p.type], p.x, p.y, {
            yaw: core.time * 2.6,
            scale: 1.35,
            yOffset: 0.10 + Math.sin(core.time * 3.0 + p.x + p.y) * 0.05,
        });
    }

    world.rebuildObjects();

    if (flashT > 0) {
        flashLight.intensity = 30 * (flashT / FLASH_DUR);
    } else if (flashLight.intensity !== 0) {
        flashLight.intensity = 0;
    }
}

// ── Domain → DOM / FX ────────────────────────────────────────────────────

function wireCoreCallbacks() {
    core.onBlast = (blast) => {
        const c = blast.centers[0];
        const w = core.world.cellCenterWorldXZ(c.x, c.y);
        flashLight.position = [w.x, 1.4, w.z];
        flashT = FLASH_DUR;
    };
    core.onArenaReset = () => {
        applied = new Map();
    };
    core.onSuddenDeath = () => announce("SUDDEN DEATH ΓÇö THE WALLS CLOSE IN");
    core.onPickup = (e, type) => {
        if (e !== core.human) return;
        const label = { bombs: "+1 BOMB", range: "+1 RANGE", speed: "+SPEED" }[type];
        const t = el("toast");
        if (!t) return;
        t.textContent = label;
        t.style.display = "";
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.style.display = "none"; }, 1200);
    };
}

function announce(msg) {
    const a = el("announce");
    if (!a) return;
    a.textContent = msg;
    a.style.display = "";
    a.classList.remove("pop");
    void a.offsetWidth;
    a.classList.add("pop");
    setTimeout(() => { a.style.display = "none"; }, 2400);
}

function fmtTime(s) {
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
}

function buildChips() {
    if (chipsBuilt || !core) return;
    const bar = el("hud-chips") || el("chips");
    if (!bar) return;
    chipsBuilt = true;
    chipEls = [];
    bar.innerHTML = "";
    for (const e of core.contenders) {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.id = "chip-" + e.i;
        const [r, g, b] = e.color;
        chip.innerHTML =
            '<span class="dot" style="background: rgb(' +
            Math.round(r * 255) + "," + Math.round(g * 255) + "," + Math.round(b * 255) +
            ')"></span><span class="cname">' + e.name +
            '</span><span class="cwins" id="chip-wins-' + e.i + '"></span>';
        bar.appendChild(chip);
        chipEls.push(chip);
    }
}

function refreshChipWins() {
    if (!core) return;
    for (const e of core.contenders) {
        const chip = chipEls[e.i];
        if (!chip) continue;
        chip.classList.toggle("dead", !e.alive);
        const w = chip.querySelector(".cwins");
        if (w) {
            w.textContent =
                "Γÿà".repeat(e.wins) + "┬╖".repeat(Math.max(0, WINS_TARGET - e.wins));
        }
    }
}

function resetMatch() {
    ensureCore();
    for (const e of core.contenders) e.wins = 0;
    core.round = 1;
    core.state = "matchover";
    core.proceed();
    applied = new Map();
    flashT = 0;
    frameCamera();
}

function fillRoundScreen() {
    if (!core) return;
    const w = core.winner;
    const title = el("round-title");
    const sub = el("round-sub");
    if (title) {
        title.textContent = w ? w.name + " WINS THE ROUND" : "DRAW";
        if (w) {
            const [r, g, b] = w.color;
            title.style.color = "rgb(" + Math.round(r * 255) + "," +
                Math.round(g * 255) + "," + Math.round(b * 255) + ")";
        } else {
            title.style.color = "";
        }
    }
    if (sub) {
        sub.textContent = "First to " + WINS_TARGET + "  ┬╖  Round " + core.round;
    }
}

// ── Plugin ───────────────────────────────────────────────────────────────

export const game = {
    id: "blastgrid",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Drop Bomb", defaults: [" "] },
    ],

    defaults: {
        highScore: 0,
    },

    create(ctx) {
        ensureCore();
        buildChips();
        resetMatch();

        const run = {
            score: 0,
            play: ctx.play,
            save: ctx.save,
            highScore: ctx.highScore,
            held: { up: false, down: false, left: false, right: false },
            roundPending: false,
            ended: false,
        };
        run.score = core.human.wins;
        return run;
    },

    update(run, dt, input) {
        if (!core) return;
        const dtSec = dt / 1000;

        if (run.ended) {
            return { status: "gameover" };
        }

        // Sync held directions into domain
        for (const d of ["up", "down", "left", "right"]) {
            const now = input.down(d);
            if (now && !run.held[d]) core.pressDir(d);
            if (!now && run.held[d]) core.releaseDir(d);
            run.held[d] = now;
        }
        if (input.pressed("primary")) {
            core.dropBomb();
            run.play("bomb");
        }

        if (core.state === "playing") {
            core.update(dtSec);
            flashT = Math.max(0, flashT - dtSec);
            applyTints();
            syncRender();
            run.score = core.human.wins;

            if (core.state === "roundover") {
                run.roundPending = true;
                run.play("round");
                fillRoundScreen();
                return { status: "screen", name: "roundover" };
            }
            if (core.state === "matchover") {
                run.ended = true;
                run.score = core.human.wins;
                run.save.maybeHighScore(run.score);
                run.save.save();
                run.play(core.winner === core.human ? "win" : "lose");
                return { status: "gameover" };
            }
        }
    },

    draw() {
        if (!core || !scene) return;
        frameCamera();
    },

    hud(run) {
        if (!core) {
            return { timer: "ΓÇö", round: "ΓÇö", powers: "ΓÇö" };
        }
        refreshChipWins();
        const h = core.human;
        let timer;
        const timerEl = el("hud-timer");
        if (core.sd.active) {
            timer = "SUDDEN DEATH";
            if (timerEl) timerEl.className = "sudden";
        } else {
            timer = fmtTime(core.timeLeft);
            if (timerEl) timerEl.className = core.timeLeft <= 30 ? "low" : "";
        }
        return {
            timer,
            round: "ROUND " + core.round + " ┬╖ FIRST TO " + WINS_TARGET,
            powers:
                "BOMBS " + h.bombCap + " ┬╖ RANGE " + h.range +
                " ┬╖ SPEED " + (1 + Math.round((h.speed - BASE_SPEED) / SPEED_STEP)),
        };
    },

    gameOverText(run) {
        if (!core) return "";
        const w = core.winner;
        const tag = run && run._newBest ? "  ┬╖  NEW BEST" : "";
        const lines = [];
        if (w) lines.push(w.name + " WINS THE MATCH");
        else lines.push("MATCH OVER");
        lines.push("");
        for (const e of core.contenders) {
            lines.push(e.name + ": " + e.wins + " win" + (e.wins === 1 ? "" : "s"));
        }
        lines.push("");
        lines.push("Your wins: " + core.human.wins + tag);
        return lines.join("\n");
    },

    onEnterScreen(name) {
        if (name === "roundover") fillRoundScreen();
    },

    onMenuAction(action, run, api) {
        if (action === "continue" && core) {
            // Advance past round-over into the next round without a full rematch.
            for (const d of ["up", "down", "left", "right"]) {
                if (run && run.held[d]) {
                    core.releaseDir(d);
                    run.held[d] = false;
                }
            }
            core.proceed();
            applied = new Map();
            frameCamera();
            if (run) run.roundPending = false;
            return "playing";
        }
        return null;
    },

    cue(name, audio) {
        if (name === "bomb") audio.tone(180, 0.05, "square", 0.35);
        else if (name === "round") {
            audio.sequence([
                [523, 0.08, "square", 0.45],
                [659, 0.12, "square", 0.5],
            ]);
        } else if (name === "win") {
            audio.sequence([
                [523, 0.09, "square", 0.55],
                [659, 0.09, "square", 0.6],
                [784, 0.1, "square", 0.65],
                [1047, 0.22, "square", 0.7],
            ]);
        } else if (name === "lose") {
            audio.sequence([
                [220, 0.12, "sawtooth", 0.45],
                [160, 0.2, "sawtooth", 0.5],
            ]);
        }
    },
};

// ── Test hooks (window.BLAST) ────────────────────────────────────────────

export function installTestHooks(shell) {
    // Lazy: scene/core on first run (or BLAST.ensure()) so headless
    // --no-gpu can still open the title screen.
    window.BLAST = {
        shell,
        ensure() {
            ensureCore();
            buildChips();
            return this;
        },
        get game() { return core; },
        get world() { return core && core.world; },
        get scene() { return scene; },
        get debug() { return core && core.debug; },
        TILE, SPAWNS, ROSTER,
        FLAG_SOLID, FLAG_SOFT, FLAG_BOMB, FLAG_DANGER,
        MAP_W, MAP_H, FUSE, FIRE_LINGER,
        BASE_RANGE, BASE_BOMBS, BASE_SPEED,
    };
}
