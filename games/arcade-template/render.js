// Template drawing — reads the state from rules.js, never changes it.

export function drawField(ctx, field, w, h) {
    drawGrid(ctx, w, h);

    const size = Math.min(w, h) * 0.08;
    const x = field.x * w - size / 2;
    const y = field.y * h - size / 2;
    ctx.fillStyle = "#7ec8e3";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.fillRect(x, y, size, 3);

    ctx.fillStyle = "rgba(232, 238, 242, 0.55)";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Replace rules.js / render.js with your game", w / 2, h * 0.18);
    ctx.fillText("Space  +1 score   ·   auto game-over at 45s", w / 2, h * 0.18 + 22);
}

/** Soft grid so the playfield reads as intentional (also the title backdrop). */
export function drawGrid(ctx, w, h) {
    ctx.strokeStyle = "rgba(126, 200, 227, 0.06)";
    ctx.lineWidth = 1;
    const step = 48;
    ctx.beginPath();
    for (let gx = 0; gx < w; gx += step) {
        ctx.moveTo(gx + 0.5, 0);
        ctx.lineTo(gx + 0.5, h);
    }
    for (let gy = 0; gy < h; gy += step) {
        ctx.moveTo(0, gy + 0.5);
        ctx.lineTo(w, gy + 0.5);
    }
    ctx.stroke();
}
