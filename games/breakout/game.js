// Breakout — arcade plugin.
// Screens / loop / high score / pause: /lib/arcade.

const BASE_W = 800;
const BASE_H = 700;
const PADDLE = { w: 110, h: 14, speed: 620 };
const BALL_R = 8;
const BASE_BALL_SPEED = 380;
const BRICK_ROWS = 6;
const BRICK_COLS = 11;
const BRICK_COLORS = ["#ef5350", "#ff9100", "#ffee58", "#66bb6a", "#42a5f5", "#ab47bc"];
const BRICK_PTS = [50, 40, 30, 20, 10, 10];

export const game = {
    id: "breakout",
    clearColor: "#06060a",

    create(ctx) {
        const run = {
            W: BASE_W,
            H: BASE_H,
            paddle: {
                x: (BASE_W - PADDLE.w) / 2,
                y: BASE_H - 60,
                w: PADDLE.w,
                h: PADDLE.h,
                speed: PADDLE.speed,
            },
            ball: { x: 0, y: 0, r: BALL_R, vx: 0, vy: 0, stuck: true },
            bricks: [],
            bricksAlive: 0,
            score: 0,
            lives: 3,
            level: 1,
            mouseX: -1,
            mouseControl: false,
            /** Set during sim; consumed at end of update. */
            endEvent: null, // "gameover" | "levelclear" | null
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            audio: ctx.audio,
            view: ctx.view,
        };
        attachPointer(run);
        setupLevel(run);
        return run;
    },

    update(run, dt, input) {
        const size = run.view.size();
        run.W = size.w;
        run.H = size.h;

        if (input.pressed("left") || input.pressed("right")) {
            run.mouseControl = false;
        }
        if (input.pressed("primary")) launchBall(run);

        stepPaddle(run, dt, input);
        stepBall(run, dt);

        if (run.endEvent === "gameover") {
            run.endEvent = null;
            return { status: "gameover" };
        }
        if (run.endEvent === "levelclear") {
            run.endEvent = null;
            return { status: "screen", name: "levelclear" };
        }
    },

    draw(run, ctx, view) {
        const { w: W, h: H } = view.size();

        ctx.strokeStyle = "#1a1a24";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 70);
        ctx.lineTo(W, 70);
        ctx.stroke();

        for (let i = 0; i < run.bricks.length; i++) {
            const b = run.bricks[i];
            if (!b.alive) continue;
            ctx.fillStyle = b.color;
            ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.fillStyle = "rgba(255,255,255,0.18)";
            ctx.fillRect(b.x, b.y, b.w, 3);
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.fillRect(b.x, b.y + b.h - 3, b.w, 3);
        }

        const p = run.paddle;
        ctx.fillStyle = "#ff9100";
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(p.x, p.y, p.w, 3);

        const ball = run.ball;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fill();

        if (ball.stuck) {
            ctx.fillStyle = "#aaaaaa";
            ctx.font = "16px Consolas, monospace";
            ctx.textAlign = "center";
            ctx.fillText("Click or press SPACE to launch", W / 2, H - 20);
        }
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            high: run ? run.highScore() : 0,
            level: run ? run.level : 1,
            lives: run ? run.lives : 3,
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const level = run ? run.level : 1;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score    " + score + tag + "\n" +
            "Level    " + level + "\n" +
            "Best     " + best
        );
    },

    onEnterScreen(name, run) {
        if (name === "levelclear" && run) {
            const el = document.getElementById("levelclear-stats");
            if (el) {
                el.textContent =
                    "Level " + run.level + " complete\nScore  " + run.score;
            }
        }
    },

    onMenuAction(action, run) {
        if (action === "nextlevel" && run) {
            run.level++;
            setupLevel(run);
            return "playing";
        }
    },

    cue(name, audio) {
        if (name === "paddle") audio.tone(220, 0.05, "square", 0.5);
        else if (name === "wall") audio.tone(180, 0.04, "square", 0.4);
        else if (name === "brick") audio.tone(400, 0.07, "square", 0.6);
        else if (name === "life") {
            audio.sequence([
                [300, 0.15, "sawtooth", 0.5],
                [200, 0.2, "sawtooth", 0.5],
            ]);
        } else if (name === "gameover") {
            audio.sequence([
                [300, 0.2, "sawtooth", 0.5],
                [250, 0.2, "sawtooth", 0.5],
                [180, 0.4, "sawtooth", 0.5],
            ]);
        } else if (name === "levelclear") {
            audio.sequence([
                [523, 0.1, "square", 0.7],
                [659, 0.1, "square", 0.7],
                [784, 0.15, "square", 0.8],
            ]);
        } else if (name === "launch") {
            audio.tone(500, 0.08, "triangle", 0.5);
        }
    },
};

// ── Pointer ──────────────────────────────────────────────────────────────

