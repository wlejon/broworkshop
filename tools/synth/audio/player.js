// audio/player.js — live notes: the piano, the computer keys and MIDI all
// play through here, on the selected layer's allocator (or, in clip
// instrument mode, as a pitched playback of the clip editor's clip).
//
// Listeners get { midi, on } for every note that starts or stops, which is
// how the piano lights keys and the status bar names the note.

import { LOWEST, HIGHEST } from "./notes.js";

/** The clip plays at its recorded pitch on this key (C4). */
export const CLIP_BASE_NOTE = 60;

export function createPlayer(ctx, song) {
    const held = new Map();    // midi -> { alloc } | { pb }
    const listeners = [];
    let clipId = -1;
    let lastNote = 48;         // C3: what a clicked step gets before anything was played

    const emit = (ev) => { for (const fn of listeners) fn(ev); };

    const api = {
        on(fn) { listeners.push(fn); },

        noteOn(midi, velocity) {
            if (!ctx || midi < LOWEST || midi > HIGHEST || held.has(midi)) return false;
            const layer = song.activeLayer();
            if (!layer) return false;
            const vel = velocity == null ? 1 : velocity;
            if (clipId >= 0) {
                const pb = ctx.playClip(clipId, vel, false);
                if (pb < 0) return false;
                ctx.setPlaybackRate(pb, Math.pow(2, (midi - CLIP_BASE_NOTE) / 12));
                if (layer.sound.pan) ctx.setPlaybackPan(pb, layer.sound.pan);
                ctx.setPlaybackBus(pb, layer.rt.bus);
                held.set(midi, { pb });
            } else {
                if (!layer.alloc) return false;
                layer.alloc.noteOn(midi, vel, ctx.currentTime);
                held.set(midi, { alloc: layer.alloc });
            }
            lastNote = midi;
            emit({ midi, on: true });
            return true;
        },

        noteOff(midi) {
            const e = held.get(midi);
            if (!e) return false;
            if (e.pb !== undefined) ctx.stopPlayback(e.pb);
            else e.alloc.noteOff(midi, ctx.currentTime);
            held.delete(midi);
            emit({ midi, on: false });
            return true;
        },

        allOff() { for (const m of Array.from(held.keys())) api.noteOff(m); },

        isHeld(midi) { return held.has(midi); },
        get heldNotes() { return Array.from(held.keys()); },
        get lastNote() { return lastNote; },

        /** Play a clip (engine clip id) pitched across the keyboard; -1 = back to the oscillators. */
        setClipInstrument(id) { api.allOff(); clipId = id == null ? -1 : id; },
        get clipInstrument() { return clipId; },
    };
    return api;
}
