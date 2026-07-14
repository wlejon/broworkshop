// Farm — arcade foundation plugin (3D NPC farm sim).
// Domain modules preserved: world, orchestrator, tasks, player, render3d,
// stations, voice, defs, env, market, knowledge.
// Shell owns menus / pause / session; scene lives on #view.

import { createWorld } from "/app/world.js";
import { createRenderer } from "/app/render3d.js";
import {
    STAT_KEYS, STAT_LABEL, STAT_MAX_LEVEL, statXpToNext,
    staminaMaxFor, staminaDrainMul, moveSpeedMul, proficiencyMul, ROLE_COLOR,
    healthMaxFor, healthRegenMul, hydrationDrainMul, STATIONS,
    GRID, REGIONS,
} from "/app/defs.js";
import { advanceTask } from "/app/tasks.js";
import { createOrchestrator } from "/app/orchestrator.js";
import { initPlayer, movePlayer, runInteract, buyFeed } from "/app/player.js";
import { createVoice } from "/app/voice.js";

const W_FALLBACK = 1100;
const H_FALLBACK = 760;
const DECIDE_INTERVAL = 1000;

const STATION_LABEL = {};
for (const s of STATIONS) STATION_LABEL[s.id] = s.label;
const STATION_SHORT = { pasture: "Pasture", coop: "Coop", meadow: "Meadow", garden: "Garden" };

const STATE_LABEL = {
    idle: "idle", working: "working", resting: "resting", sleeping: "asleep",
    eating: "eating", recovering: "recovering", waiting: "in line",
    talking: "talking", listening: "listening",
};
const PANEL_STATE = {
    idle: "idle", working: "working", walking: "walking", resting: "resting",
    sleeping: "asleep", eating: "eating", recovering: "recovering", talking: "talking",
    listening: "listening", waiting: "waiting to report", supervising: "supervising",
};
const ROLE_DISPLAY = {
    rancher: "Rancher", gardener: "Gardener", farmhand: "Farmhand", foreman: "Foreman",
};
const GOOD_LABEL = { eggs: "Eggs", milk: "Milk", wool: "Wool", crops: "Crop", feed: "Feed" };
const WEATHER_LABEL = {
    clear: "☀ Clear", rain: "🌧 Rain", drought: "🔥 Drought",
    frost: "❄ Frost", storm: "⛈ Storm",
};

// ── Module scene + sim (built once; Play continues the farm) ─────────────
let canvas = null;
let scene = null;
let world = null;
let renderer = null;
let orchestrator = null;
let voice = null;
let wired = false;
let debugWired = false;
let apiRef = null;
let decideAccum = 0;
let hudAccum = 0;
let statOpen = false;

/** @type {object|null} */
let G = null;

