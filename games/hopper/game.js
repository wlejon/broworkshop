// Hopper — Frogger-style lane-crosser (arcade plugin).
// Rules, drawing, and cues only. Screens / loop / input shell: /lib/arcade.

const COLS = 13;
const ROWS = 14;
const TILE = 56;
const GRID_W = COLS * TILE;
const GRID_H = ROWS * TILE;

// Row layout (top → bottom):
// 0 goals · 1–5 river · 6 median · 7–11 road · 12 safe · 13 start
const ROW_GOAL = 0;
const ROW_RIVER_START = 1;
const ROW_RIVER_END = 5;
const ROW_MEDIAN = 6;
const ROW_ROAD_START = 7;
const ROW_ROAD_END = 11;
const ROW_START = 13;

const GOAL_COLS = [1, 4, 6, 8, 11];
const ROUND_TIME_MS = 60 * 1000;

const ROAD_LANES = [
    { dir: -1, speed: 2.5, gap: 4, width: 1 },
    { dir: 1,  speed: 3.5, gap: 3, width: 2 },
    { dir: -1, speed: 4.5, gap: 5, width: 1 },
    { dir: 1,  speed: 2.0, gap: 3, width: 1 },
    { dir: -1, speed: 5.5, gap: 6, width: 1 },
];
const RIVER_LANES = [
    { dir: 1,  speed: 1.8, gap: 3, width: 3 },
    { dir: -1, speed: 2.5, gap: 2, width: 2 },
    { dir: 1,  speed: 1.5, gap: 4, width: 4 },
    { dir: -1, speed: 3.0, gap: 3, width: 2 },
    { dir: 1,  speed: 2.2, gap: 3, width: 3 },
];

