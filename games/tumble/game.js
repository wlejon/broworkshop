// Tumble — arcade foundation plugin (3D marble-run).
// Domain: levels.js. Shell owns menus / pause / session; scene lives on #view.
// Product brief: PRODUCT.md

import "/lib/camera.js";
import { TumbleLevels } from "/app/levels.js";
import { SOLUTIONS, applySolutionPieces } from "/app/solutions.js";

const { PIECES, PIECE_ORDER, LEVELS, medalFor, fmt, quatY, rotY } = TumbleLevels;

/** Session: last / pending level index for create(). null → use save.lastLevel */
const session = {
    levelIdx: null,
};

/** Coach tips — Drop-In (idx 0) until coachDone. */
const COACH_TIPS_DROPIN = [
    "Gold spout drops marbles. Green cup is the goal. Press Space to drop one in.",
    "See the path on the board? You can also place Blocks/Ramps for fun — R rotates.",
    "Space again rebuilds. Clear this level to unlock real path-building puzzles.",
];

/** Coach tips — Plank Walk (idx 1) until plankCoachDone. */
const COACH_TIPS_PLANK = [
    "Empty board fails — you must build. Gold pads mark a proven path. Select Booster (6).",
    "Click each gold pad (or under the spout). Arrow on booster = shove direction (R rotates).",
    "When pads form a runway to the cup, press Space. Rebuild with Space if it misses.",
];

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
    /** UX guides (path, drop zone, suggestions) — hidden while running. */
    guides: [],
    suggestPads: [],
};

/** @type {object|null} Latest run (input wiring + palette read this). */
let activeRun = null;

/** Bumped on teardown so deferred goal-pulse timeouts never touch freed nodes. */
let goalPulseGen = 0;

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
        coachDone: false,
        plankCoachDone: false,
    },

    create(ctx) {
        ensureScene();
        ensureInputWiring(ctx);

        const rawIdx = session.levelIdx != null
            ? session.levelIdx
            : (ctx.save.get("lastLevel") || 0);
        session.levelIdx = null; // consume one-shot override from level select / next
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
            newBest: false,
            coachStep: 0,
            build: { selected: "block", rot: 0, layer: 0 },
        };

        activeRun = run;
        loadLevel(run, idx);
        return run;
    },

    update(run, dt, input) {
        activeRun = run;
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
                    run.play("pick");
                    refreshPalette(run);
                    rebuildGhost(run);
                }
            }
        }
        if (input.pressed("secondary")) {
            const def = PIECES[run.build.selected];
            if (def && def.rotatable) {
                run.build.rot = (run.build.rot + 1) & 3;
                run.play("tick");
                rebuildGhost(run);
            }
        }
        if (input.pressed("layer_down") && run.mode === "build") {
            const b = run.level.bounds.y;
            run.build.layer = Math.max(b[0], run.build.layer - 1);
            if (SCENE.layerPlane) SCENE.layerPlane.y = run.build.layer + 0.001;
            run.play("tick");
        }
        if (input.pressed("layer_up") && run.mode === "build") {
            const b = run.level.bounds.y;
            run.build.layer = Math.min(b[1], run.build.layer + 1);
            if (SCENE.layerPlane) SCENE.layerPlane.y = run.build.layer + 0.001;
            run.play("tick");
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
            return {
                level: "—", mode: "BUILD", timer: "—", par: "—", best: "—",
                marbles: "0", budget: "0 / 0", tagline: "",
                "objective-text": "Get a marble into the green cup.",
                "action-text": "Loading…",
            };
        }
        const bestMap = run.save.get("best") || {};
        const modeEl = document.getElementById("hud-mode");
        if (modeEl) {
            modeEl.textContent = run.mode === "run" ? "RUNNING" : "BUILD";
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
                : "ready";

        refreshMissionSteps(run);
        refreshActionStrip(run);
        refreshPieceDesc(run);
        updateSuggestPads(run);
        setBuildGuidesVisible(run.mode === "build");

        return {
            level: "Level " + (run.levelIdx + 1) + " — " + run.level.name,
            mode: run.mode === "run" ? "RUNNING" : "BUILD",
            timer,
            par: "gold " + fmt(run.level.par.gold) + " · bronze " + fmt(run.level.par.bronze),
            best: fmt(bestMap[run.level.id]),
            marbles:
                run.marblesSpawned + "/" + run.level.maxMarbles +
                (run.marblesRemoved ? "  (" + run.marblesRemoved + " cleared)" : ""),
            budget: used + " / " + limit,
            tagline: run.level.tagline || "",
            "objective-text": "Get a marble from the gold spout into the green cup.",
        };
    },

    gameOverText(run) {
        if (!run || !run.level) return "";
        return run.level.name + "\nTime: " + (run.resultMs != null ? fmt(run.resultMs / 1000) : "—");
    },

    onEnterScreen(name, run, api) {
        if (name === "title") refreshTitleScreen(api);
        if (name === "levels") renderLevelTiles(api);
        if (name === "complete" && run) fillCompleteScreen(run);
    },

    onMenuAction(action, run, api) {
        if (action === "levels") return "levels";
        if (action === "resetprogress") {
            api.save.set("best", {});
            api.save.set("unlocked", 1);
            api.save.set("lastLevel", 0);
            api.save.set("coachDone", false);
            api.save.set("plankCoachDone", false);
            api.save.save();
            session.levelIdx = 0;
            refreshTitleScreen(api);
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
            if (run.levelIdx >= LEVELS.length - 1) {
                return "title";
            }
            session.levelIdx = run.levelIdx + 1;
            return { startRun: true };
        }
        if (action === "retry") {
            return { startRun: true };
        }
        // Title "Play" uses data-action="play" → shell startRun with session.levelIdx
        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    // "tick" / "pick" are build-UI feedback (not shell chrome).
    cue(name, audio) {
        if (name === "tick") audio.tone(440, 0.03, "sine", 0.3);
        else if (name === "pick") audio.tone(620, 0.06, "square", 0.35);
        else if (name === "place") audio.tone(540, 0.04, "triangle", 0.3);
        else if (name === "remove") audio.tone(200, 0.06, "square", 0.3);
        else if (name === "drop") audio.tone(320, 0.04, "sine", 0.25);
        else if (name === "clink") audio.tone(880, 0.03, "triangle", 0.18);
        else if (name === "goal") {
            audio.sequence([
                [523, 0.09, "square", 0.55],
                [659, 0.09, "square", 0.6],
                [784, 0.1, "square", 0.65],
                [1047, 0.18, "square", 0.7],
                [1319, 0.28, "triangle", 0.55],
            ]);
        } else if (name === "fail") {
            audio.sequence([
                [220, 0.12, "sawtooth", 0.45],
                [160, 0.2, "sawtooth", 0.5],
            ]);
        }
    },
};

