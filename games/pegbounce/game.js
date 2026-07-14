// Pegbounce — arcade foundation plugin.
// Domain: physics.js, levels.js, guides.js. Shell owns screens / loop / pause.
// Layout: plugin → level/shot → input → draw → screens DOM → test hooks.

import { Particles } from "/lib/particles.js";
import { Physics } from "/app/physics.js";
import { Levels } from "/app/levels.js";
import { Guides } from "/app/guides.js";

const FIELD_W = Physics.FIELD_W;
const FIELD_H = Physics.FIELD_H;

const PEG_COLORS = {
    blue: "#5aa6ff",
    orange: "#ff9a2a",
    green: "#58e05a",
    purple: "#c97aff",
};

/** Session prefs carried across runs (level/guide selection). */
const session = {
    levelIdx: 0,
    guideId: "wingtip",
};

/** @type {object|null} Shell api from boot / create. */
let shellRef = null;
/** @type {object|null} Latest play run (for test hooks). */
let activeRun = null;

export const game = {
    id: "pegbounce",
    clearColor: "#04060c",

    defaults: {
        highScore: 0,
        unlocked: 1,
        best: {},
        stars: {},
        selectedGuide: "wingtip",
        trajectory: true,
        screenshake: true,
    },

    create(ctx) {
        shellRef = ctx;
        session.guideId = ctx.save.get("selectedGuide") || session.guideId || "wingtip";

        const run = {
            score: 0,
            world: null,
            levelIdx: session.levelIdx,
            balls: 10,
            ballsStart: 10,
            mult: 1,
            shotScore: 0,
            shotOrangeCount: 0,
            comboCount: 0,
            totalOrangeStart: 0,
            levelClearTriggered: false,
            levelFailTriggered: false,
            shotInProgress: false,
            aimAngle: Math.PI / 2,
            mouseOverCanvas: false,
            mouseX: FIELD_W / 2,
            mouseY: 200,
            cannonX: FIELD_W / 2,
            cannonY: 40,
            particles: Particles.createSystem({ cap: 800 }),
            fx: { shake: 0 },
            purpleActive: false,
            guideId: session.guideId,
            bonusBallsAwarded: 0,
            mirageShowing: false,
            lastLaunchSpeed: 820,
            pending: null, // "clear" | "fail" | null
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
            audio: ctx.audio,
            view: ctx.view,
        };

        loadLevel(run, run.levelIdx);
        attachPointer(run);
        activeRun = run;
        return run;
    },

    update(run, dt, input) {
        activeRun = run;
        if (!run.world) return;

        if (run.pending === "clear") {
            run.pending = null;
            persistClear(run);
            run.play("levelclear");
            return { status: "screen", name: "clear" };
        }
        if (run.pending === "fail") {
            run.pending = null;
            run.play("levelfail");
            return { status: "screen", name: "fail" };
        }

        const dtSec = Math.min(0.033, dt / 1000);

        // Keyboard aim
        const rate = Math.PI * 0.9 * dtSec;
        if (input.down("left")) run.aimAngle -= rate;
        if (input.down("right")) run.aimAngle += rate;
        run.aimAngle = Math.max(0.08, Math.min(Math.PI - 0.08, run.aimAngle));

        // Mouse aim when over canvas
        if (run.mouseOverCanvas) {
            updateAimFromPointer(run);
        }

        if (input.pressed("primary")) tryLaunch(run);

        Physics.step(run.world, dtSec);
        drainEvents(run);
        Particles.step(run.particles, dtSec);

        if (run.fx.shake > 0) run.fx.shake = Math.max(0, run.fx.shake - dtSec * 2);

        // Sync score for shell high-score tracking
        run.score = (run.score || 0);
        // Display total is score + shotScore; keep run.score as banked only.
        // Shell uses run.score for highScore — we update banked score in finishShot.
    },

    draw(run, ctx, view) {
        if (!run || !run.world) return;
        const { w, h } = view.size();
        const fit = fitScale(w, h);

        ctx.fillStyle = "#04060c";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        let sx = 0, sy = 0;
        if (run.fx.shake > 0 && run.save.get("screenshake") !== false) {
            sx = (Math.random() - 0.5) * 8 * run.fx.shake;
            sy = (Math.random() - 0.5) * 8 * run.fx.shake;
        }
        ctx.translate(fit.offX + sx, fit.offY + sy);
        ctx.scale(fit.scale, fit.scale);

        const lv = Levels.LEVELS[run.levelIdx];
        drawBackground(ctx, lv);
        ctx.fillStyle = "rgba(8, 12, 26, 0.85)";
        ctx.fillRect(0, 0, FIELD_W, Physics.FIELD_TOP);
        ctx.strokeStyle = "#23306a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Physics.FIELD_TOP);
        ctx.lineTo(FIELD_W, Physics.FIELD_TOP);
        ctx.stroke();

        drawAimGuide(run, ctx);
        for (const p of run.world.pegs) drawPeg(ctx, p);
        drawPulses(ctx, run.world.pulses);
        drawBall(ctx, run.world.ball);
        for (const eb of run.world.extraBalls) drawBall(ctx, eb);
        drawCatchbar(ctx, run.world.catchbar);
        drawCannon(run, ctx);
        Particles.draw(run.particles, ctx);

        ctx.restore();

        // Floating combo / fever (DOM)
        const comboEl = document.getElementById("combo-text");
        if (comboEl) {
            if (run.comboCount > 4 && run.shotInProgress) {
                comboEl.textContent = "COMBO ×" + run.comboCount;
                comboEl.style.display = "block";
            } else {
                comboEl.style.display = "none";
            }
        }
    },

    hud(run) {
        if (!run || !run.world) {
            return { score: 0, balls: 0, orange: 0, mult: "x1", guide: "—", level: "—" };
        }
        const lv = Levels.LEVELS[run.levelIdx];
        const mult = run.mult * (run.purpleActive ? 2 : 1);
        return {
            score: run.score + run.shotScore,
            balls: run.balls,
            orange: Physics.countRemainingOrange(run.world),
            mult: "x" + mult,
            guide: Guides.byId(run.guideId).name,
            level: (run.levelIdx + 1) + " — " + lv.name,
        };
    },

    gameOverText(run) {
        if (!run) return "No run";
        const lv = Levels.LEVELS[run.levelIdx];
        const best = run.highScore ? run.highScore() : 0;
        const tag = run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score    " + run.score + tag + "\n" +
            "Level    " + (run.levelIdx + 1) + " — " + (lv ? lv.name : "") + "\n" +
            "Best     " + best
        );
    },

    onEnterScreen(name, run, api) {
        if (name === "levels") renderLevelGrid(api);
        if (name === "guide") renderGuideCards(api);
        if (name === "highscores") renderHighScores(api);
        if (name === "settings") renderSettings(api);
        if (name === "clear" && run) {
            const lv = Levels.LEVELS[run.levelIdx];
            const stars = starCount(run.score, lv.stars);
            const el = document.getElementById("clear-stats");
            if (el) {
                el.textContent =
                    "Level " + (run.levelIdx + 1) + " — " + lv.name + "\n" +
                    "Score: " + run.score + "\n" +
                    "Balls used: " + (run.ballsStart - run.balls);
            }
            const st = document.getElementById("clear-stars");
            if (st) {
                st.textContent =
                    ["★", "★", "★"].slice(0, stars).join("") +
                    ["☆", "☆", "☆"].slice(0, 3 - stars).join("");
            }
        }
        if (name === "fail" && run && run.world) {
            const el = document.getElementById("fail-stats");
            if (el) {
                const rem = Physics.countRemainingOrange(run.world);
                el.textContent =
                    "Cleared " + (run.totalOrangeStart - rem) +
                    " of " + run.totalOrangeStart + " orange pegs.\n" +
                    "Score: " + run.score;
            }
        }
    },

    onMenuAction(action, run, api) {
        if (action === "levels") return "levels";
        if (action === "highscores") return "highscores";
        if (action === "settings") return "settings";
        if (action === "credits") return "credits";

        if (action === "toggle-trajectory") {
            api.save.set("trajectory", !api.save.get("trajectory"));
            api.save.save();
            renderSettings(api);
            return null;
        }
        if (action === "toggle-screenshake") {
            api.save.set("screenshake", !api.save.get("screenshake"));
            api.save.save();
            renderSettings(api);
            return null;
        }

        if (action === "startlevel") {
            return { startRun: true };
        }
        if (action === "retry") {
            return { startRun: true };
        }
        if (action === "next" && run) {
            session.levelIdx = Math.min(run.levelIdx + 1, Levels.LEVELS.length - 1);
            return "guide";
        }

        return null;
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        const ladder = (combo) => {
            const base = 261.63;
            const i = Math.min(35, Math.max(0, combo | 0));
            return base * Math.pow(2, i / 12);
        };
        if (name === "launch") audio.tone(480, 0.09, "triangle", 0.45);
        else if (name === "wall") audio.tone(140, 0.03, "square", 0.2);
        else if (name === "peg") audio.tone(ladder(0), 0.06, "triangle", 0.45);
        else if (name === "orange") audio.tone(ladder(4) * 1.5, 0.12, "square", 0.5);
        else if (name === "green") {
            audio.sequence([
                [660, 0.06, "triangle", 0.55],
                [880, 0.08, "triangle", 0.55],
                [1320, 0.1, "square", 0.6],
            ]);
        } else if (name === "purple") {
            audio.sequence([
                [520, 0.06, "sawtooth", 0.45],
                [780, 0.08, "sawtooth", 0.5],
            ]);
        } else if (name === "catch") {
            audio.sequence([
                [700, 0.06, "square", 0.5],
                [950, 0.06, "square", 0.55],
                [1250, 0.1, "triangle", 0.6],
            ]);
        } else if (name === "levelclear") {
            audio.sequence([
                [523, 0.1, "square", 0.55],
                [659, 0.1, "square", 0.6],
                [784, 0.1, "square", 0.65],
                [1047, 0.2, "triangle", 0.7],
            ]);
        } else if (name === "levelfail") {
            audio.sequence([
                [250, 0.15, "sawtooth", 0.5],
                [180, 0.2, "sawtooth", 0.55],
            ]);
        } else if (name === "fever") {
            audio.sequence([
                [330, 0.08, "sawtooth", 0.5],
                [440, 0.08, "sawtooth", 0.55],
                [660, 0.08, "square", 0.6],
                [880, 0.18, "square", 0.7],
            ]);
        } else if (name.indexOf("peg@") === 0) {
            const c = parseInt(name.slice(4), 10) || 0;
            audio.tone(ladder(c), 0.06, "triangle", 0.45);
        } else if (name.indexOf("orange@") === 0) {
            const c = parseInt(name.slice(7), 10) || 0;
            audio.tone(ladder(c) * 1.5, 0.12, "square", 0.5);
        }
    },
};

