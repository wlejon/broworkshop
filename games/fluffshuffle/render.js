// Fluffshuffle drawing: dusk gradient, board frame with row/column hover
// and lock gutters, puffs (slide with wrap copies, falls, pops), lock
// halos, pop rings, keyboard cursor. Reads the Board; never changes it.

import { cellXY, cellAt } from "/lib/arcade/grid.js";
import { rowLocked, colLocked } from "/app/rules.js";
import { Puffs } from "/app/puffs.js";
import { TIMING } from "/app/board.js";

export function drawBackground(ctx, W, H, time) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0d1326");
    g.addColorStop(1, "#231a38");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const t = (time || 0) * 0.00008;
    for (let i = 0; i < 50; i++) {
        const x = (i * 97.31 + t * W * 2) % W;
        const y = (i * 173.7 + t * H) % H;
        const s = 0.4 + (i % 5) * 0.2;
        ctx.fillStyle = "rgba(255, 200, 220, " + (0.05 + (i % 3) * 0.03) + ")";
        ctx.fillRect(x, y, s, s);
    }
}

/** Board + puffs; `shake` is the {x, y} offset from the effects layer. */
export function drawBoard(ctx, board, L, shake) {
    const hover = hoverCell(board, L);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    drawFrame(ctx, board, L, hover);

    ctx.save();
    ctx.beginPath();
    ctx.rect(L.ox, L.oy, L.boardW, L.boardH);
    ctx.clip();       // wrap copies bleed past the edges
    drawPuffs(ctx, board, L);
    if (hover) drawLockHalos(ctx, board, L, hover);
    drawPopRings(ctx, board, L);
    ctx.restore();

    const cur = board.cursor;
    if (cur.active && board.settings.showCursor) {
        const p = cellXY(L, cur.r, cur.c);
        const pulse = 0.5 + 0.5 * Math.sin(board.time * 0.008);
        ctx.strokeStyle = "rgba(255, 240, 180, " + (0.5 + pulse * 0.5) + ")";
        ctx.lineWidth = 3;
        ctx.strokeRect(p.x + 2.5, p.y + 2.5, L.cell - 5, L.cell - 5);
    }
    ctx.restore();
}

/** The cell under an idle pointer (previews which row / column would move). */
function hoverCell(board, L) {
    if (board.drag || board.busy() || board.ended()) return null;
    return cellAt(L, board.pointer.x, board.pointer.y);
}

function drawFrame(ctx, board, L, hover) {
    const g = board.grid;
    ctx.fillStyle = "rgba(26, 36, 60, 0.72)";
    ctx.fillRect(L.ox - 10, L.oy - 10, L.boardW + 20, L.boardH + 20);
    ctx.strokeStyle = "#3a4a70";
    ctx.lineWidth = 2;
    ctx.strokeRect(L.ox - 9.5, L.oy - 9.5, L.boardW + 19, L.boardH + 19);

    const d = board.drag && board.drag.axis ? board.drag : null;
    const hovRowLocked = hover && rowLocked(g, hover.r);
    const hovColLocked = hover && colLocked(g, hover.c);
    for (let r = 0; r < L.rows; r++) {
        for (let c = 0; c < L.cols; c++) {
            const odd = (r + c) & 1;
            let fill;
            if (d && ((d.axis === "h" && d.index === r) || (d.axis === "v" && d.index === c))) {
                fill = odd ? "rgba(70, 90, 140, 0.55)" : "rgba(60, 80, 130, 0.55)";
            } else if (hover && (r === hover.r || c === hover.c)) {
                const blocked = (r === hover.r && hovRowLocked) || (c === hover.c && hovColLocked);
                fill = blocked
                    ? (odd ? "rgba(120, 50, 60, 0.55)" : "rgba(105, 42, 52, 0.55)")
                    : (odd ? "rgba(50, 90, 80, 0.55)" : "rgba(42, 80, 70, 0.55)");
            } else {
                fill = odd ? "rgba(30, 40, 70, 0.55)" : "rgba(22, 32, 60, 0.55)";
            }
            const p = cellXY(L, r, c);
            ctx.fillStyle = fill;
            ctx.fillRect(p.x, p.y, L.cell, L.cell);
        }
    }

    // Gutter stripes mark every locked row and column.
    for (let r = 0; r < L.rows; r++) {
        if (!rowLocked(g, r)) continue;
        ctx.fillStyle = hover && hover.r === r ? "rgba(220, 240, 255, 0.95)" : "rgba(180, 220, 255, 0.78)";
        const y = L.oy + r * L.cell + 2;
        ctx.fillRect(L.ox - 7, y, 4, L.cell - 4);
        ctx.fillRect(L.ox + L.boardW + 3, y, 4, L.cell - 4);
    }
    for (let c = 0; c < L.cols; c++) {
        if (!colLocked(g, c)) continue;
        ctx.fillStyle = hover && hover.c === c ? "rgba(220, 240, 255, 0.95)" : "rgba(180, 220, 255, 0.78)";
        const x = L.ox + c * L.cell + 2;
        ctx.fillRect(x, L.oy - 7, L.cell - 4, 4);
        ctx.fillRect(x, L.oy + L.boardH + 3, L.cell - 4, 4);
    }
}

