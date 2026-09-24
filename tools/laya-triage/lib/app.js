// app.js — Laya triage's page: one request with its calibrated answers and
// the act/escalate decision taken from confidence, beside live open-loop
// traffic that shows the request scheduler batching concurrent callers
// across the GPUs. main.js calls start().

import { boot, $, h, clear, bindControl, frameLoop } from "/lib/kit/index.js";
import { pickFolder } from "/lib/kit/ml.js";
import { session, defaultModelDir, checkpointOptions, loadModel, unavailableReason } from "./model.js";
import { PRESETS, QUESTIONS, presetsFor, trafficMix } from "./presets.js";
import { traffic, setRunning, burst, tickTraffic, resetTraffic, windowSummary } from "./traffic.js";
import { renderResult, renderDecisionError, drawLatency, drawBatches, renderStats, buildMetrics } from "./render.js";

let status;
const threshold = () => parseFloat($('#threshold').value);

function setReady(on) {
    for (const id of ['#btn-run', '#btn-traffic', '#btn-burst', '#btn-reset']) $(id).disabled = !on;
}

function showUnavailable(msg) {
    $('#unavailable').textContent = msg;
    $('#unavailable').hidden = !msg;
}

// ── Model ───────────────────────────────────────────────────────────────────

// The checkpoint picker lists the family members found beside the folder in
// the path box; picking one loads it. A folder outside a family checkout is
// still loadable through the path box alone.
function refreshCheckpoints(dir) {
    const sel = $('#ckpt-select');
    const { options, family } = checkpointOptions(dir);
    clear(sel);
    for (const o of options) sel.appendChild(h('option', { value: o.value, selected: o.selected }, o.label));
    sel.disabled = !family;
}

function stopTraffic() {
    setRunning(false);
    $('#btn-traffic').textContent = 'Start traffic';
    $('#btn-traffic').classList.remove('active');
}

export function load() {
    const dir = $('#model-dir').value;
    stopTraffic();
    setReady(false);
    refreshCheckpoints(dir);
    Object.assign(session, { loading: true, loadError: '', checkpoint: '' });
    status.busy('loading… (weights + CUDA-graph pre-warm, a few seconds)');
    const t0 = Date.now();
    return loadModel(dir).then((m) => {
        session.loading = false;
        session.loadMs = Date.now() - t0;
        const cfg = m.config();
        session.checkpoint = cfg.checkpoint;
        showUnavailable('');
        const gpus = cfg.devices.length;
        status.ok('ready · ' + cfg.checkpoint + ' · ' + gpus + ' GPU' + (gpus === 1 ? '' : 's') +
                  ' · loaded in ' + (session.loadMs / 1000).toFixed(1) + ' s');
        $('#brand-sub').textContent = cfg.encoder + ' · ' + cfg.num_layers + ' layers · ' + cfg.max_len +
            '-token context · ' + cfg.tokenizer + ' · bro.lm.loadLaya';
        buildPresets(cfg.checkpoint);
        trafficMix.multilingual = cfg.checkpoint === 'multilingual';
        setReady(true);
        m.resetStats();
    }, (e) => {
        session.loading = false;
        session.loadError = String((e && e.message) || e);
        status.error('not loaded');
        showUnavailable('The Laya model could not be loaded: ' + session.loadError +
                        ' Nothing on this page works without it; there is no simulated fallback.');
    });
}

// ── Single request ──────────────────────────────────────────────────────────

function selectPreset(p) {
    $('#state').value = JSON.stringify(p.state, null, 2);
    for (const b of $('#presets').children) b.classList.toggle('active', b.dataset.id === p.id);
}

// English presets for every checkpoint; the non-English ones only while the
// multilingual checkpoint is loaded.
function buildPresets(checkpoint) {
    const box = $('#presets');
    const active = [...box.children].find((b) => b.classList.contains('active'));
    clear(box);
    for (const p of presetsFor(checkpoint)) {
        box.appendChild(h('button.small.preset' + (p.lang ? '.foreign' : ''), {
            dataset: { id: p.id },
            onclick: () => { selectPreset(p); if (session.model) runSingle(); },
        }, p.label));
    }
    const keep = active && [...box.children].find((b) => b.dataset.id === active.dataset.id);
    if (keep) keep.classList.add('active');
    else selectPreset(PRESETS[0]);
    $('#presets-note').textContent = checkpoint === 'multilingual'
        ? 'Multilingual checkpoint: the dashed tickets are in other languages (questions stay in English), and half the generated traffic is too.'
        : 'Non-English tickets appear with the multilingual checkpoint; this one only reads English.';
}

