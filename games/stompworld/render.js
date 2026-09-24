// Stompworld drawing shared by live play, the training replay and the AI
// demo. Everything is in the fixed 800×576 virtual view (game.js letterboxes
// it into the canvas); world objects draw relative to a Camera2D.

import { Camera2D } from "/lib/camera2d.js";
import { Art } from "/app/art.js";
import { VIEW_W, VIEW_H, BEAM_THICKNESS } from "/app/rules.js";

/** Side-scrolling camera over a level; follow(heroCenterX, VIEW_H / 2). */
export function createCamera(tilemap) {
    return Camera2D.create({
        viewW: VIEW_W, viewH: VIEW_H,
        levelW: tilemap.widthPx, levelH: tilemap.heightPx,
        deadzoneW: 120, deadzoneH: 1024,
    });
}

/** Keep the camera on a body (vertically the view is fixed). */
export function followBody(cam, p, snap = false) {
    if (snap) cam.snapTo(p.x + p.w / 2, VIEW_H / 2);
    else cam.follow(p.x + p.w / 2, VIEW_H / 2);
}

export const SKY_TOP = "#6cb0f0";
export const SKY_BOTTOM = "#a8d4f8";

export function drawSky(ctx, w = VIEW_W, h = VIEW_H) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(1, SKY_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
}

/** Hero sprite frame: 0 idle, 1-2 run cycle, 3 airborne. */
export function heroFrame(p, tick) {
    if (!p.onGround) return 3;
    if (Math.abs(p.vx) > 8) return 1 + (((tick / 8) | 0) % 2);
    return 0;
}

/**
 * The level and everything in it. `w` = { tilemap, flag, pickup (null when
 * collected / hidden), pickupT, stompers, flyers, hero, heroTick }.
 */
export function drawWorld(ctx, cam, w) {
    w.tilemap.draw(ctx, cam.x, cam.y, VIEW_W, VIEW_H);
    if (w.flag) Art.drawFlag(ctx, w.flag.x - cam.x, w.flag.y - cam.y);
    if (w.pickup) Art.drawPickup(ctx, w.pickup.x - cam.x, w.pickup.y - cam.y, w.pickupT || 0);
    for (const s of w.stompers) drawStomper(ctx, cam, s);
    for (const f of w.flyers) drawFlyer(ctx, cam, f);
    if (w.hero) drawHero(ctx, cam, w.hero, heroFrame(w.hero, w.heroTick || 0));
}

export function drawHero(ctx, cam, p, frame) {
    Art.drawHero(ctx, p.x - cam.x, p.y - cam.y - 2, frame, p.facing < 0);
}

function drawStomper(ctx, cam, s) {
    if (!cam.visible(s.x, s.y, s.w, s.h)) return;
    if (s.ragdoll) {
        drawSpinning(ctx, cam, s, () => Art.drawStomper(ctx, -s.w / 2, -s.h / 2, 0));
        return;
    }
    // A squashed stomper shows its flat frame until the squash timer runs out.
    if (!s.alive && !(s.squashTimer > 0)) return;
    const frame = s.alive ? Math.floor((s.animT || 0) / 200) % 2 : 2;
    Art.drawStomper(ctx, s.x - cam.x, s.y - cam.y, frame);
}

function drawFlyer(ctx, cam, f) {
    if (!cam.visible(f.x, f.y, f.w, f.h)) return;
    const frame = Math.floor((f.animT || 0) / 150) % 2;
    if (f.ragdoll) {
        drawSpinning(ctx, cam, f, () => Art.drawFlyer(ctx, -f.w / 2, -f.h / 2, frame, false));
        return;
    }
    if (f.alive === false) return;
    Art.drawFlyer(ctx, f.x - cam.x, f.y - cam.y, frame, (f.vx || 0) > 0);
}

function drawSpinning(ctx, cam, e, paint) {
    ctx.save();
    ctx.translate(e.x - cam.x + e.w / 2, e.y - cam.y + e.h / 2);
    ctx.rotate(e.rot || 0);
    paint();
    ctx.restore();
}

// ── Beam effects ────────────────────────────────────────────────────────

/** How long a beam stays on screen. */
export const BEAM_FLASH_MS = 80;

/** A fading beam flash: { x0, y0, x1, y1, ttl, ttlMax }. */
export function makeFlash(b, ttl = BEAM_FLASH_MS) {
    return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ttl, ttlMax: ttl };
}

/** Count flashes down and drop the finished ones (returns the kept list). */
export function ageFlashes(list, dt) {
    for (const b of list) b.ttl -= dt;
    return list.some((b) => b.ttl <= 0) ? list.filter((b) => b.ttl > 0) : list;
}

export function drawBeams(ctx, cam, beams) {
    for (const b of beams) {
        const a = Math.max(0, b.ttl / b.ttlMax);
        ctx.save();
        ctx.lineCap = "round";
        strokeBeam(ctx, cam, b, "rgba(255, 220, 80, " + (a * 0.85).toFixed(3) + ")", BEAM_THICKNESS + 6);
        strokeBeam(ctx, cam, b, "rgba(255, 255, 240, " + a.toFixed(3) + ")", BEAM_THICKNESS - 4);
        ctx.restore();
    }
}

function strokeBeam(ctx, cam, b, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(b.x0 - cam.x, b.y0 - cam.y);
    ctx.lineTo(b.x1 - cam.x, b.y1 - cam.y);
    ctx.stroke();
}

/** Explosion rings: { cx, cy, rMax, ttl, ttlMax }. */
export function drawExplosions(ctx, cam, explosions) {
    for (const e of explosions) {
        const u = 1 - Math.max(0, e.ttl / e.ttlMax);
        const r = e.rMax * (0.35 + 0.65 * u);
        const a = (1 - u) * 0.95;
        const cx = e.cx - cam.x, cy = e.cy - cam.y;
        ctx.fillStyle = "rgba(255, 150, 40, " + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 240, 200, " + (a * 0.7).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** Crosshair at a view-space point (skipped outside the view). */
export function drawAimCursor(ctx, x, y) {
    if (x < 0 || x > VIEW_W || y < 0 || y > VIEW_H) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 240, 80, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y); ctx.lineTo(x - 2, y);
    ctx.moveTo(x + 2, y); ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6); ctx.lineTo(x, y - 2);
    ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 6);
    ctx.stroke();
    ctx.restore();
}

// ── Text overlays (train / demo) ────────────────────────────────────────

/** Monospace status panel in the top-left corner. */
export function drawPanel(ctx, lines, width) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(8, 8, width, 14 * lines.length + 10);
    ctx.fillStyle = "#fff";
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 14, 12 + i * 14);
    ctx.restore();
}

/** Centred message box: a bold title plus smaller lines under it. */
export function drawNotice(ctx, title, lines, { dim = false } = {}) {
    ctx.save();
    if (dim) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    const boxW = 520, boxH = 74 + 26 * lines.length;
    const bx = Math.floor((VIEW_W - boxW) / 2);
    const by = Math.floor((VIEW_H - boxH) / 2);
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px monospace";
    ctx.fillText(title, VIEW_W / 2, by + 36);
    ctx.font = "14px monospace";
    ctx.fillStyle = "#cde";
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], VIEW_W / 2, by + 72 + 26 * i);
    ctx.restore();
}
