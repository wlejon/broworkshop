// NLLB-200 Lab — a worked consumer of bro.lm.loadNllb.
//
// Type text, pick a source and target language, translate. The model is
// brolm's NLLB-200 encoder-decoder (M2M-100 arch): one translator between any
// pair of the 200+ FLORES-200 languages. translate() runs async (onDone), so a
// multi-second beam search never freezes the page; Cancel drops the run.
//
// Codes are FLORES-200 ("eng_Latn", "zho_Hans", ...). The dropdowns offer a
// curated common set; model.languageCount says how many the model knows and
// model.hasLanguage(code) checks any code.

import { boot } from "/lib/kit/app.js";
import { h, ids } from "/lib/kit/dom.js";
import { deviceBadge, modelRow } from "/lib/kit/ml.js";

export const NLLB = ['brolm/weights/nllb-200-distilled-600M'];

export const LANGS = [
    ['eng_Latn', 'English'], ['fra_Latn', 'French'], ['spa_Latn', 'Spanish'], ['deu_Latn', 'German'],
    ['ita_Latn', 'Italian'], ['por_Latn', 'Portuguese'], ['nld_Latn', 'Dutch'], ['rus_Cyrl', 'Russian'],
    ['ukr_Cyrl', 'Ukrainian'], ['pol_Latn', 'Polish'], ['tur_Latn', 'Turkish'], ['arb_Arab', 'Arabic'],
    ['heb_Hebr', 'Hebrew'], ['hin_Deva', 'Hindi'], ['ben_Beng', 'Bengali'], ['jpn_Jpan', 'Japanese'],
    ['kor_Hang', 'Korean'], ['zho_Hans', 'Chinese (Simplified)'], ['zho_Hant', 'Chinese (Traditional)'],
    ['vie_Latn', 'Vietnamese'], ['tha_Thai', 'Thai'], ['ind_Latn', 'Indonesian'], ['swh_Latn', 'Swahili'],
    ['ell_Grek', 'Greek'],
];

/** Live app state (tests read it). */
export const lab = {
    model: null,        // bro.lm NllbModel
    running: false,
    handle: null,       // the running translate's handle
    result: '',         // last finished translation
    runs: 0,            // settled runs (done, error or cancelled)
    error: '',
    ui: null,
};

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('src-lang', 'tgt-lang', 'btn-swap', 'beams', 'btn-translate', 'btn-cancel',
                   'run-meta', 'input', 'output', 'src-name', 'tgt-name');

    for (const sel of [el.srcLang, el.tgtLang]) {
        for (const [code, name] of LANGS) sel.appendChild(h('option', { value: code }, name + '  (' + code + ')'));
        sel.addEventListener('change', names);
    }
    el.srcLang.value = 'eng_Latn';
    el.tgtLang.value = 'fra_Latn';

    const row = modelRow('#model-bar', {
        fields: [{ id: 'model-dir', label: 'model', what: 'NLLB-200 (distilled 600M)', candidates: NLLB }],
        onLoad: ([dir]) => load(dir),
        onMissing: (m) => { lab.error = m; status.error(m); },
    });

    function names() {
        const nm = (code) => (LANGS.find((l) => l[0] === code) || [code, code])[1];
        el.srcName.textContent = nm(el.srcLang.value);
        el.tgtName.textContent = nm(el.tgtLang.value);
    }

    function refresh() {
        el.btnTranslate.disabled = !lab.model || lab.running;
        el.btnCancel.disabled = !lab.running;
    }

    function setOutput(text, cls) {
        el.output.textContent = text;
        el.output.className = 'k-box' + (cls ? ' ' + cls : '');
    }

    function load(dir) {
        lab.model = null; lab.error = '';
        row.busy(true); row.meta('');
        refresh();
        status.busy('loading NLLB-200… (≈2.4 GB, the first load is slow)');
        let abs = dir;
        try { abs = require('fs').realpathSync(dir); } catch (e) { /* keep as typed */ }
        const fail = (e) => { lab.error = 'load failed: ' + (e && e.message || e); row.busy(false); status.error(lab.error); };
        try {
            bro.lm.loadNllb(abs, {
                onReady: (m) => {
                    lab.model = m;
                    row.busy(false);
                    row.meta(m.languageCount + ' languages · ' + m.encoderLayers + '+' + m.decoderLayers + ' layers');
                    if (m.device) badge.set(m.device);
                    status.ok('model ready · ' + m.languageCount + ' languages');
                    refresh();
                },
                onError: fail,
            });
        } catch (e) { fail(e); }
    }

    function settle(msg, kind) {
        lab.running = false;
        lab.handle = null;
        lab.runs++;
        refresh();
        status.set(msg, kind);
    }

    function translate() {
        if (!lab.model || lab.running) return;
        const text = el.input.value.trim();
        if (!text) { status.error('type something to translate'); return; }
        const src = el.srcLang.value, tgt = el.tgtLang.value, beams = parseInt(el.beams.value, 10) || 5;
        lab.running = true;
        lab.error = '';
        refresh();
        setOutput('translating…', 'partial');
        status.busy('translating ' + src + ' → ' + tgt + ' …');
        const t0 = Date.now();
        try {
            lab.handle = lab.model.translate(text, src, tgt, {
                numBeams: beams,
                onDone: (out) => {
                    if (!lab.running) return;          // cancelled
                    lab.result = out;
                    setOutput(out);
                    const s = (Date.now() - t0) / 1000;
                    el.runMeta.textContent = beams + ' beams · ' + s.toFixed(1) + ' s';
                    settle('done (' + s.toFixed(1) + ' s)', 'ok');
                },
                onError: (e) => {
                    if (!lab.running) return;
                    lab.error = 'translate error: ' + e;
                    setOutput('');
                    settle(lab.error, 'err');
                },
            });
        } catch (e) { lab.error = 'translate error: ' + (e.message || e); settle(lab.error, 'err'); }
    }

    function cancel() {
        if (!lab.running) return;
        if (lab.handle && lab.handle.cancel) lab.handle.cancel();
        setOutput(lab.result || 'The translation appears here.', lab.result ? '' : 'empty');
        settle('cancelled', 'warn');
    }

    // Swap the pair and carry the translation back into the source (a quick round trip).
    function swap() {
        const s = el.srcLang.value;
        el.srcLang.value = el.tgtLang.value;
        el.tgtLang.value = s;
        if (lab.result && !el.output.classList.contains('empty')) el.input.value = lab.result;
        names();
    }

    el.btnTranslate.onclick = translate;
    el.btnCancel.onclick = cancel;
    el.btnSwap.onclick = swap;
    el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); translate(); } });

    lab.ui = { status, row, badge, translate, cancel, swap };
    names();
    refresh();
    row.autoLoad();
}
