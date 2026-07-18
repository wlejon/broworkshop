// game.js — a playable lander with NO pause flag anywhere in it.
//
// This is the thesis of the whole app made concrete. Search this file for
// "paused" and you will find it exactly twice: once to draw an overlay, once to
// label a button. The simulation never reads it. Pausing this game is
//
//     bro.time.paused = true
//
// and nothing else. Slow motion is `bro.time.scale = 0.3` and nothing else.
//
// It works because every single thing that moves here is a function of the
// ENGINE'S SCALED CLOCK rather than of wall time:
//
//   - the flight integrator takes its dt from the rAF timestamp, which is
//     scaled, and while paused rAF callbacks are skipped entirely, so `step()`
//     is not called at all — not called with dt 0, not called and early-returned
//   - the post-crash respawn is a setTimeout, whose deadline is scaled
//   - the landing-pad beacon is a setInterval, likewise
//   - the fuel burn is per-dt, so it stops with everything else
//
// Nothing in this file needs to know pause exists for all four to freeze
// together and resume in step. That is the whole point: not one flag threaded
// through one loop, but every clock in the process moving as one.
//
// For contrast, all 32 games in ../../games use their own run-state flags and
// none of them touches bro.time at all — each one re-implements a partial
// version of this, and none of them gets timers, CSS and audio for free.
//
// The one deliberate exception is the slow-mo powerup ramp at the bottom, and
// the reason it is an exception is itself interesting — see the comment there.

import { setScale, rampScale } from "/app/time.js";

const canvas = document.getElementById('gameStage');
const ctx = canvas.getContext('2d');
const hudEl = document.getElementById('gameHud');
const statusEl = document.getElementById('gameStatus');

const W = canvas.width, H = canvas.height;

// Physics in units of px and seconds. Gravity is gentle enough that a landing
// is achievable without a tutorial but firm enough that slow-mo is visibly
// useful on final approach.
const GRAVITY = 42;
const THRUST = 96;
const ROT_SPEED = 2.4;
const FUEL_BURN = 13;
const SAFE_VY = 26;          // max descent rate for a good landing
const SAFE_ANGLE = 0.30;     // max tilt, radians

// The pad sits on a fixed ledge; terrain either side is a deterministic
// zig-zag, generated once so that every run — and every headless replay — is
// bit-identical.
const PAD_X = 400, PAD_W = 92;
const PAD_Y = H - 34;

const terrain = buildTerrain();

function buildTerrain() {
    const pts = [];
    let x = 0, y = H - 20;
    // A tiny LCG rather than Math.random: the test compares exact state, so the
    // world must be the same on every run of the process.
    let seed = 20260718;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    while (x < W) {
        pts.push([x, y]);
        x += 26 + Math.floor(rnd() * 22);
        y = H - 14 - Math.floor(rnd() * 46);
        // Flatten the ledge the pad sits on.
        if (x > PAD_X - 40 && x < PAD_X + PAD_W + 40) y = PAD_Y;
    }
    pts.push([W, H - 24]);
    return pts;
}

// --- state -------------------------------------------------------------------
//
// Exported whole so the smoke test can snapshot it and compare exactly. There
// is no `paused` member and there is no `running` member: this object describes
// a lander, not a scheduler.

export const game = {
    x: 70, y: 34,
    vx: 26, vy: 0,
    angle: 0.35,
    fuel: 100,
    status: 'flying',        // 'flying' | 'landed' | 'crashed'
    landings: 0, crashes: 0, attempts: 1,
    airborneMs: 0,           // SCALED ms this attempt has lasted
    // Monotonic total of scaled dt, never reset by a crash. This is the number
    // the smoke test measures against: at 0.25x it accrues a quarter as fast
    // per advanceTime, and while paused it does not move at all.
    simMs: 0,
    beacon: 0,               // blink counter, driven by a scaled setInterval
    respawns: 0,             // completed scaled setTimeout respawns
    thrusting: false,
    frames: 0,
};

const input = { left: false, right: false, thrust: false };

/** Exact, order-stable serialization of everything the simulation owns.
 *  The test asserts this string is character-identical across a pause. */
export function snapshot() {
    return JSON.stringify([
        game.x, game.y, game.vx, game.vy, game.angle, game.fuel,
        game.status, game.landings, game.crashes, game.attempts,
        game.airborneMs, game.simMs, game.beacon, game.respawns, game.frames,
        game.thrusting,
    ]);
}

export function resetShip(full) {
    game.x = 70; game.y = 34;
    game.vx = 26; game.vy = 0;
    game.angle = 0.35;
    game.fuel = 100;
    game.status = 'flying';
    game.airborneMs = 0;
    game.thrusting = false;
    if (full) {
        game.landings = game.crashes = game.respawns = 0;
        game.attempts = 1;
        game.frames = 0;
        game.simMs = 0;
    }
    return game;
}

// --- simulation --------------------------------------------------------------

