// app.js — Hearthfolk shell: iso camera over the tile world, day/night
// lighting, per-frame render sync (villagers re-anchored along their paths,
// hearth flame, trees, stone/meal piles), the Qwen mind loader + serial think
// queue wiring, Kokoro voices, and the DOM observatory UI (status bar,
// chronicle, conversation feed, speech bubbles, mind panel, save/load).

import {
    createGame, TILE, FLAG, VILLAGER_DEFS, MAP_W, MAP_H, HSTEP, DAY_LEN,
    L_GROUND, L_OVER,
} from '/app/game.js';

const fs = require('fs');
const $ = (id) => document.getElementById(id);

const canvas = $('game');
const scene = canvas.getContext('scene');

scene.setToneMap({ mode: 'aces', exposure: 0.95, gamma: 2.2 });
scene.setAmbient([0.20, 0.21, 0.26]);
const sun = scene.createLight({
    type: 'directional',
    direction: [-0.5, -1.0, -0.35],
    color: [1.0, 0.95, 0.86],
    intensity: 2.1,
});
const fireLight = scene.createLight({
    type: 'point',
    position: [0, 1.2, 0],
    color: [1.0, 0.55, 0.22],
    intensity: 0,
    range: 7,
});

const game = createGame(scene);
const world = game.world;

// Park the fire light over the hearth.
{
    const hc = world.cellCenterWorldXZ(game.hearth.x, game.hearth.y);
    fireLight.position = [hc.x, 1.1, hc.z];
}

// ---------------------------------------------------------------------------
// Camera — orthographic iso, arrow/WASD pan + wheel zoom.
// ---------------------------------------------------------------------------

const camera = { panX: 0, panZ: 0, zoom: 0.70 };
let baseCX = 0, baseCZ = 0, baseSize = 14;

function frameCamera() {
    const b = world.worldBounds();
    baseCX = (b.minX + b.maxX) / 2;
    baseCZ = (b.minZ + b.maxZ) / 2;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    const spanZ = b.maxZ - b.minZ;
    const diag = Math.hypot(b.maxX - b.minX, spanZ);
    baseSize = Math.max(spanZ * 0.72 + 2.0, (diag * 0.72 + 1.5) / aspect);
    // Start centred on the plaza rather than the map middle.
    const hc = world.cellCenterWorldXZ(game.hearth.x, game.hearth.y);
    camera.panX = hc.x - baseCX;
    camera.panZ = hc.z - baseCZ;
    applyCamera(aspect);
}
function applyCamera(aspect) {
    if (aspect === undefined) {
        const rect = canvas.getBoundingClientRect();
        aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
    }
    const cx = baseCX + camera.panX, cz = baseCZ + camera.panZ;
    scene.setCamera({
        mode: 'orthographic',
        size: baseSize * camera.zoom, aspect, near: 0.1, far: 220,
        position: [cx + 16, 18, cz + 16],
        target: [cx, 0, cz],
    });
}
frameCamera();
window.addEventListener('resize', frameCamera);

const SQ = Math.SQRT1_2;
const panKeys = { right: false, left: false, up: false, down: false };
function updatePan(dt) {
    const s = 11 * dt * camera.zoom;
    let dx = 0, dz = 0;
    if (panKeys.right) { dx += SQ * s; dz -= SQ * s; }
    if (panKeys.left) { dx -= SQ * s; dz += SQ * s; }
    if (panKeys.up) { dx += SQ * s; dz += SQ * s; }
    if (panKeys.down) { dx -= SQ * s; dz -= SQ * s; }
    if (dx || dz) {
        camera.panX = Math.max(-26, Math.min(26, camera.panX + dx));
        camera.panZ = Math.max(-20, Math.min(20, camera.panZ + dz));
        applyCamera();
    }
}

// ---------------------------------------------------------------------------
// Day/night lighting — sun swings colour/intensity with the time of day, the
// hearth fire takes over at night.
// ---------------------------------------------------------------------------

function lerp(a, b, t) { return a + (b - a) * t; }

