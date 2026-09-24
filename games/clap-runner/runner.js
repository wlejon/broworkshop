// runner.js — Clap Runner's run: player physics, obstacle waves, pickups,
// streak multiplier, shield and scoring, on a 960 x 540 world. No DOM and no
// clock of its own; time comes in through step(dt) in seconds. Effects go
// out through `fx` in world pixels:
//   fx.cue(name) · fx.emit(kind, x, y, color, count) · fx.text(x, y, text, color)
// emit kinds: "jump", "slide", "thrust", "boom" (render.js turns them into bursts).

export const WORLD_W = 960;
export const WORLD_H = 540;
export const GROUND_Y = 440;

const BASE_SPEED = 380;
const MAX_SPEED = 820;
const GRAVITY = 1850;
const GLIDE_GRAVITY = 280;
const JUMP_VY = -680;
const SUPER_JUMP_VY = -980;
const GLIDE_MAX_FALL = 120;
const SLIDE_TIME = 0.55;
const SHIELD_GRACE = 1.2;
const MAX_MULT = 8;

const NO_FX = { cue() {}, emit() {}, text() {} };

export class Runner {
    /** @param {object} opts { rand, fx } */
    constructor(opts = {}) {
        this.rand = opts.rand || Math.random;
        this.fx = opts.fx || NO_FX;
        this.time = 0;
        this.speed = BASE_SPEED;
        this.score = 0;
        this.distScore = 0;
        this.distance = 0;
        this.coins = 0;
        this.multiplier = 1;
        this.streak = 0;
        this.crashed = false;
        this.player = {
            x: 140, y: GROUND_Y, vy: 0, width: 38, height: 68,
            grounded: true, gliding: false, sliding: false, superJumping: false,
            shield: false, invincible: 0, slideTimer: 0, animTimer: 0, runFrame: 0,
        };
        this.obstacles = [];
        this.pickups = [];
        this.spawnAcc = 0;
        this.nextSpawn = 400;
        this.scroll = { sky: 0, far: 0, mid: 0, near: 0 };
    }

    // ── Moves ──────────────────────────────────────────────────────────

    /** Jump from the ground, or a second hop late in a glide. */
    jump() {
        const p = this.player;
        if (this.crashed || !(p.grounded || (p.gliding && p.vy > -100))) return false;
        p.grounded = false;
        p.sliding = false;
        p.superJumping = false;
        p.vy = JUMP_VY;
        this.fx.emit("jump", p.x, p.y, "#00e5ff", 12);
        this.fx.cue("jump");
        return true;
    }

    /** Big jump from anywhere, even mid-air. */
    superJump() {
        const p = this.player;
        if (this.crashed) return false;
        p.grounded = false;
        p.sliding = false;
        p.superJumping = true;
        p.vy = SUPER_JUMP_VY;
        this.fx.emit("jump", p.x, p.y, "#ff007f", 24);
        this.fx.text(p.x + 20, p.y - 40, "SUPER JUMP!", "#ff007f");
        this.fx.cue("superJump");
        return true;
    }

    glideStart() {
        const p = this.player;
        if (this.crashed || p.gliding) return false;
        p.gliding = true;
        p.sliding = false;
        if (p.vy > 60) p.vy = 60;
        this.fx.cue("glideStart");
        return true;
    }

    glideEnd() {
        if (!this.player.gliding) return;
        this.player.gliding = false;
        this.fx.cue("glideStop");
    }

    slideStart() {
        const p = this.player;
        if (this.crashed || !p.grounded || p.sliding) return false;
        p.sliding = true;
        p.slideTimer = SLIDE_TIME;
        this.fx.emit("slide", p.x, p.y, null, 10);
        this.fx.cue("slide");
        return true;
    }

    slideEnd() { this.player.sliding = false; }

    // ── Step ───────────────────────────────────────────────────────────

    /** Advance dt seconds. Returns true on the step the runner crashes. */
    step(dt) {
        if (this.crashed) return false;
        const p = this.player;
        this.time += dt;
        this.speed = Math.min(MAX_SPEED, BASE_SPEED + this.distance / 12);
        const move = this.speed * dt;
        this.distance += move * 0.05;

        const s = this.scroll;
        s.sky = (s.sky + this.speed * 0.04 * dt) % WORLD_W;
        s.far = (s.far + this.speed * 0.18 * dt) % WORLD_W;
        s.mid = (s.mid + this.speed * 0.45 * dt) % WORLD_W;
        s.near = (s.near + this.speed * dt) % WORLD_W;

        p.vy += (p.gliding ? GLIDE_GRAVITY : GRAVITY) * dt;
        if (p.gliding) {
            if (p.vy > GLIDE_MAX_FALL) p.vy = GLIDE_MAX_FALL;
            this.fx.emit("thrust", p.x - 10, p.y - 12, null, 1);
        }
        p.y += p.vy * dt;
        if (p.y >= GROUND_Y) {
            p.y = GROUND_Y;
            p.vy = 0;
            p.grounded = true;
            p.superJumping = false;
        } else {
            p.grounded = false;
        }

        if (p.sliding) {
            p.slideTimer -= dt;
            if (p.slideTimer <= 0) p.sliding = false;
            else this.fx.emit("slide", p.x, p.y, null, 1);
        }
        if (p.invincible > 0) p.invincible -= dt;
        p.animTimer += dt * (this.speed / 180);
        p.runFrame = Math.floor(p.animTimer) % 6;

        this.spawnAcc += move;
        if (this.spawnAcc >= this.nextSpawn) {
            this.spawnAcc = 0;
            this.spawnWave();
            this.nextSpawn = 320 + this.rand() * 380;
        }

        if (this.stepObstacles(dt, move)) return true;
        this.stepPickups(dt, move);
        // Distance points accrue fractionally: floored per frame they were
        // always 0 at 60 fps (6 px x 0.08).
        this.distScore += move * 0.08 * this.multiplier;
        const whole = Math.floor(this.distScore);
        this.distScore -= whole;
        this.score += whole;
        return false;
    }

