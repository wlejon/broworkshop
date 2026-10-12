// YuE2 Lab's Radio on the GPU: Load, start a stream of short songs (score
// off, 300 semantic tokens, so nothing is planned), see the playhead move,
// interrupt "energetic now" and see both stages' latencies, move a knob and
// see it applied, skip, stop, and see the lab's other jobs come back. Asserts
// on the DOM and the stream's state only; the bounds are loose because
// another suite may share the GPU.
import { check, eq, frames, clickOn, setValue, text, q, test, done, shot, needWeights, waitFor, waitRealtime } from "/lib/kit/test.js";
import { sem } from "/app/lib/settings.js";
import { radioStream, radioState } from "/app/lib/radio.js";

needWeights('YuE2-3B', ['YuE2-3B'], { probe: 'qwen.tiktoken' });
needWeights('YuE2-Vae', ['brosoundml/weights/yue2-vae'], { probe: 'model.safetensors' });
if (!bro.music || bro.music.available === false) { console.log('SKIP: bro.music not in this build'); process.exit(0); }

frames(5);

const secs = (sel) => parseFloat(text(sel));
const LAB_JOBS = ['btn-generate', 'btn-plan', 'btn-semantic', 'btn-synth', 'btn-decode'];

test('load both models', () => {
    clickOn('#btn-load');
    waitFor(() => !q('#btn-generate').disabled || /failed/.test(text('#device')), 'models loaded', 300000, 50);
    check(!q('#btn-generate').disabled, 'generate enabled after load: ' + text('#status'));
    check(!q('#radio-start').disabled, 'Start radio enabled after load');
});

test('the radio starts and its audio plays', () => {
    setValue('#style', 'synthpop, female vocal, bright synth, 118 bpm');
    setValue('#lyrics', '[Verse]\nNeon on the water, neon on the sea\nEvery little signal coming back to me\n');
    q('#cot').scrollIntoView(); frames(2);
    clickOn('#cot button[data-value="off"]');
    Object.assign(sem, { minTokens: 300, maxTokens: 300 });
    q('#tabs').scrollIntoView(); frames(2);
    clickOn('[data-tab=radio]'); frames(2);
    setValue('#radio-tag', 'first');
    clickOn('#radio-start');
    const st = radioStream();
    check(st && st.running, 'a stream runs: ' + text('#status'));
    for (const id of LAB_JOBS) check(q('#' + id).disabled, id + ' disabled while the radio runs');
    check(q('#btn-load').disabled, 'Load disabled while the radio runs');
    check(q('#radio-start').disabled && q('#radio-continue').disabled, 'start options locked while running');
    for (const id of ['radio-enqueue', 'radio-skip', 'radio-stop', 'radio-energetic', 'radio-calm'])
        check(!q('#' + id).disabled, id + ' enabled while running');
    setValue('#radio-tag', 'second');
    clickOn('#radio-enqueue');

    waitFor(() => radioState().playhead > 48000, 'a second of program audio played', 300000, 20);
    frames(2);
    check(secs('#radio-playhead') >= 1, 'playhead readout: ' + text('#radio-playhead'));
    check(/^\d+\.\d\d s$/.test(text('#radio-firstAudio')), 'time to first audio shown: ' + text('#radio-firstAudio'));
    const lead = secs('#radio-lead');
    check(lead >= 0 && lead < 2, 'buffered lead within the emit lead (loose): ' + text('#radio-lead'));
    check(/#0 first/.test(text('#radio-onair')), 'song #0 on air: ' + text('#radio-onair'));
    const rows = document.querySelectorAll('#radio-songs .radio-song');
    check(rows.length >= 2, 'both songs in the queue view: ' + rows.length);
    check(/second/.test(text('#radio-songs')), 'the queued song is listed by its tag');
    check(/on-air/.test(rows[0].className), 'the first row is on air: ' + rows[0].className);
    waitFor(() => /#1 second/.test(text('#radio-plan-meta')), 'the plan panel names the next song', 120000, 20);
});

test('energetic now: both interrupt stages land', () => {
    clickOn('#radio-energetic');
    eq(text('#radio-int1'), 'waiting…', 'stage 1 pending');
    // The stream times request -> audible in wall time against the playhead,
    // so the player plays in real time here.
    waitRealtime(() => /s$/.test(text('#radio-int1')) && /s$/.test(text('#radio-int2')), 'both interrupt stages', 180000);
    const s1 = secs('#radio-int1'), s2 = secs('#radio-int2');
    console.log('interrupt: stage 1 ' + s1 + ' s, stage 2 ' + s2 + ' s');
    check(s1 > 0 && s1 < 10, 'stage 1 latency: ' + s1);
    check(s2 > s1 && s2 < 30, 'stage 2 after stage 1: ' + s2);
    check(Math.abs(radioStream().stats.interrupt1Seconds - s1) < 0.01, 'the DOM shows the stream\'s stage 1 time');
});

test('a knob applies live', () => {
    setValue('#knob-texture', 1);
    eq(text('#knob-texture-val'), '1.00', 'applied value shown');
    eq(radioStream().knobs.texture, 1, 'the stream has it');
    setValue('#knob-percussion', -3);
    eq(radioStream().knobs.percussion, -3, 'a second knob, the first kept: texture ' + radioStream().knobs.texture);
    eq(radioStream().knobs.texture, 1, 'texture kept');
    waitFor(() => /texture|percussion/.test(text('#radio-knobs-heard')), 'the steer re-solve heard', 180000, 20);
});

test('skip to the next song', () => {
    const before = radioState().onAir;
    clickOn('#radio-skip');
    waitFor(() => radioState().onAir > before, 'the next song on air', 300000, 20);
    frames(2);
    check(new RegExp('#' + radioState().onAir + ' ').test(text('#radio-onair')), 'on air readout: ' + text('#radio-onair'));
});

test('stop gives the lab its jobs back', () => {
    shot('yue2-lab-radio');
    clickOn('#radio-stop');
    check(q('#radio-skip').disabled, 'controls lock while stopping');
    waitFor(() => !radioStream(), 'the stream ends (onDone)', 120000, 20);
    frames(2);
    const d = radioState().lastDone;
    check(d && !d.error, 'onDone clean: ' + JSON.stringify(d));
    for (const id of LAB_JOBS) check(!q('#' + id).disabled, id + ' enabled again');
    check(!q('#btn-load').disabled, 'Load enabled again');
    check(!q('#radio-start').disabled && !q('#radio-continue').disabled, 'Start radio enabled again');
    for (const id of ['radio-enqueue', 'radio-skip', 'radio-stop', 'radio-energetic', 'radio-calm'])
        check(q('#' + id).disabled, id + ' disabled after stop');
    check(/radio off/.test(text('#status')), 'status: ' + text('#status'));
});

done('yue2-lab radio');
