// render.js — the single-request answer cards and the live concurrency view
// (per-request latency, forward occupancy, device load).

import { $, h, clear } from "/lib/kit/dom.js";
import { levelMeter, fitCanvas } from "/lib/kit/audio-ui.js";
import { QUESTIONS } from "./presets.js";
import { traffic } from "./traffic.js";

const DEVICE_COLORS = ['#4fb3ff', '#f5a524', '#9b7bff', '#3ecf8e'];
export const deviceColor = (d) => DEVICE_COLORS[(d | 0) % DEVICE_COLORS.length];
const pct = (x) => (100 * x).toFixed(0) + '%';
const BG = '#10141b', GRID = '#1c2330', AXIS = '#6b7686', MISS = '#e5484d';

/** A labelled probability bar. */
function bar(label, p, strong) {
    const track = h('span.k-meter');
    levelMeter(track).set(p);
    return h('div.bar-row' + (strong ? '.strong' : ''), null,
        h('span.bar-label', null, label), track, h('span.bar-val', null, pct(p)));
}

// ── Single request ──────────────────────────────────────────────────────────

/**
 * The act/escalate decision comes from the calibrated confidence of the
 * routing answer (1 - normalised entropy): the checkpoint's own act head is
 * saturated (~1.0 for everything), so it cannot gate. The yes/no answers are
 * flags on the ticket, not gates: their entropy confidence is low for any p
 * in the 0.1-0.3 range, which would escalate nearly everything.
 */
export function decide(res, threshold) {
    const dep = res.answers.department;
    const flags = [];
    if (res.answers.churn_threat.noul >= 0.5) flags.push('churn risk');
    if (res.answers.refund_requested.noul >= 0.5) flags.push('refund');
    if (res.answers.angry.noul >= 0.5) flags.push('upset customer');
    return { act: dep.confidence >= threshold, confidence: dep.confidence, flags };
}

export function renderDecisionError(message) {
    $('#decision').className = 'decision escalate';
    $('#decision-head').textContent = 'Request failed';
    $('#decision-sub').textContent = message;
}

export function renderResult(res, threshold, observedMs) {
    const d = decide(res, threshold);
    const dep = res.answers.department;
    $('#decision').className = 'decision ' + (d.act ? 'act' : 'escalate');
    $('#decision-head').textContent = (d.act ? 'Act: route to ' + dep.choice : 'Escalate to a human') +
        (d.flags.length ? '  ·  ' + d.flags.join(', ') : '');
    $('#decision-sub').textContent = (d.act
        ? 'Routing confidence ' + pct(d.confidence) + ' is at or above ' + pct(threshold) + '.'
        : 'Routing confidence ' + pct(d.confidence) + ' is below ' + pct(threshold) +
          ' (best guess: ' + dep.choice + ' at ' + pct(dep.probabilities[dep.choice]) + ').') +
        ' Flags are yes/no answers at 50% or more.';

    const box = clear($('#answers'));
    for (const id of Object.keys(QUESTIONS)) {
        const a = res.answers[id];
        if (!a) continue;
        const card = h('div.card', null,
            h('div.card-head', null,
                h('span.q-id', null, id),
                h('span.q-type.t-' + a.type, null, a.type),
                h('span.q-conf', null, 'confidence ' + pct(a.confidence))),
            h('div.q-text', null, QUESTIONS[id].instructions));
        if (a.type === 'noul') {
            card.appendChild(bar('yes', a.noul, a.noul >= 0.5));
        } else {
            const probs = a.probabilities || {}, legend = a.legend || {};
            const best = Object.keys(probs).reduce((b, k) => (b === null || probs[k] > probs[b] ? k : b), null);
            for (const k in probs) card.appendChild(bar(a.type === 'score' ? k + ': ' + (legend[k] || '') : k, probs[k], k === best));
            if (a.type === 'score') {
                card.appendChild(h('div.q-note', null, 'expected level ' + a.score.toFixed(2) +
                    " (score questions are Laya's weakest type: a hint, not a verdict)"));
            }
        }
        box.appendChild(card);
    }
    const t = res.timing;
    $('#single-timing').textContent =
        t.totalMs.toFixed(1) + ' ms in the engine (tokenize ' + t.tokenizeMs.toFixed(1) + ', queue ' + t.queueMs.toFixed(1) +
        ', forward ' + t.forwardMs.toFixed(1) + ') · ' + observedMs + ' ms until this page saw it · GPU ' + t.device + ' · ' +
        'shared its forward with ' + (t.batchRequests - 1) + ' other request' + (t.batchRequests === 2 ? '' : 's') + ' · ' +
        res.usage.input_tokens + ' tokens · act head ' + res.answers.department.rl_agent.act_probability.toFixed(3) +
        ' (saturated, not used)';
}

// ── Live view ───────────────────────────────────────────────────────────────

const SPAN_MS = 10000;
const Y_MAX = 60;