export const game = {
    id: "farm",
    clearColor: "#10160f",

    actions: [
        { name: "primary", label: "Interact", defaults: ["e", " "] },
        { name: "market", label: "Buy feed", defaults: ["m"] },
    ],

    create(ctx) {
        apiRef = ctx;
        ensureScene();
        ensureSim(ctx);
        ensureWiring(ctx);

        decideAccum = 0;
        hudAccum = 0;

        const run = {
            score: world && world.resources ? (world.resources.gold | 0) : 0,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            audio: ctx.audio,
        };
        G = run;
        updateHUD();
        return run;
    },

    update(run, dt, input) {
        G = run;
        if (!world || !renderer) return;

        if (input.pressed("primary")) doInteract(run);
        if (input.pressed("market")) doBuyFeed(run);

        const dx = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
        const dy = (input.down("down") ? 1 : 0) - (input.down("up") ? 1 : 0);
        movePlayer(world, dt, dx, dy);

        world.step(dt);

        for (const n of world.npcs) {
            if (n.task) advanceTask(world, n, dt);
        }

        decideAccum += dt;
        const anyIdle = world.npcs.some((n) => n.task == null);
        if (globalThis.farmAuto && (decideAccum >= DECIDE_INTERVAL || anyIdle)) {
            decideAccum = 0;
            orchestrator.decide(world);
        }

        hudAccum += dt;
        if (hudAccum >= 250) {
            hudAccum = 0;
            updateHUD();
        }

        if (world.resources) run.score = world.resources.gold | 0;
    },

    draw() {
        if (!renderer || !world || !canvas) return;
        const w = canvas.clientWidth || canvas.width || W_FALLBACK;
        const h = canvas.clientHeight || canvas.height || H_FALLBACK;
        renderer.frame(world, w, h);
    },

    hud(run) {
        // Complex DOM HUD is refreshed via updateHUD (innerHTML panels).
        if (run && world) updateHUD();
        return {};
    },

    gameOverText(run) {
        if (!world) return "";
        const o = world.observe();
        return (
            "Day " + o.clock.day + " · " + o.clock.time + "\n" +
            "Gold: " + o.resources.gold + "g"
        );
    },

    onEnterScreen(name) {
        if (name === "pause" || name === "title" || name === "howto") {
            closeStatPanel();
        }
        if (name === "playing") updateHUD();
    },

    cue(name, audio) {
        if (name === "menu") audio.tone(440, 0.04, "sine", 0.3);
        else if (name === "select") audio.tone(660, 0.07, "square", 0.4);
        else if (name === "splash") audio.tone(170, 0.16, "sawtooth", 0.35);
        else if (name === "feed") audio.tone(320, 0.12, "triangle", 0.30);
        else if (name === "harvest") {
            audio.sequence([
                [660, 0.07, "square", 0.4],
                [880, 0.10, "square", 0.4],
            ]);
        } else if (name === "pickup") audio.tone(740, 0.08, "square", 0.45);
        else if (name === "plant") audio.tone(420, 0.07, "triangle", 0.4);
        else if (name === "nope") audio.tone(180, 0.10, "sine", 0.25);
    },
};

// ── Scene / sim bootstrap ────────────────────────────────────────────────

function ensureScene() {
    if (scene) return;
    canvas = document.getElementById("view") || document.querySelector("canvas");
    if (!canvas) throw new Error("farm: #view canvas missing");
    scene = canvas.getContext("scene");
    if (!scene) throw new Error("farm: scene context unavailable");

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
}

function ensureSim(ctx) {
    if (world) return;

    world = createWorld({ seed: 7 });
    initPlayer(world, 22, 14);
    renderer = createRenderer(scene, world);

    // Nav grid: solid buildings as obstacles; open field walkable.
    const NAV_BLOCKERS = new Set(["farmhouse", "barn", "silo", "well"]);
    const navGrid = bro.ai.game.createNavGrid({
        minX: 0, minZ: 0, maxX: GRID.cols, maxZ: GRID.rows, cellSize: 0.5,
        padding: 0.1,
        obstacles: REGIONS.filter((r) => NAV_BLOCKERS.has(r.type)).map((r) => ({
            x: (r.x0 + r.x1 + 1) / 2, z: (r.y0 + r.y1 + 1) / 2,
            hw: (r.x1 - r.x0 + 1) / 2, hd: (r.y1 - r.y0 + 1) / 2,
        })),
    });
    world.pathfind = (x0, y0, x1, y1) =>
        navGrid.findPath(x0, y0, x1, y1).map((p) => ({ x: p.x, y: p.z }));
    globalThis.farmNav = navGrid;

    orchestrator = createOrchestrator();
    globalThis.farmAuto = true;

    globalThis.world = world;
    globalThis.player = world.player;
    globalThis.orchestrator = orchestrator;
    globalThis.farmInteract = () => doInteract(G);
    globalThis.farmBuyFeed = () => doBuyFeed(G);
    globalThis.farmStart = () => { /* shell owns start via Play */ };

    function speakerPos(id) {
        if (id === "You") return world.player ? { x: world.player.x, y: world.player.y } : null;
        if (world.foreman && id === world.foreman.id) {
            return { x: world.foreman.x, y: world.foreman.y };
        }
        const n = world.npcs.find((x) => x.id === id);
        return n ? { x: n.x, y: n.y } : null;
    }
    function listenerPos() {
        return world.player ? { x: world.player.x, y: world.player.y } : null;
    }

    voice = createVoice({
        getAudioCtx: () => (ctx.audio && ctx.audio.ctx ? ctx.audio.ctx() : null),
        npcVoiceTag: (id) => {
            const n = world.npcs.find((x) => x.id === id);
            return n ? n.voice : null;
        },
        isActive: () => apiRef && apiRef.getScreen && apiRef.getScreen() === "playing",
        speakerPos,
        listenerPos,
    });
    globalThis.farmVoice = voice;
    globalThis.farmAudio = {
        speakerPos, listenerPos,
        earshot: () => voice.spatial,
        lastSpatial: () => voice.debug.lastSpatial,
        computeSpatial: (a, b) => voice.computeSpatial(a, b),
    };
    world._emitSpeech = (id, text, onStart) => voice.speak(id, text, { onStart });

    globalThis.farmInspect = {
        clickTile: (tx, ty) => handleTileClick(tx, ty),
        clickClient: (cx, cy) => boardClickClient(cx, cy),
        close: () => closeStatPanel(),
        selectedId: () => world.inspect,
        isOpen: () => statOpen,
        panelEl: () => document.getElementById("statsheet"),
        worldToScreen: null,
    };
    globalThis.farmStats = {
        staminaMaxFor, staminaDrainMul, moveSpeedMul, proficiencyMul, statXpToNext,
        healthMaxFor, healthRegenMul, hydrationDrainMul,
    };
}

