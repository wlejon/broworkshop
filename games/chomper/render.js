// Chomper drawing — maze, pellets, Chomper and the ghosts. Reads a game
// from rules.js, never changes it.

import { fitBoard } from "/lib/arcade/grid.js";
import { COLS, ROWS } from "/app/maze.js";
import { DIRS } from "/app/ghosts.js";
import { DIE_MS, frightBlink } from "/app/rules.js";

/** Whole tiles, under the HUD strip. */
export function layoutFor(W, H) {
    return fitBoard(W, H, ROWS, COLS, { padX: 48, padY: 120, minY: 96, minCell: 4 });
}

export function drawGame(ctx, game, L) {
    drawMaze(ctx, game.maze, L);
    if (game.phase === "dying") {
        drawPac(ctx, game.pac, L, 1 - game.dieTimer / DIE_MS);
        return;
    }
    drawPac(ctx, game.pac, L, -1);
    const blink = frightBlink(game);
    for (const g of game.ghosts) drawGhost(ctx, g, L, blink);
}

export function drawMaze(ctx, m, L) {
    const t = L.cell;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const ch = m.grid[r][c];
            const x = L.ox + c * t, y = L.oy + r * t;
            if (ch === "#") {
                ctx.fillStyle = "#1a1aff";
                ctx.fillRect(x, y, t, t);
            } else if (ch === "-") {
                ctx.fillStyle = "#ff69b4";
                ctx.fillRect(x, y + t * 0.45, t, t * 0.1);
            } else if (ch === "." || ch === "o") {
                ctx.fillStyle = "#ffd7a8";
                ctx.beginPath();
                ctx.arc(x + t / 2, y + t / 2, ch === "o" ? Math.max(3, t * 0.3) : Math.max(1.2, t * 0.1), 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

const FACING = [0, Math.PI, -Math.PI / 2, Math.PI / 2];

/** dying < 0: chomping; else 0..1 through the death animation (mouth opens to nothing). */
function drawPac(ctx, pac, L, dying) {
    const t = L.cell;
    const cx = L.ox + pac.c * t + t / 2, cy = L.oy + pac.r * t + t / 2;
    let from, to;
    if (dying < 0) {
        const angle = (Math.sin(pac.mouth) + 1) * 0.25;
        from = FACING[pac.dir] + angle;
        to = FACING[pac.dir] - angle + Math.PI * 2;
    } else {
        const open = Math.min(Math.PI, dying * Math.PI);
        from = -Math.PI / 2 + open;
        to = -Math.PI / 2 - open + Math.PI * 2;
    }
    ctx.fillStyle = "#ffff00";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, t * 0.48, from, to);
    ctx.closePath();
    ctx.fill();
}

function drawGhost(ctx, g, L, blink) {
    const t = L.cell;
    const cx = L.ox + g.c * t + t / 2, cy = L.oy + g.r * t + t / 2;
    const rad = t * 0.45;
    if (g.mode === "eaten") {
        drawEyes(ctx, g, cx, cy, rad);
        return;
    }
    const scared = g.mode === "frightened";
    ctx.fillStyle = scared ? (blink ? "#ffffff" : "#2121ff") : g.color;
    ctx.beginPath();
    ctx.arc(cx, cy - rad * 0.1, rad, Math.PI, 0, false);
    ctx.lineTo(cx + rad, cy + rad * 0.6);
    for (let i = 0; i < 3; i++) {                                   // scalloped hem
        const sx = cx + rad - (2 * rad / 3) * i, ex = cx + rad - (2 * rad / 3) * (i + 1);
        ctx.quadraticCurveTo((sx + ex) / 2, cy + rad * 0.3, ex, cy + rad * 0.6);
    }
    ctx.lineTo(cx - rad, cy - rad * 0.1);
    ctx.closePath();
    ctx.fill();
    if (!scared) {
        drawEyes(ctx, g, cx, cy, rad);
        return;
    }
    const face = blink ? "#ff0000" : "#ffffff";                     // scared face
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(cx - rad * 0.35, cy - rad * 0.15, rad * 0.15, 0, Math.PI * 2);
    ctx.arc(cx + rad * 0.35, cy - rad * 0.15, rad * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = face;
    ctx.lineWidth = Math.max(1, t * 0.07);
    const mw = rad * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - mw / 2, cy + rad * 0.2);
    ctx.lineTo(cx - mw / 4, cy + rad * 0.05);
    ctx.lineTo(cx, cy + rad * 0.2);
    ctx.lineTo(cx + mw / 4, cy + rad * 0.05);
    ctx.lineTo(cx + mw / 2, cy + rad * 0.2);
    ctx.stroke();
}

function drawEyes(ctx, g, cx, cy, rad) {
    const ex = DIRS[g.dir].dx * rad * 0.15, ey = DIRS[g.dir].dy * rad * 0.15;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx - rad * 0.35, cy - rad * 0.15, rad * 0.22, 0, Math.PI * 2);
    ctx.arc(cx + rad * 0.35, cy - rad * 0.15, rad * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2121ff";
    ctx.beginPath();
    ctx.arc(cx - rad * 0.35 + ex, cy - rad * 0.15 + ey, rad * 0.1, 0, Math.PI * 2);
    ctx.arc(cx + rad * 0.35 + ex, cy - rad * 0.15 + ey, rad * 0.1, 0, Math.PI * 2);
    ctx.fill();
}