// ── Level / shot ──────────────────────────────────────────────────────────

function loadLevel(run, idx) {
    if (run.world) Physics.destroyWorld(run.world);
    run.levelIdx = idx;
    session.levelIdx = idx;
    const lv = Levels.LEVELS[idx];
    run.world = Levels.buildLevel(idx, idx * 73 + 11);
    run.balls = lv.balls;
    run.ballsStart = lv.balls;
    run.score = 0;
    run.mult = 1;
    run.shotScore = 0;
    run.shotOrangeCount = 0;
    run.comboCount = 0;
    run.totalOrangeStart = Physics.countRemainingOrange(run.world);
    run.levelClearTriggered = false;
    run.levelFailTriggered = false;
    run.shotInProgress = false;
    run.aimAngle = Math.PI / 2;
    run.purpleActive = false;
    run.bonusBallsAwarded = 0;
    run.mirageShowing = false;
    run.fx.shake = 0;
    run.pending = null;
    Particles.clear(run.particles);
}

function tryLaunch(run) {
    if (run.shotInProgress) return;
    if (run.balls <= 0) return;
    if (run.levelClearTriggered || run.levelFailTriggered) return;
    const speed = run.lastLaunchSpeed;
    run.shotInProgress = true;
    run.shotScore = 0;
    run.shotOrangeCount = 0;
    run.comboCount = 0;
    run.mult = 1;
    run.purpleActive = false;
    run.balls -= 1;
    run.mirageShowing = false;
    const muzzleX = run.cannonX + Math.cos(run.aimAngle) * 30;
    const muzzleY = run.cannonY + Math.sin(run.aimAngle) * 30;
    Physics.launchBall(run.world, run.aimAngle, speed, muzzleX, muzzleY);
    run.play("launch");
}

