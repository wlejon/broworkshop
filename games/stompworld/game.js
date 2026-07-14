// Stompworld — arcade foundation plugin (human play + train/demo entry).
// Play mode: create/update/draw/hud. Train / AI Demo via onMenuAction.
//
// File roles:
//   game.js   this plugin — live input, combat, draw, modes
//   sim.js    headless env for agents / MCTS (SwSim.create)
//   level.js  tilemap layout    art.js  sprites
//   train.js / demo.js / agent*  learning pipeline (not the live loop)

'use strict';

import { Camera2D } from "/lib/camera2d.js";
import { Platformer } from "/lib/platformer.js";
import { Art } from "/app/art.js";
import { Level } from "/app/level.js";
import { SwDemo } from "/app/demo.js";
import { createTraining } from "/app/train.js";

const VIEW_W = 800;
const VIEW_H = 576;
const TILE = 32;

const STOMP_GRAVITY = 1800;
const STOMP_MAX_FALL = 800;

/** @type {"play"|"train"|"demo"} */
let pendingMode = "play";

/** @type {object|null} */
let activeTrain = null;
/** @type {object|null} */
let activeDemo = null;
/** @type {((e: KeyboardEvent) => void)|null} */
let trainKeyHandler = null;
/** @type {object|null} */
let mouseState = null;

const BEAM_CFG = {
    BEAM_THICKNESS: 8,
    BEAM_LENGTH: 600,
    EXPLOSION_R: 56,
    WEAPON_COOLDOWN_MS: 250,
    BEAM_TTL_MS: 80,
    EXPLOSION_TTL_MS: 320,
};

