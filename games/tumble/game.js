// Tumble — arcade foundation plugin (3D marble-run).
// Domain: levels.js. Shell owns menus / pause / session; scene lives on #view.

import "/lib/camera.js";
import { TumbleLevels } from "/app/levels.js";

const { PIECES, PIECE_ORDER, LEVELS, medalFor, fmt, quatY, rotY } = TumbleLevels;

/** Session: last / pending level index for create(). null → use save.lastLevel */
const session = {
    levelIdx: null,
};

/** Module scene + sim state (rebuilt in create). */
let canvas = null;
let scene = null;
let cam = null;
let budget = {};
let wired = false;

const SCENE = {
    groundNode: null,
    goalMarker: null,
    goalFill: null,
    spoutNode: null,
    layerPlane: null,
    ghostParts: [],
    ghostIds: new Set(),
    ghostCellKey: null,
    outOfBoundsGhost: false,
    staticDecor: [],
};

/** @type {object|null} */
let G = null; // active run alias

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

    defaults: {
        highScore: 0,
        best: {},
        lastLevel: 0,
        unlocked: 1,
    },

    create(ctx) {
        ensureScene();
        ensureInputWiring(ctx);

        const rawIdx = session.levelIdx != null
            ? session.levelIdx
            : (ctx.save.get("lastLevel") || 0);
        const idx = Math.min(Math.max(0, rawIdx | 0), LEVELS.length - 1);

        const run = {
            score: 0, // time-based; lower is better — shell highScore is secondary
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            level: null,
            levelIdx: idx,
            mode: "build",
            placed: new Map(),
            meshToCell: new Map(),
            bodyToCell: new Map(),
            animatedCells: [],
            marbles: [],
            marblesSpawned: 0,
            marblesRemoved: 0,
            nextSpawnAt: 0,
            startMs: 0,
            resultMs: null,
            runtime: 0,
            pendingFail: null,
            pending: null, // "complete"
            build: { selected: "block", rot: 0, layer: 0 },
        };

        G = run;
        loadLevel(run, idx);
        return run;
    },

    update(run, dt, input) {
        G = run;
        if (!run.level) return;

        if (run.pending === "complete") {
            run.pending = null;
            return { status: "screen", name: "complete" };
        }

        // Piece hotkeys
        for (let i = 1; i <= 7; i++) {
            if (input.pressed("p" + i)) {
                const available = PIECE_ORDER.filter((t) => (budget[t] || { limit: 0 }).limit > 0);
                if (i - 1 < available.length) {
                    run.build.selected = available[i - 1];
                    run.play("select");
                    refreshPalette(run);
                    rebuildGhost(run);
                }
            }
        }
        if (input.pressed("secondary")) {
            const def = PIECES[run.build.selected];
            if (def && def.rotatable) {
                run.build.rot = (run.build.rot + 1) & 3;
                run.play("menu");
                rebuildGhost(run);
            }
        }
        if (input.pressed("layer_down") && run.mode === "build") {
            const b = run.level.bounds.y;
            run.build.layer = Math.max(b[0], run.build.layer - 1);
            if (SCENE.layerPlane) SCENE.layerPlane.y = run.build.layer + 0.001;
            run.play("menu");
        }
        if (input.pressed("layer_up") && run.mode === "build") {
            const b = run.level.bounds.y;
            run.build.layer = Math.min(b[1], run.build.layer + 1);
            if (SCENE.layerPlane) SCENE.layerPlane.y = run.build.layer + 0.001;
            run.play("menu");
        }
        if (input.pressed("primary")) {
            toggleMode(run);
        }

        simTick(run, dt);
        applyCamera();
    },

    draw() {
        // 3D scene is engine-rendered; keep camera fresh.
        applyCamera();
    },

    hud(run) {
        if (!run || !run.level) {
            return { level: "—", mode: "BUILD", timer: "—", par: "—", best: "—", marbles: "0", budget: "0 / 0" };
        }
        const bestMap = run.save.get("best") || {};
        const modeEl = document.getElementById("hud-mode");
        if (modeEl) {
            modeEl.textContent = run.mode === "run" ? "RUN" : "BUILD";
            modeEl.classList.toggle("run", run.mode === "run");
        }
        let used = 0, limit = 0;
        for (const t of PIECE_ORDER) {
            used += (budget[t] && budget[t].used) || 0;
            limit += (budget[t] && budget[t].limit) || 0;
        }
        const timer =
            run.mode === "run"
                ? ((run.resultMs != null ? run.resultMs / 1000 : run.runtime / 1000).toFixed(2) + "s")
                : "—";
        return {
            level: "Level " + (run.levelIdx + 1) + " — " + run.level.name,
            mode: run.mode === "run" ? "RUN" : "BUILD",
            timer,
            par: fmt(run.level.par.bronze) + " / " + fmt(run.level.par.gold),
            best: fmt(bestMap[run.level.id]),
            marbles:
                run.marblesSpawned + "/" + run.level.maxMarbles +
                (run.marblesRemoved ? "  (" + run.marblesRemoved + " cleared)" : ""),
            budget: used + " / " + limit,
        };
    },

    gameOverText(run) {
        if (!run || !run.level) return "";
        return run.level.name + "\nTime: " + (run.resultMs != null ? fmt(run.resultMs / 1000) : "—");
    },

    onEnterScreen(name, run, api) {
        if (name === "levels") renderLevelTiles(api);
        if (name === "complete" && run) {
            const t = (run.resultMs || 0) / 1000;
            const level = run.level;
            const medal = medalFor(t, level);
            const title = document.getElementById("complete-title");
            if (title) {
                title.textContent =
                    (medal === "gold" ? "Gold — " :
                     medal === "silver" ? "Silver — " :
                     medal === "bronze" ? "Bronze — " : "Complete — ") + level.name;
            }
            const timeEl = document.getElementById("complete-time");
            if (timeEl) timeEl.textContent = fmt(t);
            const medalEl = document.getElementById("complete-medal");
            if (medalEl) {
                medalEl.textContent = medal === "none" ? "Complete" : medal.toUpperCase();
                medalEl.className = "medal " + (medal === "none" ? "" : medal);
            }
            const bestMap = run.save.get("best") || {};
            const detail = document.getElementById("complete-detail");
            if (detail) {
                detail.textContent =
                    "Par: gold " + fmt(level.par.gold) +
                    " · silver " + fmt(level.par.silver) +
                    " · bronze " + fmt(level.par.bronze) +
                    "  —  Best " + fmt(bestMap[level.id]);
            }
        }
        if (name === "title" || name === "levels" || name === "howto") {
            // Keep scene if any; hide is shell's job
        }
    },

    onMenuAction(action, run, api) {
        if (action === "levels") return "levels";
        if (action === "resetprogress") {
            api.save.set("best", {});
            api.save.set("unlocked", 1);
            api.save.set("lastLevel", 0);
            api.save.save();
            toast("Progress reset.");
            return null;
        }
        if (action && action.indexOf("level-") === 0) {
            const i = parseInt(action.slice(6), 10);
            const unlocked = api.save.get("unlocked") || 1;
            if (!isNaN(i) && i >= 0 && i < LEVELS.length && i < unlocked) {
                session.levelIdx = i;
                return { startRun: true };
            }
            return null;
        }
        if (action === "next" && run) {
            session.levelIdx = Math.min(run.levelIdx + 1, LEVELS.length - 1);
            return { startRun: true };
        }
        if (action === "retry") {
            return { startRun: true };
        }
        // Title "Play" uses data-action="play" → shell startRun with session.levelIdx
        return null;
    },

    cue(name, audio) {
        if (name === "menu") audio.tone(440, 0.03, "sine", 0.3);
        else if (name === "select") audio.tone(620, 0.06, "square", 0.35);
        else if (name === "place") audio.tone(540, 0.04, "triangle", 0.3);
        else if (name === "remove") audio.tone(200, 0.06, "square", 0.3);
        else if (name === "drop") audio.tone(320, 0.04, "sine", 0.25);
        else if (name === "clink") audio.tone(880, 0.03, "triangle", 0.18);
        else if (name === "goal") {
            audio.sequence([
                [523, 0.09, "square", 0.55],
                [659, 0.09, "square", 0.6],
                [784, 0.1, "square", 0.65],
                [1047, 0.22, "square", 0.7],
            ]);
        } else if (name === "fail") {
            audio.sequence([
                [220, 0.12, "sawtooth", 0.45],
                [160, 0.2, "sawtooth", 0.5],
            ]);
        }
    },
};

