// ═══ VOICE — the identity seam (one panel per variant) ═══════════════════════

// ── CustomVoice: preset speaker palette ─────────────────────────────────────
function buildSpeakerPanel() {
  const sel = $('#speaker'); sel.textContent = '';
  let names = [];
  try { names = qwen.speakers() || []; } catch (e) {}
  for (const n of names) {
    const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o);
  }
  if (names.length) sel.value = names[0];
  fillLanguages($('#language'));
  const showDialect = () => {
    let d = ''; try { d = qwen.speakerDialect(sel.value) || ''; } catch (e) {}
    $('#dialect').textContent = d ? '· ' + d.replace('_', ' ') : '';
  };
  sel.onchange = showDialect; showDialect();
}

// ── VoiceDesign: a natural-language voice description ────────────────────────
// Two ways in: full-sentence quick presets, and composable tags. The tags are
// grouped (one character noun, free-mix adjectives) and assemble grammatically
// into the instruct string — "a warm, low-pitched, measured elderly storyteller".
// Picking a tag rebuilds the field from the active set; the field stays editable
// for free-hand tweaks (the next tag click reassembles, so fine-tune last).
const INSTRUCT_PRESETS = [
  'a warm, low-pitched elderly storyteller',
  'a bright, energetic young woman, fast and upbeat',
  'a calm late-night radio host, deep and smooth',
  'a crisp British newsreader, measured and clear',
  'a breathy, soft-spoken whisper',
  'an excited sports announcer at full tilt',
];
// kind 'noun' = a single character (mutually exclusive); 'adj' = free-mix modifiers.
const INSTRUCT_GROUPS = [
  { name: 'character', kind: 'noun', tags: ['young woman', 'young man', 'elderly storyteller', 'narrator', 'radio host', 'newsreader', 'sports announcer', 'child'] },
  { name: 'tone',      kind: 'adj',  tags: ['warm', 'bright', 'dark', 'breathy', 'smooth', 'gravelly', 'nasal', 'husky'] },
  { name: 'pitch',     kind: 'adj',  tags: ['low-pitched', 'high-pitched', 'deep'] },
  { name: 'pace',      kind: 'adj',  tags: ['fast', 'measured', 'slow'] },
  { name: 'mood',      kind: 'adj',  tags: ['cheerful', 'calm', 'excited', 'somber', 'gentle', 'tense'] },
];
const ADJ_ORDER = INSTRUCT_GROUPS.filter((g) => g.kind === 'adj').flatMap((g) => g.tags);
const instructAdj = new Set();   // active adjective phrases
let instructNoun = null;         // the single active character, or null

// Assemble "a {adjs} {noun}" from the active tags (grammatical, group-ordered).
function assembleInstruct() {
  const adjs = ADJ_ORDER.filter((a) => instructAdj.has(a));
  if (!adjs.length && !instructNoun) return '';
  return 'a ' + (adjs.length ? adjs.join(', ') + ' ' : '') + (instructNoun || 'voice');
}
function syncInstructChips() {
  const host = $('#instruct-tags');
  for (const btn of host.querySelectorAll('button')) {
    const active = btn._kind === 'noun' ? (instructNoun === btn._tag) : instructAdj.has(btn._tag);
    btn.classList.toggle('active', active);
  }
}
function toggleInstructTag(tag, kind) {
  if (kind === 'noun') instructNoun = (instructNoun === tag) ? null : tag;
  else if (instructAdj.has(tag)) instructAdj.delete(tag); else instructAdj.add(tag);
  $('#instruct').value = assembleInstruct();
  syncInstructChips();
}

