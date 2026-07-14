// Serpcoil — chain-shooter on the arcade foundation.
// Domain modules: path, chain, shooter, levels, particles.
// Screens / loop / pause / HUD chrome: /lib/arcade.

import { Path } from "/app/path.js";
import { Chain } from "/app/chain.js";
import { Shooter } from "/app/shooter.js";
import { FX } from "/app/particles.js";
import { Levels } from "/app/levels.js";

const BASE_W = 1280;
const BASE_H = 800;

/** Level index used by the next create() call. */
let preferredLevel = 0;
/** Optional RNG seed for tests. */
let preferredSeed = null;
/** Progress blob loaded from save. */
let progress = { unlocked: 1, stars: {}, bestScore: {} };
/** Shared api refs for test hooks / level-grid clicks. */
let lastApi = null;
/** Set by installTestHooks so level-grid clicks can start a run. */
let shellRef = null;

export const game = {
    id: "serpcoil",
    clearColor: "#070412",

    defaults: {
        highScore: 0,
        unlocked: 1,
        stars: {},
        bestScore: {},
    },

    create(ctx) {
        lastApi = ctx;
        loadProgress(ctx.save);

        const levelIdx = preferredLevel;
        const seed = preferredSeed;

        const size = ctx.view ? ctx.view.size() : { w: BASE_W, h: BASE_H };
        const run = {
            score: 0,
            level: levelIdx,
            combo: 1,
            cascadeDepth: 0,
            comboTimer: 0,
            popsCounted: 0,
            spawnTicker: 0,
            danger: false,
            dangerPrev: false,
            mouseX: size.w / 2,
            mouseY: size.h / 2,
            aimKeyX: 0,
            W: size.w,
            H: size.h,
            path: null,
            chain: null,
            shooter: null,
            active: true,
            ended: null, // "won" | "lost" | null
            pending: null, // "levelclear" | "gameover" | null
            levelClearBonus: 0,
            lastStars: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            audio: ctx.audio,
            view: ctx.view,
        };

        setupLevel(run, levelIdx, seed);
        preferredSeed = null; // one-shot

        attachPointer(run);
        return run;
    },

    update(run, dt, input) {
        const size = run.view ? run.view.size() : { w: BASE_W, h: BASE_H };
        run.W = size.w;
        run.H = size.h;

        if (!run.active) {
            if (run.pending === "levelclear") {
                run.pending = null;
                return { status: "screen", name: "levelclear" };
            }
            if (run.pending === "gameover") {
                run.pending = null;
                return { status: "gameover" };
            }
            return;
        }

        // Aim: held arrow keys rotate; otherwise aim at mouse.
        run.aimKeyX = 0;
        if (input.down("left")) run.aimKeyX -= 1;
        if (input.down("right")) run.aimKeyX += 1;

        if (run.aimKeyX !== 0) {
            const a = run.shooter.aim() + run.aimKeyX * 0.005 * dt;
            run.shooter.setAim(a);
        } else {
            run.shooter.aimAt(run.mouseX, run.mouseY);
        }

        if (input.pressed("primary")) {
            const p = run.shooter.fire();
            if (p) run.play("shoot");
        }
        if (input.pressed("secondary")) {
            run.shooter.swap();
            run.play("swap");
        }

        tick(run, dt);

        if (run.pending === "levelclear") {
            run.pending = null;
            return { status: "screen", name: "levelclear" };
        }
        if (run.pending === "gameover") {
            run.pending = null;
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w: W, h: H } = view.size();
        // clearColor already applied by shell; add starfield + world
        drawStars(ctx, W, H);

        if (run.path) {
            run.path.draw(ctx);
            const m = run.path.pointAt(0);
            drawMouth(ctx, m.x, m.y);
            const g = run.path.pointAt(run.path.length());
            drawGoal(ctx, g.x, g.y, run.danger);
        }

        if (run.chain) run.chain.draw(ctx);
        if (run.shooter) run.shooter.draw(ctx);
        FX.draw(ctx);
    },

    drawTitle(ctx, view) {
        const { w: W, h: H } = view.size();
        drawStars(ctx, W, H);
    },

    hud(run) {
        if (!run) {
            return { score: 0, level: 1, combo: "x1", left: 0 };
        }
        const left = run.chain
            ? run.chain.remainingToSpawn() + run.chain.count()
            : 0;
        // Side effects: progress bar + danger flag
        if (run.chain) {
            const total = run.chain.totalToSpawn();
            const pct = total > 0
                ? Math.max(0, Math.min(100, (1 - left / total) * 100))
                : 0;
            const fill = document.getElementById("hud-progress-fill");
            if (fill) fill.style.width = pct + "%";
        }
        const dEl = document.getElementById("hud-danger");
        if (dEl) {
            dEl.hidden = !run.danger;
            dEl.style.display = run.danger ? "" : "none";
        }
        return {
            score: run.score,
            level: run.level + 1,
            combo: "x" + run.combo,
            left: left,
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const level = run ? run.level + 1 : 1;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score    " + score + tag + "\n" +
            "Level    " + level + "\n" +
            "Best     " + best
        );
    },

    onEnterScreen(name, run, api) {
        if (name === "title") {
            preferredLevel = 0;
        }
        if (name === "levelselect") {
            buildLevelGrid(api);
        }
        if (name === "levelclear" && run) {
            const starsEl = document.getElementById("clear-stars");
            const stars = run.lastStars || computeStars(run);
            if (starsEl) {
                starsEl.textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
            }
            const st = document.getElementById("levelclear-stats");
            if (st) {
                st.textContent =
                    "Score: " + run.score + "\n" +
                    "Level: " + (run.level + 1) + "\n" +
                    "Clear bonus: +" + run.levelClearBonus;
            }
        }
    },

    onMenuAction(action, run, api) {
        if (action === "levelselect") {
            return "levelselect";
        }
        if (action === "credits") {
            return "credits";
        }
        if (action === "nextlevel" && run) {
            const nxt = run.level + 1;
            if (nxt >= Levels.count()) {
                preferredLevel = 0;
                return "title";
            }
            preferredLevel = nxt;
            return { startRun: true };
        }
        // restart is shell-native and re-uses preferredLevel (set in create)
        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "shoot") audio.tone(220, 0.06, "sawtooth", 0.4);
        else if (name === "swap") audio.tone(540, 0.07, "sine", 0.35);
        else if (name === "insert") audio.tone(380, 0.05, "square", 0.3);
        else if (name === "march") audio.tone(90, 0.04, "triangle", 0.15);
        else if (name === "danger") audio.tone(180, 0.18, "sawtooth", 0.5);
        else if (name === "powerup") audio.tone(880, 0.2, "square", 0.7);
        else if (name === "pop") audio.tone(523, 0.14, "square", 0.5);
        else if (name === "clear") {
            audio.sequence([
                [523, 0.12, "square", 0.6],
                [659, 0.12, "square", 0.6],
                [784, 0.12, "square", 0.7],
                [1047, 0.25, "square", 0.8],
            ]);
        } else if (name === "gameover" || name === "die") {
            audio.sequence([
                [300, 0.18, "sawtooth", 0.5],
                [240, 0.18, "sawtooth", 0.5],
                [180, 0.36, "sawtooth", 0.55],
            ]);
        }
    },
};

