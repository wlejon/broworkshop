// Nova Squadron — arcade foundation plugin.
// Rules, 3D rail combat, and cues. Screens / loop / input shell are /lib/arcade.
// Domain modules: enemies.js, waves.js, render.js.

import { Waves } from "/app/waves.js";
import { Render } from "/app/render.js";
import { Enemies } from "/app/enemies.js";

const MAX_SHIELDS = 6;
const START_SHIELDS = 6;
const YOKE_MAX_DEFLECT = 22;
const RETICLE_LAG_MS = 140;
const FORWARD_SPEED = 0.07;
const PARALLAX = 0.35;
const RETICLE_Z = 40;
const FIRE_COOLDOWN_MS = 170;
const BOLT_VISUAL_LIFE = 180;
const ENEMY_BOLT_SPEED = 0.18;
const PLAYER_HIT_RADIUS = 3.0;
const MAX_EXPLOSIONS = 24;
const SECTOR_BONUS = { space: 5000, surface: 10000, trench: 15000 };
const SHIELD_BONUS_PER = 2500;
const YOKE_SENSITIVITY = 1 / 240;

const WINGTIP_OFFSETS = [
    { x: 6, y: 1.5 }, { x: -6, y: 1.5 },
    { x: 6, y: -1.5 }, { x: -6, y: -1.5 },
];

// ── Plugin ───────────────────────────────────────────────────────────────

