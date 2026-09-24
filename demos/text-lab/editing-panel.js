// editing-panel.js — the Editing panel: scenario reports plus the live playground.

import { utf8Length, u16ToU8, caretStops } from '/lib/kit/text.js';
import { clear } from '/lib/kit/dom.js';
import { n2, table, verdict, result, note, caseBox } from '/app/report.js';
import { CAN_DRIVE, hostOpts, selectionSnapshot } from '/app/input.js';
import { setStage, clearStage, steppingReportAll, boundaryReport, emptyHostReport, rtlReportAll,
         caretGeometryReport, STEP_SAMPLES } from '/app/editing.js';

export const editState = {
    available: CAN_DRIVE,
    stepping: null,
    boundary: null,
    emptyHost: null,
    rtl: null,
    caretGeometry: null,
    live: null,
};

let ui = null;

export function initEditing() {
    const $ = (id) => document.getElementById(id);
    setStage($('editStage'));
    ui = {
        stepping: table($('editStepping'),
            ['sample', 'utf16', 'bytes', 'arrow stops (RIGHT)', 'shaper stops', 'symmetric', 'no split', 'agree'],
            STEP_SAMPLES.length),
        steppingNote: $('editSteppingNote'),
        boundary: $('editBoundary'),
        empty: table($('editEmpty'), ['case', 'rangeCount', 'collapsed', 'typing landed', 'verdict'], 4),
        rtl: $('editRtl'), geometry: $('editGeometry'),
        live: $('editLive'), liveReadout: $('editLiveReadout'),
    };
    // The playground: not a test, the part a human drives. Click in, type an
    // emoji, arrow over it, and watch the three coordinate systems move.
    document.addEventListener('selectionchange', updateLiveReadout);
    ui.live.addEventListener('input', updateLiveReadout);
    ui.live.addEventListener('keyup', updateLiveReadout);
    updateLiveReadout();
    refreshEditing();
}

/** The same caret offset in all three coordinate systems, side by side. */
export function updateLiveReadout() {
    if (!ui) return;
    const sel = window.getSelection();
    const snap = selectionSnapshot();
    const focus = sel && sel.focusNode;
    const inHost = !!focus && (focus === ui.live || ui.live.contains(focus));
    const text = ui.live.textContent;
    let detail = '';
    if (inHost && focus.nodeType === 3 && snap.focusOffset !== null) {
        const data = focus.data, byte = u16ToU8(data, snap.focusOffset);
        const stops = caretStops(data, hostOpts());
        detail = ` — caret at UTF-16 ${snap.focusOffset} = UTF-8 byte ${byte} of ${utf8Length(data)}; that offset ` +
            `${stops.indexOf(byte) !== -1 ? 'IS' : 'is NOT'} one of the shaper's ${stops.length} cluster stops`;
    }
    editState.live = { snap, inHost, text };
    ui.liveReadout.textContent =
        `anchor ${snap.anchorName}@${snap.anchorOffset} · focus ${snap.focusName}@${snap.focusOffset} · ` +
        `${snap.collapsed === null ? 'no range' : snap.collapsed ? 'collapsed' : 'selection "' + snap.text + '"'} · ` +
        `host text ${JSON.stringify(text)} (${text.length} u16, ${utf8Length(text)} bytes)` + detail;
    ui.liveReadout.className = 'result' + (inHost ? ' ok' : '');
}

export function refreshEditing() {
    editState.available = CAN_DRIVE;
    if (!CAN_DRIVE) {
        note(ui.steppingNote, false,
            'These scenarios drive the engine through keyDown/textInput/mouseDown, which exist only under ' +
            'bro-headless: run the tests to see them. The live playground below works here.');
    } else {
        renderStepping(editState.stepping = steppingReportAll());
        renderBoundary(editState.boundary = boundaryReport());
        renderEmpty(editState.emptyHost = emptyHostReport());
        renderRtl(editState.rtl = rtlReportAll());
    }
    renderGeometry(editState.caretGeometry = caretGeometryReport());
    // A scenario's leftover host is not something a reader should see.
    clearStage();
}

function renderStepping(steps) {
    steps.forEach((r, i) => {
        const c = ui.stepping[i];
        [`${r.text}  — ${r.label}`, r.utf16, r.bytes, r.forward.join(' → '), r.shaperStops.join(' → ')]
            .forEach((v, k) => { c[k].textContent = v; });
        verdict(c[5], r.symmetric, r.symmetric ? 'yes' : 'NO — left ≠ right');
        const clean = r.noSplitSurrogates && r.onCodePointBoundaries;
        verdict(c[6], clean, clean ? 'clean' : 'SPLITS');
        verdict(c[7], r.matchesShaper, r.matchesShaper ? 'key handler = shaper' : 'DISAGREE');
    });
    const bad = steps.filter((r) => !r.matchesShaper);
    note(ui.steppingNote, bad.length === 0,
        "Oracle is caretStops() — the shaper's own answer for the same string, via bro.text.clusterRange(), " +
        'converted from bytes to UTF-16. ' +
        (bad.length === 0 ? 'The key handler and the shaper name the same positions in every sample.'
                          : `${bad.length} sample(s) disagree: ` +
                            bad.map((r) => `${r.label} keys [${r.forward}] vs shaper [${r.shaperStops}]`).join(' | ')));
}

