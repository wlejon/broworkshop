// The Radio's song concepts: a fresh one per song, independent of the Song
// panel. A concept is genre, mood, instruments, vocal type, tempo (bpm and
// its feel), a theme, a seed, and lyrics in YuE2's format; the style
// controls pin any field or leave it random. Pure functions, no DOM: the
// lyrics are written by lyrics.js, radio_concepts.js shows them.
//
// YuE2's lyric format (the Song panel's section buttons, the research corpus):
// blocks separated by a blank line, each opened by a section tag on its own
// line. Sung sections carry lines; intro / interlude / outro / instrumental
// blocks are empty.
//
//   [Intro]
//
//   [Verse]
//   Neon on the water, neon on the sea
//   ...
//
//   [Chorus]
//   ...

import { STYLE_TAGS } from "./song.js";

export const SUNG = ['Verse', 'Pre-Chorus', 'Chorus', 'Bridge'];
export const BARE = ['Intro', 'Interlude', 'Outro', 'Instrumental'];
export const TAGS = [...SUNG, ...BARE];

// The style controls' vocabularies (the Song panel's chips, minus the space
// group), with instruments that suit each genre.
export const GENRES = STYLE_TAGS.genre;
export const MOODS = STYLE_TAGS.mood;
export const INSTRUMENTS = STYLE_TAGS.instruments;
// The lyrics' languages (lyrics.js writes them): YuE2 sings Mandarin and
// English; wordless is vocalise, the voice as an instrument.
export const LANGUAGES = ['Mandarin', 'English', 'wordless'];
export const VOCALS = ['female vocal', 'male vocal', 'warm lead vocal', 'breathy vocal', 'powerful vocal',
                       'falsetto', 'duet', 'rap vocal', 'instrumental'];
const GENRE_KIT = {
    'pop': ['piano', 'synth', 'electric bass', 'tight drums'],
    'indie folk': ['acoustic guitar', 'violin', 'cello', 'piano'],
    'City Pop': ['Rhodes piano', 'groovy bass', 'electric guitar', 'brass', 'synth'],
    'R&B': ['Rhodes piano', 'groovy bass', '808', 'pads'],
    'jazz-funk': ['Rhodes piano', 'groovy bass', 'saxophone', 'brass', 'tight drums'],
    'rock': ['electric guitar', 'electric bass', 'tight drums', 'organ'],
    'post-rock': ['electric guitar', 'strings', 'pads', 'tight drums'],
    'metal': ['electric guitar', 'electric bass', 'tight drums'],
    'hip hop': ['808', 'drum machine', 'piano', 'synth'],
    'lo-fi': ['Rhodes piano', 'drum machine', 'pads', 'electric bass'],
    'synthwave': ['synth', 'drum machine', 'pads', 'electric bass'],
    'EDM': ['synth', 'drum machine', '808', 'pads'],
    'house': ['synth', 'drum machine', 'piano', 'groovy bass'],
    'nu-disco': ['groovy bass', 'synth', 'strings', 'drum machine'],
    'country': ['acoustic guitar', 'violin', 'electric guitar', 'piano'],
    'blues': ['electric guitar', 'organ', 'electric bass', 'tight drums'],
    'soul': ['Rhodes piano', 'organ', 'brass', 'groovy bass'],
    'gospel': ['organ', 'piano', 'brass', 'tight drums'],
    'bossa nova': ['acoustic guitar', 'piano', 'saxophone'],
    'reggae': ['organ', 'electric bass', 'electric guitar', 'tight drums'],
    'K-pop': ['synth', 'drum machine', '808', 'piano'],
    'Mandopop': ['piano', 'strings', 'acoustic guitar', 'synth'],
    'orchestral': ['strings', 'brass', 'cello', 'violin'],
    'ambient': ['pads', 'synth', 'piano', 'strings'],
};
// A genre's usual tempo range (bpm), for a bpm left random.
const GENRE_BPM = {
    'lo-fi': [70, 90], 'hip hop': [80, 100], 'R&B': [65, 95], 'soul': [70, 105], 'blues': [65, 110],
    'bossa nova': [110, 140], 'reggae': [70, 95], 'ambient': [60, 85], 'orchestral': [60, 110],
    'house': [118, 128], 'EDM': [120, 132], 'nu-disco': [110, 124], 'metal': [100, 160], 'synthwave': [90, 120],
};
export const THEMES = ['a late night drive', 'leaving home', 'a summer that ended', 'city lights', 'an old friend',
                       'the first snow', 'starting over', 'a long distance love', 'dancing alone', 'the ocean at dawn',
                       'a promise kept', 'running from the past', 'a rainy afternoon', 'the last train home',
                       'small town dreams', 'a letter never sent', 'chasing the sunrise', 'quiet courage'];
// Song shapes: sections in order (the intro and outro are
// added bare around them).
export const SHAPES = [
    ['Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Chorus'],
    ['Verse', 'Pre-Chorus', 'Chorus', 'Verse', 'Pre-Chorus', 'Chorus', 'Chorus'],
    ['Verse', 'Chorus', 'Verse', 'Chorus', 'Interlude', 'Chorus'],
    ['Verse', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Chorus'],
];
export const LINES = { 'Verse': 4, 'Pre-Chorus': 2, 'Chorus': 4, 'Bridge': 2 };

/** A small seeded generator (mulberry32): rng() in [0, 1). */
export function rngFrom(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
function pickSome(rng, list, n) {
    const pool = list.slice(), out = [];
    while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]);
    return out;
}