export const game = {
    id: "starfighter",
    clearColor: "#000000",

    actions: [
        { name: "primary", label: "Fire", defaults: [" ", "Mouse0"] },
        { name: "secondary", label: "Fire (alt)", defaults: ["Mouse2"] },
        { name: "target", label: "Targeting Computer", defaults: ["t"] },
    ],

    create(ctx) {
        const { w, h } = ctx.view.size();
        const run = {
            score: 0,
            loop: 1,
            sector: 1,
            wave: Waves.startingWave(),
            shields: START_SHIELDS,
            gameOver: false,
            victoryPending: false,

            shipX: 0,
            shipY: 0,
            reticleX: 0,
            reticleY: 0,
            yokeX: 0,
            yokeY: 0,
            // Relative-yoke accumulators while pointer-locked
            lockYokeX: 0,
            lockYokeY: 0,
            firePressed: false,
            fireCooldown: 0,
            targetingComputer: true,

            W: w,
            H: h,

            enemies: [],
            playerBolts: [],
            enemyBolts: [],
            explosions: [],

            radioText: "",
            radioUntil: 0,
            lockActive: false,
            sectorT: 0,
            wavescript: null,

            play: ctx.play,
            highScore: ctx.highScore,
            audio: ctx.audio,
            view: ctx.view,
            save: ctx.save,
        };

        attachYoke(run);
        Render.setViewport(w, h);
        Render.initStars();
        enterWave(run);
        run.play("wave");
        return run;
    },

    update(run, dt, input) {
        if (run.gameOver) return { status: "gameover", score: run.score };

        const size = run.view ? run.view.size() : { w: run.W, h: run.H };
        if (run.W !== size.w || run.H !== size.h) {
            run.W = size.w;
            run.H = size.h;
            Render.setViewport(size.w, size.h);
        }

        run.firePressed = input.down("primary") || input.down("secondary");
        if (input.pressed("target")) toggleTargetingComputer(run);

        if (run.victoryPending) {
            return { status: "screen", name: "victory" };
        }

        stepRun(run, dt);

        if (run.gameOver) {
            run.play("shipExplode");
            return { status: "gameover", score: run.score };
        }
        if (run.victoryPending) {
            return { status: "screen", name: "victory" };
        }
    },

    draw(run, ctx, view) {
        const W = view.width();
        const H = view.height();
        drawRun(run, ctx, W, H);
    },

    drawTitle(ctx, view) {
        const W = view.width();
        const H = view.height();
        drawTitleStars(ctx, W, H);
    },

    hud(run) {
        syncHudExtras(run);
        if (!run) {
            return { score: 0, hi: 0, wave: "1-1", shields: "" };
        }
        return {
            score: run.score,
            hi: run.highScore(),
            wave: run.loop + "-" + run.sector,
            shields: shieldBar(run.shields),
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const label = run ? (run.loop + "-" + run.sector) : "1-1";
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score    " + score + tag + "\n" +
            "Sector   " + label + "\n" +
            "Best     " + best
        );
    },

    onEnterScreen(name, run) {
        if (name === "playing") {
            setPlayingCursor(true);
            if (run && run.view) requestPlayLock(run.view);
        } else {
            setPlayingCursor(false);
            exitPlayLock();
        }
        if (name === "victory" && run) {
            const el = document.getElementById("victory-stats");
            if (el) {
                el.textContent =
                    "CITADEL CAMPAIGN " + run.loop + " COMPLETE\n\n" +
                    "SCORE   " + run.score;
            }
        }
    },

    onMenuAction(action, run) {
        if (action === "continue" && run) {
            advanceLoop(run);
            return "playing";
        }
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "laser") {
            audio.tone(1100, 0.07, "square", 0.35);
            audio.tone(500, 0.1, "square", 0.25);
        } else if (name === "enemyLaser") {
            audio.tone(700, 0.08, "square", 0.25);
            audio.tone(350, 0.1, "square", 0.2);
        } else if (name === "enemyHit") {
            audio.tone(260, 0.12, "sawtooth", 0.55);
            audio.tone(140, 0.18, "sawtooth", 0.4);
        } else if (name === "enemyBoom") {
            audio.tone(140, 0.2, "sawtooth", 0.7);
            audio.tone(80, 0.28, "sawtooth", 0.55);
        } else if (name === "shieldHit") {
            audio.tone(180, 0.22, "sawtooth", 0.5);
            audio.tone(90, 0.18, "sawtooth", 0.45);
        } else if (name === "shipExplode") {
            audio.sequence([
                [90, 0.25, "sawtooth", 0.8],
                [60, 0.3, "sawtooth", 0.7],
                [40, 0.4, "sawtooth", 0.5],
            ]);
        } else if (name === "ace") {
            audio.tone(520, 0.35, "sawtooth", 0.32);
            audio.tone(320, 0.45, "sawtooth", 0.28);
        } else if (name === "lock") {
            audio.tone(1400, 0.05, "square", 0.35);
        } else if (name === "bullseye") {
            audio.sequence([
                [523, 0.1, "square", 0.6],
                [659, 0.1, "square", 0.7],
                [784, 0.1, "square", 0.8],
                [1047, 0.3, "square", 0.9],
            ]);
        } else if (name === "directHit") {
            audio.sequence([
                [523, 0.1, "square", 0.6],
                [784, 0.22, "square", 0.8],
            ]);
        } else if (name === "wave") {
            audio.sequence([
                [330, 0.1, "triangle", 0.6],
                [440, 0.1, "triangle", 0.6],
                [554, 0.18, "triangle", 0.7],
            ]);
        } else if (name === "bonusShield") {
            audio.sequence([
                [659, 0.08, "triangle", 0.5],
                [880, 0.08, "triangle", 0.6],
                [1175, 0.16, "triangle", 0.7],
            ]);
        }
    },
};

// ── Yoke / pointer lock ──────────────────────────────────────────────────

function clamp1(v) {
    return v < -1 ? -1 : (v > 1 ? 1 : v);
}

function toYoke(px, py, W, H) {
    const nx = (px - W * 0.5) / (W * 0.5);
    const ny = (py - H * 0.5) / (H * 0.5);
    const dead = 0.06;
    function curve(v) {
        const s = v < 0 ? -1 : 1;
        let a = Math.abs(v);
        if (a < dead) return 0;
        a = (a - dead) / (1 - dead);
        return s * Math.min(1, a);
    }
    return { x: curve(nx), y: -curve(ny) };
}