function drawPuffs(ctx, board, L) {
    const cell = L.cell;
    const wave = board.wave;
    const lookAt = board.settings.eyeTrack ? board.pointer : null;
    for (let r = 0; r < L.rows; r++) {
        for (let c = 0; c < L.cols; c++) {
            const puff = board.grid[r][c];
            if (!puff) continue;
            const opts = { t: board.time, lookAt, state: board.isHeld(r, c) ? "held" : "idle" };
            let alpha = 1;
            const local = wave ? wave.local(r, c) : null;
            if (local != null) {
                if (local < 0) {
                    opts.pulse = 0.1 * Math.max(0, 1 + local / 80);   // anticipation
                } else if (local < TIMING.pop) {
                    opts.state = "pop";
                    opts.pop = local / TIMING.pop;
                    alpha = 1 - opts.pop;
                } else {
                    continue;
                }
            }
            const p = cellXY(L, r, c);
            const off = board.lineOffset(r, c) * cell;
            const horiz = board.snap ? board.snap.axis === "h" : board.drag && board.drag.axis === "h";
            const x = p.x + cell / 2 + (horiz ? off : 0);
            const y = p.y + cell / 2 + (horiz ? 0 : off) - board.falls.offset(r, c) * cell;

            ctx.save();
            ctx.globalAlpha = alpha;
            Puffs.draw(ctx, puff, x, y, cell, opts);
            if (off !== 0) {
                // Wrap copies on both sides so the slide reads as seamless.
                const w = horiz ? L.boardW : 0, h = horiz ? 0 : L.boardH;
                Puffs.draw(ctx, puff, x + w, y + h, cell, opts);
                Puffs.draw(ctx, puff, x - w, y - h, cell, opts);
            }
            ctx.restore();
        }
    }
}

/** Hovering a blocked line rings the locked puffs responsible. */
function drawLockHalos(ctx, board, L, hover) {
    const pulse = 0.55 + 0.45 * Math.sin(board.time * 0.006);
    ctx.strokeStyle = "rgba(255, 200, 210, " + (0.45 + pulse * 0.35) + ")";
    ctx.lineWidth = 2.2;
    for (let r = 0; r < L.rows; r++) {
        for (let c = 0; c < L.cols; c++) {
            const puff = board.grid[r][c];
            if (!puff || !puff.locked || (r !== hover.r && c !== hover.c)) continue;
            const p = cellXY(L, r, c);
            ctx.beginPath();
            ctx.arc(p.x + L.cell / 2, p.y + L.cell / 2, L.cell * 0.42, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

/** A shock ring expands from each puff as it pops. */
function drawPopRings(ctx, board, L) {
    const wave = board.wave;
    if (!wave) return;
    for (const t of wave.cells) {
        const k = (wave.t - t.delay) / TIMING.pop;
        if (k <= 0 || k >= 1) continue;
        const p = cellXY(L, t.r, t.c);
        ctx.strokeStyle = "rgba(255, 240, 200, " + (1 - k) * 0.85 + ")";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x + L.cell / 2, p.y + L.cell / 2, L.cell * (0.35 + k * 0.55), 0, Math.PI * 2);
        ctx.stroke();
    }
}
