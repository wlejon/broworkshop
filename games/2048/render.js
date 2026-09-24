// 2048 drawing — the board well, tiles, and the slide / merge / spawn
// animation built from what slide() reports. Reads the board, never changes it.

import { roundRect } from "/lib/arcade/draw.js";
import { SIZE, tilesOf } from "/app/rules.js";

export const MOVE_MS = 110;
export const POP_MS = 180;

const TILE_COLORS = {
    2:    { bg: "#eee4da", fg: "#776e65" },
    4:    { bg: "#ede0c8", fg: "#776e65" },
    8:    { bg: "#f2b179", fg: "#f9f6f2" },
    16:   { bg: "#f59563", fg: "#f9f6f2" },
    32:   { bg: "#f67c5f", fg: "#f9f6f2" },
    64:   { bg: "#f65e3b", fg: "#f9f6f2" },
    128:  { bg: "#edcf72", fg: "#f9f6f2" },
    256:  { bg: "#edcc61", fg: "#f9f6f2" },
    512:  { bg: "#edc850", fg: "#f9f6f2" },
    1024: { bg: "#edc53f", fg: "#f9f6f2" },
    2048: { bg: "#edc22e", fg: "#f9f6f2" },
};
const SUPER_COLORS = { bg: "#3c3a32", fg: "#f9f6f2" };
const FONT = "Helvetica, Arial, sans-serif";

export function layoutBoard(W, H) {
    const pad = 10, gap = 10, marginX = 40, top = 120, bottom = 48;
    const availH = H - top - bottom;
    const cell = Math.floor(Math.min(
        (W - marginX * 2 - pad * 2 - gap * (SIZE - 1)) / SIZE,
        (availH - pad * 2 - gap * (SIZE - 1)) / SIZE));
    const inner = cell * SIZE + gap * (SIZE - 1);
    return { cell, gap, pad, w: inner, h: inner, ox: Math.floor((W - inner) / 2), oy: Math.floor(top + (availH - inner) / 2) };
}

// ── Animation ────────────────────────────────────────────────────────────
// An animation is a list of { id, value, fromR, fromC, toR, toC, kind, delay }.

/** Every tile popping in (a fresh board). */
export function popIn(grid) {
    return tilesOf(grid).map((t) => ({ id: t.id, value: t.value, fromR: t.r, fromC: t.c, toR: t.r, toC: t.c, kind: "new" }));
}

/** From a slide() result: slides, then merges pop, then the new tile. */
export function slideAnim(result) {
    const anim = result.moved.filter((m) => m.kind !== "idle")
        .map((m) => (m.kind === "merge" ? Object.assign({ delay: MOVE_MS * 0.85 }, m) : m));
    const s = result.spawn;
    if (s) anim.push({ id: s.id, value: s.value, fromR: s.r, fromC: s.c, toR: s.r, toC: s.c, kind: "new", delay: MOVE_MS });
    for (const m of result.moved) if (m.kind === "idle") anim.push(m);   // non-movers stay drawn
    return anim;
}

export function animDuration(anim) {
    let max = MOVE_MS;
    for (const a of anim) max = Math.max(max, (a.delay || 0) + (a.kind === "new" || a.kind === "merge" ? POP_MS : MOVE_MS));
    return max;
}

const easeOutCubic = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

function visualTiles(grid, anim, t) {
    if (!anim) return tilesOf(grid).map((x) => ({ value: x.value, r: x.r, c: x.c, scale: 1 }));
    const out = [];
    for (const a of anim) {
        const local = t - (a.delay || 0);
        if (a.kind === "slide" || a.kind === "idle") {
            if (a.kind === "slide" && local > MOVE_MS) continue;       // merged away
            const u = a.kind === "idle" ? 1 : easeOutCubic(local / MOVE_MS);
            out.push({ value: a.value, r: a.fromR + (a.toR - a.fromR) * u, c: a.fromC + (a.toC - a.fromC) * u, scale: 1 });
        } else if (local >= 0) {
            const u = Math.min(1, local / POP_MS);
            const scale = a.kind === "merge"
                ? (u < 0.5 ? 1 + 0.18 * (u / 0.5) : 1.18 - 0.18 * ((u - 0.5) / 0.5))
                : (u < 0.6 ? (u / 0.6) * 1.1 : 1.1 - 0.1 * ((u - 0.6) / 0.4));
            out.push({ value: a.value, r: a.toR, c: a.toC, scale });
        }
    }
    return out;
}

// ── Drawing ──────────────────────────────────────────────────────────────

/** The playing screen: wordmark, well, tiles (animated when anim is set), key hint. */
export function drawBoard(ctx, w, h, grid, anim, animT) {
    const L = layoutBoard(w, h);
    ctx.fillStyle = "#faf8ef";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#776e65";
    ctx.font = "bold 42px " + FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("2048", L.ox, Math.max(16, L.oy - 72));

    drawWell(ctx, L, "#bbada0", "#cdc1b4");
    for (const tile of visualTiles(grid, anim, animT)) drawTile(ctx, L, tile);

    ctx.fillStyle = "#8f7a66";
    ctx.font = "12px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText("Arrow keys or WASD · U undo · R restart · Esc pause", w / 2, L.oy + L.h + L.pad + 16);
}

/** Title backdrop: a faded empty board. */
export function drawEmptyBoard(ctx, w, h) {
    ctx.fillStyle = "#faf8ef";
    ctx.fillRect(0, 0, w, h);
    drawWell(ctx, layoutBoard(w, h), "rgba(187,173,160,0.45)", "rgba(205,193,180,0.55)");
}

function drawWell(ctx, L, wellColor, cellColor) {
    roundRect(ctx, L.ox - L.pad, L.oy - L.pad, L.w + L.pad * 2, L.h + L.pad * 2, 8);
    ctx.fillStyle = wellColor;
    ctx.fill();
    ctx.fillStyle = cellColor;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            roundRect(ctx, L.ox + c * (L.cell + L.gap), L.oy + r * (L.cell + L.gap), L.cell, L.cell, 6);
            ctx.fill();
        }
    }
}

function fontSizeFor(value, cell) {
    if (value >= 1000) return Math.floor(cell * 0.32);
    if (value >= 100) return Math.floor(cell * 0.38);
    return Math.floor(cell * 0.46);
}

function drawTile(ctx, L, tile) {
    const x = L.ox + tile.c * (L.cell + L.gap);
    const y = L.oy + tile.r * (L.cell + L.gap);
    const cx = x + L.cell / 2, cy = y + L.cell / 2;
    const col = TILE_COLORS[tile.value] || SUPER_COLORS;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(tile.scale, tile.scale);
    ctx.translate(-cx, -cy);
    roundRect(ctx, x, y, L.cell, L.cell, 6);
    ctx.fillStyle = col.bg;
    ctx.fill();
    ctx.fillStyle = col.fg;
    ctx.font = "bold " + fontSizeFor(tile.value, L.cell) + "px " + FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tile.value), cx, cy + 1);
    ctx.restore();
}
