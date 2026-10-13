// The Radio's own songs: a fresh random concept per song (concepts.js), its
// title and lyrics written from its seed (lyrics.js), independent of the
// Song panel. Three parts:
//
//   supply    keeps `waiting` concepts written ahead of the stream and hands
//             them to it when it asks ('want', aheadSongs); re-roll / edit a
//             concept until it is handed over
//   style     the "what plays" controls: genres, mood, instruments, vocal,
//             a bpm range, the language; each pinned or random. A change
//             re-concepts what is not handed over yet and drops the songs in
//             the stream under the old style that are not built yet; built
//             ones stay, so a skip is still instant
//   board     the main-area list: what is coming (title, tags, lyrics
//             preview, its state: writing / ready / building / built / on
//             air), with re-roll, edit and drop

import { $, h, clear } from "/lib/kit/dom.js";
import { GENRES, MOODS, INSTRUMENTS, VOCALS, LANGUAGES, defaultStyle, rollConcept, conceptStyle, conceptTags,
         conceptSong, validateLyrics, sections } from "./concepts.js";
import { writeLyrics } from "./lyrics.js";

let nextId = 1;

const INSTRUMENTAL = '[Intro]\n\n[Instrumental]\n\n[Interlude]\n\n[Instrumental]\n\n[Outro]\n';

/**
 * The concept supply. deps: { enqueue(song) -> stream index, drop(index),
 * log(text, cls), onChange() }. style is the shared style state.
 */
