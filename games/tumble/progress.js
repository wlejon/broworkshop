// Tumble progress — campaign state in the arcade save (no DOM, no scene).
//
// Keys (see game.defaults): best { levelId: seconds }, unlocked (count),
// lastLevel (index), coachDone / plankCoachDone (tutorial tips seen).

import { LEVELS, medalFor } from "/app/levels.js";

export const PROGRESS_DEFAULTS = {
    best: {},
    lastLevel: 0,
    unlocked: 1,
    coachDone: false,
    plankCoachDone: false,
};

export function clampLevel(i) {
    return Math.min(Math.max(0, (i | 0)), LEVELS.length - 1);
}

export function lastLevel(save) {
    return clampLevel(save.get("lastLevel") || 0);
}

export function unlockedCount(save) {
    return Math.min(save.get("unlocked") || 1, LEVELS.length);
}

export function bestTimes(save) {
    return save.get("best") || {};
}

export function resetProgress(save) {
    for (const k in PROGRESS_DEFAULTS) {
        const v = PROGRESS_DEFAULTS[k];
        save.set(k, typeof v === "object" ? {} : v);
    }
    save.save();
}

/**
 * Record a clear of level `idx` in `seconds`: best time, unlock the next
 * level, tutorial flags, and the shell high score (inverted time, higher is
 * better). Returns { newBest, score }.
 */
export function recordClear(save, idx, seconds) {
    const level = LEVELS[idx];
    const best = Object.assign({}, bestTimes(save));
    const prev = best[level.id];
    const newBest = prev == null || seconds < prev;
    if (newBest) {
        best[level.id] = seconds;
        save.set("best", best);
    }
    const unlock = Math.min(idx + 2, LEVELS.length);
    if (unlock > (save.get("unlocked") || 1)) save.set("unlocked", unlock);
    if (idx === 0) save.set("coachDone", true);
    if (idx === 1) save.set("plankCoachDone", true);
    const score = Math.max(0, Math.floor(100000 / Math.max(0.01, seconds)));
    save.maybeHighScore(score);
    save.save();
    return { newBest, score };
}

/** { cleared, gold, silver, bronze, unlocked, best } across the campaign. */
export function summary(save) {
    const best = bestTimes(save);
    const out = { cleared: 0, gold: 0, silver: 0, bronze: 0, unlocked: unlockedCount(save), best };
    for (const lv of LEVELS) {
        const t = best[lv.id];
        if (t == null) continue;
        out.cleared += 1;
        const m = medalFor(t, lv);
        if (m !== "none") out[m] += 1;
    }
    return out;
}
