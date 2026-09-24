// Gemswap board — one play session: selection, swap tween, staggered
// shatter, gravity, cascades and the three modes. No drawing (render.js)
// and no DOM; effects go out through `fx` in cell coordinates:
//   fx.cue(name) · fx.matchCue(chain, size) · fx.burst(r, c, color, n)
//   fx.label(r, c, text, color, big) · fx.shake(ms, amp)

import { collapse, createWave, createFalls, centroid } from "/lib/arcade/grid.js";
import {
    ROWS, COLS, SPECIAL, makeGem, randomColor, findMatches, findAnyMove, isAdjacent,
    baseScore, scoreChain, expandClears, hyperCells, seedGrid, shuffleGrid, gridFromLayout, countFrozen,
} from "/app/rules.js";
import { PALETTE } from "/app/palette.js";
import { Puzzles } from "/app/puzzles.js";

export const TIMING = {
    swap: 180,
    fall: 140,
    charge: 35,        // white flash before a gem shatters
    shatter: 140,
    stagger: 32,       // between gems in one clear, rippling from the centre
    settle: 40,        // breath between cascade steps
};

const TIMED_MS = 120000;
const TIMED_BONUS_PER_GEM = 200;
const LEVEL_POINTS = 1000;

export class Board {
    /**
     * @param {object} opts { mode: "classic"|"timed"|"puzzle", fx, rand, hintDelay (ms) }
     */
    constructor(opts) {
        this.mode = opts.mode || "classic";
        this.fx = opts.fx;
        this.rand = opts.rand || Math.random;
        this.hintDelay = opts.hintDelay || 5000;

        this.score = 0;
        this.level = 1;
        this.moves = 0;
        this.chain = 0;
        this.maxChain = 0;
        this.time = 0;
        this.timeLeft = this.mode === "timed" ? TIMED_MS : 0;
        this.puzzleIndex = 0;
        this.frozenLeft = 0;
        this.over = false;          // no moves left / time up
        this.finished = false;      // mode completed (timed ran out, all puzzles cleared)
        this.stats = { swaps: 0, matches: 0, flameMade: 0, starMade: 0, hyperMade: 0 };

        this.sel = null;            // { r, c } first pick
        this.cursor = { r: 4, c: 4, active: false };
        this.hint = null;           // { r, c, dr, dc }
        this.idle = 0;

        this.swap = null;           // { a, b, t, kind: "commit" | "back" | "hyper" }
        this.wave = null;           // createWave while gems shatter
        this.newSpecial = null;     // { r, c, special, color } placed when the wave ends
        this.falls = createFalls(TIMING.fall);
        this.resolving = false;     // between a committed swap and the end of its cascade
        this.settle = 0;

        if (this.mode === "puzzle") this.loadPuzzle(0);
        else this.grid = seedGrid(this.rand);
    }

    // ── Queries ────────────────────────────────────────────────────────

    busy() {
        return this.resolving || !!this.swap || !!this.wave || this.falls.busy();
    }

    ended() {
        return this.over || this.finished;
    }

    setGrid(g) {
        this.grid = g;
        this.frozenLeft = countFrozen(g);
        this.hint = null;
        this.sel = null;
    }

    // ── Puzzles ────────────────────────────────────────────────────────

    loadPuzzle(i) {
        this.puzzleIndex = i;
        this.setGrid(gridFromLayout(Puzzles.get(i), this.rand));
    }

    // ── Input ──────────────────────────────────────────────────────────

    /** Select a gem, or swap it with the selected neighbour. */
    pick(r, c) {
        if (this.busy() || this.ended()) return;
        const gem = this.grid[r] && this.grid[r][c];
        if (!gem || gem.frozen) return;
        if (this.sel && this.sel.r === r && this.sel.c === c) {
            this.sel = null;
            return;
        }
        if (this.sel && isAdjacent(this.sel, { r, c })) {
            const from = this.sel;
            this.sel = null;
            this.beginSwap(from.r, from.c, r, c);
            return;
        }
        this.sel = { r, c };
        this.fx.cue("pick");
    }

