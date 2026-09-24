// The setup screen: pick a voice (text only, Kokoro, Qwen3-TTS CustomVoice
// with speaker + language, or VoiceDesign from a description), toggle the
// wake word, see what is on disk, and Start (downloading what is missing).
// Nothing loads until Start.
//
//   const setup = setupScreen('#setup', { onStart(cfg) });
//   setup.show();
//   cfg = { backend: 'text'|'kokoro'|'qwen'|'voicedesign', speaker, language, description, wake }

import { h, clear, fmtBytes } from "/lib/kit/dom.js";
import * as Models from "/app/models.js";

// Qwen3-TTS CustomVoice speakers and languages: the ids from its config.json
// (talker_config.spk_id / codec_language_id; dialect = spk_is_dialect).
export const QWEN_LANGUAGES = ['english', 'chinese', 'german', 'italian', 'portuguese',
                               'spanish', 'japanese', 'korean', 'french', 'russian'];
export const QWEN_SPEAKERS = [
    { id: 'serena', name: 'Serena', note: 'female' }, { id: 'vivian', name: 'Vivian', note: 'female' },
    { id: 'ryan', name: 'Ryan', note: 'male' },       { id: 'aiden', name: 'Aiden', note: 'male' },
    { id: 'uncle_fu', name: 'Uncle Fu', note: 'male' }, { id: 'ono_anna', name: 'Ono Anna', note: 'female' },
    { id: 'sohee', name: 'Sohee', note: 'female' },
    { id: 'eric', name: 'Eric', note: 'male', dialect: 'Sichuan' },
    { id: 'dylan', name: 'Dylan', note: 'male', dialect: 'Beijing' },
];
// VoiceDesign starters; the model takes any free-form description.
export const QWEN_VD_EXAMPLES = [
    'A warm, low-pitched elderly storyteller, calm and unhurried.',
    'An energetic young sports announcer, fast and excited.',
    'A soft, soothing meditation guide speaking slowly and gently.',
    'A crisp, authoritative news anchor with a neutral accent.',
    'A cheerful cartoon character with a bright, bouncy voice.',
    'A mysterious narrator with a deep, gravelly whisper.',
];