/** The feel a tempo reads as (also the tempo-feel word in the style). */
export function tempoFeel(bpm) { return bpm < 85 ? 'slow' : bpm < 115 ? 'mid-tempo' : 'fast'; }

/**
 * The style controls' state: each field pinned (a value) or random (null).
 * genres: the genres to draw from (empty = all); bpm: [lo, hi] or null.
 */
export function defaultStyle() {
    return { genres: [], mood: null, instruments: [], vocal: null, language: null, bpm: null };
}

/**
 * A fresh concept, drawn with `seed` under the style's pins. Its lyrics are
 * empty until lyrics.js writes them.
 */
export function rollConcept(style, seed) {
    const s = style || defaultStyle();
    const rng = rngFrom(seed);
    const genre = pick(rng, s.genres && s.genres.length ? s.genres : GENRES);
    const mood = s.mood || pick(rng, MOODS);
    const kit = GENRE_KIT[genre] || INSTRUMENTS;
    const instruments = s.instruments && s.instruments.length ? s.instruments.slice(0, 4) : pickSome(rng, kit, 2 + Math.floor(rng() * 2));
    const vocal = s.vocal || pick(rng, VOCALS.filter((v) => v !== 'instrumental').concat(['instrumental']));
    const [lo, hi] = s.bpm || GENRE_BPM[genre] || [72, 132];
    const bpm = Math.round(lo + rng() * Math.max(0, hi - lo));
    const language = vocal === 'instrumental' ? '' : s.language || pick(rng, LANGUAGES);
    return {
        seed: seed >>> 0, genre, mood, instruments, vocal, language, bpm, feel: tempoFeel(bpm),
        theme: pick(rng, THEMES), shape: pick(rng, SHAPES),
        title: '', lyrics: '', lyricsBy: '',
    };
}

/** YuE2's style text for a concept: genre, mood, instruments, vocal, tempo feel, bpm. */
export function conceptStyle(c) {
    return [c.genre, c.mood, ...c.instruments, c.vocal, c.feel, c.bpm + ' bpm'].filter(Boolean).join(', ');
}

/** The tags a row shows. */
export function conceptTags(c) { return [c.genre, c.mood, c.vocal, c.language, c.bpm + ' bpm', ...c.instruments].filter(Boolean); }

const TAG_RE = /^\s*\[\s*([A-Za-z][A-Za-z0-9 -]*?)\s*\]\s*$/;

/** Sections of a lyric text: [{ tag, lines }] (tags as written). */
export function sections(lyrics) {
    const out = [];
    for (const raw of String(lyrics || '').split(/\r?\n/)) {
        const m = TAG_RE.exec(raw);
        if (m) out.push({ tag: m[1], lines: [] });
        else if (raw.trim() && out.length) out[out.length - 1].lines.push(raw.trim());
        else if (raw.trim()) out.push({ tag: null, lines: [raw.trim()] });
    }
    return out;
}

/**
 * Structure check (not quality): every block opens with a known tag; sung
 * blocks have 1-12 lines of 1-90 characters, bare ones none; it starts with
 * [Intro] and ends with [Outro]; a vocal song has a verse and a chorus, an
 * instrumental one no sung block. { ok, errors: [...], sections }.
 */
export function validateLyrics(lyrics, opts) {
    const instrumental = !!(opts && opts.instrumental);
    const secs = sections(lyrics);
    const errors = [];
    if (!secs.length) errors.push('no sections');
    for (const s of secs) {
        if (s.tag === null) { errors.push('text before the first section tag: ' + s.lines[0]); continue; }
        if (!TAGS.includes(s.tag)) errors.push('unknown section tag [' + s.tag + ']');
        if (BARE.includes(s.tag) && s.lines.length) errors.push('[' + s.tag + '] should be bare');
        if (SUNG.includes(s.tag)) {
            if (!s.lines.length || s.lines.length > 12) errors.push('[' + s.tag + '] has ' + s.lines.length + ' lines');
            for (const l of s.lines) if (l.length > 90 || /[\[\]<>]/.test(l)) errors.push('bad line in [' + s.tag + ']: ' + l);
        }
    }
    if (secs.length) {
        if (secs[0].tag !== 'Intro') errors.push('does not start with [Intro]');
        if (secs[secs.length - 1].tag !== 'Outro') errors.push('does not end with [Outro]');
    }
    const has = (t) => secs.some((s) => s.tag === t);
    if (instrumental) {
        if (secs.some((s) => SUNG.includes(s.tag))) errors.push('an instrumental has sung sections');
    } else if (!has('Verse') || !has('Chorus')) errors.push('needs a [Verse] and a [Chorus]');
    if (!/\n$/.test(String(lyrics || ''))) errors.push('no trailing newline');
    return { ok: errors.length === 0, errors, sections: secs };
}

/** The stream request for a concept (its lyrics written). */
export function conceptSong(c, extra) {
    return Object.assign({ style: conceptStyle(c), lyrics: c.lyrics, cot: 'full', seed: c.seed,
                           tag: c.title || (c.genre + ' ' + (c.seed % 1000)) }, extra || {});
}
