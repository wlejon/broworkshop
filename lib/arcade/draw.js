// Arcade — small 2D canvas drawing helpers shared by the canvas games.
//
//   import { roundRect, mixColor } from "/lib/arcade/draw.js";
//   roundRect(ctx, x, y, w, h, 12); ctx.fill();
//   ctx.fillStyle = mixColor("#7a1f22", "#ff8a8f", glow);

/** Rounded-rectangle path (radius clamped to half the shorter side). Fill or stroke it after. */
export function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** Blend two "#rrggbb" colours; t 0 -> a, 1 -> b. Returns a CSS colour. */
export function mixColor(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) + ((((pb >> s) & 255) - ((pa >> s) & 255)) * t));
    return "rgb(" + ch(16) + "," + ch(8) + "," + ch(0) + ")";
}
