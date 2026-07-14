// Hearthfolk — arcade plugin (scene, mind, voices, observatory).
// Domain rules: sim.js. Shell owns menus / pause / high score.

import {
    MAP_W, MAP_H, HSTEP, L_GROUND, L_OVER,
    TILE, FLAG, DAY_LEN, WALK_SPEED,
    VILLAGER_DEFS, START_RES, createGame,
} from "/app/sim.js";

// ── Scene / mind / voices (lazy scene; optional local models) ────────────

const fs = require("fs");

let canvas = null;
let scene = null;
let sun = null;
let fireLight = null;
let wired = false;
/** @type {object|null} */
let G = null;

const MODEL_PATH = "D:/projects/brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf";
const MAX_THINK_TOKENS = 200;
const KOKORO_DIR = "D:/projects/brosoundml/weights/kokoro";
const PHASE_LABEL = {
    dawn: "Dawn", morning: "Morning", midday: "Midday",
    evening: "Evening", night: "Night",
};
const SQ = Math.SQRT1_2;

const NO_MODEL = (() => {
    try { return globalThis.process.env.HEARTHFOLK_NO_MODEL === "1"; }
    catch (e) { return false; }
})();

export const game = {
    id: "hearthfolk",
    clearColor: "#101418",

    actions: [
        { name: "primary", label: "Confirm", defaults: ["Enter"] },
        { name: "pause_sim", label: "Pause Sim", defaults: [" "] },
        { name: "speed1", label: "1x Speed", defaults: ["1"] },
        { name: "speed4", label: "4x Speed", defaults: ["4"] },
        { name: "save", label: "Save", defaults: ["F5"] },
        { name: "load", label: "Load", defaults: ["F9"] },
    ],

    create(ctx) {
        ensureScene();
        ensureWiring();

        const sim = createGame(scene);
        const hc = sim.world.cellCenterWorldXZ(sim.hearth.x, sim.hearth.y);
        if (fireLight) fireLight.position = [hc.x, 1.1, hc.z];

        const run = {
            score: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            sim,
            selected: null,
            tinted: new Set(),
            lastSelCell: "",
            camera: { panX: 0, panZ: 0, zoom: 0.70 },
            baseCX: 0, baseCZ: 0, baseSize: 14,
            panKeys: { right: false, left: false, up: false, down: false },
            bubbleDivs: new Map(),
            toastTimer: null,
            hudCache: "",
            lm: null,
            tts: {
                kokoro: null, voices: {}, queue: [], busy: false,
                enabled: false, spoken: 0,
            },
            audioCtx: null,
            engineRate: 44100,
        };
        G = run;

        // Centre camera on the plaza.
        const b = sim.world.worldBounds();
        run.baseCX = (b.minX + b.maxX) / 2;
        run.baseCZ = (b.minZ + b.maxZ) / 2;
        const rect = canvas.getBoundingClientRect();
        const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
        const spanZ = b.maxZ - b.minZ;
        const diag = Math.hypot(b.maxX - b.minX, spanZ);
        run.baseSize = Math.max(spanZ * 0.72 + 2.0, (diag * 0.72 + 1.5) / aspect);
        run.camera.panX = hc.x - run.baseCX;
        run.camera.panZ = hc.z - run.baseCZ;
        applyCamera(run, aspect);

        sim.mind.stats = { tokens: 0, genMs: 0 };
        wireChronicle(run);
        loadMind(run);
        loadVoices(run);

        sim.onSay = (v, text) => {
            addFeed(v, text);
            if (run.tts.enabled && run.tts.queue.length < 2) {
                run.tts.queue.push({ name: v.name, text });
                pumpTts(run);
            }
        };

        // Force full static rebuild
        sim.dirty.static = true;
        sim.dirty.trees = true;
        sim.dirty.piles = true;

        exposeDebug(run);
        return run;
    },

    update(run, dt, input) {
        G = run;
        if (!run || !run.sim) return;

        const dtSec = Math.min(0.06, Math.max(0, dt / 1000));
        run.sim.update(dtSec);
        run.sim.world.advance(dt * (run.sim.speed || 0));
        updatePan(run, dtSec);
        updateLighting(run);

        if (input.pressed("pause_sim")) setSpeed(run, run.sim.speed === 0 ? 1 : 0);
        if (input.pressed("speed1")) setSpeed(run, 1);
        if (input.pressed("speed4")) setSpeed(run, 4);
        if (input.pressed("save") && run.sim.saveVillage()) toast(run, "Village saved");
        if (input.pressed("load")) doLoad(run);

        run.panKeys.right = input.down("right");
        run.panKeys.left = input.down("left");
        run.panKeys.up = input.down("up");
        run.panKeys.down = input.down("down");

        if (run.sim.dirty.static) syncStatic(run);
        if (run.sim.dirty.trees) syncTrees(run);
        if (run.sim.dirty.piles) syncPiles(run);
        syncDynamic(run);
        syncBubbles(run);

        if (run.selected) {
            const c = run.sim.cellOf(run.selected);
            const key = c.x + "," + c.y;
            if (key !== run.lastSelCell) {
                run.lastSelCell = key;
                applyTints(run);
            }
        }
    },

    draw() {},

    hud(run) {
        if (!run || !run.sim) {
            return {
                day: "Day 1", phase: "Morning", thinks: "Γ£ô 0  Γ£ò 0", res: "",
            };
        }
        updateHUD(run);
        const sim = run.sim;
        return {
            day: "Day " + sim.day(),
            phase: PHASE_LABEL[sim.phaseName()] || sim.phaseName(),
            thinks: "Γ£ô " + sim.mind.accepted + "  Γ£ò " + sim.mind.discarded,
            res: "food " + sim.res.food + " ┬╖ wood " + sim.res.wood +
                " ┬╖ stone " + sim.res.stone + " ┬╖ meals " + sim.res.meals,
        };
    },

    gameOverText(run) {
        const sim = run && run.sim;
        if (!sim) return "";
        return "Day " + sim.day() + " ┬╖ " + (PHASE_LABEL[sim.phaseName()] || "") +
            "\nfood " + sim.res.food + " ┬╖ wood " + sim.res.wood +
            " ┬╖ stone " + sim.res.stone + " ┬╖ meals " + sim.res.meals;
    },

    cue(name, audio) {
    },
};

