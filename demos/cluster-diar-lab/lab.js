// Cluster Diarization Lab — telling similar-sounding voices apart.
//
// Sortformer (and its NeMo reference) collapses acoustically similar voices
// (two women in the same pitch range) into one speaker slot. This lab drives
// the alternative, bro.diar.loadClusterDiarizer: Sortformer activity as VAD,
// ECAPA x-vectors per speech span, centered-cosine clustering. The cosine
// threshold is the "how different is different" knob Sortformer never had.
//
// The clusterer is OFFLINE (it re-clusters a whole clip), so the live path
// retains the source audio via bro.listen and, every couple of seconds,
// re-diarizes the whole capture so far: the speaker count grows and settles
// as it hears more. Feed it CLEAN 16 kHz: bro.listen delivers exactly that,
// so the raw retained PCM goes straight in (a decode/resample round trip
// would blur the speaker margin). A recorded take or a file goes through the
// same call once.
//
// Input bars, speaker cards and lanes are the speech labs' shared view
// (lib/kit/speech.js); this file is the model half.

import { boot } from "/lib/kit/app.js";
import { ids } from "/lib/kit/dom.js";
import { bindControl } from "/lib/kit/params.js";
import { stats } from "/lib/kit/ui.js";
import { deviceBadge, modelRow } from "/lib/kit/ml.js";
import { clipInput, liveInput, speakerView, diarFrames, peak, SPEECH_RATE } from "/lib/kit/speech.js";

export const SORTFORMER = ['brosoundml-data/sortformer/4spk-v2.1', 'brosoundml/weights/sortformer/4spk-v2.1'];
export const ENCODER = ['brosoundml-data/qwen-tts/speaker-encoder'];

const RERUN_MS = 2500;           // live re-diarize cadence
const MIN_CAPTURE_SEC = 3.0;     // a couple of windows before the first run

