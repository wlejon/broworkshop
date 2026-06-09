// ═══ checkpoint load + variant adaptation ════════════════════════════════════
function setBadge(text, err) {
  const b = $('#backend');
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

// The three bundled checkpoints share a weights root (…/qwen-tts/<name>). Given a
// model dir, light up the quick-switch chips for whichever siblings exist.
const VARIANT_DIRS = { cv: '0.6B-customvoice', vd: '1.7B-voicedesign', base: '0.6B-Base' };
function wireQuickChips(modelDir) {
  const root = pParent(modelDir);
  for (const [id, name] of Object.entries(VARIANT_DIRS)) {
    const btn = $('#btn-' + id), dir = root + '/' + name, ok = pExists(dir + '/config.json');
    btn.disabled = !ok;
    btn.classList.toggle('active', ok && pName(modelDir) === name);
    btn.onclick = ok ? () => { $('#model-dir').value = dir; loadModel(dir); } : null;
  }
}

// Probe a sensible default checkpoint for this machine on first run.
function defaultModelDir(htmlDefault) {
  let home = ''; try { home = _os.homedir(); } catch (e) {}
  const cands = [
    recall('qwen-lab.modelDir'),
    htmlDefault,
    home && home + '/projects/brosoundml/weights/qwen-tts/0.6B-customvoice',
  ].filter(Boolean);
  for (const c of cands) if (pExists(c + '/config.json')) return c;
  return recall('qwen-lab.modelDir') || htmlDefault;
}

// Load a checkpoint asynchronously; adapt the UI to its variant once ready.
function loadModel(dir) {
  dir = (dir || '').replace(/[\\\/]+$/, '');
  qwen = null; lastResult = null;
  bargeIn();                                  // drop anything in flight
  $('#btn-render').disabled = true;
  $('#btn-stream').disabled = true;
  $('#btn-play').disabled = true;
  $('#model-meta').textContent = '';
  wireQuickChips(dir);
  if (!pExists(dir + '/config.json')) { setBadge('no config.json in ' + dir, true); return; }
  setBadge('loading checkpoint…');
  try {
    bro.tts.loadQwen(dir, {
      onReady: (q) => {
        qwen = q; variant = q.variant; remember('qwen-lab.modelDir', dir);
        $('#model-meta').textContent = variant + ' · ' + q.sampleRate / 1000 + ' kHz';
        adaptToVariant();
        setBadge('ready · ' + variantHint());
        $('#btn-render').disabled = false;
        // Streaming has no x-vector path, so it's speaker/instruct only.
        $('#btn-stream').disabled = (variant === 'base');
      },
      onError: (m) => setBadge('load failed: ' + m, true),
    });
  } catch (e) { setBadge('load failed: ' + e.message, true); }
}

function variantHint() {
  return variant === 'customvoice' ? 'pick a speaker, then Render or Stream'
       : variant === 'voicedesign' ? 'describe the voice, then Render or Stream'
       : 'enroll a clip or go random, then Render';
}

// Show exactly one voice panel and (re)build it for the loaded model.
function adaptToVariant() {
  // Set an explicit display (not '') when showing: bro's CSS engine doesn't fall
  // back to the stylesheet's `display:flex` when an inline display is cleared.
  const show = (sel, on) => { $(sel).style.display = on ? 'flex' : 'none'; };
  show('#voice-speaker',  variant === 'customvoice');
  show('#voice-instruct', variant === 'voicedesign');
  show('#voice-designer', variant === 'base');
  const dir = $('#model-dir').value.trim();
  if (variant === 'customvoice') buildSpeakerPanel();
  else if (variant === 'voicedesign') buildInstructPanel();
  else { loadVoiceBasis(dir); buildDesignerPanel(); }   // PCA voice-slider sculptor
  // x-vector-space steering applies wherever there's a speaker slot: it rides the
  // Base designed x-vector, and on CustomVoice it nudges the preset's prefill slot
  // (via opts.voiceSteer — the same 1024-D directions). VoiceDesign has no slot,
  // so no axes. The bases live beside the Base checkpoint; the loaders search the
  // sibling 0.6B-Base / parent qwen-tts dir so CustomVoice resolves them too.
  const steerable = (variant === 'base' || variant === 'customvoice');
  show('#axes', steerable);
  if (steerable) {
    loadEmotionBasis(dir); buildEmotion();
    loadMascFemBasis(dir); buildMascFem();
  }
}

// Fill a language <select> from the model (shared by all three panels).
function fillLanguages(sel) {
  sel.textContent = '';
  let langs = [];
  try { langs = qwen.languages() || []; } catch (e) {}
  if (!langs.length) langs = ['english'];
  for (const l of langs) {
    const o = document.createElement('option'); o.value = l; o.textContent = l; sel.appendChild(o);
  }
  if (langs.indexOf('english') >= 0) sel.value = 'english';
}
// The active language, read from whichever panel is showing.
function currentLanguage() {
  const id = variant === 'customvoice' ? '#language'
           : variant === 'voicedesign' ? '#language2' : '#language3';
  const sel = $(id);
  return sel && sel.value ? sel.value : 'english';
}