const BACKENDS = [
    { id: 'text', title: 'Text only', sub: 'No speech: replies appear as text', group: null },
    { id: 'kokoro', title: 'Kokoro', sub: 'Fast 82M, one warm voice', group: 'tts' },
    { id: 'qwen', title: 'Qwen3-TTS · CustomVoice', sub: '9 preset speakers, 10 languages', group: 'ttsq' },
    { id: 'voicedesign', title: 'Qwen3-TTS · VoiceDesign', sub: 'Describe any voice in words', group: 'ttsvd' },
];
const groupOf = (b) => (BACKENDS.find((x) => x.id === b) || {}).group;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Fixed rows of inline-block cells (htmlayout does not grow a flex item's
// height to wrapped content, so a flex-wrap grid overlaps).
const rows = (cells, per, cls) => {
    const out = [];
    for (let i = 0; i < cells.length; i += per) out.push(h('div.' + cls, null, cells.slice(i, i + per)));
    return out;
};

export function setupScreen(host, { onStart, models }) {
    const root = typeof host === 'string' ? document.querySelector(host) : host;
    const M = models || Models;
    const sel = { backend: 'qwen', speaker: 'serena', language: 'english', description: QWEN_VD_EXAMPLES[0], wake: true };
    let opts, startBtn, prog, note, cards = [];

    const status = (key) => (key ? M.groupStatus(key) : null);
    const ready = (key) => { const s = status(key); return !!(s && s.present); };
    const available = (b) => { if (b === 'text') return true; const s = status(groupOf(b)); return !!(s && (s.present || s.downloadable)); };
    const requiredKeys = () => ['llm', 'stt'].concat(sel.wake ? ['wake'] : [], groupOf(sel.backend) || []);

    function tag(key) {
        const s = status(key);
        if (!key || !s) return h('span.k-badge', null, 'no model');
        if (s.present) return h('span.k-badge.ok', null, 'ready');
        if (s.downloadable) return h('span.k-badge.warn', null, 'download ' + fmtBytes(s.bytes));
        return h('span.k-badge.err', null, 'needs weights');
    }

    function pickSelected(list, attr, value) {
        list.forEach((x) => x.setAttribute('aria-selected', x.dataset[attr] === value ? 'true' : 'false'));
    }

    function langChips() {
        const chips = QWEN_LANGUAGES.map((l) => h('div.lang', { dataset: { lang: l }, 'aria-selected': String(l === sel.language),
            onclick: () => { sel.language = l; pickSelected(opts.querySelectorAll('.lang'), 'lang', l); } }, cap(l)));
        return [h('div.opt-label', null, 'Language'), h('div.lang-grid', null, rows(chips, 5, 'lang-line'))];
    }

    function renderOpts() {
        clear(opts);
        if (sel.backend === 'qwen') {
            const chips = QWEN_SPEAKERS.map((s) => h('div.spk', { dataset: { speaker: s.id }, 'aria-selected': String(s.id === sel.speaker),
                onclick: () => { sel.speaker = s.id; pickSelected(opts.querySelectorAll('.spk'), 'speaker', s.id); } },
                h('span.spk-name', null, s.name), h('span.spk-note', null, s.note + (s.dialect ? ' · ' + s.dialect : ''))));
            [h('div.opt-label', null, 'Speaker'), h('div.spk-grid', null, rows(chips, 3, 'spk-line'))].concat(langChips())
                .forEach((n) => opts.appendChild(n));
        } else if (sel.backend === 'voicedesign') {
            const desc = h('input#vd-desc.vd-desc', { type: 'text', value: sel.description,
                placeholder: 'e.g. a warm, low-pitched elderly storyteller', oninput: () => { sel.description = desc.value; } });
            const examples = QWEN_VD_EXAMPLES.map((x) => h('div.ex', { onclick: () => { sel.description = x; desc.value = x; } }, x));
            [h('div.opt-label', null, 'Describe the voice'), desc, h('div.opt-sub', null, 'Or start from an example:'),
             h('div.ex-list', null, examples)].concat(langChips()).forEach((n) => opts.appendChild(n));
        } else if (sel.backend === 'kokoro') {
            opts.appendChild(h('p.opt-note', null, 'Kokoro speaks with a single warm English voice (af_heart). No options: fast and lightweight.'));
        } else {
            opts.appendChild(h('p.opt-note', null, "Replies are shown as text only. You can still talk to the assistant; it just won't speak back."));
        }
    }

    function refresh() {
        let bytes = 0, blocked = null;
        for (const k of requiredKeys()) {
            const s = status(k);
            if (!s || s.present) continue;
            if (s.downloadable) bytes += s.bytes || 0;
            else blocked = s.label;
        }
        startBtn.disabled = !!blocked;
        startBtn.textContent = !blocked && bytes > 0 ? 'Download & start · ' + fmtBytes(bytes) : 'Start';
        note.textContent = blocked
            ? blocked + " isn't on disk and isn't auto-downloaded: fetch it with brosoundml's download-qwen-tts.sh, or pick another voice."
            : bytes > 0 ? 'First run downloads ' + fmtBytes(bytes) + ' into a shared cache.' : '';
    }

    function choose(b) {
        if (!available(b)) return;
        sel.backend = b;
        cards.forEach((c) => c.classList.toggle('on', c.dataset.backend === b));
        renderOpts();
        refresh();
    }

    async function start() {
        startBtn.disabled = true;
        const keys = requiredKeys();
        const total = keys.reduce((n, k) => { const s = status(k); return n + (s && !s.present && s.downloadable ? s.bytes || 0 : 0); }, 0);
        if (total > 0) {
            prog.hidden = false;
            const fill = prog.firstElementChild;
            let file = null, completed = 0, received = 0;
            try {
                await M.downloadKeys(keys, (q) => {
                    if (q.file !== file) { if (file !== null) completed += received; file = q.file; received = 0; }
                    received = q.received;
                    fill.style.width = Math.round(Math.min(1, (completed + received) / total) * 100) + '%';
                    note.textContent = 'downloading ' + q.label + ': ' + fmtBytes(completed + received) + ' / ' + fmtBytes(total);
                });
            } catch (e) {
                note.textContent = 'download failed: ' + ((e && e.message) || e);
                startBtn.disabled = false; startBtn.textContent = 'Retry';
                return;
            }
        }
        root.hidden = true;
        onStart({ backend: sel.backend, speaker: sel.speaker, language: sel.language,
                  description: (sel.description || '').trim(), wake: sel.wake });
    }

    function show() {
        sel.backend = ready('ttsq') ? 'qwen' : ready('ttsvd') ? 'voicedesign' : ready('tts') ? 'kokoro'
                    : available('qwen') ? 'qwen' : 'text';
        cards = BACKENDS.map((b) => h('div.voice-card' + (available(b.id) ? '' : '.disabled'), { dataset: { backend: b.id },
            onclick: () => choose(b.id) }, h('span.vc-title', null, b.title), h('span.vc-sub', null, b.sub), tag(b.group)));
        opts = h('div#voice-opts.voice-opts');
        const wakeChk = h('input#wake-chk', { type: 'checkbox', checked: sel.wake,
            onchange: () => { sel.wake = wakeChk.checked; refresh(); } });
        startBtn = h('button#start-btn.start.primary', { onclick: start }, 'Start');
        prog = h('div#start-prog.k-progress', { hidden: true }, h('div'));
        note = h('div#start-note.start-note');
        clear(root);
        [
            h('p.intro', null, 'Pick a voice for the assistant, then start. Only what you choose is loaded: speech ' +
              'recognition (Whisper) and the language model (Qwen3-8B) load alongside it.'),
            h('div.section-label', null, 'Voice'),
            h('div.voice-cards', null, rows(cards, 2, 'card-line')),
            opts,
            h('div.section-label', null, 'Pipeline'),
            h('div.core-rows', null,
                h('label.core-row.wake-toggle', null, wakeChk, h('span.k-grow', null, 'Wake word: say “computer” to talk hands-free'), tag('wake')),
                h('div.core-row', null, h('span.k-grow', null, 'Speech recognition · Whisper'), tag('stt')),
                h('div.core-row', null, h('span.k-grow', null, 'Language model · Qwen3-8B'), tag('llm'))),
            h('div.start-bar', null, startBtn, prog, note),
        ].forEach((n) => root.appendChild(n));
        root.hidden = false;
        choose(sel.backend);
    }

    return { show, start, choose, refresh, get sel() { return sel; }, el: root };
}
