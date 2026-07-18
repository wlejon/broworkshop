// mixer.js — bus routing with a solo/mute strip per bus.
//
// bro's bus API has had setBusSolo/getBusSolo for a while and nothing in the
// workshop drives it: tools/synth ships a complete mixer UI — gain, pan, mute,
// per-bus effects, meters — and never calls solo once. So this panel is
// deliberately a plain mixer with the one missing control wired up.
//
// Solo is worth showing here specifically because of what it does in a SPATIAL
// mix. Muting everything but the bee by hand changes five things and you lose
// your place; soloing the insects bus leaves one moving source in an otherwise
// silent field, which is the fastest way to hear what the emitter sync is
// doing to a single sound. The engine's rule (audio-api.js): while any bus is
// soloed, non-soloed buses render silent but keep their effect tails running,
// and mute still wins over solo.
//
// Meters read getBusRmsL/R, which is a level AFTER spatial attenuation — so a
// source's meter falls as it swings to the far side of its orbit even though
// its gain slider never moved. That is the mixer showing you the scene.

/** Bus definitions in strip order. `key` is what sources reference. */
const BUS_SPECS = [
    { key: 'vehicles', label: 'vehicles' },
    { key: 'insects',  label: 'insects'  },
    { key: 'machines', label: 'machines' },
    { key: 'air',      label: 'air'      },
    { key: 'music',    label: 'music'    },
];

export const mixerState = {
    /** key -> { id, label, muted, solo, gain, meterEl, muteBtn, soloBtn } */
    buses: {},
    order: BUS_SPECS.map(b => b.key),
};

let ctxRef = null;

/** Allocate the buses. Call before any source is routed. */
export function buildMixer(ctx) {
    ctxRef = ctx;
    for (const spec of BUS_SPECS) {
        const id = ctx.createBus();
        ctx.setBusGain(id, 1.0);
        mixerState.buses[spec.key] = {
            id, label: spec.label, muted: false, solo: false, gain: 1.0,
            meterEl: null, muteBtn: null, soloBtn: null,
        };
    }
    return mixerState;
}

/** Bus id for a key — sources use this with ctx.setPlaybackBus. */
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
    if (b.muteBtn) b.muteBtn.classList.toggle('on', muted);
}

/**
 * Toggle solo on a bus. Reads the flag back from the engine rather than
 * trusting our own bookkeeping — getBusSolo is the authority, and showing the
 * button state from it means the UI can't drift from the mixer.
 */
export function setBusSolo(key, solo) {
    const b = mixerState.buses[key];
    ctxRef.setBusSolo(b.id, solo);
    b.solo = ctxRef.getBusSolo(b.id);
    if (b.soloBtn) b.soloBtn.classList.toggle('solo', b.solo);
    return b.solo;
}

/** True when at least one bus is soloed — the state that silences the rest. */
export function anySoloed() {
    return mixerState.order.some(k => ctxRef.getBusSolo(mixerState.buses[k].id));
}

export function clearSolo() {
    for (const k of mixerState.order) setBusSolo(k, false);
}

/** Build the strips into #mixerStrips and show outputLatency. */
export function bindMixerHud(ctx) {
    const host = document.getElementById('mixerStrips');
    host.innerHTML = '';

    for (const key of mixerState.order) {
        const b = mixerState.buses[key];

        const row = document.createElement('div');
        row.className = 'strip';

        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = b.label;
        row.appendChild(nm);

        const mute = document.createElement('button');
        mute.className = 'btn';
        mute.textContent = 'M';
        mute.addEventListener('click', () => setBusMuted(key, !mixerState.buses[key].muted));
        row.appendChild(mute);

        const solo = document.createElement('button');
        solo.className = 'btn';
        solo.textContent = 'S';
        solo.addEventListener('click', () => setBusSolo(key, !mixerState.buses[key].solo));
        row.appendChild(solo);

        const meter = document.createElement('span');
        meter.className = 'meter';
        const fill = document.createElement('i');
        meter.appendChild(fill);
        row.appendChild(meter);

        host.appendChild(row);
        b.muteBtn = mute;
        b.soloBtn = solo;
        b.meterEl = fill;
    }

    // outputLatency is the device buffer over the device rate, captured when
    // the output opened — a lower bound, and exactly 0 headless where there is
    // no device at all. Worth surfacing precisely because it is the number
    // people reach for when a positioned sound feels late.
    const lat = ctx.outputLatency;
    document.getElementById('outLatency').textContent =
        lat > 0 ? `${(lat * 1000).toFixed(1)} ms` : '0 ms (no device)';
}

/** Repaint the meters. Cheap enough to call every few frames. */
export function drawMeters(ctx) {
    for (const key of mixerState.order) {
        const b = mixerState.buses[key];
        if (!b.meterEl) continue;
        const rms = Math.max(ctx.getBusRmsL(b.id), ctx.getBusRmsR(b.id));
        // sqrt gives the low end of the range enough of the bar to be visible;
        // these are level indicators, not measurements.
        const pct = Math.min(100, Math.sqrt(rms) * 140);
        b.meterEl.style.width = `${pct.toFixed(1)}%`;
    }
}
