// Chomper — Pac-Man-style arcade plugin.
// Rules, drawing, and cues only. Screens / loop / input: /lib/arcade.

import { Maze } from "/app/maze.js";
import { Ghosts, DIRS } from "/app/ghosts.js";

const PAC_SPEED = 7.0; // tiles per second
const DIE_MS = 1400;
const FRIGHT_BLINK_MS = 200;
const FRIGHT_WARN_MS = 2000;

export const game = {
    id: "chomper",
    clearColor: "#000",

    create(ctx) {
        const run = {
            score: 0,
            lives: 3,
            level: 1,
            phase: "playing", // "playing" | "dying"
            stateTimer: 0,
            frightenBlinkTimer: 0,
            frightBlinkOn: false,
            ghostChainBonus: 0,
            chompToggle: false,
            pac: {
                c: 0,
                r: 0,
                dir: 1,
                nextDir: -1,
                mouthAnim: 0,
                alive: true,
            },
            play: ctx.play,
            highScore: ctx.highScore,
        };
        startLevel(run);
        return run;
    },

    update(run, dt, input) {
        if (run.phase === "dying") {
            run.stateTimer -= dt;
            if (run.stateTimer <= 0) {
                if (run.lives <= 0) return { status: "gameover" };
                resetPac(run);
                Ghosts.resetAll();
                run.phase = "playing";
            }
            return;
        }

        bufferTurn(run, input);
        updatePac(run, dt);
        Ghosts.update(dt, run.pac);
        checkCollisions(run);

        if (run.phase === "dying") return;

        updateFrightBlink(run, dt);

        if (Maze.pelletCount <= 0) {
            run.play("win");
            return { status: "screen", name: "levelclear" };
        }
    },

    draw(run, ctx, view) {
        const { w: W, h: H } = view.size();
        const layout = computeLayout(W, H);

        Maze.draw(ctx, layout.ox, layout.oy, layout.tile);

        if (run.phase === "dying") {
            const t = 1 - run.stateTimer / DIE_MS;
            drawDying(ctx, run.pac, layout.ox, layout.oy, layout.tile, t);
            return;
        }

        drawPac(ctx, run.pac, layout.ox, layout.oy, layout.tile);
        Ghosts.draw(ctx, layout.ox, layout.oy, layout.tile, run.frightBlinkOn);
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            high: run ? run.highScore() : 0,
            lives: run ? run.lives : 3,
            level: run ? run.level : 1,
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
                    "Level " + run.level + " clear!\nScore: " + run.score;
            }
        }
    },

    onMenuAction(action, run) {
        if (action === "nextlevel" && run) {
            run.level++;
            startLevel(run);
            return "playing";
        }
    },

    // Game SFX only — menu move/select tones are shell-owned.
    cue(name, audio) {
        if (name === "chompHi") audio.tone(440, 0.04, "square", 0.3);
        else if (name === "chompLo") audio.tone(330, 0.04, "square", 0.3);
        else if (name === "power") audio.tone(220, 0.3, "sawtooth", 0.5);
        else if (name === "eatghost") {
            audio.sequence([
                [523, 0.08, "square", 0.6],
                [659, 0.08, "square", 0.6],
                [784, 0.12, "square", 0.7],
            ]);
        } else if (name === "die") {
            audio.sequence([
                [400, 0.15, "sawtooth", 0.6],
                [300, 0.15, "sawtooth", 0.6],
                [200, 0.3, "sawtooth", 0.6],
            ]);
        } else if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.7],
                [659, 0.1, "square", 0.7],
                [784, 0.1, "square", 0.7],
                [1047, 0.2, "square", 0.8],
            ]);
        }
    },
};

// ── Input ────────────────────────────────────────────────────────────────

function bufferTurn(run, input) {
    // Rising-edge direction buffer (Pac-Man style).
    if (input.pressed("right")) run.pac.nextDir = 0;
    else if (input.pressed("left")) run.pac.nextDir = 1;
    else if (input.pressed("up")) run.pac.nextDir = 2;
    else if (input.pressed("down")) run.pac.nextDir = 3;
}

// ── Level / pac ──────────────────────────────────────────────────────────

function startLevel(run) {
    Maze.reset();
    Ghosts.init();
    resetPac(run);
    run.phase = "playing";
    run.stateTimer = 0;
    run.frightenBlinkTimer = 0;
    run.frightBlinkOn = false;
    run.ghostChainBonus = 0;
}

function resetPac(run) {
    const pac = run.pac;
    pac.c = Maze.pacmanSpawn.c;
    pac.r = Maze.pacmanSpawn.r;
    pac.dir = 1;
    pac.nextDir = -1;
    pac.mouthAnim = 0;
    pac.alive = true;
}

function canMove(c, r, dir) {
    const d = DIRS[dir];
    const nc = Maze.wrapCol(Math.round(c) + d.dx);
    const nr = Math.round(r) + d.dy;
    return Maze.isPassableForPac(nc, nr);
}