/** Each completed request as a dot: x = when, y = engine latency; colour = GPU, red = missed. */
export function drawLatency(canvas, deadlineMs) {
    const { ctx: g, w: W, h: H } = fitCanvas(canvas);
    const L = 34, B = 16;
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    const y = (ms) => (H - B) - Math.min(ms, Y_MAX) / Y_MAX * (H - B - 6);
    g.font = '10px sans-serif';
    for (const ms of [0, 10, 20, 30, 40, 50, 60]) {
        g.fillStyle = GRID; g.fillRect(L, y(ms), W - L, 1);
        g.fillStyle = AXIS; g.fillText(ms + '', 6, y(ms) + 3);
    }
    g.fillStyle = MISS; g.fillRect(L, y(deadlineMs) - 1, W - L, 2);
    g.fillText('deadline ' + deadlineMs + ' ms', W - 104, y(deadlineMs) - 5);
    g.fillStyle = AXIS; g.fillText('last 10 s', L, H - 3);
    const now = Date.now(), recs = traffic.records;
    for (let i = recs.length - 1; i >= 0; i--) {
        const r = recs[i], age = now - r.at;
        if (age > SPAN_MS) break;
        const x = L + (1 - age / SPAN_MS) * (W - L - 4);
        g.fillStyle = r.missed ? MISS : deviceColor(r.device);
        g.fillRect(x - 1.5, y(r.totalMs) - 1.5, 3, 3);
    }
}

/** One bar per recent forward: height = packed tokens / budget, colour = GPU, label = requests. */
export function drawBatches(canvas, stats) {
    const { ctx: g, w: W, h: H } = fitCanvas(canvas);
    const B = 14;
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    const batches = stats.recentBatches || [];
    const n = Math.min(batches.length, Math.floor(W / 9));
    const bw = n ? Math.min(24, (W - 8) / n) : 0;
    g.fillStyle = GRID; g.fillRect(0, 6, W, 1);
    g.font = '9px sans-serif';
    for (let i = 0; i < n; i++) {
        const b = batches[batches.length - n + i];
        const hh = (b.budget > 0 ? Math.min(1, b.tokens / b.budget) : 0) * (H - B - 8);
        const x = 4 + i * bw;
        g.fillStyle = deviceColor(b.device);
        g.fillRect(x, H - B - hh, Math.max(1, bw - 2), hh);
        if (bw >= 12) { g.fillStyle = '#c9d1dc'; g.fillText(String(b.requests), x + 1, H - B - hh - 3); }
    }
    g.fillStyle = AXIS;
    g.fillText('each bar is one forward: height = tokens / budget, label = requests packed into it', 4, H - 3);
}

const METRICS = {
    inflight: 'in flight', queued: 'queued', rps: 'done / s', p50: 'p50 ms', p99: 'p99 ms',
    missed: 'over deadline', batch: 'requests / forward', occ: 'occupancy', seen: 'frame delivery',
};

/** Build the metric tiles into #metrics (ids m-<key>). */
export function buildMetrics(host) {
    for (const k in METRICS) {
        host.appendChild(h('div.metric', null, h('span.m-label', null, METRICS[k]), h('span.m-val#m-' + k, null, '--')));
    }
}

const devices = [];                           // { meter, val } per GPU row

export function renderStats(stats, win, model) {
    const s = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== v) e.textContent = v; };
    s('m-inflight', String(traffic.inFlight));
    s('m-queued', String(stats.queuedRequests));
    s('m-rps', win.rps.toFixed(0));
    s('m-p50', win.n ? win.p50.toFixed(1) : '--');
    s('m-p99', win.n ? win.p99.toFixed(1) : '--');
    s('m-missed', win.n ? pct(win.missed / win.n) : '--');
    s('m-batch', stats.forwards ? stats.meanBatchRequests.toFixed(1) : '--');
    s('m-occ', stats.forwards ? pct(stats.meanOccupancy) : '--');
    s('m-seen', win.n ? '+' + win.seenMean.toFixed(0) + ' ms' : '--');
    s('cost-model', 'budget ' + stats.tokenBudget + ' tokens/forward for a ' + stats.targetForwardMs + ' ms forward target · ' +
        'cost model ' + stats.estFixedMs.toFixed(2) + ' ms + ' + stats.estMsPer1kTokens.toFixed(2) + ' ms per 1k tokens · ' +
        stats.completed + ' done, ' + stats.failed + ' failed' + (traffic.lastError ? ' · last error: ' + traffic.lastError : ''));

    const host = $('#devices');
    if (devices.length !== stats.devices.length) {
        clear(host);
        devices.length = 0;
        for (const d of stats.devices) {
            const track = h('span.k-meter');
            const meter = levelMeter(track);
            meter.color(deviceColor(d.device));
            const val = h('span.dev-val');
            host.appendChild(h('div.dev-row', null,
                h('span.dev-swatch', { style: { background: deviceColor(d.device) } }),
                h('span.dev-name', null, 'GPU ' + d.device + ' · ' + d.name), track, val));
            devices.push({ meter, val });
        }
    }
    stats.devices.forEach((d, i) => {
        devices[i].meter.set(Math.min(1, d.busyFraction));
        devices[i].val.textContent = pct(d.busyFraction) + ' busy · ' + d.forwards + ' fwd · ' + d.graphs + ' graphs';
    });
    const n = model.config().devices.length;
    s('replicas', n + (n === 1 ? ' replica' : ' replicas'));
}
