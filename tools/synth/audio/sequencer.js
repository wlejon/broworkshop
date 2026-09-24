// audio/sequencer.js — the song's layers as native broaudio Sequences.
//
// One looping 4-beat Sequence per audible layer (not muted, has notes or an
// automation lane), each driving that layer's own allocator, so layers keep
// their own sounds with no voice-setup swapping. update() runs once a frame:
// it fires what is due and reports the current 16th step. Edits while
// playing (invalidate()) rebuild the notes in place; a layer that becomes
// audible mid-loop joins at the running beat.

import { NUM_STEPS, AUTOMATION_TARGETS } from "../model/song.js";
import { applyBus } from "./sound.js";

const STEP_BEATS = 0.25;              // a step is a 16th note
const LOOP_BEATS = NUM_STEPS * STEP_BEATS;
const GATE = 0.9;                     // note length, in steps

/** Pick the k-th arpeggio note from the sorted held notes. */
function arpPick(held, pattern, k, random) {
    const n = held.length;
    switch (pattern) {
        case 'down': return held[n - 1 - (k % n)];
        case 'updown': {
            if (n === 1) return held[0];
            const cycle = 2 * n - 2, p = k % cycle;
            return p < n ? held[p] : held[cycle - p];
        }
        case 'random': return held[Math.floor(random() * n)];
        default: return held[k % n];
    }
}

/**
 * The note each step plays (MIDI or null). Sequencer mode: the steps as
 * written. Arpeggiator mode: every filled step plays the next note of the
 * pattern over the distinct notes of the grid.
 */
export function stepNotes(layer, random) {
    const steps = layer.steps;
    if (layer.mode !== 'arpeggiator') return steps.slice();
    const held = Array.from(new Set(steps.filter((n) => n != null))).sort((a, b) => a - b);
    const out = new Array(steps.length).fill(null);
    let k = 0;
    for (let s = 0; s < steps.length; s++) {
        if (steps[s] != null) out[s] = arpPick(held, layer.arpPattern, k++, random || Math.random);
    }
    return out;
}

/** Whether a layer has anything to play. */
export function audible(layer) {
    return !layer.muted && (layer.steps.some((n) => n != null) ||
        layer.automation.some((a) => a.points.length > 0));
}

function laneSetter(ctx, layer, target) {
    const rt = layer.rt;
    switch (target) {
        case 'filter-freq': return (v) => ctx.setBusFilterFrequency(rt.bus, rt.slot, v);
        case 'filter-q':    return (v) => ctx.setBusFilterQ(rt.bus, rt.slot, v);
        case 'delay-mix':   return (v) => ctx.setBusDelayMix(rt.bus, v);
        case 'reverb-mix':  return (v) => ctx.setBusReverbMix(rt.bus, v);
        case 'chorus-mix':  return (v) => ctx.setBusChorusMix(rt.bus, v);
        case 'volume':      return (v) => ctx.setBusGain(rt.bus, v);
        case 'pan':         return (v) => ctx.setBusPan(rt.bus, v);
        default:            return () => {};
    }
}

function loadNotes(seq, layer) {
    seq.clearNotes();
    stepNotes(layer).forEach((midi, s) => {
        if (midi != null) seq.addNote(s * STEP_BEATS, midi, 1.0, STEP_BEATS * GATE);
    });
}

function loadAutomation(ctx, seq, layer) {
    seq.clearAutomationLanes();
    for (const a of layer.automation) {
        if (!a.points.length || !AUTOMATION_TARGETS[a.target]) continue;
        const lane = seq.addAutomationLane(laneSetter(ctx, layer, a.target));
        seq.setAutomationInterpMode(lane, a.interpMode);
        for (const p of a.points) seq.addAutomationPoint(lane, p.beat, p.value);
    }
}

export function createSequencer(ctx, song) {
    const running = new Map();     // layer uid -> { seq, layer }
    const listeners = [];
    let playing = false, dirty = false, step = -1;

    const emit = () => { for (const fn of listeners) fn(step); };

    function makeSeq(layer) {
        const seq = ctx.createSequence(layer.alloc);
        seq.setBPM(song.bpm);
        seq.setLoopEnabled(true);
        seq.setLoopRange(0, LOOP_BEATS);
        return seq;
    }

    /** Bring the running sequences in line with the song. */
    function sync() {
        dirty = false;
        const now = ctx.currentTime;
        const want = new Map();
        for (const l of song.layers) if (l.alloc && audible(l)) want.set(l.uid, l);
        let beat = null;
        for (const [uid, r] of running) {
            if (beat === null) beat = r.seq.currentBeat(now);
            const l = want.get(uid);
            if (!l) {
                r.seq.stop();
                if (r.layer.alloc) r.layer.alloc.allNotesOff();
                applyBus(ctx, r.layer.rt, r.layer.sound);   // drop automated values
                running.delete(uid);
                continue;
            }
            r.layer = l;
            loadNotes(r.seq, l);
            loadAutomation(ctx, r.seq, l);
            want.delete(uid);
        }
        // Newcomers start in phase with the rest: play from the synced start,
        // advance past the current beat with no notes, then load the notes so
        // only the rest of this loop fires.
        const start = now - (beat || 0) * 60 / song.bpm;
        for (const [uid, l] of want) {
            const seq = makeSeq(l);
            seq.play(running.size ? start : now);
            seq.update(now);
            loadNotes(seq, l);
            loadAutomation(ctx, seq, l);
            running.set(uid, { seq, layer: l });
        }
    }

    const api = {
        on(fn) { listeners.push(fn); },
        get playing() { return playing; },
        /** The 16th step under the playhead, -1 when stopped. */
        get step() { return step; },
        get sequenceCount() { return running.size; },

        start() {
            if (playing || !ctx) return;
            playing = true;
            step = -1;
            sync();
            api.update();
        },

        stop() {
            if (!playing) return;
            playing = false;
            for (const r of running.values()) {
                r.seq.stop();
                if (r.layer.alloc) r.layer.alloc.allNotesOff();
                applyBus(ctx, r.layer.rt, r.layer.sound);
            }
            running.clear();
            step = -1;
            emit();
        },

        toggle() { if (playing) api.stop(); else api.start(); return playing; },

        /** The song changed: rebuild the notes before the next update. */
        invalidate() { if (playing) dirty = true; },

        /** Keep the tempo continuous at the current beat. */
        tempoChanged() {
            const now = ctx ? ctx.currentTime : 0;
            for (const r of running.values()) r.seq.setBPM(song.bpm, now);
        },

        /** Once a frame: fire due notes and automation, track the step. */
        update() {
            if (!playing) return;
            if (dirty) sync();
            const now = ctx.currentTime;
            for (const r of running.values()) r.seq.update(now);
            const first = running.values().next().value;
            const s = first ? Math.floor(first.seq.currentBeat(now) / STEP_BEATS) % NUM_STEPS : -1;
            if (s !== step) {
                const wrapped = s >= 0 && s < step;
                step = s;
                // a random arpeggio re-rolls every loop
                if (wrapped) {
                    for (const r of running.values()) {
                        if (r.layer.mode === 'arpeggiator' && r.layer.arpPattern === 'random') loadNotes(r.seq, r.layer);
                    }
                }
                emit();
            }
        },
    };
    return api;
}