function ensureWiring(ctx) {
    if (wired) return;
    wired = true;
    ensureScene();

    canvas.addEventListener("click", (e) => {
        if (!apiRef || apiRef.getScreen() !== "playing") return;
        boardClickClient(e.clientX, e.clientY);
    });

    const closeBtn = document.getElementById("ss-close");
    if (closeBtn) {
        closeBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (ctx && ctx.play) ctx.play("menu");
            closeStatPanel();
        });
    }

    if (!debugWired) {
        debugWired = true;
        window.addEventListener("keydown", (e) => {
            if (!apiRef || apiRef.getScreen() !== "playing") return;
            const k = e.key.toLowerCase();
            const fn = debugKeys[k];
            if (fn) {
                fn();
                updateHUD();
            }
        });
    }
}

function eachPen(fn) {
    ["coop", "meadow", "pasture"].forEach(fn);
}

const debugKeys = {
    "1": () => eachPen((p) => world.actions.refillFeedTrough(p)),
    "2": () => eachPen((p) => world.actions.refillWaterTrough(p)),
    "3": () => world.crops.forEach((c) => {
        if (c.stage !== "empty") world.actions.waterCrop(c.id);
    }),
    "4": () => {
        world.crops.forEach((c) => {
            if (c.stage === "ripe") world.actions.harvest(c.id);
        });
        eachPen((p) => world.actions.collectProduce(p));
    },
    "5": () => world.crops.forEach((c) => {
        if (c.stage === "empty") world.actions.plant(c.plotIndex, "wheat");
    }),
    "6": () => {
        world.actions.drawWater(80);
        world.actions.loadFeed(80);
    },
    "o": () => {
        console.log(JSON.stringify(world.observe(), null, 2));
    },
};

// ── Player actions ───────────────────────────────────────────────────────

function doInteract(run) {
    if (!world) return null;
    const res = runInteract(world);
    if (run && run.play) run.play(res.ok ? res.sfx : "nope");
    updateHUD();
    return res;
}

function doBuyFeed(run) {
    if (!world) return null;
    const res = buyFeed(world, 200);
    if (run && run.play) run.play(res.ok ? "pickup" : "nope");
    updateHUD();
    return res;
}

// ── HUD ──────────────────────────────────────────────────────────────────