export function conceptSupply(deps, style) {
    const entries = [];        // { id, concept, state, song, by, tokens, errors, job, at }
    let waiting = 2;           // concepts written ahead, not handed over
    let pendingWant = 0;       // songs the stream asked for and has not got
    let seedBase = (Date.now() & 0x7fffffff) >>> 0;
    let styleGen = 0;          // bumped by each style change; an entry keeps the one it was rolled under

    const changed = () => { if (deps.onChange) deps.onChange(); };
    const unqueued = () => entries.filter((e) => e.state === 'writing' || e.state === 'ready');
    const nextSeed = () => { seedBase = (Math.imul(seedBase, 1103515245) + 12345) >>> 0; return seedBase & 0x7fffffff; };

    // Every concept gets its own title and words from its seed, at once.
    function write(e) {
        const c = e.concept;
        if (c.vocal === 'instrumental') {
            c.title = c.title || c.mood.charAt(0).toUpperCase() + c.mood.slice(1) + ' ' + c.genre;
            c.lyrics = INSTRUMENTAL;
            e.by = 'instrumental';
        } else {
            const r = writeLyrics(c, c.language);
            c.title = r.title; c.lyrics = r.lyrics;
            e.by = c.language;
        }
        e.errors = []; e.state = 'ready';
    }

    function add() {
        const e = { id: nextId++, concept: rollConcept(style, nextSeed()), state: 'writing', song: -1, by: '', tokens: 0, errors: [],
                    gen: styleGen };
        entries.push(e);
        write(e);
        return e;
    }

    function fill() {
        while (unqueued().length < waiting + pendingWant) add();
    }

    // Hand ready concepts to the stream, oldest first, as many as it wants
    // (rolling more when the ones written ahead run out: the stream asks once
    // per shortfall).
    function serve() {
        while (pendingWant > 0) {
            const e = entries.find((x) => x.state === 'ready') || add();
            e.song = deps.enqueue(conceptSong(e.concept, e.concept.styleText ? { style: e.concept.styleText } : null));
            e.state = 'queued';
            pendingWant--;
        }
        fill();
        changed();
    }

    return {
        get entries() { return entries; },
        get waiting() { return waiting; },
        set waiting(n) { waiting = Math.max(0, Math.min(6, n | 0)); fill(); changed(); },
        get pendingWant() { return pendingWant; },

        /** The stream asked for n songs (its 'want' value). */
        want(n) {
            pendingWant = Math.max(0, n | 0);
            serve();
        },

        tick() {},

        /** A new concept in place of one not handed over yet. */
        reroll(id) {
            const e = entries.find((x) => x.id === id);
            if (!e || (e.state !== 'writing' && e.state !== 'ready')) return false;
            e.concept = rollConcept(style, nextSeed());
            e.gen = styleGen; e.by = ''; e.errors = [];
            write(e);
            changed();
            return true;
        },

        /** Edit a ready concept: { title, lyrics, styleText }. Returns validateLyrics' result. */
        edit(id, patch) {
            const e = entries.find((x) => x.id === id);
            if (!e || e.state !== 'ready') return { ok: false, errors: ['only a concept not handed over yet can be edited'] };
            const v = validateLyrics(patch.lyrics !== undefined ? patch.lyrics : e.concept.lyrics,
                                     { instrumental: e.concept.vocal === 'instrumental' });
            if (!v.ok) return v;
            if (patch.title !== undefined) e.concept.title = patch.title.trim();
            if (patch.lyrics !== undefined) e.concept.lyrics = patch.lyrics;
            if (patch.styleText !== undefined) e.concept.styleText = patch.styleText.trim() === conceptStyle(e.concept) ? '' : patch.styleText.trim();
            e.by = (e.by.includes('edited') ? e.by : e.by + ', edited');
            changed();
            return v;
        },

        /**
         * The style changed: re-concept everything not handed over, and drop
         * the songs handed over under an older style that are not built yet
         * (the stream asks for new ones). Built ones stay: a skip to them is
         * instant. Returns how many were dropped.
         */
        restyle(stats) {
            styleGen++;
            for (const e of unqueued()) {
                e.concept = rollConcept(style, nextSeed());
                e.gen = styleGen; e.by = ''; e.errors = [];
                write(e);
            }
            const live = new Map((stats ? stats.songs : []).map((s) => [s.index, s]));
            let n = 0;
            for (const e of entries) {
                const r = e.state === 'queued' && e.gen < styleGen ? live.get(e.song) : null;
                if (!r || r.onAir || r.ready || r.built) continue;
                deps.drop(e.song); e.state = 'dropped'; n++;
            }
            changed();
            return n;
        },

        /** The stream played or dropped a song. */
        gone(index, why) {
            const e = entries.find((x) => x.song === index && x.state === 'queued');
            if (e) e.state = why;
            // Keep the list short: what is played or dropped goes after a while.
            while (entries.length > 24 && (entries[0].state === 'played' || entries[0].state === 'dropped')) entries.shift();
            changed();
        },

        concept(index) { const e = entries.find((x) => x.song === index); return e ? e.concept : null; },

        /** A new stream: what the old one had goes; concepts not handed over stay. */
        reset() {
            for (let i = entries.length - 1; i >= 0; i--)
                if (entries[i].state !== 'writing' && entries[i].state !== 'ready') entries.splice(i, 1);
            pendingWant = 0;
            changed();
        },

        /** Start writing (the radio is on, or about to be). */
        prime() { fill(); },
    };
}

// ── style controls ──────────────────────────────────────────────────────────

/**
 * The "what plays" controls into `host`, bound to `style`. onChange() after
 * every edit. Returns { refresh() }.
 */
