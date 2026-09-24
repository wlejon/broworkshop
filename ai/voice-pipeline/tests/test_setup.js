// The setup screen and the pure speech helpers; no model loads.
import { check, eq, near, test, done, frames, q, text, shot } from "/lib/kit/test.js";
import { voice } from "/app/app.js";
import { setupScreen, QWEN_SPEAKERS } from "/app/setup.js";
import { clean, nextSentence, isStopPhrase, computeWords, buildKokoroChunks, splitWordsByChars } from "/app/speech.js";
import { buildEarcon, EARCONS } from "/app/playback.js";

frames(2);
const cards = () => Array.from(document.querySelectorAll('#setup .voice-card'));
const card = (b) => cards().find((c) => c.dataset.backend === b);

test('four voice cards, one selected', () => {
    eq(cards().length, 4, 'cards');
    const on = cards().filter((c) => c.classList.contains('on'));
    eq(on.length, 1, 'one selected');
    eq(on[0].dataset.backend, voice.setup.sel.backend, 'selection matches state');
    check(card('text').querySelector('.k-badge'), 'every card has a status badge');
    eq(voice.phase, 'idle', 'phase');
    check(q('#convo').hidden, 'conversation hidden until Start');
});

test('CustomVoice: speakers and languages', () => {
    voice.setup.choose('qwen');
    eq(document.querySelectorAll('#voice-opts .spk').length, QWEN_SPEAKERS.length, 'speaker chips');
    eq(document.querySelectorAll('#voice-opts .lang').length, 10, 'language chips');
    q('#voice-opts .spk[data-speaker="ryan"]').click();
    eq(voice.setup.sel.speaker, 'ryan', 'speaker picked');
    eq(q('#voice-opts .spk[data-speaker="ryan"]').getAttribute('aria-selected'), 'true', 'chip marked');
    eq(q('#voice-opts .spk[data-speaker="serena"]').getAttribute('aria-selected'), 'false', 'old chip cleared');
    q('#voice-opts .lang[data-lang="german"]').click();
    eq(voice.setup.sel.language, 'german', 'language picked');
    check(/Sichuan/.test(text('#voice-opts .spk[data-speaker="eric"]')), 'dialect shown');
});

test('VoiceDesign: description and examples', () => {
    voice.setup.choose('voicedesign');
    check(q('#vd-desc'), 'description box');
    const ex = document.querySelectorAll('#voice-opts .ex');
    check(ex.length >= 4, 'examples');
    ex[2].click();
    eq(q('#vd-desc').value, ex[2].textContent, 'example fills the box');
    eq(voice.setup.sel.description, ex[2].textContent, 'and the state');
    eq(document.querySelectorAll('#voice-opts .lang').length, 10, 'languages here too');
});

test('Kokoro and text-only explain themselves', () => {
    voice.setup.choose('kokoro');
    check(/af_heart/.test(text('#voice-opts')), 'kokoro note');
    voice.setup.choose('text');
    check(/text only/i.test(text('#voice-opts')), 'text note');
    check(card('text').classList.contains('on'), 'card follows');
});

test('wake toggle', () => {
    q('#wake-chk').click();
    eq(voice.setup.sel.wake, false, 'off');
    q('#wake-chk').click();
    eq(voice.setup.sel.wake, true, 'on again');
});

voice.setup.choose('qwen');
shot('setup');

// A second screen over a fake catalog: download sizes, a blocked backend, the download run.
const host = document.createElement('div');
document.body.appendChild(host);
const fake = {
    llm: { key: 'llm', label: 'LLM', present: false, downloadable: true, bytes: 3 * 1024 * 1024 },
    stt: { key: 'stt', label: 'STT', present: true, downloadable: true, bytes: 0 },
    wake: { key: 'wake', label: 'Wake', present: false, downloadable: true, bytes: 1024 * 1024 },
    tts: { key: 'tts', label: 'Kokoro', present: true, downloadable: true, bytes: 0 },
    ttsq: { key: 'ttsq', label: 'Qwen3-TTS', present: false, downloadable: false, bytes: 0 },
    ttsvd: { key: 'ttsvd', label: 'VoiceDesign', present: false, downloadable: false, bytes: 0 },
};
let downloaded = null, started = null;
const models = {
    groupStatus: (k) => fake[k] || null,
    downloadKeys: async (keys, onProgress) => {
        downloaded = keys.slice();
        onProgress({ groupKey: 'llm', label: 'LLM', file: 'a', received: 1024, total: 2048 });
        fake.llm.present = true; fake.wake.present = true;
    },
};
const s2 = setupScreen(host, { models, onStart: (cfg) => { started = cfg; } });
s2.show();
const b2 = host.querySelector('#start-btn');

test('offline setup: defaults to a voice on disk, sizes the download', () => {
    eq(s2.sel.backend, 'kokoro', 'kokoro is the one present');
    check(host.querySelector('.voice-card[data-backend="qwen"]').classList.contains('disabled'), 'undownloadable qwen disabled');
    check(!b2.disabled && /Download & start · 4\.0 MB/.test(b2.textContent), 'label: ' + b2.textContent);
});

test('turning the wake word off drops its download', () => {
    s2.el.querySelector('#wake-chk').click();
    check(/3\.0 MB/.test(b2.textContent), 'label: ' + b2.textContent);
    s2.el.querySelector('#wake-chk').click();
});

await s2.start();
test('start downloads what is missing, then hands over the choice', () => {
    eq(downloaded, ['llm', 'stt', 'wake', 'tts'], 'required keys');
    check(started && started.backend === 'kokoro' && started.wake === true, 'config: ' + JSON.stringify(started));
    check(host.hidden, 'setup hides');
});
host.remove();

test('speech helpers', () => {
    eq(clean('<think>hmm</think>  Hello<|im_end|>'), 'Hello', 'think + specials stripped');
    eq(clean('Hi <think>still going'), 'Hi ', 'open think dropped');
    eq(nextSentence('Hi there. And', 0), { sentence: 'Hi there.', length: 9 }, 'first sentence');
    eq(nextSentence('Hi there. And', 9), null, 'incomplete tail');
    check(isStopPhrase('Stop!') && isStopPhrase(' Never   mind. ') && !isStopPhrase('stop the music'), 'stop phrases');
    const w = splitWordsByChars(['ab', 'abcd'], 3);
    near(w[0].endSec, 1, 1e-9, 'char split'); near(w[1].endSec, 3, 1e-9, 'char split end');
    // phonemes [a b _ c], durations BOS=2, a=1 b=1 _=2 c=4, EOS=0 -> 10 frames over 1 s
    const cw = computeWords('ab c', [1, 2, 16, 3], [2, 1, 1, 2, 4, 0], 10, 10, 16);
    near(cw[0].startSec, 0.2, 1e-9, 'word 1 start'); near(cw[0].endSec, 0.4, 1e-9, 'word 1 end');
    near(cw[1].startSec, 0.6, 1e-9, 'word 2 start'); near(cw[1].endSec, 1.0, 1e-9, 'word 2 end');
    eq(buildKokoroChunks([1, 16, 2], 2, 16), null, 'short sentences are not chunked');
    const plan = buildKokoroChunks([1, 16, 2, 16, 3, 16, 4, 16, 5, 16, 6], 6, 16);
    eq(plan.ranges, [[0, 4], [4, 6]], 'four-word chunks');
    eq(plan.chunks[1], [5, 16, 6], 'second chunk re-joined with spaces');
    eq(buildEarcon(EARCONS.receipt.notes, 1000).length, 55 + 18 + 75, 'earcon length = notes + gap');
});

done('voice setup');
