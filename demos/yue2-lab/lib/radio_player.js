// The radio's player: one append-only engine stream for the program audio.
//
// yue.stream hands out the program timeline from sample 0 in contiguous
// planar chunks, crossfades already mixed in, and only emitLeadSeconds ahead
// of the playhead this player reports. So there is no prebuffer (it would
// wait for audio the stream will not hand out yet): the engine stream opens
// with the first chunk and plays at once, and the playhead is what the mixer
// has consumed of what was pushed, in program samples. Chunks that do not fit
// the ring wait in a queue that tick() drains.

import { audioContext, resample } from "/lib/kit/audio.js";
import { interleave } from "./player.js";

const PROGRAM_RATE = 48000;

export function programPlayer() {
    let pb = -1, ringSec = 4;
    let queue = [], queuedFrames = 0;      // interleaved, engine rate
    let pushed = 0;                        // program samples received
    let playedAtClose = 0, underrunAtClose = 0;

    const ctx = () => audioContext();
    const engineRate = () => ctx().sampleRate || PROGRAM_RATE;

    function streamStats() {
        if (pb < 0) return null;
        try { return ctx().getStreamStats(pb); } catch (e) { return null; }
    }

    function drain() {
        if (pb < 0) return;
        while (queue.length) {
            const head = queue[0];
            const wrote = ctx().pushStreamSamples(pb, head);
            if (wrote * 2 >= head.length) { queue.shift(); queuedFrames -= head.length / 2; continue; }
            if (wrote > 0) { queue[0] = head.subarray(wrote * 2); queuedFrames -= wrote; }
            break;
        }
    }

    const api = {
        /** A new program: forget the old one. ringSeconds should exceed the emit lead. */
        reset(ringSeconds) {
            api.stop();
            ringSec = Math.max(2, ringSeconds || 4);
            queue = []; queuedFrames = 0; pushed = 0; playedAtClose = 0; underrunAtClose = 0;
        },
        /** One onAudio chunk (planar stereo, program rate, contiguous). */
        push(c) {
            const er = engineRate();
            let l = c.samples.subarray(0, c.frames), r = c.samples.subarray(c.frames, 2 * c.frames);
            if (Math.abs(er - c.sampleRate) >= 1) { l = resample(l, c.sampleRate, er); r = resample(r, c.sampleRate, er); }
            const inter = interleave(l, r);
            queue.push(inter);
            queuedFrames += inter.length / 2;
            pushed = c.sample0 + c.frames;
            if (pb < 0) {
                // Opened with the first chunk, so the mixer plays no silence
                // before program sample 0.
                try { pb = ctx().createStream(2, Math.round(ringSec * er)); } catch (e) { pb = -1; throw e; }
            }
            drain();
        },
        /** Once a frame: feed the ring; returns the playhead in program samples. */
        tick() { drain(); return api.playhead(); },
        /** Program samples played (what the stream's setPlayhead wants). */
        playhead() {
            const s = streamStats();
            const played = s ? s.playedFrames : playedAtClose;
            return Math.min(pushed, Math.round(played * PROGRAM_RATE / engineRate()));
        },
        stop() {
            const s = streamStats();
            if (s) { playedAtClose = s.playedFrames; underrunAtClose = s.underrunFrames; }
            if (pb >= 0) { try { ctx().closeStream(pb); } catch (e) { /* gone */ } }
            pb = -1;
        },
        stats() {
            const s = streamStats(), er = engineRate();
            return {
                pushedSec: pushed / PROGRAM_RATE,
                bufferedSec: ((s ? s.bufferedFrames : 0) + queuedFrames) / er,
                underrunSec: (s ? s.underrunFrames : underrunAtClose) / er,
                playing: pb >= 0,
            };
        },
    };
    return api;
}
