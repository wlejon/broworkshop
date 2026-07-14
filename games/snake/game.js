// Snake — reference arcade plugin.
// Only rules, drawing, and cues live here. Shell: /lib/arcade.

const COLS = 28;
const ROWS = 22;
const TICK_MIN = 55;   // ms between steps at full speed
const TICK_MAX = 140;  // ms between steps at start
const POINTS = 10;
const FLASH_MS = 120;

const COLORS = {
    clear: "#06100a",
    board: "#0d1a12",
    grid: "#142b1e",
    border: "#2a5a3b",
    food: "#e74c3c",
    foodGlint: "rgba(255,255,255,0.35)",
    body: { r: 123, g: 216, b: 143 },
    eye: "#06100a",
};

export const game = {
    id: "snake",
    clearColor: COLORS.clear,

    create(ctx) {
        const run = {
            score: 0,
            snake: [],
            dir: { x: 1, y: 0 },
            nextDir: { x: 1, y: 0 },
            food: { x: 0, y: 0 },
            growPending: 0,
            stepInterval: TICK_MAX,
            stepTimer: 0,
            flashTimer: 0,
            alive: true,
            play: ctx.play,
            highScore: ctx.highScore,
        };
        resetBoard(run);
        return run;
    },

    update(run, dt, input) {
        if (!run.alive) return { status: "gameover" };

        bufferTurn(run, input);

        run.stepTimer += dt;
        while (run.stepTimer >= run.stepInterval) {
            run.stepTimer -= run.stepInterval;
            step(run);
            if (!run.alive) break;
        }

        if (run.flashTimer > 0) {
            run.flashTimer = Math.max(0, run.flashTimer - dt);
        }

        if (!run.alive) return { status: "gameover" };
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        const board = layoutBoard(w, h);
        drawBoard(ctx, board);
        drawFood(ctx, run, board);
        drawSnake(ctx, run, board);
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            best: run ? run.highScore() : 0,
            length: run ? run.snake.length : 3,
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const len = run ? run.snake.length : 0;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score    " + score + tag + "\n" +
            "Length   " + len + "\n" +
            "Best     " + best
        );
    },

    cue(name, audio) {
        if (name === "eat") audio.tone(660, 0.08, "square", 0.6);
        else if (name === "die") {
            audio.sequence([
                [300, 0.15, "sawtooth", 0.5],
                [200, 0.2, "sawtooth", 0.5],
                [120, 0.3, "sawtooth", 0.5],
            ]);
        }
    },
};

// ── Input ────────────────────────────────────────────────────────────────

function bufferTurn(run, input) {
    // Rising-edge only; refuse 180° reverse.
    let nd = null;
    if (input.pressed("up")) nd = { x: 0, y: -1 };
    else if (input.pressed("down")) nd = { x: 0, y: 1 };
    else if (input.pressed("left")) nd = { x: -1, y: 0 };
    else if (input.pressed("right")) nd = { x: 1, y: 0 };
    if (nd && !(nd.x === -run.dir.x && nd.y === -run.dir.y)) {
        run.nextDir = nd;
    }
}

// ── Rules ────────────────────────────────────────────────────────────────

function resetBoard(run) {
    run.score = 0;
    run.snake = [];
    run.dir = { x: 1, y: 0 };
    run.nextDir = { x: 1, y: 0 };
    run.growPending = 0;
    run.stepInterval = TICK_MAX;
    run.stepTimer = 0;
    run.flashTimer = 0;
    run.alive = true;

    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2);
    run.snake.push({ x: cx, y: cy });
    run.snake.push({ x: cx - 1, y: cy });
    run.snake.push({ x: cx - 2, y: cy });
    placeFood(run);
}

function placeFood(run) {
    for (let tries = 0; tries < 500; tries++) {
        const x = Math.floor(Math.random() * COLS);
        const y = Math.floor(Math.random() * ROWS);
        if (!onSnake(run, x, y)) {
            run.food.x = x;
            run.food.y = y;
            return;
        }
    }
}

function onSnake(run, x, y) {
    for (let i = 0; i < run.snake.length; i++) {
        if (run.snake[i].x === x && run.snake[i].y === y) return true;
    }
    return false;
}