/** One listener set per canvas; always targets the latest run on that canvas. */
function attachYoke(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._starfighterRun = run;
    if (canvas._starfighterYoke) return;
    canvas._starfighterYoke = true;

    canvas.addEventListener("mousemove", (ev) => {
        const r = canvas._starfighterRun;
        if (!r || !r.view) return;
        if (document.pointerLockElement === canvas) {
            r.lockYokeX = clamp1(r.lockYokeX + ev.movementX * YOKE_SENSITIVITY);
            r.lockYokeY = clamp1(r.lockYokeY - ev.movementY * YOKE_SENSITIVITY);
            r.yokeX = r.lockYokeX;
            r.yokeY = r.lockYokeY;
            return;
        }
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        if (!rect || !rect.width || !rect.height) return;
        const W = r.view.width();
        const H = r.view.height();
        const px = (ev.clientX - rect.left) * (W / rect.width);
        const py = (ev.clientY - rect.top) * (H / rect.height);
        const y = toYoke(px, py, W, H);
        r.yokeX = y.x;
        r.yokeY = y.y;
    });

    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

    document.addEventListener("pointerlockchange", () => {
        const r = canvas._starfighterRun;
        if (document.pointerLockElement === canvas && r) {
            r.lockYokeX = 0;
            r.lockYokeY = 0;
        }
    });
}

function setPlayingCursor(on) {
    if (on) document.body.classList.add("playing");
    else document.body.classList.remove("playing");
}

function requestPlayLock(view) {
    if (!view || !view.canvas) return;
    try { view.canvas.requestPointerLock(); } catch (e) { /* ignore */ }
}

function exitPlayLock() {
    try {
        if (document.pointerLockElement) document.exitPointerLock();
    } catch (e) { /* ignore */ }
}

// ── Title star tunnel ────────────────────────────────────────────────────

const titleStars = [];
let titleLastT = 0;

function drawTitleStars(ctx, W, H) {
    if (!titleStars.length) {
        for (let i = 0; i < 200; i++) {
            titleStars.push({
                x: Math.random() * 2 - 1,
                y: Math.random() * 2 - 1,
                z: 0.2 + Math.random() * 0.8,
                s: 0.3 + Math.random() * 0.9,
            });
        }
    }
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    let dt = titleLastT ? now - titleLastT : 16;
    if (dt > 50) dt = 50;
    titleLastT = now;

    const adv = 0.00015 * dt;
    for (let i = 0; i < titleStars.length; i++) {
        const s = titleStars[i];
        s.z -= adv;
        if (s.z <= 0.05) {
            s.x = Math.random() * 2 - 1;
            s.y = Math.random() * 2 - 1;
            s.z = 1.0;
            s.s = 0.3 + Math.random() * 0.9;
        }
    }

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    for (let i = 0; i < titleStars.length; i++) {
        const s = titleStars[i];
        const scale = 1 / s.z;
        const px = W * 0.5 + s.x * W * 0.5 * scale;
        const py = H * 0.5 + s.y * H * 0.5 * scale;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        ctx.globalAlpha = Math.min(1, (1 - s.z) * 1.4);
        const sz = s.s * (2 - s.z);
        ctx.fillRect(px | 0, py | 0, Math.max(1, sz | 0), Math.max(1, sz | 0));
    }
    ctx.globalAlpha = 1;
}

// ── Run helpers ──────────────────────────────────────────────────────────

function shieldBar(shields) {
    let bar = "";
    for (let i = 0; i < MAX_SHIELDS; i++) bar += (i < shields ? "■ " : "□ ");
    return bar.trim();
}

function radio(run, text, ms) {
    run.radioText = text;
    run.radioUntil = performance.now() + (ms || 2000);
}

function toggleTargetingComputer(run) {
    run.targetingComputer = !run.targetingComputer;
    radio(
        run,
        run.targetingComputer ? "TARGETING COMPUTER: ON" : "TARGETING COMPUTER: OFF",
        1400
    );
}

