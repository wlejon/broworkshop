// Asteroids — arcade plugin.
// Rules, drawing, and cues live here. Screens / loop / pause / high score: /lib/arcade.

// ── Ship / bullets ───────────────────────────────────────────────────────

const SHIP_ROT_SPEED = 0.005; // rad / ms
const SHIP_THRUST = 0.00018;  // px / ms^2
const SHIP_MAX_SPEED = 0.5;   // px / ms
const SHIP_DRAG = 0.9995;     // per ms
const SHIP_RADIUS = 12;
const BULLET_SPEED = 0.6;     // px / ms
const BULLET_LIFE = 900;      // ms
const BULLET_COOLDOWN = 160;  // ms
const MAX_BULLETS = 5;
const RESPAWN_DELAY = 1200;   // ms
const INVULN_TIME = 2500;     // ms
const EXTRA_LIFE_AT = 10000;

// ── Asteroids ────────────────────────────────────────────────────────────

const AST_SIZES = {
    large: { r: 42, score: 20, next: "medium" },
    medium: { r: 22, score: 50, next: "small" },
    small: { r: 12, score: 100, next: null },
};

const AST_SPEEDS = { large: 0.04, medium: 0.07, small: 0.1 };

const SHIP_SHAPE = [
    { x: 14, y: 0 },
    { x: -10, y: -9 },
    { x: -6, y: 0 },
    { x: -10, y: 9 },
];

// Ambient title rocks (drawTitle has no run; shell has no title update).
const titleField = { rocks: [], lastT: 0 };

// ── Plugin ───────────────────────────────────────────────────────────────

