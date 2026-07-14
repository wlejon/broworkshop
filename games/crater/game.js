// Crater — multiplayer artillery client on the arcade foundation.
// Server (server.js) + shared math (shared.js) are unchanged.
// Screens / loop / pause chrome: /lib/arcade. Match + net: this plugin.

import { NetRoom } from "/lib/netroom.js";
import { CraterShared } from "/app/shared.js";

const { C, heightAt, applyCraterDiff } = CraterShared;

/** @type {object|null} Join args filled by onMenuAction("connect"). */
let pendingJoin = null;

/** @type {object|null} Last shell api (for net callbacks when run is mid-flight). */
let shellApi = null;

let toastTimer = 0;

export const game = {
    id: "crater",
    clearColor: "#06070b",

    defaults: {
        highScore: 0,
        name: "Player",
        address: "127.0.0.1:27100",
    },

    actions: [
        { name: "power_down", label: "Power Down", defaults: ["q"] },
        { name: "power_up",   label: "Power Up",   defaults: ["e"] },
        // primary = fire (Space); left/right = aim dir; up/down = angle
    ],

    create(ctx) {
        shellApi = ctx;
        const join = pendingJoin || {
            name: ctx.save.get("name") || "Player",
            address: ctx.save.get("address") || "127.0.0.1:27100",
        };
        pendingJoin = null;

        const run = {
            phase: "connecting", // connecting | lobby | match | gameover
            active: false,
            myId: null,
            client: null,
            hm: null,
            players: [],
            turn: null,
            aim: { angle: Math.PI / 4, power: 0.5, dir: 1 },
            lobby: { hostId: null, entries: [] },
            projectile: null,
            explosion: null,
            particles: [],
            cameraShake: 0,
            winner: null,
            score: 0,
            play: ctx.play,
            save: ctx.save,
            audio: ctx.audio,
            view: ctx.view,
            api: ctx,
            _result: null,
        };

        connectRun(run, join);
        return run;
    },

    update(run, dt, input) {
        shellApi = run.api || shellApi;

        // Join failed before a lobby state arrived — bounce to title with error.
        if (run.phase === "failed") {
            return { status: "screen", name: "title" };
        }

        // After create the shell lands on "playing"; park in lobby until match.
        if (run.phase === "connecting" || run.phase === "lobby") {
            return { status: "screen", name: "lobby" };
        }

        if (run.phase === "gameover") {
            return { status: "gameover", result: run.winner };
        }

        if (run.phase !== "match" || !run.active) return;

        tickMatch(run, dt, input);
    },

    draw(run, ctx, view) {
        if (!run || (run.phase !== "match" && run.phase !== "gameover" && run.phase !== "pause")) {
            drawSky(ctx, view);
            return;
        }
        drawMatch(run, ctx, view);
    },

    drawTitle(ctx, view) {
        drawSky(ctx, view);
    },

    hud(run) {
        if (!run || !run.active) {
            return { turn: "Waiting…", angle: "45", power: "50", dir: "→" };
        }
        const turnPlayer = run.players.find((p) => p.id === run.turn);
        const turnText = turnPlayer
            ? ("Turn: " + turnPlayer.name + (turnPlayer.id === run.myId ? " (YOU)" : ""))
            : "Waiting…";
        return {
            turn: turnText,
            angle: (run.aim.angle * 180 / Math.PI).toFixed(0),
            power: String(Math.round(run.aim.power * 100)),
            dir: run.aim.dir > 0 ? "→" : "←",
        };
    },

    gameOverText(run, result) {
        const msg = result || (run && run.winner) || {};
        const winPlayer = msg.winnerId != null && run
            ? run.players.find((p) => p.id === msg.winnerId)
            : null;
        const title = document.getElementById("gameover-title");
        if (title) {
            if (msg.winnerId == null) title.textContent = "Draw";
            else if (run && msg.winnerId === run.myId) title.textContent = "Victory!";
            else title.textContent = "Defeated";
        }
        if (winPlayer) return winPlayer.name + " wins the match.";
        return "All tanks destroyed.";
    },

    onEnterScreen(name, run, api) {
        if (api) shellApi = api;

        if (name === "title") {
            fillConnectFields(api);
            showError("");
            hideMatchHud();
        }

        if (name === "lobby") {
            hideMatchHud();
            if (run) renderLobby(run);
        }

        if (name === "gameover" && run) {
            // Title/stats filled via gameOverText
        }
    },

    onMenuAction(action, run, api) {
        if (api) shellApi = api;

        if (action === "connect") {
            if (!prepareJoin(api)) return null;
            return { startRun: true };
        }

        if (!run) return null;

        if (action === "ready") {
            const me = run.lobby.entries.find((p) => p.id === run.myId);
            sendReady(run, me ? !me.ready : true);
            return null;
        }
        if (action === "bot") {
            if (isHost(run)) sendBot(run);
            return null;
        }
        if (action === "start") {
            if (isHost(run)) sendStart(run);
            return null;
        }
        if (action === "leave") {
            leaveMatch(run);
            return "title";
        }
        if (action === "lobby") {
            run.phase = "lobby";
            run.active = false;
            hideMatchHud();
            renderLobby(run);
            return "lobby";
        }

        return null;
    },

    cue(name, audio) {
        if (name === "aim") audio.tone(280, 0.02, "sine", 0.15);
        else if (name === "fire") {
            audio.sequence([
                [200, 0.07, "sawtooth", 0.5],
                [140, 0.15, "triangle", 0.5],
            ]);
        } else if (name === "hit") {
            audio.sequence([
                [90, 0.12, "square", 0.8],
                [60, 0.35, "sawtooth", 0.7],
            ]);
        } else if (name === "miss") audio.tone(180, 0.2, "triangle", 0.35);
        else if (name === "die") {
            audio.sequence([
                [220, 0.1, "sawtooth", 0.5],
                [180, 0.1, "sawtooth", 0.5],
                [120, 0.4, "sawtooth", 0.6],
            ]);
        } else if (name === "win") {
            audio.sequence([
                [523, 0.1, "square", 0.6],
                [659, 0.1, "square", 0.7],
                [784, 0.15, "square", 0.8],
                [1047, 0.25, "square", 0.8],
            ]);
        }
    },
};

