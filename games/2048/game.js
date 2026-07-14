// 2048 — sliding tile puzzle (arcade plugin).
// Rules, drawing, and cues only. Screens / loop / input shell: /lib/arcade.

const SIZE = 4;
const MOVE_MS = 110;
const POP_MS = 180;

const TILE_COLORS = {
    2:    { bg: "#eee4da", fg: "#776e65" },
    4:    { bg: "#ede0c8", fg: "#776e65" },
    8:    { bg: "#f2b179", fg: "#f9f6f2" },
    16:   { bg: "#f59563", fg: "#f9f6f2" },
    32:   { bg: "#f67c5f", fg: "#f9f6f2" },
    64:   { bg: "#f65e3b", fg: "#f9f6f2" },
    128:  { bg: "#edcf72", fg: "#f9f6f2" },
    256:  { bg: "#edcc61", fg: "#f9f6f2" },
    512:  { bg: "#edc850", fg: "#f9f6f2" },
    1024: { bg: "#edc53f", fg: "#f9f6f2" },
    2048: { bg: "#edc22e", fg: "#f9f6f2" },
};
const SUPER_COLORS = { bg: "#3c3a32", fg: "#f9f6f2" };

let nextId = 1;

function newTile(value) {
    return { value, id: nextId++ };
}

export const game = {
    id: "2048",
    clearColor: "#faf8ef",

    actions: [
        { name: "undo", label: "Undo", defaults: ["u"] },
        { name: "restart_board", label: "Restart Board", defaults: ["r"] },
    ],

    create(ctx) {
        const run = {
            score: 0,
            grid: emptyGrid(),
            won: false,
            keepPlaying: false,
            prev: null,
            ended: false,
            pending: null, // "win" | "gameover" | null
            anim: null,
            animT: 0,
            play: ctx.play,
            highScore: ctx.highScore,
            save: ctx.save,
        };
        spawnTile(run.grid);
        spawnTile(run.grid);
        run.anim = collectPresent(run.grid).map((t) => ({
            id: t.id,
            value: t.value,
            fromR: t.r, fromC: t.c,
            toR: t.r, toC: t.c,
            kind: "new",
        }));
        run.animT = 0;
        return run;
    },

    update(run, dt, input) {
        if (run.ended) return { status: "gameover" };

        if (run.anim) {
            run.animT += dt;
            if (run.animT >= animDuration(run.anim)) {
                run.anim = null;
                run.animT = 0;
                if (run.pending === "win") {
                    run.pending = null;
                    return { status: "screen", name: "win" };
                }
                if (run.pending === "gameover") {
                    run.pending = null;
                    run.ended = true;
                    return { status: "gameover" };
                }
            }
            return;
        }

        if (input.pressed("undo")) {
            undo(run);
            return;
        }
        if (input.pressed("restart_board")) {
            resetBoard(run);
            return;
        }

        let dir = null;
        if (input.pressed("left")) dir = "left";
        else if (input.pressed("right")) dir = "right";
        else if (input.pressed("up")) dir = "up";
        else if (input.pressed("down")) dir = "down";

        if (dir) tryMove(run, dir);

        if (run.pending === "win" && !run.anim) {
            run.pending = null;
            return { status: "screen", name: "win" };
        }
        if (run.pending === "gameover" && !run.anim) {
            run.pending = null;
            run.ended = true;
            return { status: "gameover" };
        }
    },

    draw(run, ctx, view) {
        const { w, h } = view.size();
        const board = layoutBoard(w, h);

        ctx.fillStyle = "#faf8ef";
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = "#776e65";
        ctx.font = "bold 42px Helvetica, Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("2048", board.ox, Math.max(16, board.oy - 72));

        drawBoardWell(ctx, board);

        const tiles = visualTiles(run);
        for (let i = 0; i < tiles.length; i++) {
            drawTile(ctx, board, tiles[i]);
        }

        ctx.fillStyle = "#8f7a66";
        ctx.font = "12px Helvetica, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(
            "Arrow keys or WASD · U undo · R restart · Esc pause",
            w / 2,
            board.oy + board.h + board.pad + 16
        );
    },

    drawTitle(ctx, view) {
        const { w, h } = view.size();
        ctx.fillStyle = "#faf8ef";
        ctx.fillRect(0, 0, w, h);
        const board = layoutBoard(w, h);
        roundRect(ctx, board.ox - board.pad, board.oy - board.pad,
            board.w + board.pad * 2, board.h + board.pad * 2, 8);
        ctx.fillStyle = "rgba(187,173,160,0.45)";
        ctx.fill();
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const x = board.ox + c * (board.cell + board.gap);
                const y = board.oy + r * (board.cell + board.gap);
                roundRect(ctx, x, y, board.cell, board.cell, 6);
                ctx.fillStyle = "rgba(205,193,180,0.55)";
                ctx.fill();
            }
        }
    },

    hud(run) {
        return {
            score: run ? run.score : 0,
            best: run ? run.highScore() : 0,
        };
    },

    gameOverText(run) {
        const score = run ? run.score : 0;
        const best = run ? run.highScore() : 0;
        const tag = run && run._newBest ? "  ·  NEW BEST" : "";
        return (
            "Score    " + score + tag + "\n" +
            "Best     " + best
        );
    },

    onEnterScreen(name, run) {
        if (name === "win" && run) {
            const el = document.getElementById("win-stats");
            if (el) {
                el.textContent =
                    "Score: " + run.score + "   Best: " + run.highScore();
            }
        }
    },

    onMenuAction(action, run) {
        if (action === "keepplaying" && run) {
            run.keepPlaying = true;
            run.won = true;
            return "playing";
        }
        return null;
    },

    cue(name, audio) {
        if (name === "merge") audio.tone(520, 0.06, "square", 0.45);
        else if (name === "move") audio.tone(280, 0.03, "triangle", 0.2);
        else if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.5],
                [659, 0.1, "square", 0.55],
                [784, 0.18, "square", 0.6],
            ]);
        } else if (name === "lose") {
            audio.sequence([
                [300, 0.12, "sawtooth", 0.45],
                [200, 0.18, "sawtooth", 0.45],
            ]);
        }
    },
};

