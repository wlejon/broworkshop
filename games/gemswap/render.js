// Gemswap drawing: starfield, board frame, gems (swap / fall / shatter
// tweens), selection, cursor, hint. Reads the Board; never changes it.

import { cellXY } from "/lib/arcade/grid.js";
import { SPECIAL } from "/app/rules.js";
import { PALETTE } from "/app/palette.js";
import { TIMING } from "/app/board.js";

const BG = "#0a0612";
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export function drawBackground(ctx, W, H, time) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const drift = ((time || 0) * 0.0001) % 1;
    for (let i = 0; i < 40; i++) {
        const x = (i * 97.31 + drift * W) % W;
        const y = (i * 173.7) % H;
        const s = 0.3 + (i % 5) * 0.15;
        ctx.fillStyle = "rgba(180,120,220," + (0.06 + (i % 3) * 0.04) + ")";
        ctx.fillRect(x, y, s, s);
    }
}

/** Whole board; `shake` is the {x, y} offset from the effects layer. */
export function drawBoard(ctx, board, L, shake) {
    ctx.save();
    ctx.translate(shake.x, shake.y);
    drawFrame(ctx, board, L);
    drawHint(ctx, board, L);
    drawGems(ctx, board, L);
    drawSelection(ctx, board, L);
    drawCursor(ctx, board, L);
    drawShatterRings(ctx, board, L);
    ctx.restore();
}

// ── Board ──────────────────────────────────────────────────────────────────

function drawFrame(ctx, board, L) {
    const x = L.ox - 8, y = L.oy - 8, w = L.boardW + 16, h = L.boardH + 16;
    ctx.fillStyle = "rgba(30, 15, 50, 0.7)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#3a2a55";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    for (let r = 0; r < L.rows; r++) {
        for (let c = 0; c < L.cols; c++) {
            const p = cellXY(L, r, c);
            ctx.fillStyle = (r + c) & 1 ? "rgba(40,25,65,0.55)" : "rgba(30,18,50,0.55)";
            ctx.fillRect(p.x, p.y, L.cell, L.cell);
            const gem = board.grid[r][c];
            if (gem && gem.frozen) {
                ctx.fillStyle = "rgba(140,200,255,0.15)";
                ctx.fillRect(p.x + 2, p.y + 2, L.cell - 4, L.cell - 4);
                ctx.strokeStyle = "rgba(180,220,255,0.4)";
                ctx.lineWidth = 1;
                ctx.strokeRect(p.x + 2.5, p.y + 2.5, L.cell - 5, L.cell - 5);
            }
        }
    }
}

function drawHint(ctx, board, L) {
    const hint = board.hint;
    if (!hint) return;
    const pulse = 0.5 + 0.5 * Math.sin(board.time * 0.01);
    ctx.fillStyle = "rgba(255,240,120," + (0.12 + pulse * 0.18) + ")";
    for (const [r, c] of [[hint.r, hint.c], [hint.r + hint.dr, hint.c + hint.dc]]) {
        const p = cellXY(L, r, c);
        ctx.fillRect(p.x, p.y, L.cell, L.cell);
    }
}

function drawSelection(ctx, board, L) {
    if (!board.sel) return;
    const p = cellXY(L, board.sel.r, board.sel.c);
    const pulse = 0.5 + 0.5 * Math.sin(board.time * 0.008);
    ctx.strokeStyle = "rgba(255,240,120," + (0.5 + pulse * 0.5) + ")";
    ctx.lineWidth = 3;
    ctx.strokeRect(p.x + 2.5, p.y + 2.5, L.cell - 5, L.cell - 5);
}

function drawCursor(ctx, board, L) {
    if (!board.cursor.active) return;
    const p = cellXY(L, board.cursor.r, board.cursor.c);
    ctx.save();
    ctx.strokeStyle = "#c78aff";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(p.x + 1.5, p.y + 1.5, L.cell - 3, L.cell - 3);
    ctx.restore();
}

// ── Gems ───────────────────────────────────────────────────────────────────

/** Where a gem draws this frame: swap tween, then fall offset. */
function gemCenter(board, L, r, c) {
    const p = cellXY(L, r, c);
    let x = p.x + L.cell / 2;
    let y = p.y + L.cell / 2 - board.falls.offset(r, c) * L.cell;
    const sw = board.swap;
    if (sw) {
        let e = easeOutCubic(Math.min(1, sw.t / TIMING.swap));
        if (sw.kind === "back") e = Math.sin(e * Math.PI);    // there and back
        const other = sw.a.r === r && sw.a.c === c ? sw.b : sw.b.r === r && sw.b.c === c ? sw.a : null;
        if (other) {
            x += (other.c - c) * L.cell * e;
            y += (other.r - r) * L.cell * e;
        }
    }
    return { x, y };
}

