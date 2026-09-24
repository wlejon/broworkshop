// Breakout rules — paddle, ball and brick physics as plain data.
//
// createBreakout(w, h) builds a court in view pixels. The plugin feeds it
// paddle input and step(court, dt); step pushes what happened onto
// court.events ({ type: "paddle" | "wall" | "brick" | "life" | "levelclear"
// | "gameover", ... }) for the plugin to turn into sound and screens.

export const PADDLE_W = 110;
export const PADDLE_H = 14;
export const PADDLE_SPEED = 620;     // px/s under the keyboard
export const PADDLE_LIFT = 60;       // paddle top, px above the bottom edge
export const BALL_R = 8;
export const BASE_BALL_SPEED = 380;  // px/s at level 1
export const LEVEL_SPEEDUP = 40;     // px/s per level
export const LIVES = 3;

export const BRICK_ROWS = 6;
export const BRICK_COLS = 11;
export const BRICK_COLORS = ["#ef5350", "#ff9100", "#ffee58", "#66bb6a", "#42a5f5", "#ab47bc"];
export const BRICK_POINTS = [50, 40, 30, 20, 10, 10];
// The wall starts under the HUD strip (render.js draws its ceiling rule).
export const BRICK_TOP = 92;
const BRICK_MARGIN = 40, BRICK_GAP = 4, BRICK_H = 22;

const SUBSTEP_PX = 6;                // max ball travel per collision substep

export function createBreakout(width, height, rng = Math.random) {
    const court = {
        W: width,
        H: height,
        rng,
        paddle: { x: 0, y: 0, w: PADDLE_W, h: PADDLE_H },
        ball: { x: 0, y: 0, r: BALL_R, vx: 0, vy: 0, stuck: true },
        bricks: [],
        bricksAlive: 0,
        score: 0,
        lives: LIVES,
        level: 1,
        events: [],
    };
    startLevel(court, 1);
    return court;
}

/** Fresh wall of bricks for `level`, ball back on the paddle. */
export function startLevel(court, level) {
    court.level = level;
    court.bricks = [];
    const bw = Math.floor((court.W - BRICK_MARGIN * 2 - (BRICK_COLS - 1) * BRICK_GAP) / BRICK_COLS);
    for (let row = 0; row < BRICK_ROWS; row++) {
        for (let col = 0; col < BRICK_COLS; col++) {
            court.bricks.push({
                x: BRICK_MARGIN + col * (bw + BRICK_GAP),
                y: BRICK_TOP + row * (BRICK_H + BRICK_GAP),
                w: bw,
                h: BRICK_H,
                row,
                color: BRICK_COLORS[row],
                points: BRICK_POINTS[row],
                alive: true,
            });
        }
    }
    court.bricksAlive = court.bricks.length;
    resetBall(court);
}

/** The view was resized: keep the paddle on the bottom line and inside. */
export function resize(court, width, height) {
    court.W = width;
    court.H = height;
    clampPaddle(court);
}

export function ballSpeed(level) {
    return BASE_BALL_SPEED + (level - 1) * LEVEL_SPEEDUP;
}

export function resetBall(court) {
    const p = court.paddle;
    p.x = (court.W - p.w) / 2;
    p.y = court.H - PADDLE_LIFT;
    const b = court.ball;
    b.stuck = true;
    b.vx = 0;
    b.vy = 0;
    stickBall(court);
}

/** Serve a stuck ball up and slightly off vertical. */
export function launch(court) {
    const b = court.ball;
    if (!b.stuck) return false;
    b.stuck = false;
    const angle = -Math.PI / 2 + (court.rng() - 0.5) * (Math.PI / 4);
    const sp = ballSpeed(court.level);
    b.vx = Math.cos(angle) * sp;
    b.vy = Math.sin(angle) * sp;
    court.events.push({ type: "launch" });
    return true;
}

/** Keyboard: dir -1 / 0 / 1 for `dt` ms. */
export function nudgePaddle(court, dir, dt) {
    court.paddle.x += dir * PADDLE_SPEED * dt / 1000;
    clampPaddle(court);
}

