// NLLB-200 Lab — a worked consumer of bro.lm.loadNllb.
//
// Type text, pick a source and target language, and translate: the model is
// brolm's NLLB-200 encoder-decoder (M2M-100 arch) behind bro.lm — one
// Translator that maps between any pair of the 200+ FLORES-200 languages. The
// translation runs async (bro.lm's NllbModel.translate with onDone) so a
// multi-second beam search never freezes the page; Cancel drops a pending run.
//
// Language codes are FLORES-200 ("eng_Latn", "fra_Latn", "zho_Hans", ...). The
// dropdowns offer a curated common set; the model itself knows 200+
// (model.languageCount), and model.hasLanguage(code) checks any code.

import { installSystemMenu } from "/lib/system-menu.js";

const fs = require('fs');
const $ = (s) => document.querySelector(s);

const WROOT = (typeof process !== 'undefined' && process.env && process.env.BRO_WEIGHTS) || 'D:/projects';
const MODEL_CANDIDATES = [
    '../../../brolm/weights/nllb-200-distilled-600M',
    WROOT + '/brolm/weights/nllb-200-distilled-600M',
];

// A curated slice of FLORES-200 (code → display name). The model supports many
// more; these cover the common demo set.
const LANGS = [
    ['eng_Latn', 'English'],
    ['fra_Latn', 'French'],
    ['spa_Latn', 'Spanish'],
    ['deu_Latn', 'German'],
    ['ita_Latn', 'Italian'],
    ['por_Latn', 'Portuguese'],
    ['nld_Latn', 'Dutch'],
    ['rus_Cyrl', 'Russian'],
    ['ukr_Cyrl', 'Ukrainian'],
    ['pol_Latn', 'Polish'],
    ['tur_Latn', 'Turkish'],
    ['arb_Arab', 'Arabic'],
    ['heb_Hebr', 'Hebrew'],
    ['hin_Deva', 'Hindi'],
    ['ben_Beng', 'Bengali'],
    ['jpn_Jpan', 'Japanese'],
    ['kor_Hang', 'Korean'],
    ['zho_Hans', 'Chinese (Simplified)'],
    ['zho_Hant', 'Chinese (Traditional)'],
    ['vie_Latn', 'Vietnamese'],
    ['tha_Thai', 'Thai'],
    ['ind_Latn', 'Indonesian'],
    ['swh_Latn', 'Swahili'],
    ['ell_Latn', 'Greek'],
];

let model = null;            // bro.lm NllbModel handle
let translating = false;
let runHandle = null;

function setBadge(text, isErr) {
    $('#status').textContent = text;
    $('#status').className = isErr ? 'err' : '';
}

function fillLangSelects() {
    for (const sel of [$('#src-lang'), $('#tgt-lang')]) {
        sel.innerHTML = '';
        for (const [code, name] of LANGS) {
            const o = document.createElement('option');
            o.value = code;
            o.textContent = name + '  (' + code + ')';
            sel.appendChild(o);
        }
    }
    $('#src-lang').value = 'eng_Latn';
    $('#tgt-lang').value = 'fra_Latn';
}

// ── translate ────────────────────────────────────────────────────────────────

function runTranslate() {
    if (!model || translating) return;
    const text = $('#input').value.trim();
    if (!text) { setBadge('type something to translate', true); return; }
    const src = $('#src-lang').value, tgt = $('#tgt-lang').value;

    translating = true;
    $('#output').textContent = '';
    $('#output').className = 'partial';
    $('#btn-translate').disabled = true;
    $('#btn-cancel').disabled = false;
    setBadge('translating ' + src + ' → ' + tgt + ' …');

    const t0 = Date.now();
    runHandle = model.translate(text, src, tgt, {
        numBeams: parseInt($('#beams').value, 10) || 5,
        onDone: (out) => {
            translating = false;
            runHandle = null;
            $('#output').textContent = out;
            $('#output').className = '';
            $('#btn-translate').disabled = false;
            $('#btn-cancel').disabled = true;
            setBadge('done (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
        },
        onError: (e) => {
            translating = false;
            runHandle = null;
            $('#btn-translate').disabled = false;
            $('#btn-cancel').disabled = true;
            setBadge('translate error: ' + e, true);
        },
    });
}

function cancelTranslate() {
    if (runHandle) { runHandle.cancel(); }
    translating = false;
    runHandle = null;
    $('#btn-translate').disabled = false;
    $('#btn-cancel').disabled = true;
    setBadge('cancelled');
}

function swapLangs() {
    const s = $('#src-lang').value;
    $('#src-lang').value = $('#tgt-lang').value;
    $('#tgt-lang').value = s;
    // Carry the previous output back into the input for a quick round-trip.
    const out = $('#output').textContent.trim();
    if (out) $('#input').value = out;
}

// ── model load ─────────────────────────────────────────────────────────────

function loadModel(dir) {
    if (!fs.existsSync(dir + '/config.json')) {
        setBadge('no config.json in ' + dir, true);
        return;
    }
    const abs = fs.realpathSync(dir);
    setBadge('loading NLLB-200… (≈2.4 GB, first load is slow)');
    $('#btn-load').disabled = true;
    bro.lm.loadNllb(abs, {
        onReady: (m) => {
            model = m;
            $('#btn-load').disabled = false;
            $('#btn-translate').disabled = false;
            setBadge('model ready — ' + m.languageCount + ' languages, ' +
                     m.encoderLayers + '+' + m.decoderLayers + ' layers');
        },
        onError: (e) => {
            $('#btn-load').disabled = false;
            setBadge('load failed: ' + e, true);
        },
    });
}

// ── wire up ──────────────────────────────────────────────────────────────────

installSystemMenu();
fillLangSelects();
$('#btn-load').addEventListener('click', () => loadModel($('#model-dir').value.trim()));
$('#btn-translate').addEventListener('click', runTranslate);
$('#btn-cancel').addEventListener('click', cancelTranslate);
$('#btn-swap').addEventListener('click', swapLangs);

(function boot() {
    let dir = MODEL_CANDIDATES[0];
    for (const p of MODEL_CANDIDATES) {
        try { if (fs.existsSync(p + '/config.json')) { dir = p; break; } } catch (e) {}
    }
    $('#model-dir').value = dir;
    if (fs.existsSync(dir + '/config.json')) loadModel(dir);
    else setBadge('pick an NLLB-200 checkpoint directory, then Load');
})();
