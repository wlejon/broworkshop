// board.js — one Blockpop session: the rising stack, the carrier, cascades,
// the brake and the three modes. No DOM; effects go out through `fx` in
// board coordinates (column, row from the bottom):
//   fx.cue(name) · fx.pop(c, r, color) · fx.toast("action"|"cascade", text)
//   fx.shake(ms, amp)

import {
    COLS, ROWS, HOLD_MAX, SPECIAL_STAR, SPECIAL_BOMB, SPECIAL_RAINBOW,
    findChains, expandSpecials, popChains, spawnRow, seedBoard,
    puzzleBoard, groupScore, isToppedOut, isCleared,
} from "/app/rules.js";

/** Rows per second at level 1 and rise speed 1.0x (8 px/s on a 42 px cell). */
export const RISE_RATE = 8 / 42;
export const BRAKE_MS = 3000;
export const BRAKE_COOLDOWN_MS = 10000;
export const SPRINT_TARGET = 100;

const NO_FX = { cue() {}, pop() {}, toast() {}, shake() {} };
const SPECIAL_NAMES = { [SPECIAL_STAR]: "star", [SPECIAL_BOMB]: "bomb", [SPECIAL_RAINBOW]: "rainbow" };

export class Board {
    /**
     * @param {object} opts { mode: "classic"|"sprint"|"puzzle", rand, fx,
     *   riseSpeed (10 = 1.0x), puzzleIdx }
     */
    constructor(opts = {}) {
        this.mode = opts.mode || "classic";
        this.rand = opts.rand || Math.random;
        this.fx = opts.fx || NO_FX;
        this.riseSpeed = opts.riseSpeed || 10;
        this.carrier = { col: Math.floor(COLS / 2) - 1, held: [] };
        this.score = 0;
        this.level = 1;
        this.maxChain = 0;         // deepest cascade that showed a CHAIN banner
        this.bestChain = 0;        // deepest cascade including single pops
        this.blocksPopped = 0;
        this.time = 0;             // ms of play
        this.finished = false;     // sprint / puzzle goal met
        this.over = false;         // topped out / out of moves
        this.rise = 0;             // 0..1 of a row risen since the last spawn
        this.nextRise = 0;         // seconds to the next row (HUD)
        this.brake = 0;            // ms of slow rise left
        this.brakeCooldown = 0;    // ms until the brake is ready
        this.sprintTarget = SPRINT_TARGET;
        this.puzzleIdx = opts.puzzleIdx || 0;
        this.movesLeft = 0;

        if (this.mode === "puzzle") {
            const p = puzzleBoard(this.puzzleIdx);
            this.board = p.board;
            this.movesLeft = p.moves;
        } else {
            this.board = seedBoard(this.mode === "sprint" ? 6 : 5, this.rand);
        }
    }

    ended() { return this.over || this.finished; }

    // ── Carrier ────────────────────────────────────────────────────────

    moveTo(col) {
        col = Math.max(0, Math.min(COLS - 1, col));
        if (col === this.carrier.col) return;
        this.carrier.col = col;
        this.fx.cue("move");
    }
    moveLeft() { this.moveTo(this.carrier.col - 1); }
    moveRight() { this.moveTo(this.carrier.col + 1); }

    /** Lift the current column's top block onto the held stack. */
    pick() {
        if (this.carrier.held.length >= HOLD_MAX) return false;
        const col = this.board[this.carrier.col];
        if (!col.length) return false;
        this.carrier.held.push(col.pop());
        this.fx.cue("pick");
        return true;
    }

    /** Drop the front held block on the current column, then resolve. */
    place() {
        if (!this.carrier.held.length) return false;
        if (this.board[this.carrier.col].length >= ROWS) return false;
        this.board[this.carrier.col].push(this.carrier.held.pop());
        this.fx.cue("drop");
        if (this.mode === "puzzle") this.movesLeft--;
        this.resolveChains();
        return true;
    }

    /** Drop when holding, pick otherwise. */
    interact() {
        if (this.carrier.held.length > 0) this.place();
        else this.pick();
    }

    shuffleHeld() {
        if (this.carrier.held.length < 2) return;
        this.carrier.held.reverse();
        this.fx.cue("shuffle");
    }

