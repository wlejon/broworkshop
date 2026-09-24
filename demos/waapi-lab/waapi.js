// waapi.js — one "current animation" built from element.animate(), driven by
// the transport, and read back through the effect's own timing model.
//
// Everything the UI shows comes from the Animation / KeyframeEffect objects:
// progress is getComputedTiming().progress (directed AND eased, exactly what
// the engine applied this frame), the iteration is currentIteration, the
// keyframe markers are getKeyframes()[i].computedOffset. The lab never
// re-derives these from currentTime, because that would show what the app
// believes rather than what the engine did.

export const ctl = {
    anims: [],           // one per target (the ripple grid staggers 16)
    primary: null,       // anims[0]; the transport and telemetry follow it
    events: [],          // { type, t } from onfinish / oncancel, newest last
    onEvent: null,       // (type, anim) => void
};

/** Cancel whatever runs, then animate `targets` (an element or an array). */
export function run(targets, keyframes, timing, stagger) {
    drop();
    const list = Array.isArray(targets) ? targets : [targets];
    list.forEach((el, i) => {
        const opts = Object.assign({}, timing);
        if (stagger) opts.delay = (opts.delay || 0) + i * stagger;
        const a = el.animate(keyframes, opts);
        a.onfinish = () => note('finish', a);
        a.oncancel = () => note('cancel', a);
        ctl.anims.push(a);
    });
    ctl.primary = ctl.anims[0] || null;
    return ctl.primary;
}

function note(type, a) {
    if (a !== ctl.primary) return;     // one row per transport action, not sixteen
    ctl.events.push({ type, t: document.timeline.currentTime });
    if (ctl.onEvent) ctl.onEvent(type, a);
}

const each = (fn) => { for (const a of ctl.anims) fn(a); };

export function playPause() {
    const p = ctl.primary;
    if (!p) return false;
    if (p.playState === 'running') { each((a) => a.pause()); return false; }
    each((a) => a.play());
    return true;
}
export function reverse() { each((a) => a.reverse()); }

/**
 * The Cancel button: effects drop, playState goes idle, currentTime null.
 * The animations stay in ctl, so Play restarts them from scratch.
 */
export function cancel() { each((a) => a.cancel()); }

/** Replace the current set silently (preset switch, timing edit). */
function drop() {
    each((a) => { a.onfinish = null; a.oncancel = null; a.cancel(); });
    ctl.anims = [];
    ctl.primary = null;
}

/**
 * finish() on an infinite animation throws InvalidStateError — that is the
 * spec, not a bro quirk, so the error is returned for the status line rather
 * than swallowed.
 */
export function finish() {
    try { each((a) => a.finish()); return null; }
    catch (e) { return e; }
}

/**
 * Setting playbackRate directly. updatePlaybackRate() (the spec's seamless
 * variant) is not implemented in bro; with `pending` always false the plain
 * setter has the same visible effect.
 */
export function setRate(rate) {
    each((a) => { a.playbackRate = rate; });
}

/** Seek every animation to fraction f of the primary's first iteration. */
export function seek(f) {
    const p = ctl.primary;
    if (!p) return;
    const t = p.effect.getTiming();
    each((a) => { a.currentTime = (t.delay || 0) + f * t.duration; });
}

/**
 * The telemetry row for the primary animation, or null. `frac` is the
 * un-eased position inside the current iteration, DIRECTED the same way the
 * engine directs progress — so (frac, progress) is a point on the easing curve
 * the engine really used.
 */
export function telemetry() {
    const a = ctl.primary;
    if (!a) return null;
    const ct = a.effect.getComputedTiming();
    let frac = null;
    if (ct.localTime != null && ct.progress != null && ct.duration > 0) {
        const active = Math.max(0, ct.localTime - ct.delay);
        let f = active / ct.duration - ct.currentIteration;
        f = Math.min(1, Math.max(0, f));
        const odd = ct.currentIteration % 2 === 1;
        const rev = ct.direction === 'reverse' ||
                    (ct.direction === 'alternate' && odd) ||
                    (ct.direction === 'alternate-reverse' && !odd);
        frac = rev ? 1 - f : f;
    }
    return {
        playState: a.playState,
        currentTime: a.currentTime,
        playbackRate: a.playbackRate,
        progress: ct.progress,
        frac,
        iteration: ct.currentIteration,
        localTime: ct.localTime,
        duration: ct.duration,
        iterations: ct.iterations,
        direction: ct.direction,
        easing: ct.easing,
        count: ctl.anims.length,
    };
}
