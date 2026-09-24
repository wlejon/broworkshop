// Parakeet Lab — speak into the mic (or open a clip) and watch Parakeet-TDT
// stream the transcript in, then see every token pinned to the encoder frame
// it was decoded from.
//
//   mic / file ──► 16 kHz mono PCM ──bro.stt.transcribe──► token ids + frames
//                                                    ──detokenize──► transcript
//
// Parakeet is a transducer: each token is emitted AT an encoder frame, so the
// id stream carries its own timing (frame × model.frameSeconds), no alignment
// pass. The decode runs on a native thread; onToken streams ids back here and
// cancel() is real (the loop polls it once per encoder frame).
//
// The input bar, transcript, timeline and token table are the speech labs'
// shared view (lib/kit/speech.js); this file is the model half.

import { boot } from "/lib/kit/app.js";
import { ids } from "/lib/kit/dom.js";
import { deviceBadge, modelRow } from "/lib/kit/ml.js";
import { clipInput, transcriptView, timelineView, tokenTable } from "/lib/kit/speech.js";

export const PARAKEET = ['brosoundml/weights/parakeet/0.6b-v3'];

/** Live app state (tests read it; module `let` exports would be snapshots). */
export const lab = {
    model: null,        // bro.stt Parakeet handle
    tok: null,          // ParakeetTokenizer (SentencePiece)
    running: false,     // a transcribe is in flight
    handle: null,       // its AsyncHandle
    result: null,       // { tokenIds, tokenFrames } of the last finished run
    error: '',
    ui: null,           // { status, input, transcript, timeline, table, row }
};

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('btn-transcribe', 'btn-cancel', 'run-meta', 'tokens-cap');
    const transcript = transcriptView('#transcript', { placeholder: 'Load a model, then record or open a file.' });
    const timeline = timelineView('#timeline');
    const table = tokenTable('#tokens');
    const ready = () => !!(lab.model && lab.tok);

    const input = clipInput('#input-bar', {
        onClip: (pcm) => {
            timeline.set({ clip: pcm, tokens: [] });
            showTokens(null);
            refresh();
            if (input.autorun && ready() && !lab.running) transcribe();
        },
        onError: (m) => status.error(m),
        onRecord: (on) => { if (on) status.busy('recording… speak, then stop'); },
    });

    const row = modelRow('#model-bar', {
        fields: [{ id: 'model-dir', label: 'model', what: 'Parakeet-TDT 0.6B', candidates: PARAKEET }],
        onLoad: ([dir]) => load(dir),
        onMissing: (m) => { lab.error = m; status.error(m); },
    });

    function refresh() {
        el.btnTranscribe.disabled = !ready() || !input.clip || lab.running;
        el.btnCancel.disabled = !lab.running;
    }

    // Model + SentencePiece tokenizer load in parallel, both async, so the UI
    // stays live during the weight upload.
    function load(dir) {
        lab.model = null; lab.tok = null; lab.error = '';
        row.busy(true);
        row.meta('');
        refresh();
        status.busy('loading Parakeet…');
        const fail = (what) => (e) => { lab.error = what + ': ' + e; row.busy(false); status.error(lab.error); };
        const maybeReady = () => {
            if (!ready()) return;
            row.busy(false);
            const m = lab.model;
            row.meta((m.sampleRate / 1000) + ' kHz · vocab ' + m.vocabSize + ' · ' +
                     (m.frameSeconds * 1000).toFixed(0) + ' ms/frame · ' + lab.tok.vocabCount + ' pieces');
            if (m.device) badge.set(m.device);
            status.ok('ready · record or load a file');
            refresh();
            if (input.clip && input.autorun) transcribe();
        };
        try {
            bro.stt.loadParakeet(dir, { onReady: (m) => { lab.model = m; maybeReady(); }, onError: fail('model') });
            bro.stt.loadParakeetTokenizer(dir + '/tokenizer.json',
                { onReady: (t) => { lab.tok = t; maybeReady(); }, onError: fail('tokenizer') });
        } catch (e) { fail('load')(e.message || e); }
    }

    function showTokens(result) {
        const n = result ? result.tokenIds.length : 0;
        el.tokensCap.hidden = !n;
        if (!n) { table.set([]); return; }
        const fs = lab.model.frameSeconds, rows = [];
        for (let i = 0; i < n; i++) {
            const id = result.tokenIds[i];
            rows.push({ t: result.tokenFrames[i] * fs, piece: lab.tok.decode([id]), id });
        }
        table.set(rows);
        timeline.set({ clip: input.clip, tokens: rows.map((r) => ({ t: r.t, text: r.piece })) });
    }

    function transcribe() {
        if (!ready()) { status.error('load a model first'); return; }
        if (!input.clip) { status.error('record or load audio first'); return; }
        if (lab.running) return;
        const clip = input.clip;
        const streamIds = [];
        lab.running = true;
        lab.result = null;
        transcript.set('', true);
        el.runMeta.textContent = '';
        refresh();
        status.busy('transcribing…');
        const t0 = Date.now();
        lab.handle = bro.stt.transcribe(lab.model, clip, {
            // Re-decode the running id list each token: SentencePiece
            // detokenization is context-dependent at the boundary, so the
            // whole prefix (a few hundred ids) beats appending pieces.
            onToken: (id) => { streamIds.push(id); transcript.set(lab.tok.decode(streamIds), true); },
            onDone: (result, info) => {
                lab.running = false;
                lab.handle = null;
                refresh();
                if (info.error) { status.error('transcribe error: ' + info.error); return; }
                if (info.cancelled) { transcript.set(lab.tok.decode(streamIds)); status.warn('cancelled'); return; }
                const secs = (Date.now() - t0) / 1000;
                transcript.set(lab.tok.decode(result.tokenIds).trim() || '(no speech)');
                el.runMeta.textContent = result.tokenIds.length + ' tokens · ' + secs.toFixed(2) + ' s · ' +
                    (clip.length / 16000 / Math.max(secs, 1e-3)).toFixed(1) + '× realtime';
                showTokens(result);
                lab.result = result;
                status.ok('done');
            },
        });
    }

    el.btnTranscribe.addEventListener('click', transcribe);
    el.btnCancel.addEventListener('click', () => { if (lab.handle) lab.handle.cancel(); });

    lab.ui = { status, input, transcript, timeline, table, row };
    lab.transcribe = transcribe;
    row.autoLoad();
}
