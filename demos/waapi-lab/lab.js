// lab.js — the WAAPI Lab page: stage, transport, and the inspector that reads
// everything back from the Animation objects. main.js boots it; tests import
// it (never main.js, which would boot the page a second time).

import { h, clear, readout, logView, segmented } from "/lib/kit/index.js";
import { ANIMATION_PRESETS, getPresetById } from "/app/presets.js";
import { ctl, run, playPause, reverse, cancel, finish, setRate, seek, telemetry } from "/app/waapi.js";
import { drawPlot, parseEasing, deviation } from "/app/plotter.js";
import { COMPARE, initCompare, startCompare, stopCompare, measureCompare } from "/app/compare.js";
import { probeSupport, SUPPORT_LABELS, supported } from "/app/support.js";

const $ = (id) => document.getElementById(id);

/** Lab state, exported for tests. */
export const lab = {
    presetId: null,
    easing: 'linear',     // the easing string the preset REQUESTED
    trail: [],            // measured { x: frac, y: progress } samples
    support: null,
    seeking: false,
};

const TARGETS = ['badge', 'card', 'orb', 'rippleGrid', 'morphBlob', 'glitchBanner', 'compare'];
let app, ripple, tele, plotRo, cmpRo, log, rates, scrub;

function showTarget(type) {
    for (const t of TARGETS) $('target-' + t).hidden = t !== type;
    return type === 'rippleGrid' ? Array.from(ripple.children) : $('target-' + type);
}