// ── Board layout ─────────────────────────────────────────────────────────

function layoutBoard(W, H) {
    const pad = 10;
    const gap = 10;
    const marginX = 40;
    const topReserve = 120;
    const bottomReserve = 48;
    const availW = W - marginX * 2;
    const availH = H - topReserve - bottomReserve;
    const cell = Math.floor(Math.min(
        (availW - pad * 2 - gap * (SIZE - 1)) / SIZE,
        (availH - pad * 2 - gap * (SIZE - 1)) / SIZE
    ));
    const inner = cell * SIZE + gap * (SIZE - 1);
    return {
        cell,
        gap,
        pad,
        w: inner,
        h: inner,
        ox: Math.floor((W - inner) / 2),
        oy: Math.floor(topReserve + (availH - inner) / 2),
    };
}

// ── Grid helpers ─────────────────────────────────────────────────────────

function emptyGrid() {
    const g = new Array(SIZE);
    for (let r = 0; r < SIZE; r++) {
        g[r] = new Array(SIZE);
        for (let c = 0; c < SIZE; c++) g[r][c] = null;
    }
    return g;
}

function cloneGrid(g) {
    const ng = emptyGrid();
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            ng[r][c] = g[r][c]
                ? { value: g[r][c].value, id: g[r][c].id }
                : null;
        }
    }
    return ng;
}

function emptyCells(g) {
    const out = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (!g[r][c]) out.push({ r, c });
        }
    }
    return out;
}

function spawnTile(g) {
    const empties = emptyCells(g);
    if (!empties.length) return null;
    const spot = empties[Math.floor(Math.random() * empties.length)];
    const value = Math.random() < 0.1 ? 4 : 2;
    const tile = newTile(value);
    g[spot.r][spot.c] = tile;
    return { tile, r: spot.r, c: spot.c };
}

function hasMoves(g) {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (!g[r][c]) return true;
            const v = g[r][c].value;
            if (c + 1 < SIZE && g[r][c + 1] && g[r][c + 1].value === v) return true;
            if (r + 1 < SIZE && g[r + 1][c] && g[r + 1][c].value === v) return true;
        }
    }
    return false;
}

function hasValue(g, target) {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (g[r][c] && g[r][c].value === target) return true;
        }
    }
    return false;
}

function collectPresent(g) {
    const out = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (g[r][c]) out.push({ id: g[r][c].id, value: g[r][c].value, r, c });
        }
    }
    return out;
}

// ── Slide logic ──────────────────────────────────────────────────────────
// Returns { changed, mergedIds, gainedScore, moved }.