// ΓöÇΓöÇ Scene bootstrap ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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
            if (activeRun) updateGhost(activeRun, e);
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
        if (!activeRun || activeRun.mode !== "build") return;
        if (overlayOpen()) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (canvas.height / rect.height);
        const ray = scene.unprojectLocal(mx, my);
        if (!ray) return;
        const hit = scene.raycast(ray.origin, ray.dir, 200);
        if (hit && hit.node) {
            const key = activeRun.meshToCell.get(hit.node.id);
            if (key && removePiece(activeRun, key)) {
                activeRun.play("remove");
                refreshPalette(activeRun);
                return;
            }
        }
        const c = cellUnderCursor(activeRun, e);
        if (c) {
            const key = cellKey(c.cx, c.cy, c.cz);
            if (removePiece(activeRun, key)) {
                activeRun.play("remove");
                refreshPalette(activeRun);
            }
        }
    });
    canvas.addEventListener("click", (e) => {
        if (e.button !== 0) return;
        if (!activeRun || activeRun.mode !== "build" || overlayOpen()) return;
        const c = cellUnderCursor(activeRun, e);
        if (!c) return;
        const placed = placePiece(activeRun, activeRun.build.selected, c.cx, c.cy, c.cz, activeRun.build.rot);
        if (placed) {
            activeRun.play("place");
            refreshPalette(activeRun);
            updateGhost(activeRun, e);
            advanceCoach(activeRun, "place");
        } else {
            toast("Cannot place there.");
        }
    });
    canvas.addEventListener("mousemove", (e) => {
        if (activeRun) updateGhost(activeRun, e);
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

// ΓöÇΓöÇ Level load ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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
    // Prefer ramps first — most tutorial/path levels want a slope selected.
    const pickOrder = ["ramp", "booster", "chute", "bumper", "spinner", "wall", "block"];
    run.build.selected =
        pickOrder.find((t) => budget[t] && (budget[t].limit || 0) > 0) ||
        PIECE_ORDER.find((t) => budget[t] && (budget[t].limit || 0) > 0) ||
        "block";
    run.build.rot = 0;
    run.build.layer = Math.max(0, run.level.bounds.y[0]);

    for (const f of run.level.furniture || []) {
        placePiece(run, f.type, f.cell[0], f.cell[1], f.cell[2], f.rot || 0, { furniture: true });
    }

    enterBuildMode(run);
    refreshPalette(run);
    beginLevelCoach(run);
    if (run.level.tagline) toast(run.level.tagline, 1800);
}

function teardownScene(run) {
    if (!scene) return;

    // Cancel deferred fail from a previous run before touching bodies.
    if (run && run.pendingFail) {
        clearTimeout(run.pendingFail);
        run.pendingFail = null;
    }

    // Prefer structured teardown (marbles → pieces → ghost) so we never
    // double-free through getAllTransforms after a partial destroy.
    if (run && run.marbles && run.marbles.length) {
        for (const m of run.marbles.slice()) {
            try {
                if (m.body != null) Physics.destroyBody(m.body);
            } catch (e) { /* already gone */ }
            try {
                if (m.node) scene.destroyNode(m.node);
            } catch (e) { /* already gone */ }
        }
        run.marbles.length = 0;
    }

    if (run && run.placed && run.placed.size) {
        for (const key of Array.from(run.placed.keys())) {
            const rec = run.placed.get(key);
            if (!rec) continue;
            try {
                if (rec.node) scene.destroyNode(rec.node);
            } catch (e) { /* ignore */ }
            for (const ex of rec.extras || []) {
                try { scene.destroyNode(ex); } catch (e) { /* ignore */ }
            }
            try {
                if (rec.body != null) Physics.destroyBody(rec.body);
            } catch (e) { /* ignore */ }
            for (const eb of rec.extraBodies || []) {
                try { Physics.destroyBody(eb); } catch (e) { /* ignore */ }
            }
        }
        run.placed.clear();
    }

    try { destroyGhost(); } catch (e) { /* ignore */ }
    try { destroySuggestPads(); } catch (e) { /* ignore */ }
    SCENE.guides.length = 0;

    // Environment meshes (ground, goal, spout, lights under root)
    try {
        const rootChildren = scene.root.children.slice();
        for (const n of rootChildren) {
            try { scene.destroyNode(n); } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }

    // Sweep any leftover default-world bodies (environment colliders, strays).
    try {
        const all = Physics.getAllTransforms();
        const tags = [];
        for (let i = 0; i < all.length; i += 8) tags.push(all[i] | 0);
        for (let t = 0; t < tags.length; t++) {
            try { Physics.destroyBody(tags[t]); } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }

    SCENE.groundNode = null;
    SCENE.goalMarker = null;
    SCENE.goalFill = null;
    SCENE.spoutNode = null;
    SCENE.layerPlane = null;
    SCENE.ghostParts.length = 0;
    SCENE.ghostIds.clear();
    SCENE.staticDecor.length = 0;
    goalPulseGen += 1; // invalidate any pending pulseGoal timeout
    if (run) {
        run.meshToCell.clear();
        run.bodyToCell.clear();
        run.animatedCells.length = 0;
        run.marblesSpawned = 0;
        run.marblesRemoved = 0;
        run.resultMs = null;
        run.runtime = 0;
        run.pending = null;
        run.newBest = false;
        run.failAfter = null;
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
        // Low friction so failed marbles slide instead of gluing to the floor.
        friction: 0.18, restitution: 0.15,
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
    // Bright drop column so the spout is impossible to miss.
    SCENE.guides.push(scene.createMesh({
        mesh: "cylinder", radius: 0.06, halfHeight: Math.max(0.8, sp.y * 0.45),
        segments: 10,
        x: sp.x, y: sp.y * 0.5, z: sp.z,
        color: "#ffd466",
        emissive: 1.2, emissiveColor: [1.0, 0.8, 0.3],
        metallic: 0.0, roughness: 1.0,
        name: "drop-column",
    }));
    // Landing ring under the spout — "place pieces here".
    SCENE.guides.push(scene.createMesh({
        mesh: "cylinder", radius: 0.55, halfHeight: 0.03, segments: 28,
        x: sp.x, y: 0.04, z: sp.z,
        color: "#ffc166",
        emissive: 2.4, emissiveColor: [1.0, 0.75, 0.25],
        metallic: 0.05, roughness: 0.5,
        name: "drop-zone",
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
    // Low visual lip only — full-height physics walls blocked lateral entries
    // (marbles rolling in from a runway never entered the cup AABB).
    const lipH = 0.1;
    const lips = [
        { x: g.min[0], y: g.min[1] + lipH * 0.5, z: gcz, hw: 0.035, hh: lipH * 0.5, hd: ghd + 0.03 },
        { x: g.max[0], y: g.min[1] + lipH * 0.5, z: gcz, hw: 0.035, hh: lipH * 0.5, hd: ghd + 0.03 },
        { x: gcx, y: g.min[1] + lipH * 0.5, z: g.min[2], hw: ghw + 0.03, hh: lipH * 0.5, hd: 0.035 },
        { x: gcx, y: g.min[1] + lipH * 0.5, z: g.max[2], hw: ghw + 0.03, hh: lipH * 0.5, hd: 0.035 },
    ];
    for (const ww of lips) {
        Physics.createBody({
            shape: "box", static: true,
            halfExtents: { x: ww.hw, y: ww.hh, z: ww.hd },
            position: { x: ww.x, y: ww.y, z: ww.z },
            friction: 0.35, restitution: 0.15,
        });
        SCENE.staticDecor.push(scene.createMesh({
            mesh: "box", halfW: ww.hw, halfH: ww.hh, halfD: ww.hd,
            x: ww.x, y: ww.y, z: ww.z,
            color: "#1e4a2e",
            emissive: 0.35, emissiveColor: [0.2, 0.9, 0.5],
            metallic: 0.05, roughness: 0.7,
        }));
    }
    // Goal beacon — tall green marker above the cup.
    SCENE.guides.push(scene.createMesh({
        mesh: "cylinder", radius: 0.08, halfHeight: 0.9, segments: 12,
        x: gcx, y: g.max[1] + 1.1, z: gcz,
        color: "#4eff8f",
        emissive: 2.5, emissiveColor: [0.25, 1.0, 0.5],
        metallic: 0.0, roughness: 0.4,
        name: "goal-beacon",
    }));
    SCENE.guides.push(scene.createMesh({
        mesh: "sphere", radius: 0.22, segments: 16, rings: 12,
        x: gcx, y: g.max[1] + 2.15, z: gcz,
        color: "#7dffb0",
        emissive: 3.0, emissiveColor: [0.3, 1.0, 0.55],
        metallic: 0.1, roughness: 0.3,
        name: "goal-orb",
    }));

    // Path dashes on the ground: spout XZ → cup XZ (where to build).
    addPathGuides(sp.x, sp.z, gcx, gcz);

    // Build grid so the play field feels like a placeable board.
    addBuildGrid(level);

    SCENE.layerPlane = scene.createMesh({
        mesh: "plane",
        halfW: (bx[1] - bx[0] + 1) * 0.5,
        halfD: (bz[1] - bz[0] + 1) * 0.5,
        x: cx, y: 0, z: cz,
        color: "#2a3458",
        emissive: 0.22, emissiveColor: [0.4, 0.55, 1.0],
        metallic: 0.0, roughness: 1.0,
        name: "layer-plane",
    });
    SCENE.layerPlane.visible = false;

    // Prefab suggestion pads for verified solution cells (empty board only).
    buildSuggestPads(level);

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

function pushGuide(mesh) {
    SCENE.guides.push(mesh);
    return mesh;
}

/** Ground dashes from spout to cup — the "build along this" affordance. */
function addPathGuides(sx, sz, gx, gz) {
    const dx = gx - sx;
    const dz = gz - sz;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const steps = Math.max(3, Math.min(12, Math.round(len * 1.4)));
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = sx + dx * t;
        const z = sz + dz * t;
        pushGuide(scene.createMesh({
            mesh: "box",
            halfW: 0.18, halfH: 0.02, halfD: 0.08,
            x, y: 0.05, z,
            ry: Math.atan2(dx, dz) * (180 / Math.PI),
            color: "#6ec8ff",
            emissive: 1.8, emissiveColor: [0.35, 0.75, 1.0],
            metallic: 0.0, roughness: 0.5,
            name: "path-dash-" + i,
        }));
    }
    // Arrow head near the cup.
    pushGuide(scene.createMesh({
        mesh: "box",
        halfW: 0.28, halfH: 0.025, halfD: 0.1,
        x: gx - dx / len * 0.7,
        y: 0.06,
        z: gz - dz / len * 0.7,
        ry: Math.atan2(dx, dz) * (180 / Math.PI),
        color: "#4eff8f",
        emissive: 2.2, emissiveColor: [0.3, 1.0, 0.55],
        metallic: 0.0, roughness: 0.4,
        name: "path-arrow",
    }));
}

function addBuildGrid(level) {
    const bx = level.bounds.x, bz = level.bounds.z;
    for (let x = bx[0]; x <= bx[1] + 1; x++) {
        const z0 = bz[0], z1 = bz[1] + 1;
        const midZ = (z0 + z1) * 0.5;
        const half = (z1 - z0) * 0.5;
        pushGuide(scene.createMesh({
            mesh: "box",
            halfW: 0.015, halfH: 0.008, halfD: half,
            x: x, y: 0.01, z: midZ,
            color: "#3a4a70",
            emissive: 0.25, emissiveColor: [0.4, 0.5, 0.85],
            metallic: 0.0, roughness: 1.0,
        }));
    }
    for (let z = bz[0]; z <= bz[1] + 1; z++) {
        const x0 = bx[0], x1 = bx[1] + 1;
        const midX = (x0 + x1) * 0.5;
        const half = (x1 - x0) * 0.5;
        pushGuide(scene.createMesh({
            mesh: "box",
            halfW: half, halfH: 0.008, halfD: 0.015,
            x: midX, y: 0.01, z: z,
            color: "#3a4a70",
            emissive: 0.25, emissiveColor: [0.4, 0.5, 0.85],
            metallic: 0.0, roughness: 1.0,
        }));
    }
}

/** Soft glowing pads on solution cells so first-time builders see where to click. */
function buildSuggestPads(level) {
    destroySuggestPads();
    const idx = LEVELS.indexOf(level);
    const sol = SOLUTIONS[idx];
    if (!sol || !sol.pieces || !sol.pieces.length) return;
    for (const p of sol.pieces) {
        const pad = scene.createMesh({
            mesh: "box",
            halfW: 0.42, halfH: 0.035, halfD: 0.42,
            x: p.x + 0.5, y: (p.y || 0) + 0.06, z: p.z + 0.5,
            color: "#ffc166",
            emissive: 1.6, emissiveColor: [1.0, 0.7, 0.2],
            metallic: 0.05, roughness: 0.45,
            name: "suggest-" + p.x + "-" + p.z,
        });
        pad.visible = true;
        SCENE.suggestPads.push(pad);
    }
}

function destroySuggestPads() {
    for (const p of SCENE.suggestPads) {
        try { if (p) scene.destroyNode(p); } catch (e) { /* ignore */ }
    }
    SCENE.suggestPads.length = 0;
}

function updateSuggestPads(run) {
    if (!SCENE.suggestPads.length) return;
    const show = run && run.mode === "build" && run.placed && run.placed.size === 0;
    for (const p of SCENE.suggestPads) {
        try { p.visible = !!show; } catch (e) { /* ignore */ }
    }
}

function setBuildGuidesVisible(on) {
    for (const g of SCENE.guides) {
        try { if (g) g.visible = !!on; } catch (e) { /* ignore */ }
    }
    // Keep goal beacon mildly visible while running.
    if (!on) {
        for (const g of SCENE.guides) {
            try {
                if (g && (g.name === "goal-beacon" || g.name === "goal-orb")) g.visible = true;
            } catch (e) { /* ignore */ }
        }
    }
}

function refreshMissionSteps(run) {
    const s1 = document.getElementById("mission-1");
    const s2 = document.getElementById("mission-2");
    const s3 = document.getElementById("mission-3");
    if (!s1 || !s2 || !s3) return;
    const placed = run.placed ? run.placed.size : 0;
    const running = run.mode === "run";
    s1.classList.toggle("done", placed > 0 || running);
    s1.classList.toggle("active", !running && placed === 0);
    s2.classList.toggle("done", placed >= 2 || running);
    s2.classList.toggle("active", !running && placed > 0 && placed < 2);
    s3.classList.toggle("done", running || run.resultMs != null);
    s3.classList.toggle("active", !running && placed >= 1);
}

function refreshActionStrip(run) {
    const el = document.getElementById("hud-action");
    const text = document.getElementById("hud-action-text");
    if (!el || !text) return;
    el.classList.toggle("run-mode", run.mode === "run");
    if (run.mode === "run") {
        text.textContent = "Marbles dropping — first into the green cup wins. Space rebuilds.";
        return;
    }
    const placed = run.placed ? run.placed.size : 0;
    const def = PIECES[run.build.selected];
    const name = def ? def.label : "piece";
    if (placed === 0) {
        text.textContent = "Click a gold glowing pad (or under the spout) to place your first " + name + ".";
    } else if (placed < 3) {
        text.textContent = "Keep placing toward the green cup. Press Space when ready to drop.";
    } else {
        text.textContent = "Looks like a path — press Space to drop marbles. Right-click removes mistakes.";
    }
}

function refreshPieceDesc(run) {
    const el = document.getElementById("hud-piece-desc");
    if (!el) return;
    const def = PIECES[run.build.selected];
    if (!def) {
        el.textContent = "Select a piece, then click the board to place it.";
        return;
    }
    const rot = def.rotatable
        ? " Press R to rotate."
        : "";
    el.textContent = def.label + " — " + (def.describe || "Place on the board.") + rot;
}

// ΓöÇΓöÇ Placement ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

// ΓöÇΓöÇ Ghost ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

// ΓöÇΓöÇ Modes / marbles ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function enterBuildMode(run) {
    run.mode = "build";
    run.resultMs = null;
    run.runtime = 0;
    run.failAfter = null;
    if (run.pendingFail) { clearTimeout(run.pendingFail); run.pendingFail = null; }
    for (const m of run.marbles) {
        try {
            if (m.body != null) Physics.destroyBody(m.body);
        } catch (e) { /* ignore */ }
        try {
            if (m.node) scene.destroyNode(m.node);
        } catch (e) { /* ignore */ }
    }
    run.marbles.length = 0;
    run.marblesSpawned = 0;
    run.marblesRemoved = 0;
    if (SCENE.layerPlane) {
        SCENE.layerPlane.visible = true;
        SCENE.layerPlane.y = run.build.layer + 0.001;
    }
    setBuildGuidesVisible(true);
    updateSuggestPads(run);
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
    run.failAfter = null;
    if (run.pendingFail) {
        clearTimeout(run.pendingFail);
        run.pendingFail = null;
    }
    if (SCENE.layerPlane) SCENE.layerPlane.visible = false;
    setGhostVisible(false);
    setBuildGuidesVisible(false);
    updateSuggestPads(run);
    run.play("drop");
    advanceCoach(run, "run");
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
        // Snappy marble: low friction, lively bounce, light damping.
        friction: 0.05, restitution: 0.48,
        linearDamping: 0.02, angularDamping: 0.04,
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

/** World XZ unit vector for ramp downhill (low end) given piece rot 0..3. */
function rampDownhill(rot) {
    const r = rot & 3;
    if (r === 0) return { x: -1, z: 0 };
    if (r === 1) return { x: 0, z: -1 };
    if (r === 2) return { x: 1, z: 0 };
    return { x: 0, z: 1 };
}

/**
 * While a marble rests on / near a ramp or booster, keep a shove along the
 * piece facing so paths feel fair instead of parking mid-slope.
 */
function assistPathMarbles(run, dt) {
    const scale = Math.min(1.2, (dt || 16) / 16);
    for (const m of run.marbles) {
        if (m.body == null) continue;
        const tf = Physics.getTransform(m.body);
        if (!tf) continue;
        const p = tf.position;
        const cx = Math.floor(p.x);
        const cy = Math.floor(p.y);
        const cz = Math.floor(p.z);
        let rec = null;
        for (let dy = 0; dy >= -1 && !rec; dy--) {
            const cand = run.placed.get(cellKey(cx, cy + dy, cz));
            if (cand && (cand.type === "ramp" || cand.type === "booster")) rec = cand;
        }
        if (!rec) continue;
        if (rec.type === "ramp") {
            const d = rampDownhill(rec.rot | 0);
            Physics.addImpulse(m.body, d.x * 0.1 * scale, 0.015 * scale, d.z * 0.1 * scale);
        } else if (rec.type === "booster") {
            const yaw = rotY(rec.rot || 0);
            // Continuous conveyor shove while parked on a booster pad.
            Physics.addImpulse(
                m.body,
                Math.cos(yaw) * 0.22 * scale,
                0.025 * scale,
                Math.sin(yaw) * 0.22 * scale
            );
        }
    }
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
        // Cull marbles that fell off the world OR drifted far outside the
        // place bounds (failed runs used to soft-lock: marbles rest on the
        // ground forever and never hit y < -6).
        const b = run.level.bounds;
        const oob =
            p.y < -4 ||
            p.x < b.x[0] - 3 || p.x > b.x[1] + 3 ||
            p.z < b.z[0] - 3 || p.z > b.z[1] + 3;
        if (oob) {
            destroyMarble(run, m);
            run.marbles.splice(i, 1);
        }
    }

    assistPathMarbles(run, dt);

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
            Physics.addImpulse(marbleId, Math.cos(yaw) * 0.38, 0.06, Math.sin(yaw) * 0.38);
            run.play("clink");
        } else if (rec.type === "spinner") {
            const v = Physics.getVelocity(marbleId);
            if (v) Physics.addImpulse(marbleId, v.linear.x * 0.55, 0.12, v.linear.z * 0.55);
            run.play("clink");
        } else if (rec.type === "bumper") {
            run.play("clink");
        } else if (rec.type === "ramp") {
            const d = rampDownhill(rec.rot | 0);
            Physics.addImpulse(marbleId, d.x * 0.1, 0.03, d.z * 0.1);
        }
    }

    // Fail conditions:
    // 1) Every marble has been culled (fell off) — short grace, then fail.
    // 2) All marbles have been spawned and none scored for a few seconds —
    //    covers the common case of marbles resting on the ground outside the cup.
    if (run.resultMs == null && run.mode === "run") {
        if (run.marblesSpawned >= run.level.maxMarbles &&
            run.marbles.length === 0 &&
            run.pendingFail == null) {
            run.pendingFail = setTimeout(() => {
                if (run.resultMs == null && run.mode === "run") onLevelFailed(run);
            }, 400);
        } else if (run.marblesSpawned >= run.level.maxMarbles && run.marbles.length > 0) {
            if (run.failAfter == null) {
                // Grace after the final marble drops so a late bounce can still score.
                const grace = (run.level && run.level.failGraceMs) || 3500;
                run.failAfter = run.runtime + grace;
            } else if (run.runtime >= run.failAfter) {
                onLevelFailed(run);
            }
        }
    }
}

function onLevelCompleted(run) {
    const t = run.resultMs / 1000;
    const level = run.level;
    const bestMap = Object.assign({}, run.save.get("best") || {});
    const prev = bestMap[level.id];
    run.newBest = prev == null || t < prev;
    if (run.newBest) {
        bestMap[level.id] = t;
        run.save.set("best", bestMap);
    }
    const nextIdx = run.levelIdx + 1;
    const unlocked = run.save.get("unlocked") || 1;
    if (nextIdx < LEVELS.length && nextIdx + 1 > unlocked) {
        run.save.set("unlocked", nextIdx + 1);
    } else if (nextIdx >= LEVELS.length && unlocked < LEVELS.length) {
        run.save.set("unlocked", LEVELS.length);
    }
    // Invert time into a "score" for shell highScore (higher better)
    run.score = Math.max(0, Math.floor(100000 / Math.max(0.01, t)));
    run.save.maybeHighScore(run.score);
    if (run.levelIdx === 0) run.save.set("coachDone", true);
    if (run.levelIdx === 1) run.save.set("plankCoachDone", true);
    run.save.save();
    pulseGoal();
    run.play("goal");
    setCoachVisible(false);

    // Freeze the playfield: stop fail timers and remove live marbles so the
    // complete overlay is not sitting on a still-simulating physics world
    // (restarting mid-sim was crashing headless / Jolt).
    if (run.pendingFail) {
        clearTimeout(run.pendingFail);
        run.pendingFail = null;
    }
    for (const m of run.marbles.slice()) {
        try {
            if (m.body != null) {
                run.bodyToCell.delete(m.body);
                Physics.destroyBody(m.body);
            }
        } catch (e) { /* ignore */ }
        try {
            if (m.node) scene.destroyNode(m.node);
        } catch (e) { /* ignore */ }
    }
    run.marbles.length = 0;
    run.mode = "complete";

    run.pending = "complete";
}

function onLevelFailed(run) {
    run.play("fail");
    toast("No marbles reached the cup. Rebuild and try again.");
    enterBuildMode(run);
    refreshPalette(run);
}

// ΓöÇΓöÇ UI helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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
            run.play("pick");
            refreshPalette(run);
            rebuildGhost(run);
        });
    }
}

