// Tilehaven — arcade plugin (scene, tools, camera, HUD).
// Domain rules: sim.js. Shell owns menus / pause / high score.

import {
    MAP_W, MAP_H, HSTEP, L_GROUND, L_ROADS,
    TILE, FLAG, COSTS, BUILD_INFO, GOAL, START,
    HOUSE_CAP, PROD, CART_LOAD,
    createGame,
} from "/app/sim.js";

// ── Scene state (lazy) ───────────────────────────────────────────────────

let canvas = null;
let scene = null;
let wired = false;
/** @type {object|null} */
let G = null;

const REFUSE_TEXT = {
    coins: "Not enough coins",
    wood: "Not enough wood",
    terrain: "Cannot build on that terrain",
    occupied: "That spot is taken",
    building: "A building is in the way",
    road: "Cannot build on a road",
    forest: "Lumber camps must sit beside a forest",
    ore: "Mines must be built on an ore hill",
    depot: "The depot cannot be demolished",
    bounds: "Out of bounds",
};

const CARGO_COLOR = {
    food: [0.55, 0.95, 0.35, 1],
    wood: [0.62, 0.42, 0.20, 1],
    ore: [1.0, 0.72, 0.25, 1],
};
const HOUSE_TINTS = [
    [0.95, 0.82, 0.62, 1], [0.85, 0.70, 0.72, 1], [0.72, 0.80, 0.88, 1],
];
const SQ = Math.SQRT1_2;

