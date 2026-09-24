// test_smoke.js — WAAPI Lab, driven through its own controls and asserted on
// the Animation objects and the DOM that reads them back.
//
// Run: scripts/validate.sh demos/waapi-lab
//
// Virtual time: advanceTime(ms) moves document.timeline, WAAPI, CSS animations
// and rAF together, so every number below is deterministic.

import { test, check, eq, near, frames, clickOn, shot, done } from '/lib/kit/test.js';
import { lab, loadPreset, applyTiming, refresh } from '/app/lab.js';
import { ctl, seek } from '/app/waapi.js';
import { parseEasing, ease } from '/app/plotter.js';
import { rotationOf } from '/app/compare.js';

const $ = (id) => document.getElementById(id);
const row = (id, i) => $(id).children[i];
const val = (id, i) => row(id, i).lastChild.textContent;
const choose = (sel, v) => { $(sel).value = v; $(sel).dispatchEvent(new Event('change')); flush(); };

frames(4);

test('boots on the kit with the first preset running', () => {
    check(document.body.classList.contains('k-app'), 'body.k-app');
    eq($('status').textContent, 'ready', 'status');
    eq(lab.presetId, 'elastic-pop', 'preset');
    check(!$('target-badge').hidden && $('target-card').hidden, 'only the badge is on stage');
    eq(ctl.primary.playState, 'running', 'playState');
    eq($('stateChip').textContent, 'running', 'state chip');
    eq($('kfTrack').children.length, 4, 'one marker per keyframe');
    check($('keyframeJson').textContent.indexOf('computedOffset') > 0, 'keyframes come from getKeyframes()');
});

test('engine support is probed, not asserted', () => {
    const s = lab.support;
    eq(s.animate, true, 'animate');
    eq(s.keyframeEasing, 'yes', 'per-keyframe easing');
    eq(s.finishInfinite, 'InvalidStateError', 'finish() on infinite throws per spec');
    eq(s.steps, 'yes', 'steps() is a staircase');
    eq(s.stepsReportedAs, 'steps(4)', 'getTiming().easing reads it back');
    eq(s.updatePlaybackRate, true, 'updatePlaybackRate');
    eq(s.commitStyles, true, 'commitStyles');
    eq(s.persist, true, 'persist');
    eq(s.updateTiming, true, 'effect.updateTiming');
    eq(s.cssAnimations, 'yes', 'CSS animations are CSSAnimations in getAnimations()');
    eq(s.cssLayers, 'yes', 'every layer of a comma list runs');
    eq($('support').children.length, 12, 'support rows');
    // Every row lit but `pending`, which is always false by design.
    const keys = Object.keys(s);
    for (let i = 0; i < $('support').children.length; i++) {
        const lit = row('support', i).classList.contains('on');
        const label = row('support', i).firstChild.textContent;
        if (label === 'anim.pending') check(!lit, 'pending row unlit');
        else check(lit, 'row lit: ' + label + ' = ' + val('support', i));
    }
    check(keys.length === 12, 'twelve probes');
});

test('telemetry is the engine progress, and it sits on the requested curve', () => {
    lab.trail = [];
    for (let i = 0; i < 40; i++) { advanceTime(16); refresh(); }
    const t = ctl.primary.effect.getComputedTiming();
    eq(val('telemetry', 3), t.progress.toFixed(3), 'progress row = getComputedTiming().progress');
    check(lab.trail.length >= 30, 'trail sampled: ' + lab.trail.length);
    const e = parseEasing(lab.easing);
    for (const s of lab.trail) near(s.y, ease(e, s.x), 0.01, 'sample on the bezier at x=' + s.x.toFixed(3));
    check(row('plotReadout', 2).classList.contains('on'), 'deviation row green');
});