/** Mouse: centre the paddle under x. */
export function aimPaddle(court, x) {
    court.paddle.x = x - court.paddle.w / 2;
    clampPaddle(court);
}

function clampPaddle(court) {
    const p = court.paddle;
    p.x = Math.max(0, Math.min(court.W - p.w, p.x));
    p.y = court.H - PADDLE_LIFT;
}

function stickBall(court) {
    const p = court.paddle, b = court.ball;
    b.x = p.x + p.w / 2;
    b.y = p.y - b.r - 1;
}

/**
 * Advance the ball `dt` ms. Substeps so a fast ball cannot tunnel through a
 * brick; stops at the first life lost or the last brick.
 */
export function step(court, dt) {
    const b = court.ball;
    if (b.stuck) {
        stickBall(court);
        return;
    }
    const dts = dt / 1000;
    const speed = Math.hypot(b.vx, b.vy);
    const steps = Math.max(1, Math.ceil((speed * dts) / SUBSTEP_PX));
    const sdt = dts / steps;

    for (let s = 0; s < steps; s++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        bounceWalls(court);
        bouncePaddle(court);
        hitBrick(court, sdt);

        if (b.y - b.r > court.H) {
            loseLife(court);
            return;
        }
        if (court.bricksAlive <= 0) {
            court.events.push({ type: "levelclear" });
            return;
        }
    }
}

function bounceWalls(court) {
    const b = court.ball;
    let hit = false;
    if (b.x - b.r < 0) { b.x = b.r; b.vx = -b.vx; hit = true; }
    else if (b.x + b.r > court.W) { b.x = court.W - b.r; b.vx = -b.vx; hit = true; }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = -b.vy; hit = true; }
    if (hit) court.events.push({ type: "wall" });
}

// The bounce angle follows where the ball meets the paddle: centre sends it
// straight up, the ends up to 72° off vertical.
function bouncePaddle(court) {
    const b = court.ball, p = court.paddle;
    if (b.vy <= 0 || b.y + b.r < p.y || b.y - b.r > p.y + p.h ||
        b.x + b.r < p.x || b.x - b.r > p.x + p.w) return;
    const hit = Math.max(-1, Math.min(1, (b.x - (p.x + p.w / 2)) / (p.w / 2)));
    const angle = hit * Math.PI * 0.4 - Math.PI / 2;
    const speed = ballSpeed(court.level);
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.y = p.y - b.r - 1;
    court.events.push({ type: "paddle" });
}

// First overlapping brick breaks; the side the ball came from decides the
// reflection axis.
function hitBrick(court, sdt) {
    const b = court.ball;
    for (const br of court.bricks) {
        if (!br.alive) continue;
        if (b.x + b.r < br.x || b.x - b.r > br.x + br.w) continue;
        if (b.y + b.r < br.y || b.y - b.r > br.y + br.h) continue;

        const px = b.x - b.vx * sdt;
        const py = b.y - b.vy * sdt;
        if (px + b.r <= br.x && b.vx > 0) { b.vx = -b.vx; b.x = br.x - b.r; }
        else if (px - b.r >= br.x + br.w && b.vx < 0) { b.vx = -b.vx; b.x = br.x + br.w + b.r; }
        else if (py + b.r <= br.y && b.vy > 0) { b.vy = -b.vy; b.y = br.y - b.r; }
        else if (py - b.r >= br.y + br.h && b.vy < 0) { b.vy = -b.vy; b.y = br.y + br.h + b.r; }
        else b.vy = -b.vy;

        br.alive = false;
        court.bricksAlive--;
        court.score += br.points;
        court.events.push({ type: "brick", row: br.row, x: br.x + br.w / 2, y: br.y + br.h / 2 });
        return;
    }
}

function loseLife(court) {
    court.lives--;
    court.events.push({ type: "life" });
    if (court.lives <= 0) court.events.push({ type: "gameover" });
    else resetBall(court);
}

export function drainEvents(court) {
    const out = court.events;
    court.events = [];
    return out;
}
