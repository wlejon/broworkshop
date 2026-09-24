// Serpcoil level session — path, chain, shooter, score and combo for one
// level. No DOM; effects leave through `fx` in screen pixels:
//   fx.cue(name)  fx.pop(color, depth)  fx.burst(x, y, color, n)
//   fx.label(x, y, text, hex)  fx.ring(x, y, maxR, hex)  fx.puff(x, y)
// status goes null -> "won" | "lost".

import { seededRandom } from "/lib/arcade/random.js";
import { createPath } from "/app/path.js";
import { Chain, ORB_DIAM } from "/app/chain.js";
import { Shooter, PU } from "/app/shooter.js";
import { LEVELS, scaledLevel } from "/app/levels.js";

const COMBO_WINDOW = 1800;          // ms a cascade stays open
const AIM_RATE = 0.005;             // rad/ms with arrow keys
const BLAST_POINTS = 25;

/** Points for popping `count` orbs at cascade depth `depth` (1 = first pop). */
export function scoreForPop(count, depth) {
    let base = count * 10;
    if (count >= 4) base = Math.floor(base * 1.5);
    return base * [1, 2, 4, 8, 12, 16][Math.min(5, depth)];
}

export function clearBonus(levelIdx) {
    return 500 + levelIdx * 100;
}

/** 1-3 stars against 20 points per orb. */
export function starsFor(score, totalOrbs) {
    const perfect = totalOrbs * 20;
    return score >= perfect * 1.2 ? 3 : score >= perfect * 0.8 ? 2 : 1;
}

const NO_FX = { cue() {}, pop() {}, burst() {}, label() {}, ring() {}, puff() {} };

export class Coil {
    /** opts: { levelIdx, width, height, seed, fx } */
    constructor(opts) {
        this.levelIdx = opts.levelIdx || 0;
        this.level = LEVELS[this.levelIdx];
        this.W = opts.width;
        this.H = opts.height;
        this.fx = opts.fx || NO_FX;
        const L = scaledLevel(this.levelIdx, this.W, this.H);
        const rng = opts.seed != null ? seededRandom(opts.seed) : Math.random;
        this.path = createPath(L.controls);
        this.chain = new Chain({ path: this.path, palette: L.palette, totalToSpawn: L.totalOrbs, speed: L.chainSpeed, rng });
        this.shooter = new Shooter({ x: L.shooter.x, y: L.shooter.y, palette: L.palette, rng });
        this.score = 0;
        this.combo = 1;             // best cascade depth in the open window
        this.depth = 0;             // current cascade depth
        this.comboTimer = 0;
        this.danger = false;
        this.status = null;
        this.bonus = 0;
        this.stars = 0;
        this.clock = 0;             // ms, visuals
        this.puffTimer = 0;
    }

    get left() { return this.chain.remainingToSpawn + this.chain.count; }
    get progress() { return this.chain.totalToSpawn ? 1 - this.left / this.chain.totalToSpawn : 0; }

    // ── Input ────────────────────────────────────────────────────────────

    turn(dir, dt) { this.shooter.aim += dir * AIM_RATE * dt; }
    aimAt(x, y) { this.shooter.aimAt(x, y); }

    fire() {
        if (this.status || !this.shooter.fire()) return false;
        this.fx.cue("shoot");
        return true;
    }

    swap() {
        this.shooter.swap();
        this.fx.cue("swap");
    }

    // ── Frame ────────────────────────────────────────────────────────────

    step(dt) {
        if (this.status) return;
        this.clock += dt;
        this.chain.tick(dt, (popped, positions) => this.onPop(popped, positions));
        this.shooter.tick(dt);

        if (this.chain.danger && !this.danger) this.fx.cue("danger");
        this.danger = this.chain.danger;

        for (const proj of this.shooter.projectiles.slice()) {
            if (proj.x < -50 || proj.x > this.W + 50 || proj.y < -50 || proj.y > this.H + 50) {
                this.shooter.removeProjectile(proj);
            } else if (this.chain.count) {
                this.collide(proj);
            }
        }

        if (!this.chain.remainingToSpawn) this.restrictShooter();

        if (this.comboTimer > 0) {
            this.comboTimer -= dt;
            if (this.comboTimer <= 0) { this.combo = 1; this.depth = 0; }
        }

        if (this.chain.remainingToSpawn) {
            this.puffTimer += dt;
            if (this.puffTimer > 260) {
                this.puffTimer = 0;
                const m = this.path.pointAt(0);
                this.fx.puff(m.x, m.y);
            }
        }

        if (this.chain.isComplete()) this.win();
        else if (this.chain.reachedGoal()) this.lose();
    }

