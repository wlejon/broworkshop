// Sylvan — structural geometry audit, clearance sweep, motion continuity, camera/mood presets, breeze, & placard.
import { check, eq, frames, text, shot, test, done } from '/lib/kit/test.js';

frames(12);

test('boot and UI audit', () => {
  check(Boolean(window.sylvan && window.sylvan.scene && window.sylvan.ctrl), 'window.sylvan API exposed');
  const audit = bro.eye.audit();
  eq(audit.errorCount, 0, 'UI audit errorCount === 0');
});

test('3D structural winding and grounding audit', () => {
  const { scene } = window.sylvan;
  window.sylvan.setPhase(0, 0.52);
  const st = bro.eye.structure(scene, {
    groundY: 0.08,
    ignoreFloating: ['Koi', 'Dragonfly', 'Drifting Leaf', 'Water', 'Trickle', 'Cascade', 'Side Spring', 'Lantern Warm Ember'],
  });
  eq(st.invertedCount, 0, '0 inverted winding meshes');
  eq(st.floatingCount, 0, '0 unintended floating disconnected meshes');
  eq(st.overhangCount, 0, '0 overhanging base footings');
  eq(st.ok, true, 'bro.eye.structure ok === true');
});

test('3D inventory closeup, PBR lookdev & leaf-to-water trajectory checks', () => {
  const { scene } = window.sylvan;
  window.sylvan.setPhase(0.18, 0.52);

  const cu = bro.eye.closeup(scene, {
    mode: 'inventory',
    angles: ['threeQuarter'],
    maxPanels: 9,
    sheetWidth: 768,
    sheetHeight: 768,
  });
  eq(cu.ok, true, 'inventory closeup ok === true');
  eq(cu.width, 768, 'inventory native width 768');
  eq(cu.height, 768, 'inventory native height 768');
  check(cu.panelCount >= 6, 'inventory discovered >= 6 distinct asset classes');

  const ld = bro.eye.lookdev(scene, {
    target: 'Kohaku Matriarch',
    isolate: true,
    sheetWidth: 768,
    sheetHeight: 768,
  });
  eq(ld.ok, true, 'koi lookdev ok === true');
  check(ld.roughnessMean > 0.35 && ld.roughnessMean < 0.75, 'koi satin skin roughness balanced: ' + ld.roughnessMean.toFixed(2));
  check(ld.glossyFrac < 0.15, 'koi not plastic-glossy: glossyFrac=' + ld.glossyFrac.toFixed(2));

  const tr = bro.eye.trace(scene, {
    steps: 24,
    waterY: 0.006,
    minTravel: 0.05,
    filter: 'Drifting Leaf',
    sheetWidth: 768,
    sheetHeight: 432,
    stepFn: (k, n) => { window.sylvan.setPhase(k / n, 0.52); },
  });
  eq(tr.ok, true, 'leaf trace ok === true');
  check(tr.trackCount >= 10, 'traced all drifting leaves: ' + tr.trackCount);
  check(tr.tracks.every((t) => t.touchesWater), 'every falling leaf touches water surface');
  check(tr.tracks.every((t) => t.maxY > 0.72), 'every leaf originates at maple canopy height');
  check(tr.tracks.some((t) => t.nearestStartStatic.includes('Maple')), 'leaf 1 starts directly on maple twig');
});

test('3D living clearance sweep across cyclic phase', () => {
  const { scene } = window.sylvan;
  const clearance = bro.eye.clearance(scene, {
    steps: 16,
    eps: 0.004,
    ignoreStatic: true,
    ignoreSameParent: true,
    stepFn: (k, n) => { window.sylvan.setPhase(k / n, 0.58); },
  });
  eq(clearance.dynamicCollisionCount, 0, '0 dynamic mesh collisions across 16 poses');
  eq(clearance.ok, true, 'bro.eye.clearance ok === true');
});

test('continuous motion cadence via bro.eye.motion', () => {
  const { scene, ctrl } = window.sylvan;
  window.sylvan.snapView('sanctuary');
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
  const motion = bro.eye.motion(seq, { threshold: 2.5 });
  eq(motion.frameCount, 5, 'captured 5 motion frames');
  eq(motion.staticPairCount, 0, 'every inter-frame pair advances smoothly');
  eq(motion.popCount, 0, 'zero frame pops');
  check(motion.smoothness > 0.6, 'motion smoothness > 0.6');
});

test('camera presets, atmosphere moods, breeze slider, and specimen placard', () => {
  const views = ['sanctuary', 'cascade', 'pond', 'canopy'];
  for (const v of views) {
    window.sylvan.snapView(v);
    frames(2);
    eq(window.sylvan.getState().activeView, v, `switched to view ${v}`);
  }

  const moodBtn = document.querySelector('#moodBtn');
  moodBtn.click();
  frames(2);
  eq(window.sylvan.getState().mood, 'sunbeam', 'cycled to Golden Sunbeam mood');
  moodBtn.click();
  frames(2);
  eq(window.sylvan.getState().mood, 'dusk', 'cycled to Firefly Dusk mood');

  window.sylvan.setBreeze(0.88);
  frames(3);
  check(text('#breezeVal').includes('88%'), 'breeze slider updates UI');

  const meta = window.sylvan.selectSample();
  frames(2);
  check(Boolean(meta && window.sylvan.getState().selectedId), 'specimen placard opened');
  check(!document.querySelector('#placard').classList.contains('hidden'), 'placard visible');
});

shot('main');
done('sylvan');