// ── Progress ─────────────────────────────────────────────────────────────

function loadProgress(save) {
    if (!save) return;
    progress = {
        unlocked: save.get("unlocked") || 1,
        stars: save.get("stars") || {},
        bestScore: save.get("bestScore") || {},
    };
    // Self-heal: cleared levels unlock successors.
    for (const lk in progress.stars) {
        if (progress.stars[lk] > 0) {
            const minUnlock = (parseInt(lk, 10) | 0) + 2;
            if (minUnlock > progress.unlocked && minUnlock <= Levels.count()) {
                progress.unlocked = minUnlock;
            }
        }
    }
    save.set("unlocked", progress.unlocked);
    save.save();
}

function persistProgress(save) {
    if (!save) return;
    save.set("unlocked", progress.unlocked);
    save.set("stars", progress.stars);
    save.set("bestScore", progress.bestScore);
    save.save();
}

// ── Level setup ──────────────────────────────────────────────────────────

function setupLevel(run, levelIdx, seed) {
    run.level = levelIdx;
    preferredLevel = levelIdx; // restart replays this level
    run.score = 0;
    run.combo = 1;
    run.cascadeDepth = 0;
    run.comboTimer = 0;
    run.popsCounted = 0;
    run.ended = null;
    run.pending = null;
    run.levelClearBonus = 0;
    run.lastStars = 0;
    run.danger = false;
    run.dangerPrev = false;
    run.spawnTicker = 0;

    const L = Levels.scaled(levelIdx, run.W, run.H);
    run.path = Path.create(L.controls);
    const rng = seed != null ? makeRng(seed) : Math.random;
    run.chain = Chain.create({
        path: run.path,
        palette: L.palette,
        totalToSpawn: L.totalOrbs,
        speed: L.chainSpeed,
        rng: rng,
    });
    run.shooter = Shooter.create({
        x: L.shooter.x,
        y: L.shooter.y,
        palette: L.palette,
        rng: rng,
    });
    run.active = true;
    FX.clear();
}

