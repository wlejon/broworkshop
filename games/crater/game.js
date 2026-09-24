// Crater — multiplayer artillery client on the arcade shell.
//
// The server (server.js → match.js) owns the roster, turns, terrain and the
// shot simulation; this client connects with lib/netroom.js, shows the lobby,
// sends aim + fire, and animates what the server reports. Terrain physics is
// shared.js, the same module the server runs, so a crater diff applied here
// reproduces the server's heightmap exactly.
//
//   game.js   plugin, connection, lobby flow, the local shell animation
//   draw.js   canvas rendering
//   ui.js     lobby roster, HUD player list, toast
//
// A run is one connection: connecting → lobby → match → gameover → lobby ...

import { NetRoom } from "/lib/netroom.js";
import { connectForm } from "/lib/arcade/netplay.js";
import { C, heightAt, applyCraterDiff } from "/app/shared.js";
import { drawSky, drawMatch } from "/app/draw.js";
import { renderLobby, renderPlayers, toast } from "/app/ui.js";

const DEFAULT_ADDRESS = "127.0.0.1:27100";
const AIM_RATE = 0.8;           // rad/s while Up/Down is held
const POWER_RATE = 0.5;         // per second while Q/E is held
const DUST = ["#b08050", "#7d5a35", "#d0a070", "#5a3e22"];

let form = null;
let shell = null;
let current = null;

/** The live run (tests read it; the shell owns it). */
export const currentRun = () => current;

export const game = {
    id: "crater",
    clearColor: "#06070b",
    defaults: { name: "Player", address: DEFAULT_ADDRESS },
    actions: [
        { name: "power_down", label: "Power Down", defaults: ["q"] },
        { name: "power_up", label: "Power Up", defaults: ["e"] },
        // primary = fire (Space); left/right = direction; up/down = angle
    ],

    create(api) {
        shell = api;
        const join = form.read(api.save);
        form.clearError();
        const run = current = newRun(api);
        try {
            run.client = NetRoom.join({
                address: join.address,
                name: join.name,
                onDisconnect: () => lost(run, "Disconnected from server"),
                onMessage: (tag, msg) => onServer(run, tag, msg),
            });
        } catch (e) {
            form.error(e.message || String(e));
            run.phase = "failed";
        }
        return run;
    },

    update(run, dt, input) {
        if (run.phase === "failed") return { status: "screen", name: "title" };
        if (run.phase === "connecting" || run.phase === "lobby") return { status: "screen", name: "lobby" };
        if (run.phase === "gameover") return { status: "gameover", result: run.winner };
        if (run.phase === "match") tickMatch(run, dt, input);
    },

    draw(run, ctx, view) {
        if (run.phase === "match" || run.phase === "gameover") drawMatch(matchView(run), ctx, view);
        else drawSky(ctx, view);
    },

    drawTitle(ctx, view) {
        drawSky(ctx, view);
    },

    hud(run) {
        if (!run || run.phase !== "match") return { turn: "Waiting…", angle: "45", power: "50", dir: "→" };
        const t = run.players.find((p) => p.id === run.turn);
        return {
            turn: t ? "Turn: " + t.name + (t.id === run.myId ? " (YOU)" : "") : "Waiting…",
            angle: (run.aim.angle * 180 / Math.PI).toFixed(0),
            power: String(Math.round(run.aim.power * 100)),
            dir: run.aim.dir > 0 ? "→" : "←",
        };
    },

    gameOverText(run, result) {
        const msg = result || (run && run.winner) || {};
        const title = document.getElementById("gameover-title");
        if (msg.winnerId == null) title.textContent = "Draw";
        else title.textContent = run && msg.winnerId === run.myId ? "Victory!" : "Defeated";
        return msg.winnerName ? msg.winnerName + " wins the match." : "All tanks destroyed.";
    },

    onEnterScreen(name, run, api) {
        shell = api;
        if (!form) {
            form = connectForm({
                name: "#in-name", address: "#in-address", error: "#title-error",
                defaults: { address: DEFAULT_ADDRESS }, maxName: 14,
            });
        }
        if (name === "title") {
            form.fill(api.save);
            if (run && run.client) closeRun(run);
        }
        if (name === "lobby") {
            // The shell keeps the HUD up on mid-run screens; the lobby has no match to show.
            const hud = document.getElementById("hud");
            hud.hidden = true;
            hud.style.display = "none";
            if (run) renderLobby(run.lobby, run.myId);
        }
    },

    onMenuAction(action, run) {
        if (action === "connect") return { startRun: true };
        if (!run || !run.client) return null;
        switch (action) {
            case "ready": {
                const me = run.lobby.entries.find((p) => p.id === run.myId);
                run.client.send("ready", { ready: !(me && me.ready) });
                return null;
            }
            case "bot":
                run.client.send("addBot");
                return null;
            case "start":
                run.client.send("start");
                return null;
            case "leave":
                closeRun(run);
                return "title";
            case "lobby":
                run.phase = "lobby";
                return "lobby";
        }
        return null;
    },

    cue(name, audio) {
        switch (name) {
            case "aim": audio.tone(280, 0.02, "sine", 0.15); break;
            case "fire": audio.sequence([[200, 0.07, "sawtooth", 0.5], [140, 0.15, "triangle", 0.5]]); break;
            case "hit": audio.sequence([[90, 0.12, "square", 0.8], [60, 0.35, "sawtooth", 0.7]]); break;
            case "miss": audio.tone(180, 0.2, "triangle", 0.35); break;
            case "die":
                audio.sequence([[220, 0.1, "sawtooth", 0.5], [180, 0.1, "sawtooth", 0.5], [120, 0.4, "sawtooth", 0.6]]);
                break;
            case "win":
                audio.sequence([[523, 0.1, "square", 0.6], [659, 0.1, "square", 0.7],
                                [784, 0.15, "square", 0.8], [1047, 0.25, "square", 0.8]]);
                break;
        }
    },
};