/** One listener per canvas; always targets the latest run on that canvas. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._breakoutRun = run;
    if (canvas._breakoutPointer) return;
    canvas._breakoutPointer = (e) => {
        const r = canvas._breakoutRun;
        if (!r || !r.view) return;
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        let x;
        if (rect) {
            const scaleX = r.view.width() / (rect.width || r.W || BASE_W);
            x = (e.clientX - rect.left) * scaleX;
        } else if (typeof e.offsetX === "number") {
            x = e.offsetX;
        } else {
            x = e.clientX;
        }
        r.mouseX = x;
        r.mouseControl = true;
    };
    canvas.addEventListener("mousemove", canvas._breakoutPointer);
}

// ── Level / ball ─────────────────────────────────────────────────────────

function setupLevel(run) {
    run.bricks = [];
    const margin = 40;
    const top = 80;
    const gap = 4;
    const bw = Math.floor(
        (run.W - margin * 2 - (BRICK_COLS - 1) * gap) / BRICK_COLS
    );
    const bh = 22;
    for (let row = 0; row < BRICK_ROWS; row++) {
        for (let col = 0; col < BRICK_COLS; col++) {
            run.bricks.push({
                x: margin + col * (bw + gap),
                y: top + row * (bh + gap),
                w: bw,
                h: bh,
                row,
                color: BRICK_COLORS[row],
                points: BRICK_PTS[row],
                alive: true,
            });
        }
    }
    run.bricksAlive = run.bricks.length;
    resetBall(run);
}

function resetBall(run) {
    run.paddle.x = (run.W - run.paddle.w) / 2;
    run.paddle.y = run.H - 60;
    run.ball.r = BALL_R;
    run.ball.stuck = true;
    run.ball.vx = 0;
    run.ball.vy = 0;
    run.ball.x = run.paddle.x + run.paddle.w / 2;
    run.ball.y = run.paddle.y - run.ball.r - 1;
}

function ballSpeed(run) {
    return BASE_BALL_SPEED + (run.level - 1) * 40;
}

function launchBall(run) {
    if (!run.ball.stuck) return;
    run.ball.stuck = false;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
    const sp = ballSpeed(run);
    run.ball.vx = Math.cos(angle) * sp;
    run.ball.vy = Math.sin(angle) * sp;
    run.play("launch");
}

function stepPaddle(run, dt, input) {
    const dts = dt / 1000;
    const p = run.paddle;
    if (run.mouseControl && run.mouseX >= 0) {
        p.x = run.mouseX - p.w / 2;
    } else {
        if (input.down("left")) p.x -= p.speed * dts;
        if (input.down("right")) p.x += p.speed * dts;
    }
    if (p.x < 0) p.x = 0;
    if (p.x + p.w > run.W) p.x = run.W - p.w;
    p.y = run.H - 60;
}

function stepBall(run, dt) {
    const b = run.ball;
    const p = run.paddle;
    if (b.stuck) {
        b.x = p.x + p.w / 2;
        b.y = p.y - b.r - 1;
        return;
    }

    // Sub-step so fast balls don't tunnel through bricks.
    const dts = dt / 1000;
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    const steps = Math.max(1, Math.ceil((sp * dts) / 6));
    const sdt = dts / steps;

    for (let s = 0; s < steps; s++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;

        bounceWalls(run);
        bouncePaddle(run);
        hitBrick(run, sdt);

        if (b.y - b.r > run.H) {
            loseLife(run);
            return;
        }
        if (run.bricksAlive <= 0) {
            run.play("levelclear");
            run.endEvent = "levelclear";
            return;
        }
    }
}

function bounceWalls(run) {
    const b = run.ball;
    if (b.x - b.r < 0) {
        b.x = b.r;
        b.vx = -b.vx;
        run.play("wall");
    } else if (b.x + b.r > run.W) {
        b.x = run.W - b.r;
        b.vx = -b.vx;
        run.play("wall");
    }
    if (b.y - b.r < 0) {
        b.y = b.r;
        b.vy = -b.vy;
        run.play("wall");
    }
}

function bouncePaddle(run) {
    const b = run.ball;
    const p = run.paddle;
    if (
        b.vy <= 0 ||
        b.y + b.r < p.y ||
        b.y - b.r > p.y + p.h ||
        b.x + b.r < p.x ||
        b.x - b.r > p.x + p.w
    ) {
        return;
    }
    let hit = (b.x - (p.x + p.w / 2)) / (p.w / 2);
    if (hit < -1) hit = -1;
    else if (hit > 1) hit = 1;
    const angle = hit * Math.PI * 0.4 - Math.PI / 2;
    const speed = ballSpeed(run);
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.y = p.y - b.r - 1;
    run.play("paddle");
}

function hitBrick(run, sdt) {
    const b = run.ball;
    for (let i = 0; i < run.bricks.length; i++) {
        const br = run.bricks[i];
        if (!br.alive) continue;
        if (b.x + b.r < br.x || b.x - b.r > br.x + br.w) continue;
        if (b.y + b.r < br.y || b.y - b.r > br.y + br.h) continue;

        const prevX = b.x - b.vx * sdt;
        const prevY = b.y - b.vy * sdt;
        const wasLeft = prevX + b.r <= br.x;
        const wasRight = prevX - b.r >= br.x + br.w;
        const wasAbove = prevY + b.r <= br.y;
        const wasBelow = prevY - b.r >= br.y + br.h;

        if (wasLeft && b.vx > 0) {
            b.vx = -b.vx;
            b.x = br.x - b.r;
        } else if (wasRight && b.vx < 0) {
            b.vx = -b.vx;
            b.x = br.x + br.w + b.r;
        } else if (wasAbove && b.vy > 0) {
            b.vy = -b.vy;
            b.y = br.y - b.r;
        } else if (wasBelow && b.vy < 0) {
            b.vy = -b.vy;
            b.y = br.y + br.h + b.r;
        } else {
            b.vy = -b.vy;
        }

        br.alive = false;
        run.bricksAlive--;
        run.score += br.points;
        // Row-pitched brick ping (higher rows = higher note).
        if (run.audio && run.audio.tone) {
            run.audio.tone(400 + br.row * 60, 0.07, "square", 0.6);
        } else {
            run.play("brick");
        }
        run.save.maybeHighScore(run.score);
        return;
    }
}

function loseLife(run) {
    run.lives--;
    run.play("life");
    if (run.lives <= 0) {
        run.play("gameover");
        run.endEvent = "gameover";
    } else {
        resetBall(run);
    }
}
