// model/presets.js — factory and user presets.
//
// A preset is a layer sound plus an LFO setting: { sound, lfo }. Sounds are
// partial (withDefaults fills the rest), so the factory table only lists
// what makes each one itself. User presets persist in localStorage; older
// saves stored the sound flat (no `sound` key) and still load.

import { prefStore } from "/lib/kit/prefs.js";
import { withDefaults } from "../audio/sound.js";
import { lfoWithDefaults } from "../audio/lfo.js";

export const FACTORY = {
    'Init': { sound: {}, lfo: {} },
    'Warm Pad': {
        sound: {
            waveform: 'sawtooth', adsr: { attack: 0.5, decay: 0.4, sustain: 0.6, release: 1.2 },
            filter: { enabled: true, type: 'lowpass', frequency: 800, Q: 1.5 },
            delay: { enabled: true, time: 0.45, feedback: 0.35, mix: 0.2 },
            reverb: { enabled: true, roomSize: 0.8, damping: 0.4, mix: 0.35 },
            chorus: { enabled: true, rate: 0.5, depth: 0.004, mix: 0.3, baseDelay: 0.008 },
        },
        lfo: { enabled: true, rate: 0.3, depth: 0.25, target: 'filter' },
    },
    'Bass': {
        sound: {
            waveform: 'square', adsr: { attack: 0.005, decay: 0.25, sustain: 0.35, release: 0.1 },
            filter: { enabled: true, type: 'lowpass', frequency: 400, Q: 2.5 },
            reverb: { roomSize: 0.3, damping: 0.7, mix: 0.1 },
            compressor: { enabled: true, threshold: -10, ratio: 6, attack: 5, release: 80 },
        },
        lfo: {},
    },
    'Lead': {
        sound: {
            waveform: 'sawtooth', adsr: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.25 },
            filter: { enabled: true, type: 'lowpass', frequency: 2500, Q: 3 },
            delay: { enabled: true, time: 0.3, feedback: 0.3, mix: 0.2 },
            reverb: { enabled: true, roomSize: 0.5, damping: 0.5, mix: 0.15 },
        },
        lfo: { enabled: true, rate: 4.5, depth: 0.1, target: 'pitch' },
    },
    'Pluck': {
        sound: {
            waveform: 'triangle', adsr: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.15 },
            filter: { enabled: true, type: 'lowpass', frequency: 3000, Q: 1.5 },
            delay: { enabled: true, time: 0.2, feedback: 0.25, mix: 0.15 },
            reverb: { enabled: true, roomSize: 0.4, damping: 0.6, mix: 0.2 },
        },
        lfo: {},
    },
    'Acid': {
        sound: {
            waveform: 'sawtooth', adsr: { attack: 0.005, decay: 0.15, sustain: 0, release: 0.05 },
            filter: { enabled: true, type: 'lowpass', frequency: 600, Q: 10 },
            delay: { enabled: true, time: 0.15, feedback: 0.4, mix: 0.2 },
            compressor: { enabled: true, threshold: -8, ratio: 8, attack: 3, release: 50 },
        },
        lfo: { enabled: true, rate: 2.5, depth: 0.7, waveform: 'sawtooth', target: 'filter' },
    },
    'Ambient': {
        sound: {
            waveform: 'sine', adsr: { attack: 1, decay: 0.8, sustain: 0.4, release: 2 },
            filter: { enabled: true, type: 'lowpass', frequency: 1200, Q: 0.7 },
            delay: { enabled: true, time: 0.6, feedback: 0.5, mix: 0.3 },
            reverb: { enabled: true, roomSize: 0.9, damping: 0.3, mix: 0.5 },
            chorus: { enabled: true, rate: 0.3, depth: 0.005, mix: 0.4, feedback: 0.1, baseDelay: 0.01 },
        },
        lfo: { enabled: true, rate: 0.15, depth: 0.4, target: 'filter' },
    },
};

/** Complete a stored or factory preset: { sound, lfo } with every field. */
export function normalizePreset(p) {
    if (!p) return null;
    const flat = !p.sound;   // older user presets stored the sound itself
    return { sound: withDefaults(flat ? p : p.sound), lfo: lfoWithDefaults(p.lfo) };
}

/** The preset list: factory first, then the user's (persisted under `key`). */
export function presetStore(key) {
    const store = prefStore(key || 'synth-presets', {});
    const user = store.data;
    return {
        names() { return Object.keys(FACTORY).concat(Object.keys(user).filter((n) => !FACTORY[n])); },
        isFactory(name) { return !!FACTORY[name]; },
        get(name) { return normalizePreset(FACTORY[name] || user[name]); },
        /** Save as a user preset; a factory name gets "My " in front. Returns the name used. */
        save(name, sound, lfo) {
            if (FACTORY[name]) name = 'My ' + name;
            user[name] = JSON.parse(JSON.stringify({ sound, lfo }));
            store.save();
            return name;
        },
        remove(name) {
            if (FACTORY[name] || !user[name]) return false;
            delete user[name];
            store.save();
            return true;
        },
        store,
    };
}
