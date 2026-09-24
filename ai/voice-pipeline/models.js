// Model acquisition for the voice pipeline: which files each model needs,
// where they are, and an on-demand download for the ones that are missing.
//
// Every file resolves: the download cache (<modelCacheDir>/<hf repo>/<file>)
// first, then the source checkout's sibling repos (lib/kit/weights.js
// weightPath, BRO_WEIGHTS aware). A source checkout loads from the siblings
// and never downloads; a packaged build streams missing files into the shared
// per-user cache when the user asks (the setup screen's Start button).
//
// Groups (what the setup screen gates as a unit):
//   wake       wake-word weights ("computer")       wlejon/brosoundml-data
//   llm        Qwen3-8B GGUF                        Qwen/Qwen3-8B-GGUF      ~8.7 GB
//   stt        Whisper tiny + tokenizer             openai/whisper-tiny     ~150 MB
//   tts        Kokoro + voice + g2p (optional)      wlejon/brosoundml-data (kokoro/ is published
//              from brosoundml's converted weights by scripts/publish-kokoro-data.sh; until
//              then those files 404 and a packaged build stays text-only)
//   ttsq       Qwen3-TTS CustomVoice 0.6B           not auto-downloaded (~2.5 GB)
//   ttsvd      Qwen3-TTS VoiceDesign 1.7B           not auto-downloaded (~4.5 GB); fetch
//              either with brosoundml's scripts/download-qwen-tts.sh
//   omnivoice  OmniVoice (demos/omnivoice-lab reads omniDir / omniReady / whisperDir)
//
// Exports: resolved(), status(), groupStatus(key), downloadKeys(keys, onProgress),
// missingDownloadable(), download(groups, onProgress), cacheDir().

import { weightPath, modelCacheDir } from "/lib/kit/weights.js";

const fs = require('fs');

function env(k) {
    try { const p = globalThis.process; return (p && p.env && p.env[k]) || ''; }
    catch (_) { return ''; }
}
function exists(p) { try { return !!p && fs.existsSync(p); } catch (_) { return false; } }
const dirOf = (p) => p.replace(/[\/\\][^\/\\]*$/, '');

export function cacheDir() { return modelCacheDir(); }

// A file: { repo, kind ('model' | 'dataset'), file, dev, bytes, optional }.
// `dev` is the sibling checkout's copy: devDir + the repo path minus `strip`
// (the dataset's kokoro/ tree mirrors brosoundml/weights/kokoro/). `bytes` is
// the upstream size, for the download estimate.
function files(repo, kind, devDir, list, strip) {
    return list.map(([file, bytes, optional]) => ({
        repo, kind, file, bytes, optional: !!optional,
        dev: weightPath(devDir + '/' + (strip && file.startsWith(strip) ? file.slice(strip.length) : file)),
    }));
}