function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
}

// ── Scoring / pops ───────────────────────────────────────────────────────

function scoreForPop(count, comboDepth) {
    let base = count * 10;
    if (count >= 4) base = Math.floor(base * 1.5);
    const mult = [1, 2, 4, 8, 12, 16][Math.min(5, comboDepth)];
    return base * mult;
}

function onPopGroup(run, popped, _ignored, positions) {
    const color = popped[0] ? popped[0].color : 1;
    if (run.comboTimer <= 0) run.cascadeDepth = 0;
    run.cascadeDepth += 1;
    if (run.cascadeDepth > run.combo) run.combo = run.cascadeDepth;
    run.comboTimer = 1800;

    const gain = scoreForPop(popped.length, run.cascadeDepth);
    run.score += gain;
    run.popsCounted += popped.length;

    for (let i = 0; i < positions.length; i++) {
        FX.burst(positions[i].x, positions[i].y, positions[i].color, 14);
    }
    const p0 = positions[0];
    if (p0) {
        FX.floatText(p0.x, p0.y - 10, "+" + gain, "#ffd86b");
        FX.shockwave(p0.x, p0.y, { maxR: 80 });
    }
    // Color-pitched pop
    const c = Chain.COLORS[color];
    const f = c ? c.tone : 440;
    const mult = run.cascadeDepth > 1 ? Math.pow(2, (run.cascadeDepth - 1) / 12) : 1;
    if (run.audio) run.audio.tone(f * mult, 0.14, "square", 0.5);
    else run.play("pop");

    if (run.shooter.maybeInjectPU()) {
        FX.floatText(run.shooter.x(), run.shooter.y() - 40, "POWERUP!", "#b56dff");
        run.play("powerup");
    }

    if (run.save) run.save.maybeHighScore(run.score);
}

function handlePopAt(run, idx) {
    return run.chain.popAround(idx, function (popped, depth, positions) {
        onPopGroup(run, popped, depth, positions);
    });
}

// ── Projectiles ──────────────────────────────────────────────────────────

function tryInsertProjectile(run, proj) {
    const orbs = run.chain.orbs();
    const diam = run.chain.ORB_DIAM;
    const hitRadius2 = (diam * 0.85) * (diam * 0.85);
    for (let i = 0; i < orbs.length; i++) {
        const p = run.path.pointAt(orbs[i].d);
        const dx = p.x - proj.x;
        const dy = p.y - proj.y;
        if (dx * dx + dy * dy <= hitRadius2) {
            const tangent = run.path.tangentAt(orbs[i].d);
            const dot = dx * tangent.x + dy * tangent.y;
            let insertD;
            if (dot > 0) insertD = orbs[i].d - diam * 0.5;
            else insertD = orbs[i].d + diam * 0.5;
            if (insertD < 0) insertD = 0;
            applyProjectileEffect(run, proj, insertD, i);
            return true;
        }
    }
    return false;
}