function updateLighting() {
    const tod = game.tod();
    // Daylight factor: full through the day, dipping through evening, low at night.
    let dayF;
    if (tod < 0.06) dayF = tod / 0.06;                       // dawn ramp
    else if (tod < 0.55) dayF = 1;
    else if (tod < 0.72) dayF = 1 - (tod - 0.55) / 0.17;     // dusk ramp
    else dayF = 0;
    sun.intensity = lerp(0.22, 2.1, dayF);
    sun.color = [lerp(0.55, 1.0, dayF), lerp(0.58, 0.95, dayF), lerp(0.85, 0.86, dayF)];
    scene.setAmbient([
        lerp(0.05, 0.20, dayF), lerp(0.06, 0.21, dayF), lerp(0.11, 0.26, dayF),
    ]);
    const flicker = 0.9 + 0.1 * Math.sin(game.time * 9.3) * Math.sin(game.time * 5.1);
    fireLight.intensity = game.fire * lerp(14, 3, dayF) * flicker;
}

// ---------------------------------------------------------------------------
// Selection tint — diffed against the stored tint via world.getTint().
// ---------------------------------------------------------------------------

let selected = null;
const tinted = new Set();     // "x,y" cells we own

function applyTints() {
    const want = new Map();
    if (selected) {
        const c = game.cellOf(selected);
        want.set(c.x + ',' + c.y, [1.5, 1.35, 0.6]);
        want.set(selected.home.x + ',' + selected.home.y, [0.7, 1.1, 1.4]);
    }
    let dirty = false;
    for (const k of [...tinted]) {
        if (want.has(k)) continue;
        const [x, y] = k.split(',').map(Number);
        world.setTint(x, y, 1, 1, 1, 1);
        tinted.delete(k);
        dirty = true;
    }
    for (const [k, rgb] of want) {
        const [x, y] = k.split(',').map(Number);
        const cur = world.getTint(x, y);   // diff against stored state
        if (Math.abs(cur.r - rgb[0]) < 0.02 && Math.abs(cur.g - rgb[1]) < 0.02 &&
            Math.abs(cur.b - rgb[2]) < 0.02) { tinted.add(k); continue; }
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        tinted.add(k);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

// ---------------------------------------------------------------------------
// Per-frame render sync.
// ---------------------------------------------------------------------------

const K = game.kinds;

function syncStatic() {
    world.clearObjects(K.hut); world.clearObjects(K.hutRoof);
    world.clearObjects(K.hearth); world.clearObjects(K.bench);
    world.clearObjects(K.kitchen); world.clearObjects(K.boulder);
    for (const h of game.homes) {
        world.addObject(K.hut, h.x, h.y, { yaw: Math.atan2(23 - h.x, 17 - h.y), scale: 1.25 });
        world.addObject(K.hutRoof, h.x, h.y, { yaw: Math.atan2(23 - h.x, 17 - h.y), scale: 1.25 });
    }
    world.addObject(K.hearth, game.hearth.x, game.hearth.y, { scale: 1.3 });
    world.addObject(K.bench, game.bench.x, game.bench.y, { yaw: Math.PI / 3 });
    world.addObject(K.kitchen, game.kitchen.x, game.kitchen.y, { yaw: -Math.PI / 2 });
    // Boulders scattered on the rise.
    let i = 0;
    for (const c of game.rockCells) {
        if ((i++ % 5) !== 0) continue;
        world.addObject(K.boulder, c.x, c.y, {
            yaw: i * 1.7, scale: 0.7 + (i % 3) * 0.25,
            offsetX: ((i * 7) % 10) / 20 - 0.25, offsetZ: ((i * 13) % 10) / 20 - 0.25,
        });
    }
    game.dirty.static = false;
}

function syncTrees() {
    world.clearObjects(K.tree);
    world.clearObjects(K.stump);
    for (const t of game.trees) {
        if (t.alive)
            world.addObject(K.tree, t.x, t.y, {
                yaw: t.yaw, scale: t.scale, offsetX: t.ox, offsetZ: t.oz,
            });
        else
            world.addObject(K.stump, t.x, t.y, { yaw: t.yaw, offsetX: t.ox, offsetZ: t.oz });
    }
    game.dirty.trees = false;
}

function syncPiles() {
    world.clearObjects(K.stone);
    world.clearObjects(K.meal);
    world.clearObjects(K.logPile);
    const q = game.quarry;
    const nStone = Math.min(game.res.stone, 10);
    for (let i = 0; i < nStone; i++)
        world.addObject(K.stone, q.x, q.y, {
            yaw: i * 2.3,
            offsetX: ((i % 3) - 1) * 0.28, offsetZ: (Math.floor(i / 3) - 1) * 0.24,
            yOffset: 0.02,
        });
    const kc = game.kitchen;
    const nMeals = Math.min(game.res.meals, 8);
    for (let i = 0; i < nMeals; i++)
        world.addObject(K.meal, kc.x, kc.y, {
            offsetX: -0.30 + (i % 4) * 0.17, offsetZ: 0.30 + Math.floor(i / 4) * 0.16,
        });
    const nLogs = Math.min(Math.ceil(game.res.wood / 3), 4);
    for (let i = 0; i < nLogs; i++)
        world.addObject(K.logPile, game.hearth.x - 1, game.hearth.y + 1, {
            yaw: 0.3, offsetX: -0.2 + i * 0.16, offsetZ: 0.1,
        });
    game.dirty.piles = false;
}

function syncDynamic() {
    // Villagers: one kind each, re-anchored per frame with elevation-lerped
    // yOffset so crossing cliffs and the bridge never teleports Y.
    for (let i = 0; i < game.villagers.length; i++) {
        const v = game.villagers[i];
        const kind = K.villagers[i];
        world.clearObjects(kind);
        const ri = game.renderInfo(v);
        let yaw = v.faceYaw || 0;
        if (v.path && v.seg < v.path.length - 1) {
            const a = v.path[v.seg], b = v.path[v.seg + 1];
            yaw = Math.atan2(b.x - a.x, b.y - a.y);
            v.faceYaw = yaw;
        }
        const asleep = v.activity === 'sleeping';
        world.addObject(kind, ri.anchor.x, ri.anchor.y, {
            yaw,
            offsetX: ri.offsetX, offsetZ: ri.offsetZ,
            yOffset: ri.yOffset + (asleep ? -0.06 : 0),
            scale: asleep ? 1.1 : 1.35,
        });
    }
    // Hearth flame: scale with fire level, gentle pulse.
    world.clearObjects(K.flame);
    if (game.fire > 0.03) {
        const s = 0.5 + game.fire * 0.9 + 0.06 * Math.sin(game.time * 7);
        world.addObject(K.flame, game.hearth.x, game.hearth.y, { scale: s, yOffset: 0.06 });
    }
    world.rebuildObjects();
}

// ---------------------------------------------------------------------------
// The mind: Qwen3 over bro.lm, exactly the pi-agent load + generate pattern.
// A test-injected globalThis.__hearthmindGenerate always takes precedence
// (game.activeGenerate resolves it at each think).
// ---------------------------------------------------------------------------

const MODEL_PATH = 'D:/projects/brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf';
const MAX_THINK_TOKENS = 200;

// HEARTHFOLK_NO_MODEL=1 skips the model + voice loads — the deterministic
// test suite runs the full sim tier-0-only (with a fake brain injected via
// globalThis.__hearthmindGenerate) and must not touch gigabytes of weights.
const NO_MODEL = (() => {
    try { return globalThis.process.env.HEARTHFOLK_NO_MODEL === '1'; }
    catch (e) { return false; }
})();

let lm = null;                 // { model, tokenizer }
game.mind.stats = { tokens: 0, genMs: 0 };

function chatmlTurn(role, content) {
    return '<|im_start|>' + role + '\n' + content + '<|im_end|>\n';
}

function installModelGenerate() {
    game.mind.generate = (promptText, parts) => new Promise((resolve, reject) => {
        const chatml = chatmlTurn('system', parts.system) +
            chatmlTurn('user', parts.user) +
            '<|im_start|>assistant\n';
        const ids = lm.tokenizer.encode(chatml);
        const t0 = Date.now();
        try {
            bro.lm.generate(lm.model, ids, {
                maxNewTokens: MAX_THINK_TOKENS,
                eosId: lm.tokenizer.imEndId,
                sampling: { temperature: 0.7, topK: 40, topP: 0.95 },
                onDone: (outIds, info) => {
                    game.mind.stats.tokens += outIds.length;
                    game.mind.stats.genMs += Date.now() - t0;
                    if (info && info.error) { reject(new Error(String(info.error))); return; }
                    resolve(lm.tokenizer.decode(Array.from(outIds)));
                },
            });
        } catch (e) { reject(e); }
    });
}

function loadMind() {
    let exists = false;
    try { exists = !NO_MODEL && fs.existsSync(MODEL_PATH); } catch (e) {}
    if (!exists) {
        game.mind.status = 'off';
        game.mind.statusText = 'minds: off — model not found';
        return;
    }
    game.mind.status = 'loading';
    game.mind.statusText = 'minds: loading…';
    try {
        bro.lm.loadQwen(MODEL_PATH, {
            onReady: ({ model, tokenizer }) => {
                lm = { model, tokenizer };
                installModelGenerate();
                game.mind.status = 'ready';
                game.mind.statusText = 'minds: on (Qwen3-32B)';
                game.addEvent('The villagers’ minds awaken', 'day');
            },
            onError: (e) => {
                game.mind.status = 'off';
                game.mind.statusText = 'minds: off — load failed';
                console.error('mind load failed:', e);
            },
        });
    } catch (e) {
        game.mind.status = 'off';
        game.mind.statusText = 'minds: off — load failed';
    }
}
loadMind();

// ---------------------------------------------------------------------------
// Voices — Kokoro, one distinct voice per villager. Serial queue; drop lines
// when backlogged; skip entirely when weights or audio are unavailable.
// ---------------------------------------------------------------------------

const KOKORO_DIR = 'D:/projects/brosoundml/weights/kokoro';
const tts = { kokoro: null, voices: {}, queue: [], busy: false, enabled: false, spoken: 0 };
let audioCtx = null, engineRate = 44100;

function loadVoices() {
    let exists = false;
    try { exists = !NO_MODEL && fs.existsSync(KOKORO_DIR + '/model.safetensors'); } catch (e) {}
    if (!exists) return;
    try {
        audioCtx = new AudioContext();
        engineRate = audioCtx.sampleRate || 44100;
    } catch (e) { return; }
    try {
        bro.tts.loadKokoro(KOKORO_DIR, {
            onReady: (k) => {
                tts.kokoro = k;
                try {
                    for (const def of VILLAGER_DEFS)
                        tts.voices[def.name] = k.loadVoice(
                            KOKORO_DIR + '/voices/' + def.voice + '.bin');
                    tts.enabled = true;
                } catch (e) { console.warn('voice load failed:', e.message); }
            },
            onError: (m) => console.warn('kokoro load failed:', m),
        });
    } catch (e) { /* voices stay off */ }
}
loadVoices();

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

function pumpTts() {
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
                if (res && res.samples && res.samples.length && audioCtx) {
                    try {
                        const rs = resampleLinear(res.samples, res.sampleRate, engineRate);
                        const clip = audioCtx.createClip(rs, 1);
                        audioCtx.playClip(clip, 0.9, false);
                        tts.spoken++;
                        setTimeout(() => { try { audioCtx.deleteClip(clip); } catch (e) {} },
                            (rs.length / engineRate) * 1000 + 500);
                    } catch (e) { /* playback best-effort */ }
                }
                pumpTts();
            },
            onError: () => { tts.busy = false; pumpTts(); },
        });
    } catch (e) { tts.busy = false; }
}

