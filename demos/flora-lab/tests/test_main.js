// flora-lab: the worker grows the meadow and the page draws it; controls,
// layers, overlays and the time of day. Run: scripts/validate.sh demos/flora-lab
import { check, eq, test, done, frames, waitFor, q, text, clickOn, setValue, shot } from "/lib/kit/test.js";
import { view, layers, diagnostics, sky, triangles } from "/app/lab.js";
import { LAYERS } from "/app/layers.js";
import { OVERLAYS } from "/app/diagnostics.js";

const packets = (n) => { const want = view.packets + n; waitFor(() => view.packets >= want, n + ' packets', 30000); };

packets(3);

test('the worker grows four plants and the page draws them', () => {
    const t0 = view.stats.simTime;
    packets(4);
    eq(view.stats.plantCount, 4, 'plants');
    check(view.stats.simTime > t0, 'sim time advances');
    check(view.stats.moduleCount > 0, 'modules');
    check(layers.nodes.branches && layers.nodes.foliage, 'tube + scatter nodes');
    check(triangles() > 0, 'triangles counted');
    check(/plants\s*4/.test(text('#stats')), 'stats: ' + text('#stats'));
});

test('pause stops the sim, Step advances it once', () => {
    clickOn('#play');
    eq(view.playing, false);
    frames(10);
    const t = view.stats.simTime;
    frames(10);
    eq(view.stats.simTime, t, 'paused');
    clickOn('#step');
    packets(1);
    check(view.stats.simTime > t, 'stepped');
    clickOn('#play');
    eq(view.playing, true);
});

test('+ Seedling adds a plant, Reset returns to four', () => {
    clickOn('#seed');
    packets(2);
    eq(view.stats.plantCount, 5);
    clickOn('#reset');
    packets(1);
    eq(view.stats.plantCount, 4);
});

test('overlays: plant origins and the shadow grid draw wireframes', () => {
    clickOn('#layers input[data-layer="plantOrigins"]');
    clickOn('#layers input[data-layer="shadowGrid"]');
    packets(3);
    check(diagnostics.wires.plantOrigins && diagnostics.wires.plantOrigins.visible, 'origins drawn');
    check(view.shadow && view.shadow.length === 16 * 16 * 16, 'shadow snapshot');
    clickOn('#layers input[data-layer="plantOrigins"]');
    clickOn('#layers input[data-layer="shadowGrid"]');
    check(!diagnostics.wires.plantOrigins.visible, 'origins hidden');
});

test('impostors replace the full plant, and back', () => {
    clickOn('#layers input[data-layer="impostors"]');
    packets(1);
    eq([LAYERS.branches.on, LAYERS.foliage.on, LAYERS.blooms.on], [false, false, false], 'hot layers off');
    eq(q('#layers input[data-layer="branches"]').checked, false, 'panel follows');
    check(diagnostics.impostorQuads === 4, 'one quad per plant: ' + diagnostics.impostorQuads);
    clickOn('#layers input[data-layer="branches"]');
    eq(OVERLAYS.impostors.on, false, 'impostors off');
    clickOn('#layers input[data-layer="foliage"]');
    clickOn('#layers input[data-layer="blooms"]');
    packets(1);
    check(layers.nodes.branches.visible && layers.nodes.foliage.visible, 'plant back');
});

test('time of day', () => {
    eq(sky.current, 'golden', 'starts at golden hour');
    clickOn('#tod button[data-value="night"]');
    eq(sky.current, 'night');
    eq(sky.emissiveGain, 3.0, 'blooms glow at night');
    frames(5);
    shot('night');
    clickOn('#tod button[data-value="noon"]');
    eq(sky.current, 'noon');
});

test('sliders', () => {
    setValue('#timeScale', 3);
    eq(text('#timeScaleV'), '3.0×');
    setValue('#temp', 5);
    eq(text('#tempV'), '5.0 °C');
});

packets(2);
shot('main');
done('flora-lab');
