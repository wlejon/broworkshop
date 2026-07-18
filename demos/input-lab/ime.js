// ime.js — composition events: the preedit, its range, and the commit.
//
// An IME does not type characters, it composes them. Between the first keypress
// and the final commit the control holds PROVISIONAL text — the preedit — which
// is in `.value` and visible to the user but is not yet part of the document's
// real content. Getting this wrong is how apps end up with duplicated CJK text
// or a search box that fires a query per keystroke of a half-typed word.
//
// The contract bro implements, verified against the runtime:
//
//   compositionstart    fires once, `data` is "". NOTE: bro dispatches events
//                       AFTER the mutation, so `.value` ALREADY contains the
//                       first preedit chunk by the time this handler runs.
//   compositionupdate   one per preedit revision, `data` = the whole current
//                       preedit (not a delta), followed by `input` with
//                       inputType "insertCompositionText".
//   compositionend      `data` = the committed string. This is the ONLY event
//                       an app should treat as real input.
//
// The composition range is derivable rather than exposed: at the first update,
// `selectionStart - data.length` is where the preedit begins, and it stays put
// for the rest of the composition. `selectionStart` itself is the composition
// cursor (imeCompose's optional cursorPos argument moves it inside the preedit).
//
// A cancel is not a commit of "": it restores the value and selection from
// before compositionstart and leaves no undo entry. So a field that already
// held text keeps that text — cancel is an undo of the composition, not a
// clear of the field.
//
// The "compose this" buttons drive the headless IME seams so the panel is
// demonstrable without a CJK IME installed. Those globals only exist under
// bro-headless; in a window the buttons disable themselves and the field is
// wired to whatever real IME the OS provides.

export const imeState = {
    composing: false,
    preedit: '',
    rangeStart: -1,
    rangeEnd: -1,
    caret: -1,
    committed: '',      // data from the last compositionend
    updates: 0,
    compositions: 0,    // completed start..end cycles
    cancelled: 0,
    events: [],         // {type, data, value} newest last
    headless: false,
};

let input, logRows = [];
const LOG_ROWS = 12;

// Whether the injection seams exist. They are headless globals, so this is also
// the honest answer to "can this panel drive itself?".
const hasSeams = () => typeof globalThis.imeCompose === 'function' &&
                       typeof globalThis.imeCommit === 'function' &&
                       typeof globalThis.imeCancel === 'function';

export function initImePanel() {
    input = document.getElementById('imeInput');
    imeState.headless = hasSeams();

    const rows = document.getElementById('imeReadout');
    rows.innerHTML = READOUT.map((k, i) =>
        `<div class="row"><span>${k}</span><b id="ival${i}">—</b></div>`).join('');

    const logEl = document.getElementById('imeLog');
    logEl.innerHTML = '';
    for (let i = 0; i < LOG_ROWS; i++) {
        const row = document.createElement('div');
        row.className = 'lrow';
        logEl.appendChild(row);
        logRows.push(row);
    }

    input.addEventListener('compositionstart', (e) => {
        imeState.composing = true;
        imeState.preedit = '';
        imeState.rangeStart = -1;
        imeState.committed = '';
        note('compositionstart', e.data);
    });

    input.addEventListener('compositionupdate', (e) => {
        imeState.updates++;
        imeState.preedit = e.data || '';
        imeState.caret = input.selectionStart;
        // Pin the start on the first update of this composition. Later updates
        // may move the caret inside the preedit (cursorPos), which would make
        // the same subtraction wander.
        if (imeState.rangeStart < 0) {
            imeState.rangeStart = input.selectionStart - imeState.preedit.length;
        }
        imeState.rangeEnd = imeState.rangeStart + imeState.preedit.length;
        note('compositionupdate', e.data);
    });

    input.addEventListener('compositionend', (e) => {
        imeState.composing = false;
        imeState.committed = e.data || '';
        if (imeState.committed === '') imeState.cancelled++;
        else imeState.compositions++;
        imeState.preedit = '';
        imeState.rangeStart = imeState.rangeEnd = -1;
        note('compositionend', e.data);
    });

    // `input` fires for composition revisions too, with a distinguishing
    // inputType — an app that treats every `input` as a finished edit is the
    // bug this panel exists to make visible.
    input.addEventListener('input', (e) => {
        note('input (' + (e.inputType || '?') + ')', e.data);
    });

    document.getElementById('imeCJK').addEventListener('click', () => driveCJK());
    document.getElementById('imeAccent').addEventListener('click', () => driveAccent());
    document.getElementById('imeAbort').addEventListener('click', () => driveCancel());
    document.getElementById('imeClear').addEventListener('click', () => {
        input.value = '';
        imeState.events.length = 0;
        imeState.updates = 0;
        renderLog();
        update();
    });

    if (!imeState.headless) {
        for (const id of ['imeCJK', 'imeAccent', 'imeAbort']) {
            document.getElementById(id).disabled = true;
        }
        document.getElementById('imeSeamNote').textContent =
            'The injection seams (imeCompose/imeCommit/imeCancel) are bro-headless ' +
            'globals — unavailable in a window. Use your OS IME on the field above.';
    }

    renderLog();
    update();
}

