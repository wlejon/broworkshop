// patterns.js — the five motion patterns and the colour schemes.
//
// Each pattern moves the particle arrays (px/py/pz, vx/vy/vz) one step:
// update(particles, dt, time, config, field) where `field` is the world point
// of the mouse attractor (or null) and config carries speed / spread / noise /
// mouseMode. Velocities matter even for the parametric patterns: they orient
// the instances and drive the velocity colour scheme.

export const PATTERNS = {
    swarming: 'Swarming (boids flocking)',
    vortex:   'Vortex (dual spiral)',
    wave:     '3D wave (undulating field)',
    helix:    'Double helix (DNA flow)',
    pulsar:   'Galactic pulsar (orbital clusters)',
};

export const COLOR_SCHEMES = {
    cyberpunk: 'Cyberpunk neon',
    solar:     'Solar flare',
    ocean:     'Bioluminescent ocean',
    spectrum:  'Rainbow spectrum',
    velocity:  'Velocity heatmap',
};

// --- colours -------------------------------------------------------------------

function hsv(h, s, v, out, o) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const k = i % 6;
    out[o]     = k === 0 || k === 5 ? v : k === 1 ? q : k === 4 ? t : p;
    out[o + 1] = k === 1 || k === 2 ? v : k === 0 ? t : k === 3 ? q : p;
    out[o + 2] = k === 3 || k === 4 ? v : k === 2 ? t : k === 5 ? q : p;
}

/**
 * Write instance i's RGBA into out[o..o+3]. No allocation: this runs for
 * every instance every frame.
 */
export function writeColor(scheme, i, count, speed, x, y, z, phase, out, o) {
    const tNorm = i / Math.max(1, count);
    const sf = Math.min(1.0, speed / 8.0);
    out[o + 3] = 1.0;
    switch (scheme) {
        case 'solar': {                       // crimson -> orange -> gold -> white
            const heat = Math.min(1.0, sf * 0.7 + (Math.sin(phase + tNorm * 10) * 0.5 + 0.5) * 0.3);
            if (heat < 0.33) {
                const f = heat / 0.33;
                out[o] = 0.6 + 0.4 * f; out[o + 1] = 0.05 + 0.25 * f; out[o + 2] = 0.05;
            } else if (heat < 0.7) {
                const f = (heat - 0.33) / 0.37;
                out[o] = 1.0; out[o + 1] = 0.3 + 0.6 * f; out[o + 2] = 0.05 + 0.1 * f;
            } else {
                const f = (heat - 0.7) / 0.3;
                out[o] = 1.0; out[o + 1] = 0.9 + 0.1 * f; out[o + 2] = 0.15 + 0.75 * f;
            }
            return;
        }
        case 'ocean': {                       // deep indigo -> cyan -> seafoam
            const w = Math.sin(phase * 2 + x * 0.1 + z * 0.1) * 0.5 + 0.5;
            out[o] = 0.05 + 0.15 * w; out[o + 1] = 0.4 + 0.55 * w; out[o + 2] = 0.7 + 0.3 * (1.0 - w);
            return;
        }
        case 'spectrum':
            hsv((tNorm * 2.0 + phase * 0.2 + y * 0.03) % 1.0, 0.85, 0.95, out, o);
            return;
        case 'velocity': {                    // blue (slow) -> green -> yellow -> red (fast)
            const v = sf;
            if (v < 0.25) {
                const f = v / 0.25; out[o] = 0.1; out[o + 1] = 0.3 + 0.6 * f; out[o + 2] = 0.9;
            } else if (v < 0.5) {
                const f = (v - 0.25) / 0.25; out[o] = 0.1 + 0.4 * f; out[o + 1] = 0.9; out[o + 2] = 0.9 - 0.8 * f;
            } else if (v < 0.75) {
                const f = (v - 0.5) / 0.25; out[o] = 0.5 + 0.5 * f; out[o + 1] = 0.9 - 0.1 * f; out[o + 2] = 0.1;
            } else {
                const f = (v - 0.75) / 0.25; out[o] = 1.0; out[o + 1] = 0.8 - 0.6 * f; out[o + 2] = 0.1 + 0.4 * f;
            }
            return;
        }
        case 'cyberpunk':
        default: {                            // electric cyan <-> hot magenta
            const b = Math.sin(tNorm * Math.PI * 4 + phase + sf * 2.0) * 0.5 + 0.5;
            out[o] = 0.05 * (1 - b) + 0.98 * b; out[o + 1] = 0.88 * (1 - b) + 0.15 * b; out[o + 2] = 0.99 * (1 - b) + 0.85 * b;
        }
    }
}

