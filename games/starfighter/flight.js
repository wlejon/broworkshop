// flight.js — one Nova Squadron run as a DOM-free session: the ship on its
// rail, lasers, enemy fire, damage, sector flow and scoring.
//
// The Flight is also the `world` that waves.js and enemies.js drive:
// rand(), loop, ship, railSpeed, addEnemy, spawnEnemyBolt, hasLiveEnemies,
// takeDamage, radio, cue, portMissed, lockActive. Feedback leaves through
// `fx` ({ cue, shake, flash, jitter }); the camera and HUD live elsewhere.

import { seededRandom } from "/lib/arcade/grid.js";
import { NEAR_Z } from "/app/camera.js";
import { updateEnemy } from "/app/enemies.js";
import { WAVES, SPACE, ORDER, sectorOf, nextWave, loopScale } from "/app/waves.js";

export const MAX_SHIELDS = 6;
export const YOKE_MAX_DEFLECT = 22;     // world units of reticle travel
export const RETICLE_LAG_MS = 140;      // ship eases toward the reticle
export const FORWARD_SPEED = 0.07;      // default rail speed, units / ms
export const PARALLAX = 0.35;           // camera slide per unit of ship offset
export const RETICLE_Z = 40;
export const FIRE_COOLDOWN_MS = 170;
export const BOLT_VISUAL_LIFE = 180;
export const ENEMY_BOLT_SPEED = 0.18;
export const PLAYER_HIT_RADIUS = 3.0;
export const MAX_EXPLOSIONS = 24;
export const SECTOR_BONUS = { space: 5000, surface: 10000, trench: 15000 };
export const SHIELD_BONUS_PER = 2500;   // per shield left at the vent, x loopScale
export const ACE_BONUS = 2000;
export const VENT_HIT = 25000;
export const VENT_BULLSEYE = 100000;

/** Four wingtip cannons, relative to the ship. */
export const WINGTIPS = [{ x: 6, y: 1.5 }, { x: -6, y: 1.5 }, { x: 6, y: -1.5 }, { x: -6, y: -1.5 }];

const RADIO_INTRO = {
    space: "ENEMY FIGHTERS INBOUND",
    surface: "CITADEL SURFACE  ::  TOWERS HOT",
    trench: "TRENCH APPROACH  ::  HIT THE VENT",
};

/** "■ ■ □ ..." for n of MAX_SHIELDS. */
export function shieldBar(n) {
    let bar = "";
    for (let i = 0; i < MAX_SHIELDS; i++) bar += i < n ? "■ " : "□ ";
    return bar.trim();
}

/**
 * Distance along a unit ray (o + t·d) to its first hit of a sphere, or
 * Infinity. Also returns the perpendicular miss distance for vent scoring.
 */
export function raySphere(ox, oy, oz, dx, dy, dz, x, y, z, r) {
    const cx = x - ox, cy = y - oy, cz = z - oz;
    const tca = cx * dx + cy * dy + cz * dz;
    if (tca < 0) return { t: Infinity, miss: Infinity };
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    const miss = Math.sqrt(Math.max(0, d2));
    if (d2 > r * r) return { t: Infinity, miss };
    return { t: tca - Math.sqrt(r * r - d2), miss };
}

const NO_FX = { cue() {}, shake() {}, flash() {}, jitter() {} };

export class Flight {
    constructor({ seed, fx } = {}) {
        this.rand = seededRandom(seed != null ? seed : (Math.random() * 0x7fffffff) | 0);
        this.fx = fx || NO_FX;
        this.score = 0;
        this.loop = 1;
        this.wave = SPACE;
        this.shields = MAX_SHIELDS;
        this.status = null;          // null | "victory" | "dead"
        this.clock = 0;              // run time, ms

        this.ship = { x: 0, y: 0 };
        this.reticle = { x: 0, y: 0 };
        this.yoke = { x: 0, y: 0 };  // -1..1 each
        this.firing = false;
        this.fireCooldown = 0;
        this.targeting = true;       // off = "trust" x2 on the vent

        this.enemies = [];
        this.playerBolts = [];
        this.enemyBolts = [];
        this.explosions = [];

        this.radioText = "";
        this.radioUntil = 0;
        this.lockActive = false;
        this.ws = null;

        this.enterWave();
        this.cue("wave");
    }

    get sector() { return sectorOf(this.wave); }
    get label() { return this.loop + "-" + this.sector; }
    get railSpeed() { return this.ws && this.ws.railSpeed != null ? this.ws.railSpeed : FORWARD_SPEED; }
    get radioActive() { return this.clock < this.radioUntil; }

