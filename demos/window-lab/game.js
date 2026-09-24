// game.js — a playable lander with NO pause flag anywhere in it.
//
// The thesis of the app, made concrete. The simulation never reads
// bro.time.paused (it appears only to draw an overlay). Pausing this game is
//
//     bro.time.paused = true
//
// and nothing else; slow motion is `bro.time.scale = 0.3`. It works because
// everything that moves here is a function of the ENGINE'S SCALED CLOCK:
//
//   - the flight integrator takes dt from the rAF timestamp (scaled), and rAF
//     is skipped entirely while paused, so step() is not called at all
//   - the post-crash respawn is a setTimeout, whose deadline is scaled
//   - the landing-pad beacon is a setInterval, likewise
//   - the fuel burn is per-dt, so it stops with everything else
//
// All 32 games in ../../games use their own run-state flags instead, and none
// of them gets timers, CSS and audio frozen for free.
//
// The one deliberate exception is the slow-mo powerup ramp (see there).

import { readout } from "/lib/kit/index.js";
import { setScale, rampScale } from "/app/time.js";

const W = 560, H = 230;
const GRAVITY = 42, THRUST = 96, ROT_SPEED = 2.4, FUEL_BURN = 13;
const SAFE_VY = 26;          // max descent rate for a good landing
const SAFE_ANGLE = 0.30;     // max tilt, radians
const PAD_X = 400, PAD_W = 92, PAD_Y = H - 34;

let canvas, ctx, hud, statusEl;

// A deterministic zig-zag (tiny LCG, not Math.random): the test compares
// exact state, so the world must be identical on every run.
const terrain = (() => {
    const pts = [];
    let x = 0, y = H - 20, seed = 20260718;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    while (x < W) {
        pts.push([x, y]);
        x += 26 + Math.floor(rnd() * 22);
        y = H - 14 - Math.floor(rnd() * 46);
        if (x > PAD_X - 40 && x < PAD_X + PAD_W + 40) y = PAD_Y;   // the pad's ledge
    }
    pts.push([W, H - 24]);
    return pts;
})();

// --- state -------------------------------------------------------------------
// No `paused` and no `running` member: this object describes a lander, not a scheduler.

export const game = {
    x: 70, y: 34, vx: 26, vy: 0, angle: 0.35, fuel: 100,
    status: 'flying',        // 'flying' | 'landed' | 'crashed'
    landings: 0, crashes: 0, attempts: 1,
    airborneMs: 0,           // SCALED ms this attempt has lasted
    simMs: 0,                // monotonic scaled dt total, never reset by a crash
    beacon: 0,               // blink counter, driven by a scaled setInterval
    respawns: 0,             // completed scaled setTimeout respawns
    thrusting: false,
    frames: 0,
};

export const gameInput = { left: false, right: false, thrust: false };

/** Exact, order-stable serialization of everything the simulation owns. */
export function snapshot() {
    return JSON.stringify([
        game.x, game.y, game.vx, game.vy, game.angle, game.fuel,
        game.status, game.landings, game.crashes, game.attempts,
        game.airborneMs, game.simMs, game.beacon, game.respawns, game.frames,
        game.thrusting,
    ]);
}

export function resetShip(full) {
    Object.assign(game, { x: 70, y: 34, vx: 26, vy: 0, angle: 0.35, fuel: 100,
                          status: 'flying', airborneMs: 0, thrusting: false });
    if (full) Object.assign(game, { landings: 0, crashes: 0, respawns: 0, attempts: 1, frames: 0, simMs: 0 });
    return game;
}

// --- simulation --------------------------------------------------------------

function groundAt(x) {
    for (let i = 0; i < terrain.length - 1; i++) {
        const [x0, y0] = terrain[i], [x1, y1] = terrain[i + 1];
        if (x >= x0 && x <= x1) return y0 + (y1 - y0) * (x - x0) / Math.max(1e-6, x1 - x0);
    }
    return H - 20;
}

