// Wordspire board — one play session: the letter chain, submitting words,
// gravity + refill, reward tiles, burning tiles (classic), the clock
// (timed) and target words (puzzle). No drawing (render.js), no DOM.
// Effects go out through `fx`: cue(name) · toast(text) · burst(r, c, color)
// · shake(ms, amp) · word(entry) for the top-words list.

import { createFalls, collapse, seededRandom } from "/lib/arcade/grid.js";
import {
    ROWS, COLS, MIN_WORD, newTile, emptyGrid, fillGrid, isValidPath, adjacent, pathWord, pathTiles,
    findWords, descendBurning, sprinkleBurning, rewardFor,
} from "/app/letters.js";
import { computeWordScore, comboMultiplier } from "/app/scoring.js";
import { Dictionary } from "/app/dictionary.js";

const TIMED_MS = 180000;
export const PUZZLE_COUNT = 20;
export const POP_MS = 380;
const FALL_MS = 160;
const BURN_CHANCE = [0.18, 0.32, 0.55];   // per word, by difficulty (easy / normal / hard)

export class Board {
    /**
     * @param {object} opts { mode, fx, rand, difficulty: 0|1|2 }
     */
    constructor(opts) {
        this.mode = opts.mode || "classic";
        this.fx = opts.fx;
        this.rand = opts.rand || Math.random;
        this.difficulty = opts.difficulty != null ? opts.difficulty : 1;

        this.score = 0;
        this.level = 1;
        this.streak = 0;
        this.words = 0;
        this.longest = "";
        this.bestWord = "";
        this.bestWordScore = 0;
        this.doused = 0;           // burning tiles put out by using them
        this.time = 0;
        this.timeLeft = this.mode === "timed" ? TIMED_MS : 0;
        this.over = false;
        this.finished = false;

        this.puzzleIndex = 0;
        this.puzzleSolved = 0;
        this.target = "";

        this.chain = [];           // [[r, c], ...]
        this.cursor = { r: Math.floor(ROWS / 2), c: Math.floor(COLS / 2) };
        this.pops = [];            // { r, c, letter, t } fading letters where tiles popped
        this.falls = createFalls(FALL_MS);

        if (this.mode === "puzzle") this.loadPuzzle(0);
        else this.grid = this.freshGrid(this.rand);
    }

    /** A random board with at least one findable word (10 tries). */
    freshGrid(rand) {
        let g = null;
        for (let k = 0; k < 10; k++) {
            g = fillGrid(emptyGrid(), rand);
            if (!Dictionary.loaded() || findWords(g, Dictionary, 1).length) break;
        }
        return g;
    }

    ended() {
        return this.over || this.finished;
    }

    setGrid(g) {
        this.grid = g;
        this.chain = [];
        this.pops = [];
        this.falls.clear();
    }

    /** Puzzle i: a seeded board whose longest findable word (5+ preferred) is the target. */
    loadPuzzle(i) {
        this.puzzleIndex = i;
        const rand = seededRandom(0x1234 + i * 7919);
        for (let attempt = 0; attempt < 30; attempt++) {
            const g = fillGrid(emptyGrid(), rand);
            const hits = findWords(g, Dictionary, 12);
            if (!hits.length) continue;
            const best = hits.reduce((a, b) => (b.word.length > a.word.length ? b : a));
            this.setGrid(g);
            this.target = best.word;
            return;
        }
        this.setGrid(fillGrid(emptyGrid(), rand));
        this.target = "";
    }

    /** The chain spelled out, and whether it is a word. */
    preview() {
        const word = pathWord(this.chain, this.grid);
        return {
            word,
            points: computeWordScore(word, pathTiles(this.chain, this.grid)),
            valid: word.length >= MIN_WORD && Dictionary.isWord(word),
        };
    }

    // ── Chain ──────────────────────────────────────────────────────────

    /**
     * Tap a tile: start / extend the chain, tap the last tile again to drop
     * it, tap the one before it to back up. Returns true if the chain changed.
     */
    tap(r, c) {
        if (this.ended() || !this.grid[r] || !this.grid[r][c]) return false;
        this.cursor = { r, c };
        const ch = this.chain;
        const at = (i) => ch[i] && ch[i][0] === r && ch[i][1] === c;
        if (!ch.length) {
            ch.push([r, c]);
            this.fx.cue("tile@1");
            return true;
        }
        if (at(ch.length - 1) || at(ch.length - 2)) {
            this.removeLast();
            return true;
        }
        if (!adjacent(ch[ch.length - 1], [r, c]) || ch.some((p) => p[0] === r && p[1] === c)) return false;
        ch.push([r, c]);
        this.fx.cue("tile@" + ch.length);
        return true;
    }

