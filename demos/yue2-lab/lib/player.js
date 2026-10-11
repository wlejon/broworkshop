// Streaming playback for decoded YuE2 chunks.
//
// bro.music hands audio over as planar stereo chunks at 48 kHz, in order. They
// go into one live engine stream (AudioContext.createStream +
// pushStreamSamples, interleaved at the engine rate). Playback starts once
// `prebufferSec` is queued, or when the song is finished, whichever comes
// first. The ring is sized for many seconds, and anything that does not fit
// waits in a queue that tick() drains each frame.
//
// The whole take also accumulates (planar), for replay, the waveform and WAV.

import { audioContext, resample, clipPlayer } from "/lib/kit/audio.js";

export function interleave(left, right) {
    const n = left.length, out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { out[2 * i] = left[i]; out[2 * i + 1] = right[i]; }
    return out;
}

export function streamPlayer(opts) {
    const o = Object.assign({ prebufferSec: 1.0, ringSec: 30 }, opts);
    let pb = -1, started = false, finished = false;
    let queue = [], queuedFrames = 0;          // interleaved, engine rate
    let parts = [], totalFrames = 0, rate = 48000;
    let firstChunkAt = 0, startedAt = 0, t0 = 0, lastUnderrun = 0;
    const replay = clipPlayer();

    const ctx = () => audioContext();
    const engineRate = () => ctx().sampleRate || 48000;

    function toEngine(chunk) {
        let l = chunk.samples.subarray(0, chunk.frames), r = chunk.samples.subarray(chunk.frames, 2 * chunk.frames);
        const er = engineRate();
        if (Math.abs(er - chunk.sampleRate) >= 1) { l = resample(l, chunk.sampleRate, er); r = resample(r, chunk.sampleRate, er); }
        return interleave(l, r);
    }

    function start() {
        if (started) return;
        started = true;
        startedAt = performance.now();
        try { pb = ctx().createStream(2, Math.round(o.ringSec * engineRate())); }
        catch (e) { pb = -1; if (o.onError) o.onError(e); }
        drain();
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
        /** Forget everything and stop (a new take). */
        reset() {
            api.stop();
            queue = []; queuedFrames = 0; parts = []; totalFrames = 0;
            started = false; finished = false; firstChunkAt = 0; startedAt = 0; lastUnderrun = 0;
            t0 = performance.now();
        },
        /** One decoded chunk (planar stereo, from onAudio / onChunk). */
        push(chunk) {
            if (!firstChunkAt) firstChunkAt = performance.now();
            rate = chunk.sampleRate;
            parts.push({ samples: chunk.samples.slice(0, 2 * chunk.frames), frames: chunk.frames });
            totalFrames += chunk.frames;
            if (o.live === false) return;
            const inter = toEngine(chunk);
            queue.push(inter);
            queuedFrames += inter.length / 2;
            if (!started && queuedFrames >= o.prebufferSec * engineRate()) start();
            else drain();
        },
        /** The song is complete: start now if the prebuffer was never reached. */
        finish() {
            finished = true;
            if (!started && queuedFrames > 0 && o.live !== false) start();
        },
        /** Call once a frame. */
        tick() {
            if (!started || pb < 0) return;
            drain();
            // Played out: close the stream so its silence is not counted as underrun.
            if (finished && !queue.length) {
                let s = null;
                try { s = ctx().getStreamStats(pb); } catch (e) { s = null; }
                if (s) lastUnderrun = s.underrunFrames;
                if (s && s.bufferedFrames <= 0) { try { ctx().closeStream(pb); } catch (e) { /* gone */ } pb = -1; }
            }
        },
        stop() {
            if (pb >= 0) { try { ctx().closeStream(pb); } catch (e) { /* gone */ } }
            pb = -1;
            replay.stop();
        },
        /** Play the accumulated take from the start (clip playback). */
        replay() {
            api.stop();
            const a = api.audio();
            if (!a) return 0;
            return replay.play(interleave(a.samples.subarray(0, a.frames), a.samples.subarray(a.frames)), a.sampleRate,
                               { channels: 2 });
        },
        /** The take so far: { samples (planar), channels: 2, frames, sampleRate } or null. */
        audio() {
            if (!totalFrames) return null;
            const out = new Float32Array(2 * totalFrames);
            let at = 0;
            for (const p of parts) {
                out.set(p.samples.subarray(0, p.frames), at);
                out.set(p.samples.subarray(p.frames), totalFrames + at);
                at += p.frames;
            }
            return { samples: out, channels: 2, frames: totalFrames, sampleRate: rate };
        },
        /** Replace the take wholesale (a loaded take, a finished non-streamed decode). */
        setAudio(a) {
            api.reset();
            if (!a || !a.frames) return;
            parts = [{ samples: a.samples, frames: a.frames }];
            totalFrames = a.frames;
            rate = a.sampleRate;
        },
        stats() {
            let s = null;
            if (pb >= 0) { try { s = ctx().getStreamStats(pb); } catch (e) { s = null; } }
            const er = engineRate();
            return {
                seconds: totalFrames / rate,
                firstAudioMs: firstChunkAt ? firstChunkAt - t0 : 0,
                playStartMs: startedAt ? startedAt - t0 : 0,
                bufferedSec: s ? s.bufferedFrames / er + queuedFrames / er : queuedFrames / er,
                underrunSec: (s ? s.underrunFrames : lastUnderrun) / er,
                playedSec: s ? s.playedFrames / er : -1,
                playing: pb >= 0,
                finished,
            };
        },
        set prebufferSec(v) { o.prebufferSec = v; },
        set live(v) { o.live = v; },
    };
    return api;
}
