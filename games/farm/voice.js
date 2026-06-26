// voice.js — spoken voices for the farm NPCs, via Kokoro TTS.
//
// Every line that already flows through world.say(speakerId, text) can also be
// SPOKEN here: each speaker (the Foreman, the four workers, the player, the
// narrator) gets a distinct Kokoro voice, synthesized on the GPU and played back
// through bro's clip-based AudioContext (broaudio). This module is self-contained
// — app.js creates it once and tees world.say into voice.speak().
//
// Design notes that matter for the next pass:
//   • SERIALIZED SYNTH. Kokoro allows exactly ONE synthesis in flight per model
//     (a 2nd concurrent call throws), so utterances are queued and drained one at
//     a time through a single in-flight gate.
//   • UTTERANCE DURATION is surfaced three ways so a later pass can gate NPC
//     behaviour on "has the Foreman finished speaking?":
//       1. speak(id, text) returns a Promise<number> that resolves with the
//          utterance length in SECONDS when playback finishes (0 if skipped /
//          disabled / not synthesized).
//       2. speak(id, text, { onSpoken }) calls onSpoken(durationSec) at the same
//          moment.
//       3. voice.currentUtterance = { speakerId, text, durationSec, endsAt } while
//          something is speaking (endsAt is a Date.now() ms timestamp), else null.
//          voice.speaking(id?) is a convenience predicate over it.
//   • GRACEFUL DEGRADATION. If the model fails to load (no GPU, missing weights),
//     `disabled` is set, the error is logged ONCE, and speak() becomes a no-op —
//     the game keeps running as silent text-only chatter. This is robustness, not
//     a CPU fallback: Kokoro always loads on the default device.

const _fs = (() => { try { return require('fs'); } catch (e) { return null; } })();
function exists(p) { try { return !!_fs && !!p && _fs.existsSync(p); } catch (e) { return false; } }
function envVar(k) {
    try { const p = globalThis.process; return (p && p.env && p.env[k]) || ''; }
    catch (e) { return ''; }
}

// ── voice assignment ─────────────────────────────────────────────────────────
// Abstract roster tag (defs.js NPC_SPECS .voice) → concrete Kokoro voice pack.
const TAG_TO_VOICE = {
    warm:   'af_heart',    // Mara, rancher — warm female
    bright: 'af_bella',    // Lily, gardener — bright female
    gruff:  'am_fenrir',   // Tom, farmhand — gruff male
    calm:   'am_adam',     // Sam, rancher — calm male
};
// Non-NPC speaker ids → distinct voices that no worker uses.
const ID_TO_VOICE = {
    Foreman: 'am_onyx',    // authoritative male boss, distinct from the workers
    You:     'am_michael', // the player — its own male voice
    Farm:    'af_nicole',  // the narrator — soft, unobtrusive female
};

// Locate the dev brosoundml sibling that holds weights/kokoro. Probes a few
// cwd-relative spots plus BRO_WEIGHTS (mirrors voice-pipeline/models.js), so the
// path resolves regardless of which cwd the bro binary was launched from.
function resolveKokoroDir() {
    const wroot = envVar('BRO_WEIGHTS');
    const home = (() => { try { return require('os').homedir(); } catch (e) { return ''; } })();
    const cands = [
        wroot && wroot + '/brosoundml/weights/kokoro',
        '../brosoundml/weights/kokoro',
        '../../brosoundml/weights/kokoro',
        '../../../brosoundml/weights/kokoro',
        home && home + '/projects/brosoundml/weights/kokoro',
        'D:/projects/brosoundml/weights/kokoro',
    ].filter(Boolean);
    for (const c of cands) if (exists(c + '/config.json')) return c;
    return null;
}

// Linear-interp resample (mono) from inRate → outRate. Same helper the kokoro-lab
// playback path uses; Kokoro is 24 kHz and broaudio runs at the device rate.
function resample(samples, inRate, outRate) {
    if (!outRate || Math.abs(outRate - inRate) < 1) return samples;
    const ratio = outRate / inRate, n = Math.floor(samples.length * ratio);
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / ratio, j = t | 0, f = t - j;
        const a = samples[j], b = (samples[j + 1] !== undefined ? samples[j + 1] : a);
        buf[i] = a * (1 - f) + b * f;
    }
    return buf;
}