// ── Scene bootstrap ───────────────────────────────────────────────────────

function ensureScene() {
    if (scene) return;
    canvas = document.getElementById("view") || document.querySelector("canvas");
    if (!canvas) throw new Error("tumble: #view canvas missing");
    scene = canvas.getContext("scene");
    if (!scene) throw new Error("tumble: scene context unavailable");

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    cam = Camera.createOrbit({
        target: [0, 3, 0],
        dist: 12,
        fov: 50,
        near: 0.1,
        far: 400,
    });
}

function ensureInputWiring(ctx) {
    if (wired) return;
    wired = true;
    ensureScene();

    let dragging = null;
    let lastX = 0, lastY = 0;
    canvas.addEventListener("mousedown", (e) => {
        if (e.button === 2) dragging = "orbit";
        else if (e.button === 1) dragging = "pan";
        else dragging = null;
        lastX = e.clientX;
        lastY = e.clientY;
    });
    window.addEventListener("mouseup", () => { dragging = null; });
    window.addEventListener("mousemove", (e) => {
        if (!dragging) {
            if (G) updateGhost(G, e);
            return;
        }
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        if (dragging === "orbit") Camera.orbitLook(cam, dx, dy);
        else if (dragging === "pan") Camera.orbitPan(cam, dx, dy);
    });
    canvas.addEventListener("wheel", (e) => {
        const s = Math.exp(e.deltaY * 0.001);
        cam.dist = Math.max(4, Math.min(60, cam.dist * s));
    }, { passive: true });
    canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (!G || G.mode !== "build") return;
        if (overlayOpen()) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (canvas.height / rect.height);
        const ray = scene.unprojectLocal(mx, my);
        if (!ray) return;
        const hit = scene.raycast(ray.origin, ray.dir, 200);
        if (hit && hit.node) {
            const key = G.meshToCell.get(hit.node.id);
            if (key && removePiece(G, key)) {
                G.play("remove");
                refreshPalette(G);
                return;
            }
        }
        const c = cellUnderCursor(G, e);
        if (c) {
            const key = cellKey(c.cx, c.cy, c.cz);
            if (removePiece(G, key)) {
                G.play("remove");
                refreshPalette(G);
            }
        }
    });
    canvas.addEventListener("click", (e) => {
        if (e.button !== 0) return;
        if (!G || G.mode !== "build" || overlayOpen()) return;
        const c = cellUnderCursor(G, e);
        if (!c) return;
        const placed = placePiece(G, G.build.selected, c.cx, c.cy, c.cz, G.build.rot);
        if (placed) {
            G.play("place");
            refreshPalette(G);
            updateGhost(G, e);
        } else {
            toast("Cannot place there.");
        }
    });
    canvas.addEventListener("mousemove", (e) => {
        if (G) updateGhost(G, e);
    });
}

