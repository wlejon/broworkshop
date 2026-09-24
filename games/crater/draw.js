// draw.js — Crater's 2D canvas: sky, terrain, tanks, the aim arc, the shell
// in flight, explosions and dust. World units map to the canvas with a fixed
// padding and the ground line at the bottom; y is up in the world.

import { C, heightAt, muzzleOrigin, launchVelocity } from "/app/shared.js";
import { hpColor } from "/app/ui.js";

const PAD = 40;
const AIM_STEP = 0.04;      // seconds per aim-arc segment
const AIM_SEGMENTS = 50;

function scaleOf(view) {
    return Math.min((view.width() - PAD * 2) / C.WORLD_W, (view.height() - PAD * 2) / (C.MAX_H + 15));
}

function mapper(view) {
    const s = scaleOf(view);
    const ox = (view.width() - C.WORLD_W * s) / 2, oy = view.height() - PAD;
    return { s, ox, oy, at: (wx, wy) => ({ x: ox + wx * s, y: oy - wy * s }) };
}

export function drawSky(ctx, view) {
    const g = ctx.createLinearGradient(0, 0, 0, view.height());
    g.addColorStop(0, "#1a2a55");
    g.addColorStop(0.6, "#3a3b5c");
    g.addColorStop(1.0, "#4f3a2c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.width(), view.height());
}

/** The whole match frame. `m` is the run's match view (see game.js). */
export function drawMatch(m, ctx, view) {
    const map = mapper(view);
    ctx.save();
    if (m.cameraShake > 0) {
        ctx.translate((Math.random() - 0.5) * m.cameraShake, (Math.random() - 0.5) * m.cameraShake);
    }
    drawSky(ctx, view);
    if (m.hm) {
        drawTerrain(m.hm, ctx, map);
        drawTanks(m, ctx, map);
        if (m.showAim) drawAim(m, ctx, map);
    }
    drawProjectile(m.projectile, ctx, map);
    drawExplosion(m.explosion, ctx, map);
    drawParticles(m.particles, ctx, map);
    ctx.restore();
}

function drawTerrain(hm, ctx, map) {
    const { s, ox, oy } = map;
    ctx.fillStyle = "#3a2e1d";
    ctx.strokeStyle = "#6d5a38";
    ctx.lineWidth = Math.max(1, s * 0.15);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    for (let i = 0; i < C.COLS; i++) ctx.lineTo(ox + (i + 0.5) * C.COL_W * s, oy - hm[i] * s);
    ctx.lineTo(ox + C.WORLD_W * s, oy);
    ctx.closePath();
    ctx.fill();
    // Grass cap, one strip per column.
    ctx.fillStyle = "#5a8a3e";
    const cap = Math.max(2, s * 0.4);
    for (let i = 0; i < C.COLS; i++) {
        const p = map.at(i * C.COL_W, hm[i]);
        ctx.fillRect(p.x, p.y - cap, C.COL_W * s + 1, cap);
    }
    ctx.stroke();
}

function drawTanks(m, ctx, map) {
    const { s } = map;
    const w = C.TANK_W * s, hgt = C.TANK_H * s;
    ctx.font = Math.max(10, s * 0.45) + 'px "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    for (const p of m.players) {
        if (!p.alive) continue;
        const c = map.at(p.x, heightAt(m.hm, p.x));
        ctx.fillStyle = p.color;
        ctx.fillRect(c.x - w / 2, c.y - hgt, w, hgt);
        ctx.beginPath();
        ctx.arc(c.x, c.y - hgt, w * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(c.x - w / 2, c.y - hgt - 10, w, 4);
        ctx.fillStyle = hpColor(p.hp);
        ctx.fillRect(c.x - w / 2, c.y - hgt - 10, w * (p.hp / C.HP_MAX), 4);
        ctx.fillStyle = "#fff";
        ctx.fillText(p.name + (p.id === m.turn ? " ◄" : ""), c.x, c.y - hgt - 14);
    }
    ctx.textAlign = "start";
}

/** Dashed preview of the shot the current aim would fire. */
function drawAim(m, ctx, map) {
    const me = m.players.find((p) => p.id === m.myId);
    if (!me || !me.alive) return;
    const o = muzzleOrigin(m.hm, me.x, m.aim.angle, m.aim.dir);
    const v = launchVelocity(m.aim.angle, m.aim.power, m.aim.dir);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const start = map.at(o.x, o.y);
    ctx.moveTo(start.x, start.y);
    let x = o.x, y = o.y, vy = v.vy;
    for (let i = 0; i < AIM_SEGMENTS; i++) {
        x += v.vx * AIM_STEP;
        y += vy * AIM_STEP;
        vy -= C.GRAVITY * AIM_STEP;
        const p = map.at(x, y);
        ctx.lineTo(p.x, p.y);
        if (x < 0 || x > C.WORLD_W || y < heightAt(m.hm, Math.max(0, Math.min(C.WORLD_W, x)))) break;
    }
    ctx.stroke();
    ctx.restore();
}

function drawProjectile(p, ctx, map) {
    if (!p) return;
    const c = map.at(p.x, p.y);
    ctx.fillStyle = "#fff5b0";
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(2, map.s * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 210, 90, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < p.trail.length; i += 2) {
        const t = map.at(p.trail[i], p.trail[i + 1]);
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
    }
    ctx.stroke();
}

function drawExplosion(e, ctx, map) {
    if (!e) return;
    const c = map.at(e.x, e.y);
    const r = Math.max(3, e.radius * map.s * (1 - e.t * 0.5));
    ctx.save();
    ctx.globalAlpha = 1 - e.t;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    g.addColorStop(0.0, "rgba(255, 240, 140, 1)");
    g.addColorStop(0.4, "rgba(255, 120, 30, 0.9)");
    g.addColorStop(1.0, "rgba(90, 30, 10, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawParticles(parts, ctx, map) {
    const size = 2 + map.s * 0.15;
    for (const p of parts) {
        const c = map.at(p.x, p.y);
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(c.x - 1, c.y - 1, size, size);
    }
    ctx.globalAlpha = 1;
}
