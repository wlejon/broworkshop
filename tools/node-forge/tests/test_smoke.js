// Headless smoke test for Node Forge — ported from tensor-lab's test_smoke.js
// unchanged (same lab/presets.js import path, same preset-driven exercise).
import { Presets } from "/app/lab/presets.js";
const Lab = { Presets };  // app's former window.Lab namespace, rebuilt from modules

flush();
advanceTime(300);
flush();

if (typeof LabApp === 'undefined' || !LabApp.graph) {
  console.log('TEST FAIL: LabApp not initialised');
} else {
  const g = LabApp.graph;
  console.log('TEST: default graph', g.nodes.length, 'nodes', g.edges.length, 'edges');

  // exercise every preset end-to-end
  for (const p of Lab.Presets.list()) {
    Lab.Presets.load(p.name, g);
    g.propagate();
    let shapeErr = 0;
    for (const n of g.nodes) if (n.error) { shapeErr++; console.log('   shape-err', n.type, '-', n.error); }
    let runErr = '';
    let ran = 0;
    try { ran = LabApp.runner.run(() => {}); }
    catch (e) { runErr = e.message; }
    console.log('PRESET [' + p.name + ']  nodes=' + g.nodes.length +
      ' shapeErr=' + shapeErr + ' ran=' + ran + (runErr ? '  RUNERR: ' + runErr : '  OK'));
  }

  // settle on a populated, inspectable scene for the screenshot
  Lab.Presets.load('Attention Lab', g);
  g.propagate();
  try { LabApp.runner.run(() => {}); } catch (e) { console.log('final run err', e.message); }
  const mha = g.nodes.find((n) => n.type === 'mha');
  if (mha) {
    LabApp.editor.select(mha, null);
    console.log('TEST: mha attn cache =', mha._attn ? (mha._attn.heads + ' heads, seq ' + mha._attn.seq) : 'none');
  }
  LabApp.editor.resize();
  LabApp.editor.frameAll();
  LabApp.editor.draw(0);
}

flush();
if (typeof LabApp !== 'undefined' && LabApp.editor) LabApp.editor.draw(0);
screenshot('node-forge-test.png');
console.log('TEST DONE');