function applyProjectileEffect(run, proj, insertD, hitIdx) {
    run.shooter.removeProjectile(proj);
    if (proj.pu === Shooter.PU_BACKTRACK) {
        run.chain.backtrack(160);
        run.play("powerup");
        FX.shockwave(proj.x, proj.y, { maxR: 140, color: "#56d8ff" });
        FX.floatText(proj.x, proj.y, "BACKTRACK", "#56d8ff");
        return;
    }
    if (proj.pu === Shooter.PU_BLASTER) {
        const res = run.chain.blastAt(proj.x, proj.y, 80);
        for (let i = 0; i < res.positions.length; i++) {
            FX.burst(res.positions[i].x, res.positions[i].y, res.positions[i].color, 12);
        }
        run.score += res.popped.length * 25;
        FX.shockwave(proj.x, proj.y, { maxR: 180, color: "#e63946" });
        FX.floatText(proj.x, proj.y, "+" + (res.popped.length * 25), "#ffd86b");
        run.play("powerup");
        return;
    }
    if (proj.pu === Shooter.PU_COLORSHIFT) {
        const n = run.chain.colorshift(hitIdx, proj.color);
        FX.floatText(proj.x, proj.y, "SHIFTED x" + n, "#e9c46a");
        run.play("powerup");
        handlePopAt(run, hitIdx);
        return;
    }
    if (proj.pu === Shooter.PU_SLOWMO) {
        run.chain.setSlowmo(6000);
        FX.shockwave(proj.x, proj.y, { maxR: 200, color: "#4cc9f0" });
        FX.floatText(proj.x, proj.y, "SLOW-MO", "#4cc9f0");
        run.play("powerup");
        return;
    }
    const idx = run.chain.insertAt(insertD, proj.color);
    run.play("insert");
    handlePopAt(run, idx);
}

// ── Tick ─────────────────────────────────────────────────────────────────

function tick(run, dt) {
    run.chain.tick(dt, function (popped, depth, positions) {
        onPopGroup(run, popped, depth, positions);
    });
    run.shooter.tick(dt);

    const d = run.chain.dangerActive();
    if (d && !run.dangerPrev) run.play("danger");
    run.dangerPrev = d;
    run.danger = d;

    const projectiles = run.shooter.projectiles();
    const chainOrbs = run.chain.orbs();
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        if (proj.x < -50 || proj.x > run.W + 50 ||
            proj.y < -50 || proj.y > run.H + 50) {
            run.shooter.removeProjectile(proj);
            continue;
        }
        if (chainOrbs.length > 0) tryInsertProjectile(run, proj);
    }

    if (run.chain.remainingToSpawn() === 0) {
        const live = run.chain.colorsRemaining();
        if (live.length > 0) {
            run.shooter.setPalette(live);
            const sx = run.shooter.x();
            const sy = run.shooter.y();
            const pickLive = function () {
                return live[(Math.random() * live.length) | 0];
            };
            if (live.indexOf(run.shooter.current()) < 0) {
                FX.burst(sx, sy, run.shooter.current(), 14);
                run.shooter.setCurrent(pickLive(), run.shooter.currentPU());
            }
            if (live.indexOf(run.shooter.next()) < 0) {
                const ang = run.shooter.aim();
                const bx = sx - Math.cos(ang) * 38;
                const by = sy - Math.sin(ang) * 38;
                FX.burst(bx, by, run.shooter.next(), 10);
                run.shooter.setNext(pickLive(), run.shooter.nextPU());
            }
        }
    }

    if (run.comboTimer > 0) {
        run.comboTimer -= dt;
        if (run.comboTimer <= 0) {
            run.combo = 1;
            run.cascadeDepth = 0;
        }
    }

    if (run.chain.remainingToSpawn() > 0) {
        run.spawnTicker += dt;
        if (run.spawnTicker > 260) {
            run.spawnTicker = 0;
            const p0 = run.path.pointAt(0);
            FX.puff(p0.x, p0.y);
        }
    }

    FX.update(dt);

    if (!run.ended) {
        if (run.chain.isComplete()) {
            run.ended = "won";
            run.active = false;
            onLevelWin(run);
        } else {
            const orbs = run.chain.orbs();
            if (orbs.length > 0 && orbs[orbs.length - 1].d >= run.path.length()) {
                run.ended = "lost";
                run.active = false;
                onLevelLose(run);
            }
        }
    }
}

