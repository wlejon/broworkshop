// render.js — Blockpop drawing: starfield backdrop, the well, blocks with
// specials and colour-blind glyphs, pop flashes, the carrier and the brake
// bar. Reads a Board session; writes only to the canvas.

import { COLS, ROWS, COLORS, SPECIAL_STAR, SPECIAL_BOMB, SPECIAL_RAINBOW } from "/app/rules.js";
import { BRAKE_MS, BRAKE_COOLDOWN_MS } from "/app/board.js";

const FLASH_MS = 200;
const RAINBOW = ["#ff4d6d", "#ffb74d", "#ffeb3b", "#66e676", "#4ad6ff", "#c47bff"];

/** Well geometry for a W x H view: 80 px above for the carrier, 40 below. */
export function layoutFor(W, H) {
    const topPad = 80, bottomPad = 40;
    const cell = Math.max(14, Math.min(Math.floor((H - topPad - bottomPad) / ROWS), Math.floor((W - 80) / COLS)));
    const w = cell * COLS, h = cell * ROWS;
    return { cell, w, h, ox: Math.floor((W - w) / 2), oy: topPad };
}

/** Pixel centre of column c, row r (from the bottom), before the rise shift. */
export function cellCenter(L, c, r) {
    return { x: L.ox + c * L.cell + L.cell / 2, y: L.oy + L.h - (r + 0.5) * L.cell };
}

/** Column under canvas x, or -1 off the well. */
export function columnAt(L, x) {
    if (x < L.ox || x >= L.ox + L.w) return -1;
    return Math.floor((x - L.ox) / L.cell);
}

// ── Pop flashes (white cell overlays, board coordinates) ────────────────

export function addFlash(flashes, c, r) { flashes.push({ c, r, t: FLASH_MS }); }

export function stepFlashes(flashes, dt) {
    for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].t -= dt;
        if (flashes[i].t <= 0) flashes.splice(i, 1);
    }
}

// ── Drawing ─────────────────────────────────────────────────────────────

/** Deep-space gradient with a slow-drifting starfield; t in ms. */
export function drawBackground(ctx, W, H, t) {
    const shiftA = 0.05 + 0.03 * Math.sin(t * 0.00015);
    ctx.fillStyle = "#050810";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.25 + shiftA;
    ctx.fillStyle = "#0a2238";
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
    ctx.fillStyle = "#99c6ff";
    for (let i = 0; i < 42; i++) {
        const sx = ((i * 83) % W + (t * 0.015 + i * 7) % 40) % W;
        const sy = ((i * 137) % H + (t * 0.008) % 40) % H;
        ctx.globalAlpha = 0.15 + (i % 5) * 0.04;
        ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
}

/** One bevelled block centred on (cx, cy). */
export function drawBlock(ctx, cx, cy, size, color, special, colorBlind) {
    const s = size - 4;
    const x = cx - s / 2, y = cy - s / 2;
    const bevel = Math.max(2, Math.floor(s * 0.15));
    ctx.fillStyle = color;
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(x, y, s, bevel);
    ctx.fillRect(x, y, bevel, s);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x, y + s - bevel, s, bevel);
    ctx.fillRect(x + s - bevel, y, bevel, s);

    if (colorBlind) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        const gs = Math.floor(s * 0.38);
        ctx.fillRect(cx - 1, cy - gs / 2, 2, gs);
        ctx.fillRect(cx - gs / 2, cy - 1, gs, 2);
    }

    if (special === SPECIAL_STAR) {
        ctx.fillStyle = "#fff4a8";
        const ss = Math.floor(s * 0.32);
        ctx.fillRect(cx - 1, cy - ss, 2, ss * 2);
        ctx.fillRect(cx - ss, cy - 1, ss * 2, 2);
        ctx.fillRect(cx - ss / 2, cy - ss / 2, ss, 2);
        ctx.fillRect(cx - ss / 2, cy + ss / 2 - 2, ss, 2);
    } else if (special === SPECIAL_BOMB) {
        const br = Math.floor(s * 0.28);
        ctx.fillStyle = "#222";
        ctx.fillRect(cx - br, cy - br, br * 2, br * 2);
        ctx.fillStyle = "#ff6f3b";
        ctx.fillRect(cx - 2, cy - br - 3, 4, 3);
    } else if (special === SPECIAL_RAINBOW) {
        const bandH = Math.max(2, Math.floor(s / 6));
        for (let i = 0; i < RAINBOW.length; i++) {
            ctx.fillStyle = RAINBOW[i];
            ctx.fillRect(x, y + i * bandH, s, bandH);
        }
    }
}