function step(run) {
    if (!run.alive) return;

    // Apply buffered turn unless it is a reverse.
    if (!(run.nextDir.x === -run.dir.x && run.nextDir.y === -run.dir.y)) {
        run.dir.x = run.nextDir.x;
        run.dir.y = run.nextDir.y;
    }

    const head = run.snake[0];
    const nx = head.x + run.dir.x;
    const ny = head.y + run.dir.y;

    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
        die(run);
        return;
    }

    // Allow moving into the cell the tail is vacating this step.
    const tailIdx = run.snake.length - 1;
    for (let i = 0; i < run.snake.length; i++) {
        if (i === tailIdx && run.growPending === 0) continue;
        if (run.snake[i].x === nx && run.snake[i].y === ny) {
            die(run);
            return;
        }
    }

    run.snake.unshift({ x: nx, y: ny });

    if (nx === run.food.x && ny === run.food.y) {
        run.score += POINTS;
        run.growPending += 1;
        const t = Math.min(1, (run.snake.length - 3) / 40);
        run.stepInterval = TICK_MAX + (TICK_MIN - TICK_MAX) * t;
        run.play("eat");
        placeFood(run);
        run.flashTimer = FLASH_MS;
    }

    if (run.growPending > 0) run.growPending -= 1;
    else run.snake.pop();
}

function die(run) {
    run.alive = false;
    run.play("die");
}

// ── Draw ─────────────────────────────────────────────────────────────────

function layoutBoard(W, H) {
    const margin = 40;
    let cell = Math.floor(Math.min((W - margin * 2) / COLS, (H - margin * 2) / ROWS));
    if (cell < 6) cell = 6;
    const boardW = cell * COLS;
    const boardH = cell * ROWS;
    return {
        ox: Math.floor((W - boardW) / 2),
        oy: Math.floor((H - boardH) / 2),
        cell,
        w: boardW,
        h: boardH,
    };
}

function drawBoard(ctx, board) {
    ctx.fillStyle = COLORS.board;
    ctx.fillRect(board.ox, board.oy, board.w, board.h);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
        const x = board.ox + c * board.cell + 0.5;
        ctx.moveTo(x, board.oy);
        ctx.lineTo(x, board.oy + board.h);
    }
    for (let r = 1; r < ROWS; r++) {
        const y = board.oy + r * board.cell + 0.5;
        ctx.moveTo(board.ox, y);
        ctx.lineTo(board.ox + board.w, y);
    }
    ctx.stroke();

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(board.ox - 1, board.oy - 1, board.w + 2, board.h + 2);
}

function drawFood(ctx, run, board) {
    const pulse = run.flashTimer > 0
        ? 1 + 0.15 * (run.flashTimer / FLASH_MS)
        : 1;
    const pad = Math.max(2, Math.floor(board.cell * 0.15));
    const fs = board.cell - pad * 2;
    const cx = board.ox + run.food.x * board.cell + pad + fs / 2;
    const cy = board.oy + run.food.y * board.cell + pad + fs / 2;

    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(cx, cy, (fs / 2) * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.foodGlint;
    ctx.beginPath();
    ctx.arc(cx - fs * 0.15, cy - fs * 0.15, fs * 0.12, 0, Math.PI * 2);
    ctx.fill();
}

function drawSnake(ctx, run, board) {
    const p = Math.max(1, Math.floor(board.cell * 0.08));
    for (let i = run.snake.length - 1; i >= 0; i--) {
        const seg = run.snake[i];
        const sx = board.ox + seg.x * board.cell;
        const sy = board.oy + seg.y * board.cell;
        const shade = 1 - Math.min(0.4, i / (run.snake.length + 4));
        const { r, g, b } = COLORS.body;
        ctx.fillStyle = "rgb(" +
            Math.floor(r * shade) + "," +
            Math.floor(g * shade) + "," +
            Math.floor(b * shade) + ")";
        ctx.fillRect(sx + p, sy + p, board.cell - p * 2, board.cell - p * 2);

        if (i === 0 && run.alive) drawEyes(ctx, run, sx, sy, board.cell);
    }
}

function drawEyes(ctx, run, sx, sy, cell) {
    const eyeR = Math.max(1, Math.floor(cell * 0.08));
    const cx = sx + cell / 2;
    const cy = sy + cell / 2;
    const off = cell * 0.22;
    const perpX = -run.dir.y;
    const perpY = run.dir.x;
    const e1x = cx + run.dir.x * off + perpX * off * 0.5;
    const e1y = cy + run.dir.y * off + perpY * off * 0.5;
    const e2x = cx + run.dir.x * off - perpX * off * 0.5;
    const e2y = cy + run.dir.y * off - perpY * off * 0.5;
    ctx.fillStyle = COLORS.eye;
    ctx.beginPath();
    ctx.arc(e1x, e1y, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(e2x, e2y, eyeR, 0, Math.PI * 2);
    ctx.fill();
}