function computeStars(run) {
    const L = Levels.get(run.level);
    const perfect = L.totalOrbs * 20;
    const s = run.score;
    if (s >= perfect * 1.2) return 3;
    if (s >= perfect * 0.8) return 2;
    return 1;
}

function onLevelWin(run) {
    const bonus = 500 + run.level * 100;
    run.levelClearBonus = bonus;
    run.score += bonus;
    run.play("clear");
    const stars = computeStars(run);
    run.lastStars = stars;
    persistLevelResult(run, stars);
    run.pending = "levelclear";
}

function onLevelLose(run) {
    run.play("gameover");
    if (run.save) run.save.maybeHighScore(run.score);
    run.pending = "gameover";
}

function persistLevelResult(run, stars) {
    const prev = progress.stars[run.level] || 0;
    if (stars > prev) progress.stars[run.level] = stars;
    const prevScore = progress.bestScore[run.level] || 0;
    if (run.score > prevScore) progress.bestScore[run.level] = run.score;
    if (progress.unlocked <= run.level + 1 && run.level + 1 < Levels.count()) {
        progress.unlocked = run.level + 2;
    }
    persistProgress(run.save);
    if (run.save) run.save.maybeHighScore(run.score);
}

// ── Draw helpers ─────────────────────────────────────────────────────────

let starsCache = null;

function drawStars(ctx, W, H) {
    if (!starsCache) {
        starsCache = [];
        for (let i = 0; i < 80; i++) {
            starsCache.push({
                x: Math.random() * 1280,
                y: Math.random() * 800,
                a: 0.2 + Math.random() * 0.4,
            });
        }
    }
    for (let j = 0; j < starsCache.length; j++) {
        const s = starsCache[j];
        ctx.globalAlpha = s.a;
        ctx.fillStyle = "#6a4aa0";
        ctx.fillRect(s.x * (W / 1280), s.y * (H / 800), 1.5, 1.5);
    }
    ctx.globalAlpha = 1.0;
}

