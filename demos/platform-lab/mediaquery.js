// mediaquery.js — window.matchMedia + MediaQueryList + real @media CSS.
//
// The single most valuable thing to demonstrate about bro's matchMedia is the
// one guarantee its implementation note makes: matchMedia and @media CANNOT
// disagree, because they run the same evaluator against the same MediaContext.
// A panel that only printed .matches would be believable but unverified. So
// this panel prints, for each query, BOTH:
//
//   - what matchMedia(q).matches says, and
//   - what a hidden probe element styled by `@media q { ... }` in style.css
//     actually computes to.
//
// Those two columns are produced by completely different code paths in the
// engine (a JS binding vs the cascade), and the panel is a lie detector for the
// claim that they agree. The smoke test asserts the agreement numerically.
//
// The second thing worth showing is the listener surface. bro honours the
// {capture, once, signal} options bag — which is NOT what docs/matchmedia-api.js
// says (it documents them as ignored; commit 3fe38731 added them and the doc
// was not updated). Since options are real, the panel exercises them: a plain
// listener, a once listener, and a signal-abortable listener all watch the same
// query, and their differing fire counts after N resizes is the demonstration.

export const mqState = {
    // Live evaluation table
    rows: [],                  // [{ query, mql, matches, cssMatches, probeId }]
    agreements: 0,
    disagreements: 0,
    // Listener experiment
    plainFires: 0,
    onceFires: 0,
    signalFires: 0,
    captureFires: 0,
    legacyFires: 0,
    onchangeFires: 0,
    lastEvent: null,
    abortController: null,
    // Scheme
    schemeSetting: 'system',
    darkMatches: false,
    log: [],
};

// Each row pairs a query string with the id of a probe element that style.css
// styles from the SAME query. Keep the two in sync by hand — that coupling is
// the experiment, so hiding it behind generated CSS would defeat it.
const QUERIES = [
    { query: '(min-width: 800px)',                 probeId: 'mqProbeWide' },
    { query: '(max-width: 700px)',                 probeId: 'mqProbeNarrow' },
    { query: '(orientation: landscape)',           probeId: 'mqProbeLandscape' },
    { query: '(orientation: portrait)',            probeId: 'mqProbePortrait' },
    { query: '(400px <= width <= 1200px)',         probeId: 'mqProbeRange' },
    { query: '(width > 500px)',                    probeId: 'mqProbeGt' },
    { query: 'screen and (min-width: 500px)',      probeId: 'mqProbeScreen' },
    { query: 'print',                              probeId: 'mqProbePrint' },
    { query: '(prefers-color-scheme: dark)',       probeId: 'mqProbeDark' },
    // No probe: the point of these is that a garbage query is FALSE rather
    // than a throw, and there is no CSS counterpart to compare against.
    { query: 'complete garbage',                   probeId: null },
    { query: '(min-width: 3000px), (orientation: landscape)', probeId: null },
];

function logLine(text) {
    mqState.log.push(text);
    if (mqState.log.length > 40) mqState.log.shift();
    const el = document.getElementById('mqLog');
    if (el) {
        el.textContent = mqState.log.slice(-12).join('\n');
        el.scrollTop = el.scrollHeight;
    }
}

// ── The evaluation table ────────────────────────────────────────────────────

export function buildQueryTable() {
    const host = document.getElementById('mqTable');
    mqState.rows = [];

    for (const spec of QUERIES) {
        const mql = window.matchMedia(spec.query);
        const row = {
            query: spec.query, mql, probeId: spec.probeId,
            matches: mql.matches, cssMatches: null, el: null,
        };

        if (host) {
            const div = document.createElement('div');
            div.className = 'mq-row';
            div.innerHTML =
                '<span class="mq-q mono"></span>' +
                '<span class="mq-js pill"></span>' +
                '<span class="mq-css pill"></span>' +
                '<span class="mq-verdict"></span>';
            div.children[0].textContent = spec.query;
            host.appendChild(div);
            row.el = div;
        }
        mqState.rows.push(row);
    }
}

// A probe reports its @media state through a property the cascade can flip and
// getComputedStyle can read back unambiguously. `order` is ideal: it is an
// integer, it inherits from nothing, and no other rule in the app touches it.
// Reading a colour would work too but invites rounding/format arguments.
function cssSaysMatches(probeId) {
    if (!probeId) return null;
    const el = document.getElementById(probeId);
    if (!el) return null;
    return getComputedStyle(el).order === '1';
}