// ── Run / connection ─────────────────────────────────────────────────────

function newRun(api) {
    return {
        phase: "connecting",    // connecting | lobby | match | gameover | failed
        client: null,
        myId: null,
        lobby: { hostId: null, entries: [] },
        hm: null,
        players: [],
        turn: null,
        aim: { angle: Math.PI / 4, power: 0.5, dir: 1 },
        projectile: null,
        explosion: null,
        particles: [],
        cameraShake: 0,
        winner: null,
        score: 0,
        play: api.play,
    };
}

/** What draw.js needs from a run, plus the aim-preview gate. */
function matchView(run) {
    run.showAim = isMyTurn(run) && !run.projectile;
    return run;
}

function closeRun(run) {
    if (run.client) run.client.close();
    run.client = null;
    run.myId = null;
    run.phase = "connecting";
    run.projectile = null;
}

function lost(run, why) {
    run.client = null;
    run.phase = "failed";
    form.error(why);
    if (shell && shell.getScreen() !== "title") shell.switchTo("title");
}

function onServer(run, tag, msg) {
    switch (tag) {
        case "welcome":
            run.myId = msg.id;
            break;
        case "denied":
            closeRun(run);
            lost(run, msg.reason || "Connection denied");
            break;
        case "state":
            if (msg.phase === "match") onRoster(run, msg);
            else onLobby(run, msg);
            break;
        case "match":
            onMatchStart(run, msg);
            break;
        case "shot":
            onShot(run, msg);
            break;
        case "skip":
            run.turn = msg.nextTurn;
            renderPlayers(run.players, run.turn, run.myId);
            toast("Turn skipped (timeout)");
            break;
        case "over":
            onGameOver(run, msg);
            break;
    }
}

function onLobby(run, msg) {
    run.phase = "lobby";
    run.lobby.hostId = msg.hostId;
    run.lobby.entries = msg.players;
    renderLobby(run.lobby, run.myId);
    const screen = shell.getScreen();
    if (screen !== "lobby" && screen !== "gameover") shell.switchTo("lobby");
}

/** Mid-match roster change (someone left): take the server's players and turn. */
function onRoster(run, msg) {
    run.players = msg.players.map((p) => Object.assign({}, p));
    run.turn = msg.turn;
    renderPlayers(run.players, run.turn, run.myId);
}

function onMatchStart(run, msg) {
    Object.assign(run, {
        phase: "match",
        hm: new Float32Array(msg.hm),
        players: msg.players.map((p) => Object.assign({}, p)),
        turn: msg.turn,
        projectile: null, explosion: null, winner: null,
    });
    run.particles.length = 0;
    renderPlayers(run.players, run.turn, run.myId);
    shell.switchTo("playing");
}

