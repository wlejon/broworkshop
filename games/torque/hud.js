// hud.js — the instrument cluster and telemetry panel.
//
// One direction only: `app.js` computes state, calls in here, and the DOM
// updates. Nothing in the HUD reads the simulation, so the smoke test can
// assert against the same telemetry object the panel is drawn from and know it
// is looking at what a human sees.
//
// Readouts refresh at a readable rate rather than every frame. A 60 Hz number
// is a blur; the bars update every frame because a bar's motion IS the reading.

const $ = (id) => document.getElementById(id);

const el = {
    kmh: $('kmh'), speedBar: $('speedBar'),
    rpm: $('rpm'), rpmBar: $('rpmBar'),
    gear: $('gear'), shift: $('shift'),
    fps: $('fps'), surface: $('surface'),
    lapCur: $('lapCur'), lapBest: $('lapBest'), lapCount: $('lapCount'),
    rows: [0, 1, 2, 3].map(i => document.querySelector(`#wheels tr[data-w="${i}"]`)),
};

const TOP_KMH = 240;
const REDLINE = 7000;

/** Format seconds as m:ss.mmm, or an em dash for null. */
export function lapTime(sec) {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

/** Push a telemetry snapshot (car.telemetry()) into the cluster + table. */
export function drawTelemetry(t, surfaceName) {
    const kmh = Math.abs(t.kmh);
    el.kmh.textContent = kmh.toFixed(0);
    el.speedBar.style.width = `${Math.min(100, (kmh / TOP_KMH) * 100)}%`;

    el.rpm.textContent = t.rpm.toFixed(0);
    el.rpmBar.style.width = `${Math.min(100, (t.rpm / REDLINE) * 100)}%`;

    el.gear.textContent = t.gear < 0 ? 'R' : t.gear === 0 ? 'N' : String(t.gear);
    el.shift.textContent = t.switching ? 'SHIFT' : ' ';

    if (surfaceName != null) el.surface.textContent = surfaceName;

    for (const w of t.wheels) {
        const row = el.rows[w.index];
        if (!row) continue;
        row.classList.toggle('airborne', !w.contact);
        row.querySelector('.susp i').style.width = `${(w.compression * 100).toFixed(0)}%`;
        row.querySelector('.st').textContent = w.steerDeg.toFixed(0) + '°';
        row.querySelector('.av').textContent = w.angularVelocity.toFixed(0);
        row.querySelector('.sl').textContent = w.slip.toFixed(2);
    }
}

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

/** Wire the HUD's buttons. Both handlers go through app.js's own entry points. */
export function bindHud({ onCamera, onRespawn }) {
    for (const b of document.querySelectorAll('button.cam')) {
        b.addEventListener('click', () => onCamera(Number(b.dataset.cam)));
    }
    $('respawn').addEventListener('click', onRespawn);
}
