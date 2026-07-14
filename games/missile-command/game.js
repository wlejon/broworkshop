// Missile Command — defend cities from ICBMs (arcade plugin).
// Rules, drawing, and cues only. Screens / loop / input shell: /lib/arcade.

const NUM_CITIES = 6;
const NUM_SILOS = 3;
const AMMO_PER_SILO = 10;
const GROUND_Y_FRAC = 0.88;
const SILO_Y_FRAC = 0.85;
const CITY_Y_FRAC = 0.88;
const MAX_EXPLOSION_R = 48;
const EXPLOSION_GROW = 140;
const EXPLOSION_SHRINK = 60;
const PLAYER_MISSILE_SPEED = 520;
const BOMB_SCORE = 25;
const CITY_BONUS = 100;
const AMMO_BONUS = 5;
const CITY_HIT_RANGE = 22;
const SILO_HIT_RANGE_X = 28;
const SILO_HIT_RANGE_Y = 40;

export const game = {
    id: "missile-command",
    clearColor: "#05050c",

    create(ctx) {
        if (ctx.input) ctx.input.clear();
        const run = {
            score: 0,
            wave: 1,
            cities: [],
            silos: [],
            enemies: [],
            players: [],
            explosions: [],
            spawnQueue: [],
            spawnCursor: 0,
            waveTimer: 0,
            waveDuration: 0,
            waveEnemiesRemaining: 0,
            waveOverTimer: 0,
            waveStatsText: "",
            mouseX: 0,
            mouseY: 0,
            stars: null,
            view: ctx.view,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
        };
        attachPointer(run);
        resetBattlefield(run);
        beginWave(run);
        return run;
    },

    update(run, dt, input) {
        const view = run.view;
        const W = view.width();
        const H = view.height();
        const ds = dt / 1000;

        if (input.pressed("primary")) {
            const y = Math.min(run.mouseY, H * GROUND_Y_FRAC - 8);
            launchPlayerMissile(run, run.mouseX, y);
        }

        run.waveTimer += ds;
        drainSpawnQueue(run, W, H);
        stepEnemies(run, ds, W, H);
        stepPlayers(run, ds);
        stepExplosions(run, ds);

        run.enemies = run.enemies.filter((e) => e.alive);
        run.players = run.players.filter((p) => p.alive);
        run.explosions = run.explosions.filter((x) => x.alive);

        if (!anyCityAlive(run)) {
            run.waveOverTimer += ds;
            if (run.waveOverTimer > 1.5) {
                run.play("gameOver");
                return { status: "gameover" };
            }
            return;
        }

        if (waveCleared(run)) {
            run.waveOverTimer += ds;
            if (run.waveOverTimer > 0.8) {
                completeWave(run);
                return { status: "screen", name: "wavecomplete" };
            }
        }
    },

    draw(run, ctx, view) {
        const { w: W, h: H } = view.size();
        const groundY = H * GROUND_Y_FRAC;

        drawStars(run, ctx, W, H);

        ctx.fillStyle = "#2a1a05";
        ctx.fillRect(0, groundY, W, H - groundY);
        ctx.strokeStyle = "#ff8000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(W, groundY);
        ctx.stroke();

        for (let i = 0; i < run.cities.length; i++) {
            const c = run.cities[i];
            if (!c.alive) {
                ctx.fillStyle = "#442";
                ctx.fillRect(c.x - 18, groundY - 6, 36, 6);
                continue;
            }
            drawCity(ctx, c.x, groundY);
        }

        for (let s = 0; s < run.silos.length; s++) {
            drawSilo(ctx, run.silos[s], groundY);
        }

        drawEnemyMissiles(ctx, run);
        drawPlayerMissiles(ctx, run);
        drawExplosions(ctx, run);
        drawCrosshair(ctx, run.mouseX, run.mouseY);
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            wave: run ? run.wave : 1,
            best: run ? run.highScore() : 0,
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

    cue(name, audio) {
        if (name === "launch") audio.tone(220, 0.08, "sawtooth", 0.4);
        else if (name === "explode") audio.tone(90 + Math.random() * 40, 0.25, "sawtooth", 0.7);
        else if (name === "cityHit") audio.tone(60, 0.5, "sawtooth", 0.9);
        else if (name === "siloHit") audio.tone(80, 0.4, "sawtooth", 0.8);
        else if (name === "waveEnd") {
            audio.sequence([
                [523, 0.12, "square", 0.6],
                [659, 0.12, "square", 0.6],
                [784, 0.16, "square", 0.7],
            ]);
        } else if (name === "gameOver") {
            audio.sequence([
                [220, 0.3, "sawtooth", 0.6],
                [180, 0.3, "sawtooth", 0.6],
                [140, 0.6, "sawtooth", 0.7],
            ]);
        }
    },

    onMenuAction(action, run, api) {
        if (action === "continue" && run) {
            run.wave++;
            beginWave(run);
            if (api && api.input) api.input.clear();
            return "playing";
        }
    },

    onEnterScreen(name, run, api) {
        if (name === "wavecomplete" && run) {
            const el = document.getElementById("wave-stats");
            if (el) el.textContent = run.waveStatsText || "";
        }
        if (name === "title") {
            const t = document.getElementById("title-hi");
            if (t && api) t.textContent = String(api.highScore());
        }
    },
};

// ── Pointer ──────────────────────────────────────────────────────────────

/** One mousemove listener per canvas; always targets the latest run. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    try { canvas.style.cursor = "crosshair"; } catch (e) { /* ignore */ }
    canvas._mcRun = run;
    if (canvas._mcPointer) return;
    canvas._mcPointer = (ev) => {
        const r = canvas._mcRun;
        if (!r || !r.view) return;
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        const W = r.view.width();
        const H = r.view.height();
        if (rect) {
            const sx = W / (rect.width || 1);
            const sy = H / (rect.height || 1);
            r.mouseX = (ev.clientX - rect.left) * sx;
            r.mouseY = (ev.clientY - rect.top) * sy;
        } else {
            r.mouseX = typeof ev.offsetX === "number" ? ev.offsetX : ev.clientX;
            r.mouseY = typeof ev.offsetY === "number" ? ev.offsetY : ev.clientY;
        }
    };
    canvas.addEventListener("mousemove", canvas._mcPointer);
}

