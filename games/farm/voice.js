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

// createVoice(opts)
//   opts.getAudioCtx()        → the shared broaudio AudioContext (or null)
//   opts.npcVoiceTag(id)      → the abstract voice tag for an NPC speaker id
//   opts.isActive()           → true only while the sim is actually playing
export function createVoice(opts = {}) {
    const getAudioCtx  = opts.getAudioCtx  || (() => (typeof AudioContext === 'function' ? null : null));
    const npcVoiceTag  = opts.npcVoiceTag  || (() => null);
    const isActive     = opts.isActive     || (() => true);

    const voice = {
        ready: false,
        disabled: false,
        currentUtterance: null,   // { speakerId, text, durationSec, endsAt } | null
        // Debug / verification surface (read by the headless harness):
        debug: {
            kokoroDir: null,
            speakers: {},         // id → { voice, count, lastSamples, lastDurationSec, fromCache }
            lastError: null,
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
    const pendingPlays = [];        // { clipId, gain, framesLeft }

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
        for (let i = pendingPlays.length - 1; i >= 0; i--) {
            const pp = pendingPlays[i];
            if (--pp.framesLeft <= 0) {
                const ctx = getAudioCtx();
                if (ctx) { try { ctx.playClip(pp.clipId, pp.gain, false); } catch (e) {} }
                pendingPlays.splice(i, 1);
            }
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
        if (clipId >= 0) pendingPlays.push({ clipId, gain: PLAY_GAIN, framesLeft: PLAY_DELAY_FR });
        const endsAt = Date.now() + durationSec * 1000;
        voice.currentUtterance = { speakerId, text, durationSec, endsAt };
        setTimeout(() => {
            if (voice.currentUtterance && voice.currentUtterance.endsAt === endsAt) {
                voice.currentUtterance = null;
            }
            try { item.resolve(durationSec); } catch (e) {}
            try { if (item.onSpoken) item.onSpoken(durationSec); } catch (e) {}
            busy = false;
            drain();
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
    function speak(speakerId, text, sopts) {
        sopts = sopts || {};
        if (voice.disabled || !isActive() || !text || !String(text).trim()) {
            return Promise.resolve(0);
        }
        return new Promise((resolve) => {
            queue.push({ speakerId, text: String(text), resolve, onSpoken: sopts.onSpoken });
            // Bound the backlog so speech latency can't run away under chatter.
            while (queue.length > QUEUE_CAP) { const dropped = queue.shift(); try { dropped.resolve(0); } catch (e) {} }
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
    load();
    return voice;
}
