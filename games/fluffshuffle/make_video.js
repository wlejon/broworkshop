// make_video.js — Fluffshuffle highlight reel (WebM with sound). Not a test.
//
// Two passes:
//   1. Search (silent): play many seeded classic games with a greedy-ish
//      planner and keep every move whose cascade runs deep (chain) or whose
//      first wave pops a lot of puffs. Cached, because it is slow; delete the
//      cache file to search again.
//   2. Render: replay the best moves in the live game (same grid, same refill
//      seed, a real mouse drag) and capture the composited viewport (canvas +
//      HUD) plus the audio output into one WebM.
//
// Run from the broworkshop root:
//   ../bro/build/Release/bro-headless.exe --width 900 --height 800 \
//       games/fluffshuffle games/fluffshuffle/make_video.js
// Output: tests/out/fluffshuffle.webm (cache: tests/out/fluffshuffle-highlights.json)

import { copyGrid } from "/lib/arcade/grid.js";
import { seededRandom } from "/lib/arcade/random.js";

const fs = require("fs");

// ── Config ────────────────────────────────────────────────────────────────

const FPS = 30;
const W = 900, H = 800;
const FRAME_MS = 1000 / FPS;
const OUT_DIR = String(bro.appDir).replace(/\\/g, "/") + "/../../tests/out";
const OUT_PATH = OUT_DIR + "/fluffshuffle.webm";
const CACHE_PATH = OUT_DIR + "/fluffshuffle-highlights.json";
const CACHE_VERSION = 3;          // bump when the highlight schema or the rules change

// Search budget.
const SEARCH_TRIALS = 220;        // distinct starting seeds
const MOVES_PER_TRIAL = 32;
const CHAIN_FLOOR = 5;            // keep as a chain highlight from this depth
const POPS_FLOOR = 7;             // keep as a pop highlight from this many first-wave puffs
const TARGET_CHAIN = 8;           // stop early once MIN_HIGHLIGHTS reach this depth
const MIN_HIGHLIGHTS = 4;
const CHAIN_OUTPUT = 4;           // clips of each kind in the reel
const POPS_OUTPUT = 4;
const RAND_MOVE_PROB = 0.35;      // share of search moves picked at random (explores wider)

// Render budget per clip (frames).
const PRE_ROLL = 18;
const POST_ROLL = 36;
const CASCADE_CAP = 240;

// ── Game handles ──────────────────────────────────────────────────────────

advanceTime(300);
const F = window.__fluffshuffle;
if (!F) throw new Error("fluffshuffle hooks missing: the game did not load");
const R = F.rules;
const { ROWS, COLS, SPECIAL } = R;
const clone = (g) => copyGrid(g, R.clonePuff);

/** The current classic board, starting a fresh run if the last one ended. */
function board() {
    if (F.screen !== "playing" || !F.board || F.board.ended() || F.board.mode !== "classic") F.startRun("classic");
    return F.board;
}

// ── Planner ───────────────────────────────────────────────────────────────

function slid(grid, s) {
    return s.axis === "h" ? R.slideRow(grid, s.index, s.k) : R.slideCol(grid, s.index, s.k);
}

/** Heuristic value of a shift: puffs matched, specials made, lines touched. */
function evalShift(grid, s) {
    const groups = R.findMatches(slid(grid, s));
    if (!groups.length) return 0;
    let score = 0;
    const rows = new Set(), cols = new Set();
    for (const g of groups) {
        score += g.size * 50;
        if (g.special === SPECIAL.PRISM) score += 800;
        else if (g.special === SPECIAL.ARROW) score += 500;
        else if (g.special === SPECIAL.JUMBO) score += 300;
        for (const [r, c] of g.cells) { rows.add(r); cols.add(c); }
    }
    return score + (rows.size + cols.size) * 5;   // wide matches set up cascades
}

/** Every matching shift (all k) of the lines that have at least one. */
function matchingShifts(grid) {
    const out = [];
    for (const s of R.legalShifts(grid)) {
        const n = s.axis === "h" ? COLS : ROWS;
        for (let k = 1; k < n; k++) {
            const m = { axis: s.axis, index: s.index, k };
            const value = evalShift(grid, m);
            if (value > 0) out.push(Object.assign(m, { value }));
        }
    }
    return out;
}

function firstWavePops(grid, s) {
    return R.findMatches(slid(grid, s)).reduce((n, g) => n + g.size, 0);
}