export const game = {
    id: "asteroids",
    clearColor: "#000000",

    // Relabel standard actions for this control scheme (bindings stay shared).
    actions: [
        { name: "left", label: "Rotate Left", defaults: ["a", "ArrowLeft"] },
        { name: "right", label: "Rotate Right", defaults: ["d", "ArrowRight"] },
        { name: "up", label: "Thrust", defaults: ["w", "ArrowUp"] },
        { name: "primary", label: "Fire", defaults: [" ", "Mouse0"] },
        { name: "secondary", label: "Mouse Thrust", defaults: ["Shift", "Mouse2"] },
    ],

    create(ctx) {
        const { w, h } = ctx.view.size();
        const run = {
            score: 0,
            lives: 3,
            wave: 1,
            ship: null,
            asteroids: [],
            bullets: [],
            particles: [],
            respawnTimer: 0,
            invulnTimer: 0,
            cooldown: 0,
            nextExtraLife: EXTRA_LIFE_AT,
            gameOver: false,
            pointerX: w / 2,
            pointerY: h / 2,
            play: ctx.play,
            highScore: ctx.highScore,
            view: ctx.view,
        };

        attachPointer(run);
        run.ship = makeShip(w, h);
        run.invulnTimer = INVULN_TIME;
        spawnWave(run, 1);
        return run;
    },

    update(run, dt, input) {
        if (run.gameOver) return { status: "gameover" };

        const W = run.view.width();
        const H = run.view.height();

        if (run.cooldown > 0) run.cooldown -= dt;
        if (run.invulnTimer > 0) run.invulnTimer -= dt;

        stepShip(run, dt, input, W, H);
        stepBullets(run, dt, W, H);
        stepAsteroids(run, dt, W, H);
        resolveBulletHits(run, W, H);
        resolveShipHits(run, W, H);
        stepParticles(run, dt, W, H);

        if (run.asteroids.length === 0 && !run.gameOver) {
            spawnWave(run, run.wave + 1);
        }

        if (run.gameOver) return { status: "gameover" };
    },

    draw(run, ctx, view) {
        const W = view.width();
        const H = view.height();

        for (let i = 0; i < run.asteroids.length; i++) {
            const a = run.asteroids[i];
            drawWrapped(ctx, W, H, a.radius + 2, a.x, a.y, (cx, cy) => {
                drawPolygon(ctx, a.shape, cx, cy, a.rot, true, "#ffffff", 1.5);
            });
        }

        for (let j = 0; j < run.bullets.length; j++) {
            const b = run.bullets[j];
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
        }

        if (run.ship) {
            const s = run.ship;
            drawWrapped(ctx, W, H, 20, s.x, s.y, (cx, cy) => {
                drawShip(ctx, s, cx, cy, run.invulnTimer);
            });
        }

        drawParticles(run, ctx);
    },

    drawTitle(ctx, view) {
        const W = view.width();
        const H = view.height();
        ensureTitleField(W, H);
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        let dt = titleField.lastT ? now - titleField.lastT : 16;
        if (dt > 50) dt = 50;
        titleField.lastT = now;

        for (let i = 0; i < titleField.rocks.length; i++) {
            const a = titleField.rocks[i];
            a.x += a.vx * dt;
            a.y += a.vy * dt;
            a.rot += a.rotSpeed * dt;
            if (a.x < -a.radius) a.x = W + a.radius;
            else if (a.x > W + a.radius) a.x = -a.radius;
            if (a.y < -a.radius) a.y = H + a.radius;
            else if (a.y > H + a.radius) a.y = -a.radius;

            ctx.globalAlpha = a.alpha;
            drawPolygon(ctx, a.shape, a.x, a.y, a.rot, true, "#ffffff", 1);
        }
        ctx.globalAlpha = 1;
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
        if (name === "fire") audio.tone(880, 0.08, "square", 0.3);
        else if (name === "bang-large") {
            audio.sequence([
                [80, 0.12, "sawtooth", 0.7],
                [50, 0.2, "sawtooth", 0.5],
            ]);
        } else if (name === "bang-med") {
            audio.sequence([
                [120, 0.1, "sawtooth", 0.55],
                [70, 0.12, "sawtooth", 0.4],
            ]);
        } else if (name === "bang-small") {
            audio.tone(200, 0.1, "sawtooth", 0.45);
        } else if (name === "ship-explode") {
            audio.sequence([
                [90, 0.2, "sawtooth", 0.7],
                [55, 0.25, "sawtooth", 0.55],
                [40, 0.2, "sawtooth", 0.4],
            ]);
        } else if (name === "extra-life") {
            audio.sequence([
                [523, 0.08, "square", 0.6],
                [659, 0.08, "square", 0.6],
                [784, 0.12, "square", 0.7],
            ]);
        } else if (name === "wave") {
            audio.tone(330, 0.15, "triangle", 0.6);
        }
    },
};

// ── Pointer ──────────────────────────────────────────────────────────────

