// cannons.js — Projectile physics launcher, cannonball spawning, trajectory prediction, and impact impulse transfer.

export class CannonSystem {
    constructor(scene, blender) {
        this.scene = scene;
        this.blender = blender;

        // Cannon origin & target
        this.muzzlePos = { x: -6.5, y: 2.2, z: 0.0 };
        this.targetPos = { x: 0.0, y: 1.4, z: 0.0 };
        this.projectileSpeed = 22.0; // m/s
        this.ballRadius = 0.22;
        this.ballMass = 18.0; // heavy iron ball

        // Live projectiles
        this.cannonballs = [];
        this.particles = [];
    }

    setMuzzlePos(x, y, z) {
        this.muzzlePos = { x, y, z };
    }

    setTargetPos(x, y, z) {
        this.targetPos = { x, y, z };
    }

    shoot() {
        const dx = this.targetPos.x - this.muzzlePos.x;
        const dy = this.targetPos.y - this.muzzlePos.y;
        const dz = this.targetPos.z - this.muzzlePos.z;
        const dist = Math.hypot(dx, dy, dz);

        const dirX = dx / dist;
        const dirY = dy / dist;
        const dirZ = dz / dist;

        // Add slight upward ballistic compensation
        const timeToTarget = dist / this.projectileSpeed;
        const vyComp = 0.5 * 9.81 * timeToTarget * 0.9;

        const ball = {
            x: this.muzzlePos.x,
            y: this.muzzlePos.y,
            z: this.muzzlePos.z,
            vx: dirX * this.projectileSpeed,
            vy: dirY * this.projectileSpeed + vyComp,
            vz: dirZ * this.projectileSpeed,
            radius: this.ballRadius,
            mass: this.ballMass,
            life: 4.0,
            hasHit: false,
            mesh: null
        };

        if (this.scene && typeof this.scene.createMesh === 'function') {
            try {
                ball.mesh = this.scene.createMesh({
                    mesh: 'sphere',
                    radius: this.ballRadius,
                    color: '#2a2e38',
                    roughness: 0.3,
                    metalness: 0.85
                });
            } catch (_) {}
        }

        this.cannonballs.push(ball);
        this.spawnSparks(this.muzzlePos, 12, '#ffaa00');
    }

    spawnSparks(pos, count = 10, color = '#ffcc00') {
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: pos.x,
                y: pos.y,
                z: pos.z,
                vx: (Math.random() - 0.5) * 8.0,
                vy: Math.random() * 6.0 + 2.0,
                vz: (Math.random() - 0.5) * 8.0,
                color,
                life: 0.6,
                maxLife: 0.6
            });
        }
    }

    update(dt) {
        const GRAVITY = -9.81;

        // Update Projectiles
        for (let i = this.cannonballs.length - 1; i >= 0; i--) {
            const ball = this.cannonballs[i];
            ball.life -= dt;

            // Gravity & velocity integration
            ball.vy += GRAVITY * dt;
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
            ball.z += ball.vz * dt;

            // Check collision with ground
            if (ball.y < ball.radius) {
                ball.y = ball.radius;
                ball.vy = -ball.vy * 0.35;
                ball.vx *= 0.7;
                ball.vz *= 0.7;
            }

            // Check collision with character/ragdoll limbs
            if (!ball.hasHit) {
                const limbs = this.blender.ragdoll.limbs;
                for (let l = 0; l < limbs.length; l++) {
                    const limb = limbs[l];
                    const dist = Math.hypot(
                        ball.x - limb.position.x,
                        ball.y - limb.position.y,
                        ball.z - limb.position.z
                    );

                    if (dist < ball.radius + limb.radius + (limb.halfHeight || 0.1)) {
                        // Impact detected!
                        ball.hasHit = true;
                        const impulse = {
                            x: ball.vx * ball.mass * 0.9,
                            y: Math.max(15, ball.vy * ball.mass * 0.9),
                            z: ball.vz * ball.mass * 0.9
                        };

                        this.blender.triggerRagdoll(l, impulse);
                        this.spawnSparks({ x: ball.x, y: ball.y, z: ball.z }, 20, '#ff4400');

                        // Ball ricochet
                        ball.vx = -ball.vx * 0.25;
                        ball.vy = ball.vy * 0.4 + 2.0;
                        ball.vz = -ball.vz * 0.25;
                        break;
                    }
                }
            }

            // Update 3D mesh transform if present
            if (ball.mesh) {
                ball.mesh.position = [ball.x, ball.y, ball.z];
            }

            // Clean up dead balls
            if (ball.life <= 0) {
                if (ball.mesh && typeof ball.mesh.dispose === 'function') {
                    ball.mesh.dispose();
                }
                this.cannonballs.splice(i, 1);
            }
        }

        // Update Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;
            p.vy += GRAVITY * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    /**
     * Computes the simulated trajectory arc points for preview rendering.
     */
    getTrajectoryPoints(steps = 25) {
        const dx = this.targetPos.x - this.muzzlePos.x;
        const dy = this.targetPos.y - this.muzzlePos.y;
        const dz = this.targetPos.z - this.muzzlePos.z;
        const dist = Math.hypot(dx, dy, dz);

        const dirX = dx / dist;
        const dirY = dy / dist;
        const dirZ = dz / dist;

        const timeToTarget = dist / this.projectileSpeed;
        const vyComp = 0.5 * 9.81 * timeToTarget * 0.9;

        const vx = dirX * this.projectileSpeed;
        const vy = dirY * this.projectileSpeed + vyComp;
        const vz = dirZ * this.projectileSpeed;

        const points = [];
        const dtStep = (timeToTarget * 1.3) / steps;

        for (let i = 0; i <= steps; i++) {
            const t = i * dtStep;
            points.push({
                x: this.muzzlePos.x + vx * t,
                y: this.muzzlePos.y + vy * t - 0.5 * 9.81 * t * t,
                z: this.muzzlePos.z + vz * t
            });
        }

        return points;
    }
}
