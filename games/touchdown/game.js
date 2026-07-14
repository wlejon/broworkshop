// Touchdown — arcade foundation plugin.
// Gravity lander rules, draw, and cues. Screens / loop / input shell are /lib/arcade.

const GRAVITY = 0.06;
const THRUST = 0.14;
const ROT_SPEED = 0.065;
const FUEL_BURN = 0.65;
const MAX_SAFE_VY = 2.4;
const MAX_SAFE_VX = 1.8;
const MAX_SAFE_TILT = 0.22;
const LANDER_W = 14;
const LANDER_H = 16;

// Persistent thrust voice (one-shot tones don't sustain).
let thrustVoice = -1;
let thrustOn = false;

function rand(a, b) {
    return a + Math.random() * (b - a);
}

// ── Terrain ──────────────────────────────────────────────────────────────

function buildTerrain(W, H, level) {
    const points = [];
    const pads = [];
    const segWidth = 18;
    const ground = H * 0.78;
    let amp = 50 + level * 14;
    if (amp > 180) amp = 180;
    const jag = 0.35 + Math.min(0.45, level * 0.06);

    const numPads = Math.max(2, 5 - Math.floor(level / 2));
    const padRanges = [];
    for (let p = 0; p < numPads; p++) {
        let padWidth = Math.max(40, 120 - level * 10);
        padWidth = Math.floor(padWidth + rand(-10, 10));
        if (padWidth < 36) padWidth = 36;
        const margin = 60;
        const px = Math.floor(rand(margin, W - margin - padWidth));
        padRanges.push({ x1: px, x2: px + padWidth });
    }

    let x = 0;
    let y = ground + rand(-20, 20);
    while (x <= W + segWidth) {
        let inPad = -1;
        for (let i = 0; i < padRanges.length; i++) {
            if (x >= padRanges[i].x1 && x <= padRanges[i].x2) {
                inPad = i;
                break;
            }
        }
        if (inPad !== -1) {
            const pr = padRanges[inPad];
            const padY = y;
            if (points.length === 0 || points[points.length - 1].x < pr.x1) {
                points.push({ x: pr.x1, y: padY });
            }
            points.push({ x: pr.x2, y: padY });
            pads.push({
                x1: pr.x1,
                x2: pr.x2,
                y: padY,
                width: pr.x2 - pr.x1,
                bonus: Math.floor(50 + (140 - Math.min(140, pr.x2 - pr.x1)) * 2.8),
            });
            x = pr.x2 + segWidth;
            y = padY + rand(-amp * jag, amp * jag);
            continue;
        }
        points.push({ x: x, y: y });
        x += segWidth + rand(-5, 5);
        y += rand(-amp * jag, amp * jag);
        if (y < H * 0.40) y = H * 0.40 + rand(0, 10);
        if (y > H - 30) y = H - 30 - rand(0, 10);
    }
    if (points.length && points[0].x > 0) points.unshift({ x: 0, y: points[0].y });
    if (points[points.length - 1].x < W) points.push({ x: W, y: points[points.length - 1].y });

    return { points: points, pads: pads };
}

function terrainY(terrain, x) {
    const pts = terrain.points;
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].x >= x) {
            const a = pts[i - 1];
            const b = pts[i];
            const t = (x - a.x) / (b.x - a.x || 1);
            return a.y + (b.y - a.y) * t;
        }
    }
    return pts[pts.length - 1].y;
}

function onFlatPad(terrain, x) {
    for (let i = 0; i < terrain.pads.length; i++) {
        const p = terrain.pads[i];
        if (x >= p.x1 && x <= p.x2) return p;
    }
    return null;
}

function makeStars(W, H) {
    const s = [];
    for (let i = 0; i < 60; i++) {
        s.push({
            x: Math.random() * W,
            y: Math.random() * H * 0.75,
            b: 0.2 + Math.random() * 0.6,
        });
    }
    return s;
}