test('steps(): the measured curve is the staircase', () => {
    choose('presetSelect', 'glitch-shake');
    check(!$('target-glitchBanner').hidden, 'glitch on stage');
    check($('presetNote').hidden, 'no gap to explain');
    lab.trail = [];
    for (let i = 0; i < 50; i++) { advanceTime(16); refresh(); }
    const dev = parseFloat(val('plotReadout', 2));
    check(dev <= 0.02, 'measured progress sits on steps(6): ' + dev);
    eq(val('plotReadout', 1), 'steps(6)', 'engine reports steps(6)');
    check(row('plotReadout', 2).classList.contains('on'), 'deviation row green');
    // Only whole steps: every sampled progress is a multiple of 1/6.
    for (const s of lab.trail) near(s.y * 6, Math.round(s.y * 6), 1e-4, 'progress on a step: ' + s.y);
    shot('steps');
});

test('transport: pause, play, seek, rate, reverse', () => {
    loadPreset('neon-hyperspace');
    frames(5);
    clickOn('#btnPlay');
    eq(ctl.primary.playState, 'paused', 'paused');
    eq($('btnPlay').textContent, 'Play', 'button label');
    const at = ctl.primary.currentTime;
    frames(10);
    eq(ctl.primary.currentTime, at, 'paused time holds');
    refresh();
    eq($('stateChip').textContent, 'paused', 'chip');

    seek(0.5);
    near(ctl.primary.currentTime, 750, 1e-6, 'seek to half of 1500 ms');
    refresh();
    eq($('scrub').value, '500', 'scrubber follows');

    clickOn('#btnPlay');
    eq(ctl.primary.playState, 'running', 'running again');
    clickOn('#rates [data-value="2"]');
    eq(ctl.primary.playbackRate, 2, 'rate applied');
    const t0 = ctl.primary.currentTime;
    advanceTime(100); flush();
    near(ctl.primary.currentTime - t0, 200, 20, '2x advances twice as fast');
    refresh();
    eq($('rateChip').textContent, '2x', 'rate chip');

    clickOn('#btnReverse');
    eq(ctl.primary.playbackRate, -2, 'reverse flips the rate');
    const lit = $('rates').querySelector('.active');
    check(!lit || lit.dataset.value === '-2', 'no stale rate button stays lit');
    clickOn('#rates [data-value="1"]');
});

test('finish(): infinite throws (reported), finite finishes and fires onfinish', () => {
    loadPreset('elastic-pop');
    clickOn('#btnFinish');
    check(/InvalidStateError/.test($('status').textContent), 'status explains: ' + $('status').textContent);
    check($('events').textContent.indexOf('InvalidStateError') >= 0, 'event log row');

    choose('timingIterations', '1');
    eq(ctl.primary.effect.getTiming().iterations, 1, 're-ran with one iteration');
    clickOn('#btnFinish');
    frames(2);
    eq(ctl.primary.playState, 'finished', 'finished');
    check($('events').textContent.indexOf('finish (elastic-pop)') >= 0, 'onfinish logged');
    choose('timingIterations', 'Infinity');
});

test('cancel goes idle and Play restarts', () => {
    clickOn('#btnCancel');
    eq(ctl.primary.playState, 'idle', 'idle');
    check(ctl.primary.currentTime === null, 'currentTime null');
    check($('events').textContent.indexOf('cancel (elastic-pop)') >= 0, 'oncancel logged');
    clickOn('#btnPlay');
    eq(ctl.primary.playState, 'running', 'restarted');
});

test('timing form: direction reaches getComputedTiming', () => {
    choose('timingDirection', 'reverse');
    choose('timingDuration', '1000');
    advanceTime(250); flush();
    const ct = ctl.primary.effect.getComputedTiming();
    eq(ct.direction, 'reverse', 'direction');
    eq(ct.duration, 1000, 'duration');
    refresh();
    // Directed fraction runs 1 → 0 under reverse.
    check(parseFloat(val('telemetry', 4)) > 0.6, 'iteration fraction is directed: ' + val('telemetry', 4));
    choose('timingDirection', 'alternate');
    choose('timingDuration', '1200');
});