// ─── Connect / net ──────────────────────────────────────────────────────

function fillConnectFields(api) {
    const nameEl = document.getElementById("in-name");
    const addrEl = document.getElementById("in-address");
    if (!nameEl || !addrEl) return;
    if (api && api.save) {
        nameEl.value = api.save.get("name") || "Player";
        addrEl.value = api.save.get("address") || "127.0.0.1:27100";
    }
}

function prepareJoin(api) {
    const nameEl = document.getElementById("in-name");
    const addrEl = document.getElementById("in-address");
    const name = (nameEl && nameEl.value.trim()) || "Player";
    const address = (addrEl && addrEl.value.trim()) || "127.0.0.1:27100";

    if (api && api.save) {
        api.save.set("name", name);
        api.save.set("address", address);
        api.save.save();
    }

    pendingJoin = { name, address };
    showError("");
    return true;
}

function connectRun(run, join) {
    try {
        run.client = NetRoom.join({
            address: join.address,
            name: join.name,
            onConnect() {
                showError("");
            },
            onDisconnect() {
                onDisconnect(run);
            },
            onMessage(t, msg) {
                handleServerMessage(run, t, msg);
            },
        });
    } catch (e) {
        showError(e.message || String(e));
        run.phase = "failed";
        run.client = null;
    }
}

function handleServerMessage(run, t, msg) {
    switch (t) {
        case "welcome":
            run.myId = msg.id;
            break;
        case "denied":
            showError(msg.reason || "Connection denied");
            closeClient(run);
            goTitle(run);
            break;
        case "state":
            onLobbyState(run, msg);
            break;
        case "match":
            onMatchStart(run, msg);
            break;
        case "shot":
            onShot(run, msg);
            break;
        case "skip":
            onSkip(run, msg);
            break;
        case "over":
            onGameOver(run, msg);
            break;
    }
}

