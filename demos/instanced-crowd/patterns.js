// patterns.js — Mathematical coordinate and dynamics updates for 3D crowds.

/**
 * Convert HSV to RGB [0..1]
 */
function hsvToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: return [v, t, p];
        case 1: return [q, v, p];
        case 2: return [p, v, t];
        case 3: return [p, q, v];
        case 4: return [t, p, v];
        case 5: return [v, p, q];
    }
    return [v, v, v];
}

/**
 * Color palette evaluator
 */
export function computeColor(scheme, i, count, speed, x, y, z, phase) {
    const tNorm = i / Math.max(1, count);
    const speedFactor = Math.min(1.0, speed / 8.0);
    const heightFactor = Math.max(0.0, Math.min(1.0, (y + 15) / 30));

    switch (scheme) {
        case 'solar': {
            // Dark Crimson -> Orange -> Golden Yellow -> White
            const heat = Math.min(1.0, speedFactor * 0.7 + (Math.sin(phase + tNorm * 10) * 0.5 + 0.5) * 0.3);
            if (heat < 0.33) {
                const f = heat / 0.33;
                return [0.6 + 0.4 * f, 0.05 + 0.25 * f, 0.05, 1.0];
            } else if (heat < 0.7) {
                const f = (heat - 0.33) / 0.37;
                return [1.0, 0.3 + 0.6 * f, 0.05 + 0.1 * f, 1.0];
            } else {
                const f = (heat - 0.7) / 0.3;
                return [1.0, 0.9 + 0.1 * f, 0.15 + 0.75 * f, 1.0];
            }
        }
        case 'ocean': {
            // Deep Indigo -> Cyan -> Teal -> Seafoam
            const wave = Math.sin(phase * 2 + x * 0.1 + z * 0.1) * 0.5 + 0.5;
            const r = 0.05 + 0.15 * wave;
            const g = 0.4 + 0.55 * wave;
            const b = 0.7 + 0.3 * (1.0 - wave);
            return [r, g, b, 1.0];
        }
        case 'spectrum': {
            // Rainbow hue cycle
            const hue = (tNorm * 2.0 + phase * 0.2 + (y * 0.03)) % 1.0;
            const [r, g, b] = hsvToRgb(hue, 0.85, 0.95);
            return [r, g, b, 1.0];
        }
        case 'velocity': {
            // Cold blue (slow) -> Green -> Yellow -> Hot red (fast)
            const v = speedFactor;
            if (v < 0.25) {
                const f = v / 0.25;
                return [0.1, 0.3 + 0.6 * f, 0.9, 1.0];
            } else if (v < 0.5) {
                const f = (v - 0.25) / 0.25;
                return [0.1 + 0.4 * f, 0.9, 0.9 - 0.8 * f, 1.0];
            } else if (v < 0.75) {
                const f = (v - 0.5) / 0.25;
                return [0.5 + 0.5 * f, 0.9 - 0.1 * f, 0.1, 1.0];
            } else {
                const f = (v - 0.75) / 0.25;
                return [1.0, 0.8 - 0.6 * f, 0.1 + 0.4 * f, 1.0];
            }
        }
        case 'cyberpunk':
        default: {
            // Electric Cyan <-> Hot Magenta / Violet
            const blend = Math.sin(tNorm * Math.PI * 4 + phase + speedFactor * 2.0) * 0.5 + 0.5;
            const r = 0.05 * (1 - blend) + 0.98 * blend;
            const g = 0.88 * (1 - blend) + 0.15 * blend;
            const b = 0.99 * (1 - blend) + 0.85 * blend;
            return [r, g, b, 1.0];
        }
    }
}

/**
 * 1. Swarming (Boids-style flocking with 3D attractor/repeller)
 */