function makeApi(run) {
    return {
        getLoop: () => run.loop,
        addEnemy: (e) => { run.enemies.push(e); },
        spawnEnemyBolt: (fx, fy, fz) => spawnEnemyBolt(run, fx, fy, fz),
        hasLiveEnemies: () => {
            for (let i = 0; i < run.enemies.length; i++) {
                if (!run.enemies[i].dead) return true;
            }
            return false;
        },
        onFireballImpact: () => takeDamage(run, 1),
        takeDamage: (n) => takeDamage(run, n),
        addScore: (pts) => { run.score += pts | 0; },
        radio: (text, ms) => radio(run, text, ms),
        getShip: () => ({ x: run.shipX, y: run.shipY }),
        getWave: () => run.wave,
        getWaveScript: () => run.wavescript,
        getRailSpeed: () => {
            if (run.wavescript && run.wavescript.railSpeed != null) {
                return run.wavescript.railSpeed;
            }
            return FORWARD_SPEED;
        },
        _setLock: (on) => { run.lockActive = !!on; },
        play: (name) => { if (run.play) run.play(name); },
        onPortMiss: () => {
            if (!run.wavescript || run.wavescript.portResolved) return;
            run.wavescript.portResolved = true;
            radio(run, "VENT MISSED  ::  PULL UP", 2400);
        },
    };
}

function enterWave(run) {
    run.sectorT = 0;
    run.lockActive = false;
    run.enemies.length = 0;
    run.playerBolts.length = 0;
    run.enemyBolts.length = 0;
    run.explosions.length = 0;
    const api = makeApi(run);
    run.wavescript = Waves.create(run.wave, api);
    if (run.wave === Waves.SPACE) {
        radio(run, "SECTOR " + run.loop + "-1  ::  ENEMY FIGHTERS INBOUND", 2600);
    } else if (run.wave === Waves.SURFACE) {
        radio(run, "SECTOR " + run.loop + "-2  ::  CITADEL SURFACE  ::  TOWERS HOT", 2600);
    } else if (run.wave === Waves.TRENCH) {
        radio(run, "SECTOR " + run.loop + "-3  ::  TRENCH APPROACH  ::  HIT THE VENT", 2600);
    }
}

function completeWave(run) {
    if (run.shields < MAX_SHIELDS) {
        run.shields = Math.min(MAX_SHIELDS, run.shields + Waves.waveCompleteBonusShields());
        run.play("bonusShield");
    }

    let bonus = (SECTOR_BONUS[run.wave] || 0) * Waves.loopScale(run.loop);
    bonus = Math.round(bonus);
    if (bonus > 0) {
        run.score += bonus;
        radio(run, "SECTOR CLEAR  +" + bonus, 2200);
    }

    const next = Waves.nextWave(run.wave);
    if (!next) {
        let sb = run.shields * SHIELD_BONUS_PER * Waves.loopScale(run.loop);
        sb = Math.round(sb);
        if (sb > 0) run.score += sb;
        run.victoryPending = true;
        return;
    }
    run.wave = next;
    run.sector = (run.wave === Waves.SPACE ? 1 : run.wave === Waves.SURFACE ? 2 : 3);
    enterWave(run);
    run.play("wave");
}

function advanceLoop(run) {
    run.loop += 1;
    run.sector = 1;
    run.wave = Waves.SPACE;
    run.victoryPending = false;
    enterWave(run);
    run.play("wave");
}

function takeDamage(run, amount) {
    amount = amount || 1;
    run.shields -= amount;
    Render.shake(8, 260);
    Render.setJitter(1.5);
    Render.flash("#f33", 220);
    run.play("shieldHit");
    setTimeout(() => { Render.setJitter(0); }, 220);
    if (run.shields <= 0) {
        run.shields = 0;
        run.gameOver = true;
        Render.shake(16, 900);
    }
}

// ── Combat ───────────────────────────────────────────────────────────────