export const game = {
    id: "tilehaven",
    clearColor: "#0a0d12",

    actions: [
        { name: "primary", label: "Confirm", defaults: ["Enter"] },
        { name: "tool_road", label: "Road", defaults: ["r"] },
        { name: "tool_house", label: "House", defaults: ["h"] },
        { name: "tool_farm", label: "Farm", defaults: ["f"] },
        { name: "tool_lumber", label: "Lumber", defaults: ["l"] },
        { name: "tool_mine", label: "Mine", defaults: ["m"] },
        { name: "tool_market", label: "Market", defaults: ["k"] },
        { name: "tool_dozer", label: "Bulldoze", defaults: ["b"] },
        { name: "save", label: "Save", defaults: ["F5"] },
        { name: "load", label: "Load", defaults: ["F9"] },
    ],

    create(ctx) {
        ensureScene();
        ensureWiring();

        const sim = createGame(scene);
        const run = {
            score: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            sim,
            tool: null,
            selected: null,
            hoverCell: null,
            painting: false,
            applied: new Map(),
            camera: { panX: 0, panZ: 0, zoom: 1 },
            baseCX: 0, baseCZ: 0, baseSize: 12,
            panKeys: { right: false, left: false, up: false, down: false },
            lastWarnSig: "",
            toastTimer: null,
            victoryShown: false,
        };
        G = run;
        frameCamera(run);
        fillPaletteCosts();

        sim.onToast = (msg) => toast(run, msg);
        sim.onRefused = (r) => {
            toast(run, REFUSE_TEXT[r.reason] || "Cannot do that");
            ctx.play("refuse");
        };
        sim.onVictory = () => {
            run.score = sim.pop * 10 + sim.coins;
            run.victoryShown = true;
            ctx.play("win");
        };

        exposeDebug(run);
        return run;
    },

    update(run, dt, input) {
        G = run;
        if (!run || !run.sim) return;

        if (run.victoryShown && run.sim.victory && !run.sim.sandbox) {
            run.victoryShown = false;
            fillVictory(run);
            return { status: "screen", name: "victory" };
        }

        const dtSec = Math.min(0.05, Math.max(0, dt / 1000));
        run.sim.update(dtSec);
        run.sim.world.advance(dt);
        updatePan(run, dtSec);

        if (input.pressed("tool_road")) setTool(run, "road");
        if (input.pressed("tool_house")) setTool(run, "house");
        if (input.pressed("tool_farm")) setTool(run, "farm");
        if (input.pressed("tool_lumber")) setTool(run, "lumber");
        if (input.pressed("tool_mine")) setTool(run, "mine");
        if (input.pressed("tool_market")) setTool(run, "market");
        if (input.pressed("tool_dozer")) setTool(run, "dozer");
        if (input.pressed("save") && run.sim.saveCity()) toast(run, "City saved");
        if (input.pressed("load")) doLoad(run);

        // Hold pan via standard directions
        run.panKeys.right = input.down("right");
        run.panKeys.left = input.down("left");
        run.panKeys.up = input.down("up");
        run.panKeys.down = input.down("down");

        const blink = (run.sim.time % 1.2) < 0.7;
        const warnSig = run.sim.buildings.filter(b => !b.connected).map(b => b.id).join(",") +
            "|" + blink + "|" + (run.selected ? run.selected.id : "") + "|" +
            (run.hoverCell ? run.hoverCell.x + "," + run.hoverCell.y + "," + run.tool : "");
        if (warnSig !== run.lastWarnSig) {
            run.lastWarnSig = warnSig;
            applyTints(run);
        }

        syncRender(run);
    },

    draw() {},

    hud(run) {
        if (!run || !run.sim) {
            return { coins: "0", pop: "0", food: "0", wood: "0", ore: "0", carts: "0", goal: "GOAL" };
        }
        const sim = run.sim;
        for (const t of ["road", "house", "farm", "lumber", "mine", "market", "dozer"]) {
            const btn = document.getElementById("btn-" + t);
            if (!btn) continue;
            btn.classList.toggle("selected", run.tool === t);
            if (COSTS[t]) {
                btn.classList.toggle("poor",
                    sim.coins < COSTS[t].coins || sim.wood < COSTS[t].wood);
            }
        }
        refreshInfoPanel(run);
        return {
            coins: String(sim.coins),
            pop: String(sim.pop),
            food: String(sim.food),
            wood: String(sim.wood),
            ore: String(sim.ore),
            carts: String(sim.carts.length),
            goal: sim.victory
                ? "GOAL REACHED"
                : "GOAL  " + sim.pop + "/" + GOAL.pop + " pop ┬╖ " +
                  Math.min(sim.coins, GOAL.coins) + "/" + GOAL.coins + " coins",
        };
    },

    gameOverText(run) {
        const sim = run && run.sim;
        if (!sim) return "";
        return "Population " + sim.pop + " ┬╖ " + sim.coins + " coins\n" +
            sim.totalHauls + " cart hauls ┬╖ " + sim.totalOreSold + " ore sold";
    },

    onMenuAction(action, run) {
        if (action === "continue" && run) {
            run.sim.sandbox = true;
            return "playing";
        }
        return null;
    },

    onEnterScreen(name, run) {
        if (name === "victory" && run) fillVictory(run);
    },

    cue(name, audio) {
        if (name === "refuse") audio.tone(200, 0.06, "square", 0.35);
        else if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.5],
                [659, 0.1, "square", 0.55],
                [784, 0.18, "square", 0.6],
            ]);
        }
    },
};

function ensureScene() {
    if (scene) return;
    canvas = document.getElementById("view");
    if (!canvas) throw new Error("tilehaven: #view canvas missing");
    scene = canvas.getContext("scene");
    if (!scene) throw new Error("tilehaven: scene context unavailable");
    scene.setToneMap({ mode: "aces", exposure: 0.98, gamma: 2.2 });
    scene.setAmbient([0.21, 0.22, 0.26]);
    scene.createLight({
        type: "directional",
        direction: [-0.55, -1.0, -0.30],
        color: [1.0, 0.96, 0.87],
        intensity: 2.0,
    });
    window.addEventListener("resize", () => { if (G) frameCamera(G); });
}

function frameCamera(run) {
    if (!scene || !canvas || !run.sim) return;
    const b = run.sim.world.worldBounds();
    run.baseCX = (b.minX + b.maxX) / 2;
    run.baseCZ = (b.minZ + b.maxZ) / 2;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const spanZ = b.maxZ - b.minZ;
    const diag = Math.hypot(b.maxX - b.minX, spanZ);
    run.baseSize = Math.max(spanZ * 0.72 + 2.0, (diag * 0.72 + 1.5) / aspect);
    applyCamera(run, aspect);
}

