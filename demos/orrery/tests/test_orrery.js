// Aurelia Orrery — scene audit, motion kinematics, camera/mood switching, 3D calipers, and body selection.
import { check, eq, frames, text, shot, test, done } from '/lib/kit/test.js';

frames(12);

test('boot and UI audit', () => {
  check(Boolean(window.orrery && window.orrery.scene), 'window.orrery API exposed');
  const audit = bro.eye.audit();
  eq(audit.errorCount, 0, 'UI audit errorCount === 0');
});

test('orbital and armillary motion continuity via bro.eye.motion', () => {
  const { scene } = window.orrery;
  window.orrery.snapView('hero');
  frames(4);

  const seq = [];
  for (let i = 0; i < 5; ++i) {
    for (let s = 0; s < 6; ++s) {
      advanceTime(40);
      flush();
    }
    const snap = bro.eye.visualize([scene], { mode: 'sheet', maxPanelDim: 360 });
    seq.push(new ImageData(snap.data, snap.width, snap.height));
  }

  const m = bro.eye.motion(seq, { threshold: 2.5 });
  eq(m.frameCount, 5, 'motion analyzed 5 frames');
  eq(m.staticPairCount, 0, 'animated frames have 0 static pairs');
  eq(m.popCount, 0, 'animated frames have 0 pops');
  check(m.smoothness > 0.5, 'motion smoothness > 0.5 (got ' + m.smoothness.toFixed(3) + ')');
});

test('camera presets and lighting moods switch cleanly', () => {
  for (const preset of ['ecliptic', 'planisphere', 'clockwork', 'hero']) {
    window.orrery.snapView(preset);
    frames(3);
    eq(window.orrery.activeView, preset, 'activeView matches ' + preset);
  }
  for (const [key, label] of [['golden', 'Golden'], ['gallery', 'Gallery'], ['midnight', 'Midnight']]) {
    window.orrery.applyMood(key);
    frames(3);
    eq(text('#moodLabel'), label, 'mood label updated to ' + label);
  }
});

test('3D spatial probe hits Aurelia meshes', () => {
  window.orrery.snapView('hero');
  frames(4);
  const probe = bro.eye.probe(window.orrery.scene, { gridCols: 5, gridRows: 3 });
  const hits = probe.samples.filter((s) => s.hit && s.nodeName && s.nodeName.length > 0);
  check(hits.length >= 2, 'bro.eye.probe hit >= 2 named meshes (got ' + hits.length + ')');
});

test('body selection opens astronomical placard', () => {
  window.orrery.selectBody('saturn');
  frames(4);
  const placard = document.querySelector('#placard');
  check(placard && !placard.classList.contains('hidden'), '#placard visible after selecting Saturn');
  eq(text('#plName'), 'Saturn', '#plName shows Saturn');
  window.orrery.clearSelection();
  frames(2);
  window.orrery.snapView('hero');
  frames(4);
});

shot('main');
done('orrery');