function move(g, dir) {
    let gained = 0;
    let anyChange = false;
    const mergedIds = {};
    const moved = [];

    function processLine(cells) {
        const tiles = [];
        for (let i = 0; i < cells.length; i++) {
            const rc = cells[i];
            if (g[rc.r][rc.c]) {
                tiles.push({ tile: g[rc.r][rc.c], r: rc.r, c: rc.c });
            }
        }
        const resultTiles = [];
        let i2 = 0;
        let outIdx = 0;
        while (i2 < tiles.length) {
            const dest = cells[outIdx];
            const cur = tiles[i2];
            if (i2 + 1 < tiles.length && tiles[i2 + 1].tile.value === cur.tile.value) {
                const other = tiles[i2 + 1];
                const newVal = cur.tile.value * 2;
                gained += newVal;
                const merged = newTile(newVal);
                mergedIds[merged.id] = true;
                resultTiles.push(merged);
                moved.push({
                    id: cur.tile.id, value: cur.tile.value,
                    fromR: cur.r, fromC: cur.c, toR: dest.r, toC: dest.c, kind: "slide",
                });
                moved.push({
                    id: other.tile.id, value: other.tile.value,
                    fromR: other.r, fromC: other.c, toR: dest.r, toC: dest.c, kind: "slide",
                });
                moved.push({
                    id: merged.id, value: newVal,
                    fromR: dest.r, fromC: dest.c, toR: dest.r, toC: dest.c,
                    kind: "merge", delay: MOVE_MS * 0.85,
                });
                anyChange = true;
                i2 += 2;
            } else {
                resultTiles.push(cur.tile);
                if (cur.r !== dest.r || cur.c !== dest.c) {
                    anyChange = true;
                    moved.push({
                        id: cur.tile.id, value: cur.tile.value,
                        fromR: cur.r, fromC: cur.c, toR: dest.r, toC: dest.c, kind: "slide",
                    });
                } else {
                    moved.push({
                        id: cur.tile.id, value: cur.tile.value,
                        fromR: cur.r, fromC: cur.c, toR: dest.r, toC: dest.c, kind: "idle",
                    });
                }
                i2 += 1;
            }
            outIdx += 1;
        }
        for (let k = 0; k < cells.length; k++) {
            g[cells[k].r][cells[k].c] =
                k < resultTiles.length ? resultTiles[k] : null;
        }
    }

    for (let i = 0; i < SIZE; i++) {
        const line = [];
        if (dir === "left") {
            for (let c = 0; c < SIZE; c++) line.push({ r: i, c });
        } else if (dir === "right") {
            for (let c = SIZE - 1; c >= 0; c--) line.push({ r: i, c });
        } else if (dir === "up") {
            for (let r = 0; r < SIZE; r++) line.push({ r, c: i });
        } else if (dir === "down") {
            for (let r = SIZE - 1; r >= 0; r--) line.push({ r, c: i });
        }
        processLine(line);
    }

    return { changed: anyChange, mergedIds, gainedScore: gained, moved };
}

// ── Actions ──────────────────────────────────────────────────────────────

function resetBoard(run) {
    run.grid = emptyGrid();
    run.score = 0;
    run.won = false;
    run.keepPlaying = false;
    run.prev = null;
    run.ended = false;
    run.pending = null;
    const s1 = spawnTile(run.grid);
    const s2 = spawnTile(run.grid);
    run.anim = [];
    if (s1) {
        run.anim.push({
            id: s1.tile.id, value: s1.tile.value,
            fromR: s1.r, fromC: s1.c, toR: s1.r, toC: s1.c, kind: "new",
        });
    }
    if (s2) {
        run.anim.push({
            id: s2.tile.id, value: s2.tile.value,
            fromR: s2.r, fromC: s2.c, toR: s2.r, toC: s2.c, kind: "new",
        });
    }
    run.animT = 0;
}

function undo(run) {
    if (!run.prev) return;
    run.grid = run.prev.grid;
    run.score = run.prev.score;
    run.won = run.prev.won;
    run.keepPlaying = run.prev.keepPlaying;
    run.prev = null;
    run.pending = null;
    run.anim = null;
    run.animT = 0;
}

function tryMove(run, dir) {
    const snapGrid = cloneGrid(run.grid);
    const snapScore = run.score;
    const snapWon = run.won;
    const snapKeep = run.keepPlaying;

    const result = move(run.grid, dir);
    if (!result.changed) return;

    run.score += result.gainedScore;
    if (run.score > run.highScore()) {
        run.save.maybeHighScore(run.score);
    }

    run.prev = {
        grid: snapGrid,
        score: snapScore,
        won: snapWon,
        keepPlaying: snapKeep,
    };

    const spawn = spawnTile(run.grid);
    const anim = result.moved.filter((m) => m.kind !== "idle");
    if (spawn) {
        anim.push({
            id: spawn.tile.id,
            value: spawn.tile.value,
            fromR: spawn.r, fromC: spawn.c,
            toR: spawn.r, toC: spawn.c,
            kind: "new",
            delay: MOVE_MS,
        });
    }
    // Keep idle tiles visible during anim so non-movers don't vanish
    for (let i = 0; i < result.moved.length; i++) {
        if (result.moved[i].kind === "idle") anim.push(result.moved[i]);
    }
    run.anim = anim;
    run.animT = 0;

    if (result.gainedScore > 0) run.play("merge");
    else run.play("move");

    if (!run.won && !run.keepPlaying && hasValue(run.grid, 2048)) {
        run.won = true;
        run.pending = "win";
        run.play("win");
        return;
    }
    if (!hasMoves(run.grid)) {
        run.pending = "gameover";
        run.play("lose");
    }
}