function renderBoundary(bounds) {
    clear(ui.boundary);
    for (const b of bounds) {
        ui.boundary.appendChild(caseBox(b.ok, b.label, b.why,
            `in:  ${JSON.stringify(b.html)}\nout: ${JSON.stringify(b.gotHTML)}` + (b.threw ? `\nTHREW: ${b.threw}` : ''),
            b.checks.map((k) => ({ ok: k.ok,
                text: `${k.name}: want ${JSON.stringify(k.want)}` + (k.ok ? '' : `, got ${JSON.stringify(k.got)}`) }))));
    }
}

function renderEmpty(rows) {
    rows.forEach((r, i) => {
        const c = ui.empty[i];
        c[0].textContent = r.label;
        c[1].textContent = r.rangeCount;
        c[2].textContent = r.collapsed === null ? '—' : r.collapsed ? 'yes' : 'no';
        c[3].textContent = r.typed;
        if (!r.ok && r.engineIssue) verdict(c[4], null, 'ENGINE BUG — ' + r.engineIssue);
        else verdict(c[4], r.ok, r.ok ? 'as specified' : 'WRONG — want ' + r.want);
    });
}

function renderRtl(reports) {
    clear(ui.rtl);
    for (const r of reports) {
        const ok = r.symmetric && r.matchesShaper && r.rightIncreases && r.backspaceOk && r.typeOk;
        ui.rtl.appendChild(caseBox(ok, `${r.label} (direction:${r.dir})`, r.why,
            `text ${JSON.stringify(r.text)} — ${r.utf16} u16, ${r.bytes} bytes\n` +
            `RIGHT walk  ${r.forward.join(' → ')}\nLEFT  walk  ${r.backward.join(' → ')}\n` +
            `shaper      ${r.shaperStops.join(' → ')}`,
            [
                { ok: r.rightIncreases, text: 'RIGHT always increases the logical offset, inside the RTL run too' },
                { ok: r.symmetric, text: 'LEFT retraces the RIGHT walk exactly' },
                { ok: r.matchesShaper, text: "the key handler's stops equal the shaper's cluster stops" },
                { ok: r.rtlStopCount === r.wantRtlStopCount,
                  text: `every RTL letter is one stop (${r.rtlStopCount} of ${r.wantRtlStopCount} in the run)` },
                { ok: r.backspaceOk, text: `Backspace in the RTL run removes one whole letter: ` +
                  JSON.stringify(r.afterBackspace) + (r.backspaceOk ? '' : ` — want ${JSON.stringify(r.wantBackspace)}`) },
                { ok: r.typeOk, text: `typing lands at the logical offset: ${JSON.stringify(r.afterType)}` +
                  (r.typeOk ? '' : ` — want ${JSON.stringify(r.wantType)}`) },
            ]));
    }
}

function renderGeometry(g) {
    result(ui.geometry, g.ok,
        `Collapsed Range rects at every caret offset in ${JSON.stringify(g.text)}: ` +
        g.rows.map((r) => `${r.u16}:${n2(r.x)}`).join('  ') + '. ' +
        `LTR head x rises: ${g.ltrHeadRises ? 'yes' : 'NO'}. ` +
        `RTL run x falls (logically-next is visually leftward): ${g.rtlFalls ? 'yes' : 'NO'}. ` +
        `LTR tail x rises: ${g.ltrTailRises ? 'yes' : 'NO'}. ` +
        `Boundary offsets 4 and 7 sit on an edge of the RTL run [${n2(g.run.left)}, ${n2(g.run.right)}]: ` +
        `${g.boundariesOnEdges ? 'yes' : 'NO'}` +
        (g.boundaryShares.length ? ` (they share x=${g.boundaryShares.map((c) => c.x).join(',')}, ` +
            'as any consistent caret affinity makes them)' : '') + '. ' +
        (g.noCollisions ? 'No other offsets share an x.'
                        : `${g.collisions.length} x value(s) shared by several offsets — ` +
                          g.collisions.map((c) => `x=${c.x} ← offsets ${c.offsets.join(',')}`).join('; ') +
                          ' — a caret the user cannot place unambiguously.') +
        (g.noOriginRects ? '' : ` Collapsed rects at the origin {0,0} instead of at the caret: offsets ${g.originRects.join(',')}.`));
}
