// The Radio's own concepts, without YuE2: concepts honour the "what plays"
// pins, the lyricist's reply parses into YuE2's section format, the built-in
// lyrics validate, the supply on the page writes concepts that do not come
// from the Song panel, and re-roll / edit / restyle act on what is not handed
// to a stream yet. With a local Qwen3 (bro.lm), three concepts' lyrics are
// written by it and checked for structure (not quality). YUE2_LAB_LYRICIST
// picks the model ('none' skips it); by default the 1.7B one (the 8B is the
// Radio's first pick).
import { check, eq, frames, clickOn, setValue, text, q, test, done, waitFor } from "/lib/kit/test.js";
import { findWeights } from "/lib/kit/weights.js";
import { GENRES, MOODS, VOCALS, SUNG, defaultStyle, rollConcept, conceptStyle, lyricsPrompt, parseLyrics,
         validateLyrics, fallbackLyrics, conceptSong, sections } from "/app/lib/concepts.js";
import { lyricist, lmAvailable, LYRICIST_CANDIDATES } from "/app/lib/lyricist.js";
import { radioSupply, radioStyle } from "/app/lib/radio.js";

frames(5);

test('a concept honours each pin and is random where not pinned', () => {
    const free = new Set();
    for (let s = 1; s <= 40; s++) {
        const c = rollConcept(defaultStyle(), s);
        check(GENRES.includes(c.genre) && MOODS.includes(c.mood) && VOCALS.includes(c.vocal), 'drawn from the vocabularies: ' + JSON.stringify(c));
        check(c.instruments.length >= 2 && c.bpm >= 50 && c.bpm <= 200, 'instruments and a bpm');
        free.add(c.genre);
    }
    check(free.size >= 6, 'unpinned genres vary: ' + free.size);
    eq(JSON.stringify(rollConcept(defaultStyle(), 7)), JSON.stringify(rollConcept(defaultStyle(), 7)), 'a seed draws the same concept');
    const style = { genres: [GENRES[0], GENRES[1]], mood: MOODS[2], instruments: ['piano', 'cello'], vocal: 'instrumental', bpm: [100, 104] };
    for (let s = 1; s <= 20; s++) {
        const c = rollConcept(style, s);
        check(style.genres.includes(c.genre), 'genre pinned: ' + c.genre);
        eq(c.mood, MOODS[2], 'mood pinned');
        eq(c.instruments.join(), 'piano,cello', 'instruments pinned');
        eq(c.vocal, 'instrumental', 'vocal pinned');
        check(c.bpm >= 100 && c.bpm <= 104, 'bpm in the pinned range: ' + c.bpm);
        const st = conceptStyle(c);
        check(st.includes(c.genre) && st.includes(c.bpm + ' bpm') && st.includes('piano'), 'style text: ' + st);
    }
});

test('a reply parses into the YuE2 format', () => {
    const reply = '<think>\n\n</think>\n\nTitle: "Paper Moon"\n\n**[Verse 1]**\nI walked along the river\nThe water knew my name\n\n' +
        '[pre chorus]\nAnd the night came\n\n[CHORUS]\nPaper moon above me\n(repeat)\nHold the light\n\n[Outro]\nfade away\n\nHope you like it!';
    const p = parseLyrics(reply);
    eq(p.title, 'Paper Moon', 'title');
    const v = validateLyrics(p.lyrics);
    check(v.ok, 'parsed lyrics validate: ' + v.errors.join('; ') + '\n' + p.lyrics);
    eq(v.sections.map((s) => s.tag).join(), 'Intro,Verse,Pre-Chorus,Chorus,Outro', 'tags: numbered and cased ones canonical');
    eq(v.sections[1].lines.join('|'), 'I walked along the river|The water knew my name', 'verse lines');
    eq(v.sections[3].lines.join('|'), 'Paper moon above me|Hold the light', 'a (note) line dropped');
    check(!/think|Hope you|\(repeat\)|\*\*|fade away/.test(p.lyrics), 'notes, thinking and outro words dropped:\n' + p.lyrics);
    check(/^\[Intro\]\n\n/.test(p.lyrics) && /\n\[Outro\]\n$/.test(p.lyrics), 'bare Intro first, bare Outro last');
    const q2 = parseLyrics('Title: X\n[Hook]\nyo yo\n[Verse]\nline\n[Chorus]\nline\n');
    check(!/yo yo|Hook/.test(q2.lyrics) && validateLyrics(q2.lyrics).ok, 'an unknown tag drops its block: ' + q2.lyrics);
});