export function styleControls(host, style, onChange) {
    const node = $(host);
    const chipRow = (list, key, title) => {
        const row = h('div.tag-group.radio-style-' + key);
        for (const t of list) {
            const chip = h('span.k-chip', { title, onclick: () => {
                const i = style[key].indexOf(t);
                if (i >= 0) style[key].splice(i, 1); else style[key].push(t);
                sync(); onChange();
            } }, t);
            chip.dataset.v = t;
            row.appendChild(chip);
        }
        return row;
    };
    const select = (id, list, key, title) => {
        const s = h('select#' + id, { title, onchange: () => { style[key] = s.value || null; onChange(); } },
                    h('option', { value: '' }, 'random'), list.map((v) => h('option', { value: v }, v)));
        return s;
    };
    const genres = chipRow(GENRES, 'genres', 'pin this genre (several: one of them per song; none: any genre)');
    const instruments = chipRow(INSTRUMENTS, 'instruments', 'pin these instruments (none: the genre\'s own)');
    const mood = select('radio-mood', MOODS, 'mood', 'the mood of every song, or random');
    const vocal = select('radio-vocal', VOCALS, 'vocal', 'the vocal of every song, or random (instrumental: no lyrics)');
    const language = select('radio-language', LANGUAGES, 'language', 'what the vocal sings: Mandarin, English, or wordless vocalise (ooh, ah, la), or random');
    const bpmOn = h('input#radio-bpm-on', { type: 'checkbox', title: 'pin a bpm range (the plan\'s Q: header): off = the genre\'s usual range' });
    const lo = h('input#radio-bpm-lo', { type: 'number', min: 50, max: 200, value: 90, style: 'width:56px' });
    const hi = h('input#radio-bpm-hi', { type: 'number', min: 50, max: 200, value: 120, style: 'width:56px' });
    const bpmSet = () => {
        const a = Math.max(50, Math.min(200, +lo.value || 90)), b = Math.max(50, Math.min(200, +hi.value || 120));
        style.bpm = bpmOn.checked ? [Math.min(a, b), Math.max(a, b)] : null;
        onChange();
    };
    for (const x of [bpmOn, lo, hi]) x.addEventListener('change', bpmSet);
    node.append(
        h('span.k-cap', null, 'genres'), genres,
        h('div.k-row', null, h('label.k-field', null, 'mood', mood), h('label.k-field', null, 'vocal', vocal)),
        h('div.k-row', null, h('label.k-field', null, 'sings in', language)),
        h('span.k-cap', null, 'instruments'), instruments,
        h('div.k-row', null, h('label.k-field', null, bpmOn, 'bpm'), lo, h('span', null, '–'), hi));
    function sync() {
        for (const c of genres.children) c.classList.toggle('on', style.genres.includes(c.dataset.v));
        for (const c of instruments.children) c.classList.toggle('on', style.instruments.includes(c.dataset.v));
        mood.value = style.mood || ''; vocal.value = style.vocal || ''; language.value = style.language || '';
        bpmOn.checked = !!style.bpm;
        if (style.bpm) { lo.value = String(style.bpm[0]); hi.value = String(style.bpm[1]); }
    }
    sync();
    return { refresh: sync };
}

// ── the board ───────────────────────────────────────────────────────────────

const preview = (lyrics) => {
    const sung = sections(lyrics).filter((s) => s.lines.length);
    return sung.length ? sung[0].lines.slice(0, 2).join(' / ') : (lyrics ? 'instrumental' : '');
};

/** What a row's state reads as, from the entry and its stream stats row. */
export function entryState(e, row) {
    if (e.state === 'writing' || e.state === 'ready') return 'idea';
    if (e.state === 'played') return 'played';
    if (e.state === 'dropped') return 'dropped';
    if (!row) return 'waiting';
    if (row.onAir) return 'on air';
    if (row.built || row.ready) return 'ready ✓';
    return row.planned ? 'building…' : 'waiting';
}

/**
 * The coming-up list into `host`. render(supply, stats) once a frame (it
 * rebuilds only when the shape changes). actions: { reroll(id), edit(id,
 * patch) -> result, drop(index) }.
 */
