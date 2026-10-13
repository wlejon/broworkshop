// YuE2 Lab's Radio on the GPU: Load, start a stream of short songs (score
// off, 300 semantic tokens, so nothing is planned), see the playhead move,
// move a knob and see it held for the songs to come (the songs that exist
// keep theirs), skip, stop, and see the lab's other jobs come back. Asserts
// on the DOM and the stream's state only; the bounds are loose because
// another suite may share the GPU.
import { check, eq, frames, clickOn, setValue, text, q, test, done, shot, needWeights, waitFor, waitRealtime } from "/lib/kit/test.js";
import { sem } from "/app/lib/settings.js";
import { radioStream, radioState, radioSupply, radioStyle, startOpts } from "/app/lib/radio.js";

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
    q('.radio-adv').open = true; frames(2);       // the Song panel source and + Song panel song live under Advanced
    setValue('#radio-source', 'song');
    setValue('#radio-tag', 'first');
    clickOn('#radio-start');
    const st = radioStream();
    check(st && st.running, 'a stream runs: ' + text('#status'));
    eq(st.knobRanges, bro.music.knobRanges, 'the stream clamps its knobs to bro.music.knobRanges');
    for (const id of LAB_JOBS) check(q('#' + id).disabled, id + ' disabled while the radio runs');
    check(q('#btn-load').disabled, 'Load disabled while the radio runs');
    check(q('#radio-start').disabled && q('#radio-continue').disabled, 'start options locked while running');
    for (const id of ['radio-enqueue', 'radio-skip-now', 'radio-stop'])
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
    // Radio continue fills the songs ahead at once (wantGraceSeconds 0 for
    // the Song panel source), so the queued song follows them.
    waitFor(() => /^#1 /.test(text('#radio-plan-meta')), 'the plan panel names the next song', 120000, 20);
});

test('a knob is for the songs to come', () => {
    const before = radioStream().stats.songs.map((g) => g.index);
    setValue('#knob-texture', 1);
    eq(text('#knob-texture-val'), '1.00', 'applied value shown');
    eq(radioStream().knobs.texture, 1, 'the stream has it');
    setValue('#knob-percussion', -3);
    eq(radioStream().knobs.percussion, -3, 'a second knob, the first kept: texture ' + radioStream().knobs.texture);
    eq(radioStream().knobs.texture, 1, 'texture kept');
    frames(10);
    for (const g of radioStream().stats.songs)
        if (before.includes(g.index))
            check(g.knobs.texture === 0 && g.knobs.percussion === 0, 'song #' + g.index + ' keeps the knobs it started with: ' + JSON.stringify(g.knobs));
});

test('skip to the next song', () => {
    const before = radioState().onAir;
    clickOn('#radio-skip-now');
    waitFor(() => radioState().onAir > before, 'the next song on air', 300000, 20);
    frames(2);
    check(new RegExp('#' + radioState().onAir + ' ').test(text('#radio-onair')), 'on air readout: ' + text('#radio-onair'));
});

test('stop gives the lab its jobs back', () => {
    shot('yue2-lab-radio');
    clickOn('#radio-stop');
    check(q('#radio-skip-now').disabled, 'controls lock while stopping');
    waitFor(() => !radioStream(), 'the stream ends (onDone)', 120000, 20);
    frames(2);
    const d = radioState().lastDone;
    check(d && !d.error, 'onDone clean: ' + JSON.stringify(d));
    for (const id of LAB_JOBS) check(!q('#' + id).disabled, id + ' enabled again');
    check(!q('#btn-load').disabled, 'Load enabled again');
    check(!q('#radio-start').disabled && !q('#radio-continue').disabled, 'Start radio enabled again');
    for (const id of ['radio-enqueue', 'radio-skip-now', 'radio-stop'])
        check(q('#' + id).disabled, id + ' disabled after stop');
    check(/radio off/.test(text('#status')), 'status: ' + text('#status'));
});

// ── the radio's own concepts, songs kept built ahead ────────────────────────
const SENTINEL = 'zzsentinel';