export function updateSwarm(particles, dt, time, config, mouseHit) {
    const { count, px, py, pz, vx, vy, vz, phase } = particles;
    const speedMult = config.speed;
    const spread = config.spread * 24.0;
    const noiseOn = config.noise;

    const mouseActive = config.mouseMode !== 'off' && mouseHit != null;
    const mx = mouseActive ? mouseHit[0] : 0;
    const my = mouseActive ? mouseHit[1] : 0;
    const mz = mouseActive ? mouseHit[2] : 0;
    const isRepel = config.mouseMode === 'repel';

    // 3 Cluster centers that wander over time
    const c1x = Math.sin(time * 0.7) * (spread * 0.6);
    const c1y = Math.cos(time * 0.5) * (spread * 0.3);
    const c1z = Math.cos(time * 0.6) * (spread * 0.6);

    const c2x = Math.sin(time * 0.9 + 2.0) * (spread * 0.7);
    const c2y = Math.sin(time * 0.8 + 1.0) * (spread * 0.4);
    const c2z = Math.cos(time * 0.8 + 2.0) * (spread * 0.7);

    const c3x = Math.cos(time * 0.6 + 4.0) * (spread * 0.65);
    const c3y = Math.sin(time * 0.4 + 3.0) * (spread * 0.35);
    const c3z = Math.sin(time * 0.7 + 4.0) * (spread * 0.65);

    for (let i = 0; i < count; i++) {
        let x = px[i], y = py[i], z = pz[i];
        let dx = vx[i], dy = vy[i], dz = vz[i];

        // Assign to one of 3 cluster targets
        let tx = c1x, ty = c1y, tz = c1z;
        const cluster = i % 3;
        if (cluster === 1) { tx = c2x; ty = c2y; tz = c2z; }
        else if (cluster === 2) { tx = c3x; ty = c3y; tz = c3z; }

        // Vector to cluster center
        let toX = tx - x, toY = ty - y, toZ = tz - z;
        let distCenter = Math.hypot(toX, toY, toZ) || 1;

        // Swirl around cluster center
        let swirlX = -toZ / distCenter;
        let swirlZ = toX / distCenter;

        // Steering forces
        const steerFactor = 1.6;
        dx += (toX / distCenter * 0.7 + swirlX * 1.2) * steerFactor * dt * speedMult;
        dy += (toY / distCenter * 0.9) * steerFactor * dt * speedMult;
        dz += (toZ / distCenter * 0.7 + swirlZ * 1.2) * steerFactor * dt * speedMult;

        // Noise turbulence
        if (noiseOn) {
            const p = phase[i] + time * 1.5;
            dx += Math.sin(p * 3.1 + y * 0.2) * 2.5 * dt * speedMult;
            dy += Math.cos(p * 2.7 + x * 0.2) * 2.0 * dt * speedMult;
            dz += Math.sin(p * 2.9 + z * 0.2) * 2.5 * dt * speedMult;
        }

        // Mouse attractor / repeller
        if (mouseActive) {
            const mdx = mx - x, mdy = my - y, mdz = mz - z;
            const mdist = Math.hypot(mdx, mdy, mdz) + 0.1;
            if (mdist < 35.0) {
                const force = (isRepel ? -45.0 : 35.0) / (mdist * 0.5 + 1.0);
                dx += (mdx / mdist) * force * dt * speedMult;
                dy += (mdy / mdist) * force * dt * speedMult;
                dz += (mdz / mdist) * force * dt * speedMult;
            }
        }

        // Soft containment sphere
        const rad = Math.hypot(x, y, z);
        const maxRad = spread * 1.4;
        if (rad > maxRad) {
            const pull = (rad - maxRad) * 0.4;
            dx -= (x / rad) * pull * dt;
            dy -= (y / rad) * pull * dt;
            dz -= (z / rad) * pull * dt;
        }

        // Damping and speed limiting
        const curSpeed = Math.hypot(dx, dy, dz) || 0.001;
        const maxSpeed = 16.0 * speedMult;
        const minSpeed = 2.0 * speedMult;
        let targetSpeed = curSpeed * (1.0 - dt * 0.8);
        if (targetSpeed > maxSpeed) targetSpeed = maxSpeed;
        if (targetSpeed < minSpeed) targetSpeed = minSpeed;

        const scale = targetSpeed / curSpeed;
        dx *= scale; dy *= scale; dz *= scale;

        // Integrate
        x += dx * dt;
        y += dy * dt;
        z += dz * dt;

        px[i] = x; py[i] = y; pz[i] = z;
        vx[i] = dx; vy[i] = dy; vz[i] = dz;
    }
}

