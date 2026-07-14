// Invaders — arcade plugin.
// Rules, drawing, and cues live here. Screens / loop / pause / high score: /lib/arcade.

// ── Layout ───────────────────────────────────────────────────────────────

const ROWS = 5;
const COLS = 11;
const ENEMY_W = 32;
const ENEMY_H = 22;
const ENEMY_HGAP = 14;
const ENEMY_VGAP = 14;
const ENEMY_STEP_Y = 18;

const PLAYER_W = 42;
const PLAYER_H = 18;
const PLAYER_SPEED = 320; // px/s
const PLAYER_BULLET_SPEED = 560;
const ENEMY_BULLET_SPEED = 240;

const SHIELD_COUNT = 4;
const SHIELD_W = 72;
const SHIELD_H = 44;
const SHIELD_CELL = 4;
const SHIELD_COLS = SHIELD_W / SHIELD_CELL; // 18
const SHIELD_ROWS = SHIELD_H / SHIELD_CELL; // 11

const DIE_MS = 1200;

// Invader pixel frames (type 0 back/30, 1 mid/20, 2 front/10)
const INV_PIXELS = {
    2: [
        "001111110000",
        "011111111000",
        "111111111100",
        "110110011010",
        "111111111110",
        "001100110010",
        "010000001010",
        "001100110000",
    ],
    1: [
        "000110011000",
        "001111111100",
        "011111111110",
        "110110011011",
        "111111111111",
        "010111111010",
        "100100001010",
        "010000001010",
    ],
    0: [
        "000011110000",
        "000111111000",
        "001111111100",
        "010110011010",
        "011111111110",
        "001101011010",
        "010100101010",
        "001000001000",
    ],
};

const INV_PIXELS_ALT = {
    2: [
        "001111110000",
        "011111111000",
        "111111111100",
        "110110011011",
        "111111111110",
        "011011011010",
        "110000000010",
        "001100110000",
    ],
    1: [
        "000110011000",
        "001111111100",
        "011111111110",
        "110110011010",
        "111111111110",
        "010111111010",
        "010100000100",
        "001010010100",
    ],
    0: [
        "000011110000",
        "000111111000",
        "001111111100",
        "010110011010",
        "011111111110",
        "010110101010",
        "100000010001",
        "010000000100",
    ],
};

// ── Plugin ───────────────────────────────────────────────────────────────

