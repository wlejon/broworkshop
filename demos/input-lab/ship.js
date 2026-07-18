// ship.js — a small playable target so the action panel isn't abstract.
//
// Every input this thing takes is a getActionStrength() read. Nothing polls a
// key, nothing listens for an event. That means the SAME four lines of physics
// behave differently depending only on what is bound: a key snaps the ship to
// full thrust, a stick eases it in, and a trigger gives you a throttle. If the
// analog path were secretly quantised to 0/1 the two would be
// indistinguishable — so the strip chart at the bottom plots the raw thrust
// strength over the last few seconds, where a keyboard draws square waves and
// a stick draws curves.

import { strength } from '/app/actions.js';

const W = 560, H = 300;
const CHART_H = 54;            // strip chart occupies the bottom band
const PLAY_H = H - CHART_H;

export const ship = {
    x: W / 2, y: PLAY_H / 2,
    vx: 0, vy: 0,
    angle: -Math.PI / 2,
    shots: [],
    firedCount: 0,
    // Rolling history of the thrust strength, one sample per frame.
    history: new Array(180).fill(0),
    lastInputs: { thrust: 0, brake: 0, turn: 0, boost: 0, fire: 0 },
};

let canvas, ctx, readoutEl, fireLatch = false;

// The readout rows are built once and only their values are rewritten. A
// per-frame innerHTML rebuild lays the whole block out again every frame and
// leaves the compositor painting a torn mix of the old and new text.
const READOUT_ROWS = ['thrust', 'turn (R − L)', 'brake', 'boost', 'speed px/s', 'shots fired'];
const readoutVals = [];

export function initShip() {
    canvas = document.getElementById('shipCanvas');
    ctx = canvas.getContext('2d');
    readoutEl = document.getElementById('shipReadout');
    readoutEl.innerHTML = READOUT_ROWS.map((k, i) =>
        `<div class="row"><span>${k}</span><b id="sval${i}">0.000</b></div>`).join('');
    for (let i = 0; i < READOUT_ROWS.length; i++) {
        readoutVals.push(document.getElementById('sval' + i));
    }
}

/**
 * Integrate one step. `dt` is seconds. Exported so the smoke test can drive
 * the ship deterministically instead of relying on frame timing.
 */
export function tickShip(dt) {
    const thrust = strength('il_thrust');
    const brake  = strength('il_brake');
    const turnL  = strength('il_left');
    const turnR  = strength('il_right');
    const boost  = strength('il_boost');
    const fire   = strength('il_fire');
    const turn = turnR - turnL;

    ship.lastInputs = { thrust, brake, turn, boost, fire };

    // Turn rate and acceleration scale LINEARLY with strength — the whole
    // point. A half-deflected stick turns at half rate; a key is always 1.
    ship.angle += turn * 3.2 * dt;

    const accel = thrust * (140 + boost * 260);
    ship.vx += Math.cos(ship.angle) * accel * dt;
    ship.vy += Math.sin(ship.angle) * accel * dt;

    // Brake is analog too: a trigger gives partial braking.
    const drag = Math.pow(1 - (0.35 + brake * 2.4) * dt, 1);
    ship.vx *= Math.max(0, drag);
    ship.vy *= Math.max(0, drag);

    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    if (ship.x < 0) ship.x += W; else if (ship.x > W) ship.x -= W;
    if (ship.y < 0) ship.y += PLAY_H; else if (ship.y > PLAY_H) ship.y -= PLAY_H;

    // Fire on the rising edge of the analog value crossing half — which is a
    // trigger's "half-pull doesn't count" behaviour for free.
    if (fire > 0.5 && !fireLatch) {
        fireLatch = true;
        ship.firedCount++;
        ship.shots.push({
            x: ship.x, y: ship.y,
            vx: ship.vx + Math.cos(ship.angle) * 320,
            vy: ship.vy + Math.sin(ship.angle) * 320,
            life: 1.4,
        });
    } else if (fire <= 0.35) {
        fireLatch = false;
    }

    for (const s of ship.shots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (s.x < 0) s.x += W; else if (s.x > W) s.x -= W;
        if (s.y < 0) s.y += PLAY_H; else if (s.y > PLAY_H) s.y -= PLAY_H;
    }
    ship.shots = ship.shots.filter((s) => s.life > 0);

    ship.history.push(thrust);
    if (ship.history.length > 180) ship.history.shift();
}

export function drawShip() {
    if (!ctx) return;
    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, W, H);

    // playfield frame
    ctx.strokeStyle = '#161c27';
    ctx.strokeRect(0.5, 0.5, W - 1, PLAY_H - 1);

    // shots
    ctx.fillStyle = '#ffd479';
    for (const s of ship.shots) { ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3); }

    // hull — a triangle pointing along `angle`
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.beginPath();
    ctx.moveTo(13, 0); ctx.lineTo(-9, 7); ctx.lineTo(-5, 0); ctx.lineTo(-9, -7);
    ctx.closePath();
    ctx.fillStyle = '#1b2230'; ctx.strokeStyle = '#7fb3ff'; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();

    // Exhaust length IS the analog value — the most direct readout there is.
    const t = ship.lastInputs.thrust;
    if (t > 0.01) {
        const len = 6 + t * 26;
        ctx.beginPath();
        ctx.moveTo(-6, 4); ctx.lineTo(-6 - len, 0); ctx.lineTo(-6, -4);
        ctx.closePath();
        ctx.fillStyle = ship.lastInputs.boost > 0.5 ? '#ff9d5c' : '#ffd479';
        ctx.globalAlpha = 0.35 + t * 0.65;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.restore();

    drawChart();
}

// Thrust strength over the last ~3 s. Square edges = a key. Curves = a stick.
function drawChart() {
    const y0 = PLAY_H, h = CHART_H;
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, y0, W, h);
    ctx.strokeStyle = '#171d28';
    ctx.beginPath();
    ctx.moveTo(0, y0 + h * 0.5); ctx.lineTo(W, y0 + h * 0.5);
    ctx.stroke();

    ctx.strokeStyle = '#4d9de0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = ship.history.length;
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * W;
        const y = y0 + h - 6 - ship.history[i] * (h - 12);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = '#4e5666';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('thrust strength, last ~3 s', 6, y0 + 4);
}

export function updateShipReadout() {
    if (!readoutVals.length) return;
    const i = ship.lastInputs;
    const speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
    const vals = [
        i.thrust.toFixed(3),
        (i.turn >= 0 ? '+' : '') + i.turn.toFixed(3),
        i.brake.toFixed(3),
        i.boost.toFixed(3),
        speed.toFixed(1),
        String(ship.firedCount),
    ];
    for (let n = 0; n < vals.length; n++) {
        if (readoutVals[n].textContent !== vals[n]) readoutVals[n].textContent = vals[n];
    }
}