function newLander(W, H, level) {
    const fuel = Math.max(350, 1000 - (level - 1) * 110);
    return {
        x: W * 0.5 + rand(-W * 0.25, W * 0.25),
        y: 70,
        vx: rand(-0.9, 0.9) + (level - 1) * 0.1,
        vy: 0,
        angle: 0,
        thrusting: false,
        fuel: fuel,
        fuelMax: fuel,
        alive: true,
        landed: false,
        landingResult: null,
    };
}

// ── Particles ────────────────────────────────────────────────────────────

function spawnThrust(run, lander) {
    const ang = lander.angle;
    const ex = lander.x + Math.sin(ang) * 10;
    const ey = lander.y + Math.cos(ang) * 10;
    const spread = (Math.random() - 0.5) * 0.6;
    const speed = 2.5 + Math.random() * 1.5;
    const dx = Math.sin(ang + spread) * speed + lander.vx * 0.3;
    const dy = Math.cos(ang + spread) * speed + lander.vy * 0.3;
    run.particles.push({
        x: ex, y: ey, vx: dx, vy: dy,
        life: 280 + Math.random() * 120,
        age: 0,
        color: "#ff9955",
        size: 1 + Math.random() * 1.5,
    });
}

function spawnCrash(run, lander) {
    for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 0.8 + Math.random() * 4.5;
        run.particles.push({
            x: lander.x,
            y: lander.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 0.5,
            life: 600 + Math.random() * 400,
            age: 0,
            color: i % 3 === 0 ? "#ffbb55" : "#ffffff",
            size: 1 + Math.random() * 2,
        });
    }
}

function updateParticles(run, dt) {
    const kept = [];
    for (let i = 0; i < run.particles.length; i++) {
        const p = run.particles[i];
        p.age += dt;
        if (p.age >= p.life) continue;
        const f = dt / 16.67;
        p.x += p.vx * f;
        p.y += p.vy * f;
        p.vy += 0.02 * f;
        kept.push(p);
    }
    run.particles = kept;
}