function progressSummary(save) {
    const bestMap = save.get("best") || {};
    let cleared = 0;
    let gold = 0;
    let silver = 0;
    let bronze = 0;
    for (let i = 0; i < LEVELS.length; i++) {
        const lv = LEVELS[i];
        const best = bestMap[lv.id];
        if (best == null) continue;
        cleared += 1;
        const m = medalFor(best, lv);
        if (m === "gold") gold += 1;
        else if (m === "silver") silver += 1;
        else if (m === "bronze") bronze += 1;
    }
    const unlocked = Math.min(save.get("unlocked") || 1, LEVELS.length);
    return { cleared, gold, silver, bronze, unlocked, bestMap };
}

function refreshTitleScreen(api) {
    const sum = progressSummary(api.save);
    const last = Math.min(Math.max(0, (api.save.get("lastLevel") || 0) | 0), LEVELS.length - 1);
    const lv = LEVELS[last];

    const progress = document.getElementById("title-progress");
    if (progress) {
        if (sum.cleared === 0) {
            progress.textContent = LEVELS.length + " levels · clear one to unlock the next";
        } else {
            const bits = [sum.cleared + " / " + LEVELS.length + " cleared"];
            if (sum.gold) bits.push(sum.gold + " gold");
            if (sum.silver) bits.push(sum.silver + " silver");
            if (sum.bronze) bits.push(sum.bronze + " bronze");
            progress.textContent = bits.join(" · ");
        }
    }

    const play = document.getElementById("title-play");
    if (play) {
        if (sum.cleared > 0 || last > 0) {
            play.textContent = "Continue — " + lv.name;
        } else {
            play.textContent = "Play — " + lv.name;
        }
    }
}

