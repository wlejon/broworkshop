// Utterance capture: the bro.mic tap (16 kHz, 10 ms chunks), the "computer"
// wake word (bro.wake), and end-of-utterance detection for hands-free turns.
//
//   const cap = createCapture({ onStart(fromWake), onUtterance(samples16k), onAbort(reason), onLevel(0..1) });
//   cap.startWake(weightsPath, onFire)   // hands-free: onFire -> cap.start(true)
//   cap.start(fromWake) / cap.stop()     // push-to-talk: start on press, stop on release
//
// A wake-triggered capture ends itself: after MIN_SPEECH_MS of speech then
// EOU_SILENCE_MS of silence, at MAX_CAPTURE_MS, or (aborted) when nobody
// speaks within NO_SPEECH_ABORT_MS. Wake detection is suspended while
// recording so the detector does not hear the utterance.

import { concatPcm } from "/lib/kit/audio.js";

export const MIC_RATE = 16000;
const CHUNK_FRAMES = 160, CHUNK_MS = 10;
export const SPEECH_THRESH = 0.015;       // chunk peak counted as speech
const MIN_SPEECH_MS = 250;
const EOU_SILENCE_MS = 800;
const NO_SPEECH_ABORT_MS = 3000;
const MAX_CAPTURE_MS = 10000;
const MIN_UTTERANCE_SEC = 0.25;
export const WAKE_THRESHOLD = 0.85;

export function createCapture({ onStart, onUtterance, onAbort, onLevel }) {
    let micOpen = false, recording = false, fromWake = false;
    let chunks = [], recMs = 0, speechMs = 0, silenceMs = 0;
    let wakeOn = false;

    const wake = (fn) => { if (wakeOn) { try { fn(); } catch (_) {} } };
    const suspendWake = () => wake(() => { if (!bro.wake.isSuspended()) bro.wake.suspend(); });
    const resumeWake = () => wake(() => { if (bro.wake.isSuspended()) bro.wake.resume(); });

    function openMic() {
        if (micOpen) return;
        bro.mic.start({ chunkFrames: CHUNK_FRAMES, targetRate: MIC_RATE, samples: true, agc: false, onChunk });
        micOpen = true;
    }

    function onChunk(c) {
        if (!recording) return;
        chunks.push(c.samples.slice());
        recMs += CHUNK_MS;
        if (onLevel) onLevel(Math.min(1, c.peak * 2));
        if (c.peak >= SPEECH_THRESH) { speechMs += CHUNK_MS; silenceMs = 0; }
        else silenceMs += CHUNK_MS;
        if (!fromWake) return;
        if (recMs >= MAX_CAPTURE_MS) api.stop();
        else if (speechMs === 0 && recMs >= NO_SPEECH_ABORT_MS) abort('no speech');
        else if (speechMs >= MIN_SPEECH_MS && silenceMs >= EOU_SILENCE_MS) api.stop();
    }

    function end() {
        recording = false; fromWake = false;
        const out = chunks.length ? concatPcm(chunks) : new Float32Array(0);
        chunks = [];
        return out;
    }

    function abort(reason) {
        if (!recording) return;
        end();
        resumeWake();
        if (onAbort) onAbort(reason);
    }

    const api = {
        /** Listen for "computer"; onFire() when it is heard. Throws when bro.wake cannot start. */
        startWake(weights, onFire) {
            bro.wake.listen({ weights, threshold: WAKE_THRESHOLD, onFire });
            wakeOn = true;
        },
        /** Latest wake score (0..1), for the idle meter. */
        wakeScore() { try { return wakeOn ? bro.wake.lastScore() || 0 : 0; } catch (_) { return 0; } },
        get wakeActive() { return wakeOn; },
        resumeWake,

        /** Open a capture (opens the mic on first use; throws when it cannot). */
        start(wakeTriggered) {
            if (recording) return;
            openMic();
            chunks = []; recMs = speechMs = silenceMs = 0;
            recording = true; fromWake = !!wakeTriggered;
            suspendWake();
            if (onStart) onStart(fromWake);
        },
        /** Close the capture and hand the utterance on (too-short ones abort). */
        stop() {
            if (!recording) return;
            const samples = end();
            resumeWake();
            if (samples.length < MIC_RATE * MIN_UTTERANCE_SEC) { if (onAbort) onAbort('too short'); return; }
            onUtterance(samples);
        },
        get recording() { return recording; },
        get fromWake() { return fromWake; },
    };
    return api;
}
