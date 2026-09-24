// gestures.js — sound in, runner moves out.
//
// createDetector() is pure: feed it one 10 ms frame at a time ({ peak, vad,
// tonal, pitchHz } at `now` ms) and drain() the actions it recognised:
//   a clap (a transient over the threshold)            -> "jump", at once
//   a second clap 110-400 ms after it                  -> "superJump"
//   steady whistle between whistleMinHz and 3200 Hz   -> "glide" ... "glideEnd"
//   a bro.gesture template match                       -> by its name
// (The old controller held a single clap for 130 ms before jumping, which
// closed the double-clap window at 130 ms; a double clap now jumps, then
// super-jumps from the air, like a double tap on Space.)
//
// createMic() wires bro.mic (+ bro.sense for voice / pitch when the build has
// it) into a detector. `live: false` opens no device; tests push audio with
// bro.mic.feed().

const DEBOUNCE_MS = 90;
const DOUBLE_MIN_MS = 110;
const DOUBLE_MAX_MS = 400;
const WHISTLE_FRAMES = 3;

export function createDetector(opts = {}) {
    const d = {
        clapThreshold: opts.clapThreshold != null ? opts.clapThreshold : 0.28,
        whistleMinHz: opts.whistleMinHz != null ? opts.whistleMinHz : 700,
        whistleMaxHz: 3200,
        glideActive: false,
        telemetry: { vad: false, energy: 0, tonal: false, pitchHz: 0, onsets: 0, lastGesture: "None", confidence: 0 },
    };
    let queue = [];
    let lastOnset = -Infinity;
    let armed = false;            // the last clap can still become a double
    let whistleFrames = 0;

    function act(action, gesture, confidence, detail) {
        d.telemetry.lastGesture = gesture;
        d.telemetry.confidence = confidence;
        queue.push(Object.assign({ action }, detail || {}));
    }

    // A clap jumps at once; a second one inside the window upgrades it to a
    // super jump (which works mid-air), and a third starts over.
    function onset(now, strength) {
        const since = now - lastOnset;
        if (since < DEBOUNCE_MS) return;
        lastOnset = now;
        d.telemetry.onsets++;
        if (armed && since >= DOUBLE_MIN_MS && since <= DOUBLE_MAX_MS) {
            armed = false;
            act("superJump", "DOUBLE CLAP (SUPER JUMP)", 0.95, { interval: Math.round(since), strength });
            return;
        }
        armed = true;
        act("jump", "SINGLE CLAP (JUMP)", 0.9, { strength });
    }

    /** One analysis frame. */
    d.feed = function (frame, now) {
        const t = d.telemetry;
        t.energy = frame.peak || 0;
        t.vad = !!frame.vad;
        t.tonal = !!frame.tonal;
        t.pitchHz = t.tonal ? Math.round(frame.pitchHz || 0) : 0;
        if (t.energy > d.clapThreshold) onset(now, t.energy);

        if (t.tonal && t.pitchHz >= d.whistleMinHz && t.pitchHz <= d.whistleMaxHz) {
            // Capped, so the glide lets go ~60 ms after the whistle stops
            // however long it was held.
            whistleFrames = Math.min(whistleFrames + 1, WHISTLE_FRAMES * 2);
            if (whistleFrames >= WHISTLE_FRAMES && !d.glideActive) {
                d.glideActive = true;
                act("glide", "WHISTLE (GLIDE)", 0.92, { pitchHz: t.pitchHz });
            }
        } else {
            if (whistleFrames > 0) whistleFrames--;
            if (whistleFrames === 0 && d.glideActive) {
                d.glideActive = false;
                queue.push({ action: "glideEnd" });
            }
        }
    };

    /** A bro.gesture template match, routed by its name. */
    d.gesture = function (name, confidence) {
        const n = (name || "").toLowerCase();
        const action = /double|super/.test(n) ? "superJump"
            : /whistle|tone/.test(n) ? "glide"
            : /slide|snap|tap/.test(n) ? "slide"
            : "jump";
        act(action, "MATCH: " + name, confidence);
    };

    /** Take the queued actions. */
    d.drain = function () {
        const out = queue;
        queue = [];
        return out;
    };

    /** Forget any held whistle / half-made double clap (mic off). */
    d.reset = function () {
        armed = false;
        whistleFrames = 0;
        if (d.glideActive) {
            d.glideActive = false;
            queue.push({ action: "glideEnd" });
        }
    };

    return d;
}

// ── Mic wiring ──────────────────────────────────────────────────────────

const CHUNK_FRAMES = 160;
const RATE = 16000;
const CHUNK_MS = (CHUNK_FRAMES / RATE) * 1000;

function has(ns) {
    return typeof bro !== "undefined" && bro[ns] && bro[ns].available !== false;
}

/**
 * detector: from createDetector. onFrame(telemetry) after every chunk.
 * Returns { start({ live }) -> bool, stop(), active, now }.
 */
export function createMic(detector, onFrame) {
    const m = { active: false, now: 0, live: true, sense: false };

    function chunk(c) {
        m.now += CHUNK_MS;
        let snap = null;
        if (m.sense) {
            try { snap = m.live ? bro.sense.snapshot() : bro.sense.feed(c.samples); }
            catch (e) { snap = null; }
        }
        const peak = c.peak || 0;
        detector.feed({
            peak,
            vad: snap ? snap.voice || peak > 0.08 : peak > 0.08,
            tonal: !!(snap && snap.tonal),
            pitchHz: snap ? snap.dominantHz : 0,
        }, m.now);
        if (onFrame) onFrame(detector.telemetry);
    }

    m.start = function (opts = {}) {
        if (m.active) return true;
        if (!has("mic")) return false;
        m.live = opts.live !== false;
        try {
            bro.mic.start({
                chunkFrames: CHUNK_FRAMES, targetRate: RATE, agc: false,
                live: m.live, samples: !m.live, onChunk: chunk,
            });
        } catch (e) {
            return false;
        }
        m.sense = false;
        if (has("sense")) {
            try { bro.sense.start({}); m.sense = true; } catch (e) { m.sense = false; }
        }
        if (has("gesture")) {
            try {
                if (bro.gesture.templates().length) {
                    bro.gesture.listen({ onGesture: (name, conf) => detector.gesture(name, conf) });
                }
            } catch (e) { /* no templates / no gesture hub */ }
        }
        m.active = true;
        return true;
    };

    m.stop = function () {
        if (!m.active) return;
        try { bro.mic.stop(); } catch (e) { /* already stopped */ }
        if (m.sense) { try { bro.sense.stop(); } catch (e) { /* ignore */ } }
        if (has("gesture")) { try { bro.gesture.stop(); } catch (e) { /* ignore */ } }
        m.active = false;
        m.sense = false;
        detector.reset();
    };

    return m;
}
