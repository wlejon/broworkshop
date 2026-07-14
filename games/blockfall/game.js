// Blockfall — falling-block puzzle on the arcade foundation.
// Domain: board.js + particles.js. Shell owns screens / loop / pause / HUD.

import { Board } from "/app/board.js";
import { FX } from "/app/particles.js";

const DAS_DELAY = 167;
const DAS_ARR = 33;
const SOFT_DROP_RATE = 30;
const COUNTDOWN_STEP = 700;
const COUNTDOWN_TOTAL = 3200;

export const game = {
    id: "blockfall",
    clearColor: "#06060a",

    actions: [
        { name: "secondary", label: "Hold", defaults: ["c", "Shift"] },
        { name: "rotate_ccw", label: "Rotate CCW", defaults: ["q", "z"] },
    ],

    defaults: {
        highScore: 0,
        startLevel: 1,
    },

    create(ctx) {
        const startLevel = ctx.save.get("startLevel") || 1;
        Board._play = (name) => ctx.play(name);
        Board.settings.startLevel = startLevel;
        Board.settings.ghostPiece = true;
        Board.settings.gridLines = true;
        Board.startGame("marathon");
        ctx.play("countdown");

        return {
            score: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            // Internal countdown while shell screen is already "playing"
            phase: "countdown",
            countdownTimer: 0,
            countdownPhase: 3,
            das: { dir: 0, timer: 0, active: false },
            softDrop: { active: false, timer: 0 },
            alive: true,
        };
    },

    update(run, dt, input) {
        if (run.phase === "countdown") {
            updateCountdown(run, dt, input);
            FX.update(dt);
            syncScore(run);
            return;
        }

        if (!run.alive) return { status: "gameover" };

        const B = Board;
        B.gameTime += dt;

        if (B.mode === "ultra") {
            B.modeTimer -= dt;
            if (B.checkModeEnd()) {
                B.cur = null;
                run.alive = false;
                syncScore(run);
                run.play("clear1");
                return { status: "gameover", result: { finished: true } };
            }
        }

        handleInput(run, input);
        if (!run.alive) {
            syncScore(run);
            return {
                status: "gameover",
                result: B.finished ? { finished: true } : null,
            };
        }

        if (!B.cur) {
            syncScore(run);
            return;
        }

        stepDas(run, dt);
        stepSoftDrop(run, dt);
        stepGravity(run, dt);
        stepLock(run, dt);

        if (!run.alive) {
            syncScore(run);
            return {
                status: "gameover",
                result: B.finished ? { finished: true } : null,
            };
        }

        FX.update(dt);
        syncScore(run);
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        Board.calcLayout(w, h);

        const shake = FX.getShakeOffset();
        ctx.save();
        ctx.translate(shake.x, shake.y);
        Board.drawBoard(ctx);
        Board.drawPreviews(ctx);
        FX.drawParticles(ctx);
        ctx.restore();

        if (run && run.phase === "countdown") {
            drawCountdown(ctx, w, h, run);
        }
    },

    hud(run) {
        if (!run) {
            return { score: 0, best: 0, level: 1, lines: 0, combo: "—" };
        }
        return {
            score: Board.score,
            best: run.highScore(),
            level: Board.level,
            lines: Board.totalLines,
            combo: Board.combo > 0 ? String(Board.combo) : "—",
        };
    },

    gameOverText(run) {
        const B = Board;
        const score = B.score;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        const header = B.finished ? "Complete!" : "Game Over";
        return (
            header + "\n\n" +
            "Score    " + score + tag + "\n" +
            "Best     " + best + "\n" +
            "Level    " + B.level + "\n" +
            "Lines    " + B.totalLines + "\n" +
            "Time     " + B.formatTime(B.gameTime) + "\n\n" +
            "Singles  " + B.stats.singles + "  Doubles  " + B.stats.doubles + "\n" +
            "Triples  " + B.stats.triples + "  Quads    " + B.stats.tetrises + "\n" +
            "Max Combo  " + B.stats.maxCombo
        );
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "move") audio.tone(200, 0.05, "square", 0.4);
        else if (name === "rotate") audio.tone(300, 0.06, "square", 0.5);
        else if (name === "drop") audio.tone(120, 0.12, "triangle", 0.8);
        else if (name === "lock") audio.tone(160, 0.08, "triangle", 0.5);
        else if (name === "hold") audio.tone(250, 0.06, "sine", 0.4);
        else if (name === "clear1") audio.tone(523, 0.15, "square", 0.6);
        else if (name === "clear2") audio.tone(659, 0.15, "square", 0.7);
        else if (name === "clear3") audio.tone(784, 0.18, "square", 0.8);
        else if (name === "tetris") {
            audio.sequence([
                [523, 0.1, "square", 0.8],
                [659, 0.1, "square", 0.8],
                [784, 0.12, "square", 0.9],
                [1047, 0.2, "square", 1.0],
            ]);
        } else if (name === "levelup") {
            audio.sequence([
                [440, 0.08, "sine", 0.6],
                [554, 0.08, "sine", 0.7],
                [659, 0.12, "sine", 0.8],
            ]);
        } else if (name === "combo") audio.tone(520, 0.1, "square", 0.6);
        else if (name === "countdown") audio.tone(440, 0.15, "sine", 0.6);
        else if (name === "go") audio.tone(880, 0.2, "square", 0.8);
        else if (name === "die") {
            audio.sequence([
                [300, 0.2, "sawtooth", 0.5],
                [250, 0.2, "sawtooth", 0.5],
                [200, 0.4, "sawtooth", 0.5],
            ]);
        }
    },
};