// ── Time ──────────────────────────────────────────────────────────────────

function tick() { advanceTime(FRAME_MS); flush(); }

/** Run a scripted move to rest; returns the deepest chain it reached. */
function playMove(b, move, onFrame) {
    if (!b.shift(move.axis, move.index, move.k)) return 0;
    let peak = 0;
    for (let t = 0; b.busy() && t < CASCADE_CAP * 2; t++) {
        onFrame();
        peak = Math.max(peak, b.chain);
    }
    return peak;
}

// ── Pass 1: search ────────────────────────────────────────────────────────

function search() {
    const out = [];
    const explore = seededRandom(0xc0ffee);
    let bestChain = 0, bestPops = 0;
    for (let trial = 0; trial < SEARCH_TRIALS; trial++) {
        const trialSeed = (0xa17c0de ^ Math.imul(trial, 0x9e3779b1)) >>> 0;
        let b = board();
        b.rand = seededRandom(trialSeed);
        b.setGrid(R.seedGrid(b.rand));
        for (let m = 0; m < MOVES_PER_TRIAL; m++) {
            while (b.busy()) tick();
            if (b.ended()) break;
            const all = matchingShifts(b.grid);
            if (!all.length) break;
            const move = explore() < RAND_MOVE_PROB
                ? all[Math.floor(explore() * all.length)]
                : all.reduce((a, s) => (s.value > a.value ? s : a));
            const grid = clone(b.grid);
            const pops = firstWavePops(grid, move);
            const seed = (Math.imul(trialSeed, 31) ^ Math.imul(m, 0xc2b2ae35) ^ 0xbeef) >>> 0 || 1;
            b.rand = seededRandom(seed);
            const chain = playMove(b, move, tick);
            if (chain < CHAIN_FLOOR && pops < POPS_FLOOR) continue;
            out.push({ trial, moveIdx: m, seed, grid, move: { axis: move.axis, index: move.index, k: move.k }, chain, pops });
            if (chain > bestChain || pops > bestPops) {
                bestChain = Math.max(bestChain, chain);
                bestPops = Math.max(bestPops, pops);
                console.log("[search] trial=" + trial + " move=" + m + " " + move.axis + move.index + " k=" + move.k +
                    " chain=" + chain + " pops=" + pops);
            }
        }
        if (out.filter((h) => h.chain >= TARGET_CHAIN).length >= MIN_HIGHLIGHTS) {
            console.log("[search] chain target met at trial " + trial);
            break;
        }
    }
    return out;
}

function loadCache() {
    try {
        if (!fs.existsSync(CACHE_PATH)) return null;
        const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
        if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.highlights)) return null;
        console.log("[cache] " + parsed.highlights.length + " highlights from " + CACHE_PATH);
        return parsed.highlights;
    } catch (e) {
        console.log("[cache] unreadable: " + e.message);
        return null;
    }
}

let pool = loadCache();
if (!pool) {
    console.log("[search] up to " + SEARCH_TRIALS + " trials x " + MOVES_PER_TRIAL + " moves");
    pool = search();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ version: CACHE_VERSION, generated: Date.now(), highlights: pool }), "utf-8");
}
if (!pool.length) throw new Error("no highlights found; lower CHAIN_FLOOR / POPS_FLOOR");

// ── Pick the reel ─────────────────────────────────────────────────────────

/** Top `want` by `order`, one clip per line (axis + index) where possible. */
function pickTop(candidates, order, want, taken) {
    const sorted = candidates.slice().sort(order);
    const lines = new Set();
    const out = [];
    for (const pass of [true, false]) {
        for (const h of sorted) {
            if (out.length >= want) break;
            const line = h.move.axis + h.move.index;
            if (taken.has(h) || (pass && lines.has(line))) continue;
            lines.add(line);
            taken.add(h);
            out.push(h);
        }
    }
    return out;
}