// ΓöÇΓöÇ Scene ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function ensureScene() {
    if (scene) return;
    canvas = document.getElementById("view");
    if (!canvas) throw new Error("hearthfolk: #view canvas missing");
    scene = canvas.getContext("scene");
    if (!scene) throw new Error("hearthfolk: scene context unavailable");

    scene.setToneMap({ mode: "aces", exposure: 0.95, gamma: 2.2 });
    scene.setAmbient([0.20, 0.21, 0.26]);
    sun = scene.createLight({
        type: "directional",
        direction: [-0.5, -1.0, -0.35],
        color: [1.0, 0.95, 0.86],
        intensity: 2.1,
    });
    fireLight = scene.createLight({
        type: "point",
        position: [0, 1.2, 0],
        color: [1.0, 0.55, 0.22],
        intensity: 0,
        range: 7,
    });
    window.addEventListener("resize", () => {
        if (!G) return;
        const b = G.sim.world.worldBounds();
        G.baseCX = (b.minX + b.maxX) / 2;
        G.baseCZ = (b.minZ + b.maxZ) / 2;
        const rect = canvas.getBoundingClientRect();
        const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
        const spanZ = b.maxZ - b.minZ;
        const diag = Math.hypot(b.maxX - b.minX, spanZ);
        G.baseSize = Math.max(spanZ * 0.72 + 2.0, (diag * 0.72 + 1.5) / aspect);
        applyCamera(G, aspect);
    });
}

function applyCamera(run, aspect) {
    if (aspect === undefined) {
        const rect = canvas.getBoundingClientRect();
        aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    }
    const cx = run.baseCX + run.camera.panX, cz = run.baseCZ + run.camera.panZ;
    scene.setCamera({
        mode: "orthographic",
        size: run.baseSize * run.camera.zoom, aspect, near: 0.1, far: 220,
        position: [cx + 16, 18, cz + 16],
        target: [cx, 0, cz],
    });
}

function updatePan(run, dt) {
    const s = 11 * dt * run.camera.zoom;
    let dx = 0, dz = 0;
    if (run.panKeys.right) { dx += SQ * s; dz -= SQ * s; }
    if (run.panKeys.left) { dx -= SQ * s; dz += SQ * s; }
    if (run.panKeys.up) { dx += SQ * s; dz += SQ * s; }
    if (run.panKeys.down) { dx -= SQ * s; dz -= SQ * s; }
    if (dx || dz) {
        run.camera.panX = Math.max(-26, Math.min(26, run.camera.panX + dx));
        run.camera.panZ = Math.max(-20, Math.min(20, run.camera.panZ + dz));
        applyCamera(run);
    }
}

