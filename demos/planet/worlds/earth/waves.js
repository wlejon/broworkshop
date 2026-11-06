// Earth's wind and its sea's waves, which the ground's shader draws
// (ground_mesh.bk reads them through planet::ground_layout).

export const DETAIL_PERIOD = 64;          // metres; the ground shader's fine detail repeats over it
export const SWELL_PERIOD = 1024;         // metres; and its long waves
export const WAVE_CLOCK = 1024;           // seconds the sea's waves repeat over
// The wind over the planet (ground_mesh.bk reads it from ground_layout as
// its lanes' direction): what each place's waves run down is its share
// along the ground there.
export const WIND = (() => { const w = [0.48, 0.36, -0.8], l = Math.hypot(...w); return w.map((c) => c / l); })();

// The sea's waves, a wind sea at about 7 m/s: from 256 m to half a metre,
// six a halving (each somewhere in its sixth: whole ratios between them
// would tile into a lattice), each a sinusoid of the shader's periodic
// coordinates (a whole number of waves along each axis of the period) in a
// direction spread about the wind, and its frequency the deep-water ω^2 = g k made a whole number
// over WAVE_CLOCK. Their slopes share Cox and Munk's mean square slope for
// that wind (0.003 + 0.00512 U), equally a halving above the peak (the
// saturation range: elevation ~ k^-3) and falling off past it as
// Pierson-Moskowitz does; what is shorter than the last is WAVE_RESIDUAL.
export const WAVES = (() => {
    const total = 0.003 + 0.00512 * 7, residual = 0.3 * total, peak = 60;
    let seed = 4242;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const list = [];
    for (let i = 0; i < 54; i++) {
        const lambda = 256 * 2 ** (-(i + rnd()) / 6);
        const period = lambda > 12 ? SWELL_PERIOD : DETAIL_PERIOD;
        const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
        // Down the wind, spread about it (a random direction's share added:
        // up to about 40 degrees off for the long waves, wider for the short
        // ones, which the wind's gusts turn), so crests run long across it.
        // (Directions all over the sphere crossed into a hatch of crests.)
        const spread = lambda > 4 ? 0.65 : 1.0;
        const d = [WIND[0] + spread * r * Math.cos(a), WIND[1] + spread * r * Math.sin(a), WIND[2] + spread * z];
        const dl = Math.hypot(...d);
        const n = d.map((c) => Math.round(c / dl * period / lambda));
        const k = 2 * Math.PI * Math.hypot(...n) / period;
        if (k === 0) continue;
        const omega = Math.round(Math.sqrt(9.81 * k) * WAVE_CLOCK / (2 * Math.PI)) * 2 * Math.PI / WAVE_CLOCK;
        list.push({ n, period, k, omega, shape: Math.exp(-1.25 * (2 * Math.PI / k / peak) ** 2) });
    }
    const sum = list.reduce((s, w) => s + w.shape, 0);
    // A sinusoid of slope amplitude s has mean square slope s^2 / 2.
    for (const w of list) w.slope = Math.sqrt(2 * (total - residual) * w.shape / sum);
    let tail = 0;
    for (let i = list.length - 1; i >= 0; i--) { tail += list[i].slope ** 2 / 2; list[i].tail = tail; }
    // Rivers and lakes are sheltered: no fetch for waves longer than a few
    // metres, and a breeze's ripples (Cox and Munk at 2 m/s, a mean square
    // slope of 0.0132) where the sea has its wind sea. They take the waves
    // from `fresh` on, 2 m and shorter, scaled with the residual to that
    // (from 4 m, the sun's glint on a river seen from over it was a few big
    // blotches; from 1 m, a lattice of the few waves left).
    const fresh = list.findIndex((w) => 2 * Math.PI / w.k <= 2);
    const freshScale = Math.sqrt((0.003 + 0.00512 * 2) / (list[fresh].tail + residual));
    return { list, residual, swell: list.filter((w) => w.period === SWELL_PERIOD).length, fresh, freshScale };
})();
