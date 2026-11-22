// Vulcan No. 4 — clearance sweep, motion continuity, camera/mood presets, throttle/cutaway, & placard.
import { check, eq, frames, text, shot, test, done } from '/lib/kit/test.js';

frames(12);

test('boot and UI audit', () => {
  check(Boolean(window.engine && window.engine.scene && window.engine.ctrl), 'window.engine API exposed');
  const audit = bro.eye.audit();
  eq(audit.errorCount, 0, 'UI audit errorCount === 0');
});

test('3D kinematic clearance sweep across full revolution', () => {
  const { scene } = window.engine;
  const clearance = bro.eye.clearance(scene, {
    steps: 16,
    eps: 0.004,
    ignoreStatic: true,
    stepFn: (k, n) => { window.engine.setPhase(k / n, 0.72); },
  });
  eq(clearance.dynamicCollisionCount, 0, '0 dynamic mesh collisions across 16 poses');
  eq(clearance.ok, true, 'bro.eye.clearance ok === true');
});

test('continuous motion cadence via bro.eye.motion', () => {
  const { scene, ctrl } = window.engine;
  window.engine.snapView('crank');
  ctrl.playing = true;
  frames(4);

  const seq = [];
  for (let i = 0; i < 5; ++i) {
    for (let s = 0; s < 4; ++s) {
      advanceTime(33.333);
      flush();
    }
    const snap = bro.eye.visualize([scene], { mode: 'sheet', maxPanelDim: 360 });
    seq.push(new ImageData(snap.data, snap.width, snap.height));
  }
  const m = bro.eye.motion(seq, { threshold: 2.5 });
  eq(m.frameCount, 5, 'motion analyzed 5 frames');
  eq(m.staticPairCount, 0, 'animated engine has 0 static pairs');
  eq(m.popCount, 0, 'animated engine has 0 pops');
  check(m.smoothness > 0.6, 'motion smoothness > 0.6 (got ' + m.smoothness.toFixed(3) + ')');
});

test('camera presets and lighting moods switch cleanly', () => {
  for (const preset of ['crank', 'gears', 'governor', 'gallery']) {
    window.engine.snapView(preset);
    frames(3);
    eq(window.engine.activeView, preset, 'activeView matches ' + preset);
  }
  for (const [key, label] of [['foundry', 'Foundry'], ['drafting', 'Drafting'], ['atelier', 'Atelier']]) {
    window.engine.applyMood(key);
    frames(3);
    eq(text('#moodLabel'), label, 'mood label updated to ' + label);
  }
});

test('throttle governor lift, cutaway toggle, and selection placard', () => {
  const { ctrl } = window.engine;
  window.engine.setThrottle(0.20);
  window.engine.setPhase(0.25, 0.20);
  const lowLift = ctrl.govLift;
  window.engine.setThrottle(0.95);
  window.engine.setPhase(0.25, 0.95);
  const highLift = ctrl.govLift;
  check(highLift > lowLift + 15, 'governor collar rises with higher RPM/throttle');

  ctrl.setCutaway(false);
  check(ctrl.cutaway === false, 'cutaway toggled off');
  ctrl.setCutaway(true);
  check(ctrl.cutaway === true, 'cutaway toggled on');

  window.engine.selectPart('flywheel');
  frames(3);
  const placard = document.querySelector('#placard');
  check(placard && !placard.classList.contains('hidden'), '#placard visible after selecting Flywheel');
  eq(text('#plName'), '8-Spoke Cast Flywheel', '#plName matches flywheel');
  window.engine.clearSelection();
  window.engine.snapView('gallery');
  frames(4);
});

shot('main');
done('engine');