export function start(bootedApp) {
    app = bootedApp;
    ripple = $('target-rippleGrid');
    for (let i = 0; i < 16; i++) ripple.appendChild(h('div.dot'));
    initCompare({ waapi: $('laneWaapi'), css: $('laneCss'), raf: $('laneRaf') });

    tele = readout('#telemetry', {
        state: 'playState', time: 'currentTime', rate: 'playbackRate', progress: 'progress (eased)',
        frac: 'iteration fraction', iter: 'currentIteration', dur: 'duration', iters: 'iterations', dir: 'direction',
    });
    plotRo = readout('#plotReadout', { requested: 'requested', engine: 'engine', dev: 'max |measured − requested|' });
    cmpRo = readout('#compareReadout', { waapi: '1 · WAAPI', css: '2 · CSS', raf: '3 · rAF', spread: 'largest gap' });
    log = logView('#events', { max: 60, time: true });
    ctl.onEvent = (type) => log.add(type + ' (' + lab.presetId + ')', type === 'finish' ? 'ok' : 'warn');

    lab.support = probeSupport($('stage'));
    const sup = readout('#support', SUPPORT_LABELS);
    for (const k of Object.keys(SUPPORT_LABELS)) {
        const v = lab.support[k];
        sup.set(k, v === true ? 'yes' : v === false ? 'no' : String(v), supported(k, v));
    }

    rates = segmented('#rates', [[0.25, '0.25x'], [0.5, '0.5x'], [1, '1x'], [2, '2x'], [-1, '-1x']], {
        value: 1, onChange: (r) => setRate(r),
    });
    bindTransport();

    loadPreset(ANIMATION_PRESETS[0].id);
    const frame = () => { refresh(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
}

// ── presets ─────────────────────────────────────────────────────────────────

export function loadPreset(id) {
    if (lab.presetId !== null) app.status.ok('ready');   // clear a stale transport warning
    lab.presetId = id;
    $('presetSelect').value = id;
    stopCompare();
    const arena = id === 'comparison-arena';
    $('comparePanel').hidden = !arena;
    $('timingPanel').hidden = arena;

    if (arena) {
        showTarget('compare');
        // The arena's easing lives on each keyframe, so the iteration-level
        // progress the plot measures is linear; the curve applies per interval.
        lab.easing = 'linear';
        $('presetNote').hidden = true;
        $('targetName').textContent = 'comparison arena';
        run($('laneWaapi'), COMPARE.keyframes, COMPARE.timing);
        startCompare();
    } else {
        const p = getPresetById(id);
        lab.easing = p.timing.easing || 'linear';
        $('timingDuration').value = p.timing.duration;
        $('timingIterations').value = String(p.timing.iterations);
        $('timingDirection').value = p.timing.direction || 'normal';
        $('presetNote').hidden = !p.note;
        $('presetNote').textContent = p.note || '';
        $('targetName').textContent = p.name + ' — ' + p.description;
        runPreset(p);
    }
    afterRun();
}

function runPreset(p) {
    run(showTarget(p.targetType), p.keyframes, p.timing, p.targetType === 'rippleGrid' ? 60 : 0);
}

/** Re-run the current preset with the timing form's values. */
export function applyTiming() {
    if (lab.presetId === 'comparison-arena') return;
    const p = getPresetById(lab.presetId);
    const it = $('timingIterations').value;
    Object.assign(p.timing, {
        duration: parseInt($('timingDuration').value, 10) || 1200,
        iterations: it === 'Infinity' ? Infinity : parseInt(it, 10),
        direction: $('timingDirection').value,
    });
    runPreset(p);
    afterRun();
}

function afterRun() {
    lab.trail = [];
    setRate(rates.value);
    $('btnPlay').textContent = 'Pause';
    $('easingName').textContent = lab.presetId === 'comparison-arena'
        ? 'linear per iteration · cubic-bezier per keyframe' : lab.easing;
    // Markers and JSON come from the effect, not the preset object.
    const kfs = ctl.primary.effect.getKeyframes();
    const track = clear($('kfTrack'));
    for (const k of kfs) track.appendChild(h('i', { style: { left: (k.computedOffset * 100) + '%' } }));
    $('keyframeJson').textContent = JSON.stringify(kfs.map((k) => {
        const o = Object.assign({}, k);
        delete o.composite;
        return o;
    }), null, 2);
}

// ── transport ───────────────────────────────────────────────────────────────

function bindTransport() {
    $('presetSelect').addEventListener('change', (e) => loadPreset(e.target.value));
    $('btnPlay').addEventListener('click', () => {
        $('btnPlay').textContent = playPause() ? 'Pause' : 'Play';
    });
    $('btnReverse').addEventListener('click', () => {
        reverse();
        if (ctl.primary) rates.value = ctl.primary.playbackRate;
        $('btnPlay').textContent = 'Pause';
    });
    $('btnCancel').addEventListener('click', () => { cancel(); $('btnPlay').textContent = 'Play'; });
    $('btnFinish').addEventListener('click', () => {
        const err = finish();
        if (!err) return;
        log.add('finish(): ' + err.name + ' — ' + err.message, 'err');
        app.status.warn(err.name + ': an infinite animation cannot finish');
    });
    for (const id of ['timingDuration', 'timingIterations', 'timingDirection']) {
        $(id).addEventListener('change', applyTiming);
    }
    scrub = $('scrub');
    scrub.addEventListener('pointerdown', () => { lab.seeking = true; });
    window.addEventListener('pointerup', () => { lab.seeking = false; });
    scrub.addEventListener('input', () => { seek(scrub.value / 1000); lab.trail = []; });
}

// ── per-frame readback ──────────────────────────────────────────────────────

const fmt = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(3) + 's');
const num = (v, d) => (v == null ? '—' : v === Infinity ? '∞' : typeof v === 'number' ? v.toFixed(d) : String(v));

export function refresh() {
    const t = telemetry();
    const state = t ? t.playState : 'idle';
    $('stateChip').textContent = state;
    $('stateChip').classList.toggle('on', state === 'running');
    $('rateChip').textContent = (t ? t.playbackRate : 1) + 'x';
    $('countLbl').textContent = (t ? t.count : 0) + (t && t.count === 1 ? ' animation' : ' animations');

    tele.set('state', state, state === 'running');
    tele.set({
        time: t ? num(t.currentTime, 0) + ' ms' : '—',
        rate: t ? num(t.playbackRate, 2) : '—',
        progress: t ? num(t.progress, 3) : '—',
        frac: t ? num(t.frac, 3) : '—',
        iter: t ? num(t.iteration, 0) : '—',
        dur: t ? num(t.duration, 0) + ' ms' : '—',
        iters: t ? num(t.iterations, 0) : '—',
        dir: t ? t.direction : '—',
    });

    if (t && t.frac != null && t.progress != null && state === 'running') {
        lab.trail.push({ x: t.frac, y: t.progress });
        if (lab.trail.length > 240) lab.trail.shift();
    }
    const dev = deviation(parseEasing(lab.easing), lab.trail);
    plotRo.set({ requested: lab.easing, engine: t ? t.easing : '—' });
    plotRo.set('dev', lab.trail.length ? dev.toFixed(3) : '—', lab.trail.length > 0 && dev <= 0.02);
    drawPlot($('plot'), lab.easing, lab.trail, t);

    if (!lab.seeking && t) {
        const f = t.frac == null ? 0 : t.frac;
        scrub.value = Math.round(f * 1000);
        $('progressFill').style.width = (f * 100).toFixed(1) + '%';
        $('timecode').textContent = `${fmt(t.localTime)} · iter ${num(t.iteration, 0)} · ${(f * 100).toFixed(1)}%`;
    } else if (!t) $('timecode').textContent = '—';

    if (lab.presetId === 'comparison-arena') {
        const m = measureCompare();
        const deg = (v) => (v == null ? '—' : v.toFixed(1) + '°');
        cmpRo.set({ waapi: deg(m.waapi), css: deg(m.css), raf: deg(m.raf) });
        cmpRo.set('spread', deg(m.spread), m.spread < 2);
    }
    return t;
}
