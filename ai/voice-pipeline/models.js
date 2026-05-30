// Model acquisition for the voice pipeline — app-owned, not an engine API.
//
// This app needs a specific, known set of model files. We know exactly where
// each one lives upstream (Hugging Face) and where a source checkout already
// has it (the sibling repos). This module resolves each file to a usable path
// and, when one is missing, downloads it on demand — but only when the user
// asks (main.js gates behind a button), never automatically.
//
// resolve order for every file:  cache hit  ->  dev sibling  ->  (cache path,
// not yet present). So a source checkout loads from the siblings and never
// downloads; a packaged build streams the missing files into a shared per-user
// cache and loads from there.
//
// Groups (a "model" the UI gates as a unit):
//   wake  — wake-word weights        (our wlejon/brosoundml-data dataset)
//   llm   — Qwen3-8B GGUF            (Qwen/Qwen3-8B-GGUF)            ~8.7 GB
//   stt   — Whisper tiny + tokenizer (openai/whisper-tiny)          ~150 MB
//   tts   — Kokoro + voice + g2p     (local/dev only for now; see note)
//
// The tts group is resolve-only here: Kokoro's voice packs are a raw-f32 format
// the upstream .safetensors isn't, and the phonemizer resolves its g2p data and
// vocab from the brosoundml sibling root — so download-and-run for speech needs
// a brosoundml-side change. Until then speech loads from the dev siblings when
// present, and the pipeline runs text-only when it isn't.
(function () {
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

function env(k) {
    try { const p = globalThis.process; return (p && p.env && p.env[k]) || ''; }
    catch (_) { return ''; }
}
function exists(p) { try { return !!p && fs.existsSync(p); } catch (_) { return false; } }
function sizeOf(p) { try { return fs.statSync(p).size; } catch (_) { return -1; } }

// Per-OS app-data root (mirrors system/projects/app.js userDataDir()).
function userDataDir() {
    const home = os.homedir(), plat = os.platform();
    if (plat === 'win32')
        return path.join(env('APPDATA') || path.join(home, 'AppData', 'Roaming'), 'bro');
    if (plat === 'darwin')
        return path.join(home, 'Library', 'Application Support', 'bro');
    return path.join(env('XDG_DATA_HOME') || path.join(home, '.local', 'share'), 'bro');
}
function cacheDir() {
    return env('BRO_MODELS_DIR') || path.join(userDataDir(), 'models');
}

// A file: { repo, kind, file, local?, dev, bytes?, optional? }.
//   repo/kind/file — Hugging Face source (kind 'dataset' uses the datasets/ URL)
//   local          — cache subpath if it differs from <repo>/<file> (e.g. a
//                    rename so a loader that hardcodes a name finds the file)
//   dev            — sibling-repo path a source checkout already has
//   bytes          — upstream size, for pre-download size display (not verified;
//                    download integrity uses the server's content-length)
//   optional       — absence doesn't make the group incomplete
function urlFor(f) {
    let base = 'https://huggingface.co/';
    if (f.kind === 'dataset') base += 'datasets/';
    return base + f.repo + '/resolve/main/' + f.file;
}
function cachePathFor(f) {
    if (!f.local && !f.repo) return null;   // dev-only file (no upstream source)
    const sub = f.local || ((f.kind === 'dataset' ? 'datasets/' : '') + f.repo + '/' + f.file);
    return path.join(cacheDir(), sub);
}
// Where the file is / would be, no download. A dev-only file with no cache
// location resolves to its dev path even when absent (so dir/voice paths stay
// sensible rather than "undefined").
function resolveFile(f) {
    const cp = cachePathFor(f);
    if (cp && exists(cp)) return cp;
    if (exists(f.dev)) return f.dev;
    return cp || f.dev || '';
}
function filePresent(f) { return exists(resolveFile(f)); }

// ─── the catalog ──────────────────────────────────────────────────────────
const WHISPER_DEV = '../brosoundml/weights/whisper';
const KOKORO_DEV  = '../brosoundml/weights/kokoro';

const GROUPS = [
    {
        key: 'wake', label: 'Wake word ("computer")', downloadable: true,
        files: [
            { repo: 'wlejon/brosoundml-data', kind: 'dataset', file: 'wake/computer.bw',
              dev: '../brosoundml-data/wake/computer.bw', bytes: 65713 },
        ],
    },
    {
        key: 'llm', label: 'Language model (Qwen3-8B)', downloadable: true,
        files: [
            { repo: 'Qwen/Qwen3-8B-GGUF', kind: 'model', file: 'Qwen3-8B-Q8_0.gguf',
              dev: '../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf', bytes: 8709518112 },
        ],
    },
    {
        key: 'stt', label: 'Speech recognition (Whisper)', downloadable: true,
        files: [
            { repo: 'openai/whisper-tiny', kind: 'model', file: 'config.json',
              dev: WHISPER_DEV + '/config.json', bytes: 1983 },
            { repo: 'openai/whisper-tiny', kind: 'model', file: 'model.safetensors',
              dev: WHISPER_DEV + '/model.safetensors', bytes: 151061672 },
            { repo: 'openai/whisper-tiny', kind: 'model', file: 'vocab.json',
              dev: WHISPER_DEV + '/vocab.json', bytes: 967452 },
            { repo: 'openai/whisper-tiny', kind: 'model', file: 'merges.txt',
              dev: WHISPER_DEV + '/merges.txt', bytes: 493869 },
            // Upstream keeps the "<|...|>" specials here; merged in by the
            // tokenizer when present (the dev/converted layout may omit it).
            { repo: 'openai/whisper-tiny', kind: 'model', file: 'added_tokens.json',
              dev: WHISPER_DEV + '/added_tokens.json', bytes: 34604, optional: true },
        ],
    },
    // Speech: resolve-only for now (see file header). Dev paths let a source
    // checkout load + speak; a build without them runs text-only.
    {
        key: 'tts', label: 'Speech synthesis (Kokoro)', downloadable: false,
        files: [
            { dev: KOKORO_DEV + '/config.json' },
            { dev: KOKORO_DEV + '/model.safetensors' },
            { dev: KOKORO_DEV + '/voices/af_heart.bin' },
            { dev: '../brosoundml-data/g2p/lexicon_en_us.bin' },
            { dev: '../brosoundml-data/pos_tagger/model.bin' },
        ],
    },
];

function groupBy(key) { return GROUPS.find(g => g.key === key); }
function required(g) { return g.files.filter(f => !f.optional); }
function groupPresent(g) { return required(g).every(filePresent); }
function groupBytes(g) {
    let n = 0;
    for (const f of required(g)) if (!filePresent(f)) n += (f.bytes || 0);
    return n;
}

// Public, resolved paths the loaders consume. dirOf() backs out a model dir
// from one of its files so dev and cache layouts both work.
function dirOf(p) { return p.replace(/[\/\\][^\/\\]*$/, ''); }
function resolved() {
    const stt = groupBy('stt').files;
    const model   = stt.find(f => f.file === 'model.safetensors');
    const vocab   = stt.find(f => f.file === 'vocab.json');
    const merges  = stt.find(f => f.file === 'merges.txt');
    const added   = stt.find(f => f.file === 'added_tokens.json');
    const tts = groupBy('tts').files;
    const kmodel = tts[1], kvoice = tts[2];

    const speechReady = groupPresent(groupBy('tts'));
    const addedPath = resolveFile(added);
    return {
        qwen:         resolveFile(groupBy('llm').files[0]),
        wake:         resolveFile(groupBy('wake').files[0]),
        whisperDir:   dirOf(resolveFile(model)),
        whisperVocab: resolveFile(vocab),
        whisperMerges: resolveFile(merges),
        whisperAdded: exists(addedPath) ? addedPath : null,
        kokoroDir:    dirOf(resolveFile(kmodel)),
        kokoroVoice:  resolveFile(kvoice),
        speechReady,
    };
}

// Downloadable groups still missing one or more required files.
function missingDownloadable() {
    return GROUPS.filter(g => g.downloadable && !groupPresent(g));
}

// Status for the gate UI.
function status() {
    return GROUPS.map(g => ({
        key: g.key, label: g.label, downloadable: g.downloadable,
        present: groupPresent(g), bytes: groupBytes(g),
    }));
}

// ─── download ───────────────────────────────────────────────────────────────
async function downloadFile(f, onProgress) {
    const dest = cachePathFor(f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = dest + '.part';
    try { fs.unlinkSync(part); } catch (_) {}

    const headers = {};
    const tok = env('HF_TOKEN');
    if (tok) headers['Authorization'] = 'Bearer ' + tok;

    const res = await fetch(urlFor(f), { headers });
    if (!res.ok) {
        if (f.optional && res.status === 404) return null;  // tolerate a missing optional
        throw new Error('HTTP ' + res.status + ' for ' + urlFor(f));
    }

    let total = f.bytes || 0;
    try { total = parseInt(res.headers.get('content-length') || '0', 10) || total; } catch (_) {}

    let received = 0;
    if (res.body && typeof res.body.getReader === 'function') {
        // Stream straight to disk — the GGUF is multi-GB and must never sit in
        // memory.
        const reader = res.body.getReader();
        for (;;) {
            const r = await reader.read();
            if (r.done) break;
            const chunk = r.value instanceof Uint8Array ? r.value : new Uint8Array(r.value);
            fs.appendFileSync(part, chunk);
            received += chunk.byteLength;
            if (onProgress) onProgress(received, total);
        }
    } else {
        const all = new Uint8Array(await res.arrayBuffer());
        fs.writeFileSync(part, all);
        received = all.byteLength;
        if (onProgress) onProgress(received, total || received);
    }

    if (total > 0 && received < total) {
        try { fs.unlinkSync(part); } catch (_) {}
        throw new Error(path.basename(dest) + ': incomplete (' + received + '/' + total + ' bytes)');
    }
    fs.renameSync(part, dest);
    return dest;
}

// Download every missing required (and best-effort optional) file of the given
// groups, sequentially. onProgress({ groupKey, label, file, received, total })
// fires throughout; a single HF connection already saturates most links and
// serial keeps memory + rate-limit pressure low.
async function download(groups, onProgress) {
    for (const g of groups) {
        for (const f of g.files) {
            if (filePresent(f)) continue;
            const report = (received, total) => {
                if (onProgress) onProgress({ groupKey: g.key, label: g.label,
                                             file: f.file, received, total });
            };
            try {
                await downloadFile(f, report);
            } catch (e) {
                if (f.optional) continue;   // optional file failed — skip it
                throw new Error(g.label + ': ' + ((e && e.message) || e));
            }
        }
    }
}

window.VoiceModels = {
    cacheDir, status, resolved, missingDownloadable, download,
};

})();