export const game = {
    id: "invaders",
    clearColor: "#000",

    create(ctx) {
        const { w, h } = ctx.view.size();
        const run = {
            score: 0,
            wave: 1,
            lives: 3,
            phase: "playing", // "playing" | "dying"
            player: { x: 0, y: 0, alive: true, dieTimer: 0 },
            bullet: null,
            enemies: [],
            enemyDir: 1,
            enemyStepInterval: 700,
            enemyStepTimer: 0,
            enemyStepPhase: 0,
            enemyBullets: [],
            enemyFireTimer: 0,
            enemyFireInterval: 900,
            ufo: null,
            ufoTimer: 12000 + Math.random() * 8000,
            shields: [],
            particles: [],
            stars: [],
            play: ctx.play,
            highScore: ctx.highScore,
            view: ctx.view,
        };
        initStars(run, w, h);
        initShields(run, w, h);
        initEnemies(run, w, h);
        resetPlayer(run, w, h);
        return run;
    },

    update(run, dt, input) {
        const { w, h } = run.view.size();

        stepStars(run);
        stepParticles(run, dt);

        if (run.phase === "dying") {
            return stepDying(run, dt, w, h);
        }

        if (input.pressed("primary")) fireBullet(run);
        stepPlayer(run, dt, input, w);
        stepPlayerBullet(run, dt);
        if (stepEnemyBullets(run, dt, h)) return;

        run.enemyStepTimer += dt;
        if (run.enemyStepTimer >= run.enemyStepInterval) {
            run.enemyStepTimer = 0;
            stepEnemies(run, w, h);
            if (run.phase === "dying") return;
        }

        stepEnemyFire(run, dt);
        stepUFO(run, dt, w);

        if (!anyEnemyAlive(run)) nextWave(run, w, h);
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        drawStars(run, ctx);
        drawGround(ctx, w, h);
        drawShields(run, ctx);

        for (let i = 0; i < run.enemies.length; i++) {
            if (run.enemies[i].alive) {
                drawInvader(ctx, run.enemies[i], run.enemyStepPhase);
            }
        }

        drawUFO(run, ctx);
        drawBullets(run, ctx);

        if (run.player.alive || run.phase === "dying") {
            drawPlayer(run, ctx);
        }

        drawParticles(run, ctx);
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        const n = 40;
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        for (let i = 0; i < n; i++) {
            // Stable pseudo-random from index so it doesn't flicker.
            const x = ((i * 137 + 41) % 1000) / 1000 * w;
            const y = ((i * 89 + 17) % 1000) / 1000 * h;
            const s = 0.5 + (i % 3) * 0.4;
            ctx.fillRect(x, y, s, s);
        }
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            best: run ? run.highScore() : 0,
            wave: run ? run.wave : 1,
            lives: run ? run.lives : 3,
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const wave = run ? run.wave : 1;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score    " + score + tag + "\n" +
            "Wave     " + wave + "\n" +
            "Best     " + best
        );
    },

    // Game SFX only — menu move/select tones are shell-owned.
    cue(name, audio) {
        if (name === "shoot") audio.tone(880, 0.08, "square", 0.4);
        else if (name === "hit") audio.tone(200, 0.12, "sawtooth", 0.6);
        else if (name === "kill") audio.tone(120, 0.18, "sawtooth", 0.7);
        else if (name === "step0") audio.tone(90, 0.08, "triangle", 0.5);
        else if (name === "step1") audio.tone(120, 0.08, "triangle", 0.5);
        else if (name === "ufo") audio.tone(660, 0.15, "square", 0.5);
        else if (name === "die") {
            audio.sequence([
                [300, 0.2, "sawtooth", 0.6],
                [200, 0.25, "sawtooth", 0.6],
                [100, 0.35, "sawtooth", 0.6],
            ]);
        }
    },
};

// ── Ambient ──────────────────────────────────────────────────────────────

function initStars(run, W, H) {
    run.stars = [];
    for (let i = 0; i < 60; i++) {
        run.stars.push({
            x: Math.random() * W,
            y: Math.random() * H,
            a: 0.2 + Math.random() * 0.6,
            s: 0.3 + Math.random() * 1.2,
        });
    }
}

function stepStars(run) {
    for (let i = 0; i < run.stars.length; i++) {
        const s = run.stars[i];
        s.a += (Math.random() - 0.5) * 0.03;
        if (s.a < 0.15) s.a = 0.15;
        if (s.a > 0.9) s.a = 0.9;
    }
}

// ── Shields ──────────────────────────────────────────────────────────────

function buildShield(x, y) {
    const grid = [];
    for (let r = 0; r < SHIELD_ROWS; r++) {
        const row = [];
        for (let c = 0; c < SHIELD_COLS; c++) {
            let on = true;
            const cx = SHIELD_COLS / 2;
            // Notch at bottom-center
            if (r >= SHIELD_ROWS - 4) {
                const distFromCenter = Math.abs(c - cx + 0.5);
                if (distFromCenter < 3 - (SHIELD_ROWS - 1 - r) * 0.8) on = false;
            }
            // Rounded top corners
            if (r < 2) {
                if (c < 1 || c > SHIELD_COLS - 2) on = false;
            }
            row.push(on);
        }
        grid.push(row);
    }
    return { x, y, grid };
}

function initShields(run, W, H) {
    run.shields = [];
    const baseY = H - 170;
    const span = W - 120;
    const startX = 60;
    const gap = (span - SHIELD_W * SHIELD_COUNT) / (SHIELD_COUNT - 1);
    for (let i = 0; i < SHIELD_COUNT; i++) {
        const x = startX + i * (SHIELD_W + gap);
        run.shields.push(buildShield(x, baseY));
    }
}

