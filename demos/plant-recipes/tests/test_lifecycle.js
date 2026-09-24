// Plant Recipes: every (archetype, species, stage) recipe builds sane
// geometry, and the viewer's panel, stage bar, species presets and forest
// mode drive it. Run: scripts/validate.sh demos/plant-recipes
import { check, eq, test, done, frames, q, text, clickOn, setValue, shot } from "/lib/kit/test.js";
import { ARCHETYPES, STAGES, speciesList } from "/app/recipes/index.js";
import { ageForStage } from "/app/recipes/lifecycle.js";
import { state, view, setState, setMode, supportedStages, regenerate, sky, cycle } from "/app/lab.js";

frames(5);

// The panel row whose label starts with `label`.
const field = (label) => [...document.querySelectorAll('#params .k-field')].find((r) => r.textContent.startsWith(label));

test('matrix: every archetype x species x stage builds 1..1.5M triangles', () => {
    const failures = [];
    let n = 0;
    for (const arch of Object.keys(ARCHETYPES)) {
        const list = speciesList(arch);
        for (const species of list.length ? list : ['']) {
            for (let i = 0; i < STAGES.length; i++) {
                n++;
                try {
                    const r = ARCHETYPES[arch]({ age01: (i + 0.5) / STAGES.length, seed: 12345, species: species || undefined });
                    const tris = (r && r.parts || []).reduce((s, p) => s + (p.mesh ? p.mesh.triangleCount : 0), 0);
                    if (!(tris > 0 && tris < 1500000)) failures.push(arch + '/' + species + '/' + STAGES[i] + ': ' + tris + ' tris');
                } catch (e) {
                    failures.push(arch + '/' + species + '/' + STAGES[i] + ': ' + e.message);
                }
            }
        }
    }
    console.log('  checked ' + n + ' combinations');
    eq(failures, [], 'failures');
});

test('stages: species decides whether a tree blooms', () => {
    eq(ARCHETYPES.tree.stages({ species: 'oak' }).includes('flowering'), false, 'oak');
    eq(ARCHETYPES.tree.stages({ species: 'cherry' }).includes('flowering'), true, 'cherry');
    eq(ARCHETYPES.rosebush.stages({}), STAGES, 'rosebush has all eight');
});

test('boot: single tree with a stats line and a stage bar', () => {
    eq(view.mode, 'single');
    eq(state.archetype, 'tree');
    check(view.parts > 0 && view.tris > 0, 'plant built');
    check(/tree · oak · .* tris/.test(text('#status')), 'status: ' + text('#status'));
    eq(document.querySelectorAll('#stage-bar button').length, 8, 'eight pills');
});

test('species preset loads into the panel', () => {
    setState({ species: 'birch' });
    eq(state.canopyShape, 'oval', 'birch canopy from the preset');
    eq(state.bloomColor, null, 'birch has no bloom');
    check(!supportedStages().includes('flowering'), 'birch: no flowering pill');
    eq(field('canopy shape').querySelector('select').value, 'oval', 'control shows the preset');
    eq(field('bloom color').querySelector('.k-val').textContent, 'none', 'no bloom colour');
    setState({ species: 'cherry' });
    check(supportedStages().includes('flowering'), 'cherry blooms');
});

test('stage pill jumps the age to its stage', () => {
    setState({ archetype: 'rosebush', species: 'tea' });
    clickOn('#stage-bar button[data-stage="flowering"]');
    frames(1);
    eq(state.age, ageForStage(STAGES, 'flowering'));
    check(q('#stage-bar button[data-stage="flowering"]').classList.contains('active'), 'pill active');
});

test('a slider rebuilds the plant', () => {
    const before = view.tris;
    setValue(field('petal count').querySelector('input'), 20);
    frames(2);
    eq(state.petalCount, 20);
    check(view.tris !== before, 'geometry changed: ' + before + ' -> ' + view.tris);
});

test('forest mode lays out many plants', () => {
    clickOn('#mode button[data-value="forest"]');
    frames(1);
    eq(view.mode, 'forest');
    setState({ archetype: 'tree' });
    check(/^forest · \d+ trees/.test(view.stats), view.stats);
    check(view.parts > 32, 'many parts: ' + view.parts);
    setState({ count: 6, archetype: 'conifer' });
    check(/^forest · [1-6] conifers?/.test(view.stats), view.stats);
    setMode('single');
});

test('time of day switches the rig', () => {
    clickOn('#tod button[data-value="night"]');
    eq(sky.current, 'night');
    clickOn('#tod button[data-value="studio"]');
    eq(sky.current, 'studio');
});

test('cycle animates the age', () => {
    const a0 = state.age;
    clickOn('#anim');
    frames(20);
    check(cycle.on && state.age !== a0, 'age moved');
    clickOn('#anim');
    check(!cycle.on, 'stopped');
});

// Representative shots: one per archetype, then the rose bush's eight stages.
for (const arch of Object.keys(ARCHETYPES)) {
    setState({ archetype: arch, species: speciesList(arch)[0] || '', age: 0.6, seed: 42 });
    frames(3);
    shot(arch);
}
for (const s of STAGES) {
    setState({ archetype: 'rosebush', species: 'tea', age: ageForStage(STAGES, s), seed: 7 });
    frames(3);
    shot('rosebush-' + s);
}
regenerate(true);
done('plant-recipes');
