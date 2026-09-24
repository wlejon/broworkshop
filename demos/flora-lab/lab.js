// flora-lab — grow a flowering meadow with broflora.
//
// The branch skeleton broflora simulates drives the rendered plant directly:
// leaf cards scatter along its twigs and a flower is stamped at every bloom
// anchor (layers.js). The whole sim and its mesh emit run on a worker
// (sim-worker.js); this thread only pumps it and uploads what comes back.
// Diagnostic overlays (diagnostics.js) show the shadow grid, plant origins
// and an octahedral-impostor fast path. The meadow is lit by the kit's
// time-of-day rig: HDR sky + CSM sun, and at night drifting firefly point
// lights, a moonbeam spot and glowing bloom eyes.
//
// main.js boots this; tests import it (never main.js).

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight } from "/lib/kit/sky.js";
import { WORLD_SIZE } from "/app/shared.js";
import { LAYERS, createLayers } from "/app/layers.js";
import { OVERLAYS, createDiagnostics } from "/app/diagnostics.js";

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 2, 0], dist: 18, fov: 50, near: 0.1, far: 500, rot: orbitRotation(-Math.PI * 0.35 + Math.PI / 2, -0.31) },
    // Nothing to pick, so the left button orbits and the right one pans.
    controls: { orbitButton: 0, panButton: 2, minDist: 1, maxDist: 200 },
});
export const { scene } = vp;

export const layers = createLayers(scene);
export const diagnostics = createDiagnostics(scene);
export const sky = daylight(scene, {
    order: ['dawn', 'noon', 'golden', 'night'],
    onChange: (p) => layers.setEmissiveGain(p.emissiveGain),
});

scene.createMesh({
    mesh: 'plane', halfW: WORLD_SIZE * 0.5, halfD: WORLD_SIZE * 0.5, y: 0,
    color: '#36421f', metallic: 0, roughness: 1.0, receivesShadow: true,   // mossy meadow floor
});
// A gentle breeze for the foliage (scene wind sways vertices by their wind weight).
scene.setWind({ direction: [1, 0, 0.35], strength: 0.06, frequency: 1.1 });

// --- the sim worker -------------------------------------------------------------

export const sim = new Worker('sim-worker.js', { type: 'module' });

/** The main thread's whole view of the sim: the latest packet's stats and plants. */
export const view = { stats: { simTime: 0, plantCount: 0, moduleCount: 0, flowering: 0 },
                      plants: new Float32Array(0), shadow: null, packets: 0, playing: true };

let snapshotPending = false;
function refreshDiagnostics() {
    // The shadow grid reads a worker-side query: ask for a fresh one each packet while shown.
    if (OVERLAYS.shadowGrid.on && !snapshotPending) {
        snapshotPending = true;
        sim.postMessage({ type: 'snapshot', which: { shadowGrid: true } });
    }
    diagnostics.rebuild(view.plants, OVERLAYS.shadowGrid.on ? view.shadow : null);
}

let onPacket = () => {};
sim.onmessage = (e) => {
    const m = e.data;
    if (!m || !m.type) return;
    if (m.type === 'frame') {
        layers.apply(m);
        view.stats = m.stats;
        view.plants = m.plants;
        view.packets++;
    } else if (m.type === 'snapshot') {
        snapshotPending = false;
        if (m.shadow) view.shadow = m.shadow;
        view.plants = m.plants;
    }
    refreshDiagnostics();
    onPacket();
};

/** Triangles drawn this frame across the visible layers. */
export function triangles() {
    return layers.triangles + (OVERLAYS.impostors.on ? diagnostics.impostorQuads * 2 : 0);
}

// Impostors are the fast path standing in for the full plant, so the two are exclusive.
const HOT = ['branches', 'foliage', 'blooms'];

/**
 * Turn a layer or overlay on/off. Returns the keys whose state it also
 * changed (impostors vs the full plant) so the panel can follow.
 */
export function setLayer(key, on) {
    const changed = [];
    if (key === 'impostors' && on) {
        for (const k of HOT) if (LAYERS[k].on) { layers.set(k, false); changed.push(k); }
    } else if (HOT.includes(key) && on && OVERLAYS.impostors.on) {
        OVERLAYS.impostors.on = false;
        changed.push('impostors');
    }
    if (LAYERS[key]) layers.set(key, on); else OVERLAYS[key].on = on;
    sim.postMessage({ type: 'layers', flags: layers.flags() });
    refreshDiagnostics();
    return changed;
}

export const control = {
    play(on) { view.playing = on; sim.postMessage({ type: 'playing', on }); },
    step() { sim.postMessage({ type: 'step' }); },
    reset() { view.shadow = null; sim.postMessage({ type: 'reset' }); },
    seed() {
        sim.postMessage({ type: 'seed', species: Math.random() < 0.5 ? 'sun' : 'shade',
            x: (Math.random() - 0.5) * WORLD_SIZE * 0.8, z: (Math.random() - 0.5) * WORLD_SIZE * 0.8 });
    },
    timeScale(v) { sim.postMessage({ type: 'timeScale', v }); },
    temperature(t) { sim.postMessage({ type: 'climate', temp: t }); },
};

// Pump the worker with the real frame dt while playing; the fireflies drift
// on the same clock even while paused.
vp.onFrame((dt) => {
    if (view.playing) sim.postMessage({ type: 'pump', dt });
    sky.update(dt);
});

/** `fn()` runs after every worker message (the panel's stats). */
export function onUpdate(fn) { onPacket = fn; }

sky.apply('golden');