/** One integration step; dt came from the rAF timestamp, so it is already scaled. */
function step(dt) {
    game.frames++;
    game.simMs += dt * 1000;
    if (game.status !== 'flying') return;
    game.airborneMs += dt * 1000;

    if (gameInput.left) game.angle -= ROT_SPEED * dt;
    if (gameInput.right) game.angle += ROT_SPEED * dt;

    game.thrusting = gameInput.thrust && game.fuel > 0;
    if (game.thrusting) {
        game.vx += Math.sin(game.angle) * THRUST * dt;
        game.vy -= Math.cos(game.angle) * THRUST * dt;
        game.fuel = Math.max(0, game.fuel - FUEL_BURN * dt);
    }
    game.vy += GRAVITY * dt;
    game.x += game.vx * dt;
    game.y += game.vy * dt;

    // Walls bounce, so an unattended ship stays on screen and keeps evolving.
    if (game.x < 8) { game.x = 8; game.vx = Math.abs(game.vx) * 0.6; }
    if (game.x > W - 8) { game.x = W - 8; game.vx = -Math.abs(game.vx) * 0.6; }
    if (game.y < 8) { game.y = 8; game.vy = Math.abs(game.vy) * 0.4; }

    const ground = groundAt(game.x);
    if (game.y >= ground - 7) {
        game.y = ground - 7;
        const onPad = game.x > PAD_X && game.x < PAD_X + PAD_W;
        const gentle = game.vy < SAFE_VY && Math.abs(game.angle) < SAFE_ANGLE && Math.abs(game.vx) < 22;
        if (onPad && gentle) { game.status = 'landed'; game.landings++; }
        else { game.status = 'crashed'; game.crashes++; }
        game.vx = game.vy = 0;
        scheduleRespawn();
    }
}

// A SCALED timeout: pause during the crash wait and the respawn waits with you.
let respawnTimer = null;
function scheduleRespawn() {
    if (respawnTimer !== null) return;
    respawnTimer = setTimeout(() => {
        respawnTimer = null;
        game.respawns++;
        game.attempts++;
        resetShip(false);
    }, 1400);
}

// A SCALED interval: the pad beacon freezes with the pause.
setInterval(() => { game.beacon++; }, 500);

// --- render ------------------------------------------------------------------

function render() {
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.16)';                  // static stars
    for (let i = 0; i < 40; i++) ctx.fillRect((i * 137) % W, (i * 71) % (H - 60), 1, 1);

    ctx.beginPath();
    ctx.moveTo(0, H);
    for (const [x, y] of terrain) ctx.lineTo(x, y);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = '#12161d';
    ctx.fill();
    ctx.strokeStyle = '#2d3a4a';
    ctx.lineWidth = 1;
    ctx.stroke();

    const lit = game.beacon % 2 === 0;                          // beacon off the scaled interval
    ctx.fillStyle = lit ? '#22c55e' : '#14532d';
    ctx.fillRect(PAD_X, PAD_Y - 3, PAD_W, 4);
    ctx.fillStyle = lit ? 'rgba(34,197,94,0.22)' : 'rgba(34,197,94,0.07)';
    ctx.fillRect(PAD_X, PAD_Y - 22, PAD_W, 20);

    ctx.save();
    ctx.translate(game.x, game.y);
    ctx.rotate(game.angle);
    if (game.thrusting) {
        const fl = 10 + (game.beacon % 3) * 3;                  // flicker on the scaled counter too
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.moveTo(-4, 7); ctx.lineTo(4, 7); ctx.lineTo(0, 7 + fl); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = game.status === 'crashed' ? '#ef4444' : game.status === 'landed' ? '#22c55e' : '#cfd8e6';
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 7); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
    ctx.restore();

    const safe = game.vy < SAFE_VY && Math.abs(game.angle) < SAFE_ANGLE;   // descent tape
    const tape = Math.min(70, Math.abs(game.vy));
    ctx.fillStyle = safe ? '#22c55e' : '#ef4444';
    ctx.fillRect(W - 12, H - 12 - tape, 5, tape);

    if (bro.time.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd479';
        ctx.font = 'bold 15px system-ui';
        ctx.fillText('PAUSED — and this file has no pause flag', W / 2, H / 2 - 6);
        ctx.fillStyle = '#c9d3e2';
        ctx.font = '11px system-ui';
        ctx.fillText('bro.time.paused = true is the entire implementation', W / 2, H / 2 + 14);
    } else if (bro.time.scale !== 1) {
        ctx.fillStyle = '#9fd6ff';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(bro.time.scale.toFixed(2) + '×', 8, 16);
    }
}

// --- per-frame hook ----------------------------------------------------------

let lastT = null;

/** Called from the app's rAF with scaled engine time; never called while paused. */
export function tickGame(t) {
    if (lastT === null) lastT = t;
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    tickSlowmo();
    step(dt);
    render();
    refreshGameHud();
}