function fillCompleteScreen(run) {
    const t = (run.resultMs || 0) / 1000;
    const level = run.level;
    const medal = medalFor(t, level);
    const isLast = run.levelIdx >= LEVELS.length - 1;

    const title = document.getElementById("complete-title");
    if (title) {
        const prefix =
            medal === "gold" ? "Gold — " :
            medal === "silver" ? "Silver — " :
            medal === "bronze" ? "Bronze — " : "Complete — ";
        title.textContent = prefix + level.name;
    }
    const timeEl = document.getElementById("complete-time");
    if (timeEl) timeEl.textContent = fmt(t);
    const medalEl = document.getElementById("complete-medal");
    if (medalEl) {
        medalEl.textContent = medal === "none" ? "Complete" : medal.toUpperCase();
        medalEl.className = "medal " + (medal === "none" ? "" : medal);
    }
    const newBest = document.getElementById("complete-newbest");
    if (newBest) {
        newBest.hidden = !run.newBest;
    }
    const bestMap = run.save.get("best") || {};
    const detail = document.getElementById("complete-detail");
    if (detail) {
        detail.textContent =
            "Par  gold " + fmt(level.par.gold) +
            " · silver " + fmt(level.par.silver) +
            " · bronze " + fmt(level.par.bronze) +
            "   ·   Best " + fmt(bestMap[level.id]);
    }
    const nextLine = document.getElementById("complete-next");
    const primary = document.getElementById("complete-primary");
    const titleItem = document.getElementById("complete-title-item");
    if (isLast) {
        if (nextLine) nextLine.textContent = "Tour complete — every level unlocked.";
        if (primary) {
            primary.textContent = "Main Menu";
            primary.setAttribute("data-action", "title");
        }
        if (titleItem) titleItem.hidden = true;
    } else {
        const next = LEVELS[run.levelIdx + 1];
        if (nextLine) nextLine.textContent = "Next up: " + next.name + " — " + (next.tagline || "");
        if (primary) {
            primary.textContent = "Next Level";
            primary.setAttribute("data-action", "next");
        }
        if (titleItem) titleItem.hidden = true;
    }
}