function finishShot(run) {
    const removed = Physics.sweepLit(run.world);
    for (const p of removed) {
        Particles.burst(run.particles, p.x, p.y, pegColor(p.type), 12, 220);
    }
    if (run.world.caughtThisShot) {
        run.balls += 1;
        toast("Free ball!");
        run.play("catch");
        run.world.caughtThisShot = false;
    }

    run.score += run.shotScore;
    if (run.save) run.save.maybeHighScore(run.score);

    const remOr = Physics.countRemainingOrange(run.world);
    const cleared = run.totalOrangeStart - remOr;
    const targetBonus = Math.floor(cleared / 10);
    while (run.bonusBallsAwarded < targetBonus) {
        run.balls += 1;
        run.bonusBallsAwarded++;
        toast("Bonus ball!");
    }

    // Mirage guide: reveal path for next shot
    if (run.world.mirageNextShot) {
        run.mirageShowing = true;
        run.world.mirageNextShot = false;
    }

    run.shotInProgress = false;
    run.shotScore = 0;
    run.comboCount = 0;

    if (remOr === 0 && !run.levelClearTriggered) {
        run.levelClearTriggered = true;
        run.pending = "clear";
        return;
    }
    if (run.balls <= 0 && !run.levelFailTriggered) {
        run.levelFailTriggered = true;
        run.pending = "fail";
    }
}