function buildInstructPanel() {
  const presets = $('#instruct-presets'); presets.textContent = '';
  for (const p of INSTRUCT_PRESETS) {
    const c = el('button', 'chip', p.split(',')[0]);
    c.title = p;
    // a preset is a full sentence — drop tag state so it isn't reassembled over.
    c.onclick = () => { instructAdj.clear(); instructNoun = null; $('#instruct').value = p; syncInstructChips(); };
    presets.appendChild(c);
  }
  const tags = $('#instruct-tags'); tags.textContent = '';
  for (const g of INSTRUCT_GROUPS) {
    const row = el('div', 'tag-group');
    row.appendChild(el('span', 'tag-glabel', g.name));
    for (const t of g.tags) {
      const c = el('button', 'chip tagchip', t);
      c._tag = t; c._kind = g.kind;
      c.onclick = () => toggleInstructTag(t, g.kind);
      row.appendChild(c);
    }
    tags.appendChild(row);
  }
  if (!$('#instruct').value) $('#instruct').value = INSTRUCT_PRESETS[0];
  syncInstructChips();
  fillLanguages($('#language2'));
}

// ── Base: the x-vector voice designer ───────────────────────────────────────
// The designed voice is the PCA-slider sculptor (lib/designer.js) over the Qwen
// voice basis: continuous identity over ~hundreds of real speakers, seeded from
// named anchors or a cloned clip. enroll projects a real clip INTO the sliders.
function buildDesignerPanel() {
  fillLanguages($('#language3'));
  designedXvec = null;
  buildVoiceSliders();             // hides itself if no qwen_voice_basis.json
  if (voiceBasis) seedVoice('__mean__');   // a neutral designed voice, ready to render
}

// Decode a reference clip → x-vector, and project it into the slider space so it
// can be sculpted from there (the basis is the canonical designed point). Without
// a basis, fall back to using the raw clip x-vector directly.
function enrollRef() {
  const path = $('#ref-wav').value.trim();
  if (!path) { setBadge('enter or browse a reference .wav first', true); return; }
  try {
    audioCtx = audioCtx || new AudioContext();
    const dec = audioCtx.decodeAudioFile(path);
    if (!dec || !dec.samples || !dec.samples.length) { setBadge('could not decode ' + path, true); return; }
    const xv = qwen.embedSpeaker(toMono(dec.samples, dec.channels), { sampleRate: dec.sampleRate });
    if (voiceBasis) {
      coords = coordsFromXvec(xv); syncSliders(); rebuildDesigned();
    } else {
      designedXvec = xv; updateDesignerMeta();
    }
    setBadge('enrolled "' + pName(path).replace(/\.[^.]+$/, '') + '" · ' + xv.length + '-D x-vector → sliders');
  } catch (e) { setBadge('enroll: ' + e.message, true); }
}

// Reflect a change into the right meta line. On Base the emotion / masc-fem offsets
// fold into the designed x-vector, so the designer line reports the final norm; on
// CustomVoice they ride the preset's prefill slot, summarized in #axes. (Shared by
// the designer, emotion and masc-fem panels.)
function updateDesignerMeta() {
  if (variant !== 'base') { updateAxesMeta(); return; }
  const x = applyMascFem(applyEmotion(designedXvec));
  const norm = x ? Math.sqrt(x.reduce((s, v) => s + v * v, 0)) : 0;
  $('#designer-meta').textContent = designedXvec
    ? 'designed x-vector ‖' + norm.toFixed(2) + '‖' + emotionSummary() + mascFemSummary()
    : 'move a slider or pick a seed to design a voice';
}

// The CustomVoice axes readout: the active steering mix (or '' when none dialed).
function updateAxesMeta() {
  const m = $('#axes-meta'); if (!m) return;
  const s = (emotionSummary() + mascFemSummary()).replace(/^ · /, '');
  m.textContent = s ? 'steering ' + s + ' · press Render to hear it' : '';
}

// The synthesis opts fragment for the active variant. In Base, the emotion + masc/fem
// bases (if any) nudge the designed x-vector along the dialed-in directions.
function currentVoice() {
  if (variant === 'customvoice') return { speaker: $('#speaker').value };
  if (variant === 'voicedesign') return { instruct: $('#instruct').value.trim() };
  if (designedXvec) return { xvector: applyMascFem(applyEmotion(designedXvec)) };
  return null;   // base with no voice designed yet
}
