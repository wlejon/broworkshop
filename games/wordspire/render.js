// Wordspire drawing: drifting glyph backdrop, letter tiles, the chain line,
// popping letters, the word preview, Submit / Clear buttons and the spire
// of finished words. Reads the Board; never changes it.

import { fitBoard, cellXY } from "/lib/arcade/grid.js";
import { ROWS, COLS } from "/app/letters.js";
import { letterValue } from "/app/scoring.js";
import { POP_MS } from "/app/board.js";
import { Text } from "/app/text.js";

const TILE_COLORS = {
    1: { bg: "#25203a", border: "#3a3258", text: "#f0e0ff" },
    2: { bg: "#504020", border: "#c6a240", text: "#ffecb0" },    // gilded
    3: { bg: "#1f4432", border: "#3fd596", text: "#b8ffdc" },    // jeweled
    4: { bg: "#1d2f58", border: "#4fa8ff", text: "#c8e0ff" },    // sapphire
    5: { bg: "#4a1828", border: "#ff6488", text: "#ffc8d8" },    // ruby
    burning: { bg: "#4a1810", border: "#ff4b3d", text: "#ffbcb0" },
};
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Board placement: centred, nudged right of the HUD, room below for the word preview. */
export function layoutFor(W, H) {
    const L = fitBoard(W, H, ROWS, COLS, { padX: 280, padY: 200, minCell: 32, biasX: 60 });
    L.oy = Math.max(40, L.oy - 30);
    return L;
}

/** Submit / Clear button rects, to the right of the board (null if no room). */
export function buttons(L, W) {
    const x = L.ox + L.boardW + 20;
    if (x + 120 > W - 8) return null;
    return {
        submit: { x, y: L.oy, w: 120, h: 44 },
        clear: { x, y: L.oy + 54, w: 120, h: 34 },
    };
}

export function hit(rect, x, y) {
    return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function drawBackground(ctx, W, H, time) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#120a24");
    g.addColorStop(1, "#050210");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const t = time || 0;
    for (let i = 0; i < 22; i++) {
        const x = ((i * 97 + t * 0.04) % (W + 120)) - 60;
        const y = (i * 151 + t * 0.03) % (H + 60);
        ctx.globalAlpha = 0.05 + (i % 5) * 0.015;
        const col = i % 3 === 0 ? "#e8c168" : i % 3 === 1 ? "#8cdff6" : "#c8b8e8";
        Text.drawCentered(ctx, GLYPHS.charAt(i % GLYPHS.length), Math.floor(x), Math.floor(y), 6, col);
    }
    ctx.globalAlpha = 1;
}

