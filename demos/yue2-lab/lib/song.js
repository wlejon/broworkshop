// The conditioning: style tags, lyrics with section tags, and the example song.

import { $, h } from "/lib/kit/dom.js";

// Clickable style vocabulary, by group. A chip toggles its phrase in the style
// text (comma separated), so the prompt stays free text you can also type.
export const STYLE_TAGS = {
    genre: ['pop', 'indie folk', 'City Pop', 'R&B', 'jazz-funk', 'rock', 'post-rock', 'metal', 'hip hop',
            'lo-fi', 'synthwave', 'EDM', 'house', 'nu-disco', 'country', 'blues', 'soul', 'gospel',
            'bossa nova', 'reggae', 'K-pop', 'Mandopop', 'orchestral', 'ambient'],
    mood: ['upbeat', 'melancholic', 'dreamy', 'energetic', 'tender', 'dark', 'euphoric', 'nostalgic',
           'romantic', 'aggressive', 'calm', 'joyful', 'bittersweet', 'epic'],
    instruments: ['acoustic guitar', 'electric guitar', 'piano', 'Rhodes piano', 'synth', 'strings',
                  'brass', 'saxophone', 'groovy bass', 'electric bass', 'tight drums', '808', 'drum machine',
                  'violin', 'cello', 'pads', 'organ'],
    voice: ['female vocal', 'male vocal', 'warm lead vocal', 'breathy vocal', 'powerful vocal',
            'falsetto', 'choir', 'duet', 'rap vocal', 'instrumental'],
    tempo: ['60 bpm', '75 bpm', '92 bpm', '110 bpm', '120 bpm', '128 bpm', '140 bpm', 'slow', 'mid-tempo', 'fast'],
    space: ['intimate', 'live room', 'stadium', 'lo-fi texture', 'wide stereo', 'vintage', 'polished production'],
};

export const SECTIONS = ['[Intro]', '[Verse]', '[Pre-Chorus]', '[Chorus]', '[Bridge]', '[Interlude]',
                         '[Outro]', '[Instrumental]'];

function styleParts(text) {
    return text.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Build the tag chips; onChange fires after a chip edits the style text. */
export function buildStyleTags(host, styleInput, onChange) {
    const chips = [];
    const node = $(host);
    for (const [group, tags] of Object.entries(STYLE_TAGS)) {
        const row = h('div.tag-group', null, h('span.k-cap', null, group));
        for (const t of tags) {
            const chip = h('span.k-chip', {
                title: 'toggle "' + t + '" in the style',
                onclick: () => {
                    const parts = styleParts(styleInput.value);
                    const i = parts.findIndex((p) => p.toLowerCase() === t.toLowerCase());
                    if (i >= 0) parts.splice(i, 1); else parts.push(t);
                    styleInput.value = parts.join(', ');
                    sync();
                    if (onChange) onChange();
                },
            }, t);
            chip.dataset.tag = t.toLowerCase();
            chips.push(chip);
            row.appendChild(chip);
        }
        node.appendChild(row);
    }
    function sync() {
        const have = new Set(styleParts(styleInput.value).map((p) => p.toLowerCase()));
        for (const c of chips) c.classList.toggle('on', have.has(c.dataset.tag));
    }
    styleInput.addEventListener('input', sync);
    sync();
    return { sync };
}

/** Section-tag buttons that insert at the lyrics caret on a fresh line. */
export function buildSectionTags(host, lyricsInput, onChange) {
    const node = $(host);
    for (const s of SECTIONS) {
        node.appendChild(h('button.small', {
            title: 'insert ' + s + ' at the caret',
            onclick: () => {
                const v = lyricsInput.value;
                const at = lyricsInput.selectionStart == null ? v.length : lyricsInput.selectionStart;
                const before = v.slice(0, at), after = v.slice(at);
                const lead = before.length && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
                const ins = lead + s + '\n';
                lyricsInput.value = before + ins + after;
                const caret = at + ins.length;
                try { lyricsInput.setSelectionRange(caret, caret); } catch (e) { /* unsupported */ }
                lyricsInput.focus();
                if (onChange) onChange();
            },
        }, s));
    }
}

/** "N sections, M lines, ~K s" — a rough length cue (sung lines ~3.5 s each). */
export function lyricsSummary(text) {
    const lines = text.split('\n').map((l) => l.trim());
    const sections = lines.filter((l) => /^\[[^\]]+\]$/.test(l)).length;
    const sung = lines.filter((l) => l && !/^\[[^\]]+\]$/.test(l)).length;
    return sections + ' sections · ' + sung + ' lines · ~' + Math.round(sung * 3.5 + sections * 4) + ' s';
}

/** The model folder's example song (examples/*.json), or null. */
export function readExample(modelDir) {
    const fs = require('node:fs');
    try {
        const dir = modelDir + '/examples';
        const names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
        if (!names.length) return null;
        return JSON.parse(fs.readFileSync(dir + '/' + names[0], 'utf8'));
    } catch (e) {
        return null;
    }
}
