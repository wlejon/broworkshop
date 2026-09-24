// paint.js — small canvas helpers shared by Fintank's drawing code.

/** Lighten (pct > 0) or darken (pct < 0) a #rrggbb colour; returns rgb(). */
export function shade(hex, pct) {
    const c = hex.replace("#", "");
    const ch = (i) => {
        const x = parseInt(c.substr(i, 2), 16);
        return Math.max(0, Math.min(255, Math.round(x + (pct > 0 ? 255 - x : x) * pct)));
    };
    return "rgb(" + ch(0) + "," + ch(2) + "," + ch(4) + ")";
}

/** Text centred on (x, y) in an 18px sans (float-up labels, alerts). */
export function centeredText(ctx, text, x, y, color) {
    ctx.save();
    ctx.font = "18px sans-serif";
    ctx.fillStyle = color || "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
}

/** Filled circle. */
export function dot(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

/** Filled closed polygon from [x, y] pairs. */
export function poly(ctx, color, points) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
}