function fireLasers(run) {
    if (run.fireCooldown > 0) return;
    run.fireCooldown = FIRE_COOLDOWN_MS;

    const tx = run.reticleX;
    const ty = run.reticleY;
    for (let i = 0; i < WINGTIP_OFFSETS.length; i++) {
        const w = WINGTIP_OFFSETS[i];
        run.playerBolts.push({
            ox: run.shipX + w.x,
            oy: run.shipY + w.y,
            oz: 1.0,
            tx: tx, ty: ty, tz: RETICLE_Z,
            t: 0, life: BOLT_VISUAL_LIFE,
            color: "#f44",
        });
    }
    run.play("laser");

    const ox = run.shipX;
    const oy = run.shipY;
    const oz = 0;
    let dx = tx - ox;
    let dy = ty - oy;
    let dz = RETICLE_Z - oz;
    const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dlen < 0.001) return;
    dx /= dlen; dy /= dlen; dz /= dlen;

    let bestT = Infinity;
    let bestEnemy = null;
    for (let j = 0; j < run.enemies.length; j++) {
        const e = run.enemies[j];
        if (e.dead || e.hp <= 0) continue;
        if (e.kind === "fireball") continue;
        const cx = e.x - ox;
        const cy = e.y - oy;
        const cz = e.z - oz;
        const tca = cx * dx + cy * dy + cz * dz;
        if (tca < 0) continue;
        const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
        const r = e.radius + 0.5;
        if (d2 > r * r) continue;
        const thc = Math.sqrt(r * r - d2);
        const t0 = tca - thc;
        if (t0 < bestT) { bestT = t0; bestEnemy = e; }
    }
    if (bestEnemy) {
        if (bestEnemy.kind === "ace") {
            if (!bestEnemy.flee) {
                bestEnemy.flee = true;
                run.score += 2000;
                run.play("enemyHit");
                radio(run, "BLACK ACE BREAKING OFF", 1600);
            }
        } else if (bestEnemy.kind === "port") {
            resolvePortHit(run, bestEnemy, ox, oy, oz, dx, dy, dz);
        } else {
            bestEnemy.hp -= 1;
            if (bestEnemy.hp <= 0) killEnemy(run, bestEnemy);
        }
    }
}

function resolvePortHit(run, port, ox, oy, oz, dx, dy, dz) {
    if (port.resolved) return;
    const cx = port.x - ox;
    const cy = port.y - oy;
    const cz = port.z - oz;
    const tca = cx * dx + cy * dy + cz * dz;
    if (tca < 0) return;
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    const d = Math.sqrt(Math.max(0, d2));

    const trust = !run.targetingComputer;
    const trustMult = trust ? 2 : 1;

    if (d <= port.innerRadius) {
        const pts = 100000 * trustMult;
        run.score += pts;
        radio(run, trust ? "BULLSEYE  ::  TRUST BONUS x2" : "BULLSEYE", 2600);
        run.play("bullseye");
    } else {
        const dpts = 25000 * trustMult;
        run.score += dpts;
        radio(run, trust ? "DIRECT HIT  ::  TRUST BONUS x2" : "DIRECT HIT", 2600);
        run.play("directHit");
    }
    port.resolved = true;
    port.dead = true;
    spawnExplosion(run, port.x, port.y, port.z, 3.5);
    Render.shake(18, 900);
    Render.flash("#fff", 360);
    if (run.wavescript) run.wavescript.portResolved = true;
}

function killEnemy(run, e) {
    e.dead = true;
    run.score += e.score || 0;
    spawnExplosion(run, e.x, e.y, e.z, e.scale || 1.4);
    run.play("enemyBoom");
}

function spawnExplosion(run, x, y, z, scale) {
    if (run.explosions.length >= MAX_EXPLOSIONS) run.explosions.shift();
    const shards = [];
    const n = 8 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const p = (Math.random() - 0.5) * Math.PI;
        const speed = 0.01 + Math.random() * 0.025;
        shards.push({
            vx: Math.cos(a) * Math.cos(p) * speed * scale,
            vy: Math.sin(p) * speed * scale,
            vz: Math.sin(a) * Math.cos(p) * speed * scale,
            len: 1.2 + Math.random() * 1.8,
        });
    }
    run.explosions.push({ x: x, y: y, z: z, shards: shards, t: 0, life: 550 });
}

