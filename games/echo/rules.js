// Echo rules — the Simon sequence, its playback and the player's echo, on
// the game clock (so a paused game freezes mid-sequence). No DOM, audio or
// drawing.
//
// createEcho(rng) starts round 1. The plugin calls step(e, dt ms) every
// frame and press(e, pad) for a key or click. Events on e.events:
// flash {pad, dur} (playback) · press {pad} · roundclear · wrong.

export const PADS = 4;
export const GLOW_DECAY = 3;           // glow units per second
export const WATCH_LEAD_MS = 600;      // before playback starts
export const ROUND_PAUSE_MS = 700;     // after a correct echo

export function createEcho(rng = Math.random) {
    const e = {
        rng,
        round: 0,
        score: 0,              // longest completed sequence
        sequence: [],
        playerStep: 0,
        watchIndex: 0,
        phase: "watch",        // "watch" | "input" | "nice" | "dead"
        status: "WATCH",
        timer: 0,
        glow: [0, 0, 0, 0],
        events: [],
    };
    nextRound(e);
    return e;
}

/** Playback flash length: 600 ms, 25 ms quicker per step, never under 220. */
export function flashDuration(len) {
    return Math.max(220, 600 - (len - 1) * 25);
}

function nextRound(e) {
    e.round++;
    e.sequence.push(Math.floor(e.rng() * PADS));
    e.playerStep = 0;
    e.watchIndex = 0;
    e.phase = "watch";
    e.status = "WATCH";
    e.timer = WATCH_LEAD_MS;
}

export function step(e, dt) {
    const decay = (dt / 1000) * GLOW_DECAY;
    for (let i = 0; i < PADS; i++) e.glow[i] = Math.max(0, e.glow[i] - decay);
    if (e.phase !== "watch" && e.phase !== "nice") return;
    e.timer -= dt;
    while (e.timer <= 0 && (e.phase === "watch" || e.phase === "nice")) {
        if (e.phase === "nice") { nextRound(e); continue; }
        if (e.watchIndex >= e.sequence.length) {
            e.phase = "input";
            e.status = "YOUR TURN";
            return;
        }
        const pad = e.sequence[e.watchIndex++];
        const dur = flashDuration(e.sequence.length);
        e.glow[pad] = 1;
        e.events.push({ type: "flash", pad, dur });
        e.timer += dur + Math.max(80, Math.floor(dur * 0.35));
    }
}

/** The player's echo. Returns false when it is not their turn. */
export function press(e, pad) {
    if (e.phase !== "input") return false;
    e.glow[pad] = 1;
    e.events.push({ type: "press", pad });
    if (e.sequence[e.playerStep] !== pad) {
        e.phase = "dead";
        e.status = "WRONG";
        e.score = Math.max(0, e.round - 1);
        e.events.push({ type: "wrong" });
        return true;
    }
    if (++e.playerStep >= e.sequence.length) {
        e.phase = "nice";
        e.status = "NICE!";
        e.score = e.round;
        e.timer = ROUND_PAUSE_MS;
        e.events.push({ type: "roundclear" });
    }
    return true;
}

export function drainEvents(e) {
    const out = e.events;
    e.events = [];
    return out;
}
