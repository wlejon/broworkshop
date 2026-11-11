// Vertex-level fallback coat colour for the green spiny iguana (used at coarse
// crowd LODs where per-pixel coat.bk / face.bk are bypassed). Matches coat.bk's
// emerald-turquoise dorsal shading, pale chartreuse-cream belly, terracotta
// dewlap & dorsal crest blush, charcoal tail rings, and dark claws.

const mix = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
];
const smoothstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1e-6)));
    return t * t * (3 - 2 * t);
};

const EMERALD = [0.18, 0.53, 0.25];
const TURQUOISE = [0.16, 0.56, 0.45];
const CHARTREUSE = [0.74, 0.80, 0.50];
const TERRACOTTA = [0.78, 0.37, 0.15];
const CHARCOAL = [0.10, 0.12, 0.10];
const PALE_JADE = [0.52, 0.73, 0.46];
const CLAW = [0.08, 0.075, 0.07];

export function coat(p, n, share) {
    const [x, y, z] = p;
    const ax = Math.abs(x);

    // Base emerald-to-turquoise gradient from dorsum to mid-flank & head.
    const headTurq = smoothstep(0.28, 0.39, z) * 0.55;
    const flankTurq = smoothstep(0.22, 0.15, y) * (1 - smoothstep(0.14, 0.10, y)) * 0.42;
    let c = mix(EMERALD, TURQUOISE, Math.min(1, headTurq + flankTurq));

    // Warm chartreuse-cream ventral countershading on belly, throat and limb undersides.
    const bellyLine = 0.140 + 0.025 * smoothstep(0.24, 0.38, z);
    const ventral = smoothstep(bellyLine + 0.022, bellyLine - 0.018, y)
        * smoothstep(-0.14, -0.02, z)
        * (1 - smoothstep(0.06, 0.13, ax));
    c = mix(c, CHARTREUSE, 0.82 * Math.max(ventral, Math.max(0, -n[1]) * 0.35 * smoothstep(-0.15, 0.35, z)));

    // Smoky dorsal saddle bars over the trunk.
    if (z > -0.08 && z < 0.28 && y > 0.145) {
        const barPhase = Math.sin((z + 0.06) * 58.0 + 0.18 * y * 25.0);
        const bar = smoothstep(0.42, 0.82, barPhase) * smoothstep(0.145, 0.195, y) * (1 - smoothstep(0.055, 0.085, ax));
        c = mix(c, CHARCOAL, 0.62 * bar);
    }

    // Bold alternating charcoal-slate and pale-jade rings along the whip tail.
    if (z < -0.11) {
        const u = Math.min(1, (-0.11 - z) / 0.80);
        const ringWave = Math.sin((-0.11 - z) * 52.0 - 0.35 * y * 18.0);
        const darkBand = smoothstep(0.08, 0.42, ringWave);
        const ringCol = mix(PALE_JADE, CHARCOAL, darkBand);
        const onTail = smoothstep(-0.10, -0.15, z);
        c = mix(c, ringCol, onTail * (0.78 + 0.18 * u));
        c = mix(c, CHARCOAL, 0.45 * smoothstep(0.72, 0.98, u));
    }

    // Terracotta-amber blush on gular dewlap fan and dorsal crest tips.
    const dew = share('dewlapFan') + share('dewlapRim');
    if (dew > 0.01) {
        const lobe = smoothstep(0.195, 0.135, y) + 0.45 * smoothstep(0.355, 0.395, z);
        c = mix(c, TERRACOTTA, Math.min(0.85, dew * (0.38 + 0.48 * lobe)));
    }
    if (y > 0.232 && ax < 0.012 && z > -0.45 && z < 0.37) {
        const tip = smoothstep(0.234, 0.258, y);
        c = mix(c, TERRACOTTA, 0.80 * tip);
    }

    // Dark keratin claws on hands and feet.
    let clawShare = 0;
    for (let d = 0; d < 5; d++) {
        clawShare += share(`fClawL${d}`) + share(`fClawR${d}`) + share(`hClawL${d}`) + share(`hClawR${d}`);
    }
    if (clawShare > 0.05 || (y < 0.008 && ax > 0.11)) {
        c = mix(c, CLAW, Math.min(0.95, clawShare * 1.3));
    }

    return c;
}
