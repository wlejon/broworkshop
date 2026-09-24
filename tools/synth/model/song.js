// model/song.js — the synth document and its engine side.
//
// A song is up to 8 layers plus song-level settings (tempo, the global LFO).
// Each layer owns a broaudio bus (its effect chain) and a VoiceAllocator,
// plays a 16-step pattern as a sequence or an arpeggio, and may carry one
// automation lane. The microphone, once enabled, is an extra "signal" with
// its own bus and effects that the sidebar can edit like a layer.
//
// Data is plain and serializable (serialize / load); engine handles live in
// `layer.rt` (bus + filter slot) and `layer.alloc`. Every user-level
// mutation goes through a method here, which pushes the change to the engine
// and reports it: onEdit(label, key) (the app's undo history) and
// on('change', what) with what = 'layers' | 'select' | 'sound' | 'all'.

import { defaultSound, withDefaults, applyBus, applyBusParam, createBusRt, deleteBusRt, createAllocator } from "../audio/sound.js";
import { defaultLfo, lfoWithDefaults, createLfo } from "../audio/lfo.js";
import { LOWEST, HIGHEST } from "../audio/notes.js";

export const NUM_STEPS = 16;
export const MAX_LAYERS = 8;
export const COLORS = ['#00e5ff', '#ff6b9d', '#c49bff', '#7bed9f', '#ffa94d', '#69d2e7', '#f38181', '#a8e6cf'];
export const MIC_COLOR = '#ff4444';
export const ARP_PATTERNS = { up: 'Up', down: 'Dn', updown: 'U/D', random: 'Rnd' };
export const INTERP_MODES = ['linear', 'smooth', 'step'];

