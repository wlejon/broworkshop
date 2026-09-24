// reader.js — the reader view: sentence spans, word highlight, auto-scroll,
// the transport bar and the per-document engine / voice / speed controls.
// The document renders as <p>s of sentence <span class="sn">s; word spans are
// built only inside the ACTIVE sentence and only when the engine gives word
// timings (Kokoro), so large documents stay cheap.

import { $, h, clear } from "/lib/kit/dom.js";
import { applyTheme } from "./state.js";
import { segment } from "./text.js";
import { engines, onEngineChange, statusText } from "./engine.js";
import * as player from "./player.js";
import { ps } from "./player.js";

let status = null;
let sentenceEls = [];
let activeEl = null;
let wordEls = null;
const view = { onLibrary: null };      // library.js re-renders on the way back

export function initReader(statusLine, onLibrary) {
    status = statusLine;
    view.onLibrary = onLibrary;
    player.onPlayerChange(onPlayerEvent);
    onEngineChange(() => { fillVoices(); updateBadge(); });

    $('#btn-back').addEventListener('click', showLibraryView);
    $('#btn-prev').addEventListener('click', () => player.prev());
    $('#btn-next').addEventListener('click', () => player.next());
    $('#btn-para').addEventListener('click', () => player.paragraphStart());
    $('#btn-play').addEventListener('click', () => player.toggle());
    $('#engine-sel').addEventListener('change', () => { player.setEngine($('#engine-sel').value); fillVoices(); });
    $('#voice-sel').addEventListener('change', () => player.setVoiceName($('#voice-sel').value));
    $('#speed-sel').addEventListener('change', () => player.setSpeed(parseFloat($('#speed-sel').value)));
    $('#btn-preview').addEventListener('click', () => {
        status.busy('previewing voice…');
        player.previewVoice((err) => { if (err) status.error('preview: ' + err); else status.set(''); });
    });
    $('#sleep-sel').addEventListener('change', () => {
        const v = $('#sleep-sel').value;
        if (v === 'off') player.setSleep('off');
        else if (v === 'para') player.setSleep('paragraph');
        else player.setSleep('min', parseInt(v, 10));
    });
}

// ── view switching ───────────────────────────────────────────────────────────

export function readerVisible() { return !$('#reader-view').hidden; }

export function showLibraryView() {
    player.closeDocument();
    $('#reader-view').hidden = true;
    $('#library-view').hidden = false;
    if (view.onLibrary) view.onLibrary();
}

export function openDocument(doc) {
    const seg = segment(doc.text);
    doc.sentenceCount = seg.sentences.length;
    player.setDocument(doc, seg);
    $('#doc-title').textContent = doc.title;
    buildText(seg);
    applyTheme();
    fillControls();
    $('#library-view').hidden = true;
    $('#reader-view').hidden = false;
    status.set('');
    highlightSentence(ps.cur);
    updateTransport();
    updateBadge();
}

function buildText(seg) {
    const cont = clear($('#reader-text'));
    activeEl = null; wordEls = null;
    let si = 0;
    seg.paragraphs.forEach((_, pi) => {
        const pe = h('p');
        for (; si < seg.sentences.length && seg.sentences[si].para === pi; si++) {
            pe.appendChild(h('span.sn', { dataset: { i: si }, onclick: onSentenceClick }, seg.sentences[si].text));
            pe.appendChild(document.createTextNode(' '));
        }
        cont.appendChild(pe);
    });
    sentenceEls = Array.from(cont.querySelectorAll('.sn'));
    $('#reader-scroll').scrollTop = 0;
}

function onSentenceClick(e) {
    const i = parseInt(e.currentTarget.dataset.i, 10);
    if (!isNaN(i)) player.jumpTo(i, true);
}

// ── controls ─────────────────────────────────────────────────────────────────

function fillControls() {
    $('#engine-sel').value = player.engineName();
    fillVoices();
    const sp = $('#speed-sel');
    sp.value = String(player.speed());
    if (sp.value !== String(player.speed())) sp.value = '1';   // not in the list -> 1x
    if (ps.sleep.mode === 'off') $('#sleep-sel').value = 'off';
}

function fillVoices() {
    const sel = clear($('#voice-sel'));
    const name = player.engineName(), e = engines[name];
    const list = name === 'kokoro' ? e.voices : e.speakers;
    const want = name === 'kokoro' ? player.kokoroVoiceName() : player.qwenSpeaker();
    if (!list || !list.length) {
        sel.appendChild(h('option', { value: '' }, e.status === 'ready' ? '(no voices found)' : '(load to list voices)'));
        return;
    }
    for (const v of list) sel.appendChild(h('option', { value: v }, v));
    if (list.indexOf(want) >= 0) sel.value = want;
}

export function updateBadge() {
    const name = player.engineName(), st = engines[name].status;
    const b = $('#backend');
    b.textContent = statusText(name);
    b.className = 'k-badge' + (st === 'error' ? ' err' : st === 'ready' ? ' ok' : '');
}

// ── player events -> DOM ─────────────────────────────────────────────────────

function onPlayerEvent(kind, a) {
    if (kind === 'sentence') { highlightSentence(ps.cur); updateTransport(); }
    else if (kind === 'word') highlightWord(a);
    else if (kind === 'state' || kind === 'buffer' || kind === 'sleep') updateTransport();
    else if (kind === 'params') { fillControls(); updateBadge(); }
    else if (kind === 'error') status.error(a);
    else if (kind === 'done') status.ok('finished: space reads again from the top');
}

function highlightSentence(i) {
    if (activeEl) {                                  // restore plain text (drops word spans)
        activeEl.classList.remove('active');
        if (wordEls && activeEl._plain !== undefined) activeEl.textContent = activeEl._plain;
        wordEls = null;
    }
    activeEl = (i >= 0 && sentenceEls[i]) || null;
    if (!activeEl) return;
    activeEl._plain = activeEl.textContent;
    activeEl.classList.add('active');
    scrollToActive();
}

function highlightWord(w) {
    if (!activeEl) return;
    if (!wordEls) {                                  // explode into word spans on first use
        const words = activeEl._plain.split(/\s+/).filter(Boolean);
        activeEl.textContent = '';
        wordEls = words.map((word, k) => {
            const s = h('span.w', null, word);
            activeEl.appendChild(s);
            if (k < words.length - 1) activeEl.appendChild(document.createTextNode(' '));
            return s;
        });
    }
    for (let k = 0; k < wordEls.length; k++) wordEls[k].classList.toggle('wcur', k === w);
}

function scrollToActive() {
    const scroller = $('#reader-scroll');
    const r = activeEl.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    const margin = sr.height * 0.22;
    if (r.top < sr.top + margin || r.bottom > sr.bottom - margin) scroller.scrollTop += (r.top - sr.top) - sr.height * 0.35;
}

function updateTransport() {
    const n = ps.seg ? ps.seg.sentences.length : 0;
    const i = Math.max(ps.cur, 0);
    $('#btn-play').textContent = ps.playing ? '▮▮' : '▶';
    $('#btn-play').title = ps.playing ? 'Pause (space)' : 'Play (space)';
    const pct = n ? Math.round(((i + (ps.playing ? 1 : 0)) / n) * 100) : 0;
    $('#progress').textContent = n
        ? 'sentence ' + (i + 1) + ' / ' + n + ' · ' + Math.min(pct, 100) + '%' + (ps.buffering ? ' · synthesizing…' : '')
        : '';
    $('#sleep-meta').textContent = ps.sleep.mode === 'off' ? '' : 'sleep in ' + ps.sleep.label;
}
