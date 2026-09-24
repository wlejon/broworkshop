// Serpcoil shooter — the fixed eye: aim, the loaded and next orbs (each may
// carry a power-up), and orbs in flight.

export const MUZZLE = 28;
const PROJECTILE_SPEED = 780;   // px/s
const FIRE_DELAY = 220;         // ms
const PROJECTILE_LIFE = 2400;   // ms

export const PU = { NONE: 0, BACKTRACK: 1, BLASTER: 2, COLORSHIFT: 3, SLOWMO: 4 };
export const PU_NAMES = ["", "BACKTRACK", "BLASTER", "COLORSHIFT", "SLOW-MO"];

export class Shooter {
    /** opts: { x, y, palette, rng } */
    constructor(opts) {
        this.x = opts.x || 0;
        this.y = opts.y || 0;
        this.rng = opts.rng || Math.random;
        this.palette = (opts.palette || [1, 2, 3]).slice();
        this.aim = 0;
        this.cooldown = 0;
        this.current = this.randomColor();
        this.currentPU = PU.NONE;
        this.next = this.randomColor();
        this.nextPU = PU.NONE;
        this.popsSincePU = 0;
        this.popsForNextPU = 28 + ((this.rng() * 8) | 0);
        this.projectiles = [];     // { x, y, vx, vy, color, pu, life }
    }

    randomColor() {
        return this.palette[(this.rng() * this.palette.length) | 0];
    }

    aimAt(x, y) {
        this.aim = Math.atan2(y - this.y, x - this.x);
    }

    /** Where the next-orb preview sits: behind the eye, opposite the aim. */
    backSlot() {
        return { x: this.x - Math.cos(this.aim) * 38, y: this.y - Math.sin(this.aim) * 38 };
    }

    tick(dt) {
        if (this.cooldown > 0) this.cooldown -= dt;
        const s = dt / 1000;
        for (const p of this.projectiles) {
            p.x += p.vx * s;
            p.y += p.vy * s;
            p.life -= dt;
        }
        this.projectiles = this.projectiles.filter((p) => p.life > 0);
    }

    /** Fire the loaded orb; returns the projectile, or null while cooling down. */
    fire() {
        if (this.cooldown > 0) return null;
        this.cooldown = FIRE_DELAY;
        const proj = {
            x: this.x + Math.cos(this.aim) * MUZZLE,
            y: this.y + Math.sin(this.aim) * MUZZLE,
            vx: Math.cos(this.aim) * PROJECTILE_SPEED,
            vy: Math.sin(this.aim) * PROJECTILE_SPEED,
            color: this.current,
            pu: this.currentPU,
            life: PROJECTILE_LIFE,
        };
        this.projectiles.push(proj);
        this.current = this.next;
        this.currentPU = this.nextPU;
        this.next = this.randomColor();
        this.nextPU = PU.NONE;
        return proj;
    }

    swap() {
        [this.current, this.next] = [this.next, this.current];
        [this.currentPU, this.nextPU] = [this.nextPU, this.currentPU];
    }

    removeProjectile(proj) {
        this.projectiles = this.projectiles.filter((p) => p !== proj);
    }

    /**
     * Count a pop; every 28-40 pops a random power-up rides the next orb.
     * Returns true when one was granted.
     */
    countPop() {
        if (++this.popsSincePU < this.popsForNextPU) return false;
        this.popsSincePU = 0;
        this.popsForNextPU = 28 + ((this.rng() * 12) | 0);
        this.nextPU = 1 + ((this.rng() * 4) | 0);
        return true;
    }

    /**
     * Keep the loaded and next orbs to colours still on the board. Returns
     * the slots that were recoloured ("current" / "next") so the caller can
     * puff them.
     */
    restrictTo(live) {
        this.palette = live.slice();
        const pick = () => live[(this.rng() * live.length) | 0];
        const changed = [];
        if (!live.includes(this.current)) { changed.push({ slot: "current", color: this.current }); this.current = pick(); }
        if (!live.includes(this.next)) { changed.push({ slot: "next", color: this.next }); this.next = pick(); }
        return changed;
    }
}
