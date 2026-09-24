// Tumble DOM — HUD strips, piece palette, coach tips, toasts, and the
// title / level-select / complete screens. Structure lives in index.html;
// this only fills text and toggles classes.

import { PIECES } from "/app/pieces.js";
import { LEVELS, medalFor, fmt } from "/app/levels.js";
import { availablePieces } from "/app/board.js";
import * as progress from "/app/progress.js";

const $ = (id) => document.getElementById(id);

function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
}

// ── Coach ───────────────────────────────────────────────────────────────

/** Drop-In tips until coachDone, Plank Walk tips until plankCoachDone. */
const COACH = [
    {
        flag: "coachDone",
        tips: [
            "Gold spout drops marbles · green pad is the cup. Press Space to drop one in.",
            "Optional: click a green cell to place Blocks. Space rebuilds anytime.",
            "Clear this level to unlock puzzles that need a path.",
        ],
    },
    {
        flag: "plankCoachDone",
        tips: [
            "You must place pieces. Select Booster (key 6). Gold pads show a working path.",
            "Move mouse over a gold pad — green floor square means click to place.",
            "Place 2–3 boosters toward the cup, then press Space to drop.",
        ],
    },
];

function coachFor(run) {
    const c = COACH[run.levelIdx];
    return c && !run.save.get(c.flag) ? c : null;
}

/** Tip index for a fresh level: 0 with a coach, else past the end. */
export function beginCoach(run) {
    run.coachStep = coachFor(run) ? 0 : 99;
}

/**
 * Move the coach on: the first placement shows tip 2, a second placement
 * tip 3, and dropping marbles finishes the coach for good.
 */
export function advanceCoach(run, event, piecesUsed) {
    const c = coachFor(run);
    if (!c) return;
    if (event === "place" && run.coachStep === 0) run.coachStep = 1;
    else if (event === "place" && run.coachStep === 1 && piecesUsed >= 2) run.coachStep = 2;
    else if (event === "run" && run.coachStep <= 2) {
        run.coachStep = 3;
        run.save.set(c.flag, true);
        run.save.save();
    }
}

// ── HUD ─────────────────────────────────────────────────────────────────

/** Per-frame HUD state that is more than text: mode badge, action strip, piece help. */
export function syncHud(run) {
    const running = run.mode === "run";
    const mode = $("hud-mode");
    if (mode) mode.classList.toggle("run", running);

    const strip = $("hud-action");
    const kicker = $("hud-action-kicker");
    const text = $("hud-action-text");
    const c = coachFor(run);
    const coaching = !running && c && run.coachStep < c.tips.length;
    strip.classList.toggle("run-mode", running);
    strip.classList.toggle("coach-mode", !!coaching);
    if (running) {
        setText(kicker, "Running");
        setText(text, "First marble in the green cup wins. Press Space to rebuild.");
    } else if (coaching) {
        setText(kicker, "Tip " + (run.coachStep + 1) + " / " + c.tips.length);
        setText(text, c.tips[run.coachStep]);
    } else {
        const def = PIECES[run.build.selected];
        setText(kicker, "How to build");
        setText(text, run.placed.size === 0
            ? "Click a grid cell (green highlight) under the spout to place a " + (def ? def.label : "piece") + "."
            : "Green cell = can place. Right-click removes. Space drops marbles.");
    }

    const def = PIECES[run.build.selected];
    setText($("hud-piece-desc"), def
        ? def.label + ": click a green cell to place." + (def.rotatable ? " R rotates." : "")
        : "Pick a piece, then click a green cell on the floor.");
}

/** Rebuild the piece list on the left (selection, remaining counts). */
export function renderPalette(run) {
    const el = $("hud-palette");
    if (!el) return;
    el.textContent = "";
    for (const t of availablePieces(run)) {
        const def = PIECES[t];
        const b = run.budget[t];
        const left = b.limit - b.used;
        const item = document.createElement("div");
        item.className = "palette-item" + (t === run.build.selected ? " selected" : "") + (left <= 0 ? " disabled" : "");
        item.setAttribute("data-piece", t);
        item.appendChild(span("palette-key", def.key));
        const sw = span("palette-swatch", "");
        sw.style.background = def.color;
        sw.style.boxShadow = "0 0 6px " + def.color + "88";
        item.appendChild(sw);
        item.appendChild(span("palette-name", def.label));
        item.appendChild(span("palette-count", left + "/" + b.limit));
        el.appendChild(item);
    }
}