const READOUT = [
    'composing', 'preedit', 'composition range', 'composition caret',
    'committed (compositionend)', 'field value', 'compositionupdate count',
    'completed compositions', 'cancelled compositions',
];

function note(type, data) {
    imeState.events.push({ type, data: data === null ? null : String(data === undefined ? '' : data),
                           value: input.value });
    if (imeState.events.length > 100) imeState.events.shift();
    renderLog();
    update();
}

function renderLog() {
    const start = Math.max(0, imeState.events.length - LOG_ROWS);
    for (let i = 0; i < LOG_ROWS; i++) {
        const e = imeState.events[start + i];
        const row = logRows[i];
        if (!e) { row.textContent = ''; row.className = 'lrow'; continue; }
        const txt = `${e.type.padEnd(26)} data=${JSON.stringify(e.data)}  ` +
                    `value=${JSON.stringify(e.value)}`;
        if (row.textContent !== txt) row.textContent = txt;
        const kind = e.type.indexOf('composition') === 0 ? 'ptr' : 'compat';
        const cls = 'lrow ' + kind;
        if (row.className !== cls) row.className = cls;
    }
}

function update() {
    const s = imeState;
    const vals = [
        s.composing ? 'YES' : 'no',
        s.preedit === '' ? '—' : JSON.stringify(s.preedit),
        s.rangeStart < 0 ? '—' : `[${s.rangeStart}, ${s.rangeEnd})`,
        s.caret < 0 ? '—' : String(s.caret),
        s.committed === '' ? '—' : JSON.stringify(s.committed),
        JSON.stringify(input ? input.value : ''),
        String(s.updates),
        String(s.compositions),
        String(s.cancelled),
    ];
    for (let i = 0; i < vals.length; i++) {
        const el = document.getElementById('ival' + i);
        if (el && el.textContent !== vals[i]) el.textContent = vals[i];
    }
    const banner = document.getElementById('imeBanner');
    if (banner) {
        const t = s.composing ? `composing "${s.preedit}"  →  range [${s.rangeStart}, ${s.rangeEnd})`
                              : 'not composing';
        if (banner.textContent !== t) banner.textContent = t;
        const cls = 'capture' + (s.composing ? ' on' : '');
        if (banner.className !== cls) banner.className = cls;
    }
}

// ── the injection drivers ───────────────────────────────────────────────────
//
// Each of these is a plausible IME session: several preedit revisions, then a
// commit. Exported so the smoke test drives exactly what the buttons drive.

/** Pinyin-style: "n" → "ni" → "nihao" → 你好, committed. */
export function driveCJK() {
    if (!hasSeams()) return false;
    input.focus();
    globalThis.imeCompose('n');
    globalThis.imeCompose('ni');
    globalThis.imeCompose('nihao');
    globalThis.imeCompose('你好');
    globalThis.imeCommit('你好');
    return true;
}

/** Dead-key style: an accent that resolves into the accented letter. */
export function driveAccent() {
    if (!hasSeams()) return false;
    input.focus();
    globalThis.imeCompose('´');    // the dead acute, shown provisionally
    globalThis.imeCompose('é');    // resolves to é once the vowel arrives
    globalThis.imeCommit('é');
    return true;
}

/** Compose, then abandon — the value must return to what it was. */
export function driveCancel() {
    if (!hasSeams()) return false;
    input.focus();
    globalThis.imeCompose('か');
    globalThis.imeCompose('かん');
    globalThis.imeCancel();
    return true;
}

/** Exported for the smoke test: clear the field and the counters. */
export function resetIme() {
    if (!input) return;
    input.value = '';
    imeState.events.length = 0;
    imeState.updates = 0;
    imeState.compositions = 0;
    imeState.cancelled = 0;
    imeState.committed = '';
    renderLog();
    update();
}