function onDisconnect(run) {
    run.active = false;
    run.client = null;
    run.myId = null;
    run.phase = "connecting";
    hideMatchHud();
    showError("Disconnected from server");
    goTitle(run);
}

function onLobbyState(run, msg) {
    run.phase = "lobby";
    run.active = false;
    run.lobby.hostId = msg.hostId;
    run.lobby.entries = msg.players;
    renderLobby(run);
    const screen = run.api && run.api.getScreen ? run.api.getScreen() : null;
    if (screen !== "lobby" && screen !== "gameover") {
        // Entering lobby from connect, or returning after leave-of-match mid-flow
        if (run.api) run.api.switchTo("lobby");
    }
}

function onMatchStart(run, msg) {
    run.phase = "match";
    run.active = true;
    run.hm = new Float32Array(msg.hm);
    run.players = msg.players.map((p) => Object.assign({}, p));
    run.turn = msg.turn;
    run.projectile = null;
    run.explosion = null;
    run.particles.length = 0;
    run.winner = null;
    run._result = null;
    updateHudPlayers(run);
    if (run.api) run.api.switchTo("playing");
}

function onShot(run, msg) {
    if (!run.active) return;
    if (run.projectile) {
        detonate(run, run.projectile);
        run.projectile = null;
    }
    run.projectile = {
        x: msg.originX,
        y: msg.originY,
        vx: msg.vx,
        vy: msg.vy,
        flightMs: msg.flightMs,
        flown: 0,
        hit: msg.hit,
        impactX: msg.impactX,
        impactY: msg.impactY,
        craterCols: msg.craterCols,
        damages: msg.damages,
        dead: msg.dead,
        nextTurn: msg.nextTurn,
        over: msg.nextTurn == null,
        trail: [msg.originX, msg.originY],
        sinceTrail: 0,
    };
    run.play("fire");
}

function onSkip(run, msg) {
    run.turn = msg.nextTurn;
    updateHudPlayers(run);
    toast("Turn skipped (timeout)");
}

function onGameOver(run, msg) {
    run.active = false;
    run.phase = "gameover";
    run.winner = msg;
    run._result = msg;
    const winPlayer = msg.winnerId != null
        ? run.players.find((p) => p.id === msg.winnerId)
        : null;
    if (winPlayer && winPlayer.id === run.myId) run.play("win");
    hideMatchHud();
    if (run.api) run.api.switchTo("gameover");
}

function goTitle(run) {
    if (run && run.api) run.api.switchTo("title");
    else if (shellApi) shellApi.switchTo("title");
}

function closeClient(run) {
    if (run.client) {
        try { run.client.close(); } catch (e) { /* ignore */ }
    }
    run.client = null;
    run.myId = null;
}

function leaveMatch(run) {
    closeClient(run);
    run.active = false;
    run.phase = "connecting";
    run.hm = null;
    run.players = [];
    run.projectile = null;
    hideMatchHud();
}

function sendReady(run, ready) {
    if (run.client) run.client.send("ready", { ready });
}
function sendStart(run) {
    if (run.client) run.client.send("start");
}
function sendBot(run) {
    if (run.client) run.client.send("addBot");
}

function fire(run) {
    if (!run.client || !isMyTurn(run) || run.projectile) return;
    run.client.send("fire", {
        angle: run.aim.angle,
        power: run.aim.power,
        dir: run.aim.dir,
    });
}

// ─── Helpers ────────────────────────────────────────────────────────────

function myPlayer(run) {
    return run.players.find((p) => p.id === run.myId) || null;
}
function isMyTurn(run) {
    return run.active && run.turn === run.myId;
}
function isHost(run) {
    return run.lobby.hostId === run.myId;
}

function showError(msg) {
    const el = document.getElementById("title-error");
    if (el) el.textContent = msg || "";
}

function hideMatchHud() {
    const hud = document.getElementById("hud");
    if (hud) {
        hud.hidden = true;
        hud.style.display = "none";
    }
}

function toast(msg) {
    const el = document.getElementById("crater-toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.style.display = "";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.hidden = true;
        el.style.display = "none";
    }, 1800);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
}

function hpColor(hp) {
    return hp > 50 ? "#3ecf4a" : (hp > 20 ? "#f5b940" : "#e55");
}

