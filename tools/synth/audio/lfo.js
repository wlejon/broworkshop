// audio/lfo.js — the synth's LFO on broaudio's ModMatrix.
//
// The engine has ONE modulation matrix and its routes apply to every voice,
// so the LFO is global (song-level), not per layer: LFO 1 routed to one
// destination. Presets carry an LFO setting and load it here.

export const LFO_SHAPES = { sine: 'Sin', triangle: 'Tri', square: 'Sqr', sawtooth: 'Saw', samplehold: 'S&H' };
export const LFO_TARGETS = { pitch: 'Pitch', filter: 'Filter', volume: 'Volume', pan: 'Pan' };

const DEST = { pitch: 'pitch', filter: 'filterfreq', volume: 'gain', pan: 'pan' };
const SHAPE = { sine: 'sine', triangle: 'triangle', square: 'square', sawtooth: 'sawup', samplehold: 'sampleandhold' };

export function defaultLfo() {
    return { enabled: false, rate: 2, depth: 0.3, waveform: 'sine', target: 'pitch', sync: false };
}

/** Fill an LFO setting from partial data. */
export function lfoWithDefaults(src) {
    const d = defaultLfo();
    if (!src) return d;
    for (const k in d) if (src[k] !== undefined && typeof src[k] === typeof d[k]) d[k] = src[k];
    if (!SHAPE[d.waveform]) d.waveform = 'sine';
    if (!DEST[d.target]) d.target = 'pitch';
    return d;
}

/** Drives LFO 1 + one route from an LFO setting object. */
export function createLfo(ctx) {
    const mm = ctx ? ctx.getModMatrix() : null;
    let route = -1, routedTo = null;
    return {
        /** Apply the whole setting (after loading a preset or a project). */
        apply(s) {
            if (!mm) return;
            mm.setLfoRate(0, s.rate);
            mm.setLfoShape(0, SHAPE[s.waveform] || 'sine');
            mm.setLfoSync(0, !!s.sync);
            if (route >= 0 && (!s.enabled || routedTo !== s.target)) { mm.removeRoute(route); route = -1; }
            if (s.enabled && route < 0) { route = mm.addRoute('lfo1', DEST[s.target] || 'pitch', s.depth); routedTo = s.target; }
            if (route >= 0) mm.setRouteAmount(route, s.depth);
        },
        get routed() { return route >= 0; },
        get routeId() { return route; },
        modMatrix: mm,
    };
}