function onShot(run, msg) {
    if (run.phase !== "match") return;
    if (run.projectile) detonate(run, run.projectile);       // a late shell lands now
    run.projectile = Object.assign({}, msg, {
        x: msg.originX, y: msg.originY, flown: 0, sinceTrail: 0,
        trail: [msg.originX, msg.originY],
    });
    run.play("fire");
}

function onGameOver(run, msg) {
    if (run.projectile) { detonate(run, run.projectile); run.projectile = null; }
    run.phase = "gameover";
    run.winner = msg;
    if (msg.winnerId != null && msg.winnerId === run.myId) run.play("win");
}

// ── Match (visual only; the server already decided everything) ──────────

function isMyTurn(run) {
    return run.phase === "match" && run.turn === run.myId;
}

function tickMatch(run, dt, input) {
    const dts = dt / 1000;
    run.cameraShake = Math.max(0, run.cameraShake - dt * 0.15);

    const p = run.projectile;
    if (p) {
        for (let i = 0, h = dts / 4; i < 4; i++) {
            p.x += p.vx * h;
            p.y += p.vy * h;
            p.vy -= C.GRAVITY * h;
            p.flown += h;
        }
        if ((p.sinceTrail += dt) > 30) {
            p.trail.push(p.x, p.y);
            if (p.trail.length > 80) p.trail.splice(0, 2);
            p.sinceTrail = 0;
        }
        if (p.flown * 1000 >= p.flightMs) {
            detonate(run, p);
            run.projectile = null;
        }
    }

    if (run.explosion && (run.explosion.t += dt / run.explosion.duration) >= 1) run.explosion = null;

    const parts = run.particles;
    for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        if ((q.life -= dt) <= 0) { parts.splice(i, 1); continue; }
        q.x += q.vx * dts;
        q.y += q.vy * dts;
        q.vy -= 15 * dts;
    }

    if (!isMyTurn(run) || run.projectile) return;
    const aim = run.aim;
    if (input.down("left")) aim.dir = -1;
    if (input.down("right")) aim.dir = 1;
    if (input.down("up")) aim.angle = Math.min(Math.PI / 2 - 0.02, aim.angle + AIM_RATE * dts);
    if (input.down("down")) aim.angle = Math.max(0.02, aim.angle - AIM_RATE * dts);
    if (input.down("power_up")) aim.power = Math.min(1, aim.power + POWER_RATE * dts);
    if (input.down("power_down")) aim.power = Math.max(0.05, aim.power - POWER_RATE * dts);
    if (input.pressed("primary")) run.client.send("fire", { angle: aim.angle, power: aim.power, dir: aim.dir });
}

/** The shell lands: apply the server's crater, damage and deaths. */
function detonate(run, p) {
    if (p.hit) {
        if (run.hm && p.craterCols) applyCraterDiff(run.hm, p.craterCols);
        run.explosion = { x: p.impactX, y: p.impactY, radius: C.BLAST_RADIUS, t: 0, duration: 700 };
        run.cameraShake = 14;
        spawnDust(run, p.impactX, p.impactY, 40);
        run.play("hit");
    } else {
        run.explosion = { x: p.x, y: Math.max(0, p.y), radius: 2, t: 0, duration: 450 };
        run.play("miss");
    }
    for (const [id, hp] of p.damages || []) {
        const t = run.players.find((q) => q.id === id);
        if (t) t.hp = hp;
    }
    for (const id of p.dead || []) {
        const t = run.players.find((q) => q.id === id);
        if (!t) continue;
        t.alive = false;
        run.play("die");
        spawnDust(run, t.x, heightAt(run.hm, t.x) + 1, 30);
    }
    if (p.nextTurn != null) run.turn = p.nextTurn;
    else run.turn = null;
    renderPlayers(run.players, run.turn, run.myId);
}

function spawnDust(run, x, y, count) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI;
        const speed = 6 + Math.random() * 10;
        run.particles.push({
            x, y,
            vx: Math.cos(a) * speed * (Math.random() < 0.5 ? -1 : 1),
            vy: Math.sin(a) * speed + 4,
            life: 500 + Math.random() * 600,
            maxLife: 1100,
            color: DUST[Math.floor(Math.random() * DUST.length)],
        });
    }
}
