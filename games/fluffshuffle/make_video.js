// make_video.js — Fluffshuffle highlight reel generator.
//
// Two-pass build:
//   PHASE 1 (silent search): plays the game many times against varied seeds,
//     using a deeper planner that simulates the immediate cascade for every
//     candidate shift. Snapshots (grid + seed + trigger move) for any move
//     whose live cascade reaches the highlight threshold.
//   PHASE 2 (render): picks the top-K highlights, alternates h/v orientations
//     for visual variety, replays each one in the live engine (B.setGrid +
//     B.setSeed + real mouse drag) and captures composited viewport frames
//     (canvas + HTML overlay HUD) plus master-bus audio into one WebM.
//
// Engine quirks worked around:
//   - audio recorder taps master bus before child buses sum in ⇒ override
//     setVoiceBus so SFX voices land directly on master.
//   - addViewportFrame() (added to bro this session) is needed to capture the
//     HTML HUD that addCanvasFrame skipped.
//
// Run from the broworkshop root:
//   $env:BRO_PROJECT_ROOT="D:/projects/broworkshop"
//   ../bro/build/Release/bro-headless.exe --width 900 --height 800 \
//        games/fluffshuffle games/fluffshuffle/make_video.js

'use strict';

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
const FPS              = 30;
const W                = 900;
const H                = 800;
const FRAME_MS         = 1000 / FPS;
const OUT_PATH         = 'games/fluffshuffle/fluffshuffle.webm';
const CACHE_PATH       = 'highlights.json';   // resolves under the app dir

// Phase 1 search budget.
const SEARCH_TRIALS    = 220;    // distinct starting seeds to explore
const MOVES_PER_TRIAL  = 32;     // depth of play per trial
const CHAIN_FLOOR      = 5;      // min chain depth to keep as a chain-highlight
const POPS_FLOOR       = 7;      // min cells popped on the FIRST wave for a pop-highlight
const TARGET_CHAIN     = 8;      // stop early once we have enough at this level
const MIN_HIGHLIGHTS   = 4;      // need N at TARGET_CHAIN to exit early
const CHAIN_OUTPUT     = 4;      // chain-type clips per reel
const POPS_OUTPUT      = 4;      // pop-type clips per reel
const RAND_MOVE_PROB   = 0.35;   // fraction of search moves picked randomly (explores wider)

// Phase 2 render budget per highlight (frames).
const PRE_ROLL         = 18;     // ~0.6s of board-sitting before the drag
const POST_ROLL        = 36;     // ~1.2s of aftermath
const CASCADE_CAP      = 240;    // safety cap for the cascade itself

// -----------------------------------------------------------------------------
// Boot the game into classic mode.
// -----------------------------------------------------------------------------
advanceTime(300);
const hooks = window.__fluffshuffle;
if (!hooks) throw new Error('fluffshuffle hooks missing — game did not load');
const B      = hooks.board;
const canvas = document.getElementById('game');
const actx   = SFX.ctx();
if (!actx) throw new Error('AudioContext not initialized');

// SFX → master so recording captures it (engine bug workaround).
actx.setVoiceBus = function () {};

function clickEl(sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error('missing menu el: ' + sel);
    const r = el.getBoundingClientRect();
    click(r.x + r.width / 2, r.y + r.height / 2);
}

function enterClassic() {
    hooks.screens.switchTo('title');
    advanceTime(150);
    clickEl('.menu-item[data-action="play"]');
    advanceTime(150);
    clickEl('.menu-item[data-mode="classic"]');
    advanceTime(300);
    if (B.getMode() !== 'classic') throw new Error('failed to enter classic');
}

enterClassic();

