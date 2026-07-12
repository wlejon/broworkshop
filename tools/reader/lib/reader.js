// ═══ reader view: sentence spans, word highlight, auto-scroll ═════════════════
// The whole document renders as paragraph <p>s of sentence <span class="sn">s.
// Word spans are only built inside the ACTIVE sentence (and only when the
// engine provides word timings — Kokoro), so huge documents stay cheap.
import { $, settings, applyTheme } from "/app/lib/state.js";
import { segment } from "/app/lib/text.js";
import { engines, ENGINE_LABEL, onEngineChange, statusText } from "/app/lib/engine.js";
import * as player from "/app/lib/player.js";

let sentenceEls = [];
let activeEl = null;
let wordEls = null;

export function initReader() {
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
    setHint('previewing voice…');
    player.previewVoice((err) => setHint(err ? 'preview: ' + err : ''));
  });
  $('#sleep-sel').addEventListener('change', () => {
    const v = $('#sleep-sel').value;
    if (v === 'off') player.setSleep('off');
    else if (v === 'para') player.setSleep('paragraph');
    else player.setSleep('min', parseInt(v, 10));
  });
}

// ── view switching ───────────────────────────────────────────────────────────
export function showReaderView() {
  $('#library-view').style.display = 'none';
  $('#reader-view').style.display = 'flex';
}
export function showLibraryView() {
  player.closeDocument();
  $('#reader-view').style.display = 'none';
  $('#library-view').style.display = 'flex';
  if (showLibraryView._render) showLibraryView._render();   // set by library.js
}
export function readerVisible() { return $('#reader-view').style.display !== 'none'; }

// ── open a document ──────────────────────────────────────────────────────────
export function openDocument(doc) {
  const seg = segment(doc.text);
  doc.sentenceCount = seg.sentences.length;
  player.setDocument(doc, seg);
  $('#doc-title').textContent = doc.title;
  buildText(seg);
  applyTheme();
  fillControls();
  showReaderView();
  highlightSentence(player.cur);
  updateTransport();
  updateBadge();
}

function buildText(seg) {
  const cont = $('#reader-text');
  cont.textContent = '';
  activeEl = null; wordEls = null;
  let si = 0;
  seg.paragraphs.forEach((_, pi) => {
    const pe = document.createElement('p');
    for (; si < seg.sentences.length && seg.sentences[si].para === pi; si++) {
      const sp = document.createElement('span');
      sp.className = 'sn';
      sp.dataset.i = si;
      sp.textContent = seg.sentences[si].text;
      sp.addEventListener('click', onSentenceClick);
      pe.appendChild(sp);
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
  if (sp.value !== String(player.speed())) sp.value = '1';   // not in the list → 1×
  if (player.sleep.mode === 'off') $('#sleep-sel').value = 'off';
}
function fillVoices() {
  const sel = $('#voice-sel');
  const name = player.engineName();
  const e = engines[name];
  sel.textContent = '';
  const list = name === 'kokoro' ? e.voices : e.speakers;
  const want = name === 'kokoro' ? player.kokoroVoiceName() : player.qwenSpeaker();
  if (!list || !list.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = e.status === 'ready' ? '(no voices found)' : '(load to list voices)';
    sel.appendChild(o);
    return;
  }
  for (const v of list) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
  if (list.indexOf(want) >= 0) sel.value = want;
}

export function updateBadge() {
  const b = $('#backend');
  const name = player.engineName();
  b.textContent = statusText(name);
  b.classList.toggle('err', engines[name].status === 'error');
}
function setHint(text, err) {
  const h = $('#hint');
  h.textContent = text || '';
  h.classList.toggle('err', !!err);
}

// ── player events → DOM ──────────────────────────────────────────────────────
function onPlayerEvent(kind, a) {
  if (kind === 'sentence') { highlightSentence(player.cur); updateTransport(); }
  else if (kind === 'word') highlightWord(a);
  else if (kind === 'state' || kind === 'buffer') updateTransport();
  else if (kind === 'params') { fillControls(); updateBadge(); }
  else if (kind === 'sleep') updateTransport();
  else if (kind === 'error') setHint(a, true);
  else if (kind === 'done') setHint('finished — space to read again from the top');
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
  if (!wordEls) {                                  // lazily explode into word spans
    const words = activeEl._plain.split(/\s+/).filter(Boolean);
    activeEl.textContent = '';
    wordEls = words.map((word, k) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = word;
      activeEl.appendChild(s);
      if (k < words.length - 1) activeEl.appendChild(document.createTextNode(' '));
      return s;
    });
  }
  for (let k = 0; k < wordEls.length; k++) wordEls[k].classList.toggle('wcur', k === w);
}

function scrollToActive() {
  if (!activeEl) return;
  const scroller = $('#reader-scroll');
  const r = activeEl.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const margin = sr.height * 0.22;
  if (r.top < sr.top + margin || r.bottom > sr.bottom - margin)
    scroller.scrollTop += (r.top - sr.top) - sr.height * 0.35;
}

function updateTransport() {
  const n = player.seg ? player.seg.sentences.length : 0;
  const i = Math.max(player.cur, 0);
  $('#btn-play').textContent = player.playing ? '▮▮' : '▶';
  $('#btn-play').title = player.playing ? 'Pause (space)' : 'Play (space)';
  const pct = n ? Math.round(((i + (player.playing ? 1 : 0)) / n) * 100) : 0;
  $('#progress').textContent = n
    ? 'sentence ' + (i + 1) + ' / ' + n + ' · ' + Math.min(pct, 100) + '%' + (player.buffering ? ' · synthesizing…' : '')
    : '';
  $('#sleep-meta').textContent = player.sleep.mode === 'off' ? '' : '◔ ' + player.sleep.label;
}