function drawGems(ctx, board, L) {
    const wave = board.wave;
    for (let r = 0; r < L.rows; r++) {
        for (let c = 0; c < L.cols; c++) {
            const gem = board.grid[r][c];
            if (!gem) continue;
            const { x, y } = gemCenter(board, L, r, c);
            const picked = board.sel && board.sel.r === r && board.sel.c === c;
            const pulse = picked ? 0.2 * (0.5 + 0.5 * Math.sin(board.time * 0.015)) : 0;
            const local = wave ? wave.local(r, c) : null;
            if (local == null || local < 0) {
                drawGem(ctx, gem, x, y, L.cell, pulse);
                continue;
            }
            // Charge (white flash, slight bulge), then shatter out. Ice only cracks.
            let alpha = 1, scale = 1, rot = 0, charge = 0;
            if (local < TIMING.charge) {
                charge = local / TIMING.charge;
                scale = 1 + 0.1 * charge;
            } else if (gem.frozen) {
                charge = Math.max(0, 1 - (local - TIMING.charge) / TIMING.shatter);
            } else if (local < TIMING.charge + TIMING.shatter) {
                const t = (local - TIMING.charge) / TIMING.shatter;
                alpha = 1 - t;
                scale = 1.1 + t * 0.7;
                rot = t * 0.8;
            } else {
                continue;
            }
            ctx.save();
            ctx.globalAlpha = Math.max(0, alpha);
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.scale(scale, scale);
            drawGem(ctx, gem, 0, 0, L.cell, pulse);
            if (charge > 0) {
                ctx.globalAlpha = 0.55 * charge;
                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.arc(0, 0, L.cell * 0.36, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }
}

/** Radiant ring + cross glint as each gem shatters. */
function drawShatterRings(ctx, board, L) {
    const wave = board.wave;
    if (!wave) return;
    const cell = L.cell;
    for (const t of wave.cells) {
        const local = (wave.t - t.delay - TIMING.charge) / TIMING.shatter;
        if (local <= 0 || local >= 1) continue;
        const p = cellXY(L, t.r, t.c);
        const cx = p.x + cell / 2, cy = p.y + cell / 2;
        ctx.strokeStyle = "rgba(255, 250, 220, " + (1 - local) * 0.85 + ")";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.3 + local * cell * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        if (local < 0.5) {
            const cf = 1 - local * 2;
            ctx.strokeStyle = "rgba(255, 255, 255, " + cf * 0.7 + ")";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(cx - cell * 0.45 * cf, cy);
            ctx.lineTo(cx + cell * 0.45 * cf, cy);
            ctx.moveTo(cx, cy - cell * 0.45 * cf);
            ctx.lineTo(cx, cy + cell * 0.45 * cf);
            ctx.stroke();
        }
    }
}

/** One gem centred at (cx, cy). Each color has its own silhouette. */
export function drawGem(ctx, gem, cx, cy, size, pulse) {
    const pal = PALETTE[gem.color];
    if (!pal) return;
    const half = (size * 0.78 * (1 + (pulse || 0) * 0.08)) / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    if (gem.special === SPECIAL.HYPER) {
        star(ctx, 8, half, half * 0.45, -Math.PI / 2);
    } else {
        switch (gem.color % 7) {
            case 1: polygon(ctx, 4, half, -Math.PI / 2); break;   // ruby: diamond
            case 2: polygon(ctx, 6, half, Math.PI / 6); break;    // sapphire: hexagon
            case 3: polygon(ctx, 8, half, Math.PI / 8); break;    // emerald: octagon
            case 4: star(ctx, 5, half, half * 0.5, -Math.PI / 2); break;  // topaz: star
            case 5: polygon(ctx, 3, half, -Math.PI / 2); break;   // amethyst: triangle
            case 6: ctx.arc(0, 0, half, 0, Math.PI * 2); break;   // citrine: round
            default: polygon(ctx, 5, half, -Math.PI / 2);         // onyx: pentagon
        }
    }
    const grad = ctx.createRadialGradient(-half * 0.3, -half * 0.3, 1, 0, 0, half);
    grad.addColorStop(0, pal.rim);
    grad.addColorStop(0.55, pal.core);
    grad.addColorStop(1, pal.dark);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = pal.dark;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(-half * 0.32, -half * 0.42, half * 0.28, half * 0.14, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();

    if (gem.special === SPECIAL.FLAME) {
        ctx.fillStyle = "rgba(255,230,120,0.9)";
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.35, 0, Math.PI * 2);
        ctx.fill();
    } else if (gem.special === SPECIAL.STAR) {
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-half * 0.8, 0); ctx.lineTo(half * 0.8, 0);
        ctx.moveTo(0, -half * 0.8); ctx.lineTo(0, half * 0.8);
        ctx.stroke();
    }
    ctx.restore();
}

function polygon(ctx, n, r, rot) {
    for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
}

function star(ctx, spikes, outer, inner, rot) {
    for (let i = 0; i < spikes * 2; i++) {
        const a = rot + (i / (spikes * 2)) * Math.PI * 2;
        const r = i & 1 ? inner : outer;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
}