export const game = {
    id: "stompworld",
    clearColor: "#000",

    actions: [
        { name: "primary", label: "Jump", defaults: [" ", "w", "ArrowUp"] },
        { name: "shoot", label: "Fire Beam", defaults: ["j", "k", "f", "Mouse0"] },
    ],

    create(ctx) {
        stopModes();

        const mode = pendingMode;
        const run = {
            mode,
            score: 0,
            lives: 3,
            timeLeft: 300,
            ended: false,
            pending: null, // "win" | "gameover"
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            audio: ctx.audio,
            view: ctx.view,
            // play-mode world (null for train/demo)
            tilemap: null,
            cam: null,
            player: null,
            stompers: [],
            flyers: [],
            flag: null,
            pickup: null,
            spawn: { x: 0, y: 0 },
            runAccum: 0,
            deathTimer: 0,
            winTimer: 0,
            hasWeapon: true,
            weaponCooldown: 0,
            beams: [],
            explosions: [],
            pickupAnimT: 0,
            SCORE_PER_PIXEL: 0.05,
            SCORE_STOMP: 100,
            SCORE_BEAM_STOMP: 100,
            SCORE_BEAM_FLYER: 500,
            SCORE_PICKUP: 300,
            SCORE_FLAG: 1000,
            ...BEAM_CFG,
        };

        ensureMouse(ctx.view);

        if (mode === "train") {
            const Audio = makeAudioCues(ctx);
            activeTrain = createTraining({
                VIEW_W, VIEW_H, TILE, Art, Camera2D,
                beamCfg: BEAM_CFG,
                audio: Audio,
            });
            activeTrain.start();
            run._train = activeTrain;
            // F/C are train-only and would clash with shoot's "f" binding.
            detachTrainKeys();
            trainKeyHandler = (e) => {
                if (!activeTrain) return;
                const k = e.key;
                if (k === "f" || k === "F") activeTrain.toggleFast();
                if (k === "c" || k === "C") activeTrain.clearTape();
            };
            window.addEventListener("keydown", trainKeyHandler);
            return run;
        }

        if (mode === "demo") {
            activeDemo = SwDemo.create({
                ctx: ctx.view.ctx,
                Art,
                Camera2D,
                Game: BEAM_CFG,
            });
            // Patch Game refs used by demo for beam TTL
            activeDemo.start();
            run._demo = activeDemo;
            return run;
        }

        // Play mode
        startPlayRun(run);
        // Consume leftover shoot edge from menu click
        if (ctx.input && ctx.input.pressed) ctx.input.pressed("shoot");
        return run;
    },

    update(run, dt, input) {
        if (run.mode === "train") {
            const T = run._train || activeTrain;
            if (T) T.update(dt);
            // Esc/P → shell pause; Title menu stops workers via onEnterScreen
            return;
        }

        if (run.mode === "demo") {
            const D = run._demo || activeDemo;
            if (D) D.update(dt);
            return;
        }

        if (run.ended) return { status: "gameover" };

        updateBeamsExplosions(run, dt);
        pruneRagdolls(run);

        // Win celebration
        if (run.winTimer > 0) {
            run.winTimer -= dt;
            run.player.vx = 80;
            Platformer.step(run.player, { right: true }, run.tilemap, dt);
            for (const s of run.stompers) stepStomper(s, dt, run.tilemap);
            for (const f of run.flyers) stepFlyer(f, dt);
            run.cam.follow(run.player.x + run.player.w / 2, VIEW_H / 2);
            if (run.winTimer <= 0) {
                run.save.maybeHighScore(run.score);
                return { status: "screen", name: "win" };
            }
            return;
        }

        // Death anim
        if (run.deathTimer > 0) {
            run.deathTimer -= dt;
            run.player.vy += 2400 * (dt / 1000);
            run.player.y += run.player.vy * (dt / 1000);
            if (run.deathTimer <= 0) {
                if (run.lives <= 0) {
                    run.save.maybeHighScore(run.score);
                    run.play("gameover");
                    run.ended = true;
                    return { status: "gameover" };
                }
                respawnPlayer(run);
                run.deathTimer = 0;
            }
            return;
        }

        const prevTime = run.timeLeft;
        run.timeLeft -= dt / 1000;
        if (run.timeLeft <= 0) {
            killPlayer(run);
            return;
        }
        const tNow = Math.floor(run.timeLeft);
        if (tNow !== Math.floor(prevTime)) {
            if (tNow <= 5 && tNow >= 1) run.play("timeWarn");
        }

        const pev = Platformer.step(run.player, {
            left: input.down("left"),
            right: input.down("right"),
            jumpHeld: input.down("primary"),
            jumpPressed: input.pressed("primary"),
        }, run.tilemap, dt);
        if (pev.jumped) run.play("jump");
        if (pev.landed) run.play("land");

        if (run.weaponCooldown > 0) run.weaponCooldown -= dt;
        if (input.pressed("shoot")) fireWeapon(run);

        for (const s of run.stompers) stepStomper(s, dt, run.tilemap);
        for (const f of run.flyers) stepFlyer(f, dt);
        handleStompers(run);
        handleFlyers(run);
        checkPickup(run);
        checkWinLose(run);
        run.pickupAnimT += dt;

        run.cam.follow(run.player.x + run.player.w / 2, VIEW_H / 2);
    },

    draw(run, ctx, view) {
        const W = view.width();
        const H = view.height();
        // Letterbox fixed VIEW into canvas surface
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        const scale = Math.min(W / VIEW_W, H / VIEW_H);
        const ox = Math.floor((W - VIEW_W * scale) / 2);
        const oy = Math.floor((H - VIEW_H * scale) / 2);

        // Cache letterbox for mouse mapping
        if (mouseState) {
            mouseState.scale = scale;
            mouseState.ox = ox;
            mouseState.oy = oy;
            mouseState.canvasW = W;
            mouseState.canvasH = H;
        }

        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(scale, scale);
        ctx.beginPath();
        ctx.rect(0, 0, VIEW_W, VIEW_H);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;

        drawSky(ctx);

        if (run.mode === "train" && run._train) {
            run._train.draw(ctx);
        } else if (run.mode === "demo" && run._demo) {
            run._demo.draw();
        } else if (run.tilemap) {
            run.tilemap.draw(ctx, run.cam.x, run.cam.y, VIEW_W, VIEW_H);
            drawFlag(run, ctx);
            drawPickup(run, ctx);
            drawStompers(run, ctx);
            drawFlyers(run, ctx);
            drawHero(run, ctx);
            drawBeamsExplosions(run, ctx);
            if (run.hasWeapon) drawAimCursor(run, ctx);
        }

        ctx.restore();
    },

    drawTitle(ctx, view) {
        const W = view.width();
        const H = view.height();
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, "#6cb0f0");
        g.addColorStop(1, "#a8d4f8");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    },

    hud(run) {
        if (!run || run.mode !== "play") {
            return { score: 0, lives: 3, time: 300, beam: "—" };
        }
        return {
            score: run.score,
            lives: run.lives,
            time: Math.max(0, Math.ceil(run.timeLeft)),
            beam: run.hasWeapon ? "ON" : "—",
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return "Score    " + score + tag + "\nBest     " + best;
    },

    onEnterScreen(name, run) {
        if (name === "title") {
            stopModes();
            pendingMode = "play";
        }
        if (name === "win" && run) {
            const el = document.getElementById("win-stats");
            if (el) {
                el.textContent =
                    "Score: " + run.score + "   Best: " + run.highScore();
            }
        }
        // Hide standard HUD during train/demo (they draw their own)
        const hud = document.getElementById("hud");
        if (hud && run && (run.mode === "train" || run.mode === "demo")) {
            if (name === "playing") {
                hud.hidden = true;
                hud.style.display = "none";
            }
        }
    },

    onMenuAction(action, run, api) {
        if (action === "train") {
            pendingMode = "train";
            return { startRun: true };
        }
        if (action === "demo") {
            pendingMode = "demo";
            return { startRun: true };
        }
        if (action === "play") {
            // Shell already handles play; if custom path needed:
            pendingMode = "play";
            return null;
        }
        return null;
    },

    cue(name, audio) {
        if (name === "jump") {
            audio.sequence([
                [520, 0.06, "square", 0.35],
                [720, 0.08, "square", 0.3],
            ]);
        } else if (name === "land") audio.tone(140, 0.05, "triangle", 0.35);
        else if (name === "stomp") {
            audio.sequence([
                [260, 0.05, "square", 0.55],
                [120, 0.1, "sawtooth", 0.55],
                [80, 0.08, "whitenoise", 0.3],
            ]);
        } else if (name === "die") {
            audio.sequence([
                [440, 0.1, "square", 0.55],
                [330, 0.12, "sawtooth", 0.55],
                [220, 0.18, "sawtooth", 0.55],
                [150, 0.3, "triangle", 0.55],
            ]);
        } else if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.55],
                [659, 0.1, "square", 0.6],
                [784, 0.1, "square", 0.65],
                [1047, 0.25, "square", 0.7],
            ]);
        } else if (name === "gameover") {
            audio.sequence([
                [392, 0.2, "sawtooth", 0.55],
                [330, 0.2, "sawtooth", 0.55],
                [262, 0.4, "triangle", 0.55],
            ]);
        } else if (name === "timeWarn") audio.tone(880, 0.08, "square", 0.4);
        else if (name === "flyer") audio.tone(0, 0.08, "whitenoise", 0.18);
        else if (name === "beam") {
            audio.sequence([
                [1400, 0.04, "square", 0.35],
                [800, 0.06, "sawtooth", 0.45],
            ]);
        } else if (name === "boom") {
            audio.sequence([
                [120, 0.1, "sawtooth", 0.65],
                [60, 0.18, "whitenoise", 0.55],
                [40, 0.22, "triangle", 0.45],
            ]);
        } else if (name === "pause") {
            audio.sequence([
                [300, 0.05, "square", 0.3],
                [200, 0.08, "square", 0.3],
            ]);
        }
    },
};

