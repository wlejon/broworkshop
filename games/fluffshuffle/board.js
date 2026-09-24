// Fluffshuffle board — one play session: wrap-drag (mouse or keyboard),
// snap tween, staggered pops, gravity, cascades, locks and the three modes.
// No drawing (render.js) and no DOM; effects go out through `fx` in cell
// coordinates: fx.cue(name) · fx.matchCue(chain, color, size) ·
// fx.burst(r, c, color, n) · fx.label(r, c, text, color, big) · fx.shake(ms, amp)

import { collapse, createWave, createFalls, centroid, seededRandom } from "/lib/arcade/grid.js";
import {
    ROWS, COLS, SPECIAL, PUZZLE_COUNT, makePuff, randomColor, slide, lineLocked, findMatches,
    hasAnyMatchingShift, scoreChain, expandClears, seedGrid, puzzleSpec,
} from "/app/rules.js";
import { Puffs } from "/app/puffs.js";

export const TIMING = {
    snap: 140,
    fall: 140,
    pop: 140,          // one puff's pop
    stagger: 32,       // between puffs in one clear
    settle: 40,        // breath between cascade steps
};

const TIMED_MS = 120000;
const TIMED_BONUS_PER_PUFF = 150;
const POPS_PER_LEVEL = 15;

export class Board {
    /**
     * @param {object} opts { mode, fx, rand, settings: { dragDead, eyeTrack, showCursor } }
     */
    constructor(opts) {
        this.mode = opts.mode || "classic";
        this.fx = opts.fx;
        this.rand = opts.rand || Math.random;
        this.settings = opts.settings || { dragDead: 6, eyeTrack: true, showCursor: true };

        this.score = 0;
        this.level = 1;
        this.popped = 0;           // classic: drives level-ups; puzzle: progress to target
        this.moves = 0;
        this.chain = 0;
        this.maxChain = 0;
        this.time = 0;
        this.timeLeft = this.mode === "timed" ? TIMED_MS : 0;
        this.over = false;
        this.finished = false;
        this.stats = { moves: 0, popped: 0, jumboMade: 0, arrowMade: 0, prismMade: 0, unlocks: 0 };

        this.puzzleIndex = 0;
        this.puzzleTarget = 0;
        this.puzzleMovesLeft = 0;

        // drag = { axis: "h"|"v"|null, index, startR, startC, startX, startY, offset (cells), fromKeys }
        this.drag = null;
        this.snap = null;          // { axis, index, from, to (cells), t }
        this.wave = null;
        this.upgrades = [];        // specials placed when the wave ends
        this.falls = createFalls(TIMING.fall);
        this.resolving = false;
        this.settle = 0;
        this.lockTimer = 0;

        this.cursor = { r: Math.floor(ROWS / 2), c: Math.floor(COLS / 2), active: false };
        this.pointer = { x: -9999, y: -9999 };   // canvas px, for puff eyes and hover

        if (this.mode === "puzzle") this.loadPuzzle(0);
        else this.grid = seedGrid(this.rand);
    }

    // ── Queries ────────────────────────────────────────────────────────

    busy() {
        return this.resolving || !!this.snap || !!this.wave || this.falls.busy();
    }

    ended() {
        return this.over || this.finished;
    }

    setGrid(g) {
        this.grid = g;
    }

    /** Continuous slide offset (cells) for a puff on the moving line. */
    lineOffset(r, c) {
        const s = this.snap, d = this.drag;
        const line = s || (d && d.axis ? d : null);
        if (!line) return 0;
        if ((line.axis === "h" && line.index === r) || (line.axis === "v" && line.index === c)) {
            if (s) {
                const t = Math.min(1, s.t / TIMING.snap);
                return s.from + (s.to - s.from) * (1 - Math.pow(1 - t, 3));
            }
            return d.offset;
        }
        return 0;
    }

    isHeld(r, c) {
        const d = this.drag;
        return !!(d && d.axis && ((d.axis === "h" && d.index === r) || (d.axis === "v" && d.index === c)));
    }

    // ── Puzzles ────────────────────────────────────────────────────────

    loadPuzzle(i) {
        const spec = puzzleSpec(i);
        const rand = seededRandom(spec.seed);
        this.puzzleIndex = i;
        this.grid = seedGrid(rand);
        for (let n = 0; n < spec.locks; n++) {
            const puff = this.grid[Math.floor(rand() * ROWS)][Math.floor(rand() * COLS)];
            puff.locked = true;
        }
        this.puzzleTarget = spec.target;
        this.puzzleMovesLeft = spec.moves;
        this.popped = 0;
    }

