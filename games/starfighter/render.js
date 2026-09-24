// render.js — draws a Flight through a camera: sector backdrop, enemies
// back to front, bolts, explosions, cockpit frame, reticle, damage flash.
// Plus the title-screen star tunnel.

import { WAVES } from "/app/waves.js";
import { drawEnemy } from "/app/enemies.js";
import { RETICLE_Z, PARALLAX } from "/app/flight.js";

/** Everything for one frame of play. `stars` is the space backdrop. */
export function drawFlight(ctx, cam, stars, flight) {
    const W = cam.width(), H = cam.height();
    cam.setParallax(flight.ship.x * PARALLAX, flight.ship.y * PARALLAX);
    WAVES[flight.ws.kind].draw(ctx, cam, flight.ws, stars);

    ctx.lineWidth = 1.5;
    const far = flight.enemies.slice().sort((a, b) => b.z - a.z);
    for (const e of far) drawEnemy(ctx, cam, e);

    drawEnemyBolts(ctx, cam, flight.enemyBolts);
    drawPlayerBolts(ctx, cam, flight.playerBolts);
    drawExplosions(ctx, cam, flight.explosions);
    drawCockpit(ctx, W, H);
    drawReticle(ctx, cam, flight);
    cam.drawFlash(ctx);
}

function drawEnemyBolts(ctx, cam, bolts) {
    const trail = 12;
    for (const b of bolts) {
        cam.line(ctx, b.x, b.y, b.z, b.x - b.vx * trail, b.y - b.vy * trail, b.z - b.vz * trail, b.color, 1);
    }
}

/** A streak whose head outruns its tail along wingtip -> reticle. */
function drawPlayerBolts(ctx, cam, bolts) {
    for (const b of bolts) {
        const u = b.t / b.life;
        const head = Math.min(1, u * 2.2);
        const tail = Math.max(0, head - 0.35);
        const at = (s) => [b.ox + (b.tx - b.ox) * s, b.oy + (b.ty - b.oy) * s, b.oz + (b.tz - b.oz) * s];
        const [hx, hy, hz] = at(head);
        const [tx, ty, tz] = at(tail);
        cam.line(ctx, hx, hy, hz, tx, ty, tz, b.color, 1 - u * 0.4);
    }
}

function drawExplosions(ctx, cam, explosions) {
    for (const e of explosions) {
        const u = e.t / e.life;
        const c = u < 0.3 ? "#ff8" : (u < 0.7 ? "#f84" : "#844");
        for (const s of e.shards) {
            const ax = e.x + s.vx * e.t, ay = e.y + s.vy * e.t, az = e.z + s.vz * e.t;
            cam.line(ctx, ax, ay, az, ax - s.vx * 40, ay - s.vy * 40, az - s.vz * 40, c, 1 - u);
        }
    }
}

/** Four green corner brackets. */
function drawCockpit(ctx, W, H) {
    const inset = 18, len = 90;
    ctx.strokeStyle = "#3a4";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1]]) {
        ctx.moveTo(x, y + sy * len);
        ctx.lineTo(x, y);
        ctx.lineTo(x + sx * len, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
}

/** Yellow crosshair where the yoke points; blue chevron where the ship is. */
function drawReticle(ctx, cam, flight) {
    const pr = cam.projectHud(flight.reticle.x, flight.reticle.y, RETICLE_Z);
    const ps = cam.projectHud(flight.ship.x, flight.ship.y, RETICLE_Z);
    ctx.strokeStyle = "#ff4";
    ctx.lineWidth = 2;
    const { x, y } = pr;
    ctx.beginPath();
    ctx.moveTo(x - 18, y); ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y); ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 18);
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#6bf";
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(ps.x, ps.y + 4);
    ctx.lineTo(ps.x - 5, ps.y + 10);
    ctx.lineTo(ps.x + 5, ps.y + 10);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// ── Title star tunnel ─────────────────────────────────────────────────────

/** Stars rushing out of the centre; call tick(dt) then draw each frame. */
export function createTunnel(rand = Math.random) {
    const stars = [];
    const reset = (s, z) => {
        s.x = rand() * 2 - 1;
        s.y = rand() * 2 - 1;
        s.z = z;
        s.s = 0.3 + rand() * 0.9;
        return s;
    };
    for (let i = 0; i < 200; i++) stars.push(reset({}, 0.2 + rand() * 0.8));

    return {
        tick(dt) {
            const adv = 0.00015 * Math.min(50, dt);
            for (const s of stars) {
                s.z -= adv;
                if (s.z <= 0.05) reset(s, 1.0);
            }
        },
        draw(ctx, W, H) {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = "#fff";
            for (const s of stars) {
                const scale = 1 / s.z;
                const px = W * 0.5 + s.x * W * 0.5 * scale;
                const py = H * 0.5 + s.y * H * 0.5 * scale;
                if (px < 0 || px >= W || py < 0 || py >= H) continue;
                ctx.globalAlpha = Math.min(1, (1 - s.z) * 1.4);
                const sz = Math.max(1, (s.s * (2 - s.z)) | 0);
                ctx.fillRect(px | 0, py | 0, sz, sz);
            }
            ctx.globalAlpha = 1;
        },
    };
}