game.onSay = (v, text) => {
    addFeed(v, text);
    if (tts.enabled && tts.queue.length < 2) {   // drop when backlogged
        tts.queue.push({ name: v.name, text });
        pumpTts();
    }
};

// ---------------------------------------------------------------------------
// DOM UI — status bar, chronicle, feed, bubbles, mind panel.
// ---------------------------------------------------------------------------

const PHASE_LABEL = { dawn: 'Dawn', morning: 'Morning', midday: 'Midday', evening: 'Evening', night: 'Night' };

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

function projectVillager(v) {
    const ri = game.renderInfo(v);
    const cc = world.cellCenterWorldXZ(ri.anchor.x, ri.anchor.y);
    return projectWorld(cc.x + ri.offsetX, ri.worldY + 0.55, cc.z + ri.offsetZ);
}

// Chronicle panel.
const chronicleEl = $('chronicle-list');
game.onChronicle = (e) => {
    const div = document.createElement('div');
    div.className = 'chron-entry ' + e.kind;
    const stamp = document.createElement('span');
    stamp.className = 'chron-stamp';
    stamp.textContent = 'D' + e.day + ' ' + (PHASE_LABEL[e.phase] || e.phase);
    div.appendChild(stamp);
    div.appendChild(document.createTextNode(' ' + e.text));
    chronicleEl.appendChild(div);
    while (chronicleEl.children.length > 120) chronicleEl.removeChild(chronicleEl.firstChild);
    chronicleEl.scrollTop = chronicleEl.scrollHeight;
};
// Backfill boot events recorded before the hook was set.
for (const e of game.chronicle) game.onChronicle(e);

