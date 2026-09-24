// Listen Lab — tier-2 keyword spotting: one kws session per stream over the
// shared PhonemeNet, the template rows (bro.kws.progress for the active
// stream), the mid-phrase "arm" moment, and the token panel
// (bro.kws.inspect: see and edit what a template became).
//
// The phrase vocabulary is the master (bro.kws = the mic's matcher). Each added
// stream mirrors it onto its own session (enrollFromClasses replays decoded
// class ids over the SHARED net; rhythm/gap templates can't round-trip, so
// they are skipped). Every stream listens independently and fires onto its
// own dashboard.

import { h, clear } from "/lib/kit/dom.js";
import { D, app, status, fusionRow, phrasePolicy, btn } from "/app/state.js";
import { logEvent, toStreamSpan } from "/app/ring.js";

export const rhythmNames = {};     // name -> true for templates enrolled with gaps
const tmplRows = {};               // name -> { root, fill, meta }

// ── sessions ────────────────────────────────────────────────────────────────

export function mirrorKwsTo(st) {
    if (!st.source.isHandle || !app.kwsReady) return;
    const k = st.source.kws;
    try {
        k.clear();
        for (const name of bro.kws.templates()) {
            const v = bro.kws.inspect(name);
            if (!v || v.hasGaps) continue;
            const cls = v.states.filter((s) => !s.gap).map((s) => s.cls);
            if (cls.length) k.enrollFromClasses(name, cls, phrasePolicy());
        }
    } catch (e) { status('mirror → ' + st.label + ': ' + (e.message || e), true); }
}

function onKwsSpot(st, name, confidence, span) {
    st.spots++;
    const s = st.source.sense.isActive() ? st.source.sense.snapshot() : null;
    fusionRow(st, 'spot', '"' + name + '" completed @ conf ' + confidence.toFixed(3) +
        (s && s.voice ? ' · voice run ' + (s.voiceFrames / 100).toFixed(1) + ' s' : ''));
    // The matcher reports the span on the SPOTTER's frame axis; re-anchor onto
    // the stream axis via the matched DURATION ending ~now (the fire just happened).
    logEvent(st, 'spot', name, confidence, '', null, toStreamSpan(span, s));
    st.armState[name] = false;
    if (st === app.active) { flashRow(name); D.spotCount.textContent = String(st.spots); }
}

export function startStreamKws(st) {
    if (st.kwsListening) return;
    st.source.kws.listen({ onSpot: (name, conf, span) => onKwsSpot(st, name, conf, span) });
    st.kwsListening = true;
    updateListenButton();
}

export function stopStreamKws(st) {
    try { st.source.kws.stop(); } catch (e) { /* not listening */ }
    st.kwsListening = false;
    updateListenButton();
}

export function updateListenButton() {
    const on = !!(app.active && app.active.kwsListening);
    D.listen.textContent = on ? 'Stop' : 'Listen';
    D.listen.classList.toggle('active', on);
    D.listen.disabled = !app.kwsReady || bro.kws.templates().length === 0;
}

/**
 * Template mutators share each spotter's feed thread, so they are rejected
 * while listening: bounce EVERY stream's session around the master mutation,
 * then re-mirror the vocabulary onto the handle streams and restart them all.
 */
export function withMutableSpotter(fn) {
    for (const st of app.streams.filter((s) => s.kwsListening)) stopStreamKws(st);
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    for (const st of app.streams) {
        if (st.source.isHandle) mirrorKwsTo(st);
        if (bro.kws.templates().length) startStreamKws(st);
    }
    updateListenButton();
}

export function enrollPhrase() {
    const text = D.phrase.value.trim();
    if (!text || !app.kwsReady) return;
    withMutableSpotter(() => {
        const len = bro.kws.enroll(text, bro.tts.phonemize(text), phrasePolicy());
        status('enrolled "' + text + '" (' + len + ' phoneme classes)');
        fusionRow(app.active, 'info', 'enrolled phrase "' + text + '" (' + len + ' classes)');
        D.phrase.value = '';
    });
}

// ── template rows (bro.kws.progress for the ACTIVE stream) ──────────────────