/** Automation lane targets: value range, default, and log display. */
export const AUTOMATION_TARGETS = {
    'filter-freq': { label: 'Filter Freq', min: 20, max: 20000, def: 2000, log: true },
    'filter-q':    { label: 'Filter Q',    min: 0.1, max: 20,   def: 1 },
    'delay-mix':   { label: 'Delay Mix',   min: 0,   max: 1,    def: 0.3 },
    'reverb-mix':  { label: 'Reverb Mix',  min: 0,   max: 1,    def: 0.2 },
    'chorus-mix':  { label: 'Chorus Mix',  min: 0,   max: 1,    def: 0.3 },
    'volume':      { label: 'Volume',      min: 0,   max: 2,    def: 1 },
    'pan':         { label: 'Pan',         min: -1,  max: 1,    def: 0 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function cleanSteps(steps) {
    const out = new Array(NUM_STEPS).fill(null);
    if (Array.isArray(steps)) {
        for (let i = 0; i < NUM_STEPS; i++) {
            const n = steps[i];
            if (typeof n === 'number' && n >= LOWEST && n <= HIGHEST) out[i] = Math.round(n);
        }
    }
    return out;
}

function cleanAutomation(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((a) => a && AUTOMATION_TARGETS[a.target]).map((a) => ({
        target: a.target,
        interpMode: INTERP_MODES.includes(a.interpMode) ? a.interpMode : 'linear',
        points: (a.points || []).filter((p) => p && isFinite(p.beat) && isFinite(p.value))
            .map((p) => ({ beat: Math.max(0, Math.min(4, +p.beat)), value: +p.value }))
            .sort((x, y) => x.beat - y.beat),
    }));
}

export class Song {
    constructor(ctx) {
        this.ctx = ctx;
        this.bpm = 120;
        this.lfo = defaultLfo();
        this.layers = [];
        this.activeIndex = 0;
        this.editingMic = false;
        this.micSound = defaultSound();
        this.mic = null;              // the mic signal once enabled: { name, color, sound, rt }
        this.onEdit = null;           // (label, key) after every user-level change
        this._lfo = createLfo(ctx);
        this._listeners = [];
        this._uid = 1;
        this.reset();
    }

    // ---- events ------------------------------------------------------------

    on(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter((f) => f !== fn); }; }
    emit(what) { for (const fn of this._listeners.slice()) fn(what); }
    edited(label, key) { if (this.onEdit) this.onEdit(label, key || label); }

    // ---- layers --------------------------------------------------------------

    _makeLayer(data) {
        const d = data || {};
        const layer = {
            uid: d.uid && !this.layers.some((l) => l.uid === d.uid) ? d.uid : this._uid++,
            name: d.name || 'Layer ' + (this.layers.length + 1),
            color: d.color || COLORS[this.layers.length % COLORS.length],
            muted: !!d.muted,
            mode: d.mode === 'arpeggiator' ? 'arpeggiator' : 'sequencer',
            arpPattern: ARP_PATTERNS[d.arpPattern] ? d.arpPattern : 'up',
            steps: cleanSteps(d.steps),
            automation: cleanAutomation(d.automation),
            sound: withDefaults(d.sound),
        };
        this._uid = Math.max(this._uid, layer.uid + 1);
        layer.rt = createBusRt(this.ctx, (uid) => this._busOf(uid));
        layer.alloc = createAllocator(this.ctx, () => layer.sound, () => layer.rt.bus);
        applyBus(this.ctx, layer.rt, layer.sound);
        return layer;
    }

    _dropLayer(layer) {
        if (layer.alloc) layer.alloc.allNotesOff();
        deleteBusRt(this.ctx, layer.rt);
        layer.alloc = null;
    }

    _busOf(uid) {
        const l = this.layers.find((x) => x.uid === uid);
        return l && l.rt ? l.rt.bus : -1;
    }

    /** Re-resolve every compressor sidechain (after layers come or go). */
    _resolveSidechains() {
        for (const s of this.signals()) {
            if (s.sound.compressor.sidechain != null && this._busOf(s.sound.compressor.sidechain) < 0) {
                s.sound.compressor.sidechain = null;
            }
            applyBusParam(this.ctx, s.rt, s.sound, 'compressor.sidechain');
        }
    }

    /** Layers plus the mic signal when it exists. */
    signals() { return this.mic ? this.layers.concat([this.mic]) : this.layers.slice(); }

    layer(i) { return this.layers[i] || null; }
    get count() { return this.layers.length; }
    /** The selected layer (still the note target while the mic is being edited). */
    activeLayer() { return this.layers[this.activeIndex] || null; }
    /** What the sidebar edits: the selected layer, or the mic. */
    activeSignal() { return this.editingMic && this.mic ? this.mic : this.activeLayer(); }

    addLayer(data, label) {
        if (this.layers.length >= MAX_LAYERS) return null;
        const layer = this._makeLayer(data);
        this.layers.push(layer);
        this.activeIndex = this.layers.length - 1;
        this.editingMic = false;
        this.emit('layers');
        this.emit('select');
        this.edited(label || 'Add layer');
        return layer;
    }

    removeLayer(i) {
        if (this.layers.length <= 1 || !this.layers[i]) return false;
        this._dropLayer(this.layers[i]);
        this.layers.splice(i, 1);
        if (this.activeIndex >= this.layers.length) this.activeIndex = this.layers.length - 1;
        else if (this.activeIndex > i) this.activeIndex--;
        this._resolveSidechains();
        this.emit('layers');
        this.emit('select');
        this.edited('Delete layer');
        return true;
    }

    duplicateLayer(i) {
        const src = this.layers[i];
        if (!src || this.layers.length >= MAX_LAYERS) return null;
        const data = this._layerData(src);
        delete data.uid;
        delete data.color;
        data.name = src.name + ' Copy';
        data.muted = false;
        return this.addLayer(data, 'Duplicate layer');
    }

    selectLayer(i) {
        if (!this.layers[i] || (i === this.activeIndex && !this.editingMic)) return;
        this.activeIndex = i;
        this.editingMic = false;
        this.emit('select');
    }

    selectMic() {
        if (!this.mic || this.editingMic) return;
        this.editingMic = true;
        this.emit('select');
    }

    // ---- layer edits ---------------------------------------------------------

    setStep(i, step, midi) {
        const l = this.layers[i];
        if (!l || step < 0 || step >= NUM_STEPS) return;
        l.steps[step] = midi == null ? null : midi;
        this.emit('layers');
        this.edited(midi == null ? 'Clear step' : 'Set step');
    }

    setLayer(i, key, value) {
        const l = this.layers[i];
        if (!l || l[key] === value) return;
        l[key] = value;
        this.emit('layers');
        this.edited({ muted: 'Mute', mode: 'Seq/Arp mode', arpPattern: 'Arp pattern', name: 'Rename' }[key] || key);
    }

    /** Give a layer its automation lane (default target) or take it away. */
    toggleAutomation(i) {
        const l = this.layers[i];
        if (!l) return;
        l.automation = l.automation.length ? [] : [{ target: 'filter-freq', interpMode: 'linear', points: [] }];
        if (!l.automation.length) applyBus(this.ctx, l.rt, l.sound);   // undo whatever the lane left behind
        this.emit('layers');
        this.edited('Automation');
    }

    /** After an automation lane was edited in place (points, target, mode). */
    automationEdited(i, key) {
        if (this.layers[i]) this.edited('Edit automation', 'auto:' + i + ':' + (key || ''));
    }

    /** Point a layer's lane at another target (its points no longer apply). */
    setAutomationTarget(i, target) {
        const lane = this.layers[i] && this.layers[i].automation[0];
        if (!lane || !AUTOMATION_TARGETS[target] || lane.target === target) return;
        lane.target = target;
        lane.points = [];
        applyBus(this.ctx, this.layers[i].rt, this.layers[i].sound);
        this.emit('layers');
        this.edited('Automation target');
    }

    /** Cycle a lane's interpolation: linear -> smooth -> step. */
    cycleInterp(i) {
        const lane = this.layers[i] && this.layers[i].automation[0];
        if (!lane) return;
        lane.interpMode = INTERP_MODES[(INTERP_MODES.indexOf(lane.interpMode) + 1) % INTERP_MODES.length];
        this.emit('layers');
        this.edited('Automation mode');
    }

    // ---- sound edits -----------------------------------------------------------

    /**
     * The sidebar wrote `path` ('delay.mix', 'eq.bands.3', 'waveform') into the
     * active signal's sound: push it to the engine and record the edit.
     */
    soundEdited(path) {
        const s = this.activeSignal();
        if (!s) return;
        applyBusParam(this.ctx, s.rt, s.sound, path);
        this.edited('Edit ' + path, 'sound:' + path);
    }

    /** Replace the active signal's sound (+ the LFO): a preset. */
    applyPreset(preset, name) {
        const s = this.activeSignal();
        if (!s || !preset) return;
        s.sound = withDefaults(preset.sound);
        if (preset.lfo) this.lfo = lfoWithDefaults(preset.lfo);
        applyBus(this.ctx, s.rt, s.sound);
        this._lfo.apply(this.lfo);
        this.emit('sound');
        this.edited('Preset ' + (name || ''));
    }

    lfoEdited(key) {
        this._lfo.apply(this.lfo);
        this.edited('Edit LFO ' + key, 'lfo:' + key);
    }

    setBpm(bpm) {
        bpm = Math.max(30, Math.min(300, Math.round(bpm)));
        if (bpm === this.bpm) return;
        this.bpm = bpm;
        this.emit('tempo');
        this.edited('Tempo', 'bpm');
    }

    // ---- mic -------------------------------------------------------------------

    /** Create the mic signal (its own bus, routed from the mic monitor). */
    enableMicSignal() {
        if (this.mic) return this.mic;
        const mic = { name: 'Mic', color: MIC_COLOR, sound: this.micSound };
        mic.rt = createBusRt(this.ctx, (uid) => this._busOf(uid));
        applyBus(this.ctx, mic.rt, mic.sound);
        if (this.ctx) this.ctx.micBus = mic.rt.bus;
        this.mic = mic;
        this.emit('layers');
        return mic;
    }

    // ---- document --------------------------------------------------------------

    _layerData(l) {
        return {
            uid: l.uid, name: l.name, color: l.color, muted: l.muted, mode: l.mode,
            arpPattern: l.arpPattern, steps: l.steps.slice(), automation: clone(l.automation),
            sound: clone(l.sound),
        };
    }

    serialize() {
        return {
            bpm: this.bpm,
            lfo: clone(this.lfo),
            active: this.activeIndex,
            layers: this.layers.map((l) => this._layerData(l)),
            mic: clone(this.mic ? this.mic.sound : this.micSound),
        };
    }

    /**
     * Load a serialized song, reusing existing layers (and their buses) where
     * the count allows, so undoing a slider tweak does not cut the sound.
     */
    load(data) {
        const d = data || {};
        const want = (Array.isArray(d.layers) && d.layers.length ? d.layers : [{}]).slice(0, MAX_LAYERS);
        const bpm = Number(d.bpm);
        this.bpm = Number.isFinite(bpm) && bpm > 0 ? Math.max(30, Math.min(300, Math.round(bpm))) : 120;
        this.lfo = lfoWithDefaults(d.lfo);
        while (this.layers.length > want.length) this._dropLayer(this.layers.pop());
        want.forEach((ld, i) => {
            const cur = this.layers[i];
            if (!cur) { this.layers.push(this._makeLayer(ld)); return; }
            cur.uid = ld.uid || cur.uid;
            cur.name = ld.name || 'Layer ' + (i + 1);
            cur.color = ld.color || COLORS[i % COLORS.length];
            cur.muted = !!ld.muted;
            cur.mode = ld.mode === 'arpeggiator' ? 'arpeggiator' : 'sequencer';
            cur.arpPattern = ARP_PATTERNS[ld.arpPattern] ? ld.arpPattern : 'up';
            cur.steps = cleanSteps(ld.steps);
            cur.automation = cleanAutomation(ld.automation);
            cur.sound = withDefaults(ld.sound);
            this._uid = Math.max(this._uid, cur.uid + 1);
            applyBus(this.ctx, cur.rt, cur.sound);
        });
        this.micSound = withDefaults(d.mic);
        if (this.mic) { this.mic.sound = this.micSound; applyBus(this.ctx, this.mic.rt, this.mic.sound); }
        this.activeIndex = Math.max(0, Math.min(this.layers.length - 1, d.active | 0));
        if (!this.mic) this.editingMic = false;
        this._resolveSidechains();
        this._lfo.apply(this.lfo);
        this.emit('all');
    }

    /** Back to one default layer at 120 BPM. */
    reset() {
        for (const l of this.layers) this._dropLayer(l);
        this.layers = [];
        this.editingMic = false;
        this.load({ layers: [{ name: 'Layer 1' }] });
    }

    get lfoRoute() { return this._lfo; }
}