test('structure checks catch malformed lyrics', () => {
    const bad = (t, re, msg, o) => { const v = validateLyrics(t, o); check(!v.ok && v.errors.some((e) => re.test(e)), msg + ': ' + v.errors.join('; ')); };
    bad('[Verse]\nhello\n\n[Chorus]\nhi\n\n[Outro]\n', /start with \[Intro\]/, 'no intro');
    bad('[Intro]\n\n[Verse]\nhello\n\n[Outro]\n', /Verse\] and a \[Chorus/, 'no chorus');
    bad('[Intro]\n\n[Verse]\nhello\n\n[Chorus]\nhi\n\n[Outro]\nlast words\n', /bare/, 'sung outro');
    bad('[Intro]\n\n[Verse]\nhello\n\n[Chorus]\nhi\n\n[Hook]\nyo\n\n[Outro]\n', /unknown section/, 'unknown tag');
    bad('[Intro]\n\n[Verse]\nhello\n\n[Outro]\n', /instrumental has sung/, 'sung instrumental', { instrumental: true });
    bad('[Intro]\n\n[Verse]\nhello\n\n[Chorus]\nhi\n\n[Outro]', /trailing newline/, 'no trailing newline');
    check(validateLyrics('[Intro]\n\n[Instrumental]\n\n[Outro]\n', { instrumental: true }).ok, 'an instrumental validates');
});

test('built-in lyrics validate for every concept', () => {
    for (let s = 1; s <= 30; s++) {
        const c = rollConcept(defaultStyle(), s);
        const f = fallbackLyrics(c);
        const v = validateLyrics(f.lyrics, { instrumental: c.vocal === 'instrumental' });
        check(v.ok && f.title, 'fallback for ' + c.vocal + ': ' + v.errors.join('; '));
        c.lyrics = f.lyrics; c.title = f.title;
        const req = conceptSong(c);
        eq([req.style, req.lyrics, req.seed, req.tag], [conceptStyle(c), f.lyrics, c.seed, f.title], 'the stream request');
    }
    const m = lyricsPrompt(rollConcept(defaultStyle(), 3));
    check(m.length === 2 && /no_think/.test(m[1].content) && /\[Chorus\]|\[Verse\]/.test(m[1].content), 'the chat asks for the section shape');
});

test('the page supply writes its own concepts, not the Song panel\'s', () => {
    const SENTINEL = 'zzsentinel genre';
    setValue('#style', SENTINEL + ', 99 bpm');
    setValue('#lyrics', '[Verse]\nsentinel line\n');
    q('#tabs').scrollIntoView(); frames(2);
    clickOn('[data-tab=radio]'); frames(2);
    setValue('#radio-lyricist', '');                   // built-in lyrics: no model in this test
    clickOn('#radio-concepts-write');
    const supply = radioSupply();
    waitFor(() => supply.entries.filter((e) => e.state === 'ready').length >= 2, 'two concepts written', 10000, 5);
    frames(2);
    for (const e of supply.entries) {
        const st = conceptStyle(e.concept);
        check(!st.includes('zzsentinel') && !e.concept.lyrics.includes('sentinel'), 'not from the Song panel: ' + st);
        check(validateLyrics(e.concept.lyrics, { instrumental: e.concept.vocal === 'instrumental' }).ok, 'its lyrics validate');
        check(/^built-in/.test(e.by) || e.by === 'instrumental', 'built-in lyrics: ' + e.by);
    }
    const rows = document.querySelectorAll('#radio-concepts .radio-concept');
    eq(rows.length, supply.entries.length, 'one row per concept');
    check(/ready to queue/.test(rows[0].textContent), 'row state: ' + rows[0].textContent);
    check(q('#radio-concepts .radio-concept-tags').textContent.length > 5, 'tags shown');
    check(q('#radio-concepts .radio-concept-lyrics').textContent.length > 0, 'a lyrics preview');
    check(/0 writing, \d ready/.test(text('#radio-lyricist-state')), 'lyricist line: ' + text('#radio-lyricist-state'));
});

