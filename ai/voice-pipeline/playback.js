// Reply playback: back-to-back scheduled clips on the shared AudioContext,
// the word highlight that follows them, and the three earcons (wake heard,
// utterance received, reply starting).
//
//   const player = createPlayer({ transcript: el, onDrained });
//   player.enqueue(samples, rate, { els, words })      exact word timings (Kokoro)
//   player.enqueue(samples, rate, { group, offsetSec }) estimated (Qwen3-TTS)
//   player.cue('wake' | 'receipt' | 'reply'); player.stop(); player.busy

import { audioContext } from "/lib/kit/audio.js";

export const EARCONS = {
    wake:    { notes: [{ freq: 880, durMs: 80 }], gain: 0.5 },
    receipt: { notes: [{ freq: 660, durMs: 55 }, { freq: 440, durMs: 75 }], gain: 0.5 },
    reply:   { notes: [{ freq: 523.25, durMs: 70, gain: 0.7 }, { freq: 659.25, durMs: 70, gain: 0.7 },
                       { freq: 783.99, durMs: 95, gain: 0.8 }], gain: 0.35, attackMs: 8, releaseMs: 35 },
};

/** Render a note sequence (raised-cosine attack/release, gaps between notes) to mono PCM. */
export function buildEarcon(notes, sampleRate, opts) {
    const o = Object.assign({ gapMs: 18, attackMs: 5, releaseMs: 20 }, opts);
    const gap = Math.floor(sampleRate * o.gapMs / 1000);
    const attack = Math.floor(sampleRate * o.attackMs / 1000);
    const release = Math.floor(sampleRate * o.releaseMs / 1000);
    const lens = notes.map((n) => Math.floor(sampleRate * n.durMs / 1000));
    const total = lens.reduce((a, b) => a + b, 0) + gap * Math.max(0, notes.length - 1);
    const buf = new Float32Array(total);
    let off = 0;
    notes.forEach((n, k) => {
        const len = lens[k], gain = n.gain != null ? n.gain : 1, w = 2 * Math.PI * n.freq / sampleRate;
        for (let i = 0; i < len; i++) {
            const env = i < attack ? 0.5 - 0.5 * Math.cos(Math.PI * i / attack)
                      : i > len - release ? 0.5 + 0.5 * Math.cos(Math.PI * (i - (len - release)) / release)
                      : 1;
            buf[off + i] = gain * env * Math.sin(w * i);
        }
        off += len + gap;
    });
    return buf;
}

const SCHED_LEAD = 0.06;        // s of headroom before the first clip starts
const QWEN_CHUNK_SEC = 0.08;    // expected chunk length while a Qwen sentence's total is unknown

export function createPlayer({ transcript, onDrained }) {
    const ctx = audioContext();
    const rate = ctx.sampleRate || 44100;
    const cues = {};
    for (const k of Object.keys(EARCONS)) {
        try { cues[k] = ctx.createClip(buildEarcon(EARCONS[k].notes, rate, EARCONS[k]), 1); }
        catch (e) { console.warn('earcon ' + k + ' failed: ' + e.message); }
    }

    let scheduled = [], nextStart = 0, timer = 0, lit = null;

    function highlight(el) {
        if (el === lit) return;
        if (lit) lit.classList.remove('speaking');
        if (el) el.classList.add('speaking');
        lit = el;
    }

    function activeWord(cur, now) {
        if (cur.words) {
            const pos = now - cur.startSec;
            const i = cur.words.findIndex((w) => pos >= w.startSec && pos < w.endSec);
            return i >= 0 ? cur.els[i] : null;
        }
        if (cur.group) {
            const g = cur.group, pos = cur.offsetSec + (now - cur.startSec);
            const est = g.totalSec || g.receivedSec + QWEN_CHUNK_SEC;
            const i = g.fracs.findIndex((f) => pos >= f.start * est && pos < f.end * est);
            return i >= 0 ? g.els[i] : null;
        }
        return null;
    }

    function tick() {
        const now = ctx.currentTime;
        while (scheduled.length && scheduled[0].endSec <= now) {
            try { ctx.deleteClip(scheduled.shift().clipId); } catch (_) {}
        }
        if (!scheduled.length) {
            clearInterval(timer); timer = 0;
            highlight(null);
            if (onDrained) onDrained();
            return;
        }
        const cur = scheduled[0];
        highlight(cur.startSec > now ? null : activeWord(cur, now));
    }

    return {
        cue(name) {
            if (cues[name] == null) return;
            try { ctx.playClip(cues[name], EARCONS[name].gain, false); } catch (_) {}
        },
        enqueue(samples, sampleRate, meta) {
            const when = Math.max(ctx.currentTime + SCHED_LEAD, nextStart);
            const dur = samples.length / sampleRate;
            let clipId, playbackId;
            try {
                clipId = ctx.createClip(samples, 1, sampleRate);
                playbackId = ctx.playClip(clipId, 1.0, false, when);
            } catch (e) { console.warn('playback failed: ' + e.message); return; }
            nextStart = when + dur;
            scheduled.push(Object.assign({ clipId, playbackId, startSec: when, endSec: when + dur }, meta));
            if (!timer) timer = setInterval(tick, 30);
        },
        stop() {
            if (timer) { clearInterval(timer); timer = 0; }
            for (const it of scheduled) {
                try { ctx.stopPlayback(it.playbackId); } catch (_) {}
                try { ctx.deleteClip(it.clipId); } catch (_) {}
            }
            scheduled = []; nextStart = 0; lit = null;
            if (transcript) transcript.querySelectorAll('.word.speaking').forEach((el) => el.classList.remove('speaking'));
        },
        get busy() { return scheduled.length > 0; },
        /** Seconds of reply audio still queued. */
        get queuedSec() { return scheduled.length ? Math.max(0, nextStart - ctx.currentTime) : 0; },
    };
}