const PLAY_GAIN     = 0.9;   // clip playback gain
const PLAY_DELAY_FR = 3;     // frames to wait between createClip and playClip (RCU)
const GAP_MS        = 120;   // small silence between queued utterances
const QUEUE_CAP     = 12;    // drop the oldest pending line beyond this
const CACHE_CAP     = 64;    // max cached phrase clips before LRU eviction

// ── proximity / spatial voice ────────────────────────────────────────────────
// Voices play from where the speaker is STANDING, attenuated by distance to the
// player (the listener). Beyond maxDistance a line is inaudible — the farm is
// 40x28 tiles, so you only ever hear your own corner of it, and word of mouth
// has to physically travel. A 'linear' distance model gives a clean hard edge at
// maxDistance (vs inverse, which only asymptotes), so earshot is a real boundary.
export const SPEECH_SPATIAL = {
    refDistance: 2.5,    // tiles within which a voice is at full volume
    maxDistance: 12,     // tiles past which it's silent (out of earshot)
    rolloff:     1.0,    // linear fall-off strength across [ref, max]
    model:       'linear',
};

// Pure proximity math, exported so the rule is testable without audio/GPU.
// speaker / listener are tile positions { x, y } (or null). Returns the spatial
// params for one utterance, or null when either position is unknown — a null
// speaker (the 'Farm' narrator, pre-spawn lines) plays NON-spatial (always
// audible), which is the right call for UI/omniscient voices. Tiles map to audio
// space as (x, 0, y): tile-y is the world Z plane, matching the iso renderer.
export function computeSpatial(speaker, listener) {
    if (!speaker || !listener) return null;
    const dx = speaker.x - listener.x, dy = speaker.y - listener.y;
    const distance = Math.hypot(dx, dy);
    return {
        x: speaker.x, y: 0, z: speaker.y,
        refDistance: SPEECH_SPATIAL.refDistance,
        maxDistance: SPEECH_SPATIAL.maxDistance,
        rolloff:     SPEECH_SPATIAL.rolloff,
        model:       SPEECH_SPATIAL.model,
        distance,
        audible: distance <= SPEECH_SPATIAL.maxDistance,
    };
}

