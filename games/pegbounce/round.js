// Pegbounce round — one level attempt: the physics world, the cannon, the
// balls left and the score. No DOM; effects leave through `fx` in field
// coordinates:
//   fx.cue(name)  fx.burst(x, y, color, count, speed)  fx.toast(text)
//   fx.fever(text)  fx.shake()
// status goes null -> "clear" | "fail" when the round is decided.

import { Physics } from "/app/physics.js";
import { Levels } from "/app/levels.js";
import { Guides } from "/app/guides.js";
import {
    PEG_POINTS, FEVER_BONUS, ORANGES_PER_BONUS_BALL, LAUNCH_SPEED, MUZZLE, AIM_RATE,
    shotMult, clampAim,
} from "/app/rules.js";

export const PEG_COLORS = { blue: "#5aa6ff", orange: "#ff9a2a", green: "#58e05a", purple: "#c97aff" };

const STUCK_SPEED = 25;      // px/s
const STUCK_SECONDS = 1.5;

const NO_FX ={ cue() {}, burst() {}, toast() {}, fever() {}, shake() {} };

export class Round {
    /** opts: { levelIdx, guideId, fx, seed } */
    constructor(opts = {}) {
        this.levelIdx = opts.levelIdx || 0;
        this.level = Levels.LEVELS[this.levelIdx];
        this.guide = Guides.byId(opts.guideId);
        this.fx = opts.fx || NO_FX;
        this.world = Levels.buildLevel(this.levelIdx, opts.seed != null ? opts.seed : this.levelIdx * 73 + 11);

        this.cannon = { x: Physics.FIELD_W / 2, y: 40 };
        this.aimAngle = Math.PI / 2;
        this.balls = this.level.balls;
        this.ballsStart = this.level.balls;
        this.score = 0;               // banked: shots that have finished
        this.totalOrangeStart = Physics.countRemainingOrange(this.world);
        this.bonusBallsAwarded = 0;
        this.mirageShowing = false;
        this.status = null;
        this.clock = 0;               // seconds, for visuals only
        this.resetShot();
        this.shotInProgress = false;
    }

    resetShot() {
        this.shotScore = 0;
        this.hits = 0;
        this.orangeHits = 0;
        this.purple = false;
    }

    get mult() { return shotMult(this.orangeHits, this.hits, this.purple); }
    get shownScore() { return this.score + this.shotScore; }
    remainingOrange() { return Physics.countRemainingOrange(this.world); }
    canLaunch() { return !this.shotInProgress && this.balls > 0 && !this.status; }

    // ── Aim + launch ─────────────────────────────────────────────────────

    turn(dir, dt) {
        this.aimAngle = clampAim(this.aimAngle + dir * AIM_RATE * dt);
    }

    aimAt(x, y) {
        this.aimAngle = clampAim(Math.atan2(y - this.cannon.y, x - this.cannon.x));
    }

    muzzle() {
        return {
            x: this.cannon.x + Math.cos(this.aimAngle) * MUZZLE,
            y: this.cannon.y + Math.sin(this.aimAngle) * MUZZLE,
        };
    }

    launch() {
        if (!this.canLaunch()) return false;
        this.shotInProgress = true;
        this.resetShot();
        this.balls -= 1;
        this.mirageShowing = false;
        const m = this.muzzle();
        Physics.launchBall(this.world, this.aimAngle, LAUNCH_SPEED, m.x, m.y);
        this.fx.cue("launch");
        return true;
    }

    // ── Frame ────────────────────────────────────────────────────────────

    step(dt) {
        this.clock += dt;
        Physics.step(this.world, dt);
        this.drainEvents();
        if (this.shotInProgress) this.unstick(dt);
    }

    /**
     * A ball can come to rest balanced on pegs, and then the shot never
     * ends. After STUCK_SECONDS nearly still, burst the lit pegs early
     * (those are what it rests on); if there are none, kick the ball.
     */
    unstick(dt) {
        const balls = Physics.activeBalls(this.world);
        const still = balls.length > 0 && balls.every((b) => Math.hypot(b.vx, b.vy) < STUCK_SPEED);
        this.stuckFor = still ? (this.stuckFor || 0) + dt : 0;
        if (this.stuckFor < STUCK_SECONDS) return;
        this.stuckFor = 0;
        const freed = Physics.sweepLit(this.world);
        for (const p of freed) this.fx.burst(p.x, p.y, PEG_COLORS[p.type], 12, 220);
        if (!freed.length) {
            for (const b of balls) Physics.nudgeBall(this.world, b, (this.world.rng() - 0.5) * 240, -120);
        }
    }