function rebuildTemplateRows(st, p) {
    for (const k of Object.keys(tmplRows)) { tmplRows[k].root.remove(); delete tmplRows[k]; }
    D.noTmpls.style.display = p.templates.length ? 'none' : '';
    for (const t of p.templates) {
        const fill = h('div.tfill'), meta = h('span.tmeta');
        const tok = h('button.tok', { title: 'show the decoded token sequence' }, '⋯');
        const root = h('div.tmpl', null,
            h('div.trow', null,
                h('span.tname', null, t.name),
                rhythmNames[t.name] ? h('span.badge', null, 'rhythm') : null,
                tok,
                h('button.rm', {
                    onclick: () => withMutableSpotter(() => { bro.kws.remove(t.name); delete rhythmNames[t.name]; }),
                }, '×')),
            h('div.tbar', null, fill),
            meta);
        tok.addEventListener('click', () => toggleTokens(t.name, root, tok));
        D.tmpls.appendChild(root);
        tmplRows[t.name] = { root, fill, meta };
        st.lastCompletions[t.name] = t.completions;
    }
    D.listen.disabled = !app.kwsReady || p.templates.length === 0;
}

/** Progress bars + the arm moment, from the active stream's kws.progress(). */
export function updateTemplateRows(st, p, s) {
    if (p.generation !== st.lastGeneration) {
        st.lastGeneration = p.generation;
        rebuildTemplateRows(st, p);
    }
    for (const t of p.templates) {
        const row = tmplRows[t.name];
        if (!row) continue;
        row.fill.style.width = (t.progress * 100).toFixed(0) + '%';
        row.meta.textContent = t.matched + '/' + t.length +
            ' · conf ' + t.confidence.toFixed(2) + ' · fires ' + t.completions;
        if (t.completions > (st.lastCompletions[t.name] || 0)) flashRow(t.name);
        st.lastCompletions[t.name] = t.completions;

        // The fusion moment: most of a template has aligned and its partial
        // confidence is already in threshold territory, which is where a heavier
        // tier would arm, seconds before any onSpot fires.
        if (!st.armState[t.name] && t.matched < t.length && t.progress >= 0.5) {
            st.armState[t.name] = true;
            fusionRow(st, 'arm', '"' + t.name + '" ' + t.matched + '/' + t.length +
                ' aligned @ conf ' + t.confidence.toFixed(2) +
                (s && s.voice ? ' · voice live' : '') + ' — confirmation tier would arm here');
            logEvent(st, 'arm', t.name, t.confidence, '', { matched: t.matched, length: t.length });
        } else if (st.armState[t.name] && t.progress < 0.3) {
            st.armState[t.name] = false;
        }
    }
}

/** Force the template rows to rebuild against the active stream (tab switch). */
export function forceTemplateRebuild() { if (app.active) app.active.lastGeneration = -1; }

function flashRow(name) {
    const row = tmplRows[name];
    if (!row) return;
    row.root.classList.add('fired');
    setTimeout(() => { if (tmplRows[name] === row) row.root.classList.remove('fired'); }, 600);
}

// ── token panel ─────────────────────────────────────────────────────────────

function toggleTokens(name, root, tokBtn) {
    const existing = root.querySelector('.tokens');
    if (existing) { existing.remove(); tokBtn.classList.remove('open'); return; }
    const view = bro.kws.inspect(name);
    if (!view) { status('inspect: no template "' + name + '"', true); return; }
    tokBtn.classList.add('open');
    const panel = h('div.tokens');
    const fresh = () => view.states.map((s) => Object.assign({}, s));
    let edited = fresh();

    function render() {
        clear(panel);
        panel.appendChild(h('div.chips', null, edited.map((s, i) => {
            const label = s.gap
                ? 'gap ' + Math.round(s.gapLo * view.frameMs) + '–' + Math.round(s.gapHi * view.frameMs) + ' ms'
                : s.label;
            return h('span.chip' + (s.gap ? '.gap' : ''), null, label,
                !s.gap && !view.hasGaps
                    ? h('button.x', { title: 'drop this token', onclick: () => { edited.splice(i, 1); render(); } }, '×')
                    : null);
        })));
        if (view.hasGaps) {
            panel.appendChild(h('span.tokhint', null,
                'rhythm template — speech tokens are approximate; the timed gaps carry the gesture'));
            return;
        }
        const changed = edited.length !== view.states.length;
        panel.appendChild(h('div.tokedit', null,
            btn('apply edit', () => withMutableSpotter(() => {
                const cls = edited.filter((s) => !s.gap).map((s) => s.cls);
                bro.kws.enrollFromClasses(name, cls, phrasePolicy());
                status('edited "' + name + '" → ' + cls.length + ' tokens');
                fusionRow(app.active, 'info', 'edited "' + name + '" to ' + cls.length + ' tokens');
            }), { disabled: !changed || edited.length === 0 }),
            btn('reset', () => { edited = fresh(); render(); }, { disabled: !changed })));
    }
    render();
    root.appendChild(panel);
}