// Expose for headless smoke tests
if (typeof window !== "undefined") {
    window.__SW = {
        get pendingMode() { return pendingMode; },
        Art,
        get Training() { return activeTrain; },
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function stopModes() {
    detachTrainKeys();
    if (activeTrain) {
        try { activeTrain.stop(); } catch (_) {}
        activeTrain = null;
    }
    if (activeDemo) {
        try { activeDemo.stop(); } catch (_) {}
        activeDemo = null;
    }
}

function detachTrainKeys() {
    if (trainKeyHandler) {
        try { window.removeEventListener("keydown", trainKeyHandler); } catch (_) {}
        trainKeyHandler = null;
    }
}

function makeAudioCues(ctx) {
    return {
        jump: () => ctx.play("jump"),
        land: () => ctx.play("land"),
        stomp: () => ctx.play("stomp"),
        die: () => ctx.play("die"),
        win: () => ctx.play("win"),
        flyer: () => ctx.play("flyer"),
    };
}

function ensureMouse(view) {
    if (mouseState) return;
    mouseState = {
        clientX: 0, clientY: 0,
        vx: VIEW_W / 2, vy: VIEW_H / 2,
        scale: 1, ox: 0, oy: 0,
        canvasW: VIEW_W, canvasH: VIEW_H,
        view,
    };
    window.addEventListener("mousemove", (e) => {
        mouseState.clientX = e.clientX;
        mouseState.clientY = e.clientY;
    });
}

function updateMouseVirtual(run) {
    if (!mouseState || !run.view) return;
    const canvas = run.view.canvas;
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const W = mouseState.canvasW || run.view.width();
    const H = mouseState.canvasH || run.view.height();
    const cx = (mouseState.clientX - rect.left) * (W / rect.width);
    const cy = (mouseState.clientY - rect.top) * (H / rect.height);
    const scale = mouseState.scale || 1;
    const ox = mouseState.ox || 0;
    const oy = mouseState.oy || 0;
    mouseState.vx = (cx - ox) / scale;
    mouseState.vy = (cy - oy) / scale;
}

function aimWorld(run) {
    updateMouseVirtual(run);
    return {
        x: mouseState.vx + (run.cam ? run.cam.x : 0),
        y: mouseState.vy + (run.cam ? run.cam.y : 0),
    };
}

function startPlayRun(run) {
    run.score = 0;
    run.lives = 3;
    run.timeLeft = 300;
    run.deathTimer = 0;
    run.winTimer = 0;
    run.hasWeapon = true;
    run.weaponCooldown = 0;
    run.beams = [];
    run.explosions = [];
    run.ended = false;
    run.pending = null;
    loadLevel(run);
    run.pickup = null; // hide training pickup in play
}

function loadLevel(run) {
    const lvl = Level.buildLevel({ tileSize: TILE, destructible: true });
    run.tilemap = lvl.tilemap;
    run.stompers = lvl.stompers;
    run.flyers = lvl.flyers;
    run.flag = lvl.flag;
    run.pickup = lvl.pickup;
    run.spawn.x = lvl.spawn.x;
    run.spawn.y = lvl.spawn.y;

    run.player = Platformer.createBody({
        x: run.spawn.x, y: run.spawn.y - 4,
        w: 24, h: 30,
        cfg: {
            gravity: 2400,
            maxFall: 900,
            runSpeed: 240,
            accel: 1800,
            airAccel: 1200,
            friction: 1800,
            jumpVel: -850,
            jumpCutMul: 0.45,
            coyoteTime: 100,
            jumpBuffer: 120,
        },
    });
    run.player.facing = 1;

    run.cam = Camera2D.create({
        viewW: VIEW_W, viewH: VIEW_H,
        levelW: run.tilemap.widthPx,
        levelH: run.tilemap.heightPx,
        deadzoneW: 120, deadzoneH: 1024,
    });
    run.cam.snapTo(run.player.x + run.player.w / 2, VIEW_H / 2);
}

function respawnPlayer(run) {
    run.player.x = run.spawn.x;
    run.player.y = run.spawn.y - 4;
    run.player.vx = 0;
    run.player.vy = 0;
    run.player.coyote = 0;
    run.player.buffer = 0;
    run.player.facing = 1;
    const lvl = Level.buildLevel({ tileSize: TILE });
    run.stompers.length = 0;
    for (const s of lvl.stompers) run.stompers.push(s);
    run.flyers.length = 0;
    for (const f of lvl.flyers) run.flyers.push(f);
    run.pickup = null;
    run.hasWeapon = true;
    run.weaponCooldown = 0;
    run.cam.snapTo(run.player.x + run.player.w / 2, VIEW_H / 2);
}

// ── Enemy steps ──────────────────────────────────────────────────────────

function stompMoveX(s, dx, tm) {
    s.x += dx;
    const r0 = Math.floor(s.y / TILE);
    const r1 = Math.floor((s.y + s.h - 0.001) / TILE);
    if (dx > 0) {
        const col = Math.floor((s.x + s.w - 0.001) / TILE);
        for (let r = r0; r <= r1; r++) {
            if (tm.solidAt(col, r)) {
                s.x = col * TILE - s.w;
                s.vx = -Math.abs(s.vx);
                return true;
            }
        }
    } else if (dx < 0) {
        const col = Math.floor(s.x / TILE);
        for (let r = r0; r <= r1; r++) {
            if (tm.solidAt(col, r)) {
                s.x = (col + 1) * TILE;
                s.vx = Math.abs(s.vx);
                return true;
            }
        }
    }
    return false;
}

function stompMoveY(s, dy, tm) {
    s.y += dy;
    const c0 = Math.floor(s.x / TILE);
    const c1 = Math.floor((s.x + s.w - 0.001) / TILE);
    if (dy > 0) {
        const row = Math.floor((s.y + s.h - 0.001) / TILE);
        for (let c = c0; c <= c1; c++) {
            if (tm.solidAt(c, row)) {
                s.y = row * TILE - s.h;
                s.vy = 0;
                s.onGround = true;
                return;
            }
        }
    } else if (dy < 0) {
        const row = Math.floor(s.y / TILE);
        for (let c = c0; c <= c1; c++) {
            if (tm.solidAt(c, row)) {
                s.y = (row + 1) * TILE;
                s.vy = 0;
                return;
            }
        }
    }
}

function stepStomper(s, dt, tm) {
    if (s.ragdoll) { stepRagdoll(s, dt); return; }
    if (!s.alive) {
        s.squashTimer -= dt;
        return;
    }
    s.animT += dt;
    const dts = dt / 1000;

    s.vy += STOMP_GRAVITY * dts;
    if (s.vy > STOMP_MAX_FALL) s.vy = STOMP_MAX_FALL;

    s.onGround = false;
    stompMoveX(s, s.vx * dts, tm);
    stompMoveY(s, s.vy * dts, tm);

    if (s.onGround) {
        const probeX = s.vx > 0 ? s.x + s.w + 1 : s.x - 1;
        const probeY = s.y + s.h + 2;
        if (!tm.solidAtPx(probeX, probeY)) s.vx = -s.vx;
    }
}

function stepFlyer(f, dt) {
    if (f.ragdoll) { stepRagdoll(f, dt); return; }
    const dts = dt / 1000;
    f.x += f.vx * dts;
    if (f.x > f.spawnX + f.patrolRange) {
        f.x = f.spawnX + f.patrolRange;
        f.vx = -Math.abs(f.vx);
    } else if (f.x < f.spawnX - f.patrolRange) {
        f.x = f.spawnX - f.patrolRange;
        f.vx = Math.abs(f.vx);
    }
    if (f.bobAmp > 0) {
        f.bobT += dts;
        const newY = f.spawnY + Math.sin(f.bobT * f.bobFreq) * f.bobAmp;
        f.vy = (newY - f.y) / dts;
        f.y = newY;
    } else {
        f.vy = 0;
    }
    f.animT += dt;
}

function stepRagdoll(e, dt) {
    const dts = dt / 1000;
    e.vy += 1800 * dts;
    e.x += e.vx * dts;
    e.y += e.vy * dts;
    e.rot = (e.rot || 0) + (e.rotVel || 0) * dts;
    e.ragdollTTL -= dt;
}

function pruneRagdolls(run) {
    const tm = run.tilemap;
    const cap = tm ? tm.heightPx + 200 : 9999;
    function alive(e) { return !e.ragdoll || (e.ragdollTTL > 0 && e.y < cap); }
    run.flyers = run.flyers.filter(alive);
    run.stompers = run.stompers.filter(alive);
}

// ── Combat ───────────────────────────────────────────────────────────────

function handleStompers(run) {
    const p = run.player;
    for (const s of run.stompers) {
        if (!s.alive || s.ragdoll) continue;
        if (p.x + p.w <= s.x || p.x >= s.x + s.w) continue;
        if (p.y + p.h <= s.y || p.y >= s.y + s.h) continue;
        const fromAbove = p.vy > 0 && (p.y + p.h - s.y) < 16;
        if (fromAbove) {
            s.alive = false;
            s.squashTimer = 350;
            p.vy = -380;
            run.score += run.SCORE_STOMP;
            run.play("stomp");
        } else {
            killPlayer(run);
            return;
        }
    }
}

function handleFlyers(run) {
    const p = run.player;
    for (const f of run.flyers) {
        if (f.ragdoll) continue;
        if (p.x + p.w <= f.x || p.x >= f.x + f.w) continue;
        if (p.y + p.h <= f.y || p.y >= f.y + f.h) continue;
        killPlayer(run);
        return;
    }
}

function killPlayer(run) {
    if (run.deathTimer > 0) return;
    run.lives--;
    run.play("die");
    run.deathTimer = 900;
}

function rdRand(min, max) { return min + Math.random() * (max - min); }

function ragdollify(e, dirX) {
    e.alive = false;
    e.ragdoll = true;
    e.vx = dirX * rdRand(180, 380) + rdRand(-60, 60);
    e.vy = -rdRand(420, 720);
    e.rot = 0;
    e.rotVel = rdRand(-12, 12);
    e.ragdollTTL = 2200;
}

function entityHit(e, x0, y0, x1, y1, half, hx, hy, r) {
    const ex0 = e.x, ex1 = e.x + e.w;
    const ey0 = e.y, ey1 = e.y + e.h;
    const cx = hx < ex0 ? ex0 : (hx > ex1 ? ex1 : hx);
    const cy = hy < ey0 ? ey0 : (hy > ey1 ? ey1 : hy);
    const ddx = cx - hx, ddy = cy - hy;
    if (ddx * ddx + ddy * ddy <= r * r) return true;
    const ax0 = ex0 - half, ay0 = ey0 - half;
    const ax1 = ex1 + half, ay1 = ey1 + half;
    const dx = x1 - x0, dy = y1 - y0;
    const ps = [-dx, dx, -dy, dy];
    const qs = [x0 - ax0, ax1 - x0, y0 - ay0, ay1 - y0];
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 4; i++) {
        if (ps[i] === 0) {
            if (qs[i] < 0) return false;
        } else {
            const t = qs[i] / ps[i];
            if (ps[i] < 0) {
                if (t > t1) return false;
                if (t > t0) t0 = t;
            } else {
                if (t < t0) return false;
                if (t < t1) t1 = t;
            }
        }
    }
    return true;
}

function fireWeapon(run) {
    if (!run.hasWeapon || run.weaponCooldown > 0) return;
    const p = run.player;
    const px = p.x + p.w / 2;
    const py = p.y + p.h / 2;
    const aim = aimWorld(run);
    let dxA = aim.x - px, dyA = aim.y - py;
    const dist = Math.hypot(dxA, dyA);
    let ux, uy;
    if (dist < 1) {
        ux = p.facing < 0 ? -1 : 1;
        uy = 0;
    } else {
        ux = dxA / dist;
        uy = dyA / dist;
    }
    if (Math.abs(ux) > 0.05) p.facing = ux < 0 ? -1 : 1;
    const startOff = p.w / 2 + 2;
    const x0 = px + ux * startOff;
    const y0 = py + uy * startOff;
    const x1 = px + ux * run.BEAM_LENGTH;
    const y1 = py + uy * run.BEAM_LENGTH;
    const r = run.tilemap.damageBeam(x0, y0, x1, y1, run.BEAM_THICKNESS, true);
    const hx = r.hitX, hy = r.hitY;
    const explosionR = r.hit ? run.EXPLOSION_R : 0;
    let pixelsCleared = r.cleared | 0;
    if (explosionR > 0) {
        pixelsCleared += run.tilemap.damageCircle(hx, hy, explosionR) | 0;
    }
    if (pixelsCleared > 0) {
        run.score += Math.floor(pixelsCleared * run.SCORE_PER_PIXEL);
    }

    run.beams.push({
        x0, y0, x1: hx, y1: hy,
        ttl: run.BEAM_TTL_MS, ttlMax: run.BEAM_TTL_MS,
    });
    if (explosionR > 0) {
        run.explosions.push({
            cx: hx, cy: hy, rMax: explosionR,
            ttl: run.EXPLOSION_TTL_MS, ttlMax: run.EXPLOSION_TTL_MS,
        });
    }

    const halfBeam = run.BEAM_THICKNESS / 2 + 2;
    const launchDir = ux < 0 ? -1 : 1;
    for (const f of run.flyers) {
        if (f.ragdoll) continue;
        if (entityHit(f, x0, y0, hx, hy, halfBeam, hx, hy, explosionR)) {
            ragdollify(f, launchDir);
            run.score += run.SCORE_BEAM_FLYER;
        }
    }
    for (const s of run.stompers) {
        if (!s.alive || s.ragdoll) continue;
        if (entityHit(s, x0, y0, hx, hy, halfBeam, hx, hy, explosionR)) {
            ragdollify(s, launchDir);
            run.score += run.SCORE_BEAM_STOMP;
        }
    }

    run.play("beam");
    if (r.hit) run.play("boom");
    run.weaponCooldown = run.WEAPON_COOLDOWN_MS;
}

function updateBeamsExplosions(run, dt) {
    for (const b of run.beams) b.ttl -= dt;
    for (const e of run.explosions) e.ttl -= dt;
    if (run.beams.length) run.beams = run.beams.filter((b) => b.ttl > 0);
    if (run.explosions.length) run.explosions = run.explosions.filter((e) => e.ttl > 0);
}

function checkPickup(run) {
    if (!run.pickup || run.hasWeapon) return;
    const p = run.player;
    const pk = run.pickup;
    if (p.x + p.w <= pk.x || p.x >= pk.x + pk.w) return;
    if (p.y + p.h <= pk.y || p.y >= pk.y + pk.h) return;
    run.hasWeapon = true;
    run.pickup = null;
    run.score += run.SCORE_PICKUP;
    run.play("select");
}

function checkWinLose(run) {
    const p = run.player;
    if (p.y > run.tilemap.heightPx + 64) {
        killPlayer(run);
        return;
    }
    if (run.flag && run.winTimer === 0) {
        const f = run.flag;
        if (p.x + p.w >= f.x + 8 && p.x <= f.x + f.w - 8) {
            run.score += run.SCORE_FLAG;
            run.play("win");
            run.winTimer = 1500;
        }
    }
}

// ── Draw ─────────────────────────────────────────────────────────────────

function drawSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, "#6cb0f0");
    g.addColorStop(1, "#a8d4f8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawHero(run, ctx) {
    const p = run.player;
    let frame = 0;
    if (!p.onGround) {
        frame = 3;
    } else if (Math.abs(p.vx) > 8) {
        run.runAccum += Math.abs(p.vx) * 0.0006;
        frame = 1 + (Math.floor(run.runAccum) % 2);
    }
    Art.drawHero(ctx,
        p.x - run.cam.x,
        p.y - run.cam.y - 2,
        frame, p.facing < 0);
}

