// Canvas text at a "scale" (the old bitmap-font multiplier, ~9 px per unit),
// in sans-serif; bold from scale 4 up.

const fontFor = (scale) => (scale >= 4 ? "bold " : "") + Math.max(12, Math.round(scale * 9)) + "px sans-serif";

function put(ctx, text, x, y, scale, color, align, baseline) {
    ctx.save();
    ctx.font = fontFor(scale);
    ctx.fillStyle = color || "#fff";
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, x, y);
    ctx.restore();
}

export const Text = {
    /** Top-left anchored. */
    draw: (ctx, text, x, y, scale, color) => put(ctx, text, x, y, scale, color, "left", "top"),
    /** Centred on (x, y). */
    drawCentered: (ctx, text, x, y, scale, color) => put(ctx, text, x, y, scale, color, "center", "middle"),
    /** Right edge at x, top at y. */
    drawRight: (ctx, text, x, y, scale, color) => put(ctx, text, x, y, scale, color, "right", "top"),
};