/** One listener per canvas; always targets the latest run on that canvas. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._asteroidsRun = run;
    if (canvas._asteroidsPointer) return;
    canvas._asteroidsPointer = (e) => {
        const r = canvas._asteroidsRun;
        if (!r || !r.view) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        r.pointerX = ((e.clientX - rect.left) / rect.width) * r.view.width();
        r.pointerY = ((e.clientY - rect.top) / rect.height) * r.view.height();
    };
    canvas.addEventListener("mousemove", canvas._asteroidsPointer);
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
}

// ── World ────────────────────────────────────────────────────────────────

function wrap(v, max) {
    if (v < 0) return v + max;
    if (v >= max) return v - max;
    return v;
}

function distSq(ax, ay, bx, by, W, H) {
    let dx = Math.abs(ax - bx);
    let dy = Math.abs(ay - by);
    if (dx > W * 0.5) dx = W - dx;
    if (dy > H * 0.5) dy = H - dy;
    return dx * dx + dy * dy;
}

// ── Rules ────────────────────────────────────────────────────────────────

function makeShip(W, H) {
    return {
        x: W / 2,
        y: H / 2,
        vx: 0,
        vy: 0,
        angle: -Math.PI / 2,
        thrusting: false,
        alive: true,
    };
}

function makeAsteroidShape(radius) {
    const pts = [];
    const n = 10 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = radius * (0.75 + Math.random() * 0.45);
        pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
}

function createAsteroid(x, y, size) {
    const info = AST_SIZES[size];
    const angle = Math.random() * Math.PI * 2;
    const speed = AST_SPEEDS[size] * (0.6 + Math.random() * 0.8);
    return {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: 0,
        rotSpeed: (Math.random() - 0.5) * 0.0015,
        radius: info.r,
        size,
        shape: makeAsteroidShape(info.r),
    };
}

function spawnWave(run, waveNum) {
    run.wave = waveNum;
    run.asteroids.length = 0;
    let count = 3 + waveNum;
    if (count > 10) count = 10;
    const W = run.view.width();
    const H = run.view.height();
    const cx = run.ship ? run.ship.x : W / 2;
    const cy = run.ship ? run.ship.y : H / 2;
    const safe = 180;
    for (let i = 0; i < count; i++) {
        let x, y, tries = 0;
        do {
            x = Math.random() * W;
            y = Math.random() * H;
            tries++;
        } while (tries < 20 && distSq(x, y, cx, cy, W, H) < safe * safe);
        run.asteroids.push(createAsteroid(x, y, "large"));
    }
    run.play("wave");
}

function stepShip(run, dt, input, W, H) {
    const s = run.ship;
    if (s && s.alive) {
        const mouseSteer = input.down("secondary");
        if (mouseSteer) {
            const dx = run.pointerX - s.x;
            const dy = run.pointerY - s.y;
            if (dx * dx + dy * dy > 16) {
                const target = Math.atan2(dy, dx);
                let diff = target - s.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const step = SHIP_ROT_SPEED * dt;
                if (diff > step) s.angle += step;
                else if (diff < -step) s.angle -= step;
                else s.angle = target;
            }
        } else {
            if (input.down("left")) s.angle -= SHIP_ROT_SPEED * dt;
            if (input.down("right")) s.angle += SHIP_ROT_SPEED * dt;
        }

        s.thrusting = mouseSteer || input.down("up");
        if (s.thrusting) {
            s.vx += Math.cos(s.angle) * SHIP_THRUST * dt;
            s.vy += Math.sin(s.angle) * SHIP_THRUST * dt;
            const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
            if (sp > SHIP_MAX_SPEED) {
                s.vx = (s.vx / sp) * SHIP_MAX_SPEED;
                s.vy = (s.vy / sp) * SHIP_MAX_SPEED;
            }
            if (Math.random() < 0.6) {
                spawnParticles(run, s.x - Math.cos(s.angle) * 10, s.y - Math.sin(s.angle) * 10, 1, {
                    speed: 0.05,
                    vx: -Math.cos(s.angle) * 0.15,
                    vy: -Math.sin(s.angle) * 0.15,
                    life: 250,
                    lifeVar: 150,
                    color: "#ffaa44",
                });
            }
        }

        const drag = Math.pow(SHIP_DRAG, dt);
        s.vx *= drag;
        s.vy *= drag;
        s.x = wrap(s.x + s.vx * dt, W);
        s.y = wrap(s.y + s.vy * dt, H);

        if (input.pressed("primary")) fireBullet(run);
    } else if (!run.gameOver) {
        run.respawnTimer -= dt;
        if (run.respawnTimer <= 0) respawnShip(run, W, H);
    }
}

function stepBullets(run, dt, W, H) {
    for (let i = run.bullets.length - 1; i >= 0; i--) {
        const b = run.bullets[i];
        b.life -= dt;
        if (b.life <= 0) {
            run.bullets.splice(i, 1);
            continue;
        }
        b.x = wrap(b.x + b.vx * dt, W);
        b.y = wrap(b.y + b.vy * dt, H);
    }
}

function stepAsteroids(run, dt, W, H) {
    for (let i = 0; i < run.asteroids.length; i++) {
        const a = run.asteroids[i];
        a.x = wrap(a.x + a.vx * dt, W);
        a.y = wrap(a.y + a.vy * dt, H);
        a.rot += a.rotSpeed * dt;
    }
}

function resolveBulletHits(run, W, H) {
    for (let bi = run.bullets.length - 1; bi >= 0; bi--) {
        const bul = run.bullets[bi];
        for (let ai = run.asteroids.length - 1; ai >= 0; ai--) {
            const ast = run.asteroids[ai];
            if (distSq(bul.x, bul.y, ast.x, ast.y, W, H) < ast.radius * ast.radius) {
                run.bullets.splice(bi, 1);
                run.asteroids.splice(ai, 1);
                explodeAsteroid(run, ast, bul.vx, bul.vy);
                break;
            }
        }
    }
}

function resolveShipHits(run, W, H) {
    const s = run.ship;
    if (!s || !s.alive || run.invulnTimer > 0) return;
    for (let i = 0; i < run.asteroids.length; i++) {
        const a = run.asteroids[i];
        const rr = a.radius + SHIP_RADIUS * 0.7;
        if (distSq(s.x, s.y, a.x, a.y, W, H) < rr * rr) {
            killShip(run);
            run.asteroids.splice(i, 1);
            explodeAsteroid(run, a, s.vx, s.vy);
            return;
        }
    }
}

function fireBullet(run) {
    if (!run.ship || !run.ship.alive) return;
    if (run.bullets.length >= MAX_BULLETS) return;
    if (run.cooldown > 0) return;
    const s = run.ship;
    const nx = Math.cos(s.angle);
    const ny = Math.sin(s.angle);
    run.bullets.push({
        x: s.x + nx * 14,
        y: s.y + ny * 14,
        vx: nx * BULLET_SPEED + s.vx,
        vy: ny * BULLET_SPEED + s.vy,
        life: BULLET_LIFE,
    });
    run.cooldown = BULLET_COOLDOWN;
    run.play("fire");
}

function explodeAsteroid(run, ast, bulletVx, bulletVy) {
    const info = AST_SIZES[ast.size];
    run.score += info.score;
    const count = ast.size === "large" ? 22 : ast.size === "medium" ? 14 : 8;
    spawnParticles(run, ast.x, ast.y, count, {
        speed: 0.2,
        life: 500,
        lifeVar: 400,
        color: "#ffffff",
    });
    if (ast.size === "large") run.play("bang-large");
    else if (ast.size === "medium") run.play("bang-med");
    else run.play("bang-small");

    if (info.next) {
        for (let i = 0; i < 2; i++) {
            const child = createAsteroid(ast.x, ast.y, info.next);
            const a = Math.random() * Math.PI * 2;
            const sp = AST_SPEEDS[info.next] * (0.8 + Math.random() * 0.6);
            child.vx = Math.cos(a) * sp + (bulletVx || 0) * 0.2;
            child.vy = Math.sin(a) * sp + (bulletVy || 0) * 0.2;
            run.asteroids.push(child);
        }
    }

    if (run.score >= run.nextExtraLife) {
        run.lives++;
        run.nextExtraLife += EXTRA_LIFE_AT;
        run.play("extra-life");
    }
}

function killShip(run) {
    if (!run.ship || !run.ship.alive) return;
    const s = run.ship;
    s.alive = false;
    spawnParticles(run, s.x, s.y, 30, {
        speed: 0.25,
        life: 700,
        lifeVar: 500,
        color: "#ffffff",
    });
    run.play("ship-explode");
    run.lives--;
    if (run.lives <= 0) {
        run.gameOver = true;
    } else {
        run.respawnTimer = RESPAWN_DELAY;
    }
}

function respawnShip(run, W, H) {
    const cx = W / 2;
    const cy = H / 2;
    const safe = 100;
    for (let i = 0; i < run.asteroids.length; i++) {
        const a = run.asteroids[i];
        if (distSq(a.x, a.y, cx, cy, W, H) < (safe + a.radius) * (safe + a.radius)) {
            run.respawnTimer = 200;
            return;
        }
    }
    run.ship = makeShip(W, H);
    run.invulnTimer = INVULN_TIME;
}

// ── Particles ────────────────────────────────────────────────────────────

function spawnParticles(run, x, y, count, opts) {
    opts = opts || {};
    const baseSpeed = opts.speed != null ? opts.speed : 0.15;
    const baseLife = opts.life != null ? opts.life : 600;
    const lifeVar = opts.lifeVar != null ? opts.lifeVar : 400;
    const biasX = opts.vx || 0;
    const biasY = opts.vy || 0;
    const color = opts.color || "#ffffff";
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = baseSpeed * (0.5 + Math.random());
        run.particles.push({
            x,
            y,
            vx: Math.cos(ang) * sp + biasX,
            vy: Math.sin(ang) * sp + biasY,
            life: baseLife + Math.random() * lifeVar,
            maxLife: baseLife + lifeVar,
            color,
        });
    }
    if (run.particles.length > 600) {
        run.particles.splice(0, run.particles.length - 600);
    }
}

function stepParticles(run, dt, W, H) {
    for (let i = run.particles.length - 1; i >= 0; i--) {
        const p = run.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
            run.particles.splice(i, 1);
            continue;
        }
        p.x = wrap(p.x + p.vx * dt, W);
        p.y = wrap(p.y + p.vy * dt, H);
    }
}

// ── Draw ─────────────────────────────────────────────────────────────────

function drawPolygon(ctx, pts, x, y, rot, close, stroke, lineWidth) {
    ctx.strokeStyle = stroke || "#ffffff";
    ctx.lineWidth = lineWidth != null ? lineWidth : 1.5;
    ctx.beginPath();
    const c = Math.cos(rot);
    const si = Math.sin(rot);
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const px = x + p.x * c - p.y * si;
        const py = y + p.x * si + p.y * c;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    if (close) ctx.closePath();
    ctx.stroke();
}

function drawWrapped(ctx, W, H, radius, x, y, drawFn) {
    drawFn(x, y);
    let ox = 0;
    let oy = 0;
    if (x < radius) ox = W;
    else if (x > W - radius) ox = -W;
    if (y < radius) oy = H;
    else if (y > H - radius) oy = -H;
    if (ox !== 0) drawFn(x + ox, y);
    if (oy !== 0) drawFn(x, y + oy);
    if (ox !== 0 && oy !== 0) drawFn(x + ox, y + oy);
}

function drawShip(ctx, s, x, y, invuln) {
    if (!s.alive) return;
    if (invuln > 0 && Math.floor(invuln / 100) % 2 === 0) return;
    drawPolygon(ctx, SHIP_SHAPE, x, y, s.angle, true, "#ffffff", 1.5);
    if (s.thrusting && Math.random() < 0.7) {
        const flame = [
            { x: -6, y: -4 },
            { x: -14, y: 0 },
            { x: -6, y: 4 },
        ];
        drawPolygon(ctx, flame, x, y, s.angle, false, "#ff9933", 1.5);
    }
}

function drawParticles(run, ctx) {
    for (let i = 0; i < run.particles.length; i++) {
        const p = run.particles[i];
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
}

// ── Title ambient ────────────────────────────────────────────────────────

function ensureTitleField(W, H) {
    if (titleField.rocks.length) return;
    for (let i = 0; i < 8; i++) {
        const radius = 18 + Math.random() * 30;
        const a = Math.random() * Math.PI * 2;
        const sp = 0.02 + Math.random() * 0.04;
        titleField.rocks.push({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.0008,
            radius,
            shape: makeAsteroidShape(radius),
            alpha: 0.15 + Math.random() * 0.15,
        });
    }
}