    // ── Mouse drag (canvas px; cell size from the current layout) ──────

    press(r, c, x, y) {
        this.pointer = { x, y };
        if (this.busy() || this.ended() || !this.grid[r][c]) return;
        this.drag = { axis: null, index: -1, startR: r, startC: c, startX: x, startY: y, offset: 0 };
        this.fx.cue("grab");
    }

    /** Pointer moved to (x, y); cellPx converts the drag distance into cells. */
    move(x, y, cellPx) {
        this.pointer = { x, y };
        const d = this.drag;
        if (!d || d.startX == null) return;
        const dx = x - d.startX, dy = y - d.startY;
        if (!d.axis) {
            const dead = this.settings.dragDead || 6;
            if (Math.abs(dx) < dead && Math.abs(dy) < dead) return;
            if (!this.lockAxis(Math.abs(dx) >= Math.abs(dy) ? "h" : "v")) return;
        }
        d.offset = (d.axis === "h" ? dx : dy) / cellPx;
    }

    release(x, y) {
        this.pointer = { x, y };
        if (!this.drag) return;
        if (!this.drag.axis) { this.drag = null; return; }
        this.commitDrag();
    }

    /** Pick the drag axis; a locked line refuses with a thud. */
    lockAxis(axis) {
        const d = this.drag;
        d.axis = axis;
        d.index = axis === "h" ? d.startR : d.startC;
        if (lineLocked(this.grid, axis, d.index)) {
            this.fx.cue("thud");
            this.drag = null;
            return false;
        }
        return true;
    }

    /** Scripted move (make_video.js): slide a line k cells through the normal snap. */
    shift(axis, index, k) {
        if (this.busy() || this.ended() || this.drag || lineLocked(this.grid, axis, index)) return false;
        this.snap = { axis, index, from: 0, to: k, t: 0 };
        return true;
    }

    commitDrag() {
        const d = this.drag;
        this.drag = null;
        this.snap = { axis: d.axis, index: d.index, from: d.offset, to: Math.round(d.offset), t: 0 };
        this.fx.cue("snap");
    }

    // ── Keyboard ───────────────────────────────────────────────────────

    /** Arrow: slide the grabbed line one cell, or move the (wrapping) cursor. */
    cursorSlide(dr, dc) {
        const d = this.drag;
        if (!d) {
            const cur = this.cursor;
            cur.active = true;
            cur.r = (cur.r + dr + ROWS) % ROWS;
            cur.c = (cur.c + dc + COLS) % COLS;
            this.fx.cue("cursor");
            return;
        }
        if (!d.axis && !this.lockAxis(dc !== 0 ? "h" : "v")) return;
        d.offset += d.axis === "h" ? dc : dr;
    }

    /** Space: grab the puff under the cursor, or release the grabbed line. */
    cursorAction() {
        if (this.busy() || this.ended()) return;
        this.cursor.active = true;
        if (this.drag) {
            if (this.drag.axis) this.commitDrag();
            else this.drag = null;
            return;
        }
        const { r, c } = this.cursor;
        if (!this.grid[r][c]) return;
        this.drag = { axis: null, index: -1, startR: r, startC: c, startX: null, startY: null, offset: 0 };
        this.fx.cue("grab");
    }

    // ── Frame ──────────────────────────────────────────────────────────

    step(dt) {
        this.time += dt;
        if (this.mode === "timed" && !this.ended()) {
            this.timeLeft = Math.max(0, this.timeLeft - dt);
            if (this.timeLeft === 0) this.finished = true;
        }

        if (this.snap) {
            this.snap.t += dt;
            if (this.snap.t >= TIMING.snap) this.applySnap();
        }

        if (this.wave) {
            this.wave.step(dt, (cell) => {
                const puff = this.grid[cell.r][cell.c];
                const color = puff && Puffs.PALETTE[puff.color] ? Puffs.PALETTE[puff.color].core : "#ffffff";
                this.fx.burst(cell.r, cell.c, color, 10 + this.chain * 2);
            });
            if (this.wave.done()) this.endWave();
        }

        this.falls.step(dt);

        if (this.resolving && !this.snap && !this.wave && !this.falls.busy()) {
            if (this.chain > 0 && this.settle < TIMING.settle) {
                this.settle += dt;
                return;
            }
            this.settle = 0;
            const groups = findMatches(this.grid);
            if (groups.length) this.resolve(groups);
            else this.endMove();
        }

        if (!this.busy() && !this.drag && this.mode === "classic" && !this.ended()) this.stepLocks(dt);
    }

