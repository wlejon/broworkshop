// YuE2 Lab end to end on the GPU: Load, a short Generate streamed through the
// VAE into the player, then Synthesize and Decode again from that take. Kept
// short (a capped score, ~3 s of song, 8 ODE steps, small VAE tiles) so it
// exercises every stage without singing a whole song.
import { check, eq, frames, clickOn, setValue, text, q, test, done, shot, needWeights, waitFor } from "/lib/kit/test.js";
import { abc, sem, synth } from "/app/lib/settings.js";
import { allTakes, currentTake } from "/app/lib/takes.js";

needWeights('YuE2-3B', ['YuE2-3B'], { probe: 'qwen.tiktoken' });
needWeights('YuE2-Vae', ['brosoundml/weights/yue2-vae'], { probe: 'model.safetensors' });
if (!bro.music || bro.music.available === false) { console.log('SKIP: bro.music not in this build'); process.exit(0); }

frames(5);

const outLen = (T) => 1920 * T - 64;

test('load both models', () => {
    clickOn('#btn-load');
    waitFor(() => !q('#btn-generate').disabled || /failed/.test(text('#device')), 'models loaded', 300000, 50);
    check(!q('#btn-generate').disabled, 'generate enabled after load: ' + text('#status'));
    check(!q('#btn-decode').disabled, 'decode enabled');
});

test('generate streams audio while it decodes', () => {
    setValue('#style', 'pop, piano, female vocal, 110 bpm');
    setValue('#lyrics', '[Verse]\nLight on the water, light on the sea\n');
    Object.assign(abc, { minTokens: 16, maxTokens: 192 });
    Object.assign(sem, { minTokens: 60, maxTokens: 75 });
    Object.assign(synth, { odeSteps: 8, decodeCoreFrames: 16 });
    clickOn('#btn-generate');
    check(q('#btn-stop').disabled === false, 'stop enabled while running');
    waitFor(() => allTakes().length === 1 || /generate:/.test(text('#status')), 'generate take', 600000, 50);
    const t = currentTake();
    check(t, 'a take: ' + text('#status'));
    check(t.abc.length > 0, 'a score was planned');
    check(t.semantic.length >= 60 && t.semantic.length <= 75, 'semantic tokens within bounds: ' + t.semantic.length);
    check(t.frames > 0 && t.latents.length === t.frames * 64, 'latents ' + t.frames + ' frames');
    check(t.audio && t.audio.channels === 2 && t.audio.sampleRate === 48000, 'stereo 48 kHz audio');
    eq(t.audio.frames, outLen(t.frames), 'audio length = 1920*T - 64');
    let peak = 0, bad = 0;
    for (const v of t.audio.samples) { if (!Number.isFinite(v)) bad++; else peak = Math.max(peak, Math.abs(v)); }
    eq(bad, 0, 'finite samples');
    check(peak > 1e-3, 'audible: peak ' + peak);
    for (const s of q('#stages').children) check(/done|skip/.test(s.className), 'stage done: ' + s.textContent);
    check(q('#btn-stop').disabled, 'stop disabled when finished');
});

test('synthesize again from the take', () => {
    const before = currentTake();
    clickOn('#btn-synth');
    waitFor(() => allTakes().length === 2 || /synthesize:/.test(text('#status')), 'synthesize take', 300000, 50);
    const t = currentTake();
    check(t !== before && t.kind === 'synthesize', 'a synthesize take: ' + text('#status'));
    eq(t.frames, before.frames, 'same frame count from the same tokens');
    eq(t.audio.frames, outLen(t.frames), 'audio length');
});

test('decode the latents again in small tiles', () => {
    const t = currentTake();
    const ref = t.audio.samples.slice();
    clickOn('#btn-decode');
    waitFor(() => !q('#btn-generate').disabled, 'decode done', 120000, 50);
    eq(t.audio.frames, outLen(t.frames), 'decoded length');
    let d = 0;
    for (let i = 0; i < ref.length; i++) d = Math.max(d, Math.abs(ref[i] - t.audio.samples[i]));
    check(d < 1e-4, 'streamed re-decode matches the generated audio: ' + d);
    const row = (label) => [...q('#timing').children].find((r) => r.firstChild.textContent === label);
    check(/^decode/.test(row('last run').lastChild.textContent), 'last run names the decode');
    check(/s$/.test(row('first semantic token').lastChild.textContent), 'the generate\'s semantic timing is kept');
    check(!row('first semantic token').classList.contains('on') && row('first audio').classList.contains('on'),
          'rows the decode measured are highlighted, the kept ones are not');
});

frames(5);
shot('yue2-lab-generate');
done('yue2-lab generate');