function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function weatherLabel(w) {
    return WEATHER_LABEL[w] || cap(w);
}
function speakerName(id) {
    const n = world.npcs.find((x) => x.id === id);
    return n ? n.name : id;
}
function speakerClass(id) {
    if (id === "Foreman") return "foreman";
    if (id === "You") return "you";
    if (id === "Farm") return "farm";
    return "";
}
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
function chip(label, value, cls) {
    return (
        '<div class="res-chip ' + (cls || "") + '">' +
        '<span class="res-k">' + label + "</span>" +
        '<span class="res-v">' + value + "</span></div>"
    );
}
function priceChip(good, price, level) {
    return (
        '<div class="price-chip ' + level + '">' +
        '<span class="price-k">' + (GOOD_LABEL[good] || good) + "</span>" +
        '<span class="price-v">' + price.toFixed(1) + "g</span></div>"
    );
}
function workerRow(n) {
    const sCls = n.stamina < 25 ? "low" : (n.stamina < 55 ? "mid" : "ok");
    const eCls = n.energy < 30 ? "low" : (n.energy < 55 ? "mid" : "ok");
    const wCls = n.hydration < 22 ? "low" : (n.hydration < 50 ? "mid" : "ok");
    const healthMax = n.healthMax || 100;
    const hCls = n.health < healthMax * 0.30 ? "low" : (n.health < healthMax * 0.55 ? "mid" : "ok");
    const sPct = Math.round(100 * n.stamina / (n.staminaMax || 100));
    const hPct = Math.round(100 * n.health / healthMax);
    const crit = n.stamina < 15 || n.energy < 20 || n.hydration < 22 || n.health < 30;
    const dot = crit ? '<span class="wk-crit" title="needs care">!</span>' : "";
    const station = n.station ? (STATION_SHORT[n.station] || n.station) : "";
    return (
        '<div class="wk-row' + (crit ? " crit" : "") + '">' +
        '<span class="wk-name role-' + n.role + '">' + n.name + dot + "</span>" +
        '<span class="wk-state">' + (STATE_LABEL[n.state] || n.state) + "</span>" +
        '<span class="wk-bars">' +
            '<span class="wk-bar"><span class="wk-fill ' + sCls + '" style="width:' + sPct + '%"></span></span>' +
            '<span class="wk-bar"><span class="wk-fill en ' + eCls + '" style="width:' + Math.round(n.energy) + '%"></span></span>' +
            '<span class="wk-bar"><span class="wk-fill wa ' + wCls + '" style="width:' + Math.round(n.hydration) + '%"></span></span>' +
            '<span class="wk-bar"><span class="wk-fill hp ' + hCls + '" style="width:' + hPct + '%"></span></span>' +
        "</span>" +
        '<span class="wk-station" title="' +
            (station ? (STATION_LABEL[n.station] || station) : "") +
        '">' + station + "</span>" +
        "</div>"
    );
}

