// lib/destruct/dust.js — the dust things breaking raise, as a lit medium
// (dust.bk, a scene volume). Each dust event adds dust (n x r^3) to a puff:
// the puff it lands in, else a new one. A puff swells toward the size its
// dust fills, its density falling as it does, drifts on what threw it,
// rises a little while it is warm with motion, and settles out over half a
// minute.
//
// createDust(scene, { groundAt, max }) -> { add(ev), update(dt), setGlow(rgb), get count }
//   ev: { p, r, n, v } (destruct.js's 'dust' events)

const FLOATS = 8;

export function createDust(scene, { groundAt = () => -1e9, max = 128, sigma = 0.5, albedo = [0.62, 0.6, 0.56] } = {}) {
    const src = require('fs').readFileSync(bro.resolvePath('/lib/destruct/dust.bk'), 'utf8');
    const node = scene.createVolume({ module: src, file: 'lib/destruct/dust.bk', name: 'destruct_dust',
                                      uniforms: { count: 0, time: 0, sigma, pad: 0, albedo: [...albedo, 0], glow: [0, 0, 0, 0] } });
    const data = new Float32Array(max * FLOATS);
    const buf = bro.kernel.createBuffer(data.byteLength);
    buf.write(data);
    node.setShaderBuffer('puffs', buf);
    const puffs = [];
    let time = 0;

    const target = (P) => Math.min(45, Math.max(P.r0, 1.3 * Math.cbrt(P.mass)));

    function add(ev) {
        const mass = ev.n * ev.r * ev.r * ev.r * 0.05;
        const v = ev.v ?? [0, 0, 0];
        for (const P of puffs) {
            const d = Math.hypot(P.p[0] - ev.p[0], P.p[1] - ev.p[1], P.p[2] - ev.p[2]);
            if (d < P.r * 1.1 + ev.r) {
                const w = mass / (P.mass + mass);
                for (let k = 0; k < 3; k++) P.v[k] += (v[k] - P.v[k]) * w;
                P.mass += mass;
                P.heat = Math.min(1, P.heat + w);
                return;
            }
        }
        const P = { p: ev.p.slice(), v: v.slice(), r: ev.r, r0: ev.r, mass, heat: 1, seed: Math.random(), ground: groundAt(ev.p[0], ev.p[2]) };
        if (puffs.length >= max) {
            // Full: in place of the thinnest, unless this is thinner still.
            let best = -1, bd = Infinity;
            puffs.forEach((Q, i) => { const dn = Q.mass / Q.r ** 3; if (dn < bd) { bd = dn; best = i; } });
            if (mass / P.r ** 3 > bd) puffs[best] = P;
            return;
        }
        puffs.push(P);
    }

    function update(dt) {
        time += dt;
        for (let i = puffs.length - 1; i >= 0; i--) {
            const P = puffs[i];
            // Swells to what its dust fills, then on as the air mixes it in
            // (faster while it still churns).
            const rT = target(P);
            if (P.r < rT) P.r += (rT - P.r) * Math.min(1, dt / 2.5);
            P.r = Math.min(60, P.r + dt * (0.4 + 2.5 * P.heat));
            P.heat *= Math.exp(-dt / 6);
            const drag = Math.exp(-dt / 1.5);
            P.v[0] *= drag; P.v[2] *= drag;
            P.v[1] = P.v[1] * drag + 0.6 * P.heat * (1 - drag);
            for (let k = 0; k < 3; k++) P.p[k] += P.v[k] * dt;
            // A puff's lower edge rests on the ground: it spreads, not sinks.
            P.p[1] = Math.max(P.p[1], P.ground + P.r * 0.25);
            P.mass *= Math.exp(-dt / 18);
            if (P.mass / (0.96 * P.r ** 3) < 0.01) puffs.splice(i, 1);
        }
        const n = puffs.length;
        for (let i = 0; i < n; i++) {
            const P = puffs[i], o = i * FLOATS;
            data[o] = P.p[0]; data[o + 1] = P.p[1]; data[o + 2] = P.p[2]; data[o + 3] = P.r;
            data[o + 4] = Math.min(3, P.mass / (0.96 * P.r ** 3)); data[o + 5] = P.seed; data[o + 6] = P.ground; data[o + 7] = 0;
        }
        if (n) buf.write(data.subarray(0, n * FLOATS));
        node.setShaderUniform('count', n);
        node.setShaderUniform('time', time);
    }

    return {
        node, add, update,
        /** The light around the dust that is not the sun's or the sky's (rgb, radiance over pi: a city's at night). */
        setGlow(rgb) { node.setShaderUniform('glow', [rgb[0], rgb[1], rgb[2], 0]); },
        get count() { return puffs.length; },
    };
}
