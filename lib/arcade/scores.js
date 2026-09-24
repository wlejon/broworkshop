// Arcade — per-mode leaderboards kept in the game's save, plus the tabbed
// High Scores screen that shows them.
//
//   import { recordScore, createScoreTabs } from "/lib/arcade/scores.js";
//   recordScore(save, "hsClassic", { score, level, date: today() });
//
//   const board = createScoreTabs(save, [
//       { id: "classic", key: "hsClassic", format: (e) => e.score + "  Lv" + e.level },
//       { id: "timed",   key: "hsTimed",   format: (e) => e.score + "" },
//   ]);
//   onEnterScreen("highscores") -> board.show();   onMenuAction("hs-next") -> board.next();
//
// The screen's HTML lives in the game's index.html:
//   <div class="hs-tabs"><span id="hs-tab-classic" class="hs-tab">Classic</span> ...</div>
//   <div id="hs-list" class="stats-block"></div>
//   <div class="menu-item" data-action="hs-next">Next Tab</div>
// Declare each key in game.defaults (e.g. hsClassic: []) so save.load keeps it.

/**
 * Insert `entry` (with a numeric .score) into the top-`max` list stored at
 * save[key] and persist. Returns its 0-based rank, or -1 if it missed.
 * `compare` orders the list (default: highest .score first); pass e.g.
 * (a, b) => a.time - b.time for a fastest-time board.
 */
export function recordScore(save, key, entry, max = 10, compare = byScore) {
    const list = (save.get(key) || []).slice();
    list.push(entry);
    list.sort(compare);
    const kept = list.slice(0, max);
    save.set(key, kept);
    save.save();
    return kept.indexOf(entry);
}

function byScore(a, b) { return (b.score || 0) - (a.score || 0); }

/** Local date as YYYY-MM-DD. */
export function today() {
    try { return new Date().toISOString().slice(0, 10); }
    catch (e) { return "----"; }
}

/**
 * tabs: [{ id, key, format(entry, i) -> string, empty? }]. Renders the
 * active tab's list into #hs-list with right-aligned ranks and marks
 * #hs-tab-<id> active.
 */
export function createScoreTabs(save, tabs, opts = {}) {
    const listSel = opts.list || "#hs-list";
    let index = 0;

    function render() {
        const tab = tabs[index];
        for (let i = 0; i < tabs.length; i++) {
            const el = document.getElementById("hs-tab-" + tabs[i].id);
            if (el) el.className = i === index ? "hs-tab active" : "hs-tab";
        }
        const out = document.querySelector(listSel);
        if (!out) return;
        const list = save.get(tab.key) || [];
        if (!list.length) {
            out.textContent = tab.empty || "No scores yet";
            return;
        }
        out.textContent = list.map((e, i) => {
            const rank = (i < 9 ? " " : "") + (i + 1) + ".";
            return rank + " " + tab.format(e, i);
        }).join("\n");
    }

    return {
        /** First tab (or the tab with `id`), rendered. */
        show(id) {
            const i = id ? tabs.findIndex((t) => t.id === id) : 0;
            index = i >= 0 ? i : 0;
            render();
        },
        next() {
            index = (index + 1) % tabs.length;
            render();
        },
        current: () => tabs[index].id,
        render,
    };
}

/**
 * Game-over / level-clear stats as aligned "Label    value" lines for a
 * .stats-block. rows: [[label, value], ...]; falsy rows are skipped, so
 * optional lines can be written inline (cond && ["Combo", n]).
 *
 *   gameOverText(run) {
 *       return statsBlock([["Score", run.score + newBest(run)], ["Wave", run.wave], ["Best", api.highScore()]]);
 *   }
 */
export function statsBlock(rows) {
    const kept = rows.filter(Boolean);
    const width = Math.max(0, ...kept.map((r) => String(r[0]).length)) + 3;
    return kept.map((r) => String(r[0]).padEnd(width) + r[1]).join("\n");
}

/** "  ·  NEW BEST" when the shell just recorded this run as the high score. */
export function newBest(run) {
    return run && run._newBest ? "  ·  NEW BEST" : "";
}