export function evaluateAll() {
    mqState.agreements = 0;
    mqState.disagreements = 0;

    for (const row of mqState.rows) {
        // .matches is LIVE — this read re-evaluates against the current
        // context, so it is already correct immediately after a resize, before
        // any change event has been delivered.
        row.matches = row.mql.matches;
        row.cssMatches = cssSaysMatches(row.probeId);

        if (row.cssMatches !== null) {
            if (row.cssMatches === row.matches) mqState.agreements++;
            else mqState.disagreements++;
        }

        if (row.el) {
            row.el.children[1].textContent = row.matches ? 'true' : 'false';
            row.el.children[1].className = 'mq-js pill ' + (row.matches ? 'yes' : 'no');
            row.el.children[2].textContent =
                row.cssMatches === null ? 'n/a' : (row.cssMatches ? 'true' : 'false');
            row.el.children[2].className = 'mq-css pill ' +
                (row.cssMatches === null ? 'na' : (row.cssMatches ? 'yes' : 'no'));
            const agree = row.cssMatches === null || row.cssMatches === row.matches;
            row.el.children[3].textContent = row.cssMatches === null ? '—' : (agree ? '✓ agree' : '✗ DISAGREE');
            row.el.children[3].className = 'mq-verdict ' + (agree ? 'ok' : 'bad');
        }
    }

    setText('mqAgree', String(mqState.agreements));
    setText('mqDisagree', String(mqState.disagreements));
    setText('mqViewport', `${window.innerWidth} × ${window.innerHeight}`);
    return { agreements: mqState.agreements, disagreements: mqState.disagreements };
}

// ── The listener experiment ─────────────────────────────────────────────────
//
// Six registrations on ONE query, differing only in how they were registered.
// After k flips the expected counts are: plain=k, once=1, capture=k,
// legacy=k, onchange=k, signal=(flips before abort). Any deviation is a real
// bug in the listener bookkeeping, and the counts are readable at a glance.

// Deliberately chosen so a resize between the two demo sizes flips it.
export const LISTENER_QUERY = '(min-width: 900px)';
export let listenerMql = null;

export function installListeners() {
    listenerMql = window.matchMedia(LISTENER_QUERY);
    mqState.plainFires = mqState.onceFires = mqState.signalFires = 0;
    mqState.captureFires = mqState.legacyFires = mqState.onchangeFires = 0;

    listenerMql.addEventListener('change', onPlain);

    // once:true — removed BEFORE invocation per spec, so it can never fire twice
    // even if the handler itself triggers another flip.
    listenerMql.addEventListener('change', onOnce, { once: true });

    // capture has no propagation meaning on a MediaQueryList (it is not in a
    // tree) but it IS part of listener identity, so this registers separately
    // from onPlain even though the callback differs only by name.
    listenerMql.addEventListener('change', onCapture, { capture: true });

    // An AbortSignal is how modern code unsubscribes without keeping the
    // function reference around. abortListeners() below cuts it.
    mqState.abortController = new AbortController();
    listenerMql.addEventListener('change', onSignal, { signal: mqState.abortController.signal });

    // Legacy pre-2020 aliases, still shipped by many libraries.
    listenerMql.addListener(onLegacy);

    // The handler property is a third, independent registration slot.
    listenerMql.onchange = onOnChange;

    // Registering the same function twice must register it ONCE (spec). If
    // this were broken, plainFires would run at double rate against capture.
    listenerMql.addEventListener('change', onPlain);

    logLine(`listeners installed on ${LISTENER_QUERY}`);
    return listenerMql;
}

function record(ev, which) {
    // The event is a MediaQueryListEvent-SHAPED plain object, not a real Event
    // — {type, matches, media, target, currentTarget} and nothing else. The
    // panel prints exactly those five so the shape is visible rather than
    // asserted only in the test.
    mqState.lastEvent = {
        which, type: ev.type, matches: ev.matches, media: ev.media,
        targetIsMql: ev.target === listenerMql,
        currentTargetIsMql: ev.currentTarget === listenerMql,
    };
    logLine(`change[${which}] matches=${ev.matches} media=${ev.media}`);
    renderListenerCounts();
}

function onPlain(ev)   { mqState.plainFires++;    record(ev, 'plain'); }
function onOnce(ev)    { mqState.onceFires++;     record(ev, 'once'); }
function onCapture(ev) { mqState.captureFires++;  record(ev, 'capture'); }
function onSignal(ev)  { mqState.signalFires++;   record(ev, 'signal'); }
function onLegacy(ev)  { mqState.legacyFires++;   record(ev, 'legacy'); }
function onOnChange(ev){ mqState.onchangeFires++; record(ev, 'onchange'); }

