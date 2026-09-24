// Snake rules — pure state and stepping, no DOM, no audio, no drawing.
//
// A board is a plain object from createSnake(). The game calls turn() on
// input and advance(dt) each frame; advance moves one cell per tick and
// pushes what happened onto board.events ({ type: "eat" | "die", x, y }) for
// the plugin to turn into sound and flashes.

export const COLS = 28;
export const ROWS = 22;
export const TICK_MAX = 140;   // ms between steps at the start
export const TICK_MIN = 55;    // ms between steps at full speed
export const RAMP_LENGTH = 40; // growth over which the speed ramps to full
export const POINTS = 10;
export const START_LENGTH = 3;

export const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};

/** A fresh board: a 3-long snake heading right from the centre, one food. */
export function createSnake(rng = Math.random) {
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2);
    const board = {
        rng,
        snake: [],
        dir: DIRS.right,
        nextDir: DIRS.right,
        food: { x: 0, y: 0 },
        growPending: 0,
        interval: TICK_MAX,
        timer: 0,
        score: 0,
        alive: true,
        events: [],
    };
    for (let i = 0; i < START_LENGTH; i++) board.snake.push({ x: cx - i, y: cy });
    placeFood(board);
    return board;
}

/** Ms between steps for a snake of `length` cells. */
export function stepInterval(length) {
    const t = Math.min(1, (length - START_LENGTH) / RAMP_LENGTH);
    return TICK_MAX + (TICK_MIN - TICK_MAX) * t;
}

function isReverse(a, b) {
    return a.x === -b.x && a.y === -b.y;
}

/** Buffer a turn for the next step; a 180° reverse is refused. */
export function turn(board, dir) {
    if (!isReverse(dir, board.dir)) board.nextDir = dir;
}

export function onSnake(board, x, y) {
    return board.snake.some((s) => s.x === x && s.y === y);
}

/** Drop the food on a random free cell. */
export function placeFood(board) {
    for (let tries = 0; tries < 500; tries++) {
        const x = Math.floor(board.rng() * COLS);
        const y = Math.floor(board.rng() * ROWS);
        if (!onSnake(board, x, y)) {
            board.food = { x, y };
            return;
        }
    }
}

/** Run as many steps as `dt` ms of play covers. */
export function advance(board, dt) {
    board.timer += dt;
    while (board.alive && board.timer >= board.interval) {
        board.timer -= board.interval;
        step(board);
    }
}

/** One cell forward: turn, collide, eat, grow. */
export function step(board) {
    if (!board.alive) return;
    if (!isReverse(board.nextDir, board.dir)) board.dir = board.nextDir;

    const head = board.snake[0];
    const nx = head.x + board.dir.x;
    const ny = head.y + board.dir.y;

    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || hitsBody(board, nx, ny)) {
        board.alive = false;
        board.events.push({ type: "die", x: nx, y: ny });
        return;
    }

    board.snake.unshift({ x: nx, y: ny });

    if (nx === board.food.x && ny === board.food.y) {
        board.score += POINTS;
        board.growPending += 1;
        board.interval = stepInterval(board.snake.length);
        board.events.push({ type: "eat", x: nx, y: ny });
        placeFood(board);
    }

    if (board.growPending > 0) board.growPending -= 1;
    else board.snake.pop();
}

// The tail cell is free this step unless the snake is about to grow.
function hitsBody(board, x, y) {
    const tail = board.snake.length - 1;
    for (let i = 0; i < board.snake.length; i++) {
        if (i === tail && board.growPending === 0) continue;
        if (board.snake[i].x === x && board.snake[i].y === y) return true;
    }
    return false;
}

/** Take the events since the last call. */
export function drainEvents(board) {
    const out = board.events;
    board.events = [];
    return out;
}