function lerp(a, b, t) { return a + (b - a) * t; }

function updateLighting(run) {
    if (!sun || !fireLight) return;
    const tod = run.sim.tod();
    let dayF;
    if (tod < 0.06) dayF = tod / 0.06;
    else if (tod < 0.55) dayF = 1;
    else if (tod < 0.72) dayF = 1 - (tod - 0.55) / 0.17;
    else dayF = 0;
    sun.intensity = lerp(0.22, 2.1, dayF);
    sun.color = [lerp(0.55, 1.0, dayF), lerp(0.58, 0.95, dayF), lerp(0.85, 0.86, dayF)];
    scene.setAmbient([
        lerp(0.05, 0.20, dayF), lerp(0.06, 0.21, dayF), lerp(0.11, 0.26, dayF),
    ]);
    const flicker = 0.9 + 0.1 * Math.sin(run.sim.time * 9.3) * Math.sin(run.sim.time * 5.1);
    fireLight.intensity = run.sim.fire * lerp(14, 3, dayF) * flicker;
}

// ΓöÇΓöÇ Tints ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function applyTints(run) {
    const world = run.sim.world;
    const want = new Map();
    if (run.selected) {
        const c = run.sim.cellOf(run.selected);
        want.set(c.x + "," + c.y, [1.5, 1.35, 0.6]);
        want.set(run.selected.home.x + "," + run.selected.home.y, [0.7, 1.1, 1.4]);
    }
    let dirty = false;
    for (const k of [...run.tinted]) {
        if (want.has(k)) continue;
        const [x, y] = k.split(",").map(Number);
        world.setTint(x, y, 1, 1, 1, 1);
        run.tinted.delete(k);
        dirty = true;
    }
    for (const [k, rgb] of want) {
        const [x, y] = k.split(",").map(Number);
        const cur = world.getTint(x, y);
        if (Math.abs(cur.r - rgb[0]) < 0.02 && Math.abs(cur.g - rgb[1]) < 0.02 &&
            Math.abs(cur.b - rgb[2]) < 0.02) { run.tinted.add(k); continue; }
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        run.tinted.add(k);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

// ΓöÇΓöÇ Render sync ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function syncStatic(run) {
    const sim = run.sim, world = sim.world, K = sim.kinds;
    world.clearObjects(K.hut); world.clearObjects(K.hutRoof);
    world.clearObjects(K.hearth); world.clearObjects(K.bench);
    world.clearObjects(K.kitchen); world.clearObjects(K.boulder);
    for (const h of sim.homes) {
        world.addObject(K.hut, h.x, h.y, { yaw: Math.atan2(23 - h.x, 17 - h.y), scale: 1.25 });
        world.addObject(K.hutRoof, h.x, h.y, { yaw: Math.atan2(23 - h.x, 17 - h.y), scale: 1.25 });
    }
    world.addObject(K.hearth, sim.hearth.x, sim.hearth.y, { scale: 1.3 });
    world.addObject(K.bench, sim.bench.x, sim.bench.y, { yaw: Math.PI / 3 });
    world.addObject(K.kitchen, sim.kitchen.x, sim.kitchen.y, { yaw: -Math.PI / 2 });
    let i = 0;
    for (const c of sim.rockCells) {
        if ((i++ % 5) !== 0) continue;
        world.addObject(K.boulder, c.x, c.y, {
            yaw: i * 1.7, scale: 0.7 + (i % 3) * 0.25,
            offsetX: ((i * 7) % 10) / 20 - 0.25, offsetZ: ((i * 13) % 10) / 20 - 0.25,
        });
    }
    sim.dirty.static = false;
}

function syncTrees(run) {
    const sim = run.sim, world = sim.world, K = sim.kinds;
    world.clearObjects(K.tree);
    world.clearObjects(K.stump);
    for (const t of sim.trees) {
        if (t.alive)
            world.addObject(K.tree, t.x, t.y, {
                yaw: t.yaw, scale: t.scale, offsetX: t.ox, offsetZ: t.oz,
            });
        else
            world.addObject(K.stump, t.x, t.y, { yaw: t.yaw, offsetX: t.ox, offsetZ: t.oz });
    }
    sim.dirty.trees = false;
}

