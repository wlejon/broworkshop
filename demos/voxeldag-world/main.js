// Entry point wiring lib/kit UI, camera tour presets, live sculpting, and SVDAG telemetry.
import {
    boot, fmtBytes, params, stats, readout, fpsMeter,
    foldPanels, segmented, toggleButton,
} from "/lib/kit/index.js";
import { sunControls } from "/lib/kit/sky.js";
import { crosshair } from "/lib/crosshair.js";
import {
    available, canvas, sun, fly, PRESETS, TIME_PRESETS, SCULPT_TOOLS,
    settings, sculpt, selectPreset, applyTimeOfDay, applySettings,
    sculptAtCenter, resetSculpt, getTelemetry, onFrame,
} from "/app/lab.js";

const app = boot();

if (!available) {
    document.getElementById('unavailable').hidden = false;
    app.status.warn('bro.voxeldag unavailable');
} else {
    crosshair.configure({ style: 'circle', size: 6, thickness: 1, color: '#ffffff', opacity: 0.65, outline: false });
    crosshair.show();

    const presetKeys = Object.keys(PRESETS);
    const presetButtons = segmented('#presets', Object.fromEntries(presetKeys.map((k) => [k, PRESETS[k].label])), {
        value: 'overview',
        onChange: (name) => selectPreset(name),
    });

    const tele = readout('#telemetry', {
        instances: 'Placed instances',
        voxels:    'Virtual voxels',
        nodes:     'Unique DAG nodes',
        bricks:    'Unique 4\u00b3 bricks',
        memory:    'Pool memory',
        ratio:     'Compression',
        anim:      'Anim tick / clips',
        gen:       'DAG generation',
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
        resetSculpt();
        syncSculptLabel();
        updateTelemetry();
    });
    syncSculptLabel();

    const btnSvdag = toggleButton('#btn-svdag', {
        on: settings.showVoxelDag,
        labels: ['SVDAG: Off', 'SVDAG: On'],
        onChange: (on) => { settings.showVoxelDag = on; applySettings(); },
    });
    const btnTerrain = toggleButton('#btn-terrain', {
        on: settings.showTerrain,
        labels: ['Terrain: Off', 'Terrain: On'],
        onChange: (on) => { settings.showTerrain = on; applySettings(); },
    });
    const btnCarve = toggleButton('#btn-carve', {
        on: settings.carveCutouts,
        labels: ['Cutouts: Off', 'Cutouts: On'],
        onChange: (on) => { settings.carveCutouts = on; applySettings(); },
    });
    const btnAnim = toggleButton('#btn-anim', {
        on: settings.autoAnimate,
        labels: ['Anim: Paused', 'Anim: Playing'],
        onChange: (on) => { settings.autoAnimate = on; applySettings(); },
    });

    params('#quality', settings, {
        lodScale:    { min: 0.4, max: 3.0, step: 0.05, label: 'LOD scale', fmt: (v) => v.toFixed(2) },
        maxRaySteps: { min: 32, max: 256, step: 8, label: 'ray steps' },
        animFps:     { min: 1, max: 24, step: 1, label: 'anim FPS' },
    }, { onChange: () => applySettings() });

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
    // Restore exact initial sun/fog after sunControls initial apply()
    applyTimeOfDay(settings.timeOfDay);

    params('#camera', fly.opts, {
        speed:     { min: 4, max: 90, step: 2, label: 'move speed' },
        lookSpeed: { min: 0.0005, max: 0.010, step: 0.0005, label: 'sensitivity', fmt: (v) => v.toFixed(4) },
        fov:       { min: 35, max: 110, step: 1 },
        far:       { min: 200, max: 4000, step: 100, label: 'view dist' },
    });
    document.getElementById('resetPos').addEventListener('click', () => {
        presetButtons.value = 'overview';
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
        } else if (e.key === 'p' || e.key === 'P') {
            btnAnim.toggle();
        } else if (e.key >= '1' && e.key <= '6') {
            const name = presetKeys[Number(e.key) - 1];
            if (name) { presetButtons.value = name; selectPreset(name); }
        }
    });

    const hud = stats('#stats', {
        fps: 'fps', instances: 'instances', nodes: 'DAG nodes',
        bricks: '4\u00b3 bricks', tick: 'tick', gen: 'gen',
    });
    const fps = fpsMeter();

    function fmtBig(v) {
        if (v >= 1e9) return (v / 1e9).toFixed(2) + ' B';
        if (v >= 1e6) return (v / 1e6).toFixed(1) + ' M';
        if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K';
        return String(v);
    }

    function updateTelemetry() {
        const t = getTelemetry();
        if (!t) return;
        tele.set({
            instances: t.instances.toLocaleString(),
            voxels:    fmtBig(t.virtualVoxels),
            nodes:     t.nodes.toLocaleString(),
            bricks:    t.bricks.toLocaleString(),
            memory:    fmtBytes(t.poolBytes),
            ratio:     t.compression.toLocaleString() + ':1',
            anim:      t.animTick + ' / ' + t.animClips + ' clips',
            gen:       t.generation,
        });
        hud.set({
            fps:       fps.fps.toFixed(0),
            instances: t.instances.toLocaleString(),
            nodes:     t.nodes.toLocaleString(),
            bricks:    t.bricks.toLocaleString(),
            tick:      t.animTick,
            gen:       t.generation,
        });
    }

    app.status.ok('ready · stacked additive + subtractive SVDAG active');
    updateTelemetry();

    let frameN = 0;
    onFrame(() => {
        fps.tick();
        if (++frameN % 6 === 0) updateTelemetry();
    });
}
