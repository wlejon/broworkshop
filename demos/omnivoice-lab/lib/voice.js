// ═══ VOICE — the prompt bank, voice design, the language picker ══════════════
// A voice is an in-context PROMPT (a reference clip's codec codes + transcript
// + RMS: a plain object the model reads, `createPrompt` / `loadPrompt` make),
// or a fixed-vocabulary INSTRUCT ('female, young, whisper'), or neither.
import { $, omni } from "/app/lib/state.js";
import { el, setBadge, browseFile, saveFile, pName, slug, resampleTo, fmtSecs } from "/app/lib/helpers.js";
import { decodeFile } from "/app/lib/audio.js";
import { whisperDir } from "/app/lib/model.js";
import { updateEstimate } from "/app/lib/schedule.js";
import { rebuildSentences } from "/app/lib/text.js";

// ── the prompt bank ──────────────────────────────────────────────────────────
export const prompts = [];        // { name, prompt, source }
export let activeIdx = -1;
export function activePrompt()     { return activeIdx >= 0 ? prompts[activeIdx].prompt : null; }
export function activePromptName() { return activeIdx >= 0 ? prompts[activeIdx].name : ''; }
export function denoise() { return $('#denoise').checked; }

export function addPrompt(name, prompt, source) {
  const entry = { name: uniqueName(name || 'voice'), prompt, source: source || '' };
  prompts.push(entry);
  setActive(prompts.length - 1);
  return entry;
}
function uniqueName(base) {
  let n = base, k = 2;
  while (prompts.some((p) => p.name === n)) n = base + ' ' + (k++);
  return n;
}
export function setActive(i) {
  activeIdx = (i >= 0 && i < prompts.length) ? i : -1;
  renderBank();
  updateEstimate();          // the estimate reads the prompt's transcript / length
  rebuildSentences();
}
export function removePrompt(i) {
  prompts.splice(i, 1);
  if (activeIdx === i) activeIdx = -1; else if (activeIdx > i) activeIdx--;
  setActive(activeIdx);
}

export function renderBank() {
  const host = $('#prompt-bank'); host.textContent = '';
  if (!prompts.length) { host.appendChild(el('span', 'hint empty', 'no prompts yet — create one from a clip or a take · none active = the model picks a voice')); return; }
  prompts.forEach((p, i) => {
    const row = el('div', 'prompt-entry' + (i === activeIdx ? ' active' : ''));
    row.appendChild(el('span', 'pick'));
    const name = document.createElement('input'); name.type = 'text'; name.className = 'pname'; name.value = p.name;
    name.title = 'rename'; name.addEventListener('change', () => { p.name = name.value.trim() || p.name; renderBank(); });
    name.addEventListener('mousedown', (e) => e.stopPropagation());
    row.appendChild(name);
    const pr = p.prompt, secs = (pr.numFrames / 25).toFixed(2);
    row.appendChild(el('span', 'pinfo', pr.numFrames + ' fr · ' + secs + 's · rms ' + (pr.rms || 0).toFixed(3) +
      (pr.text ? ' · “' + pr.text.slice(0, 40) + (pr.text.length > 40 ? '…' : '') + '”' : ' · text-free') +
      (p.source ? ' · ' + p.source : '')));
    const save = el('button', 'mini', '⤓ .ovcp'); save.title = 'Save this prompt as an .ovcp file';
    save.addEventListener('click', (e) => { e.stopPropagation(); savePromptFile(i); });
    row.appendChild(save);
    const x = el('button', 'mini x', '✕'); x.title = 'Remove from the bank';
    x.addEventListener('click', (e) => { e.stopPropagation(); removePrompt(i); });
    row.appendChild(x);
    row.addEventListener('click', () => setActive(i === activeIdx ? -1 : i));
    row.title = i === activeIdx ? 'active — click to deselect (no prompt)' : 'click to make this the active voice';
    host.appendChild(row);
  });
}