    /** Slow the rise to 20% for 3 s; once per 10 s. */
    emergencyBrake() {
        if (this.brakeCooldown > 0) return false;
        this.brake = BRAKE_MS;
        this.brakeCooldown = BRAKE_COOLDOWN_MS;
        this.fx.cue("brake");
        this.fx.toast("action", "BRAKE");
        return true;
    }

    // ── Chains ─────────────────────────────────────────────────────────

    /** Pop until the board is still; each cascade step multiplies the score. */
    resolveChains() {
        let depth = 0;
        for (;;) {
            const groups = findChains(this.board);
            if (!groups.length) break;
            depth++;
            if (depth > this.bestChain) this.bestChain = depth;
            let popped = 0;
            const specials = [];
            for (const g of groups) {
                const ex = expandSpecials(this.board, g);
                popped += ex.cells.length;
                this.score += groupScore(ex.cells.length) * depth;
                for (const [c, r] of ex.cells) {
                    const bl = this.board[c][r];
                    if (bl && SPECIAL_NAMES[bl.special]) specials.push(SPECIAL_NAMES[bl.special]);
                    this.fx.pop(c, r, ex.color);
                }
            }
            this.fx.cue("pop@" + groups[0].color + "@" + (depth - 1));
            for (const kind of specials) this.fx.cue("special@" + kind);
            if (depth >= 2) {
                this.fx.toast("cascade", "x" + depth + " CHAIN");
                if (depth > this.maxChain) this.maxChain = depth;
            }
            if (popped >= 5) {
                this.fx.toast("action", popped + " POP!");
                this.fx.cue("big@" + popped);
            }
            this.blocksPopped += popChains(this.board, groups).removed;
            if (popped >= 4) this.fx.shake(160, 3 + Math.min(5, popped / 2));

            if (this.mode === "sprint" && this.blocksPopped >= this.sprintTarget) { this.finished = true; break; }
            if (this.mode === "puzzle" && isCleared(this.board)) { this.finished = true; break; }
        }
        const wantLevel = 1 + Math.floor(this.score / 5000);
        if (wantLevel > this.level) {
            this.level = wantLevel;
            this.fx.cue("levelup");
            this.fx.toast("action", "LEVEL " + this.level);
        }
        if (this.mode === "puzzle" && this.movesLeft <= 0 && !this.finished) this.over = true;
    }

    // ── Clock ──────────────────────────────────────────────────────────

    /** Rows per second right now: level, the rise-speed option and the brake. */
    riseRate() {
        let rate = RISE_RATE * (1 + (this.level - 1) * 0.12) * (this.riseSpeed / 10);
        if (this.brake > 0) rate *= 0.2;
        return rate;
    }

    tick(dt) {
        if (this.ended()) return;
        this.time += dt;
        if (isToppedOut(this.board)) { this.topOut(); return; }
        if (this.brake > 0) this.brake -= dt;
        if (this.brakeCooldown > 0) this.brakeCooldown -= dt;
        if (this.mode === "puzzle") return;

        const rate = this.riseRate();
        this.rise += (dt / 1000) * rate;
        if (this.rise >= 1) {
            this.rise -= 1;
            spawnRow(this.board, this.rand);
            this.resolveChains();
            if (isToppedOut(this.board)) this.topOut();
            else if (this.board.some((col) => col.length >= ROWS - 2)) this.fx.cue("warn");
        }
        this.nextRise = rate > 0 ? (1 - this.rise) / rate : 0;
    }

    topOut() {
        this.over = true;
        this.fx.cue("gameover");
    }

    // ── Readouts ───────────────────────────────────────────────────────

    /** The mode's third HUD value: blocks left, moves left or time to rise. */
    extraHud() {
        if (this.mode === "sprint") return String(Math.max(0, this.sprintTarget - this.blocksPopped));
        if (this.mode === "puzzle") return String(this.movesLeft);
        return this.nextRise.toFixed(1) + "s";
    }

    get stats() {
        return {
            score: this.score, level: this.level, blocksPopped: this.blocksPopped,
            maxChain: this.maxChain, bestChain: this.bestChain, gameTime: this.time,
            mode: this.mode, finished: this.finished,
        };
    }

    /** Test / debug: swap in a hand-built board. */
    setBoard(b) { this.board = b; }
}