    drainEvents() {
        const w = this.world;
        const events = w.scoreEvents;
        if (!events.length) return;
        Physics.markLitFromEvents(w, events);
        for (const e of events) {
            if (e.kind === "peg-hit") this.hitPeg(e.peg);
            else if (e.kind === "wall-hit") this.fx.cue("wall");
            else if (e.kind === "catchbar-hit") w.caughtThisShot = true;
            else if (e.kind === "ball-exit" && !Physics.hasActiveBall(w)) this.finishShot();
        }
        events.length = 0;
    }

    hitPeg(peg) {
        const w = this.world;
        if (peg._scoredShot !== w.shotIndex) {
            peg._scoredShot = w.shotIndex;
            this.hits++;
            if (peg.type === "orange") {
                this.orangeHits++;
                this.fx.cue("orange@" + this.hits);
            } else if (peg.type === "purple") {
                this.purple = true;
                this.fx.cue("purple");
            } else if (peg.type === "green") {
                this.guide.trigger(w, peg);
                this.fx.cue("green");
            } else {
                this.fx.cue("peg@" + this.hits);
            }
            this.shotScore += PEG_POINTS[peg.type] * this.mult;
            this.fx.burst(peg.x, peg.y, PEG_COLORS[peg.type], 6, 160);
        }
        const left = this.remainingOrange();
        if (left === 1 && peg.type === "orange") w.slowmo = 1.1;   // one to go: slow-mo
        if (left === 0 && !w.feverBlasted) {
            w.feverBlasted = true;
            this.shotScore += FEVER_BONUS;
            this.fx.shake();
            this.fx.fever("ULTRA EXTREME!");
            this.fx.cue("fever");
        }
    }

    /** Last ball gone: burst the lit pegs, bank the shot, award balls, decide. */
    finishShot() {
        const w = this.world;
        for (const p of Physics.sweepLit(w)) this.fx.burst(p.x, p.y, PEG_COLORS[p.type], 12, 220);
        if (w.caughtThisShot) {
            w.caughtThisShot = false;
            this.balls += 1;
            this.fx.toast("Free ball!");
            this.fx.cue("catch");
        }

        this.score += this.shotScore;
        const left = this.remainingOrange();
        const earned = Math.floor((this.totalOrangeStart - left) / ORANGES_PER_BONUS_BALL);
        while (this.bonusBallsAwarded < earned) {
            this.bonusBallsAwarded++;
            this.balls += 1;
            this.fx.toast("Bonus ball!");
        }
        if (w.mirageNextShot) {
            w.mirageNextShot = false;
            this.mirageShowing = true;
        }

        this.shotInProgress = false;
        this.resetShot();
        if (left === 0) this.status = "clear";
        else if (this.balls <= 0) this.status = "fail";
    }

    /**
     * Dots for the aim guide: the Mirage prediction when it is showing,
     * else a short ballistic arc that stops at the first peg. Empty while a
     * shot is in flight.
     */
    previewPath(showTrajectory) {
        if (!this.canLaunch() || (!showTrajectory && !this.mirageShowing)) return [];
        const m = this.muzzle();
        const pts = [];
        if (this.mirageShowing) {
            Physics.predict(this.world, this.aimAngle, LAUNCH_SPEED, m.x, m.y, 2.2, pts);
            return pts;
        }
        let x = m.x, y = m.y;
        let vx = Math.cos(this.aimAngle) * LAUNCH_SPEED;
        let vy = Math.sin(this.aimAngle) * LAUNCH_SPEED;
        const dt = 1 / 60;
        const reach = Physics.PEG_RADIUS + 6;
        for (let i = 0; i < 22; i++) {
            x += vx * dt;
            y += vy * dt;
            vy += 1400 * dt;
            if (y > Physics.FIELD_H) break;
            if (this.world.pegs.some((p) => !p.removed && Math.hypot(p.x - x, p.y - y) < reach)) break;
            pts.push({ x, y });
        }
        return pts;
    }

    destroy() {
        Physics.destroyWorld(this.world);
    }
}

/**
 * Play one shot on a fresh copy of level `levelIdx` at `angle` with no
 * effects and report what it did. Leaves any live round alone.
 */
export function simulateShot(levelIdx, angle, seed) {
    const round = new Round({ levelIdx, seed });
    const startOrange = round.totalOrangeStart;
    round.aimAngle = angle;
    round.launch();
    let elapsed = 0, maxMult = 1;
    const dt = 1 / 180;
    while (round.shotInProgress && elapsed < 12) {
        round.step(dt);
        maxMult = Math.max(maxMult, round.mult);
        elapsed += dt;
    }
    const out = {
        orangeCleared: startOrange - round.remainingOrange(),
        shotScore: round.score,
        comboMult: maxMult,
        elapsed,
        startOrange,
    };
    round.destroy();
    return out;
}
