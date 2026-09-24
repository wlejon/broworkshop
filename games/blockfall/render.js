// Blockfall drawing — the well, bevelled cells, ghost piece, hold and next
// previews, lock / drop flashes, the line-clear strobe and the countdown.
// Reads the state from rules.js plus the plugin's view state; changes neither.

import { COLS, ROWS, PIECES, LOCK_DELAY, canPlace, ghostY } from "/app/rules.js";

export const COLORS = [null, "#00e5ff", "#ffd600", "#aa00ff", "#00e676", "#ff1744", "#2979ff", "#ff9100"];
export const COLORS_LIGHT = [null, "#4df0ff", "#ffeb3b", "#d050ff", "#69f0ae", "#ff5252", "#448aff", "#ffab40"];
export const CLEAR_MS = 250;

/** Cell size and well origin: fits previews either side and the HUD strip above. */
export function layoutFor(W, H) {
    const cell = Math.floor(Math.min((H - 120) / ROWS, W / (COLS + 10)));
    const w = COLS * cell, h = ROWS * cell;
    return { cell, w, h, x: Math.floor((W - w) / 2), y: Math.max(96, Math.floor((H - h) / 2)) };
}

/** Pixel centre of cell (r, c). */
export function cellCenter(L, r, c) {
    return { x: L.x + c * L.cell + L.cell / 2, y: L.y + r * L.cell + L.cell / 2 };
}

/**
 * vs: { flashes: [{r, c, t}], clear: {rows, t} | null, ghost, grid }.
 */
export function drawWell(ctx, s, L, vs) {
    ctx.fillStyle = "#08080e";
    ctx.fillRect(L.x, L.y, L.w, L.h);
    if (vs.grid) {
        ctx.strokeStyle = "#181822";
        for (let c = 0; c <= COLS; c++) ctx.strokeRect(L.x + c * L.cell, L.y, 0, L.h);
        for (let r = 0; r <= ROWS; r++) ctx.strokeRect(L.x, L.y + r * L.cell, L.w, 0);
    }
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (s.board[r][c]) drawCell(ctx, L, r, c, COLORS[s.board[r][c]], 1);
    }

    for (const f of vs.flashes) {                               // freshly locked / dropped cells
        ctx.globalAlpha = (f.t / 200) * 0.5;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(L.x + f.c * L.cell, L.y + f.r * L.cell, L.cell, L.cell);
    }
    ctx.globalAlpha = 1;
    if (vs.clear) {                                             // strobe the cleared rows
        const a = Math.sin((vs.clear.t / CLEAR_MS) * Math.PI * 3) * 0.5;
        if (a > 0) {
            ctx.globalAlpha = a;
            ctx.fillStyle = "#ffffff";
            for (const r of vs.clear.rows) ctx.fillRect(L.x, L.y + r * L.cell, L.w, L.cell);
            ctx.globalAlpha = 1;
        }
    }

    const cur = s.cur;
    if (cur && vs.ghost) {
        const gy = ghostY(s);
        if (gy !== cur.y) {
            for (const [dr, dc] of PIECES[cur.type][cur.rot]) {
                const r = gy + dr, c = cur.x + dc;
                if (r < 0) continue;
                const x = L.x + c * L.cell + 1, y = L.y + r * L.cell + 1, sz = L.cell - 2;
                ctx.globalAlpha = 0.2;
                ctx.fillStyle = COLORS[cur.type];
                ctx.fillRect(x, y, sz, sz);
                ctx.globalAlpha = 0.4;
                ctx.strokeStyle = COLORS[cur.type];
                ctx.strokeRect(x, y, sz, sz);
            }
            ctx.globalAlpha = 1;
        }
    }
    if (cur) {                                                  // fades as the lock delay runs out
        const grounded = !canPlace(s, cur.type, cur.x, cur.y + 1, cur.rot);
        const alpha = grounded && s.lockTimer > 0 ? 1 - (s.lockTimer / LOCK_DELAY) * 0.3 : 1;
        for (const [dr, dc] of PIECES[cur.type][cur.rot]) {
            if (cur.y + dr >= 0) drawCell(ctx, L, cur.y + dr, cur.x + dc, COLORS[cur.type], alpha);
        }
    }
    ctx.strokeStyle = "#444";
    ctx.strokeRect(L.x - 1, L.y - 1, L.w + 2, L.h + 2);
}

function drawCell(ctx, L, r, c, color, alpha) {
    const x = L.x + c * L.cell + 1, y = L.y + r * L.cell + 1, sz = L.cell - 2;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, sz, sz);
    ctx.fillStyle = "rgba(255,255,255,0.15)";                 // bevel
    ctx.fillRect(x, y, sz, 2);
    ctx.fillRect(x, y, 2, sz);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(x, y + sz - 2, sz, 2);
    ctx.fillRect(x + sz - 2, y, 2, sz);
    ctx.globalAlpha = 1;
}

/** Hold box left of the well, next piece plus three more on the right. */
export function drawPreviews(ctx, s, L) {
    const pv = Math.floor(L.cell * 0.7);
    const boxW = pv * 4 + 8, boxH = pv * 3 + 8;
    const box = (x, y, fill, stroke) => {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, boxW, boxH);
        ctx.strokeStyle = stroke;
        ctx.strokeRect(x, y, boxW, boxH);
    };
    const hx = L.x - pv * 5 - 10;
    box(hx, L.y, "#0c0c14", "#333");
    if (s.holdType) {
        ctx.globalAlpha = s.holdUsed ? 0.4 : 1;
        drawMini(ctx, s.holdType, hx + 4, L.y + 4, pv);
        ctx.globalAlpha = 1;
    }
    const nx = L.x + L.w + 10;
    box(nx, L.y, "#0c0c14", "#333");
    if (s.next.length) drawMini(ctx, s.next[0], nx + 4, L.y + 4, pv);
    for (let i = 1; i < Math.min(s.next.length, 4); i++) {
        const y = L.y + (pv * 3 + 16) * i + 8;
        box(nx, y, "#0a0a10", "#222");
        ctx.globalAlpha = 0.6;
        drawMini(ctx, s.next[i], nx + 4, y + 4, pv);
        ctx.globalAlpha = 1;
    }
}

// A piece centred in a 4x3 box.
function drawMini(ctx, type, px, py, size) {
    const cells = PIECES[type][0];
    const rs = cells.map((p) => p[0]), cs = cells.map((p) => p[1]);
    const minR = Math.min(...rs), minC = Math.min(...cs);
    const ox = px + (size * 4 - (Math.max(...cs) - minC + 1) * size) / 2 - minC * size;
    const oy = py + (size * 3 - (Math.max(...rs) - minR + 1) * size) / 2 - minR * size;
    ctx.fillStyle = COLORS[type];
    for (const [r, c] of cells) ctx.fillRect(ox + c * size + 1, oy + r * size + 1, size - 2, size - 2);
}

/** 3, 2, 1, GO! */
export function drawCountdown(ctx, W, H, n) {
    ctx.save();
    ctx.font = "bold 96px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = n > 0 ? "#4fc3f7" : "#00e676";
    ctx.globalAlpha = 0.95;
    ctx.fillText(n > 0 ? String(n) : "GO!", W / 2, H * 0.4);
    ctx.restore();
}