function drawParticles(run, ctx) {
    for (let i = 0; i < run.particles.length; i++) {
        const p = run.particles[i];
        let a = 1 - (p.age / p.life);
        if (a < 0) a = 0;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

// ── Thrust SFX ───────────────────────────────────────────────────────────

function startThrust(audio) {
    if (!audio || thrustOn) return;
    const ctx = audio.ctx();
    if (!ctx) return;
    try {
        const id = ctx.createVoice();
        ctx.setVoiceWaveform(id, "whitenoise");
        ctx.setVoiceFrequency(id, 300);
        ctx.setVoiceGain(id, 4.0);
        ctx.setVoiceAttack(id, 0.02);
        ctx.setVoiceDecay(id, 0.1);
        ctx.setVoiceSustain(id, 1.0);
        ctx.setVoiceRelease(id, 0.08);
        ctx.startVoice(id, ctx.currentTime);
        thrustVoice = id;
        thrustOn = true;
    } catch (e) { /* ignore */ }
}

function stopThrust(audio) {
    if (!thrustOn) return;
    const ctx = audio ? audio.ctx() : null;
    if (ctx) {
        try {
            if (thrustVoice !== -1) ctx.stopVoice(thrustVoice, ctx.currentTime);
        } catch (e) { /* ignore */ }
    }
    thrustVoice = -1;
    thrustOn = false;
}

// ── Plugin ───────────────────────────────────────────────────────────────

export const game = {
    id: "touchdown",
    clearColor: "#000000",

    actions: [
        { name: "left", label: "Rotate Left", defaults: ["a", "ArrowLeft"] },
        { name: "right", label: "Rotate Right", defaults: ["d", "ArrowRight"] },
        // W/Up for flight thrust; Space stays on primary so menus use Enter/Space to confirm.
        { name: "up", label: "Thrust", defaults: ["w", "ArrowUp"] },
        { name: "primary", label: "Thrust (Space)", defaults: [" "] },
        { name: "secondary", label: "Mouse Thrust", defaults: ["Mouse2"] },
    ],

    create(ctx) {
        const { w, h } = ctx.view.size();
        stopThrust(ctx.audio);

        const level = 1;
        const run = {
            W: w,
            H: h,
            level: level,
            score: 0,
            landings: 0,
            totalFuelUsed: 0,
            terrain: buildTerrain(w, h, level),
            lander: newLander(w, h, level),
            mouse: { x: w / 2, y: h / 2, held: false },
            status: "flying",
            statusMsg: "",
            lastLandingBonus: 0,
            lastLandingPadWidth: 0,
            stars: makeStars(w, h),
            shake: 0,
            particles: [],
            gameOver: false,
            play: ctx.play,
            highScore: ctx.highScore,
            audio: ctx.audio,
            view: ctx.view,
        };

        attachPointer(run);
        return run;
    },

    update(run, dt, input) {
        if (run.gameOver) {
            stopThrust(run.audio);
            return { status: "gameover", score: run.score };
        }
        if (run.status === "landed") {
            stopThrust(run.audio);
            return { status: "screen", name: "landed" };
        }

        const size = run.view ? run.view.size() : { w: run.W, h: run.H };
        run.W = size.w;
        run.H = size.h;

        run.mouse.held = input.down("secondary");

        stepSim(run, dt, input);

        if (run.status === "landed") {
            stopThrust(run.audio);
            return { status: "screen", name: "landed" };
        }
        if (run.gameOver || run.status === "crashed") {
            stopThrust(run.audio);
            return { status: "gameover", score: run.score };
        }
    },

    draw(run, ctx, view) {
        const W = view.width();
        const H = view.height();
        drawScene(run, ctx, W, H);
    },

    drawTitle(ctx, view) {
        const W = view.width();
        const H = view.height();
        drawTitleBg(ctx, W, H);
    },

    hud(run) {
        syncTelemetry(run);
        if (!run) {
            return { score: 0, hi: 0, level: 1, landed: 0, fuel: 1000 };
        }
        return {
            score: run.score,
            hi: run.highScore(),
            level: run.level,
            landed: run.landings,
            fuel: Math.max(0, Math.round(run.lander.fuel)),
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const level = run ? run.level : 1;
        const landed = run ? run.landings : 0;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score     " + score + tag + "\n" +
            "Level     " + level + "\n" +
            "Landed    " + landed + "\n" +
            "Best      " + best
        );
    },

    onEnterScreen(name, run) {
        if (name !== "playing") stopThrust(run && run.audio);
        if (name === "landed" && run) {
            const el = document.getElementById("landed-stats");
            if (el) {
                el.textContent = [
                    "LEVEL        " + run.level,
                    "PAD WIDTH    " + run.lastLandingPadWidth,
                    "BONUS        +" + run.lastLandingBonus,
                    "SCORE        " + run.score,
                    "FUEL LEFT    " + Math.round(run.lander.fuel),
                ].join("\n");
            }
        }
        // Telemetry only while a run is on mid-game screens.
        const tel = document.getElementById("telemetry");
        if (tel) {
            const show = !!run && (name === "playing" || name === "pause" || name === "landed");
            tel.hidden = !show;
            tel.style.display = show ? "flex" : "none";
        }
    },

    onMenuAction(action, run) {
        if (action === "next" && run) {
            advanceLevel(run);
            return "playing";
        }
    },

    // Game SFX only — menu move/select are shell-owned.
    cue(name, audio) {
        if (name === "landed") {
            audio.sequence([
                [523, 0.09, "square", 0.6],
                [659, 0.09, "square", 0.6],
                [784, 0.14, "square", 0.7],
            ]);
        } else if (name === "crash") {
            audio.sequence([
                [90, 0.22, "sawtooth", 0.8],
                [55, 0.28, "sawtooth", 0.6],
                [40, 0.35, "sawtooth", 0.45],
            ]);
        }
    },
};

// ── Pointer ──────────────────────────────────────────────────────────────

/** One listener set per canvas; always targets the latest run on that canvas. */
function attachPointer(run) {
    const canvas = run.view && run.view.canvas;
    if (!canvas) return;
    canvas._touchdownRun = run;
    if (canvas._touchdownPointer) return;
    canvas._touchdownPointer = true;

    canvas.addEventListener("mousemove", (ev) => {
        const r = canvas._touchdownRun;
        if (!r || !r.view) return;
        const rect = canvas.getBoundingClientRect
            ? canvas.getBoundingClientRect()
            : null;
        if (!rect || !rect.width || !rect.height) return;
        const W = r.view.width();
        const H = r.view.height();
        r.mouse.x = (ev.clientX - rect.left) * (W / rect.width);
        r.mouse.y = (ev.clientY - rect.top) * (H / rect.height);
    });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
}

// ── Simulation ───────────────────────────────────────────────────────────

function advanceLevel(run) {
    run.level += 1;
    run.terrain = buildTerrain(run.W, run.H, run.level);
    run.lander = newLander(run.W, run.H, run.level);
    run.status = "flying";
    run.statusMsg = "";
    run.shake = 0;
    run.gameOver = false;
    run.particles = [];
    stopThrust(run.audio);
}

function stepSim(run, dt, input) {
    let f = dt / 16.67;
    if (f > 3) f = 3;

    const L = run.lander;

    if (run.status === "flying") {
        const mouseSteer = run.mouse && run.mouse.held;
        if (mouseSteer) {
            const dx = run.mouse.x - L.x;
            const dy = run.mouse.y - L.y;
            if (dx * dx + dy * dy > 16) {
                const target = Math.atan2(dx, -dy);
                let diff = target - L.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const step = ROT_SPEED * f;
                if (diff > step) L.angle += step;
                else if (diff < -step) L.angle -= step;
                else L.angle = target;
            }
        } else {
            if (input.down("left")) L.angle -= ROT_SPEED * f;
            if (input.down("right")) L.angle += ROT_SPEED * f;
        }

        const wantThrust = (input.down("up") || input.down("primary") || mouseSteer) && L.fuel > 0;
        L.thrusting = wantThrust;

        if (wantThrust) {
            const fx = Math.sin(L.angle);
            const fy = -Math.cos(L.angle);
            L.vx += fx * THRUST * f;
            L.vy += fy * THRUST * f;
            L.fuel -= FUEL_BURN * f;
            if (L.fuel < 0) L.fuel = 0;
            run.totalFuelUsed += FUEL_BURN * f;
            if (Math.random() < 0.8) spawnThrust(run, L);
            startThrust(run.audio);
        } else {
            stopThrust(run.audio);
        }

        L.vy += GRAVITY * f;
        L.x += L.vx * f;
        L.y += L.vy * f;

        if (L.x < 0) L.x += run.W;
        else if (L.x > run.W) L.x -= run.W;

        if (run.shake > 0) run.shake -= 0.2 * f;
        if (run.shake < 0) run.shake = 0;

        const groundY = terrainY(run.terrain, L.x);
        const bottomY = L.y + Math.abs(Math.cos(L.angle)) * LANDER_H * 0.55;

        if (bottomY >= groundY) {
            L.y = groundY - Math.abs(Math.cos(L.angle)) * LANDER_H * 0.55;
            const pad = onFlatPad(run.terrain, L.x);
            const vxAbs = Math.abs(L.vx);
            const vyAbs = Math.abs(L.vy);
            let norm = L.angle;
            while (norm > Math.PI) norm -= Math.PI * 2;
            while (norm < -Math.PI) norm += Math.PI * 2;
            const tilt = Math.abs(norm);

            const safe = pad && vxAbs <= MAX_SAFE_VX && vyAbs <= MAX_SAFE_VY && tilt <= MAX_SAFE_TILT;
            if (safe) {
                const bonus = pad.bonus;
                const fuelBonus = Math.floor(L.fuel * 0.2);
                const softLand = Math.max(0, Math.round((MAX_SAFE_VY - vyAbs) * 50));
                const gained = bonus + fuelBonus + softLand;
                run.score += gained;
                run.landings += 1;
                run.lastLandingBonus = gained;
                run.lastLandingPadWidth = pad.width;
                run.status = "landed";
                L.landed = true;
                L.vx = 0;
                L.vy = 0;
                stopThrust(run.audio);
                run.play("landed");
            } else {
                L.alive = false;
                run.status = "crashed";
                const reasons = [];
                if (!pad) reasons.push("NOT ON A FLAT PAD");
                if (vyAbs > MAX_SAFE_VY) reasons.push("DESCENT TOO FAST");
                if (vxAbs > MAX_SAFE_VX) reasons.push("LATERAL DRIFT TOO HIGH");
                if (tilt > MAX_SAFE_TILT) reasons.push("NOT UPRIGHT");
                run.statusMsg = reasons.join(" · ");
                spawnCrash(run, L);
                run.shake = 16;
                stopThrust(run.audio);
                run.play("crash");
                run.gameOver = true;
            }
        }
    }

    updateParticles(run, dt);
}

// ── Draw ─────────────────────────────────────────────────────────────────

function drawStars(run, ctx) {
    for (let i = 0; i < run.stars.length; i++) {
        const s = run.stars[i];
        ctx.globalAlpha = s.b;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(s.x, s.y, 1, 1);
    }
    ctx.globalAlpha = 1;
}

function drawTerrain(run, ctx) {
    const pts = run.terrain.points;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    ctx.lineWidth = 3;
    for (let j = 0; j < run.terrain.pads.length; j++) {
        const p = run.terrain.pads[j];
        ctx.strokeStyle = "#66ff99";
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y);
        ctx.lineTo(p.x2, p.y);
        ctx.stroke();

        ctx.globalAlpha = 0.8;
        ctx.fillStyle = "#66ff99";
        ctx.font = "11px Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText("+" + p.bonus, (p.x1 + p.x2) * 0.5, p.y - 6);
        ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1;
}

function drawLander(ctx, L) {
    ctx.save();
    ctx.translate(L.x, L.y);
    ctx.rotate(L.angle);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(0, -LANDER_H * 0.6);
    ctx.lineTo(-LANDER_W * 0.5, -LANDER_H * 0.1);
    ctx.lineTo(-LANDER_W * 0.5, LANDER_H * 0.35);
    ctx.lineTo(LANDER_W * 0.5, LANDER_H * 0.35);
    ctx.lineTo(LANDER_W * 0.5, -LANDER_H * 0.1);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-LANDER_W * 0.5, LANDER_H * 0.35);
    ctx.lineTo(-LANDER_W * 0.85, LANDER_H * 0.6);
    ctx.moveTo(LANDER_W * 0.5, LANDER_H * 0.35);
    ctx.lineTo(LANDER_W * 0.85, LANDER_H * 0.6);
    ctx.moveTo(-LANDER_W * 1.0, LANDER_H * 0.6);
    ctx.lineTo(-LANDER_W * 0.7, LANDER_H * 0.6);
    ctx.moveTo(LANDER_W * 0.7, LANDER_H * 0.6);
    ctx.lineTo(LANDER_W * 1.0, LANDER_H * 0.6);
    ctx.stroke();

    if (L.thrusting && L.alive) {
        const flicker = 0.6 + Math.random() * 0.8;
        ctx.strokeStyle = "#ffaa44";
        ctx.beginPath();
        ctx.moveTo(-LANDER_W * 0.25, LANDER_H * 0.35);
        ctx.lineTo(0, LANDER_H * 0.35 + 10 * flicker);
        ctx.lineTo(LANDER_W * 0.25, LANDER_H * 0.35);
        ctx.stroke();
    }

    ctx.restore();
}

function drawScene(run, ctx, W, H) {
    ctx.save();
    if (run.shake > 0) {
        ctx.translate((Math.random() - 0.5) * run.shake, (Math.random() - 0.5) * run.shake);
    }

    drawStars(run, ctx);
    drawTerrain(run, ctx);
    drawParticles(run, ctx);

    if (run.lander.alive || run.status === "landed") {
        drawLander(ctx, run.lander);
    }

    ctx.restore();

    if (run.status === "landed") {
        ctx.fillStyle = "#66ff99";
        ctx.font = "bold 22px Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText("TOUCHDOWN  +" + run.lastLandingBonus, W * 0.5, H * 0.28);
    } else if (run.status === "crashed") {
        ctx.fillStyle = "#ff5555";
        ctx.font = "bold 22px Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText("CRASHED", W * 0.5, H * 0.28);
        if (run.statusMsg) {
            ctx.font = "12px Consolas, monospace";
            ctx.fillStyle = "#aa8888";
            ctx.fillText(run.statusMsg, W * 0.5, H * 0.28 + 20);
        }
    }
}

// ── Title backdrop ───────────────────────────────────────────────────────

const titleBg = { stars: [], landers: [], lastT: 0, w: 0, h: 0 };

function ensureTitleBg(W, H) {
    if (titleBg.stars.length && titleBg.w === W && titleBg.h === H) return;
    titleBg.w = W;
    titleBg.h = H;
    titleBg.stars = [];
    for (let i = 0; i < 120; i++) {
        titleBg.stars.push({
            x: Math.random() * W,
            y: Math.random() * H,
            b: 0.15 + Math.random() * 0.7,
            drift: 0.005 + Math.random() * 0.02,
        });
    }
    titleBg.landers = [];
    for (let j = 0; j < 3; j++) {
        titleBg.landers.push({
            x: Math.random() * W,
            y: 80 + Math.random() * (H * 0.5),
            vx: (Math.random() - 0.5) * 0.05,
            vy: 0.02 + Math.random() * 0.03,
            ang: (Math.random() - 0.5) * 0.4,
            alpha: 0.12 + Math.random() * 0.15,
        });
    }
}

function drawTitleBg(ctx, W, H) {
    ensureTitleBg(W, H);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    let dt = titleBg.lastT ? now - titleBg.lastT : 16;
    if (dt > 50) dt = 50;
    titleBg.lastT = now;

    for (let i = 0; i < titleBg.stars.length; i++) {
        const s = titleBg.stars[i];
        s.y += s.drift * dt;
        if (s.y > H) {
            s.y = 0;
            s.x = Math.random() * W;
        }
    }
    for (let j = 0; j < titleBg.landers.length; j++) {
        const L = titleBg.landers[j];
        L.x += L.vx * dt;
        L.y += L.vy * dt;
        if (L.y > H + 20) {
            L.y = -20;
            L.x = Math.random() * W;
        }
        if (L.x < -20) L.x = W + 20;
        if (L.x > W + 20) L.x = -20;
    }

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < titleBg.stars.length; i++) {
        const s = titleBg.stars[i];
        ctx.globalAlpha = s.b;
        ctx.fillRect(s.x, s.y, 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    for (let j = 0; j < titleBg.landers.length; j++) {
        const L = titleBg.landers[j];
        ctx.globalAlpha = L.alpha;
        ctx.save();
        ctx.translate(L.x, L.y);
        ctx.rotate(L.ang);
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(-7, -2);
        ctx.lineTo(-7, 5);
        ctx.lineTo(7, 5);
        ctx.lineTo(7, -2);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }
    ctx.globalAlpha = 1;
}

function syncTelemetry(run) {
    if (!run) return;
    const L = run.lander;
    let groundY = run.H * 0.78;
    const terrain = run.terrain;
    let tx = L.x;
    if (tx < terrain.points[0].x) tx = terrain.points[0].x;
    if (tx > terrain.points[terrain.points.length - 1].x) {
        tx = terrain.points[terrain.points.length - 1].x;
    }
    for (let i = 1; i < terrain.points.length; i++) {
        if (terrain.points[i].x >= tx) {
            const a = terrain.points[i - 1];
            const b = terrain.points[i];
            const tt = (tx - a.x) / (b.x - a.x || 1);
            groundY = a.y + (b.y - a.y) * tt;
            break;
        }
    }
    const alt = Math.max(0, Math.round(groundY - L.y));
    const aEl = document.getElementById("tel-alt");
    const hEl = document.getElementById("tel-hvel");
    const vEl = document.getElementById("tel-vvel");
    if (aEl) aEl.textContent = String(alt);
    if (hEl) hEl.textContent = L.vx.toFixed(2);
    if (vEl) vEl.textContent = L.vy.toFixed(2);
}