// -----------------------------------------------------------------------------
// Move planner — picks the highest-scoring single shift.
// -----------------------------------------------------------------------------
function evalShift(grid, shift) {
    const sg = (shift.axis === 'h')
        ? B.slideRow(grid, shift.index, shift.k)
        : B.slideCol(grid, shift.index, shift.k);
    const groups = B.findMatches(sg);
    if (groups.length === 0) return 0;
    let score = 0, cells = 0;
    for (const g of groups) {
        cells += g.size;
        if (g.special === B.SPECIAL_PRISM)      score += 800;
        else if (g.special === B.SPECIAL_ARROW) score += 500;
        else if (g.special === B.SPECIAL_JUMBO) score += 300;
    }
    score += cells * 50;
    // Modest bonus for matches that span lots of rows/cols (sets up cascades).
    const rows = new Set(), cols = new Set();
    for (const g of groups) for (const [r, c] of g.cells) { rows.add(r); cols.add(c); }
    score += (rows.size + cols.size) * 5;
    return score;
}

function enumerateMatchingShifts(grid) {
    const ls = B.legalShifts(grid);
    const hRows = new Set(), vCols = new Set();
    for (const s of ls) (s.axis === 'h' ? hRows : vCols).add(s.index);
    const out = [];
    for (const r of hRows) for (let k = 1; k < B.COLS; k++) {
        const s = { axis: 'h', index: r, k };
        const sc = evalShift(grid, s);
        if (sc > 0) out.push({ ...s, expectedScore: sc });
    }
    for (const c of vCols) for (let k = 1; k < B.ROWS; k++) {
        const s = { axis: 'v', index: c, k };
        const sc = evalShift(grid, s);
        if (sc > 0) out.push({ ...s, expectedScore: sc });
    }
    return out;
}

function pickBestMove() {
    const all = enumerateMatchingShifts(B.getGrid());
    if (!all.length) return null;
    let best = all[0];
    for (const s of all) if (s.expectedScore > best.expectedScore) best = s;
    return best;
}

// Pick uniformly at random among matching shifts (search exploration).
function pickRandomMatchingMove(rng) {
    const all = enumerateMatchingShifts(B.getGrid());
    if (!all.length) return null;
    return all[Math.floor(rng() * all.length)];
}

// -----------------------------------------------------------------------------
// Headless time pump (no encoding — used during phase 1 search).
// -----------------------------------------------------------------------------
function silentTick(ms) { advanceTime(ms); flush(); }
function silentWaitIdle(maxMs) {
    let t = 0;
    while ((B.isAnimating() || B.getChain() > 0) && t < maxMs) {
        silentTick(FRAME_MS);
        t += FRAME_MS;
    }
}

function deepCopyGrid(g) {
    return g.map(row => row.map(c => c ? { ...c } : null));
}

// -----------------------------------------------------------------------------
// Phase 1 — search.
//
// For each trial: reseed, regenerate grid, then play a number of best-move
// turns. Before each move we pin a fresh seed (so the cascade is reproducible
// in phase 2). We snapshot the pre-move grid + seed + move and observe the
// peak chain that actually unfolds. Anything reaching HIGHLIGHT_FLOOR is kept.
// -----------------------------------------------------------------------------
// Count cells cleared by the FIRST match wave only (the "single-move pop").
// This is what the player sees as a big simultaneous burst, BEFORE any
// cascading refill matches happen.
function countFirstWavePops(grid, move) {
    const slid = (move.axis === 'h')
        ? B.slideRow(grid, move.index, move.k)
        : B.slideCol(grid, move.index, move.k);
    const groups = B.findMatches(slid);
    let n = 0;
    for (const g of groups) n += g.size;
    return n;
}

