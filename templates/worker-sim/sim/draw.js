// sim/draw.js — paints one frame buffer onto a 2D canvas (page side).

import { STRIDE, X, Y, VX, VY, HUE } from "./protocol.js";

const TRAIL = { boids: 'rgba(6, 9, 16, 0.4)', particles: 'rgba(6, 9, 16, 0.4)', gravity: 'rgba(5, 7, 14, 0.25)' };

/** Fade the last frame (motion trails), then draw `count` entities from `f`. */
export function drawFrame(ctx, w, h, f, count, mode) {
    ctx.fillStyle = TRAIL[mode] || TRAIL.boids;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
        const o = i * STRIDE, x = f[o + X], y = f[o + Y], hue = f[o + HUE] | 0;
        if (mode === 'boids') {
            const a = Math.atan2(f[o + VY], f[o + VX]), len = 7, back = len * 0.6;
            ctx.fillStyle = 'hsl(' + hue + ', 85%, 60%)';
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
            ctx.lineTo(x + Math.cos(a + 2.4) * back, y + Math.sin(a + 2.4) * back);
            ctx.lineTo(x + Math.cos(a - 2.4) * back, y + Math.sin(a - 2.4) * back);
            ctx.closePath();
            ctx.fill();
        } else {
            const r = mode === 'particles' ? 3 : 1.8;
            ctx.fillStyle = mode === 'particles' ? 'hsl(' + hue + ', 90%, 55%)' : 'hsl(' + hue + ', 100%, 65%)';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
