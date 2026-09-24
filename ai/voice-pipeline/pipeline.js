// One conversation turn: utterance -> STT -> streaming LM -> per-sentence TTS
// queue -> scheduled playback. Model access is injected (engines.js builds
// the real ones; tests pass scripted stand-ins):
//
//   engines.stt.transcribe(samples16k, { onPartial(text), onDone(text, err) }) -> handle
//   engines.lm.generate(history, { onText(rawSoFar), onDone(err) }) -> handle
//   engines.voice: a speech.js voice, or null for text-only replies
//   (a handle has cancel())
//
//   const p = createPipeline({ engines, player, view, phase, onIdle });
//   p.run(samples16k)    a captured utterance
//   p.reply(text)        a turn from text (skips STT)
//   p.interrupt()        barge-in: cancel everything in flight
//
// phase(kind, text): 'transcribing' | 'thinking' | 'speaking' | 'idle' | 'error'.
// onIdle(): the turn is over (after a short tail when it spoke, so the wake
// detector does not hear the reply's last word).

import { clean, nextSentence, isStopPhrase, words } from "/app/speech.js";

export const SYSTEM_PROMPT =
    'You are speaking out loud through a text-to-speech system. Reply in 1-2 short ' +
    'conversational sentences. Use contractions. Never use markdown, bullet lists, ' +
    'code blocks, or symbols that do not sound natural when read aloud. Sound like a ' +
    'friend, not a chatbot. /no_think';

const WAKE_TAIL_MS = 250;
const SYNTH_RETRIES = 50;       // bro.tts can be briefly busy; retry every 40 ms

export function createPipeline({ engines, player, view, phase, onIdle }) {
    const history = [{ role: 'system', content: SYSTEM_PROMPT }];
    let turnSeq = 0, current = -1, busy = false;
    let stt = null, lm = null, tts = null;
    let text = '', queuedLen = 0, llmDone = false, cueSent = false, spoke = false;
    const queue = [];
    let synthBusy = false;

    const alive = (turn) => turn === current;

    function begin() {
        current = ++turnSeq;
        busy = true;
        text = ''; queuedLen = 0; llmDone = false; cueSent = false; spoke = false;
        queue.length = 0;
        return current;
    }

    function finish() {
        const wasSpeaking = spoke;
        busy = false; llmDone = false; spoke = false;
        setTimeout(() => { if (!busy && onIdle) onIdle(); }, wasSpeaking ? WAKE_TAIL_MS : 0);
    }

    function fail(stage, msg) {
        console.error('[voice-pipeline] ' + stage + ': ' + msg);
        phase('error', stage + ': ' + msg);
        player.stop();
        queue.length = 0;
        current = -1;
        finish();
    }

    function onTranscribed(turn, userText, err) {
        stt = null;
        if (!alive(turn)) return;
        view.clearPartial();
        if (err) { fail('stt', err); return; }
        userText = (userText || '').trim();
        if (isStopPhrase(userText)) { view.you(userText); phase('idle', 'stopped'); finish(); return; }
        if (!userText) { phase('idle', 'no speech detected'); finish(); return; }
        view.you(userText);
        respond(turn, userText);
    }

    function respond(turn, userText) {
        view.startReply();
        phase('thinking', 'thinking…');
        history.push({ role: 'user', content: userText });
        try {
            lm = engines.lm.generate(history, {
                onText: (raw) => {
                    if (!alive(turn)) return;
                    text = clean(raw);
                    view.setText(text);
                    let s;
                    while ((s = nextSentence(text, queuedLen)) !== null) {
                        queuedLen += s.length;
                        if (s.sentence) enqueue(turn, s.sentence, queuedLen);
                    }
                },
                onDone: (err) => {
                    lm = null;
                    if (!alive(turn)) return;
                    if (err) { fail('llm', err); return; }
                    const tail = text.slice(queuedLen).trim();
                    if (tail) { queuedLen = text.length; enqueue(turn, tail, queuedLen); }
                    if (text.trim()) history.push({ role: 'assistant', content: text.trim() });
                    if (!engines.voice && text.trim()) view.finalize(words(text), text.length);
                    llmDone = true;
                    maybeFinish();
                },
            });
        } catch (e) { fail('llm', e.message); }
    }

    function enqueue(turn, sentence, consumed) {
        if (!engines.voice) return;
        queue.push({ turn, sentence, consumed, retries: 0 });
        pump();
    }

    function pump() {
        if (synthBusy || !queue.length) return;
        const item = queue.shift();
        if (!alive(item.turn)) { pump(); return; }
        if (!cueSent) { cueSent = true; player.cue('reply'); phase('thinking', 'responding…'); }
        synthBusy = true;
        const sink = {
            alive: () => alive(item.turn),
            finalize: (ws) => view.finalize(ws, item.consumed),
            audio: (samples, rate, meta) => {
                if (!alive(item.turn)) return;
                if (!spoke) { spoke = true; phase('speaking', 'speaking…'); }
                player.enqueue(samples, rate, meta);
            },
            done: (err) => {
                synthBusy = false;
                tts = null;
                if (err && alive(item.turn)) { fail('voice', err); return; }
                pump();
                maybeFinish();
            },
        };
        try { tts = engines.voice.speak(item.sentence, sink); }
        catch (e) {
            synthBusy = false;
            if (++item.retries <= SYNTH_RETRIES) { queue.unshift(item); setTimeout(pump, 40); }
            else fail('voice', e.message);
        }
    }

    function maybeFinish() {
        if (!busy || !llmDone || synthBusy || queue.length || player.busy) return;
        finish();
    }

    return {
        /** Transcribe a captured 16 kHz utterance and answer it. */
        run(samples16k) {
            const turn = begin();
            player.cue('receipt');
            phase('transcribing', 'transcribing…');
            try {
                stt = engines.stt.transcribe(samples16k, {
                    onPartial: (t) => { if (alive(turn) && t) view.partial(t); },
                    onDone: (t, err) => onTranscribed(turn, t, err),
                });
            } catch (e) { fail('stt', e.message); }
        },
        /** Answer typed (or scripted) text, skipping STT. */
        reply(userText) { onTranscribed(begin(), userText, null); },
        /** Barge-in: cancel STT / LM / TTS, drop queued audio and the unspoken text. */
        interrupt() {
            current = -1;
            busy = false; llmDone = false; spoke = false; synthBusy = false;
            for (const hd of [stt, lm, tts]) { try { if (hd) hd.cancel(); } catch (_) {} }
            stt = lm = tts = null;
            player.stop();
            queue.length = 0;
            view.clearPartial();
            view.cutPending();
        },
        /** Playback drained: the turn may be complete. */
        drained: () => maybeFinish(),
        get busy() { return busy; },
        history,
    };
}