function readState() {
    const text = $('#state').value;
    try { return JSON.parse(text); } catch (e) { return text; }   // plain text is a valid state too
}

export function runSingle() {
    const model = session.model;
    if (!model) return;
    const t0 = Date.now();
    session.singleError = '';
    $('#btn-run').disabled = true;
    model.predictAsync(readState(), QUESTIONS, { priority: 10, deadlineMs: 30 }).then((res) => {
        $('#btn-run').disabled = false;
        session.lastObservedMs = Date.now() - t0;
        session.lastResult = res;
        renderResult(res, threshold(), session.lastObservedMs);
    }, (e) => {
        $('#btn-run').disabled = false;
        session.singleError = String((e && e.message) || e);
        renderDecisionError(session.singleError);
    });
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function bindControls() {
    $('#ckpt-select').addEventListener('change', () => { $('#model-dir').value = $('#ckpt-select').value; load(); });
    $('#btn-load').addEventListener('click', load);
    $('#model-dir').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
    $('#btn-browse').addEventListener('click', () => {
        const d = pickFolder($('#model-dir').value);
        if (d) { $('#model-dir').value = d; load(); }
    });
    if (typeof showOpenFolderDialog !== 'function') $('#btn-browse').disabled = true;

    bindControl('#threshold', { out: '#threshold-val', fmt: (v) => Math.round(v * 100) + '%', reset: 0.45,
        onChange: () => { if (session.lastResult) renderResult(session.lastResult, threshold(), session.lastObservedMs); } });
    $('#btn-run').addEventListener('click', runSingle);

    const restartWindow = () => { resetTraffic(); if (session.model) session.model.resetStats(); };
    bindControl('#rate', { out: '#rate-val', fmt: (v) => v + ' req/s', onChange: (v) => {
        traffic.rate = v;
        if (session.model) session.model.resetStats();
    } });
    $('#btn-traffic').addEventListener('click', () => {
        const on = !traffic.running;
        if (on) restartWindow();
        setRunning(on);
        $('#btn-traffic').textContent = on ? 'Stop traffic' : 'Start traffic';
        $('#btn-traffic').classList.toggle('active', on);
    });
    $('#btn-burst').addEventListener('click', () => { if (session.model) burst(session.model, 64); });
    $('#btn-reset').addEventListener('click', restartWindow);
}

export function start() {
    const app = boot({ menu: { file: [{ id: 'file.load', label: 'Reload Checkpoint' }], handlers: { 'file.load': load } } });
    status = app.status;
    buildMetrics($('#metrics'));
    bindControls();
    buildPresets('english');
    selectPreset(PRESETS[0]);

    let lastStats = 0;
    frameLoop(() => {
        const model = session.model;
        if (!model) return;
        tickTraffic(model);
        const now = Date.now();
        if (now - lastStats >= 100) {          // stats() copies a few hundred values; 10 Hz is plenty
            lastStats = now;
            const st = model.stats();
            renderStats(st, windowSummary(3000), model);
            drawBatches($('#batches'), st);
        }
        drawLatency($('#latency'), traffic.deadlineMs);
    });

    const why = unavailableReason();
    if (why) {
        showUnavailable(why + ' There is no simulated fallback.');
        status.error('unavailable');
        $('#btn-load').disabled = true;
        return;
    }
    $('#model-dir').value = defaultModelDir();
    refreshCheckpoints($('#model-dir').value);
    if ($('#model-dir').value) load();
    else {
        status.error('not loaded');
        showUnavailable('No Laya checkpoint found (set LAYA_MODEL_DIR, put a laya/ checkout beside the bro repos, or browse to one).');
    }
}
