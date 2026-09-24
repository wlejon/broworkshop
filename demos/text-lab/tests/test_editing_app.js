// test_editing_app.js — Text Lab, part 4: contenteditable editing driven
// through the headless injection surface, then the app itself (idempotence,
// its own verdicts, the nav, the playground, resize stability), then a
// printout of the text surface's known gaps.
//
// Run: scripts/validate.sh demos/text-lab
//
// keyDown/textInput/mouseDown put the engine's key handler, hit test, focus
// resolution and contenteditable mutation path all under test. A synthesised
// DOM event would skip all four.

import { check as assert, test, done, frames, q, clickOn, shot } from '/lib/kit/test.js';
import { CAN_DRIVE, K, press, typeText, clickInto } from '/app/input.js';
import { steppingReportAll, boundaryReport, emptyHostReport, rtlReportAll, caretGeometryReport } from '/app/editing.js';
import { editState } from '/app/editing-panel.js';
import { domReorderProbe } from '/app/bidi.js';
import { domAgreementReport } from '/app/metrics.js';
import { scriptState } from '/app/scripts.js';
import { clusterState } from '/app/clusters.js';
import { stats, refreshAll, panelVerdicts, knownLimitations, PANELS } from '/app/lab.js';

resize(1600, 1000);
frames(4);

// =============================================================================
// 7. EDITING
// =============================================================================

test('editing: injection is available under bro-headless', () => {
    assert(CAN_DRIVE, 'keyDown/keyUp/textInput/mouseDown/mouseUp are all present');
    assert(q('#injectAvailable').classList.contains('ok'), 'and the header chip says so');
});

test('editing: arrow stepping lands exactly where the shaper says', () => {
    for (const r of steppingReportAll()) {
        assert(r.monotonic && r.reachedEnd && r.reachedStart,
            `${r.label}: RIGHT makes progress to the end and LEFT back to the start — forward [${r.forward}]`);
        assert(r.symmetric,
            `${r.label}: LEFT retraces the RIGHT walk exactly — forward [${r.forward}] backward [${r.backward}]`);
        assert(r.noSplitSurrogates && r.onCodePointBoundaries,
            `${r.label}: no stop lands inside a character — forward [${r.forward}]`);
        assert(r.matchesShaper,
            `${r.label}: the key handler's stops ARE the shaper's cluster stops. ` +
            `handler [${r.forward}] vs shaper [${r.shaperStops}]`);
    }
});

test('editing: boundary cases', () => {
    for (const b of boundaryReport()) {
        assert(b.ok, `${b.label}: ${b.why}. failed: ` +
            b.checks.filter((c) => !c.ok)
                .map((c) => `${c.name} want ${JSON.stringify(c.want)} got ${JSON.stringify(c.got)}`).join('; '));
    }
});

// A row that fails on a logged engine bug must say so (engineIssue), and is
// reported rather than failed; every other row must pass.
test('editing: empty hosts', () => {
    const rows = emptyHostReport();
    assert(rows.length === 4, 'four empty-host cases, got ' + rows.length);
    for (const r of rows) {
        if (!r.ok && r.engineIssue) {
            console.log(`  KNOWN ENGINE ISSUE — ${r.label}: ${r.engineIssue}; got rangeCount ${r.rangeCount}`);
            continue;
        }
        assert(r.ok, `${r.label} (${r.why}): ${r.want} — got rangeCount ${r.rangeCount}, ` +
            `caret on host ${r.onHost}, typed ${JSON.stringify(r.typed)}`);
    }
    assert(rows.filter((r) => r.engineIssue).every((r) => r.id === 'plain'),
        'only the non-editable control can be excused by an engine issue');
});

test('editing: inside bidi text', () => {
    for (const r of rtlReportAll()) {
        assert(r.symmetric && r.matchesShaper && r.rightIncreases && r.reachedEnd,
            `${r.label}: RIGHT always increases the logical offset, inside the reversed ` +
            `run too, and LEFT retraces it — forward [${r.forward}] shaper [${r.shaperStops}]`);
        assert(r.rtlStopCount === r.wantRtlStopCount,
            `${r.label}: every letter in the reversed run is its own stop (${r.rtlStopCount} of ${r.wantRtlStopCount})`);
        assert(r.backspaceOk && r.typeOk && r.wellFormed,
            `${r.label}: Backspace removes one whole letter and typing lands at the logical ` +
            `offset — after backspace ${JSON.stringify(r.afterBackspace)} ` +
            `(want ${JSON.stringify(r.wantBackspace)}), after typing ` +
            `${JSON.stringify(r.afterType)} (want ${JSON.stringify(r.wantType)})`);
    }
});

test('editing: caret geometry across a direction boundary', () => {
    const g = caretGeometryReport();
    assert(g.ltrHeadRises && g.ltrTailRises, 'caret x increases through the left-to-right runs');
    assert(g.rtlFalls,
        'and DECREASES through the interior of the reversed run, staying inside it — ' +
        'logically-next is visually leftward. rows ' + g.rows.map((r) => `${r.u16}:${r.x.toFixed(2)}`).join(' '));
    assert(g.boundariesOnEdges,
        `the direction-boundary offsets 4 and 7 sit on an edge of the RTL run [${g.run.left.toFixed(2)}, ` +
        `${g.run.right.toFixed(2)}], got ${g.rows[4].x.toFixed(2)} and ${g.rows[7].x.toFixed(2)}`);
    assert(g.noOriginRects,
        'every collapsed Range reports its rect AT the caret rather than at {0,0}: ' + JSON.stringify(g.originRects));
    assert(g.noCollisions,
        'no two offsets share one x except the two direction-boundary ones, which any consistent ' +
        'caret affinity maps to the same edge: ' + JSON.stringify(g.collisions));
});