function updateExplosions(run, dt) {
    for (let i = run.explosions.length - 1; i >= 0; i--) {
        const e = run.explosions[i];
        e.t += dt;
        if (e.t >= e.life) run.explosions.splice(i, 1);
    }
}

function drawExplosions(run, ctx) {
    for (let i = 0; i < run.explosions.length; i++) {
        const e = run.explosions[i];
        const u = e.t / e.life;
        const alpha = 1 - u;
        for (let j = 0; j < e.shards.length; j++) {
            const s = e.shards[j];
            const ax = e.x + s.vx * e.t;
            const ay = e.y + s.vy * e.t;
            const az = e.z + s.vz * e.t;
            const bx = ax - s.vx * 40;
            const by = ay - s.vy * 40;
            const bz = az - s.vz * 40;
            const c = u < 0.3 ? "#ff8" : (u < 0.7 ? "#f84" : "#844");
            Render.line(ctx, ax, ay, az, bx, by, bz, c, alpha);
        }
    }
}

function updatePlayerBolts(run, dt) {
    for (let i = run.playerBolts.length - 1; i >= 0; i--) {
        const b = run.playerBolts[i];
        b.t += dt;
        if (b.t >= b.life) run.playerBolts.splice(i, 1);
    }
}

function drawPlayerBolts(run, ctx) {
    for (let i = 0; i < run.playerBolts.length; i++) {
        const b = run.playerBolts[i];
        const u = b.t / b.life;
        const headU = Math.min(1, u * 2.2);
        const tailU = Math.max(0, headU - 0.35);
        const hx = b.ox + (b.tx - b.ox) * headU;
        const hy = b.oy + (b.ty - b.oy) * headU;
        const hz = b.oz + (b.tz - b.oz) * headU;
        const tx = b.ox + (b.tx - b.ox) * tailU;
        const ty = b.oy + (b.ty - b.oy) * tailU;
        const tz = b.oz + (b.tz - b.oz) * tailU;
        Render.line(ctx, hx, hy, hz, tx, ty, tz, b.color, 1 - u * 0.4);
    }
}

function spawnEnemyBolt(run, fx, fy, fz) {
    let dx = run.shipX - fx;
    let dy = run.shipY - fy;
    let dz = 0 - fz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.001) return;
    dx /= len; dy /= len; dz /= len;
    run.enemyBolts.push({
        x: fx, y: fy, z: fz,
        vx: dx * ENEMY_BOLT_SPEED,
        vy: dy * ENEMY_BOLT_SPEED,
        vz: dz * ENEMY_BOLT_SPEED,
        life: 4500, t: 0,
        color: "#6cf",
    });
    run.play("enemyLaser");
}