function syncPiles(run) {
    const sim = run.sim, world = sim.world, K = sim.kinds;
    world.clearObjects(K.stone);
    world.clearObjects(K.meal);
    world.clearObjects(K.logPile);
    const q = sim.quarry;
    const nStone = Math.min(sim.res.stone, 10);
    for (let i = 0; i < nStone; i++)
        world.addObject(K.stone, q.x, q.y, {
            yaw: i * 2.3,
            offsetX: ((i % 3) - 1) * 0.28, offsetZ: (Math.floor(i / 3) - 1) * 0.24,
            yOffset: 0.02,
        });
    const kc = sim.kitchen;
    const nMeals = Math.min(sim.res.meals, 8);
    for (let i = 0; i < nMeals; i++)
        world.addObject(K.meal, kc.x, kc.y, {
            offsetX: -0.30 + (i % 4) * 0.17, offsetZ: 0.30 + Math.floor(i / 4) * 0.16,
        });
    const nLogs = Math.min(Math.ceil(sim.res.wood / 3), 4);
    for (let i = 0; i < nLogs; i++)
        world.addObject(K.logPile, sim.hearth.x - 1, sim.hearth.y + 1, {
            yaw: 0.3, offsetX: -0.2 + i * 0.16, offsetZ: 0.1,
        });
    sim.dirty.piles = false;
}

function syncDynamic(run) {
    const sim = run.sim, world = sim.world, K = sim.kinds;
    for (let i = 0; i < sim.villagers.length; i++) {
        const v = sim.villagers[i];
        const kind = K.villagers[i];
        world.clearObjects(kind);
        const ri = sim.renderInfo(v);
        let yaw = v.faceYaw || 0;
        if (v.path && v.seg < v.path.length - 1) {
            const a = v.path[v.seg], b = v.path[v.seg + 1];
            yaw = Math.atan2(b.x - a.x, b.y - a.y);
            v.faceYaw = yaw;
        }
        const asleep = v.activity === "sleeping";
        world.addObject(kind, ri.anchor.x, ri.anchor.y, {
            yaw,
            offsetX: ri.offsetX, offsetZ: ri.offsetZ,
            yOffset: ri.yOffset + (asleep ? -0.06 : 0),
            scale: asleep ? 1.1 : 1.35,
        });
    }
    world.clearObjects(K.flame);
    if (sim.fire > 0.03) {
        const s = 0.5 + sim.fire * 0.9 + 0.06 * Math.sin(sim.time * 7);
        world.addObject(K.flame, sim.hearth.x, sim.hearth.y, { scale: s, yOffset: 0.06 });
    }
    world.rebuildObjects();
}

// ΓöÇΓöÇ Mind (Qwen) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function chatmlTurn(role, content) {
    return "<|im_start|>" + role + "\n" + content + "<|im_end|>\n";
}

function installModelGenerate(run) {
    run.sim.mind.generate = (promptText, parts) => new Promise((resolve, reject) => {
        const chatml = chatmlTurn("system", parts.system) +
            chatmlTurn("user", parts.user) +
            "<|im_start|>assistant\n";
        const ids = run.lm.tokenizer.encode(chatml);
        const t0 = Date.now();
        try {
            bro.lm.generate(run.lm.model, ids, {
                maxNewTokens: MAX_THINK_TOKENS,
                eosId: run.lm.tokenizer.imEndId,
                sampling: { temperature: 0.7, topK: 40, topP: 0.95 },
                onDone: (outIds, info) => {
                    run.sim.mind.stats.tokens += outIds.length;
                    run.sim.mind.stats.genMs += Date.now() - t0;
                    if (info && info.error) { reject(new Error(String(info.error))); return; }
                    resolve(run.lm.tokenizer.decode(Array.from(outIds)));
                },
            });
        } catch (e) { reject(e); }
    });
}