// --- patterns ------------------------------------------------------------------

/** Boids-style flocking round three wandering cluster centres, with the mouse field. */
function swarm(P, dt, time, config, field) {
    const { count, px, py, pz, vx, vy, vz, phase } = P;
    const sm = config.speed, spread = config.spread * 24.0, noiseOn = config.noise;
    const active = config.mouseMode !== 'off' && field != null;
    const repel = config.mouseMode === 'repel';
    const mx = active ? field[0] : 0, my = active ? field[1] : 0, mz = active ? field[2] : 0;

    const cx = [Math.sin(time * 0.7) * spread * 0.6, Math.sin(time * 0.9 + 2.0) * spread * 0.7, Math.cos(time * 0.6 + 4.0) * spread * 0.65];
    const cy = [Math.cos(time * 0.5) * spread * 0.3, Math.sin(time * 0.8 + 1.0) * spread * 0.4, Math.sin(time * 0.4 + 3.0) * spread * 0.35];
    const cz = [Math.cos(time * 0.6) * spread * 0.6, Math.cos(time * 0.8 + 2.0) * spread * 0.7, Math.sin(time * 0.7 + 4.0) * spread * 0.65];

    for (let i = 0; i < count; i++) {
        let x = px[i], y = py[i], z = pz[i], dx = vx[i], dy = vy[i], dz = vz[i];
        const c = i % 3;
        const toX = cx[c] - x, toY = cy[c] - y, toZ = cz[c] - z;
        const d = Math.hypot(toX, toY, toZ) || 1;
        const k = 1.6 * dt * sm;
        // Pull toward the cluster plus a swirl round it.
        dx += (toX / d * 0.7 - toZ / d * 1.2) * k;
        dy += (toY / d * 0.9) * k;
        dz += (toZ / d * 0.7 + toX / d * 1.2) * k;

        if (noiseOn) {
            const p = phase[i] + time * 1.5;
            dx += Math.sin(p * 3.1 + y * 0.2) * 2.5 * dt * sm;
            dy += Math.cos(p * 2.7 + x * 0.2) * 2.0 * dt * sm;
            dz += Math.sin(p * 2.9 + z * 0.2) * 2.5 * dt * sm;
        }

        if (active) {
            const mdx = mx - x, mdy = my - y, mdz = mz - z;
            const md = Math.hypot(mdx, mdy, mdz) + 0.1;
            if (md < 35.0) {
                const f = (repel ? -45.0 : 35.0) / (md * 0.5 + 1.0) * dt * sm;
                dx += mdx / md * f; dy += mdy / md * f; dz += mdz / md * f;
            }
        }

        // Soft containment sphere.
        const rad = Math.hypot(x, y, z), maxRad = spread * 1.4;
        if (rad > maxRad) {
            const pull = (rad - maxRad) * 0.4 * dt;
            dx -= x / rad * pull; dy -= y / rad * pull; dz -= z / rad * pull;
        }

        // Damping, clamped to a speed band.
        const cur = Math.hypot(dx, dy, dz) || 0.001;
        const target = Math.min(16.0 * sm, Math.max(2.0 * sm, cur * (1.0 - dt * 0.8)));
        const s = target / cur;
        dx *= s; dy *= s; dz *= s;

        px[i] = x + dx * dt; py[i] = y + dy * dt; pz[i] = z + dz * dt;
        vx[i] = dx; vy[i] = dy; vz[i] = dz;
    }
}

/** Ease every particle toward a parametric target (tx, ty, tz) and set its velocity. */
function ease(P, i, tx, ty, tz, rate, dt) {
    const a = Math.min(1.0, dt * rate);
    P.px[i] += (tx - P.px[i]) * a;
    P.py[i] += (ty - P.py[i]) * a;
    P.pz[i] += (tz - P.pz[i]) * a;
}

/** A dual-armed tornado: radius widens up the funnel, spin quickens toward the eye. */
function vortex(P, dt, time, config) {
    const { count, vx, vy, vz, phase, baseAngle } = P;
    const sm = config.speed, spread = config.spread * 18.0;
    for (let i = 0; i < count; i++) {
        const p = phase[i];
        const arm = i % 2 === 0 ? 0 : Math.PI;
        const h = (p + time * 0.15 * sm) % 1.0;
        const y = (h - 0.5) * 32.0;
        const funnel = (0.25 + 0.75 * h) * spread;
        const r = funnel + Math.sin(p * 50.0 + time * 2.0) * 0.15 * funnel;
        const w = (2.2 / (0.3 + h)) * sm;
        const th = arm + baseAngle[i] + time * w + h * 6.0;
        ease(P, i, Math.cos(th) * r, y, Math.sin(th) * r, 10.0, dt);
        vx[i] = -Math.sin(th) * r * w;
        vy[i] = 32.0 * 0.15 * sm;
        vz[i] = Math.cos(th) * r * w;
    }
}

