// Headless validation — iterate every (archetype, species, stage), assert
// the recipe runs without error and returns reasonable geometry. Used by:
//
//   bro-headless ../broworkshop/demos/flora demos/flora/test_lifecycle.js
//
// On failure, prints offending combinations and exits nonzero.

const STAGE_NAMES = ['seed','sprout','seedling','juvenile','mature','flowering','fruiting','senescent'];

function ageForStage(supportedStages, stageName) {
    const idx = supportedStages.indexOf(stageName);
    if (idx < 0) return -1;
    return (idx + 0.5) / supportedStages.length;
}

const archetypes = Object.keys(Recipes).filter((k) => typeof Recipes[k] === 'function'
    && k !== 'resolveStage' && k !== 'speciesList');

console.log('archetypes:', archetypes);

let totalChecks = 0;
let failures = [];

for (const arch of archetypes) {
    const speciesList = Recipes.speciesList(arch) || [];
    const list = speciesList.length > 0 ? speciesList : [''];
    for (const species of list) {
        // Build a probe options object similar to what the app would send.
        const probeOpts = { age01: 1, seed: 12345, species: species || undefined };
        // Resolve which stages this archetype supports for this species —
        // we just try all 8 standard stage names; missing ones fall back
        // to the dispatcher's nearest implementation, which is correct.
        for (const stage of STAGE_NAMES) {
            const opts = Object.assign({}, probeOpts);
            // Try to use Recipes._TreeStages for tree's flowering stage list,
            // otherwise just place age uniformly over 8 stages.
            opts.age01 = (STAGE_NAMES.indexOf(stage) + 0.5) / STAGE_NAMES.length;
            totalChecks++;
            try {
                const result = Recipes[arch](opts);
                if (!result || !result.parts) {
                    failures.push({ arch, species, stage, error: 'no parts' });
                    continue;
                }
                let triCount = 0;
                for (const p of result.parts) {
                    if (p.mesh && p.mesh.triangleCount !== undefined) triCount += p.mesh.triangleCount;
                }
                if (triCount === 0) {
                    failures.push({ arch, species, stage, error: 'zero tris', parts: result.parts.length });
                } else if (triCount > 1500000) {
                    failures.push({ arch, species, stage, error: 'too many tris', tris: triCount });
                }
            } catch (e) {
                failures.push({ arch, species, stage, error: 'exception: ' + e.message });
            }
        }
    }
}

console.log(`checked ${totalChecks} (archetype, species, stage) combinations`);
console.log(`failures: ${failures.length}`);
for (const f of failures) {
    console.log(`  ${f.arch}/${f.species || '(none)'}/${f.stage}: ${f.error}` + (f.tris ? ` (${f.tris} tris)` : ''));
}

assert(failures.length === 0, `${failures.length} validation failures`);

// ── Screenshot pass ───────────────────────────────────────────────────────
// One screenshot per archetype showing the mature stage of its primary
// species. Quick visual smoke test — all the per-stage detail can be
// inspected interactively in windowed mode.

console.log('taking representative screenshots...');
for (const arch of archetypes) {
    const speciesList = Recipes.speciesList(arch) || [];
    const species = speciesList[0] || '';
    __floraSetState({
        archetype: arch,
        species: species,
        age: 0.6,         // somewhere in mature/flowering for most archetypes
        seed: 42,
    });
    __floraRegenerate();
    flush();
    advanceTime(60);
    const path = `flora_${arch}.png`;
    try {
        screenshot(path);
        console.log(`  wrote ${path}`);
    } catch (e) {
        console.log(`  failed ${path}: ${e.message}`);
    }
}

// Lifecycle strip: rosebush across all 8 stages (the headline feature).
console.log('taking rosebush life-cycle screenshots...');
for (let i = 0; i < STAGE_NAMES.length; i++) {
    const age = (i + 0.5) / STAGE_NAMES.length;
    __floraSetState({ archetype: 'rosebush', species: 'tea', age, seed: 7 });
    __floraRegenerate();
    flush();
    advanceTime(60);
    const path = `flora_rosebush_${STAGE_NAMES[i]}.png`;
    try {
        screenshot(path);
        console.log(`  wrote ${path}`);
    } catch (e) {
        console.log(`  failed ${path}: ${e.message}`);
    }
}

console.log('flora validation complete');