export function refreshGameHud() {
    statusEl.textContent = game.status === 'flying' ? (game.thrusting ? 'burning' : 'coasting') : game.status;
    statusEl.className = game.status === 'landed' ? 'ok' : game.status === 'crashed' ? 'err' : '';
    hud.set({
        altitude: Math.max(0, groundAt(game.x) - game.y - 7).toFixed(0) + ' px',
        descent: `${game.vy.toFixed(1)} px/s  ${game.vy < SAFE_VY ? 'ok' : 'TOO FAST'}`,
        drift: `${game.vx.toFixed(1)} px/s  tilt ${game.angle.toFixed(2)} rad`,
        fuel: game.fuel.toFixed(0) + '%',
        attempt: `${game.attempts}  landed ${game.landings}  crashed ${game.crashes}`,
        airborne: `${(game.airborneMs / 1000).toFixed(1)} s scaled`,
        timers: `beacon ${game.beacon}  respawns ${game.respawns}  frames ${game.frames}`,
        slowmo: slowmo.active ? `${slowmo.phase}, ${(slowmo.framesLeft / 60).toFixed(1)} s left` : 'idle',
    });
}

// --- slow-mo powerup ---------------------------------------------------------
//
// A smoothstep ramp down to 0.3x, a hold, then back: timescale is a continuously
// drivable dial, not a toggle.
//
// The ramp is the ONE thing here not driven by the scaled clock, because a
// ramp timed in scaled ms slows its own recovery down as it works. It is
// clocked off the FRAME COUNT instead: rAF's cadence never changes with
// timescale, only the timestamp it hands you. So the effect lasts a fixed wall
// duration, replays exactly under headless advanceTime, and still stops dead
// while paused (rAF is skipped).

const SLOWMO_TARGET = 0.30;
const RAMP_DOWN = 36, HOLD = 90, RAMP_UP = 96;

export const slowmo = { active: false, phase: 'idle', framesLeft: 0, uses: 0, startScale: 1 };

export function triggerSlowmo() {
    if (slowmo.active) return false;
    Object.assign(slowmo, { active: true, phase: 'down', framesLeft: RAMP_DOWN, startScale: bro.time.scale });
    slowmo.uses++;
    return true;
}

export function cancelSlowmo() {
    if (!slowmo.active) return false;
    Object.assign(slowmo, { active: false, phase: 'idle', framesLeft: 0 });
    setScale(slowmo.startScale);
    return true;
}

function tickSlowmo() {
    if (!slowmo.active) return;
    slowmo.framesLeft--;
    const lerp = (a, b, u) => a + (b - a) * u;
    const ease = (u) => u * u * (3 - 2 * u);     // no visible corner at either end
    if (slowmo.phase === 'down') {
        rampScale(lerp(slowmo.startScale, SLOWMO_TARGET, ease(1 - slowmo.framesLeft / RAMP_DOWN)));
        if (slowmo.framesLeft <= 0) { slowmo.phase = 'hold'; slowmo.framesLeft = HOLD; }
    } else if (slowmo.phase === 'hold') {
        if (slowmo.framesLeft <= 0) { slowmo.phase = 'up'; slowmo.framesLeft = RAMP_UP; }
    } else if (slowmo.phase === 'up') {
        rampScale(lerp(SLOWMO_TARGET, slowmo.startScale, ease(1 - slowmo.framesLeft / RAMP_UP)));
        if (slowmo.framesLeft <= 0) {
            setScale(slowmo.startScale);
            slowmo.active = false;
            slowmo.phase = 'idle';
        }
    }
}

// --- input -------------------------------------------------------------------

function key(ev, down) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    switch (ev.key) {
        case 'ArrowLeft':  case 'a': gameInput.left = down; break;
        case 'ArrowRight': case 'd': gameInput.right = down; break;
        case 'ArrowUp':    case 'w': gameInput.thrust = down; break;
        case 'r': if (down) { resetShip(false); game.attempts++; } break;
        case 'q': if (down) triggerSlowmo(); break;
        default: return;
    }
    ev.preventDefault();
}

export function bindGamePanel() {
    canvas = document.getElementById('gameStage');
    ctx = canvas.getContext('2d');
    statusEl = document.getElementById('gameStatus');
    hud = readout('#gameHud', {
        altitude: 'altitude', descent: 'descent', drift: 'drift', fuel: 'fuel',
        attempt: 'attempt', airborne: 'airborne', timers: 'timers', slowmo: 'slow-mo',
    });

    document.addEventListener('keydown', (ev) => key(ev, true));
    document.addEventListener('keyup', (ev) => key(ev, false));
    document.getElementById('gameReset').addEventListener('click', () => resetShip(true));
    document.getElementById('gameSlowmo').addEventListener('click', () => triggerSlowmo());

    // Click-and-hold thrust, so the game is playable with the pointer alone.
    canvas.addEventListener('mousedown', () => { gameInput.thrust = true; });
    canvas.addEventListener('mouseup', () => { gameInput.thrust = false; });
    canvas.addEventListener('mouseleave', () => { gameInput.thrust = false; });

    render();
    refreshGameHud();
}