function loadMind(run) {
    let exists = false;
    try { exists = !NO_MODEL && fs.existsSync(MODEL_PATH); } catch (e) { /* */ }
    if (!exists) {
        run.sim.mind.status = "off";
        run.sim.mind.statusText = "minds: off ΓÇö model not found";
        return;
    }
    run.sim.mind.status = "loading";
    run.sim.mind.statusText = "minds: loadingΓÇª";
    try {
        bro.lm.loadQwen(MODEL_PATH, {
            onReady: ({ model, tokenizer }) => {
                run.lm = { model, tokenizer };
                installModelGenerate(run);
                run.sim.mind.status = "ready";
                run.sim.mind.statusText = "minds: on (Qwen3-32B)";
                run.sim.addEvent("The villagersΓÇÖ minds awaken", "day");
            },
            onError: (e) => {
                run.sim.mind.status = "off";
                run.sim.mind.statusText = "minds: off ΓÇö load failed";
                console.error("mind load failed:", e);
            },
        });
    } catch (e) {
        run.sim.mind.status = "off";
        run.sim.mind.statusText = "minds: off ΓÇö load failed";
    }
}

// ΓöÇΓöÇ Voices (Kokoro) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function loadVoices(run) {
    let exists = false;
    try { exists = !NO_MODEL && fs.existsSync(KOKORO_DIR + "/model.safetensors"); } catch (e) { /* */ }
    if (!exists) return;
    try {
        run.audioCtx = new AudioContext();
        run.engineRate = run.audioCtx.sampleRate || 44100;
    } catch (e) { return; }
    try {
        bro.tts.loadKokoro(KOKORO_DIR, {
            onReady: (k) => {
                run.tts.kokoro = k;
                try {
                    for (const def of VILLAGER_DEFS)
                        run.tts.voices[def.name] = k.loadVoice(
                            KOKORO_DIR + "/voices/" + def.voice + ".bin");
                    run.tts.enabled = true;
                } catch (e) { console.warn("voice load failed:", e.message); }
            },
            onError: (m) => console.warn("kokoro load failed:", m),
        });
    } catch (e) { /* voices stay off */ }
}

function resampleLinear(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;
    const n = Math.max(1, Math.round(samples.length * toRate / fromRate));
    const out = new Float32Array(n);
    const step = (samples.length - 1) / (n - 1 || 1);
    for (let i = 0; i < n; i++) {
        const p = i * step, i0 = Math.floor(p), f = p - i0;
        out[i] = samples[i0] * (1 - f) + (samples[Math.min(i0 + 1, samples.length - 1)]) * f;
    }
    return out;
}

function pumpTts(run) {
    const tts = run.tts;
    if (!tts.enabled || tts.busy || tts.queue.length === 0) return;
    const item = tts.queue.shift();
    const voice = tts.voices[item.name];
    if (!voice) return;
    let ids;
    try { ids = bro.tts.phonemize(item.text); } catch (e) { return; }
    tts.busy = true;
    try {
        bro.tts.synthesize(tts.kokoro, ids, voice, {
            speed: 1.05,
            onDone: (res) => {
                tts.busy = false;
                if (res && res.samples && res.samples.length && run.audioCtx) {
                    try {
                        const rs = resampleLinear(res.samples, res.sampleRate, run.engineRate);
                        const clip = run.audioCtx.createClip(rs, 1);
                        run.audioCtx.playClip(clip, 0.9, false);
                        tts.spoken++;
                        setTimeout(() => {
                            try { run.audioCtx.deleteClip(clip); } catch (e) { /* */ }
                        }, (rs.length / run.engineRate) * 1000 + 500);
                    } catch (e) { /* playback best-effort */ }
                }
                pumpTts(run);
            },
            onError: () => { tts.busy = false; pumpTts(run); },
        });
    } catch (e) { tts.busy = false; }
}

// ΓöÇΓöÇ DOM observatory ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function $(id) { return document.getElementById(id); }

