// Render Lab: the HUD through real input: controls write `state`, readouts
// format, folding, the Space A/B key, buttons and click-to-place decals.
// Run: scripts/validate.sh demos/render-lab

import { check, eq, test, done, frames, setValue, text, clickOn, press, shot } from "/lib/kit/test.js";
import { scene, canvas, state } from "/app/lab.js";
import { decalCount } from "/app/decals.js";
import { shaderNodes } from "/app/shaders.js";

frames(30);

/** Scroll the HUD so `sel` is on screen, then click it for real. */
function tap(sel) {
    document.querySelector(sel).scrollIntoView({ block: 'center' });
    frames(1);
    clickOn(sel);
}

test('readouts are formatted from the markup at boot', () => {
    eq(text('#ssaoRadiusV'), '0.70');
    eq(text('#ssaoBiasV'), '0.025');
    eq(text('#fogDensityV'), '0.028');
    eq(text('#ssrStepsV'), '64');
    eq(text('#monitorStatus'), 'live');
    check(/^\d+ placed$/.test(text('#decalCount')), 'decal count shown');
});

test('the cullStats and LOD readouts fill in', () => {
    check(/^\d+ \/ \d+$/.test(text('#stMesh')), `meshes readout (${text('#stMesh')})`);
    check(/^\d+\/\d+\/\d+$/.test(text('#lodCounts')), `LOD counts (${text('#lodCounts')})`);
    check(/ fps$/.test(text('#fps')), 'fps readout');
});

test('sliders and selects write state and the scene', () => {
    setValue('#ssaoRadius', 1.5);
    eq(state.ssao.radius, 1.5);
    eq(text('#ssaoRadiusV'), '1.50');
    setValue('#msaa', '8');
    eq(state.msaa, 8);
    check(scene.msaa === 8, 'MSAA reached the scene');
    setValue('#msaa', '4');
    setValue('#fogColor', '0.10,0.12,0.18');
    eq(state.fog.color, [0.10, 0.12, 0.18]);
    setValue('#subScale', '0.5');
    eq(state.monitor.renderScale, 0.5);
    setValue('#subScale', '1');
});

test('only the active fog mode shows its sliders', () => {
    setValue('#fogMode', 'linear');
    check(!document.getElementById('fogLinear').hidden && document.getElementById('fogExp2').hidden, 'linear shows');
    setValue('#fogMode', 'exp2');
    check(document.getElementById('fogLinear').hidden && !document.getElementById('fogExp2').hidden, 'exp2 shows');
    setValue('#fogMode', 'off');
    check(document.getElementById('fogLinear').hidden && document.getElementById('fogExp2').hidden, 'off hides both');
});

test('a LUT selection reports its load', () => {
    setValue('#lutName', 'noir');
    eq(text('#lutStatus'), 'loaded');
    setValue('#lutName', '');
    eq(text('#lutStatus'), '');
});

test('Space flips the A/B master switch', () => {
    const before = decalCount();
    clickOn('#stage');                       // focus off the panel's checkboxes
    frames(2);
    press(' ');
    check(state.masterPost === false && !document.getElementById('masterPost').checked, 'A/B off');
    check(/OFF/.test(text('#masterHint')), 'the hint says so');
    press(' ');
    check(state.masterPost === true, 'A/B back on');
    check(decalCount() === before + 1, 'the focusing click on the stage placed a decal');
});

test('a panel caption folds its panel; its checkbox does not', () => {
    const panel = document.getElementById('dofOn').closest('.k-panel');
    const cap = panel.querySelector('h2');
    const r = cap.getBoundingClientRect();
    click(r.right - 20, r.top + r.height / 2);
    flush();
    check(panel.classList.contains('folded'), 'caption click folds');
    click(r.right - 20, r.top + r.height / 2);
    flush();
    check(!panel.classList.contains('folded'), 'and unfolds');
    clickOn('#dofOn');
    check(state.dof.enabled === true && !panel.classList.contains('folded'), 'the checkbox toggles DoF, not the fold');
    clickOn('#dofOn');
    check(state.dof.enabled === false, 'DoF off again');
});

test('clearShader() button strips the programs and unticks the boxes', () => {
    tap('#shaderClear');
    const sn = shaderNodes();
    check(!sn.dissolve.hasShader && !sn.wave.hasShader && !sn.rim.hasShader, 'programs cleared');
    check(!document.getElementById('rimOn').checked && state.shaders.rim.enabled === false, 'boxes unticked');
    tap('#rimOn');
    check(sn.rim.hasShader, 'ticking rim reinstalls it');
});

test('clear decals, then click the courtyard to stamp one', () => {
    tap('#decalClear');
    eq(decalCount(), 0);
    eq(text('#decalCount'), '0 placed');
    const r = canvas.getBoundingClientRect();
    click(r.left + r.width * 0.6, r.top + r.height * 0.75);
    flush();
    eq(decalCount(), 1, 'one decal from the click');
    eq(text('#decalCount'), '1 placed');
});

frames(10);
shot('hud');
done('render-lab hud');
