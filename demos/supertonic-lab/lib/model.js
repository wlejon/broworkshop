// ═══ model load + voice presets + languages ══════════════════════════════════
import { $ } from "/app/lib/state.js";
import { _fs, _os, pExists, recall, remember } from "/app/lib/helpers.js";
import { bargeIn, scheduleLive } from "/app/lib/synth.js";
import { initDesign, designActive, designedMatrices } from "/app/lib/design.js";

// owned shared state (read by synth / app)
export let supertonic = null;   // the loaded Supertonic model
let voiceStylesDir = '';        // <modelDir>/voice_styles
const voiceCache = {};          // name -> SupertonicVoice handle (lazily loaded)
const presetMats = {};          // name -> { ttl, dp } (read once for the designer)

export function setBadge(text, err) {
  const b = $('#backend');
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

// The 32 frontend language codes the converted model's UnicodeProcessor accepts,
// with friendly labels. 'na' is the no-language-tag default.
const LANGS = [
  ['en', 'English'], ['ko', 'Korean'], ['ja', 'Japanese'], ['ar', 'Arabic'],
  ['bg', 'Bulgarian'], ['cs', 'Czech'], ['da', 'Danish'], ['de', 'German'],
  ['el', 'Greek'], ['es', 'Spanish'], ['et', 'Estonian'], ['fi', 'Finnish'],
  ['fr', 'French'], ['hi', 'Hindi'], ['hr', 'Croatian'], ['hu', 'Hungarian'],
  ['id', 'Indonesian'], ['it', 'Italian'], ['lt', 'Lithuanian'], ['lv', 'Latvian'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ro', 'Romanian'],
  ['ru', 'Russian'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['sv', 'Swedish'],
  ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['vi', 'Vietnamese'], ['na', '— none —'],
];

// Probe a sensible default model dir for this machine on first run.
export function defaultModelDir(htmlDefault) {
  let home = ''; try { home = _os.homedir(); } catch (e) {}
  const cands = [
    recall('supertonic-lab.modelDir'),
    htmlDefault,
    home && home + '/projects/brosoundml-data/supertonic',
  ].filter(Boolean);
  for (const c of cands) if (pExists(c + '/tts.json')) return c;
  return recall('supertonic-lab.modelDir') || htmlDefault;
}

// Fill the voice <select> by scanning voice_styles/ for *.json presets.
function fillVoices(dir) {
  const sel = $('#voice-sel');
  sel.textContent = '';
  for (const k of Object.keys(voiceCache)) delete voiceCache[k];
  for (const k of Object.keys(presetMats)) delete presetMats[k];
  voiceStylesDir = dir + '/voice_styles';
  let names = [];
  try {
    names = _fs.readdirSync(voiceStylesDir)
      .filter((f) => /\.json$/i.test(f))
      .map((f) => f.replace(/\.json$/i, ''))
      .sort();
  } catch (e) {}
  if (!names.length) { setBadge('no voice_styles/ in ' + dir, true); return; }
  for (const n of names) {
    const o = document.createElement('option'); o.value = n; o.textContent = n;
    sel.appendChild(o);
  }
  const want = recall('supertonic-lab.voice');
  sel.value = names.indexOf(want) >= 0 ? want : names[0];
  sel.onchange = () => { remember('supertonic-lab.voice', sel.value); scheduleLive(); };
  $('#voice-meta').textContent = names.length + ' presets';

  // Read every preset's matrices once (host-side, fast) so the designer can
  // compute the global mean + the masc↔fem axis and blend any two voices.
  const ok = [];
  for (const n of names) {
    try {
      const v = supertonic.loadVoiceStyle(voiceStylesDir + '/' + n + '.json');
      voiceCache[n] = v;
      presetMats[n] = { ttl: v.ttl, dp: v.dp };
      ok.push(n);
    } catch (e) {}
  }
  if (ok.length) initDesign(presetMats, ok);
}

function fillLanguages() {
  const sel = $('#language');
  sel.textContent = '';
  for (const [code, label] of LANGS) {
    const o = document.createElement('option'); o.value = code; o.textContent = label + ' (' + code + ')';
    sel.appendChild(o);
  }
  sel.value = recall('supertonic-lab.lang') || 'en';
  sel.onchange = () => { remember('supertonic-lab.lang', sel.value); scheduleLive(); };
}

// The voice to synthesize: a designed voice (when any design axis is active) built
// over the selected preset's matrices, else the raw preset (cached host-side).
export function currentVoice() {
  const name = $('#voice-sel').value;
  if (!name || !supertonic) return null;
  if (designActive()) {
    const d = designedMatrices(name);
    if (d) {
      try { return supertonic.createVoice(d.ttl, d.dp, d.label); }
      catch (e) { setBadge('design: ' + e.message, true); /* fall back to preset */ }
    }
  }
  if (!voiceCache[name]) {
    try { voiceCache[name] = supertonic.loadVoiceStyle(voiceStylesDir + '/' + name + '.json'); }
    catch (e) { setBadge('voice ' + name + ': ' + e.message, true); return null; }
  }
  return voiceCache[name];
}

export function currentLanguage() {
  const sel = $('#language');
  return sel && sel.value ? sel.value : 'en';
}

// Load a converted model directory asynchronously; populate voices + languages.
export function loadModel(dir) {
  dir = (dir || '').replace(/[\\\/]+$/, '');
  supertonic = null;
  bargeIn();                              // drop anything in flight
  $('#btn-synth').disabled = true;
  $('#btn-play').disabled = true;
  $('#model-meta').textContent = '';
  if (!pExists(dir + '/tts.json')) { setBadge('no tts.json in ' + dir, true); return; }
  setBadge('loading model…');
  try {
    bro.tts.loadSupertonic(dir, {
      onReady: (m) => {
        supertonic = m; remember('supertonic-lab.modelDir', dir);
        $('#model-meta').textContent = (m.sampleRate / 1000) + ' kHz · flow-matching';
        fillLanguages();
        fillVoices(dir);
        setBadge('ready · pick a voice — it re-synthesises as you change a seam');
        $('#btn-synth').disabled = false;
      },
      onError: (msg) => setBadge('load failed: ' + msg, true),
    });
  } catch (e) { setBadge('load failed: ' + e.message, true); }
}
