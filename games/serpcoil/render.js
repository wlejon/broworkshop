// Serpcoil drawing: starfield, the path trench, mouth and goal, the chain
// and the shooter. Screen-pixel coordinates throughout.

import { COLORS, ORB_DIAM } from "/app/chain.js";
import { PU } from "/app/shooter.js";

const GLYPH = { [PU.BACKTRACK]: "←", [PU.BLASTER]: "*", [PU.COLORSHIFT]: "~", [PU.SLOWMO]: "◷" };

const stars = [];
for (let i = 0; i < 80; i++) stars.push({ x: Math.random(), y: Math.random(), a: 0.2 + Math.random() * 0.4 });

export function drawStars(ctx, w, h) {
    ctx.fillStyle = "#6a4aa0";
    for (const s of stars) {
        ctx.globalAlpha = s.a;
        ctx.fillRect(s.x * w, s.y * h, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
}

export function drawCoil(ctx, coil) {
    const path = coil.path;
    drawTrench(ctx, path.samples);
    const m = path.pointAt(0);
    drawMouth(ctx, m.x, m.y);
    const g = path.pointAt(path.length());
    drawGoal(ctx, g.x, g.y, coil.danger, coil.clock);
    for (const o of coil.chain.orbs) {
        if (o.d < -ORB_DIAM * 0.5) continue;       // still in the mouth
        const p = path.pointAt(Math.max(0, o.d));
        drawOrb(ctx, p.x, p.y, o.color, o.phase);
    }
    drawShooter(ctx, coil.shooter);
}

function drawTrench(ctx, samples) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    samples.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
    ctx.strokeStyle = "rgba(70,40,120,0.35)";
    ctx.lineWidth = 50;
    ctx.stroke();
    ctx.strokeStyle = "rgba(16,10,32,0.9)";
    ctx.lineWidth = 36;
    ctx.stroke();
    ctx.strokeStyle = "rgba(100,60,180,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function drawMouth(ctx, x, y) {
    const grad = ctx.createRadialGradient(x, y, 6, x, y, 40);
    grad.addColorStop(0, "rgba(180,100,255,0.6)");
    grad.addColorStop(1, "rgba(180,100,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - 40, y - 40, 80, 80);
    ctx.fillStyle = "#1a0e2e";
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#9a56ff";
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawGoal(ctx, x, y, danger, clock) {
    const pulse = Math.sin(clock * 0.004 * (danger ? 6 : 2)) * 0.5 + 0.5;
    ctx.save();
    ctx.strokeStyle = danger ? "#ff5a5a" : "#ffd86b";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, 28 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = danger ? "#2a0a0a" : "#0a0618";
    ctx.fill();
    ctx.restore();
}

/** A chain orb; the highlight orbits with `phase` so the chain shimmers. */
function drawOrb(ctx, x, y, color, phase) {
    const c = COLORS[color];
    if (!c) return;
    const r = ORB_DIAM / 2;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.arc(x, y + 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.hex;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lighten(c.hex, 120);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(x + Math.cos(phase) * r * 0.4 - r * 0.25, y + Math.sin(phase) * r * 0.4 - r * 0.3, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
}

function drawShooter(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, 50);
    grad.addColorStop(0, "rgba(154,86,255,0.4)");
    grad.addColorStop(1, "rgba(154,86,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.rotate(s.aim);
    ctx.fillStyle = "#2a1a4a";
    ctx.strokeStyle = "#9a56ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-22, -18);
    ctx.lineTo(18, -10);
    ctx.lineTo(28, 0);
    ctx.lineTo(18, 10);
    ctx.lineTo(-22, 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1a0e2e";
    ctx.fillRect(22, -4, 10, 8);
    ctx.restore();

    ctx.fillStyle = "#1a0e2e";
    ctx.strokeStyle = "#9a56ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawShot(ctx, s.x, s.y, s.current, s.currentPU, 12);

    const back = s.backSlot();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#0a0618";
    ctx.beginPath();
    ctx.arc(back.x, back.y, 13, 0, Math.PI * 2);
    ctx.fill();
    drawShot(ctx, back.x, back.y, s.next, s.nextPU, 11);
    ctx.globalAlpha = 1;

    for (const p of s.projectiles) drawShot(ctx, p.x, p.y, p.color, p.pu, 14);
}

/** A loaded / flying orb, with its power-up glyph. */
function drawShot(ctx, x, y, color, pu, r) {
    const c = COLORS[color];
    if (!c) return;
    ctx.fillStyle = c.hex;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    if (GLYPH[pu]) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold " + Math.floor(r * 0.95) + "px Consolas, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(GLYPH[pu], x, y + 1);
    }
}

function lighten(hex, amt) {
    const ch = (i) => Math.min(255, parseInt(hex.slice(i, i + 2), 16) + amt);
    return "rgb(" + ch(1) + "," + ch(3) + "," + ch(5) + ")";
}
