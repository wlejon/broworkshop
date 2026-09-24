// Whole turns through the real app (transcript, playback, capture, phases)
// with scripted models standing in for Whisper / Qwen3 / TTS, so it needs no
// weights. The live-model version is test_e2e.js.
import { check, eq, test, done, frames, pumpUntil, waitFor, q, center, shot } from "/lib/kit/test.js";
import { voice } from "/app/app.js";
import { words, splitWordsByChars } from "/app/speech.js";

frames(2);

// ---- scripted engines ----------------------------------------------------------
let heard = 'hello there', reply = 'Hi! Nice to hear from you today. What is up?', lmDelay = 30;
const log = { sttSamples: 0, cancels: 0, spoken: [] };
const later = (ms, fn) => { const t = setTimeout(fn, ms); return { cancel() { clearTimeout(t); log.cancels++; } }; };

const engines = {
    stt: {
        transcribe(samples, cb) {
            log.sttSamples = samples.length;
            const partial = later(20, () => cb.onPartial(heard.split(' ')[0]));
            const fin = later(60, () => cb.onDone(heard, null));
            return { cancel() { partial.cancel(); fin.cancel(); } };
        },
    },
    lm: {
        generate(history, cb) {
            const toks = reply.match(/\S+\s*/g);
            let i = 0, t = null;
            const step = () => {
                if (i < toks.length) { cb.onText(toks.slice(0, ++i).join('')); t = setTimeout(step, lmDelay); }
                else cb.onDone(null);
            };
            t = setTimeout(step, lmDelay);
            return { cancel() { clearTimeout(t); log.cancels++; } };
        },
    },
    voice: {
        rate: 24000,
        speak(sentence, sink) {
            log.spoken.push(sentence);
            const ws = words(sentence);
            const els = sink.finalize(ws);
            return later(20, () => {
                const secs = 0.08 * ws.length;
                sink.audio(new Float32Array(Math.round(24000 * secs)), 24000, { els, words: splitWordsByChars(ws, secs) });
                sink.done();
            });
        },
    },
};

const idle = () => voice.pipeline && !voice.pipeline.busy && !voice.player.busy && /idle/.test(voice.phase);
const rows = (who) => document.querySelectorAll('#transcript .chat-row.' + who);
const last = (who) => { const r = rows(who); return r[r.length - 1]; };

voice.attach(engines, { wake: false });
frames(2);

test('attach opens the conversation', () => {
    check(q('#setup').hidden && !q('#convo').hidden, 'convo shown');
    check(!q('#talk').disabled, 'talk enabled');
    eq(q('#talk').textContent, 'hold to talk (Space)', 'no wake word: push-to-talk label');
});

// ---- 1. a full turn -------------------------------------------------------------
voice.pipeline.run(new Float32Array(16000));
let sawPartial = false, sawSpeaking = false, sawLit = false;
waitFor(() => {
    sawPartial = sawPartial || !!document.querySelector('#transcript .chat-row.you.partial');
    sawSpeaking = sawSpeaking || voice.phase === 'speaking';
    sawLit = sawLit || !!document.querySelector('#transcript .word.speaking');
    return sawSpeaking && idle();
}, 'the turn to finish', 15000);

test('utterance -> partial -> transcript -> spoken reply', () => {
    check(sawPartial, 'a live partial row while STT streamed');
    check(!document.querySelector('#transcript .chat-row.you.partial'), 'partial replaced');
    eq(last('you').querySelector('.chat-body').textContent, 'hello there', 'you row');
    eq(log.spoken, ['Hi!', 'Nice to hear from you today.', 'What is up?'], 'one TTS call per sentence');
    eq(last('agent').querySelectorAll('.word').length, words(reply).length, 'every word became a span');
    eq(last('agent').querySelector('.pending').textContent, '', 'nothing left unspoken');
    check(sawSpeaking && sawLit, 'phase went to speaking and words lit up');
    check(!document.querySelector('.word.speaking'), 'highlight cleared at the end');
    eq(voice.pipeline.history.map((m) => m.role), ['system', 'user', 'assistant'], 'history');
    eq(voice.statusText, 'idle', 'idle again');
});

// ---- 2. a stop phrase ends the turn without a reply -------------------------------
heard = 'Never mind.';
const agentRows = rows('agent').length;
voice.pipeline.run(new Float32Array(16000));
waitFor(() => idle() && rows('you').length === 2, 'the stop turn', 5000);
test('stop phrase', () => {
    eq(rows('agent').length, agentRows, 'no reply row');
    eq(voice.pipeline.history.length, 3, 'history untouched');
});

// ---- 3. barge-in mid-reply -------------------------------------------------------
heard = 'tell me a story';
reply = 'Once upon a time there was a runtime. It drew everything on the GPU. The end.';
lmDelay = 60;
log.spoken = [];
voice.pipeline.run(new Float32Array(16000));
waitFor(() => log.spoken.length >= 1, 'the first sentence', 10000);
const cancelsBefore = log.cancels;
voice.pipeline.interrupt();
frames(2);
test('interrupt cancels the turn', () => {
    check(!voice.pipeline.busy && !voice.player.busy, 'nothing in flight');
    check(log.cancels > cancelsBefore, 'LM generation cancelled');
    eq(last('agent').querySelector('.pending').textContent, '', 'unspoken tail cut');
    check(last('agent').querySelectorAll('.word').length < words(reply).length, 'reply stopped early');
});
pumpUntil(() => false, 400);
test('late callbacks from the cancelled turn are dropped', () => {
    eq(log.spoken.length, 1, 'no further sentences synthesized');
});

// ---- 4. push-to-talk through the button and the mic tap ------------------------------
heard = 'what time is it';
reply = 'Time for a test.';
lmDelay = 20;
log.sttSamples = 0;
const c = center('#talk');
mouseDown(c.x, c.y);
frames(1);
test('holding the button records', () => {
    check(voice.capture.recording && !voice.capture.fromWake, 'recording');
    eq(voice.phase, 'listening', 'phase');
    check(q('#talk').classList.contains('recording') && /release/.test(q('#talk').textContent), 'button shows it');
});
const rate = bro.mic.engineRate();
const tone = new Float32Array(Math.round(rate * 0.6));
for (let i = 0; i < tone.length; i++) tone[i] = 0.3 * Math.sin(i * 2 * Math.PI * 220 / rate);
for (let off = 0; off < tone.length; off += rate / 10) { bro.mic.feed(tone.subarray(off, Math.min(off + rate / 10, tone.length)), rate); frames(1); }
pumpUntil(() => false, 200);
mouseUp(c.x, c.y);
waitFor(() => log.sttSamples > 0, 'the utterance to reach STT', 5000);
test('releasing sends the utterance', () => {
    check(!voice.capture.recording, 'stopped');
    check(log.sttSamples >= 16000 * 0.5, 'about 0.6 s at 16 kHz: ' + log.sttSamples);
});
waitFor(idle, 'the push-to-talk turn', 10000);
shot('conversation');

// ---- 5. text-only replies are shown as plain text ------------------------------------
voice.attach({ stt: engines.stt, lm: engines.lm, voice: null }, { wake: false });
reply = 'Just text. No voice.';
voice.pipeline.reply('say something');
waitFor(idle, 'the text-only turn', 5000);
test('text-only', () => {
    eq(last('agent').querySelectorAll('.word').length, 4, 'reply finalized without TTS');
    check(/text-only/.test(voice.statusText), 'status says text-only: ' + voice.statusText);
});

done('voice turns');