function applyCamera() {
    if (!scene || !cam || !canvas) return;
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));
}

function overlayOpen() {
    const el = document.getElementById("overlay");
    return el && !el.hidden && el.style.display !== "none";
}

// ── Level load ────────────────────────────────────────────────────────────

function loadLevel(run, idx) {
    teardownScene(run);
    run.levelIdx = idx;
    run.level = LEVELS[idx];
    session.levelIdx = idx;
    run.save.set("lastLevel", idx);
    run.save.save();

    Physics.createWorld({ maxBodies: 4096 });
    Physics.setGravity(0, run.level.gravity, 0);

    buildEnvironment(run.level);

    budget = {};
    for (const t of PIECE_ORDER) {
        const lim = run.level.budget[t] || 0;
        budget[t] = { used: 0, limit: lim };
    }
    run.build.selected = PIECE_ORDER.find((t) => (budget[t].limit || 0) > 0) || "block";
    run.build.rot = 0;
    run.build.layer = Math.max(0, run.level.bounds.y[0]);

    for (const f of run.level.furniture || []) {
        placePiece(run, f.type, f.cell[0], f.cell[1], f.cell[2], f.rot || 0, { furniture: true });
    }

    enterBuildMode(run);
    refreshPalette(run);
}

function teardownScene(run) {
    if (!scene) return;
    const rootChildren = scene.root.children.slice();
    for (const n of rootChildren) scene.destroyNode(n);
    const all = Physics.getAllTransforms();
    for (let i = 0; i < all.length; i += 8) {
        Physics.destroyBody(all[i] | 0);
    }
    SCENE.groundNode = null;
    SCENE.goalMarker = null;
    SCENE.goalFill = null;
    SCENE.spoutNode = null;
    SCENE.layerPlane = null;
    SCENE.ghostParts.length = 0;
    SCENE.ghostIds.clear();
    SCENE.staticDecor.length = 0;
    if (run) {
        run.placed.clear();
        run.meshToCell.clear();
        run.bodyToCell.clear();
        run.animatedCells.length = 0;
        run.marbles.length = 0;
        run.marblesSpawned = 0;
        run.marblesRemoved = 0;
        run.resultMs = null;
        run.runtime = 0;
        run.pending = null;
        if (run.pendingFail) {
            clearTimeout(run.pendingFail);
            run.pendingFail = null;
        }
    }
}

