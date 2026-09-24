// Arcade — game-clock timers: delayed callbacks that advance with the game's
// dt instead of wall time, so they freeze while the shell is paused and step
// deterministically in headless tests. Use instead of setTimeout for
// anything that belongs to a run (sequence playback, AI turns, animations).
//
//   import { createTimers } from "/lib/arcade/timers.js";
//   const timers = createTimers();
//   timers.after(600, () => showNext());      // once, 600 ms of game time
//   timers.every(50, (t) => { ...; return t.count < 12; });   // until false
//   // update(run, dt): timers.step(dt);   new run / quit: timers.clear();
//   hud.time = formatClock(run.elapsedMs);    // "m:ss"

/**
 * "m:ss" for a millisecond count (clamped at 0). countdown rounds up, so a
 * 3-minute timer reads 3:00 at the start and 0:00 only when it has run out.
 */
export function formatClock(ms, countdown = false) {
    const total = Math.max(0, (countdown ? Math.ceil : Math.floor)(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
}

export function createTimers() {
    let list = [];
    let now = 0;

    function add(ms, fn, repeat) {
        const t = { at: now + Math.max(0, ms), ms, fn, repeat, count: 0, dead: false };
        list.push(t);
        return () => { t.dead = true; };
    }

    return {
        /** Call fn once after `ms` of game time. Returns cancel(). */
        after(ms, fn) { return add(ms, fn, false); },

        /**
         * Call fn(timer) every `ms` until it returns false (timer.count is
         * the call number, from 1). Returns cancel().
         */
        every(ms, fn) { return add(ms, fn, true); },

        /** Advance the clock by dt ms, firing due timers in time order. */
        step(dt) {
            const end = now + dt;
            for (;;) {
                let next = null;
                for (const t of list) if (!t.dead && t.at <= end && (!next || t.at < next.at)) next = t;
                if (!next) break;
                now = next.at;
                next.count++;
                const again = next.fn(next);
                if (next.repeat && again !== false && !next.dead) next.at = now + Math.max(1, next.ms);
                else next.dead = true;
            }
            now = end;
            list = list.filter((t) => !t.dead);
        },

        /** Drop every pending timer. */
        clear() { list = []; },

        /** Pending timer count. */
        pending() { return list.filter((t) => !t.dead).length; },
    };
}