/** Carve a crater; returns true if a solid cell was hit. */
function shieldHit(run, px, py, radius) {
    radius = radius || 0;
    for (let i = 0; i < run.shields.length; i++) {
        const s = run.shields[i];
        if (px < s.x - radius || px > s.x + SHIELD_W + radius) continue;
        if (py < s.y - radius || py > s.y + SHIELD_H + radius) continue;
        const lx = px - s.x;
        const ly = py - s.y;
        const cc = Math.floor(lx / SHIELD_CELL);
        const cr = Math.floor(ly / SHIELD_CELL);
        if (cr < 0 || cr >= SHIELD_ROWS || cc < 0 || cc >= SHIELD_COLS) continue;
        if (s.grid[cr][cc]) {
            const cw = 2;
            const ch = 2;
            for (let dr = -ch; dr <= ch; dr++) {
                for (let dc = -cw; dc <= cw; dc++) {
                    const rr = cr + dr;
                    const ccc = cc + dc;
                    if (rr >= 0 && rr < SHIELD_ROWS && ccc >= 0 && ccc < SHIELD_COLS) {
                        if (Math.abs(dr) + Math.abs(dc) <= 3) s.grid[rr][ccc] = false;
                    }
                }
            }
            return true;
        }
    }
    return false;
}

// ── Rules ────────────────────────────────────────────────────────────────

function stepDying(run, dt, w, h) {
    run.player.dieTimer -= dt;
    if (run.player.dieTimer <= 0) {
        run.lives = Math.max(0, run.lives - 1);
        if (run.lives <= 0) return { status: "gameover" };
        resetPlayer(run, w, h);
        run.phase = "playing";
    }
}

function stepPlayer(run, dt, input, w) {
    if (input.down("left")) run.player.x -= PLAYER_SPEED * dt / 1000;
    if (input.down("right")) run.player.x += PLAYER_SPEED * dt / 1000;
    if (run.player.x < 20) run.player.x = 20;
    if (run.player.x + PLAYER_W > w - 20) run.player.x = w - 20 - PLAYER_W;
}

function stepPlayerBullet(run, dt) {
    if (!run.bullet) return;
    run.bullet.y += run.bullet.vy * dt / 1000;
    const bx = run.bullet.x;
    const by = run.bullet.y;

    if (by < 0) {
        run.bullet = null;
        return;
    }
    if (shieldHit(run, bx, by, 0)) {
        run.bullet = null;
        run.play("hit");
        spawnExplosion(run, bx, by, "#4fff6a", 5);
        return;
    }
    if (
        run.ufo &&
        bx >= run.ufo.x && bx <= run.ufo.x + 40 &&
        by >= run.ufo.y && by <= run.ufo.y + 16
    ) {
        run.score += run.ufo.points;
        spawnExplosion(run, run.ufo.x + 20, run.ufo.y + 8, "#ff5080", 20);
        run.play("kill");
        run.ufo = null;
        run.bullet = null;
        return;
    }

    for (let i = 0; i < run.enemies.length; i++) {
        const en = run.enemies[i];
        if (!en.alive) continue;
        if (
            bx >= en.x && bx <= en.x + ENEMY_W &&
            by >= en.y && by <= en.y + ENEMY_H
        ) {
            en.alive = false;
            const pts = [30, 20, 10][en.type];
            run.score += pts;
            spawnExplosion(run, en.x + ENEMY_W / 2, en.y + ENEMY_H / 2, "#4fff6a", 14);
            run.play("kill");
            run.bullet = null;
            recomputeStepInterval(run);
            return;
        }
    }
}