/** Well, danger band, blocks (shifted up by the rise), flashes, carrier, brake bar. */
export function drawBoard(ctx, b, L, flashes, colorBlind) {
    ctx.strokeStyle = "#1f3450";
    ctx.lineWidth = 2;
    ctx.strokeRect(L.ox - 1, L.oy - 1, L.w + 2, L.h + 2);
    ctx.strokeStyle = "#10172a";
    for (let c = 0; c <= COLS; c++) ctx.strokeRect(L.ox + c * L.cell, L.oy, 0, L.h);
    for (let r = 0; r <= ROWS; r++) ctx.strokeRect(L.ox, L.oy + r * L.cell, L.w, 0);

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ff4d6d";
    ctx.fillRect(L.ox, L.oy, L.w, L.cell * 2);
    ctx.globalAlpha = 1;

    const lift = b.rise * L.cell;
    for (let c = 0; c < COLS; c++) {
        const col = b.board[c];
        for (let r = 0; r < col.length; r++) {
            const bl = col[r];
            if (!bl) continue;
            const p = cellCenter(L, c, r);
            const cy = p.y - lift;
            if (cy + L.cell / 2 < L.oy) continue;
            drawBlock(ctx, p.x, cy, L.cell, COLORS[bl.color], bl.special, colorBlind);
        }
    }

    ctx.fillStyle = "#ffffff";
    for (const f of flashes) {
        ctx.globalAlpha = Math.max(0, f.t / FLASH_MS) * 0.6;
        ctx.fillRect(L.ox + f.c * L.cell, L.oy + L.h - (f.r + 1) * L.cell, L.cell, L.cell);
    }
    ctx.globalAlpha = 1;

    drawCarrier(ctx, b.carrier, L, colorBlind);

    if (b.brakeCooldown > 0 || b.brake > 0) {
        const by = L.oy - 14;
        ctx.fillStyle = "#223045";
        ctx.fillRect(L.ox, by, L.w, 6);
        if (b.brake > 0) {
            ctx.fillStyle = "#8ae0ff";
            ctx.fillRect(L.ox, by, L.w * (b.brake / BRAKE_MS), 6);
        } else {
            ctx.fillStyle = "#ffd873";
            ctx.fillRect(L.ox, by, L.w * (1 - b.brakeCooldown / BRAKE_COOLDOWN_MS), 6);
        }
    }
}

/** Tractor above the well with its beam and the held stack to its right. */
function drawCarrier(ctx, carrier, L, colorBlind) {
    const cx = L.ox + carrier.col * L.cell + L.cell / 2;
    const top = L.oy - 24;
    const w = L.cell * 0.85, h = 18;
    ctx.fillStyle = "#4da8ff";
    ctx.fillRect(cx - w / 2, top - h, w, h);
    ctx.fillStyle = "#dbefff";
    ctx.fillRect(cx - w / 2 + 3, top - h + 3, w - 6, 4);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = carrier.held.length ? "#ffd873" : "#8ae0ff";
    ctx.fillRect(cx - w / 3, top, (w / 3) * 2, L.oy - top);
    ctx.globalAlpha = 1;
    for (let i = 0; i < carrier.held.length; i++) {
        const hb = carrier.held[i];
        drawBlock(ctx, cx + w / 2 + 8 + i * (L.cell * 0.5), top - h / 2, L.cell * 0.5,
            COLORS[hb.color], hb.special, colorBlind);
    }
}
