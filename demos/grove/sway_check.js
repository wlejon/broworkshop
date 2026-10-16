// The grove's sway against physics: each level of a tree (trunk, limb,
// leafy spray) as the scene's vegetation shader moves it, beside a damped
// oscillator integrated under the same drag. Run in headless bro:
//
//   bro-headless demos/grove demos/grove/sway_check.js -- [wind=gusty]
//
// The terms are the grove's own, decoded from its branch tubes' vegetation
// records (broflora/sway.h), medians over the grove, at the drawn scale. The
// drag is (U / 10 m/s)^1.3 at a tree, U the scene's wind there (windAt) over
// 60 s of virtual time. The oscillator's drag also carries the turbulence
// the gust field does not resolve (15% above 0.1 Hz, a -5/3 spectrum), which
// the shader stands in for by ringing at each level's frequency. The
// shader's response is scene_vegetation.glsl's vegLevel, ported line for
// line (keep the two in step). Prints the terms, then per level the mean,
// RMS and speed of the tip's deflection along the wind (cm, cm/s) of each,
// and fails a level whose RMS or speed is off by more than 25%.
import { grove, scene, setWind, PLANT_SCALE } from "/app/grove.js";

const wind = (bro.app && bro.app.argv && bro.app.argv[0]) || 'gusty';
const SIGMA = 0.15;              // unresolved turbulence, as in the shader's VEG_TURBULENCE
const TURBULENCE = 0.051;        // VEG_TURBULENCE
const GUST_KICK = 0.4;           // VEG_GUST_KICK
const DAMPING = { trunk: 0.15, limb: 0.08, twig: 0.05 };

// --- the terms --------------------------------------------------------------------

const t = grove.world.emitBranchTubes({ sides: 6 });
const v = t.vegetation, F = [0.05, 50], S = [1e-5, 1], L = [0.005, 200];
const lv = (code, bits, r) => code === 0 ? 0 : r[0] * Math.exp((code - 1) / ((1 << bits) - 2) * Math.log(r[1] / r[0]));
const words = { trunk: new Map(), limb: new Map(), twig: new Map() };
for (let i = 0; i < t.segCount; i++) {
    const a = Math.round(v[i * 16 + 13]), b = Math.round(v[i * 16 + 14]), w = Math.round(v[i * 16 + 15]);
    if (w) words.trunk.set(w, [lv(w >> 12, 12, F), lv(w & 4095, 12, S), v[i * 16 + 3]]);
    if (b) words.limb.set(b, [lv(b >> 16, 8, F), lv((b >> 8) & 255, 8, S), lv(b & 255, 8, L)]);
    if (a & 0x3ffff) words.twig.set(a & 0x3ffff, [lv((a >> 12) & 63, 6, F), lv((a >> 6) & 63, 6, S), lv(a & 63, 6, L)]);
}
const levels = {};
for (const [name, m] of Object.entries(words)) {
    const r = [...m.values()].filter(x => x[1] > 0).sort((p, q) => p[0] - q[0]);
    if (!r.length) continue;
    const [f, sway, len] = r[Math.floor((r.length - 1) / 2)];
    // Drawn PLANT_SCALE larger: lengths grow, frequencies fall (f ~ d / L^2).
    levels[name] = { f: f / PLANT_SCALE, sway, L: len * PLANT_SCALE, zeta: DAMPING[name] };
    console.log(`${name}: ${r.length} distinct, median f ${(f / PLANT_SCALE).toFixed(2)} Hz, ` +
                `sway ${sway.toPrecision(3)} of ${(len * PLANT_SCALE).toFixed(2)} m at 10 m/s`);
}

// --- the drag -----------------------------------------------------------------------

setWind(wind);
const root = [6.5, 0, 9.5];
const fps = 120, seconds = 60, n = fps * seconds, t0 = 5;
const press = u => Math.pow(Math.max(u, 0) / 10, 1.3);
const p = [];
for (let i = 0; i < n; i++) {
    advanceTime(1000 / fps);
    p.push(press(scene.wind().now.speed + 4 * scene.windAt(root[0], root[2]).gust));
}
const at = time => p[Math.max(0, Math.min(n - 1, Math.round(time * fps)))];