    // ── World interface (waves / enemies) ─────────────────────────────────

    cue(name) { this.fx.cue(name); }

    radio(text, ms = 2000) {
        this.radioText = text;
        this.radioUntil = this.clock + ms;
    }

    addEnemy(e) { this.enemies.push(e); }

    hasLiveEnemies() { return this.enemies.some((e) => !e.dead); }

    spawnEnemyBolt(fx, fy, fz) {
        let dx = this.ship.x - fx, dy = this.ship.y - fy, dz = -fz;
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.001) return;
        dx /= len; dy /= len; dz /= len;
        this.enemyBolts.push({
            x: fx, y: fy, z: fz,
            vx: dx * ENEMY_BOLT_SPEED, vy: dy * ENEMY_BOLT_SPEED, vz: dz * ENEMY_BOLT_SPEED,
            life: 4500, t: 0, color: "#6cf",
        });
        this.cue("enemyLaser");
    }

    takeDamage(n = 1) {
        if (this.status === "dead") return;
        this.shields -= n;
        this.fx.shake(8, 260);
        this.fx.jitter(1.5, 220);
        this.fx.flash("#f33", 220);
        this.cue("shieldHit");
        if (this.shields <= 0) {
            this.shields = 0;
            this.status = "dead";
            this.fx.shake(16, 900);
            this.cue("shipExplode");
        }
    }

    portMissed() {
        if (!this.ws || this.ws.portResolved) return;
        this.ws.portResolved = true;
        this.radio("VENT MISSED  ::  PULL UP", 2400);
    }

    // ── Controls ──────────────────────────────────────────────────────────

    steer(x, y) {
        this.yoke.x = Math.max(-1, Math.min(1, x));
        this.yoke.y = Math.max(-1, Math.min(1, y));
    }

    toggleTargeting() {
        this.targeting = !this.targeting;
        this.radio(this.targeting ? "TARGETING COMPUTER: ON" : "TARGETING COMPUTER: OFF", 1400);
    }

    // ── Sector flow ───────────────────────────────────────────────────────

    enterWave() {
        this.lockActive = false;
        this.enemies.length = 0;
        this.playerBolts.length = 0;
        this.enemyBolts.length = 0;
        this.explosions.length = 0;
        this.ws = WAVES[this.wave].create(this);
        this.radio("SECTOR " + this.label + "  ::  " + RADIO_INTRO[this.wave], 2600);
    }

    completeWave() {
        if (this.shields < MAX_SHIELDS) {
            this.shields = Math.min(MAX_SHIELDS, this.shields + 1);
            this.cue("bonusShield");
        }
        const bonus = Math.round((SECTOR_BONUS[this.wave] || 0) * loopScale(this.loop));
        if (bonus > 0) {
            this.score += bonus;
            this.radio("SECTOR CLEAR  +" + bonus, 2200);
        }
        const next = nextWave(this.wave);
        if (!next) {
            this.shieldBonus = Math.round(this.shields * SHIELD_BONUS_PER * loopScale(this.loop));
            this.score += this.shieldBonus;
            this.status = "victory";
            return;
        }
        this.wave = next;
        this.enterWave();
        this.cue("wave");
    }

    /** After the victory screen: the next, harder campaign. */
    advanceLoop() {
        this.loop += 1;
        this.wave = ORDER[0];
        this.status = null;
        this.enterWave();
        this.cue("wave");
    }

    // ── Frame ─────────────────────────────────────────────────────────────

    step(dt) {
        if (this.status) return;
        this.clock += dt;

        const tx = this.yoke.x * YOKE_MAX_DEFLECT;
        const ty = this.yoke.y * YOKE_MAX_DEFLECT;
        const k = Math.min(1, dt / RETICLE_LAG_MS);
        this.ship.x += (tx - this.ship.x) * k;
        this.ship.y += (ty - this.ship.y) * k;
        this.reticle.x = tx;
        this.reticle.y = ty;

        if (this.fireCooldown > 0) this.fireCooldown -= dt;
        if (this.firing) this.fire();

        const wave = WAVES[this.ws.kind];
        wave.update(this.ws, dt, this);
        for (const e of this.enemies) if (!e.dead) updateEnemy(e, dt, this);
        this.enemies = this.enemies.filter((e) => !e.dead);

        this.stepBolts(dt);
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const x = this.explosions[i];
            x.t += dt;
            if (x.t >= x.life) this.explosions.splice(i, 1);
        }

        if (!this.status && wave.isComplete(this.ws, this)) this.completeWave();
    }

    stepBolts(dt) {
        for (let i = this.playerBolts.length - 1; i >= 0; i--) {
            const b = this.playerBolts[i];
            b.t += dt;
            if (b.t >= b.life) this.playerBolts.splice(i, 1);
        }
        const r2 = PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS + 2;
        for (let i = this.enemyBolts.length - 1; i >= 0; i--) {
            const b = this.enemyBolts[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.z += b.vz * dt;
            b.t += dt;
            if (b.z >= 0 && b.t < b.life) continue;
            if (b.z < NEAR_Z + 1) {
                const dx = b.x - this.ship.x, dy = b.y - this.ship.y;
                if (dx * dx + dy * dy < r2) this.takeDamage(1);
            }
            this.enemyBolts.splice(i, 1);
        }
    }

    // ── Lasers ────────────────────────────────────────────────────────────

    /** Four wingtip bolts converge on the reticle; the hit is a ray cast. */
    fire() {
        if (this.fireCooldown > 0) return;
        this.fireCooldown = FIRE_COOLDOWN_MS;
        const tx = this.reticle.x, ty = this.reticle.y;
        for (const w of WINGTIPS) {
            this.playerBolts.push({
                ox: this.ship.x + w.x, oy: this.ship.y + w.y, oz: 1.0,
                tx, ty, tz: RETICLE_Z, t: 0, life: BOLT_VISUAL_LIFE, color: "#f44",
            });
        }
        this.cue("laser");

        const ox = this.ship.x, oy = this.ship.y;
        let dx = tx - ox, dy = ty - oy, dz = RETICLE_Z;
        const len = Math.hypot(dx, dy, dz);
        dx /= len; dy /= len; dz /= len;

        let best = null, bestHit = null;
        for (const e of this.enemies) {
            if (e.dead || e.hp <= 0 || e.kind === "fireball") continue;
            const hit = raySphere(ox, oy, 0, dx, dy, dz, e.x, e.y + (e.hitY || 0), e.z, e.radius + 0.5);
            if (hit.t < (bestHit ? bestHit.t : Infinity)) { best = e; bestHit = hit; }
        }
        if (!best) return null;
        if (best.kind === "ace") {
            if (!best.flee) {
                best.flee = true;
                this.score += ACE_BONUS;
                this.cue("enemyHit");
                this.radio("BLACK ACE BREAKING OFF", 1600);
            }
        } else if (best.kind === "port") {
            this.hitPort(best, bestHit.miss);
        } else {
            best.hp -= 1;
            if (best.hp <= 0) this.kill(best);
        }
        return best;
    }

    /** Vent hit: bullseye inside innerRadius; x2 with the computer off. */
    hitPort(port, miss) {
        if (port.resolved) return;
        const trust = this.targeting ? 1 : 2;
        const tag = trust > 1 ? "  ::  TRUST BONUS x2" : "";
        if (miss <= port.innerRadius) {
            this.score += VENT_BULLSEYE * trust;
            this.radio("BULLSEYE" + tag, 2600);
            this.cue("bullseye");
        } else {
            this.score += VENT_HIT * trust;
            this.radio("DIRECT HIT" + tag, 2600);
            this.cue("directHit");
        }
        port.resolved = true;
        port.dead = true;
        this.explode(port.x, port.y, port.z, 3.5);
        this.fx.shake(18, 900);
        this.fx.flash("#fff", 360);
        if (this.ws) this.ws.portResolved = true;
    }

    kill(e) {
        e.dead = true;
        this.score += e.score || 0;
        this.explode(e.x, e.y + (e.hitY || 0), e.z, e.scale || 1.4);
        this.cue("enemyBoom");
    }

    explode(x, y, z, scale) {
        if (this.explosions.length >= MAX_EXPLOSIONS) this.explosions.shift();
        const rand = this.rand;
        const shards = [];
        const n = 8 + ((rand() * 4) | 0);
        for (let i = 0; i < n; i++) {
            const a = rand() * Math.PI * 2;
            const p = (rand() - 0.5) * Math.PI;
            const speed = (0.01 + rand() * 0.025) * scale;
            shards.push({
                vx: Math.cos(a) * Math.cos(p) * speed,
                vy: Math.sin(p) * speed,
                vz: Math.sin(a) * Math.cos(p) * speed,
            });
        }
        this.explosions.push({ x, y, z, shards, t: 0, life: 550 });
    }
}