/** Live app state (tests read it). */
export const lab = {
    model: null,
    cosine: 0.40,
    startFrame: -1,      // capture start in the live stream's retained ring
    busy: false,         // a clusterDiarize is in flight
    result: null,        // last Diarization
    lastMs: 0,
    capturedSec: 0,
    error: '',
    ui: null,
};

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('btn-diarize', 'btn-clear', 'cos');
    const readout = stats('#stats', { spk: 'speakers', audio: 'diarized', took: 'took', cos: 'cosine' });
    const speakers = speakerView('#speakers', '#lanes', { height: 220, empty: 'no speech diarized yet' });
    let ticker = 0;

    const input = clipInput('#input-bar', {
        onClip: () => { refresh(); if (input.autorun && lab.model) diarize(input.clip, input.label); },
        onError: (m) => status.error(m),
        onRecord: (on) => { if (on) status.busy('recording… speak, then stop'); },
    });
    const live = liveInput('#live-bar', {
        onStart: (stream, spec) => {
            lab.startFrame = stream.frame();     // diarize everything from now on
            ticker = setInterval(rerun, RERUN_MS);
            status.ok('listening to ' + spec.label + ' · re-diarizing the whole capture every ' + (RERUN_MS / 1000) + ' s');
        },
        onStop: () => { clearInterval(ticker); ticker = 0; status.set('stopped'); },
        onError: (m) => status.error(m),
    });
    const row = modelRow('#model-bar', {
        fields: [
            { id: 'sort-dir', label: 'sortformer', what: 'Sortformer 4spk-v2.1 (VAD)', candidates: SORTFORMER, width: 320 },
            { id: 'enc-dir', label: 'encoder', what: 'ECAPA speaker encoder', candidates: ENCODER,
              probe: 'model.safetensors', width: 320 },
        ],
        onLoad: ([sortDir, encDir]) => load(sortDir, encDir),
        onMissing: (m) => { lab.error = m; status.error(m); },
    });

    bindControl(el.cos, {
        out: '#cos-val', fmt: (v) => (+v).toFixed(2),
        onChange: (v) => { lab.cosine = +v; },
    });
    // Re-diarize when the knob settles, so its effect shows at once.
    el.cos.addEventListener('change', () => {
        if (live.running) captureNow();
        else if (input.clip && lab.result) diarize(input.clip, input.label);
    });

    function refresh() {
        el.btnDiarize.disabled = !lab.model || !input.clip || lab.busy;
        live.enabled = !!lab.model;
    }

    function load(sortDir, encDir) {
        lab.model = null; lab.error = '';
        row.busy(true);
        refresh();
        status.busy('loading Sortformer VAD + speaker encoder…');
        const fail = (m) => { lab.error = 'load failed: ' + m; row.busy(false); status.error(lab.error); };
        try {
            bro.diar.loadClusterDiarizer(sortDir, encDir, {
                onReady: (m) => {
                    lab.model = m;
                    row.busy(false);
                    row.meta('Sortformer VAD + ECAPA x-vectors');
                    if (m.device) badge.set(m.device);
                    status.ok('ready · listen to a source, or diarize a clip');
                    refresh();
                    if (input.clip && input.autorun) diarize(input.clip, input.label);
                },
                onError: fail,
            });
        } catch (e) { fail(e.message || e); }
    }

    // ── live: pull the whole capture, cluster it ──────────────────────────
    function captureNow() {
        const s = live.stream;
        if (!s || !s.valid) return null;
        const newest = s.frame(), hop = (s.info().hop) || 160;
        if ((newest - lab.startFrame) * hop < SPEECH_RATE * MIN_CAPTURE_SEC) return null;
        const pcm = s.audio(lab.startFrame, newest);
        if (pcm && pcm.length) { live.level(peak(pcm)); diarize(pcm, 'live capture'); }
        return pcm;
    }
    function rerun() {
        const s = live.stream;
        if (!s) return;
        if (!s.valid) { status.warn('source ended'); live.stop(); return; }
        if (!lab.busy) captureNow();
    }

    /** Cluster one 16 kHz buffer and render it. */
    function diarize(pcm, label) {
        if (!lab.model || lab.busy || !pcm) return false;
        lab.busy = true;
        refresh();
        if (!live.running) status.busy('diarizing ' + label + '…');
        const t0 = Date.now(), cos = lab.cosine;
        bro.diar.clusterDiarize(lab.model, { samples: pcm, sampleRate: SPEECH_RATE }, {
            clusterThreshold: cos,
            onDone: (res, info) => {
                lab.busy = false;
                refresh();
                if (!res || (info && (info.error || info.cancelled))) {
                    status.error('diarize: ' + ((info && info.error) || 'cancelled'));
                    return;
                }
                lab.lastMs = Date.now() - t0;
                lab.capturedSec = pcm.length / SPEECH_RATE;
                lab.result = res;
                speakers.set(diarFrames(res), res.numSpeakers, res.frameSeconds);
                readout.set({ spk: res.numSpeakers, audio: lab.capturedSec.toFixed(1) + ' s',
                              took: lab.lastMs + ' ms', cos: cos.toFixed(2) });
                if (!live.running) status.ok(label + ' · ' + res.numSpeakers + ' speaker(s)');
            },
        });
        return true;
    }

    function clearAll() {
        lab.result = null; lab.capturedSec = 0;
        const s = live.stream;
        if (s && s.valid) lab.startFrame = s.frame();   // restart the capture window
        speakers.set([], 0);
        readout.set({ spk: 0, audio: '0.0 s', took: '—', cos: lab.cosine.toFixed(2) });
        status.set('cleared');
    }

    el.btnDiarize.addEventListener('click', () => diarize(input.clip, input.label));
    el.btnClear.addEventListener('click', clearAll);

    bro.diar.init();
    lab.ui = { status, input, live, speakers, row };
    lab.diarize = diarize;
    lab.clear = clearAll;
    row.autoLoad();
}
