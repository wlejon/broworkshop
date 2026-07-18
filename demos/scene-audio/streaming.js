// streaming.js — the same file, two ways: decoded into RAM vs streamed off disk.
//
// ctx.createStreamFromFile() plays a file without ever holding it in memory. A
// worker thread decodes incrementally, resamples to the engine rate, and feeds
// the same ring a live PCM stream uses; only the ring — about two seconds — is
// ever resident. The returned id is an ORDINARY playbackId, so gain, pan, bus
// routing, rate and spatialization all work on it exactly as they do on a clip.
//
// Nothing in the workshop had called it. Neither had anything called
// getStreamStats, which is the reason this module has a live readout instead of
// just a play button: a stream that is working and a stream that is quietly
// starving sound identical for the first second, and the difference is four
// numbers. Watching bufferedFrames sit near the ring size while playedFrames
// climbs is what "streaming is keeping up" actually looks like.
//
// The seek is the part worth staring at. Seeking a stream is a genuinely
// different operation from seeking a RAM clip: the clip just moves a cursor
// inside a buffer that is already there, while the stream seeks the CODEC,
// throws away everything buffered, and goes silent until the worker refills
// from the new file position. That gap is not a bug — it is counted, in
// underrunFrames. Whether any given seek actually costs a gap is a race with
// the decode worker, so watch the counter rather than expecting it to move.

import { assetPath, OGG_BED } from '/app/audio_sources.js';

export const streamState = {
    /** playbackId of the disk stream, or -1 before it opened. */
    id: -1,
    /** Error message if the open failed, else null. */
    error: null,
    /** Approximate file duration in seconds — the bed is 96 s by construction. */
    seconds: 96,
    /** Ring capacity in frames, as requested. */
    ringFrames: 0,
    /** Last stats object read from the engine. */
    stats: null,
    /** underrunFrames at the moment of the last seek, so the HUD can show the
     *  cost of THAT seek rather than the running total since load. */
    underrunAtSeek: 0,
    playing: true,
};

let ctxRef = null;
let els = null;

/**
 * Open the ambience bed as a disk stream on the given bus.
 *
 * Options are in ENGINE-rate frames. The defaults (~2 s ring, ~500 ms
 * prebuffer) are fine; they are passed explicitly here because the HUD reports
 * buffer fill as a percentage and needs to know what full means.
 */
export function buildStreaming(ctx, busId) {
    ctxRef = ctx;
    const ringFrames = Math.round(ctx.sampleRate * 2.0);
    streamState.ringFrames = ringFrames;

    try {
        streamState.id = ctx.createStreamFromFile(assetPath(OGG_BED), {
            ringFrames,
            prebufferFrames: Math.round(ctx.sampleRate * 0.5),
            loop: true,
            gain: 0.0,          // silent until the HUD unmutes it
        });
    } catch (e) {
        // Throws with the decode failure message — unreadable file,
        // unsupported codec, more than two channels. Surface it; a demo that
        // swallows this and plays nothing is worse than one that says why.
        streamState.error = e.message;
        return streamState;
    }

    ctx.setPlaybackBus(streamState.id, busId);
    return streamState;
}

/** Live stats, cached on streamState. Null once the handle is not streaming. */
export function readStreamStats() {
    if (streamState.id < 0) return null;
    streamState.stats = ctxRef.getStreamStats(streamState.id);
    return streamState.stats;
}

/** Seconds of the FILE the stream cursor is on — seek-aware. */
export function streamPositionSeconds() {
    if (streamState.id < 0) return 0;
    return ctxRef.getPlaybackPositionSeconds(streamState.id);
}

/**
 * Seek the stream. Note the return: the underrun delta this seek costs is not
 * known yet (the worker has not refilled), so the caller notes the baseline and
 * the HUD reports the growth.
 */
export function seekStream(seconds) {
    if (streamState.id < 0) return 0;
    const t = Math.max(0, Math.min(streamState.seconds, seconds));
    const st = ctxRef.getStreamStats(streamState.id);
    streamState.underrunAtSeek = st ? st.underrunFrames : 0;
    ctxRef.seekPlayback(streamState.id, t);
    return t;
}

export function setStreamGain(g) {
    if (streamState.id >= 0) ctxRef.setPlaybackGain(streamState.id, g);
}

export function setStreamPlaying(on) {
    streamState.playing = on;
    if (streamState.id >= 0) ctxRef.setPlaybackPlaying(streamState.id, on);
}

/** Wire the streaming panel. */
export function bindStreamingHud(ctx) {
    els = {
        state: document.getElementById('streamState'),
        buffer: document.getElementById('streamBuffer'),
        bufferBar: document.getElementById('streamBufferBar'),
        decoded: document.getElementById('streamDecoded'),
        played: document.getElementById('streamPlayed'),
        underrun: document.getElementById('streamUnderrun'),
        seekCost: document.getElementById('streamSeekCost'),
        gain: document.getElementById('streamGain'),
    };

    if (streamState.error) {
        els.state.textContent = `failed: ${streamState.error}`;
        els.state.className = 'v err';
        return;
    }

    els.state.textContent = 'streaming';
    els.gain.addEventListener('input', () => setStreamGain(parseFloat(els.gain.value)));
    setStreamGain(parseFloat(els.gain.value));
}

/** Repaint the stats readout. Called from the frame loop's slow lane. */
export function drawStreamStats() {
    if (!els || streamState.error || streamState.id < 0) return;
    const st = readStreamStats();
    if (!st) {
        els.state.textContent = 'closed';
        return;
    }

    // bufferedFrames against the ring capacity is the number that tells you
    // whether the decoder is winning. Comfortably full = healthy; sagging
    // toward zero = the next thing you hear is an underrun.
    const fill = Math.min(1, st.bufferedFrames / streamState.ringFrames);
    els.buffer.textContent = `${(fill * 100).toFixed(0)}%`;
    els.bufferBar.style.width = `${(fill * 100).toFixed(1)}%`;
    // Red once the ring is under a quarter full: at that point a scheduler
    // hiccup becomes audible.
    els.bufferBar.style.background = fill < 0.25 ? '#e06b6b' : '#4bd6a0';

    const sr = ctxRef.sampleRate;
    els.decoded.textContent = `${(st.decodedFrames / sr).toFixed(1)} s`;
    els.played.textContent = `${(st.playedFrames / sr).toFixed(1)} s`;
    els.underrun.textContent = st.underrunFrames > 0
        ? `${(st.underrunFrames / sr * 1000).toFixed(0)} ms`
        : 'none';

    const sinceSeek = st.underrunFrames - streamState.underrunAtSeek;
    els.seekCost.textContent = sinceSeek > 0
        ? `${(sinceSeek / sr * 1000).toFixed(0)} ms refill`
        : '—';

    els.state.textContent = st.finished ? 'finished' : 'streaming';
}