// Conversation feed.
const feedEl = $('feed');
function addFeed(v, text) {
    const div = document.createElement('div');
    div.className = 'feed-line';
    const who = document.createElement('b');
    who.textContent = v.name;
    who.style.color = cssColor(v.color);
    div.appendChild(who);
    div.appendChild(document.createTextNode(': ' + text));
    feedEl.appendChild(div);
    while (feedEl.children.length > 7) feedEl.removeChild(feedEl.firstChild);
}
function cssColor(c) {
    const b = (x) => Math.round(Math.min(1, x * 1.8) * 255);
    return 'rgb(' + b(c[0]) + ',' + b(c[1]) + ',' + b(c[2]) + ')';
}

// Speech bubbles above talkers.
const bubblesEl = $('bubbles');
const bubbleDivs = new Map();     // villager id -> div
function syncBubbles() {
    for (const v of game.villagers) {
        let div = bubbleDivs.get(v.id);
        if (v.say) {
            if (!div) {
                div = document.createElement('div');
                div.className = 'bubble';
                bubblesEl.appendChild(div);
                bubbleDivs.set(v.id, div);
            }
            if (div.textContent !== v.say.text) div.textContent = v.say.text;
            const p = projectVillager(v);
            div.style.left = Math.round(p.x) + 'px';
            div.style.top = Math.round(p.y) + 'px';
        } else if (div) {
            div.remove();
            bubbleDivs.delete(v.id);
        }
    }
}

