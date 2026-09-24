// Touchdown drawing — stars, terrain and pads, the lander and its flame,
// the landed / crashed banner, and the drifting title backdrop.

import { LANDER_W as LW, LANDER_H as LH } from "/app/rules.js";

const MONO = "Consolas, monospace";

export function createStars(W, H) {
    const s = [];
    for (let i = 0; i < 60; i++) s.push({ x: Math.random() * W, y: Math.random() * H * 0.75, b: 0.2 + Math.random() * 0.6 });
    return s;
}

/** The world (under the shake offset); fx draws between terrain and lander. */
export function drawWorld(ctx, m, stars, fx) {
    ctx.fillStyle = "#ffffff";
    for (const s of stars) {
        ctx.globalAlpha = s.b;
        ctx.fillRect(s.x, s.y, 1, 1);
    }
    ctx.globalAlpha = 1;
    drawTerrain(ctx, m.terrain);
    if (fx) fx.draw(ctx);
    if (m.status !== "crashed") drawLander(ctx, m.lander);
}

/** TOUCHDOWN / CRASHED banner, unshaken. */
export function drawBanner(ctx, m, W, H) {
    if (m.status === "flying") return;
    ctx.textAlign = "center";
    ctx.font = "bold 22px " + MONO;
    if (m.status === "landed") {
        ctx.fillStyle = "#66ff99";
        ctx.fillText("TOUCHDOWN  +" + m.lastBonus, W * 0.5, H * 0.28);
        return;
    }
    ctx.fillStyle = "#ff5555";
    ctx.fillText("CRASHED", W * 0.5, H * 0.28);
    if (m.reasons.length) {
        ctx.font = "12px " + MONO;
        ctx.fillStyle = "#aa8888";
        ctx.fillText(m.reasons.join(" · "), W * 0.5, H * 0.28 + 20);
    }
}

function drawTerrain(ctx, terrain) {
    const pts = terrain.points;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.font = "11px " + MONO;
    ctx.textAlign = "center";
    for (const p of terrain.pads) {
        ctx.strokeStyle = "#66ff99";
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y);
        ctx.lineTo(p.x2, p.y);
        ctx.stroke();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = "#66ff99";
        ctx.fillText("+" + p.bonus, (p.x1 + p.x2) * 0.5, p.y - 6);
        ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1;
}

function drawLander(ctx, L) {
    ctx.save();
    ctx.translate(L.x, L.y);
    ctx.rotate(L.angle);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();                                   // cabin
    ctx.moveTo(0, -LH * 0.6);
    ctx.lineTo(-LW * 0.5, -LH * 0.1);
    ctx.lineTo(-LW * 0.5, LH * 0.35);
    ctx.lineTo(LW * 0.5, LH * 0.35);
    ctx.lineTo(LW * 0.5, -LH * 0.1);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();                                   // legs and feet
    ctx.moveTo(-LW * 0.5, LH * 0.35);
    ctx.lineTo(-LW * 0.85, LH * 0.6);
    ctx.moveTo(LW * 0.5, LH * 0.35);
    ctx.lineTo(LW * 0.85, LH * 0.6);
    ctx.moveTo(-LW, LH * 0.6);
    ctx.lineTo(-LW * 0.7, LH * 0.6);
    ctx.moveTo(LW * 0.7, LH * 0.6);
    ctx.lineTo(LW, LH * 0.6);
    ctx.stroke();
    if (L.thrusting) {                                 // flickering flame
        const flicker = 0.6 + Math.random() * 0.8;
        ctx.strokeStyle = "#ffaa44";
        ctx.beginPath();
        ctx.moveTo(-LW * 0.25, LH * 0.35);
        ctx.lineTo(0, LH * 0.35 + 10 * flicker);
        ctx.lineTo(LW * 0.25, LH * 0.35);
        ctx.stroke();
    }
    ctx.restore();
}

// ── Title backdrop: falling stars and faint landers ──────────────────────

const title = { stars: [], landers: [], w: 0, h: 0 };

function seedTitle(W, H) {
    title.w = W;
    title.h = H;
    title.stars = [];
    for (let i = 0; i < 120; i++) {
        title.stars.push({ x: Math.random() * W, y: Math.random() * H, b: 0.15 + Math.random() * 0.7, drift: 0.005 + Math.random() * 0.02 });
    }
    title.landers = [];
    for (let j = 0; j < 3; j++) {
        title.landers.push({
            x: Math.random() * W, y: 80 + Math.random() * H * 0.5,
            vx: (Math.random() - 0.5) * 0.05, vy: 0.02 + Math.random() * 0.03,
            ang: (Math.random() - 0.5) * 0.4, alpha: 0.12 + Math.random() * 0.15,
        });
    }
}

export function drawTitleBackdrop(ctx, W, H, dt) {
    if (!title.stars.length || title.w !== W || title.h !== H) seedTitle(W, H);
    dt = Math.min(50, dt);
    for (const s of title.stars) {
        s.y += s.drift * dt;
        if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    }
    for (const L of title.landers) {
        L.x += L.vx * dt;
        L.y += L.vy * dt;
        if (L.y > H + 20) { L.y = -20; L.x = Math.random() * W; }
        if (L.x < -20) L.x = W + 20;
        if (L.x > W + 20) L.x = -20;
    }

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    for (const s of title.stars) {
        ctx.globalAlpha = s.b;
        ctx.fillRect(s.x, s.y, 1, 1);
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    for (const L of title.landers) {
        ctx.globalAlpha = L.alpha;
        ctx.save();
        ctx.translate(L.x, L.y);
        ctx.rotate(L.ang);
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(-7, -2);
        ctx.lineTo(-7, 5);
        ctx.lineTo(7, 5);
        ctx.lineTo(7, -2);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }
    ctx.globalAlpha = 1;
}