function applyCamera(run, aspect) {
    if (aspect === undefined) {
        const rect = canvas.getBoundingClientRect();
        aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    }
    const cx = run.baseCX + run.camera.panX, cz = run.baseCZ + run.camera.panZ;
    scene.setCamera({
        mode: "orthographic",
        size: run.baseSize * run.camera.zoom, aspect, near: 0.1, far: 200,
        position: [cx + 14, 16, cz + 14],
        target: [cx, 0, cz],
    });
}

function updatePan(run, dt) {
    const s = 9 * dt * run.camera.zoom;
    let dx = 0, dz = 0;
    if (run.panKeys.right) { dx += SQ * s; dz -= SQ * s; }
    if (run.panKeys.left) { dx -= SQ * s; dz += SQ * s; }
    if (run.panKeys.up) { dx += SQ * s; dz += SQ * s; }
    if (run.panKeys.down) { dx -= SQ * s; dz -= SQ * s; }
    if (dx || dz) {
        run.camera.panX = Math.max(-14, Math.min(14, run.camera.panX + dx));
        run.camera.panZ = Math.max(-10, Math.min(10, run.camera.panZ + dz));
        applyCamera(run);
    }
}

function desiredTints(run) {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + "," + y, rgb);
    };
    const sim = run.sim, world = sim.world;
    const blinkOn = (sim.time % 1.2) < 0.7;
    for (const b of sim.buildings) {
        if (b.connected) continue;
        put(b.x, b.y, blinkOn ? [1.9, 0.42, 0.38] : [1.45, 0.6, 0.55]);
    }
    if (run.selected) {
        for (const c of sim.routeFor(run.selected)) put(c.x, c.y, [1.45, 1.3, 0.55]);
        put(run.selected.x, run.selected.y, [1.55, 1.35, 0.6]);
    }
    if (run.tool && run.hoverCell) {
        const { x, y } = run.hoverCell;
        if (run.tool === "road") {
            const chk = sim.canPaintRoad(x, y);
            put(x, y, chk.ok ? (chk.bridge ? [0.65, 1.1, 1.55] : [0.6, 1.5, 0.65])
                : [1.8, 0.45, 0.45]);
        } else if (run.tool === "dozer") {
            const has = sim.buildingAt(x, y) || world.getTile(x, y, L_ROADS) !== 0;
            put(x, y, has ? [1.7, 0.9, 0.4] : [1.2, 1.2, 1.2]);
        } else {
            put(x, y, sim.canPlace(run.tool, x, y).ok ? [0.6, 1.5, 0.65] : [1.8, 0.45, 0.45]);
            if (run.tool === "lumber")
                for (const c of world.cellsInRange(x, y, 1, "vertex"))
                    if (world.getTile(c.x, c.y, L_GROUND) === TILE.FOREST)
                        put(c.x, c.y, [1.2, 1.45, 0.8]);
        }
    }
    return want;
}