test('editing: the live playground readout follows the caret', () => {
    const live = q('#editLive');
    live.scrollIntoView();
    frames(1);
    clickInto(live, 6, 10);
    press(K.END);
    typeText('Z');
    frames(1);
    assert(live.textContent.endsWith('Z'), 'typing at End appended to the playground: ' + JSON.stringify(live.textContent));
    assert(editState.live && editState.live.inHost, 'the readout sees the caret inside the playground');
    assert(/caret at UTF-16 \d+ = UTF-8 byte \d+/.test(q('#editLiveReadout').textContent),
        'and prints it in both offset systems: ' + q('#editLiveReadout').textContent);
    assert(/IS one of the shaper/.test(q('#editLiveReadout').textContent), 'at a legal cluster stop');
    press(K.BACKSPACE);
    assert(!live.textContent.endsWith('Z'), 'Backspace removed it again');
});

// =============================================================================
// 8. THE APP ITSELF
// =============================================================================

// Running every driver a second time must not change any verdict: this
// catches a panel that accumulates into its own report.
test('app: panels are idempotent', () => {
    const before = JSON.stringify(panelVerdicts());
    refreshAll();
    frames(1);
    const after = JSON.stringify(panelVerdicts());
    assert(before === after, 'refreshing every panel a second time produced identical verdicts: ' + before + ' vs ' + after);
});

// If a panel showed green while these tests said red, the panel would be
// lying to a human reader, which is its own bug.
test('app: every panel\'s own verdict is green, and the nav says so', () => {
    const v = panelVerdicts();
    for (const k in v) assert(v[k] === true, `the ${k} panel's own verdict is green`);
    const marks = [...document.querySelectorAll('#nav button.nav .mark')].map((m) => m.textContent);
    assert(marks.length === PANELS.length && marks.every((m) => m === 'ok'), 'every nav mark reads ok: ' + marks);
    assert(new RegExp(`${PANELS.length}/${PANELS.length} panels green`).test(q('#status').textContent),
        'the status bar reports all panels green: ' + q('#status').textContent);
});

test('app: the Re-run button re-runs without changing a verdict', () => {
    const before = JSON.stringify(panelVerdicts());
    clickOn('#rerun');
    frames(1);
    assert(JSON.stringify(panelVerdicts()) === before, 'verdicts unchanged after Re-run');
    assert(/panels green/.test(q('#status').textContent), 'and the status bar was restored');
});

test('app: the nav scrolls each panel into view', () => {
    const main = q('#main');
    for (const p of PANELS) {
        clickOn(`#nav button.nav[data-panel="${p.id}"]`);
        frames(1);
        const top = document.getElementById(p.section).getBoundingClientRect().top - main.getBoundingClientRect().top;
        assert(top > -2 && top < 40 || main.scrollTop + main.clientHeight >= main.scrollHeight - 2,
            `${p.title}: section top lands at the top of #main (offset ${top.toFixed(1)})`);
    }
    main.scrollTop = 0;
    frames(1);
});

test('app: the frame loop keeps running', () => {
    advanceTime(300);
    flush();
    assert(stats.frames > 10, 'the rAF loop kept running, frames = ' + stats.frames);
});

// Nothing in this lab is viewport-relative: the DOM cross-checks must hold at
// a different width.
test('app: resize stability', () => {
    resize(1280, 900);
    frames(4);
    const d = domReorderProbe();
    assert(d.wholeMatchesShaped && d.alefRightOfBet && d.alefMatches,
        'the bidi DOM probe still agrees with the shaper after a resize');
    assert(domAgreementReport().every((r) => r.agrees), 'and layout still agrees with canvas measureText at the new width');
    resize(1600, 1000);
    q('#main').scrollTop = 0;
    frames(2);
    shot('text-lab');
});

// =============================================================================
// SURFACE GAPS — what the text APIs do not expose
// =============================================================================
//
// Absent APIs rather than wrong answers. Printed, not asserted — each entry
// is computed live, so an entry that gains an API flips to "resolved".

console.log('');
console.log('  text surface gaps observed by this run:');
for (const lim of knownLimitations()) {
    console.log(`    [${lim.stillPresent ? 'PRESENT ' : 'resolved'}] ${lim.id}`);
    console.log(`        ${lim.what}`);
    console.log(`        evidence: ${lim.evidence}`);
}
console.log('');
console.log('  font coverage on this machine:');
for (const c of scriptState.coverage) {
    console.log(`    ${c.rendered ? 'ok  ' : 'TOFU'} ${c.name.padEnd(16)} ` +
        `${c.codePoints} cp / ${c.bytes} B → ${c.clusters} clusters → ${c.glyphs} glyphs`);
}
for (const a of clusterState.astral) {
    const tag = !a.expectFused ? 'n/a ' : (a.fused ? 'ok  ' : 'SPLIT');
    console.log(`    ${tag} ${a.label.padEnd(30)} ${a.clusters} cluster(s), ${a.caretStops} caret stop(s)`);
}
console.log('');

done('text-lab editing + app');
