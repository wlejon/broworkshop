// ═══ data source ═════════════════════════════════════════════════════════════
// One folder drives everything the lab needs: the Kokoro model dir (model +
// voice_basis + voice_bridge + voices) and the phonemizer assets (g2p lexicon,
// POS tagger, config vocab). Three layouts are recognised, auto-detected from
// the folder you point at:
//   · brosoundml-data — the published HF dataset:  <root>/{kokoro,g2p,pos_tagger}
//   · brosoundml repo — the dev sibling:           <root>/weights/kokoro  (+ ../brosoundml-data)
//   · a bare Kokoro dir — config.json sitting right inside it
// The model dir, the speaker-encoder clone dir, and how the phonemizer assets
// resolve all follow from which layout it is, so the user only ever picks one folder.
const _fs = require('fs');
function pExists(p) { try { return _fs.existsSync(p); } catch (e) { return false; } }
function pParent(p) { return p.replace(/[\\\/]+$/, '').replace(/[\\\/][^\\\/]*$/, ''); }

const paths = {
  root: '', kind: 'data', model: '', qwen: '', spkenc: '',
  // Point the phonemizer at this source's g2p/POS/config assets. The sibling
  // layout has its own well-known shape (setAssetRoot); the flat data layouts
  // need explicit per-file paths (setAssets).
  configureAssets() {
    if (this.kind === 'sibling') {
      bro.tts.setAssetRoot(this.root);
    } else if (this.kind === 'data') {
      bro.tts.setAssets({
        lexicon:      this.root + '/g2p/lexicon_en_us.bin',
        posTagger:    this.root + '/pos_tagger/model.bin',
        kokoroConfig: this.root + '/kokoro/config.json',
      });
    } else {                                  // a bare kokoro dir — config only
      bro.tts.setAssets({ kokoroConfig: this.model + '/config.json' });
    }
  },
};

// Recognise which layout `root` is, and where its kokoro + qwen dirs live.
// Returns null if nothing identifiable is found inside it.
function detectSource(root) {
  root = root.replace(/[\\\/]+$/, '');
  // The clone enrolls via the standalone ~18 MB speaker-encoder artifact in
  // brosoundml-data (qwen-tts/speaker-encoder), not the full ~2.5 GB Base
  // checkpoint. `qwen` is kept (other flows may want Base) but clone uses spkenc.
  if (pExists(root + '/kokoro/config.json'))
    return { kind: 'data', root, model: root + '/kokoro', qwen: root + '/qwen-tts/0.6B-Base',
             spkenc: root + '/qwen-tts/speaker-encoder' };
  if (pExists(root + '/weights/kokoro/config.json'))
    return { kind: 'sibling', root, model: root + '/weights/kokoro', qwen: root + '/weights/qwen-tts/0.6B-Base',
             spkenc: pParent(root) + '/brosoundml-data/qwen-tts/speaker-encoder' };
  if (pExists(root + '/config.json')) {                   // root itself is a kokoro dir
    const parent = pParent(root);
    if (pExists(parent + '/g2p/lexicon_en_us.bin'))       // …/<brosoundml-data>/kokoro
      return { kind: 'data', root: parent, model: root, qwen: parent + '/qwen-tts/0.6B-Base',
               spkenc: parent + '/qwen-tts/speaker-encoder' };
    const repo = pParent(parent);
    if (pExists(repo + '/weights/kokoro/config.json'))    // …/<repo>/weights/kokoro
      return { kind: 'sibling', root: repo, model: root, qwen: repo + '/weights/qwen-tts/0.6B-Base',
               spkenc: pParent(repo) + '/brosoundml-data/qwen-tts/speaker-encoder' };
    return { kind: 'model', root, model: root, qwen: parent + '/qwen-tts/0.6B-Base',
             spkenc: parent + '/qwen-tts/speaker-encoder' };
  }
  return null;
}

// Resolve a sensible starting data source for this machine. The HTML ships a
// Windows dev default; on first run (or after a move) we probe the usual spots
// and adopt the first that detectSource() recognises — so the app comes up
// pointed at real data without the user editing a path. A browsed/typed path is
// remembered in localStorage and wins on the next launch.
const _os = require('os');
function rememberedRoot() {
  try { return localStorage.getItem('kokoro-lab.dataRoot') || ''; } catch (e) { return ''; }
}
function rememberRoot(root) {
  try { localStorage.setItem('kokoro-lab.dataRoot', root); } catch (e) {}
}
function defaultRoot(htmlDefault) {
  let home = '';
  try { home = _os.homedir(); } catch (e) {}
  const candidates = [
    rememberedRoot(),                       // an earlier choice, if any
    htmlDefault,                            // the value baked into index.html
    home && home + '/projects/brosoundml-data',
    home && home + '/projects/brosoundml',
  ].filter(Boolean);
  for (const c of candidates) if (detectSource(c)) return c;
  return rememberedRoot() || htmlDefault;   // nothing detected — show best guess
}

// Adopt `root` as the data source: detect its layout, update the resolved paths
// and the status label. Loads nothing — see switchSource() for that.
function setSource(rootIn) {
  const root = (rootIn || '').replace(/[\\\/]+$/, '');
  const det = detectSource(root);
  const r = det || { kind: 'data', root, model: root + '/kokoro', qwen: root + '/qwen-tts/0.6B-Base',
                     spkenc: root + '/qwen-tts/speaker-encoder' };
  paths.root = r.root; paths.kind = r.kind; paths.model = r.model;
  paths.qwen = r.qwen; paths.spkenc = r.spkenc;
  const meta = $('#data-meta');
  if (meta) {
    const name = r.kind === 'sibling' ? 'brosoundml repo'
               : r.kind === 'model'   ? 'Kokoro dir' : 'brosoundml-data';
    meta.textContent = (det ? '✓ ' : '⚠ ') + name + ' · model ' + r.model;
    meta.classList.toggle('err', !det);
  }
}

function loadBasis() {
  // The basis + adapter live in the Kokoro model dir (kokoro/ in brosoundml-data,
  // weights/kokoro/ in the dev repo), so they travel with the voices they derive from.
  try {
    basis = JSON.parse(_fs.readFileSync(paths.model + '/voice_basis.json', 'utf-8'));
    coords = new Float64Array(basis.k);
  } catch (e) {
    setBadge('voice_basis.json missing from ' + paths.model + ' — run tests/_voice_basis.js', true);
  }
}

// The Tier-1 emotion (timbre) directions, beside the model like voice_basis.json
// (built by bro/tests/_emotion_basis.js). Optional: if it's absent the timbre
// panel simply stays hidden — the lab is fully usable without it.
function loadEmotionBasis() {
  emotionBasis = null; emoTimbre = {};
  try {
    emotionBasis = JSON.parse(_fs.readFileSync(paths.model + '/emotion_basis.json', 'utf-8'));
    for (const e of emotionBasis.emotions) emoTimbre[e] = 0;
  } catch (e) { /* no artifact → panel hidden, no error */ }
}

