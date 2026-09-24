// Invaders drawing — pixel-art sprites, shields, bullets, the starfield.
// Reads a field from rules.js, never changes it.

import {
    ENEMY_W, ENEMY_H, PLAYER_W, SHIELD_CELL, SHIELD_COLS, SHIELD_ROWS,
} from "/app/rules.js";

// 12x8 sprites per invader type (0 back, 1 middle, 2 front), two march frames.
const SPRITES = [
    [
        ["000011110000", "000111111000", "001111111100", "010110011010",
         "011111111110", "001101011010", "010100101010", "001000001000"],
        ["000011110000", "000111111000", "001111111100", "010110011010",
         "011111111110", "010110101010", "100000010001", "010000000100"],
    ],
    [
        ["000110011000", "001111111100", "011111111110", "110110011011",
         "111111111111", "010111111010", "100100001010", "010000001010"],
        ["000110011000", "001111111100", "011111111110", "110110011010",
         "111111111110", "010111111010", "010100000100", "001010010100"],
    ],
    [
        ["001111110000", "011111111000", "111111111100", "110110011010",
         "111111111110", "001100110010", "010000001010", "001100110000"],
        ["001111110000", "011111111000", "111111111100", "110110011011",
         "111111111110", "011011011010", "110000000010", "001100110000"],
    ],
];
const INVADER_COLORS = ["#8fff8f", "#5fff6a", "#3fdd4a"];

// ── Starfield (a backdrop, not game state) ───────────────────────────────

export function createStars(W, H, n = 60) {
    const stars = [];
    for (let i = 0; i < n; i++) {
        stars.push({ x: Math.random() * W, y: Math.random() * H, a: 0.2 + Math.random() * 0.6, s: 0.3 + Math.random() * 1.2 });
    }
    return stars;
}

export function twinkle(stars) {
    for (const s of stars) s.a = Math.max(0.15, Math.min(0.9, s.a + (Math.random() - 0.5) * 0.03));
}

function drawStars(ctx, stars) {
    for (const s of stars) {
        ctx.fillStyle = "rgba(255,255,255," + s.a.toFixed(2) + ")";
        ctx.fillRect(s.x, s.y, s.s, s.s);
    }
}

/** A still starfield for the title (stable per index, so it does not flicker). */
export function drawTitleStars(ctx, W, H) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 40; i++) {
        const s = 0.5 + (i % 3) * 0.4;
        ctx.fillRect(((i * 137 + 41) % 1000) / 1000 * W, ((i * 89 + 17) % 1000) / 1000 * H, s, s);
    }
}

// ── Field ────────────────────────────────────────────────────────────────

export function drawField(ctx, field, stars) {
    const W = field.W, H = field.H;
    drawStars(ctx, stars);

    ctx.fillStyle = "#4fff6a";
    ctx.fillRect(20, H - 40, W - 40, 2);

    drawShields(ctx, field.shields);
    for (const e of field.enemies) if (e.alive) drawInvader(ctx, e, field.marchPhase);
    if (field.ufo) drawUfo(ctx, field.ufo);
    drawBullets(ctx, field);
    if (field.player.alive || field.phase === "dying") drawPlayer(ctx, field);
}

function drawInvader(ctx, e, phase) {
    const grid = SPRITES[e.type][phase];
    const cw = ENEMY_W / 12, ch = ENEMY_H / 8;
    ctx.fillStyle = INVADER_COLORS[e.type];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 12; c++) {
            if (grid[r].charCodeAt(c) === 49) ctx.fillRect(e.x + c * cw, e.y + r * ch, cw + 0.5, ch + 0.5);
        }
    }
}

function drawShields(ctx, shields) {
    ctx.fillStyle = "#6fff8a";
    for (const s of shields) {
        for (let r = 0; r < SHIELD_ROWS; r++) {
            for (let c = 0; c < SHIELD_COLS; c++) {
                if (s.grid[r][c]) ctx.fillRect(s.x + c * SHIELD_CELL, s.y + r * SHIELD_CELL, SHIELD_CELL, SHIELD_CELL);
            }
        }
    }
}

function drawBullets(ctx, field) {
    if (field.bullet) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(field.bullet.x - 1, field.bullet.y - 6, 2, 10);
    }
    ctx.fillStyle = "#ffcc40";
    for (const b of field.enemyBullets) ctx.fillRect(b.x - 1, b.y - 4, 2, 8);
}

function drawUfo(ctx, u) {
    ctx.fillStyle = "#ff5080";
    ctx.fillRect(u.x + 4, u.y + 6, 32, 6);
    ctx.fillRect(u.x + 8, u.y + 2, 24, 4);
    ctx.fillRect(u.x, u.y + 10, 40, 4);
    ctx.fillStyle = "#ffa0c0";
    ctx.fillRect(u.x + 14, u.y + 4, 4, 2);
    ctx.fillRect(u.x + 22, u.y + 4, 4, 2);
}

// Blinks red while the death timer runs.
function drawPlayer(ctx, field) {
    const p = field.player;
    if (field.phase === "dying") {
        if (Math.floor(p.dieTimer / 60) % 2 === 0) return;
        ctx.fillStyle = "#ff5050";
    } else {
        ctx.fillStyle = "#ffffff";
    }
    ctx.fillRect(p.x, p.y + 10, PLAYER_W, 8);
    ctx.fillRect(p.x + 6, p.y + 4, PLAYER_W - 12, 8);
    ctx.fillRect(p.x + PLAYER_W / 2 - 2, p.y - 2, 4, 8);
}
