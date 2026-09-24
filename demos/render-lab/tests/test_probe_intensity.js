// Reflection-probe intensity must reach the probe: the HUD's Intensity slider
// is the whole point of that control.
//
// Isolated on purpose: this is an ENGINE check and it currently FAILS. The
// SceneNode `intensity` accessor only handles LightNodes (the getter returns
// 1.0 and the setter drops the value for a ReflectionProbeNode), so neither
// `probe.intensity = x` nor createReflectionProbe({ intensity }) does
// anything. See ENGINE-ISSUES.md. The other render-lab tests pass without it.

import { near, test, done } from "/lib/kit/test.js";
import { scene, state, applyPost } from "/app/lab.js";
import { probeNode } from "/app/reflections.js";

advanceTime(64);
flush();

test('probe intensity is live', () => {
    state.probes.intensity = 2.5;
    applyPost(scene);
    advanceTime(32); flush();
    near(probeNode().intensity, 2.5, 1e-5, 'probe.intensity after the HUD sets 2.5');
});

test('createReflectionProbe honours the intensity option', () => {
    const p = scene.createReflectionProbe({ size: [4, 4, 4], x: 30, y: 2, z: 30, intensity: 0.4 });
    near(p.intensity, 0.4, 1e-5, 'intensity passed at creation');
    p.destroy();
});

done('render-lab probe intensity');