test('re-roll, edit, and a pinned style re-concepts what waits', () => {
    const supply = radioSupply();
    const e = supply.entries.find((x) => x.state === 'ready');
    const before = JSON.stringify(e.concept);
    clickOn(q('#radio-concepts .radio-concept[data-id="' + e.id + '"] .radio-concept-reroll'));
    waitFor(() => e.state === 'ready', 're-rolled concept written', 10000, 5);
    check(JSON.stringify(e.concept) !== before, 'a new concept in its place');

    clickOn(q('#radio-concepts .radio-concept[data-id="' + e.id + '"] .radio-concept-edit'));
    frames(2);
    setValue('.radio-edit-lyrics', '[Verse]\nno intro\n');
    clickOn('.radio-edit-save'); frames(2);
    check(q('.radio-concept-editor') && /Intro/.test(text('.radio-concept-editor')), 'a malformed edit is refused with the reason');
    setValue('.radio-edit-title', 'My Title');
    const inst = e.concept.vocal === 'instrumental';
    const mine = inst ? '[Intro]\n\n[Instrumental]\n\n[Interlude]\n\n[Outro]\n'
                      : '[Intro]\n\n[Verse]\nmy own line\n\n[Chorus]\nmy own chorus\n\n[Outro]\n';
    setValue('.radio-edit-lyrics', mine);
    clickOn('.radio-edit-save'); frames(2);
    const ed = document.querySelector('.radio-concept-editor');
    check(!ed, 'editor closes on a valid edit: ' + (ed ? ed.textContent : ''));
    eq(e.concept.title, 'My Title', 'title edited');
    eq(e.concept.lyrics, mine, 'lyrics edited');
    check(/edited/.test(e.by), 'marked edited: ' + e.by);
    check(/My Title/.test(text('#radio-concepts')), 'the row shows it');

    // Pin a genre and a mood: what waits is re-conceptualised under them.
    const g = GENRES[3];
    clickOn(q('#radio-style .radio-style-genres .k-chip[data-v="' + g + '"]'));
    setValue('#radio-mood', MOODS[1]);
    eq(radioStyle.genres.join(), g, 'genre pinned in the shared style');
    eq(radioStyle.mood, MOODS[1], 'mood pinned');
    waitFor(() => supply.entries.every((x) => x.state === 'ready'), 'restyled concepts written', 10000, 5);
    for (const x of supply.entries) eq([x.concept.genre, x.concept.mood], [g, MOODS[1]], 'restyled concept #' + x.id);
    check(q('#radio-restyle').hidden, 'no keep/discard prompt without a stream');
    clickOn(q('#radio-style .radio-style-genres .k-chip[data-v="' + g + '"]'));
    setValue('#radio-mood', '');
    eq(radioStyle.genres.length + (radioStyle.mood ? 1 : 0), 0, 'pins cleared');
});

const wanted = typeof process !== 'undefined' && process.env && process.env.YUE2_LAB_LYRICIST;
const lmPath = wanted === 'none' ? '' : wanted || findWeights([LYRICIST_CANDIDATES[1]]) || findWeights([LYRICIST_CANDIDATES[2]]);
if (!lmAvailable() || !lmPath) {
    console.log('SKIP lyricist: ' + (!lmAvailable() ? 'bro.lm not in this build' : 'no Qwen3 1.7B / 0.6B GGUF found'));
} else {
    test('a local Qwen3 writes well-formed lyrics, off the JS thread', () => {
        const states = [];
        const w = lyricist({ onState: (s) => states.push(s) });
        w.load(lmPath);
        eq(states[states.length - 1], 'loading', 'load returns at once (async)');
        waitFor(() => w.state === 'ready' || w.state === 'failed', 'lyricist loaded', 300000, 20);
        eq(w.state, 'ready', 'loaded ' + lmPath + ': ' + w.detail);
        const out = [];
        let framesDuring = 0;
        const style = { genres: [], mood: null, instruments: [], vocal: 'female vocal', bpm: null };
        for (const seed of [11, 22, 33]) w.write(rollConcept(style, seed), (r) => out.push(r));
        const t0 = Date.now();
        waitFor(() => { framesDuring++; return out.length === 3; }, 'three songs written', 600000, 20);
        const secs = (Date.now() - t0) / 1000;
        check(framesDuring > 10, 'the page kept running frames while it wrote: ' + framesDuring);
        for (const r of out) {
            console.log('lyricist ' + r.by + ': "' + r.title + '", ' + r.tokens + ' tokens in ' + r.seconds.toFixed(1) + ' s');
            const v = validateLyrics(r.lyrics);
            check(v.ok, 'well-formed: ' + v.errors.join('; ') + '\n' + r.lyrics);
            check(!/^built-in/.test(r.by), 'written by the model, not the fallback: ' + r.by + ' ' + (r.errors || []).join('; ') +
                  (r.raw ? '\n--- raw ---\n' + r.raw : ''));
            check(v.sections.filter((s) => SUNG.includes(s.tag)).length >= 2, 'at least two sung sections');
            check(r.title.length > 0, 'a title');
        }
        console.log('three songs in ' + secs.toFixed(1) + ' s');
        w.unload();
        eq(w.state, 'off', 'unloaded');
    });
}

done('yue2-lab concepts');
