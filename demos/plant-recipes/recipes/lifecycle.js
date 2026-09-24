// Life-cycle stages for procedural plants.
//
// Plants move through morphologically distinct stages instead of being
// uniformly scaled by a single age01. The age slider [0..1] is mapped onto
// each archetype's supported-stage list; within a stage an intra-stage 0..1
// parameter (`stageT`) keeps growth smooth.
//
// Each archetype declares which stages it supports (annual flowers skip
// 'senescent', cactus too, grass has no fruit, ...). defineArchetype() below
// turns a builder table + that list into the recipe function.

import { applySpecies } from "/app/recipes/species.js";

export const STAGES = [
    'seed',        // dormant or just-planted
    'sprout',      // first emergence; cotyledons or initial shoot
    'seedling',    // first true leaves; tiny stem
    'juvenile',    // recognizable plant form, no reproductive structures
    'mature',      // full vegetative form
    'flowering',   // mature + blooms
    'fruiting',    // mature + fruit / seed pods / hips / cones
    'senescent',   // autumn color, leaf drop, withering
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s, i]));

/**
 * Map age01 in [0,1] onto a list of supported stages:
 *   { stage, stageT (0..1 within it), stageIdx, prevStage, nextStage, blendT }
 * blendT < 1 only inside the first 15% of a stage, so a recipe can fade the
 * previous stage's geometry out; most ignore it.
 */
export function resolveStage(supportedStages, age01) {
    const N = supportedStages.length;
    if (N === 0) {
        return { stage: 'mature', stageT: 1, stageIdx: 0, prevStage: null, nextStage: null, blendT: 1 };
    }
    const a = Math.max(0, Math.min(1, age01));
    // At age01 == 1 the last stage is at full progress.
    const f = a >= 1 ? N : a * N;
    const idx = Math.min(N - 1, Math.floor(f));
    const stageT = a >= 1 ? 1 : (f - idx);
    const FADE = 0.15;
    return {
        stage: supportedStages[idx],
        stageT,
        stageIdx: idx,
        prevStage: idx > 0 ? supportedStages[idx - 1] : null,
        nextStage: idx < N - 1 ? supportedStages[idx + 1] : null,
        blendT: stageT < FADE ? stageT / FADE : 1,
    };
}

/** The age at the centre of `stage`'s slice of `supported` (-1 if absent). */
export function ageForStage(supported, stage) {
    const i = supported.indexOf(stage);
    return i < 0 ? -1 : (i + 0.5) / supported.length;
}

// The closest implemented stage builder when an archetype lacks one for the
// requested stage (fern asked for 'flowering' uses 'mature').
function nearestImplemented(stage, builders) {
    if (builders[stage]) return stage;
    const want = STAGE_INDEX[stage];
    let bestName = null, bestDist = Infinity;
    for (const name of Object.keys(builders)) {
        const d = Math.abs((STAGE_INDEX[name] ?? 99) - want);
        if (d < bestDist) { bestDist = d; bestName = name; }
    }
    return bestName;
}

/**
 * An archetype recipe: `build(opts)` merges the species preset under opts
 * (opts win), maps `opts.age01` onto the supported stages and runs that
 * stage's builder. `stagesOf(opts)` (species applied) lists the supported
 * stages; `opts.stagesOverride` replaces it. Returns `build`, carrying
 * `build.stages(opts)` so the UI's stage bar agrees with the builder.
 */
export function defineArchetype(name, builders, stagesOf) {
    const resolve = (opts) => {
        let o = Object.assign({}, opts);
        if (o.species) o = applySpecies(name, o.species, o);
        return o;
    };
    const stagesFor = (o) => o.stagesOverride || stagesOf(o);
    const build = (opts) => {
        const o = resolve(opts);
        const r = resolveStage(stagesFor(o), o.age01 ?? 1);
        return builders[nearestImplemented(r.stage, builders)](o, r.stageT);
    };
    build.stages = (opts) => stagesFor(resolve(opts));
    build.archetype = name;
    return build;
}