function projectWorld(wx, wy, wz) {
    const V = scene.viewMatrix, P = scene.projectionMatrix;
    const mul = (m, v) => [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
    ];
    const clip = mul(P, mul(V, [wx, wy, wz, 1]));
    const rect = canvas.getBoundingClientRect();
    return {
        x: rect.left + (clip[0] / clip[3] * 0.5 + 0.5) * rect.width,
        y: rect.top + (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * rect.height,
    };
}

function projectVillager(run, v) {
    const ri = run.sim.renderInfo(v);
    const cc = run.sim.world.cellCenterWorldXZ(ri.anchor.x, ri.anchor.y);
    return projectWorld(cc.x + ri.offsetX, ri.worldY + 0.55, cc.z + ri.offsetZ);
}

function wireChronicle(run) {
    const chronicleEl = $("chronicle-list");
    if (!chronicleEl) return;
    chronicleEl.innerHTML = "";
    run.sim.onChronicle = (e) => {
        const div = document.createElement("div");
        div.className = "chron-entry " + e.kind;
        const stamp = document.createElement("span");
        stamp.className = "chron-stamp";
        stamp.textContent = "D" + e.day + " " + (PHASE_LABEL[e.phase] || e.phase);
        div.appendChild(stamp);
        div.appendChild(document.createTextNode(" " + e.text));
        chronicleEl.appendChild(div);
        while (chronicleEl.children.length > 120) chronicleEl.removeChild(chronicleEl.firstChild);
        chronicleEl.scrollTop = chronicleEl.scrollHeight;
    };
    for (const e of run.sim.chronicle) run.sim.onChronicle(e);
}

function cssColor(c) {
    const b = (x) => Math.round(Math.min(1, x * 1.8) * 255);
    return "rgb(" + b(c[0]) + "," + b(c[1]) + "," + b(c[2]) + ")";
}

function addFeed(v, text) {
    const feedEl = $("feed");
    if (!feedEl) return;
    const div = document.createElement("div");
    div.className = "feed-line";
    const who = document.createElement("b");
    who.textContent = v.name;
    who.style.color = cssColor(v.color);
    div.appendChild(who);
    div.appendChild(document.createTextNode(": " + text));
    feedEl.appendChild(div);
    while (feedEl.children.length > 7) feedEl.removeChild(feedEl.firstChild);
}

function syncBubbles(run) {
    const bubblesEl = $("bubbles");
    if (!bubblesEl) return;
    for (const v of run.sim.villagers) {
        let div = run.bubbleDivs.get(v.id);
        if (v.say) {
            if (!div) {
                div = document.createElement("div");
                div.className = "bubble";
                bubblesEl.appendChild(div);
                run.bubbleDivs.set(v.id, div);
            }
            if (div.textContent !== v.say.text) div.textContent = v.say.text;
            const p = projectVillager(run, v);
            div.style.left = Math.round(p.x) + "px";
            div.style.top = Math.round(p.y) + "px";
        } else if (div) {
            div.remove();
            run.bubbleDivs.delete(v.id);
        }
    }
}

function setSpeed(run, sp) {
    run.sim.speed = sp;
    run.hudCache = "";
}

function needBar(id, val) {
    const el = $(id);
    if (!el) return;
    el.style.width = Math.round(Math.min(1, Math.max(0, val)) * 100) + "%";
    el.className = "bar-fill" + (val > 0.66 ? " hot" : val > 0.4 ? " warm" : "");
}

function updateMindPanel(run) {
    const panel = $("mind-panel");
    if (!panel) return;
    if (!run.selected) { panel.style.display = "none"; return; }
    panel.style.display = "";
    const v = run.selected;
    const set = (id, t) => { const n = $(id); if (n) n.textContent = t; };
    set("mp-name", v.name);
    set("mp-sub", v.temperament + " " + v.role + " ┬╖ " + v.activity +
        (run.tts.enabled ? " ┬╖ voice " + v.voice : ""));
    set("mp-goal", v.goal || "ΓÇö");
    needBar("bar-hunger", v.needs.hunger);
    needBar("bar-energy", v.needs.energy);
    needBar("bar-social", v.needs.social);
    needBar("bar-warmth", v.needs.warmth);
    const think = $("mp-think");
    if (think) {
        if (v.lastThink) {
            think.textContent = v.lastThink.discarded
                ? "(discarded)\n" + String(v.lastThink.raw).slice(0, 300)
                : JSON.stringify(v.lastThink.parsed, null, 1);
        } else think.textContent = "no thoughts yet ΓÇö tier-0 instinct";
    }
    const mem = $("mp-memories");
    if (mem) {
        const memSig = v.memories.join("\u0001");
        if (mem.dataset.sig !== memSig) {
            mem.dataset.sig = memSig;
            mem.innerHTML = "";
            if (!v.memories.length) {
                const li = document.createElement("li");
                li.className = "empty";
                li.textContent = "no memories yet";
                mem.appendChild(li);
            }
            for (const m of v.memories) {
                const li = document.createElement("li");
                li.textContent = m;
                mem.appendChild(li);
            }
        }
    }
}

function updateHUD(run) {
    const sim = run.sim, m = sim.mind;
    const sig = [sim.day(), sim.phaseName(), m.statusText, m.accepted, m.discarded,
        sim.speed, sim.res.food, sim.res.wood, sim.res.stone, sim.res.meals,
        typeof globalThis.__hearthmindGenerate === "function",
        run.selected ? run.selected.id : -1].join("|");
    const needSel = run.selected != null;
    if (sig === run.hudCache && !needSel) return;
    run.hudCache = sig;

    const chip = $("mind-chip");
    if (chip) {
        chip.textContent = (typeof globalThis.__hearthmindGenerate === "function")
            ? "minds: test harness" : m.statusText;
        chip.className = "chip " +
            (m.status === "ready" ? "on" : m.status === "loading" ? "loading" : "off");
    }
    for (const [id, sp] of [["btn-pause", 0], ["btn-1x", 1], ["btn-4x", 4]]) {
        const n = $(id);
        if (n) n.classList.toggle("selected", sim.speed === sp);
    }
    updateMindPanel(run);
}

function toast(run, msg) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.display = "";
    if (run.toastTimer) clearTimeout(run.toastTimer);
    run.toastTimer = setTimeout(() => { t.style.display = "none"; }, 1900);
}