function renderLevelTiles(api) {
    const grid = document.getElementById("levels-grid");
    if (!grid) return;
    const sum = progressSummary(api.save);
    const unlocked = sum.unlocked;
    const current = Math.min(Math.max(0, (api.save.get("lastLevel") || 0) | 0), LEVELS.length - 1);

    const levelsProgress = document.getElementById("levels-progress");
    if (levelsProgress) {
        levelsProgress.textContent =
            sum.cleared + " / " + LEVELS.length + " cleared · " +
            unlocked + " unlocked" +
            (sum.gold ? " · " + sum.gold + " gold" : "");
    }

    // Tiles are .menu-item so shell click/keyboard activates data-action="level-N".
    grid.innerHTML = LEVELS.map((lv, i) => {
        const locked = i >= unlocked;
        const best = sum.bestMap[lv.id];
        const medal = best != null ? medalFor(best, lv) : "none";
        const color =
            medal === "gold" ? "#ffd84a" :
            medal === "silver" ? "#d8dce4" :
            medal === "bronze" ? "#c88a5a" : "#5a6478";
        const medalLabel =
            medal === "gold" ? "Gold" :
            medal === "silver" ? "Silver" :
            medal === "bronze" ? "Bronze" :
            locked ? "Locked" : "Open";
        const cls = [
            "level-tile",
            "menu-item",
            locked ? "locked disabled" : "",
            i === current && !locked ? "current" : "",
        ].filter(Boolean).join(" ");
        const action = locked ? "" : ' data-action="level-' + i + '"';
        return (
            '<div class="' + cls + '"' + action + ">" +
            '<div class="level-num">Level ' + (i + 1) + "</div>" +
            '<div class="level-name">' + lv.name + "</div>" +
            '<div class="level-tag">' + (lv.tagline || "") + "</div>" +
            '<div class="level-best">' + (best != null ? fmt(best) : locked ? "—" : "—") + "</div>" +
            '<div class="level-medal" style="color:' + color + '">' + medalLabel + "</div>" +
            "</div>"
        );
    }).join("");
}