function persistClear(run) {
    const lv = Levels.LEVELS[run.levelIdx];
    const bestMap = Object.assign({}, run.save.get("best") || {});
    const starMap = Object.assign({}, run.save.get("stars") || {});
    const prevBest = bestMap[lv.id] || 0;
    if (run.score > prevBest) bestMap[lv.id] = run.score;
    const stars = starCount(run.score, lv.stars);
    if (stars > (starMap[lv.id] || 0)) starMap[lv.id] = stars;
    const unlocked = Math.max(run.save.get("unlocked") || 1, run.levelIdx + 2);
    run.save.set("best", bestMap);
    run.save.set("stars", starMap);
    run.save.set("unlocked", Math.min(unlocked, Levels.LEVELS.length));
    run.save.maybeHighScore(run.score);
    run.save.save();
}

function starCount(score, thresholds) {
    let n = 0;
    for (const t of thresholds) if (score >= t) n++;
    return n;
}

function drainEvents(run) {
    const ev = run.world.scoreEvents;
    if (!ev.length) return;
    Physics.markLitFromEvents(run.world, ev);
    for (const e of ev) {
        if (e.kind === "peg-hit") {
            const peg = e.peg;
            if (!peg._scoredShot || peg._scoredShot !== run.world.shotIndex) {
                peg._scoredShot = run.world.shotIndex;
                run.comboCount++;
                let pts = 10;
                if (peg.type === Physics.PEG.ORANGE) {
                    pts = 100;
                    run.shotOrangeCount++;
                    run.play("orange@" + run.comboCount);
                } else if (peg.type === Physics.PEG.PURPLE) {
                    pts = 500;
                    run.purpleActive = true;
                    run.play("purple");
                } else if (peg.type === Physics.PEG.GREEN) {
                    pts = 10;
                    Guides.byId(run.guideId).trigger(run.world, peg);
                    run.play("green");
                } else {
                    run.play("peg@" + run.comboCount);
                }
                run.mult = comboMult(run.shotOrangeCount, run.comboCount);
                const baseMult = run.mult * (run.purpleActive ? 2 : 1);
                run.shotScore += pts * baseMult;
                Particles.burst(run.particles, peg.x, peg.y, pegColor(peg.type), 6, 160);
            }
            if (
                Physics.countRemainingOrange(run.world) === 1 &&
                peg.type === Physics.PEG.ORANGE &&
                peg.lit
            ) {
                run.world.slowmo = 1.1;
            }
            if (Physics.countRemainingOrange(run.world) === 0 && !run.world.feverBlasted) {
                run.world.feverBlasted = true;
                run.shotScore += 25000;
                run.fx.shake = 1.0;
                showFever("ULTRA EXTREME!");
                run.play("fever");
            }
        } else if (e.kind === "wall-hit") {
            run.play("wall");
        } else if (e.kind === "catchbar-hit") {
            run.world.caughtThisShot = true;
        } else if (e.kind === "ball-exit") {
            if (!Physics.hasActiveBall(run.world)) finishShot(run);
        }
    }
    ev.length = 0;
}