// ── Battlefield / waves ──────────────────────────────────────────────────

function resetBattlefield(run) {
    const W = run.view.width();
    const H = run.view.height();
    run.cities = [];
    run.silos = [];

    const siloXs = [W * 0.08, W * 0.5, W * 0.92];
    const cityXs = [W * 0.20, W * 0.28, W * 0.36, W * 0.64, W * 0.72, W * 0.80];
    for (let i = 0; i < siloXs.length && i < NUM_SILOS; i++) {
        run.silos.push({ x: siloXs[i], y: H * SILO_Y_FRAC, ammo: AMMO_PER_SILO, alive: true });
    }
    for (let j = 0; j < cityXs.length && j < NUM_CITIES; j++) {
        run.cities.push({ x: cityXs[j], y: H * CITY_Y_FRAC, alive: true });
    }
    run.enemies.length = 0;
    run.players.length = 0;
    run.explosions.length = 0;
}

function beginWave(run) {
    for (let i = 0; i < run.silos.length; i++) {
        if (run.silos[i].alive) run.silos[i].ammo = AMMO_PER_SILO;
    }
    const count = 10 + run.wave * 4;
    const duration = 28;
    run.spawnQueue = [];
    for (let k = 0; k < count; k++) {
        run.spawnQueue.push(Math.random() * duration * 0.85);
    }
    run.spawnQueue.sort((a, b) => a - b);
    run.spawnCursor = 0;
    run.waveTimer = 0;
    run.waveDuration = duration;
    run.waveEnemiesRemaining = count;
    run.waveOverTimer = 0;
    run.enemies.length = 0;
    run.players.length = 0;
    run.explosions.length = 0;
}