/** @returns {boolean} true if player death was triggered this frame */
function stepEnemyBullets(run, dt, h) {
    for (let i = run.enemyBullets.length - 1; i >= 0; i--) {
        const eb = run.enemyBullets[i];
        eb.y += eb.vy * dt / 1000;
        if (eb.y > h) {
            run.enemyBullets.splice(i, 1);
            continue;
        }
        if (shieldHit(run, eb.x, eb.y, 0)) {
            spawnExplosion(run, eb.x, eb.y, "#ff8040", 4);
            run.enemyBullets.splice(i, 1);
            continue;
        }
        // Cancel vs player bullet
        if (run.bullet) {
            const dx = eb.x - run.bullet.x;
            const dy = eb.y - run.bullet.y;
            if (dx * dx + dy * dy < 64) {
                run.bullet = null;
                run.enemyBullets.splice(i, 1);
                spawnExplosion(run, eb.x, eb.y, "#fff", 6);
                continue;
            }
        }
        if (
            run.player.alive &&
            eb.x >= run.player.x && eb.x <= run.player.x + PLAYER_W &&
            eb.y >= run.player.y && eb.y <= run.player.y + PLAYER_H
        ) {
            run.enemyBullets.splice(i, 1);
            triggerPlayerDeath(run);
            return true;
        }
    }
    return false;
}

function stepEnemies(run, W, H) {
    let moveDown = false;
    let leftMost = Infinity;
    let rightMost = -Infinity;
    for (let i = 0; i < run.enemies.length; i++) {
        const e = run.enemies[i];
        if (!e.alive) continue;
        if (e.x < leftMost) leftMost = e.x;
        if (e.x + ENEMY_W > rightMost) rightMost = e.x + ENEMY_W;
    }
    if (!isFinite(leftMost)) return;

    const dx = 10 + (run.wave - 1) * 1;
    let dir = run.enemyDir;
    if (dir > 0 && rightMost + dx > W - 20) {
        moveDown = true;
        dir = -1;
    } else if (dir < 0 && leftMost - dx < 20) {
        moveDown = true;
        dir = 1;
    }

    for (let j = 0; j < run.enemies.length; j++) {
        const en = run.enemies[j];
        if (!en.alive) continue;
        if (moveDown) en.y += ENEMY_STEP_Y;
        else en.x += dir * dx;
    }
    run.enemyDir = dir;
    run.enemyStepPhase = 1 - run.enemyStepPhase;
    run.play("step" + (run.enemyStepPhase % 4));

    // Invaders reached the player line
    const playerTop = run.player.y;
    for (let k = 0; k < run.enemies.length; k++) {
        const ek = run.enemies[k];
        if (!ek.alive) continue;
        if (ek.y + ENEMY_H >= playerTop) {
            run.lives = 0;
            triggerPlayerDeath(run);
            return;
        }
    }
}

function stepEnemyFire(run, dt) {
    run.enemyFireTimer += dt;
    if (run.enemyFireTimer < run.enemyFireInterval) return;
    run.enemyFireTimer = 0;
    run.enemyFireInterval = 400 + Math.random() * (900 - (run.wave - 1) * 40);
    if (run.enemyFireInterval < 200) run.enemyFireInterval = 200;
    if (run.enemyBullets.length < 3) enemyFire(run);
}

function stepUFO(run, dt, w) {
    if (run.ufo) {
        run.ufo.x += run.ufo.vx * dt / 1000;
        if (
            (run.ufo.vx > 0 && run.ufo.x > w + 40) ||
            (run.ufo.vx < 0 && run.ufo.x < -40)
        ) {
            run.ufo = null;
        }
    } else {
        run.ufoTimer -= dt;
        if (run.ufoTimer <= 0) maybeSpawnUFO(run, w);
    }
}

function anyEnemyAlive(run) {
    for (let i = 0; i < run.enemies.length; i++) {
        if (run.enemies[i].alive) return true;
    }
    return false;
}