function groundAt(x) {
    for (let i = 0; i < terrain.length - 1; i++) {
        const [x0, y0] = terrain[i], [x1, y1] = terrain[i + 1];
        if (x >= x0 && x <= x1) {
            const t = (x - x0) / Math.max(1e-6, x1 - x0);
            return y0 + (y1 - y0) * t;
        }
    }
    return H - 20;
}

/**
 * One integration step. `dtSec` came from the rAF timestamp, so it is already
 * scaled — at 0.3x this is called just as often but with a third of the dt, and
 * while paused it is not called at all. No branch in here knows that.
 */
function step(dtSec) {
    game.frames++;
    game.simMs += dtSec * 1000;
    if (game.status !== 'flying') return;

    game.airborneMs += dtSec * 1000;

    if (input.left) game.angle -= ROT_SPEED * dtSec;
    if (input.right) game.angle += ROT_SPEED * dtSec;

    game.thrusting = input.thrust && game.fuel > 0;
    if (game.thrusting) {
        game.vx += Math.sin(game.angle) * THRUST * dtSec;
        game.vy -= Math.cos(game.angle) * THRUST * dtSec;
        game.fuel = Math.max(0, game.fuel - FUEL_BURN * dtSec);
    }

    game.vy += GRAVITY * dtSec;
    game.x += game.vx * dtSec;
    game.y += game.vy * dtSec;

    // Walls bounce so an unattended ship stays on screen and keeps the test's
    // state evolving rather than parking against an edge.
    if (game.x < 8) { game.x = 8; game.vx = Math.abs(game.vx) * 0.6; }
    if (game.x > W - 8) { game.x = W - 8; game.vx = -Math.abs(game.vx) * 0.6; }
    if (game.y < 8) { game.y = 8; game.vy = Math.abs(game.vy) * 0.4; }

    const ground = groundAt(game.x);
    if (game.y >= ground - 7) {
        game.y = ground - 7;
        const onPad = game.x > PAD_X && game.x < PAD_X + PAD_W;
        const gentle = game.vy < SAFE_VY && Math.abs(game.angle) < SAFE_ANGLE
                       && Math.abs(game.vx) < 22;
        if (onPad && gentle) { game.status = 'landed'; game.landings++; }
        else { game.status = 'crashed'; game.crashes++; }
        game.vx = game.vy = 0;
        scheduleRespawn();
    }
}

// A SCALED timeout. Pause during the crash pause and the respawn waits with
// you; drop to 0.25x and the wait becomes four wall seconds. Neither behaviour
// needed a line of code here.
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

// A SCALED interval — the pad beacon. Freezes with the pause, blinks at a
// quarter rate in bullet time.
setInterval(() => { game.beacon++; }, 500);

// --- render ------------------------------------------------------------------

function render() {
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);

    // stars — static, so they cost nothing and read as depth
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 40; i++) {
        const sx = (i * 137) % W, sy = (i * 71) % (H - 60);
        ctx.fillRect(sx, sy, 1, 1);
    }

    // terrain
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

    // pad, with the beacon blinking off the scaled interval
    const lit = game.beacon % 2 === 0;
    ctx.fillStyle = lit ? '#22c55e' : '#14532d';
    ctx.fillRect(PAD_X, PAD_Y - 3, PAD_W, 4);
    ctx.fillStyle = lit ? 'rgba(34,197,94,0.22)' : 'rgba(34,197,94,0.07)';
    ctx.fillRect(PAD_X, PAD_Y - 22, PAD_W, 20);

    // ship
    ctx.save();
    ctx.translate(game.x, game.y);
    ctx.rotate(game.angle);

    if (game.thrusting) {
        // Flame length wobbles on the beacon counter rather than on wall time,
        // so even the decorative flicker stops with the pause.
        const fl = 10 + (game.beacon % 3) * 3;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(-4, 7); ctx.lineTo(4, 7); ctx.lineTo(0, 7 + fl);
        ctx.closePath(); ctx.fill();
    }

    ctx.fillStyle = game.status === 'crashed' ? '#ef4444'
                  : game.status === 'landed' ? '#22c55e' : '#cfd8e6';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(7, 7); ctx.lineTo(-7, 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // descent-rate tape: green while a landing would be survivable
    const safe = game.vy < SAFE_VY && Math.abs(game.angle) < SAFE_ANGLE;
    ctx.fillStyle = safe ? '#22c55e' : '#ef4444';
    ctx.fillRect(W - 12, H - 12 - Math.min(70, Math.abs(game.vy)), 5,
                 Math.min(70, Math.abs(game.vy)));

    if (bro.time.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffd479';
        ctx.font = 'bold 15px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED — and this file has no pause flag', W / 2, H / 2 - 6);
        ctx.font = '11px system-ui';
        ctx.fillStyle = '#c9d3e2';
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

/** Called from the app's single rAF with the rAF timestamp — i.e. with scaled
 *  engine time. Never called while paused, because rAF is skipped then. */
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
    const st = game.status === 'flying'
        ? (game.thrusting ? 'burning' : 'coasting')
        : game.status;
    statusEl.textContent = st;
    statusEl.className = 'v ' + (game.status === 'landed' ? 'good'
                              : game.status === 'crashed' ? 'bad' : '');

    hudEl.textContent =
        `altitude    ${Math.max(0, groundAt(game.x) - game.y - 7).toFixed(0)} px\n` +
        `descent     ${game.vy.toFixed(1)} px/s   ` +
            `${game.vy < SAFE_VY ? 'ok' : 'TOO FAST'}\n` +
        `drift       ${game.vx.toFixed(1)} px/s   tilt ${game.angle.toFixed(2)} rad\n` +
        `fuel        ${game.fuel.toFixed(0)}%\n` +
        `attempt     ${game.attempts}   landed ${game.landings}   crashed ${game.crashes}\n` +
        `airborne    ${(game.airborneMs / 1000).toFixed(1)} s scaled  ` +
            `(beacon ${game.beacon}, respawns ${game.respawns})\n` +
        `sim frames  ${game.frames}` +
        (slowmo.active
            ? `\n\nSLOW-MO POWERUP  phase ${slowmo.phase}  ` +
              `${(slowmo.framesLeft / 60).toFixed(1)}s left`
            : '');
}