function updateHudPlayers(run) {
    const el = document.getElementById("hud-players");
    if (!el) return;
    el.innerHTML = run.players.map((p) => {
        const hpPct = Math.max(0, p.hp / C.HP_MAX * 100);
        const cls = [
            "hud-player",
            p.id === run.turn ? "active" : "",
            !p.alive ? "dead" : "",
        ].filter(Boolean).join(" ");
        return (
            '<div class="' + cls + '">' +
            '<span style="color:' + p.color + '">' +
            (p.id === run.myId ? "★ " : "") + escapeHtml(p.name) +
            "</span>" +
            '<span class="hp-bar"><span class="hp-fill" style="width:' + hpPct +
            "%;background:" + hpColor(p.hp) + '"></span></span>' +
            "</div>"
        );
    }).join("");
}

function renderLobby(run) {
    const el = document.getElementById("lobby-players");
    if (!el || !run) return;
    el.innerHTML = (run.lobby.entries || []).map((p) => (
        '<div class="lobby-row">' +
        '<span class="lobby-swatch" style="background:' + p.color + '"></span>' +
        "<span>" + escapeHtml(p.name) + "</span>" +
        (p.bot ? '<span class="lobby-bot">(bot)</span>' : "") +
        (p.id === run.lobby.hostId ? '<span class="lobby-bot">(host)</span>' : "") +
        '<span class="lobby-ready ' + (p.ready ? "" : "not-ready") + '">' +
        (p.ready ? "READY" : "not ready") + "</span>" +
        "</div>"
    )).join("");

    const root = document.getElementById("screen-lobby");
    if (!root) return;
    const items = root.querySelectorAll(".menu-item");
    let startItem = null;
    let botItem = null;
    for (let i = 0; i < items.length; i++) {
        const a = items[i].dataset.action;
        if (a === "start") startItem = items[i];
        if (a === "bot") botItem = items[i];
    }
    const humansReady = run.lobby.entries.filter((p) => !p.bot).every((p) => p.ready);
    const canStart = isHost(run) && run.lobby.entries.length >= 2 && humansReady;
    if (startItem) startItem.classList.toggle("disabled", !canStart);
    if (botItem) botItem.classList.toggle("disabled", !isHost(run));
}

// ─── Simulation (visual only) ───────────────────────────────────────────

function tickMatch(run, dt, input) {
    const dts = dt / 1000;
    if (run.cameraShake > 0) run.cameraShake = Math.max(0, run.cameraShake - dt * 0.15);

    if (run.projectile) {
        const p = run.projectile;
        const steps = 4;
        const h = dts / steps;
        for (let i = 0; i < steps; i++) {
            p.x += p.vx * h;
            p.y += p.vy * h;
            p.vy -= C.GRAVITY * h;
            p.flown += h;
        }
        p.sinceTrail += dt;
        if (p.sinceTrail > 30) {
            p.trail.push(p.x, p.y);
            if (p.trail.length > 80) p.trail.splice(0, 2);
            p.sinceTrail = 0;
        }
        if (p.flown * 1000 >= p.flightMs) {
            detonate(run, p);
            run.projectile = null;
        }
    }

    if (run.explosion) {
        run.explosion.t += dt / run.explosion.duration;
        if (run.explosion.t >= 1) run.explosion = null;
    }

    const parts = run.particles;
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) {
            parts.splice(i, 1);
            continue;
        }
        p.x += p.vx * dts;
        p.y += p.vy * dts;
        p.vy -= 15 * dts;
    }

    if (isMyTurn(run) && !run.projectile) {
        if (input.down("left"))  run.aim.dir = -1;
        if (input.down("right")) run.aim.dir =  1;
        if (input.down("up")) {
            run.aim.angle = Math.min(Math.PI / 2 - 0.02, run.aim.angle + 0.8 * dts);
        }
        if (input.down("down")) {
            run.aim.angle = Math.max(0.02, run.aim.angle - 0.8 * dts);
        }
        if (input.down("power_up")) {
            run.aim.power = Math.min(1, run.aim.power + 0.5 * dts);
        }
        if (input.down("power_down")) {
            run.aim.power = Math.max(0.05, run.aim.power - 0.5 * dts);
        }
        if (input.pressed("primary")) fire(run);
    }
}