function initEnemies(run, W, H) {
    run.enemies = [];
    const gridW = COLS * ENEMY_W + (COLS - 1) * ENEMY_HGAP;
    const startX = (W - gridW) / 2;
    const startY = 100 + Math.min(60, (run.wave - 1) * 12);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            // type: 0 = back (squid, 30), 1 = mid (crab, 20), 2 = front (octopus, 10)
            let type;
            if (r === 0) type = 0;
            else if (r <= 2) type = 1;
            else type = 2;
            run.enemies.push({
                col: c,
                row: r,
                x: startX + c * (ENEMY_W + ENEMY_HGAP),
                y: startY + r * (ENEMY_H + ENEMY_VGAP),
                alive: true,
                type,
            });
        }
    }
    run.enemyDir = 1;
    run.enemyStepTimer = 0;
    run.enemyStepPhase = 0;
    run.enemyBullets = [];
    run.enemyFireTimer = 0;
    run.enemyFireInterval = Math.max(280, 950 - (run.wave - 1) * 80);
    recomputeStepInterval(run);
}

function recomputeStepInterval(run) {
    let alive = 0;
    for (let i = 0; i < run.enemies.length; i++) {
        if (run.enemies[i].alive) alive++;
    }
    const total = ROWS * COLS;
    let base = 760 - (run.wave - 1) * 60;
    if (base < 220) base = 220;
    const frac = alive / total;
    let ms = base * (0.15 + frac * 0.85);
    if (ms < 40) ms = 40;
    run.enemyStepInterval = ms;
}

function enemyFire(run) {
    // Lowest living enemy per column
    const cols = {};
    for (let i = 0; i < run.enemies.length; i++) {
        const e = run.enemies[i];
        if (!e.alive) continue;
        if (!cols[e.col] || e.y > cols[e.col].y) cols[e.col] = e;
    }
    const list = [];
    for (const k in cols) list.push(cols[k]);
    if (list.length === 0) return;
    const pick = list[Math.floor(Math.random() * list.length)];
    run.enemyBullets.push({
        x: pick.x + ENEMY_W / 2,
        y: pick.y + ENEMY_H,
        vy: ENEMY_BULLET_SPEED + (run.wave - 1) * 10,
    });
}

function maybeSpawnUFO(run, W) {
    if (run.ufo) return;
    run.ufoTimer = 15000 + Math.random() * 10000;
    const leftToRight = Math.random() < 0.5;
    run.ufo = {
        x: leftToRight ? -30 : W + 30,
        y: 70,
        vx: leftToRight ? 140 : -140,
        points: [50, 100, 150, 300][Math.floor(Math.random() * 4)],
    };
    run.play("ufo");
}

function resetPlayer(run, W, H) {
    run.player.x = W / 2 - PLAYER_W / 2;
    run.player.y = H - 70;
    run.player.alive = true;
    run.player.dieTimer = 0;
    run.bullet = null;
}

function triggerPlayerDeath(run) {
    if (!run.player.alive) return;
    run.player.alive = false;
    run.player.dieTimer = DIE_MS;
    run.phase = "dying";
    run.play("die");
    spawnExplosion(
        run,
        run.player.x + PLAYER_W / 2,
        run.player.y + PLAYER_H / 2,
        "#fff",
        30
    );
}

function fireBullet(run) {
    if (!run.player.alive) return;
    if (run.bullet) return;
    run.bullet = {
        x: run.player.x + PLAYER_W / 2,
        y: run.player.y,
        vy: -PLAYER_BULLET_SPEED,
    };
    run.play("shoot");
}

function nextWave(run, W, H) {
    run.wave += 1;
    run.bullet = null;
    run.enemyBullets = [];
    run.ufo = null;
    initShields(run, W, H);
    initEnemies(run, W, H);
    resetPlayer(run, W, H);
    run.phase = "playing";
}

// ── Particles ────────────────────────────────────────────────────────────

function spawnExplosion(run, x, y, color, count) {
    count = count || 12;
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 40 + Math.random() * 140;
        run.particles.push({
            x,
            y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            life: 400 + Math.random() * 300,
            age: 0,
            color: color || "#fff",
        });
    }
}