function buildEnvironment(level) {
    scene.setAmbient([0.05, 0.055, 0.065]);
    scene.setToneMap({ mode: "aces", exposure: 1.1 });
    scene.setFog({ start: 25, end: 60, color: [0.04, 0.05, 0.09] });

    scene.createLight({
        type: "directional",
        direction: [-0.45, -1.0, -0.35],
        color: [1.0, 0.97, 0.9],
        intensity: 2.6,
        name: "sun",
    });
    scene.createLight({
        type: "point",
        position: [0, 5, 8],
        color: [1.0, 0.75, 0.55],
        intensity: 14,
        range: 18,
        name: "warm-fill",
    });
    scene.createLight({
        type: "point",
        position: [-6, 4, -6],
        color: [0.5, 0.7, 1.0],
        intensity: 10,
        range: 14,
        name: "cool-rim",
    });

    const bx = level.bounds.x, bz = level.bounds.z;
    const w = bx[1] - bx[0] + 3;
    const d = bz[1] - bz[0] + 3;
    const cx = (bx[0] + bx[1]) * 0.5;
    const cz = (bz[0] + bz[1]) * 0.5;
    SCENE.groundNode = scene.createMesh({
        mesh: "plane",
        halfW: w * 0.5, halfD: d * 0.5,
        x: cx, y: -0.02, z: cz,
        color: "#1a2236", metallic: 0.0, roughness: 0.92,
        name: "ground",
    });
    Physics.createBody({
        shape: "box", static: true,
        halfExtents: { x: w * 0.5, y: 0.02, z: d * 0.5 },
        position: { x: cx, y: -0.02, z: cz },
        friction: 0.6, restitution: 0.12,
    });

    const sp = level.spawner;
    SCENE.spoutNode = scene.createMesh({
        mesh: "cylinder",
        radius: 0.35, halfHeight: 0.08, segments: 24,
        x: sp.x, y: sp.y + 0.18, z: sp.z,
        color: "#ffd466", metallic: 0.1, roughness: 0.3,
        emissive: 1.5, emissiveColor: [1.0, 0.82, 0.4],
        name: "spawner",
    });
    SCENE.staticDecor.push(scene.createMesh({
        mesh: "cylinder", radius: 0.04, halfHeight: 0.6, segments: 12,
        x: sp.x, y: sp.y - 0.5, z: sp.z,
        color: "#ffd466", emissive: 2.0, emissiveColor: [1.0, 0.85, 0.4],
        metallic: 0.0, roughness: 1.0,
    }));

    const g = level.goal;
    const gcx = (g.min[0] + g.max[0]) * 0.5;
    const gcz = (g.min[2] + g.max[2]) * 0.5;
    const ghw = (g.max[0] - g.min[0]) * 0.5;
    const ghd = (g.max[2] - g.min[2]) * 0.5;
    const rimColor = [0.3, 1.0, 0.6];
    const rimY = g.max[1] + 0.02;
    SCENE.goalMarker = scene.createNode("goal-rim");
    const rims = [
        { x: gcx - ghw, y: rimY, z: gcz, hw: 0.04, hd: ghd + 0.04, hh: 0.04 },
        { x: gcx + ghw, y: rimY, z: gcz, hw: 0.04, hd: ghd + 0.04, hh: 0.04 },
        { x: gcx, y: rimY, z: gcz - ghd, hw: ghw + 0.04, hd: 0.04, hh: 0.04 },
        { x: gcx, y: rimY, z: gcz + ghd, hw: ghw + 0.04, hd: 0.04, hh: 0.04 },
    ];
    for (const r of rims) {
        const n = scene.createMesh({
            mesh: "box", halfW: r.hw, halfH: r.hh, halfD: r.hd,
            x: r.x, y: r.y, z: r.z,
            color: "#4eff8f", metallic: 0.0, roughness: 0.5,
            emissive: 2.2, emissiveColor: rimColor,
        });
        SCENE.goalMarker.add(n);
    }
    SCENE.goalFill = scene.createMesh({
        mesh: "box", halfW: ghw, halfH: 0.02, halfD: ghd,
        x: gcx, y: g.min[1] + 0.02, z: gcz,
        color: "#0a3a1e",
        emissive: 0.6, emissiveColor: [0.2, 0.9, 0.5],
        metallic: 0.0, roughness: 0.8,
    });
    Physics.createBody({
        shape: "box", static: true,
        halfExtents: { x: ghw, y: 0.02, z: ghd },
        position: { x: gcx, y: g.min[1] + 0.02, z: gcz },
        friction: 0.8, restitution: 0.1,
    });
    const wallH = (g.max[1] - g.min[1]) * 0.8;
    const walls = [
        { x: g.min[0], y: g.min[1] + wallH * 0.5, z: gcz, hw: 0.04, hh: wallH * 0.5, hd: ghd },
        { x: g.max[0], y: g.min[1] + wallH * 0.5, z: gcz, hw: 0.04, hh: wallH * 0.5, hd: ghd },
        { x: gcx, y: g.min[1] + wallH * 0.5, z: g.min[2], hw: ghw, hh: wallH * 0.5, hd: 0.04 },
        { x: gcx, y: g.min[1] + wallH * 0.5, z: g.max[2], hw: ghw, hh: wallH * 0.5, hd: 0.04 },
    ];
    for (const ww of walls) {
        Physics.createBody({
            shape: "box", static: true,
            halfExtents: { x: ww.hw, y: ww.hh, z: ww.hd },
            position: { x: ww.x, y: ww.y, z: ww.z },
            friction: 0.5, restitution: 0.2,
        });
        SCENE.staticDecor.push(scene.createMesh({
            mesh: "box", halfW: ww.hw, halfH: ww.hh, halfD: ww.hd,
            x: ww.x, y: ww.y, z: ww.z,
            color: "#1e4a2e",
            emissive: 0.25, emissiveColor: [0.2, 0.9, 0.5],
            metallic: 0.05, roughness: 0.7,
        }));
    }

    SCENE.layerPlane = scene.createMesh({
        mesh: "plane",
        halfW: (bx[1] - bx[0] + 1) * 0.5,
        halfD: (bz[1] - bz[0] + 1) * 0.5,
        x: cx, y: 0, z: cz,
        color: "#2a3458",
        emissive: 0.15, emissiveColor: [0.4, 0.5, 0.9],
        metallic: 0.0, roughness: 1.0,
        name: "layer-plane",
    });
    SCENE.layerPlane.visible = false;

    const diag = Math.sqrt(
        (bx[1] - bx[0]) * (bx[1] - bx[0]) +
        (bz[1] - bz[0]) * (bz[1] - bz[0])
    );
    Camera.orbitReframe(
        cam,
        [cx, (level.bounds.y[0] + level.bounds.y[1]) * 0.35, cz],
        Math.max(10, diag * 1.4)
    );
}