// Detach everything from the CURRENT list, then install a fresh set. Without
// the detach, installListeners() alone would leave the old list's listeners
// registered — a MediaQueryList with listeners is realm-pinned and keeps firing
// even after the app drops its reference, so the counters would double-count
// against a list nobody holds any more. That pinning is documented behaviour,
// not a leak, but it means "start over" has to mean removing first.
export function resetListeners() {
    if (listenerMql) {
        listenerMql.removeEventListener('change', onPlain);
        listenerMql.removeEventListener('change', onOnce, { once: true });
        listenerMql.removeEventListener('change', onCapture, { capture: true });
        listenerMql.removeEventListener('change', onSignal);
        listenerMql.removeListener(onLegacy);
        listenerMql.onchange = null;
    }
    if (mqState.abortController) mqState.abortController.abort();
    logLine('listeners reset');
    return installListeners();
}

export function abortListeners() {
    if (mqState.abortController) mqState.abortController.abort();
    logLine('AbortController.abort() — signal listener detached');
}

export function removePlainListener() {
    if (listenerMql) listenerMql.removeEventListener('change', onPlain);
    logLine('removeEventListener(change, onPlain)');
}

// removeEventListener must match on (type, callback, capture). Removing
// onCapture WITHOUT the capture flag must therefore NOT remove it — that is the
// identity rule, and it is easy to get wrong.
export function removeCaptureListenerWrongly() {
    if (listenerMql) listenerMql.removeEventListener('change', onCapture);
    logLine('removeEventListener(change, onCapture) — no capture flag, should NOT remove');
}

export function removeCaptureListenerProperly() {
    if (listenerMql) listenerMql.removeEventListener('change', onCapture, { capture: true });
    logLine('removeEventListener(change, onCapture, {capture:true}) — removed');
}

export function clearOnChange() {
    if (listenerMql) listenerMql.onchange = null;
    logLine('onchange = null');
}

function renderListenerCounts() {
    setText('mqPlainCount', String(mqState.plainFires));
    setText('mqOnceCount', String(mqState.onceFires));
    setText('mqCaptureCount', String(mqState.captureFires));
    setText('mqSignalCount', String(mqState.signalFires));
    setText('mqLegacyCount', String(mqState.legacyFires));
    setText('mqOnChangeCount', String(mqState.onchangeFires));
    const ev = mqState.lastEvent;
    setText('mqLastEvent', ev
        ? `${ev.which}: {type:${ev.type}, matches:${ev.matches}, media:"${ev.media}", target:mql=${ev.targetIsMql}}`
        : '—');
}

// ── prefers-color-scheme ────────────────────────────────────────────────────
//
// The scheme is not a window property — it is the appearance.colorScheme
// setting resolved against the OS theme. Flipping the setting is what fires
// change on every prefers-color-scheme list, and it also drives the app's own
// dark theme through @media in style.css. So one setting write moves the whole
// page and every readout, which is the demonstration.

export function setScheme(scheme) {
    mqState.schemeSetting = scheme;
    bro.settings.set('appearance.colorScheme', scheme);
    logLine(`appearance.colorScheme = ${scheme}`);
    setText('mqScheme', scheme);
    return scheme;
}

export function darkQuery() {
    return window.matchMedia('(prefers-color-scheme: dark)');
}

// ── Frame ───────────────────────────────────────────────────────────────────

export function tickMediaQueries() {
    evaluateAll();
    mqState.darkMatches = darkQuery().matches;
    setText('mqDark', mqState.darkMatches ? 'dark' : 'light');
    renderListenerCounts();
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

export function initMediaQueries() {
    buildQueryTable();
    installListeners();
    evaluateAll();

    bind('mqSchemeLight', () => setScheme('light'));
    bind('mqSchemeDark', () => setScheme('dark'));
    bind('mqSchemeSystem', () => setScheme('system'));
    bind('mqAbort', abortListeners);
    bind('mqRemovePlain', removePlainListener);
    bind('mqNarrow', () => resizeViewport(700, 900));
    bind('mqWide', () => resizeViewport(1600, 1000));

    // A resize listener is the recommended fallback in secondary windows (where
    // change events are documented not to fire) and costs nothing here.
    window.addEventListener('resize', () => { evaluateAll(); });
}

// bro.window.setSize is the windowed path; headless tests call the global
// resize(w, h) directly. Both land in the same MediaContext update.
function resizeViewport(w, h) {
    if (bro.window && bro.window.setSize) bro.window.setSize(w, h);
    logLine(`requested viewport ${w}x${h}`);
}

function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}

export { QUERIES };