/** A square grid riding three summed waves, plus a ripple from the mouse field. */
function wave(P, dt, time, config, field) {
    const { count, px, py, pz, vx, vy, vz } = P;
    const sm = config.speed, spread = config.spread * 22.0;
    const active = config.mouseMode !== 'off' && field != null;
    const mx = active ? field[0] : 0, mz = active ? field[2] : 0;
    const side = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
        const u = ((i % side) / side - 0.5) * 2.0 * spread;
        const w = (Math.floor(i / side) / side - 0.5) * 2.0 * spread;
        const dc = Math.hypot(u, w);
        const ph = dc * 0.35 - time * 2.5 * sm;
        let ty = Math.sin(ph) * 3.5
               + Math.sin(u * 0.2 + time * 1.8 * sm) * Math.cos(w * 0.2 + time * 1.5 * sm) * 2.5
               + Math.cos(u * 0.4 - w * 0.3 + time * 3.0 * sm) * 1.2;
        if (active) {
            const dm = Math.hypot(u - mx, w - mz);
            ty += Math.sin(dm * 0.6 - time * 5.0 * sm) * Math.exp(-dm * 0.12) * 5.0;
        }
        const slope = Math.cos(ph) * 0.35 * 3.5 / (dc + 0.1);
        px[i] = u;
        py[i] += (ty - py[i]) * Math.min(1.0, dt * 12.0);
        pz[i] = w;
        vx[i] = -slope * u * 4.0;
        vy[i] = (ty - py[i]) / Math.max(1e-4, dt);
        vz[i] = -slope * w * 4.0;
    }
}

/** Two interleaved strands climbing a breathing helix. */
function helix(P, dt, time, config) {
    const { count, vx, vy, vz } = P;
    const sm = config.speed, k = config.spread;
    const turns = 6.0;
    for (let i = 0; i < count; i++) {
        const h = ((i / count) + time * 0.1 * sm) % 1.0;
        const y = (h - 0.5) * 40.0;
        const a = h * turns * Math.PI * 2 + (i % 2 === 0 ? 0 : Math.PI);
        const r = (3.5 + Math.sin(y * 0.2 + time * 2.0) * 0.8) * k;
        ease(P, i, Math.cos(a) * r, y, Math.sin(a) * r, 10.0, dt);
        vx[i] = -Math.sin(a) * r * turns * sm * 0.2;
        vy[i] = 40.0 * sm * 0.1;
        vz[i] = Math.cos(a) * r * turns * sm * 0.2;
    }
}

/** Three orbital planes (equatorial, inclined, polar) with a radial pulse. */
function pulsar(P, dt, time, config) {
    const { count, vx, vy, vz, phase, baseRadius, baseAngle } = P;
    const sm = config.speed, spread = config.spread * 20.0;
    const pulse = 1.0 + 0.25 * Math.sin(time * 3.0 * sm);
    for (let i = 0; i < count; i++) {
        const R = baseRadius[i] * spread * pulse;
        const w = (2.8 / Math.sqrt(0.4 + baseRadius[i])) * sm;
        const a = baseAngle[i] + time * w;
        const c = Math.cos(a), s = Math.sin(a);
        const plane = i % 3;
        if (plane === 0) {
            ease(P, i, c * R, Math.sin(a * 3.0 + phase[i]) * R * 0.15, s * R, 8.0, dt);
            vx[i] = -s * w * R; vy[i] = Math.cos(a * 3.0) * 3.0 * R * 0.15; vz[i] = c * w * R;
        } else if (plane === 1) {
            ease(P, i, c * R, s * R * 0.707 + Math.sin(phase[i] + time) * 0.5, s * R * 0.707, 8.0, dt);
            vx[i] = -s * w * R; vy[i] = c * w * R * 0.707; vz[i] = c * w * R * 0.707;
        } else {
            ease(P, i, c * R * 0.24, c * R, s * R * 0.6, 8.0, dt);
            vx[i] = -s * w * R * 0.4; vy[i] = -s * w * R; vz[i] = c * w * R;
        }
    }
}

const UPDATE = { swarming: swarm, vortex, wave, helix, pulsar };

/** Advance `particles` one step of `config.pattern`. */
export function stepPattern(particles, dt, time, config, field) {
    (UPDATE[config.pattern] || swarm)(particles, dt, time, config, field);
}