export function drawBoard(ctx, board, L, W, H, preview) {
    ctx.fillStyle = "rgba(40,30,60,0.35)";
    roundRect(ctx, L.ox - 14, L.oy - 14, L.boardW + 28, L.boardH + 28, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(160,130,220,0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const inChain = new Set(board.chain.map(([r, c]) => r + "," + c));
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const t = board.grid[r][c];
            if (!t) continue;
            const p = cellXY(L, r, c);
            const state = inChain.has(r + "," + c) ? "chain"
                : board.cursor.r === r && board.cursor.c === c ? "cursor" : null;
            drawTile(ctx, t, p.x, p.y - board.falls.offset(r, c) * L.cell, L.cell, state);
        }
    }

    if (board.chain.length >= 2) {
        ctx.strokeStyle = "rgba(232,193,104,0.85)";
        ctx.lineWidth = Math.max(3, L.cell * 0.08);
        ctx.lineCap = "round";
        ctx.beginPath();
        board.chain.forEach(([r, c], i) => {
            const x = L.ox + (c + 0.5) * L.cell, y = L.oy + (r + 0.5) * L.cell;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.lineCap = "butt";
    }

    for (const p of board.pops) {
        const a = 1 - p.t / POP_MS;
        ctx.globalAlpha = Math.max(0, a);
        const scale = Math.max(2, Math.floor(L.cell * (0.08 + (1 - a) * 0.06)));
        Text.drawCentered(ctx, p.letter, L.ox + (p.c + 0.5) * L.cell, L.oy + (p.r + 0.5) * L.cell, scale, "#e8c168");
    }
    ctx.globalAlpha = 1;

    drawPreview(ctx, board, L, preview);
    drawButtons(ctx, buttons(L, W), board.chain.length >= 3);
    drawSpire(ctx, board.words, W, H);
}

function drawTile(ctx, tile, x, y, cell, state) {
    const pad = 4, w = cell - pad * 2, h = cell - pad * 2;
    const rx = x + pad, ry = y + pad;
    const col = tile.burning ? TILE_COLORS.burning : TILE_COLORS[tile.mult] || TILE_COLORS[1];
    const border = state === "chain" ? "#e8c168" : state === "cursor" ? "#8cdff6" : col.border;

    roundRect(ctx, rx, ry, w, h, 8);
    ctx.fillStyle = col.bg;
    ctx.fill();
    if (tile.burning) {
        const gr = ctx.createLinearGradient(rx, ry + h, rx, ry);
        gr.addColorStop(0, "rgba(255,75,61,0.7)");
        gr.addColorStop(1, "rgba(255,170,60,0.25)");
        ctx.fillStyle = gr;
        ctx.fill();
    }
    ctx.lineWidth = state ? 3 : 2;
    ctx.strokeStyle = border;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    roundRect(ctx, rx + 2, ry + 2, w - 4, h - 4, 6);
    ctx.stroke();

    const scale = Math.max(2, Math.floor(cell / 12));
    Text.drawCentered(ctx, tile.letter, rx + w / 2, ry + h / 2 - scale, scale, col.text);
    const small = Math.max(1, Math.floor(cell / 28));
    Text.drawRight(ctx, String(letterValue(tile.letter)), rx + w - 4, ry + h - 9 * small - 6, small, "rgba(220,220,255,0.7)");
    if (tile.mult > 1) Text.draw(ctx, "x" + tile.mult, rx + 4, ry + 3, small, col.border);
}

/** The chain as a word with its points, or the prompt / puzzle target. */
function drawPreview(ctx, board, L, pv) {
    const cx = L.ox + L.boardW / 2, y = L.oy + L.boardH + 18;
    if (pv.word) {
        Text.drawCentered(ctx, pv.word.toUpperCase(), cx, y, 4, "#e0d4ff");
        Text.drawCentered(ctx, "+" + pv.points + (pv.valid ? "" : " ?"), cx, y + 36, 2, pv.valid ? "#8cdff6" : "#aa7788");
        return;
    }
    const hint = board.mode === "puzzle" && board.target
        ? "TARGET: " + board.target.toUpperCase()
        : "CHAIN 3+ LETTERS AND SUBMIT";
    Text.drawCentered(ctx, hint, cx, y + 8, 2, board.mode === "puzzle" ? "#b8a8d8" : "#554966");
}

function drawButtons(ctx, b, ready) {
    if (!b) return;
    roundRect(ctx, b.submit.x, b.submit.y, b.submit.w, b.submit.h, 8);
    ctx.fillStyle = ready ? "rgba(232,193,104,0.3)" : "rgba(50,40,70,0.6)";
    ctx.fill();
    ctx.strokeStyle = ready ? "#e8c168" : "#3a3258";
    ctx.lineWidth = 2;
    ctx.stroke();
    Text.drawCentered(ctx, "SUBMIT", b.submit.x + b.submit.w / 2, b.submit.y + b.submit.h / 2, 3, ready ? "#fff4d8" : "#7a6a9a");

    roundRect(ctx, b.clear.x, b.clear.y, b.clear.w, b.clear.h, 6);
    ctx.fillStyle = "rgba(50,40,70,0.6)";
    ctx.fill();
    ctx.strokeStyle = "#3a3258";
    ctx.stroke();
    Text.drawCentered(ctx, "CLEAR", b.clear.x + b.clear.w / 2, b.clear.y + b.clear.h / 2, 2, "#b8a8d8");
}

/** One block per word played, stacked in the bottom-right corner. */
function drawSpire(ctx, words, W, H) {
    const sx = W - 40, sy = H - 40;
    for (let i = 0; i < Math.min(40, words); i++) {
        const bw = 18 - Math.floor(i / 8) * 2, bh = 8;
        const bx = sx - bw / 2, by = sy - (i + 1) * (bh + 2);
        ctx.fillStyle = i % 5 === 4 ? "#e8c168" : i % 3 === 0 ? "#8cdff6" : "#c8b8e8";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