function comboMult(orangeCleared, comboCount) {
    const fromOrange =
        orangeCleared >= 15 ? 10 :
        orangeCleared >= 10 ? 5 :
        orangeCleared >= 6 ? 3 :
        orangeCleared >= 3 ? 2 : 1;
    const fromCombo =
        comboCount >= 30 ? 10 :
        comboCount >= 20 ? 5 :
        comboCount >= 12 ? 3 :
        comboCount >= 6 ? 2 : 1;
    return Math.max(fromOrange, fromCombo);
}

// ── Input / aim ───────────────────────────────────────────────────────────

/** One listener set per canvas; always targets the latest run on that canvas. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._pegbounceRun = run;
    if (canvas._pegbouncePointer) return;
    canvas._pegbouncePointer = true;

    canvas.addEventListener("mousemove", (e) => {
        const r = canvas._pegbounceRun;
        if (!r || !r.view) return;
        r.mouseOverCanvas = true;
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        if (rect) {
            const scaleX = r.view.width() / (rect.width || r.view.width());
            const scaleY = r.view.height() / (rect.height || r.view.height());
            r.mouseX = (e.clientX - rect.left) * scaleX;
            r.mouseY = (e.clientY - rect.top) * scaleY;
        } else if (typeof e.offsetX === "number") {
            r.mouseX = e.offsetX;
            r.mouseY = e.offsetY;
        } else {
            r.mouseX = e.clientX;
            r.mouseY = e.clientY;
        }
        updateAimFromPointer(r);
    });
    canvas.addEventListener("mouseleave", () => {
        const r = canvas._pegbounceRun;
        if (r) r.mouseOverCanvas = false;
    });
    canvas.addEventListener("click", () => {
        const r = canvas._pegbounceRun;
        if (!r || r.pending) return;
        // Shot lifecycle owns the rest; only launch when idle with balls left
        if (!r.shotInProgress && r.balls > 0) tryLaunch(r);
    });
}

function updateAimFromPointer(run) {
    const w = run.view ? run.view.width() : FIELD_W;
    const h = run.view ? run.view.height() : FIELD_H;
    const fit = fitScale(w, h);
    const fx = (run.mouseX - fit.offX) / fit.scale;
    const fy = (run.mouseY - fit.offY) / fit.scale;
    let ang = Math.atan2(fy - run.cannonY, fx - run.cannonX);
    ang = Math.max(0.08, Math.min(Math.PI - 0.08, ang));
    run.aimAngle = ang;
}

function fitScale(cw, ch) {
    const s = Math.min(cw / FIELD_W, ch / FIELD_H);
    const w = FIELD_W * s;
    const h = FIELD_H * s;
    return { scale: s, offX: (cw - w) * 0.5, offY: (ch - h) * 0.5 };
}

// ── Draw helpers ──────────────────────────────────────────────────────────

function pegColor(type) {
    return PEG_COLORS[type] || "#eee";
}

function drawBackground(ctx, lv) {
    const [a, b] = lv.background;
    const grad = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    const v = ctx.createRadialGradient(
        FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.3,
        FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.9
    );
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    const t = performance.now() / 1000;
    for (let i = 0; i < 40; i++) {
        const x = (i * 193) % FIELD_W;
        const y = (i * 89 + Math.sin(t + i) * 6) % FIELD_H;
        ctx.fillStyle = "rgba(255,255,255," + (0.03 + (i % 3) * 0.02) + ")";
        ctx.fillRect(x, y, 2, 2);
    }
}

function drawPeg(ctx, p) {
    if (p.removed) return;
    const col = pegColor(p.type);
    const r = Physics.PEG_RADIUS;
    const xx = p.x, yy = p.y;
    const t = performance.now() / 1000;

    if (p.type === "orange" && !p.lit) {
        const pulse = 1 + Math.sin(t * 5 + p.phase) * 0.06;
        const glow = ctx.createRadialGradient(xx, yy, 0, xx, yy, r * 3);
        glow.addColorStop(0, "rgba(255,170,60,0.45)");
        glow.addColorStop(1, "rgba(255,170,60,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(xx, yy, r * 3 * pulse, 0, Math.PI * 2);
        ctx.fill();
    } else if (p.type === "green" && !p.lit) {
        const glow = ctx.createRadialGradient(xx, yy, 0, xx, yy, r * 2.4);
        glow.addColorStop(0, "rgba(90,230,100,0.4)");
        glow.addColorStop(1, "rgba(90,230,100,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(xx, yy, r * 2.4, 0, Math.PI * 2);
        ctx.fill();
    }

    const g = ctx.createRadialGradient(xx - r * 0.3, yy - r * 0.3, 1, xx, yy, r);
    g.addColorStop(0, lighten(col, 0.4));
    g.addColorStop(1, darken(col, 0.25));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(xx, yy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.arc(xx - r * 0.35, yy - r * 0.35, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    if (p.lit) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(xx, yy, r + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

function drawBall(ctx, b) {
    if (!b || !b.active) return;
    const r = b.radius;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#fff";
    for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        ctx.beginPath();
        ctx.arc(b.x - b.vx * t * 0.03, b.y - b.vy * t * 0.03, r * (1 - t * 0.6), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + r + 2, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const fireCol = b.onFire ? "#ff6833" : "#eaf1ff";
    const g = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, 1, b.x, b.y, r);
    g.addColorStop(0, lighten(fireCol, 0.4));
    g.addColorStop(1, b.onFire ? "#ff3300" : "#6a7698");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (b.onFire) {
        const ring = ctx.createRadialGradient(b.x, b.y, r, b.x, b.y, 42);
        ring.addColorStop(0, "rgba(255,150,60,0.5)");
        ring.addColorStop(1, "rgba(255,150,60,0)");
        ctx.fillStyle = ring;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 42, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPulses(ctx, pulses) {
    if (!pulses || !pulses.length) return;
    for (const pw of pulses) {
        const t = Math.min(1, pw.age / pw.duration);
        const r = t * pw.R;
        const alpha = 1 - t;
        const g = ctx.createRadialGradient(pw.cx, pw.cy, 0, pw.cx, pw.cy, Math.max(r, 1));
        g.addColorStop(0, "rgba(140,255,150,0)");
        g.addColorStop(0.7, "rgba(140,255,150," + 0.18 * alpha + ")");
        g.addColorStop(1, "rgba(140,255,150," + 0.35 * alpha + ")");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pw.cx, pw.cy, Math.max(r, 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(180,255,180," + 0.9 * alpha + ")";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(pw.cx, pw.cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawCatchbar(ctx, cb) {
    const x = cb.x - cb.halfW;
    const y = cb.y;
    const w = cb.halfW * 2;
    const h = Physics.CATCHBAR_H;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#ffd870");
    g.addColorStop(1, "#b8740e");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x, y + h - 3, w, 3);
}

function drawCannon(run, ctx) {
    const ang = run.aimAngle;
    ctx.save();
    ctx.translate(run.cannonX, run.cannonY);
    ctx.fillStyle = "#1a2747";
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a5299";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.rotate(ang);
    ctx.fillStyle = "#c5cde2";
    ctx.fillRect(0, -6, 30, 12);
    ctx.fillStyle = "#8a95b5";
    ctx.fillRect(0, 3, 30, 3);
    ctx.restore();
    if (!run.shotInProgress && run.balls > 0) {
        const px = run.cannonX + Math.cos(ang) * 28;
        const py = run.cannonY + Math.sin(ang) * 28;
        ctx.fillStyle = "#eaf1ff";
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawAimGuide(run, ctx) {
    if (run.save.get("trajectory") === false && !run.mirageShowing) return;
    if (run.shotInProgress) return;
    if (run.balls <= 0) return;
    const speed = run.lastLaunchSpeed;
    const pts = [];
    if (run.mirageShowing) {
        Physics.predict(
            run.world, run.aimAngle, speed,
            run.cannonX + Math.cos(run.aimAngle) * 30,
            run.cannonY + Math.sin(run.aimAngle) * 30,
            2.2, pts
        );
    } else {
        const x0 = run.cannonX + Math.cos(run.aimAngle) * 30;
        const y0 = run.cannonY + Math.sin(run.aimAngle) * 30;
        let vx = Math.cos(run.aimAngle) * speed;
        let vy = Math.sin(run.aimAngle) * speed;
        let x = x0, y = y0;
        const dt = 1 / 60;
        for (let i = 0; i < 22; i++) {
            x += vx * dt;
            y += vy * dt;
            vy += 1400 * dt;
            if (y > FIELD_H) break;
            let hitPeg = false;
            for (const p of run.world.pegs) {
                if (p.removed) continue;
                if (Math.hypot(p.x - x, p.y - y) < Physics.PEG_RADIUS + 6) {
                    hitPeg = true;
                    break;
                }
            }
            if (hitPeg) break;
            pts.push({ x, y });
        }
    }
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const a = 1 - i / pts.length;
        ctx.fillStyle = "rgba(255,255,255," + (a * 0.6).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ── Screens DOM ───────────────────────────────────────────────────────────

function renderLevelGrid(api) {
    const grid = document.getElementById("level-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const unlocked = api.save.get("unlocked") || 1;
    const bestScores = api.save.get("best") || {};
    const starMap = api.save.get("stars") || {};
    for (let i = 0; i < Levels.LEVELS.length; i++) {
        const lv = Levels.LEVELS[i];
        const locked = i >= unlocked;
        const best = bestScores[lv.id];
        const stars = starMap[lv.id] || 0;
        const starStr =
            ["★", "★", "★"].slice(0, stars).join("") +
            ["☆", "☆", "☆"].slice(0, 3 - stars).join("");
        const tile = document.createElement("div");
        tile.className = "level-tile" + (locked ? " locked" : "");
        tile.innerHTML =
            '<div class="lt-num">' + (i + 1) + "</div>" +
            '<div class="lt-name">' + lv.name + "</div>" +
            '<div class="lt-stars">' + starStr + "</div>" +
            '<div class="lt-best">' + (best ? "Best " + best : locked ? "Locked" : "New") + "</div>";
        if (!locked) {
            tile.addEventListener("click", () => {
                session.levelIdx = i;
                api.switchTo("guide");
            });
        }
        grid.appendChild(tile);
    }
}

function renderGuideCards(api) {
    const root = document.getElementById("guide-cards");
    if (!root) return;
    const selected = session.guideId || api.save.get("selectedGuide") || "wingtip";
    root.innerHTML = "";
    for (const g of Guides.GUIDES) {
        const card = document.createElement("div");
        card.className = "guide-card" + (g.id === selected ? " selected" : "");
        card.innerHTML =
            '<div class="gc-icon" style="color:' + g.color + '">' + g.icon + "</div>" +
            '<div class="gc-name">' + g.name + "</div>" +
            '<div class="gc-blurb">' + g.blurb + "</div>";
        card.addEventListener("click", () => {
            session.guideId = g.id;
            api.save.set("selectedGuide", g.id);
            api.save.save();
            renderGuideCards(api);
        });
        root.appendChild(card);
    }
}

function renderHighScores(api) {
    const listEl = document.getElementById("hs-list");
    if (!listEl) return;
    const bestMap = api.save.get("best") || {};
    const starMap = api.save.get("stars") || {};
    if (!Object.keys(bestMap).length) {
        listEl.textContent = "No scores yet. Clear a level to post a score.";
        return;
    }
    const lines = [];
    for (let i = 0; i < Levels.LEVELS.length; i++) {
        const lv = Levels.LEVELS[i];
        const best = bestMap[lv.id];
        if (best == null) continue;
        const stars = starMap[lv.id] || 0;
        lines.push(
            "L" + (i + 1).toString().padStart(2, " ") + "  " +
            lv.name.padEnd(16, " ") + "  " +
            String(best).padStart(7, " ") + "   " +
            ["★", "★", "★"].slice(0, stars).join("") +
            ["☆", "☆", "☆"].slice(0, 3 - stars).join("")
        );
    }
    listEl.textContent = lines.join("\n");
}

function renderSettings(api) {
    const traj = document.getElementById("opt-trajectory");
    const shake = document.getElementById("opt-screenshake");
    if (traj) traj.textContent = api.save.get("trajectory") !== false ? "ON" : "OFF";
    if (shake) shake.textContent = api.save.get("screenshake") !== false ? "ON" : "OFF";
}

function toast(text) {
    const el = document.getElementById("pb-toast");
    if (!el) return;
    el.textContent = text;
    el.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.display = "none"; }, 1000);
}

function showFever(text) {
    const el = document.getElementById("fever-text");
    if (!el) return;
    el.textContent = text;
    el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 1800);
}

function hexToRgb(h) {
    if (h[0] === "#") h = h.slice(1);
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
    const t = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0");
    return "#" + t(r) + t(g) + t(b);
}
function lighten(h, f) {
    const c = hexToRgb(h);
    return rgbToHex(c.r + (255 - c.r) * f, c.g + (255 - c.g) * f, c.b + (255 - c.b) * f);
}
function darken(h, f) {
    const c = hexToRgb(h);
    return rgbToHex(c.r * (1 - f), c.g * (1 - f), c.b * (1 - f));
}

// ── Test hooks ────────────────────────────────────────────────────────────

/** Pure headless shot against a seeded level build (does not touch live run). */
function simulateShot(angle, seed) {
    const idx = activeRun ? activeRun.levelIdx : session.levelIdx;
    const w = Levels.buildLevel(idx, seed | 0);
    Physics.launchBall(w, angle, 820, FIELD_W / 2, 64);
    const dt = 1 / 180;
    let elapsed = 0;
    let shotScore = 0;
    let comboMultSeen = 1;
    let shotOrangeCount = 0;
    let shotComboCount = 0;
    const startOrange = Physics.countRemainingOrange(w);
    while (Physics.hasActiveBall(w) && elapsed < 12) {
        Physics.step(w, dt);
        const ev = w.scoreEvents;
        Physics.markLitFromEvents(w, ev);
        for (const e of ev) {
            if (e.kind !== "peg-hit") continue;
            const peg = e.peg;
            if (peg._testScored) continue;
            peg._testScored = true;
            shotComboCount++;
            let pts = 10;
            if (peg.type === Physics.PEG.ORANGE) {
                pts = 100;
                shotOrangeCount++;
            } else if (peg.type === Physics.PEG.PURPLE) {
                pts = 500;
            }
            const m = comboMult(shotOrangeCount, shotComboCount);
            comboMultSeen = Math.max(comboMultSeen, m);
            shotScore += pts * m;
        }
        ev.length = 0;
        elapsed += dt;
    }
    Physics.sweepLit(w);
    const orangeCleared = startOrange - Physics.countRemainingOrange(w);
    Physics.destroyWorld(w);
    return { orangeCleared, shotScore, comboMult: comboMultSeen, elapsed, startOrange };
}