function searchPhase() {
    const out = [];
    let bestChain = 0, bestPops = 0;
    const chainHist = {};
    const popsHist = {};

    // Tiny LCG used only to drive the explorer's random move choices —
    // independent of the game's rngState.
    let exploreState = 0xC0FFEE;
    const exploreRng = () => {
        exploreState = (Math.imul(exploreState, 1664525) + 1013904223) >>> 0;
        return exploreState / 0x100000000;
    };

    for (let trial = 0; trial < SEARCH_TRIALS; trial++) {
        const trialSeed = (0xA17C0DE ^ (trial * 0x9E3779B1)) >>> 0;
        B.setSeed(trialSeed);
        const fresh = B.seedGrid();
        B.setGrid(fresh);

        for (let m = 0; m < MOVES_PER_TRIAL; m++) {
            silentWaitIdle(2000);
            if (B.isGameOver()) break;

            const move = (exploreRng() < RAND_MOVE_PROB)
                ? pickRandomMatchingMove(exploreRng)
                : pickBestMove();
            if (!move) break;

            const gridSnap = deepCopyGrid(B.getGrid());
            const popsCount = countFirstWavePops(gridSnap, move);
            const moveSeed = ((trialSeed * 31) ^ (m * 0xC2B2AE35) ^ 0xBEEF) >>> 0 || 1;
            B.setSeed(moveSeed);

            const newGrid = (move.axis === 'h')
                ? B.slideRow(B.getGrid(), move.index, move.k)
                : B.slideCol(B.getGrid(), move.index, move.k);
            B.setGrid(newGrid);
            B.resolveMatchesNow();

            let peak = 0;
            let t = 0;
            while ((B.isAnimating() || B.getChain() > 0) && t < 4000) {
                peak = Math.max(peak, B.getChain());
                silentTick(FRAME_MS);
                t += FRAME_MS;
            }

            chainHist[peak] = (chainHist[peak] || 0) + 1;
            popsHist[popsCount] = (popsHist[popsCount] || 0) + 1;

            if (peak >= CHAIN_FLOOR || popsCount >= POPS_FLOOR) {
                out.push({
                    trialIdx: trial,
                    moveIdx: m,
                    seed: moveSeed,
                    grid: gridSnap,
                    move,
                    chain: peak,
                    pops: popsCount,
                });
                if (peak > bestChain) {
                    bestChain = peak;
                    console.log('[search] trial=' + trial + ' move=' + m +
                                ' ' + move.axis + move.index + ' k=' + move.k +
                                ' chain=' + peak + ' pops=' + popsCount + ' (chain best)');
                }
                if (popsCount > bestPops) {
                    bestPops = popsCount;
                    console.log('[search] trial=' + trial + ' move=' + m +
                                ' ' + move.axis + move.index + ' k=' + move.k +
                                ' chain=' + peak + ' pops=' + popsCount + ' (pops best)');
                }
            }
        }

        if (out.filter(h => h.chain >= TARGET_CHAIN).length >= MIN_HIGHLIGHTS) {
            console.log('[search] chain target met early at trial ' + trial);
            break;
        }
    }
    const fmtHist = (h) => Object.keys(h).sort((a, b) => +a - +b)
        .map(k => k + ':' + h[k]).join(' ');
    console.log('[search] chain histogram → ' + fmtHist(chainHist));
    console.log('[search] pops  histogram → ' + fmtHist(popsHist));
    return out;
}

// Try cache first — search takes ~25min, presentation tweaks shouldn't pay
// that cost every time. Delete the cache file to force a fresh search.
const fs = require('fs');
const CACHE_VERSION = 2; // bump when the highlight schema changes
function loadCache() {
    try {
        if (!fs.existsSync(CACHE_PATH)) return null;
        const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
        if (parsed.version !== CACHE_VERSION) {
            console.log('[cache] version mismatch (have ' + parsed.version +
                        ', want ' + CACHE_VERSION + ') — re-searching');
            return null;
        }
        if (!Array.isArray(parsed.highlights)) return null;
        console.log('[cache] loaded ' + parsed.highlights.length +
                    ' highlights from ' + CACHE_PATH);
        return parsed.highlights;
    } catch (e) {
        console.log('[cache] read err: ' + e.message);
        return null;
    }
}
function saveCache(highlights) {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify({
            version: CACHE_VERSION,
            generated: Date.now(),
            count: highlights.length,
            highlights,
        }), 'utf-8');
        console.log('[cache] wrote ' + CACHE_PATH);
    } catch (e) {
        console.log('[cache] write failed: ' + e.message);
    }
}

