// HUD controller with immediate mode/timeMode sync (<= 1 frame) and throttled telemetry.

export function createHud({ onSetMode, onSetTimeMode }) {
    const perfStatsEl = document.getElementById('perfStats');
    const todButtons = Array.from(document.querySelectorAll('#todButtons [data-tod], .tod-btn'));
    const modeButtons = Array.from(document.querySelectorAll('#modeButtons [data-mode], .mode-btn'));

    for (const btn of todButtons) {
        btn.addEventListener('click', () => {
            if (btn.dataset.tod) onSetTimeMode(btn.dataset.tod);
        });
    }
    for (const btn of modeButtons) {
        btn.addEventListener('click', () => {
            if (btn.dataset.mode) onSetMode(btn.dataset.mode);
        });
    }

    let lastPaintMs = -1e9;
    let hudFrames = 0;
    let lastMode = '';
    let lastTimeMode = '';
    let lastInCar = false;

    function syncTod(timeMode) {
        for (const btn of todButtons) {
            btn.classList.toggle('active', btn.dataset.tod === timeMode);
        }
    }

    function syncMode(mode) {
        for (const btn of modeButtons) {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        }
    }

    function toggleVisibility() {
        const hud = document.getElementById('hud');
        const hint = document.getElementById('hudHint');
        if (hud) hud.hidden = !hud.hidden;
        if (hint) hint.hidden = !hint.hidden;
    }

    function update(snapshot, force = false) {
        const now = performance.now();
        const stateChanged =
            snapshot.mode !== lastMode ||
            snapshot.timeMode !== lastTimeMode ||
            snapshot.inCar !== lastInCar;

        if (!force && !stateChanged && (now - lastPaintMs < 250 && ++hudFrames < 60)) {
            return;
        }
        lastPaintMs = now;
        hudFrames = 0;
        lastMode = snapshot.mode;
        lastTimeMode = snapshot.timeMode;
        lastInCar = snapshot.inCar;

        syncMode(snapshot.mode);
        syncTod(snapshot.timeMode);

        if (!perfStatsEl) return;
        const p = snapshot.perf;
        const t = snapshot.tiles;
        const bTag = snapshot.buildingId
            ? `bldg ${snapshot.buildingId} F${snapshot.floorIndex}`
            : (snapshot.inCar ? `car ${snapshot.speed.toFixed(1)} m/s` : 'outdoors');

        perfStatsEl.textContent =
            `fps ${p.fps.toFixed(0)} · ${p.meanMs.toFixed(2)} ms (p95 ${p.p95Ms.toFixed(2)} ms) · ${snapshot.mode}\n` +
            `pos [${snapshot.pos[0].toFixed(1)}, ${snapshot.pos[1].toFixed(1)}, ${snapshot.pos[2].toFixed(1)}] · alt ${snapshot.alt.toFixed(1)} m (${snapshot.zone})\n` +
            `tiles ${t.drawCount} drawn · ${t.resident} res · ${bTag} · int ${snapshot.activeInteriors} · cars ${snapshot.trafficCount}\n` +
            `lod meshFade ${snapshot.lod.meshFadeStart}–${snapshot.lod.meshFadeEnd} m · voxelMin ${snapshot.lod.voxelMinDist} m\n` +
            `sky ${snapshot.timeMode} (${snapshot.timeHours.toFixed(1)}h) · glow ${snapshot.emissiveScale.toFixed(2)}`;
    }

    return {
        syncTod,
        syncMode,
        toggleVisibility,
        update,
    };
}
