// Pegbounce menu screens: the level grid, the guide cards and the per-level
// best list. Tiles and cards are shell menu items (data-action level-N /
// guide-<id>), so arrows + Enter and clicks both go through onMenuAction.

import { Levels } from "/app/levels.js";
import { Guides } from "/app/guides.js";
import { starString } from "/app/rules.js";

/** Build the level tiles and guide cards once (from game.init). */
export function buildScreens() {
    const grid = document.getElementById("level-grid");
    grid.textContent = "";
    Levels.LEVELS.forEach((lv, i) => {
        const tile = el("div", "menu-item level-tile");
        tile.id = "level-tile-" + i;
        tile.setAttribute("data-action", "level-" + i);
        tile.append(el("div", "lt-num", String(i + 1)), el("div", "lt-name", lv.name),
            el("div", "lt-stars"), el("div", "lt-best"));
        grid.appendChild(tile);
    });

    const cards = document.getElementById("guide-cards");
    cards.textContent = "";
    for (const g of Guides.GUIDES) {
        const card = el("div", "menu-item guide-card");
        card.id = "guide-card-" + g.id;
        card.setAttribute("data-action", "guide-" + g.id);
        const icon = el("div", "gc-icon", g.icon);
        icon.style.color = g.color;
        card.append(icon, el("div", "gc-name", g.name), el("div", "gc-blurb", g.blurb));
        cards.appendChild(card);
    }
}

/** Locks, stars and bests from the save. */
export function refreshLevelGrid(save) {
    const unlocked = save.get("unlocked") || 1;
    const best = save.get("best") || {};
    const stars = save.get("stars") || {};
    Levels.LEVELS.forEach((lv, i) => {
        const tile = document.getElementById("level-tile-" + i);
        const locked = i >= unlocked;
        tile.classList.toggle("disabled", locked);
        tile.querySelector(".lt-stars").textContent = starString(stars[lv.id] || 0);
        tile.querySelector(".lt-best").textContent = best[lv.id] ? "Best " + best[lv.id] : locked ? "Locked" : "New";
    });
}

export function markGuide(id) {
    for (const g of Guides.GUIDES) {
        document.getElementById("guide-card-" + g.id).classList.toggle("chosen", g.id === id);
    }
}

export function renderBestList(save) {
    const out = document.getElementById("hs-list");
    const best = save.get("best") || {};
    const stars = save.get("stars") || {};
    const lines = [];
    Levels.LEVELS.forEach((lv, i) => {
        if (best[lv.id] == null) return;
        lines.push("L" + String(i + 1).padStart(2) + "  " + lv.name.padEnd(16) + "  " +
            String(best[lv.id]).padStart(7) + "   " + starString(stars[lv.id] || 0));
    });
    out.textContent = lines.length ? lines.join("\n") : "No scores yet. Clear a level to post a score.";
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