function stepParticles(run, dt) {
    for (let i = run.particles.length - 1; i >= 0; i--) {
        const p = run.particles[i];
        p.age += dt;
        p.x += p.vx * dt / 1000;
        p.y += p.vy * dt / 1000;
        p.vx *= 0.96;
        p.vy *= 0.96;
        if (p.age >= p.life) run.particles.splice(i, 1);
    }
}

// ── Draw ─────────────────────────────────────────────────────────────────

function drawStars(run, ctx) {
    for (let i = 0; i < run.stars.length; i++) {
        const s = run.stars[i];
        ctx.fillStyle = "rgba(255,255,255," + s.a.toFixed(2) + ")";
        ctx.fillRect(s.x, s.y, s.s, s.s);
    }
}

function drawGround(ctx, W, H) {
    ctx.fillStyle = "#4fff6a";
    ctx.fillRect(20, H - 40, W - 40, 2);
}

function drawPlayer(run, ctx) {
    if (!run.player.alive && run.phase === "dying") {
        const t = Math.floor(run.player.dieTimer / 60);
        if (t % 2 === 0) return;
        ctx.fillStyle = "#ff5050";
    } else {
        ctx.fillStyle = "#ffffff";
    }
    const x = run.player.x;
    const y = run.player.y;
    ctx.fillRect(x, y + 10, PLAYER_W, 8);
    ctx.fillRect(x + 6, y + 4, PLAYER_W - 12, 8);
    ctx.fillRect(x + PLAYER_W / 2 - 2, y - 2, 4, 8);
}

function drawInvader(ctx, e, phase) {
    const frames = phase ? INV_PIXELS_ALT : INV_PIXELS;
    const grid = frames[e.type];
    const cellW = ENEMY_W / 12;
    const cellH = ENEMY_H / 8;
    ctx.fillStyle = e.type === 0 ? "#8fff8f" : (e.type === 1 ? "#5fff6a" : "#3fdd4a");
    for (let r = 0; r < 8; r++) {
        const row = grid[r];
        for (let c = 0; c < 12; c++) {
            if (row.charCodeAt(c) === 49) {
                ctx.fillRect(e.x + c * cellW, e.y + r * cellH, cellW + 0.5, cellH + 0.5);
            }
        }
    }
}

function drawShields(run, ctx) {
    ctx.fillStyle = "#6fff8a";
    for (let i = 0; i < run.shields.length; i++) {
        const s = run.shields[i];
        for (let r = 0; r < SHIELD_ROWS; r++) {
            for (let c = 0; c < SHIELD_COLS; c++) {
                if (s.grid[r][c]) {
                    ctx.fillRect(
                        s.x + c * SHIELD_CELL,
                        s.y + r * SHIELD_CELL,
                        SHIELD_CELL,
                        SHIELD_CELL
                    );
                }
            }
        }
    }
}

function drawBullets(run, ctx) {
    if (run.bullet) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(run.bullet.x - 1, run.bullet.y - 6, 2, 10);
    }
    ctx.fillStyle = "#ffcc40";
    for (let i = 0; i < run.enemyBullets.length; i++) {
        const b = run.enemyBullets[i];
        ctx.fillRect(b.x - 1, b.y - 4, 2, 8);
    }
}

function drawUFO(run, ctx) {
    if (!run.ufo) return;
    const x = run.ufo.x;
    const y = run.ufo.y;
    ctx.fillStyle = "#ff5080";
    ctx.fillRect(x + 4, y + 6, 32, 6);
    ctx.fillRect(x + 8, y + 2, 24, 4);
    ctx.fillRect(x, y + 10, 40, 4);
    ctx.fillStyle = "#ffa0c0";
    ctx.fillRect(x + 14, y + 4, 4, 2);
    ctx.fillRect(x + 22, y + 4, 4, 2);
}

function drawParticles(run, ctx) {
    for (let i = 0; i < run.particles.length; i++) {
        const p = run.particles[i];
        let a = 1 - (p.age / p.life);
        if (a < 0) a = 0;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
}
