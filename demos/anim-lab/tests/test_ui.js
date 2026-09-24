// The panel, driven by real clicks: tabs, the clip grid, the state graph,
// space buttons, the 2D pad presets, layer rows, cameras, keyboard shortcuts,
// and the readout reporting what the ENGINE is doing.

import { check, eq, frames, test, done, q, text, clickOn, setValue, press, shot } from "/lib/kit/test.js";
import { player, machine, cameras, character, overlay } from "/app/lab.js";
import { state, LAYER_ROWS } from "/app/actions.js";

frames(10);

const tab = (name) => {
    const r = q(`#tabs [data-tab="${name}"]`).getBoundingClientRect();
    check(r.right <= innerWidth, `tab ${name} is on screen`);
    clickOn(`#tabs [data-tab="${name}"]`);
    check(!q(`[data-pane="${name}"]`).hidden, `pane ${name} shown`);
};
const pane = (name) => q(`[data-pane="${name}"]`);

test('layout: side panel beside a sized viewport, status bar filled', () => {
    const vp = q('.k-viewport').getBoundingClientRect();
    const side = q('.k-side').getBoundingClientRect();
    check(vp.width > 1000 && vp.height > 600, 'viewport sized');
    check(side.left >= vp.right - 1, 'side panel on the right');
    eq(text('#stState'), 'idle', 'machine enters idle at boot');
    eq(text('#stCamera'), 'orbit');
    check(/^\d+$/.test(text('#fps')), 'fps readout: ' + text('#fps'));
});

test('tabs show one pane at a time', () => {
    check(!pane('machine').hidden && pane('clips').hidden, 'machine first');
    tab('clips');
    check(pane('machine').hidden && !pane('clips').hidden, 'clips shown');
    eq(q('#clipGrid').children.length, 14, 'a button per clip');
    eq(text('#clipCount'), '14 clips');
});

test('clip grid: a click plays the clip and suspends the machine', () => {
    clickOn('#clipGrid [data-clip="run"]');
    frames(10);
    eq(player.currentClip, 'run');
    check(q('#clipGrid [data-clip="run"]').classList.contains('active'), 'grid highlights it');
    eq(text('#stClip'), 'run', 'readout');
    eq(text('#stState'), '(suspended)');
    clickOn('#btnPause');
    frames(5);
    eq(text('#stPlaying'), 'no');
    press(' ');                       // Space resumes
    frames(5);
    eq(text('#stPlaying'), 'yes');
    setValue('#speed', 2);
    eq(player.speed, 2, 'speed slider');
    eq(text('#speedV'), '2.00×');
    setValue('#speed', 1);
});

test('crossfade panel blends into the chosen target', () => {
    setValue('#fadeTarget', 'walk');
    setValue('#fade', 0.5);
    eq(state.fadeTarget, 'walk');
    clickOn('#btnFade');
    frames(5);
    check(player.blendState().clips.length >= 2, 'mid-fade');
    frames(60);
    eq(player.currentClip, 'walk');
});

test('state graph: clicking a state travels; edges render from the machine', () => {
    tab('machine');
    eq(q('#stateEdges').children.length, machine.transitions.length, 'an edge per transition');
    clickOn('#stateNodes [data-state="idle"]');
    frames(10);
    eq(machine.state, 'idle');
    setValue('#stateSpeed', 2);
    frames(20);
    eq(machine.state, 'move', 'the speed slider drives the machine');
    check(q('#stateNodes [data-state="move"]').classList.contains('active'), 'graph lights move');
    check(q('#stateEdges .edge.fired') !== null, 'the fired edge is marked');
    check(q('#stateLog').children.length >= 1, 'transition logged');
    clickOn('#btnJump');
    frames(5);
    eq(machine.state, 'jump');
    clickOn('#btnClearLog');
    eq(q('#stateLog').children.length, 0, 'log cleared');
    setValue('#stateSpeed', 0);
    frames(150);
});

test('blend tab: space buttons, the speed axis and the pad presets', () => {
    tab('blend');
    clickOn('#spaceRow [data-space="locomotion"]');
    setValue('#speedAxis', 3);
    frames(40);                                      // past the 0.35 s fade in
    eq(state.base, 'locomotion');
    eq(q('#baseMix').children.length, 2, 'two mix bars mid-range');
    check(/Σ 1\.00/.test(text('#mixSum')), 'sum readout: ' + text('#mixSum'));
    check(/^pos \[3\.00\]/.test(text('#mixPhase')), 'pos readout: ' + text('#mixPhase'));

    clickOn('#spaceRow [data-space="directional"]');
    clickOn('#padPresets button:nth-child(3)');      // ↗
    frames(40);
    eq(text('#dirV'), '0.70, 0.70');
    eq(q('#baseMix').children.length, 3, 'a three-way mix');
    check(q('#padDot').style.left === '85%', 'dot follows: ' + q('#padDot').style.left);
});

test('layers tab: a row toggles a masked layer', () => {
    tab('layers');
    eq(q('#layerRows').children.length, 3);
    clickOn('#layerRows [data-slot="1"] input[type=checkbox]');
    frames(20);
    check(LAYER_ROWS[0].enabled, 'row enabled');
    eq(player.activeLayers().map((l) => l.slot).join(','), '1');
    eq(text('#layerSlots'), '1/3');
    check(/^3 bones/.test(text('#layerRows [data-slot="1"] .bones')), 'bone list');
    setValue('#layerRows [data-slot="1"] select:nth-of-type(1)', 'nod');
    eq(LAYER_ROWS[0].clip, 'nod', 'clip select');
});

test('motion + rig tabs: cameras, keys, overlay and skin toggles', () => {
    tab('motion');
    clickOn('#cameraRow [data-camera="follow"]');
    frames(5);
    eq(cameras.active, 'follow');
    press('3');
    frames(5);
    eq(text('#stCamera'), 'wide', 'key 3 cuts to wide');
    check(/^\[/.test(text('#camPos')), 'camera position readout');
    press('1');
    frames(5);
    eq(cameras.active, 'orbit');

    tab('rig');
    eq(text('#boneCount'), '20 bones');
    clickOn('#bonesOn');
    check(overlay.enabled, 'overlay on');
    clickOn('#skinOn');
    check(character.node.visible === false, 'skin hidden');
    clickOn('#skinOn');
});

test('screenshot: walking with the bone overlay and a wave layer', () => {
    tab('machine');
    clickOn('#stateNodes [data-state="idle"]');     // re-enter the suspended machine
    setValue('#stateSpeed', 1.8);
    frames(60);
    eq(text('#stState'), 'move');
    shot('walking');
});

done('anim-lab ui');
