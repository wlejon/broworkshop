// cannon.js — a cannon that fires real Jolt bodies at the figure.
//
// The balls are ordinary dynamic bodies: the hit IS the collision, momentum
// and all. The contact stream only tells the blender WHICH part was struck
// (and a spark burst where), so the figure goes limp from the limb the ball
// actually touched.

import { BodyGroup } from "/lib/kit/physics3d.js";
import { quatYTo, v3 } from "/lib/kit/math3d.js";

const G = 9.81;
const BALL = { radius: 0.22, mass: 18, life: 4.0 };

export class Cannon {
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.muzzle = opts.muzzle || { x: -5.5, y: 1.8, z: 0 };
        this.target = opts.target || { x: 0, y: 1.4, z: 0 };
        this.speed = opts.speed ?? 22;
        this.balls = new BodyGroup(scene);
        this.shots = 0;
        this.hits = 0;
        this.clock = 0;
        this.onHit = opts.onHit || null;

        // Barrel along the aim, a stubby carriage under it.
        this.barrel = scene.createMesh({ mesh: 'cylinder', radius: 0.16, halfHeight: 0.55, segments: 18,
            color: '#3b4250', roughness: 0.35, metallic: 0.8 });
        scene.createMesh({ mesh: 'box', halfW: 0.35, halfH: (this.muzzle.y - 0.35) / 2, halfD: 0.3,
            x: this.muzzle.x - 0.4, y: (this.muzzle.y - 0.35) / 2, z: this.muzzle.z, color: '#5a4632', roughness: 0.9 });
        // Trajectory preview: a string of small emissive beads.
        this.beads = [];
        for (let i = 0; i < 24; i++) {
            this.beads.push(scene.createMesh({ mesh: 'sphere', radius: 0.035, segments: 6, rings: 4,
                color: '#f59e0b', emissive: 2.0, emissiveColor: '#f59e0b', roughness: 1 }));
        }
        this.sparks = [0, 1].map((i) => scene.createParticles3D({
            name: 'cannon-sparks-' + i, shape: { type: 'cone', radius: 0.05, angle: 40 },
            rate: 0, maxParticles: 80, seed: 77 + i,
            lifetime: { min: 0.15, max: 0.5 },
            velocity: { direction: [0, 1, 0], spread: 35, speed: 5, speedSpread: 3 },
            gravity: [0, -12, 0], size: { start: 0.09, end: 0.01 },
            color: ['#fff6d8', '#ffaa00', 'rgba(180,50,10,0)'], blend: 'additive',
        }));
        this.aim();
    }

    /** Launch velocity: straight at the target plus 90% of the drop over the flight. */
    velocity() {
        const d = v3.sub(this.target, this.muzzle);
        const dist = v3.len(d);
        const t = dist / this.speed;
        return { x: d.x / dist * this.speed, y: d.y / dist * this.speed + 0.5 * G * t * 0.9, z: d.z / dist * this.speed };
    }

    /** Predicted flight, sampled to 1.3x the time to the target. */
    trajectory(steps = this.beads.length) {
        const v = this.velocity();
        const T = v3.dist(this.target, this.muzzle) / this.speed * 1.3;
        const pts = [];
        for (let i = 0; i < steps; i++) {
            const t = (i + 1) / steps * T;
            pts.push({ x: this.muzzle.x + v.x * t, y: this.muzzle.y + v.y * t - 0.5 * G * t * t, z: this.muzzle.z + v.z * t });
        }
        return pts;
    }

    setSpeed(s) { this.speed = s; this.aim(); }

    /** Point the barrel and re-lay the beads for the current speed. */
    aim() {
        const v = this.velocity(), n = v3.len(v);
        const d = { x: v.x / n, y: v.y / n, z: v.z / n };
        this.barrel.quaternion = quatYTo(d.x, d.y, d.z);
        this.barrel.x = this.muzzle.x - d.x * 0.5; this.barrel.y = this.muzzle.y - d.y * 0.5; this.barrel.z = this.muzzle.z - d.z * 0.5;
        this.trajectory().forEach((p, i) => { const b = this.beads[i]; b.x = p.x; b.y = p.y; b.z = p.z; });
    }

    burst(p, n, dir = { x: 0, y: 1, z: 0 }) {
        const em = this.sparks[n > 20 ? 1 : 0];
        em.x = p.x; em.y = p.y; em.z = p.z;
        em.quaternion = quatYTo(dir.x, dir.y, dir.z);
        em.burst(n);
    }

    fire() {
        const v = this.velocity();
        const e = this.balls.add({ shape: 'sphere', radius: BALL.radius, position: { ...this.muzzle }, mass: BALL.mass,
            layer: 'player', friction: 0.5, restitution: 0.3, linearDamping: 0 },
            { color: '#2a2e38', roughness: 0.3, metallic: 0.85, velocity: v }, { born: this.clock, hit: false });
        this.shots++;
        const n = v3.len(v);
        this.burst(this.muzzle, 14, { x: v.x / n, y: v.y / n, z: v.z / n });
        return e;
    }

    /**
     * One frame's contacts. partOf(tag) -> part index or -1. The first touch
     * between a ball and a part is the hit.
     */
    contacts(list, partOf) {
        for (const c of list) {
            if (c.type !== 'added' || c.sensor) continue;
            const ball = this.balls.get(c.body1) || this.balls.get(c.body2);
            if (!ball || ball.hit) continue;
            const other = ball.tag === c.body1 ? c.body2 : c.body1;
            const part = partOf(other);
            if (part < 0) continue;
            ball.hit = true;
            this.hits++;
            const p = c.points && c.points[0] ? c.points[0] : Physics.getTransform(ball.tag).position;
            this.burst(p, 26, c.normal || { x: 0, y: 1, z: 0 });
            if (this.onHit) this.onHit(part, ball);
        }
    }

    /** Expire old balls. */
    update(dt) {
        this.clock += dt;
        for (const b of [...this.balls.values()]) if (this.clock - b.born > BALL.life) this.balls.remove(b.tag);
    }

    clear() { this.balls.clear(); }
}