// Status bar + mind panel.
let hudCache = '';
function updateHUD() {
    const m = game.mind;
    const sig = [game.day(), game.phaseName(), m.statusText, m.accepted, m.discarded,
        game.speed, game.res.food, game.res.wood, game.res.stone, game.res.meals,
        typeof globalThis.__hearthmindGenerate === 'function',
        selected ? selected.id : -1].join('|');
    const needSel = selected != null;   // needs bars update continuously
    if (sig === hudCache && !needSel) return;
    hudCache = sig;

    $('hud-day').textContent = 'Day ' + game.day();
    $('hud-phase').textContent = PHASE_LABEL[game.phaseName()] || game.phaseName();
    const chip = $('mind-chip');
    chip.textContent = (typeof globalThis.__hearthmindGenerate === 'function')
        ? 'minds: test harness' : m.statusText;
    chip.className = 'chip ' + (m.status === 'ready' ? 'on' : m.status === 'loading' ? 'loading' : 'off');
    $('hud-thinks').textContent = '✓ ' + m.accepted + '  ✕ ' + m.discarded;
    $('hud-res').textContent =
        'food ' + game.res.food + ' · wood ' + game.res.wood +
        ' · stone ' + game.res.stone + ' · meals ' + game.res.meals;
    for (const [id, sp] of [['btn-pause', 0], ['btn-1x', 1], ['btn-4x', 4]])
        $(id).classList.toggle('selected', game.speed === sp);

    updateMindPanel();
}

function needBar(id, val) {
    const el = $(id);
    el.style.width = Math.round(Math.min(1, Math.max(0, val)) * 100) + '%';
    el.className = 'bar-fill' + (val > 0.66 ? ' hot' : val > 0.4 ? ' warm' : '');
}

function updateMindPanel() {
    const panel = $('mind-panel');
    if (!selected) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    const v = selected;
    $('mp-name').textContent = v.name;
    $('mp-sub').textContent = v.temperament + ' ' + v.role + ' · ' + v.activity +
        (tts.enabled ? ' · voice ' + v.voice : '');
    $('mp-goal').textContent = v.goal || '—';
    needBar('bar-hunger', v.needs.hunger);
    needBar('bar-energy', v.needs.energy);
    needBar('bar-social', v.needs.social);
    needBar('bar-warmth', v.needs.warmth);
    const think = $('mp-think');
    if (v.lastThink) {
        think.textContent = v.lastThink.discarded
            ? '(discarded)\n' + String(v.lastThink.raw).slice(0, 300)
            : JSON.stringify(v.lastThink.parsed, null, 1);
    } else think.textContent = 'no thoughts yet — tier-0 instinct';
    const mem = $('mp-memories');
    const memSig = v.memories.join('');
    if (mem.dataset.sig !== memSig) {
        mem.dataset.sig = memSig;
        mem.innerHTML = '';
        if (!v.memories.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = 'no memories yet';
            mem.appendChild(li);
        }
        for (const m of v.memories) {
            const li = document.createElement('li');
            li.textContent = m;
            mem.appendChild(li);
        }
    }
}

// ---------------------------------------------------------------------------
// Input.
// ---------------------------------------------------------------------------

function setSpeed(sp) {
    game.speed = sp;
    updateHUD();
}
$('btn-pause').addEventListener('click', () => setSpeed(0));
$('btn-1x').addEventListener('click', () => setSpeed(1));
$('btn-4x').addEventListener('click', () => setSpeed(4));