// Unresolved turbulence: random-phase sinusoids, log-spaced 0.1-20 Hz, power ~ f^(-5/3).
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const comps = [];
for (let k = 0; k < 400; k++) {
    const f = 0.1 * Math.pow(200, k / 399);
    comps.push([f, Math.pow(f, -5 / 6) * Math.sqrt(f), rnd() * 2 * Math.PI]);
}
const turb = new Float32Array(n);
for (let i = 0; i < n; i++) {
    let s = 0;
    for (const [f, a, ph] of comps) s += a * Math.sin(2 * Math.PI * f * i / fps + ph);
    turb[i] = s;
}
const tr = Math.sqrt(turb.reduce((a, b) => a + b * b, 0) / n);
for (let i = 0; i < n; i++) turb[i] *= SIGMA / tr;

// --- the responses ------------------------------------------------------------------

const stats = s => {
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    const rms = Math.sqrt(s.reduce((a, b) => a + (b - m) * (b - m), 0) / s.length);
    let vs = 0;
    for (let i = 1; i < s.length; i++) vs += ((s[i] - s[i - 1]) * fps) ** 2;
    return { mean: m * 100, rms: rms * 100, speed: Math.sqrt(vs / (s.length - 1)) * 100 };
};
const fmt = s => `mean ${s.mean.toFixed(2)} rms ${s.rms.toFixed(2)} speed ${s.speed.toFixed(1)}`;
let failed = 0;
for (const [name, c] of Object.entries(levels)) {
    const shader = [];
    for (let i = t0 * fps; i < n; i++) {
        const time = i / fps;
        const p0 = at(time), p1 = at(time - 0.4), p2 = at(time - 1.3);
        const period = 1 / c.f;
        const lag = Math.min(0.25 * period, 1.3);
        const mean = lag < 0.4 ? p0 + (p1 - p0) * lag * 2.5 : p1 + (p2 - p1) * (lag - 0.4) / 0.9;
        const slow = Math.min(1, Math.max(0, (0.5 * period - 0.4) / 0.9));
        const kick = Math.abs(p0 - p1) + Math.abs(p1 - p2) * slow;
        const tu = TURBULENCE * mean * Math.pow(Math.max(c.f, 0.1), -1 / 3) / Math.sqrt(c.zeta);
        const gu = GUST_KICK * kick * Math.min(1, 1.25 * period);
        const ring = Math.SQRT2 * Math.sqrt(tu * tu + gu * gu);
        shader.push((mean + ring * Math.sin(2 * Math.PI * (c.f * time + 0.3))) * c.sway * c.L);
    }
    // x'' + 2 zeta w x' + w^2 x = w^2 (sway L drag), the drag with its turbulence.
    const w0 = 2 * Math.PI * c.f, sub = 40, dt = 1 / fps / sub;
    let x = 0, vel = 0;
    const ode = [];
    for (let i = 0; i < n; i++) {
        const target = c.sway * c.L * p[i] * (1 + turb[i]);
        for (let k = 0; k < sub; k++) {
            vel += (w0 * w0 * (target - x) - 2 * c.zeta * w0 * vel) * dt;
            x += vel * dt;
        }
        if (i >= t0 * fps) ode.push(x);
    }
    const a = stats(shader), b = stats(ode);
    const ok = Math.abs(a.rms / b.rms - 1) < 0.25 && Math.abs(a.speed / b.speed - 1) < 0.25;
    if (!ok) failed++;
    console.log(`${wind} ${name.padEnd(5)} shader ${fmt(a)} | oscillator ${fmt(b)} ${ok ? 'ok' : 'OFF'}`);
}
console.log(failed ? `sway_check: ${failed} level(s) off` : 'sway_check: ok');
