// speech.js — who says what, and when. Pure model like world.js (no DOM).
//
// Speech is serialized PER SPEAKER: different individuals can talk at the same
// time, but one individual never overlaps their own lines (their lines queue on
// their own channel). A line is held for its REAL Kokoro length when audio is
// on (reported back when playback starts) or a text estimate when silent, so a
// speaker's bubble + any worker gating on it track the actual utterance.
//
// Per-action narration is kept OFF the channels: workers accumulate deeds via
// report() and deliver one end-of-day recap (deliverReport), so a channel never
// floods. world._emitSpeech is the audio sink the game installs (voice.js).
//
//   const speech = createSpeech(world);
//   speech.say(id, text, { priority })  → handle { done } (tasks poll it)
//   speech.report(workerId, deed) / speech.deliverReport(workerId)
//   speech.step()                       once per world.step

import { propagateSpeech } from './knowledge.js';

const SPEECH_GAP_MS   = 220;   // brief silence between one speaker's lines
const SPEECH_MIN_MS   = 850;   // floor so a one-word line still reads
const SPEECH_PER_WORD = 300;   // ms/word (~Kokoro pace) for the silent estimate
const SPEECH_LEAD_MS  = 300;   // lead-in
const SPEECH_SPEAKER_CAP = 4;  // max backlog per speaker before dropping their oldest non-priority line
const SPEECH_MAX_MS   = 12000; // hard cap so one line can never wedge a speaker's channel
const REPORT_CAP      = 6;     // most deeds a worker remembers to recap at day's end
const DIALOG_CAP      = 24;    // scrolling dialog log length

function estimateMs(text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).length || 1;
    return Math.max(SPEECH_MIN_MS, words * SPEECH_PER_WORD + SPEECH_LEAD_MS);
}

// Normalise a line for equality, so a repeated action doesn't restack the same
// words and a deed isn't recorded twice in a worker's day-report.
function normSeg(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }

export function createSpeech(world) {
    const channels = world.speech.channels;   // speakerId -> { queue, active }
    const npc = (id) => world.npcs.find((n) => n.id === id) || null;

    // ENQUEUE a spoken line on the speaker's own channel. step() plays each
    // speaker's lines one at a time; a new line waits its turn and a line
    // identical to one already playing or queued is not restacked. Returns a
    // handle ({ done }) the briefing steps poll. opts.priority floats a
    // behaviour-gating line ahead of that speaker's chatter and exempts it
    // from the backlog drop.
    function say(speakerId, text, opts) {
        opts = opts || {};
        const t = String(text == null ? '' : text);
        if (!t.trim()) return null;
        // The scrolling dialog LOG is history — record every line right away.
        world.dialog.unshift({ t: world.clock.t, speaker: speakerId, text: t });
        if (world.dialog.length > DIALOG_CAP) world.dialog.pop();

        const ch = channels[speakerId] || (channels[speakerId] = { queue: [], active: null });
        const nt = normSeg(t);
        if (ch.active && normSeg(ch.active.text) === nt) {
            if (opts.priority) ch.active.priority = 1;
            return ch.active;
        }
        const dup = ch.queue.find((q) => normSeg(q.text) === nt);
        if (dup) { if (opts.priority) dup.priority = 1; return dup; }

        const item = { id: ++world.speech._seq, speakerId, text: t,
                       priority: opts.priority ? 1 : 0, est: estimateMs(t),
                       realMs: null, startedAt: null, done: false };
        ch.queue.push(item);
        // Bound THIS speaker's backlog so their words can't lag far behind the
        // action: drop their oldest non-priority pending line on overflow.
        while (ch.queue.length > SPEECH_SPEAKER_CAP) {
            const idx = ch.queue.findIndex((x) => !x.priority);
            if (idx === -1) break;
            ch.queue.splice(idx, 1)[0].done = true;
        }
        return item;
    }

    // A worker REMEMBERS a deed instead of narrating it. Deeds accumulate
    // (deduped, bounded) and are delivered as ONE end-of-day recap. No-op for
    // non-workers (the player speaks in the moment).
    function report(workerId, deed) {
        const t = String(deed == null ? '' : deed).trim();
        const n = t && npc(workerId);
        if (!n) return;
        if (!n.report) n.report = [];
        const nt = normSeg(t);
        if (n.report.some((s) => normSeg(s) === nt)) return;
        n.report.push(t);
        while (n.report.length > REPORT_CAP) n.report.shift();
    }

    // Speak the worker's accumulated day-recap as one line and clear it.
    // Returns the spoken handle, or null if they did nothing worth reporting.
    function deliverReport(workerId) {
        const n = npc(workerId);
        if (!n || !n.report || n.report.length === 0) return null;
        const recap = n.report.join(' ');
        n.report = [];
        return say(workerId, recap);
    }

    // The Foreman is an entity too (not in world.npcs), so his lines bubble
    // over the command post.
    function setBubble(speakerId, bubble) {
        const n = npc(speakerId);
        if (n) n.speech = bubble;
        else if (world.foreman && world.foreman.id === speakerId) world.foreman.speech = bubble;
    }

    // Advance every channel: retire each speaker's finished line, then start
    // their next queued line (priority first) and drive its audio. The moment
    // a line starts, everyone within earshot absorbs what the speaker knows
    // (knowledge.js) — the only channel second-hand knowledge travels by.
    function step() {
        const now = world.clock.t;
        for (const speakerId of Object.keys(channels)) {
            const ch = channels[speakerId];
            if (ch.active) {
                const a = ch.active;
                const dur = a.realMs != null ? a.realMs : a.est;
                if (now >= a.startedAt + dur + SPEECH_GAP_MS || now >= a.startedAt + SPEECH_MAX_MS) {
                    setBubble(speakerId, null);
                    a.done = true;
                    ch.active = null;
                } else {
                    setBubble(speakerId, { text: a.text, until: now + 1000 });   // keep it lit
                    continue;
                }
            }
            if (!ch.queue.length) continue;
            let idx = 0;
            for (let i = 1; i < ch.queue.length; i++) {
                if (ch.queue[i].priority > ch.queue[idx].priority) idx = i;
            }
            const item = ch.queue.splice(idx, 1)[0];
            if (item.done) continue;   // dropped while queued
            item.startedAt = now;
            ch.active = item;
            setBubble(speakerId, { text: item.text, until: now + 1000 });
            propagateSpeech(world, speakerId);
            // onStart reports the real length the moment playback begins.
            if (typeof world._emitSpeech === 'function') {
                try {
                    world._emitSpeech(speakerId, item.text, (sec) => {
                        if (ch.active === item && sec > 0) item.realMs = sec * 1000;
                    });
                } catch (e) { /* audio is best-effort; the estimate still paces the line */ }
            }
        }
    }

    return { say, report, deliverReport, step };
}