function drawStompers(run, ctx) {
    for (const s of run.stompers) {
        if (!run.cam.visible(s.x, s.y, s.w, s.h)) continue;
        const frame = !s.alive ? 2 : (Math.floor(s.animT / 200) % 2);
        const dx = s.x - run.cam.x;
        const dy = s.y - run.cam.y;
        if (s.ragdoll) {
            ctx.save();
            ctx.translate(dx + s.w / 2, dy + s.h / 2);
            ctx.rotate(s.rot || 0);
            Art.drawStomper(ctx, -s.w / 2, -s.h / 2, 0);
            ctx.restore();
        } else {
            Art.drawStomper(ctx, dx, dy, frame);
        }
    }
}

function drawFlyers(run, ctx) {
    for (const f of run.flyers) {
        if (!run.cam.visible(f.x, f.y, f.w, f.h)) continue;
        const frame = (Math.floor(f.animT / 150) % 2);
        const dx = f.x - run.cam.x;
        const dy = f.y - run.cam.y;
        if (f.ragdoll) {
            ctx.save();
            ctx.translate(dx + f.w / 2, dy + f.h / 2);
            ctx.rotate(f.rot || 0);
            Art.drawFlyer(ctx, -f.w / 2, -f.h / 2, frame, false);
            ctx.restore();
        } else {
            Art.drawFlyer(ctx, dx, dy, frame, f.vx > 0);
        }
    }
}