function updateHUD() {
    if (!world) return;
    const o = world.observe();

    const hudClock = document.getElementById("hud-clock");
    const hudEnv = document.getElementById("hud-env");
    const hudRes = document.getElementById("hud-resources");
    const hudMarket = document.getElementById("hud-market");
    const hudObjective = document.getElementById("hud-objective");
    const hudWorkers = document.getElementById("hud-workers");
    const hudAlerts = document.getElementById("hud-alerts");
    const hudDialog = document.getElementById("hud-dialog");

    if (hudClock) hudClock.textContent = "Day " + o.clock.day + " · " + o.clock.time;

    if (hudEnv) {
        const e = o.env;
        hudEnv.innerHTML =
            '<span class="env-chip season-' + e.season + '">' + cap(e.season) + "</span>" +
            '<span class="env-chip wx-' + e.weather + '">' + weatherLabel(e.weather) + "</span>" +
            '<span class="env-chip temp">' + e.temperature + "°</span>" +
            '<span class="env-chip phase">' + cap(e.dayPhase) + "</span>";
    }

    if (hudRes) {
        const r = o.resources;
        hudRes.innerHTML =
            chip("Gold", r.gold, "gold") +
            chip("Feed", r.feed, r.feed < 40 ? "low" : "") +
            chip("Water", r.water, r.water < 40 ? "low" : "") +
            chip("Eggs", r.eggs) +
            chip("Milk", r.milk) +
            chip("Wool", r.wool) +
            chip("Crops", r.crops);
    }

    if (hudMarket) {
        const m = o.market;
        const order = ["eggs", "milk", "wool", "crops", "feed"];
        hudMarket.innerHTML =
            order.map((g) => priceChip(g, m.prices[g], m.level[g])).join("") +
            chip("Barn", o.barnFeed, o.barnFeed < 220 ? "low" : "") +
            chip("Well", o.well.level);
    }

    if (hudObjective) {
        const obj = o.objective;
        const pct = Math.max(0, Math.min(100, Math.round(100 * obj.progress / obj.target)));
        hudObjective.innerHTML =
            '<div class="obj-row"><span>Reach ' + obj.target + "g by Day " + obj.deadlineDay + "</span>" +
            '<span class="obj-num' + (obj.met ? " met" : "") + '">' +
            obj.progress + " / " + obj.target + "g</span></div>" +
            '<div class="obj-bar"><div class="obj-fill' + (obj.met ? " met" : "") +
            '" style="width:' + pct + '%"></div></div>';
    }

    if (hudWorkers) {
        hudWorkers.innerHTML = o.npcs.map(workerRow).join("");
    }

    if (hudAlerts) {
        if (o.alerts.length === 0) {
            hudAlerts.innerHTML = '<div class="alert ok">All calm</div>';
        } else {
            hudAlerts.innerHTML = o.alerts
                .slice(0, 9)
                .map((a) => '<div class="alert ' + a.level + '">' + escapeHtml(a.msg) + "</div>")
                .join("");
        }
    }

    if (hudDialog) {
        if (world.dialog.length === 0) {
            hudDialog.innerHTML = '<div class="line muted">…</div>';
        } else {
            hudDialog.innerHTML = world.dialog
                .slice(0, 8)
                .map((d) =>
                    '<div class="line ' + speakerClass(d.speaker) + '">' +
                    '<span class="who">' + escapeHtml(speakerName(d.speaker)) + ":</span> " +
                    escapeHtml(d.text) + "</div>"
                )
                .join("");
        }
    }

    if (statOpen) renderStatPanel();
}

// ── Click-to-inspect ─────────────────────────────────────────────────────

function inspectEntity(id) {
    if (!id || !world) return null;
    if (world.foreman && id === world.foreman.id) {
        const f = world.foreman;
        return {
            id: f.id, name: f.name, roleLabel: ROLE_DISPLAY.foreman, color: "#b5343a",
            stats: f.stats, hasVitals: false, state: "supervising", carrying: null,
            station: null,
        };
    }
    const n = world.npcs.find((x) => x.id === id);
    if (!n) return null;
    return {
        id: n.id, name: n.name, roleLabel: ROLE_DISPLAY[n.role] || n.role,
        color: ROLE_COLOR[n.role] || "#caa", stats: n.stats, hasVitals: true,
        stamina: n.stamina, staminaMax: staminaMaxFor(n), energy: n.energy,
        hydration: n.hydration, health: n.health, healthMax: healthMaxFor(n),
        state: n.state, carrying: n.carrying, station: n.station || null,
    };
}

function pickPersonAt(tileX, tileY) {
    let best = null, bestD = 1.0;
    const consider = (cid, x, y) => {
        const d = Math.hypot(x - tileX, y - tileY);
        if (d <= bestD) {
            best = cid;
            bestD = d;
        }
    };
    for (const n of world.npcs) consider(n.id, n.x, n.y);
    if (world.foreman) consider(world.foreman.id, world.foreman.x, world.foreman.y);
    return best;
}

function handleTileClick(tileX, tileY) {
    const id = pickPersonAt(tileX, tileY);
    if (id) selectStatPanel(id);
    else closeStatPanel();
    return id;
}

function distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * vx, cy = ay + t * vy;
    return Math.hypot(px - cx, py - cy);
}

function pickPersonClient(clientX, clientY) {
    if (!renderer || !canvas) return null;
    let best = null, bestD = Infinity;
    const consider = (id, x, y) => {
        const foot = renderer.worldToScreen(x, 0.1, y, canvas);
        const head = renderer.worldToScreen(x, 1.5, y, canvas);
        if (!foot || !head) return;
        const segLen = Math.hypot(head[0] - foot[0], head[1] - foot[1]);
        const radius = Math.max(18, segLen * 0.5);
        const d = distToSeg(clientX, clientY, foot[0], foot[1], head[0], head[1]);
        if (d <= radius && d < bestD) {
            best = id;
            bestD = d;
        }
    };
    for (const n of world.npcs) consider(n.id, n.x, n.y);
    if (world.foreman) consider(world.foreman.id, world.foreman.x, world.foreman.y);
    return best;
}