// ── clip -> prompt ───────────────────────────────────────────────────────────
export function promptFromClip() {
  if (!omni) return null;
  const path = $('#ref-wav').value.trim();
  if (!path) { setBadge('enter or browse a reference clip first', true); return null; }
  try {
    const dec = decodeFile(path);
    if (!dec) { setBadge('could not decode ' + path, true); return null; }
    const refText = $('#ref-text').value.trim();
    const prompt = omni.createPrompt(dec.samples, { sampleRate: dec.sampleRate, refText });
    const entry = addPrompt(pName(path).replace(/\.[^.]+$/, ''), prompt, 'clip');
    setBadge('prompt “' + entry.name + '” · ' + prompt.numFrames + ' frames' + (refText ? '' : ' · text-free (no transcript)'));
    return entry;
  } catch (e) { setBadge('createPrompt: ' + e.message, true); return null; }
}

// Any take's output becomes the voice: encode it with its own text as the transcript.
export function promptFromTake(take) {
  if (!omni || !take) return null;
  try {
    const prompt = omni.createPrompt(take.samples, { sampleRate: take.sampleRate, refText: take.text });
    const entry = addPrompt(take.name, prompt, 'take');
    setBadge('voice “' + entry.name + '” from ' + take.name + ' · ' + prompt.numFrames + ' frames');
    return entry;
  } catch (e) { setBadge('createPrompt: ' + e.message, true); return null; }
}

// Load a saved prompt file (user click).
export function loadOvcp() {
  if (!omni) return;
  const path = browseFile('OmniVoice prompt|ovcp'); if (!path) return;
  try {
    const prompt = omni.loadPrompt(path);
    addPrompt(pName(path).replace(/\.ovcp$/i, ''), prompt, 'ovcp');
  } catch (e) { setBadge('loadPrompt: ' + e.message, true); }
}
function savePromptFile(i) {
  const p = prompts[i]; if (!p || !omni) return;
  const path = saveFile('OmniVoice prompt|ovcp', slug(p.name) + '.ovcp'); if (!path) return;
  try { omni.savePrompt(p.prompt, /\.ovcp$/i.test(path) ? path : path + '.ovcp'); setBadge('saved ' + path); }
  catch (e) { setBadge('savePrompt: ' + e.message, true); }
}

// ── Whisper transcript of the reference clip ─────────────────────────────────
let transcribe = null;   // lazily loaded: (samples, sr) -> text
function ensureWhisper() {
  if (transcribe) return true;
  const dir = whisperDir();
  if (!dir) { setBadge('Whisper weights not found beside the model dir (…/weights/whisper)', true); return false; }
  try {
    const whisper = bro.stt.loadWhisper(dir);
    const tok = bro.stt.loadTokenizer({ vocabPath: dir + '/vocab.json', mergesPath: dir + '/merges.txt' });
    const prompt = tok.buildPrompt('en', 'transcribe', false);
    transcribe = (s, r) => {
      const ids = whisper.transcribe({ samples: resampleTo(s, r, 16000), sampleRate: 16000 }, prompt, { maxNewTokens: 224 });
      return tok.decode(ids, true).trim();
    };
    return true;
  } catch (e) { setBadge('whisper: ' + e.message, true); return false; }
}
export function transcribeClip() {
  const path = $('#ref-wav').value.trim();
  if (!path) { setBadge('enter or browse a reference clip first', true); return ''; }
  const dec = decodeFile(path);
  if (!dec) { setBadge('could not decode ' + path, true); return ''; }
  setBadge('transcribing ' + fmtSecs(dec.samples.length, dec.sampleRate) + ' with Whisper…');
  if (!ensureWhisper()) return '';
  try {
    const text = transcribe(dec.samples, dec.sampleRate);
    $('#ref-text').value = text;
    setBadge('transcribed · edit the transcript, then ＋ prompt from clip');
    return text;
  } catch (e) { setBadge('transcribe: ' + e.message, true); return ''; }
}
// Transcribe any buffer (a take, for tests / re-checks).
export function transcribeSamples(samples, rate) {
  if (!ensureWhisper()) return '';
  return transcribe(samples, rate);
}

