// LM Playground — one streaming chat box over every bro.lm model family.
//
// The point of the app: bro.lm.generate(model, prompt, opts) is the same
// async, token-streaming, cancellable call for all three families — what
// differs is loading and prompt construction, captured per-family here:
//
//   qwen3     loadQwen(gguf)                → { model, tokenizer }, ChatML via
//             tokenizer.applyChatTemplate, prompt as ids, eos = imEndId.
//   mistral3  loadMistral(gguf, {tekken})   → { model, tokenizer }, [INST] via
//             tokenizer.applyChatTemplate (template emits its own <s>, so
//             encode with addSpecial=false), prompt as ids, eos = eosId.
//   qwen35    loadQwen35(dir)               → one handle; the driver owns the
//             tokenizer, prompt is a ChatML STRING, stops on <|im_end|>.
//
// Headless note: test.js drives the same UI with the small Qwen3.5 checkpoint.

import { installSystemMenu } from "/lib/system-menu.js";

const fs = require('fs');
const $ = (s) => document.querySelector(s);

// Default checkpoint per family — first existing candidate wins.
const FAMILIES = {
    qwen35: {
        candidates: ['D:/projects/brolm/weights/Qwen3.5-0.8B'],
        probe: (p) => fs.existsSync(p + '/config.json'),
    },
    qwen3: {
        candidates: ['D:/projects/brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf',
                     'D:/projects/brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-BF16.gguf'],
        probe: (p) => fs.existsSync(p),
    },
    mistral3: {
        candidates: ['D:/projects/brolm/weights/Mistral-Small-3.1-24B-Instruct-2503-GGUF/' +
                     'mistralai_Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf'],
        probe: (p) => fs.existsSync(p),
        tekken: 'D:/projects/brolm/weights/Mistral-Small-3.1-24B-Instruct-2503/tekken.json',
    },
};

// htmlayout's <select> does not reliably round-trip .value, so the chosen
// family lives here and the change handler keeps it in sync.
let currentFamily = 'qwen35';

let loaded = null;     // { family, model, tokenizer? }
let runHandle = null;
let generating = false;

function setStatus(text, isErr) {
    $('#status').textContent = text;
    $('#status').className = isErr ? 'err' : '';
}

function defaultPath(family) {
    const f = FAMILIES[family];
    for (const c of f.candidates) { try { if (f.probe(c)) return c; } catch (e) {} }
    return f.candidates[0];
}

function loadModel() {
    const family = currentFamily;
    const path = $('#model-path').value.trim();
    $('#btn-load').disabled = true;
    $('#btn-generate').disabled = true;
    setStatus('loading ' + family + '…');
    const onError = (e) => {
        $('#btn-load').disabled = false;
        setStatus('load failed: ' + e, true);
    };
    const onReadyPair = (r) => {
        loaded = { family, model: r.model, tokenizer: r.tokenizer };
        $('#btn-load').disabled = false;
        $('#btn-generate').disabled = false;
        setStatus(family + ' ready (' + r.model.numLayers + ' layers)');
    };
    try {
        if (family === 'qwen35') {
            bro.lm.loadQwen35(path, {
                onReady: (m) => {
                    loaded = { family, model: m };
                    $('#btn-load').disabled = false;
                    $('#btn-generate').disabled = false;
                    setStatus('qwen35 ready (' + m.numLayers + ' layers)');
                },
                onError,
            });
        } else if (family === 'qwen3') {
            bro.lm.loadQwen(path, { onReady: onReadyPair, onError });
        } else {
            bro.lm.loadMistral(path, {
                tokenizerPath: FAMILIES.mistral3.tekken,
                onReady: onReadyPair, onError,
            });
        }
    } catch (e) { onError(e.message || String(e)); }
}

// Per-family prompt construction + decode for the shared generate call.
function buildRun(userText) {
    const L = loaded;
    if (L.family === 'qwen35') {
        return {
            prompt: '<|im_start|>user\n' + userText + '<|im_end|>\n<|im_start|>assistant\n',
            eosId: undefined,                       // the driver stops itself
            decode: (ids) => L.model.decode(Array.from(ids)),
        };
    }
    if (L.family === 'mistral3') {
        const text = L.tokenizer.applyChatTemplate([{ role: 'user', content: userText }], true);
        return {
            prompt: L.tokenizer.encode(text, /*addSpecial=*/false),
            eosId: L.tokenizer.eosId,
            decode: (ids) => L.tokenizer.decode(Array.from(ids)),
        };
    }
    const text = L.tokenizer.applyChatTemplate([{ role: 'user', content: userText }], true);
    return {
        prompt: L.tokenizer.encode(text),
        eosId: L.tokenizer.imEndId,
        decode: (ids) => L.tokenizer.decode(Array.from(ids)),
    };
}

function generate() {
    if (!loaded || generating) return;
    const userText = $('#prompt').value.trim();
    if (!userText) return;
    const run = buildRun(userText);

    generating = true;
    $('#btn-generate').disabled = true;
    $('#btn-stop').disabled = false;
    $('#reply').textContent = '';
    $('#reply').className = 'streaming';
    $('#rate').textContent = '';
    setStatus('generating…');
    const t0 = Date.now();
    const acc = [];

    const opts = {
        maxNewTokens: +$('#max-tokens').value || 256,
        sampling: { temperature: +$('#temperature').value },
        onToken: (id) => {
            acc.push(id);
            // Re-decode the whole accumulation — byte-level BPE pieces may be
            // partial UTF-8, so per-id decode would garble multibyte chars.
            $('#reply').textContent = run.decode(acc);
        },
        onDone: (ids, info) => {
            generating = false;
            runHandle = null;
            $('#btn-generate').disabled = false;
            $('#btn-stop').disabled = true;
            $('#reply').className = '';
            if (info.error) { setStatus('error: ' + info.error, true); return; }
            $('#reply').textContent = run.decode(ids);
            const secs = (Date.now() - t0) / 1000;
            $('#rate').textContent = (ids.length / Math.max(secs, 0.001)).toFixed(1) + ' tok/s';
            setStatus(info.cancelled ? 'stopped' : 'done (' + ids.length + ' tokens)');
        },
    };
    if (run.eosId !== undefined) opts.eosId = run.eosId;
    runHandle = bro.lm.generate(loaded.model, run.prompt, opts);
}

$('#family').addEventListener('change', (e) => {
    const v = (e.target && e.target.value) || $('#family').value;
    if (v && FAMILIES[v]) currentFamily = v;
    $('#model-path').value = defaultPath(currentFamily);
});
$('#btn-load').addEventListener('click', loadModel);
$('#btn-generate').addEventListener('click', generate);
$('#btn-stop').addEventListener('click', () => { if (runHandle) runHandle.cancel(); });

(function boot() {
    installSystemMenu();
    $('#model-path').value = defaultPath(currentFamily);
})();