export function conceptBoard(host, actions) {
    const node = $(host);
    const rows = new Map();
    let shown = '', editing = -1;

    function editor(e) {
        const c = e.concept;
        const title = h('input.radio-edit-title', { type: 'text', value: c.title || '', placeholder: 'title' });
        const styleText = h('input.radio-edit-style', { type: 'text', value: c.styleText || conceptStyle(c), style: 'width:100%' });
        const lyr = h('textarea.radio-edit-lyrics', { rows: 10, spellcheck: false }, c.lyrics);
        lyr.value = c.lyrics;
        const msg = h('span.dim');
        const save = h('button.radio-edit-save', { onclick: () => {
            const r = actions.edit(e.id, { title: title.value, lyrics: lyr.value, styleText: styleText.value });
            if (r.ok) { editing = -1; shown = ''; }
            else msg.textContent = r.errors.slice(0, 3).join('; ');
        } }, 'save');
        const cancel = h('button.k-link', { onclick: () => { editing = -1; shown = ''; } }, 'cancel');
        return h('div.radio-concept-editor', null, title, styleText, lyr, h('div.k-row', null, save, cancel, msg));
    }

    function build(e) {
        const head = h('b.radio-concept-title');
        const state = h('span.k-badge.radio-concept-state');
        const tags = h('span.dim.radio-concept-tags');
        const lyr = h('div.dim.radio-concept-lyrics');
        const reroll = h('button.k-link.radio-concept-reroll', { title: 'a new random concept in its place', onclick: () => actions.reroll(e.id) }, 're-roll');
        const edit = h('button.k-link.radio-concept-edit', { title: 'edit its title, style and lyrics before it is queued',
                                                             onclick: () => { editing = e.id; shown = ''; } }, 'edit');
        const drop = h('button.k-link.radio-concept-drop', { title: 'take it out of the stream (built or not)', onclick: () => actions.drop(e.song) }, 'drop');
        const el = h('div.radio-concept', { dataset: { id: e.id } },
            h('div.k-row', null, head, state, reroll, edit, drop), tags, lyr);
        return { el, head, state, tags, lyr, reroll, edit, drop };
    }

    return {
        render(supply, stats) {
            const live = new Map((stats ? stats.songs : []).map((s) => [s.index, s]));
            const list = supply.entries.filter((e) => e.state !== 'played' && e.state !== 'dropped' &&
                !(e.state === 'queued' && live.has(e.song) && live.get(e.song).onAir));
            const key = list.map((e) => e.id + ':' + e.state).join(',') + '|' + editing;
            if (key !== shown) {
                shown = key;
                clear(node);
                if (!list.length) node.appendChild(h('span.dim', null, 'nothing coming up yet'));
                for (const e of list) {
                    let r = rows.get(e.id);
                    if (!r) { r = build(e); rows.set(e.id, r); }
                    node.appendChild(r.el);
                    if (editing === e.id && e.state === 'ready') node.appendChild(editor(e));
                }
                for (const id of [...rows.keys()]) if (!supply.entries.some((e) => e.id === id)) rows.delete(id);
            }
            for (const e of list) {
                const r = rows.get(e.id);
                const c = e.concept;
                const row = live.get(e.song);
                const st = entryState(e, row);
                const title = (e.state === 'queued' ? '#' + e.song + ' ' : '') + (c.title || (e.state === 'writing' ? '(untitled)' : c.genre));
                if (r.head.textContent !== title) r.head.textContent = title;
                if (r.state.textContent !== st) { r.state.textContent = st; r.state.className = 'k-badge radio-concept-state ' + (row && row.built ? 'ok' : ''); }
                const tags = c.styleText || conceptTags(c).join(' · ');
                if (r.tags.textContent !== tags) r.tags.textContent = tags;
                const p = preview(c.lyrics);
                if (r.lyr.textContent !== p) r.lyr.textContent = p;
                const open = e.state === 'writing' || e.state === 'ready';
                r.reroll.hidden = !open;
                r.edit.hidden = e.state !== 'ready';
                r.drop.hidden = e.state !== 'queued' || !row || row.onAir;
            }
        },
        reset() { rows.clear(); shown = '\u0000'; editing = -1; clear(node); },
    };
}

export { defaultStyle };