    /** Arrow keys: move the cursor, or swap when a gem under it is picked. */
    cursorMove(dr, dc) {
        const cur = this.cursor;
        cur.active = true;
        const nr = Math.max(0, Math.min(ROWS - 1, cur.r + dr));
        const nc = Math.max(0, Math.min(COLS - 1, cur.c + dc));
        if (this.sel && this.sel.r === cur.r && this.sel.c === cur.c && isAdjacent(this.sel, { r: nr, c: nc })) {
            this.pick(nr, nc);
        } else {
            this.fx.cue("cursor");
        }
        cur.r = nr;
        cur.c = nc;
    }

    cursorConfirm() {
        this.cursor.active = true;
        this.pick(this.cursor.r, this.cursor.c);
    }

    beginSwap(r1, c1, r2, c2) {
        const g = this.grid;
        const a = g[r1][c1], b = g[r2][c2];
        if (!a || !b || a.frozen || b.frozen) return;
        this.idle = 0;
        this.hint = null;
        let kind;
        if (a.special === SPECIAL.HYPER || b.special === SPECIAL.HYPER) {
            kind = "hyper";
        } else {
            g[r1][c1] = b; g[r2][c2] = a;
            kind = findMatches(g).length ? "commit" : "back";
            if (kind === "back") { g[r1][c1] = a; g[r2][c2] = b; }
        }
        this.swap = { a: { r: r1, c: c1 }, b: { r: r2, c: c2 }, t: 0, kind };
    }

    // ── Frame ──────────────────────────────────────────────────────────

    step(dt) {
        this.time += dt;
        if (this.mode === "timed" && !this.ended()) {
            this.timeLeft = Math.max(0, this.timeLeft - dt);
            if (this.timeLeft === 0) this.finished = true;
        }

        if (!this.busy()) this.stepIdle(dt);

        if (this.swap) {
            this.swap.t += dt;
            if (this.swap.t >= TIMING.swap) this.finishSwap();
        }

        if (this.wave) {
            this.wave.step(dt, (cell) => {
                const gem = this.grid[cell.r][cell.c];
                const color = gem && PALETTE[gem.color] ? PALETTE[gem.color].core : "#ffffff";
                this.fx.burst(cell.r, cell.c, color, 8 + this.chain * 2);
            });
            if (this.wave.done()) this.endWave();
        }

        this.falls.step(dt);

        if (this.resolving && !this.swap && !this.wave && !this.falls.busy()) {
            if (this.chain > 0 && this.settle < TIMING.settle) {
                this.settle += dt;
                return;
            }
            this.settle = 0;
            const groups = findMatches(this.grid);
            if (groups.length) this.resolve(groups);
            else this.endMove();
        }
    }

    /** Hint after hintDelay idle ms; a dead board shuffles. */
    stepIdle(dt) {
        this.idle += dt;
        if (this.idle < this.hintDelay || this.hint) return;
        this.hint = findAnyMove(this.grid);
        if (!this.hint) this.reshuffle();
    }

    finishSwap() {
        const { a, b, kind } = this.swap;
        this.swap = null;
        if (kind === "back") {
            this.fx.cue("swap_bad");
            return;
        }
        this.stats.swaps++;
        this.moves++;
        this.chain = 0;
        this.resolving = true;
        if (kind === "commit") {
            this.fx.cue("swap_ok");
            this.resolve(findMatches(this.grid));
            return;
        }
        // Hypergem: clear every gem of the other gem's color.
        const g = this.grid;
        const hyperAtA = g[a.r][a.c].special === SPECIAL.HYPER;
        const h = hyperAtA ? a : b;
        const other = hyperAtA ? g[b.r][b.c] : g[a.r][a.c];
        const cells = hyperCells(g, h.r, h.c, other.color);
        if (other.special === SPECIAL.HYPER) cells.push([hyperAtA ? b.r : a.r, hyperAtA ? b.c : a.c]);
        this.fx.cue("hyper");
        this.chain = 1;
        this.maxChain = Math.max(this.maxChain, 1);
        const points = baseScore(cells.length);
        this.score += points;
        const mid = centroid(cells);
        this.fx.label(mid.r, mid.c, "+" + points, PALETTE[other.color].core, false);
        this.startClear(expandClears(g, cells, null), 5);
    }