test('staggered ripple: 16 animations, delays 60 ms apart', () => {
    choose('presetSelect', 'staggered-ripple');
    eq(ctl.anims.length, 16, 'sixteen');
    eq(ctl.anims[15].effect.getTiming().delay, 15 * 60, 'last delay');
    refresh();
    eq($('countLbl').textContent, '16 animations', 'count label');
});

// Max wrap-aware gap between two lanes' measured rotations over ~1 s.
function laneGap(i, j) {
    let gap = 0;
    for (let n = 0; n < 60; n++) {
        advanceTime(16); flush(); refresh();
        const a = parseFloat(val('compareReadout', i)), b = parseFloat(val('compareReadout', j));
        const d = Math.abs(a - b);
        gap = Math.max(gap, isNaN(d) ? 999 : Math.min(d, 360 - d));
    }
    return gap;
}

test('arena: WAAPI and rAF lanes agree when measured from computed style', () => {
    choose('presetSelect', 'comparison-arena');
    check(!$('target-compare').hidden && !$('comparePanel').hidden && $('timingPanel').hidden, 'arena shown');
    const gap = laneGap(0, 2);
    check(gap < 0.5, 'WAAPI vs rAF largest gap under 0.5°: ' + gap);
    // Per-keyframe easing leaves the iteration progress linear, and the plot knows it.
    eq(val('plotReadout', 1), 'linear', 'engine reports linear iteration easing');
    check(row('plotReadout', 2).classList.contains('on'), 'measured progress on the linear line');
    eq($('status').textContent, 'ready', 'switching preset cleared the finish() warning');
    shot('arena');

    // The transport drives lane 1 only.
    clickOn('#btnPlay');
    for (let i = 0; i < 20; i++) { advanceTime(16); flush(); }
    refresh();
    const a = parseFloat(val('compareReadout', 0)), b = parseFloat(val('compareReadout', 2));
    check(Math.abs(a - b) > 10, 'pausing lane 1 lets the rAF lane pull away: ' + a + ' vs ' + b);
    clickOn('#btnPlay');
});

// The CSS lane's `animation:` shorthand carries a cubic-bezier() easing that
// applies per keyframe interval, and re-picking the preset restarts it with
// the other two lanes.
test('arena: the CSS @keyframes lane moves with the other two', () => {
    choose('presetSelect', 'comparison-arena');
    const gap = laneGap(0, 1);
    check(gap < 3, 'WAAPI vs CSS largest gap under 3°: ' + gap);
});

// The CSS lane is a Web Animation too: getAnimations() hands back its
// CSSAnimation, whose clock matches the WAAPI lane's and which script can
// seek like any other animation.
test('arena: the CSS lane is a CSSAnimation script can drive', () => {
    choose('presetSelect', 'comparison-arena');
    frames(3);
    const css = $('laneCss').getAnimations();
    eq(css.length, 1, 'one animation on the CSS lane');
    check(css[0] instanceof CSSAnimation, 'a CSSAnimation');
    eq(css[0].animationName, 'waapiCompare', 'animationName');
    check(document.getAnimations().includes(css[0]), 'listed by document.getAnimations()');
    near(css[0].currentTime, ctl.primary.currentTime, 20, 'same clock as the WAAPI lane');
    eq(css[0].effect.getKeyframes().length, 3, 'keyframes from the @keyframes rule');
    css[0].pause();
    css[0].currentTime = 500;   // a quarter of 2 s: half way to the 180° keyframe
    flush();
    const r = rotationOf($('laneCss'));
    // Half of the first interval under the per-interval cubic-bezier: ~139°.
    near(r, 180 * ease(parseEasing('cubic-bezier(0.4, 0, 0.2, 1)'), 0.5), 3,
         'seeking the CSS animation moves the lane');
    css[0].play();
    // Re-picking the preset restarts the lanes together again.
    choose('presetSelect', 'comparison-arena');
});

loadPreset('elastic-pop');
frames(20);
shot('main');
done('waapi-lab');
