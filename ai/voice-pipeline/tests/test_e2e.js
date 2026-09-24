// End-to-end with the real models (tag: ml): pick a voice on the setup
// screen, Start, hold the talk button and feed Whisper's test utterance
// through bro.mic.feed (the tap the live mic drives), release, and check the
// whole turn: capture -> Whisper -> Qwen3-8B -> streamed TTS -> idle.
// BRO_VP_BACKEND = qwen (default) | kokoro | voicedesign | text.
import { check, test, done, frames, waitFor, needWeights, q, center, shot } from "/lib/kit/test.js";
import { readWav } from "/lib/kit/audio.js";
import { voice } from "/app/app.js";

const BACKEND = process.env.BRO_VP_BACKEND || 'qwen';
const wavPath = needWeights('Whisper test audio', ['brosoundml/weights/whisper/test_audio_en.wav']);
needWeights('Qwen3-8B GGUF', ['brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf']);
frames(2);

const card = q('#setup .voice-card[data-backend="' + BACKEND + '"]');
test('backend available: ' + BACKEND, () => check(!card.classList.contains('disabled'), 'card enabled'));
card.click();
check(!q('#start-btn').disabled, 'start enabled');
q('#start-btn').click();

waitFor(() => !q('#talk').disabled || voice.phase === 'err', 'models to load', 600000);
test('models loaded', () => check(!q('#talk').disabled, 'status: ' + voice.statusText));

const rate = bro.mic.engineRate();
const utt = readWav(wavPath, rate);
console.log('utterance: ' + utt.seconds.toFixed(2) + ' s');
const c = center('#talk');
mouseDown(c.x, c.y);
frames(1);
test('recording opened', () => check(voice.capture.recording && voice.phase === 'listening' && bro.mic.isActive(), 'phase ' + voice.phase));
const slice = Math.floor(rate / 4);
for (let off = 0; off < utt.pcm.length; off += slice) {
    bro.mic.feed(utt.pcm.subarray(off, Math.min(off + slice, utt.pcm.length)), rate);
    advanceTime(20);
}
const st = bro.mic.stats();
test('mic chunks delivered', () => check(st && st.chunkCount > 0, 'chunks ' + (st && st.chunkCount)));
mouseUp(c.x, c.y);

waitFor(() => voice.phase === 'err' || (voice.pipeline && !voice.pipeline.busy && !voice.player.busy && voice.phase === 'idle'),
        'the turn', 600000);
const lastRow = (who) => { const r = document.querySelectorAll('#transcript .chat-row.' + who); return r[r.length - 1]; };

test('the turn completed', () => {
    check(voice.phase !== 'err', 'status: ' + voice.statusText);
    const you = lastRow('you'), bro_ = lastRow('agent');
    check(you && you.querySelector('.chat-body').textContent.trim(), 'transcript: ' + (you && you.textContent));
    check(bro_ && bro_.querySelector('.chat-body').textContent.trim(), 'reply: ' + (bro_ && bro_.textContent));
    console.log('you: ' + you.textContent + ' | bro: ' + bro_.textContent);
    if (BACKEND !== 'text') check(bro_.querySelectorAll('.word').length > 0, 'TTS spoke (word spans exist)');
    check(!document.querySelector('.word.speaking'), 'no stale highlight');
});
shot('e2e-' + BACKEND);
done('voice e2e');