    /** One cascade step: score the groups, place a special, shatter the rest. */
    resolve(groups) {
        this.chain++;
        this.maxChain = Math.max(this.maxChain, this.chain);
        this.stats.matches += groups.length;
        this.score += scoreChain(groups.map((grp) => grp.size), this.chain - 1);
        this.fx.matchCue(this.chain, groups[0].size);

        // The first shaped group turns its middle gem into a special.
        let keep = null;
        this.newSpecial = null;
        const special = groups.find((grp) => grp.special !== SPECIAL.NONE);
        if (special) {
            keep = special.cells[Math.floor(special.cells.length / 2)];
            this.newSpecial = { r: keep[0], c: keep[1], special: special.special, color: special.color };
        }

        const cells = [];
        for (const grp of groups) cells.push(...grp.cells);

        for (const grp of groups) {
            const mid = centroid(grp.cells);
            this.fx.label(mid.r, mid.c, "+" + baseScore(grp.size) * this.chain, PALETTE[grp.color].core, false);
        }
        if (this.chain >= 2) this.fx.label((ROWS - 1) / 2, (COLS - 1) / 2, "CHAIN x" + this.chain, "#ffe070", true);

        this.startClear(expandClears(this.grid, cells, keep), Math.min(5, 1.2 + this.chain * 0.8));
    }

    startClear(cells, shakeAmp) {
        if (this.mode === "timed") {
            this.timeLeft = Math.min(TIMED_MS, this.timeLeft + TIMED_BONUS_PER_GEM * cells.length);
        }
        this.fx.shake(200, shakeAmp);
        this.wave = createWave(cells, {
            stagger: TIMING.stagger, lead: TIMING.charge, dur: TIMING.shatter, fireAt: TIMING.charge,
        });
        this.settle = 0;
    }

    /** Remove shattered gems (ice only cracks), place the special, drop. */
    endWave() {
        const g = this.grid;
        for (const cell of this.wave.cells) {
            const gem = g[cell.r][cell.c];
            if (gem && gem.frozen) {
                gem.frozen = false;
                this.frozenLeft--;
            } else {
                g[cell.r][cell.c] = null;
            }
        }
        this.wave = null;
        const ns = this.newSpecial;
        if (ns) {
            g[ns.r][ns.c] = makeGem(ns.color, ns.special, false);
            if (ns.special === SPECIAL.HYPER) this.stats.hyperMade++;
            else if (ns.special === SPECIAL.STAR) this.stats.starMade++;
            else this.stats.flameMade++;
            this.newSpecial = null;
        }
        this.falls.addMoves(collapse(g, {
            isFixed: (gem) => gem.frozen,
            spawn: () => makeGem(randomColor(this.rand)),
        }));
    }

    /** The cascade settled: progress, level up, deal with a dead board. */
    endMove() {
        this.resolving = false;
        this.chain = 0;
        if (this.mode === "puzzle" && this.frozenLeft <= 0) {
            if (this.puzzleIndex + 1 >= Puzzles.count()) {
                this.finished = true;
                return;
            }
            this.loadPuzzle(this.puzzleIndex + 1);
            this.fx.cue("levelup");
        }
        if (this.mode === "classic") {
            while (this.score >= this.level * LEVEL_POINTS) {
                this.level++;
                this.fx.cue("levelup");
            }
        }
        if (!findAnyMove(this.grid)) this.reshuffle();
    }

    /** Dead board: shuffle; a timed board reseeds; otherwise the run is over. */
    reshuffle() {
        this.fx.cue("shuffle");
        if (shuffleGrid(this.grid, this.rand)) return;
        if (this.mode === "timed") this.grid = seedGrid(this.rand);
        else this.over = true;
    }
}