function coachTipsFor(run) {
    if (run.levelIdx === 0 && !run.save.get("coachDone")) return COACH_TIPS_DROPIN;
    if (run.levelIdx === 1 && !run.save.get("plankCoachDone")) return COACH_TIPS_PLANK;
    return null;
}

function beginLevelCoach(run) {
    const tips = coachTipsFor(run);
    if (!tips) {
        setCoachVisible(false);
        run.coachStep = 99;
        return;
    }
    run.coachStep = 0;
    setCoach(tips[0]);
}

function advanceCoach(run, event) {
    const tips = coachTipsFor(run);
    if (!tips) return;
    if (event === "place" && run.coachStep === 0) {
        run.coachStep = 1;
        setCoach(tips[1]);
        return;
    }
    if (event === "place" && run.coachStep === 1) {
        let used = 0;
        for (const t of PIECE_ORDER) used += (budget[t] && budget[t].used) || 0;
        if (used >= 2) {
            run.coachStep = 2;
            setCoach(tips[2]);
        }
        return;
    }
    if (event === "run" && run.coachStep <= 2) {
        run.coachStep = 3;
        setCoachVisible(false);
        if (run.levelIdx === 0) {
            run.save.set("coachDone", true);
        } else if (run.levelIdx === 1) {
            run.save.set("plankCoachDone", true);
        }
        run.save.save();
    }
}

