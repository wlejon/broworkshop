// render.js — Clap Runner's neon city: gradient sky and sun, two parallax
// skylines, the grid road, pickups, obstacles and the runner, drawn in 960 x
// 540 world pixels. Also maps the runner's fx.emit kinds onto particle bursts.

import { seededRandom } from "/lib/arcade/random.js";
import { WORLD_W, WORLD_H, GROUND_Y } from "/app/runner.js";

/** Glowing disc particles (radius = size) for createEffects. */
export function glowDot(ctx, p) {
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, Math.PI * 2);
    ctx.fill();
}

const BURST = { drag: 1, spin: 0, gravity: 300, up: 0, lifeVar: 0 };

/** Runner emit kinds -> effects bursts (world pixels, ms). */
export function emit(fx, kind, x, y, color, count, speed) {
    if (kind === "jump") {
        fx.burst(x, y, color, count, Object.assign({}, BURST, {
            angle: Math.PI, arc: Math.PI * 0.8, speed: 80, speedVar: 180, life: 450, size: 2.5, sizeVar: 3,
        }));
    } else if (kind === "boom") {
        fx.burst(x, y, color, count, Object.assign({}, BURST, {
            speed: 90, speedVar: 260, life: 600, size: 3, sizeVar: 4,
        }));
    } else if (kind === "slide") {
        for (let i = 0; i < count; i++) {
            fx.burst(x - 15 + Math.random() * 10, y - 2, Math.random() > 0.5 ? "#ffea00" : "#ff5500", 1,
                Object.assign({}, BURST, {
                    angle: -Math.PI / 2, arc: 0, speed: 0, speedVar: 90,
                    vx: -speed * 0.6 - Math.random() * 120, life: 250, size: 2, sizeVar: 2,
                }));
        }
    } else if (kind === "thrust") {
        if (Math.random() >= 0.75) return;
        fx.burst(x + Math.random() * 8 - 4, y, Math.random() > 0.4 ? "#00e5ff" : "#00ffaa", 1,
            Object.assign({}, BURST, {
                angle: Math.PI / 2, arc: 0, speed: 40, speedVar: 50,
                vx: -speed * 0.4 - Math.random() * 60, life: 350, size: 3, sizeVar: 3,
            }));
    }
}

/** Two rows of buildings, fixed per session seed. */
export function makeBackdrop(seed) {
    const rand = seededRandom(seed || 7);
    const row = (wMin, wVar, hMin, hVar, gap) => {
        const out = [];
        for (let x = 0; x < WORLD_W * 2;) {
            const w = wMin + rand() * wVar;
            out.push({ x, w, h: hMin + rand() * hVar });
            x += w + gap;
        }
        return out;
    };
    return { far: row(50, 70, 140, 180, 8), mid: row(70, 90, 80, 120, 14) };
}

/** Sky, sun, skylines and road; `scroll` = runner.scroll offsets. */
export function drawBackdrop(ctx, backdrop, scroll) {
    const w = WORLD_W, h = WORLD_H;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#060612");
    sky.addColorStop(0.55, "#120b24");
    sky.addColorStop(1, "#230a38");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const sunX = w * 0.75, sunY = 170, sunR = 85;
    const sun = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, sunR);
    sun.addColorStop(0, "#ff007f");
    sun.addColorStop(0.7, "#ffea00");
    sun.addColorStop(1, "rgba(255, 0, 127, 0)");
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#120b24";
    for (let i = 0; i < 7; i++) ctx.fillRect(sunX - sunR, sunY + 15 + i * 10, sunR * 2, 1 + i * 0.9);

    for (const b of backdrop.far) {
        const bx = (b.x - scroll.far + w * 2) % (w * 2) - 50;
        ctx.fillStyle = "#1a1033";
        ctx.fillRect(bx, GROUND_Y - b.h, b.w, b.h);
        ctx.fillStyle = "#ff00aa33";
        for (let wy = GROUND_Y - b.h + 12; wy < GROUND_Y - 15; wy += 22) {
            for (let wx = bx + 8; wx < bx + b.w - 10; wx += 14) {
                if ((wx + wy) % 5 === 0) ctx.fillRect(wx, wy, 4, 8);
            }
        }
    }

    ctx.strokeStyle = "#00e5ff44";
    ctx.lineWidth = 2;
    for (const b of backdrop.mid) {
        const bx = (b.x - scroll.mid + w * 2) % (w * 2) - 50;
        ctx.fillStyle = "#261447";
        ctx.fillRect(bx, GROUND_Y - b.h, b.w, b.h);
        ctx.strokeRect(bx, GROUND_Y - b.h, b.w, b.h);
    }

    const ground = ctx.createLinearGradient(0, GROUND_Y, 0, h);
    ground.addColorStop(0, "#0c071a");
    ground.addColorStop(1, "#05020a");
    ctx.fillStyle = ground;
    ctx.fillRect(0, GROUND_Y, w, h - GROUND_Y);
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(w, GROUND_Y);
    ctx.stroke();
    ctx.strokeStyle = "#ff00aa33";
    ctx.lineWidth = 1.5;
    for (let gx = -(scroll.near % 40); gx < w; gx += 40) {
        ctx.beginPath();
        ctx.moveTo(gx, GROUND_Y);
        ctx.lineTo(gx - 60, h);
        ctx.stroke();
    }
}

