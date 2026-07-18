// hud.js — the instrument cluster and telemetry panel.
//
// One direction only: `app.js` computes state, calls in here, and the DOM
// updates. Nothing in the HUD reads the simulation, so the smoke test can
// assert against the same telemetry object the panel is drawn from and know it
// is looking at what a human sees.
//
// Readouts refresh at a readable rate rather than every frame. A 60 Hz number
// is a blur; the bars update every frame because a bar's motion IS the reading.
//
// With three vehicles the panel has to ADAPT, and it does so from the telemetry
// snapshot alone — `t.kind` selects which extra readouts are shown and which
// rows the wheel table carries. The HUD is never told which vehicle is active
// by a separate call; it reads it out of the same object it is drawing.

const $ = (id) => document.getElementById(id);

const el = {
    kmh: $('kmh'), speedBar: $('speedBar'),
    rpm: $('rpm'), rpmBar: $('rpmBar'),
    gear: $('gear'), shift: $('shift'),
    fps: $('fps'), surface: $('surface'),
    lapCur: $('lapCur'), lapBest: $('lapBest'), lapCount: $('lapCount'),
    vehicleHint: $('vehicleHint'),
    wheelsBody: $('wheelsBody'),
    wheelHint: $('wheelHint'),
    // Per-vehicle extra panels
    trackPanel: $('trackPanel'), trackL: $('trackL'), trackR: $('trackR'),
    trackSplit: $('trackSplit'), trackMode: $('trackMode'),
    leanPanel: $('leanPanel'), leanDeg: $('leanDeg'), leanBar: $('leanBar'),
    leanState: $('leanState'), leanToggle: $('leanToggle'),
    tirePanel: $('tirePanel'), tireHint: $('tireHint'),
};

const TOP_KMH = 240;
const REDLINE = 7000;

// Redline differs per vehicle, so the tach bar means the same thing on all
// three: a tank revving to 3200 should show a full bar at 3200, not a third.
const REDLINES = { car: 7000, tank: 3200, bike: 10000 };
const TOP_SPEEDS = { car: 240, tank: 60, bike: 220 };

/** Wheel table row labels per vehicle. Length also sets the row count. */
const WHEEL_LABELS = {
    car:  ['FL', 'FR', 'RL', 'RR'],
    tank: ['L1', 'L2', 'L3', 'L4', 'L5', 'R1', 'R2', 'R3', 'R4', 'R5'],
    bike: ['FRONT', 'REAR'],
};

const WHEEL_HINTS = {
    car: '<b>susp</b> is normalised suspension compression, <b>ω</b> the wheel\'s angular velocity in rad/s, <b>slip</b> the longitudinal slip ratio, <b>lat</b> the wheel\'s lateral friction scalar. Watch slip climb as you drop the tyre grip. A row that goes dim has left the ground.',
    tank: 'Ten road wheels, five per track. A tracked vehicle steers no wheel at all, so <b>steer</b> is always zero — the turning happens in the track speeds above. A row that goes dim has left the ground.',
    bike: 'Two wheels. The front <b>steer</b> angle is what the lean controller works through: it steers into the fall to stand the bike back up. A row that goes dim has left the ground.',
};

// All ten rows exist in the markup from the start; a vehicle change relabels
// them and hides the surplus. Generating them with innerHTML instead lays every
// row out on top of the others — dynamically inserted <tr> elements are not
// given table layout — so the rows are static and only their text moves.
const allRows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map(i => el.wheelsBody.querySelector(`tr[data-w="${i}"]`));

let rowKind = null;

/** Relabel the wheel table for a vehicle. Only runs when the vehicle changes. */
function ensureRows(kind) {
    if (rowKind === kind) return allRows;
    const labels = WHEEL_LABELS[kind] || WHEEL_LABELS.car;
    for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        if (!row) continue;
        const on = i < labels.length;
        row.style.display = on ? '' : 'none';
        if (on) row.querySelector('.wl').textContent = labels[i];
    }
    if (el.wheelHint) el.wheelHint.innerHTML = WHEEL_HINTS[kind] || WHEEL_HINTS.car;
    rowKind = kind;
    return allRows;
}

