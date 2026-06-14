// Qwen3-ASR Lab — a worked consumer of bro.stt.loadQwenAsr.
//
// Speak into the mic (or open a clip) and run Qwen3-ASR over it: the model
// emits "language <Language><asr_text>transcript" as one autoregressive id
// stream, split here at model.asrTextId — the language-ID half feeds the
// badge, the transcript half streams into the page live as the decoder emits
// (async bro.stt.transcribe + onToken). The context field showcases Qwen3-ASR's
// context biasing: names / domain terms typed there are tokenized with the
// Qwen BPE tokenizer (bro.lm.loadTokenizer — vocab.json + merges.txt sit in
// the model dir) and placed in the chat template's system block.
//
// Headless note: with no audio device the live mic can't capture; test.js
// decodes a known clip off disk and drives the same transcribe path.

const fs = require('fs');
const $ = (s) => document.querySelector(s);

const TARGET_RATE = 16000;   // Qwen3-ASR's fixed input rate

const WROOT = (typeof process !== 'undefined' && process.env && process.env.BRO_WEIGHTS) || 'D:/projects';
const MODEL_CANDIDATES = [
    '../../../brosoundml/weights/qwen-asr/0.6B',
    WROOT + '/brosoundml/weights/qwen-asr/0.6B',
];

let model = null;            // bro.stt QwenAsr handle
let qtok = null;             // bro.lm Qwen BPE tokenizer (decode + context ids)
let audioCtx = null;

let srcSamples = null;       // Float32Array @ 16 kHz mono
let srcClipId = -1;
let recording = false;
let recChunks = [];
let transcribing = false;
let runHandle = null;
let streamIds = [];

function setBadge(text, isErr) {
    $('#status').textContent = text;
    $('#status').className = isErr ? 'err' : '';
}

// ── audio I/O (same clip-publish pattern as parakeet-lab) ────────────────────

function ensureCtx() { audioCtx = audioCtx || new AudioContext(); return audioCtx; }

function resample(samples, inRate, outRate) {
    if (!samples || Math.abs(inRate - outRate) < 1) return samples;
    const ratio = outRate / inRate, n = Math.floor(samples.length * ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / ratio, j = t | 0, f = t - j;
        const a = samples[j], b = (samples[j + 1] !== undefined) ? samples[j + 1] : a;
        out[i] = a * (1 - f) + b * f;
    }
    return out;
}

function setSource(samples, label) {
    srcSamples = samples;
    try {
        const ctx = ensureCtx();
        const buf = resample(samples, TARGET_RATE, ctx.sampleRate || 48000);
        if (srcClipId >= 0) { try { ctx.deleteClip(srcClipId); } catch (e) {} }
        srcClipId = ctx.createClip(buf, 1);
    } catch (e) { srcClipId = -1; }
    $('#btn-play').disabled = srcClipId < 0;
    $('#btn-transcribe').disabled = !(model && qtok) || transcribing;
    setBadge('source: ' + label + ' (' + (samples.length / TARGET_RATE).toFixed(1) + 's)');
    if (model && qtok && !transcribing) runTranscribe();   // auto-run on new audio
}

function decodeFileToSource(path) {
    const ctx = ensureCtx();
    const dec = ctx.decodeAudioFile(path);
    if (!dec || !dec.samples || !dec.numFrames) return null;
    const ch = dec.channels || 1, nf = dec.numFrames;
    let mono;
    if (ch === 1) {
        mono = dec.samples.length === nf ? dec.samples : dec.samples.subarray(0, nf);
    } else {
        mono = new Float32Array(nf);
        for (let i = 0; i < nf; i++) {
            let s = 0; for (let c = 0; c < ch; c++) s += dec.samples[i * ch + c];
            mono[i] = s / ch;
        }
    }
    return resample(mono, dec.sampleRate, TARGET_RATE);
}

// ── mic recording (bro.mic samples mode) ─────────────────────────────────────

function startRecording() {
    if (recording) return;
    recChunks = [];
    recording = true;
    bro.mic.start({
        chunkFrames: 160, targetRate: TARGET_RATE, agc: true, samples: true,
        onChunk: (c) => {
            if (!recording) return;
            recChunks.push(c.samples);
            $('#miclevel-fill').style.width = Math.min(100, c.peak * 130) + '%';
        },
    });
    $('#btn-record').textContent = '■ stop';
    $('#btn-record').classList.add('recording');
    setBadge('recording… speak, then stop');
}