// ── Placement ─────────────────────────────────────────────────────────────

function cellKey(cx, cy, cz) { return cx + "," + cy + "," + cz; }

function inBounds(run, cx, cy, cz) {
    const b = run.level.bounds;
    return cx >= b.x[0] && cx <= b.x[1]
        && cy >= b.y[0] && cy <= b.y[1]
        && cz >= b.z[0] && cz <= b.z[1];
}

function cellReserved(run, cx, cy, cz) {
    const g = run.level.goal;
    const wx = cx + 0.5, wy = cy + 0.5, wz = cz + 0.5;
    if (wx >= g.min[0] && wx <= g.max[0] &&
        wy >= g.min[1] && wy <= g.max[1] &&
        wz >= g.min[2] && wz <= g.max[2]) return true;
    const s = run.level.spawner;
    if (Math.floor(s.x) === cx && Math.floor(s.z) === cz && Math.abs(wy - s.y) < 1.0) return true;
    return false;
}

function placePiece(run, type, cx, cy, cz, rot, opts) {
    opts = opts || {};
    const key = cellKey(cx, cy, cz);
    if (run.placed.has(key)) return false;
    if (!inBounds(run, cx, cy, cz)) return false;
    if (cellReserved(run, cx, cy, cz)) return false;
    const def = PIECES[type];
    if (!def) return false;
    if (!opts.furniture) {
        const bud = budget[type];
        if (!bud || bud.used >= bud.limit) return false;
    }
    const cw = { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 };
    const built = def.build(scene, cw, rot | 0);
    const rec = {
        type, rot: rot | 0, cell: [cx, cy, cz],
        node: built.node,
        body: built.body,
        extras: built.extras || [],
        extraBodies: built.extraBodies || [],
        anim: built.anim || null,
        furniture: !!opts.furniture,
    };
    run.placed.set(key, rec);
    if (!opts.furniture) budget[type].used += 1;
    if (rec.node) run.meshToCell.set(rec.node.id, key);
    for (const ex of rec.extras) run.meshToCell.set(ex.id, key);
    if (rec.body != null) run.bodyToCell.set(rec.body, key);
    for (const eb of rec.extraBodies) run.bodyToCell.set(eb, key);
    if (rec.anim) run.animatedCells.push(key);
    return true;
}

function removePiece(run, key) {
    const rec = run.placed.get(key);
    if (!rec || rec.furniture) return false;
    if (rec.node) { run.meshToCell.delete(rec.node.id); scene.destroyNode(rec.node); }
    for (const ex of rec.extras) {
        run.meshToCell.delete(ex.id);
        scene.destroyNode(ex);
    }
    if (rec.body != null) { run.bodyToCell.delete(rec.body); Physics.destroyBody(rec.body); }
    for (const eb of rec.extraBodies) {
        run.bodyToCell.delete(eb);
        Physics.destroyBody(eb);
    }
    const idx = run.animatedCells.indexOf(key);
    if (idx >= 0) run.animatedCells.splice(idx, 1);
    run.placed.delete(key);
    budget[rec.type].used = Math.max(0, budget[rec.type].used - 1);
    return true;
}