let toastTimer = null;
function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1900);
}

$('btn-save').addEventListener('click', () => {
    if (game.saveVillage()) toast('Village saved');
});
$('btn-load').addEventListener('click', () => {
    if (!game.hasSave()) { toast('No saved village'); return; }
    if (game.loadVillage()) {
        selected = null;
        for (const k of [...tinted]) {
            const [x, y] = k.split(',').map(Number);
            world.setTint(x, y, 1, 1, 1, 1);
        }
        tinted.clear();
        chronicleEl.innerHTML = '';
        for (const e of game.chronicle) game.onChronicle(e);
        world.rebuild();
        toast('Village loaded');
        hudCache = '';
        updateHUD();
    } else toast('Save file is corrupt');
});

function pickVillager(e) {
    const rect = canvas.getBoundingClientRect();
    const ray = scene.unprojectLocal(e.clientX - rect.left, e.clientY - rect.top);
    if (!ray) return null;
    const hit = world.raycastCell(ray.origin, ray.dir, 500);
    if (!hit) return null;
    let best = null, bestD = 1.6;
    for (const v of game.villagers) {
        const d = Math.hypot(v.pos.x - hit.x, v.pos.y - hit.y);
        if (d < bestD) { bestD = d; best = v; }
    }
    return best;
}

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const v = pickVillager(e);
    selected = (v && v !== selected) ? v : null;
    applyTints();
    hudCache = '';
    updateHUD();
});

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowright' || k === 'd') panKeys.right = true;
    else if (k === 'arrowleft' || k === 'a') panKeys.left = true;
    else if (k === 'arrowup' || k === 'w') panKeys.up = true;
    else if (k === 'arrowdown' || k === 's') panKeys.down = true;
    else if (k === ' ') setSpeed(game.speed === 0 ? 1 : 0);
    else if (k === '1') setSpeed(1);
    else if (k === '4') setSpeed(4);
    else if (k === 'escape') { selected = null; applyTints(); updateHUD(); }
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowright' || k === 'd') panKeys.right = false;
    else if (k === 'arrowleft' || k === 'a') panKeys.left = false;
    else if (k === 'arrowup' || k === 'w') panKeys.up = false;
    else if (k === 'arrowdown' || k === 's') panKeys.down = false;
});
canvas.addEventListener('wheel', (e) => {
    camera.zoom = Math.max(0.28, Math.min(1.4, camera.zoom * (1 + e.deltaY * 0.06)));
    applyCamera();
});

// ---------------------------------------------------------------------------
// Frame loop.
// ---------------------------------------------------------------------------

let lastTs = -1;
let lastSelCell = '';
function frame(ts) {
    const now = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
    const dtMs = lastTs < 0 ? 16 : Math.min(60, Math.max(0, now - lastTs));
    lastTs = now;
    const dt = dtMs / 1000;

    game.update(dt);
    world.advance(dtMs * (game.speed || 0));   // river + ripe-crop sway
    updatePan(dt);
    updateLighting();

    if (game.dirty.static) syncStatic();
    if (game.dirty.trees) syncTrees();
    if (game.dirty.piles) syncPiles();
    syncDynamic();
    syncBubbles();

    // Selection tint follows the selected villager.
    if (selected) {
        const c = game.cellOf(selected);
        const key = c.x + ',' + c.y;
        if (key !== lastSelCell) { lastSelCell = key; applyTints(); }
    }

    updateHUD();
    requestAnimationFrame(frame);
}
updateHUD();
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Test / debug surface.
// ---------------------------------------------------------------------------

window.HEARTH = {
    game, world, scene,
    TILE, FLAG, MAP_W, MAP_H, HSTEP, DAY_LEN, L_GROUND, L_OVER,
    projectWorld, projectVillager, setSpeed,
    get selected() { return selected; },
    get tts() { return tts; },
    debug: {
        select(v) { selected = v; applyTints(); hudCache = ''; updateHUD(); },
        teleport(v, x, y) {
            v.pos = { x, y };
            v.path = null; v.target = null; v.plannedAct = null; v.commit = null;
        },
        forceGoto(v, x, y) {
            v.override = { until: game.time + 120, action: 'idle', target: { x, y } };
            v.target = null; v.plannedAct = null; v.commit = null;
        },
        setNeeds(v, n) { Object.assign(v.needs, n); },
        setRes(res) { Object.assign(game.res, res); },
    },
};