function detonate(run, p) {
    const cx = p.impactX;
    const cy = p.impactY;
    if (p.hit) {
        if (run.hm && p.craterCols) applyCraterDiff(run.hm, p.craterCols);
        run.explosion = { x: cx, y: cy, radius: C.BLAST_RADIUS, t: 0, duration: 700 };
        run.cameraShake = 14;
        spawnDust(run, cx, cy, 40);
        run.play("hit");
    } else {
        run.explosion = { x: p.x, y: Math.max(0, p.y), radius: 2, t: 0, duration: 450 };
        run.play("miss");
    }
    if (p.damages) {
        for (const [id, hp] of p.damages) {
            const t = run.players.find((q) => q.id === id);
            if (t) t.hp = hp;
        }
    }
    if (p.dead) {
        for (const id of p.dead) {
            const t = run.players.find((q) => q.id === id);
            if (t) {
                t.alive = false;
                run.play("die");
                spawnDust(run, t.x, heightAt(run.hm, t.x) + 1, 30);
            }
        }
    }
    if (p.nextTurn != null) run.turn = p.nextTurn;
    else if (p.over) run.turn = null;
    updateHudPlayers(run);
}

function spawnDust(run, x, y, count) {
    const palette = ["#b08050", "#7d5a35", "#d0a070", "#5a3e22"];
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI;
        const speed = 6 + Math.random() * 10;
        run.particles.push({
            x,
            y,
            vx: Math.cos(a) * speed * (Math.random() < 0.5 ? -1 : 1),
            vy: Math.sin(a) * speed + 4,
            life: 500 + Math.random() * 600,
            maxLife: 1100,
            color: palette[Math.floor(Math.random() * palette.length)],
        });
    }
}

// ─── World / canvas mapping ─────────────────────────────────────────────

function viewPadding() {
    return 40;
}

function viewScale(view) {
    const pad = viewPadding();
    const w = view.width();
    const h = view.height();
    return Math.min(
        (w - pad * 2) / C.WORLD_W,
        (h - pad * 2) / (C.MAX_H + 15)
    );
}

function viewOrigin(view) {
    const s = viewScale(view);
    return {
        x: (view.width() - C.WORLD_W * s) / 2,
        y: view.height() - viewPadding(),
    };
}

function worldToCanvas(view, wx, wy) {
    const s = viewScale(view);
    const o = viewOrigin(view);
    return { x: o.x + wx * s, y: o.y - wy * s };
}

// ─── Drawing ────────────────────────────────────────────────────────────

