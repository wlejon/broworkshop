// ═══ VOICE — the identity seam (one panel per variant) ═══════════════════════

// ── CustomVoice: preset speaker palette + the "designed voice" override ──────
// Two voice sources: one of the 9 preset speakers, OR any voice designed on the
// shared voice map (rendered through the slot via speakerVector). cvSource tracks
// which is live; picking a preset selects 'preset', touching the designer selects
// 'designed'. markDesigned()/updateCvSource() keep the status line in sync.
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
  sel.onchange = () => { cvSource = 'preset'; showDialect(); updateCvSource(); scheduleLive(); };
  cvSource = 'preset'; showDialect(); updateCvSource();
}

// A designer interaction (map / seed / slider / random / enroll) switches a
// CustomVoice render onto the designed voice; a "use preset" reset switches back.
function markDesigned() { cvSource = 'designed'; updateCvSource(); }   // the designer handler restreams
function usedPreset()   { cvSource = 'preset';  updateCvSource(); scheduleLive(); }
function updateCvSource() {
  const s = $('#cv-source'); if (!s) return;
  if (variant !== 'customvoice') { s.style.display = 'none'; return; }
  s.style.display = '';
  s.textContent = '';
  if (cvSource === 'designed') {
    s.appendChild(el('span', null, '◆ rendering the designed voice (slot override)'));
    const x = el('span', 'pin-clear', '↺ use preset ‘' + ($('#speaker').value || '') + '’');
    x.addEventListener('click', usedPreset);
    s.appendChild(x);
  } else {
    s.appendChild(el('span', 'hint', 'preset ‘' + ($('#speaker').value || '') + '’ · or design a voice on the map below'));
  }
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
  scheduleLive();
}

function buildInstructPanel() {
  const presets = $('#instruct-presets'); presets.textContent = '';
  for (const p of INSTRUCT_PRESETS) {
    const c = el('button', 'chip', p.split(',')[0]);
    c.title = p;
    // a preset is a full sentence — drop tag state so it isn't reassembled over.
    c.onclick = () => { instructAdj.clear(); instructNoun = null; $('#instruct').value = p; syncInstructChips(); scheduleLive(); };
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

// (The Base/CustomVoice voice designer — the map + sliders + enroll — lives in
// lib/designer.js: buildDesigner / enrollRef / seedVoice / randomDesigned.)

// The designed-voice readout (the map / sliders). On Base the emotion / masc-fem
// offsets fold INTO the x-vector, so its norm includes them; on CustomVoice the
// designed voice fills the slot and emotion/masc-fem ride on top via voiceSteer
// (summarized separately in #axes-meta). Shared by the designer, emotion and
// masc-fem panels.
function updateDesignerMeta() {
  const dm = $('#designer-meta');
  if (dm) {
    if (designedXvec && (variant === 'base' || variant === 'customvoice')) {
      const x = (variant === 'base') ? applyMascFem(applyEmotion(designedXvec)) : designedXvec;
      const norm = Math.sqrt(x.reduce((s, v) => s + v * v, 0));
      // Lead with the identity SOURCE so it's clear whether you're hearing the
      // faithful clone or a point sculpted on the manifold.
      const head = identitySource === 'clone'
        ? '◉ cloned clip · faithful identity'
        : 'designed x-vector ‖' + norm.toFixed(2) + '‖';
      const tail = (variant === 'base' ? emotionSummary() + mascFemSummary() : '');
      const hint = identitySource === 'clone' ? ' · sculpt the map/sliders to design from here' : '';
      dm.textContent = head + tail + hint;
    } else {
      dm.textContent = voiceBasis ? 'drag the map or pick a seed to design a voice' : '';
    }
  }
  if (variant === 'customvoice') updateAxesMeta();
}

// The CustomVoice axes readout: the active emotion / masc-fem steering mix.
function updateAxesMeta() {
  const m = $('#axes-meta'); if (!m) return;
  const s = (emotionSummary() + mascFemSummary()).replace(/^ · /, '');
  m.textContent = s ? 'steering ' + s + ' · streams as you dial' : '';
}

// The synthesis opts fragment for the active variant.
//   Base        — the designed x-vector (emotion + masc/fem folded in).
//   CustomVoice — a preset speaker, OR (when the designer is in use) the designed
//                 voice dropped into the slot via speakerVector; emotion/masc-fem
//                 then ride on top as voiceSteer (added in gatherOpts).
//   VoiceDesign — the natural-language instruction.
function currentVoice() {
  if (variant === 'customvoice') {
    if (cvSource === 'designed' && designedXvec) return { speakerVector: designedXvec };
    return { speaker: $('#speaker').value };
  }
  if (variant === 'voicedesign') return { instruct: $('#instruct').value.trim() };
  if (designedXvec) return { xvector: applyMascFem(applyEmotion(designedXvec)) };
  return null;   // base with no voice designed yet
}