test('concepts: the radio\'s own songs, three kept built ahead', () => {
    setValue('#radio-source', 'concepts');
    // Keep playing off: a preview stays one until Make full song (the next test).
    q('#radio-keep').checked = false;
    setValue('#style', SENTINEL + ' pop, 99 bpm');
    setValue('#lyrics', '[Verse]\n' + SENTINEL + ' line\n');
    // 40 s songs as 30 s previews (the default): a preview builds in about
    // 11 s. The pool fills in real time (waitRealtime): headless plays the
    // program faster than real time, so virtual-time waits outrun the GPU.
    Object.assign(sem, { minTokens: 1000, maxTokens: 1000 });
    eq(startOpts.previewSeconds, 30, '30 s previews by default');
    check(!q('#radio-autofull').checked, 'scan mode: auto full off');
    clickOn('#radio-start');
    const st = radioStream();
    check(st && st.running, 'a stream runs: ' + text('#status'));
    check(q('#radio-source').disabled, 'the source is locked while running');
    const ahead = startOpts.aheadSongs;
    eq(ahead, 3, 'three songs ahead by default');
    waitFor(() => radioState().wants.length > 0, 'the stream asks for songs', 30000, 10);
    eq(radioState().wants[0], ahead + 1, 'the first want: the song to play and the ones ahead');
    waitRealtime(() => { const s = st.stats; return s.ahead >= ahead && s.readyAhead >= ahead; },
                 'three previews built ahead of the one on air', 300000, 50);
    frames(2);
    const s = st.stats;
    const reqs = radioState().requests;
    check(reqs.length >= ahead + 1, 'concepts handed to the stream: ' + reqs.length);
    for (const r of reqs) {
        eq(r.source, 'concept', 'from the concept supply');
        check(!r.style.includes(SENTINEL) && !r.lyrics.includes(SENTINEL), 'not the Song panel\'s: ' + r.style);
    }
    check(/^\d previews? ready/.test(text('#radio-ahead')), 'ready count shown: ' + text('#radio-ahead'));
    for (const r of s.songs) if (!r.onAir) check(r.preview, 'song #' + r.index + ' waits as a preview');
    console.log('built ahead: ' + s.ahead + ' songs, ' + (s.hostBytes / 1e6).toFixed(0) + ' MB host memory');
    check(s.hostBytes > 0, 'built songs wait in host memory');
    check(document.querySelectorAll('#radio-concepts .radio-concept').length >= 1, 'the coming-up list');
    check(/ready ✓/.test(text('#radio-concepts')), 'a built row in the coming-up list: ' + text('#radio-concepts'));
});

test('concepts: skip to a built song is instant', () => {
    const st = radioStream();
    const next = st.stats.songs.find((r) => !r.onAir && r.built);
    check(next, 'a built song waits');
    const mark = radioState().events.length;
    clickOn('#radio-skip-now');
    waitFor(() => radioState().events.slice(mark).some((e) => e.kind === 'songStart' && e.song === next.index),
            'the built song placed', 30000, 5);
    const e = radioState().events.slice(mark).find((x) => x.kind === 'songStart' && x.song === next.index);
    console.log('skip to built song #' + next.index + ': ' + e.seconds.toFixed(3) + ' s to its first audio');
    check(e.seconds >= 0 && e.seconds < 0.5, 'skip to first audio of a built song: ' + e.seconds);
    waitFor(() => radioState().onAir === next.index, 'it is on air', 30000, 10);
});

test('concepts: Make full song continues the preview on air', () => {
    const st = radioStream();
    const air = radioState().onAir;
    check(/^preview/.test(text('#radio-fullSong')), 'the on-air song is a preview: ' + text('#radio-fullSong'));
    check(!q('#radio-full').disabled, 'Make full song enabled');
    const mark = radioState().events.length;
    clickOn('#radio-full');
    waitRealtime(() => radioState().events.slice(mark).some((e) => e.kind === 'full'), 'the full event', 30000, 10);
    const e = radioState().events.slice(mark).find((x) => x.kind === 'full');
    eq([e.song, e.value], [air, 1], 'the song on air continues');
    frames(2);
    check(/^full song: (generating \d+%|built)/.test(text('#radio-fullSong')), 'progress shown: ' + text('#radio-fullSong'));
    const row = st.stats.songs.find((r) => r.index === air);
    check(row && !row.preview, 'no longer a preview');
});

test('concepts: a pinned style re-concepts the ideas; built songs stay, unbuilt old-style ones drop', () => {
    const st = radioStream();
    const g = 'bossa nova';
    const live = new Map(st.stats.songs.map((s) => [s.index, s]));
    const queued = radioSupply().entries.filter((e) => e.state === 'queued');
    const mark = radioState().requests.length;
    q('#radio-style').scrollIntoView(); frames(2);
    clickOn(q('#radio-style .radio-style-genres .k-chip[data-v="' + g + '"]'));
    frames(2);
    eq(radioStyle.genres.join(), g, 'genre pinned');
    for (const e of radioSupply().entries.filter((x) => x.state === 'writing' || x.state === 'ready'))
        eq(e.concept.genre, g, 'an idea not handed over is re-rolled in the new style');
    // Built is for good, so a song built before the click stays, and one
    // dropped at the click was not built before it either.
    for (const e of queued) {
        const r = live.get(e.song);
        if (r && (r.onAir || r.ready || r.built)) check(e.state !== 'dropped', '#' + e.song + ' (built or on air) stays');
        if (e.state === 'dropped') check(r && !r.ready && !r.built, '#' + e.song + ' dropped was not built');
    }
    waitRealtime(() => radioState().requests.length > mark, 'a new-style song requested', 300000, 50);
    for (const r of radioState().requests.slice(mark)) check(r.style.startsWith(g), 'the new style: ' + r.style);
    clickOn(q('#radio-style .radio-style-genres .k-chip[data-v="' + g + '"]'));
    clickOn('#radio-stop');
    waitFor(() => !radioStream(), 'the stream ends', 120000, 20);
    check(!radioState().lastDone.error, 'onDone clean');
});

done('yue2-lab radio');