function drawSky(ctx, view) {
    const w = view.width();
    const h = view.height();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1a2a55");
    g.addColorStop(0.6, "#3a3b5c");
    g.addColorStop(1.0, "#4f3a2c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
}

function drawMatch(run, ctx, view) {
    const shake = run.cameraShake;
    ctx.save();
    if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawSky(ctx, view);
    drawTerrain(run, ctx, view);
    drawTanks(run, ctx, view);
    drawAimIndicator(run, ctx, view);
    drawProjectile(run, ctx, view);
    drawExplosion(run, ctx, view);
    drawParticles(run, ctx, view);
    ctx.restore();
}

function drawTerrain(run, ctx, view) {
    if (!run.hm) return;
    const s = viewScale(view);
    const o = viewOrigin(view);
    ctx.fillStyle = "#3a2e1d";
    ctx.strokeStyle = "#6d5a38";
    ctx.lineWidth = Math.max(1, s * 0.15);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    for (let i = 0; i < C.COLS; i++) {
        const wx = (i + 0.5) * C.COL_W;
        const wy = run.hm[i];
        ctx.lineTo(o.x + wx * s, o.y - wy * s);
    }
    ctx.lineTo(o.x + C.WORLD_W * s, o.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5a8a3e";
    for (let i = 0; i < C.COLS; i++) {
        const wx = i * C.COL_W;
        const wy = run.hm[i];
        const p1 = worldToCanvas(view, wx, wy);
        ctx.fillRect(p1.x, p1.y - Math.max(2, s * 0.4), C.COL_W * s + 1, Math.max(2, s * 0.4));
    }
    ctx.stroke();
}

function drawTanks(run, ctx, view) {
    if (!run.hm) return;
    const s = viewScale(view);
    for (const p of run.players) {
        if (!p.alive) continue;
        const gy = heightAt(run.hm, p.x);
        const c = worldToCanvas(view, p.x, gy);
        const w = C.TANK_W * s;
        const h = C.TANK_H * s;
        ctx.fillStyle = p.color;
        ctx.fillRect(c.x - w / 2, c.y - h, w, h);
        ctx.beginPath();
        ctx.arc(c.x, c.y - h, w * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(c.x - w / 2, c.y - h - 10, w, 4);
        ctx.fillStyle = p.hp > 50 ? "#3ecf4a" : (p.hp > 20 ? "#f5b940" : "#e55");
        ctx.fillRect(c.x - w / 2, c.y - h - 10, w * (p.hp / C.HP_MAX), 4);
        ctx.fillStyle = "#fff";
        ctx.font = Math.max(10, s * 0.45) + 'px "Segoe UI", sans-serif';
        ctx.textAlign = "center";
        ctx.fillText(p.name + (p.id === run.turn ? " ◄" : ""), c.x, c.y - h - 14);
    }
    ctx.textAlign = "start";
}

function drawAimIndicator(run, ctx, view) {
    if (!isMyTurn(run) || run.projectile) return;
    const me = myPlayer(run);
    if (!me || !me.alive) return;
    const surfY = heightAt(run.hm, me.x);
    const muzzleLen = C.TANK_W * 0.9;
    const bx = me.x + run.aim.dir * muzzleLen * Math.cos(run.aim.angle);
    const by = surfY + C.TANK_H + muzzleLen * Math.sin(run.aim.angle);
    const b = worldToCanvas(view, bx, by);
    const vx = run.aim.dir * run.aim.power * C.MAX_SPEED * Math.cos(run.aim.angle);
    const vy = run.aim.power * C.MAX_SPEED * Math.sin(run.aim.angle);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    let px = bx;
    let py = by;
    let pvx = vx;
    let pvy = vy;
    const dt = 0.04;
    for (let i = 0; i < 50; i++) {
        px += pvx * dt;
        py += pvy * dt;
        pvy -= C.GRAVITY * dt;
        const cp = worldToCanvas(view, px, py);
        ctx.lineTo(cp.x, cp.y);
        if (px < 0 || px > C.WORLD_W || py < heightAt(run.hm, Math.max(0, Math.min(C.WORLD_W, px)))) break;
    }
    ctx.stroke();
    ctx.restore();
}

function drawProjectile(run, ctx, view) {
    if (!run.projectile) return;
    const p = run.projectile;
    const c = worldToCanvas(view, p.x, p.y);
    ctx.fillStyle = "#fff5b0";
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(2, viewScale(view) * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 210, 90, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < p.trail.length; i += 2) {
        const t = worldToCanvas(view, p.trail[i], p.trail[i + 1]);
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
    }
    ctx.stroke();
}

function drawExplosion(run, ctx, view) {
    if (!run.explosion) return;
    const e = run.explosion;
    const c = worldToCanvas(view, e.x, e.y);
    const s = viewScale(view);
    const r = e.radius * s * (1 - e.t * 0.5);
    ctx.save();
    ctx.globalAlpha = 1 - e.t;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    g.addColorStop(0.0, "rgba(255, 240, 140, 1)");
    g.addColorStop(0.4, "rgba(255, 120, 30, 0.9)");
    g.addColorStop(1.0, "rgba(90, 30, 10, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(3, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawParticles(run, ctx, view) {
    const s = viewScale(view);
    for (const p of run.particles) {
        const c = worldToCanvas(view, p.x, p.y);
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(c.x - 1, c.y - 1, 2 + s * 0.15, 2 + s * 0.15);
    }
    ctx.globalAlpha = 1;
}
