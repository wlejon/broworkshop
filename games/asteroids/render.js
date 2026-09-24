// Asteroids drawing — vector outlines on a wrapping field, plus the drifting
// title backdrop. Reads a field from rules.js, never changes it.

import { rockShape } from "/app/rules.js";

const SHIP_SHAPE = [{ x: 14, y: 0 }, { x: -10, y: -9 }, { x: -6, y: 0 }, { x: -10, y: 9 }];
const FLAME_SHAPE = [{ x: -6, y: -4 }, { x: -14, y: 0 }, { x: -6, y: 4 }];

export function drawField(ctx, field) {
    const W = field.W, H = field.H;
    for (const a of field.rocks) {
        drawWrapped(W, H, a.radius + 2, a.x, a.y, (x, y) => polygon(ctx, a.shape, x, y, a.rot, true, "#ffffff", 1.5));
    }
    ctx.fillStyle = "#ffffff";
    for (const b of field.bullets) ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);

    const s = field.ship;
    if (s.alive) drawWrapped(W, H, 20, s.x, s.y, (x, y) => drawShip(ctx, s, x, y, field.invuln));
}

function drawShip(ctx, s, x, y, invuln) {
    if (invuln > 0 && Math.floor(invuln / 100) % 2 === 0) return;     // spawn blink
    polygon(ctx, SHIP_SHAPE, x, y, s.angle, true, "#ffffff", 1.5);
    if (s.thrusting && Math.random() < 0.7) polygon(ctx, FLAME_SHAPE, x, y, s.angle, false, "#ff9933", 1.5);
}

/** Stroke `pts` rotated by rot around (x, y). */
function polygon(ctx, pts, x, y, rot, close, stroke, lineWidth) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const px = x + p.x * c - p.y * s;
        const py = y + p.x * s + p.y * c;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    if (close) ctx.closePath();
    ctx.stroke();
}

/** Draw at (x, y) plus the mirrored copies needed near an edge. */
function drawWrapped(W, H, radius, x, y, draw) {
    draw(x, y);
    const ox = x < radius ? W : x > W - radius ? -W : 0;
    const oy = y < radius ? H : y > H - radius ? -H : 0;
    if (ox) draw(x + ox, y);
    if (oy) draw(x, y + oy);
    if (ox && oy) draw(x + ox, y + oy);
}

// ── Title backdrop: a few faint rocks drifting ───────────────────────────

export function createTitleRocks(W, H) {
    const rocks = [];
    for (let i = 0; i < 8; i++) {
        const radius = 18 + Math.random() * 30;
        const a = Math.random() * Math.PI * 2;
        const sp = 0.02 + Math.random() * 0.04;
        rocks.push({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.0008,
            radius,
            shape: rockShape(radius),
            alpha: 0.15 + Math.random() * 0.15,
        });
    }
    return rocks;
}

export function drawTitleRocks(ctx, rocks, W, H, dt) {
    const step = Math.min(50, dt || 16);
    for (const a of rocks) {
        a.x += a.vx * step;
        a.y += a.vy * step;
        a.rot += a.rotSpeed * step;
        if (a.x < -a.radius) a.x = W + a.radius;
        else if (a.x > W + a.radius) a.x = -a.radius;
        if (a.y < -a.radius) a.y = H + a.radius;
        else if (a.y > H + a.radius) a.y = -a.radius;
        ctx.globalAlpha = a.alpha;
        polygon(ctx, a.shape, a.x, a.y, a.rot, true, "#ffffff", 1);
    }
    ctx.globalAlpha = 1;
}