/** Pickups, obstacles and (unless crashed) the runner. */
export function drawRun(ctx, run) {
    for (const it of run.pickups) drawPickup(ctx, it);
    for (const o of run.obstacles) drawObstacle(ctx, o);
    if (!run.crashed) drawPlayer(ctx, run.player);
}

function drawPickup(ctx, it) {
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    if (it.type === "COIN") {
        glow(ctx, "#ffea00", 12);
        ctx.beginPath();
        ctx.moveTo(0, -it.r);
        ctx.lineTo(it.r * 0.8, 0);
        ctx.lineTo(0, it.r);
        ctx.lineTo(-it.r * 0.8, 0);
        ctx.closePath();
        ctx.fill();
    } else if (it.type === "MULTIPLIER") {
        glow(ctx, "#00e5ff", 15);
        ctx.beginPath();
        ctx.arc(0, 0, it.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("2X", 0, 0);
    } else if (it.type === "SHIELD") {
        glow(ctx, "#ff00e5", 16);
        ctx.beginPath();
        ctx.arc(0, 0, it.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    ctx.restore();
}

function drawObstacle(ctx, o) {
    ctx.save();
    glow(ctx, o.color, 14);
    if (o.type === "SPIKE_BARRIER") {
        ctx.beginPath();
        ctx.moveTo(o.x, o.y + o.h);
        ctx.lineTo(o.x + o.w * 0.25, o.y);
        ctx.lineTo(o.x + o.w * 0.5, o.y + o.h);
        ctx.lineTo(o.x + o.w * 0.75, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h);
        ctx.closePath();
        ctx.fill();
    } else if (o.type === "HIGH_LASER") {
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(o.x + 4, o.y + 4, o.w - 8, o.h - 8);
    } else if (o.type === "PLASMA_TOWER") {
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x + 3, o.y + 3, o.w - 6, o.h - 6);
    } else {
        ctx.beginPath();
        ctx.arc(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff0055";
        ctx.fillRect(o.x + 12, o.y + o.h / 2 - 3, o.w - 24, 6);
    }
    ctx.restore();
}

/** Cyber runner: body, visor, legs, glider wing, shield ring; flickers while invincible. */
export function drawPlayer(ctx, p) {
    if (p.invincible > 0 && Math.floor(p.invincible * 14) % 2 === 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.shield) {
        ctx.strokeStyle = "#ff00e5";
        ctx.shadowColor = "#ff00e5";
        ctx.shadowBlur = 20;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -p.height / 2, p.height * 0.7, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (p.sliding) {
        glow(ctx, "#00e5ff", 12);
        ctx.fillRect(-26, -26, 52, 24);
        ctx.fillStyle = "#ffea00";
        ctx.fillRect(12, -22, 14, 6);
    } else {
        const leg = p.grounded ? Math.sin(p.runFrame * Math.PI) * 12 : 0;
        glow(ctx, "#00e5ff", 12);
        ctx.fillRect(-12, -p.height + 20, 24, 32);
        ctx.fillStyle = "#0a0d1e";
        ctx.fillRect(-9, -p.height, 18, 18);
        glow(ctx, "#ff007f", 10);
        ctx.fillRect(0, -p.height + 4, 11, 7);
        ctx.fillStyle = "#00e5ff";
        ctx.fillRect(-10, -p.height + 52, 8, 16 + leg);
        ctx.fillRect(2, -p.height + 52, 8, 16 - leg);
        if (p.gliding) {
            glow(ctx, "#00ffaa", 15);
            ctx.beginPath();
            ctx.moveTo(-12, -p.height + 25);
            ctx.lineTo(-35, -p.height + 15);
            ctx.lineTo(-12, -p.height + 35);
            ctx.closePath();
            ctx.fill();
        }
    }
    ctx.restore();
}

function glow(ctx, color, blur) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
}