function stopRecording() {
    if (!recording) return;
    recording = false;
    bro.mic.stop();
    $('#miclevel-fill').style.width = '0%';
    $('#btn-record').textContent = '● record';
    $('#btn-record').classList.remove('recording');
    let n = 0;
    for (const c of recChunks) n += c.length;
    if (!n) { setBadge('no audio captured', true); return; }
    const out = new Float32Array(n);
    let off = 0;
    for (const c of recChunks) { out.set(c, off); off += c.length; }
    recChunks = [];
    setSource(out, 'mic');
}

// ── transcribe ───────────────────────────────────────────────────────────────

// Split the generated stream at the <asr_text> marker ID — the marker
// detokenizes to an empty string, so a text-level split cannot work.
function renderStream(ids, final) {
    const cut = ids.indexOf(model.asrTextId);
    const langIds = cut >= 0 ? ids.slice(0, cut) : ids;
    const textIds = cut >= 0 ? ids.slice(cut + 1) : [];
    const lang = qtok.decode(langIds).replace(/^language\s*/i, '').trim();
    if (lang) $('#lang').textContent = lang;
    $('#transcript').textContent = qtok.decode(textIds).trim();
    $('#transcript').className = final ? '' : 'partial';
}

function runTranscribe() {
    if (!model || !qtok || !srcSamples || transcribing) return;
    transcribing = true;
    streamIds = [];
    $('#lang').textContent = '—';
    $('#transcript').textContent = '';
    $('#btn-transcribe').disabled = true;
    $('#btn-cancel').disabled = false;
    setBadge('transcribing…');

    const opts = {
        onToken: (id) => { streamIds.push(id); renderStream(streamIds, false); },
        onDone: (ids, info) => {
            transcribing = false;
            runHandle = null;
            $('#btn-transcribe').disabled = false;
            $('#btn-cancel').disabled = true;
            if (info.error) { setBadge('transcribe error: ' + info.error, true); return; }
            if (info.cancelled) { setBadge('cancelled'); return; }
            renderStream(Array.from(ids), true);
            setBadge('done (' + ids.length + ' tokens)');
        },
    };
    const ctxText = $('#context').value.trim();
    if (ctxText) opts.contextIds = qtok.encode(ctxText);
    runHandle = bro.stt.transcribe(model, srcSamples, opts);
}

// ── model load ───────────────────────────────────────────────────────────────

function loadModel(dir) {
    if (!fs.existsSync(dir + '/config.json')) {
        setBadge('no config.json in ' + dir, true);
        return;
    }
    const abs = fs.realpathSync(dir);
    setBadge('loading Qwen3-ASR…');
    $('#btn-load').disabled = true;
    try {
        qtok = bro.lm.loadTokenizer({
            vocabPath:  abs + '/vocab.json',
            mergesPath: abs + '/merges.txt',
        });
    } catch (e) { setBadge('tokenizer: ' + e.message, true); $('#btn-load').disabled = false; return; }
    bro.stt.loadQwenAsr(abs, {
        onReady: (m) => {
            model = m;
            $('#btn-load').disabled = false;
            $('#btn-record').disabled = false;
            $('#btn-transcribe').disabled = !srcSamples;
            setBadge('model ready — record or open a clip');
        },
        onError: (e) => {
            $('#btn-load').disabled = false;
            setBadge('load failed: ' + e, true);
        },
    });
}

// ── wire up ──────────────────────────────────────────────────────────────────

$('#btn-load').addEventListener('click', () => loadModel($('#model-dir').value.trim()));
$('#btn-record').addEventListener('click', () => (recording ? stopRecording() : startRecording()));
$('#btn-loadfile').addEventListener('click', () => {
    const path = $('#src-file').value.trim();
    if (!path) { setBadge('pick an audio file', true); return; }
    try {
        const mono = decodeFileToSource(path);
        if (!mono) { setBadge('could not decode ' + path, true); return; }
        setSource(mono, path.split(/[\\\/]/).pop());
    } catch (e) { setBadge('file error: ' + e.message, true); }
});
$('#btn-play').addEventListener('click', () => {
    if (srcClipId >= 0 && audioCtx) { try { audioCtx.playClip(srcClipId, 1.0, false); } catch (e) {} }
});
$('#btn-transcribe').addEventListener('click', runTranscribe);
$('#btn-cancel').addEventListener('click', () => { if (runHandle) runHandle.cancel(); });

(function boot() {
    let dir = MODEL_CANDIDATES[0];
    for (const p of MODEL_CANDIDATES) {
        try { if (fs.existsSync(p + '/config.json')) { dir = p; break; } } catch (e) {}
    }
    $('#model-dir').value = dir;
    if (fs.existsSync(dir + '/config.json')) loadModel(dir);
    else setBadge('pick a Qwen3-ASR checkpoint directory, then Load');
})();