let allHighlights = loadCache();
if (!allHighlights) {
    console.log('[phase1] searching for chain >= ' + TARGET_CHAIN +
                ' over up to ' + SEARCH_TRIALS + ' trials × ' + MOVES_PER_TRIAL + ' moves');
    allHighlights = searchPhase();
    saveCache(allHighlights);
}
console.log('[phase1] ' + allHighlights.length + ' candidate highlights');

if (allHighlights.length === 0) {
    throw new Error('no highlights found — try lowering HIGHLIGHT_FLOOR');
}

// -----------------------------------------------------------------------------
// Pick top-K, alternating axis orientation for variety.
// -----------------------------------------------------------------------------
// Pick top-K from a sorted pool, deduping by (axis, row/col) so the reel
// doesn't show three almost-identical clips of "row 3 shifted right".
function pickTopUnique(pool, sortFn, want, taken) {
    const sorted = [...pool].sort(sortFn);
    const seenAxisIdx = new Set();
    const out = [];
    for (const h of sorted) {
        if (taken.has(h)) continue;
        const key = h.move.axis + ':' + h.move.index;
        if (seenAxisIdx.has(key)) continue;
        seenAxisIdx.add(key);
        out.push(h);
        taken.add(h);
        if (out.length >= want) break;
    }
    // Top-up if dedup pruned us short.
    if (out.length < want) {
        for (const h of sorted) {
            if (taken.has(h)) continue;
            out.push(h);
            taken.add(h);
            if (out.length >= want) break;
        }
    }
    return out;
}

function selectHighlights(pool) {
    // Two parallel pools — chain-type and pops-type — so the reel showcases
    // both kinds of climax. Use a shared `taken` set to prevent the same
    // highlight from landing in both lists.
    const taken = new Set();
    const chainPicks = pickTopUnique(
        pool.filter(h => h.chain >= CHAIN_FLOOR),
        (a, b) => b.chain - a.chain || b.pops - a.pops,
        CHAIN_OUTPUT, taken);
    const popPicks = pickTopUnique(
        pool.filter(h => h.pops >= POPS_FLOOR),
        (a, b) => b.pops - a.pops || b.chain - a.chain,
        POPS_OUTPUT, taken);

    chainPicks.forEach(h => h._kind = 'chain');
    popPicks.forEach(h => h._kind = 'pops');

    // Reel arc: build from smaller hits → bigger ones, climax at the end.
    // We zip the two pools (asc by their respective metric) and the absolute
    // best hit (max(chain*100, pops*15) — rough "wow factor") plays last.
    const wow = (h) => h._kind === 'chain' ? h.chain * 100 : h.pops * 15;
    const ascChain = [...chainPicks].sort((a, b) => a.chain - b.chain);
    const ascPops  = [...popPicks].sort((a, b) => a.pops - b.pops);

    // Interleave for orientation/kind variety.
    const interleaved = [];
    while (ascChain.length || ascPops.length) {
        // Alternate, pulling from the longer pool first to avoid trailing runs.
        if (ascChain.length >= ascPops.length && ascChain.length) {
            interleaved.push(ascChain.shift());
        } else if (ascPops.length) {
            interleaved.push(ascPops.shift());
        }
    }
    // Hoist the single biggest "wow" highlight to the very end as the finale.
    let bestI = 0;
    for (let i = 1; i < interleaved.length; i++) {
        if (wow(interleaved[i]) > wow(interleaved[bestI])) bestI = i;
    }
    const finale = interleaved.splice(bestI, 1)[0];
    if (finale) interleaved.push(finale);
    return interleaved;
}

const highlights = selectHighlights(allHighlights);
console.log('[render] selected ' + highlights.length + ' highlights:');
for (const h of highlights) {
    console.log('  chain=' + h.chain + ' ' + h.move.axis + h.move.index + ' k=' + h.move.k);
}

// -----------------------------------------------------------------------------
// Phase 2 — render highlights into one webm.
// -----------------------------------------------------------------------------
const enc = new VideoEncoder({
    path: OUT_PATH,
    width: W, height: H, fps: FPS,
    audioSampleRate: 48000,
    audioChannels: 1,
    quality: 'good',
    bitrateKbps: 4000,
});

