// Pegbounce drawing — the playfield in field coordinates (1024 x 768),
// letterboxed into the canvas by fieldFit.

import { Physics } from "/app/physics.js";
import { PEG_COLORS } from "/app/round.js";

const FIELD_W = Physics.FIELD_W;
const FIELD_H = Physics.FIELD_H;

/** Scale + offset that fits the field inside a w x h canvas. */
export function fieldFit(w, h) {
    const scale = Math.min(w / FIELD_W, h / FIELD_H);
    return { scale, offX: (w - FIELD_W * scale) / 2, offY: (h - FIELD_H * scale) / 2 };
}

/** Canvas pixel -> field coordinate. */
export function toField(fit, x, y) {
    return { x: (x - fit.offX) / fit.scale, y: (y - fit.offY) / fit.scale };
}

/**
 * Whole frame: background, pegs, balls, cannon; then `overlay(ctx)` (the
 * effects layer) still in field space. `shake` = {x, y} px.
 */
export function drawRound(ctx, w, h, round, opts) {
    const fit = fieldFit(w, h);
    ctx.fillStyle = "#04060c";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(fit.offX + opts.shake.x, fit.offY + opts.shake.y);
    ctx.scale(fit.scale, fit.scale);

    drawBackground(ctx, round.level.background, round.clock);
    drawCannonBand(ctx);
    drawDots(ctx, round.previewPath(opts.trajectory));
    for (const p of round.world.pegs) drawPeg(ctx, p, round.clock);
    drawPulses(ctx, round.world.pulses);
    for (const b of Physics.activeBalls(round.world)) drawBall(ctx, b);
    drawCatchbar(ctx, round.world.catchbar);
    drawCannon(ctx, round);
    if (opts.overlay) opts.overlay(ctx);

    ctx.restore();
}

/** Title backdrop: level 1's gradient with drifting motes. */
export function drawTitleField(ctx, w, h, background, t) {
    const fit = fieldFit(w, h);
    ctx.fillStyle = "#04060c";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(fit.offX, fit.offY);
    ctx.scale(fit.scale, fit.scale);
    drawBackground(ctx, background, t);
    ctx.restore();
}

function drawBackground(ctx, [top, bottom], t) {
    const grad = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    const vignette = ctx.createRadialGradient(FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.3, FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.9);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    for (let i = 0; i < 40; i++) {
        const x = (i * 193) % FIELD_W;
        const y = (i * 89 + Math.sin(t + i) * 6) % FIELD_H;
        ctx.fillStyle = "rgba(255,255,255," + (0.03 + (i % 3) * 0.02) + ")";
        ctx.fillRect(x, y, 2, 2);
    }
}

function drawCannonBand(ctx) {
    ctx.fillStyle = "rgba(8, 12, 26, 0.85)";
    ctx.fillRect(0, 0, FIELD_W, Physics.FIELD_TOP);
    ctx.strokeStyle = "#23306a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Physics.FIELD_TOP);
    ctx.lineTo(FIELD_W, Physics.FIELD_TOP);
    ctx.stroke();
}

function drawDots(ctx, pts) {
    for (let i = 0; i < pts.length; i++) {
        const a = 1 - i / pts.length;
        ctx.fillStyle = "rgba(255,255,255," + (a * 0.6).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function glow(ctx, x, y, r, rgb, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(" + rgb + "," + alpha + ")");
    g.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawPeg(ctx, p, t) {
    if (p.removed) return;
    const col = PEG_COLORS[p.type] || "#eee";
    const r = Physics.PEG_RADIUS;
    if (p.type === "orange" && !p.lit) glow(ctx, p.x, p.y, r * 3 * (1 + Math.sin(t * 5 + p.phase) * 0.06), "255,170,60", 0.45);
    else if (p.type === "green" && !p.lit) glow(ctx, p.x, p.y, r * 2.4, "90,230,100", 0.4);

    const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 1, p.x, p.y, r);
    g.addColorStop(0, shade(col, 0.4));
    g.addColorStop(1, shade(col, -0.25));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.arc(p.x - r * 0.35, p.y - r * 0.35, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    if (p.lit) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

function drawBall(ctx, b) {
    const r = b.radius;
    // Motion trail
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#fff";
    for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        ctx.beginPath();
        ctx.arc(b.x - b.vx * t * 0.03, b.y - b.vy * t * 0.03, r * (1 - t * 0.6), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + r + 2, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const g = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, 1, b.x, b.y, r);
    g.addColorStop(0, shade(b.onFire ? "#ff6833" : "#eaf1ff", 0.4));
    g.addColorStop(1, b.onFire ? "#ff3300" : "#6a7698");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (b.onFire) {
        const ring = ctx.createRadialGradient(b.x, b.y, r, b.x, b.y, 42);
        ring.addColorStop(0, "rgba(255,150,60,0.5)");
        ring.addColorStop(1, "rgba(255,150,60,0)");
        ctx.fillStyle = ring;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 42, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPulses(ctx, pulses) {
    for (const pw of pulses) {
        const t = Math.min(1, pw.age / pw.duration);
        const r = Math.max(1, t * pw.R);
        const a = 1 - t;
        const g = ctx.createRadialGradient(pw.cx, pw.cy, 0, pw.cx, pw.cy, r);
        g.addColorStop(0, "rgba(140,255,150,0)");
        g.addColorStop(0.7, "rgba(140,255,150," + 0.18 * a + ")");
        g.addColorStop(1, "rgba(140,255,150," + 0.35 * a + ")");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pw.cx, pw.cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(180,255,180," + 0.9 * a + ")";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(pw.cx, pw.cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawCatchbar(ctx, cb) {
    const x = cb.x - cb.halfW, y = cb.y, w = cb.halfW * 2, h = Physics.CATCHBAR_H;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#ffd870");
    g.addColorStop(1, "#b8740e");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x, y + h - 3, w, 3);
}

function drawCannon(ctx, round) {
    const { x, y } = round.cannon;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#1a2747";
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a5299";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.rotate(round.aimAngle);
    ctx.fillStyle = "#c5cde2";
    ctx.fillRect(0, -6, 30, 12);
    ctx.fillStyle = "#8a95b5";
    ctx.fillRect(0, 3, 30, 3);
    ctx.restore();
    if (round.canLaunch()) {
        ctx.fillStyle = "#eaf1ff";
        ctx.beginPath();
        ctx.arc(x + Math.cos(round.aimAngle) * 28, y + Math.sin(round.aimAngle) * 28, 7, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** Lighten (f > 0) toward white or darken (f < 0) toward black. */
function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => {
        const out = f >= 0 ? v + (255 - v) * f : v * (1 + f);
        return Math.max(0, Math.min(255, out | 0)).toString(16).padStart(2, "0");
    };
    return "#" + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
}
