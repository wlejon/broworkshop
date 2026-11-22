// Millrace — data-first diagnose, geometry conformance, structure, clearance, trace, motion & UI presets.
import { check, eq, frames, text, shot, test, done } from '/lib/kit/test.js';

frames(12);

test('boot and UI audit', () => {
  check(Boolean(window.millrace && window.millrace.scene && window.millrace.ctrl), 'window.millrace API exposed');
  const audit = bro.eye.audit();
  eq(audit.errorCount, 0, 'UI audit errorCount === 0');
  eq(audit.warningCount, 0, 'UI audit warningCount === 0');
  check(audit.score >= 95, 'UI audit score >= 95: ' + audit.score);
});

test('structural winding, grounding & gear meshing clearance', () => {
  const { scene } = window.millrace;
  window.millrace.setPhase(0, 0.76, 0.48);
  const st = bro.eye.structure(scene, {
    groundY: 0.10,
    ignoreFloating: ['Trout', 'Drifting Leaf', 'Water', 'Jet', 'Cascade', 'Porch Lantern Glass', 'Pivot'],
    watchPairs: [['Main Cast-Iron Pit Gear', 'Cast-Iron Pinion Gear'], ['Millhouse Fieldstone Masonry', 'Footbridge']],
  });
  eq(st.invertedCount, 0, '0 inverted winding meshes');
  eq(st.floatingCount, 0, '0 unintended floating meshes');
  eq(st.overhangCount, 0, '0 overhanging base footings');
  eq(st.ok, true, 'bro.eye.structure ok === true');
  check(st.watchedGaps[0].gap < 0.02, 'pit gear meshes closely with pinion: ' + st.watchedGaps[0].gap.toFixed(4));
});

test('data-first render anomalies, surface conformance & 3-mood sweep', () => {
  const { scene, ctrl } = window.millrace;
  window.millrace.setPhase(0.16, 0.76, 0.48);

  window.millrace.snapView('valley');
  ctrl.applyMood('morning');
  frames(3);
  const dValley = bro.eye.diagnose(scene);
  eq(dValley.ok, true, 'valley diagnose ok === true');
  eq(dValley.bloomHotspotCount, 0, 'valley bloomHotspotCount === 0');
  eq(dValley.anomalyCount, 0, 'valley anomalyCount === 0');

  window.millrace.snapView('gears');
  frames(3);
  const dGears = bro.eye.diagnose(scene);
  eq(dGears.ok, true, 'gears diagnose ok === true');
  eq(dGears.bloomHotspotCount, 0, 'gears bloomHotspotCount === 0');
  eq(dGears.anomalyCount, 0, 'gears anomalyCount === 0');

  window.millrace.snapView('valley');
  const conf = bro.eye.conformance(scene, {
    pairs: [
      { subject: 'Granite Cliff Overflow Cascade', surface: ['Alpine Valley Terrain', 'Granite Cliff Boulder'], maxGap: 0.06 },
      { subject: 'Millhouse Wall Ivy', surface: 'Millhouse Fieldstone Masonry', maxGap: 0.055 },
    ],
  });
  eq(conf.ok, true, 'conformance ok === true for cascade and ivy');
  check(conf.pairs[0].p95Gap < 0.05, 'cascade p95Gap < 0.05m: ' + conf.pairs[0].p95Gap.toFixed(4));
  check(conf.pairs[1].p95Gap < 0.04, 'wall ivy p95Gap < 0.04m: ' + conf.pairs[1].p95Gap.toFixed(4));

  const sw = bro.eye.sweep(scene, {
    states: [
      { label: 'Alpine Morning', apply: () => ctrl.applyMood('morning') },
      { label: 'Golden Harvest', apply: () => ctrl.applyMood('harvest') },
      { label: 'Lantern Twilight', apply: () => ctrl.applyMood('twilight') },
    ],
    sheetWidth: 768,
    sheetHeight: 432,
  });
  eq(sw.ok, true, 'mood sweep ok === true');
  check(sw.states.every((s) => s.hotspotCount === 0), 'every mood free of clipped bloom hotspots');

  ctrl.applyMood('morning');
  window.millrace.setPhase(0.16, 0.76, 0.48);
  frames(2);
});

test('16-pose solid clearance & 48-step C1 leaf trajectory', () => {
  const { scene } = window.millrace;
  const clearance = bro.eye.clearance(scene, {
    steps: 16,
    eps: 0.004,
    ignoreStatic: true,
    ignoreSameParent: true,
    ignorePairs: [
      ['Aqueduct Overshot Spill Jet', 'Overshot Waterwheel Timber'],
      ['Aqueduct Overshot Spill Jet', 'Waterwheel Iron Straps'],
    ],
    stepFn: (k, n) => { window.millrace.setPhase(k / n, 0.76, 0.48); },
  });
  eq(clearance.dynamicCollisionCount, 0, '0 solid dynamic mesh collisions across 16 poses');
  eq(clearance.ok, true, 'bro.eye.clearance ok === true');

  const tr = bro.eye.trace(scene, {
    steps: 48,
    waterY: 0.006,
    minTravel: 0.05,
    filter: 'Drifting Leaf',
    sheetWidth: 768,
    sheetHeight: 432,
    stepFn: (k, n) => { window.millrace.setPhase(k / n, 0.76, 0.48); },
  });
  eq(tr.ok, true, 'leaf trace ok === true');
  check(tr.trackCount >= 10, 'traced drifting leaves: ' + tr.trackCount);
  check(tr.tracks.every((t) => t.touchesWater), 'every falling leaf touches water surface');
  check(tr.tracks.every((t) => t.snapCount === 0), 'zero C1 velocity/rotation snaps at water touchdown');
});

test('continuous motion cadence via bro.eye.motion', () => {
  const { scene, ctrl } = window.millrace;
  window.millrace.snapView('wheel');
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

test('camera presets, atmosphere moods, flow/breeze sliders & placard', () => {
  const views = ['valley', 'wheel', 'gears', 'pond', 'bridge'];
  for (const v of views) {
    window.millrace.snapView(v);
    frames(2);
    eq(window.millrace.getState().activeView, v, `switched to view ${v}`);
  }

  const moodBtn = document.querySelector('#moodBtn');
  moodBtn.click();
  frames(2);
  eq(window.millrace.getState().mood, 'harvest', 'cycled to Golden Harvest mood');
  moodBtn.click();
  frames(2);
  eq(window.millrace.getState().mood, 'twilight', 'cycled to Lantern Twilight mood');
  moodBtn.click();
  frames(2);
  eq(window.millrace.getState().mood, 'morning', 'cycled back to Alpine Morning mood');

  window.millrace.setFlow(0.92);
  window.millrace.setBreeze(0.84);
  frames(3);
  check(text('#flowVal').includes('92%'), 'flow slider updates UI');
  check(text('#breezeVal').includes('84%'), 'breeze slider updates UI');

  const meta = window.millrace.selectSample();
  frames(2);
  check(Boolean(meta && window.millrace.getState().selectedId), 'placard opened');
  check(!document.querySelector('#placard').classList.contains('hidden'), 'placard visible');
});

shot('main');
done('millrace');