let framesEncoded = 0;
function pumpFrames(n) {
    for (let i = 0; i < n; i++) {
        advanceTime(FRAME_MS);
        flush();
        enc.addViewportFrame();   // composited canvas + HUD overlay
        framesEncoded++;
    }
}
function pumpUntilIdle(cap) {
    let t = 0;
    while ((B.isAnimating() || B.getChain() > 0) && t < cap) {
        pumpFrames(1); t++;
    }
}

function executeMoveWithMouse(shift) {
    const layout = B.getLayout();
    const cell = layout.cell;
    let r0, c0, dx, dy;
    if (shift.axis === 'h') {
        r0 = shift.index;
        c0 = Math.floor(B.COLS / 2);
        let k = shift.k; if (k > B.COLS / 2) k -= B.COLS;
        dx = k * cell; dy = 0;
    } else {
        r0 = Math.floor(B.ROWS / 2);
        c0 = shift.index;
        let k = shift.k; if (k > B.ROWS / 2) k -= B.ROWS;
        dx = 0; dy = k * cell;
    }
    const sx = layout.ox + (c0 + 0.5) * cell;
    const sy = layout.oy + (r0 + 0.5) * cell;
    mouseDown(sx, sy);
    pumpFrames(2);
    const STEPS = 8;
    for (let i = 1; i <= STEPS; i++) {
        mouseMove(sx + dx * (i / STEPS), sy + dy * (i / STEPS));
        pumpFrames(1);
    }
    mouseUp(sx + dx, sy + dy);
    pumpFrames(2);
}

// Make sure we're in a fresh classic game so HUD is visible.
enterClassic();
B.setScore(0);
actx.startRecording();
console.log('[render] encoder open, recording started');

for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];

    // Drain any ambient animation, then load the highlight scene.
    while (B.isAnimating()) { advanceTime(FRAME_MS); flush(); }
    B.setGrid(deepCopyGrid(h.grid));
    B.setSeed(h.seed);
    flush();

    console.log('[render] ' + (i + 1) + '/' + highlights.length +
                ' kind=' + (h._kind || '?') +
                ' chain=' + h.chain + ' pops=' + h.pops +
                ' ' + h.move.axis + h.move.index + ' k=' + h.move.k +
                ' frame=' + framesEncoded);

    // Pre-roll: board sits, viewer sees the setup.
    pumpFrames(PRE_ROLL);

    // Climax: drag → cascade.
    executeMoveWithMouse(h.move);
    pumpUntilIdle(CASCADE_CAP);

    // Post-roll: hold the aftermath.
    pumpFrames(POST_ROLL);
}

// -----------------------------------------------------------------------------
// Finalize: stop recording, mux audio, close.
// -----------------------------------------------------------------------------
const pcm = actx.stopRecording();
console.log('[render] frames=' + framesEncoded +
            ' final-score=' + B.getScore() +
            ' max-chain=' + B.getMaxChain() +
            ' recorded-samples=' + (pcm ? pcm.length : 0));

if (pcm && pcm.length > 0) {
    const srcSR = actx.sampleRate, dstSR = 48000;
    if (srcSR === dstSR) {
        enc.addAudioFramesPCM(pcm);
    } else {
        const ratio = srcSR / dstSR;
        const dstLen = Math.floor(pcm.length / ratio);
        const out = new Float32Array(dstLen);
        for (let i = 0; i < dstLen; i++) {
            const sp = i * ratio;
            const i0 = sp | 0;
            const f  = sp - i0;
            const s0 = pcm[i0];
            const s1 = i0 + 1 < pcm.length ? pcm[i0 + 1] : s0;
            out[i] = s0 + (s1 - s0) * f;
        }
        enc.addAudioFramesPCM(out);
    }
}
enc.finish();
console.log('[render] wrote ' + OUT_PATH);
