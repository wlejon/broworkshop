// Fresnel — data-first diagnose, geometry conformance, structure, clearance, trace, motion & UI presets.
import { check, eq, frames, text, shot, test, done } from '/lib/kit/test.js';

frames(12);

test('boot and UI audit', () => {
  check(Boolean(window.fresnel && window.fresnel.scene && window.fresnel.ctrl), 'window.fresnel API exposed');
  const audit = bro.eye.audit();
  eq(audit.errorCount, 0, 'UI audit errorCount === 0');
  eq(audit.warningCount, 0, 'UI audit warningCount === 0');
  check(audit.score >= 95, 'UI audit score >= 95: ' + audit.score);
});

test('3D structural winding, grounding & mechanical gaps', () => {
  const { scene } = window.fresnel;
  window.fresnel.setPhase(0, 0.72, 0.55);
  const st = bro.eye.structure(scene, {
    groundY: 0.02,
    ignoreFloating: ['Mantle', 'Chimney', 'Beam', 'Glass', 'Pane', 'Pivot', 'Vane', 'Anemometer', 'Mercury', 'Bracket', 'Bezels', 'Dials', 'Ventilator'],
    watchPairs: [
      ['Fresnel Brass Chariot & Frame', 'Cast-Iron Pedestal & Mercury Trough'],
      ['Spiral Staircase Handrail', 'Spiral Staircase Treads'],
    ],
  });
  eq(st.invertedCount, 0, '0 inverted winding meshes');
  eq(st.floatingCount, 0, '0 unintended floating meshes');
  eq(st.overhangCount, 0, '0 overhanging base footings');
  eq(st.ok, true, 'bro.eye.structure ok === true');
  check(st.watchedGaps[1].gap < 0.01, 'handrail balusters seated on treads: ' + st.watchedGaps[1].gap.toFixed(4));
});

test('data-first render diagnose, surface conformance & 3-mood sweep', () => {
  const { scene, ctrl } = window.fresnel;
  window.fresnel.setPhase(0.14, 0.72, 0.55);
  window.fresnel.snapView('overview');
  ctrl.applyMood('dawn');
  frames(3);

  const diag = bro.eye.diagnose(scene);
  eq(diag.ok, true, 'overview diagnose ok === true');
  eq(diag.bloomHotspotCount, 0, '0 clipped HDR hotspots in overview');
  eq(diag.anomalyCount, 0, '0 render anomalies in overview');

  const conf = bro.eye.conformance(scene, {
    pairs: [
      { subject: 'Keeper Watch Logbook', surface: 'Mahogany Watch Desk', maxGap: 0.03 },
      { subject: 'Pedestal Brass Mounting Collar', surface: 'Cast-Iron Pedestal & Mercury Trough', maxGap: 0.035 },
    ],
  });
  eq(conf.ok, true, 'conformance ok === true');
  check(conf.pairs[0].p95Gap < 0.025, 'logbook rests flush on desk: ' + conf.pairs[0].p95Gap.toFixed(4));
  check(conf.pairs[1].p95Gap < 0.032, 'pedestal collar fits tightly on column: ' + conf.pairs[1].p95Gap.toFixed(4));

  const sw = bro.eye.sweep(scene, {
    states: [
      { label: 'Dawn Foghorn', apply: () => ctrl.applyMood('dawn') },
      { label: 'Amber Squall Sunset', apply: () => ctrl.applyMood('sunset') },
      { label: 'Midnight Beacon', apply: () => ctrl.applyMood('midnight') },
    ],
    sheetWidth: 768,
    sheetHeight: 432,
  });
  eq(sw.ok, true, '3-mood sweep ok === true');
  check(sw.states.every((s) => s.hotspotCount === 0), 'all 3 coastal skies free of bloom hotspots');

  ctrl.applyMood('dawn');
  window.fresnel.setPhase(0.14, 0.72, 0.55);
  frames(2);
});

test('16-pose full-mechanism clearance & 48-step anemometer orbit trace', () => {
  const { scene } = window.fresnel;
  const clearance = bro.eye.clearance(scene, {
    steps: 16,
    eps: 0.004,
    ignoreStatic: true,
    ignoreSameParent: true,
    ignorePairs: [
      ['Fresnel Beacon Beams', 'Helical Lantern Astragals & Cornice'],
      ['Fresnel Beacon Beams', 'Curved Lantern Glazing'],
      ['Fresnel Beacon Beams', 'Cast-Iron Murette & Gallery Railing'],
    ],
    stepFn: (k, n) => { window.fresnel.setPhase(k / n, 0.72, 0.55); },
  });
  eq(clearance.staticCollisionCount, 0, '0 static collisions');
  eq(clearance.dynamicCollisionCount, 0, '0 dynamic mechanism collisions across 16 poses');
  eq(clearance.ok, true, 'bro.eye.clearance ok === true');

  const tr = bro.eye.trace(scene, {
    steps: 48,
    minTravel: 0.1,
    filter: 'Anemometer Cup',
    sheetWidth: 768,
    sheetHeight: 432,
    stepFn: (k, n) => { window.fresnel.setPhase(k / n, 0.72, 0.55); },
  });
  eq(tr.ok, true, 'anemometer trace ok === true');
  eq(tr.trackCount, 4, 'traced all 4 anemometer cups');
  check(tr.tracks.every((t) => t.closedLoop), 'every anemometer cup completes closed circular orbit');
  check(tr.tracks.every((t) => t.snapCount === 0), 'zero rotational or velocity snaps');
});

test('continuous beacon rotation cadence via bro.eye.motion', () => {
  const { scene, ctrl } = window.fresnel;
  window.fresnel.snapView('lens');
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
  check(motion.smoothness > 0.6, 'motion smoothness > 0.6: ' + motion.smoothness.toFixed(2));
});

test('camera presets, atmosphere moods, sliders, beam shutter & placard', () => {
  const views = ['overview', 'lens', 'pedestal', 'watchroom', 'cupola'];
  for (const v of views) {
    window.fresnel.snapView(v);
    frames(2);
    eq(window.fresnel.getState().activeView, v, `switched to view ${v}`);
  }
  window.fresnel.snapView('overview');

  const moodBtn = document.querySelector('#moodBtn');
  moodBtn.click();
  frames(2);
  eq(window.fresnel.getState().mood, 'sunset', 'cycled to Amber Squall Sunset mood');
  moodBtn.click();
  frames(2);
  eq(window.fresnel.getState().mood, 'midnight', 'cycled to Midnight Beacon mood');
  moodBtn.click();
  frames(2);
  eq(window.fresnel.getState().mood, 'dawn', 'cycled back to Dawn Foghorn mood');

  window.fresnel.setSpeed(0.90);
  window.fresnel.setWind(0.84);
  frames(3);
  check(text('#speedVal').includes('90%'), 'speed slider updates UI');
  check(text('#windVal').includes('84%'), 'wind slider updates UI');

  window.fresnel.setShutter(false);
  frames(2);
  eq(window.fresnel.getState().shutterOpen, false, 'shutter closed');
  window.fresnel.setShutter(true);
  frames(2);
  eq(window.fresnel.getState().shutterOpen, true, 'shutter reopened');

  const meta = window.fresnel.selectSample();
  frames(2);
  check(Boolean(meta && window.fresnel.getState().selectedId), 'specimen placard opened');
  check(!document.querySelector('#placard').classList.contains('hidden'), 'placard visible');
  document.querySelector('#pl-close').click();
  frames(2);
  check(document.querySelector('#placard').classList.contains('hidden'), 'placard closed');
});

shot('main');
done('fresnel');
