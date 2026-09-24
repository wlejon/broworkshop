// mixer.js — bus routing with a solo/mute strip per bus.
//
// Solo is worth showing in a SPATIAL mix: muting everything but the bee by
// hand changes five things and you lose your place; soloing the insects bus
// leaves one moving source in an otherwise silent field, the fastest way to
// hear what the emitter sync does to a single sound. The engine's rule
// (audio-api.js): while any bus is soloed, non-soloed buses render silent but
// keep their effect tails running, and mute still wins over solo.
//
// Meters read getBusRmsL/R, a level AFTER spatial attenuation, so a source's
// meter falls as it swings to the far side of its orbit even though its gain
// never moved: the mixer showing you the scene.

import { mixerStrips } from "/lib/kit/audio-ui.js";

/** Bus definitions in strip order. `key` is what sources reference. */
const BUS_SPECS = [
    { key: 'vehicles', label: 'vehicles' },
    { key: 'insects',  label: 'insects'  },
    { key: 'machines', label: 'machines' },
    { key: 'air',      label: 'air'      },
    { key: 'music',    label: 'music'    },
];

export const mixerState = {
    /** key -> { id, label, muted, solo } */
    buses: {},
    order: BUS_SPECS.map((b) => b.key),
};

let ctxRef = null;
let strips = null;

/** Allocate the buses. Call before any source is routed. */
export function buildMixer(ctx) {
    ctxRef = ctx;
    for (const spec of BUS_SPECS) {
        const id = ctx.createBus();
        ctx.setBusGain(id, 1.0);
        mixerState.buses[spec.key] = { id, label: spec.label, muted: false, solo: false };
    }
    return mixerState;
}

/** Bus id for a key; sources use this with ctx.setPlaybackBus. */
export function busId(key) {
    return mixerState.buses[key].id;
}

/** Route every source's playback to the bus its spec named. */
export function routeSources(ctx, sources) {
    for (const s of sources) ctx.setPlaybackBus(s.playback, busId(s.busKey));
}

export function setBusMuted(key, muted) {
    const b = mixerState.buses[key];
    b.muted = muted;
    ctxRef.setBusMuted(b.id, muted);
    if (strips) strips.paint(key, { muted });
}

/**
 * Solo a bus. The flag is read back from the engine (getBusSolo is the
 * authority), so the strip cannot drift from the mixer.
 */
export function setBusSolo(key, solo) {
    const b = mixerState.buses[key];
    ctxRef.setBusSolo(b.id, solo);
    b.solo = ctxRef.getBusSolo(b.id);
    if (strips) strips.paint(key, { solo: b.solo });
    return b.solo;
}

/** True when at least one bus is soloed, the state that silences the rest. */
export function anySoloed() {
    return mixerState.order.some((k) => ctxRef.getBusSolo(mixerState.buses[k].id));
}

export function clearSolo() {
    for (const k of mixerState.order) setBusSolo(k, false);
}

/** Build the strips into #mixerStrips and show outputLatency. */
export function bindMixerHud(ctx) {
    strips = mixerStrips('#mixerStrips', BUS_SPECS, {
        onMute: (key) => setBusMuted(key, !mixerState.buses[key].muted),
        onSolo: (key) => setBusSolo(key, !mixerState.buses[key].solo),
        level: (key) => {
            const id = mixerState.buses[key].id;
            return Math.max(ctx.getBusRmsL(id), ctx.getBusRmsR(id));
        },
    });
    // outputLatency is the device buffer over the device rate, captured when
    // the output opened: a lower bound, and exactly 0 headless (no device).
    const lat = ctx.outputLatency;
    document.getElementById('outLatency').textContent =
        lat > 0 ? (lat * 1000).toFixed(1) + ' ms' : '0 ms (no device)';
}

/** Repaint the meters. Cheap enough to call every few frames. */
export function drawMeters() {
    if (strips) strips.update();
}
