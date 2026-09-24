// Hopper drawing — terrain rows, lanes, pads and the frog, scaled to the
// tile size the layout picks. Reads a crossing from rules.js, never changes it.

import { fitBoard } from "/lib/arcade/grid.js";
import {
    COLS, ROWS, ROW_GOAL, ROW_MEDIAN, isRoad, isRiver, ROW_ROAD_END,
} from "/app/rules.js";

/** Whole tiles (up to 56 px), under the HUD strip. */
export function layoutFor(W, H) {
    return fitBoard(W, H, ROWS, COLS, { padX: 24, padY: 104, minY: 96, maxCell: 56 });
}

/** banner: { text, timer } drawn over the field while timer > 0. */
export function drawCrossing(ctx, game, L, W, H, banner) {
    drawTerrain(ctx, L);
    drawPads(ctx, game, L);
    ctx.save();                      // cars and logs enter and leave at the board edge
    ctx.beginPath();
    ctx.rect(L.ox, L.oy, L.boardW, L.boardH);
    ctx.clip();
    drawLanes(ctx, game, L);
    ctx.restore();
    drawPlayer(ctx, game, L);

    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(L.ox - 1, L.oy - 1, L.boardW + 2, L.boardH + 2);

    if (banner && banner.timer > 0) drawBanner(ctx, banner.text, W, H);
}

function rowColor(r) {
    if (isRiver(r)) return "#1565c0";
    if (isRoad(r)) return "#2b2b2b";
    if (r === ROW_MEDIAN) return "#388e3c";
    if (r === ROW_GOAL) return "#1b3a1b";
    return "#2e7d32";
}

function drawTerrain(ctx, L) {
    const t = L.cell, k = t / 56;
    for (let r = 0; r < ROWS; r++) {
        const y = L.oy + r * t;
        ctx.fillStyle = rowColor(r);
        ctx.fillRect(L.ox, y, L.boardW, t);

        if (isRoad(r) && r < ROW_ROAD_END) {        // dashed lane line
            ctx.fillStyle = "#f9ca24";
            for (let sx = L.ox; sx < L.ox + L.boardW; sx += 20 * k) ctx.fillRect(sx, y + t - 2 * k, 10 * k, 4 * k);
        }
        if (isRiver(r)) {                            // ripples
            ctx.fillStyle = "rgba(255,255,255,0.08)";
            for (let s = 0; s < 6; s++) {
                const sx = L.ox + ((s * 137 + r * 53) % 728) * k;
                ctx.fillRect(sx, y + ((r * 7) % 56) * k, 20 * k, 2);
            }
        }
    }
}

function drawPads(ctx, game, L) {
    const t = L.cell;
    for (const pad of game.pads) {
        const cx = L.ox + (pad.col + 0.5) * t;
        const cy = L.oy + (ROW_GOAL + 0.5) * t;
        ctx.fillStyle = "#4caf50";
        ctx.beginPath();
        ctx.arc(cx, cy, t * 0.4, 0, Math.PI * 2);
        ctx.fill();
        if (pad.filled) drawFrog(ctx, cx, cy, t * 0.65, "#689f38", t / 56);
    }
}

function drawLanes(ctx, game, L) {
    const t = L.cell, k = t / 56;
    game.lanes.forEach((lane, r) => {
        if (!lane) return;
        const ly = L.oy + r * t;
        for (const e of lane.entities) {
            const ex = L.ox + e.x * t;
            const ew = e.width * t;
            if (e.type === "car") {
                ctx.fillStyle = e.width >= 2 ? "#c62828" : "#ef6c00";
                ctx.fillRect(ex + 4 * k, ly + 6 * k, ew - 8 * k, t - 12 * k);
                ctx.fillStyle = "#111";                                     // wheels
                ctx.fillRect(ex + 6 * k, ly + t - 10 * k, 10 * k, 6 * k);
                ctx.fillRect(ex + ew - 16 * k, ly + t - 10 * k, 10 * k, 6 * k);
                ctx.fillStyle = "rgba(255,255,255,0.25)";                   // windscreen, front side
                ctx.fillRect(lane.dir > 0 ? ex + ew - 20 * k : ex + 10 * k, ly + 12 * k, 10 * k, t - 24 * k);
            } else {
                ctx.fillStyle = "#6d4c41";
                ctx.fillRect(ex, ly + 8 * k, ew, t - 16 * k);
                ctx.fillStyle = "#4e342e";                                  // bark edges
                ctx.fillRect(ex, ly + 8 * k, ew, 4 * k);
                ctx.fillRect(ex, ly + t - 12 * k, ew, 4 * k);
                ctx.fillStyle = "#3e2723";                                  // end grain
                ctx.fillRect(ex + 4 * k, ly + 14 * k, 2 * k, t - 28 * k);
                ctx.fillRect(ex + ew - 6 * k, ly + 14 * k, 2 * k, t - 28 * k);
            }
        }
    });
}

// Blinks while the death timer runs.
function drawPlayer(ctx, game, L) {
    if (game.deathTimer > 0 && Math.floor(game.deathTimer / 100) % 2 !== 0) return;
    const t = L.cell;
    drawFrog(ctx, L.ox + (game.frog.col + 0.5) * t, L.oy + (game.frog.row + 0.5) * t, t * 0.75, "#8bc34a", t / 56);
}

function drawFrog(ctx, cx, cy, s, color, k) {
    ctx.fillStyle = color;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = "#558b2f";                                              // legs
    ctx.fillRect(cx - s / 2 - 2 * k, cy - s / 4, 6 * k, s / 2);
    ctx.fillRect(cx + s / 2 - 4 * k, cy - s / 4, 6 * k, s / 2);
    ctx.fillStyle = "#fff";                                                 // eyes
    ctx.fillRect(cx - s / 3, cy - s / 2 - 2 * k, s / 5, s / 5);
    ctx.fillRect(cx + s / 3 - s / 5, cy - s / 2 - 2 * k, s / 5, s / 5);
    ctx.fillStyle = "#000";
    ctx.fillRect(cx - s / 3 + 2 * k, cy - s / 2, 3 * k, 3 * k);
    ctx.fillRect(cx + s / 3 - s / 5 + 2 * k, cy - s / 2, 3 * k, 3 * k);
}

function drawBanner(ctx, text, w, h) {
    ctx.save();
    ctx.fillStyle = "#ffeb3b";
    ctx.font = "bold 48px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text, w / 2, h * 0.45);
    ctx.restore();
}