function span(cls, text) {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    return el;
}

/** Short-lived message under the top bar. */
export function toast(text, ms) {
    const area = $("hud-toast-area") || document.body;
    const el = document.createElement("div");
    el.className = "tumble-toast";
    el.textContent = text;
    area.appendChild(el);
    setTimeout(() => el.remove(), ms || 1600);
}

// ── Screens ─────────────────────────────────────────────────────────────

export function fillTitle(save) {
    const sum = progress.summary(save);
    const lv = LEVELS[progress.lastLevel(save)];
    if (sum.cleared === 0) {
        setText($("title-progress"), LEVELS.length + " levels · clear one to unlock the next");
    } else {
        const bits = [sum.cleared + " / " + LEVELS.length + " cleared"];
        for (const m of ["gold", "silver", "bronze"]) if (sum[m]) bits.push(sum[m] + " " + m);
        setText($("title-progress"), bits.join(" · "));
    }
    const resume = sum.cleared > 0 || progress.lastLevel(save) > 0;
    setText($("title-play"), (resume ? "Continue — " : "Play — ") + lv.name);
}

const MEDAL_LABEL = { gold: "Gold", silver: "Silver", bronze: "Bronze" };

/** Level-select tiles; unlocked tiles are .menu-item so the shell activates them. */
export function renderLevels(save) {
    const grid = $("levels-grid");
    if (!grid) return;
    const sum = progress.summary(save);
    const current = progress.lastLevel(save);
    setText($("levels-progress"),
        sum.cleared + " / " + LEVELS.length + " cleared · " + sum.unlocked + " unlocked" +
        (sum.gold ? " · " + sum.gold + " gold" : ""));
    grid.textContent = "";
    LEVELS.forEach((lv, i) => {
        const locked = i >= sum.unlocked;
        const best = sum.best[lv.id];
        const medal = best != null ? medalFor(best, lv) : "none";
        const tile = document.createElement("div");
        tile.className = "level-tile menu-item" + (locked ? " locked disabled" : "") +
            (i === current && !locked ? " current" : "");
        if (!locked) tile.setAttribute("data-action", "level-" + i);
        tile.appendChild(span("level-num", "Level " + (i + 1)));
        tile.appendChild(span("level-name", lv.name));
        tile.appendChild(span("level-tag", lv.tagline || ""));
        tile.appendChild(span("level-best", fmt(best)));
        tile.appendChild(span("level-medal medal-" + medal,
            MEDAL_LABEL[medal] || (locked ? "Locked" : "Open")));
        grid.appendChild(tile);
    });
}

export function fillComplete(run) {
    const t = (run.resultMs || 0) / 1000;
    const level = run.level;
    const medal = medalFor(t, level);
    const best = progress.bestTimes(run.save)[level.id];
    setText($("complete-title"), (MEDAL_LABEL[medal] || "Complete") + " — " + level.name);
    setText($("complete-time"), fmt(t));
    const medalEl = $("complete-medal");
    setText(medalEl, medal === "none" ? "Complete" : medal.toUpperCase());
    medalEl.className = "medal" + (medal === "none" ? "" : " " + medal);
    $("complete-newbest").hidden = !run.newBest;
    setText($("complete-detail"),
        "Par  gold " + fmt(level.par.gold) + " · silver " + fmt(level.par.silver) +
        " · bronze " + fmt(level.par.bronze) + "   ·   Best " + fmt(best));
    const primary = $("complete-primary");
    const last = run.levelIdx >= LEVELS.length - 1;
    // The extra Main Menu item only when the primary is not already one;
    // .disabled keeps the shell's keyboard menu off it while hidden.
    const menuItem = $("complete-menu-item");
    menuItem.hidden = last;
    menuItem.classList.toggle("disabled", last);
    if (last) {
        setText($("complete-next"), "Tour complete — every level unlocked.");
        setText(primary, "Main Menu");
        primary.setAttribute("data-action", "title");
    } else {
        const next = LEVELS[run.levelIdx + 1];
        setText($("complete-next"), "Next up: " + next.name + " — " + (next.tagline || ""));
        setText(primary, "Next Level");
        primary.setAttribute("data-action", "next");
    }
}