// ── Animation / draw ─────────────────────────────────────────────────────

function animDuration(anim) {
    if (!anim || !anim.length) return 0;
    let max = MOVE_MS;
    for (let i = 0; i < anim.length; i++) {
        const a = anim[i];
        const delay = a.delay || 0;
        if (a.kind === "new" || a.kind === "merge") {
            max = Math.max(max, delay + POP_MS);
        } else {
            max = Math.max(max, delay + MOVE_MS);
        }
    }
    return max;
}

function easeOutCubic(t) {
    const u = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - u, 3);
}

function visualTiles(run) {
    if (!run.anim) {
        return collectPresent(run.grid).map((t) => ({
            id: t.id, value: t.value, r: t.r, c: t.c, scale: 1, alpha: 1,
        }));
    }

    const t = run.animT;
    const out = [];
    for (let i = 0; i < run.anim.length; i++) {
        const a = run.anim[i];
        const delay = a.delay || 0;
        const local = t - delay;

        if (a.kind === "slide" || a.kind === "idle") {
            const u = a.kind === "idle" ? 1 : easeOutCubic(local / MOVE_MS);
            const r = a.fromR + (a.toR - a.fromR) * u;
            const c = a.fromC + (a.toC - a.fromC) * u;
            let alpha = 1;
            if (a.kind === "slide" && local > MOVE_MS) alpha = 0;
            if (alpha > 0) {
                out.push({ id: a.id, value: a.value, r, c, scale: 1, alpha });
            }
        } else if (a.kind === "merge") {
            if (local < 0) continue;
            const u = Math.min(1, local / POP_MS);
            const scale = u < 0.5
                ? 1 + 0.18 * (u / 0.5)
                : 1.18 - 0.18 * ((u - 0.5) / 0.5);
            out.push({
                id: a.id, value: a.value,
                r: a.toR, c: a.toC, scale, alpha: 1,
            });
        } else if (a.kind === "new") {
            if (local < 0) continue;
            const u = Math.min(1, local / POP_MS);
            let scale;
            if (u < 0.6) scale = (u / 0.6) * 1.1;
            else scale = 1.1 - 0.1 * ((u - 0.6) / 0.4);
            out.push({
                id: a.id, value: a.value,
                r: a.toR, c: a.toC, scale, alpha: 1,
            });
        }
    }
    return out;
}

function tileColors(value) {
    return TILE_COLORS[value] || SUPER_COLORS;
}

function fontSizeFor(value, cell) {
    if (value >= 1000) return Math.floor(cell * 0.32);
    if (value >= 100) return Math.floor(cell * 0.38);
    return Math.floor(cell * 0.46);
}

function drawBoardWell(ctx, board) {
    roundRect(ctx, board.ox - board.pad, board.oy - board.pad,
        board.w + board.pad * 2, board.h + board.pad * 2, 8);
    ctx.fillStyle = "#bbada0";
    ctx.fill();

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const x = board.ox + c * (board.cell + board.gap);
            const y = board.oy + r * (board.cell + board.gap);
            roundRect(ctx, x, y, board.cell, board.cell, 6);
            ctx.fillStyle = "#cdc1b4";
            ctx.fill();
        }
    }
}

function drawTile(ctx, board, tile) {
    const x = board.ox + tile.c * (board.cell + board.gap);
    const y = board.oy + tile.r * (board.cell + board.gap);
    const col = tileColors(tile.value);
    const scale = tile.scale != null ? tile.scale : 1;
    const alpha = tile.alpha != null ? tile.alpha : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    const cx = x + board.cell / 2;
    const cy = y + board.cell / 2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    roundRect(ctx, x, y, board.cell, board.cell, 6);
    ctx.fillStyle = col.bg;
    ctx.fill();

    ctx.fillStyle = col.fg;
    ctx.font = "bold " + fontSizeFor(tile.value, board.cell) + "px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tile.value), cx, cy + 1);

    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}
