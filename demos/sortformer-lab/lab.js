// Sortformer Lab — streaming speaker diarization on any audio source.
//
// Live: bro.listen.open(source) gives an independent 16 kHz stream (the mic,
// the whole-system output, or one app's audio). Each tick pulls the new audio
// and, once a full context window has arrived, pushes it through a Sortformer
// streaming session (model.createSession(); session.feed(window, isLast)).
// Every flush continues the session's Arrival-Order Speaker Cache, so labels
// stay stable across windows, and returns per-80 ms-frame activity for up to
// four speakers.
//
// The window ("context") is the latency/accuracy dial. Sortformer has no
// clustering knob: it separates speakers by attending over a span of audio,
// so it has to HEAR enough of each voice to tell similar ones apart. Short
// windows collapse similar voices into one slot; longer ones (toward the
// native ~15 s chunk) separate them. For voices it still merges, see
// cluster-diar-lab.
//
// Offline: a recorded take or an audio file goes through bro.diar.diarize
// (the whole clip at once) into the same speaker view.
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

const MAX_FRAMES = 1800;          // ~144 s of 80 ms columns
const TICK_MS = 250;

/** Live app state (tests read it and drive feedWindow). */
export const lab = {
    model: null,
    session: null,       // live streaming session
    frames: [],          // Float32Array(numSpeakers) per 80 ms frame
    totalFrames: 0,      // frames emitted since the last clear
    audioSeconds: 0,
    windowSec: 4,
    lastFrame: -1,       // cursor into the live stream's retained ring
    lastFeedMs: 0,
    busy: false,         // an offline diarize is in flight
    result: null,        // last offline Diarization
    error: '',
    ui: null,
};

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('btn-diarize', 'btn-clear', 'ctx', 'thresh');
    const readout = stats('#stats', { frames: 'frames', audio: 'diarized', feed: 'last window', rtf: 'RTF' });
    const speakers = speakerView('#speakers', '#lanes', { threshold: +el.thresh.value, empty: 'load a model, then listen or diarize a clip' });
    let ticker = 0;

    const input = clipInput('#input-bar', {
        onClip: () => { refresh(); if (input.autorun && lab.model) diarizeClip(); },
        onError: (m) => status.error(m),
        onRecord: (on) => { if (on) status.busy('recording… speak, then stop'); },
    });
    const live = liveInput('#live-bar', {
        onStart: (stream, spec) => {
            lab.session = lab.model.createSession();
            lab.lastFrame = -1;
            ticker = setInterval(tick, TICK_MS);
            status.ok('listening to ' + spec.label + ' · ' + lab.windowSec + ' s context per update');
            refresh();
        },
        onStop: () => {
            clearInterval(ticker); ticker = 0;
            lab.session = null;
            status.set('stopped');
            refresh();
        },
        onError: (m) => status.error(m),
    });
    const row = modelRow('#model-bar', {
        fields: [{ id: 'model-dir', label: 'model', what: 'Sortformer 4spk-v2.1', candidates: SORTFORMER }],
        onLoad: ([dir]) => load(dir),
        onMissing: (m) => { lab.error = m; status.error(m); },
    });

    bindControl(el.ctx, {
        onChange: (v) => {
            lab.windowSec = +v;
            if (live.running) status.ok('context window: ' + lab.windowSec + ' s per update');
        },
    });
    bindControl(el.thresh, { out: '#thresh-val', fmt: (v) => (+v).toFixed(2), onChange: (v) => { speakers.threshold = +v; } });

    function refresh() {
        el.btnDiarize.disabled = !lab.model || !input.clip || lab.busy;
        live.enabled = !!lab.model && !lab.busy;
    }

    function load(dir) {
        lab.model = null; lab.error = '';
        row.busy(true);
        refresh();
        status.busy('loading Sortformer…');
        const fail = (m) => { lab.error = 'load failed: ' + m; row.busy(false); status.error(lab.error); };
        try {
            bro.diar.loadSortformer(dir, {
                onReady: (m) => {
                    lab.model = m;
                    row.busy(false);
                    row.meta(m.numSpeakers + ' speakers · frame ' + (m.frameSeconds * 1000) + ' ms · enc ' +
                             m.fcDModel + 'd / head ' + m.tfDModel + 'd');
                    if (m.device) badge.set(m.device);
                    speakers.set([], m.numSpeakers, m.frameSeconds);
                    status.ok('ready · listen to a source, or diarize a clip');
                    refresh();
                    if (input.clip && input.autorun) diarizeClip();
                },
                onError: fail,
            });
        } catch (e) { fail(e.message || e); }
    }

    // ── live: pull a context window, feed it ──────────────────────────────
    function tick() {
        const s = live.stream;
        if (!s || !lab.session) return;
        if (!s.valid) { status.warn('source ended'); live.stop(); return; }
        const newest = s.frame();
        if (lab.lastFrame < 0) { lab.lastFrame = newest; return; }         // skip the startup backlog
        const hop = (s.info().hop) || 160;
        if ((newest - lab.lastFrame) * hop < SPEECH_RATE * lab.windowSec) return;
        const pcm = s.audio(lab.lastFrame, newest);
        lab.lastFrame = newest;
        if (!pcm || !pcm.length) return;
        live.level(peak(pcm));
        feedWindow(pcm);
    }

    // One window of 16 kHz PCM through the live session, folded into the view.
    function feedWindow(pcm) {
        if (!lab.session) lab.session = lab.model.createSession();
        const t0 = Date.now();
        let d;
        try { d = lab.session.feed({ samples: pcm, sampleRate: SPEECH_RATE }, true); }
        catch (e) { status.error('feed: ' + (e.message || e)); return null; }
        lab.lastFeedMs = Date.now() - t0;
        const S = d.numSpeakers;
        for (let f = 0; f < d.numFrames; f++) lab.frames.push(d.probs.slice(f * S, (f + 1) * S));
        if (lab.frames.length > MAX_FRAMES) lab.frames.splice(0, lab.frames.length - MAX_FRAMES);
        lab.totalFrames += d.numFrames;
        lab.audioSeconds += pcm.length / SPEECH_RATE;
        speakers.set(lab.frames, S, lab.model.frameSeconds);
        const win = pcm.length / SPEECH_RATE;
        readout.set({ frames: lab.totalFrames, audio: lab.audioSeconds.toFixed(1) + ' s',
                      feed: lab.lastFeedMs + ' ms', rtf: win ? (lab.lastFeedMs / 1000 / win).toFixed(3) : '—' });
        return d;
    }

    // ── offline: the whole clip at once ───────────────────────────────────
    function diarizeClip() {
        if (!lab.model || !input.clip || lab.busy) return;
        const clip = input.clip;
        lab.busy = true;
        lab.result = null;
        refresh();
        status.busy('diarizing ' + input.label + '…');
        const t0 = Date.now();
        bro.diar.diarize(lab.model, { samples: clip, sampleRate: SPEECH_RATE }, {
            onDone: (res, info) => {
                lab.busy = false;
                refresh();
                if (!res || (info && (info.error || info.cancelled))) {
                    status.error('diarize: ' + ((info && info.error) || 'cancelled'));
                    return;
                }
                const ms = Date.now() - t0, secs = clip.length / SPEECH_RATE;
                lab.frames = diarFrames(res);
                lab.totalFrames = res.numFrames;
                lab.audioSeconds = secs;
                speakers.set(lab.frames, res.numSpeakers, res.frameSeconds);
                readout.set({ frames: res.numFrames, audio: secs.toFixed(1) + ' s', feed: ms + ' ms',
                              rtf: (ms / 1000 / secs).toFixed(3) });
                lab.result = res;
                status.ok(input.label + ' · ' + speakers.totals().filter((t) => t > 0).length + ' active speaker(s)');
            },
        });
    }

    function clearAll() {
        lab.frames = []; lab.totalFrames = 0; lab.audioSeconds = 0; lab.result = null;
        if (lab.session) { try { lab.session.reset(); } catch (e) { /* stale */ } }
        lab.lastFrame = -1;
        speakers.clear();
        readout.set({ frames: 0, audio: '0.0 s', feed: '—', rtf: '—' });
        status.set('cleared');
    }

    el.btnDiarize.addEventListener('click', diarizeClip);
    el.btnClear.addEventListener('click', clearAll);

    bro.diar.init();
    lab.ui = { status, input, live, speakers, row };
    lab.feedWindow = feedWindow;
    lab.clear = clearAll;
    row.autoLoad();
}