    /** With nothing left to spawn, only offer colours still on the path. */
    restrictShooter() {
        const live = this.chain.colorsRemaining();
        if (!live.length) return;
        for (const c of this.shooter.restrictTo(live)) {
            const at = c.slot === "current" ? this.shooter : this.shooter.backSlot();
            this.fx.burst(at.x, at.y, c.color, c.slot === "current" ? 14 : 10);
        }
    }

    // ── Hits + pops ──────────────────────────────────────────────────────

    /** A projectile touching an orb lands in front of or behind it. */
    collide(proj) {
        const reach = ORB_DIAM * 0.85;
        const orbs = this.chain.orbs;
        for (let i = 0; i < orbs.length; i++) {
            const p = this.path.pointAt(orbs[i].d);
            const dx = p.x - proj.x, dy = p.y - proj.y;
            if (dx * dx + dy * dy > reach * reach) continue;
            const t = this.path.tangentAt(orbs[i].d);
            const d = Math.max(0, orbs[i].d + (dx * t.x + dy * t.y > 0 ? -0.5 : 0.5) * ORB_DIAM);
            this.shooter.removeProjectile(proj);
            this.land(proj, d, i);
            return true;
        }
        return false;
    }

    land(proj, d, hitIdx) {
        const fx = this.fx;
        switch (proj.pu) {
            case PU.BACKTRACK:
                this.chain.backtrack(160);
                fx.cue("powerup");
                fx.ring(proj.x, proj.y, 140, "#56d8ff");
                fx.label(proj.x, proj.y, "BACKTRACK", "#56d8ff");
                return;
            case PU.BLASTER: {
                const hit = this.chain.blastAt(proj.x, proj.y, 80);
                for (const p of hit) fx.burst(p.x, p.y, p.color, 12);
                const pts = hit.length * BLAST_POINTS;
                this.score += pts;
                fx.ring(proj.x, proj.y, 180, "#e63946");
                fx.label(proj.x, proj.y, "+" + pts, "#ffd86b");
                fx.cue("powerup");
                return;
            }
            case PU.COLORSHIFT:
                fx.label(proj.x, proj.y, "SHIFTED x" + this.chain.colorshift(hitIdx, proj.color), "#e9c46a");
                fx.cue("powerup");
                this.popAt(hitIdx);
                return;
            case PU.SLOWMO:
                this.chain.setSlowmo(6000);
                fx.ring(proj.x, proj.y, 200, "#4cc9f0");
                fx.label(proj.x, proj.y, "SLOW-MO", "#4cc9f0");
                fx.cue("powerup");
                return;
            default:
                fx.cue("insert");
                this.popAt(this.chain.insertAt(d, proj.color));
        }
    }

    /** Insert a coloured orb at d as if shot there (tests, replays). */
    insertAt(d, color) {
        const i = this.chain.insertAt(d, color);
        this.popAt(i);
        return i;
    }

    popAt(i) {
        return this.chain.popAround(i, (popped, positions) => this.onPop(popped, positions));
    }

    onPop(popped, positions) {
        if (this.comboTimer <= 0) this.depth = 0;
        this.depth += 1;
        this.combo = Math.max(this.combo, this.depth);
        this.comboTimer = COMBO_WINDOW;

        const gain = scoreForPop(popped.length, this.depth);
        this.score += gain;
        for (const p of positions) this.fx.burst(p.x, p.y, p.color, 14);
        const p0 = positions[0];
        if (p0) {
            this.fx.label(p0.x, p0.y - 10, "+" + gain, "#ffd86b");
            this.fx.ring(p0.x, p0.y, 80, "#b56dff");
        }
        this.fx.pop(popped[0] ? popped[0].color : 1, this.depth);

        if (this.shooter.countPop()) {
            this.fx.label(this.shooter.x, this.shooter.y - 40, "POWERUP!", "#b56dff");
            this.fx.cue("powerup");
        }
    }

    // ── End ──────────────────────────────────────────────────────────────

    win() {
        this.status = "won";
        this.bonus = clearBonus(this.levelIdx);
        this.score += this.bonus;
        this.stars = starsFor(this.score, this.level.totalOrbs);
        this.fx.cue("clear");
    }

    lose() {
        this.status = "lost";
        this.fx.cue("gameover");
    }
}
