// HUD controller with immediate mode/timeMode sync and throttled telemetry.

export function createHud({ onSetMode, onSetTimeMode }) {
    const perfStatsEl = document.getElementById('perfStats');
    const statusEl = document.getElementById('status');
    const todButtons = Array.from(document.querySelectorAll('#todButtons [data-tod], .tod-btn'));
    const modeButtons = Array.from(document.querySelectorAll('#modeButtons [data-mode], .mode-btn'));

    for (const btn of todButtons) {
        btn.addEventListener('click', () => { if (btn.dataset.tod) onSetTimeMode(btn.dataset.tod); });
    }
    for (const btn of modeButtons) {
        btn.addEventListener('click', () => { if (btn.dataset.mode) onSetMode(btn.dataset.mode); });
    }

    let lastPaintMs = -1e9;
    let hudFrames = 0;
    let lastMode = '';
    let lastTimeMode = '';

    function syncTod(timeMode) {
        for (const btn of todButtons) btn.classList.toggle('active', btn.dataset.tod === timeMode);
    }

    function syncMode(mode) {
        for (const btn of modeButtons) btn.classList.toggle('active', btn.dataset.mode === mode);
    }

    function toggleVisibility() {
        const hud = document.getElementById('hud');
        const hint = document.getElementById('hudHint');
        if (hud) hud.hidden = !hud.hidden;
        if (hint) hint.hidden = !hint.hidden;
    }

    function setReady(label = 'ready') {
        if (statusEl) statusEl.textContent = label;
    }

    function update(snapshot, force = false) {
        const now = performance.now();
        const stateChanged = snapshot.mode !== lastMode || snapshot.timeMode !== lastTimeMode;
        if (!force && !stateChanged && (now - lastPaintMs < 200 && ++hudFrames < 45)) return;
        lastPaintMs = now;
        hudFrames = 0;
        lastMode = snapshot.mode;
        lastTimeMode = snapshot.timeMode;
        syncMode(snapshot.mode);
        syncTod(snapshot.timeMode);
        if (!perfStatsEl) return;

        const p = snapshot.perf;
        const s = snapshot.stream;
        const tr = snapshot.traffic;
        const loc = snapshot.inBuilding ? `inside bldg #${snapshot.inBuilding.id}`
            : (snapshot.mode === 'drive' ? `car ${snapshot.speed.toFixed(1)} m/s`
                : (snapshot.mode === 'transit' ? `commuter rail (${snapshot.stationName})` : `${snapshot.district}`));
        perfStatsEl.textContent =
            `fps ${p.fps.toFixed(0)} · cpu ${p.meanMs.toFixed(2)} ms · gpu ${(p.gpuMs || 0).toFixed(2)} ms · ${snapshot.mode}\n` +
            `pos [${snapshot.pos[0].toFixed(0)}, ${snapshot.pos[1].toFixed(1)}, ${snapshot.pos[2].toFixed(0)}] · ${loc}\n` +
            `tiles ${snapshot.tiles.drawCount} · quads ${s.activeQuads} · lod0 ${s.activeLod0} · trees ${s.totalTrees}\n` +
            `traffic ${tr.vehicles} · trains ${tr.trains} · dynShadow ${snapshot.shadowPagesDynamic} · ${snapshot.timeMode}`;
    }

    return { syncTod, syncMode, setReady, toggleVisibility, update };
}