function drawBeamsExplosions(run, ctx) {
    for (const b of run.beams) {
        const a = Math.max(0, b.ttl / b.ttlMax);
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255, 220, 80, " + (a * 0.85).toFixed(3) + ")";
        ctx.lineWidth = run.BEAM_THICKNESS + 6;
        ctx.beginPath();
        ctx.moveTo(b.x0 - run.cam.x, b.y0 - run.cam.y);
        ctx.lineTo(b.x1 - run.cam.x, b.y1 - run.cam.y);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255, 255, 240, " + a.toFixed(3) + ")";
        ctx.lineWidth = run.BEAM_THICKNESS - 4;
        ctx.beginPath();
        ctx.moveTo(b.x0 - run.cam.x, b.y0 - run.cam.y);
        ctx.lineTo(b.x1 - run.cam.x, b.y1 - run.cam.y);
        ctx.stroke();
        ctx.restore();
    }
    for (const e of run.explosions) {
        const u = 1 - Math.max(0, e.ttl / e.ttlMax);
        const r = e.rMax * (0.35 + 0.65 * u);
        const a = (1 - u) * 0.95;
        const cx = e.cx - run.cam.x;
        const cy = e.cy - run.cam.y;
        ctx.save();
        ctx.fillStyle = "rgba(255, 150, 40, " + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 240, 200, " + (a * 0.7).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawAimCursor(run, ctx) {
    updateMouseVirtual(run);
    const x = mouseState.vx, y = mouseState.vy;
    if (x < 0 || x > VIEW_W || y < 0 || y > VIEW_H) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 240, 80, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y); ctx.lineTo(x - 2, y);
    ctx.moveTo(x + 2, y); ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6); ctx.lineTo(x, y - 2);
    ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 6);
    ctx.stroke();
    ctx.restore();
}

function drawFlag(run, ctx) {
    if (!run.flag) return;
    const f = run.flag;
    Art.drawFlag(ctx, f.x - run.cam.x, f.y - run.cam.y);
}

function drawPickup(run, ctx) {
    if (!run.pickup) return;
    const pk = run.pickup;
    Art.drawPickup(ctx,
        pk.x - run.cam.x,
        pk.y - run.cam.y,
        run.pickupAnimT);
}