/** Format seconds as m:ss.mmm, or an em dash for null. */
export function lapTime(sec) {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

/** Push a telemetry snapshot (vehicle.telemetry()) into the cluster + table. */
export function drawTelemetry(t, surfaceName) {
    const kind = t.kind || 'car';
    const topKmh = TOP_SPEEDS[kind] || TOP_KMH;
    const redline = REDLINES[kind] || REDLINE;

    const kmh = Math.abs(t.kmh);
    el.kmh.textContent = kmh.toFixed(0);
    el.speedBar.style.width = `${Math.min(100, (kmh / topKmh) * 100)}%`;

    el.rpm.textContent = t.rpm.toFixed(0);
    el.rpmBar.style.width = `${Math.min(100, (t.rpm / redline) * 100)}%`;

    el.gear.textContent = t.gear < 0 ? 'R' : t.gear === 0 ? 'N' : String(t.gear);
    el.shift.textContent = t.switching ? 'SHIFT' : ' ';

    if (surfaceName != null) el.surface.textContent = surfaceName;

    // --- Per-vehicle extras --------------------------------------------------
    // Exactly one of these is meaningful at a time, and each is driven purely
    // from fields the active vehicle's telemetry() chose to publish.

    show(el.trackPanel, kind === 'tank');
    if (kind === 'tank' && t.tracks) {
        el.trackL.textContent = t.tracks.left.toFixed(1);
        el.trackR.textContent = t.tracks.right.toFixed(1);
        el.trackSplit.textContent = t.tracks.split.toFixed(1);
        const pivoting = t.neutralTurn ||
            (Math.sign(t.tracks.left) !== Math.sign(t.tracks.right) &&
             Math.abs(t.tracks.split) > 1.0);
        el.trackMode.textContent = pivoting ? 'NEUTRAL TURN' :
            Math.abs(t.tracks.split) > 0.6 ? 'skid steer' : 'straight';
        el.trackMode.classList.toggle('hot', !!pivoting);
    }

    show(el.leanPanel, kind === 'bike');
    if (kind === 'bike') {
        const lean = t.leanDeg || 0;
        el.leanDeg.textContent = `${lean >= 0 ? '' : '−'}${Math.abs(lean).toFixed(1)}°`;
        // A centre-anchored bar: the fill grows left or right out of the middle,
        // so which WAY the bike is leaning is readable without reading a sign.
        const frac = Math.min(1, Math.abs(lean) / 60);
        el.leanBar.style.width = `${frac * 50}%`;
        el.leanBar.style.left = lean >= 0 ? '50%' : `${50 - frac * 50}%`;
        el.leanBar.classList.toggle('fallen', !!t.fallen);
        el.leanState.textContent = t.fallen ? 'DOWN' : t.leanEnabled ? 'upright' : 'unassisted';
        el.leanState.classList.toggle('hot', !!t.fallen);
    }

    show(el.tirePanel, kind === 'car');

    // --- Wheel table ---------------------------------------------------------
    const rows = ensureRows(kind);
    for (const w of t.wheels) {
        const row = rows[w.index];
        if (!row) continue;
        row.classList.toggle('airborne', !w.contact);
        row.querySelector('.susp i').style.width = `${(w.compression * 100).toFixed(0)}%`;
        row.querySelector('.st').textContent = w.steerDeg.toFixed(0) + '°';
        row.querySelector('.av').textContent = w.angularVelocity.toFixed(0);
        row.querySelector('.sl').textContent = w.slip.toFixed(2);
        // Slip past the friction curve's peak means the tyre is sliding, not
        // gripping. Highlighting it is the whole point of the friction demo.
        row.classList.toggle('sliding', Math.abs(w.slip) > 0.25);
        row.querySelector('.lat').textContent = w.grip ? w.grip.lateral.toFixed(2) : '—';
    }
}

function show(node, on) { if (node) node.style.display = on ? '' : 'none'; }

/** Lap panel. `current` may be null before the first crossing. */
export function drawLaps(state) {
    el.lapCur.textContent = lapTime(state.currentLap);
    el.lapBest.textContent = lapTime(state.bestLap);
    el.lapCount.textContent = String(state.laps);
}

export function setFps(v) { el.fps.textContent = `${v.toFixed(0)} fps`; }

/** Highlight the active camera button. */
export function setCameraButtons(activeIndex) {
    for (const b of document.querySelectorAll('button.cam')) {
        b.classList.toggle('on', Number(b.dataset.cam) === activeIndex);
    }
}

/** Highlight the active vehicle and show its handling note. */
export function setVehicle(vehicle) {
    for (const b of document.querySelectorAll('button.veh')) {
        b.classList.toggle('on', b.dataset.veh === vehicle.kind);
    }
    if (el.vehicleHint) el.vehicleHint.innerHTML = vehicle.hint;
    // Force the wheel table to relabel on the next draw even if two vehicles
    // happen to share a row count.
    rowKind = null;
}

/** Highlight the active tyre preset and show what it does. */
export function setTirePreset(name, presets) {
    for (const b of document.querySelectorAll('button.tire')) {
        b.classList.toggle('on', b.dataset.tire === name);
    }
    const p = presets[name];
    if (el.tireHint && p) el.tireHint.textContent = p.hint;
}

/** Reflect the bike's lean-controller switch. */
export function setLeanToggle(on) {
    if (!el.leanToggle) return;
    el.leanToggle.classList.toggle('on', !!on);
    el.leanToggle.textContent = on ? 'Lean controller: ON' : 'Lean controller: OFF';
}

/** Wire the HUD's buttons. Every handler goes through app.js's entry points. */
export function bindHud({ onCamera, onRespawn, onVehicle, onTire, onLean }) {
    for (const b of document.querySelectorAll('button.cam')) {
        b.addEventListener('click', () => onCamera(Number(b.dataset.cam)));
    }
    for (const b of document.querySelectorAll('button.veh')) {
        b.addEventListener('click', () => onVehicle(b.dataset.veh));
    }
    for (const b of document.querySelectorAll('button.tire')) {
        b.addEventListener('click', () => onTire(b.dataset.tire));
    }
    if (el.leanToggle) el.leanToggle.addEventListener('click', onLean);
    $('respawn').addEventListener('click', onRespawn);
}
