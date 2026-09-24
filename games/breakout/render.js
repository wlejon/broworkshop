// Breakout drawing — reads a court from rules.js, never changes it.

import { BRICK_TOP } from "/app/rules.js";

export function drawCourt(ctx, court, W, H) {
    // Ceiling rule under the HUD strip.
    ctx.strokeStyle = "#1a1a24";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, BRICK_TOP - 6);
    ctx.lineTo(W, BRICK_TOP - 6);
    ctx.stroke();

    for (const b of court.bricks) {
        if (!b.alive) continue;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(b.x, b.y, b.w, 3);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(b.x, b.y + b.h - 3, b.w, 3);
    }

    const p = court.paddle;
    ctx.fillStyle = "#ff9100";
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(p.x, p.y, p.w, 3);

    const ball = court.ball;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    if (ball.stuck) {
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "16px Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText("Click or press SPACE to launch", W / 2, H - 20);
    }
}