/** Alternate chain and pop clips, smaller to bigger, the biggest last. */
function selectReel(all) {
    const taken = new Set();
    const chains = pickTop(all.filter((h) => h.chain >= CHAIN_FLOOR), (a, b) => b.chain - a.chain || b.pops - a.pops, CHAIN_OUTPUT, taken)
        .map((h) => Object.assign(h, { kind: "chain" })).sort((a, b) => a.chain - b.chain);
    const pops = pickTop(all.filter((h) => h.pops >= POPS_FLOOR), (a, b) => b.pops - a.pops || b.chain - a.chain, POPS_OUTPUT, taken)
        .map((h) => Object.assign(h, { kind: "pops" })).sort((a, b) => a.pops - b.pops);
    const reel = [];
    while (chains.length || pops.length) reel.push(chains.length >= pops.length ? chains.shift() : pops.shift());
    const wow = (h) => (h.kind === "chain" ? h.chain * 100 : h.pops * 15);
    let best = 0;
    reel.forEach((h, i) => { if (wow(h) > wow(reel[best])) best = i; });
    reel.push(reel.splice(best, 1)[0]);
    return reel;
}

const reel = selectReel(pool);
console.log("[render] " + reel.length + " clips: " + reel.map((h) => h.kind + " c" + h.chain + "/p" + h.pops).join(", "));

// ── Pass 2: render ────────────────────────────────────────────────────────

const enc = new VideoEncoder({
    path: OUT_PATH, width: W, height: H, fps: FPS,
    audioSampleRate: 48000, audioChannels: 1, quality: "good", bitrateKbps: 4000,
});
let frameCount = 0;
function frame() {
    tick();
    enc.addViewportFrame();   // canvas + HUD overlay
    frameCount++;
}
function frames(n) { for (let i = 0; i < n; i++) frame(); }

/** Drag the move's line from its middle cell, like a player would. */
function dragMove(move) {
    const L = F.run.layout, view = F.shell.api.view;
    const rect = view.canvas.getBoundingClientRect();
    const sx = rect.width / view.width(), sy = rect.height / view.height();
    const n = move.axis === "h" ? COLS : ROWS;
    const k = move.k > n / 2 ? move.k - n : move.k;       // shortest way round
    const r0 = move.axis === "h" ? move.index : Math.floor(ROWS / 2);
    const c0 = move.axis === "h" ? Math.floor(COLS / 2) : move.index;
    const x0 = rect.left + (L.ox + (c0 + 0.5) * L.cell) * sx;
    const y0 = rect.top + (L.oy + (r0 + 0.5) * L.cell) * sy;
    const dx = move.axis === "h" ? k * L.cell * sx : 0;
    const dy = move.axis === "v" ? k * L.cell * sy : 0;
    mouseDown(x0, y0);
    frames(2);
    for (let i = 1; i <= 8; i++) {
        mouseMove(x0 + dx * i / 8, y0 + dy * i / 8);
        frames(1);
    }
    mouseUp(x0 + dx, y0 + dy);
    frames(2);
}

F.startRun("classic");
const actx = F.shell.api.audio.ctx();
if (actx) actx.startRecording();

reel.forEach((h, i) => {
    let b = board();
    while (b.busy()) tick();
    b = board();
    b.setGrid(clone(h.grid));
    b.rand = seededRandom(h.seed);
    console.log("[render] " + (i + 1) + "/" + reel.length + " " + h.kind + " chain=" + h.chain + " pops=" + h.pops +
        " " + h.move.axis + h.move.index + " k=" + h.move.k + " frame=" + frameCount);
    frames(PRE_ROLL);
    dragMove(h.move);
    let peak = b.chain;
    for (let t = 0; b.busy() && t < CASCADE_CAP; t++) {
        frame();
        peak = Math.max(peak, b.chain);
    }
    if (peak !== h.chain) console.log("[render]   replay reached chain " + peak + ", search saw " + h.chain);
    frames(POST_ROLL);
});

const pcm = actx ? actx.stopRecording() : null;
console.log("[render] frames=" + frameCount + " score=" + F.board.score + " samples=" + (pcm ? pcm.length : 0));
if (pcm && pcm.length) enc.addAudioFramesPCM(resample(pcm, actx.sampleRate, 48000));
enc.finish();
console.log("[render] wrote " + OUT_PATH);

/** Linear resample of mono PCM. */
function resample(pcm, from, to) {
    if (from === to) return pcm;
    const ratio = from / to;
    const out = new Float32Array(Math.floor(pcm.length / ratio));
    for (let i = 0; i < out.length; i++) {
        const p = i * ratio, i0 = p | 0, f = p - i0;
        const a = pcm[i0], b = i0 + 1 < pcm.length ? pcm[i0 + 1] : a;
        out[i] = a + (b - a) * f;
    }
    return out;
}