function setCoach(text) {
    const el = document.getElementById("hud-coach");
    const body = document.getElementById("hud-coach-text");
    const step = document.getElementById("coach-step-label");
    if (!el || !body) return;
    body.textContent = text || "";
    el.hidden = !text;
    if (step && activeRun) {
        const tips = coachTipsFor(activeRun);
        const n = tips ? Math.min(tips.length, (activeRun.coachStep | 0) + 1) : 1;
        step.textContent = tips ? ("Tip " + n + " / " + tips.length) : "Tip";
    }
}

function setCoachVisible(on) {
    const el = document.getElementById("hud-coach");
    if (el) el.hidden = !on;
}

function pulseGoal() {
    if (!SCENE.goalMarker && !SCENE.goalFill) return;
    const gen = goalPulseGen;
    const fill = SCENE.goalFill;
    const rimKids = [];
    if (SCENE.goalMarker) {
        try {
            for (const c of SCENE.goalMarker.children || []) rimKids.push(c);
        } catch (e) { /* ignore */ }
    }
    const nodes = fill ? [fill].concat(rimKids) : rimKids.slice();
    for (const n of nodes) {
        try { n.emissive = 4.5; } catch (e) { /* ignore */ }
    }
    setTimeout(() => {
        // Scene may have been torn down / rebuilt since the pulse started.
        if (gen !== goalPulseGen) return;
        for (const n of nodes) {
            try {
                if (n === SCENE.goalFill) n.emissive = 0.6;
                else n.emissive = 2.2;
            } catch (e) { /* ignore */ }
        }
    }, 450);
}