function doLoad(run) {
    if (!run.sim.hasSave()) { toast(run, "No saved village"); return; }
    if (run.sim.loadVillage()) {
        run.selected = null;
        for (const k of [...run.tinted]) {
            const [x, y] = k.split(",").map(Number);
            run.sim.world.setTint(x, y, 1, 1, 1, 1);
        }
        run.tinted.clear();
        const chronicleEl = $("chronicle-list");
        if (chronicleEl) {
            chronicleEl.innerHTML = "";
            for (const e of run.sim.chronicle) run.sim.onChronicle(e);
        }
        run.sim.world.rebuild();
        toast(run, "Village loaded");
        run.hudCache = "";
    } else toast(run, "Save file is corrupt");
}

// ΓöÇΓöÇ Input ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function pickVillager(run, e) {
    const rect = canvas.getBoundingClientRect();
    const ray = scene.unprojectLocal(e.clientX - rect.left, e.clientY - rect.top);
    if (!ray) return null;
    const hit = run.sim.world.raycastCell(ray.origin, ray.dir, 500);
    if (!hit) return null;
    let best = null, bestD = 1.6;
    for (const v of run.sim.villagers) {
        const d = Math.hypot(v.pos.x - hit.x, v.pos.y - hit.y);
        if (d < bestD) { bestD = d; best = v; }
    }
    return best;
}

function ensureWiring() {
    if (wired) return;
    wired = true;
    ensureScene();

    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !G) return;
        const v = pickVillager(G, e);
        G.selected = (v && v !== G.selected) ? v : null;
        applyTints(G);
        G.hudCache = "";
    });
    canvas.addEventListener("wheel", (e) => {
        if (!G) return;
        G.camera.zoom = Math.max(0.28, Math.min(1.4, G.camera.zoom * (1 + e.deltaY * 0.06)));
        applyCamera(G);
    });

    const bind = (id, fn) => {
        const n = $(id);
        if (n) n.addEventListener("click", () => { if (G) fn(G); });
    };
    bind("btn-pause", (r) => setSpeed(r, 0));
    bind("btn-1x", (r) => setSpeed(r, 1));
    bind("btn-4x", (r) => setSpeed(r, 4));
    bind("btn-save", (r) => { if (r.sim.saveVillage()) toast(r, "Village saved"); });
    bind("btn-load", doLoad);
}

// ΓöÇΓöÇ Debug ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function exposeDebug(run) {
    window.HEARTH = {
        game: run.sim,
        world: run.sim.world,
        scene,
        TILE, FLAG, MAP_W, MAP_H, HSTEP, DAY_LEN, L_GROUND, L_OVER,
        projectWorld,
        projectVillager: (v) => projectVillager(run, v),
        setSpeed: (sp) => setSpeed(run, sp),
        get selected() { return run.selected; },
        get tts() { return run.tts; },
        debug: {
            select(v) {
                run.selected = v;
                applyTints(run);
                run.hudCache = "";
            },
            teleport(v, x, y) {
                v.pos = { x, y };
                v.path = null; v.target = null; v.plannedAct = null; v.commit = null;
            },
            forceGoto(v, x, y) {
                v.override = { until: run.sim.time + 120, action: "idle", target: { x, y } };
                v.target = null; v.plannedAct = null; v.commit = null;
            },
            setNeeds(v, n) { Object.assign(v.needs, n); },
            setRes(res) { Object.assign(run.sim.res, res); },
        },
    };
}