function completeWave(run) {
    let surviving = 0;
    for (let i = 0; i < run.cities.length; i++) {
        if (run.cities[i].alive) surviving++;
    }
    let ammoLeft = 0;
    for (let j = 0; j < run.silos.length; j++) {
        if (run.silos[j].alive) ammoLeft += run.silos[j].ammo;
    }
    const cityBonus = surviving * CITY_BONUS;
    const ammoBonus = ammoLeft * AMMO_BONUS;
    run.score += cityBonus + ammoBonus;

    // Restore one destroyed city every 2 waves
    if (run.wave % 2 === 0) {
        for (let c = 0; c < run.cities.length; c++) {
            if (!run.cities[c].alive) {
                run.cities[c].alive = true;
                break;
            }
        }
    }

    run.play("waveEnd");
    run.waveStatsText =
        "Cities saved: " + surviving + " x " + CITY_BONUS + " = " + cityBonus + "\n" +
        "Unused missiles: " + ammoLeft + " x " + AMMO_BONUS + " = " + ammoBonus + "\n" +
        "Total score: " + run.score;
}

function anyCityAlive(run) {
    for (let i = 0; i < run.cities.length; i++) {
        if (run.cities[i].alive) return true;
    }
    return false;
}

function waveCleared(run) {
    return run.spawnCursor >= run.spawnQueue.length &&
        run.enemies.length === 0 &&
        run.players.length === 0 &&
        run.explosions.length === 0;
}

function aliveTargets(run) {
    const targets = [];
    for (let i = 0; i < run.cities.length; i++) {
        if (run.cities[i].alive) targets.push({ x: run.cities[i].x, y: run.cities[i].y });
    }
    for (let j = 0; j < run.silos.length; j++) {
        if (run.silos[j].alive) targets.push({ x: run.silos[j].x, y: run.silos[j].y });
    }
    return targets;
}

// ── Spawn ────────────────────────────────────────────────────────────────

function enemySpeed(run) {
    let base = 40 + run.wave * 8;
    if (base > 140) base = 140;
    return base;
}

function drainSpawnQueue(run, W, H) {
    while (run.spawnCursor < run.spawnQueue.length &&
           run.spawnQueue[run.spawnCursor] <= run.waveTimer) {
        spawnEnemy(run, W, H);
        run.spawnCursor++;
    }
}

function spawnEnemy(run, W, H) {
    const x = Math.random() * W;
    const targets = aliveTargets(run);
    if (targets.length === 0) return;
    const tgt = targets[(Math.random() * targets.length) | 0];
    const dx = tgt.x - x;
    const dy = tgt.y - 0;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const spd = enemySpeed(run);
    const splitChance = Math.min(0.05 + run.wave * 0.02, 0.35);
    const split = (run.wave >= 3 && Math.random() < splitChance);
    const splitAt = split ? (0.25 + Math.random() * 0.35) : -1;
    run.enemies.push({
        x, y: 0,
        sx: x, sy: 0,
        tx: tgt.x, ty: tgt.y,
        vx: dx / len * spd,
        vy: dy / len * spd,
        alive: true,
        split,
        splitAt,
        hasSplit: false,
    });
}

function splitEnemy(run, e) {
    for (let k = 0; k < 2; k++) {
        const targets = aliveTargets(run);
        if (targets.length === 0) return;
        const tgt = targets[(Math.random() * targets.length) | 0];
        const dx = tgt.x - e.x;
        const dy = tgt.y - e.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const spd = enemySpeed(run);
        run.enemies.push({
            x: e.x, y: e.y,
            sx: e.x, sy: e.y,
            tx: tgt.x, ty: tgt.y,
            vx: dx / len * spd,
            vy: dy / len * spd,
            alive: true,
            split: false,
            splitAt: -1,
            hasSplit: true,
        });
    }
}

// ── Fire ─────────────────────────────────────────────────────────────────

function launchPlayerMissile(run, targetX, targetY) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < run.silos.length; i++) {
        const s = run.silos[i];
        if (!s.alive || s.ammo <= 0) continue;
        const dx = s.x - targetX;
        const dy = s.y - targetY;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    if (best < 0) return false;
    const silo = run.silos[best];
    silo.ammo--;
    const dx = targetX - silo.x;
    const dy = targetY - silo.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    run.players.push({
        sx: silo.x, sy: silo.y,
        x: silo.x, y: silo.y,
        tx: targetX, ty: targetY,
        vx: dx / len * PLAYER_MISSILE_SPEED,
        vy: dy / len * PLAYER_MISSILE_SPEED,
        alive: true,
    });
    run.play("launch");
    return true;
}