/**
 * 2. Vortex (Dual Spiral Tornado with logarithmic dynamics)
 */
export function updateVortex(particles, dt, time, config, mouseHit) {
    const { count, px, py, pz, vx, vy, vz, phase, baseRadius, baseAngle } = particles;
    const speedMult = config.speed;
    const spread = config.spread * 18.0;

    for (let i = 0; i < count; i++) {
        const p = phase[i];
        const arm = i % 2 === 0 ? 0 : Math.PI;

        // Height oscillates smoothly along funnel
        const hNorm = ((p + time * 0.15 * speedMult) % 1.0);
        const y = (hNorm - 0.5) * 32.0;

        // Funnel radius expands at top, contracts at bottom
        const funnelR = (0.25 + 0.75 * hNorm) * spread;
        const rOffset = (Math.sin(p * 50.0 + time * 2.0) * 0.15) * funnelR;
        const r = funnelR + rOffset;

        // Angular velocity increases near the eye of the vortex
        const angSpeed = (2.2 / (0.3 + hNorm)) * speedMult;
        const theta = arm + baseAngle[i] + time * angSpeed + (hNorm * 6.0);

        const targetX = Math.cos(theta) * r;
        const targetZ = Math.sin(theta) * r;

        // Compute tangential velocity
        const vxEst = -Math.sin(theta) * r * angSpeed;
        const vyEst = 32.0 * 0.15 * speedMult;
        const vzEst = Math.cos(theta) * r * angSpeed;

        // Smooth transition
        px[i] += (targetX - px[i]) * Math.min(1.0, dt * 10.0);
        py[i] += (y - py[i]) * Math.min(1.0, dt * 10.0);
        pz[i] += (targetZ - pz[i]) * Math.min(1.0, dt * 10.0);

        vx[i] = vxEst;
        vy[i] = vyEst;
        vz[i] = vzEst;
    }
}

/**
 * 3. 3D Wave (Undulating ripple field)
 */
export function updateWave(particles, dt, time, config, mouseHit) {
    const { count, px, py, pz, vx, vy, vz, phase, origX, origZ } = particles;
    const speedMult = config.speed;
    const spread = config.spread * 22.0;

    const mouseActive = config.mouseMode !== 'off' && mouseHit != null;
    const mx = mouseActive ? mouseHit[0] : 0;
    const mz = mouseActive ? mouseHit[2] : 0;

    // Grid dimension estimate
    const side = Math.ceil(Math.sqrt(count));

    for (let i = 0; i < count; i++) {
        const row = Math.floor(i / side);
        const col = i % side;

        const u = (col / side - 0.5) * 2.0 * spread;
        const w = (row / side - 0.5) * 2.0 * spread;

        // Multi-frequency wave formula
        const dCenter = Math.hypot(u, w);
        const wave1 = Math.sin(dCenter * 0.35 - time * 2.5 * speedMult) * 3.5;
        const wave2 = Math.sin(u * 0.2 + time * 1.8 * speedMult) * Math.cos(w * 0.2 + time * 1.5 * speedMult) * 2.5;
        const wave3 = Math.cos(u * 0.4 - w * 0.3 + time * 3.0 * speedMult) * 1.2;

        let mouseWave = 0;
        if (mouseActive) {
            const dMouse = Math.hypot(u - mx, w - mz);
            mouseWave = Math.sin(dMouse * 0.6 - time * 5.0 * speedMult) * Math.exp(-dMouse * 0.12) * 5.0;
        }

        const targetY = wave1 + wave2 + wave3 + mouseWave;

        // Derivative for velocity direction
        const dY_du = (Math.cos(dCenter * 0.35 - time * 2.5 * speedMult) * 0.35 * (u / (dCenter + 0.1))) * 3.5;
        const dY_dw = (Math.cos(dCenter * 0.35 - time * 2.5 * speedMult) * 0.35 * (w / (dCenter + 0.1))) * 3.5;

        px[i] = u;
        py[i] += (targetY - py[i]) * Math.min(1.0, dt * 12.0);
        pz[i] = w;

        vx[i] = -dY_du * 4.0;
        vy[i] = (targetY - py[i]) / Math.max(1e-4, dt);
        vz[i] = -dY_dw * 4.0;
    }
}