    applySnap() {
        const { axis, index, to } = this.snap;
        this.snap = null;
        if (to === 0) return;
        this.grid = slide(this.grid, axis, index, to);
        this.moves++;
        this.stats.moves++;
        if (this.mode === "puzzle") this.puzzleMovesLeft--;
        this.chain = 0;
        this.resolving = true;
    }

    /** One cascade step: score, mark specials to spawn, pop the rest. */
    resolve(groups) {
        this.chain++;
        this.maxChain = Math.max(this.maxChain, this.chain);
        let count = 0;
        for (const grp of groups) count += grp.size;
        this.score += scoreChain(count, this.chain - 1);
        this.popped += count;
        this.stats.popped += count;
        this.fx.matchCue(this.chain, groups[0].color, groups[0].size);
        this.fx.shake(180, Math.min(6, this.chain * 1.5));

        const cells = [];
        this.upgrades = [];
        for (const grp of groups) {
            cells.push(...grp.cells);
            if (grp.special === SPECIAL.NONE) continue;
            const at = grp.cells[Math.floor(grp.cells.length / 2)];
            this.upgrades.push({ r: at[0], c: at[1], special: grp.special, color: grp.color, arrowDir: grp.arrowDir });
            if (grp.special === SPECIAL.JUMBO) this.stats.jumboMade++;
            else if (grp.special === SPECIAL.ARROW) this.stats.arrowMade++;
            else this.stats.prismMade++;
        }
        const clears = expandClears(this.grid, cells, this.upgrades.map((u) => [u.r, u.c]));
        this.wave = createWave(clears, {
            stagger: TIMING.stagger, dur: TIMING.pop, lead: 0, fireAt: TIMING.pop * 0.35,
        });
        this.settle = 0;

        for (const grp of groups) {
            const mid = centroid(grp.cells);
            const pal = Puffs.PALETTE[grp.color];
            this.fx.label(mid.r, mid.c, "+" + scoreChain(grp.size, this.chain - 1), pal ? pal.belly : "#ffe9b0", false);
        }
        if (this.chain >= 2) this.fx.label((ROWS - 1) / 2, (COLS - 1) / 2, "CHAIN x" + this.chain, "#ffd980", true);

        if (this.mode === "timed") {
            this.timeLeft = Math.min(TIMED_MS, this.timeLeft + TIMED_BONUS_PER_PUFF * count);
        }
    }

    /** Pop the wave's puffs (freeing locks), grow the specials, drop and refill. */
    endWave() {
        const g = this.grid;
        for (const cell of this.wave.cells) {
            if (g[cell.r][cell.c] && g[cell.r][cell.c].locked) this.stats.unlocks++;
            g[cell.r][cell.c] = null;
        }
        this.wave = null;
        for (const u of this.upgrades) g[u.r][u.c] = makePuff(u.color, u.special, false, u.arrowDir);
        this.upgrades = [];
        this.falls.addMoves(collapse(g, { spawn: () => makePuff(randomColor(this.rand)) }));
    }

    /** Cascade over (or a slide that matched nothing): progress and end checks. */
    endMove() {
        this.resolving = false;
        this.chain = 0;
        if (this.mode === "classic") {
            while (this.popped >= this.level * POPS_PER_LEVEL) {
                this.level++;
                this.fx.cue("levelup");
            }
            if (!hasAnyMatchingShift(this.grid)) this.over = true;
        } else if (this.mode === "puzzle") {
            if (this.popped >= this.puzzleTarget) {
                if (this.puzzleIndex + 1 >= PUZZLE_COUNT) this.finished = true;
                else { this.loadPuzzle(this.puzzleIndex + 1); this.fx.cue("levelup"); }
            } else if (this.puzzleMovesLeft <= 0) {
                this.over = true;
            }
        }
    }

    /** Classic: every so often a puff locks, freezing its row and column. */
    stepLocks(dt) {
        this.lockTimer += dt;
        const interval = Math.max(12000, 30000 - this.level * 1500);
        if (this.lockTimer < interval) return;
        this.lockTimer = 0;
        for (let attempt = 0; attempt < 20; attempt++) {
            const puff = this.grid[Math.floor(this.rand() * ROWS)][Math.floor(this.rand() * COLS)];
            if (puff && !puff.locked) {
                puff.locked = true;
                this.fx.cue("lock");
                if (!hasAnyMatchingShift(this.grid)) this.over = true;
                return;
            }
        }
    }
}