// ── Ghost ─────────────────────────────────────────────────────────────────

function destroyGhost() {
    for (const p of SCENE.ghostParts) {
        if (p.node) scene.destroyNode(p.node);
    }
    SCENE.ghostParts.length = 0;
    SCENE.ghostIds.clear();
}

function setGhostVisible(v) {
    for (const p of SCENE.ghostParts) if (p.node) p.node.visible = v;
}

function moveGhost(cx, cy, cz) {
    const wx = cx + 0.5, wy = cy + 0.5, wz = cz + 0.5;
    for (const p of SCENE.ghostParts) {
        if (!p.node) continue;
        p.node.x = wx + p.bx;
        p.node.y = wy + p.by;
        p.node.z = wz + p.bz;
    }
}

function setGhostEmissive(em) {
    for (const p of SCENE.ghostParts) {
        if (!p.node) continue;
        try { p.node.emissive = em; } catch (e) { /* ignore */ }
    }
}

function rebuildGhost(run) {
    destroyGhost();
    const def = PIECES[run.build.selected];
    if (!def) return;
    const built = def.build(scene, { x: 0, y: 0, z: 0 }, run.build.rot | 0);
    if (built.body != null) Physics.destroyBody(built.body);
    for (const eb of built.extraBodies || []) Physics.destroyBody(eb);
    const visuals = [built.node, ...(built.extras || [])].filter(Boolean);
    for (const n of visuals) {
        const bx = n.x, by = n.y, bz = n.z;
        try { n.emissive = 1.6; } catch (e) { /* ignore */ }
        try { n.roughness = 0.4; } catch (e) { /* ignore */ }
        n.visible = false;
        SCENE.ghostParts.push({ node: n, bx, by, bz });
        SCENE.ghostIds.add(n.id);
    }
}

function cellUnderCursor(run, e) {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const ray = scene.unprojectLocal(mx, my);
    if (!ray) return null;

    const wasVisible = SCENE.ghostParts.length > 0 &&
        SCENE.ghostParts[0].node && SCENE.ghostParts[0].node.visible;
    if (wasVisible) setGhostVisible(false);
    const hit = scene.raycast(ray.origin, ray.dir, 200);
    if (wasVisible) setGhostVisible(true);

    if (hit && hit.node) {
        const key = run.meshToCell.get(hit.node.id);
        if (key) {
            const rec = run.placed.get(key);
            if (rec && hit.normal) {
                const n = hit.normal;
                let ax = 0, ay = 0, az = 0;
                const bx = Math.abs(n[0]), by = Math.abs(n[1]), bz = Math.abs(n[2]);
                if (bx >= by && bx >= bz) ax = Math.sign(n[0]);
                else if (by >= bz) ay = Math.sign(n[1]);
                else az = Math.sign(n[2]);
                if (ax === 0 && ay === 0 && az === 0) ay = 1;
                return {
                    cx: rec.cell[0] + ax,
                    cy: rec.cell[1] + ay,
                    cz: rec.cell[2] + az,
                };
            }
        }
    }

    const y = run.build.layer;
    const o = ray.origin, d = ray.dir;
    function planeHit(py) {
        if (Math.abs(d[1]) < 1e-6) return null;
        const t = (py - o[1]) / d[1];
        if (t < 0) return null;
        return { wx: o[0] + d[0] * t, wz: o[2] + d[2] * t };
    }
    const h = planeHit(y + 1) || planeHit(y + 0.5) || planeHit(y);
    if (!h) return null;
    return { cx: Math.floor(h.wx), cy: y, cz: Math.floor(h.wz) };
}

function updateGhost(run, e) {
    if (run.mode !== "build" || SCENE.ghostParts.length === 0) {
        setGhostVisible(false);
        return;
    }
    const c = cellUnderCursor(run, e);
    if (!c) { setGhostVisible(false); return; }
    const key = cellKey(c.cx, c.cy, c.cz);
    const inb = inBounds(run, c.cx, c.cy, c.cz);
    const reserved = cellReserved(run, c.cx, c.cy, c.cz);
    const occupied = run.placed.has(key);
    const bud = budget[run.build.selected];
    const noBudget = !bud || bud.used >= bud.limit;
    const valid = inb && !reserved && !occupied && !noBudget;
    SCENE.ghostCellKey = key;
    SCENE.outOfBoundsGhost = !valid;
    moveGhost(c.cx, c.cy, c.cz);
    setGhostVisible(true);
    setGhostEmissive(valid ? 1.6 : 0.2);
}