/**
 * 4. Double Helix (DNA spiral flow)
 */
export function updateHelix(particles, dt, time, config, mouseHit) {
    const { count, px, py, pz, vx, vy, vz, phase } = particles;
    const speedMult = config.speed;
    const spread = config.spread * 12.0;

    for (let i = 0; i < count; i++) {
        const isStrandA = i % 2 === 0;
        const strandOffset = isStrandA ? 0 : Math.PI;

        const normH = ((i / count) + time * 0.1 * speedMult) % 1.0;
        const y = (normH - 0.5) * 40.0;

        const turns = 6.0;
        const angle = normH * turns * Math.PI * 2 + strandOffset;

        const r = (3.5 + Math.sin(y * 0.2 + time * 2.0) * 0.8) * (spread / 12.0);
        const targetX = Math.cos(angle) * r;
        const targetZ = Math.sin(angle) * r;

        // Tangent along helix curve
        const dX = -Math.sin(angle) * r * turns;
        const dY = 40.0;
        const dZ = Math.cos(angle) * r * turns;

        px[i] += (targetX - px[i]) * Math.min(1.0, dt * 10.0);
        py[i] += (y - py[i]) * Math.min(1.0, dt * 10.0);
        pz[i] += (targetZ - pz[i]) * Math.min(1.0, dt * 10.0);

        vx[i] = dX * speedMult * 0.2;
        vy[i] = dY * speedMult * 0.1;
        vz[i] = dZ * speedMult * 0.2;
    }
}

/**
 * 5. Galactic Pulsar (Orbital Clusters with radial breathing)
 */
export function updatePulsar(particles, dt, time, config, mouseHit) {
    const { count, px, py, pz, vx, vy, vz, phase, baseRadius, baseAngle } = particles;
    const speedMult = config.speed;
    const spread = config.spread * 20.0;

    const pulse = 1.0 + 0.25 * Math.sin(time * 3.0 * speedMult);

    for (let i = 0; i < count; i++) {
        const plane = i % 3;
        const baseR = baseRadius[i] * spread * pulse;
        const angSpeed = (2.8 / Math.sqrt(0.4 + baseRadius[i])) * speedMult;
        const angle = baseAngle[i] + time * angSpeed;

        let targetX = 0, targetY = 0, targetZ = 0;
        let vX = 0, vY = 0, vZ = 0;

        if (plane === 0) {
            // Equatorial plane
            targetX = Math.cos(angle) * baseR;
            targetY = Math.sin(angle * 3.0 + phase[i]) * (baseR * 0.15);
            targetZ = Math.sin(angle) * baseR;
            vX = -Math.sin(angle) * angSpeed * baseR;
            vY = Math.cos(angle * 3.0) * 3.0 * (baseR * 0.15);
            vZ = Math.cos(angle) * angSpeed * baseR;
        } else if (plane === 1) {
            // Inclined 45 deg
            const cx = Math.cos(angle) * baseR;
            const cy = Math.sin(angle) * baseR;
            targetX = cx;
            targetY = cy * 0.707 + Math.sin(phase[i] + time) * 0.5;
            targetZ = cy * 0.707;
            vX = -Math.sin(angle) * angSpeed * baseR;
            vY = Math.cos(angle) * angSpeed * baseR * 0.707;
            vZ = Math.cos(angle) * angSpeed * baseR * 0.707;
        } else {
            // Polar ring
            const cx = Math.cos(angle) * (baseR * 0.6);
            const cz = Math.sin(angle) * (baseR * 0.6);
            targetX = cx * 0.4;
            targetY = Math.cos(angle) * baseR;
            targetZ = cz;
            vX = -Math.sin(angle) * angSpeed * baseR * 0.4;
            vY = -Math.sin(angle) * angSpeed * baseR;
            vZ = Math.cos(angle) * angSpeed * baseR;
        }

        px[i] += (targetX - px[i]) * Math.min(1.0, dt * 8.0);
        py[i] += (targetY - py[i]) * Math.min(1.0, dt * 8.0);
        pz[i] += (targetZ - pz[i]) * Math.min(1.0, dt * 8.0);

        vx[i] = vX;
        vy[i] = vY;
        vz[i] = vZ;
    }
}
