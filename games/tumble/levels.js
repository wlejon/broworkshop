// Tumble campaign — eight levels, each introducing a tool, then Grand Tour.
//
// A level bundles:
//   spawner   world point the marbles drop from
//   goal      world AABB of the cup
//   bounds    inclusive cell-index volume the player may build in
//   budget    per-piece-type counts
//   par       gold / silver / bronze times in seconds
//   furniture pre-placed pieces the player cannot remove ({ type, cell, rot })
// plus spawn cadence (spawnInterval ms, maxMarbles) and failGraceMs, how long
// after the last marble drops a run may still score.

function mkLevel(def) {
    return Object.assign({
        gravity: -9.81,
        spawnInterval: 650,
        maxMarbles: 8,
        failGraceMs: 3500,
        furniture: [],
    }, def);
}

export const LEVELS = [
    // 1. Tutorial — spout over cup. Space alone scores; budget teaches placing.
    mkLevel({
        id: "drop-in",
        name: "Drop-In",
        tagline: "Press Space. Catch optional. Feel the drop.",
        spawner: { x: 0.5, y: 5.8, z: 0.5 },
        goal: { min: [-0.5, 0, -0.5], max: [1.5, 1.3, 1.5] },
        bounds: { x: [-2, 3], y: [0, 4], z: [-2, 2] },
        budget: { block: 3, ramp: 2 },
        par: { gold: 1.8, silver: 2.8, bronze: 4.5 },
        maxMarbles: 5,
        spawnInterval: 700,
    }),

    // 2. First real puzzle — short lateral hop. Spout west, cup east; the
    //    runway cells -4..-1 stay free of the cup.
    mkLevel({
        id: "plank",
        name: "Plank Walk",
        tagline: "Bridge the gap. Aim ramps or a booster east.",
        spawner: { x: -2.5, y: 5.5, z: 0.5 },
        goal: { min: [0.05, 0, -0.6], max: [2.0, 1.5, 1.6] },
        bounds: { x: [-4, 3], y: [0, 4], z: [-2, 2] },
        budget: { block: 2, ramp: 3, booster: 3 },
        par: { gold: 2.6, silver: 4.2, bronze: 7.5 },
        maxMarbles: 8,
        spawnInterval: 600,
        failGraceMs: 5500,
    }),

    // 3. Same-Z runway first (fair); walls there for bank-shot creativity.
    mkLevel({
        id: "bank",
        name: "Bank Shot",
        tagline: "Nudge around the walls. Feed the far cup.",
        spawner: { x: -3.5, y: 5.8, z: 0.5 },
        goal: { min: [1.2, 0, -0.6], max: [3.2, 1.45, 1.6] },
        bounds: { x: [-5, 4], y: [0, 5], z: [-3, 3] },
        budget: { block: 3, ramp: 2, wall: 3, booster: 5 },
        par: { gold: 3.0, silver: 4.8, bronze: 8.0 },
        failGraceMs: 6000,
    }),

    // 4. Bumpers + runway option.
    mkLevel({
        id: "bounce",
        name: "Springboard",
        tagline: "Bumpers hate ground control.",
        spawner: { x: -3.5, y: 6.0, z: 0.5 },
        goal: { min: [0.85, 0, -0.6], max: [3.0, 1.45, 1.6] },
        bounds: { x: [-5, 4], y: [0, 5], z: [-2, 3] },
        budget: { block: 3, ramp: 2, bumper: 3, wall: 2, booster: 5 },
        par: { gold: 3.0, silver: 5.0, bronze: 9.0 },
        failGraceMs: 6500,
    }),

    // 5. Chute funnel — spout over cup; free-fall works, a chute adds style.
    mkLevel({
        id: "chute",
        name: "Funnel Vision",
        tagline: "Wide mouth, narrow target.",
        spawner: { x: 0.5, y: 7.5, z: 0.5 },
        goal: { min: [-0.5, 0, -0.5], max: [1.5, 1.35, 1.5] },
        bounds: { x: [-3, 4], y: [0, 6], z: [-3, 4] },
        budget: { chute: 2, block: 4, ramp: 2 },
        par: { gold: 2.2, silver: 4.0, bronze: 7.0 },
        maxMarbles: 6,
    }),

    // 6. Long booster haul.
    mkLevel({
        id: "conveyor",
        name: "Long Haul",
        tagline: "Boosters do the talking.",
        spawner: { x: -4.5, y: 5.5, z: 0.5 },
        goal: { min: [0.7, 0, -0.6], max: [2.8, 1.45, 1.6] },
        bounds: { x: [-5, 4], y: [0, 4], z: [-2, 2] },
        budget: { block: 3, ramp: 2, booster: 6 },
        par: { gold: 3.2, silver: 5.2, bronze: 9.0 },
        failGraceMs: 7000,
    }),

    // 7. Spinners optional — the runway is still legal.
    mkLevel({
        id: "spin",
        name: "Helicopters",
        tagline: "Time the spinners, or just shove past them.",
        spawner: { x: -3.5, y: 5.8, z: 0.5 },
        goal: { min: [1.0, 0, -0.6], max: [3.0, 1.45, 1.6] },
        bounds: { x: [-4, 4], y: [0, 5], z: [-2, 2] },
        budget: { block: 3, ramp: 2, wall: 2, spinner: 2, booster: 5 },
        par: { gold: 3.2, silver: 5.5, bronze: 9.5 },
        spawnInterval: 550,
        maxMarbles: 9,
        failGraceMs: 6000,
    }),

    // 8. Finale — the full kit on a straight-ish runway.
    mkLevel({
        id: "gauntlet",
        name: "Grand Tour",
        tagline: "Every piece on the table. Finish the run.",
        spawner: { x: -4.5, y: 6.0, z: 0.5 },
        goal: { min: [1.0, 0, -0.6], max: [3.0, 1.5, 1.6] },
        bounds: { x: [-5, 4], y: [0, 5], z: [-3, 3] },
        budget: { block: 4, ramp: 3, wall: 2, bumper: 2, booster: 6, spinner: 1, chute: 1 },
        par: { gold: 3.8, silver: 6.5, bronze: 12.0 },
        spawnInterval: 550,
        maxMarbles: 10,
        failGraceMs: 7000,
    }),
];

/** "gold" | "silver" | "bronze" | "none" for a clear time in seconds. */
export function medalFor(time, level) {
    if (time <= level.par.gold) return "gold";
    if (time <= level.par.silver) return "silver";
    if (time <= level.par.bronze) return "bronze";
    return "none";
}

/** Seconds as "1.23s", or "—" for no time. */
export function fmt(t) {
    if (t == null || !isFinite(t)) return "—";
    return t.toFixed(2) + "s";
}

/** Centre of the cup on the XZ plane. */
export function goalCenter(level) {
    const g = level.goal;
    return { x: (g.min[0] + g.max[0]) * 0.5, z: (g.min[2] + g.max[2]) * 0.5 };
}