// ── Modes / marbles ───────────────────────────────────────────────────────

function enterBuildMode(run) {
    run.mode = "build";
    run.resultMs = null;
    run.runtime = 0;
    if (run.pendingFail) { clearTimeout(run.pendingFail); run.pendingFail = null; }
    for (const m of run.marbles) {
        if (m.body != null) Physics.destroyBody(m.body);
        if (m.node) scene.destroyNode(m.node);
    }
    run.marbles.length = 0;
    run.marblesSpawned = 0;
    run.marblesRemoved = 0;
    if (SCENE.layerPlane) {
        SCENE.layerPlane.visible = true;
        SCENE.layerPlane.y = run.build.layer + 0.001;
    }
    rebuildGhost(run);
}

function enterRunMode(run) {
    run.mode = "run";
    run.resultMs = null;
    run.startMs = performance.now();
    run.runtime = 0;
    run.nextSpawnAt = run.startMs;
    run.marblesSpawned = 0;
    run.marblesRemoved = 0;
    if (SCENE.layerPlane) SCENE.layerPlane.visible = false;
    setGhostVisible(false);
    run.play("drop");
}

function toggleMode(run) {
    if (run.mode === "build") enterRunMode(run);
    else enterBuildMode(run);
}

function spawnMarble(run) {
    const sp = run.level.spawner;
    const body = Physics.createBody({
        shape: "sphere", radius: 0.17,
        position: { x: sp.x, y: sp.y, z: sp.z },
        friction: 0.18, restitution: 0.4,
    });
    const node = scene.createMesh({
        mesh: "sphere", radius: 0.17,
        segments: 20, rings: 14,
        x: sp.x, y: sp.y, z: sp.z,
        color: "#f5f0ff", metallic: 1.0, roughness: 0.15,
        emissive: 0.2, emissiveColor: [0.6, 0.75, 1.0],
    });
    run.marbles.push({ body, node });
    run.marblesSpawned += 1;
    run.bodyToCell.set(body, "__marble");
}

function destroyMarble(run, m) {
    if (m.body != null) { run.bodyToCell.delete(m.body); Physics.destroyBody(m.body); }
    if (m.node) scene.destroyNode(m.node);
    run.marblesRemoved += 1;
}

function marbleInGoal(run, pos) {
    const g = run.level.goal;
    return pos.x >= g.min[0] && pos.x <= g.max[0] &&
           pos.y >= g.min[1] && pos.y <= g.max[1] &&
           pos.z >= g.min[2] && pos.z <= g.max[2];
}

function simTick(run, dt) {
    if (run.mode !== "run") return;
    run.runtime += dt;
    const now = run.startMs + run.runtime;

    if (run.marblesSpawned < run.level.maxMarbles && now >= run.nextSpawnAt) {
        spawnMarble(run);
        run.play("drop");
        run.nextSpawnAt = now + run.level.spawnInterval;
    }

    for (let i = run.marbles.length - 1; i >= 0; i--) {
        const m = run.marbles[i];
        const tf = Physics.getTransform(m.body);
        if (!tf) { run.marbles.splice(i, 1); continue; }
        const p = tf.position;
        m.node.x = p.x;
        m.node.y = p.y;
        m.node.z = p.z;
        if (run.resultMs == null && marbleInGoal(run, p)) {
            run.resultMs = run.runtime;
            onLevelCompleted(run);
        }
        if (p.y < -6) {
            destroyMarble(run, m);
            run.marbles.splice(i, 1);
        }
    }

    for (const key of run.animatedCells) {
        const rec = run.placed.get(key);
        if (!rec || !rec.anim) continue;
        if (rec.anim.kind === "spinner") {
            rec.anim.phase += dt * 0.004;
            const yaw = rotY(rec.anim.rot) + rec.anim.phase;
            const q = quatY(yaw);
            Physics.setRotation(rec.body, q.x, q.y, q.z, q.w);
            rec.node.rotationY = yaw;
        }
    }

    const events = Physics.getContacts();
    for (const ev of events) {
        if (ev.type !== "added") continue;
        let marbleId = null, pieceKey = null;
        if (run.bodyToCell.get(ev.body1) === "__marble") {
            marbleId = ev.body1;
            pieceKey = run.bodyToCell.get(ev.body2);
        } else if (run.bodyToCell.get(ev.body2) === "__marble") {
            marbleId = ev.body2;
            pieceKey = run.bodyToCell.get(ev.body1);
        }
        if (marbleId == null || !pieceKey || pieceKey === "__marble") continue;
        const rec = run.placed.get(pieceKey);
        if (!rec) continue;
        if (rec.type === "booster") {
            const yaw = rotY(rec.rot || 0);
            Physics.addImpulse(marbleId, Math.cos(yaw) * 0.22, 0.05, Math.sin(yaw) * 0.22);
            run.play("clink");
        } else if (rec.type === "spinner") {
            const v = Physics.getVelocity(marbleId);
            if (v) Physics.addImpulse(marbleId, v.linear.x * 0.5, 0.1, v.linear.z * 0.5);
            run.play("clink");
        } else if (rec.type === "bumper") {
            run.play("clink");
        }
    }

    if (run.resultMs == null &&
        run.marblesSpawned >= run.level.maxMarbles &&
        run.marblesRemoved >= run.marblesSpawned &&
        run.pendingFail == null) {
        run.pendingFail = setTimeout(() => {
            if (run.resultMs == null && run.mode === "run") {
                onLevelFailed(run);
            }
        }, 900);
    }
}