function updateEnemyBolts(run, dt) {
    for (let i = run.enemyBolts.length - 1; i >= 0; i--) {
        const b = run.enemyBolts[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        b.t += dt;
        if (b.z < 0 || b.t >= b.life) {
            if (b.z < Render.NEAR_Z + 1) {
                const dx = b.x - run.shipX;
                const dy = b.y - run.shipY;
                if (dx * dx + dy * dy < PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS + 2) {
                    takeDamage(run, 1);
                }
            }
            run.enemyBolts.splice(i, 1);
        }
    }
}

function drawEnemyBolts(run, ctx) {
    for (let i = 0; i < run.enemyBolts.length; i++) {
        const b = run.enemyBolts[i];
        const trail = 12;
        const tx = b.x - b.vx * trail;
        const ty = b.y - b.vy * trail;
        const tz = b.z - b.vz * trail;
        Render.line(ctx, b.x, b.y, b.z, tx, ty, tz, b.color, 1);
    }
}

// ── Frame step / draw ────────────────────────────────────────────────────

function stepRun(run, dt) {
    run.sectorT += dt;

    const targetX = run.yokeX * YOKE_MAX_DEFLECT;
    const targetY = run.yokeY * YOKE_MAX_DEFLECT;
    const k = Math.min(1, dt / RETICLE_LAG_MS);
    run.shipX += (targetX - run.shipX) * k;
    run.shipY += (targetY - run.shipY) * k;
    run.reticleX = targetX;
    run.reticleY = targetY;

    Render.setCamera(run.shipX * PARALLAX, run.shipY * PARALLAX);
    Render.advanceStars(FORWARD_SPEED * dt);
    Render.updateShake(dt);
    Render.updateFlash(dt);

    if (run.fireCooldown > 0) run.fireCooldown -= dt;
    if (run.firePressed) fireLasers(run);

    const api = makeApi(run);
    Waves.update(run.wavescript, dt, api);

    for (let i = 0; i < run.enemies.length; i++) {
        Enemies.update(run.enemies[i], dt, api);
    }
    for (let j = run.enemies.length - 1; j >= 0; j--) {
        if (run.enemies[j].dead) run.enemies.splice(j, 1);
    }

    updatePlayerBolts(run, dt);
    updateEnemyBolts(run, dt);
    updateExplosions(run, dt);

    if (!run.victoryPending && Waves.isComplete(run.wavescript, api)) {
        completeWave(run);
    }
}

function drawCockpit(ctx, W, H) {
    ctx.strokeStyle = "#3a4";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    const inset = 18;
    const cornerLen = 90;
    ctx.beginPath();
    ctx.moveTo(inset, inset + cornerLen);
    ctx.lineTo(inset, inset);
    ctx.lineTo(inset + cornerLen, inset);
    ctx.moveTo(W - inset - cornerLen, inset);
    ctx.lineTo(W - inset, inset);
    ctx.lineTo(W - inset, inset + cornerLen);
    ctx.moveTo(inset, H - inset - cornerLen);
    ctx.lineTo(inset, H - inset);
    ctx.lineTo(inset + cornerLen, H - inset);
    ctx.moveTo(W - inset - cornerLen, H - inset);
    ctx.lineTo(W - inset, H - inset);
    ctx.lineTo(W - inset, H - inset - cornerLen);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawReticle(run, ctx) {
    const pr = Render.projectHud(run.reticleX, run.reticleY, RETICLE_Z);
    const ps = Render.projectHud(run.shipX, run.shipY, RETICLE_Z);
    if (pr.visible) {
        ctx.strokeStyle = "#ff4";
        ctx.lineWidth = 2;
        const x = pr.x;
        const y = pr.y;
        ctx.beginPath();
        ctx.moveTo(x - 18, y); ctx.lineTo(x - 6, y);
        ctx.moveTo(x + 6, y); ctx.lineTo(x + 18, y);
        ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 6);
        ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 18);
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (ps.visible) {
        ctx.strokeStyle = "#6bf";
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(ps.x, ps.y + 4);
        ctx.lineTo(ps.x - 5, ps.y + 10);
        ctx.lineTo(ps.x + 5, ps.y + 10);
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

function drawRun(run, ctx, W, H) {
    const api = makeApi(run);
    Waves.draw(run.wavescript, ctx, api);

    ctx.lineWidth = 1.5;

    const drawList = run.enemies.slice().sort((a, b) => b.z - a.z);
    for (let i = 0; i < drawList.length; i++) {
        Enemies.draw(drawList[i], ctx);
    }

    drawEnemyBolts(run, ctx);
    drawPlayerBolts(run, ctx);
    drawExplosions(run, ctx);
    drawCockpit(ctx, W, H);
    drawReticle(run, ctx);
    Render.drawFlash(ctx);
}

function syncHudExtras(run) {
    const lock = document.getElementById("hud-lock");
    const radioEl = document.getElementById("hud-radio");
    if (!run) {
        if (lock) lock.classList.remove("active");
        if (radioEl) radioEl.classList.remove("active");
        return;
    }
    if (lock) {
        if (run.lockActive) {
            lock.textContent = "— LOCK —";
            lock.classList.add("active");
        } else {
            lock.classList.remove("active");
        }
    }
    if (radioEl) {
        const active = performance.now() < run.radioUntil;
        if (active) {
            radioEl.textContent = run.radioText;
            radioEl.classList.add("active");
        } else {
            radioEl.classList.remove("active");
        }
    }
}