    stepObstacles(dt, move) {
        const p = this.player;
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            o.x -= move;
            if (o.type === "HOVER_DRONE") {
                o.hoverT += dt * 3;
                o.y = o.baseY + Math.sin(o.hoverT) * 35;
            }
            if (!o.passed && o.x + o.w < p.x) {
                o.passed = true;
                this.score += 50 * this.multiplier;
                this.streak++;
                if (this.streak % 5 === 0 && this.multiplier < MAX_MULT) {
                    this.multiplier++;
                    this.fx.text(p.x, p.y - 60, this.multiplier + "X MULTIPLIER!", "#ffea00");
                    this.fx.cue("multiplier");
                }
            }
            if (this.hits(o) && p.invincible <= 0) {
                if (p.shield) {
                    p.shield = false;
                    p.invincible = SHIELD_GRACE;
                    this.fx.emit("boom", o.x + o.w / 2, o.y + o.h / 2, "#ff00ff", 20);
                    this.fx.text(p.x, p.y - 50, "SHIELD BROKEN!", "#ff007f");
                    this.fx.cue("crash");
                } else {
                    this.crash();
                    return true;
                }
            }
            if (o.x < -100) this.obstacles.splice(i, 1);
        }
        return false;
    }

    stepPickups(dt, move) {
        const p = this.player;
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const it = this.pickups[i];
            it.x -= move;
            it.rot += dt * 4;
            if (this.grabs(it)) {
                if (it.type === "COIN") {
                    this.coins++;
                    this.score += 100 * this.multiplier;
                    this.fx.emit("boom", it.x, it.y, "#ffea00", 10);
                    this.fx.cue("coin");
                } else if (it.type === "MULTIPLIER") {
                    this.multiplier = Math.min(MAX_MULT, this.multiplier + 1);
                    this.score += 250 * this.multiplier;
                    this.fx.text(it.x, it.y - 30, "+1X BOOST!", "#00e5ff");
                    this.fx.cue("multiplier");
                } else if (it.type === "SHIELD") {
                    p.shield = true;
                    this.fx.text(it.x, it.y - 30, "SHIELD ACTIVE!", "#ff00e5");
                    this.fx.cue("shield");
                }
                this.pickups.splice(i, 1);
                continue;
            }
            if (it.x < -50) this.pickups.splice(i, 1);
        }
    }

    crash() {
        const p = this.player;
        this.crashed = true;
        this.glideEnd();
        this.fx.emit("boom", p.x, p.y - 30, "#ff0055", 40);
        this.fx.cue("crash");
        this.fx.cue("gameOver");
    }

    // ── Spawning ───────────────────────────────────────────────────────

    /** One obstacle (spikes / overhead laser / tower / drone) and its pickups. */
    spawnWave(type) {
        if (!type) {
            const r = this.rand();
            type = r < 0.35 ? "SPIKE_BARRIER" : r < 0.65 ? "HIGH_LASER" : r < 0.85 ? "PLASMA_TOWER" : "HOVER_DRONE";
        }
        const x = WORLD_W + 50;
        const G = GROUND_Y;
        if (type === "SPIKE_BARRIER") {
            this.addObstacle(type, x, G - 42, 46, 42, "#ff0055");
            for (let i = 0; i < 4; i++) {
                this.addPickup("COIN", x + 100 + i * 36, G - 110 - Math.sin((i / 3) * Math.PI) * 45, 12);
            }
        } else if (type === "HIGH_LASER") {
            this.addObstacle(type, x, G - 140, 64, 96, "#ffea00");
            this.addPickup("COIN", x + 30, G - 20, 12);
        } else if (type === "PLASMA_TOWER") {
            this.addObstacle(type, x, G - 120, 38, 120, "#b000ff");
            this.addPickup("COIN", x + 19, G - 170, 14);
            if (this.rand() < 0.4) this.addPickup("MULTIPLIER", x + 80, G - 180, 16);
        } else {
            const o = this.addObstacle("HOVER_DRONE", x, G - 110, 48, 36, "#00e5ff");
            o.baseY = G - 110;
            if (this.rand() < 0.25) this.addPickup("SHIELD", x + 120, G - 130, 16);
        }
        return type;
    }

    addObstacle(type, x, y, w, h, color) {
        const o = { type, x, y, w, h, color, passed: false, hoverT: 0, baseY: y };
        this.obstacles.push(o);
        return o;
    }

    addPickup(type, x, y, r) {
        const it = { type, x, y, r, rot: 0 };
        this.pickups.push(it);
        return it;
    }

    // ── Collision ──────────────────────────────────────────────────────

    /** Player box (low and wide while sliding), inset 6 px for fairness. */
    hits(o) {
        const p = this.player;
        let pw = p.width, ph = p.height;
        let px = p.x - pw / 2;
        if (p.sliding) {
            pw = 56;
            ph = 30;
            px = p.x - pw / 2 + 10;
        }
        const py = p.y - ph;
        const m = 6;
        return px + m < o.x + o.w && px + pw - m > o.x && py + m < o.y + o.h && py + ph - m > o.y;
    }

    grabs(it) {
        const p = this.player;
        const dx = p.x - it.x, dy = p.y - p.height / 2 - it.y;
        const r = it.r + 25;
        return dx * dx + dy * dy < r * r;
    }
}