function boardClickClient(clientX, clientY) {
    const id = pickPersonClient(clientX, clientY);
    if (id) {
        selectStatPanel(id);
        return id;
    }
    closeStatPanel();
    return null;
}

function selectStatPanel(id) {
    world.inspect = id;
    statOpen = true;
    const statEl = document.getElementById("statsheet");
    if (statEl) statEl.style.display = "block";
    renderStatPanel();
}

function closeStatPanel() {
    if (world) world.inspect = null;
    statOpen = false;
    const statEl = document.getElementById("statsheet");
    if (statEl) statEl.style.display = "none";
}

function needRow(lbl, val, max, enClass) {
    const f = Math.max(0, Math.min(1, val / max));
    const cls = val < max * 0.25 ? "low" : (val < max * 0.55 ? "mid" : "ok");
    return (
        '<div class="ss-need-row">' +
        '<span class="ss-need-k">' + lbl + "</span>" +
        '<span class="ss-need-bar"><span class="ss-need-fill ' + enClass + " " + cls +
        '" style="width:' + Math.round(f * 100) + '%"></span></span>' +
        '<span class="ss-need-v">' + Math.round(val) + "</span></div>"
    );
}

function statRow(key, s) {
    const maxed = s.level >= STAT_MAX_LEVEL;
    const need = statXpToNext(s.level);
    const pct = maxed ? 100 : Math.max(0, Math.min(100, Math.round(100 * s.xp / need)));
    return (
        '<div class="ss-stat-row' + (maxed ? " maxed" : "") + '">' +
        '<span class="ss-stat-k">' + STAT_LABEL[key] + "</span>" +
        '<span class="ss-stat-lvl">' + s.level + "</span>" +
        '<span class="ss-stat-xpwrap"><span class="ss-stat-xp" style="width:' + pct +
        '%"></span></span></div>'
    );
}

function renderStatPanel() {
    const ssSwatch = document.getElementById("ss-swatch");
    const ssName = document.getElementById("ss-name");
    const ssRole = document.getElementById("ss-role");
    const ssState = document.getElementById("ss-state");
    const ssStation = document.getElementById("ss-station");
    const ssNeeds = document.getElementById("ss-needs");
    const ssStats = document.getElementById("ss-stats");

    const e = inspectEntity(world.inspect);
    if (!e) {
        closeStatPanel();
        return;
    }
    if (ssSwatch) ssSwatch.style.background = e.color;
    if (ssName) ssName.textContent = e.name;
    if (ssRole) {
        ssRole.textContent = e.roleLabel;
        ssRole.style.color = e.color;
    }
    if (ssState) {
        let line = PANEL_STATE[e.state] || e.state || "";
        if (e.carrying) {
            line += ' · <span class="carry">carrying ' + escapeHtml(e.carrying) + "</span>";
        }
        ssState.innerHTML = line;
    }
    if (ssStation) {
        ssStation.innerHTML = e.station
            ? '<span class="st-k">Station ·</span> ' +
              escapeHtml(STATION_LABEL[e.station] || e.station)
            : (e.hasVitals
                ? '<span class="st-k">Station · unassigned</span>'
                : "");
    }
    if (ssNeeds) {
        ssNeeds.innerHTML = e.hasVitals
            ? needRow("Stamina", e.stamina, e.staminaMax, "") +
              needRow("Energy", e.energy, 100, "en") +
              needRow("Water", e.hydration, 100, "wa") +
              needRow("Health", e.health, e.healthMax, "hp")
            : '<div class="ss-need-row"><span class="ss-need-k" style="width:auto;color:#9bb592">' +
              "command post · always on duty</span></div>";
    }
    if (ssStats) {
        ssStats.innerHTML = e.stats
            ? STAT_KEYS.map((k) => statRow(k, e.stats[k])).join("")
            : "";
    }
}