function stepPlayers(run, ds) {
    for (let p = 0; p < run.players.length; p++) {
        const pm = run.players[p];
        if (!pm.alive) continue;
        pm.x += pm.vx * ds;
        pm.y += pm.vy * ds;
        const dx = pm.tx - pm.x;
        const dy = pm.ty - pm.y;
        let reached = false;
        if (pm.vx >= 0 ? pm.x >= pm.tx : pm.x <= pm.tx) {
            if (pm.vy >= 0 ? pm.y >= pm.ty : pm.y <= pm.ty) {
                reached = true;
            }
        }
        if (dx * dx + dy * dy < 25) reached = true;
        if (reached) {
            pm.alive = false;
            createExplosion(run, pm.tx, pm.ty, false);
        }
    }
}

// ── Enemies ──────────────────────────────────────────────────────────────

function stepEnemies(run, ds, W, H) {
    const groundY = H * GROUND_Y_FRAC;
    for (let i = 0; i < run.enemies.length; i++) {
        const e = run.enemies[i];
        if (!e.alive) continue;
        e.x += e.vx * ds;
        e.y += e.vy * ds;

        if (e.split && !e.hasSplit) {
            const progY = e.y / (e.ty || 1);
            if (progY >= e.splitAt) {
                e.hasSplit = true;
                e.alive = false;
                splitEnemy(run, e);
                run.waveEnemiesRemaining += 1;
                continue;
            }
        }

        if (e.y >= e.ty || e.y >= groundY) {
            e.alive = false;
            run.waveEnemiesRemaining--;
            impactEnemy(run, e, groundY);
        }
    }
}

function impactEnemy(run, e, groundY) {
    const impactX = e.x;
    for (let ci = 0; ci < run.cities.length; ci++) {
        const c = run.cities[ci];
        if (c.alive && Math.abs(c.x - impactX) < CITY_HIT_RANGE) {
            c.alive = false;
            run.play("cityHit");
            createExplosion(run, c.x, c.y, true);
            return;
        }
    }
    for (let si = 0; si < run.silos.length; si++) {
        const s = run.silos[si];
        if (s.alive && Math.abs(s.x - impactX) < SILO_HIT_RANGE_X &&
            Math.abs(e.y - s.y) < SILO_HIT_RANGE_Y) {
            s.alive = false;
            s.ammo = 0;
            run.play("siloHit");
            createExplosion(run, s.x, s.y, true);
            return;
        }
    }
    createExplosion(run, e.x, groundY, true);
}

// ── Explosions ───────────────────────────────────────────────────────────

function createExplosion(run, x, y, fromEnemy) {
    run.explosions.push({
        x, y, r: 2, maxR: MAX_EXPLOSION_R,
        growing: true, alive: true, fromEnemy: !!fromEnemy,
    });
    run.play("explode");
}

function stepExplosions(run, ds) {
    for (let ex = 0; ex < run.explosions.length; ex++) {
        const xp = run.explosions[ex];
        if (!xp.alive) continue;
        if (xp.growing) {
            xp.r += EXPLOSION_GROW * ds;
            if (xp.r >= xp.maxR) {
                xp.r = xp.maxR;
                xp.growing = false;
            }
        } else {
            xp.r -= EXPLOSION_SHRINK * ds;
            if (xp.r <= 0) {
                xp.alive = false;
                xp.r = 0;
            }
        }
        if (!xp.alive) continue;
        for (let ei = 0; ei < run.enemies.length; ei++) {
            const ee = run.enemies[ei];
            if (!ee.alive) continue;
            const ddx = ee.x - xp.x;
            const ddy = ee.y - xp.y;
            if (ddx * ddx + ddy * ddy <= xp.r * xp.r) {
                ee.alive = false;
                run.waveEnemiesRemaining--;
                if (!xp.fromEnemy) run.score += BOMB_SCORE;
                createExplosion(run, ee.x, ee.y, false);
            }
        }
    }
}

