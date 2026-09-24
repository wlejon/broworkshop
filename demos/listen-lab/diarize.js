// Listen Lab — tier-3.5 diarization (who spoke), one speaker set per stream.
//
// No model does end-to-end diarization here, so we COMPOSE it from pieces
// already in the runtime: the VAD that segments utterances (every committed
// transcript line is a clean single-utterance [a,b] span) +
// bro.tts.loadSpeakerEncoder's ECAPA-TDNN x-vector (a 1024-D speaker-identity
// embedding) + online cosine clustering here in JS. On each commit we embed the
// utterance's audio and match it to this stream's known speakers: the nearest
// centroid above a cosine threshold is that speaker; otherwise it is a new one.
// Centroids are a running mean of the (L2-normalized) embeddings, so a
// speaker's voiceprint sharpens with each turn.
//
// This is TURN-BASED diarization: one speaker per utterance. It does not split
// overlapping speech or a speaker change mid-utterance (that needs frame-level
// diarization). Speakers are PER STREAM (st.speakers), so each tab discovers
// its own cast independently.

import { findWeights } from "/lib/kit/weights.js";
import { app, status, fusionRow } from "/app/state.js";
import { renderLines } from "/app/transcript.js";

const ENCODER_WEIGHTS = ['brosoundml-data/qwen-tts/speaker-encoder'];
const SIM_THRESHOLD = 0.55;    // cosine >= this -> same speaker, else a new one
const MIN_SAMPLES   = 4800;    // ~0.3 s @ 16 kHz; shorter clips are unreliable

export const Diarize = {
    enc: null, ready: false, enabled: true,
    stub: null,                // test seam: (pcm) => Float32Array embedding
    busy: false, q: [],        // serialize embeds (one GPU forward at a time)
};

function l2norm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    s = Math.sqrt(s) || 1;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / s;
    return out;
}

function dot(a, b) {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
}

/** Assign an embedding to a speaker, growing the stream's cast as new voices appear. */
function classify(st, emb) {
    if (!st.speakers) { st.speakers = []; st.speakerSeq = 0; }
    const e = l2norm(emb);
    let best = -1, bestSim = -2;
    for (let i = 0; i < st.speakers.length; i++) {
        const sim = dot(e, st.speakers[i].centroid);   // both unit -> cosine
        if (sim > bestSim) { bestSim = sim; best = i; }
    }
    let sp;
    if (best >= 0 && bestSim >= SIM_THRESHOLD) {
        sp = st.speakers[best];
        for (let i = 0; i < sp.sum.length; i++) sp.sum[i] += e[i];
        sp.count++;
        sp.centroid = l2norm(sp.sum);
    } else {
        sp = { id: ++st.speakerSeq, sum: Float32Array.from(e), count: 1, centroid: e };
        st.speakers.push(sp);
    }
    return { id: sp.id, sim: best >= 0 ? bestSim : 0, fresh: sp.count === 1 };
}

function embedDrain() {
    if (Diarize.busy || !Diarize.q.length) return;
    const job = Diarize.q.shift();
    Diarize.busy = true;
    const done = (emb) => {
        Diarize.busy = false;
        if (emb && emb.length) finishAssign(job.st, job.line, emb);
        embedDrain();
    };
    if (Diarize.stub) { done(Diarize.stub(job.pcm)); return; }
    try {
        Diarize.enc.embed(job.pcm, {
            sampleRate: 16000,                 // stream audio is 16 kHz; the encoder resamples
            onDone:  (emb) => done(emb),
            onError: (e) => { status('diarize embed: ' + e, true); done(null); },
        });
    } catch (e) { status('diarize embed: ' + (e.message || e), true); done(null); }
}

function finishAssign(st, line, emb) {
    const r = classify(st, emb);
    line.speaker = r.id;
    fusionRow(st, 'spk', r.fresh
        ? 'new voice — speaker ' + r.id + ' (' + st.speakers.length + ' in this stream)'
        : 'speaker ' + r.id + ' again (match ' + r.sim.toFixed(2) + ')');
    if (st === app.active) renderLines();
}

/** Commit hook: diarize a committed utterance (async; a no-op until the encoder is ready). */
export function assignSpeaker(st, line) {
    if (!Diarize.enabled || (!Diarize.ready && !Diarize.stub)) return;
    const pcm = st.source.listen.audio(line.a, line.b);
    if (!pcm || pcm.length < MIN_SAMPLES) return;
    Diarize.q.push({ st, line, pcm });
    embedDrain();
}

export function dzLoad() {
    if (Diarize.stub) return;
    const dir = findWeights(ENCODER_WEIGHTS, { probe: 'config.json' });
    if (!dir) { fusionRow(app.active, 'info', 'diarization off — speaker-encoder artifact not found'); return; }
    fusionRow(app.active, 'info', 'loading diarizer (ECAPA speaker encoder)…');
    try {
        bro.tts.loadSpeakerEncoder(dir, {
            onReady: (e) => {
                Diarize.enc = e; Diarize.ready = true;
                fusionRow(app.active, 'info', 'diarization ready — utterances tagged by speaker');
            },
            onError: (msg) => fusionRow(app.active, 'info', 'diarizer load failed: ' + msg),
        });
    } catch (e) { fusionRow(app.active, 'info', 'diarizer load failed: ' + (e.message || e)); }
}