function drawMouth(ctx, x, y) {
    ctx.save();
    const grad = ctx.createRadialGradient(x, y, 6, x, y, 40);
    grad.addColorStop(0, "rgba(180,100,255,0.6)");
    grad.addColorStop(1, "rgba(180,100,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - 40, y - 40, 80, 80);
    ctx.fillStyle = "#1a0e2e";
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#9a56ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function drawGoal(ctx, x, y, danger) {
    ctx.save();
    const time = (typeof performance !== "undefined" ? performance.now() : 0) * 0.004;
    const pulse = Math.sin(time * (danger ? 6 : 2)) * 0.5 + 0.5;
    const col = danger ? "#ff5a5a" : "#ffd86b";
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, 28 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = danger ? "#2a0a0a" : "#0a0618";
    ctx.fill();
    ctx.restore();
}

// ── Input ────────────────────────────────────────────────────────────────

/** One listener set per canvas; always targets the latest run on that canvas. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._serpcoilRun = run;
    if (canvas._serpcoilPointer) return;
    canvas._serpcoilPointer = true;

    canvas.addEventListener("mousemove", function (e) {
        const r = canvas._serpcoilRun;
        if (!r || !r.view) return;
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        let x, y;
        if (rect) {
            const scaleX = r.view.width() / (rect.width || r.W || BASE_W);
            const scaleY = r.view.height() / (rect.height || r.H || BASE_H);
            x = (e.clientX - rect.left) * scaleX;
            y = (e.clientY - rect.top) * scaleY;
        } else if (typeof e.offsetX === "number") {
            x = e.offsetX;
            y = e.offsetY;
        } else {
            x = e.clientX;
            y = e.clientY;
        }
        r.mouseX = x;
        r.mouseY = y;
    });

    // Prevent browser context menu so secondary (right-click) can swap.
    canvas.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        return false;
    });
}

// ── Level select UI ──────────────────────────────────────────────────────

function buildLevelGrid(api) {
    const grid = document.getElementById("level-grid");
    if (!grid) return;
    if (api && api.save) loadProgress(api.save);

    grid.innerHTML = "";
    const unlocked = progress.unlocked;
    for (let i = 0; i < Levels.count(); i++) {
        const locked = (i + 1) > unlocked;
        const node = document.createElement("div");
        node.className = "level-node" + (locked ? " locked" : "");
        const stars = progress.stars[i] || 0;
        const best = progress.bestScore[i] || 0;
        node.innerHTML =
            '<div class="level-num">' + (i + 1) + "</div>" +
            '<div class="level-stars">' + (stars > 0 ? "★".repeat(stars) : "&nbsp;") + "</div>" +
            '<div class="level-score">' + (best > 0 ? best : "") + "</div>";
        (function (idx, lk) {
            node.addEventListener("click", function () {
                if (lk) return;
                preferredLevel = idx;
                if (lastApi) lastApi.play("select");
                // Prefer shell startRun if available via installed hooks
                if (shellRef && shellRef.startRun) {
                    shellRef.startRun();
                }
            });
        })(i, locked);
        grid.appendChild(node);
    }
}

// ── Test hooks ───────────────────────────────────────────────────────────

export function installTestHooks(shell) {
    shellRef = shell;
    const api = shell.api;

    window.__serpcoil = {
        fire: function (a) {
            const run = shell.getRun();
            if (!run || !run.shooter) return null;
            if (a != null) run.shooter.setAim(a);
            return run.shooter.fire();
        },
        chain: function () {
            const run = shell.getRun();
            return run ? run.chain : null;
        },
        shooter: function () {
            const run = shell.getRun();
            return run ? run.shooter : null;
        },
        path: function () {
            const run = shell.getRun();
            return run ? run.path : null;
        },
        insertAt: function (d, c) {
            const run = shell.getRun();
            if (!run) return -1;
            const idx = run.chain.insertAt(d, c);
            handlePopAt(run, idx);
            return idx;
        },
        detectMatches: function (i) {
            const run = shell.getRun();
            return run ? run.chain.detectMatches(i) : [];
        },
        seedLevel: function (n, seed) {
            preferredLevel = n;
            preferredSeed = seed != null ? seed : null;
            // If already in a run, rebuild in place; otherwise startRun.
            const run = shell.getRun();
            if (run) {
                const size = run.view ? run.view.size() : { w: BASE_W, h: BASE_H };
                run.W = size.w;
                run.H = size.h;
                setupLevel(run, n, preferredSeed);
                preferredSeed = null;
                attachPointer(run);
            } else if (shell.startRun) {
                shell.startRun();
            }
        },
        score: function () {
            const run = shell.getRun();
            return run ? run.score : 0;
        },
        setScore: function (v) {
            const run = shell.getRun();
            if (run) run.score = v;
        },
        combo: function () {
            const run = shell.getRun();
            return run ? run.combo : 1;
        },
        danger: function () {
            const run = shell.getRun();
            return run ? run.danger : false;
        },
        state: function () {
            return shell.getRun();
        },
        tick: function (dt) {
            const run = shell.getRun();
            if (run && run.active) tick(run, dt);
        },
        currentScreen: function () {
            return shell.getScreen();
        },
        forceEmpty: function () {
            const run = shell.getRun();
            if (run && run.chain) run.chain.forceEmpty();
        },
        advanceChainToGoal: function () {
            const run = shell.getRun();
            if (!run) return;
            const orbs = run.chain.orbs();
            if (orbs.length) orbs[orbs.length - 1].d = run.path.length();
        },
        setChainSpeed: function (s) {
            const run = shell.getRun();
            if (run && run.chain) run.chain.speed(s);
        },
        switchTo: function (n) {
            // Map legacy "play" → shell "playing"
            if (n === "play") n = "playing";
            if (n === "howtoplay") n = "howto";
            if (shell.switchTo) shell.switchTo(n);
        },
        awardPowerup: function (pu) {
            const run = shell.getRun();
            if (run && run.shooter) {
                run.shooter.setCurrent(run.shooter.current(), pu);
            }
        },
        api: api,
    };
}