function onLevelCompleted(run) {
    const t = run.resultMs / 1000;
    const level = run.level;
    const bestMap = Object.assign({}, run.save.get("best") || {});
    const prev = bestMap[level.id];
    if (prev == null || t < prev) {
        bestMap[level.id] = t;
        run.save.set("best", bestMap);
    }
    const nextIdx = run.levelIdx + 1;
    const unlocked = run.save.get("unlocked") || 1;
    if (nextIdx + 1 > unlocked && nextIdx < LEVELS.length) {
        run.save.set("unlocked", nextIdx + 1);
    }
    // Invert time into a "score" for shell highScore (higher better): use inverse-ish
    run.score = Math.max(0, Math.floor(100000 / Math.max(0.01, t)));
    run.save.maybeHighScore(run.score);
    run.save.save();
    run.play("goal");
    run.pending = "complete";
}

function onLevelFailed(run) {
    run.play("fail");
    toast("No marbles reached the cup. Rebuild and try again.");
    enterBuildMode(run);
    refreshPalette(run);
}

// ── UI helpers ────────────────────────────────────────────────────────────

function refreshPalette(run) {
    const el = document.getElementById("hud-palette");
    if (!el) return;
    const available = PIECE_ORDER.filter((t) => (budget[t] || { limit: 0 }).limit > 0);
    el.innerHTML = available.map((t) => {
        const def = PIECES[t];
        const b = budget[t];
        const left = b.limit - b.used;
        const cls = [
            "palette-item",
            t === run.build.selected ? "selected" : "",
            left <= 0 ? "disabled" : "",
        ].filter(Boolean).join(" ");
        return (
            '<div class="' + cls + '" data-piece="' + t + '">' +
            '<div class="palette-key">' + def.key + "</div>" +
            '<div class="palette-swatch" style="background:' + def.color +
            ";box-shadow:0 0 6px " + def.color + '88;"></div>' +
            '<div class="palette-name">' + def.label + "</div>" +
            '<div class="palette-count">' + left + "/" + b.limit + "</div>" +
            "</div>"
        );
    }).join("");
    for (const item of el.querySelectorAll(".palette-item")) {
        item.addEventListener("click", () => {
            run.build.selected = item.getAttribute("data-piece");
            run.play("select");
            refreshPalette(run);
            rebuildGhost(run);
        });
    }
}

function renderLevelTiles(api) {
    const grid = document.getElementById("levels-grid");
    if (!grid) return;
    const bestMap = api.save.get("best") || {};
    const unlocked = api.save.get("unlocked") || 1;
    // Tiles are .menu-item so shell click/keyboard activates data-action="level-N".
    grid.innerHTML = LEVELS.map((lv, i) => {
        const locked = i >= unlocked;
        const best = bestMap[lv.id];
        const medal = best != null ? medalFor(best, lv) : "none";
        const medalGlyph = medal === "none" ? "☆" : "★";
        const color =
            medal === "gold" ? "#ffd84a" :
            medal === "silver" ? "#d8dce4" :
            medal === "bronze" ? "#c88a5a" : "#444";
        const cls = "level-tile menu-item" + (locked ? " locked disabled" : "");
        const action = locked ? "" : ' data-action="level-' + i + '"';
        return (
            '<div class="' + cls + '"' + action + ">" +
            '<div class="level-num">Level ' + (i + 1) + "</div>" +
            '<div class="level-name">' + lv.name + "</div>" +
            '<div class="level-best">' + (best != null ? fmt(best) : locked ? "locked" : "") + "</div>" +
            '<div class="level-medal" style="color:' + color + '">' + medalGlyph + "</div>" +
            "</div>"
        );
    }).join("");
}

function toast(text) {
    const area = document.getElementById("hud-toast-area") || document.body;
    const el = document.createElement("div");
    el.className = "tumble-toast";
    el.textContent = text;
    area.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1200);
}
