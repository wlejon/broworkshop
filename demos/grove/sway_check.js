// The grove's sway against physics: each level of a tree (trunk, limb,
// leafy spray) as the scene's vegetation shader moves it, beside a damped
// oscillator integrated under the same drag. Run in headless bro:
//
//   bro-headless demos/grove demos/grove/sway_check.js -- [wind=gusty]
//
// The terms are the grove's own, decoded from its branch tubes' vegetation
// records (broflora/sway.h), medians over the grove, at the drawn scale. The
// drag is (U / 10 m/s)^1.3 at a tree, U the wind field there (sway.js's
// dragAt, the shader's vegDragAt) over 60 s of wind clock. The oscillator's
// drag also carries the turbulence the gust field does not resolve (a -5/3
// spectrum above 0.1 Hz: 15% at the trunk, 40% through the crown, where the
// shader's VEG_CROWN_TURBULENCE doubles VEG_TURBULENCE), which the shader
// stands in for by ringing near each level's frequency. The shader's
// response is lib/kit/sway.js's levelDrive (scene_vegetation.glsl's, line
// for line), each level fed as vegPose feeds it: the trunk the drag at the
// root a quarter period back, a limb or twig its own. Prints the terms,
// then per level the mean, RMS and speed of the tip's deflection along the
// wind (cm, cm/s) of each, and fails a level whose RMS or speed is off by
// more than 25%.
import { grove, scene, setWind, PLANT_SCALE } from "/app/grove.js";
import * as sway from "/lib/kit/sway.js";

const wind = (bro.app && bro.app.argv && bro.app.argv[0]) || 'gusty';
const SIGMA = { trunk: 0.15, limb: 0.40, twig: 0.40 };
const TURB = { trunk: sway.TURBULENCE, limb: sway.CROWN_TURBULENCE, twig: sway.CROWN_TURBULENCE };
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
    const [f, sw, len] = r[Math.floor((r.length - 1) / 2)];
    // Drawn PLANT_SCALE larger: lengths grow, frequencies fall (f ~ d / L^2).
    levels[name] = { freq: f / PLANT_SCALE, sway: sw, len: len * PLANT_SCALE };
    console.log(`${name}: ${r.length} distinct, median f ${(f / PLANT_SCALE).toFixed(2)} Hz, ` +
                `sway ${sw.toPrecision(3)} of ${(len * PLANT_SCALE).toFixed(2)} m at 10 m/s`);
}

// --- the drag -----------------------------------------------------------------------

setWind(wind);
const params = scene.wind();
const root = [6.5, 0, 9.5];
const fps = 120, seconds = 60, n = fps * seconds, t0 = 5, T0 = params.time;
const ws = (i) => sway.windStateAt(params, T0 + i / fps);
const p = [];
for (let i = 0; i < n; i++) { const s = ws(i); p.push(sway.dragAt(s, root[0], root[2], s.t)); }

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
    const zeta = DAMPING[name];
    const shader = [];
    for (let i = t0 * fps; i < n; i++) {
        const s = ws(i);
        // The plant's wind (the trunk's lag and kick span), then this level's drag.
        const w = sway.vegWind(s, root, levels.trunk ? levels.trunk.freq : c.freq);
        const mean = name === 'trunk' ? w.trunk : sway.dragAt(s, root[0], root[2], s.t - sway.lagOf(c.freq), true);
        const x = sway.levelDrive(c, zeta, TURB[name], 0.3, mean, w.kick, w, 0);
        shader.push(x[0] * w.dir[0] + x[2] * w.dir[2]);
    }
    // x'' + 2 zeta w x' + w^2 x = w^2 (sway L drag), the drag with its turbulence.
    const w0 = 2 * Math.PI * c.freq, sub = 40, dt = 1 / fps / sub;
    let x = 0, vel = 0;
    const ode = [];
    for (let i = 0; i < n; i++) {
        const target = c.sway * c.len * p[i] * (1 + SIGMA[name] * turb[i] / tr);
        for (let k = 0; k < sub; k++) {
            vel += (w0 * w0 * (target - x) - 2 * zeta * w0 * vel) * dt;
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