export function installTestHooks(shell) {
    shellRef = shell;

    const screens = {
        switchTo: function (name) {
            if (name === "playing" || name === "play") {
                if (!shell.getRun()) shell.startRun();
                else shell.switchTo("playing");
            } else if (name === "clear") {
                shell.switchTo("clear");
            } else if (name === "title") {
                shell.switchTo("title");
            } else {
                shell.switchTo(name);
            }
        },
        name: function () { return shell.getScreen(); },
    };

    // Save facade used by tests as PB.store (shell.api.save is the real store).
    const saveApi = shell.api && shell.api.save;
    const store = {
        get: function (k) { return saveApi ? saveApi.get(k) : undefined; },
        set: function (k, v) { if (saveApi) saveApi.set(k, v); },
        save: function () { if (saveApi) saveApi.save(); },
    };

    // Live state surface — prefer active run fields, fall back to session.
    const S = {
        get guideId() { return activeRun ? activeRun.guideId : session.guideId; },
        set guideId(v) {
            session.guideId = v;
            if (activeRun) activeRun.guideId = v;
        },
        get levelIdx() { return activeRun ? activeRun.levelIdx : session.levelIdx; },
        get world() { return activeRun ? activeRun.world : null; },
        get score() { return activeRun ? activeRun.score : 0; },
        get shotScore() { return activeRun ? activeRun.shotScore : 0; },
    };

    window.__pegbounce = {
        S,
        store,
        Physics,
        Levels,
        Guides,
        Particles,
        screens,
        shell,
        loadLevel: function (idx) {
            session.levelIdx = idx;
            if (activeRun) loadLevel(activeRun, idx);
            else if (shell.getRun()) loadLevel(shell.getRun(), idx);
        },
        simulateShot,
        findPegs: function () {
            return activeRun && activeRun.world ? activeRun.world.pegs : [];
        },
        remainingOrange: function () {
            return activeRun && activeRun.world
                ? Physics.countRemainingOrange(activeRun.world)
                : 0;
        },
        setGuide: function (id) {
            session.guideId = id;
            if (activeRun) activeRun.guideId = id;
            if (saveApi) {
                saveApi.set("selectedGuide", id);
                saveApi.save();
            }
        },
        forceClear: function () {
            if (activeRun) {
                activeRun.levelClearTriggered = true;
                persistClear(activeRun);
            }
            shell.switchTo("clear");
        },
    };
}
