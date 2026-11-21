// Karst World UI entry: wires camera tour presets, storage/smooth toggle, live sculpting, and telemetry.
import {
    boot, fmtBytes, params, stats, readout, fpsMeter,
    foldPanels, segmented, toggleButton,
} from "/lib/kit/index.js";
import { sunControls } from "/lib/kit/sky.js";
import { crosshair } from "/lib/crosshair.js";
import {
    available, canvas, sun, fly, PRESETS, TIME_PRESETS, SCULPT_TOOLS,
    settings, sculpt, selectPreset, applyTimeOfDay, setViewMode,
    setCavesEnabled, applySettings, sculptAtCenter, resetEdits, getTelemetry, onFrame,
} from "/app/lab.js";

const app = boot();

if (!available) {
    document.getElementById('unavailable').hidden = false;
    app.status.warn('bro.voxeldag / Mesh.surfaceNets unavailable');
} else {
    crosshair.configure({ style: 'circle', size: 6, thickness: 1, color: '#ffffff', opacity: 0.65, outline: false });
    crosshair.show();

    const presetKeys = Object.keys(PRESETS);
    const presetSeg = segmented('#presets', Object.fromEntries(presetKeys.map((k) => [k, PRESETS[k].label])), {
        value: 'overview',
        onChange: (name) => selectPreset(name),
    });

    const viewSeg = segmented('#viewMode', {
        smooth:  'Smooth World',
        storage: 'Inspect SVDAG',
    }, {
        value: settings.viewMode,
        onChange: (v) => setViewMode(v),
    });

    toggleButton('#btn-caves', {
        on: settings.cavesEnabled,
        labels: ['Caves: Off', 'Caves: On'],
        onChange: (on) => setCavesEnabled(on),
    });

    toggleButton('#btn-flora', {
        on: settings.showFlora,
        labels: ['Flora: Off', 'Flora: On'],
        onChange: (on) => { settings.showFlora = on; applySettings(); },
    });

    const tele = readout('#telemetry', {
        nodes:   'SVDAG nodes',
        bricks:  'Unique 4\u00b3 bricks',
        storage: 'SVDAG storage',
        tris:    'Surface tris',
        chunks:  'Active chunks',
        flora:   'Instanced flora',
        ratio:   'Volume ratio',
        edits:   'Sculpt edits',
    });

    const toolKeys = Object.keys(SCULPT_TOOLS);
    const sculptInfo = document.getElementById('sculptInfo');
    const syncSculptLabel = () => {
        sculptInfo.textContent = sculpt.edits + (sculpt.edits === 1 ? ' edit' : ' edits');
    };
    const toolSeg = segmented('#sculptTool', SCULPT_TOOLS, {
        value: sculpt.tool,
        onChange: (v) => { sculpt.tool = v; },
    });
    document.getElementById('resetSculpt').addEventListener('click', () => {
        resetEdits();
        syncSculptLabel();
        updateTelemetry();
    });
    syncSculptLabel();

    const todLabels = Object.fromEntries(Object.keys(TIME_PRESETS).map((k) => [k, TIME_PRESETS[k].label]));
    const sunInit = TIME_PRESETS[settings.timeOfDay];
    const sunRig = sunControls('#sun', sun, {
        elevation: sunInit.elevation, heading: sunInit.heading, intensity: sunInit.intensity,
    });
    segmented('#tod', todLabels, {
        value: settings.timeOfDay,
        onChange: (k) => {
            applyTimeOfDay(k);
            const p = TIME_PRESETS[k];
            sunRig.state.elevation = p.elevation;
            sunRig.state.heading = p.heading;
            sunRig.state.intensity = p.intensity;
            sunRig.panel.refresh();
        },
    });
    applyTimeOfDay(settings.timeOfDay);

    params('#camera', fly.opts, {
        speed:     { min: 4, max: 80, step: 2, label: 'move speed' },
        lookSpeed: { min: 0.0005, max: 0.010, step: 0.0005, label: 'sensitivity', fmt: (v) => v.toFixed(4) },
        fov:       { min: 35, max: 110, step: 1 },
        far:       { min: 200, max: 4000, step: 100, label: 'view dist' },
    });
    document.getElementById('resetPos').addEventListener('click', () => {
        presetSeg.value = 'overview';
        selectPreset('overview');
    });

    foldPanels('#panel');

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0 && sculptAtCenter(sculpt.tool)) {
            syncSculptLabel();
            updateTelemetry();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (e.key === 'Tab') {
            e.preventDefault();
            const panel = document.getElementById('panel');
            panel.hidden = !panel.hidden;
        } else if (e.key === '[' || e.key === ']') {
            const idx = toolKeys.indexOf(sculpt.tool);
            const next = toolKeys[(idx + (e.key === ']' ? 1 : toolKeys.length - 1)) % toolKeys.length];
            sculpt.tool = next;
            toolSeg.value = next;
        } else if (e.key === 'v' || e.key === 'V') {
            const next = settings.viewMode === 'smooth' ? 'storage' : 'smooth';
            viewSeg.value = next;
            setViewMode(next);
        } else if (e.key >= '1' && e.key <= '6') {
            const name = presetKeys[Number(e.key) - 1];
            if (name) { presetSeg.value = name; selectPreset(name); }
        }
    });

    const hud = stats('#stats', {
        fps: 'fps', tris: 'tris', nodes: 'SVDAG nodes',
        bricks: '4\u00b3 bricks', storage: 'storage', flora: 'flora',
    });
    const fps = fpsMeter();

    function updateTelemetry() {
        const t = getTelemetry();
        if (!t) return;
        const memStr = fmtBytes(t.poolBytes);
        tele.set({
            nodes:   t.nodes.toLocaleString(),
            bricks:  t.bricks.toLocaleString(),
            storage: memStr,
            tris:    t.triangles.toLocaleString(),
            chunks:  t.chunks + ' / 16',
            flora:   t.floraTotal.toLocaleString(),
            ratio:   t.compression.toLocaleString() + ':1',
            edits:   t.edits,
        });
        hud.set({
            fps:     fps.fps.toFixed(0),
            tris:    t.triangles.toLocaleString(),
            nodes:   t.nodes.toLocaleString(),
            bricks:  t.bricks.toLocaleString(),
            storage: memStr,
            flora:   t.floraTotal.toLocaleString(),
        });
    }

    app.status.ok('ready · smooth Surface Nets extracted from 3-region SVDAG');
    updateTelemetry();

    let n = 0;
    onFrame(() => {
        fps.tick();
        if (++n % 8 === 0) updateTelemetry();
    });
}