// ── Draw ─────────────────────────────────────────────────────────────────

function drawStars(run, ctx, W, H) {
    if (!run.stars || run.stars.w !== W || run.stars.h !== H) {
        run.stars = { w: W, h: H, pts: [] };
        for (let i = 0; i < 80; i++) {
            run.stars.pts.push({
                x: Math.random() * W,
                y: Math.random() * H * GROUND_Y_FRAC,
                b: 0.3 + Math.random() * 0.7,
            });
        }
    }
    for (let j = 0; j < run.stars.pts.length; j++) {
        const s = run.stars.pts[j];
        ctx.fillStyle = "rgba(255,255,255," + s.b.toFixed(2) + ")";
        ctx.fillRect(s.x, s.y, 1, 1);
    }
}

function drawCity(ctx, cx, gy) {
    ctx.fillStyle = "#6ad3ff";
    const heights = [10, 16, 12, 18, 14];
    const bw = 6;
    const total = heights.length * bw;
    const x0 = cx - total / 2;
    for (let i = 0; i < heights.length; i++) {
        const h = heights[i];
        ctx.fillRect(x0 + i * bw + 1, gy - h, bw - 2, h);
    }
    ctx.strokeStyle = "rgba(106,211,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, gy - 18, total, 18);
}

function drawSilo(ctx, silo, gy) {
    const x = silo.x;
    if (!silo.alive) {
        ctx.fillStyle = "#332";
        ctx.fillRect(x - 20, gy - 6, 40, 6);
        return;
    }
    ctx.fillStyle = "#ffb060";
    ctx.beginPath();
    ctx.moveTo(x - 22, gy);
    ctx.lineTo(x + 22, gy);
    ctx.lineTo(x + 14, gy - 18);
    ctx.lineTo(x - 14, gy - 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffef7a";
    const ammo = silo.ammo;
    const slots = [
        [0, -24],
        [-5, -20], [5, -20],
        [-10, -16], [0, -16], [10, -16],
        [-12, -12], [-4, -12], [4, -12], [12, -12],
    ];
    const dotR = 2;
    for (let i = 0; i < ammo && i < slots.length; i++) {
        const d = slots[i];
        ctx.beginPath();
        ctx.arc(x + d[0], gy + d[1], dotR, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawEnemyMissiles(ctx, run) {
    for (let ei = 0; ei < run.enemies.length; ei++) {
        const e = run.enemies[ei];
        if (!e.alive) continue;
        ctx.strokeStyle = "rgba(255,80,80,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.sx, e.sy);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
        ctx.fillStyle = "#ffef7a";
        ctx.beginPath();
        ctx.arc(e.x, e.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPlayerMissiles(ctx, run) {
    for (let pi = 0; pi < run.players.length; pi++) {
        const p = run.players[pi];
        if (!p.alive) continue;
        ctx.strokeStyle = "rgba(120,220,255,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.strokeStyle = "rgba(120,220,255,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.tx - 4, p.ty - 4);
        ctx.lineTo(p.tx + 4, p.ty + 4);
        ctx.moveTo(p.tx + 4, p.ty - 4);
        ctx.lineTo(p.tx - 4, p.ty + 4);
        ctx.stroke();
        ctx.fillStyle = "#cfefff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawExplosions(ctx, run) {
    for (let xi = 0; xi < run.explosions.length; xi++) {
        const xp = run.explosions[xi];
        if (!xp.alive) continue;
        const hue = xp.fromEnemy ? "#ff4040" : "#ffef7a";
        const outer = xp.fromEnemy ? "rgba(255,64,64,0.15)" : "rgba(255,220,120,0.2)";
        ctx.fillStyle = outer;
        ctx.beginPath();
        ctx.arc(xp.x, xp.y, xp.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hue;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(xp.x, xp.y, xp.r * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = hue;
        ctx.beginPath();
        ctx.arc(xp.x, xp.y, Math.max(1, xp.r * 0.3), 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCrosshair(ctx, x, y) {
    ctx.strokeStyle = "rgba(180,255,180,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x - 3, y);
    ctx.moveTo(x + 3, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y - 3);
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
}
