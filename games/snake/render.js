// Snake drawing — reads a board from rules.js, never changes it.

import { fitBoard } from "/lib/arcade/grid.js";
import { COLS, ROWS } from "/app/rules.js";

export const FLASH_MS = 120;

const COLORS = {
    board: "#0d1a12",
    grid: "#142b1e",
    border: "#2a5a3b",
    food: "#e74c3c",
    foodGlint: "rgba(255,255,255,0.35)",
    body: { r: 123, g: 216, b: 143 },
    eye: "#06100a",
};

/** Board rectangle for a W x H view: whole cells, clear of the HUD strip on top. */
export function layoutFor(W, H) {
    return fitBoard(W, H, ROWS, COLS, { padX: 80, padY: 136, minY: 96, minCell: 6 });
}

/** flash: ms left on the eat pulse (0..FLASH_MS). */
export function drawGame(ctx, board, layout, flash) {
    drawBoard(ctx, layout);
    drawFood(ctx, board.food, layout, flash);
    drawSnake(ctx, board, layout);
}

export function drawBoard(ctx, L) {
    ctx.fillStyle = COLORS.board;
    ctx.fillRect(L.ox, L.oy, L.boardW, L.boardH);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
        const x = L.ox + c * L.cell + 0.5;
        ctx.moveTo(x, L.oy);
        ctx.lineTo(x, L.oy + L.boardH);
    }
    for (let r = 1; r < ROWS; r++) {
        const y = L.oy + r * L.cell + 0.5;
        ctx.moveTo(L.ox, y);
        ctx.lineTo(L.ox + L.boardW, y);
    }
    ctx.stroke();

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(L.ox - 1, L.oy - 1, L.boardW + 2, L.boardH + 2);
}

function drawFood(ctx, food, L, flash) {
    const pulse = 1 + 0.15 * (flash / FLASH_MS);
    const pad = Math.max(2, Math.floor(L.cell * 0.15));
    const size = L.cell - pad * 2;
    const cx = L.ox + food.x * L.cell + pad + size / 2;
    const cy = L.oy + food.y * L.cell + pad + size / 2;

    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(cx, cy, (size / 2) * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.foodGlint;
    ctx.beginPath();
    ctx.arc(cx - size * 0.15, cy - size * 0.15, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
}

// Tail to head, fading toward the tail; eyes on a live head.
function drawSnake(ctx, board, L) {
    const inset = Math.max(1, Math.floor(L.cell * 0.08));
    const n = board.snake.length;
    const { r, g, b } = COLORS.body;
    for (let i = n - 1; i >= 0; i--) {
        const seg = board.snake[i];
        const sx = L.ox + seg.x * L.cell;
        const sy = L.oy + seg.y * L.cell;
        const shade = 1 - Math.min(0.4, i / (n + 4));
        ctx.fillStyle = "rgb(" + Math.floor(r * shade) + "," + Math.floor(g * shade) + "," + Math.floor(b * shade) + ")";
        ctx.fillRect(sx + inset, sy + inset, L.cell - inset * 2, L.cell - inset * 2);
        if (i === 0 && board.alive) drawEyes(ctx, board.dir, sx, sy, L.cell);
    }
}

function drawEyes(ctx, dir, sx, sy, cell) {
    const eyeR = Math.max(1, Math.floor(cell * 0.08));
    const cx = sx + cell / 2 + dir.x * cell * 0.22;
    const cy = sy + cell / 2 + dir.y * cell * 0.22;
    const side = cell * 0.11;     // half the eye spacing, across the heading
    ctx.fillStyle = COLORS.eye;
    for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.arc(cx - dir.y * side * s, cy + dir.x * side * s, eyeR, 0, Math.PI * 2);
        ctx.fill();
    }
}
