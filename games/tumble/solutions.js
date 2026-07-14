// Verified solution layouts for the 8-level campaign.
// Applied via window.__tumble.applySolution(levelIdx) or tests.
//
// Conventions:
//   booster rot 0 = +X shove (follow the arrow)
//   booster rot 1 = +Z
//   ramp rot 2    = downhill +X
//
// Each entry: { name, note, pieces: [{ type, x, y, z, rot? }] }
// Empty pieces[] = free-fall / empty-board win.

export const SOLUTIONS = [
    {
        id: "drop-in",
        name: "Drop-In",
        note: "Tutorial free-fall — spout over cup. Space alone scores.",
        pieces: [],
    },
    {
        id: "plank",
        name: "Plank Walk",
        note: "Three boosters under the spout, arrows aimed +X (rot 0).",
        pieces: [
            { type: "booster", x: -3, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -2, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -1, y: 0, z: 0, rot: 0 },
        ],
    },
    {
        id: "bank",
        name: "Bank Shot",
        note: "Booster runway −4…0 aimed +X. Walls optional.",
        pieces: [
            { type: "booster", x: -4, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -3, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -2, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -1, y: 0, z: 0, rot: 0 },
            { type: "booster", x: 0, y: 0, z: 0, rot: 0 },
        ],
    },
    {
        id: "bounce",
        name: "Springboard",
        note: "Booster runway −4…0. Bumpers optional spice.",
        pieces: [
            { type: "booster", x: -4, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -3, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -2, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -1, y: 0, z: 0, rot: 0 },
            { type: "booster", x: 0, y: 0, z: 0, rot: 0 },
        ],
    },
    {
        id: "chute",
        name: "Funnel Vision",
        note: "Spout over cup — empty free-fall works. Chutes for gold polish.",
        pieces: [],
    },
    {
        id: "conveyor",
        name: "Long Haul",
        note: "Full booster chain −5…0 aimed +X.",
        pieces: [
            { type: "booster", x: -5, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -4, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -3, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -2, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -1, y: 0, z: 0, rot: 0 },
            { type: "booster", x: 0, y: 0, z: 0, rot: 0 },
        ],
    },
    {
        id: "spin",
        name: "Helicopters",
        note: "Booster runway −4…0. Spinners optional.",
        pieces: [
            { type: "booster", x: -4, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -3, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -2, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -1, y: 0, z: 0, rot: 0 },
            { type: "booster", x: 0, y: 0, z: 0, rot: 0 },
        ],
    },
    {
        id: "gauntlet",
        name: "Grand Tour",
        note: "Finale runway −5…0. Mix in any kit for style.",
        pieces: [
            { type: "booster", x: -5, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -4, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -3, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -2, y: 0, z: 0, rot: 0 },
            { type: "booster", x: -1, y: 0, z: 0, rot: 0 },
            { type: "booster", x: 0, y: 0, z: 0, rot: 0 },
        ],
    },
];

/**
 * Place solution pieces on the current run using a place(type,x,y,z,rot) fn.
 * @returns {{ placed: number, skipped: number, note: string, name: string }}
 */
export function applySolutionPieces(levelIdx, placeFn) {
    const sol = SOLUTIONS[levelIdx | 0];
    if (!sol) return { placed: 0, skipped: 0, note: "unknown level", name: "?" };
    let placed = 0;
    let skipped = 0;
    for (const p of sol.pieces) {
        if (placeFn(p.type, p.x, p.y, p.z, p.rot || 0)) placed++;
        else skipped++;
    }
    return { placed, skipped, note: sol.note, name: sol.name, id: sol.id };
}
