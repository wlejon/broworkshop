// Audio playback scheduler and earcons for Voice Pipeline.

export const WAKE_NOTES     = [{ freq: 880, durMs: 80 }];
export const RECEIPT_NOTES  = [{ freq: 660, durMs: 55 }, { freq: 440, durMs: 75 }];
export const PRESYNTH_NOTES = [{ freq: 523.25, durMs: 70, gain: 0.7 },
                               { freq: 659.25, durMs: 70, gain: 0.7 },
                               { freq: 783.99, durMs: 95, gain: 0.8 }];

export function buildEarcon(notes, sampleRate, opts) {
    opts = opts || {};
    const gapMs     = opts.gapMs     != null ? opts.gapMs     : 18;
    const attackMs  = opts.attackMs  != null ? opts.attackMs  : 5;
    const releaseMs = opts.releaseMs != null ? opts.releaseMs : 20;
    const gap     = Math.floor(sampleRate * gapMs / 1000);
    const attack  = Math.floor(sampleRate * attackMs / 1000);
    const release = Math.floor(sampleRate * releaseMs / 1000);

    const lens = notes.map(n => Math.floor(sampleRate * n.durMs / 1000));
    let total = 0;
    for (let i = 0; i < notes.length; i++) total += lens[i] + (i < notes.length - 1 ? gap : 0);

    const buf = new Float32Array(total);
    let off = 0;
    for (let k = 0; k < notes.length; k++) {
        const len = lens[k];
        const gain = notes[k].gain != null ? notes[k].gain : 1.0;
        const w = 2 * Math.PI * notes[k].freq / sampleRate;
        for (let i = 0; i < len; i++) {
            let env;
            if (i < attack) {
                env = 0.5 - 0.5 * Math.cos(Math.PI * i / attack);
            } else if (i > len - release) {
                const r = (i - (len - release)) / release;
                env = 0.5 + 0.5 * Math.cos(Math.PI * r);
            } else {
                env = 1.0;
            }
            buf[off + i] = gain * env * Math.sin(w * i);
        }
        off += len + gap;
    }
    return buf;
}

export function resampleLinear(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;
    const ratio = fromRate / toRate;
    const n = Math.floor(samples.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = i * ratio;
        const i0 = Math.floor(x);
        const i1 = Math.min(i0 + 1, samples.length - 1);
        const f = x - i0;
        out[i] = samples[i0] * (1 - f) + samples[i1] * f;
    }
    return out;
}

export function createAudioPlayer({ audioCtx, engineRate, transcriptEl, onPlaybackComplete }) {
    let toneClipId = -1;
    let receiptClipId = -1;
    let presynthClipId = -1;

    try {
        toneClipId     = audioCtx.createClip(buildEarcon(WAKE_NOTES, engineRate), 1);
        receiptClipId  = audioCtx.createClip(buildEarcon(RECEIPT_NOTES, engineRate), 1);
        presynthClipId = audioCtx.createClip(
            buildEarcon(PRESYNTH_NOTES, engineRate, { attackMs: 8, releaseMs: 35 }), 1);
    } catch (e) {
        console.warn('cue tone init failed:', e.message);
    }

    const SCHED_LEAD = 0.06;
    const QWEN_CHUNK_SEC = 0.08;
    let scheduled = [];
    let nextStartSec = 0;
    let schedTimer = 0;
    let litWordEl = null;

    function playEarcon(id, gain) {
        if (id < 0 || !audioCtx) return;
        try { audioCtx.playClip(id, gain, false); } catch (_) {}
    }

    function playCueTone()     { playEarcon(toneClipId, 0.5); }
    function playReceiptCue()  { playEarcon(receiptClipId, 0.5); }
    function playPresynthCue() { playEarcon(presynthClipId, 0.35); }

    function enqueueAudio(samples, sampleRate, meta) {
        const resampled = resampleLinear(samples, sampleRate, engineRate);
        const dur = resampled.length / engineRate;
        const now = audioCtx.currentTime;
        const when = Math.max(now + SCHED_LEAD, nextStartSec);
        let clipId, playbackId;
        try {
            clipId = audioCtx.createClip(resampled, 1);
            playbackId = audioCtx.playClip(clipId, 1.0, false, when);
        } catch (e) {
            console.warn('playback failed:', e.message);
            return;
        }
        nextStartSec = when + dur;
        const it = { clipId, playbackId, startSec: when, endSec: when + dur };
        if (meta) Object.assign(it, meta);
        scheduled.push(it);
        if (!schedTimer) schedTimer = setInterval(schedTick, 30);
    }

    function schedTick() {
        const now = audioCtx.currentTime;
        while (scheduled.length && scheduled[0].endSec <= now) {
            const it = scheduled.shift();
            try { audioCtx.deleteClip(it.clipId); } catch (_) {}
        }
        if (scheduled.length === 0) {
            clearInterval(schedTimer);
            schedTimer = 0;
            setWordHighlight(null);
            if (onPlaybackComplete) onPlaybackComplete();
            return;
        }

        const cur = scheduled[0];
        if (cur.startSec > now) { setWordHighlight(null); return; }

        let active = null;
        if (cur.words) {
            const pos = now - cur.startSec;
            for (let i = 0; i < cur.words.length; i++) {
                if (pos >= cur.words[i].startSec && pos < cur.words[i].endSec) {
                    active = cur.els[i];
                    break;
                }
            }
        } else if (cur.group) {
            const g = cur.group;
            const pos = cur.offsetSec + (now - cur.startSec);
            const est = g.totalSec || (g.receivedSec + QWEN_CHUNK_SEC);
            for (let i = 0; i < g.fracs.length; i++) {
                if (pos >= g.fracs[i].start * est && pos < g.fracs[i].end * est) {
                    active = g.els[i];
                    break;
                }
            }
        }
        setWordHighlight(active);
    }

    function setWordHighlight(el) {
        if (el === litWordEl) return;
        if (litWordEl) litWordEl.classList.remove('speaking');
        if (el) el.classList.add('speaking');
        litWordEl = el;
    }

    function clearWordHighlight() {
        litWordEl = null;
        if (!transcriptEl) return;
        const lit = transcriptEl.querySelectorAll('.word.speaking');
        for (let i = 0; i < lit.length; i++) lit[i].classList.remove('speaking');
    }

    function stopPlayback() {
        if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
        for (const it of scheduled) {
            try { audioCtx.stopPlayback(it.playbackId); } catch (_) {}
            try { audioCtx.deleteClip(it.clipId); } catch (_) {}
        }
        scheduled = [];
        nextStartSec = 0;
        clearWordHighlight();
    }

    function isBusy() {
        return scheduled.length > 0;
    }

    return {
        playCueTone,
        playReceiptCue,
        playPresynthCue,
        enqueueAudio,
        stopPlayback,
        clearWordHighlight,
        isBusy,
    };
}
