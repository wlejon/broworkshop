// Life-cycle stages for procedural plants.
//
// Plants now move through morphologically distinct stages instead of being
// uniformly scaled by a single age01. The age slider [0..1] is mapped onto
// each archetype's supported-stage list; within a stage we keep an
// intra-stage 0..1 parameter (`stageT`) so things still grow smoothly.
//
// Each archetype declares which stages it supports — annual flowers skip
// 'senescent', cactus skips 'senescent' too, grass skips fruit/flower as
// distinct stages, etc. The dispatcher in each recipe file looks up the
// matching builder and falls back to the closest implemented stage.

const STAGES = [
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

// Default ages for the UI's stage-jump click; centered in each stage's slice.
const STAGE_DEFAULT_AGES = {};
for (let i = 0; i < STAGES.length; i++) {
    STAGE_DEFAULT_AGES[STAGES[i]] = (i + 0.5) / STAGES.length;
}

// Map age01 ∈ [0,1] onto a list of supported stages and return:
//   stage      — name of the active stage
//   stageT     — 0..1 progress within the active stage
//   stageIdx   — index in the supported list
//   prevStage  — name of the previous stage (for blending), or null
//   blendT     — 0..1; <1 means we're in the morphology-fade-in zone of stage
//   nextStage  — name of the next stage (for blending), or null
//
// blendT < 1 only inside the first 15% of a stage; this lets recipes mix
// the previous stage's geometry with the current one so transitions don't
// pop. Most stages can ignore it and just key off `stage` + `stageT`.
function resolveStage(supportedStages, age01) {
    const N = supportedStages.length;
    if (N === 0) {
        return { stage: 'mature', stageT: 1, stageIdx: 0, prevStage: null,
                 nextStage: null, blendT: 1 };
    }
    const a = Math.max(0, Math.min(1, age01));
    // Edge case: at age01 == 1 we want the last stage at full progress.
    const f = a >= 1 ? N : a * N;
    const idx = Math.min(N - 1, Math.floor(f));
    const stageT = a >= 1 ? 1 : (f - idx);

    const FADE = 0.15;
    const blendT = stageT < FADE ? stageT / FADE : 1;
    const prevStage = idx > 0 ? supportedStages[idx - 1] : null;
    const nextStage = idx < N - 1 ? supportedStages[idx + 1] : null;
    return {
        stage: supportedStages[idx],
        stageT,
        stageIdx: idx,
        prevStage,
        nextStage,
        blendT,
    };
}

// Smoothstep helper (re-exported here to avoid circular dep with core).
function smoothstep01(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

// Pick the closest implemented stage builder when an archetype lacks one
// for the requested stage. Used by recipe dispatchers to gracefully
// fall back (e.g. fern asking for 'flowering' → uses 'mature').
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

export const Lifecycle = {
    STAGES,
    STAGE_INDEX,
    STAGE_DEFAULT_AGES,
    resolveStage,
    smoothstep01,
    nearestImplemented,
};
