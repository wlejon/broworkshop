// Echo drawing — four rounded pads in a 2x2 board that glow as they sound.

import { roundRect, mixColor } from "/lib/arcade/draw.js";

export const PAD_COLORS = [
    { dim: "#7a1f22", lit: "#ff5a5f", glow: "#ff8a8f" },
    { dim: "#1f6f2a", lit: "#4ade80", glow: "#86f0b0" },
    { dim: "#7a6520", lit: "#f0c674", glow: "#ffe0a0" },
    { dim: "#1f3a7a", lit: "#5b8def", glow: "#9abbff" },
];

const MARGIN = 60, GAP = 16, TOP = 120, BOTTOM = 40;

export function padRect(i, w, h) {
    const padW = (w - MARGIN * 2 - GAP) / 2;
    const padH = (h - TOP - BOTTOM - GAP) / 2;
    return { x: MARGIN + (i % 2) * (padW + GAP), y: TOP + Math.floor(i / 2) * (padH + GAP), w: padW, h: padH };
}

/** Pad under (x, y), or -1. */
export function padAt(x, y, w, h) {
    for (let i = 0; i < 4; i++) {
        const r = padRect(i, w, h);
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return -1;
}

export function drawPads(ctx, glow, w, h) {
    for (let i = 0; i < 4; i++) drawPad(ctx, padRect(i, w, h), PAD_COLORS[i], glow[i]);
}

function drawPad(ctx, r, col, glow) {
    ctx.fillStyle = mixColor(col.dim, col.glow, glow);
    roundRect(ctx, r.x, r.y, r.w, r.h, 24);
    ctx.fill();
    if (glow > 0.02) {
        ctx.save();
        ctx.globalAlpha = glow * 0.5;
        ctx.strokeStyle = col.glow;
        ctx.lineWidth = 6;
        roundRect(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 26);
        ctx.stroke();
        ctx.restore();
    }
    ctx.strokeStyle = "#0a0e14";
    ctx.lineWidth = 4;
    roundRect(ctx, r.x, r.y, r.w, r.h, 24);
    ctx.stroke();
}
