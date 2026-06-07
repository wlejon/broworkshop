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
const INSTRUCT_PRESETS = [
  'a warm, low-pitched elderly storyteller',
  'a bright, energetic young woman, fast and upbeat',
  'a calm late-night radio host, deep and smooth',
  'a crisp British newsreader, measured and clear',
  'a breathy, soft-spoken whisper',
  'an excited sports announcer at full tilt',
];
function buildInstructPanel() {
  const host = $('#instruct-presets'); host.textContent = '';
  for (const p of INSTRUCT_PRESETS) {
    const c = el('button', 'chip', p.split(',')[0]);
    c.title = p;
    c.onclick = () => { $('#instruct').value = p; };
    host.appendChild(c);
  }
  if (!$('#instruct').value) $('#instruct').value = INSTRUCT_PRESETS[0];
  fillLanguages($('#language2'));
}

// ── Base: the x-vector designer ─────────────────────────────────────────────
function buildDesignerPanel() {
  fillLanguages($('#language3'));
  anchors = []; anchorW = []; designedXvec = null;
  renderAnchors();
}

// Decode a reference clip to mono and encode it to a speaker x-vector anchor.
function enrollRef() {
  const path = $('#ref-wav').value.trim();
  if (!path) { setBadge('enter or browse a reference .wav first', true); return; }
  try {
    audioCtx = audioCtx || new AudioContext();
    const dec = audioCtx.decodeAudioFile(path);
    if (!dec || !dec.samples || !dec.samples.length) { setBadge('could not decode ' + path, true); return; }
    const mono = toMono(dec.samples, dec.channels);
    const xv = qwen.embedSpeaker(mono, { sampleRate: dec.sampleRate });
    addAnchor(pName(path).replace(/\.[^.]+$/, ''), xv);
    setBadge('enrolled "' + anchors[anchors.length - 1].name + '" · ' + xv.length + '-D x-vector');
  } catch (e) { setBadge('enroll: ' + e.message, true); }
}

function addAnchor(name, xvec) {
  // collapse existing weights so a fresh enroll dominates, then add at weight 1.
  for (let i = 0; i < anchorW.length; i++) anchorW[i] = 0;
  anchors.push({ name, xvec });
  anchorW.push(1);
  recomputeBlend(); renderAnchors();
}

function removeAnchor(i) {
  anchors.splice(i, 1); anchorW.splice(i, 1);
  recomputeBlend(); renderAnchors();
}

// A random in-distribution voice: a random convex blend of the enrolled anchors,
// or — with none — the x-vector of a short noise burst (a valid ECAPA point).
function randomVoice() {
  if (anchors.length >= 2) {
    let s = 0; for (let i = 0; i < anchorW.length; i++) { anchorW[i] = Math.random(); s += anchorW[i]; }
    for (let i = 0; i < anchorW.length; i++) anchorW[i] /= (s || 1);
    recomputeBlend(); renderAnchors();
    setBadge('random blend across ' + anchors.length + ' anchors');
  } else {
    try {
      const n = 18000, noise = new Float32Array(n);
      let last = 0;
      for (let i = 0; i < n; i++) { last = 0.97 * last + 0.03 * (Math.random() * 2 - 1); noise[i] = last * 3; }
      const xv = qwen.embedSpeaker(noise, { sampleRate: 24000 });
      addAnchor('random ' + (anchors.length + 1), xv);
      setBadge('random voice enrolled');
    } catch (e) { setBadge('random: ' + e.message, true); }
  }
}

// designedXvec = Σ (normalized weight)·anchor  — a point in continuous voice space.
function recomputeBlend() {
  let sum = 0; for (const w of anchorW) sum += w;
  if (!anchors.length || sum <= 1e-9) { designedXvec = null; return; }
  const D = anchors[0].xvec.length, out = new Float32Array(D);
  for (let a = 0; a < anchors.length; a++) {
    const w = anchorW[a] / sum, x = anchors[a].xvec;
    for (let d = 0; d < D; d++) out[d] += w * x[d];
  }
  designedXvec = out;
}

function renderAnchors() {
  const host = $('#anchors'); host.textContent = '';
  if (!anchors.length) {
    host.appendChild(el('span', 'hint', 'no voices enrolled — browse a .wav and Enroll, or 🎲 random'));
    $('#designer-meta').textContent = '';
    return;
  }
  anchors.forEach((a, i) => {
    const row = el('div', 'anchor');
    row.appendChild(el('span', 'aname', a.name));
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = '0'; sl.max = '1'; sl.step = '0.01'; sl.value = String(anchorW[i]);
    sl.oninput = () => { anchorW[i] = parseFloat(sl.value); recomputeBlend(); updateDesignerMeta(); };
    row.appendChild(sl);
    const x = el('button', 'x', '×'); x.title = 'remove'; x.onclick = () => removeAnchor(i);
    row.appendChild(x);
    host.appendChild(row);
  });
  updateDesignerMeta();
}

function updateDesignerMeta() {
  const norm = designedXvec ? Math.sqrt(designedXvec.reduce((s, v) => s + v * v, 0)) : 0;
  $('#designer-meta').textContent = designedXvec
    ? anchors.length + ' anchor(s) · designed x-vector ‖' + norm.toFixed(2) + '‖'
    : 'all weights zero — raise one to define a voice';
}

// The synthesis opts fragment for the active variant.
function currentVoice() {
  if (variant === 'customvoice') return { speaker: $('#speaker').value };
  if (variant === 'voicedesign') return { instruct: $('#instruct').value.trim() };
  if (designedXvec) return { xvector: designedXvec };
  return null;   // base with no voice designed yet
}