function updatePac(run, dt) {
    const pac = run.pac;
    if (!pac.alive) return;

    const dtS = dt / 1000;
    const step = PAC_SPEED * dtS;

    const ci = Math.round(pac.c);
    const ri = Math.round(pac.r);
    const atCenter =
        Math.abs(pac.c - ci) < step * 0.7 &&
        Math.abs(pac.r - ri) < step * 0.7;

    if (atCenter && pac.nextDir >= 0 && pac.nextDir !== pac.dir) {
        if (canMove(ci, ri, pac.nextDir)) {
            pac.c = ci;
            pac.r = ri;
            pac.dir = pac.nextDir;
            pac.nextDir = -1;
        }
    }

    const d = DIRS[pac.dir];
    if (atCenter && !canMove(pac.c, pac.r, pac.dir)) {
        pac.c = ci;
        pac.r = ri;
        return;
    }

    pac.c += d.dx * step;
    pac.r += d.dy * step;
    pac.c = Maze.wrapCol(pac.c);
    if (pac.c < -0.5) pac.c = Maze.COLS - 0.5;
    if (pac.c > Maze.COLS - 0.5) pac.c = -0.5;

    pac.mouthAnim += dt * 0.012;

    const eaten = Maze.eatPelletAt(Math.round(pac.c), Math.round(pac.r));
    if (eaten === ".") {
        run.score += 10;
        run.chompToggle = !run.chompToggle;
        run.play(run.chompToggle ? "chompHi" : "chompLo");
    } else if (eaten === "o") {
        run.score += 50;
        run.play("power");
        run.ghostChainBonus = 0;
        Ghosts.frightenAll(Math.max(3000, 8000 - (run.level - 1) * 500));
    }
}

// ── Rules ────────────────────────────────────────────────────────────────

function checkCollisions(run) {
    const pac = run.pac;
    if (!pac.alive) return;

    for (let i = 0; i < Ghosts.list.length; i++) {
        const g = Ghosts.list[i];
        if (g.mode === "eaten" || g.mode === "house" || g.mode === "leaving") continue;
        const dc = g.c - pac.c;
        const dr = g.r - pac.r;
        if (dc * dc + dr * dr < 0.55 * 0.55) {
            if (g.mode === "frightened") {
                run.ghostChainBonus++;
                let pts = 200 * Math.pow(2, run.ghostChainBonus - 1);
                if (pts > 1600) pts = 1600;
                run.score += pts;
                g.mode = "eaten";
                run.play("eatghost");
            } else {
                loseLife(run);
                return;
            }
        }
    }
}

function loseLife(run) {
    run.play("die");
    run.lives--;
    run.phase = "dying";
    run.stateTimer = DIE_MS;
    run.pac.alive = false;
}

function updateFrightBlink(run, dt) {
    let anyFright = false;
    let minTimer = Infinity;
    for (let i = 0; i < Ghosts.list.length; i++) {
        const g = Ghosts.list[i];
        if (g.mode === "frightened") {
            anyFright = true;
            if (g.frightenedTimer < minTimer) minTimer = g.frightenedTimer;
        }
    }
    if (anyFright && minTimer < FRIGHT_WARN_MS) {
        run.frightenBlinkTimer += dt;
        if (run.frightenBlinkTimer > FRIGHT_BLINK_MS) {
            run.frightenBlinkTimer = 0;
            run.frightBlinkOn = !run.frightBlinkOn;
        }
    } else {
        run.frightBlinkOn = false;
    }
}

// ── Draw ─────────────────────────────────────────────────────────────────

function computeLayout(W, H) {
    // Leave room for the shared left HUD panel.
    const marginL = 160;
    const margin = 24;
    const availW = W - marginL - margin;
    const availH = H - margin * 2;
    const tile = Math.floor(Math.min(availW / Maze.COLS, availH / Maze.ROWS));
    const ox = marginL + Math.floor((availW - tile * Maze.COLS) / 2);
    const oy = margin + Math.floor((availH - tile * Maze.ROWS) / 2);
    return { tile: Math.max(tile, 4), ox, oy };
}

function drawPac(ctx, pac, ox, oy, tile) {
    const cx = ox + pac.c * tile + tile / 2;
    const cy = oy + pac.r * tile + tile / 2;
    const rad = tile * 0.48;
    const mouthOpen = (Math.sin(pac.mouthAnim) + 1) * 0.5;
    const angle = mouthOpen * 0.5;
    let facing = 0;
    if (pac.dir === 0) facing = 0;
    else if (pac.dir === 1) facing = Math.PI;
    else if (pac.dir === 2) facing = -Math.PI / 2;
    else facing = Math.PI / 2;

    ctx.fillStyle = "#ffff00";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rad, facing + angle, facing - angle + Math.PI * 2);
    ctx.closePath();
    ctx.fill();
}

function drawDying(ctx, pac, ox, oy, tile, t) {
    const cx = ox + pac.c * tile + tile / 2;
    const cy = oy + pac.r * tile + tile / 2;
    const rad = tile * 0.48;
    let open = t * Math.PI;
    if (open > Math.PI) open = Math.PI;
    ctx.fillStyle = "#ffff00";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rad, -Math.PI / 2 + open, -Math.PI / 2 - open + Math.PI * 2);
    ctx.closePath();
    ctx.fill();
}
