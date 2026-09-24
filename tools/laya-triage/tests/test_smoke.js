// Laya triage on the real model (GPU): the app finds and loads a checkpoint
// by itself, decides presets through its buttons, runs open-loop traffic and a
// burst through its controls, and switches checkpoints through the picker.
// Run: scripts/validate.sh --ml tools/laya-triage
//
// The app remembers the last checkpoint that loaded, so the test pins the
// English one first (through the picker, like a user) and restores the
// remembered folder at the end.

import { check, eq, test, done, waitFor, pumpUntil, setValue, text, q, shot, skip } from "/lib/kit/test.js";
import { session, prefs } from "/app/lib/model.js";
import { traffic, windowSummary } from "/app/lib/traffic.js";

if (!bro.lm || bro.lm.available === false || !bro.gpu.available) skip('needs bro.lm and a GPU');

const saved = prefs.snapshot();
const presets = () => [...document.querySelectorAll('.preset')];
const preset = (id) => presets().find((b) => b.dataset.id === id);
const optionFor = (re) => [...q('#ckpt-select').options].find((o) => re.test(o.textContent));

function decideWith(id) {
    session.lastResult = null;
    session.singleError = '';
    preset(id).click();
    waitFor(() => session.lastResult || session.singleError, id + ' result', 20000);
    check(!session.singleError, id + ': ' + session.singleError);
    return session.lastResult;
}

function switchTo(option) {
    setValue('#ckpt-select', option.value);
    waitFor(() => !session.loading, 'checkpoint load', 120000);
    check(!session.loadError, 'loaded: ' + session.loadError);
}

try {
    waitFor(() => !session.loading && (session.model || session.loadError), 'model load', 120000);
    if (!session.model) skip('no Laya checkpoint loaded: ' + (session.loadError || text('#unavailable')));

    test('the app found and loaded a checkpoint by itself', () => {
        check(q('#unavailable').hidden, 'no unavailable banner');
        check(/^ready/.test(text('#status')), 'status: ' + text('#status'));
        check(!q('#btn-run').disabled && !q('#btn-burst').disabled, 'controls enabled');
        console.log('  loaded ' + session.modelDir + ' (' + session.checkpoint + ') in ' + session.loadMs + ' ms');
    });

    const english = optionFor(/^English/);
    if (session.checkpoint !== 'english' && english) switchTo(english);

    test('English checkpoint offers only English tickets', () => {
        if (session.checkpoint !== 'english') return console.log('  (no English checkpoint beside ' + session.modelDir + ')');
        check(!presets().some((b) => b.classList.contains('foreign')), 'no non-English presets');
        check(/Non-English/.test(text('#presets-note')), 'note explains: ' + text('#presets-note'));
    });

    test('an outage ticket routes to technical', () => {
        const res = decideWith('outage');
        eq(res.answers.department.choice, 'technical', 'department');
        eq(q('#answers').children.length, 5, 'answer cards');
        check(/^(Act|Escalate)/.test(text('#decision-head')), 'decision: ' + text('#decision-head'));
        check(preset('outage').classList.contains('active'), 'preset highlighted');
        check(/ms in the engine/.test(text('#single-timing')), 'timing line');
    });

    test('a duplicate charge acts on billing and flags a refund', () => {
        decideWith('duplicate');
        check(/^Act: route to billing/.test(text('#decision-head')), text('#decision-head'));
        check(text('#decision-head').includes('refund'), 'refund flagged');
        check(q('#decision').classList.contains('act'), 'act styling');
    });

    test('raising the threshold re-decides without a request', () => {
        const before = session.lastResult;
        setValue('#threshold', '0.95');
        eq(text('#threshold-val'), '95%', 'threshold readout');
        check(session.lastResult === before, 'no new request');
        if (before.answers.department.confidence < 0.95) {
            check(/^Escalate/.test(text('#decision-head')), 'escalates at 95%: ' + text('#decision-head'));
        }
        setValue('#threshold', '0.45');
    });

    test('open-loop traffic completes hundreds of requests', () => {
        setValue('#rate', '200');
        eq(traffic.rate, 200, 'rate');
        eq(text('#rate-val'), '200 req/s', 'rate readout');
        q('#btn-traffic').click();
        check(traffic.running, 'running');
        eq(text('#btn-traffic'), 'Stop traffic', 'button label');
        const end = Date.now() + 4000;
        pumpUntil(() => Date.now() > end, 5000);
        const win = windowSummary(3000), st = session.model.stats();
        console.log('  @200 req/s: ' + win.rps.toFixed(0) + ' done/s, p50 ' + win.p50.toFixed(1) + ' ms, p99 ' +
                    win.p99.toFixed(1) + ' ms, ' + st.meanBatchRequests.toFixed(1) + ' requests/forward');
        check(win.n > 300, 'completed: ' + win.n);
        eq(traffic.failed, 0, 'failures (' + traffic.lastError + ')');
        check(text('#m-p99') !== '--', 'p99 tile');
        check(q('#devices').children.length >= 1, 'device rows');
        shot('traffic');
        q('#btn-traffic').click();
        check(!traffic.running, 'stopped');
        waitFor(() => traffic.inFlight === 0, 'traffic drain', 20000);
    });

    // Whether steady traffic shares forwards depends on how fast the GPUs are
    // (fast ones finish each request before the next arrives), so sharing is
    // asserted on a burst, where 64 requests are waiting at once.
    test('a burst of 64 packs into shared forwards', () => {
        q('#btn-reset').click();
        q('#btn-burst').click();
        eq(traffic.inFlight, 64, 'in flight');
        waitFor(() => traffic.inFlight === 0, 'burst', 20000);
        const b = session.model.stats();
        console.log('  burst: ' + b.forwards + ' forwards, ' + b.meanBatchRequests.toFixed(1) + ' requests/forward');
        eq(b.completed, 64, 'completed');
        check(b.forwards < 32 && b.meanBatchRequests > 1.5, 'shared forwards: ' + b.forwards);
        const end = Date.now() + 300;
        pumpUntil(() => Date.now() > end, 1000);
        check(text('#m-batch') !== '--', 'requests/forward tile');
        shot('burst');
    });

    const multi = optionFor(/^Multilingual/);
    if (multi) {
        test('switching to the multilingual checkpoint through the picker', () => {
            switchTo(multi);
            const cfg = session.model.config();
            eq(cfg.checkpoint, 'multilingual', 'config().checkpoint');
            eq([cfg.tokenizer, cfg.max_len, cfg.hidden_size], ['metaspace-bpe', 1024, 768], 'mmBERT shape');
            check(text('#brand-sub').includes('1024-token'), 'header: ' + text('#brand-sub'));
            const foreign = presets().filter((b) => b.classList.contains('foreign'));
            check(foreign.length >= 5, 'non-English presets: ' + foreign.length);
            for (const id of ['hi-duplicate', 'es-outage', 'zh-security']) {
                const d = decideWith(id).answers.department;
                console.log('  ' + id + ': ' + d.choice + ' | ' + text('#decision-head'));
            }
            shot('multilingual');
        });
    } else {
        console.log('  (no multilingual/ checkpoint beside ' + session.modelDir + ')');
    }
} finally {
    if (traffic.running) q('#btn-traffic').click();
    prefs.restore(saved);
}
done('laya-triage');