    removeLast() {
        if (!this.chain.length) return;
        this.chain.pop();
        this.fx.cue("tile_remove");
    }

    clearChain() {
        if (!this.chain.length) return;
        this.chain = [];
        this.fx.cue("clear_chain");
    }

    moveCursor(dr, dc) {
        this.cursor.r = Math.max(0, Math.min(ROWS - 1, this.cursor.r + dr));
        this.cursor.c = Math.max(0, Math.min(COLS - 1, this.cursor.c + dc));
    }

    tapCursor() {
        this.tap(this.cursor.r, this.cursor.c);
    }

    // ── Submit ─────────────────────────────────────────────────────────

    /** Play the chain. Returns true if it was a word. */
    submit() {
        if (this.ended()) return false;
        const path = this.chain;
        this.chain = [];
        if (path.length < MIN_WORD || !isValidPath(path, this.grid)) {
            this.fx.cue("submit_fail");
            if (path.length) this.fx.toast("TOO SHORT");
            return false;
        }
        const word = pathWord(path, this.grid);
        if (!Dictionary.isWord(word)) {
            this.fx.cue("submit_fail");
            this.fx.toast("NOT A WORD");
            this.streak = 0;
            return false;
        }

        const tiles = pathTiles(path, this.grid);
        this.streak++;
        const pts = Math.floor(computeWordScore(word, tiles) * comboMultiplier(this.streak));
        this.score += pts;
        this.words++;
        this.level = 1 + Math.floor(this.words / 10);
        this.doused += tiles.filter((t) => t.burning).length;
        if (word.length > this.longest.length) this.longest = word;
        if (pts > this.bestWordScore) { this.bestWordScore = pts; this.bestWord = word; }
        this.fx.word({ word, score: pts, length: word.length, mode: this.mode });

        this.popPath(path, word.length);
        this.fx.cue("submit@" + word.length);
        if (word.length >= 7) this.fx.cue("fanfare");
        this.fx.toast(word.toUpperCase() + (word.length >= 7 ? "!" : "") + "  +" + pts);

        if (this.mode === "classic") this.burnTurn();
        if (this.mode === "puzzle" && word === this.target) this.nextPuzzle();
        return true;
    }

    /** Pop the tiles, drop the columns, refill, and gild a new top tile. */
    popPath(path, length) {
        const g = this.grid;
        const color = length >= 7 ? "#e8c168" : length >= 5 ? "#8cdff6" : "#c8b8e8";
        for (const [r, c] of path) {
            this.pops.push({ r, c, letter: g[r][c].letter, t: 0 });
            this.fx.burst(r, c, color);
            g[r][c] = null;
        }
        if (length >= 6) this.fx.shake(300, 6);
        this.falls.addMoves(collapse(g, { spawn: () => newTile(null, this.rand) }));
        const mult = rewardFor(length);
        if (mult) g[0][Math.floor(this.rand() * COLS)].mult = mult;
    }

    /** Classic: burning tiles sink a row; one already on the bottom collapses the spire. */
    burnTurn() {
        const { collapsed, moves } = descendBurning(this.grid);
        if (collapsed) {
            this.over = true;
            this.fx.cue("gameover");
            this.fx.shake(500, 12);
            return;
        }
        this.falls.addMoves(moves);
        if (this.rand() < BURN_CHANCE[this.difficulty]) {
            sprinkleBurning(this.grid, this.words > 12 ? 2 : 1, this.rand);
            this.fx.cue("sizzle");
        }
    }

    nextPuzzle() {
        this.puzzleSolved++;
        if (this.puzzleSolved >= PUZZLE_COUNT) {
            this.finished = true;
            return;
        }
        this.loadPuzzle(this.puzzleIndex + 1);
        this.fx.cue("fanfare");
    }

    // ── Frame ──────────────────────────────────────────────────────────

    step(dt) {
        this.time += dt;
        this.falls.step(dt);
        for (const p of this.pops) p.t += dt;
        this.pops = this.pops.filter((p) => p.t < POP_MS);
        if (this.mode === "timed" && !this.ended()) {
            this.timeLeft = Math.max(0, this.timeLeft - dt);
            if (this.timeLeft === 0) this.finished = true;
        }
    }
}
