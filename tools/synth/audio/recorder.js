// audio/recorder.js — the engine's output recorder, shared by the
// sequencer's Rec (a live take saved as WAV) and the clip editor's Rec (a
// take loaded as the clip). There is one capture, so one owner at a time.

export function createRecorder(ctx) {
    let owner = null;
    return {
        /** Start capturing the output mix for `who`; false while someone else records. */
        start(who) {
            if (!ctx || owner) return false;
            ctx.startRecording();
            owner = who;
            return true;
        },
        /** Stop and return the mono take at ctx.sampleRate (null when empty). */
        stop() {
            if (!owner) return null;
            owner = null;
            const pcm = ctx.stopRecording();
            return pcm && pcm.length ? pcm : null;
        },
        get owner() { return owner; },
        get rate() { return ctx ? ctx.sampleRate : 44100; },
    };
}
