// ═══ TEXT — the text box, non-verbal tag chips, tokenizer preview, sentences ═══
import { $, omni, FPS } from "/app/lib/state.js";
import { el } from "/app/lib/helpers.js";
import { updateEstimate, lengthOpts } from "/app/lib/schedule.js";
import { activePrompt } from "/app/lib/voice.js";

export function currentText() { return $('#text').value; }
export function setText(t) { $('#text').value = t; onTextChanged(); }
export function chainOn() { return $('#chain-on').checked; }

// Insert a tag at the caret (tags tokenize standalone, so they can sit anywhere).
function insertAtCaret(s) {
  const ta = $('#text'), v = ta.value;
  let a = ta.selectionStart, b = ta.selectionEnd;
  if (typeof a !== 'number') { a = b = v.length; }
  const pre = v.slice(0, a), post = v.slice(b);
  const sp1 = pre && !/\s$/.test(pre) ? ' ' : '', sp2 = post && !/^\s/.test(post) ? ' ' : '';
  ta.value = pre + sp1 + s + sp2 + post;
  try { ta.selectionStart = ta.selectionEnd = (pre + sp1 + s + sp2).length; } catch (e) {}
  ta.focus();
  onTextChanged();
}

let tokTimer = 0;
function updateTokens() {
  if (!omni) return;
  const text = currentText();
  let n = 0; try { n = omni.tokenize(text).length; } catch (e) {}
  const chars = text.length;
  $('#tok-meta').textContent = n + ' text ids · ' + chars + ' chars' +
    (n ? ' · ' + (chars / n).toFixed(1) + ' chars/id' : '');
}
export function onTextChanged() {
  if (tokTimer) clearTimeout(tokTimer);
  tokTimer = setTimeout(() => { tokTimer = 0; updateTokens(); updateEstimate(); rebuildSentences(); }, 120);
}

// ── sentences (per-sentence pacing) ──────────────────────────────────────────
// Split at sentence-final punctuation (ASCII + CJK) and newlines; a '.' inside
// an abbreviation (Mr. / e.g.) is left alone; a closing quote / bracket sticks
// to its sentence. Segments under three characters merge into the previous one.
const ABBREV = /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|no)\.$/i;
export function splitSentences(text) {
  const out = [];
  let buf = '';
  const src = text.replace(/\r/g, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    buf += ch;
    const endP = '.!?。！？'.indexOf(ch) >= 0, nl = ch === '\n';
    if (endP) {
      // swallow a run of punctuation + a closing quote/bracket
      while (i + 1 < src.length && '.!?。！？"”’)\']'.indexOf(src[i + 1]) >= 0) buf += src[++i];
      const trimmed = buf.trim();
      if (ABBREV.test(trimmed)) continue;
      if (i + 1 < src.length && !/\s/.test(src[i + 1]) && '。！？'.indexOf(ch) < 0) continue;  // "3.14"
      out.push(trimmed); buf = '';
    } else if (nl) {
      const t = buf.trim(); if (t) out.push(t); buf = '';
    }
  }
  const t = buf.trim(); if (t) out.push(t);
  // merge slivers
  const merged = [];
  for (const s of out) {
    if (merged.length && s.length < 3) merged[merged.length - 1] += ' ' + s;
    else merged.push(s);
  }
  return merged;
}

// Per-sentence rows: text + a seconds field (0 = the rule decides) + the rule's
// estimate against the ACTIVE prompt (segment N+1 is really estimated against
// segment N's output at generation time, so this is the first-order guess).
const durations = new Map();   // sentence text -> seconds the user typed
export function rebuildSentences() {
  const host = $('#sentences');
  const on = chainOn();
  host.style.display = on ? 'flex' : 'none';
  host.textContent = '';
  if (!on) return;
  const sents = splitSentences(currentText());
  const prompt = activePrompt(), speed = lengthOpts().speed;
  sents.forEach((s, i) => {
    const row = el('div', 'sent');
    row.appendChild(el('span', 'meta', String(i + 1)));
    const t = el('span', 'stext', s); t.title = s; row.appendChild(t);
    const d = document.createElement('input'); d.type = 'number'; d.className = 'sdur'; d.min = '0'; d.step = '0.1';
    d.value = String(durations.get(s) || 0); d.title = 'seconds for this sentence (0 = auto)';
    d.addEventListener('change', () => { durations.set(s, Math.max(0, +d.value || 0)); refreshRow(); });
    row.appendChild(d);
    const est = el('span', 'sest', ''); row.appendChild(est);
    const refreshRow = () => {
      let fr = 0; try { fr = omni ? omni.estimateFrames(s, { prompt, speed }) : 0; } catch (e) {}
      const fixed = durations.get(s) || 0;
      est.textContent = fixed > 0 ? Math.round(fixed * FPS) + ' fr fixed · rule ' + fr : 'rule ' + fr + ' fr · ' + (fr / FPS).toFixed(2) + 's';
    };
    refreshRow();
    row._text = s; row._dur = d;
    host.appendChild(row);
  });
  if (!sents.length) host.appendChild(el('span', 'hint', 'no sentences'));
}
export function sentenceRows() {
  return [...$('#sentences').querySelectorAll('.sent')].map((r) => ({ text: r._text, seconds: Math.max(0, +r._dur.value || 0) }));
}
export function setSentenceSeconds(i, seconds) {
  const rows = [...$('#sentences').querySelectorAll('.sent')];
  if (!rows[i]) return;
  rows[i]._dur.value = String(seconds); durations.set(rows[i]._text, seconds);
  rows[i]._dur.dispatchEvent(new Event('change'));
}

export function buildTextPanel() {
  const chips = $('#tag-chips'); chips.textContent = '';
  let tags = [];
  try { tags = omni.nonverbalTags() || []; } catch (e) {}
  for (const t of tags) {
    const c = el('button', 'chip', t); c.title = 'insert ' + t + ' at the caret (tokenizes standalone)';
    c.addEventListener('click', () => insertAtCaret(t));
    chips.appendChild(c);
  }
  const ph = el('button', 'chip', '[phonemes]'); ph.title = 'CMU phonemes in square brackets, e.g. [HH AH0 L OW1]';
  ph.addEventListener('click', () => insertAtCaret('[HH AH0 L OW1]'));
  chips.appendChild(ph);
  const py = el('button', 'chip', 'pinyin'); py.title = 'Mandarin as pinyin with tone digits';
  py.addEventListener('click', () => insertAtCaret('ni3 hao3'));
  chips.appendChild(py);
  updateTokens();
  rebuildSentences();
}