function toast(text, ms) {
    const area = document.getElementById("hud-toast-area") || document.body;
    const el = document.createElement("div");
    el.className = "tumble-toast";
    el.textContent = text;
    area.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, ms || 1600);
}

// ── Test hooks (window.__tumble) ─────────────────────────────────────────

/**
 * Headless / harness surface for bro-headless gameplay tests.
 * Wired from main.js via installTestHooks(shell).
 */
export function installTestHooks(shell) {
    window.__tumble = {
        shell,
        LEVELS,
        PIECES,
        PIECE_ORDER,
        SOLUTIONS,
        medalFor,
        fmt,
        get run() {
            return activeRun || (shell.getRun && shell.getRun()) || null;
        },
        get scene() { return scene; },
        get cam() { return cam; },
        get budget() { return budget; },
        get save() { return shell.api && shell.api.save; },
        get screen() { return shell.getScreen ? shell.getScreen() : null; },

        /** Wipe progress to defaults. */
        resetProgress() {
            const save = this.save;
            if (!save) return;
            save.set("best", {});
            save.set("unlocked", 1);
            save.set("lastLevel", 0);
            save.set("coachDone", false);
            save.set("plankCoachDone", false);
            save.save();
            session.levelIdx = 0;
        },

        /**
         * Place the verified solution for a level on the current run.
         * Call after startLevel(idx). Does not auto-run.
         */
        applySolution(levelIdx) {
            const idx = levelIdx != null ? levelIdx : (this.run && this.run.levelIdx);
            return applySolutionPieces(idx, (type, x, y, z, rot) => this.place(type, x, y, z, rot));
        },

        /** Start (or restart) a run on level index. */
        startLevel(idx) {
            // Tear down any live playfield before shell.create rebuilds it.
            const prev = activeRun || (shell.getRun && shell.getRun());
            if (prev) {
                try { teardownScene(prev); } catch (e) { /* ignore */ }
            }
            session.levelIdx = idx | 0;
            if (shell.startRun) shell.startRun();
            return this.run;
        },

        place(type, cx, cy, cz, rot) {
            const run = this.run;
            if (!run) return false;
            const ok = placePiece(run, type, cx, cy, cz, rot | 0);
            if (ok) {
                if (run.play) run.play("place");
                refreshPalette(run);
                advanceCoach(run, "place");
            }
            return ok;
        },

        removeAt(cx, cy, cz) {
            const run = this.run;
            if (!run) return false;
            const ok = removePiece(run, cellKey(cx, cy, cz));
            if (ok) {
                if (run.play) run.play("remove");
                refreshPalette(run);
            }
            return ok;
        },

        select(type) {
            const run = this.run;
            if (!run || !PIECES[type]) return false;
            run.build.selected = type;
            rebuildGhost(run);
            refreshPalette(run);
            return true;
        },

        rotate() {
            const run = this.run;
            if (!run) return false;
            const def = PIECES[run.build.selected];
            if (!def || !def.rotatable) return false;
            run.build.rot = (run.build.rot + 1) & 3;
            rebuildGhost(run);
            return true;
        },

        setLayer(y) {
            const run = this.run;
            if (!run || !run.level) return false;
            const b = run.level.bounds.y;
            run.build.layer = Math.max(b[0], Math.min(b[1], y | 0));
            if (SCENE.layerPlane) SCENE.layerPlane.y = run.build.layer + 0.001;
            return true;
        },

        enterRun() {
            const run = this.run;
            if (!run) return false;
            enterRunMode(run);
            return true;
        },

        enterBuild() {
            const run = this.run;
            if (!run) return false;
            enterBuildMode(run);
            refreshPalette(run);
            return true;
        },

        /** Snapshot of live run for assertions / logging. */
        snapshot() {
            const run = this.run;
            if (!run || !run.level) {
                return {
                    screen: this.screen,
                    hasRun: !!run,
                };
            }
            let used = 0, limit = 0;
            const budgetSnap = {};
            for (const t of PIECE_ORDER) {
                const b = budget[t] || { used: 0, limit: 0 };
                budgetSnap[t] = { used: b.used, limit: b.limit };
                used += b.used;
                limit += b.limit;
            }
            const marbles = (run.marbles || []).map((m) => {
                if (m.body == null) return null;
                const tf = Physics.getTransform(m.body);
                return tf ? {
                    x: +tf.position.x.toFixed(3),
                    y: +tf.position.y.toFixed(3),
                    z: +tf.position.z.toFixed(3),
                } : null;
            }).filter(Boolean);
            return {
                screen: this.screen,
                levelIdx: run.levelIdx,
                levelId: run.level.id,
                levelName: run.level.name,
                mode: run.mode,
                placed: run.placed.size,
                budgetUsed: used,
                budgetLimit: limit,
                budget: budgetSnap,
                marblesSpawned: run.marblesSpawned,
                marblesAlive: run.marbles.length,
                marblesRemoved: run.marblesRemoved,
                runtimeMs: run.runtime,
                resultMs: run.resultMs,
                newBest: !!run.newBest,
                coachStep: run.coachStep,
                score: run.score,
                marbles,
                unlocked: this.save ? this.save.get("unlocked") : null,
                best: this.save ? this.save.get("best") : null,
                coachDone: this.save ? this.save.get("coachDone") : null,
            };
        },

        /** Force complete UI path (skips physics). */
        forceComplete(timeMs) {
            const run = this.run;
            if (!run) return false;
            run.resultMs = timeMs != null ? timeMs : 2500;
            onLevelCompleted(run);
            return true;
        },
    };
}