export const game = {
    id: "hopper",
    clearColor: "#06060a",

    create(ctx) {
        if (ctx.input) ctx.input.clear();
        const run = {
            score: 0,
            lives: 3,
            level: 1,
            padsFilled: 0,
            pads: [],
            lanes: [],
            timeLeft: ROUND_TIME_MS,
            maxRowReached: ROW_START,
            player: { col: 6, row: ROW_START, onLog: null },
            deathTimer: 0,
            respawnLock: 0,
            pendingRound: false,
            banner: { text: "", timer: 0 },
            ox: 0,
            oy: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
        };
        resetRun(run);
        return run;
    },

    update(run, dt, input) {
        if (run.banner.timer > 0) {
            run.banner.timer = Math.max(0, run.banner.timer - dt);
            if (run.banner.timer <= 0) run.banner.text = "";
        }

        if (run.respawnLock > 0) {
            run.respawnLock -= dt;
            if (run.respawnLock <= 0 && run.pendingRound) {
                run.pendingRound = false;
                newRound(run);
            }
        }

        if (run.deathTimer > 0) {
            run.deathTimer -= dt;
            updateLanes(run, dt);
            if (run.deathTimer <= 0) {
                if (run.lives <= 0) return { status: "gameover" };
                respawnPlayer(run, false);
            }
            return;
        }

        if (run.respawnLock <= 0) {
            if (input.pressed("up")) hop(run, 0, -1);
            else if (input.pressed("down")) hop(run, 0, 1);
            else if (input.pressed("left")) hop(run, -1, 0);
            else if (input.pressed("right")) hop(run, 1, 0);
        }

        run.timeLeft -= dt;
        if (run.timeLeft <= 0) {
            run.timeLeft = 0;
            onDeath(run, "timeout");
            return;
        }

        updateLanes(run, dt);
        applyLogDrift(run, dt);

        const row = run.player.row;
        if (row >= ROW_ROAD_START && row <= ROW_ROAD_END) {
            if (hitByCar(run, row)) {
                onDeath(run, "squish");
                return;
            }
        } else if (row >= ROW_RIVER_START && row <= ROW_RIVER_END) {
            if (!resolveRiver(run, row)) {
                onDeath(run, "drown");
                return;
            }
        } else {
            run.player.onLog = null;
        }

        if (row === ROW_GOAL) handleGoalReached(run);
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        const ox = Math.floor((w - GRID_W) / 2);
        let oy = Math.floor((h - GRID_H) / 2);
        if (oy < 60) oy = 60;
        run.ox = ox;
        run.oy = oy;

        drawTerrain(ctx, ox, oy);
        drawPads(ctx, run, ox, oy);
        drawEntities(ctx, run, ox, oy);
        drawPlayer(ctx, run, ox, oy);

        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeRect(ox - 1, oy - 1, GRID_W + 2, GRID_H + 2);

        if (run.banner.text && run.banner.timer > 0) {
            drawBanner(ctx, run.banner.text, w, h);
        }
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            best: run ? Math.max(run.highScore(), run.score) : 0,
            lives: run ? run.lives : 3,
            time: run ? Math.ceil(run.timeLeft / 1000) : 60,
            pads: run ? (run.padsFilled + "/" + run.pads.length) : "0/5",
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const level = run ? run.level : 1;
        const pads = run ? (run.padsFilled + "/" + run.pads.length) : "0/5";
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score    " + score + tag + "\n" +
            "Level    " + level + "\n" +
            "Pads     " + pads + "\n" +
            "Best     " + best
        );
    },

    cue(name, audio) {
        if (name === "hop") audio.tone(520, 0.06, "square", 0.5);
        else if (name === "squish") {
            audio.sequence([
                [180, 0.2, "sawtooth", 0.7],
                [100, 0.3, "sawtooth", 0.7],
            ]);
        } else if (name === "drown") {
            audio.sequence([
                [300, 0.15, "triangle", 0.6],
                [150, 0.3, "triangle", 0.6],
            ]);
        } else if (name === "pad") {
            audio.sequence([
                [660, 0.1, "square", 0.7],
                [880, 0.15, "square", 0.8],
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

// ── Rules ────────────────────────────────────────────────────────────────

function resetRun(run) {
    run.lives = 3;
    run.score = 0;
    run.level = 1;
    run.padsFilled = 0;
    run.pendingRound = false;
    run.banner = { text: "", timer: 0 };
    initPads(run);
    buildLanes(run);
    respawnPlayer(run, true);
}

function newRound(run) {
    run.level++;
    run.padsFilled = 0;
    initPads(run);
    buildLanes(run);
    respawnPlayer(run, true);
}

function initPads(run) {
    run.pads = [];
    for (let i = 0; i < GOAL_COLS.length; i++) {
        run.pads.push({ col: GOAL_COLS[i], filled: false });
    }
}

function respawnPlayer(run, fullReset) {
    run.player.col = 6;
    run.player.row = ROW_START;
    run.player.onLog = null;
    run.maxRowReached = ROW_START;
    if (fullReset) run.timeLeft = ROUND_TIME_MS;
    run.deathTimer = 0;
    run.respawnLock = 200;
}

function buildLanes(run) {
    run.lanes = new Array(ROWS);
    const lvlMult = 1 + (run.level - 1) * 0.15;

    for (let r = ROW_ROAD_START; r <= ROW_ROAD_END; r++) {
        const cfg = ROAD_LANES[r - ROW_ROAD_START];
        run.lanes[r] = makeLane("car", cfg.dir, cfg.speed * lvlMult, cfg.gap, cfg.width);
    }
    for (let r = ROW_RIVER_START; r <= ROW_RIVER_END; r++) {
        const cfg = RIVER_LANES[r - ROW_RIVER_START];
        run.lanes[r] = makeLane("log", cfg.dir, cfg.speed * lvlMult, cfg.gap, cfg.width);
    }
}

function makeLane(type, dir, speed, gap, width) {
    const entities = [];
    const total = width + gap;
    const startOffset = Math.random() * total;
    for (let x = -width - 2; x < COLS + width + 2; x += total) {
        entities.push({ x: x + startOffset, width: width, type: type });
    }
    return { dir, speed, entities, type, spacing: total, width };
}

function updateLanes(run, dt) {
    for (let r = 0; r < ROWS; r++) {
        const lane = run.lanes[r];
        if (!lane) continue;
        const dx = lane.dir * lane.speed * dt / 1000;
        for (let i = 0; i < lane.entities.length; i++) {
            lane.entities[i].x += dx;
        }
        const spacing = lane.spacing;
        for (let j = 0; j < lane.entities.length; j++) {
            const e = lane.entities[j];
            if (lane.dir > 0 && e.x > COLS + 2) {
                let minX = Infinity;
                for (let k = 0; k < lane.entities.length; k++) {
                    if (lane.entities[k].x < minX) minX = lane.entities[k].x;
                }
                e.x = minX - spacing;
            } else if (lane.dir < 0 && e.x + e.width < -2) {
                let maxX = -Infinity;
                for (let k = 0; k < lane.entities.length; k++) {
                    if (lane.entities[k].x > maxX) maxX = lane.entities[k].x;
                }
                e.x = maxX + spacing;
            }
        }
    }
}

function applyLogDrift(run, dt) {
    if (!run.player.onLog) return;
    const lane = run.lanes[run.player.row];
    if (!lane) return;
    run.player.col += lane.dir * lane.speed * dt / 1000;
}

function hitByCar(run, row) {
    const lane = run.lanes[row];
    for (let i = 0; i < lane.entities.length; i++) {
        const e = lane.entities[i];
        if (run.player.col + 0.5 > e.x + 0.05 &&
            run.player.col + 0.5 < e.x + e.width - 0.05) {
            return true;
        }
    }
    return false;
}

/** Returns false if frog is drowning. */
function resolveRiver(run, row) {
    const lane = run.lanes[row];
    let onSomething = null;
    for (let j = 0; j < lane.entities.length; j++) {
        const e = lane.entities[j];
        if (run.player.col + 0.5 >= e.x &&
            run.player.col + 0.5 <= e.x + e.width) {
            onSomething = e;
            break;
        }
    }
    run.player.onLog = onSomething;
    if (!onSomething) return false;
    if (run.player.col < -0.5 || run.player.col > COLS - 0.5) return false;
    return true;
}

function hop(run, dx, dy) {
    if (run.deathTimer > 0 || run.respawnLock > 0) return;
    let nc = Math.round(run.player.col) + dx;
    const nr = run.player.row + dy;
    if (nr < 0 || nr > ROW_START) return;
    if (nc < 0) nc = 0;
    if (nc > COLS - 1) nc = COLS - 1;

    run.player.col = nc;
    run.player.row = nr;
    run.player.onLog = null;
    run.play("hop");

    if (dy < 0 && nr < run.maxRowReached) {
        run.maxRowReached = nr;
        run.score += 10;
        bumpHigh(run);
    }
}

function handleGoalReached(run) {
    const c = run.player.col + 0.5;
    let bestIdx = -1;
    let bestDist = 999;
    for (let i = 0; i < run.pads.length; i++) {
        const d = Math.abs((run.pads[i].col + 0.5) - c);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    if (bestIdx >= 0 && bestDist < 0.7 && !run.pads[bestIdx].filled) {
        run.pads[bestIdx].filled = true;
        run.padsFilled++;
        const timeBonus = Math.floor(run.timeLeft / 100);
        run.score += 50 + timeBonus;
        bumpHigh(run);
        run.play("pad");
        if (run.padsFilled >= run.pads.length) {
            run.play("win");
            run.score += 500;
            bumpHigh(run);
            showBanner(run, "ROUND CLEAR!", 1500);
            respawnPlayer(run, false);
            run.respawnLock = 1500;
            run.pendingRound = true;
        } else {
            respawnPlayer(run, false);
            run.timeLeft = ROUND_TIME_MS;
        }
    } else {
        onDeath(run, "squish");
    }
}

function onDeath(run, kind) {
    if (run.deathTimer > 0) return;
    run.lives--;
    run.deathTimer = 1000;
    if (kind === "drown") run.play("drown");
    else run.play("squish");
    const msg = kind === "drown" ? "SPLASH!"
        : (kind === "timeout" ? "TIME UP!" : "SQUISH!");
    showBanner(run, msg, 900);
}

function showBanner(run, text, ms) {
    run.banner.text = text;
    run.banner.timer = ms;
}

function bumpHigh(run) {
    if (run.save) run.save.maybeHighScore(run.score);
}

// ── Draw ─────────────────────────────────────────────────────────────────

function drawTerrain(ctx, ox, oy) {
    for (let r = 0; r < ROWS; r++) {
        const y = oy + r * TILE;
        let color = "#2e7d32";
        if (r >= ROW_RIVER_START && r <= ROW_RIVER_END) color = "#1565c0";
        else if (r === ROW_MEDIAN) color = "#388e3c";
        else if (r >= ROW_ROAD_START && r <= ROW_ROAD_END) color = "#2b2b2b";
        else if (r === ROW_GOAL) color = "#1b3a1b";
        ctx.fillStyle = color;
        ctx.fillRect(ox, y, GRID_W, TILE);

        if (r >= ROW_ROAD_START && r <= ROW_ROAD_END && r < ROW_ROAD_END) {
            ctx.fillStyle = "#f9ca24";
            for (let sx = ox; sx < ox + GRID_W; sx += 20) {
                ctx.fillRect(sx, y + TILE - 2, 10, 4);
            }
        }

        if (r >= ROW_RIVER_START && r <= ROW_RIVER_END) {
            ctx.fillStyle = "rgba(255,255,255,0.08)";
            for (let s = 0; s < 6; s++) {
                const sx = ox + ((s * 137 + r * 53) % GRID_W);
                ctx.fillRect(sx, y + (r * 7) % TILE, 20, 2);
            }
        }
    }
}

function drawPads(ctx, run, ox, oy) {
    for (let i = 0; i < run.pads.length; i++) {
        const pad = run.pads[i];
        const px = ox + pad.col * TILE;
        const py = oy + ROW_GOAL * TILE;
        ctx.fillStyle = "#4caf50";
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.4, 0, Math.PI * 2);
        ctx.fill();
        if (pad.filled) {
            drawFrog(ctx, px + TILE / 2, py + TILE / 2, TILE * 0.65, "#689f38");
        }
    }
}

function drawEntities(ctx, run, ox, oy) {
    for (let r = 0; r < ROWS; r++) {
        const lane = run.lanes[r];
        if (!lane) continue;
        const ly = oy + r * TILE;
        for (let j = 0; j < lane.entities.length; j++) {
            const e = lane.entities[j];
            const ex = ox + e.x * TILE;
            const ew = e.width * TILE;
            if (e.type === "car") {
                ctx.fillStyle = e.width >= 2 ? "#c62828" : "#ef6c00";
                ctx.fillRect(ex + 4, ly + 6, ew - 8, TILE - 12);
                ctx.fillStyle = "#111";
                ctx.fillRect(ex + 6, ly + TILE - 10, 10, 6);
                ctx.fillRect(ex + ew - 16, ly + TILE - 10, 10, 6);
                ctx.fillStyle = "rgba(255,255,255,0.25)";
                if (lane.dir > 0) ctx.fillRect(ex + ew - 20, ly + 12, 10, TILE - 24);
                else ctx.fillRect(ex + 10, ly + 12, 10, TILE - 24);
            } else if (e.type === "log") {
                ctx.fillStyle = "#6d4c41";
                ctx.fillRect(ex, ly + 8, ew, TILE - 16);
                ctx.fillStyle = "#4e342e";
                ctx.fillRect(ex, ly + 8, ew, 4);
                ctx.fillRect(ex, ly + TILE - 12, ew, 4);
                ctx.fillStyle = "#3e2723";
                ctx.fillRect(ex + 4, ly + 14, 2, TILE - 28);
                ctx.fillRect(ex + ew - 6, ly + 14, 2, TILE - 28);
            }
        }
    }
}

function drawPlayer(ctx, run, ox, oy) {
    if (run.deathTimer > 0 && (Math.floor(run.deathTimer / 100) % 2 !== 0)) return;
    const pcx = ox + (run.player.col + 0.5) * TILE;
    const pcy = oy + (run.player.row + 0.5) * TILE;
    drawFrog(ctx, pcx, pcy, TILE * 0.75, "#8bc34a");
}

function drawBanner(ctx, text, w, h) {
    ctx.fillStyle = "#ffeb3b";
    ctx.font = "bold 48px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text, w / 2, h * 0.45);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

function drawFrog(ctx, cx, cy, size, color) {
    const s = size;
    ctx.fillStyle = color;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = "#558b2f";
    ctx.fillRect(cx - s / 2 - 2, cy - s / 4, 6, s / 2);
    ctx.fillRect(cx + s / 2 - 4, cy - s / 4, 6, s / 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(cx - s / 3, cy - s / 2 - 2, s / 5, s / 5);
    ctx.fillRect(cx + s / 3 - s / 5, cy - s / 2 - 2, s / 5, s / 5);
    ctx.fillStyle = "#000";
    ctx.fillRect(cx - s / 3 + 2, cy - s / 2, 3, 3);
    ctx.fillRect(cx + s / 3 - s / 5 + 2, cy - s / 2, 3, 3);
}