function applyTints(run) {
    const world = run.sim.world;
    const want = desiredTints(run);
    let dirty = false;
    for (const k of run.applied.keys()) {
        if (!want.has(k)) {
            const [x, y] = k.split(",").map(Number);
            world.setTint(x, y, 1, 1, 1, 1);
            run.applied.delete(k);
            dirty = true;
        }
    }
    for (const [k, rgb] of want) {
        const cur = run.applied.get(k);
        if (cur && cur[0] === rgb[0] && cur[1] === rgb[1] && cur[2] === rgb[2]) continue;
        const [x, y] = k.split(",").map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        run.applied.set(k, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

function syncRender(run) {
    const sim = run.sim, world = sim.world, K = sim.kinds;
    const km = {
        depot: K.depot, house: K.house, farm: K.farm,
        lumber: K.lumber, mine: K.mine, market: K.market,
    };
    for (const t of Object.keys(km)) world.clearObjects(km[t]);
    world.clearObjects(K.houseRoof);
    world.clearObjects(K.cart);
    world.clearObjects(K.cargo);
    world.clearObjects(K.warn);

    for (const b of sim.buildings) {
        const opts = { yaw: b.yaw, scale: b.type === "depot" ? 1.5 : 1.15 };
        if (b.type === "house") {
            opts.color = HOUSE_TINTS[b.id % HOUSE_TINTS.length];
            opts.scale = 1.0 + 0.05 * Math.min(b.pop, HOUSE_CAP);
        }
        world.addObject(km[b.type], b.x, b.y, opts);
        if (b.type === "house")
            world.addObject(K.houseRoof, b.x, b.y, { yaw: opts.yaw, scale: opts.scale });
        if (!b.connected)
            world.addObject(K.warn, b.x, b.y, {
                yOffset: 0.95 + 0.08 * Math.sin(sim.time * 5 + b.id),
            });
    }

    for (const c of sim.carts) {
        const pos = sim.cartPos(c);
        const cx = Math.round(pos.x), cy = Math.round(pos.y);
        const a = c.path[c.seg], b2 = c.path[Math.min(c.seg + 1, c.path.length - 1)];
        const ea = world.getElevation(a.x, a.y) * HSTEP;
        const eb = world.getElevation(b2.x, b2.y) * HSTEP;
        const desiredY = ea + (eb - ea) * c.t + 0.02;
        const cellTop = world.getElevation(cx, cy) * HSTEP;
        const yaw = Math.atan2(b2.x - a.x, b2.y - a.y);
        world.addObject(K.cart, cx, cy, {
            yaw, offsetX: pos.x - cx, offsetZ: pos.y - cy,
            yOffset: desiredY - cellTop,
        });
        if (c.goods)
            world.addObject(K.cargo, cx, cy, {
                yaw, offsetX: pos.x - cx, offsetZ: pos.y - cy,
                yOffset: desiredY - cellTop + 0.19,
                color: CARGO_COLOR[c.goods.res],
            });
    }
    world.rebuildObjects();
}

function toast(run, msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.display = "";
    if (run.toastTimer) clearTimeout(run.toastTimer);
    run.toastTimer = setTimeout(() => { t.style.display = "none"; }, 1900);
}

function fillPaletteCosts() {
    for (const t of ["road", "house", "farm", "lumber", "mine", "market", "dozer"]) {
        const btn = document.getElementById("btn-" + t);
        if (!btn) continue;
        const costEl = btn.querySelector(".tb-cost");
        if (costEl && COSTS[t]) {
            costEl.textContent = COSTS[t].coins + "c" +
                (COSTS[t].wood ? " + " + COSTS[t].wood + "w" : "");
        }
    }
}

function refreshInfoPanel(run) {
    const panel = document.getElementById("info-panel");
    if (!panel) return;
    if (!run.selected) { panel.style.display = "none"; return; }
    const b = run.selected, sim = run.sim;
    const info = BUILD_INFO[b.type] || { name: "Depot", desc: "The heart of your city." };
    const name = document.getElementById("ip-name");
    const status = document.getElementById("ip-status");
    if (name) name.textContent = info.name;
    let text;
    if (b.type === "depot") text = "Hub ┬╖ " + sim.totalHauls + " hauls received";
    else if (!b.connected) text = "NOT ROAD-CONNECTED ΓÇö build a road to the depot!";
    else if (b.type === "house") text = b.pop + "/" + HOUSE_CAP + " residents" +
        (sim.food < 1 ? " ┬╖ needs food" : "");
    else if (b.type === "market") text = "Trading hub ΓÇö carts deliver here";
    else if (!b.staffed) text = "NO WORKERS ΓÇö build houses (" + sim.pop + "/" + sim.jobs() + " jobs filled)";
    else text = "Producing " + PROD[b.type].res + " ┬╖ stock " + b.stock + "/" + CART_LOAD +
        (b.cartOut ? " ┬╖ cart en route" : "");
    if (status) {
        status.textContent = text;
        status.classList.toggle("warn-text", !b.connected || (PROD[b.type] && !b.staffed));
    }
    panel.style.display = "";
}

function fillVictory(run) {
    const sim = run.sim;
    const sub = document.getElementById("victory-stats");
    if (sub) {
        sub.textContent =
            "Population " + sim.pop + " ┬╖ " + sim.coins + " coins ┬╖ " +
            sim.totalHauls + " cart hauls ┬╖ " + sim.totalOreSold + " ore sold";
    }
}

function setTool(run, t) {
    run.tool = (run.tool === t) ? null : t;
    run.selected = null;
    applyTints(run);
}

function pickCell(e) {
    if (!G || !scene) return null;
    const rect = canvas.getBoundingClientRect();
    const ray = scene.unprojectLocal(e.clientX - rect.left, e.clientY - rect.top);
    if (!ray) return null;
    const hit = G.sim.world.raycastCell(ray.origin, ray.dir, 500);
    return hit ? { x: hit.x, y: hit.y } : null;
}

function actOnCell(run, x, y) {
    if (run.tool === "road") {
        if (run.sim.paintRoad(x, y)) run.sim.world.rebuild();
        return;
    }
    if (run.tool === "dozer") {
        const r = run.sim.bulldoze(x, y);
        if (r.ok) {
            run.sim.world.rebuild();
            if (r.what === "building") toast(run, "Demolished (+" + r.refund + " coins)");
        } else if (r.reason === "depot") {
            run.sim.onRefused({ reason: "depot" });
        }
        return;
    }
    if (run.tool) {
        const b = run.sim.placeBuilding(run.tool, x, y);
        if (b) run.sim.world.rebuild();
        return;
    }
    const b = run.sim.buildingAt(x, y);
    run.selected = (b && b !== run.selected) ? b : null;
    applyTints(run);
}

function doLoad(run) {
    if (!run.sim.hasSave()) { toast(run, "No saved city"); return; }
    if (run.sim.loadCity()) {
        run.selected = null; run.tool = null;
        run.applied.clear();
        applyTints(run);
        run.sim.world.rebuild();
        toast(run, "City loaded");
    } else toast(run, "Save file is corrupt");
}

function ensureWiring() {
    if (wired) return;
    wired = true;
    ensureScene();

    canvas.addEventListener("mousedown", (e) => {
        if (!G) return;
        if (e.button === 2) { setTool(G, null); return; }
        if (e.button !== 0) return;
        const c = pickCell(e);
        if (!c) return;
        actOnCell(G, c.x, c.y);
        if (G.tool === "road" || G.tool === "dozer") G.painting = true;
    });
    canvas.addEventListener("mouseup", () => { if (G) G.painting = false; });
    canvas.addEventListener("mousemove", (e) => {
        if (!G) return;
        const c = pickCell(e);
        if (!c) {
            if (G.hoverCell) { G.hoverCell = null; applyTints(G); }
            return;
        }
        const changed = !G.hoverCell || G.hoverCell.x !== c.x || G.hoverCell.y !== c.y;
        G.hoverCell = c;
        if (G.painting && changed && (G.tool === "road" || G.tool === "dozer")) {
            actOnCell(G, c.x, c.y);
        }
        if (changed) applyTints(G);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
        if (!G) return;
        G.camera.zoom = Math.max(0.45, Math.min(1.6, G.camera.zoom * (1 + e.deltaY * 0.06)));
        applyCamera(G);
    });

    for (const t of ["road", "house", "farm", "lumber", "mine", "market", "dozer"]) {
        const btn = document.getElementById("btn-" + t);
        if (btn) btn.addEventListener("click", () => { if (G) setTool(G, t); });
    }
    const saveBtn = document.getElementById("btn-save");
    if (saveBtn) saveBtn.addEventListener("click", () => {
        if (G && G.sim.saveCity()) toast(G, "City saved");
    });
    const loadBtn = document.getElementById("btn-load");
    if (loadBtn) loadBtn.addEventListener("click", () => { if (G) doLoad(G); });
}

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
    window.HAVEN = {
        game: run.sim,
        world: run.sim.world,
        scene,
        projectCell,
        actOnCell: (x, y) => actOnCell(run, x, y),
        setTool: (t) => setTool(run, t),
        get tool() { return run.tool; },
        get selected() { return run.selected; },
        TILE, FLAG, COSTS, GOAL, MAP_W, MAP_H,
        debug: {
            addCoins(n) { run.sim.coins += n; },
            addRes(res, n) { run.sim[res] += n; },
            setHousePop(b, n) {
                if (b.type !== "house") return;
                run.sim.pop += n - b.pop;
                b.pop = n;
            },
            fillStock(b) { b.stock = CART_LOAD; },
            select(b) { run.selected = b; applyTints(run); },
        },
    };
}