// ── Score / end ──────────────────────────────────────────────────────────

function syncScore(run) {
    run.score = Board.score;
}

function topOut(run) {
    Board.cur = null;
    Board.finished = false;
    run.alive = false;
    syncScore(run);
    run.play("die");
    return { status: "gameover" };
}

// ── Countdown ────────────────────────────────────────────────────────────

function updateCountdown(run, dt, input) {
    run.countdownTimer += dt;
    const newPhase = 3 - Math.floor(run.countdownTimer / COUNTDOWN_STEP);
    if (newPhase < run.countdownPhase && newPhase >= 0) {
        run.countdownPhase = newPhase;
        if (run.countdownPhase > 0) run.play("countdown");
        else run.play("go");
    }
    if (run.countdownTimer < COUNTDOWN_TOTAL) return;

    run.phase = "playing";
    // Drain edges so presses during countdown don't fire on GO
    input.pressed("left");
    input.pressed("right");
    input.pressed("down");
    input.pressed("up");
    input.pressed("primary");
    input.pressed("secondary");
    input.pressed("rotate_ccw");
    run.das.dir = 0;
    run.das.timer = 0;
    run.das.active = false;
    run.softDrop.active = false;
    run.softDrop.timer = 0;
    // Held keys arm DAS / soft drop without a free one-shot
    if (input.down("left")) run.das.dir = -1;
    else if (input.down("right")) run.das.dir = 1;
    if (input.down("down")) run.softDrop.active = true;
}

function drawCountdown(ctx, w, h, run) {
    const label = run.countdownPhase > 0 ? String(run.countdownPhase) : "GO!";
    const color = run.countdownPhase > 0 ? "#4fc3f7" : "#00e676";
    ctx.save();
    ctx.font = "bold 96px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.fillText(label, w / 2, h * 0.4);
    ctx.restore();
}

// ── Input ────────────────────────────────────────────────────────────────

function handleInput(run, input) {
    const B = Board;

    if (input.pressed("left")) {
        B.moveLeft();
        armDas(run, -1);
    }
    if (input.pressed("right")) {
        B.moveRight();
        armDas(run, 1);
    }
    // Release ends DAS; opposite held re-arms
    if (run.das.dir === -1 && !input.down("left")) {
        run.das.dir = 0;
        run.das.active = false;
        if (input.down("right")) armDas(run, 1);
    }
    if (run.das.dir === 1 && !input.down("right")) {
        run.das.dir = 0;
        run.das.active = false;
        if (input.down("left")) armDas(run, -1);
    }

    if (input.pressed("down")) {
        run.softDrop.active = true;
        run.softDrop.timer = 0;
        if (B.moveDown()) B.score += 1;
    }
    if (!input.down("down")) run.softDrop.active = false;

    if (input.pressed("primary")) {
        if (!B.hardDrop()) {
            topOut(run);
            return;
        }
        if (B.checkModeEnd()) {
            B.cur = null;
            run.alive = false;
            syncScore(run);
        }
    }

    if (input.pressed("up")) B.rotateCW();
    if (input.pressed("rotate_ccw")) B.rotateCCW();
    if (input.pressed("secondary")) B.doHold();
}

function armDas(run, dir) {
    run.das.dir = dir;
    run.das.timer = 0;
    run.das.active = false;
}

// ── Timing ───────────────────────────────────────────────────────────────

function stepDas(run, dt) {
    if (run.das.dir === 0) return;
    const B = Board;
    run.das.timer += dt;
    if (!run.das.active) {
        if (run.das.timer >= DAS_DELAY) {
            run.das.active = true;
            run.das.timer = 0;
        }
        return;
    }
    while (run.das.timer >= DAS_ARR) {
        run.das.timer -= DAS_ARR;
        if (run.das.dir === -1) B.moveLeft();
        else if (run.das.dir === 1) B.moveRight();
    }
}

function stepSoftDrop(run, dt) {
    if (!run.softDrop.active) return;
    const B = Board;
    run.softDrop.timer += dt;
    while (run.softDrop.timer >= SOFT_DROP_RATE) {
        run.softDrop.timer -= SOFT_DROP_RATE;
        if (B.moveDown()) B.score += 1;
    }
}

function stepGravity(run, dt) {
    if (run.softDrop.active) return;
    const B = Board;
    B.dropInterval = B.getDropInterval();
    B.dropTimer += dt;
    while (B.dropTimer >= B.dropInterval) {
        B.dropTimer -= B.dropInterval;
        B.moveDown();
    }
}

function stepLock(run, dt) {
    const B = Board;
    if (!B.cur) return;
    if (B.canPlace(B.cur.type, B.cur.x, B.cur.y + 1, B.cur.rot)) {
        B.lockTimer = 0;
        return;
    }
    B.lockTimer += dt;
    if (B.lockTimer < B.lockDelay) return;

    const lockResult = B.lockPiece();
    if (lockResult === -1) {
        topOut(run);
        return;
    }
    if (B.checkModeEnd()) {
        B.cur = null;
        run.alive = false;
        syncScore(run);
        return;
    }
    if (!B.spawnPiece()) topOut(run);
}