const WHISPER = 'brosoundml/weights/whisper';
const KOKORO = 'brosoundml/weights/kokoro';
const DATA = 'brosoundml-data';
const QWEN_TTS = ['Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice', 'brosoundml/weights/qwen-tts/0.6B-customvoice'];
const QWEN_VD = ['Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'brosoundml/weights/qwen-tts/1.7B-voicedesign'];
const qwenTtsFiles = (repo, dev, weights) => files(repo, 'model', dev, [
    ['config.json', 4908], ['model.safetensors', weights], ['vocab.json', 2776833], ['merges.txt', 1671839],
    ['speech_tokenizer/config.json', 2336], ['speech_tokenizer/model.safetensors', 682293092],
]);

const GROUPS = [
    { key: 'wake', label: 'Wake word ("computer")', downloadable: true,
      files: files('wlejon/brosoundml-data', 'dataset', DATA, [['wake/computer.bw', 65713]]) },
    { key: 'llm', label: 'Language model (Qwen3-8B)', downloadable: true,
      files: files('Qwen/Qwen3-8B-GGUF', 'model', 'brolm/weights/Qwen3-8B-GGUF', [['Qwen3-8B-Q8_0.gguf', 8709518112]]) },
    { key: 'stt', label: 'Speech recognition (Whisper)', downloadable: true,
      files: files('openai/whisper-tiny', 'model', WHISPER, [
          ['config.json', 1983], ['model.safetensors', 151061672], ['vocab.json', 967452], ['merges.txt', 493869],
          // Upstream keeps the "<|...|>" specials here; the converted layout may omit it.
          ['added_tokens.json', 34604, true],
      ]) },
    // Order matters: resolved() reads config, model, voice, lexicon, POS tagger by index.
    { key: 'tts', label: 'Speech synthesis (Kokoro)', downloadable: true, optional: true,
      files: files('wlejon/brosoundml-data', 'dataset', KOKORO, [
          ['kokoro/config.json', 2351], ['kokoro/model.safetensors', 326979520], ['kokoro/voices/af_heart.bin', 522240],
      ], 'kokoro/').concat(files('wlejon/brosoundml-data', 'dataset', DATA, [
          ['g2p/lexicon_en_us.bin', 7175830], ['pos_tagger/model.bin', 7653373],
      ])) },
    { key: 'ttsq', label: 'Qwen3-TTS · CustomVoice (0.6B)', downloadable: false, optional: true,
      files: qwenTtsFiles(QWEN_TTS[0], QWEN_TTS[1], 1811626576) },
    { key: 'ttsvd', label: 'Qwen3-TTS · VoiceDesign (1.7B)', downloadable: false, optional: true,
      files: qwenTtsFiles(QWEN_VD[0], QWEN_VD[1], 3833402552) },
    // OmniVoice (k2-fsa, Apache-2.0): ~3.5 GB of F32 weights, downloadable on request.
    { key: 'omnivoice', label: 'OmniVoice (600-language TTS)', downloadable: true, optional: true,
      files: files('k2-fsa/OmniVoice', 'model', 'brosoundml/weights/omnivoice', [
          ['config.json', 2339], ['tokenizer.json', 11423986], ['tokenizer_config.json', 556],
          ['model.safetensors', 2450344112], ['audio_tokenizer/config.json', 2660],
          ['audio_tokenizer/model.safetensors', 805665628],
      ]) },
];

const urlFor = (f) => 'https://huggingface.co/' + (f.kind === 'dataset' ? 'datasets/' : '') + f.repo + '/resolve/main/' + f.file;
const cachePathFor = (f) => cacheDir() + '/' + (f.kind === 'dataset' ? 'datasets/' : '') + f.repo + '/' + f.file;

/** Where the file is: the cache copy, else the sibling checkout, else where a download would put it. */
function resolveFile(f) {
    const cp = cachePathFor(f);
    if (exists(cp)) return cp;
    if (exists(f.dev)) return f.dev;
    return cp;
}
const filePresent = (f) => exists(resolveFile(f));
const groupBy = (key) => GROUPS.find((g) => g.key === key);
const required = (g) => g.files.filter((f) => !f.optional);
const groupPresent = (g) => required(g).every(filePresent);
const groupBytes = (g) => required(g).reduce((n, f) => n + (filePresent(f) ? 0 : f.bytes || 0), 0);
const describe = (g) => ({ key: g.key, label: g.label, downloadable: g.downloadable, optional: !!g.optional,
                           present: groupPresent(g), bytes: groupBytes(g) });
const fileOf = (key, name) => groupBy(key).files.find((f) => f.file === name);

/** Resolved paths every loader consumes (and readiness flags). */
export function resolved() {
    const tts = groupBy('tts').files;
    const added = resolveFile(fileOf('stt', 'added_tokens.json'));
    return {
        qwen:          resolveFile(groupBy('llm').files[0]),
        wake:          resolveFile(groupBy('wake').files[0]),
        whisperDir:    dirOf(resolveFile(fileOf('stt', 'model.safetensors'))),
        whisperVocab:  resolveFile(fileOf('stt', 'vocab.json')),
        whisperMerges: resolveFile(fileOf('stt', 'merges.txt')),
        whisperAdded:  exists(added) ? added : null,
        kokoroDir:     dirOf(resolveFile(tts[1])),
        kokoroVoice:   resolveFile(tts[2]),
        kokoroConfig:  resolveFile(tts[0]),        // phonemizer assets for bro.tts.setAssets
        lexicon:       resolveFile(tts[3]),
        posTagger:     resolveFile(tts[4]),
        speechReady:   groupPresent(groupBy('tts')),
        qwenTtsDir:    dirOf(resolveFile(fileOf('ttsq', 'model.safetensors'))),
        qwenTtsReady:  groupPresent(groupBy('ttsq')),
        qwenVdDir:     dirOf(resolveFile(fileOf('ttsvd', 'model.safetensors'))),
        qwenVdReady:   groupPresent(groupBy('ttsvd')),
        omniDir:       dirOf(resolveFile(fileOf('omnivoice', 'model.safetensors'))),
        omniReady:     groupPresent(groupBy('omnivoice')),
    };
}

/** Every group: { key, label, downloadable, optional, present, bytes (still to download) }. */
export function status() { return GROUPS.map(describe); }

/** One group's status by key, or null. */
export function groupStatus(key) { const g = groupBy(key); return g ? describe(g) : null; }

/** Downloadable groups still missing a required file, each with .bytes. */
export function missingDownloadable() {
    return GROUPS.filter((g) => g.downloadable && !groupPresent(g))
                 .map((g) => Object.assign({}, g, { bytes: groupBytes(g) }));
}

// Stream one file to <cache>/<repo>/<file> (via a .part file: the GGUF is
// multi-GB and must never sit in memory). A missing optional file resolves null.
async function downloadFile(f, onProgress) {
    const dest = cachePathFor(f), part = dest + '.part';
    fs.mkdirSync(dirOf(dest), { recursive: true });
    try { fs.unlinkSync(part); } catch (_) {}
    const headers = {};
    if (env('HF_TOKEN')) headers['Authorization'] = 'Bearer ' + env('HF_TOKEN');
    const res = await fetch(urlFor(f), { headers });
    if (!res.ok) {
        if (f.optional && res.status === 404) return null;
        throw new Error('HTTP ' + res.status + ' for ' + urlFor(f));
    }
    let total = f.bytes || 0;
    try { total = parseInt(res.headers.get('content-length') || '0', 10) || total; } catch (_) {}
    let received = 0;
    if (res.body && typeof res.body.getReader === 'function') {
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
        throw new Error(f.file + ': incomplete (' + received + '/' + total + ' bytes)');
    }
    fs.renameSync(part, dest);
    return dest;
}

/**
 * Download every missing file of `groups`, one at a time (one HF connection
 * already saturates most links). Optional files that fail are skipped.
 * onProgress({ groupKey, label, file, received, total }).
 */
export async function download(groups, onProgress) {
    for (const g of groups) {
        for (const f of g.files) {
            if (filePresent(f)) continue;
            const report = (received, total) => onProgress && onProgress({ groupKey: g.key, label: g.label, file: f.file, received, total });
            try { await downloadFile(f, report); }
            catch (e) {
                if (f.optional) continue;
                throw new Error(g.label + ': ' + ((e && e.message) || e));
            }
        }
    }
}

/** Download the groups named in `keys` that are downloadable and incomplete. */
export function downloadKeys(keys, onProgress) {
    const want = new Set(keys);
    return download(missingDownloadable().filter((g) => want.has(g.key)), onProgress);
}