// ── voice design: one pick per instruct category ─────────────────────────────
let pickSelects = [];
function buildInstructPicks() {
  const host = $('#instruct-picks'); host.textContent = ''; pickSelects = [];
  let attrs = [];
  try { attrs = omni.instructAttributes() || []; } catch (e) {}
  for (const a of attrs) {
    const cat = el('div', 'pick-cat');
    const labelText = a.name.toLowerCase() === 'gender' ? 'sex' : a.name;
    cat.appendChild(el('label', null, labelText));
    const sel = document.createElement('select');
    sel.title = 'instruct · ' + labelText + ' (at most one value per category)';
    const none = document.createElement('option'); none.value = ''; none.textContent = '—'; sel.appendChild(none);
    for (const v of a.values) { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); }
    sel.addEventListener('change', updateInstructPreview);
    sel._cat = a.name;
    cat.appendChild(sel); host.appendChild(cat); pickSelects.push(sel);
  }
  updateInstructPreview();
}
export function currentInstruct() {
  return pickSelects.map((s) => s.value).filter(Boolean).join(', ');
}
export function setInstructPick(cat, value) {
  const norm = (c) => (c || '').toLowerCase();
  const s = pickSelects.find((x) => {
    const xc = norm(x._cat), tc = norm(cat);
    return xc === tc || ((xc === 'gender' || xc === 'sex') && (tc === 'gender' || tc === 'sex'));
  });
  if (!s) return;
  s.value = value || ''; updateInstructPreview();
}
export function clearInstruct() { for (const s of pickSelects) s.value = ''; updateInstructPreview(); }
function updateInstructPreview() {
  const s = currentInstruct();
  $('#instruct-preview').textContent = 'instruct: ' + (s ? '“' + s + '”' : '(none)') +
    (s && activeIdx >= 0 ? ' · a prompt is active too — the clone dominates' : '');
}

// ── language picker: 600+ names, a search box, and None ──────────────────────
let langs = [];
let langValue = '';       // '' = None
function buildLanguages() {
  try { langs = omni.languages() || []; } catch (e) { langs = []; }
  const sel = $('#language');
  const fill = () => {
    const q = $('#lang-search').value.trim().toLowerCase();
    sel.textContent = '';
    const none = document.createElement('option'); none.value = ''; none.textContent = 'None (language-agnostic)'; sel.appendChild(none);
    let shown = 0;
    for (const l of langs) {
      if (q && l.toLowerCase().indexOf(q) < 0) continue;
      const o = document.createElement('option'); o.value = l; o.textContent = l; sel.appendChild(o); shown++;
    }
    sel.value = langValue;
    $('#lang-meta').textContent = shown + ' / ' + langs.length + ' languages' + (langValue ? ' · ' + langValue : ' · None');
  };
  fill();
  $('#lang-search').oninput = fill;
  sel.onchange = () => { langValue = sel.value; $('#lang-meta').textContent = langs.length + ' languages · ' + (langValue || 'None'); };
  // English is the sensible default when it exists.
  const en = langs.find((l) => l.toLowerCase() === 'english');
  if (en) { langValue = en; sel.value = en; $('#lang-meta').textContent = langs.length + ' languages · ' + en; }
}
export function currentLanguage() { return langValue; }
export function setLanguage(name) {
  langValue = name || '';
  const sel = $('#language'); if (sel) { sel.value = langValue; }
  $('#lang-meta').textContent = langs.length + ' languages · ' + (langValue || 'None');
}
export function languageCount() { return langs.length; }

// The conditioning fragment every generation reads.
export function currentCond() {
  return { prompt: activePrompt(), promptName: activePromptName(), language: currentLanguage(),
           instruct: currentInstruct(), denoise: denoise() };
}

export function buildVoicePanel() {
  buildInstructPicks();
  buildLanguages();
  renderBank();
}