// createVoice(opts)
//   opts.getAudioCtx()        → the shared broaudio AudioContext (or null)
//   opts.npcVoiceTag(id)      → the abstract voice tag for an NPC speaker id
//   opts.isActive()           → true only while the sim is actually playing
//   opts.speakerPos(id)       → { x, y } tile of a speaker, or null (non-spatial)
//   opts.listenerPos()        → { x, y } tile of the player (the listener), or null
export function createVoice(opts = {}) {
    const getAudioCtx  = opts.getAudioCtx  || (() => (typeof AudioContext === 'function' ? null : null));
    const npcVoiceTag  = opts.npcVoiceTag  || (() => null);
    const isActive     = opts.isActive     || (() => true);
    const speakerPos   = opts.speakerPos   || (() => null);
    const listenerPos  = opts.listenerPos  || (() => null);

    const voice = {
        ready: false,
        disabled: false,
        currentUtterance: null,   // { speakerId, text, durationSec, endsAt } | null
        // Debug / verification surface (read by the headless harness):
        debug: {
            kokoroDir: null,
            speakers: {},         // id → { voice, count, lastSamples, lastDurationSec, fromCache }
            lastError: null,
            lastSpatial: null,    // { speakerId, x, z, distance, audible } of the last positioned line
        },
        _lastSamples: null,       // Float32Array of the most recent synthesis
        _lastSpeaker: null,
        _lastVoice: null,
    };

    let kokoro = null;
    const voiceCache = new Map();   // voice-file path → loaded Voice handle
    const sessions = new Map();     // speakerId → { session, voiceName } | null (unknown)
    const queue = [];               // { speakerId, text, resolve, onSpoken }
    let busy = false;               // a synthesis is in flight (the shared gate)
    let loggedDisable = false;

    const clipCache = new Map();    // key → { clipId, durationSec } (insertion-ordered LRU)
    const pendingPlays = [];        // { clipId, gain, framesLeft, speakerId, durationSec }
    const activeSpatial = [];       // { pid, speakerId, endsAt } — live positioned playbacks to track

    function logOnce(msg) {
        voice.debug.lastError = msg;
        if (!loggedDisable) { loggedDisable = true; console.warn('[farm-voice] ' + msg); }
    }

    function disable(msg) {
        voice.disabled = true;
        voice.ready = false;
        logOnce(msg);
        // Resolve anything queued so awaiters don't hang.
        while (queue.length) { const it = queue.shift(); try { it.resolve(0); } catch (e) {} }
    }

    // ── model load (async, non-blocking) ─────────────────────────────────────
    function load() {
        if (typeof bro === 'undefined' || !bro.tts || typeof bro.tts.loadKokoro !== 'function') {
            disable('bro.tts unavailable — voices off');
            return;
        }
        const dir = resolveKokoroDir();
        voice.debug.kokoroDir = dir;
        if (!dir) { disable('kokoro weights not found — voices off'); return; }

        // Point the phonemizer at this sibling checkout. setAssetRoot derives the
        // g2p lexicon + POS tagger from <root>/../brosoundml-data and the vocab
        // from <root>/weights/kokoro/config.json. Fall back to explicit setAssets
        // if that flat layout is what's on disk.
        try {
            const repoRoot = dir.replace(/[\\\/]+weights[\\\/]+kokoro[\\\/]*$/, '');
            const dataRoot = repoRoot.replace(/[\\\/][^\\\/]*$/, '') + '/brosoundml-data';
            if (exists(dataRoot + '/g2p/lexicon_en_us.bin')) {
                bro.tts.setAssets({
                    lexicon:      dataRoot + '/g2p/lexicon_en_us.bin',
                    posTagger:    dataRoot + '/pos_tagger/model.bin',
                    kokoroConfig: dir + '/config.json',
                });
            } else {
                bro.tts.setAssetRoot(repoRoot);
            }
        } catch (e) { /* phonemize() will surface any real problem per-line */ }

        try {
            bro.tts.loadKokoro(dir, {
                onReady: (k) => {
                    kokoro = k;
                    voice.ready = true;
                    console.log('[farm-voice] Kokoro ready (' + dir + ')');
                    drain();
                },
                onError: (m) => disable('kokoro load failed: ' + m),
            });
        } catch (e) {
            disable('kokoro load threw: ' + (e && e.message || e));
        }

        // Per-frame pump for deferred playback (RCU upload→trigger separation).
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pump);
    }

    function pump() {
        const ctx = getAudioCtx();

        // Glue the listener to the player every frame so distance attenuation is
        // live as either moves. The iso camera looks from +x+z toward the board
        // centre, so its ground-forward is (-1,0,-1): aligning the listener with
        // it makes the head model's left/right match what's on screen.
        if (ctx) {
            const lp = listenerPos();
            if (lp) {
                try {
                    ctx.setListenerPosition(lp.x, 0, lp.y);
                    ctx.setListenerOrientation(-0.7071, 0, -0.7071, 0, 1, 0);
                } catch (e) {}
            }
        }

        // Fire any clip whose upload-settle delay elapsed, spatialising it at its
        // speaker's position. A speaker with no position (the narrator) just plays
        // flat. We capture the playbackId so a moving speaker can be tracked.
        for (let i = pendingPlays.length - 1; i >= 0; i--) {
            const pp = pendingPlays[i];
            if (--pp.framesLeft > 0) continue;
            pendingPlays.splice(i, 1);
            if (!ctx) continue;
            let pid = -1;
            try { pid = ctx.playClip(pp.clipId, pp.gain, false); } catch (e) { continue; }
            if (pid == null || pid < 0) continue;
            const sp = computeSpatial(speakerPos(pp.speakerId), listenerPos());
            if (!sp) continue;   // non-spatial speaker (narrator) — leave it flat
            try {
                ctx.setPlaybackSpatialEnabled(pid, true);
                ctx.setPlaybackSpatialDistanceModel(pid, sp.model);
                ctx.setPlaybackSpatialRefDistance(pid, sp.refDistance);
                ctx.setPlaybackSpatialMaxDistance(pid, sp.maxDistance);
                ctx.setPlaybackSpatialRolloff(pid, sp.rolloff);
                ctx.setPlaybackSpatialPosition(pid, sp.x, sp.y, sp.z);
            } catch (e) { continue; }
            activeSpatial.push({ pid, speakerId: pp.speakerId, endsAt: Date.now() + pp.durationSec * 1000 + 400 });
            voice.debug.lastSpatial = { speakerId: pp.speakerId, x: sp.x, z: sp.z, distance: sp.distance, audible: sp.audible };
        }

        // Track moving speakers: keep each live positioned playback glued to its
        // speaker so a walking worker's voice travels with them; prune the ended.
        const now = Date.now();
        for (let i = activeSpatial.length - 1; i >= 0; i--) {
            const a = activeSpatial[i];
            if (now >= a.endsAt) { activeSpatial.splice(i, 1); continue; }
            if (!ctx) continue;
            const pos = speakerPos(a.speakerId);
            if (pos) { try { ctx.setPlaybackSpatialPosition(a.pid, pos.x, 0, pos.y); } catch (e) {} }
        }

        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pump);
    }

    // ── voice/session resolution ─────────────────────────────────────────────
    function voiceNameFor(speakerId) {
        if (ID_TO_VOICE[speakerId]) return ID_TO_VOICE[speakerId];
        const tag = npcVoiceTag(speakerId);
        if (tag && TAG_TO_VOICE[tag]) return TAG_TO_VOICE[tag];
        return null;   // unknown speaker — skip (don't fake a voice)
    }

    function sessionFor(speakerId) {
        if (sessions.has(speakerId)) return sessions.get(speakerId);
        const name = voiceNameFor(speakerId);
        if (!name || !kokoro) { sessions.set(speakerId, null); return null; }
        try {
            const path = voice.debug.kokoroDir + '/voices/' + name + '.bin';
            let v = voiceCache.get(path);
            if (!v) { v = kokoro.loadVoice(path); voiceCache.set(path, v); }
            const s = { session: kokoro.createSession(v), voiceName: name };
            sessions.set(speakerId, s);
            return s;
        } catch (e) {
            logOnce('voice load failed for ' + speakerId + ': ' + (e && e.message || e));
            sessions.set(speakerId, null);
            return null;
        }
    }

    // ── clip cache (LRU) ─────────────────────────────────────────────────────
    function cacheGet(key) {
        const v = clipCache.get(key);
        if (v) { clipCache.delete(key); clipCache.set(key, v); }   // bump to MRU
        return v;
    }
    function cachePut(key, entry) {
        clipCache.set(key, entry);
        while (clipCache.size > CACHE_CAP) {
            const oldKey = clipCache.keys().next().value;
            const old = clipCache.get(oldKey);
            clipCache.delete(oldKey);
            const ctx = getAudioCtx();
            if (ctx && old && old.clipId >= 0) { try { ctx.deleteClip(old.clipId); } catch (e) {} }
        }
    }

    // Schedule a clip to play a few frames after it was uploaded, then mark it as
    // the current utterance and resolve the awaiter when it finishes.
    function playUtterance(speakerId, text, clipId, durationSec, item) {
        if (clipId >= 0) pendingPlays.push({ clipId, gain: PLAY_GAIN, framesLeft: PLAY_DELAY_FR, speakerId, durationSec });
        const endsAt = Date.now() + durationSec * 1000;
        voice.currentUtterance = { speakerId, text, durationSec, endsAt };
        // Report the real length the moment playback begins, so the model's
        // speech channel can hold the line (bubble + worker gating) to match.
        try { if (item.onStart) item.onStart(durationSec); } catch (e) {}
        // Synthesis for this line is DONE — release the synth gate NOW (rather
        // than after playback) so the NEXT speaker's line can synthesize while
        // this one plays. Kokoro still synthesizes one at a time, but broaudio
        // mixes playback, so different individuals' voices overlap. The model
        // (world.js) keeps each individual from overlapping THEMSELVES.
        busy = false;
        setTimeout(drain, 0);
        setTimeout(() => {
            if (voice.currentUtterance && voice.currentUtterance.endsAt === endsAt) {
                voice.currentUtterance = null;
            }
            try { item.resolve(durationSec); } catch (e) {}
            try { if (item.onSpoken) item.onSpoken(durationSec); } catch (e) {}
        }, durationSec * 1000 + GAP_MS);
    }

    // ── the drain loop — one synthesis at a time ─────────────────────────────
    function drain() {
        if (busy || voice.disabled || !voice.ready || queue.length === 0) return;
        const item = queue[0];
        const key = item.speakerId + '|' + item.text;

        // Cached phrase: replay the existing clip, no re-synthesis.
        const hit = cacheGet(key);
        if (hit) {
            queue.shift();
            busy = true;
            recordStat(item.speakerId, null, null, hit.durationSec, true);
            playUtterance(item.speakerId, item.text, hit.clipId, hit.durationSec, item);
            return;
        }

        const ss = sessionFor(item.speakerId);
        if (!ss) { queue.shift(); try { item.resolve(0); } catch (e) {} drain(); return; }

        let ids;
        try { ids = bro.tts.phonemize(item.text); }
        catch (e) { logOnce('phonemize failed: ' + (e && e.message || e)); queue.shift(); try { item.resolve(0); } catch (_) {} drain(); return; }
        if (!ids || ids.length === 0) { queue.shift(); try { item.resolve(0); } catch (e) {} drain(); return; }

        queue.shift();
        busy = true;
        try {
            ss.session.synthesize(ids, {
                onDone: (result, info) => {
                    if (!info || info.cancelled || info.error || !result || !result.samples || result.samples.length === 0) {
                        if (info && info.error) logOnce('synth error: ' + info.error);
                        try { item.resolve(0); } catch (e) {}
                        busy = false;
                        drain();
                        return;
                    }
                    const durationSec = result.samples.length / result.sampleRate;
                    voice._lastSamples = result.samples;
                    voice._lastSpeaker = item.speakerId;
                    voice._lastVoice = ss.voiceName;
                    recordStat(item.speakerId, ss.voiceName, result.samples, durationSec, false);

                    let clipId = -1;
                    const ctx = getAudioCtx();
                    if (ctx) {
                        try {
                            const buf = resample(result.samples, result.sampleRate, ctx.sampleRate || 48000);
                            clipId = ctx.createClip(buf, 1);
                            cachePut(key, { clipId, durationSec });
                        } catch (e) { logOnce('clip create failed: ' + (e && e.message || e)); }
                    }
                    playUtterance(item.speakerId, item.text, clipId, durationSec, item);
                },
            });
        } catch (e) {
            // A throw here means the shared gate was busy or synth refused; recover.
            logOnce('synthesize threw: ' + (e && e.message || e));
            try { item.resolve(0); } catch (_) {}
            busy = false;
            setTimeout(drain, 50);
        }
    }

    function recordStat(speakerId, voiceName, samples, durationSec, fromCache) {
        const d = voice.debug.speakers[speakerId] || (voice.debug.speakers[speakerId] = { voice: null, count: 0 });
        if (voiceName) d.voice = voiceName;
        d.count++;
        d.lastDurationSec = durationSec;
        d.fromCache = fromCache;
        if (samples) d.lastSamples = samples.length;
    }

    // ── public API ───────────────────────────────────────────────────────────
    // speak(speakerId, text, opts?) → Promise<number>
    //   Enqueues a line for spoken playback and resolves with its duration in
    //   SECONDS once it finishes (0 if skipped / disabled). opts.onSpoken(sec)
    //   fires at the same moment. No-op (resolves 0) while the sim isn't active.
    //   opts.priority:true marks the line as behaviour-gating — it bypasses the
    //   drop-oldest backpressure below, so a briefing line a worker is physically
    //   waiting on can NEVER be silently evicted under heavy chatter. The timing
    //   contract is unchanged: it still resolves with its real duration in seconds.
    function speak(speakerId, text, sopts) {
        sopts = sopts || {};
        if (voice.disabled || !isActive() || !text || !String(text).trim()) {
            return Promise.resolve(0);
        }
        return new Promise((resolve) => {
            queue.push({ speakerId, text: String(text), resolve, onSpoken: sopts.onSpoken, onStart: sopts.onStart, priority: !!sopts.priority });
            // Bound the backlog so speech latency can't run away under chatter —
            // but only ever evict NON-priority lines. Priority (briefing) lines
            // are gating worker behaviour and must be spoken, so they're skipped.
            while (queue.length > QUEUE_CAP) {
                const idx = queue.findIndex((q) => !q.priority);
                if (idx === -1) break;   // backlog is all priority — keep them all
                const dropped = queue.splice(idx, 1)[0];
                try { dropped.resolve(0); } catch (e) {}
            }
            drain();
        });
    }

    // speaking(id?) → bool. With no arg: is anything speaking? With an id: is THAT
    // speaker the current utterance? (The hook the next pass gates worker movement
    // on, e.g. voice.speaking('Foreman').)
    function speaking(speakerId) {
        const u = voice.currentUtterance;
        if (!u) return false;
        return speakerId == null ? true : u.speakerId === speakerId;
    }

    voice.speak = speak;
    voice.speaking = speaking;
    voice.load = load;
    voice.computeSpatial = computeSpatial;   // pure proximity math (headless tests reach it here)
    voice.spatial = SPEECH_SPATIAL;
    load();
    return voice;
}