// --- slow-mo powerup ---------------------------------------------------------
//
// A ramp down to 0.3x, a hold, then a ramp back — proof that timescale is a
// smoothly drivable dial and not just a toggle.
//
// This ramp is the ONE thing in the file deliberately not driven by the scaled
// clock, and the reason is worth stating: a ramp timed in scaled ms slows its
// own recovery down as it works. Ramp to 0.25x over "1000 scaled ms" and the
// return trip takes four wall seconds, accelerating as it goes. So the ramp is
// driven off the FRAME COUNT instead, which is unscaled — rAF's firing cadence
// never changes with timescale, only the timestamp it hands you. That makes the
// effect a fixed wall-clock duration, and (because the cadence is fixed under
// advanceTime too) exactly reproducible in a headless test.
//
// It still stops dead while paused, for free, because rAF is skipped.

const SLOWMO_TARGET = 0.30;
const RAMP_DOWN = 36, HOLD = 90, RAMP_UP = 96;

export const slowmo = {
    active: false,
    phase: 'idle',       // 'down' | 'hold' | 'up' | 'idle'
    framesLeft: 0,
    uses: 0,
    startScale: 1,
};

export function triggerSlowmo() {
    if (slowmo.active) return false;
    slowmo.active = true;
    slowmo.phase = 'down';
    slowmo.framesLeft = RAMP_DOWN;
    slowmo.startScale = bro.time.scale;
    slowmo.uses++;
    return true;
}

export function cancelSlowmo() {
    if (!slowmo.active) return false;
    slowmo.active = false;
    slowmo.phase = 'idle';
    slowmo.framesLeft = 0;
    setScale(slowmo.startScale);
    return true;
}

function tickSlowmo() {
    if (!slowmo.active) return;
    slowmo.framesLeft--;

    const lerp = (a, b, u) => a + (b - a) * u;
    // Smoothstep rather than linear: a linear timescale ramp has a visible
    // corner at each end, and the whole point is that this dial is continuous.
    const ease = (u) => u * u * (3 - 2 * u);

    if (slowmo.phase === 'down') {
        const u = ease(1 - slowmo.framesLeft / RAMP_DOWN);
        rampScale(lerp(slowmo.startScale, SLOWMO_TARGET, u));
        if (slowmo.framesLeft <= 0) { slowmo.phase = 'hold'; slowmo.framesLeft = HOLD; }
    } else if (slowmo.phase === 'hold') {
        if (slowmo.framesLeft <= 0) { slowmo.phase = 'up'; slowmo.framesLeft = RAMP_UP; }
    } else if (slowmo.phase === 'up') {
        const u = ease(1 - slowmo.framesLeft / RAMP_UP);
        rampScale(lerp(SLOWMO_TARGET, slowmo.startScale, u));
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
        case 'ArrowLeft':  case 'a': input.left = down; break;
        case 'ArrowRight': case 'd': input.right = down; break;
        case 'ArrowUp':    case 'w': input.thrust = down; break;
        case 'r': if (down) { resetShip(false); game.attempts++; } break;
        case 'q': if (down) triggerSlowmo(); break;
        default: return;
    }
    ev.preventDefault();
}

export function bindGamePanel() {
    document.addEventListener('keydown', (ev) => key(ev, true));
    document.addEventListener('keyup', (ev) => key(ev, false));

    document.getElementById('gameReset').addEventListener('click', () => {
        resetShip(true);
    });
    document.getElementById('gameSlowmo').addEventListener('click', () => {
        triggerSlowmo();
    });

    // Click-and-hold thrust, so the game is playable without touching the
    // keyboard while the pointer is in the panel.
    canvas.addEventListener('mousedown', () => { input.thrust = true; });
    canvas.addEventListener('mouseup', () => { input.thrust = false; });
    canvas.addEventListener('mouseleave', () => { input.thrust = false; });

    render();
    refreshGameHud();
}

export { input as gameInput };
