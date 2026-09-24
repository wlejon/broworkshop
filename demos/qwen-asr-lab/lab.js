// Qwen3-ASR Lab — a worked consumer of bro.stt.loadQwenAsr.
//
// Record (or open a clip) and run Qwen3-ASR over it: the model emits
// "language <Language><asr_text>transcript" as ONE autoregressive id stream,
// split here at model.asrTextId (the marker detokenizes to an empty string,
// so a text-level split cannot work). The language half feeds the language
// line; the transcript half streams in live (async bro.stt.transcribe +
// onToken). The context field shows Qwen3-ASR's context biasing: the terms
// are tokenized with the Qwen BPE tokenizer (bro.lm.loadTokenizer; vocab.json
// + merges.txt sit in the model dir) and placed in the chat template's
// system block.
//
// Input bar, transcript and timeline are the speech labs' shared view
// (lib/kit/speech.js); this file is the model half.

import { boot } from "/lib/kit/app.js";
import { ids } from "/lib/kit/dom.js";
import { deviceBadge, modelRow } from "/lib/kit/ml.js";
import { clipInput, transcriptView, timelineView } from "/lib/kit/speech.js";

export const QWEN_ASR = ['brosoundml/weights/qwen-asr/0.6B'];

/** Live app state (tests read it). */
export const lab = {
    model: null,        // bro.stt QwenAsr handle
    tok: null,          // bro.lm Qwen BPE tokenizer (decode + context ids)
    running: false,
    handle: null,
    ids: null,          // generated ids of the last finished run
    language: '',
    error: '',
    ui: null,
};

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('btn-transcribe', 'btn-cancel', 'run-meta', 'context', 'lang');
    const transcript = transcriptView('#transcript', { placeholder: 'Load the model, then record or open a clip.' });
    const timeline = timelineView('#timeline');
    const ready = () => !!(lab.model && lab.tok);

    const input = clipInput('#input-bar', {
        onClip: (pcm) => {
            timeline.set({ clip: pcm, tokens: [] });
            refresh();
            if (input.autorun && ready() && !lab.running) transcribe();
        },
        onError: (m) => status.error(m),
        onRecord: (on) => { if (on) status.busy('recording… speak, then stop'); },
    });

    const row = modelRow('#model-bar', {
        fields: [{ id: 'model-dir', label: 'model', what: 'Qwen3-ASR 0.6B', candidates: QWEN_ASR }],
        onLoad: ([dir]) => load(dir),
        onMissing: (m) => { lab.error = m; status.error(m); },
    });

    function refresh() {
        el.btnTranscribe.disabled = !ready() || !input.clip || lab.running;
        el.btnCancel.disabled = !lab.running;
    }

    function load(dir) {
        lab.model = null; lab.tok = null; lab.error = '';
        row.busy(true);
        refresh();
        status.busy('loading Qwen3-ASR…');
        const fail = (m) => { lab.error = m; row.busy(false); status.error(m); };
        try {
            lab.tok = bro.lm.loadTokenizer({ vocabPath: dir + '/vocab.json', mergesPath: dir + '/merges.txt' });
        } catch (e) { fail('tokenizer: ' + (e.message || e)); return; }
        try {
            bro.stt.loadQwenAsr(dir, {
                onReady: (m) => {
                    lab.model = m;
                    row.busy(false);
                    row.meta('asr_text id ' + m.asrTextId);
                    if (m.device) badge.set(m.device);
                    status.ok('ready · record or open a clip');
                    refresh();
                    if (input.clip && input.autorun) transcribe();
                },
                onError: (e) => fail('load failed: ' + e),
            });
        } catch (e) { fail('load failed: ' + (e.message || e)); }
    }

    // Split the stream at the <asr_text> marker id.
    function render(ids, final) {
        const cut = ids.indexOf(lab.model.asrTextId);
        const langIds = cut >= 0 ? ids.slice(0, cut) : ids;
        const textIds = cut >= 0 ? ids.slice(cut + 1) : [];
        const lang = lab.tok.decode(langIds).replace(/^language\s*/i, '').trim();
        if (lang) { lab.language = lang; el.lang.textContent = lang; }
        transcript.set(lab.tok.decode(textIds).trim(), !final);
    }

    function transcribe() {
        if (!ready() || !input.clip || lab.running) return;
        const clip = input.clip;
        const stream = [];
        lab.running = true;
        lab.ids = null;
        lab.language = '';
        el.lang.textContent = '—';
        transcript.set('', true);
        el.runMeta.textContent = '';
        refresh();
        status.busy('transcribing…');
        const t0 = Date.now();
        const opts = {
            onToken: (id) => { stream.push(id); render(stream, false); },
            onDone: (out, info) => {
                lab.running = false;
                lab.handle = null;
                refresh();
                if (info.error) { status.error('transcribe error: ' + info.error); return; }
                if (info.cancelled) { render(stream, true); status.warn('cancelled'); return; }
                const got = Array.from(out);
                render(got, true);
                const secs = (Date.now() - t0) / 1000;
                el.runMeta.textContent = got.length + ' tokens · ' + secs.toFixed(2) + ' s · ' +
                    (clip.length / 16000 / Math.max(secs, 1e-3)).toFixed(1) + '× realtime';
                lab.ids = got;
                status.ok('done (' + got.length + ' tokens)');
            },
        };
        const ctxText = el.context.value.trim();
        if (ctxText) opts.contextIds = lab.tok.encode(ctxText);
        lab.handle = bro.stt.transcribe(lab.model, clip, opts);
    }

    el.btnTranscribe.addEventListener('click', transcribe);
    el.btnCancel.addEventListener('click', () => { if (lab.handle) lab.handle.cancel(); });
    el.context.addEventListener('keydown', (e) => { if (e.key === 'Enter') transcribe(); });

    lab.ui = { status, input, transcript, timeline, row };
    row.autoLoad();
}
